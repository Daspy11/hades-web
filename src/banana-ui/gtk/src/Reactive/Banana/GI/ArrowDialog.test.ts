// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { lens, type Lens } from "@/lib/Control/Lens";
import { readInt, showInt } from "@/lib/Prelude";
import { GadgetData, makeChanges, pure_Changes, type Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import * as Gdk from "@/lib/GI/Gdk";
import {
  ClickableItem, ComboItem, Dialog, OkApplyButton, OkButton, PrismaticGadget, accum, arr, boundedCombo, box, buttonBar, buttonIO,
  colourBox, comboBox, cond, enabled, exec, focusing, form, frame, gFanout, gId, gLoop, gPipe, gSecond, getEnv, grid, icon,
  initially, intercept, linked, memoBox, message, optional, prismatic, prismaticOver, readOnlyText, scrolled, send, sendMap,
  simpleRadio, simpleTextBox, styled, tabForm, tickBox, traversing, traversingOver, treeSelector, typedTextBox, unionTab,
  validate, validateText, withEnv, type Gadget,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { CloseButton, constantDialog, type Dialog_ } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import * as S from "@/lib/Data/Set";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Node } from "@/lib/Data/Tree";
import { _Left, _Right, view } from "@/lib/Control/Lens";
import {
  createDialog, displayClickables, gdOk, gdValue, mkDialogWidget, mkGtkPopupSelect, renderGadget, runDialog, type GadgetOut,
} from "./ArrowDialog";

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

  test("loop takes its initial state from the gadget it feeds and threads it through events", () => {
    // The inner gadget's initial output does not depend on its input, so the loop is well defined.
    const f = ([i, s]: [number, number]): [number, number] => [i + s, s + 1];
    const g = gLoop<null, never, number, number, number>(
      gPipe(initially<null, never, [number, number]>([0, 1]), arr(f)),
    );
    const [e, fire] = B.liftMomentIO(() => B.newEvent<GadgetData<number>>());
    const [out, seen] = B.liftMomentIO(() => {
      const o = renderGadget(theme, noInit, null, GadgetData(true, 5), pure_Changes(null), e, B.stepper(GadgetData(true, 5), e), g);
      return [o, collect(o.gadgetUser)] as const;
    });
    expect(out.gadgetInitial).toEqual(GadgetData(true, 1)); // fst (f (0, 1))
    // The state starts as snd (f (0, 1)) = 2 and each event moves it on.
    fire(GadgetData(true, 10));
    fire(GadgetData(true, 10));
    expect(seen).toEqual([GadgetData(true, 12), GadgetData(true, 13)]);
  });

  test("a loop whose initial output depends on its own state is a <<loop>>, as in Haskell", () => {
    // GadgetData has strict fields in Haskell, so evaluating the initial input of this loop
    // evaluates the inner gadget's initial output, which is computed from that input.
    const g = gLoop<null, never, number, number, number>(
      gPipe(gSecond(initially<null, never, number>(10)), arr((p: [number, number]): [number, number] => [p[0] + p[1], p[1]])),
    );
    const [out] = render(g, 5);
    expect(() => out.gadgetInitial._gdValue).toThrow(/loop/);
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

/**
 * Render a gadget whose input behavior is fed back from its own user output, as `createDialog`
 * does. Returns the output and the user events seen.
 */
function renderFb<I, O>(g: Gadget<null, never, I, O>, initial: I): [GadgetOut<never, O>, GadgetData<O>[]] {
  return B.liftMomentIO(() => {
    const fbRef: B.Behavior<I> = B.lazyB(() => fb);
    const out = renderGadget(
      theme, noInit, null, GadgetData(true, initial), pure_Changes(null), B.never(), B.mapB((v: I) => GadgetData(true, v), fbRef), g,
    );
    const fb: B.Behavior<I> = B.stepper(initial, B.mapE((x: GadgetData<O>) => x._gdValue as unknown as I, out.gadgetUser));
    return [out, collect(out.gadgetUser)];
  });
}

describe("re-exports", () => {
  test("GadgetData and its lenses are re-exported, as in Haskell", () => {
    const g = GadgetData(false, 3);
    expect(view(gdOk(), g)).toBe(false);
    expect(view(gdValue(), g)).toBe(3);
  });
});

describe("forms", () => {
  test("a display gadget focused on an edited field writes its old value back (as in Haskell)", () => {
    // Each edit in a form is merged with the current value of every other gadget in it.
    const g = accum(form<null, never, Person>("Vertical", [
      ["Name", focusing(nameL, simpleTextBox())],
      ["Shown", focusing(nameL, readOnlyText((_e: null, n: string) => n))],
    ]));
    const [out, seen] = renderFb(g, { name: "Ann", age: 1 });
    const [nameEntry] = find(Gtk.Entry, out.gadgetView);
    nameEntry.userSetText("Bob");
    expect(seen[0]._gdValue.name).toBe("Ann");
  });

  test("a display gadget with a lens that ignores updates shows the edits", () => {
    const shownL: Lens<Person, string> = lens((p: Person) => p.name, (p: Person, _n: string) => p);
    const g = accum(form<null, never, Person>("Vertical", [
      ["Name", focusing(nameL, simpleTextBox())],
      ["Shown", focusing(shownL, readOnlyText((_e: null, n: string) => n.toUpperCase()))],
      ["Age", focusing(ageL, message((_e: null, n: number) => `Age ${n}`))],
    ]));
    const [out, seen] = renderFb(g, { name: "Ann", age: 1 });
    const [nameEntry, shown] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(shown)).toBe("ANN");
    nameEntry.userSetText("Bob");
    expect(seen[0]._gdValue).toEqual({ name: "Bob", age: 1 });
    expect(Gtk.entryGetText(shown)).toBe("BOB");
    expect(find(Gtk.Label, out.gadgetView).map(Gtk.labelGetText)).toContain("Age 1");
  });

  test("a tab form shows one page per gadget and merges their edits", () => {
    const g = accum(tabForm<null, never, Person>([
      ["One", focusing(nameL, simpleTextBox())],
      ["Two", focusing(ageL, typedTextBox(showInt, readInt))],
    ]));
    const [out, seen] = renderFb(g, { name: "Ann", age: 1 });
    const [book] = find(Gtk.Notebook, out.gadgetView);
    expect(Gtk.notebookGetCurrentPage(book)).toBe(0);
    expect(book.pages.length).toBe(2);
    const [nameEntry, ageEntry] = find(Gtk.Entry, out.gadgetView);
    nameEntry.userSetText("Cy");
    Gtk.entrySetText(ageEntry, "7");
    expect(seen.map((x) => x._gdValue)).toEqual([{ name: "Cy", age: 1 }, { name: "Cy", age: 7 }]);
  });
});

describe("sum types", () => {
  type Item = Either<number, string>;
  const numG = accum(form<null, never, number>("Vertical", [["Number:", focusing(lens((n: number) => n, (_n: number, v: number) => v), typedTextBox<null, never, number>(showInt, readInt))]]));
  const txtG = accum(form<null, never, string>("Vertical", [["Text:", focusing(lens((t: string) => t, (_t: string, v: string) => v), simpleTextBox())]]));

  test("unionTab opens the page for the input and emits the value of a page the user selects", () => {
    const g = unionTab<null, never, Item, Item>([
      ["Left", PrismaticGadget(0, _Left<number, string>(), numG)],
      ["Right", PrismaticGadget("", _Right<number, string>(), txtG)],
    ]);
    const [out, seen] = renderFb(g, Right("Foo!") as Item);
    const [book] = find(Gtk.Notebook, out.gadgetView);
    expect(Gtk.notebookGetCurrentPage(book)).toBe(1);
    expect(out.gadgetInitial._gdValue).toEqual(Right("Foo!"));
    const [numEntry, txtEntry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(numEntry)).toBe("0");
    expect(Gtk.entryGetText(txtEntry)).toBe("Foo!");
    txtEntry.userSetText("Bar");
    expect(seen[0]._gdValue).toEqual(Right("Bar"));
    book.switchTo(0); // A click on the "Left" tab.
    expect(seen[1]._gdValue).toEqual(Left(0));
    Gtk.entrySetText(numEntry, "42");
    expect(seen[2]._gdValue).toEqual(Left(42));
  });

  test("cond shows the gadget for the variant chosen in a combo box", () => {
    type Side = "L" | "R";
    const sideMenu = comboBox<null, never, Side>(() => [ComboItem("Number", Nothing, Nothing, "L" as Side), ComboItem("Text", Nothing, Nothing, "R" as Side)]);
    const items = cond<null, never, Item, Item>([
      PrismaticGadget(0, _Left<number, string>(), numG),
      PrismaticGadget("", _Right<number, string>(), txtG),
    ]);
    const makeSelection = (s: Side, x: Item): Item => (s === "L" && x.tag === "Right" ? Left(0) : s === "R" && x.tag === "Left" ? Right("") : x);
    // proc input -> do { s <- sideMenu -< side input; items -< makeSelection s input }
    const g = gPipe(
      gFanout(gPipe(arr<null, never, Item, Side>((x: Item): Side => (x.tag === "Left" ? "L" : "R")), sideMenu), gId<null, never, Item>()),
      arr<null, never, [Side, Item], Item>(([s, x]: [Side, Item]) => makeSelection(s, x)),
      items,
    );
    const [out, seen] = renderFb(g, Right("Foo!") as Item);
    const [combo] = find(Gtk.ComboBox, out.gadgetView);
    const visibleEntries = (): Gtk.Entry[] => find(Gtk.Entry, out.gadgetView).filter((e) => e.parent !== null && !e.destroyed);
    expect(visibleEntries().map(Gtk.entryGetText)).toEqual(["Foo!"]);
    Gtk.comboBoxSetActive(combo, 0);
    expect(seen[seen.length - 1]._gdValue).toEqual(Left(0));
    expect(visibleEntries().map(Gtk.entryGetText)).toEqual(["0"]);
  });

  test("exec rebuilds its gadget when the first input changes", () => {
    const g = exec<null, never, boolean, string, string>((upper: boolean) =>
      upper ? gPipe(simpleTextBox<null, never>(), arr((t: string) => t.toUpperCase())) : simpleTextBox<null, never>());
    const [e, fire] = B.liftMomentIO(() => B.newEvent<GadgetData<[boolean, string]>>());
    const [out, seen] = B.liftMomentIO(() => {
      const o = renderGadget(
        theme, noInit, null, GadgetData(true, [false, "abc"] as [boolean, string]), pure_Changes(null), e,
        B.stepper(GadgetData(true, [false, "abc"] as [boolean, string]), e), g,
      );
      return [o, collect(o.gadgetUser)] as const;
    });
    const [box] = out.gadgetView as Gtk.Box[];
    expect(find(Gtk.Entry, [box]).map(Gtk.entryGetText)).toEqual(["abc"]);
    fire(GadgetData(true, [true, "abc"]));
    // The new inner gadget reports its initial value.
    expect(seen[seen.length - 1]._gdValue).toBe("ABC");
    const [entry] = find(Gtk.Entry, [box]);
    entry.userSetText("xyz");
    expect(seen[seen.length - 1]._gdValue).toBe("XYZ");
  });
});

describe("decorations", () => {
  test("validateText shows and hides its message", () => {
    const g = validateText((n: number) => (n < 0 ? Just("negative") : Nothing), typedTextBox<null, never, number>(showInt, readInt));
    const [out, seen] = render(g, 1);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    const msg = find(Gtk.Label, out.gadgetView)[0];
    expect(msg.visible).toBe(false);
    Gtk.entrySetText(entry, "-3");
    expect(seen[0]).toEqual(GadgetData(false, -3));
    expect(msg.visible).toBe(true);
    expect(Gtk.labelGetText(msg)).toBe("negative");
    expect(Gtk.styleContextHasClass(msg, "entry-error")).toBe(true);
    Gtk.entrySetText(entry, "3");
    expect(msg.visible).toBe(false);
    expect(seen[1]).toEqual(GadgetData(true, 3));
  });

  test("frame, icon, linked and styled follow the input", () => {
    const [e, fire] = B.liftMomentIO(() => B.newEvent<GadgetData<string>>());
    const g = frame((t: string) => Just("Frame " + t), icon((t: string) => "icon-" + t, linked(
      (t: string) => (t === "" ? Nothing : Just("https://x/" + t)),
      styled((t: string) => Just("style-" + t), simpleTextBox<null, never>()),
    )));
    const out = B.liftMomentIO(() =>
      renderGadget(theme, noInit, null, GadgetData(true, "a"), pure_Changes(null), e, B.stepper(GadgetData(true, "a"), e), g));
    const [fr] = find(Gtk.Frame, out.gadgetView);
    const [img] = find(Gtk.Image, out.gadgetView).filter((i) => i.iconName !== "emblem-symbolic-link");
    const [link] = find(Gtk.LinkButton, out.gadgetView);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.frameGetLabel(fr)).toBe("Frame a");
    expect(Gtk.linkButtonGetUri(link)).toBe("https://x/a");
    expect(Gtk.styleContextHasClass(entry, "style-a")).toBe(true);
    fire(GadgetData(true, ""));
    expect(Gtk.frameGetLabel(fr)).toBe("Frame ");
    expect(img.iconName).toBe("icon-");
    expect(link.sensitive).toBe(false);
    expect(Gtk.styleContextHasClass(entry, "style-a")).toBe(false);
    expect(Gtk.styleContextHasClass(entry, "style-")).toBe(true);
  });

  test("enabled sets the sensitivity of the inner widgets", () => {
    const [e, fire] = B.liftMomentIO(() => B.newEvent<GadgetData<[string, boolean]>>());
    const out = B.liftMomentIO(() => renderGadget(
      theme, noInit, null, GadgetData(true, ["x", false] as [string, boolean]), pure_Changes(null), e,
      B.stepper(GadgetData(true, ["x", false] as [string, boolean]), e), enabled(simpleTextBox<null, never>()),
    ));
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(entry.sensitive).toBe(false);
    fire(GadgetData(true, ["x", true]));
    expect(entry.sensitive).toBe(true);
  });
});

describe("other gadgets", () => {
  test("optional combo boxes and tick boxes get a blank item for Nothing", () => {
    const [out, seen] = render(optional<null, never, Size, Size>("Small", boundedCombo<null, never, Size>(["Small", "Large"])), Nothing as Maybe<Size>);
    const [combo] = find(Gtk.ComboBox, out.gadgetView);
    expect(Gtk.comboBoxGetActive(combo)).toBe(0);
    Gtk.comboBoxSetActive(combo, 2);
    expect(seen).toEqual([GadgetData(true, Just("Large"))]);
    const [out2, seen2] = render(optional<null, never, boolean, boolean>(false, tickBox()), Just(true));
    const [combo2] = find(Gtk.ComboBox, out2.gadgetView);
    expect(Gtk.comboBoxGetActive(combo2)).toBe(1);
    Gtk.comboBoxSetActive(combo2, 0);
    expect(seen2).toEqual([GadgetData(true, Nothing)]);
  });

  test("a memo box reports user edits", () => {
    const [out, seen] = render(memoBox<null, never>("MemoMedium", false), "one");
    const [tv] = find(Gtk.TextView, out.gadgetView);
    expect(Gtk.styleContextHasClass(out.gadgetView[0], "memo-medium")).toBe(true);
    Gtk.textViewGetBuffer(tv).setTextInternal("one\ntwo", true);
    expect(seen).toEqual([GadgetData(true, "one\ntwo")]);
  });

  test("the tree selector selects the input values and reports user selections", () => {
    type It = readonly [string, Maybe<string>, Maybe<number>];
    const it = (n: string, v: Maybe<number>): It => [n, Nothing, v];
    const g = treeSelector<null, never, number>(() => [
      Node(it("Group", Nothing), [Node(it("One", Just(1)), []), Node(it("Two", Just(2)), [])]),
      Node(it("Empty", Nothing), []),
      Node(it("Three", Just(3)), []),
    ]);
    const [out, seen] = render(g, S.fromList([2]));
    const [tv] = find(Gtk.TreeView, out.gadgetView);
    const sel = Gtk.treeViewGetSelection(tv);
    const paths = (): number[][] => Gtk.treeSelectionGetSelectedRows(sel)[0].map((p) => Gtk.treePathGetIndices(p) ?? []);
    expect(paths()).toEqual([[0, 1]]);
    // "Empty" has no selectable children, so it is trimmed: "Three" is the second root.
    Gtk.treeSelectionSelectPath(sel, Gtk.treePathNewFromIndices([1]));
    expect(S.toList(seen[seen.length - 1]._gdValue)).toEqual([2, 3]);
    // Branches without a value cannot be selected.
    Gtk.treeSelectionSelectPath(sel, Gtk.treePathNewFromIndices([0]));
    expect(paths()).toEqual([[0, 1], [1]]);
  });

  test("clickable items map UTF-8 byte indices to items", () => {
    const label = Gtk.labelNew(null);
    const items = [ClickableItem("été", Just(1), Nothing, Nothing), ClickableItem("b", Just(2), Nothing, Nothing)];
    const f = displayClickables(label, GadgetData(true, items));
    expect(Gtk.labelGetText(label)).toBe("été, b");
    // "été" is 5 bytes: indices 0..5; ", " follows; "b" is at byte 7.
    const at = (i: number) => {
      const m = f(i);
      return m.tag === "Just" ? m.value : null;
    };
    expect(at(0)?.gclickRange).toEqual([0, 5]);
    expect(at(5)?.gclickBase.clickText).toBe("été");
    expect(at(7)?.gclickBase.clickText).toBe("b");
    expect(f(6)).toEqual(Nothing);
    expect(displayClickables(label, GadgetData(false, items))(0)).toEqual(Nothing);
  });

  test("a button bar in an accum applies the button functions", () => {
    const [out, seen] = renderFb(accum(gPipe(typedTextBox<null, never, number>(showInt, readInt), buttonBar<null, never, number>([
      ["+5", (n) => n + 5],
      ["Reset", () => 0],
    ]))), 1);
    const [plus5, reset] = find(Gtk.Button, out.gadgetView).filter((b) => b.label === "+5" || b.label === "Reset");
    plus5.click();
    plus5.click();
    expect(seen.map((x) => x._gdValue)).toEqual([6, 11]);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(entry)).toBe("11");
    reset.click();
    expect(seen[2]._gdValue).toBe(0);
  });

  test("an IO button fires its result when the action completes", async () => {
    const [out, seen] = render(buttonIO<null, never, number, number>("Go", async (_e: null, n: number) => n * 2), 21);
    const [btn] = find(Gtk.Button, out.gadgetView);
    btn.click();
    expect(seen).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([GadgetData(true, Just(42))]);
  });
});

describe("popups", () => {
  test("mkGtkPopupSelect opens nothing when the selector returns Nothing", () => {
    const opened = B.liftMomentIO(() => {
      const before = Gtk.toplevels.list().length;
      const [e, fire] = B.newEvent<readonly [number, number]>();
      const r = collect(mkGtkPopupSelect(Gtk.labelNew("p"), theme, pure_Changes(null), () => Nothing, e));
      fire([1, 2]);
      return [Gtk.toplevels.list().length - before, r] as const;
    });
    expect(opened[0]).toBe(0);
    expect(opened[1]).toEqual([]);
  });

  test("Apply reports the value and keeps the dialog open", () => {
    const dialog = Dialog<null, never, Person, Person>("P", OkApplyButton, personGadget());
    const [result, d] = B.liftMomentIO(() => {
      const before = new Set(Gtk.toplevels.list());
      const r = collect(createDialog(Gtk.labelNew("parent"), theme, pure_Changes(null), [1, { name: "Ann", age: 30 }, dialog]));
      return [r, Gtk.toplevels.list().find((w) => !before.has(w) && w instanceof Gtk.Dialog) as Gtk.Dialog] as const;
    });
    const labels = d.actionArea.children.map((b) => (b as Gtk.Button).label);
    expect(labels).toEqual(["_Cancel", "_Ok", "_Apply"]);
    const [nameEntry, ageEntry] = find(Gtk.Entry, [d.contentArea]);
    nameEntry.userSetText("Di");
    Gtk.dialogResponse(d, Gtk.ResponseTypeApply);
    expect(result).toEqual([[1, Just({ name: "Di", age: 30 })]]);
    expect(d.destroyed).toBe(false);
    // An invalid entry disables OK and Apply.
    Gtk.entrySetText(ageEntry, "x");
    const ok = d.actionArea.children[1];
    expect(ok.sensitive).toBe(true); // The text box does not emit invalid text.
    Gtk.dialogResponse(d, Gtk.ResponseTypeDeleteEvent);
    expect(result[1]).toEqual([1, Nothing]);
    expect(d.destroyed).toBe(true);
  });
});

type Size = "Small" | "Large";

/** Render with an input event that the test fires, and the input behavior stepped from it. */
function renderE<I, O>(g: Gadget<null, any, I, O>, initial: I): [GadgetOut<any, O>, GadgetData<O>[], (v: GadgetData<I>) => void] {
  const [e, fire] = B.liftMomentIO(() => B.newEvent<GadgetData<I>>());
  const [out, seen] = B.liftMomentIO(() => {
    const o = renderGadget(theme, noInit, null, GadgetData(true, initial), pure_Changes(null), e, B.stepper(GadgetData(true, initial), e), g);
    return [o, collect(o.gadgetUser)] as const;
  });
  return [out, seen, fire];
}

const buttonPress = (type: Gdk.EventType, button = 1): Gdk.EventButton =>
  ({ type, button, x: 0, y: 0, xRoot: 0, yRoot: 0, state: [], time: 0 });

describe("environment and side channel", () => {
  test("withEnv sets the environment from a gadget output, and getEnv reads it", () => {
    const g = withEnv(arr<null, never, string, number>((t: string) => t.length), getEnv<number, never, string>());
    const [out, seen, fire] = renderE(g, "abc");
    expect(out.gadgetInitial).toEqual(GadgetData(true, 3));
    // Environment changes are nothing to do with the user.
    fire(GadgetData(true, "hello"));
    expect(seen).toEqual([]);
    expect(B.liftMomentIO(() => B.valueB(out.gadgetValue))).toEqual(GadgetData(true, 5));
    // Invalid environment updates are filtered out (cleanOutput).
    fire(GadgetData(false, "no"));
    expect(B.liftMomentIO(() => B.valueB(out.gadgetValue))).toEqual(GadgetData(true, 5));
  });

  test("send puts valid user values on the side channel and sendMap filters them", () => {
    const g = sendMap(
      (w: number) => (w > 0 ? Just(w * 10) : Nothing),
      gPipe(typedTextBox<null, number, number>(showInt, readInt), send<null, number, number>((n: number) => Just(n))),
    );
    const [out, seen] = render(g as Gadget<null, never, number, number>, 1);
    const sent = B.liftMomentIO(() => collect(out.gadgetEvents as unknown as B.Event<readonly number[]>));
    const [entry] = find(Gtk.Entry, out.gadgetView);
    Gtk.entrySetText(entry, "3");
    Gtk.entrySetText(entry, "-2"); // Sent as [-2], mapped to [], so nothing is sent.
    Gtk.entrySetText(entry, "4");
    expect(sent).toEqual([[30], [40]]);
    expect(seen.map((x) => x._gdValue)).toEqual([3, -2, 4]);
  });
});

describe("optics", () => {
  type Item = Either<number, string>;
  const numBox = (): Gadget<null, never, number, number> => typedTextBox<null, never, number>(showInt, readInt);
  const idL = <A>(): Lens<A, A> => lens((a: A) => a, (_a: A, v: A) => v);

  test("prismatic edits a variant, using the default for other variants", () => {
    const [out, seen] = render(prismatic(0, _Left<number, string>(), numBox()), Right("x") as Item);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    expect(Gtk.entryGetText(entry)).toBe("0");
    expect(out.gadgetInitial._gdValue).toEqual(Left(0));
    Gtk.entrySetText(entry, "5");
    expect(seen).toEqual([GadgetData(true, Left(5))]);
  });

  test("prismaticOver always rebuilds the variant from the prism", () => {
    const [out, seen] = renderFb(accum(prismaticOver(0, _Left<number, string>(), focusing(idL<number>(), numBox()))), Right("x") as Item);
    const [entry] = find(Gtk.Entry, out.gadgetView);
    Gtk.entrySetText(entry, "7");
    expect(seen[0]._gdValue).toEqual(Left(7));
  });

  test("traversing sets the target and leaves non-matching values alone", () => {
    const [out1, seen1] = renderFb(accum(traversing(0, _Left<number, string>(), numBox())), Left(1) as Item);
    Gtk.entrySetText(find(Gtk.Entry, out1.gadgetView)[0], "7");
    expect(seen1[0]._gdValue).toEqual(Left(7));
    const [out2, seen2] = renderFb(accum(traversing(0, _Left<number, string>(), numBox())), Right("a") as Item);
    const [entry2] = find(Gtk.Entry, out2.gadgetView);
    expect(Gtk.entryGetText(entry2)).toBe("0");
    Gtk.entrySetText(entry2, "7");
    expect(seen2[0]._gdValue).toEqual(Right("a"));
  });

  test("traversingOver applies the inner function through the traversal", () => {
    const g = accum(traversingOver(0, _Left<number, string>(), focusing(idL<number>(), numBox())));
    const [out1, seen1] = renderFb(g, Left(1) as Item);
    Gtk.entrySetText(find(Gtk.Entry, out1.gadgetView)[0], "8");
    expect(seen1[0]._gdValue).toEqual(Left(8));
    const [out2, seen2] = renderFb(g, Right("b") as Item);
    Gtk.entrySetText(find(Gtk.Entry, out2.gadgetView)[0], "8");
    expect(seen2[0]._gdValue).toEqual(Right("b"));
  });
});

describe("layout gadgets", () => {
  const nameG = focusing(nameL, simpleTextBox<null, never>());
  const ageG = focusing(ageL, typedTextBox<null, never, number>(showInt, readInt));

  test("a box separates its groups and merges their outputs", () => {
    const shown = focusing(lens((p: Person) => p.name, (p: Person, _n: string) => p), readOnlyText<null, never, string>((_e, n) => n));
    const [out, seen] = renderFb(accum(box<null, never, Person>("Vertical", [[nameG, shown], [], [ageG]])), { name: "A", age: 1 });
    const [bx] = out.gadgetView as Gtk.Box[];
    expect(bx).toBeInstanceOf(Gtk.Box);
    // The empty group is dropped, so there is one separator.
    expect(bx.getChildren().map((c) => c.constructor.name)).toEqual(["Entry", "Entry", "Separator", "Entry"]);
    const [n1, s1, a1] = find(Gtk.Entry, out.gadgetView);
    Gtk.entrySetText(a1, "9");
    expect(seen[0]._gdValue).toEqual({ name: "A", age: 9 });
    n1.userSetText("B");
    expect(seen[1]._gdValue).toEqual({ name: "B", age: 9 });
    expect(Gtk.entryGetText(s1)).toBe("B");
  });

  test("two editors of the same field in a box: the later one writes its old value back (as in Haskell)", () => {
    const [out, seen] = renderFb(accum(box<null, never, Person>("Vertical", [[nameG], [nameG]])), { name: "A", age: 1 });
    const [n1] = find(Gtk.Entry, out.gadgetView);
    n1.userSetText("B");
    expect(seen[0]._gdValue).toEqual({ name: "A", age: 1 });
  });

  test("a grid puts the headers in the first row and column", () => {
    const [out, seen] = renderFb(accum(grid<null, never, Person>(["C1", "C2"], ["R1"], [[nameG, ageG]])), { name: "A", age: 1 });
    const [gr] = out.gadgetView as Gtk.Grid[];
    const at = (l: number, t: number): Gtk.Widget | null => Gtk.gridGetChildAt(gr, l, t);
    expect(Gtk.labelGetText(at(1, 0) as Gtk.Label)).toBe("C1");
    expect(Gtk.labelGetText(at(2, 0) as Gtk.Label)).toBe("C2");
    expect(Gtk.labelGetText(at(0, 1) as Gtk.Label)).toBe("R1");
    expect(at(1, 1)).toBeInstanceOf(Gtk.Entry);
    expect(at(2, 1)).toBeInstanceOf(Gtk.Entry);
    Gtk.entrySetText(at(2, 1) as Gtk.Entry, "4");
    expect(seen[0]._gdValue).toEqual({ name: "A", age: 4 });
  });

  test("scrolled wraps the widgets in a scrolled window", () => {
    const [out] = render(scrolled(form<null, never, Person>("Vertical", [["Name", nameG]])), { name: "A", age: 1 });
    const [sw] = out.gadgetView;
    expect(sw).toBeInstanceOf(Gtk.ScrolledWindow);
    expect(Gtk.binGetChild(sw as Gtk.ScrolledWindow)).toBeInstanceOf(Gtk.Grid);
  });

  test("radio buttons show and report the selected value", () => {
    const [out, seen, fire] = renderE(simpleRadio<null, never, string>(["A", "B", "C"]), "B");
    const btns = find(Gtk.RadioButton, out.gadgetView);
    expect(btns.map(Gtk.toggleButtonGetActive)).toEqual([false, true, false]);
    btns[2].click();
    expect(seen).toEqual([GadgetData(true, "C")]);
    fire(GadgetData(true, "A"));
    expect(btns.map(Gtk.toggleButtonGetActive)).toEqual([true, false, false]);
  });

  test("exec flags the inner output invalid when its input is invalid", () => {
    const g = exec<null, never, boolean, string, string>(() => simpleTextBox<null, never>());
    const [out, seen, fire] = renderE(g, [false, "abc"] as [boolean, string]);
    fire(GadgetData(false, [true, "abc"]));
    // A new inner gadget reports its initial value, qualified by the validity of the input.
    expect(seen).toEqual([GadgetData(false, "abc")]);
    expect(out.gadgetInitial).toEqual(GadgetData(true, "abc"));
  });
});

describe("intercept and dialog buttons", () => {
  const partDialog = Dialog<null, never, Person, Person>("Person", OkButton, personGadget());

  test("intercept pops up a dialog on a double click and feeds its result in", () => {
    const g = intercept<null, never, Person>(true, constantDialog(partDialog), readOnlyText((_e: null, p: Person) => p.name));
    const [out] = renderFb(g, { name: "Ann", age: 30 });
    const [entry] = find(Gtk.Entry, out.gadgetView);
    const before = new Set(Gtk.toplevels.list());
    // A single click is passed on; it does not open the dialog.
    expect(entry.emit("button-press-event", buttonPress(Gdk.EventTypeButtonPress))).toBe(false);
    expect(Gtk.toplevels.list().filter((w) => !before.has(w))).toEqual([]);
    expect(entry.emit("button-press-event", buttonPress(Gdk.EventType2buttonPress))).toBe(true);
    const d = Gtk.toplevels.list().find((w) => !before.has(w) && w instanceof Gtk.Dialog) as Gtk.Dialog;
    expect(d.title).toBe("Person");
    find(Gtk.Entry, [d.contentArea])[0].userSetText("Zed");
    Gtk.dialogResponse(d, Gtk.ResponseTypeOk);
    expect(Gtk.entryGetText(entry)).toBe("Zed");
  });

  test("a close button dialog returns the value when closed", () => {
    const dialog = Dialog<null, never, Person, Person>("Info", CloseButton("_Done"), personGadget());
    const [result, d] = B.liftMomentIO(() => {
      const before = new Set(Gtk.toplevels.list());
      const r = collect(createDialog(Gtk.labelNew("parent"), theme, pure_Changes(null), [0, { name: "Ann", age: 30 }, dialog]));
      return [r, Gtk.toplevels.list().find((w) => !before.has(w) && w instanceof Gtk.Dialog) as Gtk.Dialog] as const;
    });
    expect(d.actionArea.children.map((b) => (b as Gtk.Button).label)).toEqual(["_Done"]);
    find(Gtk.Entry, [d.contentArea])[0].userSetText("Bo");
    Gtk.dialogResponse(d, Gtk.ResponseTypeClose);
    expect(result).toEqual([[0, Just({ name: "Bo", age: 30 })]]);
    expect(d.destroyed).toBe(true);
  });

  test("mkDialogWidget clears the frame when the selector has no dialog for the value", () => {
    const sel = (_e: null, p: Person): Maybe<Dialog_<null, never, Person>> => (p.name === "" ? Nothing : Just(partDialog));
    const [frameW, edits, inputs] = B.liftMomentIO(() => {
      const [inputE, fire] = B.newEvent<readonly [string, B.Behavior<Person>]>();
      const [w, out] = mkDialogWidget(
        theme, noInit, null, pure_Changes(null), B.pureB(sel), ["a", B.pureB({ name: "", age: 1 })], inputE,
      );
      return [w, collect(out), fire] as const;
    });
    const frm = find(Gtk.Frame, [frameW])[0];
    expect(Gtk.frameGetLabel(frm)).toBe(null);
    expect(Gtk.binGetChild(frm)).toBe(null);
    inputs(["b", B.pureB({ name: "Bea", age: 2 })]);
    expect(Gtk.frameGetLabel(frm)).toBe("Person");
    const [nameEntry] = find(Gtk.Entry, [frameW]);
    nameEntry.userSetText("Ben");
    expect(edits).toEqual([["b", { name: "Ben", age: 2 }]]);
    inputs(["c", B.pureB({ name: "", age: 3 })]);
    expect(Gtk.binGetChild(frm)).toBe(null);
    expect(nameEntry.destroyed).toBe(true);
  });
});
