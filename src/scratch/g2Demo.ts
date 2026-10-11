/**
 * Scratch demo for the GTK interpreter of gadget dialogs (`Reactive.Banana.GI.ArrowDialog`):
 * open with `?demo=g2`. A window with a button opens a dialog containing a broad range of
 * gadgets; the result of the dialog is shown in the window. A second, embedded copy of a gadget
 * is shown with `mkDialogWidget`.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import { lens, type Lens } from "@/lib/Control/Lens";
import { readInt, showInt } from "@/lib/Prelude";
import type { Day } from "@/lib/Data/Time";
import { longDate, pure_Changes, type Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  ClickableItem, Dialog, OkApplyButton, accum, arr, boundedCombo, clickableList, colourBox, coloured, dateBox, displayText,
  focusing, form, frame, gPipe, icon, iconBox, linked, memoBox, message, optional, readOnlyText, simpleFrame,
  simpleRadio, simpleTextBox, tabForm, table, tickBox, treeSelector, typedTextBox, validateText, buttonBar,
  type Gadget, type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { EditBool, EditEntry, EditNote, TableAdd, TableDelete, mkField } from "@/banana-ui/base/Reactive/Banana/Table";
import { textPrismInt } from "@/banana-ui/base/Reactive/Banana/Common";
import { mkDialogWidget, mkGtkPopup } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";

type Size = "Small" | "Medium" | "Large";
const sizes: readonly Size[] = ["Small", "Medium", "Large"];

interface Item {
  readonly label: string;
  readonly qty: number;
  readonly done: boolean;
}

interface Demo {
  readonly name: string;
  readonly count: number;
  readonly enabled: boolean;
  readonly size: Size;
  readonly due: Day;
  readonly colour: Colour;
  readonly iconName: string;
  readonly note: Maybe<string>;
  readonly choice: string;
  readonly notes: string;
  readonly summary: string;
  readonly items: readonly Item[];
  readonly picked: S.Set<string>;
  readonly url: string;
  readonly lastClicked: string;
}

function field<R, K extends keyof R>(k: K): Lens<R, R[K]> {
  return lens((r: R) => r[k], (r: R, v: R[K]) => ({ ...r, [k]: v }) as R);
}

const initialDemo: Demo = {
  name: "Widget",
  count: 3,
  enabled: true,
  size: "Medium",
  due: "2026-10-11",
  colour: C.sRGB24(80, 140, 220),
  iconName: "document-open",
  note: Nothing,
  choice: "Beta",
  notes: "Multi-line notes\nabout this item.",
  summary: "Click to edit this summary text.",
  items: [
    { label: "Apples", qty: 4, done: false },
    { label: "Pears", qty: 2, done: true },
  ],
  picked: S.fromList(["g1"]),
  url: "https://example.com/",
  lastClicked: "",
};

function demoGadget(): Gadget<null, never, Demo, Demo> {
  const f = <K extends keyof Demo, O = Demo[K]>(k: K, g: Gadget<null, never, Demo[K], O>): GadgetF_<null, never, Demo> =>
    focusing(field<Demo, K>(k), g as Gadget<null, never, Demo[K], Demo[K]>);
  const general = form<null, never, Demo>("Vertical", [
    ["Name", f("name", icon((_: string) => "document-properties", simpleTextBox()))],
    ["Count", f("count", validateText(
      (n: number) => (n < 0 ? Just("Count must not be negative") : Nothing),
      typedTextBox<null, never, number>(showInt, readInt),
    ))],
    ["Enabled", f("enabled", tickBox())],
    ["Size", f("size", boundedCombo(sizes))],
    ["Due date", f("due", dateBox(longDate))],
    ["Colour", f("colour", colourBox())],
    ["Icon", f("iconName", iconBox(() => true))],
    ["Optional note", f("note", optional("", simpleTextBox()))],
    ["Choice", f("choice", simpleRadio<null, never, string>(["Alpha", "Beta", "Gamma"]))],
    ["Link", f("url", linked((u: string) => Just(u), simpleTextBox()))],
  ]);
  const notes = form<null, never, Demo>("Vertical", [
    ["Notes", f("notes", memoBox("MemoMedium", false))],
    ["Summary", f("summary", displayText())],
    ["Name (read only)", focusing(field<Demo, "name">("name"), coloured((_: string) => Just(C.sRGB24(255, 240, 160)), readOnlyText((_e: null, s: string) => s)))],
    ["Message", focusing(field<Demo, "count">("count"), message((_e: null, n: number) => `There are ${n} widgets.`))],
  ]);
  const itemCols = [
    mkField<Item, string>("Item", field<Item, "label">("label"), Nothing, EditNote, Nothing),
    mkField<Item, number>("Qty", field<Item, "qty">("qty"), Nothing, EditEntry(textPrismInt), Nothing),
    mkField<Item, boolean>("Done", field<Item, "done">("done"), Nothing, EditBool, Nothing),
  ];
  const tableTab = f("items", table<null, never, Item>([TableAdd("Add", { label: "New", qty: 1, done: false }), TableDelete], itemCols, Nothing));
  const misc = form<null, never, Demo>("Vertical", [
    ["Pick", f("picked", treeSelector<null, never, string>(() => {
      type It = readonly [string, Maybe<string>, Maybe<string>];
      const it = (n: string, tip: Maybe<string>, v: Maybe<string>): It => [n, tip, v];
      return [
        Node(it("Group", Nothing, Nothing), [
          Node(it("First", Just("The first"), Just("g1")), []),
          Node(it("Second", Nothing, Just("g2")), []),
        ]),
        Node(it("Third", Nothing, Just("g3")), []),
      ];
    }))],
    ["Click an item", gPipe(
      arr((d: Demo) => clickItems(d.items)),
      clickableList<null, never, string>(),
      arr((m: Maybe<string>) => (d: Demo): Demo => (m.tag === "Just" ? { ...d, lastClicked: m.value } : d)),
    )],
    ["Last clicked", focusing(field<Demo, "lastClicked">("lastClicked"), message((_e: null, s: string) => s || "(nothing)"))],
    ["Count buttons", focusing(field<Demo, "count">("count"), accum(buttonBar<null, never, number>([
      ["+1", (n) => n + 1],
      ["Reset", () => 0],
    ])))],
  ]);
  return accum(tabForm<null, never, Demo>([
    ["General", frame((_: Demo) => Just("Details"), general)],
    ["Notes", notes],
    ["Table", simpleFrame("Shopping", tableTab)],
    ["Misc", misc],
  ]));
}

/** The items shown by the clickable list. */
function clickItems(items: readonly Item[]): ClickableItem<string>[] {
  return items.map((i) => ClickableItem(i.label, Just(i.label), Nothing, Nothing));
}

export function main(): void {
  Gtk.main();
  const theme = Gtk.iconThemeGetDefault();
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "ArrowDialog demo");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  Gtk.containerSetBorderWidth(vbox, 12);
  const button = Gtk.buttonNewWithLabel("Open dialog");
  const result = Gtk.labelNew("No result yet.");
  Gtk.labelSetLineWrap(result, true);
  Gtk.labelSetXalign(result, 0);
  Gtk.boxPackStart(vbox, button, false, false, 0);
  Gtk.boxPackStart(vbox, result, false, false, 0);
  Gtk.containerAdd(win, vbox);
  const dialog = Dialog<null, never, Demo, Demo>("Gadget demo", OkApplyButton, demoGadget());
  let fireOpen: (n: number) => void = () => {};
  const net = B.compile(() => {
    const [openE, fire] = B.newEvent<number>();
    fireOpen = fire;
    Gtk.onButtonClicked(button, () => fire(1));
    const results = mkGtkPopup(win, theme, pure_Changes(null), B.mapE((n: number) => [n, initialDemo, dialog] as const, openE));
    B.reactimate(B.mapE(([, m]: [number, Maybe<Demo>]) => () => {
      Gtk.labelSetText(result, m.tag === "Just" ? "Result: " + JSON.stringify(m.value) : "Cancelled.");
    }, results));
    // An embedded dialog widget for the same value.
    const [w, edits] = mkDialogWidget(
      theme, () => {}, null, pure_Changes(null),
      B.pureB(constantDialog(Dialog<null, never, Demo, Demo>("Embedded", OkApplyButton, accum(form<null, never, Demo>("Horizontal", [
        ["Name", focusing(field<Demo, "name">("name"), simpleTextBox())],
        ["Size", focusing(field<Demo, "size">("size"), boundedCombo(sizes))],
      ]))))),
      ["k", B.pureB(initialDemo)], B.never(),
    );
    Gtk.boxPackStart(vbox, w, false, false, 0);
    B.reactimate(B.mapE(([, d]: [string, Demo]) => () => Gtk.labelSetText(result, "Embedded edit: " + d.name + ", " + d.size), edits));
  });
  B.actuate(net);
  Gtk.windowPresent(win);
  const params = new URLSearchParams(location.search);
  if (!params.has("closed")) fireOpen(1);
}
