// Ported from hades/src/Model/Report/Base.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Reports: their definitions, and the report generator which turns a report into a document
 * ("Model.Report.Document" blocks) for an entity in the model.
 *
 * TypeScript port
 * ---------------
 * * `class (HasMatrices v) => HasReports v` is the dictionary interface `HasReports<V>`
 *   (member `_Report: Prism<V, Report<V>>`), extending `HasMatrices<V>`.
 * * `ReportPaper` and `ReportOrientation` are string enumerations (`reportPaperValues`,
 *   `reportOrientationValues`); the custom `Show` instances are `show_ReportPaper`
 *   (`"US Letter"`, `"A3"`, `"A4"`) and `show_ReportPageLayout`. `ReportPageLayout(paper,
 *   orientation)` is a record; its lenses `reportPagePaper`, `reportPageOrientation` are
 *   constants.
 * * `Report v` is the record `Report<V>` (`_reportName`, `_reportDescription`,
 *   `_reportDefaultInput`, `_reportDefaultTemplate`, `_reportSpec`). Because the type is
 *   polymorphic (in a phantom parameter), its lenses are zero-argument generic functions:
 *   `reportName()`, `reportDescription()`, `reportDefaultInput()`, `reportDefaultTemplate()`,
 *   `reportSpec()`. Instances: `JSON_Report`, `Reflective_Report` (constants).
 * * `ReportFragment v` is a tagged union (`ReportLiteral(t)`, `ReportField(fid)`,
 *   `ReportFieldList(fids)`, `ReportHeading(lvl, txt, rest)`, the constant `ReportDiagram`,
 *   `ReportMatrix(mId)`, `ReportLookup(mId)`, `SubReport(qId, order, frags)`); `JSON_ReportFragment`.
 *   The prisms are zero-argument generic functions (`_ReportLiteral()`, ..., `_SubReport()`);
 *   tuple-valued prisms focus on readonly tuples.
 * * `ImageRef` values (`IconRef(name)`, `DiagramRef(modelId)`) carry the derived Haskell
 *   `Eq`/`Ord` on their prototype (`IconRef < DiagramRef`, as the constructor order), so maps
 *   keyed by them (`Map ImageRef ...`) are ordered as in Haskell. Always build them with the
 *   constructor functions. `show_ImageRef` is the derived `Show`.
 * * The report generator runs in `ModelEdit v v`: `runReport(cls, ctx, report, modelId)` takes
 *   the dictionary for `(EntityClass v, HasDiagrams HadesRender v, HasLookups v, HasMatrices v)`
 *   (`ReportGeneratorClass<V>`) and the `ModelEditCtx<V, V>`, and returns
 *   `[blocks, images, errors]`. Errors from `goToEntity1` (deleted queries, matrices, lookup
 *   tables) are thrown as `ModelErrorException`s, as in Haskell.
 * * `fragmentDescription(cls, n, model, frag)` takes the `EntityClass` dictionary first.
 * * The internal `ResultFragment` type and its helpers are exported for tests (they are not
 *   exported by the Haskell module): `ResultFragment(...)`, `append_ResultFragment`,
 *   `mempty_ResultFragment`, `mconcat_ResultFragment`, `finaliseResult`, `textToBlocks`,
 *   `prefixBlock`, `inColour`, `inlineIcon`, `fieldFragment(ctx, fid, v)`.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import * as MP from "@/lib/Text/Megaparsec";
import { Just, Nothing, fromMaybe, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, bindEither, mapRight, type Either } from "@/lib/Data/Either";
import { EqSym, OrdSym, compare, type Ordering } from "@/lib/Data/Ord";
import { Node, flatten, fmapTree, type Forest, type Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  ix, lens, preview, prism, set, view,
  type Lens, type Prism, type StateCell,
} from "@/lib/Control/Lens";
import {
  BoundBox, NoBox, Point, boxHeight, boxWidth, fitIntoBox, mkBoundBox,
} from "@/hades/src/Hades/Abstract/Geometry";
import { diagramBounds } from "@/hades/src/Hades/Abstract/Delta";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import {
  JSON_Name, Name, checkType, current, currentId, currentName, descriptionField, entityContents,
  entityName, entityPropertiesWithStamps, entityStampsAsFields, getData, getModel, getVariantData,
  goToEntity, goToEntity1, nameField, nameText, withStampFields,
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import {
  goodAxis, horizontalAxis, runLookup, tableOutput, tableValues, verticalAxis,
  type HasLookups,
} from "@/hades/src/Model/Lookups/Base";
import {
  JSON_SortOrder, SortOrder, compareValues, compileMatrix, fieldColumnLink, fieldColumnText,
  groupColumns, groupQuery, groupSort, matrixColumnData, matrixColumnName, matrixGroups, matrixName,
  runMatrix, showSortOrder, sortForest, walkForestM,
  type ColumnGroup, type HasMatrices, type MatrixColumn, type MatrixId,
} from "@/hades/src/Model/Matrices/Base";
import { runQuery, type QueryId } from "@/hades/src/Model/Query/Base";
import { compileQueryDiagram, queryDiagram, type Queryable } from "@/hades/src/Model/Query/Diagram";
import { ShowErrorComponent_Text, evaluate, topExpr, type Expr } from "@/hades/src/Model/Reflection/Parser";
import { defaultVariantUserLabel, extract, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import {
  builtInName, enumItemName, fieldName, fieldType, migrateField1, rangeMap, withBuiltIn,
  type FieldId,
} from "@/hades/src/Model/Reflection/Types";
import {
  ExtText, Variant, _ExtText, displayValue, extValue, valueTypeName,
  type ExtValue, type ExtensionValues,
} from "@/hades/src/Model/Reflection/Values";
import * as D from "@/hades/src/Model/Report/Document";
import {
  Attr, DefinitionList, Heading, Icon, Highlight, LinkOut, MatrixHeader, Para, Picture, Plain, Space,
  Str, noAttr, trimSpaces,
  type Block, type Inline, type MatrixCell,
} from "@/hades/src/Model/Report/Document";
import { Walkable_InlineList_Block, Walkable_InlineList_BlockList, walk } from "@/hades/src/Model/Report/Walkable";
import type { Colour } from "@/banana-ui/base/Reactive/Banana/Common";

type Text = T.Text;
type FilePath = string;

export type { MatrixId };

// ---------------------------------------------------------------------------------------------

/** Entity types that can include reports. */
export interface HasReports<V> extends HasMatrices<V> {
  readonly _Report: Prism<V, Report<V>>;
}

/**
 * TypeScript: the dictionary for `(EntityClass v, HasDiagrams HadesRender v, HasLookups v,
 * HasMatrices v)`, the constraints of the report generator.
 */
export type ReportGeneratorClass<V> = HasDiagrams<HadesRender, V> & HasLookups<V> & HasMatrices<V>;


/** Paper size for Word exports. */
export type ReportPaper = "Letter" | "A3" | "A4";
export const reportPaperValues: readonly ReportPaper[] = ["Letter", "A3", "A4"];

/** `instance Show ReportPaper` */
export function show_ReportPaper(p: ReportPaper): string {
  switch (p) {
    case "Letter": return "US Letter";
    case "A3": return "A3";
    case "A4": return "A4";
    default: return absurd(p);
  }
}


/** Paper orientation for Word exports. */
export type ReportOrientation = "Portrait" | "Landscape";
export const reportOrientationValues: readonly ReportOrientation[] = ["Portrait", "Landscape"];

/** Derived `instance Show ReportOrientation`. */
export function show_ReportOrientation(o: ReportOrientation): string {
  return o;
}


/** Page layout for Word exports. */
export interface ReportPageLayout {
  readonly _reportPagePaper: ReportPaper;
  readonly _reportPageOrientation: ReportOrientation;
}
export function ReportPageLayout(_reportPagePaper: ReportPaper, _reportPageOrientation: ReportOrientation): ReportPageLayout {
  return { _reportPagePaper, _reportPageOrientation };
}

/** `instance Show ReportPageLayout` */
export function show_ReportPageLayout(l: ReportPageLayout): string {
  return show_ReportPaper(l._reportPagePaper) + " " + show_ReportOrientation(l._reportPageOrientation);
}

export const reportPagePaper: Lens<ReportPageLayout, ReportPaper> =
  lens((s: ReportPageLayout) => s._reportPagePaper, (s, p: ReportPaper) => ({ ...s, _reportPagePaper: p }));

export const reportPageOrientation: Lens<ReportPageLayout, ReportOrientation> =
  lens((s: ReportPageLayout) => s._reportPageOrientation, (s, o: ReportOrientation) => ({ ...s, _reportPageOrientation: o }));


/** A4 Landscape */
export const reportPageDefault: ReportPageLayout = ReportPageLayout("A4", "Landscape");

/** A report is a list of report fragments. The results are concatenated. */
export interface Report<_V = any> {
  readonly _reportName: Name;
  readonly _reportDescription: Text;
  readonly _reportDefaultInput: Maybe<ModelId>;
  readonly _reportDefaultTemplate: Maybe<FilePath>;
  readonly _reportSpec: readonly ReportFragment<_V>[];
}
export function Report<V = any>(
  _reportName: Name,
  _reportDescription: Text,
  _reportDefaultInput: Maybe<ModelId>,
  _reportDefaultTemplate: Maybe<FilePath>,
  _reportSpec: readonly ReportFragment<V>[],
): Report<V> {
  return { _reportName, _reportDescription, _reportDefaultInput, _reportDefaultTemplate, _reportSpec };
}

/** `instance ToJSON (Report v)` and `instance FromJSON (Report v)` */
export const JSON_Report: J.JSONCodec<Report<any>> = J.codec(
  (r) => J.object([
    ["type", J.textJ.toJSON("report")],
    ["name", JSON_Name.toJSON(r._reportName)],
    ["description", J.textJ.toJSON(r._reportDescription)],
    ["input", J.maybeJ(J.uuidJ).toJSON(r._reportDefaultInput)],
    ["template", J.maybeJ(J.textJ).toJSON(r._reportDefaultTemplate)],
    ["spec", r._reportSpec.map((f) => JSON_ReportFragment.toJSON(f))],
  ]),
  (val) => J.withObject("Report", (v) => {
    checkType(v, "report");
    return Report(
      J.field(v, "name", JSON_Name),
      J.fieldDefault(v, "description", J.textJ, ""),
      J.fieldDefault(v, "input", J.maybeJ(J.uuidJ), Nothing),
      J.fieldMaybe(v, "template", J.textJ),
      J.field(v, "spec", J.listJ(JSON_ReportFragment)),
    );
  }, val),
);

/** `instance Reflective (Report v)` */
export const Reflective_Report: Reflective<Report<any>> = {
  reflectiveName: (_) => Variant("Report"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Report(Name(""), "", Nothing, Nothing, [])],
  reflectiveBuiltIn: (_) => [nameField, descriptionField],
  reflectiveGet: (rpt) => M.fromList<FieldId, ExtValue>([
    [nameField, ExtText(view(reportName().dot(nameText), rpt))],
    [descriptionField, ExtText(view(reportDescription(), rpt))],
  ]),
  reflectiveSet: (st: StateCell<ExtensionValues>, rpt: Report<any>): Report<any> => {
    const nm = Name(T.strip(extract(st, view(reportName().dot(nameText), rpt), _ExtText, nameField)));
    const desc = extract(st, view(reportDescription(), rpt), _ExtText, descriptionField);
    return set(reportName(), nm, set(reportDescription(), desc, rpt));
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
};


export function reportName<V = any>(): Lens<Report<V>, Name> {
  return lens((r: Report<V>) => r._reportName, (r, n: Name) => ({ ...r, _reportName: n }));
}

export function reportDescription<V = any>(): Lens<Report<V>, Text> {
  return lens((r: Report<V>) => r._reportDescription, (r, t: Text) => ({ ...r, _reportDescription: t }));
}

export function reportDefaultInput<V = any>(): Lens<Report<V>, Maybe<ModelId>> {
  return lens((r: Report<V>) => r._reportDefaultInput, (r, x: Maybe<ModelId>) => ({ ...r, _reportDefaultInput: x }));
}

export function reportDefaultTemplate<V = any>(): Lens<Report<V>, Maybe<FilePath>> {
  return lens(
    (r: Report<V>) => r._reportDefaultTemplate,
    (r, p: Maybe<FilePath>) => ({ ...r, _reportDefaultTemplate: p }),
  );
}

export function reportSpec<V = any>(): Lens<Report<V>, readonly ReportFragment<V>[]> {
  return lens((r: Report<V>) => r._reportSpec, (r, s: readonly ReportFragment<V>[]) => ({ ...r, _reportSpec: s }));
}


export const blankReport: Report<any> = Report(Name(""), "", Nothing, Nothing, [ReportHeading(1, "", Just([nameField, ""]))]);


/** Part of a report. Where text is inserted a double newline marks a paragraph break. */
export type ReportFragment<_V = any> =
  /** Insert the text. */
  | { readonly tag: "ReportLiteral"; readonly _0: Text }
  /** Insert the field value for the current entity. */
  | { readonly tag: "ReportField"; readonly _0: FieldId }
  /** Insert the fields as a definition list. */
  | { readonly tag: "ReportFieldList"; readonly _0: readonly FieldId[] }
  /** Insert a heading at the given level. */
  | { readonly tag: "ReportHeading"; readonly _0: number; readonly _1: Text; readonly _2: Maybe<readonly [FieldId, Text]> }
  /** If the current entity is a diagram then insert it with caption. */
  | { readonly tag: "ReportDiagram" }
  /** Insert the given matrix with the current entity as input. */
  | { readonly tag: "ReportMatrix"; readonly _0: Maybe<MatrixId> }
  /** Insert the given lookup table. */
  | { readonly tag: "ReportLookup"; readonly _0: Maybe<ModelId> }
  /**
   * Execute the given query with the current entity as input, and insert the report
   * fragment once for each output of the query.
   */
  | {
      readonly tag: "SubReport";
      readonly _0: Maybe<QueryId>;
      readonly _1: SortOrder;
      readonly _2: readonly ReportFragment<_V>[];
    };

/** Insert the text. */
export function ReportLiteral<V = any>(_0: Text): ReportFragment<V> {
  return { tag: "ReportLiteral", _0 };
}
/** Insert the field value for the current entity. */
export function ReportField<V = any>(_0: FieldId): ReportFragment<V> {
  return { tag: "ReportField", _0 };
}
/** Insert the fields as a definition list. */
export function ReportFieldList<V = any>(_0: readonly FieldId[]): ReportFragment<V> {
  return { tag: "ReportFieldList", _0 };
}
/** Insert a heading at the given level. */
export function ReportHeading<V = any>(_0: number, _1: Text, _2: Maybe<readonly [FieldId, Text]>): ReportFragment<V> {
  return { tag: "ReportHeading", _0, _1, _2 };
}
/** If the current entity is a diagram then insert it with caption. */
export const ReportDiagram: ReportFragment<any> = { tag: "ReportDiagram" };
/** Insert the given matrix with the current entity as input. */
export function ReportMatrix<V = any>(_0: Maybe<MatrixId>): ReportFragment<V> {
  return { tag: "ReportMatrix", _0 };
}
/** Insert the given lookup table. */
export function ReportLookup<V = any>(_0: Maybe<ModelId>): ReportFragment<V> {
  return { tag: "ReportLookup", _0 };
}
/**
 * Execute the given query with the current entity as input, and insert the report
 * fragment once for each output of the query.
 */
export function SubReport<V = any>(_0: Maybe<QueryId>, _1: SortOrder, _2: readonly ReportFragment<V>[]): ReportFragment<V> {
  return { tag: "SubReport", _0, _1, _2 };
}

/** `instance ToJSON (ReportFragment v)` and `instance FromJSON (ReportFragment v)` */
export const JSON_ReportFragment: J.JSONCodec<ReportFragment<any>> = J.codec(
  (frag): J.Value => {
    switch (frag.tag) {
      case "ReportLiteral":
        return J.object([["literal", J.textJ.toJSON(frag._0)]]);
      case "ReportField":
        return J.object([["field", J.uuidJ.toJSON(frag._0)]]);
      case "ReportFieldList":
        return J.object([["field-list", frag._0.map((f) => J.uuidJ.toJSON(f))]]);
      case "ReportHeading":
        return J.object([
          ["level", J.intJ.toJSON(frag._0)],
          ["text1", J.textJ.toJSON(frag._1)],
          ["rest", J.maybeJ(J.tuple2J(J.uuidJ, J.textJ)).toJSON(frag._2 as Maybe<[FieldId, Text]>)],
        ]);
      case "ReportDiagram":
        return J.object([["type", J.textJ.toJSON("diagram")]]);
      case "ReportMatrix":
        return J.object([["matrix", J.maybeJ(J.uuidJ).toJSON(frag._0)]]);
      case "ReportLookup":
        return J.object([["lookup", J.maybeJ(J.uuidJ).toJSON(frag._0)]]);
      case "SubReport":
        return J.object([
          ["query", J.maybeJ(J.uuidJ).toJSON(frag._0)],
          ["sort", JSON_SortOrder.toJSON(frag._1)],
          ["subreport", frag._2.map((f) => JSON_ReportFragment.toJSON(f))],
        ]);
      default:
        return absurd(frag);
    }
  },
  (val) => J.withObject("Report fragment", (v): ReportFragment<any> => J.alt<ReportFragment<any>>(
    () => ReportLiteral(J.field(v, "literal", J.textJ)),
    () => ReportField(migrateField1(J.field(v, "field", J.textJ))),
    () => ReportFieldList(J.field(v, "field-list", J.listJ(J.textJ)).map(migrateField1)),
    () => {
      const lvl = J.field(v, "level", J.intJ);
      const t1 = J.field(v, "text1", J.textJ);
      const rest = J.field(v, "rest", J.maybeJ(J.tuple2J(J.textJ, J.textJ)));
      // (_Just . _1 %~ migrateField1)
      return ReportHeading(lvl, t1, rest.tag === "Just" ? Just([migrateField1(rest.value[0]), rest.value[1]] as const) : Nothing);
    },
    () => {
      checkType(v, "diagram");
      return ReportDiagram;
    },
    () => ReportMatrix(J.field(v, "matrix", J.maybeJ(J.uuidJ))),
    () => ReportLookup(J.field(v, "lookup", J.maybeJ(J.uuidJ))),
    () => SubReport(
      J.field(v, "query", J.maybeJ(J.uuidJ)),
      J.fieldDefault(v, "sort", JSON_SortOrder, SortOrder([[nameField, "Ascending"]])),
      J.field(v, "subreport", J.listJ(JSON_ReportFragment)),
    ),
  )(v), val),
);


export function _ReportLiteral<V = any>(): Prism<ReportFragment<V>, Text> {
  return prism(
    (txt: Text) => ReportLiteral<V>(txt),
    (v: ReportFragment<V>) => (v.tag === "ReportLiteral" ? Right(v._0) : Left(v)),
  );
}

export function _ReportField<V = any>(): Prism<ReportFragment<V>, FieldId> {
  return prism(
    (f: FieldId) => ReportField<V>(f),
    (v: ReportFragment<V>) => (v.tag === "ReportField" ? Right(v._0) : Left(v)),
  );
}

export function _ReportFieldList<V = any>(): Prism<ReportFragment<V>, readonly FieldId[]> {
  return prism(
    (fs: readonly FieldId[]) => ReportFieldList<V>(fs),
    (v: ReportFragment<V>) => (v.tag === "ReportFieldList" ? Right(v._0) : Left(v)),
  );
}

export function _ReportHeading<V = any>(): Prism<ReportFragment<V>, readonly [number, Text, Maybe<readonly [FieldId, Text]>]> {
  return prism(
    ([lvl, txt, rest]: readonly [number, Text, Maybe<readonly [FieldId, Text]>]) => ReportHeading<V>(lvl, txt, rest),
    (v: ReportFragment<V>) => (v.tag === "ReportHeading" ? Right([v._0, v._1, v._2] as const) : Left(v)),
  );
}

export function _ReportDiagram<V = any>(): Prism<ReportFragment<V>, null> {
  return prism(
    (_: null) => ReportDiagram as ReportFragment<V>,
    (v: ReportFragment<V>) => (v.tag === "ReportDiagram" ? Right(null) : Left(v)),
  );
}

export function _ReportMatrix<V = any>(): Prism<ReportFragment<V>, Maybe<MatrixId>> {
  return prism(
    (mId: Maybe<MatrixId>) => ReportMatrix<V>(mId),
    (v: ReportFragment<V>) => (v.tag === "ReportMatrix" ? Right(v._0) : Left(v)),
  );
}

export function _ReportLookup<V = any>(): Prism<ReportFragment<V>, Maybe<ModelId>> {
  return prism(
    (mId: Maybe<ModelId>) => ReportLookup<V>(mId),
    (v: ReportFragment<V>) => (v.tag === "ReportLookup" ? Right(v._0) : Left(v)),
  );
}

export function _SubReport<V = any>(): Prism<ReportFragment<V>, readonly [Maybe<QueryId>, SortOrder, readonly ReportFragment<V>[]]> {
  return prism(
    ([qId, o, rp]: readonly [Maybe<QueryId>, SortOrder, readonly ReportFragment<V>[]]) => SubReport<V>(qId, o, rp),
    (v: ReportFragment<V>) => (v.tag === "SubReport" ? Right([v._0, v._1, v._2] as const) : Left(v)),
  );
}


/** One-line summary of a report fragment. */
export function fragmentDescription<V>(cls: EntityClass<V>, n: number, model: Model<V>, frag: ReportFragment<V>): Text {
  const line1 = (txt: Text): Text => {
    const ls = T.lines(txt);
    return ls.length === 0 ? "" : ls[0];
  };
  const fragName = (m: Maybe<ModelId>): Text => {
    if (m.tag === "Nothing") return "<Not set>";
    return fromMaybe(
      "<Deleted>",
      preview(ix<ModelId, Entity<V>>(m.value).dot(entityName(cls)).dot(nameText), model.modelContents),
    );
  };
  const ellipsize = (n1: number, txt: Text): Text =>
    T.length(txt) > n ? T.take(n1 - 1, txt) + "…" : txt; // U+2026 ellipsis.
  const allFields = withStampFields(withBuiltIn(model.modelFields));
  const fname = (fid: FieldId): Text => fromMaybe("-deleted-", preview(ix<FieldId, any>(fid).dot(fieldName), allFields));
  const body = ((): Text => {
    switch (frag.tag) {
      case "ReportLiteral": return "\"" + line1(frag._0) + "\"";
      case "ReportField": return "<" + fname(frag._0) + ">";
      case "ReportFieldList": return "Fields: " + T.intercalate(", ", frag._0.map(fname));
      case "ReportHeading": {
        const rest = frag._2;
        return "Heading " + String(frag._0) + ": " + frag._1 +
          (rest.tag === "Nothing" ? "" : " <" + fname(rest.value[0]) + "> " + rest.value[1]);
      }
      case "ReportDiagram": return "Diagram";
      case "ReportMatrix": return "Matrix: " + fragName(frag._0);
      case "ReportLookup": return "Lookup Table: " + fragName(frag._0);
      case "SubReport": {
        const sub = frag._2;
        return "Section: " + fragName(frag._0) + " ordered by " + showSortOrder(allFields, frag._1) +
          ".  " + (sub.length === 0 ? "" : fragmentDescription(cls, n, model, sub[0]));
      }
      default: return absurd(frag);
    }
  })();
  return ellipsize(n, body);
}


/**
 * Reports can reference images. These images need to be tracked so that the right images
 * can be packaged up with the report.
 */
export type ImageRef =
  /** Reference to a named icon. */
  | { readonly tag: "IconRef"; readonly _0: Text }
  /** Reference to a diagram within the model. */
  | { readonly tag: "DiagramRef"; readonly _0: ModelId };

/** Constructor order, for the derived `Ord`. */
const imageRefRank = { IconRef: 0, DiagramRef: 1 } as const;

/** `deriving (Eq, Ord)` for "ImageRef": constructor order first, then the field. */
function compareImageRef(a: ImageRef, b: ImageRef): Ordering {
  if (a.tag !== b.tag) return imageRefRank[a.tag] < imageRefRank[b.tag] ? -1 : 1;
  return compare(a._0, b._0);
}

function isImageRef(v: unknown): v is ImageRef {
  const t = (v as any)?.tag;
  return t === "IconRef" || t === "DiagramRef";
}

/** Shared prototype giving "ImageRef" values the derived Haskell `Eq` and `Ord`. */
const imageRefProto = {
  [EqSym](this: ImageRef, other: unknown): boolean {
    return isImageRef(other) && compareImageRef(this, other) === 0;
  },
  [OrdSym](this: ImageRef, other: unknown): Ordering {
    return compareImageRef(this, other as ImageRef);
  },
};

function mkImageRef(r: ImageRef): ImageRef {
  return Object.freeze(Object.assign(Object.create(imageRefProto) as object, r)) as ImageRef;
}

/** Reference to a named icon. */
export function IconRef(_0: Text): ImageRef {
  return mkImageRef({ tag: "IconRef", _0 });
}
/** Reference to a diagram within the model. */
export function DiagramRef(_0: ModelId): ImageRef {
  return mkImageRef({ tag: "DiagramRef", _0 });
}

/** Derived `instance Show ImageRef`. */
export function show_ImageRef(r: ImageRef): string {
  switch (r.tag) {
    case "IconRef": return "IconRef " + T.showText(r._0);
    case "DiagramRef": return "DiagramRef " + U.toText(r._0);
    default: return absurd(r);
  }
}



/**
 * Report results are assembled in Result Fragments. This consists of a list of PanDoc @Block@
 * elements followed by a list of @Inline@ elements. The latter may be prepended onto the first
 * paragraph of the next result, or they may be rendered as a separate paragraph. This allows a
 * report fragment to be created either as a separate paragraph or as the start of a paragraph.
 *
 * (Not exported by the Haskell module.)
 */
export interface ResultFragment {
  readonly resultBlocks: readonly Block[];
  readonly resultInlines: readonly Inline[];
  readonly resultImages: readonly ImageRef[];
  readonly resultErrors: readonly (readonly [ModelId, Text])[];
}
export function ResultFragment(
  resultBlocks: readonly Block[],
  resultInlines: readonly Inline[],
  resultImages: readonly ImageRef[],
  resultErrors: readonly (readonly [ModelId, Text])[],
): ResultFragment {
  return { resultBlocks, resultInlines, resultImages, resultErrors };
}

/** `instance Semigroup ResultFragment` */
export function append_ResultFragment(frag1: ResultFragment, frag2: ResultFragment): ResultFragment {
  const inlines2 = (): Inline[] => {
    const i = trimSpaces(frag2.resultInlines);
    return i.length === 0 ? [] : [Space, ...i];
  };
  if (frag2.resultBlocks.length === 0) {
    return ResultFragment(
      frag1.resultBlocks,
      [...frag1.resultInlines, ...inlines2()],
      [...frag1.resultImages, ...frag2.resultImages],
      [...frag1.resultErrors, ...frag2.resultErrors],
    );
  }
  const [blks2First, ...blks2Rest] = frag2.resultBlocks;
  return ResultFragment(
    [...frag1.resultBlocks, ...prefixBlock(frag1.resultInlines, blks2First), ...blks2Rest],
    frag2.resultInlines,
    [...frag1.resultImages, ...frag2.resultImages],
    [...frag1.resultErrors, ...frag2.resultErrors],
  );
}

/** `instance Monoid ResultFragment` */
export const mempty_ResultFragment: ResultFragment = ResultFragment([], [], [], []);

/** `mconcat` for "ResultFragment" (`foldr (<>) mempty`). */
export function mconcat_ResultFragment(frags: readonly ResultFragment[]): ResultFragment {
  return frags.reduceRight((acc: ResultFragment, f) => append_ResultFragment(f, acc), mempty_ResultFragment);
}


/**
 * If there is an inline element at the end of the result, turn it into a separate paragraph
 * using the supplied function.
 */
export function finaliseResult(v: ResultFragment): ResultFragment {
  if (v.resultInlines.length === 0) return v;
  return ResultFragment([...v.resultBlocks, Para(trimSpaces(v.resultInlines))], [], v.resultImages, v.resultErrors);
}


/**
 * Generate a document from a report. Returns a list of PanDoc blocks and a list of diagram
 * model IDs. These diagrams are referred to by their IDs in the PanDoc. Hence when the PanDoc
 * is converted into an export file each diagram must be written into the same folder with the
 * file name generated by appending \"@.svg@\" to the text version of the model ID.
 *
 * Returns a triple of the PanDoc blocks, the images they reference, and error reports.
 */
export function runReport<V>(
  cls: ReportGeneratorClass<V>,
  ctx: ModelEditCtx<V, V>,
  rprt: Report<V>,
  modelId: ModelId,
): [Block[], ImageRef[], [ModelId, Text][]] {
  const result = view(reportSpec<V>(), rprt).map((frag) => runFragment(cls, ctx, modelId, frag));
  const r = finaliseResult(mconcat_ResultFragment(result));
  return [[...r.resultBlocks], [...r.resultImages], r.resultErrors.map(([m, t]) => [m, t] as [ModelId, Text])];
}


/** Generate a result fragment from a report fragment. */
function runFragment<V>(
  cls: ReportGeneratorClass<V>,
  ctx: ModelEditCtx<V, V>,
  modelId: ModelId,
  frag: ReportFragment<V>,
): ResultFragment {
  const headAttrs = (lvl: number): Attr => Attr(Just([modelId, lvl] as const), Nothing);
  const getEntValues = (mId: ModelId): readonly [ExtensionValues, ModelId] => {
    goToEntity(ctx, mId);
    const vs = getData(ctx);
    return [vs, mId];
  };
  const allFields = withStampFields(withBuiltIn(getModel(ctx).modelFields));
  const fname = (fid: FieldId): Text => fromMaybe("-deleted-", preview(ix<FieldId, any>(fid).dot(fieldName), allFields));
  goToEntity(ctx, modelId);
  const vals = getVariantData(ctx);
  switch (frag.tag) {
    case "ReportLiteral":
      return textToBlocks(frag._0);
    case "ReportField":
      return fieldFragment(ctx, frag._0, view(extValue(frag._0), vals))[1];
    case "ReportFieldList": {
      const items = frag._0.map((n): readonly [FieldId, ResultFragment] => {
        const v = M.lookup(n, vals);
        const defItem = v.tag === "Nothing" ? mempty_ResultFragment : fieldFragment(ctx, n, v.value)[1];
        return [n, finaliseResult(defItem)];
      });
      return ResultFragment(
        [DefinitionList(items.map(([fid, defItem]) => [[Str(fname(fid) + ": ")], defItem.resultBlocks] as const))],
        [],
        L.concatMap(([, f]) => f.resultImages, items),
        [],
      );
    }
    case "ReportHeading": {
      const lvl = frag._0;
      const rest = frag._2;
      if (rest.tag === "Nothing") {
        return ResultFragment([Heading(lvl, headAttrs(lvl), [Str(frag._1)])], [], [], []);
      }
      const [fid, txt2] = rest.value;
      const v = M.lookup(fid, vals);
      if (v.tag === "Nothing") {
        return ResultFragment(
          [Heading(lvl, headAttrs(lvl), [Str(frag._1 + " [?] " + txt2)])],
          [],
          [],
          [[modelId, "Field " + fname(fid) + " not found in level " + String(lvl) + " heading."]],
        );
      }
      return ResultFragment(
        [Heading(lvl, headAttrs(lvl), [Str(T.strip(frag._1 + " " + displayValue(v.value) + " " + txt2))])],
        [],
        [],
        [],
      );
    }
    case "ReportDiagram":
      return blockDiagram(cls, ctx);
    case "ReportMatrix":
      return frag._0.tag === "Nothing" ? mempty_ResultFragment : blockMatrix(cls, ctx, frag._0.value, modelId);
    case "ReportLookup":
      return frag._0.tag === "Nothing" ? mempty_ResultFragment : blockLookup(cls, ctx, frag._0.value);
    case "SubReport": {
      const subReport = frag._2;
      if (frag._0.tag === "Nothing") {
        return mconcat_ResultFragment(subReport.map((f) => runFragment(cls, ctx, modelId, f)));
      }
      const queryId = frag._0.value;
      const order = frag._1;
      const model = getModel(ctx);
      goToEntity1(ctx, "Subreport uses a deleted query.", queryId);
      const cur = current(ctx);
      const qd = cur.tag === "Just"
        ? preview(entityContents<V>().dot(cls._QueryDiagram).dot(queryDiagram<V>()), cur.value)
        : Nothing;
      if (qd.tag === "Nothing") {
        // Should never happen.
        return ResultFragment([], [], [], [[queryId, "Subreport query is not a query."]]);
      }
      const compiled = compileQueryDiagram(cls, model, qd.value);
      if (compiled.tag === "Left") return ResultFragment([], [], [], compiled.value.map((m) => [queryId, m] as const));
      const qry = compiled.value;
      // Get list of model IDs from query in alphabetical order.
      const [argIds, warnings] = runQuery(qry, [], model, S.singleton(modelId));
      const idList = L.sortBy(
        (a: readonly [ExtensionValues, ModelId], b: readonly [ExtensionValues, ModelId]) => compareValues(order, a[0], b[0]),
        S.toList(argIds).map(getEntValues),
      ).map(([, m]) => m);
      // Run the subreport and collate the results.
      const result = mconcat_ResultFragment(idList.map((mId) =>
        mconcat_ResultFragment(subReport.map((f) => runFragment(cls, ctx, mId, f)))));
      return append_ResultFragment(result, ResultFragment([], [], [], warnings.map((w) => [queryId, w] as const)));
    }
    default:
      return absurd(frag);
  }
}


/**
 * Render the extension value as a Document element with formatting taken from the field type.
 * Also returns the type of the field as a text string.
 */
export function fieldFragment<V>(ctx: ModelEditCtx<V, V>, fname: FieldId, v: ExtValue): [Attr, ResultFragment] {
  const fields = withBuiltIn(getModel(ctx).modelFields);
  const displayText = ResultFragment([], [Str(displayValue(v))], [], []);
  const mkAttr = (txt: Text): Attr => Attr(Nothing, Just(txt));
  const decorated = (mIcon: Maybe<Text>, mColour: Maybe<Colour>): ResultFragment => mconcat_ResultFragment([
    mIcon.tag === "Just" ? inlineIcon(mIcon.value) : mempty_ResultFragment,
    mColour.tag === "Just" ? inColour(mColour.value, displayText) : displayText,
  ]);
  const fld = M.lookup(fname, fields);
  const typ = fld.tag === "Just" ? Just(view(fieldType, fld.value)) : Nothing;
  if (typ.tag === "Nothing") return [mkAttr("Text"), displayText]; // Type data missing or bogus.
  const t = typ.value;
  switch (t.tag) {
    case "BuiltInDef":
      if (t._0 === "ModelNote") {
        return [mkAttr("Note"), finaliseResult(textToBlocks(displayValue(v)))];
        // Separate paragraph regardless.
      }
      return [mkAttr(builtInName(t._0)), displayText];
    case "DecoBoolDef": {
      const d = t._0;
      if (d.tag !== "DecoBool") return [mkAttr("Text"), displayText]; // Type data missing or bogus.
      if (v.tag !== "ExtBool") return [mkAttr("Text"), displayText]; // Type does not match data.
      const b = v._0;
      const boolIcons = d._0, boolColours = d._1;
      const r = mconcat_ResultFragment([
        boolIcons.tag === "Just"
          ? inlineIcon(b ? boolIcons.value[1] : boolIcons.value[0])
          : mempty_ResultFragment,
        boolColours.tag === "Just"
          ? inColour(b ? boolColours.value[0] : boolColours.value[1], displayText)
          : displayText,
      ]);
      return [mkAttr("Boolean"), r];
    }
    case "DecoIntDef": {
      const d = t._0;
      if (d.tag !== "DecoRange") return [mkAttr("Text"), displayText]; // Type data missing or bogus.
      if (v.tag !== "ExtInt") return [mkAttr("Text"), displayText]; // Type does not match data.
      const r = rangeMap(d._1, v._0);
      if (r.tag === "Nothing") return [mkAttr("Integer"), displayText];
      return [mkAttr("Integer"), decorated(r.value[0], r.value[1])];
    }
    case "DecoRealDef": {
      const d = t._0;
      if (d.tag !== "DecoRange") return [mkAttr("Text"), displayText]; // Type data missing or bogus.
      if (v.tag !== "ExtReal") return [mkAttr("Text"), displayText]; // Type does not match data.
      const r = rangeMap(d._1, v._0);
      if (r.tag === "Nothing") return [mkAttr("Real"), displayText];
      return [mkAttr("Real"), decorated(r.value[0], r.value[1])];
    }
    case "EnumDef": {
      if (v.tag !== "ExtText") return [mkAttr("Text"), displayText]; // Type does not match data.
      const txt = v._0;
      const item = L.find((i) => txt === view(enumItemName, i), t._0);
      if (item.tag === "Nothing") return [mkAttr("Enum"), displayText]; // Enumeration value not found in type.
      return [mkAttr("Enum"), decorated(item.value._enumItemIcon, item.value._enumItemColour)];
    }
    default:
      return absurd(t);
  }
}


export function inColour(colour: Colour, frag: ResultFragment): ResultFragment {
  const fixInlines = (l: readonly Inline[]): Inline[] => (l.length === 0 ? [] : [Highlight(colour, l)]);
  return ResultFragment(
    walk(Walkable_InlineList_BlockList, fixInlines, frag.resultBlocks),
    fixInlines(frag.resultInlines),
    frag.resultImages,
    frag.resultErrors,
  );
}


/**
 * Convert some literal text into PanDoc blocks. The first paragraph will be appended to the
 * "Inline" argument. The last paragraph will become an "Inline" unless it ends with a newline.
 */
export function textToBlocks(txt: Text): ResultFragment {
  const paras = T.splitOn("\n\n", txt);
  const makePara = (t: Text): ResultFragment => ResultFragment([Para([Str(t)])], [], [], []);
  const makeInline = (t: Text): ResultFragment => ResultFragment([], [Str(t)], [], []);
  const makeBlocks = (ps: readonly Text[]): ResultFragment[] => {
    const out: ResultFragment[] = [];
    for (let i = 0; i < ps.length; i++) {
      const t = ps[i];
      if (i < ps.length - 1) {
        out.push(makePara(t));
      } else if (T.isNull(txt)) {
        // Nothing.
      } else if (T.last(txt) === "\n") {
        out.push(makePara(t));
      } else {
        out.push(makeInline(t));
      }
    }
    return out;
  };
  return mconcat_ResultFragment(makeBlocks(paras));
}


/**
 * If the block contains "Inline" items then prefix the argument on to it. Otherwise convert
 * the "Inline" items into a separate block.
 */
export function prefixBlock(ins1: readonly Inline[], blk: Block): Block[] {
  switch (blk.tag) {
    case "Plain": return [Plain([...trimSpaces(ins1), Space, ...trimSpaces(blk._0)])];
    case "Para": return [Para([...trimSpaces(ins1), Space, ...trimSpaces(blk._0)])];
    default: return [Para(trimSpaces(ins1)), blk];
  }
}


/** Add the named icon to the output. */
export function inlineIcon(txt: Text): ResultFragment {
  return ResultFragment([], [Icon(txt)], [IconRef(txt)], []);
}


/** Insert the diagram (if any) from the current entity. */
function blockDiagram<V>(cls: ReportGeneratorClass<V>, ctx: ModelEditCtx<V, V>): ResultFragment {
  const scalePt = (f: number, p: Point): Point => Point(p._pX * f, p._pY * f);
  const scaleBox = (f: number, b: BoundBox): BoundBox =>
    b.tag === "NoBox" ? NoBox : BoundBox(scalePt(f, b._0), scalePt(f, b._1));
  const pointFactor = 72 / 96; // Points per pixel.
  const diagramWidthMax = 72 * 7; // 7 inches in points.
  const diagramHeightMax = 72 * 9; // 9 inches in points.
  const maxDiagramBox = mkBoundBox(Point(0, 0), Point(diagramWidthMax, diagramHeightMax));
  const block = (size: BoundBox, nm: Text, modelId: ModelId): Block => Picture(
    Attr(Nothing, Just("DiagramBox")),
    [Str(nm)],
    nm,
    [boxWidth(size), boxHeight(size)],
    modelId,
  );
  const noDiagram = (modelId: ModelId, msg: Text): ResultFragment =>
    ResultFragment([Para([Str(msg)])], [], [], [[modelId, msg]]);
  const modelId = currentId(ctx);
  const nm = currentName(ctx);
  const e = current(ctx);
  if (e.tag === "Nothing") return noDiagram(modelId, "Entity " + nm + " is missing.");
  const w = cls.getDiagramWrapper(ctx, e.value);
  if (w.tag === "Just" && w.value.tag === "DiagramWrapper") {
    const diagram = w.value.diagramToEdit;
    const size1 = scaleBox(pointFactor, diagramBounds(w.value.diagramClass, diagram));
    const shrinkFactor = fitIntoBox(size1, maxDiagramBox);
    const size2 = scaleBox(shrinkFactor, size1);
    return ResultFragment([block(size2, nm, modelId)], [], [DiagramRef(modelId)], []);
  }
  return noDiagram(modelId, "Entity " + nm + " is not a diagram.");
}

/* Design Note:

The scaling here is a bit clunky. The SVG diagram is automatically scaled from pixels (96 dpi) down
to points (72 per inch). Hence the size for the diagram also needs to be scaled by the same factor.
If the result is bigger than 7x9 inches in either dimension it is scaled to fit. The maximum size
was chosen to give reasonable results on both UK A4 and US Letter sizes of paper.
*/


/**
 * Insert a lookup table as a table.
 *
 * @param tableId The model ID of the lookup table.
 */
function blockLookup<V>(cls: EntityClass<V> & HasLookups<V>, ctx: ModelEditCtx<V, V>, tableId: ModelId): ResultFragment {
  type Errs = readonly (readonly [ModelId, Text])[];
  // Smash all the text in a block into a single list of Inlines.
  const concatMapInlines = <A>(f: (a: A) => readonly Inline[], xs: readonly A[]): Inline[] =>
    L.intercalate<Inline>([Space], xs.map((x) => trimSpaces(f(x))));
  const topInlines = (blk: Block): readonly Inline[] => {
    switch (blk.tag) {
      case "Plain": return blk._0;
      case "Para": return blk._0;
      case "OrderedList": return concatMapInlines((bs: readonly Block[]) => concatMapInlines(topInlines, bs), blk._1);
      case "UnorderedList": return concatMapInlines((bs: readonly Block[]) => concatMapInlines(topInlines, bs), blk._0);
      case "DefinitionList":
        return concatMapInlines(
          ([inlines, blocks]: readonly [readonly Inline[], readonly Block[]]) =>
            trimSpaces([...inlines, Space, ...concatMapInlines(topInlines, blocks)]),
          blk._0,
        );
      case "Heading": return blk._2;
      case "Matrix": return []; // Complicated and will never happen.
      case "Div": return concatMapInlines(topInlines, blk._1);
      case "Picture": return blk._1;
      case "Null": return [];
      default: return absurd(blk);
    }
  };
  const extractInlines = ([, f]: readonly [Attr, ResultFragment]): readonly [Inline[], readonly ImageRef[], Errs] =>
    [[...L.concatMap(topInlines, f.resultBlocks), ...f.resultInlines], f.resultImages, f.resultErrors]; // O(n^2), but we know n is small.
  const extractBlocks = ([attr, frag]: readonly [Attr, ResultFragment]): readonly [MatrixCell, readonly ImageRef[], Errs] => {
    const r = finaliseResult(frag);
    return [[attr, r.resultBlocks] as const, r.resultImages, r.resultErrors];
  };
  goToEntity1(ctx, "The report uses a deleted lookup table.", tableId);
  const model = getModel(ctx);
  const tableNm = currentName(ctx);
  const cur = current(ctx);
  const tbl = cur.tag === "Just" ? preview(entityContents<V>().dot(cls._LookupTable), cur.value) : Nothing;
  if (tbl.tag === "Nothing") return ResultFragment([], [], [], [[tableId, "Lookup table does not exist (deleted?)."]]);
  const table = tbl.value;
  const axis = (fid: FieldId) => {
    const f = M.lookup(fid, model.modelFields);
    return f.tag === "Just" ? goodAxis(f.value) : Nothing;
  };
  const hAxis = axis(view(horizontalAxis, table));
  const vAxis = axis(view(verticalAxis, table));
  if (hAxis.tag === "Nothing" || vAxis.tag === "Nothing") {
    return ResultFragment([], [], [], [[tableId, "Invalid lookup table."]]);
  }
  const [hType, hName, hs] = hAxis.value;
  const [vType, vName, vs] = vAxis.value;
  const headerRow = hs.map((h) => extractInlines(fieldFragment(ctx, hType, h)));
  const rows = vs.map((row): readonly [Tree<readonly MatrixCell[]>, ImageRef[], (readonly [ModelId, Text])[]] => {
    const rowHeader = fieldFragment(ctx, vType, row);
    const cells = hs.map((col) =>
      fieldFragment(ctx, view(tableOutput, table), view(tableValues.dot(extValue<readonly [ExtValue, ExtValue]>([col, row])), table)));
    const [headerItem, headerImages, headerRefs] = extractBlocks(rowHeader);
    const [cellRow, cellImages, cellRefs] = L.unzip3(cells.map(extractBlocks));
    return [
      Node<readonly MatrixCell[]>([headerItem], [Node<readonly MatrixCell[]>(cellRow, [])]),
      [...headerImages, ...L.concat(cellImages)],
      [...headerRefs, ...L.concat(cellRefs)],
    ];
  });
  const [headerInlines, headerImages, headerErrs] = L.unzip3(headerRow);
  const [cells, cellImages, cellErrs] = L.unzip3(rows);
  const headers = [
    MatrixHeader([Str("")], [[Str(vName)]]),
    MatrixHeader([Str(hName)], headerInlines),
  ];
  return ResultFragment(
    [D.Matrix(noAttr, [Str(tableNm)], headers, cells)],
    [],
    [...L.concat(headerImages), ...L.concat(cellImages)],
    [...L.concat(headerErrs), ...L.concat(cellErrs)],
  );
}


/**
 * Insert a matrix as a table.
 *
 * @param matrixId The model ID of the matrix.
 * @param modelId The entity to pass as an input to the matrix.
 */
function blockMatrix<V>(
  cls: EntityClass<V> & HasLookups<V> & HasMatrices<V>,
  ctx: ModelEditCtx<V, V>,
  matrixId: ModelId,
  modelId: ModelId,
): ResultFragment {
  const model = getModel(ctx);
  goToEntity1(ctx, "Report uses a deleted matrix.", matrixId);
  const cur = current(ctx);
  const mtx = cur.tag === "Just" ? preview(entityContents<V>().dot(cls._Matrix), cur.value) : Nothing;
  if (mtx.tag === "Nothing") {
    return ResultFragment([], [], [], [[matrixId, "Matrix does not exist (deleted?)."]]);
    // Should never happen.
  }
  const matrix = mtx.value;
  const compiled = compileMatrix(cls, matrix, model);
  if (compiled.tag === "Left") return ResultFragment([], [], [], compiled.value.map((e) => [matrixId, e] as const));
  const queries = compiled.value;
  const [results, warns] = runMatrix(queries, model, S.singleton(modelId));
  const warnFrag = ResultFragment([], [], [], warns.map((w) => [matrixId, w] as const));
  if (results.length === 0) return warnFrag;
  const blk = tabulate(cls, ctx, view(matrixName.dot(nameText), matrix), view(matrixGroups, matrix), results);
  return append_ResultFragment(blk, warnFrag);
}


/** Tabulate a matrix. */
function tabulate<V>(
  cls: EntityClass<V> & HasLookups<V> & Queryable<V>,
  ctx: ModelEditCtx<V, V>,
  caption: Text,
  groups: readonly ColumnGroup[],
  nodes: Forest<ModelId>,
): ResultFragment {
  if (groups.length === 0) return mempty_ResultFragment;
  type Row = readonly (readonly [Attr, ResultFragment])[];
  const captionInlines = [Str(caption)];
  const tabulateRow = (grp: ColumnGroup) => (values: readonly (readonly [ModelId, ExtensionValues])[]): Row => {
    if (values.length === 0) return [];
    const mId = values[0][0];
    return view(groupColumns, grp).map((c) => tabulateCell(cls, ctx, mId, values.map(([, vs]) => vs), c));
  };
  const mkHeader = (grp: ColumnGroup): MatrixHeader => {
    const heads = view(groupColumns, grp).map((c: MatrixColumn) => [Str(view(matrixColumnName, c))]);
    goToEntity1(ctx, "Matrix " + caption + " uses a deleted query.", view(groupQuery, grp));
    const queryName = currentName(ctx);
    return MatrixHeader([Str(queryName)], heads);
  };
  const mapMaybeTree = <A, B>(f: (a: A) => Maybe<B>, t: Tree<A>): Maybe<Tree<B>> => {
    const x = f(t.rootLabel);
    return x.tag === "Just" ? Just(Node(x.value, mapMaybeForest(f, t.subForest))) : Nothing;
  };
  const mapMaybeForest = <A, B>(f: (a: A) => Maybe<B>, ts: Forest<A>): Tree<B>[] =>
    mapMaybe((t: Tree<A>) => mapMaybeTree(f, t), ts);
  const model = getModel(ctx);
  const sorts = groups.map((g) => view(groupSort, g));
  const entForest = sortForest(
    cls,
    sorts,
    mapMaybeForest((u: ModelId) => M.lookup(u, model.modelContents), nodes),
  );
  const forest1 = entForest.map((t) =>
    fmapTree((e: Entity<V>) => [e.entityId, entityPropertiesWithStamps(cls, e)] as const, t));
  const cells = walkForestM(groups.map(tabulateRow), forest1);
  const headers = groups.map(mkHeader);
  const cellBlocks: Forest<readonly MatrixCell[]> = cells.map((t) =>
    fmapTree((row: Row) => row.map(([a, f]) => [a, finaliseResult(f).resultBlocks] as const), t));
  const allCells = L.concat(L.concatMap((t: Tree<Row>) => flatten(t), cells));
  const images = L.concatMap(([, f]: readonly [Attr, ResultFragment]) => f.resultImages, allCells);
  const errs = L.concatMap(([, f]: readonly [Attr, ResultFragment]) => f.resultErrors, allCells);
  return ResultFragment([D.Matrix(noAttr, captionInlines, headers, cellBlocks)], [], images, errs);
}


/**
 * Return the fragment for a single cell.
 *
 * @param modelId The ID of the entity being tabulated.
 * @param valueses Extension values for this entity and all its predecessors in the matrix.
 * @param c The column definition for this cell.
 */
function tabulateCell<V>(
  cls: EntityClass<V> & HasLookups<V> & Queryable<V>,
  ctx: ModelEditCtx<V, V>,
  modelId: ModelId,
  valueses: readonly ExtensionValues[],
  c: MatrixColumn,
): [Attr, ResultFragment] {
  const mkAttr = (txt: Text): Attr => Attr(Nothing, Just(txt));
  if (valueses.length === 0) return [Attr(Nothing, Just("Text")), ResultFragment([], [], [], [])];
  const values = valueses[0];
  const allValues = valueses.reduceRight((acc: ExtensionValues, vs) => M.union(vs, acc), M.empty<FieldId, ExtValue>());
  const knownFields = withStampFields(withBuiltIn(getModel(ctx).modelFields));
  const d = view(matrixColumnData, c);
  switch (d.tag) {
    case "FieldColumn": {
      const f = d._0;
      const fname = view(fieldColumnText, f);
      const addLink = (txts: readonly Inline[]): Inline[] => {
        if (txts.length === 0) return [];
        const link = view(fieldColumnLink, f);
        if (link.tag === "Nothing") return [...txts];
        const lv = M.lookup(link.value, values);
        if (lv.tag === "Just" && lv.value.tag === "ExtText") return [LinkOut(lv.value._0, txts)];
        return [...txts];
      };
      const [attr, r] = fieldFragment(ctx, fname, view(extValue(fname), values));
      return [
        attr,
        ResultFragment(
          r.resultBlocks.map((b) => walk(Walkable_InlineList_Block, addLink, b)),
          addLink(r.resultInlines),
          r.resultImages,
          r.resultErrors,
        ),
      ];
    }
    case "ExprColumn": {
      const expr = d._1;
      const model = getModel(ctx);
      const parsed = MP.parse<Expr<Model<V>>, Text>(topExpr(ctx.cls.entityFunctions, knownFields), "", expr);
      if (parsed.tag === "Left") {
        return [
          mkAttr("Text"),
          ResultFragment([], [], [], L.take(3, parsed.value.bundleErrors).map((e) =>
            [modelId, T.pack(MP.parseErrorTextPretty(ShowErrorComponent_Text, e))] as const)),
        ];
      }
      goToEntity(ctx, modelId);
      const ent = current(ctx);
      const stamps = ent.tag === "Just" ? entityStampsAsFields(ctx.cls, ent.value) : M.empty<FieldId, ExtValue>();
      const v = evaluate(parsed.value, M.union(stamps, allValues), model);
      if (v.tag === "Left") return [mkAttr("Text"), ResultFragment([], [], [], [[modelId, v.value]])];
      return [mkAttr(valueTypeName(v.value)), textToBlocks(displayValue(v.value))];
    }
    case "QueryColumn": {
      const queryId = d._0;
      const model = getModel(ctx);
      const getName = (mId: ModelId): Maybe<Text> => {
        const e = M.lookup(mId, model.modelContents);
        return e.tag === "Just" ? Just(view(entityName(ctx.cls).dot(nameText), e.value)) : Nothing;
      };
      const resultNames = (s: S.Set<ModelId>): Text => T.intercalate(", ", L.sort(mapMaybe(getName, S.toList(s))));
      const result: Either<Text[], Text> = (() => { // Either monad
        const queryEnt = M.lookup(queryId, model.modelContents);
        if (queryEnt.tag === "Nothing") return Left(["No such query"]);
        const qd = preview(entityContents<V>().dot(cls._QueryDiagram).dot(queryDiagram<V>()), queryEnt.value);
        if (qd.tag === "Nothing") {
          return Left([view(entityName(ctx.cls).dot(nameText), queryEnt.value) + " is not a query"]);
        }
        return mapRight(
          (qry) => resultNames(runQuery(qry, [], model, S.singleton(modelId))[0]),
          compileQueryDiagram(cls, model, qd.value),
        );
      })();
      if (result.tag === "Left") return [mkAttr("Text"), ResultFragment([], [], [], result.value.map((m) => [queryId, m] as const))];
      return [mkAttr("Text"), textToBlocks(result.value)];
    }
    case "LookupColumn": {
      const tableId = d._0;
      const model = getModel(ctx);
      const result = bindEither( // Either monad
        ((): Either<Text[], Entity<V>> => {
          const e = M.lookup(tableId, model.modelContents);
          return e.tag === "Nothing" ? Left(["No such lookup table"]) : Right(e.value);
        })(),
        (tblEnt) => {
          const t = preview(entityContents<V>().dot(cls._LookupTable), tblEnt);
          return t.tag === "Nothing"
            ? Left([view(entityName(ctx.cls).dot(nameText), tblEnt) + " is not a lookup table."])
            : Right(t.value);
        },
      );
      if (result.tag === "Left") return [mkAttr("Text"), ResultFragment([], [], [], result.value.map((m) => [modelId, m] as const))];
      const tbl = result.value;
      return fieldFragment(ctx, view(tableOutput, tbl), runLookup(tbl, allValues));
    }
    default:
      return absurd(d);
  }
}
