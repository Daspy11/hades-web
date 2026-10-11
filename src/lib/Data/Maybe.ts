/**
 * Haskell `Data.Maybe`.
 *
 * `Maybe a` is represented as an explicit tagged union rather than `A | undefined` so that
 * nested values such as `Maybe (Maybe a)` keep their meaning.
 */

export interface Nothing {
  readonly tag: "Nothing";
}
export interface Just<A> {
  readonly tag: "Just";
  readonly value: A;
}
export type Maybe<A> = Nothing | Just<A>;

export const Nothing: Nothing = Object.freeze({ tag: "Nothing" as const });

export function Just<A>(value: A): Maybe<A> {
  return { tag: "Just", value };
}

export function isJust<A>(m: Maybe<A>): m is Just<A> {
  return m.tag === "Just";
}

export function isNothing<A>(m: Maybe<A>): m is Nothing {
  return m.tag === "Nothing";
}

/** `fromMaybe d m` */
export function fromMaybe<A>(d: A, m: Maybe<A>): A {
  return m.tag === "Just" ? m.value : d;
}

/** `maybe d f m` */
export function maybe<A, B>(d: B, f: (a: A) => B, m: Maybe<A>): B {
  return m.tag === "Just" ? f(m.value) : d;
}

/** `fromJust`. Throws on Nothing. */
export function fromJust<A>(m: Maybe<A>): A {
  if (m.tag === "Just") return m.value;
  throw new Error("Maybe.fromJust: Nothing");
}

/** `fmap` for Maybe. */
export function mapMaybeValue<A, B>(f: (a: A) => B, m: Maybe<A>): Maybe<B> {
  return m.tag === "Just" ? Just(f(m.value)) : Nothing;
}
export const fmapMaybe = mapMaybeValue;

/** `>>=` for Maybe. */
export function bindMaybe<A, B>(m: Maybe<A>, f: (a: A) => Maybe<B>): Maybe<B> {
  return m.tag === "Just" ? f(m.value) : Nothing;
}

/** `<|>` for Maybe. Left biased. */
export function orElse<A>(m1: Maybe<A>, m2: Maybe<A> | (() => Maybe<A>)): Maybe<A> {
  if (m1.tag === "Just") return m1;
  return typeof m2 === "function" ? m2() : m2;
}

/** `asum` / `msum` for a list of Maybes. */
export function firstJust<A>(ms: readonly Maybe<A>[]): Maybe<A> {
  for (const m of ms) if (m.tag === "Just") return m;
  return Nothing;
}

export function catMaybes<A>(ms: readonly Maybe<A>[]): A[] {
  const r: A[] = [];
  for (const m of ms) if (m.tag === "Just") r.push(m.value);
  return r;
}

/** `mapMaybe f xs` */
export function mapMaybe<A, B>(f: (a: A) => Maybe<B>, xs: readonly A[]): B[] {
  const r: B[] = [];
  for (const x of xs) {
    const m = f(x);
    if (m.tag === "Just") r.push(m.value);
  }
  return r;
}

export function listToMaybe<A>(xs: readonly A[]): Maybe<A> {
  return xs.length > 0 ? Just(xs[0]) : Nothing;
}

export function maybeToList<A>(m: Maybe<A>): A[] {
  return m.tag === "Just" ? [m.value] : [];
}

/** Convert from a nullable JavaScript value. */
export function fromNullable<A>(v: A | null | undefined): Maybe<A> {
  return v === null || v === undefined ? Nothing : Just(v);
}

/** Convert to a nullable JavaScript value (only safe when `A` is not itself nullable). */
export function toUndefined<A>(m: Maybe<A>): A | undefined {
  return m.tag === "Just" ? m.value : undefined;
}

export function toNull<A>(m: Maybe<A>): A | null {
  return m.tag === "Just" ? m.value : null;
}

/** `when (isJust m) ...` helper: `forM_ m f`. */
export function forMaybe<A>(m: Maybe<A>, f: (a: A) => void): void {
  if (m.tag === "Just") f(m.value);
}

/** Applicative lift for two Maybes. */
export function liftA2Maybe<A, B, C>(f: (a: A, b: B) => C, ma: Maybe<A>, mb: Maybe<B>): Maybe<C> {
  return ma.tag === "Just" && mb.tag === "Just" ? Just(f(ma.value, mb.value)) : Nothing;
}

/** `sequence` / `traverse` for a list in the Maybe applicative. */
export function traverseMaybe<A, B>(f: (a: A) => Maybe<B>, xs: readonly A[]): Maybe<B[]> {
  const r: B[] = [];
  for (const x of xs) {
    const m = f(x);
    if (m.tag === "Nothing") return Nothing;
    r.push(m.value);
  }
  return Just(r);
}

export function sequenceMaybe<A>(xs: readonly Maybe<A>[]): Maybe<A[]> {
  return traverseMaybe((x) => x, xs);
}

/** Filter a Maybe with a predicate (`mfilter`). */
export function filterMaybe<A>(p: (a: A) => boolean, m: Maybe<A>): Maybe<A> {
  return m.tag === "Just" && p(m.value) ? m : Nothing;
}

/** `Semigroup a => Semigroup (Maybe a)` */
export function appendMaybe<A>(append: (x: A, y: A) => A, m1: Maybe<A>, m2: Maybe<A>): Maybe<A> {
  if (m1.tag === "Nothing") return m2;
  if (m2.tag === "Nothing") return m1;
  return Just(append(m1.value, m2.value));
}

/** `First` monoid on Maybe. */
export function firstOf<A>(m1: Maybe<A>, m2: Maybe<A>): Maybe<A> {
  return m1.tag === "Just" ? m1 : m2;
}
/** `Last` monoid on Maybe. */
export function lastOf<A>(m1: Maybe<A>, m2: Maybe<A>): Maybe<A> {
  return m2.tag === "Just" ? m2 : m1;
}
