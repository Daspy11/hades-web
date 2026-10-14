import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import { JSON_Model } from "@/hades/src/Model/Abstract/PackageTree";
import {
  type SafetyModel, JSON_SafetyModel, entityIcon, eq_SafetyModel, safetyModelClass,
} from "./SafetyCase";

const examplesDir = path.resolve(__dirname, "../share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .sort()
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

const modelJ = JSON_Model<SafetyModel>(safetyModelClass);

describe("DSM.SafetyCase", () => {
  it("has the four example models", () => {
    expect(examples.map(([f]) => f)).toEqual([
      "1 Quick Guide to the DSM.dsm", "2 FMEA.dsm", "3 Managing Risks.dsm", "4 Managing Hazards.dsm",
    ]);
  });

  it.each(examples.map(([f]) => [f]))("loads %s as a SafetyModel and writes it back", (f) => {
    const json = examples.find(([n]) => n === f)![1];
    const model = modelJ.parseJSON(json);
    expect(M.size(model.modelContents)).toBeGreaterThan(0);
    for (const e of M.elems(model.modelContents)) expect(typeof entityIcon(e)).toBe("string");
    const out = JSON.parse(JSON.stringify(modelJ.toJSON(model)));
    if (f.startsWith("1 ") || f.startsWith("2 ")) {
      // Current-format files are written back identically.
      expect(out).toEqual(json);
    }
    // Old-format files (3, 4) are migrated on reading (matrices, bow tie appearances); the
    // migrated JSON is stable.
    const model2 = modelJ.parseJSON(out);
    expect(JSON.parse(JSON.stringify(modelJ.toJSON(model2)))).toEqual(out);
    for (const [k, e] of M.toList(model.modelContents)) {
      const e2 = M.lookup(k, model2.modelContents);
      expect(e2.tag).toBe("Just");
      if (e2.tag === "Just") expect(eq_SafetyModel(e._entityContents, e2.value._entityContents)).toBe(true);
    }
  });

  it("every entity of the examples round-trips through JSON_SafetyModel", () => {
    for (const [, json] of examples.slice(0, 2)) {
      const ents = json.modelContents as any[];
      expect(ents.length).toBeGreaterThan(10);
      for (const ent of ents) {
        const v = JSON_SafetyModel.parseJSON(ent.contents);
        expect(JSON.parse(JSON.stringify(JSON_SafetyModel.toJSON(v)))).toEqual(ent.contents);
      }
    }
  });

  it("builds the reflective defaults without recursion", () => {
    const vs = safetyModelClass.reflectiveDefaults.map((v) => safetyModelClass.reflectiveName(v));
    expect(vs).toContain("GSN Diagram");
    expect(vs).toContain("Bow Tie Diagram");
    expect(vs).toContain("Evidence");
    expect(safetyModelClass.variantUserLabel("Bow Tie Event")).toBe("Event");
  });
});
