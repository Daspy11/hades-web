// Ported from hades/src/Model/Matrices/Excel.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Export of matrices to Excel spreadsheets.
 *
 * TypeScript port
 * ---------------
 * * `Codec.Xlsx` and `Codec.Xlsx.Formatted` are `@/lib/Codec/Xlsx` and
 *   `@/lib/Codec/Xlsx/Formatted`. A `Map (Int, Int) FormattedCell` is an
 *   `M.Map<readonly [number, number], FormattedCell>` keyed by `[row, column]` (1-based).
 * * Constrained functions take their dictionary first: `matrixExportDialog(cls, model, matrix)`,
 *   `matrixBook(cls, model, matrix, title, cells)`, `matrixCells(cls, model, input, matrix)`.
 *   The `ModelEdit v v` helpers take the dictionary (when they need more than `EntityClass`) and
 *   then the context: `tabulateCell(cls, ctx, outerIds, valueses, column)`,
 *   `makeFieldCell(ctx, fid, value, link)`.
 * * Dialogs with a `()` side channel have `W = null`.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as MP from "@/lib/Text/Megaparsec";
import { Just, Nothing, fromMaybe, listToMaybe, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { fmapTree, type Forest, type Tree } from "@/lib/Data/Tree";
import { diffDays, fromGregorian } from "@/lib/Data/Time";
import { sRGB24show } from "@/lib/Data/Colour";
import { absurd, error } from "@/lib/Prelude";
import { _Just, identity, ix, preview, set, setJust, view } from "@/lib/Control/Lens";
import {
  AutomaticHeight, CellBool, CellDouble, CellFormula, CellText, ColumnsProperties, Formula, NormalFormula,
  RowProps, cellFormula, cellValue, def_Worksheet, def_Xlsx, wsCells, wsColumnsProperties, wsMerges,
  wsRowPropertiesMap, xlSheets, xlStyles,
  type CellValue, type FormulaExpression, type RowProperties, type Xlsx,
} from "@/lib/Codec/Xlsx";
import {
  BorderStyle, Fill, StdNumberFormat, alignmentHorizontal, alignmentVertical, alignmentWrapText, borderBottom,
  borderLeft, borderRight, borderTop, colorARGB, colorAutomatic, def_Alignment, def_Border, def_Color,
  def_FillPattern, def_Font, def_Format, def_FormattedCell, fillPatternBgColor, fillPatternFgColor,
  fillPatternType, fontBold, fontColor, fontFamily, fontName, formatAlignment, formatBorder, formatFill,
  formatFont, formatNumberFormat, formatted, formattedCell, formattedColSpan, formattedFormat,
  formattedRowSpan, minimalStyleSheet, renderStyleSheet,
  type Alignment, type Border, type Font, type Format, type FormattedCell,
} from "@/lib/Codec/Xlsx/Formatted";
import { forestCatMaybe, getColour, type Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  CloseButton, Dialog, OkButton, message1,
  type Dialog_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import {
  current, currentName, entityContents, entityName, entityStampsAsFields, entityVariantProperties, evalModelEdit,
  getModel, goToEntity, goToEntity1, nameText, show_ModelError, throwUser, withStampFields,
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { refPicker } from "@/hades/src/Model/Abstract/Properties";
import { runLookup, tableOutput, type HasLookups } from "@/hades/src/Model/Lookups/Base";
import {
  compileMatrix, groupColumns, groupQuery, groupSort, mapForestM, matrixColumnData, matrixColumnName,
  matrixGroups, matrixInputSet, runMatrix, sortForest, walkForestM,
  type ColumnGroup, type Matrix, type MatrixColumn,
} from "@/hades/src/Model/Matrices/Base";
import { ShowErrorComponent_Text, evaluate, topExpr } from "@/hades/src/Model/Reflection/Parser";
import {
  enumItemColour, enumItemName, fieldType, rangeMap, withBuiltIn,
  type Field, type FieldId,
} from "@/hades/src/Model/Reflection/Types";
import {
  ExtText, _ExtText, displayValue, extValue,
  type ExtValue, type ExtensionValues,
} from "@/hades/src/Model/Reflection/Values";
import { runQuery } from "@/hades/src/Model/Query/Base";
import { compileQueryDiagram, queryDiagram, type Queryable, type QueryableEntityClass } from "@/hades/src/Model/Query/Diagram";

/* Design note:

The code here is irritatingly similar to Model.Report.Base.tabulate, but there are too many
points of difference to make it worth while factoring them out.
*/

/** Formatted cells keyed by `[row, column]`: Haskell `Map (Int, Int) FormattedCell`. */
export type MatrixCells = M.Map<readonly [number, number], FormattedCell>;


/** Dialog to select an input to the matrix. */
export function matrixExportDialog<V>(
  cls: QueryableEntityClass<V>,
  model: Model<V>,
  matrix: Matrix,
): Dialog_<Model<V>, null, S.Set<ModelId>> {
  const inputSet = (m: Model<V>): S.Set<string> => matrixInputSet(cls, matrix, m);
  // (Computed once instead of once per entity; the result is the same.)
  let inputs: S.Set<string> | null = null;
  const inputFilter = (e: Entity<V>): boolean =>
    S.member(cls.reflectiveName(view(entityContents<V>(), e)), inputs ??= inputSet(model));
  return refPicker<V, null>(cls, true, inputFilter);
}


export function matrixErrorsDialog<E = any, A = any>(msgs: readonly T.Text[]): Dialog_<E, null, A> {
  return Dialog("Matrix Errors", CloseButton("_Close"), message1<E, null, A>(
    T.intercalate("\n", msgs) + "\n\nCannot proceed with export."));
}

export function matrixWarningsDialog<E = any, A = any>(msgs: readonly T.Text[]): Dialog_<E, null, A> {
  return Dialog("Matrix Warnings", OkButton, message1<E, null, A>(
    T.intercalate("\n", msgs) + "\n\nClick \"OK\" to proceed with export, \"Cancel\" to stop."));
}


/** Render a set of formatted cells as a single worksheet in an Excel workbook. */
export function matrixBook<V>(
  cls: EntityClass<V>,
  model: Model<V>,
  matrix: Matrix,
  /** Title for the matrix. Illegal characters are filtered. */
  txt: T.Text,
  cells: MatrixCells,
): Xlsx {
  const s = formatted(cells, minimalStyleSheet);
  const allColumns = L.concatMap((g: ColumnGroup) => view(groupColumns, g), view(matrixGroups, matrix));
  const cols = allColumns.map((c, i) => matrixColumn(cls, model, i + 1, c));  // zipWith ... [1..]
  const keys = M.keys(cells);
  // Haskell `maximum` of an empty list is an error (raised when the sheet is written).
  const rowCount = keys.length === 0
    ? error("Prelude.maximum: empty list")
    : L.maximum(keys.map(([r]) => r));
  const rows = M.fromList<number, RowProperties>(
    L.range(1, rowCount).map((r) => [r, RowProps(Just(AutomaticHeight(10)), Nothing, false)] as const));
  const sheet =
    set(wsCells, s.formattedCellMap,
      set(wsColumnsProperties, cols,
        set(wsRowPropertiesMap, rows,
          set(wsMerges, s.formattedMerges, def_Worksheet))));
  // Filter the sheet name to conform to undocumented rules.
  const sheetNameBanned = (c: string): boolean => !"[]*?:/\\".includes(c);
  const apostrophes = (t: T.Text): T.Text => {
    const t1 = T.take(1, t) === "'" ? T.drop(1, t) : t;
    return T.takeEnd(1, t1) === "'" ? T.dropEnd(1, t1) : t1;
  };
  const sheetNameFilter = (t: T.Text): T.Text => T.take(31, apostrophes(T.filter(sheetNameBanned, t)));
  return set(xlSheets, [[sheetNameFilter(txt), sheet] as const],
    set(xlStyles, renderStyleSheet(s.formattedStyleSheet), def_Xlsx));
}


/**
 * Matrix as a set of formatted cells. The output can be passed to the "formatted" function in
 * "Codec.Xlsx.Formatted". The @Left@ value contains error messages while the @Right@ value
 * contains the returned matrix and any warning messages.
 */
export function matrixCells<V>(
  cls: QueryableEntityClass<V> & HasLookups<V>,
  /** Model containing data to export. */
  model: Model<V>,
  /** Matrix input entity. */
  input: ModelId,
  /** Matrix defining data to export. */
  matrix: Matrix,
): Either<T.Text[], [MatrixCells, T.Text[]]> {
  type Cell = FormattedCell;
  type Pos = readonly [number, number];
  // Either monad.
  const compiled = compileMatrix(cls, matrix, model);
  if (compiled.tag === "Left") return Left(compiled.value);
  const queries = compiled.value;
  const [idForest, warnings] = runMatrix(queries, model, S.singleton(input));

  const forestAssign = (pos: Pos, nodes: Forest<readonly Cell[]>): [MatrixCells, number] => {
    if (nodes.length === 0) return [M.empty<Pos, Cell>(), 1];
    const [row, col] = pos;
    // The Haskell ties a lazy knot: each tree starts at "row" plus the heights of the trees
    // before it (scanl (+) row heights).
    const cellss: MatrixCells[] = [];
    let height = 0;
    let r = row;
    for (const node of nodes) {
      const [cells, h] = treeAssign([r, col], node);
      cellss.push(cells);
      height += h;
      r += h;
    }
    return [M.unions(cellss), height];
  };
  const treeAssign = ([row, col]: Pos, node: Tree<readonly Cell[]>): [MatrixCells, number] => {
    const cells = node.rootLabel;
    const [childCells, height] = forestAssign([row, col + cells.length], node.subForest);
    const cells1 = M.fromList<Pos, Cell>(
      cells.map((c, i) => [[row, col + i] as const, set(formattedRowSpan, height, c)] as const));
    return [M.union(cells1, childCells), height];
  };
  const evalModel = <A>(act: (ctx: ModelEditCtx<V, V>) => A): Either<T.Text[], A> => {
    const r = evalModelEdit(cls, identity<V>(), model, act);
    return r.tag === "Left" ? Left(["Internal error: " + T.pack(show_ModelError(r.value))]) : Right(r.value);
  };
  const tabulateRow = (ctx: ModelEditCtx<V, V>, grp: ColumnGroup, vs: readonly (readonly [ModelId, ExtensionValues])[]): Cell[] => {
    const mIds = vs.map(([m]) => m);
    const values = vs.map(([, v]) => v);
    return view(groupColumns, grp).map((c) => tabulateCell(cls, ctx, mIds, values, c));
  };
  const mkHeader = (ctx: ModelEditCtx<V, V>, grp: ColumnGroup): [Cell, Cell[]] => {
    const heads = view(groupColumns, grp).map((c) => view(matrixColumnName, c));
    if (heads.length === 0) throwUser("Query group has no columns.");
    goToEntity1(ctx, "The matrix uses a deleted query.", view(groupQuery, grp));
    const queryName = currentName(ctx);
    const h1 = set(formattedColSpan, heads.length, makeHeaderCell(queryName));
    const h2 = heads.map(makeHeaderCell);
    return [h1, h2];
  };
  // Assign coordintates to headers starting at (x,y) in the top left.
  const headerAssign = ([row, col]: Pos, pairs: readonly (readonly [Cell, readonly Cell[]])[]): [Pos, Cell][] => {
    if (pairs.length === 0) return [];
    const [[h1, h2], ...rest] = pairs;
    return [
      [[row, col], h1],
      ...h2.map((h, i): [Pos, Cell] => [[row + 1, col + i], h]),
      ...headerAssign([row, col + h2.length], rest),
    ];
  };

  const r = evalModel((ctx): [MatrixCells, T.Text[]] => {
    const groups = view(matrixGroups, matrix);
    const sorts = groups.map((g) => view(groupSort, g));
    let headers: [Pos, Cell][];
    if (groups.length === 0) {
      headers = [];
    } else if (groups.length === 1) {
      const hr = view(groupColumns, groups[0]).map((c) => makeHeaderCell(view(matrixColumnName, c)));
      headers = hr.map((h, i): [Pos, Cell] => [[2, i + 1], h]);
    } else {
      headers = headerAssign([1, 1], groups.map((g) => mkHeader(ctx, g)));
    }
    const forest1 = sortForest(cls, sorts, forestCatMaybe(mapForestM((i: ModelId) => {
      goToEntity(ctx, i);
      return current(ctx);
    }, idForest)));
    const forest2 = walkForestM(
      groups.map((g) => (vs: readonly (readonly [ModelId, ExtensionValues])[]) => tabulateRow(ctx, g, vs)),
      forest1.map((t) => fmapTree((ent: Entity<V>) => [
        ent.entityId,
        M.union(entityStampsAsFields(cls, ent), view(entityVariantProperties(cls, model), ent)),
      ] as const, t)),
    );
    return [M.union(M.fromList<Pos, Cell>(headers), forestAssign([3, 1], forest2)[0]), warnings];
  });
  return r;
}

/**
 * Display a cell. The extension values should match the model IDs; they are passed down
 * separately to reduce computation.
 */
export function tabulateCell<V>(
  cls: EntityClass<V> & HasLookups<V> & Queryable<V>,
  ctx: ModelEditCtx<V, V>,
  outerIds: readonly ModelId[],
  valueses: readonly ExtensionValues[],
  c: MatrixColumn,
): FormattedCell {
  if (outerIds.length === 0) return def_FormattedCell;
  const modelId = outerIds[0];
  const warningFont: Maybe<Font> = Just(setJust(fontColor, setJust(colorARGB, "FFA00000", def_Color), def_Font));
  const warningCell = (txt: T.Text): FormattedCell =>
    setJust(formattedCell.dot(cellValue), CellText(txt),
      set(formattedFormat.dot(formatFont), warningFont, def_FormattedCell));
  const values: ExtensionValues = fromMaybe(M.empty<FieldId, ExtValue>(), listToMaybe(valueses));
    // This entity
  const allValues: ExtensionValues = M.unions(valueses);
    // This entity and all its parents in the results tree.
  goToEntity(ctx, modelId);
  const ent = current(ctx);
  const nm = currentName(ctx);
  const model = getModel(ctx);
  const d = view(matrixColumnData, c);
  let result: FormattedCell;
  switch (d.tag) {
    case "FieldColumn": {
      const fname = d._0._fieldColumnText, lname = d._0._fieldColumnLink;
      const link: Maybe<T.Text> = lname.tag === "Nothing"
        ? Nothing
        : preview(extValue<FieldId>(lname.value).dot(_ExtText), values);
      result = makeFieldCell(ctx, fname, view(extValue<FieldId>(fname), values), link);
      break;
    }
    case "ExprColumn": {
      const expr = d._1;
      const allFields = withStampFields(withBuiltIn(model.modelFields));
      const parsed = MP.parse(topExpr(cls.entityFunctions, allFields), "", expr);
      if (parsed.tag === "Left") {
        result = warningCell(nm + ": " + T.pack(MP.parseErrorTextPretty(ShowErrorComponent_Text,
          L.head(parsed.value.bundleErrors))));
      } else {
        const stamps = ent.tag === "Just" ? entityStampsAsFields(cls, ent.value) : M.empty<FieldId, ExtValue>();
        const v = evaluate(parsed.value, M.union(stamps, allValues), model);
        result = v.tag === "Left" ? warningCell(nm + ": " + v.value) : extValueToExcel(v.value, Nothing);
      }
      break;
    }
    case "QueryColumn": {
      const queryId = d._0;
      const getName = (mId: ModelId): Maybe<T.Text> => {
        const e = M.lookup(mId, model.modelContents);
        return e.tag === "Just" ? Just(view(entityName(cls).dot(nameText), e.value)) : Nothing;
      };
      const resultNames = (s: S.Set<ModelId>): T.Text => T.intercalate(", ", L.sort(mapMaybe(getName, S.toList(s))));
      const r = ((): Either<T.Text[], T.Text> => {  // Either monad
        const queryEnt = M.lookup(queryId, model.modelContents);
        if (queryEnt.tag === "Nothing") return Left(["No such query"]);
        const qd = preview(entityContents<V>().dot(cls._QueryDiagram).dot(queryDiagram<V>()), queryEnt.value);
        if (qd.tag === "Nothing") return Left([view(entityName(cls).dot(nameText), queryEnt.value) + " is not a query"]);
        const qry = compileQueryDiagram(cls, model, qd.value);
        if (qry.tag === "Left") return qry;
        return Right(resultNames(runQuery(qry.value, outerIds, model, S.singleton(modelId))[0]));
      })();
      result = r.tag === "Left"
        ? warningCell(fromMaybe("", listToMaybe(r.value)))
        : extValueToExcel(ExtText(r.value), Nothing);
      break;
    }
    case "LookupColumn": {
      const tableId = d._0;
      const r = ((): Either<T.Text, readonly [ExtValue, FieldId]> => {  // Either monad
        const tableEnt = M.lookup(tableId, model.modelContents);
        if (tableEnt.tag === "Nothing") return Left("No such lookup table");
        const tbl = preview(entityContents<V>().dot(cls._LookupTable), tableEnt.value);
        if (tbl.tag === "Nothing") return Left(view(entityName(cls).dot(nameText), tableEnt.value) + " is not a lookup table");
        return Right([runLookup(tbl.value, allValues), view(tableOutput, tbl.value)] as const);
      })();
      result = r.tag === "Left" ? warningCell(r.value) : makeFieldCell(ctx, r.value[1], r.value[0], Nothing);
      break;
    }
    default:
      return absurd(d);
  }
  return set(formattedFormat.dot(formatBorder), matrixBorders,
    set(formattedFormat.dot(formatAlignment), matrixAlignment, result));
}


/** Generate a cell formatted as a column header. */
export function makeHeaderCell(txt: T.Text): FormattedCell {
  const fmt =
    setJust(formatFont.dot(_Just<Font>()).dot(fontBold), true,
      setJust(formatAlignment.dot(_Just<Alignment>()).dot(alignmentHorizontal), "CellHorizontalAlignmentCenter",
        matrixFormat));
  return setJust(formattedCell.dot(cellValue), CellText(txt), set(formattedFormat, fmt, def_FormattedCell));
}


/**
 * Convert an Extension Value to an Excel cell, along with the default format for the type. The
 * text argument is an optional hyperlink.
 */
export function extValueToExcel(v: ExtValue, link: Maybe<T.Text>): FormattedCell {
  const excelEpoch = fromGregorian(1899, 12, 30);    // Day zero in Excel. Yes, its the 30th not 31st.
  const excelEscape = (t: T.Text): T.Text => T.replace("\"", "\"\"", t);
  const hyperlink = (txt: T.Text): FormulaExpression => NormalFormula(Formula(
    "HYPERLINK(\"" + excelEscape(txt) + "\",\"" + excelEscape(displayValue(v)) + "\")"));
  let cv: Maybe<CellValue>;
  let cf: Format;
  switch (v.tag) {
    case "ExtNone": cv = Nothing; cf = def_Format; break;
    case "ExtBool": cv = Just(CellBool(v._0)); cf = def_Format; break;
    case "ExtInt": cv = Just(CellDouble(v._0)); cf = def_Format; break;
    case "ExtReal": cv = Just(CellDouble(v._0)); cf = def_Format; break;
    case "ExtText":
      cv = Just(CellText(v._0));
      cf = setJust(formatAlignment, setJust(alignmentWrapText, true, def_Alignment), def_Format);
      break;
    case "ExtDate":
      cv = Just(CellDouble(diffDays(v._0, excelEpoch)));
      cf = setJust(formatNumberFormat, StdNumberFormat("NfDMmmYy"), def_Format);
      break;
    default: return absurd(v);
  }
  if (link.tag === "Nothing") {
    return set(formattedCell.dot(cellValue), cv, set(formattedFormat, cf, def_FormattedCell));
  }
  return setJust(formattedCell.dot(cellFormula), CellFormula(hyperlink(link.value), false, true),
    set(formattedFormat, cf, def_FormattedCell));
}

/** Format an extension value according to the field type. */
export function makeFieldCell<V>(
  ctx: ModelEditCtx<V, V>,
  /** Field name to display. */
  fid: FieldId,
  /** Value of the field. */
  v: ExtValue,
  /** Optional link URL. */
  link: Maybe<T.Text>,
): FormattedCell {
  const addColour = (c: Colour, cell: FormattedCell): FormattedCell => {
    const hex = T.pack(sRGB24show(getColour(c)).slice(1));  // sRGB24show adds a leading '#'.
    const argb = setJust(colorARGB, "FF" + T.toUpper(hex), def_Color);
    const fill = Fill(Just(
      setJust(fillPatternType, "PatternTypeSolid",
        setJust(fillPatternBgColor, argb,  // Not sure we need this, but never mind.
          setJust(fillPatternFgColor, argb, def_FillPattern)))));
    return setJust(formattedFormat.dot(formatFill), fill, cell);
  };
  const fields = withBuiltIn(getModel(ctx).modelFields);
  const baseCell = extValueToExcel(v, link);
  const typ = preview(ix<FieldId, Field>(fid).dot(fieldType), fields);
  if (typ.tag === "Nothing") return baseCell;
  const t = typ.value;
  switch (t.tag) {
    case "BuiltInDef":
      return baseCell;
    case "DecoBoolDef": {
      const deco = t._0;
      if (deco.tag === "DecoRange") return baseCell;  // Cannot happen.
      if (deco._1.tag === "Nothing") return baseCell;
      const [cf, ct] = deco._1.value;
      if (v.tag === "ExtBool") return v._0 ? addColour(ct, baseCell) : addColour(cf, baseCell);
      return baseCell;
    }
    case "DecoIntDef": {
      const deco = t._0;
      if (deco.tag !== "DecoRange") return baseCell;  // Cannot happen (DecoBool is only for Bool).
      if (v.tag === "ExtInt") {
        const r = rangeMap(deco._1, v._0);
        return r.tag === "Just" && r.value[1].tag === "Just" ? addColour(r.value[1].value, baseCell) : baseCell;
      }
      return baseCell;
    }
    case "DecoRealDef": {
      const deco = t._0;
      if (deco.tag !== "DecoRange") return baseCell;  // Cannot happen (DecoBool is only for Bool).
      if (v.tag === "ExtReal") {
        const r = rangeMap(deco._1, v._0);
        return r.tag === "Just" && r.value[1].tag === "Just" ? addColour(r.value[1].value, baseCell) : baseCell;
      }
      return baseCell;
    }
    case "EnumDef": {
      if (v.tag !== "ExtText") return baseCell;
      const e = L.find((item) => v._0 === view(enumItemName, item), t._0);
      const c = e.tag === "Just" ? view(enumItemColour, e.value) : Nothing;
      return c.tag === "Just" ? addColour(c.value, baseCell) : baseCell;
    }
    default:
      return absurd(t);
  }
}


/** Black border around each cell. */
export const matrixBorders: Maybe<Border> = (() => {
  const s: Maybe<BorderStyle> = Just(BorderStyle(Just(setJust(colorAutomatic, true, def_Color)), Just("LineStyleThin")));
  return Just(set(borderLeft, s, set(borderTop, s, set(borderRight, s, set(borderBottom, s, def_Border)))));
})();


/** Vertically centered, text wrapped. Horizontal alignment left at default. */
export const matrixAlignment: Maybe<Alignment> = Just(
  setJust(alignmentVertical, "CellVerticalAlignmentCenter",
    setJust(alignmentWrapText, true, def_Alignment)));


/** Roboto font. */
export const matrixFont: Maybe<Font> = Just(
  setJust(fontName, "Roboto",
    setJust(fontFamily, "FontFamilySwiss", def_Font)));


/** Basic format. Specifies Alignment, Border and Font. */
export const matrixFormat: Format =
  set(formatAlignment, matrixAlignment,
    set(formatBorder, matrixBorders,
      set(formatFont, matrixFont, def_Format)));


/** Matrix column data converted to Excel column data. First argument is the Excel column number. */
export function matrixColumn<V>(_cls: EntityClass<V>, model: Model<V>, n: number, col: MatrixColumn): ColumnsProperties {
  const widthLimit = 30;  // Maximum column width in characters.
  const headingWidth = T.length(view(matrixColumnName, col)) / 2;
  const d = view(matrixColumnData, col);
  let typeWidth: number;
  switch (d.tag) {
    case "FieldColumn": {
      const t = preview(ix<FieldId, Field>(d._0._fieldColumnText).dot(fieldType), withBuiltIn(model.modelFields));
      if (t.tag === "Nothing") {
        typeWidth = 4;
      } else {
        switch (t.value.tag) {
          case "BuiltInDef": {
            const bt = t.value._0;
            switch (bt) {
              case "ModelBool": typeWidth = 4; break;
              case "ModelInt": typeWidth = 4; break;
              case "ModelReal": typeWidth = 6; break;
              case "ModelText": typeWidth = 20; break;
              case "ModelURL": typeWidth = 20; break;
              case "ModelNote": typeWidth = 40; break;
              case "ModelDate": typeWidth = 15; break;
              default: return absurd(bt);
            }
            break;
          }
          case "DecoBoolDef": typeWidth = 4; break;
          case "DecoIntDef": typeWidth = 4; break;
          case "DecoRealDef": typeWidth = 6; break;
          case "EnumDef": typeWidth = 10; break;
          default: return absurd(t.value);
        }
      }
      break;
    }
    case "ExprColumn": typeWidth = d._0 ? 20 : 10; break;
    case "QueryColumn": typeWidth = 15; break;
    case "LookupColumn": typeWidth = 10; break;
    default: return absurd(d);
  }
  const colWidth = Math.min(widthLimit, Math.max(headingWidth, typeWidth));
  return ColumnsProperties({
    cpMin: n,
    cpMax: n,
    cpWidth: Just(colWidth),
    cpStyle: Nothing,
    cpHidden: false,
    cpCollapsed: false,
    cpBestFit: true,
  });
}
