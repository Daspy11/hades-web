/**
 * Combo boxes, icon views, the colour chooser dialog and the native file chooser for the web
 * GTK replacement.
 */
import { GObject, Widget, registerToplevel, type SignalHandlerId, type SelectionMode } from "./Core";
import { Dialog, dialogAddButton, Window, boxPackStart } from "./Widgets";
import { TreeModel, TreeIter, RowNode, type TreePath } from "./TreeModel";
import { CellRenderer, computeCellProps, TreeViewColumn } from "./TreeView";
import type { RGBA } from "../Gdk";
import { pickFileToOpen, pickFileToSave, downloadPath, hasNativeSave, type PickerFilter } from "../../System/IO";
import { ResponseTypeAccept, ResponseTypeCancel, ResponseTypeOk } from "./Core";

// =============================================================================================
// ComboBox (a CellLayout over a model)

export class ComboBox extends Widget {
  override readonly kind: string = "comboBox";
  model: TreeModel | null = null;
  active = -1;
  /** The combo box behaves as a CellLayout with a single implicit column. */
  readonly layout = new TreeViewColumn();
  idColumn = -1;
  entryTextColumn = -1;
  override canFocus = true;
  private handler: SignalHandlerId | null = null;
  setModel(m: TreeModel | null): void {
    if (this.model && this.handler !== null) this.model.disconnect(this.handler);
    this.model = m;
    this.handler = m ? m.connect("model-changed", () => this.changed()) : null;
    this.changed();
  }
  setActive(n: number, user: boolean): void {
    if (this.active === n) return;
    this.active = n;
    this.changed();
    this.emit("changed");
    void user;
  }
  /** Rendered properties of item n (for the renderer). */
  itemProps(n: RowNode): Record<string, any>[] {
    const m = this.model;
    if (!m) return [];
    return this.layout.cells.map((pc) => ({ kind: pc.cell.kind, ...computeCellProps(m, n, this.layout, pc.cell) }));
  }
  override setProperty(name: string, value: unknown): void {
    if (name === "model") return this.setModel(value as TreeModel);
    if (name === "active") return this.setActive(value as number, false);
    if (name === "idColumn") {
      this.idColumn = value as number;
      return;
    }
    if (name === "entryTextColumn") {
      this.entryTextColumn = value as number;
      return;
    }
    super.setProperty(name, value);
  }
}
export function comboBoxNew(): ComboBox {
  return new ComboBox();
}
export function comboBoxNewWithModel(m: TreeModel): ComboBox {
  const c = new ComboBox();
  c.setModel(m);
  return c;
}
export function comboBoxSetModel(c: ComboBox, m: TreeModel | null): void {
  c.setModel(m);
}
export function comboBoxGetModel(c: ComboBox): TreeModel | null {
  return c.model;
}
export function comboBoxSetActive(c: ComboBox, n: number): void {
  c.setActive(n, false);
}
export function comboBoxGetActive(c: ComboBox): number {
  return c.active;
}
export function comboBoxGetActiveIter(c: ComboBox): [boolean, TreeIter] {
  const n = c.model?.roots()[c.active] ?? null;
  return [n !== null, new TreeIter(c.model, n)];
}
export function comboBoxSetActiveIter(c: ComboBox, it: TreeIter | null): void {
  const i = it && it.node && c.model ? c.model.roots().indexOf(it.node) : -1;
  c.setActive(i, false);
}
export function onComboBoxChanged(c: ComboBox, cb: () => void): SignalHandlerId {
  return c.connect("changed", cb);
}
/** `cellLayoutPackStart` for a combo box. */
export function comboCellLayoutPackStart(c: ComboBox, cell: CellRenderer, expand: boolean): void {
  c.layout.cells.push({ cell, expand, end: false });
  c.changed();
}
export function comboCellLayoutAddAttribute(c: ComboBox, cell: CellRenderer, prop: string, col: number): void {
  const m = c.layout.attributes.get(cell) ?? new Map<string, number>();
  m.set(prop.replace(/-([a-z])/g, (_x, ch: string) => ch.toUpperCase()), col);
  c.layout.attributes.set(cell, m);
  c.changed();
}

/** A simple text combo box (`GtkComboBoxText`). */
export class ComboBoxText extends ComboBox {
  override readonly kind: string = "comboBoxText";
  items: string[] = [];
}
export function comboBoxTextNew(): ComboBoxText {
  return new ComboBoxText();
}
export function comboBoxTextAppendText(c: ComboBoxText, t: string): void {
  c.items.push(t);
  c.changed();
}
export function comboBoxTextGetActiveText(c: ComboBoxText): string | null {
  return c.items[c.active] ?? null;
}

// =============================================================================================
// IconView

export class IconView extends Widget {
  override readonly kind: string = "iconView";
  model: TreeModel | null = null;
  textColumn = -1;
  pixbufColumn = -1;
  markupColumn = -1;
  tooltipColumn = -1;
  itemWidth = -1;
  columns = -1;
  selectionMode: SelectionMode = "SelectionModeSingle";
  selected: RowNode | null = null;
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "model": this.model = value as TreeModel; break;
      case "selectionMode": this.selectionMode = value as SelectionMode; break;
      case "textColumn": this.textColumn = value as number; break;
      case "pixbufColumn": this.pixbufColumn = value as number; break;
      case "markupColumn": this.markupColumn = value as number; break;
      case "tooltipColumn": this.tooltipColumn = value as number; break;
      case "itemWidth": this.itemWidth = value as number; break;
      case "columns": this.columns = value as number; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }
}
export function iconViewNew(): IconView {
  return new IconView();
}
export function iconViewNewWithModel(m: TreeModel): IconView {
  const v = new IconView();
  v.model = m;
  return v;
}
export function iconViewSetModel(v: IconView, m: TreeModel | null): void {
  v.model = m;
  v.changed();
}
export function iconViewSetTextColumn(v: IconView, n: number): void {
  v.textColumn = n;
  v.changed();
}
export function iconViewSetPixbufColumn(v: IconView, n: number): void {
  v.pixbufColumn = n;
  v.changed();
}
export function iconViewSetTooltipColumn(v: IconView, n: number): void {
  v.tooltipColumn = n;
  v.changed();
}
export function iconViewSetItemWidth(v: IconView, n: number): void {
  v.itemWidth = n;
  v.changed();
}
export function onIconViewItemActivated(v: IconView, cb: (p: TreePath) => void): SignalHandlerId {
  return v.connect("item-activated", cb);
}
export function onIconViewSelectionChanged(v: IconView, cb: () => void): SignalHandlerId {
  return v.connect("selection-changed", cb);
}
export function iconViewGetSelectedItems(v: IconView): TreePath[] {
  return v.selected && v.model ? [v.model.pathOf(v.selected)] : [];
}

// =============================================================================================
// Colour chooser dialog

export class ColorChooserDialog extends Dialog {
  override readonly kind: string = "colorChooserDialog";
  rgba: RGBA = { red: 1, green: 1, blue: 1, alpha: 1 };
  useAlpha = false;
  /** Called by the renderer when the user picks a colour. */
  userSetRgba(c: RGBA): void {
    this.rgba = c;
    this.changed();
    this.emit("notify::rgba");
  }
}
export function colorChooserDialogNew(title: string | null, parent: Window | null): ColorChooserDialog {
  const d = new ColorChooserDialog();
  d.title = title ?? "Select a colour";
  d.transientFor = parent;
  dialogAddButton(d, "_Cancel", ResponseTypeCancel);
  dialogAddButton(d, "_Select", ResponseTypeOk);
  return d;
}
export function colorChooserSetRgba(d: ColorChooserDialog, c: RGBA): void {
  d.rgba = { ...c };
  d.changed();
}
export function colorChooserGetRgba(d: ColorChooserDialog): RGBA {
  return { ...d.rgba };
}
export function colorChooserSetUseAlpha(d: ColorChooserDialog, b: boolean): void {
  d.useAlpha = b;
}

// =============================================================================================
// File chooser

export type FileChooserAction =
  | "FileChooserActionOpen" | "FileChooserActionSave" | "FileChooserActionSelectFolder" | "FileChooserActionCreateFolder";
export const FileChooserActionOpen: FileChooserAction = "FileChooserActionOpen";
export const FileChooserActionSave: FileChooserAction = "FileChooserActionSave";
export const FileChooserActionSelectFolder: FileChooserAction = "FileChooserActionSelectFolder";

export class FileFilter extends GObject {
  name = "";
  patterns: string[] = [];
  mimeTypes: string[] = [];
}
export function fileFilterNew(): FileFilter {
  return new FileFilter();
}
export function fileFilterSetName(f: FileFilter, n: string | null): void {
  f.name = n ?? "";
}
export function fileFilterAddPattern(f: FileFilter, p: string): void {
  f.patterns.push(p);
}
export function fileFilterAddMimeType(f: FileFilter, m: string): void {
  f.mimeTypes.push(m);
}
export function fileFilterAddPixbufFormats(f: FileFilter): void {
  f.mimeTypes.push("image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp", "image/bmp");
  f.patterns.push("*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.webp", "*.bmp");
}

/**
 * `GtkFileChooserNative`: uses the browser's native pickers (File System Access API where
 * available). Without native save support, a small in-app dialog asks for the file name and
 * the file is downloaded when written.
 */
export class FileChooserNative extends GObject {
  title = "";
  action: FileChooserAction = "FileChooserActionOpen";
  acceptLabel = "";
  cancelLabel = "";
  filters: FileFilter[] = [];
  currentName = "";
  filename: string | null = null;
  overwriteConfirmation = false;
  modal = true;
  transientFor: Window | null = null;
  setProperty(name: string, value: unknown): void {
    switch (name) {
      case "title": this.title = value as string; break;
      case "action": this.action = value as FileChooserAction; break;
      case "acceptLabel": this.acceptLabel = value as string; break;
      case "cancelLabel": this.cancelLabel = value as string; break;
      case "modal": this.modal = value as boolean; break;
      case "transientFor": this.transientFor = value as Window; break;
      case "doOverwriteConfirmation": this.overwriteConfirmation = value as boolean; break;
      default: break;
    }
  }
}
export function fileChooserNativeNew(title: string | null, parent: Window | null, action: FileChooserAction, accept: string | null, cancel: string | null): FileChooserNative {
  const f = new FileChooserNative();
  f.title = title ?? "";
  f.transientFor = parent;
  f.action = action;
  f.acceptLabel = accept ?? "";
  f.cancelLabel = cancel ?? "";
  return f;
}
export function fileChooserAddFilter(f: FileChooserNative, filt: FileFilter): void {
  f.filters.push(filt);
}
export function fileChooserSetFilename(f: FileChooserNative, name: string): boolean {
  f.filename = name;
  const i = name.lastIndexOf("/");
  f.currentName = i >= 0 ? name.slice(i + 1) : name;
  return true;
}
export function fileChooserSetCurrentName(f: FileChooserNative, name: string): void {
  f.currentName = name;
}
export function fileChooserGetFilename(f: FileChooserNative): string | null {
  return f.filename;
}
export function fileChooserSetDoOverwriteConfirmation(f: FileChooserNative, b: boolean): void {
  f.overwriteConfirmation = b;
}
export function fileChooserSetCurrentFolder(_f: FileChooserNative, _dir: string): boolean {
  return true;
}

function pickerFilters(f: FileChooserNative): PickerFilter[] {
  return f.filters.map((x) => ({ name: x.name, patterns: x.patterns, mimeTypes: x.mimeTypes }));
}

/** `nativeDialogRun`: resolves with `ResponseTypeAccept` or `ResponseTypeCancel`. */
export async function nativeDialogRun(f: FileChooserNative): Promise<number> {
  if (f.action === "FileChooserActionOpen") {
    const r = await pickFileToOpen(pickerFilters(f));
    if (r.tag === "Nothing") return ResponseTypeCancel;
    f.filename = r.value;
    return ResponseTypeAccept;
  }
  if (f.action === "FileChooserActionSave") {
    let name = f.currentName || "untitled";
    if (!hasNativeSave()) {
      const chosen = await askFileName(f.title || "Save File", name, f.transientFor);
      if (chosen === null) return ResponseTypeCancel;
      f.filename = downloadPath(chosen);
      return ResponseTypeAccept;
    }
    const r = await pickFileToSave(name, pickerFilters(f));
    if (r.tag === "Nothing") return ResponseTypeCancel;
    name = r.value;
    f.filename = name;
    return ResponseTypeAccept;
  }
  // Folder selection has no equivalent for downloads; report it as cancelled.
  return ResponseTypeCancel;
}
export function nativeDialogDestroy(_f: FileChooserNative): void {}
export function nativeDialogShow(f: FileChooserNative): void {
  void nativeDialogRun(f).then((r) => f.emit("response", r));
}
export function onNativeDialogResponse(f: FileChooserNative, cb: (r: number) => void): SignalHandlerId {
  return f.connect("response", cb);
}

/** In-app "Save As" name prompt, used when the browser has no native save dialog. */
async function askFileName(title: string, suggested: string, parent: Window | null): Promise<string | null> {
  const { entryNew, entrySetText, labelNew, onEntryActivate, entryGetText } = await import("./Widgets");
  const d = new Dialog();
  d.title = title;
  d.transientFor = parent;
  const lbl = labelNew("File name:");
  lbl.xalign = 0;
  const e = entryNew();
  entrySetText(e, suggested);
  e.widthChars = 40;
  boxPackStart(d.contentArea, lbl, false, false, 4);
  boxPackStart(d.contentArea, e, false, false, 4);
  dialogAddButton(d, "_Cancel", ResponseTypeCancel);
  dialogAddButton(d, "_Save", ResponseTypeOk);
  onEntryActivate(e, () => d.respond(ResponseTypeOk));
  registerToplevel(d);
  const r = await d.run();
  const name = entryGetText(e).trim();
  d.destroy();
  return r === ResponseTypeOk && name.length > 0 ? name : null;
}
