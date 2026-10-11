/**
 * `GI.Gtk` for the browser. Import as `import * as Gtk from "@/lib/GI/Gtk"`.
 *
 * See `Core.ts` for the design and conventions, and `README.md` for porting notes.
 */
import { ComboBox, comboCellLayoutPackStart, comboCellLayoutAddAttribute } from "./Choosers";
import {
  TreeViewColumn, treeViewColumnPackStart, treeViewColumnPackEnd, cellLayoutAddAttribute as colAddAttribute,
  mvCellLayoutSetAttributes as colSetAttributes, mvCellLayoutSetDataFunction as colSetDataFunction, type CellRenderer,
} from "./TreeView";
import type { TreeModel } from "./TreeModel";
import type { Widget } from "./Core";
import type { Context } from "../Cairo";

export * from "./Core";
export * from "./Widgets";
export * from "./TreeModel";
export * from "./TreeView";
export * from "./Choosers";
export * from "./IconTheme";
export * from "./Builder";
export { main, init, mainQuit, GtkRoot } from "./RenderRoot";

/** A cell layout: a tree view column or a combo box. */
export type CellLayout = TreeViewColumn | ComboBox;

export function cellLayoutPackStart(l: CellLayout, cell: CellRenderer, expand: boolean): void {
  if (l instanceof ComboBox) comboCellLayoutPackStart(l, cell, expand);
  else treeViewColumnPackStart(l, cell, expand);
}
export function cellLayoutPackEnd(l: CellLayout, cell: CellRenderer, expand: boolean): void {
  if (l instanceof ComboBox) {
    l.layout.cells.push({ cell, expand, end: true });
    l.changed();
  } else treeViewColumnPackEnd(l, cell, expand);
}
export function cellLayoutAddAttribute(l: CellLayout, cell: CellRenderer, prop: string, col: number): void {
  if (l instanceof ComboBox) comboCellLayoutAddAttribute(l, cell, prop, col);
  else colAddAttribute(l, cell, prop, col);
}
/** `Data.GI.Gtk.ModelView.cellLayoutSetAttributes`. */
export function mvCellLayoutSetAttributes<A>(l: CellLayout, cell: CellRenderer, model: TreeModel, f: (row: A) => Record<string, unknown>): void {
  if (l instanceof ComboBox) {
    colSetAttributes(l.layout, cell, model, f);
    l.changed();
  } else colSetAttributes(l, cell, model, f);
}
/** `Data.GI.Gtk.ModelView.cellLayoutSetDataFunction`. */
export function mvCellLayoutSetDataFunction<A>(l: CellLayout, cell: CellRenderer, model: TreeModel, f: (row: A) => void): void {
  if (l instanceof ComboBox) {
    colSetDataFunction(l.layout, cell, model, f);
    l.changed();
  } else colSetDataFunction(l, cell, model, f);
}

/**
 * `Gtk.renderBackground style cr x y w h`: paint the widget's CSS background colour.
 */
export function renderBackground(style: Widget, cr: Context, x: number, y: number, w: number, h: number): void {
  let bg = "rgb(255,255,255)";
  if (style.el) {
    const c = getComputedStyle(style.el).backgroundColor;
    if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") bg = c;
  }
  const t = cr.target;
  t.save();
  t.fillStyle = bg;
  t.fillRect(x, y, w, h);
  t.restore();
}
