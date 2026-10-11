/**
 * Core of the web replacement for GTK 3 (`GI.Gtk`): objects with signals, the widget base
 * class, containers, and the registry of toplevel windows.
 *
 * Design
 * ------
 * Widgets are retained objects with an imperative API mirroring gi-gtk (`boxNew`,
 * `boxPackStart`, `entrySetText`, `onButtonClicked`, ...), so that GTK code ports
 * mechanically. Each widget notifies subscribers when it changes; the React renderer
 * (`Render.tsx`) subscribes and re-renders that widget, using Radix UI primitives for menus,
 * dialogs, popovers, tabs, selects, checkboxes, radio buttons, sliders, toolbars and tooltips.
 *
 * Conventions
 * -----------
 * * gi-gtk functions keep their names and argument order: `Gtk.boxPackStart(box, child, expand, fill, padding)`.
 * * Nullable GTK arguments take `T | null` (Haskell `Maybe` arguments to gi-gtk functions:
 *   `Gtk.labelNew Nothing` → `Gtk.labelNew(null)`).
 * * Signal connection functions (`onXxx`, `afterXxx`) return a `SignalHandlerId`.
 * * Event signal handlers return `true` to stop further handling, as in GTK.
 * * Functions that block in GTK (`dialogRun`, `nativeDialogRun`) return Promises.
 */

export type SignalHandlerId = number;

let nextHandlerId = 1;
let nextObjectId = 1;

interface Handler {
  readonly id: number;
  readonly fn: (...args: any[]) => any;
  readonly after: boolean;
}

/** Base class with GObject-style signals. */
export class GObject {
  readonly objectId = nextObjectId++;
  private handlers = new Map<string, Handler[]>();
  private blocked = new Set<number>();

  connect(signal: string, fn: (...args: any[]) => any, after = false): SignalHandlerId {
    const id = nextHandlerId++;
    const list = this.handlers.get(signal) ?? [];
    list.push({ id, fn, after });
    this.handlers.set(signal, list);
    return id;
  }

  disconnect(id: SignalHandlerId): void {
    for (const [k, list] of this.handlers) {
      const nl = list.filter((h) => h.id !== id);
      if (nl.length !== list.length) this.handlers.set(k, nl);
    }
  }

  blockHandler(id: SignalHandlerId): void {
    this.blocked.add(id);
  }
  unblockHandler(id: SignalHandlerId): void {
    this.blocked.delete(id);
  }

  hasHandlers(signal: string): boolean {
    return (this.handlers.get(signal)?.length ?? 0) > 0;
  }

  /**
   * Emit a signal. Handlers connected with `on` run before those connected with `after`.
   * For signals whose handlers return booleans ("event" signals), emission stops at the
   * first handler returning `true`, and the result is `true`. Otherwise the last handler's
   * result is returned.
   */
  emit(signal: string, ...args: any[]): any {
    const list = this.handlers.get(signal);
    if (!list || list.length === 0) return undefined;
    const ordered = [...list.filter((h) => !h.after), ...list.filter((h) => h.after)];
    let result: any = undefined;
    for (const h of ordered) {
      if (this.blocked.has(h.id)) continue;
      try {
        result = h.fn(...args);
      } catch (err) {
        console.error(`Error in "${signal}" handler:`, err);
        continue;
      }
      if (result === true && isEventSignal(signal)) return true;
    }
    return result;
  }
}

function isEventSignal(signal: string): boolean {
  return signal.endsWith("-event") || signal === "drag-motion" || signal === "drag-drop" || signal === "draw";
}

/** `signalHandlerDisconnect` */
export function signalHandlerDisconnect(obj: GObject, id: SignalHandlerId): void {
  obj.disconnect(id);
}
export function signalHandlerBlock(obj: GObject, id: SignalHandlerId): void {
  obj.blockHandler(id);
}
export function signalHandlerUnblock(obj: GObject, id: SignalHandlerId): void {
  obj.unblockHandler(id);
}

// ---------------------------------------------------------------------------------------------
// Enumerations

export type Orientation = "OrientationHorizontal" | "OrientationVertical";
export const OrientationHorizontal: Orientation = "OrientationHorizontal";
export const OrientationVertical: Orientation = "OrientationVertical";

export type Align = "AlignFill" | "AlignStart" | "AlignEnd" | "AlignCenter" | "AlignBaseline";
export const AlignFill: Align = "AlignFill";
export const AlignStart: Align = "AlignStart";
export const AlignEnd: Align = "AlignEnd";
export const AlignCenter: Align = "AlignCenter";
export const AlignBaseline: Align = "AlignBaseline";

export type PackType = "PackTypeStart" | "PackTypeEnd";
export const PackTypeStart: PackType = "PackTypeStart";
export const PackTypeEnd: PackType = "PackTypeEnd";

export type PolicyType = "PolicyTypeAlways" | "PolicyTypeAutomatic" | "PolicyTypeNever" | "PolicyTypeExternal";
export const PolicyTypeAlways: PolicyType = "PolicyTypeAlways";
export const PolicyTypeAutomatic: PolicyType = "PolicyTypeAutomatic";
export const PolicyTypeNever: PolicyType = "PolicyTypeNever";
export const PolicyTypeExternal: PolicyType = "PolicyTypeExternal";

export type ShadowType = "ShadowTypeNone" | "ShadowTypeIn" | "ShadowTypeOut" | "ShadowTypeEtchedIn" | "ShadowTypeEtchedOut";
export const ShadowTypeNone: ShadowType = "ShadowTypeNone";
export const ShadowTypeIn: ShadowType = "ShadowTypeIn";
export const ShadowTypeOut: ShadowType = "ShadowTypeOut";
export const ShadowTypeEtchedIn: ShadowType = "ShadowTypeEtchedIn";
export const ShadowTypeEtchedOut: ShadowType = "ShadowTypeEtchedOut";

export type Justification = "JustificationLeft" | "JustificationRight" | "JustificationCenter" | "JustificationFill";
export const JustificationLeft: Justification = "JustificationLeft";
export const JustificationRight: Justification = "JustificationRight";
export const JustificationCenter: Justification = "JustificationCenter";
export const JustificationFill: Justification = "JustificationFill";

export type WrapMode = "WrapModeNone" | "WrapModeChar" | "WrapModeWord" | "WrapModeWordChar";
export const WrapModeNone: WrapMode = "WrapModeNone";
export const WrapModeChar: WrapMode = "WrapModeChar";
export const WrapModeWord: WrapMode = "WrapModeWord";
export const WrapModeWordChar: WrapMode = "WrapModeWordChar";

export type ReliefStyle = "ReliefStyleNormal" | "ReliefStyleNone";
export const ReliefStyleNormal: ReliefStyle = "ReliefStyleNormal";
export const ReliefStyleNone: ReliefStyle = "ReliefStyleNone";

export type IconSize =
  | "IconSizeInvalid" | "IconSizeMenu" | "IconSizeSmallToolbar" | "IconSizeLargeToolbar"
  | "IconSizeButton" | "IconSizeDnd" | "IconSizeDialog";
export const IconSizeMenu: IconSize = "IconSizeMenu";
export const IconSizeSmallToolbar: IconSize = "IconSizeSmallToolbar";
export const IconSizeLargeToolbar: IconSize = "IconSizeLargeToolbar";
export const IconSizeButton: IconSize = "IconSizeButton";
export const IconSizeDnd: IconSize = "IconSizeDnd";
export const IconSizeDialog: IconSize = "IconSizeDialog";
export function iconSizePixels(s: IconSize | number): number {
  if (typeof s === "number") {
    return [16, 16, 16, 24, 16, 32, 48][s] ?? 16;
  }
  switch (s) {
    case "IconSizeMenu": case "IconSizeSmallToolbar": case "IconSizeButton": return 16;
    case "IconSizeLargeToolbar": return 24;
    case "IconSizeDnd": return 32;
    case "IconSizeDialog": return 48;
    default: return 16;
  }
}

export type ButtonBoxStyle = "ButtonBoxStyleSpread" | "ButtonBoxStyleEdge" | "ButtonBoxStyleStart" | "ButtonBoxStyleEnd" | "ButtonBoxStyleCenter" | "ButtonBoxStyleExpand";
export const ButtonBoxStyleCenter: ButtonBoxStyle = "ButtonBoxStyleCenter";
export const ButtonBoxStyleEnd: ButtonBoxStyle = "ButtonBoxStyleEnd";
export const ButtonBoxStyleStart: ButtonBoxStyle = "ButtonBoxStyleStart";
export const ButtonBoxStyleSpread: ButtonBoxStyle = "ButtonBoxStyleSpread";
export const ButtonBoxStyleEdge: ButtonBoxStyle = "ButtonBoxStyleEdge";
export const ButtonBoxStyleExpand: ButtonBoxStyle = "ButtonBoxStyleExpand";

/** Dialog response codes, with GTK's numeric values. */
export type ResponseType = number;
export const ResponseTypeNone = -1;
export const ResponseTypeReject = -2;
export const ResponseTypeAccept = -3;
export const ResponseTypeDeleteEvent = -4;
export const ResponseTypeOk = -5;
export const ResponseTypeCancel = -6;
export const ResponseTypeClose = -7;
export const ResponseTypeYes = -8;
export const ResponseTypeNo = -9;
export const ResponseTypeApply = -10;
export const ResponseTypeHelp = -11;

export type WindowType = "WindowTypeToplevel" | "WindowTypePopup";
export const WindowTypeToplevel: WindowType = "WindowTypeToplevel";
export const WindowTypePopup: WindowType = "WindowTypePopup";

export type WindowPosition = "WindowPositionNone" | "WindowPositionCenter" | "WindowPositionMouse" | "WindowPositionCenterOnParent";
export const WindowPositionCenter: WindowPosition = "WindowPositionCenter";
export const WindowPositionCenterOnParent: WindowPosition = "WindowPositionCenterOnParent";

export type SelectionMode = "SelectionModeNone" | "SelectionModeSingle" | "SelectionModeBrowse" | "SelectionModeMultiple";
export const SelectionModeNone: SelectionMode = "SelectionModeNone";
export const SelectionModeSingle: SelectionMode = "SelectionModeSingle";
export const SelectionModeBrowse: SelectionMode = "SelectionModeBrowse";
export const SelectionModeMultiple: SelectionMode = "SelectionModeMultiple";

export type SortType = "SortTypeAscending" | "SortTypeDescending";
export const SortTypeAscending: SortType = "SortTypeAscending";
export const SortTypeDescending: SortType = "SortTypeDescending";

export type TreeViewGridLines = "TreeViewGridLinesNone" | "TreeViewGridLinesHorizontal" | "TreeViewGridLinesVertical" | "TreeViewGridLinesBoth";
export const TreeViewGridLinesNone: TreeViewGridLines = "TreeViewGridLinesNone";
export const TreeViewGridLinesHorizontal: TreeViewGridLines = "TreeViewGridLinesHorizontal";
export const TreeViewGridLinesVertical: TreeViewGridLines = "TreeViewGridLinesVertical";
export const TreeViewGridLinesBoth: TreeViewGridLines = "TreeViewGridLinesBoth";

export type TreeViewDropPosition =
  | "TreeViewDropPositionBefore" | "TreeViewDropPositionAfter"
  | "TreeViewDropPositionIntoOrBefore" | "TreeViewDropPositionIntoOrAfter";
export const TreeViewDropPositionBefore: TreeViewDropPosition = "TreeViewDropPositionBefore";
export const TreeViewDropPositionAfter: TreeViewDropPosition = "TreeViewDropPositionAfter";
export const TreeViewDropPositionIntoOrBefore: TreeViewDropPosition = "TreeViewDropPositionIntoOrBefore";
export const TreeViewDropPositionIntoOrAfter: TreeViewDropPosition = "TreeViewDropPositionIntoOrAfter";

export type MessageType = "MessageTypeInfo" | "MessageTypeWarning" | "MessageTypeQuestion" | "MessageTypeError" | "MessageTypeOther";
export const MessageTypeInfo: MessageType = "MessageTypeInfo";
export const MessageTypeWarning: MessageType = "MessageTypeWarning";
export const MessageTypeQuestion: MessageType = "MessageTypeQuestion";
export const MessageTypeError: MessageType = "MessageTypeError";
export const MessageTypeOther: MessageType = "MessageTypeOther";

export type ButtonsType = "ButtonsTypeNone" | "ButtonsTypeOk" | "ButtonsTypeClose" | "ButtonsTypeCancel" | "ButtonsTypeYesNo" | "ButtonsTypeOkCancel";
export const ButtonsTypeNone: ButtonsType = "ButtonsTypeNone";
export const ButtonsTypeOk: ButtonsType = "ButtonsTypeOk";
export const ButtonsTypeClose: ButtonsType = "ButtonsTypeClose";
export const ButtonsTypeCancel: ButtonsType = "ButtonsTypeCancel";
export const ButtonsTypeYesNo: ButtonsType = "ButtonsTypeYesNo";
export const ButtonsTypeOkCancel: ButtonsType = "ButtonsTypeOkCancel";

export type EllipsizeMode = "EllipsizeModeNone" | "EllipsizeModeStart" | "EllipsizeModeMiddle" | "EllipsizeModeEnd";

export type InputHints = "InputHintsNone" | "InputHintsSpellcheck" | "InputHintsNoSpellcheck";
export const InputHintsSpellcheck: InputHints = "InputHintsSpellcheck";

export type EntryIconPosition = "EntryIconPositionPrimary" | "EntryIconPositionSecondary";
export const EntryIconPositionPrimary: EntryIconPosition = "EntryIconPositionPrimary";
export const EntryIconPositionSecondary: EntryIconPosition = "EntryIconPositionSecondary";

export const STYLE_PROVIDER_PRIORITY_APPLICATION = 600;

// ---------------------------------------------------------------------------------------------
// Widgets

export interface Margins {
  top: number;
  bottom: number;
  start: number;
  end: number;
}

/** Per-child packing properties (GtkBox child properties). */
export interface Packing {
  expand: boolean;
  fill: boolean;
  padding: number;
  packType: PackType;
}

/**
 * Base class of all widgets. Subclasses declare a `kind` used by the renderer and call
 * `changed()` after mutating rendered state.
 */
export class Widget extends GObject {
  readonly kind: string = "widget";
  parent: Widget | null = null;
  /** Packing used by a parent Box. */
  packing: Packing = { expand: false, fill: true, padding: 0, packType: "PackTypeStart" };
  classes = new Set<string>();
  name = "";
  sensitive = true;
  visible = true;
  tooltip: string | null = null;
  widthRequest = -1;
  heightRequest = -1;
  hexpand = false;
  vexpand = false;
  hexpandSet = false;
  vexpandSet = false;
  halign: Align = "AlignFill";
  valign: Align = "AlignFill";
  margin: Margins = { top: 0, bottom: 0, start: 0, end: 0 };
  canFocus = false;
  focusOnClick = true;
  destroyed = false;
  /** Extra inline CSS, for widget-specific styling (not part of GTK). */
  style: Record<string, string | number> = {};
  /** The DOM element rendered for this widget, when mounted. */
  el: HTMLElement | null = null;
  /** Arbitrary data attached with `g_object_set_data`-like calls. */
  data = new Map<string, unknown>();
  private _version = 0;
  private subscribers = new Set<() => void>();
  private mapped = false;

  readonly subscribe = (cb: () => void): (() => void) => {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  };
  readonly getVersion = (): number => this._version;

  /** Notify the renderer that this widget must be re-rendered. */
  changed(): void {
    this._version++;
    for (const cb of Array.from(this.subscribers)) cb();
  }

  /** Children for rendering and destruction. Containers override this. */
  getChildren(): Widget[] {
    return [];
  }

  /** Remove a child (containers override). */
  removeChild(_w: Widget): void {}

  /** Called by the renderer when the element mounts or unmounts. */
  setElement(el: HTMLElement | null): void {
    this.el = el;
    if (el && !this.mapped) {
      this.mapped = true;
      queueMicrotask(() => {
        if (!this.destroyed) this.emit("map");
      });
    } else if (!el && this.mapped) {
      this.mapped = false;
      this.emit("unmap");
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of this.getChildren()) c.destroy();
    this.emit("destroy");
    if (this.parent) {
      const p = this.parent;
      this.parent = null;
      p.removeChild(this);
    }
    unregisterToplevel(this);
    this.changed();
  }

  toplevel(): Widget {
    let w: Widget = this;
    while (w.parent) w = w.parent;
    return w;
  }

  setProperty(name: string, value: unknown): void {
    switch (name) {
      case "name": this.name = value as string; break;
      case "sensitive": this.sensitive = value as boolean; break;
      case "visible": this.visible = value as boolean; break;
      case "tooltipText": this.tooltip = value as string | null; break;
      case "widthRequest": this.widthRequest = value as number; break;
      case "heightRequest": this.heightRequest = value as number; break;
      case "hexpand": this.hexpand = value as boolean; this.hexpandSet = true; break;
      case "vexpand": this.vexpand = value as boolean; this.vexpandSet = true; break;
      case "halign": this.halign = value as Align; break;
      case "valign": this.valign = value as Align; break;
      case "margin": this.margin = { top: value as number, bottom: value as number, start: value as number, end: value as number }; break;
      case "marginTop": this.margin = { ...this.margin, top: value as number }; break;
      case "marginBottom": this.margin = { ...this.margin, bottom: value as number }; break;
      case "marginStart": case "marginLeft": this.margin = { ...this.margin, start: value as number }; break;
      case "marginEnd": case "marginRight": this.margin = { ...this.margin, end: value as number }; break;
      case "canFocus": this.canFocus = value as boolean; break;
      default:
        console.warn(`Gtk: unknown property "${name}" on ${this.kind}`);
    }
    this.changed();
  }
}

/** A widget with any number of children. */
export class Container extends Widget {
  override readonly kind: string = "container";
  children: Widget[] = [];
  borderWidth = 0;

  override getChildren(): Widget[] {
    return this.children.slice();
  }

  add(w: Widget): void {
    if (w.parent) w.parent.removeChild(w);
    w.parent = this;
    this.children.push(w);
    this.changed();
  }

  override removeChild(w: Widget): void {
    const i = this.children.indexOf(w);
    if (i >= 0) {
      this.children.splice(i, 1);
      w.parent = null;
      this.changed();
    }
  }

  override setProperty(name: string, value: unknown): void {
    if (name === "borderWidth") {
      this.borderWidth = value as number;
      this.changed();
    } else super.setProperty(name, value);
  }
}

/** A container with at most one child. */
export class Bin extends Container {
  override readonly kind: string = "bin";
  override add(w: Widget): void {
    for (const c of this.children.slice()) this.removeChild(c);
    super.add(w);
  }
  child(): Widget | null {
    return this.children[0] ?? null;
  }
}

// ---------------------------------------------------------------------------------------------
// Toplevels

/** Registry of toplevel windows, dialogs and popups, rendered by `GtkRoot`. */
class ToplevelRegistry {
  private items: Widget[] = [];
  private version = 0;
  private subs = new Set<() => void>();
  readonly subscribe = (cb: () => void) => {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  };
  readonly getVersion = () => this.version;
  list(): Widget[] {
    return this.items;
  }
  add(w: Widget): void {
    if (!this.items.includes(w)) {
      this.items = [...this.items, w];
      this.bump();
    }
  }
  remove(w: Widget): void {
    if (this.items.includes(w)) {
      this.items = this.items.filter((x) => x !== w);
      this.bump();
    }
  }
  private bump(): void {
    this.version++;
    for (const cb of Array.from(this.subs)) cb();
  }
}

export const toplevels = new ToplevelRegistry();

export function registerToplevel(w: Widget): void {
  toplevels.add(w);
}
export function unregisterToplevel(w: Widget): void {
  toplevels.remove(w);
}

// ---------------------------------------------------------------------------------------------
// Generic widget functions

export function toWidget<W extends Widget>(w: W): Widget {
  return w;
}
/** `castTo`: dynamic downcast. */
export function castTo<W extends Widget>(cls: abstract new (...args: any[]) => W, w: GObject | null): W | null {
  return w instanceof cls ? w : null;
}
export function unsafeCastTo<W extends Widget>(cls: abstract new (...args: any[]) => W, w: GObject): W {
  if (w instanceof cls) return w;
  throw new Error(`unsafeCastTo: object is not a ${cls.name}`);
}

/** `Gtk.set w [#prop := v, ...]` with props as an object: `Gtk.set(w, { prop: v })`. */
export function set(w: GObject, props: Record<string, unknown>): void {
  const ww = w as any;
  for (const [k, v] of Object.entries(props)) {
    if (typeof ww.setProperty === "function") ww.setProperty(k, v);
    else ww[k] = v;
  }
}

/** `Gtk.new Cls [#prop := v]` → `Gtk.new_(Cls, { prop: v })`. */
export function new_<W extends GObject>(cls: new () => W, props: Record<string, unknown> = {}): W {
  const w = new cls();
  set(w, props);
  return w;
}

export function widgetDestroy(w: Widget): void {
  w.destroy();
}
export function onWidgetDestroy(w: Widget, cb: () => void): SignalHandlerId {
  return w.connect("destroy", cb);
}
export function widgetInDestruction(w: Widget): boolean {
  return w.destroyed;
}
/** `widgetShowAll`: widgets are visible by default; a toplevel (window, dialog) is shown. */
export function widgetShowAll(w: Widget): void {
  if (isToplevel(w)) widgetShow(w);
}
export function widgetShow(w: Widget): void {
  if (!w.visible) {
    w.visible = true;
    w.changed();
  }
  if (isToplevel(w)) registerToplevel(w);
}
export function widgetHide(w: Widget): void {
  if (w.visible) {
    w.visible = false;
    w.changed();
  }
}
export function widgetSetVisible(w: Widget, v: boolean): void {
  if (v) widgetShow(w);
  else widgetHide(w);
}
export function widgetGetVisible(w: Widget): boolean {
  return w.visible;
}
export function widgetSetSensitive(w: Widget, s: boolean): void {
  if (w.sensitive !== s) {
    w.sensitive = s;
    w.changed();
  }
}
export const setWidgetSensitive = widgetSetSensitive;
export function widgetGetSensitive(w: Widget): boolean {
  return w.sensitive;
}
export function widgetSetTooltipText(w: Widget, t: string | null): void {
  w.tooltip = t;
  w.changed();
}
export const setWidgetTooltipText = widgetSetTooltipText;
export function widgetSetName(w: Widget, n: string): void {
  w.name = n;
  w.changed();
}
export function widgetGetName(w: Widget): string {
  return w.name;
}
export function widgetSetSizeRequest(w: Widget, width: number, height: number): void {
  w.widthRequest = width;
  w.heightRequest = height;
  w.changed();
}
export function setWidgetWidthRequest(w: Widget, width: number): void {
  w.widthRequest = width;
  w.changed();
}
export function setWidgetHeightRequest(w: Widget, height: number): void {
  w.heightRequest = height;
  w.changed();
}
export function widgetSetHexpand(w: Widget, b: boolean): void {
  w.hexpand = b;
  w.hexpandSet = true;
  w.changed();
}
export function widgetSetVexpand(w: Widget, b: boolean): void {
  w.vexpand = b;
  w.vexpandSet = true;
  w.changed();
}
export function widgetSetHalign(w: Widget, a: Align): void {
  w.halign = a;
  w.changed();
}
export function widgetSetValign(w: Widget, a: Align): void {
  w.valign = a;
  w.changed();
}
export function widgetSetMarginStart(w: Widget, m: number): void {
  w.margin = { ...w.margin, start: m };
  w.changed();
}
export function widgetSetMarginEnd(w: Widget, m: number): void {
  w.margin = { ...w.margin, end: m };
  w.changed();
}
export function widgetSetMarginTop(w: Widget, m: number): void {
  w.margin = { ...w.margin, top: m };
  w.changed();
}
export function widgetSetMarginBottom(w: Widget, m: number): void {
  w.margin = { ...w.margin, bottom: m };
  w.changed();
}
export function widgetSetCanFocus(w: Widget, b: boolean): void {
  w.canFocus = b;
  w.changed();
}
export function widgetSetFocusOnClick(w: Widget, b: boolean): void {
  w.focusOnClick = b;
}
export function widgetGrabFocus(w: Widget): void {
  const focus = () => {
    const el = w.el;
    if (!el) return;
    const target = el.matches("input,textarea,select,button,[tabindex]") ? el : el.querySelector<HTMLElement>("input,textarea,select,button,[tabindex]");
    (target ?? el).focus();
  };
  if (w.el) focus();
  else requestAnimationFrame(focus);
}
export function widgetHasFocus(w: Widget): boolean {
  return !!w.el && (w.el === document.activeElement || w.el.contains(document.activeElement));
}
export const getWidgetHasFocus = widgetHasFocus;
export function widgetGetParent(w: Widget): Widget | null {
  return w.parent;
}
export const getWidgetParent = widgetGetParent;
export function widgetGetToplevel(w: Widget): Widget {
  return w.toplevel();
}
export function widgetQueueDraw(w: Widget): void {
  w.emit("queue-draw");
  w.changed();
}
export function widgetQueueResize(w: Widget): void {
  w.changed();
}
export function widgetGetAllocatedWidth(w: Widget): number {
  return w.el ? w.el.clientWidth : 0;
}
export function widgetGetAllocatedHeight(w: Widget): number {
  return w.el ? w.el.clientHeight : 0;
}
export function widgetGetPreferredWidth(w: Widget): [number, number] {
  const width = w.el ? w.el.scrollWidth : Math.max(0, w.widthRequest);
  return [width, width];
}
export function widgetGetPreferredHeight(w: Widget): [number, number] {
  const h = w.el ? w.el.scrollHeight : Math.max(0, w.heightRequest);
  return [h, h];
}
export function widgetGetPreferredHeightForWidth(w: Widget, _width: number): [number, number] {
  return widgetGetPreferredHeight(w);
}
export function widgetGetPreferredWidthForHeight(w: Widget, _height: number): [number, number] {
  return widgetGetPreferredWidth(w);
}
export function widgetSizeAllocate(_w: Widget, _rect: unknown): void {}
export function widgetAddEvents(_w: Widget, _events: unknown): void {}
export function onWidgetMap(w: Widget, cb: () => void): SignalHandlerId {
  return w.connect("map", cb);
}
export function afterWidgetMap(w: Widget, cb: () => void): SignalHandlerId {
  return w.connect("map", cb, true);
}
export function onWidgetUnmap(w: Widget, cb: () => void): SignalHandlerId {
  return w.connect("unmap", cb);
}
export function onWidgetSizeAllocate(w: Widget, cb: (rect: { x: number; y: number; width: number; height: number }) => void): SignalHandlerId {
  return w.connect("size-allocate", cb);
}

/** Style contexts are the widget itself: classes are kept on the widget. */
export type StyleContext = Widget;
export function widgetGetStyleContext(w: Widget): StyleContext {
  return w;
}
export function styleContextAddClass(w: StyleContext, cls: string): void {
  if (!w.classes.has(cls)) {
    w.classes.add(cls);
    w.changed();
  }
}
export function styleContextRemoveClass(w: StyleContext, cls: string): void {
  if (w.classes.delete(cls)) w.changed();
}
export function styleContextHasClass(w: StyleContext, cls: string): boolean {
  return w.classes.has(cls);
}

/** CSS providers are no-ops: the toolkit's stylesheet already implements the CSS. */
export class CssProvider extends GObject {}
export function cssProviderNew(): CssProvider {
  return new CssProvider();
}
export function cssProviderLoadFromPath(_p: CssProvider, _path: string): void {}
export function cssProviderLoadFromData(_p: CssProvider, _data: string): void {}
export function styleContextAddProviderForScreen(_screen: unknown, _p: CssProvider, _prio: number): void {}

export function containerAdd(c: Container, w: Widget): void {
  c.add(w);
}
export function containerRemove(c: Container, w: Widget): void {
  c.removeChild(w);
}
export function containerGetChildren(c: Container): Widget[] {
  return c.getChildren();
}
export function containerSetBorderWidth(c: Container, n: number): void {
  c.borderWidth = n;
  c.changed();
}
export function containerCheckResize(_c: Container): void {}
export function containerChildSetProperty(c: Container, child: Widget, prop: string, value0: unknown): void {
  // Accept a GValue (`Gtk.toGValue x`), as gi-gtk does.
  const value = value0 !== null && typeof value0 === "object" && "value" in value0 ? (value0 as { value: unknown }).value : value0;
  if (prop === "expand") {
    child.packing = { ...child.packing, expand: value as boolean };
    // GtkToolbar's "expand" child property is the tool item's expand flag.
    if ("expand" in child && typeof (child as { expand: unknown }).expand === "boolean") {
      (child as unknown as { expand: boolean }).expand = value as boolean;
      child.changed();
    }
  }
  else if (prop === "fill") child.packing = { ...child.packing, fill: value as boolean };
  else if (prop === "padding") child.packing = { ...child.packing, padding: value as number };
  else if (prop === "pack-type") child.packing = { ...child.packing, packType: value as PackType };
  c.changed();
}
export function binGetChild(b: Bin): Widget | null {
  return b.child();
}

/** True for widget kinds that are shown as separate windows. */
export function isToplevel(w: Widget): boolean {
  return w.kind === "window" || w.kind === "dialog" || w.kind === "messageDialog" || w.kind === "aboutDialog";
}

// ---------------------------------------------------------------------------------------------
// Adjustment

export class Adjustment extends GObject {
  value = 0;
  lower = 0;
  upper = 0;
  pageSize = 0;
  stepIncrement = 1;
  pageIncrement = 10;
  /** Scroll position setter installed by a scrolled window. */
  onSet: ((v: number) => void) | null = null;
}
export function adjustmentNew(value: number, lower: number, upper: number, step: number, page: number, pageSize: number): Adjustment {
  const a = new Adjustment();
  Object.assign(a, { value, lower, upper, stepIncrement: step, pageIncrement: page, pageSize });
  return a;
}
export function adjustmentGetValue(a: Adjustment): number {
  return a.value;
}
export function adjustmentSetValue(a: Adjustment, v: number): void {
  const nv = Math.max(a.lower, Math.min(v, Math.max(a.lower, a.upper - a.pageSize)));
  a.value = nv;
  if (a.onSet) a.onSet(nv);
  a.emit("value-changed");
}
export function adjustmentGetUpper(a: Adjustment): number {
  return a.upper;
}
export function adjustmentGetLower(a: Adjustment): number {
  return a.lower;
}
export function adjustmentGetPageSize(a: Adjustment): number {
  return a.pageSize;
}
export function onAdjustmentValueChanged(a: Adjustment, cb: () => void): SignalHandlerId {
  return a.connect("value-changed", cb);
}

/** Strip GTK mnemonic underscores from a label ("_Open" → "Open", "__" → "_"). */
export function stripMnemonic(label: string): string {
  return label.replace(/__|_/g, (m) => (m === "__" ? "_" : ""));
}

/** GTK stock item labels used by the original Glade file. */
export const stockLabels: Record<string, [string, string]> = {
  "gtk-new": ["_New", "document-new"],
  "gtk-open": ["_Open", "document-open"],
  "gtk-save": ["_Save", "document-save"],
  "gtk-save-as": ["Save _As", "document-save-as"],
  "gtk-quit": ["_Quit", "application-exit"],
  "gtk-undo": ["_Undo", "edit-undo"],
  "gtk-redo": ["_Redo", "edit-redo"],
  "gtk-find": ["_Find", "edit-find"],
  "gtk-properties": ["_Properties", "document-properties"],
  "gtk-media-rewind": ["R_ewind", "media-seek-backward"],
  "gtk-ok": ["_OK", ""],
  "gtk-cancel": ["_Cancel", ""],
  "gtk-close": ["_Close", "window-close"],
  "gtk-delete": ["_Delete", "edit-delete"],
  "gtk-add": ["_Add", "list-add"],
  "gtk-remove": ["_Remove", "list-remove"],
  "gtk-help": ["_Help", "help-browser"],
  "gtk-about": ["_About", "help-about"],
};
