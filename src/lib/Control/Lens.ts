/**
 * A small optics library mirroring the parts of Haskell's `Control.Lens` used by HADES.
 *
 * Optic kinds and their capabilities:
 *
 * | kind      | get | over/set | toList/preview | review | match |
 * |-----------|-----|----------|----------------|--------|-------|
 * | Iso       |  ✓  |    ✓     |       ✓        |   ✓    |   ✓   |
 * | Lens      |  ✓  |    ✓     |       ✓        |        |       |
 * | Prism     |     |    ✓     |       ✓        |   ✓    |   ✓   |
 * | Traversal |     |    ✓     |       ✓        |        |       |
 * | Getter    |  ✓  |          |       ✓        |        |       |
 * | Fold      |     |          |       ✓        |        |       |
 * | Setter    |     |    ✓     |                |        |       |
 *
 * Composition (Haskell `l1 . l2`) is written `l1.dot(l2)` and yields the weakest common kind.
 *
 * Operators (Haskell argument order is kept):
 *
 * | Haskell        | TypeScript               |
 * |----------------|--------------------------|
 * | `s ^. l`       | `view(l, s)`             |
 * | `s ^? l`       | `preview(l, s)` (Maybe)  |
 * | `s ^?! l`      | `previewOrThrow(l, s)`   |
 * | `s ^.. l`      | `toListOf(l, s)`         |
 * | `l .~ b $ s`   | `set(l, b, s)`           |
 * | `l %~ f $ s`   | `over(l, f, s)`          |
 * | `l ?~ b $ s`   | `setJust(l, b, s)`       |
 * | `l # b`        | `review(l, b)`           |
 * | `has l s`      | `has(l, s)`              |
 */
import { Just, Nothing, type Maybe } from "../Data/Maybe";
import { Left, Right, type Either } from "../Data/Either";
import { equals } from "../Data/Ord";
import * as M from "../Data/Map";
import * as S from "../Data/Set";

type Kind = "iso" | "lens" | "prism" | "traversal" | "getter" | "fold" | "setter";

interface Caps {
  get?: (s: any) => any;
  over?: (s: any, f: (a: any) => any) => any;
  toList?: (s: any) => any[];
  first?: (s: any) => Maybe<any>;
  review?: (b: any) => any;
  match?: (s: any) => Either<any, any>;
}

function kindOf(c: Caps): Kind {
  const g = !!c.get, o = !!c.over, l = !!c.toList, r = !!c.review, m = !!c.match;
  if (g && o && r && m) return "iso";
  if (g && o) return "lens";
  if (o && r && m && l) return "prism";
  if (o && l) return "traversal";
  if (g) return "getter";
  if (l) return "fold";
  return "setter";
}

function unsupported(kind: string, op: string): never {
  throw new Error(`Lens: ${op} is not supported by a ${kind}`);
}

/** Runtime representation shared by all optic kinds. */
export class OpticImpl implements Optic<any, any, any, any> {
  readonly kind: Kind;
  private readonly caps: Caps;

  constructor(caps: Caps) {
    // Derive missing capabilities where possible.
    const c: Caps = { ...caps };
    if (c.get && !c.toList) {
      const g = c.get;
      c.toList = (s) => [g(s)];
    }
    if (c.get && !c.first) {
      const g = c.get;
      c.first = (s) => Just(g(s));
    }
    if (c.match && !c.toList) {
      const m = c.match;
      c.toList = (s) => {
        const r = m(s);
        return r.tag === "Right" ? [r.value] : [];
      };
    }
    if (c.match && !c.first) {
      const m = c.match;
      c.first = (s) => {
        const r = m(s);
        return r.tag === "Right" ? Just(r.value) : Nothing;
      };
    }
    if (c.toList && !c.first) {
      const tl = c.toList;
      c.first = (s) => {
        const xs = tl(s);
        return xs.length > 0 ? Just(xs[0]) : Nothing;
      };
    }
    this.caps = c;
    this.kind = kindOf(c);
  }

  get(s: any): any {
    return this.caps.get ? this.caps.get(s) : unsupported(this.kind, "view");
  }
  over(s: any, f: (a: any) => any): any {
    return this.caps.over ? this.caps.over(s, f) : unsupported(this.kind, "over");
  }
  toList(s: any): any[] {
    return this.caps.toList ? this.caps.toList(s) : unsupported(this.kind, "toListOf");
  }
  first(s: any): Maybe<any> {
    return this.caps.first ? this.caps.first(s) : unsupported(this.kind, "preview");
  }
  review(b: any): any {
    return this.caps.review ? this.caps.review(b) : unsupported(this.kind, "review");
  }
  match(s: any): Either<any, any> {
    return this.caps.match ? this.caps.match(s) : unsupported(this.kind, "matching");
  }
  hasCap(k: keyof Caps): boolean {
    return !!this.caps[k];
  }

  dot(other: any): any {
    const a = this.caps, b = (other as OpticImpl).caps;
    const c: Caps = {};
    if (a.get && b.get) {
      const ag = a.get, bg = b.get;
      c.get = (s) => bg(ag(s));
    }
    if (a.over && b.over) {
      const ao = a.over, bo = b.over;
      c.over = (s, f) => ao(s, (x) => bo(x, f));
    }
    if (a.toList && b.toList) {
      const at = a.toList, bt = b.toList;
      c.toList = (s) => {
        const xs = at(s);
        if (xs.length === 1) return bt(xs[0]);
        return xs.flatMap(bt);
      };
    }
    if (a.first && b.first && (a.get || a.match)) {
      // Only valid when the outer optic has at most one target.
      const af = a.first, bf = b.first;
      c.first = (s) => {
        const m = af(s);
        return m.tag === "Just" ? bf(m.value) : Nothing;
      };
    }
    if (a.review && b.review) {
      const ar = a.review, br = b.review;
      c.review = (x) => ar(br(x));
    }
    if (a.match && b.match && a.review) {
      const am = a.match, bm = b.match, ar = a.review;
      c.match = (s) => {
        const m1 = am(s);
        if (m1.tag === "Left") return m1;
        const m2 = bm(m1.value);
        if (m2.tag === "Left") return Left(ar(m2.value));
        return m2;
      };
    }
    return new OpticImpl(c);
  }
}

// ---------------------------------------------------------------------------------------------
// Types

declare const KindBrand: unique symbol;

/** Common base interface: composition. */
export interface Optic<S, A, T = S, B = A> {
  readonly kind: Kind;
  dot<C, D>(this: Iso<S, A, T, B>, o: Iso<A, C, B, D>): Iso<S, C, T, D>;
  dot<C, D>(this: Lens<S, A, T, B>, o: Lens<A, C, B, D>): Lens<S, C, T, D>;
  dot<C, D>(this: Prism<S, A, T, B>, o: Prism<A, C, B, D>): Prism<S, C, T, D>;
  dot<C, D>(this: Traversal<S, A, T, B>, o: Traversal<A, C, B, D>): Traversal<S, C, T, D>;
  dot<C>(this: Getter<S, A, T, B>, o: Getter<A, C, any, any>): Getter<S, C>;
  dot<C>(this: Fold<S, A, T, B>, o: Fold<A, C, any, any>): Fold<S, C>;
  dot<C, D>(this: Setter<S, A, T, B>, o: Setter<A, C, B, D>): Setter<S, C, T, D>;
}

export interface Setter<S, A, T = S, B = A> extends Optic<S, A, T, B> {
  over(s: S, f: (a: A) => B): T;
}
export interface Fold<S, A, T = S, B = A> extends Optic<S, A, T, B> {
  toList(s: S): A[];
  first(s: S): Maybe<A>;
}
export interface Getter<S, A, T = S, B = A> extends Fold<S, A, T, B> {
  get(s: S): A;
}
export interface Traversal<S, A, T = S, B = A> extends Setter<S, A, T, B>, Fold<S, A, T, B> {}
export interface Lens<S, A, T = S, B = A> extends Traversal<S, A, T, B>, Getter<S, A, T, B> {}
export interface Prism<S, A, T = S, B = A> extends Traversal<S, A, T, B> {
  review(b: B): T;
  match(s: S): Either<T, A>;
}
export interface Iso<S, A, T = S, B = A> extends Lens<S, A, T, B>, Prism<S, A, T, B> {}

/** Something that can be reviewed (a Prism or Iso). */
export interface Review<T, B> {
  review(b: B): T;
}

export type Lens_<S, A> = Lens<S, A, S, A>;
export type Prism_<S, A> = Prism<S, A, S, A>;
export type Traversal_<S, A> = Traversal<S, A, S, A>;
export type Iso_<S, A> = Iso<S, A, S, A>;

// ---------------------------------------------------------------------------------------------
// Constructors

/** `lens getter setter` where `setter :: s -> b -> t`. */
export function lens<S, A, T = S, B = A>(get: (s: S) => A, setter: (s: S, b: B) => T): Lens<S, A, T, B> {
  return new OpticImpl({ get, over: (s, f) => setter(s, f(get(s))) }) as any;
}

/** `iso f g` */
export function iso<S, A, T = S, B = A>(f: (s: S) => A, g: (b: B) => T): Iso<S, A, T, B> {
  return new OpticImpl({
    get: f,
    over: (s, h) => g(h(f(s))),
    review: g,
    match: (s) => Right(f(s)),
  }) as any;
}

/** `prism build match` where `match :: s -> Either t a`. */
export function prism<S, A, T = S, B = A>(build: (b: B) => T, match: (s: S) => Either<T, A>): Prism<S, A, T, B> {
  return new OpticImpl({
    review: build,
    match,
    over: (s, f) => {
      const m = match(s);
      return m.tag === "Right" ? build(f(m.value)) : m.value;
    },
  }) as any;
}

/** `prism' build match` where `match :: s -> Maybe a`. */
export function prism_<S, A>(build: (a: A) => S, match: (s: S) => Maybe<A>): Prism<S, A> {
  return prism<S, A>(build, (s) => {
    const m = match(s);
    return m.tag === "Just" ? Right(m.value) : Left(s);
  });
}

/** `to f`: a Getter. */
export function to<S, A>(f: (s: S) => A): Getter<S, A> {
  return new OpticImpl({ get: f }) as any;
}

/** `folding f`: a Fold from a function returning a list. */
export function folding<S, A>(f: (s: S) => readonly A[]): Fold<S, A> {
  return new OpticImpl({ toList: (s) => f(s).slice() }) as any;
}

/** A Traversal given its `over` and `toList` implementations. */
export function traversal<S, A, T = S, B = A>(
  overF: (s: S, f: (a: A) => B) => T, toListF: (s: S) => A[],
): Traversal<S, A, T, B> {
  return new OpticImpl({ over: overF, toList: toListF }) as any;
}

/** `sets`: a Setter from an `over` function. */
export function sets<S, A, T = S, B = A>(overF: (s: S, f: (a: A) => B) => T): Setter<S, A, T, B> {
  return new OpticImpl({ over: overF }) as any;
}

/** The identity optic (Haskell `id` used as a lens). */
export function identity<S = any>(): Iso<S, S> {
  return idIso as any;
}
const idIso = iso((s: any) => s, (s: any) => s);

// ---------------------------------------------------------------------------------------------
// Operators

export function view<S, A>(l: Getter<S, A>, s: S): A {
  return l.get(s);
}
/** `views l f s` */
export function views<S, A, R>(l: Getter<S, A>, f: (a: A) => R, s: S): R {
  return f(l.get(s));
}
export function preview<S, A>(l: Fold<S, A>, s: S): Maybe<A> {
  return l.first(s);
}
export function previewOrThrow<S, A>(l: Fold<S, A>, s: S): A {
  const m = l.first(s);
  if (m.tag === "Nothing") throw new Error("(^?!): empty Fold");
  return m.value;
}
export function toListOf<S, A>(l: Fold<S, A>, s: S): A[] {
  return l.toList(s);
}
export function has<S, A>(l: Fold<S, A>, s: S): boolean {
  return l.first(s).tag === "Just";
}
export function hasnt<S, A>(l: Fold<S, A>, s: S): boolean {
  return !has(l, s);
}
export function set<S, A, T, B>(l: Setter<S, A, T, B>, b: B, s: S): T {
  return l.over(s, () => b);
}
export function over<S, A, T, B>(l: Setter<S, A, T, B>, f: (a: A) => B, s: S): T {
  return l.over(s, f);
}
/** `l ?~ b` */
export function setJust<S, A, T>(l: Setter<S, Maybe<A>, T, Maybe<A>>, b: A, s: S): T {
  return l.over(s, () => Just(b));
}
export function review<T, B>(l: Review<T, B>, b: B): T {
  return l.review(b);
}
/** `matching l s` */
export function matching<S, A, T>(l: Prism<S, A, T, any>, s: S): Either<T, A> {
  return l.match(s);
}
/** `is l s` / `has` for prisms. */
export function is<S, A>(l: Fold<S, A>, s: S): boolean {
  return has(l, s);
}
/** `anyOf l p s` */
export function anyOf<S, A>(l: Fold<S, A>, p: (a: A) => boolean, s: S): boolean {
  return l.toList(s).some(p);
}
export function allOf<S, A>(l: Fold<S, A>, p: (a: A) => boolean, s: S): boolean {
  return l.toList(s).every(p);
}
export function lengthOf<S, A>(l: Fold<S, A>, s: S): number {
  return l.toList(s).length;
}
export function elemOf<S, A>(l: Fold<S, A>, x: A, s: S): boolean {
  return l.toList(s).some((y) => equals(x, y));
}
export function findOf<S, A>(l: Fold<S, A>, p: (a: A) => boolean, s: S): Maybe<A> {
  const r = l.toList(s).find(p);
  return r === undefined ? Nothing : Just(r);
}
export function foldMapOf<S, A, R>(l: Fold<S, A>, f: (a: A) => R, append: (x: R, y: R) => R, empty: R, s: S): R {
  return l.toList(s).map(f).reduce(append, empty);
}
export function sumOf<S>(l: Fold<S, number>, s: S): number {
  return l.toList(s).reduce((a, b) => a + b, 0);
}

/** `withPrism p k` */
export function withPrism<S, A, T, B, R>(p: Prism<S, A, T, B>, k: (build: (b: B) => T, match: (s: S) => Either<T, A>) => R): R {
  return k((b) => p.review(b), (s) => p.match(s));
}
/** `withLens l k` */
export function withLens<S, A, T, B, R>(l: Lens<S, A, T, B>, k: (get: (s: S) => A, setter: (s: S, b: B) => T) => R): R {
  return k((s) => l.get(s), (s, b) => l.over(s, () => b));
}
/** `withIso i k` */
export function withIso<S, A, T, B, R>(i: Iso<S, A, T, B>, k: (f: (s: S) => A, g: (b: B) => T) => R): R {
  return k((s) => i.get(s), (b) => i.review(b));
}

export function cloneLens<O>(l: O): O { return l; }
export function clonePrism<O>(p: O): O { return p; }
export function cloneTraversal<O>(t: O): O { return t; }
export function cloneIso<O>(i: O): O { return i; }

/** `re p`: turn a Prism into a Getter of its review, or reverse an Iso. */
export function re<S, A, T, B>(p: Iso<S, A, T, B>): Iso<B, T, A, S>;
export function re<S, A, T, B>(p: Prism<S, A, T, B>): Getter<B, T>;
export function re(p: any): any {
  if (p.hasCap("get")) return from(p);
  return to((b: any) => p.review(b));
}

/** `from i`: reverse an Iso. */
export function from<S, A, T, B>(i: Iso<S, A, T, B>): Iso<B, T, A, S> {
  return iso((b: B) => i.review(b), (s: S) => i.get(s as any) as any) as any;
}

/** `under i f` = `over (from i) f` */
export function under<S, A, T, B>(i: Iso<S, A, T, B>, f: (t: T) => S, b: B): A {
  return i.get(f(i.review(b)));
}

// ---------------------------------------------------------------------------------------------
// Standard optics

export function _1<A = any, B = any, C = A>(): Lens<readonly [A, B], A, [C, B], C> {
  return lens((s: readonly [A, B]) => s[0], (s, b: C) => [b, s[1]] as [C, B]);
}
export function _2<A = any, B = any, C = B>(): Lens<readonly [A, B], B, [A, C], C> {
  return lens((s: readonly [A, B]) => s[1], (s, b: C) => [s[0], b] as [A, C]);
}
/** `_1` for triples. */
export function _1of3<A = any, B = any, C = any>(): Lens<readonly [A, B, C], A, [A, B, C], A> {
  return lens((s: readonly [A, B, C]) => s[0], (s, b: A) => [b, s[1], s[2]] as [A, B, C]);
}
export function _2of3<A = any, B = any, C = any>(): Lens<readonly [A, B, C], B, [A, B, C], B> {
  return lens((s: readonly [A, B, C]) => s[1], (s, b: B) => [s[0], b, s[2]] as [A, B, C]);
}
export function _3<A = any, B = any, C = any>(): Lens<readonly [A, B, C], C, [A, B, C], C> {
  return lens((s: readonly [A, B, C]) => s[2], (s, b: C) => [s[0], s[1], b] as [A, B, C]);
}

export function _Just<A = any, B = A>(): Prism<Maybe<A>, A, Maybe<B>, B> {
  return prism((b: B) => Just(b), (m: Maybe<A>) => (m.tag === "Just" ? Right(m.value) : Left(Nothing as Maybe<B>)));
}
export function _Nothing<A = any>(): Prism<Maybe<A>, null> {
  return prism_<Maybe<A>, null>(() => Nothing, (m) => (m.tag === "Nothing" ? Just(null) : Nothing));
}
export function _Left<A = any, B = any, C = A>(): Prism<Either<A, B>, A, Either<C, B>, C> {
  return prism((c: C) => Left(c), (e: Either<A, B>) => (e.tag === "Left" ? Right(e.value) : Left(e as unknown as Either<C, B>)));
}
export function _Right<A = any, B = any, C = B>(): Prism<Either<A, B>, B, Either<A, C>, C> {
  return prism((c: C) => Right(c), (e: Either<A, B>) => (e.tag === "Right" ? Right(e.value) : Left(e as unknown as Either<A, C>)));
}

/** `each` / `traversed` over the elements of an array. */
export function each<A = any, B = A>(): Traversal<readonly A[], A, B[], B> {
  return traversal((s: readonly A[], f: (a: A) => B) => s.map(f), (s: readonly A[]) => s.slice());
}
export const traversed = each;
export const folded = each;
/** `mapped` over arrays. */
export function mapped<A = any, B = A>(): Setter<readonly A[], A, B[], B> {
  return sets((s: readonly A[], f: (a: A) => B) => s.map(f));
}

/** `each` over the values of a Map. */
export function eachMap<K = any, V = any, W = V>(): Traversal<M.HMap<K, V>, V, M.HMap<K, W>, W> {
  return traversal((m: M.HMap<K, V>, f: (v: V) => W) => M.map(f, m), (m: M.HMap<K, V>) => M.elems(m));
}
/** `each` over the elements of a Set (as a Fold). */
export function eachSet<A = any>(): Fold<S.HSet<A>, A> {
  return folding((s: S.HSet<A>) => S.toList(s));
}
/** `each` over a Maybe (same as `_Just`). */
export function eachMaybe<A = any>(): Traversal<Maybe<A>, A> {
  return _Just<A>();
}
/** `both` over a pair. */
export function both<A = any, B = A>(): Traversal<readonly [A, A], A, [B, B], B> {
  return traversal((s: readonly [A, A], f: (a: A) => B) => [f(s[0]), f(s[1])] as [B, B], (s) => [s[0], s[1]]);
}
/** `_head` over a list. */
export function _head<A = any>(): Traversal<readonly A[], A, A[], A> {
  return traversal(
    (s: readonly A[], f: (a: A) => A) => (s.length === 0 ? [] : [f(s[0]), ...s.slice(1)]),
    (s) => (s.length === 0 ? [] : [s[0]]),
  );
}
export function _last<A = any>(): Traversal<readonly A[], A, A[], A> {
  return traversal(
    (s: readonly A[], f: (a: A) => A) => (s.length === 0 ? [] : [...s.slice(0, -1), f(s[s.length - 1])]),
    (s) => (s.length === 0 ? [] : [s[s.length - 1]]),
  );
}

/** `at k` for a Map: `Lens' (Map k v) (Maybe v)`. */
export function at<K = any, V = any>(k: K): Lens<M.HMap<K, V>, Maybe<V>> {
  return lens(
    (m: M.HMap<K, V>) => M.lookup(k, m),
    (m, mv: Maybe<V>) => (mv.tag === "Just" ? M.insert(k, mv.value, m) : M.delete(k, m)),
  );
}
/** `at k` for a Set: `Lens' (Set k) (Maybe ())`, with `()` represented as `null`. */
export function atSet<K = any>(k: K): Lens<S.HSet<K>, Maybe<null>> {
  return lens(
    (s: S.HSet<K>) => (S.member(k, s) ? Just(null) : Nothing),
    (s, mv: Maybe<null>) => (mv.tag === "Just" ? S.insert(k, s) : S.delete(k, s)),
  );
}
/** `contains k` for a Set. */
export function contains<K = any>(k: K): Lens<S.HSet<K>, boolean> {
  return lens(
    (s: S.HSet<K>) => S.member(k, s),
    (s, b: boolean) => (b ? S.insert(k, s) : S.delete(k, s)),
  );
}
/** `ix k` for a Map. */
export function ix<K = any, V = any>(k: K): Traversal<M.HMap<K, V>, V> {
  return traversal(
    (m: M.HMap<K, V>, f: (v: V) => V) => M.adjust(f, k, m),
    (m: M.HMap<K, V>) => {
      const r = M.lookup(k, m);
      return r.tag === "Just" ? [r.value] : [];
    },
  );
}
/** `ix i` for a list. */
export function ixList<A = any>(i: number): Traversal<readonly A[], A, A[], A> {
  return traversal(
    (s: readonly A[], f: (a: A) => A) => (i >= 0 && i < s.length ? s.map((x, j) => (j === i ? f(x) : x)) : s.slice()),
    (s: readonly A[]) => (i >= 0 && i < s.length ? [s[i]] : []),
  );
}

/** `non d`: `Iso' (Maybe a) a`. */
export function non<A = any>(d: A): Iso<Maybe<A>, A> {
  return iso(
    (m: Maybe<A>) => (m.tag === "Just" ? m.value : d),
    (a: A) => (equals(a, d) ? Nothing : Just(a)),
  );
}

/** `filtered p` */
export function filtered<A = any>(p: (a: A) => boolean): Traversal<A, A> {
  return traversal((s: A, f: (a: A) => A) => (p(s) ? f(s) : s), (s: A) => (p(s) ? [s] : []));
}

/** `failing l1 l2`: use l1 if it has any targets, otherwise l2. */
export function failing<S = any, A = any>(l1: Traversal<S, A>, l2: Traversal<S, A>): Traversal<S, A>;
export function failing<S = any, A = any>(l1: Fold<S, A>, l2: Fold<S, A>): Fold<S, A>;
export function failing(l1: any, l2: any): any {
  const c: Caps = {
    toList: (s) => {
      const xs = l1.toList(s);
      return xs.length > 0 ? xs : l2.toList(s);
    },
  };
  if (l1.hasCap("over") && l2.hasCap("over")) {
    c.over = (s, f) => (l1.toList(s).length > 0 ? l1.over(s, f) : l2.over(s, f));
  }
  return new OpticImpl(c);
}

/** `singular t`: a Lens onto the first target of a Traversal (throws if there is none). */
export function singular<S = any, A = any>(t: Traversal<S, A>): Lens<S, A> {
  return new OpticImpl({
    get: (s) => {
      const xs = t.toList(s);
      if (xs.length === 0) throw new Error("singular: empty traversal");
      return xs[0];
    },
    over: (s, f) => {
      let done = false;
      return t.over(s, (a) => {
        if (done) return a;
        done = true;
        return f(a);
      });
    },
  }) as any;
}

/** `taking n t` */
export function taking<S = any, A = any>(n: number, t: Traversal<S, A>): Traversal<S, A> {
  return traversal(
    (s: S, f: (a: A) => A) => {
      let i = 0;
      return t.over(s, (a) => (i++ < n ? f(a) : a));
    },
    (s: S) => t.toList(s).slice(0, n),
  );
}
/** `dropping n t` */
export function dropping<S = any, A = any>(n: number, t: Traversal<S, A>): Traversal<S, A> {
  return traversal(
    (s: S, f: (a: A) => A) => {
      let i = 0;
      return t.over(s, (a) => (i++ >= n ? f(a) : a));
    },
    (s: S) => t.toList(s).slice(n),
  );
}

/** `ignored`: a Traversal with no targets. */
export function ignored<S = any, A = any>(): Traversal<S, A> {
  return traversal((s: S) => s, () => []);
}

/** `chosen`: `Lens' (Either a a) a`. */
export function chosen<A = any>(): Lens<Either<A, A>, A> {
  return lens(
    (e: Either<A, A>) => e.value,
    (e, a: A) => (e.tag === "Left" ? Left(a) : Right(a)),
  );
}

/** `_Wrapped`-like helper for newtypes represented by their contents. */
export function coerced<A = any>(): Iso<A, A> {
  return identity<A>();
}

// ---------------------------------------------------------------------------------------------
// MonadState-style operations on a mutable state cell.

/** A mutable state cell standing in for a `MonadState s` context. */
export interface StateCell<S> {
  state: S;
}

/** `use l` */
export function use<S = any, A = any>(st: StateCell<S>, l: Getter<S, A>): A {
  return l.get(st.state);
}
/** `uses l f` */
export function uses<S = any, A = any, R = any>(st: StateCell<S>, l: Getter<S, A>, f: (a: A) => R): R {
  return f(l.get(st.state));
}
/** `preuse l` */
export function preuse<S = any, A = any>(st: StateCell<S>, l: Fold<S, A>): Maybe<A> {
  return l.first(st.state);
}
/** `l .= v` / `assign l v` */
export function assign<S = any, A = any>(st: StateCell<S>, l: Setter<S, A>, v: A): void {
  st.state = l.over(st.state, () => v);
}
/** `l %= f` / `modifying l f` */
export function modifying<S = any, A = any>(st: StateCell<S>, l: Setter<S, A>, f: (a: A) => A): void {
  st.state = l.over(st.state, f);
}
/** `l ?= v` */
export function assignJust<S = any, A = any>(st: StateCell<S>, l: Setter<S, Maybe<A>>, v: A): void {
  st.state = l.over(st.state, () => Just(v));
}
/** `l <>= v` with an explicit append. */
export function appending<S = any, A = any>(st: StateCell<S>, l: Setter<S, A>, append: (x: A, y: A) => A, v: A): void {
  st.state = l.over(st.state, (x) => append(x, v));
}
/** `l += n` */
export function adding<S = any>(st: StateCell<S>, l: Setter<S, number>, n: number): void {
  st.state = l.over(st.state, (x) => x + n);
}
/** `l *= n` */
export function multiplying<S = any>(st: StateCell<S>, l: Setter<S, number>, n: number): void {
  st.state = l.over(st.state, (x) => x * n);
}
/** `get` */
export function getState<S = any>(st: StateCell<S>): S {
  return st.state;
}
/** `put` */
export function putState<S = any>(st: StateCell<S>, s: S): void {
  st.state = s;
}
/** `modify f` */
export function modifyState<S = any>(st: StateCell<S>, f: (s: S) => S): void {
  st.state = f(st.state);
}
/** `gets f` */
export function gets<S = any, R = any>(st: StateCell<S>, f: (s: S) => R): R {
  return f(st.state);
}
