// Ported from hades/src/Control/Lens/Hades.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Some minor lens utilities used in the Hades library.
 */
import { iso, lens, preview, re, review, view, type Iso, type Lens, type Prism } from "@/lib/Control/Lens";
import { Just, Nothing, fromMaybe, isNothing, type Maybe } from "@/lib/Data/Maybe";
import { equals, type Comparator } from "@/lib/Data/Ord";
import * as S from "@/lib/Data/Set";

/**
 * Create an "Iso'" betweeen a @Maybe@ value and a plain value by using a
 * default that equates to @Nothing@. Useful for things like
 *
 * > optionalText = defaultIso ""
 *
 * which will equate an empty string with @Nothing@.
 *
 * This is not quite a true Iso because @Just d@ will round-trip to @Nothing@ when
 * @d@ is the default value.
 */
export function defaultIso<A>(d: A): Iso<Maybe<A>, A> {
  const f = (m: Maybe<A>): A => (m.tag === "Nothing" ? d : m.value);
  const b = (v: A): Maybe<A> => (equals(v, d) ? Nothing : Just(v));
  return iso(f, b);
}

/** Make a prism into a lens by using a default value. */
export function prismLens<S, A>(d: A, prsm: Prism<S, A>): Lens<S, A> {
  return lens(
    (s: S) => fromMaybe(d, preview(prsm, s)),
    (s: S, v: A) => (equals(v, d) && isNothing(preview(prsm, s)) ? s : review(prsm, v)),
  );
}

/** Make a prism into a lens that passes through a Maybe. */
export function maybeLens<S, A>(prsm: Prism<S, A>): Lens<Maybe<S>, Maybe<A>> {
  const extract1 = (m: Maybe<S>): Maybe<A> => (m.tag === "Nothing" ? Nothing : preview(prsm, m.value));
  const inject = (_: Maybe<S>, mb: Maybe<A>): Maybe<S> =>
    mb.tag === "Nothing" ? Nothing : Just(view(re(prsm), mb.value));
  return lens(extract1, inject);
}

/**
 * Pseudo-ISO for converting between a "Maybe" and a "Set". If the set contains multiple items
 * then the lowest is taken.
 *
 * The optional comparator is used for the set built by the reverse direction; pass it when the
 * element type uses a custom ordering (the TypeScript sets carry their comparator).
 */
export function setMaybeIso<A = any>(cmp?: Comparator<A>): Iso<S.Set<A>, Maybe<A>> {
  const forwards1 = (s: S.Set<A>): Maybe<A> => {
    const xs = S.toList(s);
    return xs.length === 0 ? Nothing : Just(xs[0]);
  };
  const backwards1 = (m: Maybe<A>): S.Set<A> =>
    m.tag === "Nothing" ? S.empty<A>(cmp) : S.singleton(m.value, cmp);
  return iso(forwards1, backwards1);
}
