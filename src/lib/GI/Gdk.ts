/**
 * Browser replacement for the parts of GDK (`GI.Gdk`, `GI.GdkPixbuf`) used by HADES: input
 * events, modifier masks, key values, RGBA colours, pixbufs (images), cursors and drag contexts.
 *
 * Events are plain objects carrying the GDK fields, created from DOM events by the widget
 * toolkit. Accessors keep their gi-gdk names (`getEventButtonX` etc.).
 */

// ---------------------------------------------------------------------------------------------
// Modifiers

export type ModifierType =
  | "ModifierTypeShiftMask"
  | "ModifierTypeLockMask"
  | "ModifierTypeControlMask"
  | "ModifierTypeMod1Mask"
  | "ModifierTypeButton1Mask"
  | "ModifierTypeButton2Mask"
  | "ModifierTypeButton3Mask"
  | "ModifierTypeSuperMask"
  | "ModifierTypeMetaMask";

export const ModifierTypeShiftMask: ModifierType = "ModifierTypeShiftMask";
export const ModifierTypeControlMask: ModifierType = "ModifierTypeControlMask";
export const ModifierTypeMod1Mask: ModifierType = "ModifierTypeMod1Mask";
export const ModifierTypeButton1Mask: ModifierType = "ModifierTypeButton1Mask";
export const ModifierTypeButton2Mask: ModifierType = "ModifierTypeButton2Mask";
export const ModifierTypeButton3Mask: ModifierType = "ModifierTypeButton3Mask";

/** Modifier list from a DOM mouse/keyboard event. On macOS the Command key acts as Control. */
export function modifiersOf(e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; buttons?: number }): ModifierType[] {
  const r: ModifierType[] = [];
  if (e.shiftKey) r.push("ModifierTypeShiftMask");
  if (e.ctrlKey || e.metaKey) r.push("ModifierTypeControlMask");
  if (e.altKey) r.push("ModifierTypeMod1Mask");
  if (e.buttons !== undefined) {
    if (e.buttons & 1) r.push("ModifierTypeButton1Mask");
    if (e.buttons & 4) r.push("ModifierTypeButton2Mask");
    if (e.buttons & 2) r.push("ModifierTypeButton3Mask");
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Events

export type EventType =
  | "EventTypeButtonPress"
  | "EventType2buttonPress"
  | "EventType3buttonPress"
  | "EventTypeButtonRelease"
  | "EventTypeMotionNotify"
  | "EventTypeScroll"
  | "EventTypeKeyPress"
  | "EventTypeKeyRelease";

export const EventTypeButtonPress: EventType = "EventTypeButtonPress";
export const EventType2buttonPress: EventType = "EventType2buttonPress";
export const EventType3buttonPress: EventType = "EventType3buttonPress";
export const EventTypeButtonRelease: EventType = "EventTypeButtonRelease";

export interface EventButton {
  readonly type: EventType;
  /** 1 = left, 2 = middle, 3 = right (GDK numbering). */
  readonly button: number;
  /** Widget-relative coordinates. */
  readonly x: number;
  readonly y: number;
  readonly xRoot: number;
  readonly yRoot: number;
  readonly state: ModifierType[];
  readonly time: number;
  /** The originating DOM event, if any. */
  readonly dom?: MouseEvent;
}
export function getEventButtonButton(e: EventButton): number { return e.button; }
export function getEventButtonX(e: EventButton): number { return e.x; }
export function getEventButtonY(e: EventButton): number { return e.y; }
export function getEventButtonType(e: EventButton): EventType { return e.type; }
export function getEventButtonState(e: EventButton): ModifierType[] { return e.state; }
export function getEventButtonTime(e: EventButton): number { return e.time; }
export function getEventButtonXRoot(e: EventButton): number { return e.xRoot; }
export function getEventButtonYRoot(e: EventButton): number { return e.yRoot; }

export interface EventMotion {
  readonly x: number;
  readonly y: number;
  readonly state: ModifierType[];
  readonly time: number;
}
export function getEventMotionX(e: EventMotion): number { return e.x; }
export function getEventMotionY(e: EventMotion): number { return e.y; }
export function getEventMotionState(e: EventMotion): ModifierType[] { return e.state; }

export type ScrollDirection =
  | "ScrollDirectionUp" | "ScrollDirectionDown" | "ScrollDirectionLeft" | "ScrollDirectionRight" | "ScrollDirectionSmooth";
export const ScrollDirectionUp: ScrollDirection = "ScrollDirectionUp";
export const ScrollDirectionDown: ScrollDirection = "ScrollDirectionDown";
export const ScrollDirectionLeft: ScrollDirection = "ScrollDirectionLeft";
export const ScrollDirectionRight: ScrollDirection = "ScrollDirectionRight";
export const ScrollDirectionSmooth: ScrollDirection = "ScrollDirectionSmooth";

export interface EventScroll {
  readonly direction: ScrollDirection;
  readonly x: number;
  readonly y: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly state: ModifierType[];
  readonly time: number;
}
export function getEventScrollDirection(e: EventScroll): ScrollDirection { return e.direction; }
export function getEventScrollDeltaX(e: EventScroll): number { return e.deltaX; }
export function getEventScrollDeltaY(e: EventScroll): number { return e.deltaY; }
export function getEventScrollState(e: EventScroll): ModifierType[] { return e.state; }
export function getEventScrollX(e: EventScroll): number { return e.x; }
export function getEventScrollY(e: EventScroll): number { return e.y; }

export interface EventKey {
  /** GDK key value. */
  readonly keyval: number;
  /** DOM `KeyboardEvent.key`. */
  readonly key: string;
  readonly state: ModifierType[];
  readonly time: number;
  readonly dom?: KeyboardEvent;
}
export function getEventKeyKeyval(e: EventKey): number { return e.keyval; }
export function getEventKeyState(e: EventKey): ModifierType[] { return e.state; }
export function getEventKeyString(e: EventKey): string { return e.key.length === 1 ? e.key : ""; }

/** Union of the event structures passed to `event` signal handlers. */
export type Event = EventButton | EventMotion | EventScroll | EventKey;

export interface EventFocus {
  readonly in_: boolean;
}

// ---------------------------------------------------------------------------------------------
// Key values (a subset of gdkkeysyms.h)

export const KEY_BackSpace = 0xff08;
export const KEY_Tab = 0xff09;
export const KEY_Return = 0xff0d;
export const KEY_Escape = 0xff1b;
export const KEY_Delete = 0xffff;
export const KEY_Home = 0xff50;
export const KEY_Left = 0xff51;
export const KEY_Up = 0xff52;
export const KEY_Right = 0xff53;
export const KEY_Down = 0xff54;
export const KEY_Page_Up = 0xff55;
export const KEY_Page_Down = 0xff56;
export const KEY_End = 0xff57;
export const KEY_Insert = 0xff63;
export const KEY_F1 = 0xffbe;
export const KEY_F2 = 0xffbf;
export const KEY_F10 = 0xffc7;
export const KEY_Shift_L = 0xffe1;
export const KEY_Control_L = 0xffe3;
export const KEY_Alt_L = 0xffe9;

const domKeyToKeyval: Record<string, number> = {
  Backspace: KEY_BackSpace, Tab: KEY_Tab, Enter: KEY_Return, Escape: KEY_Escape, Delete: KEY_Delete,
  Home: KEY_Home, ArrowLeft: KEY_Left, ArrowUp: KEY_Up, ArrowRight: KEY_Right, ArrowDown: KEY_Down,
  PageUp: KEY_Page_Up, PageDown: KEY_Page_Down, End: KEY_End, Insert: KEY_Insert, F1: KEY_F1, F2: KEY_F2,
  F10: KEY_F10, Shift: KEY_Shift_L, Control: KEY_Control_L, Alt: KEY_Alt_L,
};

/** Convert a DOM key name to a GDK keyval. Printable characters map to their Unicode keyval. */
export function keyvalFromDomKey(key: string): number {
  if (key in domKeyToKeyval) return domKeyToKeyval[key];
  if (Array.from(key).length === 1) {
    const cp = key.codePointAt(0)!;
    return cp < 0x100 ? cp : 0x01000000 | cp;
  }
  return 0xffffff;
}

/** `keyvalToUnicode`: 0 if the keyval has no Unicode equivalent. */
export function keyvalToUnicode(kv: number): number {
  if (kv >= 0x20 && kv < 0x100) return kv;
  if ((kv & 0xff000000) === 0x01000000) return kv & 0x00ffffff;
  if (kv === KEY_Return) return 13;
  if (kv === KEY_Tab) return 9;
  if (kv === KEY_BackSpace) return 8;
  if (kv === KEY_Escape) return 27;
  if (kv === KEY_Delete) return 127;
  return 0;
}

export function keyvalName(kv: number): string {
  for (const [k, v] of Object.entries(domKeyToKeyval)) if (v === kv) return k;
  const u = keyvalToUnicode(kv);
  return u ? String.fromCodePoint(u) : "VoidSymbol";
}

export function eventKeyFromDom(e: KeyboardEvent): EventKey {
  return { keyval: keyvalFromDomKey(e.key), key: e.key, state: modifiersOf(e), time: e.timeStamp, dom: e };
}

// ---------------------------------------------------------------------------------------------
// RGBA

export interface RGBA {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}
export function newZeroRGBA(): RGBA {
  return { red: 0, green: 0, blue: 0, alpha: 1 };
}
export function getRGBARed(c: RGBA): number { return c.red; }
export function getRGBAGreen(c: RGBA): number { return c.green; }
export function getRGBABlue(c: RGBA): number { return c.blue; }
export function getRGBAAlpha(c: RGBA): number { return c.alpha; }
export function setRGBARed(c: RGBA, v: number): void { c.red = v; }
export function setRGBAGreen(c: RGBA, v: number): void { c.green = v; }
export function setRGBABlue(c: RGBA, v: number): void { c.blue = v; }
export function setRGBAAlpha(c: RGBA, v: number): void { c.alpha = v; }
export function rgbaToCss(c: RGBA): string {
  const f = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${f(c.red)}, ${f(c.green)}, ${f(c.blue)}, ${c.alpha})`;
}

// ---------------------------------------------------------------------------------------------
// Rectangle

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function newZeroRectangle(): Rectangle {
  return { x: 0, y: 0, width: 0, height: 0 };
}
export function getRectangleX(r: Rectangle): number { return r.x; }
export function getRectangleY(r: Rectangle): number { return r.y; }
export function getRectangleWidth(r: Rectangle): number { return r.width; }
export function getRectangleHeight(r: Rectangle): number { return r.height; }
export function setRectangleX(r: Rectangle, v: number): void { r.x = v; }
export function setRectangleY(r: Rectangle, v: number): void { r.y = v; }
export function setRectangleWidth(r: Rectangle, v: number): void { r.width = v; }
export function setRectangleHeight(r: Rectangle, v: number): void { r.height = v; }

// ---------------------------------------------------------------------------------------------
// Pixbuf

/**
 * An image. In the browser images load asynchronously; a Pixbuf holds the URL and, once
 * loaded, the decoded image. Code that draws pixbufs onto a canvas should call
 * `onImagesLoaded` to repaint when pending images arrive.
 */
export class Pixbuf {
  image: HTMLImageElement | null = null;
  loaded = false;
  failed = false;
  constructor(readonly url: string, public width: number, public height: number) {}
}

const pixbufCache = new Map<string, Pixbuf>();
const loadListeners = new Set<() => void>();
let loadNotifyScheduled = false;

/** Register a callback run (batched) whenever a pending image finishes loading. */
export function onImagesLoaded(cb: () => void): () => void {
  loadListeners.add(cb);
  return () => loadListeners.delete(cb);
}

function notifyLoaded(): void {
  if (loadNotifyScheduled) return;
  loadNotifyScheduled = true;
  requestAnimationFrame(() => {
    loadNotifyScheduled = false;
    for (const cb of Array.from(loadListeners)) {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    }
  });
}

/** Load (or fetch from the cache) a pixbuf at the given size. */
export function pixbufNewFromUrlAtSize(url: string, width: number, height: number): Pixbuf {
  const key = `${url}@${width}x${height}`;
  const cached = pixbufCache.get(key);
  if (cached) return cached;
  const pb = new Pixbuf(url, width, height);
  pixbufCache.set(key, pb);
  if (typeof Image !== "undefined") {
    const img = new Image(width > 0 ? width : undefined, height > 0 ? height : undefined);
    img.decoding = "async";
    img.onload = () => {
      pb.image = img;
      pb.loaded = true;
      if (pb.width <= 0) pb.width = img.naturalWidth;
      if (pb.height <= 0) pb.height = img.naturalHeight;
      notifyLoaded();
    };
    img.onerror = () => {
      pb.failed = true;
      notifyLoaded();
    };
    img.src = url;
  }
  return pb;
}
export function pixbufNewFromFile(url: string): Pixbuf {
  return pixbufNewFromUrlAtSize(url, -1, -1);
}

/** A pixbuf from raw image bytes (e.g. an image stored in the model). */
export function pixbufNewFromBytes(bytes: Uint8Array, mime = "image/png"): Pixbuf {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  return pixbufNewFromUrlAtSize(url, -1, -1);
}
export const pixbufNewFromStream = pixbufNewFromBytes;

export function pixbufGetWidth(p: Pixbuf): number { return p.width; }
export function pixbufGetHeight(p: Pixbuf): number { return p.height; }
export function pixbufScaleSimple(p: Pixbuf, w: number, h: number): Pixbuf {
  return pixbufNewFromUrlAtSize(p.url, w, h);
}

/** Wait until a pixbuf has loaded (or failed). */
export function pixbufReady(p: Pixbuf): Promise<Pixbuf> {
  if (p.loaded || p.failed || typeof Image === "undefined") return Promise.resolve(p);
  return new Promise((resolve) => {
    const stop = onImagesLoaded(() => {
      if (p.loaded || p.failed) {
        stop();
        resolve(p);
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Cursors

export type CursorType = "CursorTypeWatch" | "CursorTypeArrow" | "CursorTypeHand1" | "CursorTypeCrosshair";
export const CursorTypeWatch: CursorType = "CursorTypeWatch";
export const CursorTypeArrow: CursorType = "CursorTypeArrow";

export interface Cursor {
  readonly css: string;
}
export function cursorNewForDisplay(_display: unknown, t: CursorType): Cursor {
  const css = t === "CursorTypeWatch" ? "wait" : t === "CursorTypeHand1" ? "pointer" : t === "CursorTypeCrosshair" ? "crosshair" : "default";
  return { css };
}

let cursorDepth = 0;
/** `windowSetCursor`: in the browser the cursor applies to the whole document. */
export function windowSetCursor(_win: unknown, c: Cursor | null): void {
  if (c && c.css === "wait") cursorDepth++;
  else cursorDepth = Math.max(0, cursorDepth - 1);
  document.documentElement.style.cursor = cursorDepth > 0 ? "wait" : "";
}

// ---------------------------------------------------------------------------------------------
// Drag and drop

export type DragAction = "DragActionCopy" | "DragActionMove" | "DragActionLink";
export const DragActionCopy: DragAction = "DragActionCopy";
export const DragActionMove: DragAction = "DragActionMove";

/** Drag context passed to drag-and-drop signal handlers. */
export class DragContext {
  finished = false;
  success = false;
  constructor(readonly targets: string[], readonly dom?: DragEvent) {}
}
export function dragContextListTargets(ctx: DragContext): string[] {
  return ctx.targets;
}
export function atomName(a: string): string {
  return a;
}
export function dragStatus(_ctx: DragContext, _action: DragAction | null, _time: number): void {}
