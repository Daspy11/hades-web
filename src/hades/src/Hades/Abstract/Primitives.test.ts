import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { traversal } from "@/lib/Control/Lens";
import { Output } from "./AutoMonad";
import {
  type Connectable, type ConnectorEnd, type Terminators, Connected, Unconnected, connectableDefaults,
} from "./Connections";
import {
  type Action, type ActionOutput, type Delta, DeltaCtx, mkDiagramState, mempty_View,
} from "./Delta";
import { type DiagramId, diagramFromList, diagramToList } from "./Diagram";
import { type BoundBox, BoundBox as Box, Point, constrainBox, containsBox, inBox, mkBoundBox, moveBox } from "./Geometry";
import { addItemsMenu, basicShapeMenu, selectionOrTarget } from "./Menus";
import {
  addItem, deleteItem, mergeDiagram, modifyItem, moveBottom, moveDown, moveTop, moveUp, setDiagram,
  updateItem, withItem, withItem1,
} from "./Primitives";

// ---------------------------------------------------------------------------------------------
// A minimal diagram type: boxes and wires that connect to boxes.

type Item =
  | { readonly kind: "Box"; readonly id: DiagramId; readonly box: BoundBox }
  | { readonly kind: "Wire"; readonly id: DiagramId; readonly ends: Terminators };

const bounds = (v: Item): BoundBox =>
  v.kind === "Box" ? v.box : mkBoundBox(v.ends[0].connectorPoint, v.ends[1].connectorPoint);

/** Records the items each itemView call was made for. */
let viewed: DiagramId[] = [];

const cls: Connectable<Item> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles() { return []; },
  itemTouched: (v, _s, p) => inBox(p, bounds(v)),
  *itemChildren() { return []; },
  itemInBox: (v, b) => containsBox(b, bounds(v)),
  itemBounds: bounds,
  *itemResize(_d, _wh, v) { return v; },
  *itemMove(_d, _xy, v) { return v; },
  *itemDrag(_d, _xy, v) { return v; },
  *itemDescription(_d, v) { return v.id; },
  *itemView(_d, v) {
    viewed.push(v.id);
    return { ...mempty_View<Item>(), viewBox: bounds(v) };
  },
  itemType: () => "test",
  *itemCanConnect(_d, _dir, _line, target) { return target.kind === "Box"; },
  itemConnectors: traversal<Item, ConnectorEnd>(
    (v, f) => (v.kind === "Wire" ? { ...v, ends: [f(v.ends[0]), f(v.ends[1])] as const } : v),
    (v) => (v.kind === "Wire" ? [v.ends[0], v.ends[1]] : []),
  ),
  *itemConnectionPoint(_d, v) { return (p: Point) => constrainBox(bounds(v), p); },
  *itemAdjust() { /* Nothing to do. */ },
};

const mkBox = (id: DiagramId, x: number): Item => ({ kind: "Box", id, box: Box(Point(x, 0), Point(x + 10, 10)) });
const boxA = mkBox("a", 0);
const boxB = mkBox("b", 20);
const boxC = mkBox("c", 40);
const wire: Item = {
  kind: "Wire", id: "w", ends: [Connected(Point(10, 5), "a", Nothing), Connected(Point(20, 5), "b", Nothing)],
};

function mkCtx(items: readonly Item[]): DeltaCtx<Item> {
  let n = 0;
  const st = mkDiagramState(null, 1, diagramFromList(cls, items));
  viewed = [];
  return new DeltaCtx(cls, { state: { ...st, deltaNames: () => `new${n++}` } });
}

/** Run a Delta computation that is not expected to yield. */
function run<A>(g: Delta<Item, A>): A {
  const r = g.next();
  if (!r.done) throw new Error("unexpected yield");
  return r.value;
}

/** Run a script action up to its first `yieldViews` and return the output. */
function runScript(d: DeltaCtx<Item>, a: Action<Item>): ActionOutput<Item> {
  if (a.actionCommand.tag !== "Script") throw new Error("not a script");
  const r = a.actionCommand._0(d).next();
  if (r.done || !(r.value instanceof Output)) throw new Error("expected an output");
  return r.value.value as ActionOutput<Item>;
}

const order = (d: DeltaCtx<Item>): DiagramId[] => diagramToList(d.state._deltaDiagram).map((v) => v.id);
const viewKeys = (d: DeltaCtx<Item>): DiagramId[] => M.keys(d.state.deltaViews._0);
const lookupItem = (d: DeltaCtx<Item>, u: DiagramId): Item | undefined => M.get(u, d.state._deltaDiagram._diagramContents);

// ---------------------------------------------------------------------------------------------

describe("Primitives", () => {
  it("addItem assigns a fresh id and puts the item at the front", () => {
    const d = mkCtx([boxA, boxB]);
    const item = run(addItem(d, (u) => mkBox(u, 100)));
    expect(item.id).toBe("new0");
    expect(order(d)).toEqual(["new0", "a", "b"]);
    expect(viewKeys(d)).toEqual(["new0"]);
    expect(run(addItem(d, (u) => mkBox(u, 200))).id).toBe("new1");
  });

  it("deleteItem disconnects connected items and clears the views", () => {
    const d = mkCtx([wire, boxA, boxB]);
    d.state = { ...d.state, _deltaSelection: S.fromList(["a", "b"]) };
    run(deleteItem(d, "a"));
    expect(order(d)).toEqual(["w", "b"]);
    expect(S.toList(d.state._deltaSelection)).toEqual(["b"]);
    const w = lookupItem(d, "w");
    if (w?.kind !== "Wire") throw new Error("wire missing");
    expect(w.ends[0]).toEqual(Unconnected(Point(10, 5)));
    expect(w.ends[1].tag).toBe("Connected");
    expect(viewKeys(d)).toEqual(["a", "w"]);
    expect(M.lookup("a", d.state.deltaViews._0).tag).toBe("Just");
    expect(M.keys(d.state.deltaTransients._0)).toContain("a");
  });

  it("withItem and withItem1", () => {
    const d = mkCtx([boxA]);
    expect(run(withItem(d, "a", function* (_d, v) { return v.id + "!"; }))).toEqual(Just("a!"));
    expect(run(withItem(d, "z", function* (_d, v) { return v.id + "!"; }))).toEqual(Nothing);
    const seen: DiagramId[] = [];
    run(withItem1(d, "a", function* (_d, v) { seen.push(v.id); }));
    run(withItem1(d, "z", function* (_d, v) { seen.push(v.id); }));
    expect(seen).toEqual(["a"]);
  });

  it("modifyItem", () => {
    const d = mkCtx([boxA, boxB]);
    const r = run(modifyItem(d, "b", function* (_d, v) {
      return v.kind === "Box" ? { ...v, box: moveBox(v.box, [1, 1]) } : v;
    }));
    const movedB: Item = { kind: "Box", id: "b", box: Box(Point(21, 1), Point(31, 11)) };
    expect(r).toEqual(Just(movedB));
    expect(lookupItem(d, "b")).toEqual(movedB);
    expect(order(d)).toEqual(["a", "b"]);
    expect(viewKeys(d)).toEqual(["b"]);
    expect(run(modifyItem(d, "z", function* (_d, v) { return v; }))).toEqual(Nothing);
  });

  it("updateItem replaces or adds", () => {
    const d = mkCtx([boxA, boxB]);
    const b2 = mkBox("b", 50);
    run(updateItem(d, b2));
    expect(order(d)).toEqual(["a", "b"]);
    expect(lookupItem(d, "b")).toEqual(b2);
    run(updateItem(d, boxC));
    expect(order(d)).toEqual(["c", "a", "b"]);
    expect(viewKeys(d)).toEqual(["b", "c"]);
  });

  it("moves in the diagram order", () => {
    const d = mkCtx([boxA, boxB, boxC]);
    run(moveTop(d, "c"));
    expect(order(d)).toEqual(["c", "a", "b"]);
    run(moveBottom(d, "c"));
    expect(order(d)).toEqual(["a", "b", "c"]);
    run(moveUp(d, "b"));
    expect(order(d)).toEqual(["b", "a", "c"]);
    run(moveDown(d, "b"));
    expect(order(d)).toEqual(["a", "b", "c"]);
    expect(viewKeys(d)).toEqual(["b", "c"]);
    // Unknown ids are ignored.
    run(moveTop(d, "z"));
    expect(order(d)).toEqual(["a", "b", "c"]);
  });

  it("setDiagram replaces the diagram and clears the old views", () => {
    const d = mkCtx([boxA, boxB]);
    d.state = { ...d.state, _deltaSelection: S.fromList(["a"]) };
    run(setDiagram(d, diagramFromList(cls, [boxC])));
    expect(order(d)).toEqual(["c"]);
    expect(S.toList(d.state._deltaSelection)).toEqual([]);
    expect(viewKeys(d)).toEqual(["a", "b", "c"]);
    expect(viewed).toEqual(["c"]);
  });

  it("mergeDiagram puts the new items in front and selects them", () => {
    const d = mkCtx([boxA, boxB]);
    d.state = { ...d.state, _deltaSelection: S.fromList(["a"]) };
    run(mergeDiagram(d, diagramFromList(cls, [boxC])));
    expect(order(d)).toEqual(["c", "a", "b"]);
    expect(S.toList(d.state._deltaSelection)).toEqual(["c"]);
  });
});

describe("Menus", () => {
  it("addItemsMenu adds an item at the point", () => {
    const gens = [["Box", (p: Point, u: DiagramId) => mkBox(u, p._pX)] as const];
    const menu = addItemsMenu<Item>(gens, Point(70, 0));
    expect(menu._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Box"]]);
    expect(addItemsMenu<Item>(gens)(Point(70, 0))._0[0][0].menuLabel).toBe("Box");
    const item = menu._0[0][0].menuValue;
    if (item.tag !== "Right") throw new Error("expected an action");
    const d = mkCtx([boxA]);
    const out = runScript(d, item.value);
    expect(out.outCheckpoint).toEqual(Just("Add new0"));
    expect(M.keys(out.outViews._0)).toEqual(["new0"]);
    expect(lookupItem(d, "new0")).toEqual(mkBox("new0", 70));
    expect(order(d)).toEqual(["new0", "a"]);
  });

  it("basicShapeMenu", () => {
    const menu = basicShapeMenu<Item>("a", Point(0, 0));
    expect(menu._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["To top", "To bottom"], ["Delete"]]);
    const partial = basicShapeMenu<Item>("a");
    expect(partial(Point(1, 1))._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["To top", "To bottom"], ["Delete"]]);
    const del = menu._0[1][0].menuValue;
    if (del.tag !== "Right") throw new Error("expected an action");
    const d = mkCtx([boxA, boxB]);
    const out = runScript(d, del.value);
    expect(out.outCheckpoint).toEqual(Just("Delete a"));
    expect(order(d)).toEqual(["b"]);
    const toBottom = basicShapeMenu<Item>("b", Point(0, 0))._0[0][1].menuValue;
    if (toBottom.tag !== "Right") throw new Error("expected an action");
    const d2 = mkCtx([boxA, boxB, boxC]);
    d2.state = { ...d2.state, _deltaSelection: S.fromList(["a", "b"]) };
    expect(runScript(d2, toBottom.value).outCheckpoint).toEqual(Just("Move 2 items to bottom"));
    expect(order(d2)).toEqual(["c", "a", "b"]);
  });

  it("selectionOrTarget applies to the selection only when the target is selected", () => {
    const applied: DiagramId[] = [];
    const act = (u: DiagramId): Action<Item> => selectionOrTarget<Item>(
      function* (_d, vs) { return vs.map((v) => v.id).join(","); },
      function* (_d, uuid) { applied.push(uuid); },
      u,
    );
    const d = mkCtx([boxA, boxB, boxC]);
    d.state = { ...d.state, _deltaSelection: S.fromList(["c", "a"]) };
    expect(runScript(d, act("a")).outCheckpoint).toEqual(Just("a,c"));
    expect(applied).toEqual(["a", "c"]);
    applied.length = 0;
    expect(runScript(d, act("b")).outCheckpoint).toEqual(Just("b"));
    expect(applied).toEqual(["b"]);
    applied.length = 0;
    expect(runScript(d, act("z")).outCheckpoint).toEqual(Nothing);
    expect(applied).toEqual([]);
  });
});
