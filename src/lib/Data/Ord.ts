/**
 * Replacement for Haskell's `Eq` and `Ord` type classes.
 *
 * Haskell derives structural equality and ordering for data types. In TypeScript we use a
 * single generic structural `equals` and `compare` which handle the representations used
 * throughout this port:
 *
 *  - numbers, strings, booleans, bigints, null/undefined
 *  - arrays (Haskell lists and tuples) compared lexicographically
 *  - tagged unions `{ tag: "Ctor", ... }`. Maybe (`Nothing < Just`) and Either
 *    (`Left < Right`) follow the Haskell constructor order. Other constructors compare by tag
 *    name: if the Haskell constructor order matters, give the type an explicit comparator.
 *  - objects implementing the `[EqSym]` / `[OrdSym]` protocol (e.g. `HMap`, `HSet`, `Name`)
 *  - plain records, compared field by field in key order.
 *
 * Functions are compared by reference.
 */

/** Haskell `Ordering`, represented as a sort-comparator result. */
export type Ordering = -1 | 0 | 1;
export const LT: Ordering = -1;
export const EQ: Ordering = 0;
export const GT: Ordering = 1;

/** Objects may implement custom equality by providing this method. */
export const EqSym: unique symbol = Symbol.for("hades.eq") as any;
/** Objects may implement custom ordering by providing this method. */
export const OrdSym: unique symbol = Symbol.for("hades.ord") as any;

export interface HasEq {
  [EqSym](other: unknown): boolean;
}
export interface HasOrd {
  [OrdSym](other: unknown): Ordering;
}

export type Comparator<A> = (a: A, b: A) => Ordering;
export type Equality<A> = (a: A, b: A) => boolean;

const tagRank: Record<string, number> = { Nothing: 0, Just: 1, Left: 0, Right: 1 };

function typeRank(v: unknown): number {
  if (v === null || v === undefined) return 0;
  switch (typeof v) {
    case "boolean": return 1;
    case "number": return 2;
    case "bigint": return 2;
    case "string": return 3;
    case "function": return 6;
    default: return Array.isArray(v) ? 4 : 5;
  }
}

function cmpPrim(a: any, b: any): Ordering {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Generic structural comparison (Haskell `compare`). */
export function compare<A>(a: A, b: A): Ordering {
  if (a === b) return 0;
  const ta = typeRank(a), tb = typeRank(b);
  if (ta !== tb) return cmpPrim(ta, tb);
  switch (ta) {
    case 0: return 0;
    case 1:
    case 2:
    case 3:
      return cmpPrim(a, b);
    case 4: {
      const xs = a as unknown as unknown[], ys = b as unknown as unknown[];
      const n = Math.min(xs.length, ys.length);
      for (let i = 0; i < n; i++) {
        const c = compare(xs[i], ys[i]);
        if (c !== 0) return c;
      }
      return cmpPrim(xs.length, ys.length);
    }
    case 6:
      return 0;
    default: {
      const oa = a as any, ob = b as any;
      if (typeof oa[OrdSym] === "function") return oa[OrdSym](ob);
      if ("tag" in oa && "tag" in ob && oa.tag !== ob.tag) {
        const ra = tagRank[oa.tag], rb = tagRank[ob.tag];
        if (ra !== undefined && rb !== undefined) return cmpPrim(ra, rb);
        return cmpPrim(oa.tag, ob.tag);
      }
      const ka = Object.keys(oa), kb = Object.keys(ob);
      const n = Math.min(ka.length, kb.length);
      for (let i = 0; i < n; i++) {
        const c1 = cmpPrim(ka[i], kb[i]);
        if (c1 !== 0) return c1;
        const c2 = compare(oa[ka[i]], ob[kb[i]]);
        if (c2 !== 0) return c2;
      }
      return cmpPrim(ka.length, kb.length);
    }
  }
}

/** Generic structural equality (Haskell `==`). */
export function equals<A>(a: A, b: A): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b || (a !== a && b !== b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const oa = a as any, ob = b as any;
  if (typeof oa[EqSym] === "function") return oa[EqSym](ob);
  if (typeof oa[OrdSym] === "function") return oa[OrdSym](ob) === 0;
  if (Array.isArray(oa)) {
    if (!Array.isArray(ob) || oa.length !== ob.length) return false;
    for (let i = 0; i < oa.length; i++) if (!equals(oa[i], ob[i])) return false;
    return true;
  }
  if (Array.isArray(ob)) return false;
  if (oa instanceof Uint8Array && ob instanceof Uint8Array) {
    if (oa.length !== ob.length) return false;
    for (let i = 0; i < oa.length; i++) if (oa[i] !== ob[i]) return false;
    return true;
  }
  const ka = Object.keys(oa), kb = Object.keys(ob);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(ob, k)) return false;
    if (!equals(oa[k], ob[k])) return false;
  }
  return true;
}

export function notEquals<A>(a: A, b: A): boolean {
  return !equals(a, b);
}

export function lt<A>(a: A, b: A): boolean { return compare(a, b) < 0; }
export function le<A>(a: A, b: A): boolean { return compare(a, b) <= 0; }
export function gt<A>(a: A, b: A): boolean { return compare(a, b) > 0; }
export function ge<A>(a: A, b: A): boolean { return compare(a, b) >= 0; }

export function max<A>(a: A, b: A): A { return compare(a, b) >= 0 ? a : b; }
export function min<A>(a: A, b: A): A { return compare(a, b) <= 0 ? a : b; }

/** `comparing f` */
export function comparing<A, B>(f: (a: A) => B): Comparator<A> {
  return (x, y) => compare(f(x), f(y));
}

/** `Down`: reverse a comparator. */
export function down<A>(c: Comparator<A> = compare): Comparator<A> {
  return (x, y) => c(y, x);
}

/** Lexicographic combination of comparators (Haskell `comparing f <> comparing g`). */
export function thenCompare<A>(...cs: Comparator<A>[]): Comparator<A> {
  return (x, y) => {
    for (const c of cs) {
      const r = c(x, y);
      if (r !== 0) return r;
    }
    return 0;
  };
}

/** Comparator for enumerations represented as string literal unions, in constructor order. */
export function enumComparator<A extends string>(order: readonly A[]): Comparator<A> {
  const idx = new Map<string, number>();
  order.forEach((v, i) => idx.set(v, i));
  return (a, b) => cmpPrim(idx.get(a) ?? -1, idx.get(b) ?? -1);
}

/** Convert an Ordering to Haskell-style text. */
export function showOrdering(o: Ordering): "LT" | "EQ" | "GT" {
  return o < 0 ? "LT" : o > 0 ? "GT" : "EQ";
}
