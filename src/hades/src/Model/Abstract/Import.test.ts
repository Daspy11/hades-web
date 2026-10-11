import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { equals } from "@/lib/Data/Ord";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import {
  Cell, CellBool, CellDouble, CellError, CellRich, CellText, RichTextRun, Worksheet, Xlsx,
  type CellValue,
} from "@/lib/Codec/Xlsx";
import {
  BuiltInDef, DecoIntDef, EnumDef, Field, def_DecoType, migrateField, type FieldTable,
} from "@/hades/src/Model/Reflection/Types";
import { ExtBool, ExtDate, ExtInt, ExtNone, ExtReal, ExtText } from "@/hades/src/Model/Reflection/Values";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { type Either } from "@/lib/Data/Either";
import { identity, lens, prism_, set, view } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type EntityClass, type Model, type ModelEditCtx, type ModelError, Name, Package, UserError, emptyModel,
  goToEntity, goToRoot, mkEntity, mkPackage, modelStartState, nameField, runModelEdit, show_ModelError,
} from "./PackageTree";
import {
  contiguous, extractText, goodDataRow, goodHeaderRow, importExcel, nameClashActionValues,
  show_NameClashAction, typeConversion, xlsFindData, xlsRows, type XlsRow,
} from "./Import";

// Compare persistent maps and sets by their contents (Haskell Eq), not their tree shapes.
expect.addEqualityTesters([
  (a: unknown, b: unknown) =>
    a instanceof M.HMap || a instanceof S.HSet || b instanceof M.HMap || b instanceof S.HSet
      ? equals(a, b)
      : undefined,
]);

const nameId = migrateField("Name");
const countId = migrateField("Count");
const dueId = migrateField("Due");
const ftable: FieldTable = M.fromList([
  [dueId, Field(false, dueId, "Due", "One", BuiltInDef("ModelDate"))],
]);

function row(cells: readonly (readonly [number, CellValue])[]): XlsRow {
  return M.fromList<number, CellValue>(cells);
}

function sheet(cells: readonly (readonly [number, number, CellValue])[]): Worksheet {
  return Worksheet(M.fromList(cells.map(([r, c, v]): [readonly [number, number], Cell] => [[r, c], Cell(Nothing, Just(v))])));
}

describe("NameClashAction", () => {
  it("shows the user labels", () => {
    expect(nameClashActionValues.map(show_NameClashAction)).toEqual([
      "Cancel import", "Merge with existing entities", "Drop imported entities",
    ]);
  });
});

describe("contiguous", () => {
  it("finds runs of keys", () => {
    const m = M.fromList<number, string>([[1, "a"], [2, "b"], [3, "c"], [5, "d"], [7, "e"], [8, "f"]]);
    expect(contiguous(m)).toEqual([[1, ["a", "b", "c"]], [5, ["d"]], [7, ["e", "f"]]]);
    expect(contiguous(M.empty<number, string>())).toEqual([]);
    expect(contiguous(M.fromList<number, string>([[4, "x"]]))).toEqual([[4, ["x"]]]);
  });
});

describe("rows", () => {
  it("groups cells into rows and drops empty cells", () => {
    const ws = Worksheet(M.fromList<readonly [number, number], Cell>([
      [[2, 1], Cell(Nothing, Just(CellText("b")))],
      [[1, 2], Cell(Nothing, Just(CellText("a2")))],
      [[1, 1], Cell(Nothing, Just(CellText("a1")))],
      [[3, 1], Cell(Nothing, Nothing)],
    ]));
    const rows = xlsRows(ws);
    expect(M.keys(rows)).toEqual([1, 2]);
    expect(M.toList(M.findWithDefault(row([]), 1, rows))).toEqual([[1, CellText("a1")], [2, CellText("a2")]]);
  });

  it("recognises header rows", () => {
    const hdr = row([[2, CellText("Name")], [3, CellText("Count")], [4, CellText("Bogus")]]);
    const r = goodHeaderRow(ftable, hdr);
    expect(r.tag).toBe("Just");
    if (r.tag === "Just") {
      expect(r.value[0]).toBe(2);
      expect(r.value[1].map((f) => f.fieldId)).toEqual([nameId, countId]);
    }
    // Not contiguous, no "Name", only one cell, or non-text cells.
    expect(goodHeaderRow(ftable, row([[1, CellText("Name")], [3, CellText("Count")]]))).toEqual(Nothing);
    expect(goodHeaderRow(ftable, row([[1, CellText("Due")], [2, CellText("Count")]]))).toEqual(Nothing);
    expect(goodHeaderRow(ftable, row([[1, CellText("Name")]]))).toEqual(Nothing);
    expect(goodHeaderRow(ftable, row([[1, CellText("Name")], [2, CellDouble(1)]]))).toEqual(Nothing);
  });

  it("converts data rows", () => {
    const hdr = goodHeaderRow(ftable, row([[2, CellText("Name")], [3, CellText("Count")], [4, CellText("Due")]]));
    if (hdr.tag !== "Just") throw new Error("no header");
    const r1 = row([[2, CellText("Foo")], [3, CellDouble(2.5)], [4, CellDouble(2)]]);
    expect(goodDataRow("1899-12-30", hdr.value, r1)).toEqual(Just(M.fromList([
      [nameId, ExtText("Foo")], [countId, ExtInt(2)], [dueId, ExtDate("1900-01-01")],
    ])));
    // A cell to the left of the header makes the row invalid; empty rows are invalid.
    expect(goodDataRow("1899-12-30", hdr.value, row([[1, CellText("x")], [2, CellText("Foo")]]))).toEqual(Nothing);
    expect(goodDataRow("1899-12-30", hdr.value, row([]))).toEqual(Nothing);
  });
});

describe("typeConversion", () => {
  const epoch = "1899-12-30";
  it("converts by type", () => {
    expect(typeConversion(epoch, BuiltInDef("ModelBool"), CellBool(true))).toEqual(Just(ExtBool(true)));
    expect(typeConversion(epoch, BuiltInDef("ModelBool"), CellText("True"))).toEqual(Nothing);
    expect(typeConversion(epoch, BuiltInDef("ModelInt"), CellDouble(3.5))).toEqual(Just(ExtInt(4)));
    expect(typeConversion(epoch, BuiltInDef("ModelInt"), CellDouble(2.5))).toEqual(Just(ExtInt(2)));
    expect(typeConversion(epoch, BuiltInDef("ModelInt"), CellText("42"))).toEqual(Just(ExtInt(42)));
    expect(typeConversion(epoch, BuiltInDef("ModelInt"), CellText("x"))).toEqual(Nothing);
    expect(typeConversion(epoch, BuiltInDef("ModelReal"), CellText("1.5"))).toEqual(Just(ExtReal(1.5)));
    expect(typeConversion(epoch, BuiltInDef("ModelText"), CellDouble(1))).toEqual(Just(ExtText("1.0")));
    expect(typeConversion(epoch, BuiltInDef("ModelNote"), CellBool(false))).toEqual(Just(ExtText("False")));
    expect(typeConversion(epoch, BuiltInDef("ModelDate"), CellDouble(43831.7))).toEqual(Just(ExtDate("2020-01-01")));
    expect(typeConversion(epoch, BuiltInDef("ModelDate"), CellText("3 January 2018"))).toEqual(Just(ExtDate("2018-01-03")));
    expect(typeConversion(epoch, BuiltInDef("ModelDate"), CellText("3/1/2018"))).toEqual(Just(ExtDate("2018-01-03")));
    expect(typeConversion(epoch, DecoIntDef(def_DecoType), CellText("7"))).toEqual(Just(ExtInt(7)));
    expect(typeConversion(epoch, EnumDef([]), CellText("Red"))).toEqual(Just(ExtText("Red")));
    expect(ExtNone).toEqual(ExtNone);
  });
  it("extracts text", () => {
    expect(extractText(CellRich([RichTextRun(Nothing, "ab"), RichTextRun(Nothing, "cd")]))).toBe("abcd");
    expect(extractText(CellError("ErrorNA"))).toBe("");
    expect(extractText(CellDouble(0.1))).toBe("0.1");
  });
});

describe("xlsFindData", () => {
  it("reports missing data", () => {
    expect(xlsFindData(ftable, Xlsx([], "DateBase1900"))).toEqual(Left("No worksheets found in Excel file."));
    expect(xlsFindData(ftable, Xlsx([
      ["A", sheet([[1, 1, CellText("x")]])],
      ["B", sheet([[1, 1, CellText("Name")], [1, 2, CellText("Count")]])],
      ["C", sheet([[1, 2, CellText("Name")], [1, 3, CellText("Count")], [2, 1, CellText("Foo")]])],
    ], "DateBase1900"))).toEqual(Left(
      "No data could be imported:\n   Sheet A has no header rows.\n   Sheet B has a header row but no data." +
      "\n   Sheet C data rows were all invalid.",
    ));
  });
  it("finds data in all good sheets", () => {
    const book = Xlsx([
      ["Bad", sheet([[1, 1, CellText("x")]])],
      ["Good", sheet([
        [1, 1, CellText("Title")],
        [3, 1, CellText("Name")], [3, 2, CellText("Due")],
        [4, 1, CellText("Foo")], [4, 2, CellDouble(1)],
        [6, 1, CellText("Bar")],
      ])],
    ], "DateBase1904");
    expect(xlsFindData(ftable, book)).toEqual(Right([
      M.fromList([[nameId, ExtText("Foo")], [dueId, ExtDate("1904-01-02")]]),
      M.fromList([[nameId, ExtText("Bar")]]),
    ]));
  });
});

// ---------------------------------------------------------------------------------------------
// importExcel, with a minimal entity type: packages and named items. Items cannot have children.

type TV =
  | { readonly tag: "P"; readonly _0: Package<TV, null> }
  | { readonly tag: "I"; readonly _0: Name };
const pkgV = (p: Package<TV, null>): TV => ({ tag: "P", _0: p });
const itemV = (n: string): TV => ({ tag: "I", _0: Name(n) });
const tvName = lens(
  (v: TV) => (v.tag === "P" ? v._0._packageName : v._0),
  (v: TV, n: Name): TV => (v.tag === "P" ? pkgV({ ...v._0, _packageName: n }) : { tag: "I", _0: n }),
);
const cls: EntityClass<TV, null> = {
  reflectiveName: (v) => (v.tag === "P" ? "Package" : "Item"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [pkgV(Package(Name(""), null)), itemV("")],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(tvName, v)._0)),
  reflectiveSet: (st, v) => set(tvName, Name(extract(st, view(tvName, v)._0, _ExtText, nameField)), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: tvName,
  _Package: prism_((p: Package<TV, null>) => pkgV(p), (v: TV) => (v.tag === "P" ? Just(v._0) : Nothing)),
  entityCanHaveChild: (p) => p.tag === "P",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(() => null, () => itemV("")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
};

function runEdit<A>(model: Model<TV>, act: (c: ModelEditCtx<TV, TV>) => A): Either<ModelError, [A, Model<TV>]> {
  const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), model), act);
  return r.tag === "Left" ? Left(r.value) : Right([r.value[0].updateValue, r.value[0].updateNewModel]);
}

describe("importExcel", () => {
  const book = Xlsx([["S", sheet([
    [1, 1, CellText("Name")], [1, 2, CellText("Due")], [1, 3, CellText("Created")],
    [2, 1, CellText("Foo")], [2, 2, CellDouble(2)], [2, 3, CellDouble(5)],
    [3, 1, CellText("Bar")],
  ])]], "DateBase1900");
  const [ids, base] = (() => {
    const r = runEdit({ ...emptyModel(cls, "M"), modelFields: ftable }, (c) => {
      const p = mkPackage(c, Name("Pkg"));
      goToEntity(c, p);
      const bar = mkEntity(c, itemV("Bar"));
      goToRoot(c);
      const item = mkEntity(c, itemV("Item"));
      return { p, bar: bar.entityId, item: item.entityId };
    });
    if (r.tag === "Left") throw new Error("setup failed");
    return r.value;
  })();
  const childNames = (m: Model<TV>, p: U.UUID): string[] =>
    M.keys(M.findWithDefault(M.empty<Name, U.UUID>(), p, M.map((e) => e._entityChildren, m.modelContents)))
      .map((n) => n._0);

  it("imports rows as new entities and reports clashes", () => {
    const r = runEdit(base, (c) => {
      goToEntity(c, ids.p);
      return importExcel(c, "DropClash", book, itemV(""));
    });
    if (r.tag === "Left") throw new Error(show_ModelError(r.value));
    const [warns, m] = r.value;
    expect(warns).toEqual(["Dropped duplicate: Bar"]);
    expect(childNames(m, ids.p)).toEqual(["Bar", "Foo"]);
    const foo = [...M.elems(m.modelContents)].find((e) => view(tvName, e._entityContents)._0 === "Foo");
    // The unrecognised "Created" column is ignored.
    expect(foo?._entityExtensions).toEqual(M.fromList([[dueId, ExtDate("1900-01-01")]]));
  });

  it("merges with or cancels on clashes", () => {
    const r = runEdit(base, (c) => {
      goToEntity(c, ids.p);
      return importExcel(c, "MergeClash", book, itemV(""));
    });
    if (r.tag === "Left") throw new Error(show_ModelError(r.value));
    expect(r.value[0]).toEqual(["Merged with existing: Bar"]);
    const r2 = runEdit(base, (c) => {
      goToEntity(c, ids.p);
      return importExcel(c, "CancelClash", book, itemV(""));
    });
    expect(r2).toEqual(Left(UserError("Duplicate name: Bar")));
  });

  it("checks the template can be imported here", () => {
    const r = runEdit(base, (c) => {
      goToEntity(c, ids.item);
      return importExcel(c, "DropClash", book, itemV(""));
    });
    expect(r).toEqual(Left(UserError("Cannot import Item entities into Item")));
    const r2 = runEdit(base, (c) => importExcel(c, "DropClash", Xlsx([], "DateBase1900"), itemV("")));
    expect(r2).toEqual(Left(UserError("No worksheets found in Excel file.")));
  });
});
