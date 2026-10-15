/**
 * Browser replacement for `GI.Cairo.Render` (the Cairo drawing API).
 *
 * A Cairo `Context` draws on a *drawing target* with the shape of `CanvasRenderingContext2D`.
 * Three targets exist:
 *
 *  - an HTML canvas (on-screen diagrams, PNG export);
 *  - `SvgTarget`, which records SVG (SVG export, and diagrams embedded in reports);
 *  - `PsTarget`, which records PostScript (PS and EPS export).
 *
 * Cairo and the canvas API share their path and transformation semantics: path coordinates are
 * transformed when they are added, while line widths are interpreted in the transformation in
 * effect when the path is stroked. Cairo's `stroke`/`fill`/`clip` consume the path; the
 * `...Preserve` variants keep it.
 *
 * The `Render` monad becomes ordinary functions taking the context first:
 * `Cairo.moveTo x y` → `Cairo.moveTo(cr, x, y)`. A `Render a` value is a `Render<A>` function.
 */
import type { Pixbuf } from "./Gdk";

/** The subset of `CanvasRenderingContext2D` used by Cairo contexts. */
export interface DrawTarget {
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  getTransform(): DOMMatrix | { a: number; b: number; c: number; d: number; e: number; f: number };
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(a: number): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a1: number, a2: number, ccw?: boolean): void;
  rect(x: number, y: number, w: number, h: number): void;
  closePath(): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
  clip(rule?: CanvasFillRule): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  setLineDash(d: number[]): void;
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetrics;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineDashOffset: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  globalAlpha: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
}

export type LineCap = "LineCapButt" | "LineCapRound" | "LineCapSquare";
export const LineCapButt: LineCap = "LineCapButt";
export const LineCapRound: LineCap = "LineCapRound";
export const LineCapSquare: LineCap = "LineCapSquare";
export type LineJoin = "LineJoinMiter" | "LineJoinRound" | "LineJoinBevel";
export const LineJoinMiter: LineJoin = "LineJoinMiter";
export const LineJoinRound: LineJoin = "LineJoinRound";
export const LineJoinBevel: LineJoin = "LineJoinBevel";
export type FillRule = "FillRuleWinding" | "FillRuleEvenOdd";
export const FillRuleWinding: FillRule = "FillRuleWinding";
export const FillRuleEvenOdd: FillRule = "FillRuleEvenOdd";
export type Format = "FormatARGB32" | "FormatRGB24" | "FormatA8";
export const FormatARGB32: Format = "FormatARGB32";
export const FormatRGB24: Format = "FormatRGB24";

export interface Matrix {
  readonly xx: number;
  readonly yx: number;
  readonly xy: number;
  readonly yy: number;
  readonly x0: number;
  readonly y0: number;
}

interface GState {
  fillRule: FillRule;
  source: string;
  alpha: number;
  pattern: { pixbuf: Pixbuf; x: number; y: number } | null;
}

/** A Cairo drawing context. */
export class Context {
  private gs: GState = { fillRule: "FillRuleWinding", source: "rgb(0,0,0)", alpha: 1, pattern: null };
  private stack: GState[] = [];
  /** Current point in device coordinates. */
  private cur: [number, number] | null = null;
  private subStart: [number, number] | null = null;
  /** Number of `save` calls not yet restored, for safety when contexts are reused. */
  private depth = 0;

  constructor(
    readonly target: DrawTarget,
    /** Transformation from user space to target pixels when the user calls `identityMatrix`. */
    readonly base: { a: number; b: number; c: number; d: number; e: number; f: number } = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    /** The surface being drawn on, if any. */
    readonly surface: Surface | null = null,
  ) {
    target.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
    target.fillStyle = this.gs.source;
    target.strokeStyle = this.gs.source;
    target.lineWidth = 2;
    target.lineCap = "butt";
    target.lineJoin = "miter";
    target.miterLimit = 10;
    target.beginPath();
  }

  /** Current transformation matrix (user → target). */
  ctm(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const m = this.target.getTransform();
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
  }
  toDevice(x: number, y: number): [number, number] {
    const m = this.ctm();
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  }
  toUser(dx: number, dy: number): [number, number] {
    const m = this.ctm();
    const det = m.a * m.d - m.b * m.c;
    if (det === 0) return [0, 0];
    const x = dx - m.e, y = dy - m.f;
    return [(m.d * x - m.c * y) / det, (-m.b * x + m.a * y) / det];
  }

  // State ----------------------------------------------------------------------------------
  save(): void {
    this.stack.push({ ...this.gs });
    this.depth++;
    this.target.save();
  }
  restore(): void {
    if (this.depth === 0) return;
    this.depth--;
    this.gs = this.stack.pop()!;
    this.target.restore();
  }
  setSource(css: string, alpha: number): void {
    this.gs = { ...this.gs, source: css, alpha, pattern: null };
    this.target.fillStyle = css;
    this.target.strokeStyle = css;
  }
  setPattern(p: { pixbuf: Pixbuf; x: number; y: number }): void {
    this.gs = { ...this.gs, pattern: p };
  }
  get fillRule(): FillRule {
    return this.gs.fillRule;
  }
  set fillRule(r: FillRule) {
    this.gs = { ...this.gs, fillRule: r };
  }
  get pattern(): { pixbuf: Pixbuf; x: number; y: number } | null {
    return this.gs.pattern;
  }

  // Path tracking --------------------------------------------------------------------------
  movedTo(x: number, y: number): void {
    this.cur = this.toDevice(x, y);
    this.subStart = this.cur;
  }
  linedTo(x: number, y: number): void {
    this.cur = this.toDevice(x, y);
    if (!this.subStart) this.subStart = this.cur;
  }
  closed(): void {
    this.cur = this.subStart;
  }
  cleared(): void {
    this.cur = null;
    this.subStart = null;
  }
  currentPoint(): [number, number] | null {
    return this.cur ? this.toUser(this.cur[0], this.cur[1]) : null;
  }
  hasCurrentPoint(): boolean {
    return this.cur !== null;
  }
}

/** A drawing action in the Render monad. */
export type Render<A = void> = (cr: Context) => A;

function rule(cr: Context): CanvasFillRule {
  return cr.fillRule === "FillRuleEvenOdd" ? "evenodd" : "nonzero";
}

// ---------------------------------------------------------------------------------------------
// Paths

export function newPath(cr: Context): void {
  cr.target.beginPath();
  cr.cleared();
}
export function newSubPath(cr: Context): void {
  cr.cleared();
}
export function moveTo(cr: Context, x: number, y: number): void {
  cr.target.moveTo(x, y);
  cr.movedTo(x, y);
}
export function lineTo(cr: Context, x: number, y: number): void {
  if (!cr.hasCurrentPoint()) return moveTo(cr, x, y);
  cr.target.lineTo(x, y);
  cr.linedTo(x, y);
}
export function curveTo(cr: Context, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  if (!cr.hasCurrentPoint()) moveTo(cr, x1, y1);
  cr.target.bezierCurveTo(x1, y1, x2, y2, x3, y3);
  cr.linedTo(x3, y3);
}
export function relMoveTo(cr: Context, dx: number, dy: number): void {
  const p = cr.currentPoint() ?? [0, 0];
  moveTo(cr, p[0] + dx, p[1] + dy);
}
export function relLineTo(cr: Context, dx: number, dy: number): void {
  const p = cr.currentPoint() ?? [0, 0];
  lineTo(cr, p[0] + dx, p[1] + dy);
}
export function relCurveTo(cr: Context, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  const p = cr.currentPoint() ?? [0, 0];
  curveTo(cr, p[0] + x1, p[1] + y1, p[0] + x2, p[1] + y2, p[0] + x3, p[1] + y3);
}
export function rectangle(cr: Context, x: number, y: number, w: number, h: number): void {
  cr.target.rect(x, y, w, h);
  cr.movedTo(x, y);
}
export function arc(cr: Context, xc: number, yc: number, r: number, a1: number, a2: number): void {
  cr.target.arc(xc, yc, Math.abs(r), a1, a2, false);
  cr.linedTo(xc + r * Math.cos(a2), yc + r * Math.sin(a2));
}
export function arcNegative(cr: Context, xc: number, yc: number, r: number, a1: number, a2: number): void {
  cr.target.arc(xc, yc, Math.abs(r), a1, a2, true);
  cr.linedTo(xc + r * Math.cos(a2), yc + r * Math.sin(a2));
}
export function closePath(cr: Context): void {
  cr.target.closePath();
  cr.closed();
}
/** Returns (x, y) of the current point in user space ((0,0) if there is none). */
export function getCurrentPoint(cr: Context): [number, number] {
  return cr.currentPoint() ?? [0, 0];
}
export function hasCurrentPoint(cr: Context): boolean {
  return cr.hasCurrentPoint();
}

// ---------------------------------------------------------------------------------------------
// Drawing

function paintPattern(cr: Context, clipToPath: boolean): void {
  const p = cr.pattern;
  if (!p) return;
  const img = p.pixbuf.image;
  if (!img || !p.pixbuf.loaded) return;
  const t = cr.target;
  t.save();
  if (clipToPath) t.clip(rule(cr));
  t.drawImage(img, p.x, p.y, p.pixbuf.width, p.pixbuf.height);
  t.restore();
}

export function stroke(cr: Context): void {
  cr.target.stroke();
  newPath(cr);
}
export function strokePreserve(cr: Context): void {
  cr.target.stroke();
}
export function fill(cr: Context): void {
  if (cr.pattern) paintPattern(cr, true);
  else cr.target.fill(rule(cr));
  newPath(cr);
}
export function fillPreserve(cr: Context): void {
  if (cr.pattern) paintPattern(cr, true);
  else cr.target.fill(rule(cr));
}
export function clip(cr: Context): void {
  cr.target.clip(rule(cr));
  newPath(cr);
}
export function clipPreserve(cr: Context): void {
  cr.target.clip(rule(cr));
}
export function resetClip(cr: Context): void {
  // Canvas has no reset; restore to the state before any clip is the caller's job.
  void cr;
}
/** Paint the current source everywhere within the clip region. */
export function paint(cr: Context): void {
  if (cr.pattern) {
    paintPattern(cr, false);
    return;
  }
  const t = cr.target;
  t.save();
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.fillRect(-1e5, -1e5, 2e5, 2e5);
  t.restore();
}
export function paintWithAlpha(cr: Context, a: number): void {
  const t = cr.target;
  const old = t.globalAlpha;
  t.globalAlpha = old * a;
  paint(cr);
  t.globalAlpha = old;
}
export function showPage(cr: Context): void {
  cr.surface?.showPage();
}

// ---------------------------------------------------------------------------------------------
// Source and stroke parameters

function css255(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}
export function setSourceRGB(cr: Context, r: number, g: number, b: number): void {
  cr.setSource(`rgb(${css255(r)}, ${css255(g)}, ${css255(b)})`, 1);
}
export function setSourceRGBA(cr: Context, r: number, g: number, b: number, a: number): void {
  cr.setSource(`rgba(${css255(r)}, ${css255(g)}, ${css255(b)}, ${Math.max(0, Math.min(1, a))})`, a);
}
/** Not part of Cairo: set the source from a CSS colour string. */
export function setSourceCss(cr: Context, css: string): void {
  cr.setSource(css, 1);
}
/** `Gdk.cairoSetSourcePixbuf cr pixbuf x y`: subsequent `paint`/`fill` draw the image. */
export function setSourcePixbuf(cr: Context, pb: Pixbuf, x: number, y: number): void {
  cr.setPattern({ pixbuf: pb, x, y });
}
export function setLineWidth(cr: Context, w: number): void {
  cr.target.lineWidth = w;
}
export function getLineWidth(cr: Context): number {
  return cr.target.lineWidth;
}
export function setDash(cr: Context, dashes: readonly number[], offset: number): void {
  cr.target.setLineDash([...dashes]);
  cr.target.lineDashOffset = offset;
}
export function setLineCap(cr: Context, c: LineCap): void {
  cr.target.lineCap = c === "LineCapRound" ? "round" : c === "LineCapSquare" ? "square" : "butt";
}
export function setLineJoin(cr: Context, j: LineJoin): void {
  cr.target.lineJoin = j === "LineJoinRound" ? "round" : j === "LineJoinBevel" ? "bevel" : "miter";
}
export function setMiterLimit(cr: Context, m: number): void {
  cr.target.miterLimit = m;
}
export function setFillRule(cr: Context, r: FillRule): void {
  cr.fillRule = r;
}

// ---------------------------------------------------------------------------------------------
// Transformations

export function save(cr: Context): void {
  cr.save();
}
export function restore(cr: Context): void {
  cr.restore();
}
export function translate(cr: Context, x: number, y: number): void {
  cr.target.translate(x, y);
}
export function scale(cr: Context, x: number, y: number): void {
  cr.target.scale(x, y);
}
export function rotate(cr: Context, a: number): void {
  cr.target.rotate(a);
}
export function identityMatrix(cr: Context): void {
  const b = cr.base;
  cr.target.setTransform(b.a, b.b, b.c, b.d, b.e, b.f);
}
export function getMatrix(cr: Context): Matrix {
  const m = cr.ctm();
  const b = cr.base;
  // Express relative to the base transform, as Cairo's user-visible matrix.
  const det = b.a * b.d - b.b * b.c || 1;
  const ia = b.d / det, ib = -b.b / det, ic = -b.c / det, id = b.a / det;
  const ie = -(ia * b.e + ic * b.f), iff = -(ib * b.e + id * b.f);
  return {
    xx: ia * m.a + ic * m.b, yx: ib * m.a + id * m.b,
    xy: ia * m.c + ic * m.d, yy: ib * m.c + id * m.d,
    x0: ia * m.e + ic * m.f + ie, y0: ib * m.e + id * m.f + iff,
  };
}
export function setMatrix(cr: Context, m: Matrix): void {
  identityMatrix(cr);
  cr.target.transform(m.xx, m.yx, m.xy, m.yy, m.x0, m.y0);
}
export function transform(cr: Context, m: Matrix): void {
  cr.target.transform(m.xx, m.yx, m.xy, m.yy, m.x0, m.y0);
}
export function userToDevice(cr: Context, x: number, y: number): [number, number] {
  return cr.toDevice(x, y);
}
export function deviceToUser(cr: Context, x: number, y: number): [number, number] {
  return cr.toUser(x, y);
}
export function userToDeviceDistance(cr: Context, dx: number, dy: number): [number, number] {
  const m = cr.ctm();
  return [m.a * dx + m.c * dy, m.b * dx + m.d * dy];
}

// ---------------------------------------------------------------------------------------------
// Toy text API (used rarely; Pango is the main text API)

export function selectFontFace(cr: Context, family: string, slant: "FontSlantNormal" | "FontSlantItalic", weight: "FontWeightNormal" | "FontWeightBold"): void {
  const size = /([\d.]+)px/.exec(cr.target.font)?.[1] ?? "10";
  cr.target.font = `${slant === "FontSlantItalic" ? "italic " : ""}${weight === "FontWeightBold" ? "bold " : ""}${size}px ${family}`;
}
export function setFontSize(cr: Context, s: number): void {
  cr.target.font = cr.target.font.replace(/[\d.]+px/, `${s}px`);
}
export function showText(cr: Context, t: string): void {
  const p = getCurrentPoint(cr);
  cr.target.textBaseline = "alphabetic";
  cr.target.fillText(t, p[0], p[1]);
  const w = cr.target.measureText(t).width;
  moveTo(cr, p[0] + w, p[1]);
}

// ---------------------------------------------------------------------------------------------
// Surfaces

export abstract class Surface {
  abstract readonly width: number;
  abstract readonly height: number;
  /** Create a context drawing on this surface. */
  abstract context(): Context;
  showPage(): void {}
  finish(): void {}
}

/** An in-memory image (a canvas). */
export class ImageSurface extends Surface {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  constructor(readonly format: Format, readonly width: number, readonly height: number) {
    super();
    const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height));
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      this.canvas = c;
    } else {
      this.canvas = new OffscreenCanvas(w, h);
    }
  }
  context(): Context {
    const ctx = this.canvas.getContext("2d") as unknown as DrawTarget;
    if (this.format === "FormatRGB24") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, this.width, this.height);
    }
    return new Context(ctx, undefined, this);
  }
  async toPngBytes(): Promise<Uint8Array> {
    const c = this.canvas;
    const blob: Blob = c instanceof HTMLCanvasElement
      ? await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"))
      : await (c as OffscreenCanvas).convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
}
export function imageSurfaceCreate(f: Format, w: number, h: number): ImageSurface {
  return new ImageSurface(f, w, h);
}
export function imageSurfaceGetWidth(s: ImageSurface): number {
  return s.width;
}
export function imageSurfaceGetHeight(s: ImageSurface): number {
  return s.height;
}
export function imageSurfaceGetStride(s: ImageSurface): number {
  return Math.ceil(s.width) * 4;
}
/** Pixel data in Cairo's ARGB32 (premultiplied, native-endian BGRA) layout. */
export function imageSurfaceGetPixels(s: ImageSurface): Uint8Array {
  const ctx = s.canvas.getContext("2d") as CanvasRenderingContext2D;
  const d = ctx.getImageData(0, 0, Math.ceil(s.width), Math.ceil(s.height)).data;
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = Math.round(d[i + 2] * a);
    out[i + 1] = Math.round(d[i + 1] * a);
    out[i + 2] = Math.round(d[i] * a);
    out[i + 3] = d[i + 3];
  }
  return out;
}
/** `withImageSurface fmt w h f` */
export function withImageSurface<A>(f: Format, w: number, h: number, act: (s: ImageSurface) => A): A {
  return act(new ImageSurface(f, w, h));
}
/** `surfaceWriteToPNG`: the PNG bytes (the caller writes them with `@/lib/System/IO`). */
export async function surfaceWriteToPNG(s: ImageSurface): Promise<Uint8Array> {
  return s.toPngBytes();
}

/** `surfaceFinish`: finish the surface (a no-op for the browser surfaces, whose documents are read afterwards). */
export function surfaceFinish(s: Surface): void {
  s.finish();
}

/** `renderWith surface render` */
export function renderWith<A>(s: Surface, render: Render<A>): A {
  const cr = s.context();
  const r = render(cr);
  return r;
}
/** Run a render action with an existing context (`renderWithContext`). */
export function renderWithContext<A>(render: Render<A>, cr: Context): A {
  return render(cr);
}
/** gi-cairo-connector `toRender`: in the browser contexts are already native. */
export function toRender<A>(f: (cr: Context) => A): Render<A> {
  return f;
}
export function getContext(cr: Context): Context {
  return cr;
}

// ---------------------------------------------------------------------------------------------
// SVG and PostScript recording targets

type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };
const ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function mul(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
  };
}
function apply(m: Mat, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}
function scaleOf(m: Mat): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** A shared canvas context for text measurement. */
export function measuringContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d")!;
  }
  return measureCtx;
}

type Seg = ["M" | "L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

interface RecState {
  m: Mat;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  dash: number[];
  dashOffset: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  globalAlpha: number;
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
}

/** Base class for vector recording targets. Paths are kept in device coordinates. */
abstract class Recorder implements DrawTarget {
  protected st: RecState = {
    m: ID, fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, dash: [], dashOffset: 0,
    lineCap: "butt", lineJoin: "miter", miterLimit: 10, globalAlpha: 1, font: "10px sans-serif",
    textBaseline: "alphabetic", textAlign: "start",
  };
  protected stack: RecState[] = [];
  protected path: Seg[] = [];
  private cur: [number, number] = [0, 0];

  get fillStyle(): string { return this.st.fillStyle; }
  set fillStyle(v: any) { this.st.fillStyle = String(v); }
  get strokeStyle(): string { return this.st.strokeStyle; }
  set strokeStyle(v: any) { this.st.strokeStyle = String(v); }
  get lineWidth(): number { return this.st.lineWidth; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  get lineDashOffset(): number { return this.st.dashOffset; }
  set lineDashOffset(v: number) { this.st.dashOffset = v; }
  get lineCap(): CanvasLineCap { return this.st.lineCap; }
  set lineCap(v: CanvasLineCap) { this.st.lineCap = v; }
  get lineJoin(): CanvasLineJoin { return this.st.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.st.lineJoin = v; }
  get miterLimit(): number { return this.st.miterLimit; }
  set miterLimit(v: number) { this.st.miterLimit = v; }
  get globalAlpha(): number { return this.st.globalAlpha; }
  set globalAlpha(v: number) { this.st.globalAlpha = v; }
  get font(): string { return this.st.font; }
  set font(v: string) { this.st.font = v; }
  get textBaseline(): CanvasTextBaseline { return this.st.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this.st.textBaseline = v; }
  get textAlign(): CanvasTextAlign { return this.st.textAlign; }
  set textAlign(v: CanvasTextAlign) { this.st.textAlign = v; }

  save(): void {
    this.stack.push({ ...this.st, dash: [...this.st.dash] });
    this.onSave();
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) {
      this.st = s;
      this.onRestore();
    }
  }
  protected onSave(): void {}
  protected onRestore(): void {}
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.st.m = { a, b, c, d, e, f };
  }
  getTransform(): Mat {
    return { ...this.st.m };
  }
  translate(x: number, y: number): void {
    this.st.m = mul(this.st.m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }
  scale(x: number, y: number): void {
    this.st.m = mul(this.st.m, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
  }
  rotate(t: number): void {
    const c = Math.cos(t), s = Math.sin(t);
    this.st.m = mul(this.st.m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.st.m = mul(this.st.m, { a, b, c, d, e, f });
  }
  beginPath(): void {
    this.path = [];
  }
  moveTo(x: number, y: number): void {
    const p = apply(this.st.m, x, y);
    this.path.push(["M", p[0], p[1]]);
    this.cur = p;
  }
  lineTo(x: number, y: number): void {
    const p = apply(this.st.m, x, y);
    this.path.push([this.path.length === 0 ? "M" : "L", p[0], p[1]]);
    this.cur = p;
  }
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const a = apply(this.st.m, x1, y1), b = apply(this.st.m, x2, y2), c = apply(this.st.m, x, y);
    if (this.path.length === 0) this.path.push(["M", a[0], a[1]]);
    this.path.push(["C", a[0], a[1], b[0], b[1], c[0], c[1]]);
    this.cur = c;
  }
  arc(x: number, y: number, r: number, a1: number, a2: number, ccw = false): void {
    // Approximate with cubic Béziers, at most 90° each.
    let start = a1, end = a2;
    if (!ccw) {
      while (end < start) end += 2 * Math.PI;
    } else {
      while (end > start) end -= 2 * Math.PI;
    }
    const total = end - start;
    const n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
    const step = total / n;
    const p0x = x + r * Math.cos(start), p0y = y + r * Math.sin(start);
    if (this.path.length === 0) this.moveTo(p0x, p0y);
    else this.lineTo(p0x, p0y);
    for (let i = 0; i < n; i++) {
      const t1 = start + i * step, t2 = t1 + step;
      const k = (4 / 3) * Math.tan((t2 - t1) / 4);
      const c1x = x + r * (Math.cos(t1) - k * Math.sin(t1)), c1y = y + r * (Math.sin(t1) + k * Math.cos(t1));
      const c2x = x + r * (Math.cos(t2) + k * Math.sin(t2)), c2y = y + r * (Math.sin(t2) - k * Math.cos(t2));
      this.bezierCurveTo(c1x, c1y, c2x, c2y, x + r * Math.cos(t2), y + r * Math.sin(t2));
    }
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  closePath(): void {
    this.path.push(["Z"]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const saved = this.path;
    this.path = [];
    this.rect(x, y, w, h);
    this.fill();
    this.path = saved;
  }
  setLineDash(d: number[]): void {
    this.st.dash = [...d];
  }
  measureText(text: string): TextMetrics {
    const c = measuringContext();
    c.font = this.st.font;
    return c.measureText(text);
  }
  protected strokeScale(): number {
    return scaleOf(this.st.m);
  }
  abstract fill(rule?: CanvasFillRule): void;
  abstract stroke(): void;
  abstract clip(rule?: CanvasFillRule): void;
  abstract drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void;
  abstract fillText(text: string, x: number, y: number): void;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imageDataUrl(img: CanvasImageSource): string | null {
  try {
    if (img instanceof HTMLImageElement && img.src.startsWith("data:")) return img.src;
    const w = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
    const h = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Records drawing as SVG elements. */
export class SvgTarget extends Recorder {
  private out: string[] = [];
  private clipId = 0;
  private openGroups: number[] = [0];
  private defs: string[] = [];

  private d(): string {
    return this.path.map((s) => {
      switch (s[0]) {
        case "M": case "L": return `${s[0]}${fmt(s[1])} ${fmt(s[2])}`;
        case "C": return `C${fmt(s[1])} ${fmt(s[2])} ${fmt(s[3])} ${fmt(s[4])} ${fmt(s[5])} ${fmt(s[6])}`;
        case "Z": return "Z";
      }
    }).join(" ");
  }
  private alpha(): string {
    return this.st.globalAlpha < 1 ? ` opacity="${fmt(this.st.globalAlpha)}"` : "";
  }
  protected override onSave(): void {
    this.openGroups.push(0);
  }
  protected override onRestore(): void {
    const n = this.openGroups.pop() ?? 0;
    for (let i = 0; i < n; i++) this.out.push("</g>");
  }
  fill(rule: CanvasFillRule = "nonzero"): void {
    if (this.path.length === 0) return;
    this.out.push(`<path d="${this.d()}" fill="${esc(this.st.fillStyle)}"${rule === "evenodd" ? ' fill-rule="evenodd"' : ""}${this.alpha()}/>`);
  }
  stroke(): void {
    if (this.path.length === 0) return;
    const s = this.strokeScale();
    const dash = this.st.dash.length > 0 ? ` stroke-dasharray="${this.st.dash.map((x) => fmt(x * s)).join(",")}" stroke-dashoffset="${fmt(this.st.dashOffset * s)}"` : "";
    this.out.push(`<path d="${this.d()}" fill="none" stroke="${esc(this.st.strokeStyle)}" stroke-width="${fmt(this.st.lineWidth * s)}" stroke-linecap="${this.st.lineCap}" stroke-linejoin="${this.st.lineJoin}" stroke-miterlimit="${fmt(this.st.miterLimit)}"${dash}${this.alpha()}/>`);
  }
  clip(rule: CanvasFillRule = "nonzero"): void {
    const id = `clip${++this.clipId}`;
    this.defs.push(`<clipPath id="${id}"><path d="${this.d()}"${rule === "evenodd" ? ' clip-rule="evenodd"' : ""}/></clipPath>`);
    this.out.push(`<g clip-path="url(#${id})">`);
    this.openGroups[this.openGroups.length - 1]++;
  }
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    const url = imageDataUrl(img);
    if (!url) return;
    const m = this.st.m;
    this.out.push(`<image href="${url}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" transform="matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(fmt).join(" ")})" preserveAspectRatio="none"${this.alpha()}/>`);
  }
  fillText(text: string, x: number, y: number): void {
    const m = this.st.m;
    const f = parseFont(this.st.font);
    const baseline = this.st.textBaseline === "top" ? ' dominant-baseline="text-before-edge"' : this.st.textBaseline === "middle" ? ' dominant-baseline="middle"' : "";
    this.out.push(`<text x="${fmt(x)}" y="${fmt(y)}" transform="matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map(fmt).join(" ")})" font-family="${esc(f.family)}" font-size="${fmt(f.size)}" font-weight="${f.weight}" font-style="${f.style}" fill="${esc(this.st.fillStyle)}" xml:space="preserve"${baseline}${this.alpha()}>${esc(text)}</text>`);
  }
  /** The finished SVG document. */
  document(width: number, height: number): string {
    const closes = this.openGroups.reduce((a, b) => a + b, 0);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fmt(width)}pt" height="${fmt(height)}pt" viewBox="0 0 ${fmt(width)} ${fmt(height)}" version="1.1">\n<defs>${this.defs.join("")}</defs>\n${this.out.join("\n")}${"</g>".repeat(closes)}\n</svg>\n`;
  }
}

function parseFont(font: string): { family: string; size: number; weight: string; style: string } {
  const m = /^(?:(italic|oblique)\s+)?(?:(bold|[1-9]00|normal)\s+)?([\d.]+)(px|pt)\s+(.*)$/.exec(font.trim());
  if (!m) return { family: "sans-serif", size: 10, weight: "normal", style: "normal" };
  const size = m[4] === "pt" ? parseFloat(m[3]) * (96 / 72) : parseFloat(m[3]);
  return { family: m[5].replace(/"/g, "'"), size, weight: m[2] ?? "normal", style: m[1] ?? "normal" };
}

function parseColour(css: string): [number, number, number, number] {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(css);
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255, m[4] !== undefined ? +m[4] : 1];
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(css);
  if (h) return [parseInt(h[1], 16) / 255, parseInt(h[2], 16) / 255, parseInt(h[3], 16) / 255, 1];
  const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(css);
  if (s) return [parseInt(s[1] + s[1], 16) / 255, parseInt(s[2] + s[2], 16) / 255, parseInt(s[3] + s[3], 16) / 255, 1];
  return [0, 0, 0, 1];
}

/** Records drawing as PostScript (device space has its origin at the top left, y down). */
export class PsTarget extends Recorder {
  private out: string[] = [];
  private pages = 1;
  constructor(readonly height: number) {
    super();
  }
  private emitPath(): void {
    for (const s of this.path) {
      switch (s[0]) {
        case "M": this.out.push(`${fmt(s[1])} ${fmt(this.height - s[2])} moveto`); break;
        case "L": this.out.push(`${fmt(s[1])} ${fmt(this.height - s[2])} lineto`); break;
        case "C": this.out.push(`${fmt(s[1])} ${fmt(this.height - s[2])} ${fmt(s[3])} ${fmt(this.height - s[4])} ${fmt(s[5])} ${fmt(this.height - s[6])} curveto`); break;
        case "Z": this.out.push("closepath"); break;
      }
    }
  }
  private colour(css: string): void {
    const [r, g, b] = parseColour(css);
    this.out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} setrgbcolor`);
  }
  protected override onSave(): void {
    this.out.push("gsave");
  }
  protected override onRestore(): void {
    this.out.push("grestore");
  }
  fill(rule: CanvasFillRule = "nonzero"): void {
    if (this.path.length === 0) return;
    this.out.push("newpath");
    this.emitPath();
    this.colour(this.st.fillStyle);
    this.out.push(rule === "evenodd" ? "eofill" : "fill");
  }
  stroke(): void {
    if (this.path.length === 0) return;
    const s = this.strokeScale();
    this.out.push("newpath");
    this.emitPath();
    this.colour(this.st.strokeStyle);
    this.out.push(`${fmt(this.st.lineWidth * s)} setlinewidth`);
    this.out.push(`${this.st.lineCap === "round" ? 1 : this.st.lineCap === "square" ? 2 : 0} setlinecap`);
    this.out.push(`${this.st.lineJoin === "round" ? 1 : this.st.lineJoin === "bevel" ? 2 : 0} setlinejoin`);
    this.out.push(`[${this.st.dash.map((x) => fmt(x * s)).join(" ")}] ${fmt(this.st.dashOffset * s)} setdash`);
    this.out.push("stroke");
  }
  clip(rule: CanvasFillRule = "nonzero"): void {
    this.out.push("newpath");
    this.emitPath();
    this.out.push(rule === "evenodd" ? "eoclip" : "clip", "newpath");
  }
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    // Rasterise to RGB hex data.
    try {
      const pw = Math.max(1, Math.round(w)), ph = Math.max(1, Math.round(h));
      const c = document.createElement("canvas");
      c.width = pw;
      c.height = ph;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, pw, ph);
      ctx.drawImage(img, 0, 0, pw, ph);
      const data = ctx.getImageData(0, 0, pw, ph).data;
      let hex = "";
      for (let i = 0; i < data.length; i += 4) {
        hex += data[i].toString(16).padStart(2, "0") + data[i + 1].toString(16).padStart(2, "0") + data[i + 2].toString(16).padStart(2, "0");
        if ((i / 4) % 32 === 31) hex += "\n";
      }
      const [x0, y0] = apply(this.st.m, x, y + h);
      const sc = this.strokeScale();
      this.out.push("gsave", `${fmt(x0)} ${fmt(this.height - y0)} translate`, `${fmt(w * sc)} ${fmt(h * sc)} scale`,
        `${pw} ${ph} 8 [${pw} 0 0 -${ph} 0 ${ph}] {currentfile ${pw * 3} string readhexstring pop} false 3 colorimage`, hex, "grestore");
    } catch {
      // Cross-origin images cannot be read back; skip them.
    }
  }
  fillText(text: string, x: number, y: number): void {
    const f = parseFont(this.st.font);
    const [dx, dy] = apply(this.st.m, x, y);
    const sz = f.size * this.strokeScale();
    const face = f.weight === "bold" || f.weight === "700" ? "Helvetica-Bold" : "Helvetica";
    const off = this.st.textBaseline === "top" ? sz * 0.8 : this.st.textBaseline === "middle" ? sz * 0.35 : 0;
    this.colour(this.st.fillStyle);
    const s = text.replace(/[\\()]/g, (m) => "\\" + m).replace(/[^\x20-\x7e]/g, "?");
    this.out.push(`/${face} findfont ${fmt(sz)} scalefont setfont`, `${fmt(dx)} ${fmt(this.height - dy - off)} moveto (${s}) show`);
  }
  showPageMark(): void {
    this.out.push("showpage");
    this.pages++;
    this.out.push(`%%Page: ${this.pages} ${this.pages}`);
  }
  document(width: number, height: number, eps: boolean): string {
    const head = eps
      ? `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}\n%%Creator: HADES\n%%EndComments\n`
      : `%!PS-Adobe-3.0\n%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}\n%%Creator: HADES\n%%Pages: (atend)\n%%EndComments\n%%Page: 1 1\n`;
    return head + this.out.join("\n") + `\n${eps ? "" : "showpage\n%%Trailer\n%%Pages: " + this.pages + "\n"}%%EOF\n`;
  }
}

/** An SVG surface: drawing is recorded; `document()` gives the SVG text. */
export class SvgSurface extends Surface {
  readonly target = new SvgTarget();
  constructor(readonly width: number, readonly height: number) {
    super();
  }
  context(): Context {
    return new Context(this.target, undefined, this);
  }
  document(): string {
    return this.target.document(this.width, this.height);
  }
}
/** A PostScript surface. */
export class PsSurface extends Surface {
  readonly target: PsTarget;
  constructor(readonly width: number, readonly height: number, readonly eps = false) {
    super();
    this.target = new PsTarget(height);
  }
  context(): Context {
    return new Context(this.target, undefined, this);
  }
  override showPage(): void {
    this.target.showPageMark();
  }
  document(): string {
    return this.target.document(this.width, this.height, this.eps);
  }
}

/**
 * `withSVGSurface path w h act`: in the browser the SVG text is returned with the action's
 * result; the caller writes it to the file.
 */
export function withSVGSurface<A>(_path: string, w: number, h: number, act: (s: SvgSurface) => A): [A, string] {
  const s = new SvgSurface(w, h);
  const r = act(s);
  return [r, s.document()];
}
export function withPSSurface<A>(_path: string, w: number, h: number, act: (s: PsSurface) => A): [A, string] {
  const s = new PsSurface(w, h, false);
  const r = act(s);
  return [r, s.document()];
}
/**
 * `withPDFSurface`: browsers cannot write PDF natively. The drawing is recorded by a PDF
 * recording surface (vector paths and text, see `PdfSurface`) and written as a single-page PDF.
 * Returns the action's result and the PDF bytes. (Same as `withPdfSurface`; the drawing used to be
 * recorded on an SVG surface, which produced an empty page.)
 */
export function withPDFSurface<A>(path: string, w: number, h: number, act: (s: PdfSurface) => A): [A, Uint8Array] {
  return withPdfSurface(path, w, h, act);
}

/** Minimal PDF writer for recorded vector drawings (paths, fills, strokes, text, images). */
function svgToPdf(target: SvgTarget, w: number, h: number, images: readonly PdfImage[] = []): Uint8Array {
  // Re-record via a PostScript-like operator stream in PDF syntax.
  const ps = target as unknown as { out: string[] };
  void ps;
  const content = pdfOps.get(target) ?? "";
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  // Image n is object 7 + 2n, its soft mask 8 + 2n.
  const xobjects = images.map((_, n) => `/Im${n} ${7 + 2 * n} 0 R`).join(" ");
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(w)} ${fmt(h)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> >>`);
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  images.forEach((im, n) => {
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${8 + 2 * n} 0 R /Filter /ASCIIHexDecode /Length ${im.rgb.length} >>\nstream\n${im.rgb}\nendstream`);
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${im.alpha.length} >>\nstream\n${im.alpha}\nendstream`);
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** PDF operator streams recorded alongside SVG targets used for PDF output. */
const pdfOps = new WeakMap<SvgTarget, string>();

/** A PDF recording target: like PostScript but in PDF content-stream syntax. */
export class PdfTarget extends Recorder {
  private out: string[] = [];
  constructor(readonly height: number) {
    super();
  }
  private emitPath(): void {
    for (const s of this.path) {
      switch (s[0]) {
        case "M": this.out.push(`${fmt(s[1])} ${fmt(this.height - s[2])} m`); break;
        case "L": this.out.push(`${fmt(s[1])} ${fmt(this.height - s[2])} l`); break;
        case "C": this.out.push(`${fmt(s[1])} ${fmt(this.height - s[2])} ${fmt(s[3])} ${fmt(this.height - s[4])} ${fmt(s[5])} ${fmt(this.height - s[6])} c`); break;
        case "Z": this.out.push("h"); break;
      }
    }
  }
  private rgb(css: string, op: "rg" | "RG"): void {
    const [r, g, b] = parseColour(css);
    this.out.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} ${op}`);
  }
  protected override onSave(): void {
    this.out.push("q");
  }
  protected override onRestore(): void {
    this.out.push("Q");
  }
  fill(rule: CanvasFillRule = "nonzero"): void {
    if (this.path.length === 0) return;
    this.rgb(this.st.fillStyle, "rg");
    this.emitPath();
    this.out.push(rule === "evenodd" ? "f*" : "f");
  }
  stroke(): void {
    if (this.path.length === 0) return;
    const s = this.strokeScale();
    this.rgb(this.st.strokeStyle, "RG");
    this.out.push(`${fmt(this.st.lineWidth * s)} w`);
    this.out.push(`${this.st.lineCap === "round" ? 1 : this.st.lineCap === "square" ? 2 : 0} J`);
    this.out.push(`${this.st.lineJoin === "round" ? 1 : this.st.lineJoin === "bevel" ? 2 : 0} j`);
    this.out.push(`[${this.st.dash.map((x) => fmt(x * s)).join(" ")}] ${fmt(this.st.dashOffset * s)} d`);
    this.emitPath();
    this.out.push("S");
  }
  clip(rule: CanvasFillRule = "nonzero"): void {
    this.emitPath();
    this.out.push(rule === "evenodd" ? "W* n" : "W n");
  }
  /** Images drawn so far, written as image XObjects `/Im0`, `/Im1`, ... (with a soft mask). */
  readonly images: PdfImage[] = [];
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    // Rasterise the image (at least at its drawn size) and place it with its transformation.
    try {
      const sc = this.strokeScale();
      const pw = Math.max(1, Math.round(w * sc * 2)), ph = Math.max(1, Math.round(h * sc * 2));
      const c = document.createElement("canvas");
      c.width = pw;
      c.height = ph;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, pw, ph);
      const data = ctx.getImageData(0, 0, pw, ph).data;
      let rgb = "", alpha = "";
      for (let i = 0; i < data.length; i += 4) {
        rgb += data[i].toString(16).padStart(2, "0") + data[i + 1].toString(16).padStart(2, "0") + data[i + 2].toString(16).padStart(2, "0");
        alpha += data[i + 3].toString(16).padStart(2, "0");
        if ((i / 4) % 32 === 31) {
          rgb += "\n";
          alpha += "\n";
        }
      }
      const n = this.images.length;
      this.images.push({ width: pw, height: ph, rgb: rgb + ">", alpha: alpha + ">" });
      // Image space is the unit square, y up: map it onto the destination rectangle.
      const m = this.st.m;
      const [ox, oy] = apply(m, x, y + h);
      this.out.push("q", `${fmt(m.a * w)} ${fmt(-m.b * w)} ${fmt(-m.c * h)} ${fmt(m.d * h)} ${fmt(ox)} ${fmt(this.height - oy)} cm`, `/Im${n} Do`, "Q");
    } catch {
      // Cross-origin images cannot be read back; skip them.
    }
  }
  fillText(text: string, x: number, y: number): void {
    const f = parseFont(this.st.font);
    const [dx, dy] = apply(this.st.m, x, y);
    const sz = f.size * this.strokeScale();
    const off = this.st.textBaseline === "top" ? sz * 0.8 : this.st.textBaseline === "middle" ? sz * 0.35 : 0;
    const bold = f.weight === "bold" || Number(f.weight) >= 600;
    const font = bold ? "F2" : "F1";
    this.rgb(this.st.fillStyle, "rg");
    const codes = pdfWinAnsi(text);
    const s = codes.map((c) => (c === 0x28 || c === 0x29 || c === 0x5c ? "\\" + String.fromCharCode(c) : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : "\\" + c.toString(8).padStart(3, "0"))).join("");
    // The layout was measured with the drawing font; Helvetica has other widths, so each run is
    // scaled horizontally to the measured width (otherwise runs overlap or overflow boxes).
    const helvetica = codes.reduce((a, c) => a + helveticaWidth(c, bold), 0) * f.size / 1000;
    let measured = helvetica;
    try {
      measured = this.measureText(text).width;
    } catch {
      // No canvas (tests): keep Helvetica's own widths.
    }
    const tz = helvetica > 0 && measured > 0 ? Math.max(50, Math.min(200, (100 * measured) / helvetica)) : 100;
    this.out.push(`BT /${font} ${fmt(sz)} Tf ${fmt(tz)} Tz ${fmt(dx)} ${fmt(this.height - dy - off)} Td (${s}) Tj ET`);
  }
  content(): string {
    return this.out.join("\n");
  }
}

/** An image of a PDF page: RGB and alpha samples as ASCII hex (terminated by ">"). */
interface PdfImage {
  readonly width: number;
  readonly height: number;
  readonly rgb: string;
  readonly alpha: string;
}

/** WinAnsiEncoding codes of the text's characters (unknown characters become "?"). */
function pdfWinAnsi(text: string): number[] {
  const extra: Record<string, number> = {
    "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89,
    "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
    "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
  };
  const r: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff)) r.push(c);
    else if (extra[ch] !== undefined) r.push(extra[ch]);
    else r.push(0x3f);
  }
  return r;
}

/** Advance widths (per 1000 em) of Helvetica and Helvetica-Bold for WinAnsi codes 0x20-0x7E. */
const helveticaWidths: readonly (readonly number[])[] = [
  [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778,
    722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
    278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
  [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556,
    556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778,
    722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
    278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
];
function helveticaWidth(code: number, bold: boolean): number {
  return code >= 0x20 && code < 0x7f ? helveticaWidths[bold ? 1 : 0][code - 0x20] : 556;
}

/** A PDF surface. `pdfBytes()` produces the document. */
export class PdfSurface extends Surface {
  readonly target: PdfTarget;
  constructor(readonly width: number, readonly height: number) {
    super();
    this.target = new PdfTarget(height);
  }
  context(): Context {
    return new Context(this.target, undefined, this);
  }
  pdfBytes(): Uint8Array {
    const svg = new SvgTarget();
    pdfOps.set(svg, this.target.content());
    return svgToPdf(svg, this.width, this.height, this.target.images);
  }
}
/** `withPDFSurface` using the PDF recorder. */
export function withPdfSurface<A>(_path: string, w: number, h: number, act: (s: PdfSurface) => A): [A, Uint8Array] {
  const s = new PdfSurface(w, h);
  const r = act(s);
  return [r, s.pdfBytes()];
}
