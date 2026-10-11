// Ported from hades/src/Hades/GI/BasicShapes.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Cairo renderings of the basic shapes supported by Hades.
 *
 * Design Note:
 *
 * Rather than try to anticipate every possible future diagram type this module merely provides
 * the facilities required so far. As more diagrams are added it is likely that this module will
 * increase in capability.
 *
 * TypeScript port
 * ---------------
 * * `type HadesRender = ReaderT HadesStyle Cairo.Render` is a function of a `HadesEnv`
 *   (`{ style, cr }`): `HadesRender<A> = (env: HadesEnv) => A`. `ask`/`asks f` read
 *   `env.style`; lifting a Cairo action calls it with `env.cr`;
 *   `local f act` is `local(f, act)` (exported below). Run one with
 *   `runHadesRender(act, style, cr)` (`runReaderT act style` in a Cairo context) or simply
 *   `act({ style, cr })`. A `HadesRender<void>` is a `Paint` (see `Hades.Abstract.Delta`), so
 *   the shape drawing functions here give `viewDraw` values directly: `viewDraw: drawEllipse(e)`.
 * * Functions returning a `HadesRender` return the action: `drawPolygon(pts)(env)` runs it.
 *   Constant actions (`stroke`, `fillBox`, ...) are `HadesRender` values.
 * * `type HadesLayout a = StateT (BoundBox, Double) HadesRender a` is
 *   `HadesLayout<A> = (env: HadesEnv, st: { state: [BoundBox, number] }) => A`: the state cell
 *   holds the remaining box and the line height. Within a layout, `lift act` is `act(env)` and
 *   a nested layout action runs as `act(env, st)`. `evalStateT act s` is
 *   `evalHadesLayout(act, s)` and `runStateT act s` is `runHadesLayout(act, s)`; both give
 *   `HadesRender` actions. `layoutBox`, `layoutLine`, `layoutParagraphGap` and `layoutHLine`
 *   are `HadesLayout` values.
 * * Text layout modifiers (`[Pango.Layout -> HadesLayout ()]`) are functions from the layout to a
 *   layout action, e.g. `(l) => () => Pango.layoutSetAlignment(l, Pango.AlignmentCenter)`.
 * * `GI.Rsvg` is `@/lib/GI/Rsvg` (SVG handles drawn with the browser's SVG renderer).
 * * Text is measured and drawn with `@/lib/GI/Pango`, which treats 1pt as 4/3 px (96 dpi) like
 *   PangoCairo on the desktop, so diagram text has the same size relative to the shapes.
 */
import * as Cairo from "@/lib/GI/Cairo";
import * as Pango from "@/lib/GI/Pango";
import * as Gdk from "@/lib/GI/Gdk";
import type * as Gtk from "@/lib/GI/Gtk";
import * as SVG from "@/lib/GI/Rsvg";
import * as C from "@/lib/Data/Colour";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { type StateCell, _1, assign, use } from "@/lib/Control/Lens";
import { absurd, error, round } from "@/lib/Prelude";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { type Colour, Colour as mkColour, getColour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  type CommentBox, type Ellipse, type LineShape, type Oval, commentBoxCorners, lineFractionSegment,
  ovalAspect,
} from "@/hades/src/Hades/Abstract/BasicShapes";
import { type Action, type Delta, type DeltaCtx, type View, deltaZoom } from "@/hades/src/Hades/Abstract/Delta";
import {
  type BoundBox, BoundBox as mkBox, NoBox, Point, boxHeight, boxWidth, distance, inBox, linePoint,
  mkBoundBox, mkConstrainedBox, movePoint, pointDiff,
} from "@/hades/src/Hades/Abstract/Geometry";

/** Haskell `max` on `Double`. */
function hmax(x: number, y: number): number {
  return x <= y ? y : x;
}

export type RGB = [number, number, number];

/**
 * Key style attributes for Hades diagrams. Shapes should use these unless they have a
 * specific reason to override them (such as conditional formatting). Each component consists
 * of @Render@ actions to set the Cairo context appropriately.
 */
export interface HadesStyle {
  readonly boxBorderStyle: HadesRender<void>;
  readonly boxFillStyle: HadesRender<void>;
  readonly lineStyle: HadesRender<void>;
  readonly textFont: Pango.FontDescription;
  readonly textStyle: HadesRender<void>;
  /** Inter-paragraph separation as fractions of a line. */
  readonly textGap: number;
  readonly dataIcons: Gtk.IconTheme;
}
export function HadesStyle(
  boxBorderStyle: HadesRender<void>,
  boxFillStyle: HadesRender<void>,
  lineStyle: HadesRender<void>,
  textFont: Pango.FontDescription,
  textStyle: HadesRender<void>,
  textGap: number,
  dataIcons: Gtk.IconTheme,
): HadesStyle {
  return { boxBorderStyle, boxFillStyle, lineStyle, textFont, textStyle, textGap, dataIcons };
}

/** Size of the font on Hades diagrams. */
export const hadesFontSize: number = 9;

/**
 * Assumed DPI for drawing Hades diagrams. By keeping this constant we can ensure that things
 * always get arranged the same way, and scaling is done later.
 */
const hadesDPI: number = 90;

/**
 * Convert HADES diagram units to Pango.
 *
 * (Not exported by the Haskell module; exported here for other ports and tests.)
 */
export function hadesToPango(x: number): number {
  return round(x * Pango.SCALE);
}

/**
 * Convert Pango units to HADES.
 *
 * (Not exported by the Haskell module; exported here for other ports and tests.)
 */
export function pangoToHades(x: number): number {
  return x / Pango.SCALE;
}

/** Placeholder with hard-coded style. Colours chosen by staring at a mock-up. */
export function hadesConfig(thm: Gtk.IconTheme): HadesStyle {
  const boxColor = mkColour(C.sRGB24(206, 198, 190));
  const black = mkColour(C.black);
  const [border, fill] = basicBox(2, black, boxColor);
  const font = Pango.fontDescriptionNew();
  Pango.fontDescriptionSetFamily(font, "Roboto,Symbola,STIX Two Text");
  Pango.fontDescriptionSetSize(font, round(hadesFontSize * Pango.SCALE));
  return {
    boxBorderStyle: border,
    boxFillStyle: fill,
    lineStyle: basicLine(2, black),
    textFont: font,
    textStyle: basicText(black),
    textGap: 0.5,
    dataIcons: thm,
  };
}

/** The environment of a `HadesRender` action: the style (the `ReaderT` environment) and the Cairo context. */
export interface HadesEnv {
  readonly style: HadesStyle;
  readonly cr: Cairo.Context;
}

/** Monad for Cairo operations with a consistent drawing style. */
export type HadesRender<A = void> = (env: HadesEnv) => A;

/** `runReaderT act style`, run in the Cairo context `cr`. */
export function runHadesRender<A>(act: HadesRender<A>, style: HadesStyle, cr: Cairo.Context): A {
  return act({ style, cr });
}

/** `local f act` in the `HadesRender` monad: run the action with a modified style. */
export function local<A>(f: (s: HadesStyle) => HadesStyle, act: HadesRender<A>): HadesRender<A> {
  return (env) => act({ ...env, style: f(env.style) });
}

/** Local modification to the line drawing colour. */
export function withLineColour<A>(c: Colour, act: HadesRender<A>): HadesRender<A> {
  return (env) => {
    const { channelRed: r, channelGreen: g, channelBlue: b } = C.toSRGB(getColour(c));
    const addToLines = (c1: HadesRender<void>, s: HadesStyle): HadesStyle => ({
      ...s,
      boxBorderStyle: (e) => {
        s.boxBorderStyle(e);
        c1(e);
      },
      lineStyle: (e) => {
        s.lineStyle(e);
        c1(e);
      },
    });
    return local((s) => addToLines((e) => Cairo.setSourceRGB(e.cr, r, g, b), s), act)(env);
  };
}

/**
 * Bridge between gi-cairo and the hand-written cairo
 * package. It takes a `GI.Cairo.Context` (as it appears in gi-cairo),
 * and a `Render` action (as in the cairo lib), and renders the
 * `Render` action into the given context.
 *
 * Copied from
 * https://github.com/haskell-gi/haskell-gi/wiki/Using-Cairo-with-haskell-gi-generated-bindings
 */
export function renderWithHades(ctx: Cairo.Context, style: HadesStyle, r: HadesRender<void>): void {
  Cairo.renderWithContext((cr) => r({ style, cr }), ctx);
}

/** Stroke the current path using the Hades line style. */
export const stroke: HadesRender<void> = (env) => {
  env.style.lineStyle(env);
  Cairo.stroke(env.cr);
};

/** Stroke the current path using the Hades line style, and preserve it. */
export const strokePreserve: HadesRender<void> = (env) => {
  env.style.lineStyle(env);
  Cairo.strokePreserve(env.cr);
};

/** Stroke and fill the current path using the Hades box styles. */
export const fillBox: HadesRender<void> = (env) => {
  env.style.boxFillStyle(env);
  Cairo.fillPreserve(env.cr);
  env.style.boxBorderStyle(env);
  Cairo.stroke(env.cr);
};

/** Sets the Cairo context for drawing lines of a given thickness and colour. */
export function basicLine(
  /** Thickness */
  width: number,
  c: Colour,
): HadesRender<void> {
  return ({ cr }) => {
    const [r, g, b] = colourToRGB(c);
    Cairo.setLineJoin(cr, Cairo.LineJoinRound);
    Cairo.setDash(cr, [], 0);
    Cairo.setLineWidth(cr, width);
    Cairo.setLineCap(cr, Cairo.LineCapRound);
    Cairo.setSourceRGB(cr, r, g, b);
  };
}

/** Provides the Cairo contexts for boxes. The first is the edge style, the second the fill style. */
export function basicBox(
  /** Border thickness */
  width: number,
  /** Border colour */
  border: Colour,
  /** Fill colour */
  fill: Colour,
): [HadesRender<void>, HadesRender<void>] {
  const edgeStyle: HadesRender<void> = ({ cr }) => {
    const [r, g, b] = colourToRGB(border);
    Cairo.setLineWidth(cr, width);
    Cairo.setLineJoin(cr, Cairo.LineJoinRound);
    Cairo.setLineCap(cr, Cairo.LineCapRound);
    Cairo.setDash(cr, [], 0);
    Cairo.setSourceRGB(cr, r, g, b);
  };
  const fillStyle: HadesRender<void> = ({ cr }) => {
    const [r, g, b] = colourToRGB(fill);
    Cairo.setFillRule(cr, Cairo.FillRuleWinding); // Matches Hades.Abstract.Geometry.insidePolygon
    Cairo.setSourceRGB(cr, r, g, b);
  };
  return [edgeStyle, fillStyle];
}

/** Provides the Cairo context for rendering text in the given colour. */
function basicText(c: Colour): HadesRender<void> {
  const [r, g, b] = colourToRGB(c);
  return ({ cr }) => Cairo.setSourceRGB(cr, r, g, b);
}

function colourToRGB(c: Colour): RGB {
  const { channelRed: r, channelGreen: g, channelBlue: b } = C.toSRGB(getColour(c));
  return [r, g, b];
}

/**
 * A handle with a small black square as a glyph. The handle does not scale with the rest of the
 * diagram.
 *
 * (A `Handle v`: `(Viewable v, Paint v ~ HadesRender)`; the dictionary is `d.cls`.)
 */
export function* squareHandle<V>(
  d: DeltaCtx<V>,
  menu: Menu<Action<V>>,
  p0: Point,
  evh: (d: DeltaCtx<V>, a: Action<V>) => Delta<V, Action<V>>,
): Delta<V, View<V>> {
  const zm = use(d, deltaZoom<V>());
  const handleSize = 10; // pixels on a side.
  const d2 = handleSize / zm;
  const dd = d2 / 2;
  const b = mkBox(Point(p0._pX - dd, p0._pY - dd), Point(p0._pX + dd, p0._pY + dd));
  return {
    viewDraw: (({ cr }) => {
      Cairo.setSourceRGB(cr, 0, 0, 0);
      Cairo.rectangle(cr, p0._pX - dd, p0._pY - dd, d2, d2);
      Cairo.fill(cr);
    }) satisfies HadesRender<void>,
    viewTouched: (p) => inBox(p, b),
    viewBox: b,
    viewMenu: () => menu,
    viewAction: evh,
  };
}

// ---------------------------------------------------------------------------------------------
// Box-like shapes

/** A closed polygon represented by its vertices. */
export function drawPolygon(points: readonly Point[]): HadesRender<void> {
  return (env) => {
    if (points.length < 2) return;
    const [pt, ...pts] = points;
    const cr = env.cr;
    Cairo.moveTo(cr, pt._pX, pt._pY);
    for (const p of pts) Cairo.lineTo(cr, p._pX, p._pY);
    Cairo.closePath(cr);
    fillBox(env);
  };
}

/** Draw an ellipse within the bounding box. */
export function drawEllipse(e: Ellipse): HadesRender<void> {
  return (env) => {
    const box = e._ellipseShape;
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const p1 = box._0, p2 = box._1;
        const [dx, dy] = pointDiff(p1, p2);
        const cr = env.cr;
        Cairo.save(cr); // This code adapted from the example given in the Haskell Cairo library.
        Cairo.translate(cr, p1._pX + dx / 2, p1._pY + dy / 2);
        Cairo.scale(cr, dx / 2, dy / 2);
        Cairo.moveTo(cr, 1, 0);
        Cairo.arc(cr, 0, 0, 1, 0, 2 * Math.PI);
        Cairo.restore(cr);
        fillBox(env);
        return;
      }
      default:
        return absurd(box);
    }
  };
}

/** Draw a box with rounded ends. */
export function drawOval(o: Oval): HadesRender<void> {
  return (env) => {
    const box = o._ovalShape;
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const p1 = box._0, p2 = box._1;
        const height = pointDiff(p1, p2)[1];
        const cr = env.cr;
        Cairo.moveTo(cr, p1._pX, p2._pY); // Top left of inner box.
        Cairo.save(cr);
        Cairo.translate(cr, p2._pX, p1._pY + height / 2);
        Cairo.scale(cr, ovalAspect * height / 2, height / 2);
        // Top border is implicit line to start of arc
        Cairo.arcNegative(cr, 0, 0, 1, Math.PI / 2, 3 * Math.PI / 2);
        Cairo.restore(cr);
        Cairo.save(cr);
        Cairo.translate(cr, p1._pX, p1._pY + height / 2);
        Cairo.scale(cr, ovalAspect * height / 2, height / 2);
        // Bottom border is implicit line to start of arc
        Cairo.arcNegative(cr, 0, 0, 1, 3 * Math.PI / 2, Math.PI / 2);
        Cairo.restore(cr);
        Cairo.closePath(cr);
        fillBox(env);
        return;
      }
      default:
        return absurd(box);
    }
  };
}

/** Draw a comment box. This is a rectangle with the top left hand corner folded over. */
export function drawCommentBox(box: CommentBox): HadesRender<void> {
  const commentBlue = mkColour(C.sRGB24(183, 187, 210));
  return (env) => {
    const points = commentBoxCorners(box);
    if (points.length < 2) return;
    // commentBoxCorners returns the fold ends as the first two points.
    const [p1, p2] = points;
    const [border, fill] = basicBox(2, mkColour(C.black), commentBlue);
    local((e) => ({ ...e, boxBorderStyle: border, boxFillStyle: fill }), (env1) => {
      drawPolygon(points)(env1);
      const cr = env1.cr;
      Cairo.moveTo(cr, p1._pX, p1._pY);
      Cairo.lineTo(cr, p2._pX, p1._pY);
      Cairo.lineTo(cr, p2._pX, p2._pY);
      Cairo.stroke(cr);
    })(env);
  };
}

// ---------------------------------------------------------------------------------------------
// Line shapes

/** Describes how to draw the end of an arrow. */
export interface ArrowHead {
  /** Distance from origin that the incoming line should stop. */
  readonly arrowHeadLength: number;
  /** Width of the arrow head. */
  readonly arrowHeadWidth: number;
  /** Draw an arrowhead pointing from right to left ending at @(0,0)@ */
  readonly arrowHeadRender: HadesRender<void>;
}
export function ArrowHead(arrowHeadLength: number, arrowHeadWidth: number, arrowHeadRender: HadesRender<void>): ArrowHead {
  return { arrowHeadLength, arrowHeadWidth, arrowHeadRender };
}

export const noArrowHead: ArrowHead = ArrowHead(0, 0, () => {});

/** Triangular arrow head, either filled or not. */
export function closedArrowHead(
  /** Angle of arrow head in degrees. 90 is a fat arrow, 45 is a narrow arrow. */
  angle: number,
  /** Length of the arrow head. */
  len: number,
  /** If true then fill the arrow black, otherwise fill white. */
  solid: boolean,
): ArrowHead {
  const width = 2 * len * Math.tan(angle * Math.PI / 360); // Angle is the arrow head angle.
  return ArrowHead(len, width, (env) => {
    const cr = env.cr;
    Cairo.save(cr);
    Cairo.moveTo(cr, 0, 0);
    Cairo.lineTo(cr, len, width / 2);
    Cairo.lineTo(cr, len, (-width) / 2);
    Cairo.closePath(cr);
    Cairo.setLineJoin(cr, Cairo.LineJoinMiter); // Arrows have sharp corners.
    if (solid) Cairo.setSourceRGB(cr, 0, 0, 0);
    else Cairo.setSourceRGB(cr, 1, 1, 1);
    Cairo.fillPreserve(cr);
    env.style.lineStyle(env);
    Cairo.stroke(cr); // Stroke will expand arrow size by line thickness even when filled.
    Cairo.restore(cr);
  });
}

/**
 * Open arrow head without the line across the back, and with the incoming line going all
 * the way to the point.
 */
export function openArrowHead(angle: number, len: number): ArrowHead {
  const width = 2 * len * Math.tan(angle * Math.PI / 360);
  return ArrowHead(0, width, (env) => {
    const cr = env.cr;
    Cairo.save(cr);
    Cairo.moveTo(cr, len, width / 2);
    Cairo.lineTo(cr, 0, 0);
    Cairo.lineTo(cr, len, (-width) / 2);
    Cairo.setLineJoin(cr, Cairo.LineJoinMiter); // Arrows have sharp corners.
    env.style.lineStyle(env);
    Cairo.stroke(cr); // Stroke will expand arrow size by line thickness even when filled.
    Cairo.restore(cr);
  });
}

/** Draw a small circle as an arrow head. */
export function circleArrowHead(
  /** Diameter of circle. */
  diam: number,
  /** Fill black if true, white if false. */
  solid: boolean,
): ArrowHead {
  const r = diam / 2;
  return ArrowHead(diam, diam, (env) => {
    const cr = env.cr;
    Cairo.save(cr);
    Cairo.moveTo(cr, 0, 0);
    Cairo.arc(cr, r, 0, r, -Math.PI, Math.PI);
    Cairo.closePath(cr);
    if (solid) Cairo.setSourceRGB(cr, 0, 0, 0);
    else Cairo.setSourceRGB(cr, 1, 1, 1);
    Cairo.fillPreserve(cr);
    env.style.lineStyle(env);
    Cairo.stroke(cr); // Stroke will expand arrow size by line thickness even when filled.
    Cairo.restore(cr);
  });
}

/**
 * An arrow head composed of two or more arrow heads. Useful for @->>@ and @->o@ arrows.
 *
 * The arrow heads are drawn with the first one on top, and the last one in the list placed at
 * the tip.
 */
export function multiArrowHead(
  /**
   * Compression factor. The length of all arrow heads except the first will be
   * multiplied by this factor, squashing them together if it is less than 1.
   */
  compress: number,
  /** List of arrow heads drawn in this order. */
  allHeads: readonly ArrowHead[],
): ArrowHead {
  if (allHeads.length === 0) return noArrowHead;
  const [firstHead, ...otherHeads] = allHeads;
  const len = firstHead.arrowHeadLength + compress * L.sum(otherHeads.map((h) => h.arrowHeadLength));
  const width = L.maximum(allHeads.map((h) => h.arrowHeadWidth));
  return ArrowHead(len, width, (env) => {
    Cairo.save(env.cr);
    for (const h of L.reverse(allHeads)) {
      h.arrowHeadRender(env);
      Cairo.translate(env.cr, h.arrowHeadLength * compress, 0);
    }
    Cairo.restore(env.cr);
  });
}

/** Kludge for zero length lines. */
function fixNaN(d: number, v: number): number {
  return Number.isNaN(v) ? d : v;
}

/** Draw a line from the current point to Point 2 ending in an arrow head. */
function drawArrowLine(arrow: ArrowHead, p2: Point): HadesRender<void> {
  return (env) => {
    const cr = env.cr;
    const p1 = Point(...Cairo.getCurrentPoint(cr));
    const headLength = arrow.arrowHeadLength;
    const [dx, dy] = pointDiff(p1, p2);
    const angle = Math.atan2(dy, dx);
    const len = Math.sqrt(dx * dx + dy * dy);
    const unitX = fixNaN(1, dx / len);
    const unitY = fixNaN(0, dy / len);
    const back = movePoint(p2, [(-unitX) * headLength, (-unitY) * headLength]);
    // Draw the line to the back of the arrowhead.
    Cairo.lineTo(cr, back._pX, back._pY);
    Cairo.stroke(cr);
    Cairo.setDash(cr, [], 0);
    // Draw the arrowhead pointing right and rotate it
    // into place.
    Cairo.save(cr);
    Cairo.translate(cr, p2._pX, p2._pY);
    Cairo.rotate(cr, angle + Math.PI);
    Cairo.moveTo(cr, 0, 0);
    arrow.arrowHeadRender(env);
    Cairo.stroke(cr); // Stroke will expand arrow size by line thickness even when filled.
    Cairo.restore(cr);
  };
}

/**
 * Draw a polyline with a specified arrowhead at the end. Due to the non-composable nature of
 * Cairo elements this cannot be represented as a path.
 *
 * ToDo: Figure out how to stop connected lines from gribbling over the boxes they are
 * connected to.
 */
export function drawPolyLine(
  arrow: ArrowHead,
  /** Line dash pattern. @[]@ means a solid line. */
  dashes: readonly number[],
  /** Start point of arrow. */
  startPoint: Point,
  /** Points where the line bends. */
  midPoints: readonly Point[],
  /** End point of arrow. */
  endPoint: Point,
  /** Optional label */
  label: Maybe<string>,
): HadesRender<void> {
  const segMiddle = (f: number, p1: Point, p2: Point): Point => {
    const [dx, dy] = pointDiff(p1, p2);
    return movePoint(p1, [dx * f, dy * f]);
  };
  const middle = (): Point => {
    const allPoints = [startPoint, ...midPoints, endPoint];
    const segments = L.zip(allPoints, L.tail(allPoints));
    const lengths = segments.map(([p1, p2]) => distance(pointDiff(p1, p2)));
    const half = L.sum(lengths) / 2;
    const segEndDists = L.zip(segments, L.drop(1, L.scanl((a: number, b: number) => a + b, 0, lengths)));
    const rest = L.dropWhile(([, d]) => d < half, segEndDists);
    if (rest.length === 0) return segMiddle(0.5, startPoint, endPoint); // Something wierd happened in the numerics.
    const [[p1, p2], d] = rest[0];
    return segMiddle((d - half) / distance(pointDiff(p1, p2)), p2, p1);
  };
  return (env) => {
    const cr = env.cr;
    env.style.lineStyle(env);
    Cairo.setDash(cr, dashes, 0);
    Cairo.moveTo(cr, startPoint._pX, startPoint._pY);
    for (const pt of midPoints) Cairo.lineTo(cr, pt._pX, pt._pY);
    drawArrowLine(arrow, endPoint)(env);
    switch (label.tag) {
      case "Nothing":
        return;
      case "Just": {
        const txt = label.value;
        env.style.textStyle(env);
        const font = env.style.textFont;
        const m = middle();
        Cairo.save(cr);
        const labelLayout = pangoCreateDiagramLayout(txt)(cr);
        Pango.layoutSetFontDescription(labelLayout, font);
        const rect = Pango.layoutGetExtents(labelLayout)[0];
        const x = pangoToHades(Pango.get(rect, "x"));
        const y = pangoToHades(Pango.get(rect, "y"));
        const w = pangoToHades(Pango.get(rect, "width"));
        const h = pangoToHades(Pango.get(rect, "height"));
        Cairo.moveTo(cr, m._pX - x - w / 2, m._pY - y - h / 2);
        Cairo.toRender((c) => Pango.showLayout(c, labelLayout))(cr);
        Cairo.restore(cr);
        return;
      }
      default:
        return absurd(label);
    }
  };
}

/** Descriptor for an annotation to go on an arrow */
export interface ArrowDecoration {
  /** 0 = tail, 1 = head, 0.5 = half way along. */
  readonly arrowDecPosition: number;
  /** Render a decoration on top of the arrow line. */
  readonly arrowDecOnLine: HadesRender<void>;
  /**
   * Optional annotation to one side of the arrow, containing the @(width, height)@ of
   * the annotation, and the render action to start from (0,0).
   * Width and height must not be negative.
   */
  readonly arrowDecOffLine: Maybe<readonly [readonly [number, number], HadesRender<void>]>;
}
export function ArrowDecoration(
  arrowDecPosition: number,
  arrowDecOnLine: HadesRender<void>,
  arrowDecOffLine: Maybe<readonly [readonly [number, number], HadesRender<void>]>,
): ArrowDecoration {
  return { arrowDecPosition, arrowDecOnLine, arrowDecOffLine };
}

/**
 * Draw the decoration at the appropriate point, figuring out the best place to put the
 * off-line component.
 */
export function drawArrowDecoration(shape: LineShape, deco: ArrowDecoration): HadesRender<void> {
  const dotProduct = ([x1, y1]: readonly [number, number], [x2, y2]: readonly [number, number]): number =>
    x1 * x2 + y1 * y2;
  return (env) => {
    const cr = env.cr;
    const [seg, f] = lineFractionSegment(deco.arrowDecPosition, shape);
    const dx = seg._1, dy = seg._2;
    const pt0 = linePoint(seg, f);
    const len = Math.sqrt(dx * dx + dy * dy);
    const unitX = fixNaN(1, dx / len);
    const unitY = fixNaN(0, dy / len);
    const angle = Math.atan2(dy, dx);
    // Render on-line component.
    Cairo.save(cr);
    Cairo.translate(cr, pt0._pX, pt0._pY);
    Cairo.rotate(cr, angle + Math.PI);
    Cairo.moveTo(cr, 0, 0);
    deco.arrowDecOnLine(env);
    Cairo.restore(cr);
    // Render off-line component.
    const off = deco.arrowDecOffLine;
    switch (off.tag) {
      case "Nothing":
        return;
      case "Just": {
        const [[w, h], offLineAct] = off.value;
        let topLeft: Point;
        if (dx > 0 && dy > 0) {
          // Box touches seg at top right.
          const d0 = dotProduct([w / 2, -h / 2], [unitX, unitY]);
          const pt1 = movePoint(pt0, [unitX * d0, unitY * d0]);
          topLeft = movePoint(pt1, [-w, 0]);
        } else if (dx > 0) {
          // Box touches seg at top left.
          const d0 = dotProduct([-w / 2, -h / 2], [unitX, unitY]);
          topLeft = movePoint(pt0, [unitX * d0, unitY * d0]);
        } else if (dy > 0) {
          // Box touches seg at bottom right.
          const d0 = dotProduct([w / 2, h / 2], [unitX, unitY]);
          const pt1 = movePoint(pt0, [unitX * d0, unitY * d0]);
          topLeft = movePoint(pt1, [-w, -h]);
        } else {
          // Box touches seg at bottom left.
          const d0 = dotProduct([-w / 2, h / 2], [unitX, unitY]);
          const pt1 = movePoint(pt0, [unitX * d0, unitY * d0]);
          topLeft = movePoint(pt1, [0, -h]);
        }
        Cairo.save(cr);
        Cairo.translate(cr, topLeft._pX, topLeft._pY);
        Cairo.moveTo(cr, 0, 0);
        offLineAct(env);
        Cairo.restore(cr);
        return;
      }
      default:
        return absurd(off);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Text layout

/**
 * Hades Layout tracks the remaing BoundBox into which sub-elements can be inserted. As each
 * sub-element is addded it consumes space from the top of the box. The "Double" is the
 * line height.
 */
export type HadesLayout<A = void> = (env: HadesEnv, st: StateCell<[BoundBox, number]>) => A;

/** `evalStateT act s` for a `HadesLayout`: run it from the state `s`, giving its result. */
export function evalHadesLayout<A>(act: HadesLayout<A>, s: readonly [BoundBox, number]): HadesRender<A> {
  return (env) => act(env, { state: [s[0], s[1]] });
}

/** `runStateT act s` for a `HadesLayout`: run it from the state `s`, giving the result and final state. */
export function runHadesLayout<A>(act: HadesLayout<A>, s: readonly [BoundBox, number]): HadesRender<[A, [BoundBox, number]]> {
  return (env) => {
    const st: StateCell<[BoundBox, number]> = { state: [s[0], s[1]] };
    const r = act(env, st);
    return [r, st.state];
  };
}

/**
 * Execute a Hades Layout action within the HadesRender monad. If there is no box then
 * it returns @Nothing@.
 */
export function runLayout<A>(box: BoundBox, act: HadesLayout<A>): HadesRender<Maybe<A>> {
  return (env) => {
    switch (box.tag) {
      case "NoBox":
        return Nothing;
      case "BoundBox": {
        const p1 = box._0, p2 = box._1;
        const [dx, dy] = pointDiff(p1, p2);
        // Establish a clip region for this text.
        env.style.textStyle(env);
        const font = env.style.textFont;
        const cr = env.cr;
        // This is like using assembler. Oh for a declarative API...
        Cairo.save(cr);
        Cairo.rectangle(cr, p1._pX, p1._pY, dx, dy);
        Cairo.clip(cr);
        const ctx = Cairo.toRender(Pango.createContext)(cr);
        const metrics = Pango.contextGetMetrics(ctx, font, null);
        const lineHeight = pangoToHades(Pango.fontMetricsGetHeight(metrics));
        const r = evalHadesLayout(act, [box, lineHeight])(env);
        Cairo.restore(cr);
        return Just(r);
      }
      default:
        return absurd(box);
    }
  };
}

/** Execute a Hades Layout action, ignoring the result. */
export function runLayout_<A>(box: BoundBox, act: HadesLayout<A>): HadesRender<void> {
  return (env) => {
    runLayout(box, act)(env);
  };
}

/**
 * Run two layouts in parallel and consume the space of the longest. Results are returned
 * unless there is no space for a layout.
 */
export function layoutParallel<A, B>(
  /** The Width of the left layout. */
  dx: number,
  /** The separation between the left and right layouts. */
  sep: number,
  a: HadesLayout<A>,
  b: HadesLayout<B>,
): HadesLayout<[Maybe<A>, Maybe<B>]> {
  return (env, st) => {
    const [outerBox, lineH] = st.state;
    switch (outerBox.tag) {
      case "NoBox":
        return [Nothing, Nothing];
      case "BoundBox": {
        const p0 = outerBox._0, p1 = outerBox._1;
        const leftBox = mkConstrainedBox(p0, movePoint(p0, [dx, boxHeight(outerBox)]));
        const rightBox = mkConstrainedBox(movePoint(p0, [dx + sep, 0]), p1);
        const [leftUsed, leftResult] = evalHadesLayout(layoutRegion(a), [leftBox, lineH])(env);
        const [rightUsed, rightResult] = evalHadesLayout(layoutRegion(b), [rightBox, lineH])(env);
        layoutConsume(hmax(boxHeight(leftUsed), boxHeight(rightUsed)))(env, st);
        return [leftResult, rightResult];
      }
      default:
        return absurd(outerBox);
    }
  };
}

/**
 * Create a Pango layout with a fixed resolution of 96dpi. This will override any OS font
 * scale settings to ensure that text is the same size relative to the other diagram elements.
 */
export function pangoCreateDiagramLayout(str: string): Cairo.Render<Pango.Layout> {
  return (cr) => {
    const ctx = Cairo.toRender(Pango.createContext)(cr);
    const layout = Pango.layoutNew(ctx);
    Pango.layoutSetText(layout, str, -1);
    return layout;
  };
}

/**
 * Perform the layout action and return the box that it consumed. If there is no space left
 * then the result will be @(NoBox, Nothing)@.
 */
export function layoutRegion<A>(act: HadesLayout<A>): HadesLayout<[BoundBox, Maybe<A>]> {
  return (env, st) => {
    const before = layoutBox(env, st);
    switch (before.tag) {
      case "NoBox":
        return [NoBox, Nothing];
      case "BoundBox": {
        const p1 = before._0, p2 = before._1;
        const r = act(env, st);
        const after = layoutBox(env, st);
        switch (after.tag) {
          case "NoBox":
            return [before, Just(r)]; // Run out of space within action.
          case "BoundBox":
            return [mkBoundBox(p1, Point(p2._pX, after._0._pY)), Just(r)];
          default:
            return absurd(after);
        }
      }
      default:
        return absurd(before);
    }
  };
}

/** Perform the layout action but ignore the result and return only the box that it consumed. */
export function layoutRegion_<A>(act: HadesLayout<A>): HadesLayout<BoundBox> {
  return (env, st) => layoutRegion(act)(env, st)[0];
}

/**
 * Remaining available space for a new element to be rendered. If all the space has been
 * consumed then it returns "NoBox".
 */
export const layoutBox: HadesLayout<BoundBox> = (_env, st) => st.state[0];

/** The height of a line. */
export const layoutLine: HadesLayout<number> = (_env, st) => st.state[1];

/** Moves the top of the layout down. */
export function layoutConsume(h: number): HadesLayout<void> {
  return (env, st) => {
    const box = layoutBox(env, st);
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const b = mkBox(movePoint(box._0, [0, h]), box._1); // Deliberately unsafe. See next line.
        assign(st, _1<BoundBox, number>(), boxHeight(b) <= 0 ? NoBox : b); // Only use b if it is valid.
        return;
      }
      default:
        return absurd(box);
    }
  };
}

/** Leave a gap as a paragraph break. */
export const layoutParagraphGap: HadesLayout<void> = (env, st) => {
  const lh = layoutLine(env, st);
  const gap = env.style.textGap;
  layoutConsume(lh * gap)(env, st);
};

/** Draw a thin horizontal line at the top of the current layout box. */
export const layoutHLine: HadesLayout<void> = (env, st) => {
  const box = layoutBox(env, st);
  switch (box.tag) {
    case "NoBox":
      return;
    case "BoundBox": {
      const p1 = box._0, p2 = box._1;
      layoutConsume(1)(env, st);
      // Cairo Render monad
      const cr = env.cr;
      Cairo.save(cr);
      Cairo.setLineWidth(cr, 1);
      Cairo.setSourceRGB(cr, 0, 0, 0); // Black line.
      Cairo.moveTo(cr, p1._pX, p1._pY);
      Cairo.lineTo(cr, p2._pX, p1._pY);
      Cairo.stroke(cr);
      Cairo.restore(cr);
      return;
    }
    default:
      return absurd(box);
  }
};

/** Draws a Pango text layout in the Hades layout box. */
export function layoutDrawPango(layout: Pango.Layout): HadesLayout<void> {
  return (env, st) => {
    const box = layoutBox(env, st);
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const p1 = box._0;
        const cr = env.cr;
        Cairo.moveTo(cr, p1._pX, p1._pY);
        Cairo.toRender((c) => Pango.showLayout(c, layout))(cr);
        const rect = Pango.layoutGetExtents(layout)[1];
        layoutConsume(pangoToHades(Pango.get(rect, "height")))(env, st);
        return;
      }
      default:
        return absurd(box);
    }
  };
}

/** Draws bold wrapped text in the layout box, possibly to the right of an image. */
export function layoutTitle(m: Maybe<Gdk.Pixbuf>, txt: string): HadesLayout<void> {
  const textPart: HadesLayout<void> = (env, st) => {
    const weight = Pango.attrWeightNew(Pango.WeightBold);
    const attrs = Pango.attrListNew();
    Pango.attrListInsert(attrs, weight);
    layoutText([
      (l) => () => Pango.layoutSetAttributes(l, attrs),
      (l) => () => Pango.layoutSetAlignment(l, Pango.AlignmentCenter),
    ], txt)(env, st);
  };
  return (env, st) => {
    switch (m.tag) {
      case "Nothing":
        textPart(env, st);
        return;
      case "Just": {
        const icon = m.value;
        const iconWidth = Gdk.pixbufGetWidth(icon);
        layoutParallel(iconWidth, 3, layoutPixbuf(false, Nothing, icon), textPart)(env, st);
        return;
      }
      default:
        return absurd(m);
    }
  };
}

/**
 * Draw the pixbuf at the top left hand of the box
 * and consume vertical space equal to its height.
 * If the pixbuf is bigger than the current box then it will be scaled down to fit.
 */
export function layoutPixbuf(
  /** If the picture is wider than the box then @True@ = scale, @False@ = clip. */
  scaleFlag: boolean,
  /** Background colour, if any. */
  bg: Maybe<Colour>,
  pic: Gdk.Pixbuf,
): HadesLayout<void> {
  return (env, st) => {
    const box = layoutBox(env, st);
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const { _pX: x0, _pY: y0 } = box._0;
        const availableWidth = boxWidth(layoutBox(env, st));
        const w = Gdk.pixbufGetWidth(pic);
        const h = Gdk.pixbufGetHeight(pic);
        const scale = scaleFlag ? Math.min(1, availableWidth / w) : 1;
        const scaledHeight = h * scale;
        layoutConsume(scaledHeight)(env, st);
        const cr = env.cr;
        Cairo.save(cr);
        Cairo.translate(cr, x0, y0);
        Cairo.scale(cr, scale, scale);
        if (bg.tag === "Just") {
          const { channelRed: r, channelGreen: g, channelBlue: b } = C.toSRGB(getColour(bg.value));
          Cairo.setSourceRGB(cr, r, g, b);
          Cairo.rectangle(cr, 0, 0, w, h);
          Cairo.fill(cr);
        }
        // Gdk.cairoSetSourcePixbuf ctx pic 0 0
        Cairo.toRender((ctx) => Cairo.setSourcePixbuf(ctx, pic, 0, 0))(cr);
        Cairo.rectangle(cr, 0, 0, w, h);
        Cairo.fill(cr);
        Cairo.restore(cr);
        return;
      }
      default:
        return absurd(box);
    }
  };
}

/**
 * Draw the SVG at the top left hand of the box and consume its height.
 * If the SVG is wider than the box then it will be scaled down to fit.
 *
 * The SVG handle must be fully loaded.
 */
export function layoutSvg(
  /** Background colour, if any. */
  bg: Maybe<Colour>,
  pic: SVG.Handle,
): HadesLayout<void> {
  const computeSize = (available: number, flag: boolean, v: SVG.Length): number => {
    if (!flag) return available;
    const l = SVG.getLengthLength(v);
    const unit = SVG.getLengthUnit(v);
    switch (unit) {
      case "UnitPercent": return l * available;
      case "UnitPx": return l;
      case "UnitEm": return l * hadesFontSize;
      case "UnitEx": return l * hadesFontSize * 0.48;
      // Assume an ex is 48% of an em. This is font dependent, but never mind.
      case "UnitIn": return l * hadesDPI;
      case "UnitCm": return l * hadesDPI / 2.54; // cm per inch.
      case "UnitMm": return l * hadesDPI / 25.4; // mm per inch.
      case "UnitPt": return l * hadesDPI / 70; // Points per inch.
      case "UnitPc": return l * hadesDPI / 6; // Picas per inch.
      default: return available; // SVG.AnotherUnit _
    }
  };
  return (env, st) => {
    const box = layoutBox(env, st);
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const { _pX: x0, _pY: y0 } = box._0;
        const availableWidth = boxWidth(layoutBox(env, st));
        SVG.handleSetDpi(pic, 90);
        const [widthFlag, width, heightFlag, height] = SVG.handleGetIntrinsicDimensions(pic);
        // If height not given then assume it is square.
        const w = computeSize(availableWidth, widthFlag, width);
        const h = computeSize(availableWidth, heightFlag, height);
        const scale = w > availableWidth ? availableWidth / w : 1;
        const scaledHeight = h * scale;
        const viewport = SVG.rectangleNew({ width: w, height: h });
        const cr = env.cr;
        Cairo.save(cr);
        Cairo.translate(cr, x0, y0);
        Cairo.scale(cr, scale, scale);
        if (bg.tag === "Just") {
          const { channelRed: r, channelGreen: g, channelBlue: b } = C.toSRGB(getColour(bg.value));
          Cairo.setSourceRGB(cr, r, g, b);
          Cairo.rectangle(cr, 0, 0, w, h);
          Cairo.fill(cr);
        }
        Cairo.toRender((ctx) => SVG.handleRenderDocument(pic, ctx, viewport))(cr);
        Cairo.restore(cr);
        layoutConsume(scaledHeight)(env, st);
        return;
      }
      default:
        return absurd(box);
    }
  };
}

/**
 * Draws a block of text in the layout box. By default the text is in the "HadesRender" font,
 * left aligned and wrapped to the width of the layout box.
 */
export function layoutText(
  /** List of layout modifiers to be applied to the text. */
  mods: readonly ((layout: Pango.Layout) => HadesLayout<void>)[],
  /** The text to be displayed. */
  txt: string,
): HadesLayout<void> {
  return (env, st) => {
    const box = layoutBox(env, st);
    const font = env.style.textFont;
    const layout = pangoCreateDiagramLayout(txt)(env.cr);
    Pango.layoutSetFontDescription(layout, font);
    Pango.layoutSetWidth(layout, hadesToPango(boxWidth(box)));
    Pango.layoutSetAlignment(layout, Pango.AlignmentLeft);
    for (const m of mods) m(layout)(env, st);
    layoutDrawPango(layout)(env, st);
  };
}

/**
 * Draws a block of text, separating paragraphs with a paragraph gap. Paragraphs in the text are
 * denoted by a blank line.
 */
export function layoutParagraphs(
  /** List of layout modifiers to be applied to the text. */
  mods: readonly ((layout: Pango.Layout) => HadesLayout<void>)[],
  /** The text to be displayed. */
  txt: string,
): HadesLayout<void> {
  return (env, st) => {
    const acts = L.intersperse(layoutParagraphGap, T.splitOn("\n\n", txt).map((t) => layoutText(mods, t)));
    for (const act of acts) act(env, st);
  };
}

/**
 * Draw the first text as a title (bold, centred) and the second as a sequence of paragraphs,
 * all within the BoundBox. Ellipsize as necessary.
 *
 * It's worth noting that @Data.Text.splitOn "\n\n"@ will conveniently split text into a
 * list of paragraphs.
 */
export function textBlock(
  /** Title text. Bold, centered, on a single line and ellipsized as necessary. */
  title: string,
  /** Paragraphs of body text. */
  descriptions: readonly string[],
  /** Box the text will fit into. */
  box: BoundBox,
): HadesRender<void> {
  return (env) => {
    if (box.tag === "NoBox") return;
    runLayout_(box, (env1, st) => {
      layoutTitle(Nothing, title)(env1, st);
      layoutParagraphGap(env1, st);
      for (const txt of descriptions) {
        layoutText([], txt)(env1, st);
        layoutParagraphGap(env1, st);
      }
    })(env);
  };
}

/** Draw a letter inside the bottom right hand corner of the BoundBox. */
export function drawCornerLetter(box: BoundBox, c: string): HadesRender<void> {
  return (env) => {
    switch (box.tag) {
      case "NoBox":
        return;
      case "BoundBox": {
        const { _pX: x, _pY: y } = box._1;
        const cr = env.cr;
        Cairo.save(cr);
        const font = Pango.fontDescriptionCopy(env.style.textFont) ?? error("Maybe.fromJust: Nothing");
        // fontDescriptionCopy result wrongly tagged as nullable.
        const layout = pangoCreateDiagramLayout(T.singleton(c))(cr);
        const fontSize = Pango.fontDescriptionGetSize(font);
        Pango.fontDescriptionSetSize(font, round(1.25 * (fontSize === 0 ? hadesFontSize : fontSize))); // A bit bigger.
        Pango.layoutSetFontDescription(layout, font);
        const attr = Pango.attrWeightNew(Pango.WeightBold);
        Pango.setAttributeEndIndex(attr, 2);
        const attrs = Pango.attrListNew();
        Pango.attrListInsert(attrs, attr);
        // (As in the Haskell, the attribute list is built but never set on the layout.)
        const rect = Pango.layoutGetExtents(layout)[0];
        const w = pangoToHades(Pango.getRectangleWidth(rect));
        const h = pangoToHades(Pango.getRectangleHeight(rect));
        env.style.textStyle(env);
        Cairo.moveTo(cr, x - w, y - h);
        const ctx = Cairo.getContext(cr);
        Pango.showLayout(ctx, layout);
        Cairo.restore(cr);
        return;
      }
      default:
        return absurd(box);
    }
  };
}
