import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import { equals } from "@/lib/Data/Ord";
import * as NR from "./NamedRelation";

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

describe("NamedRelation", () => {
  const r1 = NR.insert("b", "c", "R2", NR.insert("a", "b", "R1", NR.empty<string>()));

  it("stores associations in both directions", () => {
    expect(NR.member("a", "b", "R1", r1)).toBe(true);
    expect(NR.member("b", "a", "R1", r1)).toBe(true);
    expect(NR.member("a", "b", "R2", r1)).toBe(false);
    expect(S.toList(NR.relation("b", "R1", r1))).toEqual(["a"]);
    expect(S.toList(NR.relation("b", "R2", r1))).toEqual(["c"]);
    expect(S.toList(NR.relations("b", r1))).toEqual([["a", "R1"], ["c", "R2"]]);
    expect(NR.check(r1)).toEqual({ tag: "Right", value: null });
  });

  it("toList omits the converse and fromList restores it", () => {
    const lst = NR.toList(r1);
    expect(lst).toEqual([
      ["a", [["b", "R1"]]],
      ["b", [["c", "R2"]]],
      ["c", []],
    ]);
    expect(equals(NR.fromList(lst), r1)).toBe(true);
  });

  it("deletes associations", () => {
    const r2 = NR.delete_("b", "a", "R1", r1);
    expect(NR.member("a", "b", "R1", r2)).toBe(false);
    expect(NR.toList(r2)).toEqual([["b", [["c", "R2"]]], ["c", []]]);
    expect(NR.toList(NR.deleteAll("b", r1))).toEqual([]);
    expect(NR.toList(NR.deleteRelation("b", "R2", r1))).toEqual([["a", [["b", "R1"]]], ["b", []]]);
    // Deleting something absent is a no-op.
    expect(equals(NR.delete_("a", "c", "R1", r1), r1)).toBe(true);
    expect(equals(NR.delete_("a", "b", "R1", r1), r1)).toBe(false);
  });

  it("union, intersection and rename", () => {
    const r3 = NR.insert("a", "c", "R3", NR.empty<string>());
    const u = NR.union(r1, r3);
    expect(NR.member("c", "a", "R3", u)).toBe(true);
    expect(NR.member("c", "b", "R2", u)).toBe(true);
    expect(NR.toList(NR.intersection(u, r3))).toEqual([["a", [["c", "R3"]]], ["c", []]]);
    // Keys present in both but with no common associations are removed by "clean".
    expect(NR.toList(NR.intersection(r1, r3))).toEqual([]);
    const renamed = NR.renameRelation("R1", "X", r1);
    expect(NR.member("b", "a", "X", renamed)).toBe(true);
    expect(NR.member("b", "a", "R1", renamed)).toBe(false);
  });

  it("check reports asymmetric relations", () => {
    // The constructor is private, so build an asymmetric value directly.
    const bad: NR.NamedRelation<string> = {
      _0: M.fromList([["a", S.fromList<[string, string]>([["b", "R"]])]]),
    };
    expect(NR.check(bad)).toEqual({ tag: "Left", value: "a >-R->b has no converse." });
    expect(NR.check(bad, (x) => JSON.stringify(x))).toEqual({ tag: "Left", value: "\"a\" >-R->\"b\" has no converse." });
  });

  it("round-trips modelRelations in the example files", () => {
    const c = NR.JSON_NamedRelation(J.uuidJ);
    for (const [name, model] of examples) {
      const v = model.modelRelations as J.Value;
      const r = c.parseJSON(v);
      expect(c.toJSON(r), name).toEqual(v);
      expect(NR.check(r), name).toEqual({ tag: "Right", value: null });
    }
  });
});
