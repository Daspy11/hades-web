// Ported from banana-ui/gtk/src/Reactive/Banana/GI/Connect.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * These functions provide low level connections between GTK objects and Reactive Banana.
 *
 * The \"register\" family of functions is used to convert GTK input hooks into Reactive Banana
 * events. On the output side the \"link\" family of functions is used to update a GTK attribute
 * when an event fires or a behavior changes.
 *
 * TypeScript port
 * ---------------
 * * A signal function is a toolkit connection function such as `Gtk.onButtonClicked`, of shape
 *   `(obj, handler) => SignalHandlerId`. `MomentIO` is synchronous, so it is called directly.
 * * The action returns a 2-tuple `[r, v]`: `r` is returned to the toolkit as the handler result
 *   (e.g. the "stop propagation" boolean of an event signal, or `null` for `()`), and `v` fires
 *   the event. The `IO (a, b)` of the Haskell is a synchronous function.
 * * The commented-out `registerActionEntry` of the Haskell export list does not exist in the
 *   original either.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { reactimate1, reactimate1_ } from "@/banana-ui/base/Reactive/Banana/Common";

// ---------------------------------------------------------------------------------------------
// Generating Events.

/**
 * The handler result an action returns alongside the event value. For toolkit handlers returning
 * `void` the Haskell `()` is written `null` (or `undefined`).
 */
export type SignalResult<R> = [R] extends [void] ? R | null : R;

/**
 * Register a GTK signal as an input.
 *
 * If you only want to know that the signal occured then use @return ((), ())@ as the action
 * (TypeScript: `() => [null, null]`).
 * However a more typical use-case is that you receive a signal that something has changed and
 * then need to use the action to query the new value to put into the @Event@.
 *
 * @param sig Signal function, such as "onButtonClicked".
 * @param act IO action executed to obtain the signal result and the Event value.
 */
export function registerIOSignal<O, R, V>(
  obj: O,
  sig: (obj: O, handler: () => R) => Gtk.SignalHandlerId,
  act: () => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, () => {
    const [r, v] = act();
    runHandlers(v);
    return r as R;
  });
  return event;
}

/** Register a GTK signal with one argument. */
export function registerIOSignal1<O, A1, R, V>(
  obj: O,
  sig: (obj: O, handler: (a1: A1) => R) => Gtk.SignalHandlerId,
  act: (a1: A1) => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, (arg1: A1) => {
    const [r, v] = act(arg1);
    runHandlers(v);
    return r as R;
  });
  return event;
}

/** Register a GTK signal with two arguments. */
export function registerIOSignal2<O, A1, A2, R, V>(
  obj: O,
  sig: (obj: O, handler: (a1: A1, a2: A2) => R) => Gtk.SignalHandlerId,
  act: (a1: A1, a2: A2) => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, (arg1: A1, arg2: A2) => {
    const [r, v] = act(arg1, arg2);
    runHandlers(v);
    return r as R;
  });
  return event;
}

/** Register a GTK signal with three arguments. */
export function registerIOSignal3<O, A1, A2, A3, R, V>(
  obj: O,
  sig: (obj: O, handler: (a1: A1, a2: A2, a3: A3) => R) => Gtk.SignalHandlerId,
  act: (a1: A1, a2: A2, a3: A3) => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, (arg1: A1, arg2: A2, arg3: A3) => {
    const [r, v] = act(arg1, arg2, arg3);
    runHandlers(v);
    return r as R;
  });
  return event;
}

/** Register a GTK signal with four arguments. */
export function registerIOSignal4<O, A1, A2, A3, A4, R, V>(
  obj: O,
  sig: (obj: O, handler: (a1: A1, a2: A2, a3: A3, a4: A4) => R) => Gtk.SignalHandlerId,
  act: (a1: A1, a2: A2, a3: A3, a4: A4) => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, (arg1: A1, arg2: A2, arg3: A3, arg4: A4) => {
    const [r, v] = act(arg1, arg2, arg3, arg4);
    runHandlers(v);
    return r as R;
  });
  return event;
}

/** Register a GTK signal with five arguments. */
export function registerIOSignal5<O, A1, A2, A3, A4, A5, R, V>(
  obj: O,
  sig: (obj: O, handler: (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5) => R) => Gtk.SignalHandlerId,
  act: (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5) => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5) => {
    const [r, v] = act(arg1, arg2, arg3, arg4, arg5);
    runHandlers(v);
    return r as R;
  });
  return event;
}

/** Register a GTK signal with four arguments. (Haskell comment; this one takes six.) */
export function registerIOSignal6<O, A1, A2, A3, A4, A5, A6, R, V>(
  obj: O,
  sig: (obj: O, handler: (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6) => R) => Gtk.SignalHandlerId,
  act: (a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6) => readonly [SignalResult<R>, V],
): B.Event<V> {
  const [event, runHandlers] = B.newEvent<V>();
  sig(obj, (arg1: A1, arg2: A2, arg3: A3, arg4: A4, arg5: A5, arg6: A6) => {
    const [r, v] = act(arg1, arg2, arg3, arg4, arg5, arg6);
    runHandlers(v);
    return r as R;
  });
  return event;
}

// ---------------------------------------------------------------------------------------------
// Setting Widget Attributes

/** When an event occurs push the value to the specified attribute. */
export function eventLink<O extends Gtk.Widget, A>(obj: O, setter: (obj: O, a: A) => void, evs: B.Event<A>): void {
  const stop = reactimate1(B.mapE((a: A) => () => setter(obj, a), evs));
  Gtk.onWidgetDestroy(obj, stop);
}

/** Keep the attribute updated with the specified Behaviour. */
export function behaviorLink<O extends Gtk.Widget, A>(obj: O, setter: (obj: O, a: A) => void, b: B.Behavior<A>): void {
  const fe = B.changes(b);
  const stop = reactimate1_(B.mapE((f: B.Future<A>) => B.mapFuture((a: A) => () => setter(obj, a), f), fe));
  Gtk.onWidgetDestroy(obj, stop);
}
