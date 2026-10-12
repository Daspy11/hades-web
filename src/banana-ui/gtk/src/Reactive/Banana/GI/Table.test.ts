// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node, type Forest } from "@/lib/Data/Tree";
import { lens, type Lens } from "@/lib/Control/Lens";
import { longDate, makeChanges, textPrismInt } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  EditBool, EditColour, EditCombo, EditDate, EditEntry, EditFixed, EditIcon, EditNote, Opt, TableAdd, TableDelete,
  TableShuffle,
  enumField, mkField, type Table,
} from "@/banana-ui/base/Reactive/Banana/Table";
import { mkTableView, mkTreeTableView } from "./Table";

interface Row {
  readonly name: string;
  readonly count: number;
  readonly done: boolean;
  readonly kind: "Alpha" | "Beta";
  readonly colour: C.Colour;
  readonly note: Maybe<string>;
}
const field = <K extends keyof Row>(k: K): Lens<Row, Row[K]> =>
  lens((r: Row) => r[k], (r: Row, v: Row[K]) => ({ ...r, [k]: v }));

const row = (name: string, count: number, done = false): Row =>
  ({ name, count, done, kind: "Alpha", colour: C.sRGB24(255, 0, 0), note: Nothing });

const cols: Table<Row> = [
  mkField("Name", field("name"), Nothing, EditNote, Nothing),
  mkField("Count", field("count"), Nothing, EditEntry(textPrismInt), Nothing),
  mkField("Done", field("done"), Nothing, EditBool, Nothing),
  mkField("Kind", field("kind"), Nothing, enumField(["Alpha", "Beta"] as const), Nothing),
  mkField("Colour", field("colour"), Nothing, EditColour, Nothing),
  mkField("Note", field("note"), Nothing, Opt(EditNote), Nothing),
];

function collect<A>(e: B.Event<A>): A[] {
  const out: A[] = [];
  B.subscribeE(e, (a) => out.push(a));
  return out;
}

/** The rendered properties of the n'th cell renderer of a column for a row. */
function cellProps(vw: Gtk.TreeView, col: number, rowIx: number, cell = 0): Record<string, any> {
  const m = vw.model!;
  const c = vw.columns[col];
  return Gtk.computeCellProps(m, m.roots()[rowIx], c, c.cells[cell].cell);
}

function findTreeView(w: Gtk.Widget): Gtk.TreeView {
  if (w instanceof Gtk.TreeView) return w;
  for (const c of w.getChildren()) {
    try {
      return findTreeView(c);
    } catch {
      // keep looking
    }
  }
  throw new Error("no tree view");
}

function buttons(box: Gtk.Box): Gtk.Button[] {
  return (box.children[1] as Gtk.ButtonBox).children as Gtk.Button[];
}

function setup(flags = [TableAdd<Row>("Row", row("new", 0)), TableDelete, TableShuffle], activation = true) {
  const [e, fireE] = B.newEvent<readonly Row[]>();
  const [bE, fireB] = B.newEvent<readonly Row[]>();
  const initial = [row("a", 1), row("b", 2, true), row("c", 3)];
  const [box, store, actE, editE] = B.liftMomentIO(() => {
    const b = B.stepper<readonly Row[]>(initial, bE);
    return mkTableView(Gtk.iconThemeGetDefault(), flags, activation, cols, initial, e, b);
  });
  const vw = findTreeView(box);
  return { box, store, vw, acts: collect(actE), edits: collect(editE), fireE, fireB };
}

describe("mkTableView", () => {
  test("populates the store and the columns", () => {
    const { store, vw } = setup();
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["a", "b", "c"]);
    expect(vw.columns.map((c) => c.title)).toEqual(["Name", "Count", "Done", "Kind", "Colour", "Note"]);
    expect(cellProps(vw, 0, 1).text).toBe("b");
    expect(cellProps(vw, 1, 2).text).toBe("3");
    expect(cellProps(vw, 2, 1).text).toBe("🗹");
    expect(cellProps(vw, 2, 0).text).toBe("☐");
    expect(cellProps(vw, 3, 0).text).toBe("Alpha");
    expect(cellProps(vw, 4, 0).text).toBe("#ff0000");
    const bg = cellProps(vw, 4, 0).cellBackgroundRgba;
    expect([bg.red, bg.green, bg.blue, bg.alpha].map((x: number) => Math.round(x * 255))).toEqual([255, 0, 0, 255]);
    const fg = cellProps(vw, 4, 0).foregroundRgba;
    expect([fg.red, fg.green, fg.blue].map((x: number) => Math.round(x * 255))).toEqual([255, 255, 255]);
    expect(cellProps(vw, 5, 0).text).toBe("");
  });

  test("editing a text cell updates the store and fires the edit event", () => {
    const { store, vw, edits } = setup();
    const cell = vw.columns[1].cells[0].cell;
    cell.emit("edited", "1", "42");
    expect(Gtk.seqStoreGetValue(store, 1).count).toBe(42);
    expect(edits.length).toBe(1);
    expect(edits[0].map((r) => r.count)).toEqual([1, 42, 3]);
    // An invalid entry is ignored.
    cell.emit("edited", "1", "forty");
    expect(Gtk.seqStoreGetValue(store, 1).count).toBe(42);
    expect(edits.length).toBe(1);
  });

  test("optional text cells accept blanks as Nothing", () => {
    const { store, vw } = setup();
    const cell = vw.columns[5].cells[0].cell;
    cell.emit("edited", "0", "memo");
    expect(Gtk.seqStoreGetValue(store, 0).note).toEqual(Just("memo"));
    cell.emit("edited", "0", "");
    expect(Gtk.seqStoreGetValue(store, 0).note).toEqual(Nothing);
  });

  test("starting to edit a boolean cell toggles it", () => {
    const { store, vw } = setup();
    const col = vw.columns[2];
    vw.startEditing(Gtk.treePathNewFromString("0"), col, col.cells[0].cell, "☐");
    expect(Gtk.seqStoreGetValue(store, 0).done).toBe(true);
    expect(vw.editing).toBe(null);
  });

  test("choosing from an enumeration combo sets the value", () => {
    const { store, vw } = setup();
    const combo = vw.columns[3].cells[0].cell as Gtk.CellRendererCombo;
    const options = combo.base.model as Gtk.SeqStore<string>;
    expect(options.columnValue(options.roots()[1], 0)).toBe("Beta");
    const [, it] = Gtk.treeModelIterNthChild(options, null, 1);
    combo.emit("changed", "2", it);
    expect(Gtk.seqStoreGetValue(store, 2).kind).toBe("Beta");
  });

  test("updates from the event are applied and reported; behavior changes are not reported", () => {
    const { store, edits, fireE, fireB } = setup();
    fireE([row("a", 1), row("z", 9)]);
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["a", "z"]);
    expect(edits.length).toBeGreaterThan(0);
    const n = edits.length;
    fireB([row("p", 1), row("q", 2), row("r", 3), row("s", 4)]);
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["p", "q", "r", "s"]);
    expect(edits.length).toBe(n);
  });

  test("the add, delete and move buttons edit the list", () => {
    const { box, store, vw, acts } = setup();
    const [add, del, up, down] = buttons(box);
    expect([add, del, up, down].map((b) => b.label)).toEqual(["+ Row", "Delete", "Up", "Down"]);
    add.emit("clicked");
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["a", "b", "c", "new"]);
    expect(acts).toEqual([[3, row("new", 0)]]);
    const sel = Gtk.treeViewGetSelection(vw);
    Gtk.treeSelectionSelectPath(sel, Gtk.treePathNewFromString("1"));
    up.emit("clicked");
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["b", "a", "c", "new"]);
    // The selection follows the moved row.
    down.emit("clicked");
    down.emit("clicked");
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["a", "c", "b", "new"]);
    del.emit("clicked");
    expect(Gtk.seqStoreToList(store).map((r) => r.name)).toEqual(["a", "c", "new"]);
  });

  test("row activation reports the index and row", () => {
    const { vw, acts } = setup();
    vw.emit("row-activated", Gtk.treePathNewFromString("2"), vw.columns[0]);
    expect(acts).toEqual([[2, row("c", 3)]]);
  });
});

describe("mkTableView: other cell editors", () => {
  interface R2 {
    readonly kind: "Alpha" | "Beta";
    readonly flag: Maybe<boolean>;
    readonly tag: string;
    readonly opt: Maybe<string>;
    readonly fixed: number;
    readonly due: string;
    readonly paint: Maybe<C.Colour>;
  }
  const f2 = <K extends keyof R2>(k: K): Lens<R2, R2[K]> =>
    lens((r: R2) => r[k], (r: R2, v: R2[K]) => ({ ...r, [k]: v }));
  const kindColour = (k: "Alpha" | "Beta"): C.Colour => (k === "Alpha" ? C.sRGB24(0, 0, 0) : C.sRGB24(255, 255, 255));
  const cols2: Table<R2> = [
    mkField("Kind", f2("kind"), Just((k: string) => "icon-" + k), enumField(["Alpha", "Beta"] as const), Just(kindColour)),
    mkField("Flag", f2("flag"), Nothing, Opt(EditBool), Nothing),
    mkField("Tag", f2("tag"), Nothing, EditCombo(["red", "green"]), Nothing),
    mkField("Opt", f2("opt"), Nothing, Opt(EditCombo(["x", "y"])), Nothing),
    mkField("Fixed", f2("fixed"), Nothing, EditFixed((n: number) => `#${n}`), Nothing),
    mkField("Due", f2("due"), Nothing, EditDate(longDate), Nothing),
    mkField("Paint", f2("paint"), Nothing, Opt(EditColour), Nothing),
  ];
  const r0: R2 = {
    kind: "Alpha", flag: Nothing, tag: "green", opt: Just("y"), fixed: 7, due: "2018-01-03", paint: Nothing,
  };

  function setup2() {
    const [box, store] = B.liftMomentIO(() =>
      mkTableView(Gtk.iconThemeGetDefault(), [], false, cols2, [r0], B.never(), B.pureB<readonly R2[]>([r0])));
    return { store, vw: findTreeView(box) };
  }

  /** Start editing the last (editable) cell of a column, as a click on the cell does. */
  function startEdit(vw: Gtk.TreeView, col: number): Gtk.CellEditable {
    const c = vw.columns[col];
    const cell = c.cells[c.cells.length - 1].cell;
    const text = String(cellProps(vw, col, 0, c.cells.length - 1).text ?? "");
    vw.startEditing(Gtk.treePathNewFromString("0"), c, cell, text);
    return vw.editing!.entry;
  }

  test("cells show the field values, with the column icon", () => {
    const { vw } = setup2();
    expect(vw.columns[0].cells.map((p) => p.cell.kind)).toEqual(["pixbuf", "combo"]);
    expect(cellProps(vw, 0, 0, 0).iconName).toBe("icon-Alpha");
    expect(cellProps(vw, 0, 0, 1).text).toBe("Alpha");
    expect(cellProps(vw, 1, 0).text).toBe("");
    expect(cellProps(vw, 2, 0).text).toBe("green");
    expect(cellProps(vw, 3, 0).text).toBe("y");
    expect(cellProps(vw, 4, 0).text).toBe("#7");
    expect(cellProps(vw, 4, 0).editable).toBe(false);
    expect(cellProps(vw, 5, 0).text).toBe("3 January 2018");
    expect(cellProps(vw, 6, 0).text).toBe("");
  });

  test("a combo cell is edited with a ComboBox decorated with the field's icon and colour", () => {
    const { store, vw } = setup2();
    const ed = startEdit(vw, 0);
    const combo = Gtk.castTo(Gtk.ComboBox, ed)!;
    expect(combo).not.toBe(null);
    expect(combo.active).toBe(0);
    const items = combo.model!.roots().map((n) => combo.itemProps(n));
    // The text cell of gtk_cell_renderer_combo_start_editing, then the icon packed by the table.
    expect(items.map((ps) => ps.map((p) => p.kind))).toEqual([["text", "pixbuf"], ["text", "pixbuf"]]);
    expect(items.map((ps) => ps[0].text)).toEqual(["Alpha", "Beta"]);
    expect(items.map((ps) => ps[1].iconName)).toEqual(["icon-Alpha", "icon-Beta"]);
    const fg = items[0][0].foregroundRgba;
    // White text on black.
    expect([fg.red, fg.green, fg.blue].map((x: number) => Math.round(x * 255))).toEqual([255, 255, 255]);
    // Choosing an item and finishing the edit stores the value.
    combo.setActive(1, true);
    Gtk.cellEditableEditingDone(combo);
    expect(vw.editing).toBe(null);
    expect(Gtk.seqStoreGetValue(store, 0).kind).toBe("Beta");
  });

  test("optional booleans and combos offer a blank choice", () => {
    const { store, vw } = setup2();
    const flag = Gtk.castTo(Gtk.ComboBox, startEdit(vw, 1))!;
    expect(flag.model!.roots().map((n) => flag.model!.columnValue(n, 0))).toEqual(["", "🗹", "☐"]);
    flag.setActive(2, true);
    Gtk.cellEditableEditingDone(flag);
    expect(Gtk.seqStoreGetValue(store, 0).flag).toEqual(Just(false));
    const opt = Gtk.castTo(Gtk.ComboBox, startEdit(vw, 3))!;
    expect(opt.active).toBe(2);
    opt.setActive(0, true);
    Gtk.cellEditableEditingDone(opt);
    expect(Gtk.seqStoreGetValue(store, 0).opt).toEqual(Nothing);
    const tag = Gtk.castTo(Gtk.ComboBox, startEdit(vw, 2))!;
    tag.setActive(0, true);
    Gtk.cellEditableEditingDone(tag);
    expect(Gtk.seqStoreGetValue(store, 0).tag).toBe("red");
  });

  test("cancelling a combo edit leaves the value alone", () => {
    const { store, vw } = setup2();
    startEdit(vw, 2);
    vw.stopEditing(true);
    expect(vw.editing).toBe(null);
    expect(Gtk.seqStoreGetValue(store, 0).tag).toBe("green");
  });

  test("text entry editors: dates, optional colours, and focus-out commits", () => {
    const { store, vw } = setup2();
    const due = Gtk.castTo(Gtk.Entry, startEdit(vw, 5))!;
    expect(Gtk.entryGetText(due)).toBe("3 January 2018");
    // The calendar icon of createDatePopover.
    expect(due.icons.EntryIconPositionSecondary).toBe("x-office-calendar-symbolic");
    Gtk.entrySetText(due, "14/2/2019");
    due.emit("focus-out-event", null);
    expect(Gtk.seqStoreGetValue(store, 0).due).toBe("2019-02-14");
    const paint = Gtk.castTo(Gtk.Entry, startEdit(vw, 6))!;
    expect(paint.icons.EntryIconPositionSecondary).toBe("applications-science");
    Gtk.entrySetText(paint, "#102030");
    paint.emit("activate");
    expect(C.sRGB24show((Gtk.seqStoreGetValue(store, 0).paint as { value: C.Colour }).value)).toBe("#102030");
    expect(cellProps(vw, 6, 0).text).toBe("#102030");
    const paint2 = Gtk.castTo(Gtk.Entry, startEdit(vw, 6))!;
    Gtk.entrySetText(paint2, "");
    paint2.emit("activate");
    expect(Gtk.seqStoreGetValue(store, 0).paint).toEqual(Nothing);
  });
});

describe("mkTreeTableView", () => {
  interface Item { readonly label: string }
  const label: Lens<Item, string> = lens((i: Item) => i.label, (_i: Item, l: string) => ({ label: l }));
  const forest: Forest<Item> = [
    Node({ label: "top" }, [Node({ label: "child1" }), Node({ label: "child2" })]),
  ];

  test("decorates rows with their depth and shows each level's columns", () => {
    const [e] = B.newEvent<Forest<Item>>();
    const [box, store, act] = B.liftMomentIO(() => mkTreeTableView(
      Gtk.iconThemeGetDefault(), true,
      [[mkField("Level 0", label, Nothing, EditNote, Nothing)], [mkField("Level 1", label, Nothing, EditNote, Nothing)]],
      forest, makeChanges(forest, e),
    ));
    const acts = collect(act);
    expect(Gtk.forestStoreGetForest(store).map((t) => t.rootLabel)).toEqual([[0, { label: "top" }]]);
    expect(Gtk.forestStoreGetValue(store, Gtk.treePathNewFromString("0:1"))).toEqual([1, { label: "child2" }]);
    const vw = findTreeView(box);
    const m = vw.model!;
    const top = m.roots()[0], kid = top.children[0];
    const c0 = vw.columns[0], c1 = vw.columns[1];
    expect(Gtk.computeCellProps(m, top, c0, c0.cells[0].cell).text).toBe("top");
    expect(Gtk.computeCellProps(m, top, c1, c1.cells[0].cell).text).toBe("");
    expect(Gtk.computeCellProps(m, kid, c1, c1.cells[0].cell).text).toBe("child1");
    expect(Gtk.computeCellProps(m, kid, c0, c0.cells[0].cell).text).toBe("");
    // Editing a level 1 cell changes only that row.
    c1.cells[0].cell.emit("edited", "0:0", "renamed");
    expect(Gtk.forestStoreGetValue(store, Gtk.treePathNewFromString("0:0"))).toEqual([1, { label: "renamed" }]);
    vw.emit("row-activated", Gtk.treePathNewFromString("0:1"), c0);
    expect(acts.map(([p, r]) => [p.toString(), r])).toEqual([["0:1", { label: "child2" }]]);
  });

  test("replaces the forest when the value changes", () => {
    const [e, fire] = B.newEvent<Forest<Item>>();
    const [, store] = B.liftMomentIO(() => mkTreeTableView(
      Gtk.iconThemeGetDefault(), false, [[mkField("L", label, Nothing, EditNote, Nothing)]], forest, makeChanges(forest, e),
    ));
    fire([Node({ label: "x" }), Node({ label: "y" }, [Node({ label: "z" })])]);
    expect(Gtk.forestStoreGetForest(store).map((t) => t.rootLabel)).toEqual([[0, { label: "x" }], [0, { label: "y" }]]);
    expect(Gtk.forestStoreGetValue(store, Gtk.treePathNewFromString("1:0"))).toEqual([1, { label: "z" }]);
  });
});

describe("mkTableView: icons, pickers and dialogs", () => {
  interface R3 {
    readonly icon: string;
    readonly optIcon: Maybe<string>;
    readonly colour: C.Colour;
    readonly optColour: Maybe<C.Colour>;
    readonly due: string;
    readonly optDue: Maybe<string>;
    readonly kind: Maybe<"Alpha" | "Beta">;
    readonly fixed: Maybe<number>;
    readonly nested: Maybe<Maybe<string>>;
  }
  const f3 = <K extends keyof R3>(k: K): Lens<R3, R3[K]> =>
    lens((r: R3) => r[k], (r: R3, v: R3[K]) => ({ ...r, [k]: v }));
  const r0: R3 = {
    icon: "document-open", optIcon: Nothing, colour: C.sRGB24(255, 0, 0), optColour: Just(C.sRGB24(0, 0, 255)),
    due: "2018-01-03", optDue: Nothing, kind: Just("Beta"), fixed: Nothing, nested: Nothing,
  };
  const cols3: Table<R3> = [
    mkField("Icon", f3("icon"), Nothing, EditIcon((c) => c === "actions"), Nothing),
    mkField("OptIcon", f3("optIcon"), Nothing, Opt(EditIcon((c) => c === "actions")), Nothing),
    mkField("Colour", f3("colour"), Nothing, EditColour, Nothing),
    mkField("OptColour", f3("optColour"), Nothing, Opt(EditColour), Nothing),
    mkField("Due", f3("due"), Nothing, EditDate(longDate), Nothing),
    mkField("OptDue", f3("optDue"), Nothing, Opt(EditDate(longDate)), Nothing),
    mkField("Kind", f3("kind"), Nothing, Opt(enumField(["Alpha", "Beta"] as const)), Nothing),
    mkField("Fixed", f3("fixed"), Nothing, Opt(EditFixed((n: number) => `#${n}`)), Nothing),
  ];

  function setup3(columns: Table<R3> = cols3) {
    const [box, store] = B.liftMomentIO(() =>
      mkTableView(Gtk.iconThemeGetDefault(), [], false, columns, [r0], B.never(), B.pureB<readonly R3[]>([r0])));
    return { store, vw: findTreeView(box) };
  }

  function startEdit(vw: Gtk.TreeView, col: number): Gtk.Entry {
    const c = vw.columns[col];
    const cell = c.cells[c.cells.length - 1].cell;
    vw.startEditing(Gtk.treePathNewFromString("0"), c, cell, String(cellProps(vw, col, 0).text ?? ""));
    return Gtk.castTo(Gtk.Entry, vw.editing!.entry)!;
  }

  /** The live toplevels of a class. */
  function live<W extends Gtk.Widget>(cls: new (...args: any[]) => W): W[] {
    return Gtk.toplevels.list().filter((w): w is W => w instanceof cls && !w.destroyed);
  }

  function findIn<W extends Gtk.Widget>(cls: new (...args: any[]) => W, w: Gtk.Widget): W {
    if (w instanceof cls) return w;
    for (const c of w.getChildren()) {
      try {
        return findIn(cls, c);
      } catch {
        // keep looking
      }
    }
    throw new Error("not found");
  }

  const iconDialogs = () => live(Gtk.Window).filter((w) => w.title === "Icon Selection");

  test("icon cells show the icon; activating the icon column opens the icon dialog", () => {
    const { store, vw } = setup3();
    expect(vw.columns[0].cells[0].cell.kind).toBe("pixbuf");
    expect(cellProps(vw, 0, 0).pixbuf.url).toMatch(/document-open/);
    // Nothing is shown as the no-icon icon.
    expect(cellProps(vw, 1, 0).pixbuf.url).toMatch(/no-icon/);
    // Activating another column does not open the dialog.
    const before = iconDialogs().length;
    vw.emit("row-activated", Gtk.treePathNewFromString("0"), vw.columns[2]);
    expect(iconDialogs().length).toBe(before);
    vw.emit("row-activated", Gtk.treePathNewFromString("0"), vw.columns[0]);
    const dialogs = iconDialogs();
    expect(dialogs.length).toBe(before + 1);
    const dialog = dialogs[dialogs.length - 1];
    // One tab: the "actions" context only, without the no-icon entry.
    const book = findIn(Gtk.Notebook, dialog);
    expect(Gtk.notebookGetNPages(book)).toBe(1);
    const iv = findIn(Gtk.IconView, dialog);
    const first = Gtk.seqStoreGetValue(iv.model as Gtk.SeqStore<{ iconName: string }>, 0).iconName;
    expect(first).not.toBe("no-icon");
    iv.emit("item-activated", Gtk.treePathNewFromString("0"));
    expect(dialog.destroyed).toBe(true);
    expect(Gtk.seqStoreGetValue(store, 0).icon).toBe(first);
  });

  test("optional icon cells offer no-icon first, which stores Nothing", () => {
    const { store, vw } = setup3();
    vw.emit("row-activated", Gtk.treePathNewFromString("0"), vw.columns[1]);
    let dialogs = iconDialogs();
    let iv = findIn(Gtk.IconView, dialogs[dialogs.length - 1]);
    const icons = iv.model as Gtk.SeqStore<{ iconName: string }>;
    expect(Gtk.seqStoreGetValue(icons, 0).iconName).toBe("no-icon");
    const second = Gtk.seqStoreGetValue(icons, 1).iconName;
    iv.emit("item-activated", Gtk.treePathNewFromString("1"));
    expect(Gtk.seqStoreGetValue(store, 0).optIcon).toEqual(Just(second));
    vw.emit("row-activated", Gtk.treePathNewFromString("0"), vw.columns[1]);
    dialogs = iconDialogs();
    iv = findIn(Gtk.IconView, dialogs[dialogs.length - 1]);
    iv.emit("item-activated", Gtk.treePathNewFromString("0"));
    expect(Gtk.seqStoreGetValue(store, 0).optIcon).toEqual(Nothing);
  });

  test("the colour chooser of a colour cell sets the colour when Select is pressed", async () => {
    const { store, vw } = setup3();
    for (const [col, expected] of [[2, C.sRGB24(16, 32, 48)], [3, Just(C.sRGB24(16, 32, 48))]] as const) {
      const entry = startEdit(vw, col);
      entry.emit("icon-press", Gtk.EntryIconPositionSecondary, null);
      const choosers = live(Gtk.ColorChooserDialog);
      const chooser = choosers[choosers.length - 1];
      expect(chooser.visible).toBe(true);
      Gtk.colorChooserSetRgba(chooser, { red: 16 / 255, green: 32 / 255, blue: 48 / 255, alpha: 1 });
      Gtk.dialogResponse(chooser, Gtk.ResponseTypeOk);
      await new Promise((r) => setTimeout(r, 0));
      expect(chooser.destroyed).toBe(true);
      const v = Gtk.seqStoreGetValue(store, 0);
      const got = col === 2 ? v.colour : v.optColour;
      expect(C.sRGB24show(col === 2 ? (got as C.Colour) : (got as { value: C.Colour }).value))
        .toBe(C.sRGB24show(col === 2 ? (expected as C.Colour) : (expected as { value: C.Colour }).value));
      vw.stopEditing(true);
    }
    // Cancel leaves the value alone.
    const entry = startEdit(vw, 2);
    entry.emit("icon-press", Gtk.EntryIconPositionSecondary, null);
    const choosers = live(Gtk.ColorChooserDialog);
    const chooser = choosers[choosers.length - 1];
    Gtk.colorChooserSetRgba(chooser, { red: 1, green: 1, blue: 1, alpha: 1 });
    Gtk.dialogResponse(chooser, Gtk.ResponseTypeCancel);
    await new Promise((r) => setTimeout(r, 0));
    expect(C.sRGB24show(Gtk.seqStoreGetValue(store, 0).colour)).toBe("#102030");
  });

  test("double-clicking a day in the date popover sets the date", () => {
    const { store, vw } = setup3();
    for (const col of [4, 5]) {
      const entry = startEdit(vw, col);
      const pop = live(Gtk.Popover).find((p) => p.relativeTo === entry)!;
      const cal = findIn(Gtk.Calendar, pop);
      entry.emit("icon-press", Gtk.EntryIconPositionSecondary, null);
      expect(pop.open).toBe(true);
      Gtk.calendarSelectMonth(cal, 1, 2019);
      Gtk.calendarSelectDay(cal, 14);
      cal.emit("day-selected-double-click");
      expect(pop.open).toBe(false);
      vw.stopEditing(true);
    }
    expect(Gtk.seqStoreGetValue(store, 0).due).toBe("2019-02-14");
    expect(Gtk.seqStoreGetValue(store, 0).optDue).toEqual(Just("2019-02-14"));
  });

  test("optional enumerations and fixed fields", () => {
    const { store, vw } = setup3();
    expect(cellProps(vw, 6, 0).text).toBe("Beta");
    const combo = vw.columns[6].cells[0].cell as Gtk.CellRendererCombo;
    const options = combo.base.model as Gtk.SeqStore<Maybe<string>>;
    expect(options.roots().map((n) => options.columnValue(n, 0))).toEqual(["", "Alpha", "Beta"]);
    const [, it] = Gtk.treeModelIterNthChild(options, null, 0);
    combo.emit("changed", "0", it);
    expect(Gtk.seqStoreGetValue(store, 0).kind).toEqual(Nothing);
    expect(cellProps(vw, 7, 0).text).toBe("");
    expect(cellProps(vw, 7, 0).editable).toBe(false);
    Gtk.seqStoreSetValue(store, 0, { ...Gtk.seqStoreGetValue(store, 0), fixed: Just(5) });
    expect(cellProps(vw, 7, 0).text).toBe("#5");
  });

  test("a nested Opt is reported with an error box and gets no renderer", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { vw } = setup3([mkField("Nested", f3("nested"), Nothing, Opt(Opt(EditNote)), Nothing)]);
    expect(vw.columns[0].cells.length).toBe(0);
    const box = live(Gtk.MessageDialog).find((d) => d.text.endsWith("makeRenderer: Nested Opt not supported in FieldEditor type."));
    expect(box).toBeDefined();
    Gtk.dialogResponse(box!, Gtk.ResponseTypeClose);
    spy.mockRestore();
  });
});
