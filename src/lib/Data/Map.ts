/**
 * Haskell `Data.Map` (and `Data.Map.Strict`): persistent ordered maps.
 *
 * Use as a namespace import, keeping Haskell argument order:
 *
 * ```ts
 * import * as M from "@/lib/Data/Map";
 * const m2 = M.insert(k, v, m1);
 * const r = M.lookup(k, m2);   // Maybe<V>
 * ```
 *
 * Keys are ordered with the generic structural `compare` unless a comparator is given when the
 * map is created. Operations that build a map from another map keep its comparator.
 */
import * as T from "./AVL";
import { compare, type Comparator, EqSym, OrdSym, type Ordering, equals } from "./Ord";
import { Just, Nothing, type Maybe } from "./Maybe";

export class HMap<K, V> implements Iterable<[K, V]> {
  /** @internal */
  constructor(readonly root: T.Tree<K, V>, readonly cmp: Comparator<K> = compare) {}

  get size(): number {
    return T.size(this.root);
  }

  [Symbol.iterator](): Iterator<[K, V]> {
    const it = T.iterate(this.root);
    return {
      next(): IteratorResult<[K, V]> {
        const r = it.next();
        return r.done ? { done: true, value: undefined } : { done: false, value: [r.value.k, r.value.v] };
      },
    };
  }

  [EqSym](other: unknown): boolean {
    if (!(other instanceof HMap)) return false;
    if (this.size !== other.size) return false;
    const a = toList(this), b = toList(other as HMap<K, V>);
    for (let i = 0; i < a.length; i++) {
      if (this.cmp(a[i][0], b[i][0]) !== 0) return false;
      if (!equals(a[i][1], b[i][1])) return false;
    }
    return true;
  }

  [OrdSym](other: unknown): Ordering {
    return compare(toList(this), toList(other as HMap<K, V>));
  }

  toString(): string {
    return "fromList " + JSON.stringify(toList(this));
  }
}

export type Map<K, V> = HMap<K, V>;

function wrap<K, V>(m: HMap<K, any>, root: T.Tree<K, V>): HMap<K, V> {
  return root === m.root ? (m as HMap<K, V>) : new HMap(root, m.cmp);
}

// ---------------------------------------------------------------------------------------------
// Construction

const EMPTY = new HMap<any, any>(null);

export function empty<K, V>(cmp?: Comparator<K>): HMap<K, V> {
  return cmp ? new HMap<K, V>(null, cmp) : (EMPTY as HMap<K, V>);
}

export function singleton<K, V>(k: K, v: V, cmp?: Comparator<K>): HMap<K, V> {
  return new HMap(T.insertWith(cmp ?? compare, null, k, v, null), cmp ?? compare);
}

/** `fromList`. Later entries replace earlier ones with the same key. */
export function fromList<K, V>(kvs: Iterable<readonly [K, V]>, cmp: Comparator<K> = compare): HMap<K, V> {
  const arr = Array.from(kvs);
  // Stable sort then keep last of each equal-key run.
  const idx = arr.map((_, i) => i);
  idx.sort((a, b) => cmp(arr[a][0], arr[b][0]) || a - b);
  const ks: K[] = [], vs: V[] = [];
  for (let j = 0; j < idx.length; j++) {
    const [k, v] = arr[idx[j]];
    if (ks.length > 0 && cmp(ks[ks.length - 1], k) === 0) vs[vs.length - 1] = v;
    else {
      ks.push(k);
      vs.push(v);
    }
  }
  return new HMap(T.fromSorted(ks, vs), cmp);
}

export const fromAscList = fromList;
export const fromDistinctAscList = fromList;

/** `fromListWith f`: for duplicate keys, `f newValue oldValue`. */
export function fromListWith<K, V>(f: (nv: V, ov: V) => V, kvs: Iterable<readonly [K, V]>, cmp: Comparator<K> = compare): HMap<K, V> {
  let root: T.Tree<K, V> = null;
  for (const [k, v] of kvs) root = T.insertWith(cmp, (n, o) => f(n, o), k, v, root);
  return new HMap(root, cmp);
}

export function fromListWithKey<K, V>(f: (k: K, nv: V, ov: V) => V, kvs: Iterable<readonly [K, V]>, cmp: Comparator<K> = compare): HMap<K, V> {
  let root: T.Tree<K, V> = null;
  for (const [k, v] of kvs) root = T.insertWith(cmp, (n, o, kk) => f(kk, n, o), k, v, root);
  return new HMap(root, cmp);
}

/** `fromSet f s` (the set must be an HSet, given here as its sorted element list). */
export function fromSet<K, V>(f: (k: K) => V, s: { toArray(): K[]; cmp: Comparator<K> }): HMap<K, V> {
  const ks = s.toArray();
  return new HMap(T.fromSorted(ks, ks.map(f)), s.cmp);
}

// ---------------------------------------------------------------------------------------------
// Query

export function lookup<K, V>(k: K, m: HMap<K, V>): Maybe<V> {
  const n = T.lookupNode(m.cmp, k, m.root);
  return n === null ? Nothing : Just(n.v);
}

/** Non-Haskell convenience: lookup returning `undefined` when absent. */
export function get<K, V>(k: K, m: HMap<K, V>): V | undefined {
  const n = T.lookupNode(m.cmp, k, m.root);
  return n === null ? undefined : n.v;
}

export function findWithDefault<K, V>(d: V, k: K, m: HMap<K, V>): V {
  const n = T.lookupNode(m.cmp, k, m.root);
  return n === null ? d : n.v;
}

/** `m ! k`. Throws if absent. */
export function find<K, V>(m: HMap<K, V>, k: K): V {
  const n = T.lookupNode(m.cmp, k, m.root);
  if (n === null) throw new Error("Map.!: given key is not an element in the map");
  return n.v;
}

export function member<K, V>(k: K, m: HMap<K, V>): boolean {
  return T.lookupNode(m.cmp, k, m.root) !== null;
}
export function notMember<K, V>(k: K, m: HMap<K, V>): boolean {
  return !member(k, m);
}

export function size<K, V>(m: HMap<K, V>): number {
  return T.size(m.root);
}
export function isNull<K, V>(m: HMap<K, V>): boolean {
  return m.root === null;
}
export { isNull as null };

export function lookupMin<K, V>(m: HMap<K, V>): Maybe<[K, V]> {
  if (m.root === null) return Nothing;
  const n = T.minNode(m.root);
  return Just([n.k, n.v]);
}
export function lookupMax<K, V>(m: HMap<K, V>): Maybe<[K, V]> {
  if (m.root === null) return Nothing;
  const n = T.maxNode(m.root);
  return Just([n.k, n.v]);
}
export function findMin<K, V>(m: HMap<K, V>): [K, V] {
  if (m.root === null) throw new Error("Map.findMin: empty map");
  const n = T.minNode(m.root);
  return [n.k, n.v];
}
export function findMax<K, V>(m: HMap<K, V>): [K, V] {
  if (m.root === null) throw new Error("Map.findMax: empty map");
  const n = T.maxNode(m.root);
  return [n.k, n.v];
}

export function lookupLT<K, V>(k: K, m: HMap<K, V>): Maybe<[K, V]> {
  const n = T.lookupBelow(m.cmp, k, m.root, false);
  return n ? Just([n.k, n.v]) : Nothing;
}
export function lookupLE<K, V>(k: K, m: HMap<K, V>): Maybe<[K, V]> {
  const n = T.lookupBelow(m.cmp, k, m.root, true);
  return n ? Just([n.k, n.v]) : Nothing;
}
export function lookupGT<K, V>(k: K, m: HMap<K, V>): Maybe<[K, V]> {
  const n = T.lookupAbove(m.cmp, k, m.root, false);
  return n ? Just([n.k, n.v]) : Nothing;
}
export function lookupGE<K, V>(k: K, m: HMap<K, V>): Maybe<[K, V]> {
  const n = T.lookupAbove(m.cmp, k, m.root, true);
  return n ? Just([n.k, n.v]) : Nothing;
}

export function elemAt<K, V>(i: number, m: HMap<K, V>): [K, V] {
  const n = T.elemAt(i, m.root);
  return [n.k, n.v];
}
export function lookupIndex<K, V>(k: K, m: HMap<K, V>): Maybe<number> {
  const i = T.indexOf(m.cmp, k, m.root);
  return i < 0 ? Nothing : Just(i);
}
export function findIndex<K, V>(k: K, m: HMap<K, V>): number {
  const i = T.indexOf(m.cmp, k, m.root);
  if (i < 0) throw new Error("Map.findIndex: element is not in the map");
  return i;
}

// ---------------------------------------------------------------------------------------------
// Update

export function insert<K, V>(k: K, v: V, m: HMap<K, V>): HMap<K, V> {
  return new HMap(T.insertWith(m.cmp, null, k, v, m.root), m.cmp);
}

/** `insertWith f k new m`: if present the value becomes `f new old`. */
export function insertWith<K, V>(f: (nv: V, ov: V) => V, k: K, v: V, m: HMap<K, V>): HMap<K, V> {
  return new HMap(T.insertWith(m.cmp, (n, o) => f(n, o), k, v, m.root), m.cmp);
}
export function insertWithKey<K, V>(f: (k: K, nv: V, ov: V) => V, k: K, v: V, m: HMap<K, V>): HMap<K, V> {
  return new HMap(T.insertWith(m.cmp, (n, o, kk) => f(kk, n, o), k, v, m.root), m.cmp);
}

export function delete_<K, V>(k: K, m: HMap<K, V>): HMap<K, V> {
  return wrap(m, T.remove(m.cmp, k, m.root));
}
export { delete_ as delete };

export function adjust<K, V>(f: (v: V) => V, k: K, m: HMap<K, V>): HMap<K, V> {
  const n = T.lookupNode(m.cmp, k, m.root);
  if (n === null) return m;
  return insert(k, f(n.v), m);
}
export function adjustWithKey<K, V>(f: (k: K, v: V) => V, k: K, m: HMap<K, V>): HMap<K, V> {
  const n = T.lookupNode(m.cmp, k, m.root);
  if (n === null) return m;
  return insert(k, f(n.k, n.v), m);
}

export function update<K, V>(f: (v: V) => Maybe<V>, k: K, m: HMap<K, V>): HMap<K, V> {
  const n = T.lookupNode(m.cmp, k, m.root);
  if (n === null) return m;
  const r = f(n.v);
  return r.tag === "Just" ? insert(k, r.value, m) : delete_(k, m);
}

export function alter<K, V>(f: (v: Maybe<V>) => Maybe<V>, k: K, m: HMap<K, V>): HMap<K, V> {
  const n = T.lookupNode(m.cmp, k, m.root);
  const r = f(n === null ? Nothing : Just(n.v));
  if (r.tag === "Just") return insert(k, r.value, m);
  return n === null ? m : delete_(k, m);
}

// ---------------------------------------------------------------------------------------------
// Combine

/** Left-biased union. */
export function union<K, V>(m1: HMap<K, V>, m2: HMap<K, V>): HMap<K, V> {
  return new HMap(T.union(m1.cmp, null, m1.root, m2.root), m1.cmp);
}
export function unionWith<K, V>(f: (a: V, b: V) => V, m1: HMap<K, V>, m2: HMap<K, V>): HMap<K, V> {
  return new HMap(T.union(m1.cmp, (a, b) => f(a, b), m1.root, m2.root), m1.cmp);
}
export function unionWithKey<K, V>(f: (k: K, a: V, b: V) => V, m1: HMap<K, V>, m2: HMap<K, V>): HMap<K, V> {
  return new HMap(T.union(m1.cmp, (a, b, k) => f(k, a, b), m1.root, m2.root), m1.cmp);
}
export function unions<K, V>(ms: Iterable<HMap<K, V>>): HMap<K, V> {
  let r: HMap<K, V> | null = null;
  for (const m of ms) r = r === null ? m : union(r, m);
  return r ?? empty();
}
export function unionsWith<K, V>(f: (a: V, b: V) => V, ms: Iterable<HMap<K, V>>): HMap<K, V> {
  let r: HMap<K, V> | null = null;
  for (const m of ms) r = r === null ? m : unionWith(f, r, m);
  return r ?? empty();
}

export function difference<K, V, W>(m1: HMap<K, V>, m2: HMap<K, W>): HMap<K, V> {
  return wrap(m1, T.difference(m1.cmp, m1.root, m2.root));
}
/** `m1 \\ m2` */
export const diff = difference;

/** `differenceWith f m1 m2`: for common keys, `f a b` decides. */
export function differenceWith<K, V, W>(f: (a: V, b: W) => Maybe<V>, m1: HMap<K, V>, m2: HMap<K, W>): HMap<K, V> {
  let r = m1;
  for (const [k, b] of m2) {
    const n = T.lookupNode(m1.cmp, k, m1.root);
    if (n !== null) {
      const x = f(n.v, b);
      r = x.tag === "Just" ? insert(k, x.value, r) : delete_(k, r);
    }
  }
  return r;
}

export function intersection<K, V, W>(m1: HMap<K, V>, m2: HMap<K, W>): HMap<K, V> {
  return new HMap(T.intersectionWith(m1.cmp, (a: V) => a, m1.root, m2.root), m1.cmp);
}
export function intersectionWith<K, V, W, X>(f: (a: V, b: W) => X, m1: HMap<K, V>, m2: HMap<K, W>): HMap<K, X> {
  return new HMap(T.intersectionWith(m1.cmp, (a: V, b: W) => f(a, b), m1.root, m2.root), m1.cmp);
}
export function intersectionWithKey<K, V, W, X>(f: (k: K, a: V, b: W) => X, m1: HMap<K, V>, m2: HMap<K, W>): HMap<K, X> {
  return new HMap(T.intersectionWith(m1.cmp, (a: V, b: W, k: K) => f(k, a, b), m1.root, m2.root), m1.cmp);
}

/** Keep only the keys in the set (an HSet or any object with `has`-style membership). */
export function restrictKeys<K, V>(m: HMap<K, V>, s: { member(k: K): boolean }): HMap<K, V> {
  return wrap(m, T.filter((_v, k) => s.member(k), m.root));
}
export function withoutKeys<K, V>(m: HMap<K, V>, s: { member(k: K): boolean }): HMap<K, V> {
  return wrap(m, T.filter((_v, k) => !s.member(k), m.root));
}

export function isSubmapOf<K, V>(m1: HMap<K, V>, m2: HMap<K, V>): boolean {
  return isSubmapOfBy(equals, m1, m2);
}
export function isSubmapOfBy<K, V, W>(f: (a: V, b: W) => boolean, m1: HMap<K, V>, m2: HMap<K, W>): boolean {
  for (const [k, v] of m1) {
    const n = T.lookupNode(m2.cmp, k, m2.root);
    if (n === null || !f(v, n.v)) return false;
  }
  return true;
}

export function disjoint<K, V, W>(m1: HMap<K, V>, m2: HMap<K, W>): boolean {
  return size(intersection(m1, m2)) === 0;
}

// ---------------------------------------------------------------------------------------------
// Traversal

export function map<K, V, W>(f: (v: V) => W, m: HMap<K, V>): HMap<K, W> {
  return new HMap(T.mapValues((v) => f(v), m.root), m.cmp);
}
export function mapWithKey<K, V, W>(f: (k: K, v: V) => W, m: HMap<K, V>): HMap<K, W> {
  return new HMap(T.mapValues((v, k) => f(k, v), m.root), m.cmp);
}

/** `mapKeys f m`. If `f` maps two keys to the same new key, the greatest original wins. */
export function mapKeys<K, K2, V>(f: (k: K) => K2, m: HMap<K, V>, cmp: Comparator<K2> = compare): HMap<K2, V> {
  return fromList(toList(m).map(([k, v]) => [f(k), v] as [K2, V]), cmp);
}
export function mapKeysWith<K, K2, V>(c: (a: V, b: V) => V, f: (k: K) => K2, m: HMap<K, V>, cmp: Comparator<K2> = compare): HMap<K2, V> {
  return fromListWith(c, toList(m).map(([k, v]) => [f(k), v] as [K2, V]), cmp);
}

export function mapMaybe<K, V, W>(f: (v: V) => Maybe<W>, m: HMap<K, V>): HMap<K, W> {
  return new HMap(T.mapMaybe((v) => {
    const r = f(v);
    return r.tag === "Just" ? { ok: true, v: r.value } : { ok: false };
  }, m.root), m.cmp);
}
export function mapMaybeWithKey<K, V, W>(f: (k: K, v: V) => Maybe<W>, m: HMap<K, V>): HMap<K, W> {
  return new HMap(T.mapMaybe((v, k) => {
    const r = f(k, v);
    return r.tag === "Just" ? { ok: true, v: r.value } : { ok: false };
  }, m.root), m.cmp);
}

export function filter<K, V>(p: (v: V) => boolean, m: HMap<K, V>): HMap<K, V> {
  return wrap(m, T.filter((v) => p(v), m.root));
}
export function filterWithKey<K, V>(p: (k: K, v: V) => boolean, m: HMap<K, V>): HMap<K, V> {
  return wrap(m, T.filter((v, k) => p(k, v), m.root));
}
export function partition<K, V>(p: (v: V) => boolean, m: HMap<K, V>): [HMap<K, V>, HMap<K, V>] {
  return [filter(p, m), filter((v) => !p(v), m)];
}
export function partitionWithKey<K, V>(p: (k: K, v: V) => boolean, m: HMap<K, V>): [HMap<K, V>, HMap<K, V>] {
  return [filterWithKey(p, m), filterWithKey((k, v) => !p(k, v), m)];
}

export function foldr<K, V, B>(f: (v: V, acc: B) => B, z: B, m: HMap<K, V>): B {
  const es = elems(m);
  let acc = z;
  for (let i = es.length - 1; i >= 0; i--) acc = f(es[i], acc);
  return acc;
}
export function foldl<K, V, B>(f: (acc: B, v: V) => B, z: B, m: HMap<K, V>): B {
  let acc = z;
  for (const [, v] of m) acc = f(acc, v);
  return acc;
}
export function foldrWithKey<K, V, B>(f: (k: K, v: V, acc: B) => B, z: B, m: HMap<K, V>): B {
  const es = toList(m);
  let acc = z;
  for (let i = es.length - 1; i >= 0; i--) acc = f(es[i][0], es[i][1], acc);
  return acc;
}
export function foldlWithKey<K, V, B>(f: (acc: B, k: K, v: V) => B, z: B, m: HMap<K, V>): B {
  let acc = z;
  for (const [k, v] of m) acc = f(acc, k, v);
  return acc;
}
export const foldr_ = foldr;
export const foldl_ = foldl;

/** `mapAccum f acc m` */
export function mapAccum<K, V, A, W>(f: (acc: A, v: V) => [A, W], acc0: A, m: HMap<K, V>): [A, HMap<K, W>] {
  let acc = acc0;
  const out = mapWithKey((_k, v) => {
    const [a, w] = f(acc, v);
    acc = a;
    return w;
  }, m);
  return [acc, out];
}
export function mapAccumWithKey<K, V, A, W>(f: (acc: A, k: K, v: V) => [A, W], acc0: A, m: HMap<K, V>): [A, HMap<K, W>] {
  let acc = acc0;
  const out = mapWithKey((k, v) => {
    const [a, w] = f(acc, k, v);
    acc = a;
    return w;
  }, m);
  return [acc, out];
}

/** Synchronous `traverseWithKey` in an Either-like applicative: the callback may throw. */
export function traverseWithKey<K, V, W>(f: (k: K, v: V) => W, m: HMap<K, V>): HMap<K, W> {
  return mapWithKey(f, m);
}

// ---------------------------------------------------------------------------------------------
// Conversion

export function toList<K, V>(m: HMap<K, V>): [K, V][] {
  return T.toArray(m.root, (k, v) => [k, v] as [K, V]);
}
export const toAscList = toList;
export const assocs = toList;
export function toDescList<K, V>(m: HMap<K, V>): [K, V][] {
  return toList(m).reverse();
}
export function keys<K, V>(m: HMap<K, V>): K[] {
  return T.toArray(m.root, (k) => k);
}
export function elems<K, V>(m: HMap<K, V>): V[] {
  return T.toArray(m.root, (_k, v) => v);
}

// ---------------------------------------------------------------------------------------------
// Min / Max

export function deleteMin<K, V>(m: HMap<K, V>): HMap<K, V> {
  return m.root === null ? m : wrap(m, T.deleteMin(m.root));
}
export function deleteMax<K, V>(m: HMap<K, V>): HMap<K, V> {
  return m.root === null ? m : wrap(m, T.deleteMax(m.root));
}
export function minViewWithKey<K, V>(m: HMap<K, V>): Maybe<[[K, V], HMap<K, V>]> {
  if (m.root === null) return Nothing;
  const n = T.minNode(m.root);
  return Just([[n.k, n.v], deleteMin(m)]);
}
export function maxViewWithKey<K, V>(m: HMap<K, V>): Maybe<[[K, V], HMap<K, V>]> {
  if (m.root === null) return Nothing;
  const n = T.maxNode(m.root);
  return Just([[n.k, n.v], deleteMax(m)]);
}
export function minView<K, V>(m: HMap<K, V>): Maybe<[V, HMap<K, V>]> {
  if (m.root === null) return Nothing;
  return Just([T.minNode(m.root).v, deleteMin(m)]);
}
export function maxView<K, V>(m: HMap<K, V>): Maybe<[V, HMap<K, V>]> {
  if (m.root === null) return Nothing;
  return Just([T.maxNode(m.root).v, deleteMax(m)]);
}

/** `split k m` = (keys < k, keys > k) */
export function split<K, V>(k: K, m: HMap<K, V>): [HMap<K, V>, HMap<K, V>] {
  const [l, , r] = T.split(m.cmp, k, m.root);
  return [new HMap(l, m.cmp), new HMap(r, m.cmp)];
}
export function splitLookup<K, V>(k: K, m: HMap<K, V>): [HMap<K, V>, Maybe<V>, HMap<K, V>] {
  const [l, n, r] = T.split(m.cmp, k, m.root);
  return [new HMap(l, m.cmp), n ? Just(n.v) : Nothing, new HMap(r, m.cmp)];
}

export function take<K, V>(n: number, m: HMap<K, V>): HMap<K, V> {
  return fromList(toList(m).slice(0, Math.max(0, n)), m.cmp);
}
export function drop<K, V>(n: number, m: HMap<K, V>): HMap<K, V> {
  return fromList(toList(m).slice(Math.max(0, n)), m.cmp);
}

/** `Semigroup`/`Monoid` instance is left-biased union. */
export const append = union;
export const mempty = empty;
