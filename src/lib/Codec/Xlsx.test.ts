import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import * as M from "../Data/Map";
import { Just, Nothing } from "../Data/Maybe";
import { set, setJust, over } from "../Control/Lens";
import * as X from "./Xlsx";
import * as F from "./Xlsx/Formatted";

const cell = (v: X.CellValue) => X.Cell(Nothing, Just(v));

describe("Codec.Xlsx", () => {
  it("converts cell references", () => {
    expect(X.int2col(1)).toBe("A");
    expect(X.int2col(26)).toBe("Z");
    expect(X.int2col(27)).toBe("AA");
    expect(X.int2col(703)).toBe("AAA");
    expect(X.col2int("AAA")).toBe(703);
    expect(X.singleCellRef([3, 2])).toBe("B3");
    expect(X.fromSingleCellRef("$AB$12")).toEqual(Just([12, 28]));
    expect(X.mkRange([1, 1], [2, 3])).toBe("A1:C2");
  });

  it("round-trips values, formulas, columns, rows and merges", () => {
    const cells = M.fromList<readonly [number, number], X.Cell>([
      [[1, 1], cell(X.CellText("Name & <stuff>"))],
      [[1, 2], cell(X.CellDouble(3.25))],
      [[2, 1], cell(X.CellBool(true))],
      [[2, 2], cell(X.CellError("ErrorDiv0"))],
      [[3, 1], X.Cell(Nothing, Nothing, Nothing, Just(X.CellFormula(X.NormalFormula('HYPERLINK("http://x","y")'), false, true)))],
      [[3, 3], cell(X.CellText("Name & <stuff>"))],
    ]);
    const ws = X.Worksheet(
      cells,
      [{ cpMin: 1, cpMax: 1, cpWidth: Just(20), cpStyle: Nothing, cpHidden: false, cpCollapsed: false, cpBestFit: true }],
      M.fromList([[1, X.RowProps(Just(X.AutomaticHeight(10)), Nothing, false)]]),
      ["A4:B5"],
    );
    const book = X.Xlsx([["Sheet 1", ws]], "DateBase1900");
    const bytes = X.fromXlsx(0, book);
    const files = unzipSync(bytes);
    expect(Object.keys(files)[0]).toBe("[Content_Types].xml");
    expect(strFromU8(files["xl/sharedStrings.xml"])).toContain('count="1"');
    const back = X.toXlsxEither(bytes);
    expect(back.tag).toBe("Right");
    if (back.tag !== "Right") return;
    const [[name, ws2]] = back.value._xlSheets;
    expect(name).toBe("Sheet 1");
    expect(ws2._wsCells).toEqual(cells);
    expect(ws2._wsColumnsProperties).toEqual(ws._wsColumnsProperties);
    expect(ws2._wsRowPropertiesMap).toEqual(ws._wsRowPropertiesMap);
    expect(ws2._wsMerges).toEqual(["A4:B5"]);
    expect(back.value._xlDateBase).toBe("DateBase1900");
  });

  it("reports corrupt files", () => {
    const r = X.toXlsxEither(new Uint8Array([1, 2, 3]));
    expect(r.tag).toBe("Left");
    if (r.tag === "Left") expect(r.value.tag).toBe("InvalidZipArchive");
  });

  it("formats cells into a style sheet with merges", () => {
    const bold = setJust(F.fontBold, true, F.def_Font);
    const border: F.Border = {
      ...F.def_Border,
      _borderLeft: Just(F.BorderStyle(Just(setJust(F.colorAutomatic, true, F.def_Color)), Just("LineStyleThin"))),
      _borderRight: Just(F.BorderStyle(Nothing, Just("LineStyleThin"))),
      _borderTop: Just(F.BorderStyle(Nothing, Just("LineStyleThin"))),
      _borderBottom: Just(F.BorderStyle(Nothing, Just("LineStyleThin"))),
    };
    const header: F.FormattedCell = over(
      F.formattedFormat,
      (f) => ({ ...f, _formatFont: Just(bold), _formatBorder: Just(border) }),
      set(F.formattedColSpan, 2, F.formattedValue(cell(X.CellText("Head")))),
    );
    const date: F.FormattedCell = {
      ...F.formattedValue(cell(X.CellDouble(45000))),
      _formattedFormat: { ...F.def_Format, _formatNumberFormat: Just(F.StdNumberFormat("NfDMmmYy")) },
    };
    const plain = F.formattedValue(cell(X.CellDouble(1)));
    const r = F.formatted(
      M.fromList<readonly [number, number], F.FormattedCell>([[[1, 1], header], [[2, 1], date], [[2, 2], plain]]),
      F.minimalStyleSheet,
    );
    expect(r.formattedMerges).toEqual(["A1:B1"]);
    // Plain cell has no style; header and date get new xfs after the minimal one.
    expect(M.lookup([2, 2] as const, r.formattedCellMap)).toEqual(Just(cell(X.CellDouble(1))));
    const hs = M.lookup([1, 1] as const, r.formattedCellMap);
    expect(hs.tag === "Just" && hs.value._cellStyle).toEqual(Just(1));
    // The covered cell carries the top/bottom/right borders only.
    const covered = M.lookup([1, 2] as const, r.formattedCellMap);
    expect(covered.tag === "Just" && covered.value._cellStyle.tag).toBe("Just");
    expect(r.formattedStyleSheet._styleSheetFonts.length).toBe(2);
    expect(r.formattedStyleSheet._styleSheetBorders.length).toBe(3);
    const ds = M.lookup([2, 1] as const, r.formattedCellMap);
    const xfId = ds.tag === "Just" && ds.value._cellStyle.tag === "Just" ? ds.value._cellStyle.value : -1;
    expect(r.formattedStyleSheet._styleSheetCellXfs[xfId]._cellXfNumFmtId).toEqual(Just(15));

    const styles = F.renderStyleSheet(r.formattedStyleSheet);
    const xml = new TextDecoder().decode(styles.unStyles);
    expect(xml).toContain('<b/>');
    expect(xml).toContain('<left style="thin"><color auto="1"/></left>');
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);

    const book = X.Xlsx([["M", X.Worksheet(r.formattedCellMap, [], M.empty(), r.formattedMerges)]], "DateBase1900", styles);
    const back = X.toXlsxEither(X.fromXlsx(1700000000, book));
    expect(back.tag).toBe("Right");
    if (back.tag === "Right") {
      expect(new TextDecoder().decode(back.value._xlStyles.unStyles)).toBe(xml);
      expect(back.value._xlSheets[0][1]._wsCells).toEqual(r.formattedCellMap);
    }
  });
});
