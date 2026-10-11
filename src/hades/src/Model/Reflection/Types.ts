// Ported from hades/src/Model/Reflection/Types.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module defines the type system used for extending models.
 *
 * Type definitions have to be represented in at least two ways: with textual names for
 * field types that refers to some symbol table, and a "compiled" version with the actual
 * field type data. There might also need to be a \"Maybe\" version for type names not found.
 * A naive implementation would have these as distinct types, such as:
 *
 * ```haskell
 * data StructRaw = StructRaw [(Text, TypeName)]
 *
 * data StructMaybe = StructMaybe [(Text, Maybe TypeDef)]
 *
 * data Struct = Struct [(Text, TypeDef)]
 * ```
 *
 * A solution is to use \"Higher Kinded Data\" (HKD). This uses a functor applied to
 * each field in a data type and generic functions to transform between functors.
 * See http://reasonablypolymorphic.com/blog/higher-kinded-data for details.
 *
 * This lets us define a collection of data types to define the HADES type system and then
 * instantiate them with type names, maybes, or any other functor.
 *
 * The gain in this case is particularly marked because the only type that actually uses HKD
 * is the "Field". All the rest simply have the functor paramter tramp down through them.
 *
 * In addition to those listed below, there is an additional function exported by this module.
 * This cannot have its type included in the code, so Haddock will not display it. The reason is
 * that it uses the "HKD" type family which is non-injective. The function is:
 *
 * ```haskell
 * elaborateTypeDef :: (Functor f, Functor g, Applicative m) =>
 *    Elaboration m f g -> TypeDef' f -> TypeDef' g
 * ```
 *
 * This will convert a "TypeDef'" from one functor to another.
 *
 * TypeScript port
 * ---------------
 * The documentation above describes an earlier design. In the Haskell source this module was
 * ported from, `Field` and `TypeDef` are ordinary (non-HKD) types and there is no
 * `elaborateTypeDef`; only the (unexported, unused) `HKD` type family remains. It is kept here
 * as a conditional type over a functor tag (`HKD<"Identity", A> = A`, `HKD<"Maybe", A> =
 * Maybe<A>`), since TypeScript cannot abstract over type constructors.
 *
 * * Enumerations (`BuiltInType`, `Multiplicity`, `Cardinality`) are string literal unions with
 *   `...Values` arrays in constructor order.
 * * `DecoType a` is a GADT: a tagged union whose `DecoBool` constructor returns
 *   `DecoType<boolean>`. It has only a `ToJSON` instance, which is `ToJSON_DecoType(codecA)`;
 *   `decoRangeFromJSON(codecA, obj)` parses the `DecoRange` form.
 * * `Colour` (the `Reactive.Banana.Common` newtype, an alias of the `@/lib/Data/Colour` class)
 *   is encoded with `J.colourJ` (`Data.Aeson.Orphan`); `getColour`/`Colour` wrapping is dropped.
 * * `Range a` is a tuple `readonly [Maybe<A>, Maybe<A>]`; ordering uses the structural `compare`.
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing, fromMaybe, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { ge, le } from "@/lib/Data/Ord";
import { absurd } from "@/lib/Prelude";
import { iso, lens, prism, prism_, review, type Iso, type Lens, type Prism } from "@/lib/Control/Lens";
import { type Colour, type IconName, colourPrism } from "@/banana-ui/base/Reactive/Banana/Common";

// ---------------------------------------------------------------------------------------------
// Aeson Utility Operators

/** Haskell `(..=)`: type-restricted version of "(.=)" to silence compiler warnings about defaults. */
export function textPair(k: string, v: string): [string, J.Value] {
  return [k, v];
}

/** Haskell `(..:)`: type restricted version of "(.:)" to silence compiler warnings about defaults. */
export function textField(o: J.JSONObject, k: string): string {
  return J.field(o, k, J.textJ);
}

// ---------------------------------------------------------------------------------------------
// Ranges With Optional Bounds

/** Inclusive range with optional boundaries. */
export type Range<A> = readonly [Maybe<A>, Maybe<A>];

export function validRange<A>(r: Range<A>): boolean {
  const [b1, b2] = r;
  if (b1.tag === "Just" && b2.tag === "Just") return le(b1.value, b2.value);
  return true;
}

/** True iff the value is in the range. */
export function inRange<A>(rng: Range<A>, v: A): boolean {
  const [b1, b2] = rng;
  return (b1.tag === "Nothing" || ge(v, b1.value)) && (b2.tag === "Nothing" || le(v, b2.value));
}

/** Prism for values within the range. */
export function rangePrism<A>(rng: Range<A>): Prism<A, A> {
  return prism((v: A) => v, (v: A) => (inRange(rng, v) ? Right(v) : Left(v)));
}

/**
 * A default value within the range. The result is the first valid one of; the second
 * argument, the lower bound and the upper bound.
 */
export function rangeDefault<A>(rng: Range<A>, d: A): A {
  const [lower, upper] = rng;
  return inRange(rng, d) ? d : fromMaybe(fromMaybe(d, upper), lower);
}

/**
 * Associates ranges of one type with values of another type. If the ranges overlap then
 * the first matching range is used.
 */
export type RangeMap<A, B> = readonly (readonly [Range<A>, B])[];

/** Apply a "RangeMap" to a value. */
export function rangeMap<A, B>(rs: RangeMap<A, B>, x: A): Maybe<B> {
  const r = rs.find(([rng]) => inRange(rng, x));
  return r ? Just(r[1]) : Nothing;
}

/**
 * The Higher Kinded Data type family. Used to elide the Identity functor from
 * the base case.
 *
 * The functor is named by a tag: `HKD<"Identity", A> = A`, `HKD<"Maybe", A> = Maybe<A>`.
 */
// Not exported (as in Haskell) and not used by any type in this module.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type HKD<F extends "Identity" | "Maybe", A> = F extends "Identity" ? A : Maybe<A>;

// ---------------------------------------------------------------------------------------------
// Basic Data Types

/** Field type identifiers. */
export type FieldId = U.UUID;

export type TypeName = string;

/**
 * The base types built in to HADES.
 *
 * * `ModelInt`: Arbitrary precision integers.
 * * `ModelReal`: Double precision float.
 * * `ModelText`: Short one-line text strings.
 * * `ModelURL`: Hyperlinks.
 * * `ModelNote`: Long text strings, possibly with multiple paragraphs.
 */
export type BuiltInType =
  | "ModelBool"
  | "ModelInt"
  | "ModelReal"
  | "ModelText"
  | "ModelURL"
  | "ModelNote"
  | "ModelDate";
export const builtInTypeValues: readonly BuiltInType[] = [
  "ModelBool", "ModelInt", "ModelReal", "ModelText", "ModelURL", "ModelNote", "ModelDate",
];

/** `instance Show BuiltInType` */
export function show_BuiltInType(t: BuiltInType): string {
  return builtInName(t);
}

/** `instance Default BuiltInType` */
export const def_BuiltInType: BuiltInType = "ModelText";

export const builtInNames: readonly (readonly [BuiltInType, string])[] = [
  ["ModelBool", "Boolean"],
  ["ModelInt", "Integer"],
  ["ModelReal", "Real"],
  ["ModelText", "Text"],
  ["ModelURL", "URL"],
  ["ModelNote", "Note"],
  ["ModelDate", "Date"],
];

/** Haskell `array (minBound, maxBound) builtInNames`. */
const builtInNameTable: ReadonlyMap<BuiltInType, string> = new Map(builtInNames);

/** Name of the built-in type. */
export function builtInName(t: BuiltInType): string {
  const r = builtInNameTable.get(t);
  if (r === undefined) throw new Error("Data.Array.!: undefined array element");
  return r;
}

/**
 * Some of the basic types can be \"decorated\" with icons and colours and boundaries.
 * Each decorated version is a new type.
 *
 * * `DecoBool`: Icons and colours for @False@ and @True@ respectively. (Only for `DecoType Bool`.)
 * * `DecoRange`: Icons and colours for ranges within type @a@.
 */
export type DecoType<A> =
  | {
      readonly tag: "DecoBool";
      readonly _0: Maybe<readonly [IconName, IconName]>;
      readonly _1: Maybe<readonly [Colour, Colour]>;
    }
  | {
      readonly tag: "DecoRange";
      readonly _0: Range<A>;
      readonly _1: RangeMap<A, readonly [Maybe<IconName>, Maybe<Colour>]>;
    };

/** Icons and colours for @False@ and @True@ respectively. */
export function DecoBool(
  _0: Maybe<readonly [IconName, IconName]>,
  _1: Maybe<readonly [Colour, Colour]>,
): DecoType<boolean> {
  return { tag: "DecoBool", _0, _1 };
}

/** Icons and colours for ranges within type @a@. */
export function DecoRange<A>(
  _0: Range<A>,
  _1: RangeMap<A, readonly [Maybe<IconName>, Maybe<Colour>]>,
): DecoType<A> {
  return { tag: "DecoRange", _0, _1 };
}

/**
 * `instance (Show a) => Show (DecoType a)`. The first argument is the `show` for @a@
 * (e.g. `showInt` for `Integer`, `showDouble` for `Double`).
 */
export function show_DecoType<A>(showA: (a: A) => string, d: DecoType<A>): string {
  const showColour = (c: Colour): string => review(colourPrism, c);
  switch (d.tag) {
    case "DecoBool": {
      const icons = d._0, colours = d._1;
      const falseIcon = icons.tag === "Just" ? icons.value[0] : "-";
      const trueIcon = icons.tag === "Just" ? icons.value[1] : "-";
      const falseColour = colours.tag === "Just" ? showColour(colours.value[0]) : "-";
      const trueColour = colours.tag === "Just" ? showColour(colours.value[1]) : "-";
      return "DecoBool (False = (" + falseIcon + ", " + falseColour +
        "), True = (" + trueIcon + ", " + trueColour + "))";
    }
    case "DecoRange": {
      const showM = (m: Maybe<A>): string => (m.tag === "Just" ? showA(m.value) : "-");
      const showRange = ([l, u]: Range<A>): string => "(" + showM(l) + " to " + showM(u) + ")";
      const showSub = ([r1, [mIcon, mColour]]: readonly [Range<A>, readonly [Maybe<IconName>, Maybe<Colour>]]): string =>
        showRange(r1) + " -> " + "(" + (mIcon.tag === "Just" ? mIcon.value : "-") + ", " +
          (mColour.tag === "Just" ? showColour(mColour.value) : "-") + ")";
      return "DecoRange " + showRange(d._0) + ": [" + d._1.map(showSub).join(", ") + "]";
    }
    default:
      return absurd(d);
  }
}

/** `instance {-# OVERLAPPING #-} Default (DecoType Bool)` */
export const def_DecoType_Bool: DecoType<boolean> = DecoBool(Nothing, Nothing);

/** `instance Default (DecoType a)` */
export const def_DecoType: DecoType<never> = DecoRange<never>([Nothing, Nothing], []);

/** JSON codec for a `Range a`: `[lower, upper]` with `null` for a missing bound. */
function rangeJ<A>(ca: J.JSONCodec<A>): J.JSONCodec<Range<A>> {
  return J.tuple2J(J.maybeJ(ca), J.maybeJ(ca)) as unknown as J.JSONCodec<Range<A>>;
}

/** JSON codec for the `(Maybe IconName, Maybe Colour)` pairs in a decoration range map. */
const decorationJ: J.JSONCodec<readonly [Maybe<IconName>, Maybe<Colour>]> =
  J.tuple2J(J.maybeJ(J.textJ), J.maybeJ(J.colourJ)) as unknown as J.JSONCodec<readonly [Maybe<IconName>, Maybe<Colour>]>;

/** JSON codec for a `RangeMap a (Maybe IconName, Maybe Colour)`. */
function decoRangeMapJ<A>(ca: J.JSONCodec<A>): J.JSONCodec<RangeMap<A, readonly [Maybe<IconName>, Maybe<Colour>]>> {
  return J.listJ(J.tuple2J(rangeJ(ca), decorationJ)) as unknown as
    J.JSONCodec<RangeMap<A, readonly [Maybe<IconName>, Maybe<Colour>]>>;
}

const iconPairJ = J.tuple2J(J.textJ, J.textJ) as unknown as J.JSONCodec<readonly [IconName, IconName]>;
const colourPairJ = J.tuple2J(J.colourJ, J.colourJ) as unknown as J.JSONCodec<readonly [Colour, Colour]>;

/**
 * `instance (ToJSON a) => ToJSON (DecoType a)`.
 *
 * A well-typed FromJSON instance for DecoType is not possible.
 */
export function ToJSON_DecoType<A>(ca: J.JSONCodec<A>): J.ToJSON<DecoType<A>> {
  return {
    toJSON(d: DecoType<A>): J.Value {
      switch (d.tag) {
        case "DecoBool":
          return J.object([
            ["icons", J.maybeJ(iconPairJ).toJSON(d._0)],
            ["colours", J.maybeJ(colourPairJ).toJSON(d._1)],
          ]);
        case "DecoRange":
          return J.object([
            ["range", rangeJ(ca).toJSON(d._0)],
            ["map", decoRangeMapJ(ca).toJSON(d._1)],
          ]);
        default:
          return absurd(d);
      }
    },
  };
}

/** Read a Decorated Range from JSON. A @FromJSON@ instance would lead to overlapping instances. */
export function decoRangeFromJSON<A>(ca: J.JSONCodec<A>, v: J.JSONObject): DecoType<A> {
  return DecoRange(J.field(v, "range", rangeJ(ca)), J.field(v, "map", decoRangeMapJ(ca)));
}

/** An enumeration consists of a list of items, each of which has a name and display properties. */
export interface EnumItem {
  readonly _enumItemName: string;
  readonly _enumItemIcon: Maybe<IconName>;
  readonly _enumItemColour: Maybe<Colour>;
}
export function EnumItem(_enumItemName: string, _enumItemIcon: Maybe<IconName>, _enumItemColour: Maybe<Colour>): EnumItem {
  return { _enumItemName, _enumItemIcon, _enumItemColour };
}

export const enumItemName: Lens<EnumItem, string> =
  lens((s: EnumItem) => s._enumItemName, (s, t: string) => ({ ...s, _enumItemName: t }));

export const enumItemIcon: Lens<EnumItem, Maybe<IconName>> =
  lens((s: EnumItem) => s._enumItemIcon, (s, i: Maybe<IconName>) => ({ ...s, _enumItemIcon: i }));

export const enumItemColour: Lens<EnumItem, Maybe<Colour>> =
  lens((s: EnumItem) => s._enumItemColour, (s, c: Maybe<Colour>) => ({ ...s, _enumItemColour: c }));

/** `instance ToJSON EnumItem` and `instance FromJSON EnumItem` */
export const JSON_EnumItem: J.JSONCodec<EnumItem> = J.codec(
  (i) => J.object([
    ["name", i._enumItemName],
    ["icon", J.maybeJ(J.textJ).toJSON(i._enumItemIcon)],
    ["colour", J.maybeJ(J.colourJ).toJSON(i._enumItemColour)],
  ]),
  (v) => J.withObject("EnumItem", (o) => EnumItem(
    T.strip(J.field(o, "name", J.textJ)),
    J.fieldMaybe(o, "icon", J.textJ),
    J.fieldMaybe(o, "colour", J.colourJ),
  ), v),
);

export type EnumType = readonly EnumItem[];

/**
 * Data fields have a multiplicity.
 *
 * * `One`: Exactly one of these is included.
 * * `Optional`: The field is optional: a value may or may not be present.
 */
export type Multiplicity = "One" | "Optional";
export const multiplicityValues: readonly Multiplicity[] = ["One", "Optional"];

/** `instance ToJSON Multiplicity` and `instance FromJSON Multiplicity` */
export const JSON_Multiplicity: J.JSONCodec<Multiplicity> = J.codec(
  (m) => m,
  (v) => J.withText("Multiplicity", (str) => {
    // `readMaybe` allows surrounding white space.
    const t = str.trim();
    if ((multiplicityValues as readonly string[]).includes(t)) return t as Multiplicity;
    return J.fail("Multiplicity not recognised.");
  }, v),
);

// ---------------------------------------------------------------------------------------------
// Composite Data Types

export type FieldName = string;

/** A field is a field name, multiplicity and type definition. */
export interface Field {
  /** Only True for certain built-in fields. */
  readonly fieldReadOnly: boolean;
  readonly fieldId: FieldId;
  readonly _fieldName: FieldName;
  readonly _fieldMulti: Multiplicity;
  readonly _fieldType: TypeDef;
}
export function Field(
  fieldReadOnly: boolean,
  fieldId: FieldId,
  _fieldName: FieldName,
  _fieldMulti: Multiplicity,
  _fieldType: TypeDef,
): Field {
  return { fieldReadOnly, fieldId, _fieldName, _fieldMulti, _fieldType };
}

/** `instance Show Field` */
export function show_Field(f: Field): string {
  // As in the Haskell, the "if" extends to the end of the expression, so a read-only field
  // shows as just "Field (RO) ".
  return "Field " + (f.fieldReadOnly
    ? "(RO) "
    : "" + U.toText(f.fieldId) + " " + T.showText(f._fieldName) + " " + f._fieldMulti + " " +
      T.showText(typeDescription(f._fieldType)));
}

/** `instance ToJSON Field` and `instance FromJSON Field` */
export const JSON_Field: J.JSONCodec<Field> = J.codec(
  (f) => J.object([
    ["id", J.uuidJ.toJSON(f.fieldId)],
    ["name", f._fieldName],
    ["multi", JSON_Multiplicity.toJSON(f._fieldMulti)],
    ["type", JSON_TypeDef.toJSON(f._fieldType)],
  ]),
  (v) => J.withObject("Field", (obj) => {
    const nm = T.strip(J.field(obj, "name", J.textJ));
    const multi = J.field(obj, "multi", JSON_Multiplicity);
    const typ = J.field(obj, "type", JSON_TypeDef);
    const fid = J.fieldDefault(obj, "id", J.uuidJ, migrateField(nm));
    return Field(false, fid, nm, multi, typ);
  }, v),
);

export const fieldName: Lens<Field, FieldName> =
  lens((s: Field) => s._fieldName, (s, n: FieldName) => ({ ...s, _fieldName: n }));

export const fieldMulti: Lens<Field, Multiplicity> =
  lens((s: Field) => s._fieldMulti, (s, m: Multiplicity) => ({ ...s, _fieldMulti: m }));

export const fieldType: Lens<Field, TypeDef> =
  lens((s: Field) => s._fieldType, (s, t: TypeDef) => ({ ...s, _fieldType: t }));

/**
 * Old-style fields from before Version 1.4 did not have an ID, and were identified by name.
 * This caused issues when the name changed. Migration to fields that are identified by a UUID
 * required that these old fields be assigned a UUID. This was done using the UUID V5 scheme
 * which uses the SHA-1 hash of the fieldname.
 */
export function migrateField(nm: FieldName): FieldId {
  return U.generateNamed(U.nil, U.encodeUtf8(nm));
}

/**
 * Like "migrateField" but also checks to see if the text is already a UUID. If it is then
 * it parses that directly instead of treating it as a field name to be migrated.
 */
export function migrateField1(str: string): FieldId {
  const r = U.fromText(str);
  return r.tag === "Just" ? r.value : migrateField(str);
}

export type FieldTable = M.Map<FieldId, Field>;

/** Fields indexed by name instead of ID. */
export function fieldsByName(ftable: FieldTable): M.Map<FieldName, Field> {
  return M.fromList(M.elems(ftable).map((f) => [f._fieldName, f] as [FieldName, Field]));
}

/**
 * Useful in dialogs that allow the selection of multiple fields. If any field IDs or names
 * are not found in the @FieldTable@ then they are silently dropped (so not a true ISO).
 */
export function fieldNameIso(ftable: FieldTable): Iso<readonly FieldId[], readonly FieldName[]> {
  const revTable = fieldsByName(ftable);
  return iso(
    (fids: readonly FieldId[]) => mapMaybe((fid: FieldId) => {
      const f = M.lookup(fid, ftable);
      return f.tag === "Just" ? Just(f.value._fieldName) : Nothing;
    }, fids),
    (nms: readonly FieldName[]) => mapMaybe((nm: FieldName) => {
      const f = M.lookup(nm, revTable);
      return f.tag === "Just" ? Just(f.value.fieldId) : Nothing;
    }, nms),
  );
}

/**
 * Cardinality annotations. Originally introduced for GSN Edges, but might also be used elsewhere.
 *
 * * `CardinalityOne`: Exactly one. The default.
 * * `CardinalityOpt`: Optional; 0 or 1.
 * * `CardinalityMany`: 0 to @n@.
 * * `CardinalityMany1`: 1 to @n@.
 */
export type Cardinality = "CardinalityOne" | "CardinalityOpt" | "CardinalityMany" | "CardinalityMany1";
export const cardinalityValues: readonly Cardinality[] = [
  "CardinalityOne", "CardinalityOpt", "CardinalityMany", "CardinalityMany1",
];

/** `instance Show Cardinality` */
export function show_Cardinality(c: Cardinality): string {
  return cardinalityToText(c);
}

/** `instance ToJSON Cardinality` and `instance FromJSON Cardinality` */
export const JSON_Cardinality: J.JSONCodec<Cardinality> = J.codec(
  (c) => cardinalityToText(c),
  (v) => J.withText("Gsn Edge Cardinality", (txt) => {
    const c = cardinalityFromText(txt);
    if (c.tag === "Just") return c.value;
    return J.fail("Not a GSN Edge Cardinality Type: " + T.showText(txt));
  }, v),
);

export function cardinalityToText(c: Cardinality): string {
  switch (c) {
    case "CardinalityOne": return "One";
    case "CardinalityOpt": return "Optional";
    case "CardinalityMany": return "0-n";
    case "CardinalityMany1": return "1-n";
    default: return absurd(c);
  }
}

export function cardinalityFromText(t: string): Maybe<Cardinality> {
  switch (t) {
    case "One": return Just("CardinalityOne");
    case "Optional": return Just("CardinalityOpt");
    case "0-n": return Just("CardinalityMany");
    case "1-n": return Just("CardinalityMany1");
    default: return Nothing;
  }
}

/** A Prism for converting between "Text" and "GsnEdgeCard" using the functions above. */
export const cardinalityText: Prism<string, Cardinality> = prism_(cardinalityToText, cardinalityFromText);

/**
 * Field names that are built in to the model.
 *
 * This is a non-modular and non-extensible piece of design. When a new built-in field is added
 * to the metamodel it has to be included here by editing this list.
 *
 * ToDo: make built-in fields properly extensible.
 */
export const builtInFields: FieldTable = (() => {
  const item = (i: Cardinality): EnumItem => EnumItem(cardinalityToText(i), Nothing, Nothing);
  const cardDef = EnumDef(cardinalityValues.map(item));
  const mkPair = ([nm, multi, typ]: readonly [FieldName, Multiplicity, TypeDef]): [FieldId, Field] => {
    const fid = migrateField(nm);
    return [fid, Field(false, fid, nm, multi, typ)];
  };
  const defs: readonly (readonly [FieldName, Multiplicity, TypeDef])[] = [
    ["Name", "One", BuiltInDef("ModelText")],
    ["Description", "One", BuiltInDef("ModelNote")],
    ["Hidden", "One", BuiltInDef("ModelBool")],
    ["Count", "One", BuiltInDef("ModelInt")],
    ["Inhibit", "One", BuiltInDef("ModelBool")],
    ["Developed", "One", BuiltInDef("ModelBool")],
    ["Instantiated", "One", BuiltInDef("ModelBool")],
    ["Cardinality", "One", cardDef],
  ];
  return M.fromList(defs.map(mkPair));
})();

/**
 * Add the built-in fields to the field table, overriding any of the same name.
 *
 * Note: if new built-in fields are defined then they must be manually added
 * to this module as well.
 */
export function withBuiltIn(ftable: FieldTable): FieldTable {
  return M.union(builtInFields, ftable);
}

// | Like "withBuiltIn" but with the stamp fields too.

export type TypeDef =
  | { readonly tag: "BuiltInDef"; readonly _0: BuiltInType }
  | { readonly tag: "DecoBoolDef"; readonly _0: DecoType<boolean> }
  | { readonly tag: "DecoIntDef"; readonly _0: DecoType<number> }
  | { readonly tag: "DecoRealDef"; readonly _0: DecoType<number> }
  | { readonly tag: "EnumDef"; readonly _0: EnumType };

export function BuiltInDef(_0: BuiltInType): TypeDef {
  return { tag: "BuiltInDef", _0 };
}
export function DecoBoolDef(_0: DecoType<boolean>): TypeDef {
  return { tag: "DecoBoolDef", _0 };
}
/** Decorated `Integer`. */
export function DecoIntDef(_0: DecoType<number>): TypeDef {
  return { tag: "DecoIntDef", _0 };
}
/** Decorated `Double`. */
export function DecoRealDef(_0: DecoType<number>): TypeDef {
  return { tag: "DecoRealDef", _0 };
}
export function EnumDef(_0: EnumType): TypeDef {
  return { tag: "EnumDef", _0 };
}

/** Insert the "kind" key into the object encoding of a DecoType (`H.insert "kind" k obj`). */
function withKind(kind: string, v: J.Value): J.Value {
  if (!J.isObject(v)) throw new Error("Irrefutable pattern failed: Object obj = toJSON deco");
  return { ...v, kind };
}

/** The `builtIns` table of the `FromJSON TypeDef` instance: built-in types by name. */
const builtInsByName: M.Map<string, BuiltInType> =
  M.fromList(builtInNames.map(([t, n]) => [n, t] as [string, BuiltInType]));

/** `instance ToJSON TypeDef` and `instance FromJSON TypeDef` */
export const JSON_TypeDef: J.JSONCodec<TypeDef> = J.codec(
  (t: TypeDef): J.Value => {
    switch (t.tag) {
      case "BuiltInDef":
        return J.object([textPair("kind", "built-in"), ["type", show_BuiltInType(t._0)]]);
      case "DecoBoolDef":
        return withKind("deco-bool", ToJSON_DecoType(J.boolJ).toJSON(t._0));
      case "DecoIntDef":
        return withKind("deco-int", ToJSON_DecoType(J.integerJ).toJSON(t._0));
      case "DecoRealDef":
        return withKind("deco-real", ToJSON_DecoType(J.doubleJ).toJSON(t._0));
      case "EnumDef":
        return J.object([
          ["kind", "enum"],
          ["values", J.listJ(JSON_EnumItem).toJSON([...t._0])],
        ]);
      default:
        return absurd(t);
    }
  },
  (val) => J.withObject("TypeDef", (v): TypeDef => {
    const builtIns = builtInsByName;
    const kind = textField(v, "kind");
    switch (kind) {
      case "built-in": {
        const nm = J.field(v, "type", J.textJ);
        const ty = M.lookup(nm, builtIns);
        if (ty.tag === "Nothing") return J.fail("Unknown built-in type: " + T.showText(nm));
        return BuiltInDef(ty.value);
      }
      case "deco-bool":
        return DecoBoolDef(DecoBool(J.fieldMaybe(v, "icons", iconPairJ), J.fieldMaybe(v, "colours", colourPairJ)));
      case "deco-int":
        return DecoIntDef(decoRangeFromJSON(J.integerJ, v));
      case "deco-real":
        return DecoRealDef(decoRangeFromJSON(J.doubleJ, v));
      case "enum":
        return EnumDef(J.field(v, "values", J.listJ(JSON_EnumItem)));
      default:
        return J.fail("Unrecognised kind of type: " + T.showText(kind));
    }
  }, val),
);

export const _BuiltInDef: Prism<TypeDef, BuiltInType> =
  prism(BuiltInDef, (v: TypeDef) => (v.tag === "BuiltInDef" ? Right(v._0) : Left(v)));

export const _DecoBoolDef: Prism<TypeDef, DecoType<boolean>> =
  prism(DecoBoolDef, (v: TypeDef) => (v.tag === "DecoBoolDef" ? Right(v._0) : Left(v)));

export const _DecoIntDef: Prism<TypeDef, DecoType<number>> =
  prism(DecoIntDef, (v: TypeDef) => (v.tag === "DecoIntDef" ? Right(v._0) : Left(v)));

export const _DecoRealDef: Prism<TypeDef, DecoType<number>> =
  prism(DecoRealDef, (v: TypeDef) => (v.tag === "DecoRealDef" ? Right(v._0) : Left(v)));

export const _EnumDef: Prism<TypeDef, EnumType> =
  prism(EnumDef, (v: TypeDef) => (v.tag === "EnumDef" ? Right(v._0) : Left(v)));

export function typeDescription(t: TypeDef): string {
  switch (t.tag) {
    case "BuiltInDef": return show_BuiltInType(t._0);
    case "DecoBoolDef": return "Decorated Bool";
    case "DecoIntDef": return "Decorated Int";
    case "DecoRealDef": return "Decorated Real";
    case "EnumDef": return "Enumeration";
    default: return absurd(t);
  }
}
