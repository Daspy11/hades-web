// Ported from hades/src/Hades/Abstract/AutoMonad.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * __An automaton monad.__
 *
 * A conventional automaton that takes a stream of type @i@ and outputs a stream of type @o@ is:
 *
 * > newtype Auto i o = Auto (i -> (o, Auto i o))
 *
 * However to create one of these you have to have an explicit state machine in which each
 * value of @Auto@ is a separate state.
 *
 * This version provides a monadic interface with the "yield" function, so that the programmer can
 * define a sequence of computations in which "yield" passes an output to the caller along with a
 * continuation which accepts the new input. From the point of view of a monadic action in the
 * automaton, "yield" looks like a normal monadic action which asks the outside world for some
 * input. From the point of view of the application the whole computation looks like a state machine
 * where each input produces an output and a new state.
 *
 * TypeScript port
 * ---------------
 * The continuation monad `AutoT` is represented by a JavaScript **generator**: `yield o` passes an
 * output to the caller and evaluates to the next input. An exception passed in by the caller with
 * `applyThrow` is raised at the `yield` with `Generator.throw`, so within the automaton it looks as
 * though `yield` threw it, exactly as in the Haskell version, and `catchAutoT` is a `try`/`catch`
 * around a delegated generator.
 *
 * The state of a `StateStream` is held in a mutable `StateCell` passed to the generator function.
 *
 * Unlike Haskell continuations, a running generator cannot be copied, so a `StreamNext` must be
 * used linearly: once an input has been applied the old `StreamNext` value is stale. (HADES only
 * ever uses the latest state.)
 *
 * For the monad-transformer variants (`StateStreamT`), actions of the inner monad `m` may
 * themselves need to suspend (e.g. a `ModelScript` opening a dialog). The generator therefore
 * yields either an `Output` (a value of type @o@ for the caller of `applyInputT`) or an instruction
 * of the inner monad, which `applyInputT` passes up to *its* caller. `applyInputT` is consequently
 * itself a generator in the inner monad's protocol. When the inner monad has no instructions (it
 * is just `IO`), use `runInner` to run it synchronously.
 */
import type { StateCell } from "@/lib/Control/Lens";

/** `AutoClass` is intrinsic to generators: `yield o` evaluates to the next input. */
export interface AutoClass<I, O> {
  readonly _auto?: [I, O];
}

/**
 * An output yielded by a `StateStreamT` computation. Anything else that such a computation yields
 * is an instruction of its inner monad.
 */
export class Output<O> {
  constructor(readonly value: O) {}
}

/** Yield an output from a `StateStreamT` computation and receive the next input. */
export function* yieldOutput<O, I>(o: O): Generator<Output<O>, I, any> {
  return (yield new Output(o)) as I;
}

/**
 * An exception raised inside an `AutoT` computation with `throwAutoT`. Wrapping the Haskell
 * exception value lets `catchAutoT` distinguish automaton exceptions from JavaScript errors.
 */
export class AutoException<E> extends Error {
  constructor(readonly exception: E) {
    super("Uncaught exception in AutoT: " + String(exception));
    this.name = "AutoException";
  }
}

/** The pure `AutoT` computation: a generator yielding @o@ and receiving @i@. */
export type AutoT<I, O, A> = Generator<O, A, I>;

/** `AutoS`: the suspended state of a running machine. */
export interface AutoS<I, O, E> {
  readonly gen: Generator<O, never, I>;
  readonly last: O;
  readonly _e?: E;
}

/**
 * Exception handling in @AutoT@ cannot follow the normal semantics for monad
 * transformers because the simulated flow of control for the @AutoT@ actions do not match
 * that of the inner monad @m@. It is therefore necessary for the caller to catch exceptions
 * in @m@ and translate those back to exceptions in @AutoT@.
 *
 * For this reason @AutoT@ is not an instance of @MonadError@. The @throwAutoT@ and @catchAutoT@
 * will behave as expected within the context of @AutoT@, but exceptions elsewhere in the
 * monad stack must be handled manually.
 */
export function throwAutoT<E>(e: E): never {
  throw new AutoException(e);
}

/** Run `act`; if it raises an automaton exception (including one passed in at a `yield` by
 * `applyThrow`), run the handler instead. */
export function* catchAutoT<Y, A, E, N>(
  act: Generator<Y, A, N>,
  handler: (e: E) => Generator<Y, A, N>,
): Generator<Y, A, N> {
  try {
    return yield* act;
  } catch (err) {
    if (err instanceof AutoException) return yield* handler(err.exception as E);
    throw err;
  }
}

/**
 * The initial state for an @AutoT@ action. The default exception handler calls "error".
 *
 * The @Void@ return type means that the machine has no stop state. The simplest way to implement
 * this is to use an infinite loop.
 */
export function startMachine<I, O, E>(act: Generator<O, never, I>): AutoS<I, O, E> {
  const r = act.next(undefined as any);
  if (r.done) throw new Error("Can't happen: AutoT terminated.");
  return { gen: act, last: r.value };
}

// ---------------------------------------------------------------------------------------------
// StateStream: a pure stateful stream processor.

/**
 * The StateStream monad describes a stateful stream processor.
 * The AutoT transformer allows the monad to "yield" a result and receive the next
 * event at any stage in the computation.
 *
 * In TypeScript a StateStream action is a generator; its state lives in the `StateCell` passed
 * to the generator function.
 */
export type StateStream<I, O, A> = Generator<O, A, I>;

/** The state that is threaded through "applyInput". */
export interface StreamNext<I, O, E, S> {
  /** The suspended processor. */
  readonly gen: Generator<O, never, I>;
  /** Holds the current state value. */
  readonly cell: StateCell<S>;
  readonly _e?: E;
}

/** Current state value of a `StreamNext` (Haskell `streamState`). */
export function streamState<I, O, E, S>(nxt: StreamNext<I, O, E, S>): S {
  return nxt.cell.state;
}

function step<I, O, E, S>(
  nxt: StreamNext<I, O, E, S>,
  r: IteratorResult<O, never>,
): [O, StreamNext<I, O, E, S>] {
  if (r.done) throw new Error("Can't happen: AutoT terminated.");
  return [r.value, nxt];
}

/**
 * Create the stream processor from the StateStream action. The @never@ return type means that the
 * action can never finish. Typically this is done using an infinite loop or a recursive tail call.
 */
export function startStream<I, O, E, S>(
  act: (st: StateCell<S>) => Generator<O, never, I>,
  state0: S,
): [O, StreamNext<I, O, E, S>] {
  const cell: StateCell<S> = { state: state0 };
  const gen = act(cell);
  const nxt: StreamNext<I, O, E, S> = { gen, cell };
  return step(nxt, gen.next(undefined as any));
}

/** Pass an input value in to the stream processor and get the resulting output. */
export function applyInput<I, O, E, S>(nxt: StreamNext<I, O, E, S>, i: I): [O, StreamNext<I, O, E, S>] {
  return step(nxt, nxt.gen.next(i));
}

/**
 * Pass an exception in to the stream processor. Within the "StateStream" action this will cause
 * "yield" to throw the exception.
 */
export function applyThrow<I, O, E, S>(nxt: StreamNext<I, O, E, S>, e: E): [O, StreamNext<I, O, E, S>] {
  try {
    return step(nxt, nxt.gen.throw(new AutoException(e)));
  } catch (err) {
    if (err instanceof AutoException) throw new Error("Uncaught exception in AutoT: " + String(err.exception));
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// StateStreamT: a stateful stream processor over an inner monad.

/**
 * The StateStreamT monad describes a stateful stream processor on an underlying monad. The
 * generator yields `Output`s for the caller of `applyInputT`, and instructions `X` of the inner
 * monad.
 */
export type StateStreamT<I, O, X, A> = Generator<Output<O> | X, A, any>;

/** The state that is threaded through "applyInputT". */
export interface StreamNextT<I, O, E, S, X = never> {
  /** The running processor, or `null` before the first input (see `startStreamT1`). */
  gen: Generator<Output<O> | X, never, any> | null;
  /** Starts the processor on its first input (see `startStreamT1`). */
  readonly start: ((st: StateCell<S>, i: I) => Generator<Output<O> | X, never, any>) | null;
  /** Holds the current state value. */
  readonly cell: StateCell<S>;
  readonly _e?: E;
}

/** Current state value of a `StreamNextT` (Haskell `streamStateT`). */
export function streamStateT<I, O, E, S, X>(nxt: StreamNextT<I, O, E, S, X>): S {
  return nxt.cell.state;
}

/** Drive the generator until it yields an `Output`, passing inner-monad instructions upwards. */
function* runToOutput<O, X>(
  gen: Generator<Output<O> | X, never, any>,
  first: () => IteratorResult<Output<O> | X, never>,
): Generator<X, O, any> {
  let r = first();
  for (;;) {
    if (r.done) throw new Error("Cannot happen: StateStreamT Void exited.");
    const y = r.value;
    if (y instanceof Output) return y.value;
    let resp: any;
    try {
      resp = yield y as X;
    } catch (err) {
      r = gen.throw(err);
      continue;
    }
    r = gen.next(resp);
  }
}

/**
 * The initial state for a "StateStreamT". This executes the "StateStreamT" action up to the
 * first "yield". It runs in the inner monad, so it is itself a generator.
 */
export function* startStreamT<I, O, E, S, X>(
  act: (st: StateCell<S>) => Generator<Output<O> | X, never, any>,
  state0: S,
): Generator<X, [O, StreamNextT<I, O, E, S, X>], any> {
  const cell: StateCell<S> = { state: state0 };
  const gen = act(cell);
  const nxt: StreamNextT<I, O, E, S, X> = { gen, start: null, cell };
  const out = yield* runToOutput(gen, () => gen.next(undefined));
  return [out, nxt];
}

/**
 * An alternative way of starting a "StateStreamT" machine. This defers any execution in
 * @m@ until the first input is ready.
 */
export function startStreamT1<I, O, E, S, X>(
  act: (st: StateCell<S>, i: I) => Generator<Output<O> | X, never, any>,
  state0: S,
): StreamNextT<I, O, E, S, X> {
  return { gen: null, start: act, cell: { state: state0 } };
}

/** Pass an input value to a monadic stream processor and get the resulting output. */
export function* applyInputT<I, O, E, S, X>(
  nxt: StreamNextT<I, O, E, S, X>,
  i: I,
): Generator<X, [O, StreamNextT<I, O, E, S, X>], any> {
  let gen = nxt.gen;
  let first: () => IteratorResult<Output<O> | X, never>;
  if (gen === null) {
    if (nxt.start === null) throw new Error("applyInputT: machine not started");
    gen = nxt.start(nxt.cell, i);
    nxt.gen = gen;
    const g = gen;
    first = () => g.next(undefined);
  } else {
    const g = gen;
    first = () => g.next(i);
  }
  const out = yield* runToOutput(gen, first);
  return [out, nxt];
}

/**
 * Pass an exception to a monadic stream processor and get the resulting output. Within the
 * "StateStreamT" monad this will cause "yield" to throw the exception.
 */
export function* applyThrowT<I, O, E, S, X>(
  nxt: StreamNextT<I, O, E, S, X>,
  e: E,
): Generator<X, [O, StreamNextT<I, O, E, S, X>], any> {
  const gen = nxt.gen;
  if (gen === null) throw new Error("Uncaught exception in StateStreamT: " + String(e));
  const out = yield* runToOutput(gen, () => gen.throw(new AutoException(e)));
  return [out, nxt];
}

/**
 * Run an inner-monad generator that is not expected to issue any instructions (i.e. the inner
 * monad is plain `IO`).
 */
export function runInner<A>(g: Generator<any, A, any>): A {
  const r = g.next(undefined);
  if (!r.done) throw new Error("runInner: unexpected inner-monad instruction " + String(r.value));
  return r.value;
}
