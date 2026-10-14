// Ported from dsm/gsn/GSN/Model.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module is intended to be imported qualified. For instance:
 *
 * > import qualified GSN.Model as GSN
 *
 * (TypeScript: `import * as GSN from "@/dsm/gsn/GSN/Model";`.)
 *
 * TypeScript port
 * ---------------
 * * **Dictionaries.** `HasGsn v` is the interface `HasGsn<V>` (member `_Gsn`). The constraint set
 *   of the `DiagramTypeClass (GsnDiagramType v) v` instance (`AppearanceClass (GsnDiagramType v)
 *   v`, `Editable HadesRender v`, `EntityClass v`, `HasDiagrams HadesRender v`, `HasEvidence v`,
 *   `HasGsn v`, `HasLookups v`, `HasReports v`) is the single dictionary type `GsnClass<V>`; the
 *   smaller set `(EntityClass v, HasDiagrams HadesRender v, HasEvidence v, HasGsn v, Queryable v)`
 *   is `GsnBaseClass<V>`. Constrained functions take the dictionary first, then the context
 *   (`ModelEditCtx` or `DeltaCtx`), then the Haskell arguments. Constrained optics and values
 *   with no other argument take the dictionary as an optional, unused argument
 *   (`_GsnDiagramItem<V>()`, `gsnItemName<V>()`, `gsnDiagramEntityTypes<V>()`), like
 *   `packageName` in "Model.Abstract.PackageTree".
 * * **Data families.** `GsnDiagramType v` has no values: it is the phantom interface
 *   `GsnDiagramType<V>`, whose members `BoxType`, `ArrowType` and `ModelSubtype` name the data
 *   family instances for "App.GenericDiagram". Those are ordinary exported types:
 *   `BoxType` (string enumeration `"GoalBox" | ...`, with `boxTypeValues` and a constant per
 *   constructor, so that `GSN.GoalBox` works as in Haskell), `ArrowType` (tagged union
 *   `GsnArrow(edgeType)` | `TraceArrow`) and `ModelSubtype<V>` (tagged union `GsnNodeItem(n)` |
 *   `GsnEdgeItem(e)` | `GsnDiagramItem(d)`, also called `GsnItem<V>`). The existential
 *   `HasDiagrams HadesRender v` constraint of `GsnDiagramItem` is not packed: every function that
 *   matches on it already has the dictionary.
 * * **The instance.** `DiagramTypeClass_GsnDiagramType(cls)` is the `DiagramTypeClass
 *   (GsnDiagramType v) v` dictionary. It inherits (by prototype, so lazy getters stay lazy) every
 *   member of `cls`, so it is also the `HasDiagrams`/`EntityClass`/... dictionary that
 *   "App.GenericDiagram" needs, and adds the class methods (`mkBox`, `boxTypeDraw`, ...) and the
 *   superclass codecs `boxTypeJ`, `arrowTypeJ`. It is cached per `cls`, so repeated calls return
 *   the same object (the element dictionary built from it must be the one given to `startDelta`).
 *   Class methods returning `Delta` take the `DeltaCtx` first, as in "Hades.Abstract.Delta".
 * * **Instances** of the other classes: `eq_ModelSubtype`, `JSON_ModelSubtype(cls)`,
 *   `Reflective_ModelSubtype(cls)` (aliases `eq_GsnItem`, `JSON_GsnItem`, `Reflective_GsnItem`;
 *   the last two are cached per `cls` and build their diagram parts on first use, so a model
 *   dictionary can refer to them while it is being built),
 *   `JSON_BoxType`, `show_BoxType`, `JSON_ArrowType`, `show_ArrowType`, `JSON_GsnNode`,
 *   `show_GsnNode`, `JSON_GsnEdgeType`, `show_GsnEdgeType`, `JSON_GsnEdge`, `show_GsnEdge`. The
 *   derived `Eq` instances of `GsnNode`, `GsnEdge`, `BoxType`, `ArrowType` are the structural
 *   `equals`. The derived `Read` instances are not used anywhere and are not ported.
 * * **Nodes and edges.** `GsnNode` is a tagged union whose constructors keep their record fields
 *   (`Goal(name, text, developed, instantiated)`, `Solution(name, text, instantiated)`, ...).
 *   `GsnEdge` is the record `{ gsnEdgeType, _gsnEdgeName, _gsnEdgeCard }`; the Haskell field
 *   accessor is also the function `gsnEdgeType(e)`. Lenses on these monomorphic types are
 *   constants (`gsnNodeName`, `gsnDeveloped` (a Traversal), `gsnEdgeName`, ...); prisms on the
 *   polymorphic `GsnItem v` are zero-argument functions (`_GsnNodeItem<V>()`).
 * * **Scripts and edits** (PORTING.md §7.4, §7.5). `createGoal` etc. are `ModelEdit` functions
 *   `(ctx) => GsnNode`. `GsnScript<V, A>` is the generator type
 *   `ModelScript<HadesRender, V, A>`; first-class scripts are `GsnScriptAct<V, A>`
 *   (`ModelScriptAct` at `W = GsnItem<V>`). `gsnActivation(cls, mEnt)` returns the script of the
 *   `ActivationScript`; `gsnEntityMenu(cls, ent, item)` and `gsnAddEntityMenu(cls, parent)`
 *   return menus of `GsnScriptAct`s.
 * * **Drawing.** `drawGsnBoxRaw(shapeCls, typ, mNode, contents, border, shape, box)` takes the
 *   `BoxShapeClass` dictionary of the shape first; it returns a `HadesRender`. `drawGsnBox(cls,
 *   d, box, contents, border)` is the `boxTypeDraw` Delta and returns the `BoundBox ->
 *   HadesRender` function.
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as L from "@/lib/Data/List";
import * as J from "@/lib/Data/Aeson";
import * as Cairo from "@/lib/GI/Cairo";
import { isDigit } from "@/lib/Data/Char";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, fromRight } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { absurd, showBool } from "@/lib/Prelude";
import {
  _Just, lens, preview, prism, review, set, traversal, view,
  type Lens, type Prism, type StateCell, type Traversal,
} from "@/lib/Control/Lens";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import type { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { cannotHappen } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import {
  type Action, type BoxShapeClass, type ConnectionDirection, type ConnectorEnd, type Delta,
  type DeltaCtx, type DiagramId, type Peg, type Point,
  BoundBox, BoxShapeClass_Diamond, BoxShapeClass_Ellipse, BoxShapeClass_Oval,
  BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, DeltaTool, DeltaToolAction, DeltaToolbar,
  Diamond, Ellipse, Oval, Parallelogram, Point as mkPoint, Rectangle, alignmentTools,
  diamondCorners, mempty_Diagram, mkScriptAction, movePoint, parallelogramCorners,
  rectangleCorners, withItem,
} from "@/hades/src/Hades/Abstract";
import {
  type ArrowHead, type HadesLayout, type HadesRender,
  ArrowDecoration, closedArrowHead, drawCornerLetter, drawEllipse, drawOval, drawPolygon,
  layoutParagraphGap, layoutText, layoutTitle, runLayout_, withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";
import {
  type AppearanceClass, type DiagramAppearance, diagramAppearanceClean, diagramAppearanceDialog,
  mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import {
  type Arrow, type AvatarCreation, type Box, type DiagramTypeClass, type Element,
  type GenericDiagramClass, Avatar_Element, Box as mkGenericBox, GenericContext, JSON_Element, NoAvatar, SimpleArrow,
  SimpleBox, compileAppearance, elementDialog, mempty_AppearanceDef, newArrowEntityTool,
  newBoxEntityTool, newCommentTool, newLinkTool,
} from "@/hades/src/App/GenericDiagram";
import {
  type HasEvidence, Trace, drawEvidence, evidenceVariant, traceArrowDash, traceArrowHead,
  traceArrowRelations, traceHeadRelation, traceTailRelation, traceVariant,
} from "@/hades/evidence/Evidence/Model";
import {
  assumptionVariant, cardinalityField, contextArrowVariant, contextVariant, developedField,
  goalVariant, gsnDiagramVariant, gsnOptionVariant, instantiatedField, justificationVariant,
  solutionVariant, strategyVariant, supportArrowVariant,
} from "./FieldNames";
import {
  type ActivationScript, type DiagramEntityTypes, type Editable, type EntityWrapper,
  type HasDiagrams, type ModelScript, type ModelScriptAct, DiagramEntity, DiagramWrapper,
  JSON_DiagramEntity, Reflective_DiagramEntity, diagramEntityData, diagramEntityMenu, eq_DiagramEntity,
  diagramEntityName, editEntityProperties, entityMenu, insertEntity, openDiagram, scriptContext,
  viewControlTool,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId, JSON_Name, Name,
  current, currentName, descriptionField, entityContents, evalModelEdit, goToEntity, mkEntity,
  modelNewName, nameField, nameText, show_Name, usingTraversal,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import type { Queryable } from "@/hades/src/Model/Query/Diagram";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { append_RefTypeTable, arrowRelations } from "@/hades/src/Model/Reflection/References";
import { type Reflective, defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import {
  type Cardinality, JSON_Cardinality, cardinalityFromText, cardinalityToText, show_Cardinality,
} from "@/hades/src/Model/Reflection/Types";
import {
  type ExtensionValues, type Variant, ExtBool, ExtText, _ExtBool, _ExtText, variantCoerce, variantName,
} from "@/hades/src/Model/Reflection/Values";
import type { HasReports } from "@/hades/src/Model/Report/Base";

// ---------------------------------------------------------------------------------------------
// * Diagram Type

/** Model types which include GSN. Used to gain access to GSN entities from other diagram types. */
export interface HasGsn<V> {
  readonly _Gsn: Prism<V, GsnItem<V>>;
}

/**
 * Unit type that exists for instances.
 *
 * (TypeScript: a phantom type that is never instantiated, like the Haskell empty data
 * declaration. Its members name the associated data family instances for "App.GenericDiagram":
 * `BoxType (GsnDiagramType v)`, `ArrowType (GsnDiagramType v)` and
 * `ModelSubtype (GsnDiagramType v)`.)
 */
export interface GsnDiagramType<V> {
  readonly BoxType: BoxType;
  readonly ArrowType: ArrowType;
  readonly ModelSubtype: ModelSubtype<V>;
}

export type GsnElement<V> = Element<GsnDiagramType<V>, V>;

/**
 * TypeScript: the dictionary for the context of the `DiagramTypeClass (GsnDiagramType v) v`
 * instance: `(AppearanceClass (GsnDiagramType v) v, Editable HadesRender v, EntityClass v,
 * HasDiagrams HadesRender v, HasEvidence v, HasGsn v, HasLookups v, HasReports v)`. It includes
 * `Queryable v`, a superclass of `HasReports v`.
 */
export type GsnClass<V> =
  AppearanceClass<GsnDiagramType<V>, V> & Editable<HadesRender, V> & EntityClass<V> &
  HasDiagrams<HadesRender, V> & HasEvidence<V> & HasGsn<V> & HasLookups<V> & HasReports<V>;

/**
 * TypeScript: the dictionary for `(EntityClass v, HasDiagrams HadesRender v, HasEvidence v,
 * HasGsn v, Queryable v)`, the context of many functions below.
 */
export type GsnBaseClass<V> =
  EntityClass<V> & HasDiagrams<HadesRender, V> & HasEvidence<V> & HasGsn<V> & Queryable<V>;

/** `data BoxType (GsnDiagramType v)` (derived `Eq`, `Ord`, `Read`, `Show`). */
export type BoxType =
  | "GoalBox" | "StrategyBox" | "SolutionBox" | "ContextBox" | "AssumptionBox" | "JustificationBox"
  | "OptionBox" | "EvidenceBox";
export const boxTypeValues: readonly BoxType[] = [
  "GoalBox", "StrategyBox", "SolutionBox", "ContextBox", "AssumptionBox", "JustificationBox",
  "OptionBox", "EvidenceBox",
];
export const GoalBox: BoxType = "GoalBox";
export const StrategyBox: BoxType = "StrategyBox";
export const SolutionBox: BoxType = "SolutionBox";
export const ContextBox: BoxType = "ContextBox";
export const AssumptionBox: BoxType = "AssumptionBox";
export const JustificationBox: BoxType = "JustificationBox";
export const OptionBox: BoxType = "OptionBox";
export const EvidenceBox: BoxType = "EvidenceBox";

/** Derived `Show (BoxType (GsnDiagramType v))`. */
export function show_BoxType(b: BoxType): string {
  return b;
}

/** `data ArrowType (GsnDiagramType v)` (derived `Eq`, `Ord`, `Read`). */
export type ArrowType =
  | { readonly tag: "GsnArrow"; readonly _0: GsnEdgeType }
  | { readonly tag: "TraceArrow" };
export function GsnArrow(_0: GsnEdgeType): ArrowType {
  return { tag: "GsnArrow", _0 };
}
export const TraceArrow: ArrowType = { tag: "TraceArrow" };

/** `data ModelSubtype (GsnDiagramType v)` */
export type ModelSubtype<V> =
  | { readonly tag: "GsnNodeItem"; readonly _0: GsnNode }
  | { readonly tag: "GsnEdgeItem"; readonly _0: GsnEdge }
  | {
    readonly tag: "GsnDiagramItem";
    readonly _0: DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>;
  };
export function GsnNodeItem<V = any>(_0: GsnNode): ModelSubtype<V> {
  return { tag: "GsnNodeItem", _0 };
}
export function GsnEdgeItem<V = any>(_0: GsnEdge): ModelSubtype<V> {
  return { tag: "GsnEdgeItem", _0 };
}
export function GsnDiagramItem<V = any>(
  _0: DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>,
): ModelSubtype<V> {
  return { tag: "GsnDiagramItem", _0 };
}

/**
 * TypeScript: the members that the `DiagramTypeClass (GsnDiagramType v) v` instance defines (the
 * class methods and the superclass codecs); the `HasDiagrams` superclass members come from the
 * model dictionary (see "DiagramTypeClass_GsnDiagramType").
 */
export type GsnDiagramTypeMethods<V> =
  Omit<DiagramTypeClass<GsnDiagramType<V>, V>, keyof HasDiagrams<HadesRender, V>>;

/**
 * TypeScript: the type of the `DiagramTypeClass (GsnDiagramType v) v` dictionary. It is also the
 * `GenericDiagramClass` dictionary of "App.GenericDiagram" for GSN diagrams.
 */
export type GsnDiagramTypeClass<V> = GsnClass<V> & GenericDiagramClass<GsnDiagramType<V>, V>;

const gsnDiagramTypeClasses = new WeakMap<object, GsnDiagramTypeClass<any>>();

/**
 * ```haskell
 * instance (
 *     AppearanceClass (GsnDiagramType v) v, Editable HadesRender v, EntityClass v,
 *     HasDiagrams HadesRender v, HasEvidence v, HasGsn v, HasLookups v, HasReports v) =>
 *   DiagramTypeClass (GsnDiagramType v) v
 * ```
 *
 * (TypeScript: the dictionary delegates to `cls` for all its other members; see the module
 * header. The result is cached per `cls`.)
 */
export function DiagramTypeClass_GsnDiagramType<V>(cls: GsnClass<V>): GsnDiagramTypeClass<V> {
  const cached = gsnDiagramTypeClasses.get(cls);
  if (cached !== undefined) return cached as GsnDiagramTypeClass<V>;
  type B = Box<GsnDiagramType<V>, V>;
  type D = GsnElement<V>;
  const methods: GsnDiagramTypeMethods<V> = {
    boxTypeJ: JSON_BoxType,
    arrowTypeJ: JSON_ArrowType,
    mkBox: (diagId, modelId, typ, peg, bound) => {
      switch (typ) {
        case "GoalBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        case "StrategyBox": return mkGenericBox(BoxShapeClass_Parallelogram, diagId, modelId, typ, peg, Parallelogram(bound));
        case "SolutionBox": return mkGenericBox(BoxShapeClass_Ellipse, diagId, modelId, typ, peg, Ellipse(bound));
        case "ContextBox": return mkGenericBox(BoxShapeClass_Oval, diagId, modelId, typ, peg, Oval(bound));
        case "AssumptionBox": return mkGenericBox(BoxShapeClass_Ellipse, diagId, modelId, typ, peg, Ellipse(bound));
        case "JustificationBox": return mkGenericBox(BoxShapeClass_Ellipse, diagId, modelId, typ, peg, Ellipse(bound));
        case "OptionBox": return mkGenericBox(BoxShapeClass_Diamond, diagId, modelId, typ, peg, Diamond(bound));
        case "EvidenceBox": return mkGenericBox(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound));
        default: return absurd(typ);
      }
    },
    boxTypeDraw: (d, box, contents, border) => drawGsnBox(cls, d, box, contents, border),
    // eslint-disable-next-line require-yield
    boxChildren: function* (_d: DeltaCtx<D>, _box: B): Delta<D, [DiagramId, (p: Point) => boolean][]> {
      return []; // GSN boxes have no children.
    },
    // eslint-disable-next-line require-yield
    boxChildConnection: function* (_d: DeltaCtx<D>, _box: B, _child: DiagramId): Delta<D, (p: Point) => Point> {
      return (p: Point) => p;
    },
    // eslint-disable-next-line require-yield
    boxCanPeg: function* (_d: DeltaCtx<D>, _box: B, _arrow: Arrow<GsnDiagramType<V>, V>): Delta<D, Maybe<NR.Relation>> {
      return Nothing;
    },
    avatarType: (prsm, v) => gsnAvatarType(cls, prsm, v),
    diagramTypeName: (_t) => "GSN",
    arrowTailRelation: (a) => {
      switch (a.tag) {
        case "TraceArrow": return traceTailRelation;
        case "GsnArrow": return NR.edgeFromRelation;
        default: return absurd(a);
      }
    },
    arrowHeadRelation: (a) => {
      switch (a.tag) {
        case "TraceArrow": return traceHeadRelation;
        case "GsnArrow": return NR.edgeToRelation;
        default: return absurd(a);
      }
    },
    arrowTailExportRelation: (_a) => Nothing,
    arrowHeadExportRelation: (_a) => Nothing,
    arrowHeadDraw: (_ms, a) => {
      switch (a.tag) {
        case "GsnArrow":
          switch (a._0) {
            case "ContextArrow": return closedArrowHead(30, 10, false);
            case "SupportArrow": return closedArrowHead(30, 10, true);
            default: return absurd(a._0);
          }
        case "TraceArrow": return traceArrowHead;
        default: return absurd(a);
      }
    },
    arrowDecorations: (ms, _a) =>
      ms.tag === "Just" && ms.value.tag === "GsnEdgeItem" ? gsnArrowDecorations(ms.value._0) : [],
    arrowLineDashes: (a) => {
      switch (a.tag) {
        case "GsnArrow": return [];
        case "TraceArrow": return [...traceArrowDash];
        default: return absurd(a);
      }
    },
    arrowCanConnect: (d, dir, arrow, box, _child) => gsnArrowCanConnect(cls, d, dir, arrow, box), // Child argument ignored.
  };
  const dict = Object.assign(Object.create(cls) as object, methods) as GsnDiagramTypeClass<V>;
  gsnDiagramTypeClasses.set(cls, dict);
  return dict;
}

/**
 * ```haskell
 * instance (...) => Eq (ModelSubtype (GsnDiagramType v))
 * ```
 */
export function eq_ModelSubtype<V>(x: ModelSubtype<V>, y: ModelSubtype<V>): boolean {
  if (x.tag === "GsnNodeItem" && y.tag === "GsnNodeItem") return equals(x._0, y._0);
  if (x.tag === "GsnEdgeItem" && y.tag === "GsnEdgeItem") return equals(x._0, y._0);
  if (x.tag === "GsnDiagramItem" && y.tag === "GsnDiagramItem") return eq_DiagramEntity(x._0, y._0);
  return false;
}

/** TypeScript: caches of "JSON_ModelSubtype" and "Reflective_ModelSubtype", per model dictionary. */
const gsnItemCodecs = new WeakMap<object, J.JSONCodec<ModelSubtype<any>>>();
const gsnItemReflectives = new WeakMap<object, Reflective<ModelSubtype<any>>>();

/** `instance ToJSON (BoxType (GsnDiagramType v))` and `instance FromJSON (BoxType (GsnDiagramType v))` */
export const JSON_BoxType: J.JSONCodec<BoxType> = J.codec(
  (b) => {
    switch (b) {
      case "GoalBox": return "Goal";
      case "StrategyBox": return "Strategy";
      case "SolutionBox": return "Solution";
      case "ContextBox": return "Context";
      case "AssumptionBox": return "Assumption";
      case "JustificationBox": return "Justification";
      case "OptionBox": return "Option";
      case "EvidenceBox": return "Evidence";
      default: return absurd(b);
    }
  },
  (v) => J.withText("GSN box type", (s): BoxType => {
    switch (s) {
      case "Goal": return "GoalBox";
      case "Strategy": return "StrategyBox";
      case "Solution": return "SolutionBox";
      case "Context": return "ContextBox";
      case "Assumption": return "AssumptionBox";
      case "Justification": return "JustificationBox";
      case "Option": return "OptionBox";
      case "Evidence": return "EvidenceBox";
      default: return J.fail("Expected GSN box type. Got " + T.showText(s));
    }
  }, v),
);

/** `instance Show (ArrowType (GsnDiagramType v))` */
export function show_ArrowType(a: ArrowType): string {
  switch (a.tag) {
    case "GsnArrow":
      switch (a._0) {
        case "ContextArrow": return view(variantName(), contextArrowVariant);
        case "SupportArrow": return view(variantName(), supportArrowVariant);
        default: return absurd(a._0);
      }
    case "TraceArrow": return view(variantName(), traceVariant);
    default: return absurd(a);
  }
}

/** `instance ToJSON (ArrowType (GsnDiagramType v))` and `instance FromJSON (ArrowType (GsnDiagramType v))` */
export const JSON_ArrowType: J.JSONCodec<ArrowType> = J.codec(
  (a) => {
    switch (a.tag) {
      case "GsnArrow": return JSON_GsnEdgeType.toJSON(a._0);
      case "TraceArrow": return "Trace";
      default: return absurd(a);
    }
  },
  (v) => {
    const parseTrace = (v1: J.Value): ArrowType => J.withText("Trace", (s) => {
      switch (s) {
        case "Trace": return TraceArrow;
        default: return J.fail("Not a GSN Arrow type: " + T.showText(s));
      }
    }, v1);
    return J.alt<ArrowType>((v1) => GsnArrow(JSON_GsnEdgeType.parseJSON(v1)), parseTrace)(v);
  },
);

/**
 * ```haskell
 * instance (...) => ToJSON (ModelSubtype (GsnDiagramType v))
 * instance (...) => FromJSON (ModelSubtype (GsnDiagramType v))
 * ```
 */
export function JSON_ModelSubtype<V>(cls: GsnClass<V>): J.JSONCodec<ModelSubtype<V>> {
  const cached = gsnItemCodecs.get(cls);
  if (cached !== undefined) return cached as J.JSONCodec<ModelSubtype<V>>;
  type DE = DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>;
  // Built on first use, so that a model dictionary can include this codec while it is being built.
  let diagramJ: J.JSONCodec<DE> | null = null;
  const diagramCodec = (): J.JSONCodec<DE> => {
    if (diagramJ === null) {
      const dtc = DiagramTypeClass_GsnDiagramType(cls);
      diagramJ = JSON_DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>(
        Avatar_Element(dtc), JSON_Element(dtc));
    }
    return diagramJ;
  };
  const codec = J.codec<ModelSubtype<V>>(
    (item) => {
      switch (item.tag) {
        case "GsnNodeItem": return JSON_GsnNode.toJSON(item._0);
        case "GsnEdgeItem": return JSON_GsnEdge.toJSON(item._0);
        case "GsnDiagramItem": return diagramCodec().toJSON(item._0);
        default: return absurd(item);
      }
    },
    (v) => J.alt<ModelSubtype<V>>(
      (v1) => GsnNodeItem<V>(JSON_GsnNode.parseJSON(v1)),
      (v1) => GsnEdgeItem<V>(JSON_GsnEdge.parseJSON(v1)),
      (v1) => GsnDiagramItem<V>(diagramCodec().parseJSON(v1)),
    )(v),
  );
  gsnItemCodecs.set(cls, codec);
  return codec;
}

/**
 * ```haskell
 * instance (...) => Reflective (ModelSubtype (GsnDiagramType v))
 * ```
 */
export function Reflective_ModelSubtype<V>(cls: GsnClass<V>): Reflective<ModelSubtype<V>> {
  const cached = gsnItemReflectives.get(cls);
  if (cached !== undefined) return cached as Reflective<ModelSubtype<V>>;
  type Item = ModelSubtype<V>;
  type DE = DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>;
  // Built on first use (see "JSON_ModelSubtype").
  let diagramRefl: Reflective<DE> | null = null;
  const diagramReflective = (): Reflective<DE> => {
    if (diagramRefl === null) {
      diagramRefl = Reflective_DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>(
        Avatar_Element(DiagramTypeClass_GsnDiagramType(cls)));
    }
    return diagramRefl;
  };
  const mkEdge = (typ: GsnEdgeType): Item => GsnEdgeItem<V>(GsnEdge(typ, Name(""), "CardinalityOne"));
  let defaults: readonly Item[] | null = null;
  const refl: Reflective<Item> = {
    reflectiveName: (item) => {
      switch (item.tag) {
        case "GsnNodeItem": return gsnNodeVariant<Item>(item._0);
        case "GsnEdgeItem": return gsnEdgeVariant<Item>(item._0.gsnEdgeType);
        case "GsnDiagramItem": return variantCoerce<DE, Item>(diagramReflective().reflectiveName(item._0));
        default: return absurd(item);
      }
    },
    variantUserLabel: defaultVariantUserLabel,
    get reflectiveDefaults(): readonly Item[] {
      if (defaults === null) {
        defaults = [
          GsnNodeItem<V>(Goal(Name(""), "", true, true)),
          GsnNodeItem<V>(Strategy(Name(""), "", true, true)),
          GsnNodeItem<V>(Solution(Name(""), "", true)),
          GsnNodeItem<V>(Context(Name(""), "", true)),
          GsnNodeItem<V>(Assumption(Name(""), "", true)),
          GsnNodeItem<V>(Justification(Name(""), "", true)),
          GsnNodeItem<V>(GsnOption(Name(""), "", true)),
          mkEdge("ContextArrow"), mkEdge("SupportArrow"),
          GsnDiagramItem<V>(DiagramEntity(Name(""), mempty_Diagram<GsnElement<V>>(), mempty_DiagramAppearance)),
        ];
      }
      return defaults;
    },
    reflectiveBuiltIn: (item) => {
      if (item.tag === "GsnNodeItem" && item._0.tag === "Goal") {
        return [nameField, descriptionField, instantiatedField, developedField];
      }
      if (item.tag === "GsnNodeItem" && item._0.tag === "Strategy") {
        return [nameField, descriptionField, instantiatedField, developedField];
      }
      if (item.tag === "GsnNodeItem") return [nameField, descriptionField, instantiatedField];
      if (item.tag === "GsnEdgeItem") return [nameField, cardinalityField];
      return [nameField];
    },
    reflectiveGet: (item) => {
      switch (item.tag) {
        case "GsnNodeItem": {
          const node = item._0;
          const d = preview(gsnDeveloped, node);
          return M.fromList([
            [nameField, ExtText(view(gsnNodeName.dot(nameText), node))],
            [descriptionField, ExtText(view(gsnNodeText, node))],
            [instantiatedField, ExtBool(view(gsnInstantiated, node))],
            ...(d.tag === "Just" ? [[developedField, ExtBool(d.value)] as const] : []),
          ]);
        }
        case "GsnEdgeItem": {
          const { _gsnEdgeName: nm, _gsnEdgeCard: card } = item._0;
          return M.fromList([
            [nameField, ExtText(nm._0)],
            [cardinalityField, ExtText(cardinalityToText(card))],
          ]);
        }
        case "GsnDiagramItem":
          return M.singleton(nameField, ExtText(item._0._diagramEntityName._0));
        default:
          return absurd(item);
      }
    },
    reflectiveSet: (st: StateCell<ExtensionValues>, item: Item): Item => {
      switch (item.tag) {
        case "GsnNodeItem": {
          const n = item._0;
          const nmV = extract(st, view(gsnNodeName.dot(nameText), n), _ExtText, nameField);
          const nm = (x: GsnNode): GsnNode => set(gsnNodeName, Name(nmV), x);
          const txtV = extract(st, view(gsnNodeText, n), _ExtText, descriptionField);
          const txt = (x: GsnNode): GsnNode => set(gsnNodeText, txtV, x);
          const instV = extract(st, view(gsnInstantiated, n), _ExtBool, instantiatedField);
          const inst = (x: GsnNode): GsnNode => set(gsnInstantiated, instV, x);
          let dev = (x: GsnNode): GsnNode => x;
          const d = preview(gsnDeveloped, n);
          if (d.tag === "Just") {
            const devV = extract(st, d.value, _ExtBool, developedField);
            dev = (x: GsnNode): GsnNode => set(gsnDeveloped, devV, x);
          }
          return GsnNodeItem<V>(nm(txt(inst(dev(n)))));
        }
        case "GsnEdgeItem": {
          const e = item._0;
          const nm = Name(T.strip(extract(st, view(gsnEdgeName.dot(nameText), e), _ExtText, nameField)));
          const card = fromMaybe<Cardinality>("CardinalityOne", cardinalityFromText(
            extract(st, cardinalityToText(view(gsnEdgeCard, e)), _ExtText, cardinalityField)));
          return GsnEdgeItem<V>(GsnEdge(e.gsnEdgeType, nm, card));
        }
        case "GsnDiagramItem": {
          const d = item._0;
          const nm = Name(T.strip(extract(st, view(diagramEntityName<GsnElement<V>>().dot(nameText), d), _ExtText, nameField)));
          return GsnDiagramItem<V>(set(diagramEntityName<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>(), nm, d));
        }
        default:
          return absurd(item);
      }
    },
    reflectiveBuiltInRefs: append_RefTypeTable<Item>(
      arrowRelations<Item>(contextArrowVariant,
        [goalVariant, strategyVariant, gsnOptionVariant],
        [contextVariant, assumptionVariant, justificationVariant, gsnOptionVariant]),
      append_RefTypeTable<Item>(
        arrowRelations<Item>(supportArrowVariant,
          [goalVariant, strategyVariant, gsnOptionVariant],
          [goalVariant, strategyVariant, solutionVariant, gsnOptionVariant]),
        traceArrowRelations<Item>([solutionVariant], []))),
    reflectiveArrows: M.fromList<Variant<Item>, readonly [NR.Relation, NR.Relation]>([
      [contextArrowVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
      [supportArrowVariant, [NR.edgeFromRelation, NR.edgeToRelation]],
    ]),
  };
  gsnItemReflectives.set(cls, refl);
  return refl;
}

/** Alias of "eq_ModelSubtype": `GsnItem v` is `ModelSubtype (GsnDiagramType v)`. */
export const eq_GsnItem = eq_ModelSubtype;
/** Alias of "JSON_ModelSubtype". */
export const JSON_GsnItem = JSON_ModelSubtype;
/** Alias of "Reflective_ModelSubtype". */
export const Reflective_GsnItem = Reflective_ModelSubtype;

/** True if this is a GSN diagram. */
export function gsnIsDiagram<V>(_cls: GsnBaseClass<V>, item: ModelSubtype<V>): boolean {
  return item.tag === "GsnDiagramItem";
}

/**
 * The wrapper for GSN diagrams.
 *
 * (A `ModelEdit v (ModelSubtype (GsnDiagramType v))`. From a `getDiagramWrapper(ctx, e)` at the
 * top-level type use `withSubtype(ctx, cls._Gsn, (c) => gsnDiagramWrapper(cls, c, e))`.)
 */
export function gsnDiagramWrapper<V>(
  cls: GsnClass<V>,
  ctx: ModelEditCtx<V, ModelSubtype<V>>,
  ent: Entity<V>,
): Maybe<EntityWrapper<HadesRender, V>> {
  return usingTraversal(ctx, (c, trv) => {
    const mde = preview(entityContents<V>().dot(trv).dot(_GsnDiagramItem<V>()), ent);
    switch (mde.tag) {
      case "Nothing":
        return Nothing;
      case "Just": {
        const de = mde.value;
        const dtc = DiagramTypeClass_GsnDiagramType(cls);
        const vctx = compileAppearance(
          dtc,
          c,
          view(diagramEntityData<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>(), de),
          GenericContext(ent.entityId, mempty_AppearanceDef),
        );
        return Just(DiagramWrapper<HadesRender, V, ModelSubtype<V>, GsnElement<V>>(
          Avatar_Element(dtc),
          /* wrappedEntityId = */ ent.entityId,
          /* diagramToEdit = */ de._diagramEntityContents,
          /* diagramEntityTraversal = */ _GsnDiagramItem<V>(),
          /* diagramTraversal = */ trv,
          /* diagramDialog = */ elementDialog(dtc),
          /* diagramContext = */ vctx,
          /* diagramMenu = */ Nothing,
          /* diagramToolbar = */ (_) => gsnToolbar(cls, ent.entityId, ent._entityParent),
        ));
      }
      default:
        return absurd(mde);
    }
  });
}

/** Entities shown on GSN diagrams. */
export function gsnDiagramEntityTypes<V = any>(_cls?: HasDiagrams<HadesRender, V>): DiagramEntityTypes<V> {
  return M.fromList<Variant<V>, readonly Variant<V>[]>([
    [gsnDiagramVariant, [goalVariant, strategyVariant, solutionVariant, contextVariant,
      assumptionVariant, justificationVariant, evidenceVariant]],
  ]);
}

// ---------------------------------------------------------------------------------------------
// * Nodes

export type GsnNode =
  | {
    readonly tag: "Goal";
    readonly _gsnNodeName: Name;
    readonly _gsnNodeText: string;
    readonly _gsnDeveloped: boolean;
    readonly _gsnInstantiated: boolean;
  }
  | {
    readonly tag: "Strategy";
    readonly _gsnNodeName: Name;
    readonly _gsnNodeText: string;
    readonly _gsnDeveloped: boolean;
    readonly _gsnInstantiated: boolean;
  }
  | { readonly tag: "Solution"; readonly _gsnNodeName: Name; readonly _gsnNodeText: string; readonly _gsnInstantiated: boolean }
  | { readonly tag: "Context"; readonly _gsnNodeName: Name; readonly _gsnNodeText: string; readonly _gsnInstantiated: boolean }
  | { readonly tag: "Assumption"; readonly _gsnNodeName: Name; readonly _gsnNodeText: string; readonly _gsnInstantiated: boolean }
  | { readonly tag: "Justification"; readonly _gsnNodeName: Name; readonly _gsnNodeText: string; readonly _gsnInstantiated: boolean }
  | { readonly tag: "GsnOption"; readonly _gsnNodeName: Name; readonly _gsnNodeText: string; readonly _gsnInstantiated: boolean };

export function Goal(_gsnNodeName: Name, _gsnNodeText: string, _gsnDeveloped: boolean, _gsnInstantiated: boolean): GsnNode {
  return { tag: "Goal", _gsnNodeName, _gsnNodeText, _gsnDeveloped, _gsnInstantiated };
}
export function Strategy(_gsnNodeName: Name, _gsnNodeText: string, _gsnDeveloped: boolean, _gsnInstantiated: boolean): GsnNode {
  return { tag: "Strategy", _gsnNodeName, _gsnNodeText, _gsnDeveloped, _gsnInstantiated };
}
export function Solution(_gsnNodeName: Name, _gsnNodeText: string, _gsnInstantiated: boolean): GsnNode {
  return { tag: "Solution", _gsnNodeName, _gsnNodeText, _gsnInstantiated };
}
export function Context(_gsnNodeName: Name, _gsnNodeText: string, _gsnInstantiated: boolean): GsnNode {
  return { tag: "Context", _gsnNodeName, _gsnNodeText, _gsnInstantiated };
}
export function Assumption(_gsnNodeName: Name, _gsnNodeText: string, _gsnInstantiated: boolean): GsnNode {
  return { tag: "Assumption", _gsnNodeName, _gsnNodeText, _gsnInstantiated };
}
export function Justification(_gsnNodeName: Name, _gsnNodeText: string, _gsnInstantiated: boolean): GsnNode {
  return { tag: "Justification", _gsnNodeName, _gsnNodeText, _gsnInstantiated };
}
export function GsnOption(_gsnNodeName: Name, _gsnNodeText: string, _gsnInstantiated: boolean): GsnNode {
  return { tag: "GsnOption", _gsnNodeName, _gsnNodeText, _gsnInstantiated };
}

/** Derived `instance Show GsnNode`. */
export function show_GsnNode(n: GsnNode): string {
  const common = "_gsnNodeName = " + show_Name(n._gsnNodeName) + ", _gsnNodeText = " + T.showText(n._gsnNodeText);
  switch (n.tag) {
    case "Goal":
    case "Strategy":
      return n.tag + " {" + common + ", _gsnDeveloped = " + showBool(n._gsnDeveloped) +
        ", _gsnInstantiated = " + showBool(n._gsnInstantiated) + "}";
    case "Solution":
    case "Context":
    case "Assumption":
    case "Justification":
    case "GsnOption":
      return n.tag + " {" + common + ", _gsnInstantiated = " + showBool(n._gsnInstantiated) + "}";
    default:
      return absurd(n);
  }
}

/** `instance ToJSON GsnNode` and `instance FromJSON GsnNode` */
export const JSON_GsnNode: J.JSONCodec<GsnNode> = J.codec(
  (node) => {
    switch (node.tag) {
      case "Goal":
        return J.object([["type", "Goal"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["developed", node._gsnDeveloped], ["instantiated", node._gsnInstantiated]]);
      case "Strategy":
        return J.object([["type", "Strategy"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["developed", node._gsnDeveloped], ["instantiated", node._gsnInstantiated]]);
      case "Solution":
        return J.object([["type", "Solution"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["instantiated", node._gsnInstantiated]]);
      case "Context":
        return J.object([["type", "Context"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["instantiated", node._gsnInstantiated]]);
      case "Assumption":
        return J.object([["type", "Assumption"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["instantiated", node._gsnInstantiated]]);
      case "Justification":
        return J.object([["type", "Justification"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["instantiated", node._gsnInstantiated]]);
      case "GsnOption":
        return J.object([["type", "Option"], ["name", JSON_Name.toJSON(node._gsnNodeName)], ["text", node._gsnNodeText],
          ["instantiated", node._gsnInstantiated]]);
      default:
        return absurd(node);
    }
  },
  (val) => J.withObject("GSN Node", (v) => {
    const str = J.field(v, "type", J.textJ);
    switch (str) {
      case "Goal":
        return Goal(
          J.field(v, "name", JSON_Name),
          J.field(v, "text", J.textJ),
          J.fieldDefault(v, "developed", J.boolJ, true),
          J.fieldDefault(v, "instantiated", J.boolJ, true));
      case "Strategy":
        return Strategy(
          J.field(v, "name", JSON_Name),
          J.field(v, "text", J.textJ),
          J.fieldDefault(v, "developed", J.boolJ, true),
          J.fieldDefault(v, "instantiated", J.boolJ, true));
      case "Solution":
        return Solution(J.field(v, "name", JSON_Name), J.field(v, "text", J.textJ), J.fieldDefault(v, "instantiated", J.boolJ, true));
      case "Context":
        return Context(J.field(v, "name", JSON_Name), J.field(v, "text", J.textJ), J.fieldDefault(v, "instantiated", J.boolJ, true));
      case "Assumption":
        return Assumption(J.field(v, "name", JSON_Name), J.field(v, "text", J.textJ), J.fieldDefault(v, "instantiated", J.boolJ, true));
      case "Justification":
        return Justification(J.field(v, "name", JSON_Name), J.field(v, "text", J.textJ), J.fieldDefault(v, "instantiated", J.boolJ, true));
      case "Option":
        return GsnOption(J.field(v, "name", JSON_Name), J.field(v, "text", J.textJ), J.fieldDefault(v, "instantiated", J.boolJ, true));
      default:
        return J.fail("Unknown GSN node type: " + str);
    }
  }, val),
);

export const gsnNodeName: Lens<GsnNode, Name> = lens(
  (n: GsnNode) => n._gsnNodeName,
  (n, txt: Name): GsnNode => ({ ...n, _gsnNodeName: txt }),
);

export const gsnNodeText: Lens<GsnNode, string> = lens(
  (n: GsnNode) => n._gsnNodeText,
  (n, txt: string): GsnNode => ({ ...n, _gsnNodeText: txt }),
);

export const gsnInstantiated: Lens<GsnNode, boolean> = lens(
  (n: GsnNode) => n._gsnInstantiated,
  (n, b: boolean): GsnNode => ({ ...n, _gsnInstantiated: b }),
);

export const gsnDeveloped: Traversal<GsnNode, boolean> = traversal(
  (v: GsnNode, f: (d: boolean) => boolean): GsnNode => {
    switch (v.tag) {
      case "Goal": return Goal(v._gsnNodeName, v._gsnNodeText, f(v._gsnDeveloped), v._gsnInstantiated);
      case "Strategy": return Strategy(v._gsnNodeName, v._gsnNodeText, f(v._gsnDeveloped), v._gsnInstantiated);
      default: return v;
    }
  },
  (v: GsnNode): boolean[] => (v.tag === "Goal" || v.tag === "Strategy" ? [v._gsnDeveloped] : []),
);

/** The default name prefix and the dotted number of the current entity, as the creators use it. */
function dottedName<V, W>(ctx: ModelEditCtx<V, W>, prefix: string): Name {
  const nums = dottedNumbers(currentName(ctx));
  return Name(prefix + (T.isNull(nums) ? nums : nums + "."));
}

/**
 * Create a goal with an appropriate default name to be added as a child of the current node.
 * Does not actually add the new entity.
 */
export function createGoal<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "G");
  return Goal(nm, "", true, true);
}

/**
 * Create a strategy with an appropriate default name to be added as a child of the current
 * entity. Does not actually add the new strategy.
 */
export function createStrategy<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "S");
  return Strategy(nm, "", true, true);
}

/**
 * Create a solution with an appropriate default name to be added as a child of the current
 * entity. Does not actually add the new solution.
 */
export function createSolution<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "Sn");
  return Solution(nm, "", true);
}

/**
 * Create a context with an appropriate default name to be added as a child of the current
 * entity. Does not actually add the new context.
 */
export function createContext<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "C");
  return Context(nm, "", true);
}

/**
 * Create an assumption with an appropriate default name to be added as a child of the current
 * entity. Does not actually add the new assumption.
 */
export function createAssumption<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "A");
  return Assumption(nm, "", true);
}

/**
 * Create a justification with an appropriate default name to be added as a child of the current
 * entity. Does not actually add the new justification.
 */
export function createJustification<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "J");
  return Justification(nm, "", true);
}

/**
 * Create an option with an appropriate default name to be added as a child of the current
 * entity. Does not actually add the new option.
 */
export function createGsnOption<V, W>(ctx: ModelEditCtx<V, W>): GsnNode {
  const nm = dottedName(ctx, "Opt");
  return GsnOption(nm, "", true);
}

/** The box type for each node type. */
export function gsnNodeType(n: GsnNode): BoxType {
  switch (n.tag) {
    case "Goal": return "GoalBox";
    case "Strategy": return "StrategyBox";
    case "Solution": return "SolutionBox";
    case "Context": return "ContextBox";
    case "Assumption": return "AssumptionBox";
    case "Justification": return "JustificationBox";
    case "GsnOption": return "OptionBox";
    default: return absurd(n);
  }
}

/** The variant name for a node. */
export function gsnNodeVariant<A = any>(n: GsnNode): Variant<A> {
  switch (n.tag) {
    case "Goal": return goalVariant;
    case "Strategy": return strategyVariant;
    case "Solution": return solutionVariant;
    case "Context": return contextVariant;
    case "Assumption": return assumptionVariant;
    case "Justification": return justificationVariant;
    case "GsnOption": return gsnOptionVariant;
    default: return absurd(n);
  }
}

/** The GSN shape decoration is a list of polygons. */
export function gsnBoxDecoration(
  /** The shape definition. */
  box: BoundBox,
  /** Instantiated flag. */
  instantiated: boolean,
  /** Developed flag. */
  developed: boolean,
): Point[][] {
  switch (box.tag) {
    case "NoBox":
      return [];
    case "BoundBox": {
      const x1 = box._0._pX;
      const { _pX: x2, _pY: y } = box._1;
      const decoSize = 20; // Size of the box
      const basePoint = mkPoint((x1 + x2) / 2, y); // mid point of the bottom of the box.
      const decoBox = BoundBox(
        movePoint(basePoint, [-decoSize / 2, 0]),
        movePoint(basePoint, [decoSize / 2, decoSize]),
      );
      const diamond = diamondCorners(decoBox); // Safe because this is not NoBox
      const [p1, p2, p3, p4] = diamond; // Starting from the left corner going clockwise.
      if (instantiated && developed) return [];
      if (!instantiated && developed) return [diamond];
      if (instantiated && !developed) return [[p1, p2, p3]]; // Triangle from upper half of diamond.
      return [[p1, p2, p3], [p1, p3, p4]]; // Diamond formed by two triangles.
    }
    default:
      return absurd(box);
  }
}

/**
 * Draw the box, but override its position and size with the BoundBox argument. This can also
 * draw evidence boxes.
 */
export function* drawGsnBox<V>(
  cls: GsnClass<V>,
  d: DeltaCtx<GsnElement<V>>,
  box: Box<GsnDiagramType<V>, V>,
  /** The contents of the box */
  contents: HadesLayout<void>,
  /** The border colour to use (@Nothing@ means default, i.e. black.) */
  border: Maybe<Colour>,
): Delta<GsnElement<V>, (b: BoundBox) => HadesRender<void>> {
  const shape = box.boxShape;
  const base = scriptContext<V, ModelSubtype<V>>(d);
  const prsm = usingTraversal(base, (_c, p) => p);
  goToEntity(base, box.boxEntity);
  const ent = current(base);
  const typ = box.boxType as BoxType;
  const f: (b: BoundBox) => HadesRender<void> = typ === "EvidenceBox"
    ? (b) => drawEvidence(cls, ent, contents, border, b)
    : (b) => drawGsnBoxRaw(
      box.boxShapeClass,
      typ,
      preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(prsm).dot(_GsnNodeItem<V>()), ent),
      contents,
      border,
      shape,
      b,
    );
  // maybe id withLineColour border <$> ...
  return (b: BoundBox) => (border.tag === "Just" ? withLineColour(border.value, f(b)) : f(b));
}

/**
 * Draw a GSN box. The redundant arguments for @shape@ and @BoundBox@ make this useful
 * in the "boxTypeDraw" function of "DiagramTypeClass".
 *
 * (TypeScript: `shapeCls` is the `BoxShapeClass shape` dictionary.)
 */
export function drawGsnBoxRaw<S>(
  shapeCls: BoxShapeClass<S>,
  typ: BoxType,
  /** Source for the text to write in the box. @Nothing@ is assumed to be a Goal. */
  mNode: Maybe<GsnNode>,
  /** Contents of the box. */
  contents: HadesLayout<void>,
  /** Border colour, if not black. */
  border: Maybe<Colour>,
  /** Shape to use for figuring out where the text should go. */
  shape1: S,
  /** Definition of the shape size and position. */
  boundBox: BoundBox,
): HadesRender<void> {
  const blankBoxName = (t: BoxType): string => {
    switch (t) {
      case "GoalBox": return "Goal";
      case "StrategyBox": return "Strategy";
      case "SolutionBox": return "Solution";
      case "ContextBox": return "Context";
      case "AssumptionBox": return "Assumption";
      case "JustificationBox": return "Justification";
      case "OptionBox": return "Option";
      case "EvidenceBox": return "Evidence";
      default: return absurd(t);
    }
  };
  return (env) => {
    const instantiated = fromMaybe(true, mNode.tag === "Just" ? Just(view(gsnInstantiated, mNode.value)) : Nothing);
    const developed = fromMaybe(true, mNode.tag === "Just" ? preview(gsnDeveloped, mNode.value) : Nothing);
    const shape2 = set(shapeCls.shapeDefinition, boundBox, shape1);
    const outline: HadesRender<void> = (env1) => {
      switch (typ) {
        case "GoalBox":
          drawPolygon(rectangleCorners(Rectangle(boundBox)))(env1);
          return;
        case "StrategyBox":
          drawPolygon(parallelogramCorners(Parallelogram(boundBox)))(env1);
          return;
        case "SolutionBox":
          drawEllipse(Ellipse(boundBox))(env1);
          return;
        case "ContextBox":
          drawOval(Oval(boundBox))(env1);
          return;
        case "AssumptionBox":
          drawEllipse(Ellipse(boundBox))(env1);
          drawCornerLetter(boundBox, "A")(env1);
          return;
        case "JustificationBox":
          drawEllipse(Ellipse(boundBox))(env1);
          drawCornerLetter(boundBox, "J")(env1);
          return;
        case "OptionBox":
          drawPolygon(diamondCorners(boundBox))(env1);
          return;
        default:
          return; // Should never happen.
      }
    };
    (border.tag === "Just" ? withLineColour(border.value, outline) : outline)(env);
    for (const poly of gsnBoxDecoration(boundBox, instantiated, developed)) drawPolygon(poly)(env);
    runLayout_(shapeCls.shapeInnerBox(shape2), (env1, st) => {
      switch (mNode.tag) {
        case "Just":
          layoutTitle(Nothing, view(gsnNodeName.dot(nameText), mNode.value))(env1, st);
          break;
        case "Nothing":
          layoutTitle(Nothing, blankBoxName(typ))(env1, st);
          break;
        default:
          absurd(mNode);
      }
      layoutParagraphGap(env1, st);
      contents(env1, st);
    })(env);
  };
}

// ---------------------------------------------------------------------------------------------
// * Edges

/** A GSN Edge is  the semantic content of an arrow on a GSN diagram. */
export type GsnEdgeType = "ContextArrow" | "SupportArrow";
/** `[minBound .. maxBound]` (derived `Enum`, `Bounded`). */
export const gsnEdgeTypeValues: readonly GsnEdgeType[] = ["ContextArrow", "SupportArrow"];
export const ContextArrow: GsnEdgeType = "ContextArrow";
export const SupportArrow: GsnEdgeType = "SupportArrow";

/** Derived `instance Show GsnEdgeType`. */
export function show_GsnEdgeType(t: GsnEdgeType): string {
  return t;
}

/** `instance ToJSON GsnEdgeType` and `instance FromJSON GsnEdgeType` */
export const JSON_GsnEdgeType: J.JSONCodec<GsnEdgeType> = J.codec(
  (t) => {
    switch (t) {
      case "ContextArrow": return "Context";
      case "SupportArrow": return "Support";
      default: return absurd(t);
    }
  },
  (v) => J.withText("GSN Edge Type", (s): GsnEdgeType => {
    switch (s) {
      case "Context": return "ContextArrow";
      case "Support": return "SupportArrow";
      default: return J.fail("Not a GSN Edge Type: " + T.showText(s));
    }
  }, v),
);

export function gsnEdgeVariant<A = any>(t: GsnEdgeType): Variant<A> {
  switch (t) {
    case "ContextArrow": return contextArrowVariant;
    case "SupportArrow": return supportArrowVariant;
    default: return absurd(t);
  }
}

/**
 * An arrow in a GSN diagram is an avatar for a GsnEdge entity. The only information this
 * records is the type of the arrow and what (if anything) it connects. Lack of connection
 * is indicated by a nil UUID.
 *
 * If an arrow is connected then it should also have a corresponding entry in the model relations
 * table.
 */
export interface GsnEdge {
  readonly gsnEdgeType: GsnEdgeType;
  readonly _gsnEdgeName: Name;
  readonly _gsnEdgeCard: Cardinality;
}
export function GsnEdge(gsnEdgeType: GsnEdgeType, _gsnEdgeName: Name, _gsnEdgeCard: Cardinality): GsnEdge {
  return { gsnEdgeType, _gsnEdgeName, _gsnEdgeCard };
}

/** The `gsnEdgeType` field accessor. */
export function gsnEdgeType(e: GsnEdge): GsnEdgeType {
  return e.gsnEdgeType;
}

/** Derived `instance Show GsnEdge`. */
export function show_GsnEdge(e: GsnEdge): string {
  return "GsnEdge {gsnEdgeType = " + show_GsnEdgeType(e.gsnEdgeType) + ", _gsnEdgeName = " +
    show_Name(e._gsnEdgeName) + ", _gsnEdgeCard = " + show_Cardinality(e._gsnEdgeCard) + "}";
}

/** `instance ToJSON GsnEdge` and `instance FromJSON GsnEdge` */
export const JSON_GsnEdge: J.JSONCodec<GsnEdge> = J.codec(
  (e) => J.object([
    ["type", JSON_GsnEdgeType.toJSON(e.gsnEdgeType)],
    ["name", JSON_Name.toJSON(view(gsnEdgeName, e))],
    ["card", JSON_Cardinality.toJSON(view(gsnEdgeCard, e))],
  ]),
  (val) => J.withObject("GSN relationship", (v) => GsnEdge(
    J.field(v, "type", JSON_GsnEdgeType),
    J.field(v, "name", JSON_Name),
    J.fieldDefault<Cardinality>(v, "card", JSON_Cardinality, "CardinalityOne"),
  ), val),
);

export const gsnEdgeName: Lens<GsnEdge, Name> = lens(
  (e: GsnEdge) => e._gsnEdgeName,
  (v, n: Name): GsnEdge => ({ ...v, _gsnEdgeName: n }),
);

export const gsnEdgeCard: Lens<GsnEdge, Cardinality> = lens(
  (e: GsnEdge) => e._gsnEdgeCard,
  (v, c: Cardinality): GsnEdge => ({ ...v, _gsnEdgeCard: c }),
);

/** Haskell `elem` on box types. */
function boxElem(t: BoxType, ts: readonly BoxType[]): boolean {
  return ts.includes(t);
}

export function* gsnArrowCanConnect<V>(
  _cls: GsnClass<V>,
  d: DeltaCtx<GsnElement<V>>,
  connection: ConnectionDirection,
  arrow: Arrow<GsnDiagramType<V>, V>,
  box: Box<GsnDiagramType<V>, V>,
): Delta<GsnElement<V>, boolean> {
  const terminatorType = function* (c: ConnectorEnd): Delta<GsnElement<V>, Maybe<BoxType>> {
    switch (c.tag) {
      case "Unconnected":
        return Nothing;
      case "Connected": {
        // fmap join $ withItem target $ \case ...
        const r = yield* withItem<GsnElement<V>, Maybe<BoxType>>(
          d,
          c.connectorTarget,
          // eslint-disable-next-line require-yield
          function* (_d, item) {
            return item.tag === "ElemBox" ? Just(item._0.boxType as BoxType) : Nothing;
          },
        );
        return r.tag === "Just" ? r.value : Nothing;
      }
      default:
        return absurd(c);
    }
  };
  const targetType = box.boxType as BoxType;
  const arrowTyp = arrow.arrowType as ArrowType;
  switch (arrowTyp.tag) {
    case "GsnArrow":
      switch (arrowTyp._0) {
        case "ContextArrow":
          switch (connection) {
            case "ConnectionFrom":
              return boxElem(targetType, ["GoalBox", "StrategyBox", "OptionBox"]);
            case "ConnectionTo":
              return boxElem(targetType, ["ContextBox", "AssumptionBox", "JustificationBox", "OptionBox"]);
            default:
              return absurd(connection);
          }
        case "SupportArrow": {
          const shape = arrow._arrowShape;
          const [start, end] = shape._lineEnds;
          const startT = yield* terminatorType(start);
          const endT = yield* terminatorType(end);
          switch (connection) {
            case "ConnectionFrom":
              if (endT.tag === "Nothing") return boxElem(targetType, ["GoalBox", "StrategyBox", "OptionBox"]);
              switch (endT.value) {
                case "GoalBox": return boxElem(targetType, ["GoalBox", "StrategyBox", "OptionBox"]);
                case "StrategyBox": return boxElem(targetType, ["GoalBox", "OptionBox"]);
                case "SolutionBox": return boxElem(targetType, ["GoalBox", "OptionBox"]);
                case "OptionBox": return boxElem(targetType, ["GoalBox", "StrategyBox"]);
                default: return false;
              }
            case "ConnectionTo":
              if (startT.tag === "Nothing") {
                return boxElem(targetType, ["GoalBox", "StrategyBox", "SolutionBox", "OptionBox"]);
              }
              switch (startT.value) {
                case "GoalBox": return boxElem(targetType, ["GoalBox", "StrategyBox", "SolutionBox", "OptionBox"]);
                case "StrategyBox": return boxElem(targetType, ["GoalBox", "OptionBox"]);
                case "OptionBox": return boxElem(targetType, ["GoalBox", "StrategyBox", "SolutionBox"]);
                default: return false;
              }
            default:
              return absurd(connection);
          }
        }
        default:
          return absurd(arrowTyp._0);
      }
    case "TraceArrow":
      switch (connection) {
        case "ConnectionFrom": return targetType === "SolutionBox";
        case "ConnectionTo": return targetType === "EvidenceBox";
        default: return absurd(connection);
      }
    default:
      return absurd(arrowTyp);
  }
}

/** Draw the cardinality as a decoration. */
export function gsnArrowDecorations(edge: GsnEdge): ArrowDecoration[] {
  const circleRadius = 4;
  const [width, height] = [32, 22]; // Fixed size for text. Quick and dirty solution.
  const dim: readonly [number, number] = [width, height];
  const circle = (solid: boolean): HadesRender<void> => (env) => {
    const cr = env.cr;
    Cairo.save(cr);
    Cairo.moveTo(cr, circleRadius, 0);
    Cairo.arc(cr, 0, 0, circleRadius, 0, 2 * Math.PI);
    Cairo.closePath(cr);
    if (solid) Cairo.setSourceRGB(cr, 0, 0, 0);
    else Cairo.setSourceRGB(cr, 1, 1, 1);
    Cairo.fillPreserve(cr);
    Cairo.setSourceRGB(cr, 0, 0, 0);
    Cairo.stroke(cr);
    Cairo.restore(cr);
  };
  const sideText = (str: string): readonly [readonly [number, number], HadesRender<void>] =>
    [dim, runLayout_(BoundBox(mkPoint(5, 3), mkPoint(width - 10, height - 6)), layoutText([], str))];
  const card = view(gsnEdgeCard, edge);
  switch (card) {
    case "CardinalityOne": return [];
    case "CardinalityOpt": return [ArrowDecoration(0.75, circle(false), Nothing)];
    case "CardinalityMany": return [ArrowDecoration(0.75, circle(true), Just(sideText("0:n")))];
    case "CardinalityMany1": return [ArrowDecoration(0.75, circle(true), Just(sideText("1:n")))];
    default: return absurd(card);
  }
}

// ---------------------------------------------------------------------------------------------
// * GSN Model Entities

/** GSN Model entities: nodes, edges and diagrams. */
export type GsnItem<V> = ModelSubtype<V>;

export function _GsnNodeItem<V = any>(): Prism<GsnItem<V>, GsnNode> {
  return prism(
    (n: GsnNode) => GsnNodeItem<V>(n),
    (v: GsnItem<V>) => (v.tag === "GsnNodeItem" ? Right(v._0) : Left(v)),
  );
}

export function _GsnEdgeItem<V = any>(): Prism<GsnItem<V>, GsnEdge> {
  return prism(
    (e: GsnEdge) => GsnEdgeItem<V>(e),
    (v: GsnItem<V>) => (v.tag === "GsnEdgeItem" ? Right(v._0) : Left(v)),
  );
}

export function _GsnDiagramItem<V = any>(
  _cls?: GsnBaseClass<V>,
): Prism<GsnItem<V>, DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>> {
  return prism(
    (d: DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>) => GsnDiagramItem<V>(d),
    (v: GsnItem<V>) => (v.tag === "GsnDiagramItem" ? Right(v._0) : Left(v)),
  );
}

export function gsnItemName<V = any>(_cls?: GsnBaseClass<V>): Lens<GsnItem<V>, Name> {
  const getName = (item: GsnItem<V>): Name => {
    switch (item.tag) {
      case "GsnNodeItem": return view(gsnNodeName, item._0);
      case "GsnEdgeItem": return view(gsnEdgeName, item._0);
      case "GsnDiagramItem": return view(diagramEntityName(), item._0);
      default: return absurd(item);
    }
  };
  const setName = (item: GsnItem<V>, nm: Name): GsnItem<V> => {
    switch (item.tag) {
      case "GsnNodeItem": return GsnNodeItem<V>(set(gsnNodeName, nm, item._0));
      case "GsnEdgeItem": return GsnEdgeItem<V>(set(gsnEdgeName, nm, item._0));
      case "GsnDiagramItem": return GsnDiagramItem<V>(set(diagramEntityName(), nm, item._0));
      default: return absurd(item);
    }
  };
  return lens(getName, setName);
}

/** Generate an avatar for the given entity. */
export function gsnAvatarType<V>(
  cls: GsnBaseClass<V>,
  prsm: Traversal<V, GsnItem<V>>,
  v: V,
): AvatarCreation<GsnDiagramType<V>, V> {
  const item = preview(prsm, v);
  if (item.tag === "Just") {
    switch (item.value.tag) {
      case "GsnNodeItem": return SimpleBox(gsnNodeType(item.value._0));
      case "GsnEdgeItem": return SimpleArrow(GsnArrow(item.value._0.gsnEdgeType));
      case "GsnDiagramItem": return NoAvatar; // Diagram links handled by GenericDiagram.
      default: return absurd(item.value);
    }
  }
  if (preview(cls._Evidence, v).tag === "Just") return SimpleBox(EvidenceBox);
  if (preview(cls._Trace, v).tag === "Just") return SimpleArrow(TraceArrow);
  return NoAvatar;
}

/** Scripts for editing a GSN diagram. (`W` is `GsnItem v`: see "GsnScriptAct".) */
export type GsnScript<V, A> = ModelScript<HadesRender, V, A>;

/** TypeScript: a first-class `GsnScript v a`, i.e. a `ModelScriptAct` at `W = GsnItem<V>`. */
export type GsnScriptAct<V, A> = ModelScriptAct<HadesRender, V, GsnItem<V>, A>;

/**
 * Activation script for GSN entities.
 *
 * (TypeScript: `gsnActivation(cls, mEnt)` is the `ActivationScript` applied to `mEnt`.)
 */
export function gsnActivation<V>(cls: GsnBaseClass<V>, mEnt: Maybe<Entity<V>>): GsnScriptAct<V, Maybe<string>> {
  switch (mEnt.tag) {
    case "Nothing":
      // eslint-disable-next-line require-yield
      return function* (_ctx) {
        return cannotHappen<Maybe<string>>("gsnActivation: Nothing activated.", Nothing);
      };
    case "Just": {
      const e = mEnt.value;
      return function* (ctx) {
        const prsm = usingTraversal(ctx, (_c, p) => p);
        const item = preview(entityContents<V>().dot(prsm), e);
        if (item.tag === "Nothing") return Nothing;
        if (item.value.tag === "GsnDiagramItem") {
          goToEntity(ctx, e.entityId);
          yield* openDiagram<HadesRender, V, GsnItem<V>>(cls, ctx, e.entityId);
          return Nothing;
        }
        return yield* editEntityProperties<HadesRender, V, GsnItem<V>>(ctx, e.entityId);
      };
    }
    default:
      return absurd(mEnt);
  }
}

/** TypeScript: the `ActivationScript HadesRender v (GsnItem v)` value `gsnActivation`. */
export function gsnActivationScript<V>(cls: GsnBaseClass<V>): ActivationScript<HadesRender, V, GsnItem<V>> {
  return (mEnt) => gsnActivation(cls, mEnt);
}

/** Context menu for GSN items in the model tree. */
export function gsnEntityMenu<V>(
  cls: GsnBaseClass<V>,
  ent: Entity<V>,
  item: GsnItem<V>,
): Menu<GsnScriptAct<V, Maybe<string>>> {
  if (item.tag === "GsnDiagramItem") return diagramEntityMenu<HadesRender, V, GsnItem<V>>(cls, ent.entityId);
  return entityMenu<HadesRender, V, GsnItem<V>>(cls, ent);
}

/** Menu for adding a new node or edge to the model. */
export function gsnAddEntityMenu<V>(cls: GsnBaseClass<V>, parent: ModelId): Menu<GsnScriptAct<V, Maybe<string>>> {
  type Item = GsnScriptAct<V, Maybe<string>>;
  const nodeItem = ([lbl, creator]: readonly [string, (ctx: ModelEditCtx<V, GsnItem<V>>) => GsnNode]) =>
    menuItem<Item>(lbl, function* (ctx) {
      const r = yield* addNode(cls, ctx, parent, creator);
      switch (r.tag) {
        case "Nothing": return Nothing;
        case "Just": return Just("Insert " + view(nameText, r.value[0]));
        default: return absurd(r);
      }
    });
  const edgeItem = (typ: GsnEdgeType) => menuItem<Item>(T.pack(show_GsnEdgeType(typ)), function* (ctx) {
    const [nm] = yield* addEdge(cls, ctx, parent, typ);
    return Just("Insert " + view(nameText, nm));
  });
  return Menu<Item>([[
    menuItem<Item>("Add GSN Diagram", function* (ctx) {
      const diag = review(cls._Gsn, GsnDiagramItem<V>(
        DiagramEntity(Name("GSN Diagram "), mempty_Diagram<GsnElement<V>>(), mempty_DiagramAppearance)));
      const r = yield* insertEntity<HadesRender, V, GsnItem<V>>(ctx, diag, parent);
      switch (r.tag) {
        case "Nothing": return Nothing;
        case "Just": return Just("Insert " + view(nameText, r.value[0]));
        default: return absurd(r);
      }
    }),
    subMenu<Item>("GSN Items", Menu<Item>([
      ([
        ["Goal", createGoal], ["Strategy", createStrategy],
        ["Solution", createSolution], ["Context", createContext],
        ["Assumption", createAssumption], ["Justification", createJustification],
        ["Option", createGsnOption],
      ] as const).map(nodeItem),
      gsnEdgeTypeValues.map(edgeItem),
    ])),
  ]]);
}

/**
 * Add a node to the model and return the name and UUID. Opens a dialog box for the user to
 * enter the name and text.
 */
export function* addNode<V>(
  cls: EntityClass<V> & HasGsn<V>,
  ctx: ModelEditCtx<V, GsnItem<V>>,
  /** Parent package for new node. */
  uuid: ModelId,
  creator: (ctx: ModelEditCtx<V, GsnItem<V>>) => GsnNode,
): GsnScript<V, Maybe<[Name, ModelId]>> {
  goToEntity(ctx, uuid);
  const candidate = creator(ctx);
  return yield* insertEntity<HadesRender, V, GsnItem<V>>(ctx, review(cls._Gsn, GsnNodeItem<V>(candidate)), uuid);
}

/** Add a new edge to the model and return the name and UUID. Does not open a dialog box. */
// eslint-disable-next-line require-yield
export function* addEdge<V>(
  cls: GsnBaseClass<V>,
  ctx: ModelEditCtx<V, GsnItem<V>>,
  uuid: ModelId,
  typ: GsnEdgeType,
): GsnScript<V, [Name, ModelId]> {
  goToEntity(ctx, uuid);
  const nm = modelNewName(ctx, Name(T.pack(show_GsnEdgeType(typ))));
  const edge = GsnEdgeItem<V>(GsnEdge(typ, nm, "CardinalityOne"));
  const newEntity = mkEntity(ctx, review(cls._Gsn, edge));
  return [view(gsnItemName<V>(cls), edge), newEntity.entityId];
}

/** Toolbar for GSN diagrams. Provides easy insertion of new diagram elements. */
export function gsnToolbar<V>(
  cls: GsnClass<V>,
  /** This diagram. */
  diagId: ModelId,
  /** Model package where new entities are to be added. */
  parent: ModelId,
): DeltaToolbar<GsnElement<V>> {
  type D = GsnElement<V>;
  const dtc = DiagramTypeClass_GsnDiagramType(cls);
  const compile1 = (
    m: Model<V>,
    a: DiagramAppearance<GsnDiagramType<V>, V>,
    vctx: GenericContext<GsnDiagramType<V>, V>,
  ): GenericContext<GsnDiagramType<V>, V> => fromRight(vctx, evalModelEdit(cls, cls._Gsn, m,
    (c: ModelEditCtx<V, GsnItem<V>>) => compileAppearance(dtc, c, diagramAppearanceClean(a), vctx)));
  const newBoxTool = (creator: (ctx: ModelEditCtx<V, GsnItem<V>>) => GsnNode): Action<D> =>
    mkScriptAction<D>(function* (d) {
      const base = scriptContext<V, GsnItem<V>>(d);
      goToEntity(base, parent);
      const newNode = creator(base);
      return yield* newBoxEntityTool(dtc, d, parent, review(cls._Gsn, GsnNodeItem<V>(newNode)), gsnNodeType(newNode));
    });
  const newArrowTool = (typ: GsnEdgeType, base: string): Action<D> =>
    mkScriptAction<D>((d) => newArrowEntityTool(
      dtc,
      d,
      true,
      parent,
      review(cls._Gsn, GsnEdgeItem<V>(GsnEdge(typ, Name(base), "CardinalityOne"))),
      GsnArrow(typ),
    ));
  return DeltaToolbar<D>([[
    DeltaTool<D>("gsn_goal", "Goal", DeltaToolAction(newBoxTool(createGoal))),
    DeltaTool<D>("gsn_strategy", "Strategy", DeltaToolAction(newBoxTool(createStrategy))),
    DeltaTool<D>("gsn_solution", "Solution", DeltaToolAction(newBoxTool(createSolution))),
    DeltaTool<D>("gsn_support_arrow", "Support", DeltaToolAction(
      newArrowTool("SupportArrow", "Support"))),
  ], [
    DeltaTool<D>("gsn_context", "Context", DeltaToolAction(newBoxTool(createContext))),
    DeltaTool<D>("gsn_assumption", "Assumption", DeltaToolAction(
      newBoxTool(createAssumption))),
    DeltaTool<D>("gsn_justification", "Justification", DeltaToolAction(
      newBoxTool(createJustification))),
    DeltaTool<D>("gsn_context_arrow", "Context", DeltaToolAction(
      newArrowTool("ContextArrow", "Context"))),
  ], [
    DeltaTool<D>("gsn_option", "Option", DeltaToolAction(newBoxTool(createGsnOption))),
  ], [
    DeltaTool<D>("trace-arrow", "Trace", DeltaToolAction(mkScriptAction<D>((d) => newArrowEntityTool(
      dtc,
      d,
      true,
      parent,
      review(cls._Trace, Trace(Name("Trace"))),
      TraceArrow,
    )))),
  ], [
    DeltaTool<D>("basic_comment", "Comment", DeltaToolAction(newCommentTool<GsnDiagramType<V>, V>())),
    DeltaTool<D>("emblem-symbolic-link", "Link", DeltaToolAction(newLinkTool(dtc))),
  ]], [
    alignmentTools<D>(),
    [viewControlTool<HadesRender, V, GsnItem<V>, DiagramAppearance<GsnDiagramType<V>, V>, D>(
      diagId,
      _GsnDiagramItem<V>().dot(diagramEntityData<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>()),
      compile1,
      constantDialog(diagramAppearanceDialog<HadesRender, V, null, GsnDiagramType<V>>(cls, gsnDiagramVariant)),
    )],
  ]);
}

/** GUI icon name for each kind of model entity. */
export function gsnStockItem<V>(cls: GsnClass<V>, item: GsnItem<V>): string {
  const underscoreSpace = (c: string): string => (c === " " ? "_" : c);
  const varNameToStock = (v: Variant<GsnItem<V>>): string =>
    T.map(underscoreSpace, T.toLower(view(variantName(), v)));
  const stockPrefix = "gsn_";
  return stockPrefix + varNameToStock(Reflective_ModelSubtype(cls).reflectiveName(item));
}

// -----------------------------------------
// Utility functions for naming.
// -----------------------------------------

/**
 * Find a \"version number\" string of the form n.m.o: digits with decimals interspersed.
 * If there is more than one matching string then return the last one. If there is no such
 * string then return an empty string.
 */
export function dottedNumbers(str: string): string {
  const testChar = (c: string): boolean => isDigit(c) || c === ".";
  const tidy = (s: string): string => T.dropAround((c) => c === ".", s);
  const go = (s1: string): Maybe<[string, string]> => {
    const [s2, rest] = T.span(testChar, T.dropWhile((c) => !testChar(c), s1));
    const s3 = tidy(s2);
    return T.isNull(s3) ? Nothing : Just([s3, rest] as [string, string]);
  };
  const strs = L.unfoldr(go, str).map(tidy);
  return strs.length === 0 ? "" : L.last(strs);
}
