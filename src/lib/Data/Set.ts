/**
 * Haskell `Data.Set`: persistent ordered sets. Use as `import * as S from "@/lib/Data/Set"`.
 * Haskell argument order is preserved (`S.insert(x, s)`, `S.member(x, s)`).
 */
import * as T from "./AVL";
import { compare, type Comparator, EqSym, OrdSym, type Ordering } from "./Ord";
import { Just, Nothing, type Maybe } from "./Maybe";

export class HSet<A> implements Iterable<A> {
  /** @internal */
  constructor(readonly root: T.Tree<A, null>, readonly cmp: Comparator<A> = compare) {}

  get size(): number {
    return T.size(this.root);
  }

  /** Membership test, used by `Map.restrictKeys` and friends. */
  member(a: A): boolean {
    return T.lookupNode(this.cmp, a, this.root) !== null;
  }

  toArray(): A[] {
    return T.toArray(this.root, (k) => k);
  }

  [Symbol.iterator](): Iterator<A> {
    const it = T.iterate(this.root);
    return {
      next(): IteratorResult<A> {
        const r = it.next();
        return r.done ? { done: true, value: undefined } : { done: false, value: r.value.k };
      },
    };
  }

  [EqSym](other: unknown): boolean {
    if (!(other instanceof HSet)) return false;
    if (this.size !== other.size) return false;
    const a = this.toArray(), b = (other as HSet<A>).toArray();
    for (let i = 0; i < a.length; i++) if (this.cmp(a[i], b[i]) !== 0) return false;
    return true;
  }

  [OrdSym](other: unknown): Ordering {
    return compare(this.toArray(), (other as HSet<A>).toArray());
  }

  toString(): string {
    return "fromList " + JSON.stringify(this.toArray());
  }
}

export type Set<A> = HSet<A>;

function wrap<A>(s: HSet<A>, root: T.Tree<A, null>): HSet<A> {
  return root === s.root ? s : new HSet(root, s.cmp);
}

const EMPTY = new HSet<any>(null);

export function empty<A>(cmp?: Comparator<A>): HSet<A> {
  return cmp ? new HSet<A>(null, cmp) : (EMPTY as HSet<A>);
}
export function singleton<A>(a: A, cmp: Comparator<A> = compare): HSet<A> {
  return new HSet(T.insertWith(cmp, null, a, null, null), cmp);
}
export function fromList<A>(xs: Iterable<A>, cmp: Comparator<A> = compare): HSet<A> {
  const arr = Array.from(xs).sort(cmp);
  const ks: A[] = [];
  for (const x of arr) if (ks.length === 0 || cmp(ks[ks.length - 1], x) !== 0) ks.push(x);
  return new HSet(T.fromSorted(ks, ks.map(() => null)), cmp);
}
export const fromAscList = fromList;
export const fromDistinctAscList = fromList;

export function insert<A>(a: A, s: HSet<A>): HSet<A> {
  if (s.member(a)) return s;
  return new HSet(T.insertWith(s.cmp, null, a, null, s.root), s.cmp);
}
export function delete_<A>(a: A, s: HSet<A>): HSet<A> {
  return wrap(s, T.remove(s.cmp, a, s.root));
}
export { delete_ as delete };

export function member<A>(a: A, s: HSet<A>): boolean {
  return s.member(a);
}
export function notMember<A>(a: A, s: HSet<A>): boolean {
  return !s.member(a);
}
export function size<A>(s: HSet<A>): number {
  return T.size(s.root);
}
export function isNull<A>(s: HSet<A>): boolean {
  return s.root === null;
}
export { isNull as null };

export function toList<A>(s: HSet<A>): A[] {
  return s.toArray();
}
export const toAscList = toList;
export const elems = toList;
export function toDescList<A>(s: HSet<A>): A[] {
  return s.toArray().reverse();
}

export function union<A>(s1: HSet<A>, s2: HSet<A>): HSet<A> {
  return new HSet(T.union(s1.cmp, null, s1.root, s2.root), s1.cmp);
}
export function unions<A>(ss: Iterable<HSet<A>>): HSet<A> {
  let r: HSet<A> | null = null;
  for (const s of ss) r = r === null ? s : union(r, s);
  return r ?? empty();
}
export function difference<A>(s1: HSet<A>, s2: HSet<A>): HSet<A> {
  return wrap(s1, T.difference(s1.cmp, s1.root, s2.root));
}
export const diff = difference;
export function intersection<A>(s1: HSet<A>, s2: HSet<A>): HSet<A> {
  return new HSet(T.intersectionWith(s1.cmp, () => null, s1.root, s2.root), s1.cmp);
}
export function isSubsetOf<A>(s1: HSet<A>, s2: HSet<A>): boolean {
  for (const x of s1) if (!s2.member(x)) return false;
  return true;
}
export function isProperSubsetOf<A>(s1: HSet<A>, s2: HSet<A>): boolean {
  return s1.size < s2.size && isSubsetOf(s1, s2);
}
export function disjoint<A>(s1: HSet<A>, s2: HSet<A>): boolean {
  for (const x of s1) if (s2.member(x)) return false;
  return true;
}

export function filter<A>(p: (a: A) => boolean, s: HSet<A>): HSet<A> {
  return wrap(s, T.filter((_v, k) => p(k), s.root));
}
export function partition<A>(p: (a: A) => boolean, s: HSet<A>): [HSet<A>, HSet<A>] {
  return [filter(p, s), filter((x) => !p(x), s)];
}
export function map<A, B>(f: (a: A) => B, s: HSet<A>, cmp: Comparator<B> = compare): HSet<B> {
  return fromList(s.toArray().map(f), cmp);
}
export function foldr<A, B>(f: (a: A, acc: B) => B, z: B, s: HSet<A>): B {
  const xs = s.toArray();
  let acc = z;
  for (let i = xs.length - 1; i >= 0; i--) acc = f(xs[i], acc);
  return acc;
}
export function foldl<A, B>(f: (acc: B, a: A) => B, z: B, s: HSet<A>): B {
  let acc = z;
  for (const x of s) acc = f(acc, x);
  return acc;
}

export function lookupMin<A>(s: HSet<A>): Maybe<A> {
  return s.root === null ? Nothing : Just(T.minNode(s.root).k);
}
export function lookupMax<A>(s: HSet<A>): Maybe<A> {
  return s.root === null ? Nothing : Just(T.maxNode(s.root).k);
}
export function findMin<A>(s: HSet<A>): A {
  if (s.root === null) throw new Error("Set.findMin: empty set");
  return T.minNode(s.root).k;
}
export function findMax<A>(s: HSet<A>): A {
  if (s.root === null) throw new Error("Set.findMax: empty set");
  return T.maxNode(s.root).k;
}
export function deleteMin<A>(s: HSet<A>): HSet<A> {
  return s.root === null ? s : wrap(s, T.deleteMin(s.root));
}
export function deleteMax<A>(s: HSet<A>): HSet<A> {
  return s.root === null ? s : wrap(s, T.deleteMax(s.root));
}
export function minView<A>(s: HSet<A>): Maybe<[A, HSet<A>]> {
  return s.root === null ? Nothing : Just([T.minNode(s.root).k, deleteMin(s)]);
}
export function maxView<A>(s: HSet<A>): Maybe<[A, HSet<A>]> {
  return s.root === null ? Nothing : Just([T.maxNode(s.root).k, deleteMax(s)]);
}
export function elemAt<A>(i: number, s: HSet<A>): A {
  return T.elemAt(i, s.root).k;
}
export function findIndex<A>(a: A, s: HSet<A>): number {
  const i = T.indexOf(s.cmp, a, s.root);
  if (i < 0) throw new Error("Set.findIndex: element is not in the set");
  return i;
}
export function lookupIndex<A>(a: A, s: HSet<A>): Maybe<number> {
  const i = T.indexOf(s.cmp, a, s.root);
  return i < 0 ? Nothing : Just(i);
}
export function lookupLT<A>(a: A, s: HSet<A>): Maybe<A> {
  const n = T.lookupBelow(s.cmp, a, s.root, false);
  return n ? Just(n.k) : Nothing;
}
export function lookupLE<A>(a: A, s: HSet<A>): Maybe<A> {
  const n = T.lookupBelow(s.cmp, a, s.root, true);
  return n ? Just(n.k) : Nothing;
}
export function lookupGT<A>(a: A, s: HSet<A>): Maybe<A> {
  const n = T.lookupAbove(s.cmp, a, s.root, false);
  return n ? Just(n.k) : Nothing;
}
export function lookupGE<A>(a: A, s: HSet<A>): Maybe<A> {
  const n = T.lookupAbove(s.cmp, a, s.root, true);
  return n ? Just(n.k) : Nothing;
}
export function split<A>(a: A, s: HSet<A>): [HSet<A>, HSet<A>] {
  const [l, , r] = T.split(s.cmp, a, s.root);
  return [new HSet(l, s.cmp), new HSet(r, s.cmp)];
}
export function take<A>(n: number, s: HSet<A>): HSet<A> {
  return fromList(s.toArray().slice(0, Math.max(0, n)), s.cmp);
}
export function drop<A>(n: number, s: HSet<A>): HSet<A> {
  return fromList(s.toArray().slice(Math.max(0, n)), s.cmp);
}
export function cartesianProduct<A, B>(s1: HSet<A>, s2: HSet<B>): HSet<[A, B]> {
  const r: [A, B][] = [];
  for (const a of s1) for (const b of s2) r.push([a, b]);
  return fromList(r);
}

export const append = union;
export const mempty = empty;
