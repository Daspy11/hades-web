// Ported from banana-ui/webits/demo-webit/Types.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Data types edited by the @demo-webit@ program, their lenses, the default demo value, and
 * QuickCheck generators for random demo data.
 *
 * TypeScript port
 * ---------------
 * * `DemoEnum` is a string enumeration (`demoEnumValues`, `show_DemoEnum`, `read_DemoEnum`,
 *   `compare_DemoEnum` for the derived `Ord`). `DemoTable` and `DemoData` are records with the
 *   Haskell field names and constructor functions; their derived `Show` instances are
 *   `show_DemoTable` and `show_DemoData`, and `Eq` is the structural `equals`.
 * * QuickCheck is `@/lib/Test/QuickCheck` (`QC`): a `Gen a` is a function of the random generator
 *   and the size; the `Arbitrary` instances are the dictionaries `Arbitrary_DemoEnum`,
 *   `Arbitrary_DemoTable` and `Arbitrary_DemoData`.
 * * Web: the @unsafePerformIO@ constants `iconList` and `wordsList` read files from the author's
 *   home directory. Here they are module constants read from the bundled data: the Diametric
 *   icon theme of the DSM package (`src/dsm/share/Diametric`) and the @words.txt@ data file of
 *   the webits package.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as C from "@/lib/Data/Colour";
import * as QC from "@/lib/Test/QuickCheck";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { enumComparator, type Comparator } from "@/lib/Data/Ord";
import { addDays, fromGregorian, showDay, type Day } from "@/lib/Data/Time";
import { Node, type Forest } from "@/lib/Data/Tree";
import { lens, type Lens } from "@/lib/Control/Lens";
import { readEnum, showBool, showDouble, showInt } from "@/lib/Prelude";
import { getDataDir } from "@/lib/System/Paths";
import { Colour, show_Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { allIcons, getIconData, mergeIconGroups, type IconName } from "@/banana-ui/webits/src/Network/Webits/Icons";
// Web: the webits data file words.txt stands in for "/home/paj/.local/share/words.txt".
import wordsTxt from "@/banana-ui/webits/words.txt?raw";

export type DemoEnum = "Foo" | "Bar" | "Baz" | "Wibble" | "Woo";
/** `[minBound .. maxBound] :: [DemoEnum]` (`Bounded`, `Enum`). */
export const demoEnumValues: readonly DemoEnum[] = ["Foo", "Bar", "Baz", "Wibble", "Woo"];

/** Derived `Show DemoEnum`. */
export function show_DemoEnum(x: DemoEnum): string {
  return x;
}

/** Derived `Read DemoEnum` (as `readMaybe`). */
export function read_DemoEnum(s: string): Maybe<DemoEnum> {
  return readEnum(demoEnumValues, s);
}

/** Derived `Ord DemoEnum`. */
export const compare_DemoEnum: Comparator<DemoEnum> = enumComparator(demoEnumValues);

/** `instance Arbitrary DemoEnum` */
export const Arbitrary_DemoEnum: QC.Arbitrary<DemoEnum> = {
  arbitrary: QC.elements<DemoEnum>(["Foo", "Bar", "Baz", "Wibble", "Woo"]), // [Foo .. Woo]
  shrink: QC.shrinkNothing,
};

export interface DemoTable {
  readonly _boolField: boolean;
  readonly _numberField: number;
  readonly _iconField: IconName;
}
export function DemoTable(_boolField: boolean, _numberField: number, _iconField: IconName): DemoTable {
  return { _boolField, _numberField, _iconField };
}

/** Derived `Show DemoTable` (record syntax, as shown at precedence 0). */
export function show_DemoTable(t: DemoTable): string {
  return (
    "DemoTable {_boolField = " + showBool(t._boolField) +
    ", _numberField = " + showDouble(t._numberField) +
    ", _iconField = " + T.showText(t._iconField) + "}"
  );
}

/** `instance Arbitrary DemoTable` */
export const Arbitrary_DemoTable: QC.Arbitrary<DemoTable> = {
  // DemoTable <$> arbitrary <*> arbitrary <*> arbitraryIcon
  arbitrary: (r, n) => {
    const b = QC.Arbitrary_Bool.arbitrary(r, n);
    const x = QC.Arbitrary_Double.arbitrary(r, n);
    return DemoTable(b, x, arbitraryIcon(r, n));
  },
  shrink: QC.shrinkNothing,
};

export const boolField: Lens<DemoTable, boolean> = lens((s) => s._boolField, (s, v) => ({ ...s, _boolField: v }));

export const numberField: Lens<DemoTable, number> = lens((s) => s._numberField, (s, v) => ({ ...s, _numberField: v }));

export const iconField: Lens<DemoTable, IconName> = lens((s) => s._iconField, (s, v) => ({ ...s, _iconField: v }));


export interface DemoData {
  readonly _demoText: T.Text;
  readonly _demoNum: number;
  readonly _demoEnum: DemoEnum;
  readonly _demoBool: boolean;
  readonly _demoDate: Day;
  readonly _demoIcon: T.Text;
  readonly _demoColour: Colour;
  readonly _demoSet: S.Set<number>;
  readonly _demoTable: readonly DemoTable[];
}
export function DemoData(
  _demoText: T.Text,
  _demoNum: number,
  _demoEnum: DemoEnum,
  _demoBool: boolean,
  _demoDate: Day,
  _demoIcon: T.Text,
  _demoColour: Colour,
  _demoSet: S.Set<number>,
  _demoTable: readonly DemoTable[],
): DemoData {
  return { _demoText, _demoNum, _demoEnum, _demoBool, _demoDate, _demoIcon, _demoColour, _demoSet, _demoTable };
}

/** Derived `Show DemoData` (record syntax, as shown at precedence 0). */
export function show_DemoData(d: DemoData): string {
  return (
    "DemoData {_demoText = " + T.showText(d._demoText) +
    ", _demoNum = " + showInt(d._demoNum) +
    ", _demoEnum = " + show_DemoEnum(d._demoEnum) +
    ", _demoBool = " + showBool(d._demoBool) +
    ", _demoDate = " + showDay(d._demoDate) +
    ", _demoIcon = " + T.showText(d._demoIcon) +
    ", _demoColour = " + show_Colour(d._demoColour) +
    ", _demoSet = fromList [" + S.toList(d._demoSet).map((n) => showInt(n)).join(",") + "]" +
    ", _demoTable = [" + d._demoTable.map(show_DemoTable).join(",") + "]}"
  );
}

/** `instance Arbitrary DemoData` */
export const Arbitrary_DemoData: QC.Arbitrary<DemoData> = {
  // DemoData <$> arbitraryText 5 <*> arbitrary <*> arbitrary <*> arbitrary <*>
  //     arbitraryDay <*> arbitraryIcon <*> arbitraryColour <*> arbitrary <*> arbitrary
  arbitrary: (r, n) => {
    const txt = arbitraryText(5)(r, n);
    const num = QC.Arbitrary_Integer.arbitrary(r, n);
    const enm = Arbitrary_DemoEnum.arbitrary(r, n);
    const bool = QC.Arbitrary_Bool.arbitrary(r, n);
    const day = arbitraryDay(r, n);
    const ic = arbitraryIcon(r, n);
    const clr = arbitraryColour(r, n);
    const set = QC.Arbitrary_Set(QC.Arbitrary_Int).arbitrary(r, n);
    const tbl = QC.Arbitrary_List(Arbitrary_DemoTable).arbitrary(r, n);
    return DemoData(txt, num, enm, bool, day, ic, clr, set, tbl);
  },
  shrink: QC.shrinkNothing,
};


export const demoDefault: DemoData = {
  _demoText: "Foo! This is a ridiculously long line to put in a text box." + " It ought to be a paragraph!",
  _demoNum: 5,
  _demoEnum: "Bar",
  _demoBool: false,
  _demoDate: fromGregorian(2021, 8, 1),
  _demoIcon: "basic_checked",
  _demoColour: Colour(C.aqua),
  _demoSet: S.fromList([1, 21, 13]),
  _demoTable: [
    DemoTable(true, 3.14159, "computer-about"),
    DemoTable(false, 4, "general-car"),
    DemoTable(true, 5, "emoji-happy-1"),
  ],
};

export const demoText: Lens<DemoData, T.Text> = lens((s) => s._demoText, (s, v) => ({ ...s, _demoText: v }));

export const demoNum: Lens<DemoData, number> = lens((s) => s._demoNum, (s, v) => ({ ...s, _demoNum: v }));

export const demoEnum: Lens<DemoData, DemoEnum> = lens((s) => s._demoEnum, (s, v) => ({ ...s, _demoEnum: v }));

export const demoBool: Lens<DemoData, boolean> = lens((s) => s._demoBool, (s, v) => ({ ...s, _demoBool: v }));

export const demoDate: Lens<DemoData, Day> = lens((s) => s._demoDate, (s, v) => ({ ...s, _demoDate: v }));

export const demoIcon: Lens<DemoData, T.Text> = lens((s) => s._demoIcon, (s, v) => ({ ...s, _demoIcon: v }));

export const demoColour: Lens<DemoData, Colour> = lens((s) => s._demoColour, (s, v) => ({ ...s, _demoColour: v }));

export const demoSet: Lens<DemoData, S.Set<number>> = lens((s) => s._demoSet, (s, v) => ({ ...s, _demoSet: v }));

export const demoTable: Lens<DemoData, readonly DemoTable[]> = lens((s) => s._demoTable, (s, v) => ({ ...s, _demoTable: v }));



export function prettyDemo(d: DemoData): string {
  return (
    "DemoData {\n" +
    "   demoText: " + T.showText(d._demoText) + "\n" +
    "   demoNum: " + showInt(d._demoNum) + "\n" +
    "   demoEnum: " + show_DemoEnum(d._demoEnum) + "\n" +
    "   demoBool: " + showBool(d._demoBool) + "\n" +
    "   demoDate: " + showDay(d._demoDate) + "\n" +
    "   demoIcon: " + T.showText(d._demoIcon) + "\n" +
    "   demoColour: " + show_Colour(d._demoColour) + "\n" +
    "   demoSet: {" + S.toList(d._demoSet).map((n) => showInt(n)).join(", ") + "}\n" +
    "   demoTable: [\n" + d._demoTable.map((t) => "       " + show_DemoTable(t) + "\n").join("") + "   ]\n" +
    "}"
  );
}

/** (TypeScript only) The items of `demoForest`: name, tooltip and value. */
type DemoForestItem = readonly [T.Text, Maybe<T.Text>, Maybe<number>];

export const demoForest: Forest<DemoForestItem> = [
  Node<DemoForestItem>(["Item 1", Just("tooltip one"), Nothing], [
    Node<DemoForestItem>(["Item 1.1", Just("tooltip one point one"), Just(11)], []),
    Node<DemoForestItem>(["Thingy 1.2", Just("thingy is like an item"), Just(12)], []),
    Node<DemoForestItem>(["Itemised 1.3", Nothing, Just(13)], [
      Node<DemoForestItem>(["Final 1.3.1", Just("some tips"), Just(131)], []),
    ]),
  ]),
  Node<DemoForestItem>(["Item 2", Just("tooltip two"), Nothing], [
    Node<DemoForestItem>(["Item 2.1", Just("this is not item 1.2"), Just(21)], []),
    Node<DemoForestItem>(["Item 2.2", Just("invisible"), Nothing], []),
  ]),
];


/** A random RGB colour. */
export const arbitraryColour: QC.Gen<Colour> = (r, n) => {
  // Colour <$> (C.sRGB24 <$> arbitrary <*> arbitrary <*> arbitrary), at type Word8.
  const red = QC.Arbitrary_Word8.arbitrary(r, n);
  const green = QC.Arbitrary_Word8.arbitrary(r, n);
  const blue = QC.Arbitrary_Word8.arbitrary(r, n);
  return Colour(C.sRGB24(red, green, blue));
};


/** A random day in 2021. */
export const arbitraryDay: QC.Gen<Day> = (r, n) => {
  const b = fromGregorian(2021, 1, 1);
  const d = QC.choose([0, 364])(r, n);
  return addDays(d, b);
};


/** An arbitrary icon name. */
export const arbitraryIcon: QC.Gen<IconName> = (r, n) => QC.elements(iconList)(r, n);


/** A string of @n@ arbitrary common words. */
export function arbitraryText(n: number): QC.Gen<T.Text> {
  return QC.fmap_Gen((ws: T.Text[]) => T.unwords(ws), QC.vectorOf(n, QC.elements(wordsList)));
}


/**
 * Known icon names. Uses @unsafePerformIO@.
 *
 * Web: read from the bundled Diametric icon theme (`getDataDir("dsm")/Diametric/...`) instead of
 * the author's @\/home\/paj\/.local\/share\/hades\/Diametric\/...@.
 */
export const iconList: readonly IconName[] = (() => {
  const icons1 = getIconData(getDataDir("dsm") + "/Diametric/scalable/");
  const icons2 = getIconData(getDataDir("dsm") + "/Diametric/48x48");
  return M.keys(allIcons(mergeIconGroups([...icons1, ...icons2])));
})();


/** Most common 1000 words in English. Uses @unsafePerfromIO@. (Web: the bundled @words.txt@.) */
export const wordsList: readonly T.Text[] = T.lines(wordsTxt);
