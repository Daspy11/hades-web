/**
 * React rendering of `GtkTreeView` and `GtkIconView`.
 */
import React, { useEffect, useRef } from "react";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Select from "@radix-ui/react-select";
import { baseProps, keyHandler, useWidget, WidgetView, MarkupText, type LayoutStyle } from "./Render";
import {
  TreeView, TreeViewColumn, CellRenderer, computeCellProps, treeSelectionSelectPath, treeViewConvertWidgetToBinWindowCoords,
  cellEditableEditingDone,
} from "./TreeView";
import { RowNode, TreePath, TreeModel } from "./TreeModel";
import { ComboBox, type IconView } from "./Choosers";
import { iconUrl } from "./IconTheme";
import { DragContext, eventKeyFromDom, modifiersOf, type EventButton } from "../Gdk";
import { stripMnemonic, type Widget } from "./Core";

interface VisibleRow {
  node: RowNode;
  path: TreePath;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  /** The row is the last of its siblings. */
  last: boolean;
  /** `more[j]`: the ancestor of the row at depth `j` has a following sibling (for tree lines). */
  more: boolean[];
}

function visibleRows(v: TreeView): VisibleRow[] {
  const m = v.model;
  if (!m) return [];
  const out: VisibleRow[] = [];
  const go = (nodes: RowNode[], prefix: number[], depth: number, more: boolean[]) => {
    nodes.forEach((n, i) => {
      const path = new TreePath([...prefix, i]);
      const expanded = v.isExpanded(n);
      const last = i === nodes.length - 1;
      out.push({ node: n, path, depth, hasChildren: n.children.length > 0, expanded, last, more });
      if (expanded) go(n.children, path.indices, depth + 1, [...more, !last]);
    });
  };
  go(m.roots(), [], 0, []);
  return out;
}

/** Indentation of one tree level, and the centre of the expander of level `k`, in pixels. */
const LEVEL_INDENT = 18;
const expanderCentre = (k: number): number => 12 + LEVEL_INDENT * k;

/**
 * The tree lines of a row (`enable-tree-lines`), drawn as `gtk_tree_view_bin_draw` does: a dotted
 * elbow from the parent's expander to the row (stopping before the row's own expander when it has
 * children), continued downwards unless the row is the last child, and a vertical line for every
 * ancestor that has following siblings. Rows at the top level have no lines.
 */
function TreeLines({ row }: { row: VisibleRow }) {
  const d = row.depth;
  if (d < 1) return null;
  const x = (k: number) => expanderCentre(k) + 0.5;
  const hEnd = row.hasChildren ? 2 + LEVEL_INDENT * d : expanderCentre(d);
  const lines: React.ReactElement[] = [
    <line key="v" x1={x(d - 1)} y1="0" x2={x(d - 1)} y2={row.last ? "50%" : "100%"} />,
    <line key="h" x1={x(d - 1)} y1="50%" x2={hEnd} y2="50%" />,
  ];
  for (let j = d - 1; j >= 1; j--) {
    if (row.more[j]) lines.push(<line key={"a" + j} x1={x(j - 1)} y1="0" x2={x(j - 1)} y2="100%" />);
  }
  return (
    <svg className="gtk-tree-lines" width={expanderCentre(d) + 1} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1" strokeDasharray="1 1" shapeRendering="crispEdges">{lines}</g>
    </svg>
  );
}

/** Shared drag state for tree view drag and drop within the page. */
let dragState: { view: TreeView; paths: TreePath[]; ctx: DragContext } | null = null;

/**
 * The tree view drag in progress, if any: its context and dragged paths. Other drop targets
 * (drawing areas set up with `widgetDragDestSet`) use it for their drag signals.
 */
export function currentTreeDrag(): { readonly paths: TreePath[]; readonly ctx: DragContext } | null {
  return dragState;
}

function colourOf(p: Record<string, any>, key: "foreground" | "background"): string | undefined {
  const rgba = p[key + "Rgba"];
  if (rgba && typeof rgba === "object") {
    const f = (x: number) => Math.round(x * 255);
    return `rgba(${f(rgba.red)}, ${f(rgba.green)}, ${f(rgba.blue)}, ${rgba.alpha ?? 1})`;
  }
  const c = p[key];
  return c ? String(c) : undefined;
}

/**
 * The `cell-background(-rgba)` of a renderer, which GTK paints over the whole cell area
 * (and, as GTK does, not on selected rows).
 */
function cellBackgroundOf(p: Record<string, any>): string | undefined {
  const rgba = p.cellBackgroundRgba;
  if (rgba && typeof rgba === "object") {
    const f = (x: number) => Math.round(x * 255);
    return `rgba(${f(rgba.red)}, ${f(rgba.green)}, ${f(rgba.blue)}, ${rgba.alpha ?? 1})`;
  }
  return p.cellBackground ? String(p.cellBackground) : undefined;
}

/**
 * The in-place editor of a cell. Once mounted it emits `size-allocate` on the editable with its
 * rectangle in bin-window coordinates of the tree view, as GTK does when it allocates the editable.
 */
function CellEditorView({ v, entry }: { v: TreeView; entry: Widget }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    const tv = v.el;
    // As in GTK, the editable takes the focus with its text selected.
    const input = el?.querySelector<HTMLInputElement>("input, textarea");
    if (input) {
      input.focus();
      input.select();
    }
    if (!el || !tv || !entry.hasHandlers("size-allocate")) return;
    const r = el.getBoundingClientRect(), t = tv.getBoundingClientRect();
    const [x, y] = treeViewConvertWidgetToBinWindowCoords(v, r.left - t.left, r.top - t.top);
    entry.emit("size-allocate", { x, y, width: r.width, height: r.height });
  }, [v, entry]);
  // Keys typed into the editor (Enter, arrows) are not tree view navigation.
  return <span className="gtk-cell-editor" ref={ref} onKeyDown={(e) => e.stopPropagation()}><WidgetView w={entry} /></span>;
}

function CellView({ v, col, cell, props, path, node, selected }: {
  v: TreeView; col: TreeViewColumn; cell: CellRenderer; props: Record<string, any>; path: TreePath; node: RowNode;
  selected?: boolean;
}) {
  if (props.visible === false) return null;
  const editing = v.editing && v.editing.cell === cell && v.editing.path === path.toString() ? v.editing : null;
  const style: React.CSSProperties = {
    // As in GTK, the foreground and background colours are not used on selected rows.
    color: selected ? undefined : colourOf(props, "foreground"),
    background: selected ? undefined : colourOf(props, "background"),
    fontWeight: props.weight && props.weight >= 600 ? 700 : props.weight === "WeightBold" ? 700 : undefined,
    fontStyle: props.style === "StyleItalic" ? "italic" : undefined,
  };
  switch (cell.kind) {
    case "pixbuf": {
      const size = props.stockSize ? 16 : 16;
      const url = props.pixbuf?.url ?? iconUrl(props.iconName ?? null, size);
      return url
        ? <img className="gtk-cell-pixbuf" src={url} width={props.pixbuf?.width > 0 ? Math.min(props.pixbuf.width, 48) : size} height={props.pixbuf?.height > 0 ? Math.min(props.pixbuf.height, 48) : size} alt="" draggable={false} style={style} />
        : <span className="gtk-cell-pixbuf" style={{ width: size }} />;
    }
    case "toggle":
      return (
        <Checkbox.Root
          className="gtk-check"
          checked={!!props.active}
          disabled={props.activatable === false || props.sensitive === false}
          onCheckedChange={() => cell.emit("toggled", path.toString())}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox.Indicator className="gtk-check-indicator">✓</Checkbox.Indicator>
        </Checkbox.Root>
      );
    case "combo":
      if (editing && editing.entry instanceof ComboBox) return <ComboCellEditor v={v} combo={editing.entry} props={props} />;
      return <span className="gtk-cell-text" style={style}>{String(props.text ?? "")}</span>;
    default: {
      if (editing) return <CellEditorView v={v} entry={editing.entry} />;
      const text = props.markup !== undefined && props.markup !== null
        ? <MarkupText markup={String(props.markup)} />
        : String(props.text ?? "");
      const wrap = props.wrapWidth && props.wrapWidth > 0;
      return (
        <span
          className="gtk-cell-text"
          style={{
            ...style,
            whiteSpace: wrap ? "pre-wrap" : "pre",
            maxWidth: wrap ? props.wrapWidth : undefined,
            minWidth: props.widthChars > 0 ? `${props.widthChars}ch` : undefined,
            textAlign: props.xalign >= 0.75 ? "right" : props.xalign >= 0.25 && props.xalign < 0.75 && props.xalign !== 0 ? "center" : undefined,
          }}
        >
          {text}
        </span>
      );
    }
  }
  void col;
  void node;
}

/**
 * The in-place editor of a combo cell: the `ComboBox` editable created by `startEditing`, shown
 * open. Items are drawn with the combo's own cell layout (so renderers and data functions added
 * in an "editing-started" handler, e.g. icons and colours, are shown, as in GTK).
 */
function ComboCellEditor({ v, combo, props }: { v: TreeView; combo: ComboBox; props: Record<string, any> }) {
  useWidget(combo);
  const items = combo.model ? combo.model.roots() : [];
  const item = (n: RowNode): React.ReactNode => {
    let bg: string | undefined, fg: string | undefined;
    const parts = combo.itemProps(n).map((p, k) => {
      if (p.visible === false) return null;
      bg = cellBackgroundOf(p) ?? bg;
      fg = colourOf(p, "foreground") ?? fg;
      if (p.kind === "pixbuf") {
        const url = p.pixbuf?.url ?? iconUrl(p.iconName ?? null, 16);
        return url ? <img key={k} src={url} width={16} height={16} alt="" /> : <span key={k} style={{ width: 16 }} />;
      }
      return <span key={k}>{p.markup !== undefined && p.markup !== null ? <MarkupText markup={String(p.markup)} /> : String(p.text ?? "")}</span>;
    });
    return <span className="gtk-combo-item" style={{ background: bg, color: fg }}>{parts}</span>;
  };
  return (
    <Select.Root
      defaultOpen
      value={combo.active >= 0 ? String(combo.active) : ""}
      onOpenChange={(o) => {
        // Closed without a choice: the edit is cancelled (no-op once a choice finished it).
        if (!o) v.stopEditing(true);
      }}
      onValueChange={(val) => {
        combo.setActive(parseInt(val, 10), true);
        cellEditableEditingDone(combo);
      }}
    >
      <Select.Trigger className="gtk-comboBox gtk-cell-combo" aria-label="Choose value">
        <Select.Value placeholder={String(props.text ?? "")}>{combo.active >= 0 && items[combo.active] ? item(items[combo.active]) : null}</Select.Value>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="gtk-combo-popup" position="popper">
          <Select.Viewport>
            {items.map((n, i) => (
              <Select.Item key={i} value={String(i)} className="gtk-combo-option">
                <Select.ItemText>{item(n)}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function TreeViewView({ w, layout }: { w: TreeView; layout?: LayoutStyle }) {
  useWidget(w);
  const m = w.model;
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!m) return;
    const id = m.connect("model-changed", () => force());
    return () => m.disconnect(id);
  }, [m]);
  const ref = useRef<HTMLDivElement | null>(null);
  const editTimer = useRef<number | null>(null);
  const anchor = useRef<RowNode | null>(null);
  const rows = visibleRows(w);
  const sel = w.selection;

  const evButton = (e: React.MouseEvent, type: EventButton["type"]): EventButton => {
    const r = ref.current?.getBoundingClientRect();
    return {
      type,
      button: e.button === 0 ? 1 : e.button === 1 ? 2 : 3,
      x: r ? e.clientX - r.left : 0,
      y: r ? e.clientY - r.top : 0,
      xRoot: e.clientX, yRoot: e.clientY,
      state: modifiersOf(e), time: e.timeStamp, dom: e.nativeEvent,
    };
  };

  const selectRow = (row: VisibleRow, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (sel.mode === "SelectionModeNone") return;
    const key = w.keyOf(row.node);
    if (sel.selectFunction && m && !sel.selectFunction(sel, m, row.path, sel.selected.has(key))) return;
    if (sel.mode === "SelectionModeMultiple" && (e.ctrlKey || e.metaKey)) {
      if (sel.selected.has(key)) sel.selected.delete(key);
      else sel.selected.add(key);
      anchor.current = row.node;
    } else if (sel.mode === "SelectionModeMultiple" && e.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.node === anchor.current);
      const b = rows.indexOf(row);
      sel.selected.clear();
      if (a >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.selected.add(w.keyOf(rows[i].node));
      else sel.selected.add(key);
    } else {
      if (sel.selected.size === 1 && sel.selected.has(key)) return;
      sel.selected.clear();
      sel.selected.add(key);
      anchor.current = row.node;
    }
    sel.notify();
  };

  const startEditFor = (row: VisibleRow, col: TreeViewColumn, cellIdx: number) => {
    const pc = col.cells[cellIdx];
    if (!pc || !m) return;
    const props = computeCellProps(m, row.node, col, pc.cell);
    if (!props.editable && !(pc.cell.kind === "combo" && props.editable !== false && props.model)) return;
    w.startEditing(row.path, col, pc.cell, String(props.text ?? ""));
  };

  /**
   * React events from portals (a cell's combo popup) bubble to the row, as do clicks in a cell's
   * editor (e.g. on an entry icon); they are not row clicks.
   */
  const fromPortal = (e: React.SyntheticEvent): boolean =>
    !ref.current?.contains(e.target as Node) || !!(e.target as HTMLElement).closest?.(".gtk-cell-editor");
  const onRowMouseDown = (row: VisibleRow, e: React.MouseEvent) => {
    if (fromPortal(e)) return;
    if (w.editing) w.stopEditing(false);
    const handled = w.emit("button-press-event", evButton(e, e.detail === 2 ? "EventType2buttonPress" : "EventTypeButtonPress"));
    if (handled === true) {
      e.preventDefault();
      return;
    }
    const wasSelected = sel.selected.has(w.keyOf(row.node)) && sel.selected.size === 1;
    if (e.button === 0 || (e.button === 2 && !sel.selected.has(w.keyOf(row.node)))) selectRow(row, e);
    // Clicking an editable cell of an already selected row starts editing after a pause.
    const cellEl = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (e.button === 0 && e.detail === 1 && wasSelected && cellEl && !e.shiftKey && !e.ctrlKey) {
      const ci = parseInt(cellEl.dataset.col ?? "0", 10), k = parseInt(cellEl.dataset.cell ?? "0", 10);
      const col = w.columns[ci];
      if (editTimer.current) window.clearTimeout(editTimer.current);
      editTimer.current = window.setTimeout(() => {
        editTimer.current = null;
        if (col) startEditFor(row, col, k);
      }, 450);
    }
  };

  const onRowDoubleClick = (row: VisibleRow, e: React.MouseEvent) => {
    if (fromPortal(e)) return;
    if (editTimer.current) {
      window.clearTimeout(editTimer.current);
      editTimer.current = null;
    }
    const colEl = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    const col = colEl ? w.columns[parseInt(colEl.dataset.col ?? "0", 10)] : w.columns[0];
    w.emit("row-activated", row.path, col ?? null);
  };

  const toggleExpand = (row: VisibleRow) => {
    const key = w.keyOf(row.node);
    if (w.expanded.has(key)) {
      w.expanded.delete(key);
      w.emit("row-collapsed", m!.iter(row.node), row.path);
    } else {
      w.expanded.add(key);
      w.emit("row-expanded", m!.iter(row.node), row.path);
    }
    w.changed();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const kh = keyHandler(w);
    if (kh) {
      kh(e);
      if (e.defaultPrevented) return;
    }
    if (w.editing) return;
    const cur = rows.findIndex((r) => sel.selected.has(w.keyOf(r.node)));
    const move = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      selectRow(r, { ctrlKey: false, metaKey: false, shiftKey: e.shiftKey });
      ref.current?.querySelector(`[data-path="${r.path.toString()}"]`)?.scrollIntoView({ block: "nearest" });
    };
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(cur + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(cur < 0 ? 0 : cur - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(rows.length - 1);
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "+" || e.key === "-") && cur >= 0) {
      const r = rows[cur];
      if (r.hasChildren && ((e.key === "ArrowRight" || e.key === "+") !== r.expanded)) {
        e.preventDefault();
        toggleExpand(r);
      } else if (e.key === "ArrowLeft" && r.path.indices.length > 1) {
        e.preventDefault();
        const parent = rows.find((x) => x.path.toString() === r.path.indices.slice(0, -1).join(":"));
        if (parent) move(rows.indexOf(parent));
      }
    } else if ((e.key === "Enter" || e.key === " ") && cur >= 0) {
      e.preventDefault();
      w.emit("row-activated", rows[cur].path, w.columns[0] ?? null);
    } else if (e.key === "F2" && cur >= 0) {
      e.preventDefault();
      const col = w.columns.find((c) => c.cells.some((pc) => pc.cell.base.editable));
      if (col) startEditFor(rows[cur], col, col.cells.findIndex((pc) => pc.cell.base.editable));
    }
  };

  // Drag and drop
  // As in GTK, the drag signals get widget coordinates (convert them with
  // `treeViewConvertWidgetToBinWindowCoords` before `treeViewGetPathAtPos`).
  const widgetXY = (e: React.DragEvent): [number, number] => {
    const r = ref.current?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] : [0, 0];
  };
  const onDragStart = (row: VisibleRow, e: React.DragEvent) => {
    if (!w.dragSource && !w.reorderable) return;
    // A drag is not a click: no in-place editing afterwards (GTK starts editing on release).
    if (editTimer.current) {
      window.clearTimeout(editTimer.current);
      editTimer.current = null;
    }
    if (!sel.selected.has(w.keyOf(row.node))) selectRow(row, { ctrlKey: false, metaKey: false, shiftKey: false });
    const paths = rows.filter((r) => sel.selected.has(w.keyOf(r.node))).map((r) => r.path);
    const ctx = new DragContext(w.dragTargets ?? ["hades/entity"], e.nativeEvent);
    dragState = { view: w, paths, ctx };
    e.dataTransfer.setData("text/plain", paths.map((p) => p.toString()).join(";"));
    e.dataTransfer.effectAllowed = "copyMove";
    w.emit("drag-begin", ctx);
  };
  const onDragOver = (row: VisibleRow | null, e: React.DragEvent) => {
    if (!w.dragDest && !w.reorderable) return;
    if (!dragState) return;
    e.preventDefault();
    const [x, y] = widgetXY(e);
    const ctx = dragState.ctx;
    ctx.event = e.nativeEvent;
    ctx.status = undefined;
    const handled = w.emit("drag-motion", ctx, x, y, e.timeStamp);
    // A handler refusing the drop with `Gdk.dragStatus` (no action) also gets no default highlight.
    if (handled !== true && row && ctx.status !== null) {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
      const r = el?.getBoundingClientRect();
      const f = r ? (e.clientY - r.top) / r.height : 0.5;
      const pos = f < 0.25 ? "TreeViewDropPositionBefore" : f > 0.75 ? "TreeViewDropPositionAfter" : "TreeViewDropPositionIntoOrAfter";
      w.dragDestRow = { path: row.path, pos };
      w.changed();
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!dragState) return;
    e.preventDefault();
    const [x, y] = widgetXY(e);
    const st = dragState;
    st.ctx.event = e.nativeEvent;
    const handled = w.emit("drag-drop", st.ctx, x, y, e.timeStamp);
    if (handled !== true) w.emit("drag-data-received", st.ctx, x, y, st.paths, 0, e.timeStamp);
    w.dragDestRow = null;
    w.changed();
  };
  const onDragEnd = () => {
    if (dragState) dragState.view.emit("drag-end", dragState.ctx);
    dragState = null;
    if (w.dragDestRow) {
      w.dragDestRow = null;
      w.changed();
    }
  };

  const gridClass = w.gridLines === "TreeViewGridLinesBoth" ? " grid-both" : w.gridLines === "TreeViewGridLinesHorizontal" ? " grid-h" : w.gridLines === "TreeViewGridLinesVertical" ? " grid-v" : "";
  const props = baseProps(w, gridClass + (w.enableTreeLines ? " tree-lines" : ""), layout);
  const visibleCols = w.columns.filter((c) => c.visible);
  const colTemplate = visibleCols.map((c) => (c.width > 0 ? `${c.width}px` : c.fixedWidth > 0 ? `${c.fixedWidth}px` : c.expand ? "minmax(min-content, 1fr)" : "max-content")).join(" ");
  const anyExpand = visibleCols.some((c) => c.expand);
  const template = colTemplate + (anyExpand ? "" : " 1fr");

  const startResize = (c: TreeViewColumn, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const hd = (e.target as HTMLElement).parentElement;
    const startW = hd ? hd.getBoundingClientRect().width : 100;
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      c.width = Math.max(20, startW + ev.clientX - x0);
      w.changed();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      {...props}
      ref={(e) => {
        ref.current = e;
        props.ref(e);
      }}
      role="tree"
      aria-multiselectable={sel.mode === "SelectionModeMultiple"}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(e) => onDragOver(null, e)}
      onDrop={onDrop}
      onContextMenu={(e) => e.preventDefault()}
      style={{ ...props.style, display: "grid", gridTemplateColumns: template, alignContent: "start" }}
    >
      {w.headersVisible && visibleCols.length > 0 ? (
        <div className="gtk-treeview-header" style={{ display: "contents" }}>
          {visibleCols.map((c, i) => (
            <div key={i} className="gtk-treeview-column-header" role="columnheader">
              <span>{stripMnemonic(c.title)}</span>
              {c.resizable ? <span className="gtk-column-resizer" onPointerDown={(e) => startResize(c, e)} /> : null}
            </div>
          ))}
          {anyExpand ? null : <div className="gtk-treeview-column-header filler" />}
        </div>
      ) : null}
      {rows.map((row) => {
        const selected = sel.selected.has(w.keyOf(row.node));
        const dd = w.dragDestRow && w.dragDestRow.path.toString() === row.path.toString() ? w.dragDestRow.pos : null;
        const tooltip = w.tooltipColumn >= 0 && m ? m.columnValue(row.node, w.tooltipColumn) : null;
        const cls = "gtk-treeview-row" + (selected ? " selected" : "") +
          (dd === "TreeViewDropPositionBefore" ? " drop-before" : dd === "TreeViewDropPositionAfter" ? " drop-after" : dd ? " drop-into" : "");
        return (
          <div
            key={row.path.toString() + "/" + (row.node as any).__k}
            className={cls}
            data-path={row.path.toString()}
            role="treeitem"
            aria-selected={selected}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            aria-level={row.depth + 1}
            title={tooltip ? String(tooltip) : undefined}
            style={{ display: "contents" }}
            // The row is `display: contents`, which cannot start an HTML5 drag: its cells are the
            // draggable elements, and their drag events bubble to the row's handlers.
            onDragStart={(e) => onDragStart(row, e)}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
              e.stopPropagation();
              onDragOver(row, e);
            }}
            onMouseDown={(e) => onRowMouseDown(row, e)}
            onDoubleClick={(e) => onRowDoubleClick(row, e)}
          >
            {visibleCols.map((col, ci) => {
              const realCi = w.columns.indexOf(col);
              const first = ci === 0;
              const startCells = col.cells.filter((pc) => !pc.end);
              const endCells = col.cells.filter((pc) => pc.end).reverse();
              const ordered = [...startCells, ...endCells];
              const cps = ordered.map((pc) => (m ? computeCellProps(m, row.node, col, pc.cell) : {}));
              const cellBg = selected ? undefined : cps.map(cellBackgroundOf).find((x) => x !== undefined);
              return (
                <div
                  key={ci}
                  className={"gtk-treeview-cell" + (selected ? " selected" : "") + (dd ? " " + cls.split(" ").filter((x) => x.startsWith("drop")).join(" ") : "")}
                  draggable={w.dragSource || w.reorderable}
                  data-col={realCi}
                  data-path={row.path.toString()}
                  style={first || cellBg ? { ...(first ? { paddingLeft: 4 + row.depth * LEVEL_INDENT } : {}), ...(cellBg ? { background: cellBg } : {}), ...(first && w.enableTreeLines ? { position: "relative" as const } : {}) } : undefined}
                >
                  {first && w.enableTreeLines ? <TreeLines row={row} /> : null}
                  {/* GTK draws no expanders (and reserves no space for them) for a list-only model. */}
                  {first && !(m && m.listOnly()) ? (
                    <span
                      className={"gtk-expander" + (row.hasChildren ? (row.expanded ? " expanded" : " collapsed") : "")}
                      onMouseDown={(e) => {
                        if (row.hasChildren) {
                          e.stopPropagation();
                          e.preventDefault();
                          toggleExpand(row);
                        }
                      }}
                    />
                  ) : null}
                  {ordered.map((pc, oi) => {
                    const k = col.cells.indexOf(pc);
                    const cp = cps[oi];
                    return (
                      <span key={k} data-cell={k} data-col={realCi} className={"gtk-cell" + (pc.expand ? " expand" : "")}>
                        <CellView v={w} col={col} cell={pc.cell} props={cp} path={row.path} node={row.node} selected={selected} />
                      </span>
                    );
                  })}
                </div>
              );
            })}
            {anyExpand ? null : <div className={"gtk-treeview-cell filler" + (selected ? " selected" : "")} data-path={row.path.toString()} draggable={w.dragSource || w.reorderable} />}
          </div>
        );
      })}
    </div>
  );
}

export function IconViewView({ w, layout }: { w: IconView; layout?: LayoutStyle }) {
  useWidget(w);
  const m = w.model;
  const items = m ? m.roots() : [];
  const props = baseProps(w, "", layout);
  return (
    <div {...props} role="listbox" tabIndex={0}>
      {items.map((n, i) => {
        const pb = w.pixbufColumn >= 0 && m ? m.columnValue(n, w.pixbufColumn) : null;
        const text = w.textColumn >= 0 && m ? String(m.columnValue(n, w.textColumn) ?? "") : w.markupColumn >= 0 && m ? String(m.columnValue(n, w.markupColumn) ?? "") : "";
        const tip = w.tooltipColumn >= 0 && m ? String(m.columnValue(n, w.tooltipColumn) ?? "") : undefined;
        const url = pb && typeof pb === "object" && "url" in pb ? (pb as { url: string }).url : typeof pb === "string" ? iconUrl(pb, 48) : null;
        return (
          <div
            key={i}
            className={"gtk-iconview-item" + (w.selected === n ? " selected" : "")}
            role="option"
            aria-selected={w.selected === n}
            title={tip}
            tabIndex={-1}
            style={w.itemWidth > 0 ? { width: w.itemWidth } : undefined}
            onClick={() => {
              w.selected = n;
              w.changed();
              w.emit("selection-changed");
            }}
            onDoubleClick={() => m && w.emit("item-activated", m.pathOf(n))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && m) w.emit("item-activated", m.pathOf(n));
            }}
          >
            {url ? <img src={url} width={48} height={48} alt="" draggable={false} /> : <span style={{ width: 48, height: 48 }} />}
            {text ? <span className="gtk-iconview-text">{text}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export { eventKeyFromDom, treeSelectionSelectPath };
