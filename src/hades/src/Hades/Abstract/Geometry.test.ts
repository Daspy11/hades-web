import { describe, expect, it } from "vitest";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { view, set } from "@/lib/Control/Lens";
import * as J from "@/lib/Data/Aeson";
import {
  BoundBox, Intersect_Line, Intersect_List, JSON_BoundBox, JSON_Point, Line, NoBox, Point,
  append_BoundBox, boxCentre, boxHeight, boxInsideEllipse, boxResize, boxWidth, constrainBox,
  constrainLine, constrainLineLeft, constrainQ1, constrainQ2, constrainQ3, constrainQ4, containsBox,
  distance, ellipseIntersection, ellipseIntersection1, ellipseNormalPoint, fitIntoBox, growBox, inBox,
  insidePolygon, intersectPoint, lineDistance, lineFromPoints, lineIntersection, lineNormal, linePoint,
  mconcat_BoundBox, mempty_BoundBox, mkBoundBox, mkConstrainedBox, moveBox, movePoint, overlapBox,
  pX, pY, pointDiff, polygonBox, polygonLines, show_BoundBox, show_Point, shrinkBox,
} from "./Geometry";

const box = (x1: number, y1: number, x2: number, y2: number): BoundBox => BoundBox(Point(x1, y1), Point(x2, y2));

function expectPointClose(p: Point, q: Point, digits = 9): void {
  expect(p._pX).toBeCloseTo(q._pX, digits);
  expect(p._pY).toBeCloseTo(q._pY, digits);
}

function justValue<A>(m: Maybe<A>): A {
  if (m.tag === "Nothing") throw new Error("expected Just");
  return m.value;
}

describe("Point", () => {
  it("lenses", () => {
    const p = Point(1, 2);
    expect(view(pX, p)).toBe(1);
    expect(view(pY, p)).toBe(2);
    expect(set(pX, 5, p)).toEqual(Point(5, 2));
    expect(set(pY, 7, p)).toEqual(Point(1, 7));
  });

  it("movePoint, pointDiff and distance", () => {
    expect(movePoint(Point(1, 2), [3, -4])).toEqual(Point(4, -2));
    expect(pointDiff(Point(1, 2), Point(4, 6))).toEqual([3, 4]);
    expect(distance([3, 4])).toBe(5);
  });

  it("JSON matches aeson", () => {
    expect(JSON_Point.toJSON(Point(1.5, -2))).toEqual({ x: 1.5, y: -2 });
    expect(JSON_Point.parseJSON({ x: 3, y: 4 })).toEqual(Point(3, 4));
    expect(JSON_Point.toJSON(Point(NaN, 1))).toEqual({ x: null, y: 1 });
    expect(() => JSON_Point.parseJSON({ x: 3 })).toThrow(J.JSONParseError);
  });

  it("show", () => {
    expect(show_Point(Point(1, -2.5))).toBe("Point {_pX = 1.0, _pY = -2.5}");
  });
});

describe("BoundBox", () => {
  it("monoid is union", () => {
    expect(append_BoundBox(box(0, 0, 1, 1), box(2, -1, 3, 0.5))).toEqual(box(0, -1, 3, 1));
    expect(append_BoundBox(NoBox, box(0, 0, 1, 1))).toEqual(box(0, 0, 1, 1));
    expect(append_BoundBox(box(0, 0, 1, 1), NoBox)).toEqual(box(0, 0, 1, 1));
    expect(append_BoundBox(NoBox, NoBox)).toEqual(NoBox);
    expect(mempty_BoundBox).toEqual(NoBox);
    expect(mconcat_BoundBox([box(0, 0, 1, 1), NoBox, box(5, 5, 6, 7)])).toEqual(box(0, 0, 6, 7));
  });

  it("JSON matches aeson", () => {
    expect(JSON_BoundBox.toJSON(NoBox)).toBe("NoBox");
    expect(JSON_BoundBox.toJSON(box(1, 2, 3, 4))).toEqual({ p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 } });
    expect(JSON_BoundBox.parseJSON("NoBox")).toEqual(NoBox);
    expect(JSON_BoundBox.parseJSON({ p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 } })).toEqual(box(1, 2, 3, 4));
    expect(() => JSON_BoundBox.parseJSON("Box")).toThrow(J.JSONParseError);
  });

  it("show", () => {
    expect(show_BoundBox(NoBox)).toBe("NoBox");
    expect(show_BoundBox(box(0, 0, 1, 2))).toBe(
      "BoundBox (Point {_pX = 0.0, _pY = 0.0}) (Point {_pX = 1.0, _pY = 2.0})");
  });

  it("mkBoundBox orders the corners", () => {
    expect(mkBoundBox(Point(5, 1), Point(2, 7))).toEqual(box(2, 1, 5, 7));
    expect(mkBoundBox(Point(5, 7), Point(2, 1))).toEqual(box(2, 1, 5, 7));
  });

  it("mkConstrainedBox", () => {
    expect(mkConstrainedBox(Point(0, 0), Point(1, 1))).toEqual(box(0, 0, 1, 1));
    expect(mkConstrainedBox(Point(0, 0), Point(0, 1))).toEqual(NoBox);
    expect(mkConstrainedBox(Point(2, 0), Point(1, 1))).toEqual(NoBox);
  });

  it("boxCentre lens", () => {
    expect(view(boxCentre, box(0, 0, 4, 2))).toEqual(Point(2, 1));
    expect(set(boxCentre, Point(10, 10), box(0, 0, 4, 2))).toEqual(box(8, 9, 12, 11));
    expect(() => view(boxCentre, NoBox)).toThrow("boxCenter does not exist for NoBox.");
    // Haskell reports "boxCenter cannot be set for NoBox." because its lens setter never forces
    // the getter; the TypeScript lens evaluates the getter first. Either way it is an error.
    expect(() => set(boxCentre, Point(0, 0), NoBox)).toThrow(/NoBox/);
  });

  it("width and height", () => {
    expect(boxWidth(box(1, 2, 4, 8))).toBe(3);
    expect(boxHeight(box(1, 2, 4, 8))).toBe(6);
    expect(boxWidth(NoBox)).toBe(0);
    expect(boxHeight(NoBox)).toBe(0);
  });

  it("boxResize keeps the centre", () => {
    expect(boxResize([2, 4], box(0, 0, 10, 10))).toEqual(box(4, 3, 6, 7));
    expect(boxResize([-3, 4], box(0, 0, 10, 10))).toEqual(box(5, 3, 5, 7));
    expect(boxResize([2, 4], NoBox)).toEqual(NoBox);
  });

  it("moveBox, growBox and shrinkBox", () => {
    expect(moveBox(box(0, 0, 1, 1), [2, 3])).toEqual(box(2, 3, 3, 4));
    expect(moveBox(NoBox, [2, 3])).toEqual(NoBox);
    expect(growBox(2, box(0, 0, 1, 1))).toEqual(box(-2, -2, 3, 3));
    expect(growBox(-2, box(0, 0, 1, 1))).toEqual(box(-2, -2, 3, 3));
    expect(growBox(2, NoBox)).toEqual(NoBox);
    expect(shrinkBox(1, box(0, 0, 4, 3))).toEqual(box(1, 1, 3, 2));
    expect(shrinkBox(2, box(0, 0, 4, 4))).toEqual(box(2, 2, 2, 2));
    expect(shrinkBox(2, box(0, 0, 4, 3))).toEqual(NoBox);
    expect(shrinkBox(1, NoBox)).toEqual(NoBox);
  });

  it("inBox is inclusive", () => {
    const b = box(0, 0, 10, 5);
    expect(inBox(Point(5, 2), b)).toBe(true);
    expect(inBox(Point(0, 0), b)).toBe(true);
    expect(inBox(Point(10, 5), b)).toBe(true);
    expect(inBox(Point(10.01, 5), b)).toBe(false);
    expect(inBox(Point(5, -1), b)).toBe(false);
    expect(inBox(Point(0, 0), NoBox)).toBe(false);
  });

  it("overlapBox and containsBox", () => {
    expect(overlapBox(box(0, 0, 2, 2), box(1, 1, 3, 3))).toBe(true);
    expect(overlapBox(box(0, 0, 2, 2), box(2, 2, 3, 3))).toBe(true); // Touching corners.
    expect(overlapBox(box(0, 0, 2, 2), box(2.1, 0, 3, 3))).toBe(false);
    expect(overlapBox(box(0, 0, 2, 2), box(0, 3, 2, 4))).toBe(false);
    expect(overlapBox(NoBox, box(0, 0, 1, 1))).toBe(false);
    expect(overlapBox(box(0, 0, 1, 1), NoBox)).toBe(false);
    expect(containsBox(box(0, 0, 10, 10), box(1, 1, 9, 9))).toBe(true);
    expect(containsBox(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(true);
    expect(containsBox(box(0, 0, 10, 10), box(1, 1, 11, 9))).toBe(false);
    expect(containsBox(NoBox, box(1, 1, 2, 2))).toBe(false);
    expect(containsBox(box(0, 0, 10, 10), NoBox)).toBe(false);
  });

  it("fitIntoBox", () => {
    expect(fitIntoBox(box(0, 0, 200, 100), box(0, 0, 100, 100))).toBe(0.5);
    expect(fitIntoBox(box(0, 0, 100, 400), box(50, 50, 150, 150))).toBe(0.25);
    expect(fitIntoBox(box(0, 0, 10, 10), box(0, 0, 100, 100))).toBe(1);
  });
});

describe("Lines", () => {
  it("lineFromPoints and linePoint", () => {
    const l = lineFromPoints(Point(1, 2), Point(5, 10));
    expect(l).toEqual(Line(Point(1, 2), 4, 8));
    expect(linePoint(l, 0)).toEqual(Point(1, 2));
    expect(linePoint(l, 1)).toEqual(Point(5, 10));
    expect(linePoint(l, 0.5)).toEqual(Point(3, 6));
  });

  it("lineIntersection gives the parameters on each line", () => {
    const l1 = lineFromPoints(Point(0, 0), Point(10, 0));
    const l2 = lineFromPoints(Point(5, -5), Point(5, 15));
    expect(lineIntersection(l1, l2)).toEqual(Just([0.5, 0.25]));
    expect(lineIntersection(l2, l1)).toEqual(Just([0.25, 0.5]));
    // Parallel lines.
    expect(lineIntersection(l1, lineFromPoints(Point(0, 1), Point(10, 1)))).toEqual(Nothing);
    // Same line.
    expect(lineIntersection(l1, l1)).toEqual(Nothing);
  });

  it("lineNormal is anti-clockwise", () => {
    expect(lineNormal(Line(Point(0, 0), 1, 0), Point(3, 3))).toEqual(Line(Point(3, 3), -0, 1));
  });

  it("lineDistance", () => {
    const l = lineFromPoints(Point(0, 0), Point(10, 0));
    expect(lineDistance(l, Point(5, 3))).toEqual(Just(3));
    expect(lineDistance(l, Point(0, -2))).toEqual(Just(2));
    expect(lineDistance(l, Point(15, 3))).toEqual(Nothing);
    expect(lineDistance(l, Point(-1, 3))).toEqual(Nothing);
    // Zero length line.
    expect(lineDistance(lineFromPoints(Point(1, 1), Point(1, 1)), Point(2, 2))).toEqual(Nothing);
  });

  it("insidePolygon", () => {
    const square = [Point(0, 0), Point(10, 0), Point(10, 10), Point(0, 10)];
    expect(insidePolygon(square, Point(5, 5))).toBe(true);
    expect(insidePolygon(square.slice().reverse(), Point(5, 5))).toBe(true);
    expect(insidePolygon(square, Point(15, 5))).toBe(false);
    expect(insidePolygon(square, Point(5, -1))).toBe(false);
    // Concave "L" shape.
    const ell = [Point(0, 0), Point(10, 0), Point(10, 4), Point(4, 4), Point(4, 10), Point(0, 10)];
    expect(insidePolygon(ell, Point(2, 8))).toBe(true);
    expect(insidePolygon(ell, Point(8, 2))).toBe(true);
    expect(insidePolygon(ell, Point(8, 8))).toBe(false);
    // Diamond.
    const diamond = [Point(0, 5), Point(5, 0), Point(10, 5), Point(5, 10)];
    expect(insidePolygon(diamond, Point(5, 5))).toBe(true);
    expect(insidePolygon(diamond, Point(1, 1))).toBe(false);
    // Degenerate polygons.
    expect(insidePolygon([], Point(0, 0))).toBe(false);
    expect(insidePolygon([Point(0, 0)], Point(0, 0))).toBe(false);
    expect(insidePolygon([Point(0, 0), Point(1, 1)], Point(0.5, 0.5))).toBe(false);
  });

  it("polygonLines starts with the closing edge", () => {
    const tri = [Point(0, 0), Point(4, 0), Point(0, 3)];
    expect(polygonLines(tri)).toEqual([
      lineFromPoints(Point(0, 3), Point(0, 0)),
      lineFromPoints(Point(0, 0), Point(4, 0)),
      lineFromPoints(Point(4, 0), Point(0, 3)),
    ]);
    expect(polygonLines([Point(0, 0), Point(1, 1)])).toEqual([
      lineFromPoints(Point(1, 1), Point(0, 0)),
      lineFromPoints(Point(0, 0), Point(1, 1)),
    ]);
    expect(polygonLines([Point(0, 0)])).toEqual([]);
    expect(polygonLines([])).toEqual([]);
  });

  it("polygonBox", () => {
    expect(polygonBox([Point(3, 1), Point(-2, 5), Point(4, 0)])).toEqual(box(-2, 0, 4, 5));
    expect(() => polygonBox([])).toThrow();
  });
});

describe("Intersects", () => {
  it("Line instance requires the intersection to be on the first line", () => {
    const seg = lineFromPoints(Point(0, 0), Point(10, 0));
    expect(Intersect_Line.intersectWith(seg, lineFromPoints(Point(5, -5), Point(5, 15)))).toEqual(Just(0.25));
    expect(Intersect_Line.intersectWith(seg, lineFromPoints(Point(15, -5), Point(15, 15)))).toEqual(Nothing);
    expect(Intersect_Line.intersectWith(seg, lineFromPoints(Point(0, 1), Point(10, 1)))).toEqual(Nothing);
  });

  it("List instance takes the lowest parameter", () => {
    const edges = polygonLines([Point(0, 0), Point(10, 0), Point(10, 10), Point(0, 10)]);
    const cls = Intersect_List(Intersect_Line);
    // A line from outside on the left passing through both vertical edges.
    const line = lineFromPoints(Point(-10, 5), Point(20, 5));
    expect(cls.intersectWith(edges, line)).toEqual(Just(1 / 3));
    expect(cls.intersectWith([], line)).toEqual(Nothing);
    expect(intersectPoint(cls, edges, Point(-10, 5), Point(20, 5))).toEqual(Just(Point(0, 5)));
    // Only the parameter on the edge is range checked, so an intersection behind the start of
    // the line (a negative parameter) wins.
    expect(cls.intersectWith(edges, lineFromPoints(Point(5, 5), Point(5, 30)))).toEqual(Just(-0.2));
    expect(intersectPoint(cls, edges, Point(5, 5), Point(5, 30))).toEqual(Just(Point(5, 0)));
    expect(intersectPoint(cls, edges, Point(20, 0), Point(20, 30))).toEqual(Nothing);
  });
});

describe("Constraints", () => {
  const l = Line(Point(0, 0), 1, 0);

  it("constrainLine keeps points on the positive part of the line", () => {
    expect(constrainLine(l)(Point(5, 3))).toEqual(Point(5, 0));
    expect(constrainLine(l, Point(5, -3))).toEqual(Point(5, 0));
    expect(constrainLine(l)(Point(-5, 3))).toEqual(Point(0, 0));
    expect(() => constrainLine(Line(Point(0, 0), 0, 0), Point(1, 1))).toThrow();
  });

  it("constrainLineLeft keeps points on the left of the line", () => {
    expect(constrainLineLeft(l)(Point(5, -3))).toEqual(Point(5, -3));
    expect(constrainLineLeft(l)(Point(5, 3))).toEqual(Point(5, 0));
    expect(constrainLineLeft(l, Point(-5, 3))).toEqual(Point(-5, 0));
  });

  it("constrainBox", () => {
    const b = box(0, 0, 10, 5);
    expect(constrainBox(b)(Point(5, 2))).toEqual(Point(5, 2));
    expect(constrainBox(b)(Point(-5, 20))).toEqual(Point(0, 5));
    expect(constrainBox(b, Point(15, -2))).toEqual(Point(10, 0));
    expect(constrainBox(NoBox)(Point(15, -2))).toEqual(Point(15, -2));
  });

  it("quadrants", () => {
    const o = Point(10, 10);
    expect(constrainQ1(o)(Point(5, 15))).toEqual(Point(10, 10));
    expect(constrainQ1(o)(Point(15, 5))).toEqual(Point(15, 5));
    expect(constrainQ2(o)(Point(5, 5))).toEqual(Point(5, 5));
    expect(constrainQ2(o)(Point(15, 15))).toEqual(Point(10, 10));
    expect(constrainQ3(o)(Point(5, 15))).toEqual(Point(5, 15));
    expect(constrainQ3(o, Point(15, 5))).toEqual(Point(10, 10));
    expect(constrainQ4(o)(Point(15, 15))).toEqual(Point(15, 15));
    expect(constrainQ4(o, Point(5, 5))).toEqual(Point(10, 10));
  });
});

describe("Ellipses", () => {
  const unit = box(-1, -1, 1, 1);

  it("ellipseIntersection gives both parameters", () => {
    expect(ellipseIntersection(unit, lineFromPoints(Point(-2, 0), Point(2, 0)))).toEqual(Just([0.75, 0.25]));
    expect(ellipseIntersection(unit, lineFromPoints(Point(-2, 2), Point(2, 2)))).toEqual(Nothing);
    expect(ellipseIntersection(NoBox, lineFromPoints(Point(-2, 0), Point(2, 0)))).toEqual(Nothing);
    const [t1, t2] = justValue(ellipseIntersection(box(0, 0, 4, 2), lineFromPoints(Point(-1, 1), Point(5, 1))));
    expect(t1).toBeCloseTo(5 / 6, 12);
    expect(t2).toBeCloseTo(1 / 6, 12);
  });

  it("ellipseIntersection1 gives the smallest non-negative parameter", () => {
    expect(ellipseIntersection1(unit, lineFromPoints(Point(-2, 0), Point(2, 0)))).toEqual(Just(0.25));
    expect(ellipseIntersection1(unit, lineFromPoints(Point(0, 0), Point(2, 0)))).toEqual(Just(0.5));
    expect(ellipseIntersection1(unit, lineFromPoints(Point(2, 0), Point(4, 0)))).toEqual(Nothing);
    expect(ellipseIntersection1(unit, lineFromPoints(Point(-2, 2), Point(2, 2)))).toEqual(Nothing);
  });

  it("ellipseNormalPoint on a circle", () => {
    expectPointClose(ellipseNormalPoint(unit, Point(3, 0)), Point(1, 0));
    expectPointClose(ellipseNormalPoint(unit, Point(3, 3)), Point(Math.SQRT1_2, Math.SQRT1_2));
    expectPointClose(ellipseNormalPoint(unit, Point(0, -5)), Point(0, -1));
  });

  it("ellipseNormalPoint on an ellipse", () => {
    const e = box(-2, -1, 2, 1);
    // On the major axis the foci are co-linear with the point, so the centre line is used.
    expectPointClose(ellipseNormalPoint(e, Point(5, 0)), Point(2, 0));
    // On the minor axis the construction is symmetrical.
    expectPointClose(ellipseNormalPoint(e, Point(0, 5)), Point(0, 1));
    // Elsewhere the result is on the ellipse and close to normal to it (within a few degrees:
    // the construction is an approximation).
    for (const pt of [Point(4, 3), Point(-3, 2), Point(1, -4), Point(-6, -1), Point(2.5, 0.2), Point(10, 10)]) {
      const q = ellipseNormalPoint(e, pt);
      expect((q._pX * q._pX) / 4 + q._pY * q._pY).toBeCloseTo(1, 9);
      const grad = [q._pX / 4, q._pY];
      const [dx, dy] = pointDiff(q, pt);
      const cosAngle = (grad[0] * dx + grad[1] * dy) / (Math.hypot(grad[0], grad[1]) * Math.hypot(dx, dy));
      expect(cosAngle).toBeGreaterThan(0.985);
    }
    // Regression values from an independent implementation of the focal construction.
    expectPointClose(ellipseNormalPoint(e, Point(4, 3)), Point(1.6824674609771084, 0.5406716292615221), 12);
    expectPointClose(ellipseNormalPoint(e, Point(-3, 2)), Point(-1.6845279419459571, 0.5390653051355001), 12);
  });

  it("ellipseNormalPoint for inside points uses the radial through the centre", () => {
    expectPointClose(ellipseNormalPoint(unit, Point(0.5, 0)), Point(-1, 0));
    expect(ellipseNormalPoint(unit, Point(0, 0))).toEqual(Point(0, 0));
  });

  it("ellipseNormalPoint for NoBox is the identity", () => {
    expect(ellipseNormalPoint(NoBox, Point(3, 4))).toEqual(Point(3, 4));
  });

  it("boxInsideEllipse", () => {
    const b = boxInsideEllipse(box(0, 0, 2, 2));
    if (b.tag !== "BoundBox") throw new Error("expected a box");
    const k = 1 - Math.SQRT1_2;
    expectPointClose(b._0, Point(k, k));
    expectPointClose(b._1, Point(2 - k, 2 - k));
    // Corners are on the circle.
    expect(distance(pointDiff(Point(1, 1), b._0))).toBeCloseTo(1, 12);
    expect(boxInsideEllipse(NoBox)).toEqual(NoBox);
  });
});
