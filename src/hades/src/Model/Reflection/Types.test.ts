import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { sRGB24 } from "@/lib/Data/Colour";
import { showDouble, showInt } from "@/lib/Prelude";
import { preview, review, toListOf, view, set } from "@/lib/Control/Lens";
import {
  BuiltInDef, DecoBool, DecoBoolDef, DecoIntDef, DecoRange, DecoRealDef, EnumDef, EnumItem, Field,
  JSON_Cardinality, JSON_Field, JSON_Multiplicity, JSON_TypeDef, builtInFields, builtInName,
  cardinalityText, fieldNameIso, fieldName, inRange, migrateField, migrateField1, rangeDefault,
  rangeMap, rangePrism, show_DecoType, show_Field, typeDescription, validRange, withBuiltIn,
  type TypeDef,
} from "./Types";

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

describe("Ranges", () => {
  it("validRange, inRange, rangeDefault, rangeMap", () => {
    expect(validRange([Just(1), Just(2)])).toBe(true);
    expect(validRange([Just(3), Just(2)])).toBe(false);
    expect(validRange([Nothing, Just(2)])).toBe(true);
    expect(inRange([Just(1), Nothing], 5)).toBe(true);
    expect(inRange([Just(1), Just(4)], 5)).toBe(false);
    expect(inRange([Just(1), Just(4)], 1)).toBe(true);
    expect(rangeDefault([Just(1), Just(4)], 7)).toBe(1);
    expect(rangeDefault([Nothing, Just(4)], 7)).toBe(4);
    expect(rangeDefault([Just(1), Just(4)], 3)).toBe(3);
    const rm = [[[Nothing, Just(0)], "neg"], [[Just(0), Just(10)], "small"], [[Just(5), Nothing], "big"]] as const;
    expect(rangeMap(rm, -3)).toEqual(Just("neg"));
    expect(rangeMap(rm, 0)).toEqual(Just("neg"));
    expect(rangeMap(rm, 7)).toEqual(Just("small"));
    expect(rangeMap(rm, 70)).toEqual(Just("big"));
    expect(preview(rangePrism([Just(1), Just(4)]), 5)).toEqual(Nothing);
    expect(preview(rangePrism([Just(1), Just(4)]), 2)).toEqual(Just(2));
  });
});

describe("Fields", () => {
  it("migrateField matches the Haskell UUID V5 ids", () => {
    // Field ids found in the example models.
    expect(migrateField("Description")).toBe("e386bb76-c5dd-5182-b2c8-f76ca3de8f8c");
    expect(migrateField("Effectiveness")).toBe("0252690f-fdf0-5438-8b22-0f077becf9b6");
    expect(migrateField1("E386BB76-c5dd-5182-b2c8-f76ca3de8f8c")).toBe("e386bb76-c5dd-5182-b2c8-f76ca3de8f8c");
    expect(migrateField1("Description")).toBe("e386bb76-c5dd-5182-b2c8-f76ca3de8f8c");
    // All the fields in the first example were migrated from old-style named fields.
    for (const f of examples[0][1].modelFields) expect(migrateField(f.name)).toBe(f.id);
  });

  it("builtInFields", () => {
    expect(M.size(builtInFields)).toBe(8);
    const card = M.find(builtInFields, migrateField("Cardinality"));
    expect(card._fieldType).toEqual(EnumDef([
      EnumItem("One", Nothing, Nothing), EnumItem("Optional", Nothing, Nothing),
      EnumItem("0-n", Nothing, Nothing), EnumItem("1-n", Nothing, Nothing),
    ]));
    const extra = Field(false, migrateField("Name"), "Name", "Optional", BuiltInDef("ModelInt"));
    const tbl = withBuiltIn(M.fromList([[extra.fieldId, extra]]));
    expect(M.find(tbl, extra.fieldId)._fieldType).toEqual(BuiltInDef("ModelText"));
  });

  it("fieldNameIso drops unknown entries", () => {
    const i = fieldNameIso(builtInFields);
    expect(view(i, [migrateField("Hidden"), migrateField("Nope")])).toEqual(["Hidden"]);
    expect(review(i, ["Count", "Nope"])).toEqual([migrateField("Count")]);
  });

  it("show_Field", () => {
    const f = Field(false, migrateField("Name"), "Name", "One", BuiltInDef("ModelText"));
    expect(show_Field(f)).toBe('Field 0bc03673-bff6-57c6-a144-76d9b916fccb "Name" One "Text"');
    expect(show_Field({ ...f, fieldReadOnly: true })).toBe("Field (RO) ");
    expect(view(fieldName, set(fieldName, "X", f))).toBe("X");
  });

  it("parses fields without ids by migrating the name", () => {
    const f = JSON_Field.parseJSON({ name: "  Title ", multi: "One", type: { kind: "built-in", type: "Text" } });
    expect(f).toEqual(Field(false, migrateField("Title"), "Title", "One", BuiltInDef("ModelText")));
    expect(() => JSON_Multiplicity.parseJSON("Many")).toThrow("Multiplicity not recognised.");
  });

  it("round-trips the modelFields of the example files", () => {
    for (const [name, model] of examples) {
      const fields = model.modelFields;
      if (Array.isArray(fields)) {
        // Current format: a list of fields with ids.
        for (const fv of fields) {
          expect(JSON_Field.toJSON(JSON_Field.parseJSON(fv)), name).toEqual(fv);
        }
      } else {
        // Old format: a map from name to field without "id"; the id is migrated from the name.
        for (const fv of Object.values(fields) as J.JSONObject[]) {
          const f = JSON_Field.parseJSON(fv);
          expect(f.fieldId).toBe(migrateField((fv.name as string).trim()));
          expect(JSON_Field.toJSON(f), name).toEqual({ ...fv, id: f.fieldId });
        }
      }
    }
  });
});

describe("TypeDef", () => {
  const red = sRGB24(255, 0, 0), green = sRGB24(0, 255, 0);
  const decos: TypeDef[] = [
    DecoBoolDef(DecoBool(Just(["cross", "tick"] as const), Just([red, green] as const))),
    DecoBoolDef(DecoBool(Nothing, Nothing)),
    DecoIntDef(DecoRange([Just(0), Nothing], [
      [[Nothing, Just(3)], [Just("low"), Nothing]],
      [[Just(4), Just(10)], [Nothing, Just(red)]],
    ])),
    DecoRealDef(DecoRange([Nothing, Nothing], [[[Just(0.5), Just(1.5)], [Nothing, Nothing]]])),
  ];

  it("encodes like aeson", () => {
    expect(JSON_TypeDef.toJSON(BuiltInDef("ModelURL"))).toEqual({ kind: "built-in", type: "URL" });
    expect(JSON_TypeDef.toJSON(decos[0])).toEqual({
      kind: "deco-bool", icons: ["cross", "tick"], colours: ["#ff0000", "#00ff00"],
    });
    expect(JSON_TypeDef.toJSON(decos[1])).toEqual({ kind: "deco-bool", icons: null, colours: null });
    expect(JSON_TypeDef.toJSON(decos[2])).toEqual({
      kind: "deco-int",
      range: [0, null],
      map: [[[null, 3], ["low", null]], [[4, 10], [null, "#ff0000"]]],
    });
    expect(JSON_TypeDef.toJSON(EnumDef([EnumItem("A", Just("icon"), Just(green))]))).toEqual({
      kind: "enum", values: [{ name: "A", icon: "icon", colour: "#00ff00" }],
    });
  });

  it("round-trips decorated types", () => {
    for (const t of decos) {
      const v = JSON_TypeDef.toJSON(t);
      expect(JSON_TypeDef.toJSON(JSON_TypeDef.parseJSON(v))).toEqual(v);
    }
  });

  it("reports unknown kinds", () => {
    expect(() => JSON_TypeDef.parseJSON({ kind: "built-in", type: "Bogus" })).toThrow('Unknown built-in type: "Bogus"');
    expect(() => JSON_TypeDef.parseJSON({ kind: "struct" })).toThrow('Unrecognised kind of type: "struct"');
  });

  it("show_DecoType", () => {
    const d0 = decos[0];
    if (d0.tag !== "DecoBoolDef") throw new Error("impossible");
    expect(show_DecoType(String, d0._0)).toBe("DecoBool (False = (cross, #ff0000), True = (tick, #00ff00))");
    const d2 = decos[2];
    if (d2.tag !== "DecoIntDef") throw new Error("impossible");
    expect(show_DecoType(showInt, d2._0)).toBe("DecoRange (0 to -): [(- to 3) -> (low, -), (4 to 10) -> (-, #ff0000)]");
    const d3 = decos[3];
    if (d3.tag !== "DecoRealDef") throw new Error("impossible");
    expect(show_DecoType(showDouble, d3._0)).toBe("DecoRange (- to -): [(0.5 to 1.5) -> (-, -)]");
  });

  it("names and descriptions", () => {
    expect(builtInName("ModelNote")).toBe("Note");
    expect(typeDescription(BuiltInDef("ModelDate"))).toBe("Date");
    expect(typeDescription(decos[2])).toBe("Decorated Int");
    expect(toListOf(cardinalityText, "0-n")).toEqual(["CardinalityMany"]);
    expect(review(cardinalityText, "CardinalityMany1")).toBe("1-n");
    expect(JSON_Cardinality.parseJSON("Optional")).toBe("CardinalityOpt");
    expect(() => JSON_Cardinality.parseJSON("Two")).toThrow('Not a GSN Edge Cardinality Type: "Two"');
  });
});
