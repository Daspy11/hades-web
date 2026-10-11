import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { over, traversal } from "@/lib/Control/Lens";
import { mempty_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { runInner } from "./AutoMonad";
import {
  type Handle, type LineShape, type Rectangle, BoxShapeClass_Rectangle, LineShape as mkLineShape,
  Rectangle as mkRectangle, ShapeClass_LineShape, ShapeClass_Rectangle, lineEnds, lineHandles,
  lineUpdate, simpleHandle,
} from "./BasicShapes";
import {
  type KeyCommands, alignLeft, alignTop, applyToSelection, distributeH, handleDelegatedAction,
  ignoreDrag, processAction, sizeWidest, spaceH,
} from "./Commands";
import { type Connectable, type ConnectorEnd, Connected, Unconnected, connectableDefaults } from "./Connections";
import {
  type Action, type ActionOutput, type Command, type Delta, type DeltaAct, type DeltaCtx, type DeltaNext, type Modifiers, type View, Action as mkAction, Drag, EndDrag,
  Key, Select, deltaStateOf, itemsDescription, mempty_View, mkDiagramState, noMod, noPaint, shiftMod,
  startDelta, applyDelta, tellItem, yieldViews,
} from "./Delta";
import { type DiagramId, diagramFromList } from "./Diagram";
import {
  type BoundBox, type Point, BoundBox as Box, Point as P, distance, growBox, inBox, mkBoundBox, pointDiff,
  shrinkBox,
} from "./Geometry";
import { deleteItem, updateItem } from "./Primitives";

// ---------------------------------------------------------------------------------------------
// A small diagram type built from the abstract shapes: rectangular boxes and wires.

type Item =
  | { readonly tag: "Box"; readonly id: DiagramId; readonly shape: Rectangle }
  | { readonly tag: "Wire"; readonly id: DiagramId; readonly shape: LineShape };

/** A handle is a small square around the point; its action is the one given. */
const testHandle: Handle<Item> = function* (_d, menu, pt, act) {
  const v: View<Item> = {
    ...mempty_View<Item>(),
    viewTouched: (p: Point) => distance(pointDiff(p, pt)) <= 3,
    viewBox: growBox(3, Box(pt, pt)),
    viewMenu: () => menu,
    viewAction: act,
  };
  return v;
};

const cls: Connectable<Item> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles(d, v) {
    if (v.tag === "Box") {
      const hs: View<Item>[] = [];
      for (const [pt, f] of BoxShapeClass_Rectangle.shapeHandles(v.shape)) {
        hs.push(yield* simpleHandle(d, "Resize ", mempty_Menu(), testHandle,
          [pt, (p: Point): Item => ({ ...v, shape: f(p) })]));
      }
      return hs;
    }
    return yield* lineHandles(d, v.shape, testHandle, (s): Item => ({ ...v, shape: s }), function* () {});
  },
  itemTouched: (v, s, p) =>
    v.tag === "Box" ? ShapeClass_Rectangle.shapeTouched(v.shape, s, p) : ShapeClass_LineShape.shapeTouched(v.shape, s, p),
  *itemChildren() { return []; },
  itemInBox: (v, b) =>
    v.tag === "Box" ? ShapeClass_Rectangle.shapeInBox(v.shape, b) : ShapeClass_LineShape.shapeInBox(v.shape, b),
  itemBounds: (v) =>
    v.tag === "Box" ? ShapeClass_Rectangle.shapeBounds(v.shape) : ShapeClass_LineShape.shapeBounds(v.shape),
  *itemResize(d, wh, v) {
    if (v.tag !== "Box") return v;
    const v1: Item = { ...v, shape: BoxShapeClass_Rectangle.shapeResize(wh, v.shape) };
    yield* updateItem(d, v1);
    return v1;
  },
  *itemMove(d, xy, v) {
    const v1: Item = v.tag === "Box"
      ? { ...v, shape: ShapeClass_Rectangle.shapeDrag(xy, v.shape) }
      : { ...v, shape: ShapeClass_LineShape.shapeDrag(xy, v.shape) };
    yield* updateItem(d, v1);
    return v1;
  },
  *itemDrag(d, xy, v) { return yield* cls.itemMove(d, xy, v); },
  *itemDescription(_d, v) { return v.id; },
  *itemView(_d, v) {
    const view: View<Item> = {
      viewDraw: noPaint,
      viewTouched: (p) => cls.itemTouched(v, 1, p),
      viewBox: cls.itemBounds(v),
      viewMenu: () => mempty_Menu(),
      viewAction: (d1, a) => handleDelegatedAction(d1, v, yieldViews, (d2) => yieldViews(d2), a),
    };
    return view;
  },
  itemType: () => "test",
  *itemCanConnect(_d, _dir, line, target) { return line.tag === "Wire" && target.tag === "Box"; },
  itemConnectors: traversal<Item, ConnectorEnd>(
    (v, f) => (v.tag === "Wire" ? { ...v, shape: over(lineEnds, ([a, b]) => [f(a), f(b)] as const, v.shape) } : v),
    (v) => (v.tag === "Wire" ? [...v.shape._lineEnds] : []),
  ),
  *itemConnectionPoint(_d, v) {
    return v.tag === "Box" ? (p: Point) => ShapeClass_Rectangle.shapeConnectionPoint(v.shape, p) : (p: Point) => p;
  },
  *itemAdjust(d, v) {
    if (v.tag === "Wire") {
      const shape = yield* lineUpdate(d, v.shape);
      yield* updateItem(d, { ...v, shape });
    } else {
      yield* tellItem(d, v);
    }
  },
};

const box = (id: string, x1: number, y1: number, x2: number, y2: number): Item =>
  ({ tag: "Box", id, shape: mkRectangle(Box(P(x1, y1), P(x2, y2))) });

const boxA = box("a", 0, 0, 10, 10);
const boxB = box("b", 50, 0, 60, 10);
const wire: Item = {
  tag: "Wire", id: "w",
  shape: mkLineShape([Connected(P(10, 5), "a", Nothing), Connected(P(50, 5), "b", Nothing)], []),
};

const drawBox = (_p1: Point, _p2: Point) => noPaint;

const deleteKeys: KeyCommands<Item> = M.fromList<readonly [Modifiers, string], DeltaAct<Item, void>>([[
  [noMod, "\x7f"],
  (d: DeltaCtx<Item>) => applyToSelection(d,
    function* (d1, xs) { return "Delete " + (yield* itemsDescription(d1, xs)); },
    deleteItem),
]]);

/** A running editor: feed it actions and inspect its state. */
class Editor {
  nxt: DeltaNext<Item> & { ctx: DeltaCtx<Item> };
  constructor(items: readonly Item[], keys: KeyCommands<Item> = M.empty()) {
    this.nxt = startDelta(cls, (d, a) => processAction(d, drawBox, keys, a), mkDiagramState(null, 1, diagramFromList(cls, items)));
  }
  apply(cmd: Command<Item>, at: Point = P(0, 0), mods = noMod, target: Maybe<readonly [DiagramId, View<Item>]> = Nothing): ActionOutput<Item> {
    const [out, n] = runInner(applyDelta(null, this.nxt, mkAction(cmd, at, mods, target)));
    this.nxt = n;
    return out;
  }
  action(a: Action<Item>): ActionOutput<Item> {
    const [out, n] = runInner(applyDelta(null, this.nxt, a));
    this.nxt = n;
    return out;
  }
  /** The target as the GUI would compute it: the item's current view. */
  target(id: DiagramId): Maybe<readonly [DiagramId, View<Item>]> {
    const v = this.item(id);
    return Just([id, runInner(cls.itemView(this.nxt.ctx, v))] as const);
  }
  item(id: DiagramId): Item {
    const v = M.lookup(id, deltaStateOf(this.nxt)._deltaDiagram._diagramContents);
    if (v.tag === "Nothing") throw new Error("no item " + id);
    return v.value;
  }
  has(id: DiagramId): boolean {
    return M.member(id, deltaStateOf(this.nxt)._deltaDiagram._diagramContents);
  }
  selection(): DiagramId[] {
    return S.toList(deltaStateOf(this.nxt)._deltaSelection);
  }
  bounds(id: DiagramId): BoundBox {
    return cls.itemBounds(this.item(id));
  }
}

const onBoundary = (p: Point, b: BoundBox): boolean => inBox(p, growBox(0.01, b)) && !inBox(p, shrinkBox(0.01, b));

// ---------------------------------------------------------------------------------------------

describe("processAction: selection", () => {
  it("selects and shift-toggles items", () => {
    const ed = new Editor([boxA, boxB, wire]);
    const out1 = ed.apply(Select, P(5, 5), noMod, ed.target("a"));
    expect(ed.selection()).toEqual(["a"]);
    // Handles for the newly selected item are in the transients.
    expect(M.member("a", out1.outTransients._0)).toBe(true);
    expect(out1.outCheckpoint).toEqual(Nothing);
    ed.apply(Select, P(55, 5), shiftMod, ed.target("b"));
    expect(ed.selection()).toEqual(["a", "b"]);
    ed.apply(Select, P(55, 5), shiftMod, ed.target("b"));
    expect(ed.selection()).toEqual(["a"]);
    ed.apply(Select, P(100, 100));
    expect(ed.selection()).toEqual([]);
  });

  it("selects with a rubber band and removes the band afterwards", () => {
    const ed = new Editor([boxA, boxB, wire]);
    ed.apply(Drag([0, 0]), P(-5, -5));
    const out = ed.apply(Drag([30, 30]), P(-5, -5));
    // The rubber band is a transient view.
    const band = M.toList(out.outTransients._0);
    expect(band.length).toBe(1);
    expect(band[0][1].viewBox).toEqual(mkBoundBox(P(-5, -5), P(25, 25)));
    ed.apply(EndDrag([30, 30]), P(-5, -5));
    expect(ed.selection()).toEqual(["a"]);
    expect(deltaStateOf(ed.nxt)._deltaDiagram._diagramOrder).toEqual(["a", "b", "w"]);
    // Shift adds to the selection. The band ends at the last Drag; the EndDrag offset is not used.
    ed.apply(Drag([0, 0]), P(45, -5), shiftMod);
    ed.apply(Drag([20, 20]), P(45, -5), shiftMod);
    ed.apply(EndDrag([100, 100]), P(45, -5), shiftMod);
    expect(ed.selection()).toEqual(["a", "b"]);
  });
});

describe("processAction: moving", () => {
  it("moves multiple selected items and adjusts the connected wire", () => {
    const ed = new Editor([boxA, boxB, wire]);
    ed.apply(Select, P(5, 5), noMod, ed.target("a"));
    ed.apply(Select, P(55, 5), shiftMod, ed.target("b"));
    const target = ed.target("a");
    ed.apply(Drag([1, 1]), P(5, 5), noMod, target);
    expect(ed.bounds("a")).toEqual(Box(P(1, 1), P(11, 11)));
    ed.apply(Drag([10, 20]), P(5, 5), noMod, target);
    const out = ed.apply(EndDrag([10, 20]), P(5, 5), noMod, target);
    expect(out.outCheckpoint).toEqual(Just("Move 2 items"));
    expect(ed.bounds("a")).toEqual(Box(P(10, 20), P(20, 30)));
    expect(ed.bounds("b")).toEqual(Box(P(60, 20), P(70, 30)));
    const w = ed.item("w");
    if (w.tag !== "Wire") throw new Error("wire expected");
    const [s, e] = w.shape._lineEnds;
    expect(s.tag).toBe("Connected");
    expect(onBoundary(s.connectorPoint, ed.bounds("a"))).toBe(true);
    expect(onBoundary(e.connectorPoint, ed.bounds("b"))).toBe(true);
  });

  it("does not let items be dragged off the top or left of the diagram", () => {
    const ed = new Editor([boxA, boxB]);
    ed.apply(Select, P(5, 5), noMod, ed.target("a"));
    ed.apply(Select, P(55, 5), shiftMod, ed.target("b"));
    ed.apply(Drag([-20, 5]), P(5, 5), noMod, ed.target("a"));
    ed.apply(EndDrag([-20, 5]), P(5, 5), noMod, ed.target("a"));
    expect(ed.bounds("a")).toEqual(Box(P(0, 5), P(10, 15)));
    expect(ed.bounds("b")).toEqual(Box(P(30, 5), P(40, 15)));
  });

  it("delegates a drag on a single item to its view, which moves it", () => {
    const ed = new Editor([boxA, boxB, wire]);
    ed.apply(Drag([0, 0]), P(55, 5), noMod, ed.target("b"));
    ed.apply(Drag([0, 30]), P(55, 5), noMod, ed.target("b"));
    const out = ed.apply(EndDrag([0, 30]), P(55, 5), noMod, ed.target("b"));
    expect(out.outCheckpoint).toEqual(Just("Move b"));
    expect(ed.bounds("b")).toEqual(Box(P(50, 30), P(60, 40)));
    const w = ed.item("w");
    if (w.tag !== "Wire") throw new Error("wire expected");
    expect(onBoundary(w.shape._lineEnds[1].connectorPoint, ed.bounds("b"))).toBe(true);
  });

  it("resizes a selected box with a simple handle", () => {
    const ed = new Editor([boxA, boxB]);
    const out = ed.apply(Select, P(5, 5), noMod, ed.target("a"));
    const handles = M.lookup("a", out.outTransients._0);
    if (handles.tag === "Nothing") throw new Error("no handles");
    const target = Just(["a", handles.value] as const);
    ed.apply(Drag([0, 0]), P(10, 10), noMod, target);
    ed.apply(Drag([5, 7]), P(10, 10), noMod, target);
    const out2 = ed.apply(EndDrag([5, 7]), P(10, 10), noMod, target);
    expect(out2.outCheckpoint).toEqual(Just("Resize a"));
    expect(ed.bounds("a")).toEqual(Box(P(0, 0), P(15, 17)));
  });

  it("moves a wire end with a line handle and connects it to a box", () => {
    const loose: Item = {
      tag: "Wire", id: "w",
      shape: mkLineShape([Unconnected(P(20, 30)), Unconnected(P(40, 30))], [P(30, 40)]),
    };
    const ed = new Editor([boxA, boxB, loose]);
    const out = ed.apply(Select, P(25, 35), noMod, ed.target("w"));
    const handles = M.lookup("w", out.outTransients._0);
    if (handles.tag === "Nothing") throw new Error("no handles");
    const target = Just(["w", handles.value] as const);
    // Drag the end handle at (40,30) onto box b.
    ed.apply(Drag([0, 0]), P(40, 30), noMod, target);
    const out2 = ed.apply(EndDrag([15, -25]), P(40, 30), noMod, target);
    expect(out2.outCheckpoint).toEqual(Just("Move w"));
    const w = ed.item("w");
    if (w.tag !== "Wire") throw new Error("wire expected");
    const end = w.shape._lineEnds[1];
    expect(end.tag).toBe("Connected");
    if (end.tag === "Connected") expect(end.connectorTarget).toBe("b");
    expect(onBoundary(end.connectorPoint, ed.bounds("b"))).toBe(true);
    // Drag the bend handle (deselect and reselect to get fresh handles).
    ed.apply(Select, P(100, 100));
    const out3 = ed.apply(Select, P(25, 35), noMod, ed.target("w"));
    const handles3 = M.lookup("w", out3.outTransients._0);
    if (handles3.tag === "Nothing") throw new Error("no handles");
    const target3 = Just(["w", handles3.value] as const);
    ed.apply(Drag([0, 0]), P(30, 40), noMod, target3);
    const out4 = ed.apply(EndDrag([5, 5]), P(30, 40), noMod, target3);
    expect(out4.outCheckpoint).toEqual(Just("Move bend in w"));
    const w2 = ed.item("w");
    if (w2.tag !== "Wire") throw new Error("wire expected");
    expect(w2.shape._lineMiddle).toEqual([P(35, 45)]);
  });
});

describe("processAction: keys and scripts", () => {
  it("applies key commands to the selection", () => {
    const ed = new Editor([boxA, boxB, wire], deleteKeys);
    ed.apply(Select, P(5, 5), noMod, ed.target("a"));
    // Unknown keys are ignored.
    expect(ed.apply(Key("x")).outCheckpoint).toEqual(Nothing);
    const out = ed.apply(Key("\x7f"));
    expect(out.outCheckpoint).toEqual(Just("Delete a"));
    expect(ed.has("a")).toBe(false);
    expect(ed.selection()).toEqual([]);
    const w = ed.item("w");
    if (w.tag !== "Wire") throw new Error("wire expected");
    expect(w.shape._lineEnds[0]).toEqual(Unconnected(P(10, 5)));
  });

  it("aligns, sizes and distributes the selection", () => {
    const items = [box("p", 0, 0, 10, 10), box("q", 7, 30, 17, 40), box("r", 90, 60, 110, 70)];
    const ed = new Editor(items);
    ed.apply(Select, P(5, 5), noMod, ed.target("p"));
    ed.apply(Select, P(10, 35), shiftMod, ed.target("q"));
    ed.apply(Select, P(100, 65), shiftMod, ed.target("r"));

    const out1 = ed.action(alignTop<Item>());
    expect(out1.outCheckpoint).toEqual(Just("Top aligned 3 items."));
    expect(["p", "q", "r"].map((i) => ed.bounds(i))).toEqual([
      Box(P(0, 0), P(10, 10)), Box(P(7, 0), P(17, 10)), Box(P(90, 0), P(110, 10))]);

    // Centres at 5, 12 and 100: distribute evenly between 5 and 100.
    const out2 = ed.action(distributeH<Item>());
    expect(out2.outCheckpoint).toEqual(Just("Horizontally distribute 3 items."));
    expect(["p", "q", "r"].map((i) => ed.bounds(i))).toEqual([
      Box(P(0, 0), P(10, 10)), Box(P(47.5, 0), P(57.5, 10)), Box(P(90, 0), P(110, 10))]);

    // Widths 10, 10 and 20; space from 0 to 110 leaves 70 / 2 = 35 between them.
    const out3 = ed.action(spaceH<Item>());
    expect(out3.outCheckpoint).toEqual(Just("Horizontally space 3 items."));
    expect(["p", "q", "r"].map((i) => ed.bounds(i))).toEqual([
      Box(P(0, 0), P(10, 10)), Box(P(45, 0), P(55, 10)), Box(P(90, 0), P(110, 10))]);

    const out4 = ed.action(sizeWidest<Item>());
    expect(out4.outCheckpoint).toEqual(Just("Resized 3 items."));
    expect(["p", "q", "r"].map((i) => ed.bounds(i))).toEqual([
      Box(P(-5, 0), P(15, 10)), Box(P(40, 0), P(60, 10)), Box(P(90, 0), P(110, 10))]);

    const out5 = ed.action(alignLeft<Item>());
    expect(out5.outCheckpoint).toEqual(Just("Left aligned 3 items."));
    expect(["p", "q", "r"].map((i) => ed.bounds(i))).toEqual([
      Box(P(-5, 0), P(15, 10)), Box(P(-5, 0), P(15, 10)), Box(P(-5, 0), P(15, 10))]);
  });

  it("does nothing for alignment of a single item", () => {
    const ed = new Editor([boxA, boxB]);
    ed.apply(Select, P(5, 5), noMod, ed.target("a"));
    const out = ed.action(alignLeft<Item>());
    expect(out.outCheckpoint).toEqual(Nothing);
  });
});

describe("ignoreDrag", () => {
  it("swallows drags and returns the first other action", () => {
    const st = { state: mkDiagramState(null, 1, diagramFromList(cls, [boxA])) };
    const results: Action<Item>[] = [];
    const nxt = startDelta(cls, function* (d, a): Delta<Item, never> {
      for (;;) {
        const r = yield* ignoreDrag(d, a);
        results.push(r);
        a = yield* yieldViews(d);
      }
    }, st.state);
    const act = (c: Command<Item>) => runInner(applyDelta(null, nxt, mkAction(c, P(0, 0), noMod, Nothing)));
    act(Drag([1, 1]));
    act(Drag([2, 2]));
    expect(results).toEqual([]);
    act(EndDrag([2, 2]));
    expect(results.length).toBe(1);
    expect(results[0].actionCommand).toEqual(EndDrag([2, 2]));
  });
});
