// Ported from hades/src/App/Appearance.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Users control diagram appearance through a cascade of \"Appearance\" objects. These are attached
 * to diagrams, packages and components. An Appearance object attached to a package controls
 * all of the diagrams contained directly or indirectcly in the package, unless overridden by
 * an Appearance in a child package or a diagram.
 *
 * @Appearance@ is a @Monoid@, so the @Appearance@ for a diagram is the @mconcat@ of the ancestral
 * @Appearance@ objects attached to the diagram and its containers going up to the root.
 *
 * The root has a fixed @Appearance@ which displays only the Name and Description fields
 * with no labels. Hence this is the default.
 *
 * TypeScript port
 * ---------------
 * * `AppearanceClass t v` is the dictionary interface `AppearanceClass<T, V, PM>` (extends
 *   `EntityClass<V, PM>`; `PM` stands for `PackageMeta v`) with the member
 *   `getDiagramAppearance(pm)`.
 * * `FieldStyle` is a string enumeration (`fieldStyleValues`), codec `JSON_FieldStyle`.
 * * `EntityShowField` is a record (`EntityShowField(style, fid)`, codec `JSON_EntityShowField`);
 *   its lenses `entityShowFieldStyle`, `entityShowFieldId` are constants.
 * * `EntityShowFields a` is a newtype with its own instances, so it is the record
 *   `{ _fieldsShown }` built with `EntityShowFields(list)`; the association list is an array of
 *   `[variant, fields]` pairs. Instances: `append_EntityShowFields`, `mempty_EntityShowFields`,
 *   `JSON_EntityShowFields`. `fieldsShown<A, B>()` is the (type-changing) Iso.
 * * `DiagramAppearance t v` is a record with the phantom type parameters kept
 *   (`DiagramAppearance<T, V>`): `DiagramAppearance(arrowLabels, fields, highlights)`,
 *   `append_DiagramAppearance`, `mempty_DiagramAppearance`, `JSON_DiagramAppearance`. Its lenses
 *   are zero-argument generic functions (`arrowLabels()`, `entityShowFields()`, `highlights()`).
 * * `PackageAppearance a` is `M.Map<Variant<A>, DiagramAppearance<null, A>>` (`()` is `null`).
 * * Dialogs and gadgets take the `(EntityClass v, HasDiagrams p v, Queryable v)` dictionary
 *   first: `diagramAppearanceDialog(cls, var_)`, `diagramAppearanceGadget(cls, var_)`,
 *   `packageAppearanceDialog(cls)`, `packageAppearanceGadget(cls)`. (`var` is a reserved word,
 *   so the variant argument is `var_`.)
 * * `diagramLayout :: EntityShowFields v -> ModelEdit v w (HadesLayout ())` is
 *   `diagramLayout(ctx, style)`: it runs in the `ModelEditCtx` (whose `cls` is the `EntityClass`)
 *   and returns the `HadesLayout` action. The `IO` inside the layout (Pango attribute lists, icon
 *   lookups) runs synchronously when the layout is run.
 * * The functions that are local to the Haskell module ("fieldsShownMap", "showFieldsClean",
 *   "highlightTable", "entityShowTable") are exported here so that they can be tested; so are
 *   some helpers from `where` clauses ("highlightIso", "styleName", "uniqueVariants") and the
 *   local helpers of "diagramLayout" that build Pango attribute lists ("colourText",
 *   "colourForFont", "labelledFieldAttributes").
 * * Pango attribute indices are UTF-8 byte offsets (in Haskell's gi-pango and in
 *   `@/lib/GI/Pango`). As in the Haskell, "labelledFieldAttributes" computes them from character
 *   counts ("T.length"), which is only right for ASCII text; see its comment.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import * as Gdk from "@/lib/GI/Gdk";
import * as Gtk from "@/lib/GI/Gtk";
import * as Pango from "@/lib/GI/Pango";
import { Just, Nothing, fromJust, fromMaybe, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { absurd, round } from "@/lib/Prelude";
import {
  _1, _2, each, hasnt, identity, iso, ix, lens, over, preview, view, type Iso, type Lens,
} from "@/lib/Control/Lens";
import {
  ComboItem, Dialog, OkApplyButton, OkButton, accum, arr, box, comboBox, constantDialog, exec, focusing,
  focusingOver, form, gFanout, gId, gPipe, getInitialEnv, optional, promoteDialog, simpleFrame, tabForm,
  table, tickBox, validateText,
  type Dialog_, type DialogSelector_, type Gadget_, type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { type Colour, Colour as mkColour, getColour } from "@/banana-ui/base/Reactive/Banana/Common";
import { contrastText } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Common";
import {
  EditColour, EditCombo, EditFixed, TableAdd, TableDelete, TableShuffle, mkField,
} from "@/banana-ui/base/Reactive/Banana/Table";
import {
  type HadesLayout, layoutHLine, layoutParagraphGap, layoutParagraphs, layoutParallel, layoutPixbuf,
  layoutText, layoutTitle,
} from "@/hades/src/Hades/GI/BasicShapes";
import type { HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId, current, descriptionField,
  entityName, entityPropertiesWithStamps, getModel, nameText, withBaseType, withStampFields,
} from "@/hades/src/Model/Abstract/PackageTree";
import { refPicker } from "@/hades/src/Model/Abstract/Properties";
import type { QueryId } from "@/hades/src/Model/Query/Base";
import type { Queryable } from "@/hades/src/Model/Query/Diagram";
import { reflection, valueFormat } from "@/hades/src/Model/Reflection/Reflective";
import {
  BuiltInDef, type Field, type FieldId, type FieldName, type FieldTable, fieldName, fieldNameIso,
  fieldsByName, migrateField, withBuiltIn,
} from "@/hades/src/Model/Reflection/Types";
import {
  type ExtValue, ExtNone, JSONKey_Variant, JSON_Variant, Variant, displayValue, show_Variant, variantName,
} from "@/hades/src/Model/Reflection/Values";

// ---------------------------------------------------------------------------------------------
// * Class Definition

/**
 * Diagram appearances can be stored in package meta-data.
 *
 * (`PM` is `PackageMeta v`, as in `EntityClass`.)
 */
export interface AppearanceClass<T, V, PM = any> extends EntityClass<V, PM> {
  getDiagramAppearance(pm: PM): DiagramAppearance<T, V>;
}

// ---------------------------------------------------------------------------------------------
// * Type Definitions

/** How the name of a field ought to be displayed relative to its value in a diagram. */
export type FieldStyle = "FieldStyleNone" | "FieldStyleOutdent" | "FieldStyleAbove";
export const fieldStyleValues: readonly FieldStyle[] = ["FieldStyleNone", "FieldStyleOutdent", "FieldStyleAbove"];
export const FieldStyleNone: FieldStyle = "FieldStyleNone";
export const FieldStyleOutdent: FieldStyle = "FieldStyleOutdent";
export const FieldStyleAbove: FieldStyle = "FieldStyleAbove";

/** `instance ToJSON FieldStyle` and `instance FromJSON FieldStyle` */
export const JSON_FieldStyle: J.JSONCodec<FieldStyle> = J.codec(
  (s) => {
    switch (s) {
      case "FieldStyleNone":
        return "None";
      case "FieldStyleOutdent":
        return "Outdent";
      case "FieldStyleAbove":
        return "Above";
      default:
        return absurd(s);
    }
  },
  (v) => {
    if (typeof v === "string") {
      switch (v) {
        case "None":
          return FieldStyleNone;
        case "Outdent":
          return FieldStyleOutdent;
        case "Above":
          return FieldStyleAbove;
        default:
          return J.fail("Unrecognised FieldNameStyle: " + T.showText(v));
      }
    }
    return J.typeMismatch("FieldNameStyle", v);
  },
);

/** If and how a field within an entity should be displayed in a diagram. */
export interface EntityShowField {
  readonly _entityShowFieldStyle: FieldStyle;
  readonly _entityShowFieldId: FieldId;
}
export function EntityShowField(_entityShowFieldStyle: FieldStyle, _entityShowFieldId: FieldId): EntityShowField {
  return { _entityShowFieldStyle, _entityShowFieldId };
}

/** Derived `instance Show EntityShowField`. (Derived `Eq` is the structural `equals`.) */
export function show_EntityShowField(f: EntityShowField): string {
  return "EntityShowField {_entityShowFieldStyle = " + f._entityShowFieldStyle +
    ", _entityShowFieldId = " + f._entityShowFieldId + "}";
}

/** `instance ToJSON EntityShowField` and `instance FromJSON EntityShowField` */
export const JSON_EntityShowField: J.JSONCodec<EntityShowField> = J.codec(
  (f) => J.object([
    ["style", JSON_FieldStyle.toJSON(f._entityShowFieldStyle)],
    ["field", J.uuidJ.toJSON(f._entityShowFieldId)],
  ]),
  (val) => J.withObject("EntityShowField", (obj) => {
    const style = J.field(obj, "style", JSON_FieldStyle);
    const mFid = J.fieldMaybe(obj, "field", J.uuidJ);
    const fid = mFid.tag === "Just" ? mFid.value : migrateField(J.field(obj, "name", J.textJ));
    return EntityShowField(style, fid);
  }, val),
);

export const entityShowFieldStyle: Lens<EntityShowField, FieldStyle> =
  lens((s: EntityShowField) => s._entityShowFieldStyle, (s, v: FieldStyle) => ({ ...s, _entityShowFieldStyle: v }));

export const entityShowFieldId: Lens<EntityShowField, FieldId> =
  lens((s: EntityShowField) => s._entityShowFieldId, (s, n: FieldId) => ({ ...s, _entityShowFieldId: n }));

/** One row of "EntityShowFields": a variant and the fields shown for it. */
export type FieldsShownRow<A> = readonly [Variant<A>, readonly EntityShowField[]];

/**
 * The fields to be shown for different entity types in a diagram.
 *
 * The contents are stored as an association list rather than a "Map" because the latter breaks
 * the table gadget in the dialog. The monoid instance is left-biased; it does not concatenate
 * the field lists.
 */
export interface EntityShowFields<A> {
  readonly _fieldsShown: readonly FieldsShownRow<A>[];
}
export function EntityShowFields<A = any>(_fieldsShown: readonly FieldsShownRow<A>[]): EntityShowFields<A> {
  return { _fieldsShown };
}

/** Derived `instance Show (EntityShowFields a)`. */
export function show_EntityShowFields<A>(f: EntityShowFields<A>): string {
  const row = ([v, fs]: FieldsShownRow<A>): string =>
    "(" + show_Variant(v) + ",[" + fs.map(show_EntityShowField).join(",") + "])";
  return "EntityShowFields {_fieldsShown = [" + f._fieldsShown.map(row).join(",") + "]}";
}

/** `instance Semigroup (EntityShowFields a)` (left-biased union of the association lists). */
export function append_EntityShowFields<A>(f1: EntityShowFields<A>, f2: EntityShowFields<A>): EntityShowFields<A> {
  return EntityShowFields<A>(M.toList(M.union(
    M.fromList<Variant<A>, readonly EntityShowField[]>(f1._fieldsShown),
    M.fromList<Variant<A>, readonly EntityShowField[]>(f2._fieldsShown),
  )));
}

/** `instance Monoid (EntityShowFields a)` */
export const mempty_EntityShowFields: EntityShowFields<any> = EntityShowFields<any>([]);

/** The codec of the association list `[(Variant a, [EntityShowField])]`. */
const fieldsShownListJ: J.JSONCodec<FieldsShownRow<any>[]> =
  J.listJ(J.tuple2J(JSON_Variant, J.listJ(JSON_EntityShowField)));

/** The codec of `Map (Variant a) [EntityShowField]` (the format of older files). */
const fieldsShownMapJ: J.JSONCodec<M.Map<Variant<any>, EntityShowField[]>> =
  J.mapJ(JSONKey_Variant, J.listJ(JSON_EntityShowField));

/** `instance ToJSON (EntityShowFields a)` and `instance FromJSON (EntityShowFields a)` */
export const JSON_EntityShowFields: J.JSONCodec<EntityShowFields<any>> = J.codec(
  (f) => fieldsShownListJ.toJSON(f._fieldsShown.map(([v, fs]) => [v, fs] as [Variant<any>, readonly EntityShowField[]])),
  (v) => EntityShowFields<any>(J.alt<FieldsShownRow<any>[]>(
    (x) => fieldsShownListJ.parseJSON(x),
    (x) => M.toList(fieldsShownMapJ.parseJSON(x)),
  )(v)),
  // Allow for older files stored as a map.
);

/** Each variant will have a list of fields to be shown. */
export function fieldsShown<A = any, B = A>(): Iso<
  EntityShowFields<A>,
  readonly FieldsShownRow<A>[],
  EntityShowFields<B>,
  readonly FieldsShownRow<B>[]
> {
  return iso((f: EntityShowFields<A>) => f._fieldsShown, (l: readonly FieldsShownRow<B>[]) => EntityShowFields<B>(l));
}

/**
 * Convert the fields shown to a "Map".
 *
 * (Not exported by the Haskell module.)
 */
export function fieldsShownMap<A>(f: EntityShowFields<A>): M.Map<Variant<A>, readonly EntityShowField[]> {
  return M.fromList(view(fieldsShown<A>(), f));
}

/**
 * Clean up the "fieldsShown": merge duplicates and remove blank keys.
 *
 * (Not exported by the Haskell module.)
 */
export function showFieldsClean<A>(f: EntityShowFields<A>): EntityShowFields<A> {
  return over(
    fieldsShown<A>(),
    (rows: readonly FieldsShownRow<A>[]): FieldsShownRow<A>[] => M.toList(M.fromListWith(
      // flip (++)
      (nv: readonly EntityShowField[], ov: readonly EntityShowField[]): readonly EntityShowField[] => [...ov, ...nv],
      rows.filter((r) => "" !== view(variantName<A>(), r[0])),
    )),
    f,
  );
}

// ---------------------------------------------------------------------------------------------
// * Diagram Appearance

/**
 * Appearance view settings for diagrams. This is the version for the user interface and
 * storage.
 *
 * The type parameters are dummies. The first is the type of diagram that this is controlling,
 * the second is the type of entity in the model.
 *
 * The "Semigroup" instance is left-biased.
 */
export interface DiagramAppearance<_T, V> {
  /** True if arrows are to be labelled. */
  readonly _arrowLabels: Maybe<boolean>;
  readonly _entityShowFields: EntityShowFields<V>;
  readonly _highlights: readonly (readonly [QueryId, Colour])[];
}
export function DiagramAppearance<T = any, V = any>(
  _arrowLabels: Maybe<boolean>,
  _entityShowFields: EntityShowFields<V>,
  _highlights: readonly (readonly [QueryId, Colour])[],
): DiagramAppearance<T, V> {
  return { _arrowLabels, _entityShowFields, _highlights };
}

/** `instance ToJSON (DiagramAppearance t v)` and `instance FromJSON (DiagramAppearance t v)` */
export const JSON_DiagramAppearance: J.JSONCodec<DiagramAppearance<any, any>> = (() => {
  const highlightsJ = J.listJ(J.tuple2J(J.uuidJ, J.colourJ));
  return J.codec<DiagramAppearance<any, any>>(
    (da) => J.object([
      ["arrowNames", J.maybeJ(J.boolJ).toJSON(da._arrowLabels)],
      ["fields", JSON_EntityShowFields.toJSON(da._entityShowFields)],
      ["highlights", highlightsJ.toJSON(da._highlights.map(([q, c]) => [q, getColour(c)] as [QueryId, C.Colour]))],
    ]),
    (val) => J.withObject("Diagram appearance", (obj) => DiagramAppearance(
      J.fieldMaybe(obj, "arrowNames", J.boolJ),
      J.fieldDefault(obj, "fields", JSON_EntityShowFields, mempty_EntityShowFields),
      J.field(obj, "highlights", highlightsJ).map(([q, c]) => [q, mkColour(c)] as const),
    ), val),
  );
})();

/** `instance Semigroup (DiagramAppearance t v)` */
export function append_DiagramAppearance<T, V>(
  a1: DiagramAppearance<T, V>,
  a2: DiagramAppearance<T, V>,
): DiagramAppearance<T, V> {
  return DiagramAppearance<T, V>(
    a1._arrowLabels.tag === "Just" ? a1._arrowLabels : a2._arrowLabels, // n1 <|> n2
    append_EntityShowFields(a1._entityShowFields, a2._entityShowFields),
    [...a1._highlights, ...a2._highlights],
  );
}

/** `instance Monoid (DiagramAppearance t v)` */
export const mempty_DiagramAppearance: DiagramAppearance<any, any> =
  DiagramAppearance<any, any>(Nothing, mempty_EntityShowFields, []);

/** `mconcat` of the "DiagramAppearance" monoid (used to combine the cascade of appearances). */
export function mconcat_DiagramAppearance<T, V>(as: readonly DiagramAppearance<T, V>[]): DiagramAppearance<T, V> {
  return as.reduceRight((acc: DiagramAppearance<T, V>, a) => append_DiagramAppearance(a, acc), mempty_DiagramAppearance);
}

/**
 * Create a copy of the diagram appearance with model IDs of the queries updated according to the
 * provided function.
 */
export function cloneDiagramAppearance<T, V>(
  f: (q: QueryId) => Maybe<QueryId>,
  da: DiagramAppearance<T, V>,
): DiagramAppearance<T, V> {
  return over(
    highlights<T, V>().dot(each<readonly [QueryId, Colour], [QueryId, Colour]>()).dot(_1<QueryId, Colour>()),
    (v: QueryId) => fromMaybe(v, f(v)),
    da,
  );
}

/** If true, label the arrows on a diagram. */
export function arrowLabels<T = any, V = any>(): Lens<DiagramAppearance<T, V>, Maybe<boolean>> {
  return lens((s: DiagramAppearance<T, V>) => s._arrowLabels, (s, b: Maybe<boolean>) => ({ ...s, _arrowLabels: b }));
}

/**
 * When the diagram is displayed each entity type will be looked up here to find the list
 * of fields that should be shown.
 */
export function entityShowFields<T = any, V1 = any, V2 = V1>(): Lens<
  DiagramAppearance<T, V1>,
  EntityShowFields<V1>,
  DiagramAppearance<T, V2>,
  EntityShowFields<V2>
> {
  return lens(
    (s: DiagramAppearance<T, V1>) => s._entityShowFields,
    (s, f: EntityShowFields<V2>): DiagramAppearance<T, V2> => ({ ...s, _entityShowFields: f }),
  );
}

/**
 * When the diagram is displayed it will be passed as an input to each query listed. If a
 * diagram element is found in the query output then it will be displayed in the corresponding
 * colour. If a diagram element is found in multiple query outputs then the first one wins.
 */
export function highlights<T = any, V = any>(): Lens<DiagramAppearance<T, V>, readonly (readonly [QueryId, Colour])[]> {
  return lens(
    (s: DiagramAppearance<T, V>) => s._highlights,
    (s, h: readonly (readonly [QueryId, Colour])[]) => ({ ...s, _highlights: h }),
  );
}

/** Change the type of a DiagramAppearance. */
export function coerceDiagramAppearance<T1, T2, V>(da: DiagramAppearance<T1, V>): DiagramAppearance<T2, V> {
  return DiagramAppearance<T2, V>(da._arrowLabels, da._entityShowFields, da._highlights);
}

/** Clean up the fields shown in the diagram appearance. */
export function diagramAppearanceClean<T, V>(da: DiagramAppearance<T, V>): DiagramAppearance<T, V> {
  return over(entityShowFields<T, V>(), (f: EntityShowFields<V>) => showFieldsClean(f), da);
}

/** The dictionary for `(EntityClass v, HasDiagrams p v, Queryable v)`. */
export type AppearanceDialogClass<P, V> = HasDiagrams<P, V> & Queryable<V>;

export function diagramAppearanceDialog<P, V, W = any, T = any>(
  cls: AppearanceDialogClass<P, V>,
  var_: Variant<V>,
): Dialog_<Model<V>, W, DiagramAppearance<T, V>> {
  return Dialog(cls.variantUserLabel(var_) + " Style", OkApplyButton, accum(diagramAppearanceGadget<P, V, W, T>(cls, var_)));
}

export function diagramAppearanceGadget<P, V, W = any, T = any>(
  cls: AppearanceDialogClass<P, V>,
  var_: Variant<V>,
): GadgetF_<Model<V>, W, DiagramAppearance<T, V>> {
  type E = Model<V>;
  type DA = DiagramAppearance<T, V>;
  const variants = M.findWithDefault<Variant<V>, readonly Variant<V>[]>([], var_, cls.diagramEntityTypes);
  return box<E, W, DA>("Vertical", [[
    form<E, W, DA>("Vertical",
      [["Show arrow labels:", focusing(arrowLabels<T, V>(), optional(false, tickBox<E, W>()))]]),
    box<E, W, DA>("Horizontal", [[
      simpleFrame("Show Fields",
        focusing(
          entityShowFields<T, V>().dot(fieldsShown<V>()),
          entityShowTable<V, W>(cls, variants),
        )),
      simpleFrame("Highlights",
        focusing(highlights<T, V>().dot(highlightIso), highlightTable<V, W>(cls))),
    ]]),
  ]]);
}

/**
 * Tabular form of highlight settings, including blank value.
 *
 * (Local to "diagramAppearanceGadget" in Haskell.)
 */
export const highlightIso: Iso<readonly (readonly [QueryId, Colour])[], readonly (readonly [S.Set<QueryId>, Colour])[]> =
  (() => {
    const blankHighlight: readonly [S.Set<QueryId>, Colour] = [S.empty<QueryId>(), mkColour(C.black)];
    return iso(
      (hs: readonly (readonly [QueryId, Colour])[]) => [
        ...hs.map(([q, c]) => [S.singleton(q), c] as const),
        blankHighlight,
      ],
      (rows: readonly (readonly [S.Set<QueryId>, Colour])[]) => rows
        .filter((r) => !equals(r, blankHighlight))
        .map(([s, c]) => [fromJust(S.lookupMin(s)), c] as const),
      // fromJust is safe because Nothing values are filtered out.
    );
  })();

/**
 * Table of diagram queries mapping to highlight colours.
 *
 * (Not exported by the Haskell module.)
 */
export function highlightTable<V, W = any>(
  cls: EntityClass<V> & Queryable<V>,
): Gadget_<Model<V>, W, readonly (readonly [S.Set<QueryId>, Colour])[]> {
  type E = Model<V>;
  type Row = readonly [S.Set<QueryId>, Colour];
  const queryName = (model: Model<V>, s: S.Set<QueryId>): string => {
    const qs = S.toList(s);
    if (qs.length === 0) return " - ? - ";
    const qId = qs[0];
    return fromMaybe(" - ? - ", preview(
      ix<ModelId, Entity<V>>(qId).dot(entityName(cls)).dot(nameText),
      model.modelContents,
    ));
  };
  const querySelector: DialogSelector_<E, W, Row> =
    constantDialog(
      promoteDialog(
        (g: Gadget_<E, W, S.Set<ModelId>>) => accum(focusing(_1<S.Set<ModelId>, Colour>(), g)),
        refPicker<V, W>(cls, true, (e: Entity<V>) => !hasnt(cls._QueryDiagram, e._entityContents)),
      ));
  return getInitialEnv<E, W, readonly Row[], readonly Row[]>((model) => table<E, W, Row>(
    [TableDelete, TableShuffle],
    [
      mkField<Row, S.Set<QueryId>>("Query", _1<S.Set<QueryId>, Colour>(), Nothing,
        EditFixed((s: S.Set<QueryId>) => queryName(model, s)), Nothing),
      mkField<Row, Colour>("Colour", _2<S.Set<QueryId>, Colour>(), Nothing, EditColour, Nothing),
    ],
    Just(querySelector),
  ));
}

/**
 * Iso between a "FieldStyle" and its name in the dialog.
 *
 * (Local to "entityShowTable" in Haskell.)
 */
export const styleName: Iso<FieldStyle, string> = (() => {
  const writeStyle = (s: FieldStyle): string => {
    switch (s) {
      case "FieldStyleNone":
        return "None";
      case "FieldStyleOutdent":
        return "Outdented";
      case "FieldStyleAbove":
        return "Above";
      default:
        return absurd(s);
    }
  };
  const readStyle = (t: string): FieldStyle => {
    switch (t) {
      case "Outdented":
        return FieldStyleOutdent;
      case "Above":
        return FieldStyleAbove;
      default:
        return FieldStyleNone;
    }
  };
  return iso(writeStyle, readStyle);
})();

/**
 * The error message for a list of rows in which a variant appears more than once (the
 * @uniqueVariants@ validation of "entityShowTable").
 *
 * (Local to "entityShowTable" in Haskell.)
 */
export function uniqueVariants<V>(cls: EntityClass<V>, xs: readonly FieldsShownRow<V>[]): Maybe<string> {
  // "head" safe here because "group" sublists are never zero length.
  const dups = L.group(L.sort(xs.map((x) => x[0]))).filter((g) => 1 < g.length).map((g) => L.head(g));
  if (dups.length === 0) return Nothing;
  return Just(cls.variantUserLabel(dups[0]) + " listed twice.");
}

/**
 * Table of fields to show for different types of entity.
 *
 * (Not exported by the Haskell module.)
 */
export function entityShowTable<V, W = any>(
  cls: EntityClass<V>,
  /** Entity variant names. */
  varNames: readonly Variant<V>[],
): Gadget_<Model<V>, W, readonly FieldsShownRow<V>[]> {
  type E = Model<V>;
  type Row = FieldsShownRow<V>;
  const fieldList = (ftable: FieldTable) => (fs: readonly EntityShowField[]): string =>
    T.intercalate(", ",
      mapMaybe((f: EntityShowField) => M.lookup(view(entityShowFieldId, f), ftable), fs)
        .map((f) => view(fieldName, f)));
  // varNameCombo :: Gadget' (Model v) w (Variant v)
  const varNameCombo = comboBox<E, W, Variant<V>>((_e) =>
    varNames.map((v) => ComboItem(cls.variantUserLabel(v), Nothing, Nothing, v)));
  const styleNames: string[] = [FieldStyleNone, FieldStyleOutdent, FieldStyleAbove].map((s) => view(styleName, s));
  // fieldsGadget :: Variant v -> Gadget' (Model v) w [EntityShowField]
  const fieldsGadget = (var_: Variant<V>): Gadget_<E, W, readonly EntityShowField[]> =>
    getInitialEnv<E, W, readonly EntityShowField[], readonly EntityShowField[]>((model) => {
      const exts = (v: Variant<V>): readonly FieldId[] => M.findWithDefault([], v, model.modelExtensions);
      const def = L.find((d: V) => equals(var_, cls.reflectiveName(d)), cls.reflectiveDefaults);
      const fieldIds: readonly FieldId[] = def.tag === "Just" ? reflection(cls, exts, def.value) : [];
      const ftable = withStampFields(withBuiltIn(model.modelFields));
      const revTable = fieldsByName(ftable);
      const fieldNames = view(fieldNameIso(ftable), fieldIds);
      const showFieldsIso: Iso<readonly EntityShowField[], readonly (readonly [FieldName, FieldStyle])[]> = iso(
        (sfs: readonly EntityShowField[]) => mapMaybe((sf: EntityShowField) => {
          const f = M.lookup(view(entityShowFieldId, sf), ftable);
          return f.tag === "Just" ? Just([view(fieldName, f.value), view(entityShowFieldStyle, sf)] as const) : Nothing;
        }, sfs),
        (rows: readonly (readonly [FieldName, FieldStyle])[]) => mapMaybe(([nm, sty]: readonly [FieldName, FieldStyle]) => {
          const f = M.lookup(nm, revTable);
          return f.tag === "Just" ? Just(EntityShowField(sty, (f.value as Field).fieldId)) : Nothing;
        }, rows),
      );
      type FRow = readonly [FieldName, FieldStyle];
      if (L.elem(var_, varNames)) {
        return accum(focusing(showFieldsIso, table<E, W, FRow>(
          [TableAdd<FRow>("Add field", ["Name", FieldStyleOutdent]), TableShuffle, TableDelete],
          [
            mkField<FRow, string>("Field", _1<FieldName, FieldStyle>(), Nothing, EditCombo(fieldNames), Nothing),
            mkField<FRow, string>("Label Style", _2<FieldName, FieldStyle>().dot(styleName), Nothing,
              EditCombo(styleNames), Nothing),
          ],
          Nothing,
        )));
      }
      return arr<E, W, readonly EntityShowField[], readonly EntityShowField[]>((x) => x);
    });
  // showFieldDialog :: DialogSelector' (Model v) w (Variant v, [EntityShowField])
  //
  // proc (var1, fields1) -> do
  //   var2 <- accum $ form Vertical [
  //       ("Select Entity Type:", focusing id varNameCombo)
  //     ] -< var1
  //   fields2 <- exec fieldsGadget -< (var2, fields1)
  //   returnA -< (var2, fields2)
  const showFieldDialog: DialogSelector_<E, W, Row> = constantDialog(
    Dialog("Diagram fields", OkButton, gPipe(
      gFanout(
        gPipe(
          arr<E, W, Row, Variant<V>>(([var1]) => var1),
          accum(form<E, W, Variant<V>>("Vertical", [
            ["Select Entity Type:", focusing(identity<Variant<V>>(), varNameCombo)],
          ])),
        ),
        arr<E, W, Row, readonly EntityShowField[]>(([, fields1]) => fields1),
      ),
      gFanout(
        arr<E, W, [Variant<V>, readonly EntityShowField[]], Variant<V>>(([var2]) => var2),
        exec<E, W, Variant<V>, readonly EntityShowField[], readonly EntityShowField[]>(fieldsGadget),
      ),
      arr<E, W, [Variant<V>, readonly EntityShowField[]], Row>(([var2, fields2]) => [var2, fields2]),
    )),
  );
  return validateText<E, W, readonly Row[], readonly Row[]>(
    (xs) => uniqueVariants(cls, xs),
    getInitialEnv<E, W, readonly Row[], readonly Row[]>((model) => {
      const ftable = withStampFields(withBuiltIn(model.modelFields));
      return table<E, W, Row>(
        [TableAdd<Row>("Type", [Variant<V>(""), []]), TableDelete],
        [
          mkField<Row, Variant<V>>("Type", _1<Variant<V>, readonly EntityShowField[]>(), Nothing,
            EditFixed((v: Variant<V>) => cls.variantUserLabel(v)), Nothing),
          mkField<Row, readonly EntityShowField[]>("Fields", _2<Variant<V>, readonly EntityShowField[]>(), Nothing,
            EditFixed(fieldList(ftable)), Nothing),
        ],
        Just(showFieldDialog),
      );
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// * Package Appearance

/**
 * The appearance data for a package consists of the appearance data of each type of diagram.
 * No type data is kept: it is for each type of diagram to recognise its own appearance data.
 */
export type PackageAppearance<A> = M.Map<Variant<A>, DiagramAppearance<null, A>>;

/** The codec of `PackageAppearance a` (a JSON object keyed by the variant names). */
export const JSON_PackageAppearance: J.JSONCodec<PackageAppearance<any>> =
  J.mapJ(JSONKey_Variant, JSON_DiagramAppearance);

/** Duplicate the PackageAppearance with updated model IDs where appropriate. */
export function clonePackageAppearance<A>(
  f: (m: ModelId) => Maybe<ModelId>,
  pa: PackageAppearance<A>,
): PackageAppearance<A> {
  return M.map((da: DiagramAppearance<null, A>) => cloneDiagramAppearance(f, da), pa);
}

export function packageAppearanceDialog<P, V, W = any>(
  cls: AppearanceDialogClass<P, V>,
): Dialog_<Model<V>, W, PackageAppearance<V>> {
  return Dialog("Style of Diagrams in this Package", OkApplyButton, accum(packageAppearanceGadget<P, V, W>(cls)));
}

export function packageAppearanceGadget<P, V, W = any>(
  cls: AppearanceDialogClass<P, V>,
): GadgetF_<Model<V>, W, PackageAppearance<V>> {
  type DA = DiagramAppearance<null, V>;
  const at1 = (k: Variant<V>): Lens<PackageAppearance<V>, DA> => lens(
    (s: PackageAppearance<V>) => M.findWithDefault<Variant<V>, DA>(mempty_DiagramAppearance, k, s),
    (s: PackageAppearance<V>, v: DA) => (equals(v, mempty_DiagramAppearance) ? M.delete_(k, s) : M.insert(k, v, s)),
  );
  const tab = (var_: Variant<V>): readonly [string, GadgetF_<Model<V>, W, PackageAppearance<V>>] => [
    cls.variantUserLabel(var_),
    focusingOver(at1(var_), diagramAppearanceGadget<P, V, W, null>(cls, var_)),
  ];
  return tabForm(M.keys(cls.diagramEntityTypes).map(tab));
}

/** Clean up the fields shown for each diagram type. */
export function packageAppearanceClean<V>(pa: PackageAppearance<V>): PackageAppearance<V> {
  return M.map((da: DiagramAppearance<null, V>) => diagramAppearanceClean(da), pa);
}

// ---------------------------------------------------------------------------------------------
// * Diagram Layouts

/** The hanging indent of a labelled field (in Pango units for "Pango.layoutSetIndent"). */
const indent = 20;

/** The fields shown for an entity type that is not listed. */
const defaultFields: readonly EntityShowField[] = [EntityShowField(FieldStyleNone, descriptionField)];

/**
 * Convert a colour to the 16 bit channels of a Pango colour attribute.
 *
 * (Local to "diagramLayout" in Haskell.)
 */
export function colourForFont(c: Colour): [number, number, number] {
  const { channelRed: r, channelGreen: g, channelBlue: b } = C.toSRGB(getColour(c));
  return [round(r * 65535), round(g * 65535), round(b * 65535)];
}

/**
 * An attribute list colouring text with the background colour, and the text from byte index
 * @s@ to @e@ in the contrasting text colour. No colour gives an empty list.
 *
 * (Local to "diagramLayout" in Haskell. The indices are passed to Pango unchanged, so they are
 * UTF-8 byte indices.)
 */
export function colourText(colour: Maybe<Colour>, s: number, e: number): Pango.AttrList {
  if (colour.tag === "Nothing") return Pango.attrListNew();
  const [bgr, bgg, bgb] = colourForFont(colour.value);
  const [fgr, fgg, fgb] = colourForFont(contrastText(colour.value));
  const fgAttr = Pango.attrForegroundNew(fgr, fgg, fgb);
  Pango.set(fgAttr, { startIndex: s, endIndex: e });
  const bgAttr = Pango.attrBackgroundNew(bgr, bgg, bgb);

  const lst = Pango.attrListNew();
  Pango.attrListInsert(lst, fgAttr);
  Pango.attrListInsert(lst, bgAttr);
  return lst;
}

/** Haskell `maxBound :: Word32`: the end index meaning \"to the end of the text\". */
const maxBoundWord32 = 0xffffffff;

/**
 * The text and attribute list of an outdented field: @label: value@, with the label and colon
 * in bold and the value in the colour of the field's format.
 *
 * (Part of the local "layoutLabelledField" of "diagramLayout" in Haskell.) As in the Haskell,
 * the attribute indices are computed from the number of characters ("T.length"), although
 * Pango indices are UTF-8 byte offsets; so for labels and values containing non-ASCII
 * characters the bold and coloured spans end earlier than the label and value, exactly as in
 * the original program.
 */
export function labelledFieldAttributes(
  lbl: string,
  v: ExtValue,
  colour: Maybe<Colour>,
): [string, Pango.AttrList] {
  const txt = lbl + ": " + displayValue(v);
  const attrList = colourText(colour, T.length(lbl) + 2, T.length(txt));
  const boldAttr1 = Pango.attrWeightNew(Pango.WeightBold);
  Pango.set(boldAttr1, { endIndex: T.length(lbl) + 1 });
  Pango.attrListInsert(attrList, boldAttr1); // This disowns boldAttr1, so can't use it again.
  return [txt, attrList];
}

/** Display entity fields on a diagram of type @t@. */
export function diagramLayout<V, W>(ctx: ModelEditCtx<V, W>, style: EntityShowFields<V>): HadesLayout<void> {
  return withBaseType(ctx, (c: ModelEditCtx<V, V>): HadesLayout<void> => {
    const cur = current(c);
    switch (cur.tag) {
      case "Nothing":
        return layoutText([], "Internal error: root entity should not appear on a diagram.");
      case "Just": {
        const cls = c.cls;
        const ent = cur.value;
        const typ = cls.reflectiveName(ent._entityContents);
        const values = entityPropertiesWithStamps(cls, ent);
        const ftable = withStampFields(withBuiltIn(getModel(c).modelFields));
        return (env, st) => {
          for (const fs of M.findWithDefault(defaultFields, typ, fieldsShownMap(style))) {
            const fid = view(entityShowFieldId, fs);
            const fVal = M.findWithDefault<FieldId, ExtValue>(ExtNone, fid, values);
            // case ftable ^? ix fid . fieldName of
            const mf = M.lookup(fid, ftable);
            if (mf.tag === "Nothing") continue;
            const fname = view(fieldName, mf.value);
            const fstyle = view(entityShowFieldStyle, fs);
            switch (fstyle) {
              case "FieldStyleNone":
                layoutField(fVal, M.lookup(fid, ftable))(env, st);
                break;
              case "FieldStyleOutdent":
                layoutLabelledField(fname, fVal, M.lookup(fid, ftable))(env, st);
                break;
              case "FieldStyleAbove":
                if (fVal.tag === "ExtNone") break;
                layoutHLine(env, st);
                layoutTitle(Nothing, fname)(env, st);
                layoutField(M.findWithDefault<FieldId, ExtValue>(ExtNone, fid, values), M.lookup(fid, ftable))(env, st);
                break;
              default:
                absurd(fstyle);
            }
          }
        };
      }
      default:
        return absurd(cur);
    }
  });
}

/** The local "layoutField" of "diagramLayout": a field value, with its icon and colour. */
function layoutField(v: ExtValue, mField: Maybe<Field>): HadesLayout<void> {
  return (env, st) => {
    if (v.tag === "ExtNone") return;
    if (mField.tag === "Nothing") {
      layoutParagraphs([], displayValue(v))(env, st);
      return;
    }
    const typ = mField.value._fieldType;
    const [icon1, colour] = valueFormat(typ, v);
    const textPart: HadesLayout<void> = (env1, st1) => {
      const attrList = colourText(colour, 0, maxBoundWord32);
      const acts = L.intersperse(
        layoutParagraphGap,
        T.splitOn("\n\n", displayValue(v)).map((t) =>
          layoutText([(l) => () => Pango.layoutSetAttributes(l, attrList)], t)),
      );
      for (const act of acts) act(env1, st1);
      if (equals(typ, BuiltInDef("ModelNote"))) layoutParagraphGap(env1, st1);
    };
    const pix = icon1.tag === "Just" ? getIcon(icon1.value)(env, st) : Nothing;
    switch (pix.tag) {
      case "Nothing":
        textPart(env, st);
        return;
      case "Just": {
        const p = pix.value;
        const iconWidth = Gdk.pixbufGetWidth(p);
        layoutParallel(iconWidth, 3, layoutPixbuf(false, Nothing, p), textPart)(env, st);
        return;
      }
      default:
        return absurd(pix);
    }
  };
}

/** The local "layoutLabelledField" of "diagramLayout": @label: value@ with a bold label. */
function layoutLabelledField(lbl: string, v: ExtValue, mField: Maybe<Field>): HadesLayout<void> {
  return (env, st) => {
    if (v.tag === "ExtNone") return;
    const mTyp = mField.tag === "Just" ? Just(mField.value._fieldType) : Nothing;
    const [icon1, colour] = mTyp.tag === "Just" ? valueFormat(mTyp.value, v) : [Nothing, Nothing];
    const [txt, attrList] = labelledFieldAttributes(lbl, v, colour);
    const textPart = layoutText([
      // Haskell: (`Pango.layoutSetIndent` (-indent)). The indent is in Pango units, so this
      // hanging indent of 20/1024 of a point is invisible, as in the original.
      (l) => () => Pango.layoutSetIndent(l, -indent),
      (l) => () => Pango.layoutSetAttributes(l, attrList),
    ], txt);
    if (mTyp.tag === "Nothing" || icon1.tag === "Nothing") {
      textPart(env, st);
      return;
    }
    // No way in Pango to have an icon inlined with text, so bodge it.
    const boldAttr2 = Pango.attrWeightNew(Pango.WeightBold);
    const boldList = Pango.attrListNew();
    Pango.attrListInsert(boldList, boldAttr2);
    layoutText([(l) => () => Pango.layoutSetAttributes(l, boldList)], lbl + ":")(env, st);
    layoutParallel(indent, 0, () => {}, layoutField(v, mField))(env, st);
  };
}

/** The local "getIcon" of "diagramLayout": look up a 16x16 icon in the data icon theme. */
function getIcon(nm: string): HadesLayout<Maybe<Gdk.Pixbuf>> {
  // Not sure about performance here. Does GTK3 cache the pixmaps?
  return (env, _st) => {
    const sz = 16;
    const iconTheme = env.style.dataIcons;
    const info = Gtk.iconThemeLookupIcon(iconTheme, nm, sz, []);
    return info === null ? Nothing : Just(Gtk.iconInfoLoadIcon(info));
  };
}
