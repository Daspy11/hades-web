/**
 * Odds and ends from the Haskell Prelude, `Text.Read`, `Control.Monad`, `Data.Function`,
 * `Data.IORef` and `Data.Default` that do not have a more specific home in `src/lib`.
 */
import { Just, Nothing, type Maybe } from "./Data/Maybe";

// ---------------------------------------------------------------------------------------------
// Functions

export function id<A>(a: A): A {
  return a;
}
export function const_<A>(a: A): (...args: any[]) => A {
  return () => a;
}
export function flip<A, B, C>(f: (a: A, b: B) => C): (b: B, a: A) => C {
  return (b, a) => f(a, b);
}
/** `f . g` */
export function compose<A, B, C>(f: (b: B) => C, g: (a: A) => B): (a: A) => C {
  return (a) => f(g(a));
}
/** `on` from Data.Function: `(op `on` f) x y = op (f x) (f y)` */
export function on<A, B, C>(op: (x: B, y: B) => C, f: (a: A) => B): (x: A, y: A) => C {
  return (x, y) => op(f(x), f(y));
}
export function fst<A, B>(p: readonly [A, B]): A {
  return p[0];
}
export function snd<A, B>(p: readonly [A, B]): B {
  return p[1];
}
export function swap<A, B>(p: readonly [A, B]): [B, A] {
  return [p[1], p[0]];
}
export function curry<A, B, C>(f: (p: [A, B]) => C): (a: A, b: B) => C {
  return (a, b) => f([a, b]);
}
export function uncurry<A, B, C>(f: (a: A, b: B) => C): (p: readonly [A, B]) => C {
  return (p) => f(p[0], p[1]);
}
/** `iterate` limited to a bound because JavaScript arrays are strict. */
export function until<A>(p: (a: A) => boolean, f: (a: A) => A, x: A): A {
  let c = x;
  while (!p(c)) c = f(c);
  return c;
}

/** Haskell `error`. */
export function error(msg: string): never {
  throw new Error(msg);
}
/** Haskell `undefined`. */
export function undefined_(): never {
  throw new Error("Prelude.undefined");
}

/** Exhaustiveness helper for switch statements over tagged unions. */
export function absurd(x: never): never {
  throw new Error("absurd: " + JSON.stringify(x));
}

// ---------------------------------------------------------------------------------------------
// Show

/** Haskell `show` for a `Double`. */
export function showDouble(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const neg = x < 0;
  const a = Math.abs(x);
  // Shortest round-trip digits and exponent from JavaScript.
  const [mant, expStr] = a.toExponential().split("e");
  const digits = mant.replace(".", "");
  const e = parseInt(expStr, 10); // a = 0.d1d2... * 10^(e+1)
  let s: string;
  if (a >= 0.1 && a < 1e7) {
    const pointPos = e + 1;
    if (pointPos <= 0) s = "0." + "0".repeat(-pointPos) + digits;
    else if (pointPos >= digits.length) s = digits + "0".repeat(pointPos - digits.length) + ".0";
    else s = digits.slice(0, pointPos) + "." + digits.slice(pointPos);
  } else {
    const rest = digits.slice(1);
    s = digits[0] + "." + (rest.length > 0 ? rest : "0") + "e" + e;
  }
  return neg ? "-" + s : s;
}

/** Haskell `show` for `Int`/`Integer`. */
export function showInt(n: number | bigint): string {
  return String(n);
}

/** Haskell `show` for `Bool`. */
export function showBool(b: boolean): string {
  return b ? "True" : "False";
}

// ---------------------------------------------------------------------------------------------
// Read

/** `readMaybe :: Maybe Int` (also Integer). Allows surrounding whitespace, rejects `+`. */
export function readInt(s: string): Maybe<number> {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return Nothing;
  const n = Number(t);
  return Number.isFinite(n) ? Just(n) : Nothing;
}
export const readInteger = readInt;

/** `readMaybe :: Maybe Double`. */
export function readDouble(s: string): Maybe<number> {
  const t = s.trim();
  if (t === "NaN") return Just(NaN);
  if (t === "Infinity") return Just(Infinity);
  if (t === "-Infinity") return Just(-Infinity);
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Nothing;
  return Just(Number(t));
}

/** `readMaybe :: Maybe Bool`. */
export function readBool(s: string): Maybe<boolean> {
  const t = s.trim();
  return t === "True" ? Just(true) : t === "False" ? Just(false) : Nothing;
}

/** `readMaybe` for an enumeration whose `Show` is its constructor name. */
export function readEnum<A extends string>(values: readonly A[], s: string): Maybe<A> {
  const t = s.trim();
  return (values as readonly string[]).includes(t) ? Just(t as A) : Nothing;
}

// ---------------------------------------------------------------------------------------------
// Numbers

/** Haskell `round` (banker's rounding: halves go to the even neighbour). */
export function round(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) return r - 1;
  return r;
}
export function truncate(x: number): number {
  return Math.trunc(x);
}
export function ceiling(x: number): number {
  return Math.ceil(x);
}
export function floor(x: number): number {
  return Math.floor(x);
}
/** Haskell `div` (rounds towards negative infinity). */
export function div(a: number, b: number): number {
  return Math.floor(a / b);
}
/** Haskell `mod` (result has the sign of the divisor). */
export function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}
export function quot(a: number, b: number): number {
  return Math.trunc(a / b);
}
export function rem(a: number, b: number): number {
  return a % b;
}
export function signum(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}
export function clamp(lo: number, hi: number, x: number): number {
  return Math.max(lo, Math.min(hi, x));
}
export function logBase(b: number, x: number): number {
  return Math.log(x) / Math.log(b);
}

// ---------------------------------------------------------------------------------------------
// IORef

export interface IORef<A> {
  value: A;
}
export function newIORef<A>(a: A): IORef<A> {
  return { value: a };
}
export function readIORef<A>(r: IORef<A>): A {
  return r.value;
}
export function writeIORef<A>(r: IORef<A>, a: A): void {
  r.value = a;
}
export function modifyIORef<A>(r: IORef<A>, f: (a: A) => A): void {
  r.value = f(r.value);
}
export function atomicModifyIORef<A, B>(r: IORef<A>, f: (a: A) => [A, B]): B {
  const [a, b] = f(r.value);
  r.value = a;
  return b;
}

// ---------------------------------------------------------------------------------------------
// Control.Monad (synchronous)

export function when(b: boolean, act: () => void): void {
  if (b) act();
}
export function unless(b: boolean, act: () => void): void {
  if (!b) act();
}
export function replicate<A>(n: number, f: (i: number) => A): A[] {
  const r: A[] = [];
  for (let i = 0; i < n; i++) r.push(f(i));
  return r;
}
