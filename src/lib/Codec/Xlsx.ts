/**
 * Haskell `Codec.Xlsx` (the `xlsx` package) replacement: the data model of an Excel workbook, and
 * the `.xlsx` reader (`toXlsxEither`) and writer (`fromXlsx`).
 *
 * Only the parts of the data model used by HADES are defined: the sheets of a workbook, its
 * styles (kept as raw `styles.xml`, as in the Haskell library), defined names, its date base,
 * worksheet cells (values, styles and formulas), column properties, row properties and merged
 * ranges. Field and lens names follow the Haskell library (`_xlSheets`/`xlSheets`,
 * `_wsCells`/`wsCells`, `_cellValue`/`cellValue`, ...). Formatted cells and style sheets are in
 * `./Xlsx/Formatted.ts` (Haskell `Codec.Xlsx.Formatted`).
 *
 * Representation follows PORTING.md: records are readonly interfaces with constructor functions,
 * `CellValue` is a tagged union, `ErrorType` and `DateBase` are string enumerations, and a
 * `CellMap` is a map keyed by `[row, column]` pairs (both 1-based, as in the Haskell library).
 *
 * The zip container is handled with `fflate`'s synchronous API, so that reading and writing stay
 * pure functions as in Haskell. XML is parsed with the browser `DOMParser`.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import * as M from "../Data/Map";
import { Just, Nothing, type Maybe } from "../Data/Maybe";
import { Left, Right, type Either } from "../Data/Either";
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
const errorTypeText: Record<ErrorType, string> = {
  ErrorDiv0: "#DIV/0!",
  ErrorNA: "#N/A",
  ErrorName: "#NAME?",
  ErrorNull: "#NULL!",
  ErrorNum: "#NUM!",
  ErrorRef: "#REF!",
  ErrorValue: "#VALUE!",
};

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

/** `newtype Formula = Formula { unFormula :: Text }` (erased). */
export type Formula = string;
export function Formula(t: string): Formula {
  return t;
}
export function unFormula(f: Formula): string {
  return f;
}

/** Shared formula index. */
export type SharedFormulaIndex = number;

/** The expression of a formula: normal, or a reference to a shared formula. */
export type FormulaExpression =
  | { readonly tag: "NormalFormula"; readonly _0: Formula }
  | { readonly tag: "SharedFormula"; readonly _0: SharedFormulaIndex };
export function NormalFormula(_0: Formula): FormulaExpression {
  return { tag: "NormalFormula", _0 };
}
export function SharedFormula(_0: SharedFormulaIndex): FormulaExpression {
  return { tag: "SharedFormula", _0 };
}

/** A cell formula: the expression, whether it assigns to a name, and whether to recalculate. */
export interface CellFormula {
  readonly _cellfExpression: FormulaExpression;
  readonly _cellfAssignsToName: boolean;
  readonly _cellfCalculate: boolean;
}
export function CellFormula(_cellfExpression: FormulaExpression, _cellfAssignsToName: boolean, _cellfCalculate: boolean): CellFormula {
  return { _cellfExpression, _cellfAssignsToName, _cellfCalculate };
}
/** `simpleCellFormula`: a normal formula that is neither a name assignment nor recalculated. */
export function simpleCellFormula(t: string): CellFormula {
  return CellFormula(NormalFormula(t), false, false);
}

/** A worksheet cell: its style index, value, comment and formula. */
export interface Cell {
  readonly _cellStyle: Maybe<number>;
  readonly _cellValue: Maybe<CellValue>;
  readonly _cellComment: Maybe<unknown>;
  readonly _cellFormula: Maybe<CellFormula>;
}
export function Cell(
  _cellStyle: Maybe<number>,
  _cellValue: Maybe<CellValue>,
  _cellComment: Maybe<unknown> = Nothing,
  _cellFormula: Maybe<CellFormula> = Nothing,
): Cell {
  return { _cellStyle, _cellValue, _cellComment, _cellFormula };
}
/** `instance Default Cell`: no style, value, comment or formula. */
export const def_Cell: Cell = Cell(Nothing, Nothing);
export const cellStyle: Lens<Cell, Maybe<number>> =
  lens((c) => c._cellStyle, (c, s) => ({ ...c, _cellStyle: s }));
export const cellValue: Lens<Cell, Maybe<CellValue>> =
  lens((c) => c._cellValue, (c, v) => ({ ...c, _cellValue: v }));
export const cellComment: Lens<Cell, Maybe<unknown>> =
  lens((c) => c._cellComment, (c, v) => ({ ...c, _cellComment: v }));
export const cellFormula: Lens<Cell, Maybe<CellFormula>> =
  lens((c) => c._cellFormula, (c, v) => ({ ...c, _cellFormula: v }));

/** Cells keyed by (row, column). */
export type CellMap = M.Map<readonly [RowIndex, ColumnIndex], Cell>;

/** Column properties for a range of columns. */
export interface ColumnsProperties {
  readonly cpMin: number;
  readonly cpMax: number;
  readonly cpWidth: Maybe<number>;
  readonly cpStyle: Maybe<number>;
  readonly cpHidden: boolean;
  readonly cpCollapsed: boolean;
  readonly cpBestFit: boolean;
}
/** Record construction `ColumnsProperties { cpMin = .., ... }`. */
export function ColumnsProperties(r: ColumnsProperties): ColumnsProperties {
  return { ...r };
}

/** Row height: `CustomHeight` (set by the user) or `AutomaticHeight`. */
export type RowHeight =
  | { readonly tag: "CustomHeight"; readonly _0: number }
  | { readonly tag: "AutomaticHeight"; readonly _0: number };
export function CustomHeight(_0: number): RowHeight {
  return { tag: "CustomHeight", _0 };
}
export function AutomaticHeight(_0: number): RowHeight {
  return { tag: "AutomaticHeight", _0 };
}

/** Row properties (`RowProps`). */
export interface RowProperties {
  readonly rowHeight: Maybe<RowHeight>;
  readonly rowStyle: Maybe<number>;
  readonly rowHidden: boolean;
}
export function RowProps(rowHeight: Maybe<RowHeight>, rowStyle: Maybe<number>, rowHidden: boolean): RowProperties {
  return { rowHeight, rowStyle, rowHidden };
}
/** `instance Default RowProperties`. */
export const def_RowProperties: RowProperties = RowProps(Nothing, Nothing, false);

/** A cell range reference such as `"A1:C3"`. */
export type Range = string;

/** A worksheet. */
export interface Worksheet {
  readonly _wsColumnsProperties: readonly ColumnsProperties[];
  readonly _wsRowPropertiesMap: M.Map<RowIndex, RowProperties>;
  readonly _wsCells: CellMap;
  readonly _wsMerges: readonly Range[];
}
export function Worksheet(
  _wsCells: CellMap,
  _wsColumnsProperties: readonly ColumnsProperties[] = [],
  _wsRowPropertiesMap: M.Map<RowIndex, RowProperties> = M.empty(),
  _wsMerges: readonly Range[] = [],
): Worksheet {
  return { _wsColumnsProperties, _wsRowPropertiesMap, _wsCells, _wsMerges };
}
/** `instance Default Worksheet`: an empty sheet. */
export const def_Worksheet: Worksheet = Worksheet(M.empty());
export const wsCells: Lens<Worksheet, CellMap> =
  lens((w) => w._wsCells, (w, c) => ({ ...w, _wsCells: c }));
export const wsColumnsProperties: Lens<Worksheet, readonly ColumnsProperties[]> =
  lens((w) => w._wsColumnsProperties, (w, c) => ({ ...w, _wsColumnsProperties: c }));
export const wsRowPropertiesMap: Lens<Worksheet, M.Map<RowIndex, RowProperties>> =
  lens((w) => w._wsRowPropertiesMap, (w, r) => ({ ...w, _wsRowPropertiesMap: r }));
export const wsMerges: Lens<Worksheet, readonly Range[]> =
  lens((w) => w._wsMerges, (w, m) => ({ ...w, _wsMerges: m }));

/** `newtype Styles = Styles { unStyles :: ByteString }`: the raw `styles.xml`. */
export interface Styles {
  readonly unStyles: Uint8Array;
}
export function Styles(unStyles: Uint8Array): Styles {
  return { unStyles };
}
/** `emptyStyles`: no style sheet (the writer then emits a minimal one). */
export const emptyStyles: Styles = Styles(new Uint8Array(0));

/**
 * The base date of a workbook's date serial numbers. Day 0 is 1899-12-30 for `DateBase1900`
 * (accounting for the Lotus 1-2-3 leap year bug) and 1904-01-01 for `DateBase1904`.
 */
export type DateBase = "DateBase1900" | "DateBase1904";
export const dateBaseValues: readonly DateBase[] = ["DateBase1900", "DateBase1904"];

/** An Excel workbook: named worksheets in order, styles, defined names and the date base. */
export interface Xlsx {
  readonly _xlSheets: readonly (readonly [string, Worksheet])[];
  readonly _xlStyles: Styles;
  readonly _xlDefinedNames: readonly (readonly [string, Maybe<string>, string])[];
  readonly _xlDateBase: DateBase;
}
export function Xlsx(
  _xlSheets: readonly (readonly [string, Worksheet])[],
  _xlDateBase: DateBase,
  _xlStyles: Styles = emptyStyles,
  _xlDefinedNames: readonly (readonly [string, Maybe<string>, string])[] = [],
): Xlsx {
  return { _xlSheets, _xlStyles, _xlDefinedNames, _xlDateBase };
}
/** `instance Default Xlsx` (`def`, also `emptyXlsx`). */
export const def_Xlsx: Xlsx = Xlsx([], "DateBase1900");
export const emptyXlsx = def_Xlsx;
export const xlSheets: Lens<Xlsx, readonly (readonly [string, Worksheet])[]> =
  lens((x) => x._xlSheets, (x, s) => ({ ...x, _xlSheets: s }));
export const xlStyles: Lens<Xlsx, Styles> =
  lens((x) => x._xlStyles, (x, s) => ({ ...x, _xlStyles: s }));
export const xlDefinedNames: Lens<Xlsx, readonly (readonly [string, Maybe<string>, string])[]> =
  lens((x) => x._xlDefinedNames, (x, d) => ({ ...x, _xlDefinedNames: d }));
export const xlDateBase: Lens<Xlsx, DateBase> =
  lens((x) => x._xlDateBase, (x, d) => ({ ...x, _xlDateBase: d }));

// ---------------------------------------------------------------------------------------------
// Cell references

/** Column number (1-based) to letters: 1 → "A", 27 → "AA". */
export function int2col(n: ColumnIndex): string {
  let s = "";
  let k = n;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
}
/** Letters to column number: "A" → 1. */
export function col2int(s: string): ColumnIndex {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
/** `singleCellRef (row, col)`: e.g. `(1, 1)` → `"A1"`. */
export function singleCellRef(rc: readonly [RowIndex, ColumnIndex]): string {
  return int2col(rc[1]) + String(rc[0]);
}
/** `fromSingleCellRef`: `"B3"` → `Just [3, 2]`. */
export function fromSingleCellRef(ref: string): Maybe<readonly [RowIndex, ColumnIndex]> {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref);
  return m ? Just([parseInt(m[2], 10), col2int(m[1])] as const) : Nothing;
}
/** `mkRange from to`: e.g. `"A1:B2"`. */
export function mkRange(from: readonly [RowIndex, ColumnIndex], to: readonly [RowIndex, ColumnIndex]): Range {
  return singleCellRef(from) + ":" + singleCellRef(to);
}

// ---------------------------------------------------------------------------------------------
// Parse errors

/** Errors from `toXlsxEither`. */
export type ParseError =
  | { readonly tag: "InvalidZipArchive"; readonly _0: string }
  | { readonly tag: "MissingFile"; readonly _0: string }
  | { readonly tag: "InvalidFile"; readonly _0: string; readonly _1: string }
  | { readonly tag: "InvalidRef"; readonly _0: string; readonly _1: string }
  | { readonly tag: "InconsistentXlsx"; readonly _0: string };
export function show_ParseError(e: ParseError): string {
  switch (e.tag) {
    case "InvalidZipArchive":
      return `InvalidZipArchive ${JSON.stringify(e._0)}`;
    case "MissingFile":
      return `MissingFile ${JSON.stringify(e._0)}`;
    case "InvalidFile":
      return `InvalidFile ${JSON.stringify(e._0)} ${JSON.stringify(e._1)}`;
    case "InvalidRef":
      return `InvalidRef ${JSON.stringify(e._0)} (RefId {unRefId = ${JSON.stringify(e._1)}})`;
    case "InconsistentXlsx":
      return `InconsistentXlsx ${JSON.stringify(e._0)}`;
  }
}

class ParseFailure extends Error {
  constructor(readonly err: ParseError) {
    super(show_ParseError(err));
  }
}

// ---------------------------------------------------------------------------------------------
// Reading

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

function parseXml(path: string, text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new ParseFailure({ tag: "InvalidFile", _0: path, _1: "XML parse error" });
  }
  return doc;
}

/** Child elements of `el` with the given local name. */
function children(el: Element, name: string): Element[] {
  const r: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) r.push(c);
  return r;
}
function child(el: Element, name: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
}
function descendants(el: Element | Document, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", name));
}
function attrBool(el: Element, name: string): boolean {
  const v = el.getAttribute(name);
  return v === "1" || v === "true";
}
function attrNum(el: Element, name: string): Maybe<number> {
  const v = el.getAttribute(name);
  return v === null || v === "" ? Nothing : Just(Number(v));
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/");
  parts.pop();
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}
function relsPathOf(path: string): string {
  const i = path.lastIndexOf("/");
  return `${path.slice(0, i + 1)}_rels/${path.slice(i + 1)}.rels`;
}

/** The text of a shared string or inline string element (`<si>`/`<is>`). */
function stringItem(si: Element): CellValue {
  const t = child(si, "t");
  const runs = children(si, "r");
  if (runs.length === 0) return CellText(t?.textContent ?? "");
  return CellRich(runs.map((r) => {
    const rPr = child(r, "rPr");
    return RichTextRun(rPr ? Just(rPr.outerHTML) : Nothing, child(r, "t")?.textContent ?? "");
  }));
}

function errorTypeOf(t: string): ErrorType {
  for (const k of errorTypeValues) if (errorTypeText[k] === t) return k;
  return "ErrorValue";
}

function readWorksheet(path: string, doc: Document, sst: readonly CellValue[]): Worksheet {
  const cols: ColumnsProperties[] = [];
  for (const c of descendants(doc, "col")) {
    cols.push({
      cpMin: Number(c.getAttribute("min")),
      cpMax: Number(c.getAttribute("max")),
      cpWidth: attrNum(c, "width"),
      cpStyle: attrNum(c, "style"),
      cpHidden: attrBool(c, "hidden"),
      cpCollapsed: attrBool(c, "collapsed"),
      cpBestFit: attrBool(c, "bestFit"),
    });
  }
  let rowProps = M.empty<RowIndex, RowProperties>();
  let cells = M.empty<readonly [RowIndex, ColumnIndex], Cell>();
  for (const row of descendants(doc, "row")) {
    const r = Number(row.getAttribute("r"));
    const ht = attrNum(row, "ht");
    const height: Maybe<RowHeight> = ht.tag === "Just"
      ? Just(attrBool(row, "customHeight") ? CustomHeight(ht.value) : AutomaticHeight(ht.value))
      : Nothing;
    const style = attrBool(row, "customFormat") ? attrNum(row, "s") : Nothing;
    const hidden = attrBool(row, "hidden");
    if (height.tag === "Just" || style.tag === "Just" || hidden) {
      rowProps = M.insert(r, RowProps(height, style, hidden), rowProps);
    }
    let nextCol = 1;
    for (const c of children(row, "c")) {
      const ref = c.getAttribute("r");
      let pos: readonly [RowIndex, ColumnIndex];
      if (ref) {
        const p = fromSingleCellRef(ref);
        if (p.tag === "Nothing") throw new ParseFailure({ tag: "InvalidFile", _0: path, _1: `Bad cell reference ${ref}` });
        pos = p.value;
      } else {
        pos = [r, nextCol];
      }
      nextCol = pos[1] + 1;
      const t = c.getAttribute("t") ?? "n";
      const v = child(c, "v")?.textContent ?? null;
      let value: Maybe<CellValue> = Nothing;
      switch (t) {
        case "s":
          if (v !== null) {
            const sv = sst[Number(v)];
            if (sv === undefined) throw new ParseFailure({ tag: "InvalidFile", _0: path, _1: `Bad shared string index ${v}` });
            value = Just(sv);
          }
          break;
        case "inlineStr": {
          const is = child(c, "is");
          if (is) value = Just(stringItem(is));
          break;
        }
        case "str":
          if (v !== null) value = Just(CellText(v));
          break;
        case "b":
          if (v !== null) value = Just(CellBool(v === "1" || v === "true"));
          break;
        case "e":
          if (v !== null) value = Just(CellError(errorTypeOf(v)));
          break;
        default:
          if (v !== null && v !== "") value = Just(CellDouble(Number(v)));
      }
      const f = child(c, "f");
      let formula: Maybe<CellFormula> = Nothing;
      if (f) {
        const expr: FormulaExpression = f.getAttribute("t") === "shared" && !(f.textContent ?? "")
          ? SharedFormula(Number(f.getAttribute("si")))
          : NormalFormula(f.textContent ?? "");
        formula = Just(CellFormula(expr, attrBool(f, "bx"), attrBool(f, "ca")));
      }
      cells = M.insert(pos, Cell(attrNum(c, "s"), value, Nothing, formula), cells);
    }
  }
  const merges = descendants(doc, "mergeCell").map((m) => m.getAttribute("ref") ?? "").filter((x) => x !== "");
  return Worksheet(cells, cols, rowProps, merges);
}

/**
 * `toXlsxEither`: parse an `.xlsx` file. Sheets are read in workbook order; unsupported parts
 * (drawings, charts, pivot tables, comments) are ignored.
 */
export function toXlsxEither(bytes: Uint8Array): Either<ParseError, Xlsx> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    return Left({ tag: "InvalidZipArchive", _0: String((e as Error).message ?? e) });
  }
  const text = (p: string): string => {
    const f = files[p];
    if (!f) throw new ParseFailure({ tag: "MissingFile", _0: p });
    return strFromU8(f);
  };
  try {
    const rootRels = parseXml("_rels/.rels", text("_rels/.rels"));
    const officeRel = descendants(rootRels, "Relationship").find((r) => (r.getAttribute("Type") ?? "").endsWith("/officeDocument"));
    const wbPath = officeRel ? resolvePath("", officeRel.getAttribute("Target") ?? "xl/workbook.xml") : "xl/workbook.xml";
    const wb = parseXml(wbPath, text(wbPath));
    const wbRelsPath = relsPathOf(wbPath);
    const wbRels = parseXml(wbRelsPath, text(wbRelsPath));
    const rels = new Map<string, { type: string; target: string }>();
    for (const r of descendants(wbRels, "Relationship")) {
      rels.set(r.getAttribute("Id") ?? "", { type: r.getAttribute("Type") ?? "", target: resolvePath(wbPath, r.getAttribute("Target") ?? "") });
    }
    const sstRel = [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"));
    const sst: CellValue[] = [];
    if (sstRel && files[sstRel.target]) {
      const sdoc = parseXml(sstRel.target, text(sstRel.target));
      for (const si of descendants(sdoc, "si")) sst.push(stringItem(si));
    }
    const stylesRel = [...rels.values()].find((r) => r.type.endsWith("/styles"));
    const styles = stylesRel && files[stylesRel.target] ? Styles(files[stylesRel.target]) : emptyStyles;
    const pr = descendants(wb, "workbookPr")[0];
    const dateBase: DateBase = pr && attrBool(pr, "date1904") ? "DateBase1904" : "DateBase1900";
    const sheetEls = descendants(wb, "sheet");
    const sheetNames = sheetEls.map((s) => s.getAttribute("name") ?? "");
    const sheets: (readonly [string, Worksheet])[] = [];
    for (const s of sheetEls) {
      const rid = s.getAttributeNS(NS_REL, "id") ?? s.getAttribute("r:id") ?? "";
      const rel = rels.get(rid);
      if (!rel) throw new ParseFailure({ tag: "InvalidRef", _0: wbPath, _1: rid });
      sheets.push([s.getAttribute("name") ?? "", readWorksheet(rel.target, parseXml(rel.target, text(rel.target)), sst)]);
    }
    const names: (readonly [string, Maybe<string>, string])[] = descendants(wb, "definedName").map((d) => {
      const local = d.getAttribute("localSheetId");
      return [d.getAttribute("name") ?? "", local === null ? Nothing : Just(sheetNames[Number(local)] ?? local), d.textContent ?? ""] as const;
    });
    return Right(Xlsx(sheets, dateBase, styles, names));
  } catch (e) {
    if (e instanceof ParseFailure) return Left(e.err);
    return Left({ tag: "InconsistentXlsx", _0: String((e as Error).message ?? e) });
  }
}

/** `toXlsx`: as `toXlsxEither`, but throws on a parse error. */
export function toXlsx(bytes: Uint8Array): Xlsx {
  const r = toXlsxEither(bytes);
  if (r.tag === "Left") throw new Error(show_ParseError(r.value));
  return r.value;
}

// ---------------------------------------------------------------------------------------------
// Writing

/** Escape text for XML content and attribute values. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The default style sheet written when the workbook has no styles. */
export const defaultStylesXml =
  XML_DECL +
  `<styleSheet xmlns="${NS_MAIN}">` +
  `<fonts count="1"><font><sz val="11"/><family val="2"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function fmtNum(x: number): string {
  return Number.isInteger(x) ? String(x) : String(x);
}

function sheetXml(ws: Worksheet, sharedIndex: (s: CellValue) => number): string {
  const out: string[] = [XML_DECL, `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">`];
  const keys = M.keys(ws._wsCells);
  if (keys.length > 0) {
    let minR = Infinity, minC = Infinity, maxR = 0, maxC = 0;
    for (const [r, c] of keys) {
      minR = Math.min(minR, r);
      minC = Math.min(minC, c);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
    out.push(`<dimension ref="${mkRange([minR, minC], [maxR, maxC])}"/>`);
  }
  if (ws._wsColumnsProperties.length > 0) {
    out.push("<cols>");
    for (const cp of ws._wsColumnsProperties) {
      let a = `<col min="${cp.cpMin}" max="${cp.cpMax}"`;
      if (cp.cpWidth.tag === "Just") a += ` width="${fmtNum(cp.cpWidth.value)}" customWidth="1"`;
      if (cp.cpStyle.tag === "Just") a += ` style="${cp.cpStyle.value}"`;
      if (cp.cpHidden) a += ` hidden="1"`;
      if (cp.cpCollapsed) a += ` collapsed="1"`;
      if (cp.cpBestFit) a += ` bestFit="1"`;
      out.push(a + "/>");
    }
    out.push("</cols>");
  }
  // Group cells by row, including rows that only have properties.
  const rows = new Map<number, [ColumnIndex, Cell][]>();
  for (const [[r, c], cell] of M.toList(ws._wsCells)) {
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r)!.push([c, cell]);
  }
  for (const r of M.keys(ws._wsRowPropertiesMap)) if (!rows.has(r)) rows.set(r, []);
  out.push("<sheetData>");
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    let rowAttrs = ` r="${r}"`;
    const rp = M.lookup(r, ws._wsRowPropertiesMap);
    if (rp.tag === "Just") {
      const p = rp.value;
      if (p.rowStyle.tag === "Just") rowAttrs += ` s="${p.rowStyle.value}" customFormat="1"`;
      if (p.rowHeight.tag === "Just") {
        rowAttrs += ` ht="${fmtNum(p.rowHeight.value._0)}"`;
        if (p.rowHeight.value.tag === "CustomHeight") rowAttrs += ` customHeight="1"`;
      }
      if (p.rowHidden) rowAttrs += ` hidden="1"`;
    }
    const cells = rows.get(r)!.sort((a, b) => a[0] - b[0]);
    if (cells.length === 0) {
      out.push(`<row${rowAttrs}/>`);
      continue;
    }
    out.push(`<row${rowAttrs}>`);
    for (const [c, cell] of cells) {
      let attrs = ` r="${singleCellRef([r, c])}"`;
      if (cell._cellStyle.tag === "Just") attrs += ` s="${cell._cellStyle.value}"`;
      let body = "";
      if (cell._cellFormula.tag === "Just") {
        const f = cell._cellFormula.value;
        let fa = "";
        if (f._cellfAssignsToName) fa += ` bx="1"`;
        if (f._cellfCalculate) fa += ` ca="1"`;
        body += f._cellfExpression.tag === "NormalFormula"
          ? `<f${fa}>${xmlEscape(f._cellfExpression._0)}</f>`
          : `<f t="shared" si="${f._cellfExpression._0}"${fa}/>`;
      }
      if (cell._cellValue.tag === "Just") {
        const v = cell._cellValue.value;
        switch (v.tag) {
          case "CellText":
          case "CellRich":
            if (cell._cellFormula.tag === "Just" && v.tag === "CellText") {
              attrs += ` t="str"`;
              body += `<v>${xmlEscape(v._0)}</v>`;
            } else {
              attrs += ` t="s"`;
              body += `<v>${sharedIndex(v)}</v>`;
            }
            break;
          case "CellDouble":
            body += `<v>${fmtNum(v._0)}</v>`;
            break;
          case "CellBool":
            attrs += ` t="b"`;
            body += `<v>${v._0 ? 1 : 0}</v>`;
            break;
          case "CellError":
            attrs += ` t="e"`;
            body += `<v>${xmlEscape(errorTypeText[v._0])}</v>`;
            break;
        }
      }
      out.push(body ? `<c${attrs}>${body}</c>` : `<c${attrs}/>`);
    }
    out.push("</row>");
  }
  out.push("</sheetData>");
  if (ws._wsMerges.length > 0) {
    out.push(`<mergeCells count="${ws._wsMerges.length}">`);
    for (const m of ws._wsMerges) out.push(`<mergeCell ref="${xmlEscape(m)}"/>`);
    out.push("</mergeCells>");
  }
  out.push(`<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>`);
  out.push("</worksheet>");
  return out.join("");
}

function sharedStringXml(v: CellValue): string {
  if (v.tag === "CellRich") {
    return "<si>" + v._0.map((r) => {
      const props = r._richTextRunProperties.tag === "Just" && typeof r._richTextRunProperties.value === "string"
        ? r._richTextRunProperties.value.replace(/\sxmlns(:\w+)?="[^"]*"/g, "")
        : "";
      return `<r>${props}<t xml:space="preserve">${xmlEscape(r._richTextRunText)}</t></r>`;
    }).join("") + "</si>";
  }
  return `<si><t xml:space="preserve">${xmlEscape(v.tag === "CellText" ? v._0 : "")}</t></si>`;
}

/** ISO-8601 time in seconds, as the Haskell `POSIXTime` argument is rendered in `core.xml`. */
function isoTime(posixSeconds: number): string {
  return new Date(posixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * `fromXlsx`: render the workbook as `.xlsx` file contents. The first argument is the creation
 * time (POSIX seconds) recorded in the document properties.
 */
export function fromXlsx(posixTime: number, xlsx: Xlsx): Uint8Array {
  const sst: CellValue[] = [];
  const sstIndex = new Map<string, number>();
  const sharedIndex = (v: CellValue): number => {
    const key = JSON.stringify(v);
    let i = sstIndex.get(key);
    if (i === undefined) {
      i = sst.length;
      sst.push(v);
      sstIndex.set(key, i);
    }
    return i;
  };
  const files: Zippable = {};
  const sheetFiles: string[] = [];
  xlsx._xlSheets.forEach(([, ws], i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(ws, sharedIndex));
    sheetFiles.push(`sheet${i + 1}.xml`);
  });
  const nSheets = xlsx._xlSheets.length;
  const hasStyles = xlsx._xlStyles.unStyles.length > 0;
  files["xl/styles.xml"] = hasStyles ? xlsx._xlStyles.unStyles : strToU8(defaultStylesXml);
  files["xl/sharedStrings.xml"] = strToU8(
    XML_DECL +
      `<sst xmlns="${NS_MAIN}" count="${sst.length}" uniqueCount="${sst.length}">` +
      sst.map(sharedStringXml).join("") +
      "</sst>",
  );
  const sheetIdx = new Map(xlsx._xlSheets.map(([n], i) => [n, i]));
  files["xl/workbook.xml"] = strToU8(
    XML_DECL +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<workbookPr${xlsx._xlDateBase === "DateBase1904" ? ' date1904="1"' : ""}/>` +
      `<bookViews><workbookView/></bookViews>` +
      "<sheets>" +
      xlsx._xlSheets.map(([name], i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets>" +
      (xlsx._xlDefinedNames.length > 0
        ? "<definedNames>" +
          xlsx._xlDefinedNames
            .map(([name, local, val]) => {
              const ls = local.tag === "Just" && sheetIdx.has(local.value) ? ` localSheetId="${sheetIdx.get(local.value)}"` : "";
              return `<definedName name="${xmlEscape(name)}"${ls}>${xmlEscape(val)}</definedName>`;
            })
            .join("") +
          "</definedNames>"
        : "") +
      "</workbook>",
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    XML_DECL +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      sheetFiles.map((f, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/${f}"/>`).join("") +
      `<Relationship Id="rId${nSheets + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${nSheets + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
      "</Relationships>",
  );
  files["_rels/.rels"] = strToU8(
    XML_DECL +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/>` +
      "</Relationships>",
  );
  const t = isoTime(posixTime);
  files["docProps/core.xml"] = strToU8(
    XML_DECL +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${t}</dcterms:created>` +
      `<cp:revision>0</cp:revision>` +
      `</cp:coreProperties>`,
  );
  files["docProps/app.xml"] = strToU8(
    XML_DECL +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><TotalTime>0</TotalTime></Properties>`,
  );
  files["[Content_Types].xml"] = strToU8(
    XML_DECL +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheetFiles.map((f) => `<Override PartName="/xl/worksheets/${f}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
      `</Types>`,
  );
  // Zip entries in a conventional order: content types first. Buffers are copied into this
  // realm's Uint8Array, because fflate tells files from folders with `instanceof` and
  // TextEncoder output can come from another realm (e.g. under jsdom).
  const ordered: Zippable = {};
  const u8 = (x: Zippable[string]): Uint8Array => (x instanceof Uint8Array ? x : new Uint8Array(x as unknown as ArrayLike<number>));
  const order = ["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"];
  for (const k of order) ordered[k] = u8(files[k]);
  for (const k of Object.keys(files)) if (!(k in ordered)) ordered[k] = u8(files[k]);
  return zipSync(ordered, { level: 6 });
}
