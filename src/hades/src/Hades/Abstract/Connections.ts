// Ported from hades/src/Hades/Abstract/Connections.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Connections between diagram elements: connector end points, pegs and the `Connectable` class.
 *
 * TypeScript port
 * ---------------
 * * `ConnectorEnd` is a tagged union (`Unconnected` / `Connected`) with record fields
 *   `connectorPoint`, `connectorTarget`, `connectorTargetChild`. Always build values with the
 *   `Unconnected` / `Connected` constructor functions: they attach the hand-written `Eq`
 *   instance (which ignores the location of a connected end) as an `[EqSym]` method, so the
 *   structural `equals` from `@/lib/Data/Ord` (and hence the derived `Eq` of anything that
 *   contains a `ConnectorEnd`) behaves as in Haskell. `eq_ConnectorEnd` is the same test as a
 *   plain function.
 * * The `Connectable` class is the `Connectable<V>` dictionary, which extends `Viewable<V>`.
 *   The Delta-monad methods take the `DeltaCtx` first. The class defaults are available from
 *   `connectableDefaults()` for instances to spread into their dictionaries.
 * * Within a Delta computation the dictionary is `d.cls`; `connectable(d)` returns it typed as
 *   a `Connectable<V>`.
 */
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { EqSym, equals } from "@/lib/Data/Ord";
import { use, toListOf, preview, ignored, _1, type Traversal } from "@/lib/Control/Lens";
import { absurd } from "@/lib/Prelude";
import {
  type Delta, type DeltaCtx, type Viewable, deltaDiagram, deltaZoom, diagramAt,
} from "./Delta";
import { type DiagramId, diagramContents } from "./Diagram";
import { type Point, JSON_Point, movePoint, pointDiff, show_Point } from "./Geometry";

/**
 * A connector end point may be a point on the diagram or on a diagram element.
 * The "Eq" instance ignores the location.
 */
export type ConnectorEnd =
  | { readonly tag: "Unconnected"; readonly connectorPoint: Point }
  | {
    readonly tag: "Connected";
    readonly connectorPoint: Point;
    readonly connectorTarget: DiagramId;
    /**
     * Diagram elements may optionally have a list of child entities that can be
     * connected to independently. If so then this may contain the child ID.
     */
    readonly connectorTargetChild: Maybe<DiagramId>;
  };

/** `instance Eq ConnectorEnd` */
export function eq_ConnectorEnd(c1: ConnectorEnd, c2: ConnectorEnd): boolean {
  if (c1.tag === "Unconnected" && c2.tag === "Unconnected") return equals(c1.connectorPoint, c2.connectorPoint);
  if (c1.tag === "Connected" && c2.tag === "Connected") {
    return c1.connectorTarget === c2.connectorTarget && equals(c1.connectorTargetChild, c2.connectorTargetChild);
  }
  return false;
}

/** The `[EqSym]` method shared by all `ConnectorEnd` values. */
function connectorEndEq(this: ConnectorEnd, other: unknown): boolean {
  return typeof other === "object" && other !== null && "tag" in other &&
    (other.tag === "Unconnected" || other.tag === "Connected") &&
    eq_ConnectorEnd(this, other as ConnectorEnd);
}

function withEq(c: ConnectorEnd): ConnectorEnd {
  return Object.assign(c, { [EqSym]: connectorEndEq });
}

export function Unconnected(connectorPoint: Point): ConnectorEnd {
  return withEq({ tag: "Unconnected", connectorPoint });
}

export function Connected(
  connectorPoint: Point,
  connectorTarget: DiagramId,
  connectorTargetChild: Maybe<DiagramId>,
): ConnectorEnd {
  return withEq({ tag: "Connected", connectorPoint, connectorTarget, connectorTargetChild });
}

/** `instance Show ConnectorEnd` (derived). */
export function show_ConnectorEnd(c: ConnectorEnd): string {
  switch (c.tag) {
    case "Unconnected": return `Unconnected {connectorPoint = ${show_Point(c.connectorPoint)}}`;
    case "Connected": {
      const child = c.connectorTargetChild.tag === "Just" ? `Just ${c.connectorTargetChild.value}` : "Nothing";
      return `Connected {connectorPoint = ${show_Point(c.connectorPoint)}, connectorTarget = ${c.connectorTarget}, ` +
        `connectorTargetChild = ${child}}`;
    }
    default: return absurd(c);
  }
}

/** `instance ToJSON ConnectorEnd` and `instance FromJSON ConnectorEnd` */
export const JSON_ConnectorEnd: J.JSONCodec<ConnectorEnd> = J.codec(
  (c): J.Value => {
    switch (c.tag) {
      case "Unconnected":
        return J.object([["state", "unconnected"], ["point", JSON_Point.toJSON(c.connectorPoint)]]);
      case "Connected": {
        const base: [string, J.Value][] = [
          ["state", "connected"],
          ["point", JSON_Point.toJSON(c.connectorPoint)],
          ["target", J.uuidJ.toJSON(c.connectorTarget)],
        ];
        const child = c.connectorTargetChild;
        return child.tag === "Nothing" ? J.object(base) : J.object([["child", J.uuidJ.toJSON(child.value)], ...base]);
      }
      default: return absurd(c);
    }
  },
  (v) => J.withObject("connector end", (o) => {
    const s = J.field(o, "state", J.textJ);
    switch (s) {
      case "unconnected": return Unconnected(J.field(o, "point", JSON_Point));
      case "connected":
        return Connected(J.field(o, "point", JSON_Point), J.field(o, "target", J.uuidJ), J.fieldMaybe(o, "child", J.uuidJ));
      default: return J.fail("Unknown connector end state: " + s);
    }
  }, v),
);

/**
 * The start and ends of a connector as a pair. Note that in the Lens library the "both"
 * traversal is a handy way of doing something to both ends at once.
 */
export type Terminators = readonly [ConnectorEnd, ConnectorEnd];

/** `JSON` codec for `Terminators` (a pair, encoded as a two-element array). */
export const JSON_Terminators: J.JSONCodec<Terminators> = J.tuple2J(JSON_ConnectorEnd, JSON_ConnectorEnd);

/**
 * For elements that have directed connections with other elements, this distinguishes the
 * direction of the relationship.
 */
export type ConnectionDirection = "ConnectionFrom" | "ConnectionTo";
export const connectionDirectionValues: readonly ConnectionDirection[] = ["ConnectionFrom", "ConnectionTo"];

/** A peg represents a possible attachment of a box shape to a point part-way along a line. */
export type Peg = readonly [DiagramId, number];

/**
 * Diagram types where some lines can be connected to boxes, and some boxes can be
 * pegged on to lines.
 *
 * The default implementations (see `connectableDefaults`) are suitable for types where no such
 * associations are possible.
 */
export interface Connectable<V> extends Viewable<V> {
  /** Can the specified end of the first element connect to the second element? */
  itemCanConnect(d: DeltaCtx<V>, dir: ConnectionDirection, v1: V, v2: V, child: Maybe<DiagramId>): Delta<V, boolean>;
  /** Each item may have zero or more connectors, which may be modified. */
  readonly itemConnectors: Traversal<V, ConnectorEnd>;
  /**
   * Given a line from the point to the element, where should the line terminate?
   * The "DiagramId" argument specifies which child (if any) the connector will attach to.
   */
  itemConnectionPoint(d: DeltaCtx<V>, v: V, child: Maybe<DiagramId>): Delta<V, (p: Point) => Point>;
  /**
   * Attempt to peg the item to the argument. Returns the new value if it succeeds.
   * Does not write the new value back to the diagram.
   */
  itemPegAt(d: DeltaCtx<V>, v: V, target: DiagramId, pos: number): Delta<V, Maybe<V>>;
  /** Attempt to unpeg the item. No-op by default. */
  itemUnpeg(d: DeltaCtx<V>, v: V): Delta<V, V>;
  /** The point where this item is pegged, if any. */
  readonly itemPeg: Traversal<V, Peg>;
  /** The point where the item is pegged to, assuming the peg is valid. */
  itemPegPoint(d: DeltaCtx<V>, peg: Peg): Delta<V, Maybe<Point>>;
  /**
   * Used when the item is connected in some way to other items, and those items have been
   * changed. The item will adjust itself in the diagram and update its views in response.
   */
  itemAdjust(d: DeltaCtx<V>, v: V): Delta<V, void>;
}

/** The members of `Connectable` that have default implementations in the Haskell class. */
export type ConnectableDefaults<V> = Pick<
  Connectable<V>,
  "itemCanConnect" | "itemConnectors" | "itemConnectionPoint" | "itemPegAt" | "itemUnpeg" | "itemPeg" | "itemPegPoint"
>;

/**
 * The default method implementations of the `Connectable` class. An instance spreads these into
 * its dictionary and overrides as required:
 * `{ ...Viewable_Foo, ...connectableDefaults<Foo>(), itemAdjust: ... }`.
 */
export function connectableDefaults<V>(): ConnectableDefaults<V> {
  return {
    *itemCanConnect(_d, _dir, _v1, _v2, _child) {
      return false;
    },
    itemConnectors: ignored<V, ConnectorEnd>(),
    *itemConnectionPoint(_d, _v, _child) {
      return (p: Point) => p;
    },
    *itemPegAt(_d, _v, _target, _pos) {
      return Nothing;
    },
    *itemUnpeg(_d, v) {
      return v;
    },
    itemPeg: ignored<V, Peg>(),
    *itemPegPoint(_d, _peg) {
      return Nothing;
    },
  };
}

/** The `Connectable` dictionary of a Delta computation (`d.cls`). */
export function connectable<V>(d: DeltaCtx<V>): Connectable<V> {
  return d.cls as Connectable<V>;
}

/**
 * If you try to move a "ConnectorEnd" it will only move if it is not connected to something.
 * Hence the connector position cannot be a lens.
 */
export function moveEnd(c: ConnectorEnd, dPos: readonly [number, number]): ConnectorEnd {
  return c.tag === "Unconnected" ? Unconnected(movePoint(c.connectorPoint, dPos)) : c;
}

/** Predicate: is this connected to the item referenced by the UUID? */
export function isConnectedTo(c: ConnectorEnd, uuid: DiagramId): boolean {
  switch (c.tag) {
    case "Unconnected": return false;
    case "Connected": return c.connectorTarget === uuid;
    default: return absurd(c);
  }
}

/** Find all the diagram elements with connectors linking to the specified item. */
export function* getAllConnected<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, V[]> {
  const cls = connectable(d);
  const check = (v: V): boolean => toListOf(cls.itemConnectors, v).some((c) => isConnectedTo(c, uuid));
  return M.elems(use(d, deltaDiagram<V>().dot(diagramContents<V>()))).filter(check);
}

/** Find all the diagram elements which are pegged to the argument. */
export function* getAllPegged<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, V[]> {
  const cls = connectable(d);
  const pegTarget = cls.itemPeg.dot(_1<DiagramId, number>());
  const check = (v: V): boolean => equals(preview(pegTarget, v), Just(uuid));
  return M.elems(use(d, deltaDiagram<V>().dot(diagramContents<V>()))).filter(check);
}

/** Apply a vector to both ends. */
export function moveEnds(t: Terminators, dPos: readonly [number, number]): [ConnectorEnd, ConnectorEnd] {
  const [t1, t2] = t;
  return [moveEnd(t1, dPos), moveEnd(t2, dPos)];
}

/**
 * If the Point is over an element satisfying the "itemCanConnect" predicate then generate a
 * connector to it. Otherwise generate an Unconnected end point.
 */
export function* mkEndPoint<V>(
  d: DeltaCtx<V>,
  /** The end we are trying to connect. */
  end: ConnectionDirection,
  /** The diagram element with an end point. */
  line: V,
  /** Where the end point is currently located. */
  pt: Point,
): Delta<V, ConnectorEnd> {
  const cls = connectable(d);
  const scale = use(d, deltaZoom<V>());
  const diagram = use(d, deltaDiagram<V>());
  const predicate = (d1: DeltaCtx<V>, v: V, child: Maybe<DiagramId>): Delta<V, boolean> =>
    cls.itemCanConnect(d1, end, line, v, child);
  const r = yield* diagramAt(d, scale, pt, predicate, diagram);
  if (r.tag === "Nothing") return Unconnected(pt);
  const [v, child] = r.value;
  const pt1 = (yield* cls.itemConnectionPoint(d, v, child))(pt);
  return Connected(pt1, cls.identifier(v), child);
}

/**
 * Under some circumstances (especially when connected at both ends) the correct
 * end points for a line can require iteration. This function
 * will return end points that are close enough. The first argument is the iteration limit.
 */
function optimisePoints(
  /** Iteration limit. */
  n: number,
  /** Starting point for end 1. */
  p1: Point,
  /** Line connection point at end 1 for a line starting at end 2. */
  f1: (p: Point) => Point,
  /** Starting point for end 2. */
  p2: Point,
  /** Line connection point at end 2 for a line starting at end 1. */
  f2: (p: Point) => Point,
): [Point, Point] {
  // Use rectangular distance because its faster to compute.
  const dist = (p: Point, q: Point): number => {
    const [dx, dy] = pointDiff(p, q);
    return Math.abs(dx) + Math.abs(dy);
  };
  for (;;) {
    const p1a = f1(p2);
    const p2a = f2(p1);
    if (n <= 0 || dist(p1, p1a) + dist(p2, p2a) < 0.1) return [p1, p2];
    n = n - 1;
    p1 = p1a;
    p2 = p2a;
  }
}

/**
 * Like optimisePoints, but applied to Terminators. If one of the ends is connected to
 * an element that is not in the diagram then the function returns an
 * "Unconnected" instead.
 */
export function* optimiseEnds<V>(d: DeltaCtx<V>, t: Terminators): Delta<V, [ConnectorEnd, ConnectorEnd]> {
  const cls = connectable(d);
  const [c1, c2] = t;
  if (c1.tag === "Unconnected" && c2.tag === "Unconnected") return [c1, c2];
  if (c1.tag === "Unconnected" && c2.tag === "Connected") {
    const p1 = c1.connectorPoint;
    const { connectorPoint: p2, connectorTarget: uuid, connectorTargetChild: child } = c2;
    const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
    const target = M.lookup(uuid, cs);
    if (target.tag === "Nothing") return [c1, Unconnected(p2)];
    const p2a = (yield* cls.itemConnectionPoint(d, target.value, child))(p1);
    return [c1, Connected(p2a, uuid, child)];
  }
  if (c1.tag === "Connected" && c2.tag === "Unconnected") {
    const [c2a, c1a] = yield* optimiseEnds(d, [c2, c1]);
    return [c1a, c2a];
  }
  if (c1.tag === "Connected" && c2.tag === "Connected") {
    const { connectorPoint: p1, connectorTarget: uuid1, connectorTargetChild: child1 } = c1;
    const { connectorPoint: p2, connectorTarget: uuid2, connectorTargetChild: child2 } = c2;
    const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
    const target1 = M.lookup(uuid1, cs);
    if (target1.tag === "Nothing") return yield* optimiseEnds(d, [Unconnected(p1), c2]);
    const target2 = M.lookup(uuid2, cs);
    if (target2.tag === "Nothing") {
      const p1a = (yield* cls.itemConnectionPoint(d, target1.value, child1))(p2);
      return [Connected(p1a, uuid1, child1), Unconnected(p2)];
    }
    const f1 = yield* cls.itemConnectionPoint(d, target1.value, child1);
    const f2 = yield* cls.itemConnectionPoint(d, target2.value, child2);
    const [p1a, p2a] = optimisePoints(10, p1, f1, p2, f2);
    return [Connected(p1a, uuid1, child1), Connected(p2a, uuid2, child2)];
  }
  // Unreachable: all four combinations are covered above.
  throw new Error("optimiseEnds: impossible ConnectorEnd combination");
}
