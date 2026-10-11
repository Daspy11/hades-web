/**
 * Scratch demo for `Hades.GI.BasicShapes` (open the app with `?demo=h1`): draws the basic
 * shapes, text layouts, arrow heads and decorations on a drawing area, much as the GSN and
 * causality diagrams use them. `&zoom=2` draws at twice the size.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Cairo from "@/lib/GI/Cairo";
import * as Pango from "@/lib/GI/Pango";
import * as SVG from "@/lib/GI/Rsvg";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  BoxShapeClass_Diamond, BoxShapeClass_Ellipse, BoxShapeClass_Oval, BoxShapeClass_Parallelogram,
  CommentBox, Diamond, Ellipse, LineShape, Oval, Parallelogram, Rectangle, diamondCorners,
  parallelogramCorners, rectangleCorners,
} from "@/hades/src/Hades/Abstract/BasicShapes";
import { Unconnected } from "@/hades/src/Hades/Abstract/Connections";
import { DeltaCtx, type View } from "@/hades/src/Hades/Abstract/Delta";
import { type BoundBox, BoundBox as Box, Point } from "@/hades/src/Hades/Abstract/Geometry";
import {
  type HadesLayout, type HadesRender, ArrowDecoration, basicBox, circleArrowHead, closedArrowHead,
  drawArrowDecoration, drawCommentBox, drawCornerLetter, drawEllipse, drawOval, drawPolyLine, drawPolygon,
  hadesConfig, layoutHLine, layoutParagraphGap, layoutParagraphs, layoutParallel, layoutPixbuf, layoutSvg,
  layoutText, layoutTitle, local, multiArrowHead, noArrowHead, openArrowHead, renderWithHades, runLayout_,
  squareHandle, textBlock, withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";

const box = (x1: number, y1: number, x2: number, y2: number): BoundBox => Box(Point(x1, y1), Point(x2, y2));

/** A GSN-like box: outline, then a bold title and body paragraphs in the inner box. */
function gsnBox(outline: HadesRender, inner: BoundBox, title: string, body: string): HadesRender {
  return (env) => {
    outline(env);
    runLayout_(inner, (e, st) => {
      layoutTitle(Nothing, title)(e, st);
      layoutParagraphGap(e, st);
      layoutParagraphs([], body)(e, st);
    })(env);
  };
}

/** A label drawn as an off-line arrow decoration. */
function labelDeco(txt: string, pos: number): ArrowDecoration {
  const w = 44, h = 14;
  return ArrowDecoration(pos, ({ cr }) => {
    Cairo.arc(cr, 0, 0, 3, 0, 2 * Math.PI);
    Cairo.setSourceRGB(cr, 0.8, 0, 0);
    Cairo.fill(cr);
  }, Just([[w, h], (env) => {
    const cr = env.cr;
    Cairo.setSourceRGB(cr, 1, 1, 0.8);
    Cairo.rectangle(cr, 0, 0, w, h);
    Cairo.fill(cr);
    runLayout_(box(0, 0, w, h), layoutText([(l) => () => Pango.layoutSetAlignment(l, Pango.AlignmentCenter)], txt))(env);
  }] as const));
}

export function main(): void {
  const zoom = Number(new URLSearchParams(location.search).get("zoom") ?? "1");
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Hades.GI.BasicShapes demo");
  const da = Gtk.drawingAreaNew();
  Gtk.styleContextAddClass(da, "hades-diagram");
  Gtk.styleContextAddClass(da, "active-diagram");
  Gtk.containerAdd(win, da);
  const theme = Gtk.iconThemeGetDefault();
  const style = hadesConfig(theme);
  const icon = (() => {
    const info = Gtk.iconThemeLookupIcon(theme, "dialog-warning", 16, []);
    return info ? Gtk.iconInfoLoadIcon(info) : null;
  })();
  const svg = SVG.handleNewFromData(
    '<svg xmlns="http://www.w3.org/2000/svg" width="60px" height="30px" viewBox="0 0 60 30">' +
    '<rect x="2" y="2" width="56" height="26" rx="6" fill="#4a90d9"/><circle cx="15" cy="15" r="8" fill="#fff"/>' +
    '<path d="M30 22 L42 8 L54 22 Z" fill="#f5c211"/></svg>');
  const fakeDelta = new DeltaCtx<unknown>({} as never, { state: { _deltaZoom: zoom } as never });
  const handle = (p: Point): View<unknown> => {
    const r = squareHandle(fakeDelta, Menu([]), p, function* () {
      return null as never;
    }).next();
    return r.value as View<unknown>;
  };
  const body = "The system is acceptably safe to operate in its intended environment.\n\nSecond paragraph after a blank line.";

  const picture: HadesRender = (env) => {
    // Row 1: GSN-style boxes.
    const goal = box(20, 20, 180, 110);
    gsnBox(drawPolygon(rectangleCorners(Rectangle(goal))), goal, "G1: Goal", body)(env);
    for (const p of [Point(20, 20), Point(180, 20), Point(20, 110), Point(180, 110), Point(100, 20)]) handle(p).viewDraw(env);

    const strat = Parallelogram(box(240, 20, 380, 90));
    gsnBox(drawPolygon(parallelogramCorners(strat)), BoxShapeClass_Parallelogram.shapeInnerBox(strat), "S1: Strategy", "Argument over each hazard")(env);

    const sol = Ellipse(box(440, 15, 560, 105));
    gsnBox(drawEllipse(sol), BoxShapeClass_Ellipse.shapeInnerBox(sol), "Sn1", "Test results")(env);

    const ctx = Oval(box(620, 30, 740, 80));
    gsnBox(drawOval(ctx), BoxShapeClass_Oval.shapeInnerBox(ctx), "C1: Context", "Operating environment definition")(env);

    const opt = Diamond(box(790, 15, 890, 105));
    gsnBox(drawPolygon(diamondCorners(box(790, 15, 890, 105))), BoxShapeClass_Diamond.shapeInnerBox(opt), "Option", "")(env);

    // Row 2: assumption with a corner letter, comment box, coloured border, text block.
    const asm = box(20, 150, 160, 230);
    drawEllipse(Ellipse(asm))(env);
    drawCornerLetter(asm, "A")(env);
    runLayout_(BoxShapeClass_Ellipse.shapeInnerBox(Ellipse(asm)), layoutTitle(Nothing, "A1: Assumption"))(env);

    const note = CommentBox(box(210, 160, 360, 230));
    drawCommentBox(note)(env);
    runLayout_(box(210, 160, 360, 230), layoutParagraphs([], "A comment box with a folded corner.\n\nIt wraps its text to the box width and clips the rest of it away when there is far too much to fit"))(env);

    const red = box(410, 150, 560, 230);
    withLineColour(C.sRGB24(220, 30, 30), drawPolygon(rectangleCorners(Rectangle(red))))(env);
    textBlock("Red border", ["withLineColour changes the border.", "Second description paragraph."], red)(env);

    const [border, fill] = basicBox(1, C.sRGB24(0, 100, 0), C.sRGB24(200, 240, 200));
    const green = box(610, 150, 890, 260);
    local((s) => ({ ...s, boxBorderStyle: border, boxFillStyle: fill }), drawPolygon(rectangleCorners(Rectangle(green))))(env);
    const contents: HadesLayout = (e, st) => {
      if (icon) layoutTitle(Just(icon), "Title beside an icon")(e, st);
      layoutHLine(e, st);
      layoutParallel(40, 4, layoutText([], "Left column"), layoutParagraphs([], "Right column with longer text that wraps onto more lines"))(e, st);
      layoutHLine(e, st);
      layoutParallel(64, 6, layoutSvg(Just(C.white), svg), layoutText([], "An SVG image on the left"))(e, st);
      if (icon) layoutPixbuf(false, Nothing, icon)(e, st);
    };
    runLayout_(box(614, 154, 886, 256), contents)(env);

    // Row 3: arrows.
    const heads: [string, typeof noArrowHead][] = [
      ["none", noArrowHead],
      ["closed solid", closedArrowHead(30, 12, true)],
      ["closed hollow", closedArrowHead(60, 12, false)],
      ["open", openArrowHead(60, 12)],
      ["circle", circleArrowHead(8, false)],
      ["multi ->>", multiArrowHead(0.8, [closedArrowHead(45, 10, true), closedArrowHead(45, 10, true)])],
      ["multi ->o", multiArrowHead(1, [closedArrowHead(45, 10, false), circleArrowHead(8, false)])],
    ];
    heads.forEach(([name, h], i) => {
      const y = 300 + i * 34;
      drawPolyLine(h, i % 3 === 2 ? [6, 4] : [], Point(30, y), [], Point(230, y), Just(name))(env);
    });
    drawPolyLine(closedArrowHead(30, 12, true), [], Point(300, 300), [Point(300, 420), Point(450, 420)], Point(450, 330), Just("bent line label"))(env);
    drawPolyLine(openArrowHead(60, 12), [], Point(520, 300), [], Point(520, 300), Nothing)(env); // zero length

    // Decorations on lines in each direction.
    const lines: [Point, Point][] = [
      [Point(560, 300), Point(700, 400)], // down right
      [Point(560, 520), Point(700, 420)], // up right
      [Point(880, 300), Point(740, 400)], // down left
      [Point(880, 520), Point(740, 420)], // up left
    ];
    for (const [p1, p2] of lines) {
      const shape = LineShape([Unconnected(p1), Unconnected(p2)], []);
      drawPolyLine(closedArrowHead(30, 10, true), [], p1, [], p2, Nothing)(env);
      drawArrowDecoration(shape, labelDeco("label", 0.5))(env);
    }
  };

  Gtk.onWidgetDraw(da, (cr: Cairo.Context) => {
    Gtk.renderBackground(da, cr, 0, 0, 4000, 4000);
    Cairo.scale(cr, zoom, zoom);
    renderWithHades(cr, style, picture);
    return true;
  });
  Gdk.onImagesLoaded(() => Gtk.widgetQueueDraw(da));
  Gtk.windowPresent(win);
  Gtk.main();
}
