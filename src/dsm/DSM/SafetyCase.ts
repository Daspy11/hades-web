/**
 * The DSM safety case model: the top level model entity type `SafetyModel` and its instances.
 *
 * The top level model entities in model are GSN Items, Causal items, and query diagrams.
 *
 * TypeScript representation (see PORTING.md §3, §4 and porting-notes/cm.md, cr.md, gsn.md, bt.md):
 *
 * * `SafetyModel` is a tagged union with the Haskell constructor names (`GsnItem`, `CausalItem`,
 *   `BowTieItem`, `BasicItem`, `EvidenceItem`, `TraceItem`) and positional field `_0`. The
 *   constructor functions have the same names, so the GSN, causal and bow tie modules are
 *   imported qualified (their type names clash).
 * * All the single-dictionary instances of `SafetyModel` (`Reflective`, `EntityClass`, `Editable`,
 *   `Queryable`, `HasMatrices`, `HasReports`, `HasBowTie`, `HasCausal`, `HasLookups`, `HasBasics`,
 *   `HasDiagrams`, `HasEvidence`, `HasGsn`, `ToJSON`/`FromJSON`) are members of one dictionary
 *   object, `safetyModelClass` (also exported under the `ClassName_SafetyModel` names).
 * * Haskell has three `AppearanceClass t SafetyModel` instances, one per diagram type, but a
 *   dictionary has a single `getDiagramAppearance` member. So each is a dictionary that inherits
 *   everything else from `safetyModelClass` (`Object.create`):
 *   `AppearanceClass_GsnDiagramType_SafetyModel`, `AppearanceClass_CausalType_SafetyModel` and
 *   `AppearanceClass_BowTieType_SafetyModel`. They are the dictionaries passed to the GSN,
 *   causal and bow tie modules respectively. `safetyModelClass` itself has the GSN instance's
 *   `getDiagramAppearance` (the dictionary types of those modules require one); nothing relies
 *   on it.
 * * The members that delegate to the sub-type instances build those dictionaries on first use,
 *   and `reflectiveDefaults`, `reflectiveBuiltInRefs`, `reflectiveArrows`, `entityFunctions` and
 *   `diagramEntityTypes` are memoised getters (Haskell laziness): the sub-type dictionaries take
 *   this dictionary as an argument, and the query diagram default reads `reflectiveDefaults` of
 *   the whole model (porting-notes/q1.md, bt.md).
 * * `ModelScript` values are `ModelScriptAct`s (PORTING.md §7.5); `EntityMenu` and
 *   `ActivationScript` are functions of `Maybe<Entity<SafetyModel>>`.
 */
// Ported from dsm/DSM/SafetyCase.hs. Copyright © Paul Johnson. See LICENSE.

import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import { absurd } from "@/lib/Prelude";
import { Just, Nothing, type Maybe, mapMaybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import {
  type Lens, type Prism, failing, over, prism, singular, view,
} from "@/lib/Control/Lens";
import { Menu, append_Menu, fmap_Menu, mconcat_Menu, mempty_Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { constantDialog } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { diagramContents, diagramList } from "@/hades/src/Hades/Abstract/Diagram";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import {
  type AppearanceClass, type PackageAppearance, JSON_PackageAppearance, clonePackageAppearance,
  coerceDiagramAppearance, mempty_DiagramAppearance, packageAppearanceClean, packageAppearanceDialog,
} from "@/hades/src/App/Appearance";
import { Avatar_Element, elementMapAvatars } from "@/hades/src/App/GenericDiagram";
import { causalDiagramVariant, bowTieDiagramVariant, bowTieRiskEventVariant } from "@/dsm/causality/Causality/FieldNames";
import * as Causal from "@/dsm/causality/Causality/Model";
import * as Risk from "@/dsm/causality/Causality/Risk";
import {
  type Evidence, type HasEvidence, type Trace, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace,
  addEvidenceEntityMenu, evidenceActivation, evidenceEntityMenu, evidenceIconName, evidenceName, traceActivation,
  traceEntityMenu, traceIconName, traceName,
} from "@/hades/evidence/Evidence/Model";
import { gsnDiagramVariant } from "@/dsm/gsn/GSN/FieldNames";
import * as GSN from "@/dsm/gsn/GSN/Model";
import {
  type BasicsEditableClass, type HasBasics, type ModelBasics, BasicPackage, BasicQuery, JSON_ModelBasics,
  Reflective_ModelBasics, _BasicLookup, _BasicMatrix, _BasicPackage, _BasicQuery, _BasicReport,
  basicsActivation, basicsCanHaveChild, basicsDiagramEntityTypes, basicsDiagramWrapper, basicsIcon,
  basicsIsDiagram, basicsMenu, basicsName, rootMenu,
} from "@/hades/src/Model/Abstract/BasicTypes";
import {
  type ActivationScript, type DiagramEntityTypes, type Editable, type EntityMenu, type HasDiagrams,
  type ModelScript, type ModelScriptAct, clonePackage, diagramEntityContents, editEntityProperties,
  openDialog, openDiagram, promoteScript, setModelSelection,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type ModelEditCtx, type ModelId, Name, Package, currentName, entityContents,
  getMeta, goToEntity, nameText, setMeta, throwUser, unsafeEntityClone, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import { type HasLookups, tableFunctions } from "@/hades/src/Model/Lookups/Base";
import type { HasMatrices } from "@/hades/src/Model/Matrices/Base";
import type { QueryDiagram, Queryable } from "@/hades/src/Model/Query/Diagram";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import {
  type RefTypeTable, append_RefTypeTable, mempty_RefTypeTable, refTypeTableCoerce,
} from "@/hades/src/Model/Reflection/References";
import type { Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { type Variant, variantCoerce } from "@/hades/src/Model/Reflection/Values";
import type { HasReports } from "@/hades/src/Model/Report/Base";
import type { Matrix } from "@/hades/src/Model/Matrices/Base";


// The top level model entities in model are GSN Items, Causal items, and query diagrams.
export type SafetyModel =
  | { readonly tag: "GsnItem"; readonly _0: GSN.GsnItem<SafetyModel> }
  | { readonly tag: "CausalItem"; readonly _0: Causal.Causal<SafetyModel> }
  | { readonly tag: "BowTieItem"; readonly _0: Risk.BowTie<SafetyModel> }
  | { readonly tag: "BasicItem"; readonly _0: ModelBasics<SafetyModel> }
  | { readonly tag: "EvidenceItem"; readonly _0: Evidence }
  | { readonly tag: "TraceItem"; readonly _0: Trace };

export function GsnItem(_0: GSN.GsnItem<SafetyModel>): SafetyModel {
  return { tag: "GsnItem", _0 };
}
export function CausalItem(_0: Causal.Causal<SafetyModel>): SafetyModel {
  return { tag: "CausalItem", _0 };
}
export function BowTieItem(_0: Risk.BowTie<SafetyModel>): SafetyModel {
  return { tag: "BowTieItem", _0 };
}
export function BasicItem(_0: ModelBasics<SafetyModel>): SafetyModel {
  return { tag: "BasicItem", _0 };
}
export function EvidenceItem(_0: Evidence): SafetyModel {
  return { tag: "EvidenceItem", _0 };
}
export function TraceItem(_0: Trace): SafetyModel {
  return { tag: "TraceItem", _0 };
}

/**
 * The derived `Eq SafetyModel`. (The sub-types' own `Eq` instances compare diagrams with
 * `eq_DiagramEntity`; evidence, traces and the basic types are compared structurally.)
 */
export function eq_SafetyModel(x: SafetyModel, y: SafetyModel): boolean {
  switch (x.tag) {
    case "GsnItem": return y.tag === "GsnItem" && GSN.eq_GsnItem(x._0, y._0);
    case "CausalItem": return y.tag === "CausalItem" && Causal.eq_Causal(x._0, y._0);
    case "BowTieItem": return y.tag === "BowTieItem" && Risk.eq_BowTie(x._0, y._0);
    case "BasicItem": return y.tag === "BasicItem" && equals(x._0, y._0);
    case "EvidenceItem": return y.tag === "EvidenceItem" && equals(x._0, y._0);
    case "TraceItem": return y.tag === "TraceItem" && equals(x._0, y._0);
    default: return absurd(x);
  }
}

/** The package metadata of the safety model: `type PackageMeta SafetyModel = PackageAppearance SafetyModel`. */
export type SafetyPackageMeta = PackageAppearance<SafetyModel>;


// TypeScript: the prisms are defined before the instance dictionary, which refers to them as
// values (in Haskell they follow the instances).

export const _GsnItem: Prism<SafetyModel, GSN.GsnItem<SafetyModel>> =
  prism(GsnItem, (v: SafetyModel) => (v.tag === "GsnItem" ? Right(v._0) : Left(v)));

export const _CausalItem: Prism<SafetyModel, Causal.Causal<SafetyModel>> =
  prism(CausalItem, (v: SafetyModel) => (v.tag === "CausalItem" ? Right(v._0) : Left(v)));

export const _BowTieItem: Prism<SafetyModel, Risk.BowTie<SafetyModel>> =
  prism(BowTieItem, (v: SafetyModel) => (v.tag === "BowTieItem" ? Right(v._0) : Left(v)));

export const _BasicItem: Prism<SafetyModel, ModelBasics<SafetyModel>> =
  prism(BasicItem, (v: SafetyModel) => (v.tag === "BasicItem" ? Right(v._0) : Left(v)));

export const _EvidenceItem: Prism<SafetyModel, Evidence> =
  prism(EvidenceItem, (v: SafetyModel) => (v.tag === "EvidenceItem" ? Right(v._0) : Left(v)));

export const _TraceItem: Prism<SafetyModel, Trace> =
  prism(TraceItem, (v: SafetyModel) => (v.tag === "TraceItem" ? Right(v._0) : Left(v)));

export const _ModelPackage: Prism<SafetyModel, Package<SafetyModel, SafetyPackageMeta>> =
  _BasicItem.dot(_BasicPackage<SafetyModel>()) as Prism<SafetyModel, Package<SafetyModel, SafetyPackageMeta>>;

export const _ModelQuery: Prism<SafetyModel, QueryDiagram<SafetyModel>> = _BasicItem.dot(_BasicQuery<SafetyModel>());

export const _ModelMatrix: Prism<SafetyModel, Matrix> = _BasicItem.dot(_BasicMatrix<SafetyModel>());


/**
 * The dictionary type of `safetyModelClass`: every single-dictionary instance of `SafetyModel`.
 * The `AppearanceClass` member is that of GSN diagrams (see the module header).
 */
export type SafetyModelClass =
  Reflective<SafetyModel> & EntityClass<SafetyModel, SafetyPackageMeta> & Editable<HadesRender, SafetyModel> &
  Queryable<SafetyModel> & HasMatrices<SafetyModel> & HasReports<SafetyModel> & Risk.HasBowTie<SafetyModel> &
  Causal.HasCausal<SafetyModel> & HasLookups<SafetyModel> & HasBasics<SafetyModel> &
  HasDiagrams<HadesRender, SafetyModel, SafetyPackageMeta> & HasEvidence<SafetyModel, SafetyPackageMeta> &
  GSN.HasGsn<SafetyModel> & AppearanceClass<GSN.GsnDiagramType<SafetyModel>, SafetyModel, SafetyPackageMeta> &
  BasicsEditableClass<SafetyModel>;


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

// The sub-type instances, built on first use (they take the SafetyModel dictionaries).
const gsnR = lazy(() => GSN.Reflective_GsnItem<SafetyModel>(AppearanceClass_GsnDiagramType_SafetyModel));
const causalR = lazy(() => Causal.Reflective_Causal<SafetyModel>(safetyModelClass));
const bowTieR = lazy(() => Risk.Reflective_BowTie<SafetyModel>());
const basicsR = lazy(() => Reflective_ModelBasics<SafetyModel>(safetyModelClass));
const gsnJ = lazy(() => GSN.JSON_GsnItem<SafetyModel>(AppearanceClass_GsnDiagramType_SafetyModel));
const causalJ = lazy(() => Causal.JSON_Causal<SafetyModel>(AppearanceClass_CausalType_SafetyModel));
const bowTieJ = lazy(() => Risk.JSON_BowTie<SafetyModel>(AppearanceClass_BowTieType_SafetyModel));
const basicsJ = lazy(() => JSON_ModelBasics<SafetyModel>(safetyModelClass));

type Arrows<A> = M.Map<Variant<A>, readonly [Relation, Relation]>;

// instance Reflective SafetyModel
const reflectiveDefaults = lazy((): readonly SafetyModel[] => [
  ...gsnR().reflectiveDefaults.map(GsnItem),
  ...bowTieR().reflectiveDefaults.map(BowTieItem),
  ...basicsR().reflectiveDefaults.map(BasicItem),
  ...Reflective_Evidence.reflectiveDefaults.map(EvidenceItem),
  ...Reflective_Trace.reflectiveDefaults.map(TraceItem),
]);

const reflectiveBuiltInRefs = lazy((): RefTypeTable<SafetyModel> =>
  [
    refTypeTableCoerce<GSN.GsnItem<SafetyModel>, SafetyModel>(gsnR().reflectiveBuiltInRefs),
    refTypeTableCoerce<Risk.BowTie<SafetyModel>, SafetyModel>(bowTieR().reflectiveBuiltInRefs),
    refTypeTableCoerce<ModelBasics<SafetyModel>, SafetyModel>(basicsR().reflectiveBuiltInRefs),
    refTypeTableCoerce<Evidence, SafetyModel>(Reflective_Evidence.reflectiveBuiltInRefs),
    refTypeTableCoerce<Trace, SafetyModel>(Reflective_Trace.reflectiveBuiltInRefs),
  ].reduceRight((acc, t) => append_RefTypeTable(t, acc), mempty_RefTypeTable as RefTypeTable<SafetyModel>));

const reflectiveArrows = lazy((): Arrows<SafetyModel> =>
  M.unions<Variant<SafetyModel>, readonly [Relation, Relation]>([
    M.mapKeys((k: Variant<GSN.GsnItem<SafetyModel>>) => variantCoerce<GSN.GsnItem<SafetyModel>, SafetyModel>(k),
      gsnR().reflectiveArrows),
    M.mapKeys((k: Variant<Risk.BowTie<SafetyModel>>) => variantCoerce<Risk.BowTie<SafetyModel>, SafetyModel>(k),
      bowTieR().reflectiveArrows),
    M.mapKeys((k: Variant<ModelBasics<SafetyModel>>) => variantCoerce<ModelBasics<SafetyModel>, SafetyModel>(k),
      basicsR().reflectiveArrows),
    M.mapKeys((k: Variant<Evidence>) => variantCoerce<Evidence, SafetyModel>(k), Reflective_Evidence.reflectiveArrows),
    M.mapKeys((k: Variant<Trace>) => variantCoerce<Trace, SafetyModel>(k), Reflective_Trace.reflectiveArrows),
  ]));

// instance EntityClass SafetyModel: name
const safetyModelName = lazy((): Lens<SafetyModel, Name> =>
  singular<SafetyModel, Name>(  // Safe because this covers all 6 possibilities.
    failing(
      failing(
        failing(
          failing(
            failing(
              _BowTieItem.dot(Risk.bowTieName<SafetyModel>()),
              _CausalItem.dot(Causal.causalName<SafetyModel>())),
            _GsnItem.dot(GSN.gsnItemName<SafetyModel>())),
          _BasicItem.dot(basicsName<SafetyModel>())),
        _EvidenceItem.dot(evidenceName)),
      _TraceItem.dot(traceName))));

const entityFunctions = lazy(() => tableFunctions<SafetyModel>(safetyModelClass));

// instance HasDiagrams HadesRender SafetyModel: diagramEntityTypes
const diagramEntityTypes = lazy((): DiagramEntityTypes<SafetyModel> =>
  [
    GSN.gsnDiagramEntityTypes<SafetyModel>(),
    Risk.riskDiagramEntityTypes as DiagramEntityTypes<SafetyModel>,
    basicsDiagramEntityTypes as DiagramEntityTypes<SafetyModel>,
  ].reduceRight((acc, m) => M.union(m, acc), M.empty() as DiagramEntityTypes<SafetyModel>));

// The `Avatar` dictionaries of the elements of GSN and bow tie diagrams (for `ascendedId`).
const gsnElementCls = lazy(() =>
  Avatar_Element(GSN.DiagramTypeClass_GsnDiagramType<SafetyModel>(AppearanceClass_GsnDiagramType_SafetyModel)));
const bowTieElementCls = lazy(() =>
  Avatar_Element(Risk.DiagramTypeClass_BowTieType<SafetyModel>(AppearanceClass_BowTieType_SafetyModel)));


/**
 * The instances of `SafetyModel`: `Reflective`, `EntityClass` (with `PackageMeta SafetyModel =
 * PackageAppearance SafetyModel`), `Editable HadesRender`, `Queryable`, `HasMatrices`,
 * `HasReports`, `HasBowTie`, `HasCausal`, `HasLookups`, `HasBasics`, `HasDiagrams HadesRender`,
 * `HasEvidence`, `HasGsn`, `ToJSON` and `FromJSON` (as `entityJ`).
 */
export const safetyModelClass: SafetyModelClass = {
  // instance Reflective SafetyModel
  reflectiveName: (v) => {
    switch (v.tag) {
      case "GsnItem": return variantCoerce(gsnR().reflectiveName(v._0));
      case "CausalItem": return variantCoerce(causalR().reflectiveName(v._0));
      case "BowTieItem": return variantCoerce(bowTieR().reflectiveName(v._0));
      case "BasicItem": return variantCoerce(basicsR().reflectiveName(v._0));
      case "EvidenceItem": return variantCoerce(Reflective_Evidence.reflectiveName(v._0));
      case "TraceItem": return variantCoerce(Reflective_Trace.reflectiveName(v._0));
      default: return absurd(v);
    }
  },
  variantUserLabel: (v) => {
    if (v === bowTieRiskEventVariant) return "Event";
    return v;  // v ^. variantName
  },
  get reflectiveDefaults(): readonly SafetyModel[] {
    return reflectiveDefaults();
  },
  reflectiveBuiltIn: (v) => {
    switch (v.tag) {
      case "GsnItem": return gsnR().reflectiveBuiltIn(v._0);
      case "CausalItem": return [];
      case "BowTieItem": return bowTieR().reflectiveBuiltIn(v._0);
      case "BasicItem": return basicsR().reflectiveBuiltIn(v._0);
      case "EvidenceItem": return Reflective_Evidence.reflectiveBuiltIn(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveBuiltIn(v._0);
      default: return absurd(v);
    }
  },
  reflectiveGet: (v) => {
    switch (v.tag) {
      case "GsnItem": return gsnR().reflectiveGet(v._0);
      case "CausalItem": return M.empty();
      case "BowTieItem": return bowTieR().reflectiveGet(v._0);
      case "BasicItem": return basicsR().reflectiveGet(v._0);
      case "EvidenceItem": return Reflective_Evidence.reflectiveGet(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveGet(v._0);
      default: return absurd(v);
    }
  },
  reflectiveSet: (st, v) => {
    switch (v.tag) {
      case "GsnItem": return GsnItem(gsnR().reflectiveSet(st, v._0));
      case "CausalItem": return CausalItem(causalR().reflectiveSet(st, v._0));
      case "BowTieItem": return BowTieItem(bowTieR().reflectiveSet(st, v._0));
      case "BasicItem": return BasicItem(basicsR().reflectiveSet(st, v._0));
      case "EvidenceItem": return EvidenceItem(Reflective_Evidence.reflectiveSet(st, v._0));
      case "TraceItem": return TraceItem(Reflective_Trace.reflectiveSet(st, v._0));
      default: return absurd(v);
    }
  },
  get reflectiveBuiltInRefs(): RefTypeTable<SafetyModel> {
    return reflectiveBuiltInRefs();
  },
  get reflectiveArrows(): Arrows<SafetyModel> {
    return reflectiveArrows();
  },

  // instance EntityClass SafetyModel
  get name(): Lens<SafetyModel, Name> {
    return safetyModelName();
  },
  _Package: _ModelPackage,  // _BasicItem . _BasicPackage
  entityCanHaveChild: (p, _c) => (p.tag === "BasicItem" ? basicsCanHaveChild(safetyModelClass, p._0) : false),
  entityCanMove: (_v) => true,
  entityExports: (_ctx, _e) => [],
  entityClone: (ent, nm) => {
    const c = ent._entityContents;
    if (c.tag === "BasicItem") {
      return basicsCanHaveChild(safetyModelClass, c._0)
        ? Just((ctx: ModelEditCtx<SafetyModel, SafetyModel>) =>
          clonePackage<HadesRender, SafetyModel, SafetyPackageMeta>(
            safetyModelClass, ctx, (f, pm) => clonePackageAppearance(f, pm), ent, nm))
        : Just((ctx: ModelEditCtx<SafetyModel, SafetyModel>) => unsafeEntityClone(ctx, ent, nm));
    }
    return Just((ctx: ModelEditCtx<SafetyModel, SafetyModel>) => unsafeEntityClone(ctx, ent, nm));
  },
  get entityFunctions() {
    return entityFunctions();
  },
  get entityJ(): J.JSONCodec<SafetyModel> {
    return JSON_SafetyModel;
  },
  packageMetaJ: JSON_PackageAppearance as J.JSONCodec<SafetyPackageMeta>,
  packageMetaMempty: M.empty() as SafetyPackageMeta,
  packageMetaAppend: (m1: SafetyPackageMeta, m2: SafetyPackageMeta): SafetyPackageMeta => M.union(m1, m2),  // Map's left-biased Semigroup

  // instance Editable HadesRender SafetyModel
  editableActivation: (mEnt) => safetyModelActivation(mEnt),
  editableTreeMenu: (mEnt) => topEntityMenu(mEnt),
  editableDisplayMenu: (mEnt) => topEditableMenu(mEnt),

  // instance AppearanceClass (GsnDiagramType SafetyModel) SafetyModel (see the module header)
  getDiagramAppearance: (pm) =>
    coerceDiagramAppearance(M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm)),

  // instance Queryable SafetyModel
  _QueryDiagram: _ModelQuery,  // BasicItem . BasicQuery
  queryAvatars: (v) => {
    if (v.tag === "GsnItem" && v._0.tag === "GsnDiagramItem") {
      const ecls = gsnElementCls();
      return mapMaybe((e: GSN.GsnElement<SafetyModel>) => ecls.ascendedId(e),
        view(diagramEntityContents<GSN.GsnElement<SafetyModel>>().dot(diagramList(ecls)), v._0._0));
    }
    if (v.tag === "BowTieItem" && v._0.tag === "BowTieDiagram") {
      const ecls = bowTieElementCls();
      return mapMaybe((e: Risk.ElemBowTie<SafetyModel>) => ecls.ascendedId(e),
        view(diagramEntityContents<Risk.ElemBowTie<SafetyModel>>().dot(diagramList(ecls)), v._0._0));
    }
    return [];
  },

  // instance HasMatrices SafetyModel
  _Matrix: _ModelMatrix,
  // instance HasReports SafetyModel
  _Report: _BasicItem.dot(_BasicReport<SafetyModel>()),
  // instance HasBowTie SafetyModel
  _BowTie: _BowTieItem,
  // instance HasCausal SafetyModel
  _Causal: _CausalItem,
  // instance HasLookups SafetyModel
  _LookupTable: _BasicItem.dot(_BasicLookup<SafetyModel>()),
  // instance HasBasics SafetyModel
  _Basics: _BasicItem,

  // instance HasDiagrams HadesRender SafetyModel
  isDiagram: (v) => {
    switch (v.tag) {
      case "GsnItem": return GSN.gsnIsDiagram(safetyModelClass, v._0);
      case "CausalItem": return false;
      case "BowTieItem": return Risk.riskIsDiagram(v._0);
      case "BasicItem": return basicsIsDiagram(safetyModelClass, v._0);
      case "EvidenceItem": return false;
      case "TraceItem": return false;
      default: return absurd(v);
    }
  },
  getDiagramWrapper: (ctx, e) => {
    const c = e._entityContents;
    switch (c.tag) {
      case "GsnItem":
        return withSubtype(ctx, _GsnItem, (c1) => GSN.gsnDiagramWrapper(AppearanceClass_GsnDiagramType_SafetyModel, c1, e));
      case "CausalItem": return Nothing;
      case "BowTieItem":
        return withSubtype(ctx, _BowTieItem, (c1) => Risk.riskDiagramWrapper(AppearanceClass_BowTieType_SafetyModel, c1, e));
      case "BasicItem":
        return withSubtype(ctx, _BasicItem, (c1) => basicsDiagramWrapper(safetyModelClass, c1, e));
      case "EvidenceItem": return Nothing;
      case "TraceItem": return Nothing;
      default: return absurd(c);
    }
  },
  get diagramEntityTypes(): DiagramEntityTypes<SafetyModel> {
    return diagramEntityTypes();
  },
  diagramMapAvatars: (f, ent) => {
    const v = ent._entityContents;
    let newContents: SafetyModel;
    if (v.tag === "GsnItem" && v._0.tag === "GsnDiagramItem") {
      newContents = GsnItem(GSN.GsnDiagramItem<SafetyModel>(
        over(diagramEntityContents<GSN.GsnElement<SafetyModel>>().dot(diagramContents<GSN.GsnElement<SafetyModel>>()),
          (m) => M.map((x: GSN.GsnElement<SafetyModel>) => elementMapAvatars(f, x), m), v._0._0)));
    } else if (v.tag === "BowTieItem" && v._0.tag === "BowTieDiagram") {
      newContents = BowTieItem(Risk.BowTieDiagram<SafetyModel>(
        over(diagramEntityContents<Risk.ElemBowTie<SafetyModel>>().dot(diagramContents<Risk.ElemBowTie<SafetyModel>>()),
          (m) => M.map((x: Risk.ElemBowTie<SafetyModel>) => elementMapAvatars(f, x), m), v._0._0)));
    } else {
      newContents = v;
    }
    return { ...ent, _entityContents: newContents };  // entityContents .~ newContents $ ent
  },

  // instance HasEvidence SafetyModel
  _Evidence: _EvidenceItem,
  _Trace: _TraceItem,

  // instance HasGsn SafetyModel
  _Gsn: _GsnItem,
};

/** `instance AppearanceClass (GsnDiagramType SafetyModel) SafetyModel` (with all the other instances). */
export const AppearanceClass_GsnDiagramType_SafetyModel: GSN.GsnClass<SafetyModel> & SafetyModelClass =
  Object.assign(Object.create(safetyModelClass) as object, {
    getDiagramAppearance: (pm: SafetyPackageMeta) =>
      coerceDiagramAppearance<any, GSN.GsnDiagramType<SafetyModel>, SafetyModel>(
        M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm)),
  }) as GSN.GsnClass<SafetyModel> & SafetyModelClass;

/** `instance AppearanceClass (CausalType SafetyModel) SafetyModel` (with all the other instances). */
export const AppearanceClass_CausalType_SafetyModel: Causal.CausalClass<SafetyModel> & Omit<SafetyModelClass, "getDiagramAppearance"> =
  Object.assign(Object.create(safetyModelClass) as object, {
    getDiagramAppearance: (pm: SafetyPackageMeta) =>
      coerceDiagramAppearance<any, Causal.CausalType<SafetyModel>, SafetyModel>(
        M.findWithDefault(mempty_DiagramAppearance, causalDiagramVariant, pm)),
  }) as Causal.CausalClass<SafetyModel> & Omit<SafetyModelClass, "getDiagramAppearance">;

/** `instance AppearanceClass (BowTieType SafetyModel) SafetyModel` (with all the other instances). */
export const AppearanceClass_BowTieType_SafetyModel: Risk.BowTieClass<SafetyModel> & Omit<SafetyModelClass, "getDiagramAppearance"> =
  Object.assign(Object.create(safetyModelClass) as object, {
    getDiagramAppearance: (pm: SafetyPackageMeta) =>
      coerceDiagramAppearance<any, Risk.BowTieType<SafetyModel>, SafetyModel>(
        M.findWithDefault(mempty_DiagramAppearance, bowTieDiagramVariant, pm)),
  }) as Risk.BowTieClass<SafetyModel> & Omit<SafetyModelClass, "getDiagramAppearance">;

/** `instance Reflective SafetyModel` (the same dictionary as `safetyModelClass`). */
export const Reflective_SafetyModel: Reflective<SafetyModel> = safetyModelClass;
/** `instance EntityClass SafetyModel`. */
export const EntityClass_SafetyModel: EntityClass<SafetyModel, SafetyPackageMeta> = safetyModelClass;
/** `instance Editable HadesRender SafetyModel`. */
export const Editable_SafetyModel: Editable<HadesRender, SafetyModel> = safetyModelClass;
/** `instance Queryable SafetyModel`. */
export const Queryable_SafetyModel: Queryable<SafetyModel> = safetyModelClass;
/** `instance HasMatrices SafetyModel`. */
export const HasMatrices_SafetyModel: HasMatrices<SafetyModel> = safetyModelClass;
/** `instance HasReports SafetyModel`. */
export const HasReports_SafetyModel: HasReports<SafetyModel> = safetyModelClass;
/** `instance HasBowTie SafetyModel`. */
export const HasBowTie_SafetyModel: Risk.HasBowTie<SafetyModel> = safetyModelClass;
/** `instance HasCausal SafetyModel`. */
export const HasCausal_SafetyModel: Causal.HasCausal<SafetyModel> = safetyModelClass;
/** `instance HasLookups SafetyModel`. */
export const HasLookups_SafetyModel: HasLookups<SafetyModel> = safetyModelClass;
/** `instance HasBasics SafetyModel`. */
export const HasBasics_SafetyModel: HasBasics<SafetyModel> = safetyModelClass;
/** `instance HasDiagrams HadesRender SafetyModel`. */
export const HasDiagrams_SafetyModel: HasDiagrams<HadesRender, SafetyModel, SafetyPackageMeta> = safetyModelClass;
/** `instance HasEvidence SafetyModel`. */
export const HasEvidence_SafetyModel: HasEvidence<SafetyModel, SafetyPackageMeta> = safetyModelClass;
/** `instance HasGsn SafetyModel`. */
export const HasGsn_SafetyModel: GSN.HasGsn<SafetyModel> = safetyModelClass;


/**
 * `instance ToJSON SafetyModel` and `instance FromJSON SafetyModel`.
 *
 * The parsers are tried in the order GSN item, (ignored) causal item, bow tie item, basic item,
 * evidence, trace.
 */
export const JSON_SafetyModel: J.JSONCodec<SafetyModel> = J.codec(
  (v: SafetyModel): J.Value => {
    switch (v.tag) {
      case "GsnItem": return gsnJ().toJSON(v._0);
      case "CausalItem": return causalJ().toJSON(v._0);
      case "BowTieItem": return bowTieJ().toJSON(v._0);
      case "BasicItem": return basicsJ().toJSON(v._0);
      case "EvidenceItem": return JSON_Evidence.toJSON(v._0);
      case "TraceItem": return JSON_Trace.toJSON(v._0);
      default: return absurd(v);
    }
  },
  (v: J.Value): SafetyModel => {
    // Causal models have been removed from the DSM. However they may be encounted in a few
    // old files. This JSON parser replaces any causal component with an empty package.
    const ignoreCausalJson = (v1: J.Value): SafetyModel => {
      const c: Causal.ModelSubtype<SafetyModel> = causalJ().parseJSON(v1);
      return BasicItem(BasicPackage<SafetyModel>(
        Package<SafetyModel, SafetyPackageMeta>(
          Name(view(Causal.causalName<SafetyModel>().dot(nameText), c) + " (not supported)"), M.empty())));
    };
    return J.alt<SafetyModel>(
      (v0) => GsnItem(gsnJ().parseJSON(v0)),
      ignoreCausalJson,
      (v0) => BowTieItem(bowTieJ().parseJSON(v0)),
      (v0) => BasicItem(basicsJ().parseJSON(v0)),
      (v0) => EvidenceItem(JSON_Evidence.parseJSON(v0)),
      (v0) => TraceItem(JSON_Trace.parseJSON(v0)),
    )(v);
  },
);


/** The menu value type of the model tree menus: `ModelScript HadesRender SafetyModel SafetyModel (Maybe Text)`. */
type Script = ModelScriptAct<HadesRender, SafetyModel, SafetyModel, Maybe<string>>;


/** Context menu for the model tree. */
export const topEntityMenu: EntityMenu<HadesRender, SafetyModel, SafetyModel> = (maybeEnt) => {
  const appMenu = (uuid: ModelId): Menu<Script> =>
    mconcat_Menu<Script>([
      fmap_Menu((s: GSN.GsnScriptAct<SafetyModel, Maybe<string>>) => promoteScript(_GsnItem, s),
        GSN.gsnAddEntityMenu(safetyModelClass, uuid)),
      fmap_Menu((s: Risk.BowTieScriptAct<SafetyModel, Maybe<string>>) => promoteScript(_BowTieItem, s),
        Risk.bowTieAddEntityMenu(safetyModelClass, uuid)),
      addEvidenceEntityMenu<HadesRender, SafetyModel>(safetyModelClass, uuid),
      Menu<Script>([[menuItem<Script>("Edit diagram style", (ctx) => editPackageDiagramAppearance(ctx, uuid))]]),
    ]);
  switch (maybeEnt.tag) {
    case "Nothing":
      return Just(rootMenu<HadesRender, SafetyModel>(safetyModelClass, _BasicItem, appMenu(U.nil)));
    case "Just": {
      const e = maybeEnt.value;
      const c = e._entityContents;
      switch (c.tag) {
        case "GsnItem":
          return Just(fmap_Menu((s: GSN.GsnScriptAct<SafetyModel, Maybe<string>>) => promoteScript(_GsnItem, s),
            GSN.gsnEntityMenu(safetyModelClass, e, c._0)));
        case "CausalItem":
          return Just(mempty_Menu<Script>());
        case "BowTieItem":
          return Just(fmap_Menu((s: Risk.BowTieScriptAct<SafetyModel, Maybe<string>>) => promoteScript(_BowTieItem, s),
            Risk.bowTieEntityMenu(safetyModelClass, e, c._0)));
        case "BasicItem":
          return Just(basicsMenu<SafetyModel>(safetyModelClass, _BasicItem, appMenu(e.entityId), e));
        case "EvidenceItem":
          return Just(fmap_Menu(
            (s: ModelScriptAct<HadesRender, SafetyModel, Evidence, Maybe<string>>) => promoteScript(_EvidenceItem, s),
            evidenceEntityMenu<HadesRender, SafetyModel>(e)));
        case "TraceItem":
          return Just(fmap_Menu(
            (s: ModelScriptAct<HadesRender, SafetyModel, Trace, Maybe<string>>) => promoteScript(_TraceItem, s),
            traceEntityMenu<HadesRender, SafetyModel>(e.entityId)));
        default:
          return absurd(c);
      }
    }
    default:
      return absurd(maybeEnt);
  }
};


/** Context menu for entity lists in matrices, searches etc. */
export const topEditableMenu: EntityMenu<HadesRender, SafetyModel, SafetyModel> = (mEnt) => {
  if (mEnt.tag === "Nothing") return Nothing;
  const e = mEnt.value;
  if (safetyModelClass.isDiagram(view(entityContents<SafetyModel>(), e))) {
    return Just(Menu<Script>([[
      menuItem<Script>("Open Diagram", function* (ctx) {
        yield* openDiagram<HadesRender, SafetyModel, SafetyModel>(safetyModelClass, ctx, e.entityId);
        return Nothing;
      }),
      menuItem<Script>("Properties", (ctx) => editEntityProperties<HadesRender, SafetyModel, SafetyModel>(ctx, e.entityId)),
      menuItem<Script>("Find in model", function* (ctx) {
        yield* setModelSelection<HadesRender, SafetyModel, SafetyModel>(ctx, S.singleton(e.entityId));
        return Nothing;
      }),
    ]]));
  }
  return Just(Menu<Script>([[
    menuItem<Script>("Properties", (ctx) => editEntityProperties<HadesRender, SafetyModel, SafetyModel>(ctx, e.entityId)),
    menuItem<Script>("Find in model", function* (ctx) {
      yield* setModelSelection<HadesRender, SafetyModel, SafetyModel>(ctx, S.singleton(e.entityId));
      return Nothing;
    }),
  ]]));
};


export function* editPackageDiagramAppearance(
  ctx: ModelEditCtx<SafetyModel, SafetyModel>,
  mId: ModelId,
): ModelScript<HadesRender, SafetyModel, Maybe<string>> {
  goToEntity(ctx, mId);
  const eName = currentName(ctx);
  const appData = getMeta<SafetyModel, SafetyModel, SafetyPackageMeta>(ctx);
  switch (appData.tag) {
    case "Nothing": return throwUser(ctx, eName + " is not a package.");
    case "Just": {
      const appData2 = yield* openDialog<HadesRender, SafetyModel, SafetyModel, SafetyPackageMeta>(
        ctx, constantDialog(packageAppearanceDialog<HadesRender, SafetyModel, null>(safetyModelClass)), appData.value);
      switch (appData2.tag) {
        case "Nothing": return Nothing;
        case "Just":
          setMeta(ctx, packageAppearanceClean(appData2.value));
          return Just("Modified diagram styles in " + eName);
        default: return absurd(appData2);
      }
    }
    default: return absurd(appData);
  }
}


/** Icon to use for the entity in the module tree. */
export function entityIcon(ent: Entity<SafetyModel>): string {
  const v = view(entityContents<SafetyModel>(), ent);
  switch (v.tag) {
    case "GsnItem": return GSN.gsnStockItem(AppearanceClass_GsnDiagramType_SafetyModel, v._0);
    case "CausalItem": return Causal.causalIcon(v._0);
    case "BowTieItem": return Risk.bowTieIcon(v._0);
    case "BasicItem": return basicsIcon(safetyModelClass, v._0);
    case "EvidenceItem": return evidenceIconName;
    case "TraceItem": return traceIconName;
    default: return absurd(v);
  }
}


export const safetyModelActivation: ActivationScript<HadesRender, SafetyModel, SafetyModel> = (mEnt) => {
  if (mEnt.tag === "Nothing") {
    // eslint-disable-next-line require-yield
    return function* (_ctx) {
      return Nothing;
    };
  }
  const e = mEnt.value;
  const c = e._entityContents;
  switch (c.tag) {
    case "GsnItem": return promoteScript(_GsnItem, GSN.gsnActivation(safetyModelClass, Just(e)));
    // eslint-disable-next-line require-yield
    case "CausalItem": return function* (_ctx) {
      return Nothing;
    };
    case "BowTieItem": return promoteScript(_BowTieItem, Risk.bowTieActivation(safetyModelClass, Just(e)));
    case "BasicItem": return (ctx) => basicsActivation<SafetyModel>(safetyModelClass, ctx, e);
    case "EvidenceItem":
      return promoteScript(_EvidenceItem, evidenceActivation<HadesRender, SafetyModel>(Just(e)));
    case "TraceItem":
      return promoteScript(_TraceItem, traceActivation<HadesRender, SafetyModel>(Just(e)));
    default: return absurd(c);
  }
};
