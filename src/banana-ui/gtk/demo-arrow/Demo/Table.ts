// Ported from banana-ui/gtk/demo-arrow/Demo/Table.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Table data for the @demo-arrow@ program: a row type with one field for each kind of table
 * column editor, the table specification and some test rows.
 *
 * TypeScript port
 * ---------------
 * * `DemoEnum` is a string enumeration with `demoEnumValues` (its `Bounded`/`Enum` dictionary),
 *   `show_DemoEnum`, `read_DemoEnum` and `compare_DemoEnum` (the derived `Ord`).
 * * `TableData` derives `Eq` (structural `equals`) and `Show` (`show_TableData`).
 */
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { enumComparator, type Comparator } from "@/lib/Data/Ord";
import { fromGregorian, showDay, type Day } from "@/lib/Data/Time";
import { lens, identity, type Lens } from "@/lib/Control/Lens";
import { readEnum, showInt } from "@/lib/Prelude";
import { showText, type Text } from "@/lib/Data/Text";
import { Colour, shortDate, show_Colour, textPrismInt } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  EditColour, EditCombo, EditDate, EditEntry, EditIcon, allValues, enumField, mkField, type Table,
} from "@/banana-ui/base/Reactive/Banana/Table";

/** `data DemoEnum = Foo | Bar | Baz | Wibble | Woo deriving (Eq, Ord, Bounded, Enum, Show, Read)` */
export type DemoEnum = "Foo" | "Bar" | "Baz" | "Wibble" | "Woo";
/** `[minBound .. maxBound] :: [DemoEnum]` */
export const demoEnumValues: readonly DemoEnum[] = ["Foo", "Bar", "Baz", "Wibble", "Woo"];

/** Derived `Show DemoEnum`. */
export function show_DemoEnum(x: DemoEnum): string {
  return x;
}

/** Derived `Read DemoEnum` (`readMaybe`). */
export function read_DemoEnum(s: string): Maybe<DemoEnum> {
  return readEnum(demoEnumValues, s);
}

/** Derived `Ord DemoEnum` (constructor order). */
export const compare_DemoEnum: Comparator<DemoEnum> = enumComparator(demoEnumValues);

export function enumColour(x: DemoEnum): Colour {
  switch (x) {
    case "Foo": return Colour(C.coral);
    case "Bar": return Colour(C.gray);
    case "Baz": return Colour(C.indigo);
    case "Wibble": return Colour(C.mediumspringgreen);
    case "Woo": return Colour(C.salmon);
  }
}

export function enumIcon(x: DemoEnum): Text {
  switch (x) {
    case "Foo": return "weather-clear";
    case "Bar": return "weather-clear-night";
    case "Baz": return "weather-few-clouds";
    case "Wibble": return "weather-showers";
    case "Woo": return "weather-overcast";
  }
}

export interface TableData {
  readonly _tableText: Text;
  readonly _tableNum: number;
  readonly _tableEnum: DemoEnum;
  readonly _tableDate: Day;
  readonly _tableColour: Colour;
  readonly _tableIcon: Text;
  readonly _tableCombo: Text;
}
export function TableData(
  _tableText: Text,
  _tableNum: number,
  _tableEnum: DemoEnum,
  _tableDate: Day,
  _tableColour: Colour,
  _tableIcon: Text,
  _tableCombo: Text,
): TableData {
  return { _tableText, _tableNum, _tableEnum, _tableDate, _tableColour, _tableIcon, _tableCombo };
}

/** Derived `Show TableData` (record syntax, as shown at precedence 0). */
export function show_TableData(t: TableData): string {
  return "TableData {_tableText = " + showText(t._tableText) +
    ", _tableNum = " + showInt(t._tableNum) +
    ", _tableEnum = " + show_DemoEnum(t._tableEnum) +
    ", _tableDate = " + showDay(t._tableDate) +
    ", _tableColour = " + show_Colour(t._tableColour) +
    ", _tableIcon = " + showText(t._tableIcon) +
    ", _tableCombo = " + showText(t._tableCombo) + "}";
}

export const tableText: Lens<TableData, Text> = lens((s) => s._tableText, (s, t) => ({ ...s, _tableText: t }));

export const tableNum: Lens<TableData, number> = lens((s) => s._tableNum, (s, n) => ({ ...s, _tableNum: n }));

export const tableEnum: Lens<TableData, DemoEnum> = lens((s) => s._tableEnum, (s, e) => ({ ...s, _tableEnum: e }));

export const tableDate: Lens<TableData, Day> = lens((s) => s._tableDate, (s, d) => ({ ...s, _tableDate: d }));

export const tableColour: Lens<TableData, Colour> = lens((s) => s._tableColour, (s, c) => ({ ...s, _tableColour: c }));

export const tableIcon: Lens<TableData, Text> = lens((s) => s._tableIcon, (s, i) => ({ ...s, _tableIcon: i }));

export const tableCombo: Lens<TableData, Text> = lens((s) => s._tableCombo, (s, c) => ({ ...s, _tableCombo: c }));


export const blankTableRow: TableData = TableData("", 0, "Foo", fromGregorian(2000, 1, 1), Colour(C.white), "", "");


export const comboOptions: readonly Text[] = ["One", "Two", "Three", "Four", "Five"];


export const demoTableSpec: Table<TableData> = (() => {
  const numIcon = (n: number): Text => {
    if (n < 25) return "face-sad";
    else if (n < 50) return "face-plain";
    else if (n < 75) return "face-smile";
    else return "face-smile-big";
  };
  const numColour = (n: number): Colour => {
    if (n < 0) return Colour(C.red);
    else if (n < 100) return Colour(C.blend(n / 100, C.green, C.red));
    else return Colour(C.green);
  };
  return [
    mkField<TableData, Text>("Text", tableText, Nothing, EditEntry(identity<Text>()), Nothing),
    mkField<TableData, number>("Number", tableNum, Just(numIcon), EditEntry(textPrismInt), Just(numColour)),
    mkField<TableData, DemoEnum>("Enumeration", tableEnum, Just(enumIcon), enumField(allValues(demoEnumValues), show_DemoEnum), Just(enumColour)),
    mkField<TableData, Day>("Date", tableDate, Nothing, EditDate(shortDate), Nothing),
    mkField<TableData, Colour>("Colour", tableColour, Nothing, EditColour, Nothing),
    mkField<TableData, Text>("Icon", tableIcon, Nothing, EditIcon((_: Text) => true), Nothing),
    mkField<TableData, Text>("Combo", tableCombo, Nothing, EditCombo(comboOptions), Nothing),
  ];
})();


export const testTable: readonly TableData[] = [
  TableData("One row", 23, "Wibble", fromGregorian(2016, 6, 24), Colour(C.red), "go-home", "One"),
  TableData("Second row", 74, "Baz", fromGregorian(2017, 7, 25), Colour(C.blue), "", "Two"),
  TableData("Third row", 92, "Bar", fromGregorian(2018, 8, 26), Colour(C.green), "", ""),
];
