// Ported from hades/src/Hades/Abstract/Geometry.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Basic geometry for diagrams: points, bounding boxes, lines, intersections, ellipses and
 * constraints.
 *
 * TypeScript port
 * ---------------
 * * `Point` is a record `{_pX, _pY}`; `BoundBox` is the tagged union `BoundBox _0 _1 | NoBox`;
 *   `Line` is the positional record `{_0: start, _1: vx, _2: vy}`.
 * * The `Intersect` class is the `Intersect<A>` dictionary; its instances are `Intersect_Line`
 *   and `Intersect_List(cls)`.
 * * A `Constraint` is a function `(p: Point) => Point`. The constraint constructors
 *   (`constrainLine`, `constrainBox`, `constrainQ1` ...) return a `Constraint` when given one
 *   argument, as in Haskell, and also accept the point to constrain as a second argument.
 * * `min`/`max`/`minimum`/`maximum` follow the Haskell `Ord Double` definitions
 *   (`min x y = if x <= y then x else y`), which differ from `Math.min` for NaN and -0.
 * * The derived `Read` instances of `Point` and `BoundBox` are not ported (nothing reads them).
 */
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing, type Maybe, mapMaybe } from "@/lib/Data/Maybe";
import { lens, view, over, type Lens } from "@/lib/Control/Lens";
import { absurd, error, showDouble } from "@/lib/Prelude";

// ---------------------------------------------------------------------------------------------
// Local helpers for the Haskell `Ord Double` semantics.

/** Haskell `min` on `Double`. */
function hmin(x: number, y: number): number {
  return x <= y ? x : y;
}

/** Haskell `max` on `Double`. */
function hmax(x: number, y: number): number {
  return x <= y ? y : x;
}

/** Haskell `minimum` on a non-empty list of `Double` (`foldl1 min`). */
function hminimum(xs: readonly number[]): number {
  if (xs.length === 0) return error("Prelude.minimum: empty list");
  return xs.reduce(hmin);
}

/** Haskell `maximum` on a non-empty list of `Double` (`foldl1 max`). */
function hmaximum(xs: readonly number[]): number {
  if (xs.length === 0) return error("Prelude.maximum: empty list");
  return xs.reduce(hmax);
}

// ---------------------------------------------------------------------------------------------
// Basic Geometry

/** Position on a diagram */
export interface Point {
  readonly _pX: number;
  readonly _pY: number;
}
export function Point(_pX: number, _pY: number): Point {
  return { _pX, _pY };
}

/** `instance Show Point` (derived). */
export function show_Point(p: Point): string {
  return `Point {_pX = ${showDouble(p._pX)}, _pY = ${showDouble(p._pY)}}`;
}

/** `instance ToJSON Point` and `instance FromJSON Point` */
export const JSON_Point: J.JSONCodec<Point> = J.codec(
  (p) => J.object([["x", J.doubleJ.toJSON(p._pX)], ["y", J.doubleJ.toJSON(p._pY)]]),
  (v) => J.withObject("Point", (o) => Point(J.field(o, "x", J.doubleJ), J.field(o, "y", J.doubleJ)), v),
);

export const pX: Lens<Point, number> = lens((p: Point) => p._pX, (p, v: number) => ({ ...p, _pX: v }));
export const pY: Lens<Point, number> = lens((p: Point) => p._pY, (p, v: number) => ({ ...p, _pY: v }));

/** Move a point by (x,y) relative. */
export function movePoint(p: Point, d: readonly [number, number]): Point {
  return Point(p._pX + d[0], p._pY + d[1]);
}

/** Vector from p1 to p2. */
export function pointDiff(p1: Point, p2: Point): [number, number] {
  return [p2._pX - p1._pX, p2._pY - p1._pY];
}

/** Distance represented by an (x,y) relative pair. */
export function distance(d: readonly [number, number]): number {
  const [dx, dy] = d;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Diagram scaling factor. */
export type Scale = number;

// ---------------------------------------------------------------------------------------------
// Bounding Boxes

/** Bounding box in diagram space. Monoid instance is union. */
export type BoundBox =
  /** First point <= second point in both pX and pY. */
  | { readonly tag: "BoundBox"; readonly _0: Point; readonly _1: Point }
  | { readonly tag: "NoBox" };

/** First point <= second point in both pX and pY. */
export function BoundBox(_0: Point, _1: Point): BoundBox {
  return { tag: "BoundBox", _0, _1 };
}
export const NoBox: BoundBox = { tag: "NoBox" };

/** `instance Show BoundBox` (derived). */
export function show_BoundBox(b: BoundBox): string {
  switch (b.tag) {
    case "NoBox": return "NoBox";
    case "BoundBox": return `BoundBox (${show_Point(b._0)}) (${show_Point(b._1)})`;
    default: return absurd(b);
  }
}

/** `instance Semigroup BoundBox` */
export function append_BoundBox(a: BoundBox, b: BoundBox): BoundBox {
  if (a.tag === "NoBox") return b;
  if (b.tag === "NoBox") return a;
  const p1a = a._0, p2a = a._1, p1b = b._0, p2b = b._1;
  return BoundBox(
    Point(hmin(p1a._pX, p1b._pX), hmin(p1a._pY, p1b._pY)),
    Point(hmax(p2a._pX, p2b._pX), hmax(p2a._pY, p2b._pY)),
  );
}

/** `instance Monoid BoundBox` */
export const mempty_BoundBox: BoundBox = NoBox;

/** `mconcat` for bound boxes. */
export function mconcat_BoundBox(bs: readonly BoundBox[]): BoundBox {
  return bs.reduceRight((acc: BoundBox, b) => append_BoundBox(b, acc), mempty_BoundBox);
}

/** `instance ToJSON BoundBox` and `instance FromJSON BoundBox` */
export const JSON_BoundBox: J.JSONCodec<BoundBox> = J.codec(
  (b): J.Value => {
    switch (b.tag) {
      case "NoBox": return "NoBox";
      case "BoundBox": return J.object([["p1", JSON_Point.toJSON(b._0)], ["p2", JSON_Point.toJSON(b._1)]]);
      default: return absurd(b);
    }
  },
  (v) => {
    if (v === "NoBox") return NoBox;
    return J.withObject("BoundBox", (v1) => BoundBox(J.field(v1, "p1", JSON_Point), J.field(v1, "p2", JSON_Point)), v);
  },
);

/** Safely make a bounding box in which @p1 <= p2@ in both @x@ and @y@. */
export function mkBoundBox(p1: Point, p2: Point): BoundBox {
  const [x1, x2] = sort2([p1._pX, p2._pX]);
  const [y1, y2] = sort2([p1._pY, p2._pY]);
  return BoundBox(Point(x1, y1), Point(x2, y2));
}

/** Make a boundbox if @p1 < p2@ for both @x@ and @y@, or else return @NoBox@. */
export function mkConstrainedBox(p1: Point, p2: Point): BoundBox {
  return view(pX, p1) < view(pX, p2) && view(pY, p1) < view(pY, p2) ? BoundBox(p1, p2) : NoBox;
}

/**
 * Lens for the center of a bounding box. This is a partial function: if the box is "NoBox" then
 * it will fail.
 *
 * (Setting the centre of a "NoBox" fails with the getter's message here, because the TypeScript
 * lens evaluates the getter before calling the setter.)
 */
export const boxCentre: Lens<BoundBox, Point> = (() => {
  const av = (v1: number, v2: number): number => (v1 + v2) / 2.0;
  const getCenter = (box: BoundBox): Point => {
    switch (box.tag) {
      case "BoundBox": return Point(av(box._0._pX, box._1._pX), av(box._0._pY, box._1._pY));
      case "NoBox": return error("boxCenter does not exist for NoBox.");
      default: return absurd(box);
    }
  };
  const setCenter = (box: BoundBox, p: Point): BoundBox => {
    switch (box.tag) {
      case "BoundBox": {
        const c = getCenter(box);
        const v: [number, number] = [p._pX - c._pX, p._pY - c._pY];
        return BoundBox(movePoint(box._0, v), movePoint(box._1, v));
      }
      case "NoBox": return error("boxCenter cannot be set for NoBox.");
      default: return absurd(box);
    }
  };
  return lens(getCenter, setCenter);
})();

/**
 * Get the width of the box.
 *
 * This is not a lens because a negative width box is not possible.
 */
export function boxWidth(b: BoundBox): number {
  return b.tag === "NoBox" ? 0 : b._1._pX - b._0._pX;
}

/** Get the height of the box. */
export function boxHeight(b: BoundBox): number {
  return b.tag === "NoBox" ? 0 : b._1._pY - b._0._pY;
}

/**
 * Change the width and height without moving the centre. May result in a zero size box.
 * No-operation on a "NoBox".
 */
export function boxResize(wh: readonly [number, number], box: BoundBox): BoundBox {
  if (box.tag === "NoBox") return NoBox;
  const [w, h] = wh;
  const c = view(boxCentre, box);
  const w1 = hmax(0, w) / 2;
  const h1 = hmax(0, h) / 2;
  return BoundBox(movePoint(c, [-w1, -h1]), movePoint(c, [w1, h1]));
}

/** Move a box by (x,y) relative. */
export function moveBox(box: BoundBox, v: readonly [number, number]): BoundBox {
  if (box.tag === "NoBox") return NoBox;
  return BoundBox(movePoint(box._0, v), movePoint(box._1, v));
}

/**
 * Add an extra border to a BoundBox to allow for additional decoration around the perimeter,
 * such as thicker lines or shadows.
 */
export function growBox(k: number, box: BoundBox): BoundBox {
  if (box.tag === "NoBox") return NoBox;
  const k_ = Math.abs(k);
  return BoundBox(movePoint(box._0, [-k_, -k_]), movePoint(box._1, [k_, k_]));
}

/**
 * Add an extra border inside a BoundBox. Note that the result may be NoBox if the new width
 * or height would be less than zero.
 */
export function shrinkBox(k: number, box: BoundBox): BoundBox {
  if (box.tag === "NoBox") return NoBox;
  const { _pX: x1, _pY: y1 } = box._0;
  const { _pX: x2, _pY: y2 } = box._1;
  const nx1 = x1 + k;
  const ny1 = y1 + k;
  const nx2 = x2 - k;
  const ny2 = y2 - k;
  return nx1 <= nx2 && ny1 <= ny2 ? BoundBox(Point(nx1, ny1), Point(nx2, ny2)) : NoBox;
}

/** Point in bounding box? */
export function inBox(p: Point, box: BoundBox): boolean {
  if (box.tag === "NoBox") return false;
  const p1 = box._0, p2 = box._1;
  return p1._pX <= p._pX && p._pX <= p2._pX &&
    p1._pY <= p._pY && p._pY <= p2._pY;
}

/** Boxes overlap? */
export function overlapBox(b1: BoundBox, b2: BoundBox): boolean {
  if (b1.tag === "NoBox") return false;
  if (b2.tag === "NoBox") return false;
  const overlap = (v1a: number, v1b: number, v2a: number, v2b: number): boolean =>
    v1b >= v2a && v2b >= v1a;
  const p1a = b1._0, p1b = b1._1, p2a = b2._0, p2b = b2._1;
  return overlap(p1a._pX, p1b._pX, p2a._pX, p2b._pX) &&
    overlap(p1a._pY, p1b._pY, p2a._pY, p2b._pY);
}

/** Box1 entirely contains Box2 */
export function containsBox(box1: BoundBox, box2: BoundBox): boolean {
  if (box1.tag === "NoBox") return false;
  if (box2.tag === "NoBox") return false;
  return inBox(box2._0, box1) && inBox(box2._1, box1);
}

/**
 * The scaling factor required to fit the first box into the width and height of the second.
 * Result will always be less than or equal to 1. The absolute positions are ignored.
 */
export function fitIntoBox(box1: BoundBox, box2: BoundBox): number {
  const wScale = hmin(1, boxWidth(box2) / boxWidth(box1));
  const hScale = hmin(1, boxHeight(box2) / boxHeight(box1));
  return hmin(wScale, hScale);
}

// ---------------------------------------------------------------------------------------------
// Lines

/**
 * A line is represented as a parametric equation with a start point and a vector.
 * (`data Line = Line Point Double Double`: `_0` is the start point, `_1` and `_2` the x and y
 * components of the vector.)
 */
export interface Line {
  readonly _0: Point;
  readonly _1: number;
  readonly _2: number;
}
export function Line(_0: Point, _1: number, _2: number): Line {
  return { _0, _1, _2 };
}

/** A point on the line. */
export function linePoint(line: Line, d: number): Point {
  const { _0: pt, _1: vx, _2: vy } = line;
  return movePoint(pt, [vx * d, vy * d]);
}

/**
 * Line between pt1 and pt2.
 *
 * If @l = lineFromPoints p1 p2@ then:
 *
 * > linePoint l 0 == p1
 * > linePoint l 1 == p2
 */
export function lineFromPoints(p1: Point, p2: Point): Line {
  const [vx, vy] = pointDiff(p1, p2);
  return Line(p1, vx, vy);
}

/**
 * The intersection of two lines as the parametric argument for each line.
 * Returns @Nothing@ if the lines are parallel or the same line.
 */
export function lineIntersection(line1: Line, line2: Line): Maybe<[number, number]> {
  const { _0: p1, _1: vx1, _2: vy1 } = line1;
  const { _0: p2, _1: vx2, _2: vy2 } = line2;
  const d = vx2 * vy1 - vx1 * vy2;
  const [sx, sy] = pointDiff(p1, p2);
  return d === 0.0
    ? Nothing
    : Just([(vx2 * sy - sx * vy2) / d, (vx1 * sy - sx * vy1) / d] as [number, number]);
}

/** The intersection point of two lines. */
function lineIntersectionPoint(line1: Line, line2: Line): Maybe<Point> {
  const r = lineIntersection(line1, line2);
  return r.tag === "Just" ? Just(linePoint(line1, r.value[0])) : Nothing;
}

/** A line 90 degrees anti-clockwise to the argument starting at the given point. */
export function lineNormal(line: Line, pt: Point): Line {
  return Line(pt, -line._2, line._1);
}

/**
 * The distance of a point from a line, provided the closest point is within a parametric
 * argument between 0 and 1.
 */
export function lineDistance(line: Line, point: Point): Maybe<number> {
  const r = lineIntersection(line, lineNormal(line, point));
  if (r.tag === "Nothing") return Nothing; // Line must be zero length.
  const t1 = r.value[0];
  return t1 >= 0.0 && t1 <= 1.0 ? Just(distance(pointDiff(point, linePoint(line, t1)))) : Nothing;
}

/**
 * Is the point inside the polygon defined by the list of vertices? Uses the
 * \"winding number inclusion\" algorithm of http://geomalgorithms.com/a03-_inclusion.html
 */
export function insidePolygon(vertices: readonly Point[], testPoint: Point): boolean {
  if (vertices.length < 3) return false;
  // List functions can assume vertices contains 3 or more points.
  const ty = testPoint._pY;
  const isLeft = (l: readonly [Point, Point], p2: Point): number => {
    const [{ _pX: x0, _pY: y0 }, { _pX: x1, _pY: y1 }] = l;
    const { _pX: x2, _pY: y2 } = p2;
    return (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  };
  const winding = (l: readonly [Point, Point]): number => {
    const y0 = l[0]._pY, y1 = l[1]._pY;
    if (y0 <= ty) return y1 > ty && isLeft(l, testPoint) > 0 ? 1 : 0;
    if (y1 <= ty && isLeft(l, testPoint) < 0) return -1;
    return 0;
  };
  const edges: [Point, Point][] = [[vertices[vertices.length - 1], vertices[0]]];
  for (let i = 0; i + 1 < vertices.length; i++) edges.push([vertices[i], vertices[i + 1]]);
  return edges.map(winding).reduce((a, b) => a + b, 0) !== 0;
}

/** The lines that make up the polygon defined by the list of vertices. */
export function polygonLines(pts: readonly Point[]): Line[] {
  if (pts.length < 2) return [];
  const pts1 = [pts[pts.length - 1], ...pts];
  const r: Line[] = [];
  for (let i = 0; i + 1 < pts1.length; i++) r.push(lineFromPoints(pts1[i], pts1[i + 1]));
  return r;
}

/**
 * The boundbox of a list of vertices.
 *
 * (The Haskell version builds the box lazily, so an empty list only fails when a coordinate is
 * inspected. Here it fails immediately.)
 */
export function polygonBox(pts: readonly Point[]): BoundBox {
  const xs = pts.map((p) => view(pX, p));
  const ys = pts.map((p) => view(pY, p));
  return BoundBox(Point(hminimum(xs), hminimum(ys)), Point(hmaximum(xs), hmaximum(ys)));
}

// ---------------------------------------------------------------------------------------------
// Intersects

/**
 * Intersects are geometric elements that can compute the intersection of a line with the
 * element. The list instance finds the intersection with the lowest parameter.
 */
export interface Intersect<A> {
  /**
   * Return the parameter for the argument line such that "linePoint" gives the point
   * of intersection. If there are multiple intersects then return the lowest parameter.
   * If there are no intersects then return "Nothing".
   */
  intersectWith(a: A, line: Line): Maybe<number>;
}

/** `instance Intersect Line` */
export const Intersect_Line: Intersect<Line> = {
  intersectWith(line1: Line, line2: Line): Maybe<number> {
    // Maybe monad
    const r = lineIntersection(line1, line2);
    if (r.tag === "Nothing") return Nothing;
    const [i1, i2] = r.value;
    if (!(0.0 <= i1 && i1 <= 1.0)) return Nothing;
    return Just(i2);
  },
};

/** `instance (Intersect a) => Intersect [a]` */
export function Intersect_List<A>(cls: Intersect<A>): Intersect<readonly A[]> {
  return {
    intersectWith(xs: readonly A[], line: Line): Maybe<number> {
      const vs = mapMaybe((x: A) => cls.intersectWith(x, line), xs);
      return vs.length === 0 ? Nothing : Just(hminimum(vs));
    },
  };
}

/**
 * Given an Intersect and two points, this returns the point of intersection on the line
 * between them.
 */
export function intersectPoint<A>(cls: Intersect<A>, shape: A, p1: Point, p2: Point): Maybe<Point> {
  const line = lineFromPoints(p1, p2);
  const r = cls.intersectWith(shape, line);
  return r.tag === "Just" ? Just(linePoint(line, r.value)) : Nothing;
}

// ---------------------------------------------------------------------------------------------
// Constraints

/**
 * A constraint forces its argument to stay within a certain area or on a line. A Horizontal
 * constraint is @set pY y@. Unfortunately constraints do not compose well.
 */
export type Constraint = (p: Point) => Point;

/**
 * Turn a curried Haskell `X -> Constraint` definition into a function that can be partially
 * applied (one argument gives a `Constraint`) or fully applied (two arguments give a `Point`).
 */
function constraintFn<X>(f: (x: X, pt: Point) => Point): {
  (x: X): Constraint;
  (x: X, pt: Point): Point;
} {
  function g(x: X): Constraint;
  function g(x: X, pt: Point): Point;
  function g(x: X, pt?: Point): Constraint | Point {
    return pt === undefined ? (p: Point) => f(x, p) : f(x, pt);
  }
  return g;
}

/** Irrefutable `Just (a, b) = ...` pattern. */
function fromJustPattern<A>(m: Maybe<A>): A {
  if (m.tag === "Just") return m.value;
  return error("Hades.Abstract.Geometry: Irrefutable pattern failed for pattern Just (s, _)");
}

/** Constrain all values to lie on the line with a positive parameter. */
export const constrainLine = constraintFn((line1: Line, pt: Point): Point => {
  const { _1: vx, _2: vy } = line1;
  const line2 = Line(pt, -vy, vx); // Normal to line1 through pt.
  const [s] = fromJustPattern(lineIntersection(line1, line2));
  return linePoint(line1, hmax(s, 0));
});

/** Constrain all values to lie on the left of a line. */
export const constrainLineLeft = constraintFn((line1: Line, pt: Point): Point => {
  const { _1: vx, _2: vy } = line1;
  const line2 = Line(pt, -vy, vx); // Normal to line1 through pt.
  const [s1, s2] = fromJustPattern(lineIntersection(line1, line2));
  return s2 >= 0 ? pt : linePoint(line1, s1);
});

/** Constrain values to lie within a "BoundBox". */
export const constrainBox = constraintFn((box: BoundBox, pt: Point): Point => {
  if (box.tag === "NoBox") return pt;
  const { _pX: x1, _pY: y1 } = box._0;
  const { _pX: x2, _pY: y2 } = box._1;
  const limit = (v1: number, v2: number, v: number): number => hmax(v1, hmin(v2, v));
  return Point(limit(x1, x2, pt._pX), limit(y1, y2, pt._pY));
});

/*
 * $quadrants
 *
 * The diagram space and quadrants are defined as follows:
 *
 * > (0,0)               x ->
 * >    +----------------------------------
 * >    |
 * >    |
 * >  y |
 * >    |
 * >  | |
 * >  V |                    |
 * >    |               Q2   |   Q1
 * >    |                    |
 * >    |                    |(x,y)
 * >    |               -----+-----
 * >    |                    |
 * >    |                    |
 * >    |               Q3   |   Q4
 * >    |                    |
 * >    |
 * >    |
 */

/** Constrain to quadrant above right of argument. */
export const constrainQ1 = constraintFn((p0: Point, p: Point): Point =>
  Point(hmax(p._pX, p0._pX), hmin(p._pY, p0._pY)));

/** Constrain to quadrant above left of argument. */
export const constrainQ2 = constraintFn((p0: Point, p: Point): Point =>
  Point(hmin(p._pX, p0._pX), hmin(p._pY, p0._pY)));

/** Constrain to quadrant below left of argument. */
export const constrainQ3 = constraintFn((p0: Point, p: Point): Point =>
  Point(hmin(p._pX, p0._pX), hmax(p._pY, p0._pY)));

/** Constrain to quadrant below right of argument. */
export const constrainQ4 = constraintFn((p0: Point, p: Point): Point =>
  Point(hmax(p._pX, p0._pX), hmax(p._pY, p0._pY)));

// ---------------------------------------------------------------------------------------------
// Connector intersections.

/** Utility function for sorting a pair. */
function sort2(p: readonly [number, number]): [number, number] {
  const [v1, v2] = p;
  return v1 <= v2 ? [v1, v2] : [v2, v1];
}

/**
 * Points of intersection between an ellipse (defined by the BoundBox) and a Line.
 * Returns @Nothing@ if the line does not intersect the ellipse, otherwise it returns
 * the two line parameters of the intersection points.
 */
export function ellipseIntersection(box: BoundBox, line: Line): Maybe<[number, number]> {
  if (box.tag === "NoBox") return Nothing;
  const p1 = box._0, p2 = box._1;
  const { _0: pt, _1: vx, _2: vy } = line;
  // Analytical solution from
  // http://csharphelper.com/blog/2012/09/calculate-where-a-line-segment-and-an-ellipse-intersect-in-c/
  const a = (view(pX, p2) - view(pX, p1)) / 2;
  const b = (view(pY, p2) - view(pY, p1)) / 2;
  const [x1, y1] = pointDiff(view(boxCentre, box), pt); // Point relative to centre of ellipse
  // Partial function boxCentre is safe because box is not NoBox.
  const bigA = vx * vx / (a * a) + vy * vy / (b * b);
  const bigB = 2 * x1 * vx / (a * a) + 2 * y1 * vy / (b * b);
  const bigC = x1 * x1 / (a * a) + y1 * y1 / (b * b) - 1;
  const det = bigB * bigB - 4 * bigA * bigC;
  if (det < 0) return Nothing;
  const sdet = Math.sqrt(det);
  return Just([(-bigB + sdet) / (2 * bigA), (-bigB - sdet) / (2 * bigA)] as [number, number]);
}

/**
 * As for "ellipseIntersection", but returns the smaller of the two line parameters that is
 * positive.
 */
export function ellipseIntersection1(box: BoundBox, line: Line): Maybe<number> {
  const r = ellipseIntersection(box, line);
  if (r.tag === "Nothing") return Nothing;
  const [i1, i2] = sort2(r.value);
  if (!(i2 >= 0.0)) return Nothing;
  return i1 >= 0.0 ? Just(i1) : Just(i2);
}

/**
 * The analytic solution to a line normal to an ellipse through a point is a quartic
 * equation which may have up to 3 roots on the other side of the ellipse as well as the obvious
 * one on the near side. This is a simpler approximation for the nearest point that gives
 * results good enough for graphical work.
 *
 * If the point is inside the ellipse then this just uses a simple radial from the centre.
 */
export function ellipseNormalPoint(box: BoundBox, pt: Point): Point {
  if (box.tag === "NoBox") return pt;
  const p1 = box._0, p2 = box._1;
  const center = view(boxCentre, box); // Safe because box is not NoBox.
  const a = (view(pX, p2) - view(pX, p1)) / 2;
  const b = (view(pY, p2) - view(pY, p1)) / 2;
  const inside1 =
    sq(view(pX, pt) - view(pX, center)) / sq(a) + sq(view(pY, pt) - view(pY, center)) / sq(b) <= 1.0;
  const c = Math.sqrt(Math.abs(sq(a) - sq(b)));
  const [f1, f2] = a < b // Foci of ellipse
    ? [over(pY, (y) => y - c, center), over(pY, (y) => y + c, center)] // Vertical ellipse
    : [over(pX, (x) => x - c, center), over(pX, (x) => x + c, center)]; // Horizontal ellipse
  const pf1 = lineFromPoints(pt, f1);
  const pf2 = lineFromPoints(pt, f2);
  // Maybe monad. Returns Nothing if pt is co-linear with f1 and f2.
  const normal = (): Maybe<Line> => {
    if (inside1) return Nothing;
    const iA = ellipseIntersection1(box, pf1);
    if (iA.tag === "Nothing") return Nothing;
    const ptA = linePoint(pf1, iA.value);
    const iB = ellipseIntersection1(box, pf2);
    if (iB.tag === "Nothing") return Nothing;
    const ptB = linePoint(pf2, iB.value);
    const af2 = lineFromPoints(ptA, f2);
    const bf1 = lineFromPoints(ptB, f1);
    const ptC = lineIntersectionPoint(af2, bf1);
    if (ptC.tag === "Nothing") return Nothing;
    return Just(lineFromPoints(pt, ptC.value));
  };
  const n = normal();
  // If "normal" fails then a line to the centre is the Right Thing.
  const line = n.tag === "Just" ? n.value : lineFromPoints(pt, center);
  // If the ellipseIntersection1 fails then either we have a zero-size ellipse or
  // something has gone wrong. Either way the centre is a good fall-back.
  const i = ellipseIntersection1(box, line);
  return i.tag === "Just" ? linePoint(line, i.value) : center;
}
/*
The algorithm for ellipseNormalPoint is based on
http://www.mathpages.com/home/kmath505/kmath505.htm

Quote:

Incidentally, there's a simple way of determining a very close estimate of the location of
the "near side" normal point. For any external point P, let the lines from the two foci
F1 - P and F2 - P strike the ellipse at the points A and B respectively, and then let
C denote the intersection of the lines F1 - B and F2 - A. The line C - P is very nearly
normal to the ellipse. This construction can be performed with just quadratics, and gives a
line so close to the normal line that it could easily be mistaken for it.
*/

/**
 * If an ellipse is inscribed inside the argument box then this returns the largest area box that
 * will fit inside the ellipse.
 */
export function boxInsideEllipse(box: BoundBox): BoundBox {
  if (box.tag === "NoBox") return NoBox;
  const diagonal = lineFromPoints(box._0, box._1);
  const pt1_ = linePoint(diagonal, 0.5 - 0.5 / Math.sqrt(2));
  const pt2_ = linePoint(diagonal, 0.5 + 0.5 / Math.sqrt(2));
  return BoundBox(pt1_, pt2_);
}

// Proof: for a circle the largest rectangle that fits inside is a square, which is a smaller
// version of the square that bounds the circle. If the outer square has unit diagonal then the
// circle has radius @0.5/sqrt 2@. Stretching preserves the ratios between areas, so the rectangle
// inside an ellipse can be constructed in the same way.

/** Square the argument. */
function sq(x: number): number {
  return x * x;
}
