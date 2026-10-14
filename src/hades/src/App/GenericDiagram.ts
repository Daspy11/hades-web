// Ported from hades/src/App/GenericDiagram.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module provides a generic template for box-and-line diagrams where each diagram element
 * represents a corresponding model entity.
 *
 * A typical client module will define the following:
 *
 * * Some model entity types which are going to be represented by boxes and lines in a diagram type. I
 *
 * * A unit type (i.e with one constructor and no data) which is an instance of "DiagramTypeClass".
 *
 * The relationship between types of entity and types of diagram element may be simple 1:1, in which
 * case the diagram types can be used for both. Or it may be more complicated. The type-level
 * link between the two is in "avatarType" which takes a model entity and returns a tag for the
 * creation of a corresponding diagram element. Various diagram scripts can also create entities; it
 * is up to the programmer to ensure that diagram elements point at model entities of the appropriate
 * type.
 *
 * "avatarType" can also accept entities defined in other modules. The usual approach is to have a
 * module for entities of type @Foo@ to export a @HasFoo@ typeclass which provides a prism from the
 * global entity type down to @Foo@
 *
 * > class HasFoo v where
 * >    _Foo :: Prism' v Foo
 *
 * Then any other diagram which needs to display avatars for @Foo@ entities can use @_Foo@ to see if
 * its got one. There will still need to be a distinct box or arrow type for the corresponding
 * diagram elements of course.
 *
 * TypeScript port
 * ---------------
 * * **The diagram type @t@** is a phantom type parameter `T`. Its associated data families
 *   `BoxType t`, `ArrowType t` and `ModelSubtype t` are named by the members of the same names of
 *   `T`, which is never instantiated: a client writes
 *   `interface GsnDiagramType<V> { readonly BoxType: GsnBoxType; readonly ArrowType: GsnArrowType;
 *   readonly ModelSubtype: GsnModelSubtype<V> }` and uses `Element<GsnDiagramType<V>, V>`. The type
 *   functions `BoxType<T>`, `ArrowType<T>` and `ModelSubtype<T>` extract them (`any` for a `T`
 *   without them).
 * * **Classes.** `DiagramTypeClass t v` is the dictionary `DiagramTypeClass<T, V>` (extends
 *   `HasDiagrams<HadesRender, V>`). Its JSON superclass constraints on `BoxType t` and
 *   `ArrowType t` are the members `boxTypeJ` and `arrowTypeJ`; the `Eq` constraints are the
 *   structural `equals`. The method with a default (`arrowDecorations`) is in
 *   `diagramTypeClassDefaults()`, to be spread into instances. `diagramTypeName` is called with
 *   `undefined` (the Haskell passes `undefined :: t`). Delta methods take the `DeltaCtx` first.
 * * The constraint set of the instances and of most functions here, `(AppearanceClass t v,
 *   DiagramTypeClass t v, Editable HadesRender v, EntityClass v, HasDiagrams HadesRender v,
 *   HasLookups v, Queryable v, HasReports v)`, is the single dictionary
 *   `GenericDiagramClass<T, V>`. Functions take it first (then the `DeltaCtx` or `ModelEditCtx`,
 *   then the Haskell arguments): `boxView(cls, d, box)`, `edgeLinks(cls, ctx, typ, modelId)`,
 *   `newBoxEntityTool(cls, d, parent, newItem, boxTyp)`.
 * * **Instances for `Element t v`.** `Viewable`, `Connectable` and `Avatar HadesRender v
 *   (ModelSubtype t) (Element t v)` are one dictionary, `Avatar_Element(cls)` (also exported as
 *   `Viewable_Element` and `Connectable_Element`), cached per `cls` so that every call returns
 *   the same object, as `startDelta` and `DiagramWrapper` require. It also carries the
 *   `DiagramMetadataClass` members for `DiagramMetadata (Element t v) = DiagramAppearance t v`,
 *   so it can be given to `JSON_DiagramEntity` and `Reflective_DiagramEntity`. Inside a Delta,
 *   `d.cls` is this dictionary and `d.base` is the `ModelEditCtx<V, ModelSubtype<T>>` of the
 *   running script (read afresh after every wait for input).
 * * `ViewContext (Element t v)` is the record `GenericContext<T, V>` (`diagramId`,
 *   `_diagramAppearanceDef`), built with `GenericContext(id, appearanceDef)`.
 * * **`Box t v`** is existential in its shape. The record carries the packed
 *   `BoxShapeClass s` dictionary as the extra field `boxShapeClass`, which is the first argument
 *   of the `Box` constructor function: `Box(BoxShapeClass_Rectangle, diagId, modelId, typ, peg,
 *   Rectangle(bound))`. Shape methods are called through it:
 *   `b.boxShapeClass.shapeInnerBox(b.boxShape)`. Build boxes with the constructor: it attaches
 *   the hand-written `Eq` (which compares the shape definitions only) as an `[EqSym]` method.
 * * `Graphic` values likewise carry their hand-written `Eq` (build them with `VectorGraphic`,
 *   `PixelGraphic`, `ErrorGraphic`). `Arrow`, `Comment`, `Link` and `Element` use the structural
 *   `equals` (the hand-written `Arrow` instance compares every field).
 * * Polymorphic lenses and prisms are zero-argument functions (`arrowShape()`, `boxPeg()`,
 *   `diagramAppearanceDef()`, `_ElemBox()`, ...); the lenses on `Comment` and `Link` are
 *   constants. Constrained values are functions of their dictionary (`linkDialog(cls)`,
 *   `elementDialog(cls)`, `newLinkTool(cls)`); `newCommentTool()` and the gadgets
 *   `commentGadget()`, `commentGadget1()` need none.
 * * **Graphics in the browser.** SVG graphics are parsed synchronously (`@/lib/GI/Rsvg`), so a
 *   bad SVG becomes an `ErrorGraphic` exactly as in Haskell. Pixel images decode asynchronously:
 *   the `PixelGraphic` is created at once, and once its image has failed to decode it acts as
 *   the `ErrorGraphic` the Haskell parser returns ("Error during image decoding.", raw JSON kept
 *   for saving; see `decodedGraphic`). Images draw once loaded; the diagram canvas repaints on
 *   `Gdk.onImagesLoaded`. Importing an image file is asynchronous (`buttonIO` accepts a Promise).
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import * as L from "@/lib/Data/List";
import * as C from "@/lib/Data/Colour";
import * as Gdk from "@/lib/GI/Gdk";
import * as Gio from "@/lib/GI/Gio";
import * as Gtk from "@/lib/GI/Gtk";
import * as SVG from "@/lib/GI/Rsvg";
import { Just, Nothing, bindMaybe, fromMaybe, isJust, isNothing, listToMaybe, mapMaybe, maybe, orElse, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { EqSym, comparing, equals } from "@/lib/Data/Ord";
import { absurd } from "@/lib/Prelude";
import {
  _2, _Just, at, both, from, ix, lens, over, preview, prism, set, setJust, to, use, view,
  type Lens, type Prism, type Traversal,
} from "@/lib/Control/Lens";
import { takeExtension } from "@/lib/System/IO";
import {
  Dialog, OkApplyButton, OkButton, accum, arr, box, buttonIO, constantDialog, focusing, form,
  gFanout, gId, gPipe, gProd, imageDisplay, memoBox, prismatic, promoteDialog, simpleFrame,
  validate,
  type Dialog_, type DialogSelector_, type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { type Colour, Colour as mkColour } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, MenuItem, append_Menu, mempty_Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { cannotHappen, errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import { setMaybeIso } from "@/hades/src/Control/Lens/Hades";
import {
  type Action, type BoundBox, type BoxShapeClass, type ConnectionDirection, type ConnectorEnd,
  type Delta, type DeltaCtx, type DiagramId, type HasId, type Peg, type Point, type Scale,
  type Terminators, type View,
  BoundBox as mkBoundBox, BoxShapeClass_CommentBox, JSON_BoundBox, CommentBox, Connected, LineShape, NoBox,
  ShapeClass_CommentBox, ShapeClass_LineShape, Unconnected, addItem, basicShapeMenu, boxCentre,
  boxHandles, commentBoxCorners, commentBoxShape, connectable, containsBox, deleteItem,
  deltaContext, deltaDiagram, deltaZoom, diagramContents, distance, growBox,
  handleDelegatedAction, insidePolygon, lineEnds, lineFractionPoint, lineFractionSegment,
  lineFromPoints, lineHandles, lineMenu, lineMiddle, lineNormal, linePoint, lineSnap, lineUpdate,
  mempty_View, mkScriptAction, movePoint, optimiseEnds, pointDiff, simpleHandle, tellCheckpoint,
  tellItem, updateItem, withItem, yieldProperties, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type ArrowDecoration, type ArrowHead, type HadesEnv, type HadesLayout, type HadesRender,
  drawArrowDecoration, drawCommentBox, drawPolyLine, layoutHLine, layoutParagraphs, layoutPixbuf,
  layoutSvg, runLayout_, squareHandle, textBlock, withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";
import { openUserFile, tryDecodeXml } from "@/hades/src/Hades/GI/Saving";
import {
  type Avatar, type DiagramMetadataClass, type Editable, type HasDiagrams,
  ascend, avatar, avatarConnector, avatarProperties, avatarShapeMenu, nearestAvatar,
  newArrowAvatarTool, newBoxAvatarTool, newDiagramBoxTool, scriptContext, updateManyToOne,
  withBaseScript,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId,
  Name, createPath, current, currentChildren, currentName, currentPath, entityContents,
  entityName, getMeta, getModel, goToEntity, goToRoot, modelNewName, modifyRelations, nameText,
  packageMeta, queryRelations, recordModified, throwInternal, throwUser, try_, usingTraversal,
  withBaseType,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelItemSpecifier } from "@/hades/src/Model/Abstract/Properties";
import type { HasLookups } from "@/hades/src/Model/Lookups/Base";
import { runQuery } from "@/hades/src/Model/Query/Base";
import { type Queryable, compileQueryDiagram, queryDiagram } from "@/hades/src/Model/Query/Diagram";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import type { HasReports } from "@/hades/src/Model/Report/Base";
import {
  type AppearanceClass, type DiagramAppearance, type EntityShowFields,
  JSON_DiagramAppearance, append_DiagramAppearance, arrowLabels, diagramLayout, entityShowFields,
  highlights, mconcat_DiagramAppearance, mempty_DiagramAppearance, mempty_EntityShowFields,
  append_EntityShowFields,
} from "./Appearance";

// ---------------------------------------------------------------------------------------------
// * The Class of Diagrams

/**
 * The associated data family `BoxType t`: variant tag for different types of box that are avatars
 * of model entities. (`T` names it as its member `BoxType`.)
 */
export type BoxType<T> = T extends { readonly BoxType: infer B } ? B : any;

/** The associated data family `ArrowType t`: variant tag for different types of arrow. */
export type ArrowType<T> = T extends { readonly ArrowType: infer A } ? A : any;

/** The associated data family `ModelSubtype t`: the subtype of the model for which this diagram has avatars. */
export type ModelSubtype<T> = T extends { readonly ModelSubtype: infer W } ? W : any;

/**
 * Avatar creation action. When an avatar of an existing entity is required, this specifies
 * what is to be created and how. The simple versions cover most cases, with the script option
 * available for anything else.
 */
export type AvatarCreation<T, V> =
  /** The entity cannot be added to this diagram. */
  | { readonly tag: "NoAvatar" }
  /** A box of this type will be created referring to the entity. */
  | { readonly tag: "SimpleBox"; readonly _0: BoxType<T> }
  /** An arrow of this type will be created. */
  | { readonly tag: "SimpleArrow"; readonly _0: ArrowType<T> }
  /**
   * The script will be executed. It should add the new avatar to the diagram and then
   * return it, or do nothing and return @Nothing@.
   */
  | {
    readonly tag: "AvatarScript";
    readonly _0: (d: DeltaCtx<Element<T, V>>, e: Entity<V>, p: Point) => Delta<Element<T, V>, Maybe<Element<T, V>>>;
  };

export const NoAvatar: AvatarCreation<any, any> = { tag: "NoAvatar" };
export function SimpleBox<T, V>(_0: BoxType<T>): AvatarCreation<T, V> {
  return { tag: "SimpleBox", _0 };
}
export function SimpleArrow<T, V>(_0: ArrowType<T>): AvatarCreation<T, V> {
  return { tag: "SimpleArrow", _0 };
}
export function AvatarScript<T, V>(
  _0: (d: DeltaCtx<Element<T, V>>, e: Entity<V>, p: Point) => Delta<Element<T, V>, Maybe<Element<T, V>>>,
): AvatarCreation<T, V> {
  return { tag: "AvatarScript", _0 };
}

/**
 * This class acts as a configuration parameter for types of diagrams. For the most part its
 * instances will not have any values; rather the type functions within it will return types
 * that have values.
 *
 * The JSON instances for @Element@ use the @\"type\"@ field to distinguish between variants. It is
 * therefore important that the "BoxType" and "ArrowType" types have distinct JSON representations.
 *
 * The relationship between arrows and edges is complicated. Most arrows just link directly to a box
 * at each end. However some can also link to \"children\" items within a box. These correspond to
 * entities "exported" by the underlying entity.
 *
 * So for instance suppose that a @Foo@ entity can export some @Bar@ entities. These @Bar@ entities
 * appear somewhere else in the model tree and therefore have their own model IDs. In the diagram
 * this is represented by the avatar box for the @Foo@ having a list of \"children\", each of which
 * corresponds to one of the exported @Bar@ entities. The arrow "Connector" stores the diagram ID of
 * the @Foo@ avatar and also the ID of the child it is actually pointing to. This ID is actually
 * the model ID of the exported @Bar@ entity corresponding to that child on the diagram. Hence the
 * child regions in a box act as a kind of avatar for the corresponding exported entity.
 *
 * The \"edge\" entities corresponding to the diagram arrows are related to the target entities
 * through relations. When an arrow head is connected to a @Foo@ box the following relations are
 * created:
 *
 * * "arrowHeadRelation" between the edge and the @Foo@.
 *
 * * If the arrow is connected to a child of the box, then an "arrowHeadExportRelation" betweeen
 * the edge and the @Bar@ entity corresponding to the selected child.
 *
 * The logic for arrow tails is the same.
 *
 * (TypeScript: the superclasses `ToJSON`/`FromJSON (BoxType t)` and `(ArrowType t)` are the
 * codecs `boxTypeJ` and `arrowTypeJ`; the `Eq` superclasses are the structural `equals`.)
 */
export interface DiagramTypeClass<T, V> extends HasDiagrams<HadesRender, V> {
  /** `ToJSON (BoxType t)` and `FromJSON (BoxType t)`. */
  readonly boxTypeJ: J.JSONCodec<BoxType<T>>;
  /** `ToJSON (ArrowType t)` and `FromJSON (ArrowType t)`. */
  readonly arrowTypeJ: J.JSONCodec<ArrowType<T>>;
  /** Each variant of box has its own shape based on a BoundBox. */
  mkBox(diagId: DiagramId, modelId: ModelId, typ: BoxType<T>, peg: Maybe<Peg>, bound: BoundBox): Box<T, V>;
  /**
   * Each variant of box is drawn in its own way. The Delta monad gives it access to the
   * model, but this may be called with the null ModelId, in which case it should assume
   * sensible defaults. The @HadesLayout@ contains the contents of the box and the @Colour@
   * contains the border colour according to the current diagram style.
   */
  boxTypeDraw(
    d: DeltaCtx<Element<T, V>>,
    box: Box<T, V>,
    contents: HadesLayout<void>,
    border: Maybe<Colour>,
  ): Delta<Element<T, V>, (b: BoundBox) => HadesRender<void>>;
  /**
   * If this box has any application-specific connection points then list
   * them here. The second component of each pair is the touch predicate for that area.
   */
  boxChildren(d: DeltaCtx<Element<T, V>>, box: Box<T, V>): Delta<Element<T, V>, [DiagramId, (p: Point) => boolean][]>;
  /** When connecting a line to a child, where to attach it? */
  boxChildConnection(d: DeltaCtx<Element<T, V>>, box: Box<T, V>, child: DiagramId): Delta<Element<T, V>, (p: Point) => Point>;
  /**
   * Can this box be pegged to this arrow?
   * If so, return the name of the relation in the model to represent this.
   */
  boxCanPeg(d: DeltaCtx<Element<T, V>>, box: Box<T, V>, arrow: Arrow<T, V>): Delta<Element<T, V>, Maybe<Relation>>;
  /** How to represent an entity on the diagram. */
  avatarType(prsm: Traversal<V, ModelSubtype<T>>, v: V): AvatarCreation<T, V>;
  /**
   * Diagram type name, used to distinguish different types of diagram.
   * The implementation MUST return a constant and MUST NOT inspect its argument.
   */
  diagramTypeName(t: T): string;
  /** Name of the relation between boxes and arrow tails. */
  arrowTailRelation(a: ArrowType<T>): Relation;
  /** Name of the relation between arrow heads and boxes. */
  arrowHeadRelation(a: ArrowType<T>): Relation;
  /** Name of the relation between arrow tails and items exported by the entity. */
  arrowTailExportRelation(a: ArrowType<T>): Maybe<Relation>;
  /** Name of the relation between arrow heads and items exported by the entity pointed to. */
  arrowHeadExportRelation(a: ArrowType<T>): Maybe<Relation>;
  /** How to draw the arrow head. */
  arrowHeadDraw(w: Maybe<ModelSubtype<T>>, a: ArrowType<T>): ArrowHead;
  /**
   * Decorations along the arrow. The arrow name may be drawn at 0.5 so diagrams should
   * avoid that area.
   */
  arrowDecorations(w: Maybe<ModelSubtype<T>>, a: ArrowType<T>): ArrowDecoration[];
  /**
   * The line dash style for the arrow. @[]@ means solid line. A list of positive numbers
   * provides alternate on and off lengths of stroke.
   */
  arrowLineDashes(a: ArrowType<T>): number[];
  /**
   * Can the arrow connect to the box? The "DiagramId" is the child of the box to which
   * the connection will be made.
   */
  arrowCanConnect(
    d: DeltaCtx<Element<T, V>>,
    dir: ConnectionDirection,
    arrow: Arrow<T, V>,
    box: Box<T, V>,
    child: Maybe<DiagramId>,
  ): Delta<Element<T, V>, boolean>;
}

/** The members of `DiagramTypeClass` that have default implementations in the Haskell class. */
export type DiagramTypeClassDefaults<T, V> = Pick<DiagramTypeClass<T, V>, "arrowDecorations">;

/** The default methods of `DiagramTypeClass`, to be spread into instances. */
export function diagramTypeClassDefaults<T, V>(): DiagramTypeClassDefaults<T, V> {
  return {
    arrowDecorations: (_w, _a) => [],
  };
}

/**
 * TypeScript: the dictionary for the constraint set used by the instances and most of the
 * functions of this module: `(AppearanceClass t v, DiagramTypeClass t v, Editable HadesRender v,
 * EntityClass v, HasDiagrams HadesRender v, HasLookups v, Queryable v, HasReports v)`.
 */
export type GenericDiagramClass<T, V> =
  AppearanceClass<T, V> & DiagramTypeClass<T, V> & Editable<HadesRender, V> & HasLookups<V> & Queryable<V> & HasReports<V>;

/** TypeScript: the dictionary for `(EntityClass v, HasDiagrams HadesRender v, HasLookups v, HasReports v)`. */
export type LinkableClass<V> = EntityClass<V> & HasDiagrams<HadesRender, V> & HasLookups<V> & HasReports<V>;

/** The ModelEdit context in which the Delta actions of a generic diagram run (`d.base`). */
function base<T, V>(d: DeltaCtx<Element<T, V>>): ModelEditCtx<V, ModelSubtype<T>> {
  return scriptContext<V, ModelSubtype<T>>(d);
}

// ---------------------------------------------------------------------------------------------
// * Diagram Display

/**
 * Appearance view settings for diagrams. This is the compiled version used to actually draw
 * the elements.
 */
export interface AppearanceDef<V, D> {
  readonly appDefArrowLabels: Maybe<boolean>;
  readonly appDefEntityShowFields: EntityShowFields<V>;
  readonly appDefBorderColour: (d: D) => Maybe<Colour>;
}
export function AppearanceDef<V, D>(
  appDefArrowLabels: Maybe<boolean>,
  appDefEntityShowFields: EntityShowFields<V>,
  appDefBorderColour: (d: D) => Maybe<Colour>,
): AppearanceDef<V, D> {
  return { appDefArrowLabels, appDefEntityShowFields, appDefBorderColour };
}

/** `instance Semigroup (AppearanceDef v d)` */
export function append_AppearanceDef<V, D>(a1: AppearanceDef<V, D>, a2: AppearanceDef<V, D>): AppearanceDef<V, D> {
  const { appDefArrowLabels: n1, appDefEntityShowFields: e1, appDefBorderColour: c1 } = a1;
  const { appDefArrowLabels: n2, appDefEntityShowFields: e2, appDefBorderColour: c2 } = a2;
  return AppearanceDef(orElse(n1, n2), append_EntityShowFields(e1, e2), (v: D) => orElse(c2(v), () => c1(v)));
}

/** `instance Monoid (AppearanceDef v d)` */
export const mempty_AppearanceDef: AppearanceDef<any, any> =
  AppearanceDef<any, any>(Nothing, mempty_EntityShowFields, () => Nothing);

/**
 * The data family instance `ViewContext (Element t v)`.
 *
 * (Haskell exports `ViewContext (GenericContext, diagramId)`.)
 */
export interface GenericContext<T, V> {
  readonly diagramId: DiagramId;
  /**
   * The cumulative appearance from all the "DiagramAppearance" entries for this
   * diagram type starting with the one in this diagram and working up through the
   * package hierarchy.
   */
  readonly _diagramAppearanceDef: AppearanceDef<V, Element<T, V>>;
}
export function GenericContext<T, V>(
  diagramId: DiagramId,
  _diagramAppearanceDef: AppearanceDef<V, Element<T, V>>,
): GenericContext<T, V> {
  return { diagramId, _diagramAppearanceDef };
}

/**
 * The cumulative appearance from all the "DiagramAppearance" entries for this
 * diagram type starting with the one in this diagram and working up through the
 * package hierarchy.
 */
export function diagramAppearanceDef<T = any, V = any>(): Lens<GenericContext<T, V>, AppearanceDef<V, Element<T, V>>> {
  return lens(
    (s: GenericContext<T, V>) => s._diagramAppearanceDef,
    (s, a: AppearanceDef<V, Element<T, V>>) => ({ ...s, _diagramAppearanceDef: a }),
  );
}

/**
 * The cascade of diagram appearance values from this diagram and its parent packages is
 * evaluated.
 *
 * Errors and warnings from the queries are ignored.
 *
 * (A `ModelEdit v w (ViewContext d)` with `d ~ Element t v`; the `Avatar (Paint d) v w d`
 * instance is `Avatar_Element(cls)`.)
 */
export function compileAppearance<T, V, W>(
  cls: GenericDiagramClass<T, V>,
  ctx: ModelEditCtx<V, W>,
  /** The local appearance data. */
  appear1: DiagramAppearance<T, V>,
  /** A base context to modify. */
  vctx: GenericContext<T, V>,
): GenericContext<T, V> {
  // compilePair :: (Avatar (Paint d) v w d, EntityClass v, Queryable v) =>
  //    Model v -> DiagramId -> (QueryId, Colour) -> d -> Maybe Colour
  const compilePair = (model: Model<V>, [queryId, colour]: readonly [ModelId, Colour]): ((e: Element<T, V>) => Maybe<Colour>) => {
    const qd = preview(ix<ModelId, Entity<V>>(queryId).dot(entityContents<V>()).dot(cls._QueryDiagram).dot(queryDiagram<V>()),
      model.modelContents);
    if (qd.tag === "Nothing") return () => Nothing; // Query not found. Ignore it.
    const query = compileQueryDiagram(cls, model, qd.value);
    if (query.tag === "Left") return () => Nothing; // Query has errors. Ignore it.
    // Ignore warnings. (The query runs on first use, as the lazy Haskell value does.)
    let colourSet: S.Set<ModelId> | null = null;
    const getColourSet = (): S.Set<ModelId> =>
      (colourSet ??= runQuery(query.value, [], model, S.singleton(vctx.diagramId))[0]);
    return (e) => { // Maybe monad
      const ent = Avatar_Element(cls).ascendedId(e);
      if (ent.tag === "Nothing") return Nothing;
      if (!S.member(ent.value, getColourSet())) return Nothing;
      return Just(colour);
    };
  };
  goToRoot(ctx);
  const rootAppearance = maybe(mempty_DiagramAppearance as DiagramAppearance<T, V>,
    (pm: any) => cls.getDiagramAppearance(pm), getMeta(ctx));
  goToEntity(ctx, vctx.diagramId);
  const cascade = mconcat_DiagramAppearance<T, V>(mapMaybe(
    (e: Entity<V>) => preview(
      entityContents<V>().dot(cls._Package).dot(packageMeta()).dot(to((pm: any) => cls.getDiagramAppearance(pm))),
      e,
    ),
    currentPath(ctx),
  ));
  const model = getModel(ctx);
  const appear2 = append_DiagramAppearance(appear1, append_DiagramAppearance(cascade, rootAppearance));
  // funcs :: [d -> Maybe Colour]
  const funcs = view(highlights<T, V>(), appear2).map((pr) => compilePair(model, pr));
  const result = AppearanceDef<V, Element<T, V>>(
    view(arrowLabels<T, V>(), appear2),
    view(entityShowFields<T, V>(), appear2),
    (e) => { // foldr ((<|>) . ($ e)) Nothing funcs: the first highlight that applies.
      for (const f of funcs) {
        const c = f(e);
        if (c.tag === "Just") return c;
      }
      return Nothing;
    },
  );
  return set(diagramAppearanceDef<T, V>(), result, vctx);
}

// ---------------------------------------------------------------------------------------------
// * Boxes and Arrows

/**
 * A box on the diagram. In Haskell the shape type is existential:
 * `forall s . (ToJSON (BoxType t), FromJSON (BoxType t), BoxShapeClass s) => Box {...}`.
 */
export interface Box<T, V> {
  /** TypeScript: the `BoxShapeClass s` dictionary packed by the existential. */
  readonly boxShapeClass: BoxShapeClass<any>;
  /** The ID of this box on the diagram. */
  readonly boxId: DiagramId;
  /** The ID of the model entity that this box represents. */
  readonly boxEntity: ModelId;
  /** The variant of the box. */
  readonly boxType: BoxType<T>;
  /** If the box is pegged to an arrow line. */
  readonly _boxPeg: Maybe<Peg>;
  /**
   * The position and size of the box.  The name is required
   * by Haskell syntax but it can never be used due to leaking
   * existential type.
   */
  readonly boxShape: any;
  /** Phantom: the model type. */
  readonly __v?: V;
}

/** The `[EqSym]` method shared by all `Box` values (the hand-written `Eq` instance). */
function boxEq(this: Box<any, any>, other: unknown): boolean {
  return typeof other === "object" && other !== null && "boxShapeClass" in other && "boxId" in other &&
    eq_Box(this, other as Box<any, any>);
}

/**
 * The `Box` constructor. The first argument is the `BoxShapeClass` dictionary of the shape (the
 * existential); the rest are the Haskell fields.
 */
export function Box<T, V, S>(
  boxShapeClass: BoxShapeClass<S>,
  boxId: DiagramId,
  boxEntity: ModelId,
  boxType: BoxType<T>,
  _boxPeg: Maybe<Peg>,
  boxShape: S,
): Box<T, V> {
  return Object.assign({ boxShapeClass, boxId, boxEntity, boxType, _boxPeg, boxShape }, { [EqSym]: boxEq });
}

/** `instance (Eq (BoxType t)) => Eq (Box t v)` */
export function eq_Box<T, V>(b1: Box<T, V>, b2: Box<T, V>): boolean {
  return [
    b1.boxId === b2.boxId,
    b1.boxEntity === b2.boxEntity,
    equals(b1.boxType, b2.boxType),
    equals(b1._boxPeg, b2._boxPeg),
    equals(view(b1.boxShapeClass.shapeDefinition, b1.boxShape), view(b2.boxShapeClass.shapeDefinition, b2.boxShape)),
    // We are comparing reals here, but the use-case is about comparing a new value with
    // an old to detect edits, so this is OK.
  ].every((x) => x);
}

/** `instance HasId (Box t v)` */
export const HasId_Box: HasId<Box<any, any>> = { identifier: (b) => b.boxId };

/** `instance (DiagramTypeClass t v) => ToJSON (Box t v)` and `FromJSON (Box t v)` */
export function JSON_Box<T, V>(cls: DiagramTypeClass<T, V>): J.JSONCodec<Box<T, V>> {
  const pegJ = J.maybeJ(J.tuple2J(J.uuidJ, J.doubleJ));
  return J.codec(
    (b) => J.object([
      ["boxId", J.uuidJ.toJSON(b.boxId)],
      ["entity", J.uuidJ.toJSON(b.boxEntity)],
      ["type", cls.boxTypeJ.toJSON(b.boxType)],
      ["peg", pegJ.toJSON(b._boxPeg as Maybe<[DiagramId, number]>)],
      ["shape", b.boxShapeClass.toJSON(b.boxShape)],
    ]),
    (val) => J.withObject("GSN diagram box", (v) => cls.mkBox(
      J.field(v, "boxId", J.uuidJ),
      J.field(v, "entity", J.uuidJ),
      J.field(v, "type", cls.boxTypeJ),
      J.fieldMaybe(v, "peg", J.tuple2J(J.uuidJ, J.doubleJ)),
      J.field(v, "shape", JSON_BoundBox), // Every box shape is read as its defining box.
    ), val),
  );
}

export function boxPeg<T = any, V = any>(): Lens<Box<T, V>, Maybe<Peg>> {
  return lens((b: Box<T, V>) => b._boxPeg, (s, p: Maybe<Peg>) => ({ ...s, _boxPeg: p }));
}

/** Size handles for the box. */
function* genericBoxHandles<T, V>(
  _cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  b: Box<T, V>,
): Delta<Element<T, V>, View<Element<T, V>>[]> {
  const { boxShapeClass: sc, boxId: diagId, boxEntity: modelId, boxType: typ, _boxPeg: peg, boxShape: s } = b;
  const r: View<Element<T, V>>[] = [];
  for (const [p, shapeF] of sc.shapeHandles(s)) {
    r.push(yield* simpleHandle(d, "Resize ", mempty_Menu<Action<Element<T, V>>>(), squareHandle,
      [p, (pt: Point) => ElemBox(Box<T, V, any>(sc, diagId, modelId, typ, peg, shapeF(pt)))]));
  }
  return r;
}

/**
 * View of a box, which is an avatar of model elmenents of type @w@, which is in turn a sub-type
 * of @v@.
 */
export function* boxView<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  boxItem: Box<T, V>,
): Delta<Element<T, V>, View<Element<T, V>>> {
  const shape = boxItem.boxShape;
  const sc = boxItem.boxShapeClass;
  const asc = yield* ascend<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d, ElemBox(boxItem));
  if (asc.tag === "Nothing") { // Entity must have been deleted, so this avatar is too.
    yield* deleteItem(d, HasId_Box.identifier(boxItem));
    return mempty_View<Element<T, V>>();
  }
  const ent = asc.value;
  const scale = use(d, deltaZoom<Element<T, V>>());
  const appDef = view(diagramAppearanceDef<T, V>(), use(d, deltaContext<Element<T, V>>()) as GenericContext<T, V>);
  const border = appDef.appDefBorderColour;
  const contentDef = appDef.appDefEntityShowFields;
  const b = base(d);
  goToEntity(b, ent.entityId);
  const contents = diagramLayout(b, contentDef);
  const drawFunc = yield* cls.boxTypeDraw(d, boxItem, contents, border(ElemBox(boxItem)));
  return {
    viewDraw: drawFunc(view(sc.shapeDefinition, shape)),
    viewTouched: (p) => sc.shapeTouched(shape, scale, p),
    viewBox: sc.shapeBounds(shape),
    viewMenu: avatarShapeMenu<HadesRender, V, ModelSubtype<T>, Element<T, V>>(cls, HasId_Box.identifier(boxItem)),
    viewAction: (d1, act) => handleDelegatedAction(
      d1,
      ElemBox(boxItem),
      (d2) => avatarProperties<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d2, ElemBox(boxItem)),
      (d2) => yieldViews(d2),
      act,
    ),
  };
}

/**
 * Avatars that are represented as arrows on a diagram. The avatar implements connection
 * semantics in the underlying model when an arrow is connected to a box.
 *
 * Currently there is only one type of line shape, so the type hackery used for "Box" is not
 * necessary. If different types of lines are ever introduced then this will need to be revisited.
 */
export interface Arrow<T, V> {
  readonly arrowId: DiagramId;
  readonly arrowEntity: ModelId;
  readonly arrowType: ArrowType<T>;
  readonly _arrowShape: LineShape;
  /** Phantom: the model type. */
  readonly __v?: V;
}
export function Arrow<T, V>(
  arrowId: DiagramId,
  arrowEntity: ModelId,
  arrowType: ArrowType<T>,
  _arrowShape: LineShape,
): Arrow<T, V> {
  return { arrowId, arrowEntity, arrowType, _arrowShape };
}

/**
 * `instance (Eq (ArrowType t)) => Eq (Arrow t v)`. The hand-written instance compares every
 * field, so it is the same as the structural `equals`.
 */
export function eq_Arrow<T, V>(a1: Arrow<T, V>, a2: Arrow<T, V>): boolean {
  return [
    a1.arrowId === a2.arrowId,
    a1.arrowEntity === a2.arrowEntity,
    equals(a1.arrowType, a2.arrowType),
    equals(a1._arrowShape, a2._arrowShape),
  ].every((x) => x);
}

/** `instance HasId (Arrow t v)` */
export const HasId_Arrow: HasId<Arrow<any, any>> = { identifier: (a) => a.arrowId };

/** `instance (DiagramTypeClass t v) => ToJSON (Arrow t v)` and `FromJSON (Arrow t v)` */
export function JSON_Arrow<T, V>(cls: DiagramTypeClass<T, V>): J.JSONCodec<Arrow<T, V>> {
  return J.codec(
    (a) => J.object([
      ["arrowId", J.uuidJ.toJSON(a.arrowId)],
      ["entity", J.uuidJ.toJSON(a.arrowEntity)],
      ["type", cls.arrowTypeJ.toJSON(a.arrowType)],
      ["shape", ShapeClass_LineShape.toJSON(view(arrowShape<T, V>(), a))],
    ]),
    (val) => J.withObject("GSN diagram arrow", (v) => Arrow<T, V>(
      J.field(v, "arrowId", J.uuidJ),
      J.field(v, "entity", J.uuidJ),
      J.field(v, "type", cls.arrowTypeJ),
      J.field(v, "shape", ShapeClass_LineShape),
    ), val),
  );
}

export function arrowShape<T = any, V = any>(): Lens<Arrow<T, V>, LineShape> {
  return lens((a: Arrow<T, V>) => a._arrowShape, (v, s: LineShape) => ({ ...v, _arrowShape: s }));
}

function* genericArrowHandles<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  arrow: Arrow<T, V>,
): Delta<Element<T, V>, View<Element<T, V>>[]> {
  const promoteShape = (s: LineShape): Element<T, V> => ElemArrow(set(arrowShape<T, V>(), s, arrow));
  const updateAssociations = function* (d1: DeltaCtx<Element<T, V>>, e: Element<T, V>): Delta<Element<T, V>, void> {
    if (e.tag === "ElemArrow") {
      yield* updateArrowAssociations(cls, d1, Just(arrow), e._0);
    } else {
      cannotHappen("genericArrowHandles: updating something that is not an arrow.", null);
    }
  };
  return yield* lineHandles(d, view(arrowShape<T, V>(), arrow), squareHandle, promoteShape, updateAssociations);
}

/** Update the model Edge for which this arrow is an avatar with the new endpoints. */
function* updateArrowAssociations<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  /** Previous state of this arrow. @Nothing@ for a newly created arrow. */
  oldArrow: Maybe<Arrow<T, V>>,
  /** The arrow that has just been modified. */
  newArrow: Arrow<T, V>,
): Delta<Element<T, V>, void> {
  const endMoved = (oldEnd: Maybe<ConnectorEnd>, newEnd: ConnectorEnd): boolean =>
    oldEnd.tag === "Nothing" ? true : !equals(oldEnd.value, newEnd);
  const ascendedTarget = function* (c: ConnectorEnd): Delta<Element<T, V>, [ModelId, ModelId]> {
    if (c.tag === "Unconnected") return [U.nil, U.nil];
    const { connectorTarget: targetId, connectorTargetChild: child } = c;
    const r = yield* withItem(d, targetId, function* (d1: DeltaCtx<Element<T, V>>, v: Element<T, V>): Delta<Element<T, V>, ModelId> {
      return fromMaybe(U.nil, avatar<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d1).ascendedId(v));
    });
    if (r.tag === "Nothing") return [U.nil, U.nil];
    const t = r.value;
    return child.tag === "Just" ? [child.value, t] : [t, U.nil];
  };
  const edge = newArrow.arrowEntity;
  const oldEnds: Maybe<Terminators> = preview(_Just<Arrow<T, V>>().dot(arrowShape<T, V>()).dot(lineEnds), oldArrow);
  const [newFrom, newTo] = view(arrowShape<T, V>().dot(lineEnds), newArrow);
  const [newEdgeFrom, newEdgeFromExport] = yield* ascendedTarget(newFrom);
  const [newEdgeTo, newEdgeToExport] = yield* ascendedTarget(newTo);
  const b = base(d);
  const typ = newArrow.arrowType;
  if (endMoved(bindMaybe(oldEnds, (e) => Just(e[0])), newFrom)) {
    updateManyToOne(b, cls.arrowTailRelation(typ), edge, newEdgeFrom);
    const er = cls.arrowTailExportRelation(typ);
    if (er.tag === "Just") updateManyToOne(b, er.value, edge, newEdgeFromExport);
  }
  if (endMoved(bindMaybe(oldEnds, (e) => Just(e[1])), newTo)) {
    updateManyToOne(b, cls.arrowHeadRelation(typ), edge, newEdgeTo);
    const er = cls.arrowHeadExportRelation(typ);
    if (er.tag === "Just") updateManyToOne(b, er.value, edge, newEdgeToExport);
  }
}

/**
 * The entities linked by an edge. Returns two pairs for the tail and head respectively. Each
 * pair contains the entity the arrow should point to on the diagram and optionally a child
 * entity within the first. If the arrow is not linked at one end then it returns @Nothing@
 * for that end.
 *
 * (A `ModelEdit v (ModelSubtype t)`.)
 */
export function edgeLinks<T, V>(
  cls: DiagramTypeClass<T, V>,
  ctx: ModelEditCtx<V, ModelSubtype<T>>,
  /** The type of the arrow. */
  typ: ArrowType<T>,
  /** The model ID of the edge entity linking two other entities. */
  modelId: ModelId,
): [Maybe<[ModelId, Maybe<ModelId>]>, Maybe<[ModelId, Maybe<ModelId>]>] {
  const getEnd = (modelRel: Relation, diagramRel: Maybe<Relation>): Maybe<[ModelId, Maybe<ModelId>]> => {
    const t1 = listToMaybe(S.toList(queryRelations(ctx, (r) => NR.relation(modelId, modelRel, r))));
    if (t1.tag === "Nothing") return Nothing;
    const target1 = t1.value;
    if (diagramRel.tag === "Nothing") return Just([target1, Nothing]);
    const t2 = listToMaybe(S.toList(queryRelations(ctx, (r) => NR.relation(modelId, diagramRel.value, r))));
    if (t2.tag === "Just") return Just([t2.value, Just(target1)]);
    return Just([target1, Nothing]);
  };
  const fromEnd = getEnd(cls.arrowTailRelation(typ), cls.arrowTailExportRelation(typ));
  const toEnd = getEnd(cls.arrowHeadRelation(typ), cls.arrowHeadExportRelation(typ));
  return [fromEnd, toEnd];
}

export function* arrowView<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  arrow: Arrow<T, V>,
): Delta<Element<T, V>, View<Element<T, V>>> {
  const theView = (
    scale: Scale,
    prsm: Traversal<V, ModelSubtype<T>>,
    ent: Maybe<V>,
    border: (e: Element<T, V>) => Maybe<Colour>,
    label: Maybe<string>,
  ): View<Element<T, V>> => {
    const shape = view(arrowShape<T, V>(), arrow);
    const [start, end] = view(lineEnds, shape);
    const hl = border(ElemArrow(arrow));
    const highlight = (r: HadesRender<void>): HadesRender<void> => (hl.tag === "Just" ? withLineColour(hl.value, r) : r);
    const sub: Maybe<ModelSubtype<T>> = preview(_Just<V>().dot(prsm), ent);
    return {
      viewDraw: highlight((env) => {
        drawPolyLine(
          cls.arrowHeadDraw(sub, arrow.arrowType),
          cls.arrowLineDashes(arrow.arrowType),
          start.connectorPoint,
          view(lineMiddle, shape),
          end.connectorPoint,
          label,
        )(env);
        for (const deco of cls.arrowDecorations(sub, arrow.arrowType)) drawArrowDecoration(shape, deco)(env);
      }),
      viewTouched: (p) => ShapeClass_LineShape.shapeTouched(shape, scale, p),
      viewBox: growBox(12.0, ShapeClass_LineShape.shapeBounds(shape)), // Allow for arrow head.
      viewMenu: isNothing(ent)
        ? () => mempty_Menu<Action<Element<T, V>>>() // No menu while still under construction.
        : (p) => append_Menu(
          lineMenu((s: LineShape) => ElemArrow(set(arrowShape<T, V>(), s, arrow)), shape, p),
          avatarShapeMenu<HadesRender, V, ModelSubtype<T>, Element<T, V>>(cls, HasId_Arrow.identifier(arrow), p),
        ),
      viewAction: (d1, act) => handleDelegatedAction(
        d1,
        ElemArrow(arrow),
        (d2) => avatarProperties<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d2, ElemArrow(arrow)),
        (d2) => yieldViews(d2),
        act,
      ),
    };
  };
  const scale = use(d, deltaZoom<Element<T, V>>());
  const appearance = view(diagramAppearanceDef<T, V>(), use(d, deltaContext<Element<T, V>>()) as GenericContext<T, V>);
  const border = appearance.appDefBorderColour;
  const prsm = usingTraversal(base(d), (_c, p: Traversal<V, ModelSubtype<T>>) => p);
  if (U.isNil(arrow.arrowEntity)) {
    return theView(scale, prsm, Nothing, () => Nothing, Nothing);
    // Null reference used for transient arrows.
  }
  const asc = yield* ascend<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d, ElemArrow(arrow));
  if (asc.tag === "Nothing") { // Entity has been deleted, so its avatar should be as well.
    yield* deleteItem(d, HasId_Arrow.identifier(arrow));
    return mempty_View<Element<T, V>>();
  }
  const e = asc.value;
  const lbl = appearance.appDefArrowLabels;
  return theView(scale, prsm, Just(view(entityContents<V>(), e)), border,
    lbl.tag === "Just" && lbl.value ? Just(view(entityName(cls).dot(nameText), e)) : Nothing);
}

// ---------------------------------------------------------------------------------------------
// Graphics

/**
 * The type of a graphic displayed in a diagram. The string holds the data as stored
 * in a file, while the other part holds a parsed/decompressed version ready for rendering.
 *
 * Equality is checked on the first part of the variants only.
 */
export type Graphic =
  /** SVG files contain only unicode, so the JSON format is the escaped text. */
  | { readonly tag: "VectorGraphic"; readonly _0: string; readonly _1: SVG.Handle }
  /** Pixel formats contain arbitrary binary. The JSON is encoded with Base64. */
  | { readonly tag: "PixelGraphic"; readonly _0: Uint8Array; readonly _1: Gdk.Pixbuf }
  /**
   * If the graphic cannot be decoded then the raw JSON is preserved
   * for saving. The text is the error message reported by the decoder.
   */
  | { readonly tag: "ErrorGraphic"; readonly _0: J.JSONObject; readonly _1: string };

/** The `[EqSym]` method shared by all `Graphic` values. */
function graphicEq(this: Graphic, other: unknown): boolean {
  return typeof other === "object" && other !== null && "tag" in other &&
    (other.tag === "VectorGraphic" || other.tag === "PixelGraphic" || other.tag === "ErrorGraphic") &&
    eq_Graphic(this, other as Graphic);
}

function withGraphicEq(g: Graphic): Graphic {
  return Object.assign(g, { [EqSym]: graphicEq });
}

export function VectorGraphic(_0: string, _1: SVG.Handle): Graphic {
  return withGraphicEq({ tag: "VectorGraphic", _0, _1 });
}
export function PixelGraphic(_0: Uint8Array, _1: Gdk.Pixbuf): Graphic {
  return withGraphicEq({ tag: "PixelGraphic", _0, _1 });
}
export function ErrorGraphic(_0: J.JSONObject, _1: string): Graphic {
  return withGraphicEq({ tag: "ErrorGraphic", _0, _1 });
}

/**
 * Web: the message of an "ErrorGraphic" for an image that GdkPixbuf raised an exception on
 * (`badGraphic` in the Haskell "FromJSON" instance).
 */
const errorDuringDecoding = "Error during image decoding.";

/**
 * Web: the JSON object each "PixelGraphic" was read from (see "decodedGraphic").
 */
const pixelGraphicJson = new WeakMap<Graphic, J.JSONObject>();

/**
 * Web: the graphic as the Haskell decoder would have produced it. GdkPixbuf decodes a pixel
 * image while the JSON is parsed, and an image it cannot decode becomes an "ErrorGraphic" that
 * keeps the raw JSON for saving. The browser decodes asynchronously, so the parser always
 * returns a "PixelGraphic"; once its pixbuf has failed to decode, this returns the
 * "ErrorGraphic" the Haskell parser would have returned. Equality, JSON output, layout and the
 * comment dialog all look at the graphic through this.
 */
export function decodedGraphic(g: Graphic): Graphic {
  if (g.tag !== "PixelGraphic" || !g._1.failed) return g;
  const raw = pixelGraphicJson.get(g);
  return raw === undefined ? g : ErrorGraphic(raw, errorDuringDecoding);
}

/** `instance Eq Graphic` */
export function eq_Graphic(g10: Graphic, g20: Graphic): boolean {
  const g1 = decodedGraphic(g10); // Web: see "decodedGraphic".
  const g2 = decodedGraphic(g20);
  if (g1.tag === "VectorGraphic" && g2.tag === "VectorGraphic") return g1._0 === g2._0;
  if (g1.tag === "PixelGraphic" && g2.tag === "PixelGraphic") return equals(g1._0, g2._0);
  if (g1.tag === "ErrorGraphic" && g2.tag === "ErrorGraphic") return equals(g1._0, g2._0);
  return false;
}

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard Base64 with padding (`Data.ByteString.Base64.Lazy.encode`). */
export function base64Encode(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out.push(base64Alphabet[(n >> 18) & 63], base64Alphabet[(n >> 12) & 63],
      i + 1 < bytes.length ? base64Alphabet[(n >> 6) & 63] : "=",
      i + 2 < bytes.length ? base64Alphabet[n & 63] : "=");
  }
  return out.join("");
}

/**
 * `Data.ByteString.Base64.Lazy.decodeLenient`: decode Base64, never failing. As in
 * base64-bytestring, the input is read in groups of four characters, skipping characters outside
 * the alphabet; a padding character `=` is also skipped in the first two places of a group, and
 * ends the decoding in the last two. A trailing incomplete group yields what bytes it can.
 */
export function base64DecodeLenient(txt: string): Uint8Array {
  const chars = Array.from(txt);
  const out: number[] = [];
  const done = -1;
  let i = 0;
  /** The next character's value, or "done" at the end (or at a padding character, unless skipped). */
  const look = (skipPad: boolean): number => {
    while (i < chars.length) {
      const ch = chars[i++];
      if (ch === "=") {
        if (skipPad) continue;
        return done;
      }
      const n = base64Alphabet.indexOf(ch);
      if (n >= 0) return n;
    }
    return done;
  };
  while (i < chars.length) {
    const aa = look(true);
    const bb = look(true);
    if (aa === done || bb === done) break;
    const cc = look(false);
    out.push(((aa << 2) | (bb >> 4)) & 0xff);
    if (cc === done) break;
    const dd = look(false);
    out.push(((bb << 4) | (cc >> 2)) & 0xff);
    if (dd === done) break;
    out.push(((cc << 6) | dd) & 0xff);
  }
  return Uint8Array.from(out);
}

/** `instance ToJSON Graphic` and `instance FromJSON Graphic` */
export const JSON_Graphic: J.JSONCodec<Graphic> = (() => {
  // Catching all exceptions here because anything except a user interupt
  // indicates an unreadable file.
  const badGraphic = (v: J.JSONObject, _e: unknown): Graphic => ErrorGraphic(v, errorDuringDecoding);
  const parseVector = (v: J.JSONObject): Graphic => {
    const txt = J.field(v, "svg", J.textJ);
    try {
      const stream = Gio.memoryInputStreamNewFromData(U.encodeUtf8(txt), null);
      const mPic = SVG.handleNewFromStreamSync(
        stream,
        null, // Pic is internal, so no base file.
        [SVG.HandleFlagsFlagKeepImageData],
        null, // Decoding is non-cancellable.
      );
      return mPic !== null ? VectorGraphic(txt, mPic) : ErrorGraphic(v, "Cannot decode SVG file.");
    } catch (e) {
      return badGraphic(v, e);
    }
  };
  const parsePixel = (v: J.JSONObject): Graphic => {
    const dat = base64DecodeLenient(J.field(v, "image", J.textJ));
    try {
      const stream = Gio.memoryInputStreamNewFromData(dat, null);
      // Web: decoding is asynchronous, so a pixbuf is always returned. If the browser cannot
      // decode it, the graphic acts as the ErrorGraphic of `v` (see "decodedGraphic").
      const pix = Gdk.pixbufNewFromStream(stream, null);
      const g = PixelGraphic(dat, pix);
      pixelGraphicJson.set(g, v);
      return g;
    } catch (e) {
      return badGraphic(v, e);
    }
  };
  // unsafePerformIO is safe here because the contents will not change over the life of
  // the Graphic, so it doesn't matter if conversion is done now or some future time.
  return J.codec<Graphic>(
    (g0) => {
      const g = decodedGraphic(g0); // Web: see "decodedGraphic".
      switch (g.tag) {
        case "VectorGraphic": return J.object([["svg", g._0]]);
        case "PixelGraphic": return J.object([["image", base64Encode(g._0)]]);
        case "ErrorGraphic": return g._0;
        default: return absurd(g);
      }
    },
    (val) => J.withObject("graphic", (v) => J.alt<Graphic>(() => parseVector(v), () => parsePixel(v))(val), val),
  );
})();

/** Put a graphic in a text layout. */
export function layoutGraphic(g0: Graphic): HadesLayout<void> {
  const errorLayout = (msg: string): HadesLayout<void> => (env, st) => {
    layoutHLine(env, st);
    layoutParagraphs([], msg)(env, st);
    layoutHLine(env, st);
  };
  const g = decodedGraphic(g0); // Web: see "decodedGraphic".
  switch (g.tag) {
    case "VectorGraphic": return layoutSvg(Just(mkColour(C.white)), g._1);
    case "PixelGraphic": {
      const pix = g._1;
      // Web: the pixbuf decodes asynchronously. Until it has loaded it takes no space (the
      // canvas repaints on Gdk.onImagesLoaded). One that cannot be decoded and was not read
      // from JSON (so "decodedGraphic" has no raw JSON for it) is still shown as an
      // ErrorGraphic with the message GdkPixbuf's GError gets from "badGraphic".
      if (pix.failed) return errorLayout(errorDuringDecoding);
      if (!pix.loaded || Gdk.pixbufGetWidth(pix) <= 0 || Gdk.pixbufGetHeight(pix) <= 0) return () => {};
      return layoutPixbuf(true, Just(mkColour(C.white)), pix);
    }
    case "ErrorGraphic": return errorLayout(g._1);
    default: return absurd(g);
  }
}

// ---------------------------------------------------------------------------------------------
// Comments

export interface Comment {
  readonly commentId: DiagramId;
  readonly _commentShape: CommentBox;
  readonly _commentGraphic: Maybe<Graphic>;
  readonly _commentText: string;
}
export function Comment(
  commentId: DiagramId,
  _commentShape: CommentBox,
  _commentGraphic: Maybe<Graphic>,
  _commentText: string,
): Comment {
  return { commentId, _commentShape, _commentGraphic, _commentText };
}

/** `instance HasId Comment` */
export const HasId_Comment: HasId<Comment> = { identifier: (c) => c.commentId };

/** `instance Default Comment` */
export const def_Comment: Comment = Comment(U.nil, CommentBox(NoBox), Nothing, "");

/** `instance ToJSON Comment` and `instance FromJSON Comment` */
export const JSON_Comment: J.JSONCodec<Comment> = J.codec(
  (c) => J.object([
    ["commentId", J.uuidJ.toJSON(c.commentId)],
    ["shape", ShapeClass_CommentBox.toJSON(view(commentShape, c))],
    ["graphic", J.maybeJ(JSON_Graphic).toJSON(view(commentGraphic, c))],
    ["text", view(commentText, c)],
  ]),
  (val) => J.withObject("GSN diagram comment", (v) => Comment(
    J.field(v, "commentId", J.uuidJ),
    J.field(v, "shape", ShapeClass_CommentBox),
    J.fieldMaybe(v, "graphic", JSON_Graphic),
    J.field(v, "text", J.textJ),
  ), val),
);

export const commentShape: Lens<Comment, CommentBox> =
  lens((c: Comment) => c._commentShape, (c, s: CommentBox) => ({ ...c, _commentShape: s }));

export const commentText: Lens<Comment, string> =
  lens((c: Comment) => c._commentText, (c, t: string) => ({ ...c, _commentText: t }));

export const commentGraphic: Lens<Comment, Maybe<Graphic>> =
  lens((c: Comment) => c._commentGraphic, (c, g: Maybe<Graphic>) => ({ ...c, _commentGraphic: g }));

function* commentHandles<T, V>(
  _cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  c: Comment,
): Delta<Element<T, V>, View<Element<T, V>>[]> {
  const handles = boxHandles(commentShape.dot(commentBoxShape), c);
  const r: View<Element<T, V>>[] = [];
  for (const [p, shapeF] of handles) {
    r.push(yield* simpleHandle(d, "Resize ", mempty_Menu<Action<Element<T, V>>>(), squareHandle,
      [p, (pt: Point) => ElemComment<T, V>(shapeF(pt))]));
  }
  return r;
}

function* commentView<T, V>(
  _cls: GenericDiagramClass<T, V>,
  _d: DeltaCtx<Element<T, V>>,
  c: Comment,
): Delta<Element<T, V>, View<Element<T, V>>> {
  const uuid = HasId_Comment.identifier(c);
  const shape = view(commentShape, c);
  return {
    viewDraw: (env: HadesEnv) => {
      drawCommentBox(shape)(env);
      runLayout_(BoxShapeClass_CommentBox.shapeInnerBox(shape), (env1, st) => {
        const g = view(commentGraphic, c);
        if (g.tag === "Just") layoutGraphic(g.value)(env1, st);
        layoutParagraphs([], view(commentText, c))(env1, st);
      })(env);
    },
    viewTouched: (p) => insidePolygon(commentBoxCorners(shape), p),
    viewBox: ShapeClass_CommentBox.shapeBounds(shape),
    viewMenu: (p) => append_Menu(
      Menu<Action<Element<T, V>>>([[
        MenuItem("Properties", Right(mkScriptAction<Element<T, V>>(function* (d1) {
          const item = use(d1, deltaDiagram<Element<T, V>>().dot(diagramContents<Element<T, V>>()).dot(at(uuid)));
          if (item.tag === "Nothing") return yield* yieldViews(d1);
          return yield* avatarProperties<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d1, item.value);
        }))),
      ]]),
      basicShapeMenu<Element<T, V>>(uuid, p),
    ),
    viewAction: (d1, act) => handleDelegatedAction(
      d1,
      ElemComment<T, V>(c),
      (d2) => yieldProperties(d2, ElemComment<T, V>(c)),
      (d2) => yieldViews(d2),
      act,
    ),
  };
}

/** Gadget for editing comments. */
export function commentGadget<E = any, W = any>(): Gadget_<E, W, Comment> {
  const l: Lens<Comment, [Maybe<Graphic>, string]> = lens(
    (c: Comment): [Maybe<Graphic>, string] => [view(commentGraphic, c), view(commentText, c)],
    (c, [g, t]: [Maybe<Graphic>, string]) => set(commentGraphic, g, set(commentText, t, c)),
  );
  return accum(focusing(l, commentGadget1<E, W>()));
}

/** Haskell `noWidget :: Maybe Gtk.Widget`. */
const noWidget: Gtk.Widget | null = null;

async function badGraphic(e: unknown): Promise<Maybe<Graphic>> {
  await errorBox(noWidget, "Image file could not be decoded.\n\nTechnical details: " + String(e));
  return Nothing;
}

/**
 * Ask the user for an image file and load it. (The `importImageFile` action of
 * "commentGadget1".)
 *
 * Web: asynchronous. A pixel image is decoded by the browser before the result is returned,
 * so an undecodable file is reported here as GdkPixbuf's exception would be.
 */
export async function importImageFile(): Promise<Maybe<Graphic>> {
  const imageFilter = Gtk.fileFilterNew();
  Gtk.fileFilterSetName(imageFilter, "Image files");
  Gtk.fileFilterAddPixbufFormats(imageFilter);
  const r = await openUserFile(noWidget, [imageFilter], Nothing);
  if (r.tag === "Nothing") return Nothing;
  const [fname, bytes] = r.value;
  const bytes2 = bytes;
  if (takeExtension(fname).toLowerCase() === ".svg") {
    // Vector SVG file.
    try {
      const t = tryDecodeXml(bytes2);
      if (t.tag === "Left") {
        await errorBox(noWidget, "SVG file contents could not be decoded.\n\nTechnical details: " + t.value);
        return Nothing;
      }
      const txt = t.value;
      const stream = Gio.memoryInputStreamNewFromData(bytes2, null);
      const svg = SVG.handleNewFromStreamSync(
        stream,
        null, // Pic is internal, so no base file.
        [SVG.HandleFlagsFlagKeepImageData],
        null, // Decoding is non-cancellable.
      );
      return svg === null ? Nothing : Just(VectorGraphic(txt, svg));
    } catch (e) {
      return badGraphic(e);
    }
  }
  // Pixmap binary file.
  try {
    const stream = Gio.memoryInputStreamNewFromData(bytes2, null);
    const pix = await Gdk.pixbufReady(Gdk.pixbufNewFromStream(stream, null));
    if (pix.failed) throw new Error("Unrecognized image file format");
    return Just(PixelGraphic(bytes2, pix));
  } catch (e) {
    return badGraphic(e);
  }
}

/**
 * Gadget for editing comment data that only looks at the editable fields.
 *
 * ```haskell
 * commentGadget1 = proc (oldImage, oldText) -> do
 *     newImage <- simpleFrame "Image" (proc oldImage -> do
 *         newImage <- buttonIO "Import Image" (const $ const importImageFile) -< ()
 *         let img = join newImage <|> oldImage
 *         _ <- imageDisplay MemoLarge -< case img of
 *               Just (VectorGraphic txt _) -> Just $ T.encodeUtf8 txt
 *               Just (PixelGraphic bs _) -> Just bs
 *               _ -> Nothing
 *         returnA -< img
 *       ) -< oldImage
 *     newText <- memoBox MemoMedium True -< oldText
 *     returnA -< (newImage, newText)
 * ```
 */
export function commentGadget1<E = any, W = any>(): Gadget_<E, W, [Maybe<Graphic>, string]> {
  type MG = Maybe<Graphic>;
  const imageBytes = (img: MG): Maybe<Uint8Array> => {
    if (img.tag === "Nothing") return Nothing;
    const g = decodedGraphic(img.value); // Web: see "decodedGraphic".
    switch (g.tag) {
      case "VectorGraphic": return Just(U.encodeUtf8(g._0));
      case "PixelGraphic": return Just(g._0);
      default: return Nothing;
    }
  };
  const inner = gPipe(
    // newImage <- buttonIO "Import Image" (const $ const importImageFile) -< ()  (oldImage kept)
    gFanout(
      gPipe(arr<E, W, MG, null>(() => null), buttonIO<E, W, null, MG>("Import Image", () => importImageFile())),
      gId<E, W, MG>(),
    ),
    // let img = join newImage <|> oldImage
    arr<E, W, [Maybe<MG>, MG], MG>(([newImage, oldImage]) =>
      orElse(newImage.tag === "Just" ? newImage.value : Nothing, oldImage)),
    // _ <- imageDisplay MemoLarge -< ...
    gFanout(gPipe(arr<E, W, MG, Maybe<Uint8Array>>(imageBytes), imageDisplay<E, W>("MemoLarge")), gId<E, W, MG>()),
    // returnA -< img
    arr<E, W, [Maybe<Uint8Array>, MG], MG>(([, img]) => img),
  );
  return gProd(simpleFrame("Image", inner), memoBox<E, W>("MemoMedium", true));
}

// ---------------------------------------------------------------------------------------------
// Links

/**
 * A link from this diagram to another. The properties of a link will show the details below.
 * Activating the link will activate the target entity.
 */
export interface Link {
  readonly linkId: DiagramId;
  readonly _linkTarget: Maybe<ModelId>;
  readonly _linkShape: CommentBox;
  readonly _linkText: string;
}
export function Link(linkId: DiagramId, _linkTarget: Maybe<ModelId>, _linkShape: CommentBox, _linkText: string): Link {
  return { linkId, _linkTarget, _linkShape, _linkText };
}

/** `instance HasId Link` */
export const HasId_Link: HasId<Link> = { identifier: (l) => l.linkId };

/** `instance Default Link` */
export const def_Link: Link = Link(U.nil, Nothing, CommentBox(NoBox), "");

/** `instance Show Link` */
export function show_Link(l: Link): string {
  const target = l._linkTarget.tag === "Just" ? "Just " + l._linkTarget.value : "Nothing";
  return "Link linkId=" + l.linkId + " _linkTarget=" + target + " _linkText=" + T.showText(l._linkText);
}

/** `instance ToJSON Link` and `instance FromJSON Link` */
export const JSON_Link: J.JSONCodec<Link> = J.codec(
  (link) => J.object([
    ["linkId", J.uuidJ.toJSON(link.linkId)],
    ["linkTarget", J.maybeJ(J.uuidJ).toJSON(view(linkTarget, link))],
    ["linkShape", ShapeClass_CommentBox.toJSON(view(linkShape, link))],
    ["linkText", view(linkText, link)],
  ]),
  (val) => J.withObject("Diagram link", (v) => Link(
    J.field(v, "linkId", J.uuidJ),
    J.field(v, "linkTarget", J.maybeJ(J.uuidJ)),
    J.field(v, "linkShape", ShapeClass_CommentBox),
    J.field(v, "linkText", J.textJ),
  ), val),
);

export const linkTarget: Lens<Link, Maybe<ModelId>> =
  lens((l: Link) => l._linkTarget, (l, i: Maybe<ModelId>) => ({ ...l, _linkTarget: i }));

export const linkShape: Lens<Link, CommentBox> =
  lens((l: Link) => l._linkShape, (l, s: CommentBox) => ({ ...l, _linkShape: s }));

export const linkText: Lens<Link, string> =
  lens((l: Link) => l._linkText, (l, t: string) => ({ ...l, _linkText: t }));

/** Can this entity have a link made to it? */
export function isLinkable<V>(
  cls: HasDiagrams<any, V> & HasLookups<V> & HasReports<V>,
  ent: Entity<V>,
): boolean {
  const c = view(entityContents<V>(), ent);
  return cls.isDiagram(c) || isJust(preview(cls._Matrix, c)) || isJust(preview(cls._LookupTable, c)) ||
    isJust(preview(cls._Report, c));
}

function* linkHandles<T, V>(
  _cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  c: Link,
): Delta<Element<T, V>, View<Element<T, V>>[]> {
  const handles = boxHandles(linkShape.dot(commentBoxShape), c);
  const r: View<Element<T, V>>[] = [];
  for (const [p, shapeF] of handles) {
    r.push(yield* simpleHandle(d, "Resize ", mempty_Menu<Action<Element<T, V>>>(), squareHandle,
      [p, (pt: Point) => ElemLink<T, V>(shapeF(pt))]));
  }
  return r;
}

function* linkView<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  link: Link,
): Delta<Element<T, V>, View<Element<T, V>>> {
  const uuid = HasId_Link.identifier(link);
  const shape = view(linkShape, link);
  const tgt = view(linkTarget, link);
  const targetName: Either<string, string> = tgt.tag === "Just"
    ? try_(base(d), (c) => {
      goToEntity(c, tgt.value);
      return currentName(c);
    })
    : Right("");
  const targetText = targetName.tag === "Left"
    ? "✘ item deleted" // Heavy ballot X, U+2718
    : "➔ " + targetName.value; // Heavy wide-headed rightwards arrow, U+2794
  return {
    viewDraw: (env: HadesEnv) => {
      drawCommentBox(shape)(env);
      textBlock(targetText, T.splitOn("\n\n", view(linkText, link)), BoxShapeClass_CommentBox.shapeInnerBox(shape))(env);
    },
    viewTouched: (p) => insidePolygon(commentBoxCorners(shape), p),
    viewBox: ShapeClass_CommentBox.shapeBounds(shape),
    viewMenu: (p) => append_Menu(
      Menu<Action<Element<T, V>>>([[
        menuItem("Properties", mkScriptAction<Element<T, V>>(function* (d1) {
          const item = use(d1, deltaDiagram<Element<T, V>>().dot(diagramContents<Element<T, V>>()).dot(at(uuid)));
          if (item.tag === "Nothing") return yield* yieldViews(d1);
          return yield* avatarProperties<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d1, item.value);
        })),
      ]]),
      basicShapeMenu<Element<T, V>>(uuid, p),
    ),
    viewAction: function* (d1, act) {
      switch (act.actionCommand.tag) {
        case "Activate": {
          const target = view(linkTarget, link);
          if (target.tag === "Just") {
            const modelId = target.value;
            const ent = withBaseType(base(d1), (c) => {
              goToEntity(c, modelId);
              return current(c);
            });
            const r = yield* withBaseScript<HadesRender, V, ModelSubtype<T>, Maybe<string>>(cls.editableActivation(ent))(base(d1));
            if (r.tag === "Just") yield* tellCheckpoint(d1, r.value);
          } else {
            throwUser(base(d1), "Link has no target set.");
          }
          return yield* yieldViews(d1);
        }
        default:
          return yield* handleDelegatedAction(
            d1,
            ElemLink<T, V>(link),
            (d2) => yieldProperties(d2, ElemLink<T, V>(link)),
            (d2) => yieldViews(d2),
            act,
          );
      }
    },
  };
}

/** The dialog for links. (A constrained `Dialog' (Model v) () Link` value.) */
export function linkDialog<V>(cls: LinkableClass<V>): Dialog_<Model<V>, null, Link> {
  const validLink = (s: S.Set<ModelId>): boolean => S.size(s) === 1;
  return Dialog("Diagram Link", OkApplyButton,
    accum(
      box<Model<V>, null, Link>("Vertical", [[
        form<Model<V>, null, Link>("Vertical", [
          ["Link Target:", focusing(linkTarget.dot(from(setMaybeIso<ModelId>())),
            validate(validLink, modelItemSpecifier<V, null>(cls, () => (e: Entity<V>) => isLinkable(cls, e), () => Nothing)))],
        ]),
        simpleFrame("Text", focusing(linkText, memoBox<Model<V>, null>("MemoMedium", true))),
      ]])));
}

// ---------------------------------------------------------------------------------------------
// Elements

/** Diagram element type. */
export type Element<T, V> =
  | { readonly tag: "ElemBox"; readonly _0: Box<T, V> }
  | { readonly tag: "ElemArrow"; readonly _0: Arrow<T, V> }
  | { readonly tag: "ElemComment"; readonly _0: Comment }
  | { readonly tag: "ElemLink"; readonly _0: Link };

export function ElemBox<T, V>(_0: Box<T, V>): Element<T, V> {
  return { tag: "ElemBox", _0 };
}
export function ElemArrow<T, V>(_0: Arrow<T, V>): Element<T, V> {
  return { tag: "ElemArrow", _0 };
}
export function ElemComment<T = any, V = any>(_0: Comment): Element<T, V> {
  return { tag: "ElemComment", _0 };
}
export function ElemLink<T = any, V = any>(_0: Link): Element<T, V> {
  return { tag: "ElemLink", _0 };
}

/**
 * `instance (Eq (BoxType t), Eq (ArrowType t)) => Eq (Element t v)`: elements are equal if they
 * have the same constructor and equal contents (the structural `equals`).
 */
export function eq_Element<T, V>(e1: Element<T, V>, e2: Element<T, V>): boolean {
  return equals(e1, e2);
}

/** `instance HasId (Element t v)` */
export const HasId_Element: HasId<Element<any, any>> = {
  identifier: (e) => {
    switch (e.tag) {
      case "ElemBox": return HasId_Box.identifier(e._0);
      case "ElemArrow": return HasId_Arrow.identifier(e._0);
      case "ElemComment": return HasId_Comment.identifier(e._0);
      case "ElemLink": return HasId_Link.identifier(e._0);
      default: return absurd(e);
    }
  },
};

/** `instance (DiagramTypeClass t v) => ToJSON (Element t v)` and `FromJSON (Element t v)` */
export function JSON_Element<T, V>(cls: DiagramTypeClass<T, V>): J.JSONCodec<Element<T, V>> {
  const boxJ = JSON_Box(cls);
  const arrowJ = JSON_Arrow(cls);
  return J.codec(
    (e) => {
      switch (e.tag) {
        case "ElemBox": return boxJ.toJSON(e._0);
        case "ElemArrow": return arrowJ.toJSON(e._0);
        case "ElemComment": return JSON_Comment.toJSON(e._0);
        case "ElemLink": return JSON_Link.toJSON(e._0);
        default: return absurd(e);
      }
    },
    J.alt<Element<T, V>>(
      (v) => ElemBox(boxJ.parseJSON(v)),
      (v) => ElemArrow(arrowJ.parseJSON(v)),
      (v) => ElemComment(JSON_Comment.parseJSON(v)),
      (v) => ElemLink(JSON_Link.parseJSON(v)),
    ),
  );
}

/**
 * The dictionary of the `Viewable`, `Connectable` and `Avatar HadesRender v (ModelSubtype t)`
 * instances for `Element t v`, with `DiagramMetadata (Element t v) = DiagramAppearance t v`.
 */
export type ElementClass<T, V> =
  Avatar<HadesRender, V, ModelSubtype<T>, Element<T, V>, DiagramAppearance<T, V>> &
  DiagramMetadataClass<DiagramAppearance<T, V>>;

/** Cache of the instance dictionaries, one per `GenericDiagramClass` dictionary. */
const elementClasses = new WeakMap<object, ElementClass<any, any>>();

/**
 * `instance (...) => Avatar HadesRender v (ModelSubtype t) (Element t v)`,
 * `instance (...) => Viewable (Element t v)` and `instance (...) => Connectable (Element t v)`.
 *
 * TypeScript: one dictionary for all three classes; repeated calls with the same `cls` return the
 * same object.
 */
export function Avatar_Element<T, V>(cls: GenericDiagramClass<T, V>): ElementClass<T, V> {
  const cached = elementClasses.get(cls);
  if (cached !== undefined) return cached as ElementClass<T, V>;
  type El = Element<T, V>;
  type DC = DeltaCtx<El>;
  const resizeBox = (wh: readonly [number, number], b: Box<T, V>): Box<T, V> =>
    Box<T, V, any>(b.boxShapeClass, b.boxId, b.boxEntity, b.boxType, b._boxPeg, b.boxShapeClass.shapeResize(wh, b.boxShape));
  const dict: ElementClass<T, V> = {
    // Viewable
    identifier: HasId_Element.identifier,
    *itemHandles(d: DC, v: El) {
      switch (v.tag) {
        case "ElemBox": return yield* genericBoxHandles(cls, d, v._0);
        case "ElemArrow": return yield* genericArrowHandles(cls, d, v._0);
        case "ElemComment": return yield* commentHandles(cls, d, v._0);
        case "ElemLink": return yield* linkHandles(cls, d, v._0);
        default: return absurd(v);
      }
    },
    itemTouched: (v, s, p) => {
      switch (v.tag) {
        case "ElemBox": return v._0.boxShapeClass.shapeTouched(v._0.boxShape, s, p);
        case "ElemArrow": return ShapeClass_LineShape.shapeTouched(view(arrowShape<T, V>(), v._0), s, p);
        case "ElemComment": return ShapeClass_CommentBox.shapeTouched(view(commentShape, v._0), s, p);
        case "ElemLink": return ShapeClass_CommentBox.shapeTouched(view(linkShape, v._0), s, p);
        default: return absurd(v);
      }
    },
    itemBounds: (v) => {
      switch (v.tag) {
        case "ElemBox": return v._0.boxShapeClass.shapeBounds(v._0.boxShape);
        case "ElemArrow": return ShapeClass_LineShape.shapeBounds(view(arrowShape<T, V>(), v._0));
        case "ElemComment": return ShapeClass_CommentBox.shapeBounds(view(commentShape, v._0));
        case "ElemLink": return ShapeClass_CommentBox.shapeBounds(view(linkShape, v._0));
        default: return absurd(v);
      }
    },
    *itemResize(d: DC, wh, v: El) {
      switch (v.tag) {
        case "ElemBox": {
          // Full pattern match due to escaped type variables in lens usage.
          const newItem = ElemBox(resizeBox(wh, v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        case "ElemComment": {
          const newItem = ElemComment<T, V>(over(commentShape, (s: CommentBox) => BoxShapeClass_CommentBox.shapeResize(wh, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        case "ElemLink": {
          const newItem = ElemLink<T, V>(over(linkShape, (s: CommentBox) => BoxShapeClass_CommentBox.shapeResize(wh, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        default:
          return v; // Resize diagram arrow is a no-op.
      }
    },
    itemInBox: (v, b) => {
      switch (v.tag) {
        case "ElemBox": return containsBox(b, v._0.boxShapeClass.shapeBounds(v._0.boxShape));
        case "ElemArrow": return ShapeClass_LineShape.shapeInBox(view(arrowShape<T, V>(), v._0), b);
        case "ElemComment": return ShapeClass_CommentBox.shapeInBox(view(commentShape, v._0), b);
        case "ElemLink": return ShapeClass_CommentBox.shapeInBox(view(linkShape, v._0), b);
        default: return absurd(v);
      }
    },
    *itemMove(d: DC, xy, v: El) {
      if (v.tag === "ElemBox") return yield* boxMove(cls, d, xy, v._0);
      return yield* dict.itemDrag(d, xy, v);
    },
    *itemDrag(d: DC, xy, v: El) {
      switch (v.tag) {
        case "ElemBox": return yield* boxDrag(cls, d, xy, v._0);
        case "ElemArrow": {
          const newItem = ElemArrow(over(arrowShape<T, V>(), (s: LineShape) => ShapeClass_LineShape.shapeDrag(xy, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        case "ElemComment": {
          const newItem = ElemComment<T, V>(over(commentShape, (s: CommentBox) => ShapeClass_CommentBox.shapeDrag(xy, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        case "ElemLink": {
          const newItem = ElemLink<T, V>(over(linkShape, (s: CommentBox) => ShapeClass_CommentBox.shapeDrag(xy, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        default: return absurd(v);
      }
    },
    *itemView(d: DC, v: El) {
      switch (v.tag) {
        case "ElemBox": return yield* boxView(cls, d, v._0);
        case "ElemArrow": return yield* arrowView(cls, d, v._0);
        case "ElemComment": return yield* commentView(cls, d, v._0);
        case "ElemLink": return yield* linkView(cls, d, v._0);
        default: return absurd(v);
      }
    },
    *itemChildren(d: DC, v: El) {
      if (v.tag === "ElemBox") return yield* cls.boxChildren(d, v._0);
      return [];
    },
    *itemDescription(d: DC, item: El) {
      switch (item.tag) {
        case "ElemComment": return "comment";
        case "ElemLink": return "link";
        default: {
          const asc = yield* ascend<HadesRender, V, ModelSubtype<T>, El>(d, item);
          if (asc.tag === "Nothing") return throwInternal(base(d), "Diagram element is avatar of nothing.");
          return currentName(base(d));
        }
      }
    },
    itemType: () => cls.diagramTypeName(undefined as T),
    // Connectable
    *itemCanConnect(d: DC, dir, v1: El, v2: El, child) {
      if (v1.tag === "ElemArrow" && v2.tag === "ElemBox") return yield* cls.arrowCanConnect(d, dir, v1._0, v2._0, child);
      return false;
    },
    itemConnectors: _ElemArrow<T, V>().dot(arrowShape<T, V>()).dot(lineEnds)
      .dot<ConnectorEnd, ConnectorEnd>(both<ConnectorEnd>()),
    *itemConnectionPoint(d: DC, v: El, child) {
      switch (v.tag) {
        case "ElemBox": {
          const b = v._0;
          if (child.tag === "Nothing") return (p: Point) => b.boxShapeClass.shapeConnectionPoint(b.boxShape, p);
          return yield* cls.boxChildConnection(d, b, child.value);
        }
        case "ElemArrow": {
          const shape = view(arrowShape<T, V>(), v._0);
          return (p: Point) => ShapeClass_LineShape.shapeConnectionPoint(shape, p);
        }
        case "ElemComment": {
          const shape = view(commentShape, v._0);
          return (p: Point) => ShapeClass_CommentBox.shapeConnectionPoint(shape, p);
        }
        case "ElemLink": {
          const shape = view(linkShape, v._0);
          return (p: Point) => ShapeClass_CommentBox.shapeConnectionPoint(shape, p);
        }
        default: return absurd(v);
      }
    },
    *itemAdjust(d: DC, v: El) {
      switch (v.tag) {
        case "ElemArrow": {
          const arrow = v._0;
          const newShape = yield* lineUpdate(d, view(arrowShape<T, V>(), arrow));
          yield* updateItem(d, ElemArrow(set(arrowShape<T, V>(), newShape, arrow)));
          return;
        }
        case "ElemBox":
          yield* boxAdjust(cls, d, v._0);
          return;
        default:
          return;
      }
    },
    *itemPegAt(d: DC, v: El, arrId: DiagramId, f: number) {
      if (v.tag !== "ElemBox") return Nothing;
      const boxItem = v._0;
      const contents = use(d, deltaDiagram<El>().dot(diagramContents<El>()));
      const arrow = preview(ix<DiagramId, El>(arrId).dot(_ElemArrow<T, V>()), contents);
      if (arrow.tag === "Nothing") return Nothing;
      const rel = yield* cls.boxCanPeg(d, boxItem, arrow.value);
      if (rel.tag === "Nothing") return Nothing;
      const relName = rel.value;
      const b = base(d);
      modifyRelations(b, (r) => NR.insert(boxItem.boxEntity, arrow.value.arrowEntity, relName, r));
      recordModified(b, boxItem.boxEntity); // Update stamp for both sides of peg.
      recordModified(b, arrow.value.arrowEntity);
      return Just(ElemBox(setJust(boxPeg<T, V>(), [arrId, f] as Peg, boxItem)));
    },
    *itemUnpeg(d: DC, v: El) {
      if (v.tag !== "ElemBox") return v;
      const boxItem = v._0;
      const peg = view(boxPeg<T, V>(), boxItem);
      if (peg.tag === "Nothing") return ElemBox(boxItem); // No-op because box is already unpegged.
      const [arrId] = peg.value;
      const contents = use(d, deltaDiagram<El>().dot(diagramContents<El>()));
      const arrow = preview(ix<DiagramId, El>(arrId).dot(_ElemArrow<T, V>()), contents);
      if (arrow.tag === "Just") { // (Otherwise the box was pegged to something that no longer exists.)
        const rel = yield* cls.boxCanPeg(d, boxItem, arrow.value);
        if (rel.tag === "Nothing") {
          cannotHappen("Box was pegged to something illegal.", null);
        } else {
          const b = base(d);
          modifyRelations(b, (r) => NR.delete_(boxItem.boxEntity, arrow.value.arrowEntity, rel.value, r));
          recordModified(b, boxItem.boxEntity); // Update stamp for both sides of the peg.
          recordModified(b, arrow.value.arrowEntity);
        }
      }
      return ElemBox(set(boxPeg<T, V>(), Nothing, boxItem));
    },
    itemPeg: _ElemBox<T, V>().dot(boxPeg<T, V>()).dot(_Just<Peg>()),
    *itemPegPoint(d: DC, [arrId, f]: Peg) {
      const contents = use(d, deltaDiagram<El>().dot(diagramContents<El>()));
      const shape = preview(ix<DiagramId, El>(arrId).dot(_ElemArrow<T, V>()).dot(arrowShape<T, V>()), contents);
      if (shape.tag === "Nothing") return Nothing;
      return Just(lineFractionPoint(f, shape.value));
    },
    // Avatar
    *getDiagramModelId(d: DC) {
      return (use(d, deltaContext<El>()) as GenericContext<T, V>).diagramId;
    },
    updateViewContext: (ctx, meta, vc) => compileAppearance(cls, ctx, meta, vc as GenericContext<T, V>),
    *entityAvatar(d: DC, e, p) {
      return yield* genericEntityAvatar(cls, d, e, p);
    },
    ascendedId: (v) => {
      switch (v.tag) {
        case "ElemBox": return Just(v._0.boxEntity);
        case "ElemArrow": return Just(v._0.arrowEntity);
        default: return Nothing;
      }
    },
    *avatarChildren(d: DC, v: El) {
      switch (v.tag) {
        case "ElemBox": {
          const b = base(d);
          goToEntity(b, v._0.boxEntity);
          return M.elems(currentChildren(b));
        }
        case "ElemArrow": {
          const b = base(d);
          goToEntity(b, v._0.arrowEntity);
          return M.elems(currentChildren(b));
        }
        default:
          return [];
      }
    },
    *updateAvatar(d: DC, v: El) {
      switch (v.tag) {
        case "ElemComment": return false;
        case "ElemLink":
          yield* tellItem(d, v); // Just update on screen.
          return false;
        case "ElemBox": return yield* updateBox(cls, d, v._0);
        case "ElemArrow": return yield* updateArrow(cls, d, v._0);
        default: return absurd(v);
      }
    },
    // DiagramMetadata (Element t v) = DiagramAppearance t v
    diagramMetadataJ: JSON_DiagramAppearance as J.JSONCodec<DiagramAppearance<T, V>>,
    diagramMetadataMempty: mempty_DiagramAppearance as DiagramAppearance<T, V>,
    diagramMetadataAppend: (m1, m2) => append_DiagramAppearance(m1, m2),
  };
  elementClasses.set(cls, dict);
  return dict;
}

/** `instance (...) => Viewable (Element t v)` (see "Avatar_Element"). */
export const Viewable_Element = Avatar_Element;

/** `instance (...) => Connectable (Element t v)` (see "Avatar_Element"). */
export const Connectable_Element = Avatar_Element;

export function _ElemBox<T = any, V = any>(): Prism<Element<T, V>, Box<T, V>> {
  return prism(
    (b: Box<T, V>) => ElemBox(b),
    (v: Element<T, V>): Either<Element<T, V>, Box<T, V>> => (v.tag === "ElemBox" ? Right(v._0) : Left(v)),
  );
}

export function _ElemArrow<T = any, V = any>(): Prism<Element<T, V>, Arrow<T, V>> {
  return prism(
    (a: Arrow<T, V>) => ElemArrow(a),
    (v: Element<T, V>): Either<Element<T, V>, Arrow<T, V>> => (v.tag === "ElemArrow" ? Right(v._0) : Left(v)),
  );
}

export function _ElemComment<T = any, V = any>(): Prism<Element<T, V>, Comment> {
  return prism(
    (c: Comment) => ElemComment<T, V>(c),
    (v: Element<T, V>): Either<Element<T, V>, Comment> => (v.tag === "ElemComment" ? Right(v._0) : Left(v)),
  );
}

export function _ElemLink<T = any, V = any>(): Prism<Element<T, V>, Link> {
  return prism(
    (x: Link) => ElemLink<T, V>(x),
    (v: Element<T, V>): Either<Element<T, V>, Link> => (v.tag === "ElemLink" ? Right(v._0) : Left(v)),
  );
}

/** If the element refers to any model IDs then replace them according to the supplied function. */
export function elementMapAvatars<T, V>(f: (m: ModelId) => Maybe<ModelId>, x: Element<T, V>): Element<T, V> {
  switch (x.tag) {
    case "ElemBox": {
      const b = x._0;
      const r = f(b.boxEntity);
      if (r.tag === "Nothing") return x;
      return ElemBox({ ...b, boxEntity: r.value });
    }
    case "ElemArrow": {
      const a = x._0;
      const fixTargetChild = (u: ConnectorEnd): ConnectorEnd => {
        if (u.tag === "Connected" && u.connectorTargetChild.tag === "Just") {
          const tc = u.connectorTargetChild.value;
          return Connected(u.connectorPoint, u.connectorTarget, Just(fromMaybe(tc, f(tc))));
        }
        return u;
      };
      return ElemArrow(over(
        arrowShape<T, V>().dot(lineEnds).dot<ConnectorEnd, ConnectorEnd>(both<ConnectorEnd>()),
        fixTargetChild,
        { ...a, arrowEntity: fromMaybe(a.arrowEntity, f(a.arrowEntity)) },
      ));
    }
    case "ElemComment":
      return x;
    case "ElemLink": {
      const l = x._0;
      const r = bindMaybe(view(linkTarget, l), f);
      if (r.tag === "Nothing") return x;
      return ElemLink<T, V>(set(linkTarget.dot(_Just<ModelId>()), r.value, l));
    }
    default:
      return absurd(x);
  }
}

function* boxMove<T, V>(
  _cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  xy: readonly [number, number],
  b: Box<T, V>,
): Delta<Element<T, V>, Element<T, V>> {
  const { boxShapeClass: sc, boxId: dId, boxEntity: mId, boxType: typ, _boxPeg: peg, boxShape: shape } = b;
  const newBox = ElemBox(Box<T, V, any>(sc, dId, mId, typ, peg, sc.shapeDrag(xy, shape)));
  yield* updateItem(d, newBox);
  return newBox;
}

function* boxDrag<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  xy: readonly [number, number],
  boxItem: Box<T, V>,
): Delta<Element<T, V>, Element<T, V>> {
  type El = Element<T, V>;
  const screenRange = 20; // Screen distance within which snaps occur.
  const { boxShapeClass: sc, boxId: dId, boxEntity: mId, boxType: typ, _boxPeg: oldPeg, boxShape: shape } = boxItem;
  if (view(sc.shapeDefinition, shape).tag === "NoBox") return ElemBox(boxItem); // Shouldn't happen.
  const cl = connectable(d);
  const z = use(d, deltaZoom<El>());
  const contents = M.toList(use(d, deltaDiagram<El>().dot(diagramContents<El>())));
  const arrows = mapMaybe(([uuid, v]: [DiagramId, El]) =>
    (v.tag === "ElemArrow" ? Just([uuid, v._0] as [DiagramId, Arrow<T, V>]) : Nothing), contents);
  const candidates: [DiagramId, Arrow<T, V>][] = [];
  for (const c of arrows) if (isJust(yield* cls.boxCanPeg(d, boxItem, c[1]))) candidates.push(c);
  const newShape = sc.shapeDrag(xy, shape);
  const newBox = ElemBox(Box<T, V, any>(sc, dId, mId, typ, oldPeg, newShape));
  const centre = view(sc.shapeDefinition.dot(boxCentre), newShape);
  const check = ([uuid, arrow]: [DiagramId, Arrow<T, V>]): Maybe<[DiagramId, [number, number, Point]]> => {
    const s = view(arrowShape<T, V>(), arrow);
    const r = lineSnap(screenRange / z, s, centre);
    return r.tag === "Just" ? Just([uuid, r.value] as [DiagramId, [number, number, Point]]) : Nothing;
  };
  const snaps: [DiagramId, [number, number, Point]][] = mapMaybe(check, candidates);
  let newBox1: El;
  if (snaps.length === 0) {
    newBox1 = isJust(oldPeg) ? yield* cl.itemUnpeg(d, newBox) : newBox;
  } else {
    const [newLineId, [, f, pt]] = L.minimumBy(
      comparing((s: [DiagramId, [number, number, Point]]) => view(_2<DiagramId, [number, number, Point]>(), s)[0]),
      snaps,
    );
    const snappedBox1 = ElemBox(Box<T, V, any>(sc, dId, mId, typ, oldPeg,
      set(sc.shapeDefinition.dot(boxCentre), pt, newShape)));
    if (oldPeg.tag === "Nothing") {
      newBox1 = fromMaybe(newBox, yield* cl.itemPegAt(d, snappedBox1, newLineId, f));
      // If peg fails then go back to unsnapped box.
    } else {
      const [oldLineId] = oldPeg.value;
      if (oldLineId === newLineId) {
        newBox1 = setJust(_ElemBox<T, V>().dot(boxPeg<T, V>()), [oldLineId, f] as Peg, snappedBox1);
      } else {
        const snappedBox2 = yield* cl.itemUnpeg(d, snappedBox1);
        newBox1 = fromMaybe(newBox, yield* cl.itemPegAt(d, snappedBox2, newLineId, f));
      }
    }
  }
  yield* updateItem(d, newBox1);
  return newBox1;
}

/** If the box is pegged to a line then move it to the right point. */
function* boxAdjust<T, V>(
  _cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  b: Box<T, V>,
): Delta<Element<T, V>, void> {
  type El = Element<T, V>;
  const { boxShapeClass: sc, boxId: dId, boxEntity: mId, boxType: typ, _boxPeg: peg, boxShape: shape } = b;
  if (peg.tag === "Nothing") return;
  const [arrId, f] = peg.value;
  const contents = use(d, deltaDiagram<El>().dot(diagramContents<El>()));
  const arrow = preview(ix<DiagramId, El>(arrId).dot(_ElemArrow<T, V>()).dot(arrowShape<T, V>()), contents);
  if (arrow.tag === "Nothing") return;
  const pt = lineFractionPoint(f, arrow.value);
  // Haskell: `when (isJust $ shape ^? shapeDefinition . boxCentre)`. The lazy `isJust` is True
  // even for a NoBox (whose centre is an error), so this tests for the box the code intends.
  if (view(sc.shapeDefinition, shape).tag !== "NoBox") {
    const newShape = set(sc.shapeDefinition.dot(boxCentre), pt, shape);
    yield* updateItem(d, ElemBox(Box<T, V, any>(sc, dId, mId, typ, peg, newShape)));
  }
}

/** Update the box avatar with information from the model. */
function* updateBox<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  boxItem: Box<T, V>,
): Delta<Element<T, V>, boolean> {
  type El = Element<T, V>;
  const offset = 50; // Distance a box will jump when unpegged from elsewhere.
  const { boxShapeClass: sc, boxId: diagId, boxEntity: modelId, boxType: typ, _boxPeg: peg, boxShape: shape } = boxItem;
  const contents = use(d, deltaDiagram<El>().dot(diagramContents<El>()));
  if (peg.tag === "Nothing") return false; // Box is unpegged, so leave it alone.
  // Check if relationship still there, if not then unpeg.
  const [arrId, f] = peg.value;
  const unpeg = function* (): Delta<El, boolean> {
    const newBox = ElemBox(set(boxPeg<T, V>(), Nothing, boxItem));
    yield* updateItem(d, newBox);
    yield* tellItem(d, newBox);
    return false;
  };
  const arrow = preview(ix<DiagramId, El>(arrId).dot(_ElemArrow<T, V>()), contents);
  if (arrow.tag === "Nothing") return yield* unpeg(); // Arrow no longer exists.
  const rel = yield* cls.boxCanPeg(d, boxItem, arrow.value);
  if (rel.tag === "Nothing") {
    cannotHappen("Box was pegged to something illegal.", null);
    return yield* unpeg();
  }
  const relName = rel.value;
  const stillPegged = queryRelations(base(d), (r) => NR.member(modelId, arrow.value.arrowEntity, relName, r));
  if (stillPegged) return false; // No change.
  // Clear peg and jump box sideways to show this.
  const [l, f1] = lineFractionSegment(f, view(arrowShape<T, V>(), arrow.value));
  const lineLen = distance(pointDiff(linePoint(l, 0), linePoint(l, 1)));
  const pt1 = linePoint(l, f1);
  const pt2 = linePoint(lineNormal(l, pt1), offset / lineLen);
  const newShape = sc.shapeDrag(pointDiff(pt2, pt1), shape);
  const newBox = ElemBox(Box<T, V, any>(sc, diagId, modelId, typ, Nothing, newShape));
  yield* updateItem(d, newBox);
  yield* tellItem(d, newBox);
  return true;
}

/** Update the arrow avatar with information from the model. */
function* updateArrow<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  arrow: Arrow<T, V>,
): Delta<Element<T, V>, boolean> {
  type El = Element<T, V>;
  type Ends = Maybe<readonly [ModelId, Maybe<ModelId>]>;
  const connectNearest = function* (modelId: ModelId, exportId: Maybe<ModelId>, pt: Point): Delta<El, Maybe<ConnectorEnd>> {
    const near = yield* nearestAvatar<HadesRender, V, ModelSubtype<T>, El>(d, modelId, pt);
    if (near.tag === "Nothing") return Nothing;
    const dd = near.value;
    const pt2 = (yield* connectable(d).itemConnectionPoint(d, dd, exportId))(pt);
    return Just(Connected(pt2, d.cls.identifier(dd), exportId));
  };
  /**
   * Update the connector to point to an avatar of modelId. If it returns Nothing then
   * the arrow cannot be made consistent with the model and should be deleted.
   */
  const updateConnector = function* (ends: Ends, pt0: Point, old: ConnectorEnd): Delta<El, [boolean, Maybe<ConnectorEnd>]> {
    if (ends.tag === "Nothing") {
      if (old.tag === "Unconnected") return [false, Just(old)]; // Nothing has changed.
      // Shorten line by 10% to show disconnection.
      return [true, Just(Unconnected(linePoint(lineFromPoints(pt0, old.connectorPoint), 0.9)))];
    }
    const [modelId, exportId] = ends.value;
    if (old.tag === "Unconnected") {
      const newCon = yield* connectNearest(modelId, exportId, pt0);
      return [!equals(Just(old), newCon), newCon];
    }
    const oldTargetId = old.connectorTarget;
    const r = yield* withItem(d, oldTargetId, function* (d1: DeltaCtx<El>, target: El): Delta<El, [boolean, Maybe<ConnectorEnd>]> {
      const av = avatar<HadesRender, V, ModelSubtype<T>, El>(d1);
      const oldChildren = yield* av.avatarChildren(d1, target);
      if (equals(av.ascendedId(target), Just(modelId)) || oldChildren.includes(modelId)) {
        return [false, Just(old)];
      }
      const newCon = yield* connectNearest(modelId, exportId, pt0);
      return [!equals(Just(old), newCon), newCon];
    });
    if (r.tag === "Nothing") {
      cannotHappen("Generic DiagraM updateConnector: old target not found in diagram.", null);
      const newCon = yield* connectNearest(modelId, exportId, pt0);
      return [!equals(Just(old), newCon), newCon];
    }
    return r.value;
  };
  const shape = view(arrowShape<T, V>(), arrow);
  // Points where start and end come from. "startPoint2" is the
  // point on the line that connects to the start point. If there
  // are no bends then this is the end point. And vice versa.
  const middle = view(lineMiddle, shape);
  const [startPoint2, endPoint2] = middle.length === 0
    ? [view(lineEnds, shape)[1].connectorPoint, view(lineEnds, shape)[0].connectorPoint]
    : [middle[0], middle[middle.length - 1]];
  const [eFrom, eTo] = edgeLinks(cls, base(d), arrow.arrowType, arrow.arrowEntity);
  const [flag1, newStart] = yield* updateConnector(eFrom, startPoint2, view(lineEnds, shape)[0]);
  const [flag2, newEnd] = yield* updateConnector(eTo, endPoint2, view(lineEnds, shape)[1]);
  if (newStart.tag === "Just" && newEnd.tag === "Just") {
    const newEnds: Terminators = middle.length === 0
      ? yield* optimiseEnds(d, [newStart.value, newEnd.value])
      : [newStart.value, newEnd.value];
    const newShape = set(lineEnds, newEnds, shape);
    const newArrow = set(arrowShape<T, V>(), newShape, arrow);
    yield* updateItem(d, ElemArrow(newArrow));
    return flag1 || flag2;
  }
  // End points cannot be updated, so delete arrow from diagram.
  yield* deleteItem(d, arrow.arrowId);
  return true;
}

/** If the argument is allowed on this diagram then add a new avatar to the diagram. */
function* genericEntityAvatar<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  entity: Entity<V>,
  basePoint: Point,
): Delta<Element<T, V>, Maybe<Element<T, V>>> {
  const arrowLength = 50; // Pixels of arrow length when added to diagram.
  const defaultBox = mkBoundBox(movePoint(basePoint, [-100, -50]), movePoint(basePoint, [100, 50]));
  const target = entity.entityId;
  const prsm = usingTraversal(base(d), (_c, p: Traversal<V, ModelSubtype<T>>) => p);
  const creation: AvatarCreation<T, V> = cls.avatarType(prsm, view(entityContents<V>(), entity));
  switch (creation.tag) {
    case "NoAvatar": // If entity is linkable then create a link box.
      if (isLinkable(cls, entity)) {
        const newItem = yield* addItem(d, (uuid) => ElemLink<T, V>(Link(uuid, Just(target), CommentBox(defaultBox), "")));
        return Just(newItem);
      }
      return Nothing;
    case "SimpleBox": {
      const typ = creation._0;
      const newItem = yield* addItem(d, (uuid) => ElemBox(cls.mkBox(uuid, target, typ, Nothing, defaultBox)));
      return Just(newItem);
    }
    case "SimpleArrow": {
      const typ = creation._0;
      const [eFrom, eTo] = edgeLinks(cls, base(d), typ, target);
      const fromConnector = yield* avatarConnector<HadesRender, V, ModelSubtype<T>, Element<T, V>>(
        d, eFrom, basePoint, movePoint(basePoint, [-arrowLength, 0]));
      const toConnector = yield* avatarConnector<HadesRender, V, ModelSubtype<T>, Element<T, V>>(
        d, eTo, basePoint, movePoint(basePoint, [arrowLength, 0]));
      const newItem = yield* addItem(d, (uuid) =>
        ElemArrow(Arrow<T, V>(uuid, target, typ, LineShape([fromConnector, toConnector], []))));
      return Just(newItem);
    }
    case "AvatarScript":
      return yield* creation._0(d, entity, basePoint);
    default:
      return absurd(creation);
  }
}

/**
 * Dialog for diagram elements that are not avatars.
 *
 * When a diagram element has its properties requested this is handled by "avatarProperties". If
 * the element is an avatar then the request is passed up to the model. Otherwise it is handled
 * by the element dialog selector. Hence this function does not need to handle avatar elements.
 */
export function elementDialog<T, V>(cls: LinkableClass<V>): DialogSelector_<Model<V>, null, Element<T, V>> {
  return (_model, e) => {
    switch (e.tag) {
      case "ElemComment":
        return Just(promoteDialog(
          (g: Gadget_<Model<V>, null, Comment>) => prismatic(def_Comment, _ElemComment<T, V>(), g),
          Dialog("Comment", OkApplyButton, commentGadget<Model<V>, null>()),
        ));
      case "ElemLink":
        return Just(promoteDialog(
          (g: Gadget_<Model<V>, null, Link>) => prismatic(def_Link, _ElemLink<T, V>(), g),
          linkDialog(cls),
        ));
      default:
        return Nothing; // Boxes and arrows are avatars so are handled elsewhere.
    }
  };
}

/** Create a new entity in the model and add a corresponding box avatar to the diagram. */
export function* newBoxEntityTool<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  /** Parent for new entity. */
  parent: ModelId,
  /** Prototype entity value. */
  newItem: V,
  /** Representation on the diagram. */
  boxTyp: BoxType<T>,
): Delta<Element<T, V>, Action<Element<T, V>>> {
  goToEntity(base(d), parent);
  const newBox = (mId: ModelId, dId: DiagramId, bounds: BoundBox): Element<T, V> =>
    ElemBox(cls.mkBox(dId, mId, boxTyp, Nothing, bounds));
  const drawFunc = yield* cls.boxTypeDraw(d, cls.mkBox(U.nil, U.nil, boxTyp, Nothing, NoBox), () => {}, Nothing);
  return yield* newBoxAvatarTool<HadesRender, V, ModelSubtype<T>, Element<T, V>>(d, parent, newBox, drawFunc, newItem);
}

export function* newArrowEntityTool<T, V>(
  cls: GenericDiagramClass<T, V>,
  d: DeltaCtx<Element<T, V>>,
  /** If true then sequester arrows in a separate package called \"Arrows\" */
  arrowFlag: boolean,
  /** Parent for new entity. */
  parent: ModelId,
  /** Prototype entity value. */
  newItem: V,
  /** Representation on the diagram. */
  arrowTyp: ArrowType<T>,
): Delta<Element<T, V>, Action<Element<T, V>>> {
  const updateAssociations = function* (d1: DeltaCtx<Element<T, V>>, e: Element<T, V>): Delta<Element<T, V>, void> {
    if (e.tag === "ElemArrow") {
      yield* updateArrowAssociations(cls, d1, Nothing, e._0);
    } else {
      cannotHappen("newArrowEntityTool arrow creation: something other than an arrow was created.", null);
    }
  };
  let arrows: ModelId;
  if (arrowFlag) { // Create "Arrows" sub-package if it doesn't exist.
    const b = base(d);
    goToEntity(b, parent);
    const [arrows1, chg] = createPath(b, [Name("Arrows")]);
    if (chg) yield* tellCheckpoint(d, "Auto-added Arrows package");
    arrows = arrows1;
  } else {
    arrows = parent; // Arrows are kept in parent along with everything else.
  }
  goToEntity(base(d), arrows);
  const nm = modelNewName(base(d), view(cls.name, newItem));
  const newArrow = (mId: ModelId, dId: DiagramId, shape: LineShape): Element<T, V> =>
    ElemArrow(Arrow<T, V>(dId, mId, arrowTyp, shape));
  return yield* newArrowAvatarTool<HadesRender, V, ModelSubtype<T>, Element<T, V>>(
    d,
    arrows,
    newArrow,
    set(cls.name, nm, newItem),
    updateAssociations,
  );
}

/** Add a new comment box to the diagram. */
export function newCommentTool<T = any, V = any>(): Action<Element<T, V>> {
  type El = Element<T, V>;
  const mkComment = (uid: DiagramId, s: BoundBox, [graphic, txt]: [Maybe<Graphic>, string]): El =>
    ElemComment<T, V>(Comment(uid, CommentBox(s), graphic, txt));
  // drawBox is only used for rubber band, so no text is required.
  const drawBox = (e: El): HadesRender<void> => {
    if (e.tag === "ElemComment") return drawCommentBox(e._0._commentShape);
    return () => cannotHappen("newCommentTool: something other than a comment was created.", undefined);
  };
  return mkScriptAction<El>((d) => newDiagramBoxTool<HadesRender, V, ModelSubtype<T>, El, [Maybe<Graphic>, string]>(
    d,
    [Nothing, ""],
    constantDialog(Dialog("Comment", OkButton, commentGadget1<Model<V>, null>())),
    mkComment,
    drawBox,
    "Add comment to diagram",
  ));
}

/** Add a new link box to the diagram. */
export function newLinkTool<T, V>(cls: LinkableClass<V>): Action<Element<T, V>> {
  type El = Element<T, V>;
  const mkLink = (uid: DiagramId, p: BoundBox, v: Link): El =>
    ElemLink<T, V>(Link(uid, view(linkTarget, v), CommentBox(p), view(linkText, v)));
  const drawBox = (e: El): HadesRender<void> => {
    if (e.tag === "ElemLink") return drawCommentBox(e._0._linkShape);
    return () => cannotHappen("newlinkTool: something other than a link was created.", undefined);
  };
  return mkScriptAction<El>((d) => newDiagramBoxTool<HadesRender, V, ModelSubtype<T>, El, Link>(
    d,
    Link(U.nil, Nothing, CommentBox(NoBox), ""), // Empty link. ID and box are dummies.
    constantDialog(linkDialog(cls)),
    mkLink,
    drawBox,
    "Add link to diagram",
  ));
}
