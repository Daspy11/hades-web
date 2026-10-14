/**
 * Haskell `Test.QuickCheck` (QuickCheck 2.14), generator part: the `Gen` monad, its combinators
 * (`Test.QuickCheck.Gen`) and the `Arbitrary` class with the instances for the base types
 * (`Test.QuickCheck.Arbitrary`). Programs such as `demo-webit` use these to make random data.
 * Property testing (`quickCheck`, `Testable`, `Property`) is not provided: tests use vitest.
 *
 * Representation
 * --------------
 * * `Gen a` (`MkGen (QCGen -> Int -> a)`) is a function `Gen<A> = (r: QCGen, size: number) => A`.
 *   `unGen g r n` is `g(r, n)`. Monadic code is direct style:
 *   `do x <- g1; y <- g2; return (f x y)` → `(r, n) => { const x = g1(r, n); const y = g2(r, n); return f(x, y); }`,
 *   and `f <$> g1 <*> g2` likewise (arguments are generated left to right).
 * * `QCGen` is a seeded pseudo-random generator (mulberry32). QuickCheck splits its generator
 *   for every bind; here one generator is used in sequence, so the values differ from the
 *   Haskell ones for the same seed, but the distributions are those of QuickCheck.
 * * `generate :: Gen a -> IO a` is synchronous (`generate(g)`), with a fresh random seed and
 *   size 30, as QuickCheck. `generateWith(seed, size, g)` is a reproducible variant (web/test only).
 * * The `Arbitrary` class is the dictionary `Arbitrary<A>` (`arbitrary`, `shrink`). Instances:
 *   `Arbitrary_Bool`, `Arbitrary_Int`, `Arbitrary_Integer`, `Arbitrary_Double`, `Arbitrary_Word8`,
 *   `Arbitrary_Char`, `Arbitrary_Unit`, and the constrained `Arbitrary_List(cls)`,
 *   `Arbitrary_Maybe(cls)`, `Arbitrary_Set(cls)`, `Arbitrary_Tree(cls)`, `Arbitrary_Tuple2(c1, c2)`.
 *   `arbitrary :: Gen [a]` is `Arbitrary_List(cls).arbitrary`; `vector n` is `vector(cls, n)`.
 * * `choose (lo, hi)` for integral types is `choose([lo, hi])`; `chooseDouble([lo, hi])` for
 *   `Double`; `chooseEnum(values, [lo, hi])` for enumerations (the `Enum` dictionary is the list
 *   of values in order).
 */
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { error, round } from "@/lib/Prelude";

// ---------------------------------------------------------------------------------------------
// Random generator

/** The random generator used by `Gen` (mulberry32). */
export class QCGen {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  /** 32 random bits, as an unsigned integer. */
  nextWord32(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** A number uniformly distributed in [0, 1), with 53 random bits. */
  nextDouble(): number {
    const hi = this.nextWord32() >>> 5; // 27 bits
    const lo = this.nextWord32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }
}

/** A generator with the given seed. */
export function mkQCGen(seed: number): QCGen {
  return new QCGen(seed);
}

/** Web/test: the source of the seeds of `newQCGen`, when fixed with `setQCGenSeed`. */
let fixedSeeds: QCGen | null = null;

/**
 * Web/test only: from now on `newQCGen` (and so `generate`) draws its seeds from a generator
 * with this seed, so that the values generated are reproducible; `null` restores random seeds.
 */
export function setQCGenSeed(seed: number | null): void {
  fixedSeeds = seed === null ? null : new QCGen(seed);
}

/** A generator with a random seed. */
export function newQCGen(): QCGen {
  let seed: number;
  if (fixedSeeds !== null) {
    seed = fixedSeeds.nextWord32();
  } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
  } else {
    seed = Math.floor(Math.random() * 4294967296);
  }
  return new QCGen(seed);
}

/** A uniformly distributed integer in the inclusive range (exact for ranges below 2^53). */
function randomInteger(r: QCGen, lo: number, hi: number): number {
  if (lo > hi) return randomInteger(r, hi, lo);
  const span = hi - lo + 1;
  if (span <= 4294967296) {
    // Rejection sampling on 32 bits keeps small ranges exactly uniform.
    const limit = Math.floor(4294967296 / span) * span;
    for (;;) {
      const w = r.nextWord32();
      if (w < limit) return lo + (w % span);
    }
  }
  return lo + Math.floor(r.nextDouble() * span);
}

// ---------------------------------------------------------------------------------------------
// The Gen monad

/** A generator for values of type @a@. (`newtype Gen a = MkGen {unGen :: QCGen -> Int -> a}`) */
export type Gen<A> = (r: QCGen, size: number) => A;

/** Run the generator on a particular seed and size. */
export function unGen<A>(g: Gen<A>, r: QCGen, n: number): A {
  return g(r, n);
}

/** `instance Functor Gen` */
export function fmap_Gen<A, B>(f: (a: A) => B, g: Gen<A>): Gen<B> {
  return (r, n) => f(g(r, n));
}

/** `pure`/`return` of `instance Monad Gen` */
export function pure_Gen<A>(x: A): Gen<A> {
  return () => x;
}

/** `<*>` of `instance Applicative Gen` */
export function ap_Gen<A, B>(gf: Gen<(a: A) => B>, gx: Gen<A>): Gen<B> {
  return (r, n) => {
    const f = gf(r, n);
    return f(gx(r, n));
  };
}

/** `>>=` of `instance Monad Gen` */
export function bind_Gen<A, B>(g: Gen<A>, k: (a: A) => Gen<B>): Gen<B> {
  return (r, n) => k(g(r, n))(r, n);
}

/** Generates a value, using a fresh random seed and size 30. (`IO`, synchronous.) */
export function generate<A>(g: Gen<A>): A {
  return g(newQCGen(), 30);
}

/** Web/test: `generate` with a fixed seed and size, for reproducible values. */
export function generateWith<A>(seed: number, size: number, g: Gen<A>): A {
  return g(mkQCGen(seed), size);
}

/** Generates some example values (sizes 0, 2, 4, ..., 20). (`IO`, synchronous.) */
export function sample_<A>(g: Gen<A>): A[] {
  const r = newQCGen();
  return Array.from({ length: 11 }, (_, i) => g(r, 2 * i));
}

/** Used to construct generators that depend on the size parameter. */
export function sized<A>(f: (n: number) => Gen<A>): Gen<A> {
  return (r, n) => f(n)(r, n);
}

/** Returns the size parameter. Used to construct generators that depend on the size parameter. */
export const getSize: Gen<number> = (_r, n) => n;

/** Overrides the size parameter. Returns a generator which uses the given size instead of the runtime-size parameter. */
export function resize<A>(n: number, g: Gen<A>): Gen<A> {
  if (n < 0) return error("Test.QuickCheck.resize: negative size");
  return (r) => g(r, n);
}

/** Adjust the size parameter, by transforming it with the given function. */
export function scale<A>(f: (n: number) => number, g: Gen<A>): Gen<A> {
  return sized((n) => resize(f(n), g));
}

/**
 * Generates a random element in the given inclusive range. (For integral types: `Int`,
 * `Integer`, `Word8`, ...; see `chooseDouble` and `chooseEnum`.)
 */
export function choose([lo, hi]: readonly [number, number]): Gen<number> {
  return (r) => randomInteger(r, lo, hi);
}

/** A fast implementation of 'choose' for 'Int'. */
export const chooseInt = choose;

/** A fast implementation of 'choose' for 'Integer'. */
export const chooseInteger = choose;

/** `choose` for `Double`: uniform in the range. */
export function chooseDouble([lo, hi]: readonly [number, number]): Gen<number> {
  return (r) => lo + r.nextDouble() * (hi - lo);
}

/** A fast implementation of 'choose' for enumerated types. `values` is the type's `[minBound ..]`. */
export function chooseEnum<A>(values: readonly A[], [lo, hi]: readonly [A, A]): Gen<A> {
  const i = values.findIndex((v) => equals(v, lo));
  const j = values.findIndex((v) => equals(v, hi));
  return (r) => values[randomInteger(r, i, j)];
}

/** Generates a value that satisfies a predicate. */
export function suchThat<A>(gen: Gen<A>, p: (a: A) => boolean): Gen<A> {
  return (r, n) => {
    for (let k = 0; ; k++) {
      const m = suchThatMaybe(gen, p)(r, n + k);
      if (m.tag === "Just") return m.value;
    }
  };
}

/** Tries to generate a value that satisfies a predicate. If it fails to do so after enough attempts, returns @Nothing@. */
export function suchThatMaybe<A>(gen: Gen<A>, p: (a: A) => boolean): Gen<Maybe<A>> {
  // Tries the sizes n .. 2n.
  return (r, n) => {
    for (let m = n; m <= 2 * n; m++) {
      const x = gen(r, m);
      if (p(x)) return Just(x);
    }
    return Nothing;
  };
}

/** Randomly uses one of the given generators. The input list must be non-empty. */
export function oneof<A>(gs: readonly Gen<A>[]): Gen<A> {
  if (gs.length === 0) return error("QuickCheck.oneof used with empty list");
  return (r, n) => gs[randomInteger(r, 0, gs.length - 1)](r, n);
}

/**
 * Chooses one of the given generators, with a weighted random distribution. The input list
 * must be non-empty.
 */
export function frequency<A>(xs0: readonly (readonly [number, Gen<A>])[]): Gen<A> {
  if (xs0.some(([w]) => w < 0)) return error("QuickCheck.frequency: negative weight");
  const tot = xs0.reduce((s, [w]) => s + w, 0);
  if (tot === 0) return error("QuickCheck.frequency: all weights were zero");
  return (r, n) => {
    let k = randomInteger(r, 1, tot);
    for (const [w, g] of xs0) {
      if (k <= w) return g(r, n);
      k -= w;
    }
    return error("QuickCheck.pick used with empty list");
  };
}

/** Generates one of the given values. The input list must be non-empty. */
export function elements<A>(xs: readonly A[]): Gen<A> {
  if (xs.length === 0) return error("QuickCheck.elements used with empty list");
  return (r) => xs[randomInteger(r, 0, xs.length - 1)];
}

/** Generates a random subsequence of the given list. */
export function sublistOf<A>(xs: readonly A[]): Gen<A[]> {
  // filterM (\_ -> chooseEnum (False, True)) xs
  return (r) => xs.filter(() => randomInteger(r, 0, 1) === 1);
}

/** Generates a random permutation of the given list. */
export function shuffle<A>(xs: readonly A[]): Gen<A[]> {
  return (r) => {
    const ns = xs.map((x, i) => [r.nextDouble(), i, x] as const);
    return [...ns].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , x]) => x);
  };
}

/** Generates a list of random length. The maximum length depends on the size parameter. */
export function listOf<A>(gen: Gen<A>): Gen<A[]> {
  return sized((n) => (r, m) => {
    const k = randomInteger(r, 0, n);
    return vectorOf(k, gen)(r, m);
  });
}

/** Generates a non-empty list of random length. The maximum length depends on the size parameter. */
export function listOf1<A>(gen: Gen<A>): Gen<A[]> {
  return sized((n) => (r, m) => {
    const k = randomInteger(r, 1, Math.max(1, n));
    return vectorOf(k, gen)(r, m);
  });
}

/** Generates a list of the given length. */
export function vectorOf<A>(k: number, gen: Gen<A>): Gen<A[]> {
  return (r, n) => Array.from({ length: Math.max(0, k) }, () => gen(r, n));
}

// ---------------------------------------------------------------------------------------------
// Arbitrary

/** Random generation and shrinking of values. (`class Arbitrary a`) */
export interface Arbitrary<A> {
  /** A generator for values of the given type. */
  readonly arbitrary: Gen<A>;
  /** Produces a (possibly) empty list of all the possible immediate shrinks of the given value. */
  shrink(a: A): A[];
}

/** Generates a list of a given length. */
export function vector<A>(cls: Arbitrary<A>, k: number): Gen<A[]> {
  return vectorOf(k, cls.arbitrary);
}

/** Returns no shrinking alternatives. */
export function shrinkNothing<A>(_a: A): A[] {
  return [];
}

/** Generates an integral number. The number can be positive or negative and its maximum absolute value depends on the size parameter. */
export const arbitrarySizedIntegral: Gen<number> = sized((n) => choose([-n, n]));

/** Generates a natural number. The number's maximum value depends on the size parameter. */
export const arbitrarySizedNatural: Gen<number> = sized((n) => choose([0, n]));

/** Generates a fractional number. The number can be positive or negative and its maximum absolute value depends on the size parameter. */
export const arbitrarySizedFractional: Gen<number> = sized((n) => (r, m) => {
  const precision = 9999999999999;
  const b = chooseInteger([1, precision])(r, m);
  const a = chooseInteger([-n * b, n * b])(r, m);
  return a / b;
});

/** Generates an integral number from a bounded domain. The number is chosen from the entire range of the type. */
export function arbitraryBoundedIntegral(mn: number, mx: number): Gen<number> {
  return choose([mn, mx]);
}

/** Generates an element of a bounded enumeration (`values` = `[minBound ..]`). */
export function arbitraryBoundedEnum<A>(values: readonly A[]): Gen<A> {
  return elements(values);
}

/**
 * Generates an integral number from a bounded domain. The number is chosen from the entire
 * range of the type, but small numbers are generated more often than big numbers.
 */
export function arbitrarySizedBoundedIntegral(mn: number, mx: number): Gen<number> {
  const ilog2 = (k: number): number => (k <= 1 ? 0 : 1 + ilog2(Math.floor(k / 2)));
  // How many bits are needed to represent this type? (An upper bound, not exact.)
  const bits = ilog2(mx - mn + 1);
  return sized((k) => {
    // Reach maximum size by k=80, or quicker for small integer types
    const power = Math.floor((Math.max(bits, 40) * k) / 80);
    const p = Math.min(power, bits);
    const lo = Math.max(mn, -(2 ** p));
    const hi = Math.min(mx, 2 ** p);
    return chooseInteger([lo, hi]);
  });
}

/** Shrink an integral number. */
export function shrinkIntegral(x: number): number[] {
  // a << b is "morally" abs a < abs b.
  const lt = (a: number, b: number): boolean => Math.abs(a) < Math.abs(b);
  const out: number[] = [];
  if (x < 0 && -x > x) out.push(-x);
  const cands = [0];
  for (let i = Math.trunc(x / 2); i !== 0; i = Math.trunc(i / 2)) cands.push(x - i);
  for (const c of cands) {
    if (!lt(c, x)) break;
    out.push(c);
  }
  return out.filter((v, i) => out.indexOf(v) === i);
}

/** Shrink a fraction, preferring numbers with shorter decimal representations. */
export function shrinkDecimal(x: number): number[] {
  // NaN: `0 : take 10 (iterate (*2) 0)`, i.e. eleven zeros. Infinity: QuickCheck gives
  // `0 : takeWhile (<x) (iterate (*2) 0)`, an endless list of zeros; here just one.
  if (Number.isNaN(x)) return Array.from({ length: 11 }, () => 0);
  if (!Number.isFinite(x)) return [0];
  const out: number[] = [];
  for (let k = 0, precision = 1; k < 6; k++, precision *= 10) {
    const m = round(x * precision);
    if (!(precision === 1 || m % precision !== 0)) continue;
    for (const n of [m, ...shrinkIntegral(m)]) {
      const y = n / precision;
      if (Math.abs(y) < Math.abs(x)) out.push(y);
    }
  }
  return out;
}

/** Shrink a list of values given a shrinking function for individual values. */
export function shrinkList<A>(shr: (a: A) => A[], xs: readonly A[]): A[][] {
  const n = xs.length;
  const removes = (k: number, n1: number, ys: readonly A[]): A[][] => {
    if (k > n1) return [];
    const ys1 = ys.slice(0, k);
    const ys2 = ys.slice(k);
    if (ys2.length === 0) return [[]];
    return [ys2.slice(), ...removes(k, n1 - k, ys2).map((zs) => [...ys1, ...zs])];
  };
  const shrinkOne = (ys: readonly A[]): A[][] => {
    if (ys.length === 0) return [];
    const [y, ...rest] = ys;
    return [...shr(y).map((y1) => [y1, ...rest]), ...shrinkOne(rest).map((rest1) => [y, ...rest1])];
  };
  const out: A[][] = [];
  for (let k = n; k > 0; k = Math.floor(k / 2)) out.push(...removes(k, n, xs));
  return [...out, ...shrinkOne(xs)];
}

/** `instance Arbitrary ()` */
export const Arbitrary_Unit: Arbitrary<null> = { arbitrary: pure_Gen(null), shrink: shrinkNothing };

/** `instance Arbitrary Bool` */
export const Arbitrary_Bool: Arbitrary<boolean> = {
  arbitrary: chooseEnum([false, true], [false, true]),
  shrink: (b) => (b ? [false] : []),
};

/** `instance Arbitrary Int` */
export const Arbitrary_Int: Arbitrary<number> = { arbitrary: arbitrarySizedIntegral, shrink: shrinkIntegral };

/** `instance Arbitrary Integer` */
export const Arbitrary_Integer: Arbitrary<number> = { arbitrary: arbitrarySizedIntegral, shrink: shrinkIntegral };

/** `instance Arbitrary Word8` */
export const Arbitrary_Word8: Arbitrary<number> = {
  arbitrary: arbitrarySizedBoundedIntegral(0, 255),
  shrink: shrinkIntegral,
};

/**
 * The Calkin–Wilf enumeration of the rationals as (numerator, denominator) pairs,
 * interleaved with their negations after zero: 0, 1, -1, 1/2, -1/2, 2, -2, ...
 */
function rationalNth(i: number): number {
  if (i === 0) return 0;
  const k = Math.floor((i - 1) / 2) + 1; // 1-based position in the Calkin–Wilf sequence
  let num = 1, den = 1;
  for (let j = 1; j < k; j++) {
    // next q = 1 / (2 floor(q) - q + 1)
    const fl = Math.floor(num / den);
    const n1 = den, d1 = 2 * fl * den - num + den;
    num = n1;
    den = d1;
  }
  const q = num / den;
  return (i - 1) % 2 === 0 ? q : -q;
}

/**
 * `instance Arbitrary Double`: as QuickCheck 2.14, one of: a number in [0, 1) with full
 * precision, an `Int`, a fraction with a small denominator, a uniform fraction in
 * [-size, size] with denominator up to the size, or `arbitrarySizedFractional`.
 */
export const Arbitrary_Double: Arbitrary<number> = {
  arbitrary: oneof<number>([
    // generate 0..1 numbers with full precision
    (r) => r.nextDouble(),
    // generate integral numbers
    arbitrarySizedIntegral,
    // generate fractions with small denominators
    sized((n) => (r) => rationalNth(randomInteger(r, 0, Math.min(n, 256)))),
    // uniform -size..size with with denominators ~ size
    sized((n) => (r, m) => {
      const b = chooseInteger([1, Math.max(1, n)])(r, m);
      const a = chooseInteger([-n * b, n * b])(r, m);
      return a / b;
    }),
    // and uniform -size..size with higher precision
    arbitrarySizedFractional,
  ]),
  shrink: shrinkDecimal,
};

/** `instance Arbitrary Char`: mostly ASCII, as QuickCheck. */
export const Arbitrary_Char: Arbitrary<string> = {
  arbitrary: frequency<string>([
    [3, (r) => String.fromCharCode(randomInteger(r, 32, 126))],
    [1, (r) => String.fromCodePoint(randomInteger(r, 0, 0xd7ff))],
  ]),
  shrink: (c) => ["a", "b", "c", "A", "B", "C", "1", "2", "3", " ", "\n"].filter((x) => x < c),
};

/** `instance Arbitrary a => Arbitrary [a]` */
export function Arbitrary_List<A>(cls: Arbitrary<A>): Arbitrary<A[]> {
  return { arbitrary: listOf(cls.arbitrary), shrink: (xs) => shrinkList((x: A) => cls.shrink(x), xs) };
}

/** `instance Arbitrary a => Arbitrary (Maybe a)` */
export function Arbitrary_Maybe<A>(cls: Arbitrary<A>): Arbitrary<Maybe<A>> {
  return {
    arbitrary: frequency<Maybe<A>>([
      [1, pure_Gen<Maybe<A>>(Nothing)],
      [3, fmap_Gen((x: A): Maybe<A> => Just(x), cls.arbitrary)],
    ]),
    shrink: (m) => (m.tag === "Nothing" ? [] : [Nothing, ...cls.shrink(m.value).map((x) => Just(x))]),
  };
}

/** `instance (Ord a, Arbitrary a) => Arbitrary (Set a)` */
export function Arbitrary_Set<A>(cls: Arbitrary<A>): Arbitrary<S.Set<A>> {
  const lst = Arbitrary_List(cls);
  return {
    arbitrary: fmap_Gen((xs: A[]) => S.fromList(xs), lst.arbitrary),
    shrink: (s) => lst.shrink(S.toList(s)).map((xs) => S.fromList(xs)),
  };
}

/** `instance (Arbitrary a, Arbitrary b) => Arbitrary (a, b)` */
export function Arbitrary_Tuple2<A, B>(c1: Arbitrary<A>, c2: Arbitrary<B>): Arbitrary<[A, B]> {
  return {
    arbitrary: (r, n) => {
      const a = c1.arbitrary(r, n);
      return [a, c2.arbitrary(r, n)];
    },
    shrink: ([a, b]) => [...c1.shrink(a).map((a1): [A, B] => [a1, b]), ...c2.shrink(b).map((b1): [A, B] => [a, b1])],
  };
}

/**
 * `instance Arbitrary a => Arbitrary (Tree a)`: the size is the number of nodes, split at random
 * between the children.
 */
export function Arbitrary_Tree<A>(cls: Arbitrary<A>): Arbitrary<Tree<A>> {
  const arbPartition = (r: QCGen, k: number): number[] => {
    if (k < 1) return [];
    if (k === 1) return [1];
    const first = randomInteger(r, 1, k);
    const rest = arbPartition(r, k - first);
    return shuffle([first, ...rest])(r, 0);
  };
  // n is the size of the tree.
  const go = (r: QCGen, size: number, n: number): Tree<A> => {
    const value = cls.arbitrary(r, size);
    const pars = arbPartition(r, n - 1); // can go negative!
    const forest = pars.map((p) => go(r, size, p));
    return Node(value, forest);
  };
  const shrinkTree = (t: Tree<A>): Tree<A>[] => [
    ...t.subForest,
    ...[
      ...cls.shrink(t.rootLabel).map((v): Tree<A> => Node(v, t.subForest)),
      ...shrinkList(shrinkTree, t.subForest).map((fs): Tree<A> => Node(t.rootLabel, fs)),
    ],
  ];
  return {
    arbitrary: sized((n) => (r, size) => go(r, size, randomInteger(r, 0, n))),
    shrink: shrinkTree,
  };
}

/** `Arbitrary (Forest a)`, i.e. `Arbitrary [Tree a]`. */
export function Arbitrary_Forest<A>(cls: Arbitrary<A>): Arbitrary<Forest<A>> {
  return Arbitrary_List(Arbitrary_Tree(cls));
}
