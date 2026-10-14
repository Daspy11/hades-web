// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { getCurrentTime, utctDay } from "@/lib/Data/Time";
import { pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Dialog_ } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { createDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import {
  def_DemoData, demoDialog, initialValue, show_DemoData, testValues, validRange, type DemoData,
} from "./Dialog";
import { testTable } from "./Table";

const theme = Gtk.iconThemeGetDefault();

function allWidgets(w: Gtk.Widget): Gtk.Widget[] {
  return [w, ...w.getChildren().flatMap(allWidgets)];
}
function find<W extends Gtk.Widget>(cls: abstract new (...args: any[]) => W, w: Gtk.Widget): W[] {
  return allWidgets(w).filter((x): x is W => x instanceof cls);
}

/** Open a dialog as `mkGtkPopupSelect` does and collect its results. */
function open<A>(dialog: Dialog_<null, null, A>, initial: A): [[number, Maybe<A>][], Gtk.Dialog] {
  return B.liftMomentIO(() => {
    const before = new Set(Gtk.toplevels.list());
    const out: [number, Maybe<A>][] = [];
    B.subscribeE(createDialog(Gtk.labelNew("parent"), theme, pure_Changes(null), [1, initial, dialog]), (r) => out.push(r));
    const d = Gtk.toplevels.list().find((w) => !before.has(w) && w instanceof Gtk.Dialog) as Gtk.Dialog;
    return [out, d];
  });
}

function okButton(d: Gtk.Dialog): Gtk.Widget {
  return d.actionArea.children.find((b) => b.data.get("response") === Gtk.ResponseTypeOk)!;
}

describe("Demo.Dialog", () => {
  test("validRange", () => {
    expect(validRange([Just(3), Just(2)])).toEqual(Just("Invalid range"));
    expect(validRange([Just(2), Just(2)])).toEqual(Nothing);
    expect(validRange([Just(2), Just(3)])).toEqual(Nothing);
    expect(validRange([Nothing, Just(2)])).toEqual(Nothing);
    expect(validRange([Just(2), Nothing])).toEqual(Nothing);
  });

  test("show_DemoData is the derived Show", () => {
    expect(show_DemoData({ ...testValues[0], _demoRange: [Just(-2), Just(6)] })).toBe(
      'DemoData {_demoRange = (Just (-2),Just 6), _demoEnum = Foo, _demoTextRange = Just ("","ZZZ"), ' +
      '_demoDate = 2000-01-01, _demoTable = [], _demoComment = "The Foo Value."}',
    );
    expect(show_DemoData(initialValue)).toMatch(/^DemoData \{_demoRange = \(Nothing,Just 5\), _demoEnum = Wibble, .*_demoTable = \[TableData \{.*\},TableData \{.*\},TableData \{.*\}\], _demoComment = "This is the default."\}$/);
    expect(show_DemoData({ ...initialValue, _demoTextRange: Nothing })).toContain("_demoTextRange = Nothing,");
  });

  test("def_DemoData is computed once, with today's date", () => {
    const d = def_DemoData();
    expect(d).toEqual({
      _demoRange: [Nothing, Nothing], _demoEnum: "Foo", _demoTextRange: Just(["", ""]),
      _demoDate: utctDay(getCurrentTime()), _demoTable: [], _demoComment: "",
    });
    expect(def_DemoData()).toBe(d);
  });

  test("OK returns the value; enumeration, date and memo edits", () => {
    const [out, d] = open(demoDialog, initialValue);
    expect(d.title).toBe("Demo Dialog");
    const [combo] = find(Gtk.ComboBox, d.contentArea);
    expect(Gtk.comboBoxGetActive(combo)).toBe(3);
    Gtk.comboBoxSetActive(combo, 2);
    const entries = find(Gtk.Entry, d.contentArea);
    expect(entries.map(Gtk.entryGetText)).toEqual(["", "5", "", "12 March 2018", "alpha", "Omega"]);
    entries[3].userSetText("1 January 2020");
    const [memo] = find(Gtk.TextView, d.contentArea);
    Gtk.textViewGetBuffer(memo).setTextInternal("New comment", true); // As typed by the user.
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    expect(out).toEqual([[1, Just({ ...initialValue, _demoEnum: "Baz", _demoDate: "2020-01-01", _demoComment: "New comment" })]]);
    expect(out[0][1].tag === "Just" && out[0][1].value._demoTable).toEqual(testTable);
  });

  test("the optional text range is validated and can be switched off", () => {
    const [out, d] = open(demoDialog, initialValue);
    const entries = find(Gtk.Entry, d.contentArea);
    entries[4].userSetText("zeta");
    const message = find(Gtk.Label, d.contentArea).find((l) => Gtk.labelGetText(l) === "Invalid text range.");
    expect(message && Gtk.widgetGetVisible(message)).toBe(true);
    expect(okButton(d).sensitive).toBe(false);
    entries[4].userSetText("beta");
    expect(okButton(d).sensitive).toBe(true);
    Gtk.dialogResponse(d, Gtk.ResponseTypeApply);
    const [check] = find(Gtk.CheckButton, d.contentArea);
    Gtk.toggleButtonSetActive(check, false);
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    const ranges = out.map(([, v]) => (v.tag === "Just" ? v.value._demoTextRange : null));
    expect(ranges).toEqual([Just(["beta", "Omega"]), Nothing]);
  });

  test("the range bounds cannot be edited (the original's focusing id display)", () => {
    // "Range size:" is `focusing id $ readOnlyText ...` in a form, so its unchanged value is merged
    // into every edit of the bounds (see mRangeGadget). The GTK program behaves the same way.
    const [out, d] = open<DemoData>(demoDialog, testValues[0]);
    const entries = find(Gtk.Entry, d.contentArea);
    expect(entries.slice(0, 3).map(Gtk.entryGetText)).toEqual(["2", "6", "4"]);
    entries[0].userSetText("3");
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    expect(out[0][1].tag === "Just" && out[0][1].value._demoRange).toEqual([Just(2), Just(6)]);
  });
});
