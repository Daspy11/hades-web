// Ported from hades/src/Model/Abstract/Import.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Import of Excel spreadsheets into a model.
 *
 * TypeScript port
 * ---------------
 * * `Codec.Xlsx` is replaced by the data model in `@/lib/Codec/Xlsx`. Reading a spreadsheet file
 *   into an `Xlsx` value is done by the caller; everything here is pure apart from the model edit.
 * * `ModelEdit` functions take the `ModelEditCtx` first (PORTING.md §7.4); the `EntityClass`
 *   and `Reflective` dictionary is `ctx.cls`.
 * * The `State ExtensionValues` block in "importEntity" uses a `StateCell` (PORTING.md §12,
 *   "Reflective instances").
 */
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe, catMaybes, mapMaybe, orElse } from "@/lib/Data/Maybe";
import { Left, Right, type Either, partitionEithers } from "@/lib/Data/Either";
import { addDays, fromGregorian, type Day } from "@/lib/Data/Time";
import { preview, review, view, type StateCell } from "@/lib/Control/Lens";
import { floor, round, showBool, showDouble } from "@/lib/Prelude";
import {
  type CellValue, type Worksheet, type Xlsx, cellValue, wsCells, xlDateBase, xlSheets,
} from "@/lib/Codec/Xlsx";
import {
  type EntityClass, type ModelEditCtx, type ModelId, Name, Package,
  currentChildren, current, currentId, currentName, entityStampFields, followPath, getModel,
  goToEntity, mkEntity, nameField, nameText, setData, throwUser,
} from "./PackageTree";
import { extract } from "@/hades/src/Model/Reflection/Reflective";
import {
  type Field, type FieldTable, type TypeDef, fieldType, fieldsByName, withBuiltIn,
} from "@/hades/src/Model/Reflection/Types";
import {
  type ExtValue, type ExtensionValues, ExtBool, ExtDate, ExtInt, ExtReal, ExtText, _ExtInt,
} from "@/hades/src/Model/Reflection/Values";
import {
  datePrism, longDate, shortDate, textPrismDouble, textPrismInt,
} from "@/banana-ui/base/Reactive/Banana/Common";

/** Action to take when an imported entity shares the same name as an existing entity. */
export type NameClashAction =
  /** Cancel the entire import. */
  | "CancelClash"
  /** Merge with the existing entity. */
  | "MergeClash"
  /** Drop the imported entity. */
  | "DropClash";
export const nameClashActionValues: readonly NameClashAction[] = ["CancelClash", "MergeClash", "DropClash"];

/** `instance Show NameClashAction` */
export function show_NameClashAction(c: NameClashAction): string {
  switch (c) {
    case "CancelClash": return "Cancel import";
    case "MergeClash": return "Merge with existing entities";
    case "DropClash": return "Drop imported entities";
  }
}

/**
 * Import an Excel spreadsheet into the model at the current location.
 * Fails if the type cannot be imported here.
 *
 * @param template Template value for imports. Generally from "reflectiveDefaults".
 */
export function importExcel<V>(
  ctx: ModelEditCtx<V, V>,
  clash: NameClashAction,
  book: Xlsx,
  template: V,
): T.Text[] {
  const cls = ctx.cls;
  // Dummy value used to test if the template can be imported into root.
  const dummyRoot = review(cls._Package, Package<V>(Name("dummy root"), cls.packageMetaMempty));
  const typeError = (nm: T.Text): never =>
    throwUser(ctx,
      "Cannot import " + cls.variantUserLabel(cls.reflectiveName(template)) +
      " entities into " + nm);
  // Get a sensible error now rather than a wierd one later on.
  const ent = current(ctx);
  const nm = currentName(ctx);
  if (ent.tag === "Just") {
    if (!cls.entityCanHaveChild(ent.value._entityContents, template)) typeError(nm);
  } else {
    if (!cls.entityCanHaveChild(dummyRoot, template)) typeError(nm);
  }
  const fields = getModel(ctx).modelFields;
  const parentId = currentId(ctx);
  const d = xlsFindData(fields, book);
  if (d.tag === "Left") return throwUser(ctx, d.value);
  return importEntities(ctx, clash, parentId, template, d.value);
}

/**
 * Create a new entity from the extension values. Fails if the import has no name.
 *
 * This allows the import of fields which are not currently defined for the entity.
 *
 * @param clash If "CancelClash" then fail, otherwise just a warning message.
 * @param parentId Parent for the new entity.
 * @param base Template value. Generally from "reflectiveDefaults"
 * @param exts Values to import.
 */
function importEntity<V, W>(
  ctx: ModelEditCtx<V, W>,
  clash: NameClashAction,
  parentId: ModelId,
  base: V,
  exts: ExtensionValues,
): Maybe<T.Text> {
  const cls = ctx.cls;
  // (v, exts2) = flip runState exts $ do ...
  const st: StateCell<ExtensionValues> = { state: exts };
  for (const k of M.keys(entityStampFields)) extract(st, 0, _ExtInt, k); // Ignore stamp field values.
  const v = cls.reflectiveSet(st, base);
  const exts2 = st.state;
  const nm = view(cls.name.dot(nameText), v);
  if (nm === "") throwUser(ctx, "Entity with no name");
  goToEntity(ctx, parentId);
  const childs = currentChildren(ctx);
  if (M.member(Name(nm), childs)) {
    switch (clash) {
      case "CancelClash":
        return throwUser(ctx, "Duplicate name: " + nm);
      case "MergeClash":
        followPath(ctx, [Name(nm)]);
        setData(ctx, exts2);
        return Just("Merged with existing: " + nm);
      case "DropClash":
        return Just("Dropped duplicate: " + nm);
    }
  } else {
    const ent = mkEntity(ctx, v);
    goToEntity(ctx, ent.entityId);
    setData(ctx, exts2);
    return Nothing;
  }
}

/**
 * Create new entities from a list of extension values. Returns a list of any warnings.
 *
 * @param clash If "CancelClash" then fail, otherwise just a warning message.
 * @param parentId Parent for the new entity
 * @param base Template value.
 */
function importEntities<V, W>(
  ctx: ModelEditCtx<V, W>,
  clash: NameClashAction,
  parentId: ModelId,
  base: V,
  exts: readonly ExtensionValues[],
): T.Text[] {
  return catMaybes(exts.map((e) => importEntity(ctx, clash, parentId, base, e)));
}

/** Excel spreadsheet row. */
export type XlsRow = M.Map<number, CellValue>;

/**
 * Find a block of rows all the same length starting with a row of text cells
 * that includes \"Name\".
 * The field table is used to ensure that the resulting extension values have the
 * correct type.
 */
export function xlsFindData(fields: FieldTable, book: Xlsx): Either<T.Text, ExtensionValues[]> {
  const xlsEpoch: Day = (() => {
    switch (view(xlDateBase, book)) {
      case "DateBase1900": return fromGregorian(1899, 12, 30); // Yes, its the 30th not 31st.
      case "DateBase1904": return fromGregorian(1904, 1, 1);
    }
  })();
  const findHeader = (rows: readonly XlsRow[]): Maybe<[readonly [number, Field[]], XlsRow[]]> => {
    for (let i = 0; i < rows.length; i++) {
      const h = goodHeaderRow(fields, rows[i]);
      if (h.tag === "Just") return Just([h.value, rows.slice(i + 1)]);
    }
    return Nothing;
  };
  const dataRows = (hdr: readonly [number, readonly Field[]], rows: readonly XlsRow[]): ExtensionValues[] =>
    mapMaybe((row: XlsRow) => goodDataRow(xlsEpoch, hdr, row), rows);
  const sheetExtract = ([nm, sheet]: readonly [T.Text, Worksheet]): Either<T.Text, ExtensionValues[]> => {
    const found = findHeader(L.concatMap(([, rs]) => rs, contiguous(xlsRows(sheet))));
    if (found.tag === "Nothing") return Left("Sheet " + nm + " has no header rows.");
    const [hdrs, ds] = found.value;
    if (ds.length === 0) return Left("Sheet " + nm + " has a header row but no data.");
    const xs = dataRows(hdrs, ds);
    if (xs.length === 0) return Left("Sheet " + nm + " data rows were all invalid.");
    return Right(xs);
  };
  const sheets = view(xlSheets, book);
  if (sheets.length === 0) return Left("No worksheets found in Excel file.");
  const [fails, rs] = partitionEithers(sheets.map(sheetExtract));
  if (rs.length === 0) return Left("No data could be imported:" + fails.map((f) => "\n   " + f).join(""));
  return Right(L.concat(rs));
}

/** Extract the rows from a WorkSheet. */
export function xlsRows(sheet: Worksheet): M.Map<number, XlsRow> {
  const f = ([x, y]: readonly [readonly [number, number], Maybe<CellValue>]): Maybe<[readonly [number, number], CellValue]> =>
    y.tag === "Just" ? Just([x, y.value]) : Nothing;
  const contents: [number, [number, CellValue][]][] =
    L.groupBy(
      (a: [readonly [number, number], CellValue], b: [readonly [number, number], CellValue]) => a[0][0] === b[0][0],
      L.sortOn(
        (p: [readonly [number, number], CellValue]) => p[0][0],
        mapMaybe(f, M.toList(view(wsCells, sheet)).map(([k, c]) => [k, view(cellValue, c)] as const)),
      ),
    ).map((xss): [number, [number, CellValue][]] =>
      // Factor out row num. "head" is safe because groupBy never produces empty sublists.
      [L.head(xss)[0][0], xss.map(([k, v]): [number, CellValue] => [k[1], v])]);
  return M.fromList(contents.map(([r, cs]): [number, XlsRow] => [r, M.fromList(cs)]));
}

/**
 * A row containing exactly one contiguous block of 2 or more text cells including one that says
 * \"Name\". Returns the starting column and the field IDs. Unrecognised fields are silently
 * ignored.
 */
export function goodHeaderRow(ftable: FieldTable, row: XlsRow): Maybe<[number, Field[]]> {
  const nameTable = fieldsByName(withBuiltIn(ftable));
  // _CellText = prism CellText $ \case {CellText txt -> Right txt; v -> Left v}
  // This is likely to be added to the xlsx library at some point.
  const cellText = (c: CellValue): Maybe<T.Text> => (c.tag === "CellText" ? Just(c._0) : Nothing);
  const blocks = contiguous(row);
  if (blocks.length !== 1) return Nothing;
  const [c, cells] = blocks[0];
  if (!(cells.length > 1)) return Nothing;
  const headNames: T.Text[] = [];
  for (const cell of cells) {
    const t = cellText(cell);
    if (t.tag === "Nothing") return Nothing;
    headNames.push(t.value);
  }
  const heads = mapMaybe((n: T.Text) => M.lookup(n, nameTable), headNames);
  if (!L.elem(nameField, heads.map((h) => h.fieldId))) return Nothing;
  return Just([c, heads]);
}

/**
 * The row is a valid data row if it contains no cells outside the header and at least one cell
 * within it. The field table is used to ensure that the resulting extension values have the
 * correct type.
 *
 * @param excelEpoch Excel zero day for this spreadsheet.
 * @param hdr As returned by "goodHeaderRow"
 */
export function goodDataRow(
  excelEpoch: Day,
  [s, hdrs]: readonly [number, readonly Field[]],
  row: XlsRow,
): Maybe<ExtensionValues> {
  const minEntry = M.lookupMin(row); // Fails if row is empty, which is what we want.
  if (minEntry.tag === "Nothing") return Nothing;
  const minKey = minEntry.value[0];
  if (!(s <= minKey)) return Nothing;
  const pairs = mapMaybe(([i, f]: [number, Field]): Maybe<[string, ExtValue]> => {
    const cell = M.lookup(i, row);
    if (cell.tag === "Nothing") return Nothing;
    const v = typeConversion(excelEpoch, view(fieldType, f), cell.value);
    return v.tag === "Just" ? Just([f.fieldId, v.value]) : Nothing;
  }, hdrs.map((f, j): [number, Field] => [s + j, f]));
  return Just(M.fromList(pairs));
}

/**
 * Convert an Excel value into an extension value if possible. First argument is the Excel
 * epoch date for converting numbers into dates.
 */
export function typeConversion(excelEpoch: Day, t: TypeDef, c: CellValue): Maybe<ExtValue> {
  const readInt = (): Maybe<ExtValue> => {
    const r = preview(textPrismInt, extractText(c));
    return r.tag === "Just" ? Just(ExtInt(r.value)) : Nothing;
  };
  const readReal = (): Maybe<ExtValue> => {
    const r = preview(textPrismDouble, extractText(c));
    return r.tag === "Just" ? Just(ExtReal(r.value)) : Nothing;
  };
  switch (t.tag) {
    case "BuiltInDef":
      switch (t._0) {
        case "ModelBool":
          return c.tag === "CellBool" ? Just(ExtBool(c._0)) : Nothing;
        case "ModelInt":
          return c.tag === "CellDouble" ? Just(ExtInt(round(c._0))) : readInt();
        case "ModelReal":
          return c.tag === "CellDouble" ? Just(ExtReal(c._0)) : readReal();
        case "ModelText":
          return Just(ExtText(extractText(c)));
        case "ModelURL":
          return Just(ExtText(extractText(c)));
        case "ModelNote":
          return Just(ExtText(extractText(c)));
        case "ModelDate": {
          if (c.tag === "CellDouble") return Just(ExtDate(addDays(floor(c._0), excelEpoch)));
          const txt = extractText(c);
          const d = orElse(preview(datePrism(longDate), txt), () => preview(datePrism(shortDate), txt));
          return d.tag === "Just" ? Just(ExtDate(d.value)) : Nothing;
        }
        default:
          return Nothing;
      }
    case "DecoBoolDef":
      return c.tag === "CellBool" ? Just(ExtBool(c._0)) : Nothing;
    case "DecoIntDef":
      return c.tag === "CellDouble" ? Just(ExtInt(round(c._0))) : readInt();
    case "DecoRealDef":
      return c.tag === "CellDouble" ? Just(ExtReal(c._0)) : readReal();
    case "EnumDef":
      return Just(ExtText(extractText(c)));
    default:
      return Nothing;
  }
}

/** The text representation of an Excel value. */
export function extractText(c: CellValue): T.Text {
  switch (c.tag) {
    case "CellText": return c._0;
    case "CellDouble": return showDouble(c._0);
    case "CellBool": return showBool(c._0);
    case "CellRich": return T.concat(c._0.map((r) => r._richTextRunText));
    case "CellError": return "";
  }
}

/** Find contiguous blocks of keys. */
export function contiguous<V>(m: M.Map<number, V>): [number, V[]][] {
  // block :: (Int, Int) -> (Int, [v])
  const block = ([s, n]: [number, number]): [number, V[]] =>
    [s, mapMaybe((i: number) => M.lookup(i, m), L.range(s, s + n - 1))];
  // Start value and length of contiguous indexes.
  // (Haskell: runs (x1:xs) = go x1 1 xs, where go s n (x2:xs2) | x2 == x1 + n = go s (n+1) xs2
  //  | otherwise = (x1, n) : runs (x2:xs2); written as a loop.)
  const runs = (xs: readonly number[]): [number, number][] => {
    const result: [number, number][] = [];
    if (xs.length === 0) return result;
    let x1 = xs[0];
    let n = 1;
    for (let i = 1; i < xs.length; i++) {
      const x2 = xs[i];
      if (x2 === x1 + n) {
        n++;
      } else {
        result.push([x1, n]);
        x1 = x2;
        n = 1;
      }
    }
    result.push([x1, n]);
    return result;
  };
  return runs(M.keys(m)).map(block);
}
