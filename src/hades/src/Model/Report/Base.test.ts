import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { identity, lens, preview, prism, review, set, view, type Prism } from "@/lib/Control/Lens";
import * as H from "@/lib/Text/Blaze/Html5";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { BoundBox, Connected, LineShape, Point as P, Rectangle, diagramFromList, type DiagramId } from "@/hades/src/Hades/Abstract";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, extract, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import {
  BuiltInDef, DecoBool, DecoBoolDef, DecoIntDef, DecoRange, EnumDef, EnumItem, Field, migrateField,
  type FieldId, type FieldTable, type TypeDef,
} from "@/hades/src/Model/Reflection/Types";
import { ExtBool, ExtInt, ExtText, Variant, _ExtText, type ExtValue } from "@/hades/src/Model/Reflection/Values";
import {
  type ModelEditCtx, type ModelEditState, type ModelId, type Model,
  Name, Package, descriptionField, emptyModel, goToEntity, mkEntity, mkPackage,
  modelStartState, nameField, nameText, packageName, runModelEdit, show_ModelError, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import { DiagramEntity as mkDiagramEntity, diagramEntityName, type DiagramEntity } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import {
  Avatar_QueryElement, Children, QElemArrow, QElemBox, QueryArrow, QueryBox, QueryDiagram, QueryInput,
  QueryOutput, Reflective_QueryDiagram, queryDiagram, queryDiagramWrapper,
  type QueryData, type QueryElement,
} from "@/hades/src/Model/Query/Diagram";
import {
  ColumnGroup, ExprColumn, FieldColumn, FieldColumnData, LookupColumn, Matrix, MatrixColumn, QueryColumn,
  Reflective_Matrix, SortOrder, matrixName,
} from "@/hades/src/Model/Matrices/Base";
import { LookupTable, Reflective_LookupTable, tableName } from "@/hades/src/Model/Lookups/Base";
import {
  Attr, DefinitionList, Heading, Highlight, Icon, LinkOut, Para, Plain, Space, Str, noAttr,
  type Block, type Inline,
} from "./Document";
import {
  DiagramRef, IconRef, JSON_Report, JSON_ReportFragment, Reflective_Report, Report, ReportDiagram,
  ReportField, ReportFieldList, ReportHeading, ReportLiteral, ReportLookup, ReportMatrix,
  ResultFragment, SubReport, _ReportHeading, _SubReport, append_ResultFragment, blankReport,
  finaliseResult, fragmentDescription, inColour, inlineIcon, mconcat_ResultFragment,
  mempty_ResultFragment, prefixBlock, reportName, reportPageDefault, runReport, show_ImageRef,
  show_ReportPageLayout, textToBlocks,
  type HasReports, type ImageRef, type ReportFragment, type ReportGeneratorClass,
} from "./Base";
import { mkHtmlDocument } from "./Html";

// ---------------------------------------------------------------------------------------------
// JSON with the example models

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const exampleReports: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .flatMap((f) => {
    const m = JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"));
    return (m.modelContents as any[])
      .filter((e) => e.contents?.type === "report")
      .map((e) => [f + ": " + e.contents.name, e.contents] as [string, any]);
  });

const isUuid = (t: unknown): boolean => typeof t === "string" && U.fromText(t).tag === "Just";

/** What the Haskell program writes back for a report read from an older file. */
function migrated(r: any): any {
  const frag = (f: any): any => {
    if ("field" in f) return { field: isUuid(f.field) ? f.field : U.toText(migrateField(f.field)) };
    if ("field-list" in f) return { "field-list": f["field-list"].map((x: string) => (isUuid(x) ? x : U.toText(migrateField(x)))) };
    if ("level" in f) {
      const rest = f.rest === null ? null : [isUuid(f.rest[0]) ? f.rest[0] : U.toText(migrateField(f.rest[0])), f.rest[1]];
      return { level: f.level, text1: f.text1, rest };
    }
    if ("subreport" in f) {
      return {
        query: f.query,
        sort: f.sort ?? [[U.toText(nameField), "Ascending"]],
        subreport: f.subreport.map(frag),
      };
    }
    return f;
  };
  return {
    type: "report", name: r.name, description: r.description ?? "", input: r.input ?? null,
    template: r.template ?? null, spec: r.spec.map(frag),
  };
}

describe("Report JSON with the example models", () => {
  it("finds the reports", () => {
    expect(exampleReports.length).toBe(5);
  });
  for (const [name, r] of exampleReports) {
    it("round trips " + name, () => {
      const rpt = JSON_Report.parseJSON(r);
      const out = JSON_Report.toJSON(rpt);
      expect(out).toEqual(migrated(r));
      // Stable from then on.
      expect(JSON_Report.toJSON(JSON_Report.parseJSON(out))).toEqual(out);
    });
  }

  it("reads and writes every kind of fragment", () => {
    const q = U.fromWords(9, 9, 9, 9);
    const fid = migrateField("Rank");
    const frags: ReportFragment[] = [
      ReportLiteral("x"), ReportField(fid), ReportFieldList([fid, nameField]),
      ReportHeading(2, "t", Just([fid, "u"] as const)), ReportHeading(1, "t", Nothing), ReportDiagram,
      ReportMatrix(Just(q)), ReportMatrix(Nothing), ReportLookup(Just(q)), ReportLookup(Nothing),
      SubReport(Just(q), SortOrder([[fid, "Descending"]]), [ReportDiagram]), SubReport(Nothing, SortOrder([]), []),
    ];
    for (const f of frags) expect(JSON_ReportFragment.parseJSON(JSON_ReportFragment.toJSON(f))).toEqual(f);
    expect(JSON_ReportFragment.toJSON(ReportDiagram)).toEqual({ type: "diagram" });
    expect(JSON_ReportFragment.toJSON(ReportHeading(1, "t", Nothing))).toEqual({ level: 1, text1: "t", rest: null });
    // Old field names are migrated; a missing sort order is by name.
    expect(JSON_ReportFragment.parseJSON({ field: "Rank" })).toEqual(ReportField(fid));
    expect(JSON_ReportFragment.parseJSON({ query: null, subreport: [] }))
      .toEqual(SubReport(Nothing, SortOrder([[nameField, "Ascending"]]), []));
    expect(() => JSON_ReportFragment.parseJSON({ type: "other" })).toThrow();
    expect(() => JSON_Report.parseJSON({ type: "matrix", name: "x", spec: [] })).toThrow();
  });
});

describe("Report values", () => {
  it("reflects names and descriptions", () => {
    const r = Report(Name("R"), "D", Nothing, Nothing, []);
    expect(Reflective_Report.reflectiveGet(r)).toEqual(M.fromList([[nameField, ExtText("R")], [descriptionField, ExtText("D")]]));
    const st = { state: M.fromList<FieldId, ExtValue>([[nameField, ExtText("  New ")], [descriptionField, ExtText("E")]]) };
    const r2 = Reflective_Report.reflectiveSet(st, r);
    expect(view(reportName(), r2)).toEqual(Name("New"));
    expect(r2._reportDescription).toBe("E");
    expect(blankReport._reportSpec).toEqual([ReportHeading(1, "", Just([nameField, ""]))]);
    expect(show_ReportPageLayout(reportPageDefault)).toBe("A4 Landscape");
  });

  it("prisms", () => {
    const h = ReportHeading(3, "x", Nothing);
    expect(preview(_ReportHeading(), h)).toEqual(Just([3, "x", Nothing]));
    expect(preview(_SubReport(), h)).toEqual(Nothing);
    expect(review(_SubReport(), [Nothing, SortOrder([]), []] as const)).toEqual(SubReport(Nothing, SortOrder([]), []));
  });

  it("orders image references as Haskell does", () => {
    const d = DiagramRef(U.fromWords(0, 0, 0, 1));
    const refs = M.fromList<ImageRef, number>([[d, 1], [IconRef("b"), 2], [IconRef("a"), 3]]);
    expect(M.keys(refs).map(show_ImageRef)).toEqual(["IconRef \"a\"", "IconRef \"b\"", "DiagramRef 00000000-0000-0000-0000-000000000001"]);
  });
});

describe("Result fragments", () => {
  const frag = (blocks: Block[], inlines: Inline[]) => ResultFragment(blocks, inlines, [], []);

  it("turns text into paragraphs", () => {
    expect(textToBlocks("")).toEqual(mempty_ResultFragment);
    expect(textToBlocks("a")).toEqual(frag([], [Str("a")]));
    expect(textToBlocks("a\n")).toEqual(frag([Para([Str("a\n")])], []));
    // As in Haskell, joining fragments puts a space in front of the inlines, and prefixing
    // (empty) inlines puts one in front of the paragraph.
    expect(textToBlocks("a\n\nb")).toEqual(frag([Para([Str("a")])], [Space, Str("b")]));
    expect(textToBlocks("a\n\nb\n\n")).toEqual(frag([Para([Str("a")]), Para([Space, Str("b")]), Para([Space])], []));
  });

  it("joins inlines onto the following paragraph", () => {
    expect(append_ResultFragment(frag([], [Str("a ")]), frag([], [Str(" b")]))).toEqual(frag([], [Str("a "), Space, Str("b")]));
    expect(append_ResultFragment(frag([], [Str("a")]), frag([Para([Str("b")]), Para([Str("c")])], [Str("d")])))
      .toEqual(frag([Para([Str("a"), Space, Str("b")]), Para([Str("c")])], [Str("d")]));
    expect(prefixBlock([Str("a")], Heading(1, noAttr, [Str("h")]))).toEqual([Para([Str("a")]), Heading(1, noAttr, [Str("h")])]);
    expect(prefixBlock([Str("a")], Plain([Str(" p")]))).toEqual([Plain([Str("a"), Space, Str("p")])]);
    expect(finaliseResult(frag([], [Str(" x ")]))).toEqual(frag([Para([Str("x")])], []));
    expect(mconcat_ResultFragment([frag([], [Str("a")]), inlineIcon("i"), frag([], [Str("b")])]))
      .toEqual(ResultFragment([], [Str("a"), Space, Icon("i"), Space, Str("b")], [IconRef("i")], []));
  });

  it("colours inlines", () => {
    const red = C.sRGB24(255, 0, 0);
    expect(inColour(red, frag([Para([Str("p")])], [Str("i")])))
      .toEqual(frag([Para([Highlight(red, [Str("p")])])], [Highlight(red, [Str("i")])]));
    expect(inColour(red, frag([], []))).toEqual(frag([], []));
  });
});

// ---------------------------------------------------------------------------------------------
// A toy model with things, packages, query diagrams, matrices, lookup tables and reports.

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, null> }
  | {
      readonly tag: "Thing"; readonly name: Name; readonly rank: number; readonly status: string;
      readonly done: boolean; readonly url: string; readonly note: string;
    }
  | { readonly tag: "Matrix"; readonly matrix: Matrix }
  | { readonly tag: "Query"; readonly qd: QueryDiagram<TV> }
  | { readonly tag: "Lookup"; readonly table: LookupTable }
  | { readonly tag: "Report"; readonly report: Report<TV> };

const fRank = migrateField("Rank");
const fStatus = migrateField("Status");
const fDone = migrateField("Done");
const fUrl = migrateField("Web");
const fNote = migrateField("Note");
const red = C.sRGB24(255, 0, 0);
const green = C.sRGB24(0, 255, 0);
const yellow = C.sRGB24(255, 255, 0);

const fieldDefs: [FieldId, string, TypeDef][] = [
  [fRank, "Rank", DecoIntDef(DecoRange<number>([Just(1), Just(3)], [
    [[Just(1), Just(2)], [Just("low"), Just(green)]],
    [[Just(3), Nothing], [Nothing, Just(red)]],
  ]))],
  [fStatus, "Status", EnumDef([EnumItem("Open", Just("open"), Just(yellow)), EnumItem("Closed", Nothing, Nothing)])],
  [fDone, "Done", DecoBoolDef(DecoBool(Just(["no", "yes"]), Just([red, green])))],
  [fUrl, "Web", BuiltInDef("ModelURL")],
  [fNote, "Note", BuiltInDef("ModelNote")],
];
const fields: FieldTable = M.fromList(fieldDefs.map(([fid, n, t]) => [fid, Field(false, fid, n, "One", t)] as [FieldId, Field]));

const Thing = (n: string, rank: number, status: string, done: boolean, note = ""): TV =>
  ({ tag: "Thing", name: Name(n), rank, status, done, url: "http://example.com/" + n, note });

const nameL = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "Pkg": return v.pkg._packageName;
      case "Query": return v.qd._queryDiagram._diagramEntityName;
      case "Matrix": return v.matrix._matrixName;
      case "Lookup": return v.table._tableName;
      case "Report": return v.report._reportName;
      default: return v.name;
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "Pkg": return { ...v, pkg: set(packageName(), n, v.pkg) };
      case "Query": return { ...v, qd: set(queryDiagram<TV>().dot(diagramEntityName()), n, v.qd) };
      case "Matrix": return { ...v, matrix: set(matrixName, n, v.matrix) };
      case "Lookup": return { ...v, table: set(tableName, n, v.table) };
      case "Report": return { ...v, report: set(reportName(), n, v.report) };
      default: return { ...v, name: n };
    }
  },
);

const mkPrism = <K extends TV["tag"], A>(tag: K, get: (v: Extract<TV, { tag: K }>) => A, mk: (a: A) => TV): Prism<TV, A> =>
  prism(mk, (v: TV) => (v.tag === tag ? Right(get(v as Extract<TV, { tag: K }>)) : Left(v)));
const _Pkg = mkPrism("Pkg", (v) => v.pkg, (pkg: Package<TV, null>): TV => ({ tag: "Pkg", pkg }));
const _Query = mkPrism("Query", (v) => v.qd, (qd: QueryDiagram<TV>): TV => ({ tag: "Query", qd }));
const _MatrixP = mkPrism("Matrix", (v) => v.matrix, (matrix: Matrix): TV => ({ tag: "Matrix", matrix }));
const _LookupP = mkPrism("Lookup", (v) => v.table, (table: LookupTable): TV => ({ tag: "Lookup", table }));
const _ReportP = mkPrism("Report", (v) => v.report, (report: Report<TV>): TV => ({ tag: "Report", report }));

let queryReflCache: Reflective<QueryDiagram<TV>> | null = null;
const queryRefl = (): Reflective<QueryDiagram<TV>> => (queryReflCache ??= Reflective_QueryDiagram(cls));

/** `EntityClass`, `HasDiagrams HadesRender`, `HasLookups` and `HasReports` for TV. */
const cls: ReportGeneratorClass<TV> & HasReports<TV> = {
  reflectiveName: (v) => Variant({
    Pkg: "Package", Thing: "Thing", Matrix: "Matrix", Query: "Query", Lookup: "Lookup Table", Report: "Report",
  }[v.tag]),
  variantUserLabel: defaultVariantUserLabel,
  get reflectiveDefaults(): readonly TV[] {
    return [
      { tag: "Pkg", pkg: Package<TV, null>(Name(""), null) }, Thing("", 0, "", false),
      { tag: "Query", qd: queryRefl().reflectiveDefaults[0] },
    ];
  },
  reflectiveBuiltIn: (v) => {
    switch (v.tag) {
      case "Query": return queryRefl().reflectiveBuiltIn(v.qd);
      case "Matrix": return Reflective_Matrix.reflectiveBuiltIn(v.matrix);
      case "Lookup": return Reflective_LookupTable.reflectiveBuiltIn(v.table);
      case "Report": return Reflective_Report.reflectiveBuiltIn(v.report);
      case "Thing": return [nameField, fRank, fStatus, fDone, fUrl, fNote];
      default: return [nameField];
    }
  },
  reflectiveGet: (v) => {
    switch (v.tag) {
      case "Query": return queryRefl().reflectiveGet(v.qd);
      case "Matrix": return Reflective_Matrix.reflectiveGet(v.matrix);
      case "Lookup": return Reflective_LookupTable.reflectiveGet(v.table);
      case "Report": return Reflective_Report.reflectiveGet(v.report);
      case "Thing": return M.fromList<FieldId, ExtValue>([
        [nameField, ExtText(v.name._0)], [fRank, ExtInt(v.rank)], [fStatus, ExtText(v.status)],
        [fDone, ExtBool(v.done)], [fUrl, ExtText(v.url)], [fNote, ExtText(v.note)],
      ]);
      default: return M.singleton(nameField, ExtText(view(nameL.dot(nameText), v)));
    }
  },
  reflectiveSet: (st, v) => set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v),
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
  _LookupTable: _LookupP,
  _Report: _ReportP,
  isDiagram: (v) => v.tag === "Query",
  getDiagramWrapper: (ctx, e) => (e._entityContents.tag === "Query"
    ? withSubtype(ctx, _Query, (c) => queryDiagramWrapper(cls, c, e))
    : Nothing),
  diagramEntityTypes: M.empty(),
  diagramMapAvatars: (_f, e) => e,
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
  if (r.tag === "Left") throw new Error("Model edit failed: " + show_ModelError(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

const startModel: Model<TV> = { ...emptyModel(cls, "Test"), modelFields: fields };

/** Top / Data / {P1 / {A, B}, P2 / {C}}; Top / Queries / {Children, NotAQuery, Risk (lookup table)}. */
const [ids, st] = edit(modelStartState(newGenerator(), startModel), (c) => {
  const top = mkPackage(c, Name("Top"));
  goToEntity(c, top);
  const data = mkPackage(c, Name("Data"));
  goToEntity(c, data);
  const p1 = mkPackage(c, Name("P1"));
  const p2 = mkPackage(c, Name("P2"));
  goToEntity(c, p1);
  const a = mkEntity(c, Thing("A", 3, "Open", true, "First note.\n\nSecond note.")).entityId;
  const b = mkEntity(c, Thing("B", 1, "Closed", false)).entityId;
  goToEntity(c, p2);
  const cc = mkEntity(c, Thing("C", 2, "Unknown", false)).entityId;
  goToEntity(c, top);
  const qs = mkPackage(c, Name("Queries"));
  goToEntity(c, qs);
  const children = mkEntity(c, { tag: "Query", qd: QueryDiagram<TV>(pipeline("Children", [Children]), S.fromList(["Package"]), "") }).entityId;
  const notAQuery = mkEntity(c, Thing("NotAQuery", 0, "", false)).entityId;
  const table = mkEntity(c, {
    tag: "Lookup",
    table: LookupTable(Name("Risk"), fDone, fRank, fStatus, M.fromList<readonly [ExtValue, ExtValue], ExtValue>([
      [[ExtBool(false), ExtInt(1)], ExtText("Closed")],
      [[ExtBool(true), ExtInt(3)], ExtText("Open")],
    ])),
  }).entityId;
  return { top, data, qs, p1, p2, a, b, c: cc, children, notAQuery, table };
});

/** Top / Queries / Things (matrix). */
const [matrixIds, st2] = edit(st, (c) => {
  goToEntity(c, ids.qs);
  const matrix = mkEntity(c, {
    tag: "Matrix",
    matrix: Matrix(Name("Things"), "", S.empty(), [
      ColumnGroup(ids.children, [MatrixColumn("Package", FieldColumn(FieldColumnData(nameField, Nothing)))], SortOrder([[nameField, "Ascending"]])),
      ColumnGroup(ids.children, [
        MatrixColumn("Name", FieldColumn(FieldColumnData(nameField, Just(fUrl)))),
        MatrixColumn("Rank", FieldColumn(FieldColumnData(fRank, Nothing))),
        MatrixColumn("Double", ExprColumn(false, "[Rank] * 2")),
        MatrixColumn("Bad", ExprColumn(false, "[Rank] +")),
        MatrixColumn("Children", QueryColumn(ids.children)),
        MatrixColumn("Risk", LookupColumn(ids.table)),
      ], SortOrder([[fRank, "Descending"]])),
    ]),
  }).entityId;
  return { matrix };
});
const model = st2.stateModel;

/** Run a report on an entity. */
function report(spec: readonly ReportFragment<TV>[], input: ModelId): ReturnType<typeof runReport> {
  const [r] = edit(st2, (c) => runReport(cls, c, Report<TV>(Name("R"), "", Nothing, Nothing, spec), input));
  return r;
}

const headAttr = (mId: ModelId, lvl: number) => Attr(Just([mId, lvl] as const), Nothing);
const textAttr = (t: string) => Attr(Nothing, Just(t));

describe("runReport", () => {
  it("writes headings, literal text and fields", () => {
    const [blocks, images, errs] = report([
      ReportHeading(1, "Report on", Just([nameField, "package"] as const)),
      ReportLiteral("Intro.\n\nStart of"),
      ReportField(nameField),
      ReportHeading(2, "Missing", Just([fRank, "rank"] as const)),
    ], ids.p1);
    expect(blocks).toEqual([
      Heading(1, headAttr(ids.p1, 1), [Str("Report on P1 package")]),
      // As in Haskell, prefixing the (empty) inlines of the heading adds a space.
      Para([Space, Str("Intro.")]),
      // The trailing inlines of the literal and the field are joined into a paragraph.
      Para([Str("Start of"), Space, Str("P1")]),
      Heading(2, headAttr(ids.p1, 2), [Str("Missing [?] rank")]),
    ]);
    expect(images).toEqual([]);
    expect(errs).toEqual([[ids.p1, "Field Rank not found in level 2 heading."]]);
  });

  it("formats decorated fields and field lists", () => {
    const [blocks, images, errs] = report([ReportFieldList([fRank, fStatus, fDone, fUrl, descriptionField])], ids.a);
    expect(blocks).toEqual([DefinitionList([
      [[Str("Rank: ")], [Para([Highlight(red, [Str("3")])])]],
      [[Str("Status: ")], [Para([Icon("open"), Space, Highlight(yellow, [Str("Open")])])]],
      // As in Haskell, a true value is shown in the colour for false.
      [[Str("Done: ")], [Para([Icon("yes"), Space, Highlight(red, [Str("Yes")])])]],
      [[Str("Web: ")], [Para([Str("http://example.com/A")])]],
      [[Str("Description: ")], []],
    ])]);
    expect(images).toEqual([IconRef("open"), IconRef("yes")]);
    expect(errs).toEqual([]);
    const [b2] = report([ReportField(fRank), ReportField(fStatus), ReportField(fNote)], ids.b);
    expect(b2).toEqual([Para([Icon("low"), Space, Highlight(green, [Str("1")]), Space, Str("Closed")])]);
    const [b3] = report([ReportField(fNote)], ids.a);
    expect(b3).toEqual([Para([Str("First note.")]), Para([Str("Second note.")])]);
    const [b4] = report([ReportField(fStatus)], ids.c);
    expect(b4).toEqual([Para([Str("Unknown")])]);
  });

  it("runs sub-reports in the sort order", () => {
    const [blocks, , errs] = report([
      SubReport(Just(ids.children), SortOrder([[fRank, "Descending"]]), [ReportHeading(2, "", Just([nameField, ""] as const))]),
      SubReport(Just(ids.children), SortOrder([[nameField, "Descending"]]), [ReportField(nameField)]),
      SubReport(Nothing, SortOrder([]), [ReportField(fRank)]),
      SubReport(Just(ids.notAQuery), SortOrder([]), [ReportField(nameField)]),
    ], ids.p1);
    expect(blocks).toEqual([
      Heading(2, headAttr(ids.a, 2), [Str("A")]),
      // As in Haskell, the (empty) inlines before a heading become an empty paragraph.
      Para([]),
      Heading(2, headAttr(ids.b, 2), [Str("B")]),
      Para([Str("B"), Space, Str("A")]),
    ]);
    expect(errs).toEqual([[ids.notAQuery, "Subreport query is not a query."]]);
  });

  it("tabulates matrices", () => {
    const [blocks, images, errs] = report([ReportMatrix(Just(matrixIds.matrix)), ReportMatrix(Nothing)], ids.data);
    expect(blocks.length).toBe(1);
    const m = blocks[0];
    if (m.tag !== "Matrix") throw new Error("not a matrix");
    expect(m._1).toEqual([Str("Things")]);
    expect(m._2.map((h) => [h.matrixHeaderName, h.matrixHeaderColumns])).toEqual([
      [[Str("Children")], [[Str("Package")]]],
      [[Str("Children")], ["Name", "Rank", "Double", "Bad", "Children", "Risk"].map((n) => [Str(n)])],
    ]);
    const cellText = (b: readonly Block[]): unknown => b.map((x) => (x.tag === "Para" ? x._0 : x.tag));
    const rows = m._3.map((t) => [t.rootLabel.map(([a, b]) => [a.attrClass, cellText(b)]),
      t.subForest.map((s) => s.rootLabel.map(([a, b]) => [a.attrClass, cellText(b)]))]);
    expect(rows).toEqual([
      [[[Just("Text"), [[Str("P1")]]]], [
        [
          [Just("Text"), [[LinkOut("http://example.com/A", [Str("A")])]]],
          [Just("Integer"), [[Highlight(red, [Str("3")])]]],
          [Just("Integer"), [[Str("6")]]],
          [Just("Text"), []],
          [Just("Text"), []],
          [Just("Enum"), [[Icon("open"), Space, Highlight(yellow, [Str("Open")])]]],
        ],
        [
          [Just("Text"), [[LinkOut("http://example.com/B", [Str("B")])]]],
          [Just("Integer"), [[Icon("low"), Space, Highlight(green, [Str("1")])]]],
          [Just("Integer"), [[Str("2")]]],
          [Just("Text"), []],
          [Just("Text"), []],
          [Just("Enum"), [[Str("Closed")]]],
        ],
      ]],
      [[[Just("Text"), [[Str("P2")]]]], [[
        [Just("Text"), [[LinkOut("http://example.com/C", [Str("C")])]]],
        [Just("Integer"), [[Icon("low"), Space, Highlight(green, [Str("2")])]]],
        [Just("Integer"), [[Str("4")]]],
        [Just("Text"), []],
        [Just("Text"), []],
        // The lookup gives no value: not an enumeration value.
        [Just("Text"), [[]]],
      ]]],
    ]);
    expect(images).toEqual([IconRef("open"), IconRef("low"), IconRef("low")]);
    expect(errs.length).toBe(3);
    expect(errs.every(([mId]) => mId === ids.a || mId === ids.b || mId === ids.c)).toBe(true);
  });

  it("tabulates lookup tables", () => {
    const [blocks, images, errs] = report([ReportLookup(Just(ids.table)), ReportLookup(Nothing)], ids.data);
    expect(errs).toEqual([]);
    // Column headers first, then the rows (row header, then cells).
    expect(images).toEqual([IconRef("no"), IconRef("yes"), IconRef("low"), IconRef("low"), IconRef("open")]);
    const m = blocks[0];
    if (m.tag !== "Matrix") throw new Error("not a matrix");
    expect(m._1).toEqual([Str("Risk")]);
    expect(m._2.map((h) => [h.matrixHeaderName, h.matrixHeaderColumns])).toEqual([
      [[Str("")], [[Str("Rank")]]],
      [[Str("Done")], [[Icon("no"), Space, Highlight(green, [Str("No")])], [Icon("yes"), Space, Highlight(red, [Str("Yes")])]]],
    ]);
    expect(m._3.length).toBe(3);
    const rowOf = (i: number) => {
      const t = m._3[i];
      return [t.rootLabel.map(([a, b]) => [a, b]), t.subForest[0].rootLabel.map(([a, b]) => [a, b])];
    };
    expect(rowOf(0)).toEqual([
      [[textAttr("Integer"), [Para([Icon("low"), Space, Highlight(green, [Str("1")])])]]],
      [[textAttr("Enum"), [Para([Str("Closed")])]], [textAttr("Text"), [Para([])]]],
    ]);
    expect(rowOf(2)[1]).toEqual([
      [textAttr("Text"), [Para([])]],
      [textAttr("Enum"), [Para([Icon("open"), Space, Highlight(yellow, [Str("Open")])])]],
    ]);
  });

  it("inserts diagrams", () => {
    const [blocks, images, errs] = report([ReportDiagram], ids.children);
    expect(errs).toEqual([]);
    expect(images).toEqual([DiagramRef(ids.children)]);
    const p = blocks[0];
    if (p.tag !== "Picture") throw new Error("not a picture");
    expect(p._0).toEqual(textAttr("DiagramBox"));
    expect(p._1).toEqual([Str("Children")]);
    expect(p._2).toBe("Children");
    expect(p._4).toBe(ids.children);
    // 200 x 400 pixels of boxes (plus line widths), at 72/96 points per pixel.
    expect(p._3[0]).toBeGreaterThanOrEqual(150);
    expect(p._3[0]).toBeLessThan(160);
    expect(p._3[1]).toBeGreaterThanOrEqual(300);
    expect(p._3[1]).toBeLessThan(310);
    const [b2, , e2] = report([ReportDiagram], ids.a);
    expect(b2).toEqual([Para([Str("Entity A is not a diagram.")])]);
    expect(e2).toEqual([[ids.a, "Entity A is not a diagram."]]);
  });

  it("reports deleted references as model errors", () => {
    const gone = U.fromWords(1, 1, 1, 1);
    for (const [frag, msg] of [
      [ReportMatrix(Just(gone)), "Report uses a deleted matrix."],
      [ReportLookup(Just(gone)), "The report uses a deleted lookup table."],
      [SubReport(Just(gone), SortOrder([]), []), "Subreport uses a deleted query."],
    ] as [ReportFragment<TV>, string][]) {
      const r = runModelEdit(cls, identity<TV>(), st2, (c) =>
        runReport(cls, c, Report<TV>(Name("R"), "", Nothing, Nothing, [frag]), ids.top));
      expect(r.tag === "Left" && show_ModelError(r.value)).toContain(msg);
    }
  });

  it("renders a whole report as HTML", () => {
    const [blocks] = report([
      ReportHeading(1, "Report on", Just([nameField, ""] as const)),
      ReportMatrix(Just(matrixIds.matrix)),
      ReportLookup(Just(ids.table)),
    ], ids.data);
    const html = H.renderHtml(mkHtmlDocument((r) => (r.tag === "IconRef" ? r._0 + ".png" : "x.svg"), H.mempty_Html, blocks));
    expect(html).toContain(`<h1 id="${U.toText(ids.data)}">Report on Data</h1>`);
    expect(html).toContain("<td rowspan=\"2\" class=\"Text\"><p>P1</p></td>");
    expect(html).toContain("<a href=\"http://example.com/A\">A</a>");
    expect(html).toContain("<img src=\"open.png\" alt=\"icon\" height=\"16\" width=\"16\"> <span style=\"background-color:#ffff00;color:black\">Open</span>");
  });
});

describe("fragmentDescription", () => {
  it("summarises fragments", () => {
    const d = (f: ReportFragment<TV>, n = 100) => fragmentDescription(cls, n, model, f);
    expect(d(ReportLiteral("line one\nline two"))).toBe("\"line one\"");
    expect(d(ReportField(fRank))).toBe("<Rank>");
    expect(d(ReportField(U.fromWords(5, 5, 5, 5)))).toBe("<-deleted->");
    expect(d(ReportFieldList([nameField, fStatus]))).toBe("Fields: Name, Status");
    expect(d(ReportHeading(2, "Head", Just([fRank, "tail"] as const)))).toBe("Heading 2: Head <Rank> tail");
    expect(d(ReportDiagram)).toBe("Diagram");
    expect(d(ReportMatrix(Just(matrixIds.matrix)))).toBe("Matrix: Things");
    expect(d(ReportMatrix(Nothing))).toBe("Matrix: <Not set>");
    expect(d(ReportLookup(Just(U.fromWords(5, 5, 5, 5))))).toBe("Lookup Table: <Deleted>");
    expect(d(SubReport(Just(ids.children), SortOrder([[fRank, "Descending"]]), [ReportField(fRank)])))
      .toBe("Section: Children ordered by Rank▼.  <Rank>");
    expect(d(ReportLiteral("abcdefghij"), 5)).toBe("\"abc…");
    expect(d(ReportLiteral("abc"), 5)).toBe("\"abc\"");
  });
});

