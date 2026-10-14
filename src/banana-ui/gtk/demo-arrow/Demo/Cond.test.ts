// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Just, type Maybe } from "@/lib/Data/Maybe";
import { pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Dialog_ } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { createDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { condDialog, makeSelection, show_Side, sideValues } from "./Cond";
import { notebookDialog } from "./Notebook";

const theme = Gtk.iconThemeGetDefault();

function allWidgets(w: Gtk.Widget): Gtk.Widget[] {
  return [w, ...w.getChildren().flatMap(allWidgets)];
}
function find<W extends Gtk.Widget>(cls: abstract new (...args: any[]) => W, w: Gtk.Widget): W[] {
  return allWidgets(w).filter((x): x is W => x instanceof cls);
}
/** The entries currently shown (a `cond` destroys the widgets of the variant it leaves). */
function liveEntries(w: Gtk.Widget): Gtk.Entry[] {
  return find(Gtk.Entry, w).filter((e) => !e.destroyed);
}

function open<A>(dialog: Dialog_<null, null, A>, initial: A): [[number, Maybe<A>][], Gtk.Dialog] {
  return B.liftMomentIO(() => {
    const before = new Set(Gtk.toplevels.list());
    const out: [number, Maybe<A>][] = [];
    B.subscribeE(createDialog(Gtk.labelNew("parent"), theme, pure_Changes(null), [1, initial, dialog]), (r) => out.push(r));
    const d = Gtk.toplevels.list().find((w) => !before.has(w) && w instanceof Gtk.Dialog) as Gtk.Dialog;
    return [out, d];
  });
}

type Item = Either<number, string>;

describe("Demo.Cond", () => {
  test("makeSelection", () => {
    expect(makeSelection(0, "", "LeftSide", Right("x"))).toEqual(Left(0));
    expect(makeSelection(0, "", "RightSide", Left(3))).toEqual(Right(""));
    expect(makeSelection(0, "", "LeftSide", Left(3))).toEqual(Left(3));
    expect(makeSelection(0, "", "RightSide", Right("x"))).toEqual(Right("x"));
    expect(sideValues.map(show_Side)).toEqual(["LeftSide", "RightSide"]);
  });

  test("the combo box chooses the side being edited", () => {
    const [out, d] = open<Item>(condDialog, Right("Foo!"));
    expect(d.title).toBe("Conditional Test");
    const [combo] = find(Gtk.ComboBox, d.contentArea);
    expect(Gtk.comboBoxGetActive(combo)).toBe(1);
    expect(liveEntries(d.contentArea).map(Gtk.entryGetText)).toEqual(["Foo!"]);
    liveEntries(d.contentArea)[0].userSetText("Bar");
    Gtk.dialogResponse(d, Gtk.ResponseTypeApply);
    Gtk.comboBoxSetActive(combo, 0);
    expect(liveEntries(d.contentArea).map(Gtk.entryGetText)).toEqual(["0"]);
    Gtk.dialogResponse(d, Gtk.ResponseTypeApply);
    liveEntries(d.contentArea)[0].userSetText("-7");
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    expect(out).toEqual([[1, Just(Right("Bar"))], [1, Just(Left(0))], [1, Just(Left(-7))]]);
  });
});

describe("Demo.Notebook", () => {
  test("each side of the Either has its own tab", () => {
    const [out, d] = open<Item>(notebookDialog, Right("Foo!"));
    expect(d.title).toBe("Notebook Test");
    const [book] = find(Gtk.Notebook, d.contentArea);
    expect(Gtk.notebookGetCurrentPage(book)).toBe(1);
    const [numEntry, txtEntry] = find(Gtk.Entry, d.contentArea);
    expect([numEntry, txtEntry].map(Gtk.entryGetText)).toEqual(["0", "Foo!"]);
    book.switchTo(0); // A click on the "Left" tab.
    Gtk.dialogResponse(d, Gtk.ResponseTypeApply);
    numEntry.userSetText("42");
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    expect(out).toEqual([[1, Just(Left(0))], [1, Just(Left(42))]]);
  });
});
