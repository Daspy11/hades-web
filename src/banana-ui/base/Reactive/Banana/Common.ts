// Ported from banana-ui/base/Reactive/Banana/Common.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Common types for tables and dialogs.
 *
 * TypeScript port
 * ---------------
 * * Type class instances are functions: `fmap_GadgetData`, `pure_GadgetData`, `ap_GadgetData`,
 *   `append_GadgetData`, `mempty_GadgetData`, `fmap_Changes`, `pure_Changes`, `ap_Changes`,
 *   `liftA2_Changes`. The `Num`, `Fractional` and `Floating` instances of `Changes` become
 *   helper functions on `Changes<number>` (`add_Changes`, `divide_Changes`, `sin_Changes`, ...).
 * * `newtype Colour` is erased to the `Colour` class of `@/lib/Data/Colour`; `Colour(c)` and
 *   `getColour(c)` are identity functions kept for the Haskell names.
 * * `textPrism` takes the `Show`/`Read` functions explicitly; `textPrismInt`, `textPrismInteger`
 *   and `textPrismDouble` are ready-made instances.
 * * `reactimate1`/`reactimate1_` defer the stop action with `queueMicrotask` instead of `forkIO`.
 */
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe, fromMaybe, mapMaybeValue, mapMaybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { notEquals } from "@/lib/Data/Ord";
import { isSpace } from "@/lib/Data/Char";
import { formatDay, parseDay, type Day } from "@/lib/Data/Time";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { lens, over, preview, prism_, re, review, view, type Lens, type Prism } from "@/lib/Control/Lens";
import { error, logBase, readDouble, readInt, readInteger, showDouble, showInt, signum } from "@/lib/Prelude";

// ---------------------------------------------------------------------------------------------
// GadgetData

/** If there is data then it carries a validity flag. */
export interface GadgetData<A> {
  /** Is the value considered valid? */
  readonly _gdOk: boolean;
  readonly _gdValue: A;
}
export function GadgetData<A>(_gdOk: boolean, _gdValue: A): GadgetData<A> {
  return { _gdOk, _gdValue };
}

/** `instance Functor GadgetData` */
export function fmap_GadgetData<A, R>(f: (a: A) => R, x: GadgetData<A>): GadgetData<R> {
  return over(gdValue<A, R>(), f, x);
}

/** `pure` of `instance Applicative GadgetData` */
export function pure_GadgetData<A>(v: A): GadgetData<A> {
  return GadgetData(true, v);
}

/** `(<*>)` of `instance Applicative GadgetData` */
export function ap_GadgetData<A, R>(gf: GadgetData<(a: A) => R>, gv: GadgetData<A>): GadgetData<R> {
  return GadgetData(gf._gdOk && gv._gdOk, gf._gdValue(gv._gdValue));
}

/** `foldMap` of `instance Foldable GadgetData` */
export function foldMap_GadgetData<A, M>(f: (a: A) => M, x: GadgetData<A>): M {
  return f(x._gdValue);
}

/**
 * `traverse` of `instance Traversable GadgetData`. The first argument is `fmap` of the
 * applicative functor being traversed into.
 */
export function traverse_GadgetData<A>(
  fmapF: (g: (x: any) => any, fx: any) => any,
  f: (a: A) => any,
  x: GadgetData<A>,
): any {
  return fmapF((v: any) => GadgetData(x._gdOk, v), f(x._gdValue));
}

/**
 * `sequenceA` of `instance Traversable GadgetData`. The first argument is `fmap` of the
 * applicative functor being sequenced.
 */
export function sequenceA_GadgetData(fmapF: (g: (x: any) => any, fx: any) => any, x: GadgetData<any>): any {
  return fmapF((v: any) => GadgetData(x._gdOk, v), x._gdValue);
}

/** `instance (Semigroup a) => Semigroup (GadgetData a)` */
export function append_GadgetData<A>(appendA: (a: A, b: A) => A, x: GadgetData<A>, y: GadgetData<A>): GadgetData<A> {
  return GadgetData(x._gdOk && y._gdOk, appendA(x._gdValue, y._gdValue));
}

/** `instance (Monoid a) => Monoid (GadgetData a)` */
export function mempty_GadgetData<A>(memptyA: A): GadgetData<A> {
  return GadgetData(true, memptyA);
}

/** Is the data considered valid? */
export function gdOk<A = any>(): Lens<GadgetData<A>, boolean> {
  return lens((g: GadgetData<A>) => g._gdOk, (g, ok: boolean) => ({ ...g, _gdOk: ok }));
}

export function gdValue<O1 = any, O2 = O1>(): Lens<GadgetData<O1>, O1, GadgetData<O2>, O2> {
  return lens(
    (g: GadgetData<O1>) => g._gdValue,
    (g, v: O2): GadgetData<O2> => ({ ...g, _gdValue: v }),
  );
}

// ---------------------------------------------------------------------------------------------
// Changes

/**
 * An event and behavior for the same thing travelling together.
 *
 * Law: The behavior must be a stepper for the event.
 */
export interface Changes<A> {
  readonly changesE: B.Event<A>;
  readonly changesB: B.Behavior<A>;
}
export function Changes<A>(changesE: B.Event<A>, changesB: B.Behavior<A>): Changes<A> {
  return { changesE, changesB };
}

/** `instance Functor Changes` */
export function fmap_Changes<A, R>(f: (a: A) => R, c: Changes<A>): Changes<R> {
  return Changes(B.mapE(f, c.changesE), B.mapB(f, c.changesB));
}

/** `pure` of `instance Applicative Changes` */
export function pure_Changes<A>(v: A): Changes<A> {
  return Changes(B.never<A>(), B.pureB(v));
}

/** `(<*>)` of `instance Applicative Changes` */
export function ap_Changes<A, R>(cf: Changes<(a: A) => R>, cx: Changes<A>): Changes<R> {
  const ef = cf.changesE, bf = cf.changesB;
  const e = cx.changesE, b = cx.changesB;
  type Occ = Either<[(a: A) => R, R], [A, R]>;
  const ef1: B.Event<Occ> = B.apply(B.mapB((v: A) => (f: (a: A) => R): Occ => Left([f, f(v)]), b), ef);
  const e1: B.Event<Occ> = B.apply(B.mapB((f: (a: A) => R) => (v: A): Occ => Right([v, f(v)]), bf), e);
  const simultaneous = (x: Occ, y: Occ): Occ => {
    if (x.tag === "Left" && y.tag === "Right") {
      const f = x.value[0];
      const v = y.value[0];
      return Left([f, f(v)]);
    }
    return error("Applicative Changes: The impossible happened.");
  };
  const extract = (x: Occ): R => x.value[1];
  return Changes(B.mapE(extract, B.unionWith(simultaneous, ef1, e1)), B.applyB(bf, b));
}

/** `liftA2` of `instance Applicative Changes` (the default `liftA2 f x = (<*>) (fmap f x)`). */
export function liftA2_Changes<A, A2, R>(f: (a: A, b: A2) => R, x: Changes<A>, y: Changes<A2>): Changes<R> {
  return ap_Changes(fmap_Changes((a: A) => (b: A2) => f(a, b), x), y);
}

// instance (Num a) => Num (Changes a)

/** Haskell `(+)` of `instance Num (Changes a)` */
export function add_Changes(x: Changes<number>, y: Changes<number>): Changes<number> {
  return liftA2_Changes((a, b) => a + b, x, y);
}
/** Haskell `(-)` of `instance Num (Changes a)` */
export function sub_Changes(x: Changes<number>, y: Changes<number>): Changes<number> {
  return liftA2_Changes((a, b) => a - b, x, y);
}
/** Haskell `(*)` of `instance Num (Changes a)` */
export function mul_Changes(x: Changes<number>, y: Changes<number>): Changes<number> {
  return liftA2_Changes((a, b) => a * b, x, y);
}
/** `abs` of `instance Num (Changes a)` */
export function abs_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.abs, x);
}
/** `signum` of `instance Num (Changes a)` */
export function signum_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(signum, x);
}
/** `fromInteger` of `instance Num (Changes a)` */
export function fromInteger_Changes(n: number): Changes<number> {
  return pure_Changes(n);
}
/** `negate` of `instance Num (Changes a)` */
export function negate_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes((a: number) => -a, x);
}

// instance (Fractional a) => Fractional (Changes a)

/** Haskell `(/)` of `instance Fractional (Changes a)` */
export function divide_Changes(x: Changes<number>, y: Changes<number>): Changes<number> {
  return liftA2_Changes((a, b) => a / b, x, y);
}
/** `fromRational` of `instance Fractional (Changes a)` */
export function fromRational_Changes(r: number): Changes<number> {
  return pure_Changes(r);
}
/** `recip` of `instance Fractional (Changes a)` */
export function recip_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes((a: number) => 1 / a, x);
}

// instance (Floating a) => Floating (Changes a)

/** Haskell `(**)` of `instance Floating (Changes a)` */
export function pow_Changes(x: Changes<number>, y: Changes<number>): Changes<number> {
  return liftA2_Changes((a, b) => Math.pow(a, b), x, y);
}
export function acos_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.acos, x);
}
export function acosh_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.acosh, x);
}
export function asin_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.asin, x);
}
export function asinh_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.asinh, x);
}
export function atan_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.atan, x);
}
export function atanh_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.atanh, x);
}
export function cos_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.cos, x);
}
export function cosh_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.cosh, x);
}
export function exp_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.exp, x);
}
export function log_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.log, x);
}
export function logBase_Changes(b: Changes<number>, x: Changes<number>): Changes<number> {
  return liftA2_Changes(logBase, b, x);
}
export const pi_Changes: Changes<number> = pure_Changes(Math.PI);
export function sin_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.sin, x);
}
export function sinh_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.sinh, x);
}
export function sqrt_Changes(x: Changes<number>): Changes<number> {
  return fmap_Changes(Math.sqrt, x);
}

/** Construct a Changes from an initial value and an event. */
export function makeChanges<A>(initial: A, ev: B.Event<A>): Changes<A> {
  const b = B.stepper(initial, ev);
  return Changes(ev, b);
}

/** When the event occurs the input will be sampled and an event created. */
export function sampledBy<A>(chng: Changes<A>, ev: B.Event<any>): Changes<A> {
  const b = chng.changesB;
  return Changes(B.tag(b, ev), b);
}

/** Combine a list of function changes. */
export function unionsC<A>(cs: readonly Changes<(a: A) => A>[]): Changes<(a: A) => A> {
  return Changes(
    B.unions(cs.map((c) => c.changesE)),
    L.foldr(
      (c: Changes<(a: A) => A>, acc: B.Behavior<(a: A) => A>) =>
        B.liftA2B((f: (a: A) => A, g: (a: A) => A) => (x: A) => f(g(x)), c.changesB, acc),
      B.pureB((x: A) => x),
      cs,
    ),
  );
}

/**
 * Filter out events that do not actually change the value.
 *
 * This only filters the event: "changes" will still fire for values that are the same.
 */
export function filterChanges<A>(c: Changes<A>): Changes<A> {
  return filterChangesWith(notEquals, c);
}

/**
 * Filter out events unless the old and new values return "True". Note that the behavior will
 * still continue to change even if events are filtered.
 */
export function filterChangesWith<A>(f: (a: A, b: A) => boolean, c: Changes<A>): Changes<A> {
  const e = c.changesE, b = c.changesB;
  const e1 = B.filterApply(B.mapB((old: A) => (nw: A) => f(old, nw), b), e); // Event fires before behavior change.
  return Changes(e1, b);
}

/** The difference between the old and new value as an event. */
export function changeDelta<A, R>(
  /** Binary function. First argument is the old value, second is the new. */
  f: (a: A, b: A) => R,
  c: Changes<A>,
): B.Event<R> {
  return B.apply(B.mapB((old: A) => (nw: A) => f(old, nw), c.changesB), c.changesE);
}

/**
 * The output is the last "Just" value of the input. Inputs of "Nothing" have no effect.
 * The first argument is used if the value is initially "Nothing".
 */
export function sticky<A>(i: A, c: Changes<Maybe<A>>): Changes<A> {
  const initial = B.valueB(B.mapB((m: Maybe<A>) => fromMaybe(i, m), c.changesB));
  const e2 = B.filterJust(c.changesE);
  const b2 = B.stepper(initial, e2);
  return Changes(e2, b2);
}

// ---------------------------------------------------------------------------------------------
// Prisms

/** Add an extra valid value of \"\" for @Nothing@. */
export function prismToMaybe<A>(prsm: Prism<T.Text, A>): Prism<T.Text, Maybe<A>> {
  const show1 = (m: Maybe<A>): T.Text => (m.tag === "Nothing" ? "" : review(prsm, m.value));
  const read1 = (str1: T.Text): Maybe<Maybe<A>> => {
    if (str1 === "") return Just(Nothing); // Valid entry of Nothing.
    const r = preview(prsm, str1);
    return r.tag === "Just" ? Just(Just(r.value)) : Nothing; // Valid entry of something / Invalid entry.
  };
  return prism_(show1, read1);
}

/**
 * Simple text prism for data fields.
 *
 * The Haskell version uses the `Show` and `Read` instances of the target type; here they are
 * passed explicitly. See `textPrismInt`, `textPrismInteger` and `textPrismDouble`.
 */
export function textPrism<A>(show: (a: A) => string, read: (s: string) => Maybe<A>): Prism<T.Text, A> {
  return prism_((a: A) => T.pack(show(a)), (t: T.Text) => read(T.unpack(t)));
}

/** `textPrism :: Prism' Text Int` */
export const textPrismInt: Prism<T.Text, number> = textPrism(showInt, readInt);

/** `textPrism :: Prism' Text Integer` */
export const textPrismInteger: Prism<T.Text, number> = textPrism(showInt, readInteger);

/** `textPrism :: Prism' Text Double` */
export const textPrismDouble: Prism<T.Text, number> = textPrism(showDouble, readDouble);

/** POSIX-style date formats, as in "Date.Calendar.Format". */
export type DateFormat = T.Text;

/** E.g. \"3 January 2018\" */
export const longDate: DateFormat = "%-d %B %Y";

/** E.g. \"3/1/2018\" */
export const shortDate: DateFormat = "%-d/%-m/%Y";

// ---------------------------------------------------------------------------------------------
// Colour

/**
 * Convenience type for dealing with colours.
 *
 * Haskell `newtype Colour = Colour {getColour :: C.Colour Double}`, erased to the `Colour`
 * class of `@/lib/Data/Colour` (which already has the derived `Eq`, `Semigroup` and `Monoid`).
 */
export type Colour = C.Colour;
/** The `Colour` newtype constructor (identity). */
export function Colour(c: C.Colour): Colour {
  return c;
}
/** The `getColour` newtype field (identity). */
export function getColour(c: Colour): C.Colour {
  return c;
}

/** `deriving Semigroup` of `Colour` */
export function append_Colour(a: Colour, b: Colour): Colour {
  return C.append(a, b);
}
/** `deriving Monoid` of `Colour` */
export const mempty_Colour: Colour = C.mempty;

/** `instance Show Colour` */
export function show_Colour(c: Colour): string {
  return T.unpack(view(re(colourPrism), c));
}

/** `instance Default Colour`: gray. */
export const def_Colour: Colour = Colour(C.sRGB24(128, 128, 128)); // Gray

/** Name of an icon, as text. */
export type IconName = T.Text;

/**
 * The icon called \"no-icon\" is a special case. Where the icon is optional this is used
 * for the @Nothing@ value. It contains the text "No Icon".
 */
export const noIconName: IconName = "no-icon";

/** The icon called \"blank-icon\" is a similar special case. It contains nothing. */
export const blankIconName: IconName = "blank-icon";

/**
 * Format and read the date.
 *
 * The format argument is used for date → text conversion. Text → date tries the format argument
 * first. If that fails it then tries a series of built-in formats. These use the default locale
 * (i.e. USA), but assume UK ordering (i.e. dd-mm-yyyy).
 *
 * This is going to require proper i18n support in the future.
 */
export function datePrism(fmt: DateFormat): Prism<T.Text, Day> {
  const fmt1 = T.unpack(fmt);
  const readFormats = [
    fmt1, "%Y-%m-%d", "%-d/%-m/%Y", "%-d/%-m/%c", "%-d/%b/%Y", "%-d/%b/%c",
    "%-d %b %Y", "%-d %b %c", "%-d %B %Y", "%-d %B %c",
  ];
  const readDate = (str: string): Maybe<Day> => {
    // Haskell: the first result of `mapMaybe (\f -> parseTimeM True defaultTimeLocale f str)`.
    for (const f of readFormats) {
      const d = parseDay(f, str);
      if (d.tag === "Just") return d;
    }
    return Nothing;
  };
  return prism_((d: Day) => T.pack(formatDay(fmt1, d)), (t: T.Text) => readDate(T.unpack(t)));
}

/** Convert between colour and the 6 digit hex format (e.g. @#ff80ff@). */
export const colourPrism: Prism<T.Text, Colour> = (() => {
  const readColor = (str: T.Text): Maybe<C.Colour> => C.sRGB24read(T.unpack(T.dropAround(isSpace, str)));
  return prism_(
    (c: Colour) => T.pack(C.sRGB24show(getColour(c))),
    (str: T.Text) => mapMaybeValue(Colour, readColor(str)),
  );
})();

// ---------------------------------------------------------------------------------------------
// Trees

/** Filter out Nothing values. A node of "Nothing" will have its children pruned. */
export function forestCatMaybe<A>(f: Forest<Maybe<A>>): Tree<A>[] {
  return mapMaybe(treeCatMaybe, f);
}

/** Filter out Nothing values. If the root contains Nothing then return Nothing. */
export function treeCatMaybe<A>(t: Tree<Maybe<A>>): Maybe<Tree<A>> {
  const v = t.rootLabel;
  if (v.tag === "Nothing") return Nothing;
  return Just(Node(v.value, forestCatMaybe(t.subForest)));
}

// ---------------------------------------------------------------------------------------------
// Events

/**
 * Left-biased utility for the union of events due to signals. Simultaneous signals should
 * never happen because it would imply that the user has clicked on two items simultaneously.
 */
export function firstEvent<A>(evs: readonly B.Event<A>[]): B.Event<A> {
  if (evs.length === 0) return B.never<A>();
  return L.foldr1((e: B.Event<A>, acc: B.Event<A>) => B.unionWith((x: A, _y: A) => x, e, acc), evs);
}

/**
 * Convenience version of "reactimate_". The returned action is in the @IO@ monad and is
 * wrapped in @forkIO@. This avoids the risk of the application hanging if the returned action
 * is triggered during an "execute", but at the price of non-determinism.
 *
 * TypeScript: the stop action is deferred with `queueMicrotask` instead of `forkIO`.
 */
export function reactimate1(evs: B.Event<() => void>): () => void {
  const net = B.getEventNetwork();
  const stop = B.reactimate_(evs);
  return () => queueMicrotask(() => B.runMomentIO(net, stop));
}

/** Convenience version of "reactimate_'" (Haskell `reactimate1'`). */
export function reactimate1_(evs: B.Event<B.Future<() => void>>): () => void {
  const net = B.getEventNetwork();
  const stop = B.reactimatePrime_(evs);
  return () => queueMicrotask(() => B.runMomentIO(net, stop));
}
