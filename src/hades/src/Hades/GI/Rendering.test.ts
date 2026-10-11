// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as B from "@/lib/Reactive/Banana";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { view } from "@/lib/Control/Lens";
import { mempty_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { runInner, streamStateT } from "../Abstract/AutoMonad";
import { type Connectable, connectableDefaults } from "../Abstract/Connections";
import {
  type Action, type View, Action as mkAction, Select, deltaSelection, deltaZoom, liftBase, mkScriptAction, noMod,
  noPaint, tellAll, tellCheckpoint, yieldProperties, yieldViews,
} from "../Abstract/Delta";
import { diagramFromList } from "../Abstract/Diagram";
import { type BoundBox, BoundBox as Box, NoBox, Point, inBox } from "../Abstract/Geometry";
import type { HadesStyle } from "./BasicShapes";
import { type HadesGtk, hadesActionExecute, hadesState, makeDrawingGtk, renderStaticSize } from "./Rendering";

interface Item {
  readonly id: string;
  readonly box: BoundBox;
}

const cls: Connectable<Item> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles() {
    return [];
  },
  itemTouched: (v, _s, p) => v.box.tag === "BoundBox" && inBox(p, v.box),
  *itemChildren() {
    return [];
  },
  itemInBox: () => false,
  itemBounds: (v) => v.box,
  *itemResize(_d, _wh, v) {
    return v;
  },
  *itemMove(_d, _xy, v) {
    return v;
  },
  *itemDrag(_d, _xy, v) {
    return v;
  },
  *itemDescription(_d, v) {
    return v.id;
  },
  *itemView(_d, v) {
    const r: View<Item> = {
      viewDraw: noPaint,
      viewTouched: (p) => cls.itemTouched(v, 1, p),
      viewBox: v.box,
      viewMenu: () => mempty_Menu(),
      viewAction: (d) => yieldViews(d),
    };
    return r;
  },
  itemType: () => "test",
  *itemAdjust() {},
};

const itemA: Item = { id: "a", box: Box(Point(0, 0), Point(10, 10)) };
const itemB: Item = { id: "b", box: Box(Point(20, 0), Point(40, 30)) };

function setup(): HadesGtk<Item> {
  return B.liftMomentIO(() => {
    const ref: B.Behavior<HadesGtk<Item>> = B.lazyB(() => hb);
    const [, init] = makeDrawingGtk(cls, diagramFromList(cls, [itemA, itemB]), null, Nothing, M.empty(),
      {} as HadesStyle, 2, ref);
    const hb: B.Behavior<HadesGtk<Item>> = B.stepper(init, B.never());
    return init;
  });
}

const refresh: Action<Item> = mkScriptAction<Item>(function* (d) {
  yield* tellAll(d);
  return yield* yieldViews(d);
});

const checkpoint = (msg: string): Action<Item> => mkScriptAction<Item>(function* (d) {
  yield* tellCheckpoint(d, msg);
  return yield* yieldViews(d);
});

function selectAt(h: HadesGtk<Item>, id: string): Action<Item> {
  const v = M.lookup(id, h._hadesViews._0);
  return mkAction(Select, Point(1, 1), noMod, v.tag === "Just" ? Just([id, v.value] as const) : Nothing);
}

const selection = (h: HadesGtk<Item>) => S.toList(view(deltaSelection<Item>(), streamStateT(view(hadesState<Item>(), h))));

describe("hadesActionExecute", () => {
  test("draws all the views and keeps non-empty ones", () => {
    const init = setup();
    expect(view(deltaZoom<Item>(), streamStateT(init._hadesState))).toBe(2);
    const r = runInner(hadesActionExecute(null, init, [refresh]));
    expect(M.keys(r.hadesActionNewState._hadesViews._0)).toEqual(["a", "b"]);
    expect(r.hadesActionCheckpoint).toEqual(Nothing);
    expect(renderStaticSize(r.hadesActionNewState)).toEqual(Box(Point(-3.75, -3.75), Point(33.75, 26.25)));
    expect(renderStaticSize(init)).toEqual(NoBox);
  });

  test("accumulates checkpoints and property requests over several actions", () => {
    const init = setup();
    const props = mkScriptAction<Item>((d) => yieldProperties(d, itemB));
    const r = runInner(hadesActionExecute(null, init, [refresh, checkpoint("one"), props, checkpoint(" two")]));
    expect(r.hadesActionCheckpoint).toEqual(Just("one two"));
    expect(r.hadesActionProperties).toEqual([itemB]);
  });

  test("passes base monad instructions through to the caller", () => {
    const init = setup();
    const ask = mkScriptAction<Item>(function* (d) {
      const answer: number = yield* liftBase(d, function* (base) {
        return (yield { tag: "Ask", base }) as number;
      });
      yield* tellCheckpoint(d, "answer " + answer);
      return yield* yieldViews(d);
    });
    const g = hadesActionExecute("BASE", init, [ask]);
    const r1 = g.next();
    expect(r1).toEqual({ done: false, value: { tag: "Ask", base: "BASE" } });
    const r2 = g.next(42);
    expect(r2.done).toBe(true);
    expect(r2.value && "hadesActionCheckpoint" in r2.value ? r2.value.hadesActionCheckpoint : null).toEqual(Just("answer 42"));
  });

  test("old states can be used again, as with immutable Haskell continuations", () => {
    const init = setup();
    const h1 = runInner(hadesActionExecute(null, init, [refresh])).hadesActionNewState;
    const h2 = runInner(hadesActionExecute(null, h1, [selectAt(h1, "a")])).hadesActionNewState;
    expect(selection(h2)).toEqual(["a"]);
    // h1 is now stale: applying an action to it starts from h1's state, not h2's.
    const h3 = runInner(hadesActionExecute(null, h1, [selectAt(h1, "b")])).hadesActionNewState;
    expect(selection(h3)).toEqual(["b"]);
    expect(selection(h2)).toEqual(["a"]);
    expect(selection(h1)).toEqual([]);
    // h2 continues the machine it came from.
    const h4 = runInner(hadesActionExecute(null, h2, [selectAt(h2, "b")])).hadesActionNewState;
    expect(selection(h4)).toEqual(["b"]);
    // The initial state can be reused (as on a diagram refresh).
    const h5 = runInner(hadesActionExecute(null, init, [refresh])).hadesActionNewState;
    expect(selection(h5)).toEqual([]);
    expect(M.keys(h5._hadesViews._0)).toEqual(["a", "b"]);
  });

  test("a state whose run failed restarts from its snapshot", () => {
    const init = setup();
    const h0 = runInner(hadesActionExecute(null, init, [refresh])).hadesActionNewState;
    const h1 = runInner(hadesActionExecute(null, h0, [selectAt(h0, "a")])).hadesActionNewState;
    expect(selection(h1)).toEqual(["a"]);
    const boom = mkScriptAction<Item>(function* () {
      throw new Error("boom");
    });
    expect(() => runInner(hadesActionExecute(null, h1, [boom]))).toThrow("boom");
    const h2 = runInner(hadesActionExecute(null, h1, [refresh])).hadesActionNewState;
    expect(selection(h2)).toEqual(selection(h1));
  });
});
