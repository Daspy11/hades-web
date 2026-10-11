/**
 * Haskell `Data.Aeson` replacement.
 *
 * `ToJSON`/`FromJSON` instances become explicit codec objects (`JSONCodec<A>`). Parsers are
 * plain functions `(v: Value) => A` which throw `JSONParseError` on failure; the Haskell
 * `Parser` alternative `p1 <|> p2` is `alt(p1, p2)`.
 *
 * Encodings follow aeson 1.5 so that files written by the original application load here:
 *
 *  - `Maybe a`: `null` for Nothing, the value itself for Just
 *  - tuples and lists: arrays; `()` is `[]`
 *  - `Either a b`: `{"Left": a}` / `{"Right": b}`
 *  - `Map k v`: an object when `k` has a text key encoding, otherwise an array of `[k, v]` pairs
 *  - `Set a`: an array
 *  - `Day`: `"YYYY-MM-DD"`, `UUID`: canonical string, `Colour`: `"#rrggbb"`
 */
import { Just, Nothing, type Maybe } from "./Maybe";
import { Left, Right, type Either } from "./Either";
import * as M from "./Map";
import * as S from "./Set";
import { compare, type Comparator } from "./Ord";
import { readDay, type Day } from "./Time";
import { fromText as uuidFromText, type UUID } from "./UUID";
import { Colour, sRGB24read, sRGB24show } from "./Colour";
import { lens, prism_, type Lens, type Prism, type Traversal, traversal } from "../Control/Lens";

export type Value = null | boolean | number | string | Value[] | JSONObject;
export interface JSONObject {
  [key: string]: Value;
}
export type Object = JSONObject;
export type Array = Value[];

export class JSONParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JSONParseError";
  }
}

export type Parser<A> = (v: Value) => A;

export interface ToJSON<A> {
  toJSON(a: A): Value;
}
export interface FromJSON<A> {
  parseJSON(v: Value): A;
}
export interface JSONCodec<A> extends ToJSON<A>, FromJSON<A> {}

/** Text key encoding for maps (`ToJSONKey`/`FromJSONKey` with a text representation). */
export interface JSONKey<K> {
  toKey(k: K): string;
  fromKey(s: string): K;
  /** Comparator used when rebuilding maps from parsed JSON. Defaults to `compare`. */
  cmp?: Comparator<K>;
}

export function codec<A>(toJSON: (a: A) => Value, parseJSON: (v: Value) => A): JSONCodec<A> {
  return { toJSON, parseJSON };
}

// ---------------------------------------------------------------------------------------------
// Failure and alternatives

export function fail(msg: string): never {
  throw new JSONParseError(msg);
}

/** `p1 <|> p2 <|> ...` */
export function alt<A>(...ps: Parser<A>[]): Parser<A> {
  return (v) => {
    let last: unknown = null;
    for (const p of ps) {
      try {
        return p(v);
      } catch (e) {
        if (!(e instanceof JSONParseError)) throw e;
        last = e;
      }
    }
    throw last ?? new JSONParseError("empty alternative");
  };
}

/** Run a parser, catching failure. */
export function parseEither<A>(p: Parser<A>, v: Value): Either<string, A> {
  try {
    return Right(p(v));
  } catch (e) {
    if (e instanceof JSONParseError) return Left(e.message);
    throw e;
  }
}
export function parseMaybe<A>(p: Parser<A>, v: Value): Maybe<A> {
  const r = parseEither(p, v);
  return r.tag === "Right" ? Just(r.value) : Nothing;
}

/** Try a sub-parse, returning Nothing on failure (Haskell `optional` in Parser). */
export function optionalP<A>(p: () => A): Maybe<A> {
  try {
    return Just(p());
  } catch (e) {
    if (e instanceof JSONParseError) return Nothing;
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------
// Encoding and decoding text

export function encode(v: Value): string {
  return JSON.stringify(v);
}
/** Pretty encoding (aeson-pretty style indentation). */
export function encodePretty(v: Value): string {
  return JSON.stringify(v, null, 2);
}
export function eitherDecodeValue(s: string): Either<string, Value> {
  try {
    return Right(JSON.parse(s) as Value);
  } catch (e) {
    return Left(String((e as Error).message));
  }
}
/** `eitherDecode` with a codec / parser. */
export function eitherDecode<A>(p: Parser<A> | FromJSON<A>, s: string): Either<string, A> {
  const v = eitherDecodeValue(s);
  if (v.tag === "Left") return v;
  return parseEither(typeof p === "function" ? p : (x) => p.parseJSON(x), v.value);
}
export function decode<A>(p: Parser<A> | FromJSON<A>, s: string): Maybe<A> {
  const r = eitherDecode(p, s);
  return r.tag === "Right" ? Just(r.value) : Nothing;
}

// ---------------------------------------------------------------------------------------------
// Values

export function isObject(v: Value): v is JSONObject {
  return typeof v === "object" && v !== null && !globalThis.Array.isArray(v);
}

/** `object [k .= v, ...]` where values are already encoded. */
export function object(pairs: readonly (readonly [string, Value])[]): JSONObject {
  const o: JSONObject = {};
  for (const [k, v] of pairs) o[k] = v;
  return o;
}
/** `k .= v` helper: `kv("name", codec, value)`. */
export function kv<A>(k: string, c: ToJSON<A>, a: A): [string, Value] {
  return [k, c.toJSON(a)];
}

function typeName(v: Value): string {
  if (v === null) return "Null";
  if (globalThis.Array.isArray(v)) return "Array";
  switch (typeof v) {
    case "boolean": return "Bool";
    case "number": return "Number";
    case "string": return "String";
    default: return "Object";
  }
}

export function typeMismatch(expected: string, v: Value): never {
  fail(`expected ${expected}, but encountered ${typeName(v)}`);
}

export function withObject<A>(name: string, f: (o: JSONObject) => A, v: Value): A {
  if (!isObject(v)) fail(`parsing ${name} failed, expected Object, but encountered ${typeName(v)}`);
  return f(v);
}
export function withText<A>(name: string, f: (t: string) => A, v: Value): A {
  if (typeof v !== "string") fail(`parsing ${name} failed, expected String, but encountered ${typeName(v)}`);
  return f(v);
}
export function withArray<A>(name: string, f: (a: Value[]) => A, v: Value): A {
  if (!globalThis.Array.isArray(v)) fail(`parsing ${name} failed, expected Array, but encountered ${typeName(v)}`);
  return f(v);
}
export function withScientific<A>(name: string, f: (n: number) => A, v: Value): A {
  if (typeof v !== "number") fail(`parsing ${name} failed, expected Number, but encountered ${typeName(v)}`);
  return f(v);
}
export const withNumber = withScientific;
export function withBool<A>(name: string, f: (b: boolean) => A, v: Value): A {
  if (typeof v !== "boolean") fail(`parsing ${name} failed, expected Boolean, but encountered ${typeName(v)}`);
  return f(v);
}

function parserOf<A>(p: Parser<A> | FromJSON<A>): Parser<A> {
  return typeof p === "function" ? p : (v) => p.parseJSON(v);
}

/** `o .: key` */
export function field<A>(o: JSONObject, key: string, p: Parser<A> | FromJSON<A>): A {
  if (!Object.prototype.hasOwnProperty.call(o, key)) fail(`key "${key}" not found`);
  try {
    return parserOf(p)(o[key]);
  } catch (e) {
    if (e instanceof JSONParseError) fail(`${e.message} (in key "${key}")`);
    throw e;
  }
}
/** `o .:? key`: missing or null gives Nothing. */
export function fieldMaybe<A>(o: JSONObject, key: string, p: Parser<A> | FromJSON<A>): Maybe<A> {
  if (!Object.prototype.hasOwnProperty.call(o, key) || o[key] === null) return Nothing;
  return Just(field(o, key, p));
}
/** `o .:? key .!= d` */
export function fieldDefault<A>(o: JSONObject, key: string, p: Parser<A> | FromJSON<A>, d: A): A {
  const r = fieldMaybe(o, key, p);
  return r.tag === "Just" ? r.value : d;
}
/** `o .:! key`: missing gives Nothing, but null is parsed. */
export function fieldOptional<A>(o: JSONObject, key: string, p: Parser<A> | FromJSON<A>): Maybe<A> {
  if (!Object.prototype.hasOwnProperty.call(o, key)) return Nothing;
  return Just(field(o, key, p));
}

// ---------------------------------------------------------------------------------------------
// Standard codecs

export const valueJ: JSONCodec<Value> = codec((v) => v, (v) => v);

export const textJ: JSONCodec<string> = codec(
  (t) => t,
  (v) => withText("Text", (t) => t, v),
);
export const stringJ = textJ;

export const boolJ: JSONCodec<boolean> = codec(
  (b) => b,
  (v) => withBool("Bool", (b) => b, v),
);

export const intJ: JSONCodec<number> = codec(
  (n) => n,
  (v) => withScientific("Int", (n) => {
    if (!Number.isFinite(n)) fail("expected Int");
    return Math.trunc(n);
  }, v),
);
export const integerJ = intJ;

export const doubleJ: JSONCodec<number> = codec(
  (n) => (Number.isFinite(n) ? n : null),
  (v) => (v === null ? NaN : withScientific("Double", (n) => n, v)),
);

export const unitJ: JSONCodec<null> = codec(
  () => [],
  (v) => withArray("()", (a) => {
    if (a.length !== 0) fail("expected empty array for ()");
    return null;
  }, v),
);

export const dayJ: JSONCodec<Day> = codec(
  (d) => d,
  (v) => withText("Day", (t) => {
    const r = readDay(t);
    if (r.tag === "Nothing") fail(`could not parse date: ${JSON.stringify(t)}`);
    return r.value;
  }, v),
);

export const uuidJ: JSONCodec<UUID> = codec(
  (u) => u,
  (v) => withText("UUID", (t) => {
    const r = uuidFromText(t);
    if (r.tag === "Nothing") fail(`invalid UUID: ${JSON.stringify(t)}`);
    return r.value;
  }, v),
);

/** Colour as `"#rrggbb"` (Data.Aeson.Orphan). */
export const colourJ: JSONCodec<Colour> = codec(
  (c) => sRGB24show(c),
  (v) => withText("Colour", (t) => {
    const r = sRGB24read(t.trim());
    if (r.tag === "Nothing") fail(`Colour not parsed: ${JSON.stringify(t)}`);
    return r.value;
  }, v),
);

export function maybeJ<A>(c: JSONCodec<A>): JSONCodec<Maybe<A>> {
  return codec(
    (m) => (m.tag === "Just" ? c.toJSON(m.value) : null),
    (v) => (v === null ? Nothing : Just(c.parseJSON(v))),
  );
}

export function listJ<A>(c: JSONCodec<A>): JSONCodec<A[]> {
  return codec(
    (xs) => xs.map((x) => c.toJSON(x)),
    (v) => withArray("[a]", (a) => a.map((x, i) => {
      try {
        return c.parseJSON(x);
      } catch (e) {
        if (e instanceof JSONParseError) fail(`${e.message} (in array index ${i})`);
        throw e;
      }
    }), v),
  );
}

export function tuple2J<A, B>(ca: JSONCodec<A>, cb: JSONCodec<B>): JSONCodec<[A, B]> {
  return codec(
    ([a, b]) => [ca.toJSON(a), cb.toJSON(b)],
    (v) => withArray("(a, b)", (arr) => {
      if (arr.length !== 2) fail(`cannot unpack array of length ${arr.length} into a tuple of length 2`);
      return [ca.parseJSON(arr[0]), cb.parseJSON(arr[1])] as [A, B];
    }, v),
  );
}
export function tuple3J<A, B, C>(ca: JSONCodec<A>, cb: JSONCodec<B>, cc: JSONCodec<C>): JSONCodec<[A, B, C]> {
  return codec(
    ([a, b, c]) => [ca.toJSON(a), cb.toJSON(b), cc.toJSON(c)],
    (v) => withArray("(a, b, c)", (arr) => {
      if (arr.length !== 3) fail(`cannot unpack array of length ${arr.length} into a tuple of length 3`);
      return [ca.parseJSON(arr[0]), cb.parseJSON(arr[1]), cc.parseJSON(arr[2])] as [A, B, C];
    }, v),
  );
}

export function eitherJ<A, B>(ca: JSONCodec<A>, cb: JSONCodec<B>): JSONCodec<Either<A, B>> {
  return codec(
    (e): Value => (e.tag === "Left" ? { Left: ca.toJSON(e.value) } as JSONObject : { Right: cb.toJSON(e.value) } as JSONObject),
    (v) => withObject("Either", (o) => {
      if ("Left" in o) return Left(ca.parseJSON(o.Left));
      if ("Right" in o) return Right(cb.parseJSON(o.Right));
      return fail("expected an object with a single property where the property key should be either \"Left\" or \"Right\"");
    }, v),
  );
}

/** Text keys (identity). */
export const textKey: JSONKey<string> = { toKey: (k) => k, fromKey: (s) => s };
export const uuidKey: JSONKey<UUID> = {
  toKey: (k) => k,
  fromKey: (s) => {
    const r = uuidFromText(s);
    if (r.tag === "Nothing") fail(`invalid UUID key: ${JSON.stringify(s)}`);
    return r.value;
  },
};
export const intKey: JSONKey<number> = {
  toKey: (k) => String(k),
  fromKey: (s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) fail(`invalid Int key: ${JSON.stringify(s)}`);
    return n;
  },
};

/** `Map k v` with a text key encoding: a JSON object. */
export function mapJ<K, V>(key: JSONKey<K>, cv: JSONCodec<V>): JSONCodec<M.HMap<K, V>> {
  return codec(
    (m) => {
      const o: JSONObject = {};
      for (const [k, v] of m) o[key.toKey(k)] = cv.toJSON(v);
      return o;
    },
    (v) => withObject("Map", (o) => M.fromList(
      Object.keys(o).map((k) => [key.fromKey(k), field(o, k, cv)] as [K, V]),
      key.cmp ?? compare,
    ), v),
  );
}

/** `Map k v` without a text key encoding: an array of `[k, v]` pairs. */
export function mapPairsJ<K, V>(ck: JSONCodec<K>, cv: JSONCodec<V>, cmp: Comparator<K> = compare): JSONCodec<M.HMap<K, V>> {
  const pairs = listJ(tuple2J(ck, cv));
  return codec(
    (m) => pairs.toJSON(M.toList(m)),
    (v) => M.fromList(pairs.parseJSON(v), cmp),
  );
}

export function setJ<A>(c: JSONCodec<A>, cmp: Comparator<A> = compare): JSONCodec<S.HSet<A>> {
  const l = listJ(c);
  return codec(
    (s) => l.toJSON(S.toList(s)),
    (v) => S.fromList(l.parseJSON(v), cmp),
  );
}

/** Enumerations encoded as their constructor names (e.g. `"MemoSmall"`). */
export function enumJ<A extends string>(name: string, values: readonly A[]): JSONCodec<A> {
  return codec(
    (a) => a,
    (v) => withText(name, (t) => {
      if (!(values as readonly string[]).includes(t)) fail(`unknown ${name}: ${JSON.stringify(t)}`);
      return t as A;
    }, v),
  );
}

// ---------------------------------------------------------------------------------------------
// Data.Aeson.Lens subset

/** `key k`: Traversal into an object member. */
export function key(k: string): Traversal<Value, Value> {
  return traversal(
    (v: Value, f: (x: Value) => Value) => (isObject(v) && k in v ? { ...v, [k]: f(v[k]) } : v),
    (v: Value) => (isObject(v) && k in v ? [v[k]] : []),
  );
}
export function _String(): Prism<Value, string> {
  return prism_((t: string) => t as Value, (v: Value) => (typeof v === "string" ? Just(v) : Nothing));
}
export function _Number(): Prism<Value, number> {
  return prism_((n: number) => n as Value, (v: Value) => (typeof v === "number" ? Just(v) : Nothing));
}
export function _Bool(): Prism<Value, boolean> {
  return prism_((b: boolean) => b as Value, (v: Value) => (typeof v === "boolean" ? Just(v) : Nothing));
}
export function _Object(): Prism<Value, JSONObject> {
  return prism_((o: JSONObject) => o as Value, (v: Value) => (isObject(v) ? Just(v) : Nothing));
}
export function _Array(): Prism<Value, Value[]> {
  return prism_((a: Value[]) => a as Value, (v: Value) => (globalThis.Array.isArray(v) ? Just(v) : Nothing));
}
export function members(): Traversal<Value, Value> {
  return traversal(
    (v: Value, f: (x: Value) => Value) => {
      if (!isObject(v)) return v;
      const o: JSONObject = {};
      for (const k of Object.keys(v)) o[k] = f(v[k]);
      return o;
    },
    (v: Value) => (isObject(v) ? Object.values(v) : []),
  );
}
export function nth(i: number): Traversal<Value, Value> {
  return traversal(
    (v: Value, f: (x: Value) => Value) =>
      globalThis.Array.isArray(v) && i < v.length ? v.map((x, j) => (j === i ? f(x) : x)) : v,
    (v: Value) => (globalThis.Array.isArray(v) && i < v.length ? [v[i]] : []),
  );
}

/** Helper lens for a field of a plain JSON object (not part of aeson). */
export function objField(k: string): Lens<JSONObject, Value | undefined> {
  return lens(
    (o: JSONObject) => o[k],
    (o, v: Value | undefined) => {
      const r = { ...o };
      if (v === undefined) delete r[k];
      else r[k] = v;
      return r;
    },
  );
}
