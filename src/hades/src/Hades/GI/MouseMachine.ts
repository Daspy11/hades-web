// Ported from hades/src/Hades/GI/MouseMachine.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Convert GTK mouse events into Mouse Commands embedded in Reactive Banana events.
 *
 * Mouse commands are not quite the same as HADES Actions, but the mapping is intended to be
 * straightforward.
 *
 * TypeScript port
 * ---------------
 * The stream processor `mouseMachine` is a generator (see "Hades.Abstract.AutoMonad"):
 * `yield o` outputs a `Maybe MouseCommand` and evaluates to the next `MouseEvent`. The Haskell
 * tail calls ("Tail recursion for mice!") cannot be written as nested `yield*` delegations,
 * because the delegation chain would grow with every event. Instead `mouseMachine` is a loop
 * around `mouseMachine1`, which handles one gesture and *returns* the next input event, and
 * `ignore` and `yieldCommand` likewise return the next event for the loop to process. The
 * recursive `dragging` is a loop.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as B from "@/lib/Reactive/Banana";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { reactimate1 } from "@/banana-ui/base/Reactive/Banana/Common";
import { registerIOSignal1 } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { applyEvents } from "../Abstract/AutoBanana";
import { startStream, type StateStream } from "../Abstract/AutoMonad";

/** Data about the most recent raw mouse event. */
type MouseEvent =
  | { readonly tag: "ButtonPress"; readonly _0: MouseState }
  | { readonly tag: "ButtonRelease"; readonly _0: MouseState }
  | { readonly tag: "ButtonDrag"; readonly _0: MouseDragState }
  | { readonly tag: "ButtonZoom"; readonly _0: number }
  | { readonly tag: "KeyPress"; readonly _0: KeyState };

function ButtonPress(_0: MouseState): MouseEvent {
  return { tag: "ButtonPress", _0 };
}
function ButtonRelease(_0: MouseState): MouseEvent {
  return { tag: "ButtonRelease", _0 };
}
function ButtonDrag(_0: MouseDragState): MouseEvent {
  return { tag: "ButtonDrag", _0 };
}
function ButtonZoom(_0: number): MouseEvent {
  return { tag: "ButtonZoom", _0 };
}
function KeyPress(_0: KeyState): MouseEvent {
  return { tag: "KeyPress", _0 };
}

/** Relevant information about a GTK mouse event in raw GTK types. */
interface MouseState {
  readonly gsButton: number;
  readonly gsClick: Gdk.EventType;
  readonly gsPos: readonly [number, number];
  readonly gsMods: readonly Gdk.ModifierType[];
}
function MouseState(
  gsButton: number,
  gsClick: Gdk.EventType,
  gsPos: readonly [number, number],
  gsMods: readonly Gdk.ModifierType[],
): MouseState {
  return { gsButton, gsClick, gsPos, gsMods };
}

/** Relevant information about a GTK mouse motion event in raw GTK types. */
interface MouseDragState {
  readonly dragPos: readonly [number, number];
}
function MouseDragState(dragPos: readonly [number, number]): MouseDragState {
  return { dragPos };
}

interface KeyState {
  /** The approximate key pressed, as a Unicode character. */
  readonly ksKey: string;
  /** Modifier keys (shift, ctrl, etc). */
  readonly ksMods: readonly Gdk.ModifierType[];
}
function KeyState(ksKey: string, ksMods: readonly Gdk.ModifierType[]): KeyState {
  return { ksKey, ksMods };
}

/** Get the state of the mouse after a button event. */
function mouseState(b: Gdk.EventButton): MouseState {
  return MouseState(
    Gdk.getEventButtonButton(b),
    Gdk.getEventButtonType(b),
    [Gdk.getEventButtonX(b), Gdk.getEventButtonY(b)],
    Gdk.getEventButtonState(b),
  );
}

/** Get the data associated with a drag event. */
function dragState(m: Gdk.EventMotion): MouseDragState {
  return MouseDragState([Gdk.getEventMotionX(m), Gdk.getEventMotionY(m)]);
}

/** Get the data associated with a key press event. */
function keyState(k: Gdk.EventKey): KeyState {
  const v = Gdk.getEventKeyKeyval(k);
  const c1 = String.fromCodePoint(Gdk.keyvalToUnicode(v));
  let c2: string;
  if (c1 === "\0") {
    switch (v) {
      case 0xff08: c2 = "\b"; break; // Backspace
      case 0xff09: c2 = "\t"; break; // Tab
      case 0xff0d: c2 = "\r"; break; // Return
      case 0xff1b: c2 = "\x1b"; break; // Escape
      case 0xffff: c2 = "\x7f"; break; // Delete
      default: c2 = "\0";
    }
  } else {
    c2 = c1;
  }
  const m = Gdk.getEventKeyState(k);
  return KeyState(c2, m);
}

/* Design Note:

GDK on Windows has a more restricted table of Unicode values for keys than on Linux. Particular
keys, including "Delete" and "Return" are not included because doing so was found to break text
entry on some foreign versions of Windows. See the following patch for details.

https://github.com/GNOME/gtk/commit/fd6ce9975e4cc9c090d07e7a6b0013d02b49ce26

We don't want to expose GDK key codes outside this module, so this is a workaround to detect
this case and manually substitute the relevant Unicode characters.
*/

export type MouseCommandType =
  | { readonly tag: "SingleClick" }
  | { readonly tag: "DoubleClick" }
  | { readonly tag: "RightClick" }
  | { readonly tag: "MouseDrag"; readonly _0: readonly [number, number] }
  | { readonly tag: "MouseEndDrag"; readonly _0: readonly [number, number] }
  | { readonly tag: "MouseKey"; readonly _0: string };

export const SingleClick: MouseCommandType = { tag: "SingleClick" };
export const DoubleClick: MouseCommandType = { tag: "DoubleClick" };
export const RightClick: MouseCommandType = { tag: "RightClick" };
export function MouseDrag(_0: readonly [number, number]): MouseCommandType {
  return { tag: "MouseDrag", _0 };
}
export function MouseEndDrag(_0: readonly [number, number]): MouseCommandType {
  return { tag: "MouseEndDrag", _0 };
}
export function MouseKey(_0: string): MouseCommandType {
  return { tag: "MouseKey", _0 };
}

/** Mouse events that are relevant to diagram editing. */
export type MouseCommand =
  /** A mouse action that will affect the diagram. */
  | {
      readonly tag: "MouseCommand";
      readonly mouseType: MouseCommandType;
      readonly mouseLocation: readonly [number, number];
      readonly mouseModifiers: readonly Gdk.ModifierType[];
    }
  /** A zoom action. */
  | { readonly tag: "MouseZoom"; readonly _0: number };

/** A mouse action that will affect the diagram. */
export function MouseCommand(
  mouseType: MouseCommandType,
  mouseLocation: readonly [number, number],
  mouseModifiers: readonly Gdk.ModifierType[],
): MouseCommand {
  return { tag: "MouseCommand", mouseType, mouseLocation, mouseModifiers };
}
/** A zoom action. */
export function MouseZoom(_0: number): MouseCommand {
  return { tag: "MouseZoom", _0 };
}

/** One step of the mouse machine: yields `Maybe MouseCommand`, receives `MouseEvent`s. */
type MouseStep<A> = Generator<Maybe<MouseCommand>, A, MouseEvent>;

/** Stream processor that converts mouse events into commands. */
function* mouseMachine(ev0: MouseEvent): StateStream<MouseEvent, Maybe<MouseCommand>, never> {
  let ev = ev0;
  for (;;) ev = yield* mouseMachine1(ev); // Tail recursion for mice!
}

/**
 * The body of `mouseMachine` for one input event. Where the Haskell continues with
 * @>>= mouseMachine@ this returns the next input event to the loop in `mouseMachine`.
 */
function* mouseMachine1(ev: MouseEvent): MouseStep<MouseEvent> {
  const leftButton = 1;
  const rightButton = 3;
  switch (ev.tag) {
    case "ButtonRelease": return yield* ignore();
    case "ButtonDrag": return yield* ignore();
    case "ButtonZoom": return yield Just(MouseZoom(ev._0));
    case "KeyPress": return yield Just(MouseCommand(MouseKey(ev._0.ksKey), [0, 0], ev._0.ksMods));
    case "ButtonPress": { // Must call mouseMachine or ignore.
      const mouse1 = ev._0;
      function* dragging(mouse2a: MouseDragState): MouseStep<MouseEvent> {
        let mouse2 = mouse2a;
        for (;;) {
          const [x1, y1] = mouse1.gsPos;
          const [x2, y2] = mouse2.dragPos;
          const delta: readonly [number, number] = [x2 - x1, y2 - y1];
          const next = yield* yieldCommand(MouseDrag(delta), mouse1);
          switch (next.tag) {
            case "ButtonZoom": continue; // dragging mouse2
            case "ButtonPress": continue; // Ignore spurious button press during dragging.
            case "KeyPress": continue; // Ignore keyboard commands during dragging.
            case "ButtonRelease": {
              const mouse3 = next._0;
              if (mouse3.gsButton === mouse1.gsButton) {
                return yield* yieldCommand(MouseEndDrag(delta), mouse1);
              }
              return yield* ignore();
            }
            case "ButtonDrag":
              mouse2 = next._0; // dragging mouse3
              continue;
          }
        }
      }
      const next: MouseEvent = yield Nothing;
      switch (next.tag) {
        case "ButtonZoom": return yield* ignore(); // Trying to zoom half way through a click.
        case "KeyPress": return yield* ignore(); // Trying to do a key command half way through a click.
        case "ButtonPress": { // Could be a double click.
          const mouse2 = next._0;
          if (mouse1.gsButton === leftButton && mouse2.gsButton === leftButton
            && mouse2.gsClick === Gdk.EventType2buttonPress) {
            return yield* yieldCommand(DoubleClick, mouse2); // Tail recursion for mice!
          }
          return yield* ignore();
        }
        case "ButtonRelease": { // Could be a single click or a right click.
          const mouse2 = next._0;
          if (mouse1.gsClick === Gdk.EventTypeButtonPress && mouse1.gsButton === mouse2.gsButton) {
            if (mouse2.gsButton === leftButton) return yield* yieldCommand(SingleClick, mouse2);
            if (mouse2.gsButton === rightButton) return yield* yieldCommand(RightClick, mouse2);
            return yield* ignore();
          }
          return yield* ignore();
        }
        case "ButtonDrag": {
          const mouse2 = next._0;
          // if isRealDrag mouse1 mouse2 && gsButton mouse1 == Gtk.LeftButton
          if (mouse1.gsButton === leftButton) return yield* dragging(mouse2);
          return yield* ignore();
        }
      }
    }
  }
}

/**
 * Ignore whatever input event got to this point and restart mouseMachine from the beginning.
 *
 * Tail recursion for mice! (The next input event is returned to the `mouseMachine` loop.)
 */
function* ignore(): MouseStep<MouseEvent> {
  return yield Nothing;
}

/** Yield a MouseCommand and return the next input event. */
function* yieldCommand(mt: MouseCommandType, ms: MouseState): MouseStep<MouseEvent> {
  return yield Just(MouseCommand(mt, ms.gsPos, ms.gsMods));
}

/**
 * Install event handlers on an object (e.g. a Hades canvas).
 * Subsequent GTK mouse events will be translated into the corresponding Banana mouse events.
 *
 * This also causes the widget to grab focus whenever a mouse button is clicked.
 */
export function mouseCommandEvent(widget: Gtk.Widget): B.Event<MouseCommand> {
  Gtk.widgetAddEvents(widget, [
    Gdk.EventMaskButton1MotionMask,
    Gdk.EventMaskButtonPressMask,
    Gdk.EventMaskButtonReleaseMask,
    Gdk.EventMaskKeyPressMask,
    Gdk.EventMaskScrollMask,
  ]);
  const buttonDownEvent = registerIOSignal1(widget, Gtk.onWidgetButtonPressEvent,
    (b: Gdk.EventButton) => [true, ButtonPress(mouseState(b))] as const);
  const buttonUpEvent = registerIOSignal1(widget, Gtk.onWidgetButtonReleaseEvent,
    (b: Gdk.EventButton) => [true, ButtonRelease(mouseState(b))] as const);
  // Web: the browser reports all pointer motion, but the GTK widget only asked for motion with
  // button 1 down (EventMaskButton1MotionMask), so other motion is filtered out here.
  const dragEvent = B.filterJust(registerIOSignal1(widget, Gtk.onWidgetMotionNotifyEvent,
    (m: Gdk.EventMotion): readonly [boolean, Maybe<MouseEvent>] =>
      Gdk.getEventMotionState(m).includes(Gdk.ModifierTypeButton1Mask)
        ? [true, Just(ButtonDrag(dragState(m)))]
        : [false, Nothing]));
  const keyEvent = registerIOSignal1(widget, Gtk.onWidgetKeyPressEvent,
    (k: Gdk.EventKey) => [true, KeyPress(keyState(k))] as const);
  const zoomEvent = registerIOSignal1(widget, Gtk.onWidgetScrollEvent,
    (scroll: Gdk.EventScroll): readonly [boolean, Maybe<MouseEvent>] => {
      const mods = Gdk.getEventScrollState(scroll);
      if (mods.includes(Gdk.ModifierTypeControlMask)) {
        let d: number;
        switch (Gdk.getEventScrollDirection(scroll)) {
          case "ScrollDirectionUp": d = 0.99; break;
          case "ScrollDirectionDown": d = 1.01; break;
          case "ScrollDirectionLeft": d = 0.99; break;
          case "ScrollDirectionRight": d = 1.01; break;
          case "ScrollDirectionSmooth": {
            const dy = Gdk.getEventScrollDeltaY(scroll);
            d = 1 + dy / 100; // Hope this is the right direction.
            break;
          }
          default: d = 1;
        }
        return [true, Just(ButtonZoom(d))];
      }
      return [false, Nothing];
    });
  const mouseEvent = [buttonDownEvent, buttonUpEvent, dragEvent, keyEvent, B.filterJust(zoomEvent)]
    .reduceRight((acc, e) => B.unionWith((a: MouseEvent, _b: MouseEvent) => a, e, acc));
  const stop = reactimate1(B.mapE(() => () => Gtk.widgetGrabFocus(widget), mouseEvent));
  Gtk.onWidgetDestroy(widget, stop);
  // Manual focus grab because we are intercepting events before the focus mechanism gets them.
  const [, machine] = startStream<MouseEvent, Maybe<MouseCommand>, never, null>(function* () {
    const ev: MouseEvent = yield Nothing;
    return yield* mouseMachine(ev);
  }, null);
  return B.filterJust(applyEvents(machine, mouseEvent));
}
