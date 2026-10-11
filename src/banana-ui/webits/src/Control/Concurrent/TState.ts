// Ported from banana-ui/webits/src/Control/Concurrent/TState.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * A @TState@ is an approximation to the concepts of \"events\" and \"behaviours\" from functional
 * reactive programming, cast into a form suitable for @STM@ transactions. The event stream is
 * represented by a transaction which will 'retry' until an event occurs, and the behaviour is
 * represented by a transaction which always returns a result.
 *
 * TypeScript port
 * ---------------
 * STM comes from `@/lib/Control/Concurrent/STM` and threads from `@/lib/Control/Concurrent`:
 *
 * * An `STM b` field is an `STM<B>` = `() => B`, a function to call *inside* a transaction:
 *   `await atomically(() => ts.tStateEvent())` blocks until an event arrives;
 *   `atomicallySync(() => ts.tStateBehaviour())` reads the behaviour now.
 * * The writer returned by `newTState` is an STM action `(a, b) => void` (the curried Haskell
 *   `a -> b -> STM ()`), called inside a transaction or on its own (it then commits at once).
 * * `newTState` is itself an STM action (call it in a transaction, or on its own);
 *   `newTStateIO`, `tStateDupIO` and the `MonadIO m => ... -> m x` functions are synchronous.
 * * `forkIO $ forever $ atomically $ ...` threads are `forkIO(() => forever(() =>
 *   atomically(() => ...)))`: async loops that sleep until the transaction can proceed.
 * * The `Functor` and `Applicative` instances are `fmap_TState`, `pure_TState`, `ap_TState` (and
 *   `liftA2_TState` for `liftA2`/`f <$> a <*> b`).
 * * `HasCallStack` constraints have no TypeScript counterpart and are dropped.
 */
import {
  atomicallySync,
  dupTChan,
  isEmptyTChan,
  newBroadcastTChan,
  newTVar,
  orElse,
  readTChan,
  readTVar,
  retry,
  writeTChan,
  writeTVar,
  atomically,
  inTx,
  type STM,
  type TChan,
} from "@/lib/Control/Concurrent/STM";
import { forever, forkIO, labelThread } from "@/lib/Control/Concurrent";
import { fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";

/**
 * This arranges STM transactions into something akin to functional reactive programming
 * with arrows. The Behaviour component is always available (the underlying implementation is a
 * set of TVars), while the Change component is only available instantaneously when the value
 * changes (the underlying implementation is one or more Queues or similar).
 *
 * If there are events queued up then the event value and behaviour value may not be equal, but
 * if the event queue is empty then the behaviour will be the most recent value from it.
 *
 * If multiple events are queued up then 'tStateEvent' will drop all but the last one.
 *
 * Reading events is a destructive operation; once an event is read it can never be seen by
 * any other transaction. Hence any @TState@ should be duplicated before reading events
 * (behaviour is not an issue).
 *
 * The results from the applicative and functor instances will read from the argument event streams.
 * Duplicating the result will do a deep duplication on all the event sources.
 *
 * The event channel carries an extra value which is propogated via events but not via the behaviour.
 */
export interface TState<A, B> {
  /** Never retries. */
  readonly tStateBehaviour: STM<B>;
  /** Retries until an event occurs, and consumes that event. */
  readonly tStateEvent: STM<[A, B]>;
  /** Duplicate this TState. From now on events will appear on both this and the original. */
  readonly tStateDup: STM<TState<A, B>>;
}
export function TState<A, B>(
  tStateBehaviour: STM<B>,
  tStateEvent: STM<[A, B]>,
  tStateDup: STM<TState<A, B>>,
): TState<A, B> {
  return { tStateBehaviour, tStateEvent, tStateDup };
}

/** `deriving Functor` (maps the behaviour type). */
export function fmap_TState<A, B, C>(f: (b: B) => C, ts: TState<A, B>): TState<A, C> {
  return TState<A, C>(
    () => f(ts.tStateBehaviour()),
    () => {
      const [a, b] = ts.tStateEvent();
      return [a, f(b)];
    },
    () => fmap_TState(f, ts.tStateDup()),
  );
}

/** `pure v = let r = TState (return v) retry (return r) in r` (`instance Applicative (TState a)`). */
export function pure_TState<A, B>(v: B): TState<A, B> {
  const r: TState<A, B> = TState<A, B>(
    () => v,
    () => retry(),
    () => r,
  );
  return r;
}

/** `f <*> v` (`instance Applicative (TState a)`). */
export function ap_TState<A, B, C>(f: TState<A, (b: B) => C>, v: TState<A, B>): TState<A, C> {
  const e1 = (): [A, C] => {
    const [a, ef1] = f.tStateEvent();
    const b1 = v.tStateBehaviour();
    return [a, ef1(b1)];
  };
  const e2 = (): [A, C] => {
    const [a, eb1] = v.tStateEvent();
    const f1 = f.tStateBehaviour();
    return [a, f1(eb1)];
  };
  const dup = (): TState<A, C> => {
    const f1 = f.tStateDup();
    const v1 = v.tStateDup();
    return ap_TState(f1, v1);
  };
  return TState<A, C>(
    () => f.tStateBehaviour()(v.tStateBehaviour()),
    () => orElse(e1, e2),
    dup,
  );
}

/** `liftA2 f x y` (`f <$> x <*> y`) for TStates. */
export function liftA2_TState<A, B, C, D>(f: (b: B, c: C) => D, x: TState<A, B>, y: TState<A, C>): TState<A, D> {
  return ap_TState(
    fmap_TState((b: B) => (c: C) => f(b, c), x),
    y,
  );
}

/**
 * Create a new @TState@, along with a transaction that writes a new value to it.
 *
 * (An STM action: call it inside a transaction, or on its own.)
 */
export function newTState<A, B>(x: B): [TState<A, B>, (av: A, bv: B) => void] {
  const getLatest = (c: TChan<[A, B]>): [A, B] => {
    for (;;) {
      const r = readTChan(c);
      const e = isEmptyTChan(c);
      if (e) return r;
    }
  };
  const b = newTVar(x);
  const e = newBroadcastTChan<[A, B]>();
  const e1 = dupTChan(e);
  const dup = (): TState<A, B> => {
    // {-# SCC tState_dup #-}
    const newE = dupTChan(e);
    return { ...r, tStateEvent: () => getLatest(newE) };
  };
  const r: TState<A, B> = {
    tStateBehaviour: () => readTVar(b),
    tStateEvent: () => getLatest(e1),
    tStateDup: dup,
  };
  const writer = (av: A, bv: B): void => {
    // {-# SCC tState_writer #-}
    inTx(() => {
      writeTVar(b, bv);
      writeTChan(e, [av, bv]);
    });
  };
  return [r, writer];
}

/** `newTStateIO = liftIO . atomically . newTState` */
export function newTStateIO<A, B>(x: B): [TState<A, B>, (av: A, bv: B) => void] {
  return atomicallySync(() => newTState<A, B>(x));
}

/** Convenience function to duplicate the TState in the IO monad. */
export function tStateDupIO<A, B>(ts: TState<A, B>): TState<A, B> {
  return atomicallySync(() => ts.tStateDup());
}

/** Equivalent of fmap for the first type argument. */
export function mapTState1<A1, A2, B>(f: (a: A1) => A2, ts: TState<A1, B>): TState<A2, B> {
  return TState<A2, B>(
    ts.tStateBehaviour,
    () => {
      const [a, b] = ts.tStateEvent();
      return [f(a), b];
    },
    () => mapTState1(f, ts.tStateDup()),
  );
}

/** Creates a dupe of the @TState@ which filters out @Nothing@. */
export function filterTStateMaybe<A, B>(
  /** Initial value if the argument's value is @Nothing@e. */
  d: B,
  /** Value stream to duplicate. */
  s1: TState<A, Maybe<B>>,
): TState<A, B> {
  const [[o, writer], s2] = atomicallySync((): [[TState<A, B>, (a: A, b: B) => void], TState<A, Maybe<B>>] => {
    const i = s1.tStateBehaviour();
    const s2 = s1.tStateDup();
    const output = newTState<A, B>(fromMaybe(d, i));
    return [output, s2];
  });
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() => {
        const [a, mb] = s2.tStateEvent();
        if (mb.tag === "Just") writer(a, mb.value);
        else retry();
      }),
    ),
  );
  labelThread(threadId, "filterTStateMaybe");
  return o;
}

/** Creates a dupe of the @TState@ which filters out events that are equal to the old value. */
export function filterTStateChanges<A, B>(s1: TState<A, B>): TState<A, B> {
  const [[o, writer], s2] = atomicallySync((): [[TState<A, B>, (a: A, b: B) => void], TState<A, B>] => {
    const i = s1.tStateBehaviour();
    const s2 = s1.tStateDup();
    const output = newTState<A, B>(i);
    return [output, s2];
  });
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() => {
        const oldVal = o.tStateBehaviour();
        const newVal = s2.tStateEvent();
        if (!equals(oldVal, newVal[1])) writer(newVal[0], newVal[1]);
      }),
    ),
  );
  labelThread(threadId, "filterTStateChanges");
  return o;
}

/** Provide the union of events in a list of TStates. */
export function unionTStates<A, B>(
  /** Initial value of the union. */
  initial: B,
  inputs: readonly TState<A, B>[],
): TState<A, B> {
  const [output, sendOut] = newTStateIO<A, B>(initial);
  // foldr (orElse . tStateEvent) retry inputs
  const anyEvent = inputs.reduceRight<STM<[A, B]>>(
    (acc, ts) => () => orElse(ts.tStateEvent, acc),
    () => retry(),
  );
  const threadId = forkIO(() =>
    forever(() =>
      atomically(() => {
        const [a, b] = anyEvent();
        sendOut(a, b);
      }),
    ),
  );
  labelThread(threadId, "unionTStates");
  return output;
}
