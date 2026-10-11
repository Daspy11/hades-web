/**
 * GtkTreeView for the web toolkit: columns, cell renderers (text, pixbuf, combo, toggle),
 * selection, expansion, in-place editing and drag and drop. Rendering is in `Render.tsx`.
 */
import { GObject, Widget, type SelectionMode, type SignalHandlerId, type TreeViewGridLines, type TreeViewDropPosition } from "./Core";
import {
  TreeModel, TreeModelSort, TreePath, TreeIter, RowNode, type GValue, toGValue, type SeqStore, type ForestStore,
} from "./TreeModel";
import { Entry } from "./Widgets";
import type { EventButton, DragContext } from "../Gdk";

// ---------------------------------------------------------------------------------------------
// Cell renderers

export class CellRenderer extends GObject {
  readonly kind: string = "cell";
  /** Properties used when rendering a row (reset to `base` before each row). */
  props: Record<string, any> = {};
  base: Record<string, any> = { visible: true, sensitive: true };
  rendering = false;
  constructor() {
    super();
    this.props = { ...this.base };
  }
  setProperty(name: string, value: unknown): void {
    if (this.rendering) this.props[name] = value;
    else {
      this.base[name] = value;
      this.props[name] = value;
    }
  }
}
export class CellRendererText extends CellRenderer {
  override readonly kind: string = "text";
}
export class CellRendererPixbuf extends CellRenderer {
  override readonly kind: string = "pixbuf";
}
export class CellRendererToggle extends CellRenderer {
  override readonly kind: string = "toggle";
}
export class CellRendererCombo extends CellRendererText {
  override readonly kind: string = "combo";
}
export function cellRendererTextNew(): CellRendererText {
  return new CellRendererText();
}
export function cellRendererPixbufNew(): CellRendererPixbuf {
  return new CellRendererPixbuf();
}
export function cellRendererToggleNew(): CellRendererToggle {
  return new CellRendererToggle();
}
export function cellRendererComboNew(): CellRendererCombo {
  return new CellRendererCombo();
}
export function toCellRenderer(c: CellRenderer): CellRenderer {
  return c;
}
export function setCellRendererTextEditable(c: CellRendererText, b: boolean): void {
  c.setProperty("editable", b);
}
export function clearCellRendererTextForeground(c: CellRendererText): void {
  c.setProperty("foreground", null);
  c.setProperty("foregroundRgba", null);
}
export function clearCellRendererTextBackground(c: CellRendererText): void {
  c.setProperty("background", null);
  c.setProperty("cellBackground", null);
  c.setProperty("backgroundRgba", null);
}
/** Stop an in-progress edit (the active editor is cancelled when `canceled`). */
export function cellRendererStopEditing(c: CellRenderer, canceled: boolean): void {
  c.emit("__stop-editing", canceled);
}
export function cellEditableEditingDone(e: Entry): void {
  e.emit("editing-done");
}
export function onCellRendererTextEdited(c: CellRendererText, cb: (path: string, text: string) => void): SignalHandlerId {
  return c.connect("edited", cb);
}
/** The editable passed to the handler is an `Entry` widget. */
export function onCellRendererEditingStarted(c: CellRenderer, cb: (editable: Entry, path: string) => void): SignalHandlerId {
  return c.connect("editing-started", cb);
}
export function onCellRendererEditingCanceled(c: CellRenderer, cb: () => void): SignalHandlerId {
  return c.connect("editing-canceled", cb);
}
/** The iterator refers to the combo's own model. */
export function onCellRendererComboChanged(c: CellRendererCombo, cb: (path: string, it: TreeIter) => void): SignalHandlerId {
  return c.connect("changed", cb);
}
export function onCellRendererToggleToggled(c: CellRendererToggle, cb: (path: string) => void): SignalHandlerId {
  return c.connect("toggled", cb);
}

// ---------------------------------------------------------------------------------------------
// Columns

export interface PackedCell {
  readonly cell: CellRenderer;
  readonly expand: boolean;
  readonly end: boolean;
}

export class TreeViewColumn extends GObject {
  title = "";
  resizable = false;
  reorderable = false;
  expand = false;
  visible = true;
  minWidth = -1;
  fixedWidth = -1;
  sortIndicator = false;
  clickable = false;
  cells: PackedCell[] = [];
  /** cell → (property → model column). */
  attributes = new Map<CellRenderer, Map<string, number>>();
  /** cell → per-row data function (called with the row's iterator). */
  dataFuncs = new Map<CellRenderer, (model: TreeModel, it: TreeIter) => void>();
  view: TreeView | null = null;
  /** User-resized width. */
  width = -1;
  setProperty(name: string, value: unknown): void {
    switch (name) {
      case "title": this.title = value as string; break;
      case "resizable": this.resizable = value as boolean; break;
      case "reorderable": this.reorderable = value as boolean; break;
      case "expand": this.expand = value as boolean; break;
      case "visible": this.visible = value as boolean; break;
      case "minWidth": this.minWidth = value as number; break;
      case "fixedWidth": this.fixedWidth = value as number; break;
      case "sortIndicator": this.sortIndicator = value as boolean; break;
      case "clickable": this.clickable = value as boolean; break;
      default: break;
    }
    this.view?.changed();
  }
}
export function treeViewColumnNew(): TreeViewColumn {
  return new TreeViewColumn();
}
export function treeViewColumnSetTitle(c: TreeViewColumn, t: string): void {
  c.setProperty("title", t);
}
export function treeViewColumnPackStart(c: TreeViewColumn, cell: CellRenderer, expand: boolean): void {
  c.cells.push({ cell, expand, end: false });
  c.view?.changed();
}
export function treeViewColumnPackEnd(c: TreeViewColumn, cell: CellRenderer, expand: boolean): void {
  c.cells.push({ cell, expand, end: true });
  c.view?.changed();
}
export const cellLayoutPackStart = treeViewColumnPackStart;
export const cellLayoutPackEnd = treeViewColumnPackEnd;
export function cellLayoutGetCells(c: TreeViewColumn): CellRenderer[] {
  return c.cells.map((p) => p.cell);
}
/** Map a renderer property to a model column ("text", "icon-name", "pixbuf", ...). */
export function cellLayoutAddAttribute(c: TreeViewColumn, cell: CellRenderer, prop: string, col: number): void {
  const m = c.attributes.get(cell) ?? new Map<string, number>();
  m.set(camel(prop), col);
  c.attributes.set(cell, m);
  c.view?.changed();
}
export function cellLayoutClearAttributes(c: TreeViewColumn, cell: CellRenderer): void {
  c.attributes.delete(cell);
}
function camel(p: string): string {
  return p.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
}
export function treeViewColumnSetCellDataFunc(
  c: TreeViewColumn, cell: CellRenderer, f: ((col: TreeViewColumn, cell: CellRenderer, model: TreeModel, it: TreeIter) => void) | null,
): void {
  if (f) c.dataFuncs.set(cell, (m, it) => f(c, cell, m, it));
  else c.dataFuncs.delete(cell);
}
export const cellLayoutSetCellDataFunc = treeViewColumnSetCellDataFunc;

/**
 * `Data.GI.Gtk.ModelView.cellLayoutSetAttributes col cell model (\row -> [props])`.
 * The function receives the row value of the typed store (for a `TreeModelSort` over a typed
 * store, the child row) and returns the properties to set.
 */
export function mvCellLayoutSetAttributes<A>(
  c: TreeViewColumn, cell: CellRenderer, _model: TreeModel, f: (row: A) => Record<string, unknown>,
): void {
  c.dataFuncs.set(cell, (m, it) => {
    const props = f(rowValue(m, it) as A);
    for (const [k, v] of Object.entries(props)) cell.setProperty(k, v);
  });
  c.view?.changed();
}
/** `Data.GI.Gtk.ModelView.cellLayoutSetDataFunction col cell model (\row -> action)`. */
export function mvCellLayoutSetDataFunction<A>(
  c: TreeViewColumn, cell: CellRenderer, _model: TreeModel, f: (row: A) => void,
): void {
  c.dataFuncs.set(cell, (m, it) => f(rowValue(m, it) as A));
  c.view?.changed();
}

/** The row value of a typed store, looking through a TreeModelSort. */
export function rowValue(m: TreeModel, it: TreeIter): unknown {
  if (!it.node) return undefined;
  if (m instanceof TreeModelSort) return (it.node.data as RowNode).data;
  return it.node.data;
}

// ---------------------------------------------------------------------------------------------
// Selection

export class TreeSelection extends GObject {
  mode: SelectionMode = "SelectionModeSingle";
  /** Keys of selected rows (see `TreeView.keyOf`). */
  selected = new Set<RowNode>();
  selectFunction: ((sel: TreeSelection, model: TreeModel, path: TreePath, currentlySelected: boolean) => boolean) | null = null;
  constructor(readonly view: TreeView) {
    super();
  }
  notify(): void {
    this.view.changed();
    this.emit("changed");
  }
}
export function treeViewGetSelection(v: TreeView): TreeSelection {
  return v.selection;
}
export function treeSelectionGetTreeView(s: TreeSelection): TreeView {
  return s.view;
}
export function treeSelectionSetMode(s: TreeSelection, m: SelectionMode): void {
  s.mode = m;
}
export function treeSelectionGetMode(s: TreeSelection): SelectionMode {
  return s.mode;
}
export function treeSelectionSetSelectFunction(
  s: TreeSelection, f: ((sel: TreeSelection, model: TreeModel, path: TreePath, current: boolean) => boolean) | null,
): void {
  s.selectFunction = f;
}
/** Returns (isSelected, model, iter) for single selection modes. */
export function treeSelectionGetSelected(s: TreeSelection): [boolean, TreeModel | null, TreeIter] {
  const v = s.view;
  const m = v.model;
  for (const k of s.selected) {
    const n = v.nodeOfKey(k);
    if (n && m) return [true, m, m.iter(n)];
  }
  return [false, m, new TreeIter(m, null)];
}
export function treeSelectionGetSelectedRows(s: TreeSelection): [TreePath[], TreeModel | null] {
  const v = s.view;
  const m = v.model;
  if (!m) return [[], null];
  const paths: TreePath[] = [];
  for (const k of s.selected) {
    const n = v.nodeOfKey(k);
    if (n) paths.push(m.pathOf(n));
  }
  paths.sort((a, b) => {
    const n = Math.min(a.indices.length, b.indices.length);
    for (let i = 0; i < n; i++) if (a.indices[i] !== b.indices[i]) return a.indices[i] - b.indices[i];
    return a.indices.length - b.indices.length;
  });
  return [paths, m];
}
export function treeSelectionCountSelectedRows(s: TreeSelection): number {
  return treeSelectionGetSelectedRows(s)[0].length;
}
export function treeSelectionSelectPath(s: TreeSelection, p: TreePath): void {
  const n = s.view.model?.nodeAt(p);
  if (!n) return;
  if (s.mode !== "SelectionModeMultiple") s.selected.clear();
  s.selected.add(s.view.keyOf(n));
  s.notify();
}
export function treeSelectionUnselectPath(s: TreeSelection, p: TreePath): void {
  const n = s.view.model?.nodeAt(p);
  if (n && s.selected.delete(s.view.keyOf(n))) s.notify();
}
export function treeSelectionSelectIter(s: TreeSelection, it: TreeIter): void {
  if (!it.node) return;
  if (s.mode !== "SelectionModeMultiple") s.selected.clear();
  s.selected.add(s.view.keyOf(it.node));
  s.notify();
}
export function treeSelectionUnselectIter(s: TreeSelection, it: TreeIter): void {
  if (it.node && s.selected.delete(s.view.keyOf(it.node))) s.notify();
}
export function treeSelectionUnselectAll(s: TreeSelection): void {
  if (s.selected.size === 0) return;
  s.selected.clear();
  s.notify();
}
export function treeSelectionSelectAll(s: TreeSelection): void {
  const m = s.view.model;
  if (!m) return;
  const go = (ns: RowNode[]) => ns.forEach((n) => {
    s.selected.add(s.view.keyOf(n));
    go(n.children);
  });
  go(m.roots());
  s.notify();
}
export function treeSelectionPathIsSelected(s: TreeSelection, p: TreePath): boolean {
  const n = s.view.model?.nodeAt(p);
  return !!n && s.selected.has(s.view.keyOf(n));
}
export function onTreeSelectionChanged(s: TreeSelection, cb: () => void): SignalHandlerId {
  return s.connect("changed", cb);
}

// ---------------------------------------------------------------------------------------------
// TreeView

export interface EditingState {
  readonly path: string;
  readonly column: TreeViewColumn;
  readonly cell: CellRenderer;
  readonly entry: Entry;
}

export class TreeView extends Widget {
  override readonly kind: string = "treeView";
  model: TreeModel | null = null;
  columns: TreeViewColumn[] = [];
  readonly selection = new TreeSelection(this);
  /** Keys of expanded rows. */
  expanded = new Set<RowNode>();
  headersVisible = true;
  enableTreeLines = false;
  gridLines: TreeViewGridLines = "TreeViewGridLinesNone";
  reorderable = false;
  tooltipColumn = -1;
  activateOnSingleClick = false;
  dragSource = false;
  /** Drag targets registered with `treeViewEnableModelDragSource` (null: the default target). */
  dragTargets: string[] | null = null;
  dragDest = false;
  dragDestRow: { path: TreePath; pos: TreeViewDropPosition } | null = null;
  editing: EditingState | null = null;
  override canFocus = true;
  private modelHandler: SignalHandlerId | null = null;

  setModel(m: TreeModel | null): void {
    if (this.model && this.modelHandler !== null) this.model.disconnect(this.modelHandler);
    this.model = m;
    this.modelHandler = m ? m.connect("model-changed", () => this.onModelChanged()) : null;
    this.changed();
  }
  private onModelChanged(): void {
    // Drop selection entries for rows that no longer exist.
    if (this.selection.selected.size > 0) {
      let removed = false;
      for (const k of Array.from(this.selection.selected)) {
        if (!this.nodeOfKey(k)) {
          this.selection.selected.delete(k);
          removed = true;
        }
      }
      if (removed) this.selection.emit("changed");
    }
    this.changed();
  }
  /** Identity key for a row that survives re-sorting of a TreeModelSort. */
  keyOf(n: RowNode): RowNode {
    return this.model instanceof TreeModelSort ? (n.data as RowNode) : n;
  }
  nodeOfKey(k: RowNode): RowNode | null {
    if (this.model instanceof TreeModelSort) return this.model.sortedNodeFor(k);
    if (!this.model) return null;
    let n: RowNode | null = k;
    while (n.parent) n = n.parent;
    return this.model.roots().includes(n) ? k : null;
  }
  isExpanded(n: RowNode): boolean {
    return this.expanded.has(this.keyOf(n));
  }
  override setProperty(name: string, value: unknown): void {
    switch (name) {
      case "model": this.setModel(value as TreeModel); return;
      case "headersVisible": this.headersVisible = value as boolean; break;
      case "enableTreeLines": this.enableTreeLines = value as boolean; break;
      case "enableGridLines": this.gridLines = value as TreeViewGridLines; break;
      case "reorderable": this.reorderable = value as boolean; break;
      case "tooltipColumn": this.tooltipColumn = value as number; break;
      case "activateOnSingleClick": this.activateOnSingleClick = value as boolean; break;
      default: return super.setProperty(name, value);
    }
    this.changed();
  }

  /** Begin editing a cell (called by the renderer). */
  startEditing(path: TreePath, column: TreeViewColumn, cell: CellRenderer, text: string): void {
    this.stopEditing(true);
    const entry = new Entry();
    entry.text = text;
    entry.parent = this;
    const pathStr = path.toString();
    const finish = (cancel: boolean) => {
      if (this.editing?.entry !== entry) return;
      this.editing = null;
      this.changed();
      if (cancel) cell.emit("editing-canceled");
      else cell.emit("edited", pathStr, entry.text);
      entry.destroy();
    };
    entry.connect("activate", () => finish(false));
    entry.connect("editing-done", () => finish(false));
    entry.data.set("finish", finish);
    const stopId = cell.connect("__stop-editing", (canceled: boolean) => {
      cell.disconnect(stopId);
      finish(canceled);
    });
    this.editing = { path: pathStr, column, cell, entry };
    this.changed();
    cell.emit("editing-started", entry, pathStr);
  }
  stopEditing(cancel: boolean): void {
    if (!this.editing) return;
    const f = this.editing.entry.data.get("finish") as ((c: boolean) => void) | undefined;
    if (f) f(cancel);
  }
}

export function treeViewNew(): TreeView {
  return new TreeView();
}
export function treeViewNewWithModel(m: TreeModel): TreeView {
  const v = new TreeView();
  v.setModel(m);
  return v;
}
export function treeViewSetModel(v: TreeView, m: TreeModel | null): void {
  v.setModel(m);
}
export function treeViewGetModel(v: TreeView): TreeModel | null {
  return v.model;
}
export function treeViewAppendColumn(v: TreeView, c: TreeViewColumn): number {
  c.view = v;
  v.columns.push(c);
  v.changed();
  return v.columns.length;
}
export function treeViewRemoveColumn(v: TreeView, c: TreeViewColumn): number {
  v.columns = v.columns.filter((x) => x !== c);
  v.changed();
  return v.columns.length;
}
export function treeViewGetColumn(v: TreeView, n: number): TreeViewColumn | null {
  return v.columns[n] ?? null;
}
export function treeViewSetHeadersVisible(v: TreeView, b: boolean): void {
  v.headersVisible = b;
  v.changed();
}
export function treeViewSetEnableTreeLines(v: TreeView, b: boolean): void {
  v.enableTreeLines = b;
  v.changed();
}
export function treeViewSetGridLines(v: TreeView, g: TreeViewGridLines): void {
  v.gridLines = g;
  v.changed();
}
export function treeViewSetReorderable(v: TreeView, b: boolean): void {
  v.reorderable = b;
}
export function treeViewSetTooltipColumn(v: TreeView, c: number): void {
  v.tooltipColumn = c;
  v.changed();
}
export function treeViewSetActivateOnSingleClick(v: TreeView, b: boolean): void {
  v.activateOnSingleClick = b;
}
export function treeViewExpandAll(v: TreeView): void {
  const m = v.model;
  if (!m) return;
  const go = (ns: RowNode[]) => ns.forEach((n) => {
    if (n.children.length > 0) v.expanded.add(v.keyOf(n));
    go(n.children);
  });
  go(m.roots());
  v.changed();
}
export function treeViewCollapseAll(v: TreeView): void {
  v.expanded.clear();
  v.changed();
}
export function treeViewExpandRow(v: TreeView, p: TreePath, openAll: boolean): boolean {
  const n = v.model?.nodeAt(p);
  if (!n) return false;
  v.expanded.add(v.keyOf(n));
  if (openAll) {
    const go = (ns: RowNode[]) => ns.forEach((c) => {
      v.expanded.add(v.keyOf(c));
      go(c.children);
    });
    go(n.children);
  }
  v.changed();
  v.emit("row-expanded", v.model!.iter(n), p);
  return true;
}
export function treeViewCollapseRow(v: TreeView, p: TreePath): boolean {
  const n = v.model?.nodeAt(p);
  if (!n) return false;
  v.expanded.delete(v.keyOf(n));
  v.changed();
  v.emit("row-collapsed", v.model!.iter(n), p);
  return true;
}
export function treeViewExpandToPath(v: TreeView, p: TreePath): void {
  const m = v.model;
  if (!m) return;
  for (let i = 1; i <= p.indices.length; i++) {
    const n = m.nodeAt(new TreePath(p.indices.slice(0, i)));
    if (n) v.expanded.add(v.keyOf(n));
  }
  v.changed();
}
export function treeViewRowExpanded(v: TreeView, p: TreePath): boolean {
  const n = v.model?.nodeAt(p);
  return !!n && v.isExpanded(n);
}
export function treeViewMapExpandedRows(v: TreeView, f: (view: TreeView, p: TreePath) => void): void {
  const m = v.model;
  if (!m) return;
  const go = (ns: RowNode[]) => ns.forEach((n) => {
    if (v.isExpanded(n)) {
      f(v, m.pathOf(n));
      go(n.children);
    }
  });
  go(m.roots());
}
export function treeViewScrollToCell(v: TreeView, p: TreePath | null, _c: TreeViewColumn | null, _align: boolean, _r: number, _c2: number): void {
  if (!p || !v.el) return;
  const el = v.el.querySelector(`[data-path="${p.toString()}"]`);
  el?.scrollIntoView({ block: "nearest" });
}
export function treeViewSetCursor(v: TreeView, p: TreePath, _c: TreeViewColumn | null, startEditing: boolean): void {
  treeSelectionSelectPath(v.selection, p);
  if (startEditing && _c) {
    const cell = _c.cells.find((pc) => pc.cell.base.editable)?.cell;
    if (cell) v.startEditing(p, _c, cell, String(cellText(v, p, _c, cell) ?? ""));
  }
}
function cellText(v: TreeView, p: TreePath, c: TreeViewColumn, cell: CellRenderer): unknown {
  const m = v.model;
  const n = m?.nodeAt(p);
  if (!m || !n) return "";
  return computeCellProps(m, n, c, cell).text;
}

/** Height of the header row, for coordinate conversions. */
function headerHeight(v: TreeView): number {
  const h = v.el?.querySelector<HTMLElement>(".gtk-treeview-header");
  return h ? h.offsetHeight : 0;
}
export function treeViewConvertWidgetToBinWindowCoords(v: TreeView, x: number, y: number): [number, number] {
  return [x, y - headerHeight(v)];
}
export function treeViewConvertBinWindowToWidgetCoords(v: TreeView, x: number, y: number): [number, number] {
  return [x, y + headerHeight(v)];
}
export function treeViewConvertTreeToWidgetCoords(v: TreeView, x: number, y: number): [number, number] {
  return [x, y + headerHeight(v)];
}
/**
 * `treeViewGetPathAtPos v x y` (bin-window coordinates) returns
 * (found, path, column, cellX, cellY).
 */
export function treeViewGetPathAtPos(v: TreeView, x: number, y: number): [boolean, TreePath | null, TreeViewColumn | null, number, number] {
  if (!v.el) return [false, null, null, 0, 0];
  const r = v.el.getBoundingClientRect();
  const cx = r.left + x, cy = r.top + headerHeight(v) + y;
  const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
  const row = el?.closest<HTMLElement>("[data-path]");
  if (!row || !v.el.contains(row)) return [false, null, null, 0, 0];
  const path = row.dataset.path ?? "";
  const colEl = el?.closest<HTMLElement>("[data-col]");
  const col = colEl ? v.columns[parseInt(colEl.dataset.col ?? "0", 10)] ?? null : v.columns[0] ?? null;
  const rr = row.getBoundingClientRect();
  return [true, new TreePath(path === "" ? [] : path.split(":").map(Number)), col, cx - rr.left, cy - rr.top];
}
export function treeViewGetBackgroundArea(v: TreeView, p: TreePath | null, _c: TreeViewColumn | null): { x: number; y: number; width: number; height: number } {
  if (!p || !v.el) return { x: 0, y: 0, width: 0, height: 0 };
  const row = v.el.querySelector<HTMLElement>(`[data-path="${p.toString()}"]`);
  if (!row) return { x: 0, y: 0, width: 0, height: 0 };
  const r = v.el.getBoundingClientRect(), rr = row.getBoundingClientRect();
  return { x: rr.left - r.left, y: rr.top - r.top - headerHeight(v), width: rr.width, height: rr.height };
}
export function treeViewSetDragDestRow(v: TreeView, p: TreePath | null, pos: TreeViewDropPosition): void {
  v.dragDestRow = p ? { path: p, pos } : null;
  v.changed();
}
export function treeViewEnableModelDragSource(v: TreeView, _mask: unknown, _targets: unknown, _actions: unknown): void {
  v.dragSource = true;
  if (Array.isArray(_targets) && _targets.length > 0 && _targets.every((t) => typeof t === "string")) v.dragTargets = _targets as string[];
}
export function treeViewEnableModelDragDest(v: TreeView, _targets: unknown, _actions: unknown): void {
  v.dragDest = true;
}
export function widgetDragDestSet(w: Widget, _flags: unknown, _targets: unknown, _actions: unknown): void {
  (w as TreeView).dragDest = true;
}
export function widgetDragDestFindTarget(_w: Widget, ctx: DragContext, _list: unknown): string | null {
  return ctx.targets[0] ?? null;
}
export function dragFinish(ctx: DragContext, success: boolean, _del: boolean, _time: number): void {
  ctx.finished = true;
  ctx.success = success;
}
export function targetEntryNew(target: string, _flags: number, _info: number): string {
  return target;
}
export type TargetEntry = string;
export const TargetFlagsSameApp = 1;
export const TargetFlagsSameWidget = 2;

export function onTreeViewRowActivated(v: TreeView, cb: (p: TreePath, c: TreeViewColumn) => void): SignalHandlerId {
  return v.connect("row-activated", cb);
}
export function onTreeViewRowExpanded(v: TreeView, cb: (it: TreeIter, p: TreePath) => void): SignalHandlerId {
  return v.connect("row-expanded", cb);
}
export function onTreeViewRowCollapsed(v: TreeView, cb: (it: TreeIter, p: TreePath) => void): SignalHandlerId {
  return v.connect("row-collapsed", cb);
}
export function onWidgetDragMotion(w: Widget, cb: (ctx: DragContext, x: number, y: number, time: number) => boolean): SignalHandlerId {
  return w.connect("drag-motion", cb);
}
export function onWidgetDragDrop(w: Widget, cb: (ctx: DragContext, x: number, y: number, time: number) => boolean): SignalHandlerId {
  return w.connect("drag-drop", cb);
}
export function onWidgetDragDataReceived(
  w: Widget, cb: (ctx: DragContext, x: number, y: number, data: unknown, info: number, time: number) => void,
): SignalHandlerId {
  return w.connect("drag-data-received", cb);
}
export function onWidgetDragBegin(w: Widget, cb: (ctx: DragContext) => void): SignalHandlerId {
  return w.connect("drag-begin", cb);
}
export function onWidgetDragEnd(w: Widget, cb: (ctx: DragContext) => void): SignalHandlerId {
  return w.connect("drag-end", cb);
}

/** Compute the renderer properties for one cell of one row. */
export function computeCellProps(m: TreeModel, n: RowNode, col: TreeViewColumn, cell: CellRenderer): Record<string, any> {
  cell.rendering = true;
  cell.props = { ...cell.base };
  try {
    const attrs = col.attributes.get(cell);
    if (attrs) for (const [prop, c] of attrs) cell.props[prop] = m.columnValue(n, c);
    const f = col.dataFuncs.get(cell);
    if (f) f(m, m.iter(n));
  } catch (err) {
    console.error("Cell data function failed:", err);
  } finally {
    cell.rendering = false;
  }
  return { ...cell.props };
}

/** Value conversion helper for column stores holding rows of values. */
export function gvalues(...vs: unknown[]): GValue[] {
  return vs.map(toGValue);
}

export type { SeqStore, ForestStore, EventButton };
