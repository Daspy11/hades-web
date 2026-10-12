// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { Just } from "@/lib/Data/Maybe";
import { readIORef } from "@/lib/Prelude";
import { allBooks, hadesGroup, mergeBook, newBookManager, splitBook, type ActiveEntity, type BookManager } from "./Notebooks";

/** A book manager whose initial notebook sits in a window, as in the application. */
function setup(): { win: Gtk.Window; manager: BookManager<unknown, unknown>; book: Gtk.Notebook } {
  const [w, manager] = B.liftMomentIO(() => newBookManager<unknown, unknown>(B.never(), B.never()));
  const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
  Gtk.containerAdd(win, w);
  return { win, manager, book: w as Gtk.Notebook };
}

const display = (m: BookManager<unknown, unknown>): Gtk.Widget | null => {
  const d = readIORef(m.bookManagerDisplay);
  return d.tag === "Just" ? d.value : null;
};

/** Add a labelled page as the application does. */
function addPage(book: Gtk.Notebook, name: string): Gtk.Widget {
  const page = Gtk.labelNew("Page " + name);
  const lbl = Gtk.labelNew(name);
  const menu = Gtk.labelNew(name);
  Gtk.notebookAppendPageMenu(book, page, lbl, menu);
  Gtk.notebookSetTabDetachable(book, page, true);
  return page;
}

const tabNames = (b: Gtk.Notebook): string[] =>
  b.pages.map((p) => (p.tabLabel as Gtk.Label).text);

describe("newBookManager", () => {
  it("creates an empty, scrollable notebook in the tab group with Split and Merge buttons", () => {
    const { manager, book } = setup();
    expect(book).toBeInstanceOf(Gtk.Notebook);
    expect(display(manager)).toBe(book);
    expect(allBooks(manager)).toEqual([book]);
    expect(Gtk.notebookGetNPages(book)).toBe(0); // The dummy page was removed again.
    expect(book.scrollable).toBe(true);
    expect(book.popupEnabled).toBe(true);
    expect(Gtk.notebookGetGroupName(book)).toBe(hadesGroup);
    const buttons = book.actionWidgets.end as Gtk.Box;
    expect(buttons.children.map((b) => (b as Gtk.Button).label)).toEqual(["Split", "Merge"]);
    expect(readIORef(manager.bookManagerContents)).toEqual([]);
  });

  it("bookManagerModelHandler updates the contents and fires the update event", () => {
    const { manager } = setup();
    const seen: number[] = [];
    B.subscribeE(manager.bookManagerModelUpdate, (xs) => seen.push(xs.length));
    const fake = { activeEntityWidget: Gtk.labelNew("x") } as unknown as ActiveEntity<unknown, unknown>;
    manager.bookManagerModelHandler([fake]);
    expect(readIORef(manager.bookManagerContents)).toEqual([fake]);
    expect(seen).toEqual([1]);
  });
});

describe("splitBook and mergeBook", () => {
  it("splitting the display notebook replaces it with a horizontal pane of two notebooks", () => {
    const { win, manager, book } = setup();
    const replaced: Gtk.Widget[] = [];
    const handler = (w: Gtk.Widget) => {
      replaced.push(w);
      manager.bookManagerDisplay.value = Just(w);
    };
    addPage(book, "A");
    splitBook(handler, book, manager);
    expect(replaced.length).toBe(1);
    const paned = replaced[0] as Gtk.Paned;
    expect(paned).toBeInstanceOf(Gtk.Paned);
    expect(paned.orientation).toBe(Gtk.OrientationHorizontal);
    expect(Gtk.widgetGetParent(paned)).toBe(win);
    expect(paned.child1).toBe(book);
    const books = allBooks(manager);
    expect(books.length).toBe(2);
    expect(books[0]).toBe(book);
    expect(tabNames(book)).toEqual(["A"]);
    expect(Gtk.notebookGetGroupName(books[1])).toBe(hadesGroup);
  });

  it("splitting a notebook inside a pane splits it the other way, and merging joins the tabs", () => {
    const { manager, book } = setup();
    const handler = (w: Gtk.Widget) => {
      manager.bookManagerDisplay.value = Just(w);
    };
    addPage(book, "A");
    splitBook(handler, book, manager);
    const [, right] = allBooks(manager);
    addPage(right, "B");
    addPage(right, "C");
    splitBook(handler, right, manager);
    const top = display(manager) as Gtk.Paned;
    const inner = top.child2 as Gtk.Paned;
    expect(inner).toBeInstanceOf(Gtk.Paned);
    expect(inner.orientation).toBe(Gtk.OrientationVertical);
    expect(inner.child1).toBe(right);
    expect(allBooks(manager).length).toBe(3);
    const third = allBooks(manager)[2];
    addPage(third, "D");
    // Merge the bottom notebook with its sibling: its tabs move into the top one.
    mergeBook(handler, third, manager);
    expect(top.child2).toBe(right);
    expect(allBooks(manager).length).toBe(2);
    expect(tabNames(right)).toEqual(["B", "C", "D"]);
    expect(right.pages.every((p) => p.detachable)).toBe(true);
    // Merging a direct child of the display replaces the display with the merged notebook.
    mergeBook(handler, right, manager);
    expect(display(manager)).toBe(book);
    expect(allBooks(manager)).toEqual([book]);
    expect(tabNames(book)).toEqual(["A", "B", "C", "D"]);
    // Merging the display itself does nothing.
    mergeBook(handler, book, manager);
    expect(display(manager)).toBe(book);
  });

  it("the Split and Merge buttons act on their own notebook", () => {
    const { manager, book } = setup();
    const buttons = (b: Gtk.Notebook) => (b.actionWidgets.end as Gtk.Box).children as Gtk.Button[];
    buttons(book)[0].emit("pressed");
    expect(allBooks(manager).length).toBe(2);
    const second = allBooks(manager)[1];
    buttons(second)[0].emit("pressed");
    expect(allBooks(manager).length).toBe(3);
    buttons(second)[1].emit("pressed");
    expect(allBooks(manager).length).toBe(2);
    buttons(book)[1].emit("pressed");
    expect(allBooks(manager).length).toBe(1);
  });

  it("switching to a page gives the focus to its diagram canvas", () => {
    const { manager, book } = setup();
    addPage(book, "A");
    const page2 = addPage(book, "B");
    const canvas = Gtk.drawingAreaNew();
    const entity = { activeEntityWidget: page2, activeEntityCanvas: canvas } as unknown as ActiveEntity<unknown, unknown>;
    manager.bookManagerModelHandler([entity]);
    // widgetGrabFocus focuses the rendered element of the canvas.
    const el = document.createElement("div");
    el.tabIndex = 0;
    document.body.appendChild(el);
    canvas.el = el;
    Gtk.notebookSetCurrentPage(book, 1);
    expect(document.activeElement).toBe(el);
  });
});
