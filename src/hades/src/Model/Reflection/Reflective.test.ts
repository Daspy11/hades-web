import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { sRGB24 } from "@/lib/Data/Colour";
import type { StateCell } from "@/lib/Control/Lens";
import {
  BuiltInDef, DecoBool, DecoBoolDef, DecoIntDef, DecoRange, DecoRealDef, EnumDef, EnumItem, migrateField,
} from "./Types";
import { ExtBool, ExtInt, ExtReal, ExtText, _ExtInt, _ExtText, type ExtValue, type ExtensionValues } from "./Values";
import { mkManyToMany, mkOneToMany, mempty_RefTypeTable } from "./References";
import {
  defaultVariantUserLabel, extract, reflection, reflectiveNames, valueFormat, valueReferences,
  type Reflective,
} from "./Reflective";

interface Thing {
  readonly kind: "Box" | "Arrow";
  readonly name: string;
  readonly size: number;
}

const nameField = migrateField("Name");
const sizeField = migrateField("Size");

const Reflective_Thing: Reflective<Thing> = {
  reflectiveName: (t) => t.kind,
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [{ kind: "Box", name: "", size: 0 }, { kind: "Arrow", name: "", size: 0 }],
  reflectiveBuiltIn: () => [nameField, sizeField],
  reflectiveGet: (t) => M.fromList<string, ExtValue>([[nameField, ExtText(t.name)], [sizeField, ExtInt(t.size)]]),
  reflectiveSet(st: StateCell<ExtensionValues>, t: Thing): Thing {
    const name = extract(st, t.name, _ExtText, nameField);
    const size = extract(st, t.size, _ExtInt, sizeField);
    return { ...t, name, size };
  },
  reflectiveBuiltInRefs: mkOneToMany("Arrow Tail", ["Box"], ["Arrow"]),
  reflectiveArrows: M.fromList([["Arrow", ["Arrow Tail", "Arrow Head"] as const]]),
};

describe("Reflective", () => {
  it("reflectiveNames and reflection", () => {
    expect(reflectiveNames(Reflective_Thing)).toEqual(["Box", "Arrow"]);
    const ext = (v: string) => (v === "Box" ? [migrateField("Colour")] : []);
    expect(reflection(Reflective_Thing, ext, { kind: "Box", name: "b", size: 1 }))
      .toEqual([nameField, sizeField, migrateField("Colour")]);
    expect(Reflective_Thing.variantUserLabel("Box")).toBe("Box");
  });

  it("reflectiveSet extracts the built-in fields and leaves the rest", () => {
    const other = migrateField("Other");
    const st = {
      state: M.fromList<string, ExtValue>([[nameField, ExtText("New")], [sizeField, ExtText("wrong type")], [other, ExtBool(true)]]),
    };
    const t = Reflective_Thing.reflectiveSet(st, { kind: "Box", name: "Old", size: 7 });
    expect(t).toEqual({ kind: "Box", name: "New", size: 7 });
    expect(M.keys(st.state)).toEqual([other]);
  });

  it("valueReferences", () => {
    const tbl = mkManyToMany("Link", ["Box"], ["Box"]);
    const refs = valueReferences(Reflective_Thing, tbl, { kind: "Box", name: "", size: 0 });
    expect(refs.map(([r, single, vs]) => [r, single, S.toList(vs)])).toEqual([
      ["Arrow Tail", false, ["Arrow"]],
      ["Link", false, ["Box"]],
    ]);
    const refs2 = valueReferences(Reflective_Thing, mempty_RefTypeTable, { kind: "Arrow", name: "", size: 0 });
    expect(refs2.map(([r, single, vs]) => [r, single, S.toList(vs)])).toEqual([["Arrow Tail", true, ["Box"]]]);
  });

  it("valueFormat", () => {
    const red = sRGB24(255, 0, 0), green = sRGB24(0, 255, 0);
    const boolDef = DecoBoolDef(DecoBool(Just(["no", "yes"] as const), Just([red, green] as const)));
    expect(equals(valueFormat(boolDef, ExtBool(true)), [Just("yes"), Just(green)])).toBe(true);
    expect(equals(valueFormat(boolDef, ExtBool(false)), [Just("no"), Just(red)])).toBe(true);
    expect(valueFormat(boolDef, ExtInt(1))).toEqual([Nothing, Nothing]);
    const intDef = DecoIntDef(DecoRange([Nothing, Nothing], [[[Nothing, Just(2)], [Just("low"), Nothing]]]));
    expect(valueFormat(intDef, ExtInt(1))).toEqual([Just("low"), Nothing]);
    // Banker's rounding, as Haskell's "round": 2.5 rounds to 2.
    expect(valueFormat(intDef, ExtReal(2.5))).toEqual([Just("low"), Nothing]);
    expect(valueFormat(intDef, ExtReal(3.5))).toEqual([Nothing, Nothing]);
    const realDef = DecoRealDef(DecoRange([Nothing, Nothing], [[[Just(0.5), Nothing], [Nothing, Just(red)]]]));
    expect(equals(valueFormat(realDef, ExtReal(0.75)), [Nothing, Just(red)])).toBe(true);
    expect(equals(valueFormat(realDef, ExtInt(1)), [Nothing, Just(red)])).toBe(true);
    const enumDef = EnumDef([EnumItem("A", Just("a-icon"), Nothing), EnumItem("B", Nothing, Just(green))]);
    expect(equals(valueFormat(enumDef, ExtText("B")), [Nothing, Just(green)])).toBe(true);
    expect(valueFormat(enumDef, ExtText("C"))).toEqual([Nothing, Nothing]);
    expect(valueFormat(BuiltInDef("ModelText"), ExtText("A"))).toEqual([Nothing, Nothing]);
  });
});
