import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { traversal, toListOf, over } from "@/lib/Control/Lens";
import * as J from "@/lib/Data/Aeson";
import {
  type Connectable, type ConnectorEnd, type Peg, type Terminators, Connected, JSON_ConnectorEnd,
  JSON_Terminators, Unconnected, connectable, connectableDefaults, eq_ConnectorEnd, getAllConnected,
  getAllPegged, isConnectedTo, mkEndPoint, moveEnd, moveEnds, optimiseEnds, show_ConnectorEnd,
} from "./Connections";
import { type Delta, DeltaCtx, mkDiagramState, mempty_View } from "./Delta";
import { type DiagramId, diagramFromList } from "./Diagram";
import { type BoundBox, BoundBox as Box, Point, constrainBox, containsBox, inBox, mkBoundBox } from "./Geometry";

// ---------------------------------------------------------------------------------------------
// A minimal diagram type: boxes, wires that connect to boxes, and labels pegged to wires.

type Item =
  | { readonly kind: "Box"; readonly id: DiagramId; readonly box: BoundBox }
  | { readonly kind: "Wire"; readonly id: DiagramId; readonly ends: Terminators }
  | { readonly kind: "Label"; readonly id: DiagramId; readonly at: Point; readonly peg: Maybe<Peg> };

const bounds = (v: Item): BoundBox => {
  switch (v.kind) {
    case "Box": return v.box;
    case "Wire": return mkBoundBox(v.ends[0].connectorPoint, v.ends[1].connectorPoint);
    case "Label": return Box(v.at, v.at);
  }
};

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
  *itemView(_d, v) { return { ...mempty_View<Item>(), viewBox: bounds(v) }; },
  itemType: () => "test",
  *itemCanConnect(_d, _dir, _line, target) { return target.kind === "Box"; },
  itemConnectors: traversal<Item, ConnectorEnd>(
    (v, f) => (v.kind === "Wire" ? { ...v, ends: [f(v.ends[0]), f(v.ends[1])] as const } : v),
    (v) => (v.kind === "Wire" ? [v.ends[0], v.ends[1]] : []),
  ),
  *itemConnectionPoint(_d, v) { return (p: Point) => constrainBox(bounds(v), p); },
  itemPeg: traversal<Item, Peg>(
    (v, f) => (v.kind === "Label" && v.peg.tag === "Just" ? { ...v, peg: Just(f(v.peg.value)) } : v),
    (v) => (v.kind === "Label" && v.peg.tag === "Just" ? [v.peg.value] : []),
  ),
  *itemAdjust() { /* Nothing to do. */ },
};

const boxA: Item = { kind: "Box", id: "a", box: Box(Point(0, 0), Point(10, 10)) };
const boxB: Item = { kind: "Box", id: "b", box: Box(Point(20, 0), Point(30, 10)) };
const wire: Item = { kind: "Wire", id: "w", ends: [Connected(Point(10, 5), "a", Nothing), Unconnected(Point(50, 50))] };
const label: Item = { kind: "Label", id: "l", at: Point(40, 40), peg: Just(["w", 0.5] as const) };

function mkCtx(items: readonly Item[]): DeltaCtx<Item> {
  return new DeltaCtx(cls, { state: mkDiagramState(null, 1, diagramFromList(cls, items)) });
}

/** Run a Delta computation that is not expected to yield. */
function run<A>(g: Delta<Item, A>): A {
  const r = g.next();
  if (!r.done) throw new Error("unexpected yield");
  return r.value;
}

// ---------------------------------------------------------------------------------------------

describe("ConnectorEnd", () => {
  it("Eq ignores the location of connected ends", () => {
    const c1 = Connected(Point(0, 0), "a", Nothing);
    const c2 = Connected(Point(5, 5), "a", Nothing);
    expect(eq_ConnectorEnd(c1, c2)).toBe(true);
    expect(equals(c1, c2)).toBe(true);
    expect(equals(c1, Connected(Point(0, 0), "b", Nothing))).toBe(false);
    expect(equals(c1, Connected(Point(0, 0), "a", Just("x")))).toBe(false);
    expect(equals(Unconnected(Point(1, 1)), Unconnected(Point(1, 1)))).toBe(true);
    expect(equals(Unconnected(Point(1, 1)), Unconnected(Point(1, 2)))).toBe(false);
    expect(equals(Unconnected(Point(0, 0)), c1)).toBe(false);
    expect(equals(c1, Unconnected(Point(0, 0)))).toBe(false);
    // The custom equality is used inside derived equality of containing structures.
    expect(equals([c1, Unconnected(Point(1, 1))], [c2, Unconnected(Point(1, 1))])).toBe(true);
    // Record update with spread keeps the custom equality.
    expect(equals({ ...c1, connectorPoint: Point(9, 9) }, c1)).toBe(true);
  });

  it("JSON matches aeson", () => {
    expect(JSON_ConnectorEnd.toJSON(Unconnected(Point(1, 2)))).toEqual({ state: "unconnected", point: { x: 1, y: 2 } });
    expect(JSON_ConnectorEnd.toJSON(Connected(Point(1, 2), "a", Nothing)))
      .toEqual({ state: "connected", point: { x: 1, y: 2 }, target: "a" });
    expect(JSON_ConnectorEnd.toJSON(Connected(Point(1, 2), "a", Just("c"))))
      .toEqual({ child: "c", state: "connected", point: { x: 1, y: 2 }, target: "a" });
    const uuid = "e386bb76-c5dd-5182-b2c8-f76ca3de8f8c";
    const parsed = JSON_ConnectorEnd.parseJSON({ state: "connected", point: { x: 1, y: 2 }, target: uuid, child: null });
    expect(parsed.tag).toBe("Connected");
    if (parsed.tag === "Connected") {
      expect(parsed.connectorPoint).toEqual(Point(1, 2));
      expect(parsed.connectorTarget).toBe(uuid);
      expect(parsed.connectorTargetChild).toEqual(Nothing);
    }
    expect(equals(parsed, Connected(Point(7, 7), uuid, Nothing))).toBe(true);
    const parsedU = JSON_ConnectorEnd.parseJSON({ state: "unconnected", point: { x: 3, y: 4 } });
    expect(equals(parsedU, Unconnected(Point(3, 4)))).toBe(true);
    expect(() => JSON_ConnectorEnd.parseJSON({ state: "floating", point: { x: 3, y: 4 } }))
      .toThrow("Unknown connector end state: floating");
    const ends: Terminators = [Unconnected(Point(0, 0)), Connected(Point(1, 1), uuid, Nothing)];
    const v = JSON_Terminators.toJSON(ends);
    expect(v).toEqual([
      { state: "unconnected", point: { x: 0, y: 0 } },
      { state: "connected", point: { x: 1, y: 1 }, target: uuid },
    ]);
    expect(equals(JSON_Terminators.parseJSON(v), ends)).toBe(true);
    expect(() => JSON_Terminators.parseJSON((v as J.Value[]).slice(0, 1))).toThrow(J.JSONParseError);
  });

  it("show", () => {
    expect(show_ConnectorEnd(Unconnected(Point(1, 2)))).toBe("Unconnected {connectorPoint = Point {_pX = 1.0, _pY = 2.0}}");
    expect(show_ConnectorEnd(Connected(Point(1, 2), "a", Just("c")))).toBe(
      "Connected {connectorPoint = Point {_pX = 1.0, _pY = 2.0}, connectorTarget = a, connectorTargetChild = Just c}");
  });

  it("only unconnected ends move", () => {
    expect(moveEnd(Unconnected(Point(1, 1)), [2, 3]).connectorPoint).toEqual(Point(3, 4));
    expect(moveEnd(Connected(Point(1, 1), "a", Nothing), [2, 3]).connectorPoint).toEqual(Point(1, 1));
    const [e1, e2] = moveEnds([Unconnected(Point(0, 0)), Connected(Point(1, 1), "a", Nothing)], [1, 1]);
    expect(e1.connectorPoint).toEqual(Point(1, 1));
    expect(e2.connectorPoint).toEqual(Point(1, 1));
  });

  it("isConnectedTo", () => {
    expect(isConnectedTo(Connected(Point(1, 1), "a", Nothing), "a")).toBe(true);
    expect(isConnectedTo(Connected(Point(1, 1), "a", Nothing), "b")).toBe(false);
    expect(isConnectedTo(Unconnected(Point(1, 1)), "a")).toBe(false);
  });
});

describe("Connectable defaults", () => {
  it("do nothing", () => {
    const defs = connectableDefaults<Item>();
    const d = mkCtx([boxA]);
    expect(run(defs.itemCanConnect(d, "ConnectionFrom", wire, boxA, Nothing))).toBe(false);
    expect(toListOf(defs.itemConnectors, wire)).toEqual([]);
    expect(over(defs.itemConnectors, () => Unconnected(Point(0, 0)), wire)).toBe(wire);
    expect(run(defs.itemConnectionPoint(d, boxA, Nothing))(Point(3, 4))).toEqual(Point(3, 4));
    expect(run(defs.itemPegAt(d, label, "w", 0.5))).toEqual(Nothing);
    expect(run(defs.itemUnpeg(d, label))).toBe(label);
    expect(toListOf(defs.itemPeg, label)).toEqual([]);
    expect(run(defs.itemPegPoint(d, ["w", 0.5]))).toEqual(Nothing);
    expect(connectable(d)).toBe(cls);
  });
});

describe("Delta functions", () => {
  it("getAllConnected and getAllPegged", () => {
    const d = mkCtx([boxA, boxB, wire, label]);
    expect(run(getAllConnected(d, "a")).map((v) => v.id)).toEqual(["w"]);
    expect(run(getAllConnected(d, "b"))).toEqual([]);
    expect(run(getAllPegged(d, "w")).map((v) => v.id)).toEqual(["l"]);
    expect(run(getAllPegged(d, "a"))).toEqual([]);
  });

  it("mkEndPoint connects to boxes under the point", () => {
    const d = mkCtx([boxA, boxB, wire]);
    const c = run(mkEndPoint(d, "ConnectionTo", wire, Point(25, 5)));
    expect(c.tag).toBe("Connected");
    expect(equals(c, Connected(Point(25, 5), "b", Nothing))).toBe(true);
    expect(c.connectorPoint).toEqual(Point(25, 5));
    const u = run(mkEndPoint(d, "ConnectionTo", wire, Point(15, 5)));
    expect(u.tag).toBe("Unconnected");
    expect(u.connectorPoint).toEqual(Point(15, 5));
    // Over the wire itself only: the wire is not a valid target.
    const w = run(mkEndPoint(d, "ConnectionTo", wire, Point(40, 40)));
    expect(w.tag).toBe("Unconnected");
  });

  it("optimiseEnds", () => {
    const d = mkCtx([boxA, boxB]);
    // Both unconnected: no change.
    const u1 = Unconnected(Point(1, 1)), u2 = Unconnected(Point(2, 2));
    expect(run(optimiseEnds(d, [u1, u2]))).toEqual([u1, u2]);
    // One end connected.
    const [s1, s2] = run(optimiseEnds(d, [Unconnected(Point(50, 5)), Connected(Point(25, 5), "b", Nothing)]));
    expect(s1.connectorPoint).toEqual(Point(50, 5));
    expect(s2.tag).toBe("Connected");
    expect(s2.connectorPoint).toEqual(Point(30, 5));
    // Same, the other way round.
    const [r1, r2] = run(optimiseEnds(d, [Connected(Point(25, 5), "b", Nothing), Unconnected(Point(50, 5))]));
    expect(r1.tag).toBe("Connected");
    expect(r1.connectorPoint).toEqual(Point(30, 5));
    expect(r2.connectorPoint).toEqual(Point(50, 5));
    // Both connected: iterate to the facing sides of the boxes.
    const [b1, b2] = run(optimiseEnds(d, [Connected(Point(5, 5), "a", Nothing), Connected(Point(25, 5), "b", Nothing)]));
    expect(b1.connectorPoint).toEqual(Point(10, 5));
    expect(b2.connectorPoint).toEqual(Point(20, 5));
    expect(b1.tag === "Connected" && b1.connectorTarget).toBe("a");
    expect(b2.tag === "Connected" && b2.connectorTarget).toBe("b");
    // Connections to missing items become unconnected.
    const [m1, m2] = run(optimiseEnds(d, [Connected(Point(5, 5), "x", Nothing), Connected(Point(25, 5), "b", Nothing)]));
    expect(m1).toEqual(Unconnected(Point(5, 5)));
    expect(m2.tag).toBe("Connected");
    expect(m2.connectorPoint).toEqual(Point(20, 5));
    const [n1, n2] = run(optimiseEnds(d, [Connected(Point(25, 5), "b", Nothing), Connected(Point(5, 5), "x", Nothing)]));
    expect(n1.tag).toBe("Connected");
    expect(n1.connectorPoint).toEqual(Point(20, 5));
    expect(n2).toEqual(Unconnected(Point(5, 5)));
    const [o1, o2] = run(optimiseEnds(d, [Unconnected(Point(0, 0)), Connected(Point(5, 5), "x", Nothing)]));
    expect(o1).toEqual(Unconnected(Point(0, 0)));
    expect(o2).toEqual(Unconnected(Point(5, 5)));
  });

  it("the diagram is not changed by queries", () => {
    const d = mkCtx([boxA, boxB, wire]);
    const before = d.state;
    run(getAllConnected(d, "a"));
    run(mkEndPoint(d, "ConnectionFrom", wire, Point(5, 5)));
    expect(d.state).toBe(before);
    expect(M.size(d.state._deltaDiagram._diagramContents)).toBe(3);
  });
});
