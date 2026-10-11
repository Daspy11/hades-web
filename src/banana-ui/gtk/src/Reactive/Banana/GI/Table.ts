// Ported from banana-ui/gtk/src/Reactive/Banana/GI/Table.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Tables (GTK tree views) whose rows are edited by the user, driven by the abstract table
 * descriptions of `Reactive.Banana.Table`.
 *
 * TypeScript port
 * ---------------
 * * `MV.SeqStore row` / `MV.ForestStore (Int, row)` are the toolkit's `Gtk.SeqStore<Row>` and
 *   `Gtk.ForestStore<[number, Row]>`. Results are tuples: `mkTableView` returns
 *   `[box, store, activationOrAddEvent, editEvent]`, `mkTreeTableView` returns
 *   `[box, store, activationEvent]`.
 * * `Eq row` is structural equality (`notEquals`).
 * * `TableField row a` has an existential `a`, typed `any` here.
 * * `item ^. fieldValue col . f` on a traversal combines the targets with their `Monoid`
 *   (text concatenation, or the `Maybe` monoid); see `viewText` and `viewMaybe`.
 * * Running the colour chooser (`dialogRun`) is asynchronous; it is started from the entry's
 *   icon-press handler.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Pango from "@/lib/GI/Pango";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, fromMaybe, maybe, type Maybe } from "@/lib/Data/Maybe";
import { notEquals } from "@/lib/Data/Ord";
import { fromGregorian } from "@/lib/Data/Time";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import {
  _Just, clonePrism, foldMapOf, identity, over, preview, prism_, re, set, setJust, to, traversal,
  type Fold, type Prism, type Traversal,
} from "@/lib/Control/Lens";
import {
  Colour, append_Colour, colourPrism, datePrism, noIconName, prismToMaybe, reactimate1, reactimate1_,
  type Changes,
} from "@/banana-ui/base/Reactive/Banana/Common";
import {
  EditEntry, EditFixed, TableColumn, type FieldEditor, type Table, type TableEditing, type TableField,
} from "@/banana-ui/base/Reactive/Banana/Table";
import {
  colourToRGBA, contrastText, createColorDialog, createDatePopover, iconDialog, iconThemeContents, rgbaToColour,
  safeLoadIcon, withWaitCursor,
} from "./Common";
import { registerIOSignal, registerIOSignal1, registerIOSignal2 } from "./Connect";
import { cannotHappen, errorBox } from "./ErrorBox";

/**
 * A table allowing you to edit a list of items. Returns a widget containing the list, the
 * data store, an event for row activation, and an event for an edit to the list.
 *
 * @param flags Flags for how this table may be edited.
 * @param activationFlag If True then send row activation events (see return value).
 * @param cols Definition of table columns.
 * @param initial Initial content for table.
 * @param e Updates for table content.
 */
export function mkTableView<Row>(
  iconTheme: Gtk.IconTheme,
  flags: readonly TableEditing<Row>[],
  activationFlag: boolean,
  cols: Table<Row>,
  initial: readonly Row[],
  e: B.Event<readonly Row[]>,
  b: B.Behavior<readonly Row[]>,
): [Gtk.Box, Gtk.SeqStore<Row>, B.Event<[number, Row]>, B.Event<Row[]>] {
  const modifyStore = (model: Gtk.SeqStore<Row>, path: Gtk.TreePath, f: (r: Row) => Row): void => {
    const ix = Gtk.treePathGetIndices(path);
    if (ix !== null && ix.length > 0) {
      const n = ix[0];
      const row = Gtk.seqStoreGetValue(model, n);
      Gtk.seqStoreSetValue(model, n, f(row));
    }
  };
  const updateStore = (store: Gtk.SeqStore<Row>, newVal: readonly Row[]): void => {
    const oldVal = Gtk.seqStoreToList(store);
    const oldLen = oldVal.length;
    const newLen = newVal.length;
    for (const [n, v1, v2] of L.zip3(L.range(0, Math.max(oldLen, newLen)), oldVal, newVal)) {
      if (notEquals(v1, v2)) Gtk.seqStoreSetValue(store, n, v2);
    }
    // forM_ [oldLen-1, oldLen-2 .. newLen] $ MV.seqStoreRemove store
    for (let n = oldLen - 1; n >= newLen; n--) Gtk.seqStoreRemove(store, n);
    newVal.slice(oldLen).forEach((v, i) => Gtk.seqStoreInsert(store, oldLen + i, v));
  };
  const addButton = (store: Gtk.SeqStore<Row>, str: T.Text, v: Row): [Gtk.Button, B.Event<[number, Row]>] => {
    const btn = Gtk.new_(Gtk.Button, { label: "+ " + str });
    const addEvent = B.filterJust(registerIOSignal(btn, Gtk.onButtonClicked, () => {
      const n = Gtk.seqStoreAppend(store, v);
      return [null, activationFlag ? Just<[number, Row]>([n, v]) : Nothing];
    }));
    return [btn, addEvent];
  };
  const delButton = (store: Gtk.SeqStore<Row>, sel: Gtk.TreeSelection): Gtk.Button => {
    const btn = Gtk.new_(Gtk.Button, { label: "Delete" });
    Gtk.onButtonClicked(btn, () => {
      const [isSel, , iter] = Gtk.treeSelectionGetSelected(sel);
      const n = Gtk.seqStoreIterToIndex(iter);
      if (isSel) Gtk.seqStoreRemove(store, n);
    });
    return btn;
  };
  const upButton = (store: Gtk.SeqStore<Row>, sel: Gtk.TreeSelection): Gtk.Button => {
    const btn = Gtk.new_(Gtk.Button, { label: "Up" });
    Gtk.onButtonClicked(btn, () => {
      const [isSel, , iter] = Gtk.treeSelectionGetSelected(sel);
      const n = Gtk.seqStoreIterToIndex(iter);
      if (isSel && n > 0) {
        const v = Gtk.seqStoreGetValue(store, n);
        Gtk.seqStoreRemove(store, n);
        Gtk.seqStoreInsert(store, n - 1, v);
        // Web: toolkit iterators point at row nodes rather than at indices, so the moved row's
        // iterator is fetched afresh (Haskell: `treeModelIterPrevious store iter`).
        const [, iter1] = Gtk.treeModelIterNthChild(store, null, n - 1);
        Gtk.treeSelectionSelectIter(sel, iter1);
      }
    });
    return btn;
  };
  const downButton = (store: Gtk.SeqStore<Row>, sel: Gtk.TreeSelection): Gtk.Button => {
    const btn = Gtk.new_(Gtk.Button, { label: "Down" });
    Gtk.onButtonClicked(btn, () => {
      const [isSel, , iter] = Gtk.treeSelectionGetSelected(sel);
      const n = Gtk.seqStoreIterToIndex(iter);
      const size = Gtk.seqStoreGetSize(store);
      if (isSel && n < size - 1) {
        const v = Gtk.seqStoreGetValue(store, n);
        Gtk.seqStoreRemove(store, n);
        Gtk.seqStoreInsert(store, n + 1, v);
        // Web: see upButton (Haskell: `treeModelIterNext store iter`).
        const [, iter1] = Gtk.treeModelIterNthChild(store, null, n + 1);
        Gtk.treeSelectionSelectIter(sel, iter1);
      }
    });
    return btn;
  };

  const store = Gtk.seqStoreNew(initial);
  const scroll = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  const style = Gtk.widgetGetStyleContext(scroll);
  Gtk.styleContextAddClass(style, "hades-table");
  Gtk.setScrolledWindowShadowType(scroll, Gtk.ShadowTypeIn);
  Gtk.set(scroll, {
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
  });
  const vw = Gtk.new_(Gtk.TreeView, {
    model: store,
    enableGridLines: Gtk.TreeViewGridLinesBoth,
    hexpand: true,
    vexpand: true,
    heightRequest: 400, // Hard coded, but a reasonable value. The default is tiny.
  });
  Gtk.containerAdd(scroll, vw);
  // Tracking changes.
  let blockSignals = false;
  const stop1 = reactimate1(B.mapE((v: readonly Row[]) => () => updateStore(store, v), e));
  const ch = B.changes(B.mapB((v: readonly Row[]) => () => {
    blockSignals = true;
    updateStore(store, v);
    blockSignals = false;
  }, b));
  const stop2 = reactimate1_(ch);
  const storeChangeHandler = (): readonly [null, Maybe<Row[]>] => {
    const block = blockSignals;
    return block ? [null, Nothing] : [null, Just(Gtk.seqStoreToList(store))];
  };
  const changed = B.filterJust(
    registerIOSignal2(store, Gtk.afterTreeModelRowChanged, (_p, _it) => storeChangeHandler()));
  const deleted = B.filterJust(
    registerIOSignal1(store, Gtk.afterTreeModelRowDeleted, (_p) => storeChangeHandler()));
  const inserted = B.filterJust(
    registerIOSignal2(store, Gtk.afterTreeModelRowInserted, (_p, _it) => storeChangeHandler()));
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
  });
  // Selection plumbing.
  const sel = Gtk.treeViewGetSelection(vw);
  Gtk.treeSelectionSetMode(sel, Gtk.SelectionModeSingle);
  for (const col of cols) {
    Gtk.treeViewAppendColumn(vw, mkTableColumn(iconTheme, (p, f) => modifyStore(store, p, f), vw, store, col));
  }
  const buttons = Gtk.buttonBoxNew(Gtk.OrientationHorizontal);
  Gtk.buttonBoxSetLayout(buttons, Gtk.ButtonBoxStyleCenter);
  const editEvents = flags.map((flag): B.Event<[number, Row]> => {
    switch (flag.tag) {
      case "TableAdd": {
        const [btn, addEvent] = addButton(store, flag._0, flag._1);
        Gtk.boxPackStart(buttons, btn, false, false, 0);
        return addEvent;
      }
      case "TableDelete": {
        const btn = delButton(store, sel);
        Gtk.boxPackStart(buttons, btn, false, false, 0);
        return B.never();
      }
      case "TableShuffle": {
        Gtk.set(vw, { reorderable: true });
        // #reorderable isn't working. Don't know why. Using buttons instead.
        const b1 = upButton(store, sel);
        const b2 = downButton(store, sel);
        Gtk.boxPackStart(buttons, b1, false, false, 0);
        Gtk.boxPackStart(buttons, b2, false, false, 0);
        return B.never();
      }
    }
  });
  const activationEvent = B.filterJust(activationFlag
    ? registerIOSignal2(vw, Gtk.onTreeViewRowActivated, (path, _c): readonly [null, Maybe<[number, Row]>] => {
      // (n:_) <- fromMaybe [] <$> Gtk.treePathGetIndices path
      const ix = Gtk.treePathGetIndices(path);
      if (ix !== null && ix.length > 0) {
        const n = ix[0];
        const row = Gtk.seqStoreGetValue(store, n);
        return [null, Just<[number, Row]>([n, row])];
      }
      return [null, Nothing];
    })
    : B.never<Maybe<[number, Row]>>());
  const box = Gtk.boxNew(Gtk.OrientationVertical, 1);
  Gtk.boxPackStart(box, scroll, true, true, 0);
  Gtk.boxPackStart(box, buttons, false, false, 0);
  const unionConst = <A>(x: B.Event<A>, y: B.Event<A>): B.Event<A> => B.unionWith((a: A, _b: A) => a, x, y);
  return [
    box,
    store,
    L.foldr1(unionConst, [activationEvent, ...editEvents]),
    L.foldr1(unionConst, [changed, deleted, inserted]),
    // foldr1 safe because lists are never empty.
  ];
}

/** Create a column within a table. */
export function mkTableColumn<Row>(
  iconTheme: Gtk.IconTheme,
  modifyModel: (p: Gtk.TreePath, f: (r: Row) => Row) => void,
  vw: Gtk.TreeView,
  model: Gtk.TreeModel,
  tc: TableColumn<Row>,
): Gtk.TreeViewColumn {
  const col: TableField<Row, any> = tc._0;
  const tvCol = Gtk.new_(Gtk.TreeViewColumn, {
    reorderable: false,
    resizable: true,
    title: col.columnName,
  });
  const fi = col.fieldIcon;
  if (fi.tag === "Just") {
    const iconF = fi.value;
    const icon = Gtk.cellRendererPixbufNew();
    Gtk.cellLayoutPackStart(tvCol, icon, false);
    Gtk.mvCellLayoutSetAttributes(tvCol, icon, model, (item: Row) => ({
      iconName: viewText(col.fieldValue.dot(to(iconF)), item),
    }));
  }
  makeRenderer(iconTheme, modifyModel, model, vw, col, tvCol);
  return tvCol;
}

/**
 * A table allowing you to edit a tree of items. Each individual row can be edited, but
 * rows cannot be added, deleted or moved.
 *
 * @param activationFlag If True then send row activation events (see return value).
 * @param groups Each sublist is used for one level of the tree.
 * @param initial Initial content for table.
 * @param value Updates for table content.
 */
export function mkTreeTableView<Row>(
  iconTheme: Gtk.IconTheme,
  activationFlag: boolean,
  groups: readonly Table<Row>[],
  initial: Forest<Row>,
  value: Changes<Forest<Row>>,
): [Gtk.Box, Gtk.ForestStore<[number, Row]>, B.Event<[Gtk.TreePath, Row]>] {
  const modifyStore = <A>(store: Gtk.ForestStore<A>, path: Gtk.TreePath, f: (a: A) => A): void => {
    Gtk.forestStoreChange(store, path, f);
  };
  const updateForest = <A>(vw: Gtk.TreeView, store: Gtk.ForestStore<A>, newVal: Forest<A>): void => {
    Gtk.forestStoreClear(store);
    const treePath = Gtk.treePathNew(); // Null path for root.
    Gtk.forestStoreInsertForest(store, treePath, 0, newVal);
    Gtk.treeViewExpandAll(vw);
  };
  const store = Gtk.forestStoreNew(mungForest(0, initial));
  const scroll = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  Gtk.set(scroll, {
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
  });
  Gtk.setScrolledWindowShadowType(scroll, Gtk.ShadowTypeIn);
  const vw = Gtk.new_(Gtk.TreeView, {
    model: store,
    enableGridLines: Gtk.TreeViewGridLinesBoth,
    enableTreeLines: true,
    hexpand: true,
    vexpand: true,
  });
  const stop = reactimate1(B.mapE((f: Forest<Row>) => () => updateForest(vw, store, mungForest(0, f)), value.changesE));
  Gtk.onWidgetDestroy(vw, stop);
  Gtk.containerAdd(scroll, vw);
  const sel = Gtk.treeViewGetSelection(vw);
  Gtk.treeSelectionSetMode(sel, Gtk.SelectionModeSingle);
  groups.forEach((cols, n) => {
    for (const field of cols) {
      const field1 = mungTableField(n, field._0);
      const tc = mkTableColumn(iconTheme, (p, f) => modifyStore(store, p, f), vw, store, TableColumn(field1));
      Gtk.treeViewAppendColumn(vw, tc);
    }
  });
  const buttons = Gtk.buttonBoxNew(Gtk.OrientationHorizontal);
  Gtk.buttonBoxSetLayout(buttons, Gtk.ButtonBoxStyleCenter);
  const box = Gtk.boxNew(Gtk.OrientationVertical, 1);
  const activationEvent: B.Event<[Gtk.TreePath, Row]> = activationFlag
    ? registerIOSignal2(vw, Gtk.onTreeViewRowActivated, (path, _c): readonly [null, [Gtk.TreePath, Row]] => {
      const row = Gtk.forestStoreGetValue(store, path);
      return [null, [path, row[1]]];
    })
    : B.never();
  Gtk.boxPackStart(box, scroll, true, true, 0);
  Gtk.boxPackStart(box, buttons, false, false, 0);
  Gtk.treeViewExpandAll(vw);
  return [box, store, activationEvent];
}

/* Design Note:

The tree entries have to be decorated with a depth number, and other types need to be
modified in a corresponding way. This is so that the display distinguishes between an
entity name in level 1 and level 2. The family of functions needed to do this are called
"mung".
*/

function mungTree<A>(level: number, t: Tree<A>): Tree<[number, A]> {
  return Node<[number, A]>([level, t.rootLabel], mungForest(level + 1, t.subForest));
}

function mungForest<A>(level: number, f: Forest<A>): Tree<[number, A]>[] {
  return f.map((t) => mungTree(level, t));
}

function mungTableField<Row, A>(level: number, field: TableField<Row, A>): TableField<[number, Row], A> {
  const mung: Traversal<[number, Row], Row> = traversal(
    (s: [number, Row], f: (v: Row) => Row): [number, Row] => (s[0] === level ? [s[0], f(s[1])] : s),
    (s: [number, Row]) => (s[0] === level ? [s[1]] : []),
  );
  return { ...field, fieldValue: mung.dot(field.fieldValue) };
}

/** `s ^. l` for a fold whose targets are text (the `Monoid Text` instance: concatenation). */
function viewText<S>(l: Fold<S, T.Text>, s: S): T.Text {
  return foldMapOf(l, (x: T.Text) => x, (x: T.Text, y: T.Text) => x + y, "", s);
}

/** `s ^. l` for a fold whose targets are `Maybe a` (the `Monoid (Maybe a)` instance). */
function viewMaybe<S, A>(appendA: (x: A, y: A) => A, l: Fold<S, Maybe<A>>, s: S): Maybe<A> {
  const appendM = (x: Maybe<A>, y: Maybe<A>): Maybe<A> =>
    x.tag === "Nothing" ? y : y.tag === "Nothing" ? x : Just(appendA(x.value, y.value));
  return foldMapOf(l, (x: Maybe<A>) => x, appendM, Nothing as Maybe<A>, s);
}

/**
 * Low level function to create the appropriate renderer and attach it to the
 * "Gtk.TreeViewColumn".
 *
 * @param modifyStore Modify a value in the store.
 * @param store Data store that this renderer accesses.
 * @param vw The widget where the renderer will be displayed.
 * @param col Abstract description of the table column.
 * @param tvCol The GTK column that this renderer must be appended to.
 */
function makeRenderer<Row>(
  iconTheme: Gtk.IconTheme,
  modifyStore: (p: Gtk.TreePath, f: (r: Row) => Row) => void,
  store: Gtk.TreeModel,
  vw: Gtk.TreeView,
  col: TableField<Row, any>,
  tvCol: Gtk.TreeViewColumn,
): void {
  const white = Colour(C.white);
  // If the @TableColumn@ has a "fieldColour" function then this returns the corresponding
  // attribute setter.
  const setColour = (c: Colour): Record<string, unknown> => {
    const bg = colourToRGBA(c);
    const fg = colourToRGBA(contrastText(c));
    return { cellBackgroundRgba: bg, foregroundRgba: fg };
  };
  /** Run the colour chooser started from a colour cell's entry icon. */
  const runColourChooser = async (
    chooser: Gtk.ColorChooserDialog, pathStr: string, upd: (c: Colour) => (r: Row) => Row,
  ): Promise<void> => {
    const r = await Gtk.dialogRun(chooser);
    switch (r) {
      case Gtk.ResponseTypeOk: {
        const colour = rgbaToColour(Gtk.colorChooserGetRgba(chooser));
        const p = Gtk.treePathNewFromString(pathStr);
        modifyStore(p, upd(colour));
        break;
      }
      default:
        break;
    }
    Gtk.widgetDestroy(chooser);
  };

  // createTextRenderer :: (MonadIO m) =>
  //   Prism' Text a -> Gtk.TreeViewColumn -> m Gtk.CellRendererText
  const createTextRenderer = (prsm: Prism<T.Text, any>, tvCol1: Gtk.TreeViewColumn): Gtk.CellRendererText => {
    const txt = Gtk.new_(Gtk.CellRendererText, { editable: true });
    Gtk.cellLayoutPackEnd(tvCol1, txt, true);
    Gtk.mvCellLayoutSetDataFunction(tvCol1, txt, store, (item: Row) => {
      const v: Maybe<any> = preview(col.fieldValue, item);
      const fc = col.fieldColour;
      const colour = fc.tag === "Just" ? setColour(maybe(white, fc.value, v)) : setColour(white);
      Gtk.set(txt, { ...colour, text: fromMaybe("", preview(_Just<any>().dot(re(clonePrism(prsm))), v)) });
    });
    // By default loss of focus merely cancels the edit. This commits the edit instead.
    Gtk.onCellRendererEditingStarted(txt, (editable, _path) => {
      Gtk.onWidgetFocusOutEvent(editable, (_ev) => {
        Gtk.cellEditableEditingDone(editable);
        return false;
      });
    });
    Gtk.onCellRendererTextEdited(txt, (pathStr, newText) => {
      const r = preview(clonePrism(prsm), newText);
      if (r.tag === "Nothing") return;
      const v = r.value;
      const p = Gtk.treePathNewFromString(pathStr);
      modifyStore(p, (row) => set(col.fieldValue, v, row));
    });
    return txt;
  };

  // createComboRenderer :: (MonadIO m) =>
  //    (a -> Text) -> [a] -> Gtk.TreeViewColumn -> m Gtk.CellRenderer
  const createComboRenderer = (
    textFunc: (a: any) => T.Text, vs: readonly any[], tvCol1: Gtk.TreeViewColumn,
  ): Gtk.CellRenderer => {
    const options = Gtk.seqStoreNew(vs);
    Gtk.customStoreSetColumn( // Text representation is column zero.
      options,
      Gtk.ColumnId((g: Gtk.GValue) => Gtk.fromGValue<string | null>(g) ?? "", Gtk.CAString, 0),
      textFunc,
    );
    const combo = Gtk.new_(Gtk.CellRendererCombo, {
      editable: true,
      model: options,
      textColumn: 0,
      hasEntry: false,
    });
    Gtk.cellLayoutPackEnd(tvCol1, combo, true);
    Gtk.mvCellLayoutSetDataFunction(tvCol1, combo, store, (item: Row) => {
      const fc = col.fieldColour;
      const colour = fc.tag === "Just"
        ? setColour(fromMaybe(white, preview(col.fieldValue.dot(to(fc.value)), item)))
        : setColour(white);
      Gtk.set(combo, { ...colour, text: viewText(col.fieldValue.dot(to(textFunc)), item) });
    });
    Gtk.onCellRendererEditingStarted(combo, (editable, _path) => {
      const e = Gtk.castTo(Gtk.ComboBox, editable);
      if (e === null) return;
      const fi = col.fieldIcon;
      if (fi.tag === "Just") {
        const iconF = fi.value;
        const icon = Gtk.new_(Gtk.CellRendererPixbuf, {});
        Gtk.cellLayoutPackStart(e, icon, false);
        Gtk.mvCellLayoutSetAttributes(e, icon, options, (item: any) => ({ iconName: iconF(item) }));
      }
      const fc = col.fieldColour;
      if (fc.tag === "Just") {
        const colourF = fc.value;
        for (const cell of Gtk.cellLayoutGetCells(e)) {
          const txt = Gtk.castTo(Gtk.CellRendererText, cell);
          if (txt === null) continue;
          Gtk.mvCellLayoutSetDataFunction(e, txt, options, (item: any) => {
            const c = setColour(colourF(item));
            Gtk.set(txt, c);
          });
        }
      }
    });
    Gtk.onCellRendererComboChanged(combo, (pathStr, iter) => {
      const v = Gtk.customStoreGetRow<any>(options, iter);
      const p = Gtk.treePathNewFromString(pathStr);
      modifyStore(p, (row) => set(col.fieldValue, v, row));
    });
    return Gtk.toCellRenderer(combo);
  };

  /** The date cell: a text cell with a calendar popover (the `EditDate` and `Opt EditDate` cases). */
  const dateEditingStarted = (
    txt: Gtk.CellRendererText, prsm: Prism<T.Text, any>, upd: (d: string) => (r: Row) => Row,
  ): void => {
    Gtk.onCellRendererEditingStarted(txt, (editable, pathStr) => {
      const entry = Gtk.castTo(Gtk.Entry, editable);
      if (entry === null) return;
      // The popover grabs the focus, which causes "entry" to be umapped and
      // unparented. Hence we have to stick the popover to its rectangle on
      // the parent widget instead.
      const [overlay, calendar] = createDatePopover(prsm, entry);
      Gtk.onWidgetSizeAllocate(entry, (posn) => {
        const y = Gdk.getRectangleY(posn);
        const x = Gdk.getRectangleX(posn);
        const [x1, y1] = Gtk.treeViewConvertTreeToWidgetCoords(vw, x, y);
        Gdk.setRectangleX(posn, x1);
        Gdk.setRectangleY(posn, y1);
        const parent = Gtk.widgetGetParent(entry);
        Gtk.popoverSetRelativeTo(overlay, parent);
        Gtk.popoverSetPointingTo(overlay, posn);
      });
      Gtk.onCalendarDaySelectedDoubleClick(calendar, () => {
        const p = Gtk.treePathNewFromString(pathStr);
        const [year, month, day] = Gtk.calendarGetDate(calendar);
        const date = fromGregorian(year, month + 1, day);
        modifyStore(p, upd(date));
        Gtk.popoverPopdown(overlay);
      });
    });
  };

  const renderer = (ed: FieldEditor<any>): void => {
    switch (ed.tag) {
      case "EditBool": {
        const tick = Gtk.new_(Gtk.CellRendererText, { editable: true, sensitive: true });
        // Not using CellRendererToggle because it cannot be coloured.
        Gtk.cellLayoutPackEnd(tvCol, tick, true);
        Gtk.mvCellLayoutSetDataFunction(tvCol, tick, store, (item: Row) => {
          const fc = col.fieldColour;
          const colour = fc.tag === "Just"
            ? setColour(fromMaybe(white, preview(col.fieldValue.dot(to(fc.value)), item)))
            : setColour(white);
          const b = viewText(col.fieldValue.dot(to((b1: boolean) => (b1 ? "🗹" : "☐"))), item);
          // Unicode U+1F5F9 and U+2610
          Gtk.set(tick, { ...colour, text: b });
        });
        Gtk.onCellRendererEditingStarted(tick, (_editable, pathStr) => {
          // Toggle the stored value and cancel the edit.
          const p = Gtk.treePathNewFromString(pathStr);
          modifyStore(p, (row) => over(col.fieldValue, (x: boolean) => !x, row));
          Gtk.cellRendererStopEditing(tick, true);
        });
        return;
      }
      case "EditEntry":
        createTextRenderer(ed._0, tvCol);
        return;
      case "EditNote": {
        const c = createTextRenderer(identity<T.Text>(), tvCol);
        Gtk.set(c, { wrapMode: Pango.WrapModeWordChar, wrapWidth: 200 });
        // ToDo: Figure out how to implement
        // https://github.com/otsaloma/gaupol/blob/master/gaupol/renderers/multiline.py
        // in Haskell.
        return;
      }
      case "EditEnum":
        createComboRenderer(ed._0, ed._1, tvCol);
        return;
      case "EditDate": {
        const fmt = ed._0;
        const txt = createTextRenderer(datePrism(fmt), tvCol);
        dateEditingStarted(txt, datePrism(fmt), (date) => (row) => set(col.fieldValue, date, row));
        return;
      }
      case "EditColour": {
        const txt = Gtk.new_(Gtk.CellRendererText, { editable: true, widthChars: 12 });
        Gtk.cellLayoutPackEnd(tvCol, txt, true);
        Gtk.mvCellLayoutSetDataFunction(tvCol, txt, store, (item: Row) => {
          const colour = setColour(fromMaybe(white, preview(col.fieldValue, item)));
          Gtk.set(txt, { ...colour, text: viewText(col.fieldValue.dot(re(colourPrism)), item) });
        });
        Gtk.onCellRendererTextEdited(txt, (pathStr, newText) => {
          const r = preview(colourPrism, newText);
          switch (r.tag) {
            case "Nothing":
              return;
            case "Just": {
              const p = Gtk.treePathNewFromString(pathStr);
              modifyStore(p, (row) => set(col.fieldValue, r.value, row));
              return;
            }
          }
        });
        Gtk.onCellRendererEditingStarted(txt, (editable, pathStr) => {
          const entry = Gtk.castTo(Gtk.Entry, editable);
          if (entry === null) return;
          const chooser = createColorDialog(entry);
          Gtk.onEntryIconPress(entry, (_pos, _ev) => {
            // Web: dialogRun is asynchronous.
            runColourChooser(chooser, pathStr, (colour) => (row) => set(col.fieldValue, colour, row))
              .catch((err) => void errorBox(vw, String(err)));
          });
        });
        return;
      }
      case "EditIcon": {
        const predicate = ed._0;
        const pic = Gtk.new_(Gtk.CellRendererPixbuf, { sensitive: true });
        Gtk.cellLayoutPackEnd(tvCol, pic, true);
        Gtk.mvCellLayoutSetDataFunction(tvCol, pic, store, (item: Row) => {
          const icon = viewText(col.fieldValue, item);
          const pb = safeLoadIcon(iconTheme, icon, tableIconSize);
          if (pb.tag === "Just") Gtk.set(pic, { pixbuf: pb.value });
          else Gtk.set(pic, { iconName: "" });
        });
        Gtk.onTreeViewRowActivated(vw, (path, activeCol) => {
          const path1 = Gtk.treePathCopy(path); // path is no longer valid once the callback exits.
          if (activeCol === tvCol) {
            const icons = withWaitCursor(vw, () => iconThemeContents(iconTheme, false, predicate));
            iconDialog(vw, icons, (newIcon) =>
              modifyStore(path1, (row) => set(col.fieldValue, newIcon, row)));
          }
        });
        return;
      }
      case "EditCombo":
        createComboRenderer((x: T.Text) => x, ed._0, tvCol);
        return;
      case "EditFixed": {
        const f = ed._0;
        const txt = createTextRenderer(prism_(f, (_t: T.Text) => Nothing), tvCol);
        Gtk.set(txt, { editable: false });
        return;
      }
      case "Opt":
        rendererOpt(ed._0);
        return;
    }
  };

  const rendererOpt = (ed: FieldEditor<any>): void => {
    switch (ed.tag) {
      case "EditBool":
        createComboRenderer(
          (m: Maybe<boolean>) => (m.tag === "Nothing" ? "" : m.value ? "🗹" : "☐"),
          [Nothing, Just(true), Just(false)],
          tvCol,
        );
        return;
      case "EditEntry":
        renderer(EditEntry(prismToMaybe(ed._0)));
        return;
      case "EditNote": {
        const c = createTextRenderer(prismToMaybe(identity<T.Text>()), tvCol);
        Gtk.set(c, { wrapMode: Pango.WrapModeWordChar, wrapWidth: 200 });
        // ToDo: Figure out how to implement
        // https://github.com/otsaloma/gaupol/blob/master/gaupol/renderers/multiline.py
        // in Haskell.
        return;
      }
      case "EditEnum": {
        const textF = ed._0;
        createComboRenderer(
          (m: Maybe<any>) => (m.tag === "Nothing" ? "" : textF(m.value)),
          [Nothing, ...ed._1.map((v) => Just(v))],
          tvCol,
        );
        return;
      }
      case "EditDate": {
        // There is a lot of overlap with the plain EditDate version. This is not good, but
        // factoring out the commonality is non-trivial
        const fmt = ed._0;
        const txt = createTextRenderer(prismToMaybe(datePrism(fmt)), tvCol);
        dateEditingStarted(txt, datePrism(fmt), (date) => (row) => setJust(col.fieldValue, date, row));
        return;
      }
      case "EditColour": {
        const txt = Gtk.new_(Gtk.CellRendererText, { editable: true, widthChars: 12 });
        Gtk.cellLayoutPackEnd(tvCol, txt, true);
        Gtk.mvCellLayoutSetDataFunction(tvCol, txt, store, (item: Row) => {
          const mc = viewMaybe(append_Colour, col.fieldValue, item);
          switch (mc.tag) {
            case "Nothing": {
              const colour = setColour(white);
              Gtk.set(txt, { ...colour, text: "" });
              return;
            }
            case "Just": {
              const c = mc.value;
              const colour = setColour(c);
              Gtk.set(txt, { ...colour, text: viewText(re(colourPrism), c) });
              return;
            }
          }
        });
        Gtk.onCellRendererTextEdited(txt, (pathStr, newText) => {
          const r = preview(prismToMaybe(colourPrism), newText);
          switch (r.tag) {
            case "Nothing":
              return;
            case "Just": {
              const p = Gtk.treePathNewFromString(pathStr);
              modifyStore(p, (row) => set(col.fieldValue, r.value, row));
              return;
            }
          }
        });
        Gtk.onCellRendererEditingStarted(txt, (editable, pathStr) => {
          const entry = Gtk.castTo(Gtk.Entry, editable);
          if (entry === null) return;
          const chooser = createColorDialog(entry);
          Gtk.onEntryIconPress(entry, (_pos, _ev) => {
            // Web: dialogRun is asynchronous.
            runColourChooser(chooser, pathStr, (colour) => (row) => setJust(col.fieldValue, colour, row))
              .catch((err) => void errorBox(vw, String(err)));
          });
        });
        return;
      }
      case "EditIcon": {
        const predicate = ed._0;
        const pic = Gtk.new_(Gtk.CellRendererPixbuf, { sensitive: true });
        Gtk.cellLayoutPackEnd(tvCol, pic, true);
        Gtk.mvCellLayoutSetDataFunction(tvCol, pic, store, (item: Row) => {
          const icon = fromMaybe(noIconName, viewMaybe((x: T.Text, y: T.Text) => x + y, col.fieldValue, item));
          const pb = safeLoadIcon(iconTheme, icon, tableIconSize);
          if (pb.tag === "Just") Gtk.set(pic, { pixbuf: pb.value });
          else Gtk.set(pic, { iconName: "" });
        });
        Gtk.onTreeViewRowActivated(vw, (path, activeCol) => {
          const path1 = Gtk.treePathCopy(path); // path is not valid after the callback exits.
          if (activeCol === tvCol) {
            const icons = withWaitCursor(vw, () => iconThemeContents(iconTheme, true, predicate));
            iconDialog(vw, icons, (newIcon) => {
              const v = newIcon === noIconName ? Nothing : Just(newIcon);
              modifyStore(path1, (row) => set(col.fieldValue, v, row));
            });
          }
        });
        return;
      }
      case "EditCombo":
        createComboRenderer((m: Maybe<T.Text>) => fromMaybe("", m), [Nothing, ...ed._0.map((v) => Just(v))], tvCol);
        return;
      case "EditFixed": {
        const f = ed._0;
        const f2 = (m: Maybe<any>): T.Text => (m.tag === "Nothing" ? "" : f(m.value));
        renderer(EditFixed(f2));
        return;
      }
      case "Opt":
        cannotHappen("makeRenderer: Nested Opt not supported in FieldEditor type.", null);
        return;
    }
  };

  renderer(col.fieldEditor);
}

/** Size of data icons in tables. */
const tableIconSize = 22;

/** Nothing specialised to a type. */
const noAdjustment: Gtk.Adjustment | null = null;
