/**
 * Tests of the demo-webit matrix: `defaultIso`, `arbitraryMatrix`, the forest of lenses built by
 * `demoMatrix`, and `demoMatrixAction` driven on the loopback engine with jQuery, jQuery UI and
 * AppendGrid loaded into the test DOM (as in `Network/Webits/ArrowDialog.test.ts`).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as M from "@/lib/Data/Map";
import * as QC from "@/lib/Test/QuickCheck";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { review, set, view } from "@/lib/Control/Lens";
import { atomicallySync } from "@/lib/Control/Concurrent/STM";
import { start } from "@/lib/Network/JavaScript";
import { getLens } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { newTStateIO } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import { makeElmerEnv, type ElmerEnv } from "@/banana-ui/webits/src/Network/Webits";
import { allIcons, getIconData, scottyIcons } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { arbitraryMatrix, defaultIso, demoMatrix, demoMatrixAction, matrixColumns, type Model } from "./Matrix";
import { demoDefault, demoNum, demoText, type DemoData } from "./Types";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
async function flush(n = 8): Promise<void> {
  for (let k = 0; k < n; k++) await settle();
}

describe("defaultIso", () => {
  it("equates the default with Nothing", () => {
    const i = defaultIso("");
    expect(view(i, Nothing)).toBe("");
    expect(view(i, Just("x"))).toBe("x");
    expect(review(i, "")).toEqual(Nothing);
    expect(review(i, "y")).toEqual(Just("y"));
    // Not quite an Iso: Just d round-trips to Nothing.
    expect(review(i, view(i, Just("")))).toEqual(Nothing);
  });
});

describe("arbitraryMatrix", () => {
  it("makes N rows with sub-row keys taken from the model", () => {
    const [mdl, items] = QC.generateWith(3, 30, arbitraryMatrix(10));
    expect(M.keys(mdl)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(items.map(([k]) => k)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [, ks] of items) {
      expect([...ks].sort((a, b) => a - b)).toEqual(ks);
      expect(ks.every((k) => k >= 0 && k < 10)).toBe(true);
    }
  });
});

describe("demoMatrix", () => {
  it("is an accumulated forest table over lenses into the model", () => {
    const g = demoMatrix([[0, [1, 2]], [3, []]]);
    expect(g.tag).toBe("Accum");
    const ft = (g as any)._0;
    expect(ft.tag).toBe("ForestTable");
    expect(ft._0).toBe(matrixColumns);
    expect(matrixColumns.map(([n, cs]) => [n, cs.map(([h]) => h)])).toEqual([
      ["Group One", ["Text", "Number", "Choice", "Boolean"]],
      ["Group Two", ["Text", "Date", "Icon", "Colour"]],
    ]);
    const forest = ft._1(null);
    expect(forest.map((t: any) => [t.rootLabel[0], t.subForest.map((s: any) => [s.rootLabel[0], s.subForest.length])])).toEqual([
      [0, [[1, 0], [2, 0]]],
      [3, []],
    ]);
    const l = getLens<Model, DemoData>(forest[0].subForest[1].rootLabel[1]);
    const d: DemoData = { ...demoDefault, _demoNum: 9 };
    const m: Model = M.fromList([[2, d]]);
    expect(view(l, m)).toBe(d);
    expect(view(l, M.empty<number, DemoData>())).toBe(demoDefault); // missing rows show the default
    expect(M.toList(set(l, demoDefault, m))).toEqual([]); // the default value deletes the row
  });
});

describe("demoMatrixAction", () => {
  let env: ElmerEnv;
  beforeAll(async () => {
    const load = (rel: string) => new Function(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")).call(globalThis);
    load("../JQuery/external/jquery/jquery.js");
    load("../JQuery/jquery-ui.min.js");
    load("../JS/fancytree/jquery.fancytree-all.min.js");
    load("../JS/AppendGrid.js");
    load("../JS/arrowDialog.js");
    document.body.innerHTML = '<div id="main"></div>';
    const icons = getIconData("/src/lib/GI/Gtk/icons");
    expect(M.size(allIcons(icons))).toBeGreaterThan(100);
    scottyIcons(icons);
    await start(async (eng) => {
      env = await makeElmerEnv("main", icons, eng);
    });
    // jsdom runs inline event handlers in its own global object; give it the same jsb and jQuery.
    (document as any).__jsb = (globalThis as any).jsb;
    (document as any).__jq = (globalThis as any).jQuery;
    const s = document.createElement("script");
    s.textContent = "window.jsb = document.__jsb; window.$ = window.jQuery = document.__jq;";
    document.head.appendChild(s);
  });

  it("shows the rows and writes edits back to the model", async () => {
    const mdl: Model = M.fromList([
      [0, { ...demoDefault, _demoText: "zero", _demoNum: 10 }],
      [1, { ...demoDefault, _demoText: "one", _demoNum: 11 }],
    ]);
    const [modelState, modelWriter] = newTStateIO<boolean, Model>(mdl);
    void demoMatrixAction(env, modelState, modelWriter, [[0, [1]], [1, [0, 1]]]);
    await flush();
    const tbl = document.querySelector("table.matrix")!;
    expect(tbl).not.toBeNull();
    const rows = [...tbl.querySelectorAll("tbody > tr")];
    expect(rows.length).toBe(3);
    // The top level row of key 0: Text (memo), Number, Choice, Boolean; then its first sub-row.
    const num0 = rows[0].querySelector("input[type=text]") as HTMLInputElement;
    expect(num0.value).toBe("10");
    expect(rows[0].textContent).toContain("zero");
    expect(rows[0].textContent).toContain("one"); // its sub-row is key 1
    num0.value = "77";
    num0.dispatchEvent(new Event("change"));
    await flush(12);
    const m1 = atomicallySync(() => modelState.tStateBehaviour());
    expect(view(demoNum, M.findWithDefault(demoDefault, 0, m1))).toBe(77);
    expect(view(demoText, M.findWithDefault(demoDefault, 1, m1))).toBe("one");
  });
});
