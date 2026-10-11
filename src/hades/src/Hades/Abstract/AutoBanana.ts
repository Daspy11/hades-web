// Ported from hades/src/Hades/Abstract/AutoBanana.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module provides a single function that links the Reactive Banana world to the
 * automaton monads defined by "Hades.Abstract.AutoMonad".
 */
import * as B from "@/lib/Reactive/Banana";
import { applyInput, type StreamNext } from "./AutoMonad";

/**
 * A Reactive Banana wrapper for AutoMonad.
 *
 * Haskell:
 *
 * > applyEvents initial input = mdo
 * >   state <- stepper initial $ snd <$> result
 * >   let result = applyInput <$> state <@> input
 * >   return $ fst <$> result
 */
export function applyEvents<I, O, E, S>(initial: StreamNext<I, O, E, S>, input: B.Event<I>): B.Event<O> {
  const stateRef: B.Behavior<StreamNext<I, O, E, S>> = B.lazyB(() => state);
  const result: B.Event<[O, StreamNext<I, O, E, S>]> = B.apply(
    B.mapB((st: StreamNext<I, O, E, S>) => (i: I) => applyInput(st, i), stateRef),
    input,
  );
  const state: B.Behavior<StreamNext<I, O, E, S>> = B.stepper(initial, B.mapE((r) => r[1], result));
  return B.mapE((r) => r[0], result);
}
