// Ported from hades/src/Model/Matrices/Base.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Matrix definitions: a matrix is a list of column groups, each with a query and a list of
 * columns. Running the queries of a matrix produces a forest of entities, one level per group.
 *
 * TypeScript port
 * ---------------
 * * `class (Queryable a) => HasMatrices a` is the dictionary interface `HasMatrices<A>`, which
 *   extends `Queryable<A>` and adds the member `_Matrix: Prism<A, Matrix>`.
 * * Records (`FieldColumnData`, `MatrixColumn`, `ColumnGroup`, `Matrix`) are readonly interfaces
 *   with the Haskell field names and constructor functions of the same name. All lenses are
 *   constants (`fieldColumnText`, `matrixColumnName`, `groupSort`, `matrixGroups`, ...).
 * * `MatrixColumnData` is a tagged union (`FieldColumn(f)`, `ExprColumn(isMemo, expr)`,
 *   `QueryColumn(qId)`, `LookupColumn(tId)`); its prisms are constants. `_ExprColumn` focuses on a
 *   `readonly [boolean, Text]` pair.
 * * `SortDir` is the string enumeration `"Ascending" | "Descending"` (`sortDirValues`, compare
 *   with `enumComparator(sortDirValues)` if the derived `Ord` is needed).
 * * `newtype SortOrder = SortOrder {getSortOrder :: [(FieldId, SortDir)]}` has its own JSON
 *   instances, so it is the record `{ getSortOrder }` built with `SortOrder(pairs)`. The
 *   function `getSortOrder(so)` is the Haskell field accessor.
 * * Instances: `JSON_FieldColumnData`, `def_FieldColumnData`, `show_FieldColumnData`,
 *   `JSON_MatrixColumn`, `show_MatrixColumnData`, `show_MatrixColumn`, `JSON_SortDir`,
 *   `show_SortDir`, `JSON_SortOrder`, `JSON_ColumnGroup`, `JSON_Matrix`, `Reflective_Matrix`.
 *   The derived `Eq` instances are the structural `equals`.
 * * Constrained functions take their dictionary first: `matrixInputSet(cls, matrix, model)`,
 *   `compileMatrix(cls, matrix, model)` with `cls: QueryableEntityClass<V>`, and
 *   `sortForest(cls, sorts, forest)`, `sortTree(cls, sorts, tree)` with `cls: EntityClass<V>`.
 *   `runMatrix(queries, model, inputs)` and `compareValues(order, e1, e2)` take none.
 * * `mapTreeM`, `mapForestM` and `walkForestM` are generic over any `Monad m`. They are written in
 *   direct style (like `walkM` in `Model.Report.Walkable`): the monadic function `a -> m b`
 *   becomes a function `(a) => B` that performs its effects when it is called, for instance a
 *   `ModelEdit` closure over its `ModelEditCtx`. The functions call it in exactly the order in
 *   which the Haskell sequences the effects (pre-order: a node before its children, siblings left
 *   to right).
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import { Nothing, fromMaybe, mapMaybeValue, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, partitionEithers, type Either } from "@/lib/Data/Either";
import { EQ, compare, type Ordering } from "@/lib/Data/Ord";
import { Node, flattenForest, fmapTree, type Forest, type Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  ix, ixList, lens, preview, prism, set, view,
  type Lens, type Prism, type StateCell,
} from "@/lib/Control/Lens";
import {
  JSON_Name, Name, checkType, descriptionField, entityContents, entityPropertiesWithStamps,
  nameField, nameText,
  type Entity, type EntityClass, type Model, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { defaultVariantUserLabel, extract, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { fieldName, migrateField1, type FieldId, type FieldTable } from "@/hades/src/Model/Reflection/Types";
import {
  ExtText, Variant, _ExtText,
  type ExtValue, type ExtensionValues,
} from "@/hades/src/Model/Reflection/Values";
import { runQuery, type Query, type QueryId } from "@/hades/src/Model/Query/Base";
import {
  compileQueryDiagram, queryDiagram, queryInputs,
  type Queryable, type QueryableEntityClass,
} from "@/hades/src/Model/Query/Diagram";

// ---------------------------------------------------------------------------------------------
// Types

export type MatrixId = ModelId;

/** Prism for the matrix in a model entity. */
export interface HasMatrices<A> extends Queryable<A> {
  readonly _Matrix: Prism<A, Matrix>;
}

/**
 * Directly maps one or two fields in the entity to a cell in the matrix. The optional second
 * field is a URL which is displayed as the target of a hyperlink.
 */
export interface FieldColumnData {
  readonly _fieldColumnText: FieldId;
  readonly _fieldColumnLink: Maybe<FieldId>;
}

export function FieldColumnData(_fieldColumnText: FieldId, _fieldColumnLink: Maybe<FieldId>): FieldColumnData {
  return { _fieldColumnText, _fieldColumnLink };
}

/** Derived `instance Show FieldColumnData`. */
export function show_FieldColumnData(f: FieldColumnData): string {
  const link = f._fieldColumnLink.tag === "Just" ? "Just " + U.toText(f._fieldColumnLink.value) : "Nothing";
  return "FieldColumnData {_fieldColumnText = " + U.toText(f._fieldColumnText) +
    ", _fieldColumnLink = " + link + "}";
}

/** `instance ToJSON FieldColumnData` and `instance FromJSON FieldColumnData` */
export const JSON_FieldColumnData: J.JSONCodec<FieldColumnData> = J.codec(
  (f) => J.object([
    ["text", J.uuidJ.toJSON(f._fieldColumnText)],
    ["link", J.maybeJ(J.uuidJ).toJSON(f._fieldColumnLink)],
  ]),
  (x) => {
    if (typeof x === "string") return FieldColumnData(migrateField1(x), Nothing);
    if (J.isObject(x)) {
      const v = x;
      const t = migrateField1(J.field(v, "text", J.textJ));
      const l = mapMaybeValue(migrateField1, J.field(v, "link", J.maybeJ(J.textJ)));
      return FieldColumnData(t, l);
    }
    return J.typeMismatch("FieldColumnData", x);
  },
);

/** `instance Default FieldColumnData` */
export const def_FieldColumnData: FieldColumnData = FieldColumnData(nameField, Nothing);

export const fieldColumnText: Lens<FieldColumnData, FieldId> =
  lens((s: FieldColumnData) => s._fieldColumnText, (s, f: FieldId) => ({ ...s, _fieldColumnText: f }));

export const fieldColumnLink: Lens<FieldColumnData, Maybe<FieldId>> =
  lens((s: FieldColumnData) => s._fieldColumnLink, (s, f: Maybe<FieldId>) => ({ ...s, _fieldColumnLink: f }));


export type MatrixColumnData =
  /**
   * A direct mapping from one or two fields in the entity to a cell in the matrix.
   * The text can be edited within the matrix but the link cannot.
   */
  | { readonly tag: "FieldColumn"; readonly _0: FieldColumnData }
  /**
   * An expression mapping multiple entity fields to a value with a specified type. The @Bool@
   * is @True@ for multi-line results, @False@ for a single line.
   */
  | { readonly tag: "ExprColumn"; readonly _0: boolean; readonly _1: T.Text }
  /** A query which returns a set of entities. These will be displayed as a list within the cell. */
  | { readonly tag: "QueryColumn"; readonly _0: QueryId }
  /** A lookup table which searches for its inputs in the other columns and displays the output. */
  | { readonly tag: "LookupColumn"; readonly _0: ModelId };

/**
 * A direct mapping from one or two fields in the entity to a cell in the matrix.
 * The text can be edited within the matrix but the link cannot.
 */
export function FieldColumn(_0: FieldColumnData): MatrixColumnData {
  return { tag: "FieldColumn", _0 };
}

/**
 * An expression mapping multiple entity fields to a value with a specified type. The @Bool@
 * is @True@ for multi-line results, @False@ for a single line.
 */
export function ExprColumn(_0: boolean, _1: T.Text): MatrixColumnData {
  return { tag: "ExprColumn", _0, _1 };
}

/** A query which returns a set of entities. These will be displayed as a list within the cell. */
export function QueryColumn(_0: QueryId): MatrixColumnData {
  return { tag: "QueryColumn", _0 };
}

/** A lookup table which searches for its inputs in the other columns and displays the output. */
export function LookupColumn(_0: ModelId): MatrixColumnData {
  return { tag: "LookupColumn", _0 };
}

/** Derived `instance Show MatrixColumnData` (at precedence 0). */
export function show_MatrixColumnData(d: MatrixColumnData): string {
  switch (d.tag) {
    case "FieldColumn": return "FieldColumn (" + show_FieldColumnData(d._0) + ")";
    case "ExprColumn": return "ExprColumn " + (d._0 ? "True" : "False") + " " + T.showText(d._1);
    case "QueryColumn": return "QueryColumn " + U.toText(d._0);
    case "LookupColumn": return "LookupColumn " + U.toText(d._0);
    default: return absurd(d);
  }
}

export const _FieldColumn: Prism<MatrixColumnData, FieldColumnData> = prism(
  (f: FieldColumnData) => FieldColumn(f),
  (v: MatrixColumnData): Either<MatrixColumnData, FieldColumnData> =>
    (v.tag === "FieldColumn" ? Right(v._0) : Left(v)),
);

export const _ExprColumn: Prism<MatrixColumnData, readonly [boolean, T.Text]> = prism(
  ([b, e]: readonly [boolean, T.Text]) => ExprColumn(b, e),
  (v: MatrixColumnData): Either<MatrixColumnData, readonly [boolean, T.Text]> =>
    (v.tag === "ExprColumn" ? Right([v._0, v._1] as const) : Left(v)),
);

export const _QueryColumn: Prism<MatrixColumnData, QueryId> = prism(
  (q: QueryId) => QueryColumn(q),
  (v: MatrixColumnData): Either<MatrixColumnData, QueryId> =>
    (v.tag === "QueryColumn" ? Right(v._0) : Left(v)),
);

export const _LookupColumn: Prism<MatrixColumnData, ModelId> = prism(
  (m: ModelId) => LookupColumn(m),
  (v: MatrixColumnData): Either<MatrixColumnData, ModelId> =>
    (v.tag === "LookupColumn" ? Right(v._0) : Left(v)),
);


export interface MatrixColumn {
  readonly _columnName: T.Text;
  readonly _columnData: MatrixColumnData;
}

export function MatrixColumn(_columnName: T.Text, _columnData: MatrixColumnData): MatrixColumn {
  return { _columnName, _columnData };
}

/** Derived `instance Show MatrixColumn`. */
export function show_MatrixColumn(c: MatrixColumn): string {
  return "MatrixColumn {_columnName = " + T.showText(c._columnName) +
    ", _columnData = " + show_MatrixColumnData(c._columnData) + "}";
}

/** `instance ToJSON MatrixColumn` and `instance FromJSON MatrixColumn` */
export const JSON_MatrixColumn: J.JSONCodec<MatrixColumn> = J.codec(
  (c) => {
    const n = c._columnName;
    const d = c._columnData;
    switch (d.tag) {
      case "FieldColumn":
        return J.object([["name", J.textJ.toJSON(n)], ["field", JSON_FieldColumnData.toJSON(d._0)]]);
      case "ExprColumn":
        return J.object([
          ["name", J.textJ.toJSON(n)],
          ["note", J.boolJ.toJSON(d._0)],
          ["expression", J.textJ.toJSON(d._1)],
        ]);
      case "QueryColumn":
        return J.object([["name", J.textJ.toJSON(n)], ["query", J.uuidJ.toJSON(d._0)]]);
      case "LookupColumn":
        return J.object([["name", J.textJ.toJSON(n)], ["lookup", J.uuidJ.toJSON(d._0)]]);
      default:
        return absurd(d);
    }
  },
  (val) => J.withObject("Matrix column", (v) => {
    const name = J.field(v, "name", J.textJ);
    const columnData = J.alt<MatrixColumnData>(
      () => FieldColumn(J.field(v, "field", JSON_FieldColumnData)),
      () => {
        const note = J.fieldDefault(v, "note", J.boolJ, true);
        return ExprColumn(note, J.field(v, "expression", J.textJ));
      },
      () => QueryColumn(J.field(v, "query", J.uuidJ)),
      () => LookupColumn(J.field(v, "lookup", J.uuidJ)),
    )(val);
    return MatrixColumn(name, columnData);
  }, val),
);


export const matrixColumnName: Lens<MatrixColumn, T.Text> =
  lens((s: MatrixColumn) => s._columnName, (s, n: T.Text) => ({ ...s, _columnName: n }));

export const matrixColumnData: Lens<MatrixColumn, MatrixColumnData> =
  lens((s: MatrixColumn) => s._columnData, (s, d: MatrixColumnData) => ({ ...s, _columnData: d }));


/** Matrix column groups are sorted by a field value, either in ascending or descending order. */
export type SortDir = "Ascending" | "Descending";
export const sortDirValues: readonly SortDir[] = ["Ascending", "Descending"];

/** Derived `instance Show SortDir`. */
export function show_SortDir(d: SortDir): string {
  return d;
}

/** `instance ToJSON SortDir` and `instance FromJSON SortDir` */
export const JSON_SortDir: J.JSONCodec<SortDir> = J.codec(
  (d) => J.textJ.toJSON(show_SortDir(d)),
  (val) => J.withText("sort order", (t): SortDir => {
    switch (t) {
      case "Ascending": return "Ascending";
      case "Descending": return "Descending";
      default: return J.fail("Unknown sort order: " + T.showText(t));
    }
  }, val),
);


/**
 * A sort order is the list of pairs of field names and sort directions. If two entities are
 * equal according to the first entry then the next entry is applied, and so on.
 */
export interface SortOrder {
  readonly getSortOrder: readonly (readonly [FieldId, SortDir])[];
}

export function SortOrder(getSortOrder: readonly (readonly [FieldId, SortDir])[]): SortOrder {
  return { getSortOrder };
}

/** The `getSortOrder` field accessor of the Haskell newtype. */
export function getSortOrder(so: SortOrder): readonly (readonly [FieldId, SortDir])[] {
  return so.getSortOrder;
}

/** `instance ToJSON SortOrder` and `instance FromJSON SortOrder` */
export const JSON_SortOrder: J.JSONCodec<SortOrder> = J.codec(
  (so) => so.getSortOrder.map(([f, d]): J.Value => [J.uuidJ.toJSON(f), JSON_SortDir.toJSON(d)]),
  (val) => {
    const parsePair = (v: J.Value): readonly [FieldId, SortDir] => {
      const [f, d] = J.tuple2J(J.textJ, JSON_SortDir).parseJSON(v);
      return [migrateField1(f), d];
    };
    return J.withArray("Sort order", (arr) => SortOrder(arr.map(parsePair)), val);
  },
);


// A sort order represented as a comma separated list with up and down arrows denoting sort
// direction.
export function showSortOrder(tbl: FieldTable, so: SortOrder): T.Text {
  const showName = (f: FieldId): T.Text => {
    const field = M.lookup(f, tbl);
    switch (field.tag) {
      case "Just": return view(fieldName, field.value);
      case "Nothing": return "-?-";
    }
  };
  const showItem = ([f, o]: readonly [FieldId, SortDir]): T.Text => {
    switch (o) {
      case "Ascending": return showName(f) + "▲";   // U+25B2 black up-pointing triangle.
      case "Descending": return showName(f) + "▼";  // U+25BC black down-pointing triangle.
      default: return absurd(o);
    }
  };
  return T.intercalate(", ", so.getSortOrder.map(showItem));
}


/**
 * Each column group contains a query for the entities
 * to be displayed and zero or more columns for the data. Each entity will thus become a row
 * in this column group, and will also be passed as input to the query in the next column group.
 * Hence the execution of these queries will produce a tree of entities, with lists of columns
 * being applied respectively at each level of the tree.
 */
export interface ColumnGroup {
  readonly _groupQuery: QueryId;
  readonly _groupColumns: readonly MatrixColumn[];
  readonly _groupSort: SortOrder;
}

export function ColumnGroup(
  _groupQuery: QueryId,
  _groupColumns: readonly MatrixColumn[],
  _groupSort: SortOrder,
): ColumnGroup {
  return { _groupQuery, _groupColumns, _groupSort };
}

/** `instance ToJSON ColumnGroup` and `instance FromJSON ColumnGroup` */
export const JSON_ColumnGroup: J.JSONCodec<ColumnGroup> = J.codec(
  (cg) => J.object([
    ["query", J.uuidJ.toJSON(cg._groupQuery)],
    ["columns", cg._groupColumns.map((c) => JSON_MatrixColumn.toJSON(c))],
    ["sort", JSON_SortOrder.toJSON(cg._groupSort)],
  ]),
  (val) => {
    const readSort = (v: J.Value): SortOrder => {
      const pairs = J.alt<(readonly [T.Text, SortDir])[]>(
        (x) => J.listJ(J.tuple2J(J.textJ, JSON_SortDir)).parseJSON(x),
        (x) => J.listJ(J.textJ).parseJSON(x).map((f) => [f, "Ascending"] as const),
      )(v);
      return SortOrder(pairs.map(([f, d]) => [migrateField1(f), d] as const));
    };
    return J.withObject("Column group", (v) => {
      const sorting1 = J.fieldMaybe(v, "sort", J.valueJ);
      const q = J.field(v, "query", J.uuidJ);
      const cs = J.field(v, "columns", J.listJ(JSON_MatrixColumn));
      const srt = sorting1.tag === "Nothing"
        ? SortOrder([[nameField, "Ascending"]])
        : readSort(sorting1.value);
      return ColumnGroup(q, cs, srt);
    }, val);
  },
);


export const groupQuery: Lens<ColumnGroup, QueryId> =
  lens((s: ColumnGroup) => s._groupQuery, (s, q: QueryId) => ({ ...s, _groupQuery: q }));

export const groupColumns: Lens<ColumnGroup, readonly MatrixColumn[]> =
  lens((s: ColumnGroup) => s._groupColumns, (s, c: readonly MatrixColumn[]) => ({ ...s, _groupColumns: c }));

export const groupSort: Lens<ColumnGroup, SortOrder> =
  lens((s: ColumnGroup) => s._groupSort, (s, fs: SortOrder) => ({ ...s, _groupSort: fs }));


/**
 * A matrix consists of one or more column groups.
 * Each of these column groups has a query and a list of columns.
 */
export interface Matrix {
  readonly _matrixName: Name;
  readonly _matrixDescription: T.Text;
  readonly _matrixDefaultInput: S.Set<ModelId>;
  readonly _matrixGroups: readonly ColumnGroup[];
}

export function Matrix(
  _matrixName: Name,
  _matrixDescription: T.Text,
  _matrixDefaultInput: S.Set<ModelId>,
  _matrixGroups: readonly ColumnGroup[],
): Matrix {
  return { _matrixName, _matrixDescription, _matrixDefaultInput, _matrixGroups };
}

/** `instance ToJSON Matrix` and `instance FromJSON Matrix` */
export const JSON_Matrix: J.JSONCodec<Matrix> = J.codec(
  (m) => J.object([
    ["type", J.textJ.toJSON("matrix")],
    ["name", JSON_Name.toJSON(m._matrixName)],
    ["description", J.textJ.toJSON(m._matrixDescription)],
    ["input", J.setJ(J.uuidJ).toJSON(m._matrixDefaultInput)],
    ["groups", m._matrixGroups.map((cg) => JSON_ColumnGroup.toJSON(cg))],
  ]),
  (val) => J.withObject("Matrix", (v) => {
    checkType(v, "matrix");
    return Matrix(
      J.field(v, "name", JSON_Name),
      J.fieldDefault(v, "description", J.textJ, ""),
      J.fieldDefault(v, "input", J.setJ(J.uuidJ), S.empty<ModelId>()),
      J.field(v, "groups", J.listJ(JSON_ColumnGroup)),
    );
  }, val),
);

/** `instance Reflective Matrix` */
export const Reflective_Matrix: Reflective<Matrix> = {
  reflectiveName: (_) => Variant("Matrix"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Matrix(Name(""), "", S.empty<ModelId>(), [])],
  reflectiveBuiltIn: (_) => [nameField, descriptionField],
  reflectiveGet: (m) => M.fromList<FieldId, ExtValue>([
    [nameField, ExtText(view(matrixName.dot(nameText), m))],
    [descriptionField, ExtText(view(matrixDescription, m))],
  ]),
  reflectiveSet: (st: StateCell<ExtensionValues>, m: Matrix): Matrix => {
    const nm = Name(T.strip(extract(st, view(matrixName.dot(nameText), m), _ExtText, nameField)));
    const desc = extract(st, view(matrixDescription, m), _ExtText, descriptionField);
    return set(matrixName, nm, set(matrixDescription, desc, m));
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
};


export const matrixName: Lens<Matrix, Name> =
  lens((s: Matrix) => s._matrixName, (s, n: Name) => ({ ...s, _matrixName: n }));

export const matrixDescription: Lens<Matrix, T.Text> =
  lens((s: Matrix) => s._matrixDescription, (s, t: T.Text) => ({ ...s, _matrixDescription: t }));

export const matrixDefaultInput: Lens<Matrix, S.Set<ModelId>> =
  lens((s: Matrix) => s._matrixDefaultInput, (s, x: S.Set<ModelId>) => ({ ...s, _matrixDefaultInput: x }));

export const matrixGroups: Lens<Matrix, readonly ColumnGroup[]> =
  lens((s: Matrix) => s._matrixGroups, (s, cgs: readonly ColumnGroup[]) => ({ ...s, _matrixGroups: cgs }));


// ---------------------------------------------------------------------------------------------
// Functions

/** The set of variant types which are acceptable inputs to the first query in the matrix. */
export function matrixInputSet<V>(cls: QueryableEntityClass<V>, matrix: Matrix, model: Model<V>): S.Set<Variant<V>> {
  const go = (): Maybe<S.Set<Variant<V>>> => { // Maybe monad
    const qId = preview(matrixGroups.dot(ixList<ColumnGroup>(0)).dot(groupQuery), matrix);
    if (qId.tag === "Nothing") return Nothing;
    return preview(
      ix<ModelId, Entity<V>>(qId.value)
        .dot(entityContents<V>())
        .dot(cls._QueryDiagram)
        .dot(queryInputs<V>()),
      model.modelContents,
    );
  };
  return fromMaybe(S.empty<Variant<V>>(), go());
}


/**
 * Convert a matrix into the list of queries that will implement it. If any of the queries fail
 * to compile then relevant error messages are produced instead.
 */
export function compileMatrix<V>(
  cls: QueryableEntityClass<V>,
  matrix: Matrix,
  model: Model<V>,
): Either<T.Text[], Query<V>[]> {
  const compile = (qId: QueryId): Either<T.Text[], Query<V>> => {  // Either monad
    const qd = preview(ix<ModelId, Entity<V>>(qId).dot(entityContents<V>()).dot(cls._QueryDiagram), model.modelContents);
    if (qd.tag === "Nothing") {
      return Left([view(matrixName.dot(nameText), matrix) + ": Query does not exist (deleted?)."]);
    }
    return compileQueryDiagram(cls, model, view(queryDiagram<V>(), qd.value));
  };
  const prependNumber = (n: number, errs: readonly T.Text[]): T.Text[] =>
    errs.map((e) => String(n) + ": " + e);
  const [errss, queries] = partitionEithers(view(matrixGroups, matrix).map((g) => compile(g._groupQuery)));
  return L.isNull(errss)
    ? Right(queries)
    : Left(L.concat(L.zipWith(prependNumber, L.range(1, errss.length), errss)));
}


/**
 * Generate the forest of entity IDs corresponding to the nested queries, along with any warning
 * messages from running the queries.
 */
export function runMatrix<V>(
  queries: readonly Query<V>[],
  model: Model<V>,
  inputs: S.Set<ModelId>,
): [Forest<ModelId>, T.Text[]] {
  if (queries.length === 0) return [[], []];
  const [query, ...rest] = queries;
  const [topSet, topMsgs] = runQuery(query, [], model, inputs);
  // getNode :: [Query v] -> [ModelId] -> ModelId -> Tree (ModelId, [Text])
  const getNode = (qs: readonly Query<V>[], outers: readonly ModelId[], x: ModelId): Tree<readonly [ModelId, T.Text[]]> => {
    if (qs.length === 0) return Node([x, []] as const, []);
    const [q, ...qs1] = qs;
    const [cs, msgs] = runQuery(q, outers, model, S.singleton(x));
    return Node([x, msgs] as const, getNodes(qs1, outers, S.toList(cs)));
  };
  // getNodes :: [Query v] -> [ModelId] -> [ModelId] -> [Tree (ModelId, [Text])]
  const getNodes = (
    qs: readonly Query<V>[],
    outers: readonly ModelId[],
    xs: readonly ModelId[],
  ): Tree<readonly [ModelId, T.Text[]]>[] =>
    xs.map((x) => getNode(qs, [x, ...outers], x));
  const result: Forest<readonly [ModelId, T.Text[]]> = getNodes(rest, [], S.toList(topSet));
  return [
    result.map((t) => fmapTree(([u]) => u, t)),
    [...topMsgs, ...L.concatMap(([, msgs]) => msgs, flattenForest(result))],
  ];
}


// ---------------------------------------------------------------------------------------------
// Tree Utilties

/** Compare two entities by their field values. */
export function compareValues(order: SortOrder, e1: ExtensionValues, e2: ExtensionValues): Ordering {
  const fs = order.getSortOrder;
  if (fs.length === 0) return EQ;
  const [[f, dir], ...rest] = fs;
  let r: Ordering;
  switch (dir) {
    case "Ascending": r = compare(M.lookup(f, e1), M.lookup(f, e2)); break;
    case "Descending": r = compare(M.lookup(f, e2), M.lookup(f, e1)); break;
    default: return absurd(dir);
  }
  return r === EQ ? compareValues(SortOrder(rest), e1, e2) : r;
}


/**
 * Sort the entities in the forest according to the fieldnames. Each "SortOrder" is
 * used to sort the corresponding layer of the forest.
 */
export function sortForest<V>(
  cls: EntityClass<V>,
  sorts: readonly SortOrder[],
  trees: Forest<Entity<V>>,
): Forest<Entity<V>> {
  if (sorts.length === 0) return trees;
  const [f1, ...fs] = sorts;
  // The properties of each node are computed once rather than in every comparison; the result
  // is the same (stable) sort as Haskell's sortBy nodeCompare.
  const decorated = trees.map((t) => [entityPropertiesWithStamps(cls, t.rootLabel), t] as const);
  const nodeCompare = (
    [v1]: readonly [ExtensionValues, Tree<Entity<V>>],
    [v2]: readonly [ExtensionValues, Tree<Entity<V>>],
  ): Ordering => compareValues(f1, v1, v2);
  return L.sortBy(nodeCompare, decorated).map(([, t]) => sortTree(cls, fs, t));
}

/** Sort the children of the argument according to the fieldnames. */
export function sortTree<V>(cls: EntityClass<V>, fs: readonly SortOrder[], tree: Tree<Entity<V>>): Tree<Entity<V>> {
  return Node(tree.rootLabel, sortForest(cls, fs, tree.subForest));
}


/**
 * Apply a monadic action to each value in the forest.
 *
 * Direct style: @f@ performs its effects when called; it is called in pre-order.
 */
export function mapForestM<A, B>(f: (a: A) => B, forest: Forest<A>): Forest<B> {
  return forest.map((t) => mapTreeM(f, t));
}

/**
 * Apply a monadic action to each value in the tree.
 *
 * Direct style: @f@ is applied to the root before the children.
 */
export function mapTreeM<A, B>(f: (a: A) => B, tree: Tree<A>): Tree<B> {
  const v = f(tree.rootLabel);
  return Node(v, mapForestM(f, tree.subForest));
}


/**
 * Apply a different monadic action at each level of the forest. The first function in the
 * list is applied to the first level, the second at the second level, and so on. If the list
 * terminates before the forest then the forest is truncated at that level. The parameter passed
 * is the current value followed by its ancestors in the tree.
 *
 * Direct style: each function performs its effects when called, in pre-order.
 */
export function walkForestM<A, B>(fs: readonly ((as: readonly A[]) => B)[], forest: Forest<A>): Forest<B> {
  const walkTreeM = (
    ancestors: readonly A[],
    f: (as: readonly A[]) => B,
    fs1: readonly ((as: readonly A[]) => B)[],
    node: Tree<A>,
  ): Tree<B> => {
    const allValues: readonly A[] = [node.rootLabel, ...ancestors];
    const b = f(allValues);
    return Node(b, walkForestM1(allValues, fs1, node.subForest));
  };
  const walkForestM1 = (
    ancestors: readonly A[],
    fs1: readonly ((as: readonly A[]) => B)[],
    trees: Forest<A>,
  ): Tree<B>[] => {
    if (fs1.length === 0) return [];
    const [f, ...fs2] = fs1;
    return trees.map((t) => walkTreeM(ancestors, f, fs2, t));
  };
  return walkForestM1([], fs, forest);
}
