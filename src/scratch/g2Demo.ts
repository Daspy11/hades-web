/**
 * Scratch demo for the GTK interpreter of gadget dialogs (`Reactive.Banana.GI.ArrowDialog`):
 * open with `?demo=g2`.
 *
 * The window has one button per dialog, a result label and an embedded `mkDialogWidget`
 * (with a button that switches it to another record, i.e. a new key). The dialogs are:
 *
 * * "Show test dialog" (`mkGtkPopup`): a tabbed dialog with a broad range of gadgets: text,
 *   integer and real number boxes, tick box, enumeration combo, date with a popover calendar,
 *   colour, icon picker, optional values, radio buttons, links, frames, validation messages,
 *   memos, a table, a tree selector, a forest editor with a context menu, a clickable list with
 *   a context menu, a text popup with a nested dialog, button bars and an IO button.
 * * "Show notebook dialog" (`unionTab`), "Show conditional dialog" (`cond`) and "Show loop
 *   dialog" (`getInitial` + `accum`), as in the original `demo-arrow` program
 *   (`mkGtkPopupSelect`).
 * * "Run dialog" (`runDialog`, awaited).
 *
 * * "Show forest table dialog" (`forestTable`), as the matrix of the original `demo-webit`.
 *
 * `&dialog=test|notebook|cond|loop|matrix|run|none` chooses the dialog opened at start-up (default
 * `test`).
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Node, type Forest } from "@/lib/Data/Tree";
import { _1, _2, _Left, _Right, at, identity, iso, lens, type Iso, type Lens } from "@/lib/Control/Lens";
import * as M from "@/lib/Data/Map";
import { readDouble, readInt, showDouble, showInt } from "@/lib/Prelude";
import { fetchDataFile, getDataFileName } from "@/lib/System/Paths";
import type { Day } from "@/lib/Data/Time";
import { longDate, pure_Changes, shortDate, textPrismInt, type Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  ClickableItem, Dialog, OkApplyButton, displayMemo, forestTable, OkButton, accum, arr, boundedCombo, buttonBar, buttonIO, clickableList, filePathSelector,
  image, imageDisplay,
  colourBox, comboBox, cond, coloured, dateBox, displayText, focusing, focusingOver, forestEditor, form, frame, gFanout,
  gId, gPipe, getInitial, icon, iconBox, linked, maybeTextBox, memoBox, memoPopup, message, optional, optionalOver,
  readOnlyText, simpleFrame, simpleRadio, simpleTextBox, tabForm, table, textPopup, tickBox, treeSelector, typedTextBox,
  unionTab, validate, validateText, validateTextOver, ComboItem, PrismaticGadget,
  type Gadget, type GadgetF_, type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { FilePathGlob, Lens1, TreeAddAfter, TreeAddBefore, TreeAddIn, TreeDelete, constantDialog, type TreeOper } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  EditBool, EditColour, EditCombo, EditDate, EditEntry, EditIcon, EditNote, TableAdd, TableDelete, TableShuffle, enumField,
  mkField,
} from "@/banana-ui/base/Reactive/Banana/Table";
import { mkDialogWidget, mkGtkPopup, mkGtkPopupSelect, runDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";

type E = null;
type Wv = never;

// ---------------------------------------------------------------------------------------------
// Data

type Size = "Small" | "Medium" | "Large";
const sizes: readonly Size[] = ["Small", "Medium", "Large"];

type DemoEnum = "Foo" | "Bar" | "Baz" | "Wibble" | "Woo";
const demoEnumValues: readonly DemoEnum[] = ["Foo", "Bar", "Baz", "Wibble", "Woo"];
const enumIcon = (x: DemoEnum): string =>
  ({ Foo: "weather-clear", Bar: "weather-clear-night", Baz: "weather-few-clouds", Wibble: "weather-showers", Woo: "weather-overcast" })[x];
const enumColour = (x: DemoEnum): Colour =>
  ({ Foo: C.sRGB24(255, 127, 80), Bar: C.sRGB24(128, 128, 128), Baz: C.sRGB24(75, 0, 130), Wibble: C.sRGB24(0, 250, 154), Woo: C.sRGB24(250, 128, 114) })[x];

interface Row {
  readonly text: string;
  readonly num: number;
  readonly en: DemoEnum;
  readonly date: Day;
  readonly colour: Colour;
  readonly icon: string;
  readonly combo: string;
  readonly done: boolean;
}

interface Part {
  readonly partName: string;
  readonly partQty: number;
}

interface Demo {
  readonly name: string;
  readonly count: number;
  readonly weight: number;
  readonly enabled: boolean;
  readonly size: Size;
  readonly due: Day;
  readonly colour: Colour;
  readonly iconName: string;
  readonly note: Maybe<string>;
  readonly choice: string;
  readonly url: string;
  readonly range: readonly [Maybe<number>, Maybe<number>];
  readonly textRange: Maybe<readonly [string, string]>;
  readonly notes: string;
  readonly summary: string;
  readonly rows: readonly Row[];
  readonly picked: S.Set<string>;
  readonly parts: Forest<Part>;
  readonly owner: Part;
  readonly deputy: Part;
  readonly clicks: number;
  readonly lastClicked: string;
  readonly ioResult: Maybe<string>;
  readonly picture: Maybe<Uint8Array>;
  readonly clickedAt: readonly [number, number];
  readonly file: Maybe<string>;
}

function field<R, K extends keyof R>(k: K): Lens<R, R[K]> {
  return lens((r: R) => r[k], (r: R, v: R[K]) => ({ ...r, [k]: v }) as R);
}

/**
 * A read-only view of a field: setting it changes nothing. Display gadgets in a form must use a
 * lens like this (HADES uses `nullLens = lens (const ()) const`), because a form merges the
 * current value of every other gadget into each edit, so a display gadget focused with an
 * ordinary lens would write its old value back over an edit of the same field.
 */
function viewOnly<R, K extends keyof R>(k: K): Lens<R, R[K]> {
  return lens((r: R) => r[k], (r: R, _v: R[K]) => r);
}

const blankRow: Row = { text: "", num: 0, en: "Foo", date: "2000-01-01", colour: C.sRGB24(255, 255, 255), icon: "", combo: "", done: false };

export const initialDemo: Demo = {
  name: "Widget",
  count: 3,
  weight: 2.5,
  enabled: true,
  size: "Medium",
  due: "2026-10-11",
  colour: C.sRGB24(80, 140, 220),
  iconName: "document-open",
  note: Nothing,
  choice: "Beta",
  url: "https://example.com/",
  range: [Nothing, Just(5)],
  textRange: Just(["alpha", "Omega"] as const),
  notes: "Multi-line notes\nabout this item.",
  summary: "Click to edit this summary text.",
  rows: [
    { text: "One row", num: 23, en: "Wibble", date: "2016-06-24", colour: C.sRGB24(255, 0, 0), icon: "go-home", combo: "One", done: false },
    { text: "Second row", num: 74, en: "Baz", date: "2017-07-25", colour: C.sRGB24(0, 0, 255), icon: "", combo: "Two", done: true },
    { text: "Third row", num: 92, en: "Bar", date: "2018-08-26", colour: C.sRGB24(0, 128, 0), icon: "", combo: "", done: false },
  ],
  picked: S.fromList(["g1"]),
  parts: [
    Node({ partName: "Engine", partQty: 1 }, [Node({ partName: "Piston", partQty: 4 }, []), Node({ partName: "Valve", partQty: 8 }, [])]),
    Node({ partName: "Wheel", partQty: 4 }, []),
  ],
  owner: { partName: "Ann", partQty: 30 },
  deputy: { partName: "Bob", partQty: 25 },
  clicks: 0,
  lastClicked: "",
  ioResult: Nothing,
  picture: Nothing,
  clickedAt: [0, 0],
  file: Nothing,
};

// ---------------------------------------------------------------------------------------------
// The test dialog

/** Validation of an optional range: the first must not exceed the second. */
function validRange(r: readonly [Maybe<number>, Maybe<number>]): Maybe<string> {
  const [v1, v2] = r;
  return v1.tag === "Just" && v2.tag === "Just" && v1.value > v2.value ? Just("Invalid range") : Nothing;
}

/** As `mRangeGadget` in the original demo. */
function mRangeGadget(): GadgetF_<E, Wv, readonly [Maybe<number>, Maybe<number>]> {
  return validateTextOver(validRange, form<E, Wv, readonly [Maybe<number>, Maybe<number>]>("Vertical", [
    ["Lower bound:", focusing(_1<Maybe<number>, Maybe<number>>(), maybeTextBox<E, Wv, number>(showInt, readInt))],
    ["Upper bound:", focusing(_2<Maybe<number>, Maybe<number>>(), maybeTextBox<E, Wv, number>(showInt, readInt))],
    // The original demo has `focusing id` here, which writes the old range back over every edit
    // of the bounds (see `viewOnly`), so a lens that ignores updates is used instead.
    ["Range size:", focusing(lens((r: readonly [Maybe<number>, Maybe<number>]) => r, (r, _v: readonly [Maybe<number>, Maybe<number>]) => r), readOnlyText((_e: E, [v1, v2]: readonly [Maybe<number>, Maybe<number>]) =>
      v1.tag === "Just" && v2.tag === "Just" ? showInt(v2.value - v1.value) : ""))],
  ]) as any) as any;
}

/** A dialog for a part, used by the forest editor and the text popup. */
const partDialog = Dialog<E, Wv, Part, Part>("Part", OkButton, accum(form<E, Wv, Part>("Vertical", [
  ["Name", focusing(field<Part, "partName">("partName"), simpleTextBox())],
  ["Quantity", focusing(field<Part, "partQty">("partQty"), typedTextBox<E, Wv, number>(showInt, readInt))],
])));

function partMenu(m: Maybe<Part>): Menu<TreeOper<Part>> {
  const newPart: Part = { partName: "New part", partQty: 1 };
  return m.tag === "Just"
    ? Menu([
      [menuItem("Add before", TreeAddBefore(newPart)), menuItem("Add after", TreeAddAfter(newPart)), menuItem("Add inside", TreeAddIn(newPart))],
      [menuItem("Delete", TreeDelete)],
    ])
    : Menu([[menuItem("Add at end", TreeAddAfter(newPart)), menuItem("Add at start", TreeAddBefore(newPart))]]);
}

/** The items shown by the clickable list: a single click picks, a right click opens a menu. */
function clickItems(rows: readonly Row[]): ClickableItem<string>[] {
  return rows.map((r) => ClickableItem(
    r.text,
    Just(r.text),
    Just(r.text + " (double click)"),
    Just(Menu([[menuItem("Pick " + r.text, r.text + " (menu)")], [subMenu("More", Menu([[menuItem("Shout", r.text.toUpperCase())]]))]])),
  ));
}

export function demoGadget(): Gadget_<E, Wv, Demo> {
  const f = <K extends keyof Demo>(k: K, g: Gadget<E, Wv, Demo[K], Demo[K]>): GadgetF_<E, Wv, Demo> => focusing(field<Demo, K>(k), g);
  const general = form<E, Wv, Demo>("Vertical", [
    ["Name", f("name", icon((_: string) => "document-properties", simpleTextBox()))],
    ["Count", f("count", validateText(
      (n: number) => (n < 0 ? Just("Count must not be negative") : Nothing),
      typedTextBox<E, Wv, number>(showInt, readInt),
    ))],
    ["Weight (kg)", f("weight", validate((x: number) => x > 0, typedTextBox<E, Wv, number>(showDouble, readDouble)))],
    ["Enabled", f("enabled", tickBox())],
    ["Size", f("size", boundedCombo(sizes))],
    ["Due date", f("due", dateBox(longDate))],
    ["Colour", f("colour", colourBox())],
    ["Icon", f("iconName", iconBox(() => true))],
    ["Optional note", f("note", optional("", simpleTextBox()))],
    ["Choice", f("choice", simpleRadio<E, Wv, string>(["Alpha", "Beta", "Gamma"]))],
    ["Link", f("url", linked((u: string) => (u === "" ? Nothing : Just(u)), simpleTextBox()))],
  ]);
  const ranges = form<E, Wv, Demo>("Vertical", [
    ["", frame((_: Demo) => Just("Numerical range with optional limits"), focusingOver(field<Demo, "range">("range"), mRangeGadget()))],
    ["", simpleFrame("Optional text range", focusingOver(
      field<Demo, "textRange">("textRange"),
      optionalOver(["", ""] as readonly [string, string], validateTextOver(
        ([t1, t2]: readonly [string, string]) => (T.toCaseFold(t1) > T.toCaseFold(t2) ? Just("Invalid text range.") : Nothing),
        form<E, Wv, readonly [string, string]>("Horizontal", [
          ["Lower bound:", focusing(_1<string, string>(), simpleTextBox())],
          ["Upper bound:", focusing(_2<string, string>(), simpleTextBox())],
        ]) as any,
      ) as any) as any,
    ))],
  ]);
  const notes = form<E, Wv, Demo>("Vertical", [
    ["Notes", f("notes", memoBox("MemoMedium", false))],
    ["Summary", f("summary", displayText())],
    ["Name (read only)", focusing(viewOnly<Demo, "name">("name"), coloured((_: string) => Just(C.sRGB24(255, 240, 160)), readOnlyText((_e: E, s: string) => s)))],
    ["Message", focusing(viewOnly<Demo, "count">("count"), message((_e: E, n: number) => `There are ${n} widgets.`))],
    ["Owner (double click)", f("owner", textPopup((_e: E, p: Part) => p.partName + " (" + showInt(p.partQty) + ")", constantDialog(partDialog)))],
    ["Deputy memo (click)", f("deputy", memoPopup("MemoSmall", false, (_e: E, p: Part) => "Name: " + p.partName + "\nQuantity: " + showInt(p.partQty), constantDialog(partDialog)))],
  ]);
  const numIcon = (n: number): string => (n < 25 ? "face-sad" : n < 50 ? "face-plain" : n < 75 ? "face-smile" : "face-smile-big");
  const numColour = (n: number): Colour =>
    n < 0 ? C.sRGB24(255, 0, 0) : n < 100 ? C.blend(n / 100, C.sRGB24(0, 128, 0), C.sRGB24(255, 0, 0)) : C.sRGB24(0, 128, 0);
  const rowCols = [
    mkField<Row, string>("Text", field<Row, "text">("text"), Nothing, EditNote, Nothing),
    mkField<Row, number>("Number", field<Row, "num">("num"), Just(numIcon), EditEntry(textPrismInt), Just(numColour)),
    mkField<Row, DemoEnum>("Enumeration", field<Row, "en">("en"), Just(enumIcon), enumField(demoEnumValues), Just(enumColour)),
    mkField<Row, Day>("Date", field<Row, "date">("date"), Nothing, EditDate(shortDate), Nothing),
    mkField<Row, Colour>("Colour", field<Row, "colour">("colour"), Nothing, EditColour, Nothing),
    mkField<Row, string>("Icon", field<Row, "icon">("icon"), Nothing, EditIcon(() => true), Nothing),
    mkField<Row, string>("Combo", field<Row, "combo">("combo"), Nothing, EditCombo(["One", "Two", "Three", "Four", "Five"]), Nothing),
    mkField<Row, boolean>("Done", field<Row, "done">("done"), Nothing, EditBool, Nothing),
  ];
  const tableTab = f("rows", table<E, Wv, Row>([TableAdd("row", blankRow), TableDelete, TableShuffle], rowCols, Nothing));
  const trees = form<E, Wv, Demo>("Vertical", [
    ["Pick", f("picked", treeSelector<E, Wv, string>(() => {
      type It = readonly [string, Maybe<string>, Maybe<string>];
      const it = (n: string, tip: Maybe<string>, v: Maybe<string>): It => [n, tip, v];
      return [
        Node(it("Group", Nothing, Nothing), [
          Node(it("First", Just("The first"), Just("g1")), []),
          Node(it("Second", Nothing, Just("g2")), []),
        ]),
        Node(it("Empty group", Nothing, Nothing), []),
        Node(it("Third", Nothing, Just("g3")), []),
      ];
    }))],
    ["Parts (right click)", f("parts", forestEditor<E, Wv, Part>(
      (_e: E, p: Part) => p.partName + " × " + showInt(p.partQty),
      partMenu,
      () => true,
      Just(constantDialog(partDialog)),
    ))],
  ]);
  const misc = form<E, Wv, Demo>("Vertical", [
    ["Click an item", gPipe(
      arr((d: Demo) => clickItems(d.rows)),
      clickableList<E, Wv, string>(),
      arr((m: Maybe<string>) => (d: Demo): Demo => (m.tag === "Just" ? { ...d, lastClicked: m.value } : d)),
    )],
    ["Last clicked", focusing(viewOnly<Demo, "lastClicked">("lastClicked"), message((_e: E, s: string) => s || "(nothing)"))],
    ["Clicks", focusing(viewOnly<Demo, "clicks">("clicks"), message((_e: E, n: number) => showInt(n)))],
    ["Click buttons", focusing(field<Demo, "clicks">("clicks"), accum(buttonBar<E, Wv, number>([
      ["+1", (n) => n + 1],
      ["+5", (n) => n + 5],
      ["Reset", () => 0],
    ])))],
    ["IO button", gPipe(
      buttonIO<E, Wv, Demo, string>("Fetch (async)", async (_e: E, d: Demo) => {
        await new Promise((r) => setTimeout(r, 300));
        return "Fetched for " + d.name + " at " + new Date().toLocaleTimeString();
      }),
      arr((m: Maybe<string>) => (d: Demo): Demo => (m.tag === "Just" ? { ...d, ioResult: m } : d)),
    )],
    ["IO result", focusing(viewOnly<Demo, "ioResult">("ioResult"), message((_e: E, m: Maybe<string>) => (m.tag === "Just" ? m.value : "(none)")))],
  ]);
  const pictures = form<E, Wv, Demo>("Vertical", [
    ["Picture (bytes)", focusing(viewOnly<Demo, "picture">("picture"), imageDisplay<E, Wv>("MemoSmall"))],
    ["", gPipe(
      buttonIO<E, Wv, Demo, Uint8Array>("Load test card", async () =>
        new Uint8Array(await (await fetchDataFile("webits", "Testcard_F.jpg")).arrayBuffer())),
      arr((m: Maybe<Uint8Array>) => (d: Demo): Demo => (m.tag === "Just" ? { ...d, picture: m } : d)),
    )],
    ["Click the image", f("clickedAt", image(getDataFileName("hades", "hicolor/48x48/actions/align-size.png")) as any)],
    ["Clicked at", focusing(viewOnly<Demo, "clickedAt">("clickedAt"), message((_e: E, [x, y]: readonly [number, number]) => `(${x}, ${y})`))],
    ["File (click)", f("file", optional("", filePathSelector("Choose a file", "FilePathOpen", [["Text files", [FilePathGlob("*.txt")]]], false)))],
  ]);
  return accum(tabForm<E, Wv, Demo>([
    ["General", frame((_: Demo) => Just("Details"), general)],
    ["Ranges", ranges],
    ["Notes", notes],
    ["Table", simpleFrame("Rows", tableTab)],
    ["Trees", trees],
    ["Misc", misc],
    ["Pictures", pictures],
  ]));
}

// ---------------------------------------------------------------------------------------------
// The dialogs of the original demo-arrow program

/** Haskell `Either Integer Text`. */
type Item = Either<number, string>;

const itemGadgets = (): readonly [Gadget_<E, Wv, number>, Gadget_<E, Wv, string>] => [
  accum(form<E, Wv, number>("Vertical", [["Number:", focusing(identity<number>(), typedTextBox<E, Wv, number>(showInt, readInt))]])),
  accum(form<E, Wv, string>("Vertical", [["Text:", focusing(identity<string>(), simpleTextBox())]])),
];

const notebookDialog = (): any => {
  const [num, txt] = itemGadgets();
  return Dialog<E, Wv, Item, Item>("Notebook Test", OkApplyButton, unionTab<E, Wv, Item, Item>([
    ["Left", PrismaticGadget(0, _Left<number, string>(), num)],
    ["Right", PrismaticGadget("", _Right<number, string>(), txt)],
  ]));
};

type Side = "LeftSide" | "RightSide";

const condDialog = (): any => {
  const [num, txt] = itemGadgets();
  const itemDialogs = cond<E, Wv, Item, Item>([
    PrismaticGadget(0, _Left<number, string>(), num),
    PrismaticGadget("", _Right<number, string>(), txt),
  ]);
  const sideMenu = comboBox<E, Wv, Side>(() => [
    ComboItem("Number", Nothing, Nothing, "LeftSide" as Side),
    ComboItem("Text", Nothing, Nothing, "RightSide" as Side),
  ]);
  const makeSelection = (s: Side, x: Item): Item =>
    s === "LeftSide" && x.tag === "Right" ? Left(0) : s === "RightSide" && x.tag === "Left" ? Right("") : x;
  // proc input -> do
  //   s <- sideMenu -< case input of {Left {} -> LeftSide; Right {} -> RightSide}
  //   itemDialogs -< makeSelection s input
  return Dialog<E, Wv, Item, Item>("Conditional Test", OkApplyButton, gPipe(
    gFanout(gPipe(arr((input: Item): Side => (input.tag === "Left" ? "LeftSide" : "RightSide")), sideMenu), gId<E, Wv, Item>()),
    arr(([s, input]: [Side, Item]) => makeSelection(s, input)),
    itemDialogs,
  ));
};

const loopDialog1 = (): any => Dialog<E, Wv, number, number>("Loop Demo 1", OkApplyButton, getInitial((n0: number) => {
  const btns: (readonly [string, (n: number) => number])[] = [["+1", (n) => n + 1], ["+5", (n) => n + 5], ["+10", (n) => n + 10], ["Reset", () => n0]];
  return accum(gPipe(typedTextBox<E, Wv, number>(showInt, readInt), buttonBar<E, Wv, number>(btns)));
}));

// ---------------------------------------------------------------------------------------------
// A forest table, as in the webits demo matrix

interface MRow {
  readonly text: string;
  readonly num: number;
  readonly choice: Size;
  readonly flag: boolean;
  readonly date: Day;
  readonly colour: Colour;
}
const mrowDefault: MRow = { text: "", num: 0, choice: "Small", flag: false, date: "2020-01-01", colour: C.sRGB24(255, 255, 255) };

/** An `Iso'` between a @Maybe@ value and a plain value, using a default that equates to @Nothing@. */
function defaultIso<A>(d: A): Iso<Maybe<A>, A> {
  return iso((m: Maybe<A>) => (m.tag === "Nothing" ? d : m.value), (v: A) => (equalsShallow(v, d) ? Nothing : Just(v)));
}
function equalsShallow<A>(a: A, b: A): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const initialMatrix: M.Map<number, MRow> = M.fromList([
  [0, { text: "First row\nof the matrix", num: 1, choice: "Small", flag: true, date: "2021-03-04", colour: C.sRGB24(255, 200, 200) }],
  [1, { text: "Second", num: 22, choice: "Medium", flag: false, date: "2022-05-06", colour: C.sRGB24(200, 255, 200) }],
  [2, { text: "Third, a sub-row", num: 333, choice: "Large", flag: true, date: "2023-07-08", colour: C.sRGB24(200, 200, 255) }],
]);

const matrixDialog = (): any => {
  const fl = <K extends keyof MRow>(k: K) => field<MRow, K>(k);
  const columns: (readonly [string, (readonly [string, GadgetF_<E, Wv, MRow>])[]])[] = [
    ["Group One", [
      ["Text", focusing(fl("text"), displayMemo<E, Wv>())],
      ["Number", focusing(fl("num"), typedTextBox<E, Wv, number>(showInt, readInt))],
      ["Choice", focusing(fl("choice"), boundedCombo<E, Wv, Size>(sizes))],
      ["Boolean", focusing(fl("flag"), tickBox<E, Wv>())],
    ]],
    ["Group Two", [
      ["Date", focusing(fl("date"), dateBox<E, Wv>(shortDate))],
      ["Colour", focusing(fl("colour"), colourBox<E, Wv>())],
    ]],
  ];
  const mknod = (k: number, ks: readonly number[]): any =>
    Node([k, Lens1(at<number, MRow>(k).dot(defaultIso(mrowDefault)))] as const, ks.map((k1) => mknod(k1, [])));
  const keys: [number, number[]][] = [[0, [1, 2]], [1, []], [2, [0]]];
  return Dialog<E, any, M.Map<number, MRow>, M.Map<number, MRow>>("Forest table", OkApplyButton,
    accum(forestTable(columns, () => keys.map(([k, ks]) => mknod(k, ks))) as any));
};

// ---------------------------------------------------------------------------------------------
// Main

export function main(): void {
  Gtk.main();
  const theme = Gtk.iconThemeGetDefault();
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "ArrowDialog demo");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  Gtk.containerSetBorderWidth(vbox, 12);
  const buttons = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  const mkButton = (label: string): Gtk.Button => {
    const b = Gtk.buttonNewWithLabel(label);
    Gtk.boxPackStart(buttons, b, false, false, 0);
    return b;
  };
  const testButton = mkButton("Show test dialog");
  const notebookButton = mkButton("Show notebook dialog");
  const condButton = mkButton("Show conditional dialog");
  const loopButton = mkButton("Show loop dialog");
  const matrixButton = mkButton("Show forest table dialog");
  const runButton = mkButton("Run dialog (async)");
  const nextButton = mkButton("Next embedded record");
  const result = Gtk.labelNew("No result yet.");
  Gtk.labelSetLineWrap(result, true);
  Gtk.labelSetXalign(result, 0);
  Gtk.labelSetSelectable(result, true);
  Gtk.boxPackStart(vbox, buttons, false, false, 0);
  Gtk.boxPackStart(vbox, result, false, false, 0);
  Gtk.containerAdd(win, vbox);
  const show = (s: string): void => Gtk.labelSetText(result, s);
  // Readable JSON for the result label: colours as hex, maps and sets as lists, bytes as a count.
  const showValue = (x: unknown): string => JSON.stringify(x, (_k, v) =>
    v instanceof C.Colour ? C.sRGB24show(v)
      : v instanceof M.HMap ? M.toList(v)
        : v instanceof S.HSet ? S.toList(v)
          : v instanceof Uint8Array ? `<${v.length} bytes>`
            : v);
  const showDemo = (d: Demo): string => showValue(d);
  const testDialog = Dialog<E, Wv, Demo, Demo>("Gadget demo", OkApplyButton, demoGadget());
  const fires: Record<string, () => void> = {};
  const net = B.compile(() => {
    // Test dialog, with the dialog in the event (mkGtkPopup).
    const [testE, fireTest] = B.newEvent<number>();
    let testCount = 0;
    fires.test = () => fireTest(++testCount);
    Gtk.onButtonClicked(testButton, () => fires.test());
    const testResults = mkGtkPopup(win, theme, pure_Changes(null), B.mapE((n: number) => [n, initialDemo, testDialog] as const, testE));
    B.reactimate(B.mapE(([n, m]: [number, Maybe<Demo>]) => () =>
      show(m.tag === "Just" ? `Test dialog ${n}: ${showDemo(m.value)}` : `Test dialog ${n} cancelled.`), testResults));
    // The demo-arrow dialogs (mkGtkPopupSelect with constant selectors).
    const popup = <A>(name: string, button: Gtk.Button, dialog: any, initial: A): void => {
      const [ev, fire] = B.newEvent<number>();
      let count = 0;
      fires[name] = () => fire(++count);
      Gtk.onButtonClicked(button, () => fires[name]());
      const res = mkGtkPopupSelect(win, theme, pure_Changes(null), constantDialog(dialog), B.mapE((n: number) => [n, initial] as const, ev));
      B.reactimate(B.mapE(([n, m]: [number, Maybe<A>]) => () =>
        show(m.tag === "Just" ? `${name} dialog ${n}: ${showValue(m.value)}` : `${name} dialog ${n} cancelled.`), res));
    };
    popup<Item>("notebook", notebookButton, notebookDialog(), Right("Foo!"));
    popup<Item>("cond", condButton, condDialog(), Right("Foo!"));
    popup<number>("loop", loopButton, loopDialog1(), 0);
    popup<M.Map<number, MRow>>("matrix", matrixButton, matrixDialog(), initialMatrix);
    // An embedded dialog widget; "Next embedded record" changes the key, so a new gadget is built.
    const records: Demo[] = [initialDemo, { ...initialDemo, name: "Gizmo", size: "Large" }];
    const [nextE, fireNext] = B.newEvent<null>();
    Gtk.onButtonClicked(nextButton, () => fireNext(null));
    const keyE = B.accumE(0, B.mapE(() => (k: number) => (k + 1) % records.length, nextE));
    const embedded = Dialog<E, Wv, Demo, Demo>("Embedded record", OkApplyButton, accum(form<E, Wv, Demo>("Horizontal", [
      ["Name", focusing(field<Demo, "name">("name"), simpleTextBox())],
      ["Size", focusing(field<Demo, "size">("size"), boundedCombo(sizes))],
      ["Due", focusing(field<Demo, "due">("due"), dateBox(longDate))],
    ])));
    const [w, edits] = mkDialogWidget(
      theme, () => {}, null, pure_Changes(null),
      B.pureB(constantDialog(embedded)),
      [0, B.pureB(records[0])], B.mapE((k: number) => [k, B.pureB(records[k])] as const, keyE),
    );
    Gtk.boxPackStart(vbox, w, false, false, 0);
    B.reactimate(B.mapE(([k, d]: [number, Demo]) => () => {
      records[k] = d;
      show(`Embedded edit (record ${k}): ${d.name}, ${d.size}, ${d.due}`);
    }, edits));
  });
  B.actuate(net);
  // runDialog blocks (awaits) until the dialog is closed.
  const run = async (): Promise<void> => {
    const r = await runDialog(win, theme, partDialog, null, { partName: "Bolt", partQty: 12 });
    show(r.tag === "Just" ? "runDialog: " + JSON.stringify(r.value) : "runDialog cancelled.");
  };
  fires.run = () => void run();
  Gtk.onButtonClicked(runButton, () => fires.run());
  Gtk.windowPresent(win);
  const start = new URLSearchParams(location.search).get("dialog") ?? "test";
  if (start !== "none") fires[start]?.();
}
