import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { lens, prism, review, view, set } from "@/lib/Control/Lens";
import { Name, type Entity, type EntityClass, type Model } from "@/hades/src/Model/Abstract/PackageTree";
import {
  BuiltInDef, DecoBool, DecoBoolDef, DecoIntDef, DecoRange, EnumDef, EnumItem, Field, migrateField,
} from "@/hades/src/Model/Reflection/Types";
import { ExtBool, ExtInt, ExtNone, ExtReal, ExtText, type ExtValue } from "@/hades/src/Model/Reflection/Values";
import { nameField } from "@/hades/src/Model/Abstract/PackageTree";
import {
  JSON_LookupTable, LookupTable, Reflective_LookupTable, def_LookupTable, goodAxis, horizontalAxis,
  lookupEditGadget, lookupForest, maxAxisRange, runLookup, show_LookupTable, tableFunctions, tableName,
  tableValues, type HasLookups,
} from "./Base";

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

/** All the lookup table JSON objects in the example models. */
const exampleTables: [string, any][] = examples.flatMap(([f, m]) =>
  (m.modelContents as any[])
    .filter((e) => e.contents?.type === "lookup-table")
    .map((e) => [f + ": " + e.contents.name, e.contents] as [string, any]));

const hField = migrateField("Probability");
const vField = migrateField("Severity");
const oField = migrateField("Risk");

const key = (x: ExtValue, y: ExtValue): readonly [ExtValue, ExtValue] => [x, y];

const sampleTable = LookupTable(
  Name("Risk matrix"),
  hField,
  vField,
  oField,
  M.fromList<readonly [ExtValue, ExtValue], ExtValue>([
    [key(ExtText("Low"), ExtBool(false)), ExtText("OK")],
    [key(ExtText("High"), ExtBool(true)), ExtText("Bad")],
    [key(ExtNone, ExtBool(true)), ExtText("Unknown")],
  ]),
);

describe("LookupTable JSON", () => {
  it("finds the example tables", () => {
    expect(exampleTables.length).toBeGreaterThanOrEqual(5);
  });

  it.each(exampleTables)("round-trips %s", (_name, obj) => {
    const tbl = JSON_LookupTable.parseJSON(obj);
    expect(tbl._tableValues.size).toBe(obj.values.length);
    const out = JSON_LookupTable.toJSON(tbl) as any;
    // Field names migrate to UUIDs; everything else is reproduced exactly, including the order
    // of the "values" pairs (which follows the Haskell Ord ExtValue instance).
    const migrate = (s: string) => U.fromText(s).tag === "Just" ? s : migrateField(s);
    expect(out).toEqual({
      ...obj,
      horizontal: migrate(obj.horizontal),
      vertical: migrate(obj.vertical),
      output: migrate(obj.output),
    });
    expect(equals(JSON_LookupTable.parseJSON(out), tbl)).toBe(true);
  });

  it("writes the aeson encoding", () => {
    expect(JSON_LookupTable.toJSON(sampleTable)).toEqual({
      type: "lookup-table",
      name: "Risk matrix",
      horizontal: hField,
      vertical: vField,
      output: oField,
      values: [
        [[{ type: "none" }, { type: "bool", value: true }], { type: "text", value: "Unknown" }],
        [[{ type: "text", value: "High" }, { type: "bool", value: true }], { type: "text", value: "Bad" }],
        [[{ type: "text", value: "Low" }, { type: "bool", value: false }], { type: "text", value: "OK" }],
      ],
    });
  });

  it("rejects other types and strips names", () => {
    const obj = JSON_LookupTable.toJSON(sampleTable) as J.JSONObject;
    expect(J.parseEither(JSON_LookupTable.parseJSON, { ...obj, type: "foo" }))
      .toEqual(Left("foo is not a lookup table."));
    const t2 = JSON_LookupTable.parseJSON({ ...obj, name: "  Spaced  " });
    expect(view(tableName, t2)).toEqual(Name("Spaced"));
  });
});

describe("Default, Show and Reflective", () => {
  it("def_LookupTable is empty", () => {
    expect(def_LookupTable._tableName).toEqual(Name(""));
    expect(def_LookupTable._horizontalAxis).toBe(U.nil);
    expect(def_LookupTable._tableValues.size).toBe(0);
  });

  it("show_LookupTable follows the derived Show", () => {
    const t = LookupTable(Name("T"), U.nil, U.nil, U.nil, M.fromList([[key(ExtInt(-1), ExtReal(2.5)), ExtNone]]));
    expect(show_LookupTable(t)).toBe(
      "LookupTable {_tableName = Name \"T\", _horizontalAxis = 00000000-0000-0000-0000-000000000000, " +
      "_verticalAxis = 00000000-0000-0000-0000-000000000000, " +
      "_tableOutput = 00000000-0000-0000-0000-000000000000, " +
      "_tableValues = fromList [((ExtInt (-1),ExtReal 2.5),ExtNone)]}");
  });

  it("gets and sets the name field", () => {
    const r = Reflective_LookupTable;
    expect(r.reflectiveName(sampleTable)).toBe("Lookup Table");
    expect(r.reflectiveBuiltIn(sampleTable)).toEqual([nameField]);
    expect(r.reflectiveGet(sampleTable)).toEqual(M.singleton(nameField, ExtText("Risk matrix")));
    const extra = migrateField("Other");
    const st = { state: M.fromList([[nameField, ExtText("  New name ")], [extra, ExtInt(3)]]) };
    const t2 = r.reflectiveSet(st, sampleTable);
    expect(view(tableName, t2)).toEqual(Name("New name"));
    expect(st.state).toEqual(M.singleton(extra, ExtInt(3)));
    // Wrong type: keep the old name.
    const st2 = { state: M.singleton(nameField, ExtInt(3)) };
    expect(view(tableName, r.reflectiveSet(st2, sampleTable))).toEqual(Name("Risk matrix"));
  });
});

describe("runLookup", () => {
  it("looks up the (horizontal, vertical) pair", () => {
    const vals = (h: ExtValue, v: ExtValue) => M.fromList([[hField, h], [vField, v]]);
    expect(runLookup(sampleTable, vals(ExtText("High"), ExtBool(true)))).toEqual(ExtText("Bad"));
    expect(runLookup(sampleTable, vals(ExtText("Low"), ExtBool(false)))).toEqual(ExtText("OK"));
    expect(runLookup(sampleTable, vals(ExtText("Low"), ExtBool(true)))).toEqual(ExtNone);
  });

  it("returns ExtNone when an input is missing", () => {
    expect(runLookup(sampleTable, M.singleton(hField, ExtText("High")))).toEqual(ExtNone);
    // A missing value is not the same as an ExtNone value.
    expect(runLookup(sampleTable, M.singleton(vField, ExtBool(true)))).toEqual(ExtNone);
    expect(runLookup(sampleTable, M.fromList([[hField, ExtNone], [vField, ExtBool(true)]])))
      .toEqual(ExtText("Unknown"));
  });

  it("uses the Haskell ExtValue ordering for keys", () => {
    // ExtInt and ExtReal compare numerically, so ExtReal 2.0 finds the ExtInt 2 key.
    const t = set(tableValues, M.fromList([[key(ExtInt(2), ExtInt(3)), ExtText("x")]]), sampleTable);
    expect(runLookup(t, M.fromList([[hField, ExtReal(2)], [vField, ExtInt(3)]]))).toEqual(ExtText("x"));
  });
});

describe("goodAxis", () => {
  const fid = migrateField("F");
  const fld = (multi: "One" | "Optional", t: Parameters<typeof Field>[4]) => Field(false, fid, "F", multi, t);

  it("accepts booleans", () => {
    expect(goodAxis(fld("One", BuiltInDef("ModelBool")))).toEqual(Just([fid, "F", [ExtBool(false), ExtBool(true)]]));
    expect(goodAxis(fld("Optional", DecoBoolDef(DecoBool(Nothing, Nothing)))))
      .toEqual(Just([fid, "F", [ExtNone, ExtBool(false), ExtBool(true)]]));
  });

  it("accepts small integer ranges only", () => {
    expect(goodAxis(fld("One", DecoIntDef(DecoRange([Just(1), Just(3)], [])))))
      .toEqual(Just([fid, "F", [ExtInt(1), ExtInt(2), ExtInt(3)]]));
    expect(maxAxisRange).toBe(10);
    expect(goodAxis(fld("One", DecoIntDef(DecoRange([Just(0), Just(9)], []))))).not.toEqual(Nothing);
    expect(goodAxis(fld("One", DecoIntDef(DecoRange([Just(0), Just(10)], []))))).toEqual(Nothing);
    expect(goodAxis(fld("One", DecoIntDef(DecoRange([Just(3), Just(3)], []))))).toEqual(Nothing);
    expect(goodAxis(fld("One", DecoIntDef(DecoRange([Nothing, Just(3)], []))))).toEqual(Nothing);
  });

  it("accepts enumerations and rejects other types", () => {
    const e = EnumDef([EnumItem("a", Nothing, Nothing), EnumItem("b", Nothing, Nothing)]);
    expect(goodAxis(fld("Optional", e))).toEqual(Just([fid, "F", [ExtNone, ExtText("a"), ExtText("b")]]));
    expect(goodAxis(fld("One", BuiltInDef("ModelText")))).toEqual(Nothing);
    expect(goodAxis(fld("One", BuiltInDef("ModelInt")))).toEqual(Nothing);
  });
});

// ---------------------------------------------------------------------------------------------
// Model-level functions: a tiny model with a package "Risk" holding a lookup table "Matrix" and
// a non-table "Notes".

type TV = { readonly kind: "Pkg"; readonly nm: Name } | { readonly kind: "Tbl"; readonly tbl: LookupTable };

const cls = {
  reflectiveName: (v: TV) => v.kind,
  variantUserLabel: (v: string) => v,
  reflectiveDefaults: [],
  reflectiveBuiltIn: () => [],
  reflectiveGet: () => M.empty(),
  reflectiveSet: (_st: unknown, v: TV) => v,
  reflectiveBuiltInRefs: { _0: M.empty() },
  reflectiveArrows: M.empty(),
  name: lens(
    (v: TV) => (v.kind === "Pkg" ? v.nm : v.tbl._tableName),
    (v: TV, n: Name): TV => (v.kind === "Pkg" ? { ...v, nm: n } : { ...v, tbl: set(tableName, n, v.tbl) }),
  ),
  _LookupTable: prism(
    (t: LookupTable): TV => ({ kind: "Tbl", tbl: t }),
    (v: TV) => (v.kind === "Tbl" ? Right(v.tbl) : Left(v)),
  ),
} as unknown as EntityClass<TV> & HasLookups<TV>;

const id = (n: number): U.UUID => U.fromWords(0, 0, 0, n);

function mkEntity(n: number, parent: number, v: TV, children: [string, number][] = []): Entity<TV> {
  return {
    entityId: id(n),
    _entityParent: parent === 0 ? U.nil : id(parent),
    _entityChildren: M.fromList(children.map(([c, k]) => [Name(c), id(k)] as const)),
    _entityContents: v,
    _entityExtensions: M.empty(),
    entityCreated: ["test", "2020-01-01"],
    _entityModified: ["test", "2020-01-01"],
  } as unknown as Entity<TV>;
}

const model = {
  modelName: "Test",
  modelRoot: M.fromList([[Name("Risk"), id(1)]]),
  modelContents: M.fromList([
    mkEntity(1, 0, { kind: "Pkg", nm: Name("Risk") }, [["Matrix", 2], ["Notes", 3]]),
    mkEntity(2, 1, review(cls._LookupTable, set(tableName, Name("Matrix"), sampleTable))),
    mkEntity(3, 1, { kind: "Pkg", nm: Name("Notes") }),
  ].map((e) => [e.entityId, e] as const)),
  modelRelations: { _0: M.empty() },
  modelFields: M.fromList([
    [hField, Field(false, hField, "Probability", "One",
      EnumDef([EnumItem("Low", Nothing, Nothing), EnumItem("High", Nothing, Nothing)]))],
    [vField, Field(false, vField, "Severity", "One", BuiltInDef("ModelBool"))],
    [oField, Field(false, oField, "Risk", "One", BuiltInDef("ModelText"))],
  ]),
  modelExtensions: M.empty(),
} as unknown as Model<TV>;

describe("tableFunctions", () => {
  const lookupF = (args: ExtValue[], vals: M.Map<string, ExtValue>) => {
    const f = M.lookup("Lookup", tableFunctions(cls));
    if (f.tag === "Nothing") throw new Error("No Lookup function");
    return f.value(args, vals, model);
  };
  const vals = M.fromList([[hField, ExtText("High")], [vField, ExtBool(true)]]);

  it("follows the path to the table and looks up the inputs", () => {
    expect(lookupF([ExtText("Risk/Matrix")], vals)).toEqual(Right(ExtText("Bad")));
    expect(lookupF([ExtText("/Risk//Matrix/")], vals)).toEqual(Right(ExtText("Bad")));
  });

  it("reports errors", () => {
    expect(lookupF([], vals)).toEqual(Left("Lookup takes 1 arguments, not 0."));
    expect(lookupF([ExtText("Risk/Notes")], vals)).toEqual(Left("Not a lookup table: Risk/Notes"));
    expect(lookupF([ExtText("Risk")], vals)).toEqual(Left("Not a lookup table: Risk"));
    expect(lookupF([ExtText("")], vals)).toEqual(Left("Not a lookup table: "));
    expect(lookupF([ExtText("Risk/Wibble")], vals)).toEqual(Left("Wibble not found.: Risk/Wibble"));
  });
});

describe("lookupForest and lookupEditGadget", () => {
  it("marks only the lookup tables as selectable", () => {
    const forest = lookupForest(cls, model);
    expect(forest.length).toBe(1);
    const [root] = forest;
    expect(root.rootLabel).toEqual(["Risk", Nothing, Nothing]);
    expect(root.subForest.map((t) => t.rootLabel)).toEqual([
      ["Matrix", Nothing, Just(id(2))],
      ["Notes", Nothing, Nothing],
    ]);
  });

  it("builds the editor gadget for a model", () => {
    const g = lookupEditGadget(cls) as any;
    expect(g.tag).toBe("GetInitialEnv");
    expect(() => g._0(model)).not.toThrow();
    expect(view(horizontalAxis, sampleTable)).toBe(hField);
  });
});
