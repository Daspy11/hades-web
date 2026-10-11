import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { review } from "@/lib/Control/Lens";
import type { Tree } from "@/lib/Data/Tree";
import type { Gadget } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { showGadget } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import {
  addFieldDecoration, expressionEntry, extensionDialog, fieldDialog, fieldElement, fieldElement1,
  referenceListDialog, referenceTypeDialog, showSubset, subsetDialog, subsetGadget,
} from "./Dialogs";
import type { Function } from "./Parser";
import {
  BuiltInDef, DecoBool, DecoBoolDef, DecoIntDef, DecoRange, EnumDef, EnumItem, Field, migrateField,
  type BuiltInType, type FieldTable, type Multiplicity,
} from "./Types";
import { ExtBool, ExtInt, ExtNone, ExtText, type ExtValue } from "./Values";
import { RefType, mempty_RefTypeTable } from "./References";
import { defaultVariantUserLabel, type Reflective } from "./Reflective";

function mkField(nm: string, t: BuiltInType, multi: Multiplicity = "One", ro = false): Field {
  return Field(ro, migrateField(nm), nm, multi, BuiltInDef(t));
}

/** Follow a path of positional fields through a gadget tree. */
function at(g: unknown, ...path: (string | number)[]): any {
  let x: any = g;
  for (const p of path) x = x[p];
  return x;
}

/** The `showGadget` tree as a one-line string. */
function tags(g: Gadget<any, any, any, any>): string {
  const go = (t: Tree<string>): string =>
    t.subForest.length === 0 ? t.rootLabel : t.rootLabel + "(" + t.subForest.map(go).join(",") + ")";
  return go(showGadget(g));
}

describe("showSubset", () => {
  const universe = S.fromList(["a", "b", "c", "d", "e", "f", "g", "h"]);
  const name = (s: string) => s.toUpperCase();

  it("describes empty and full sets", () => {
    expect(showSubset(name, universe, S.empty())).toBe("<Nothing>");
    expect(showSubset(name, universe, universe)).toBe("<Everything>");
  });

  it("lists the shorter description", () => {
    expect(showSubset(name, universe, S.fromList(["c", "a"]))).toBe("A, C");
    // 3 + 8 `div` 2 = 7: six elements are still listed, seven are not.
    expect(showSubset(name, universe, S.fromList(["a", "b", "c", "d", "e", "f"]))).toBe("A, B, C, D, E, F");
    expect(showSubset(name, universe, S.fromList(["a", "b", "c", "d", "e", "f", "g"]))).toBe("All except H");
  });
});

describe("fieldElement", () => {
  it("wraps one-valued fields in a prism", () => {
    const g = fieldElement(false, mkField("Count", "ModelInt"));
    expect(g.tag).toBe("Prismatic");
    expect(at(g, "_2").tag).toBe("TextBox");
    expect(at(g, "_1").match(ExtInt(3))).toEqual(Right(3));
    expect(at(g, "_1").match(ExtText("3")).tag).toBe("Left");
  });

  it("handles optional fields through Maybe", () => {
    const g = fieldElement(false, mkField("Count", "ModelInt", "Optional"));
    expect(g.tag).toBe("Prismatic");
    expect(at(g, "_0")).toEqual(Nothing);
    expect(at(g, "_2").tag).toBe("Optional");
    const prsm = at(g, "_1");
    expect(prsm.match(ExtNone)).toEqual(Right(Nothing));
    expect(prsm.match(ExtInt(3))).toEqual(Right(Just(3)));
    expect(prsm.match(ExtText("x")).tag).toBe("Left");
    expect(review(prsm, Nothing)).toEqual(ExtNone);
    expect(review(prsm, Just(4))).toEqual(ExtInt(4));
  });

  it("chooses read-only gadgets for read-only fields", () => {
    expect(at(fieldElement(false, mkField("Count", "ModelInt", "One", true)), "_2").tag).toBe("FixedText");
    expect(at(fieldElement(false, mkField("Name", "ModelText", "One", true)), "_2").tag).toBe("Styled");
    expect(at(fieldElement(false, mkField("Name", "ModelText")), "_2").tag).toBe("TextBox");
    expect(at(fieldElement(true, mkField("Notes", "ModelNote")), "_2")).toMatchObject({ tag: "MemoBox", _1: true });
    expect(at(fieldElement(false, mkField("When", "ModelDate")), "_2").tag).toBe("DateBox");
    expect(at(fieldElement(false, mkField("Flag", "ModelBool")), "_2").tag).toBe("TickBox");
  });

  it("validates URLs", () => {
    const g = fieldElement(false, mkField("Link", "ModelURL"));
    const prsm = at(g, "_2", "_0")(null);
    expect(prsm.match("http://example.com/x?y#z")).toEqual(Right("http://example.com/x?y#z"));
    expect(prsm.match("not a url")).toEqual(Left("not a url"));
  });

  it("decorates booleans", () => {
    const f = Field(false, migrateField("D"), "D", "One",
      DecoBoolDef(DecoBool(Just(["no", "yes"]), Nothing)));
    const g = fieldElement(false, f);
    expect(g.tag).toBe("Icon");
    expect(at(g, "_0")(ExtBool(true))).toBe("yes");
    expect(at(g, "_0")(ExtBool(false))).toBe("no");
    expect(at(g, "_0")(ExtNone)).toBe("blank-icon");
  });

  it("decorates integer ranges", () => {
    const f = Field(false, migrateField("R"), "R", "One",
      DecoIntDef(DecoRange([Just(0), Just(10)], [[[Nothing, Just(5)], [Just("low"), Nothing]]])));
    const g = fieldElement(false, f);
    expect(g.tag).toBe("Coloured");
    expect(at(g, "_1").tag).toBe("Icon");
    expect(at(g, "_1", "_0")(ExtInt(3))).toBe("low");
    expect(at(g, "_1", "_0")(ExtInt(7))).toBe("blank-icon");
    const prsm = at(g, "_1", "_1", "_2", "_0")(null);
    expect(prsm.match("7")).toEqual(Right(7));
    expect(prsm.match("11").tag).toBe("Left");
  });

  it("offers enumeration items in a combo box", () => {
    const f = Field(false, migrateField("E"), "E", "One",
      EnumDef([EnumItem("Red", Nothing, Nothing), EnumItem("Green", Just("go"), Nothing)]));
    const g = fieldElement(false, f);
    const combo = at(g, "_2");
    expect(combo.tag).toBe("Combo");
    expect(combo._0(null).map((i: any) => i.menuItemValue)).toEqual([ExtText("Red"), ExtText("Green")]);
    const deco = addFieldDecoration(f._fieldType, g);
    expect(deco.tag).toBe("Icon");
    expect(at(deco, "_0")(ExtText("Green"))).toBe("go");
    expect(at(deco, "_0")(ExtText("Red"))).toBe("blank-icon");
  });

  it("focuses on extension values", () => {
    const f = mkField("Count", "ModelInt");
    const [label, g] = fieldElement1(false, f);
    expect(label).toBe("Count");
    expect(g.tag).toBe("Focusing");
    const vals = M.fromList<string, ExtValue>([[f.fieldId, ExtInt(2)]]);
    expect(at(g, "_0").get(vals)).toEqual(ExtInt(2));
  });
});

describe("fieldDialog", () => {
  const d = fieldDialog();
  const prismaticG = at(d.dialogGadget, "_1");
  const check = (fs: readonly Field[]) => at(prismaticG, "_2", "_0")(null, fs, fs);

  it("has the Haskell structure", () => {
    expect(d.dialogTitle).toBe("Fields");
    expect(d.dialogButtons).toEqual({ tag: "OkApplyButton" });
    expect(d.dialogGadget.tag).toBe("Frame");
    expect(prismaticG.tag).toBe("Prismatic");
    expect(at(prismaticG, "_2").tag).toBe("ValidateText");
    expect(at(prismaticG, "_2", "_1").tag).toBe("Table");
  });

  it("adds and removes the blank entry", () => {
    const iso = at(prismaticG, "_1");
    const fs = [mkField("Size", "ModelInt")];
    const withBlank = iso.match(fs).value;
    expect(withBlank.length).toBe(2);
    expect(withBlank[1]._fieldName).toBe(" -?- ");
    expect(review(iso, withBlank)).toEqual(fs);
  });

  it("validates field names", () => {
    expect(check([mkField("Size", "ModelInt")])).toEqual(Nothing);
    expect(check([mkField("Size", "ModelInt"), mkField("Size", "ModelText")])).toEqual(Just("Duplicate name: Size"));
    expect(check([mkField("Name", "ModelText")])).toEqual(Just("Duplicate name: Name"));
    expect(check([mkField("", "ModelText")])).toEqual(Just("Names must not be empty."));
  });

  it("edits a field with a tabbed dialog", () => {
    const sel = at(prismaticG, "_2", "_1", "_2");
    expect(sel.tag).toBe("Just");
    const fd = sel.value(null, mkField("Size", "ModelInt"));
    expect(fd.value.dialogTitle).toBe("Edit data field");
    const union = at(fd.value.dialogGadget, "_0", "_1");
    expect(union.tag).toBe("UnionTab");
    expect(union._0.map((p: any) => p[0])).toEqual(["Built-in", "Deco\nBool", "Deco\nInt", "Deco\nReal", "Enumeration"]);
    expect(tags(fd.value.dialogGadget)).toContain("Built-in");
  });
});

describe("extensionDialog", () => {
  const ft: FieldTable = M.fromList([mkField("Size", "ModelInt"), mkField("Colour", "ModelText")]
    .map((f) => [f.fieldId, f] as [string, Field]));
  const d = extensionDialog(ft, "Box");
  const validator = at(d.dialogGadget, "_0", "_1");

  it("has the variant as title", () => {
    expect(d.dialogTitle).toBe("Box");
    expect(d.dialogGadget.tag).toBe("Accum");
    expect(at(d.dialogGadget, "_0").tag).toBe("Focusing");
    expect(validator.tag).toBe("ValidateText");
  });

  it("validates the extension names", () => {
    const v = (fs: string[]) => validator._0(null, fs, () => fs);
    expect(v(["Size"])).toEqual(Nothing);
    expect(v(["Size", "Size"])).toEqual(Just("Duplicate field: Size"));
    expect(v(["Weight"])).toEqual(Just("Unknown field: Weight"));
    expect(v([""])).toEqual(Just("Names must not be empty."));
  });

  it("maps between field IDs and names", () => {
    const l = at(d.dialogGadget, "_0", "_0");
    const sizeId = migrateField("Size");
    expect(l.get([sizeId])).toEqual(["Size"]);
  });
});

describe("subsetGadget", () => {
  const universe = S.fromList([1, 2, 3, 4, 5]);
  const g = subsetGadget((n: number) => "#" + n, universe);

  it("splits the universe into two columns of check boxes", () => {
    const boxG = at(g, "_0", "_1", "_0");
    expect(boxG.tag).toBe("Box");
    const [col1, col2] = boxG._1[0];
    expect(col1._1.map((p: any) => p[0])).toEqual(["#1", "#2", "#3"]);
    expect(col2._1.map((p: any) => p[0])).toEqual(["#4", "#5"]);
  });

  it("has set all and clear all buttons", () => {
    const buttons = at(g, "_0", "_0");
    expect(buttons.tag).toBe("ButtonBar");
    const [[l1, f1], [l2, f2]] = buttons._0;
    expect([l1, l2]).toEqual(["Set all", "Clear all"]);
    expect(S.toList(f1(S.fromList([2])))).toEqual([1, 2, 3, 4, 5]);
    expect(S.size(f2(universe))).toBe(0);
  });

  it("makes a dialog", () => {
    const d = subsetDialog("Pick", (n: number) => String(n), universe);
    expect(d.dialogTitle).toBe("Pick");
  });
});

describe("expressionEntry", () => {
  const known: FieldTable = M.fromList([mkField("Size", "ModelInt")].map((f) => [f.fieldId, f] as [string, Field]));
  const g = expressionEntry(M.empty<string, Function<null>>(), known);

  it("checks the expression as it is typed", () => {
    expect(g.tag).toBe("ValidateText");
    expect(at(g, "_1").tag).toBe("MemoBox");
    const check = (s: string) => at(g, "_0")(null, s, s);
    expect(check("Size + 1")).toEqual(Nothing);
    expect(check("Size +")).toEqual(Just(
      "unexpected end of input\nexpecting '(', -, date, long name, name, number, string, or white space\n"));
    expect(check("Wibble")).toEqual(Just("Unknown value name: Wibble\n"));
  });
});

describe("reference type dialogs", () => {
  type Thing = { kind: string };
  const cls: Reflective<Thing> = {
    reflectiveName: (a) => a.kind,
    variantUserLabel: defaultVariantUserLabel,
    reflectiveDefaults: [{ kind: "Box" }, { kind: "Arrow" }, { kind: "Note" }],
    reflectiveBuiltIn: () => [],
    reflectiveGet: () => M.empty(),
    reflectiveSet: (_st, a) => a,
    reflectiveBuiltInRefs: mempty_RefTypeTable,
    reflectiveArrows: M.empty(),
  };

  it("lists reference types", () => {
    const d = referenceListDialog(cls);
    expect(d.dialogTitle).toBe("Reference Types");
    const focus = at(d.dialogGadget, "_0", "_1");
    expect(focus.tag).toBe("Focusing");
    const l = focus._0;
    const rows = [["Owns", RefType<Thing>([], [false, true])]];
    expect(l.get(rows).length).toBe(2);
    const withEnvG = focus._1;
    expect(withEnvG.tag).toBe("WithEnv");
    expect(S.toList(withEnvG._0._0(rows))).toEqual(["Owns"]);
  });

  it("checks one-many types", () => {
    const d = referenceTypeDialog(cls);
    const v = at(d.dialogGadget, "_0");
    expect(v.tag).toBe("ValidateText");
    const sets = [[S.fromList(["Box"]), S.fromList(["Box", "Note"])]] as const;
    const oneMany = ["Owns", RefType<Thing>(sets, [true, false])] as const;
    const manyMany = ["Owns", RefType<Thing>(sets, [false, false])] as const;
    expect(v._0(S.empty(), oneMany, () => oneMany)).toEqual(Just("Box appears on both sides of a one-many type."));
    expect(v._0(S.empty(), manyMany, () => manyMany)).toEqual(Nothing);
  });

  it("validates and trims the name", () => {
    const d = referenceTypeDialog(cls);
    const nameForm = at(d.dialogGadget, "_0", "_1", "_1", 0, 0);
    expect(nameForm.tag).toBe("Form");
    const validator = nameForm._1[0][1]._1;
    expect(validator.tag).toBe("ValidateText");
    expect(validator._0(S.empty(), "x", "")).toEqual(Just("Enter a name."));
    expect(validator._0(S.empty(), "x", "y")).toEqual(Nothing);
    // arr (T.dropAround isSpace) <<< simpleTextBox <<< arr hideBlank
    const pipeline = validator._1;
    expect(pipeline.tag).toBe("Dot");
    expect(pipeline._0._0("  ab  ")).toBe("ab");
    expect(pipeline._1._1._0(" -?- ")).toBe("");
    expect(pipeline._1._1._0("abc")).toBe("abc");
  });
});
