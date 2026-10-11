import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import { equals } from "@/lib/Data/Ord";
import { review, view } from "@/lib/Control/Lens";
import {
  JSON_RefType, JSON_RefTypeTable, RefType, append_RefType, append_RefTypeTable, arrowRelations,
  mempty_RefType, mempty_RefTypeTable, mkManyToMany, mkOneToMany, mkOneToOne, refTypeCoerce,
  refTypeOtherSide, refTypeReverse, refTypeTableContents, refTypeTableToList,
} from "./References";

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

describe("RefType", () => {
  it("round-trips modelRefTypes in the example files", () => {
    for (const [name, model] of examples) {
      const v = model.modelRefTypes as J.Value;
      const t = JSON_RefTypeTable.parseJSON(v);
      expect(JSON_RefTypeTable.toJSON(t), name).toEqual(v);
    }
  });

  it("encodes like aeson", () => {
    const t = RefType([[S.fromList(["Strategy", "Goal"]), S.fromList(["GSN Diagram"])]], [false, true]);
    expect(JSON_RefType.toJSON(t)).toEqual({ sets: [[["Goal", "Strategy"], ["GSN Diagram"]]], singles: [false, true] });
  });

  it("monoid", () => {
    const t1 = RefType([[S.fromList(["A"]), S.fromList(["B"])]], [true, false]);
    const t2 = RefType([[S.fromList(["C"]), S.fromList(["D"])]], [true, true]);
    const t3 = append_RefType(t1, t2);
    expect(t3._refTypeSingles).toEqual([true, false]);
    expect(t3._refTypeSets.length).toBe(2);
    expect(equals(append_RefType(mempty_RefType, t1), t1)).toBe(true);
    expect(equals(refTypeReverse(refTypeReverse(t3)), t3)).toBe(true);
    expect(equals(refTypeCoerce(t3), t3)).toBe(true);
  });

  it("refTypeOtherSide", () => {
    // One "Arrow" points to one "Box"; a "Box" can have many arrows.
    const t = RefType([[S.fromList(["Arrow"]), S.fromList(["Box"])]], [false, true]);
    const [s1, vs1] = refTypeOtherSide("Arrow", t);
    expect([s1, S.toList(vs1)]).toEqual([true, ["Box"]]);
    const [s2, vs2] = refTypeOtherSide("Box", t);
    expect([s2, S.toList(vs2)]).toEqual([false, ["Arrow"]]);
    const [s3, vs3] = refTypeOtherSide("Other", t);
    expect([s3, S.toList(vs3)]).toEqual([true, []]);
    // Many to many, same variant on both sides.
    const g = RefType([[S.fromList(["Goal"]), S.fromList(["Goal", "Strategy"])]], [false, false]);
    const [s4, vs4] = refTypeOtherSide("Goal", g);
    expect([s4, S.toList(vs4)]).toEqual([false, ["Goal", "Strategy"]]);
  });
});

describe("RefTypeTable", () => {
  it("monoid merges entries with the RefType monoid", () => {
    const t1 = mkOneToOne("R", ["A"], ["B"]);
    const t2 = mkManyToMany("R", ["C"], ["D"]);
    const t3 = mkOneToMany("S", ["E"], ["F"]);
    const u = append_RefTypeTable(append_RefTypeTable(t1, t2), t3);
    const lst = refTypeTableToList(u);
    expect(lst.map(([r]) => r)).toEqual(["R", "S"]);
    expect(lst[0][1]._refTypeSingles).toEqual([false, false]);
    expect(lst[1][1]._refTypeSingles).toEqual([true, false]);
    expect(equals(append_RefTypeTable(mempty_RefTypeTable, u), u)).toBe(true);
    expect(equals(review(refTypeTableContents(), view(refTypeTableContents(), u)), u)).toBe(true);
  });

  it("arrowRelations", () => {
    const t = arrowRelations("Arrow", ["Box", "Circle"], ["Box"]);
    expect(JSON_RefTypeTable.toJSON(t)).toEqual({
      "Arrow Tail": { sets: [[["Box", "Circle"], ["Arrow"]]], singles: [true, false] },
      "Arrow Head": { sets: [[["Box"], ["Arrow"]]], singles: [true, false] },
    });
    expect(M.keys(t._0)).toEqual(["Arrow Head", "Arrow Tail"]);
  });
});
