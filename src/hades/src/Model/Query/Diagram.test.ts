import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as Cairo from "@/lib/GI/Cairo";
import type * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { flattenForest } from "@/lib/Data/Tree";
import { identity, lens, preview, previewOrThrow, prism, set, view, type Prism, type Traversal } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  type Action, type ActionOutput, type Command, type Diagram, type DiagramId, type Point, type View,
  Action as mkAction, BoundBox, Connected, Drag, EndDrag, LineShape, Point as P, Rectangle, Select,
  Unconnected, applyDelta, deltaStateOf, diagramFromList, diagramToList, mkDiagramState,
  noMod, noPaint, processAction, startDelta, yieldViews,
} from "@/hades/src/Hades/Abstract";
import { type HadesEnv, type HadesRender, hadesConfig } from "@/hades/src/Hades/GI/BasicShapes";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { type Reflective, defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  Name, Package, descriptionField, emptyModel, goToEntity, mkEntity, mkPackage, modelStartState,
  modifyRelations, nameField, nameText, packageName, runModelEdit, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import {
  type DiagramEntity, type Editable, type HasDiagrams, type ModelScriptAct, type UserScriptFunctor,
  DiagramEntity as mkDiagramEntity, diagramEntityName, keyCommands, stepScript,
} from "@/hades/src/Model/Abstract/DiagramType";
import { runQuery } from "./Base";
import {
  type QueryData, type QueryElement, type QueryableEntityClass,
  Avatar_QueryElement, Backwards, Children, Connectable_QueryElement, Entities, Filter, FilterVariants,
  FindDiagrams, Forwards, HasId_QueryElement, InDiagram, JSON_QueryArrow, JSON_QueryBox, JSON_QueryDiagram,
  JSON_QueryElement, Parent, QElemArrow, QElemBox, QueryArrow, QueryBox, QueryComment, QueryContext,
  QueryDiagram, QueryInput, QueryOutput, Reflective_QueryDiagram, Step, SubQuery, Variants,
  Viewable_QueryElement, _Entities, _Filter, _QElemArrow, _QElemBox, _Step, clickableEntitySet,
  compileQueryDiagram, def_QueryData, queryActivation, queryArrowShape, queryBackgroundMenu, queryBoxData,
  queryBoxShape, queryDiagram, queryDiagramToolbar, queryDiagramWrapper, queryElementDialog, queryForest,
  queryInputs, queryTest,
} from "./Diagram";

// ---------------------------------------------------------------------------------------------
// A toy model: packages, "things" (boxes and links), plain diagrams that hold avatars, and queries.

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, null> }
  | { readonly tag: "Thing"; readonly name: Name; readonly variant: "Box" | "Link" }
  | { readonly tag: "Dgm"; readonly name: Name; readonly avatars: readonly ModelId[] }
  | { readonly tag: "Query"; readonly qd: QueryDiagram<TV> };

const Pkg = (n: string): TV => ({ tag: "Pkg", pkg: Package<TV, null>(Name(n), null) });
const Thing = (n: string, variant: "Box" | "Link"): TV => ({ tag: "Thing", name: Name(n), variant });
const Dgm = (n: string, avatars: readonly ModelId[]): TV => ({ tag: "Dgm", name: Name(n), avatars });
const Query = (qd: QueryDiagram<TV>): TV => ({ tag: "Query", qd });

const nameL = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "Pkg": return v.pkg._packageName;
      case "Query": return v.qd._queryDiagram._diagramEntityName;
      default: return v.name;
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "Pkg": return { ...v, pkg: set(packageName(), n, v.pkg) };
      case "Query": return { ...v, qd: set(queryDiagram<TV>().dot(diagramEntityName()), n, v.qd) };
      default: return { ...v, name: n };
    }
  },
);

const _Pkg: Prism<TV, Package<TV, null>> = prism(
  (p: Package<TV, null>): TV => ({ tag: "Pkg", pkg: p }),
  (v: TV) => (v.tag === "Pkg" ? Right(v.pkg) : Left(v)),
);
const _Query: Prism<TV, QueryDiagram<TV>> = prism(
  (qd: QueryDiagram<TV>): TV => Query(qd),
  (v: TV) => (v.tag === "Query" ? Right(v.qd) : Left(v)),
);

let queryReflCache: Reflective<QueryDiagram<TV>> | null = null;
/** `Reflective (QueryDiagram TV)`, created on first use (it needs `cls`). */
const queryRefl = (): Reflective<QueryDiagram<TV>> => (queryReflCache ??= Reflective_QueryDiagram(cls));

/** `EntityClass TV`, `Queryable TV` and `HasDiagrams HadesRender TV`. */
const cls: QueryableEntityClass<TV> & HasDiagrams<HadesRender, TV, null> = {
  reflectiveName: (v) =>
    Variant(v.tag === "Pkg" ? "Package" : v.tag === "Thing" ? v.variant : v.tag === "Dgm" ? "Diagram" : "Query"),
  variantUserLabel: defaultVariantUserLabel,
  // The query default refers back to these defaults (Haskell laziness, see Reflective_QueryDiagram).
  get reflectiveDefaults(): readonly TV[] {
    return [Pkg(""), Thing("", "Box"), Thing("", "Link"), Dgm("", []), Query(queryRefl().reflectiveDefaults[0])];
  },
  reflectiveBuiltIn: (v) => (v.tag === "Query" ? queryRefl().reflectiveBuiltIn(v.qd) : [nameField]),
  reflectiveGet: (v) => (v.tag === "Query"
    ? queryRefl().reflectiveGet(v.qd)
    : M.singleton(nameField, ExtText(view(nameL.dot(nameText), v)))),
  reflectiveSet: (st, v) => (v.tag === "Query"
    ? Query(queryRefl().reflectiveSet(st, v.qd))
    : set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v)),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.singleton(Variant("Link"), ["Tail", "Head"] as const),
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
  // Queryable
  _QueryDiagram: _Query,
  queryAvatars: (v) => (v.tag === "Dgm" ? v.avatars : []),
  // HasDiagrams
  isDiagram: (v) => v.tag === "Query" || v.tag === "Dgm",
  getDiagramWrapper: (ctx, e) => withSubtype(ctx, _Query, (c) => queryDiagramWrapper(cls, c, e)),
  diagramEntityTypes: M.empty(),
  diagramMapAvatars: (_f, e) => e,
};

const qcls = Avatar_QueryElement(cls);

// Query diagram construction.

let counter = 0;
const did = (): DiagramId => U.fromWords(0x7e57, 0, 0, ++counter);

function box(qd: QueryData<TV>, x = 0, y = 0): QueryBox<TV> {
  return QueryBox<TV>(did(), Rectangle(BoundBox(P(x, y), P(x + 200, y + 100))), qd);
}

function link(from: DiagramId, to: DiagramId): QueryArrow {
  return QueryArrow(did(), LineShape([Connected(P(0, 0), from, Nothing), Connected(P(0, 0), to, Nothing)], []));
}

/** A query diagram: Input -> steps... -> Output, plus any extra elements. */
function pipeline(
  name: string,
  steps: readonly QueryData<TV>[],
  extra: readonly QueryElement<TV>[] = [],
): DiagramEntity<QueryElement<TV>, null> {
  const boxes = [QueryInput, ...steps, QueryOutput].map((d, i) => box(d, 0, 150 * i));
  const arrows = boxes.slice(1).map((b, i) => link(boxes[i].queryBoxId, b.queryBoxId));
  return mkDiagramEntity<QueryElement<TV>, null>(
    Name(name),
    diagramFromList(qcls, [...boxes.map((b) => QElemBox(b)), ...arrows.map((a) => QElemArrow<TV>(a)), ...extra]),
    null,
  );
}

const qdOf = (de: DiagramEntity<QueryElement<TV>, null>, inputs: readonly string[] = ["Box"]): QueryDiagram<TV> =>
  QueryDiagram<TV>(de, S.fromList(inputs.map(Variant)), "A query");

// Model construction.

function edit<A>(st: ModelEditState<TV>, act: (c: ModelEditCtx<TV, TV>) => A): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, identity<TV>(), st, act);
  if (r.tag === "Left") throw new Error("Model edit failed: " + JSON.stringify(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

interface TestModel {
  st: ModelEditState<TV>;
  pkg: ModelId; a: ModelId; b: ModelId; l: ModelId; d: ModelId;
  q1: ModelId; q2: ModelId; q3: ModelId;
}

/**
 * Root / P: boxes A and B, link L (Tail -> A, Head -> B), diagram D showing A, and queries
 * Q1 (follow links forwards), Q2 (Q1 as a sub-query) and Q3 (recursive).
 */
function testModel(): TestModel {
  const [ids, st] = edit(modelStartState(newGenerator(), emptyModel(cls, "Test")), (c) => {
    const pkg = mkPackage(c, Name("P"));
    goToEntity(c, pkg);
    const a = mkEntity(c, Thing("A", "Box")).entityId;
    const b = mkEntity(c, Thing("B", "Box")).entityId;
    const l = mkEntity(c, Thing("L", "Link")).entityId;
    const d = mkEntity(c, Dgm("D", [a])).entityId;
    modifyRelations(c, (r) => NR.insert(l, a, "Tail", NR.insert(l, b, "Head", r)));
    const q1 = mkEntity(c, Query(qdOf(pipeline("Q1", [Forwards<TV>(M.singleton(Variant("Link"), ["Tail", "Head"] as const))])))).entityId;
    const q2 = mkEntity(c, Query(qdOf(pipeline("Q2", [SubQuery<TV>(Just(q1))])))).entityId;
    const q3 = mkEntity(c, Query(qdOf(pipeline("Q3", [])))).entityId;
    // Q3 calls itself.
    goToEntity(c, q3);
    const self = Query(qdOf(pipeline("Q3", [SubQuery<TV>(Just(q3))])));
    c.state = {
      ...c.state,
      stateModel: {
        ...c.state.stateModel,
        modelContents: M.adjust((e: Entity<TV>) => ({ ...e, _entityContents: self }), q3, c.state.stateModel.modelContents),
      },
    };
    return { pkg, a, b, l, d, q1, q2, q3 };
  });
  return { st, ...ids };
}

const tm = testModel();
const model = tm.st.stateModel;
const ids = (...xs: ModelId[]) => S.fromList(xs);

/** Compile and run a query diagram, failing the test on compilation errors. */
function run(de: DiagramEntity<QueryElement<TV>, null>, inputs: S.Set<ModelId>): [S.Set<ModelId>, string[]] {
  const q = compileQueryDiagram(cls, model, de);
  if (q.tag === "Left") throw new Error("Query errors: " + q.value.join("; "));
  return runQuery(q.value, [], model, inputs);
}

function errors(de: DiagramEntity<QueryElement<TV>, null>): string[] {
  const q = compileQueryDiagram(cls, model, de);
  if (q.tag === "Right") throw new Error("Expected errors");
  return q.value;
}

const linkArrows = M.singleton(Variant("Link"), ["Tail", "Head"] as const);

// ---------------------------------------------------------------------------------------------

describe("compileQueryDiagram", () => {
  it("follows arrows forwards and backwards", () => {
    expect(run(pipeline("F", [Forwards<TV>(linkArrows)]), ids(tm.a))).toEqual([ids(tm.b), []]);
    expect(run(pipeline("B", [Backwards<TV>(linkArrows)]), ids(tm.b))).toEqual([ids(tm.a), []]);
    expect(run(pipeline("B", [Backwards<TV>(linkArrows)]), ids(tm.a))[0]).toEqual(ids());
    expect(run(pipeline("F0", [Forwards<TV>(M.empty())]), ids(tm.a))[0]).toEqual(ids());
  });

  it("steps through relations and the package tree", () => {
    expect(run(pipeline("S", [Step<TV>(S.fromList(["Tail"]))]), ids(tm.a))[0]).toEqual(ids(tm.l));
    expect(run(pipeline("S", [Step<TV>(S.fromList(["Tail", "Head"]))]), ids(tm.l))[0]).toEqual(ids(tm.a, tm.b));
    expect(run(pipeline("Pa", [Parent]), ids(tm.a, tm.b))[0]).toEqual(ids(tm.pkg));
    expect(run(pipeline("Ch", [Children]), ids(tm.pkg))[0])
      .toEqual(ids(tm.a, tm.b, tm.l, tm.d, tm.q1, tm.q2, tm.q3));
  });

  it("adds variants and entities, and filters", () => {
    expect(run(pipeline("V", [Variants<TV>(S.fromList([Variant("Box")]))]), ids(tm.d))[0]).toEqual(ids(tm.a, tm.b, tm.d));
    expect(run(pipeline("E", [Entities<TV>(ids(tm.l))]), ids(tm.a))[0]).toEqual(ids(tm.a, tm.l));
    expect(run(pipeline("FV", [FilterVariants<TV>(S.fromList([Variant("Box")]))]), ids(tm.a, tm.l, tm.d))[0])
      .toEqual(ids(tm.a));
    expect(run(pipeline("Fi", [Filter<TV>("Name=\"B\"")]), ids(tm.a, tm.b, tm.l))).toEqual([ids(tm.b), []]);
  });

  it("moves between diagrams and their contents", () => {
    expect(run(pipeline("In", [InDiagram]), ids(tm.d, tm.a))[0]).toEqual(ids(tm.a));
    expect(run(pipeline("Find", [FindDiagrams]), ids(tm.a))[0]).toEqual(ids(tm.d));
    expect(run(pipeline("Find", [FindDiagrams]), ids(tm.b))[0]).toEqual(ids());
  });

  it("chains steps and ignores comments", () => {
    const comment = QElemBox(box(QueryComment<TV>("Just a note"), 500, 0));
    expect(run(pipeline("Chain", [Forwards<TV>(linkArrows), Parent], [comment]), ids(tm.a))[0]).toEqual(ids(tm.pkg));
    // An input linked straight to the output copies its inputs.
    expect(run(pipeline("Id", []), ids(tm.a, tm.l))[0]).toEqual(ids(tm.a, tm.l));
  });

  it("runs sub-queries", () => {
    const q2 = M.lookup(tm.q2, model.modelContents);
    if (q2.tag === "Nothing" || q2.value._entityContents.tag !== "Query") throw new Error("no Q2");
    expect(run(view(queryDiagram<TV>(), q2.value._entityContents.qd), ids(tm.a))[0]).toEqual(ids(tm.b));
  });

  it("reports errors in the diagram", () => {
    const [i, o] = [box(QueryInput), box(QueryOutput)];
    const mk = (n: string, arrow: QueryArrow) => mkDiagramEntity<QueryElement<TV>, null>(
      Name(n), diagramFromList(qcls, [QElemBox(i), QElemBox(o), QElemArrow<TV>(arrow)]), null);
    const end = (id: DiagramId) => Connected(P(1, 1), id, Nothing);
    expect(errors(mk("X", QueryArrow(did(), LineShape([Unconnected(P(1, 1)), Unconnected(P(2, 2))], [])))))
      .toEqual(["X: Floating line."]);
    expect(errors(mk("X", QueryArrow(did(), LineShape([Unconnected(P(1, 1)), end(o.queryBoxId)], [])))))
      .toEqual(["X: Line from nowhere."]);
    expect(errors(mk("X", QueryArrow(did(), LineShape([end(i.queryBoxId), Unconnected(P(1, 1))], [])))))
      .toEqual(["X: Line to nowhere."]);
    expect(errors(pipeline("Y", [SubQuery<TV>(Nothing)]))).toEqual(["Y: SubQuery: No query selected."]);
    expect(errors(pipeline("Y", [SubQuery<TV>(Just(did()))]))).toEqual(["Y: SubQuery: Query does not exist (deleted?)."]);
    expect(errors(pipeline("Y", [SubQuery<TV>(Just(tm.q3))]))).toEqual(["Q3: Recursive subquery detected. Cannot run this."]);
    const parseErrs = errors(pipeline("Y", [Filter<TV>("Name=")]));
    expect(parseErrs.length).toBeGreaterThan(0);
    expect(parseErrs.length).toBeLessThanOrEqual(3);
    // Errors from several elements are concatenated.
    expect(errors(pipeline("Z", [SubQuery<TV>(Nothing), SubQuery<TV>(Nothing)]))).toEqual([
      "Z: SubQuery: No query selected.", "Z: SubQuery: No query selected.",
    ]);
  });

  it("warns when a filter does not return a Bool", () => {
    const [rs, ws] = run(pipeline("W", [Filter<TV>("Name")]), ids(tm.a));
    expect(rs).toEqual(ids());
    expect(ws.length).toBe(1);
    expect(ws[0]).toMatch(/W: Filter formula returned .* instead of Bool\./);
  });
});

// ---------------------------------------------------------------------------------------------

describe("JSON", () => {
  const allData: QueryData<TV>[] = [
    Step<TV>(S.fromList(["Head", "Tail"])), Filter<TV>("Name=\"x\""), FilterVariants<TV>(S.fromList([Variant("Box")])),
    SubQuery<TV>(Nothing), SubQuery<TV>(Just(tm.q1)), Variants<TV>(S.fromList([Variant("Link")])),
    Entities<TV>(ids(tm.a, tm.b)), Forwards<TV>(linkArrows), Backwards<TV>(linkArrows), Parent, Children,
    InDiagram, FindDiagrams, QueryInput, QueryOutput, QueryComment<TV>("note"),
  ];

  it("round trips every kind of query box", () => {
    for (const qd of allData) {
      const b = box(qd, 10, 20);
      const js = JSON_QueryBox.toJSON(b);
      expect(equals(JSON_QueryBox.parseJSON(js), b)).toBe(true);
      expect(equals(JSON_QueryElement.parseJSON(js), QElemBox(b))).toBe(true);
    }
  });

  it("writes the same JSON as the Haskell program", () => {
    const b = QueryBox<TV>(tm.a, Rectangle(BoundBox(P(1, 2), P(3, 4))), Forwards<TV>(linkArrows));
    expect(JSON_QueryBox.toJSON(b)).toEqual({
      queryBoxId: tm.a,
      shape: { p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 } },
      type: "forwards",
      variants: { Link: ["Tail", "Head"] },
    });
    expect(JSON_QueryBox.toJSON(QueryBox<TV>(tm.a, Rectangle(BoundBox(P(1, 2), P(3, 4))), SubQuery<TV>(Nothing))))
      .toMatchObject({ type: "subquery", query: null });
    expect(() => JSON_QueryBox.parseJSON({ ...JSON_QueryBox.toJSON(b) as object, type: "bogus" }))
      .toThrow(/Unknown query box type: bogus/);
  });

  it("makes old zero length arrows visible", () => {
    const bogus = QueryArrow(did(), LineShape([Unconnected(P(0, 0)), Unconnected(P(0, 0))], []));
    const fixed = JSON_QueryArrow.parseJSON(JSON_QueryArrow.toJSON(bogus));
    expect(view(queryArrowShape, fixed)._lineEnds[1].connectorPoint).toEqual(P(50, 20));
    expect(view(queryArrowShape, fixed)._lineEnds[0].connectorPoint).toEqual(P(0, 0));
    const ok = QueryArrow(did(), LineShape([Unconnected(P(0, 0)), Unconnected(P(5, 0))], []));
    expect(equals(JSON_QueryElement.parseJSON(JSON_QueryArrow.toJSON(ok)), QElemArrow(ok))).toBe(true);
  });

  it("reads query diagrams with and without inputs", () => {
    const codec = JSON_QueryDiagram(cls);
    const qd = qdOf(pipeline("J", [Parent]), ["Box", "Link"]);
    const js = codec.toJSON(qd) as any;
    expect(Object.keys(js).sort()).toEqual(["description", "diagram", "inputs"]);
    expect(js.inputs).toEqual(["Box", "Link"]);
    expect(js.diagram.type).toBe("Query Diagram");
    expect(js.diagram.appearance).toEqual([]);
    expect(equals(codec.parseJSON(js), qd)).toBe(true);
    // Version 0.5 queries were plain diagrams: all types are inputs.
    const old = codec.parseJSON(js.diagram);
    expect(old._queryDescription).toBe("");
    expect(old._queryInputs).toEqual(S.fromList(["Package", "Box", "Link", "Diagram", "Query"].map(Variant)));
    expect(equals(old._queryDiagram, qd._queryDiagram)).toBe(true);
  });

  const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
  const examples: [string, any][] = fs.readdirSync(examplesDir)
    .filter((f) => f.endsWith(".dsm"))
    .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);
  /** The query diagram entity contents in the example models. */
  const exampleQueries: [string, any][] = examples.flatMap(([f, m]) =>
    (m.modelContents as any[])
      .filter((e) => e.contents?.diagram?.type === "Query Diagram")
      .map((e): [string, any] => [f + ": " + e.contents.diagram.name, e.contents]));

  it("finds the query diagrams in the examples", () => {
    expect(exampleQueries.length).toBeGreaterThan(20);
  });

  it.each(exampleQueries)("round trips %s", (_name, js) => {
    const codec = JSON_QueryDiagram(cls);
    const qd = codec.parseJSON(js);
    expect(codec.toJSON(qd)).toEqual(js);
  });
});

// ---------------------------------------------------------------------------------------------

describe("Reflective and dialogs", () => {
  const refl = queryRefl();
  const qd = qdOf(pipeline("R", []));

  it("has a reflective instance", () => {
    expect(refl.reflectiveName(qd)).toBe("Query");
    expect(refl.reflectiveBuiltIn(qd)).toEqual([nameField, descriptionField]);
    expect(refl.reflectiveGet(qd)).toEqual(M.fromList([[nameField, ExtText("R")], [descriptionField, ExtText("A query")]]));
    const st = { state: M.fromList([[nameField, ExtText("R2")], [descriptionField, ExtText("New")]]) };
    const qd2 = refl.reflectiveSet(st, qd);
    expect(qd2._queryDiagram._diagramEntityName._0).toBe("R2");
    expect(qd2._queryDescription).toBe("New");
    expect(M.size(st.state)).toBe(0);
    expect(refl.reflectiveBuiltInRefs).toEqual(mempty_RefTypeTable);
    expect(M.size(refl.reflectiveArrows)).toBe(0);
  });

  it("defaults to a query with every entity type as input", () => {
    const [d] = refl.reflectiveDefaults;
    expect(refl.reflectiveDefaults).toBe(refl.reflectiveDefaults);
    expect(d._queryDiagram._diagramEntityName._0).toBe("Query-");
    expect(d._queryDescription).toBe("");
    expect(view(queryInputs<TV>(), d)).toEqual(S.fromList(["Package", "Box", "Link", "Diagram", "Query"].map(Variant)));
    expect(diagramToList(d._queryDiagram._diagramEntityContents)).toEqual([]);
  });

  it("selects a dialog for each kind of box", () => {
    const title = (qd1: QueryData<TV>): Maybe<string> => {
      const r = queryElementDialog(cls)(model, QElemBox(box(qd1)));
      return r.tag === "Just" ? Just(r.value.dialogTitle) : Nothing;
    };
    expect(title(Step<TV>(S.empty()))).toEqual(Just("Step via:"));
    expect(title(Filter<TV>(""))).toEqual(Just("Filter condition"));
    expect(title(FilterVariants<TV>(S.empty()))).toEqual(Just("Entity types"));
    expect(title(Variants<TV>(S.empty()))).toEqual(Just("Entity types"));
    expect(title(SubQuery<TV>(Nothing))).toEqual(Just("Single Selector"));
    expect(title(Entities<TV>(S.empty()))).toEqual(Just("Entity Set Selection"));
    expect(title(Forwards<TV>(M.empty()))).toEqual(Just("Follow arrows forwards"));
    expect(title(Backwards<TV>(M.empty()))).toEqual(Just("Follow arrows backwards"));
    expect(title(QueryComment<TV>(""))).toEqual(Just("Query Comment"));
    for (const qd1 of [Parent, Children, InDiagram, FindDiagrams, QueryInput, QueryOutput]) expect(title(qd1)).toEqual(Nothing);
    expect(queryElementDialog(cls)(model, QElemArrow<TV>(link(did(), did())))).toEqual(Nothing);
  });

  it("has prisms and lenses for query data", () => {
    const b = box(Step<TV>(S.fromList(["Tail"])));
    expect(preview(queryBoxData<TV>().dot(_Step<TV>()), b)).toEqual(Just(S.fromList(["Tail"])));
    expect(view(queryBoxShape<TV>(), b)._rectangleShape).toEqual(BoundBox(P(0, 0), P(200, 100)));
    expect(set(queryBoxData<TV>().dot(_Filter<TV>()), "x", b)).toEqual(b); // Not a filter: unchanged.
    expect(set(_Entities<TV>(), ids(tm.a), Parent)).toEqual(Parent);
    expect(def_QueryData).toEqual(QueryInput);
    expect(HasId_QueryElement.identifier(QElemBox(b))).toBe(b.queryBoxId);
  });

  it("lists the queries in the model", () => {
    const found = flattenForest(queryForest(cls, model)).map(([n]) => n);
    expect(found).toEqual(expect.arrayContaining(["Q1", "Q2", "Q3"]));
  });

  it("builds a test dialog for a query", () => {
    const q1 = M.lookup(tm.q1, model.modelContents);
    if (q1.tag === "Nothing" || q1.value._entityContents.tag !== "Query") throw new Error("no Q1");
    const dlg = queryTest(cls, q1.value._entityContents.qd)(model, null);
    expect(dlg.tag === "Just" && dlg.value.dialogTitle).toBe("Test of Q1");
    const bad = queryTest(cls, qdOf(pipeline("Bad", [SubQuery<TV>(Nothing)])))(model, null);
    expect(bad.tag === "Just" && bad.value.dialogTitle).toBe("Query test error");
  });

  it("builds a clickable entity set gadget", () => {
    const ecls: Editable<HadesRender, TV> & typeof cls = {
      ...cls,
      editableActivation: () => function* () { return Nothing; },
      editableTreeMenu: () => Nothing,
      editableDisplayMenu: () => Nothing,
    };
    expect(clickableEntitySet(ecls)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------
// Editing query diagrams. Each input action runs in a model script on the query's subtype, as
// in Model.GI.ModelDiagrams.

interface Env {
  hint: Maybe<string>;
  log: string[];
  opened: ModelId[];
  /** Answer to a ScriptDialog instruction. */
  dialog: (v: any, sel: any) => Maybe<any>;
}

const newEnv = (dialog: Env["dialog"] = (v) => Just(v)): Env => ({ hint: Nothing, log: [], opened: [], dialog });

function interpret<W, A>(
  st0: ModelEditState<TV>,
  prsm: Traversal<TV, W>,
  script: ModelScriptAct<HadesRender, TV, W, A>,
  env: Env,
): Either<ModelError, [A, ModelEditState<TV>]> {
  let st = st0;
  let act = script;
  for (;;) {
    const r = runModelEdit(cls, prsm, st, (c) => stepScript(c, act));
    if (r.tag === "Left") return Left(r.value);
    const [upd, newState] = r.value;
    const step = upd.updateValue;
    if (step.tag === "Pure") return Right([step._0, newState]);
    const instr: UserScriptFunctor<HadesRender, TV> = step._0;
    env.log.push(instr.tag);
    let answer: any = null;
    switch (instr.tag) {
      case "ScriptDialog": answer = env.dialog(instr._1, instr._0); break;
      case "ScriptOpenDiagram": env.opened.push(instr._0.wrappedEntityId); break;
      case "ScriptGetHint": answer = env.hint; break;
      case "ScriptSetHint": env.hint = instr._0; break;
      case "ScriptGetSelection": answer = S.empty(); break;
      default: break;
    }
    st = newState;
    act = step._1(answer);
  }
}

function ok<A>(r: Either<ModelError, A>): A {
  if (r.tag === "Left") throw new Error("Script failed: " + JSON.stringify(r.value));
  return r.value;
}

type QE = QueryElement<TV>;

class Editor {
  nxt: ReturnType<typeof startDelta<QE>>;
  st: ModelEditState<TV>;
  out: ActionOutput<QE> | null = null;
  constructor(st: ModelEditState<TV>, qId: ModelId, readonly env: Env = newEnv(), contents0?: Diagram<QE>) {
    this.st = st;
    const e = M.lookup(qId, st.stateModel.modelContents);
    const contents = contents0 ?? (e.tag === "Just" && e.value._entityContents.tag === "Query"
      ? e.value._entityContents.qd._queryDiagram._diagramEntityContents
      : diagramFromList(qcls, []));
    this.nxt = startDelta<QE>(qcls, (d, a) => processAction(d, () => noPaint, keyCommands<QE>(), a),
      mkDiagramState(QueryContext(qId), 1, contents));
  }
  action(a: Action<QE>): void {
    const nxt = this.nxt;
    const self = this;
    const script = function* (c: ModelEditCtx<TV, QueryDiagram<TV>>): Generator<any, null, any> {
      const [out] = yield* applyDelta(c, nxt, a);
      self.out = out;
      return null;
    };
    const [, st2] = ok(interpret(this.st, _Query, script as ModelScriptAct<HadesRender, TV, QueryDiagram<TV>, null>, this.env));
    this.st = st2;
  }
  apply(cmd: Command<QE>, at: Point = P(0, 0)): void {
    this.action(mkAction(cmd, at, noMod, Nothing));
  }
  script(f: (d: any) => Generator<any, Action<QE>, any>): void {
    this.action(mkAction({ tag: "Script", _0: f }, P(0, 0), noMod, Nothing));
  }
  items(): QE[] {
    return diagramToList(deltaStateOf(this.nxt)._deltaDiagram);
  }
  queryDiagramOf(qId: ModelId): QueryDiagram<TV> {
    const e = M.lookup(qId, this.st.stateModel.modelContents);
    if (e.tag === "Nothing" || e.value._entityContents.tag !== "Query") throw new Error("no query");
    return e.value._entityContents.qd;
  }
}

/** Render a view on an SVG surface and return the document. */
function render(vw: View<QE>): string {
  const s = new Cairo.SvgSurface(1000, 1000);
  const env: HadesEnv = { style: hadesConfig({} as Gtk.IconTheme), cr: s.context() };
  vw.viewDraw(env);
  return s.document();
}

function menuItems(m: Menu<Action<QE>>): [string, Action<QE>][] {
  return m._0.flat().flatMap((i) => (i.menuValue.tag === "Right" ? [[i.menuLabel, i.menuValue.value] as [string, Action<QE>]] : []));
}

describe("query diagram editing", () => {
  it("uses one cached dictionary for Viewable, Connectable and Avatar", () => {
    expect(Avatar_QueryElement(cls)).toBe(qcls);
    expect(Viewable_QueryElement(cls)).toBe(qcls);
    expect(Connectable_QueryElement(cls)).toBe(qcls);
    expect(qcls.itemType(QElemBox(box(Parent)))).toBe("Query");
    expect(qcls.ascendedId(QElemBox(box(Parent)))).toEqual(Nothing);
    expect(qcls.diagramMetadataJ.toJSON(null)).toEqual([]);
  });

  it("wraps query entities for editing", () => {
    const [w] = edit(tm.st, (c) => {
      const e = M.lookup(tm.q1, c.state.stateModel.modelContents);
      if (e.tag === "Nothing") throw new Error("no Q1");
      return cls.getDiagramWrapper(c, e.value);
    });
    if (w.tag === "Nothing" || w.value.tag !== "DiagramWrapper") throw new Error("no wrapper");
    expect(w.value.diagramClass).toBe(qcls);
    expect(w.value.wrappedEntityId).toBe(tm.q1);
    expect(w.value.diagramContext).toEqual(QueryContext(tm.q1));
    expect(w.value.diagramMenu.tag).toBe("Just");
    const tb = w.value.diagramToolbar(null as any);
    expect(tb.toolbarLeft.map((g) => g.map((t) => t.toolIcon))).toEqual([
      ["query-forwards", "query-backwards", "query-step", "query-parent", "query-children", "query-in-diagram",
        "query-find-diagrams", "query-filter", "query-filter-variants", "query-subquery"],
      ["query-variants", "query-entities", "query-input", "query-output"],
      ["query-arrow"],
      ["basic_comment"],
    ]);
    expect(tb.toolbarRight.map((g) => g.map((t) => t.toolIcon))).toEqual([["align", "align-size", "align-distribute"]]);
    // A non-query entity has no query wrapper.
    const [w2] = edit(tm.st, (c) => {
      const e = M.lookup(tm.a, c.state.stateModel.modelContents);
      if (e.tag === "Nothing") throw new Error("no A");
      return cls.getDiagramWrapper(c, e.value);
    });
    expect(w2).toEqual(Nothing);
  });

  it("opens query diagrams on activation", () => {
    const env = newEnv();
    const e = M.lookup(tm.q1, model.modelContents);
    if (e.tag === "Nothing") throw new Error("no Q1");
    const [r] = ok(interpret(tm.st, _Query, (c) => queryActivation(cls, c, e.value), env));
    expect(r).toEqual(Nothing);
    expect(env.opened).toEqual([tm.q1]);
  });

  it("describes boxes using the model", () => {
    const ed = new Editor(tm.st, tm.q1);
    const boxes = [
      box(Entities<TV>(ids(tm.a, tm.b))), box(SubQuery<TV>(Nothing)), box(SubQuery<TV>(Just(tm.q2))),
      box(QueryInput), box(Step<TV>(S.fromList(["Tail"]))), box(FilterVariants<TV>(S.fromList([Variant("Link")]))),
      box(QueryComment<TV>("Remember this")),
    ];
    const views: View<QE>[] = [];
    let modelId: DiagramId = U.nil;
    let descs: string[] = [];
    ed.script(function* (d) {
      modelId = yield* qcls.getDiagramModelId(d);
      for (const b of boxes) views.push(yield* d.cls.itemView(d, QElemBox(b)));
      descs = [];
      for (const b of boxes) descs.push(yield* d.cls.itemDescription(d, QElemBox(b)));
      return yield* yieldViews(d);
    });
    expect(modelId).toBe(tm.q1);
    expect(descs).toEqual(["Entities", "SubQuery", "SubQuery", "Input", "Step", "Filter Types", "Comment"]);
    const svgs = views.map(render);
    // Names in UUID order, as S.toList gives them.
    expect(svgs[0]).toContain(tm.a < tm.b ? "A, B" : "B, A");
    expect(svgs[1]).toContain("&lt;Nothing selected&gt;");
    expect(svgs[2]).toContain("Q2");
    expect(svgs[3]).toContain("Box"); // The inputs of Q1.
    expect(svgs[4]).toContain("Tail");
    expect(svgs[5]).toContain("Link");
    expect(svgs[6]).toContain("Remember");
    // Touching and bounds.
    expect(views[0].viewTouched(P(100, 50))).toBe(true);
    expect(views[0].viewTouched(P(300, 50))).toBe(false);
    expect(views[0].viewBox).toEqual(BoundBox(P(0, 0), P(200, 100)));
  });

  it("connects arrows to boxes other than comments", () => {
    const ed = new Editor(tm.st, tm.q1);
    const arrow = QElemArrow<TV>(link(did(), did()));
    const results: boolean[] = [];
    ed.script(function* (d) {
      results.push(yield* qcls.itemCanConnect(d, "ConnectionFrom", arrow, QElemBox(box(Parent)), Nothing));
      results.push(yield* qcls.itemCanConnect(d, "ConnectionTo", arrow, QElemBox(box(QueryComment<TV>(""))), Nothing));
      results.push(yield* qcls.itemCanConnect(d, "ConnectionTo", arrow, arrow, Nothing));
      results.push(yield* qcls.itemCanConnect(d, "ConnectionTo", QElemBox(box(Parent)), QElemBox(box(Parent)), Nothing));
      return yield* yieldViews(d);
    });
    expect(results).toEqual([true, false, false, false]);
  });

  it("moves and resizes elements", () => {
    const ed = new Editor(tm.st, tm.q1);
    const [first] = ed.items().filter((e) => e.tag === "QElemBox");
    const moved: QE[] = [];
    ed.script(function* (d) {
      moved.push(yield* qcls.itemMove(d, [10, 5], first));
      moved.push(yield* qcls.itemResize(d, [50, 40], moved[0]));
      return yield* yieldViews(d);
    });
    expect(qcls.itemBounds(moved[0])).toEqual(BoundBox(P(10, 5), P(210, 105)));
    // Resizing keeps the centre of the box.
    expect(qcls.itemBounds(moved[1])).toEqual(BoundBox(P(85, 35), P(135, 75)));
    const stored = ed.items().find((e) => qcls.identifier(e) === qcls.identifier(first))!;
    expect(qcls.itemBounds(stored)).toEqual(BoundBox(P(85, 35), P(135, 75)));
  });

  it("edits the inputs of the query from the input box menu", () => {
    const env = newEnv((v, sel) => {
      expect(sel(model, v).tag).toBe("Just");
      return Just(S.fromList([Variant("Link")]));
    });
    const ed = new Editor(tm.st, tm.q1, env);
    const input = ed.items().find((e) => e.tag === "QElemBox" && e._0._queryBoxData.tag === "QueryInput")!;
    let vw: View<QE> | null = null;
    ed.script(function* (d) {
      vw = yield* d.cls.itemView(d, input);
      return yield* yieldViews(d);
    });
    const items = menuItems(vw!.viewMenu(P(10, 10)));
    expect(items[0][0]).toBe("Edit inputs");
    expect(items.map(([l]) => l)).toContain("To top");
    ed.action(items[0][1]);
    expect(view(queryInputs<TV>(), ed.queryDiagramOf(tm.q1))).toEqual(S.fromList([Variant("Link")]));
    expect(ed.out?.outCheckpoint).toEqual(Just("Edited inputs of Q1"));
    // Other boxes have only the basic menu.
    const other = ed.items().find((e) => e.tag === "QElemBox" && e._0._queryBoxData.tag !== "QueryInput")!;
    ed.script(function* (d) {
      vw = yield* d.cls.itemView(d, other);
      return yield* yieldViews(d);
    });
    expect(menuItems(vw!.viewMenu(P(10, 10))).map(([l]) => l)).not.toContain("Edit inputs");
  });

  it("tests the query from the background menu", () => {
    let selector: any = null;
    const env = newEnv((_v, sel) => {
      selector = sel;
      return Nothing;
    });
    const ed = new Editor(tm.st, tm.q1, env);
    const items = menuItems(queryBackgroundMenu(cls, P(0, 0)));
    expect(items.map(([l]) => l)).toEqual(["Test query"]);
    expect(menuItems(queryBackgroundMenu(cls)(P(5, 5))).length).toBe(1);
    ed.action(items[0][1]);
    expect(env.log).toContain("ScriptDialog");
    const dlg = selector(model, null);
    expect(dlg.tag === "Just" && dlg.value.dialogTitle).toBe("Test of Q1");
  });

  it("adds boxes with the toolbar", () => {
    const env = newEnv((v, sel) => {
      expect(sel(model, v).tag).toBe("Just"); // Forwards boxes have a dialog.
      return Just(Forwards<TV>(linkArrows));
    });
    const ed = new Editor(tm.st, tm.q1, env);
    const before = ed.items().length;
    const tool = queryDiagramToolbar(cls).toolbarLeft[0][0];
    if (tool.toolAction.tag !== "DeltaToolAction") throw new Error("not an action");
    ed.action(tool.toolAction._0);
    expect(env.hint).toEqual(Just("Click and drag to define the new shape."));
    ed.apply(Select, P(500, 500));
    const items = ed.items();
    expect(items.length).toBe(before + 1);
    const added = items.find((e) => e.tag === "QElemBox" && e._0._queryBoxData.tag === "Forwards");
    expect(added && qcls.itemBounds(added)).toEqual(BoundBox(P(400, 450), P(600, 550)));
    expect(added && preview(_QElemBox<TV>().dot(queryBoxData<TV>()), added)).toEqual(Just(Forwards<TV>(linkArrows)));
    expect(ed.out?.outCheckpoint).toEqual(Just("Added `Follow forwards' to query diagram"));
  });

  it("adds arrows between boxes with the toolbar", () => {
    const b1 = box(Parent, 1000, 0);
    const b2 = box(Children, 1000, 400);
    const ed2 = new Editor(tm.st, tm.q3, newEnv(), diagramFromList(qcls, [QElemBox(b1), QElemBox(b2)]));
    const tool = queryDiagramToolbar(cls).toolbarLeft[2][0];
    if (tool.toolAction.tag !== "DeltaToolAction") throw new Error("not an action");
    ed2.action(tool.toolAction._0);
    ed2.apply(Drag([0, 0]), P(1100, 50));
    ed2.apply(Drag([0, 200]), P(1100, 50));
    ed2.apply(EndDrag([0, 400]), P(1100, 50));
    const arrows = ed2.items().filter((e) => e.tag === "QElemArrow");
    expect(arrows.length).toBe(1);
    const [e1, e2] = previewOrThrow(_QElemArrow<TV>().dot(queryArrowShape), arrows[0])._lineEnds;
    expect(e1).toMatchObject({ tag: "Connected", connectorTarget: b1.queryBoxId });
    expect(e2).toMatchObject({ tag: "Connected", connectorTarget: b2.queryBoxId });
    expect(ed2.out?.outCheckpoint).toEqual(Just("Added arrow to query diagram"));
  });
});

