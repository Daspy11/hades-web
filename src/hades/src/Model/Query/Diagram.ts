// Ported from hades/src/Model/Query/Diagram.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Queries use reflection, but are not themselves part of the reflective mechanism. Query diagrams
 * appear in the model, but their contents are not avatars of anything else in the model.
 *
 * TypeScript port
 * ---------------
 * * `Queryable v` is the dictionary `Queryable<V>` (extends `Reflective<V>`): `_QueryDiagram`
 *   (a `Prism<V, QueryDiagram<V>>`) and `queryAvatars(v)`. Functions constrained by
 *   `(EntityClass v, Queryable v)` take one dictionary `cls: EntityClass<V> & Queryable<V>` first.
 * * `QueryData v` is a tagged union (`Step`, `Filter`, ..., `QueryComment`; positional field `_0`);
 *   the nullary constructors `Parent`, `Children`, `InDiagram`, `FindDiagrams`, `QueryInput` and
 *   `QueryOutput` are constants. Its prisms are zero-argument functions (`_Step<V>()`, ...).
 *   `Default (QueryData v)` is `def_QueryData` (`QueryInput`).
 * * `QueryBox v` is the record `{ queryBoxId, _queryBoxShape, _queryBoxData }`, `QueryArrow` the
 *   record `{ queryArrowId, _queryArrowShape }`, `QueryElement v` the union
 *   `QElemBox(_0: QueryBox)` / `QElemArrow(_0: QueryArrow)`, and `QueryDiagram v` the record
 *   `{ _queryDiagram, _queryInputs, _queryDescription }`. Polymorphic lenses/prisms are
 *   zero-argument functions (`queryBoxShape<V>()`, `queryBoxData<V>()`, `queryDiagram<V>()`,
 *   `queryInputs<V>()`, `_QElemBox<V>()`, `_QElemArrow<V>()`); `queryArrowShape` is a constant.
 * * The data family instance `ViewContext (QueryElement v)` is the record `QueryContext`
 *   (`{ queryContextId }`, built with `QueryContext(id)`).
 * * The `Viewable`, `Connectable` and `Avatar HadesRender v (QueryDiagram v)` instances for
 *   `QueryElement v` are one dictionary, `Avatar_QueryElement(cls)` (also exported as
 *   `Viewable_QueryElement` and `Connectable_QueryElement`). It also carries the
 *   `DiagramMetadataClass<null>` members for `DiagramMetadata (QueryElement v) = ()`, so it can be
 *   passed to `JSON_DiagramEntity`/`Reflective_DiagramEntity`. The dictionary is cached per `cls`,
 *   so every call returns the same object, as `startDelta` and `DiagramWrapper` require
 *   (PORTING.md §12, DiagramType).
 * * `Paint (QueryElement v)` is `HadesRender`; `Base (QueryElement v)` is `QueryScript v`, i.e.
 *   inside a Delta, `d.base` is a `ModelEditCtx<V, QueryDiagram<V>>`. It is re-read after every
 *   wait for input.
 * * JSON: `JSON_QueryBox`, `JSON_QueryArrow` and `JSON_QueryElement` are constants (the instances
 *   are unconstrained); `JSON_QueryDiagram(cls)` and `Reflective_QueryDiagram(cls)` take the
 *   dictionary.
 * * Constrained values become functions of the dictionary: `queryElementDialog(cls)` and
 *   `chooseQueryDialog(cls)` (dialog selector / dialog), `queryDiagramToolbar(cls)`.
 *   `queryBackgroundMenu(cls, pt)` returns the menu (`queryBackgroundMenu(cls)` returns the
 *   `Point -> Menu` function). `queryDiagramWrapper(cls, ctx, ent)` is a `ModelEdit`;
 *   `queryActivation(cls, ctx, ent)` is a `ModelScript` generator (the `HasDiagrams` dictionary
 *   must also be `Queryable`). `compileQueryDiagram(cls, model, de)`, `queryForest(cls, model)`,
 *   `queryTest(cls, qd)` and `clickableEntitySet(cls)` are pure.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import * as MP from "@/lib/Text/Megaparsec";
import { Just, Nothing, isJust, mapMaybe, maybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, partitionEithers, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { fmapTree, type Forest } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  _2, _Just, at, both, contains, identity, ix, iso, lens, over, preview, prism, set, to, use, view,
  type Iso, type Lens, type Prism, type Traversal,
} from "@/lib/Control/Lens";
import {
  ClickableItem, CloseButton, Dialog, OkApplyButton, accum, arr, box, buttonBar, clickableList,
  focusing, form, gFanout, gPipe, getEnv, memoBox, message1, prismatic, promoteDialog,
  readOnlyMemo, send, simpleFrame, tickBox, traversing, treeSelector, validate,
  type Dialog_, type DialogSelector_, type Gadget_, type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Menu, append_Menu, mempty_Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { cannotHappen } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import {
  type Action, type BoundBox, type ConnectorEnd, type Delta, type DeltaCtx, type DiagramId, type LineShape,
  type Point, type Rectangle, type View, BoxShapeClass_CommentBox, BoxShapeClass_Rectangle,
  CommentBox, DeltaTool, DeltaToolAction, DeltaToolbar, JSON_LineShape, JSON_Rectangle, NoBox,
  Point as mkPoint, Rectangle as mkRectangle, ShapeClass_LineShape, ShapeClass_Rectangle,
  alignmentTools, basicShapeMenu, boxHandles, connectableDefaults, deltaContext, deltaZoom,
  diagramContents, growBox, handleDelegatedAction, lineEnds, lineHandles, lineMenu, lineUpdate,
  liftBase, mempty_Diagram, mkScriptAction, moveEnd, rectangleCorners, rectangleShape,
  simpleHandle, tellCheckpoint, updateItem, yieldProperties, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesRender, closedArrowHead, drawCommentBox, drawPolyLine, drawPolygon, layoutParagraphs,
  runLayout_, squareHandle, textBlock,
} from "@/hades/src/Hades/GI/BasicShapes";
import {
  type Avatar, type DiagramMetadataClass, type EntityWrapper, type HasDiagrams, type ModelScript,
  type Editable, type ModelScriptAct, DiagramEntity, DiagramWrapper, JSON_DiagramEntity, Reflective_DiagramEntity,
  diagramEntityContents, diagramEntityName,
  avatar, newDiagramArrowTool, newDiagramBoxTool, openDiagram, openDialog, scriptContext,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId,
  Name, current, currentName, descriptionField, entityContents, entityName, entityPropertiesWithStamps,
  evalModelEdit, goToEntity, goToRoot, modelPackageForest, modifyValue, nameField, nameText,
  show_ModelError, throwUser, usingTraversal, withStampFields,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelFilter, modelSubsetSpecifier, refPicker, showEntitySet } from "@/hades/src/Model/Abstract/Properties";
import {
  type Query, type QueryId, QueryStep, childrenStep, compileQuery, filterStep, filterVariants,
  followArrows, inStep, mempty_QueryStep, noStep, parentStep, runQuery, runStep, step, subQuery,
} from "@/hades/src/Model/Query/Base";
import { expressionEntry, showSubset, subsetDialog } from "@/hades/src/Model/Reflection/Dialogs";
import { ShowErrorComponent_Text, evaluate, topExpr } from "@/hades/src/Model/Reflection/Parser";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import { append_RefTypeTable, mempty_RefTypeTable, refTypeTableToList } from "@/hades/src/Model/Reflection/References";
import { type Reflective, defaultVariantUserLabel, extract, reflectiveNames } from "@/hades/src/Model/Reflection/Reflective";
import { textField, textPair, withBuiltIn } from "@/hades/src/Model/Reflection/Types";
import {
  type Variant, ExtText, JSONKey_Variant, JSON_Variant, Variant as mkVariant, _ExtText, displayValue,
  valueTypeName,
} from "@/hades/src/Model/Reflection/Values";

// ---------------------------------------------------------------------------------------------

/** A reflective type can support queries as long as it can contain query diagrams. */
export interface Queryable<V> extends Reflective<V> {
  /** Prism for query diagrams in type @v@. */
  readonly _QueryDiagram: Prism<V, QueryDiagram<V>>;
  /**
   * If this is a diagram then return the list of model entities for which it contains
   * avatars. If this is not a diagram then return @[]@.
   */
  queryAvatars(v: V): ModelId[];
}

/** The dictionary for `(EntityClass v, Queryable v)`. */
export type QueryableEntityClass<V> = EntityClass<V> & Queryable<V>;

/** Move to the entities which are represented in the input diagrams. */
function inDiagramStep<V>(cls: QueryableEntityClass<V>): QueryStep<V> {
  const d = (m: Model<V>, uuid: ModelId): ModelId[] =>
    maybe([], (v: V) => cls.queryAvatars(v), preview(ix<ModelId, Entity<V>>(uuid).dot(entityContents<V>()), m.modelContents));
  return QueryStep<V>((_outers, model, inputs) =>
    [S.fromList(L.concatMap((u: ModelId) => d(model, u), S.toList(inputs))), []]);
}

/** Move to the diagrams which contain the input entities. */
function findDiagramsStep<V>(cls: QueryableEntityClass<V>): QueryStep<V> {
  const check = (i: S.Set<ModelId>, e: Entity<V>): boolean =>
    !S.isNull(S.intersection(i, S.fromList(cls.queryAvatars(e._entityContents))));
  return QueryStep<V>((_outers, model, inputs) =>
    [S.fromList(M.elems(model.modelContents).filter((e) => check(inputs, e)).map((e) => e.entityId)), []]);
}

export type QueryData<V> =
  /** Follow the named relations to connected entities. */
  | { readonly tag: "Step"; readonly _0: S.Set<Relation> }
  /** Filter the entities according to the expression in the text. */
  | { readonly tag: "Filter"; readonly _0: string }
  /** Filter out variants not in the set. */
  | { readonly tag: "FilterVariants"; readonly _0: S.Set<Variant<V>> }
  /** Insert the named diagram as a query. */
  | { readonly tag: "SubQuery"; readonly _0: Maybe<U.UUID> }
  /** Adds all instances of the named variant types. */
  | { readonly tag: "Variants"; readonly _0: S.Set<Variant<V>> }
  /** Adds all the identified entities. */
  | { readonly tag: "Entities"; readonly _0: S.Set<U.UUID> }
  /** Follow the named types of arrows. */
  | { readonly tag: "Forwards"; readonly _0: M.Map<Variant<V>, readonly [Relation, Relation]> }
  /** Follow the named types of arrows backwards. */
  | { readonly tag: "Backwards"; readonly _0: M.Map<Variant<V>, readonly [Relation, Relation]> }
  /** Move to the parents of the current entities. */
  | { readonly tag: "Parent" }
  /** Move to the children of the current entities. */
  | { readonly tag: "Children" }
  /** Move to the contents of the current diagrams. */
  | { readonly tag: "InDiagram" }
  /** Move to the diagrams that contain the current entities. */
  | { readonly tag: "FindDiagrams" }
  /** The input to the query. */
  | { readonly tag: "QueryInput" }
  /** The output from the query. */
  | { readonly tag: "QueryOutput" }
  /** Comment box. */
  | { readonly tag: "QueryComment"; readonly _0: string };

export function Step<V = any>(_0: S.Set<Relation>): QueryData<V> {
  return { tag: "Step", _0 };
}
export function Filter<V = any>(_0: string): QueryData<V> {
  return { tag: "Filter", _0 };
}
export function FilterVariants<V = any>(_0: S.Set<Variant<V>>): QueryData<V> {
  return { tag: "FilterVariants", _0 };
}
export function SubQuery<V = any>(_0: Maybe<U.UUID>): QueryData<V> {
  return { tag: "SubQuery", _0 };
}
export function Variants<V = any>(_0: S.Set<Variant<V>>): QueryData<V> {
  return { tag: "Variants", _0 };
}
export function Entities<V = any>(_0: S.Set<U.UUID>): QueryData<V> {
  return { tag: "Entities", _0 };
}
export function Forwards<V = any>(_0: M.Map<Variant<V>, readonly [Relation, Relation]>): QueryData<V> {
  return { tag: "Forwards", _0 };
}
export function Backwards<V = any>(_0: M.Map<Variant<V>, readonly [Relation, Relation]>): QueryData<V> {
  return { tag: "Backwards", _0 };
}
export const Parent: QueryData<any> = { tag: "Parent" };
export const Children: QueryData<any> = { tag: "Children" };
export const InDiagram: QueryData<any> = { tag: "InDiagram" };
export const FindDiagrams: QueryData<any> = { tag: "FindDiagrams" };
export const QueryInput: QueryData<any> = { tag: "QueryInput" };
export const QueryOutput: QueryData<any> = { tag: "QueryOutput" };
export function QueryComment<V = any>(_0: string): QueryData<V> {
  return { tag: "QueryComment", _0 };
}

/** `instance Default (QueryData v) where def = QueryInput` */
export const def_QueryData: QueryData<any> = QueryInput;

/** A prism for a constructor of `QueryData` with a single field. */
function queryDataPrism<V, K extends QueryData<V>["tag"], A>(
  tag: K,
  build: (a: A) => QueryData<V>,
): Prism<QueryData<V>, A> {
  return prism(build, (v: QueryData<V>): Either<QueryData<V>, A> =>
    (v.tag === tag ? Right((v as { readonly _0: A })._0) : Left(v)));
}

export function _Step<V = any>(): Prism<QueryData<V>, S.Set<Relation>> {
  return queryDataPrism<V, "Step", S.Set<Relation>>("Step", Step);
}

export function _Filter<V = any>(): Prism<QueryData<V>, string> {
  return queryDataPrism<V, "Filter", string>("Filter", Filter);
}

export function _FilterVariants<V = any>(): Prism<QueryData<V>, S.Set<Variant<V>>> {
  return queryDataPrism<V, "FilterVariants", S.Set<Variant<V>>>("FilterVariants", FilterVariants);
}

export function _SubQuery<V = any>(): Prism<QueryData<V>, Maybe<U.UUID>> {
  return queryDataPrism<V, "SubQuery", Maybe<U.UUID>>("SubQuery", SubQuery);
}

export function _Variants<V = any>(): Prism<QueryData<V>, S.Set<Variant<V>>> {
  return queryDataPrism<V, "Variants", S.Set<Variant<V>>>("Variants", Variants);
}

export function _Entities<V = any>(): Prism<QueryData<V>, S.Set<U.UUID>> {
  return queryDataPrism<V, "Entities", S.Set<U.UUID>>("Entities", Entities);
}

export function _Forwards<V = any>(): Prism<QueryData<V>, M.Map<Variant<V>, readonly [Relation, Relation]>> {
  return queryDataPrism<V, "Forwards", M.Map<Variant<V>, readonly [Relation, Relation]>>("Forwards", Forwards);
}

export function _Backwards<V = any>(): Prism<QueryData<V>, M.Map<Variant<V>, readonly [Relation, Relation]>> {
  return queryDataPrism<V, "Backwards", M.Map<Variant<V>, readonly [Relation, Relation]>>("Backwards", Backwards);
}

export function _QueryComment<V = any>(): Prism<QueryData<V>, string> {
  return queryDataPrism<V, "QueryComment", string>("QueryComment", QueryComment);
}

/**
 * Query diagram elements are not avatars for model entities. However they need access to
 * names, UUIDs and reflective data for all model elements.
 *
 * (Haskell `type QueryScript v = ModelScript HadesRender v (QueryDiagram v)`. The script's
 * context is a `ModelEditCtx<V, QueryDiagram<V>>`; `A` is the result type.)
 */
export type QueryScript<V, A> = ModelScript<HadesRender, V, A>;

type QueryDelta<V, A> = Delta<QueryElement<V>, A>;

type QueryView<V> = View<QueryElement<V>>;

/** The context of a running query diagram Delta. */
type QueryDeltaCtx<V> = DeltaCtx<QueryElement<V>>;

// ---------------------------------------------------------------------------------------------

/** The diagramatic representation of component of a query. */
export interface QueryBox<V> {
  /** The ID of this box in the query diagram. */
  readonly queryBoxId: U.UUID;
  readonly _queryBoxShape: Rectangle;
  readonly _queryBoxData: QueryData<V>;
}
export function QueryBox<V = any>(queryBoxId: U.UUID, _queryBoxShape: Rectangle, _queryBoxData: QueryData<V>): QueryBox<V> {
  return { queryBoxId, _queryBoxShape, _queryBoxData };
}

/** JSON codec for the relation pairs of "Forwards" and "Backwards". */
const arrowVariantsJ: J.JSONCodec<M.Map<Variant<any>, readonly [Relation, Relation]>> =
  J.mapJ(JSONKey_Variant, J.tuple2J(J.textJ, J.textJ));

/** `instance ToJSON (QueryBox v)` and `instance FromJSON (QueryBox v)` */
export const JSON_QueryBox: J.JSONCodec<QueryBox<any>> = J.codec(
  (box1) => {
    const base: [string, J.Value][] = [
      ["queryBoxId", J.uuidJ.toJSON(box1.queryBoxId)],
      ["shape", JSON_Rectangle.toJSON(view(queryBoxShape(), box1))],
    ];
    const qd: QueryData<any> = view(queryBoxData(), box1);
    const rest = ((): [string, J.Value][] => {
      switch (qd.tag) {
        case "Step": return [textPair("type", "step"), ["relations", J.setJ(J.textJ).toJSON(qd._0)]];
        case "Filter": return [textPair("type", "filter"), ["text", qd._0]];
        case "FilterVariants": return [textPair("type", "filterVariants"), ["variants", J.setJ(JSON_Variant).toJSON(qd._0)]];
        case "SubQuery": return [textPair("type", "subquery"), ["query", J.maybeJ(J.uuidJ).toJSON(qd._0)]];
        case "Variants": return [textPair("type", "variants"), ["variants", J.setJ(JSON_Variant).toJSON(qd._0)]];
        case "Entities": return [textPair("type", "entities"), ["entities", J.setJ(J.uuidJ).toJSON(qd._0)]];
        case "Forwards": return [textPair("type", "forwards"), ["variants", arrowVariantsJ.toJSON(qd._0)]];
        case "Backwards": return [textPair("type", "backwards"), ["variants", arrowVariantsJ.toJSON(qd._0)]];
        case "Parent": return [textPair("type", "parent")];
        case "Children": return [textPair("type", "children")];
        case "InDiagram": return [textPair("type", "inDiagram")];
        case "FindDiagrams": return [textPair("type", "findDiagrams")];
        case "QueryInput": return [textPair("type", "queryInput")];
        case "QueryOutput": return [textPair("type", "queryOutput")];
        case "QueryComment": return [textPair("type", "comment"), ["text", qd._0]];
        default: return absurd(qd);
      }
    })();
    return J.object([...base, ...rest]);
  },
  (val) => J.withObject("Query diagram box", (v) => {
    const uuid = J.field(v, "queryBoxId", J.uuidJ);
    const shape = J.field(v, "shape", JSON_Rectangle);
    const f = (qd: QueryData<any>): QueryBox<any> => QueryBox(uuid, shape, qd);
    const typ = textField(v, "type");
    switch (typ) {
      case "step": return f(Step(J.field(v, "relations", J.setJ(J.textJ))));
      case "filter": return f(Filter(J.field(v, "text", J.textJ)));
      case "filterVariants": return f(FilterVariants(J.field(v, "variants", J.setJ(JSON_Variant))));
      case "subquery": return f(SubQuery(J.field(v, "query", J.maybeJ(J.uuidJ))));
      case "variants": return f(Variants(J.field(v, "variants", J.setJ(JSON_Variant))));
      case "entities": return f(Entities(J.field(v, "entities", J.setJ(J.uuidJ))));
      case "forwards": return f(Forwards(J.field(v, "variants", arrowVariantsJ)));
      case "backwards": return f(Backwards(J.field(v, "variants", arrowVariantsJ)));
      case "parent": return f(Parent);
      case "children": return f(Children);
      case "inDiagram": return f(InDiagram);
      case "findDiagrams": return f(FindDiagrams);
      case "queryInput": return f(QueryInput);
      case "queryOutput": return f(QueryOutput);
      case "comment": return f(QueryComment(J.field(v, "text", J.textJ)));
      default: return J.fail("Unknown query box type: " + T.unpack(typ));
    }
  }, val),
);

export function queryBoxShape<V = any>(): Lens<QueryBox<V>, Rectangle> {
  return lens((box1: QueryBox<V>) => box1._queryBoxShape, (box1, s: Rectangle) => ({ ...box1, _queryBoxShape: s }));
}

export function queryBoxData<V = any>(): Lens<QueryBox<V>, QueryData<V>> {
  return lens((box1: QueryBox<V>) => box1._queryBoxData, (box1, d: QueryData<V>) => ({ ...box1, _queryBoxData: d }));
}

function* queryBoxHandles<V>(
  _cls: QueryableEntityClass<V>,
  d: QueryDeltaCtx<V>,
  box1: QueryBox<V>,
): QueryDelta<V, QueryView<V>[]> {
  const handles = boxHandles(queryBoxShape<V>().dot(rectangleShape), box1);
  const views: QueryView<V>[] = [];
  for (const [p, shapeF] of handles) {
    views.push(yield* simpleHandle<QueryElement<V>>(d, "Resize ", mempty_Menu(), squareHandle,
      [p, (pt: Point) => QElemBox(shapeF(pt))]));
  }
  return views;
}

/** The type label for the query box. */
function queryBoxLabel<V>(box1: QueryBox<V>): string {
  const qd = view(queryBoxData<V>(), box1);
  switch (qd.tag) {
    case "Step": return "Step";
    case "Filter": return "Filter";
    case "FilterVariants": return "Filter Types";
    case "SubQuery": return "SubQuery";
    case "Variants": return "Types";
    case "Entities": return "Entities";
    case "Forwards": return "Follow forwards";
    case "Backwards": return "Follow backwards";
    case "Parent": return "Parent entity";
    case "Children": return "Child entities";
    case "InDiagram": return "Diagram contents";
    case "FindDiagrams": return "Find diagrams containing the inputs";
    case "QueryInput": return "Input";
    case "QueryOutput": return "Output";
    case "QueryComment": return "Comment";
    default: return absurd(qd);
  }
}

/** The `Avatar` dictionary of a query diagram Delta (`d.cls`). */
function queryAvatar<V>(d: QueryDeltaCtx<V>): Avatar<HadesRender, V, QueryDiagram<V>, QueryElement<V>> {
  return avatar<HadesRender, V, QueryDiagram<V>, QueryElement<V>>(d);
}

function* queryBoxDescription<V>(
  cls: QueryableEntityClass<V>,
  d: QueryDeltaCtx<V>,
  box1: QueryBox<V>,
): QueryDelta<V, string> {
  const arrowNames = S.fromList(M.keys(cls.reflectiveArrows));
  const varLabel = (v: Variant<V>): string => cls.variantUserLabel(v);
  const qd = view(queryBoxData<V>(), box1);
  switch (qd.tag) {
    case "Step": return T.intercalate(", ", S.toList(qd._0));
    case "Filter": return qd._0;
    case "FilterVariants": return showVariants(cls, qd._0);
    case "SubQuery": {
      if (qd._0.tag === "Just") {
        const uuid = qd._0.value;
        return yield* liftBase(d, (base: ModelEditCtx<V, QueryDiagram<V>>) => getEntityName(base, uuid));
      }
      return "<Nothing selected>";
    }
    case "Variants": return showVariants(cls, qd._0);
    case "Entities": {
      const uuids = S.toList(qd._0);
      return yield* liftBase(d, function* (base: ModelEditCtx<V, QueryDiagram<V>>): QueryScript<V, string> {
        const names: string[] = [];
        for (const u of uuids) names.push(yield* getEntityName(base, u));
        return T.intercalate(", ", names);
      });
    }
    case "Forwards": return showSubset(varLabel, arrowNames, S.fromList(M.keys(qd._0)));
    case "Backwards": return showSubset(varLabel, arrowNames, S.fromList(M.keys(qd._0)));
    case "QueryInput": {
      const mId = yield* queryAvatar(d).getDiagramModelId(d);
      const base = scriptContext<V, QueryDiagram<V>>(d);
      goToEntity(base, mId);
      const c = current(base);
      const vs = preview(
        _Just<Entity<V>>().dot(entityContents<V>()).dot(cls._QueryDiagram).dot(queryInputs<V>()), c);
      if (vs.tag === "Nothing") return "- Internal Error -"; // Should never happen.
      return showVariants(cls, vs.value);
    }
    case "QueryComment": return qd._0;
    default: return "";
  }
}

/** Show the names of the variants in the set, or those that are not in the set if that is shorter. */
function showVariants<A>(cls: Reflective<A>, vars: S.Set<Variant<A>>): string {
  const universe1 = S.fromList(reflectiveNames(cls));
  return showSubset((v: Variant<A>) => cls.variantUserLabel(v), universe1, vars);
}

function* queryBoxView<V>(
  cls: QueryableEntityClass<V>,
  d: QueryDeltaCtx<V>,
  box1: QueryBox<V>,
): QueryDelta<V, QueryView<V>> {
  const desc = yield* queryBoxDescription(cls, d, box1);
  const scale = use(d, deltaZoom<QueryElement<V>>());
  const editInputs = mkScriptAction<QueryElement<V>>(function* (d1) {
    const mId = yield* queryAvatar(d1).getDiagramModelId(d1);
    const base = scriptContext<V, QueryDiagram<V>>(d1);
    goToEntity(base, mId);
    const c = current(base);
    let changed: boolean;
    const qiM = preview(
      _Just<Entity<V>>().dot(entityContents<V>()).dot(cls._QueryDiagram).dot(queryInputs<V>()), c);
    if (qiM.tag === "Nothing") {
      changed = false; // Do nothing. Should never happen.
    } else {
      const qi = qiM.value;
      const dlg: DialogSelector_<Model<V>, null, S.Set<Variant<V>>> = (_e, _a) => Just(subsetDialog<Variant<V>, Model<V>, null>(
        "Query input types",
        (v) => cls.variantUserLabel(v),
        S.fromList(reflectiveNames(cls)),
      ));
      const r = yield* openDialog<HadesRender, V, QueryDiagram<V>, S.Set<Variant<V>>>(base, dlg, qi);
      if (r.tag === "Nothing") changed = false;
      else {
        const newVal = r.value;
        changed = modifyValue(base, (w: QueryDiagram<V>) => set(queryInputs<V>(), newVal, w));
      }
    }
    if (changed) {
      const nm = currentName(scriptContext<V, QueryDiagram<V>>(d1));
      yield* tellCheckpoint(d1, "Edited inputs of " + nm);
    }
    return yield* yieldViews(d1);
  });
  const queryBoxMenu = (pt: Point): Menu<Action<QueryElement<V>>> => {
    const basic = basicShapeMenu<QueryElement<V>>(box1.queryBoxId, pt);
    switch (box1._queryBoxData.tag) {
      case "QueryInput": return append_Menu(Menu([[menuItem("Edit inputs", editInputs)]]), basic);
      default: return basic;
    }
  };
  const qd = view(queryBoxData<V>(), box1);
  const viewDraw: HadesRender = qd.tag === "QueryComment"
    ? (env) => {
      const cbox = CommentBox(ShapeClass_Rectangle.shapeBounds(view(queryBoxShape<V>(), box1)));
      drawCommentBox(cbox)(env);
      runLayout_(BoxShapeClass_CommentBox.shapeInnerBox(cbox), layoutParagraphs([], qd._0))(env);
    }
    : (env) => {
      drawPolygon(rectangleCorners(view(queryBoxShape<V>(), box1)))(env);
      textBlock(queryBoxLabel(box1), [desc], BoxShapeClass_Rectangle.shapeInnerBox(view(queryBoxShape<V>(), box1)))(env);
    };
  return {
    viewDraw,
    viewTouched: (p) => ShapeClass_Rectangle.shapeTouched(view(queryBoxShape<V>(), box1), scale, p),
    viewBox: ShapeClass_Rectangle.shapeBounds(view(queryBoxShape<V>(), box1)),
    viewMenu: queryBoxMenu,
    viewAction: (d1, a) => handleDelegatedAction(
      d1,
      QElemBox(box1),
      (d2) => yieldProperties(d2, QElemBox(box1)),
      (d2, _c) => yieldViews(d2),
      a,
    ),
  };
}

/** Get the name of the referenced entity in the context of the current model. */
function* getEntityName<V>(ctx: ModelEditCtx<V, QueryDiagram<V>>, uuid: U.UUID): QueryScript<V, string> {
  goToEntity(ctx, uuid);
  return currentName(ctx);
}

// ---------------------------------------------------------------------------------------------

export interface QueryArrow {
  readonly queryArrowId: U.UUID;
  readonly _queryArrowShape: LineShape;
}
export function QueryArrow(queryArrowId: U.UUID, _queryArrowShape: LineShape): QueryArrow {
  return { queryArrowId, _queryArrowShape };
}

/** `instance ToJSON QueryArrow` and `instance FromJSON QueryArrow` */
export const JSON_QueryArrow: J.JSONCodec<QueryArrow> = (() => {
  // Some old files have zero length query arrows in the top left corner. Make them visible.
  const bogus = (c: ConnectorEnd): boolean => c.tag === "Unconnected" && equals(c.connectorPoint, mkPoint(0, 0));
  const fixBogus = (arrow: QueryArrow): QueryArrow => {
    const [end1, end2] = view(queryArrowShape.dot(lineEnds), arrow);
    return bogus(end1) && bogus(end2)
      ? over(queryArrowShape.dot(lineEnds).dot(_2<ConnectorEnd, ConnectorEnd>()), (e: ConnectorEnd) => moveEnd(e, [50, 20]), arrow)
      : arrow;
  };
  return J.codec<QueryArrow>(
    (a) => J.object([
      ["queryArrowId", J.uuidJ.toJSON(a.queryArrowId)],
      ["shape", JSON_LineShape.toJSON(view(queryArrowShape, a))],
    ]),
    (val) => J.withObject("Query diagram arrow", (v) =>
      fixBogus(QueryArrow(J.field(v, "queryArrowId", J.uuidJ), J.field(v, "shape", JSON_LineShape))), val),
  );
})();

export const queryArrowShape: Lens<QueryArrow, LineShape> =
  lens((arrow: QueryArrow) => arrow._queryArrowShape, (arrow, s: LineShape) => ({ ...arrow, _queryArrowShape: s }));

function* queryArrowHandles<V>(
  _cls: QueryableEntityClass<V>,
  d: QueryDeltaCtx<V>,
  arrow: QueryArrow,
): QueryDelta<V, QueryView<V>[]> {
  const promoteShape = (s: LineShape): QueryElement<V> => QElemArrow(set(queryArrowShape, s, arrow));
  return yield* lineHandles<QueryElement<V>>(d, view(queryArrowShape, arrow), squareHandle, promoteShape,
    function* () { /* return () */ });
}

function* queryArrowView<V>(
  _cls: QueryableEntityClass<V>,
  d: QueryDeltaCtx<V>,
  arrow: QueryArrow,
): QueryDelta<V, QueryView<V>> {
  const scale = use(d, deltaZoom<QueryElement<V>>());
  const shape = view(queryArrowShape, arrow);
  const [start, end] = view(lineEnds, shape);
  return {
    viewDraw: drawPolyLine(
      closedArrowHead(30, 10, false),
      [],
      start.connectorPoint,
      shape._lineMiddle,
      end.connectorPoint,
      Nothing,
    ),
    viewTouched: (p) => ShapeClass_LineShape.shapeTouched(shape, scale, p),
    viewBox: growBox(12.0, ShapeClass_LineShape.shapeBounds(shape)), // Allow for arrow head.
    viewMenu: (p) => append_Menu(
      lineMenu<QueryElement<V>>((s) => QElemArrow(set(queryArrowShape, s, arrow)), shape, p),
      basicShapeMenu<QueryElement<V>>(arrow.queryArrowId, p),
    ),
    viewAction: (d1, a) => handleDelegatedAction(
      d1,
      QElemArrow(arrow),
      (d2) => yieldViews(d2),
      (d2, _c) => yieldViews(d2),
      a,
    ),
  };
}

// ---------------------------------------------------------------------------------------------

/** Query diagrams are composed of boxes and arrows. */
export type QueryElement<V> =
  | { readonly tag: "QElemBox"; readonly _0: QueryBox<V> }
  | { readonly tag: "QElemArrow"; readonly _0: QueryArrow };

export function QElemBox<V = any>(_0: QueryBox<V>): QueryElement<V> {
  return { tag: "QElemBox", _0 };
}
export function QElemArrow<V = any>(_0: QueryArrow): QueryElement<V> {
  return { tag: "QElemArrow", _0 };
}

/** `instance HasId (QueryElement v)` */
function queryElementIdentifier<V>(e: QueryElement<V>): DiagramId {
  switch (e.tag) {
    case "QElemBox": return e._0.queryBoxId;
    case "QElemArrow": return e._0.queryArrowId;
    default: return absurd(e);
  }
}

/** `instance ToJSON (QueryElement v)` and `instance FromJSON (QueryElement v)` */
export const JSON_QueryElement: J.JSONCodec<QueryElement<any>> = J.codec(
  (e) => {
    switch (e.tag) {
      case "QElemBox": return JSON_QueryBox.toJSON(e._0);
      case "QElemArrow": return JSON_QueryArrow.toJSON(e._0);
      default: return absurd(e);
    }
  },
  J.alt<QueryElement<any>>(
    (v) => QElemBox(JSON_QueryBox.parseJSON(v)),
    (v) => QElemArrow(JSON_QueryArrow.parseJSON(v)),
  ),
);

/**
 * The data family instance `ViewContext (QueryElement v)`: the model ID of the query diagram
 * being edited.
 */
export interface QueryContext {
  readonly queryContextId: QueryId;
}
export function QueryContext(queryContextId: QueryId): QueryContext {
  return { queryContextId };
}

/**
 * The dictionary of the `Viewable`, `Connectable` and `Avatar HadesRender v (QueryDiagram v)`
 * instances for `QueryElement v`, with `DiagramMetadata (QueryElement v) = ()`.
 */
export type QueryElementClass<V> =
  Avatar<HadesRender, V, QueryDiagram<V>, QueryElement<V>, null> & DiagramMetadataClass<null>;

/** Cache of the instance dictionaries, one per `(EntityClass v, Queryable v)` dictionary. */
const queryElementClasses = new WeakMap<object, QueryElementClass<any>>();

/**
 * `instance (EntityClass v, Queryable v) => Viewable (QueryElement v)`,
 * `instance (EntityClass v, Queryable v) => Connectable (QueryElement v)` and
 * `instance (EntityClass v, Queryable v) => Avatar HadesRender v (QueryDiagram v) (QueryElement v)`.
 *
 * TypeScript: one dictionary for all three classes; repeated calls with the same `cls` return the
 * same object.
 */
export function Avatar_QueryElement<V>(cls: QueryableEntityClass<V>): QueryElementClass<V> {
  const cached = queryElementClasses.get(cls);
  if (cached !== undefined) return cached as QueryElementClass<V>;
  type QE = QueryElement<V>;
  const dict: QueryElementClass<V> = {
    ...connectableDefaults<QE>(),
    // Viewable
    identifier: queryElementIdentifier,
    *itemHandles(d, v) {
      switch (v.tag) {
        case "QElemBox": return yield* queryBoxHandles(cls, d, v._0);
        case "QElemArrow": return yield* queryArrowHandles(cls, d, v._0);
        default: return absurd(v);
      }
    },
    itemTouched: (v, s, p) => {
      switch (v.tag) {
        case "QElemBox": return ShapeClass_Rectangle.shapeTouched(view(queryBoxShape<V>(), v._0), s, p);
        case "QElemArrow": return ShapeClass_LineShape.shapeTouched(view(queryArrowShape, v._0), s, p);
        default: return absurd(v);
      }
    },
    itemInBox: (v, b) => {
      switch (v.tag) {
        case "QElemBox": return ShapeClass_Rectangle.shapeInBox(view(queryBoxShape<V>(), v._0), b);
        case "QElemArrow": return ShapeClass_LineShape.shapeInBox(view(queryArrowShape, v._0), b);
        default: return absurd(v);
      }
    },
    itemBounds: (v) => {
      switch (v.tag) {
        case "QElemBox": return ShapeClass_Rectangle.shapeBounds(view(queryBoxShape<V>(), v._0));
        case "QElemArrow": return ShapeClass_LineShape.shapeBounds(view(queryArrowShape, v._0));
        default: return absurd(v);
      }
    },
    *itemResize(d, wh, v) {
      if (v.tag === "QElemBox") {
        const newItem = QElemBox(over(queryBoxShape<V>(), (s: Rectangle) => BoxShapeClass_Rectangle.shapeResize(wh, s), v._0));
        yield* updateItem(d, newItem);
        return newItem;
      }
      return v;
    },
    *itemMove(d, xy, v) {
      return yield* dict.itemDrag(d, xy, v);
    },
    *itemDrag(d, xy, v) {
      switch (v.tag) {
        case "QElemBox": {
          const newItem = QElemBox(over(queryBoxShape<V>(), (s: Rectangle) => ShapeClass_Rectangle.shapeDrag(xy, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        case "QElemArrow": {
          const newItem = QElemArrow<V>(over(queryArrowShape, (s: LineShape) => ShapeClass_LineShape.shapeDrag(xy, s), v._0));
          yield* updateItem(d, newItem);
          return newItem;
        }
        default: return absurd(v);
      }
    },
    *itemView(d, v) {
      switch (v.tag) {
        case "QElemBox": return yield* queryBoxView(cls, d, v._0);
        case "QElemArrow": return yield* queryArrowView(cls, d, v._0);
        default: return absurd(v);
      }
    },
    *itemChildren() {
      return [];
    },
    *itemDescription(_d, v) {
      switch (v.tag) {
        case "QElemBox": return queryBoxLabel(v._0);
        case "QElemArrow": return "Query arrow";
        default: return absurd(v);
      }
    },
    itemType: () => "Query",
    // Connectable
    *itemCanConnect(_d, _dir, v1, v2, _child) {
      if (v1.tag === "QElemBox") return false;
      if (v2.tag === "QElemBox") return v2._0._queryBoxData.tag !== "QueryComment";
      return false;
    },
    itemConnectors: _QElemArrow<V>().dot(queryArrowShape).dot(lineEnds)
      .dot(both<ConnectorEnd>() as unknown as Traversal<readonly [ConnectorEnd, ConnectorEnd], ConnectorEnd>),
    *itemConnectionPoint(_d, v, _child) {
      switch (v.tag) {
        case "QElemBox": {
          const shape = view(queryBoxShape<V>(), v._0);
          return (p: Point) => ShapeClass_Rectangle.shapeConnectionPoint(shape, p);
        }
        case "QElemArrow": {
          const shape = view(queryArrowShape, v._0);
          return (p: Point) => ShapeClass_LineShape.shapeConnectionPoint(shape, p);
        }
        default: return absurd(v);
      }
    },
    *itemAdjust(d, v) {
      if (v.tag === "QElemArrow") {
        const a = v._0;
        const newShape = yield* lineUpdate(d, view(queryArrowShape, a));
        yield* updateItem(d, QElemArrow<V>(set(queryArrowShape, newShape, a)));
      }
    },
    // Avatar
    *getDiagramModelId(d) {
      return (use(d, deltaContext<QE>()) as QueryContext).queryContextId;
    },
    updateViewContext: (_ctx, _meta, vc) => vc,
    *entityAvatar() {
      return Nothing; // Query elements are not avatars of anything.
    },
    ascendedId: () => Nothing,
    *avatarChildren() {
      return [];
    },
    *updateAvatar() {
      return false;
    },
    // DiagramMetadata (QueryElement v) = ()
    diagramMetadataJ: J.unitJ,
    diagramMetadataMempty: null,
    diagramMetadataAppend: () => null,
  };
  queryElementClasses.set(cls, dict);
  return dict;
}

/** `instance (EntityClass v, Queryable v) => Viewable (QueryElement v)` (see "Avatar_QueryElement"). */
export const Viewable_QueryElement = Avatar_QueryElement;

/** `instance (EntityClass v, Queryable v) => Connectable (QueryElement v)` (see "Avatar_QueryElement"). */
export const Connectable_QueryElement = Avatar_QueryElement;

export function _QElemBox<V = any>(): Prism<QueryElement<V>, QueryBox<V>> {
  return prism(
    (bx: QueryBox<V>) => QElemBox(bx),
    (v: QueryElement<V>): Either<QueryElement<V>, QueryBox<V>> => (v.tag === "QElemBox" ? Right(v._0) : Left(v)),
  );
}

export function _QElemArrow<V = any>(): Prism<QueryElement<V>, QueryArrow> {
  return prism(
    (arrow: QueryArrow) => QElemArrow<V>(arrow),
    (v: QueryElement<V>): Either<QueryElement<V>, QueryArrow> => (v.tag === "QElemArrow" ? Right(v._0) : Left(v)),
  );
}

// ---------------------------------------------------------------------------------------------
// Dialogs

/** Properties dialog selector for query elements within the diagram. */
export function queryElementDialog<V>(cls: QueryableEntityClass<V>): DialogSelector_<Model<V>, null, QueryElement<V>> {
  return (e, a) => {
    const qd = preview(_QElemBox<V>().dot(queryBoxData<V>()), a);
    const dlg = qd.tag === "Just" ? queryDataDialog(cls)(e, qd.value) : Nothing;
    if (dlg.tag === "Just") {
      const { dialogTitle: t, dialogButtons: b, dialogGadget: g } = dlg.value;
      return Just(Dialog(t, b, accum(traversing(def_QueryData as QueryData<V>, _QElemBox<V>().dot(queryBoxData<V>()), g))));
    }
    return Nothing;
  };
}

/** Properties dialog selector for query data within a box. */
function queryDataDialog<V>(cls: QueryableEntityClass<V>): DialogSelector_<Model<V>, null, QueryData<V>> {
  type E = Model<V>;
  type QD = QueryData<V>;
  /** Not a proper Iso, but close enough as long as only one element can be selected. */
  const resultIso = <A>(): Iso<Maybe<A>, S.Set<A>> => iso(
    (m: Maybe<A>) => (m.tag === "Just" ? S.singleton(m.value) : S.empty<A>()),
    (s: S.Set<A>) => {
      const xs = S.toList(s);
      return xs.length === 1 ? Just(xs[0]) : Nothing;
    },
  );
  return (model, qd) => {
    switch (qd.tag) {
      case "Step": return Just(queryStepDialog(cls, model));
      case "Filter":
        return Just(Dialog("Filter condition", OkApplyButton,
          prismatic("", _Filter<V>(),
            expressionEntry<E, null>(cls.entityFunctions,
              withStampFields(withBuiltIn(model.modelFields))))));
      case "FilterVariants":
        return Just(promoteDialog(
          (g: Gadget_<E, null, S.Set<Variant<V>>>) => prismatic(S.empty<Variant<V>>(), _FilterVariants<V>(), g),
          queryVariantsDialog<V, E>(cls)));
      case "SubQuery":
        return Just(promoteDialog(
          (g: Gadget_<E, null, S.Set<U.UUID>>) =>
            prismatic(S.empty<U.UUID>(), _SubQuery<V>().dot(resultIso<U.UUID>()), g),
          chooseQueryDialog(cls)));
      case "Variants":
        return Just(promoteDialog(
          (g: Gadget_<E, null, S.Set<Variant<V>>>) => prismatic(S.empty<Variant<V>>(), _Variants<V>(), g),
          queryVariantsDialog<V, E>(cls)));
      case "Entities":
        return Just(promoteDialog(
          (g: Gadget_<E, null, S.Set<U.UUID>>) => prismatic(S.empty<U.UUID>(), _Entities<V>(), g),
          queryEntitiesDialog(cls)));
      case "Forwards":
        return Just(promoteDialog(
          (g: Gadget_<E, null, M.Map<Variant<V>, readonly [Relation, Relation]>>) =>
            prismatic(M.empty<Variant<V>, readonly [Relation, Relation]>(), _Forwards<V>(), g),
          queryArrowVariantsDialog<V, E>(cls, false)));
      case "Backwards":
        return Just(promoteDialog(
          (g: Gadget_<E, null, M.Map<Variant<V>, readonly [Relation, Relation]>>) =>
            prismatic(M.empty<Variant<V>, readonly [Relation, Relation]>(), _Backwards<V>(), g),
          queryArrowVariantsDialog<V, E>(cls, true)));
      case "QueryComment":
        return Just(promoteDialog(
          (g: Gadget_<E, null, string>) => prismatic("", _QueryComment<V>(), g),
          queryCommentDialog<E>()));
      default: {
        const other: QD = qd;
        void other;
        return Nothing;
      }
    }
  };
}

/** Select which relationship types this query step will transit. */
function queryStepDialog<V>(cls: EntityClass<V>, model: Model<V>): Dialog_<Model<V>, null, QueryData<V>> {
  const allRelations = refTypeTableToList(append_RefTypeTable(cls.reflectiveBuiltInRefs, model.modelRefTypes))
    .map(([r]) => r);
  const relationTick = (rel: string): readonly [string, GadgetF_<Model<V>, null, S.Set<string>>] =>
    [rel, focusing(contains<string>(rel), tickBox<Model<V>, null>())];
  return Dialog("Step via:", OkApplyButton, prismatic(S.empty<Relation>(), _Step<V>(),
    validate((s: S.Set<Relation>) => !S.isNull(s),
      accum(form<Model<V>, null, S.Set<Relation>>("Vertical", allRelations.map(relationTick))))));
}

/** Chose another query to invoke within the current one. */
export function chooseQueryDialog<V>(cls: QueryableEntityClass<V>): Dialog_<Model<V>, null, S.Set<U.UUID>> {
  return refPicker<V, null>(cls, true, (e) => isJust(preview(entityContents<V>().dot(cls._QueryDiagram), e)));
}

function queryVariantsDialog<V, E = any>(cls: Reflective<V>): Dialog_<E, null, S.Set<Variant<V>>> {
  return subsetDialog<Variant<V>, E, null>("Entity types", (v) => cls.variantUserLabel(v), S.fromList(reflectiveNames(cls)));
}

function queryEntitiesDialog<V>(cls: EntityClass<V>): Dialog_<Model<V>, null, S.Set<U.UUID>> {
  type Item = readonly [string, Maybe<string>, Maybe<ModelId>];
  const treeFunc = (ent: Entity<V>): Item => [
    view(entityName(cls).dot(nameText), ent),
    preview(entityContents<V>().dot(to((v: V) => cls.reflectiveGet(v))).dot(ix(descriptionField))
      .dot(to(displayValue)), ent),
    Just(ent.entityId),
  ];
  const queryTree = (model: Model<V>) => evalModelEdit(cls, identity<V>(), model, (c) => {
    goToRoot(c);
    return modelPackageForest(c).map((t) => fmapTree(treeFunc, t));
  });
  const queryTree1 = (model: Model<V>): Forest<Item> => {
    const r = queryTree(model);
    if (r.tag === "Left") {
      return cannotHappen("Query dialog could not get entity tree.\n" + T.pack(show_ModelError(r.value)), []);
    }
    return r.value;
  };
  return Dialog("Entity Set Selection", OkApplyButton,
    validate((s: S.Set<U.UUID>) => !S.isNull(s), treeSelector<Model<V>, null, ModelId>(queryTree1)));
}

/** False for following arrows forwards, True for following backwards. */
function queryArrowVariantsDialog<V, E = any>(
  cls: Reflective<V>,
  backFlag: boolean,
): Dialog_<E, null, M.Map<Variant<V>, readonly [Relation, Relation]>> {
  type Tbl = M.Map<Variant<V>, readonly [Relation, Relation]>;
  const msg = "Follow arrows " + (backFlag ? "backwards" : "forwards");
  const universe1 = M.toList(cls.reflectiveArrows);
  const [uni1, uni2] = L.splitAt(Math.trunc((universe1.length + 1) / 2), universe1);
  const isoPair = <A>(rs: A): Iso<Maybe<A>, boolean> => iso(
    (m: Maybe<A>) => isJust(m),
    (b: boolean) => (b ? Just(rs) : Nothing),
  );
  const variantFlag = (
    [v, rs]: readonly [Variant<V>, readonly [Relation, Relation]],
  ): readonly [string, GadgetF_<E, null, Tbl>] =>
    [cls.variantUserLabel(v),
      focusing(at<Variant<V>, readonly [Relation, Relation]>(v).dot(isoPair(rs)), tickBox<E, null>())];
  // accum $ buttonBar [...] <<< accum (box Horizontal [...])
  return Dialog(msg, OkApplyButton,
    accum(gPipe(
      accum(box<E, null, Tbl>("Horizontal", [[
        form<E, null, Tbl>("Vertical", uni1.map(variantFlag)),
        form<E, null, Tbl>("Vertical", uni2.map(variantFlag)),
      ]])),
      buttonBar<E, null, Tbl>([
        ["Set all", () => cls.reflectiveArrows],
        ["Clear all", () => M.empty<Variant<V>, readonly [Relation, Relation]>()],
      ]),
    )));
}

/** Dialog for comment text. */
function queryCommentDialog<E = any>(): Dialog_<E, null, string> {
  return Dialog("Query Comment", OkApplyButton, memoBox<E, null>("MemoMedium", true));
}

// ---------------------------------------------------------------------------------------------

/** The variant of the entity type that holds query diagrams. */
export interface QueryDiagram<V> {
  readonly _queryDiagram: DiagramEntity<QueryElement<V>, null>;
  readonly _queryInputs: S.Set<Variant<V>>;
  readonly _queryDescription: string;
}
export function QueryDiagram<V = any>(
  _queryDiagram: DiagramEntity<QueryElement<V>, null>,
  _queryInputs: S.Set<Variant<V>>,
  _queryDescription: string,
): QueryDiagram<V> {
  return { _queryDiagram, _queryInputs, _queryDescription };
}

/**
 * `instance (EntityClass v, Queryable v) => ToJSON (QueryDiagram v)` and
 * `instance (EntityClass v, Queryable v) => FromJSON (QueryDiagram v)`.
 */
export function JSON_QueryDiagram<V>(cls: QueryableEntityClass<V>): J.JSONCodec<QueryDiagram<V>> {
  const diagramJ = JSON_DiagramEntity<QueryElement<V>, null>(Avatar_QueryElement(cls), JSON_QueryElement);
  const variantsJ = J.setJ<Variant<V>>(JSON_Variant);
  const newDiagram = (val: J.Value): QueryDiagram<V> => J.withObject("Query Diagram", (v1) => QueryDiagram<V>(
    J.field(v1, "diagram", diagramJ),
    J.field(v1, "inputs", variantsJ),
    J.field(v1, "description", J.textJ),
  ), val);
  const plainDiagram = (v1: J.Value): QueryDiagram<V> => {
    const d = diagramJ.parseJSON(v1);
    return QueryDiagram<V>(d, S.fromList(reflectiveNames(cls)), "");
  };
  return J.codec(
    (qd) => J.object([
      ["diagram", diagramJ.toJSON(qd._queryDiagram)],
      ["inputs", variantsJ.toJSON(qd._queryInputs)],
      ["description", qd._queryDescription],
    ]),
    J.alt(newDiagram, plainDiagram),
  );
}

/** `instance (EntityClass v, Queryable v) => Reflective (QueryDiagram v)` */
export function Reflective_QueryDiagram<V>(cls: QueryableEntityClass<V>): Reflective<QueryDiagram<V>> {
  const reflDiagram = Reflective_DiagramEntity<QueryElement<V>, null>(Avatar_QueryElement(cls));
  const everything = S.fromList(cls.reflectiveDefaults.map((v) => cls.reflectiveName(v)));
  return {
    reflectiveName: () => mkVariant("Query"),
    variantUserLabel: defaultVariantUserLabel,
    reflectiveDefaults: [
      QueryDiagram<V>(DiagramEntity<QueryElement<V>, null>(Name("Query-"), mempty_Diagram(), null), everything, ""),
    ],
    reflectiveBuiltIn: () => [nameField, descriptionField],
    reflectiveGet: (qd) =>
      M.union(reflDiagram.reflectiveGet(qd._queryDiagram), M.singleton(descriptionField, ExtText(qd._queryDescription))),
    reflectiveSet: (st, qd) => {
      const d1 = reflDiagram.reflectiveSet(st, qd._queryDiagram);
      const txt1 = extract(st, qd._queryDescription, _ExtText, descriptionField);
      return QueryDiagram<V>(d1, qd._queryInputs, txt1);
    },
    reflectiveBuiltInRefs: mempty_RefTypeTable,
    reflectiveArrows: M.empty(),
  };
}

/** Wrapper for query diagrams. (A `ModelEdit v (QueryDiagram v)` action.) */
export function queryDiagramWrapper<V>(
  cls: QueryableEntityClass<V>,
  ctx: ModelEditCtx<V, QueryDiagram<V>>,
  ent: Entity<V>,
): Maybe<EntityWrapper<HadesRender, V>> {
  return usingTraversal(ctx, (_c, trv) => {
    // Maybe monad
    const qdM = preview(entityContents<V>().dot(trv), ent);
    if (qdM.tag === "Nothing") return Nothing;
    const qd = qdM.value;
    return Just(DiagramWrapper<HadesRender, V, QueryDiagram<V>, QueryElement<V>>(
      Avatar_QueryElement(cls),
      ent.entityId,
      view(queryDiagram<V>().dot(diagramEntityContents<QueryElement<V>, null>()), qd),
      queryDiagram<V>(),
      trv,
      queryElementDialog(cls),
      QueryContext(ent.entityId),
      Just(queryBackgroundMenu(cls)),
      () => queryDiagramToolbar(cls),
    ));
  });
}

export function queryDiagram<V = any>(): Lens<QueryDiagram<V>, DiagramEntity<QueryElement<V>, null>> {
  return lens(
    (s: QueryDiagram<V>) => s._queryDiagram,
    (s, d: DiagramEntity<QueryElement<V>, null>) => ({ ...s, _queryDiagram: d }),
  );
}

export function queryInputs<V = any>(): Lens<QueryDiagram<V>, S.Set<Variant<V>>> {
  return lens((s: QueryDiagram<V>) => s._queryInputs, (s, i: S.Set<Variant<V>>) => ({ ...s, _queryInputs: i }));
}

// Following code is included for consistency but is currently unused, so commented out.
// export function queryDescription<V = any>(): Lens<QueryDiagram<V>, string> {
//   return lens((s: QueryDiagram<V>) => s._queryDescription, (s, t: string) => ({ ...s, _queryDescription: t }));
// }

/** Activation script for query diagrams. */
export function* queryActivation<V>(
  cls: HasDiagrams<HadesRender, V> & Queryable<V>,
  ctx: ModelEditCtx<V, QueryDiagram<V>>,
  e: Entity<V>,
): ModelScript<HadesRender, V, Maybe<string>> {
  yield* openDiagram<HadesRender, V, QueryDiagram<V>>(cls, ctx, e.entityId);
  return Nothing;
}

/**
 * Background menu for queries: just a test option.
 *
 * (Called without the `Point` it returns the `Point -> Menu` function; the point is ignored.
 * The script runs in whatever `ModelScript p v w` the diagram's base is.)
 */
export function queryBackgroundMenu<V>(cls: QueryableEntityClass<V>): (p: Point) => Menu<Action<QueryElement<V>>>;
export function queryBackgroundMenu<V>(cls: QueryableEntityClass<V>, p: Point): Menu<Action<QueryElement<V>>>;
export function queryBackgroundMenu<V>(
  cls: QueryableEntityClass<V>,
  p?: Point,
): Menu<Action<QueryElement<V>>> | ((p: Point) => Menu<Action<QueryElement<V>>>) {
  const menu = (): Menu<Action<QueryElement<V>>> => Menu([[
    menuItem("Test query", mkScriptAction<QueryElement<V>>(function* (d) {
      const modelId = (use(d, deltaContext<QueryElement<V>>()) as QueryContext).queryContextId;
      const base = scriptContext<V, any>(d);
      goToEntity(base, modelId);
      const c = current(base);
      if (c.tag === "Nothing") {
        throwUser(base, "Query has been deleted.");
      } else {
        const ent = c.value;
        const qdM = preview(entityContents<V>().dot(cls._QueryDiagram), ent);
        if (qdM.tag === "Nothing") {
          cannotHappen("Current entity does not contain a query.", null);
        } else {
          yield* openDialog<HadesRender, V, any, null>(base, queryTest(cls, qdM.value), null);
        }
      }
      return yield* yieldViews(d);
    })),
  ]]);
  return p === undefined ? () => menu() : menu();
}

/** Convert a query diagram into a query. Returns the query and a list of warnings. */
export function compileQueryDiagram<V>(
  cls: QueryableEntityClass<V>,
  model: Model<V>,
  de: DiagramEntity<QueryElement<V>, any>,
): Either<string[], Query<V>> {
  const ftable = withStampFields(withBuiltIn(model.modelFields));
  type Compiled = Either<string[], Either<readonly [U.UUID, QueryStep<V>], readonly [U.UUID, U.UUID]>>;
  /* Query diagrams are compiled as graphs. Nodes 1 and 2 are priviledged as the
    input and output nodes respectively. Additional edges are generated to link
    these to the input and output steps in the diagram, which are treated as normal
    no-op steps. See Query.Base.compileQuery for details. */
  const compile = (stack: S.Set<U.UUID>, dEnt: DiagramEntity<QueryElement<V>, any>): Either<string[], Query<V>> => {
    const n = dEnt._diagramEntityName;
    const d = dEnt._diagramEntityContents;
    const elems = M.toList(view(diagramContents<QueryElement<V>>(), d));
    const queryName = view(nameText, n);
    const [errs, elements2] = partitionEithers(elems.map((el) => compileElem(stack, queryName, el)));
    const [steps, edges] = partitionEithers(elements2);
    return L.isNull(errs)
      ? Right(compileQuery(steps, [...edges, ...mapMaybe(ioLink, elems)]))
      : Left(L.concat(errs));
  };
  const stepOf = (uuid: U.UUID, qs: QueryStep<V>): Compiled => Right(Left([uuid, qs] as const));
  const compileElem = (
    stack: S.Set<U.UUID>,
    queryName: string,
    [uuid, el]: readonly [U.UUID, QueryElement<V>],
  ): Compiled => {
    if (el.tag === "QElemArrow") {
      const [e1, e2] = view(queryArrowShape.dot(lineEnds), el._0);
      if (e1.tag === "Connected" && e2.tag === "Connected") {
        return Right(Right([e1.connectorTarget, e2.connectorTarget] as const));
      }
      if (e1.tag === "Unconnected" && e2.tag === "Connected") return Left([queryName + ": Line from nowhere."]);
      if (e1.tag === "Connected" && e2.tag === "Unconnected") return Left([queryName + ": Line to nowhere."]);
      return Left([queryName + ": Floating line."]);
    }
    const qd = view(queryBoxData<V>(), el._0);
    switch (qd.tag) {
      case "Step": return stepOf(uuid, step(cls, qd._0));
      case "Filter": {
        const txt = qd._0;
        const r = MP.parse(topExpr<Model<V>>(cls.entityFunctions, ftable), "", txt);
        if (r.tag === "Right") {
          const parsed = r.value;
          return stepOf(uuid, filterStep(cls, (extVals, ent): Either<string, boolean> => {
            const ev = evaluate(parsed, M.union(entityPropertiesWithStamps(cls, ent), extVals), model);
            if (ev.tag === "Left") return Left(ev.value);
            const v = ev.value;
            if (v.tag === "ExtBool") return Right(v._0);
            if (v.tag === "ExtNone") return Right(false);
            return Left(queryName + ": Filter formula returned " + valueTypeName(v) + " instead of Bool.");
          }));
        }
        return Left(L.take(3, r.value.bundleErrors)
          .map((e) => T.pack(MP.parseErrorTextPretty(ShowErrorComponent_Text, e))));
      }
      case "FilterVariants": {
        const vs = qd._0;
        return stepOf(uuid, filterStep(cls, (_, ent) => Right(S.member(cls.reflectiveName(ent._entityContents), vs))));
      }
      case "SubQuery": {
        if (qd._0.tag === "Nothing") return Left([queryName + ": SubQuery: No query selected."]);
        const subId = qd._0.value;
        if (S.member(subId, stack)) return Left([queryName + ": Recursive subquery detected. Cannot run this."]);
        const sub = preview(ix<ModelId, Entity<V>>(subId).dot(entityContents<V>()).dot(cls._QueryDiagram), model.modelContents);
        if (sub.tag === "Nothing") return Left([queryName + ": SubQuery: Query does not exist (deleted?)."]);
        const r = compile(S.insert(subId, stack), view(queryDiagram<V>(), sub.value));
        if (r.tag === "Left") return Left(r.value);
        return stepOf(uuid, subQuery(r.value));
      }
      case "Variants": {
        const vs = qd._0;
        // Haskell evaluates "newEnts" lazily, i.e. only when the step is run (and then once).
        let newEnts: S.Set<ModelId> | null = null;
        const getNewEnts = (): S.Set<ModelId> => {
          if (newEnts === null) {
            newEnts = runStep(filterVariants(cls, vs), [], model,
              S.fromList(M.toList(model.modelContents).map(([, e]) => e.entityId)))[0];
          }
          return newEnts;
        };
        return stepOf(uuid, QueryStep<V>((_o, _m, inputs) => [S.union(inputs, getNewEnts()), []]));
      }
      case "Entities": {
        const uuids = qd._0;
        return stepOf(uuid, QueryStep<V>((_o, _m, inputs) => [S.union(inputs, uuids), []]));
      }
      case "Forwards":
        return stepOf(uuid, L.foldr(
          ([v, [r1, r2]]: readonly [Variant<V>, readonly [Relation, Relation]], acc: QueryStep<V>) =>
            inStep(followArrows(cls, S.singleton(v), r1, r2), acc),
          noStep as QueryStep<V>,
          M.toList(qd._0)));
      case "Backwards":
        return stepOf(uuid, L.foldr(
          ([v, [r1, r2]]: readonly [Variant<V>, readonly [Relation, Relation]], acc: QueryStep<V>) =>
            inStep(followArrows(cls, S.singleton(v), r2, r1), acc),
          noStep as QueryStep<V>,
          M.toList(qd._0)));
      case "Parent": return stepOf(uuid, parentStep(cls));
      case "Children": return stepOf(uuid, childrenStep(cls));
      case "InDiagram": return stepOf(uuid, inDiagramStep(cls));
      case "FindDiagrams": return stepOf(uuid, findDiagramsStep(cls));
      case "QueryInput": return stepOf(uuid, mempty_QueryStep);
      case "QueryOutput": return stepOf(uuid, mempty_QueryStep);
      case "QueryComment": return stepOf(uuid, mempty_QueryStep);
      default: return absurd(qd);
    }
  };
  // If the elmenent is an input or an output, generate the appropriate extra link with U.nil
  const ioLink = ([uuid, el]: readonly [U.UUID, QueryElement<V>]): Maybe<readonly [U.UUID, U.UUID]> => {
    if (el.tag === "QElemArrow") return Nothing;
    switch (el._0._queryBoxData.tag) {
      case "QueryInput": return Just([U.nil, uuid] as const);
      case "QueryOutput": return Just([uuid, U.nil] as const);
      default: return Nothing;
    }
  };
  return compile(S.empty<U.UUID>(), de);
}

export function queryDiagramToolbar<V>(cls: QueryableEntityClass<V>): DeltaToolbar<QueryElement<V>> {
  type QE = QueryElement<V>;
  const tool = (icon: string, tip: string, qd: QueryData<V>): DeltaTool<QE> =>
    DeltaTool<QE>(icon, tip, DeltaToolAction(newBoxTool(cls, qd)));
  return DeltaToolbar<QE>([[
    tool("query-forwards", "Follow arrows forward", Forwards<V>(M.empty())),
    tool("query-backwards", "Follow arrows backward", Backwards<V>(M.empty())),
    tool("query-step", "Step to related entities", Step<V>(S.empty())),
    tool("query-parent", "Parents of the entities in the model tree", Parent),
    tool("query-children", "Children of the entities in the model tree", Children),
    tool("query-in-diagram", "The contents of diagrams", InDiagram),
    tool("query-find-diagrams", "All diagrams containing the entities", FindDiagrams),
    tool("query-filter", "Filter entities with a formula", Filter<V>("")),
    tool("query-filter-variants", "Filter entities by type", FilterVariants<V>(S.empty())),
    tool("query-subquery", "Sub-query: run another query inside this one.", SubQuery<V>(Nothing)),
  ], [
    tool("query-variants", "Start with all entities of these types", Variants<V>(S.empty())),
    tool("query-entities", "Start with these entities", Entities<V>(S.empty())),
    tool("query-input", "Start with the entities that were inputs to this query", QueryInput),
    tool("query-output", "Send results out from this query", QueryOutput),
  ], [
    DeltaTool<QE>("query-arrow", "Link query stages into a pipeline", DeltaToolAction(newArrowTool(cls))),
  ], [
    tool("basic_comment", "Comment", QueryComment<V>("")),
  ]], [alignmentTools<QE>()]);
}

function newBoxTool<V>(cls: QueryableEntityClass<V>, qd: QueryData<V>): Action<QueryElement<V>> {
  const boxLabel = queryBoxLabel(QueryBox<V>(U.nil, mkRectangle(NoBox), qd));
  const msg = "Added `" + boxLabel + "' to query diagram";
  const qbPaint = (v: QueryElement<V>): HadesRender => {
    if (v.tag === "QElemBox") {
      const shape = v._0._queryBoxShape;
      return (env) => {
        drawPolygon(rectangleCorners(shape))(env);
        textBlock(boxLabel, [], ShapeClass_Rectangle.shapeBounds(shape))(env);
      };
    }
    return () => cannotHappen("Query newBoxTool: produced something other than a box.", undefined);
  };
  return mkScriptAction<QueryElement<V>>(function* (d) {
    const mkBox = (dId: DiagramId, s: BoundBox, a: QueryData<V>): QueryElement<V> =>
      QElemBox(QueryBox<V>(dId, mkRectangle(s), a));
    return yield* newDiagramBoxTool<HadesRender, V, QueryDiagram<V>, QueryElement<V>, QueryData<V>>(
      d, qd, queryDataDialog(cls), mkBox, qbPaint, msg);
  });
}

function newArrowTool<V>(_cls: QueryableEntityClass<V>): Action<QueryElement<V>> {
  const mkArrow = (dId: DiagramId, shape: LineShape, _a: null): QueryElement<V> => QElemArrow<V>(QueryArrow(dId, shape));
  return mkScriptAction<QueryElement<V>>((d) =>
    newDiagramArrowTool<HadesRender, V, QueryDiagram<V>, QueryElement<V>, null>(
      d, null, Nothing, mkArrow, "Added arrow to query diagram"));
}

/** Extract the forest from the model and select all the members of the argument set. */
export function queryForest<V>(
  cls: QueryableEntityClass<V>,
  model: Model<V>,
): Forest<readonly [string, Maybe<string>, Maybe<ModelId>]> {
  return modelFilter(cls, (e) => isJust(preview(entityContents<V>().dot(cls._QueryDiagram), e)), model);
}

/** A dialog that displays the inputs and outputs of a query. Returns the selected inputs. */
export function queryTest<V>(cls: QueryableEntityClass<V>, qd: QueryDiagram<V>): DialogSelector_<Model<V>, null, null> {
  type E = Model<V>;
  const validInput = (e: Entity<V>): boolean => S.member(cls.reflectiveName(e._entityContents), view(queryInputs<V>(), qd));
  const qname = view(queryDiagram<V>().dot(diagramEntityName<QueryElement<V>, null>()).dot(nameText), qd);
  const errorDialog = (msg: string): Dialog_<E, null, null> =>
    Dialog("Query test error", CloseButton("_Close"), message1<E, null, null>(msg));
  return (model, _unit) => {
    const r = compileQueryDiagram(cls, model, view(queryDiagram<V>(), qd));
    if (r.tag === "Left") {
      return Just(errorDialog(qname + " contains the following errors:\n\n" + T.intercalate("\n", r.value)));
    }
    const query = r.value;
    // proc () -> do
    //   inputs <- simpleFrame "Inputs" $
    //       modelSubsetSpecifier (const validInput) (const Nothing) -< mempty
    //   (rs, ws) <- arr $ runQuery query [] model -< inputs
    //   _ <- simpleFrame "Outputs" $ readOnlyMemo MemoSmall True showEntitySet -< rs
    //   _ <- simpleFrame "Warnings" $
    //       readOnlyMemo MemoSmall True (const $ T.intercalate "\n") -< ws
    //   returnA -< ()
    const gadget = gPipe(
      arr<E, null, null, S.Set<ModelId>>(() => S.empty<ModelId>()),
      simpleFrame("Inputs", modelSubsetSpecifier<V, null>(cls, () => validInput, () => Nothing)),
      arr<E, null, S.Set<ModelId>, [S.Set<ModelId>, string[]]>((inputs) => runQuery(query, [], model, inputs)),
      gFanout(
        gPipe(
          arr<E, null, [S.Set<ModelId>, string[]], S.Set<ModelId>>(([rs]) => rs),
          simpleFrame("Outputs", readOnlyMemo<E, null, S.Set<ModelId>>("MemoSmall", true, (m, s) => showEntitySet(cls, m, s))),
        ),
        gPipe(
          arr<E, null, [S.Set<ModelId>, string[]], string[]>(([, ws]) => ws),
          simpleFrame("Warnings", readOnlyMemo<E, null, string[]>("MemoSmall", true, (_e, ws) => T.intercalate("\n", ws))),
        ),
      ),
      arr<E, null, [S.Set<ModelId>, string[]], null>(() => null),
    );
    return Just(Dialog("Test of " + qname, CloseButton("_Close"), gadget));
  };
}

/**
 * Take a set of entities and display them in a gadget. Double-clicks will activate the
 * entity, right clicks will pull up the "editableDisplayMenu".
 */
export function clickableEntitySet<P, V>(
  cls: Editable<P, V> & EntityClass<V>,
): Gadget_<Model<V>, ModelScriptAct<P, V, V, Maybe<string>>, S.Set<ModelId>> {
  type W = ModelScriptAct<P, V, V, Maybe<string>>;
  type E = Model<V>;
  const clickableEntity = (e: Entity<V>): ClickableItem<W> => ClickableItem<W>(
    view(entityName(cls).dot(nameText), e),
    Nothing,
    Just(cls.editableActivation(Just(e))),
    cls.editableDisplayMenu(Just(e)),
  );
  // proc s -> do
  //   model <- getEnv -< ()
  //   let ents = map clickableEntity $ mapMaybe (`M.lookup` modelContents model) $ S.toList s
  //   _ <- send id <<< clickableList -< ents
  //   returnA -< s
  return gPipe(
    gFanout(getEnv<E, W, S.Set<ModelId>>(), arr<E, W, S.Set<ModelId>, S.Set<ModelId>>((s) => s)),
    gFanout(
      gPipe(
        arr<E, W, [E, S.Set<ModelId>], ClickableItem<W>[]>(([model, s]) =>
          mapMaybe((k: ModelId) => M.lookup(k, model.modelContents), S.toList(s)).map(clickableEntity)),
        clickableList<E, W, W>(),
        send<E, W, Maybe<W>>((x) => x),
      ),
      arr<E, W, [E, S.Set<ModelId>], S.Set<ModelId>>(([, s]) => s),
    ),
    arr<E, W, [Maybe<W>, S.Set<ModelId>], S.Set<ModelId>>(([, s]) => s),
  );
}
