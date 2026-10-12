/**
 * Scratch demo of the webits gadget interpreter (`Network.Webits.ArrowDialog`) and tables
 * (`Network.Webits.Table`), on the in-page loopback engine: open with `?demo=w2`.
 *
 * Modelled on the original `demo-webit` program (its `Types`, `Dialog`, `Matrix` and `Main`
 * modules are reproduced here):
 *
 *  * "Dialog Demo": the demo dialog (display memo, number with Increment/Decrement buttons,
 *    radio buttons, tick box, date, icon, colour, a text popup opening a tree selector dialog,
 *    an editable AppendGrid table with icon and colour decorations, a clickable list, memos
 *    computed from the value and an IO button);
 *  * "Matrix Demo": a forest table of random rows rendered into the page;
 *  * "Right-click Menu": the demo popup menu;
 *  * "Forest Editor Demo": a forest editor dialog (drag and drop, context menus, double click
 *    to edit an item with the demo dialog);
 *  * "Clickable Image Demo": an image gadget reporting click coordinates;
 *  * "More Gadgets" (not in the original): optional values, combo boxes, a memo box, read-only
 *    text, decorations, a conditional gadget, union tabs, validation and a table whose rows
 *    open a dialog.
 *
 * Unlike the original front page (which handles one click and then deletes its buttons) the
 * buttons stay and can be used repeatedly. Dialog results are logged with `elmerLog` and shown in
 * the status area at the bottom. Random data comes from a seeded generator, so screenshots are
 * reproducible.
 *
 * `&open=dialog|matrix|forest|image|more` opens one of the demos at start-up.
 */
import * as C from "@/lib/Data/Colour";
import * as J from "@/lib/Data/Aeson";
import * as S from "@/lib/Data/Set";
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { Node, drawForest, fmapForest, type Forest, type Tree } from "@/lib/Data/Tree";
import { addDays, fromGregorian, showDay, type Day } from "@/lib/Data/Time";
import { _Left, _Right, at, iso, lens, over, set, type Iso, type Lens } from "@/lib/Control/Lens";
import { readDouble, readInt, showDouble, showInt } from "@/lib/Prelude";
import { equals } from "@/lib/Data/Ord";
import { atomically, atomicallySync, dupTChan, newTChanIO, orElse, readTChan, writeTChan } from "@/lib/Control/Concurrent/STM";
import { send } from "@/lib/Network/JavaScript";
import { getDataFileName } from "@/lib/System/Paths";
import {
  GadgetData,
  noIconName,
  show_Colour,
  shortDate,
  textPrismDouble,
  type Colour,
} from "@/banana-ui/base/Reactive/Banana/Common";
import {
  ComboItem,
  Dialog,
  OkApplyButton,
  OkButton,
  PrismaticGadget,
  accum,
  arr,
  boundedCombo,
  boundedRadio,
  box,
  buttonBar,
  buttonIO,
  clickableSingle,
  colourBox,
  coloured,
  comboBox,
  cond,
  dateBox,
  displayMemo,
  focusing,
  forestEditor,
  forestTable,
  form,
  gFanout,
  gId,
  gPipe,
  icon,
  iconBox,
  image,
  linked,
  memoBox,
  message,
  optional,
  readOnlyText,
  scrolled,
  simpleFrame,
  simpleTextBox,
  styled1,
  table,
  textPopup,
  tickBox,
  treeSelector,
  typedTextBox,
  unionTab,
  validate,
  type Dialog_,
  type Gadget_,
  type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Lens1, TreeAddAfter, TreeAddBefore, TreeAddIn, TreeDelete, constantDialog, type TreeOper } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  EditBool,
  EditEntry,
  EditIcon,
  TableAdd,
  TableDelete,
  TableShuffle,
  mkField,
  type Table,
} from "@/banana-ui/base/Reactive/Banana/Table";
import { newTStateIO, pure_TState, type TState } from "@/banana-ui/webits/src/Control/Concurrent/TState";
import {
  elmerDaemon,
  elmerLog,
  elmerScotty,
  elmerStatic,
  jsNoOp,
  jsValue,
  logToStderr,
  makeWebit,
  makeWebitContainer,
  makeWebStatic,
  setWebitHtml,
  showWebit,
  webitEvent,
  WebitClass_Webit,
  WebitClass_WebitContainer,
  WebitClass_WebitItem,
  WebitClass_WebStatic,
  WebitItem,
  type ElmerEnv,
  type Webit,
} from "@/banana-ui/webits/src/Network/Webits";
import { mkWebitMenu, popupMenuOn, WebitClass_WebitMenu } from "@/banana-ui/webits/src/Network/Webits/Menu";
import { getIconData, mergeIconGroups } from "@/banana-ui/webits/src/Network/Webits/Icons";
import { mkWebitPopupSelect, renderGadget } from "@/banana-ui/webits/src/Network/Webits/ArrowDialog";
import wordsTxt from "@/banana-ui/webits/words.txt?raw";

// ---------------------------------------------------------------------------------------------
// Random data (demo-webit uses QuickCheck generators; here a seeded generator).

let seed = 20211;
function random(): number {
  // Park-Miller minimal standard generator.
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
function choose(lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}
function elements<A>(xs: readonly A[]): A {
  return xs[choose(0, xs.length - 1)];
}

// ---------------------------------------------------------------------------------------------
// demo-webit Types

type DemoEnum = "Foo" | "Bar" | "Baz" | "Wibble" | "Woo";
const demoEnumValues: readonly DemoEnum[] = ["Foo", "Bar", "Baz", "Wibble", "Woo"];

interface DemoTable {
  readonly _boolField: boolean;
  readonly _numberField: number;
  readonly _iconField: string;
}
function DemoTable(_boolField: boolean, _numberField: number, _iconField: string): DemoTable {
  return { _boolField, _numberField, _iconField };
}
const boolField: Lens<DemoTable, boolean> = lens((s) => s._boolField, (s, v) => ({ ...s, _boolField: v }));
const numberField: Lens<DemoTable, number> = lens((s) => s._numberField, (s, v) => ({ ...s, _numberField: v }));
const iconField: Lens<DemoTable, string> = lens((s) => s._iconField, (s, v) => ({ ...s, _iconField: v }));
function show_DemoTable(t: DemoTable): string {
  return "DemoTable {_boolField = " + (t._boolField ? "True" : "False") + ", _numberField = " + showDouble(t._numberField) + ", _iconField = " + T.showText(t._iconField) + "}";
}

interface DemoData {
  readonly _demoText: string;
  readonly _demoNum: number;
  readonly _demoEnum: DemoEnum;
  readonly _demoBool: boolean;
  readonly _demoDate: Day;
  readonly _demoIcon: string;
  readonly _demoColour: Colour;
  readonly _demoSet: S.Set<number>;
  readonly _demoTable: readonly DemoTable[];
}

/** Icons known to exist in the demo's icon groups (the original used its author's Diametric set). */
const iconList: readonly string[] = [
  "emblem-ok-symbolic", "computer-symbolic", "face-cool-symbolic", "weather-clear-symbolic", "starred-symbolic",
  "general-tick", "general-warning", "road-sign-stop", "road-sign-roundabout", "face-smile-symbolic",
];
const wordsList: readonly string[] = wordsTxt.split("\n").filter((w) => w !== "");

const demoDefault: DemoData = {
  _demoText: "Foo! This is a ridiculously long line to put in a text box. It ought to be a paragraph!",
  _demoNum: 5,
  _demoEnum: "Bar",
  _demoBool: false,
  _demoDate: fromGregorian(2021, 8, 1),
  _demoIcon: "emblem-ok-symbolic",
  _demoColour: C.sRGB24(0, 255, 255), // aqua
  _demoSet: S.fromList([1, 21, 13]),
  _demoTable: [
    DemoTable(true, 3.14159, "computer-symbolic"),
    DemoTable(false, 4, "road-sign-roundabout"),
    DemoTable(true, 5, "face-smile-symbolic"),
  ],
};

const demoText: Lens<DemoData, string> = lens((s) => s._demoText, (s, v) => ({ ...s, _demoText: v }));
const demoNum: Lens<DemoData, number> = lens((s) => s._demoNum, (s, v) => ({ ...s, _demoNum: v }));
const demoEnum: Lens<DemoData, DemoEnum> = lens((s) => s._demoEnum, (s, v) => ({ ...s, _demoEnum: v }));
const demoBool: Lens<DemoData, boolean> = lens((s) => s._demoBool, (s, v) => ({ ...s, _demoBool: v }));
const demoDate: Lens<DemoData, Day> = lens((s) => s._demoDate, (s, v) => ({ ...s, _demoDate: v }));
const demoIcon: Lens<DemoData, string> = lens((s) => s._demoIcon, (s, v) => ({ ...s, _demoIcon: v }));
const demoColour: Lens<DemoData, Colour> = lens((s) => s._demoColour, (s, v) => ({ ...s, _demoColour: v }));
const demoSet: Lens<DemoData, S.Set<number>> = lens((s) => s._demoSet, (s, v) => ({ ...s, _demoSet: v }));
const demoTable: Lens<DemoData, readonly DemoTable[]> = lens((s) => s._demoTable, (s, v) => ({ ...s, _demoTable: v }));

function prettyDemo(d: DemoData): string {
  return (
    "DemoData {\n" +
    "   demoText: " + T.showText(d._demoText) + "\n" +
    "   demoNum: " + showInt(d._demoNum) + "\n" +
    "   demoEnum: " + d._demoEnum + "\n" +
    "   demoBool: " + (d._demoBool ? "True" : "False") + "\n" +
    "   demoDate: " + showDay(d._demoDate) + "\n" +
    "   demoIcon: " + T.showText(d._demoIcon) + "\n" +
    "   demoColour: " + show_Colour(d._demoColour) + "\n" +
    "   demoSet: {" + S.toList(d._demoSet).map(String).join(", ") + "}\n" +
    "   demoTable: [\n" + d._demoTable.map((t) => "       " + show_DemoTable(t) + "\n").join("") + "   ]\n" +
    "}"
  );
}

type ForestItem = readonly [string, Maybe<string>, Maybe<number>];
const fi = (name: string, tip: Maybe<string>, k: Maybe<number>): ForestItem => [name, tip, k];
const demoForest: Forest<ForestItem> = [
  Node(fi("Item 1", Just("tooltip one"), Nothing), [
    Node(fi("Item 1.1", Just("tooltip one point one"), Just(11)), []),
    Node(fi("Thingy 1.2", Just("thingy is like an item"), Just(12)), []),
    Node(fi("Itemised 1.3", Nothing, Just(13)), [Node(fi("Final 1.3.1", Just("some tips"), Just(131)), [])]),
  ]),
  Node(fi("Item 2", Just("tooltip two"), Nothing), [
    Node(fi("Item 2.1", Just("this is not item 1.2"), Just(21)), []),
    Node(fi("Item 2.2", Just("invisible"), Nothing), []),
  ]),
];
type DemoForest = typeof demoForest;

/** A random RGB colour. */
function arbitraryColour(): Colour {
  return C.sRGB24(choose(0, 255), choose(0, 255), choose(0, 255));
}
/** A random day in 2021. */
function arbitraryDay(): Day {
  return addDays(choose(0, 364), fromGregorian(2021, 1, 1));
}
/** A string of @n@ arbitrary common words. */
function arbitraryText(n: number): string {
  return Array.from({ length: n }, () => elements(wordsList)).join(" ");
}
function arbitraryDemoTable(): DemoTable {
  return DemoTable(random() < 0.5, Math.round(random() * 2000 - 1000) / 10, elements(iconList));
}
function arbitraryDemoData(): DemoData {
  return {
    _demoText: arbitraryText(5),
    _demoNum: choose(-50, 50),
    _demoEnum: elements(demoEnumValues),
    _demoBool: random() < 0.5,
    _demoDate: arbitraryDay(),
    _demoIcon: elements(iconList),
    _demoColour: arbitraryColour(),
    _demoSet: S.fromList(Array.from({ length: choose(0, 4) }, () => choose(0, 30))),
    _demoTable: Array.from({ length: choose(0, 3) }, arbitraryDemoTable),
  };
}

// ---------------------------------------------------------------------------------------------
// demo-webit Dialog

function boolIcon(b: boolean): string {
  return b ? "list-add-symbolic" : "application-exit-symbolic";
}
function boolColour(b: boolean): Colour {
  return b ? C.sRGB24(0, 100, 0) : C.sRGB24(139, 0, 0); // darkgreen, darkred
}

const demoTableColumns: Table<DemoTable> = [
  mkField("Boolean", boolField, Just(boolIcon), EditBool, Just(boolColour)),
  mkField("Number", numberField, Nothing, EditEntry(textPrismDouble), Nothing),
  mkField("Icon", iconField, Nothing, EditIcon(() => true), Nothing),
];

const demoTableForm: Dialog_<any, any, DemoTable> = Dialog(
  "Edit table row",
  OkApplyButton,
  accum(
    form("Vertical", [
      ["Boolean", focusing(boolField, coloured((b: boolean) => Just(boolColour(b)), icon(boolIcon, tickBox())))],
      ["Number", focusing(numberField, typedTextBox(showDouble, readDouble))],
      ["Icon", focusing(iconField, iconBox(() => true))],
    ]),
  ),
);

const demoForestSelection: Dialog_<DemoForest, any, S.Set<number>> = Dialog("Demo Tree Selection", OkApplyButton, treeSelector((e: DemoForest) => e));

const demoSetPopup: Gadget_<DemoForest, any, S.Set<number>> = (() => {
  const showSet = (s: S.Set<number>): string => S.toList(s).map(String).join(", ");
  return textPopup((_e: DemoForest, s: S.Set<number>) => showSet(s), () => Just(demoForestSelection));
})();

/** `demoDialog`, desugared from `proc dat -> do ...`. */
const demoDialog: Dialog_<DemoForest, any, DemoData> = Dialog(
  "Demo Dialog",
  OkApplyButton,
  // proc dat -> do
  //   out <- accum $ box Vertical [[ form Vertical [...], focusing demoTable $ table ... ]] -< dat
  //   _ <- simpleFrame "Clickable" $ clickableSingle (T.pack . show) >>> message (...) -< [1..10 :: Int]
  //   _ <- displayMemo <<< arr (\v -> "The secret code is: " ...) -< out
  //   _ <- displayMemo <<< arr (\v -> "The random value is: " ...) <<< buttonIO "Randomise" ... -< ()
  //   returnA -< out
  gPipe(
    accum(
      box("Vertical", [
        [
          form<DemoForest, any, DemoData>("Vertical", [
            ["Demo Text:", focusing(demoText, displayMemo())],
            [
              "Demo Number:",
              focusing(demoNum, gPipe(typedTextBox(showInt, readInt), accum(buttonBar<any, any, number>([["Increment", (x) => x + 1], ["Decrement", (x) => x - 1]])))),
            ],
            ["Demo Choice:", focusing(demoEnum, boundedRadio(demoEnumValues))],
            ["Demo Boolean:", focusing(demoBool, tickBox())],
            ["Demo Date:", focusing(demoDate, dateBox(shortDate))],
            ["Demo Icon:", focusing(demoIcon, iconBox(() => true))],
            ["Demo Colour:", focusing(demoColour, colourBox())],
            ["Demo Set:", focusing(demoSet, demoSetPopup)],
          ]),
          focusing(
            demoTable,
            table([TableAdd("new row", DemoTable(false, 0, noIconName)), TableDelete, TableShuffle], demoTableColumns, Nothing),
            //  (Just $ constantDialog demoTableForm)
          ),
        ],
      ]),
    ),
    gFanout(
      gId<DemoForest, any, DemoData>(),
      gPipe(
        arr((_: DemoData) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        simpleFrame("Clickable", gPipe(clickableSingle((n: number) => String(n)), message((_e: any, v: Maybe<number>) => "Clicked = " + (v.tag === "Just" ? "Just " + String(v.value) : "Nothing")))),
      ),
    ),
    arr(([out]: readonly [DemoData, unknown]) => out),
    gFanout(
      gId<DemoForest, any, DemoData>(),
      gPipe(arr((v: DemoData) => "The secret code is: " + v._demoEnum + showInt(v._demoNum)), displayMemo()),
    ),
    arr(([out]: readonly [DemoData, unknown]) => out),
    gFanout(
      gId<DemoForest, any, DemoData>(),
      gPipe(
        arr((_: DemoData) => null),
        buttonIO("Randomise", () => choose(0, 100)),
        arr((v: Maybe<number>) => "The random value is: " + (v.tag === "Just" ? String(v.value) : "")),
        displayMemo(),
      ),
    ),
    arr(([out]: readonly [DemoData, unknown]) => out),
  ),
);
void demoTableForm; // Commented out in the original dialog, kept for reference.

// ---------------------------------------------------------------------------------------------
// demo-webit Matrix

const matrixColumns: readonly (readonly [string, readonly (readonly [string, GadgetF_<any, any, DemoData>])[]])[] = [
  [
    "Group One",
    [
      ["Text", focusing(demoText, displayMemo())],
      ["Number", focusing(demoNum, typedTextBox(showInt, readInt))],
      ["Choice", focusing(demoEnum, boundedCombo(demoEnumValues))],
      ["Boolean", focusing(demoBool, tickBox())],
    ],
  ],
  [
    "Group Two",
    [
      ["Text", focusing(demoText, displayMemo())],
      ["Date", focusing(demoDate, dateBox(shortDate))],
      ["Icon", focusing(demoIcon, iconBox(() => true))],
      ["Colour", focusing(demoColour, colourBox())],
    ],
  ],
];

type Model = M.Map<number, DemoData>;
type MatrixItems = readonly (readonly [number, readonly number[]])[];

/**
 * Create an "Iso'" betweeen a @Maybe@ value and a plain value by using a default that equates to
 * @Nothing@.
 */
function defaultIso<A>(d: A): Iso<Maybe<A>, A> {
  return iso(
    (m: Maybe<A>) => (m.tag === "Nothing" ? d : m.value),
    (v: A) => (equals(v, d) ? Nothing : Just(v)),
  );
}

/** Display a selection of keys taken from the model. */
function demoMatrix(keys: MatrixItems): Gadget_<any, Either<any, [number, (d: DemoData) => DemoData]>, Model> {
  const mknod = (k: number, ks: readonly number[]): Tree<readonly [number, Lens1<Model, DemoData>]> =>
    Node([k, Lens1(at<number, DemoData>(k).dot(defaultIso(demoDefault)))] as const, ks.map((k1) => mknod(k1, [])));
  return accum(forestTable(matrixColumns, () => keys.map(([k, ks]) => mknod(k, ks))));
}

/** Generate a model with N items, and a random selection of rows and sub-rows to display. */
function arbitraryMatrix(n: number): [Model, MatrixItems] {
  const ns = Array.from({ length: n }, (_, k) => k);
  const mdl = M.fromList(ns.map((k): [number, DemoData] => [k, arbitraryDemoData()]));
  const subs = ns.map(() => ns.filter(() => random() < 0.25));
  return [mdl, ns.map((k, j) => [k, subs[j]] as const)];
}

function demoMatrixAction(env: ElmerEnv, modelState: TState<boolean, Model>, modelWriter: (b: boolean, m: Model) => void, keys: MatrixItems): void {
  const top = env.elmerTop;
  const eng = env.elmerEngine;
  const gOut = renderGadget(env, pure_TState<boolean, null>(null), (() => {
    // GadgetData True <$> modelState
    const st: TState<boolean, GadgetData<Model>> = {
      tStateBehaviour: () => GadgetData(true, modelState.tStateBehaviour()),
      tStateEvent: () => {
        const [b, m] = modelState.tStateEvent();
        return [b, GadgetData(true, m)];
      },
      tStateDup: () => {
        const d = modelState.tStateDup();
        return { ...st, tStateEvent: () => { const [b, m] = d.tStateEvent(); return [b, GadgetData(true, m)]; } };
      },
    };
    return st;
  })(), demoMatrix(keys));
  for (const w of gOut.gadgetView) showWebit(WebitClass_WebitItem, env, top, w);
  send(eng, gOut.gadgetDomCode);
  elmerDaemon(WebitClass_WebitContainer, env, top, () =>
    atomically(() => {
      const update = gOut.gadgetEvents();
      if (update.tag === "Right") {
        const [k, updateF] = update.value;
        console.debug("demoMatrixAction: got an event on row " + String(k));
        const oldVal = gOut.gadgetOutput.tStateBehaviour();
        const newVal = over(at<number, DemoData>(k), (m: Maybe<DemoData>) => (m.tag === "Just" ? Just(updateF(m.value)) : m), oldVal._gdValue);
        modelWriter(false, newVal);
      }
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// demo-webit Main

const demoForestEditor: Dialog_<DemoForest, any, Forest<DemoData>> = (() => {
  const demoLabel = (_e: unknown, x: DemoData): string => x._demoText + " (" + (x._demoBool ? "Y" : "N" + ")");
  const node = set(demoBool, true, demoDefault);
  const demoMenus = (m: Maybe<DemoData>): Menu<TreeOper<DemoData>> => {
    if (m.tag === "Nothing") return Menu([[menuItem("Add leaf", TreeAddIn(demoDefault)), menuItem("Add node", TreeAddIn(node))]]);
    return m.value._demoBool
      ? Menu([
          [menuItem("Add leaf", TreeAddIn(demoDefault)), menuItem("Add node", TreeAddIn(node))],
          [menuItem("New node before", TreeAddBefore(node)), menuItem("New node after", TreeAddAfter(node))],
          [menuItem("Delete", TreeDelete)],
        ])
      : Menu([
          [menuItem("New node before", TreeAddBefore(node)), menuItem("New node after", TreeAddAfter(node))],
          [menuItem("Delete", TreeDelete)],
        ]);
  };
  return Dialog("Demo Dialog", OkApplyButton, forestEditor(demoLabel, demoMenus, (x: DemoData) => x._demoBool, Just(constantDialog(demoDialog))));
})();

/** `generate $ resize 5 arbitrary :: Gen (Forest DemoData)`, approximately. */
function arbitraryDemoForest(depth: number): Forest<DemoData> {
  return Array.from({ length: choose(1, 3) }, () => {
    const d = arbitraryDemoData();
    const isNode = depth > 0 && random() < 0.6;
    return Node({ ...d, _demoBool: isNode }, isNode ? arbitraryDemoForest(depth - 1) : []);
  });
}

/** demo-webit `Main.choiceButton`. */
function choiceButton(
  env: ElmerEnv,
  /** Text to display. */
  display: string,
): Webit<string> {
  const buttonContents = (wId: string) =>
    H.with_(H.button(H.text(display)), HA.type_("button"), HA.onclick(jsValue(webitEvent(J.textJ, wId, display))));
  return makeWebit(J.textJ, env, buttonContents, () => jsNoOp, display);
}

/** demo-webit `Menu.demoMenu`. */
const demoMenu: Menu<number> = Menu([
  [
    menuItem("Ten", 10),
    subMenu("Tens", Menu([[menuItem("Eleven", 11), menuItem("Twelve", 12), menuItem("Thirteen", 13), menuItem("Fourteen", 14)]])),
    menuItem("Twenty", 20),
  ],
  [menuItem("Thirty", 30), menuItem("Fourty", 40)],
]);

/** demo-webit `Menu.demoMenuButton`. */
function demoMenuButton(env: ElmerEnv, report: (env: ElmerEnv, msg: string) => void): WebitItem {
  const menu = mkWebitMenu(env, demoMenu);
  elmerDaemon(WebitClass_WebitMenu, env, menu, async (env1) => {
    const v = await atomically(() => readTChan(menu.webitMenuOutput));
    report(env1, "Menu option " + String(v) + " clicked.");
  });
  const buttonContents = () => H.with_(H.button("Right-click Menu"), HA.type_("button"));
  const btn = makeWebit(J.textJ, env, buttonContents, () => jsNoOp, "Menu");
  popupMenuOn(WebitClass_Webit, env, btn, "OnRightClick", menu);
  return WebitItem(WebitClass_Webit, btn);
}

function demoImageAction(env: ElmerEnv, report: (env: ElmerEnv, msg: string) => void): void {
  const top = env.elmerTop;
  const gOut = renderGadget(env, pure_TState<boolean, null>(null), pure_TState<boolean, GadgetData<[number, number]>>(GadgetData(true, [0, 0])), image(getDataFileName("webits", "Testcard_F.jpg")));
  for (const w of gOut.gadgetView) showWebit(WebitClass_WebitItem, env, top, w);
  elmerDaemon(WebitClass_WebitItem, env, gOut.gadgetView[0], async (env1) => {
    const click = await atomically(() => gOut.gadgetOutput.tStateEvent());
    report(env1, "Image clicked at (" + String(click[0] ? "True" : "False") + ",(" + String(click[1]._gdValue[0]) + "," + String(click[1]._gdValue[1]) + "))");
  });
}

// ---------------------------------------------------------------------------------------------
// More gadgets (not in demo-webit)

interface Extra {
  readonly name: Maybe<string>;
  readonly ticked: Maybe<boolean>;
  readonly size: DemoEnum;
  readonly notes: string;
  readonly shape: Either<number, string>;
  readonly percent: number;
  readonly rows: readonly DemoTable[];
}
const extraName: Lens<Extra, Maybe<string>> = lens((s) => s.name, (s, v) => ({ ...s, name: v }));
const extraTicked: Lens<Extra, Maybe<boolean>> = lens((s) => s.ticked, (s, v) => ({ ...s, ticked: v }));
const extraSize: Lens<Extra, DemoEnum> = lens((s) => s.size, (s, v) => ({ ...s, size: v }));
const extraNotes: Lens<Extra, string> = lens((s) => s.notes, (s, v) => ({ ...s, notes: v }));
const extraShape: Lens<Extra, Either<number, string>> = lens((s) => s.shape, (s, v) => ({ ...s, shape: v }));
const extraPercent: Lens<Extra, number> = lens((s) => s.percent, (s, v) => ({ ...s, percent: v }));
const extraRows: Lens<Extra, readonly DemoTable[]> = lens((s) => s.rows, (s, v) => ({ ...s, rows: v }));

const extraDefault: Extra = {
  name: Just("Widget"),
  ticked: Nothing,
  size: "Baz",
  notes: "Multi-line\nnotes.",
  shape: Left(3),
  percent: 42,
  rows: demoDefault._demoTable,
};

const sizeColour = (x: DemoEnum): Colour =>
  ({ Foo: C.sRGB24(255, 127, 80), Bar: C.sRGB24(128, 128, 128), Baz: C.sRGB24(75, 0, 130), Wibble: C.sRGB24(0, 250, 154), Woo: C.sRGB24(250, 128, 114) })[x];

const extraDialog: Dialog_<null, any, Extra> = Dialog(
  "More Gadgets",
  OkButton,
  accum(
    form<null, any, Extra>("Vertical", [
      ["Optional name:", focusing(extraName, optional("", simpleTextBox()))],
      ["Optional tick:", focusing(extraTicked, optional(false, tickBox()))],
      ["Size (combo):", focusing(extraSize, coloured((x: DemoEnum) => Just(sizeColour(x)), boundedCombo(demoEnumValues)))],
      [
        "Size (icons):",
        focusing(
          extraSize,
          comboBox(() => demoEnumValues.map((x) => ComboItem(x, Just(iconList[demoEnumValues.indexOf(x)]), Just(sizeColour(x)), x))),
        ),
      ],
      ["Notes:", focusing(extraNotes, memoBox("MemoSmall", false))],
      ["Read only:", focusing(extraSize, readOnlyText((_e: null, x: DemoEnum) => "The size is " + x))],
      ["Percentage:", focusing(extraPercent, validate((n: number) => n >= 0 && n <= 100, typedTextBox(showInt, readInt)))],
      ["Link:", focusing(extraName, linked((m: Maybe<string>) => (m.tag === "Just" ? Just("https://www.example.com/" + m.value) : Nothing), message((_e: null, m: Maybe<string>) => "Search for " + (m.tag === "Just" ? m.value : "nothing"))))],
      ["Styled:", focusing(extraSize, styled1("invalid", message((_e: null, x: DemoEnum) => "Styled with the 'invalid' class: " + x)))],
      [
        "Shape (tabs):",
        focusing(
          extraShape,
          unionTab<null, any, Either<number, string>, Either<number, string>>([
            ["Number", PrismaticGadget(0, _Left<number, string>(), typedTextBox<null, any, number>(showInt, readInt))],
            ["Text", PrismaticGadget("", _Right<number, string>(), simpleTextBox<null, any>())],
          ]),
        ),
      ],
      [
        // Read-only, and after the tabs: rows that focus on the same field are composed, and the
        // earlier row is applied last.
        "Shape (cond):",
        focusing(
          extraShape,
          cond<null, any, Either<number, string>, Either<number, string>>([
            PrismaticGadget(0, _Left<number, string>(), message<null, any, number>((_e, n) => "A number: " + showInt(n))),
            PrismaticGadget("", _Right<number, string>(), message<null, any, string>((_e, t) => "Some text: " + T.showText(t))),
          ]),
        ),
      ],
      [
        "Rows (click):",
        focusing(
          extraRows,
          scrolled(table([TableDelete, TableShuffle], [demoTableColumns[0], demoTableColumns[1]], Just(constantDialog(demoTableForm)))),
        ),
      ],
    ]),
  ),
);

// ---------------------------------------------------------------------------------------------
// The page

/** demo-webit `Main.choicePage`, with buttons that can be used repeatedly. */
async function choicePage(env: ElmerEnv): Promise<void> {
  logToStderr(env);
  const top = env.elmerTop;
  const heading = makeWebStatic(
    env,
    H.mconcat_Html([
      H.h2("Webits gadget interpreter"),
      H.p("The original demo-webit front page: each button renders gadgets through webits in this page."),
    ]),
  );
  showWebit(WebitClass_WebStatic, env, top, heading);
  // Status: the last messages.
  const statusLines: string[] = [];
  const status = makeWebit(
    J.textJ,
    env,
    () => H.with_(H.pre(""), HA.class_("demo-status")),
    (t, rv) => setWebitHtml(H.with_(H.pre(t), HA.class_("demo-status")), rv),
    "",
  );
  const report = (env1: ElmerEnv, msg: string): void => {
    elmerLog(env1, "NOTICE", msg);
    statusLines.unshift(msg);
    atomicallySync(() => status.webitIn(statusLines.slice(0, 6).join("\n")));
  };

  const btnBox = makeWebitContainer(env, "demo-row");
  const dialogBtn = choiceButton(env, "Dialog Demo");
  showWebit(WebitClass_Webit, env, btnBox, dialogBtn);
  const matrixBtn = choiceButton(env, "Matrix Demo");
  showWebit(WebitClass_Webit, env, btnBox, matrixBtn);
  const menuBtn = demoMenuButton(env, report); // Has its own event handler; not needed below.
  showWebit(WebitClass_WebitItem, env, btnBox, menuBtn);
  const forestBtn = choiceButton(env, "Forest Editor Demo");
  showWebit(WebitClass_Webit, env, btnBox, forestBtn);
  const imageBtn = choiceButton(env, "Clickable Image Demo");
  showWebit(WebitClass_Webit, env, btnBox, imageBtn);
  const moreBtn = choiceButton(env, "More Gadgets");
  showWebit(WebitClass_Webit, env, btnBox, moreBtn);
  showWebit(WebitClass_WebitContainer, env, top, btnBox);
  showWebit(WebitClass_Webit, env, top, status);

  const [initialModel, matrixKeys] = arbitraryMatrix(10);
  const [modelState, modelWriter] = newTStateIO<boolean, Model>(initialModel);

  // Set up dialog popup demo.
  const dialogTrigger = newTChanIO<readonly [null, DemoData]>();
  const demoDialogOut = mkWebitPopupSelect(env, pure_TState<boolean, DemoForest>(demoForest), constantDialog(demoDialog), () => readTChan(dialogTrigger));
  const d1 = atomicallySync(() => dupTChan(demoDialogOut));
  // Set up forest editing popup demo.
  const forestTrigger = newTChanIO<readonly [null, Forest<DemoData>]>();
  const demoForestData = arbitraryDemoForest(2);
  const demoForestOut = mkWebitPopupSelect(env, pure_TState<boolean, DemoForest>(demoForest), constantDialog(demoForestEditor), () => readTChan(forestTrigger));
  const f1 = atomicallySync(() => dupTChan(demoForestOut));
  // Set up the extra gadgets popup.
  const moreTrigger = newTChanIO<readonly [null, Extra]>();
  const moreOut = mkWebitPopupSelect(env, pure_TState<boolean, null>(null), constantDialog(extraDialog), () => readTChan(moreTrigger));

  // Respond to buttons
  let matrixShown = false;
  let imageShown = false;
  elmerDaemon(WebitClass_WebitContainer, env, btnBox, async (env1) => {
    const io = await atomically(() => {
      const fire = (w: Webit<string>, act: () => () => void): (() => () => void) => () => {
        const [, txt] = w.webitState.tStateEvent();
        console.debug(txt + " button clicked");
        return act();
      };
      const choices = [
        fire(dialogBtn, () => {
          writeTChan(dialogTrigger, [null, demoDefault]);
          return () => {};
        }),
        fire(matrixBtn, () => () => {
          if (!matrixShown) demoMatrixAction(env1, modelState, modelWriter, matrixKeys);
          matrixShown = true;
        }),
        fire(forestBtn, () => {
          writeTChan(forestTrigger, [null, demoForestData]);
          return () => {};
        }),
        fire(imageBtn, () => () => {
          if (!imageShown) demoImageAction(env1, report);
          imageShown = true;
        }),
        fire(moreBtn, () => {
          writeTChan(moreTrigger, [null, extraDefault]);
          return () => {};
        }),
      ];
      return choices.reduceRight<() => () => void>((acc, a) => () => orElseIO(a, acc), choices[choices.length - 1])();
    });
    io();
  });
  elmerDaemon(WebitClass_WebitContainer, env, top, async (env1) => {
    const [, r] = await atomically(() => readTChan(d1));
    report(env1, "Dialog output = " + (r.tag === "Just" ? prettyDemo(r.value) : "Nothing"));
  });
  elmerDaemon(WebitClass_WebitContainer, env, top, async (env1) => {
    const [, r] = await atomically(() => readTChan(f1));
    const tr = r.tag === "Just" ? drawForest(fmapForest((d: DemoData) => d._demoText, r.value)) : "Nothing";
    report(env1, "Forest edit output = \n" + tr);
  });
  elmerDaemon(WebitClass_WebitContainer, env, top, async (env1) => {
    const [, r] = await atomically(() => readTChan(moreOut));
    report(
      env1,
      "More gadgets output = " +
        (r.tag === "Just"
          ? JSON.stringify({ ...r.value, rows: r.value.rows.map(show_DemoTable) })
          : "Nothing"),
    );
  });

  const open = new URLSearchParams(location.search).get("open");
  const opener: Record<string, () => void> = {
    dialog: () => atomicallySync(() => writeTChan(dialogTrigger, [null, demoDefault])),
    matrix: () => {
      matrixShown = true;
      demoMatrixAction(env, modelState, modelWriter, matrixKeys);
    },
    forest: () => atomicallySync(() => writeTChan(forestTrigger, [null, demoForestData])),
    image: () => {
      imageShown = true;
      demoImageAction(env, report);
    },
    more: () => atomicallySync(() => writeTChan(moreTrigger, [null, extraDefault])),
  };
  if (open !== null && opener[open] !== undefined) opener[open]();
}

/** `a `orElse` b` for the button choices. */
function orElseIO<A>(a: () => A, b: () => A): A {
  return orElse(a, b);
}

/** demo-webit `Main.appHeader`, plus a little layout for the demo rows. */
const appHeader: H.Html = H.head(
  H.title("Demo Webits"),
  H.with_(H.link(), HA.rel("shortcut icon"), HA.type_("image/x-icon"), HA.href("/favicon.ico")),
  H.style(H.preEscapedText(".demo-row { margin: 8px 0; } .demo-row > * { display: inline-block; margin-right: 12px; } .demo-status { color: #333; background: #f4f4f4; padding: 6px; min-height: 2em; }")),
);

export async function main(): Promise<void> {
  const icons = mergeIconGroups([
    ...getIconData("/src/lib/GI/Gtk/icons"),
    ...getIconData("/src/dsm/share/Diametric/scalable"),
    ...getIconData("/src/hades/share/hicolor/48x48"),
  ]);
  elmerStatic(icons);
  await elmerScotty("/", appHeader, icons, choicePage);
}
