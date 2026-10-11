import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { compare, equals } from "@/lib/Data/Ord";
import { preview, review, set, view } from "@/lib/Control/Lens";
import { BuiltInDef, DecoBool, DecoBoolDef, EnumDef, Field, migrateField } from "./Types";
import {
  ExtBool, ExtDate, ExtInt, ExtNone, ExtReal, ExtText, JSONKey_Variant, JSON_ExtValue,
  JSON_ExtensionValues, Variant, _ExtInt, _ExtText, compare_ExtValue, displayValue, extValue,
  validateExtension, validateField, validateMulti, valueMaybe, valueSearch, valueTypeName,
  variantCoerce, variantName, type ExtValue,
} from "./Values";

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

describe("ExtValue JSON", () => {
  it("encodes like aeson", () => {
    expect(JSON_ExtValue.toJSON(ExtNone)).toEqual({ type: "none" });
    expect(JSON_ExtValue.toJSON(ExtBool(true))).toEqual({ type: "bool", value: true });
    expect(JSON_ExtValue.toJSON(ExtInt(3))).toEqual({ type: "int", value: 3 });
    expect(JSON_ExtValue.toJSON(ExtReal(2.5))).toEqual({ type: "real", value: 2.5 });
    expect(JSON_ExtValue.toJSON(ExtText("x"))).toEqual({ type: "text", value: "x" });
    expect(JSON_ExtValue.toJSON(ExtDate("2020-01-02"))).toEqual({ type: "date", value: "2020-01-02" });
    for (const v of [ExtNone, ExtBool(false), ExtInt(-7), ExtReal(1e-3), ExtText(""), ExtDate("1999-12-31")]) {
      expect(equals(JSON_ExtValue.parseJSON(JSON_ExtValue.toJSON(v)), v)).toBe(true);
    }
    expect(() => JSON_ExtValue.parseJSON({ type: "blob" })).toThrow("Unrecognised Extension Value type: blob");
  });

  it("round-trips entity extension values in the example files", () => {
    let n = 0;
    for (const [name, model] of examples) {
      for (const ent of model.modelContents) {
        const exts = ent.extensions as J.JSONObject;
        const keys = Object.keys(exts);
        if (keys.every(isUUID)) {
          expect(JSON_ExtensionValues.toJSON(JSON_ExtensionValues.parseJSON(exts)), name).toEqual(exts);
        } else {
          // Old models key extension values by field name; the keys are migrated by PackageTree.
          for (const k of keys) {
            expect(JSON_ExtValue.toJSON(JSON_ExtValue.parseJSON(exts[k])), name).toEqual(exts[k]);
          }
        }
        n += keys.length;
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("round-trips lookup tables (Map (ExtValue, ExtValue) ExtValue) in the example files", () => {
    // The pairs are written in key order, which uses the custom Ord ExtValue (natural ordering).
    const codec = J.mapPairsJ(J.tuple2J(JSON_ExtValue, JSON_ExtValue), JSON_ExtValue);
    let n = 0;
    for (const [name, model] of examples) {
      for (const ent of model.modelContents) {
        const values = ent.contents?.values;
        if (!Array.isArray(values)) continue;
        expect(codec.toJSON(codec.parseJSON(values)), name).toEqual(values);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it("round-trips modelExtensions (Map (Variant v) [FieldId])", () => {
    const codec = J.mapJ(JSONKey_Variant, J.listJ(J.uuidJ));
    for (const [name, model] of examples) {
      const exts = model.modelExtensions as J.JSONObject;
      if (!Object.values(exts).every((fs) => (fs as string[]).every(isUUID))) continue;
      expect(codec.toJSON(codec.parseJSON(exts)), name).toEqual(exts);
    }
  });
});

describe("ExtValue ordering", () => {
  it("follows the custom Ord instance", () => {
    expect(compare_ExtValue(ExtInt(2), ExtReal(2.5))).toBe(-1);
    expect(compare_ExtValue(ExtReal(2), ExtInt(2))).toBe(0);
    expect(compare_ExtValue(ExtText("item 10"), ExtText("Item 9"))).toBe(1);
    expect(compare_ExtValue(ExtBool(false), ExtBool(true))).toBe(-1);
    expect(compare_ExtValue(ExtDate("2020-01-02"), ExtDate("2019-12-31"))).toBe(1);
    // Different types compare by their display text.
    expect(compare_ExtValue(ExtNone, ExtInt(1))).toBe(-1);
    expect(compare_ExtValue(ExtBool(true), ExtText("Maybe"))).toBe(1);
  });

  it("is used by the generic compare and equals", () => {
    expect(compare(ExtText("a2"), ExtText("a10"))).toBe(-1);
    expect(compare(Just(ExtInt(1)), Just(ExtReal(0.5)))).toBe(1);
    expect(compare(Nothing, Just(ExtNone))).toBe(-1);
    // Eq is derived (structural), unlike Ord.
    expect(equals(ExtInt(2), ExtReal(2))).toBe(false);
    expect(equals(ExtInt(2), ExtInt(2))).toBe(true);
    const m = M.fromList([[ExtText("x10"), 1], [ExtText("x9"), 2]]);
    expect(M.keys(m).map(displayValue)).toEqual(["x9", "x10"]);
  });
});

describe("ExtValue functions", () => {
  it("displayValue and valueTypeName", () => {
    expect(displayValue(ExtNone)).toBe("");
    expect(displayValue(ExtBool(true))).toBe("Yes");
    expect(displayValue(ExtBool(false))).toBe("No");
    expect(displayValue(ExtInt(42))).toBe("42");
    expect(displayValue(ExtReal(3))).toBe("3.0");
    expect(displayValue(ExtReal(0.05))).toBe("5.0e-2");
    expect(displayValue(ExtDate("2019-07-09"))).toBe("09 Jul 19");
    expect(valueTypeName(ExtReal(1))).toBe("Real");
  });

  it("prisms, valueMaybe and extValue", () => {
    expect(preview(_ExtInt, ExtInt(3))).toEqual(Just(3));
    expect(preview(_ExtInt, ExtText("3"))).toEqual(Nothing);
    const vm = valueMaybe(_ExtText);
    expect(view(vm, ExtText("a"))).toEqual(Just("a"));
    expect(set(vm, Nothing, ExtText("a"))).toBe(ExtNone);
    expect(set(vm, Nothing, ExtInt(1))).toEqual(ExtInt(1));
    expect(equals(set(vm, Just("b"), ExtInt(1)), ExtText("b"))).toBe(true);
    const k = migrateField("Field");
    const l = extValue(k);
    const m1 = set(l, ExtInt(5), M.empty<string, ExtValue>());
    expect(M.size(m1)).toBe(1);
    expect(equals(view(l, m1), ExtInt(5))).toBe(true);
    expect(M.size(set(l, ExtNone, m1))).toBe(0);
    expect(view(l, M.empty<string, ExtValue>())).toBe(ExtNone);
  });

  it("validation", () => {
    expect(validateMulti("F", "One", Nothing)).toEqual(["F: Required field is missing."]);
    expect(validateMulti("F", "Optional", Nothing)).toEqual([]);
    expect(validateExtension(BuiltInDef("ModelInt"), ExtInt(1))).toEqual([]);
    expect(validateExtension(BuiltInDef("ModelInt"), ExtText("1"))).toEqual(["Type error: expected Integer, got Text"]);
    expect(validateExtension(DecoBoolDef(DecoBool(Nothing, Nothing)), ExtBool(true))).toEqual([]);
    expect(validateExtension(EnumDef([]), ExtInt(1))).toEqual(["Type error: expected Enumeration, got Integer"]);
    // The Haskell reports valid URI references (sic).
    expect(validateExtension(BuiltInDef("ModelURL"), ExtText("http://example.com/a?b#c")))
      .toEqual(["Invalid URL: http://example.com/a?b#c"]);
    expect(validateExtension(BuiltInDef("ModelURL"), ExtText("not a url"))).toEqual([]);
    expect(validateExtension(BuiltInDef("ModelURL"), ExtText("http://[::1]:80/"))).toEqual(["Invalid URL: http://[::1]:80/"]);
    expect(validateExtension(BuiltInDef("ModelURL"), ExtText("http://[::g]/"))).toEqual([]);
    expect(validateExtension(BuiltInDef("ModelURL"), ExtText("../rel/path%20x"))).toEqual(["Invalid URL: ../rel/path%20x"]);
    expect(validateExtension(BuiltInDef("ModelURL"), ExtText("bad%zz"))).toEqual([]);
    const f = Field(false, migrateField("Count"), "Count", "One", BuiltInDef("ModelInt"));
    expect(validateField(f, M.empty())).toEqual(["Count: Required field is missing."]);
    expect(validateField(f, M.fromList([[f.fieldId, ExtReal(1)]]))).toEqual(["Type error: expected Integer, got Real"]);
  });

  it("valueSearch", () => {
    const a = migrateField("A"), b = migrateField("B");
    const vals = M.fromList<string, ExtValue>([[a, ExtText("Foo bar foo")], [b, ExtInt(1001)]]);
    const res = valueSearch(false, "foo", vals);
    expect(res).toEqual([[a, 8]]);
    const sorted = [...valueSearch(true, "foo", vals)];
    expect(sorted).toEqual([[a, 0], [a, 8]]);
    expect(valueSearch(false, "1", vals)).toEqual([[b, 0], [b, 3]]);
  });

  it("Variant", () => {
    const v = Variant<number>("Goal");
    expect(view(variantName<number>(), v)).toBe("Goal");
    expect(review(variantName<number>(), "Strategy")).toBe("Strategy");
    expect(variantCoerce<number, string>(v)).toBe("Goal");
  });
});
