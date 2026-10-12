import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { type StateCell, identity, lens, preview, prism, review, set, view, type Prism } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { BoundBox, Connected, LineShape, Point as P, Rectangle, diagramFromList, type DiagramId } from "@/hades/src/Hades/Abstract";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, extract, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { BuiltInDef, Field, migrateField, type FieldTable } from "@/hades/src/Model/Reflection/Types";
import { ExtInt, ExtNone, ExtText, Variant, _ExtText, type ExtValue, type ExtensionValues } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type ModelEditCtx, type ModelEditState, type ModelId,
  Name, Package, current, descriptionField, emptyModel, goToEntity, mkEntity, mkPackage, modelStartState,
  nameField, nameText, packageName, runModelEdit,
} from "@/hades/src/Model/Abstract/PackageTree";
import { DiagramEntity as mkDiagramEntity, diagramEntityName, type DiagramEntity } from "@/hades/src/Model/Abstract/DiagramType";
import { QueryStep, compileQuery, type Query } from "@/hades/src/Model/Query/Base";
import {
  Avatar_QueryElement, Children, QElemArrow, QElemBox, QueryArrow, QueryBox, QueryDiagram, QueryInput,
  QueryOutput, Reflective_QueryDiagram, queryDiagram,
  type QueryData, type QueryElement, type QueryableEntityClass,
} from "@/hades/src/Model/Query/Diagram";
import {
  ColumnGroup, ExprColumn, FieldColumn, FieldColumnData, JSON_ColumnGroup, JSON_FieldColumnData,
  JSON_Matrix, JSON_MatrixColumn, JSON_SortDir, JSON_SortOrder, LookupColumn, Matrix, MatrixColumn,
  QueryColumn, Reflective_Matrix, SortOrder, _ExprColumn, _FieldColumn, _LookupColumn, _QueryColumn,
  compareValues, compileMatrix, def_FieldColumnData, fieldColumnLink, getSortOrder, groupSort,
  mapForestM, mapTreeM, matrixColumnData, matrixGroups, matrixInputSet, matrixName, runMatrix,
  showSortOrder, show_FieldColumnData, show_MatrixColumn, show_MatrixColumnData, sortDirValues,
  sortForest, sortTree, walkForestM, type HasMatrices,
} from "./Base";

// ---------------------------------------------------------------------------------------------
// Example models

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

/** All the matrix JSON objects in the example models. */
const exampleMatrices: [string, any][] = examples.flatMap(([f, m]) =>
  (m.modelContents as any[])
    .filter((e) => e.contents?.type === "matrix")
    .map((e) => [f + ": " + e.contents.name, e.contents] as [string, any]));

const isUuid = (t: unknown): boolean => typeof t === "string" && U.fromText(t).tag === "Just";

/** Matrices written by the current version (field IDs, sort pairs, input set). */
const currentFormat = exampleMatrices.filter(([, m]) => "input" in m);
/** Matrices written by older versions (field names, sort as a list of names, no input). */
const oldFormat = exampleMatrices.filter(([, m]) => !("input" in m));

/** What the Haskell writes back for an old-format matrix: names migrated to field IDs. */
function migrated(m: any): any {
  const mig = (t: string): string => (isUuid(t) ? t : migrateField(t));
  return {
    type: "matrix",
    name: m.name,
    description: m.description ?? "",
    input: m.input ?? [],
    groups: m.groups.map((g: any) => ({
      query: g.query,
      sort: (g.sort as any[]).map((s) => (typeof s === "string" ? [mig(s), "Ascending"] : [mig(s[0]), s[1]])),
      columns: g.columns.map((c: any) => (c.field
        ? {
          name: c.name,
          field: typeof c.field === "string"
            ? { text: mig(c.field), link: null }
            : { text: mig(c.field.text), link: c.field.link === null ? null : mig(c.field.link) },
        }
        : c)),
    })),
  };
}

describe("Matrix JSON with the example models", () => {
  it("finds the example matrices in both formats", () => {
    expect(exampleMatrices.length).toBeGreaterThanOrEqual(15);
    expect(currentFormat.length).toBeGreaterThanOrEqual(9);
    expect(oldFormat.length).toBeGreaterThanOrEqual(6);
  });

  it.each(currentFormat)("round-trips %s exactly", (_name, obj) => {
    const m = JSON_Matrix.parseJSON(obj);
    expect(JSON_Matrix.toJSON(m)).toEqual(obj);
    expect(equals(JSON_Matrix.parseJSON(JSON_Matrix.toJSON(m)), m)).toBe(true);
  });

  it.each(oldFormat)("migrates %s", (_name, obj) => {
    const m = JSON_Matrix.parseJSON(obj);
    const out = JSON_Matrix.toJSON(m);
    expect(out).toEqual(migrated(obj));
    // The migrated JSON is stable.
    expect(JSON_Matrix.toJSON(JSON_Matrix.parseJSON(out))).toEqual(out);
  });

  it("migrates old field names to the built-in field IDs", () => {
    const [, obj] = oldFormat[0];
    const m = JSON_Matrix.parseJSON(obj);
    expect(m._matrixGroups[0]._groupSort).toEqual(SortOrder([[nameField, "Ascending"]]));
    expect(view(matrixGroups, m)[0]._groupColumns[0]._columnData).toEqual(FieldColumn(FieldColumnData(nameField, Nothing)));
    expect(m._matrixDefaultInput).toEqual(S.empty());
  });
});

// ---------------------------------------------------------------------------------------------

const fid1 = migrateField("Rank");
const fid2 = migrateField("Colour");
const q1 = U.fromWords(1, 2, 3, 4);
const t1 = U.fromWords(5, 6, 7, 8);

describe("Column JSON", () => {
  it("reads field columns as a plain field name or an object", () => {
    expect(JSON_FieldColumnData.parseJSON("Rank")).toEqual(FieldColumnData(fid1, Nothing));
    expect(JSON_FieldColumnData.parseJSON(fid1)).toEqual(FieldColumnData(fid1, Nothing));
    expect(JSON_FieldColumnData.parseJSON({ text: "Rank", link: "Colour" })).toEqual(FieldColumnData(fid1, Just(fid2)));
    expect(JSON_FieldColumnData.toJSON(FieldColumnData(fid1, Just(fid2)))).toEqual({ text: fid1, link: fid2 });
    expect(JSON_FieldColumnData.toJSON(def_FieldColumnData)).toEqual({ text: nameField, link: null });
    // ".:" on a Maybe requires the key.
    expect(() => JSON_FieldColumnData.parseJSON({ text: "Rank" })).toThrow(J.JSONParseError);
    expect(() => JSON_FieldColumnData.parseJSON(3)).toThrow(/FieldColumnData/);
  });

  it("encodes and decodes each kind of column", () => {
    const cols = [
      MatrixColumn("F", FieldColumn(FieldColumnData(fid1, Nothing))),
      MatrixColumn("E", ExprColumn(false, "Rank + 1")),
      MatrixColumn("Q", QueryColumn(q1)),
      MatrixColumn("L", LookupColumn(t1)),
    ];
    expect(cols.map((c) => JSON_MatrixColumn.toJSON(c))).toEqual([
      { name: "F", field: { text: fid1, link: null } },
      { name: "E", note: false, expression: "Rank + 1" },
      { name: "Q", query: q1 },
      { name: "L", lookup: t1 },
    ]);
    for (const c of cols) expect(JSON_MatrixColumn.parseJSON(JSON_MatrixColumn.toJSON(c))).toEqual(c);
  });

  it("defaults the note flag to True and tries the alternatives in order", () => {
    expect(JSON_MatrixColumn.parseJSON({ name: "E", expression: "x" })).toEqual(MatrixColumn("E", ExprColumn(true, "x")));
    expect(JSON_MatrixColumn.parseJSON({ name: "E", expression: "x", note: null }))
      .toEqual(MatrixColumn("E", ExprColumn(true, "x")));
    // "field" wins over the others.
    expect(JSON_MatrixColumn.parseJSON({ name: "B", field: "Rank", query: q1 })._columnData.tag).toBe("FieldColumn");
    // An unparseable field falls through to the next alternative.
    expect(JSON_MatrixColumn.parseJSON({ name: "B", field: 1, query: q1 })._columnData).toEqual(QueryColumn(q1));
    // A field object without its "link" key does not parse, so the expression alternative wins.
    expect(JSON_MatrixColumn.parseJSON({ name: "B", field: { text: "Rank" }, expression: "x", note: false })._columnData)
      .toEqual(ExprColumn(false, "x"));
    expect(() => JSON_MatrixColumn.parseJSON({ name: "B", field: { text: "Rank" } })).toThrow(/lookup/);
    expect(() => JSON_MatrixColumn.parseJSON({ name: "X" })).toThrow(/lookup/);
    expect(() => JSON_MatrixColumn.parseJSON({ query: q1 })).toThrow(/name/);
    expect(() => JSON_MatrixColumn.parseJSON([])).toThrow(/Matrix column/);
  });

  it("has prisms for each kind of column", () => {
    const e = ExprColumn(true, "x");
    expect(preview(_ExprColumn, e)).toEqual(Just([true, "x"]));
    expect(preview(_FieldColumn, e)).toEqual(Nothing);
    expect(review(_ExprColumn, [false, "y"])).toEqual(ExprColumn(false, "y"));
    expect(review(_FieldColumn, def_FieldColumnData)).toEqual(FieldColumn(def_FieldColumnData));
    expect(preview(_QueryColumn, QueryColumn(q1))).toEqual(Just(q1));
    expect(preview(_LookupColumn, QueryColumn(q1))).toEqual(Nothing);
    expect(preview(_LookupColumn, LookupColumn(t1))).toEqual(Just(t1));
    const col = MatrixColumn("F", FieldColumn(def_FieldColumnData));
    expect(set(matrixColumnData.dot(_FieldColumn).dot(fieldColumnLink), Just(fid2), col))
      .toEqual(MatrixColumn("F", FieldColumn(FieldColumnData(nameField, Just(fid2)))));
  });

  it("has the derived Show", () => {
    expect(show_FieldColumnData(FieldColumnData(q1, Just(t1))))
      .toBe(`FieldColumnData {_fieldColumnText = ${q1}, _fieldColumnLink = Just ${t1}}`);
    expect(show_MatrixColumnData(FieldColumn(FieldColumnData(q1, Nothing))))
      .toBe(`FieldColumn (FieldColumnData {_fieldColumnText = ${q1}, _fieldColumnLink = Nothing})`);
    expect(show_MatrixColumnData(ExprColumn(true, "a \"b\""))).toBe('ExprColumn True "a \\"b\\""');
    expect(show_MatrixColumn(MatrixColumn("Q", QueryColumn(q1))))
      .toBe(`MatrixColumn {_columnName = "Q", _columnData = QueryColumn ${q1}}`);
    expect(show_MatrixColumnData(LookupColumn(t1))).toBe(`LookupColumn ${t1}`);
  });
});

describe("Sort orders and column groups", () => {
  it("encodes sort directions by name", () => {
    expect(sortDirValues.map((d) => JSON_SortDir.toJSON(d))).toEqual(["Ascending", "Descending"]);
    expect(JSON_SortDir.parseJSON("Descending")).toBe("Descending");
    expect(() => JSON_SortDir.parseJSON("Up")).toThrow('Unknown sort order: "Up"');
    expect(() => JSON_SortDir.parseJSON(1)).toThrow(/sort order/);
  });

  it("encodes sort orders as lists of pairs and migrates field names", () => {
    const so = SortOrder([[fid1, "Descending"], [nameField, "Ascending"]]);
    expect(JSON_SortOrder.toJSON(so)).toEqual([[fid1, "Descending"], [nameField, "Ascending"]]);
    expect(JSON_SortOrder.parseJSON([["Rank", "Descending"], [nameField, "Ascending"]])).toEqual(so);
    expect(getSortOrder(so)).toBe(so.getSortOrder);
    expect(() => JSON_SortOrder.parseJSON({})).toThrow(/Sort order/);
  });

  it("reads the sort of a column group in all its forms", () => {
    const base = { query: q1, columns: [{ name: "N", field: "Name" }] };
    const cols = [MatrixColumn("N", FieldColumn(FieldColumnData(nameField, Nothing)))];
    expect(JSON_ColumnGroup.parseJSON(base)).toEqual(ColumnGroup(q1, cols, SortOrder([[nameField, "Ascending"]])));
    expect(JSON_ColumnGroup.parseJSON({ ...base, sort: null })._groupSort).toEqual(SortOrder([[nameField, "Ascending"]]));
    expect(JSON_ColumnGroup.parseJSON({ ...base, sort: [] })._groupSort).toEqual(SortOrder([]));
    expect(JSON_ColumnGroup.parseJSON({ ...base, sort: ["Rank", "Colour"] })._groupSort)
      .toEqual(SortOrder([[fid1, "Ascending"], [fid2, "Ascending"]]));
    expect(JSON_ColumnGroup.parseJSON({ ...base, sort: [["Rank", "Descending"]] })._groupSort)
      .toEqual(SortOrder([[fid1, "Descending"]]));
    expect(() => JSON_ColumnGroup.parseJSON({ ...base, sort: [["Rank", "Sideways"]] })).toThrow();
    const cg = JSON_ColumnGroup.parseJSON({ ...base, sort: [["Rank", "Descending"]] });
    expect(JSON_ColumnGroup.toJSON(cg)).toEqual({
      query: q1, columns: [{ name: "N", field: { text: nameField, link: null } }], sort: [[fid1, "Descending"]],
    });
    expect(view(groupSort, cg)).toEqual(SortOrder([[fid1, "Descending"]]));
  });

  it("shows sort orders with arrows", () => {
    const tbl: FieldTable = M.fromList([[fid1, Field(false, fid1, "Rank", "One", BuiltInDef("ModelInt"))]]);
    expect(showSortOrder(tbl, SortOrder([[fid1, "Ascending"], [fid2, "Descending"]]))).toBe("Rank▲, -?-▼");
    expect(showSortOrder(tbl, SortOrder([]))).toBe("");
  });
});

describe("Matrix JSON and reflection", () => {
  const mx = Matrix(Name("M"), "Desc", S.fromList([q1]), [ColumnGroup(q1, [], SortOrder([]))]);

  it("encodes a matrix and applies the defaults when reading", () => {
    expect(JSON_Matrix.toJSON(mx)).toEqual({
      type: "matrix", name: "M", description: "Desc", input: [q1],
      groups: [{ query: q1, columns: [], sort: [] }],
    });
    expect(JSON_Matrix.parseJSON({ type: "matrix", name: "M", groups: [] }))
      .toEqual(Matrix(Name("M"), "", S.empty(), []));
    expect(() => JSON_Matrix.parseJSON({ type: "report", name: "M", groups: [] })).toThrow(/expected "matrix"/);
    expect(() => JSON_Matrix.parseJSON({ type: "matrix", name: "M" })).toThrow(/groups/);
  });

  it("has a reflective instance", () => {
    expect(Reflective_Matrix.reflectiveName(mx)).toBe("Matrix");
    expect(Reflective_Matrix.variantUserLabel("Matrix")).toBe("Matrix");
    expect(Reflective_Matrix.reflectiveDefaults).toEqual([Matrix(Name(""), "", S.empty(), [])]);
    expect(Reflective_Matrix.reflectiveBuiltIn(mx)).toEqual([nameField, descriptionField]);
    expect(Reflective_Matrix.reflectiveGet(mx))
      .toEqual(M.fromList([[nameField, ExtText("M")], [descriptionField, ExtText("Desc")]]));
    const extra = migrateField("Other");
    const st: StateCell<ExtensionValues> = {
      state: M.fromList<ModelId, ExtValue>([[nameField, ExtText("  New  ")], [extra, ExtInt(3)]]),
    };
    const mx2 = Reflective_Matrix.reflectiveSet(st, mx);
    expect(view(matrixName.dot(nameText), mx2)).toBe("New");
    expect(mx2._matrixDescription).toBe("Desc");
    expect(st.state).toEqual(M.singleton(extra, ExtInt(3)));
    expect(Reflective_Matrix.reflectiveBuiltInRefs).toEqual(mempty_RefTypeTable);
    expect(M.size(Reflective_Matrix.reflectiveArrows)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Tree utilities

describe("compareValues", () => {
  const ev = (rank: ExtValue | null, name: string): ExtensionValues =>
    M.fromList<ModelId, ExtValue>([...(rank ? [[fid1, rank] as [ModelId, ExtValue]] : []), [nameField, ExtText(name)]]);

  it("compares by each field in turn", () => {
    const asc = SortOrder([[fid1, "Ascending"], [nameField, "Ascending"]]);
    const desc = SortOrder([[fid1, "Descending"], [nameField, "Ascending"]]);
    expect(compareValues(asc, ev(ExtInt(1), "b"), ev(ExtInt(2), "a"))).toBe(-1);
    expect(compareValues(desc, ev(ExtInt(1), "b"), ev(ExtInt(2), "a"))).toBe(1);
    expect(compareValues(asc, ev(ExtInt(1), "b"), ev(ExtInt(1), "a"))).toBe(1);
    expect(compareValues(desc, ev(ExtInt(1), "a"), ev(ExtInt(1), "b"))).toBe(-1);
    expect(compareValues(SortOrder([]), ev(ExtInt(1), "a"), ev(ExtInt(2), "b"))).toBe(0);
    // Missing values (Nothing) come before any value, even ExtNone.
    expect(compareValues(asc, ev(null, "z"), ev(ExtNone, "a"))).toBe(-1);
    expect(compareValues(desc, ev(null, "z"), ev(ExtNone, "a"))).toBe(1);
  });
});

describe("forest traversals", () => {
  const forest: Forest<number> = [Node(1, [Node(2, [Node(3)]), Node(4)]), Node(5, [Node(6)])];

  it("maps actions over trees and forests in pre-order", () => {
    const seen: number[] = [];
    const out = mapForestM((n: number) => { seen.push(n); return String(n * 10); }, forest);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out).toEqual([Node("10", [Node("20", [Node("30")]), Node("40")]), Node("50", [Node("60")])]);
    expect(mapTreeM((n: number) => -n, forest[1])).toEqual(Node(-5, [Node(-6)]));
  });

  it("walks the forest with one function per level, truncating the forest", () => {
    const seen: string[] = [];
    const lvl = (tag: string) => (vs: readonly number[]): string => {
      const s = tag + vs.join(",");
      seen.push(s);
      return s;
    };
    expect(walkForestM([lvl("a"), lvl("b")], forest)).toEqual([
      Node("a1", [Node("b2,1"), Node("b4,1")]),
      Node("a5", [Node("b6,5")]),
    ]);
    expect(seen).toEqual(["a1", "b2,1", "b4,1", "a5", "b6,5"]);
    expect(walkForestM([lvl("a"), lvl("b"), lvl("c"), lvl("d")], forest)[0].subForest[0])
      .toEqual(Node("b2,1", [Node("c3,2,1")]));
    expect(walkForestM([], forest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A toy model with packages, ranked things, matrices and query diagrams.

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, null> }
  | { readonly tag: "Thing"; readonly name: Name; readonly rank: number }
  | { readonly tag: "Matrix"; readonly matrix: Matrix }
  | { readonly tag: "Query"; readonly qd: QueryDiagram<TV> };

const Pkg = (n: string): TV => ({ tag: "Pkg", pkg: Package<TV, null>(Name(n), null) });
const Thing = (n: string, rank: number): TV => ({ tag: "Thing", name: Name(n), rank });
const MatrixV = (matrix: Matrix): TV => ({ tag: "Matrix", matrix });
const QueryV = (qd: QueryDiagram<TV>): TV => ({ tag: "Query", qd });

const nameL = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "Pkg": return v.pkg._packageName;
      case "Query": return v.qd._queryDiagram._diagramEntityName;
      case "Matrix": return v.matrix._matrixName;
      default: return v.name;
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "Pkg": return { ...v, pkg: set(packageName(), n, v.pkg) };
      case "Query": return { ...v, qd: set(queryDiagram<TV>().dot(diagramEntityName()), n, v.qd) };
      case "Matrix": return { ...v, matrix: set(matrixName, n, v.matrix) };
      default: return { ...v, name: n };
    }
  },
);

const _Pkg: Prism<TV, Package<TV, null>> = prism(
  (p: Package<TV, null>): TV => ({ tag: "Pkg", pkg: p }),
  (v: TV) => (v.tag === "Pkg" ? Right(v.pkg) : Left(v)),
);
const _Query: Prism<TV, QueryDiagram<TV>> = prism(
  (qd: QueryDiagram<TV>): TV => QueryV(qd),
  (v: TV) => (v.tag === "Query" ? Right(v.qd) : Left(v)),
);
const _MatrixP: Prism<TV, Matrix> = prism(
  (m: Matrix): TV => MatrixV(m),
  (v: TV) => (v.tag === "Matrix" ? Right(v.matrix) : Left(v)),
);

let queryReflCache: Reflective<QueryDiagram<TV>> | null = null;
const queryRefl = (): Reflective<QueryDiagram<TV>> => (queryReflCache ??= Reflective_QueryDiagram(cls));

/** `EntityClass TV`, `Queryable TV` and `HasMatrices TV`. */
const cls: QueryableEntityClass<TV> & HasMatrices<TV> = {
  reflectiveName: (v) =>
    Variant(v.tag === "Pkg" ? "Package" : v.tag === "Thing" ? "Thing" : v.tag === "Matrix" ? "Matrix" : "Query"),
  variantUserLabel: defaultVariantUserLabel,
  get reflectiveDefaults(): readonly TV[] {
    return [Pkg(""), Thing("", 0), MatrixV(Reflective_Matrix.reflectiveDefaults[0]), QueryV(queryRefl().reflectiveDefaults[0])];
  },
  reflectiveBuiltIn: (v) => (v.tag === "Query" ? queryRefl().reflectiveBuiltIn(v.qd)
    : v.tag === "Matrix" ? Reflective_Matrix.reflectiveBuiltIn(v.matrix)
      : v.tag === "Thing" ? [nameField, fid1] : [nameField]),
  reflectiveGet: (v) => {
    switch (v.tag) {
      case "Query": return queryRefl().reflectiveGet(v.qd);
      case "Matrix": return Reflective_Matrix.reflectiveGet(v.matrix);
      case "Thing": return M.fromList<ModelId, ExtValue>([[nameField, ExtText(v.name._0)], [fid1, ExtInt(v.rank)]]);
      default: return M.singleton(nameField, ExtText(view(nameL.dot(nameText), v)));
    }
  },
  reflectiveSet: (st, v) => {
    switch (v.tag) {
      case "Query": return QueryV(queryRefl().reflectiveSet(st, v.qd));
      case "Matrix": return MatrixV(Reflective_Matrix.reflectiveSet(st, v.matrix));
      default: return set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v);
    }
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: nameL,
  _Package: _Pkg,
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec((_v) => null, () => J.fail("not used")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  _QueryDiagram: _Query,
  queryAvatars: () => [],
  _Matrix: _MatrixP,
};

const qcls = Avatar_QueryElement(cls);

let counter = 0;
const did = (): DiagramId => U.fromWords(0x7e57, 0, 0, ++counter);

/** A query diagram: Input -> steps... -> Output. */
function pipeline(name: string, steps: readonly QueryData<TV>[]): DiagramEntity<QueryElement<TV>, null> {
  const boxes = [QueryInput, ...steps, QueryOutput].map((d, i) =>
    QueryBox<TV>(did(), Rectangle(BoundBox(P(0, 150 * i), P(200, 150 * i + 100))), d));
  const arrows = boxes.slice(1).map((b, i) =>
    QueryArrow(did(), LineShape([
      Connected(P(0, 0), boxes[i].queryBoxId, Nothing),
      Connected(P(0, 0), b.queryBoxId, Nothing),
    ], [])));
  return mkDiagramEntity<QueryElement<TV>, null>(
    Name(name),
    diagramFromList(qcls, [...boxes.map((b) => QElemBox(b)), ...arrows.map((a) => QElemArrow<TV>(a))]),
    null,
  );
}

function edit<A>(st: ModelEditState<TV>, act: (c: ModelEditCtx<TV, TV>) => A): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, identity<TV>(), st, act);
  if (r.tag === "Left") throw new Error("Model edit failed: " + JSON.stringify(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

/**
 * Root / Top: packages P1 (things A=3, B=1) and P2 (things C=2, D=2), and Queries / children
 * (query diagram with a Children step) and Queries / Bad (a thing, not a query).
 */
const [ids, st] = edit(modelStartState(newGenerator(), emptyModel(cls, "Test")), (c) => {
  const top = mkPackage(c, Name("Top"));
  goToEntity(c, top);
  const p1 = mkPackage(c, Name("P1"));
  const p2 = mkPackage(c, Name("P2"));
  goToEntity(c, p1);
  const a = mkEntity(c, Thing("A", 3)).entityId;
  const b = mkEntity(c, Thing("B", 1)).entityId;
  goToEntity(c, p2);
  const cc = mkEntity(c, Thing("C", 2)).entityId;
  const d = mkEntity(c, Thing("D", 2)).entityId;
  goToEntity(c, top);
  const qs = mkPackage(c, Name("Queries"));
  goToEntity(c, qs);
  const children = mkEntity(c, QueryV(QueryDiagram<TV>(pipeline("Children", [Children]), S.fromList(["Package"]), ""))).entityId;
  const bad = mkEntity(c, Thing("NotAQuery", 0)).entityId;
  return { top, p1, p2, a, b, c: cc, d, children, bad };
});
const model = st.stateModel;
const entity = (mId: ModelId): Entity<TV> => {
  const e = M.lookup(mId, model.modelContents);
  if (e.tag === "Nothing") throw new Error("No such entity");
  return e.value;
};
const labels = (f: Forest<Entity<TV>>): unknown[] =>
  f.map((t) => [t.rootLabel.entityId, labels(t.subForest)]);

const childrenGroup = (sort: SortOrder) => ColumnGroup(ids.children, [MatrixColumn("Name", FieldColumn(def_FieldColumnData))], sort);

describe("Running matrices", () => {
  const mx = Matrix(Name("Mx"), "", S.empty(), [
    childrenGroup(SortOrder([[nameField, "Ascending"]])),
    childrenGroup(SortOrder([[fid1, "Ascending"], [nameField, "Descending"]])),
  ]);

  it("finds the input types of the first query", () => {
    expect(matrixInputSet(cls, mx, model)).toEqual(S.fromList(["Package"]));
    expect(matrixInputSet(cls, Matrix(Name("E"), "", S.empty(), []), model)).toEqual(S.empty());
    const badMx = Matrix(Name("Bad"), "", S.empty(), [childrenGroup(SortOrder([]))].map((g) => ({ ...g, _groupQuery: ids.bad })));
    expect(matrixInputSet(cls, badMx, model)).toEqual(S.empty());
  });

  it("compiles the queries and numbers the errors of each failing group", () => {
    const qs = compileMatrix(cls, mx, model);
    expect(qs.tag).toBe("Right");
    if (qs.tag === "Right") expect(qs.value.length).toBe(2);
    const badMx = Matrix(Name("Bad"), "", S.empty(), [
      ColumnGroup(ids.bad, [], SortOrder([])),
      childrenGroup(SortOrder([])),
      ColumnGroup(U.nil, [], SortOrder([])),
    ]);
    // The numbers count the failing groups, not the group positions.
    expect(compileMatrix(cls, badMx, model)).toEqual(Left([
      "1: Bad: Query does not exist (deleted?).",
      "2: Bad: Query does not exist (deleted?).",
    ]));
  });

  it("runs the queries into a forest of entities and sorts each level", () => {
    const qs = compileMatrix(cls, mx, model);
    if (qs.tag === "Left") throw new Error(qs.value.join("\n"));
    const [idForest, msgs] = runMatrix(qs.value, model, S.singleton(ids.top));
    expect(msgs).toEqual([]);
    const sorted = (xs: ModelId[]) => S.toList(S.fromList(xs));
    expect(idForest.map((t) => t.rootLabel)).toEqual(sorted([ids.p1, ids.p2, findQueriesPkg()]));
    const entForest = idForest.map((t) => {
      const go = (n: Tree<ModelId>): Tree<Entity<TV>> => Node(entity(n.rootLabel), n.subForest.map(go));
      return go(t);
    });
    const qPkg = findQueriesPkg();
    // Level 1 by name ascending; level 2 by rank ascending then name descending.
    expect(labels(sortForest(cls, mx._matrixGroups.map((g) => g._groupSort), entForest))).toEqual([
      [ids.p1, [[ids.b, []], [ids.a, []]]],
      [ids.p2, [[ids.d, []], [ids.c, []]]],
      // The query has no rank (Nothing), so it comes before the thing with rank 0.
      [qPkg, [[ids.children, []], [ids.bad, []]]],
    ]);
    // With no sort orders the forest is unchanged; with one only the top level is sorted.
    expect(sortForest(cls, [], entForest)).toBe(entForest);
    const top1 = sortForest(cls, [SortOrder([[nameField, "Descending"]])], entForest);
    expect(top1.map((t) => t.rootLabel.entityId)).toEqual([qPkg, ids.p2, ids.p1]);
    expect(top1[2].subForest).toBe(entForest.find((t) => t.rootLabel.entityId === ids.p1)!.subForest);
    // sortTree sorts the children only.
    const p1Tree = entForest.find((t) => t.rootLabel.entityId === ids.p1)!;
    expect(labels([sortTree(cls, [SortOrder([[fid1, "Descending"]])], p1Tree)]))
      .toEqual([[ids.p1, [[ids.a, []], [ids.b, []]]]]);
  });

  it("sorts stably, like Haskell's sortBy", () => {
    // C and D both have rank 2: sorting by rank alone keeps them in their input order.
    const byRank = [SortOrder([[fid1, "Ascending"]])];
    const leaf = (mId: ModelId): Tree<Entity<TV>> => Node(entity(mId), []);
    const ids1 = (f: Forest<Entity<TV>>) => f.map((t) => t.rootLabel.entityId);
    expect(ids1(sortForest(cls, byRank, [leaf(ids.c), leaf(ids.a), leaf(ids.d), leaf(ids.b)])))
      .toEqual([ids.b, ids.c, ids.d, ids.a]);
    expect(ids1(sortForest(cls, byRank, [leaf(ids.d), leaf(ids.a), leaf(ids.c), leaf(ids.b)])))
      .toEqual([ids.b, ids.d, ids.c, ids.a]);
  });

  it("compiles a matrix with no groups to no queries", () => {
    expect(compileMatrix(cls, Matrix(Name("Empty"), "", S.empty(), []), model)).toEqual(Right([]));
  });

  it("passes each entity and its ancestors as the outer entities of the nested queries", () => {
    const calls: [ModelId[], ModelId[]][] = [];
    const recorder = (results: (x: ModelId) => ModelId[]): Query<TV> => {
      const u = U.fromWords(9, 9, 9, ++counter);
      return compileQuery<TV>([[u, QueryStep<TV>((outers, _m, inputs) => {
        calls.push([[...outers], S.toList(inputs)]);
        const xs = S.toList(inputs).flatMap(results);
        return [S.fromList(xs), xs.map((x) => "msg " + x)];
      })]], [[U.nil, u], [u, U.nil]]);
    };
    const [x1, x2, y1, y2, z1] = [1, 2, 3, 4, 5].map((n) => U.fromWords(0, 0, 0, n));
    const level1 = recorder(() => [x1, x2]);
    const level2 = recorder((x) => (x === x1 ? [y1, y2] : []));
    const level3 = recorder((y) => (y === y2 ? [z1] : []));
    const [f, msgs] = runMatrix([level1, level2, level3], model, S.singleton(ids.top));
    expect(f).toEqual([Node(x1, [Node(y1, []), Node(y2, [Node(z1, [])])]), Node(x2, [])]);
    expect(calls.filter(([outers]) => outers.length > 0)).toContainEqual([[y2, x1], [y2]]);
    expect(calls.filter(([outers]) => outers.length > 0)).toContainEqual([[x1], [x1]]);
    // Top messages first, then the messages of each node in pre-order.
    expect(msgs).toEqual(["msg " + x1, "msg " + x2, "msg " + y1, "msg " + y2, "msg " + z1]);
    expect(runMatrix([], model, S.singleton(ids.top))).toEqual([[], []]);
    // A single query gives a flat forest.
    expect(runMatrix([level1], model, S.singleton(ids.top))[0]).toEqual([Node(x1, []), Node(x2, [])]);
  });

  it("can be run inside a model edit with mapForestM", () => {
    const qs = compileMatrix(cls, mx, model);
    if (qs.tag === "Left") throw new Error(qs.value.join("\n"));
    const [idForest] = runMatrix(qs.value, model, S.singleton(ids.top));
    const [names] = edit(st, (c) => mapForestM((i: ModelId) => {
      goToEntity(c, i);
      const e = current(c);
      return e.tag === "Just" ? view(nameL.dot(nameText), e.value._entityContents) : "?";
    }, idForest));
    expect(names.map((t) => t.rootLabel).sort()).toEqual(["P1", "P2", "Queries"]);
  });
});

function findQueriesPkg(): ModelId {
  return entity(ids.children)._entityParent;
}
