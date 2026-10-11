/**
 * Haskell `Codec.Xlsx` (the `xlsx` package) replacement: the data model of an Excel workbook.
 *
 * Only the parts of the data model used by HADES are defined so far: the sheets of a workbook,
 * its date base, and the values of worksheet cells. Field and lens names follow the Haskell
 * library (`_xlSheets`/`xlSheets`, `_wsCells`/`wsCells`, `_cellValue`/`cellValue`, ...).
 * Further fields (styles, column properties, formatted cells, ...) and the file reader and writer
 * (`toXlsx`, `fromXlsx`) can be added here as the modules that need them are ported.
 *
 * Representation follows PORTING.md: records are readonly interfaces with constructor functions,
 * `CellValue` is a tagged union, `ErrorType` and `DateBase` are string enumerations, and a
 * `CellMap` is a map keyed by `[row, column]` pairs (both 1-based, as in the Haskell library).
 */
import * as M from "../Data/Map";
import { Nothing, type Maybe } from "../Data/Maybe";
import { lens, type Lens } from "../Control/Lens";

/** Row index (1-based). */
export type RowIndex = number;
/** Column index (1-based). */
export type ColumnIndex = number;

/** Excel error values. */
export type ErrorType =
  | "ErrorDiv0"
  | "ErrorNA"
  | "ErrorName"
  | "ErrorNull"
  | "ErrorNum"
  | "ErrorRef"
  | "ErrorValue";
export const errorTypeValues: readonly ErrorType[] = [
  "ErrorDiv0", "ErrorNA", "ErrorName", "ErrorNull", "ErrorNum", "ErrorRef", "ErrorValue",
];

/** A run of rich text. Run properties (fonts etc.) are not modelled; they are kept opaque. */
export interface RichTextRun {
  readonly _richTextRunProperties: Maybe<unknown>;
  readonly _richTextRunText: string;
}
export function RichTextRun(_richTextRunProperties: Maybe<unknown>, _richTextRunText: string): RichTextRun {
  return { _richTextRunProperties, _richTextRunText };
}
export const richTextRunText: Lens<RichTextRun, string> =
  lens((r) => r._richTextRunText, (r, t) => ({ ...r, _richTextRunText: t }));

/** Cell values include text, numbers, booleans, rich text and errors. */
export type CellValue =
  | { readonly tag: "CellText"; readonly _0: string }
  | { readonly tag: "CellDouble"; readonly _0: number }
  | { readonly tag: "CellBool"; readonly _0: boolean }
  | { readonly tag: "CellRich"; readonly _0: readonly RichTextRun[] }
  | { readonly tag: "CellError"; readonly _0: ErrorType };
export function CellText(_0: string): CellValue {
  return { tag: "CellText", _0 };
}
export function CellDouble(_0: number): CellValue {
  return { tag: "CellDouble", _0 };
}
export function CellBool(_0: boolean): CellValue {
  return { tag: "CellBool", _0 };
}
export function CellRich(_0: readonly RichTextRun[]): CellValue {
  return { tag: "CellRich", _0 };
}
export function CellError(_0: ErrorType): CellValue {
  return { tag: "CellError", _0 };
}

/** A worksheet cell: its style index and value. */
export interface Cell {
  readonly _cellStyle: Maybe<number>;
  readonly _cellValue: Maybe<CellValue>;
}
export function Cell(_cellStyle: Maybe<number>, _cellValue: Maybe<CellValue>): Cell {
  return { _cellStyle, _cellValue };
}
/** `instance Default Cell`: no style and no value. */
export const def_Cell: Cell = Cell(Nothing, Nothing);
export const cellStyle: Lens<Cell, Maybe<number>> =
  lens((c) => c._cellStyle, (c, s) => ({ ...c, _cellStyle: s }));
export const cellValue: Lens<Cell, Maybe<CellValue>> =
  lens((c) => c._cellValue, (c, v) => ({ ...c, _cellValue: v }));

/** Cells keyed by (row, column). */
export type CellMap = M.Map<readonly [RowIndex, ColumnIndex], Cell>;

/** A worksheet. */
export interface Worksheet {
  readonly _wsCells: CellMap;
}
export function Worksheet(_wsCells: CellMap): Worksheet {
  return { _wsCells };
}
/** `instance Default Worksheet`: an empty sheet. */
export const def_Worksheet: Worksheet = Worksheet(M.empty());
export const wsCells: Lens<Worksheet, CellMap> =
  lens((w) => w._wsCells, (w, c) => ({ ...w, _wsCells: c }));

/**
 * The base date of a workbook's date serial numbers. Day 0 is 1899-12-30 for `DateBase1900`
 * (accounting for the Lotus 1-2-3 leap year bug) and 1904-01-01 for `DateBase1904`.
 */
export type DateBase = "DateBase1900" | "DateBase1904";
export const dateBaseValues: readonly DateBase[] = ["DateBase1900", "DateBase1904"];

/** An Excel workbook: named worksheets in order, and the date base. */
export interface Xlsx {
  readonly _xlSheets: readonly (readonly [string, Worksheet])[];
  readonly _xlDateBase: DateBase;
}
export function Xlsx(_xlSheets: readonly (readonly [string, Worksheet])[], _xlDateBase: DateBase): Xlsx {
  return { _xlSheets, _xlDateBase };
}
/** `instance Default Xlsx` (`def`, also `emptyXlsx`). */
export const def_Xlsx: Xlsx = Xlsx([], "DateBase1900");
export const emptyXlsx = def_Xlsx;
export const xlSheets: Lens<Xlsx, readonly (readonly [string, Worksheet])[]> =
  lens((x) => x._xlSheets, (x, s) => ({ ...x, _xlSheets: s }));
export const xlDateBase: Lens<Xlsx, DateBase> =
  lens((x) => x._xlDateBase, (x, d) => ({ ...x, _xlDateBase: d }));
