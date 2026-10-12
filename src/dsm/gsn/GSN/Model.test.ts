import { describe, expect, it } from "vitest";
import type { AppearanceClass } from "@/hades/src/App/Appearance";
import type { Editable, EntityWrapper, HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { HasEvidence } from "@/hades/evidence/Evidence/Model";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { HasMatrices } from "@/hades/src/Model/Matrices/Base";
import type { GsnDiagramType, HasGsn } from "@/dsm/gsn/GSN/Model";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import * as U from "@/lib/Data/UUID";
import * as Cairo from "@/lib/GI/Cairo";
import * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import {
  identity, lens, over, preview, prism, review, set, toListOf, view, type Lens, type Prism,
} from "@/lib/Control/Lens";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type Diagram, BoundBox, BoxShapeClass_Diamond, BoxShapeClass_Ellipse, BoxShapeClass_Oval,
  BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, Connected, DeltaCtx, LineShape, NoBox, Point,
  Rectangle, Unconnected, diagramContents, diagramFromList, diagramToList, mkDiagramState,
} from "@/hades/src/Hades/Abstract";
import { hadesConfig, layoutText } from "@/hades/src/Hades/GI/BasicShapes";
import {
  type PackageAppearance, JSON_PackageAppearance, coerceDiagramAppearance, mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import {
  Arrow, Avatar_Element, ElemArrow, ElemBox, GenericContext, JSON_Element, elementMapAvatars,
  mempty_AppearanceDef,
} from "@/hades/src/App/GenericDiagram";
import {
  Evidence, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace, Trace, evidenceName,
  traceArrowDash, traceArrowHead, traceArrowRelations, traceName,
} from "@/hades/evidence/Evidence/Model";
import { type ModelScriptAct, DiagramEntity, stepScript } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditState, type ModelError, type ModelId, JSON_Model, JSON_Package, Name,
  Package, current, descriptionField, emptyModel, evalModelEdit, goToEntity, mkEntity, mkPackage,
  modelStartState, nameField, nameText, packageName, runModelEdit, show_ModelError, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import {
  append_RefTypeTable, arrowRelations, mempty_RefTypeTable, refTypeTableCoerce,
} from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel } from "@/hades/src/Model/Reflection/Reflective";
import { ExtBool, ExtText, Variant, variantCoerce } from "@/hades/src/Model/Reflection/Values";
import {
  cardinalityField, developedField, gsnDiagramVariant, instantiatedField,
} from "./FieldNames";
import {
  type GsnClass, type GsnElement, type GsnItem, type GsnNode, Assumption, Context, ContextArrow,
  DiagramTypeClass_GsnDiagramType, EvidenceBox, Goal, GoalBox, GsnArrow, GsnDiagramItem, GsnEdge,
  GsnEdgeItem, GsnNodeItem, GsnOption, JSON_ArrowType, JSON_BoxType, JSON_GsnEdge, JSON_GsnEdgeType,
  JSON_GsnItem, JSON_GsnNode, Justification, Reflective_GsnItem, Solution, Strategy, SupportArrow,
  TraceArrow, _GsnDiagramItem, _GsnEdgeItem, _GsnNodeItem, boxTypeValues, createAssumption, createContext,
  createGoal, createGsnOption, createJustification, createSolution, createStrategy, dottedNumbers,
  drawGsnBoxRaw, eq_GsnItem, gsnActivation, gsnAddEntityMenu, gsnArrowCanConnect, gsnArrowDecorations,
  gsnAvatarType, gsnBoxDecoration, gsnDeveloped, gsnDiagramEntityTypes, gsnDiagramWrapper, gsnEdgeType,
  gsnEdgeVariant, gsnEntityMenu, gsnInstantiated, gsnIsDiagram, gsnItemName, gsnNodeName, gsnNodeType,
  gsnNodeVariant, gsnStockItem, gsnToolbar, show_ArrowType, show_BoxType, show_GsnEdge, show_GsnNode,
} from "./Model";

// ---------------------------------------------------------------------------------------------
// A model type like the DSM's SafetyModel: GSN items, packages, evidence and traces. Other entity
// types (bow ties, matrices, reports, ...) are kept as raw JSON so that the example files load.

type PM = PackageAppearance<TV>;
type TV =
  | { readonly tag: "GsnItem"; readonly _0: GsnItem<TV> }
  | { readonly tag: "Package"; readonly _0: Package<TV, PM> }
  | { readonly tag: "EvidenceItem"; readonly _0: Evidence }
  | { readonly tag: "TraceItem"; readonly _0: Trace }
  | { readonly tag: "Other"; readonly _0: J.JSONObject };

const _GsnItem: Prism<TV, GsnItem<TV>> = prism((i: GsnItem<TV>): TV => ({ tag: "GsnItem", _0: i }),
  (v: TV) => (v.tag === "GsnItem" ? Right(v._0) : Left(v)));
const _Pkg: Prism<TV, Package<TV, PM>> = prism((p: Package<TV, PM>): TV => ({ tag: "Package", _0: p }),
  (v: TV) => (v.tag === "Package" ? Right(v._0) : Left(v)));
const _Ev: Prism<TV, Evidence> = prism((e: Evidence): TV => ({ tag: "EvidenceItem", _0: e }),
  (v: TV) => (v.tag === "EvidenceItem" ? Right(v._0) : Left(v)));
const _Tr: Prism<TV, Trace> = prism((t: Trace): TV => ({ tag: "TraceItem", _0: t }),
  (v: TV) => (v.tag === "TraceItem" ? Right(v._0) : Left(v)));
/** A prism that never matches (matrices, reports, lookup tables and queries are "Other"). */
const never = <A>(): Prism<TV, A> => prism((_a: A): TV => ({ tag: "Other", _0: {} }), (v: TV) => Left(v));

const otherName = (o: J.JSONObject): Name => Name(typeof o.name === "string" ? o.name : "");
const tvName: Lens<TV, Name> = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "GsnItem": return view(gsnItemName<TV>(), v._0);
      case "Package": return view(packageName<TV, PM>(), v._0);
      case "EvidenceItem": return view(evidenceName, v._0);
      case "TraceItem": return view(traceName, v._0);
      case "Other": return otherName(v._0);
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "GsnItem": return { tag: "GsnItem", _0: set(gsnItemName<TV>(), n, v._0) };
      case "Package": return { tag: "Package", _0: set(packageName<TV, PM>(), n, v._0) };
      case "EvidenceItem": return { tag: "EvidenceItem", _0: Evidence(n) };
      case "TraceItem": return { tag: "TraceItem", _0: Trace(n) };
      case "Other": return { tag: "Other", _0: { ...v._0, name: n._0 } };
    }
  },
);

let gsnRefl: ReturnType<typeof Reflective_GsnItem<TV>> | null = null;
const gsn = () => (gsnRefl ??= Reflective_GsnItem(cls));
let gsnJ: J.JSONCodec<GsnItem<TV>> | null = null;
const gsnCodec = () => (gsnJ ??= JSON_GsnItem(cls));

/**
 * The dictionary, typed without `HasReports` (whose module may not be ported yet; while it is
 * missing `GsnClass` is `any`), then used as the `GsnClass<TV>`.
 */
type ClsT = AppearanceClass<GsnDiagramType<TV>, TV> & Editable<HadesRender, TV> & HasDiagrams<HadesRender, TV> &
  HasEvidence<TV> & HasGsn<TV> & HasLookups<TV> & HasMatrices<TV> & { readonly _Report: Prism<TV, unknown> };
const clsT: ClsT = {
  reflectiveName: (v) => {
    switch (v.tag) {
      case "GsnItem": return variantCoerce(gsn().reflectiveName(v._0));
      case "Package": return "Package";
      case "EvidenceItem": return Reflective_Evidence.reflectiveName(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveName(v._0);
      case "Other": return typeof v._0.type === "string" ? v._0.type : "Other";
    }
  },
  variantUserLabel: defaultVariantUserLabel,
  get reflectiveDefaults(): TV[] {
    return [
      ...gsn().reflectiveDefaults.map((i): TV => ({ tag: "GsnItem", _0: i })),
      { tag: "Package", _0: Package(Name(""), M.empty()) },
      { tag: "EvidenceItem", _0: Evidence(Name("")) },
      { tag: "TraceItem", _0: Trace(Name("")) },
    ];
  },
  reflectiveBuiltIn: (v) => (v.tag === "GsnItem" ? gsn().reflectiveBuiltIn(v._0) : [nameField]),
  reflectiveGet: (v) => (v.tag === "GsnItem" ? gsn().reflectiveGet(v._0) : M.empty()),
  reflectiveSet: (st, v) => (v.tag === "GsnItem" ? { tag: "GsnItem", _0: gsn().reflectiveSet(st, v._0) } : v),
  get reflectiveBuiltInRefs() {
    return append_RefTypeTable(refTypeTableCoerce(gsn().reflectiveBuiltInRefs),
      append_RefTypeTable(refTypeTableCoerce(Reflective_Evidence.reflectiveBuiltInRefs),
        refTypeTableCoerce(Reflective_Trace.reflectiveBuiltInRefs)));
  },
  get reflectiveArrows() {
    return M.union(M.mapKeys(variantCoerce, gsn().reflectiveArrows), M.mapKeys(variantCoerce, Reflective_Trace.reflectiveArrows));
  },
  name: tvName,
  _Package: _Pkg,
  entityCanHaveChild: (p) => p.tag === "Package",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: TV): J.Value => {
      switch (v.tag) {
        case "GsnItem": return gsnCodec().toJSON(v._0);
        case "Package": return JSON_Package(cls).toJSON(v._0);
        case "EvidenceItem": return JSON_Evidence.toJSON(v._0);
        case "TraceItem": return JSON_Trace.toJSON(v._0);
        case "Other": return v._0;
      }
    },
    J.alt<TV>(
      (v) => ({ tag: "GsnItem", _0: gsnCodec().parseJSON(v) }),
      (v) => ({ tag: "Package", _0: JSON_Package(cls).parseJSON(v) }),
      (v) => ({ tag: "EvidenceItem", _0: JSON_Evidence.parseJSON(v) }),
      (v) => ({ tag: "TraceItem", _0: JSON_Trace.parseJSON(v) }),
      (v) => ({ tag: "Other", _0: J.withObject("Other", (o) => o, v) }),
    ),
  ),
  packageMetaJ: JSON_PackageAppearance,
  packageMetaMempty: M.empty(),
  packageMetaAppend: (a, b) => M.union(a, b),
  getDiagramAppearance: (pm: PM) =>
    coerceDiagramAppearance(M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm)),
  // eslint-disable-next-line require-yield
  editableActivation: () => function* () {
    return Nothing;
  },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
  isDiagram: (v) => v.tag === "GsnItem" && gsnIsDiagram(cls, v._0),
  getDiagramWrapper: (ctx, e) => (e._entityContents.tag === "GsnItem"
    ? withSubtype(ctx, _GsnItem, (c) => gsnDiagramWrapper(cls, c, e))
    : Nothing),
  diagramEntityTypes: gsnDiagramEntityTypes<TV>(),
  diagramMapAvatars: (f, ent) => {
    const c = ent._entityContents;
    if (c.tag === "GsnItem" && c._0.tag === "GsnDiagramItem") {
      const d = c._0._0;
      const newD = { ...d, _diagramEntityContents: over(diagramContents<GsnElement<TV>>(), (m) => M.map((x: GsnElement<TV>) => elementMapAvatars(f, x), m), d._diagramEntityContents) };
      return { ...ent, _entityContents: { tag: "GsnItem", _0: GsnDiagramItem<TV>(newD) } };
    }
    return ent;
  },
  _Evidence: _Ev,
  _Trace: _Tr,
  _Gsn: _GsnItem,
  _LookupTable: never(),
  _Matrix: never(),
  _Report: never(),
  _QueryDiagram: never(),
  queryAvatars: () => [],
};
const cls: GsnClass<TV> = clsT as GsnClass<TV>;

const dtc = DiagramTypeClass_GsnDiagramType<TV>(cls);
const ecls = Avatar_Element<GsnDiagramType<TV>, TV>(dtc);

// ---------------------------------------------------------------------------------------------
// Example files

const examplesDir = path.resolve(__dirname, "../../share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);
const gsnTypes = ["Goal", "Strategy", "Solution", "Context", "Assumption", "Justification", "Option", "Support", "GSN Diagram"];
/** The GSN entity contents in the example models. */
const exampleGsn: [string, any][] = examples.flatMap(([f, m]) =>
  (m.modelContents as any[])
    .filter((e) => gsnTypes.includes(e.contents?.type))
    .map((e): [string, any] => [f + ": " + e.contents.type + " " + e.contents.name, e.contents]));

function loadExample(f: string): Model<TV> {
  const m = examples.find(([n]) => n === f);
  if (m === undefined) throw new Error("missing " + f);
  return JSON_Model<TV>(cls).parseJSON(m[1]);
}

// ---------------------------------------------------------------------------------------------
// Helpers for running edits and scripts

function edit<A>(st: ModelEditState<TV>, act: (c: any) => A, prsm: Prism<TV, any> = identity<TV>()): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, prsm, st, act);
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

const entity = (st: ModelEditState<TV>, uuid: ModelId): Entity<TV> => {
  const e = M.lookup(uuid, st.stateModel.modelContents);
  if (e.tag === "Nothing") throw new Error("missing");
  return e.value;
};
const childNames = (st: ModelEditState<TV>, uuid: ModelId): string[] => M.keys(entity(st, uuid)._entityChildren).map((n) => n._0);

/** Run a script to completion, answering a properties dialog with "OK" and no changes. */
function interpret<W, A>(
  st0: ModelEditState<TV>,
  prsm: Prism<TV, W>,
  script: ModelScriptAct<any, TV, W, A>,
): Either<ModelError, [A, ModelEditState<TV>, string[]]> {
  let st = st0;
  let act = script;
  const log: string[] = [];
  for (;;) {
    const r = runModelEdit(cls, prsm, st, (c) => stepScript(c, act));
    if (r.tag === "Left") return Left(r.value);
    const [upd, newState] = r.value;
    const step = upd.updateValue;
    if (step.tag === "Pure") return Right([step._0, newState, log]);
    const instr = step._0;
    log.push(instr.tag);
    st = newState;
    act = step._1(instr.tag === "ScriptProperties" ? Just([entity(newState, instr._0), M.empty()]) : null);
  }
}

/** Run a generator that must not yield (a Delta or script that performs no instructions). */
function runPure<A>(g: Generator<any, A, any>): A {
  const r = g.next();
  if (!r.done) throw new Error("Unexpected instruction: " + JSON.stringify(r.value?.tag));
  return r.value;
}

function setup(pkgName = "Goal 1.2: Safety"): { st: ModelEditState<TV>; pkg: ModelId } {
  const [pkg, st] = edit(modelStartState<TV>(newGenerator(), emptyModel<TV>(cls, "Test")), (c) => mkPackage(c, Name(pkgName)));
  return { st, pkg };
}

const node = (n: GsnNode): GsnItem<TV> => GsnNodeItem<TV>(n);

// ---------------------------------------------------------------------------------------------

describe("dottedNumbers", () => {
  it.each([
    ["G1.2.3", "1.2.3"],
    ["Goal 1: Safety Argument", "1"],
    ["S3.1", "3.1"],
    ["no numbers", ""],
    ["", ""],
    ["v1.2 and 3.4", "3.4"],
    ["Sn2.1.", "2.1"],
    ["G1. text 2.3.", "2.3"],
    [". 1", ""], // A segment of dots only stops the search.
    ["1 . 2", "1"],
    ["x..5..y", "5"],
    ["٣ Arabic-Indic digits are not ASCII", ""],
  ])("%j -> %j", (input, out) => {
    expect(dottedNumbers(input)).toBe(out);
  });
});

describe("creating nodes", () => {
  it("names new nodes after the dotted number of the current entity", () => {
    const { st, pkg } = setup();
    const creators: [(c: any) => GsnNode, string, GsnNode["tag"]][] = [
      [createGoal, "G1.2.", "Goal"], [createStrategy, "S1.2.", "Strategy"],
      [createSolution, "Sn1.2.", "Solution"], [createContext, "C1.2.", "Context"],
      [createAssumption, "A1.2.", "Assumption"], [createJustification, "J1.2.", "Justification"],
      [createGsnOption, "Opt1.2.", "GsnOption"],
    ];
    for (const [f, nm, tag] of creators) {
      const [n] = edit(st, (c) => {
        goToEntity(c, pkg);
        return f(c);
      });
      expect(n.tag).toBe(tag);
      expect(n._gsnNodeName._0).toBe(nm);
      expect(n._gsnNodeText).toBe("");
      expect(n._gsnInstantiated).toBe(true);
      expect(preview(gsnDeveloped, n)).toEqual(tag === "Goal" || tag === "Strategy" ? Just(true) : Nothing);
    }
    const { st: st2, pkg: pkg2 } = setup("Top");
    const [g] = edit(st2, (c) => {
      goToEntity(c, pkg2);
      return createGoal(c);
    });
    expect(g._gsnNodeName._0).toBe("G");
  });
});

describe("JSON", () => {
  it("encodes nodes as aeson does", () => {
    expect(JSON_GsnNode.toJSON(Goal(Name("G1"), "Top", false, true)))
      .toEqual({ type: "Goal", name: "G1", text: "Top", developed: false, instantiated: true });
    expect(JSON_GsnNode.toJSON(GsnOption(Name("O"), "", false)))
      .toEqual({ type: "Option", name: "O", text: "", instantiated: false });
    expect(JSON_GsnNode.parseJSON({ type: "Strategy", name: "S", text: "t" })).toEqual(Strategy(Name("S"), "t", true, true));
    expect(JSON_GsnNode.parseJSON({ type: "Justification", name: "J", text: "t", instantiated: false }))
      .toEqual(Justification(Name("J"), "t", false));
    expect(J.parseEither((v) => JSON_GsnNode.parseJSON(v), { type: "Gaol", name: "G", text: "" }))
      .toEqual(Left("Unknown GSN node type: Gaol"));
  });

  it("encodes edges, edge types, box types and arrow types as aeson does", () => {
    expect(JSON_GsnEdge.toJSON(GsnEdge("SupportArrow", Name("Support1"), "CardinalityMany1")))
      .toEqual({ type: "Support", name: "Support1", card: "1-n" });
    expect(JSON_GsnEdge.parseJSON({ type: "Context", name: "C" })).toEqual(GsnEdge("ContextArrow", Name("C"), "CardinalityOne"));
    expect(J.parseEither((v) => JSON_GsnEdgeType.parseJSON(v), "Trace")).toEqual(Left('Not a GSN Edge Type: "Trace"'));
    expect(boxTypeValues.map((b) => JSON_BoxType.toJSON(b)))
      .toEqual(["Goal", "Strategy", "Solution", "Context", "Assumption", "Justification", "Option", "Evidence"]);
    for (const b of boxTypeValues) expect(JSON_BoxType.parseJSON(JSON_BoxType.toJSON(b))).toBe(b);
    expect(J.parseEither((v) => JSON_BoxType.parseJSON(v), "Box")).toEqual(Left('Expected GSN box type. Got "Box"'));
    expect([GsnArrow("ContextArrow"), GsnArrow("SupportArrow"), TraceArrow].map((a) => JSON_ArrowType.toJSON(a)))
      .toEqual(["Context", "Support", "Trace"]);
    expect(JSON_ArrowType.parseJSON("Trace")).toEqual(TraceArrow);
    expect(JSON_ArrowType.parseJSON("Support")).toEqual(GsnArrow("SupportArrow"));
    expect(J.parseEither((v) => JSON_ArrowType.parseJSON(v), "Goal")).toEqual(Left('Not a GSN Arrow type: "Goal"'));
  });

  it("tells context nodes from context arrows", () => {
    const codec = JSON_GsnItem(cls);
    expect(codec.parseJSON({ type: "Context", name: "C1", text: "x", instantiated: true }))
      .toEqual(node(Context(Name("C1"), "x", true)));
    expect(codec.parseJSON({ type: "Context", name: "Context1", card: "One" }))
      .toEqual(GsnEdgeItem<TV>(GsnEdge("ContextArrow", Name("Context1"), "CardinalityOne")));
    expect(() => codec.parseJSON({ type: "package", name: "P" })).toThrow();
  });

  it("finds the GSN entities in the examples", () => {
    expect(exampleGsn.length).toBeGreaterThan(60);
    expect(new Set(exampleGsn.map(([, js]) => js.type))).toEqual(new Set(gsnTypes.filter((t) => t !== "Option")));
  });

  it.each(exampleGsn)("round trips %s", (_name, js) => {
    const codec = JSON_GsnItem(cls);
    const item = codec.parseJSON(js);
    expect(item.tag).toBe(js.type === "GSN Diagram" ? "GsnDiagramItem" : js.card !== undefined ? "GsnEdgeItem" : "GsnNodeItem");
    expect(codec.toJSON(item)).toEqual(js);
  });

  it.each(examples.map(([f]) => [f]))("loads the whole model %s and writes the GSN parts back unchanged", (f) => {
    const js = examples.find(([n]) => n === f)![1];
    const model = loadExample(f);
    const out = JSON_Model<TV>(cls).toJSON(model) as any;
    const gsnOf = (m: any) => (m.modelContents as any[]).filter((e) => gsnTypes.includes(e.contents?.type))
      .sort((a, b) => (a.identity < b.identity ? -1 : 1));
    expect(gsnOf(out)).toEqual(gsnOf(js));
  });
});

describe("Reflective", () => {
  const refl = Reflective_GsnItem(cls);
  const goal = node(Goal(Name("G1"), "The system is safe", false, true));
  const sol = node(Solution(Name("Sn1"), "Tests", false));
  const edge = GsnEdgeItem<TV>(GsnEdge("SupportArrow", Name("Support1"), "CardinalityOpt"));
  const diag = GsnDiagramItem<TV>(DiagramEntity(Name("Argument"), diagramFromList(ecls, []), mempty_DiagramAppearance));

  it("names the variants", () => {
    expect([goal, sol, edge, diag].map((i) => refl.reflectiveName(i)))
      .toEqual(["Goal", "Solution", "Support Arrow", "GSN Diagram"]);
    expect(refl.reflectiveDefaults.map((i) => refl.reflectiveName(i))).toEqual([
      "Goal", "Strategy", "Solution", "Context", "Assumption", "Justification", "Option",
      "Context Arrow", "Support Arrow", "GSN Diagram",
    ]);
    expect(refl.reflectiveDefaults[0]).toEqual(node(Goal(Name(""), "", true, true)));
  });

  it("gets and sets the built-in fields", () => {
    expect(refl.reflectiveBuiltIn(goal)).toEqual([nameField, descriptionField, instantiatedField, developedField]);
    expect(refl.reflectiveBuiltIn(sol)).toEqual([nameField, descriptionField, instantiatedField]);
    expect(refl.reflectiveBuiltIn(edge)).toEqual([nameField, cardinalityField]);
    expect(refl.reflectiveBuiltIn(diag)).toEqual([nameField]);
    expect(refl.reflectiveGet(goal)).toEqual(M.fromList([
      [nameField, ExtText("G1")], [descriptionField, ExtText("The system is safe")],
      [instantiatedField, ExtBool(true)], [developedField, ExtBool(false)],
    ]));
    expect(refl.reflectiveGet(sol)).toEqual(M.fromList([
      [nameField, ExtText("Sn1")], [descriptionField, ExtText("Tests")], [instantiatedField, ExtBool(false)],
    ]));
    expect(refl.reflectiveGet(edge)).toEqual(M.fromList([[nameField, ExtText("Support1")], [cardinalityField, ExtText("Optional")]]));
    expect(refl.reflectiveGet(diag)).toEqual(M.singleton(nameField, ExtText("Argument")));

    // Node names are not stripped; edge and diagram names are.
    const st1 = { state: M.fromList([[nameField, ExtText(" G2 ")], [developedField, ExtBool(true)], ["x", ExtText("y")]]) };
    expect(refl.reflectiveSet(st1, goal)).toEqual(node(Goal(Name(" G2 "), "The system is safe", true, true)));
    expect(M.keys(st1.state)).toEqual(["x"]);
    const st2 = { state: M.fromList([[nameField, ExtText(" S "), ], [cardinalityField, ExtText("0-n")]]) };
    expect(refl.reflectiveSet(st2, edge)).toEqual(GsnEdgeItem<TV>(GsnEdge("SupportArrow", Name("S"), "CardinalityMany")));
    const st3 = { state: M.fromList([[cardinalityField, ExtText("lots")]]) };
    expect(refl.reflectiveSet(st3, edge)).toEqual(GsnEdgeItem<TV>(GsnEdge("SupportArrow", Name("Support1"), "CardinalityOne")));
    const st4 = { state: M.fromList([[nameField, ExtText(" New ")], [developedField, ExtBool(false)]]) };
    const sol2 = refl.reflectiveSet(st4, sol);
    expect(sol2).toEqual(node(Solution(Name(" New "), "Tests", false)));
    expect(M.keys(st4.state)).toEqual([developedField]); // Solutions have no "developed" field.
    const d2 = refl.reflectiveSet({ state: M.singleton(nameField, ExtText("  Renamed ")) }, diag);
    expect(d2.tag === "GsnDiagramItem" && d2._0._diagramEntityName._0).toBe("Renamed");
  });

  it("declares the arrow relations", () => {
    expect(refl.reflectiveBuiltInRefs).toEqual(append_RefTypeTable(
      arrowRelations("Context Arrow", ["Goal", "Strategy", "Option"], ["Context", "Assumption", "Justification", "Option"]),
      append_RefTypeTable(
        arrowRelations("Support Arrow", ["Goal", "Strategy", "Option"], ["Goal", "Strategy", "Solution", "Option"]),
        traceArrowRelations(["Solution"], []))));
    expect(refl.reflectiveArrows).toEqual(M.fromList([
      ["Context Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
      ["Support Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
    ]));
    expect(refl.reflectiveBuiltInRefs).not.toEqual(mempty_RefTypeTable);
  });

  it("has a hand-written Eq", () => {
    expect(eq_GsnItem(goal, node(Goal(Name("G1"), "The system is safe", false, true)))).toBe(true);
    expect(eq_GsnItem(goal, sol)).toBe(false);
    expect(eq_GsnItem(diag, diag)).toBe(true);
  });
});

describe("nodes, edges and items", () => {
  it("maps nodes to box types and variants", () => {
    const nodes = [Goal(Name("a"), "", true, true), Strategy(Name("a"), "", true, true), Solution(Name("a"), "", true),
      Context(Name("a"), "", true), Assumption(Name("a"), "", true), Justification(Name("a"), "", true), GsnOption(Name("a"), "", true)];
    expect(nodes.map(gsnNodeType)).toEqual(["GoalBox", "StrategyBox", "SolutionBox", "ContextBox", "AssumptionBox", "JustificationBox", "OptionBox"]);
    expect(nodes.map((n) => gsnNodeVariant(n))).toEqual(["Goal", "Strategy", "Solution", "Context", "Assumption", "Justification", "Option"]);
    expect([ContextArrow, SupportArrow].map((t) => gsnEdgeVariant(t))).toEqual(["Context Arrow", "Support Arrow"]);
    expect([GsnArrow("ContextArrow"), GsnArrow("SupportArrow"), TraceArrow].map(show_ArrowType))
      .toEqual(["Context Arrow", "Support Arrow", "Trace"]);
    expect(show_BoxType(GoalBox)).toBe("GoalBox");
  });

  it("shows nodes and edges as derived Show does", () => {
    expect(show_GsnNode(Goal(Name("G1"), "A \"goal\"", true, false)))
      .toBe('Goal {_gsnNodeName = Name "G1", _gsnNodeText = "A \\"goal\\"", _gsnDeveloped = True, _gsnInstantiated = False}');
    expect(show_GsnNode(GsnOption(Name("O"), "", true)))
      .toBe('GsnOption {_gsnNodeName = Name "O", _gsnNodeText = "", _gsnInstantiated = True}');
    expect(show_GsnEdge(GsnEdge("ContextArrow", Name("C"), "CardinalityMany")))
      .toBe('GsnEdge {gsnEdgeType = ContextArrow, _gsnEdgeName = Name "C", _gsnEdgeCard = 0-n}');
  });

  it("has lenses and prisms", () => {
    const g = Goal(Name("G"), "t", true, true);
    expect(view(gsnNodeName, g)).toEqual(Name("G"));
    expect(set(gsnInstantiated, false, g)).toEqual(Goal(Name("G"), "t", true, false));
    expect(set(gsnDeveloped, false, g)).toEqual(Goal(Name("G"), "t", false, true));
    const s = Solution(Name("S"), "t", true);
    expect(set(gsnDeveloped, false, s)).toEqual(s);
    expect(toListOf(gsnDeveloped, s)).toEqual([]);
    const e = GsnEdge("SupportArrow", Name("E"), "CardinalityOne");
    expect(gsnEdgeType(e)).toBe("SupportArrow");
    const items: GsnItem<TV>[] = [node(g), GsnEdgeItem<TV>(e),
      GsnDiagramItem<TV>(DiagramEntity(Name("D"), diagramFromList(ecls, []), mempty_DiagramAppearance))];
    expect(items.map((i) => view(gsnItemName<TV>(), i)._0)).toEqual(["G", "E", "D"]);
    expect(items.map((i) => view(gsnItemName<TV>(), set(gsnItemName<TV>(), Name("X"), i))._0)).toEqual(["X", "X", "X"]);
    expect(items.map((i) => [preview(_GsnNodeItem<TV>(), i).tag, preview(_GsnEdgeItem<TV>(), i).tag,
      preview(_GsnDiagramItem<TV>(), i).tag])).toEqual([["Just", "Nothing", "Nothing"],
      ["Nothing", "Just", "Nothing"], ["Nothing", "Nothing", "Just"]]);
    expect(items.map((i) => gsnIsDiagram(cls, i))).toEqual([false, false, true]);
    expect(review(_GsnNodeItem<TV>(), g)).toEqual(node(g));
  });

  it("chooses the avatar for an entity", () => {
    const t = (v: TV) => gsnAvatarType(cls, _GsnItem, v);
    expect(t({ tag: "GsnItem", _0: node(Strategy(Name("S"), "", true, true)) })).toEqual({ tag: "SimpleBox", _0: "StrategyBox" });
    expect(t({ tag: "GsnItem", _0: GsnEdgeItem<TV>(GsnEdge("ContextArrow", Name("C"), "CardinalityOne")) }))
      .toEqual({ tag: "SimpleArrow", _0: GsnArrow("ContextArrow") });
    expect(t({ tag: "GsnItem", _0: GsnDiagramItem<TV>(DiagramEntity(Name("D"), diagramFromList(ecls, []), mempty_DiagramAppearance)) }))
      .toEqual({ tag: "NoAvatar" });
    expect(t({ tag: "EvidenceItem", _0: Evidence(Name("E")) })).toEqual({ tag: "SimpleBox", _0: EvidenceBox });
    expect(t({ tag: "TraceItem", _0: Trace(Name("T")) })).toEqual({ tag: "SimpleArrow", _0: TraceArrow });
    expect(t({ tag: "Package", _0: Package(Name("P"), M.empty()) })).toEqual({ tag: "NoAvatar" });
  });

  it("names the stock icons", () => {
    expect(gsnStockItem(cls, node(Goal(Name("G"), "", true, true)))).toBe("gsn_goal");
    expect(gsnStockItem(cls, node(GsnOption(Name("O"), "", true)))).toBe("gsn_option");
    expect(gsnStockItem(cls, GsnEdgeItem<TV>(GsnEdge("SupportArrow", Name("S"), "CardinalityOne")))).toBe("gsn_support_arrow");
    expect(gsnStockItem(cls, GsnDiagramItem<TV>(DiagramEntity(Name("D"), diagramFromList(ecls, []), mempty_DiagramAppearance))))
      .toBe("gsn_gsn_diagram");
    expect(gsnDiagramEntityTypes()).toEqual(M.singleton("GSN Diagram",
      ["Goal", "Strategy", "Solution", "Context", "Assumption", "Justification", "Evidence"]));
  });
});

describe("the DiagramTypeClass instance", () => {
  it("is cached and inherits the model dictionary", () => {
    expect(DiagramTypeClass_GsnDiagramType(cls)).toBe(dtc);
    expect(dtc._Gsn).toBe(_GsnItem);
    expect(dtc.diagramEntityTypes).toEqual(clsT.diagramEntityTypes);
    expect(dtc.diagramTypeName(undefined as any)).toBe("GSN");
    expect(Avatar_Element(dtc)).toBe(ecls);
    expect(ecls.itemType(undefined as any)).toBe("GSN");
  });

  it("makes boxes of the right shapes", () => {
    const bb = BoundBox(Point(0, 0), Point(100, 50));
    const shapes = boxTypeValues.map((t) => dtc.mkBox("d", "m", t, Nothing, bb).boxShapeClass);
    expect(shapes).toEqual([BoxShapeClass_Rectangle, BoxShapeClass_Parallelogram, BoxShapeClass_Ellipse,
      BoxShapeClass_Oval, BoxShapeClass_Ellipse, BoxShapeClass_Ellipse, BoxShapeClass_Diamond, BoxShapeClass_Rectangle]
      .map((s) => s));
    const b = dtc.mkBox("d", "m", "GoalBox", Just(["a", 0.5] as const), bb);
    expect([b.boxId, b.boxEntity, b.boxType, b._boxPeg]).toEqual(["d", "m", "GoalBox", Just(["a", 0.5])]);
    expect(b.boxShape).toEqual(Rectangle(bb));
  });

  it("describes the arrows", () => {
    const arrows = [GsnArrow("ContextArrow"), GsnArrow("SupportArrow"), TraceArrow];
    expect(arrows.map((a) => dtc.arrowTailRelation(a))).toEqual(["Arrow Tail", "Arrow Tail", "Trace Tail"]);
    expect(arrows.map((a) => dtc.arrowHeadRelation(a))).toEqual(["Arrow Head", "Arrow Head", "Trace Head"]);
    expect(arrows.map((a) => dtc.arrowTailExportRelation(a))).toEqual([Nothing, Nothing, Nothing]);
    expect(arrows.map((a) => dtc.arrowHeadExportRelation(a))).toEqual([Nothing, Nothing, Nothing]);
    expect(arrows.map((a) => dtc.arrowLineDashes(a))).toEqual([[], [], traceArrowDash]);
    const heads = arrows.map((a) => dtc.arrowHeadDraw(Nothing, a));
    expect(heads[0].arrowHeadLength).toBe(10);
    expect(heads[0].arrowHeadWidth).toBeCloseTo(20 * Math.tan(Math.PI / 12), 10);
    expect(heads[1].arrowHeadLength).toBe(10);
    expect(heads[2]).toBe(traceArrowHead);
    const card = (c: any) => Just(GsnEdgeItem<TV>(GsnEdge("SupportArrow", Name("S"), c)));
    expect(dtc.arrowDecorations(card("CardinalityOne"), GsnArrow("SupportArrow"))).toEqual([]);
    expect(dtc.arrowDecorations(card("CardinalityMany"), GsnArrow("SupportArrow")).length).toBe(1);
    expect(dtc.arrowDecorations(Nothing, GsnArrow("SupportArrow"))).toEqual([]);
    expect(dtc.arrowDecorations(Just(node(Goal(Name("G"), "", true, true))), TraceArrow)).toEqual([]);
  });

  it("has no box children or pegs", () => {
    const b = dtc.mkBox("d", "m", "GoalBox", Nothing, NoBox);
    const d = new DeltaCtx(ecls, { state: mkDiagramState(GenericContext("x", mempty_AppearanceDef), 1, diagramFromList(ecls, [])) });
    expect(runPure(dtc.boxChildren(d, b))).toEqual([]);
    expect(runPure(dtc.boxChildConnection(d, b, "c"))(Point(3, 4))).toEqual(Point(3, 4));
    expect(runPure(dtc.boxCanPeg(d, b, Arrow("a", "m", TraceArrow, LineShape([Unconnected(Point(0, 0)), Unconnected(Point(1, 1))], []))))).toEqual(Nothing);
  });
});

describe("arrow connection rules", () => {
  const bb = BoundBox(Point(0, 0), Point(100, 50));
  const types = boxTypeValues;
  const boxes = types.map((t, i) => dtc.mkBox("box" + i, "ent" + i, t, Nothing, bb));
  const diagram: Diagram<GsnElement<TV>> = diagramFromList(ecls, boxes.map((b) => ElemBox(b)));
  const ctx = () => new DeltaCtx(ecls, { state: mkDiagramState(GenericContext("x", mempty_AppearanceDef), 1, diagram) });
  const end = (i: number | null) => (i === null ? Unconnected(Point(0, 0)) : Connected(Point(0, 0), "box" + i, Nothing));
  /** The box types an arrow can connect to, given the box types at its ends. */
  const allowed = (arrowType: any, dir: "ConnectionFrom" | "ConnectionTo", from: number | null, to: number | null): string[] => {
    const arrow = Arrow<any, TV>("arr", "e", arrowType, LineShape([end(from), end(to)], []));
    return boxes.filter((b) => runPure(gsnArrowCanConnect(cls, ctx(), dir, arrow, b))).map((b) => b.boxType);
  };
  const ix = (t: string) => types.indexOf(t as any);

  it("context arrows go from goals, strategies and options to contexts, assumptions, justifications and options", () => {
    expect(allowed(GsnArrow("ContextArrow"), "ConnectionFrom", null, null)).toEqual(["GoalBox", "StrategyBox", "OptionBox"]);
    expect(allowed(GsnArrow("ContextArrow"), "ConnectionTo", null, null))
      .toEqual(["ContextBox", "AssumptionBox", "JustificationBox", "OptionBox"]);
  });

  it("support arrows depend on what the other end is connected to", () => {
    const sup = GsnArrow("SupportArrow");
    expect(allowed(sup, "ConnectionFrom", null, null)).toEqual(["GoalBox", "StrategyBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionFrom", null, ix("GoalBox"))).toEqual(["GoalBox", "StrategyBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionFrom", null, ix("StrategyBox"))).toEqual(["GoalBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionFrom", null, ix("SolutionBox"))).toEqual(["GoalBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionFrom", null, ix("OptionBox"))).toEqual(["GoalBox", "StrategyBox"]);
    expect(allowed(sup, "ConnectionFrom", null, ix("ContextBox"))).toEqual([]);
    expect(allowed(sup, "ConnectionTo", null, null)).toEqual(["GoalBox", "StrategyBox", "SolutionBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionTo", ix("GoalBox"), null)).toEqual(["GoalBox", "StrategyBox", "SolutionBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionTo", ix("StrategyBox"), null)).toEqual(["GoalBox", "OptionBox"]);
    expect(allowed(sup, "ConnectionTo", ix("OptionBox"), null)).toEqual(["GoalBox", "StrategyBox", "SolutionBox"]);
    expect(allowed(sup, "ConnectionTo", ix("SolutionBox"), null)).toEqual([]);
    // A connection to something that is not on the diagram counts as no box type.
    const arrow = Arrow<any, TV>("arr", "e", sup, LineShape([end(null), Connected(Point(0, 0), "gone", Nothing)], []));
    expect(runPure(gsnArrowCanConnect(cls, ctx(), "ConnectionFrom", arrow, boxes[ix("StrategyBox")]))).toBe(true);
  });

  it("trace arrows go from solutions to evidence", () => {
    expect(allowed(TraceArrow, "ConnectionFrom", null, null)).toEqual(["SolutionBox"]);
    expect(allowed(TraceArrow, "ConnectionTo", null, null)).toEqual(["EvidenceBox"]);
  });

  it("is the arrowCanConnect method", () => {
    const arrow = Arrow<any, TV>("arr", "e", TraceArrow, LineShape([end(null), end(null)], []));
    expect(runPure(dtc.arrowCanConnect(ctx(), "ConnectionTo", arrow, boxes[ix("EvidenceBox")], Just("child")))).toBe(true);
  });
});

describe("decorations", () => {
  it("marks undeveloped and uninstantiated boxes below the box", () => {
    const bb = BoundBox(Point(0, 0), Point(100, 50));
    expect(gsnBoxDecoration(bb, true, true)).toEqual([]);
    expect(gsnBoxDecoration(NoBox, false, false)).toEqual([]);
    const p1 = Point(40, 60), p2 = Point(50, 50), p3 = Point(60, 60), p4 = Point(50, 70);
    expect(gsnBoxDecoration(bb, false, true)).toEqual([[p1, p2, p3, p4]]);
    expect(gsnBoxDecoration(bb, true, false)).toEqual([[p1, p2, p3]]);
    expect(gsnBoxDecoration(bb, false, false)).toEqual([[p1, p2, p3], [p1, p3, p4]]);
  });

  it("draws cardinalities on edges", () => {
    const d = (c: any) => gsnArrowDecorations(GsnEdge("SupportArrow", Name("S"), c));
    expect(d("CardinalityOne")).toEqual([]);
    expect(d("CardinalityOpt").map((x) => [x.arrowDecPosition, x.arrowDecOffLine.tag])).toEqual([[0.75, "Nothing"]]);
    const many = d("CardinalityMany1");
    expect(many.map((x) => x.arrowDecPosition)).toEqual([0.75]);
    const off = many[0].arrowDecOffLine;
    expect(off.tag === "Just" && off.value[0]).toEqual([32, 22]);
    const style = hadesConfig(Gtk.iconThemeNew());
    const s = new Cairo.SvgSurface(100, 100);
    const env = { style, cr: s.context() };
    many[0].arrowDecOnLine(env);
    if (off.tag === "Just") off.value[1](env);
    d("CardinalityOpt")[0].arrowDecOnLine(env);
    const doc = s.document();
    expect(doc).toMatch(/>1:n<\/text>/);
    expect(doc).toMatch(/fill="rgb\(0, 0, 0\)"/);
    expect(doc).toMatch(/fill="rgb\(255, 255, 255\)"/);
  });
});

describe("drawGsnBoxRaw", () => {
  const style = hadesConfig(Gtk.iconThemeNew());
  const draw = (typ: any, mNode: Maybe<GsnNode>, border: Maybe<Colour> = Nothing): string => {
    const s = new Cairo.SvgSurface(300, 200);
    const bb = BoundBox(Point(10, 10), Point(210, 110));
    const box = dtc.mkBox("d", "m", typ, Nothing, BoundBox(Point(0, 0), Point(1, 1)));
    drawGsnBoxRaw(box.boxShapeClass, typ, mNode, layoutText([], "Body text"), border, box.boxShape, bb)({ style, cr: s.context() });
    return s.document();
  };

  it("draws the outline, the name and the contents", () => {
    const doc = draw("GoalBox", Just(Goal(Name("G1"), "x", true, true)));
    expect(doc).toMatch(/<path d="M10 10 L210 10 L210 110 L10 110 Z"/);
    expect(doc).toMatch(/font-weight="700"[^>]*>G1<\/text>/);
    expect(doc).toMatch(/>Body text<\/text>/);
    expect(doc.indexOf(">G1<")).toBeLessThan(doc.indexOf(">Body text<"));
  });

  it("uses the box type name when there is no node", () => {
    expect(draw("StrategyBox", Nothing)).toMatch(/>Strategy<\/text>/);
    expect(draw("OptionBox", Nothing)).toMatch(/>Option<\/text>/);
  });

  it("puts a letter in the corner of assumptions and justifications", () => {
    expect(draw("AssumptionBox", Just(Assumption(Name("A1"), "", true)))).toMatch(/>A<\/text>/);
    expect(draw("JustificationBox", Just(Justification(Name("J1"), "", true)))).toMatch(/>J<\/text>/);
    expect(draw("SolutionBox", Just(Solution(Name("Sn1"), "", true)))).not.toMatch(/>A<\/text>/);
  });

  it("adds the decoration and border colour", () => {
    const plain = draw("GoalBox", Just(Goal(Name("G1"), "", true, true)));
    const undeveloped = draw("GoalBox", Just(Goal(Name("G1"), "", false, true)));
    expect(undeveloped).toMatch(/<path d="M100 120 L110 110 L120 120 Z"/);
    expect(plain).not.toMatch(/L110 110 L120 120 Z/);
    expect(draw("GoalBox", Nothing, Just(Colour(C.sRGB24(255, 0, 0))))).toMatch(/stroke="rgb\(255, 0, 0\)"/);
    expect(plain).not.toMatch(/stroke="rgb\(255, 0, 0\)"/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("menus, activation and the toolbar", () => {
  it("adds GSN items to a package", () => {
    const { st, pkg } = setup();
    const menu = gsnAddEntityMenu(cls, pkg);
    expect(menu._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Add GSN Diagram", "GSN Items"]]);
    const sub = menu._0[0][1].menuValue;
    if (sub.tag !== "Left") throw new Error("not a submenu");
    expect(sub.value._0.map((g) => g.map((i) => i.menuLabel))).toEqual([
      ["Goal", "Strategy", "Solution", "Context", "Assumption", "Justification", "Option"],
      ["ContextArrow", "SupportArrow"],
    ]);
    const run = (v: any, s: ModelEditState<TV>) => {
      if (v.tag !== "Right") throw new Error("submenu");
      const r = interpret(s, _GsnItem, v.value);
      if (r.tag === "Left") throw new Error(show_ModelError(r.value));
      return r.value;
    };
    const [m1, st1, log1] = run(sub.value._0[0][0].menuValue, st);
    expect([m1, log1]).toEqual([Just("Insert G1.2.1"), ["ScriptProperties"]]); // modelNewName appends a number.
    const [m2, st2, log2] = run(sub.value._0[1][1].menuValue, st1);
    expect([m2, log2]).toEqual([Just("Insert SupportArrow1"), []]);
    const [m3, st3] = run(menu._0[0][0].menuValue, st2);
    expect(m3).toEqual(Just("Insert GSN Diagram 1"));
    expect(childNames(st3, pkg)).toEqual(["G1.2.1", "GSN Diagram 1", "SupportArrow1"]);
    const kids = M.elems(entity(st3, pkg)._entityChildren).map((u) => entity(st3, u)._entityContents);
    expect(kids.map((k) => k.tag === "GsnItem" && k._0.tag)).toEqual(["GsnNodeItem", "GsnDiagramItem", "GsnEdgeItem"]);
  });

  it("has context menus and activations", () => {
    const { st, pkg } = setup();
    const [[g, d], st1] = edit(st, (c) => {
      goToEntity(c, pkg);
      const g1 = mkEntity(c, review(_GsnItem, node(Goal(Name("G1"), "", true, true))));
      const d1 = mkEntity(c, review(_GsnItem, GsnDiagramItem<TV>(DiagramEntity(Name("D"), diagramFromList(ecls, []), mempty_DiagramAppearance))));
      return [g1, d1];
    });
    const labels = (e: Entity<TV>) => {
      const c = e._entityContents;
      if (c.tag !== "GsnItem") throw new Error("not GSN");
      return gsnEntityMenu(cls, e, c._0)._0.map((grp) => grp.map((i) => i.menuLabel));
    };
    expect(labels(g)).toEqual([["Properties", "Delete"]]);
    expect(labels(d)).toEqual([["Open diagram", "Properties", "Clone", "Delete"]]);
    const r1 = interpret(st1, _GsnItem, gsnActivation(cls, Just(g)));
    expect(r1.tag === "Right" && r1.value[2]).toEqual(["ScriptProperties"]);
    const r2 = interpret(st1, _GsnItem, gsnActivation(cls, Just(d)));
    expect(r2.tag === "Right" && [r2.value[0], r2.value[2]]).toEqual([Nothing, ["ScriptOpenDiagram"]]);
    const r3 = interpret(st1, _GsnItem, gsnActivation(cls, Just(entity(st1, pkg))));
    expect(r3.tag === "Right" && [r3.value[0], r3.value[2]]).toEqual([Nothing, []]);
  });

  it("wraps the GSN diagrams of the examples", () => {
    const model = loadExample("1 Quick Guide to the DSM.dsm");
    const diagrams = M.elems(model.modelContents).filter((e) => clsT.isDiagram(e._entityContents));
    expect(diagrams.map((e) => view(tvName, e._entityContents)._0).sort())
      .toEqual(["Design Argument", "Requirements Argument", "Start - Quick Guide to the DSM", "Test Argument", "Top level argument."]);
    for (const e of diagrams) {
      const r = evalModelEdit<TV, GsnItem<TV>, Maybe<EntityWrapper<HadesRender, TV>>>(cls, _GsnItem, model, (c) => gsnDiagramWrapper(cls, c, e));
      expect(r.tag).toBe("Right");
      if (r.tag !== "Right" || r.value.tag !== "Just" || r.value.value.tag !== "DiagramWrapper") throw new Error("no wrapper");
      const w = r.value.value;
      expect(w.diagramClass).toBe(ecls);
      expect(w.wrappedEntityId).toBe(e.entityId);
      const c = e._entityContents;
      expect(c.tag === "GsnItem" && c._0.tag === "GsnDiagramItem" && equals(w.diagramToEdit, c._0._0._diagramEntityContents)).toBe(true);
      expect(w.diagramContext.diagramId).toBe(e.entityId);
      expect(w.diagramMenu).toEqual(Nothing);
      const tb = w.diagramToolbar(null as any);
      expect(tb.toolbarLeft.map((g) => g.map((t) => t.toolIcon))).toEqual([
        ["gsn_goal", "gsn_strategy", "gsn_solution", "gsn_support_arrow"],
        ["gsn_context", "gsn_assumption", "gsn_justification", "gsn_context_arrow"],
        ["gsn_option"],
        ["trace-arrow"],
        ["basic_comment", "emblem-symbolic-link"],
      ]);
      expect(tb.toolbarRight.map((g) => g.map((t) => t.toolIcon))).toEqual([["align", "align-size", "align-distribute"], ["view-control"]]);
    }
    // The model root has the appearance used for highlighting.
    expect(M.member(gsnDiagramVariant, model.modelMeta)).toBe(true);
    // Not a diagram.
    const goal = M.elems(model.modelContents).find((e) => e._entityContents.tag === "GsnItem" && e._entityContents._0.tag === "GsnNodeItem")!;
    expect(evalModelEdit<TV, GsnItem<TV>, Maybe<EntityWrapper<HadesRender, TV>>>(cls, _GsnItem, model, (c) => gsnDiagramWrapper(cls, c, goal))).toEqual(Right(Nothing));
    expect(gsnToolbar(cls, goal.entityId, goal._entityParent).toolbarLeft.length).toBe(5);
  });

  it("draws boxes through the Delta, finding the node in the model", () => {
    const model = loadExample("1 Quick Guide to the DSM.dsm");
    const de = M.elems(model.modelContents).map((e) => e._entityContents)
      .flatMap((c) => (c.tag === "GsnItem" && c._0.tag === "GsnDiagramItem" ? [c._0._0] : []))
      .find((x) => x._diagramEntityName._0 === "Test Argument")!;
    const elems = diagramToList(de._diagramEntityContents);
    const goalBox = elems.flatMap((x) => (x.tag === "ElemBox" && x._0.boxType === "GoalBox" ? [x._0] : []))[0];
    const st = modelStartState<TV>(newGenerator(), model);
    const [svg] = edit(st, (c) => {
      const d = new DeltaCtx(ecls, { state: mkDiagramState(GenericContext("x", mempty_AppearanceDef), 1, de._diagramEntityContents) });
      d.base = c;
      const f = runPure(dtc.boxTypeDraw(d, goalBox, () => {}, Just(Colour(C.sRGB24(0, 0, 255)))));
      const s = new Cairo.SvgSurface(800, 400);
      f(view(goalBox.boxShapeClass.shapeDefinition, goalBox.boxShape))({ style: hadesConfig(Gtk.iconThemeNew()), cr: s.context() });
      expect(current(c).tag).toBe("Just");
      return s.document();
    }, _GsnItem);
    const goalEnt = entity(st, goalBox.boxEntity)._entityContents;
    const goalName = goalEnt.tag === "GsnItem" ? view(gsnItemName<TV>(), goalEnt._0)._0 : "?";
    expect(svg).toMatch(new RegExp(">" + goalName + "</text>"));
    expect(svg).toMatch(/stroke="rgb\(0, 0, 255\)"/);
  });

  it("round trips a diagram element through the element codec", () => {
    const b = dtc.mkBox(U.nil, U.nil, "JustificationBox", Nothing, BoundBox(Point(1, 2), Point(3, 4)));
    const codec = JSON_Element(dtc);
    const js = codec.toJSON(ElemBox(b));
    expect(js).toEqual({ boxId: U.nil, entity: U.nil, type: "Justification", peg: null, shape: { p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 } } });
    expect(equals(codec.parseJSON(js), ElemBox(b))).toBe(true);
    const a = ElemArrow(Arrow<any, TV>(U.fromWords(1, 2, 3, 4), U.fromWords(5, 6, 7, 8), GsnArrow("ContextArrow"), LineShape([Unconnected(Point(0, 0)), Unconnected(Point(5, 5))], [])));
    expect(codec.parseJSON(codec.toJSON(a))).toEqual(a);
  });
});
