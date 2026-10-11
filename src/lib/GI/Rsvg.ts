/**
 * Browser replacement for `GI.Rsvg` (librsvg): SVG documents that can be drawn on a Cairo
 * context.
 *
 * A `Handle` keeps the SVG text. Its intrinsic dimensions (`width`/`height` attributes of the
 * root `<svg>` element, with their units, and the `viewBox`) are parsed synchronously, as
 * librsvg does. Drawing uses the browser's SVG renderer: the document is loaded as an image
 * (through a `Gdk.Pixbuf`, so `Gdk.onImagesLoaded` reports when it is ready) and drawn into the
 * viewport with `drawImage`. Until the image has loaded nothing is drawn.
 *
 * Gio streams are byte arrays in this toolkit (`Gdk.pixbufNewFromStream` likewise), so
 * `handleNewFromStreamSync` takes the SVG bytes.
 */
import type { Context } from "./Cairo";
import { type Pixbuf, pixbufNewFromBytes } from "./Gdk";

export type Unit =
  | "UnitPercent" | "UnitPx" | "UnitEm" | "UnitEx" | "UnitIn" | "UnitCm" | "UnitMm" | "UnitPt" | "UnitPc";
export const UnitPercent: Unit = "UnitPercent";
export const UnitPx: Unit = "UnitPx";
export const UnitEm: Unit = "UnitEm";
export const UnitEx: Unit = "UnitEx";
export const UnitIn: Unit = "UnitIn";
export const UnitCm: Unit = "UnitCm";
export const UnitMm: Unit = "UnitMm";
export const UnitPt: Unit = "UnitPt";
export const UnitPc: Unit = "UnitPc";

/** `RsvgLength`. Percentages are fractions, as in librsvg (`"50%"` has length 0.5). */
export interface Length {
  readonly length: number;
  readonly unit: Unit;
}
export function getLengthLength(l: Length): number {
  return l.length;
}
export function getLengthUnit(l: Length): Unit {
  return l.unit;
}

/** `RsvgRectangle`. `GI.new SVG.Rectangle [#width := w, ...]` → `rectangleNew({ width: w, ... })`. */
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function rectangleNew(props: Partial<Rectangle> = {}): Rectangle {
  return { x: 0, y: 0, width: 0, height: 0, ...props };
}

export type HandleFlags = "HandleFlagsFlagsNone" | "HandleFlagsFlagUnlimited" | "HandleFlagsFlagKeepImageData";
export const HandleFlagsFlagsNone: HandleFlags = "HandleFlagsFlagsNone";
export const HandleFlagsFlagUnlimited: HandleFlags = "HandleFlagsFlagUnlimited";
export const HandleFlagsFlagKeepImageData: HandleFlags = "HandleFlagsFlagKeepImageData";

/** A loaded SVG document. */
export class Handle {
  dpi = 90;
  private pixbuf: Pixbuf | null = null;
  constructor(
    /** The SVG source text. */
    readonly text: string,
    readonly width: Length | null,
    readonly height: Length | null,
    readonly viewBox: Rectangle | null,
  ) {}
  /** The document as a (lazily loaded) image. */
  image(): Pixbuf | null {
    if (!this.pixbuf && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      this.pixbuf = pixbufNewFromBytes(new TextEncoder().encode(this.text), "image/svg+xml");
    }
    return this.pixbuf;
  }
}

/** Thrown where librsvg reports a `GError`. */
export class RsvgError extends Error {}

const unitOf: Record<string, Unit> = {
  "": "UnitPx", px: "UnitPx", em: "UnitEm", ex: "UnitEx", in: "UnitIn", cm: "UnitCm",
  mm: "UnitMm", pt: "UnitPt", pc: "UnitPc", "%": "UnitPercent",
};

function parseLength(s: string | null): Length | null {
  if (s === null) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|em|ex|in|cm|mm|pt|pc|%)?\s*$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = unitOf[m[2] ?? ""];
  return { length: unit === "UnitPercent" ? n / 100 : n, unit };
}

function parseViewBox(s: string | null): Rectangle | null {
  if (s === null) return null;
  const ns = s.trim().split(/[\s,]+/).map(Number);
  if (ns.length !== 4 || ns.some((n) => !Number.isFinite(n))) return null;
  return { x: ns[0], y: ns[1], width: ns[2], height: ns[3] };
}

/** `rsvg_handle_new_from_data`: parse an SVG document. Throws `RsvgError` if it is not SVG. */
export function handleNewFromData(data: Uint8Array | string): Handle {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  if (typeof DOMParser === "undefined") throw new RsvgError("No XML parser available.");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || doc.getElementsByTagName("parsererror").length > 0 || root.localName !== "svg") {
    throw new RsvgError("Cannot parse SVG document.");
  }
  return new Handle(text, parseLength(root.getAttribute("width")), parseLength(root.getAttribute("height")), parseViewBox(root.getAttribute("viewBox")));
}

/**
 * `handleNewFromStreamSync stream baseFile flags cancellable`. The stream is the SVG bytes.
 * Throws `RsvgError` (a `GError` in gi-rsvg) if the data is not an SVG document.
 */
export function handleNewFromStreamSync(
  stream: Uint8Array,
  _baseFile: unknown | null,
  _flags: readonly HandleFlags[],
  _cancellable: unknown | null,
): Handle | null {
  return handleNewFromData(stream);
}

export function handleSetDpi(h: Handle, dpi: number): void {
  h.dpi = dpi;
}

/**
 * `handleGetIntrinsicDimensions h` = `(hasWidth, width, hasHeight, height, hasViewbox, viewbox)`.
 * A missing width or height is reported as 100%, as librsvg does.
 */
export function handleGetIntrinsicDimensions(h: Handle): [boolean, Length, boolean, Length, boolean, Rectangle] {
  const full: Length = { length: 1, unit: "UnitPercent" };
  return [
    h.width !== null, h.width ?? full,
    h.height !== null, h.height ?? full,
    h.viewBox !== null, h.viewBox ?? rectangleNew(),
  ];
}

/** `handleRenderDocument h cr viewport`: draw the whole document scaled into the viewport. */
export function handleRenderDocument(h: Handle, cr: Context, viewport: Rectangle): void {
  const pb = h.image();
  if (!pb || !pb.loaded || !pb.image) return;
  cr.target.drawImage(pb.image, viewport.x, viewport.y, viewport.width, viewport.height);
}
