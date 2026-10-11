import { describe, expect, it } from "vitest";
import * as Cairo from "@/lib/GI/Cairo";
import * as Pango from "@/lib/GI/Pango";
import * as Gdk from "@/lib/GI/Gdk";
import type * as Gtk from "@/lib/GI/Gtk";
import * as SVG from "@/lib/GI/Rsvg";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { CommentBox, Ellipse, LineShape } from "@/hades/src/Hades/Abstract/BasicShapes";
import { Unconnected } from "@/hades/src/Hades/Abstract/Connections";
import { DeltaCtx, type View } from "@/hades/src/Hades/Abstract/Delta";
import { type BoundBox, BoundBox as Box, NoBox, Point, boxHeight } from "@/hades/src/Hades/Abstract/Geometry";
import {
  type HadesEnv, type HadesLayout, ArrowDecoration, circleArrowHead, closedArrowHead, drawArrowDecoration,
  drawCommentBox, drawCornerLetter, drawEllipse, drawPolyLine, drawPolygon, evalHadesLayout, hadesConfig,
  hadesFontSize, hadesToPango, layoutBox, layoutConsume, layoutLine, layoutParagraphGap, layoutParagraphs,
  layoutParallel, layoutPixbuf, layoutRegion, layoutRegion_, layoutSvg, layoutText, multiArrowHead,
  noArrowHead, openArrowHead, pangoCreateDiagramLayout, pangoToHades, runHadesLayout, runLayout, squareHandle,
  stroke, textBlock, withLineColour,
} from "./BasicShapes";

const style = hadesConfig({} as Gtk.IconTheme);

/** Run a drawing action on an SVG recording surface and return the SVG document. */
function draw(act: (env: HadesEnv) => void): string {
  const s = new Cairo.SvgSurface(300, 300);
  act({ style, cr: s.context() });
  return s.document();
}

/** An environment drawing on a throw-away SVG surface. */
function env(): HadesEnv {
  return { style, cr: new Cairo.SvgSurface(300, 300).context() };
}

function layoutState(box: BoundBox, lineH = 10): { state: [BoundBox, number] } {
  return { state: [box, lineH] };
}

/** Line height of the diagram font, as `runLayout` computes it. */
const lineHeight = pangoToHades(Pango.fontMetricsGetHeight(Pango.contextGetMetrics(Pango.createContext(null), style.textFont, null)));

describe("units and style", () => {
  it("converts between HADES and Pango units", () => {
    expect(hadesToPango(1.5)).toBe(1536);
    expect(hadesToPango(2.5 / 1024)).toBe(2); // banker's rounding
    expect(pangoToHades(2048)).toBe(2);
  });
  it("uses the diagram font", () => {
    expect(Pango.fontDescriptionGetFamily(style.textFont)).toBe("Roboto,Symbola,STIX Two Text");
    expect(Pango.fontDescriptionGetSize(style.textFont)).toBe(hadesFontSize * Pango.SCALE);
    expect(style.textGap).toBe(0.5);
    // 9pt at 96 dpi is 12px; the fallback measurer gives Roboto's ascent + descent.
    expect(lineHeight).toBeCloseTo(12 * (0.928 + 0.244), 2);
  });
});

describe("HadesLayout", () => {
  const box = Box(Point(0, 0), Point(100, 50));
  it("consumes space from the top", () => {
    const st = layoutState(box);
    layoutConsume(20)(env(), st);
    expect(st.state[0]).toEqual(Box(Point(0, 20), Point(100, 50)));
    layoutConsume(30)(env(), st);
    expect(st.state[0]).toEqual(NoBox);
    layoutConsume(5)(env(), st);
    expect(st.state[0]).toEqual(NoBox);
  });
  it("reports the region used by an action", () => {
    const st = layoutState(box);
    const [used, r] = layoutRegion((e, s) => {
      layoutConsume(15)(e, s);
      return 42;
    })(env(), st);
    expect(used).toEqual(Box(Point(0, 0), Point(100, 15)));
    expect(r).toEqual(Just(42));
    // Running out of space returns the whole box.
    expect(layoutRegion(layoutConsume(100))(env(), layoutState(box))).toEqual([box, Just(undefined)]);
    expect(layoutRegion(layoutConsume(1))(env(), layoutState(NoBox))).toEqual([NoBox, Nothing]);
  });
  it("gives the line height and paragraph gaps", () => {
    const st = layoutState(box, 12);
    expect(layoutLine(env(), st)).toBe(12);
    layoutParagraphGap(env(), st);
    expect(layoutBox(env(), st)).toEqual(Box(Point(0, 6), Point(100, 50)));
  });
  it("runs two layouts side by side", () => {
    const seen: BoundBox[] = [];
    const left: HadesLayout<string> = (e, s) => {
      seen.push(s.state[0]);
      layoutConsume(10)(e, s);
      return "left";
    };
    const right: HadesLayout<string> = (e, s) => {
      seen.push(s.state[0]);
      layoutConsume(30)(e, s);
      return "right";
    };
    const st = layoutState(box);
    const r = layoutParallel(20, 5, left, right)(env(), st);
    expect(r).toEqual([Just("left"), Just("right")]);
    expect(seen).toEqual([Box(Point(0, 0), Point(20, 50)), Box(Point(25, 0), Point(100, 50))]);
    expect(st.state[0]).toEqual(Box(Point(0, 30), Point(100, 50)));
    expect(layoutParallel(20, 5, left, right)(env(), layoutState(NoBox))).toEqual([Nothing, Nothing]);
  });
  it("evaluates and runs layouts from a state", () => {
    const act: HadesLayout<number> = (e, s) => {
      layoutConsume(5)(e, s);
      return layoutLine(e, s);
    };
    expect(evalHadesLayout(act, [box, 7])(env())).toBe(7);
    expect(runHadesLayout(act, [box, 7])(env())).toEqual([7, [Box(Point(0, 5), Point(100, 50)), 7]]);
  });
  it("runLayout needs a box and supplies the font's line height", () => {
    expect(runLayout(NoBox, () => 1)(env())).toEqual(Nothing);
    expect(runLayout(box, (e, s) => [layoutBox(e, s), layoutLine(e, s)])(env())).toEqual(Just([box, lineHeight]));
  });
  it("wraps text to the box width", () => {
    // Fallback measurer: 'a' is 0.53 em, a space 0.25 em, at 12px. Two words fit in 60 units.
    const lines = (txt: string, w: number): number => {
      const used = layoutRegion_(layoutText([], txt))(env(), layoutState(Box(Point(0, 0), Point(w, 500))));
      return boxHeight(used) / lineHeight;
    };
    expect(lines("aaaa bbbb cccc", 60)).toBeCloseTo(2, 3);
    expect(lines("aaaa bbbb cccc", 200)).toBeCloseTo(1, 3);
    expect(lines("aaaa\nbbbb\ncccc", 200)).toBeCloseTo(3, 3);
  });
  it("separates paragraphs with a gap", () => {
    const st = layoutState(Box(Point(0, 0), Point(200, 500)), lineHeight);
    const used = layoutRegion_(layoutParagraphs([], "one\n\ntwo"))(env(), st);
    expect(boxHeight(used)).toBeCloseTo(2.5 * lineHeight, 3);
  });
  it("applies layout modifiers", () => {
    let seen: Pango.Layout | null = null;
    layoutText([(l) => () => { seen = l; }], "text")(env(), layoutState(box));
    expect(seen).not.toBeNull();
    expect(Pango.layoutGetText(seen!)).toBe("text");
    expect(Pango.layoutGetWidth(seen!)).toBe(100 * Pango.SCALE);
  });
  it("scales pixbufs to fit when asked", () => {
    const pb = new Gdk.Pixbuf("data:,", 40, 20);
    const st1 = layoutState(Box(Point(0, 0), Point(20, 100)));
    layoutPixbuf(true, Nothing, pb)(env(), st1);
    expect(st1.state[0]).toEqual(Box(Point(0, 10), Point(20, 100)));
    const st2 = layoutState(Box(Point(0, 0), Point(20, 100)));
    layoutPixbuf(false, Just(C.white), pb)(env(), st2);
    expect(st2.state[0]).toEqual(Box(Point(0, 20), Point(20, 100)));
  });
  it("sizes SVG images from their intrinsic dimensions", () => {
    const svg = SVG.handleNewFromData('<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm"/>');
    const st = layoutState(Box(Point(0, 0), Point(50, 100)));
    layoutSvg(Nothing, svg)(env(), st);
    // 20mm x 10mm at 90 dpi is wider than the box, so it is scaled to the box width.
    expect(boxHeight(layoutBox(env(), st))).toBeCloseTo(75, 6);
    const pct = SVG.handleNewFromData('<svg xmlns="http://www.w3.org/2000/svg" width="100%"/>');
    const st2 = layoutState(Box(Point(0, 0), Point(50, 100)));
    layoutSvg(Nothing, pct)(env(), st2);
    // No height: the height is the available width.
    expect(boxHeight(layoutBox(env(), st2))).toBeCloseTo(50, 6);
  });
});

describe("arrow heads", () => {
  it("compute their sizes", () => {
    const closed = closedArrowHead(90, 10, true);
    expect(closed.arrowHeadLength).toBe(10);
    expect(closed.arrowHeadWidth).toBeCloseTo(20, 9);
    const open = openArrowHead(90, 10);
    expect(open.arrowHeadLength).toBe(0);
    expect(open.arrowHeadWidth).toBeCloseTo(20, 9);
    const multi = multiArrowHead(0.8, [closedArrowHead(30, 10, true), circleArrowHead(6, false)]);
    expect(multi.arrowHeadLength).toBeCloseTo(14.8, 9);
    expect(multi.arrowHeadWidth).toBe(6);
    expect(multiArrowHead(1, [])).toBe(noArrowHead);
  });
});

describe("drawing", () => {
  it("fills and strokes polygons in the box style", () => {
    const svg = draw(drawPolygon([Point(0, 0), Point(10, 0), Point(10, 10)]));
    expect(svg).toContain('<path d="M0 0 L10 0 L10 10 Z" fill="rgb(206, 198, 190)"/>');
    expect(svg).toMatch(/<path d="M0 0 L10 0 L10 10 Z" fill="none" stroke="rgb\(0, 0, 0\)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/);
    expect(draw(drawPolygon([Point(0, 0)]))).not.toContain("<path");
  });
  it("draws ellipses only for real boxes", () => {
    expect(draw(drawEllipse(Ellipse(NoBox)))).not.toContain("<path");
    const svg = draw(drawEllipse(Ellipse(Box(Point(0, 0), Point(40, 20)))));
    expect(svg).toMatch(/<path d="M40 10 L40 10 C40 15.523 31.046 20 20 20 C[^"]*" fill="rgb\(206, 198, 190\)"/);
  });
  it("draws comment boxes in blue with a fold", () => {
    const svg = draw(drawCommentBox(CommentBox(Box(Point(20, 20), Point(60, 40)))));
    expect(svg).toContain('fill="rgb(183, 187, 210)"');
    // The fold: from the first fold point across and down.
    expect(svg).toContain('<path d="M10 20 L20 20 L20 10" fill="none"');
  });
  it("changes line colours locally", () => {
    const red = C.sRGB24(255, 0, 0);
    const svg = draw((e) => {
      withLineColour(red, (e1) => {
        Cairo.moveTo(e1.cr, 0, 0);
        Cairo.lineTo(e1.cr, 10, 0);
        stroke(e1);
      })(e);
      Cairo.moveTo(e.cr, 0, 5);
      Cairo.lineTo(e.cr, 10, 5);
      stroke(e);
    });
    expect(svg).toContain('<path d="M0 0 L10 0" fill="none" stroke="rgb(255, 0, 0)"');
    expect(svg).toContain('<path d="M0 5 L10 5" fill="none" stroke="rgb(0, 0, 0)"');
  });
  it("stops the line at the back of the arrow head", () => {
    const svg = draw(drawPolyLine(closedArrowHead(90, 10, true), [], Point(0, 0), [], Point(100, 0), Nothing));
    expect(svg).toContain('<path d="M0 0 L90 0" fill="none"');
    // Head: tip at the end point, base 10 back.
    expect(svg).toMatch(/<path d="[^"]*M100 0 L90 -10 L90 10 Z" fill="rgb\(0, 0, 0\)"\/>/);
  });
  it("puts the label half way along the line", () => {
    // Lengths 30 and 40: half way (35) is 5 units along the second segment.
    const label = "Label";
    const svg = draw(drawPolyLine(noArrowHead, [5, 5], Point(0, 0), [Point(0, 30)], Point(40, 30), Just(label)));
    const l = pangoCreateDiagramLayout(label)(null as unknown as Cairo.Context);
    Pango.layoutSetFontDescription(l, style.textFont);
    const [ink] = Pango.layoutGetExtents(l);
    const line0 = l.lines()[0];
    const x0 = 5 - pangoToHades(ink.x) - pangoToHades(ink.width) / 2 + line0.x;
    const y0 = 30 - pangoToHades(ink.y) - pangoToHades(ink.height) / 2 + line0.ascent;
    const m = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>Label<\/text>/.exec(svg);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeCloseTo(x0, 2);
    expect(parseFloat(m![2])).toBeCloseTo(y0, 2);
    expect(svg).toContain('stroke-dasharray="5,5"');
  });
  it("places off-line arrow decorations beside the line", () => {
    const shape = LineShape([Unconnected(Point(0, 0)), Unconnected(Point(100, 100))], []);
    const deco = ArrowDecoration(0.5, () => {}, Just([[20, 10], (e: HadesEnv) => {
      Cairo.rectangle(e.cr, 0, 0, 20, 10);
      Cairo.fill(e.cr);
    }] as const));
    const svg = draw(drawArrowDecoration(shape, deco));
    // Down-right line: the box touches the line at its top right corner.
    expect(svg).toContain('M32.5 52.5 L52.5 52.5 L52.5 62.5 L32.5 62.5 Z"');
    const up = LineShape([Unconnected(Point(0, 100)), Unconnected(Point(100, 0))], []);
    // Up-right line: the box touches the line at its top left corner.
    expect(draw(drawArrowDecoration(up, deco))).toContain('M47.5 52.5 L67.5 52.5 L67.5 62.5 L47.5 62.5 Z"');
  });
  it("clips text blocks to their box", () => {
    const svg = draw(textBlock("Title", ["Some body text"], Box(Point(10, 10), Point(110, 60))));
    expect(svg).toContain('<clipPath id="clip1"><path d="M10 10 L110 10 L110 60 L10 60 Z"/></clipPath>');
    expect(svg).toMatch(/font-weight="700"[^>]*>Title<\/text>/);
    expect(svg).toMatch(/font-weight="400"[^>]*>Some body text<\/text>/);
    expect(draw(textBlock("T", [], NoBox))).not.toContain("<text");
  });
  it("draws corner letters a bit bigger than the text", () => {
    const svg = draw(drawCornerLetter(Box(Point(0, 0), Point(100, 50)), "A"));
    // 1.25 * 9pt = 11.25pt = 15px.
    expect(svg).toMatch(/font-size="15"[^>]*>A<\/text>/);
  });
});

describe("squareHandle", () => {
  it("does not scale with the diagram", () => {
    const d = new DeltaCtx<unknown>({} as never, { state: { _deltaZoom: 2 } as never });
    const g = squareHandle(d, Menu([]), Point(10, 10), function* () {
      return null as never;
    });
    const r = g.next();
    expect(r.done).toBe(true);
    const v = r.value as View<unknown>;
    expect(v.viewBox).toEqual(Box(Point(7.5, 7.5), Point(12.5, 12.5)));
    expect(v.viewTouched(Point(12, 8))).toBe(true);
    expect(v.viewTouched(Point(13, 8))).toBe(false);
    expect(draw(v.viewDraw)).toContain('<path d="M7.5 7.5 L12.5 7.5 L12.5 12.5 L7.5 12.5 Z" fill="rgb(0, 0, 0)"/>');
  });
});
