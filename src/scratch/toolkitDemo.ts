/**
 * Development smoke test for the web GTK toolkit (open the app with `?toolkit-demo`).
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Cairo from "@/lib/GI/Cairo";
import * as Pango from "@/lib/GI/Pango";
import * as Gio from "@/lib/GI/Gio";

export function main(): void {
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Toolkit demo");
  const vbox = Gtk.boxNew("OrientationVertical", 0);
  Gtk.containerAdd(win, vbox);

  // Menu bar
  const mb = Gtk.menuBarNew();
  const file = Gtk.menuItemNewWithMnemonic("_File");
  const fm = Gtk.menuNew();
  const open = Gtk.menuItemNewWithMnemonic("_Open");
  open.iconName = "document-open";
  open.actionName = "win.open";
  Gtk.menuShellAppend(fm, open);
  Gtk.menuShellAppend(fm, Gtk.separatorMenuItemNew());
  const quit = Gtk.menuItemNewWithMnemonic("_Quit");
  Gtk.menuShellAppend(fm, quit);
  Gtk.menuItemSetSubmenu(file, fm);
  Gtk.menuShellAppend(mb, file);
  Gtk.boxPackStart(vbox, mb, false, false, 0);
  const act = Gio.simpleActionNew("open", null);
  Gio.onSimpleActionActivate(act, () => console.log("open activated"));
  Gio.actionMapAddAction(win, act);
  Gio.setAccelsForAction(win, "win.open", ["<Control>o"]);

  // Toolbar
  const tb = Gtk.toolbarNew();
  for (const [lbl, icon] of [["_New", "document-new"], ["_Open", "document-open"], ["_Save", "document-save"]]) {
    const b = Gtk.toolButtonNew(null, lbl);
    Gtk.toolButtonSetIconName(b, icon);
    b.tooltip = lbl.replace("_", "") + " a model";
    Gtk.toolbarInsert(tb, b, -1);
  }
  Gtk.toolbarInsert(tb, Gtk.separatorToolItemNew(), -1);
  const undo = Gtk.menuToolButtonNew(null, "Undo");
  Gtk.toolButtonSetIconName(undo, "edit-undo");
  const um = Gtk.menuNew();
  Gtk.menuShellAppend(um, Gtk.menuItemNewWithLabel("Undo add box"));
  Gtk.menuToolButtonSetMenu(undo, um);
  Gtk.toolbarInsert(tb, undo, -1);
  Gtk.boxPackStart(vbox, tb, false, false, 0);

  // Paned: tree on the left, notebook on the right.
  const paned = Gtk.panedNew("OrientationHorizontal");
  Gtk.panedSetPosition(paned, 260);
  Gtk.boxPackStart(vbox, paned, true, true, 0);

  const store = Gtk.treeStoreNew([Gtk.gtypeString, Gtk.gtypeString]);
  const root = Gtk.treeStoreAppend(store, null);
  Gtk.treeStoreSet(store, root, [0, 1], [Gtk.toGValue("Model"), Gtk.toGValue("model-package")]);
  for (const n of ["Goal G1", "Strategy S1", "Hazards"]) {
    const it = Gtk.treeStoreAppend(store, root);
    Gtk.treeStoreSet(store, it, [0, 1], [Gtk.toGValue(n), Gtk.toGValue("model-package")]);
    for (const k of ["child A", "child B"]) {
      const c = Gtk.treeStoreAppend(store, it);
      Gtk.treeStoreSet(store, c, [0, 1], [Gtk.toGValue(n + " " + k), Gtk.toGValue("model-report")]);
    }
  }
  const tv = Gtk.treeViewNewWithModel(store);
  Gtk.treeViewSetHeadersVisible(tv, false);
  Gtk.treeSelectionSetMode(Gtk.treeViewGetSelection(tv), "SelectionModeMultiple");
  const col = Gtk.treeViewColumnNew();
  const icon = Gtk.cellRendererPixbufNew();
  const txt = Gtk.cellRendererTextNew();
  Gtk.setCellRendererTextEditable(txt, true);
  Gtk.cellLayoutPackStart(col, icon, false);
  Gtk.cellLayoutPackEnd(col, txt, true);
  Gtk.cellLayoutAddAttribute(col, txt, "text", 0);
  Gtk.cellLayoutAddAttribute(col, icon, "icon-name", 1);
  Gtk.treeViewAppendColumn(tv, col);
  Gtk.treeViewExpandRow(tv, Gtk.treePathNewFromIndices([0]), false);
  Gtk.onCellRendererTextEdited(txt, (p, t) => {
    const [, it] = Gtk.treeModelGetIter(store, Gtk.treePathNewFromString(p));
    Gtk.treeStoreSet(store, it, [0], [Gtk.toGValue(t)]);
  });
  Gtk.onTreeViewRowActivated(tv, (p) => console.log("activated", p.toString()));
  Gtk.onWidgetButtonPressEvent(tv, (e) => {
    if (e.button === 3) {
      const m = Gtk.menuNew();
      Gtk.menuShellAppend(m, Gtk.menuItemNewWithLabel("Properties"));
      Gtk.menuShellAppend(m, Gtk.menuItemNewWithLabel("Delete"));
      Gtk.menuPopupAtPointer(m, null);
      return true;
    }
    return false;
  });
  const sw = Gtk.scrolledWindowNew(null, null);
  Gtk.containerAdd(sw, tv);
  Gtk.panedPack1(paned, sw, false, true);

  const nb = Gtk.notebookNew();
  Gtk.notebookSetScrollable(nb, true);
  Gtk.panedPack2(paned, nb, true, true);

  // Page 1: a drawing area.
  const da = Gtk.drawingAreaNew();
  Gtk.styleContextAddClass(da, "hades-diagram");
  Gtk.styleContextAddClass(da, "active-diagram");
  Gtk.onWidgetDraw(da, (cr: Cairo.Context) => {
    Gtk.renderBackground(da, cr, 0, 0, 2000, 2000);
    Cairo.setSourceRGB(cr, 0, 0, 0);
    Cairo.setLineWidth(cr, 1);
    Cairo.rectangle(cr, 40.5, 40.5, 200, 100);
    Cairo.stroke(cr);
    Cairo.arc(cr, 400, 90, 50, 0, 2 * Math.PI);
    Cairo.setSourceRGB(cr, 0.8, 0.9, 1);
    Cairo.fillPreserve(cr);
    Cairo.setSourceRGB(cr, 0, 0, 0.6);
    Cairo.stroke(cr);
    const l = Pango.createLayout(cr);
    const f = Pango.fontDescriptionNew();
    Pango.fontDescriptionSetFamily(f, "Roboto,Symbola,STIX Two Text");
    Pango.fontDescriptionSetSize(f, 9 * Pango.SCALE);
    Pango.layoutSetFontDescription(l, f);
    Pango.layoutSetWidth(l, 190 * Pango.SCALE);
    Pango.layoutSetAlignment(l, "AlignmentCenter");
    Pango.layoutSetText(l, "G1: The system is acceptably safe to operate in its intended environment", -1);
    const attrs = Pango.attrListNew();
    const b = Pango.attrWeightNew("WeightBold");
    Pango.setAttributeEndIndex(b, 3);
    Pango.attrListInsert(attrs, b);
    Pango.layoutSetAttributes(l, attrs);
    Cairo.setSourceRGB(cr, 0, 0, 0);
    Cairo.moveTo(cr, 45, 50);
    Pango.showLayout(cr, l);
    return true;
  });
  const tab1 = Gtk.boxNew("OrientationHorizontal", 4);
  Gtk.boxPackStart(tab1, Gtk.labelNew("Diagram 1"), false, false, 0);
  const close = Gtk.buttonNewFromIconName("window-close-symbolic", "IconSizeMenu");
  Gtk.buttonSetRelief(close, "ReliefStyleNone");
  Gtk.boxPackStart(tab1, close, false, false, 0);
  Gtk.notebookAppendPage(nb, da, tab1);

  // Page 2: a form.
  const grid = Gtk.gridNew();
  Gtk.gridSetRowSpacing(grid, 6);
  Gtk.gridSetColumnSpacing(grid, 6);
  grid.margin = { top: 12, bottom: 12, start: 12, end: 12 };
  const e = Gtk.entryNew();
  Gtk.entrySetText(e, "Fuel pump");
  e.hexpand = true;
  Gtk.gridAttach(grid, Gtk.labelNew("Name:"), 0, 0, 1, 1);
  Gtk.gridAttach(grid, e, 1, 0, 1, 1);
  const chk = Gtk.checkButtonNewWithLabel("Developed");
  Gtk.gridAttach(grid, chk, 1, 1, 1, 1);
  const r1 = Gtk.radioButtonNewWithLabel(null, "One");
  const r2 = Gtk.radioButtonNewWithLabel([r1], "Many");
  const rb = Gtk.boxNew("OrientationHorizontal", 12);
  Gtk.boxPackStart(rb, r1, false, false, 0);
  Gtk.boxPackStart(rb, r2, false, false, 0);
  Gtk.gridAttach(grid, Gtk.labelNew("Cardinality:"), 0, 2, 1, 1);
  Gtk.gridAttach(grid, rb, 1, 2, 1, 1);
  const ls = Gtk.listStoreNew([Gtk.gtypeString, Gtk.gtypeString]);
  for (const [t, ic] of [["Hazard", "dialog-warning"], ["Control", "emblem-ok"], ["Event", "x-office-calendar"]]) {
    const it = Gtk.listStoreAppend(ls);
    Gtk.listStoreSet(ls, it, [0, 1], [Gtk.toGValue(t), Gtk.toGValue(ic)]);
  }
  const combo = Gtk.comboBoxNewWithModel(ls);
  const ci = Gtk.cellRendererPixbufNew();
  const ct = Gtk.cellRendererTextNew();
  Gtk.cellLayoutPackStart(combo, ci, false);
  Gtk.cellLayoutPackStart(combo, ct, true);
  Gtk.cellLayoutAddAttribute(combo, ci, "icon-name", 1);
  Gtk.cellLayoutAddAttribute(combo, ct, "text", 0);
  Gtk.comboBoxSetActive(combo, 0);
  Gtk.gridAttach(grid, Gtk.labelNew("Type:"), 0, 3, 1, 1);
  Gtk.gridAttach(grid, combo, 1, 3, 1, 1);
  const tvw = Gtk.textViewNew();
  Gtk.textBufferSetText(Gtk.textViewGetBuffer(tvw), "Description text...");
  Gtk.styleContextAddClass(tvw, "memo-medium");
  Gtk.gridAttach(grid, Gtk.labelNew("Description:"), 0, 4, 1, 1);
  Gtk.gridAttach(grid, tvw, 1, 4, 1, 1);
  const btn = Gtk.buttonNewWithLabel("Show dialog");
  Gtk.onButtonClicked(btn, async () => {
    const d = Gtk.dialogNew();
    Gtk.windowSetTitle(d, "Properties");
    const lbl = Gtk.labelNew("This is a dialog.");
    Gtk.boxPackStart(Gtk.dialogGetContentArea(d), lbl, true, true, 6);
    Gtk.dialogAddButton(d, "_Cancel", Gtk.ResponseTypeCancel);
    Gtk.dialogAddButton(d, "_OK", Gtk.ResponseTypeOk);
    const r = await Gtk.dialogRun(d);
    console.log("response", r);
    Gtk.widgetDestroy(d);
    const m = Gtk.messageDialogNew(win, null, "MessageTypeQuestion", "ButtonsTypeYesNo", "Save changes to the model?");
    Gtk.messageDialogFormatSecondaryText(m, "If you don't save, changes will be lost.");
    const r2 = await Gtk.dialogRun(m);
    console.log("message response", r2);
    Gtk.widgetDestroy(m);
  });
  Gtk.gridAttach(grid, btn, 1, 5, 1, 1);
  const frame = Gtk.frameNew("Frame");
  Gtk.containerAdd(frame, grid);
  Gtk.notebookAppendPage(nb, frame, Gtk.labelNew("Form"));

  // Status bar with scale
  const bottom = Gtk.boxNew("OrientationHorizontal", 6);
  Gtk.boxPackStart(bottom, Gtk.labelNew("Click and drag to define the new shape."), false, false, 4);
  const slider = Gtk.scaleNewWithRange("OrientationHorizontal", -1, 1, 0.1);
  Gtk.scaleSetDrawValue(slider, false);
  Gtk.widgetSetSizeRequest(slider, 100, -1);
  Gtk.boxPackEnd(bottom, slider, false, false, 4);
  Gtk.boxPackStart(vbox, bottom, false, false, 2);

  Gtk.windowPresent(win);
  Gtk.main();
}
