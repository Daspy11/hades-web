import { describe, expect, it } from "vitest";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { view } from "@/lib/Control/Lens";
import * as J from "@/lib/Data/Aeson";
import {
  BoxShapeClass_CommentBox, BoxShapeClass_Diamond, BoxShapeClass_Ellipse, BoxShapeClass_Oval,
  BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, CommentBox, Diamond, Ellipse, JSON_LineShape,
  JSON_Rectangle, LineShape, LineShapeClass_LineShape, Oval, Parallelogram, Rectangle, ShapeClass_LineShape,
  boxHandles, commentBoxCorners, commentBoxOuter, diamondCorners, diamondInnerBox, diamondTouched,
  ellipseTouched, intersectWithRectangle, lineFractionPoint, lineFractionSegment, lineMenu, linePoints,
  lineSegments, lineSnap, lineTouched, ovalBoxOuter, ovalBoxTouched, parallelogramCorners,
  parallelogramOuterBox, parallelogramTouched, rectangleCorners, rectangleEdges, rectangleShape,
  show_LineShape,
} from "./BasicShapes";
import { Connected, Unconnected } from "./Connections";
import { BoundBox as Box, NoBox, Point as P, inBox, lineFromPoints, linePoint } from "./Geometry";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** An L-shaped line (0,0) -> (10,0) -> (10,10). */
const ell = LineShape([Unconnected(P(0, 0)), Unconnected(P(10, 10))], [P(10, 0)]);

describe("LineShape", () => {
  it("lists points and segments", () => {
    expect(linePoints(ell)).toEqual([P(0, 0), P(10, 0), P(10, 10)]);
    expect(lineSegments(ell)).toEqual([lineFromPoints(P(0, 0), P(10, 0)), lineFromPoints(P(10, 0), P(10, 10))]);
    expect(ShapeClass_LineShape.shapeBounds(ell)).toEqual(Box(P(0, 0), P(10, 10)));
  });

  it("finds points a fraction along the line", () => {
    expect(lineFractionPoint(0.25, ell)).toEqual(P(5, 0));
    expect(lineFractionPoint(0.5, ell)).toEqual(P(10, 0));
    expect(lineFractionPoint(0.75, ell)).toEqual(P(10, 5));
    expect(lineFractionPoint(-1, ell)).toEqual(P(0, 0));
    expect(lineFractionPoint(2, ell)).toEqual(P(10, 10));
    expect(LineShapeClass_LineShape.shapeAnnotationPoint(ell)).toEqual(P(10, 0));
    const [seg, f] = lineFractionSegment(0.75, ell);
    expect(seg).toEqual(lineFromPoints(P(10, 0), P(10, 10)));
    expect(f).toBe(0.5);
  });

  it("is touched within 4/scale of the line", () => {
    const seg = lineFromPoints(P(0, 0), P(10, 0));
    expect(lineTouched(1, P(5, 3.9), seg)).toBe(true);
    expect(lineTouched(1, P(5, 4.1), seg)).toBe(false);
    expect(lineTouched(2, P(5, 2.1), seg)).toBe(false);
    expect(lineTouched(1, P(13, 0), seg)).toBe(true); // Near the end point.
    expect(ShapeClass_LineShape.shapeTouched(ell, 1, P(12, 5))).toBe(true);
    expect(ShapeClass_LineShape.shapeTouched(ell, 1, P(5, 5))).toBe(false);
  });

  it("snaps points onto the line", () => {
    const r = lineSnap(2, ell, P(5, 1));
    expect(r).toEqual(Just([1, 0.25, P(5, 0)]));
    expect(lineSnap(0.5, ell, P(5, 1))).toEqual(Nothing);
    // Snap to the nearest segment.
    const r2 = lineSnap(3, ell, P(9, 6));
    expect(r2).toEqual(Just([1, 0.8, P(10, 6)]));
    // Snap to an end point beyond the end of the line.
    const r3 = lineSnap(3, ell, P(10, 11));
    expect(r3).toEqual(Just([1, 1, P(10, 10)]));
  });

  it("drags only unconnected ends", () => {
    const l = LineShape([Connected(P(0, 0), "x", Nothing), Unconnected(P(10, 10))], [P(10, 0)]);
    const l2 = ShapeClass_LineShape.shapeDrag([1, 2], l);
    expect(linePoints(l2)).toEqual([P(0, 0), P(11, 2), P(11, 12)]);
    expect(ShapeClass_LineShape.shapeInBox(ell, Box(P(-1, -1), P(11, 11)))).toBe(true);
    expect(ShapeClass_LineShape.shapeInBox(ell, Box(P(-1, -1), P(9, 11)))).toBe(false);
    expect(ShapeClass_LineShape.shapeConnectionPoint(ell, P(9, 1))).toEqual(P(10, 0));
  });

  it("round-trips through JSON in the aeson format", () => {
    const l = LineShape([Connected(P(0, 0), "6ba7b810-9dad-11d1-80b4-00c04fd430c8", Nothing), Unconnected(P(10, 10))], [P(10, 0)]);
    const v = JSON_LineShape.toJSON(l);
    expect(v).toEqual({
      ends: [
        { state: "connected", point: { x: 0, y: 0 }, target: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
        { state: "unconnected", point: { x: 10, y: 10 } },
      ],
      middle: [{ x: 10, y: 0 }],
    });
    const l2 = JSON_LineShape.parseJSON(JSON.parse(J.encode(v)));
    expect(equals(l2, l)).toBe(true);
    expect(LineShapeClass_LineShape.parseJSON(v)).toEqual(l2);
  });

  it("shows like Haskell", () => {
    expect(show_LineShape(LineShape([Unconnected(P(0, 0)), Unconnected(P(1, 2))], []))).toBe(
      "LineShape {_lineEnds = (Unconnected {connectorPoint = Point {_pX = 0.0, _pY = 0.0}}," +
      "Unconnected {connectorPoint = Point {_pX = 1.0, _pY = 2.0}}), _lineMiddle = []}");
  });

  it("offers a menu to add a bend", () => {
    const m = lineMenu((s: LineShape) => s, ell, P(5, 1));
    expect(m._0.length).toBe(1);
    expect(m._0[0][0].menuLabel).toBe("Add bend");
  });
});

describe("box handles", () => {
  it("are listed bottom and right first and constrain the new box", () => {
    const r = Rectangle(Box(P(0, 0), P(10, 20)));
    const hs = boxHandles(rectangleShape, r);
    expect(hs.map(([p]) => p)).toEqual([
      P(10, 20), P(0, 20), P(5, 20), P(10, 0), P(10, 10), P(0, 0), P(5, 0), P(0, 10)]);
    const [botRight, botLeft, bottom, topRight, right, topLeft, top, left] = hs.map(([, f]) => f);
    expect(botRight(P(15, 25))._rectangleShape).toEqual(Box(P(0, 0), P(15, 25)));
    expect(botRight(P(-5, -5))._rectangleShape).toEqual(Box(P(0, 0), P(1, 1)));
    expect(botLeft(P(20, 30))._rectangleShape).toEqual(Box(P(9, 0), P(10, 30)));
    expect(bottom(P(3, -10))._rectangleShape).toEqual(Box(P(0, 0), P(10, 1)));
    expect(topRight(P(-3, 25))._rectangleShape).toEqual(Box(P(0, 19), P(1, 20)));
    expect(right(P(4, 99))._rectangleShape).toEqual(Box(P(0, 0), P(4, 20)));
    expect(topLeft(P(-5, -5))._rectangleShape).toEqual(Box(P(-5, -5), P(10, 20)));
    expect(top(P(99, 30))._rectangleShape).toEqual(Box(P(0, 19), P(10, 20)));
    expect(left(P(30, 99))._rectangleShape).toEqual(Box(P(9, 0), P(10, 20)));
    expect(boxHandles(rectangleShape, Rectangle(NoBox))).toEqual([]);
  });
});

describe("Rectangle", () => {
  const r = Rectangle(Box(P(0, 0), P(10, 10)));
  it("has corners, edges and connection points", () => {
    expect(rectangleCorners(r)).toEqual([P(0, 0), P(10, 0), P(10, 10), P(0, 10)]);
    expect(rectangleEdges(r).length).toBe(4);
    expect(intersectWithRectangle(r, lineFromPoints(P(20, 5), P(5, 5)))).toEqual(Just(P(10, 5)));
    expect(BoxShapeClass_Rectangle.shapeConnectionPoint(r, P(20, 5))).toEqual(P(10, 5));
    expect(BoxShapeClass_Rectangle.shapeConnectionPoint(r, P(5, -20))).toEqual(P(5, 0));
  });
  it("resizes, drags and is touched", () => {
    expect(BoxShapeClass_Rectangle.shapeResize([20, 4], r)).toEqual(Rectangle(Box(P(-5, 3), P(15, 7))));
    expect(BoxShapeClass_Rectangle.shapeResize([20, 4], Rectangle(NoBox))).toEqual(Rectangle(NoBox));
    expect(BoxShapeClass_Rectangle.shapeDrag([1, 2], r)).toEqual(Rectangle(Box(P(1, 2), P(11, 12))));
    expect(BoxShapeClass_Rectangle.shapeInnerBox(r)).toEqual(Box(P(3, 3), P(7, 7)));
    expect(BoxShapeClass_Rectangle.shapeTouched(r, 1, P(10, 10))).toBe(true);
    expect(BoxShapeClass_Rectangle.shapeTouched(r, 1, P(10.1, 10))).toBe(false);
    expect(BoxShapeClass_Rectangle.shapeInBox(r, Box(P(-1, -1), P(10, 10)))).toBe(true);
    expect(view(BoxShapeClass_Rectangle.shapeDefinition, r)).toEqual(Box(P(0, 0), P(10, 10)));
  });
  it("is encoded as its bound box", () => {
    expect(JSON_Rectangle.toJSON(r)).toEqual({ p1: { x: 0, y: 0 }, p2: { x: 10, y: 10 } });
    expect(JSON_Rectangle.toJSON(Rectangle(NoBox))).toBe("NoBox");
    expect(BoxShapeClass_Rectangle.parseJSON({ p1: { x: 0, y: 0 }, p2: { x: 10, y: 10 } })).toEqual(r);
  });
});

describe("Ellipse", () => {
  const e = Ellipse(Box(P(0, 0), P(20, 10)));
  it("is touched inside the ellipse only", () => {
    expect(ellipseTouched(Box(P(0, 0), P(20, 10)), P(10, 5))).toBe(true);
    expect(ellipseTouched(Box(P(0, 0), P(20, 10)), P(1, 1))).toBe(false);
    expect(ellipseTouched(NoBox, P(1, 1))).toBe(false);
    expect(BoxShapeClass_Ellipse.shapeTouched(e, 1, P(19.9, 5))).toBe(true);
  });
  it("connects on the ellipse", () => {
    const p = BoxShapeClass_Ellipse.shapeConnectionPoint(e, P(40, 5));
    expect(close(p._pX, 20) && close(p._pY, 5)).toBe(true);
    const inner = BoxShapeClass_Ellipse.shapeInnerBox(e);
    expect(inner.tag).toBe("BoundBox");
    if (inner.tag === "BoundBox") {
      expect(ellipseTouched(Box(P(0, 0), P(20, 10)), inner._0)).toBe(true);
      expect(ellipseTouched(Box(P(0, 0), P(20, 10)), inner._1)).toBe(true);
    }
  });
});

describe("Diamond", () => {
  const b = Box(P(0, 0), P(10, 10));
  it("has corners, an inner box and a connection point", () => {
    expect(diamondCorners(b)).toEqual([P(0, 5), P(5, 0), P(10, 5), P(5, 10)]);
    expect(diamondCorners(NoBox)).toEqual([]);
    expect(diamondInnerBox(b)).toEqual(Box(P(2.5, 2.5), P(7.5, 7.5)));
    expect(diamondTouched(b, P(5, 5))).toBe(true);
    expect(diamondTouched(b, P(1, 1))).toBe(false);
    const p = BoxShapeClass_Diamond.shapeConnectionPoint(Diamond(b), P(20, 5));
    expect(close(p._pX, 10) && close(p._pY, 5)).toBe(true);
  });
  it("resizes as the original does", () => {
    // (sic) The Haskell original gives both corners the same y coordinate.
    expect(BoxShapeClass_Diamond.shapeResize([20, 20], Diamond(b))).toEqual(Diamond(Box(P(-5, 15), P(15, 15))));
    expect(BoxShapeClass_Diamond.shapeResize([20, 20], Diamond(NoBox))).toEqual(Diamond(NoBox));
  });
});

describe("Parallelogram", () => {
  const p = Parallelogram(Box(P(0, 0), P(30, 30)));
  it("has an outer box and slanted corners", () => {
    expect(parallelogramOuterBox(p)).toEqual(Box(P(-10, 0), P(40, 30)));
    expect(BoxShapeClass_Parallelogram.shapeBounds(p)).toEqual(Box(P(-10, 0), P(40, 30)));
    expect(parallelogramCorners(p)).toEqual([P(0, 0), P(-10, 30), P(30, 30), P(40, 0)]);
    expect(parallelogramTouched(p, P(38, 5))).toBe(true);
    expect(parallelogramTouched(p, P(39.5, 29))).toBe(false);
    expect(BoxShapeClass_Parallelogram.shapeInnerBox(p)).toEqual(Box(P(0, 0), P(30, 30)));
  });
  it("resizes allowing for the slant", () => {
    expect(BoxShapeClass_Parallelogram.shapeResize([50, 30], p)).toEqual(Parallelogram(Box(P(0, 0), P(30, 30))));
  });
});

describe("Oval", () => {
  const o = Oval(Box(P(0, 0), P(30, 30)));
  it("extends its inner box with elliptical ends", () => {
    expect(ovalBoxOuter(o)).toEqual(Box(P(-5, 0), P(35, 30)));
    expect(ovalBoxTouched(o, P(-4, 15))).toBe(true);
    expect(ovalBoxTouched(o, P(-4, 1))).toBe(false);
    expect(ovalBoxTouched(o, P(15, 29))).toBe(true);
    expect(BoxShapeClass_Oval.shapeResize([40, 30], o)).toEqual(Oval(Box(P(0, 0), P(30, 30))));
  });
  it("connects on the outline", () => {
    const p1 = BoxShapeClass_Oval.shapeConnectionPoint(o, P(15, -20));
    expect(close(p1._pX, 15) && close(p1._pY, 0)).toBe(true);
    const p2 = BoxShapeClass_Oval.shapeConnectionPoint(o, P(60, 15));
    expect(close(p2._pX, 35) && close(p2._pY, 15)).toBe(true);
  });
});

describe("CommentBox", () => {
  const c = CommentBox(Box(P(10, 10), P(30, 30)));
  it("has a folded corner around its inner box", () => {
    expect(commentBoxOuter(c)).toEqual(Box(P(0, 0), P(40, 40)));
    expect(commentBoxOuter(CommentBox(NoBox))).toEqual(NoBox);
    expect(commentBoxCorners(c)).toEqual([P(0, 10), P(10, 0), P(40, 0), P(40, 40), P(0, 40)]);
    expect(BoxShapeClass_CommentBox.shapeTouched(c, 1, P(1, 1))).toBe(false);
    expect(BoxShapeClass_CommentBox.shapeTouched(c, 1, P(20, 20))).toBe(true);
    expect(BoxShapeClass_CommentBox.shapeResize([40, 40], c)).toEqual(CommentBox(Box(P(10, 10), P(30, 30))));
    const p = BoxShapeClass_CommentBox.shapeConnectionPoint(c, P(80, 20));
    expect(close(p._pX, 40) && close(p._pY, 20)).toBe(true);
    expect(inBox(linePoint(lineFromPoints(P(0, 0), P(40, 40)), 0.5), commentBoxOuter(c))).toBe(true);
  });
});
