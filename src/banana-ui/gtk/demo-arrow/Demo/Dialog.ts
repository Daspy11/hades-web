// Ported from banana-ui/gtk/demo-arrow/Demo/Dialog.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The \"Demo Dialog\" of the @demo-arrow@ program: a record edited through a range with optional
 * limits, an enumeration combo box, a date, an optional text range, a table and a memo.
 *
 * TypeScript port
 * ---------------
 * * `MRange a` is the tuple type `MRange<A>`; @Integer@ is a JavaScript `number`.
 * * `def_DemoData()` is the `Default` instance. It is a function because the default date is
 *   today's date; as the Haskell CAF (`unsafePerformIO`) it is computed once, on first use.
 * * `show_DemoData` is the derived `Show` (used by the demo's `print`).
 * * `Ord`/`Show` constraints are structural (`validRange`); `mRangeGadget` takes the `Show` and
 *   `Read` instances explicitly and uses JavaScript arithmetic for `Num`.
 */
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { compare } from "@/lib/Data/Ord";
import * as T from "@/lib/Data/Text";
import type { Text } from "@/lib/Data/Text";
import { fromGregorian, getCurrentTime, showDay, utctDay, type Day } from "@/lib/Data/Time";
import { _1, _2, identity, lens, type Lens } from "@/lib/Control/Lens";
import { readInteger, showInt } from "@/lib/Prelude";
import { longDate } from "@/banana-ui/base/Reactive/Banana/Common";
import { TableAdd, TableDelete, TableShuffle } from "@/banana-ui/base/Reactive/Banana/Table";
import {
  Dialog, OkApplyButton, accum, boundedCombo, box, dateBox, focusing, focusingOver, form, frame, maybeTextBox,
  memoBox, optionalOver, readOnlyText, simpleFrame, simpleTextBox, table, validateTextOver,
  type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import {
  blankTableRow, demoEnumValues, demoTableSpec, show_DemoEnum, show_TableData, testTable, type DemoEnum,
  type TableData,
} from "./Table";


/** `type MRange a = (Maybe a, Maybe a)` */
export type MRange<A> = readonly [Maybe<A>, Maybe<A>];


export interface DemoData {
  readonly _demoRange: MRange<number>;
  readonly _demoEnum: DemoEnum;
  readonly _demoTextRange: Maybe<readonly [Text, Text]>;
  readonly _demoDate: Day;
  readonly _demoTable: readonly TableData[];
  readonly _demoComment: Text;
}
export function DemoData(
  _demoRange: MRange<number>,
  _demoEnum: DemoEnum,
  _demoTextRange: Maybe<readonly [Text, Text]>,
  _demoDate: Day,
  _demoTable: readonly TableData[],
  _demoComment: Text,
): DemoData {
  return { _demoRange, _demoEnum, _demoTextRange, _demoDate, _demoTable, _demoComment };
}

/** `showsPrec d` of an @Integer@: negative numbers are parenthesised above precedence 6. */
function showsPrecInteger(d: number, n: number): string {
  return n < 0 && d > 6 ? "(" + showInt(n) + ")" : showInt(n);
}

/** `showsPrec d` of a @Maybe@. */
function showsPrecMaybe<A>(d: number, showsPrecA: (d: number, a: A) => string, m: Maybe<A>): string {
  if (m.tag === "Nothing") return "Nothing";
  const s = "Just " + showsPrecA(11, m.value);
  return d > 10 ? "(" + s + ")" : s;
}

/** Derived `Show DemoData` (record syntax, as shown at precedence 0). */
export function show_DemoData(v: DemoData): string {
  const [r1, r2] = v._demoRange;
  return "DemoData {_demoRange = (" + showsPrecMaybe(0, showsPrecInteger, r1) + "," + showsPrecMaybe(0, showsPrecInteger, r2) + ")" +
    ", _demoEnum = " + show_DemoEnum(v._demoEnum) +
    ", _demoTextRange = " + showsPrecMaybe(0, (_d, [t1, t2]: readonly [Text, Text]) => "(" + T.showText(t1) + "," + T.showText(t2) + ")", v._demoTextRange) +
    ", _demoDate = " + showDay(v._demoDate) +
    ", _demoTable = [" + v._demoTable.map(show_TableData).join(",") + "]" +
    ", _demoComment = " + T.showText(v._demoComment) + "}";
}

let defDemoData: DemoData | undefined;

/**
 * `instance Default DemoData`.
 *
 * The date is today's (UTC) date. In Haskell @today@ is an @unsafePerformIO@ CAF, so it is
 * evaluated once; the value is likewise computed on the first call and then kept.
 */
export function def_DemoData(): DemoData {
  if (defDemoData === undefined) {
    const today: Day = utctDay(getCurrentTime());
    defDemoData = DemoData([Nothing, Nothing], "Foo", Just(["", ""] as const), today, [], "");
  }
  return defDemoData;
}


export const demoRange: Lens<DemoData, MRange<number>> = lens((s) => s._demoRange, (s, x) => ({ ...s, _demoRange: x }));

export const demoEnum: Lens<DemoData, DemoEnum> = lens((s) => s._demoEnum, (s, x) => ({ ...s, _demoEnum: x }));

export const demoTextRange: Lens<DemoData, Maybe<readonly [Text, Text]>> =
  lens((s) => s._demoTextRange, (s, x) => ({ ...s, _demoTextRange: x }));

export const demoDate: Lens<DemoData, Day> = lens((s) => s._demoDate, (s, x) => ({ ...s, _demoDate: x }));

export const demoTable: Lens<DemoData, readonly TableData[]> = lens((s) => s._demoTable, (s, x) => ({ ...s, _demoTable: x }));

export const demoComment: Lens<DemoData, Text> = lens((s) => s._demoComment, (s, x) => ({ ...s, _demoComment: x }));


/** TypeScript: the `Ord a` and `Show a` constraints are structural (`compare`). */
export function validRange<A>([v1, v2]: readonly [Maybe<A>, Maybe<A>]): Maybe<Text> {
  // Maybe monad: Nothing unless both limits are present.
  if (v1.tag === "Nothing") return Nothing;
  const v1a = v1.value;
  if (v2.tag === "Nothing") return Nothing;
  const v2a = v2.value;
  return compare(v1a, v2a) > 0 ? Just("Invalid range") : Nothing;
}


/**
 * An optional range. First must be less than or equal to second.
 *
 * TypeScript: the `Show a` and `Read a` instances are passed explicitly; `Num a` is JavaScript
 * arithmetic on `number` and `Ord a` is structural.
 *
 * As in the original, the \"Range size\" display is focused with @id@ inside the form, so (see
 * `mergeOutputs` in "Reactive.Banana.GI.ArrowDialog") its unchanged value is merged into every
 * edit of the bounds, which are therefore discarded.
 */
export function mRangeGadget(show: (a: number) => string, read: (s: Text) => Maybe<number>): GadgetF_<null, null, MRange<number>> {
  return validateTextOver(validRange, form<null, null, MRange<number>>("Vertical", [
    ["Lower bound:", focusing(_1<Maybe<number>, Maybe<number>>(), maybeTextBox<null, null, number>(show, read))],
    ["Upper bound:", focusing(_2<Maybe<number>, Maybe<number>>(), maybeTextBox<null, null, number>(show, read))],
    ["Range size:", focusing(identity<MRange<number>>(), readOnlyText<null, null, MRange<number>>((_: null, [mv1, mv2]) =>
      mv1.tag === "Just" && mv2.tag === "Just" ? T.pack(show(mv2.value - mv1.value)) : ""))],
  ]));
}


export const demoDialog: Dialog<null, null, DemoData, DemoData> = (() => {
  const validTextRange = ([t1, t2]: readonly [Text, Text]): Maybe<Text> =>
    compare(T.toCaseFold(t1), T.toCaseFold(t2)) > 0 ? Just("Invalid text range.") : Nothing;
  return Dialog("Demo Dialog", OkApplyButton, accum(box<null, null, DemoData>("Vertical", [[
    frame((_: DemoData) => Just("Numerical range with optional limits"),
      focusingOver(demoRange, mRangeGadget(showInt, readInteger))),
    form<null, null, DemoData>("Vertical", [
      ["Foo Selection:", focusing(demoEnum, boundedCombo<null, null, DemoEnum>(demoEnumValues, show_DemoEnum))],
      ["Date:", focusing(demoDate, dateBox<null, null>(longDate))],
    ]),
    simpleFrame("Optional text range",
      focusingOver(demoTextRange,
        optionalOver<null, null, readonly [Text, Text], readonly [Text, Text]>(["", ""],
          validateTextOver(validTextRange,
            form<null, null, readonly [Text, Text]>("Horizontal", [
              ["Lower bound:", focusing(_1<Text, Text>(), simpleTextBox<null, null>())],
              ["Upper bound:", focusing(_2<Text, Text>(), simpleTextBox<null, null>())],
            ]))))),
    focusing(demoTable,
      table<null, null, TableData>([TableAdd("row", blankTableRow), TableDelete, TableShuffle], demoTableSpec, Nothing)),
    focusing(demoComment, memoBox<null, null>("MemoMedium", true)),
  ]])));
})();


export const initialValue: DemoData = DemoData(
  [Nothing, Just(5)],
  "Wibble",
  Just(["alpha", "Omega"] as const),
  fromGregorian(2018, 3, 12),
  testTable,
  "This is the default.",
);

export const testValues: readonly DemoData[] = [
  DemoData(
    [Just(2), Just(6)],
    "Foo",
    Just(["", "ZZZ"] as const),
    fromGregorian(2000, 1, 1),
    [],
    "The Foo Value.",
  ),
  DemoData(
    [Just(5), Nothing],
    "Bar",
    Just(["run", "Wimbledon"] as const),
    fromGregorian(2010, 1, 1),
    testTable,
    "The Bar Value.",
  ),
];
