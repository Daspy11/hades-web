// Ported from hades/src/Hades/Abstract/BasicShapes.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * __The set of abstract shapes supported by Hades.__
 *
 * Each geometrical shape has
 * properties and behaviours that will be the same regardless of what it represents
 * in the diagram. These are encoded here to avoid duplication.
 *
 * The one commonality that is not included here is the drawing method. This is
 * dependent on the underlying GUI library, and hence is kept in a parallel module
 * elsewhere.
 *
 * Shapes covered here are:
 *
 * * Ellipse
 *
 * * Diamond: a parallelogram with corners top, bottom, left and right.
 *
 * * A parallelogram with horizontal edges. This is defined by its
 * inner box (the rectangle where text can be drawn) rather than the outer bounding box.
 * This avoids a bunch of tricky edge cases with narrow parallelograms, including the
 * non-existent inner box and the negative base.
 *
 * * Oval: a rectangle with rounded ends. Like the parallelogram this is defined by its inner box.
 *
 * * Lines that connect boxes together.
 *
 * TypeScript port
 * ---------------
 * * The classes `ShapeClass`, `BoxShapeClass` and `LineShapeClass` are dictionaries. The
 *   `(ToJSON s, FromJSON s)` superclass of `ShapeClass` is a `JSONCodec<S>`, so every shape
 *   dictionary also carries `toJSON`/`parseJSON` for the shape.
 * * Instances are `ShapeClass_<Shape>` and `BoxShapeClass_<Shape>` (or `LineShapeClass_LineShape`);
 *   the subclass dictionaries include all the `ShapeClass` members, so code that needs a
 *   `BoxShapeClass` can use them everywhere a `ShapeClass` is needed. The JSON codecs are also
 *   available on their own as `JSON_<Shape>`.
 * * The shape newtypes (`Rectangle`, `Ellipse` ...) have their own instances, so they are records
 *   with their Haskell field name (`{_rectangleShape: BoundBox}`); their isos are constants.
 * * `Vector Point` (`_lineMiddle`) is a plain array.
 * * A `Handle v` is a generator function `(d, menu, point, action) => Delta<V, View<V>>` whose
 *   `action` argument (Haskell `Action v -> Delta v (Action v)`) is `(d, action) => Delta`.
 * * `lineMenu` needs no dictionary: the class methods it uses run inside its script action, where
 *   the dictionary is `d.cls`.
 */
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import { Just, Nothing, type Maybe, catMaybes, fromMaybe, mapMaybe } from "@/lib/Data/Maybe";
import { comparing } from "@/lib/Data/Ord";
import {
  type Iso, type Lens, _1, _2, iso, ixList, lens, over, set, use, view,
} from "@/lib/Control/Lens";
import { fst, snd } from "@/lib/Prelude";
import { Menu, mempty_Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { findAffected, processDrag } from "./Commands";
import {
  type ConnectorEnd, type Terminators, Connected, JSON_Terminators, Unconnected, connectable,
  mkEndPoint, moveEnds, optimiseEnds, show_ConnectorEnd,
} from "./Connections";
import { type DiagramId, diagramContents } from "./Diagram";
import {
  type Action, type Delta, type DeltaCtx, type View, changeSelection, deltaDiagram, getSelection,
  mkScriptAction, nullAction, tellCheckpoint, yieldViews,
} from "./Delta";
import {
  type Line, type Scale, BoundBox, Intersect_Line, Intersect_List,
  JSON_BoundBox, JSON_Point, NoBox, Point, Line as mkLine, append_BoundBox, boxCentre, boxHeight,
  boxInsideEllipse, boxResize, boxWidth, constrainQ1, constrainQ2, constrainQ3, constrainQ4,
  containsBox, distance, ellipseIntersection1, ellipseNormalPoint, growBox, inBox, insidePolygon,
  intersectPoint, lineDistance, lineFromPoints, lineIntersection, linePoint, mkBoundBox, moveBox,
  movePoint, pX, pY, pointDiff, polygonBox, polygonLines, show_Point, shrinkBox,
} from "./Geometry";
import { updateItem } from "./Primitives";

/** Haskell `min` on `Double`. */
function hmin(x: number, y: number): number {
  return x <= y ? x : y;
}

/** Haskell `max` on `Double`. */
function hmax(x: number, y: number): number {
  return x <= y ? y : x;
}

/** The `Intersect [Line]` dictionary. */
const intersectLines = Intersect_List(Intersect_Line);

// ---------------------------------------------------------------------------------------------
// Handles

/**
 * A Handle allows a diagram element to be moved and resized. It takes a starting point
 * and a Delta to execute in response to user Actions. The Delta should finish by calling
 * "yieldViews" to update the screen and get the next user Action.
 *
 *  The returned View should be passed to "tellTransients" to keep it on top of everything else.
 */
export type Handle<V> = (
  d: DeltaCtx<V>,
  menu: Menu<Action<V>>,
  pt: Point,
  act: (d: DeltaCtx<V>, a: Action<V>) => Delta<V, Action<V>>,
) => Delta<V, View<V>>;

/**
 * Handles for a shape defined by a "BoundBox".
 *
 * Each handle is defined by its location and a function for updating
 * the shape from a new point if the handle is dragged.
 */
export function boxHandles<A>(boxLens: Lens<A, BoundBox>, v: A): [Point, (p: Point) => A][] {
  const b = view(boxLens, v);
  switch (b.tag) {
    case "NoBox":
      return [];
    case "BoundBox": {
      const { _pX: x1, _pY: y1 } = b._0;
      const { _pX: x2, _pY: y2 } = b._1;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      const topLeft: [Point, (p: Point) => A] = [
        Point(x1, y1),
        (p) => set(boxLens, mkBoundBox(Point(x2, y2), constrainQ2(Point(x2 - 1, y2 - 1), p)), v)];
      const top: [Point, (p: Point) => A] = [
        Point(midX, y1),
        (p) => set(boxLens, mkBoundBox(Point(x2, y2), set(pX, x1, over(pY, (y) => hmin(y2 - 1, y), p))), v)];
      const topRight: [Point, (p: Point) => A] = [
        Point(x2, y1),
        (p) => set(boxLens, mkBoundBox(Point(x1, y2), constrainQ1(Point(x1 + 1, y2 - 1), p)), v)];
      const right: [Point, (p: Point) => A] = [
        Point(x2, midY),
        (p) => set(boxLens, mkBoundBox(Point(x1, y1), over(pX, (x) => hmax(x1 + 1, x), set(pY, y2, p))), v)];
      const botRight: [Point, (p: Point) => A] = [
        Point(x2, y2),
        (p) => set(boxLens, mkBoundBox(Point(x1, y1), constrainQ4(Point(x1 + 1, y1 + 1), p)), v)];
      const bottom: [Point, (p: Point) => A] = [
        Point(midX, y2),
        (p) => set(boxLens, mkBoundBox(Point(x1, y1), set(pX, x2, over(pY, (y) => hmax(y1 + 1, y), p))), v)];
      const botLeft: [Point, (p: Point) => A] = [
        Point(x1, y2),
        (p) => set(boxLens, mkBoundBox(Point(x2, y1), constrainQ3(Point(x2 - 1, y1 + 1), p)), v)];
      const left: [Point, (p: Point) => A] = [
        Point(x1, midY),
        (p) => set(boxLens, mkBoundBox(Point(x2, y2), over(pX, (x) => hmin(x2 - 1, x), set(pY, y1, p))), v)];
      return [botRight, botLeft, bottom, topRight, right, topLeft, top, left];
      // bottom and right first because they need to be on top when handles overlap.
    }
  }
}

/**
 * The simplest case for a handle is that moving it just causes the diagram element to be
 * redrawn with a different shape, and no special semantics are associated with this.
 */
export function* simpleHandle<V>(
  d: DeltaCtx<V>,
  /**
   * Description of what moving this handle does. E.g. \"Resize \" or \"Move bend in \".
   * Note the trailing space on the string: the object description will be appended.
   */
  msg: string,
  /** Menu for this handle. "mempty" for nothing. */
  menu: Menu<Action<V>>,
  /** The type of handle to draw. */
  handle: Handle<V>,
  /** The starting point for the handle, and how the item should be updated. */
  [pt, updateF]: readonly [Point, (p: Point) => V],
): Delta<V, View<V>> {
  const cls = connectable(d);
  const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const item = updateF(pt);
  const uuid = cls.identifier(item);
  const affectedList = S.toList(S.delete(uuid, yield* findAffected(d, S.singleton(uuid))));
  const dragState = mapMaybe((u: DiagramId) => M.lookup(u, contents), affectedList);
  const dragUpdate = function* (d1: DeltaCtx<V>, connected: readonly V[], newItem: V): Delta<V, void> {
    yield* updateItem(d1, newItem);
    for (const c of connected) yield* cls.itemAdjust(d1, c);
    // dragState & dragUpdate executed by processDrag later.
  };
  const desc = yield* cls.itemDescription(d, item);
  return yield* handle(d, menu, pt, (d1, a) =>
    processDrag(
      d1,
      msg + desc,
      function* (): Delta<V, V[]> {
        return dragState;
      },
      (d2, s, ev, dd) => dragUpdate(d2, s, updateF(movePoint(ev.actionLocation, dd))),
      a,
    ));
}

// ---------------------------------------------------------------------------------------------
// Basic shape definitions

/**
 * A Shape tells a Viewable where it is, what size it is and so on. Based on this certain
 * geometrical properties can be derived.
 */
export interface ShapeClass<S> extends J.JSONCodec<S> {
  /**
   * The boundbox for the shape. Note that an actual Viewable may extend past this box,
   * depending on how it is drawn.
   */
  shapeBounds(s: S): BoundBox;
  /**
   * True if the point is on the shape. Takes "Scale" because lines need some scale-invariant
   * slop around them.
   */
  shapeTouched(s: S, scale: Scale, p: Point): boolean;
  /** True if the shape is entirely contained in the BoundBox. */
  shapeInBox(s: S, box: BoundBox): boolean;
  /** Move the shape by (x,y) relative. */
  shapeDrag(d: readonly [number, number], s: S): S;
  /** When drawing a line from the point to the shape, where should the line terminate? */
  shapeConnectionPoint(s: S, p: Point): Point;
}

/** Enclosed shapes such as boxes, ellipses and diamonds. */
export interface BoxShapeClass<S> extends ShapeClass<S> {
  /** A box suitable for drawing text within the shape. */
  shapeInnerBox(s: S): BoundBox;
  /**
   * Attempt to set the width and height.
   * Boxes may impose constraints to avoid impossible results.
   */
  shapeResize(wh: readonly [number, number], s: S): S;
  /** Handles for resizing this box. */
  shapeHandles(s: S): [Point, (p: Point) => S][];
  /** The boundbox that defines the shape. */
  readonly shapeDefinition: Lens<S, BoundBox>;
}

/** Non-enclosed shapes, especially lines. */
export interface LineShapeClass<S> extends ShapeClass<S> {
  /** A point where annotation text (e.g. the line name) should be centered. */
  shapeAnnotationPoint(s: S): Point;
}

// ---------------------------------------------------------------------------------------------
// Lines

/** A shape for a line connecting a sequence of points. */
export interface LineShape {
  readonly _lineEnds: Terminators;
  readonly _lineMiddle: readonly Point[];
}
export function LineShape(_lineEnds: Terminators, _lineMiddle: readonly Point[]): LineShape {
  return { _lineEnds, _lineMiddle };
}

/** `instance Show LineShape` (derived). */
export function show_LineShape(shape: LineShape): string {
  const [e1, e2] = shape._lineEnds;
  return `LineShape {_lineEnds = (${show_ConnectorEnd(e1)},${show_ConnectorEnd(e2)}), ` +
    `_lineMiddle = [${shape._lineMiddle.map(show_Point).join(",")}]}`;
}

export const lineEnds: Lens<LineShape, Terminators> =
  lens((s: LineShape) => s._lineEnds, (s, v: Terminators) => ({ ...s, _lineEnds: v }));

export const lineMiddle: Lens<LineShape, readonly Point[]> =
  lens((s: LineShape) => s._lineMiddle, (s, v: readonly Point[]) => ({ ...s, _lineMiddle: v }));

/** `instance ToJSON LineShape` and `instance FromJSON LineShape` */
export const JSON_LineShape: J.JSONCodec<LineShape> = (() => {
  const middleJ = J.listJ(JSON_Point);
  return J.codec<LineShape>(
    (shape) => J.object([
      ["ends", JSON_Terminators.toJSON(view(lineEnds, shape))],
      ["middle", middleJ.toJSON(view(lineMiddle, shape).slice())],
    ]),
    (v) => J.withObject("line position", (o) =>
      LineShape(J.field(o, "ends", JSON_Terminators), J.field(o, "middle", middleJ)), v),
  );
})();

/** `instance ShapeClass LineShape` */
export const ShapeClass_LineShape: ShapeClass<LineShape> = {
  ...JSON_LineShape,
  shapeBounds: (line) => polygonBox(linePoints(line)),
  shapeTouched: (line, scale, testPoint) => lineSegments(line).some((l) => lineTouched(scale, testPoint, l)),
  shapeInBox: (line, box) => linePoints(line).every((p) => inBox(p, box)),
  shapeDrag: (d, line) =>
    over(lineEnds, (e) => moveEnds(e, d), over(lineMiddle, (ps) => ps.map((p) => movePoint(p, d)), line)),
  shapeConnectionPoint: (line, fromPoint) => {
    // At present this functionality is not used for lines.
    const points = linePoints(line);
    const candidates = points.map((pt) => [distance(pointDiff(fromPoint, pt)), pt] as [number, Point]);
    return snd(L.minimumBy(comparing(fst), candidates));
  },
};

/** `instance LineShapeClass LineShape` */
export const LineShapeClass_LineShape: LineShapeClass<LineShape> = {
  ...ShapeClass_LineShape,
  shapeAnnotationPoint: (line) => lineMidPoint(line),
};

/**
 * Segment on the line a fraction of the way along the whole line.
 * @0@ means the start of the line, @1@ means the end of the line, and @0.5@ means the mid point.
 * Values outside this range will give the start or end of the line as appropriate.
 */
export function lineFractionSegment(f: number, shape: LineShape): [Line, number] {
  const f_ = hmax(0, hmin(f, 1)); // Limit f' to range 0-1.
  const allPoints = linePoints(shape);
  const segments = L.zip(allPoints, L.tail(allPoints)); // allPoints contains at least 2 points.
  const lengths = segments.map(([p1, p2]) => distance(pointDiff(p1, p2)));
  const segEndDists = L.zip(segments, L.drop(1, L.scanl((a: number, b: number) => a + b, 0, lengths)));
  // Length up to end of each seg.
  const dist = L.sum(lengths) * f_;
  const rest = L.dropWhile(([, d]) => d < dist, segEndDists);
  if (rest.length === 0) {
    const [p1, p2] = L.last(segments);
    return [lineFromPoints(p1, p2), 1]; // Numeric edge case.
  }
  const [[p1, p2], d] = rest[0];
  return [lineFromPoints(p1, p2), 1 - (d - dist) / distance(pointDiff(p1, p2))];
}

/**
 * The point a fraction along the total length of a line. @0@ means the start of the line, @1@
 * means the end of the line, and @0.5@ means the mid point.
 */
export function lineFractionPoint(f: number, shape: LineShape): Point {
  const [line, d] = lineFractionSegment(f, shape);
  return linePoint(line, d);
}

/** The point half way along the length of the line. */
function lineMidPoint(shape: LineShape): Point {
  return lineFractionPoint(0.5, shape);
}

/**
 * If the line is connected to other shapes then update the end-points with the
 * appropriate connection points for those shapes.
 */
export function* lineUpdate<V>(d: DeltaCtx<V>, line: LineShape): Delta<V, LineShape> {
  const updateConnection = function* (c: ConnectorEnd, sourcePt: Point): Delta<V, ConnectorEnd> {
    if (c.tag === "Unconnected") return c;
    const { connectorPoint: pt, connectorTarget: diagId, connectorTargetChild: child } = c;
    const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
    const target = M.lookup(diagId, cs);
    if (target.tag === "Nothing") return Unconnected(pt);
    const newPt = (yield* connectable(d).itemConnectionPoint(d, target.value, child))(sourcePt);
    return Connected(newPt, diagId, child);
  };
  const middle = view(lineMiddle, line);
  if (middle.length === 0) {
    const newEnds = yield* optimiseEnds(d, view(lineEnds, line));
    return set(lineEnds, newEnds, line);
  } else { // Partial functions on lineMiddle are safe because line is not null.
    const [start, end] = view(lineEnds, line);
    const newStart = yield* updateConnection(start, middle[0]);
    const newEnd = yield* updateConnection(end, middle[middle.length - 1]);
    return set(lineEnds, [newStart, newEnd] as Terminators, line);
  }
}

/**
 * Connectors must connect and disconnect with other shapes as they are dragged around.
 * Making and breaking connections can have semantic effects on the model.
 *
 * If the line has points in the middle then the corresponding handles have a menu option
 * to delete themselves.
 */
export function* lineHandles<V>(
  d: DeltaCtx<V>,
  /** The shape to provide the handles for. */
  line: LineShape,
  /** The type of handle to draw. */
  handle: Handle<V>,
  /** Function for a copy of the item updated with a new shape. */
  updateF: (s: LineShape) => V,
  /**
   * The action to take when the drag is completed. Typically this implements the semantics
   * of this type of line.
   */
  updateFinal: (d: DeltaCtx<V>, v: V) => Delta<V, void>,
): Delta<V, View<V>[]> {
  /**
   * Delete the n'th item from the vector (counting from zero), leaving the vector 1 item
   * shorter.
   */
  const deleteItemN = (n: number, vec: readonly Point[]): Point[] => [...L.take(n, vec), ...L.drop(n + 1, vec)];
  const cls = connectable(d);
  const item = updateF(line);
  const uuid = cls.identifier(item);
  const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const affectedList = S.toList(S.delete(uuid, yield* findAffected(d, S.singleton(uuid))));
  const dragState = function* (): Delta<V, V[]> {
    return mapMaybe((u: DiagramId) => M.lookup(u, contents), affectedList);
  };
  const dragUpdate = function* (d1: DeltaCtx<V>, affected: readonly V[], newShape: LineShape): Delta<V, void> {
    const shape2 = yield* lineUpdate(d1, newShape); // Move the endpoints as necessary.
    yield* updateItem(d1, updateF(shape2));
    for (const a of affected) yield* cls.itemAdjust(d1, a);
  };
  const desc = yield* cls.itemDescription(d, item);
  const startH = yield* handle(d, mempty_Menu<Action<V>>(), view(lineEnds.dot(_1()), line).connectorPoint,
    function* (d1: DeltaCtx<V>, act: Action<V>): Delta<V, Action<V>> {
      const next = yield* processDrag(d1, "Move " + desc, dragState,
        function* (d2: DeltaCtx<V>, s: V[], ev: Action<V>, dd: readonly [number, number]): Delta<V, void> {
          const newStart = yield* mkEndPoint(d2, "ConnectionFrom", item, movePoint(ev.actionLocation, dd));
          yield* dragUpdate(d2, s, set(lineEnds.dot(_1()), newStart, line));
        }, act);
      const item1 = M.lookup(uuid, use(d1, deltaDiagram<V>().dot(diagramContents<V>())));
      if (item1.tag === "Just") yield* updateFinal(d1, item1.value);
      return next;
    });
  const endH = yield* handle(d, mempty_Menu<Action<V>>(), view(lineEnds.dot(_2()), line).connectorPoint,
    function* (d1: DeltaCtx<V>, act: Action<V>): Delta<V, Action<V>> {
      const next = yield* processDrag(d1, "Move " + desc, dragState,
        function* (d2: DeltaCtx<V>, s: V[], ev: Action<V>, dd: readonly [number, number]): Delta<V, void> {
          const newEnd = yield* mkEndPoint(d2, "ConnectionTo", item, movePoint(ev.actionLocation, dd));
          yield* dragUpdate(d2, s, set(lineEnds.dot(_2()), newEnd, line));
        }, act);
      const item1 = M.lookup(uuid, use(d1, deltaDiagram<V>().dot(diagramContents<V>())));
      if (item1.tag === "Just") yield* updateFinal(d1, item1.value);
      return next;
    });
  const bendHandles: View<V>[] = [];
  for (let n = 0; n <= view(lineMiddle, line).length - 1; n++) {
    const deleteAction = mkScriptAction(function* (d1: DeltaCtx<V>): Delta<V, Action<V>> {
      const newShape = yield* lineUpdate(d1, over(lineMiddle, (vec) => deleteItemN(n, vec), line));
      yield* updateItem(d1, updateF(newShape));
      yield* tellCheckpoint(d1, "Delete bend in " + desc);
      return yield* yieldViews(d1);
    });
    const menu = Menu([[menuItem("Delete bend", deleteAction)]]);
    bendHandles.push(yield* handle(d, menu, view(lineMiddle, line)[n], (d1, a) =>
      processDrag(d1, "Move bend in " + desc, dragState,
        (d2, s, _ev, dd) => dragUpdate(d2, s, over(lineMiddle.dot(ixList<Point>(n)), (p) => movePoint(p, dd), line)),
        a)));
  }
  return [startH, endH, ...bendHandles];
}

/**
 * The control points for the line, in order, including the start and end points. Guaranteed to
 * contain at least 2 points
 */
export function linePoints(line: LineShape): Point[] {
  const [start, end] = view(lineEnds, line);
  return [start.connectorPoint, ...view(lineMiddle, line), end.connectorPoint];
}

/** The line segments for the line, in order. Guaranteed to contain at least one line. */
export function lineSegments(line: LineShape): Line[] {
  const points = linePoints(line);
  return L.zipWith(lineFromPoints, points, L.tail(points)); // points contains >= 2 items
}

/**
 * Predicate to determine if the Point is close enough to the line to be considered as
 * touching it. This means being within @4/scale@.
 */
export function lineTouched(scale: Scale, p: Point, line: Line): boolean {
  const p1 = line._0;
  const tolerance = 4 / scale;
  const p2 = linePoint(line, 1.0); // End of line.
  const near = (q: Point): boolean => distance(pointDiff(p, q)) <= tolerance;
  const nearLine = (): boolean => {
    const r = lineDistance(line, p);
    return r.tag === "Just" ? r.value <= tolerance : false;
  };
  return near(p1) || near(p2) || nearLine();
}

/**
 * Function to find if a point is within the given distance of a line, and if so to snap the point
 * to the line. If the snap occurs it returns the snap distance, the fraction along the line,
 * and the new point.
 */
export function lineSnap(dist: number, shape: LineShape, pt: Point): Maybe<[number, number, Point]> {
  type Snap = Maybe<[number, number, Point]>;
  const allPoints = linePoints(shape);
  const segments = L.zip(allPoints, L.tail(allPoints));
  const lengths = segments.map(([p1, p2]) => distance(pointDiff(p1, p2)));
  const shapeLength = L.sum(lengths);
  const segStartDists = L.zip(segments, L.scanl((a: number, b: number) => a + b, 0, lengths));
  // Length up to start of each seg.
  const snapPoint = (d: number, p: Point): Snap => {
    const d1 = distance(pointDiff(pt, p));
    return d1 < dist ? Just([d1, d, p] as [number, number, Point]) : Nothing;
  };
  const joinSnaps = (s1: Snap, s2: Snap): Snap => {
    if (s1.tag === "Nothing") return s2;
    if (s2.tag === "Nothing") return s1;
    return s1.value[0] < s2.value[0] ? s1 : s2;
  };
  const segSnap = ([[p1, p2], d]: readonly [readonly [Point, Point], number]): Snap => {
    const line = lineFromPoints(p1, p2);
    const { _1: dx, _2: dy } = line;
    const normal = mkLine(pt, -dy, dx);
    const endSnaps = (): Snap => joinSnaps(snapPoint(d, p1), snapPoint(d + distance(pointDiff(p1, p2)), p2));
    const i = lineIntersection(line, normal);
    if (i.tag === "Nothing") return endSnaps(); // Can't happen because lines are at 90 degrees.
    const [f1] = i.value;
    const snap = linePoint(line, f1);
    const snapDist = distance(pointDiff(pt, snap));
    return 0 <= f1 && f1 <= 1 && snapDist <= dist
      ? Just([snapDist, d + distance(pointDiff(p1, snap)), snap] as [number, number, Point])
      : endSnaps();
  };
  const r = L.foldr((seg: readonly [readonly [Point, Point], number], acc: Snap) => joinSnaps(segSnap(seg), acc),
    Nothing as Snap, segStartDists);
  if (r.tag === "Nothing") return Nothing;
  const [d, p, pt2] = r.value;
  return Just([d, p / shapeLength, pt2] as [number, number, Point]);
}

/** Menu for lines. Containes a single option to create a new bend in the line. */
export function lineMenu<V>(updateF: (s: LineShape) => V, shape: LineShape, pt: Point): Menu<Action<V>> {
  /**
   * Insert a new item "n" in the vector with value x. The old item n and all following it
   * are bumped up one place.
   */
  const insertItemN = (n: number, x: Point, vec: readonly Point[]): Point[] => {
    const [before, after] = L.splitAt(n, vec);
    return [...before, x, ...after];
  };
  const segments = lineSegments(shape).map((ln, n) => [n, ln] as const);
  const candidates = mapMaybe(([n, ln]: readonly [number, Line]) => {
    const r = lineDistance(ln, pt);
    return r.tag === "Just" ? Just([n, r.value] as [number, number]) : Nothing;
  }, segments);
  const action = ((): Action<V> => {
    if (candidates.length === 0) {
      return nullAction<V>(); // Missed all the segments - no change. Maybe clicked near end point
    }
    const touchedSeg = fst(L.minimumBy(comparing(snd), candidates));
    return mkScriptAction(function* (d: DeltaCtx<V>): Delta<V, Action<V>> {
      const newItem = updateF(over(lineMiddle, (vec) => insertItemN(touchedSeg, pt, vec), shape));
      yield* updateItem(d, newItem);
      const desc = yield* d.cls.itemDescription(d, newItem);
      const sel = yield* getSelection(d);
      yield* changeSelection(d, S.insert(d.cls.identifier(newItem), sel));
      yield* tellCheckpoint(d, "Add bend to " + desc);
      return yield* yieldViews(d);
    });
  })();
  return Menu([[menuItem("Add bend", action)]]);
}

// ---------------------------------------------------------------------------------------------
// Rectangles

export interface Rectangle {
  readonly _rectangleShape: BoundBox;
}
export function Rectangle(_rectangleShape: BoundBox): Rectangle {
  return { _rectangleShape };
}

/** A rectangle is defined by its bounding box. */
export const rectangleShape: Iso<Rectangle, BoundBox> = iso((r: Rectangle) => r._rectangleShape, Rectangle);

/** `instance ToJSON Rectangle` and `instance FromJSON Rectangle` */
export const JSON_Rectangle: J.JSONCodec<Rectangle> = J.codec(
  (r) => JSON_BoundBox.toJSON(r._rectangleShape),
  (v) => Rectangle(JSON_BoundBox.parseJSON(v)),
);

/** `instance ShapeClass Rectangle` */
export const ShapeClass_Rectangle: ShapeClass<Rectangle> = {
  ...JSON_Rectangle,
  shapeBounds: (r) => view(rectangleShape, r),
  shapeTouched: (r, _scale, pt) => inBox(pt, r._rectangleShape),
  shapeInBox: (r, b) => containsBox(b, r._rectangleShape),
  shapeDrag: (d, r) => over(rectangleShape, (b) => moveBox(b, d), r),
  shapeConnectionPoint: (box, p0) => {
    const p1 = ellipseNormalPoint(ShapeClass_Rectangle.shapeBounds(box), p0); // On ellipse inside rectangle.
    return fromMaybe(p0, intersectWithRectangle(box, lineFromPoints(p0, p1)));
    // p1 is inside the rectangle, so p0 should never be returned.
  },
};

/** `instance BoxShapeClass Rectangle` */
export const BoxShapeClass_Rectangle: BoxShapeClass<Rectangle> = {
  ...ShapeClass_Rectangle,
  shapeInnerBox: (r) => shrinkBox(3, view(rectangleShape, r)),
  shapeResize: (d, r) => (r._rectangleShape.tag === "NoBox" ? Rectangle(NoBox) : Rectangle(boxResize(d, r._rectangleShape))),
  shapeHandles: (r) => boxHandles(rectangleShape, r),
  shapeDefinition: rectangleShape,
};

/** Given a rectangle and a line, compute the first intersection. */
export function intersectWithRectangle(rect: Rectangle, line: Line): Maybe<Point> {
  const r = intersectLines.intersectWith(rectangleEdges(rect), line);
  return r.tag === "Just" ? Just(linePoint(line, r.value)) : Nothing;
}

/** The four corners of a rectangle, clockwise from top left. */
export function rectangleCorners(r: Rectangle): Point[] {
  const b = r._rectangleShape;
  if (b.tag === "NoBox") return [];
  const { _pX: x1, _pY: y1 } = b._0;
  const { _pX: x2, _pY: y2 } = b._1;
  return [Point(x1, y1), Point(x2, y1), Point(x2, y2), Point(x1, y2)];
}

/** The four edges of a rectangle as lines, clockwise from the top. */
export function rectangleEdges(r: Rectangle): Line[] {
  return polygonLines(rectangleCorners(r));
}

// ---------------------------------------------------------------------------------------------
// Ellipses

export interface Ellipse {
  readonly _ellipseShape: BoundBox;
}
export function Ellipse(_ellipseShape: BoundBox): Ellipse {
  return { _ellipseShape };
}

export const ellipseShape: Iso<Ellipse, BoundBox> = iso((e: Ellipse) => e._ellipseShape, Ellipse);

/** `instance ToJSON Ellipse` and `instance FromJSON Ellipse` */
export const JSON_Ellipse: J.JSONCodec<Ellipse> = J.codec(
  (e) => JSON_BoundBox.toJSON(e._ellipseShape),
  (v) => Ellipse(JSON_BoundBox.parseJSON(v)),
);

/** `instance ShapeClass Ellipse` */
export const ShapeClass_Ellipse: ShapeClass<Ellipse> = {
  ...JSON_Ellipse,
  shapeBounds: (e) => view(ellipseShape, e),
  shapeTouched: (shape, _scale, p) => ellipseTouched(ShapeClass_Ellipse.shapeBounds(shape), p),
  shapeInBox: (e, b) => containsBox(b, e._ellipseShape),
  shapeDrag: (d, e) => over(ellipseShape, (b) => moveBox(b, d), e),
  shapeConnectionPoint: (e, p) => ellipseNormalPoint(ShapeClass_Ellipse.shapeBounds(e), p),
};

/** `instance BoxShapeClass Ellipse` */
export const BoxShapeClass_Ellipse: BoxShapeClass<Ellipse> = {
  ...ShapeClass_Ellipse,
  shapeInnerBox: (e) => boxInsideEllipse(ShapeClass_Ellipse.shapeBounds(e)),
  shapeResize: (d, e) => Ellipse(boxResize(d, e._ellipseShape)),
  shapeHandles: (e) => boxHandles(ellipseShape, e),
  shapeDefinition: ellipseShape,
};

/** Test if an ellipse is touched by the point. */
export function ellipseTouched(box: BoundBox, pt: Point): boolean {
  if (box.tag === "NoBox") return false;
  const { _pX: x, _pY: y } = pt;
  const rX = boxWidth(box) / 2;
  const rY = boxHeight(box) / 2;
  const { _pX: cX, _pY: cY } = view(boxCentre, box); // Safe because box is not NoBox
  return inBox(pt, box) && sq((x - cX) * rY) + sq((y - cY) * rX) <= sq(rX) * sq(rY);
}

// ---------------------------------------------------------------------------------------------
// Diamonds

/** A diamond looks like this: ◇ */
export interface Diamond {
  readonly _diamondShape: BoundBox;
}
export function Diamond(_diamondShape: BoundBox): Diamond {
  return { _diamondShape };
}

export const diamondShape: Iso<Diamond, BoundBox> = iso((d: Diamond) => d._diamondShape, Diamond);

/** `instance ToJSON Diamond` and `instance FromJSON Diamond` */
export const JSON_Diamond: J.JSONCodec<Diamond> = J.codec(
  (b) => JSON_BoundBox.toJSON(b._diamondShape),
  (v) => Diamond(JSON_BoundBox.parseJSON(v)),
);

/** `instance ShapeClass Diamond` */
export const ShapeClass_Diamond: ShapeClass<Diamond> = {
  ...JSON_Diamond,
  shapeBounds: (dm) => view(diamondShape, dm),
  shapeTouched: (p, _scale, pt) => diamondTouched(ShapeClass_Diamond.shapeBounds(p), pt),
  shapeInBox: (dm, b) => containsBox(b, dm._diamondShape),
  shapeDrag: (d, dm) => over(diamondShape, (b) => moveBox(b, d), dm),
  shapeConnectionPoint: (dm, p) => diamondConnectionPoint(ShapeClass_Diamond.shapeBounds(dm), p),
};

/** `instance BoxShapeClass Diamond` */
export const BoxShapeClass_Diamond: BoxShapeClass<Diamond> = {
  ...ShapeClass_Diamond,
  shapeInnerBox: (dm) => diamondInnerBox(ShapeClass_Diamond.shapeBounds(dm)),
  shapeResize: ([w, h], dm) => {
    const oldShape = dm._diamondShape;
    if (oldShape.tag === "NoBox") return Diamond(NoBox);
    const c = view(boxCentre, oldShape);
    const w1 = hmax(1, w) / 2;
    const h1 = hmax(1, h) / 2;
    // (sic) The Haskell original uses (-w1, h1) for the first corner, not (-w1, -h1).
    return Diamond(BoundBox(movePoint(c, [-w1, h1]), movePoint(c, [w1, h1])));
  },
  shapeHandles: (dm) => boxHandles(diamondShape, dm),
  shapeDefinition: diamondShape,
};

/**
 * Test if a diamond shape with corners at the midpoints of the bounding box is touched by
 * the point.
 */
export function diamondTouched(box: BoundBox, pt: Point): boolean {
  return inBox(pt, box) && insidePolygon(diamondCorners(box), pt);
}

/** The corner points of a diamond, starting from the left corner going clockwise. */
export function diamondCorners(box: BoundBox): Point[] {
  if (box.tag === "NoBox") return [];
  const { _pX: x1, _pY: y1 } = box._0;
  const { _pX: x2, _pY: y2 } = box._1;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return [Point(x1, midY), Point(midX, y1), Point(x2, midY), Point(midX, y2)];
}

/** A BoundBox which is contained entirely within the diamond inscribed in the argument. */
export function diamondInnerBox(box: BoundBox): BoundBox {
  if (box.tag === "NoBox") return NoBox;
  const [side1, , side3] = polygonLines(diamondCorners(box));
  // Hopefully an inner box half the height and width of the outer one is the maximum area.
  // Pattern match cannot fail because we have a BoundBox, so polygonLines must return 4 items.
  return mkBoundBox(linePoint(side1, 0.5), linePoint(side3, 0.5));
}

/** The connection point to a diamond. */
export function diamondConnectionPoint(box: BoundBox, p: Point): Point {
  return polygonConnectionPoint(diamondCorners(box), diamondInnerBox(box), p);
}

// ---------------------------------------------------------------------------------------------
// Parallelograms

/**
 * A parallelogram has the top and bottom sides horizontal and the left and right sides slanted.
 * It is defined by its *inner* box (i.e. the rectangular area between the two
 * horizontal edges) and the slant ratio, where zero is vertical and a positive slant leans to
 * the right.
 */
export interface Parallelogram {
  readonly _parallelogramShape: BoundBox;
}
export function Parallelogram(_parallelogramShape: BoundBox): Parallelogram {
  return { _parallelogramShape };
}

export const parallelogramShape: Iso<Parallelogram, BoundBox> =
  iso((p: Parallelogram) => p._parallelogramShape, Parallelogram);

/** `instance ToJSON Parallelogram` and `instance FromJSON Parallelogram` */
export const JSON_Parallelogram: J.JSONCodec<Parallelogram> = J.codec(
  (b) => JSON_BoundBox.toJSON(b._parallelogramShape),
  (v) => Parallelogram(JSON_BoundBox.parseJSON(v)),
);

/** `instance ShapeClass Parallelogram` */
export const ShapeClass_Parallelogram: ShapeClass<Parallelogram> = {
  ...JSON_Parallelogram,
  shapeBounds: (p) => parallelogramOuterBox(p),
  shapeTouched: (p, _scale, pt) => parallelogramTouched(p, pt),
  shapeInBox: (p, b) => containsBox(b, ShapeClass_Parallelogram.shapeBounds(p)),
  shapeDrag: (d, p) => over(parallelogramShape, (b) => moveBox(b, d), p),
  shapeConnectionPoint: (p, pt) => parallelogramConnectionPoint(p, pt),
};

/** `instance BoxShapeClass Parallelogram` */
export const BoxShapeClass_Parallelogram: BoxShapeClass<Parallelogram> = {
  ...ShapeClass_Parallelogram,
  shapeInnerBox: (p) => view(parallelogramShape, p),
  shapeResize: ([w, h], p) => {
    const widening = h * parallelogramSlant;
    return Parallelogram(boxResize([w - 2 * widening, h], p._parallelogramShape));
  },
  shapeHandles: (p) => boxHandles(parallelogramShape, p),
  shapeDefinition: parallelogramShape,
};

export function parallelogramTouched(p: Parallelogram, pt: Point): boolean {
  return insidePolygon(parallelogramCorners(p), pt);
}

/** Slant ratio of parallelograms. */
export const parallelogramSlant: number = 1 / 3;

/** The four corners of a parallelogram. */
export function parallelogramCorners(p: Parallelogram): Point[] {
  const box = p._parallelogramShape;
  if (box.tag === "NoBox") return [];
  const { _pX: x1, _pY: y1 } = box._0;
  const { _pX: x2, _pY: y2 } = box._1;
  const outer = parallelogramOuterBox(p);
  if (outer.tag === "NoBox") throw new Error("Irrefutable pattern failed: parallelogramOuterBox");
  const x1a = outer._0._pX;
  const x2a = outer._1._pX;
  if (parallelogramSlant < 0) return [Point(x1a, y1), Point(x1, y2), Point(x2a, y2), Point(x2, y1)];
  if (parallelogramSlant > 0) return [Point(x1, y1), Point(x1a, y2), Point(x2, y2), Point(x2a, y1)];
  return [Point(x1, y1), Point(x1, y2), Point(x2, y2), Point(x2, y1)];
}

/**
 * The outer box of a parallelogram, defined as the inner box plus the two triangular wings.
 * This is the actual boundbox of the entire shape.
 */
export function parallelogramOuterBox(p: Parallelogram): BoundBox {
  const box = p._parallelogramShape;
  if (box.tag === "NoBox") return NoBox;
  const { _pX: x1, _pY: y1 } = box._0;
  const { _pX: x2, _pY: y2 } = box._1;
  const widening = boxHeight(box) * parallelogramSlant;
  return BoundBox(Point(x1 - widening, y1), Point(x2 + widening, y2));
}

export function parallelogramConnectionPoint(p: Parallelogram, pt: Point): Point {
  return polygonConnectionPoint(parallelogramCorners(p), view(parallelogramShape, p), pt);
}

// ---------------------------------------------------------------------------------------------
// Ovals

/**
 * An oval box consists of a rectangle with rounded ends. The width of the ends is specified
 * by the aspect ratio. Zero gives a normal rectangle while one gives semicircular ends.
 */
export interface Oval {
  readonly _ovalShape: BoundBox;
}
export function Oval(_ovalShape: BoundBox): Oval {
  return { _ovalShape };
}

export const ovalShape: Iso<Oval, BoundBox> = iso((o: Oval) => o._ovalShape, Oval);

/** `instance ToJSON Oval` and `instance FromJSON Oval` */
export const JSON_Oval: J.JSONCodec<Oval> = J.codec(
  (b) => JSON_BoundBox.toJSON(b._ovalShape),
  (v) => Oval(JSON_BoundBox.parseJSON(v)),
);

/** `instance ShapeClass Oval` */
export const ShapeClass_Oval: ShapeClass<Oval> = {
  ...JSON_Oval,
  shapeBounds: (oval) => ovalBoxOuter(oval),
  shapeTouched: (oval, _scale, pt) => ovalBoxTouched(oval, pt),
  shapeInBox: (oval, b) => containsBox(b, ovalBoxOuter(oval)),
  shapeDrag: (d, oval) => over(ovalShape, (b) => moveBox(b, d), oval),
  shapeConnectionPoint: (oval, p0) => ovalBoxConnectionPoint(oval, p0),
};

/** `instance BoxShapeClass Oval` */
export const BoxShapeClass_Oval: BoxShapeClass<Oval> = {
  ...ShapeClass_Oval,
  shapeInnerBox: (oval) => view(ovalShape, oval),
  shapeResize: ([w, h], oval) => {
    const widening = h * ovalAspect;
    return Oval(boxResize([w - widening, h], oval._ovalShape));
  },
  shapeHandles: (oval) => boxHandles(ovalShape, oval),
  shapeDefinition: ovalShape,
};

/** Proportion of height by which the inner rectangle is widened by the elliptical sides. */
export const ovalAspect: number = 1 / 3;

/**
 * Private function that returns the extra overlapping shapes that comprise an oval box;
 * the bound box for the left hand ellipse, and the bound box for the right
 * hand ellipse.
 */
function ovalBoxSides(oval: Oval): [BoundBox, BoundBox] {
  const box = oval._ovalShape;
  if (box.tag === "NoBox") return [NoBox, NoBox];
  const p1 = box._0, p2 = box._1;
  const extra = boxHeight(box) * ovalAspect / 2;
  const leftBox = BoundBox(movePoint(p1, [-extra, 0]), movePoint(p1, [extra, boxHeight(box)]));
  const rightBox = BoundBox(movePoint(p2, [-extra, -boxHeight(box)]), movePoint(p2, [extra, 0]));
  return [leftBox, rightBox];
}

export function ovalBoxTouched(oval: Oval, pt: Point): boolean {
  const [leftBox, rightBox] = ovalBoxSides(oval);
  return inBox(pt, view(ovalShape, oval)) ||
    ellipseTouched(leftBox, pt) ||
    ellipseTouched(rightBox, pt);
}

/** The outer box of an oval, defined as the inner box plus the two half-ellipses on each end. */
export function ovalBoxOuter(oval: Oval): BoundBox {
  const [leftBox, rightBox] = ovalBoxSides(oval);
  return append_BoundBox(leftBox, rightBox);
}

export function ovalBoxConnectionPoint(oval: Oval, p0: Point): Point {
  const outer = ovalBoxOuter(oval);
  const [leftSide, rightSide] = ovalBoxSides(oval);
  const p1 = ellipseNormalPoint(outer, p0);
  const line = lineFromPoints(p0, p1);
  const leftIntersect = ellipseIntersection1(leftSide, line);
  const boxIntersect = intersectLines.intersectWith(rectangleEdges(Rectangle(view(ovalShape, oval))), line);
  const rightIntersect = ellipseIntersection1(rightSide, line);
  const allIntersects = catMaybes([leftIntersect, boxIntersect, rightIntersect]);
  return allIntersects.length === 0 ? p0 : linePoint(line, L.minimum(allIntersects));
}

// ---------------------------------------------------------------------------------------------
// Comment boxes

/**
 * A comment box is a rectangular box with the top left hand corner turned over. It is defined
 * by the inner box, which is the area suitable for text.
 */
export interface CommentBox {
  readonly _commentBoxShape: BoundBox;
}
export function CommentBox(_commentBoxShape: BoundBox): CommentBox {
  return { _commentBoxShape };
}

export const commentBoxShape: Iso<CommentBox, BoundBox> = iso((c: CommentBox) => c._commentBoxShape, CommentBox);

/** `instance ToJSON CommentBox` and `instance FromJSON CommentBox` */
export const JSON_CommentBox: J.JSONCodec<CommentBox> = J.codec(
  (b) => JSON_BoundBox.toJSON(b._commentBoxShape),
  (v) => CommentBox(JSON_BoundBox.parseJSON(v)),
);

/** `instance ShapeClass CommentBox` */
export const ShapeClass_CommentBox: ShapeClass<CommentBox> = {
  ...JSON_CommentBox,
  shapeBounds: (c) => commentBoxOuter(c),
  shapeTouched: (c, _scale, pt) => insidePolygon(commentBoxCorners(c), pt),
  shapeInBox: (c, b) => containsBox(b, ShapeClass_CommentBox.shapeBounds(c)),
  shapeDrag: (d, c) => over(commentBoxShape, (b) => moveBox(b, d), c),
  shapeConnectionPoint: (c, p) => commentBoxConnectionPoint(c, p),
};

/** `instance BoxShapeClass CommentBox` */
export const BoxShapeClass_CommentBox: BoxShapeClass<CommentBox> = {
  ...ShapeClass_CommentBox,
  shapeInnerBox: (c) => view(commentBoxShape, c),
  shapeResize: ([w, h], c) =>
    CommentBox(boxResize([w - 2 * commentBoxFoldSize, h - 2 * commentBoxFoldSize], c._commentBoxShape)),
  shapeHandles: (c) => boxHandles(commentBoxShape, c),
  shapeDefinition: commentBoxShape,
};

/** The first two corners are the diagonal fold line. */
export function commentBoxCorners(box: CommentBox): Point[] {
  if (box._commentBoxShape.tag === "NoBox") return [];
  const outer = commentBoxOuter(box); // Safe because "box" is not "NoBox"
  if (outer.tag === "NoBox") throw new Error("Irrefutable pattern failed: commentBoxOuter");
  const p1 = outer._0, p2 = outer._1;
  return [
    Point(view(pX, p1), view(pY, p1) + commentBoxFoldSize),
    Point(view(pX, p1) + commentBoxFoldSize, view(pY, p1)),
    Point(view(pX, p2), view(pY, p1)),
    p2,
    Point(view(pX, p1), view(pY, p2)),
  ];
}

/** A comment box is defined by its inner box. This gives the bounding box for the entire comment. */
export function commentBoxOuter(c: CommentBox): BoundBox {
  const s = c._commentBoxShape;
  if (s.tag === "NoBox") return NoBox;
  return growBox(commentBoxFoldSize, s);
}

/**
 * Comment boxes are generally free standing and don't have lines connecting to them. But
 * the "Viewable" instance will require one anyway, so here it is.
 */
export function commentBoxConnectionPoint(box: CommentBox, p: Point): Point {
  return polygonConnectionPoint(commentBoxCorners(box), ShapeClass_CommentBox.shapeBounds(box), p);
}

/** Size of the fold in the top left corner of a comment box. */
export const commentBoxFoldSize: number = 10;

/** Connection point for a polygon, given a suitable BoundBox within the polygon */
function polygonConnectionPoint(pts: readonly Point[], ellipse: BoundBox, p0: Point): Point {
  const p1 = ellipseNormalPoint(ellipse, p0);
  const edges = polygonLines(pts);
  return fromMaybe(p0, intersectPoint(intersectLines, edges, p0, p1));
}

/** Square the argument. */
function sq(x: number): number {
  return x * x;
}
