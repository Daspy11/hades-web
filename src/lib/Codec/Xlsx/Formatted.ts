/**
 * Haskell `Codec.Xlsx.Formatted` (and the style types of `Codec.Xlsx.Types.StyleSheet`):
 * cells with a higher-level `Format` (font, fill, border, alignment, number format) and spans,
 * which `formatted` turns into plain cells with style indices plus a `StyleSheet` and merges.
 *
 * Only the style properties HADES uses are modelled; record fields are `Maybe` as in Haskell,
 * and `def_X` values are the Haskell `Default` instances (everything `Nothing`).
 */
import * as M from "../../Data/Map";
import { Just, Nothing, type Maybe } from "../../Data/Maybe";
import { lens, type Lens } from "../../Control/Lens";
import { equals } from "../../Data/Ord";
import {
  Cell,
  Styles,
  def_Cell,
  mkRange,
  xmlEscape,
  type CellMap,
  type ColumnIndex,
  type Range,
  type RowIndex,
} from "../Xlsx";

// ---------------------------------------------------------------------------------------------
// Style components

/** A colour: automatic, ARGB hex text (e.g. `"FFA00000"`), or a theme colour with tint. */
export interface Color {
  readonly _colorAutomatic: Maybe<boolean>;
  readonly _colorARGB: Maybe<string>;
  readonly _colorTheme: Maybe<number>;
  readonly _colorTint: Maybe<number>;
}
export const def_Color: Color = { _colorAutomatic: Nothing, _colorARGB: Nothing, _colorTheme: Nothing, _colorTint: Nothing };
export const colorAutomatic: Lens<Color, Maybe<boolean>> = lens((c) => c._colorAutomatic, (c, v) => ({ ...c, _colorAutomatic: v }));
export const colorARGB: Lens<Color, Maybe<string>> = lens((c) => c._colorARGB, (c, v) => ({ ...c, _colorARGB: v }));
export const colorTheme: Lens<Color, Maybe<number>> = lens((c) => c._colorTheme, (c, v) => ({ ...c, _colorTheme: v }));
export const colorTint: Lens<Color, Maybe<number>> = lens((c) => c._colorTint, (c, v) => ({ ...c, _colorTint: v }));

export type FontFamily =
  | "FontFamilyNotApplicable"
  | "FontFamilyRoman"
  | "FontFamilySwiss"
  | "FontFamilyModern"
  | "FontFamilyScript"
  | "FontFamilyDecorative";
export const fontFamilyValues: readonly FontFamily[] = [
  "FontFamilyNotApplicable", "FontFamilyRoman", "FontFamilySwiss", "FontFamilyModern", "FontFamilyScript", "FontFamilyDecorative",
];

export type FontUnderline = "FontUnderlineSingle" | "FontUnderlineDouble" | "FontUnderlineSingleAccounting" | "FontUnderlineDoubleAccounting" | "FontUnderlineNone";
const underlineXml: Record<FontUnderline, string> = {
  FontUnderlineSingle: "single",
  FontUnderlineDouble: "double",
  FontUnderlineSingleAccounting: "singleAccounting",
  FontUnderlineDoubleAccounting: "doubleAccounting",
  FontUnderlineNone: "none",
};

export interface Font {
  readonly _fontBold: Maybe<boolean>;
  readonly _fontColor: Maybe<Color>;
  readonly _fontFamily: Maybe<FontFamily>;
  readonly _fontItalic: Maybe<boolean>;
  readonly _fontName: Maybe<string>;
  readonly _fontSize: Maybe<number>;
  readonly _fontStrikeThrough: Maybe<boolean>;
  readonly _fontUnderline: Maybe<FontUnderline>;
}
export const def_Font: Font = {
  _fontBold: Nothing,
  _fontColor: Nothing,
  _fontFamily: Nothing,
  _fontItalic: Nothing,
  _fontName: Nothing,
  _fontSize: Nothing,
  _fontStrikeThrough: Nothing,
  _fontUnderline: Nothing,
};
export const fontBold: Lens<Font, Maybe<boolean>> = lens((f) => f._fontBold, (f, v) => ({ ...f, _fontBold: v }));
export const fontColor: Lens<Font, Maybe<Color>> = lens((f) => f._fontColor, (f, v) => ({ ...f, _fontColor: v }));
export const fontFamily: Lens<Font, Maybe<FontFamily>> = lens((f) => f._fontFamily, (f, v) => ({ ...f, _fontFamily: v }));
export const fontItalic: Lens<Font, Maybe<boolean>> = lens((f) => f._fontItalic, (f, v) => ({ ...f, _fontItalic: v }));
export const fontName: Lens<Font, Maybe<string>> = lens((f) => f._fontName, (f, v) => ({ ...f, _fontName: v }));
export const fontSize: Lens<Font, Maybe<number>> = lens((f) => f._fontSize, (f, v) => ({ ...f, _fontSize: v }));
export const fontStrikeThrough: Lens<Font, Maybe<boolean>> = lens((f) => f._fontStrikeThrough, (f, v) => ({ ...f, _fontStrikeThrough: v }));
export const fontUnderline: Lens<Font, Maybe<FontUnderline>> = lens((f) => f._fontUnderline, (f, v) => ({ ...f, _fontUnderline: v }));

export type PatternType =
  | "PatternTypeDarkDown" | "PatternTypeDarkGray" | "PatternTypeDarkGrid" | "PatternTypeDarkHorizontal"
  | "PatternTypeDarkTrellis" | "PatternTypeDarkUp" | "PatternTypeDarkVertical" | "PatternTypeGray0625"
  | "PatternTypeGray125" | "PatternTypeLightDown" | "PatternTypeLightGray" | "PatternTypeLightGrid"
  | "PatternTypeLightHorizontal" | "PatternTypeLightTrellis" | "PatternTypeLightUp" | "PatternTypeLightVertical"
  | "PatternTypeMediumGray" | "PatternTypeNone" | "PatternTypeSolid";
/** "PatternTypeDarkDown" → "darkDown", "PatternTypeGray0625" → "gray0625". */
function enumXml(prefix: string, v: string): string {
  const s = v.slice(prefix.length);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export interface FillPattern {
  readonly _fillPatternBgColor: Maybe<Color>;
  readonly _fillPatternFgColor: Maybe<Color>;
  readonly _fillPatternType: Maybe<PatternType>;
}
export const def_FillPattern: FillPattern = { _fillPatternBgColor: Nothing, _fillPatternFgColor: Nothing, _fillPatternType: Nothing };
export const fillPatternBgColor: Lens<FillPattern, Maybe<Color>> = lens((f) => f._fillPatternBgColor, (f, v) => ({ ...f, _fillPatternBgColor: v }));
export const fillPatternFgColor: Lens<FillPattern, Maybe<Color>> = lens((f) => f._fillPatternFgColor, (f, v) => ({ ...f, _fillPatternFgColor: v }));
export const fillPatternType: Lens<FillPattern, Maybe<PatternType>> = lens((f) => f._fillPatternType, (f, v) => ({ ...f, _fillPatternType: v }));

/** `newtype Fill = Fill { _fillPattern :: Maybe FillPattern }` (kept as a record). */
export interface Fill {
  readonly _fillPattern: Maybe<FillPattern>;
}
export function Fill(_fillPattern: Maybe<FillPattern>): Fill {
  return { _fillPattern };
}
export const def_Fill: Fill = Fill(Nothing);
export const fillPattern: Lens<Fill, Maybe<FillPattern>> = lens((f) => f._fillPattern, (_f, v) => Fill(v));

export type LineStyle =
  | "LineStyleDashDot" | "LineStyleDashDotDot" | "LineStyleDashed" | "LineStyleDotted" | "LineStyleDouble"
  | "LineStyleHair" | "LineStyleMedium" | "LineStyleMediumDashDot" | "LineStyleMediumDashDotDot"
  | "LineStyleMediumDashed" | "LineStyleNone" | "LineStyleSlantDashDot" | "LineStyleThick" | "LineStyleThin";

export interface BorderStyle {
  readonly _borderStyleColor: Maybe<Color>;
  readonly _borderStyleLine: Maybe<LineStyle>;
}
export function BorderStyle(_borderStyleColor: Maybe<Color>, _borderStyleLine: Maybe<LineStyle>): BorderStyle {
  return { _borderStyleColor, _borderStyleLine };
}
export const def_BorderStyle: BorderStyle = BorderStyle(Nothing, Nothing);
export const borderStyleColor: Lens<BorderStyle, Maybe<Color>> = lens((b) => b._borderStyleColor, (b, v) => ({ ...b, _borderStyleColor: v }));
export const borderStyleLine: Lens<BorderStyle, Maybe<LineStyle>> = lens((b) => b._borderStyleLine, (b, v) => ({ ...b, _borderStyleLine: v }));

export interface Border {
  readonly _borderDiagonalDown: Maybe<boolean>;
  readonly _borderDiagonalUp: Maybe<boolean>;
  readonly _borderBottom: Maybe<BorderStyle>;
  readonly _borderDiagonal: Maybe<BorderStyle>;
  readonly _borderLeft: Maybe<BorderStyle>;
  readonly _borderRight: Maybe<BorderStyle>;
  readonly _borderTop: Maybe<BorderStyle>;
}
export const def_Border: Border = {
  _borderDiagonalDown: Nothing,
  _borderDiagonalUp: Nothing,
  _borderBottom: Nothing,
  _borderDiagonal: Nothing,
  _borderLeft: Nothing,
  _borderRight: Nothing,
  _borderTop: Nothing,
};
export const borderBottom: Lens<Border, Maybe<BorderStyle>> = lens((b) => b._borderBottom, (b, v) => ({ ...b, _borderBottom: v }));
export const borderDiagonal: Lens<Border, Maybe<BorderStyle>> = lens((b) => b._borderDiagonal, (b, v) => ({ ...b, _borderDiagonal: v }));
export const borderLeft: Lens<Border, Maybe<BorderStyle>> = lens((b) => b._borderLeft, (b, v) => ({ ...b, _borderLeft: v }));
export const borderRight: Lens<Border, Maybe<BorderStyle>> = lens((b) => b._borderRight, (b, v) => ({ ...b, _borderRight: v }));
export const borderTop: Lens<Border, Maybe<BorderStyle>> = lens((b) => b._borderTop, (b, v) => ({ ...b, _borderTop: v }));

export type CellHorizontalAlignment =
  | "CellHorizontalAlignmentCenter" | "CellHorizontalAlignmentCenterContinuous" | "CellHorizontalAlignmentDistributed"
  | "CellHorizontalAlignmentFill" | "CellHorizontalAlignmentGeneral" | "CellHorizontalAlignmentJustify"
  | "CellHorizontalAlignmentLeft" | "CellHorizontalAlignmentRight";
export type CellVerticalAlignment =
  | "CellVerticalAlignmentBottom" | "CellVerticalAlignmentCenter" | "CellVerticalAlignmentDistributed"
  | "CellVerticalAlignmentJustify" | "CellVerticalAlignmentTop";

export interface Alignment {
  readonly _alignmentHorizontal: Maybe<CellHorizontalAlignment>;
  readonly _alignmentIndent: Maybe<number>;
  readonly _alignmentShrinkToFit: Maybe<boolean>;
  readonly _alignmentTextRotation: Maybe<number>;
  readonly _alignmentVertical: Maybe<CellVerticalAlignment>;
  readonly _alignmentWrapText: Maybe<boolean>;
}
export const def_Alignment: Alignment = {
  _alignmentHorizontal: Nothing,
  _alignmentIndent: Nothing,
  _alignmentShrinkToFit: Nothing,
  _alignmentTextRotation: Nothing,
  _alignmentVertical: Nothing,
  _alignmentWrapText: Nothing,
};
export const alignmentHorizontal: Lens<Alignment, Maybe<CellHorizontalAlignment>> = lens((a) => a._alignmentHorizontal, (a, v) => ({ ...a, _alignmentHorizontal: v }));
export const alignmentIndent: Lens<Alignment, Maybe<number>> = lens((a) => a._alignmentIndent, (a, v) => ({ ...a, _alignmentIndent: v }));
export const alignmentShrinkToFit: Lens<Alignment, Maybe<boolean>> = lens((a) => a._alignmentShrinkToFit, (a, v) => ({ ...a, _alignmentShrinkToFit: v }));
export const alignmentTextRotation: Lens<Alignment, Maybe<number>> = lens((a) => a._alignmentTextRotation, (a, v) => ({ ...a, _alignmentTextRotation: v }));
export const alignmentVertical: Lens<Alignment, Maybe<CellVerticalAlignment>> = lens((a) => a._alignmentVertical, (a, v) => ({ ...a, _alignmentVertical: v }));
export const alignmentWrapText: Lens<Alignment, Maybe<boolean>> = lens((a) => a._alignmentWrapText, (a, v) => ({ ...a, _alignmentWrapText: v }));

/** Built-in number formats (`ImpliedNumberFormat`), with their Excel ids. */
export const impliedNumberFormatIds = {
  NfGeneral: 0,
  NfZero: 1,
  Nf2Decimal: 2,
  NfMax3Decimal: 3,
  NfThousandSeparator2Decimal: 4,
  NfPercent: 9,
  NfPercent2Decimal: 10,
  NfExponent2Decimal: 11,
  NfSingleSpacedFraction: 12,
  NfDoubleSpacedFraction: 13,
  NfMmDdYy: 14,
  NfDMmmYy: 15,
  NfDMmm: 16,
  NfMmmYy: 17,
  NfHMm12Hr: 18,
  NfHMmSs12Hr: 19,
  NfHMm: 20,
  NfHMmSs: 21,
  NfMdyHMm: 22,
  NfThousandsNegativeParens: 37,
  NfThousandsNegativeRed: 38,
  NfThousands2DecimalNegativeParens: 39,
  NfThousands2DecimalNegativeRed: 40,
  NfMmSs: 45,
  NfOptHMmSs: 46,
  NfMmSs1Decimal: 47,
  NfExponent1Decimal: 48,
  NfTextPlaceHolder: 49,
} as const;
export type ImpliedNumberFormat = keyof typeof impliedNumberFormatIds;

export type NumberFormat =
  | { readonly tag: "StdNumberFormat"; readonly _0: ImpliedNumberFormat }
  | { readonly tag: "UserNumberFormat"; readonly _0: string };
export function StdNumberFormat(_0: ImpliedNumberFormat): NumberFormat {
  return { tag: "StdNumberFormat", _0 };
}
export function UserNumberFormat(_0: string): NumberFormat {
  return { tag: "UserNumberFormat", _0 };
}

// ---------------------------------------------------------------------------------------------
// Format and FormattedCell

export interface Format {
  readonly _formatAlignment: Maybe<Alignment>;
  readonly _formatBorder: Maybe<Border>;
  readonly _formatFill: Maybe<Fill>;
  readonly _formatFont: Maybe<Font>;
  readonly _formatNumberFormat: Maybe<NumberFormat>;
}
export const def_Format: Format = {
  _formatAlignment: Nothing,
  _formatBorder: Nothing,
  _formatFill: Nothing,
  _formatFont: Nothing,
  _formatNumberFormat: Nothing,
};
export const formatAlignment: Lens<Format, Maybe<Alignment>> = lens((f) => f._formatAlignment, (f, v) => ({ ...f, _formatAlignment: v }));
export const formatBorder: Lens<Format, Maybe<Border>> = lens((f) => f._formatBorder, (f, v) => ({ ...f, _formatBorder: v }));
export const formatFill: Lens<Format, Maybe<Fill>> = lens((f) => f._formatFill, (f, v) => ({ ...f, _formatFill: v }));
export const formatFont: Lens<Format, Maybe<Font>> = lens((f) => f._formatFont, (f, v) => ({ ...f, _formatFont: v }));
export const formatNumberFormat: Lens<Format, Maybe<NumberFormat>> = lens((f) => f._formatNumberFormat, (f, v) => ({ ...f, _formatNumberFormat: v }));

/** A cell with its format and the number of columns and rows it spans (default 1). */
export interface FormattedCell {
  readonly _formattedCell: Cell;
  readonly _formattedFormat: Format;
  readonly _formattedColSpan: number;
  readonly _formattedRowSpan: number;
}
export const def_FormattedCell: FormattedCell = {
  _formattedCell: def_Cell,
  _formattedFormat: def_Format,
  _formattedColSpan: 1,
  _formattedRowSpan: 1,
};
export const formattedCell: Lens<FormattedCell, Cell> = lens((c) => c._formattedCell, (c, v) => ({ ...c, _formattedCell: v }));
export const formattedFormat: Lens<FormattedCell, Format> = lens((c) => c._formattedFormat, (c, v) => ({ ...c, _formattedFormat: v }));
export const formattedColSpan: Lens<FormattedCell, number> = lens((c) => c._formattedColSpan, (c, v) => ({ ...c, _formattedColSpan: v }));
export const formattedRowSpan: Lens<FormattedCell, number> = lens((c) => c._formattedRowSpan, (c, v) => ({ ...c, _formattedRowSpan: v }));

// ---------------------------------------------------------------------------------------------
// Style sheet

/** A cell format record (`<xf>`) referring to the style sheet's fonts, fills etc. by index. */
export interface CellXf {
  readonly _cellXfApplyAlignment: Maybe<boolean>;
  readonly _cellXfApplyBorder: Maybe<boolean>;
  readonly _cellXfApplyFill: Maybe<boolean>;
  readonly _cellXfApplyFont: Maybe<boolean>;
  readonly _cellXfApplyNumberFormat: Maybe<boolean>;
  readonly _cellXfBorderId: Maybe<number>;
  readonly _cellXfFillId: Maybe<number>;
  readonly _cellXfFontId: Maybe<number>;
  readonly _cellXfNumFmtId: Maybe<number>;
  readonly _cellXfId: Maybe<number>;
  readonly _cellXfAlignment: Maybe<Alignment>;
}
export const def_CellXf: CellXf = {
  _cellXfApplyAlignment: Nothing,
  _cellXfApplyBorder: Nothing,
  _cellXfApplyFill: Nothing,
  _cellXfApplyFont: Nothing,
  _cellXfApplyNumberFormat: Nothing,
  _cellXfBorderId: Nothing,
  _cellXfFillId: Nothing,
  _cellXfFontId: Nothing,
  _cellXfNumFmtId: Nothing,
  _cellXfId: Nothing,
  _cellXfAlignment: Nothing,
};

export interface StyleSheet {
  readonly _styleSheetBorders: readonly Border[];
  readonly _styleSheetCellXfs: readonly CellXf[];
  readonly _styleSheetFills: readonly Fill[];
  readonly _styleSheetFonts: readonly Font[];
  /** Custom number formats: id → format code. */
  readonly _styleSheetNumFmts: M.Map<number, string>;
}
export const def_StyleSheet: StyleSheet = {
  _styleSheetBorders: [],
  _styleSheetCellXfs: [],
  _styleSheetFills: [],
  _styleSheetFonts: [],
  _styleSheetNumFmts: M.empty(),
};
export const styleSheetBorders: Lens<StyleSheet, readonly Border[]> = lens((s) => s._styleSheetBorders, (s, v) => ({ ...s, _styleSheetBorders: v }));
export const styleSheetCellXfs: Lens<StyleSheet, readonly CellXf[]> = lens((s) => s._styleSheetCellXfs, (s, v) => ({ ...s, _styleSheetCellXfs: v }));
export const styleSheetFills: Lens<StyleSheet, readonly Fill[]> = lens((s) => s._styleSheetFills, (s, v) => ({ ...s, _styleSheetFills: v }));
export const styleSheetFonts: Lens<StyleSheet, readonly Font[]> = lens((s) => s._styleSheetFonts, (s, v) => ({ ...s, _styleSheetFonts: v }));

const emptyBorderStyle: BorderStyle = def_BorderStyle;

/**
 * `minimalStyleSheet`: the style sheet Excel requires as a minimum: one font (Swiss family,
 * 11 point), the two reserved fills ("none" and "gray125"), one empty border and one cell format.
 */
export const minimalStyleSheet: StyleSheet = {
  ...def_StyleSheet,
  _styleSheetBorders: [{
    ...def_Border,
    _borderBottom: Just(emptyBorderStyle),
    _borderTop: Just(emptyBorderStyle),
    _borderLeft: Just(emptyBorderStyle),
    _borderRight: Just(emptyBorderStyle),
  }],
  _styleSheetFonts: [{ ...def_Font, _fontFamily: Just("FontFamilySwiss"), _fontSize: Just(11) }],
  _styleSheetFills: [
    Fill(Just({ ...def_FillPattern, _fillPatternType: Just("PatternTypeNone") })),
    Fill(Just({ ...def_FillPattern, _fillPatternType: Just("PatternTypeGray125") })),
  ],
  _styleSheetCellXfs: [{ ...def_CellXf, _cellXfBorderId: Just(0), _cellXfFillId: Just(0), _cellXfFontId: Just(0) }],
};

function colorXml(tag: string, c: Color): string {
  let a = "";
  if (c._colorAutomatic.tag === "Just") a += ` auto="${c._colorAutomatic.value ? 1 : 0}"`;
  if (c._colorARGB.tag === "Just") a += ` rgb="${xmlEscape(c._colorARGB.value)}"`;
  if (c._colorTheme.tag === "Just") a += ` theme="${c._colorTheme.value}"`;
  if (c._colorTint.tag === "Just") a += ` tint="${c._colorTint.value}"`;
  return `<${tag}${a}/>`;
}
function boolEl(tag: string, b: Maybe<boolean>): string {
  return b.tag === "Just" ? (b.value ? `<${tag}/>` : `<${tag} val="0"/>`) : "";
}
function fontXml(f: Font): string {
  let s = "<font>";
  s += boolEl("b", f._fontBold);
  s += boolEl("i", f._fontItalic);
  s += boolEl("strike", f._fontStrikeThrough);
  if (f._fontUnderline.tag === "Just") s += `<u val="${underlineXml[f._fontUnderline.value]}"/>`;
  if (f._fontSize.tag === "Just") s += `<sz val="${f._fontSize.value}"/>`;
  if (f._fontColor.tag === "Just") s += colorXml("color", f._fontColor.value);
  if (f._fontName.tag === "Just") s += `<name val="${xmlEscape(f._fontName.value)}"/>`;
  if (f._fontFamily.tag === "Just") s += `<family val="${fontFamilyValues.indexOf(f._fontFamily.value)}"/>`;
  return s + "</font>";
}
function fillXml(f: Fill): string {
  if (f._fillPattern.tag === "Nothing") return "<fill/>";
  const p = f._fillPattern.value;
  const t = p._fillPatternType.tag === "Just" ? ` patternType="${enumXml("PatternType", p._fillPatternType.value)}"` : "";
  let inner = "";
  if (p._fillPatternFgColor.tag === "Just") inner += colorXml("fgColor", p._fillPatternFgColor.value);
  if (p._fillPatternBgColor.tag === "Just") inner += colorXml("bgColor", p._fillPatternBgColor.value);
  return `<fill>${inner ? `<patternFill${t}>${inner}</patternFill>` : `<patternFill${t}/>`}</fill>`;
}
function borderStyleXml(tag: string, b: Maybe<BorderStyle>): string {
  if (b.tag === "Nothing") return `<${tag}/>`;
  const s = b.value._borderStyleLine.tag === "Just" ? ` style="${enumXml("LineStyle", b.value._borderStyleLine.value)}"` : "";
  return b.value._borderStyleColor.tag === "Just"
    ? `<${tag}${s}>${colorXml("color", b.value._borderStyleColor.value)}</${tag}>`
    : `<${tag}${s}/>`;
}
function borderXml(b: Border): string {
  let a = "";
  if (b._borderDiagonalUp.tag === "Just") a += ` diagonalUp="${b._borderDiagonalUp.value ? 1 : 0}"`;
  if (b._borderDiagonalDown.tag === "Just") a += ` diagonalDown="${b._borderDiagonalDown.value ? 1 : 0}"`;
  return `<border${a}>` +
    borderStyleXml("left", b._borderLeft) +
    borderStyleXml("right", b._borderRight) +
    borderStyleXml("top", b._borderTop) +
    borderStyleXml("bottom", b._borderBottom) +
    borderStyleXml("diagonal", b._borderDiagonal) +
    "</border>";
}
function alignmentXml(a: Alignment): string {
  let s = "";
  if (a._alignmentHorizontal.tag === "Just") s += ` horizontal="${enumXml("CellHorizontalAlignment", a._alignmentHorizontal.value)}"`;
  if (a._alignmentVertical.tag === "Just") s += ` vertical="${enumXml("CellVerticalAlignment", a._alignmentVertical.value)}"`;
  if (a._alignmentIndent.tag === "Just") s += ` indent="${a._alignmentIndent.value}"`;
  if (a._alignmentTextRotation.tag === "Just") s += ` textRotation="${a._alignmentTextRotation.value}"`;
  if (a._alignmentWrapText.tag === "Just") s += ` wrapText="${a._alignmentWrapText.value ? 1 : 0}"`;
  if (a._alignmentShrinkToFit.tag === "Just") s += ` shrinkToFit="${a._alignmentShrinkToFit.value ? 1 : 0}"`;
  return `<alignment${s}/>`;
}
function xfXml(x: CellXf): string {
  const n = (k: string, v: Maybe<number>) => (v.tag === "Just" ? ` ${k}="${v.value}"` : "");
  const b = (k: string, v: Maybe<boolean>) => (v.tag === "Just" ? ` ${k}="${v.value ? 1 : 0}"` : "");
  const attrs =
    n("numFmtId", x._cellXfNumFmtId) + n("fontId", x._cellXfFontId) + n("fillId", x._cellXfFillId) +
    n("borderId", x._cellXfBorderId) + n("xfId", x._cellXfId) +
    b("applyNumberFormat", x._cellXfApplyNumberFormat) + b("applyFont", x._cellXfApplyFont) +
    b("applyFill", x._cellXfApplyFill) + b("applyBorder", x._cellXfApplyBorder) +
    b("applyAlignment", x._cellXfApplyAlignment);
  return x._cellXfAlignment.tag === "Just" ? `<xf${attrs}>${alignmentXml(x._cellXfAlignment.value)}</xf>` : `<xf${attrs}/>`;
}

/** `renderStyleSheet`: the style sheet as `styles.xml`. */
export function renderStyleSheet(s: StyleSheet): Styles {
  const numFmts = M.toList(s._styleSheetNumFmts);
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (numFmts.length > 0
      ? `<numFmts count="${numFmts.length}">` + numFmts.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(code)}"/>`).join("") + "</numFmts>"
      : "") +
    `<fonts count="${s._styleSheetFonts.length}">${s._styleSheetFonts.map(fontXml).join("")}</fonts>` +
    `<fills count="${s._styleSheetFills.length}">${s._styleSheetFills.map(fillXml).join("")}</fills>` +
    `<borders count="${s._styleSheetBorders.length}">${s._styleSheetBorders.map(borderXml).join("")}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${s._styleSheetCellXfs.length}">${s._styleSheetCellXfs.map(xfXml).join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    "</styleSheet>";
  return Styles(new TextEncoder().encode(xml));
}

// ---------------------------------------------------------------------------------------------
// formatted

/** Result of `formatted`. */
export interface Formatted {
  /** The final cell map with style indices filled in. */
  readonly formattedCellMap: CellMap;
  /** The style sheet extended with the formats used by the cells. */
  readonly formattedStyleSheet: StyleSheet;
  /** Merged ranges for cells spanning several rows or columns. */
  readonly formattedMerges: readonly Range[];
}

/** First id for user-defined number formats. */
const firstUserNumFmtId = 164;

class IdTable<A> {
  private readonly items: A[];
  constructor(initial: readonly A[]) {
    this.items = [...initial];
  }
  getId(a: A): number {
    const i = this.items.findIndex((x) => equals(x, a));
    if (i >= 0) return i;
    this.items.push(a);
    return this.items.length - 1;
  }
  list(): readonly A[] {
    return this.items;
  }
}

/**
 * `formatted`: turn formatted cells into plain cells with style ids, extending the style sheet.
 * Cells spanning several rows or columns produce a merge, and the covered cells are filled with
 * blank cells carrying the relevant outer borders so that the merged block has a border.
 */
export function formatted(cs: M.Map<readonly [RowIndex, ColumnIndex], FormattedCell>, styleSheet: StyleSheet): Formatted {
  const fonts = new IdTable(styleSheet._styleSheetFonts);
  const fills = new IdTable(styleSheet._styleSheetFills);
  const borders = new IdTable(styleSheet._styleSheetBorders);
  const xfs = new IdTable(styleSheet._styleSheetCellXfs);
  let numFmts = styleSheet._styleSheetNumFmts;
  const numFmtIdOf = (nf: NumberFormat): number => {
    if (nf.tag === "StdNumberFormat") return impliedNumberFormatIds[nf._0];
    for (const [id, code] of M.toList(numFmts)) if (code === nf._0) return id;
    const ids = M.keys(numFmts);
    const id = Math.max(firstUserNumFmtId - 1, ...ids) + 1;
    numFmts = M.insert(id, nf._0, numFmts);
    return id;
  };
  const apply = (m: Maybe<unknown>): Maybe<boolean> => (m.tag === "Just" ? Just(true) : Nothing);
  const cellStyleId = (c: FormattedCell): Maybe<number> => {
    const f = c._formattedFormat;
    const xf: CellXf = {
      _cellXfApplyAlignment: apply(f._formatAlignment),
      _cellXfApplyBorder: apply(f._formatBorder),
      _cellXfApplyFill: apply(f._formatFill),
      _cellXfApplyFont: apply(f._formatFont),
      _cellXfApplyNumberFormat: apply(f._formatNumberFormat),
      _cellXfBorderId: f._formatBorder.tag === "Just" ? Just(borders.getId(f._formatBorder.value)) : Nothing,
      _cellXfFillId: f._formatFill.tag === "Just" ? Just(fills.getId(f._formatFill.value)) : Nothing,
      _cellXfFontId: f._formatFont.tag === "Just" ? Just(fonts.getId(f._formatFont.value)) : Nothing,
      _cellXfNumFmtId: f._formatNumberFormat.tag === "Just" ? Just(numFmtIdOf(f._formatNumberFormat.value)) : Nothing,
      _cellXfId: Nothing,
      _cellXfAlignment: f._formatAlignment,
    };
    return equals(xf, def_CellXf) ? Nothing : Just(xfs.getId(xf));
  };

  const merges: Range[] = [];
  let out = M.empty<readonly [RowIndex, ColumnIndex], Cell>();
  for (const [[row, col], cell] of M.toList(cs)) {
    const block: [readonly [RowIndex, ColumnIndex], FormattedCell][] = [];
    if (cell._formattedRowSpan === 1 && cell._formattedColSpan === 1) {
      block.push([[row, col], cell]);
    } else {
      const topRow = row, leftCol = col;
      const bottomRow = row + cell._formattedRowSpan - 1;
      const rightCol = col + cell._formattedColSpan - 1;
      merges.push(mkRange([topRow, leftCol], [bottomRow, rightCol]));
      const border = cell._formattedFormat._formatBorder;
      const side = (cond: boolean, get: (b: Border) => Maybe<BorderStyle>): Maybe<BorderStyle> =>
        cond && border.tag === "Just" ? get(border.value) : Nothing;
      for (let r = topRow; r <= bottomRow; r++) {
        for (let c = leftCol; c <= rightCol; c++) {
          if (r === row && c === col) {
            block.push([[r, c], cell]);
          } else {
            const b: Border = {
              ...def_Border,
              _borderTop: side(r === topRow, (x) => x._borderTop),
              _borderBottom: side(r === bottomRow, (x) => x._borderBottom),
              _borderLeft: side(c === leftCol, (x) => x._borderLeft),
              _borderRight: side(c === rightCol, (x) => x._borderRight),
            };
            block.push([[r, c], { ...def_FormattedCell, _formattedFormat: { ...def_Format, _formatBorder: Just(b) } }]);
          }
        }
      }
    }
    for (const [pos, fc] of block) {
      out = M.insert(pos, { ...fc._formattedCell, _cellStyle: cellStyleId(fc) }, out);
    }
  }
  return {
    formattedCellMap: out,
    formattedStyleSheet: {
      _styleSheetBorders: borders.list(),
      _styleSheetCellXfs: xfs.list(),
      _styleSheetFills: fills.list(),
      _styleSheetFonts: fonts.list(),
      _styleSheetNumFmts: numFmts,
    },
    formattedMerges: merges,
  };
}

/** Convenience used by tests: a formatted cell holding just a value. */
export function formattedValue(c: Cell): FormattedCell {
  return { ...def_FormattedCell, _formattedCell: c };
}
