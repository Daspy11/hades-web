/**
 * Haskell `Data.List` (plus list functions from the Prelude) on readonly arrays.
 * Use as `import * as L from "@/lib/Data/List"`. Haskell argument order is preserved.
 * Functions never mutate their arguments.
 */
import { compare, equals, type Comparator, type Ordering } from "./Ord";
import { Just, Nothing, type Maybe } from "./Maybe";

type List<A> = readonly A[];

export function head<A>(xs: List<A>): A {
  if (xs.length === 0) throw new Error("Prelude.head: empty list");
  return xs[0];
}
export function last<A>(xs: List<A>): A {
  if (xs.length === 0) throw new Error("Prelude.last: empty list");
  return xs[xs.length - 1];
}
export function tail<A>(xs: List<A>): A[] {
  if (xs.length === 0) throw new Error("Prelude.tail: empty list");
  return xs.slice(1);
}
export function init<A>(xs: List<A>): A[] {
  if (xs.length === 0) throw new Error("Prelude.init: empty list");
  return xs.slice(0, -1);
}
export function uncons<A>(xs: List<A>): Maybe<[A, A[]]> {
  return xs.length === 0 ? Nothing : Just([xs[0], xs.slice(1)]);
}
export function isNull<A>(xs: List<A>): boolean { return xs.length === 0; }
export { isNull as null };

export function elem<A>(x: A, xs: List<A>): boolean {
  for (const y of xs) if (equals(x, y)) return true;
  return false;
}
export function notElem<A>(x: A, xs: List<A>): boolean { return !elem(x, xs); }

/** `lookup k assocList` */
export function lookup<K, V>(k: K, xs: List<readonly [K, V]>): Maybe<V> {
  for (const [kk, v] of xs) if (equals(k, kk)) return Just(v);
  return Nothing;
}
export function find<A>(p: (a: A) => boolean, xs: List<A>): Maybe<A> {
  for (const x of xs) if (p(x)) return Just(x);
  return Nothing;
}
export function findIndex<A>(p: (a: A) => boolean, xs: List<A>): Maybe<number> {
  const i = xs.findIndex(p);
  return i < 0 ? Nothing : Just(i);
}
export function elemIndex<A>(x: A, xs: List<A>): Maybe<number> {
  return findIndex((y) => equals(x, y), xs);
}
export function elemIndices<A>(x: A, xs: List<A>): number[] {
  const r: number[] = [];
  xs.forEach((y, i) => { if (equals(x, y)) r.push(i); });
  return r;
}
export function findIndices<A>(p: (a: A) => boolean, xs: List<A>): number[] {
  const r: number[] = [];
  xs.forEach((y, i) => { if (p(y)) r.push(i); });
  return r;
}

export function take<A>(n: number, xs: List<A>): A[] { return n <= 0 ? [] : xs.slice(0, n); }
export function drop<A>(n: number, xs: List<A>): A[] { return n <= 0 ? xs.slice() : xs.slice(n); }
export function splitAt<A>(n: number, xs: List<A>): [A[], A[]] { return [take(n, xs), drop(n, xs)]; }
export function takeWhile<A>(p: (a: A) => boolean, xs: List<A>): A[] {
  let i = 0;
  while (i < xs.length && p(xs[i])) i++;
  return xs.slice(0, i);
}
export function dropWhile<A>(p: (a: A) => boolean, xs: List<A>): A[] {
  let i = 0;
  while (i < xs.length && p(xs[i])) i++;
  return xs.slice(i);
}
export function dropWhileEnd<A>(p: (a: A) => boolean, xs: List<A>): A[] {
  let i = xs.length;
  while (i > 0 && p(xs[i - 1])) i--;
  return xs.slice(0, i);
}
export function span<A>(p: (a: A) => boolean, xs: List<A>): [A[], A[]] {
  let i = 0;
  while (i < xs.length && p(xs[i])) i++;
  return [xs.slice(0, i), xs.slice(i)];
}
export function break_<A>(p: (a: A) => boolean, xs: List<A>): [A[], A[]] {
  return span((x) => !p(x), xs);
}
export { break_ as break };
export function partition<A>(p: (a: A) => boolean, xs: List<A>): [A[], A[]] {
  const a: A[] = [], b: A[] = [];
  for (const x of xs) (p(x) ? a : b).push(x);
  return [a, b];
}
export function stripPrefix<A>(p: List<A>, xs: List<A>): Maybe<A[]> {
  return isPrefixOf(p, xs) ? Just(xs.slice(p.length)) : Nothing;
}
export function isPrefixOf<A>(p: List<A>, xs: List<A>): boolean {
  if (p.length > xs.length) return false;
  for (let i = 0; i < p.length; i++) if (!equals(p[i], xs[i])) return false;
  return true;
}
export function isSuffixOf<A>(p: List<A>, xs: List<A>): boolean {
  if (p.length > xs.length) return false;
  const off = xs.length - p.length;
  for (let i = 0; i < p.length; i++) if (!equals(p[i], xs[off + i])) return false;
  return true;
}
export function isInfixOf<A>(p: List<A>, xs: List<A>): boolean {
  for (let i = 0; i + p.length <= xs.length; i++) {
    let ok = true;
    for (let j = 0; j < p.length && ok; j++) ok = equals(p[j], xs[i + j]);
    if (ok) return true;
  }
  return false;
}
export function isSubsequenceOf<A>(p: List<A>, xs: List<A>): boolean {
  let i = 0;
  for (const x of xs) if (i < p.length && equals(p[i], x)) i++;
  return i === p.length;
}

export function reverse<A>(xs: List<A>): A[] { return xs.slice().reverse(); }
export function concat<A>(xss: List<List<A>>): A[] { return ([] as A[]).concat(...xss); }
export function concatMap<A, B>(f: (a: A) => List<B>, xs: List<A>): B[] { return xs.flatMap((x) => f(x) as B[]); }
export function intercalate<A>(sep: List<A>, xss: List<List<A>>): A[] {
  const r: A[] = [];
  xss.forEach((xs, i) => {
    if (i > 0) r.push(...sep);
    r.push(...xs);
  });
  return r;
}
export function intersperse<A>(sep: A, xs: List<A>): A[] {
  const r: A[] = [];
  xs.forEach((x, i) => {
    if (i > 0) r.push(sep);
    r.push(x);
  });
  return r;
}
export function transpose<A>(xss: List<List<A>>): A[][] {
  const n = Math.max(0, ...xss.map((x) => x.length));
  const r: A[][] = [];
  for (let i = 0; i < n; i++) {
    const row: A[] = [];
    for (const xs of xss) if (i < xs.length) row.push(xs[i]);
    r.push(row);
  }
  return r;
}
export function replicate<A>(n: number, x: A): A[] {
  return n > 0 ? new Array(n).fill(x) : [];
}
export function range(from: number, to: number, step = 1): number[] {
  const r: number[] = [];
  if (step > 0) for (let i = from; i <= to; i += step) r.push(i);
  else if (step < 0) for (let i = from; i >= to; i += step) r.push(i);
  return r;
}

export function zip<A, B>(xs: List<A>, ys: List<B>): [A, B][] {
  const n = Math.min(xs.length, ys.length);
  const r: [A, B][] = [];
  for (let i = 0; i < n; i++) r.push([xs[i], ys[i]]);
  return r;
}
export function zip3<A, B, C>(xs: List<A>, ys: List<B>, zs: List<C>): [A, B, C][] {
  const n = Math.min(xs.length, ys.length, zs.length);
  const r: [A, B, C][] = [];
  for (let i = 0; i < n; i++) r.push([xs[i], ys[i], zs[i]]);
  return r;
}
export function zipWith<A, B, C>(f: (a: A, b: B) => C, xs: List<A>, ys: List<B>): C[] {
  const n = Math.min(xs.length, ys.length);
  const r: C[] = [];
  for (let i = 0; i < n; i++) r.push(f(xs[i], ys[i]));
  return r;
}
export function zipWith3<A, B, C, D>(f: (a: A, b: B, c: C) => D, xs: List<A>, ys: List<B>, zs: List<C>): D[] {
  const n = Math.min(xs.length, ys.length, zs.length);
  const r: D[] = [];
  for (let i = 0; i < n; i++) r.push(f(xs[i], ys[i], zs[i]));
  return r;
}
export function unzip<A, B>(xs: List<readonly [A, B]>): [A[], B[]] {
  return [xs.map((x) => x[0]), xs.map((x) => x[1])];
}
export function unzip3<A, B, C>(xs: List<readonly [A, B, C]>): [A[], B[], C[]] {
  return [xs.map((x) => x[0]), xs.map((x) => x[1]), xs.map((x) => x[2])];
}

export function foldr<A, B>(f: (a: A, acc: B) => B, z: B, xs: List<A>): B {
  let acc = z;
  for (let i = xs.length - 1; i >= 0; i--) acc = f(xs[i], acc);
  return acc;
}
export function foldl<A, B>(f: (acc: B, a: A) => B, z: B, xs: List<A>): B {
  let acc = z;
  for (const x of xs) acc = f(acc, x);
  return acc;
}
export const foldl_ = foldl;
export function foldr1<A>(f: (a: A, acc: A) => A, xs: List<A>): A {
  if (xs.length === 0) throw new Error("foldr1: empty list");
  let acc = xs[xs.length - 1];
  for (let i = xs.length - 2; i >= 0; i--) acc = f(xs[i], acc);
  return acc;
}
export function foldl1<A>(f: (acc: A, a: A) => A, xs: List<A>): A {
  if (xs.length === 0) throw new Error("foldl1: empty list");
  let acc = xs[0];
  for (let i = 1; i < xs.length; i++) acc = f(acc, xs[i]);
  return acc;
}
export function scanl<A, B>(f: (acc: B, a: A) => B, z: B, xs: List<A>): B[] {
  const r: B[] = [z];
  let acc = z;
  for (const x of xs) {
    acc = f(acc, x);
    r.push(acc);
  }
  return r;
}
export function scanl1<A>(f: (acc: A, a: A) => A, xs: List<A>): A[] {
  if (xs.length === 0) return [];
  return scanl(f, xs[0], xs.slice(1));
}
export function scanr<A, B>(f: (a: A, acc: B) => B, z: B, xs: List<A>): B[] {
  const r: B[] = [z];
  let acc = z;
  for (let i = xs.length - 1; i >= 0; i--) {
    acc = f(xs[i], acc);
    r.unshift(acc);
  }
  return r;
}
export function mapAccumL<S, A, B>(f: (s: S, a: A) => [S, B], s0: S, xs: List<A>): [S, B[]] {
  let s = s0;
  const r: B[] = [];
  for (const x of xs) {
    const [s1, b] = f(s, x);
    s = s1;
    r.push(b);
  }
  return [s, r];
}
export function mapAccumR<S, A, B>(f: (s: S, a: A) => [S, B], s0: S, xs: List<A>): [S, B[]] {
  let s = s0;
  const r: B[] = new Array(xs.length);
  for (let i = xs.length - 1; i >= 0; i--) {
    const [s1, b] = f(s, xs[i]);
    s = s1;
    r[i] = b;
  }
  return [s, r];
}
export function unfoldr<B, A>(f: (b: B) => Maybe<[A, B]>, b0: B): A[] {
  const r: A[] = [];
  let b = b0;
  for (;;) {
    const m = f(b);
    if (m.tag === "Nothing") return r;
    r.push(m.value[0]);
    b = m.value[1];
  }
}
export function iterateN<A>(n: number, f: (a: A) => A, x: A): A[] {
  const r: A[] = [];
  let c = x;
  for (let i = 0; i < n; i++) {
    r.push(c);
    c = f(c);
  }
  return r;
}

export function and(xs: List<boolean>): boolean { return xs.every((x) => x); }
export function or(xs: List<boolean>): boolean { return xs.some((x) => x); }
export function any<A>(p: (a: A) => boolean, xs: List<A>): boolean { return xs.some(p); }
export function all<A>(p: (a: A) => boolean, xs: List<A>): boolean { return xs.every(p); }
export function sum(xs: List<number>): number { return xs.reduce((a, b) => a + b, 0); }
export function product(xs: List<number>): number { return xs.reduce((a, b) => a * b, 1); }
export function maximum<A>(xs: List<A>): A {
  if (xs.length === 0) throw new Error("maximum: empty list");
  return xs.reduce((a, b) => (compare(b, a) >= 0 ? b : a));
}
export function minimum<A>(xs: List<A>): A {
  if (xs.length === 0) throw new Error("minimum: empty list");
  return xs.reduce((a, b) => (compare(b, a) < 0 ? b : a));
}
export function maximumBy<A>(c: Comparator<A>, xs: List<A>): A {
  if (xs.length === 0) throw new Error("maximumBy: empty list");
  return xs.reduce((a, b) => (c(b, a) >= 0 ? b : a));
}
export function minimumBy<A>(c: Comparator<A>, xs: List<A>): A {
  if (xs.length === 0) throw new Error("minimumBy: empty list");
  return xs.reduce((a, b) => (c(b, a) < 0 ? b : a));
}

/** Stable sort. */
export function sort<A>(xs: List<A>): A[] { return xs.slice().sort(compare); }
export function sortBy<A>(c: (a: A, b: A) => Ordering | number, xs: List<A>): A[] {
  return xs.slice().sort(c as (a: A, b: A) => number);
}
export function sortOn<A, B>(f: (a: A) => B, xs: List<A>): A[] {
  const keyed = xs.map((x) => [f(x), x] as const);
  keyed.sort((a, b) => compare(a[0], b[0]));
  return keyed.map((p) => p[1]);
}
export function insert<A>(x: A, xs: List<A>): A[] { return insertBy(compare, x, xs); }
export function insertBy<A>(c: Comparator<A>, x: A, xs: List<A>): A[] {
  const i = xs.findIndex((y) => c(x, y) <= 0);
  const r = xs.slice();
  r.splice(i < 0 ? r.length : i, 0, x);
  return r;
}

export function nub<A>(xs: List<A>): A[] { return nubBy(equals, xs); }
export function nubBy<A>(eq: (a: A, b: A) => boolean, xs: List<A>): A[] {
  const r: A[] = [];
  for (const x of xs) if (!r.some((y) => eq(y, x))) r.push(x);
  return r;
}
/** `delete x xs`: remove the first occurrence. */
export function delete_<A>(x: A, xs: List<A>): A[] { return deleteBy(equals, x, xs); }
export { delete_ as delete };
export function deleteBy<A>(eq: (a: A, b: A) => boolean, x: A, xs: List<A>): A[] {
  const i = xs.findIndex((y) => eq(x, y));
  if (i < 0) return xs.slice();
  return [...xs.slice(0, i), ...xs.slice(i + 1)];
}
/** `xs \\ ys` */
export function difference<A>(xs: List<A>, ys: List<A>): A[] {
  let r = xs.slice();
  for (const y of ys) r = delete_(y, r);
  return r;
}
export function union<A>(xs: List<A>, ys: List<A>): A[] {
  const r = xs.slice();
  for (const y of nub(ys)) if (!elem(y, r)) r.push(y);
  return r;
}
export function intersect<A>(xs: List<A>, ys: List<A>): A[] {
  return xs.filter((x) => elem(x, ys));
}

export function group<A>(xs: List<A>): A[][] { return groupBy(equals, xs); }
export function groupBy<A>(eq: (a: A, b: A) => boolean, xs: List<A>): A[][] {
  const r: A[][] = [];
  for (const x of xs) {
    const g = r[r.length - 1];
    if (g && eq(g[0], x)) g.push(x);
    else r.push([x]);
  }
  return r;
}
export function inits<A>(xs: List<A>): A[][] {
  const r: A[][] = [];
  for (let i = 0; i <= xs.length; i++) r.push(xs.slice(0, i));
  return r;
}
export function tails<A>(xs: List<A>): A[][] {
  const r: A[][] = [];
  for (let i = 0; i <= xs.length; i++) r.push(xs.slice(i));
  return r;
}
export function subsequences<A>(xs: List<A>): A[][] {
  const r: A[][] = [[]];
  for (const x of xs) {
    const n = r.length;
    for (let i = 0; i < n; i++) r.push([...r[i], x]);
  }
  return r;
}
export function permutations<A>(xs: List<A>): A[][] {
  if (xs.length <= 1) return [xs.slice()];
  const r: A[][] = [];
  xs.forEach((x, i) => {
    for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) r.push([x, ...p]);
  });
  return r;
}

export function lines(s: string): string[] {
  if (s.length === 0) return [];
  const r = s.split("\n");
  if (r[r.length - 1] === "") r.pop();
  return r;
}
export function unlines(ls: List<string>): string { return ls.map((l) => l + "\n").join(""); }
export function words(s: string): string[] { return s.split(/\s+/).filter((w) => w.length > 0); }
export function unwords(ws: List<string>): string { return ws.join(" "); }

/** `xs !! i` */
export function at<A>(xs: List<A>, i: number): A {
  if (i < 0 || i >= xs.length) throw new Error("Prelude.!!: index too large");
  return xs[i];
}
/** `xs !? i` */
export function atMaybe<A>(xs: List<A>, i: number): Maybe<A> {
  return i >= 0 && i < xs.length ? Just(xs[i]) : Nothing;
}

/** `genericLength` / `length` */
export function length<A>(xs: List<A>): number { return xs.length; }

/** `zip [0..]` helper. */
export function indexed<A>(xs: List<A>): [number, A][] {
  return xs.map((x, i) => [i, x]);
}
