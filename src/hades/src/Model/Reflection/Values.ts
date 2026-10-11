// Ported from hades/src/Model/Reflection/Values.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module defines extension values based on reflective types.
 *
 * TypeScript port
 * ---------------
 * * `ExtValue` is a tagged union. Its hand-written `Ord` instance (numeric comparison across
 *   `ExtInt`/`ExtReal`, natural order for text) is `compare_ExtValue`. Values built with the
 *   constructor functions (`ExtBool(b)`, `ExtNone`, ...) also carry `[OrdSym]`/`[EqSym]` on
 *   their prototype, so the generic `compare`/`equals` of `@/lib/Data/Ord` (and therefore maps,
 *   sets and sorting of `Maybe ExtValue`) follow the Haskell instance. Always build values with
 *   the constructor functions, never with object literals or spreads.
 * * `Variant a` is a newtype erased to `string` with a phantom type parameter. Its constructor
 *   `Variant(t)` and `variantCoerce` are identity functions; `variantName()` is the `Iso`.
 * * `ExtensionValues` is `M.Map<FieldId, ExtValue>`; its JSON codec is
 *   `J.mapJ(J.uuidKey, JSON_ExtValue)` (exported as `JSON_ExtensionValues` for convenience).
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import { isJust, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { EqSym, OrdSym, compare, equals, type Ordering } from "@/lib/Data/Ord";
import { formatDay, type Day } from "@/lib/Data/Time";
import { absurd, showDouble } from "@/lib/Prelude";
import { iso, lens, preview, prism, review, type Iso, type Lens, type Prism } from "@/lib/Control/Lens";
import { naturalOrder } from "@/hades/src/Text/NaturalOrder";
import { type FieldId, type Field, type Multiplicity, type TypeDef, type TypeName, typeDescription } from "./Types";

/**
 * Extension value stored according to the schema in a TypeDef.
 *
 * The "ExtUnion" value can store data from all its variants rather than just the one
 * it currently holds. This enables users to switch between variants without losing data.
 * The name of the currently selected variant is held in the text field at the front.
 *
 * * `ExtNone`: The default value.
 * * `ExtInt`: an `Integer`; `ExtReal`: a `Double`.
 */
export type ExtValue =
  | { readonly tag: "ExtNone" }
  | { readonly tag: "ExtBool"; readonly _0: boolean }
  | { readonly tag: "ExtInt"; readonly _0: number }
  | { readonly tag: "ExtReal"; readonly _0: number }
  | { readonly tag: "ExtText"; readonly _0: string }
  | { readonly tag: "ExtDate"; readonly _0: Day };

/** Shared prototype giving constructed values the Haskell `Eq` and `Ord` instances. */
const extValueProto = {
  [EqSym](this: ExtValue, other: unknown): boolean {
    return eq_ExtValue(this, other as ExtValue);
  },
  [OrdSym](this: ExtValue, other: unknown): Ordering {
    return compare_ExtValue(this, other as ExtValue);
  },
};

function mkExtValue<V extends ExtValue>(fields: V): ExtValue {
  return Object.freeze(Object.assign(Object.create(extValueProto) as object, fields)) as ExtValue;
}

/** The default value. */
export const ExtNone: ExtValue = mkExtValue({ tag: "ExtNone" });
export function ExtBool(_0: boolean): ExtValue {
  return mkExtValue({ tag: "ExtBool", _0 });
}
export function ExtInt(_0: number): ExtValue {
  return mkExtValue({ tag: "ExtInt", _0 });
}
export function ExtReal(_0: number): ExtValue {
  return mkExtValue({ tag: "ExtReal", _0 });
}
export function ExtText(_0: string): ExtValue {
  return mkExtValue({ tag: "ExtText", _0 });
}
export function ExtDate(_0: Day): ExtValue {
  return mkExtValue({ tag: "ExtDate", _0 });
}

/** `deriving Eq` */
export function eq_ExtValue(x: ExtValue, y: ExtValue): boolean {
  if (x.tag !== y.tag) return false;
  if (x.tag === "ExtNone") return true;
  return equals((x as { _0: unknown })._0, (y as { _0: unknown })._0);
}

/** Haskell `compare` for `Double`/`Integer`/`Bool` (`NaN` compares as `GT`). */
function cmpPrim<A extends number | boolean | string>(a: A, b: A): Ordering {
  return a < b ? -1 : a === b ? 0 : 1;
}

/** `instance Ord ExtValue` */
export function compare_ExtValue(x: ExtValue, y: ExtValue): Ordering {
  if (x.tag === "ExtNone" && y.tag === "ExtNone") return 0;
  if (x.tag === "ExtBool" && y.tag === "ExtBool") return cmpPrim(x._0, y._0);
  if ((x.tag === "ExtInt" || x.tag === "ExtReal") && (y.tag === "ExtInt" || y.tag === "ExtReal")) {
    return cmpPrim(x._0, y._0);
  }
  if (x.tag === "ExtText" && y.tag === "ExtText") return naturalOrder(x._0, y._0);
  if (x.tag === "ExtDate" && y.tag === "ExtDate") return compare(x._0, y._0);
  return compare(displayValue(x), displayValue(y));
}

/** `instance Default ExtValue` */
export const def_ExtValue: ExtValue = ExtNone;

/** `instance ToJSON ExtValue` and `instance FromJSON ExtValue` */
export const JSON_ExtValue: J.JSONCodec<ExtValue> = J.codec(
  (v: ExtValue): J.Value => {
    switch (v.tag) {
      case "ExtNone": return J.object([["type", "none"]]);
      case "ExtBool": return J.object([["type", "bool"], ["value", J.boolJ.toJSON(v._0)]]);
      case "ExtInt": return J.object([["type", "int"], ["value", J.integerJ.toJSON(v._0)]]);
      case "ExtReal": return J.object([["type", "real"], ["value", J.doubleJ.toJSON(v._0)]]);
      case "ExtText": return J.object([["type", "text"], ["value", J.textJ.toJSON(v._0)]]);
      case "ExtDate": return J.object([["type", "date"], ["value", J.dayJ.toJSON(v._0)]]);
      default: return absurd(v);
    }
  },
  (val) => J.withObject("Extension value", (obj) => {
    const str = J.field(obj, "type", J.textJ);
    switch (str) {
      case "none": return ExtNone;
      case "bool": return ExtBool(J.field(obj, "value", J.boolJ));
      case "int": return ExtInt(J.field(obj, "value", J.integerJ));
      case "real": return ExtReal(J.field(obj, "value", J.doubleJ));
      case "text": return ExtText(J.field(obj, "value", J.textJ));
      case "date": return ExtDate(J.field(obj, "value", J.dayJ));
      default: return J.fail("Unrecognised Extension Value type: " + str);
    }
  }, val),
);

export const _ExtNone: Prism<ExtValue, null> =
  prism(() => ExtNone, (v: ExtValue) => (v.tag === "ExtNone" ? Right(null) : Left(v)));

export const _ExtBool: Prism<ExtValue, boolean> =
  prism(ExtBool, (v: ExtValue) => (v.tag === "ExtBool" ? Right(v._0) : Left(v)));

export const _ExtInt: Prism<ExtValue, number> =
  prism(ExtInt, (v: ExtValue) => (v.tag === "ExtInt" ? Right(v._0) : Left(v)));

export const _ExtReal: Prism<ExtValue, number> =
  prism(ExtReal, (v: ExtValue) => (v.tag === "ExtReal" ? Right(v._0) : Left(v)));

export const _ExtText: Prism<ExtValue, string> =
  prism(ExtText, (v: ExtValue) => (v.tag === "ExtText" ? Right(v._0) : Left(v)));

export const _ExtDate: Prism<ExtValue, Day> =
  prism(ExtDate, (v: ExtValue) => (v.tag === "ExtDate" ? Right(v._0) : Left(v)));

/** Convert a prism into a lens. "Nothing" maps to "ExtNone" */
export function valueMaybe<A>(prsm: Prism<ExtValue, A>): Lens<ExtValue, Maybe<A>> {
  const setter = (s: ExtValue, m: Maybe<A>): ExtValue => {
    if (m.tag === "Nothing") return isJust(preview(prsm, s)) ? ExtNone : s;
    return review(prsm, m.value);
  };
  return lens((s: ExtValue) => preview(prsm, s), setter);
}

/** Name of the type of value. */
export function valueTypeName(v: ExtValue): string {
  switch (v.tag) {
    case "ExtNone": return "Nothing";
    case "ExtBool": return "Boolean";
    case "ExtInt": return "Integer";
    case "ExtReal": return "Real";
    case "ExtText": return "Text";
    case "ExtDate": return "Date";
    default: return absurd(v);
  }
}

/** Textual representation of a value. */
export function displayValue(v: ExtValue): string {
  switch (v.tag) {
    case "ExtNone": return "";
    case "ExtBool": return v._0 ? "Yes" : "No";
    case "ExtInt": return String(v._0);
    case "ExtReal": return showDouble(v._0);
    case "ExtText": return v._0;
    case "ExtDate": return formatDay("%d %b %y", v._0);
    default: return absurd(v);
  }
}

/** If the multiplicity matches the length of the list then @Nothing@, otherwise an error message. */
export function validateMulti<A>(nm: TypeName, multi: Multiplicity, m: Maybe<A>): string[] {
  switch (multi) {
    case "One": return m.tag === "Nothing" ? [nm + ": Required field is missing."] : [];
    case "Optional": return [];
    default: return absurd(multi);
  }
}

// ---------------------------------------------------------------------------------------------
// Network.URI.isURIReference (RFC 3986 "URI-reference")

const uriRegex: RegExp = (() => {
  const unreserved = "A-Za-z0-9\\-._~";
  const subDelims = "!$&'()*+,;=";
  const pct = "%[0-9A-Fa-f]{2}";
  const pchar = `(?:[${unreserved}${subDelims}:@]|${pct})`;
  const segment = `${pchar}*`;
  const segmentNz = `${pchar}+`;
  const segmentNzNc = `(?:[${unreserved}${subDelims}@]|${pct})+`;
  const queryOrFragment = `(?:${pchar}|[/?])*`;
  const scheme = "[A-Za-z][A-Za-z0-9+\\-.]*";
  const userinfo = `(?:[${unreserved}${subDelims}:]|${pct})*`;
  const decOctet = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])";
  const ipv4 = `${decOctet}\\.${decOctet}\\.${decOctet}\\.${decOctet}`;
  const h16 = "[0-9A-Fa-f]{1,4}";
  const ls32 = `(?:${h16}:${h16}|${ipv4})`;
  const pre = (n: number) => (n < 0 ? "" : `(?:(?:${h16}:){0,${n}}${h16})?`);
  const ipv6 = "(?:" + [
    `(?:${h16}:){6}${ls32}`,
    `::(?:${h16}:){5}${ls32}`,
    `${pre(0)}::(?:${h16}:){4}${ls32}`,
    `${pre(1)}::(?:${h16}:){3}${ls32}`,
    `${pre(2)}::(?:${h16}:){2}${ls32}`,
    `${pre(3)}::${h16}:${ls32}`,
    `${pre(4)}::${ls32}`,
    `${pre(5)}::${h16}`,
    `${pre(6)}::`,
  ].join("|") + ")";
  const ipvFuture = `v[0-9A-Fa-f]+\\.[${unreserved}${subDelims}:]+`;
  const ipLiteral = `\\[(?:${ipv6}|${ipvFuture})\\]`;
  const regName = `(?:[${unreserved}${subDelims}]|${pct})*`;
  const host = `(?:${ipLiteral}|${regName})`;
  const authority = `(?:${userinfo}@)?${host}(?::[0-9]*)?`;
  const pathAbempty = `(?:/${segment})*`;
  const pathAbsolute = `/(?:${segmentNz}(?:/${segment})*)?`;
  const pathRootless = `${segmentNz}(?:/${segment})*`;
  const pathNoscheme = `${segmentNzNc}(?:/${segment})*`;
  const hierPart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)`;
  const relativePart = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathNoscheme}|)`;
  const tail = `(?:\\?${queryOrFragment})?(?:#${queryOrFragment})?`;
  const uri = `${scheme}:${hierPart}${tail}`;
  const relativeRef = `${relativePart}${tail}`;
  return new RegExp(`^(?:${uri}|${relativeRef})$`);
})();

/** `Network.URI.isURIReference`: is the string an absolute URI or a relative reference? */
function isURIReference(s: string): boolean {
  return uriRegex.test(s);
}

/** Compare the type definition against the actual data and return a list of mismatches. */
export function validateExtension(typ: TypeDef, val: ExtValue): string[] {
  switch (typ.tag) {
    case "BuiltInDef": {
      const bt = typ._0;
      switch (bt) {
        case "ModelBool": if (val.tag === "ExtBool") return []; break;
        case "ModelInt": if (val.tag === "ExtInt") return []; break;
        case "ModelReal": if (val.tag === "ExtReal") return []; break;
        case "ModelText": if (val.tag === "ExtText") return []; break;
        case "ModelURL":
          // As in the Haskell original, the message is produced when the text *is* a valid
          // URI reference.
          if (val.tag === "ExtText") return isURIReference(val._0) ? ["Invalid URL: " + val._0] : [];
          break;
        case "ModelNote": if (val.tag === "ExtText") return []; break;
        case "ModelDate": if (val.tag === "ExtDate") return []; break;
        default: return absurd(bt);
      }
      break;
    }
    case "DecoBoolDef": if (val.tag === "ExtBool") return []; break;
    case "DecoIntDef": if (val.tag === "ExtInt") return []; break;
    case "DecoRealDef": if (val.tag === "ExtReal") return []; break;
    case "EnumDef": if (val.tag === "ExtText") return []; break;
    default: return absurd(typ);
  }
  return [extTypeError(typ, val)];
}

/** Validate the field multiplicity and type against the value held in the @Map@. */
export function validateField(f: Field, values: M.Map<FieldId, ExtValue>): string[] {
  const mVal = M.lookup(f.fieldId, values);
  return [
    ...validateMulti(f._fieldName, f._fieldMulti, mVal),
    ...(mVal.tag === "Nothing" ? [] : validateExtension(f._fieldType, mVal.value)),
  ];
}

/** Report a discrepancy between the expected and actual types. */
export function extTypeError(t: TypeDef, v: ExtValue): string {
  return "Type error: expected " + typeDescription(t) + ", got " + valueTypeName(v);
}

/**
 * Reflective types come in named variants. The type parameter is a phantom.
 *
 * The newtype is erased: a `Variant<A>` is its `_variantName` text.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Variant<_A> = string;
export function Variant<A = any>(_variantName: string): Variant<A> {
  return _variantName;
}

/** The record field `_variantName`. */
export function _variantName<A>(v: Variant<A>): string {
  return v;
}

/** `instance Show (Variant a)` */
export function show_Variant<A>(v: Variant<A>): string {
  return v;
}

/** `instance ToJSON (Variant a)` and `instance FromJSON (Variant a)` */
export const JSON_Variant: J.JSONCodec<Variant<any>> = J.codec(
  (v) => v,
  (v) => Variant(J.textJ.parseJSON(v)),
);

/** `instance ToJSONKey (Variant a)` and `instance FromJSONKey (Variant a)` */
export const JSONKey_Variant: J.JSONKey<Variant<any>> = {
  toKey: (v) => v,
  fromKey: (s) => Variant(s),
};

export function variantName<A = any>(): Iso<Variant<A>, string> {
  return iso((v: Variant<A>) => _variantName(v), (t: string) => Variant<A>(t));
}

export function variantCoerce<A, B>(v: Variant<A>): Variant<B> {
  return Variant<B>(_variantName(v));
}

/** A set of extension fields is defined by a mapping from a variant name to a list of fields. */
export type Extensions<A> = (v: Variant<A>) => readonly FieldId[];

/**
 * Instances of Reflective have to store a map of extension values along with their built-in
 * data.
 */
export type ExtensionValues = M.Map<FieldId, ExtValue>;

/** JSON codec for "ExtensionValues" (`Map FieldId ExtValue`, a JSON object keyed by UUID). */
export const JSON_ExtensionValues: J.JSONCodec<ExtensionValues> = J.mapJ(J.uuidKey, JSON_ExtValue);

/**
 * Store extension values in a map, using "ExtNone" as the non-existent value.
 * The most common use is for storing @ExtValue@s in an @ExtensionValues@ table,
 * as the type specialises to
 *
 * > extValue :: FieldId -> Lens' ExtensionValues ExtValue
 */
export function extValue<K>(fName: K): Lens<M.Map<K, ExtValue>, ExtValue> {
  const setter = (tbl: M.Map<K, ExtValue>, v: ExtValue): M.Map<K, ExtValue> =>
    v.tag === "ExtNone" ? M.delete_(fName, tbl) : M.insert(fName, v, tbl);
  return lens((tbl: M.Map<K, ExtValue>) => M.findWithDefault(ExtNone, fName, tbl), setter);
}

/**
 * Find any values that match the given search string. The result is a list of fields where
 * the search string was found and the start index of the match. All fields are searched using
 * their text representation. If the boolean is @True@ then the search is case-blind.
 */
export function valueSearch(caseBlind: boolean, needle: string, values: ExtensionValues): [FieldId, number][] {
  const caseF = (t: string): string => (caseBlind ? T.toCaseFold(t) : t);
  const needle1 = caseF(needle);
  const search = ([fName, v]: [FieldId, ExtValue]): [FieldId, number][] =>
    T.breakOnAll(needle1, caseF(displayValue(v))).map(([pre]) => [fName, T.length(pre)] as [FieldId, number]);
  return M.toList(values).flatMap(search);
}

