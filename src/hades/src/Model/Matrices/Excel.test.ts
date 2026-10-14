import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { toXlsxEither, fromXlsx, CellBool, CellDouble, CellText, NormalFormula } from "@/lib/Codec/Xlsx";
import { formatted, minimalStyleSheet } from "@/lib/Codec/Xlsx/Formatted";
import { evalModelEdit, nameField, Name, type Model } from "@/hades/src/Model/Abstract/PackageTree";
import { identity } from "@/lib/Control/Lens";
import {
  BuiltInDef, DecoBool, DecoBoolDef, DecoIntDef, DecoRange, DecoRealDef, Field, migrateField,
} from "@/hades/src/Model/Reflection/Types";
import { ExtBool, ExtDate, ExtInt, ExtNone, ExtReal, ExtText } from "@/hades/src/Model/Reflection/Values";
import { sRGB24 } from "@/lib/Data/Colour";
import { def_FormattedCell } from "@/lib/Codec/Xlsx/Formatted";
import {
  ColumnGroup, ExprColumn, FieldColumn, FieldColumnData, LookupColumn, Matrix, MatrixColumn, QueryColumn,
  SortOrder, def_FieldColumnData,
} from "./Base";
import {
  extValueToExcel, makeFieldCell, makeHeaderCell, matrixAlignment, matrixBook, matrixBorders, matrixCells,
  matrixColumn, matrixErrorsDialog, matrixExportDialog, matrixFont, matrixFormat, matrixWarningsDialog, tabulateCell,
} from "./Excel";
import { naturalOrder } from "@/hades/src/Text/NaturalOrder";
import { findEntity, readRiskModel, riskClass, type RV } from "./testing/RiskModel";

const examplePath = path.resolve(__dirname, "../../../../dsm/share/examples/3 Managing Risks.dsm");
const exampleJson = JSON.parse(fs.readFileSync(examplePath, "utf8"));
const model: Model<RV> = readRiskModel(exampleJson);
const fid = (n: string) => migrateField(n);
const byId = new Map<string, any>((exampleJson.modelContents as any[]).map((e) => [e.identity, e]));
/** Entity names in the order of the Haskell `Ord ExtValue` (natural order for text). */
const byName = (a: any, b: any): number => naturalOrder(a.contents.name.trim(), b.contents.name.trim());

/** The "Risk Controls" relations of the example, in both directions (as the model holds them). */
const related = (mId: string): string[] => {
  const out = new Set<string>();
  for (const [a, rels] of exampleJson.modelRelations as [string, [string, string][]][]) {
    for (const [b, r] of rels) {
      if (r !== "Risk Controls") continue;
      if (a === mId) out.add(b);
      if (b === mId) out.add(a);
    }
  }
  return [...out];
};

const matrixOf = (name: string): Matrix => {
  const e = M.lookup(findEntity(model, "Matrix", name), model.modelContents);
  if (e.tag === "Nothing" || e.value._entityContents.tag !== "Matrix") throw new Error("not a matrix");
  return e.value._entityContents._0;
};
const rootPackage = (): string => {
  const [, id] = M.toList(model.modelRoot)[0];
  return id;
};

/** Write the workbook and dump it with openpyxl. */
function dump(bytes: Uint8Array): any {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mx-xlsx-"));
  try {
    const file = path.join(dir, "matrix.xlsx");
    fs.writeFileSync(file, bytes);
    const out = execFileSync("python3", ["-I", path.join(__dirname, "testing", "dumpXlsx.py"), file], { encoding: "utf8" });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Colours and fields for the decorated field types (the example model has none). */
const red = sRGB24(255, 0, 0), green = sRGB24(0, 128, 0), blue = sRGB24(0x34, 0x65, 0xa4);
const decoFields: Field[] = [
  Field(false, fid("Flag"), "Flag", "One", DecoBoolDef(DecoBool(Nothing, Just([red, green] as const)))),
  Field(false, fid("Plain flag"), "Plain flag", "One", DecoBoolDef(DecoBool(Just(["a", "b"] as const), Nothing))),
  Field(false, fid("Score"), "Score", "One", DecoIntDef(DecoRange<number>([Just(0), Just(10)], [
    [[Nothing, Just(3)], [Nothing, Just(green)]],
    [[Just(4), Just(6)], [Just("icon"), Nothing]],
    [[Just(7), Nothing], [Nothing, Just(red)]],
  ]))),
  Field(false, fid("Ratio"), "Ratio", "One", DecoRealDef(DecoRange<number>([Nothing, Nothing], [
    [[Nothing, Just(0.5)], [Nothing, Just(blue)]],
  ]))),
  Field(false, fid("Done"), "Done", "One", BuiltInDef("ModelBool")),
  Field(false, fid("Weight"), "Weight", "One", BuiltInDef("ModelReal")),
  Field(false, fid("Notes"), "Notes", "One", BuiltInDef("ModelNote")),
];
/** The example model with the decorated fields added. */
const decoModel: Model<RV> = {
  ...model,
  modelFields: decoFields.reduce((m, f) => M.insert(f.fieldId, f, m), model.modelFields),
};

const ref = (r: number, c: number) => String.fromCharCode(64 + c) + String(r);
const excelDay = (iso: string) =>
  (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

// ---------------------------------------------------------------------------------------------

describe("Formats and cells", () => {
  it("has the basic matrix format", () => {
    expect(matrixFont).toEqual(Just({
      _fontBold: Nothing, _fontColor: Nothing, _fontFamily: Just("FontFamilySwiss"), _fontItalic: Nothing,
      _fontName: Just("Roboto"), _fontSize: Nothing, _fontStrikeThrough: Nothing, _fontUnderline: Nothing,
    }));
    expect(matrixAlignment.tag === "Just" && matrixAlignment.value._alignmentVertical).toEqual(Just("CellVerticalAlignmentCenter"));
    expect(matrixAlignment.tag === "Just" && matrixAlignment.value._alignmentWrapText).toEqual(Just(true));
    expect(matrixAlignment.tag === "Just" && matrixAlignment.value._alignmentHorizontal).toEqual(Nothing);
    if (matrixBorders.tag !== "Just") throw new Error("no borders");
    const b = matrixBorders.value;
    for (const s of [b._borderLeft, b._borderRight, b._borderTop, b._borderBottom]) {
      expect(s.tag === "Just" && s.value._borderStyleLine).toEqual(Just("LineStyleThin"));
      expect(s.tag === "Just" && s.value._borderStyleColor.tag === "Just" && s.value._borderStyleColor.value._colorAutomatic)
        .toEqual(Just(true));
    }
    expect(b._borderDiagonal).toEqual(Nothing);
    expect(matrixFormat._formatFont).toEqual(matrixFont);
    expect(matrixFormat._formatFill).toEqual(Nothing);
  });

  it("makes bold, centred header cells", () => {
    const h = makeHeaderCell("Title");
    expect(h._formattedCell._cellValue).toEqual(Just(CellText("Title")));
    const f = h._formattedFormat;
    expect(f._formatFont.tag === "Just" && f._formatFont.value._fontBold).toEqual(Just(true));
    expect(f._formatFont.tag === "Just" && f._formatFont.value._fontName).toEqual(Just("Roboto"));
    expect(f._formatAlignment.tag === "Just" && f._formatAlignment.value._alignmentHorizontal)
      .toEqual(Just("CellHorizontalAlignmentCenter"));
    expect(f._formatBorder).toEqual(matrixBorders);
    expect([h._formattedColSpan, h._formattedRowSpan]).toEqual([1, 1]);
  });

  it("converts extension values to cells", () => {
    expect(extValueToExcel(ExtNone, Nothing)._formattedCell._cellValue).toEqual(Nothing);
    expect(extValueToExcel(ExtBool(true), Nothing)._formattedCell._cellValue).toEqual(Just(CellBool(true)));
    expect(extValueToExcel(ExtInt(42), Nothing)._formattedCell._cellValue).toEqual(Just(CellDouble(42)));
    expect(extValueToExcel(ExtReal(2.5), Nothing)._formattedCell._cellValue).toEqual(Just(CellDouble(2.5)));
    const t = extValueToExcel(ExtText("abc"), Nothing);
    expect(t._formattedCell._cellValue).toEqual(Just(CellText("abc")));
    expect(t._formattedFormat._formatAlignment.tag === "Just" && t._formattedFormat._formatAlignment.value._alignmentWrapText)
      .toEqual(Just(true));
    // Day zero is 1899-12-30; 1900-03-01 is 61 (Excel's fictitious 29 Feb 1900 is day 60).
    const d = extValueToExcel(ExtDate("1900-03-01"), Nothing);
    expect(d._formattedCell._cellValue).toEqual(Just(CellDouble(61)));
    expect(d._formattedFormat._formatNumberFormat).toEqual(Just({ tag: "StdNumberFormat", _0: "NfDMmmYy" }));
    expect(extValueToExcel(ExtDate("2020-05-13"), Nothing)._formattedCell._cellValue).toEqual(Just(CellDouble(43964)));
  });

  it("makes hyperlink formulas with escaped quotes and no cached value", () => {
    const c = extValueToExcel(ExtText("say \"hi\""), Just("http://x/\"q\""));
    expect(c._formattedCell._cellValue).toEqual(Nothing);
    expect(c._formattedCell._cellFormula).toEqual(Just({
      _cellfExpression: NormalFormula("HYPERLINK(\"http://x/\"\"q\"\"\",\"say \"\"hi\"\"\")"),
      _cellfAssignsToName: false,
      _cellfCalculate: true,
    }));
    // The format is still the one for the value type.
    expect(c._formattedFormat._formatAlignment.tag).toBe("Just");
  });

  it("colours cells by the field type", () => {
    const r = evalModelEdit(riskClass, identity<RV>(), model, (ctx) => [
      makeFieldCell(ctx, fid("Category"), ExtText("Grounding"), Nothing),
      makeFieldCell(ctx, fid("Category"), ExtText("Not a category"), Nothing),
      makeFieldCell(ctx, fid("Business Unit"), ExtText("Navigation"), Nothing),
      makeFieldCell(ctx, fid("No such field"), ExtText("x"), Nothing),
      makeFieldCell(ctx, fid("Category"), ExtInt(3), Nothing),
    ]);
    if (r.tag === "Left") throw new Error("edit failed");
    const [enumCell, unknownItem, textCell, noField, wrongType] = r.value;
    const fill = enumCell._formattedFormat._formatFill;
    expect(fill).toEqual(Just({
      _fillPattern: Just({
        _fillPatternBgColor: Just({ _colorAutomatic: Nothing, _colorARGB: Just("FF729FCF"), _colorTheme: Nothing, _colorTint: Nothing }),
        _fillPatternFgColor: Just({ _colorAutomatic: Nothing, _colorARGB: Just("FF729FCF"), _colorTheme: Nothing, _colorTint: Nothing }),
        _fillPatternType: Just("PatternTypeSolid"),
      }),
    }));
    for (const c of [unknownItem, textCell, noField, wrongType]) expect(c._formattedFormat._formatFill).toEqual(Nothing);
  });

  it("colours decorated booleans and numbers", () => {
    const r = evalModelEdit(riskClass, identity<RV>(), decoModel, (ctx) => ({
      flagFalse: makeFieldCell(ctx, fid("Flag"), ExtBool(false), Nothing),
      flagTrue: makeFieldCell(ctx, fid("Flag"), ExtBool(true), Nothing),
      flagNone: makeFieldCell(ctx, fid("Flag"), ExtNone, Nothing),
      plain: makeFieldCell(ctx, fid("Plain flag"), ExtBool(true), Nothing),
      low: makeFieldCell(ctx, fid("Score"), ExtInt(2), Nothing),
      mid: makeFieldCell(ctx, fid("Score"), ExtInt(5), Nothing),
      high: makeFieldCell(ctx, fid("Score"), ExtInt(9), Nothing),
      scoreText: makeFieldCell(ctx, fid("Score"), ExtText("9"), Nothing),
      ratioLow: makeFieldCell(ctx, fid("Ratio"), ExtReal(0.25), Nothing),
      ratioHigh: makeFieldCell(ctx, fid("Ratio"), ExtReal(0.75), Nothing),
      ratioInt: makeFieldCell(ctx, fid("Ratio"), ExtInt(0), Nothing),
      done: makeFieldCell(ctx, fid("Done"), ExtBool(true), Nothing),
    }));
    if (r.tag === "Left") throw new Error("edit failed");
    const fillOf = (c: typeof r.value.low): string | null => {
      const f = c._formattedFormat._formatFill;
      if (f.tag === "Nothing" || f.value._fillPattern.tag === "Nothing") return null;
      const p = f.value._fillPattern.value;
      expect(p._fillPatternType).toEqual(Just("PatternTypeSolid"));
      expect(p._fillPatternBgColor).toEqual(p._fillPatternFgColor);
      return p._fillPatternFgColor.tag === "Just" && p._fillPatternFgColor.value._colorARGB.tag === "Just"
        ? p._fillPatternFgColor.value._colorARGB.value
        : "?";
    };
    const v = r.value;
    // DecoBool colours are (False, True); hex digits are upper case.
    expect(fillOf(v.flagFalse)).toBe("FFFF0000");
    expect(fillOf(v.flagTrue)).toBe("FF008000");
    expect(fillOf(v.flagNone)).toBeNull();
    expect(fillOf(v.plain)).toBeNull();
    // The first matching range wins; a range with no colour (or no range) gives no fill.
    expect(fillOf(v.low)).toBe("FF008000");
    expect(fillOf(v.mid)).toBeNull();
    expect(fillOf(v.high)).toBe("FFFF0000");
    expect(fillOf(v.scoreText)).toBeNull();
    expect(fillOf(v.ratioLow)).toBe("FF3465A4");
    expect(fillOf(v.ratioHigh)).toBeNull();
    expect(fillOf(v.ratioInt)).toBeNull();
    expect(fillOf(v.done)).toBeNull();
    // The value itself is unchanged.
    expect(v.high._formattedCell._cellValue).toEqual(Just(CellDouble(9)));
    expect(v.flagTrue._formattedCell._cellValue).toEqual(Just(CellBool(true)));
  });

  it("gives an empty, unformatted cell when there is no entity", () => {
    const r = evalModelEdit(riskClass, identity<RV>(), model, (ctx) =>
      tabulateCell(riskClass, ctx, [], [], MatrixColumn("N", FieldColumn(def_FieldColumnData))));
    expect(r).toEqual({ tag: "Right", value: def_FormattedCell });
  });

  it("computes column widths from the headings and field types", () => {
    const w = (name: string, d: Parameters<typeof MatrixColumn>[1]) => {
      const cp = matrixColumn(riskClass, model, 3, MatrixColumn(name, d));
      expect([cp.cpMin, cp.cpMax, cp.cpBestFit, cp.cpHidden, cp.cpCollapsed, cp.cpStyle]).toEqual([3, 3, true, false, false, Nothing]);
      return cp.cpWidth.tag === "Just" ? cp.cpWidth.value : NaN;
    };
    expect(w("N", FieldColumn(def_FieldColumnData))).toBe(20);                                   // Text
    expect(w("D", FieldColumn(FieldColumnData(fid("Description"), Nothing)))).toBe(30);           // Note (40), limited
    expect(w("C", FieldColumn(FieldColumnData(fid("Category"), Nothing)))).toBe(10);              // Enum
    expect(w("A rather long column heading", FieldColumn(FieldColumnData(fid("Category"), Nothing)))).toBe(14);
    expect(w("R", FieldColumn(FieldColumnData(fid("Risk Number"), Nothing)))).toBe(4);            // Integer
    expect(w("U", FieldColumn(FieldColumnData(fid("Previous Version"), Nothing)))).toBe(20);      // URL
    expect(w("T", FieldColumn(FieldColumnData(fid("Next Review Date"), Nothing)))).toBe(15);      // Date
    expect(w("?", FieldColumn(FieldColumnData(fid("Missing"), Nothing)))).toBe(4);
    expect(w("E", ExprColumn(false, "x"))).toBe(10);
    expect(w("E", ExprColumn(true, "x"))).toBe(20);
    expect(w("Q", QueryColumn(U.nil))).toBe(15);
    expect(w("L", LookupColumn(U.nil))).toBe(10);
    expect(w("x".repeat(80), LookupColumn(U.nil))).toBe(30);
    // Stamp fields are not looked up (only built-in and model fields).
    expect(w("S", FieldColumn(FieldColumnData(fid("Created"), Nothing)))).toBe(4);
  });

  it("computes column widths for the other field types", () => {
    const w = (f: string) => {
      const cp = matrixColumn(riskClass, decoModel, 1, MatrixColumn("", FieldColumn(FieldColumnData(fid(f), Nothing))));
      return cp.cpWidth.tag === "Just" ? cp.cpWidth.value : NaN;
    };
    expect(["Done", "Weight", "Notes", "Flag", "Score", "Ratio"].map(w)).toEqual([4, 6, 30, 4, 4, 6]);
  });
});

describe("Dialogs", () => {
  it("picks a single input of the matrix input types", () => {
    const mx = Matrix(Name("M"), "", S.empty(), [
      ColumnGroup(findEntity(model, "Query", "Risks for Controls"), [], SortOrder([])),
    ]);
    const d = matrixExportDialog(riskClass, model, mx);
    expect(d.dialogTitle).toBe("Single Selector");
    expect(d.dialogButtons).toEqual({ tag: "OkButton" });
  });

  it("shows errors and warnings", () => {
    const e = matrixErrorsDialog(["a", "b"]);
    expect(e.dialogTitle).toBe("Matrix Errors");
    expect(e.dialogButtons).toEqual({ tag: "CloseButton", _0: "_Close" });
    expect(e.dialogGadget.tag).toBe("Message");
    expect((e.dialogGadget as any)._0(null, null)).toBe("a\nb\n\nCannot proceed with export.");
    const w = matrixWarningsDialog(["w"]);
    expect(w.dialogTitle).toBe("Matrix Warnings");
    expect(w.dialogButtons).toEqual({ tag: "OkButton" });
    expect((w.dialogGadget as any)._0(null, null))
      .toBe("w\n\nClick \"OK\" to proceed with export, \"Cancel\" to stop.");
  });
});

// ---------------------------------------------------------------------------------------------

describe("The Risk Register matrix of the example model, exported to Excel", () => {
  const matrix = matrixOf("Risk Register");
  let book: any;
  let sheet: any;
  const risks = (exampleJson.modelContents as any[])
    .filter((e) => e.contents.type === "RiskEvent")
    .sort(byName);

  beforeAll(() => {
    const r = matrixCells(riskClass, model, rootPackage(), matrix);
    if (r.tag === "Left") throw new Error(r.value.join("\n"));
    const [cells, warns] = r.value;
    expect(warns).toEqual([]);
    const xlsx = matrixBook(riskClass, model, matrix, "Risk Register - 'Test': [a/b]*?", cells);
    book = dump(fromXlsx(1600000000, xlsx));
    sheet = book.data[book.sheets[0]];
  });

  it("filters the sheet name", () => {
    // Banned characters removed, then one leading and one trailing apostrophe; 31 characters.
    expect(book.sheets).toEqual(["Risk Register - 'Test' ab"]);
  });

  it("puts the column headings in row 2, bold and centred, and leaves row 1 empty", () => {
    expect(sheet.maxRow).toBe(2 + risks.length);
    expect(sheet.maxColumn).toBe(17);
    const headings = matrix._matrixGroups[0]._groupColumns.map((c) => c._columnName);
    for (let c = 1; c <= 17; c++) {
      const cell = sheet.cells[ref(2, c)];
      expect(cell.value).toBe(headings[c - 1]);
      expect(cell.bold).toBe(true);
      expect(cell.fontName).toBe("Roboto");
      expect(cell.horizontal).toBe("center");
      expect(cell.vertical).toBe("center");
      expect(cell.wrap).toBe(true);
      expect(cell.border.left.style).toBe("thin");
      expect(sheet.cells[ref(1, c)]).toBeUndefined();
    }
    expect(sheet.merges).toEqual([]);
  });

  it("writes one row per risk, sorted by name, with bordered cells", () => {
    risks.forEach((risk, i) => {
      const row = 3 + i;
      expect(sheet.cells[ref(row, 1)].value).toBe(risk.contents.name.trim());
      expect(sheet.cells[ref(row, 2)].value).toBe(risk.contents.text);
      expect(sheet.cells[ref(row, 3)].value).toBe(risk.extensions["Business Unit"]?.value ?? null);
      for (let c = 1; c <= 17; c++) {
        const cell = sheet.cells[ref(row, c)];
        expect(cell.bold).toBe(false);
        expect(cell.vertical).toBe("center");
        expect(cell.wrap).toBe(true);
        for (const s of ["left", "right", "top", "bottom"]) expect(cell.border[s].style).toBe("thin");
      }
    });
  });

  it("colours enumeration values and lookup results", () => {
    const enumColour = (field: string, value: string): string => {
      const item = exampleJson.modelFields[field].type.values.find((v: any) => v.name === value);
      return "FF" + item.colour.slice(1).toUpperCase();
    };
    risks.forEach((risk, i) => {
      const row = 3 + i;
      const cat = sheet.cells[ref(row, 4)];
      expect(cat.value).toBe(risk.extensions.Category.value);
      expect(cat.fill).toBe("solid");
      expect(cat.fillFg.rgb).toBe(enumColour("Category", risk.extensions.Category.value));
      expect(cat.fillBg.rgb).toBe(cat.fillFg.rgb);
      // Business unit is plain text: no fill.
      expect(sheet.cells[ref(row, 3)].fill).toBeNull();
    });
    // Lookup: Inherent Probability (horizontal) x Inherent Impact (vertical) -> Inherent Risk Level.
    const table = (exampleJson.modelContents as any[]).find((e) => e.contents.type === "lookup-table" && e.contents.name === "Inherent Risk Level").contents;
    let checked = 0;
    risks.forEach((risk, i) => {
      const h = risk.extensions["Inherent  Probability"]?.value;
      const v = risk.extensions["Inherent  Impact"]?.value;
      const hit = table.values.find(([[x, y]]: any) => x.value === h && y.value === v);
      const cell = sheet.cells[ref(3 + i, 9)];
      if (hit) {
        checked++;
        expect(cell.value).toBe(hit[1].value);
        expect(cell.fillFg.rgb).toBe(enumColour("Inherent Risk Level", hit[1].value));
      } else {
        expect(cell.value).toBeNull();
      }
    });
    expect(checked).toBeGreaterThan(5);
  });

  it("writes dates as day numbers with the d-mmm-yy format", () => {
    let checked = 0;
    risks.forEach((risk, i) => {
      for (const [col, field] of [[10, "Last Modified"], [11, "Last Reviewed"], [12, "Next Review Date"]] as const) {
        const cell = sheet.cells[ref(3 + i, col)];
        const v = risk.extensions[field];
        if (v) {
          checked++;
          expect(cell.numberFormat).toBe("d-mmm-yy");
          expect(cell.value).toEqual({ date: v.value + "T00:00:00" });
          expect(cell.type).toBe("d");
        } else {
          expect(cell.value).toBeNull();
        }
      }
    });
    expect(checked).toBeGreaterThan(30);
    expect(excelDay("2020-05-13")).toBe(43964);
  });

  it("lists the query results as names", () => {
    // "Controls for Risks" follows "Risk Controls" relations from the risk; the names are
    // sorted as Text (code points).
    let nonEmpty = 0;
    risks.forEach((risk, i) => {
      const names = related(risk.identity).map((c) => byId.get(c).contents.name.trim()).sort();
      if (names.length > 0) nonEmpty++;
      const cell = sheet.cells[ref(3 + i, 13)];
      expect(cell.value ?? "").toBe(names.join(", "));
    });
    expect(nonEmpty).toBeGreaterThan(10);
  });

  it("writes hyperlinks as formulas", () => {
    let links = 0;
    risks.forEach((risk, i) => {
      const cell = sheet.cells[ref(3 + i, 17)];
      const url = risk.extensions["Previous Version"]?.value;
      if (url) {
        links++;
        expect(cell.value).toBe(`=HYPERLINK("${url}","${url}")`);
        expect(cell.type).toBe("f");
        expect(cell.wrap).toBe(true);
        expect(cell.border.bottom.style).toBe("thin");
      } else {
        expect(cell.value).toBeNull();
      }
    });
    expect(links).toBeGreaterThan(0);
  });

  it("sets the column widths and row heights", () => {
    const expected = [20, 30, 20, 10, 10, 20, 10, 10.5, 10, 15, 15, 15, 15, 10, 10, 10, 20];
    expected.forEach((w, i) => {
      const d = sheet.widths[String.fromCharCode(65 + i)];
      expect(d.width).toBe(w);
      expect(d.bestFit).toBe(true);
      expect(d.customWidth).toBe(true);
    });
    for (let r = 1; r <= 2 + risks.length; r++) expect(sheet.heights[String(r)]).toBe(10);
  });

  it("reads back with the Xlsx reader", () => {
    const r = matrixCells(riskClass, model, rootPackage(), matrix);
    if (r.tag === "Left") throw new Error("failed");
    const bytes = fromXlsx(0, matrixBook(riskClass, model, matrix, "RR", r.value[0]));
    const back = toXlsxEither(bytes);
    expect(back.tag).toBe("Right");
    if (back.tag === "Right") {
      const [name, ws] = back.value._xlSheets[0];
      expect(name).toBe("RR");
      expect(M.lookup([2, 1] as const, ws._wsCells).tag).toBe("Just");
      expect(ws._wsColumnsProperties.length).toBe(17);
    }
  });
});

describe("A two-level matrix: controls and their risks", () => {
  const controlsQ = findEntity(model, "Query", "Finding Controls");
  const risksQ = findEntity(model, "Query", "Risks for Controls");
  const matrix = Matrix(Name("Controls and risks"), "", S.empty(), [
    ColumnGroup(controlsQ, [
      MatrixColumn("Control", FieldColumn(def_FieldColumnData)),
      MatrixColumn("Status", FieldColumn(FieldColumnData(fid("Control Status"), Nothing))),
    ], SortOrder([[nameField, "Ascending"]])),
    ColumnGroup(risksQ, [
      MatrixColumn("Risk", FieldColumn(def_FieldColumnData)),
      MatrixColumn("Residual Probability", FieldColumn(FieldColumnData(fid("Residual Probability"), Nothing))),
      MatrixColumn("Summary", ExprColumn(false, "Name ++ \" (\" ++ Category ++ \")\"")),
      MatrixColumn("Bad", ExprColumn(true, "Name ++")),
      MatrixColumn("Gone", LookupColumn(U.nil)),
    ], SortOrder([[nameField, "Descending"]])),
  ]);
  const controls = (exampleJson.modelContents as any[])
    .filter((e) => e.contents.type === "Control")
    .sort(byName);
  const risksOf = (c: any): any[] =>
    related(c.identity).map((r) => byId.get(r)).sort((a: any, b: any) => byName(b, a));
  let sheet: any;

  beforeAll(() => {
    const r = matrixCells(riskClass, model, rootPackage(), matrix);
    if (r.tag === "Left") throw new Error(r.value.join("\n"));
    const book = dump(fromXlsx(1600000000, matrixBook(riskClass, model, matrix, "Controls", r.value[0])));
    sheet = book.data.Controls;
  });

  it("has merged group headings in row 1 and column headings in row 2", () => {
    expect(sheet.cells.A1.value).toBe("Finding Controls");
    expect(sheet.cells.C1.value).toBe("Risks for Controls");
    for (const c of ["A1", "C1"]) {
      expect(sheet.cells[c].bold).toBe(true);
      expect(sheet.cells[c].horizontal).toBe("center");
    }
    expect(["A2", "B2", "C2", "D2", "E2", "F2", "G2"].map((c) => sheet.cells[c].value))
      .toEqual(["Control", "Status", "Risk", "Residual Probability", "Summary", "Bad", "Gone"]);
    expect(sheet.merges).toContain("A1:B1");
    expect(sheet.merges).toContain("C1:G1");
    // The cells covered by a merge keep the outer borders of the block.
    expect(sheet.cells.G1.border.right.style).toBe("thin");
    expect(sheet.cells.G1.border.top.style).toBe("thin");
  });

  it("spans each control over the rows of its risks", () => {
    let row = 3;
    const merges: string[] = ["A1:B1", "C1:G1"];
    for (const c of controls) {
      const rs = risksOf(c);
      const h = Math.max(1, rs.length);
      expect(sheet.cells[ref(row, 1)].value).toBe(c.contents.name);
      expect(sheet.cells[ref(row, 2)].value).toBe(c.extensions["Control Status"]?.value ?? null);
      if (h > 1) merges.push(`A${row}:A${row + h - 1}`, `B${row}:B${row + h - 1}`);
      rs.forEach((risk: any, i: number) => {
        const r = row + i;
        expect(sheet.cells[ref(r, 3)].value).toBe(risk.contents.name.trim());
        expect(sheet.cells[ref(r, 4)].value).toBe(risk.extensions["Residual Probability"]?.value ?? null);
        expect(sheet.cells[ref(r, 5)].value).toBe(`${risk.contents.name.trim()} (${risk.extensions.Category.value})`);
        const bad = sheet.cells[ref(r, 6)];
        expect(bad.value.startsWith(risk.contents.name.trim() + ": ")).toBe(true);
        expect(bad.fontColor.rgb).toBe("FFA00000");
        const gone = sheet.cells[ref(r, 7)];
        expect(gone.value).toBe("No such lookup table");
        expect(gone.fontColor.rgb).toBe("FFA00000");
        expect(gone.border.left.style).toBe("thin");
      });
      if (rs.length === 0) expect(sheet.cells[ref(row, 3)]).toBeUndefined();
      row += h;
    }
    expect(sheet.maxRow).toBe(row - 1);
    expect(sheet.merges).toEqual([...merges].sort());
    expect(controls.some((c) => risksOf(c).length === 0)).toBe(true);
    expect(controls.some((c) => risksOf(c).length > 1)).toBe(true);
  });

  it("sets the column widths of both groups", () => {
    expect(["A", "B", "C", "D", "E", "F", "G"].map((c) => sheet.widths[c].width)).toEqual([20, 10, 20, 10, 10, 20, 10]);
  });
});

describe("matrixCells errors", () => {
  it("reports queries that do not compile", () => {
    const mx = Matrix(Name("Broken"), "", S.empty(), [ColumnGroup(U.nil, [MatrixColumn("N", FieldColumn(def_FieldColumnData))], SortOrder([]))]);
    expect(matrixCells(riskClass, model, rootPackage(), mx)).toEqual({
      tag: "Left", value: ["1: Broken: Query does not exist (deleted?)."],
    });
  });

  it("reports a group with no columns in a multi-group matrix as an internal error", () => {
    const q = findEntity(model, "Query", "Finding Controls");
    const mx = Matrix(Name("M"), "", S.empty(), [
      ColumnGroup(q, [MatrixColumn("N", FieldColumn(def_FieldColumnData))], SortOrder([])),
      ColumnGroup(q, [], SortOrder([])),
    ]);
    expect(matrixCells(riskClass, model, rootPackage(), mx)).toEqual({
      tag: "Left", value: ["Internal error: Model library client error: Query group has no columns."],
    });
  });

  it("gives no cells for a matrix with no groups, which matrixBook cannot render", () => {
    const mx = Matrix(Name("Empty"), "", S.empty(), []);
    const r = matrixCells(riskClass, model, rootPackage(), mx);
    expect(r.tag).toBe("Right");
    if (r.tag === "Right") {
      expect(M.size(r.value[0])).toBe(0);
      // As in Haskell (`maximum []`).
      expect(() => matrixBook(riskClass, model, mx, "E", r.value[0])).toThrow("Prelude.maximum: empty list");
    }
  });

  it("returns default cells for an empty entity list", () => {
    const q = findEntity(model, "Query", "Finding Controls");
    const mx = Matrix(Name("Q"), "", S.empty(), [
      ColumnGroup(q, [MatrixColumn("Controls", QueryColumn(U.nil))], SortOrder([])),
    ]);
    const r = matrixCells(riskClass, model, rootPackage(), mx);
    if (r.tag === "Left") throw new Error("failed");
    const cells = M.toList(r.value[0]).filter(([[row]]) => row > 2);
    expect(cells.length).toBe(8);
    for (const [, c] of cells) expect(c._formattedCell._cellValue).toEqual(Just(CellText("No such query")));
    // The formatted cell map can be rendered on its own.
    expect(formatted(r.value[0], minimalStyleSheet).formattedMerges).toEqual([]);
  });
});
