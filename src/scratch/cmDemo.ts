/**
 * Scratch demo for `Causality.Model` (open the app with `?demo=cm`).
 *
 * The example models shipped with the DSM contain no causal entities (causal models were removed
 * from the DSM before they were written; their "Hazard", "Control", "RiskEvent" entities are
 * bow-tie entities of `Causality.Risk`). So the demo loads an example model
 * (`&file=1` .. `&file=4`, default "3 Managing Risks") into a model type like the DSM's
 * `SafetyModel` as it was when it had causal items (causal items, GSN items, packages, evidence and
 * traces; other entity types are kept as raw JSON), adds a "Causal Models" package to it, writes
 * the whole model to JSON with `JSON_Model` and reads it back, and then shows every causal diagram
 * in a notebook page, edited through `App.GenericDiagram` with the `DiagramTypeClass (CausalType
 * v) v` instance and the causal toolbar.
 *
 * The causal package holds:
 *
 * * component "Fire Alarm": states, events of the three types, the four kinds of logic and
 *   sequence, trigger and guard edges (one inhibiting), with the diagram "Fire Alarm Diagram";
 * * component "Building": an instance of "Fire Alarm" (its box lists the exports, and arrows
 *   connect to the exported "Alarm Sounding" and "Fire"), events and states of its own, traces to
 *   a GSN goal and to evidence, and an obsolete hazard box, in "Building Diagram";
 * * an old-style diagram "Pump" directly in the package, which `fixOldComponents` turns into the
 *   component "Pump" with the diagram "Pump Diagram".
 *
 * `&page=<n>` selects the page shown at start-up. Script instructions are answered as a GUI would
 * after pressing OK without changes, so the toolbar tools add entities without opening dialogs.
 * `window.cm` exposes the model and editor state for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import type { AppearanceClass } from "@/hades/src/App/Appearance";
import type { Editable, EntityWrapper, HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { HasEvidence } from "@/hades/evidence/Evidence/Model";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { HasMatrices } from "@/hades/src/Model/Matrices/Base";
import type { GsnClass, GsnDiagramType, GsnItem, HasGsn } from "@/dsm/gsn/GSN/Model";
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
  type Action, type BoundBox as BoundBoxT, type ConnectorEnd, type DiagramId, BoundBox, CommentBox,
  Connected, LineShape, Point, boxCentre, deltaDiagram, deltaSelection, deltaZoom, diagramContents,
  diagramFromList, mkScriptAction, streamStateT, tellAll, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesActionResult, type HadesGtk, HadesActionResult as mkHadesActionResult, hadesActionExecute,
  hadesConfig, hadesState, makeBottomBar, makeDrawingGtk, makeGtkDeltaToolbar,
} from "@/hades/src/Hades/GI";
import {
  type PackageAppearance, DiagramAppearance, JSON_PackageAppearance, coerceDiagramAppearance,
  mempty_DiagramAppearance, mempty_EntityShowFields,
} from "@/hades/src/App/Appearance";
import {
  type Box, Arrow, Avatar_Element, Comment, ElemArrow, ElemBox, ElemComment, elementMapAvatars,
} from "@/hades/src/App/GenericDiagram";
import {
  Evidence, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace, Trace, evidenceName,
  traceHeadRelation, traceName, traceTailRelation,
} from "@/hades/evidence/Evidence/Model";
import { type UserScriptFunctor, DiagramEntity, keyCommands } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelId, JSON_Model, JSON_Package,
  Name, Package, addCheckedRelation, evalModelEdit, goToEntity, mkEntity, mkPackage, modelStartState,
  modifyRelations, packageName, queryRelations, runModelEdit, show_ModelError, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import { getReferenceValues } from "@/hades/src/Model/Abstract/Properties";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { append_RefTypeTable, refTypeTableCoerce } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel } from "@/hades/src/Model/Reflection/Reflective";
import { variantCoerce } from "@/hades/src/Model/Reflection/Values";
import { gsnDiagramVariant } from "@/dsm/gsn/GSN/FieldNames";
import {
  Goal, GsnNodeItem, JSON_GsnItem, Reflective_GsnItem, gsnDiagramEntityTypes, gsnDiagramWrapper, gsnIsDiagram,
  gsnItemName,
} from "@/dsm/gsn/GSN/Model";
import {
  arrowHeadInstance, arrowTailInstance, causalDiagramVariant, componentInstanceRelation,
} from "@/dsm/causality/Causality/FieldNames";
import {
  type ArrowType, type BoxType, type Causal, type CausalClass, type CausalNet, type CausalType, type EventType,
  type LogicType, CausalComponent, CausalDiagram, CausalEdge, CausalEvent, CausalInstance, CausalLogic,
  CausalState, ComponentModel, DiagramTypeClass_CausalType, Event, GuardEdge, Instance, JSON_Causal, Logic,
  LogicAndEvent, LogicAndState, LogicCountState, LogicOrEvent, Reflective_Causal, State, TemporalEdge,
  TriggerEdge, causalCanMove, causalDiagramEntityTypes, causalDiagramWrapper, causalIsDiagram, causalName,
  childBoxes, componentCanHaveChild, fixOldComponents, instanceExports,
} from "@/dsm/causality/Causality/Model";

// ---------------------------------------------------------------------------------------------
// A model type like DSM.SafetyCase's SafetyModel when it still had causal items.

type PM = PackageAppearance<TV>;
type TV =
  | { readonly tag: "CausalItem"; readonly _0: Causal<TV> }
  | { readonly tag: "GsnItem"; readonly _0: GsnItem<TV> }
  | { readonly tag: "Package"; readonly _0: Package<TV, PM> }
  | { readonly tag: "EvidenceItem"; readonly _0: Evidence }
  | { readonly tag: "TraceItem"; readonly _0: Trace }
  /** Entity types this demo does not know (bow ties, matrices, ...), kept as JSON. */
  | { readonly tag: "Other"; readonly _0: J.JSONObject };

const _CausalItem: Prism<TV, Causal<TV>> = prism((c: Causal<TV>): TV => ({ tag: "CausalItem", _0: c }),
  (v: TV) => (v.tag === "CausalItem" ? Right(v._0) : Left(v)));
const _GsnItem: Prism<TV, GsnItem<TV>> = prism((i: GsnItem<TV>): TV => ({ tag: "GsnItem", _0: i }),
  (v: TV) => (v.tag === "GsnItem" ? Right(v._0) : Left(v)));
const _Pkg: Prism<TV, Package<TV, PM>> = prism((p: Package<TV, PM>): TV => ({ tag: "Package", _0: p }),
  (v: TV) => (v.tag === "Package" ? Right(v._0) : Left(v)));
const _Ev: Prism<TV, Evidence> = prism((e: Evidence): TV => ({ tag: "EvidenceItem", _0: e }),
  (v: TV) => (v.tag === "EvidenceItem" ? Right(v._0) : Left(v)));
const _Tr: Prism<TV, Trace> = prism((t: Trace): TV => ({ tag: "TraceItem", _0: t }),
  (v: TV) => (v.tag === "TraceItem" ? Right(v._0) : Left(v)));
const never = <A>(): Prism<TV, A> => prism((_a: A): TV => ({ tag: "Other", _0: {} }), (v: TV) => Left(v));

/** Entities kept as JSON: query diagrams (`{inputs, diagram: {name, ...}, description}`) or `{name, ...}`. */
const isQuery = (o: J.JSONObject): boolean => typeof o.diagram === "object" && o.diagram !== null && !Array.isArray(o.diagram);
const otherName = (o: J.JSONObject): string => {
  const n = isQuery(o) ? (o.diagram as J.JSONObject).name : o.name;
  return typeof n === "string" ? n : "";
};

const tvName: Lens<TV, Name> = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "CausalItem": return view(causalName<TV>(), v._0);
      case "GsnItem": return view(gsnItemName<TV>(), v._0);
      case "Package": return view(packageName<TV, PM>(), v._0);
      case "EvidenceItem": return view(evidenceName, v._0);
      case "TraceItem": return view(traceName, v._0);
      case "Other": return Name(otherName(v._0));
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "CausalItem": return { tag: "CausalItem", _0: set(causalName<TV>(), n, v._0) };
      case "GsnItem": return { tag: "GsnItem", _0: set(gsnItemName<TV>(), n, v._0) };
      case "Package": return { tag: "Package", _0: set(packageName<TV, PM>(), n, v._0) };
      case "EvidenceItem": return { tag: "EvidenceItem", _0: Evidence(n) };
      case "TraceItem": return { tag: "TraceItem", _0: Trace(n) };
      case "Other": // Query diagrams keep their name in the diagram.
        return { tag: "Other", _0: isQuery(v._0) ? { ...v._0, diagram: { ...(v._0.diagram as J.JSONObject), name: n._0 } } : { ...v._0, name: n._0 } };
    }
  },
);

const causalRefl = () => Reflective_Causal<TV>(cls);
const causalCodec = () => JSON_Causal<TV>(cls);
const gsnRefl = () => Reflective_GsnItem<TV>(gsnCls);
const gsnCodec = () => JSON_GsnItem<TV>(gsnCls);

type ClsT = AppearanceClass<CausalType<TV>, TV> & Editable<HadesRender, TV> & HasDiagrams<HadesRender, TV> &
  HasEvidence<TV> & HasGsn<TV> & HasLookups<TV> & HasMatrices<TV> & { readonly _Report: Prism<TV, unknown> } &
  { readonly _Causal: Prism<TV, Causal<TV>> };
const clsT: ClsT = {
  reflectiveName: (v) => {
    switch (v.tag) {
      case "CausalItem": return variantCoerce(causalRefl().reflectiveName(v._0));
      case "GsnItem": return variantCoerce(gsnRefl().reflectiveName(v._0));
      case "Package": return "Package";
      case "EvidenceItem": return Reflective_Evidence.reflectiveName(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveName(v._0);
      case "Other": return typeof v._0.type === "string" ? v._0.type : "Other";
    }
  },
  variantUserLabel: defaultVariantUserLabel,
  get reflectiveDefaults(): TV[] {
    return [
      ...causalRefl().reflectiveDefaults.map((i): TV => ({ tag: "CausalItem", _0: i })),
      ...gsnRefl().reflectiveDefaults.map((i): TV => ({ tag: "GsnItem", _0: i })),
      { tag: "Package", _0: Package(Name(""), M.empty()) },
      { tag: "EvidenceItem", _0: Evidence(Name("")) },
      { tag: "TraceItem", _0: Trace(Name("")) },
    ];
  },
  reflectiveBuiltIn: (v) => (v.tag === "CausalItem" ? causalRefl().reflectiveBuiltIn(v._0)
    : v.tag === "GsnItem" ? gsnRefl().reflectiveBuiltIn(v._0) : []),
  reflectiveGet: (v) => (v.tag === "CausalItem" ? causalRefl().reflectiveGet(v._0)
    : v.tag === "GsnItem" ? gsnRefl().reflectiveGet(v._0) : M.empty()),
  reflectiveSet: (st, v) => (v.tag === "CausalItem" ? { tag: "CausalItem", _0: causalRefl().reflectiveSet(st, v._0) }
    : v.tag === "GsnItem" ? { tag: "GsnItem", _0: gsnRefl().reflectiveSet(st, v._0) } : v),
  get reflectiveBuiltInRefs() {
    return [causalRefl().reflectiveBuiltInRefs, gsnRefl().reflectiveBuiltInRefs,
      Reflective_Evidence.reflectiveBuiltInRefs, Reflective_Trace.reflectiveBuiltInRefs]
      .map((t) => refTypeTableCoerce<any, TV>(t)).reduce((a, b) => append_RefTypeTable(a, b));
  },
  get reflectiveArrows() {
    return M.unions([causalRefl().reflectiveArrows, gsnRefl().reflectiveArrows, Reflective_Trace.reflectiveArrows]
      .map((m) => M.mapKeys(variantCoerce, m as M.Map<string, any>)));
  },
  name: tvName,
  _Package: _Pkg,
  entityCanHaveChild: (p, c) => p.tag === "Package" || p.tag === "Other" ||
    (p.tag === "CausalItem" && p._0.tag === "CausalComponent" && componentCanHaveChild(cls, _CausalItem, c)),
  entityCanMove: (v) => (v.tag === "CausalItem" ? causalCanMove(v._0) : true),
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: TV): J.Value => {
      switch (v.tag) {
        case "CausalItem": return causalCodec().toJSON(v._0);
        case "GsnItem": return gsnCodec().toJSON(v._0);
        case "Package": return JSON_Package(cls).toJSON(v._0);
        case "EvidenceItem": return JSON_Evidence.toJSON(v._0);
        case "TraceItem": return JSON_Trace.toJSON(v._0);
        case "Other": return v._0;
      }
    },
    J.alt<TV>(
      (v) => ({ tag: "GsnItem", _0: gsnCodec().parseJSON(v) }),
      (v) => ({ tag: "CausalItem", _0: causalCodec().parseJSON(v) }),
      (v) => ({ tag: "Package", _0: JSON_Package(cls).parseJSON(v) }),
      (v) => ({ tag: "EvidenceItem", _0: JSON_Evidence.parseJSON(v) }),
      (v) => ({ tag: "TraceItem", _0: JSON_Trace.parseJSON(v) }),
      (v) => ({ tag: "Other", _0: J.withObject("Other", (o) => o, v) }),
    ),
  ),
  packageMetaJ: JSON_PackageAppearance,
  packageMetaMempty: M.empty(),
  packageMetaAppend: (a, b) => M.union(a, b),
  // instance AppearanceClass (CausalType SafetyModel) SafetyModel
  getDiagramAppearance: (pm: PM) =>
    coerceDiagramAppearance(M.findWithDefault(mempty_DiagramAppearance, causalDiagramVariant, pm)),
  // eslint-disable-next-line require-yield
  editableActivation: () => function* () {
    return Nothing;
  },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
  isDiagram: (v) => (v.tag === "CausalItem" && causalIsDiagram(v._0)) || (v.tag === "GsnItem" && gsnIsDiagram(gsnCls, v._0)),
  getDiagramWrapper: (ctx, e) => {
    const c = e._entityContents;
    if (c.tag === "CausalItem") return withSubtype(ctx, _CausalItem, (c1) => causalDiagramWrapper(cls, c1, e));
    if (c.tag === "GsnItem") return withSubtype(ctx, _GsnItem, (c1) => gsnDiagramWrapper(gsnCls, c1, e));
    return Nothing;
  },
  diagramEntityTypes: M.union(gsnDiagramEntityTypes<TV>(), causalDiagramEntityTypes),
  diagramMapAvatars: (f, ent) => {
    const c = ent._entityContents;
    if (c.tag === "CausalItem" && c._0.tag === "CausalDiagram") {
      const d = c._0._0;
      const contents = over(diagramContents<CausalNet<TV>>(),
        (m) => M.map((x: CausalNet<TV>) => elementMapAvatars(f, x), m), d._diagramEntityContents);
      return { ...ent, _entityContents: { tag: "CausalItem", _0: CausalDiagram<TV>({ ...d, _diagramEntityContents: contents }) } };
    }
    return ent;
  },
  _Causal: _CausalItem,
  _Evidence: _Ev,
  _Trace: _Tr,
  _Gsn: _GsnItem,
  _LookupTable: never(),
  _Matrix: never(),
  _Report: never(),
  _QueryDiagram: never(),
  queryAvatars: () => [],
};
const cls: CausalClass<TV> = clsT as CausalClass<TV>;
/** The model dictionary with the `AppearanceClass (GsnDiagramType SafetyModel) SafetyModel` instance. */
const gsnCls: GsnClass<TV> = Object.assign(Object.create(cls) as object, {
  getDiagramAppearance: (pm: PM) =>
    coerceDiagramAppearance<any, GsnDiagramType<TV>, TV>(M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm)),
}) as GsnClass<TV>;

const dtc = DiagramTypeClass_CausalType<TV>(cls);
const ecls = Avatar_Element<CausalType<TV>, TV>(dtc);
type D = CausalNet<TV>;
const causal = (c: Causal<TV>): TV => review(_CausalItem, c);

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

/** Run the diagram actions in a "ModelScript" on the causal subtype, answering its instructions. */
function runActions(h: HadesGtk<D>, acts: readonly Action<D>[]): HadesActionResult<D> {
  const r = runModelEdit(cls, _CausalItem, modelState, (ctx) => {
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
// The causal models.

let idCounter = 0;
const newDiagramId = (): DiagramId => U.fromWords(0xca05a1, 0xd1a6, 0x4000_0000, ++idCounter);

const def = (b: Box<any, TV>): BoundBoxT => view(b.boxShapeClass.shapeDefinition, b.boxShape);
const centre = (b: BoundBoxT): Point => view(boxCentre, b);

/** Add the causal package to the model. */
function buildCausal(): void {
  edit((c) => {
    const pkg = mkPackage(c, Name("Causal Models"));
    const add = (parent: ModelId, v: TV): Entity<TV> => {
      goToEntity(c, parent);
      return mkEntity(c, v);
    };
    const comp = (nm: string) => add(pkg, causal(CausalComponent(ComponentModel(Name(nm)))));
    const diagram = (parent: ModelId, nm: string, elements: D[]) =>
      add(parent, causal(CausalDiagram(DiagramEntity(Name(nm), diagramFromList(ecls, elements),
        DiagramAppearance(Nothing, mempty_EntityShowFields, [])))));

    /** Elements of one diagram, with helpers to place boxes and connect arrows. */
    const canvas = (owner: ModelId) => {
      const elements: D[] = [];
      const boxes = new Map<string, Box<CausalType<TV>, TV>>();
      const ents = new Map<string, Entity<TV>>();
      const box = (key: string, typ: BoxType, v: TV | Entity<TV>, x: number, y: number, w: number, h: number) => {
        const ent = "entityId" in v ? v : add(owner, v);
        const b = dtc.mkBox(newDiagramId(), ent.entityId, typ, Nothing, BoundBox(Point(x, y), Point(x + w, y + h)));
        boxes.set(key, b);
        ents.set(key, ent);
        elements.push(ElemBox(b));
        return ent;
      };
      /** An end of an arrow: a box key, or `[instance box key, exported entity]`. */
      type EndSpec = string | readonly [string, Entity<TV>];
      const endBox = (e: EndSpec) => boxes.get(typeof e === "string" ? e : e[0])!;
      const endPoint = (e: EndSpec, towards: Point): ConnectorEnd => {
        const b = endBox(e);
        if (typeof e === "string") return Connected(b.boxShapeClass.shapeConnectionPoint(b.boxShape, towards), b.boxId, Nothing);
        // A child of an instance box: the side of the export's line facing the other end.
        const exports = withSubtype(c, _CausalItem, (c1) => instanceExports(c1, ents.get(e[0])!.entityId));
        const ix = exports.findIndex((x) => x.entityId === e[1].entityId);
        const gen = childBoxes(b.boxShapeClass.shapeInnerBox(b.boxShape));
        let cb = gen.next().value;
        for (let i = 0; i < ix; i++) cb = gen.next().value;
        if (cb.tag !== "BoundBox") throw new Error("no child box");
        const mid = centre(cb);
        return Connected(Point(towards._pX < mid._pX ? cb._0._pX : cb._1._pX, mid._pY), b.boxId, Just(e[1].entityId));
      };
      const arrow = (from: EndSpec, to: EndSpec, v: TV, typ: ArrowType, middle: Point[] = []) => {
        const ent = add(owner, v);
        const [tailRel, headRel] = typ === "TraceArrow" ? [traceTailRelation, traceHeadRelation] : [NR.edgeFromRelation, NR.edgeToRelation];
        const link = (e: EndSpec, rel: string, exportRel: string) => {
          if (typeof e === "string") {
            modifyRelations(c, (r) => NR.insert(ent.entityId, endBox(e).boxEntity, rel, r));
          } else { // The model relation is with the export, the diagram relation with the instance.
            modifyRelations(c, (r) => NR.insert(ent.entityId, e[1].entityId, rel, r));
            modifyRelations(c, (r) => NR.insert(ent.entityId, endBox(e).boxEntity, exportRel, r));
          }
        };
        link(from, tailRel, arrowTailInstance);
        link(to, headRel, arrowHeadInstance);
        const p1 = endPoint(from, middle.length > 0 ? middle[0] : centre(def(endBox(to))));
        const p2 = endPoint(to, middle.length > 0 ? middle[middle.length - 1] : centre(def(endBox(from))));
        elements.push(ElemArrow(Arrow<CausalType<TV>, TV>(newDiagramId(), ent.entityId, typ, LineShape([p1, p2], middle))));
      };
      return { elements, box, arrow, ents };
    };
    const event = (typ: EventType, nm: string, txt: string, hidden = false) => causal(CausalEvent(Event(typ, Name(nm), txt, hidden)));
    const state = (nm: string, txt: string, hidden = false) => causal(CausalState(State(Name(nm), txt, hidden)));
    const logic = (t: LogicType, nm: string, hidden = false) => causal(CausalLogic(Logic(t, Name(nm), hidden)));
    const seq = (nm: string) => causal(CausalEdge(TemporalEdge(Name(nm))));
    const trig = (nm: string) => causal(CausalEdge(TriggerEdge(Name(nm))));
    const guard = (nm: string, inhibit = false) => causal(CausalEdge(GuardEdge(Name(nm), inhibit)));

    // Component "Fire Alarm".
    const alarm = comp("Fire Alarm");
    const fa = canvas(alarm.entityId);
    fa.box("armed", "StateBox", state("Armed", "Detectors are active."), 40, 40, 190, 80);
    fa.box("smoke", "EventBox", event("SimpleEvent", "Smoke Detected", "A detector senses smoke."), 330, 40, 200, 80);
    fa.box("sounding", "StateBox", state("Alarm Sounding", "Sirens are on."), 640, 40, 190, 80);
    fa.box("reset", "EventBox", event("SimpleEvent", "Reset", "Manual reset (not exported).", true), 940, 40, 190, 80);
    fa.box("count", "LogicBox", logic(LogicCountState(2), "Count 1"), 40, 220, 170, 120);
    fa.box("andS", "LogicBox", logic(LogicAndState, "AND-1"), 300, 220, 170, 120);
    fa.box("orE", "LogicBox", logic(LogicOrEvent, "OR-1"), 560, 220, 170, 120);
    fa.box("andE", "LogicBox", logic(LogicAndEvent, "AND-2", true), 820, 220, 170, 120);
    fa.box("fire", "EventBox", event("MishapEvent", "Fire", "Uncontrolled fire."), 40, 440, 200, 80);
    fa.box("sprinkler", "EventBox", event("ControlEvent", "Sprinkler On", "Sprinklers release water."), 520, 440, 220, 80);
    fa.box("disarmed", "StateBox", state("Disarmed", "Maintenance mode.", true), 940, 440, 190, 80);
    fa.arrow("armed", "smoke", seq("Sequence-1"), "TemporalArrow");
    fa.arrow("smoke", "sounding", seq("Sequence-2"), "TemporalArrow");
    fa.arrow("sounding", "reset", seq("Sequence-3"), "TemporalArrow");
    fa.arrow("smoke", "orE", trig("Trigger-1"), "TriggerArrow");
    fa.arrow("fire", "orE", trig("Trigger-2"), "TriggerArrow");
    fa.arrow("orE", "sprinkler", trig("Trigger-3"), "TriggerArrow");
    fa.arrow("smoke", "andE", trig("Trigger-4"), "TriggerArrow");
    fa.arrow("count", "andS", guard("Guard-1"), "GuardArrow");
    fa.arrow("armed", "andS", guard("Guard-2"), "GuardArrow");
    fa.arrow("andS", "sprinkler", guard("Guard-3"), "GuardArrow");
    fa.arrow("disarmed", "sprinkler", guard("Guard-4 (inhibit)", true), "GuardArrow");
    diagram(alarm.entityId, "Fire Alarm Diagram", fa.elements);

    // Component "Building", with an instance of the fire alarm.
    const building = comp("Building");
    const goal = add(pkg, review(_GsnItem, GsnNodeItem<TV>(Goal(Name("G1"), "Occupants can escape a fire.", true, true))));
    const evidence = add(pkg, review(_Ev, Evidence(Name("Evacuation drill report"))));
    const bd = canvas(building.entityId);
    const inst = bd.box("inst", "InstanceBox", causal(CausalInstance(Instance(Name("Fire Alarm 1")))), 40, 40, 240, 230);
    addCheckedRelation(c, componentInstanceRelation, inst, alarm);
    const exportNamed = (nm: string) => fa.ents.get(nm)!;
    bd.box("evacuate", "EventBox", event("SimpleEvent", "Evacuate", "Occupants leave."), 420, 60, 200, 80);
    bd.box("brigade", "EventBox", event("ControlEvent", "Call Fire Brigade", ""), 420, 220, 220, 80);
    bd.box("occupied", "StateBox", state("Occupied", ""), 700, 330, 180, 80);
    bd.box("empty", "StateBox", state("Empty", "Everybody is out."), 760, 60, 180, 80);
    bd.box("goal", "GoalBox", goal, 1040, 40, 220, 110);
    bd.box("evidence", "EvidenceBox", evidence, 1040, 230, 220, 90);
    bd.box("hazard", "HazardBox", event("MishapEvent", "Old Hazard", "", true), 40, 380, 260, 120);
    bd.arrow(["inst", exportNamed("sounding")], "evacuate", guard("Guard-1"), "GuardArrow");
    bd.arrow(["inst", exportNamed("fire")], "brigade", trig("Trigger-1"), "TriggerArrow");
    bd.arrow("occupied", "evacuate", seq("Sequence-1"), "TemporalArrow");
    bd.arrow("evacuate", "empty", seq("Sequence-2"), "TemporalArrow");
    bd.arrow("evacuate", "goal", review(_Tr, Trace(Name("Trace-1"))), "TraceArrow", [Point(700, 20), Point(1000, 20)]);
    bd.arrow("empty", "evidence", review(_Tr, Trace(Name("Trace-2"))), "TraceArrow");
    diagram(building.entityId, "Building Diagram", bd.elements);

    // An old-style diagram directly in the package, converted by "fixOldComponents" below.
    diagram(pkg, "Pump", [ElemComment<CausalType<TV>, TV>(Comment(newDiagramId(), CommentBox(BoundBox(Point(40, 40), Point(460, 140))),
      Nothing, "This diagram was a child of the package. \"fixOldComponents\" turned it into the component \"Pump\" " +
      "and moved the diagram into it as \"Pump Diagram\"."))]);
  });
  // fixOldComponents is a ModelEdit on the causal subtype.
  const r = runModelEdit(cls, _CausalItem, modelState, (c) => fixOldComponents(cls, c));
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  modelState = r.value[1];
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
  const w = evalModelEdit<TV, TV, Maybe<EntityWrapper<HadesRender, TV>>>(cls, identity<TV>(), modelState.stateModel,
    (c) => clsT.getDiagramWrapper(c, ent.value));
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
  const fileIx = Math.max(0, Math.min(exampleFiles.length - 1, Number(params.get("file") ?? "3") - 1));
  const fileName = exampleFiles[fileIx];
  const json = await (await fetchDataFile("dsm", "examples/" + fileName)).json();
  const codec = JSON_Model<TV>(cls);
  modelState = modelStartState<TV>(newGenerator(), codec.parseJSON(json));
  buildCausal();
  // Save and load the model, causal parts and all.
  const saved = JSON.stringify(codec.toJSON(modelState.stateModel));
  const model = codec.parseJSON(JSON.parse(saved));
  modelState = modelStartState<TV>(newGenerator(), model);
  setStatus(`Loaded "${fileName}", added the causal models, saved and reloaded (${saved.length} bytes).`);

  const diagrams: Entity<TV>[] = M.elems(model.modelContents)
    .filter((e) => e._entityContents.tag === "CausalItem" && causalIsDiagram(e._entityContents._0))
    .sort((a, b) => (view(tvName, a._entityContents)._0 < view(tvName, b._entityContents)._0 ? -1 : 1));
  const pages: Page[] = diagrams.map((e) => ({ name: view(tvName, e._entityContents)._0, entity: e.entityId, current: null }));

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Causality demo — " + fileName);
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, vbox);
  const nb = Gtk.notebookNew();
  Gtk.notebookSetScrollable(nb, true);
  for (const p of pages) Gtk.notebookAppendPage(nb, editorPage(p), Gtk.labelNew(p.name));
  Gtk.boxPackStart(vbox, nb, true, true, 0);
  Gtk.widgetSetMarginStart(statusLabel, 6);
  Gtk.boxPackStart(vbox, statusLabel, false, false, 0);
  const pageParam = params.get("page");
  Gtk.notebookSetCurrentPage(nb, pageParam === null ? 0 : Number(pageParam));

  const stateOf = (p: Page) => (p.current === null ? null : streamStateT(view(hadesState<D>(), p.current)));
  const nameOfEnt = (id: ModelId): string => {
    const e = M.lookup(id, modelState.stateModel.modelContents);
    return e.tag === "Just" ? view(tvName, e.value._entityContents)._0 : "?";
  };
  const describe = (e: D): unknown[] => {
    switch (e.tag) {
      case "ElemBox": {
        const b = e._0;
        const bb = def(b);
        return ["box", b.boxType, nameOfEnt(b.boxEntity), ...(bb.tag === "BoundBox" ? [bb._0._pX, bb._0._pY, bb._1._pX, bb._1._pY] : [])];
      }
      case "ElemArrow": {
        const a = e._0;
        const [s, t] = a._arrowShape._lineEnds;
        const child = (x: ConnectorEnd) => (x.tag === "Connected" && x.connectorTargetChild.tag === "Just" ? nameOfEnt(x.connectorTargetChild.value) : null);
        return ["arrow", a.arrowType, nameOfEnt(a.arrowEntity), s.tag, t.tag, child(s), child(t),
          s.connectorPoint._pX, s.connectorPoint._pY, t.connectorPoint._pX, t.connectorPoint._pY];
      }
      case "ElemComment": return ["comment", e._0._commentText];
      case "ElemLink": return ["link", e._0._linkText];
    }
  };
  (window as any).cm = {
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
    entityNames: () => M.elems(modelState.stateModel.modelContents)
      .filter((e) => e._entityContents.tag === "CausalItem").map((e) => view(tvName, e._entityContents)._0).sort(),
    children: (nm: string) => {
      const e = M.elems(modelState.stateModel.modelContents).find((x) => view(tvName, x._entityContents)._0 === nm);
      return e === undefined ? null : M.keys(e._entityChildren).map((n) => n._0);
    },
    log: () => log,
    canvasRect: () => {
      const el = [...document.querySelectorAll("canvas")].find((x) => x.getBoundingClientRect().width > 0);
      const r = el?.getBoundingClientRect();
      return r ? [r.left, r.top, r.width, r.height] : null;
    },
  };
  Gtk.windowSetDefaultSize(win, 1360, 820);
  Gtk.widgetShowAll(win);
  Gtk.main();
}
