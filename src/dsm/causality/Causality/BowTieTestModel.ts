/**
 * Test and demo support for `Causality.Risk` (not part of the Haskell sources).
 *
 * A model type like DSM.SafetyCase's `SafetyModel`, restricted to what the bow tie module and the
 * DSM example models need: bow tie items (the real `Causality.Risk` instances), GSN items,
 * packages, evidence, traces, query diagrams, matrices and lookup tables. Anything else (reports)
 * is kept as raw JSON, so every example model in `src/dsm/share/examples` loads and is written back.
 *
 * As in SafetyCase, the JSON parsers are tried in the order GSN, bow tie, then the basic types, and
 * `variantUserLabel` shows the "Bow Tie Event" variant as "Event".
 *
 * `cls` is the `BowTieClass` dictionary (its `AppearanceClass` is that of bow tie diagrams);
 * `gsnCls` is the same dictionary with the `AppearanceClass (GsnDiagramType v) v` instance, for
 * the GSN codecs and wrapper (see porting-notes/cm.md: one `getDiagramAppearance` per dictionary).
 */
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import { Nothing, mapMaybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { lens, over, prism, set, view, type Lens, type Prism } from "@/lib/Control/Lens";
import { diagramContents, diagramToList } from "@/hades/src/Hades/Abstract";
import {
  type PackageAppearance, JSON_PackageAppearance, coerceDiagramAppearance, mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import { Avatar_Element, elementMapAvatars } from "@/hades/src/App/GenericDiagram";
import {
  Evidence, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace, Trace, evidenceName, traceName,
} from "@/hades/evidence/Evidence/Model";
import {
  type Model, JSON_Model, JSON_Package, Name, Package, nameField, packageName, withSubtype,
} from "@/hades/src/Model/Abstract/PackageTree";
import { diagramEntityName } from "@/hades/src/Model/Abstract/DiagramType";
import { JSON_LookupTable, Reflective_LookupTable, def_LookupTable, tableFunctions, type LookupTable } from "@/hades/src/Model/Lookups/Base";
import { JSON_Matrix, Reflective_Matrix, matrixName, type Matrix } from "@/hades/src/Model/Matrices/Base";
import { JSON_QueryDiagram, Reflective_QueryDiagram, queryDiagram, type QueryDiagram } from "@/hades/src/Model/Query/Diagram";
import { append_RefTypeTable, refTypeTableCoerce } from "@/hades/src/Model/Reflection/References";
import { variantCoerce } from "@/hades/src/Model/Reflection/Values";
import { gsnDiagramVariant } from "@/dsm/gsn/GSN/FieldNames";
import {
  type GsnClass, type GsnDiagramType, type GsnElement, type GsnItem, DiagramTypeClass_GsnDiagramType,
  GsnDiagramItem, JSON_GsnItem, Reflective_GsnItem, gsnDiagramEntityTypes, gsnDiagramWrapper, gsnIsDiagram,
  gsnItemName,
} from "@/dsm/gsn/GSN/Model";
import { bowTieDiagramVariant, bowTieRiskEventVariant } from "./FieldNames";
import {
  type BowTie, type BowTieClass, type BowTieType, type ElemBowTie, BowTieDiagram, DiagramTypeClass_BowTieType,
  JSON_BowTie, Reflective_BowTie, bowTieName, riskDiagramEntityTypes, riskDiagramWrapper, riskIsDiagram,
} from "./Risk";

/** The package metadata: diagram appearances per variant. */
export type PM = PackageAppearance<TV>;

/** The entity type. */
export type TV =
  | { readonly tag: "BowTieItem"; readonly _0: BowTie<TV> }
  | { readonly tag: "GsnItem"; readonly _0: GsnItem<TV> }
  | { readonly tag: "Package"; readonly _0: Package<TV, PM> }
  | { readonly tag: "EvidenceItem"; readonly _0: Evidence }
  | { readonly tag: "TraceItem"; readonly _0: Trace }
  | { readonly tag: "Query"; readonly _0: QueryDiagram<TV> }
  | { readonly tag: "Matrix"; readonly _0: Matrix }
  | { readonly tag: "Lookup"; readonly _0: LookupTable }
  /** Entity types this model does not know (reports), kept as JSON. */
  | { readonly tag: "Other"; readonly _0: J.JSONObject };

const mkPrism = <A>(tag: TV["tag"]): Prism<TV, A> => prism(
  (a: A) => ({ tag, _0: a }) as unknown as TV,
  (v: TV) => (v.tag === tag ? Right((v as unknown as { _0: A })._0) : Left(v)),
);

export const _BowTieItem: Prism<TV, BowTie<TV>> = mkPrism("BowTieItem");
export const _GsnItem: Prism<TV, GsnItem<TV>> = mkPrism("GsnItem");
export const _Pkg: Prism<TV, Package<TV, PM>> = mkPrism("Package");
export const _Ev: Prism<TV, Evidence> = mkPrism("EvidenceItem");
export const _Tr: Prism<TV, Trace> = mkPrism("TraceItem");
export const _Query: Prism<TV, QueryDiagram<TV>> = mkPrism("Query");
export const _MatrixItem: Prism<TV, Matrix> = mkPrism("Matrix");
export const _LookupItem: Prism<TV, LookupTable> = mkPrism("Lookup");
const never = <A>(): Prism<TV, A> => prism((_a: A): TV => ({ tag: "Other", _0: {} }), (v: TV) => Left(v));

const otherName = (o: J.JSONObject): string => (typeof o.name === "string" ? o.name : "");

/** The `name` lens (SafetyCase: `singular $ ... failing ...`). */
export const tvName: Lens<TV, Name> = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "BowTieItem": return view(bowTieName<TV>(), v._0);
      case "GsnItem": return view(gsnItemName<TV>(), v._0);
      case "Package": return view(packageName<TV, PM>(), v._0);
      case "EvidenceItem": return view(evidenceName, v._0);
      case "TraceItem": return view(traceName, v._0);
      case "Query": return view(queryDiagram<TV>().dot(diagramEntityName()), v._0);
      case "Matrix": return v._0._matrixName;
      case "Lookup": return v._0._tableName;
      case "Other": return Name(otherName(v._0));
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "BowTieItem": return { tag: "BowTieItem", _0: set(bowTieName<TV>(), n, v._0) };
      case "GsnItem": return { tag: "GsnItem", _0: set(gsnItemName<TV>(), n, v._0) };
      case "Package": return { tag: "Package", _0: set(packageName<TV, PM>(), n, v._0) };
      case "EvidenceItem": return { tag: "EvidenceItem", _0: Evidence(n) };
      case "TraceItem": return { tag: "TraceItem", _0: Trace(n) };
      case "Query": return { tag: "Query", _0: set(queryDiagram<TV>().dot(diagramEntityName()), n, v._0) };
      case "Matrix": return { tag: "Matrix", _0: set(matrixName, n, v._0) };
      case "Lookup": return { tag: "Lookup", _0: { ...v._0, _tableName: n } };
      case "Other": return { tag: "Other", _0: { ...v._0, name: n._0 } };
    }
  },
);

const bowTieRefl = () => Reflective_BowTie<TV>();
let bowTieJ: J.JSONCodec<BowTie<TV>> | null = null;
const bowTieCodec = () => (bowTieJ ??= JSON_BowTie<TV>(cls));
let gsnR: ReturnType<typeof Reflective_GsnItem<TV>> | null = null;
const gsnRefl = () => (gsnR ??= Reflective_GsnItem<TV>(gsnCls));
let gsnJ: J.JSONCodec<GsnItem<TV>> | null = null;
const gsnCodec = () => (gsnJ ??= JSON_GsnItem<TV>(gsnCls));
let queryR: ReturnType<typeof Reflective_QueryDiagram<TV>> | null = null;
const queryRefl = () => (queryR ??= Reflective_QueryDiagram<TV>(cls));
let queryJ: J.JSONCodec<QueryDiagram<TV>> | null = null;
const queryCodec = () => (queryJ ??= JSON_QueryDiagram<TV>(cls));

/** The `BowTieClass` dictionary (with the bow tie `AppearanceClass`). */
export const cls: BowTieClass<TV> = {
  reflectiveName: (v) => {
    switch (v.tag) {
      case "BowTieItem": return variantCoerce(bowTieRefl().reflectiveName(v._0));
      case "GsnItem": return variantCoerce(gsnRefl().reflectiveName(v._0));
      case "Package": return "Package";
      case "EvidenceItem": return Reflective_Evidence.reflectiveName(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveName(v._0);
      case "Query": return variantCoerce(queryRefl().reflectiveName(v._0));
      case "Matrix": return Reflective_Matrix.reflectiveName(v._0);
      case "Lookup": return Reflective_LookupTable.reflectiveName(v._0);
      case "Other": return typeof v._0.type === "string" ? v._0.type : "Other";
    }
  },
  // As DSM.SafetyCase.
  variantUserLabel: (v) => (v === bowTieRiskEventVariant ? "Event" : v),
  get reflectiveDefaults(): TV[] {
    return [
      ...gsnRefl().reflectiveDefaults.map((i): TV => ({ tag: "GsnItem", _0: i })),
      ...bowTieRefl().reflectiveDefaults.map((i): TV => ({ tag: "BowTieItem", _0: i })),
      { tag: "Package", _0: Package(Name(""), M.empty()) },
      { tag: "Query", _0: queryRefl().reflectiveDefaults[0] },
      { tag: "Matrix", _0: Reflective_Matrix.reflectiveDefaults[0] },
      { tag: "Lookup", _0: def_LookupTable },
      { tag: "EvidenceItem", _0: Evidence(Name("")) },
      { tag: "TraceItem", _0: Trace(Name("")) },
    ];
  },
  reflectiveBuiltIn: (v) => {
    switch (v.tag) {
      case "BowTieItem": return bowTieRefl().reflectiveBuiltIn(v._0);
      case "GsnItem": return gsnRefl().reflectiveBuiltIn(v._0);
      case "EvidenceItem": return Reflective_Evidence.reflectiveBuiltIn(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveBuiltIn(v._0);
      case "Query": return queryRefl().reflectiveBuiltIn(v._0);
      case "Matrix": return Reflective_Matrix.reflectiveBuiltIn(v._0);
      case "Lookup": return Reflective_LookupTable.reflectiveBuiltIn(v._0);
      default: return [nameField];
    }
  },
  reflectiveGet: (v) => {
    switch (v.tag) {
      case "BowTieItem": return bowTieRefl().reflectiveGet(v._0);
      case "GsnItem": return gsnRefl().reflectiveGet(v._0);
      case "EvidenceItem": return Reflective_Evidence.reflectiveGet(v._0);
      case "TraceItem": return Reflective_Trace.reflectiveGet(v._0);
      case "Query": return queryRefl().reflectiveGet(v._0);
      case "Matrix": return Reflective_Matrix.reflectiveGet(v._0);
      case "Lookup": return Reflective_LookupTable.reflectiveGet(v._0);
      default: return M.empty();
    }
  },
  reflectiveSet: (st, v) => {
    switch (v.tag) {
      case "BowTieItem": return { tag: "BowTieItem", _0: bowTieRefl().reflectiveSet(st, v._0) };
      case "GsnItem": return { tag: "GsnItem", _0: gsnRefl().reflectiveSet(st, v._0) };
      case "EvidenceItem": return { tag: "EvidenceItem", _0: Reflective_Evidence.reflectiveSet(st, v._0) };
      case "TraceItem": return { tag: "TraceItem", _0: Reflective_Trace.reflectiveSet(st, v._0) };
      case "Query": return { tag: "Query", _0: queryRefl().reflectiveSet(st, v._0) };
      case "Matrix": return { tag: "Matrix", _0: Reflective_Matrix.reflectiveSet(st, v._0) };
      case "Lookup": return { tag: "Lookup", _0: Reflective_LookupTable.reflectiveSet(st, v._0) };
      default: return v;
    }
  },
  get reflectiveBuiltInRefs() {
    return [gsnRefl().reflectiveBuiltInRefs, bowTieRefl().reflectiveBuiltInRefs,
      Reflective_Evidence.reflectiveBuiltInRefs, Reflective_Trace.reflectiveBuiltInRefs]
      .map((t) => refTypeTableCoerce<any, TV>(t)).reduceRight((acc, t) => append_RefTypeTable(t, acc));
  },
  get reflectiveArrows() {
    return M.unions([gsnRefl().reflectiveArrows, bowTieRefl().reflectiveArrows, Reflective_Trace.reflectiveArrows]
      .map((m) => M.mapKeys(variantCoerce, m as M.Map<string, any>)));
  },
  name: tvName,
  _Package: _Pkg,
  entityCanHaveChild: (p) => p.tag === "Package",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  get entityFunctions() {
    return tableFunctions(cls);
  },
  entityJ: J.codec(
    (v: TV): J.Value => {
      switch (v.tag) {
        case "BowTieItem": return bowTieCodec().toJSON(v._0);
        case "GsnItem": return gsnCodec().toJSON(v._0);
        case "Package": return JSON_Package(cls).toJSON(v._0);
        case "EvidenceItem": return JSON_Evidence.toJSON(v._0);
        case "TraceItem": return JSON_Trace.toJSON(v._0);
        case "Query": return queryCodec().toJSON(v._0);
        case "Matrix": return JSON_Matrix.toJSON(v._0);
        case "Lookup": return JSON_LookupTable.toJSON(v._0);
        case "Other": return v._0;
      }
    },
    J.alt<TV>(
      (v) => ({ tag: "GsnItem", _0: gsnCodec().parseJSON(v) }),
      (v) => ({ tag: "BowTieItem", _0: bowTieCodec().parseJSON(v) }),
      (v) => ({ tag: "Package", _0: JSON_Package(cls).parseJSON(v) }),
      (v) => ({ tag: "Matrix", _0: JSON_Matrix.parseJSON(v) }),
      (v) => ({ tag: "Lookup", _0: JSON_LookupTable.parseJSON(v) }),
      (v) => ({ tag: "EvidenceItem", _0: JSON_Evidence.parseJSON(v) }),
      (v) => ({ tag: "TraceItem", _0: JSON_Trace.parseJSON(v) }),
      (v) => ({ tag: "Query", _0: queryCodec().parseJSON(v) }),
      (v) => ({ tag: "Other", _0: J.withObject("Other", (o) => o, v) }),
    ),
  ),
  packageMetaJ: JSON_PackageAppearance,
  packageMetaMempty: M.empty(),
  packageMetaAppend: (a, b) => M.union(a, b),
  // instance AppearanceClass (BowTieType SafetyModel) SafetyModel
  getDiagramAppearance: (pm: PM) =>
    coerceDiagramAppearance<any, BowTieType<TV>, TV>(M.findWithDefault(mempty_DiagramAppearance, bowTieDiagramVariant, pm)),
  // eslint-disable-next-line require-yield
  editableActivation: () => function* () {
    return Nothing;
  },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
  // Query diagrams are diagrams in SafetyCase, but this model has no wrapper for them.
  isDiagram: (v) => (v.tag === "BowTieItem" && riskIsDiagram(v._0)) || (v.tag === "GsnItem" && gsnIsDiagram(gsnCls, v._0)),
  getDiagramWrapper: (ctx, e) => {
    const c = e._entityContents;
    if (c.tag === "BowTieItem") return withSubtype(ctx, _BowTieItem, (c1) => riskDiagramWrapper(cls, c1, e));
    if (c.tag === "GsnItem") return withSubtype(ctx, _GsnItem, (c1) => gsnDiagramWrapper(gsnCls, c1, e));
    return Nothing;
  },
  get diagramEntityTypes() {
    return M.union(gsnDiagramEntityTypes<TV>(), riskDiagramEntityTypes);
  },
  diagramMapAvatars: (f, ent) => {
    const c = ent._entityContents;
    if (c.tag === "BowTieItem" && c._0.tag === "BowTieDiagram") {
      const d = c._0._0;
      const contents = over(diagramContents<ElemBowTie<TV>>(), (m) => M.map((x: ElemBowTie<TV>) => elementMapAvatars(f, x), m),
        d._diagramEntityContents);
      return { ...ent, _entityContents: { tag: "BowTieItem", _0: BowTieDiagram<TV>({ ...d, _diagramEntityContents: contents }) } };
    }
    if (c.tag === "GsnItem" && c._0.tag === "GsnDiagramItem") {
      const d = c._0._0;
      const contents = over(diagramContents<GsnElement<TV>>(), (m) => M.map((x: GsnElement<TV>) => elementMapAvatars(f, x), m),
        d._diagramEntityContents);
      return { ...ent, _entityContents: { tag: "GsnItem", _0: GsnDiagramItem<TV>({ ...d, _diagramEntityContents: contents }) } };
    }
    return ent;
  },
  _BowTie: _BowTieItem,
  _Evidence: _Ev,
  _Trace: _Tr,
  _Gsn: _GsnItem,
  _LookupTable: _LookupItem,
  _Matrix: _MatrixItem,
  _Report: never(),
  _QueryDiagram: _Query,
  // As DSM.SafetyCase: the entities shown on GSN and bow tie diagrams.
  queryAvatars: (v) => {
    if (v.tag === "GsnItem" && v._0.tag === "GsnDiagramItem") {
      const ecls = Avatar_Element(DiagramTypeClass_GsnDiagramType(gsnCls));
      return mapMaybe((e: GsnElement<TV>) => ecls.ascendedId(e), diagramToList(v._0._0._diagramEntityContents));
    }
    if (v.tag === "BowTieItem" && v._0.tag === "BowTieDiagram") {
      const ecls = Avatar_Element(DiagramTypeClass_BowTieType(cls));
      return mapMaybe((e: ElemBowTie<TV>) => ecls.ascendedId(e), diagramToList(v._0._0._diagramEntityContents));
    }
    return [];
  },
};

/** The same model dictionary with the `AppearanceClass (GsnDiagramType SafetyModel) SafetyModel` instance. */
export const gsnCls: GsnClass<TV> = Object.assign(Object.create(cls) as object, {
  getDiagramAppearance: (pm: PM) =>
    coerceDiagramAppearance<any, GsnDiagramType<TV>, TV>(M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm)),
}) as GsnClass<TV>;

/** Read a model (e.g. the parsed JSON of an example `.dsm` file). */
export function readBowTieModel(json: J.Value): Model<TV, PM> {
  return JSON_Model<TV>(cls).parseJSON(json);
}
