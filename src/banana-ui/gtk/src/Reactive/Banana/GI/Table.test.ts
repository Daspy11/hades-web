// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node, type Forest } from "@/lib/Data/Tree";
import { lens, type Lens } from "@/lib/Control/Lens";
import { makeChanges, textPrismInt } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  EditBool, EditColour, EditEntry, EditNote, Opt, TableAdd, TableDelete, TableShuffle, enumField, mkField,
  type Table,
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
