// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { lens, type Lens } from "@/lib/Control/Lens";
import { readInt, showInt } from "@/lib/Prelude";
import { GadgetData, makeChanges, pure_Changes, type Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  Dialog, OkButton, accum, arr, boundedCombo, colourBox, focusing, form, gLoop, gPipe, gSecond, initially, optional,
  simpleTextBox, tickBox, typedTextBox, validate, type Gadget,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { createDialog, mkDialogWidget, renderGadget, runDialog, type GadgetOut } from "./ArrowDialog";

const theme = Gtk.iconThemeGetDefault();
const noInit = (_w: Gtk.Widget): void => {};

function collect<A>(e: B.Event<A>): A[] {
  const out: A[] = [];
  B.subscribeE(e, (a) => out.push(a));
  return out;
}

/** All widgets in a tree, depth first. */
function allWidgets(w: Gtk.Widget): Gtk.Widget[] {
  return [w, ...w.getChildren().flatMap(allWidgets)];
}
function find<W extends Gtk.Widget>(cls: abstract new (...args: any[]) => W, ws: readonly Gtk.Widget[]): W[] {
  return ws.flatMap(allWidgets).filter((x): x is W => x instanceof cls);
}

/** Render a gadget with a fixed environment and an input behavior fed back from its output. */
function render<I, O>(g: Gadget<null, never, I, O>, initial: I): [GadgetOut<never, O>, GadgetData<O>[]] {
  return B.liftMomentIO(() => {
    const out = renderGadget(
      theme, noInit, null, GadgetData(true, initial), pure_Changes(null), B.never(), B.pureB(GadgetData(true, initial)), g,
    );
    return [out, collect(out.gadgetUser)];
  });
}

describe("data entry gadgets", () => {
  test("text box reports edits", () => {
    const [out, seen] = render(simpleTextBox<null, never>(), "hello");
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(entry)).toBe("hello");
    entry.userSetText("hello world");
    expect(seen).toEqual([GadgetData(true, "hello world")]);
  });

  test("typed text box parses numbers and flags errors", () => {
    const [out, seen] = render(typedTextBox<null, never, number>(showInt, readInt), 7);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(entry)).toBe("7");
    Gtk.entrySetText(entry, "42");
    expect(seen).toEqual([GadgetData(true, 42)]);
    Gtk.entrySetText(entry, "4x2");
    expect(seen.length).toBe(1);
    expect(Gtk.styleContextHasClass(entry, "entry-error")).toBe(true);
    Gtk.entrySetText(entry, "5");
    expect(Gtk.styleContextHasClass(entry, "entry-error")).toBe(false);
    expect(seen[1]).toEqual(GadgetData(true, 5));
  });

  test("tick box follows the toggle button", () => {
    const [out, seen] = render(tickBox<null, never>(), false);
    const [check] = find(Gtk.CheckButton, out.gadgetView);
    expect(Gtk.toggleButtonGetActive(check)).toBe(false);
    Gtk.toggleButtonSetActive(check, true);
    expect(seen).toEqual([GadgetData(true, true)]);
  });

  test("enumeration combo box selects values", () => {
    type Size = "Small" | "Medium" | "Large";
    const sizes: readonly Size[] = ["Small", "Medium", "Large"];
    const [out, seen] = render(boundedCombo<null, never, Size>(sizes), "Medium");
    const [combo] = find(Gtk.ComboBox, out.gadgetView);
    expect(Gtk.comboBoxGetActive(combo)).toBe(1);
    Gtk.comboBoxSetActive(combo, 2);
    expect(seen).toEqual([GadgetData(true, "Large")]);
  });

  test("optional text box treats blank as Nothing", () => {
    const [out, seen] = render(optional<null, never, string, string>("", simpleTextBox()), Just("x"));
    const [entry] = find(Gtk.Entry, out.gadgetView);
    entry.userSetText("");
    entry.userSetText("y");
    expect(seen).toEqual([GadgetData(true, Nothing), GadgetData(true, Just("y"))]);
  });

  test("a general optional gadget is decorated with an enabling check button", () => {
    // Optional text boxes, tick boxes, combos ... are special cases; other gadgets get a check button.
    const g = optional<null, never, Person, Person>({ name: "", age: 0 }, personGadget());
    const [out, seen] = render(g, Nothing as Maybe<Person>);
    const [check] = find(Gtk.CheckButton, out.gadgetView);
    const [grid] = find(Gtk.Grid, out.gadgetView);
    const [nameEntry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.toggleButtonGetActive(check)).toBe(false);
    expect(grid.sensitive).toBe(false);
    Gtk.toggleButtonSetActive(check, true);
    expect(grid.sensitive).toBe(true);
    expect(seen).toEqual([GadgetData(true, Just({ name: "", age: 0 }))]);
    nameEntry.userSetText("Dee");
    expect(seen[1]).toEqual(GadgetData(true, Just({ name: "Dee", age: 0 })));
    Gtk.toggleButtonSetActive(check, false);
    expect(seen[2]).toEqual(GadgetData(true, Nothing));
  });

  test("colour box parses hex colours", () => {
    const [out, seen] = render(colourBox<null, never>(), C.sRGB24(255, 0, 0));
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(entry)).toBe("#ff0000");
    Gtk.entrySetText(entry, "#00ff00");
    expect(seen.length).toBe(1);
    expect(C.sRGB24show(seen[0]._gdValue)).toBe("#00ff00");
  });

  test("validate marks invalid output", () => {
    const g = validate((n: number) => n > 0, typedTextBox<null, never, number>(showInt, readInt));
    const [out, seen] = render(g, 1);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    Gtk.entrySetText(entry, "-1");
    expect(seen).toEqual([GadgetData(false, -1)]);
    expect(Gtk.styleContextHasClass(entry, "entry-error")).toBe(true);
  });
});

interface Person {
  readonly name: string;
  readonly age: number;
}
const nameL: Lens<Person, string> = lens((p: Person) => p.name, (p, name: string) => ({ ...p, name }));
const ageL: Lens<Person, number> = lens((p: Person) => p.age, (p, age: number) => ({ ...p, age }));
const personGadget = (): Gadget<null, never, Person, Person> =>
  accum(form("Vertical", [
    ["Name", focusing(nameL, simpleTextBox())],
    ["Age", focusing(ageL, typedTextBox(showInt, readInt))],
  ]));

describe("composite gadgets", () => {
  test("a form in an accum edits a record", () => {
    const [out, seen] = render(personGadget(), { name: "Ann", age: 30 });
    const [grid] = find(Gtk.Grid, out.gadgetView);
    expect(find(Gtk.Label, [grid]).map(Gtk.labelGetText)).toEqual(["Name", "Age"]);
    const [nameEntry, ageEntry] = find(Gtk.Entry, out.gadgetView);
    nameEntry.userSetText("Bob");
    expect(seen).toEqual([GadgetData(true, { name: "Bob", age: 30 })]);
    Gtk.entrySetText(ageEntry, "31");
    expect(seen[1]).toEqual(GadgetData(true, { name: "Ann", age: 31 }));
  });

  test("loop takes its initial state from the gadget it feeds (lazily)", () => {
    const g = gLoop<null, never, number, number, number>(
      gPipe(gSecond(initially<null, never, number>(10)), arr((p: [number, number]): [number, number] => [p[0] + p[1], p[1]])),
    );
    const [out] = render(g, 5);
    expect(out.gadgetInitial._gdValue).toBe(15);
    // As in Haskell, the validity flag of this loop depends on itself.
    expect(() => out.gadgetInitial._gdOk).toThrow(/loop/);
  });
});

describe("dialogs", () => {
  const dialog = Dialog<null, never, Person, Person>("Person", OkButton, personGadget());

  test("createDialog returns the edited value when OK is pressed", () => {
    const [result, d] = B.liftMomentIO(() => {
      const before = new Set(Gtk.toplevels.list());
      const r = collect(createDialog(Gtk.labelNew("parent"), theme, pure_Changes(null), [1, { name: "Ann", age: 30 }, dialog]));
      const dlg = Gtk.toplevels.list().find((w) => !before.has(w)) as Gtk.Dialog;
      return [r, dlg] as const;
    });
    expect(d).toBeInstanceOf(Gtk.Dialog);
    expect(d.title).toBe("Person");
    const [nameEntry] = find(Gtk.Entry, [d.contentArea]);
    nameEntry.userSetText("Cy");
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    expect(result).toEqual([[1, Just({ name: "Cy", age: 30 })]]);
    expect(d.destroyed).toBe(true);
  });

  test("createDialog returns Nothing on cancel", () => {
    const [result, d] = B.liftMomentIO(() => {
      const before = new Set(Gtk.toplevels.list());
      const r = collect(createDialog(Gtk.labelNew("parent"), theme, pure_Changes(null), ["k", { name: "Ann", age: 30 }, dialog]));
      return [r, Gtk.toplevels.list().find((w) => !before.has(w)) as Gtk.Dialog] as const;
    });
    Gtk.dialogResponse(d, Gtk.ResponseTypeCancel);
    expect(result).toEqual([["k", Nothing]]);
  });

  test("runDialog resolves with the edited value", async () => {
    const before = new Set(Gtk.toplevels.list());
    const p = runDialog(Gtk.labelNew("parent"), theme, dialog, null, { name: "Ann", age: 30 });
    const d = Gtk.toplevels.list().find((w) => !before.has(w)) as Gtk.Dialog;
    const ageEntry = find(Gtk.Entry, [d.contentArea])[1];
    Gtk.entrySetText(ageEntry, "40");
    const ok = d.actionArea.children.find((b) => b.data.get("response") === Gtk.ResponseTypeOk) as Gtk.Button;
    // The OK button is sensitive while the input is valid.
    expect(ok.sensitive).toBe(true);
    ok.click();
    expect(await p).toEqual(Just({ name: "Ann", age: 40 }));
  });

  test("mkDialogWidget shows the dialog for the current key", () => {
    const [frameW, edits, inputs] = B.liftMomentIO(() => {
      const [inputE, fire] = B.newEvent<readonly [string, B.Behavior<Person>]>();
      const envC: Changes<null> = makeChanges(null, B.never());
      const [w, out] = mkDialogWidget(
        theme, noInit, null, envC, B.pureB(constantDialog(dialog)), ["a", B.pureB({ name: "Ann", age: 30 })], inputE,
      );
      return [w, collect(out), fire] as const;
    });
    const frame = find(Gtk.Frame, [frameW])[0];
    expect(Gtk.frameGetLabel(frame)).toBe("Person");
    const [nameEntry] = find(Gtk.Entry, [frameW]);
    expect(Gtk.entryGetText(nameEntry)).toBe("Ann");
    nameEntry.userSetText("Al");
    expect(edits).toEqual([["a", { name: "Al", age: 30 }]]);
    inputs(["b", B.pureB({ name: "Bea", age: 20 })]);
    const [nameEntry2] = find(Gtk.Entry, [frameW]);
    expect(Gtk.entryGetText(nameEntry2)).toBe("Bea");
    nameEntry2.userSetText("Ben");
    expect(edits[1]).toEqual(["b", { name: "Ben", age: 20 }]);
  });
});
