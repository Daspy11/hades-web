/**
 * Browser replacement for `GI.Pango` and `GI.PangoCairo`: font descriptions, text layouts
 * with wrapping, alignment, indentation, ellipsization and attributes, and drawing layouts
 * on a Cairo context.
 *
 * Measurement uses the canvas text API (or, where no 2D canvas exists, as in jsdom unit tests,
 * the deterministic `fallbackMeasurer`). Units follow Pango: sizes and positions are in Pango
 * units (`SCALE` = 1024 per device unit) and font sizes are in points, converted at the 96 dpi
 * resolution PangoCairo uses by default (1pt = 4/3 px). Attribute indices are UTF-8 byte
 * offsets, as in Pango.
 */
import { measuringContext, type Context } from "./Cairo";

export const SCALE = 1024;
export function unitsFromDouble(d: number): number {
  return Math.round(d * SCALE);
}
export function unitsToDouble(n: number): number {
  return n / SCALE;
}

const PT_TO_PX = 96 / 72;

// ---------------------------------------------------------------------------------------------
// Text measurement

/** The parts of a canvas 2D context used to measure text. */
interface TextMeasurer {
  font: string;
  measureText(text: string): Pick<TextMetrics, "width" | "fontBoundingBoxAscent" | "fontBoundingBoxDescent" | "actualBoundingBoxAscent" | "actualBoundingBoxDescent">;
}

/**
 * Deterministic text measurer used when no 2D canvas is available (unit tests under jsdom,
 * which has no canvas implementation). Widths come from a small table of Roboto-like advance
 * widths (as fractions of the font's pixel size, 5% wider for bold); vertical metrics are
 * Roboto's (ascent 0.928, descent 0.244, cap height 0.711, x-height 0.528). The numbers only
 * need to be plausible and stable, so layout code can be tested without a browser.
 */
export const fallbackMeasurer: TextMeasurer = {
  font: "10px sans-serif",
  measureText(text: string) {
    const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "10");
    const weight = parseInt(/\b([1-9]00)\b/.exec(this.font)?.[1] ?? "400", 10);
    const bold = weight >= 600 ? 1.05 : 1;
    let w = 0;
    for (const c of text) {
      const f = c === " " ? 0.25
        : "ijlI.,:;'!|".includes(c) ? 0.25
        : "frt-()[]".includes(c) ? 0.33
        : c === "m" || c === "M" ? 0.85
        : c === "w" || c === "W" ? 0.75
        : c >= "A" && c <= "Z" ? 0.65
        : c >= "0" && c <= "9" ? 0.56
        : 0.53;
      w += f * px * bold;
    }
    const tall = /[A-Z0-9bdfhklt]/.test(text);
    return {
      width: w,
      fontBoundingBoxAscent: 0.928 * px,
      fontBoundingBoxDescent: 0.244 * px,
      actualBoundingBoxAscent: text.length === 0 ? 0 : (tall ? 0.711 : 0.528) * px,
      actualBoundingBoxDescent: /[gjpqy,;]/.test(text) ? 0.21 * px : 0,
    };
  },
};

let noCanvas = false;
/** The canvas measuring context of `Cairo.measuringContext`, or `fallbackMeasurer` without a canvas. */
function textMeasurer(): TextMeasurer {
  if (!noCanvas) {
    try {
      const c = measuringContext();
      if (c) return c;
    } catch {
      // No document: fall through.
    }
    noCanvas = true;
  }
  return fallbackMeasurer;
}

// ---------------------------------------------------------------------------------------------
// Fonts

export type Weight = "WeightThin" | "WeightLight" | "WeightNormal" | "WeightMedium" | "WeightSemibold" | "WeightBold" | "WeightHeavy";
export const WeightThin: Weight = "WeightThin";
export const WeightLight: Weight = "WeightLight";
export const WeightNormal: Weight = "WeightNormal";
export const WeightMedium: Weight = "WeightMedium";
export const WeightSemibold: Weight = "WeightSemibold";
export const WeightBold: Weight = "WeightBold";
export const WeightHeavy: Weight = "WeightHeavy";
const weightCss: Record<Weight, number> = {
  WeightThin: 100, WeightLight: 300, WeightNormal: 400, WeightMedium: 500, WeightSemibold: 600, WeightBold: 700, WeightHeavy: 900,
};

export type Style = "StyleNormal" | "StyleOblique" | "StyleItalic";
export const StyleNormal: Style = "StyleNormal";
export const StyleItalic: Style = "StyleItalic";

export class FontDescription {
  family = "Sans";
  /** Size in Pango units of points (0 = unset). */
  size = 0;
  absolute = false;
  weight: Weight = "WeightNormal";
  style: Style = "StyleNormal";
  copy(): FontDescription {
    const f = new FontDescription();
    Object.assign(f, this);
    return f;
  }
  /** Size in CSS pixels. */
  px(): number {
    const s = this.size === 0 ? 10 * SCALE : this.size;
    return this.absolute ? s / SCALE : (s / SCALE) * PT_TO_PX;
  }
  css(weight: Weight = this.weight, style: Style = this.style): string {
    const families = this.family.split(",").map((f) => cssFamily(f.trim())).join(", ");
    return `${style === "StyleNormal" ? "" : "italic "}${weightCss[weight]} ${this.px()}px ${families}`;
  }
}
function cssFamily(f: string): string {
  switch (f.toLowerCase()) {
    case "sans": case "sans-serif": return "sans-serif";
    case "serif": return "serif";
    case "monospace": case "mono": return "monospace";
    default: return `"${f}"`;
  }
}
export function fontDescriptionNew(): FontDescription {
  return new FontDescription();
}
export function fontDescriptionFromString(s: string): FontDescription {
  const f = new FontDescription();
  const m = /^(.*?)\s*(\d+(?:\.\d+)?)?\s*$/.exec(s.trim());
  let fam = m?.[1] ?? s;
  if (/\bbold\b/i.test(fam)) {
    f.weight = "WeightBold";
    fam = fam.replace(/\bbold\b/i, "").trim();
  }
  if (/\bitalic\b/i.test(fam)) {
    f.style = "StyleItalic";
    fam = fam.replace(/\bitalic\b/i, "").trim();
  }
  f.family = fam || "Sans";
  if (m?.[2]) f.size = Math.round(parseFloat(m[2]) * SCALE);
  return f;
}
export function fontDescriptionCopy(f: FontDescription): FontDescription | null {
  return f.copy();
}
export function fontDescriptionSetFamily(f: FontDescription, fam: string): void {
  f.family = fam;
}
export function fontDescriptionGetFamily(f: FontDescription): string {
  return f.family;
}
export function fontDescriptionSetSize(f: FontDescription, s: number): void {
  f.size = s;
  f.absolute = false;
}
export function fontDescriptionSetAbsoluteSize(f: FontDescription, s: number): void {
  f.size = s;
  f.absolute = true;
}
export function fontDescriptionGetSize(f: FontDescription): number {
  return f.size;
}
export function fontDescriptionSetWeight(f: FontDescription, w: Weight): void {
  f.weight = w;
}
export function fontDescriptionSetStyle(f: FontDescription, s: Style): void {
  f.style = s;
}
export function fontDescriptionToString(f: FontDescription): string {
  return `${f.family}${f.weight === "WeightBold" ? " Bold" : ""}${f.style === "StyleItalic" ? " Italic" : ""} ${f.size / SCALE}`;
}

// ---------------------------------------------------------------------------------------------
// Context and metrics

export class PangoContext {
  constructor(readonly cr: Context | null) {}
}
/** `PangoCairo.createContext cr` */
export function createContext(cr: Context | null): PangoContext {
  return new PangoContext(cr);
}

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly height: number;
  readonly approximateCharWidth: number;
}
const metricsCache = new Map<string, { ascent: number; descent: number }>();
function fontMetricsPx(font: string, px: number): { ascent: number; descent: number } {
  let m = metricsCache.get(font);
  if (!m) {
    const ctx = textMeasurer();
    ctx.font = font;
    const tm = ctx.measureText("Hg");
    const ascent = tm.fontBoundingBoxAscent ?? px * 0.93;
    const descent = tm.fontBoundingBoxDescent ?? px * 0.24;
    m = { ascent, descent };
    // Fonts may still be loading; only cache when the measurement looks plausible.
    if (typeof document === "undefined" || (document.fonts && document.fonts.status === "loaded")) metricsCache.set(font, m);
  }
  return m;
}
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener?.("loadingdone", () => {
    metricsCache.clear();
    widthCache.clear();
  });
}
/** `contextGetMetrics ctx font lang`, in Pango units. */
export function contextGetMetrics(_ctx: PangoContext, font: FontDescription | null, _lang: unknown): FontMetrics {
  const f = font ?? new FontDescription();
  const m = fontMetricsPx(f.css(), f.px());
  const ctx = textMeasurer();
  ctx.font = f.css();
  const cw = ctx.measureText("abcdefghijklmnopqrstuvwxyz").width / 26;
  return {
    ascent: unitsFromDouble(m.ascent),
    descent: unitsFromDouble(m.descent),
    height: unitsFromDouble(m.ascent + m.descent),
    approximateCharWidth: unitsFromDouble(cw),
  };
}
export function fontMetricsGetHeight(m: FontMetrics): number {
  return m.height;
}
export function fontMetricsGetAscent(m: FontMetrics): number {
  return m.ascent;
}
export function fontMetricsGetDescent(m: FontMetrics): number {
  return m.descent;
}
export function fontMetricsGetApproximateCharWidth(m: FontMetrics): number {
  return m.approximateCharWidth;
}

// ---------------------------------------------------------------------------------------------
// Attributes

export type AttrKind = "weight" | "foreground" | "background" | "style" | "underline" | "size" | "family";

export class Attribute {
  startIndex = 0;
  endIndex = 0xffffffff;
  constructor(readonly kind: AttrKind, readonly value: any) {}
}
export function attrWeightNew(w: Weight): Attribute {
  return new Attribute("weight", w);
}
export function attrStyleNew(s: Style): Attribute {
  return new Attribute("style", s);
}
/** Colour channels are 16 bit (0 – 65535). */
export function attrForegroundNew(r: number, g: number, b: number): Attribute {
  return new Attribute("foreground", rgb16(r, g, b));
}
export function attrBackgroundNew(r: number, g: number, b: number): Attribute {
  return new Attribute("background", rgb16(r, g, b));
}
export function attrUnderlineNew(u: unknown): Attribute {
  return new Attribute("underline", u);
}
export function attrSizeNew(s: number): Attribute {
  return new Attribute("size", s);
}
function rgb16(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round((Math.max(0, Math.min(65535, v)) / 65535) * 255);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
export function setAttributeStartIndex(a: Attribute, n: number): void {
  a.startIndex = n;
}
export function setAttributeEndIndex(a: Attribute, n: number): void {
  a.endIndex = n;
}
/** `Pango.set attr [#startIndex := s, #endIndex := e]` → `Pango.set(attr, { startIndex: s, endIndex: e })`. */
export function set(obj: Attribute | Rectangle, props: Record<string, number>): void {
  Object.assign(obj, props);
}
/** `Pango.get rect #x` → `Pango.get(rect, "x")`. */
export function get<K extends keyof Rectangle>(obj: Rectangle, key: K): Rectangle[K] {
  return obj[key];
}

export class AttrList {
  attrs: Attribute[] = [];
  copy(): AttrList {
    const l = new AttrList();
    l.attrs = this.attrs.slice();
    return l;
  }
}
export function attrListNew(): AttrList {
  return new AttrList();
}
export function attrListInsert(l: AttrList, a: Attribute): void {
  l.attrs.push(a);
}
export function attrListChange(l: AttrList, a: Attribute): void {
  l.attrs.push(a);
}

/** Parse Pango markup into plain text and attributes. */
export function parseMarkup(markup: string): [string, AttrList] {
  const list = new AttrList();
  let text = "";
  const stack: { tag: string; start: number; attrs: [AttrKind, any][] }[] = [];
  const enc = new TextEncoder();
  const re = /<\/?([a-zA-Z]+)([^>]*)>|&(amp|lt|gt|quot|apos|#\d+);|[^<&]+/g;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    if (m[0].startsWith("</")) {
      const top = stack.pop();
      if (top) {
        const end = enc.encode(text).length;
        for (const [k, v] of top.attrs) {
          const a = new Attribute(k, v);
          a.startIndex = top.start;
          a.endIndex = end;
          list.attrs.push(a);
        }
      }
    } else if (m[0].startsWith("<")) {
      const tag = m[1].toLowerCase();
      const attrs: [AttrKind, any][] = [];
      if (tag === "b") attrs.push(["weight", "WeightBold"]);
      else if (tag === "i") attrs.push(["style", "StyleItalic"]);
      else if (tag === "u") attrs.push(["underline", true]);
      else if (tag === "span") {
        const ws = /(?:weight|font_weight)="([^"]+)"/.exec(m[2]);
        if (ws) attrs.push(["weight", ws[1] === "bold" ? "WeightBold" : "WeightNormal"]);
        const fg = /(?:foreground|fgcolor|color)="([^"]+)"/.exec(m[2]);
        if (fg) attrs.push(["foreground", fg[1]]);
        const bg = /(?:background|bgcolor)="([^"]+)"/.exec(m[2]);
        if (bg) attrs.push(["background", bg[1]]);
        const st = /style="([^"]+)"/.exec(m[2]);
        if (st && st[1] === "italic") attrs.push(["style", "StyleItalic"]);
      }
      if (m[0].endsWith("/>")) continue;
      stack.push({ tag, start: enc.encode(text).length, attrs });
    } else if (m[3]) {
      const ent = m[3];
      text += ent === "amp" ? "&" : ent === "lt" ? "<" : ent === "gt" ? ">" : ent === "quot" ? '"' : ent === "apos" ? "'" : String.fromCodePoint(parseInt(ent.slice(1), 10));
    } else text += m[0];
  }
  return [text, list];
}

// ---------------------------------------------------------------------------------------------
// Layout

export type Alignment = "AlignmentLeft" | "AlignmentCenter" | "AlignmentRight";
export const AlignmentLeft: Alignment = "AlignmentLeft";
export const AlignmentCenter: Alignment = "AlignmentCenter";
export const AlignmentRight: Alignment = "AlignmentRight";
export type WrapMode = "WrapModeWord" | "WrapModeChar" | "WrapModeWordChar";
export const WrapModeWord: WrapMode = "WrapModeWord";
export const WrapModeChar: WrapMode = "WrapModeChar";
export const WrapModeWordChar: WrapMode = "WrapModeWordChar";
export type EllipsizeMode = "EllipsizeModeNone" | "EllipsizeModeStart" | "EllipsizeModeMiddle" | "EllipsizeModeEnd";
export const EllipsizeModeNone: EllipsizeMode = "EllipsizeModeNone";
export const EllipsizeModeStart: EllipsizeMode = "EllipsizeModeStart";
export const EllipsizeModeMiddle: EllipsizeMode = "EllipsizeModeMiddle";
export const EllipsizeModeEnd: EllipsizeMode = "EllipsizeModeEnd";

/** Pango rectangles, in Pango units. */
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function getRectangleX(r: Rectangle): number { return r.x; }
export function getRectangleY(r: Rectangle): number { return r.y; }
export function getRectangleWidth(r: Rectangle): number { return r.width; }
export function getRectangleHeight(r: Rectangle): number { return r.height; }

/** A run of text with uniform attributes on one line. */
interface Run {
  text: string;
  /** Start offset (UTF-16 index) in the layout text. */
  start: number;
  font: string;
  width: number;
  fg: string | null;
  bg: string | null;
  underline: boolean;
}
interface Line {
  runs: Run[];
  x: number;
  width: number;
  start: number;
  end: number;
  ascent: number;
  descent: number;
}

const widthCache = new Map<string, number>();
function measure(font: string, text: string): number {
  const k = font + "\u0000" + text;
  let w = widthCache.get(k);
  if (w === undefined) {
    const ctx = textMeasurer();
    ctx.font = font;
    w = ctx.measureText(text).width;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(k, w);
  }
  return w;
}

export class Layout {
  text = "";
  font: FontDescription = new FontDescription();
  /** Width in Pango units, -1 for none. */
  width = -1;
  height = -1;
  wrap: WrapMode = "WrapModeWord";
  alignment: Alignment = "AlignmentLeft";
  ellipsize: EllipsizeMode = "EllipsizeModeNone";
  /** First-line indent in Pango units (negative for a hanging indent). */
  indent = 0;
  spacing = 0;
  justify = false;
  attrs: AttrList | null = null;
  singleParagraph = false;
  private cache: Line[] | null = null;
  constructor(readonly context: PangoContext | null) {}
  invalidate(): void {
    this.cache = null;
  }

  /** Attribute-derived style at a UTF-16 offset. */
  private styleAt(byteOffsets: number[], i: number): { weight: Weight; style: Style; fg: string | null; bg: string | null; underline: boolean } {
    let weight = this.font.weight, style = this.font.style;
    let fg: string | null = null, bg: string | null = null, underline = false;
    if (this.attrs) {
      const b = byteOffsets[i];
      for (const a of this.attrs.attrs) {
        if (b >= a.startIndex && b < a.endIndex) {
          if (a.kind === "weight") weight = a.value;
          else if (a.kind === "style") style = a.value;
          else if (a.kind === "foreground") fg = a.value;
          else if (a.kind === "background") bg = a.value;
          else if (a.kind === "underline") underline = !!a.value;
        }
      }
    }
    return { weight, style, fg, bg, underline };
  }

  lines(): Line[] {
    if (this.cache) return this.cache;
    const text = this.text;
    // UTF-8 byte offset of each UTF-16 index.
    const byteOffsets: number[] = new Array(text.length + 1);
    let b = 0;
    for (let i = 0; i < text.length; i++) {
      byteOffsets[i] = b;
      const c = text.charCodeAt(i);
      if (c < 0x80) b += 1;
      else if (c < 0x800) b += 2;
      else if (c >= 0xd800 && c < 0xdc00) {
        b += 4;
        byteOffsets[++i] = b;
      } else b += 3;
    }
    byteOffsets[text.length] = b;

    const baseMetrics = fontMetricsPx(this.font.css(), this.font.px());
    const maxW = this.width < 0 ? Infinity : this.width / SCALE;
    const indentPx = this.indent / SCALE;
    const out: Line[] = [];

    // Character styles.
    const charFont: string[] = new Array(text.length);
    const charStyle: ReturnType<Layout["styleAt"]>[] = new Array(text.length);
    for (let i = 0; i < text.length; i++) {
      const st = this.styleAt(byteOffsets, i);
      charStyle[i] = st;
      charFont[i] = this.font.css(st.weight, st.style);
    }
    const widthOf = (s: number, e: number): number => {
      let w = 0, i = s;
      while (i < e) {
        let j = i + 1;
        while (j < e && charFont[j] === charFont[i]) j++;
        w += measure(charFont[i], text.slice(i, j));
        i = j;
      }
      return w;
    };
    const makeRuns = (s: number, e: number): Run[] => {
      const runs: Run[] = [];
      let i = s;
      while (i < e) {
        let j = i + 1;
        const si = charStyle[i];
        while (j < e && charFont[j] === charFont[i] && charStyle[j].fg === si.fg && charStyle[j].bg === si.bg && charStyle[j].underline === si.underline) j++;
        const t = text.slice(i, j);
        runs.push({ text: t, start: i, font: charFont[i], width: measure(charFont[i], t), fg: si.fg, bg: si.bg, underline: si.underline });
        i = j;
      }
      return runs;
    };

    const paragraphs: [number, number][] = [];
    if (this.singleParagraph) paragraphs.push([0, text.length]);
    else {
      let s = 0;
      for (let i = 0; i <= text.length; i++) {
        if (i === text.length || text[i] === "\n") {
          paragraphs.push([s, i]);
          s = i + 1;
        }
      }
    }

    for (const [ps, pe] of paragraphs) {
      let first = true;
      let s = ps;
      if (ps === pe) {
        out.push({ runs: [], x: 0, width: 0, start: ps, end: pe, ascent: baseMetrics.ascent, descent: baseMetrics.descent });
        continue;
      }
      while (s < pe) {
        const lineIndent = first ? Math.max(0, indentPx) : Math.max(0, -indentPx);
        const avail = maxW - lineIndent;
        let e = pe;
        if (Number.isFinite(avail) && this.ellipsize === "EllipsizeModeNone" && widthOf(s, pe) > avail) {
          // Find the break point.
          let lastBreak = -1;
          let i = s;
          let w = 0;
          for (; i < pe; i++) {
            const cw = widthOf(i, i + 1);
            if (w + cw > avail && i > s) break;
            w += cw;
            if (text[i] === " " || text[i] === "\t" || text[i] === "-") lastBreak = i + 1;
          }
          if (this.wrap === "WrapModeChar") e = Math.max(s + 1, i);
          else if (lastBreak > s) e = lastBreak;
          else e = this.wrap === "WrapModeWordChar" ? Math.max(s + 1, i) : (() => {
            // Word mode: overflow the long word to the next space.
            let k = i;
            while (k < pe && text[k] !== " ") k++;
            return Math.min(pe, k + 1);
          })();
        }
        // Trailing spaces do not count towards the line width.
        let visEnd = e;
        while (visEnd > s && text[visEnd - 1] === " ") visEnd--;
        let runs = makeRuns(s, visEnd);
        let lw = runs.reduce((a, r) => a + r.width, 0);
        if (this.ellipsize !== "EllipsizeModeNone" && Number.isFinite(avail) && lw > avail) {
          runs = this.ellipsizeRuns(s, visEnd, avail, charFont, charStyle);
          lw = runs.reduce((a, r) => a + r.width, 0);
        }
        let ascent = baseMetrics.ascent, descent = baseMetrics.descent;
        for (const r of runs) {
          const m = fontMetricsPx(r.font, this.font.px());
          ascent = Math.max(ascent, m.ascent);
          descent = Math.max(descent, m.descent);
        }
        let x = lineIndent;
        if (Number.isFinite(maxW)) {
          if (this.alignment === "AlignmentCenter") x = lineIndent + (avail - lw) / 2;
          else if (this.alignment === "AlignmentRight") x = maxW - lw;
        }
        out.push({ runs, x, width: lw, start: s, end: e, ascent, descent });
        s = e;
        first = false;
      }
    }
    this.cache = out;
    return out;
  }

  private ellipsizeRuns(s: number, e: number, avail: number, charFont: string[], charStyle: { fg: string | null; bg: string | null; underline: boolean }[]): Run[] {
    const ell = "…";
    const font = charFont[s] ?? this.font.css();
    const ellW = measure(font, ell);
    const text = this.text;
    const mk = (a: number, b: number): Run[] => {
      const r: Run[] = [];
      if (b > a) {
        const t = text.slice(a, b);
        r.push({ text: t, start: a, font: charFont[a], width: measure(charFont[a], t), fg: charStyle[a].fg, bg: charStyle[a].bg, underline: charStyle[a].underline });
      }
      return r;
    };
    const ellRun = (at: number): Run => ({ text: ell, start: at, font, width: ellW, fg: null, bg: null, underline: false });
    if (this.ellipsize === "EllipsizeModeEnd") {
      let k = e;
      while (k > s && measure(font, text.slice(s, k)) + ellW > avail) k--;
      return [...mk(s, k), ellRun(k)];
    }
    if (this.ellipsize === "EllipsizeModeStart") {
      let k = s;
      while (k < e && measure(font, text.slice(k, e)) + ellW > avail) k++;
      return [ellRun(s), ...mk(k, e)];
    }
    // Middle
    let left = Math.floor((s + e) / 2), right = left;
    while (left > s && right < e && measure(font, text.slice(s, left)) + measure(font, text.slice(right, e)) + ellW > avail) {
      left--;
      right++;
    }
    return [...mk(s, left), ellRun(left), ...mk(right, e)];
  }

  /** Logical extents in device units. */
  logicalPx(): { x: number; y: number; width: number; height: number } {
    const ls = this.lines();
    let minX = Infinity, maxX = -Infinity, h = 0;
    for (const l of ls) {
      minX = Math.min(minX, l.x);
      maxX = Math.max(maxX, l.x + l.width);
      h += l.ascent + l.descent + this.spacing / SCALE;
    }
    if (ls.length > 0) h -= this.spacing / SCALE;
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 0;
    }
    if (this.width >= 0) {
      // Pango reports the full width for aligned/wrapped layouts.
      minX = Math.min(minX, 0);
    }
    return { x: minX, y: 0, width: Math.max(0, maxX - minX), height: h };
  }
}

export function layoutNew(ctx: PangoContext | null): Layout {
  return new Layout(ctx);
}
/** `PangoCairo.createLayout cr` */
export function createLayout(cr: Context | null): Layout {
  return new Layout(new PangoContext(cr));
}
export function layoutSetText(l: Layout, t: string, _len = -1): void {
  l.text = t;
  l.invalidate();
}
export function layoutGetText(l: Layout): string {
  return l.text;
}
export function layoutSetMarkup(l: Layout, markup: string, _len = -1): void {
  const [t, attrs] = parseMarkup(markup);
  l.text = t;
  l.attrs = attrs;
  l.invalidate();
}
export function layoutSetFontDescription(l: Layout, f: FontDescription | null): void {
  l.font = f ? f.copy() : new FontDescription();
  l.invalidate();
}
export function layoutSetWidth(l: Layout, w: number): void {
  l.width = w;
  l.invalidate();
}
export function layoutGetWidth(l: Layout): number {
  return l.width;
}
export function layoutSetHeight(l: Layout, h: number): void {
  l.height = h;
  l.invalidate();
}
export function layoutSetWrap(l: Layout, w: WrapMode): void {
  l.wrap = w;
  l.invalidate();
}
export function layoutSetAlignment(l: Layout, a: Alignment): void {
  l.alignment = a;
  l.invalidate();
}
export function layoutSetEllipsize(l: Layout, e: EllipsizeMode): void {
  l.ellipsize = e;
  l.invalidate();
}
export function layoutSetIndent(l: Layout, i: number): void {
  l.indent = i;
  l.invalidate();
}
export function layoutSetSpacing(l: Layout, s: number): void {
  l.spacing = s;
  l.invalidate();
}
export function layoutSetJustify(l: Layout, j: boolean): void {
  l.justify = j;
  l.invalidate();
}
export function layoutSetSingleParagraphMode(l: Layout, b: boolean): void {
  l.singleParagraph = b;
  l.invalidate();
}
export function layoutSetAttributes(l: Layout, a: AttrList | null): void {
  l.attrs = a ? a.copy() : null;
  l.invalidate();
}
export function layoutGetLineCount(l: Layout): number {
  return l.lines().length;
}
/** Returns (inkRect, logicalRect) in Pango units. */
export function layoutGetExtents(l: Layout): [Rectangle, Rectangle] {
  const r = l.logicalPx();
  const logical = { x: unitsFromDouble(r.x), y: 0, width: unitsFromDouble(r.width), height: unitsFromDouble(r.height) };
  // Ink extents: the glyph boxes, approximated by the logical box without the line gaps.
  const ls = l.lines();
  let inkTop = 0, inkBottom = r.height;
  if (ls.length > 0) {
    const ctx = textMeasurer();
    const first = ls[0], last = ls[ls.length - 1];
    if (first.runs.length > 0) {
      ctx.font = first.runs[0].font;
      const tm = ctx.measureText(first.runs.map((x) => x.text).join(""));
      if (tm.actualBoundingBoxAscent !== undefined) inkTop = Math.max(0, first.ascent - tm.actualBoundingBoxAscent);
    }
    if (last.runs.length > 0) {
      ctx.font = last.runs[0].font;
      const tm = ctx.measureText(last.runs.map((x) => x.text).join(""));
      if (tm.actualBoundingBoxDescent !== undefined) inkBottom = r.height - Math.max(0, last.descent - tm.actualBoundingBoxDescent);
    }
  }
  const ink = { x: logical.x, y: unitsFromDouble(inkTop), width: logical.width, height: unitsFromDouble(Math.max(0, inkBottom - inkTop)) };
  return [ink, logical];
}
export function layoutGetPixelExtents(l: Layout): [Rectangle, Rectangle] {
  const [ink, logical] = layoutGetExtents(l);
  const px = (r: Rectangle) => ({ x: Math.floor(r.x / SCALE), y: Math.floor(r.y / SCALE), width: Math.ceil(r.width / SCALE), height: Math.ceil(r.height / SCALE) });
  return [px(ink), px(logical)];
}
/** (width, height) in Pango units. */
export function layoutGetSize(l: Layout): [number, number] {
  const r = l.logicalPx();
  return [unitsFromDouble(r.width), unitsFromDouble(r.height)];
}
export function layoutGetPixelSize(l: Layout): [number, number] {
  const r = l.logicalPx();
  return [Math.ceil(r.width), Math.ceil(r.height)];
}
/** (inside, byteIndex, trailing) for a position in Pango units. */
export function layoutXyToIndex(l: Layout, x: number, y: number): [boolean, number, number] {
  const px = x / SCALE, py = y / SCALE;
  const ls = l.lines();
  let top = 0;
  const enc = new TextEncoder();
  for (const line of ls) {
    const h = line.ascent + line.descent;
    if (py < top + h || line === ls[ls.length - 1]) {
      let cx = line.x;
      for (const r of line.runs) {
        for (let k = 0; k < r.text.length; k++) {
          const cw = measure(r.font, r.text[k]);
          if (px < cx + cw) {
            const idx = r.start + k;
            return [py >= top && py < top + h, enc.encode(l.text.slice(0, idx)).length, px > cx + cw / 2 ? 1 : 0];
          }
          cx += cw;
        }
      }
      return [false, enc.encode(l.text.slice(0, line.end)).length, 0];
    }
    top += h + l.spacing / SCALE;
  }
  return [false, 0, 0];
}

/** `PangoCairo.showLayout cr layout`: draw with the top left of the layout at the current point. */
export function showLayout(cr: Context, l: Layout): void {
  const [x0, y0] = cr.currentPoint() ?? [0, 0];
  const t = cr.target;
  const src = t.fillStyle;
  t.save();
  t.textBaseline = "alphabetic";
  t.textAlign = "left";
  let y = y0;
  for (const line of l.lines()) {
    let x = x0 + line.x;
    const base = y + line.ascent;
    for (const r of line.runs) {
      if (r.bg) {
        t.fillStyle = r.bg;
        t.fillRect(x, y, r.width, line.ascent + line.descent);
      }
      t.font = r.font;
      t.fillStyle = r.fg ?? src;
      t.fillText(r.text, x, base);
      if (r.underline) t.fillRect(x, base + 1, r.width, 1);
      x += r.width;
    }
    y += line.ascent + line.descent + l.spacing / SCALE;
  }
  t.restore();
}
/** `PangoCairo.updateLayout`: no-op (layouts are resolution independent here). */
export function updateLayout(_cr: Context, _l: Layout): void {}
