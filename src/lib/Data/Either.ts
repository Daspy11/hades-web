/** Haskell `Data.Either`. */

export interface Left<L> {
  readonly tag: "Left";
  readonly value: L;
}
export interface Right<R> {
  readonly tag: "Right";
  readonly value: R;
}
export type Either<L, R> = Left<L> | Right<R>;

export function Left<L, R = never>(value: L): Either<L, R> {
  return { tag: "Left", value };
}
export function Right<R, L = never>(value: R): Either<L, R> {
  return { tag: "Right", value };
}

export function isLeft<L, R>(e: Either<L, R>): e is Left<L> {
  return e.tag === "Left";
}
export function isRight<L, R>(e: Either<L, R>): e is Right<R> {
  return e.tag === "Right";
}

/** `either f g e` */
export function either<L, R, C>(f: (l: L) => C, g: (r: R) => C, e: Either<L, R>): C {
  return e.tag === "Left" ? f(e.value) : g(e.value);
}

export function fromLeft<L, R>(d: L, e: Either<L, R>): L {
  return e.tag === "Left" ? e.value : d;
}
export function fromRight<L, R>(d: R, e: Either<L, R>): R {
  return e.tag === "Right" ? e.value : d;
}

export function lefts<L, R>(es: readonly Either<L, R>[]): L[] {
  const r: L[] = [];
  for (const e of es) if (e.tag === "Left") r.push(e.value);
  return r;
}
export function rights<L, R>(es: readonly Either<L, R>[]): R[] {
  const r: R[] = [];
  for (const e of es) if (e.tag === "Right") r.push(e.value);
  return r;
}
export function partitionEithers<L, R>(es: readonly Either<L, R>[]): [L[], R[]] {
  return [lefts(es), rights(es)];
}

/** `fmap` on the Right. */
export function mapRight<L, R, R2>(f: (r: R) => R2, e: Either<L, R>): Either<L, R2> {
  return e.tag === "Right" ? Right(f(e.value)) : e;
}
/** `first` on the Left. */
export function mapLeft<L, L2, R>(f: (l: L) => L2, e: Either<L, R>): Either<L2, R> {
  return e.tag === "Left" ? Left(f(e.value)) : e;
}
/** `>>=` */
export function bindEither<L, R, R2>(e: Either<L, R>, f: (r: R) => Either<L, R2>): Either<L, R2> {
  return e.tag === "Right" ? f(e.value) : e;
}

/** `traverse` in the Either applicative: stops at the first Left. */
export function traverseEither<L, A, B>(f: (a: A) => Either<L, B>, xs: readonly A[]): Either<L, B[]> {
  const r: B[] = [];
  for (const x of xs) {
    const e = f(x);
    if (e.tag === "Left") return e;
    r.push(e.value);
  }
  return Right(r);
}

export function sequenceEither<L, R>(es: readonly Either<L, R>[]): Either<L, R[]> {
  return traverseEither((e) => e, es);
}
