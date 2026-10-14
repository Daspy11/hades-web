import { describe, expect, it } from "vitest";
import * as B from "@/lib/Reactive/Banana";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { HistoryItem } from "@/hades/src/Model/GI/PackageTree";
import type { Model } from "@/hades/src/Model/Abstract/PackageTree";
import { fromList, toList } from "@/hades/src/Model/Reflection/NamedRelation";
import {
  MainDescriptor, ModelHistory, cmdOpts, emptyHistory, fixOldRelations, maxUndoLength, processHistoryClick,
  recordUndo, redo, resolveOpenArg, undo,
} from "./ModelMain";

/** Stand-in models: only identity matters to the history functions. */
const m = (n: string): Model<unknown> => ({ modelName: n } as unknown as Model<unknown>);

describe("undo history", () => {
  it("undo and redo move values and texts as the zipper diagram says", () => {
    const h0 = recordUndo(maxUndoLength, HistoryItem(m("v0"), "edit 1"), emptyHistory);
    const h1 = recordUndo(maxUndoLength, HistoryItem(m("v1"), "edit 2"), h0);
    expect(h1.undoLog.map((i) => i.undoText)).toEqual(["edit 2", "edit 1"]);
    const u = undo(m("v2"), h1);
    expect(u.tag).toBe("Just");
    if (u.tag !== "Just") return;
    const [mu, hu] = u.value;
    expect(mu.modelName).toBe("v1");
    expect(hu.undoLog.map((i) => i.undoText)).toEqual(["edit 1"]);
    expect(hu.redoLog.map((i) => [i.undoValue.modelName, i.undoText])).toEqual([["v2", "edit 2"]]);
    const r = redo(mu, hu);
    expect(r.tag === "Just" && r.value[0].modelName).toBe("v2");
    expect(r.tag === "Just" && r.value[1].undoLog.map((i) => i.undoText)).toEqual(["edit 2", "edit 1"]);
    expect(undo(m("x"), emptyHistory)).toEqual(Nothing);
    expect(redo(m("x"), emptyHistory)).toEqual(Nothing);
  });

  it("recordUndo merges repeated texts, clears redo and limits the length", () => {
    const h = ModelHistory([HistoryItem(m("a"), "Modified Foo")], [HistoryItem(m("r"), "x")]);
    const h2 = recordUndo(5, HistoryItem(m("b"), "Modified Foo"), h);
    expect(h2.undoLog.map((i) => i.undoValue.modelName)).toEqual(["a"]);
    expect(h2.redoLog).toEqual([]);
    let hh: ModelHistory<unknown> = emptyHistory;
    for (let i = 0; i < 10; i++) hh = recordUndo(3, HistoryItem(m(String(i)), "t" + i), hh);
    expect(hh.undoLog.map((i) => i.undoText)).toEqual(["t9", "t8", "t7"]);
  });

  it("processHistoryClick undoes several steps at once, and nothing if there are too few", () => {
    const h = ModelHistory([HistoryItem(m("v2"), "e3"), HistoryItem(m("v1"), "e2"), HistoryItem(m("v0"), "e1")], []);
    const results: string[] = [];
    let fireUndo: (n: number) => void = () => {};
    B.actuate(B.compile(() => {
      const [undoE, fu] = B.newEvent<number>();
      fireUndo = fu;
      const out = processHistoryClick(undoE, B.never(), B.pureB(m("v3")), B.pureB(h));
      B.reactimate(B.mapE(([mm, hh]) => () => {
        results.push(mm.modelName + ":" + hh.redoLog.map((i) => i.undoValue.modelName).join(","));
      }, out));
    }));
    fireUndo(2);
    fireUndo(4);
    expect(results).toEqual(["v1:v2,v3"]);
  });
});

describe("fixOldRelations", () => {
  it("renames the old arrow relations", () => {
    const rels = fromList<string>([["a", [["b", "Arrow From"], ["c", "Hazard arrow in"], ["d", "Other"]]]]);
    const model = { modelRelations: rels } as unknown as Model<unknown>;
    const fixed = fixOldRelations(null, model);
    const names = toList(fixed.modelRelations).flatMap(([, rs]) => rs.map(([, r]) => r)).sort();
    expect(names).toContain("Arrow Tail");
    expect(names).toContain("Arrow Head");
    expect(names).toContain("Other");
    expect(names).not.toContain("Arrow From");
  });
});

describe("command line (page URL)", () => {
  const desc = MainDescriptor<unknown>("dsm", "DSM", "dsm", () => "", [], () => {},
    "/src/dsm/share/documentation", Just("/src/dsm/share/examples"));
  it("reads ?open and resolves example names to bundled files", () => {
    expect(cmdOpts("?open=2%20FMEA").fileToLoad).toEqual(Just("2 FMEA"));
    expect(cmdOpts("").fileToLoad).toEqual(Nothing);
    const p = resolveOpenArg(desc, "2 FMEA");
    expect(p.tag === "Just" && p.value.startsWith("/builtin/")).toBe(true);
    expect(resolveOpenArg(desc, "no such example")).toEqual(Nothing);
    expect(resolveOpenArg(desc, "/builtin/x.dsm")).toEqual(Just("/builtin/x.dsm"));
  });
});
