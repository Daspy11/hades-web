// Ported from dsm/causality/Causality/Model.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Causal models: components made of states, events, logic elements and the edges between them,
 * instances of components, and causal diagrams showing them.
 *
 * TypeScript port
 * ---------------
 * * **Dictionaries.** `HasCausal v` is the interface `HasCausal<V>` (member `_Causal`). The
 *   constraint set of the `DiagramTypeClass (CausalType v) v` instance (`AppearanceClass
 *   (CausalType v) v`, `Editable HadesRender v`, `EntityClass v`, `HasDiagrams HadesRender v`,
 *   `HasCausal v`, `HasEvidence v`, `GSN.HasGsn v`, `HasLookups v`, `HasReports v`) is the single
 *   dictionary type `CausalClass<V>`; the smaller set of the menus and activation
 *   (`EntityClass v`, `HasCausal v`, `HasDiagrams HadesRender v`, `HasEvidence v`, `GSN.HasGsn v`,
 *   `Queryable v`) is `CausalBaseClass<V>`. Constrained functions take the dictionary first, then
 *   the context (`ModelEditCtx` or `DeltaCtx`), then the Haskell arguments:
 *   `causalDiagramWrapper(cls, ctx, ent)`, `causalArrowCanConnect(cls, d, dir, arrow, box, child)`.
 *   `ModelEdit`s whose only constraint is `EntityClass v` use the dictionary of the context
 *   (`instanceExports(ctx, modelId)`). The drawing functions take the `BoxShapeClass` dictionary
 *   of the shape first and then the model dictionary (`drawCausalStateBox(shapeCls, cls, ...)`).
 * * **Data families.** `CausalType v` has no values: it is the phantom interface `CausalType<V>`
 *   whose members name the data family instances for "App.GenericDiagram": `BoxType` and
 *   `ArrowType` (string enumerations with a constant per constructor, `boxTypeValues`,
 *   `arrowTypeValues`) and `ModelSubtype<V>` (tagged union `CausalEvent(e)` | `CausalState(s)` |
 *   `CausalLogic(l)` | `CausalInstance(i)` | `CausalEdge(e)` | `CausalComponent(c)` |
 *   `CausalDiagram(d)`, also called `Causal<V>`). `CausalNet<V>` is `Element<CausalType<V>, V>`.
 * * **The instance.** `DiagramTypeClass_CausalType(cls)` is the `DiagramTypeClass (CausalType v)
 *   v` dictionary (and the `GenericDiagramClass` of "App.GenericDiagram"). Like the GSN one it is
 *   `Object.create(cls)` plus the class methods, cached per `cls`, so
 *   `Avatar_Element(DiagramTypeClass_CausalType(cls))` is always the same object.
 * * **Other instances:** `eq_ModelSubtype`, `JSON_ModelSubtype(cls)`, `Reflective_ModelSubtype(cls)`
 *   (aliases `eq_Causal`, `JSON_Causal`, `Reflective_Causal`; the codec and the Reflective
 *   dictionary are cached per `cls` and build their diagram parts on first use),
 *   `JSON_EventType`, `show_EventType`, `JSON_Event`, `JSON_State`, `JSON_Logic`,
 *   `show_LogicType`, `read_LogicType`, `JSON_Instance`, `JSON_Edge`, `JSON_ComponentModel`,
 *   `JSON_BoxType`, `show_BoxType`, `read_BoxType`, `JSON_ArrowType`, `show_ArrowType`,
 *   `read_ArrowType`. The derived `Eq` instances are the structural `equals`. The derived `Read`
 *   instances (used by the JSON parsers) are the `read_X(str): Maybe<X>` functions with the
 *   behaviour of `readMaybe` (surrounding white space and parentheses are accepted).
 * * **Records.** `Event`, `State`, `Logic` keep their Haskell field names (`eventType`,
 *   `_eventName`, ...); the exported field accessors are also functions (`eventType(e)`,
 *   `logicType(l)`). `Instance` and `ComponentModel` are newtypes with their own JSON instances,
 *   so they are records `{ _instanceName }` and `{ _componentName }`. `LogicType` is the tagged
 *   union `LogicCountState(n)` | `LogicAndState` | `LogicAndEvent` | `LogicOrEvent`; `Edge` is
 *   `TemporalEdge(name)` | `TriggerEdge(name)` | `GuardEdge(name, inhibit)` with record fields.
 *   Lenses on monomorphic types are constants (`eventName`, `logicCount` (a Traversal),
 *   `edgeInhibit` (a Traversal), ...); optics on the polymorphic `Causal v` are zero-argument
 *   functions (`_CausalEvent<V>()`, `causalName<V>()`, `componentName<V>()`).
 * * **Scripts** are `CausalScriptAct<V, A>`, i.e. `ModelScriptAct` at `W = Causal<V>`.
 *   `causalActivation(cls, mEnt)` returns the script of the `ActivationScript`
 *   (`causalActivationScript(cls)` is the `ActivationScript` itself).
 * * `childBoxes` returns an infinite list in Haskell; here it is an infinite generator.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import * as L from "@/lib/Data/List";
import * as C from "@/lib/Data/Colour";
import * as Pango from "@/lib/GI/Pango";
import { Just, Nothing, catMaybes, fromMaybe, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, fromRight } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { absurd } from "@/lib/Prelude";
import {
  _Just, iso, lens, over, preview, prism, review, set, to, traversal, use, view,
  type Iso, type Lens, type Prism, type StateCell, type Traversal,
} from "@/lib/Control/Lens";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { type Colour, Colour as mkColour } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, append_Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { cannotHappen } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import {
  type Action, type BoxShapeClass, type ConnectionDirection, type Delta, type DeltaCtx,
  type DiagramId, type Point,
  BoundBox, BoxShapeClass_Diamond, BoxShapeClass_Oval, BoxShapeClass_Parallelogram,
  BoxShapeClass_Rectangle, DeltaTool, DeltaToolAction, DeltaToolbar, Diamond, LineShape, NoBox, Oval,
  Parallelogram, Point as mkPoint, Rectangle, addItem, alignmentTools, boxCentre, deltaContext,
  deltaDiagram, diagramContents, diamondCorners, inBox, mempty_Diagram, mkScriptAction, movePoint,
  pX, pY, parallelogramCorners, rectangleCorners,
} from "@/hades/src/Hades/Abstract";
import {
  type ArrowHead, type HadesLayout, type HadesRender,
  basicBox, circleArrowHead, closedArrowHead, drawCornerLetter, drawOval, drawPolygon,
  layoutHLine, layoutParagraphGap, layoutText, layoutTitle, local, multiArrowHead, openArrowHead,
  runLayout, runLayout_, textBlock, withLineColour, hadesFontSize,
} from "@/hades/src/Hades/GI/BasicShapes";
import {
  type AppearanceClass, type DiagramAppearance, diagramAppearanceClean, diagramAppearanceDialog,
  mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import {
  type Arrow, type AvatarCreation, type Box, type DiagramTypeClass, type Element,
  type GenericDiagramClass, Arrow as mkArrow, AvatarScript, Avatar_Element, Box as mkGenericBox,
  ElemArrow, ElemBox, GenericContext, JSON_Element, NoAvatar, SimpleArrow, SimpleBox, _ElemBox,
  compileAppearance, diagramTypeClassDefaults, edgeLinks, elementDialog, mempty_AppearanceDef,
  newArrowEntityTool, newBoxEntityTool, newCommentTool, newLinkTool,
} from "@/hades/src/App/GenericDiagram";
import {
  type HasEvidence, Trace, drawEvidence, evidenceVariant, traceArrowDash, traceArrowHead,
  traceArrowRelations, traceHeadRelation, traceTailRelation,
} from "@/hades/evidence/Evidence/Model";
import { goalVariant } from "@/dsm/gsn/GSN/FieldNames";
import * as GSN from "@/dsm/gsn/GSN/Model";
import {
  arrowHeadInstance, arrowTailInstance, causalComponentVariant, causalDiagramVariant,
  causalEventLogicVariant, causalInstanceVariant, causalStateLogicVariant, causalStateVariant,
  componentInstanceRelation, countField, guardEdgeVariant, hazardEdgeVariant, hiddenField,
  inhibitField, temporalEdgeVariant, triggerEdgeVariant,
} from "./FieldNames";
import {
  type ActivationScript, type DiagramEntityTypes, type Editable, type EntityWrapper,
  type HasDiagrams, type ModelScriptAct, DiagramEntity, DiagramWrapper, JSON_DiagramEntity,
  avatarConnector, diagramEntityData, diagramEntityMenu, diagramEntityName, editEntityProperties,
  entityMenu, eq_DiagramEntity, insertEntity, logInsertion, openDiagram, scriptContext,
  viewControlTool,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId, JSON_Name, Name,
  addCheckedRelation, checkModel, checkType, current, currentChildren, currentId,
  currentIsModified, descriptionField, entityContents, entityName, evalModelEdit, fromHere,
  goToEntity, goToRoot, mkEntity, modelNewName, modifyValue, moveDown, moveUp, nameField,
  nameText, queryRelations, usingTraversal,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { Queryable } from "@/hades/src/Model/Query/Diagram";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import {
  type RefTypeTable, append_RefTypeTable, arrowRelations, mkOneToMany,
} from "@/hades/src/Model/Reflection/References";
import { type Reflective, defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import {
  type ExtensionValues, ExtBool, ExtInt, ExtText, Variant, _ExtBool, _ExtInt, _ExtText,
} from "@/hades/src/Model/Reflection/Values";
import type { HasReports } from "@/hades/src/Model/Report/Base";

// ---------------------------------------------------------------------------------------------
// * Class for models that include causal entities

/** Provides access to causal model entities from other modules. */
export interface HasCausal<V> {
  readonly _Causal: Prism<V, Causal<V>>;
}

/**
 * TypeScript: the dictionary for the context of the `DiagramTypeClass (CausalType v) v` instance
 * and of most functions below: `(AppearanceClass (CausalType v) v, Editable HadesRender v,
 * EntityClass v, HasDiagrams HadesRender v, HasCausal v, HasEvidence v, GSN.HasGsn v,
 * HasLookups v, HasReports v)`. It includes `Queryable v`, a superclass of `HasReports v`.
 */
export type CausalClass<V> =
  AppearanceClass<CausalType<V>, V> & Editable<HadesRender, V> & EntityClass<V> &
  HasDiagrams<HadesRender, V> & HasCausal<V> & HasEvidence<V> & GSN.HasGsn<V> & HasLookups<V> &
  HasReports<V>;

/**
 * TypeScript: the dictionary for `(EntityClass v, HasCausal v, HasDiagrams HadesRender v,
 * HasEvidence v, GSN.HasGsn v, Queryable v)`, the context of "causalEntityMenu" and
 * "causalActivation".
 */
export type CausalBaseClass<V> =
  EntityClass<V> & HasCausal<V> & HasDiagrams<HadesRender, V> & HasEvidence<V> & GSN.HasGsn<V> &
  Queryable<V>;

// ---------------------------------------------------------------------------------------------
// * Causal model entity variants

/** Events are classified by their safety significance. */
export type EventType =
  /** No safety significance in itself. */
  | "SimpleEvent"
  /** An instance of a hazard. */
  | "MishapEvent"
  /**
   * Associated with a design feature that helps to prevent mishaps or
   * reduce their impact.
   */
  | "ControlEvent";
/** `[SimpleEvent .. ControlEvent]` (derived `Enum`, `Bounded`). */
export const eventTypeValues: readonly EventType[] = ["SimpleEvent", "MishapEvent", "ControlEvent"];
export const SimpleEvent: EventType = "SimpleEvent";
export const MishapEvent: EventType = "MishapEvent";
export const ControlEvent: EventType = "ControlEvent";

/** `instance Show EventType` */
export function show_EventType(t: EventType): string {
  return T.unpack(eventTypeName(t));
}

/** `instance ToJSON EventType` and `instance FromJSON EventType` */
export const JSON_EventType: J.JSONCodec<EventType> = J.codec(
  (t) => eventTypeJson(t),
  (v) => J.withText("Event type", (txt): EventType => {
    const tbl = M.fromList<string, EventType>(eventTypeValues.map((t) => [eventTypeJson(t), t] as const));
    const r = M.lookup(txt, tbl);
    switch (r.tag) {
      case "Just": return r.value;
      case "Nothing": return J.fail("Not an Event type: " + T.showText(txt));
      default: return absurd(r);
    }
  }, v),
);

export function eventTypeJson(t: EventType): string {
  return eventTypeName(t) + "Event";
}

export function eventTypeName(t: EventType): string {
  switch (t) {
    case "SimpleEvent": return "Simple Event";
    case "MishapEvent": return "Mishap Event";
    case "ControlEvent": return "Control Event";
    default: return absurd(t);
  }
}

/** The variants of "Event". */
export const eventVariants: readonly Variant<any>[] = eventTypeValues.map((t) => Variant(eventTypeName(t)));

/**
 * An event is a stream of occurences, each of which is considered to be instantaneous at a
 * particular time.
 */
export interface Event {
  readonly eventType: EventType;
  readonly _eventName: Name;
  readonly _eventText: string;
  readonly _eventHidden: boolean;
}
export function Event(eventType: EventType, _eventName: Name, _eventText: string, _eventHidden: boolean): Event {
  return { eventType, _eventName, _eventText, _eventHidden };
}

/** The `eventType` field accessor. */
export function eventType(e: Event): EventType {
  return e.eventType;
}

/** `instance ToJSON Event` and `instance FromJSON Event` */
export const JSON_Event: J.JSONCodec<Event> = J.codec(
  (ev) => J.object([
    ["type", JSON_EventType.toJSON(ev.eventType)],
    ["name", JSON_Name.toJSON(view(eventName, ev))],
    ["text", view(eventText, ev)],
    ["hidden", view(eventHidden, ev)],
  ]),
  (val) => J.withObject("Event", (v) => {
    const typ = J.field(v, "type", JSON_EventType);
    const nm = J.field(v, "name", JSON_Name);
    const txt = J.field(v, "text", J.textJ);
    const hidden = J.field(v, "hidden", J.boolJ);
    return Event(typ, nm, txt, hidden);
  }, val),
);

export const eventName: Lens<Event, Name> = lens((e: Event) => e._eventName, (v, n: Name): Event => ({ ...v, _eventName: n }));

export const eventText: Lens<Event, string> = lens((e: Event) => e._eventText, (v, t: string): Event => ({ ...v, _eventText: t }));

export const eventHidden: Lens<Event, boolean> =
  lens((e: Event) => e._eventHidden, (v, b: boolean): Event => ({ ...v, _eventHidden: b }));

/**
 * A system or subsystem can be in one of a number of states, and transitions between those
 * states in response to events.
 */
export interface State {
  readonly _stateName: Name;
  readonly _stateText: string;
  readonly _stateHidden: boolean;
}
export function State(_stateName: Name, _stateText: string, _stateHidden: boolean): State {
  return { _stateName, _stateText, _stateHidden };
}

/** `instance ToJSON State` and `instance FromJSON State` */
export const JSON_State: J.JSONCodec<State> = J.codec(
  (st) => J.object([
    ["type", "State"],
    ["name", JSON_Name.toJSON(view(stateName, st))],
    ["text", view(stateText, st)],
    ["hidden", view(stateHidden, st)],
  ]),
  (val) => J.withObject("State", (v) => {
    checkType(v, "State");
    const nm = J.field(v, "name", JSON_Name);
    const txt = J.field(v, "text", J.textJ);
    const hidden = J.fieldDefault(v, "hidden", J.boolJ, false);
    return State(nm, txt, hidden);
  }, val),
);

export const stateName: Lens<State, Name> = lens((s: State) => s._stateName, (v, n: Name): State => ({ ...v, _stateName: n }));

export const stateText: Lens<State, string> = lens((s: State) => s._stateText, (v, t: string): State => ({ ...v, _stateText: t }));

export const stateHidden: Lens<State, boolean> =
  lens((s: State) => s._stateHidden, (v, b: boolean): State => ({ ...v, _stateHidden: b }));

export type LogicType =
  /** Output is true if at least this many guard inputs are true. */
  | { readonly tag: "LogicCountState"; readonly _0: number }
  /**
   * Output is true iff all guard inputs are true. Less error prone than
   * using "LogicCountState".
   */
  | { readonly tag: "LogicAndState" }
  /** Output triggered when all input triggers have occured since last output. */
  | { readonly tag: "LogicAndEvent" }
  /** Output triggers if any input triggers. */
  | { readonly tag: "LogicOrEvent" };
export function LogicCountState(_0: number): LogicType {
  return { tag: "LogicCountState", _0 };
}
export const LogicAndState: LogicType = { tag: "LogicAndState" };
export const LogicAndEvent: LogicType = { tag: "LogicAndEvent" };
export const LogicOrEvent: LogicType = { tag: "LogicOrEvent" };

/** Derived `instance Show LogicType`. */
export function show_LogicType(t: LogicType): string {
  switch (t.tag) {
    case "LogicCountState": return "LogicCountState " + (t._0 < 0 ? "(" + String(t._0) + ")" : String(t._0));
    case "LogicAndState":
    case "LogicAndEvent":
    case "LogicOrEvent":
      return t.tag;
    default: return absurd(t);
  }
}

/**
 * Derived `instance Read LogicType`, as `readMaybe`: white space and redundant parentheses
 * around the value (and around the count) are accepted; a negative count must be parenthesised.
 */
export function read_LogicType(str: string): Maybe<LogicType> {
  const s = stripReadParens(str);
  switch (s) {
    case "LogicAndState": return Just(LogicAndState);
    case "LogicAndEvent": return Just(LogicAndEvent);
    case "LogicOrEvent": return Just(LogicOrEvent);
    default: break;
  }
  const m = /^LogicCountState(?=[\s(])(.*)$/s.exec(s);
  if (m === null) return Nothing;
  const n = readIntegerArg(m[1]);
  return n.tag === "Just" ? Just(LogicCountState(n.value)) : Nothing;
}

/** True iff the logic element processes state guards. */
export function logicIsState(t: LogicType): boolean {
  switch (t.tag) {
    case "LogicCountState": return true;
    case "LogicAndState": return true;
    default: return false;
  }
}

/** True iff the logic element processes event triggers. */
export function logicIsEvent(t: LogicType): boolean {
  switch (t.tag) {
    case "LogicAndEvent": return true;
    case "LogicOrEvent": return true;
    default: return false;
  }
}

/** What type of logic is this? */
export function logicTypeName<A = any>(t: LogicType): Variant<A> {
  return logicIsState(t) ? causalStateLogicVariant : causalEventLogicVariant;
}

/**
 * Causal logic provides composite guards and triggers based on a number of inputs. The details
 * depend on the type of the logic element.
 */
export interface Logic {
  readonly logicType: LogicType;
  readonly _logicName: Name;
  readonly _logicHidden: boolean;
}
export function Logic(logicType: LogicType, _logicName: Name, _logicHidden: boolean): Logic {
  return { logicType, _logicName, _logicHidden };
}

/** The `logicType` field accessor. */
export function logicType(l: Logic): LogicType {
  return l.logicType;
}

/** `instance ToJSON Logic` and `instance FromJSON Logic` */
export const JSON_Logic: J.JSONCodec<Logic> = J.codec(
  ({ logicType: typ, _logicName: nm, _logicHidden: h }) => J.object([
    ["name", JSON_Name.toJSON(nm)],
    ["hidden", h],
    ...(typ.tag === "LogicCountState"
      ? [["type", "LogicCountState"], ["n", J.integerJ.toJSON(typ._0)]] as const
      : [["type", show_LogicType(typ)]] as const),
  ]),
  (val) => J.withObject("Logic element", (v) => {
    const nm = J.field(v, "name", JSON_Name);
    const h = J.field(v, "hidden", J.boolJ);
    const str = J.field(v, "type", J.textJ);
    switch (str) {
      case "LogicCountState": {
        const n = J.field(v, "n", J.integerJ);
        return Logic(LogicCountState(n), nm, h);
      }
      default: {
        const typ = read_LogicType(str);
        switch (typ.tag) {
          case "Just": return Logic(typ.value, nm, h);
          case "Nothing": return J.fail("Unrecognised logic element type");
          default: return absurd(typ);
        }
      }
    }
  }, val),
);

export const logicName: Lens<Logic, Name> = lens((l: Logic) => l._logicName, (v, n: Name): Logic => ({ ...v, _logicName: n }));

export const logicHidden: Lens<Logic, boolean> =
  lens((l: Logic) => l._logicHidden, (v, h: boolean): Logic => ({ ...v, _logicHidden: h }));

/** For "LogicCountState" elements there is a count. Otherwise there isn't. */
export const logicCount: Traversal<Logic, number> = traversal(
  (lg: Logic, f: (n: number) => number): Logic =>
    (lg.logicType.tag === "LogicCountState" ? { ...lg, logicType: LogicCountState(f(lg.logicType._0)) } : lg),
  (lg: Logic): number[] => (lg.logicType.tag === "LogicCountState" ? [lg.logicType._0] : []),
);

/** An instance of a component. A component can be instantiated multiple times. */
export interface Instance {
  readonly _instanceName: Name;
}
export function Instance(_instanceName: Name): Instance {
  return { _instanceName };
}

/** `instance ToJSON Instance` and `instance FromJSON Instance` */
export const JSON_Instance: J.JSONCodec<Instance> = J.codec(
  (i) => J.object([
    ["type", "instance"],
    ["name", JSON_Name.toJSON(view(instanceName, i))],
  ]),
  (val) => J.withObject("Instance", (v) => {
    checkType(v, "instance");
    return Instance(J.field(v, "name", JSON_Name));
  }, val),
);

export const instanceName: Lens<Instance, Name> =
  lens((i: Instance) => i._instanceName, (_v, n: Name): Instance => ({ _instanceName: n }));

export type Edge =
  /**
   * Describes a state transition mediated by an event,
   * and hence a temporal order between states. A temporal edge connects a state
   * to an event or an event to a state, similar to arcs in Petri nets.
   */
  | { readonly tag: "TemporalEdge"; readonly _edgeName: Name }
  /** Carries an event to trigger another event. */
  | { readonly tag: "TriggerEdge"; readonly _edgeName: Name }
  /**
   * Carries a state which may then be used as the condition of
   * an event.
   */
  | {
    readonly tag: "GuardEdge";
    readonly _edgeName: Name;
    /** True if this guard inhibits its target. */
    readonly _edgeInhibit: boolean;
  };
export function TemporalEdge(_edgeName: Name): Edge {
  return { tag: "TemporalEdge", _edgeName };
}
export function TriggerEdge(_edgeName: Name): Edge {
  return { tag: "TriggerEdge", _edgeName };
}
export function GuardEdge(_edgeName: Name, _edgeInhibit: boolean): Edge {
  return { tag: "GuardEdge", _edgeName, _edgeInhibit };
}

/** `instance ToJSON Edge` and `instance FromJSON Edge` */
export const JSON_Edge: J.JSONCodec<Edge> = J.codec(
  (e) => {
    switch (e.tag) {
      case "TemporalEdge": return J.object([["type", "TemporalEdge"], ["name", JSON_Name.toJSON(e._edgeName)]]);
      case "TriggerEdge": return J.object([["type", "TriggerEdge"], ["name", JSON_Name.toJSON(e._edgeName)]]);
      case "GuardEdge":
        return J.object([["type", "GuardEdge"], ["name", JSON_Name.toJSON(e._edgeName)], ["inhibit", e._edgeInhibit]]);
      default: return absurd(e);
    }
  },
  (val) => J.withObject("Edge", (v) => {
    const txt = J.field(v, "type", J.textJ);
    switch (txt) {
      case "TemporalEdge": return TemporalEdge(J.field(v, "name", JSON_Name));
      case "TriggerEdge": return TriggerEdge(J.field(v, "name", JSON_Name));
      case "GuardEdge": {
        const nm = J.field(v, "name", JSON_Name);
        return GuardEdge(nm, J.field(v, "inhibit", J.boolJ));
      }
      default: return J.fail("Not an edge type: " + T.unpack(txt));
    }
  }, val),
);

export const edgeName: Lens<Edge, Name> = lens((e: Edge) => e._edgeName, (s, t: Name): Edge => ({ ...s, _edgeName: t }));

/** Name of the type of the edge. */
export function edgeTypeName<A = any>(e: Edge): Variant<A> {
  switch (e.tag) {
    case "TemporalEdge": return temporalEdgeVariant;
    case "TriggerEdge": return triggerEdgeVariant;
    case "GuardEdge": return guardEdgeVariant;
    default: return absurd(e);
  }
}

/** True iff this "GuardEdge" inhibits its target event. Does not apply to other "Edge" values. */
export const edgeInhibit: Traversal<Edge, boolean> = traversal(
  (e: Edge, f: (i: boolean) => boolean): Edge => (e.tag === "GuardEdge" ? { ...e, _edgeInhibit: f(e._edgeInhibit) } : e),
  (e: Edge): boolean[] => (e.tag === "GuardEdge" ? [e._edgeInhibit] : []),
);

/**
 * Systems are modelled as collections of components. Each component is an instance of a
 * component model. For instance a fire alarm would have a component model describing its
 * behaviour. A system with dual redundant fire alarms would instantiate this component model twice.
 *
 * Part models contain cause-effect networks. It isn't meaningful for the same state or event to
 * appear in two different component models, so these are required to be children of the component
 * model who's diagrams they appear in.
 */
export interface ComponentModel<V = any> {
  readonly _componentName: Name;
  /** Phantom: the model type. */
  readonly __v?: V;
}
export function ComponentModel<V = any>(_componentName: Name): ComponentModel<V> {
  return { _componentName };
}

/** `instance ToJSON (ComponentModel v)` and `instance FromJSON (ComponentModel v)` */
export const JSON_ComponentModel: J.JSONCodec<ComponentModel<any>> = J.codec(
  (c) => J.object([
    ["type", "CausalComponent"],
    ["name", JSON_Name.toJSON(c._componentName)],
  ]),
  (val) => J.withObject("Causal component", (v) => {
    checkType(v, "CausalComponent");
    return ComponentModel(J.field(v, "name", JSON_Name));
  }, val),
);

export function componentName<V = any>(): Iso<ComponentModel<V>, Name> {
  return iso((c: ComponentModel<V>) => c._componentName, (n: Name) => ComponentModel<V>(n));
}

/**
 * An early version of components had a single diagram belonging to the parent component.
 * Where such a diagram is found it is replaced by
 * a "ComponentModel" entity of the same name, and the diagram is moved to a new child entity.
 *
 * (A `ModelEdit v (Causal v) ()`.)
 */
export function fixOldComponents<V>(cls: EntityClass<V> & HasCausal<V>, ctx: ModelEditCtx<V, Causal<V>>): void {
  const traverseChildren = (c: ModelEditCtx<V, Causal<V>>): void => {
    const childs = M.elems(currentChildren(c));
    for (const ch of childs) {
      fromHere(c, (c1) => {
        moveDown(c1, () => ch);
        fixCurrent(c1);
      });
    }
  };
  const fixCurrent = (c: ModelEditCtx<V, Causal<V>>): void => {
    const cur = current(c);
    if (cur.tag === "Nothing") return; // Should not happen.
    const ent = cur.value;
    const item = preview(entityContents<V>().dot(cls._Causal), ent);
    if (item.tag === "Nothing") {
      traverseChildren(c); // Maybe this has a causal component as a descendant.
      return;
    }
    if (item.value.tag === "CausalDiagram") { // What we are looking for.
      const diag = item.value._0;
      modifyValue(c, () => CausalComponent<V>(ComponentModel<V>(view(diagramEntityName(), diag))));
      const newDiagram = CausalDiagram<V>(
        over(diagramEntityName<CausalNet<V>, DiagramAppearance<CausalType<V>, V>>().dot(nameText), (t: string) => t + " Diagram", diag));
      mkEntity(c, review(cls._Causal, newDiagram));
      return;
    }
    // Don't traverse inside any existing causal models.
  };
  fromHere(ctx, (c) => {
    goToRoot(c);
    traverseChildren(c);
    checkModel(c);
  });
}

/** Component diagrams show the relationships between the entities in a component model. */
export type ComponentDiagram<V> = DiagramEntity<CausalNet<V>, DiagramAppearance<CausalType<V>, V>>;

export function componentCanHaveChild<V>(cls: HasEvidence<V>, prsm: Prism<V, Causal<V>>, v: V): boolean {
  const c = preview(prsm, v);
  if (c.tag === "Just") {
    switch (c.value.tag) {
      case "CausalEvent": return true;
      case "CausalState": return true;
      case "CausalEdge": return true;
      case "CausalLogic": return true;
      case "CausalInstance": return true;
      case "CausalDiagram": return true;
      default: return false;
    }
  }
  return preview(cls._Trace, v).tag === "Just";
}

/**
 * Non-hidden model entities that are children of the component.
 *
 * (A `ModelEdit v (Causal v) [Entity v]`; the `EntityClass` is that of the context.)
 */
export function instanceExports<V>(
  ctx: ModelEditCtx<V, Causal<V>>,
  /** The instance we want the exports for. */
  modelId: ModelId,
): Entity<V>[] {
  const prsm = usingTraversal(ctx, (_c, p) => p);
  const components = queryRelations(ctx, (r) => NR.relation(modelId, componentInstanceRelation, r));
  const list = S.toList(components);
  if (list.length === 0) return []; // Instance of no component.
  // One or more components. Pick the first and ignore any others.
  const component = list[0];
  goToEntity(ctx, component);
  const childs = M.toList(currentChildren(ctx));
  const result = childs.map(([, childId]): Maybe<Entity<V>> => {
    goToEntity(ctx, childId);
    const cur = current(ctx);
    if (cur.tag === "Nothing") return Nothing;
    const child = cur.value;
    const exported = preview(entityContents<V>().dot(prsm).dot(to((c: Causal<V>) => causalExported(c))), child);
    return exported.tag === "Just" && exported.value ? Just(child) : Nothing;
  });
  return catMaybes(result);
}

// ---------------------------------------------------------------------------------------------
// * Causal model type

/**
 * CausalType is a unit type that exists only for its instances. In particular the
 * "DiagramTypeClass" instance means that it is a type of diagram featuring boxes and arrows that
 * are avatars of entities of the "Causal" data type.
 *
 * (TypeScript: a phantom type that is never instantiated. Its members name the associated data
 * family instances for "App.GenericDiagram": `BoxType (CausalType v)`, `ArrowType (CausalType v)`
 * and `ModelSubtype (CausalType v)`. The unit constructor `CausalType` is never used in Haskell
 * either — `diagramTypeName` ignores its argument and is called with `undefined` — so it has no
 * value counterpart.)
 */
export interface CausalType<V> {
  readonly BoxType: BoxType;
  readonly ArrowType: ArrowType;
  readonly ModelSubtype: ModelSubtype<V>;
}

/** `data BoxType (CausalType v)` (derived `Read`, `Show`, `Eq`). */
export type BoxType =
  | "StateBox" | "EventBox" | "LogicBox" | "InstanceBox" | "HazardBox" | "GoalBox" | "EvidenceBox";
export const boxTypeValues: readonly BoxType[] = [
  "StateBox", "EventBox", "LogicBox", "InstanceBox", "HazardBox", "GoalBox", "EvidenceBox",
];
export const StateBox: BoxType = "StateBox";
export const EventBox: BoxType = "EventBox";
export const LogicBox: BoxType = "LogicBox";
export const InstanceBox: BoxType = "InstanceBox";
export const HazardBox: BoxType = "HazardBox";
export const GoalBox: BoxType = "GoalBox";
export const EvidenceBox: BoxType = "EvidenceBox";

/** Derived `Show (BoxType (CausalType v))`. */
export function show_BoxType(b: BoxType): string {
  return b;
}

/** Derived `Read (BoxType (CausalType v))`, as `readMaybe`. */
export function read_BoxType(str: string): Maybe<BoxType> {
  const s = stripReadParens(str);
  return (boxTypeValues as readonly string[]).includes(s) ? Just(s as BoxType) : Nothing;
}

/** `data ArrowType (CausalType v)` (derived `Eq`, `Read`, `Show`). */
export type ArrowType = "TemporalArrow" | "TriggerArrow" | "GuardArrow" | "HazardArrow" | "TraceArrow";
export const arrowTypeValues: readonly ArrowType[] = [
  "TemporalArrow", "TriggerArrow", "GuardArrow", "HazardArrow", "TraceArrow",
];
export const TemporalArrow: ArrowType = "TemporalArrow";
export const TriggerArrow: ArrowType = "TriggerArrow";
export const GuardArrow: ArrowType = "GuardArrow";
export const HazardArrow: ArrowType = "HazardArrow";
export const TraceArrow: ArrowType = "TraceArrow";

/** Derived `Show (ArrowType (CausalType v))`. */
export function show_ArrowType(a: ArrowType): string {
  return a;
}

/** Derived `Read (ArrowType (CausalType v))`, as `readMaybe`. */
export function read_ArrowType(str: string): Maybe<ArrowType> {
  const s = stripReadParens(str);
  return (arrowTypeValues as readonly string[]).includes(s) ? Just(s as ArrowType) : Nothing;
}

/** `data ModelSubtype (CausalType v)` */
export type ModelSubtype<V> =
  | { readonly tag: "CausalEvent"; readonly _0: Event }
  | { readonly tag: "CausalState"; readonly _0: State }
  | { readonly tag: "CausalLogic"; readonly _0: Logic }
  | { readonly tag: "CausalInstance"; readonly _0: Instance }
  | { readonly tag: "CausalEdge"; readonly _0: Edge }
  | { readonly tag: "CausalComponent"; readonly _0: ComponentModel<V> }
  | { readonly tag: "CausalDiagram"; readonly _0: ComponentDiagram<V> };
export function CausalEvent<V = any>(_0: Event): ModelSubtype<V> {
  return { tag: "CausalEvent", _0 };
}
export function CausalState<V = any>(_0: State): ModelSubtype<V> {
  return { tag: "CausalState", _0 };
}
export function CausalLogic<V = any>(_0: Logic): ModelSubtype<V> {
  return { tag: "CausalLogic", _0 };
}
export function CausalInstance<V = any>(_0: Instance): ModelSubtype<V> {
  return { tag: "CausalInstance", _0 };
}
export function CausalEdge<V = any>(_0: Edge): ModelSubtype<V> {
  return { tag: "CausalEdge", _0 };
}
export function CausalComponent<V = any>(_0: ComponentModel<V>): ModelSubtype<V> {
  return { tag: "CausalComponent", _0 };
}
export function CausalDiagram<V = any>(_0: ComponentDiagram<V>): ModelSubtype<V> {
  return { tag: "CausalDiagram", _0 };
}

/**
 * TypeScript: the members that the `DiagramTypeClass (CausalType v) v` instance defines (the
 * class methods and the superclass codecs); the `HasDiagrams` superclass members come from the
 * model dictionary (see "DiagramTypeClass_CausalType").
 */
export type CausalDiagramTypeMethods<V> =
  Omit<DiagramTypeClass<CausalType<V>, V>, keyof HasDiagrams<HadesRender, V>>;

/**
 * TypeScript: the type of the `DiagramTypeClass (CausalType v) v` dictionary. It is also the
 * `GenericDiagramClass` dictionary of "App.GenericDiagram" for causal diagrams.
 */
export type CausalDiagramTypeClass<V> = CausalClass<V> & GenericDiagramClass<CausalType<V>, V>;

const causalDiagramTypeClasses = new WeakMap<object, CausalDiagramTypeClass<any>>();

/**
 * ```haskell
 * instance (
 *     AppearanceClass (CausalType v) v, Editable HadesRender v, EntityClass v,
 *     HasDiagrams HadesRender v, HasCausal v, HasEvidence v, GSN.HasGsn v, HasLookups v,
 *     HasReports v) =>
 *   DiagramTypeClass (CausalType v) v
 * ```
 *
 * (TypeScript: the dictionary delegates to `cls` for all its other members; see the module
 * header. The result is cached per `cls`.)
 */
export function DiagramTypeClass_CausalType<V>(cls: CausalClass<V>): CausalDiagramTypeClass<V> {
  const cached = causalDiagramTypeClasses.get(cls);
  if (cached !== undefined) return cached as CausalDiagramTypeClass<V>;
  type B = Box<CausalType<V>, V>;
  type D = CausalNet<V>;
  const methods: CausalDiagramTypeMethods<V> = {
    ...diagramTypeClassDefaults<CausalType<V>, V>(),
    boxTypeJ: JSON_BoxType,
    arrowTypeJ: JSON_ArrowType,
    mkBox: (diagId, modelId, typ, peg, bound) => {
      switch (typ) {
        case "StateBox": return mkGenericBox(BoxShapeClass_Oval, diagId, modelId, typ, peg, Oval(bound));
        case "EventBox": return mkGenericBox(BoxShapeClass_Parallelogram, diagId, modelId, typ, peg, Parallelogram(bound));
        case "LogicBox": return mkGenericBox(BoxShapeClass_Diamond, diagId, modelId, typ, peg, Diamond(bound));
        case "InstanceBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "HazardBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "GoalBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "EvidenceBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        default: return absurd(typ);
      }
    },
    boxTypeDraw: (d, box, contents, border) => drawCausalBox(cls, d, box, contents, border),
    boxChildren: (d, box) => causalBoxChildren(cls, d, box),
    boxChildConnection: (d, box, child) => causalBoxChildConnection(cls, d, box, child),
    // eslint-disable-next-line require-yield
    boxCanPeg: function* (_d: DeltaCtx<D>, _box: B, _arrow: Arrow<CausalType<V>, V>): Delta<D, Maybe<NR.Relation>> {
      return Nothing;
    },
    avatarType: (prsm, v) => causalAvatarType(cls, prsm, v),
    diagramTypeName: (_t) => "Causal Net",
    arrowTailRelation: (a) => (a === "TraceArrow" ? traceTailRelation : NR.edgeFromRelation),
    arrowHeadRelation: (a) => (a === "TraceArrow" ? traceHeadRelation : NR.edgeToRelation),
    arrowTailExportRelation: (_a) => Just(arrowTailInstance),
    arrowHeadExportRelation: (_a) => Just(arrowHeadInstance),
    arrowHeadDraw: (causal, a): ArrowHead => {
      switch (a) {
        case "TemporalArrow": return openArrowHead(45, 10);
        case "TriggerArrow": return closedArrowHead(30, 10, true);
        case "GuardArrow": {
          const inhibit = preview(_Just<Causal<V>>().dot(_CausalEdge<V>()).dot(edgeInhibit), causal);
          return inhibit.tag === "Just" && inhibit.value
            ? multiArrowHead(1, [closedArrowHead(30, 10, false), circleArrowHead(10, false)])
            : closedArrowHead(30, 10, false);
        }
        case "HazardArrow": return closedArrowHead(90, 10, false);
        case "TraceArrow": return traceArrowHead;
        default: return absurd(a);
      }
    },
    arrowLineDashes: (a) => (a === "TraceArrow" ? [...traceArrowDash] : []),
    arrowCanConnect: (d, dir, arrow, box, child) => causalArrowCanConnect(cls, d, dir, arrow, box, child),
  };
  const dict = Object.assign(Object.create(cls) as object, methods) as CausalDiagramTypeClass<V>;
  causalDiagramTypeClasses.set(cls, dict);
  return dict;
}

/**
 * ```haskell
 * instance (...) => Eq (ModelSubtype (CausalType v))
 * ```
 */
export function eq_ModelSubtype<V>(x: ModelSubtype<V>, y: ModelSubtype<V>): boolean {
  if (x.tag === "CausalEvent" && y.tag === "CausalEvent") return equals(x._0, y._0);
  if (x.tag === "CausalState" && y.tag === "CausalState") return equals(x._0, y._0);
  if (x.tag === "CausalLogic" && y.tag === "CausalLogic") return equals(x._0, y._0);
  if (x.tag === "CausalInstance" && y.tag === "CausalInstance") return equals(x._0, y._0);
  if (x.tag === "CausalEdge" && y.tag === "CausalEdge") return equals(x._0, y._0);
  if (x.tag === "CausalComponent" && y.tag === "CausalComponent") return equals(x._0, y._0);
  if (x.tag === "CausalDiagram" && y.tag === "CausalDiagram") return eq_DiagramEntity(x._0, y._0);
  return false;
}

/** `instance ToJSON (BoxType (CausalType v))` and `instance FromJSON (BoxType (CausalType v))` */
export const JSON_BoxType: J.JSONCodec<BoxType> = J.codec(
  (b) => T.pack(show_BoxType(b)),
  (v) => J.withText("Causal Box type", (str): BoxType => {
    const r = read_BoxType(T.unpack(str));
    switch (r.tag) {
      case "Just": return r.value;
      case "Nothing": return J.fail("Not a Causal Box type: " + T.showText(str));
      default: return absurd(r);
    }
  }, v),
);

/** `instance ToJSON (ArrowType (CausalType v))` and `instance FromJSON (ArrowType (CausalType v))` */
export const JSON_ArrowType: J.JSONCodec<ArrowType> = J.codec(
  (a) => T.pack(show_ArrowType(a)),
  (v) => J.withText("Causal Arrow type", (str): ArrowType => {
    const r = read_ArrowType(T.unpack(str));
    switch (r.tag) {
      case "Just": return r.value;
      case "Nothing": return J.fail("Not a Causal Arrow type: " + T.showText(str));
      default: return absurd(r);
    }
  }, v),
);

/** TypeScript: caches of "JSON_ModelSubtype" and "Reflective_ModelSubtype", per model dictionary. */
const causalCodecs = new WeakMap<object, J.JSONCodec<ModelSubtype<any>>>();
const causalReflectives = new WeakMap<object, Reflective<ModelSubtype<any>>>();

/**
 * ```haskell
 * instance (...) => ToJSON (ModelSubtype (CausalType v))
 * instance (...) => FromJSON (ModelSubtype (CausalType v))
 * ```
 */
export function JSON_ModelSubtype<V>(cls: CausalClass<V>): J.JSONCodec<ModelSubtype<V>> {
  const cached = causalCodecs.get(cls);
  if (cached !== undefined) return cached as J.JSONCodec<ModelSubtype<V>>;
  // Built on first use, so that a model dictionary can include this codec while it is being built.
  let diagramJ: J.JSONCodec<ComponentDiagram<V>> | null = null;
  const diagramCodec = (): J.JSONCodec<ComponentDiagram<V>> => {
    if (diagramJ === null) {
      const dtc = DiagramTypeClass_CausalType(cls);
      diagramJ = JSON_DiagramEntity<CausalNet<V>, DiagramAppearance<CausalType<V>, V>>(
        Avatar_Element(dtc), JSON_Element(dtc));
    }
    return diagramJ;
  };
  const codec = J.codec<ModelSubtype<V>>(
    // All the variant types have a "type" field in their JSON.
    (item) => {
      switch (item.tag) {
        case "CausalEvent": return JSON_Event.toJSON(item._0);
        case "CausalState": return JSON_State.toJSON(item._0);
        case "CausalLogic": return JSON_Logic.toJSON(item._0);
        case "CausalInstance": return JSON_Instance.toJSON(item._0);
        case "CausalEdge": return JSON_Edge.toJSON(item._0);
        case "CausalComponent": return JSON_ComponentModel.toJSON(item._0);
        case "CausalDiagram": return diagramCodec().toJSON(item._0);
        default: return absurd(item);
      }
    },
    (v) => J.alt<ModelSubtype<V>>(
      (v1) => CausalEvent<V>(JSON_Event.parseJSON(v1)),
      (v1) => CausalState<V>(JSON_State.parseJSON(v1)),
      (v1) => CausalLogic<V>(JSON_Logic.parseJSON(v1)),
      (v1) => CausalInstance<V>(JSON_Instance.parseJSON(v1)),
      (v1) => CausalEdge<V>(JSON_Edge.parseJSON(v1)),
      (v1) => CausalComponent<V>(JSON_ComponentModel.parseJSON(v1)),
      (v1) => CausalDiagram<V>(diagramCodec().parseJSON(v1)),
    )(v),
  );
  causalCodecs.set(cls, codec);
  return codec;
}

/**
 * ```haskell
 * instance (EntityClass v) => Reflective (ModelSubtype (CausalType v))
 * ```
 *
 * (TypeScript: cached per `cls`; `reflectiveDefaults` is a memoised getter.)
 */
export function Reflective_ModelSubtype<V>(cls: EntityClass<V>): Reflective<ModelSubtype<V>> {
  const cached = causalReflectives.get(cls);
  if (cached !== undefined) return cached as Reflective<ModelSubtype<V>>;
  type Item = ModelSubtype<V>;
  const nemo = Name("");
  const mkEvent = (typ: EventType): Item => CausalEvent<V>(Event(typ, nemo, "", false));
  let defaults: readonly Item[] | null = null;
  const refl: Reflective<Item> = {
    get reflectiveDefaults(): readonly Item[] {
      if (defaults === null) {
        defaults = [
          mkEvent("SimpleEvent"), mkEvent("MishapEvent"), mkEvent("ControlEvent"),
          CausalState<V>(State(nemo, "", false)),
          CausalComponent<V>(ComponentModel<V>(nemo)),
          CausalDiagram<V>(DiagramEntity(nemo, mempty_Diagram<CausalNet<V>>(), mempty_DiagramAppearance as DiagramAppearance<CausalType<V>, V>)),
          ...[LogicCountState(1), LogicAndState, LogicAndEvent, LogicOrEvent].map((t) => CausalLogic<V>(Logic(t, nemo, false))),
          ...[TemporalEdge(nemo), TriggerEdge(nemo), GuardEdge(nemo, false)].map((e) => CausalEdge<V>(e)),
        ];
      }
      return defaults;
    },
    reflectiveName: (item) => {
      switch (item.tag) {
        case "CausalEvent": return Variant(eventTypeName(item._0.eventType));
        case "CausalState": return causalStateVariant;
        case "CausalLogic": return logicTypeName(item._0.logicType);
        case "CausalInstance": return causalInstanceVariant;
        case "CausalEdge": return edgeTypeName(item._0);
        case "CausalComponent": return causalComponentVariant;
        case "CausalDiagram": return causalDiagramVariant;
        default: return absurd(item);
      }
    },
    variantUserLabel: defaultVariantUserLabel,
    reflectiveBuiltIn: (item) => {
      switch (item.tag) {
        case "CausalEvent": return [nameField, descriptionField, hiddenField];
        case "CausalState": return [nameField, descriptionField, hiddenField];
        case "CausalLogic":
          return item._0.logicType.tag === "LogicCountState" ? [nameField, countField, hiddenField] : [nameField, hiddenField];
        case "CausalInstance": return [nameField];
        case "CausalEdge": return item._0.tag === "GuardEdge" ? [nameField, inhibitField] : [nameField];
        case "CausalComponent": return [nameField];
        case "CausalDiagram": return [nameField];
        default: return absurd(item);
      }
    },
    reflectiveGet: (item) => {
      switch (item.tag) {
        case "CausalEvent": {
          const e = item._0;
          return M.fromList([
            [nameField, ExtText(view(eventName.dot(nameText), e))],
            [descriptionField, ExtText(view(eventText, e))],
            [hiddenField, ExtBool(view(eventHidden, e))],
          ]);
        }
        case "CausalState": {
          const s = item._0;
          return M.fromList([
            [nameField, ExtText(view(stateName.dot(nameText), s))],
            [descriptionField, ExtText(view(stateText, s))],
          ]);
        }
        case "CausalLogic": {
          const { logicType: t, _logicName: nm, _logicHidden: hidden } = item._0;
          if (t.tag === "LogicCountState") {
            return M.fromList([
              [nameField, ExtText(nm._0)],
              [countField, ExtInt(t._0)],
              [hiddenField, ExtBool(hidden)],
            ]);
          }
          return M.fromList([
            [nameField, ExtText(nm._0)],
            [hiddenField, ExtBool(hidden)],
          ]);
        }
        case "CausalInstance": return M.singleton(nameField, ExtText(item._0._instanceName._0));
        case "CausalEdge": {
          const e = item._0;
          if (e.tag === "GuardEdge") {
            return M.fromList([
              [nameField, ExtText(e._edgeName._0)],
              [inhibitField, ExtBool(e._edgeInhibit)],
            ]);
          }
          return M.singleton(nameField, ExtText(view(edgeName.dot(nameText), e)));
        }
        case "CausalComponent": return M.singleton(nameField, ExtText(view(nameText, item._0._componentName)));
        case "CausalDiagram":
          return M.singleton(nameField, ExtText(view(diagramEntityName().dot(nameText), item._0)));
        default: return absurd(item);
      }
    },
    reflectiveSet: (st: StateCell<ExtensionValues>, item: Item): Item => {
      switch (item.tag) {
        case "CausalEvent": {
          const e = item._0;
          const nm = Name(T.strip(extract(st, view(eventName.dot(nameText), e), _ExtText, nameField)));
          const txt = extract(st, view(eventText, e), _ExtText, descriptionField);
          const h = extract(st, view(eventHidden, e), _ExtBool, hiddenField);
          return CausalEvent<V>(Event(e.eventType, nm, txt, h));
        }
        case "CausalState": {
          const s = item._0;
          const nm = Name(T.strip(extract(st, view(stateName.dot(nameText), s), _ExtText, nameField)));
          const txt = extract(st, view(stateText, s), _ExtText, descriptionField);
          const h = extract(st, view(stateHidden, s), _ExtBool, hiddenField);
          return CausalState<V>(State(nm, txt, h));
        }
        case "CausalLogic": {
          const l = item._0;
          const t = l.logicType;
          if (t.tag === "LogicCountState") {
            const nm1 = extract(st, l._logicName._0, _ExtText, nameField);
            const n1 = extract(st, t._0, _ExtInt, countField);
            const hidden1 = extract(st, l._logicHidden, _ExtBool, hiddenField);
            return CausalLogic<V>(Logic(LogicCountState(n1), Name(T.strip(nm1)), hidden1));
          }
          const nm = Name(T.strip(extract(st, view(logicName.dot(nameText), l), _ExtText, nameField)));
          const hidden = extract(st, view(logicHidden, l), _ExtBool, hiddenField);
          return CausalLogic<V>(Logic(l.logicType, nm, hidden));
        }
        case "CausalInstance": {
          const i = item._0;
          const nm = Name(T.strip(extract(st, view(instanceName.dot(nameText), i), _ExtText, nameField)));
          return CausalInstance<V>(set(instanceName, nm, i));
        }
        case "CausalEdge": {
          const e = item._0;
          if (e.tag === "GuardEdge") {
            const nm = Name(T.strip(extract(st, e._edgeName._0, _ExtText, nameField)));
            const inhibit = extract(st, e._edgeInhibit, _ExtBool, inhibitField);
            return CausalEdge<V>(GuardEdge(nm, inhibit));
          }
          const nm = extract(st, view(edgeName.dot(nameText), e), _ExtText, nameField);
          return CausalEdge<V>(set(edgeName.dot(nameText), T.strip(nm), e));
        }
        case "CausalComponent": {
          const nm1 = item._0._componentName;
          const nm2 = extract(st, view(nameText, nm1), _ExtText, nameField);
          return CausalComponent<V>(ComponentModel<V>(Name(T.strip(nm2))));
        }
        case "CausalDiagram": {
          const d = item._0;
          const nm = Name(T.strip(extract(st, view(diagramEntityName().dot(nameText), d), _ExtText, nameField)));
          return CausalDiagram<V>(set(diagramEntityName<CausalNet<V>, DiagramAppearance<CausalType<V>, V>>(), nm, d));
        }
        default: return absurd(item);
      }
    },
    reflectiveBuiltInRefs: mconcatRefs<Item>([
      // Ordinary arrow connections.
      arrowRelations<Item>(temporalEdgeVariant,
        [causalStateVariant, ...eventVariants],
        [causalStateVariant, ...eventVariants]),
      arrowRelations<Item>(triggerEdgeVariant,
        [causalEventLogicVariant, ...eventVariants],
        [causalEventLogicVariant, ...eventVariants]),
      arrowRelations<Item>(guardEdgeVariant,
        [causalStateVariant, causalStateLogicVariant],
        [causalStateLogicVariant, ...eventVariants]),
      // Arrows connected to instances have extra relations.
      mkOneToMany<Item>(arrowHeadInstance,
        [causalInstanceVariant],
        [triggerEdgeVariant, guardEdgeVariant]),
      mkOneToMany<Item>(arrowTailInstance,
        [causalInstanceVariant],
        [triggerEdgeVariant, guardEdgeVariant]),
      traceArrowRelations<Item>(
        [causalStateVariant, ...eventVariants],
        [goalVariant, evidenceVariant]),
      // Components have instances
      mkOneToMany<Item>(componentInstanceRelation, [causalComponentVariant], [causalInstanceVariant]),
    ]),
    reflectiveArrows: M.fromList<Variant<Item>, readonly [NR.Relation, NR.Relation]>([
      [temporalEdgeVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
      [triggerEdgeVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
      [guardEdgeVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
      [hazardEdgeVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
    ]),
  };
  causalReflectives.set(cls, refl);
  return refl;
}

/** Alias of "eq_ModelSubtype": `Causal v` is `ModelSubtype (CausalType v)`. */
export const eq_Causal = eq_ModelSubtype;
/** Alias of "JSON_ModelSubtype". */
export const JSON_Causal = JSON_ModelSubtype;
/** Alias of "Reflective_ModelSubtype". */
export const Reflective_Causal = Reflective_ModelSubtype;

/** Is this a causal diagram? */
export function causalIsDiagram<V>(c: Causal<V>): boolean {
  return c.tag === "CausalDiagram";
}

/**
 * The wrapper for a causal diagram.
 *
 * (A `ModelEdit v (Causal v)`. From a `getDiagramWrapper(ctx, e)` at the top-level type use
 * `withSubtype(ctx, cls._Causal, (c) => causalDiagramWrapper(cls, c, e))`.)
 */
export function causalDiagramWrapper<V>(
  cls: CausalClass<V>,
  ctx: ModelEditCtx<V, Causal<V>>,
  ent: Entity<V>,
): Maybe<EntityWrapper<HadesRender, V>> {
  return usingTraversal(ctx, (c, trv) => {
    const mde = preview(entityContents<V>().dot(trv).dot(_CausalDiagram<V>()), ent);
    switch (mde.tag) {
      case "Nothing":
        return Nothing;
      case "Just": {
        const de = mde.value;
        const dtc = DiagramTypeClass_CausalType(cls);
        const vctx = compileAppearance(
          dtc,
          c,
          view(diagramEntityData<CausalNet<V>, DiagramAppearance<CausalType<V>, V>>(), de),
          GenericContext(ent.entityId, mempty_AppearanceDef),
        );
        return Just(DiagramWrapper<HadesRender, V, Causal<V>, CausalNet<V>>(
          Avatar_Element(dtc),
          /* wrappedEntityId = */ ent.entityId,
          /* diagramToEdit = */ de._diagramEntityContents,
          /* diagramEntityTraversal = */ _CausalDiagram<V>(),
          /* diagramTraversal = */ trv,
          /* diagramDialog = */ elementDialog(dtc),
          /* diagramContext = */ vctx,
          /* diagramMenu = */ Nothing,
          /* diagramToolbar = */ (_) => causalToolbar(cls, ent.entityId, ent._entityParent),
        ));
      }
      default:
        return absurd(mde);
    }
  });
}

/** Entity types that appear in causal diagrams. */
export const causalDiagramEntityTypes: DiagramEntityTypes<any> = M.fromList<Variant<any>, readonly Variant<any>[]>([
  [causalDiagramVariant, [...eventVariants, causalStateVariant, causalStateLogicVariant, causalEventLogicVariant,
    evidenceVariant, causalInstanceVariant,
  ]],
]);

/** The subtype of causal entities in models. */
export type Causal<V> = ModelSubtype<V>;

/** Elements that can appear in diagrams of cause and effect. */
export type CausalNet<V> = Element<CausalType<V>, V>;

export function _CausalEvent<V = any>(): Prism<Causal<V>, Event> {
  return prism((e: Event) => CausalEvent<V>(e), (v: Causal<V>) => (v.tag === "CausalEvent" ? Right(v._0) : Left(v)));
}

export function _CausalState<V = any>(): Prism<Causal<V>, State> {
  return prism((s: State) => CausalState<V>(s), (v: Causal<V>) => (v.tag === "CausalState" ? Right(v._0) : Left(v)));
}

export function _CausalEdge<V = any>(): Prism<Causal<V>, Edge> {
  return prism((e: Edge) => CausalEdge<V>(e), (v: Causal<V>) => (v.tag === "CausalEdge" ? Right(v._0) : Left(v)));
}

export function _CausalLogic<V = any>(): Prism<Causal<V>, Logic> {
  return prism((l: Logic) => CausalLogic<V>(l), (v: Causal<V>) => (v.tag === "CausalLogic" ? Right(v._0) : Left(v)));
}

export function _CausalInstance<V = any>(): Prism<Causal<V>, Instance> {
  return prism((i: Instance) => CausalInstance<V>(i), (v: Causal<V>) => (v.tag === "CausalInstance" ? Right(v._0) : Left(v)));
}

export function _CausalComponent<V = any>(): Prism<Causal<V>, ComponentModel<V>> {
  return prism(
    (c: ComponentModel<V>) => CausalComponent<V>(c),
    (v: Causal<V>) => (v.tag === "CausalComponent" ? Right(v._0) : Left(v)),
  );
}

export function _CausalDiagram<V = any>(): Prism<Causal<V>, ComponentDiagram<V>> {
  return prism(
    (d: ComponentDiagram<V>) => CausalDiagram<V>(d),
    (v: Causal<V>) => (v.tag === "CausalDiagram" ? Right(v._0) : Left(v)),
  );
}

export function causalName<V = any>(): Lens<Causal<V>, Name> {
  const getName = (c: Causal<V>): Name => {
    switch (c.tag) {
      case "CausalEvent": return view(eventName, c._0);
      case "CausalState": return view(stateName, c._0);
      case "CausalLogic": return view(logicName, c._0);
      case "CausalInstance": return view(instanceName, c._0);
      case "CausalEdge": return view(edgeName, c._0);
      case "CausalComponent": return c._0._componentName;
      case "CausalDiagram": return view(diagramEntityName(), c._0);
      default: return absurd(c);
    }
  };
  const setName = (c: Causal<V>, nm: Name): Causal<V> => {
    switch (c.tag) {
      case "CausalEvent": return CausalEvent<V>(set(eventName, nm, c._0));
      case "CausalState": return CausalState<V>(set(stateName, nm, c._0));
      case "CausalLogic": return CausalLogic<V>(set(logicName, nm, c._0));
      case "CausalInstance": return CausalInstance<V>(set(instanceName, nm, c._0));
      case "CausalEdge": return CausalEdge<V>(set(edgeName, nm, c._0));
      case "CausalComponent": return CausalComponent<V>(ComponentModel<V>(nm));
      case "CausalDiagram": return CausalDiagram<V>(set(diagramEntityName<CausalNet<V>, DiagramAppearance<CausalType<V>, V>>(), nm, c._0));
      default: return absurd(c);
    }
  };
  return lens(getName, setName);
}

/** Is this entity exported? */
export function causalExported<V>(c: Causal<V>): boolean {
  switch (c.tag) {
    case "CausalEvent": return !view(eventHidden, c._0);
    case "CausalState": return !view(stateHidden, c._0);
    case "CausalLogic": return !view(logicHidden, c._0);
    default: return false;
  }
}

/**
 * True if this entity can be moved to another parent.
 *
 * Entities representing elements in causal components are tied to their parent component and
 * cannot be moved or placed in diagrams belonging to other components.
 */
export function causalCanMove<V>(c: Causal<V>): boolean {
  return c.tag === "CausalComponent";
}

/** Create a new instance of the component and return an avatar for it. */
export function* createInstance<V>(
  cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  ent: Entity<V>,
  pt: Point,
): Delta<CausalNet<V>, Maybe<CausalNet<V>>> {
  const diagId = (use(d, deltaContext<CausalNet<V>>()) as GenericContext<CausalType<V>, V>).diagramId;
  const base = scriptContext<V, Causal<V>>(d);
  goToEntity(base, diagId);
  moveUp(base); // Causality models have no packages inside, so this is guaranteed to work.
  const nm = modelNewName(base, Name(view(entityContents<V>().dot(cls.name).dot(nameText), ent) + " "));
  const newInst = mkEntity(base, review(cls._Causal, CausalInstance<V>(Instance(nm))));
  addCheckedRelation(base, componentInstanceRelation, newInst, ent);
  fromHere(base, (c) => {
    goToEntity(c, ent.entityId);
    currentIsModified(c); // New relationship for the component.
  });
  const p1 = movePoint(pt, [-100, -50]);
  const p2 = movePoint(pt, [100, 50]);
  const shape = Rectangle(BoundBox(p1, p2));
  const item = yield* addItem(d, (newId) =>
    ElemBox(mkGenericBox<CausalType<V>, V, Rectangle>(BoxShapeClass_Rectangle, newId, newInst.entityId, "InstanceBox", Nothing, shape)));
  return Just(item);
}

/**
 * Is the entity a sibling of this diagram?
 *
 * (The `Avatar p v w (CausalNet v)` dictionary is that of the Delta context.)
 */
// eslint-disable-next-line require-yield
export function* isSibling<V>(d: DeltaCtx<CausalNet<V>>, entity: Entity<V>): Delta<CausalNet<V>, boolean> {
  const diagId = (use(d, deltaContext<CausalNet<V>>()) as GenericContext<CausalType<V>, V>).diagramId;
  const base = scriptContext<V, Causal<V>>(d);
  goToEntity(base, diagId);
  moveUp(base);
  const diagramParent = currentId(base);
  goToEntity(base, entity.entityId);
  moveUp(base);
  const entParent = currentId(base);
  return diagramParent === entParent;
}

export function causalAvatarType<V>(
  cls: CausalClass<V>,
  prsm: Traversal<V, Causal<V>>,
  v: V,
): AvatarCreation<CausalType<V>, V> {
  type AC = AvatarCreation<CausalType<V>, V>;
  const c = preview(prsm, v);
  if (c.tag === "Just") {
    const item = c.value;
    switch (item.tag) {
      case "CausalEvent": return AvatarScript<CausalType<V>, V>((d, e, p) => createBoxAvatar(cls, d, "EventBox", e, p));
      case "CausalState": return AvatarScript<CausalType<V>, V>((d, e, p) => createBoxAvatar(cls, d, "StateBox", e, p));
      case "CausalLogic": return AvatarScript<CausalType<V>, V>((d, e, p) => createBoxAvatar(cls, d, "LogicBox", e, p));
      case "CausalEdge":
        switch (item._0.tag) {
          case "TemporalEdge": return AvatarScript<CausalType<V>, V>((d, e, p) => createArrowAvatar(cls, d, "TemporalArrow", e, p));
          case "TriggerEdge": return AvatarScript<CausalType<V>, V>((d, e, p) => createArrowAvatar(cls, d, "TriggerArrow", e, p));
          case "GuardEdge": return AvatarScript<CausalType<V>, V>((d, e, p) => createArrowAvatar(cls, d, "GuardArrow", e, p));
          default: return absurd(item._0);
        }
      case "CausalInstance": return AvatarScript<CausalType<V>, V>((d, e, p) => createBoxAvatar(cls, d, "InstanceBox", e, p));
      case "CausalComponent": return AvatarScript<CausalType<V>, V>((d, e, p) => createInstance(cls, d, e, p));
      case "CausalDiagram": return NoAvatar as AC;
      default: return absurd(item);
    }
  }
  const nodeType = preview(cls._Gsn.dot(GSN._GsnNodeItem<V>()).dot(to(GSN.gsnNodeType)), v);
  if (nodeType.tag === "Just" && nodeType.value === GSN.GoalBox) return SimpleBox<CausalType<V>, V>("GoalBox");
  if (preview(cls._Evidence, v).tag === "Just") return SimpleBox<CausalType<V>, V>("EvidenceBox");
  if (preview(cls._Trace, v).tag === "Just") return SimpleArrow<CausalType<V>, V>("TraceArrow");
  return NoAvatar as AC;
}

/** Create a box avatar for an entity. */
export function* createBoxAvatar<V>(
  cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  typ: BoxType,
  entity: Entity<V>,
  basePoint: Point,
): Delta<CausalNet<V>, Maybe<CausalNet<V>>> {
  const defaultBox = BoundBox(movePoint(basePoint, [-100, -50]), movePoint(basePoint, [100, 50]));
  const sib = yield* isSibling(d, entity);
  if (sib) {
    const dtc = DiagramTypeClass_CausalType(cls);
    const newItem = yield* addItem(d, (uuid) => ElemBox(dtc.mkBox(uuid, entity.entityId, typ, Nothing, defaultBox)));
    return Just(newItem);
  }
  return Nothing;
}

/** Create an arrow avatar for an entity */
export function* createArrowAvatar<V>(
  cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  typ: ArrowType,
  entity: Entity<V>,
  basePoint: Point,
): Delta<CausalNet<V>, Maybe<CausalNet<V>>> {
  const target = entity.entityId;
  const arrowLength = 50;
  const sib = yield* isSibling(d, entity);
  if (sib) {
    const dtc = DiagramTypeClass_CausalType(cls);
    const [eFrom, eTo] = edgeLinks(dtc, scriptContext<V, Causal<V>>(d), typ, target);
    const fromConnector = yield* avatarConnector<HadesRender, V, Causal<V>, CausalNet<V>>(
      d, eFrom, basePoint, movePoint(basePoint, [-arrowLength, 0]));
    const toConnector = yield* avatarConnector<HadesRender, V, Causal<V>, CausalNet<V>>(
      d, eTo, basePoint, movePoint(basePoint, [arrowLength, 0]));
    const newItem = yield* addItem(d, (uuid) =>
      ElemArrow(mkArrow<CausalType<V>, V>(uuid, target, typ, LineShape([fromConnector, toConnector], []))));
    return Just(newItem);
  }
  return Nothing;
}

/**
 * The `boxTypeDraw` method: draw the box, but override its position and size with the BoundBox
 * argument of the result.
 */
// eslint-disable-next-line require-yield
export function* drawCausalBox<V>(
  cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  box: Box<CausalType<V>, V>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
): Delta<CausalNet<V>, (b: BoundBox) => HadesRender<void>> {
  const modelId = box.boxEntity;
  const typ = box.boxType as BoxType;
  const shapeCls: BoxShapeClass<any> = box.boxShapeClass;
  const shape1 = box.boxShape;
  const base = scriptContext<V, Causal<V>>(d);
  goToEntity(base, modelId);
  const ent = current(base);
  const exports = instanceExports(base, modelId);
  const hazardYellow = mkColour(C.sRGB24(255, 255, 200));
  const black = mkColour(C.black);
  switch (typ) {
    case "GoalBox":
      return (b) => GSN.drawGsnBoxRaw(
        shapeCls,
        GSN.GoalBox,
        preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Gsn).dot(GSN._GsnNodeItem<V>()), ent),
        contents,
        border,
        shape1,
        b,
      );
    case "EvidenceBox": return (b) => drawEvidence(cls, ent, contents, border, b);
    case "StateBox": return (b) => drawCausalStateBox(shapeCls, cls, ent, contents, border, shape1, b);
    case "EventBox": return (b) => drawCausalEventBox(shapeCls, cls, ent, contents, border, shape1, b);
    case "LogicBox": return (b) => drawCausalLogicBox(shapeCls, cls, ent, border, shape1, b);
    case "InstanceBox": return (b) => drawCausalInstanceBox(shapeCls, cls, exports, ent, border, shape1, b);
    case "HazardBox": // Obsolete type.
      return (boundBox) => (env) => {
        const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
        const [border1, fill] = basicBox(4, fromMaybe(black, border), hazardYellow);
        local((e) => ({ ...e, boxBorderStyle: border1, boxFillStyle: fill }),
          drawPolygon(rectangleCorners(Rectangle(view(shapeCls.shapeDefinition, shape2)))))(env);
        textBlock(
          "Please Delete",
          ["Hazards are no longer permitted on causal diagrams."],
          shapeCls.shapeInnerBox(shape2),
        )(env);
      };
    default:
      return absurd(typ);
  }
}

/** `maybe id withLineColour border act` */
function withBorder(border: Maybe<Colour>, act: HadesRender<void>): HadesRender<void> {
  return border.tag === "Just" ? withLineColour(border.value, act) : act;
}

export function drawCausalStateBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: HasCausal<V>,
  ent: Maybe<Entity<V>>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  return (env) => {
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    withBorder(border, drawOval(Oval(view(shapeCls.shapeDefinition, shape2))))(env);
    runLayout_(shapeCls.shapeInnerBox(shape2), (env1, st) => {
      const state = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Causal).dot(_CausalState<V>()), ent);
      switch (state.tag) {
        case "Just": {
          const titleFlag = view(stateHidden, state.value) ? "" : "Ⓢ ";
          layoutTitle(Nothing, titleFlag + view(stateName.dot(nameText), state.value))(env1, st);
          break;
        }
        case "Nothing":
          layoutTitle(Nothing, "Ⓢ State")(env1, st);
          break;
        default:
          absurd(state);
      }
      layoutParagraphGap(env1, st);
      contents(env1, st);
    })(env);
  };
}

export function drawCausalEventBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: HasCausal<V>,
  ent: Maybe<Entity<V>>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  const controlGreen = mkColour(C.sRGB24(200, 255, 200));
  const mishapRed = mkColour(C.sRGB24(255, 200, 200));
  const black = mkColour(C.black);
  const withEventStyle = (typ1: EventType, act: HadesRender<void>): HadesRender<void> => {
    switch (typ1) {
      case "SimpleEvent": return act; // Just draw normally.
      case "ControlEvent": {
        const [border1, fill] = basicBox(2, fromMaybe(black, border), controlGreen);
        return local((e) => ({ ...e, boxBorderStyle: border1, boxFillStyle: fill }), act);
      }
      case "MishapEvent": {
        const [border1, fill] = basicBox(2, black, mishapRed);
        return local((e) => ({ ...e, boxBorderStyle: border1, boxFillStyle: fill }), act);
      }
      default: return absurd(typ1);
    }
  };
  return (env) => {
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    const mEvent = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Causal).dot(_CausalEvent<V>()), ent);
    switch (mEvent.tag) {
      case "Just": {
        const event = mEvent.value;
        withEventStyle(event.eventType, (env1) => {
          drawPolygon(parallelogramCorners(Parallelogram(view(shapeCls.shapeDefinition, shape2))))(env1);
          const titleFlag = view(eventHidden, event) ? "" : "🄴 ";
          runLayout_(shapeCls.shapeInnerBox(shape2), (env2, st) => {
            layoutTitle(Nothing, titleFlag + view(eventName.dot(nameText), event))(env2, st);
            layoutParagraphGap(env2, st);
            contents(env2, st);
          })(env1);
          switch (event.eventType) {
            case "SimpleEvent": return;
            case "ControlEvent": drawCornerLetter(shapeCls.shapeBounds(shape2), "C")(env1); return;
            case "MishapEvent": drawCornerLetter(shapeCls.shapeBounds(shape2), "M")(env1); return;
            default: absurd(event.eventType);
          }
        })(env);
        return;
      }
      case "Nothing":
        withBorder(border, drawPolygon(parallelogramCorners(Parallelogram(view(shapeCls.shapeDefinition, shape2)))))(env);
        // Should never happen.
        return;
      default:
        absurd(mEvent);
    }
  };
}

export function drawCausalLogicBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: HasCausal<V>,
  ent: Maybe<Entity<V>>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  return (env) => {
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    withBorder(border, drawPolygon(diamondCorners(view(shapeCls.shapeDefinition, shape2))))(env);
    const mLogic = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Causal).dot(_CausalLogic<V>()), ent);
    switch (mLogic.tag) {
      case "Just": {
        const logic = mLogic.value;
        const titleFlag = view(logicHidden, logic) ? "" : symbol(CausalLogic<V>(logic));
        const t = logic.logicType;
        const label = ((): string => {
          switch (t.tag) {
            case "LogicCountState": return T.pack("≥" + String(t._0));
            case "LogicAndState": return "AND";
            case "LogicAndEvent": return "All";
            case "LogicOrEvent": return "Any";
            default: return absurd(t);
          }
        })();
        textBlock(titleFlag + label, [view(logicName.dot(nameText), logic)], shapeCls.shapeInnerBox(shape2))(env);
        return;
      }
      case "Nothing":
        return;
      default:
        absurd(mLogic);
    }
  };
}

export function drawCausalInstanceBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: EntityClass<V> & HasCausal<V>,
  exports: readonly Entity<V>[],
  ent: Maybe<Entity<V>>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  const drawExport = (causal: Causal<V>, box: BoundBox): HadesRender<Maybe<void>> => runLayout(box, (env, st) => {
    layoutHLine(env, st);
    layoutText([(l) => () => Pango.layoutSetEllipsize(l, Pango.EllipsizeModeEnd)],
      symbol(causal) + view(causalName<V>().dot(nameText), causal))(env, st);
    layoutHLine(env, st);
  });
  return (env) => {
    const childs = mapMaybe((e: Entity<V>) => preview(entityContents<V>().dot(cls._Causal), e), exports);
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    withBorder(border, drawPolygon(rectangleCorners(Rectangle(view(shapeCls.shapeDefinition, shape2)))))(env);
    runLayout(shapeCls.shapeInnerBox(shape2), (env1, st) => {
      const title = preview(_Just<Entity<V>>().dot(entityName(cls)).dot(nameText), ent);
      if (title.tag === "Just") layoutTitle(Nothing, title.value)(env1, st);
    })(env);
    // zipWithM_ drawExport childs $ childBoxes $ shapeInnerBox shape2
    const boxes = childBoxes(shapeCls.shapeInnerBox(shape2));
    for (const causal of childs) drawExport(causal, boxes.next().value)(env);
  };
}

export function symbol<V>(c: Causal<V>): string {
  switch (c.tag) {
    case "CausalEvent": return "🄴 "; // U+1F134 - Boxed E
    case "CausalState": return "Ⓢ "; // U+24C8 - Circled S
    case "CausalLogic":
      switch (c._0.logicType.tag) {
        case "LogicCountState": return "Ⓢ ";
        case "LogicAndState": return "Ⓢ ";
        case "LogicAndEvent": return "🄴 ";
        case "LogicOrEvent": return "🄴 ";
        default: return absurd(c._0.logicType);
      }
    default: return "";
  }
}

/** Exported connection points for "ComponentBox" boxes. Returns @[]@ for anything else. */
// eslint-disable-next-line require-yield
export function* causalBoxChildren<V>(
  _cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  box: Box<CausalType<V>, V>,
): Delta<CausalNet<V>, [DiagramId, (p: Point) => boolean][]> {
  const childConnector = (child: Entity<V>, b: BoundBox): [DiagramId, (p: Point) => boolean] =>
    [child.entityId, (p: Point) => inBox(p, b)];
  switch (box.boxType as BoxType) {
    case "InstanceBox": {
      const childs = instanceExports(scriptContext<V, Causal<V>>(d), box.boxEntity);
      const boxes = childBoxes(box.boxShapeClass.shapeInnerBox(box.boxShape));
      return childs.map((child) => childConnector(child, boxes.next().value));
    }
    default:
      return [];
  }
}

/**
 * When an arrow is connected to an exported item in a ComponentBox, what point should it
 * end at?
 */
// eslint-disable-next-line require-yield
export function* causalBoxChildConnection<V>(
  _cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  box: Box<CausalType<V>, V>,
  childId: DiagramId,
): Delta<CausalNet<V>, (p: Point) => Point> {
  const shapeCls: BoxShapeClass<any> = box.boxShapeClass;
  const shape = box.boxShape;
  const childs = instanceExports(scriptContext<V, Causal<V>>(d), box.boxEntity).map((e) => e.entityId);
  const ix = L.elemIndex(childId, childs);
  switch (ix.tag) {
    case "Just": {
      // (!!) is safe because childBoxes returns an infinite list.
      const childBox = nthChildBox(ix.value, shapeCls.shapeInnerBox(shape));
      switch (childBox.tag) {
        case "BoundBox": {
          const p1 = childBox._0;
          const p2 = childBox._1;
          const { _pX: midX, _pY: midY } = view(boxCentre, childBox);
          const pLeft = mkPoint(view(pX, p1), midY);
          const pRight = mkPoint(view(pX, p2), midY);
          return (pt: Point) => (view(pX, pt) < midX ? pLeft : pRight);
        }
        default:
          return (p: Point) => shapeCls.shapeConnectionPoint(shape, p);
      }
    }
    case "Nothing":
      return cannotHappen(
        "causalBoxChildConnection: cannot find chosen item in list.",
        (p: Point) => shapeCls.shapeConnectionPoint(shape, p),
      );
    default:
      return absurd(ix);
  }
}

/** Can the arrow connect to the box at the specified end. */
export function* causalArrowCanConnect<V>(
  _cls: CausalClass<V>,
  d: DeltaCtx<CausalNet<V>>,
  direction: ConnectionDirection,
  arrow: Arrow<CausalType<V>, V>,
  box: Box<CausalType<V>, V>,
  /** Optional child of the target box. */
  mChild: Maybe<DiagramId>,
): Delta<CausalNet<V>, boolean> {
  type D = CausalNet<V>;
  const arrTyp = arrow.arrowType as ArrowType;
  const arrShape = arrow._arrowShape;
  const boxEnt = box.boxEntity;
  const boxTyp = box.boxType as BoxType;
  const base = scriptContext<V, Causal<V>>(d);
  const prsm = usingTraversal(base, (_c, p) => p);
  const otherEnd = direction === "ConnectionFrom" ? arrShape._lineEnds[1] : arrShape._lineEnds[0];
  const otherElement: Maybe<D> = otherEnd.tag === "Connected"
    ? M.lookup(otherEnd.connectorTarget, use(d, deltaDiagram<D>().dot(diagramContents<D>())))
    : Nothing;
  const otherBox = preview(_Just<D>().dot(_ElemBox<CausalType<V>, V>()), otherElement);
  goToEntity(base, boxEnt);
  const thisEntity = current(base);
  const thisCausal = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(prsm), thisEntity);
  /** The exported entity of the instance that is the child, as a causal entity, if any. */
  const exportedChild = (child: DiagramId): Maybe<Causal<V>> => {
    const exports = instanceExports(base, boxEnt);
    const exp = L.find((e: Entity<V>) => child === e.entityId, exports);
    return exp.tag === "Just" ? preview(entityContents<V>().dot(prsm), exp.value) : Nothing;
  };
  const isStateCausal = thisCausal.tag === "Just" && thisCausal.value.tag === "CausalState";
  switch (arrTyp) {
    case "TemporalArrow": { // Can connect State -> Event or Event -> State, but not Components.
      if (otherBox.tag === "Nothing") return boxTyp === "EventBox" || (boxTyp === "StateBox" && isStateCausal);
      switch (otherBox.value.boxType as BoxType) {
        case "StateBox": return boxTyp === "EventBox";
        case "EventBox": return boxTyp === "StateBox" && isStateCausal;
        default: return false;
      }
    }
    case "TriggerArrow": { // Can connect events or event logics, including exports of Components.
      if (thisCausal.tag === "Nothing") return false;
      const tc = thisCausal.value;
      switch (tc.tag) {
        case "CausalEvent": return true;
        case "CausalLogic": return logicIsEvent(tc._0.logicType);
        case "CausalInstance": {
          if (mChild.tag === "Nothing") return false;
          const exp = exportedChild(mChild.value);
          if (exp.tag === "Nothing") return false;
          switch (exp.value.tag) {
            case "CausalEvent": return true;
            case "CausalLogic": return logicIsEvent(exp.value._0.logicType);
            default: return false;
          }
        }
        default: return false;
      }
    }
    case "GuardArrow": // Can connect (State | State logic) -> (Event | State logic).
      switch (direction) {
        case "ConnectionFrom": {
          if (thisCausal.tag === "Nothing") return false;
          const tc = thisCausal.value;
          switch (tc.tag) {
            case "CausalState": return true;
            case "CausalLogic": return logicIsState(tc._0.logicType);
            case "CausalInstance": {
              if (mChild.tag === "Nothing") return false;
              const exp = exportedChild(mChild.value);
              if (exp.tag === "Nothing") return false;
              switch (exp.value.tag) {
                case "CausalState": return true;
                case "CausalLogic": return logicIsState(exp.value._0.logicType);
                default: return false;
              }
            }
            default: return false;
          }
        }
        case "ConnectionTo": {
          if (thisCausal.tag === "Nothing") return false;
          const tc = thisCausal.value;
          switch (tc.tag) {
            case "CausalEvent": return true;
            case "CausalLogic": return logicIsState(tc._0.logicType);
            case "CausalInstance": {
              if (mChild.tag === "Nothing") return false;
              const exp = exportedChild(mChild.value);
              if (exp.tag === "Nothing") return false;
              switch (exp.value.tag) {
                case "CausalEvent": return true;
                case "CausalLogic": return logicIsState(exp.value._0.logicType);
                default: return false;
              }
            }
            default: return false;
          }
        }
        default: return absurd(direction);
      }
    case "HazardArrow": return false; // Obsolete type.
    case "TraceArrow":
      switch (direction) {
        case "ConnectionFrom": {
          if (thisCausal.tag === "Nothing") return false;
          switch (thisCausal.value.tag) {
            case "CausalState": return true;
            case "CausalEvent": return true;
            default: return false;
          }
        }
        case "ConnectionTo": return (["GoalBox", "EvidenceBox"] as BoxType[]).includes(boxTyp);
        default: return absurd(direction);
      }
    default:
      return absurd(arrTyp);
  }
}

/**
 * An infinite list of boxes, stacked vertically starting a line and a half below the top
 * left of the argument and carrying on down. The boxes are high enough for 1 line of text until
 * they reach the bottom of the argument, at which point they become of infinitesmial height and
 * all superimposed at the bottom of the argument. A box that goes over the bottom of the argument
 * will be truncated.
 *
 * If the argument is "NoBox" then all the results will be "NoBox" too.
 *
 * (TypeScript: an infinite generator.)
 */
export function* childBoxes(box: BoundBox): Generator<BoundBox, never, unknown> {
  if (box.tag === "NoBox") {
    for (;;) yield NoBox;
  }
  const p1 = box._0;
  const p2 = box._1;
  const limit = (y: number): number => Math.min(view(pY, p2), y); // Limit the argument to the bottom of the box.
  const limit1 = (y: number): number => Math.min(view(pY, p2) + 0.001, y); // Infinitesimally below the bottom of the box.
  const crop = (b: BoundBox): BoundBox =>
    (b.tag === "NoBox" ? NoBox : BoundBox(over(pY, limit, b._0), over(pY, limit1, b._1)));
  // ys = iterate' (+(hadesFontSize*1.5+2)) (p1 ^. pY + hadesFontSize * 1.5)  -- Space for title.
  const step = hadesFontSize * 1.5 + 2;
  let y = view(pY, p1) + hadesFontSize * 1.5;
  for (;;) {
    const yNext = y + step;
    yield crop(BoundBox(mkPoint(view(pX, p1), y), mkPoint(view(pX, p2), yNext)));
    y = yNext;
  }
}

/** `childBoxes box !! n` */
function nthChildBox(n: number, box: BoundBox): BoundBox {
  const g = childBoxes(box);
  for (let i = 0; i < n; i++) g.next();
  return g.next().value;
}

/** TypeScript: a first-class causal script, i.e. a `ModelScriptAct` at `W = Causal<V>`. */
export type CausalScriptAct<V, A> = ModelScriptAct<HadesRender, V, Causal<V>, A>;

/** Context menu for causal entities in the model tree. */
export function causalEntityMenu<V>(
  cls: CausalBaseClass<V>,
  ent: Entity<V>,
  c: Causal<V>,
): Menu<CausalScriptAct<V, Maybe<string>>> {
  type Item = CausalScriptAct<V, Maybe<string>>;
  const insertEvent = (typ: EventType, nm: string): Item => function* (ctx) {
    const v = yield* insertEntity<HadesRender, V, Causal<V>>(
      ctx,
      review(cls._Causal, CausalEvent<V>(Event(typ, Name(nm), "", false))),
      ent.entityId,
    );
    return logInsertion(v);
  };
  const insertLogic = (typ: LogicType, nm: string): Item => function* (ctx) {
    const v = yield* insertEntity<HadesRender, V, Causal<V>>(
      ctx,
      review(cls._Causal, CausalLogic<V>(Logic(typ, Name(nm), false))),
      ent.entityId,
    );
    return logInsertion(v);
  };
  switch (c.tag) {
    case "CausalComponent":
      return append_Menu(Menu<Item>([[
        menuItem<Item>("Add Diagram", function* (ctx) {
          const v = yield* insertEntity<HadesRender, V, Causal<V>>(
            ctx,
            review(cls._Causal, CausalDiagram<V>(DiagramEntity(
              Name("Diagram "), mempty_Diagram<CausalNet<V>>(), mempty_DiagramAppearance as DiagramAppearance<CausalType<V>, V>))),
            ent.entityId,
          );
          return logInsertion(v);
        }),
        subMenu<Item>("Add Element", Menu<Item>([[
          menuItem<Item>("Simple Event", insertEvent("SimpleEvent", "Event ")),
          menuItem<Item>("Mishap Event", insertEvent("MishapEvent", "Mishap ")),
          menuItem<Item>("Control Event", insertEvent("ControlEvent", "Control ")),
        ], [
          menuItem<Item>("State", function* (ctx) {
            const v = yield* insertEntity<HadesRender, V, Causal<V>>(
              ctx,
              review(cls._Causal, CausalState<V>(State(Name("State "), "", false))),
              ent.entityId,
            );
            return logInsertion(v);
          }),
        ], [
          menuItem<Item>("Count Logic", insertLogic(LogicCountState(1), "Count ")),
          menuItem<Item>("AND State", insertLogic(LogicAndState, "AND-")),
          menuItem<Item>("AND Event", insertLogic(LogicAndEvent, "AND-")),
          menuItem<Item>("OR Event", insertLogic(LogicOrEvent, "OR-")),
        ]])),
      ]]), entityMenu<HadesRender, V, Causal<V>>(cls, ent));
    case "CausalDiagram":
      return diagramEntityMenu<HadesRender, V, Causal<V>>(cls, ent.entityId);
    default:
      return entityMenu<HadesRender, V, Causal<V>>(cls, ent);
  }
}

/** Toolbar for Causal Component diagrams. */
export function causalToolbar<V>(
  cls: CausalClass<V>,
  /** Entity ID of this diagram. */
  diagId: ModelId,
  /** Entity ID of the parent of this diagram. */
  owner: ModelId,
): DeltaToolbar<CausalNet<V>> {
  type D = CausalNet<V>;
  type DA = DiagramAppearance<CausalType<V>, V>;
  const dtc = DiagramTypeClass_CausalType(cls);
  const compile1 = (
    m: Model<V>,
    a: DA,
    ctx: GenericContext<CausalType<V>, V>,
  ): GenericContext<CausalType<V>, V> => fromRight(ctx, evalModelEdit(cls, cls._Causal, m,
    (c: ModelEditCtx<V, Causal<V>>) => compileAppearance(dtc, c, diagramAppearanceClean(a), ctx)));
  const mkCausalBox = (item: Causal<V>, shape: BoxType): Action<D> => mkScriptAction<D>(function* (d) {
    const base = scriptContext<V, Causal<V>>(d);
    goToEntity(base, owner);
    const parent = currentId(base);
    return yield* newBoxEntityTool(dtc, d, parent, review(cls._Causal, item), shape);
  });
  const mkArrowTool = (item: Causal<V>, shape: ArrowType): Action<D> => mkScriptAction<D>(function* (d) {
    const base = scriptContext<V, Causal<V>>(d);
    goToEntity(base, owner);
    const parent = currentId(base);
    return yield* newArrowEntityTool(dtc, d, false, parent, review(cls._Causal, item), shape);
  });
  const mkEventTool = (typ: EventType, nm: string): Action<D> =>
    mkCausalBox(CausalEvent<V>(Event(typ, Name(nm), "", false)), "EventBox");
  return DeltaToolbar<D>([[ // Left hand end.
    DeltaTool<D>("causal_event", "Event", DeltaToolAction(mkEventTool("SimpleEvent", "Event "))),
    DeltaTool<D>("causal_event_mishap", "Mishap", DeltaToolAction(mkEventTool("MishapEvent", "Mishap "))),
    DeltaTool<D>("causal_event_control", "Control", DeltaToolAction(mkEventTool("ControlEvent", "Control "))),
    DeltaTool<D>("causal_state", "State", DeltaToolAction(
      mkCausalBox(CausalState<V>(State(Name("State "), "", false)), "StateBox"))),
  ], [
    DeltaTool<D>("causal_logic_count", "State Count", DeltaToolAction(
      mkCausalBox(CausalLogic<V>(Logic(LogicCountState(1), Name("Count "), false)), "LogicBox"))),
    DeltaTool<D>("causal_logic_state_and", "State &", DeltaToolAction(
      mkCausalBox(CausalLogic<V>(Logic(LogicAndState, Name("AND-"), false)), "LogicBox"))),
    DeltaTool<D>("causal_logic_event_or", "Event OR", DeltaToolAction(
      mkCausalBox(CausalLogic<V>(Logic(LogicOrEvent, Name("OR-"), false)), "LogicBox"))),
    DeltaTool<D>("causal_logic_event_and", "Event AND", DeltaToolAction(
      mkCausalBox(CausalLogic<V>(Logic(LogicAndEvent, Name("AND-"), false)), "LogicBox"))),
  ], [
    DeltaTool<D>("causal_temporal", "Sequence", DeltaToolAction(
      mkArrowTool(CausalEdge<V>(TemporalEdge(Name("Sequence-"))), "TemporalArrow"))),
    DeltaTool<D>("causal_trigger", "Trigger", DeltaToolAction(
      mkArrowTool(CausalEdge<V>(TriggerEdge(Name("Trigger-"))), "TriggerArrow"))),
    DeltaTool<D>("causal_guard", "Guard", DeltaToolAction(
      mkArrowTool(CausalEdge<V>(GuardEdge(Name("Guard-"), false)), "GuardArrow"))),
  ], [
    DeltaTool<D>("trace-arrow", "Trace", DeltaToolAction(mkScriptAction<D>(function* (d) {
      const base = scriptContext<V, Causal<V>>(d);
      goToEntity(base, owner);
      const parent = currentId(base);
      return yield* newArrowEntityTool(dtc, d, false, parent, review(cls._Trace, Trace(Name("Trace"))), "TraceArrow");
    }))),
  ], [
    DeltaTool<D>("basic_comment", "Comment", DeltaToolAction(newCommentTool<CausalType<V>, V>())),
    DeltaTool<D>("emblem-symbolic-link", "Link", DeltaToolAction(newLinkTool(dtc))),
  ]], [
    alignmentTools<D>(),
    [viewControlTool<HadesRender, V, Causal<V>, DA, D>(
      diagId,
      _CausalDiagram<V>().dot(diagramEntityData<CausalNet<V>, DA>()),
      compile1,
      constantDialog(diagramAppearanceDialog<HadesRender, V, null, CausalType<V>>(cls, causalDiagramVariant)),
    )],
  ]); // Right hand end.
}

/** Context menu fragment for model packages allowing the user to add causal model entities. */
export function addCausalEntityMenu<V>(
  cls: EntityClass<V> & HasCausal<V>,
  parent: ModelId,
): Menu<CausalScriptAct<V, Maybe<string>>> {
  type Item = CausalScriptAct<V, Maybe<string>>;
  return Menu<Item>([[
    menuItem<Item>("Add Component", function* (ctx) {
      const v = yield* insertEntity<HadesRender, V, Causal<V>>(
        ctx,
        review(cls._Causal, CausalComponent<V>(ComponentModel<V>(Name("Component ")))),
        parent,
      );
      return logInsertion(v);
    }),
  ]]);
}

/** Icon name for causal entities. */
export function causalIcon<V>(c: Causal<V>): string {
  switch (c.tag) {
    case "CausalEvent":
      switch (c._0.eventType) {
        case "SimpleEvent": return "causal_event";
        case "MishapEvent": return "causal_event_mishap";
        case "ControlEvent": return "causal_event_control";
        default: return absurd(c._0.eventType);
      }
    case "CausalState": return "causal_state";
    case "CausalLogic":
      switch (c._0.logicType.tag) {
        case "LogicCountState": return "causal_logic_count";
        case "LogicAndState": return "causal_logic_state_and";
        case "LogicAndEvent": return "causal_logic_event_and";
        case "LogicOrEvent": return "causal_logic_event_or";
        default: return absurd(c._0.logicType);
      }
    case "CausalInstance": return "causal_instance";
    case "CausalEdge":
      switch (c._0.tag) {
        case "TemporalEdge": return "causal_temporal";
        case "TriggerEdge": return "causal_trigger";
        case "GuardEdge": return "causal_guard";
        default: return absurd(c._0);
      }
    case "CausalComponent": return "causal_component";
    case "CausalDiagram": return "causal_diagram";
    default: return absurd(c);
  }
}

/**
 * Activation script for causal entities.
 *
 * (TypeScript: `causalActivation(cls, mEnt)` is the `ActivationScript` applied to `mEnt`.)
 */
export function causalActivation<V>(cls: CausalBaseClass<V>, mEnt: Maybe<Entity<V>>): CausalScriptAct<V, Maybe<string>> {
  switch (mEnt.tag) {
    case "Nothing":
      // eslint-disable-next-line require-yield
      return function* (_ctx) {
        return Nothing; // Root does nothing on activation.
      };
    case "Just": {
      const e = mEnt.value;
      return function* (ctx) {
        const prsm = usingTraversal(ctx, (_c, p) => p);
        const c = preview(entityContents<V>().dot(prsm), e);
        if (c.tag === "Nothing") return Nothing;
        if (c.value.tag === "CausalDiagram") {
          yield* openDiagram<HadesRender, V, Causal<V>>(cls, ctx, e.entityId);
          return Nothing;
        }
        return yield* editEntityProperties<HadesRender, V, Causal<V>>(ctx, e.entityId);
      };
    }
    default:
      return absurd(mEnt);
  }
}

/** TypeScript: the `ActivationScript HadesRender v (Causal v)` value `causalActivation`. */
export function causalActivationScript<V>(cls: CausalBaseClass<V>): ActivationScript<HadesRender, V, Causal<V>> {
  return (mEnt) => causalActivation(cls, mEnt);
}

// ---------------------------------------------------------------------------------------------
// TypeScript helpers

/** `mconcat` of reference type tables (`<>` is right associative). */
function mconcatRefs<A>(ts: readonly RefTypeTable<A>[]): RefTypeTable<A> {
  return ts.reduceRight((acc, t) => append_RefTypeTable(t, acc));
}

/**
 * The text of a `Read` value with the white space and redundant parentheses around it removed,
 * as `readMaybe` (through `parens` and the lexer) accepts them.
 */
function stripReadParens(str: string): string {
  let s = str.trim();
  while (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  return s;
}

/**
 * `readPrec` at precedence 11 for an `Integer` constructor argument: a decimal (or @0x@/@0o@)
 * literal, possibly parenthesised; a negative number must be in parentheses.
 */
function readIntegerArg(str: string): Maybe<number> {
  let s = str.trim();
  let parens = false;
  while (s.startsWith("(") && s.endsWith(")")) {
    s = s.slice(1, -1).trim();
    parens = true;
  }
  const m = /^(-\s*)?(0[xX][0-9a-fA-F]+|0[oO][0-7]+|\d+)$/.exec(s);
  if (m === null) return Nothing;
  if (m[1] !== undefined && !parens) return Nothing;
  const lit = m[2];
  const n = /^0[oO]/.test(lit) ? parseInt(lit.slice(2), 8) : Number(lit);
  return Just(m[1] !== undefined ? -n : n);
}
