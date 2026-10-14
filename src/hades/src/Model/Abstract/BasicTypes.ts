// Ported from hades/src/Model/Abstract/BasicTypes.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The basic types that are required for any kind of model:
 *
 * * Packages
 *
 * * Queries
 *
 * * Matrices
 *
 * * Reports
 *
 * * Lookup Tables
 *
 * Although this is in the @Model.Abstract@ module hierarchy it isn't perfectly abstract; there are
 * references to the "HadesRender" monad dragged in by query diagrams and some GTK stuff for report
 * writing.
 *
 * TypeScript port
 * ---------------
 * * `ModelBasics<V>` is a tagged union (`BasicPackage(p)`, `BasicQuery(q)`, `BasicMatrix(m)`,
 *   `BasicReport(r)`, `BasicLookup(t)`, positional field `_0`). Derived `Eq` is structural `equals`.
 * * `class HasBasics v` is the dictionary interface `HasBasics<V>` (member
 *   `_Basics: Prism<V, ModelBasics<V>>`), extending `EntityClass<V>`, `HasReports<V>` and
 *   `HasLookups<V>`.
 * * The instances are `JSON_ModelBasics(cls)` and `Reflective_ModelBasics(cls)`, with
 *   `cls: QueryableEntityClass<V>` (the `(EntityClass v, Queryable v)` constraint). Both build their
 *   sub-dictionaries lazily on first use, and `reflectiveDefaults`, `reflectiveBuiltInRefs` and
 *   `reflectiveArrows` of `Reflective_ModelBasics` are memoised getters: the model dictionary
 *   (e.g. DSM's `SafetyModel`) usually calls these while it is itself being built, and the query
 *   default reads `cls.reflectiveDefaults` (see "Model.Query.Diagram"). Delegate to the getters;
 *   do not spread the dictionary at construction time.
 * * Prisms and `basicsName` are zero-argument generic functions (`_BasicPackage<V>()`, ...); the
 *   unused `EntityClass` constraint is an optional ignored dictionary argument, as for
 *   `packageName`. `basicsDiagramEntityTypes` is a constant.
 * * Constrained functions take the dictionary first, then (for scripts and model edits) the
 *   `ModelEditCtx`, then the Haskell arguments. Scripts (`ModelScript p v v (Maybe Text)`) are
 *   generator functions: `basicsActivation(cls, ctx, ent)`, `matrixEdit(cls, ctx, mId)`, ...
 *   Menus hold `ModelScriptAct` values.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import type { Text } from "@/lib/Data/Text";
import { Just, Nothing, fromMaybe, isJust, listToMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { absurd } from "@/lib/Prelude";
import * as J from "@/lib/Data/Aeson";
import {
  _Just, failing, ix, preview, prism, review, set, singular, to, view,
  type Lens, type Prism, type Traversal,
} from "@/lib/Control/Lens";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import { mempty_Diagram } from "@/hades/src/Hades/Abstract/Diagram";
import {
  DiagramEntity, ViewWrapper, cloneEntityMenuItem, deleteEntity, diagramEntityMenu, diagramEntityName,
  editEntityProperties, entityMenu, insertEntity, openDialog, openEditor, performIO, promoteScript,
  type DiagramEntityTypes, type Editable, type EntityWrapper, type HasDiagrams, type ModelScript,
  type ModelScriptAct,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  JSON_Package, Name, Package, Reflective_Package, current, currentName, entityContents, entityName,
  getModel, goToEntity, modifyValue, nameText, packageName, throwInternal, throwUser, withSubtype,
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { writeMatrixToFile, previewReport, writeReportToFile } from "@/hades/src/Model/GI/Export";
import {
  JSON_LookupTable, LookupTable, Reflective_LookupTable, lookupEditGadget, tableName,
  type HasLookups,
} from "@/hades/src/Model/Lookups/Base";
import {
  JSON_Matrix, Matrix, Reflective_Matrix, matrixDefaultInput, matrixName,
  type HasMatrices,
} from "@/hades/src/Model/Matrices/Base";
import { matrixDesignGadget } from "@/hades/src/Model/Matrices/Design";
import {
  matrixBook, matrixCells, matrixErrorsDialog, matrixExportDialog, matrixWarningsDialog,
} from "@/hades/src/Model/Matrices/Excel";
import { getMatrixWrapper } from "@/hades/src/Model/Matrices/Screen";
import {
  JSON_QueryDiagram, QueryDiagram, Reflective_QueryDiagram, queryActivation, queryDiagram,
  queryDiagramWrapper,
  type Queryable, type QueryableEntityClass,
} from "@/hades/src/Model/Query/Diagram";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import {
  append_RefTypeTable, mempty_RefTypeTable, refTypeTableCoerce,
  type RefTypeTable,
} from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { variantCoerce, type Variant } from "@/hades/src/Model/Reflection/Values";
import { JSON_Report, Report, Reflective_Report, reportName, runReport, type HasReports } from "@/hades/src/Model/Report/Base";
import {
  reportDesignGadget, reportFormat, reportRunDefault, reportRunDialog, reportTarget, reportWarningsDialog,
} from "@/hades/src/Model/Report/Dialogs";
import { accum, arr, constantDialog, gPipe, send, sendMap } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Menu, append_Menu, fmap_Menu, mconcat_Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";


/**
 * Class for types that include all the basic types managed here.
 *
 * This exists primarily to abbreviate the class context lists.
 */
export interface HasBasics<V> extends EntityClass<V>, HasReports<V>, HasLookups<V> {
  readonly _Basics: Prism<V, ModelBasics<V>>;
}


/**
 * All models need variants for Packages, Queries, Matrices and Reports.
 * This is a convenience type which implements the necessary instances for these variants.
 *
 * All model entity types should have "ToJSON" instances that include a @\"type\"@ field and
 * "FromJSON" instances that check the @\"type\"@ field.
 */
export type ModelBasics<V> =
  | { readonly tag: "BasicPackage"; readonly _0: Package<V> }
  | { readonly tag: "BasicQuery"; readonly _0: QueryDiagram<V> }
  | { readonly tag: "BasicMatrix"; readonly _0: Matrix }
  | { readonly tag: "BasicReport"; readonly _0: Report<V> }
  | { readonly tag: "BasicLookup"; readonly _0: LookupTable };

export function BasicPackage<V = any>(_0: Package<V>): ModelBasics<V> {
  return { tag: "BasicPackage", _0 };
}
export function BasicQuery<V = any>(_0: QueryDiagram<V>): ModelBasics<V> {
  return { tag: "BasicQuery", _0 };
}
export function BasicMatrix<V = any>(_0: Matrix): ModelBasics<V> {
  return { tag: "BasicMatrix", _0 };
}
export function BasicReport<V = any>(_0: Report<V>): ModelBasics<V> {
  return { tag: "BasicReport", _0 };
}
export function BasicLookup<V = any>(_0: LookupTable): ModelBasics<V> {
  return { tag: "BasicLookup", _0 };
}


/** Memoise a thunk (Haskell laziness for values built from a dictionary). */
function lazy<A>(f: () => A): () => A {
  let done = false;
  let v: A | undefined;
  return () => {
    if (!done) {
      v = f();
      done = true;
    }
    return v as A;
  };
}


/**
 * `instance (EntityClass v, Queryable v) => ToJSON (ModelBasics v)` and
 * `instance (EntityClass v, Queryable v) => FromJSON (ModelBasics v)`.
 */
export function JSON_ModelBasics<V>(cls: QueryableEntityClass<V>): J.JSONCodec<ModelBasics<V>> {
  const packageJ = lazy(() => JSON_Package<V>(cls));
  const queryJ = lazy(() => JSON_QueryDiagram<V>(cls));
  return J.codec(
    (b) => {
      switch (b.tag) {
        case "BasicPackage": return packageJ().toJSON(b._0);
        case "BasicQuery": return queryJ().toJSON(b._0);
        case "BasicMatrix": return JSON_Matrix.toJSON(b._0);
        case "BasicReport": return JSON_Report.toJSON(b._0);
        case "BasicLookup": return JSON_LookupTable.toJSON(b._0);
        default: return absurd(b);
      }
    },
    (v) => {
      const t = J.withObject("Model base types", (o) => J.fieldMaybe(o, "type", J.textJ), v);
          // V0.5 did not have "type" fields in every model entity.
      if (t.tag === "Nothing") return BasicQuery<V>(queryJ().parseJSON(v)); // Of the four types here, V0.5 only had queries.
      switch (t.value) {
        case "package": return BasicPackage<V>(packageJ().parseJSON(v));
        case "Query Diagram": return BasicQuery<V>(queryJ().parseJSON(v));
        case "matrix": return BasicMatrix<V>(JSON_Matrix.parseJSON(v));
        case "report": return BasicReport<V>(JSON_Report.parseJSON(v));
        case "lookup-table": return BasicLookup<V>(JSON_LookupTable.parseJSON(v));
        default: return J.fail("Unknown entity type: " + t.value);
      }
    },
  );
}


/**
 * `instance (EntityClass v, Queryable v) => Reflective (ModelBasics v)`
 *
 * TypeScript: the sub-dictionaries are built on first use, and `reflectiveDefaults`,
 * `reflectiveBuiltInRefs` and `reflectiveArrows` are memoised getters (see the module header).
 */
export function Reflective_ModelBasics<V>(cls: QueryableEntityClass<V>): Reflective<ModelBasics<V>> {
  const pkgR = lazy(() => Reflective_Package<V>(cls));
  const qdR = lazy(() => Reflective_QueryDiagram<V>(cls));
  const matR: Reflective<Matrix> = Reflective_Matrix;
  const rptR: Reflective<Report<V>> = Reflective_Report;
  const tblR: Reflective<LookupTable> = Reflective_LookupTable;
  const defaults = lazy((): readonly ModelBasics<V>[] => [
    ...pkgR().reflectiveDefaults.map((p) => BasicPackage<V>(p)),
    ...qdR().reflectiveDefaults.map((q) => BasicQuery<V>(q)),
    ...matR.reflectiveDefaults.map((m) => BasicMatrix<V>(m)),
    ...rptR.reflectiveDefaults.map((r) => BasicReport<V>(r)),
    ...tblR.reflectiveDefaults.map((t) => BasicLookup<V>(t)),
  ]);
  const builtInRefs = lazy((): RefTypeTable<ModelBasics<V>> =>
    [
      refTypeTableCoerce<Package<V>, ModelBasics<V>>(pkgR().reflectiveBuiltInRefs),
      refTypeTableCoerce<QueryDiagram<V>, ModelBasics<V>>(qdR().reflectiveBuiltInRefs),
      refTypeTableCoerce<Matrix, ModelBasics<V>>(matR.reflectiveBuiltInRefs),
      refTypeTableCoerce<Report<V>, ModelBasics<V>>(rptR.reflectiveBuiltInRefs),
      refTypeTableCoerce<LookupTable, ModelBasics<V>>(tblR.reflectiveBuiltInRefs),
    ].reduce(append_RefTypeTable, mempty_RefTypeTable as RefTypeTable<ModelBasics<V>>));
  type Arrows<A> = M.Map<Variant<A>, readonly [Relation, Relation]>;
  const arrows = lazy((): Arrows<ModelBasics<V>> =>
    M.unions<Variant<ModelBasics<V>>, readonly [Relation, Relation]>([
      M.mapKeys((k: Variant<Package<V>>) => variantCoerce<Package<V>, ModelBasics<V>>(k), pkgR().reflectiveArrows),
      M.mapKeys((k: Variant<QueryDiagram<V>>) => variantCoerce<QueryDiagram<V>, ModelBasics<V>>(k),
        qdR().reflectiveArrows),
      M.mapKeys((k: Variant<Matrix>) => variantCoerce<Matrix, ModelBasics<V>>(k), matR.reflectiveArrows),
      M.mapKeys((k: Variant<Report<V>>) => variantCoerce<Report<V>, ModelBasics<V>>(k), rptR.reflectiveArrows),
      M.mapKeys((k: Variant<LookupTable>) => variantCoerce<LookupTable, ModelBasics<V>>(k), tblR.reflectiveArrows),
    ]));
  return {
    reflectiveName: (b) => {
      switch (b.tag) {
        case "BasicPackage": return variantCoerce(pkgR().reflectiveName(b._0));
        case "BasicQuery": return variantCoerce(qdR().reflectiveName(b._0));
        case "BasicMatrix": return variantCoerce(matR.reflectiveName(b._0));
        case "BasicReport": return variantCoerce(rptR.reflectiveName(b._0));
        case "BasicLookup": return variantCoerce(tblR.reflectiveName(b._0));
        default: return absurd(b);
      }
    },
    variantUserLabel: defaultVariantUserLabel,
    get reflectiveDefaults(): readonly ModelBasics<V>[] {
      return defaults();
    },
    reflectiveBuiltIn: (b) => {
      switch (b.tag) {
        case "BasicPackage": return pkgR().reflectiveBuiltIn(b._0);
        case "BasicQuery": return qdR().reflectiveBuiltIn(b._0);
        case "BasicMatrix": return matR.reflectiveBuiltIn(b._0);
        case "BasicReport": return rptR.reflectiveBuiltIn(b._0);
        case "BasicLookup": return tblR.reflectiveBuiltIn(b._0);
        default: return absurd(b);
      }
    },
    reflectiveGet: (b) => {
      switch (b.tag) {
        case "BasicPackage": return pkgR().reflectiveGet(b._0);
        case "BasicQuery": return qdR().reflectiveGet(b._0);
        case "BasicMatrix": return matR.reflectiveGet(b._0);
        case "BasicReport": return rptR.reflectiveGet(b._0);
        case "BasicLookup": return tblR.reflectiveGet(b._0);
        default: return absurd(b);
      }
    },
    reflectiveSet: (st, b) => {
      switch (b.tag) {
        case "BasicPackage": return BasicPackage<V>(pkgR().reflectiveSet(st, b._0));
        case "BasicQuery": return BasicQuery<V>(qdR().reflectiveSet(st, b._0));
        case "BasicMatrix": return BasicMatrix<V>(matR.reflectiveSet(st, b._0));
        case "BasicReport": return BasicReport<V>(rptR.reflectiveSet(st, b._0));
        case "BasicLookup": return BasicLookup<V>(tblR.reflectiveSet(st, b._0));
        default: return absurd(b);
      }
    },
    get reflectiveBuiltInRefs(): RefTypeTable<ModelBasics<V>> {
      return builtInRefs();
    },
    get reflectiveArrows(): Arrows<ModelBasics<V>> {
      return arrows();
    },
  };
}


/** Lens for the name of any of the basic types. */
export function basicsName<V = any>(_cls?: EntityClass<V>): Lens<ModelBasics<V>, Name> {
  return singular<ModelBasics<V>, Name>(  // Safe because this covers all five possibilities.
    failing(
      failing(
        failing(
          failing(
            _BasicPackage<V>().dot(packageName<V>()),
            _BasicQuery<V>().dot(queryDiagram<V>()).dot(diagramEntityName())),
          _BasicMatrix<V>().dot(matrixName)),
        _BasicReport<V>().dot(reportName<V>())),
      _BasicLookup<V>().dot(tableName)));
}


export function basicsCanHaveChild<V>(_cls: EntityClass<V>, b: ModelBasics<V>): boolean {
  return b.tag === "BasicPackage";
}


export function _BasicPackage<V = any>(_cls?: EntityClass<V>): Prism<ModelBasics<V>, Package<V>> {
  return prism((p: Package<V>) => BasicPackage<V>(p),
    (v: ModelBasics<V>) => (v.tag === "BasicPackage" ? Right(v._0) : Left(v)));
}


export function _BasicQuery<V = any>(_cls?: EntityClass<V>): Prism<ModelBasics<V>, QueryDiagram<V>> {
  return prism((q: QueryDiagram<V>) => BasicQuery<V>(q),
    (v: ModelBasics<V>) => (v.tag === "BasicQuery" ? Right(v._0) : Left(v)));
}


export function _BasicMatrix<V = any>(_cls?: EntityClass<V>): Prism<ModelBasics<V>, Matrix> {
  return prism((m: Matrix) => BasicMatrix<V>(m),
    (v: ModelBasics<V>) => (v.tag === "BasicMatrix" ? Right(v._0) : Left(v)));
}


export function _BasicReport<V = any>(_cls?: EntityClass<V>): Prism<ModelBasics<V>, Report<V>> {
  return prism((rpt: Report<V>) => BasicReport<V>(rpt),
    (v: ModelBasics<V>) => (v.tag === "BasicReport" ? Right(v._0) : Left(v)));
}


export function _BasicLookup<V = any>(): Prism<ModelBasics<V>, LookupTable> {
  return prism((tbl: LookupTable) => BasicLookup<V>(tbl),
    (v: ModelBasics<V>) => (v.tag === "BasicLookup" ? Right(v._0) : Left(v)));
}


/** True if this is a query diagram. False otherwise. */
export function basicsIsDiagram<V>(_cls: EntityClass<V>, b: ModelBasics<V>): boolean {
  return b.tag === "BasicQuery";
}


/**
 * Wrapper for query digrams embedded in a "ModelBasics". All other values return @Nothing@.
 * (A `ModelEdit v (ModelBasics v)` action.)
 */
export function basicsDiagramWrapper<V>(
  cls: QueryableEntityClass<V>,
  ctx: ModelEditCtx<V, ModelBasics<V>>,
  ent: Entity<V>,
): Maybe<EntityWrapper<HadesRender, V>> {
  return withSubtype(ctx, _BasicQuery<V>(), (c) => queryDiagramWrapper(cls, c, ent));
}


/** Diagram entities for basic types. Empty because query diagrams do not display entities. */
export const basicsDiagramEntityTypes: DiagramEntityTypes<any> = M.empty();


/** The menu item type of the model tree menus: `ModelScript p v v (Maybe Text)`. */
type MenuScript<P, V> = ModelScriptAct<P, V, V, Maybe<Text>>;


export function rootMenu<P, V>(
  cls: HasBasics<V>,
  prsm: Prism<V, ModelBasics<V>>,
  /** Application actions, such as adding new entities and diagrams. */
  appMenu: Menu<MenuScript<P, V>>,
): Menu<MenuScript<P, V>> {
  return packageMenu1<P, V>(cls, prsm, appMenu, U.nil);
}


/** Context menu for packages in the model tree. */
export function packageMenu<P, V>(
  cls: HasBasics<V>,
  prsm: Traversal<V, ModelBasics<V>>,
  /** Application actions, such as adding new entities and diagrams. */
  appMenu: Menu<MenuScript<P, V>>,
  uuid: ModelId,
): Menu<MenuScript<P, V>> {
  return mconcat_Menu<MenuScript<P, V>>([
    Menu<MenuScript<P, V>>([[
      menuItem<MenuScript<P, V>>("Properties", (ctx) => editEntityProperties<P, V, V>(ctx, uuid)),
    ]]),
    packageMenu1<P, V>(cls, prsm, appMenu, uuid),
    Menu<MenuScript<P, V>>([[
      cloneEntityMenuItem<P, V, V>(uuid),
      menuItem<MenuScript<P, V>>("Delete", (ctx) => deleteEntity<P, V, V>(ctx, uuid)),
    ]]),
  ]);
}


/** The dictionary for `(Editable HadesRender v, HasBasics v, HasDiagrams HadesRender v)`. */
export type BasicsEditableClass<V> = Editable<HadesRender, V> & HasBasics<V> & HasDiagrams<HadesRender, V>;


/** Menu for one of the built-in basic items in the application model tree. */
export function basicsMenu<V>(
  cls: BasicsEditableClass<V>,
  prsm: Prism<V, ModelBasics<V>>,
  /** Application menu. */
  appMenu: Menu<MenuScript<HadesRender, V>>,
  ent: Entity<V>,
): Menu<MenuScript<HadesRender, V>> {
  type Item = MenuScript<HadesRender, V>;
  const b = preview(entityContents<V>().dot(prsm), ent);
  if (b.tag === "Nothing") return Menu<Item>([[]]);  // Only occurs if the application calls this on the wrong variant.
  const mId = ent.entityId;
  switch (b.value.tag) {
    case "BasicPackage":
      return packageMenu<HadesRender, V>(cls, prsm, appMenu, mId);
    case "BasicQuery":
      return fmap_Menu(
        (s: ModelScriptAct<HadesRender, V, QueryDiagram<V>, Maybe<Text>>) => promoteScript(cls._QueryDiagram, s),
        diagramEntityMenu<HadesRender, V, QueryDiagram<V>>(cls, mId));
    case "BasicMatrix":
      return append_Menu(
        Menu<Item>([[
          menuItem<Item>("Run Matrix", (ctx) => matrixRun<HadesRender, V>(cls, ctx, mId)),
          menuItem<Item>("Edit Matrix", (ctx) => matrixEdit<HadesRender, V>(cls, ctx, mId)),
          menuItem<Item>("Export to Excel", (ctx) => matrixExport<HadesRender, V>(cls, ctx, mId)),
        ]]),
        entityMenu<HadesRender, V, V>(cls, ent));
    case "BasicReport":
      return append_Menu(
        Menu<Item>([[
          menuItem<Item>("Preview Report", (ctx) => reportPreview<HadesRender, V>(cls, ctx, mId)),
          menuItem<Item>("Write to File", (ctx) => reportRun<HadesRender, V>(cls, ctx, mId)),
          menuItem<Item>("Edit Report", (ctx) => reportEdit<HadesRender, V>(cls, ctx, prsm, mId)),
        ]]),
        entityMenu<HadesRender, V, V>(cls, ent));
    case "BasicLookup":
      return append_Menu(
        Menu<Item>([[
          menuItem<Item>("Edit Lookup Table", (ctx) => lookupEdit<HadesRender, V>(cls, ctx, mId)),
        ]]),
        entityMenu<HadesRender, V, V>(cls, ent));
    default:
      return absurd(b.value);
  }
}



/** Activation for one of the built-in basic items in the application model tree. */
export function* basicsActivation<V>(
  cls: BasicsEditableClass<V>,
  ctx: ModelEditCtx<V, V>,
  ent: Entity<V>,
): ModelScript<HadesRender, V, Maybe<Text>> {
  const b = preview(entityContents<V>().dot(cls._Basics), ent);
  if (b.tag === "Nothing") return Nothing;  // Only occurs if the application calls this on the wrong variant.
  switch (b.value.tag) {
    case "BasicPackage": return yield* editEntityProperties<HadesRender, V, V>(ctx, ent.entityId);
    case "BasicQuery":
      return yield* promoteScript<HadesRender, V, V, QueryDiagram<V>, Maybe<Text>>(
        cls._QueryDiagram, (c) => queryActivation(cls, c, ent))(ctx);
    case "BasicMatrix": return yield* matrixRun<HadesRender, V>(cls, ctx, ent.entityId);
    case "BasicReport": return yield* reportPreview<HadesRender, V>(cls, ctx, ent.entityId);
    case "BasicLookup": return yield* lookupEdit<HadesRender, V>(cls, ctx, ent.entityId);
    default: return absurd(b.value);
  }
}


/** Icon name for each variant. */
export function basicsIcon<V>(_cls: EntityClass<V>, b: ModelBasics<V>): Text {
  switch (b.tag) {
    case "BasicPackage": return "model-package";
    case "BasicQuery": return "model-query";
    case "BasicMatrix": return "model-matrix";
    case "BasicReport": return "model-report";
    case "BasicLookup": return "model-lookup";
    default: return absurd(b);
  }
}



/**
 * Internal function. Context menu for packages in the model tree, but without the "Delete"
 * option. Can also be used as the menu for the root.
 *
 * (TypeScript: the `where`-bound template values are built when the menu item runs, as the
 * lazy Haskell values would be.)
 */
export function packageMenu1<P, V>(
  cls: HasBasics<V>,
  prsm: Traversal<V, ModelBasics<V>>,
  /** Application actions, such as adding new entities and diagrams. */
  appMenu: Menu<MenuScript<P, V>>,
  uuid: ModelId,
): Menu<MenuScript<P, V>> {
  type Inner = ModelScriptAct<P, V, ModelBasics<V>, Maybe<Text>>;
  const promote = (s: Inner): MenuScript<P, V> => promoteScript(prsm, s);
  const basicPackage = (): V => review(cls._Package, Package<V>(Name("Package "), cls.packageMetaMempty));
  const everything = () => S.fromList(cls.reflectiveDefaults.map((v) => cls.reflectiveName(v)));
  const basicQuery = (): V => review(cls._QueryDiagram,
    QueryDiagram<V>(
      DiagramEntity<any, null>(Name("Query "), mempty_Diagram(), null),
      everything(),
      ""));
  const basicMatrix = (): V => review(cls._Matrix, Matrix(Name("Matrix "), "", S.empty(), []));
  const basicReport = (): V => review(cls._Report, Report<V>(Name("Report "), "", Nothing, Nothing, []));
  const basicLookup = (): V =>
    review(cls._LookupTable, LookupTable(Name("Lookup "), U.nil, U.nil, U.nil, M.empty()));
  /** The common shape of the "Add ..." menu items. */
  const addItem = (label: string, what: string, template: () => V) =>
    menuItem<Inner>(label, function* (ctx) {
      goToEntity(ctx, uuid);
      const parentName = currentName(ctx);
      const r = yield* insertEntity<P, V, ModelBasics<V>>(ctx, template(), uuid);
      if (r.tag === "Nothing") return Nothing;
      const [newName] = r.value;
      return Just("Added " + what + " " + view(nameText, newName) + " to " + parentName);
    });
  return mconcat_Menu<MenuScript<P, V>>([
    fmap_Menu(promote, Menu<Inner>([[
      addItem("Add package", "package", basicPackage),
    ]])),
    appMenu,
    fmap_Menu(promote, Menu<Inner>([[
      addItem("Add query", "query", basicQuery),
      addItem("Add matrix", "matrix", basicMatrix),
      addItem("Add report", "report", basicReport),
      addItem("Add lookup table", "lookup table", basicLookup),
    ]])),
  ]);
}


/** The dictionary for `(EntityClass v, HasLookups v, HasMatrices v, Queryable v)`. */
export type MatrixEditClass<V> = EntityClass<V> & HasLookups<V> & HasMatrices<V> & Queryable<V>;


/**
 * Open a matrix for editing in a diagram window. Returns "Nothing" to indicate that merely
 * opening the matrix does not change anything.
 */
export function* matrixEdit<P, V>(
  cls: MatrixEditClass<V>,
  ctx: ModelEditCtx<V, V>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  yield* openEditor<P, V, V>(ctx, ViewWrapper<P, V, Matrix, null>(
    mId,
    "edit",
    null,
    Right((m: Model<V>) => preview(
      to((m1: Model<V>) => m1.modelContents).dot(ix<ModelId, Entity<V>>(mId)).dot(entityContents<V>()).dot(cls._Matrix),
      m)),
    sendMap(
      (e: (c: ModelEditCtx<V, Matrix>) => Maybe<Text>) =>
        Just<MenuScript<P, V>>(function* (c: ModelEditCtx<V, V>): ModelScript<P, V, Maybe<Text>> {
          return withSubtype(c, cls._Matrix, e);
        }),
      matrixDesignGadget(cls, mId)),
  ));
  return Nothing;
}


export function* matrixRun<P, V>(
  cls: Editable<P, V> & EntityClass<V> & HasMatrices<V> & HasLookups<V>,
  ctx: ModelEditCtx<V, V>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  goToEntity(ctx, mId);
  const cur = current(ctx);
  if (cur.tag === "Nothing") {
    throwUser(ctx, "Matrix has been deleted.");
  } else {
    const ent = cur.value;
    const w = getMatrixWrapper<P, V>(cls, ctx, ent);
    if (w.tag === "Just") yield* openEditor<P, V, V>(ctx, w.value);
    else throwInternal(ctx, view(entityName(cls).dot(nameText), ent) + ": Not a matrix");
  }
  return Nothing;  // Opening a matrix in a window has no effect in itself.
}


/** Export the output of a matrix to an Excel spreadsheet. */
export function* matrixExport<P, V>(
  cls: EntityClass<V> & HasLookups<V> & HasMatrices<V>,
  ctx: ModelEditCtx<V, V>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  const model = getModel(ctx);
  goToEntity(ctx, mId);
  const nm = currentName(ctx);
  const mat = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Matrix), current(ctx));
  if (mat.tag === "Just") {
    const matrix = mat.value;
    const r = yield* openDialog<P, V, V, S.Set<ModelId>>(
      ctx,
      constantDialog(matrixExportDialog(cls, model, matrix)),
      view(matrixDefaultInput, matrix));
    if (r.tag === "Nothing") return Nothing;
    const targetSet = r.value;
    const targetId = fromMaybe(U.nil, S.lookupMin(targetSet));
    goToEntity(ctx, targetId);
    const targetName = currentName(ctx);
    const title = nm + " - " + targetName;
    const cellsE = matrixCells(cls, model, targetId, matrix);
    if (cellsE.tag === "Left") {
      yield* openDialog<P, V, V, null>(ctx, constantDialog(matrixErrorsDialog<Model<V>, null>(cellsE.value)), null);
      return Nothing;
    }
    const [cells, warns] = cellsE.value;
    const goAhead = warns.length === 0
      ? true
      : isJust(yield* openDialog<P, V, V, null>(
        ctx,
        constantDialog(matrixWarningsDialog<Model<V>, null>(warns)),
        null));
    // The book is built inside the IO action, where the Haskell evaluated it lazily.
    if (goAhead) yield* performIO<P, V, V, void>(ctx, () => writeMatrixToFile(matrixBook(cls, model, matrix, title, cells)));
    return Nothing;
  }
  return throwInternal(ctx, nm + " is not a matrix: cannot export it.");
}


export function* reportEdit<P, V>(
  cls: EntityClass<V> & HasLookups<V> & HasMatrices<V> & HasDiagrams<HadesRender, V>,
  ctx: ModelEditCtx<V, V>,
  prsm: Prism<V, ModelBasics<V>>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  yield* openEditor<P, V, V>(ctx, ViewWrapper<P, V, Report<V>, null>(
    mId,
    "edit",
    null,
    Right((m: Model<V>) => preview(
      to((m1: Model<V>) => m1.modelContents).dot(ix<ModelId, Entity<V>>(mId)).dot(entityContents<V>())
        .dot(prsm).dot(_BasicReport<V>()),
      m)),
    sendMap(
      (e: (c: ModelEditCtx<V, Report<V>>) => Maybe<Text>) =>
        Just<MenuScript<P, V>>(function* (c: ModelEditCtx<V, V>): ModelScript<P, V, Maybe<Text>> {
          return withSubtype(c, prsm.dot(_BasicReport<V>()), e);
        }),
      reportDesignGadget(cls, mId)),
  ));
  return Nothing;
}


/** The dictionary for `(EntityClass v, HasLookups v, HasMatrices v, HasReports v, HasDiagrams HadesRender v)`. */
export type ReportRunClass<V> = EntityClass<V> & HasLookups<V> & HasMatrices<V> & HasReports<V> & HasDiagrams<HadesRender, V>;


export function* reportPreview<P, V>(
  cls: ReportRunClass<V>,
  ctx: ModelEditCtx<V, V>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  goToEntity(ctx, mId);
  const rptM = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Report), current(ctx));
  if (rptM.tag === "Just") {
    const rpt = rptM.value;
    const model = getModel(ctx);
    const r = yield* openDialog<P, V, V, ReturnType<typeof reportRunDefault>>(
      ctx, constantDialog(reportRunDialog(cls, true, rpt)), reportRunDefault(rpt));
    if (r.tag === "Nothing") return Nothing;
    const params = r.value;
    const tgtId = fromMaybe(U.nil, listToMaybe(S.toList(view(reportTarget, params))));
    goToEntity(ctx, tgtId);
    const targetName = currentName(ctx);
    const title = view(reportName<V>().dot(nameText), rpt) + ": " + targetName;
    const [blks, imgs, warns] = runReport(cls, ctx, rpt, tgtId);
    const goAhead = warns.length === 0
      ? true
      : isJust(yield* openDialog<P, V, V, null>(ctx, constantDialog(reportWarningsDialog(cls, warns)), null));
    if (goAhead) yield* performIO<P, V, V, void>(ctx, () => previewReport(cls, model, title, blks, imgs));
    return Nothing;
  }
  return throwInternal(ctx, "Report has disappeared: cannot preview it.");
}


export function* reportRun<P, V>(
  cls: ReportRunClass<V>,
  ctx: ModelEditCtx<V, V>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  goToEntity(ctx, mId);
  const rptM = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(cls._Report), current(ctx));
  if (rptM.tag === "Just") {
    const rpt = rptM.value;
    const model = getModel(ctx);
    const r = yield* openDialog<P, V, V, ReturnType<typeof reportRunDefault>>(
      ctx, constantDialog(reportRunDialog(cls, false, rpt)), reportRunDefault(rpt));
    if (r.tag === "Nothing") return Nothing;
    const params = r.value;
    const targetId = fromMaybe(U.nil, listToMaybe(S.toList(view(reportTarget, params))));
    goToEntity(ctx, targetId);
    const targetName = currentName(ctx);
    const title = view(reportName<V>().dot(nameText), rpt) + ": " + targetName;
    const [blks, imgs, warns] = runReport(cls, ctx, rpt, targetId);
    const goAhead = warns.length === 0
      ? true
      : isJust(yield* openDialog<P, V, V, null>(ctx, constantDialog(reportWarningsDialog(cls, warns)), null));
    if (goAhead) {
      yield* performIO<P, V, V, void>(ctx, () =>
        writeReportToFile(cls, view(reportFormat, params), title, model, blks, imgs));
    }
    return Nothing;
  }
  return throwInternal(ctx, "Report has disappeared: cannot run it.");
}


export function* lookupEdit<P, V>(
  cls: EntityClass<V> & HasLookups<V> & HasDiagrams<HadesRender, V>,
  ctx: ModelEditCtx<V, V>,
  mId: ModelId,
): ModelScript<P, V, Maybe<Text>> {
  const changeModel = (update: LookupTable): Maybe<MenuScript<P, V>> =>
    Just(function* (c: ModelEditCtx<V, V>): ModelScript<P, V, Maybe<Text>> {
      goToEntity(c, mId);
      const nm = currentName(c);
      const b = modifyValue(c, (v: V) => set(cls._LookupTable, update, v));
      return b ? Just("Modified " + nm) : Nothing;
    });
  yield* openEditor<P, V, V>(ctx, ViewWrapper<P, V, LookupTable, null>(
    mId,
    "edit",
    null,
    Right((m: Model<V>) => preview(
      to((m1: Model<V>) => m1.modelContents).dot(ix<ModelId, Entity<V>>(mId)).dot(entityContents<V>())
        .dot(cls._LookupTable),
      m)),
    // proc ((), tbl1) -> do
    //   tbl2 <- send changeModel <<< accum lookupEditGadget -< tbl1
    //   returnA -< ((), tbl2)
    gPipe(
      arr(([, tbl1]: [null, LookupTable]) => tbl1),
      accum(lookupEditGadget<V, MenuScript<P, V>>(cls)),
      send<Model<V>, MenuScript<P, V>, LookupTable>(changeModel),
      arr((tbl2: LookupTable): [null, LookupTable] => [null, tbl2]),
    ),
  ));
  return Nothing;
}
