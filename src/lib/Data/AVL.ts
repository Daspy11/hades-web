/**
 * Persistent (immutable) AVL tree, the shared core of `Data.Map` and `Data.Set`.
 * All operations return new trees; existing trees are never modified.
 */
import type { Comparator } from "./Ord";

export interface Node<K, V> {
  readonly k: K;
  readonly v: V;
  readonly l: Tree<K, V>;
  readonly r: Tree<K, V>;
  readonly h: number;
  readonly n: number;
}
export type Tree<K, V> = Node<K, V> | null;

export function height(t: Tree<any, any>): number {
  return t === null ? 0 : t.h;
}
export function size(t: Tree<any, any>): number {
  return t === null ? 0 : t.n;
}

function mk<K, V>(k: K, v: V, l: Tree<K, V>, r: Tree<K, V>): Node<K, V> {
  const hl = height(l), hr = height(r);
  return { k, v, l, r, h: (hl > hr ? hl : hr) + 1, n: size(l) + size(r) + 1 };
}

function rotateRight<K, V>(t: Node<K, V>): Node<K, V> {
  const l = t.l!;
  return mk(l.k, l.v, l.l, mk(t.k, t.v, l.r, t.r));
}
function rotateLeft<K, V>(t: Node<K, V>): Node<K, V> {
  const r = t.r!;
  return mk(r.k, r.v, mk(t.k, t.v, t.l, r.l), r.r);
}

/** Rebalance a node whose subtrees differ in height by at most 2. */
export function balance<K, V>(k: K, v: V, l: Tree<K, V>, r: Tree<K, V>): Node<K, V> {
  const hl = height(l), hr = height(r);
  if (hl > hr + 1) {
    const ll = l!;
    if (height(ll.l) >= height(ll.r)) return rotateRight(mk(k, v, l, r));
    return rotateRight(mk(k, v, rotateLeft(ll), r));
  }
  if (hr > hl + 1) {
    const rr = r!;
    if (height(rr.r) >= height(rr.l)) return rotateLeft(mk(k, v, l, r));
    return rotateLeft(mk(k, v, l, rotateRight(rr)));
  }
  return mk(k, v, l, r);
}

/** Join two trees with a middle element where all of l < k < all of r (any heights). */
export function join<K, V>(k: K, v: V, l: Tree<K, V>, r: Tree<K, V>): Node<K, V> {
  const hl = height(l), hr = height(r);
  if (hl > hr + 1) {
    const ll = l!;
    return balance(ll.k, ll.v, ll.l, join(k, v, ll.r, r));
  }
  if (hr > hl + 1) {
    const rr = r!;
    return balance(rr.k, rr.v, join(k, v, l, rr.l), rr.r);
  }
  return mk(k, v, l, r);
}

export function minNode<K, V>(t: Node<K, V>): Node<K, V> {
  let c = t;
  while (c.l !== null) c = c.l;
  return c;
}
export function maxNode<K, V>(t: Node<K, V>): Node<K, V> {
  let c = t;
  while (c.r !== null) c = c.r;
  return c;
}

export function deleteMin<K, V>(t: Node<K, V>): Tree<K, V> {
  if (t.l === null) return t.r;
  return balance(t.k, t.v, deleteMin(t.l), t.r);
}
export function deleteMax<K, V>(t: Node<K, V>): Tree<K, V> {
  if (t.r === null) return t.l;
  return balance(t.k, t.v, t.l, deleteMax(t.r));
}

/** Concatenate two trees where all of l < all of r. */
export function merge<K, V>(l: Tree<K, V>, r: Tree<K, V>): Tree<K, V> {
  if (l === null) return r;
  if (r === null) return l;
  const m = minNode(r);
  return join(m.k, m.v, l, deleteMin(r));
}

export function lookupNode<K, V>(cmp: Comparator<K>, k: K, t: Tree<K, V>): Node<K, V> | null {
  let c = t;
  while (c !== null) {
    const o = cmp(k, c.k);
    if (o === 0) return c;
    c = o < 0 ? c.l : c.r;
  }
  return null;
}

/** Insert, combining with `f(new, old)` if the key already exists. */
export function insertWith<K, V>(
  cmp: Comparator<K>, f: ((nv: V, ov: V, k: K) => V) | null, k: K, v: V, t: Tree<K, V>,
): Node<K, V> {
  if (t === null) return mk(k, v, null, null);
  const o = cmp(k, t.k);
  if (o === 0) return mk(k, f ? f(v, t.v, t.k) : v, t.l, t.r);
  if (o < 0) return balance(t.k, t.v, insertWith(cmp, f, k, v, t.l), t.r);
  return balance(t.k, t.v, t.l, insertWith(cmp, f, k, v, t.r));
}

export function remove<K, V>(cmp: Comparator<K>, k: K, t: Tree<K, V>): Tree<K, V> {
  if (t === null) return null;
  const o = cmp(k, t.k);
  if (o === 0) return merge(t.l, t.r);
  if (o < 0) {
    const nl = remove(cmp, k, t.l);
    return nl === t.l ? t : balance(t.k, t.v, nl, t.r);
  }
  const nr = remove(cmp, k, t.r);
  return nr === t.r ? t : balance(t.k, t.v, t.l, nr);
}

/** Split into (keys < k, node with k if present, keys > k). */
export function split<K, V>(
  cmp: Comparator<K>, k: K, t: Tree<K, V>,
): [Tree<K, V>, Node<K, V> | null, Tree<K, V>] {
  if (t === null) return [null, null, null];
  const o = cmp(k, t.k);
  if (o === 0) return [t.l, t, t.r];
  if (o < 0) {
    const [ll, m, lr] = split(cmp, k, t.l);
    return [ll, m, join(t.k, t.v, lr, t.r)];
  }
  const [rl, m, rr] = split(cmp, k, t.r);
  return [join(t.k, t.v, t.l, rl), m, rr];
}

/** Left-biased union with an optional combining function `f(leftValue, rightValue)`. */
export function union<K, V>(
  cmp: Comparator<K>, f: ((a: V, b: V, k: K) => V) | null, t1: Tree<K, V>, t2: Tree<K, V>,
): Tree<K, V> {
  if (t1 === null) return t2;
  if (t2 === null) return t1;
  const [l2, m2, r2] = split(cmp, t1.k, t2);
  const l = union(cmp, f, t1.l, l2);
  const r = union(cmp, f, t1.r, r2);
  const v = m2 !== null && f !== null ? f(t1.v, m2.v, t1.k) : t1.v;
  return join(t1.k, v, l, r);
}

export function difference<K, V, W>(cmp: Comparator<K>, t1: Tree<K, V>, t2: Tree<K, W>): Tree<K, V> {
  if (t1 === null) return null;
  if (t2 === null) return t1;
  const [l1, , r1] = split(cmp, t2.k, t1);
  return merge(difference(cmp, l1, t2.l), difference(cmp, r1, t2.r));
}

export function intersectionWith<K, V, W, X>(
  cmp: Comparator<K>, f: (a: V, b: W, k: K) => X, t1: Tree<K, V>, t2: Tree<K, W>,
): Tree<K, X> {
  if (t1 === null || t2 === null) return null;
  const [l2, m2, r2] = split(cmp, t1.k, t2);
  const l = intersectionWith(cmp, f, t1.l, l2);
  const r = intersectionWith(cmp, f, t1.r, r2);
  if (m2 !== null) return join(t1.k, f(t1.v, m2.v, t1.k), l, r);
  return merge(l, r);
}

export function filter<K, V>(p: (v: V, k: K) => boolean, t: Tree<K, V>): Tree<K, V> {
  if (t === null) return null;
  const l = filter(p, t.l), r = filter(p, t.r);
  if (p(t.v, t.k)) {
    if (l === t.l && r === t.r) return t;
    return join(t.k, t.v, l, r);
  }
  return merge(l, r);
}

export function mapMaybe<K, V, W>(f: (v: V, k: K) => { ok: boolean; v?: W }, t: Tree<K, V>): Tree<K, W> {
  if (t === null) return null;
  const l = mapMaybe(f, t.l);
  const res = f(t.v, t.k);
  const r = mapMaybe(f, t.r);
  if (res.ok) return join(t.k, res.v as W, l, r);
  return merge(l, r);
}

export function mapValues<K, V, W>(f: (v: V, k: K) => W, t: Tree<K, V>): Tree<K, W> {
  if (t === null) return null;
  const l = mapValues(f, t.l);
  const v = f(t.v, t.k);
  const r = mapValues(f, t.r);
  return { k: t.k, v, l, r, h: t.h, n: t.n };
}

export function toArray<K, V, R>(t: Tree<K, V>, f: (k: K, v: V) => R, out: R[] = []): R[] {
  // Iterative in-order traversal.
  const stack: Node<K, V>[] = [];
  let c: Tree<K, V> = t;
  while (c !== null || stack.length > 0) {
    while (c !== null) {
      stack.push(c);
      c = c.l;
    }
    const n = stack.pop()!;
    out.push(f(n.k, n.v));
    c = n.r;
  }
  return out;
}

export function* iterate<K, V>(t: Tree<K, V>): Generator<Node<K, V>> {
  const stack: Node<K, V>[] = [];
  let c: Tree<K, V> = t;
  while (c !== null || stack.length > 0) {
    while (c !== null) {
      stack.push(c);
      c = c.l;
    }
    const n = stack.pop()!;
    yield n;
    c = n.r;
  }
}

/** Build a balanced tree from sorted, de-duplicated arrays. */
export function fromSorted<K, V>(ks: readonly K[], vs: readonly V[], lo = 0, hi = ks.length): Tree<K, V> {
  if (lo >= hi) return null;
  const mid = (lo + hi) >> 1;
  return mk(ks[mid], vs[mid], fromSorted(ks, vs, lo, mid), fromSorted(ks, vs, mid + 1, hi));
}

export function elemAt<K, V>(i: number, t: Tree<K, V>): Node<K, V> {
  let c = t;
  let idx = i;
  while (c !== null) {
    const ls = size(c.l);
    if (idx < ls) c = c.l;
    else if (idx === ls) return c;
    else {
      idx -= ls + 1;
      c = c.r;
    }
  }
  throw new Error("elemAt: index out of range");
}

export function indexOf<K>(cmp: Comparator<K>, k: K, t: Tree<K, any>): number {
  let c = t;
  let base = 0;
  while (c !== null) {
    const o = cmp(k, c.k);
    if (o === 0) return base + size(c.l);
    if (o < 0) c = c.l;
    else {
      base += size(c.l) + 1;
      c = c.r;
    }
  }
  return -1;
}

/** Greatest node with key < k (strict) or <= k. */
export function lookupBelow<K, V>(cmp: Comparator<K>, k: K, t: Tree<K, V>, inclusive: boolean): Node<K, V> | null {
  let best: Node<K, V> | null = null;
  let c = t;
  while (c !== null) {
    const o = cmp(k, c.k);
    if (o > 0 || (inclusive && o === 0)) {
      best = c;
      if (o === 0) return c;
      c = c.r;
    } else c = c.l;
  }
  return best;
}

/** Least node with key > k (strict) or >= k. */
export function lookupAbove<K, V>(cmp: Comparator<K>, k: K, t: Tree<K, V>, inclusive: boolean): Node<K, V> | null {
  let best: Node<K, V> | null = null;
  let c = t;
  while (c !== null) {
    const o = cmp(k, c.k);
    if (o < 0 || (inclusive && o === 0)) {
      best = c;
      if (o === 0) return c;
      c = c.l;
    } else c = c.r;
  }
  return best;
}
