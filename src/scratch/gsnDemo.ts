/**
 * Scratch demo for `GSN.Model` (open the app with `?demo=gsn`).
 *
 * Loads an example model from `src/dsm/share/examples` (`&file=1` .. `&file=4`, default the
 * "1 Quick Guide to the DSM") into a model type like the DSM's `SafetyModel` (GSN items,
 * packages, evidence and traces; other entity types are kept as raw JSON) and shows each GSN
 * diagram in a notebook page, edited through `App.GenericDiagram` with the `DiagramTypeClass
 * (GsnDiagramType v) v` instance of `GSN.Model` and the GSN toolbar. A last page, "GSN Notation",
 * is built by the demo: every box type, the undeveloped/uninstantiated decorations, context and
 * support arrows with each cardinality, and a trace to evidence. `&page=<n>` selects the page
 * shown at start-up (default: the "Requirements Argument" diagram when there is one).
 *
 * Script instructions are answered as a GUI would after pressing OK without changes (property
 * dialogs return the entity unchanged, other dialogs their initial value), so the toolbar tools
 * add entities without opening dialogs.
 *
 * `window.gsn` exposes the model and editor state for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import type { AppearanceClass } from "@/hades/src/App/Appearance";
import type { Editable, EntityWrapper, HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { HasEvidence } from "@/hades/evidence/Evidence/Model";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { HasMatrices } from "@/hades/src/Model/Matrices/Base";
import type { GsnDiagramType, HasGsn } from "@/dsm/gsn/GSN/Model";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { identity, lens, over, prism, review, set, view, type Lens, type Prism } from "@/lib/Control/Lens";
import { fetchDataFile, getDataDir } from "@/lib/System/Paths";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { setDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import {
  type Action, type BoundBox as BoundBoxT, type DiagramId, BoundBox, Connected, LineShape, Point,
  boxCentre, deltaDiagram, deltaSelection, deltaZoom, diagramContents, diagramFromList, mkScriptAction,
  streamStateT, tellAll, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesActionResult, type HadesGtk, HadesActionResult as mkHadesActionResult, hadesActionExecute,
  hadesConfig, hadesState, makeBottomBar, makeDrawingGtk, makeGtkDeltaToolbar,
} from "@/hades/src/Hades/GI";
import {
  type PackageAppearance, DiagramAppearance, JSON_PackageAppearance, coerceDiagramAppearance,
  mempty_DiagramAppearance, mempty_EntityShowFields,
} from "@/hades/src/App/Appearance";
import { type Box, Arrow, Avatar_Element, ElemArrow, ElemBox, elementMapAvatars } from "@/hades/src/App/GenericDiagram";
import {
  Evidence, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace, Trace, evidenceName,
  traceHeadRelation, traceName, traceTailRelation,
} from "@/hades/evidence/Evidence/Model";
import { type UserScriptFunctor, DiagramEntity, keyCommands } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelId, JSON_Model, JSON_Package,
  Name, Package, evalModelEdit, goToEntity, mkEntity, mkPackage, modelStartState, modifyRelations,
  packageName, queryRelations, runModelEdit, show_ModelError, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import { getReferenceValues } from "@/hades/src/Model/Abstract/Properties";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { append_RefTypeTable, refTypeTableCoerce } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel } from "@/hades/src/Model/Reflection/Reflective";
import type { Cardinality } from "@/hades/src/Model/Reflection/Types";
import { variantCoerce } from "@/hades/src/Model/Reflection/Values";
import { gsnDiagramVariant } from "@/dsm/gsn/GSN/FieldNames";
import {
  type BoxType, type GsnClass, type GsnElement, type GsnItem, type GsnNode, Assumption, Context,
  DiagramTypeClass_GsnDiagramType, EvidenceBox, Goal, GsnArrow, GsnDiagramItem, GsnEdge, GsnEdgeItem,
  GsnNodeItem, GsnOption, JSON_GsnItem, Justification, Reflective_GsnItem, Solution, Strategy, TraceArrow,
  gsnDiagramEntityTypes, gsnDiagramWrapper, gsnIsDiagram, gsnItemName, gsnNodeType,
} from "@/dsm/gsn/GSN/Model";

// ---------------------------------------------------------------------------------------------
// A model type like DSM.SafetyCase's SafetyModel.

type PM = PackageAppearance<TV>;
type TV =
  | { readonly tag: "GsnItem"; readonly _0: GsnItem<TV> }
  | { readonly tag: "Package"; readonly _0: Package<TV, PM> }
  | { readonly tag: "EvidenceItem"; readonly _0: Evidence }
  | { readonly tag: "TraceItem"; readonly _0: Trace }
  /** Entity types this demo does not know (bow ties, matrices, ...), kept as JSON. */
  | { readonly tag: "Other"; readonly _0: J.JSONObject };

const _GsnItem: Prism<TV, GsnItem<TV>> = prism((i: GsnItem<TV>): TV => ({ tag: "GsnItem", _0: i }),
  (v: TV) => (v.tag === "GsnItem" ? Right(v._0) : Left(v)));
const _Pkg: Prism<TV, Package<TV, PM>> = prism((p: Package<TV, PM>): TV => ({ tag: "Package", _0: p }),
  (v: TV) => (v.tag === "Package" ? Right(v._0) : Left(v)));
const _Ev: Prism<TV, Evidence> = prism((e: Evidence): TV => ({ tag: "EvidenceItem", _0: e }),
  (v: TV) => (v.tag === "EvidenceItem" ? Right(v._0) : Left(v)));
const _Tr: Prism<TV, Trace> = prism((t: Trace): TV => ({ tag: "TraceItem", _0: t }),
  (v: TV) => (v.tag === "TraceItem" ? Right(v._0) : Left(v)));
const never = <A>(): Prism<TV, A> => prism((_a: A): TV => ({ tag: "Other", _0: {} }), (v: TV) => Left(v));

const tvName: Lens<TV, Name> = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "GsnItem": return view(gsnItemName<TV>(), v._0);
      case "Package": return view(packageName<TV, PM>(), v._0);
      case "EvidenceItem": return view(evidenceName, v._0);
      case "TraceItem": return view(traceName, v._0);
      case "Other": return Name(typeof v._0.name === "string" ? v._0.name : "");
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
  reflectiveBuiltIn: (v) => (v.tag === "GsnItem" ? gsn().reflectiveBuiltIn(v._0) : []),
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
  // instance AppearanceClass (GsnDiagramType SafetyModel) SafetyModel
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
      const contents = over(diagramContents<GsnElement<TV>>(),
        (m) => M.map((x: GsnElement<TV>) => elementMapAvatars(f, x), m), d._diagramEntityContents);
      return { ...ent, _entityContents: { tag: "GsnItem", _0: GsnDiagramItem<TV>({ ...d, _diagramEntityContents: contents }) } };
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
type D = GsnElement<TV>;

// ---------------------------------------------------------------------------------------------
// The model and a script interpreter that answers as a user pressing "OK".

let modelState: ModelEditState<TV> = modelStartState<TV>(newGenerator(), {} as Model<TV>);
let currentHint: Maybe<string> = Nothing;
const statusLabel = Gtk.labelNew("");
const log: string[] = [];

function setStatus(msg: string): void {
  log.push(msg);
  Gtk.labelSetText(statusLabel, msg);
}

function answer(ctx: ModelEditCtx<TV, any>, instr: UserScriptFunctor<any, TV>): unknown {
  switch (instr.tag) {
    case "ScriptProperties": {
      const e = M.lookup(instr._0, ctx.state.stateModel.modelContents);
      if (e.tag === "Nothing") return Nothing;
      setStatus("Properties of " + view(tvName, e.value._entityContents)._0 + ": OK");
      return Just([e.value, queryRelations(ctx, (r) => getReferenceValues(instr._0, r))]);
    }
    case "ScriptDialog": return Just(instr._1);
    case "ScriptOpenDiagram": return null;
    case "ScriptGetSelection": return S.empty();
    case "ScriptSetSelection": return null;
    case "ScriptGetHint": return currentHint;
    case "ScriptSetHint":
      currentHint = instr._0;
      if (instr._0.tag === "Just") setStatus(instr._0.value);
      return null;
    case "ScriptPerformIO": return instr._0();
  }
}

/** Run the diagram actions in a "ModelScript" on the GSN subtype, answering its instructions. */
function runActions(h: HadesGtk<D>, acts: readonly Action<D>[]): HadesActionResult<D> {
  const r = runModelEdit(cls, _GsnItem, modelState, (ctx) => {
    const gen = hadesActionExecute(ctx, h, acts);
    let res = gen.next();
    while (!res.done) res = gen.next(answer(ctx, res.value as UserScriptFunctor<any, TV>));
    return res.value;
  });
  if (r.tag === "Left") {
    setStatus("Error: " + show_ModelError(r.value));
    return mkHadesActionResult(h, () => {}, Nothing, []);
  }
  modelState = r.value[1];
  return r.value[0].updateValue;
}

/** Run a model edit on the whole model. */
function edit<A>(act: (c: ModelEditCtx<TV, TV>) => A): A {
  const r = runModelEdit(cls, identity<TV>(), modelState, act);
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  modelState = r.value[1];
  return r.value[0].updateValue;
}

// ---------------------------------------------------------------------------------------------
// The "GSN Notation" diagram.

let idCounter = 0;
const newDiagramId = (): DiagramId => U.fromWords(0x65e0, 0xd1a6, 0x4000_0000, ++idCounter);

function centre(b: BoundBoxT): Point {
  return view(boxCentre, b);
}

/** Build a package with one of each GSN element and a diagram showing them. Returns the diagram's id. */
function buildNotation(): ModelId {
  return edit((c) => {
    const pkg = mkPackage(c, Name("GSN Notation"));
    goToEntity(c, pkg);
    const elements: D[] = [];
    const boxes = new Map<string, Box<any, TV>>();
    const addNode = (key: string, n: GsnNode, x: number, y: number, w = 200, h = 80): void => {
      goToEntity(c, pkg);
      const ent = mkEntity(c, review(_GsnItem, GsnNodeItem<TV>(n)));
      const b = dtc.mkBox(newDiagramId(), ent.entityId, gsnNodeType(n), Nothing, BoundBox(Point(x, y), Point(x + w, y + h)));
      boxes.set(key, b);
      elements.push(ElemBox(b));
    };
    const addBox = (key: string, typ: BoxType, v: TV, x: number, y: number, w = 200, h = 70): void => {
      goToEntity(c, pkg);
      const ent = mkEntity(c, v);
      const b = dtc.mkBox(newDiagramId(), ent.entityId, typ, Nothing, BoundBox(Point(x, y), Point(x + w, y + h)));
      boxes.set(key, b);
      elements.push(ElemBox(b));
    };
    const def = (b: Box<any, TV>): BoundBoxT => view(b.boxShapeClass.shapeDefinition, b.boxShape);
    const addArrow = (from: string, to: string, v: TV, typ: any, rels: readonly [string, string]): void => {
      goToEntity(c, pkg);
      const ent = mkEntity(c, v);
      const b1 = boxes.get(from)!;
      const b2 = boxes.get(to)!;
      const p1 = b1.boxShapeClass.shapeConnectionPoint(b1.boxShape, centre(def(b2)));
      const p2 = b2.boxShapeClass.shapeConnectionPoint(b2.boxShape, centre(def(b1)));
      modifyRelations(c, (r) => NR.insert(ent.entityId, b1.boxEntity, rels[0], r));
      modifyRelations(c, (r) => NR.insert(ent.entityId, b2.boxEntity, rels[1], r));
      elements.push(ElemArrow(Arrow<any, TV>(newDiagramId(), ent.entityId, typ,
        LineShape([Connected(p1, b1.boxId, Nothing), Connected(p2, b2.boxId, Nothing)], []))));
    };
    const edge = (t: "ContextArrow" | "SupportArrow", nm: string, card: Cardinality): TV =>
      review(_GsnItem, GsnEdgeItem<TV>(GsnEdge(t, Name(nm), card)));
    const arrowRels = [NR.edgeFromRelation, NR.edgeToRelation] as const;
    addNode("G1", Goal(Name("G1"), "Goal: developed and instantiated.", true, true), 40, 20);
    addNode("G2", Goal(Name("G2"), "Undeveloped goal.", false, true), 300, 20);
    addNode("G3", Goal(Name("G3"), "Uninstantiated goal.", true, false), 560, 20);
    addNode("G4", Goal(Name("G4"), "Undeveloped and uninstantiated goal.", false, false), 820, 20);
    addNode("S1", Strategy(Name("S1"), "Strategy: argue over each hazard.", true, true), 40, 190);
    addNode("C1", Context(Name("C1"), "Context: the operating environment.", true), 300, 190);
    addNode("A1", Assumption(Name("A1"), "Assumption: the hazard list is complete.", true), 560, 180, 200, 100);
    addNode("J1", Justification(Name("J1"), "Justification: accepted practice.", true), 820, 180, 200, 100);
    addNode("Sn1", Solution(Name("Sn1"), "Solution: test results.", true), 40, 380, 180, 100);
    addNode("Opt1", GsnOption(Name("Opt1"), "Option", true), 300, 370, 160, 120);
    addNode("G5", Goal(Name("G5"), "Zero or more (0:n).", true, true), 560, 390);
    addNode("G6", Goal(Name("G6"), "One or more (1:n).", true, true), 560, 580);
    addBox("E1", EvidenceBox, review(_Ev, Evidence(Name("Test report"))), 30, 580);
    addArrow("G1", "S1", edge("SupportArrow", "Support1", "CardinalityOne"), GsnArrow("SupportArrow"), arrowRels);
    addArrow("G1", "C1", edge("ContextArrow", "Context1", "CardinalityOne"), GsnArrow("ContextArrow"), arrowRels);
    addArrow("S1", "A1", edge("ContextArrow", "Context2", "CardinalityOne"), GsnArrow("ContextArrow"), arrowRels);
    addArrow("G4", "J1", edge("ContextArrow", "Context3", "CardinalityOne"), GsnArrow("ContextArrow"), arrowRels);
    addArrow("S1", "Sn1", edge("SupportArrow", "Support2", "CardinalityOne"), GsnArrow("SupportArrow"), arrowRels);
    addArrow("S1", "Opt1", edge("SupportArrow", "Support3", "CardinalityOpt"), GsnArrow("SupportArrow"), arrowRels);
    addArrow("S1", "G5", edge("SupportArrow", "Support4", "CardinalityMany"), GsnArrow("SupportArrow"), arrowRels);
    addArrow("S1", "G6", edge("SupportArrow", "Support5", "CardinalityMany1"), GsnArrow("SupportArrow"), arrowRels);
    addArrow("Sn1", "E1", review(_Tr, Trace(Name("Trace1"))), TraceArrow, [traceTailRelation, traceHeadRelation]);
    goToEntity(c, pkg);
    const diagram = mkEntity(c, review(_GsnItem, GsnDiagramItem<TV>(DiagramEntity(
      Name("GSN Notation"),
      diagramFromList(ecls, elements),
      DiagramAppearance(Nothing, mempty_EntityShowFields, []),
    ))));
    return diagram.entityId;
  });
}

// ---------------------------------------------------------------------------------------------
// Editors

interface Page {
  readonly name: string;
  readonly entity: ModelId;
  current: HadesGtk<D> | null;
}

const style = (() => {
  // The data icon theme, as Main.hs of the DSM sets it up, and the GUI icon search path as
  // App.ModelMain sets it up.
  const dataTheme = Gtk.iconThemeNew();
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [getDataDir("dsm")]);
  setDataIconTheme(dataTheme);
  const systemTheme = Gtk.iconThemeGetDefault();
  Gtk.iconThemeAppendSearchPath(systemTheme, getDataDir("dsm"));
  Gtk.iconThemeAppendSearchPath(systemTheme, getDataDir("hades"));
  return hadesConfig(dataTheme);
})();

function editorPage(page: Page): Gtk.Widget {
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  const ent = M.lookup(page.entity, modelState.stateModel.modelContents);
  if (ent.tag === "Nothing") throw new Error("missing diagram");
  const w = evalModelEdit<TV, TV, Maybe<EntityWrapper<HadesRender, TV>>>(cls, identity<TV>(), modelState.stateModel, (c) => clsT.getDiagramWrapper(c, ent.value));
  if (w.tag === "Left" || w.value.tag === "Nothing" || w.value.value.tag !== "DiagramWrapper") {
    throw new Error("not a diagram: " + page.name);
  }
  const wrapper = w.value.value;
  const net = B.compile(() => {
    const [toolbarWidget, toolbarActions] = makeGtkDeltaToolbar(ecls, wrapper.diagramToolbar(null as any));
    const hadesRef: B.Behavior<HadesGtk<D>> = B.lazyB(() => hadesB);
    const [drawingWidget, hadesInit, diagramActions] = makeDrawingGtk<D>(
      ecls, wrapper.diagramToEdit, wrapper.diagramContext, wrapper.diagramMenu, keyCommands<D>(), style, 1, hadesRef);
    const zoomRef: B.Event<number> = B.lazyE(() => zoomE);
    const updateZoom = (z: number): Action<D> => mkScriptAction<D>(function* (d) {
      d.state = { ...d.state, _deltaZoom: z };
      yield* tellAll(d);
      return yield* yieldViews(d);
    });
    const allActions = [diagramActions, toolbarActions, B.mapE((z: number) => [updateZoom(z)], zoomRef)]
      .reduceRight((acc, e) => B.unionWith((a: Action<D>[], b: Action<D>[]) => [...a, ...b], e, acc));
    const results = B.execute(B.apply(
      B.mapB((h: HadesGtk<D>) => (acts: Action<D>[]) => () => runActions(h, acts), hadesRef),
      allActions));
    const hadesB: B.Behavior<HadesGtk<D>> = B.stepper(hadesInit, B.mapE((r) => r.hadesActionNewState, results));
    B.reactimate(B.mapE((r) => () => {
      page.current = r.hadesActionNewState;
      r.hadesActionDraw();
      if (r.hadesActionCheckpoint.tag === "Just") setStatus(r.hadesActionCheckpoint.value);
      if (r.hadesActionProperties.length > 0) setStatus("Properties requested for " + r.hadesActionProperties.length + " element(s)");
    }, results));
    const zoomOf = (h: HadesGtk<D>): number => view(deltaZoom<D>(), streamStateT(view(hadesState<D>(), h)));
    const hintB: B.Behavior<Maybe<string>> = B.stepper<Maybe<string>>(Nothing,
      B.filterJust(B.mapE((r) => (r.hadesActionCheckpoint.tag === "Just" ? Just(r.hadesActionCheckpoint) : Nothing), results)));
    const [bottomBar, zoomE] = makeBottomBar(hintB, B.mapB(zoomOf, hadesB));
    Gtk.boxPackStart(vbox, toolbarWidget, false, false, 0);
    Gtk.boxPackStart(vbox, drawingWidget, true, true, 0);
    Gtk.boxPackStart(vbox, bottomBar, false, false, 0);
    page.current = hadesInit;
  });
  B.actuate(net);
  return vbox;
}

// ---------------------------------------------------------------------------------------------

const exampleFiles = ["1 Quick Guide to the DSM.dsm", "2 FMEA.dsm", "3 Managing Risks.dsm", "4 Managing Hazards.dsm"];

export async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fileIx = Math.max(0, Math.min(exampleFiles.length - 1, Number(params.get("file") ?? "1") - 1));
  const fileName = exampleFiles[fileIx];
  const json = await (await fetchDataFile("dsm", "examples/" + fileName)).json();
  const model = JSON_Model<TV>(cls).parseJSON(json);
  modelState = modelStartState<TV>(newGenerator(), model);

  const diagrams: Entity<TV>[] = M.elems(model.modelContents)
    .filter((e) => clsT.isDiagram(e._entityContents))
    .sort((a, b) => (view(tvName, a._entityContents)._0 < view(tvName, b._entityContents)._0 ? -1 : 1));
  const pages: Page[] = diagrams.map((e) => ({ name: view(tvName, e._entityContents)._0, entity: e.entityId, current: null }));
  pages.push({ name: "GSN Notation", entity: buildNotation(), current: null });

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "GSN demo — " + fileName);
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, vbox);
  const nb = Gtk.notebookNew();
  Gtk.notebookSetScrollable(nb, true);
  for (const p of pages) Gtk.notebookAppendPage(nb, editorPage(p), Gtk.labelNew(p.name));
  Gtk.boxPackStart(vbox, nb, true, true, 0);
  Gtk.widgetSetMarginStart(statusLabel, 6);
  Gtk.boxPackStart(vbox, statusLabel, false, false, 0);
  const defaultPage = Math.max(0, pages.findIndex((p) => p.name === "Requirements Argument"));
  const pageParam = params.get("page");
  Gtk.notebookSetCurrentPage(nb, pageParam === null ? defaultPage : Number(pageParam));

  const stateOf = (p: Page) => (p.current === null ? null : streamStateT(view(hadesState<D>(), p.current)));
  const describe = (e: D): unknown[] => {
    switch (e.tag) {
      case "ElemBox": {
        const b = e._0;
        const bb = view(b.boxShapeClass.shapeDefinition, b.boxShape) as BoundBoxT;
        const ent = M.lookup(b.boxEntity, modelState.stateModel.modelContents);
        const nm = ent.tag === "Just" ? view(tvName, ent.value._entityContents)._0 : "?";
        return ["box", b.boxType, nm, ...(bb.tag === "BoundBox" ? [bb._0._pX, bb._0._pY, bb._1._pX, bb._1._pY] : [])];
      }
      case "ElemArrow": {
        const a = e._0;
        const [s, t] = a._arrowShape._lineEnds;
        return ["arrow", a.arrowType, s.tag, t.tag, s.connectorPoint._pX, s.connectorPoint._pY, t.connectorPoint._pX, t.connectorPoint._pY];
      }
      case "ElemComment": return ["comment", e._0._commentText];
      case "ElemLink": return ["link", e._0._linkText];
    }
  };
  (window as any).gsn = {
    pages: () => pages.map((p) => p.name),
    page: () => Gtk.notebookGetCurrentPage(nb),
    setPage: (n: number) => Gtk.notebookSetCurrentPage(nb, n),
    items: (n: number) => {
      const s = stateOf(pages[n]);
      return s === null ? [] : M.elems(view(deltaDiagram<D>().dot(diagramContents<D>()), s)).map(describe);
    },
    selection: (n: number) => {
      const s = stateOf(pages[n]);
      return s === null ? [] : S.toList(view(deltaSelection<D>(), s)).length;
    },
    entityNames: () => M.elems(modelState.stateModel.modelContents).map((e) => view(tvName, e._entityContents)._0).sort(),
    log: () => log,
    canvasRect: () => {
      const el = [...document.querySelectorAll("canvas")].find((c) => c.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      return r ? [r.left, r.top, r.width, r.height] : null;
    },
  };
  Gtk.windowSetDefaultSize(win, 1300, 820);
  Gtk.widgetShowAll(win);
  Gtk.main();
}
