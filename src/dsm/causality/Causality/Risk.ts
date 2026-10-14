// Ported from dsm/causality/Causality/Risk.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Bow tie diagrams: hazards, the risk events that lead to and from them, the threat lines between
 * events and the controls that reduce or mitigate the risks.
 *
 * (The Haskell module header is empty.)
 *
 * TypeScript port
 * ---------------
 * * **Dictionaries.** `HasBowTie v` is the interface `HasBowTie<V>` (member `_BowTie`). The
 *   constraint set of the `DiagramTypeClass (BowTieType v) v` instance (`AppearanceClass
 *   (BowTieType v) v`, `Editable HadesRender v`, `EntityClass v`, `HasBowTie v`,
 *   `HasDiagrams HadesRender v`, `HasEvidence v`, `GSN.HasGsn v`, `HasLookups v`, `HasReports v`)
 *   is the single dictionary type `BowTieClass<V>`; the smaller set of the menus and activation
 *   (`EntityClass v`, `HasBowTie v`, `HasDiagrams HadesRender v`, `HasEvidence v`, `GSN.HasGsn v`,
 *   `Queryable v`) is `BowTieBaseClass<V>`. Constrained functions take the dictionary first, then
 *   the context (`ModelEditCtx` or `DeltaCtx`), then the Haskell arguments:
 *   `riskDiagramWrapper(cls, ctx, ent)`, `drawBowTieBox(cls, d, box, contents, border)`,
 *   `bowTieArrowCanConnect(cls, d, dir, arrow, box, child)`. The drawing functions take the
 *   `BoxShapeClass` dictionary of the shape first and then the model dictionary
 *   (`drawBowTieControlBox(shapeCls, cls, ...)`).
 * * **Data families.** `BowTieType v` has no values: it is the phantom interface `BowTieType<V>`
 *   whose members name the data family instances for "App.GenericDiagram": `BoxType` and
 *   `ArrowType` (string enumerations with a constant per constructor, `boxTypeValues`,
 *   `arrowTypeValues`) and `ModelSubtype<V>` (tagged union `BowTieHazard(h)` |
 *   `BowTieRiskEvent(r)` | `BowTieControl(c)` | `BowTieIsHazard(i)` | `BowTieThreat(t)` |
 *   `BowTieDiagram(d)`, also called `BowTie<V>`). `ElemBowTie<V>` is `Element<BowTieType<V>, V>`.
 *   The names `EventBox`, `StateBox`, `HazardBox`, `GoalBox`, `EvidenceBox`, `HazardArrow` and
 *   `TraceArrow` clash with those of "Causality.Model" and "GSN.Model": import one of the modules
 *   qualified (`import * as Risk from ...`).
 * * **The instance.** `DiagramTypeClass_BowTieType(cls)` is the `DiagramTypeClass (BowTieType v)
 *   v` dictionary (and the `GenericDiagramClass` of "App.GenericDiagram"). Like the GSN and causal
 *   ones it is `Object.create(cls)` plus the class methods, cached per `cls`, so
 *   `Avatar_Element(DiagramTypeClass_BowTieType(cls))` is always the same object.
 * * **Other instances:** `eq_ModelSubtype`, `JSON_ModelSubtype(cls)` (cached per `cls`; the diagram
 *   codec is built on first use), `Reflective_ModelSubtype()` (the instance has no context, so it
 *   is a single cached dictionary; the optional argument is ignored), with the aliases `eq_BowTie`,
 *   `JSON_BowTie`, `Reflective_BowTie`; `JSON_RiskEvent`, `JSON_Control`, `JSON_ThreatLine`,
 *   `JSON_IsHazard`, `JSON_Hazard`, `JSON_BoxType`, `show_BoxType`, `read_BoxType`,
 *   `JSON_ArrowType`, `show_ArrowType`, `read_ArrowType`. The derived `Eq` instances are the
 *   structural `equals`. The derived `Read` instances (used by the JSON parsers) are the
 *   `read_X(str): Maybe<X>` functions with the behaviour of `readMaybe` (surrounding white space
 *   and parentheses are accepted).
 * * **Records.** `RiskEvent`, `Control` and `Hazard` keep their Haskell field names
 *   (`_riskEventName`, ...); `ThreatLine` and `IsHazard` are newtypes with their own JSON
 *   instances, so they are records `{ _threatLineName }` and `{ _isHazardName }`. Lenses and isos
 *   on these monomorphic types are constants; optics on the polymorphic `BowTie v` are
 *   zero-argument functions (`_BowTieHazard<V>()`, `bowTieName<V>()`).
 * * **Scripts** are `BowTieScriptAct<V, A>`, i.e. `ModelScriptAct` at `W = BowTie<V>`.
 *   `bowTieActivation(cls, mEnt)` returns the script of the `ActivationScript`
 *   (`bowTieActivationScript(cls)` is the `ActivationScript` itself).
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, fromRight } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { absurd, readEnum } from "@/lib/Prelude";
import {
  _Just, iso, lens, preview, prism, review, set, to, view,
  type Iso, type Lens, type Prism, type StateCell, type Traversal,
} from "@/lib/Control/Lens";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { type Colour, Colour as mkColour } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  type Action, type BoxShapeClass, type ConnectionDirection, type Delta, type DeltaCtx,
  type DiagramId, type Point,
  BoundBox, BoxShapeClass_Oval, BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, DeltaTool,
  DeltaToolAction, DeltaToolbar, Oval, Parallelogram, Rectangle, alignmentTools, mempty_Diagram,
  mkScriptAction, rectangleCorners,
} from "@/hades/src/Hades/Abstract";
import {
  type ArrowHead, type HadesLayout, type HadesRender,
  basicBox, closedArrowHead, drawPolygon, layoutParagraphGap, layoutTitle, local, openArrowHead,
  runLayout_, withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";
import {
  type AppearanceClass, type DiagramAppearance, diagramAppearanceClean, diagramAppearanceDialog,
  mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import {
  type Arrow, type AvatarCreation, type Box, type DiagramTypeClass, type Element,
  type GenericDiagramClass, Avatar_Element, Box as mkGenericBox, GenericContext, JSON_Element,
  NoAvatar, SimpleArrow, SimpleBox, compileAppearance, diagramTypeClassDefaults, elementDialog,
  mempty_AppearanceDef, newArrowEntityTool, newBoxEntityTool, newCommentTool, newLinkTool,
} from "@/hades/src/App/GenericDiagram";
import {
  type HasEvidence, Trace, drawEvidence, evidenceVariant, traceArrowDash, traceArrowHead,
  traceHeadRelation, traceTailRelation,
} from "@/hades/evidence/Evidence/Model";
import * as GSN from "@/dsm/gsn/GSN/Model";
import {
  bowTieDiagramVariant, bowTieRiskEventVariant, causalControlVariant, causalHazardVariant,
  controlThreatRelation, hazardEdgeVariant, threatEdgeVariant,
} from "./FieldNames";
import { eventVariants } from "./Model";
import {
  type ActivationScript, type DiagramEntityTypes, type Editable, type EntityWrapper,
  type HasDiagrams, type ModelScriptAct, DiagramEntity, DiagramWrapper, JSON_DiagramEntity,
  diagramEntityData, diagramEntityMenu, diagramEntityName, editEntityProperties, entityMenu,
  eq_DiagramEntity, insertEntity, openDiagram, scriptContext, viewControlTool,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId, JSON_Name, Name,
  checkType, current, descriptionField, entityContents, evalModelEdit, goToEntity, nameField,
  nameText, usingTraversal,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { Queryable } from "@/hades/src/Model/Query/Diagram";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import {
  type RefTypeTable, append_RefTypeTable, arrowRelations, mkManyToMany,
} from "@/hades/src/Model/Reflection/References";
import { type Reflective, extract } from "@/hades/src/Model/Reflection/Reflective";
import { type ExtensionValues, ExtText, Variant, _ExtText, variantName } from "@/hades/src/Model/Reflection/Values";
import type { HasReports } from "@/hades/src/Model/Report/Base";

// ---------------------------------------------------------------------------------------------
// Classes and dictionaries

export interface HasBowTie<V> {
  readonly _BowTie: Prism<V, BowTie<V>>;
}

/**
 * TypeScript: the dictionary for the context of the `DiagramTypeClass (BowTieType v) v` instance
 * and of most functions below: `(AppearanceClass (BowTieType v) v, Editable HadesRender v,
 * EntityClass v, HasBowTie v, HasDiagrams HadesRender v, HasEvidence v, GSN.HasGsn v,
 * HasLookups v, HasReports v)`. It includes `Queryable v`, a superclass of `HasReports v`.
 */
export type BowTieClass<V> =
  AppearanceClass<BowTieType<V>, V> & Editable<HadesRender, V> & EntityClass<V> &
  HasBowTie<V> & HasDiagrams<HadesRender, V> & HasEvidence<V> & GSN.HasGsn<V> & HasLookups<V> &
  HasReports<V>;

/**
 * TypeScript: the dictionary for `(EntityClass v, HasBowTie v, HasDiagrams HadesRender v,
 * HasEvidence v, GSN.HasGsn v, Queryable v)`, the context of "bowTieEntityMenu" and
 * "bowTieActivation".
 */
export type BowTieBaseClass<V> =
  EntityClass<V> & HasBowTie<V> & HasDiagrams<HadesRender, V> & HasEvidence<V> & GSN.HasGsn<V> &
  Queryable<V>;

// ---------------------------------------------------------------------------------------------
// Model entities

/** A model entity representing a possible high-level event in a bow-tie diagram. */
export interface RiskEvent {
  readonly _riskEventName: Name;
  readonly _riskEventText: string;
}
export function RiskEvent(_riskEventName: Name, _riskEventText: string): RiskEvent {
  return { _riskEventName, _riskEventText };
}

/** `instance ToJSON RiskEvent` and `instance FromJSON RiskEvent` */
export const JSON_RiskEvent: J.JSONCodec<RiskEvent> = J.codec(
  (risk) => J.object([
    ["type", "RiskEvent"],
    ["name", JSON_Name.toJSON(view(riskEventName, risk))],
    ["text", view(riskEventText, risk)],
  ]),
  (val) => J.withObject("Bow Tie Event", (v) => {
    checkType(v, "RiskEvent");
    const nm = J.field(v, "name", JSON_Name);
    const txt = J.field(v, "text", J.textJ);
    return RiskEvent(nm, txt);
  }, val),
);

export const riskEventName: Lens<RiskEvent, Name> =
  lens((r: RiskEvent) => r._riskEventName, (r, nm: Name): RiskEvent => ({ ...r, _riskEventName: nm }));

export const riskEventText: Lens<RiskEvent, string> =
  lens((r: RiskEvent) => r._riskEventText, (r, txt: string): RiskEvent => ({ ...r, _riskEventText: txt }));

/** A model entity representing some way to reduce or mitigate a risk. */
export interface Control {
  readonly _controlName: Name;
  readonly _controlText: string;
}
export function Control(_controlName: Name, _controlText: string): Control {
  return { _controlName, _controlText };
}

/** `instance ToJSON Control` and `instance FromJSON Control` */
export const JSON_Control: J.JSONCodec<Control> = J.codec(
  (ctrl) => J.object([
    ["type", "Control"],
    ["name", JSON_Name.toJSON(view(controlName, ctrl))],
    ["text", view(controlText, ctrl)],
  ]),
  (val) => J.withObject("Control", (v) => {
    checkType(v, "Control");
    const nm = J.field(v, "name", JSON_Name);
    const txt = J.field(v, "text", J.textJ);
    return Control(nm, txt);
  }, val),
);

export const controlName: Lens<Control, Name> =
  lens((c: Control) => c._controlName, (c, nm: Name): Control => ({ ...c, _controlName: nm }));

export const controlText: Lens<Control, string> =
  lens((c: Control) => c._controlText, (c, txt: string): Control => ({ ...c, _controlText: txt }));

/** An edge representing a risk that one event will lead to another. */
export interface ThreatLine {
  readonly _threatLineName: Name;
}
export function ThreatLine(_threatLineName: Name): ThreatLine {
  return { _threatLineName };
}

/** `instance ToJSON ThreatLine` and `instance FromJSON ThreatLine` */
export const JSON_ThreatLine: J.JSONCodec<ThreatLine> = J.codec(
  (r) => J.object([
    ["type", "ThreatLine"],
    ["name", JSON_Name.toJSON(view(threatLineName, r))],
  ]),
  (val) => J.withObject("ThreatLine", (v) => {
    // Early version used incorrect name.
    J.alt<void>(() => checkType(v, "RiskLine"), () => checkType(v, "ThreatLine"))(v);
    return ThreatLine(J.field(v, "name", JSON_Name));
  }, val),
);

export const threatLineName: Iso<ThreatLine, Name> =
  iso((t: ThreatLine) => t._threatLineName, (nm: Name) => ThreatLine(nm));

/** An edge representing a link from an event to a hazard. */
export interface IsHazard {
  readonly _isHazardName: Name;
}
export function IsHazard(_isHazardName: Name): IsHazard {
  return { _isHazardName };
}

/** `instance ToJSON IsHazard` and `instance FromJSON IsHazard` */
export const JSON_IsHazard: J.JSONCodec<IsHazard> = J.codec(
  (h) => J.object([
    ["type", "IsHazard"],
    ["name", JSON_Name.toJSON(view(isHazardName, h))],
  ]),
  (val) => J.withObject("IsHazard", (v) => {
    checkType(v, "IsHazard");
    return IsHazard(J.field(v, "name", JSON_Name));
  }, val),
);

export const isHazardName: Iso<IsHazard, Name> =
  iso((h: IsHazard) => h._isHazardName, (nm: Name) => IsHazard(nm));

/** A node representing a hazard in the system being modelled. */
export interface Hazard {
  readonly _hazardName: Name;
  readonly _hazardText: string;
}
export function Hazard(_hazardName: Name, _hazardText: string): Hazard {
  return { _hazardName, _hazardText };
}

/** `instance ToJSON Hazard` and `instance FromJSON Hazard` */
export const JSON_Hazard: J.JSONCodec<Hazard> = J.codec(
  (h) => J.object([
    ["type", "Hazard"],
    ["name", JSON_Name.toJSON(view(hazardName, h))],
    ["text", view(hazardText, h)],
  ]),
  (val) => J.withObject("Hazard", (v) => {
    checkType(v, "Hazard");
    const nm = J.field(v, "name", JSON_Name);
    const txt = J.field(v, "text", J.textJ);
    return Hazard(nm, txt);
  }, val),
);

export const hazardName: Lens<Hazard, Name> =
  lens((h: Hazard) => h._hazardName, (h, nm: Name): Hazard => ({ ...h, _hazardName: nm }));

export const hazardText: Lens<Hazard, string> =
  lens((h: Hazard) => h._hazardText, (h, txt: string): Hazard => ({ ...h, _hazardText: txt }));

// ---------------------------------------------------------------------------------------------
// The bow tie diagram type

/**
 * Unit type that exists only for its instances.
 *
 * (TypeScript: a phantom type that is never instantiated. Its members name the associated data
 * family instances for "App.GenericDiagram": `BoxType (BowTieType v)`, `ArrowType (BowTieType v)`
 * and `ModelSubtype (BowTieType v)`. The unit constructor `BowTieType` is never used in Haskell
 * either — `diagramTypeName` ignores its argument — so it has no value counterpart.)
 */
export interface BowTieType<V> {
  readonly BoxType: BoxType;
  readonly ArrowType: ArrowType;
  readonly ModelSubtype: ModelSubtype<V>;
}

/** `data BoxType (BowTieType v)` (derived `Read`, `Show`, `Eq`). */
export type BoxType =
  | "EventBox" | "StateBox" | "RiskEventBox" | "ControlBox" | "HazardBox" | "GoalBox" | "EvidenceBox";
export const boxTypeValues: readonly BoxType[] = [
  "EventBox", "StateBox", "RiskEventBox", "ControlBox", "HazardBox", "GoalBox", "EvidenceBox",
];
export const EventBox: BoxType = "EventBox";
export const StateBox: BoxType = "StateBox";
export const RiskEventBox: BoxType = "RiskEventBox";
export const ControlBox: BoxType = "ControlBox";
export const HazardBox: BoxType = "HazardBox";
export const GoalBox: BoxType = "GoalBox";
export const EvidenceBox: BoxType = "EvidenceBox";

/** Derived `Show (BoxType (BowTieType v))`. */
export function show_BoxType(b: BoxType): string {
  return b;
}

/** Derived `Read (BoxType (BowTieType v))`, as `readMaybe`. */
export function read_BoxType(str: string): Maybe<BoxType> {
  return readEnum(boxTypeValues, stripReadParens(str));
}

/** `data ArrowType (BowTieType v)` (derived `Read`, `Show`, `Eq`). */
export type ArrowType = "RiskArrow" | "HazardArrow" | "TraceArrow";
export const arrowTypeValues: readonly ArrowType[] = ["RiskArrow", "HazardArrow", "TraceArrow"];
export const RiskArrow: ArrowType = "RiskArrow";
export const HazardArrow: ArrowType = "HazardArrow";
export const TraceArrow: ArrowType = "TraceArrow";

/** Derived `Show (ArrowType (BowTieType v))`. */
export function show_ArrowType(a: ArrowType): string {
  return a;
}

/** Derived `Read (ArrowType (BowTieType v))`, as `readMaybe`. */
export function read_ArrowType(str: string): Maybe<ArrowType> {
  return readEnum(arrowTypeValues, stripReadParens(str));
}

/** `data ModelSubtype (BowTieType v)` */
export type ModelSubtype<V> =
  | { readonly tag: "BowTieHazard"; readonly _0: Hazard }
  | { readonly tag: "BowTieRiskEvent"; readonly _0: RiskEvent }
  | { readonly tag: "BowTieControl"; readonly _0: Control }
  | { readonly tag: "BowTieIsHazard"; readonly _0: IsHazard }
  | { readonly tag: "BowTieThreat"; readonly _0: ThreatLine }
  | { readonly tag: "BowTieDiagram"; readonly _0: BowTieDiagram<V> };
export function BowTieHazard<V = any>(_0: Hazard): ModelSubtype<V> {
  return { tag: "BowTieHazard", _0 };
}
export function BowTieRiskEvent<V = any>(_0: RiskEvent): ModelSubtype<V> {
  return { tag: "BowTieRiskEvent", _0 };
}
export function BowTieControl<V = any>(_0: Control): ModelSubtype<V> {
  return { tag: "BowTieControl", _0 };
}
export function BowTieIsHazard<V = any>(_0: IsHazard): ModelSubtype<V> {
  return { tag: "BowTieIsHazard", _0 };
}
export function BowTieThreat<V = any>(_0: ThreatLine): ModelSubtype<V> {
  return { tag: "BowTieThreat", _0 };
}
export function BowTieDiagram<V = any>(_0: BowTieDiagram<V>): ModelSubtype<V> {
  return { tag: "BowTieDiagram", _0 };
}

/**
 * TypeScript: the members that the `DiagramTypeClass (BowTieType v) v` instance defines (the
 * class methods and the superclass codecs); the `HasDiagrams` superclass members come from the
 * model dictionary (see "DiagramTypeClass_BowTieType").
 */
export type BowTieDiagramTypeMethods<V> =
  Omit<DiagramTypeClass<BowTieType<V>, V>, keyof HasDiagrams<HadesRender, V>>;

/**
 * TypeScript: the type of the `DiagramTypeClass (BowTieType v) v` dictionary. It is also the
 * `GenericDiagramClass` dictionary of "App.GenericDiagram" for bow tie diagrams.
 */
export type BowTieDiagramTypeClass<V> = BowTieClass<V> & GenericDiagramClass<BowTieType<V>, V>;

const bowTieDiagramTypeClasses = new WeakMap<object, BowTieDiagramTypeClass<any>>();

/**
 * ```haskell
 * instance (
 *     AppearanceClass (BowTieType v) v, Editable HadesRender v, EntityClass v, HasBowTie v,
 *     HasDiagrams HadesRender v, HasEvidence v, GSN.HasGsn v, HasLookups v, HasReports v) =>
 *   DiagramTypeClass (BowTieType v) v
 * ```
 *
 * (TypeScript: the dictionary delegates to `cls` for all its other members; see the module
 * header. The result is cached per `cls`.)
 */
export function DiagramTypeClass_BowTieType<V>(cls: BowTieClass<V>): BowTieDiagramTypeClass<V> {
  const cached = bowTieDiagramTypeClasses.get(cls);
  if (cached !== undefined) return cached as BowTieDiagramTypeClass<V>;
  type B = Box<BowTieType<V>, V>;
  type D = ElemBowTie<V>;
  type AC = AvatarCreation<BowTieType<V>, V>;
  const methods: BowTieDiagramTypeMethods<V> = {
    ...diagramTypeClassDefaults<BowTieType<V>, V>(),
    boxTypeJ: JSON_BoxType,
    arrowTypeJ: JSON_ArrowType,
    mkBox: (diagId, modelId, typ, peg, bound) => {
      switch (typ) {
        case "EventBox": return mkGenericBox(BoxShapeClass_Parallelogram, diagId, modelId, typ, peg, Parallelogram(bound));
        case "StateBox": return mkGenericBox(BoxShapeClass_Oval, diagId, modelId, typ, peg, Oval(bound));
        case "RiskEventBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "ControlBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "HazardBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "GoalBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "EvidenceBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        default: return absurd(typ);
      }
    },
    boxTypeDraw: (d, box, contents, border) => drawBowTieBox(cls, d, box, contents, border),
    // boxChildren = const $ return []
    // eslint-disable-next-line require-yield
    boxChildren: function* (_d: DeltaCtx<D>, _box: B): Delta<D, [DiagramId, (p: Point) => boolean][]> {
      return [];
    },
    // boxChildConnection _ _ = return id
    // eslint-disable-next-line require-yield
    boxChildConnection: function* (_d: DeltaCtx<D>, _box: B, _child: DiagramId): Delta<D, (p: Point) => Point> {
      return (p: Point) => p;
    },
    // eslint-disable-next-line require-yield
    boxCanPeg: function* (_d: DeltaCtx<D>, box: B, arrow: Arrow<BowTieType<V>, V>): Delta<D, Maybe<NR.Relation>> {
      if ((box.boxType as BoxType) === "ControlBox" && (arrow.arrowType as ArrowType) === "RiskArrow") {
        return Just(controlThreatRelation);
      }
      return Nothing;
    },
    avatarType: (prsm: Traversal<V, BowTie<V>>, v: V): AC => {
      const b = preview(prsm, v);
      if (b.tag === "Just") {
        switch (b.value.tag) {
          case "BowTieHazard": return SimpleBox<BowTieType<V>, V>("HazardBox");
          case "BowTieRiskEvent": return SimpleBox<BowTieType<V>, V>("RiskEventBox");
          case "BowTieControl": return SimpleBox<BowTieType<V>, V>("ControlBox");
          case "BowTieIsHazard": return SimpleArrow<BowTieType<V>, V>("HazardArrow");
          case "BowTieThreat": return SimpleArrow<BowTieType<V>, V>("RiskArrow");
          case "BowTieDiagram": return NoAvatar as AC;
          default: return absurd(b.value);
        }
      }
      const nodeType = preview(cls._Gsn.dot(GSN._GsnNodeItem<V>()).dot(to(GSN.gsnNodeType)), v);
      if (equals(nodeType, Just(GSN.GoalBox))) return SimpleBox<BowTieType<V>, V>("GoalBox");
      if (preview(cls._Evidence, v).tag === "Just") return SimpleBox<BowTieType<V>, V>("EvidenceBox");
      if (preview(cls._Trace, v).tag === "Just") return SimpleArrow<BowTieType<V>, V>("TraceArrow");
      return NoAvatar as AC;
    },
    diagramTypeName: (_t) => "Bow Tie",
    arrowTailRelation: (a) => (a === "TraceArrow" ? traceTailRelation : NR.edgeFromRelation),
    arrowHeadRelation: (a) => (a === "TraceArrow" ? traceHeadRelation : NR.edgeToRelation),
    arrowTailExportRelation: (_a) => Nothing,
    arrowHeadExportRelation: (_a) => Nothing,
    arrowHeadDraw: (_w, a): ArrowHead => {
      switch (a) {
        case "RiskArrow": return openArrowHead(45, 10);
        case "HazardArrow": return closedArrowHead(90, 10, false);
        case "TraceArrow": return traceArrowHead;
        default: return absurd(a);
      }
    },
    arrowLineDashes: (a) => (a === "TraceArrow" ? [...traceArrowDash] : []),
    arrowCanConnect: (d, dir, arrow, box, child) => bowTieArrowCanConnect(cls, d, dir, arrow, box, child),
  };
  const dict = Object.assign(Object.create(cls) as object, methods) as BowTieDiagramTypeClass<V>;
  bowTieDiagramTypeClasses.set(cls, dict);
  return dict;
}

/**
 * ```haskell
 * instance (...) => Eq (ModelSubtype (BowTieType v))
 * ```
 */
export function eq_ModelSubtype<V>(x: ModelSubtype<V>, y: ModelSubtype<V>): boolean {
  if (x.tag === "BowTieHazard" && y.tag === "BowTieHazard") return equals(x._0, y._0);
  if (x.tag === "BowTieRiskEvent" && y.tag === "BowTieRiskEvent") return equals(x._0, y._0);
  if (x.tag === "BowTieControl" && y.tag === "BowTieControl") return equals(x._0, y._0);
  if (x.tag === "BowTieIsHazard" && y.tag === "BowTieIsHazard") return equals(x._0, y._0);
  if (x.tag === "BowTieThreat" && y.tag === "BowTieThreat") return equals(x._0, y._0);
  if (x.tag === "BowTieDiagram" && y.tag === "BowTieDiagram") return eq_DiagramEntity(x._0, y._0);
  return false;
}

/** `instance ToJSON (BoxType (BowTieType v))` and `instance FromJSON (BoxType (BowTieType v))` */
export const JSON_BoxType: J.JSONCodec<BoxType> = J.codec(
  (b) => T.pack(show_BoxType(b)),
  (v) => J.withText("Bow Tie Box type", (str): BoxType => {
    const r = read_BoxType(T.unpack(str));
    switch (r.tag) {
      case "Just": return r.value;
      case "Nothing": return J.fail("Not a Bow Tie Box type: " + T.showText(str));
      default: return absurd(r);
    }
  }, v),
);

/** `instance ToJSON (ArrowType (BowTieType v))` and `instance FromJSON (ArrowType (BowTieType v))` */
export const JSON_ArrowType: J.JSONCodec<ArrowType> = J.codec(
  (a) => T.pack(show_ArrowType(a)),
  (v) => J.withText("Bow Tie Arrow type", (str): ArrowType => {
    const r = read_ArrowType(T.unpack(str));
    switch (r.tag) {
      case "Just": return r.value;
      case "Nothing": return J.fail("Not a Bow Tie Arrow type: " + T.showText(str));
      default: return absurd(r);
    }
  }, v),
);

/** TypeScript: cache of "JSON_ModelSubtype", per model dictionary. */
const bowTieCodecs = new WeakMap<object, J.JSONCodec<ModelSubtype<any>>>();

/**
 * ```haskell
 * instance (...) => ToJSON (ModelSubtype (BowTieType v))
 * instance (...) => FromJSON (ModelSubtype (BowTieType v))
 * ```
 *
 * (TypeScript: cached per `cls`; the diagram codec is built on first use, so that a model
 * dictionary can include this codec while it is being built.)
 */
export function JSON_ModelSubtype<V>(cls: BowTieClass<V>): J.JSONCodec<ModelSubtype<V>> {
  const cached = bowTieCodecs.get(cls);
  if (cached !== undefined) return cached as J.JSONCodec<ModelSubtype<V>>;
  let diagramJ: J.JSONCodec<BowTieDiagram<V>> | null = null;
  const diagramCodec = (): J.JSONCodec<BowTieDiagram<V>> => {
    if (diagramJ === null) {
      const dtc = DiagramTypeClass_BowTieType(cls);
      diagramJ = JSON_DiagramEntity<ElemBowTie<V>, DiagramAppearance<BowTieType<V>, V>>(
        Avatar_Element(dtc), JSON_Element(dtc));
    }
    return diagramJ;
  };
  const codec = J.codec<ModelSubtype<V>>(
    // All the variant types have a "type" field in their JSON.
    (item) => {
      switch (item.tag) {
        case "BowTieHazard": return JSON_Hazard.toJSON(item._0);
        case "BowTieRiskEvent": return JSON_RiskEvent.toJSON(item._0);
        case "BowTieControl": return JSON_Control.toJSON(item._0);
        case "BowTieIsHazard": return JSON_IsHazard.toJSON(item._0);
        case "BowTieThreat": return JSON_ThreatLine.toJSON(item._0);
        case "BowTieDiagram": return diagramCodec().toJSON(item._0);
        default: return absurd(item);
      }
    },
    (v) => J.alt<ModelSubtype<V>>(
      (v1) => BowTieHazard<V>(JSON_Hazard.parseJSON(v1)),
      (v1) => BowTieRiskEvent<V>(JSON_RiskEvent.parseJSON(v1)),
      (v1) => BowTieControl<V>(JSON_Control.parseJSON(v1)),
      (v1) => BowTieIsHazard<V>(JSON_IsHazard.parseJSON(v1)),
      (v1) => BowTieThreat<V>(JSON_ThreatLine.parseJSON(v1)),
      (v1) => BowTieDiagram<V>(diagramCodec().parseJSON(v1)),
    )(v),
  );
  bowTieCodecs.set(cls, codec);
  return codec;
}

/** TypeScript: the single "Reflective_ModelSubtype" dictionary (the instance has no context). */
let bowTieReflective: Reflective<ModelSubtype<any>> | null = null;

/**
 * ```haskell
 * instance Reflective (ModelSubtype (BowTieType v))
 * ```
 *
 * (TypeScript: the instance has no context, so this is one shared dictionary; the optional
 * argument, a model dictionary, is accepted for symmetry with the GSN and causal instances and
 * ignored. `reflectiveDefaults` is a memoised getter.)
 */
export function Reflective_ModelSubtype<V = any>(_cls?: unknown): Reflective<ModelSubtype<V>> {
  if (bowTieReflective !== null) return bowTieReflective as Reflective<ModelSubtype<V>>;
  type Item = ModelSubtype<any>;
  let defaults: readonly Item[] | null = null;
  const refl: Reflective<Item> = {
    reflectiveName: (item) => {
      switch (item.tag) {
        case "BowTieHazard": return causalHazardVariant;
        case "BowTieRiskEvent": return bowTieRiskEventVariant;
        case "BowTieControl": return causalControlVariant;
        case "BowTieIsHazard": return hazardEdgeVariant;
        case "BowTieThreat": return threatEdgeVariant;
        case "BowTieDiagram": return bowTieDiagramVariant;
        default: return absurd(item);
      }
    },
    variantUserLabel: (v) => (v === bowTieRiskEventVariant ? "Event" : view(variantName<Item>(), v)),
    get reflectiveDefaults(): readonly Item[] {
      if (defaults === null) {
        defaults = [
          BowTieHazard(Hazard(Name("HAZ-"), "")),
          BowTieRiskEvent(RiskEvent(Name("Risk-"), "")),
          BowTieControl(Control(Name("Ctrl-"), "")),
          BowTieIsHazard(IsHazard(Name("is-hazard-"))),
          BowTieThreat(ThreatLine(Name("ThreatLine-"))),
          BowTieDiagram(DiagramEntity(Name("Bow Tie"), mempty_Diagram<ElemBowTie<any>>(),
            mempty_DiagramAppearance as DiagramAppearance<BowTieType<any>, any>)),
        ];
      }
      return defaults;
    },
    reflectiveBuiltIn: (item) => {
      switch (item.tag) {
        case "BowTieHazard": return [nameField, descriptionField];
        case "BowTieRiskEvent": return [nameField, descriptionField];
        case "BowTieControl": return [nameField, descriptionField];
        case "BowTieIsHazard": return [nameField];
        case "BowTieThreat": return [nameField];
        case "BowTieDiagram": return [nameField];
        default: return absurd(item);
      }
    },
    reflectiveGet: (item) => {
      switch (item.tag) {
        case "BowTieHazard": {
          const { _hazardName: { _0: nm }, _hazardText: txt } = item._0;
          return M.fromList([[nameField, ExtText(nm)], [descriptionField, ExtText(txt)]]);
        }
        case "BowTieRiskEvent": {
          const { _riskEventName: { _0: nm }, _riskEventText: txt } = item._0;
          return M.fromList([[nameField, ExtText(nm)], [descriptionField, ExtText(txt)]]);
        }
        case "BowTieControl": {
          const { _controlName: { _0: nm }, _controlText: txt } = item._0;
          return M.fromList([[nameField, ExtText(nm)], [descriptionField, ExtText(txt)]]);
        }
        case "BowTieIsHazard": return M.singleton(nameField, ExtText(item._0._isHazardName._0));
        case "BowTieThreat": return M.singleton(nameField, ExtText(item._0._threatLineName._0));
        case "BowTieDiagram":
          return M.singleton(nameField, ExtText(view(diagramEntityName().dot(nameText), item._0)));
        default: return absurd(item);
      }
    },
    reflectiveSet: (st: StateCell<ExtensionValues>, item: Item): Item => {
      switch (item.tag) {
        case "BowTieHazard": {
          const h = item._0;
          const nm = Name(T.strip(extract(st, view(hazardName.dot(nameText), h), _ExtText, nameField)));
          const txt = extract(st, view(hazardText, h), _ExtText, descriptionField);
          return BowTieHazard(Hazard(nm, txt));
        }
        case "BowTieRiskEvent": {
          const r = item._0;
          const nm = Name(T.strip(extract(st, view(riskEventName.dot(nameText), r), _ExtText, nameField)));
          const txt = extract(st, view(riskEventText, r), _ExtText, descriptionField);
          return BowTieRiskEvent(RiskEvent(nm, txt));
        }
        case "BowTieControl": {
          const c = item._0;
          const nm = Name(T.strip(extract(st, view(controlName.dot(nameText), c), _ExtText, nameField)));
          const txt = extract(st, view(controlText, c), _ExtText, descriptionField);
          return BowTieControl(Control(nm, txt));
        }
        case "BowTieIsHazard": {
          const i = item._0;
          return BowTieIsHazard(IsHazard(Name(T.strip(
            extract(st, view(isHazardName.dot(nameText), i), _ExtText, nameField)))));
        }
        case "BowTieThreat": {
          const r = item._0;
          return BowTieThreat(ThreatLine(Name(T.strip(
            extract(st, view(threatLineName.dot(nameText), r), _ExtText, nameField)))));
        }
        case "BowTieDiagram": {
          const d = item._0;
          const nm = Name(T.strip(extract(st, view(diagramEntityName().dot(nameText), d), _ExtText, nameField)));
          return BowTieDiagram(set(diagramEntityName<ElemBowTie<any>, DiagramAppearance<BowTieType<any>, any>>(), nm, d));
        }
        default: return absurd(item);
      }
    },
    reflectiveBuiltInRefs: mconcatRefs<Item>([
      arrowRelations<Item>(hazardEdgeVariant,
        [bowTieRiskEventVariant, ...eventVariants],
        [causalHazardVariant]),
      arrowRelations<Item>(threatEdgeVariant,
        [bowTieRiskEventVariant, ...eventVariants],
        [causalControlVariant, bowTieRiskEventVariant, ...eventVariants]),
      mkManyToMany<Item>(controlThreatRelation, [causalControlVariant], [threatEdgeVariant]),
    ]),
    reflectiveArrows: M.fromList<Variant<Item>, readonly [NR.Relation, NR.Relation]>([
      [hazardEdgeVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
      [threatEdgeVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
    ]),
  };
  bowTieReflective = refl;
  return refl as Reflective<ModelSubtype<V>>;
}

/** Alias of "eq_ModelSubtype": `BowTie v` is `ModelSubtype (BowTieType v)`. */
export const eq_BowTie = eq_ModelSubtype;
/** Alias of "JSON_ModelSubtype". */
export const JSON_BowTie = JSON_ModelSubtype;
/** Alias of "Reflective_ModelSubtype". */
export const Reflective_BowTie = Reflective_ModelSubtype;

/** True if this is a diagram. */
export function riskIsDiagram<V>(b: BowTie<V>): boolean {
  return b.tag === "BowTieDiagram";
}

/**
 * The wrapper for Bow Tie diagrams.
 *
 * (A `ModelEdit v (BowTie v)`. From a `getDiagramWrapper(ctx, e)` at the top-level type use
 * `withSubtype(ctx, cls._BowTie, (c) => riskDiagramWrapper(cls, c, e))`.)
 */
export function riskDiagramWrapper<V>(
  cls: BowTieClass<V>,
  ctx: ModelEditCtx<V, BowTie<V>>,
  ent: Entity<V>,
): Maybe<EntityWrapper<HadesRender, V>> {
  return usingTraversal(ctx, (c, trv) => {
    const mde = preview(entityContents<V>().dot(trv).dot(_BowTieDiagram<V>()), ent);
    switch (mde.tag) {
      case "Nothing":
        return Nothing;
      case "Just": {
        const de = mde.value;
        const dtc = DiagramTypeClass_BowTieType(cls);
        const vctx = compileAppearance(
          dtc,
          c,
          view(diagramEntityData<ElemBowTie<V>, DiagramAppearance<BowTieType<V>, V>>(), de),
          GenericContext(ent.entityId, mempty_AppearanceDef),
        );
        return Just(DiagramWrapper<HadesRender, V, BowTie<V>, ElemBowTie<V>>(
          Avatar_Element(dtc),
          /* wrappedEntityId = */ ent.entityId,
          /* diagramToEdit = */ de._diagramEntityContents,
          /* diagramEntityTraversal = */ _BowTieDiagram<V>(),
          /* diagramTraversal = */ trv,
          /* diagramDialog = */ elementDialog(dtc),
          /* diagramContext = */ vctx,
          /* diagramMenu = */ Nothing,
          /* diagramToolbar = */ (_) => bowTieToolbar(cls, ent.entityId, ent._entityParent),
        ));
      }
      default:
        return absurd(mde);
    }
  });
}

export const riskDiagramEntityTypes: DiagramEntityTypes<any> = M.fromList<Variant<any>, readonly Variant<any>[]>([
  [bowTieDiagramVariant, [
    causalHazardVariant, bowTieRiskEventVariant, causalControlVariant, evidenceVariant,
  ]],
]);

/** Bow tie diagram type. */
export type BowTieDiagram<V> = DiagramEntity<ElemBowTie<V>, DiagramAppearance<BowTieType<V>, V>>;

/** Elements that can appear in bow tie diagrams. */
export type ElemBowTie<V> = Element<BowTieType<V>, V>;

/** The bow tie subtype of model entities. */
export type BowTie<V> = ModelSubtype<V>;

export function _BowTieHazard<V = any>(): Prism<BowTie<V>, Hazard> {
  return prism((h: Hazard) => BowTieHazard<V>(h), (v: BowTie<V>) => (v.tag === "BowTieHazard" ? Right(v._0) : Left(v)));
}

export function _BowTieRiskEvent<V = any>(): Prism<BowTie<V>, RiskEvent> {
  return prism((r: RiskEvent) => BowTieRiskEvent<V>(r), (v: BowTie<V>) => (v.tag === "BowTieRiskEvent" ? Right(v._0) : Left(v)));
}

export function _BowTieControl<V = any>(): Prism<BowTie<V>, Control> {
  return prism((x: Control) => BowTieControl<V>(x), (v: BowTie<V>) => (v.tag === "BowTieControl" ? Right(v._0) : Left(v)));
}

export function _BowTieIsHazard<V = any>(): Prism<BowTie<V>, IsHazard> {
  return prism((x: IsHazard) => BowTieIsHazard<V>(x), (v: BowTie<V>) => (v.tag === "BowTieIsHazard" ? Right(v._0) : Left(v)));
}

export function _BowTieThreat<V = any>(): Prism<BowTie<V>, ThreatLine> {
  return prism((x: ThreatLine) => BowTieThreat<V>(x), (v: BowTie<V>) => (v.tag === "BowTieThreat" ? Right(v._0) : Left(v)));
}

export function _BowTieDiagram<V = any>(): Prism<BowTie<V>, BowTieDiagram<V>> {
  return prism(
    (x: BowTieDiagram<V>) => BowTieDiagram<V>(x),
    (v: BowTie<V>) => (v.tag === "BowTieDiagram" ? Right(v._0) : Left(v)),
  );
}

export function bowTieName<V = any>(): Lens<BowTie<V>, Name> {
  const getName = (b: BowTie<V>): Name => {
    switch (b.tag) {
      case "BowTieHazard": return view(hazardName, b._0);
      case "BowTieRiskEvent": return view(riskEventName, b._0);
      case "BowTieControl": return view(controlName, b._0);
      case "BowTieIsHazard": return view(isHazardName, b._0);
      case "BowTieThreat": return view(threatLineName, b._0);
      case "BowTieDiagram": return view(diagramEntityName(), b._0);
      default: return absurd(b);
    }
  };
  const setName = (b: BowTie<V>, nm: Name): BowTie<V> => {
    switch (b.tag) {
      case "BowTieHazard": return BowTieHazard<V>(set(hazardName, nm, b._0));
      case "BowTieRiskEvent": return BowTieRiskEvent<V>(set(riskEventName, nm, b._0));
      case "BowTieControl": return BowTieControl<V>(set(controlName, nm, b._0));
      case "BowTieIsHazard": return BowTieIsHazard<V>(set(isHazardName, nm, b._0));
      case "BowTieThreat": return BowTieThreat<V>(set(threatLineName, nm, b._0));
      case "BowTieDiagram":
        return BowTieDiagram<V>(set(diagramEntityName<ElemBowTie<V>, DiagramAppearance<BowTieType<V>, V>>(), nm, b._0));
      default: return absurd(b);
    }
  };
  return lens(getName, setName);
}

// ---------------------------------------------------------------------------------------------
// Drawing

/**
 * The `boxTypeDraw` method: draw the box, but override its position and size with the BoundBox
 * argument of the result.
 */
// eslint-disable-next-line require-yield
export function* drawBowTieBox<V>(
  cls: BowTieClass<V>,
  d: DeltaCtx<ElemBowTie<V>>,
  box: Box<BowTieType<V>, V>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
): Delta<ElemBowTie<V>, (b: BoundBox) => HadesRender<void>> {
  const modelId = box.boxEntity;
  const typ = box.boxType as BoxType;
  const shapeCls: BoxShapeClass<any> = box.boxShapeClass;
  const shape1 = box.boxShape;
  // ent <- liftBase $ lift $ goToEntity modelId >> current
  const base = scriptContext<V, BowTie<V>>(d);
  goToEntity(base, modelId);
  const ent = current(base);
  switch (typ) {
    case "EventBox": return (b) => drawBowTieRiskEventBox(shapeCls, cls, ent, contents, border, shape1, b);
    case "StateBox": return (b) => drawBowTieRiskEventBox(shapeCls, cls, ent, contents, border, shape1, b);
    case "RiskEventBox": return (b) => drawBowTieRiskEventBox(shapeCls, cls, ent, contents, border, shape1, b);
    case "ControlBox": return (b) => drawBowTieControlBox(shapeCls, cls, ent, contents, border, shape1, b);
    case "HazardBox": return (b) => drawBowTieHazardBox(shapeCls, cls, ent, contents, border, shape1, b);
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
    case "EvidenceBox":
      return (b) => drawEvidence(cls, ent, contents, border, b);
    default:
      return absurd(typ);
  }
}

/** `maybe id withLineColour border act` */
function withBorder(border: Maybe<Colour>, act: HadesRender<void>): HadesRender<void> {
  return border.tag === "Just" ? withLineColour(border.value, act) : act;
}

export function drawBowTieControlBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: HasBowTie<V>,
  ent: Maybe<Entity<V>>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  const controlGreen = mkColour(C.sRGB24(200, 255, 200));
  const black = mkColour(C.black);
  return (env) => {
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    const [border1, fill] = basicBox(2, fromMaybe(black, border), controlGreen);
    local((e) => ({ ...e, boxBorderStyle: border1, boxFillStyle: fill }),
      drawPolygon(rectangleCorners(Rectangle(view(shapeCls.shapeDefinition, shape2)))))(env);
    runLayout_(shapeCls.shapeInnerBox(shape2), (env1, st) => {
      const ctrl = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._BowTie).dot(_BowTieControl<V>()), ent);
      layoutTitle(Nothing, ctrl.tag === "Just" ? view(controlName.dot(nameText), ctrl.value) : "Control")(env1, st);
      layoutParagraphGap(env1, st);
      contents(env1, st);
    })(env);
  };
}

export function drawBowTieRiskEventBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: HasBowTie<V>,
  ent: Maybe<Entity<V>>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  return (env) => {
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    withBorder(border, drawPolygon(rectangleCorners(Rectangle(view(shapeCls.shapeDefinition, shape2)))))(env);
    runLayout_(shapeCls.shapeInnerBox(shape2), (env1, st) => {
      const risk = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._BowTie).dot(_BowTieRiskEvent<V>()), ent);
      layoutTitle(Nothing, risk.tag === "Just" ? view(riskEventName.dot(nameText), risk.value) : "Event")(env1, st);
      layoutParagraphGap(env1, st);
      contents(env1, st);
    })(env);
  };
}

export function drawBowTieHazardBox<S, V>(
  shapeCls: BoxShapeClass<S>,
  cls: HasBowTie<V>,
  ent: Maybe<Entity<V>>,
  contents: HadesLayout<void>,
  border: Maybe<Colour>,
  shape1: S,
  boundBox: BoundBox,
): HadesRender<void> {
  const hazardYellow = mkColour(C.sRGB24(255, 255, 200));
  const black = mkColour(C.black);
  return (env) => {
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    const [border1, fill] = basicBox(4, fromMaybe(black, border), hazardYellow);
    local((e) => ({ ...e, boxBorderStyle: border1, boxFillStyle: fill }),
      drawPolygon(rectangleCorners(Rectangle(view(shapeCls.shapeDefinition, shape2)))))(env);
    runLayout_(shapeCls.shapeInnerBox(shape2), (env1, st) => {
      const haz = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._BowTie).dot(_BowTieHazard<V>()), ent);
      layoutTitle(Nothing, haz.tag === "Just" ? view(hazardName.dot(nameText), haz.value) : "Hazard")(env1, st);
      layoutParagraphGap(env1, st);
      contents(env1, st);
    })(env);
  };
}

// ---------------------------------------------------------------------------------------------
// Connections, toolbar, menus

/** The `arrowCanConnect` method. */
// eslint-disable-next-line require-yield
export function* bowTieArrowCanConnect<V>(
  _cls: BowTieClass<V>,
  _d: DeltaCtx<ElemBowTie<V>>,
  connection: ConnectionDirection,
  arrow: Arrow<BowTieType<V>, V>,
  box: Box<BowTieType<V>, V>,
  _child: Maybe<DiagramId>,
): Delta<ElemBowTie<V>, boolean> {
  const targetType = box.boxType as BoxType;
  const elem = (ts: readonly BoxType[]): boolean => ts.includes(targetType);
  const arrTyp = arrow.arrowType as ArrowType;
  switch (arrTyp) {
    case "RiskArrow":
      switch (connection) {
        case "ConnectionFrom": return elem(["EventBox", "StateBox", "RiskEventBox"]);
        case "ConnectionTo": return elem(["EventBox", "StateBox", "RiskEventBox", "ControlBox"]);
        default: return absurd(connection);
      }
    case "HazardArrow":
      switch (connection) {
        case "ConnectionFrom": return elem(["EventBox", "StateBox", "RiskEventBox"]);
        case "ConnectionTo": return targetType === "HazardBox";
        default: return absurd(connection);
      }
    case "TraceArrow":
      switch (connection) {
        case "ConnectionFrom": return targetType === "ControlBox";
        case "ConnectionTo": return elem(["EvidenceBox", "GoalBox"]);
        default: return absurd(connection);
      }
    default:
      return absurd(arrTyp);
  }
}

export function bowTieToolbar<V>(
  cls: BowTieClass<V>,
  /** Entity ID of this diagram. */
  diagId: ModelId,
  /** Entity ID of the parent of this diagram. */
  parent: ModelId,
): DeltaToolbar<ElemBowTie<V>> {
  type D = ElemBowTie<V>;
  type DA = DiagramAppearance<BowTieType<V>, V>;
  const dtc = DiagramTypeClass_BowTieType(cls);
  const compile1 = (
    m: Model<V>,
    a: DA,
    ctx: GenericContext<BowTieType<V>, V>,
  ): GenericContext<BowTieType<V>, V> => fromRight(ctx, evalModelEdit(cls, cls._BowTie, m,
    (c: ModelEditCtx<V, BowTie<V>>) => compileAppearance(dtc, c, diagramAppearanceClean(a), ctx)));
  const newBoxTool = (typ: BoxType, item: BowTie<V>): Action<D> =>
    mkScriptAction<D>((d) => newBoxEntityTool(dtc, d, parent, review(cls._BowTie, item), typ));
  const newArrowTool = (typ: ArrowType, item: BowTie<V>): Action<D> =>
    mkScriptAction<D>((d) => newArrowEntityTool(dtc, d, true, parent, review(cls._BowTie, item), typ));
  return DeltaToolbar<D>([[
    DeltaTool<D>("causal_risk_event", "Event", DeltaToolAction(
      newBoxTool("RiskEventBox", BowTieRiskEvent<V>(RiskEvent(Name("Event "), ""))))),
    DeltaTool<D>("causal_hazard", "Hazard", DeltaToolAction(
      newBoxTool("HazardBox", BowTieHazard<V>(Hazard(Name("HAZ-"), ""))))),
    DeltaTool<D>("causal_is_hazard", "Hazard arrow", DeltaToolAction(
      newArrowTool("HazardArrow", BowTieIsHazard<V>(IsHazard(Name("Hazard arrow ")))))),
  ], [
    DeltaTool<D>("causal_control", "Control", DeltaToolAction(
      newBoxTool("ControlBox", BowTieControl<V>(Control(Name("Control "), ""))))),
    DeltaTool<D>("causal_risk_line", "Threat line", DeltaToolAction(
      newArrowTool("RiskArrow", BowTieThreat<V>(ThreatLine(Name("Threat line ")))))),
  ], [
    DeltaTool<D>("trace-arrow", "Trace", DeltaToolAction(mkScriptAction<D>((d) => newArrowEntityTool(
      dtc,
      d,
      true,
      parent,
      review(cls._Trace, Trace(Name("Trace"))),
      "TraceArrow",
    )))),
  ], [
    DeltaTool<D>("basic_comment", "Comment", DeltaToolAction(newCommentTool<BowTieType<V>, V>())),
    DeltaTool<D>("emblem-symbolic-link", "Link", DeltaToolAction(newLinkTool<BowTieType<V>, V>(dtc))),
  ]], [
    alignmentTools<D>(),
    [viewControlTool<HadesRender, V, BowTie<V>, DA, D>(
      diagId,
      _BowTieDiagram<V>().dot(diagramEntityData<ElemBowTie<V>, DA>()),
      compile1,
      constantDialog(diagramAppearanceDialog<HadesRender, V, null, BowTieType<V>>(cls, bowTieDiagramVariant)),
    )],
  ]);
}

export function bowTieIcon<V>(b: BowTie<V>): string {
  switch (b.tag) {
    case "BowTieHazard": return "causal_hazard";
    case "BowTieRiskEvent": return "causal_risk_event";
    case "BowTieControl": return "causal_control";
    case "BowTieIsHazard": return "causal_is_hazard";
    case "BowTieThreat": return "causal_risk_line";
    case "BowTieDiagram": return "causal_bowtie";
    default: return absurd(b);
  }
}

/** TypeScript: a first-class bow tie script, i.e. a `ModelScriptAct` at `W = BowTie<V>`. */
export type BowTieScriptAct<V, A> = ModelScriptAct<HadesRender, V, BowTie<V>, A>;

export function bowTieEntityMenu<V>(
  cls: BowTieBaseClass<V>,
  ent: Entity<V>,
  b: BowTie<V>,
): Menu<BowTieScriptAct<V, Maybe<string>>> {
  if (b.tag === "BowTieDiagram") return diagramEntityMenu<HadesRender, V, BowTie<V>>(cls, ent.entityId);
  return entityMenu<HadesRender, V, BowTie<V>>(cls, ent);
}

export function bowTieAddEntityMenu<V>(
  cls: EntityClass<V> & HasBowTie<V>,
  parent: ModelId,
): Menu<BowTieScriptAct<V, Maybe<string>>> {
  type Item = BowTieScriptAct<V, Maybe<string>>;
  const addEnt = (base: string, f: (nm: Name) => BowTie<V>): Item => function* (ctx) {
    const r = yield* insertEntity<HadesRender, V, BowTie<V>>(ctx, review(cls._BowTie, f(Name(base))), parent);
    switch (r.tag) {
      case "Nothing": return Nothing;
      case "Just": return Just("Insert " + view(nameText, r.value[0]));
      default: return absurd(r);
    }
  };
  return Menu<Item>([[
    menuItem<Item>("Add Bow Tie Diagram", function* (ctx) {
      const diag = BowTieDiagram<V>(DiagramEntity(
        Name("BowTie "), mempty_Diagram<ElemBowTie<V>>(), mempty_DiagramAppearance as DiagramAppearance<BowTieType<V>, V>));
      const r = yield* insertEntity<HadesRender, V, BowTie<V>>(ctx, review(cls._BowTie, diag), parent);
      switch (r.tag) {
        case "Nothing": return Nothing;
        case "Just": return Just("Insert " + view(nameText, r.value[0]));
        default: return absurd(r);
      }
    }),
    subMenu<Item>("Bow Tie Items", Menu<Item>([[
      menuItem<Item>("Hazard", addEnt("HAZ-", (nm) => BowTieHazard<V>(Hazard(nm, "")))),
      menuItem<Item>("Event", addEnt("Event ", (nm) => BowTieRiskEvent<V>(RiskEvent(nm, "")))),
      menuItem<Item>("Control", addEnt("Control ", (nm) => BowTieControl<V>(Control(nm, "")))),
      menuItem<Item>("Hazard arrow", addEnt("Hazard arrow ", (nm) => BowTieIsHazard<V>(IsHazard(nm)))),
      menuItem<Item>("Threat line", addEnt("Threat line ", (nm) => BowTieThreat<V>(ThreatLine(nm)))),
    ]])),
  ]]);
}

/**
 * The bow tie activation script.
 *
 * (TypeScript: `bowTieActivation(cls, mEnt)` is the `ActivationScript` applied to `mEnt`.)
 */
export function bowTieActivation<V>(cls: BowTieBaseClass<V>, mEnt: Maybe<Entity<V>>): BowTieScriptAct<V, Maybe<string>> {
  switch (mEnt.tag) {
    case "Nothing":
      // eslint-disable-next-line require-yield
      return function* (_ctx) {
        return Nothing;
      };
    case "Just": {
      const e = mEnt.value;
      return function* (ctx) {
        const prsm = usingTraversal(ctx, (_c, p) => p);
        const b = preview(entityContents<V>().dot(prsm), e);
        if (b.tag === "Nothing") return Nothing;
        if (b.value.tag === "BowTieDiagram") {
          yield* openDiagram<HadesRender, V, BowTie<V>>(cls, ctx, e.entityId);
          return Nothing;
        }
        return yield* editEntityProperties<HadesRender, V, BowTie<V>>(ctx, e.entityId);
      };
    }
    default:
      return absurd(mEnt);
  }
}

/** TypeScript: the `ActivationScript HadesRender v (BowTie v)` value `bowTieActivation`. */
export function bowTieActivationScript<V>(cls: BowTieBaseClass<V>): ActivationScript<HadesRender, V, BowTie<V>> {
  return (mEnt) => bowTieActivation(cls, mEnt);
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
