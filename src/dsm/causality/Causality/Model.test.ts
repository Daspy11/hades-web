import { describe, expect, it } from "vitest";
import type { AppearanceClass } from "@/hades/src/App/Appearance";
import type { Editable, EntityWrapper, HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { HasEvidence } from "@/hades/evidence/Evidence/Model";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { HasMatrices } from "@/hades/src/Model/Matrices/Base";
import type { GsnClass, GsnDiagramType, GsnItem, HasGsn } from "@/dsm/gsn/GSN/Model";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
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
  type BoundBox as BoundBoxT, type Diagram, BoundBox, BoxShapeClass_Diamond, BoxShapeClass_Oval,
  BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, Connected, DeltaCtx, LineShape, NoBox, Oval,
  Parallelogram, Point, Rectangle, Unconnected, deltaDiagram, diagramContents, diagramFromList, diagramToList,
  mkDiagramState,
} from "@/hades/src/Hades/Abstract";
import { hadesConfig, hadesFontSize, layoutText } from "@/hades/src/Hades/GI/BasicShapes";
import {
  type PackageAppearance, JSON_PackageAppearance, coerceDiagramAppearance, mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import {
  type Box, Arrow, Avatar_Element, ElemArrow, ElemBox, GenericContext, JSON_Element, elementMapAvatars,
  mempty_AppearanceDef,
} from "@/hades/src/App/GenericDiagram";
import {
  Evidence, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace, Trace, evidenceName,
  traceArrowDash, traceArrowHead, traceArrowRelations, traceName,
} from "@/hades/evidence/Evidence/Model";
import { type ModelScriptAct, DiagramEntity, stepScript } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  JSON_Model, JSON_Package, Name, Package, addCheckedRelation, current, descriptionField, emptyModel,
  evalModelEdit, goToEntity, mkEntity, mkPackage, modelStartState, modifyRelations, nameField,
  packageName, runModelEdit, show_ModelError, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import {
  append_RefTypeTable, arrowRelations, mkOneToMany, refTypeTableCoerce,
} from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel } from "@/hades/src/Model/Reflection/Reflective";
import { ExtBool, ExtInt, ExtText, variantCoerce } from "@/hades/src/Model/Reflection/Values";
import { gsnDiagramVariant } from "@/dsm/gsn/GSN/FieldNames";
import {
  Goal, GsnNodeItem, JSON_GsnItem, Reflective_GsnItem, gsnDiagramEntityTypes, gsnDiagramWrapper,
  gsnIsDiagram, gsnItemName,
} from "@/dsm/gsn/GSN/Model";
import {
  arrowHeadInstance, arrowTailInstance, causalDiagramVariant, componentInstanceRelation, countField,
  hiddenField, inhibitField,
} from "./FieldNames";
import {
  type ArrowType, type BoxType, type Causal, type CausalClass, type CausalNet, type CausalType,
  type Edge, ComponentModel, ControlEvent, DiagramTypeClass_CausalType, Event, GuardEdge, Instance,
  JSON_ArrowType, JSON_BoxType, JSON_Causal, JSON_ComponentModel, JSON_Edge, JSON_Event, JSON_EventType,
  JSON_Instance, JSON_Logic, JSON_State, Logic, LogicAndEvent, LogicAndState, LogicCountState,
  LogicOrEvent, MishapEvent, Reflective_Causal, SimpleEvent, State, TemporalEdge, TriggerEdge,
  _CausalComponent, _CausalDiagram, _CausalEdge, _CausalEvent, _CausalInstance, _CausalLogic,
  _CausalState, addCausalEntityMenu, arrowTypeValues, boxTypeValues, causalActivation,
  causalArrowCanConnect, causalBoxChildConnection, causalBoxChildren, causalCanMove,
  causalDiagramEntityTypes, causalDiagramWrapper, causalEntityMenu, causalExported, causalIcon,
  causalIsDiagram, causalName, causalAvatarType, childBoxes, componentCanHaveChild, componentName,
  createArrowAvatar, createBoxAvatar, createInstance, drawCausalEventBox, drawCausalInstanceBox,
  drawCausalLogicBox, drawCausalStateBox, edgeInhibit, edgeName, edgeTypeName, eq_Causal, eventHidden,
  eventName, eventText, eventType, eventTypeJson, eventTypeName, eventTypeValues, eventVariants,
  fixOldComponents, instanceExports, instanceName, isSibling, logicCount, logicHidden, logicIsEvent,
  logicIsState, logicName, logicType, logicTypeName, read_ArrowType, read_BoxType, read_LogicType,
  show_EventType, show_LogicType, stateHidden, stateName, stateText, symbol,
  CausalComponent, CausalDiagram, CausalEdge, CausalEvent, CausalInstance, CausalLogic, CausalState,
} from "./Model";

// ---------------------------------------------------------------------------------------------
// A model type like the DSM's SafetyModel as it was when it had causal models: causal items,
// GSN items, packages, evidence and traces. Other entity types (bow ties, matrices, reports,
// ...) are kept as raw JSON so that the example files load.

type PM = PackageAppearance<TV>;
type TV =
  | { readonly tag: "CausalItem"; readonly _0: Causal<TV> }
  | { readonly tag: "GsnItem"; readonly _0: GsnItem<TV> }
  | { readonly tag: "Package"; readonly _0: Package<TV, PM> }
  | { readonly tag: "EvidenceItem"; readonly _0: Evidence }
  | { readonly tag: "TraceItem"; readonly _0: Trace }
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

/** The dictionary, typed without the classes whose modules may still change, then used as `CausalClass<TV>`. */
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
    : v.tag === "GsnItem" ? gsnRefl().reflectiveBuiltIn(v._0) : [nameField]),
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
      const contents = over(diagramContents<CausalNet<TV>>(), (m) => M.map((x: CausalNet<TV>) => elementMapAvatars(f, x), m),
        d._diagramEntityContents);
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
/** The same model dictionary with the `AppearanceClass (GsnDiagramType SafetyModel) SafetyModel` instance. */
const gsnCls: GsnClass<TV> = Object.assign(Object.create(cls) as object, {
  getDiagramAppearance: (pm: PM) =>
    coerceDiagramAppearance<any, GsnDiagramType<TV>, TV>(M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm)),
}) as GsnClass<TV>;

const dtc = DiagramTypeClass_CausalType<TV>(cls);
const ecls = Avatar_Element<CausalType<TV>, TV>(dtc);
type D = CausalNet<TV>;

const causal = (c: Causal<TV>): TV => review(_CausalItem, c);

// ---------------------------------------------------------------------------------------------
// Example files

const examplesDir = path.resolve(__dirname, "../../share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

// ---------------------------------------------------------------------------------------------
// Helpers for running edits, scripts and Deltas

function edit<A>(st: ModelEditState<TV>, act: (c: any) => A, prsm: Prism<TV, any> = identity<TV>()): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, prsm, st, act);
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

const entity = (st: ModelEditState<TV>, uuid: ModelId): Entity<TV> => {
  const e = M.lookup(uuid, st.stateModel.modelContents);
  if (e.tag === "Nothing") throw new Error("missing " + uuid);
  return e.value;
};
const childNames = (st: ModelEditState<TV>, uuid: ModelId): string[] => M.keys(entity(st, uuid)._entityChildren).map((n) => n._0);
const nameOf = (st: ModelEditState<TV>, uuid: ModelId): string => view(tvName, entity(st, uuid)._entityContents)._0;

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

/** Run a Delta on the diagram `diagId` with the given contents, in a script on the causal subtype. */
function inDelta<A>(
  st: ModelEditState<TV>,
  diagId: ModelId,
  diagram: Diagram<D>,
  f: (d: DeltaCtx<D>, c: ModelEditCtx<TV, Causal<TV>>) => A,
): [A, ModelEditState<TV>, DeltaCtx<D>] {
  let dOut: DeltaCtx<D> | null = null;
  const [r, st2] = edit(st, (c) => {
    const d = new DeltaCtx(ecls, { state: mkDiagramState(GenericContext(diagId, mempty_AppearanceDef), 1, diagram) });
    d.base = c;
    dOut = d;
    return f(d, c);
  }, _CausalItem);
  return [r, st2, dOut!];
}

const emptyDiagramEntity = (nm: string) =>
  CausalDiagram<TV>(DiagramEntity(Name(nm), diagramFromList(ecls, []), mempty_DiagramAppearance));

interface Fixture {
  st: ModelEditState<TV>;
  ids: Record<string, ModelId>;
}

/**
 * A small causal model:
 *
 * * Package "System" with component "Alarm" (states Armed, Off (hidden); events Smoke, Fire (mishap),
 *   Sprinkler (control, hidden); logic Count 1 (≥2), AND-1 (state), OR-1 (event), AND-2 (event, hidden);
 *   edges Sequence-1 (Armed → Smoke), Trigger-1, Guard-1 (inhibiting); diagram "Alarm Diagram"),
 * * component "Building" (instance "Alarm 1" of Alarm, event Evacuate, diagram "Building Diagram"),
 * * a GSN goal "G1" and evidence "Report" in the package.
 */
function fixture(): Fixture {
  const st0 = modelStartState<TV>(newGenerator(), emptyModel<TV>(cls, "Test"));
  const [ids, st] = edit(st0, (c: ModelEditCtx<TV, TV>) => {
    const out: Record<string, ModelId> = {};
    const add = (key: string, parent: ModelId, v: TV): Entity<TV> => {
      goToEntity(c, parent);
      const e = mkEntity(c, v);
      out[key] = e.entityId;
      return e;
    };
    const pkg = mkPackage(c, Name("System"));
    out.pkg = pkg;
    const alarm = add("alarm", pkg, causal(CausalComponent(ComponentModel(Name("Alarm")))));
    add("armed", alarm.entityId, causal(CausalState(State(Name("Armed"), "Ready to detect.", false))));
    add("off", alarm.entityId, causal(CausalState(State(Name("Off"), "", true))));
    add("smoke", alarm.entityId, causal(CausalEvent(Event("SimpleEvent", Name("Smoke"), "Smoke in the room.", false))));
    add("fire", alarm.entityId, causal(CausalEvent(Event("MishapEvent", Name("Fire"), "", false))));
    add("sprinkler", alarm.entityId, causal(CausalEvent(Event("ControlEvent", Name("Sprinkler"), "", true))));
    add("count", alarm.entityId, causal(CausalLogic(Logic(LogicCountState(2), Name("Count 1"), false))));
    add("andS", alarm.entityId, causal(CausalLogic(Logic(LogicAndState, Name("AND-1"), false))));
    add("orE", alarm.entityId, causal(CausalLogic(Logic(LogicOrEvent, Name("OR-1"), false))));
    add("andE", alarm.entityId, causal(CausalLogic(Logic(LogicAndEvent, Name("AND-2"), true))));
    add("seq", alarm.entityId, causal(CausalEdge(TemporalEdge(Name("Sequence-1")))));
    add("trig", alarm.entityId, causal(CausalEdge(TriggerEdge(Name("Trigger-1")))));
    add("guard", alarm.entityId, causal(CausalEdge(GuardEdge(Name("Guard-1"), true))));
    add("alarmDiag", alarm.entityId, causal(emptyDiagramEntity("Alarm Diagram")));
    const building = add("building", pkg, causal(CausalComponent(ComponentModel(Name("Building")))));
    const inst = add("inst", building.entityId, causal(CausalInstance(Instance(Name("Alarm 1")))));
    addCheckedRelation(c, componentInstanceRelation, inst, alarm);
    add("evacuate", building.entityId, causal(CausalEvent(Event("SimpleEvent", Name("Evacuate"), "", false))));
    add("buildingDiag", building.entityId, causal(emptyDiagramEntity("Building Diagram")));
    add("goal", pkg, review(_GsnItem, GsnNodeItem<TV>(Goal(Name("G1"), "The building is safe.", true, true))));
    add("evidence", pkg, review(_Ev, Evidence(Name("Report"))));
    const rel = (edge: string, from: string, to: string) => {
      modifyRelations(c, (r) => NR.insert(out[edge], out[from], NR.edgeFromRelation, r));
      modifyRelations(c, (r) => NR.insert(out[edge], out[to], NR.edgeToRelation, r));
    };
    rel("seq", "armed", "smoke");
    rel("trig", "smoke", "orE");
    rel("guard", "off", "orE");
    return out;
  });
  return { st, ids };
}

// ---------------------------------------------------------------------------------------------

describe("event types", () => {
  it("names the event types and their variants", () => {
    expect(eventTypeValues).toEqual([SimpleEvent, MishapEvent, ControlEvent]);
    expect(eventTypeValues.map(eventTypeName)).toEqual(["Simple Event", "Mishap Event", "Control Event"]);
    expect(eventTypeValues.map(show_EventType)).toEqual(["Simple Event", "Mishap Event", "Control Event"]);
    expect(eventTypeValues.map(eventTypeJson)).toEqual(["Simple EventEvent", "Mishap EventEvent", "Control EventEvent"]);
    expect(eventVariants).toEqual(["Simple Event", "Mishap Event", "Control Event"]);
  });

  it("encodes event types as aeson does", () => {
    expect(JSON_EventType.toJSON("MishapEvent")).toBe("Mishap EventEvent");
    for (const t of eventTypeValues) expect(JSON_EventType.parseJSON(JSON_EventType.toJSON(t))).toBe(t);
    expect(J.parseEither((v) => JSON_EventType.parseJSON(v), "SimpleEvent")).toEqual(Left('Not an Event type: "SimpleEvent"'));
    expect(J.parseEither((v) => JSON_EventType.parseJSON(v), 3).tag).toBe("Left");
  });
});

describe("JSON of the entities", () => {
  it("encodes events", () => {
    const e = Event("ControlEvent", Name("Sprinkler"), "Water", true);
    const js = { type: "Control EventEvent", name: "Sprinkler", text: "Water", hidden: true };
    expect(JSON_Event.toJSON(e)).toEqual(js);
    expect(JSON_Event.parseJSON(js)).toEqual(e);
    // Every field is required.
    expect(J.parseEither((v) => JSON_Event.parseJSON(v), { type: "Simple EventEvent", name: "E", text: "" }).tag).toBe("Left");
  });

  it("encodes states, with an optional hidden flag", () => {
    const s = State(Name("Armed"), "Ready", false);
    expect(JSON_State.toJSON(s)).toEqual({ type: "State", name: "Armed", text: "Ready", hidden: false });
    expect(JSON_State.parseJSON({ type: "State", name: "Armed", text: "Ready" })).toEqual(s);
    expect(JSON_State.parseJSON({ type: "State", name: "A", text: "", hidden: true })).toEqual(State(Name("A"), "", true));
    expect(J.parseEither((v) => JSON_State.parseJSON(v), { type: "Event", name: "A", text: "" }))
      .toEqual(Left('Type = "Event", expected "State"'));
  });

  it("encodes logic elements", () => {
    expect(JSON_Logic.toJSON(Logic(LogicCountState(3), Name("Count 1"), false)))
      .toEqual({ name: "Count 1", hidden: false, type: "LogicCountState", n: 3 });
    expect(JSON_Logic.toJSON(Logic(LogicAndState, Name("AND-1"), true)))
      .toEqual({ name: "AND-1", hidden: true, type: "LogicAndState" });
    expect((JSON_Logic.toJSON(Logic(LogicOrEvent, Name("OR-1"), false)) as J.JSONObject).type).toBe("LogicOrEvent");
    for (const t of [LogicCountState(0), LogicCountState(-2), LogicAndState, LogicAndEvent, LogicOrEvent]) {
      const l = Logic(t, Name("X"), true);
      expect(JSON_Logic.parseJSON(JSON_Logic.toJSON(l))).toEqual(l);
    }
    // The type is read with "readMaybe", so the derived Read syntax is accepted too.
    expect(JSON_Logic.parseJSON({ name: "L", hidden: false, type: " ( LogicAndEvent ) " })).toEqual(Logic(LogicAndEvent, Name("L"), false));
    expect(JSON_Logic.parseJSON({ name: "L", hidden: false, type: "LogicCountState 4" })).toEqual(Logic(LogicCountState(4), Name("L"), false));
    expect(J.parseEither((v) => JSON_Logic.parseJSON(v), { name: "L", hidden: false, type: "LogicNand" }))
      .toEqual(Left("Unrecognised logic element type"));
    expect(J.parseEither((v) => JSON_Logic.parseJSON(v), { name: "L", hidden: false, type: "LogicCountState" }).tag).toBe("Left");
    expect(J.parseEither((v) => JSON_Logic.parseJSON(v), { name: "L", type: "LogicAndState" }).tag).toBe("Left");
  });

  it("shows and reads logic types as the derived instances do", () => {
    expect(show_LogicType(LogicCountState(2))).toBe("LogicCountState 2");
    expect(show_LogicType(LogicCountState(-2))).toBe("LogicCountState (-2)");
    expect(show_LogicType(LogicOrEvent)).toBe("LogicOrEvent");
    for (const t of [LogicCountState(0), LogicCountState(17), LogicCountState(-5), LogicAndState, LogicAndEvent, LogicOrEvent]) {
      expect(read_LogicType(show_LogicType(t))).toEqual(Just(t));
    }
    expect(read_LogicType("(LogicCountState (7))")).toEqual(Just(LogicCountState(7)));
    expect(read_LogicType("LogicCountState 0x10")).toEqual(Just(LogicCountState(16)));
    expect(read_LogicType("LogicCountState -1")).toEqual(Nothing); // Needs parentheses, as in Haskell.
    expect(read_LogicType("LogicCountState")).toEqual(Nothing);
    expect(read_LogicType("LogicCountState 1.5")).toEqual(Nothing);
    expect(read_LogicType("LogicCountState3")).toEqual(Nothing);
    expect(read_LogicType("logicAndState")).toEqual(Nothing);
  });

  it("encodes instances, edges and components", () => {
    expect(JSON_Instance.toJSON(Instance(Name("Alarm 1")))).toEqual({ type: "instance", name: "Alarm 1" });
    expect(JSON_Instance.parseJSON({ type: "instance", name: "I" })).toEqual(Instance(Name("I")));
    const edges: [Edge, object][] = [
      [TemporalEdge(Name("S")), { type: "TemporalEdge", name: "S" }],
      [TriggerEdge(Name("T")), { type: "TriggerEdge", name: "T" }],
      [GuardEdge(Name("G"), true), { type: "GuardEdge", name: "G", inhibit: true }],
    ];
    for (const [e, js] of edges) {
      expect(JSON_Edge.toJSON(e)).toEqual(js);
      expect(JSON_Edge.parseJSON(js as J.Value)).toEqual(e);
    }
    expect(J.parseEither((v) => JSON_Edge.parseJSON(v), { type: "GuardEdge", name: "G" }).tag).toBe("Left");
    expect(J.parseEither((v) => JSON_Edge.parseJSON(v), { type: "HazardEdge", name: "G" })).toEqual(Left("Not an edge type: HazardEdge"));
    expect(JSON_ComponentModel.toJSON(ComponentModel(Name("Alarm")))).toEqual({ type: "CausalComponent", name: "Alarm" });
    expect(JSON_ComponentModel.parseJSON({ type: "CausalComponent", name: "C" })).toEqual(ComponentModel(Name("C")));
  });

  it("encodes box and arrow types with Show and reads them with Read", () => {
    expect(boxTypeValues.map((b) => JSON_BoxType.toJSON(b))).toEqual(boxTypeValues);
    for (const b of boxTypeValues) expect(JSON_BoxType.parseJSON(b)).toBe(b);
    expect(JSON_BoxType.parseJSON(" (StateBox) ")).toBe("StateBox");
    expect(J.parseEither((v) => JSON_BoxType.parseJSON(v), "Goal")).toEqual(Left('Not a Causal Box type: "Goal"'));
    expect(arrowTypeValues.map((a) => JSON_ArrowType.toJSON(a))).toEqual(arrowTypeValues);
    for (const a of arrowTypeValues) expect(JSON_ArrowType.parseJSON(a)).toBe(a);
    expect(J.parseEither((v) => JSON_ArrowType.parseJSON(v), "Trace")).toEqual(Left('Not a Causal Arrow type: "Trace"'));
    expect(read_BoxType("((GoalBox))")).toEqual(Just("GoalBox"));
    expect(read_BoxType("Goal Box")).toEqual(Nothing);
    expect(read_ArrowType("TraceArrow ")).toEqual(Just("TraceArrow"));
  });

  it("tells the causal variants apart", () => {
    const codec = JSON_Causal(cls);
    const items: Causal<TV>[] = [
      CausalEvent(Event("MishapEvent", Name("Fire"), "", false)),
      CausalState(State(Name("Armed"), "", true)),
      CausalLogic(Logic(LogicAndState, Name("AND-1"), false)),
      CausalLogic(Logic(LogicCountState(2), Name("Count 1"), false)),
      CausalInstance(Instance(Name("Alarm 1"))),
      CausalEdge(TemporalEdge(Name("Sequence-1"))),
      CausalEdge(GuardEdge(Name("Guard-1"), false)),
      CausalComponent(ComponentModel(Name("Alarm"))),
      emptyDiagramEntity("Diagram 1"),
    ];
    for (const i of items) {
      const js = codec.toJSON(i);
      const back = codec.parseJSON(js);
      expect(back.tag).toBe(i.tag);
      expect(eq_Causal(back, i)).toBe(true);
      expect(codec.toJSON(back)).toEqual(js);
    }
    expect(codec.toJSON(emptyDiagramEntity("D"))).toEqual({
      name: "D", type: "Causal Net Diagram", contents: [], appearance: { arrowNames: null, fields: [], highlights: [] },
    });
    // A version 0.5 diagram (no type) is read as a causal diagram; other diagram types are not.
    expect(codec.parseJSON({ name: "Old", contents: [] }).tag).toBe("CausalDiagram");
    expect(() => codec.parseJSON({ name: "D", type: "GSN Diagram", contents: [] })).toThrow();
  });

  it("parses none of the entities in the example models as causal", () => {
    const codec = JSON_Causal(cls);
    let n = 0;
    for (const [, m] of examples) {
      for (const e of m.modelContents as any[]) {
        n++;
        expect(J.parseEither((v) => codec.parseJSON(v), e.contents).tag, JSON.stringify(e.contents).slice(0, 80)).toBe("Left");
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it.each(examples.map(([f]) => [f]))("loads the example model %s and writes its entities back unchanged", (f) => {
    const js = examples.find(([n]) => n === f)![1];
    const codec = JSON_Model<TV>(cls);
    const model = codec.parseJSON(js);
    expect(M.elems(model.modelContents).filter((e) => e._entityContents.tag === "CausalItem")).toEqual([]);
    const out = codec.toJSON(model) as any;
    // Package appearances in old files are migrated (field names to field ids), so packages are
    // only compared by name and type. Everything else is written back as it was read.
    const sorted = (x: any) => [...(x.modelContents as any[])].sort((a, b) => (a.identity < b.identity ? -1 : 1))
      .map((e: any) => (e.contents?.type === "package" ? { type: "package", name: e.contents.name } : e.contents));
    expect(sorted(out)).toEqual(sorted(js));
    expect(codec.toJSON(codec.parseJSON(out))).toEqual(out); // Stable once migrated.
  });

  it("round trips a whole causal model with diagrams", () => {
    const { st, ids } = fixture();
    // Put some boxes and an arrow on the Building diagram.
    const bb = BoundBox(Point(10, 10), Point(210, 110));
    const instBox = dtc.mkBox("4a6c1b2e-0000-4000-8000-000000000001", ids.inst, "InstanceBox", Nothing, bb);
    const evBox = dtc.mkBox("4a6c1b2e-0000-4000-8000-000000000002", ids.evacuate, "EventBox", Nothing,
      BoundBox(Point(400, 10), Point(600, 110)));
    const arrow = ElemArrow(Arrow<CausalType<TV>, TV>("4a6c1b2e-0000-4000-8000-000000000003", ids.trig, "TriggerArrow",
      LineShape([Connected(Point(210, 50), instBox.boxId, Just(ids.fire)), Connected(Point(400, 60), evBox.boxId, Nothing)], [Point(300, 55)])));
    const [, st2] = edit(st, (c: ModelEditCtx<TV, TV>) => {
      goToEntity(c, ids.buildingDiag);
      const e = current(c);
      if (e.tag === "Nothing") throw new Error("no diagram");
      const v = e.value._entityContents;
      if (v.tag !== "CausalItem" || v._0.tag !== "CausalDiagram") throw new Error("not a diagram");
      const de = { ...v._0._0, _diagramEntityContents: diagramFromList(ecls, [ElemBox(instBox), ElemBox(evBox), arrow]) };
      c.state = {
        ...c.state,
        stateModel: {
          ...c.state.stateModel,
          modelContents: M.insert(ids.buildingDiag, { ...e.value, _entityContents: causal(CausalDiagram(de)) }, c.state.stateModel.modelContents),
        },
      };
    });
    const codec = JSON_Model<TV>(cls);
    const js = codec.toJSON(st2.stateModel) as any;
    const diagJs = (js.modelContents as any[]).find((e) => e.identity === ids.buildingDiag).contents;
    expect(diagJs.type).toBe("Causal Net Diagram");
    expect(diagJs.contents.map((x: any) => x.type).sort()).toEqual(["EventBox", "InstanceBox", "TriggerArrow"]);
    const boxJs = diagJs.contents.find((x: any) => x.type === "InstanceBox");
    expect(boxJs).toEqual({ boxId: instBox.boxId, entity: ids.inst, type: "InstanceBox", peg: null, shape: { p1: { x: 10, y: 10 }, p2: { x: 210, y: 110 } } });
    const contentsOf = (id: string) => (js.modelContents as any[]).find((e) => e.identity === id).contents;
    expect(contentsOf(ids.count)).toEqual({ name: "Count 1", hidden: false, type: "LogicCountState", n: 2 });
    expect(contentsOf(ids.alarm)).toEqual({ type: "CausalComponent", name: "Alarm" });
    expect(contentsOf(ids.inst)).toEqual({ type: "instance", name: "Alarm 1" });
    const back = codec.parseJSON(JSON.parse(JSON.stringify(js)));
    expect(codec.toJSON(back)).toEqual(js);
    const backDiag = M.lookup(ids.buildingDiag, back.modelContents);
    const origDiag = M.lookup(ids.buildingDiag, st2.stateModel.modelContents);
    if (backDiag.tag === "Nothing" || origDiag.tag === "Nothing") throw new Error("lost the diagram");
    const bc = backDiag.value._entityContents, oc = origDiag.value._entityContents;
    expect(bc.tag === "CausalItem" && oc.tag === "CausalItem" && eq_Causal(bc._0, oc._0)).toBe(true);
    expect(NR.member(ids.inst, ids.alarm, componentInstanceRelation, back.modelRelations)).toBe(true);
  });
});

describe("Reflective", () => {
  const refl = Reflective_Causal(cls);
  const ev = CausalEvent<TV>(Event("SimpleEvent", Name("Smoke"), "In the room", false));
  const st = CausalState<TV>(State(Name("Armed"), "Ready", true));
  const cnt = CausalLogic<TV>(Logic(LogicCountState(2), Name("Count 1"), false));
  const orE = CausalLogic<TV>(Logic(LogicOrEvent, Name("OR-1"), true));
  const inst = CausalInstance<TV>(Instance(Name("Alarm 1")));
  const guard = CausalEdge<TV>(GuardEdge(Name("Guard-1"), true));
  const trig = CausalEdge<TV>(TriggerEdge(Name("Trigger-1")));
  const comp = CausalComponent<TV>(ComponentModel(Name("Alarm")));
  const diag = emptyDiagramEntity("Alarm Diagram");

  it("names the variants", () => {
    expect([ev, st, cnt, orE, inst, guard, trig, comp, diag].map((i) => refl.reflectiveName(i))).toEqual([
      "Simple Event", "State", "State Logic", "Event Logic", "Instance", "Guard Arrow", "Trigger Arrow",
      "Component", "Causal Diagram",
    ]);
    expect(refl.reflectiveDefaults.map((i) => refl.reflectiveName(i))).toEqual([
      "Simple Event", "Mishap Event", "Control Event", "State", "Component", "Causal Diagram",
      "State Logic", "State Logic", "Event Logic", "Event Logic",
      "Sequence Arrow", "Trigger Arrow", "Guard Arrow",
    ]);
    expect(refl.reflectiveDefaults[6]).toEqual(CausalLogic(Logic(LogicCountState(1), Name(""), false)));
    expect(refl.reflectiveDefaults).toBe(refl.reflectiveDefaults); // Memoised.
    expect(Reflective_Causal(cls)).toBe(refl);
  });

  it("gets the built-in fields", () => {
    expect(refl.reflectiveBuiltIn(ev)).toEqual([nameField, descriptionField, hiddenField]);
    expect(refl.reflectiveBuiltIn(st)).toEqual([nameField, descriptionField, hiddenField]);
    expect(refl.reflectiveBuiltIn(cnt)).toEqual([nameField, countField, hiddenField]);
    expect(refl.reflectiveBuiltIn(orE)).toEqual([nameField, hiddenField]);
    expect(refl.reflectiveBuiltIn(guard)).toEqual([nameField, inhibitField]);
    expect([inst, trig, comp, diag].map((i) => refl.reflectiveBuiltIn(i))).toEqual([[nameField], [nameField], [nameField], [nameField]]);
    expect(refl.reflectiveGet(ev)).toEqual(M.fromList([
      [nameField, ExtText("Smoke")], [descriptionField, ExtText("In the room")], [hiddenField, ExtBool(false)],
    ]));
    // As in Haskell, a state's hidden flag is a built-in field but is not reported.
    expect(refl.reflectiveGet(st)).toEqual(M.fromList([[nameField, ExtText("Armed")], [descriptionField, ExtText("Ready")]]));
    expect(refl.reflectiveGet(cnt)).toEqual(M.fromList([[nameField, ExtText("Count 1")], [countField, ExtInt(2)], [hiddenField, ExtBool(false)]]));
    expect(refl.reflectiveGet(orE)).toEqual(M.fromList([[nameField, ExtText("OR-1")], [hiddenField, ExtBool(true)]]));
    expect(refl.reflectiveGet(guard)).toEqual(M.fromList([[nameField, ExtText("Guard-1")], [inhibitField, ExtBool(true)]]));
    expect(refl.reflectiveGet(trig)).toEqual(M.singleton(nameField, ExtText("Trigger-1")));
    expect(refl.reflectiveGet(inst)).toEqual(M.singleton(nameField, ExtText("Alarm 1")));
    expect(refl.reflectiveGet(comp)).toEqual(M.singleton(nameField, ExtText("Alarm")));
    expect(refl.reflectiveGet(diag)).toEqual(M.singleton(nameField, ExtText("Alarm Diagram")));
  });

  it("sets the built-in fields, stripping names", () => {
    const run = (vals: [string, any][], item: Causal<TV>): [Causal<TV>, string[]] => {
      const cell = { state: M.fromList(vals) };
      const r = refl.reflectiveSet(cell, item);
      return [r, M.keys(cell.state)];
    };
    expect(run([[nameField, ExtText(" Heat ")], [descriptionField, ExtText("d")], [hiddenField, ExtBool(true)], ["x", ExtText("y")]], ev))
      .toEqual([CausalEvent(Event("SimpleEvent", Name("Heat"), "d", true)), ["x"]]);
    expect(run([[hiddenField, ExtBool(false)]], st)).toEqual([CausalState(State(Name("Armed"), "Ready", false)), []]);
    expect(run([[countField, ExtInt(5)], [nameField, ExtText(" C ")]], cnt))
      .toEqual([CausalLogic(Logic(LogicCountState(5), Name("C"), false)), []]);
    expect(run([[countField, ExtInt(5)]], orE)).toEqual([orE, [countField]]); // No count for event logic.
    expect(run([[inhibitField, ExtBool(false)], [nameField, ExtText("G ")]], guard)).toEqual([CausalEdge(GuardEdge(Name("G"), false)), []]);
    expect(run([[inhibitField, ExtBool(false)], [nameField, ExtText(" T")]], trig)).toEqual([CausalEdge(TriggerEdge(Name("T"))), [inhibitField]]);
    expect(run([[nameField, ExtText(" Alarm 2 ")]], inst)).toEqual([CausalInstance(Instance(Name("Alarm 2"))), []]);
    expect(run([[nameField, ExtText(" Fire alarm")]], comp)).toEqual([CausalComponent(ComponentModel(Name("Fire alarm"))), []]);
    const [d2] = run([[nameField, ExtText(" Renamed  ")]], diag);
    expect(d2.tag === "CausalDiagram" && d2._0._diagramEntityName).toEqual(Name("Renamed"));
    expect(run([[nameField, ExtInt(3)]], ev)[0]).toEqual(ev); // Wrong type: keep the old value.
  });

  it("declares the reference types and arrows", () => {
    const states = ["State", "Simple Event", "Mishap Event", "Control Event"];
    const expected = [
      arrowRelations("Sequence Arrow", states, states),
      arrowRelations("Trigger Arrow", ["Event Logic", ...eventVariants], ["Event Logic", ...eventVariants]),
      arrowRelations("Guard Arrow", ["State", "State Logic"], ["State Logic", ...eventVariants]),
      mkOneToMany(arrowHeadInstance, ["Instance"], ["Trigger Arrow", "Guard Arrow"]),
      mkOneToMany(arrowTailInstance, ["Instance"], ["Trigger Arrow", "Guard Arrow"]),
      traceArrowRelations(states, ["Goal", "Evidence"]),
      mkOneToMany(componentInstanceRelation, ["Component"], ["Instance"]),
    ].reduceRight((acc, t) => append_RefTypeTable(t, acc));
    expect(refl.reflectiveBuiltInRefs).toEqual(expected);
    expect(refl.reflectiveArrows).toEqual(M.fromList([
      ["Sequence Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
      ["Trigger Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
      ["Guard Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
      ["Hazard Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
    ]));
  });

  it("has a hand-written Eq", () => {
    expect(eq_Causal(ev, CausalEvent(Event("SimpleEvent", Name("Smoke"), "In the room", false)))).toBe(true);
    expect(eq_Causal(ev, CausalEvent(Event("MishapEvent", Name("Smoke"), "In the room", false)))).toBe(false);
    expect(eq_Causal(diag, emptyDiagramEntity("Alarm Diagram"))).toBe(true);
    expect(eq_Causal(diag, emptyDiagramEntity("Other"))).toBe(false);
    expect(eq_Causal(comp, inst)).toBe(false);
  });
});

describe("entities, optics and small functions", () => {
  it("has lenses and traversals", () => {
    const e = Event("SimpleEvent", Name("E"), "t", false);
    expect([view(eventName, e), view(eventText, e), view(eventHidden, e), eventType(e)]).toEqual([Name("E"), "t", false, "SimpleEvent"]);
    expect(set(eventHidden, true, e)).toEqual(Event("SimpleEvent", Name("E"), "t", true));
    const s = State(Name("S"), "t", false);
    expect(set(stateText, "u", set(stateName, Name("T"), s))).toEqual(State(Name("T"), "u", false));
    expect(view(stateHidden, s)).toBe(false);
    const cnt = Logic(LogicCountState(2), Name("C"), false);
    expect(toListOf(logicCount, cnt)).toEqual([2]);
    expect(over(logicCount, (n) => n + 1, cnt)).toEqual(Logic(LogicCountState(3), Name("C"), false));
    const and = Logic(LogicAndState, Name("A"), false);
    expect(toListOf(logicCount, and)).toEqual([]);
    expect(set(logicCount, 5, and)).toEqual(and);
    expect(logicType(and)).toEqual(LogicAndState);
    expect(set(logicHidden, true, set(logicName, Name("B"), and))).toEqual(Logic(LogicAndState, Name("B"), true));
    expect(set(instanceName, Name("J"), Instance(Name("I")))).toEqual(Instance(Name("J")));
    expect(toListOf(edgeInhibit, GuardEdge(Name("G"), true))).toEqual([true]);
    expect(set(edgeInhibit, false, GuardEdge(Name("G"), true))).toEqual(GuardEdge(Name("G"), false));
    expect(set(edgeInhibit, true, TemporalEdge(Name("T")))).toEqual(TemporalEdge(Name("T")));
    expect(set(edgeName, Name("U"), GuardEdge(Name("G"), true))).toEqual(GuardEdge(Name("U"), true));
    expect(view(componentName<TV>(), ComponentModel(Name("C")))).toEqual(Name("C"));
    expect(review(componentName<TV>(), Name("D"))).toEqual(ComponentModel(Name("D")));
  });

  it("classifies logic and edges", () => {
    const ts = [LogicCountState(1), LogicAndState, LogicAndEvent, LogicOrEvent];
    expect(ts.map(logicIsState)).toEqual([true, true, false, false]);
    expect(ts.map(logicIsEvent)).toEqual([false, false, true, true]);
    expect(ts.map((t) => logicTypeName(t))).toEqual(["State Logic", "State Logic", "Event Logic", "Event Logic"]);
    expect([TemporalEdge(Name("a")), TriggerEdge(Name("a")), GuardEdge(Name("a"), false)].map((e) => edgeTypeName(e)))
      .toEqual(["Sequence Arrow", "Trigger Arrow", "Guard Arrow"]);
  });

  const all: Causal<TV>[] = [
    CausalEvent(Event("SimpleEvent", Name("E1"), "", false)),
    CausalEvent(Event("MishapEvent", Name("E2"), "", true)),
    CausalEvent(Event("ControlEvent", Name("E3"), "", false)),
    CausalState(State(Name("S1"), "", false)),
    CausalState(State(Name("S2"), "", true)),
    CausalLogic(Logic(LogicCountState(1), Name("L1"), false)),
    CausalLogic(Logic(LogicAndState, Name("L2"), true)),
    CausalLogic(Logic(LogicAndEvent, Name("L3"), false)),
    CausalLogic(Logic(LogicOrEvent, Name("L4"), false)),
    CausalInstance(Instance(Name("I1"))),
    CausalEdge(TemporalEdge(Name("T1"))),
    CausalEdge(TriggerEdge(Name("T2"))),
    CausalEdge(GuardEdge(Name("T3"), false)),
    CausalComponent(ComponentModel(Name("C1"))),
    emptyDiagramEntity("D1"),
  ];

  it("names every causal entity", () => {
    expect(all.map((c) => view(causalName<TV>(), c)._0)).toEqual(
      ["E1", "E2", "E3", "S1", "S2", "L1", "L2", "L3", "L4", "I1", "T1", "T2", "T3", "C1", "D1"]);
    const renamed = all.map((c) => set(causalName<TV>(), Name("X"), c));
    expect(renamed.map((c) => view(causalName<TV>(), c)._0)).toEqual(all.map(() => "X"));
    expect(renamed.map((c) => c.tag)).toEqual(all.map((c) => c.tag));
  });

  it("knows what is exported, movable and a diagram", () => {
    expect(all.map(causalExported)).toEqual([true, false, true, true, false, true, false, true, true,
      false, false, false, false, false, false]);
    expect(all.map(causalCanMove)).toEqual(all.map((c) => c.tag === "CausalComponent"));
    expect(all.map(causalIsDiagram)).toEqual(all.map((c) => c.tag === "CausalDiagram"));
  });

  it("has icons and symbols", () => {
    expect(all.map(causalIcon)).toEqual([
      "causal_event", "causal_event_mishap", "causal_event_control", "causal_state", "causal_state",
      "causal_logic_count", "causal_logic_state_and", "causal_logic_event_and", "causal_logic_event_or",
      "causal_instance", "causal_temporal", "causal_trigger", "causal_guard", "causal_component", "causal_diagram",
    ]);
    // Every icon exists in the DSM icon theme.
    const iconDir = path.resolve(__dirname, "../../share/hicolor/scalable/categories");
    for (const i of all.map(causalIcon)) expect(fs.existsSync(path.join(iconDir, i + ".svg")), i).toBe(true);
    expect(all.map((c) => symbol(c))).toEqual(["🄴 ", "🄴 ", "🄴 ", "Ⓢ ", "Ⓢ ", "Ⓢ ", "Ⓢ ", "🄴 ", "🄴 ", "", "", "", "", "", ""]);
  });

  it("has prisms for every variant", () => {
    const prisms = [_CausalEvent<TV>(), _CausalState<TV>(), _CausalLogic<TV>(), _CausalInstance<TV>(), _CausalEdge<TV>(),
      _CausalComponent<TV>(), _CausalDiagram<TV>()];
    const tags = ["CausalEvent", "CausalState", "CausalLogic", "CausalInstance", "CausalEdge", "CausalComponent", "CausalDiagram"];
    for (const c of all) {
      expect(prisms.map((p) => preview(p as Prism<Causal<TV>, any>, c).tag)).toEqual(tags.map((t) => (t === c.tag ? "Just" : "Nothing")));
    }
    expect(review(_CausalState<TV>(), State(Name("S"), "", false))).toEqual(CausalState(State(Name("S"), "", false)));
  });

  it("lets components have their elements and traces as children", () => {
    const tvs: TV[] = [...all.map(causal), review(_Tr, Trace(Name("T"))), review(_Ev, Evidence(Name("E"))),
      { tag: "Package", _0: Package(Name("P"), M.empty()) }];
    expect(tvs.map((v) => componentCanHaveChild(cls, _CausalItem, v))).toEqual([
      true, true, true, true, true, true, true, true, true, true, true, true, true, false, true, true, false, false]);
  });

  it("lists the entity types of causal diagrams", () => {
    expect(causalDiagramEntityTypes).toEqual(M.singleton("Causal Diagram", [
      "Simple Event", "Mishap Event", "Control Event", "State", "State Logic", "Event Logic", "Evidence", "Instance"]));
  });
});

describe("childBoxes", () => {
  const take = (n: number, g: Generator<BoundBoxT>): BoundBoxT[] => Array.from({ length: n }, () => g.next().value);
  const step = hadesFontSize * 1.5 + 2;

  it("stacks one-line boxes below the title", () => {
    const bs = take(3, childBoxes(BoundBox(Point(10, 20), Point(110, 1000))));
    const y0 = 20 + hadesFontSize * 1.5;
    expect(bs).toEqual([
      BoundBox(Point(10, y0), Point(110, y0 + step)),
      BoundBox(Point(10, y0 + step), Point(110, y0 + step + step)),
      BoundBox(Point(10, y0 + step + step), Point(110, y0 + step + step + step)),
    ]);
  });

  it("squashes the boxes at the bottom of the argument", () => {
    const bs = take(6, childBoxes(BoundBox(Point(0, 0), Point(50, 40))));
    expect(bs[0]).toEqual(BoundBox(Point(0, 13.5), Point(50, 29)));
    expect(bs[1]).toEqual(BoundBox(Point(0, 29), Point(50, 40.001)));
    for (const b of bs.slice(2)) expect(b).toEqual(BoundBox(Point(0, 40), Point(50, 40.001)));
  });

  it("gives NoBox for NoBox", () => {
    expect(take(4, childBoxes(NoBox))).toEqual([NoBox, NoBox, NoBox, NoBox]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("model edits", () => {
  it("finds the exports of an instance", () => {
    const { st, ids } = fixture();
    const [exports, st2] = edit(st, (c) => instanceExports(c, ids.inst).map((e) => e.entityId), _CausalItem);
    expect(exports.map((u) => nameOf(st, u))).toEqual(["AND-1", "Armed", "Count 1", "Fire", "OR-1", "Smoke"]);
    expect(M.elems(entity(st, ids.alarm)._entityChildren).filter((u) => exports.includes(u)).length).toBe(6);
    expect(st2.statePosition).toBe(L.last(M.elems(entity(st, ids.alarm)._entityChildren))); // The cursor is left on the last child.
    expect(edit(st, (c) => instanceExports(c, ids.alarm), _CausalItem)[0]).toEqual([]);
    expect(edit(st, (c) => instanceExports(c, ids.evacuate), _CausalItem)[0]).toEqual([]);
  });

  it("converts old style component diagrams into components", () => {
    const { st, ids } = fixture();
    const [oldId, st1] = edit(st, (c: ModelEditCtx<TV, TV>) => {
      goToEntity(c, ids.pkg);
      const sub = mkPackage(c, Name("Old models"));
      goToEntity(c, sub);
      return mkEntity(c, causal(emptyDiagramEntity("Pump"))).entityId;
    });
    const [, st2] = edit(st1, (c) => {
      goToEntity(c, ids.goal);
      fixOldComponents(cls, c);
    }, _CausalItem);
    const comp = entity(st2, oldId)._entityContents;
    expect(comp).toEqual(causal(CausalComponent(ComponentModel(Name("Pump")))));
    expect(childNames(st2, oldId)).toEqual(["Pump Diagram"]);
    const newDiag = entity(st2, M.elems(entity(st2, oldId)._entityChildren)[0])._entityContents;
    expect(newDiag.tag === "CausalItem" && newDiag._0.tag).toBe("CausalDiagram");
    expect(st2.statePosition).toBe(ids.goal); // fromHere
    // Diagrams already inside components are left alone.
    expect(entity(st2, ids.alarmDiag)._entityContents).toEqual(entity(st, ids.alarmDiag)._entityContents);
    expect(childNames(st2, ids.alarm)).toEqual(childNames(st, ids.alarm));
  });
});

describe("the DiagramTypeClass instance", () => {
  it("is cached and inherits the model dictionary", () => {
    expect(DiagramTypeClass_CausalType(cls)).toBe(dtc);
    expect(dtc._Causal).toBe(_CausalItem);
    expect(dtc.diagramTypeName(undefined as any)).toBe("Causal Net");
    expect(Avatar_Element(dtc)).toBe(ecls);
    expect(ecls.itemType(undefined as any)).toBe("Causal Net");
  });

  it("makes boxes of the right shapes", () => {
    const bb = BoundBox(Point(0, 0), Point(100, 50));
    expect(boxTypeValues.map((t) => dtc.mkBox("d", "m", t, Nothing, bb).boxShapeClass)).toEqual([
      BoxShapeClass_Oval, BoxShapeClass_Parallelogram, BoxShapeClass_Diamond, BoxShapeClass_Rectangle,
      BoxShapeClass_Rectangle, BoxShapeClass_Rectangle, BoxShapeClass_Rectangle]);
    const b = dtc.mkBox("d", "m", "StateBox", Just(["a", 0.5] as const), bb);
    expect([b.boxId, b.boxEntity, b.boxType, b._boxPeg]).toEqual(["d", "m", "StateBox", Just(["a", 0.5])]);
    expect(b.boxShape).toEqual(Oval(bb));
  });

  it("describes the arrows", () => {
    expect(arrowTypeValues.map((a) => dtc.arrowTailRelation(a))).toEqual(["Arrow Tail", "Arrow Tail", "Arrow Tail", "Arrow Tail", "Trace Tail"]);
    expect(arrowTypeValues.map((a) => dtc.arrowHeadRelation(a))).toEqual(["Arrow Head", "Arrow Head", "Arrow Head", "Arrow Head", "Trace Head"]);
    expect(arrowTypeValues.map((a) => dtc.arrowTailExportRelation(a))).toEqual(arrowTypeValues.map(() => Just(arrowTailInstance)));
    expect(arrowTypeValues.map((a) => dtc.arrowHeadExportRelation(a))).toEqual(arrowTypeValues.map(() => Just(arrowHeadInstance)));
    expect(arrowTypeValues.map((a) => dtc.arrowLineDashes(a))).toEqual([[], [], [], [], traceArrowDash]);
    expect(arrowTypeValues.map((a) => dtc.arrowDecorations(Nothing, a))).toEqual([[], [], [], [], []]);
    const head = (w: Maybe<Causal<TV>>, a: ArrowType) => dtc.arrowHeadDraw(w, a);
    expect(head(Nothing, "TemporalArrow").arrowHeadLength).toBe(0); // Open arrow head.
    expect(head(Nothing, "TemporalArrow").arrowHeadWidth).toBeCloseTo(20 * Math.tan(Math.PI / 8), 10);
    expect(head(Nothing, "TriggerArrow").arrowHeadLength).toBe(10);
    expect(head(Nothing, "GuardArrow").arrowHeadLength).toBe(10);
    expect(head(Just(CausalEdge(GuardEdge(Name("G"), true))), "GuardArrow").arrowHeadLength).toBe(20); // With the circle.
    expect(head(Just(CausalEdge(GuardEdge(Name("G"), false))), "GuardArrow").arrowHeadLength).toBe(10);
    expect(head(Nothing, "HazardArrow").arrowHeadWidth).toBeCloseTo(20, 10);
    expect(head(Nothing, "TraceArrow")).toBe(traceArrowHead);
  });

  it("has no pegs", () => {
    const { st, ids } = fixture();
    const b = dtc.mkBox("d", ids.armed, "StateBox", Nothing, NoBox);
    const [r] = inDelta(st, ids.alarmDiag, diagramFromList(ecls, []), (d) =>
      runPure(dtc.boxCanPeg(d, b, Arrow("a", "m", "TraceArrow", LineShape([Unconnected(Point(0, 0)), Unconnected(Point(1, 1))], [])))));
    expect(r).toEqual(Nothing);
  });
});

describe("avatars", () => {
  it("chooses the avatar for an entity", () => {
    const { st, ids } = fixture();
    const t = (key: string) => causalAvatarType(cls, _CausalItem, entity(st, ids[key])._entityContents).tag;
    expect(["smoke", "armed", "count", "seq", "trig", "guard", "inst", "alarm", "alarmDiag", "goal", "evidence", "pkg"].map(t))
      .toEqual(["AvatarScript", "AvatarScript", "AvatarScript", "AvatarScript", "AvatarScript", "AvatarScript",
        "AvatarScript", "AvatarScript", "NoAvatar", "SimpleBox", "SimpleBox", "NoAvatar"]);
    expect(causalAvatarType(cls, _CausalItem, entity(st, ids.goal)._entityContents)).toEqual({ tag: "SimpleBox", _0: "GoalBox" });
    expect(causalAvatarType(cls, _CausalItem, entity(st, ids.evidence)._entityContents)).toEqual({ tag: "SimpleBox", _0: "EvidenceBox" });
    expect(causalAvatarType(cls, _CausalItem, review(_Tr, Trace(Name("T"))))).toEqual({ tag: "SimpleArrow", _0: "TraceArrow" });
    // Only goals among the GSN nodes.
    expect(causalAvatarType(cls, _CausalItem, review(_GsnItem, GsnNodeItem<TV>({ tag: "Solution", _gsnNodeName: Name("S"), _gsnNodeText: "", _gsnInstantiated: true }))).tag)
      .toBe("NoAvatar");
  });

  it("creates boxes only for siblings of the diagram", () => {
    const { st, ids } = fixture();
    const [[sib, notSib, box1, box2], , d] = inDelta(st, ids.alarmDiag, diagramFromList(ecls, []), (d1) => [
      runPure(isSibling(d1, entity(st, ids.smoke))),
      runPure(isSibling(d1, entity(st, ids.evacuate))),
      runPure(createBoxAvatar(cls, d1, "EventBox", entity(st, ids.smoke), Point(300, 200))),
      runPure(createBoxAvatar(cls, d1, "EventBox", entity(st, ids.evacuate), Point(300, 200))),
    ] as const);
    expect([sib, notSib]).toEqual([true, false]);
    expect(box2).toEqual(Nothing);
    if (box1.tag !== "Just" || box1.value.tag !== "ElemBox") throw new Error("no box");
    expect(box1.value._0.boxEntity).toBe(ids.smoke);
    expect(box1.value._0.boxShape).toEqual(Parallelogram(BoundBox(Point(200, 150), Point(400, 250))));
    expect(diagramToList(view(deltaDiagram<D>(), d.state)).length).toBe(1);
  });

  it("creates arrows with avatars for both ends", () => {
    const { st, ids } = fixture();
    const [arrow, , d] = inDelta(st, ids.alarmDiag, diagramFromList(ecls, []), (d1) =>
      runPure(createArrowAvatar(cls, d1, "TemporalArrow", entity(st, ids.seq), Point(500, 300))));
    if (arrow.tag !== "Just" || arrow.value.tag !== "ElemArrow") throw new Error("no arrow");
    const items = diagramToList(view(deltaDiagram<D>(), d.state));
    const boxes = items.flatMap((x) => (x.tag === "ElemBox" ? [x._0] : []));
    expect(boxes.map((b) => [b.boxEntity, b.boxType]).sort()).toEqual([[ids.armed, "StateBox"], [ids.smoke, "EventBox"]].sort());
    const [from, to] = arrow.value._0._arrowShape._lineEnds;
    const boxFor = (e: string) => boxes.find((b) => b.boxEntity === e)!.boxId;
    expect(from.tag === "Connected" && from.connectorTarget).toBe(boxFor(ids.armed));
    expect(to.tag === "Connected" && to.connectorTarget).toBe(boxFor(ids.smoke));
    // An edge outside the diagram's component gets no avatar.
    const [none] = inDelta(st, ids.buildingDiag, diagramFromList(ecls, []), (d1) =>
      runPure(createArrowAvatar(cls, d1, "TemporalArrow", entity(st, ids.seq), Point(500, 300))));
    expect(none).toEqual(Nothing);
  });

  it("creates instances of components", () => {
    const { st, ids } = fixture();
    const [r, st2, d] = inDelta(st, ids.buildingDiag, diagramFromList(ecls, []), (d1) =>
      runPure(createInstance(cls, d1, entity(st, ids.alarm), Point(300, 200))));
    if (r.tag !== "Just" || r.value.tag !== "ElemBox") throw new Error("no box");
    const b = r.value._0;
    expect(b.boxType).toBe("InstanceBox");
    expect(b.boxShape).toEqual(Rectangle(BoundBox(Point(200, 150), Point(400, 250))));
    expect(nameOf(st2, b.boxEntity)).toBe("Alarm 2");
    expect(entity(st2, b.boxEntity)._entityParent).toBe(ids.building);
    expect(NR.member(b.boxEntity, ids.alarm, componentInstanceRelation, st2.stateModel.modelRelations)).toBe(true);
    expect(diagramToList(view(deltaDiagram<D>(), d.state)).length).toBe(1);
    // The avatar script for a component is createInstance.
    const ac = causalAvatarType(cls, _CausalItem, entity(st, ids.alarm)._entityContents);
    if (ac.tag !== "AvatarScript") throw new Error("not a script");
    const [r2, st3] = inDelta(st, ids.buildingDiag, diagramFromList(ecls, []), (d1) =>
      runPure(ac._0(d1, entity(st, ids.alarm), Point(0, 0))));
    expect(r2.tag === "Just" && r2.value.tag === "ElemBox" && nameOf(st3, r2.value._0.boxEntity)).toBe("Alarm 2");
  });
});

describe("instance boxes", () => {
  it("has a child connection point for every export", () => {
    const { st, ids } = fixture();
    const bb = BoundBox(Point(0, 0), Point(200, 300));
    const b = dtc.mkBox("ib", ids.inst, "InstanceBox", Nothing, bb);
    const inner = b.boxShapeClass.shapeInnerBox(b.boxShape);
    const [[kids, conns]] = inDelta(st, ids.buildingDiag, diagramFromList(ecls, [ElemBox(b)]), (d) => {
      const ks = runPure(causalBoxChildren(cls, d, b));
      const cs = ks.map(([k]) => runPure(causalBoxChildConnection(cls, d, b, k)));
      return [ks, cs] as const;
    });
    expect(kids.map(([k]) => nameOf(st, k))).toEqual(["AND-1", "Armed", "Count 1", "Fire", "OR-1", "Smoke"]);
    const g = childBoxes(inner);
    for (let i = 0; i < kids.length; i++) {
      const cb = g.next().value;
      if (cb.tag !== "BoundBox") throw new Error("NoBox");
      const mid = (cb._0._pY + cb._1._pY) / 2;
      expect(kids[i][1](Point(50, mid))).toBe(true);
      expect(conns[i](Point(-100, 0))).toEqual(Point(cb._0._pX, mid));
      expect(conns[i](Point(1000, 0))).toEqual(Point(cb._1._pX, mid));
    }
    expect(kids[0][1](Point(50, 1))).toBe(false); // The title area.
    // Other boxes have no children.
    const sb = dtc.mkBox("sb", ids.armed, "StateBox", Nothing, bb);
    const [none] = inDelta(st, ids.alarmDiag, diagramFromList(ecls, []), (d) => runPure(causalBoxChildren(cls, d, sb)));
    expect(none).toEqual([]);
  });
});

describe("arrow connection rules", () => {
  const { st, ids } = fixture();
  const bb = BoundBox(Point(0, 0), Point(100, 50));
  const spec: [string, BoxType][] = [
    ["armed", "StateBox"], ["off", "StateBox"], ["smoke", "EventBox"], ["fire", "EventBox"], ["count", "LogicBox"],
    ["andS", "LogicBox"], ["orE", "LogicBox"], ["andE", "LogicBox"], ["inst", "InstanceBox"], ["goal", "GoalBox"],
    ["evidence", "EvidenceBox"], ["evacuate", "StateBox"], // An event in a state box.
  ];
  const boxes: Box<CausalType<TV>, TV>[] = spec.map(([k, t]) => dtc.mkBox("box-" + k, ids[k], t, Nothing, bb));
  const diagram = diagramFromList(ecls, boxes.map((b) => ElemBox(b)));
  const end = (k: string | null) => (k === null ? Unconnected(Point(0, 0)) : Connected(Point(0, 0), "box-" + k, Nothing));
  /** The boxes an arrow can connect to, given the boxes at its ends. */
  const allowed = (typ: ArrowType, dir: "ConnectionFrom" | "ConnectionTo", from: string | null, to: string | null,
    child: Maybe<string> = Nothing): string[] => {
    const arrow = Arrow<CausalType<TV>, TV>("arr", "e", typ, LineShape([end(from), end(to)], []));
    return inDelta(st, ids.alarmDiag, diagram, (d) =>
      boxes.filter((b) => runPure(causalArrowCanConnect(cls, d, dir, arrow, b, child))).map((b) => b.boxId.slice(4)))[0];
  };

  it("sequence arrows go between states and events", () => {
    expect(allowed("TemporalArrow", "ConnectionTo", null, null)).toEqual(["armed", "off", "smoke", "fire"]);
    expect(allowed("TemporalArrow", "ConnectionTo", "armed", null)).toEqual(["smoke", "fire"]);
    expect(allowed("TemporalArrow", "ConnectionFrom", null, "smoke")).toEqual(["armed", "off"]);
    expect(allowed("TemporalArrow", "ConnectionFrom", null, "count")).toEqual([]);
    expect(allowed("TemporalArrow", "ConnectionFrom", null, "evacuate")).toEqual(["smoke", "fire"]); // The box type counts.
  });

  it("trigger arrows connect events and event logic, including instance exports", () => {
    expect(allowed("TriggerArrow", "ConnectionFrom", null, null)).toEqual(["smoke", "fire", "orE", "andE", "evacuate"]);
    expect(allowed("TriggerArrow", "ConnectionTo", null, null, Just(ids.fire))).toEqual(["smoke", "fire", "orE", "andE", "inst", "evacuate"]);
    expect(allowed("TriggerArrow", "ConnectionTo", null, null, Just(ids.orE))).toContain("inst");
    expect(allowed("TriggerArrow", "ConnectionTo", null, null, Just(ids.armed))).not.toContain("inst");
    expect(allowed("TriggerArrow", "ConnectionTo", null, null, Just(ids.andE))).not.toContain("inst"); // Hidden: not exported.
  });

  it("guard arrows go from states and state logic to events and state logic", () => {
    expect(allowed("GuardArrow", "ConnectionFrom", null, null)).toEqual(["armed", "off", "count", "andS"]);
    expect(allowed("GuardArrow", "ConnectionTo", null, null)).toEqual(["smoke", "fire", "count", "andS", "evacuate"]);
    expect(allowed("GuardArrow", "ConnectionFrom", null, null, Just(ids.count))).toContain("inst");
    expect(allowed("GuardArrow", "ConnectionFrom", null, null, Just(ids.smoke))).not.toContain("inst");
    expect(allowed("GuardArrow", "ConnectionTo", null, null, Just(ids.smoke))).toContain("inst");
    expect(allowed("GuardArrow", "ConnectionTo", null, null, Just(ids.armed))).not.toContain("inst");
    expect(allowed("GuardArrow", "ConnectionTo", null, null, Just("not-a-child"))).not.toContain("inst");
  });

  it("hazard arrows are obsolete and trace arrows go from states and events to goals and evidence", () => {
    expect(allowed("HazardArrow", "ConnectionFrom", null, null)).toEqual([]);
    expect(allowed("TraceArrow", "ConnectionFrom", null, null)).toEqual(["armed", "off", "smoke", "fire", "evacuate"]);
    expect(allowed("TraceArrow", "ConnectionTo", null, null)).toEqual(["goal", "evidence"]);
  });

  it("is the arrowCanConnect method", () => {
    const arrow = Arrow<CausalType<TV>, TV>("arr", "e", "TraceArrow", LineShape([end(null), end(null)], []));
    const [r] = inDelta(st, ids.alarmDiag, diagram, (d) => runPure(dtc.arrowCanConnect(d, "ConnectionTo", arrow, boxes[9], Nothing)));
    expect(r).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe("drawing", () => {
  const style = hadesConfig(Gtk.iconThemeNew());
  const bb = BoundBox(Point(10, 10), Point(210, 130));
  const { st, ids } = fixture();
  const ent = (k: string): Maybe<Entity<TV>> => Just(entity(st, ids[k]));
  const svg = (r: (env: any) => void): string => {
    const s = new Cairo.SvgSurface(400, 300);
    r({ style, cr: s.context() });
    return s.document();
  };
  const shape = (t: BoxType) => dtc.mkBox("d", "m", t, Nothing, BoundBox(Point(0, 0), Point(1, 1)));

  it("draws states as ovals with the state symbol", () => {
    const b = shape("StateBox");
    const doc = svg(drawCausalStateBox(b.boxShapeClass, cls, ent("armed"), layoutText([], "Body"), Nothing, b.boxShape, bb));
    expect(doc).toMatch(/>Ⓢ Armed<\/text>/);
    expect(doc).toMatch(/>Body<\/text>/);
    expect(svg(drawCausalStateBox(b.boxShapeClass, cls, ent("off"), () => {}, Nothing, b.boxShape, bb))).toMatch(/>Off<\/text>/);
    expect(svg(drawCausalStateBox(b.boxShapeClass, cls, Nothing, () => {}, Nothing, b.boxShape, bb))).toMatch(/>Ⓢ State<\/text>/);
    expect(svg(drawCausalStateBox(b.boxShapeClass, cls, ent("armed"), () => {}, Just(Colour(C.sRGB24(255, 0, 0))), b.boxShape, bb)))
      .toMatch(/stroke="rgb\(255, 0, 0\)"/);
  });

  it("draws events as parallelograms, coloured by type", () => {
    const b = shape("EventBox");
    const draw = (k: string | null, border: Maybe<Colour> = Nothing) =>
      svg(drawCausalEventBox(b.boxShapeClass, cls, k === null ? Nothing : ent(k), () => {}, border, b.boxShape, bb));
    const simple = draw("smoke");
    expect(simple).toMatch(/>🄴 Smoke<\/text>/);
    expect(simple).not.toMatch(/>[CM]<\/text>/);
    const mishap = draw("fire");
    expect(mishap).toMatch(/fill="rgb\(255, 200, 200\)"/);
    expect(mishap).toMatch(/>M<\/text>/);
    const control = draw("sprinkler", Just(Colour(C.sRGB24(0, 0, 255))));
    expect(control).toMatch(/fill="rgb\(200, 255, 200\)"/);
    expect(control).toMatch(/stroke="rgb\(0, 0, 255\)"/);
    expect(control).toMatch(/>Sprinkler<\/text>/); // Hidden: no symbol.
    expect(control).toMatch(/>C<\/text>/);
    // A mishap event is always outlined in black, whatever the border colour.
    expect(draw("fire", Just(Colour(C.sRGB24(0, 0, 255))))).not.toMatch(/stroke="rgb\(0, 0, 255\)"/);
    expect(draw(null)).not.toMatch(/<text/);
  });

  it("draws logic as diamonds with the logic type", () => {
    const b = shape("LogicBox");
    const draw = (k: string) => svg(drawCausalLogicBox(b.boxShapeClass, cls, ent(k), Nothing, b.boxShape, bb));
    expect(draw("count")).toMatch(/>Ⓢ ≥2<\/text>/);
    expect(draw("count")).toMatch(/>Count 1<\/text>/);
    expect(draw("andS")).toMatch(/>Ⓢ AND<\/text>/);
    expect(draw("orE")).toMatch(/>🄴 Any<\/text>/);
    expect(draw("andE")).toMatch(/>All<\/text>/);
    expect(draw("andE")).not.toMatch(/🄴/);
  });

  it("draws instances with their exports", () => {
    const b = shape("InstanceBox");
    const [exports] = edit(st, (c: ModelEditCtx<TV, Causal<TV>>) => instanceExports(c, ids.inst), _CausalItem);
    const doc = svg(drawCausalInstanceBox(b.boxShapeClass, cls, exports, ent("inst"), Nothing, b.boxShape, BoundBox(Point(10, 10), Point(210, 210))));
    expect(doc).toMatch(/>Alarm 1<\/text>/);
    for (const t of ["Ⓢ AND-1", "Ⓢ Armed", "Ⓢ Count 1", "🄴 Fire", "🄴 OR-1", "🄴 Smoke"]) expect(doc).toContain(">" + t + "</text>");
    expect(doc.indexOf("Ⓢ Armed")).toBeLessThan(doc.indexOf("🄴 Smoke"));
  });

  it("draws boxes through the Delta, finding the entities in the model", () => {
    const draw = (key: string, typ: BoxType): string => {
      const b = dtc.mkBox("x", ids[key], typ, Nothing, bb);
      const [doc] = inDelta(st, ids.buildingDiag, diagramFromList(ecls, []), (d) => {
        const f = runPure(dtc.boxTypeDraw(d, b, () => {}, Nothing));
        return svg(f(bb));
      });
      return doc;
    };
    expect(draw("goal", "GoalBox")).toMatch(/>G1<\/text>/);
    expect(draw("evidence", "EvidenceBox")).toMatch(/>Report<\/text>/);
    expect(draw("inst", "InstanceBox")).toMatch(/>🄴 Fire<\/text>/);
    expect(draw("smoke", "EventBox")).toMatch(/>🄴 Smoke<\/text>/);
    expect(draw("armed", "StateBox")).toMatch(/>Ⓢ Armed<\/text>/);
    expect(draw("orE", "LogicBox")).toMatch(/>🄴 Any<\/text>/);
    const hazard = draw("armed", "HazardBox");
    expect(hazard).toMatch(/>Please Delete<\/text>/);
    expect(hazard).toMatch(/fill="rgb\(255, 255, 200\)"/);
    expect(hazard).toMatch(/stroke-width="4"/);
    // The prototype box drawn by the tools has the nil entity.
    const [proto] = inDelta(st, ids.buildingDiag, diagramFromList(ecls, []), (d) =>
      svg(runPure(dtc.boxTypeDraw(d, dtc.mkBox("x", "00000000-0000-0000-0000-000000000000", "StateBox", Nothing, NoBox), () => {}, Nothing))(bb)));
    expect(proto).toMatch(/>Ⓢ State<\/text>/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("menus, activation, wrapper and toolbar", () => {
  it("has context menus for components, diagrams and other entities", () => {
    const { st, ids } = fixture();
    const labels = (key: string) => {
      const e = entity(st, ids[key]);
      const c = e._entityContents;
      if (c.tag !== "CausalItem") throw new Error("not causal");
      return causalEntityMenu(cls, e, c._0)._0.map((g) => g.map((i) => i.menuLabel));
    };
    expect(labels("alarm")).toEqual([["Add Diagram", "Add Element"], ["Properties", "Delete"]]);
    expect(labels("alarmDiag")).toEqual([["Open diagram", "Properties", "Clone", "Delete"]]);
    expect(labels("armed")).toEqual([["Properties", "Delete"]]);
  });

  it("adds elements to a component", () => {
    const { st, ids } = fixture();
    const e = entity(st, ids.building);
    const c = e._entityContents;
    if (c.tag !== "CausalItem") throw new Error("not causal");
    const menu = causalEntityMenu(cls, e, c._0);
    const sub = menu._0[0][1].menuValue;
    if (sub.tag !== "Left") throw new Error("not a submenu");
    expect(sub.value._0.map((g) => g.map((i) => i.menuLabel))).toEqual([
      ["Simple Event", "Mishap Event", "Control Event"], ["State"], ["Count Logic", "AND State", "AND Event", "OR Event"],
    ]);
    const run = (v: any, s: ModelEditState<TV>) => {
      if (v.tag !== "Right") throw new Error("submenu");
      const r = interpret(s, _CausalItem, v.value);
      if (r.tag === "Left") throw new Error(show_ModelError(r.value));
      return r.value;
    };
    let s1 = st;
    const results: unknown[] = [];
    for (const g of sub.value._0) {
      for (const item of g) {
        const [m, s2, log] = run(item.menuValue, s1);
        results.push([m, log]);
        s1 = s2;
      }
    }
    const [m, s3] = run(menu._0[0][0].menuValue, s1);
    expect(m).toEqual(Just("Insert Diagram 1"));
    expect(results).toEqual([
      [Just("Insert Event 1"), ["ScriptProperties"]], [Just("Insert Mishap 1"), ["ScriptProperties"]],
      [Just("Insert Control 1"), ["ScriptProperties"]], [Just("Insert State 1"), ["ScriptProperties"]],
      [Just("Insert Count 1"), ["ScriptProperties"]], [Just("Insert AND-1"), ["ScriptProperties"]],
      [Just("Insert AND-2"), ["ScriptProperties"]], [Just("Insert OR-1"), ["ScriptProperties"]],
    ]);
    const kids = M.elems(entity(s3, ids.building)._entityChildren).map((u) => entity(s3, u)._entityContents)
      .flatMap((v) => (v.tag === "CausalItem" ? [v._0] : []));
    expect(kids.map((k) => causalIcon(k)).sort()).toEqual([
      "causal_diagram", "causal_diagram", "causal_event", "causal_event", "causal_event_control", "causal_event_mishap",
      "causal_instance", "causal_logic_count", "causal_logic_event_and", "causal_logic_event_or",
      "causal_logic_state_and", "causal_state",
    ]);
  });

  it("adds components to packages", () => {
    const { st, ids } = fixture();
    const menu = addCausalEntityMenu(cls, ids.pkg);
    expect(menu._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Add Component"]]);
    const item = menu._0[0][0].menuValue;
    if (item.tag !== "Right") throw new Error("submenu");
    const r = interpret(st, _CausalItem, item.value);
    if (r.tag === "Left") throw new Error(show_ModelError(r.value));
    expect(r.value[0]).toEqual(Just("Insert Component 1"));
    expect(childNames(r.value[1], ids.pkg)).toContain("Component 1");
  });

  it("opens diagrams and edits other entities on activation", () => {
    const { st, ids } = fixture();
    const r1 = interpret(st, _CausalItem, causalActivation(cls, Just(entity(st, ids.alarmDiag))));
    expect(r1.tag === "Right" && [r1.value[0], r1.value[2]]).toEqual([Nothing, ["ScriptOpenDiagram"]]);
    const r2 = interpret(st, _CausalItem, causalActivation(cls, Just(entity(st, ids.armed))));
    expect(r2.tag === "Right" && r2.value[2]).toEqual(["ScriptProperties"]);
    const r3 = interpret(st, _CausalItem, causalActivation(cls, Just(entity(st, ids.pkg))));
    expect(r3.tag === "Right" && [r3.value[0], r3.value[2]]).toEqual([Nothing, []]);
    const r4 = interpret(st, _CausalItem, causalActivation(cls, Nothing));
    expect(r4.tag === "Right" && [r4.value[0], r4.value[2]]).toEqual([Nothing, []]);
  });

  it("wraps causal diagrams and gives them the causal toolbar", () => {
    const { st, ids } = fixture();
    const e = entity(st, ids.alarmDiag);
    const r = evalModelEdit<TV, Causal<TV>, Maybe<EntityWrapper<HadesRender, TV>>>(cls, _CausalItem, st.stateModel,
      (c) => causalDiagramWrapper(cls, c, e));
    if (r.tag !== "Right" || r.value.tag !== "Just" || r.value.value.tag !== "DiagramWrapper") throw new Error("no wrapper");
    const w = r.value.value;
    expect(w.diagramClass).toBe(ecls);
    expect(w.wrappedEntityId).toBe(ids.alarmDiag);
    expect(w.diagramContext.diagramId).toBe(ids.alarmDiag);
    expect(w.diagramMenu).toEqual(Nothing);
    const tb = w.diagramToolbar(null as any);
    expect(tb.toolbarLeft.map((g) => g.map((t) => [t.toolIcon, t.toolTip]))).toEqual([
      [["causal_event", "Event"], ["causal_event_mishap", "Mishap"], ["causal_event_control", "Control"], ["causal_state", "State"]],
      [["causal_logic_count", "State Count"], ["causal_logic_state_and", "State &"], ["causal_logic_event_or", "Event OR"],
        ["causal_logic_event_and", "Event AND"]],
      [["causal_temporal", "Sequence"], ["causal_trigger", "Trigger"], ["causal_guard", "Guard"]],
      [["trace-arrow", "Trace"]],
      [["basic_comment", "Comment"], ["emblem-symbolic-link", "Link"]],
    ]);
    expect(tb.toolbarRight.map((g) => g.map((t) => t.toolIcon))).toEqual([["align", "align-size", "align-distribute"], ["view-control"]]);
    // Not a diagram.
    expect(evalModelEdit<TV, Causal<TV>, Maybe<EntityWrapper<HadesRender, TV>>>(cls, _CausalItem, st.stateModel,
      (c) => causalDiagramWrapper(cls, c, entity(st, ids.armed)))).toEqual(Right(Nothing));
    // Through the model dictionary.
    const r2 = evalModelEdit<TV, TV, Maybe<EntityWrapper<HadesRender, TV>>>(cls, identity<TV>(), st.stateModel,
      (c) => clsT.getDiagramWrapper(c, e));
    expect(r2.tag === "Right" && r2.value.tag).toBe("Just");
  });

  it("round trips diagram elements through the element codec", () => {
    const codec = JSON_Element(dtc);
    const b = dtc.mkBox("3a6c1b2e-0000-4000-8000-000000000001", "3a6c1b2e-0000-4000-8000-000000000002", "LogicBox", Nothing,
      BoundBox(Point(1, 2), Point(3, 4)));
    const js = codec.toJSON(ElemBox(b));
    expect(js).toEqual({ boxId: b.boxId, entity: b.boxEntity, type: "LogicBox", peg: null, shape: { p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 } } });
    expect(equals(codec.parseJSON(js), ElemBox(b))).toBe(true);
    const a = ElemArrow(Arrow<CausalType<TV>, TV>("3a6c1b2e-0000-4000-8000-000000000003", "3a6c1b2e-0000-4000-8000-000000000004",
      "GuardArrow", LineShape([Unconnected(Point(0, 0)), Connected(Point(5, 5), b.boxId, Just("3a6c1b2e-0000-4000-8000-000000000005"))], [])));
    expect(codec.parseJSON(codec.toJSON(a))).toEqual(a);
    expect((codec.toJSON(a) as any).type).toBe("GuardArrow");
  });
});
