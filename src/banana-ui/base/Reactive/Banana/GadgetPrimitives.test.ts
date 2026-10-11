import { describe, expect, test } from "vitest";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { _1, _2, _Left, prism_ } from "@/lib/Control/Lens";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { drawTree } from "@/lib/Data/Tree";
import {
  ButtonBar, CloseButton, DateBox, Dialog, Form, Grid, Intercept, Null, OkApplyButton, OkButton, Prismatic,
  PrismaticGadget, Pure, TextBox, TickBox, UnionTab, arr, constantDialog, disableApply, disableApply1, gAp,
  gDot, gFanout, gFirst, gFmap, gId, gLiftA2, gLoop, gPipe, gProd, gPure, gSecond, promoteDialogSelector,
  showGadget, type Gadget,
} from "./GadgetPrimitives";
import { longDate } from "./Common";

/** Show the gadget as a compact s-expression, for structural assertions. */
function sexp(g: Gadget<any, any, any, any>): string {
  const t = showGadget(g);
  const go = (n: typeof t): string =>
    n.subForest.length === 0 ? n.rootLabel : `(${n.rootLabel} ${n.subForest.map(go).join(" ")})`;
  return go(t);
}

/** Apply a gadget built only from Pure/Null/Dot/Prod to a value, as a semantics check. */
function run(g: Gadget<any, any, any, any>, x: any): any {
  switch (g.tag) {
    case "Null": return x;
    case "Pure": return g._0(x);
    case "Dot": return run(g._0, run(g._1, x));
    case "Prod": return [run(g._0, x[0]), run(g._1, x[1])];
    default: throw new Error("run: unsupported " + g.tag);
  }
}

describe("arrow combinators", () => {
  const inc = arr((x: number) => x + 1);
  const dbl = arr((x: number) => x * 2);

  test("gPipe is right associative composition", () => {
    const g = gPipe(inc, dbl, arr((x: number) => x - 3));
    expect(sexp(g)).toBe("(Dot Pure (Dot Pure Pure))");
    expect(run(g, 5)).toBe(9);
    expect(g.tag === "Dot" && g._1).toBe(inc);
    expect(gPipe(inc)).toBe(inc);
  });

  test("gDot composes right to left", () => {
    expect(run(gDot(inc, dbl), 5)).toBe(11);
  });

  test("gId, gFirst, gSecond use Null", () => {
    expect(gId().tag).toBe("Null");
    expect(sexp(gFirst(inc))).toBe("(Prod Pure Null)");
    expect(sexp(gSecond(inc))).toBe("(Prod Null Pure)");
    expect(run(gFirst(inc), [1, "a"])).toEqual([2, "a"]);
    expect(run(gSecond(inc), ["a", 1])).toEqual(["a", 2]);
  });

  test("gFanout, gProd", () => {
    const g = gFanout(inc, dbl);
    expect(sexp(g)).toBe("(Dot Pure (Prod Pure Pure))");
    expect(run(g, 5)).toEqual([6, 10]);
    expect(run(gProd(inc, dbl), [1, 2])).toEqual([2, 4]);
  });

  test("Functor and Applicative", () => {
    expect(run(gFmap((x: number) => `${x}`, inc), 1)).toBe("2");
    expect(sexp(gFmap((x: number) => x, inc))).toBe("(Dot Pure Pure)");
    expect(run(gPure(42), "ignored")).toBe(42);
    expect(run(gAp(arr((x: number) => (y: number) => x * 100 + y), inc), 3)).toBe(304);
    expect(run(gLiftA2((a: number, b: number) => a - b, dbl, inc), 10)).toBe(9);
  });

  test("gLoop wraps in Loop", () => {
    expect(sexp(gLoop(gId<any, any, [number, number]>()))).toBe("(Loop Null)");
  });
});

describe("showGadget", () => {
  test("labelled containers", () => {
    const textId = prism_((s: string) => s, (s: string) => Just(s));
    const g = Form<null, never, string>("Vertical", [
      ["Name", gDot(Pure((s: string) => (_old: string) => s), TextBox(() => textId))],
      ["Flag", Pure(() => (s: string) => s)],
    ]);
    expect(drawTree(showGadget(g))).toBe(
      ["Form Vertical", "|", "+- Name: Dot", "|  |", "|  +- TextBox", "|  |", "|  `- Pure", "|", "`- Flag: Pure"].join("\n"),
    );
  });

  test("grid cells are labelled (column, row) and zipped", () => {
    const cell = Pure(() => (x: number) => x);
    const g = Grid(["c1", "c2"], ["r1"], [[cell, cell, cell], [cell]]);
    expect(showGadget(g).subForest.map((n) => n.rootLabel)).toEqual(["(c1, r1): Pure", "(c2, r1): Pure"]);
  });

  test("leaf labels", () => {
    expect(showGadget(DateBox(longDate)).rootLabel).toBe('DateBox "%-d %B %Y"');
    expect(showGadget(ButtonBar([["A", (x: number) => x], ["B", (x: number) => x]])).rootLabel).toBe("Buttons A, B");
    expect(showGadget(Intercept(true, constantDialog(Dialog("d", OkButton, TickBox())), TickBox())).rootLabel)
      .toBe("Intercept single-click ");
    expect(showGadget(UnionTab([["Tab", PrismaticGadget(0, _Left<number, string>(), Null())]])).subForest[0].rootLabel)
      .toBe("Tab Null");
  });
});

describe("dialogs", () => {
  test("disableApply only changes OkApplyButton", () => {
    expect(disableApply(Dialog("t", OkApplyButton, TickBox())).dialogButtons).toEqual(OkButton);
    expect(disableApply(Dialog("t", CloseButton("x"), TickBox())).dialogButtons).toEqual(CloseButton("x"));
    const sel = disableApply1(constantDialog(Dialog("t", OkApplyButton, TickBox())));
    const d = sel(null, true);
    expect(d.tag === "Just" && d.value.dialogButtons).toEqual(OkButton);
  });

  test("promoteDialogSelector wraps the gadget in Prismatic and uses the default", () => {
    const seen: number[] = [];
    const sel = (_e: null, v: number) => {
      seen.push(v);
      return v > 0 ? Just(Dialog("n", OkButton, gId<null, never, number>())) : Nothing;
    };
    const promoted = promoteDialogSelector<null, never, Either<number, string>, number>(7, _Left(), sel);
    const r1 = promoted(null, Left(3));
    const r2 = promoted(null, Right("x"));
    expect(seen).toEqual([3, 7]);
    expect(r1.tag === "Just" && sexp(r1.value.dialogGadget)).toBe("(Prismatic Null)");
    expect(r2.tag === "Just" && r2.value.dialogGadget.tag).toBe("Prismatic");
    const g = r1.tag === "Just" ? r1.value.dialogGadget : null;
    expect(g).toEqual(Prismatic(7, (g as any)._1, gId()));
  });

  test("lenses compose with focusing-style use", () => {
    // Type-level smoke test: tuples from lenses fit Gadget pairs.
    const g: Gadget<null, never, readonly [number, string], number> = gPipe(arr((p: readonly [number, string]) => p), arr((p) => p[0]));
    expect(run(g, [1, "a"])).toBe(1);
    expect([_1(), _2()].length).toBe(2);
  });
});
