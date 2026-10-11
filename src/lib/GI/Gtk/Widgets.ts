/**
 * Widget classes of the web GTK replacement and their gi-gtk style functions.
 * See `Core.ts` for the design and conventions.
 */
import {
  Bin, Container, GObject, Widget, registerToplevel, unregisterToplevel, stripMnemonic, stockLabels,
  type Align, type ButtonBoxStyle, type IconSize, type Justification, type MessageType, type ButtonsType,
  type Orientation, type PackType, type PolicyType, type ReliefStyle, type ShadowType, type SignalHandlerId,
  type WrapMode, type EntryIconPosition, type WindowPosition, type EllipsizeMode, Adjustment,
  ResponseTypeOk, ResponseTypeCancel, ResponseTypeClose, ResponseTypeYes, ResponseTypeNo, ResponseTypeDeleteEvent,
  ResponseTypeNone,
} from "./Core";
import type { Pixbuf, EventButton, EventKey, EventMotion, EventScroll, Rectangle, RGBA } from "../Gdk";
import type { SimpleAction } from "../Gio";

// =============================================================================================
// Box, ButtonBox

export class Box extends Container {
  override readonly kind: string = "box";
  orientation: Orientation = "OrientationHorizontal";
  spacing = 0;
  homogeneous = false;
  override setProperty(name: string, value: unknown): void {
    if (name === "orientation") this.orientation = value as Orientation;
    else if (name === "spacing") this.spacing = value as number;
    else if (name === "homogeneous") this.homogeneous = value as boolean;
    else return super.setProperty(name, value);
    this.changed();
  }
}
export function boxNew(orientation: Orientation, spacing: number): Box {
  const b = new Box();
  b.orientation = orientation;
  b.spacing = spacing;
  return b;
}
function pack(box: Box, child: Widget, expand: boolean, fill: boolean, padding: number, packType: PackType): void {
  if (child.parent) child.parent.removeChild(child);
  child.packing = { expand, fill, padding, packType };
  child.parent = box;
  box.children.push(child);
  box.changed();
}
export function boxPackStart(box: Box, child: Widget, expand: boolean, fill: boolean, padding: number): void {
  pack(box, child, expand, fill, padding, "PackTypeStart");
}
export function boxPackEnd(box: Box, child: Widget, expand: boolean, fill: boolean, padding: number): void {
  pack(box, child, expand, fill, padding, "PackTypeEnd");
}
export function boxSetSpacing(box: Box, s: number): void {
  box.spacing = s;
  box.changed();
}
export function boxSetHomogeneous(box: Box, h: boolean): void {
  box.homogeneous = h;
  box.changed();
}
export function boxReorderChild(box: Box, child: Widget, pos: number): void {
  const i = box.children.indexOf(child);
  if (i < 0) return;
  box.children.splice(i, 1);
  box.children.splice(pos < 0 ? box.children.length : pos, 0, child);
  box.changed();
}
export function orientableGetOrientation(w: Box | Paned | Separator | Scale | Toolbar): Orientation {
  return (w as any).orientation ?? "OrientationHorizontal";
}

export class ButtonBox extends Box {
  override readonly kind: string = "buttonBox";
  layout: ButtonBoxStyle = "ButtonBoxStyleEdge";
}
export function buttonBoxNew(orientation: Orientation): ButtonBox {
  const b = new ButtonBox();
  b.orientation = orientation;
  b.spacing = 6;
  return b;
}
export function buttonBoxSetLayout(b: ButtonBox, s: ButtonBoxStyle): void {
  b.layout = s;
  b.changed();
}

// =============================================================================================
// Label

export class Label extends Widget {
  override readonly kind: string = "label";
  text = "";
  useMarkup = false;
  useUnderline = false;
  selectable = false;
  wrap = false;
  wrapMode: WrapMode = "WrapModeWord";
  justify: Justification = "JustificationLeft";
  xalign = 0.5;
  yalign = 0.5;
  ellipsize: EllipsizeMode = "EllipsizeModeNone";
  maxWidthChars = -1;
  widthChars = -1;
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "label": this.text = value as string; break;
      case "useMarkup": this.useMarkup = value as boolean; break;
      case "useUnderline": this.useUnderline = value as boolean; break;
      case "selectable": this.selectable = value as boolean; break;
      case "wrap": this.wrap = value as boolean; break;
      case "wrapMode": this.wrapMode = value as WrapMode; break;
      case "justify": this.justify = value as Justification; break;
      case "xalign": this.xalign = value as number; break;
      case "yalign": this.yalign = value as number; break;
      case "ellipsize": this.ellipsize = value as EllipsizeMode; break;
      case "maxWidthChars": this.maxWidthChars = value as number; break;
      case "widthChars": this.widthChars = value as number; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function labelNew(text: string | null): Label {
  const l = new Label();
  l.text = text ?? "";
  return l;
}
export function labelNewWithMnemonic(text: string | null): Label {
  const l = labelNew(text);
  l.useUnderline = true;
  return l;
}
export function labelSetText(l: Label, t: string): void {
  if (l.text !== t || l.useMarkup) {
    l.text = t;
    l.useMarkup = false;
    l.changed();
  }
}
export function labelSetLabel(l: Label, t: string): void {
  if (l.text !== t) {
    l.text = t;
    l.changed();
  }
}
export function labelSetMarkup(l: Label, t: string): void {
  l.text = t;
  l.useMarkup = true;
  l.changed();
}
export function labelGetText(l: Label): string {
  return l.useMarkup ? l.text.replace(/<[^>]*>/g, "") : l.text;
}
export function labelGetLabel(l: Label): string {
  return l.text;
}
export function labelSetSelectable(l: Label, b: boolean): void {
  l.selectable = b;
  l.changed();
}
export function labelSetLineWrap(l: Label, b: boolean): void {
  l.wrap = b;
  l.changed();
}
export function labelSetLineWrapMode(l: Label, m: WrapMode | string): void {
  l.wrapMode = m as WrapMode;
  l.changed();
}
export function labelSetJustify(l: Label, j: Justification): void {
  l.justify = j;
  l.changed();
}
export function labelSetXalign(l: Label, x: number): void {
  l.xalign = x;
  l.changed();
}
export function labelSetEllipsize(l: Label, e: EllipsizeMode | string): void {
  l.ellipsize = e as EllipsizeMode;
  l.changed();
}
export function labelSetMaxWidthChars(l: Label, n: number): void {
  l.maxWidthChars = n;
  l.changed();
}
export function labelSetWidthChars(l: Label, n: number): void {
  l.widthChars = n;
  l.changed();
}
/** Pango layout offsets are not meaningful in HTML; always (0, 0). */
export function labelGetLayoutOffsets(_l: Label): [number, number] {
  return [0, 0];
}

// =============================================================================================
// Entry

export class EntryBuffer extends GObject {
  constructor(readonly entry: Entry) {
    super();
  }
}

export class Entry extends Widget {
  override readonly kind: string = "entry";
  text = "";
  editable = true;
  widthChars = -1;
  maxLength = 0;
  placeholder = "";
  visibility = true;
  hasFrame = true;
  xalign = 0;
  icons: Record<EntryIconPosition, string | null> = { EntryIconPositionPrimary: null, EntryIconPositionSecondary: null };
  iconTooltips: Record<EntryIconPosition, string | null> = { EntryIconPositionPrimary: null, EntryIconPositionSecondary: null };
  inputHints: string[] = [];
  readonly buffer = new EntryBuffer(this);
  override canFocus = true;
  constructor() {
    super();
  }
  /** Called by the renderer for user edits. */
  userSetText(t: string): void {
    const old = this.text;
    if (t === old) return;
    this.text = t;
    this.changed();
    if (t.startsWith(old)) this.buffer.emit("inserted-text", old.length, t.slice(old.length), t.length - old.length);
    else this.buffer.emit("deleted-text", 0, old.length);
    this.emit("changed");
  }
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "text": entrySetText(this, value as string); return;
      case "editable": this.editable = value as boolean; break;
      case "widthChars": this.widthChars = value as number; break;
      case "maxLength": this.maxLength = value as number; break;
      case "placeholderText": this.placeholder = value as string; break;
      case "visibility": this.visibility = value as boolean; break;
      case "hasFrame": this.hasFrame = value as boolean; break;
      case "xalign": this.xalign = value as number; break;
      case "inputHints": this.inputHints = Array.isArray(value) ? (value as string[]) : [String(value)]; break;
      case "primaryIconName": this.icons = { ...this.icons, EntryIconPositionPrimary: value as string }; break;
      case "secondaryIconName": this.icons = { ...this.icons, EntryIconPositionSecondary: value as string }; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function entryNew(): Entry {
  return new Entry();
}
/** Setting the text programmatically emits "changed", as GTK does. */
export function entrySetText(e: Entry, t: string): void {
  if (e.text === t) return;
  e.text = t;
  e.changed();
  e.emit("changed");
}
export const setEntryText = entrySetText;
export function entryGetText(e: Entry): string {
  return e.text;
}
export const getEntryText = entryGetText;
export function editableGetChars(e: Entry, start: number, end: number): string {
  return end < 0 ? e.text.slice(start) : e.text.slice(start, end);
}
export function entrySetWidthChars(e: Entry, n: number): void {
  e.widthChars = n;
  e.changed();
}
export function entrySetMaxLength(e: Entry, n: number): void {
  e.maxLength = n;
  e.changed();
}
export function entrySetPlaceholderText(e: Entry, t: string | null): void {
  e.placeholder = t ?? "";
  e.changed();
}
export function entrySetEditable(e: Entry, b: boolean): void {
  e.editable = b;
  e.changed();
}
export const setEntryEditable = entrySetEditable;
export const editableSetEditable = entrySetEditable;
export function entrySetIconFromIconName(e: Entry, pos: EntryIconPosition, name: string | null): void {
  e.icons = { ...e.icons, [pos]: name };
  e.changed();
}
export function entrySetIconTooltipText(e: Entry, pos: EntryIconPosition, t: string | null): void {
  e.iconTooltips = { ...e.iconTooltips, [pos]: t };
  e.changed();
}
export function entryGetBuffer(e: Entry): EntryBuffer {
  return e.buffer;
}
export function onEditableChanged(e: Entry, cb: () => void): SignalHandlerId {
  return e.connect("changed", cb);
}
export const onEntryChanged = onEditableChanged;
export function onEntryActivate(e: Entry, cb: () => void): SignalHandlerId {
  return e.connect("activate", cb);
}
export function onEntryIconPress(e: Entry, cb: (pos: EntryIconPosition, ev: EventButton) => void): SignalHandlerId {
  return e.connect("icon-press", cb);
}
export function onEntryBufferInsertedText(b: EntryBuffer, cb: (pos: number, chars: string, n: number) => void): SignalHandlerId {
  return b.connect("inserted-text", cb);
}
export function onEntryBufferDeletedText(b: EntryBuffer, cb: (pos: number, n: number) => void): SignalHandlerId {
  return b.connect("deleted-text", cb);
}

// =============================================================================================
// Buttons

export class Button extends Bin {
  override readonly kind: string = "button";
  label: string | null = null;
  useUnderline = true;
  relief: ReliefStyle = "ReliefStyleNormal";
  image: Widget | null = null;
  alwaysShowImage = false;
  /** Gio action name ("win.save"), activated on click. */
  actionName: string | null = null;
  override canFocus = true;
  click(): void {
    if (!this.sensitive) return;
    this.emit("clicked");
    if (this.actionName) activateActionFrom(this, this.actionName);
  }
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "label": this.label = value as string; break;
      case "useUnderline": this.useUnderline = value as boolean; break;
      case "relief": this.relief = value as ReliefStyle; break;
      case "image": this.image = value as Widget; break;
      case "alwaysShowImage": this.alwaysShowImage = value as boolean; break;
      case "actionName": this.actionName = value as string; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function buttonNew(): Button {
  return new Button();
}
export function buttonNewWithLabel(label: string): Button {
  const b = new Button();
  b.label = label;
  b.useUnderline = false;
  return b;
}
export function buttonNewWithMnemonic(label: string): Button {
  const b = new Button();
  b.label = label;
  return b;
}
export function buttonNewFromIconName(name: string | null, _size: IconSize | number): Button {
  const b = new Button();
  if (name) b.image = imageNewFromIconName(name, _size);
  b.alwaysShowImage = true;
  return b;
}
export function buttonSetLabel(b: Button, l: string): void {
  b.label = l;
  b.changed();
}
export function buttonGetLabel(b: Button): string {
  return b.label ?? "";
}
export function buttonSetImage(b: Button, img: Widget | null): void {
  b.image = img;
  b.changed();
}
export function buttonSetAlwaysShowImage(b: Button, v: boolean): void {
  b.alwaysShowImage = v;
  b.changed();
}
export function buttonSetRelief(b: Button, r: ReliefStyle): void {
  b.relief = r;
  b.changed();
}
export const setButtonRelief = buttonSetRelief;
export function onButtonClicked(b: Button, cb: () => void): SignalHandlerId {
  return b.connect("clicked", cb);
}
/** The deprecated "pressed" signal, emitted on pointer down. */
export function onButtonPressed(b: Button, cb: () => void): SignalHandlerId {
  return b.connect("pressed", cb);
}

export class ToggleButton extends Button {
  override readonly kind: string = "toggleButton";
  active = false;
  inconsistent = false;
  setActive(a: boolean, user: boolean): void {
    if (this.active === a) return;
    this.active = a;
    this.changed();
    this.emit("toggled");
    void user;
  }
  override click(): void {
    if (!this.sensitive) return;
    this.setActive(!this.active, true);
    this.emit("clicked");
  }
  override setProperty(name: string, value: unknown): void {
    if (name === "active") return this.setActive(value as boolean, false);
    super.setProperty(name, value);
  }
}
export function toggleButtonNew(): ToggleButton {
  return new ToggleButton();
}
export function toggleButtonNewWithLabel(l: string): ToggleButton {
  const t = new ToggleButton();
  t.label = l;
  return t;
}
export function toggleButtonSetActive(t: ToggleButton, a: boolean): void {
  t.setActive(a, false);
}
export function toggleButtonGetActive(t: ToggleButton): boolean {
  return t.active;
}
export function toggleButtonSetInconsistent(t: ToggleButton, b: boolean): void {
  t.inconsistent = b;
  t.changed();
}
export function onToggleButtonToggled(t: ToggleButton, cb: () => void): SignalHandlerId {
  return t.connect("toggled", cb);
}
export function afterToggleButtonToggled(t: ToggleButton, cb: () => void): SignalHandlerId {
  return t.connect("toggled", cb, true);
}

export class CheckButton extends ToggleButton {
  override readonly kind: string = "checkButton";
}
export function checkButtonNew(): CheckButton {
  return new CheckButton();
}
export function checkButtonNewWithLabel(l: string): CheckButton {
  const c = new CheckButton();
  c.label = l;
  c.useUnderline = false;
  return c;
}

/** Radio buttons share a group; activating one deactivates the others. */
export class RadioGroup {
  members: RadioButton[] = [];
}
export class RadioButton extends CheckButton {
  override readonly kind: string = "radioButton";
  group = new RadioGroup();
  constructor() {
    super();
    this.group.members.push(this);
  }
  override setActive(a: boolean, user: boolean): void {
    if (a) {
      for (const m of this.group.members) if (m !== this && m.active) m.setActive(false, user);
    } else if (user) {
      return; // Clicking an active radio button leaves it active.
    }
    super.setActive(a, user);
  }
  override click(): void {
    if (!this.sensitive || this.active) return;
    this.setActive(true, true);
    this.emit("clicked");
  }
}
export function radioButtonNewWithLabel(group: RadioButton[] | null, label: string): RadioButton {
  const r = new RadioButton();
  r.label = label;
  r.useUnderline = false;
  if (group && group.length > 0) radioButtonJoinGroup(r, group[0]);
  else r.active = true;
  return r;
}
export function radioButtonNew(group: RadioButton[] | null): RadioButton {
  return radioButtonNewWithLabel(group, "");
}
export function radioButtonJoinGroup(r: RadioButton, other: RadioButton | null): void {
  r.group.members = r.group.members.filter((m) => m !== r);
  if (other) {
    r.group = other.group;
    r.group.members.push(r);
    if (r.active && r.group.members.some((m) => m !== r && m.active)) r.active = false;
  } else {
    r.group = new RadioGroup();
    r.group.members.push(r);
  }
  r.changed();
}
export function radioButtonGetGroup(r: RadioButton): RadioButton[] {
  return r.group.members.slice();
}

export class LinkButton extends Button {
  override readonly kind: string = "linkButton";
  uri = "";
}
export function linkButtonNew(uri: string): LinkButton {
  const l = new LinkButton();
  l.uri = uri;
  l.label = uri;
  return l;
}
export function linkButtonNewWithLabel(uri: string, label: string | null): LinkButton {
  const l = linkButtonNew(uri);
  l.label = label ?? uri;
  l.useUnderline = false;
  return l;
}
export function linkButtonSetUri(l: LinkButton, uri: string): void {
  l.uri = uri;
  l.changed();
}
export function linkButtonGetUri(l: LinkButton): string {
  return l.uri;
}

// =============================================================================================
// Frame, ScrolledWindow, Viewport, EventBox, Layout

export class Frame extends Bin {
  override readonly kind: string = "frame";
  label: string | null = null;
  labelWidget: Widget | null = null;
  shadow: ShadowType = "ShadowTypeEtchedIn";
  override setProperty(name: string, value: unknown): void {
    if (name === "label") this.label = value as string | null;
    else if (name === "shadowType") this.shadow = value as ShadowType;
    else return super.setProperty(name, value);
    this.changed();
  }
}
export function frameNew(label: string | null): Frame {
  const f = new Frame();
  f.label = label;
  return f;
}
export function frameSetLabel(f: Frame, l: string | null): void {
  f.label = l;
  f.changed();
}
export function frameGetLabel(f: Frame): string | null {
  return f.label;
}
export function frameSetShadowType(f: Frame, s: ShadowType): void {
  f.shadow = s;
  f.changed();
}
export function frameSetLabelWidget(f: Frame, w: Widget | null): void {
  f.labelWidget = w;
  f.changed();
}

export class ScrolledWindow extends Bin {
  override readonly kind: string = "scrolledWindow";
  hpolicy: PolicyType = "PolicyTypeAutomatic";
  vpolicy: PolicyType = "PolicyTypeAutomatic";
  shadow: ShadowType = "ShadowTypeNone";
  propagateNaturalHeight = false;
  propagateNaturalWidth = false;
  minContentHeight = -1;
  minContentWidth = -1;
  maxContentHeight = -1;
  maxContentWidth = -1;
  readonly hadj = new Adjustment();
  readonly vadj = new Adjustment();
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "propagateNaturalHeight": this.propagateNaturalHeight = value as boolean; break;
      case "propagateNaturalWidth": this.propagateNaturalWidth = value as boolean; break;
      case "shadowType": this.shadow = value as ShadowType; break;
      case "hscrollbarPolicy": this.hpolicy = value as PolicyType; break;
      case "vscrollbarPolicy": this.vpolicy = value as PolicyType; break;
      case "minContentHeight": this.minContentHeight = value as number; break;
      case "minContentWidth": this.minContentWidth = value as number; break;
      case "maxContentHeight": this.maxContentHeight = value as number; break;
      case "maxContentWidth": this.maxContentWidth = value as number; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function scrolledWindowNew(_h: Adjustment | null, _v: Adjustment | null): ScrolledWindow {
  return new ScrolledWindow();
}
export function scrolledWindowSetPolicy(s: ScrolledWindow, h: PolicyType, v: PolicyType): void {
  s.hpolicy = h;
  s.vpolicy = v;
  s.changed();
}
export function scrolledWindowSetShadowType(s: ScrolledWindow, t: ShadowType): void {
  s.shadow = t;
  s.changed();
}
export const setScrolledWindowShadowType = scrolledWindowSetShadowType;
export function scrolledWindowSetPropagateNaturalHeight(s: ScrolledWindow, b: boolean): void {
  s.propagateNaturalHeight = b;
  s.changed();
}
export function scrolledWindowSetPropagateNaturalWidth(s: ScrolledWindow, b: boolean): void {
  s.propagateNaturalWidth = b;
  s.changed();
}
export function scrolledWindowSetMinContentHeight(s: ScrolledWindow, n: number): void {
  s.minContentHeight = n;
  s.changed();
}
export function scrolledWindowSetMinContentWidth(s: ScrolledWindow, n: number): void {
  s.minContentWidth = n;
  s.changed();
}
export function scrolledWindowGetHadjustment(s: ScrolledWindow): Adjustment {
  return s.hadj;
}
export function scrolledWindowGetVadjustment(s: ScrolledWindow): Adjustment {
  return s.vadj;
}
export function scrollableGetHadjustment(s: ScrolledWindow | Viewport): Adjustment {
  return s instanceof ScrolledWindow ? s.hadj : (s.parent instanceof ScrolledWindow ? s.parent.hadj : new Adjustment());
}
export function scrollableGetVadjustment(s: ScrolledWindow | Viewport): Adjustment {
  return s instanceof ScrolledWindow ? s.vadj : (s.parent instanceof ScrolledWindow ? s.parent.vadj : new Adjustment());
}

export class Viewport extends Bin {
  override readonly kind: string = "viewport";
  shadow: ShadowType = "ShadowTypeNone";
}
export function viewportNew(_h: Adjustment | null, _v: Adjustment | null): Viewport {
  return new Viewport();
}

export class EventBox extends Bin {
  override readonly kind: string = "eventBox";
}
export function eventBoxNew(): EventBox {
  return new EventBox();
}

export class Layout extends Container {
  override readonly kind: string = "layout";
  width = 0;
  height = 0;
  positions = new Map<Widget, [number, number]>();
}
export function layoutNew(_h: Adjustment | null, _v: Adjustment | null): Layout {
  return new Layout();
}
export function layoutSetSize(l: Layout, w: number, h: number): void {
  l.width = w;
  l.height = h;
  l.changed();
}
export function layoutPut(l: Layout, w: Widget, x: number, y: number): void {
  l.positions.set(w, [x, y]);
  l.add(w);
}
export function layoutMove(l: Layout, w: Widget, x: number, y: number): void {
  l.positions.set(w, [x, y]);
  l.changed();
}

// =============================================================================================
// Grid

export class Grid extends Container {
  override readonly kind: string = "grid";
  placement = new Map<Widget, [number, number, number, number]>();
  rowSpacing = 0;
  columnSpacing = 0;
  rowHomogeneous = false;
  columnHomogeneous = false;
  override setProperty(name: string, value: unknown): void {
    if (name === "rowSpacing") this.rowSpacing = value as number;
    else if (name === "columnSpacing") this.columnSpacing = value as number;
    else if (name === "rowHomogeneous") this.rowHomogeneous = value as boolean;
    else if (name === "columnHomogeneous") this.columnHomogeneous = value as boolean;
    else return super.setProperty(name, value);
    this.changed();
  }
}
export function gridNew(): Grid {
  return new Grid();
}
export function gridAttach(g: Grid, child: Widget, left: number, top: number, width: number, height: number): void {
  g.placement.set(child, [left, top, width, height]);
  g.add(child);
}
export function gridSetRowSpacing(g: Grid, n: number): void {
  g.rowSpacing = n;
  g.changed();
}
export function gridSetColumnSpacing(g: Grid, n: number): void {
  g.columnSpacing = n;
  g.changed();
}
export function gridGetChildAt(g: Grid, left: number, top: number): Widget | null {
  for (const [w, [l, t]] of g.placement) if (l === left && t === top && w.parent === g) return w;
  return null;
}

// =============================================================================================
// Separator, Image, Spinner

export class Separator extends Widget {
  override readonly kind: string = "separator";
  orientation: Orientation = "OrientationHorizontal";
}
export function separatorNew(o: Orientation): Separator {
  const s = new Separator();
  s.orientation = o;
  return s;
}

export class Image extends Widget {
  override readonly kind: string = "image";
  iconName: string | null = null;
  pixbuf: Pixbuf | null = null;
  file: string | null = null;
  pixelSize = -1;
  iconSize: IconSize | number = "IconSizeButton";
  override setProperty(name: string, value: unknown): void {
    if (name === "iconName") this.iconName = value as string;
    else if (name === "pixelSize") this.pixelSize = value as number;
    else if (name === "iconSize") this.iconSize = value as IconSize;
    else if (name === "pixbuf") this.pixbuf = value as Pixbuf;
    else if (name === "file") this.file = value as string;
    else return super.setProperty(name, value);
    this.changed();
  }
}
export function imageNew(): Image {
  return new Image();
}
export function imageNewFromIconName(name: string | null, size: IconSize | number): Image {
  const i = new Image();
  i.iconName = name;
  i.iconSize = size;
  return i;
}
export function imageNewFromPixbuf(p: Pixbuf | null): Image {
  const i = new Image();
  i.pixbuf = p;
  return i;
}
export function imageNewFromFile(url: string): Image {
  const i = new Image();
  i.file = url;
  return i;
}
export function imageSetFromIconName(i: Image, name: string | null, size: IconSize | number): void {
  i.iconName = name;
  i.iconSize = size;
  i.pixbuf = null;
  i.file = null;
  i.changed();
}
export const setImageIconName = (i: Image, name: string | null): void => {
  i.iconName = name;
  i.pixbuf = null;
  i.file = null;
  i.changed();
};
export function imageSetFromPixbuf(i: Image, p: Pixbuf | null): void {
  i.pixbuf = p;
  i.iconName = null;
  i.file = null;
  i.changed();
}
export function imageSetFromFile(i: Image, url: string | null): void {
  i.file = url;
  i.pixbuf = null;
  i.iconName = null;
  i.changed();
}
export function imageGetPixbuf(i: Image): Pixbuf | null {
  return i.pixbuf;
}
export function imageSetPixelSize(i: Image, n: number): void {
  i.pixelSize = n;
  i.changed();
}
export function imageClear(i: Image): void {
  i.pixbuf = null;
  i.iconName = null;
  i.file = null;
  i.changed();
}

export class Spinner extends Widget {
  override readonly kind: string = "spinner";
  active = false;
}
export function spinnerNew(): Spinner {
  return new Spinner();
}
export function spinnerStart(s: Spinner): void {
  s.active = true;
  s.changed();
}
export function spinnerStop(s: Spinner): void {
  s.active = false;
  s.changed();
}

// =============================================================================================
// TextView

export class TextBuffer extends GObject {
  text = "";
  view: TextView | null = null;
  setTextInternal(t: string, user: boolean): void {
    if (t === this.text) return;
    this.text = t;
    this.view?.changed();
    this.emit("changed");
    if (user) this.emit("end-user-action");
  }
}
export class TextView extends Widget {
  override readonly kind: string = "textView";
  buffer = new TextBuffer();
  wrapMode: WrapMode = "WrapModeNone";
  editable = true;
  cursorVisible = true;
  acceptsTab = true;
  leftMargin = 0;
  rightMargin = 0;
  override canFocus = true;
  constructor() {
    super();
    this.buffer.view = this;
  }
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "wrapMode": this.wrapMode = value as WrapMode; break;
      case "editable": this.editable = value as boolean; break;
      case "cursorVisible": this.cursorVisible = value as boolean; break;
      case "acceptsTab": this.acceptsTab = value as boolean; break;
      case "leftMargin": this.leftMargin = value as number; break;
      case "rightMargin": this.rightMargin = value as number; break;
      case "inputHints": break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function textViewNew(): TextView {
  return new TextView();
}
export function textViewGetBuffer(t: TextView): TextBuffer {
  return t.buffer;
}
export function textViewSetWrapMode(t: TextView, m: WrapMode): void {
  t.wrapMode = m;
  t.changed();
}
export function textViewSetEditable(t: TextView, b: boolean): void {
  t.editable = b;
  t.changed();
}
export function textViewSetCursorVisible(t: TextView, b: boolean): void {
  t.cursorVisible = b;
  t.changed();
}
export function textBufferSetText(b: TextBuffer, t: string, _len = -1): void {
  b.setTextInternal(t, false);
}
export const setTextBufferText = (b: TextBuffer, t: string): void => textBufferSetText(b, t);
export function getTextBufferText(b: TextBuffer): string {
  return b.text;
}
export function textBufferGetText(b: TextBuffer): string {
  return b.text;
}
export function onTextBufferChanged(b: TextBuffer, cb: () => void): SignalHandlerId {
  return b.connect("changed", cb);
}
export function onTextBufferEndUserAction(b: TextBuffer, cb: () => void): SignalHandlerId {
  return b.connect("end-user-action", cb);
}

// =============================================================================================
// Range / Scale

export class Scale extends Widget {
  override readonly kind: string = "scale";
  orientation: Orientation = "OrientationHorizontal";
  min = 0;
  max = 100;
  step = 1;
  value = 0;
  drawValue = true;
  digits = 1;
  setValue(v: number): void {
    const nv = Math.max(this.min, Math.min(this.max, v));
    if (nv === this.value) return;
    this.value = nv;
    this.changed();
    this.emit("value-changed");
  }
}
export function scaleNewWithRange(o: Orientation, min: number, max: number, step: number): Scale {
  const s = new Scale();
  s.orientation = o;
  s.min = min;
  s.max = max;
  s.step = step;
  s.value = min;
  return s;
}
export function scaleSetDrawValue(s: Scale, b: boolean): void {
  s.drawValue = b;
  s.changed();
}
export function scaleSetDigits(s: Scale, n: number): void {
  s.digits = n;
  s.changed();
}
export function rangeSetValue(s: Scale, v: number): void {
  s.setValue(v);
}
export function rangeGetValue(s: Scale): number {
  return s.value;
}
export function onRangeValueChanged(s: Scale, cb: () => void): SignalHandlerId {
  return s.connect("value-changed", cb);
}

// =============================================================================================
// Calendar

export class Calendar extends Widget {
  override readonly kind: string = "calendar";
  year: number;
  /** 0-based month, as in GTK. */
  month: number;
  day: number;
  override canFocus = true;
  constructor() {
    super();
    const d = new Date();
    this.year = d.getFullYear();
    this.month = d.getMonth();
    this.day = d.getDate();
  }
}
export function calendarNew(): Calendar {
  return new Calendar();
}
export function calendarSelectMonth(c: Calendar, month: number, year: number): void {
  c.month = month;
  c.year = year;
  c.changed();
  c.emit("month-changed");
}
export function calendarSelectDay(c: Calendar, day: number): void {
  c.day = day;
  c.changed();
  c.emit("day-selected");
}
/** Returns (year, month (0-based), day). */
export function calendarGetDate(c: Calendar): [number, number, number] {
  return [c.year, c.month, c.day];
}
export function onCalendarDaySelected(c: Calendar, cb: () => void): SignalHandlerId {
  return c.connect("day-selected", cb);
}
export function onCalendarDaySelectedDoubleClick(c: Calendar, cb: () => void): SignalHandlerId {
  return c.connect("day-selected-double-click", cb);
}

// =============================================================================================
// Popover

export type PositionType = "PositionTypeLeft" | "PositionTypeRight" | "PositionTypeTop" | "PositionTypeBottom";

export class Popover extends Bin {
  override readonly kind: string = "popover";
  relativeTo: Widget | null = null;
  pointingTo: Rectangle | null = null;
  position: PositionType = "PositionTypeBottom";
  modal = true;
  open = false;
}
export function popoverNew(relativeTo: Widget | null): Popover {
  const p = new Popover();
  p.relativeTo = relativeTo;
  registerToplevel(p);
  return p;
}
export function popoverSetRelativeTo(p: Popover, w: Widget | null): void {
  p.relativeTo = w;
  p.changed();
}
export function popoverSetPointingTo(p: Popover, r: Rectangle): void {
  p.pointingTo = r;
  p.changed();
}
export function popoverSetPosition(p: Popover, pos: PositionType): void {
  p.position = pos;
  p.changed();
}
export function popoverSetModal(p: Popover, m: boolean): void {
  p.modal = m;
  p.changed();
}
export function popoverPopup(p: Popover): void {
  registerToplevel(p);
  p.open = true;
  p.changed();
}
export function popoverPopdown(p: Popover): void {
  if (!p.open) return;
  p.open = false;
  p.changed();
  p.emit("closed");
}
export function onPopoverClosed(p: Popover, cb: () => void): SignalHandlerId {
  return p.connect("closed", cb);
}

// =============================================================================================
// DrawingArea

/**
 * A canvas. The renderer creates a `<canvas>` sized to the widget (with device pixel ratio)
 * and emits "draw" with a Cairo context whenever the widget is invalidated
 * (`widgetQueueDraw`). Mouse and keyboard input is delivered through the usual event signals.
 */
export class DrawingArea extends Widget {
  override readonly kind: string = "drawingArea";
  override canFocus = false;
  /** Cursor CSS for the canvas. */
  cursor = "default";
}
export function drawingAreaNew(): DrawingArea {
  return new DrawingArea();
}

// =============================================================================================
// Event signals common to widgets

export function onWidgetButtonPressEvent(w: Widget, cb: (e: EventButton) => boolean): SignalHandlerId {
  return w.connect("button-press-event", cb);
}
export function onWidgetButtonReleaseEvent(w: Widget, cb: (e: EventButton) => boolean): SignalHandlerId {
  return w.connect("button-release-event", cb);
}
export function onWidgetMotionNotifyEvent(w: Widget, cb: (e: EventMotion) => boolean): SignalHandlerId {
  return w.connect("motion-notify-event", cb);
}
export function onWidgetScrollEvent(w: Widget, cb: (e: EventScroll) => boolean): SignalHandlerId {
  return w.connect("scroll-event", cb);
}
export function onWidgetKeyPressEvent(w: Widget, cb: (e: EventKey) => boolean): SignalHandlerId {
  return w.connect("key-press-event", cb);
}
export function onWidgetKeyReleaseEvent(w: Widget, cb: (e: EventKey) => boolean): SignalHandlerId {
  return w.connect("key-release-event", cb);
}
export function onWidgetFocusInEvent(w: Widget, cb: (e: unknown) => boolean): SignalHandlerId {
  return w.connect("focus-in-event", cb);
}
export function onWidgetFocusOutEvent(w: Widget, cb: (e: unknown) => boolean): SignalHandlerId {
  return w.connect("focus-out-event", cb);
}
/** The draw handler receives a Cairo context (see `@/lib/GI/Cairo`). */
export function onWidgetDraw(w: Widget, cb: (cr: any) => boolean): SignalHandlerId {
  return w.connect("draw", cb);
}
export function onWidgetDeleteEvent(w: Widget, cb: (e: unknown) => boolean): SignalHandlerId {
  return w.connect("delete-event", cb);
}

// =============================================================================================
// Notebook

export interface NotebookPage {
  child: Widget;
  tabLabel: Widget | null;
  menuLabel: Widget | null;
  detachable: boolean;
  reorderable: boolean;
}

export class Notebook extends Container {
  override readonly kind: string = "notebook";
  pages: NotebookPage[] = [];
  currentPage = -1;
  scrollable = false;
  showTabs = true;
  showBorder = true;
  popupEnabled = false;
  groupName: string | null = null;
  actionWidgets: { start: Widget | null; end: Widget | null } = { start: null, end: null };
  tabPos: PositionType = "PositionTypeTop";
  override getChildren(): Widget[] {
    const r: Widget[] = [];
    for (const p of this.pages) {
      r.push(p.child);
      if (p.tabLabel) r.push(p.tabLabel);
    }
    if (this.actionWidgets.start) r.push(this.actionWidgets.start);
    if (this.actionWidgets.end) r.push(this.actionWidgets.end);
    return r;
  }
  override add(w: Widget): void {
    notebookAppendPage(this, w, null);
  }
  override removeChild(w: Widget): void {
    const i = this.pages.findIndex((p) => p.child === w);
    if (i >= 0) notebookRemovePage(this, i);
    else if (this.actionWidgets.start === w) this.actionWidgets.start = null;
    else if (this.actionWidgets.end === w) this.actionWidgets.end = null;
    w.parent = null;
    this.changed();
  }
  /** Switch page as the result of user interaction or API call. */
  switchTo(n: number): void {
    if (n < 0 || n >= this.pages.length) return;
    if (n === this.currentPage) return;
    const page = this.pages[n].child;
    this.emit("switch-page", page, n);
    this.currentPage = n;
    this.changed();
  }
  override setProperty(name: string, value: unknown): void {
    if (name === "scrollable") this.scrollable = value as boolean;
    else if (name === "showTabs") this.showTabs = value as boolean;
    else if (name === "showBorder") this.showBorder = value as boolean;
    else if (name === "groupName") this.groupName = value as string;
    else if (name === "enablePopup") this.popupEnabled = value as boolean;
    else return super.setProperty(name, value);
    this.changed();
  }
}
export function notebookNew(): Notebook {
  return new Notebook();
}
export function notebookAppendPage(nb: Notebook, child: Widget, tabLabel: Widget | null): number {
  return notebookAppendPageMenu(nb, child, tabLabel, null);
}
export function notebookAppendPageMenu(nb: Notebook, child: Widget, tabLabel: Widget | null, menuLabel: Widget | null): number {
  if (child.parent) child.parent.removeChild(child);
  child.parent = nb;
  if (tabLabel) {
    if (tabLabel.parent) tabLabel.parent.removeChild(tabLabel);
    tabLabel.parent = nb;
  }
  nb.pages.push({ child, tabLabel, menuLabel, detachable: false, reorderable: false });
  const n = nb.pages.length - 1;
  if (nb.currentPage < 0) {
    nb.currentPage = n;
    nb.emit("switch-page", child, n);
  }
  nb.changed();
  return n;
}
export function notebookInsertPage(nb: Notebook, child: Widget, tabLabel: Widget | null, pos: number): number {
  const n = notebookAppendPage(nb, child, tabLabel);
  if (pos < 0 || pos >= n) return n;
  const [p] = nb.pages.splice(n, 1);
  nb.pages.splice(pos, 0, p);
  nb.changed();
  return pos;
}
export function notebookRemovePage(nb: Notebook, n: number): void {
  if (n < 0) n = nb.pages.length - 1;
  if (n < 0 || n >= nb.pages.length) return;
  const [p] = nb.pages.splice(n, 1);
  p.child.parent = null;
  if (p.tabLabel) p.tabLabel.parent = null;
  if (nb.pages.length === 0) nb.currentPage = -1;
  else if (nb.currentPage >= nb.pages.length || nb.currentPage === n) {
    const nn = Math.min(n, nb.pages.length - 1);
    nb.currentPage = -1;
    nb.switchTo(nn);
  } else if (nb.currentPage > n) nb.currentPage--;
  nb.emit("page-removed", p.child, n);
  nb.changed();
}
export function notebookGetNPages(nb: Notebook): number {
  return nb.pages.length;
}
export function notebookGetCurrentPage(nb: Notebook): number {
  return nb.currentPage;
}
export function notebookSetCurrentPage(nb: Notebook, n: number): void {
  nb.switchTo(n < 0 ? nb.pages.length - 1 : n);
}
export function notebookGetNthPage(nb: Notebook, n: number): Widget | null {
  return nb.pages[n]?.child ?? null;
}
export function notebookPageNum(nb: Notebook, w: Widget): number {
  return nb.pages.findIndex((p) => p.child === w);
}
export function notebookGetTabLabel(nb: Notebook, w: Widget): Widget | null {
  return nb.pages.find((p) => p.child === w)?.tabLabel ?? null;
}
export function notebookSetTabLabel(nb: Notebook, w: Widget, tab: Widget | null): void {
  const p = nb.pages.find((pg) => pg.child === w);
  if (!p) return;
  if (tab) tab.parent = nb;
  p.tabLabel = tab;
  nb.changed();
}
export function notebookSetTabLabelText(nb: Notebook, w: Widget, text: string): void {
  notebookSetTabLabel(nb, w, labelNew(text));
}
export function notebookGetMenuLabel(nb: Notebook, w: Widget): Widget | null {
  return nb.pages.find((p) => p.child === w)?.menuLabel ?? null;
}
export function notebookSetScrollable(nb: Notebook, b: boolean): void {
  nb.scrollable = b;
  nb.changed();
}
export const setNotebookScrollable = notebookSetScrollable;
export function notebookPopupEnable(nb: Notebook): void {
  nb.popupEnabled = true;
}
export const setNotebookEnablePopup = (nb: Notebook, b: boolean): void => {
  nb.popupEnabled = b;
};
export function notebookSetGroupName(nb: Notebook, n: string | null): void {
  nb.groupName = n;
}
export function notebookSetTabDetachable(nb: Notebook, w: Widget, b: boolean): void {
  const p = nb.pages.find((pg) => pg.child === w);
  if (p) p.detachable = b;
}
export function notebookSetTabReorderable(nb: Notebook, w: Widget, b: boolean): void {
  const p = nb.pages.find((pg) => pg.child === w);
  if (p) {
    p.reorderable = b;
    nb.changed();
  }
}
export function notebookReorderChild(nb: Notebook, w: Widget, pos: number): void {
  const i = nb.pages.findIndex((pg) => pg.child === w);
  if (i < 0) return;
  const cur = nb.pages[nb.currentPage]?.child;
  const [p] = nb.pages.splice(i, 1);
  nb.pages.splice(pos < 0 ? nb.pages.length : pos, 0, p);
  nb.currentPage = cur ? nb.pages.findIndex((pg) => pg.child === cur) : nb.currentPage;
  nb.emit("page-reordered", w, pos);
  nb.changed();
}
export function notebookSetActionWidget(nb: Notebook, w: Widget, pack: PackType): void {
  if (w.parent && w.parent !== nb) w.parent.removeChild(w);
  w.parent = nb;
  if (pack === "PackTypeStart") nb.actionWidgets.start = w;
  else nb.actionWidgets.end = w;
  nb.changed();
}
export function notebookSetShowTabs(nb: Notebook, b: boolean): void {
  nb.showTabs = b;
  nb.changed();
}
export function onNotebookSwitchPage(nb: Notebook, cb: (page: Widget, n: number) => void): SignalHandlerId {
  return nb.connect("switch-page", cb);
}
export function afterNotebookSwitchPage(nb: Notebook, cb: (page: Widget, n: number) => void): SignalHandlerId {
  return nb.connect("switch-page", cb, true);
}
export function onNotebookPageRemoved(nb: Notebook, cb: (page: Widget, n: number) => void): SignalHandlerId {
  return nb.connect("page-removed", cb);
}
export function onNotebookPageReordered(nb: Notebook, cb: (page: Widget, n: number) => void): SignalHandlerId {
  return nb.connect("page-reordered", cb);
}

// =============================================================================================
// Paned

export class Paned extends Container {
  override readonly kind: string = "paned";
  orientation: Orientation = "OrientationHorizontal";
  child1: Widget | null = null;
  child2: Widget | null = null;
  resize1 = false;
  resize2 = true;
  /** Divider position in pixels, or -1 for automatic. */
  position = -1;
  override getChildren(): Widget[] {
    return [this.child1, this.child2].filter((w): w is Widget => w !== null);
  }
  override add(w: Widget): void {
    if (!this.child1) panedPack1(this, w, false, true);
    else if (!this.child2) panedPack2(this, w, true, true);
  }
  override removeChild(w: Widget): void {
    if (this.child1 === w) this.child1 = null;
    if (this.child2 === w) this.child2 = null;
    w.parent = null;
    this.changed();
  }
  setPositionUser(p: number): void {
    this.position = Math.max(0, Math.round(p));
    this.changed();
    this.emit("notify::position");
  }
}
export function panedNew(o: Orientation): Paned {
  const p = new Paned();
  p.orientation = o;
  return p;
}
export function panedPack1(p: Paned, w: Widget, resize: boolean, _shrink: boolean): void {
  if (w.parent) w.parent.removeChild(w);
  w.parent = p;
  p.child1 = w;
  p.resize1 = resize;
  p.changed();
}
export function panedPack2(p: Paned, w: Widget, resize: boolean, _shrink: boolean): void {
  if (w.parent) w.parent.removeChild(w);
  w.parent = p;
  p.child2 = w;
  p.resize2 = resize;
  p.changed();
}
export function panedAdd1(p: Paned, w: Widget): void {
  panedPack1(p, w, false, true);
}
export function panedAdd2(p: Paned, w: Widget): void {
  panedPack2(p, w, true, true);
}
export function panedGetChild1(p: Paned): Widget | null {
  return p.child1;
}
export function panedGetChild2(p: Paned): Widget | null {
  return p.child2;
}
/** `panedGetChild` is not GTK API, but the Haskell code used `panedGetChild1/2`. */
export function panedGetChild(p: Paned, n: 1 | 2): Widget | null {
  return n === 1 ? p.child1 : p.child2;
}
export function panedSetPosition(p: Paned, pos: number): void {
  p.position = pos;
  p.changed();
}
export function panedGetPosition(p: Paned): number {
  return p.position;
}

// =============================================================================================
// Menus

export class MenuShell extends Container {
  override readonly kind: string = "menuShell";
}

/** A popup menu. `menuPopupAtPointer` shows it at the last pointer position. */
export class Menu extends MenuShell {
  override readonly kind: string = "menu";
  open = false;
  /** Screen position for popups. */
  at: { x: number; y: number } | null = null;
  attachWidget: Widget | null = null;
}
export function menuNew(): Menu {
  return new Menu();
}
export function menuShellAppend(m: MenuShell, item: Widget): void {
  m.add(item);
}
export function menuShellPrepend(m: MenuShell, item: Widget): void {
  m.add(item);
  m.children.unshift(m.children.pop()!);
  m.changed();
}
export function menuShellInsert(m: MenuShell, item: Widget, pos: number): void {
  m.add(item);
  if (pos >= 0 && pos < m.children.length - 1) {
    m.children.splice(pos, 0, m.children.pop()!);
    m.changed();
  }
}
/** Last pointer position, tracked globally so menus can pop up at the pointer. */
export const pointer = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  const track = (e: MouseEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  };
  window.addEventListener("pointerdown", track, true);
  window.addEventListener("pointermove", track, true);
  window.addEventListener("contextmenu", track as any, true);
}
export function menuPopupAtPointer(m: Menu, _ev: unknown | null): void {
  m.at = { x: pointer.x, y: pointer.y };
  m.open = true;
  registerToplevel(m);
  m.changed();
}
export function menuPopupAtWidget(m: Menu, w: Widget, _g1: unknown, _g2: unknown, _ev: unknown | null): void {
  const r = w.el?.getBoundingClientRect();
  m.at = r ? { x: r.left, y: r.bottom } : { x: pointer.x, y: pointer.y };
  m.open = true;
  registerToplevel(m);
  m.changed();
}
export function menuPopdown(m: Menu): void {
  if (!m.open) return;
  m.open = false;
  m.changed();
  m.emit("deactivate");
}
export function menuAttachToWidget(m: Menu, w: Widget, _detacher: unknown): void {
  m.attachWidget = w;
}
export const menuAttach = (m: Menu, w: Widget): void => menuAttachToWidget(m, w, null);

export class MenuItem extends Bin {
  override readonly kind: string = "menuItem";
  label = "";
  useUnderline = true;
  submenu: Menu | null = null;
  iconName: string | null = null;
  actionName: string | null = null;
  accelLabel: string | null = null;
  activate(): void {
    if (!this.sensitive) return;
    this.emit("activate");
    if (this.actionName) activateActionFrom(this, this.actionName);
  }
  override getChildren(): Widget[] {
    return this.submenu ? [...super.getChildren(), this.submenu] : super.getChildren();
  }
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "label": this.label = value as string; break;
      case "useUnderline": this.useUnderline = value as boolean; break;
      case "actionName": this.actionName = value as string; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function menuItemNew(): MenuItem {
  return new MenuItem();
}
export function menuItemNewWithLabel(label: string): MenuItem {
  const m = new MenuItem();
  m.label = label;
  m.useUnderline = false;
  return m;
}
export function menuItemNewWithMnemonic(label: string): MenuItem {
  const m = new MenuItem();
  m.label = label;
  return m;
}
export function menuItemSetSubmenu(m: MenuItem, sub: Menu | null): void {
  m.submenu = sub;
  if (sub) sub.parent = m;
  m.changed();
}
export function menuItemSetLabel(m: MenuItem, l: string): void {
  m.label = l;
  m.changed();
}
export function menuItemGetLabel(m: MenuItem): string {
  return m.label;
}
export function onMenuItemActivate(m: MenuItem, cb: () => void): SignalHandlerId {
  return m.connect("activate", cb);
}

export class CheckMenuItem extends MenuItem {
  override readonly kind: string = "checkMenuItem";
  active = false;
  override activate(): void {
    if (!this.sensitive) return;
    this.active = !this.active;
    this.changed();
    this.emit("toggled");
    super.activate();
  }
}
export function checkMenuItemNewWithLabel(label: string): CheckMenuItem {
  const m = new CheckMenuItem();
  m.label = label;
  m.useUnderline = false;
  return m;
}
export function checkMenuItemSetActive(m: CheckMenuItem, a: boolean): void {
  m.active = a;
  m.changed();
}
export function checkMenuItemGetActive(m: CheckMenuItem): boolean {
  return m.active;
}

export class SeparatorMenuItem extends MenuItem {
  override readonly kind: string = "separatorMenuItem";
}
export function separatorMenuItemNew(): SeparatorMenuItem {
  return new SeparatorMenuItem();
}

export class MenuBar extends MenuShell {
  override readonly kind: string = "menuBar";
}
export function menuBarNew(): MenuBar {
  return new MenuBar();
}

// =============================================================================================
// Toolbar

export class Toolbar extends Container {
  override readonly kind: string = "toolbar";
  orientation: Orientation = "OrientationHorizontal";
}
export function toolbarNew(): Toolbar {
  return new Toolbar();
}
export function toolbarInsert(t: Toolbar, item: Widget, pos: number): void {
  t.add(item);
  if (pos >= 0 && pos < t.children.length - 1) {
    t.children.splice(pos, 0, t.children.pop()!);
    t.changed();
  }
}

export class ToolItem extends Bin {
  override readonly kind: string = "toolItem";
  expand = false;
}
export function toolItemNew(): ToolItem {
  return new ToolItem();
}
export function toolItemSetTooltipText(t: ToolItem, text: string | null): void {
  t.tooltip = text;
  t.changed();
}
export function toolItemSetExpand(t: ToolItem, b: boolean): void {
  t.expand = b;
  t.changed();
}

export class ToolButton extends ToolItem {
  override readonly kind: string = "toolButton";
  label: string | null = null;
  iconName: string | null = null;
  iconWidget: Widget | null = null;
  useUnderline = true;
  actionName: string | null = null;
  click(): void {
    if (!this.sensitive) return;
    this.emit("clicked");
    if (this.actionName) activateActionFrom(this, this.actionName);
  }
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "label": this.label = value as string; break;
      case "iconName": this.iconName = value as string; break;
      case "useUnderline": this.useUnderline = value as boolean; break;
      case "actionName": this.actionName = value as string; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function toolButtonNew(icon: Widget | null, label: string | null): ToolButton {
  const t = new ToolButton();
  t.iconWidget = icon;
  t.label = label;
  return t;
}
export function toolButtonSetIconName(t: ToolButton, n: string | null): void {
  t.iconName = n;
  t.changed();
}
export function toolButtonSetLabel(t: ToolButton, l: string | null): void {
  t.label = l;
  t.changed();
}
export function toolButtonSetIconWidget(t: ToolButton, w: Widget | null): void {
  t.iconWidget = w;
  t.changed();
}
export function onToolButtonClicked(t: ToolButton, cb: () => void): SignalHandlerId {
  return t.connect("clicked", cb);
}

export class MenuToolButton extends ToolButton {
  override readonly kind: string = "menuToolButton";
  menu: Menu | null = null;
  arrowTooltip: string | null = null;
}
export function menuToolButtonNew(icon: Widget | null, label: string | null): MenuToolButton {
  const t = new MenuToolButton();
  t.iconWidget = icon;
  t.label = label;
  return t;
}
export function menuToolButtonSetMenu(t: MenuToolButton, m: Menu): void {
  t.menu = m;
  m.parent = t;
  t.changed();
}
export function menuToolButtonSetArrowTooltipText(t: MenuToolButton, s: string): void {
  t.arrowTooltip = s;
  t.changed();
}

export class SeparatorToolItem extends ToolItem {
  override readonly kind: string = "separatorToolItem";
  /** False: an invisible spacer (with `expand`, it pushes later items to the far end). */
  draw = true;
  override setProperty(name: string, value: unknown): void {
    if (name === "draw") {
      this.draw = value as boolean;
      this.changed();
    } else super.setProperty(name, value);
  }
}
export function separatorToolItemNew(): SeparatorToolItem {
  return new SeparatorToolItem();
}
export function separatorToolItemSetDraw(t: SeparatorToolItem, b: boolean): void {
  t.draw = b;
  t.changed();
}

// =============================================================================================
// Windows and dialogs

export class Window extends Bin {
  override readonly kind: string = "window";
  title = "";
  defaultWidth = -1;
  defaultHeight = -1;
  modal = false;
  transientFor: Window | null = null;
  iconName: string | null = null;
  role = "";
  position: WindowPosition = "WindowPositionNone";
  resizable = true;
  decorated = true;
  /** Gio actions registered with `actionMapAddAction` ("win." prefix). */
  actions = new Map<string, SimpleAction>();
  /** Keyboard accelerators: accelerator string ("<Control>s") → action name. */
  accels = new Map<string, string>();
  /** The main application window fills the browser viewport. */
  isMain = false;
  /**
   * Browser extension: called on `beforeunload` (tab closed or reloaded). Returning `true` makes
   * the browser ask the user to confirm leaving, which stands in for the desktop "save changes?"
   * prompt that a `delete-event` handler would show.
   */
  unloadGuard: (() => boolean) | null = null;
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "title": this.title = value as string; break;
      case "modal": this.modal = value as boolean; break;
      case "transientFor": this.transientFor = value as Window; break;
      case "defaultWidth": this.defaultWidth = value as number; break;
      case "defaultHeight": this.defaultHeight = value as number; break;
      case "iconName": this.iconName = value as string; break;
      case "role": this.role = value as string; break;
      case "windowPosition": this.position = value as WindowPosition; break;
      case "resizable": this.resizable = value as boolean; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
  /** User asked to close the window (close button / Escape). */
  requestClose(): void {
    const handled = this.emit("delete-event", {});
    if (handled !== true) this.destroy();
  }
}
export class ApplicationWindow extends Window {
  override readonly kind: string = "window";
}
export function windowNew(_t: unknown): Window {
  const w = new Window();
  return w;
}
export function windowSetTitle(w: Window, t: string): void {
  w.title = t;
  w.changed();
  if (w.isMain && typeof document !== "undefined") document.title = t;
}
export function windowGetTitle(w: Window): string {
  return w.title;
}
export function windowSetDefaultSize(w: Window, width: number, height: number): void {
  w.defaultWidth = width;
  w.defaultHeight = height;
  w.changed();
}
export function windowGetSize(w: Window): [number, number] {
  if (w.isMain && typeof window !== "undefined") return [window.innerWidth, window.innerHeight];
  return w.el ? [w.el.clientWidth, w.el.clientHeight] : [w.defaultWidth, w.defaultHeight];
}
export function windowSetTransientFor(w: Window, p: Window | null): void {
  w.transientFor = p;
}
export function windowSetModal(w: Window, m: boolean): void {
  w.modal = m;
  w.changed();
}
export function windowSetDefaultIconName(_n: string): void {}
export function windowSetIconName(w: Window, n: string | null): void {
  w.iconName = n;
}
export function windowPresent(w: Window): void {
  registerToplevel(w);
  w.visible = true;
  w.changed();
}
/** Browser extension: see `Window.unloadGuard`. */
export function windowSetUnloadGuard(w: Window, guard: (() => boolean) | null): void {
  w.unloadGuard = guard;
}
export function windowClose(w: Window): void {
  w.requestClose();
}
export function windowGetScreen(_w: Window): unknown {
  return null;
}
export function windowSetPosition(w: Window, p: WindowPosition): void {
  w.position = p;
}
export function windowSetResizable(w: Window, b: boolean): void {
  w.resizable = b;
}
/** The toplevel `Window` containing a widget, if any. */
export function widgetGetWindow(w: Widget): Window | null {
  const t = w.toplevel();
  return t instanceof Window ? t : null;
}

export class Dialog extends Window {
  override readonly kind: string = "dialog";
  readonly contentArea: Box;
  readonly actionArea: ButtonBox;
  defaultResponse: number | null = null;
  private runResolvers: ((r: number) => void)[] = [];
  constructor() {
    super();
    this.modal = true;
    this.contentArea = boxNew("OrientationVertical", 2);
    this.contentArea.parent = this;
    this.actionArea = buttonBoxNew("OrientationHorizontal");
    this.actionArea.layout = "ButtonBoxStyleEnd";
    this.actionArea.parent = this;
  }
  override getChildren(): Widget[] {
    return [this.contentArea, this.actionArea];
  }
  override add(w: Widget): void {
    boxPackStart(this.contentArea, w, true, true, 0);
  }
  /** Emit a response, resolve `dialogRun` promises. */
  respond(r: number): void {
    const resolvers = this.runResolvers;
    this.runResolvers = [];
    this.emit("response", r);
    for (const res of resolvers) res(r);
  }
  override requestClose(): void {
    const handled = this.emit("delete-event", {});
    if (handled === true) return;
    this.respond(ResponseTypeDeleteEvent);
    // GTK destroys a dialog on delete-event unless it is being run.
    if (!this.destroyed && !this.keepOnDelete) this.destroy();
  }
  /** `dialogRun` keeps the dialog alive after delete-event, as GTK does. */
  keepOnDelete = false;
  run(): Promise<number> {
    registerToplevel(this);
    this.visible = true;
    this.keepOnDelete = true;
    this.changed();
    return new Promise((resolve) => {
      this.runResolvers.push((r) => {
        this.keepOnDelete = false;
        resolve(r);
      });
    });
  }
}
export function dialogNew(): Dialog {
  return new Dialog();
}
export function dialogGetContentArea(d: Dialog): Box {
  return d.contentArea;
}
export function dialogGetActionArea(d: Dialog): ButtonBox {
  return d.actionArea;
}
export function dialogAddButton(d: Dialog, label: string, response: number): Button {
  const b = buttonNewWithMnemonic(label);
  b.connect("clicked", () => d.respond(response));
  b.data.set("response", response);
  boxPackEnd(d.actionArea, b, false, true, 0);
  d.changed();
  return b;
}
export function dialogAddActionWidget(d: Dialog, w: Widget, response: number): void {
  if (w instanceof Button) w.connect("clicked", () => d.respond(response));
  w.data.set("response", response);
  boxPackEnd(d.actionArea, w, false, true, 0);
}
export function dialogSetDefaultResponse(d: Dialog, r: number): void {
  d.defaultResponse = r;
}
export function dialogResponse(d: Dialog, r: number): void {
  d.respond(r);
}
/** `dialogRun`: shows the dialog and resolves with the response. */
export function dialogRun(d: Dialog): Promise<number> {
  return d.run();
}
export function onDialogResponse(d: Dialog, cb: (r: number) => void): SignalHandlerId {
  return d.connect("response", cb);
}

export class MessageDialog extends Dialog {
  override readonly kind: string = "messageDialog";
  messageType: MessageType = "MessageTypeInfo";
  buttons: ButtonsType = "ButtonsTypeNone";
  text = "";
  secondaryText = "";
  useMarkup = false;
  private buttonsAdded = false;
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "messageType": this.messageType = value as MessageType; break;
      case "buttons": this.buttons = value as ButtonsType; this.addStandardButtons(); break;
      case "text": this.text = value as string; break;
      case "secondaryText": this.secondaryText = value as string; break;
      case "useMarkup": this.useMarkup = value as boolean; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
  addStandardButtons(): void {
    if (this.buttonsAdded) return;
    this.buttonsAdded = true;
    switch (this.buttons) {
      case "ButtonsTypeOk": dialogAddButton(this, "_OK", ResponseTypeOk); break;
      case "ButtonsTypeClose": dialogAddButton(this, "_Close", ResponseTypeClose); break;
      case "ButtonsTypeCancel": dialogAddButton(this, "_Cancel", ResponseTypeCancel); break;
      case "ButtonsTypeYesNo":
        dialogAddButton(this, "_No", ResponseTypeNo);
        dialogAddButton(this, "_Yes", ResponseTypeYes);
        break;
      case "ButtonsTypeOkCancel":
        dialogAddButton(this, "_Cancel", ResponseTypeCancel);
        dialogAddButton(this, "_OK", ResponseTypeOk);
        break;
      default: break;
    }
  }
}
export function messageDialogNew(
  parent: Window | null, _flags: unknown, type: MessageType, buttons: ButtonsType, text: string,
): MessageDialog {
  const m = new MessageDialog();
  m.transientFor = parent;
  m.messageType = type;
  m.buttons = buttons;
  m.text = text;
  m.addStandardButtons();
  return m;
}
export function messageDialogFormatSecondaryText(m: MessageDialog, t: string): void {
  m.secondaryText = t;
  m.changed();
}

export class AboutDialog extends Dialog {
  override readonly kind: string = "aboutDialog";
  programName = "";
  version = "";
  comments = "";
  copyright = "";
  website = "";
  websiteLabel = "";
  license = "";
  authors: string[] = [];
  logoIconName: string | null = null;
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "programName": this.programName = value as string; break;
      case "version": this.version = value as string; break;
      case "comments": this.comments = value as string; break;
      case "copyright": this.copyright = value as string; break;
      case "website": this.website = value as string; break;
      case "websiteLabel": this.websiteLabel = value as string; break;
      case "license": this.license = value as string; break;
      case "authors": this.authors = value as string[]; break;
      case "logoIconName": this.logoIconName = value as string; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function aboutDialogNew(): AboutDialog {
  const a = new AboutDialog();
  dialogAddButton(a, "_Close", ResponseTypeClose);
  a.connect("response", () => a.destroy());
  return a;
}

/** Show a toplevel (window or dialog). */
export function showToplevel(w: Window): void {
  registerToplevel(w);
  w.visible = true;
  w.changed();
}
export { unregisterToplevel };

// =============================================================================================
// Actions (Gio.ActionMap on windows)

/** Find the action named "win.xxx" or "app.xxx" from a widget's toplevel and activate it. */
export function activateActionFrom(w: Widget, actionName: string): void {
  const name = actionName.replace(/^(win|app)\./, "");
  let cur: Widget | null = w;
  while (cur) {
    if (cur instanceof Window && cur.actions.has(name)) {
      const a = cur.actions.get(name)!;
      a.activate(null);
      return;
    }
    // Menus are parented to their attach widget / tool button.
    cur = cur.parent ?? (cur instanceof Menu ? cur.attachWidget : null);
  }
  for (const t of mainWindows) {
    if (t.actions.has(name)) {
      t.actions.get(name)!.activate(null);
      return;
    }
  }
  console.warn("No action " + actionName);
}

/** Look up whether an action is enabled (for widgets bound to actions). */
export function actionEnabledFor(w: Widget, actionName: string): boolean {
  const name = actionName.replace(/^(win|app)\./, "");
  for (const t of mainWindows) if (t.actions.has(name)) return t.actions.get(name)!.enabled;
  let cur: Widget | null = w;
  while (cur) {
    if (cur instanceof Window && cur.actions.has(name)) return cur.actions.get(name)!.enabled;
    cur = cur.parent ?? (cur instanceof Menu ? cur.attachWidget : null);
  }
  return true;
}

/** Application windows, in creation order. */
export const mainWindows: Window[] = [];
export function applicationWindowNew(_app: unknown): ApplicationWindow {
  const w = new ApplicationWindow();
  w.isMain = mainWindows.length === 0;
  mainWindows.push(w);
  return w;
}
/** Mark a window as the main application window (fills the browser viewport). */
export function setMainWindow(w: Window): void {
  w.isMain = true;
  if (!mainWindows.includes(w)) mainWindows.unshift(w);
}

export { Align as _Align, ResponseTypeNone };
