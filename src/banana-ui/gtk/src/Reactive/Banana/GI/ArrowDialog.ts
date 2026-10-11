// Ported from banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Interpret an abstract GUI interface in GTK.
 *
 * TypeScript port
 * ---------------
 * * The `MomentIO` functions (`mkGtkPopupSelect`, `mkGtkPopup`, `createDialog`,
 *   `mkDialogWidget`, `renderGadget`, `boxWidgets`) are synchronous network-building functions.
 *   They must be called while a network is being built: inside `B.compile`, an `execute`d
 *   action, `B.runMomentIO` or `B.liftMomentIO`. `createDialog` and its relatives show the
 *   dialog and return at once; the returned event fires when a dialog button is pressed.
 * * `runDialog` blocks on `Gtk.dialogRun` in Haskell; here it is `async` and returns a
 *   `Promise<Maybe<A>>`. The network is compiled and actuated before the `await` and paused
 *   after it, exactly as in the Haskell.
 * * The rank-N argument `(forall widget. IsWidget widget => widget -> IO ())`, run on all newly
 *   created widgets, is a `(w: Gtk.Widget) => void`.
 * * `GadgetOut` is a record (`GadgetOut(view, events, initial, user, value)`). Its `Functor`,
 *   `Applicative`, `Monoid` and `Semigroup` instances are `fmap_GadgetOut`, `pure_GadgetOut`,
 *   `ap_GadgetOut`, `mempty_GadgetOut` and `append_GadgetOut`. The `Semigroup` of the side
 *   channel `Event [w]` is the union with list concatenation (`appendEvents`).
 * * `mdo` blocks use `B.lazyE` / `B.lazyB` for forward references (PORTING.md §8).
 * * GTK response types are the numeric `Gtk.ResponseType*` constants, so the Haskell
 *   `r x = fromIntegral $ fromEnum x` conversions disappear.
 * * Haskell builds the initial values of gadgets lazily, and `Loop` depends on it: the initial
 *   state of a loop is part of the output of the gadget that it feeds. The interpreter therefore
 *   builds initial `GadgetData` values with lazy (memoised) helpers (`gdFmap`, `gdAp`, ...)
 *   whenever an input is lazy. Plain values stay plain, so this only matters inside `Loop`.
 *   Forcing a loop state before it has been defined throws, as `<<loop>>` would in Haskell.
 * * Blocking IO that the Haskell runs inside event handlers (the colour chooser `dialogRun`,
 *   the native file chooser, `ButtonIO` actions) is asynchronous here: the handler starts it
 *   and the resulting event fires when it completes. Each place is marked `// Web:`.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Pango from "@/lib/GI/Pango";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import * as L from "@/lib/Data/List";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import {
  Just, Nothing, type Maybe, catMaybes, fromMaybe, fromNullable, isJust, isNothing, mapMaybe, mapMaybeValue, maybe,
  toNull,
} from "@/lib/Data/Maybe";
import { Left, Right, either, fromRight, isRight } from "@/lib/Data/Either";
import { equals, notEquals } from "@/lib/Data/Ord";
import { fromGregorian, type Day } from "@/lib/Data/Time";
import { flatten, Node, type Forest, type Tree } from "@/lib/Data/Tree";
import {
  _Just, has, over, preview, review, set, view, withPrism, type Lens, type Prism, type Traversal,
} from "@/lib/Control/Lens";
import {
  absurd, ceiling, error, floor, fst, newIORef, readIORef, round, showBool, snd, writeIORef, type IORef,
} from "@/lib/Prelude";
import {
  Changes, GadgetData, ap_GadgetData, append_GadgetData, blankIconName, colourPrism, datePrism, getColour,
  liftA2_Changes, makeChanges, noIconName, prismToMaybe, pure_Changes, reactimate1, reactimate1_, type Colour,
} from "@/banana-ui/base/Reactive/Banana/Common";
import {
  Combo, ComboItem, DisplayText, FixedMemo, FixedText, MemoBox, TextBox, arr, disableApply1, fmap_ComboItem, gDot,
  getLens, promoteDialogSelector,
  type ClickableItem, type Dialog_, type DialogSelector, type DialogSelector_, type FilePathFilter,
  type FilePathPurpose, type Gadget, type MemoBoxSize, type Orientation, type PrismaticGadget, type TreeOper,
} from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { focusingOver, send, sendMap } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { fmap_Menu, type Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import type * as Tbl from "@/banana-ui/base/Reactive/Banana/Table";
import {
  createColorDialog, createDatePopover, iconDialog, iconThemeContents, rgbaToColour, safeLoadIcon,
  widgetLinkColour, widgetWindow, withWaitCursor,
} from "./Common";
import { behaviorLink, eventLink, registerIOSignal, registerIOSignal1, registerIOSignal2 } from "./Connect";
import { cannotHappen, errorBox } from "./ErrorBox";
import { mkGtkMenu, popupMenuOn } from "./Menu";
import { mkTableView } from "./Table";

/** The function run on all newly created widgets. */
type WInit = (w: Gtk.Widget) => void;
/** A gadget of unknown types: the interpreter works on the untyped GADT. */
type AnyGadget = Gadget<any, any, any, any>;
/** Untyped gadget output used inside the interpreter. */
type Out = GadgetOut<any, any>;
/** Untyped gadget data used inside the interpreter. */
type GD = GadgetData<any>;

/** Haskell `unionWith const`: left-biased union. */
function constFirst<A>(x: A, _y: A): A {
  return x;
}

/** The `Semigroup` of `Event [w]`: simultaneous lists are concatenated. Haskell `ev1 <> ev2`. */
function appendEvents<W>(ev1: B.Event<readonly W[]>, ev2: B.Event<readonly W[]>): B.Event<readonly W[]> {
  return B.unionWith((a: readonly W[], b: readonly W[]) => [...a, ...b], ev1, ev2);
}

/** Haskell `mconcat` for `Event [w]`. */
function mconcatEvents<W>(evs: readonly B.Event<readonly W[]>[]): B.Event<readonly W[]> {
  return L.foldr((ev: B.Event<readonly W[]>, acc: B.Event<readonly W[]>) => appendEvents(ev, acc), B.never<readonly W[]>(), evs);
}

// ---------------------------------------------------------------------------------------------
// Lazy gadget data (see the module header)

/** Evaluation state of a lazy field. */
type LazyState = 0 | 1 | 2;

/**
 * A `GadgetData` whose fields are computed on demand and memoised, emulating Haskell's lazy
 * evaluation of initial values (needed by `Loop`). Re-entrant evaluation is a cycle and throws.
 */
class LazyGadgetData<A> implements GadgetData<A> {
  private okState: LazyState = 0;
  private okValue = false;
  private valueState: LazyState = 0;
  private valueValue: A | undefined = undefined;
  constructor(private readonly okF: () => boolean, private readonly valueF: () => A) {}
  get _gdOk(): boolean {
    if (this.okState === 2) return this.okValue;
    if (this.okState === 1) return error("renderGadget: <<loop>> (a gadget validity flag depends on itself).");
    this.okState = 1;
    try {
      this.okValue = this.okF();
      this.okState = 2;
    } finally {
      if (this.okState === 1) this.okState = 0;
    }
    return this.okValue;
  }
  get _gdValue(): A {
    if (this.valueState === 2) return this.valueValue as A;
    if (this.valueState === 1) return error("renderGadget: <<loop>> (a gadget initial value depends on itself).");
    this.valueState = 1;
    try {
      this.valueValue = this.valueF();
      this.valueState = 2;
    } finally {
      if (this.valueState === 1) this.valueState = 0;
    }
    return this.valueValue as A;
  }
}

/** Is this gadget data lazy? */
function isLazy(x: GadgetData<unknown>): boolean {
  return x instanceof LazyGadgetData;
}

/** Lazy gadget data from thunks for its fields. */
function gdLazy<A>(okF: () => boolean, valueF: () => A): GadgetData<A> {
  return new LazyGadgetData(okF, valueF);
}

/** A pair whose second component is computed on demand (Haskell tuples are lazy). */
function lazyPair<A, Bv>(a: A, bF: () => Bv): [A, Bv] {
  const p: [A, Bv] = [a, undefined as Bv];
  let done = false;
  let v: Bv;
  Object.defineProperty(p, 1, {
    enumerable: true,
    get: () => {
      if (!done) {
        v = bF();
        done = true;
      }
      return v;
    },
  });
  return p;
}

/** `f <$> x` for gadget data, lazy when `x` is lazy. */
function gdFmap<A, R>(f: (a: A) => R, x: GadgetData<A>): GadgetData<R> {
  return isLazy(x) ? gdLazy(() => x._gdOk, () => f(x._gdValue)) : GadgetData(x._gdOk, f(x._gdValue));
}

/** `fmap f` for gadget data, as a function (for mapping over events and behaviors). */
function gdFmapF<A, R>(f: (a: A) => R): (x: GadgetData<A>) => GadgetData<R> {
  return (x) => gdFmap(f, x);
}

/** `gf <*> gv` for gadget data, lazy when either argument is lazy. */
function gdAp<A, R>(gf: GadgetData<(a: A) => R>, gv: GadgetData<A>): GadgetData<R> {
  return isLazy(gf) || isLazy(gv)
    ? gdLazy(() => gf._gdOk && gv._gdOk, () => gf._gdValue(gv._gdValue))
    : ap_GadgetData(gf, gv);
}

/** Haskell `gdOk %~ f $ x`, lazy when `x` is lazy. */
function gdOverOk<A>(f: (ok: boolean) => boolean, x: GadgetData<A>): GadgetData<A> {
  return isLazy(x) ? gdLazy(() => f(x._gdOk), () => x._gdValue) : GadgetData(f(x._gdOk), x._gdValue);
}

/** A memoised thunk (a lazy Haskell `let` binding). */
function lazyValue<A>(f: () => A): () => A {
  let done = false;
  let v: A;
  return () => {
    if (!done) {
      v = f();
      done = true;
    }
    return v;
  };
}

// ---------------------------------------------------------------------------------------------
// Popups and dialogs

/**
 * Pop up one of a range of dialog boxes depending on the event value. Typically @i@ is
 * a sum type and the selector will return a different dialog depending on which variant
 * it receives.
 *
 * The @Event@ is the trigger for the popup to appear. A new popup will be spawned for
 * every trigger event with the initial values taken from the @i@ parameter in the event. The
 * @k@ parameter allows the application to distinguish between the output events for different
 * invocations.
 *
 * The returned @Event@ is triggered by the  buttons in the dialog. If @@Cancel@ or @Close@ is
 * pressed then the event contains @Nothing@.
 *
 * @param parent The dialog will be kept above the window with this widget.
 */
export function mkGtkPopupSelect<E, W, A, K>(
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  env: Changes<E>,
  selector: DialogSelector_<E, W, A>,
  trigger: B.Event<readonly [K, A]>,
): B.Event<[K, Maybe<A>]> {
  const popupAction = (e: E, [k, v]: readonly [K, A]): B.Event<[K, Maybe<A>]> => {
    const d = selector(e, v);
    switch (d.tag) {
      case "Nothing":
        return B.never();
      case "Just":
        return createDialog(parent, iconTheme, env, [k, v, d.value]);
      default:
        return absurd(d);
    }
  };
  const result = B.execute(
    B.apply(B.mapB((e: E) => (kv: readonly [K, A]) => () => popupAction(e, kv), env.changesB), trigger),
  );
  const newEvents = B.accumE(
    B.never<[K, Maybe<A>]>(),
    B.mapE((r: B.Event<[K, Maybe<A>]>) => (acc: B.Event<[K, Maybe<A>]>) => B.unionWith(constFirst, r, acc), result),
  );
  return B.switchE(newEvents);
}

/** Similar to @mkGtkPopupSelect@, except with the Dialog being part of the event. */
export function mkGtkPopup<E, W, K, A>(
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  env: Changes<E>,
  trigger: B.Event<readonly [K, A, Dialog_<E, W, A>]>,
): B.Event<[K, Maybe<A>]> {
  const result = B.execute(
    B.mapE((t: readonly [K, A, Dialog_<E, W, A>]) => () => createDialog(parent, iconTheme, env, t), trigger),
  );
  const newEvents = B.accumE(
    B.never<[K, Maybe<A>]>(),
    B.mapE((r: B.Event<[K, Maybe<A>]>) => (acc: B.Event<[K, Maybe<A>]>) => B.unionWith(constFirst, r, acc), result),
  );
  return B.switchE(newEvents);
}

/**
 * Creates a widget which continuously displays a value determined by an Event and returns
 * edits to the value as events. The Key value @k@ carries an identifier for the value being
 * edited. When it changes a new dialog is created. The returned widget is a "Gtk.Frame",
 * so the caller does not need to do anything with the result except insert it in the widget
 * hierarchy.
 *
 * If the initial key-value pair is not @Nothing@ then this function will immediately inspect the
 * dialog selector behavior. This can cause problems if the function is called when the
 * application is still starting up and the selector has no value.
 *
 * The dialog will be recomputed if the input key changes or if the selector event is triggered.
 * This allows the application to filter updates to the dialog.
 *
 * (The Haskell `Eq k` and `Eq i` constraints are structural.)
 *
 * @param newWidgetIO Run on all newly created widgets.
 * @param envInit Initial value of environment.
 * @param envC Current value of the environment.
 * @param selectorB Events trigger a new dialog to be displayed. Also sampled when the input key changes.
 * @param initial Initial widget display.
 * @param inputE Key-value pairs for widget updates.
 */
export function mkDialogWidget<E, W, K, I, O>(
  iconTheme: Gtk.IconTheme,
  newWidgetIO: WInit,
  envInit: E,
  envC: Changes<E>,
  selectorB: B.Behavior<DialogSelector<E, W, I, O>>,
  initial: readonly [K, B.Behavior<I>],
  inputE: B.Event<readonly [K, B.Behavior<I>]>,
): [Gtk.Widget, B.Event<[K, O]>, B.Event<readonly W[]>] {
  type KV = readonly [K, B.Behavior<I>];
  const keyChanged = ([k1]: KV, [k2]: KV): boolean => notEquals(k1, k2);
  // Clear the frame contents.
  const clearWidget = (parent: Gtk.Frame): void => {
    const child = Gtk.binGetChild(parent);
    // Just oldWidget -> Gtk.containerRemove parent oldWidget
    if (child !== null) Gtk.widgetDestroy(child);
    Gtk.frameSetLabel(parent, null);
  };
  // The gadget is chosen from the current value and does not change until the next call
  // to createWidget (i.e. when the key changes)
  const createWidget = (
    parent: Gtk.Frame,
    env: E,
    [selector, [key, valB]]: readonly [DialogSelector<E, W, I, O>, KV],
  ): [B.Event<[K, O]>, B.Event<readonly W[]>, () => void] => {
    const initial1 = B.valueB(valB);
    const d = selector(env, initial1);
    switch (d.tag) {
      case "Nothing": {
        const delayedIO = (): void => {
          clearWidget(parent);
          Gtk.frameSetLabel(parent, null);
        };
        return [B.never(), B.never(), delayedIO];
      }
      case "Just": {
        const title = d.value.dialogTitle;
        const gadget = d.value.dialogGadget;
        const output = renderGadget(
          iconTheme,
          newWidgetIO,
          env,
          GadgetData(true, initial1),
          envC,
          B.never(),
          B.mapB((v: I) => GadgetData(true, v), valB),
          gadget,
        );
        const widget = boxWidgets(newWidgetIO, "Vertical", output.gadgetView);
        const result = B.mapE((x: GadgetData<O>) => x._gdValue, B.filterE((x: GadgetData<O>) => x._gdOk, output.gadgetUser));
        const delayedIO = (): void => {
          // Callbacks triggered during execute cause hanging.
          clearWidget(parent);
          Gtk.frameSetLabel(parent, title);
          if (widget.tag === "Just") {
            Gtk.set(widget.value, { margin: 3 });
            Gtk.containerAdd(parent, widget.value);
          }
          Gtk.widgetShowAll(parent);
        };
        return [B.mapE((o: O): [K, O] => [key, o], result), output.gadgetEvents, delayedIO];
      }
      default:
        return absurd(d);
    }
  };

  const scrolledWidget = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  newWidgetIO(scrolledWidget);
  const frameWidget = Gtk.frameNew(null);
  newWidgetIO(frameWidget);
  Gtk.set(frameWidget, { margin: 3 });
  const inputB = B.stepper<KV>(initial, inputE);
  const sel = B.valueB(selectorB);
  // newKeyE :: Event (k, Changes (Maybe v))
  const newKeyE = B.filterApply(B.mapB((old: KV) => (nw: KV) => keyChanged(old, nw), inputB), inputE);
  // dialogE :: Event (DialogSelector e w i o, (k, Changes (Maybe v)))
  const dialogE = B.apply(
    B.mapB((s: DialogSelector<E, W, I, O>) => (kv: KV): readonly [DialogSelector<E, W, I, O>, KV] => [s, kv], selectorB),
    newKeyE,
  );
  // Event stream from edits to the initial value, if any.
  const [initialEvent, initialSent, delayedIO] = createWidget(frameWidget, envInit, [sel, initial]);
  delayedIO();
  // Event stream from edits to updated values.
  const creation = B.execute(
    B.apply(
      B.mapB((env: E) => (sd: readonly [DialogSelector<E, W, I, O>, KV]) => () => createWidget(frameWidget, env, sd), envC.changesB),
      dialogE,
    ),
  );
  const stop = reactimate1(B.mapE((c: [B.Event<[K, O]>, B.Event<readonly W[]>, () => void]) => c[2], creation));
  Gtk.onWidgetDestroy(frameWidget, stop);
  const sent = B.switchE(B.mapE((c: [B.Event<[K, O]>, B.Event<readonly W[]>, () => void]) => c[1], creation), initialSent);
  const updateEE = B.accumE(
    B.never<[K, O]>(),
    B.mapE(
      (c: [B.Event<[K, O]>, B.Event<readonly W[]>, () => void]) => (acc: B.Event<[K, O]>) => B.unionWith(constFirst, c[0], acc),
      creation,
    ),
  );
  const updateE = B.switchE(updateEE);
  Gtk.containerAdd(scrolledWidget, frameWidget);
  Gtk.scrolledWindowSetPropagateNaturalHeight(scrolledWidget, true);
  Gtk.scrolledWindowSetPropagateNaturalWidth(scrolledWidget, true);
  Gtk.widgetShowAll(scrolledWidget);
  const w = Gtk.toWidget(scrolledWidget);
  return [w, B.unionWith(constFirst, initialEvent, updateE), sent];
}

/** Run the dialog as a simple pop-up in the IO monad. */
export async function runDialog<E, W, A>(
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  d: Dialog_<E, W, A>,
  env: E,
  initial: A,
): Promise<Maybe<A>> {
  const wInit = (_w: Gtk.Widget): void => {};
  const store = newIORef(initial); // Wormhole for result to escape from reactive net.
  const target = Gtk.dialogNew();
  const style1 = Gtk.widgetGetStyleContext(target);
  Gtk.styleContextAddClass(style1, "hades-dialog");
  const modalFor1 = widgetWindow(parent);
  if (modalFor1 !== null) Gtk.set(target, { transientFor: modalFor1 });
  Gtk.windowSetTitle(target, d.dialogTitle);
  Gtk.dialogSetDefaultResponse(
    target,
    d.dialogButtons.tag === "CloseButton" ? Gtk.ResponseTypeClose : Gtk.ResponseTypeOk,
  );
  const net = (): void => {
    // MomentIO monad.
    // Get the dialog widget tree and change event. Put widget tree into window.
    const feedbackRef: B.Behavior<A> = B.lazyB(() => feedback);
    const output = renderGadget(
      iconTheme,
      wInit,
      env,
      GadgetData(true, initial),
      pure_Changes(env),
      B.never(),
      B.mapB((v: A) => GadgetData(true, v), feedbackRef),
      d.dialogGadget,
    );
    // Input is always assumed valid. The gadget can decide otherwise.
    const widget = boxWidgets(wInit, "Vertical", output.gadgetView);
    if (widget.tag === "Just") {
      // widget is Maybe, so this is done at most once.
      const w = widget.value;
      Gtk.set(w, { margin: 5 });
      Gtk.widgetSetMarginEnd(w, 10); // Space for scroll bars
      const contentBox = Gtk.dialogGetContentArea(target);
      Gtk.boxPackStart(contentBox, w, true, true, 5);
    }
    // Plumb the new values coming up via 'setter' to the 'value' sent down the tree.
    const feedback: B.Behavior<A> = B.stepper(
      output.gadgetInitial._gdValue,
      B.mapE((x: GadgetData<A>) => x._gdValue, output.gadgetUser),
    );
    writeIORef(store, output.gadgetInitial._gdValue);
    const stop = reactimate1(
      B.mapE((x: GadgetData<A>) => () => writeIORef(store, x._gdValue), cleanOutput(output).gadgetUser),
    );
    Gtk.onWidgetDestroy(target, stop);
    switch (d.dialogButtons.tag) {
      case "CloseButton":
        Gtk.dialogAddButton(target, d.dialogButtons._0, Gtk.ResponseTypeClose);
        break;
      default: {
        Gtk.dialogAddButton(target, "_Cancel", Gtk.ResponseTypeCancel);
        const okButton = Gtk.dialogAddButton(target, "_Ok", Gtk.ResponseTypeOk);
        eventLink(okButton, Gtk.setWidgetSensitive, B.mapE((x: GadgetData<A>) => x._gdOk, output.gadgetUser));
        Gtk.setWidgetSensitive(okButton, output.gadgetInitial._gdOk);
        break;
      }
    }
    Gtk.widgetShowAll(target);
  };
  const compiled = B.compile(net);
  B.actuate(compiled);
  const r1 = await Gtk.dialogRun(target);
  B.pause(compiled);
  Gtk.widgetDestroy(target);
  switch (r1) {
    case Gtk.ResponseTypeOk:
      return Just(readIORef(store));
    case Gtk.ResponseTypeClose:
      return Just(readIORef(store));
    default:
      return Nothing;
  }
}

/** Create the dialog as specified. */
export function createDialog<E, W, K, A>(
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  envC: Changes<E>,
  [key, initial, d]: readonly [K, A, Dialog_<E, W, A>],
): B.Event<[K, Maybe<A>]> {
  // mdo
  const wInit = (_w: Gtk.Widget): void => {};
  const handleResponse1 = (target: Gtk.Dialog, handler: (b: boolean) => void, r: number): void => {
    switch (r) {
      case Gtk.ResponseTypeOk:
        handler(true);
        Gtk.widgetDestroy(target);
        return;
      case Gtk.ResponseTypeApply:
        handler(true);
        return;
      case Gtk.ResponseTypeCancel:
        handler(false);
        Gtk.widgetDestroy(target);
        return;
      case Gtk.ResponseTypeClose:
        handler(true);
        Gtk.widgetDestroy(target);
        return;
      case Gtk.ResponseTypeNone:
        handler(false);
        Gtk.widgetDestroy(target);
        return;
      case Gtk.ResponseTypeDeleteEvent:
        handler(false);
        Gtk.widgetDestroy(target);
        return;
      default:
        return cannotHappen("createDialog: unknown button clicked.", () => {
          handler(false);
          Gtk.widgetDestroy(target);
        })();
    }
  };
  const handleResponse = (target: Gtk.Dialog, handler: (b: boolean) => void, v: number): void =>
    handleResponse1(target, handler, v);

  // Create the window.
  const target = Gtk.new_(Gtk.Dialog, { modal: true, title: d.dialogTitle });
  const style = Gtk.widgetGetStyleContext(target);
  Gtk.styleContextAddClass(style, "hades-dialog");
  const modalFor = widgetWindow(parent);
  if (modalFor !== null) Gtk.set(target, { transientFor: modalFor });
  Gtk.dialogSetDefaultResponse(
    target,
    d.dialogButtons.tag === "CloseButton" ? Gtk.ResponseTypeClose : Gtk.ResponseTypeOk,
  );
  const box = Gtk.dialogGetContentArea(target);
  // Get the dialog widget tree and change event. Put widget tree into window.
  const envInit = B.valueB(envC.changesB);
  const feedbackRef: B.Behavior<A> = B.lazyB(() => feedback);
  const output = renderGadget(
    iconTheme,
    wInit,
    envInit,
    GadgetData(true, initial),
    envC,
    B.never(),
    B.mapB((v: A) => GadgetData(true, v), feedbackRef),
    d.dialogGadget,
  );
  const outputB = B.stepper(output.gadgetInitial, B.filterE((x: GadgetData<A>) => x._gdOk, output.gadgetUser));
  const feedback: B.Behavior<A> = B.stepper(
    output.gadgetInitial._gdValue,
    B.mapE((x: GadgetData<A>) => x._gdValue, output.gadgetUser),
  );
  const widget = boxWidgets(wInit, "Vertical", output.gadgetView);
  if (widget.tag === "Just") {
    // widget is Maybe, so this is done at most once.
    const w = widget.value;
    Gtk.set(w, { margin: 5 });
    Gtk.widgetSetMarginEnd(w, 10); // Space for scroll bars
    Gtk.boxPackStart(box, w, true, true, 5);
  }
  // Event triggered when OK is pressed.
  const [resultE, resultH] = B.newEvent<boolean>();
  Gtk.onDialogResponse(target, (v: number) => handleResponse(target, resultH, v));
  switch (d.dialogButtons.tag) {
    case "CloseButton":
      Gtk.dialogAddButton(target, d.dialogButtons._0, Gtk.ResponseTypeClose);
      break;
    default: {
      const enableOk = B.mapE((x: GadgetData<A>) => x._gdOk, output.gadgetUser);
      Gtk.dialogAddButton(target, "_Cancel", Gtk.ResponseTypeCancel);
      const okButton = Gtk.dialogAddButton(target, "_Ok", Gtk.ResponseTypeOk);
      eventLink(okButton, Gtk.setWidgetSensitive, enableOk);
      Gtk.setWidgetSensitive(okButton, output.gadgetInitial._gdOk);
      if (d.dialogButtons.tag === "OkApplyButton") {
        const applyButton = Gtk.dialogAddButton(target, "_Apply", Gtk.ResponseTypeApply);
        Gtk.setWidgetSensitive(applyButton, output.gadgetInitial._gdOk);
        eventLink(applyButton, Gtk.setWidgetSensitive, enableOk);
      }
      break;
    }
  }
  Gtk.widgetShowAll(target);
  return B.apply(
    B.mapB((a: GadgetData<A>) => (r1: boolean): [K, Maybe<A>] => [key, r1 ? Just(a._gdValue) : Nothing], outputB),
    resultE,
  );
}

// ---------------------------------------------------------------------------------------------
// Gadget output

/**
 * GTK gadget renderings return this type.
 *
 * Gadget output combines an event and behaviour in way which resembles "Changes" but is
 * sufficiently different not to use one. The user "Event" is triggered when the user actually
 * makes a change to the data. When this data is fed back in to this or any other gadget it
 * travels as a "Behavior", so the Event data may be different to the current Behavior.
 *
 * The gadget dialog functions maintain a global input behaviour from the output events. This
 * provides the feedback for the gadget to update itself.
 *
 * Display widgets therefore need to reactimate only on the behavior, but not propogate
 * events which are the result of updates from the behavior.
 */
export interface GadgetOut<W, O> {
  /** The widgets to display, if any. */
  readonly gadgetView: readonly Gtk.Widget[];
  /** Data sent via the side channel. */
  readonly gadgetEvents: B.Event<readonly W[]>;
  /** The value of the initial output, if any. */
  readonly gadgetInitial: GadgetData<O>;
  /** User updates to the output. */
  readonly gadgetUser: B.Event<GadgetData<O>>;
  /** Application updates to the output. */
  readonly gadgetValue: B.Behavior<GadgetData<O>>;
}
export function GadgetOut<W, O>(
  gadgetView: readonly Gtk.Widget[],
  gadgetEvents: B.Event<readonly W[]>,
  gadgetInitial: GadgetData<O>,
  gadgetUser: B.Event<GadgetData<O>>,
  gadgetValue: B.Behavior<GadgetData<O>>,
): GadgetOut<W, O> {
  return { gadgetView, gadgetEvents, gadgetInitial, gadgetUser, gadgetValue };
}

/** `instance Functor (GadgetOut w)` */
export function fmap_GadgetOut<W, O, R>(f: (o: O) => R, g: GadgetOut<W, O>): GadgetOut<W, R> {
  return GadgetOut(
    g.gadgetView,
    g.gadgetEvents,
    gdFmap(f, g.gadgetInitial),
    B.mapE(gdFmapF(f), g.gadgetUser),
    B.mapB(gdFmapF(f), g.gadgetValue),
  );
}

/** `pure` of `instance Applicative (GadgetOut w)` */
export function pure_GadgetOut<W, O>(v: O): GadgetOut<W, O> {
  return GadgetOut([], B.never(), GadgetData(true, v), B.never(), B.pureB(GadgetData(true, v)));
}

/** `(<*>)` of `instance Applicative (GadgetOut w)` */
export function ap_GadgetOut<W, A, R>(gf: GadgetOut<W, (a: A) => R>, gv: GadgetOut<W, A>): GadgetOut<W, R> {
  // Semantics happen to match Changes, so reuse the code.
  const c = liftA2_Changes(
    (f: GadgetData<(a: A) => R>, v: GadgetData<A>) => gdAp(f, v),
    Changes(gf.gadgetUser, gf.gadgetValue),
    Changes(gv.gadgetUser, gv.gadgetValue),
  );
  return GadgetOut(
    [...gf.gadgetView, ...gv.gadgetView],
    appendEvents(gf.gadgetEvents, gv.gadgetEvents),
    gdAp(gf.gadgetInitial, gv.gadgetInitial),
    c.changesE,
    c.changesB,
  );
}

/** `mempty` of `instance (Monoid v) => Monoid (GadgetOut w v)`; the argument is `mempty :: v`. */
export function mempty_GadgetOut<W, V>(memptyV: V): GadgetOut<W, V> {
  return GadgetOut([], B.never(), GadgetData(true, memptyV), B.never(), B.pureB(GadgetData(true, memptyV)));
}

/** `(<>)` of `instance (Semigroup v) => Semigroup (GadgetOut w v)`; the first argument is `(<>) :: v -> v -> v`. */
export function append_GadgetOut<W, V>(appendV: (a: V, b: V) => V, g1: GadgetOut<W, V>, g2: GadgetOut<W, V>): GadgetOut<W, V> {
  const appendGD = (x: GadgetData<V>, y: GadgetData<V>): GadgetData<V> =>
    isLazy(x) || isLazy(y)
      ? gdLazy(() => x._gdOk && y._gdOk, () => appendV(x._gdValue, y._gdValue))
      : append_GadgetData(appendV, x, y);
  return GadgetOut(
    [...g1.gadgetView, ...g2.gadgetView],
    appendEvents(g1.gadgetEvents, g2.gadgetEvents),
    appendGD(g1.gadgetInitial, g2.gadgetInitial),
    B.unionWith(appendGD, g1.gadgetUser, g2.gadgetUser),
    B.liftA2B(appendGD, g1.gadgetValue, g2.gadgetValue),
  );
}

/** Filter invalid values from the user event stream. */
export function cleanOutput<W, I>(g: GadgetOut<W, I>): GadgetOut<W, I> {
  return { ...g, gadgetUser: B.filterE((x: GadgetData<I>) => x._gdOk, g.gadgetUser) };
}

/**
 * Make the output validity conditional on an external condition. If the @Bool@ is false then
 * all the gadget values will be flagged as invalid.
 */
function qualifyOutput<W, I>(ok: boolean, o: GadgetOut<W, I>): GadgetOut<W, I> {
  const q = (x: GadgetData<I>): GadgetData<I> => gdOverOk((b1) => ok && b1, x);
  return {
    ...o,
    gadgetInitial: q(o.gadgetInitial),
    gadgetUser: B.mapE(q, o.gadgetUser),
    gadgetValue: B.mapB(q, o.gadgetValue),
  };
}

/** Merge ouptputs that carry functions, including their validity flags. Widgets are concatenated. */
function mergeOutputs<W, A>(outs: readonly GadgetOut<W, (a: A) => A>[]): GadgetOut<W, (a: A) => A> {
  type F = (a: A) => A;
  const merge = (x: GadgetData<F>, y: GadgetData<F>): GadgetData<F> =>
    isLazy(x) || isLazy(y)
      ? gdLazy(() => x._gdOk && y._gdOk, () => {
        const f1 = x._gdValue, f2 = y._gdValue;
        return (a: A) => f1(f2(a));
      })
      : GadgetData(x._gdOk && y._gdOk, (a: A) => x._gdValue(y._gdValue(a)));
  // Merge a pair of outputs. The tricky bit is ensuring that old invalidity flags do not
  // cause a permanent latch in the user output.
  const merge2 = (out1: GadgetOut<W, F>, out2: GadgetOut<W, F>): GadgetOut<W, F> => GadgetOut(
    [...out1.gadgetView, ...out2.gadgetView],
    appendEvents(out1.gadgetEvents, out2.gadgetEvents),
    merge(out1.gadgetInitial, out2.gadgetInitial),
    B.unionWith(
      merge,
      B.apply(B.mapB((v2: GadgetData<F>) => (u1: GadgetData<F>) => merge(v2, u1), out2.gadgetValue), out1.gadgetUser),
      B.apply(B.mapB((v1: GadgetData<F>) => (u2: GadgetData<F>) => merge(v1, u2), out1.gadgetValue), out2.gadgetUser),
    ),
    B.liftA2B(merge, out1.gadgetValue, out2.gadgetValue),
  );
  if (outs.length === 0) {
    const idF: F = (a: A) => a;
    return GadgetOut([], B.never(), GadgetData(true, idF), B.never(), B.pureB(GadgetData(true, idF)));
  }
  // foldr1 is safe because outs is never null.
  return L.foldr1(merge2, outs);
}

/** Data derived from a "ClickableItem" which is displayed in GTK. */
interface GtkClickable<A> {
  /** UTF8 byte indices for start and end. */
  readonly gclickRange: readonly [number, number];
  /** Base data. */
  readonly gclickBase: ClickableItem<A>;
}
function GtkClickable<A>(gclickRange: readonly [number, number], gclickBase: ClickableItem<A>): GtkClickable<A> {
  return { gclickRange, gclickBase };
}

/**
 * Display the items in the label as a comma-separated list, and return a function from the
 * UTF8 index (as used by GTK) to the corresponding GtkClickable.
 */
function displayClickables<A>(
  label: Gtk.Label,
  g: GadgetData<readonly ClickableItem<A>[]>,
): (idx: number) => Maybe<GtkClickable<A>> {
  if (!g._gdOk) return () => Nothing;
  const items = g._gdValue;
  const itemSep = ", ";
  const sepLen = T.length(itemSep);
  const itemLengths = items.map((i) => U.encodeUtf8(i.clickText).length);
  const itemRange = ([, prev]: readonly [number, number], x: number): readonly [number, number] =>
    [prev + sepLen, prev + sepLen + x];
  const itemRanges = L.tail(L.scanl(itemRange, [0, -sepLen] as readonly [number, number], itemLengths));
  const inRange = (idx: number, [x1, x2]: readonly [number, number]): boolean => x1 <= idx && idx <= x2;
  const display = T.intercalate(itemSep, items.map((i) => i.clickText));
  const oldTxt = Gtk.labelGetText(label);
  if (oldTxt !== display) Gtk.labelSetLabel(label, display);
  const gtks = L.zipWith(GtkClickable, itemRanges, items);
  return (idx: number) => L.find((c: GtkClickable<A>) => inRange(idx, c.gclickRange), gtks);
}

// ---------------------------------------------------------------------------------------------
// Rendering

/**
 * Render a gadget as one or more GTK widgets.
 *
 * @param wInit Run on all newly created widgets.
 * @param env The initial environment.
 * @param initial The initial input.
 * @param envC Updates to the environment. This must start equal to the first argument.
 * @param e User updates to the input.
 * @param b Application updates. Must start equal to the second argument.
 */
export function renderGadget<E, W, I, O>(
  iconTheme: Gtk.IconTheme,
  wInit: WInit,
  env: E,
  initial: GadgetData<I>,
  envC: Changes<E>,
  e: B.Event<GadgetData<I>>,
  b: B.Behavior<GadgetData<I>>,
  gadget: Gadget<E, W, I, O>,
): GadgetOut<W, O> {
  const g = gadget as AnyGadget;
  switch (g.tag) {
    case "Null":
      // {-# SCC "renderGadget_Null" #-}
      return GadgetOut([], B.never(), initial, e, b) as GadgetOut<W, any>;
    case "Pure":
      return renderGadget_Pure(initial, e, b, g._0);
    case "Dot":
      return renderGadget_Dot(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Prod":
      return renderGadget_Prod(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Loop":
      return renderGadget_Loop(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "Focusing":
      return renderGadget_Focusing(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Prismatic":
      return renderGadget_Prismatic(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2);
    case "PrismaticOver":
      return renderGadget_PrismaticOver(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2);
    case "Traversing":
      return renderGadget_Traversing(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2);
    case "TraversingOver":
      return renderGadget_TraversingOver(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2);
    case "Accum":
      return renderGadget_Accum(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "Initially":
      // {-# SCC "renderGadget_Initiall" #-}
      return GadgetOut([], B.never(), GadgetData(true, g._0), e, b);
    case "GetInitial": {
      // {-# SCC "renderGadget_GetInitial" #-}
      const g1 = g._0(initial._gdValue);
      return renderGadget(iconTheme, wInit, env, initial, envC, e, b, g1);
    }
    case "GetEnv":
      // {-# SCC "renderGadget_GetEnv" #-}
      return GadgetOut(
        [],
        B.never(),
        GadgetData(true, env),
        B.never(), // Environment changes are nothing to do with the user.
        B.mapB((x: E) => GadgetData(true, x), envC.changesB),
      ) as GadgetOut<W, any>;
    case "GetInitialEnv":
      // {-# SCC "renderGadget_GetInitialEnv" #-}
      return renderGadget(iconTheme, wInit, env, initial, envC, e, b, g._0(env));
    case "WithEnv": {
      // {-# SCC "renderGadget_WithEnv" #-}
      const envOut = cleanOutput(renderGadget(iconTheme, wInit, env, initial, envC, e, b, g._0));
      const i2 = envOut.gadgetInitial._gdValue;
      const e2 = B.mapE((x: GD) => x._gdValue, envOut.gadgetUser);
      const newEnvC = makeChanges(i2, e2);
      return renderGadget(iconTheme, wInit, i2, initial, newEnvC, e, b, g._1);
    }
    case "Send":
      // {-# SCC "renderGadget_Send" #-}
      return GadgetOut(
        [],
        // "return" puts item into a list.
        B.mapE((w: any): readonly any[] => [w], B.filterJust(B.mapE((x: GD) => g._0(x._gdValue), B.filterE((x: GD) => x._gdOk, e)))),
        initial,
        e,
        b,
      ) as GadgetOut<W, any>;
    case "SendMap": {
      // {-# SCC "renderGadget_SendMap" #-}
      const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g._1);
      return {
        ...inner,
        gadgetEvents: B.filterE((ws: readonly any[]) => ws.length > 0, B.mapE((ws: readonly any[]) => mapMaybe(g._0, ws), inner.gadgetEvents)),
      };
    }
    case "Exec":
      return renderGadget_Exec(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "Cond":
      return renderGadget_Cond(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "UnionTab":
      return renderGadget_UnionTab(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "Enabled":
      return renderGadget_Enabled(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "Optional":
      return renderGadget_Optional(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "ImageDisplay":
      return renderGadget_ImageDisplay(wInit, initial, e, b, g._0);
    case "Intercept":
      return renderGadget_Intercept(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2);
    case "Icon":
      return renderGadget_Icon(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Coloured": {
      // {-# SCC "renderGadget_Coloured" #-}
      const colourF = g._0;
      const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g._1);
      for (const w of inner.gadgetView) {
        widgetLinkColour(
          w,
          colourF(initial._gdValue),
          B.mapE((x: GD) => colourF(x._gdValue), e),
          B.mapB((x: GD) => colourF(x._gdValue), b),
        );
      }
      return inner;
    }
    case "Linked":
      return renderGadget_Linked(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Styled":
      return renderGadget_Styled(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Frame": {
      // {-# SCC "renderGadget_Frame" #-}
      const textF = g._0;
      const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g._1);
      const boxWidget = Gtk.frameNew(toNull(textF(initial._gdValue)));
      wInit(boxWidget);
      const innerWidget = boxWidgets(wInit, "Vertical", inner.gadgetView);
      if (innerWidget.tag === "Just") {
        Gtk.set(innerWidget.value, { margin: 5 });
        Gtk.containerAdd(boxWidget, innerWidget.value);
      }
      const setLabel = (f: Gtk.Frame, t: Maybe<T.Text>): void => Gtk.frameSetLabel(f, toNull(t));
      eventLink(boxWidget, setLabel, B.mapE((x: GD) => textF(x._gdValue), e));
      behaviorLink(boxWidget, setLabel, B.mapB((x: GD) => textF(x._gdValue), b));
      const w = Gtk.toWidget(boxWidget);
      return { ...inner, gadgetView: [w] };
    }
    case "Form":
      return renderGadget_Form(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "TabForm":
      return renderGadget_TabForm(iconTheme, wInit, env, initial, envC, e, b, g._0);
    case "Box":
      return renderGadget_Box(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "Grid":
      return renderGadget_Grid(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2);
    case "Validate":
      return renderGadget_Validate(iconTheme, wInit, env, initial, envC, e, b, (e1, i, o) => g._0(e1, i, o), g._1);
    case "ValidateText":
      return renderGadget_ValidateText(iconTheme, wInit, env, initial, envC, e, b, (e1, i, o) => g._0(e1, i, o), g._1);
    case "TextBox":
      return renderGadget_TextBox(wInit, env, initial, envC, e, b, g._0);
    case "DisplayText":
      return renderGadget_DisplayText(wInit, initial, e, b);
    case "MemoBox":
      return renderGadget_MemoBox(wInit, initial, e, b, g._0, g._1);
    case "DisplayMemo":
      return renderGadget_DisplayMemo(wInit, initial, e, b);
    case "Combo":
      return renderGadget_Combo(iconTheme, wInit, env, initial, e, b, g._0);
    case "Radio":
      return renderGadget_Radio(wInit, env, initial, e, b, g._0);
    case "TickBox":
      return renderGadget_TickBox(wInit, initial, e, b);
    case "Message":
      return renderGadget_Message(wInit, env, initial, envC, e, b, g._0);
    case "Scrolled": {
      // {-# SCC "renderGadget_Scrolled" #-}
      const result = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g._0);
      const widget = boxWidgets(wInit, "Vertical", result.gadgetView);
      const scroll = mapMaybeValue((w: Gtk.Widget): Gtk.Widget => {
        const scroll1 = Gtk.new_(Gtk.ScrolledWindow, {
          propagateNaturalHeight: true,
          propagateNaturalWidth: true,
        });
        wInit(scroll1);
        Gtk.containerAdd(scroll1, w);
        return Gtk.toWidget(scroll1);
      }, widget);
      return { ...result, gadgetView: scroll.tag === "Just" ? [scroll.value] : [] };
    }
    case "FixedText":
      return renderGadget_FixedText(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "FixedMemo":
      return renderGadget_FixedMemo(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2, g._3);
    case "ClickableList":
      return renderGadget_ClickableList(wInit, initial, e, b);
    case "DateBox":
      return renderGadget_DateBox(wInit, initial, e, b, g._0);
    case "IconBox":
      return renderGadget_IconBox(iconTheme, wInit, initial, e, b, g._0);
    case "ColourBox":
      return renderGadget_ColourBox(wInit, initial, e, b);
    case "TreeSelector":
      return renderGadget_TreeSelector(wInit, env, initial, e, b, g._0);
    case "Table":
      return renderGadget_Table(iconTheme, wInit, initial, envC, e, b, g._0, g._1, g._2);
    case "ForestTable":
      return renderGadget_ForestTable(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1);
    case "ButtonBar":
      return renderGadget_ButtonBar(wInit, e, b, g._0);
    case "ButtonIO":
      return renderGadget_ButtonIO(wInit, envC, b, g._0, g._1);
    case "Image":
      return renderGadget_Image(wInit, initial, e, g._0);
    case "ForestEditor":
      return renderGadget_ForestEditor(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, g._2, g._3);
    case "FilePathSelector":
      return renderGadget_FilePathSelector(wInit, initial, e, b, g._0, g._1, g._2, g._3);
    case "Trace":
      return renderGadget_Trace(iconTheme, wInit, env, initial, envC, e, b, g._0, g._1, (i, o) => g._2(i, o), g._3);
    default:
      return absurd(g);
  }
}

function renderGadget_Pure(initial: GD, e: B.Event<GD>, b: B.Behavior<GD>, f: (i: any) => any): Out {
  return GadgetOut([], B.never(), gdFmap(f, initial), B.mapE(gdFmapF(f), e), B.mapB(gdFmapF(f), b));
}

function renderGadget_Dot(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  g1: AnyGadget, g2: AnyGadget,
): Out {
  const r2 = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g2);
  const r1 = renderGadget(iconTheme, wInit, env, r2.gadgetInitial, envC, r2.gadgetUser, r2.gadgetValue, g1);
  return GadgetOut(
    [...r2.gadgetView, ...r1.gadgetView], // r2 feeds into r1 so r2 goes above.
    appendEvents(r1.gadgetEvents, r2.gadgetEvents),
    r1.gadgetInitial,
    r1.gadgetUser,
    r1.gadgetValue,
  );
}

function renderGadget_Prod(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  g1: AnyGadget, g2: AnyGadget,
): Out {
  const r1 = renderGadget(iconTheme, wInit, env, gdFmap(fst, initial), envC, B.mapE(gdFmapF(fst), e), B.mapB(gdFmapF(fst), b), g1);
  const r2 = renderGadget(iconTheme, wInit, env, gdFmap(snd, initial), envC, B.mapE(gdFmapF(snd), e), B.mapB(gdFmapF(snd), b), g2);
  return ap_GadgetOut(fmap_GadgetOut((x: any) => (y: any): [any, any] => [x, y], r1), r2);
}

// Loop :: Gadget (i, s) (o, s) -> Gadget i o
function renderGadget_Loop(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  g: AnyGadget,
): Out {
  // mdo
  let output: Out | null = null;
  const stateInitial = (): GD => {
    if (output === null) return error("renderGadget Loop: <<loop>> (the loop state was needed before it was defined).");
    return gdFmap(snd, output.gadgetInitial);
  };
  // loopInitialInput = (,) <$> initial <*> (snd <$> gadgetInitial output)
  const loopInitialInput: GD = gdLazy(
    () => initial._gdOk && stateInitial()._gdOk,
    () => lazyPair(initial._gdValue, () => stateInitial()._gdValue),
  );
  const fbRef: B.Behavior<(i: GD) => GD> = B.lazyB(() => fb);
  const newE = B.apply(fbRef, e);
  const newB = B.applyB(fbRef, b);
  output = renderGadget(iconTheme, wInit, env, loopInitialInput, envC, newE, newB, g);
  const fb: B.Behavior<(i: GD) => GD> = B.mapB(
    (s: GD) => (i: GD) => gdAp(gdFmap((x: any) => (y: any): [any, any] => [x, y], i), s),
    B.stepper(gdFmap(snd, loopInitialInput), B.mapE(gdFmapF(snd), output.gadgetUser)),
  );
  return fmap_GadgetOut(fst, output);
}

function renderGadget_Focusing(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  lns: Lens<any, any, any, any>, g: AnyGadget,
): Out {
  const extract = (x: any): any => view(lns, x);
  const out = renderGadget(iconTheme, wInit, env, gdFmap(extract, initial), envC, B.mapE(gdFmapF(extract), e), B.mapB(gdFmapF(extract), b), g);
  return fmap_GadgetOut((v: any) => (s: any) => set(lns, v, s), out);
}

function renderGadget_Prismatic(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  d: any, prsm: Prism<any, any, any, any>, g: AnyGadget,
): Out {
  return withPrism(prsm, (inject, extract) => {
    const extract1 = (x: any): any => fromRight(d, extract(x));
    const out = renderGadget(iconTheme, wInit, env, gdFmap(extract1, initial), envC, B.mapE(gdFmapF(extract1), e), B.mapB(gdFmapF(extract1), b), g);
    return fmap_GadgetOut(inject, out);
  });
}

function renderGadget_PrismaticOver(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  d: any, prsm: Prism<any, any>, g: AnyGadget,
): Out {
  const extract = (x: any): any => fromMaybe(d, preview(prsm, x));
  const out = renderGadget(iconTheme, wInit, env, gdFmap(extract, initial), envC, B.mapE(gdFmapF(extract), e), B.mapB(gdFmapF(extract), b), g);
  return fmap_GadgetOut((f: (a: any) => any) => (v: any) => review(prsm, f(extract(v))), out);
}

function renderGadget_Traversing(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  d: any, trv: Traversal<any, any, any, any>, g: AnyGadget,
): Out {
  const extract = (x: any): any => fromMaybe(d, preview(trv, x));
  const out = renderGadget(iconTheme, wInit, env, gdFmap(extract, initial), envC, B.mapE(gdFmapF(extract), e), B.mapB(gdFmapF(extract), b), g);
  return fmap_GadgetOut((v: any) => (s: any) => set(trv, v, s), out);
}

function renderGadget_TraversingOver(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  d: any, trv: Traversal<any, any, any, any>, g: AnyGadget,
): Out {
  const extract = (x: any): any => fromMaybe(d, preview(trv, x));
  const out = renderGadget(iconTheme, wInit, env, gdFmap(extract, initial), envC, B.mapE(gdFmapF(extract), e), B.mapB(gdFmapF(extract), b), g);
  return fmap_GadgetOut((f: (a: any) => any) => (s: any) => over(trv, f, s), out);
}

function renderGadget_Accum(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  g: AnyGadget,
): Out {
  // mdo
  const applyUpdate = (old: GD, upd: GadgetData<(a: any) => any>): GD =>
    isLazy(old) || isLazy(upd)
      ? gdLazy(() => upd._gdOk, () => upd._gdValue(old._gdValue))
      : GadgetData(upd._gdOk, upd._gdValue(old._gdValue));
  const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  const outE = B.apply(B.mapB((old: GD) => (upd: GD) => applyUpdate(old, upd), b), inner.gadgetUser);
  return {
    ...inner,
    gadgetInitial: applyUpdate(initial, inner.gadgetInitial),
    gadgetUser: outE,
    gadgetValue: b,
  };
}

function renderGadget_Exec(
  iconTheme: Gtk.IconTheme, wInit: WInit, _env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  gadgetF: (a: any) => AnyGadget,
): Out {
  const getGadget = (d: GD): GadgetData<readonly [AnyGadget, GD]> =>
    GadgetData(d._gdOk, [gadgetF(d._gdValue[0]), gdFmap(snd, d)] as const);
  // doExec :: (Gtk.IsWidget w) => w -> (Gadget i o, i) -> MomentIO (GadgetOut o, IO ())
  const doExec = (parent: Gtk.Box, gd: GadgetData<readonly [AnyGadget, GD]>): [Out, () => void] => {
    const ok = gd._gdOk;
    const [sub, newValue] = gd._gdValue;
    const env1 = B.valueB(envC.changesB);
    const o = renderGadget(iconTheme, wInit, env1, newValue, envC, B.mapE(gdFmapF(snd), e), B.mapB(gdFmapF(snd), b), sub);
    const replace = (): void => {
      // IO monad
      const childs = Gtk.containerGetChildren(parent);
      for (const c of childs) Gtk.widgetDestroy(c);
      for (const w of o.gadgetView) Gtk.boxPackStart(parent, w, true, true, 0);
      Gtk.widgetShowAll(parent);
    };
    return [qualifyOutput(ok, o), replace];
  };

  const parent = Gtk.boxNew(Gtk.OrientationVertical, 5); // A holder for widgets created by events.
  wInit(parent);
  const currentArg = B.stepper(gdFmap(fst, initial), B.mapE(gdFmapF(fst), e));
  const changed = B.mapE(
    (p: readonly [GD, GD]) => p[1],
    B.filterE(
      ([v1, v2]: readonly [GD, GD]) => notEquals(v1._gdValue, v2._gdValue[0]),
      B.apply(B.mapB((v1: GD) => (v2: GD): readonly [GD, GD] => [v1, v2], currentArg), e),
    ),
  );
  const startGadget = getGadget(initial);
  const gadgetUpdates = B.mapE(getGadget, changed);
  const [initialOut, initialIO] = doExec(parent, startGadget);
  initialIO(); // Put up the initial gadget in the empty frame.
  const newWidgets = B.execute(B.mapE((gu: GadgetData<readonly [AnyGadget, GD]>) => () => doExec(parent, gu), gadgetUpdates));
  const sent = B.switchE(B.mapE((nw: [Out, () => void]) => nw[0].gadgetEvents, newWidgets), initialOut.gadgetEvents);
  const resultE = B.switchE(B.mapE((nw: [Out, () => void]) => nw[0].gadgetUser, newWidgets), initialOut.gadgetUser);
  const stop = reactimate1(B.mapE((nw: [Out, () => void]) => nw[1], newWidgets));
  Gtk.onWidgetDestroy(parent, stop);
  const w = Gtk.toWidget(parent);
  const outE = B.unionWith(
    constFirst,
    B.mapE((nw: [Out, () => void]) => nw[0].gadgetInitial, newWidgets), // Newly created inner widgets trigger updates.
    resultE,
  );
  const outB = B.switchB(initialOut.gadgetValue, B.mapE((nw: [Out, () => void]) => nw[0].gadgetValue, newWidgets));
  return GadgetOut([w], sent, initialOut.gadgetInitial, outE, outB);
}

/** `sequenceA . (gdValue %~ (either (const Nothing) Just . getter))`: the gadget data, if the getter matches. */
function matchGadgetData(getter: (s: any) => any, x: GD): Maybe<GD> {
  const m = either((_l: any): Maybe<any> => Nothing, (r: any): Maybe<any> => Just(r), getter(x._gdValue));
  return m.tag === "Just" ? Just(GadgetData(x._gdOk, m.value)) : Nothing;
}

function renderGadget_Cond(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  opts: readonly PrismaticGadget<any, any, any, any>[],
): Out {
  const replaceWidgets = (parent: Gtk.Box, n1: number, [o, n2]: readonly [Out, number]): void => {
    if (n1 !== n2) {
      const childs = Gtk.containerGetChildren(parent);
      for (const c of childs) Gtk.containerRemove(parent, c);
      for (const w of o.gadgetView) Gtk.boxPackStart(parent, w, true, true, 0);
      Gtk.containerCheckResize(parent);
      Gtk.widgetShowAll(parent);
    }
  };
  // Outputs are numbered so we can detect changes.
  const outputs: [(i: any) => boolean, [Out, number]][] = opts.map((pg, i) => {
    const n = i + 1;
    return withPrism(pg._1, (setter, getter): [(i: any) => boolean, [Out, number]] => {
      const d = pg._0;
      const initial1 = gdFmap((x: any) => fromRight(d, getter(x)), initial);
      const e1 = B.filterJust(B.mapE((x: GD) => matchGadgetData(getter, x), e));
      const b1 = B.mapB((x: GD) => GadgetData(x._gdOk, fromRight(d, getter(x._gdValue))), b);
      const o = renderGadget(iconTheme, wInit, env, initial1, envC, e1, b1, gDot(arr(setter), pg._2));
      return [(x: any) => isRight(getter(x)), [o, n]];
    });
  });
  const defaultOutput = (): [Out, number] =>
    outputs.length > 0 ? outputs[0][1] : error("renderGadget Cond: empty list.");
  const parent = Gtk.boxNew(Gtk.OrientationVertical, 5); // A holder for widgets created by events.
  wInit(parent);
  const chooseOutput = (v: GD): [Out, number] => {
    const found = L.find(([p]: [(i: any) => boolean, [Out, number]]) => p(v._gdValue), outputs);
    return found.tag === "Just" ? found.value[1] : defaultOutput();
  };
  const startOutput = chooseOutput(initial);
  const userChoice = B.mapE(chooseOutput, e);
  const resultE = L.foldr(
    (o: [(i: any) => boolean, [Out, number]], acc: B.Event<GD>) => B.unionWith(constFirst, o[1][0].gadgetUser, acc),
    B.never<GD>(),
    outputs,
  );
  const currentChoice = B.stepper(startOutput, userChoice);
  const outB = B.switchB(startOutput[0].gadgetValue, B.mapE((c: [Out, number]) => c[0].gadgetValue, userChoice));
  replaceWidgets(parent, -1, startOutput);
  const stop1 = reactimate1(
    B.apply(B.mapB((cur: [Out, number]) => (uc: [Out, number]) => () => replaceWidgets(parent, cur[1], uc), currentChoice), userChoice),
  );
  Gtk.onWidgetDestroy(parent, stop1);
  const w = Gtk.toWidget(parent);
  return GadgetOut(
    [w],
    mconcatEvents(outputs.map((o) => o[1][0].gadgetEvents)),
    startOutput[0].gadgetInitial,
    B.unionWith(constFirst, resultE, B.observeE(B.mapE((c: [Out, number]) => () => B.valueB(c[0].gadgetValue), userChoice))),
    outB,
  );
}

function renderGadget_UnionTab(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  tabs: readonly (readonly [T.Text, PrismaticGadget<any, any, any, any>])[],
): Out {
  if (tabs.length === 0) return error("renderGadget UnionTab: empty list."); // Empty tab list.
  const goToPage = (book: Gtk.Notebook, handler: (n: number) => void, n: number): void => {
    const c = Gtk.notebookGetCurrentPage(book);
    if (c !== n) {
      Gtk.notebookSetCurrentPage(book, n);
      handler(n);
    }
  };
  const tabMatches = (x: any, [, pg]: readonly [T.Text, PrismaticGadget<any, any, any, any>]): boolean => has(pg._1, x);
  const inputNumber = (gd: GD): number => L.takeWhile((t: readonly [T.Text, PrismaticGadget<any, any, any, any>]) => !tabMatches(gd._gdValue, t), tabs).length;
  const clickValue = <A>(gs: readonly A[], n: number): A => {
    const rest = L.drop(n, gs); // Like (!!) but safe.
    return rest.length > 0 ? rest[0] : cannotHappen("renderGadget UnionTab: missing tab", gs[0]);
    // Safe because the list of tabs is not empty.
  };
  const renderTab = (book: Gtk.Notebook, [title, pg]: readonly [T.Text, PrismaticGadget<any, any, any, any>]): Out =>
    withPrism(pg._1, (setter, getter) => {
      const d = pg._0;
      const initial1 = gdFmap((x: any) => fromRight(d, getter(x)), initial);
      const e1 = B.filterJust(B.mapE((x: GD) => matchGadgetData(getter, x), e));
      const b1 = B.mapB((x: GD) => GadgetData(x._gdOk, fromRight(d, getter(x._gdValue))), b);
      const subOutput = renderGadget(iconTheme, wInit, env, initial1, envC, e1, b1, gDot(arr(setter), pg._2));
      const w0 = boxWidgets(wInit, "Vertical", subOutput.gadgetView);
      const widget = w0.tag === "Just" ? w0.value : Gtk.toWidget(Gtk.labelNew("")); // Blank
      const label = Gtk.labelNew(title);
      wInit(label);
      Gtk.notebookAppendPageMenu(book, widget, label, noWidget);
      return subOutput;
    });

  const [appPageEvent, appH] = B.newEvent<number>(); // When the incoming Behavior triggers a page switch.
  const book = Gtk.new_(Gtk.Notebook, { margin: 5, scrollable: true, enablePopup: true });
  wInit(book);
  const outputs = tabs.map((t) => renderTab(book, t));
  Gtk.widgetShowAll(book);
  const mempty = (_n: number): void => {};
  goToPage(book, mempty, inputNumber(initial));
  // Use an IORef to block or enable signals according to where the change is coming from.
  const signalEnabled = newIORef(true);
  const blockSignalsIn = (act: () => void): void => {
    writeIORef(signalEnabled, false);
    act();
    writeIORef(signalEnabled, true);
  };
  const tabClicks = B.filterJust(registerIOSignal2(book, Gtk.afterNotebookSwitchPage, (_page: Gtk.Widget, n: number) => {
    const enabledFlag = readIORef(signalEnabled);
    return [null, enabledFlag ? Just(n) : Nothing] as const;
  }));
  const stop1 = reactimate1(B.mapE((x: GD) => () => goToPage(book, mempty, inputNumber(x)), e));
  // Propogates change event from book signal.
  const ch = B.changes(B.mapB((x: GD) => () => blockSignalsIn(() => goToPage(book, appH, inputNumber(x))), b));
  const stop2 = reactimate1_(ch);
  // Does not propogate change event for application behavior.
  Gtk.onWidgetDestroy(book, () => {
    stop1();
    stop2();
  });
  const initialOutput = clickValue(outputs, inputNumber(initial));
  const tabE = B.mapE((n: number) => clickValue(outputs, n), tabClicks);
  const appEvent = B.mapE((n: number) => clickValue(outputs, n), appPageEvent);
  const outE = B.switchE(B.mapE((o: Out) => o.gadgetUser, tabE), initialOutput.gadgetUser);
  const outB = B.switchB(initialOutput.gadgetValue, B.mapE((o: Out) => o.gadgetValue, appEvent));
  const w = Gtk.toWidget(book);
  return GadgetOut(
    [w],
    mconcatEvents(outputs.map((o) => o.gadgetEvents)),
    initialOutput.gadgetInitial,
    B.unionWith(constFirst, outE, B.observeE(B.mapE((o: Out) => () => B.valueB(o.gadgetValue), tabE))),
    outB,
  );
}

function renderGadget_Enabled(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  g: AnyGadget,
): Out {
  const result = renderGadget(iconTheme, wInit, env, gdFmap(fst, initial), envC, B.mapE(gdFmapF(fst), e), B.mapB(gdFmapF(fst), b), g);
  for (const w of result.gadgetView) {
    Gtk.widgetSetSensitive(w, initial._gdValue[1]);
    eventLink(w, Gtk.widgetSetSensitive, B.mapE((x: GD) => x._gdValue[1] as boolean, e));
    behaviorLink(w, Gtk.widgetSetSensitive, B.mapB((x: GD) => x._gdValue[1] as boolean, b));
  }
  return result;
}

/** The `Optional` cases, which special-case several inner gadgets before the general case. */
function renderGadget_Optional(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  d: any, inner: AnyGadget,
): Out {
  switch (inner.tag) {
    case "TextBox": {
      const p = inner._0;
      return renderGadget(iconTheme, wInit, env, initial, envC, e, b, TextBox((env1: any) => prismToMaybe(p(env1))));
    }
    case "DisplayText":
      return renderGadget(
        iconTheme, wInit, env, initial, envC, e, b,
        gDot(
          arr((t: T.Text): Maybe<T.Text> => (T.isNull(t) ? Nothing : Just(t))),
          gDot(DisplayText(), arr((m: Maybe<T.Text>) => fromMaybe("", m))),
        ),
      );
    case "MemoBox": {
      const outF = (txt: T.Text): Maybe<T.Text> => (txt === "" ? Nothing : Just(txt));
      return fmap_GadgetOut(
        outF,
        renderGadget(
          iconTheme,
          wInit,
          env,
          gdFmap((m: Maybe<T.Text>) => fromMaybe("", m), initial),
          envC,
          B.mapE(gdFmapF((m: Maybe<T.Text>) => fromMaybe("", m)), e),
          B.mapB(gdFmapF((m: Maybe<T.Text>) => fromMaybe("", m)), b),
          MemoBox(inner._0, inner._1),
        ),
      );
    }
    case "Combo": {
      const itemF = inner._0;
      const nothingItem = ComboItem<Maybe<any>>("", Nothing, Nothing, Nothing);
      return renderGadget(
        iconTheme, wInit, env, initial, envC, e, b,
        Combo((env1: any) => [nothingItem, ...itemF(env1).map((c) => fmap_ComboItem((v: any) => Just(v), c))]),
      );
    }
    case "TickBox":
      return renderGadget(
        iconTheme, wInit, env, initial, envC, e, b,
        Combo(() => [
          ComboItem<Maybe<boolean>>("", Nothing, Nothing, Nothing),
          ComboItem("Yes", Just("object-select-symbolic"), Nothing, Just(true)), // Green tick
          ComboItem("No", Just("list-remove-symbolic"), Nothing, Just(false)), // Red cross
        ]),
      );
    case "FixedText": {
      const textF = inner._0;
      const textF1 = (env1: any, m: Maybe<any>): T.Text => maybe("", (a: any) => textF(env1, a), m);
      switch (inner._1.tag) {
        case "Nothing":
          return renderGadget(iconTheme, wInit, env, initial, envC, e, b, FixedText(textF1, Nothing));
        case "Just": {
          const selector2 = promoteDialogSelector(d, _Just(), inner._1.value);
          return renderGadget(iconTheme, wInit, env, initial, envC, e, b, FixedText(textF1, Just(selector2)));
        }
        default:
          return absurd(inner._1);
      }
    }
    case "FixedMemo": {
      const textF = inner._2;
      const textF1 = (env1: any, m: Maybe<any>): T.Text => maybe("", (a: any) => textF(env1, a), m);
      switch (inner._3.tag) {
        case "Nothing":
          return renderGadget(iconTheme, wInit, env, initial, envC, e, b, FixedMemo(inner._0, inner._1, textF1, Nothing));
        case "Just": {
          const selector2 = promoteDialogSelector(d, _Just(), inner._3.value);
          return renderGadget(iconTheme, wInit, env, initial, envC, e, b, FixedMemo(inner._0, inner._1, textF1, Just(selector2)));
        }
        default:
          return absurd(inner._3);
      }
    }
    case "DateBox":
      return renderGadget_Optional_DateBox(wInit, initial, e, b, inner._0);
    case "IconBox":
      return renderGadget_Optional_IconBox(iconTheme, wInit, initial, e, b, inner._0);
    case "ColourBox":
      return renderGadget_Optional_ColourBox(wInit, initial, e, b);
    case "FilePathSelector": {
      const inFunc = (m: Maybe<string>): string => (m.tag === "Nothing" ? "" : m.value);
      const outFunc = (str: string): Maybe<string> => (str === "" ? Nothing : Just(str));
      return fmap_GadgetOut(
        outFunc,
        renderGadget(iconTheme, wInit, env, gdFmap(inFunc, initial), envC, B.mapE(gdFmapF(inFunc), e), B.mapB(gdFmapF(inFunc), b), inner),
      );
    }
    default:
      return renderGadget_Optional_general(iconTheme, wInit, env, initial, envC, e, b, d, inner);
  }
}

function renderGadget_Optional_DateBox(wInit: WInit, initial: GD, e1: B.Event<GD>, b1: B.Behavior<GD>, fmt: T.Text): Out {
  const prsm = datePrism(fmt);
  const [w, e2] = textBoxWithPopup(wInit, initial, e1, b1, prismToMaybe(prsm), (entry: Gtk.Entry) => {
    const [overlay, calendar] = createDatePopover(datePrism(fmt), entry);
    wInit(overlay);
    wInit(calendar);
    Gtk.onWidgetDestroy(entry, () => {
      Gtk.widgetDestroy(overlay);
      Gtk.widgetDestroy(calendar);
    });
    return registerIOSignal(calendar, Gtk.onCalendarDaySelectedDoubleClick, () => {
      const [year, month, day] = Gtk.calendarGetDate(calendar);
      Gtk.popoverPopdown(overlay);
      const date = fromGregorian(year, month + 1, day);
      return [null, review(datePrism(fmt), date)] as const;
    });
  });
  return GadgetOut([w], B.never(), initial, e2, b1);
}

function renderGadget_Optional_IconBox(
  iconTheme: Gtk.IconTheme, wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>, predicate: (t: T.Text) => boolean,
): Out {
  const updateIcon = (ref: IORef<Maybe<T.Text>>, pic: Gtk.Image, gd: GadgetData<Maybe<T.Text>>): void => {
    if (!gd._gdOk) return;
    const v = gd._gdValue;
    const oldName = readIORef(ref);
    if (notEquals(oldName, v)) {
      writeIORef(ref, v);
      const icon1 = safeLoadIcon(iconTheme, fromMaybe(noIconName, v), iconSize);
      Gtk.imageSetFromPixbuf(pic, toNull(icon1));
    }
  };
  const currentName = newIORef<Maybe<T.Text>>(initial._gdValue);
  const icon1 = safeLoadIcon(iconTheme, fromMaybe(noIconName, initial._gdValue as Maybe<T.Text>), iconSize);
  const pic = Gtk.imageNewFromPixbuf(toNull(icon1));
  Gtk.set(pic, { sensitive: true });
  const button = Gtk.new_(Gtk.Button, { image: pic, alwaysShowImage: true });
  wInit(pic);
  wInit(button);
  const stop1 = reactimate1(B.mapE((x: GD) => () => updateIcon(currentName, pic, x), e));
  const ch = B.changes(B.mapB((x: GD) => () => updateIcon(currentName, pic, x), b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(button, () => {
    stop1();
    stop2();
  });
  const [nameE, handler] = B.newEvent<GD>();
  Gtk.onButtonPressed(button, () => {
    const icons = withWaitCursor(button, () => iconThemeContents(iconTheme, false, predicate));
    iconDialog(pic, icons, (newIcon: T.Text) => {
      const newValue = newIcon === noIconName ? Nothing : Just(newIcon);
      Gtk.set(pic, { iconName: newIcon });
      handler(GadgetData(true, newValue));
    });
  });
  const w1 = Gtk.toWidget(button);
  return GadgetOut([w1], B.never(), initial, B.unionWith(constFirst, nameE, e), b);
}

function renderGadget_Optional_ColourBox(wInit: WInit, initial: GD, e1: B.Event<GD>, b1: B.Behavior<GD>): Out {
  const readVal = (entry: Gtk.Entry): Maybe<Maybe<Colour>> => {
    const t = Gtk.entryGetText(entry);
    const styleCtx = Gtk.widgetGetStyleContext(entry);
    const v = preview(prismToMaybe(colourPrism), t);
    switch (v.tag) {
      case "Nothing":
        Gtk.styleContextAddClass(styleCtx, "entry-error");
        return Nothing;
      case "Just":
        Gtk.styleContextRemoveClass(styleCtx, "entry-error");
        return Just(v.value);
      default:
        return absurd(v);
    }
  };
  const updateText = (w: Gtk.Entry, txt: T.Text): void => {
    const old = Gtk.getEntryText(w);
    if (old !== txt) Gtk.setEntryText(w, txt);
  };
  const setEntryValue = (w: Gtk.Entry, m: Maybe<Colour>): void => {
    if (m.tag === "Just") updateText(w, review(colourPrism, m.value));
    else updateText(w, "");
  };
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true });
  wInit(entry);
  Gtk.entrySetIconFromIconName(entry, Gtk.EntryIconPositionSecondary, "applications-science");
  const [w, e2] = makeField(entry, entryChangedSignal, setEntryValue, initial, e1, b1, () => readVal(entry));
  Gtk.onEntryIconPress(entry, () => {
    // Web: dialogRun returns a Promise, so the chooser is run asynchronously from the handler.
    void (async () => {
      const chooser = createColorDialog(entry);
      const r = await Gtk.dialogRun(chooser);
      switch (r) {
        case Gtk.ResponseTypeOk: {
          const colour = rgbaToColour(Gtk.colorChooserGetRgba(chooser));
          Gtk.setEntryText(entry, review(colourPrism, colour));
          Gtk.widgetGrabFocus(entry);
          break;
        }
        default:
          break;
      }
      Gtk.widgetDestroy(chooser);
    })();
  });
  widgetLinkColour(
    entry,
    initial._gdValue,
    B.mapE((x: GD) => x._gdValue as Maybe<Colour>, e2),
    B.mapB((x: GD) => x._gdValue as Maybe<Colour>, b1),
  );
  return GadgetOut([w], B.never(), initial, e2, b1);
}

function renderGadget_ImageDisplay(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>, sz: MemoBoxSize): Out {
  const [maxHeight, maxWidth]: [number, number] = (() => {
    switch (sz) {
      case "MemoSmall": return [100, 150];
      case "MemoMedium": return [200, 300];
      case "MemoLarge": return [400, 600];
      default: return absurd(sz);
    }
  })();
  // Web: images decode asynchronously, so the size check runs when the pixbuf has loaded. The
  // counter discards the results of superseded updates.
  let generation = 0;
  const updateImage = (w: Gtk.Image, gd: GadgetData<Maybe<Uint8Array>>): void => {
    if (!gd._gdOk) return;
    const generation1 = ++generation;
    if (gd._gdValue.tag === "Nothing") {
      Gtk.imageSetFromPixbuf(w, noPixbuf);
      return;
    }
    const bytes = gd._gdValue.value;
    // Web: a memory input stream is the byte array itself.
    const pix0 = Gdk.pixbufNewFromStream(bytes, imageMimeType(bytes));
    void Gdk.pixbufReady(pix0).then((pix1) => {
      if (generation1 !== generation || pix1.failed) return;
      const height = Gdk.pixbufGetHeight(pix1);
      const width = Gdk.pixbufGetWidth(pix1);
      if (height <= maxHeight && width <= maxWidth) Gtk.imageSetFromPixbuf(w, pix1);
      else {
        const scale = Math.min(maxHeight / height, maxWidth / width);
        const newWidth = round(width * scale);
        const newHeight = round(height * scale);
        const pix2 = Gdk.pixbufScaleSimple(pix1, newWidth, newHeight);
        Gtk.imageSetFromPixbuf(w, pix2); // No-op if out of memory. But that is unlikely.
      }
    });
  };
  const imgWidget = Gtk.imageNew();
  wInit(imgWidget);
  updateImage(imgWidget, initial);
  const stop1 = reactimate1(B.mapE((x: GD) => () => updateImage(imgWidget, x), e));
  const ch = B.changes(B.mapB((x: GD) => () => updateImage(imgWidget, x), b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(imgWidget, () => {
    stop1();
    stop2();
  });
  const w = Gtk.toWidget(imgWidget);
  return GadgetOut([w], B.never(), initial, e, b);
}

/** Web: the MIME type of image data, from its magic number (GdkPixbuf sniffs the format itself). */
function imageMimeType(bytes: Uint8Array): string {
  const starts = (...xs: number[]): boolean => xs.every((x, i) => bytes[i] === x);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0xff, 0xd8)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46)) return "image/gif";
  if (starts(0x42, 0x4d)) return "image/bmp";
  if (starts(0x52, 0x49, 0x46, 0x46)) return "image/webp";
  if (starts(0x3c)) return "image/svg+xml";
  return "image/png";
}

function renderGadget_Optional_general(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  d: any, g: AnyGadget,
): Out {
  // {-# SCC "renderGadget_Optional" #-}
  const updateButton = (button: Gtk.CheckButton, v: boolean): void => {
    const old = Gtk.toggleButtonGetActive(button);
    if (old !== v) Gtk.toggleButtonSetActive(button, v);
  };
  const outF = (enabled: boolean, gd: GD): GD => (enabled ? gdFmap(Just, gd) : GadgetData(true, Nothing));
  // The general case for Optional decorates the inner widget with a check button. If there
  // are no inner widgets then it just passes Nothing straight through.
  const fromMaybeD = (m: Maybe<any>): any => fromMaybe(d, m);
  const inner = renderGadget(iconTheme, wInit, env, gdFmap(fromMaybeD, initial), envC, B.mapE(gdFmapF(fromMaybeD), e), B.mapB(gdFmapF(fromMaybeD), b), g);
  const initialEnabled = isJust(initial._gdValue);
  const widgetM = boxWidgets(wInit, "Vertical", inner.gadgetView);
  if (widgetM.tag === "Nothing") return fmap_GadgetOut(Just, inner);
  const widget = widgetM.value;
  const button = Gtk.checkButtonNew();
  wInit(button);
  const boxWidget = Gtk.boxNew(Gtk.OrientationHorizontal, 0);
  wInit(boxWidget);
  Gtk.boxPackStart(boxWidget, button, false, false, 0);
  Gtk.boxPackStart(boxWidget, widget, true, true, 0);
  Gtk.toggleButtonSetActive(button, initialEnabled);
  const blockSignals = newIORef(false);
  const stop1 = reactimate1(B.mapE((x: GD) => () => updateButton(button, isJust(x._gdValue)), e));
  const ch = B.changes(B.mapB((v: GD) => () => {
    writeIORef(blockSignals, true);
    updateButton(button, isJust(v._gdValue));
    writeIORef(blockSignals, false);
  }, b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(button, () => {
    stop1();
    stop2();
  });
  const clicked = B.filterJust(registerIOSignal(button, Gtk.onToggleButtonToggled, () => {
    const blk = readIORef(blockSignals);
    if (blk) return [null, Nothing] as const;
    return [null, Just(Gtk.toggleButtonGetActive(button))] as const;
  }));
  Gtk.widgetSetSensitive(widget, initialEnabled);
  eventLink(widget, Gtk.widgetSetSensitive, clicked);
  const enabled1 = B.stepper(initialEnabled, clicked);
  const innerValue = B.stepper(inner.gadgetInitial, inner.gadgetUser);
  Gtk.widgetShowAll(boxWidget);
  const w = Gtk.toWidget(boxWidget);
  return GadgetOut(
    [w],
    inner.gadgetEvents,
    outF(initialEnabled, inner.gadgetInitial),
    B.unionWith(
      constFirst,
      B.apply(B.mapB((en: boolean) => (x: GD) => outF(en, x), enabled1), inner.gadgetUser),
      B.apply(B.mapB((x: GD) => (en: boolean) => outF(en, x), innerValue), clicked),
    ),
    B.liftA2B(outF, enabled1, inner.gadgetValue),
  );
}

function renderGadget_Intercept(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  dblFlag: boolean, selector: DialogSelector_<any, any, any>, g: AnyGadget,
): Out {
  // mdo
  const buttonIntercept = (handler: (u: null) => void) => (w: Gtk.Widget): void => {
    const w1 = Gtk.toWidget(w);
    wInit(w1);
    Gtk.onWidgetButtonPressEvent(w1, (ev: Gdk.EventButton) => {
      const t = Gdk.getEventButtonType(ev);
      const btn = Gdk.getEventButtonButton(ev);
      if (btn === 1 && ((!dblFlag && t === Gdk.EventTypeButtonPress) || (dblFlag && t === Gdk.EventType2buttonPress))) {
        handler(null);
        return true;
      }
      return false;
    });
  };
  const [activated, handler] = B.newEvent<null>();
  const rRef: B.Event<[null, Maybe<any>]> = B.lazyE(() => r);
  const inner = renderGadget(
    iconTheme,
    buttonIntercept(handler),
    env,
    initial,
    envC,
    B.unionWith(constFirst, e, B.mapE((v: any) => GadgetData(true, v), B.filterJust(B.mapE((p: [null, Maybe<any>]) => p[1], rRef)))),
    b,
    g,
  );
  const r: B.Event<[null, Maybe<any>]> = inner.gadgetView.length > 0
    ? mkGtkPopupSelect(inner.gadgetView[0], iconTheme, envC, selector, B.mapE((x: GD): readonly [null, any] => [null, x._gdValue], B.tag(b, activated)))
    : B.never();
  return inner;
}

function renderGadget_Icon(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  iconF: (i: any) => T.Text, g: AnyGadget,
): Out {
  const boxWidget = Gtk.boxNew(Gtk.OrientationHorizontal, 0);
  const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  wInit(boxWidget);
  const icon1 = safeLoadIcon(iconTheme, iconF(initial._gdValue), iconSize);
  // If not found display broken icon rather than nothing.
  const imageWidget = icon1.tag === "Just"
    ? Gtk.imageNewFromPixbuf(icon1.value)
    : Gtk.imageNewFromIconName(null, Gtk.IconSizeButton);
  Gtk.imageSetPixelSize(imageWidget, 16);
  wInit(imageWidget);
  Gtk.boxPackStart(boxWidget, imageWidget, false, false, 0);
  const innerWidget = boxWidgets(wInit, "Vertical", inner.gadgetView);
  if (innerWidget.tag === "Just") Gtk.boxPackStart(boxWidget, innerWidget.value, true, true, 0);
  eventLink(imageWidget, Gtk.setImageIconName, B.mapE((x: GD) => iconF(x._gdValue), e));
  behaviorLink(imageWidget, Gtk.setImageIconName, B.mapB((x: GD) => iconF(x._gdValue), b));
  const w = Gtk.toWidget(boxWidget);
  return { ...inner, gadgetView: [w] };
}

function renderGadget_Linked(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  linkF: (i: any) => Maybe<T.Text>, g: AnyGadget,
): Out {
  const setLink = (btn: Gtk.LinkButton, m: Maybe<T.Text>): void => {
    switch (m.tag) {
      case "Nothing":
        Gtk.linkButtonSetUri(btn, "");
        Gtk.widgetSetTooltipText(btn, null);
        Gtk.widgetSetSensitive(btn, false);
        return;
      case "Just":
        Gtk.linkButtonSetUri(btn, m.value);
        Gtk.widgetSetTooltipText(btn, m.value);
        Gtk.widgetSetSensitive(btn, true);
        return;
      default:
        return absurd(m);
    }
  };
  const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  const boxWidget = Gtk.boxNew(Gtk.OrientationHorizontal, 0);
  wInit(boxWidget);
  const button = Gtk.linkButtonNewWithLabel("", "");
  wInit(button);
  const img = Gtk.imageNewFromIconName("emblem-symbolic-link", Gtk.IconSizeButton);
  wInit(img);
  Gtk.buttonSetImage(button, img);
  Gtk.buttonSetAlwaysShowImage(button, true);
  Gtk.boxPackStart(boxWidget, button, false, false, 0);
  setLink(button, linkF(initial._gdValue));
  eventLink(button, setLink, B.mapE((x: GD) => linkF(x._gdValue), e));
  behaviorLink(button, setLink, B.mapB((x: GD) => linkF(x._gdValue), b));
  const innerWidget = boxWidgets(wInit, "Vertical", inner.gadgetView);
  if (innerWidget.tag === "Just") Gtk.boxPackStart(boxWidget, innerWidget.value, true, true, 0);
  const w = Gtk.toWidget(boxWidget);
  return { ...inner, gadgetView: [w] };
}

function renderGadget_Styled(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  textF: (i: any) => Maybe<T.Text>, g: AnyGadget,
): Out {
  const updateStyle = (currentStyle: IORef<Maybe<T.Text>>, ctxs: readonly Gtk.StyleContext[], newStyle: Maybe<T.Text>): void => {
    const oldStyle = readIORef(currentStyle);
    if (notEquals(oldStyle, newStyle)) {
      if (oldStyle.tag === "Just") for (const c of ctxs) Gtk.styleContextRemoveClass(c, oldStyle.value);
      writeIORef(currentStyle, newStyle);
      if (newStyle.tag === "Just") for (const c of ctxs) Gtk.styleContextAddClass(c, newStyle.value);
    }
  };
  const inner = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  if (inner.gadgetView.length > 0) {
    const w = inner.gadgetView[0];
    const currentStyle = newIORef<Maybe<T.Text>>(Nothing);
    const ctxs = inner.gadgetView.map(Gtk.widgetGetStyleContext);
    updateStyle(currentStyle, ctxs, textF(initial._gdValue));
    const stop1 = reactimate1(B.mapE((x: GD) => () => updateStyle(currentStyle, ctxs, textF(x._gdValue)), e));
    const ch = B.changes(B.mapB((x: GD) => () => updateStyle(currentStyle, ctxs, textF(x._gdValue)), b));
    const stop2 = reactimate1_(ch);
    Gtk.onWidgetDestroy(w, () => {
      stop1();
      stop2();
    });
  }
  return inner;
}

function renderGadget_Form(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  orient: Orientation, items: readonly (readonly [T.Text, AnyGadget])[],
): Out {
  const renderLabelledGadget = ([txt, g]: readonly [T.Text, AnyGadget]): [Gtk.Widget, Maybe<Gtk.Widget>, Out] => {
    const label = Gtk.labelNew(txt);
    wInit(label);
    switch (orient) {
      case "Vertical":
        Gtk.set(label, { halign: Gtk.AlignEnd, valign: Gtk.AlignCenter });
        break;
      case "Horizontal":
        Gtk.set(label, { halign: Gtk.AlignStart, valign: Gtk.AlignCenter });
        break;
      default:
        absurd(orient);
    }
    const result = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
    const w1 = Gtk.toWidget(label);
    const w2 = boxWidgets(wInit, "Vertical", result.gadgetView);
    return [w1, w2, result];
  };
  const tableWidget = Gtk.new_(Gtk.Grid, { rowSpacing: 3, columnSpacing: 3 });
  wInit(tableWidget);
  const addWidgets = (row: number, [w1, w2, v]: [Gtk.Widget, Maybe<Gtk.Widget>, Out]): Out => {
    if (w2.tag === "Nothing") return v;
    switch (orient) {
      case "Vertical":
        Gtk.gridAttach(tableWidget, w1, 0, row, 1, 1);
        Gtk.gridAttach(tableWidget, w2.value, 1, row, 1, 1);
        break;
      case "Horizontal":
        Gtk.gridAttach(tableWidget, w1, row, 0, 1, 1);
        Gtk.gridAttach(tableWidget, w2.value, row, 1, 1, 1);
        break;
      default:
        absurd(orient);
    }
    return v;
  };
  const widgetPairs = items.map(renderLabelledGadget);
  const results = widgetPairs.map((p, row) => addWidgets(row, p));
  const w = Gtk.toWidget(tableWidget);
  return { ...mergeOutputs(results), gadgetView: [w] };
}

function renderGadget_TabForm(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  tabs: readonly (readonly [T.Text, AnyGadget])[],
): Out {
  const addGadget = (book: Gtk.Notebook, [l, g]: readonly [T.Text, AnyGadget]): Out => {
    const result = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
    const w0 = boxWidgets(wInit, "Vertical", result.gadgetView);
    const widget = w0.tag === "Just" ? w0.value : Gtk.toWidget(Gtk.labelNew("")); // Blank
    const lbl = Gtk.labelNew(l);
    wInit(lbl);
    Gtk.notebookAppendPageMenu(book, widget, lbl, noWidget);
    return result;
  };
  const book = Gtk.new_(Gtk.Notebook, { margin: 5, scrollable: true, enablePopup: true });
  wInit(book);
  const results = tabs.map((t) => addGadget(book, t));
  Gtk.widgetShowAll(book);
  Gtk.notebookSetCurrentPage(book, 0);
  const w = Gtk.toWidget(book);
  return { ...mergeOutputs(results), gadgetView: [w] };
}

function renderGadget_Box(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  orient: Orientation, gss: readonly (readonly AnyGadget[])[],
): Out {
  const [boxWidget, addSep] = ((): [Gtk.Box, () => void] => {
    switch (orient) {
      case "Vertical": {
        const boxWidget1 = Gtk.new_(Gtk.Box, { orientation: Gtk.OrientationVertical, spacing: 5 });
        wInit(boxWidget1);
        const addSep1 = (): void => {
          const sep = Gtk.separatorNew(Gtk.OrientationHorizontal);
          Gtk.boxPackStart(boxWidget1, sep, false, false, 0);
        };
        return [boxWidget1, addSep1];
      }
      case "Horizontal": {
        const boxWidget1 = Gtk.new_(Gtk.Box, { orientation: Gtk.OrientationHorizontal, spacing: 5 });
        wInit(boxWidget1);
        const addSep1 = (): void => {
          const sep = Gtk.separatorNew(Gtk.OrientationVertical);
          Gtk.boxPackStart(boxWidget1, sep, false, false, 0);
        };
        return [boxWidget1, addSep1];
      }
      default:
        return absurd(orient);
    }
  })();
  const outputss = gss.map((gs) => gs.map((g) => renderGadget(iconTheme, wInit, env, initial, envC, e, b, g)));
  const widgetss = outputss.map((os) => os.flatMap((o) => o.gadgetView)).filter((ws) => ws.length > 0); // List of groups
  const addGroup = (ws: readonly Gtk.Widget[]): void => {
    for (const w of ws) Gtk.boxPackStart(boxWidget, w, true, true, 0);
  };
  const output = mergeOutputs(L.concat(outputss));
  for (const act of L.intersperse(addSep, widgetss.map((ws) => () => addGroup(ws)))) act();
  const w = Gtk.toWidget(boxWidget);
  return { ...output, gadgetView: [w] };
}

function renderGadget_Grid(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  colH: readonly T.Text[], rowH: readonly T.Text[], rows: readonly (readonly AnyGadget[])[],
): Out {
  const gridWidget = Gtk.new_(Gtk.Grid, { orientation: Gtk.OrientationHorizontal, columnSpacing: 1 });
  wInit(gridWidget);
  colH.forEach((txt, i) => {
    const lbl = Gtk.labelNew(txt);
    Gtk.gridAttach(gridWidget, lbl, i + 1, 0, 1, 1);
  });
  rowH.forEach((txt, i) => {
    const lbl = Gtk.labelNew(txt);
    Gtk.gridAttach(gridWidget, lbl, 0, i + 1, 1, 1);
  });
  const evs = rows.map((row, r) => row.map((cell, c) => {
    const rowNum = r + 1, colNum = c + 1;
    const cellOut = renderGadget(iconTheme, wInit, env, initial, envC, e, b, cell);
    const cellWidget = boxWidgets(wInit, "Vertical", cellOut.gadgetView);
    if (cellWidget.tag === "Just") Gtk.gridAttach(gridWidget, cellWidget.value, colNum, rowNum, 1, 1);
    return cellOut;
  }));
  const w = Gtk.toWidget(gridWidget);
  return { ...mergeOutputs(L.concat(evs)), gadgetView: [w] };
}

function renderGadget_Validate(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  predicate: (e: any, i: any, o: any) => boolean, g: AnyGadget,
): Out {
  const validated = (env1: any, v1: GD, gd: GD): GD => GadgetData(gd._gdOk && predicate(env1, v1._gdValue, gd._gdValue), gd._gdValue);
  const showValid1 = (style: Gtk.StyleContext, ok: boolean): void => {
    if (ok) Gtk.styleContextRemoveClass(style, "entry-error");
    else Gtk.styleContextAddClass(style, "entry-error");
  };
  const showValid = (current: IORef<boolean>, style: Gtk.StyleContext, nw: boolean): void => {
    const c = readIORef(current);
    if (c !== nw) {
      showValid1(style, nw);
      writeIORef(current, nw);
    }
  };
  const result = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  const currentState = newIORef(true);
  const validInitial = lazyValue(() => validated(env, initial, result.gadgetInitial)._gdOk);
  const validE = B.apply(B.liftA2B((env1: any, v1: GD) => (gd: GD) => validated(env1, v1, gd), envC.changesB, b), result.gadgetUser);
  const validB = B.liftA3B(validated, envC.changesB, b, result.gadgetValue);
  for (const widget of result.gadgetView) {
    const style = Gtk.widgetGetStyleContext(widget);
    showValid(currentState, style, validInitial());
    const stop1 = reactimate1(B.mapE((x: GD) => () => showValid(currentState, style, x._gdOk), validE));
    const ch = B.changes(B.mapB((x: GD) => () => showValid(currentState, style, x._gdOk), validB));
    const stop2 = reactimate1_(ch);
    Gtk.onWidgetDestroy(widget, () => {
      stop1();
      stop2();
    });
  }
  return {
    ...result,
    gadgetInitial: gdOverOk((ok) => ok && validInitial(), result.gadgetInitial),
    gadgetUser: validE,
    gadgetValue: validB,
  };
}

function renderGadget_ValidateText(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  messageF: (e: any, i: any, o: any) => Maybe<T.Text>, g: AnyGadget,
): Out {
  const showValid = (style: Gtk.StyleContext, ok: boolean): void => {
    if (ok) Gtk.styleContextRemoveClass(style, "entry-error");
    else Gtk.styleContextAddClass(style, "entry-error");
  };
  const updateMessage = (style: Gtk.StyleContext, msg: Gtk.Label, m: Maybe<T.Text>): void => {
    switch (m.tag) {
      case "Just":
        showValid(style, false);
        Gtk.labelSetLabel(msg, m.value);
        Gtk.widgetShow(msg);
        return;
      case "Nothing":
        showValid(style, true);
        Gtk.labelSetLabel(msg, "");
        Gtk.widgetHide(msg);
        return;
      default:
        return absurd(m);
    }
  };
  const messageF1 = (env1: any, v1: GD, v2: GD): Maybe<T.Text> => messageF(env1, v1._gdValue, v2._gdValue);
  const validF = (env1: any, v1: GD, gd: GD): GD =>
    GadgetData(gd._gdOk && isNothing(messageF(env1, v1._gdValue, gd._gdValue)), gd._gdValue);
  const result = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  const appWidget = boxWidgets(wInit, "Vertical", result.gadgetView);
  if (appWidget.tag === "Nothing") return result;
  const boxWidget = Gtk.boxNew(Gtk.OrientationVertical, 3);
  wInit(boxWidget);
  const initialErr = messageF1(env, initial, result.gadgetInitial);
  const updateE = B.apply(B.liftA2B((env1: any, v1: GD) => (v2: GD) => messageF1(env1, v1, v2), envC.changesB, b), result.gadgetUser);
  const updateB = B.liftA3B(messageF1, envC.changesB, b, result.gadgetValue);
  const initialValid = validF(env, initial, result.gadgetInitial)._gdOk;
  const validE = B.apply(B.liftA2B((env1: any, v1: GD) => (gd: GD) => validF(env1, v1, gd), envC.changesB, b), result.gadgetUser);
  const validB = B.liftA3B(validF, envC.changesB, b, result.gadgetValue);
  const msg = Gtk.labelNew(toNull(initialErr));
  wInit(msg);
  const style = Gtk.widgetGetStyleContext(msg);
  Gtk.boxPackStart(boxWidget, appWidget.value, true, true, 0);
  Gtk.boxPackStart(boxWidget, msg, false, false, 0);
  showValid(style, isNothing(initialErr));
  Gtk.widgetSetVisible(msg, isJust(initialErr));
  const stop1 = reactimate1(B.mapE((m: Maybe<T.Text>) => () => updateMessage(style, msg, m), updateE));
  const ch = B.changes(B.mapB((m: Maybe<T.Text>) => () => updateMessage(style, msg, m), updateB));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(msg, () => {
    stop1();
    stop2();
  });
  const w = Gtk.toWidget(boxWidget);
  return {
    ...result,
    gadgetView: [w],
    gadgetInitial: gdOverOk((ok) => ok && initialValid, result.gadgetInitial),
    gadgetUser: validE,
    gadgetValue: validB,
  };
}

function renderGadget_TextBox(
  wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  prsmF: (e: any) => Prism<T.Text, any>,
): Out {
  // Update only if text has changed. Do not overwrite leading or trailing spaces in the widget.
  // Do not overwrite if the widget has focus, as this implies that the user is trying to type.
  const updateEntry = (w: Gtk.Entry, newTxt: T.Text): void => {
    const userEdit = Gtk.getWidgetHasFocus(w);
    if (!userEdit) {
      // Don't fight with the user about the text they are typing.
      const oldTxt = Gtk.entryGetText(w);
      if (T.strip(oldTxt) !== T.strip(newTxt)) Gtk.setEntryText(w, newTxt);
    }
  };
  const currentPrism = newIORef(prsmF(env));
  const initialText = gdFmap((v: any) => review(prsmF(env), v), initial);
  const width = Math.min(20, Math.max(5, T.length(initialText._gdValue)));
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true, widthChars: width });
  const stop = reactimate1(B.mapE((env1: any) => () => writeIORef(currentPrism, prsmF(env1)), envC.changesE));
  Gtk.onWidgetDestroy(entry, stop);
  wInit(entry);
  const styleCtx = Gtk.widgetGetStyleContext(entry);
  const toText = (env1: any) => (x: GD): GadgetData<T.Text> => gdFmap((v: any) => review(prsmF(env1), v), x);
  const [w, resultE] = makeField(
    entry,
    entryChangedSignal,
    updateEntry,
    initialText,
    B.apply(B.mapB(toText, envC.changesB), e),
    B.applyB(B.mapB(toText, envC.changesB), b),
    () => {
      const p = readIORef(currentPrism);
      const t = Gtk.entryGetText(entry);
      const v = preview(p, t);
      switch (v.tag) {
        case "Nothing":
          Gtk.styleContextAddClass(styleCtx, "entry-error");
          return Nothing;
        case "Just":
          Gtk.styleContextRemoveClass(styleCtx, "entry-error");
          return Just(v.value);
        default:
          return absurd(v);
      }
    },
  );
  const resultE1 = B.unionWith(constFirst, resultE, e);
  return GadgetOut([w], B.never(), initial, resultE1, b);
}

function renderGadget_DisplayText(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>): Out {
  const updateWidgets = (label: Gtk.Label) => (entry: Gtk.Entry, txt: T.Text): void => {
    const oldText = Gtk.labelGetLabel(label);
    if (txt !== oldText) {
      Gtk.set(label, { label: txt });
      Gtk.set(entry, { text: txt });
    }
  };
  const popupField = (pop: Gtk.Popover, entry: Gtk.Entry, txt: T.Text): void => {
    Gtk.entrySetText(entry, txt);
    Gtk.popoverPopup(pop);
  };
  // Construct label in a button.
  const label = Gtk.new_(Gtk.Label, {
    label: initial._gdValue,
    wrap: true,
    halign: Gtk.AlignFill,
    xalign: 0,
    selectable: true,
  });
  const btn = Gtk.new_(Gtk.Button, { halign: Gtk.AlignFill, relief: Gtk.ReliefStyleNone });
  Gtk.containerAdd(btn, label);
  const frame1 = Gtk.frameNew(null);
  Gtk.containerAdd(frame1, btn);
  // Configure internal behavior.
  const pop = Gtk.popoverNew(btn);
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true, widthChars: 40 });
  Gtk.onEntryActivate(entry, () => Gtk.popoverPopdown(pop));
  const clickE = registerIOSignal(btn, Gtk.onButtonClicked, () => [null, null] as const);
  const stop1 = reactimate1(B.mapE((txt: T.Text) => () => popupField(pop, entry, txt), B.tag(B.mapB((x: GD) => x._gdValue as T.Text, b), clickE)));
  Gtk.onWidgetDestroy(btn, () => {
    // Popover and its entry are not destroyed by default.
    stop1();
    Gtk.widgetDestroy(pop);
    Gtk.widgetDestroy(entry);
  });
  Gtk.containerAdd(pop, entry);
  Gtk.widgetShowAll(entry);
  wInit(label);
  wInit(btn);
  wInit(pop);
  wInit(entry);
  const [, resultE] = makeField(entry, Gtk.onEntryActivate, updateWidgets(label), initial, e, b, () => Just(Gtk.entryGetText(entry)));
  const w = Gtk.toWidget(frame1);
  return GadgetOut([w], B.never(), initial, resultE, b);
}

function renderGadget_MemoBox(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>, size: MemoBoxSize, vExpand: boolean): Out {
  const updateBuffer = (buf: Gtk.TextBuffer, gd: GadgetData<T.Text>): void => {
    if (!gd._gdOk) return;
    const v = gd._gdValue;
    const old = Gtk.getTextBufferText(buf);
    if (v !== old) Gtk.setTextBufferText(buf, v);
  };
  const scroll = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  wInit(scroll);
  const style1 = Gtk.widgetGetStyleContext(scroll);
  Gtk.styleContextAddClass(style1, memoBoxCss(size));
  Gtk.set(scroll, {
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
    hexpand: true,
    vexpand: vExpand,
  });
  Gtk.setScrolledWindowShadowType(scroll, Gtk.ShadowTypeIn);
  const vw = Gtk.textViewNew();
  wInit(vw);
  Gtk.set(vw, {
    hexpand: true,
    vexpand: vExpand,
    wrapMode: Gtk.WrapModeWord,
    inputHints: [Gtk.InputHintsSpellcheck],
  });
  Gtk.textViewSetWrapMode(vw, Gtk.WrapModeWord);
  Gtk.containerAdd(scroll, vw);
  const buffer = Gtk.textViewGetBuffer(vw);
  Gtk.setTextBufferText(buffer, initial._gdValue);
  const blockSignals = newIORef(false);
  const stop1 = reactimate1(B.mapE((x: GD) => () => updateBuffer(buffer, x), e));
  const ch = B.changes(B.mapB((v: GD) => () => {
    writeIORef(blockSignals, true);
    updateBuffer(buffer, v);
    writeIORef(blockSignals, false);
  }, b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
  });
  Gtk.widgetQueueResize(vw);
  const textEdits = B.filterJust(registerIOSignal(buffer, Gtk.onTextBufferEndUserAction, () => {
    const bFlag = readIORef(blockSignals);
    if (bFlag) return [null, Nothing] as const;
    const newText = Gtk.getTextBufferText(buffer);
    return [null, Just(GadgetData(true, newText))] as const;
  }));
  const w = Gtk.toWidget(scroll);
  return GadgetOut([w], B.never(), initial, textEdits, b);
}

function renderGadget_DisplayMemo(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>): Out {
  const updateWidgets = (label: Gtk.Label, buffer: Gtk.TextBuffer) => (_w: Gtk.Button, txt: T.Text): void => {
    const oldText = Gtk.labelGetLabel(label);
    if (txt !== oldText) {
      Gtk.set(label, { label: txt });
      Gtk.set(buffer, { text: txt });
    }
  };
  const popupField = (pop: Gtk.Popover, buf: Gtk.TextBuffer, txt: T.Text): void => {
    Gtk.textBufferSetText(buf, txt, -1);
    Gtk.popoverPopup(pop);
  };
  // Construct label in a button.
  const label = Gtk.new_(Gtk.Label, {
    label: initial._gdValue,
    wrap: true,
    halign: Gtk.AlignFill,
    xalign: 0,
    selectable: true,
  });
  const btn = Gtk.new_(Gtk.Button, { halign: Gtk.AlignFill, relief: Gtk.ReliefStyleNone });
  Gtk.containerAdd(btn, label);
  const frame1 = Gtk.frameNew(null);
  Gtk.containerAdd(frame1, btn);
  // Configure internal behavior.
  const pop = Gtk.popoverNew(btn);
  const popBox = Gtk.boxNew(Gtk.OrientationVertical, 1);
  const popButton = Gtk.buttonNewWithLabel("Ok");
  const entry = Gtk.textViewNew();
  Gtk.set(entry, {
    hexpand: true,
    wrapMode: Gtk.WrapModeWord,
    inputHints: [Gtk.InputHintsSpellcheck],
  });
  Gtk.textViewSetWrapMode(entry, Gtk.WrapModeWord);
  const scroll = Gtk.scrolledWindowNew(null, null);
  Gtk.containerAdd(scroll, entry);
  Gtk.styleContextAddClass(Gtk.widgetGetStyleContext(scroll), "memo-large");
  Gtk.boxPackStart(popBox, scroll, true, true, 0);
  Gtk.boxPackStart(popBox, popButton, false, false, 0);
  Gtk.widgetShowAll(popBox);
  const buffer = Gtk.textViewGetBuffer(entry);
  Gtk.setTextBufferText(buffer, initial._gdValue);
  const clickE = registerIOSignal(btn, Gtk.onButtonClicked, () => [null, null] as const);
  const stop1 = reactimate1(B.mapE((txt: T.Text) => () => popupField(pop, buffer, txt), B.tag(B.mapB((x: GD) => x._gdValue as T.Text, b), clickE)));
  Gtk.onWidgetDestroy(btn, () => {
    // Popover and its entry are not destroyed by default.
    stop1();
    Gtk.widgetDestroy(pop);
    Gtk.widgetDestroy(entry);
    Gtk.widgetDestroy(popButton);
    Gtk.widgetDestroy(popBox);
  });
  Gtk.containerAdd(pop, popBox);
  Gtk.widgetShowAll(entry);
  wInit(label);
  wInit(btn);
  wInit(pop);
  wInit(popBox);
  wInit(popButton);
  wInit(entry);
  const [, resultE] = makeField(popButton, Gtk.onButtonClicked, updateWidgets(label, buffer), initial, e, b, () => {
    Gtk.popoverPopdown(pop);
    return Just(Gtk.getTextBufferText(buffer));
  });
  const w = Gtk.toWidget(frame1);
  return GadgetOut([w], B.never(), initial, resultE, b);
}

/** A row of the combo box store: name, icon name, CSS colour, white text flag and value. */
type ComboRow = readonly [T.Text, T.Text, T.Text, boolean, any];

function renderGadget_Combo(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>,
  entriesF: (e: any) => readonly ComboItem<any>[],
): Out {
  const toRGBA = (c: Colour): T.Text => {
    const { channelRed: r, channelGreen: g, channelBlue: b1 } = C.toSRGB24(getColour(c));
    return T.pack("rgba(" + String(r) + "," + String(g) + "," + String(b1) + ",1)");
  };
  const toTextRGB = (c: Colour): boolean => C.luminance(getColour(c)) < 0.5;
  const makeEntries = (env1: any): ComboRow[] =>
    entriesF(env1).map((ci): ComboRow => [
      ci.menuItemLabel,
      fromMaybe(blankIconName, ci.menuItemIcon),
      maybe("", toRGBA, ci.menuItemColour),
      maybe(true, toTextRGB, ci.menuItemColour),
      ci.menuItemValue,
    ]);
  const setContents = (store1: Gtk.SeqStore<ComboRow>, env1: any): void => {
    Gtk.seqStoreClear(store1);
    for (const i of makeEntries(env1)) Gtk.seqStoreAppend(store1, i);
  };
  const store = Gtk.seqStoreNew<ComboRow>(makeEntries(env));
  Gtk.customStoreSetColumn(store, Gtk.makeColumnIdString(0), (r: ComboRow) => r[0]); // Item name
  Gtk.customStoreSetColumn(store, Gtk.makeColumnIdString(1), (r: ComboRow) => r[1]); // Icon name
  Gtk.customStoreSetColumn(store, Gtk.makeColumnIdString(2), (r: ComboRow) => r[2]); // Colour in CSS format.
  Gtk.customStoreSetColumn(store, Gtk.makeColumnIdBool(3), (r: ComboRow) => r[3]); // True for white
  const menuWidget = Gtk.comboBoxNewWithModel(store);
  // Kludge to stop combo boxes responding to scroll events.
  Gtk.onWidgetScrollEvent(menuWidget, () => true);
  // End kludge
  setContents(store, env);
  wInit(menuWidget);
  const menuText = Gtk.cellRendererTextNew();
  const menuIcon = Gtk.cellRendererPixbufNew();
  if (entriesF(env).some((x) => isJust(x.menuItemIcon))) {
    Gtk.cellLayoutPackStart(menuWidget, menuIcon, false);
    Gtk.mvCellLayoutSetDataFunction(menuWidget, menuIcon, store, (i: ComboRow) => {
      const pb = safeLoadIcon(iconTheme, i[1], iconSize);
      if (pb.tag === "Just") Gtk.set(menuIcon, { pixbuf: pb.value });
      else Gtk.set(menuIcon, { iconName: "" });
    });
  }
  Gtk.cellLayoutPackStart(menuWidget, menuText, true);
  Gtk.mvCellLayoutSetDataFunction(menuWidget, menuText, store, ([nm, , clr, fg]: ComboRow) => {
    if (clr !== "") {
      Gtk.set(menuText, {
        background: clr,
        foreground: fg ? "white" : "black",
      });
    } else {
      Gtk.clearCellRendererTextForeground(menuText);
      Gtk.clearCellRendererTextBackground(menuText);
    }
    Gtk.set(menuText, { text: nm });
  });
  const displayVal = (v: any): number => {
    const entries = Gtk.seqStoreToList(store);
    return fromMaybe(-1, L.elemIndex(v, entries.map((r) => r[4])));
  };
  const [w, resultE] = makeField(
    menuWidget,
    Gtk.onComboBoxChanged,
    (w1: Gtk.ComboBox, v: any) => {
      const sel = Gtk.comboBoxGetActive(menuWidget);
      const n = displayVal(v);
      if (n !== sel) Gtk.comboBoxSetActive(w1, displayVal(v));
    },
    initial,
    e,
    b,
    () => {
      const sel = Gtk.comboBoxGetActive(menuWidget);
      const entries = Gtk.seqStoreToList(store);
      const limit = entries.length;
      return sel >= 0 && sel < limit ? Just(entries[sel][4]) : Nothing;
    },
  );
  return GadgetOut([w], B.never(), initial, resultE, b);
}

function renderGadget_Radio(
  wInit: WInit, env: any, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>,
  f: (e: any) => readonly (readonly [T.Text, any])[],
): Out {
  const setButtons = (btns: readonly Gtk.RadioButton[], vals: readonly any[], gd: GD): void => {
    if (!gd._gdOk) return;
    L.zipWith((btn: Gtk.RadioButton, btnVal: any) => Gtk.toggleButtonSetActive(btn, equals(btnVal, gd._gdValue)), btns, vals);
  };
  const mkButton = (blocker: IORef<boolean>, [txt, v]: readonly [T.Text, any]): [Gtk.RadioButton, B.Event<GD>] => {
    const btn = Gtk.radioButtonNewWithLabel([], txt);
    wInit(btn);
    Gtk.toggleButtonSetActive(btn, equals(v, initial._gdValue));
    const usr = registerIOSignal(btn, Gtk.onToggleButtonToggled, () => {
      const blocked = readIORef(blocker);
      if (blocked) return [null, Nothing] as const;
      const r = Gtk.toggleButtonGetActive(btn);
      return r ? [null, Just(GadgetData(true, v))] as const : [null, Nothing] as const;
    });
    return [btn, B.filterJust(usr)];
  };
  const items = f(env);
  const blocker = newIORef(false);
  const [buttons, clicks] = L.unzip(items.map((it) => mkButton(blocker, it)));
  const setGroup = (gd: GD): void => setButtons(buttons, items.map((it) => it[1]), gd);
  const stop1 = reactimate1(B.mapE((x: GD) => () => setGroup(x), e));
  const ch = B.changes(B.mapB((v: GD) => () => {
    writeIORef(blocker, true);
    setGroup(v);
    writeIORef(blocker, false);
  }, b));
  const stop2 = reactimate1_(ch);
  if (buttons.length > 0) {
    const [b1, ...bs] = buttons;
    for (const btn of bs) Gtk.radioButtonJoinGroup(btn, b1);
    Gtk.onWidgetDestroy(b1, () => {
      stop1();
      stop2();
    });
  }
  const widgets = buttons.map(Gtk.toWidget);
  return GadgetOut(widgets, B.never(), initial, L.foldr((c: B.Event<GD>, acc: B.Event<GD>) => B.unionWith(constFirst, c, acc), B.never<GD>(), clicks), b);
}

function renderGadget_TickBox(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>): Out {
  const updateToggle = (btn: Gtk.CheckButton, v: boolean): void => {
    const old = Gtk.toggleButtonGetActive(btn);
    if (old !== v) Gtk.toggleButtonSetActive(btn, v);
  };
  const button = Gtk.checkButtonNew();
  wInit(button);
  const [w, resultE] = makeField(button, Gtk.afterToggleButtonToggled, updateToggle, initial, e, b, () =>
    Just(Gtk.toggleButtonGetActive(button)));
  return GadgetOut([w], B.never(), initial, resultE, b);
}

function renderGadget_Message(
  wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  textF: (e: any, a: any) => T.Text,
): Out {
  const label = Gtk.labelNew(textF(env, initial._gdValue));
  wInit(label);
  const update = (env1: any, gd: GD): void => {
    if (!gd._gdOk) return;
    const old = Gtk.labelGetText(label);
    const nw = textF(env1, gd._gdValue);
    if (old !== nw) Gtk.labelSetText(label, nw);
  };
  const stop1 = reactimate1(B.apply(B.mapB((env1: any) => (x: GD) => () => update(env1, x), envC.changesB), e));
  const ch = B.changes(B.liftA2B((env1: any, x: GD) => () => update(env1, x), envC.changesB, b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(label, () => {
    stop1();
    stop2();
  });
  const w = Gtk.toWidget(label);
  return GadgetOut([w], B.never(), initial, e, b);
}

function renderGadget_FixedText(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  displayF: (e: any, a: any) => T.Text, nested: Maybe<DialogSelector_<any, any, any>>,
): Out {
  const initText = displayF(env, initial._gdValue);
  const width = Math.min(20, Math.max(5, T.length(initText)));
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true, widthChars: width });
  wInit(entry);
  Gtk.setEntryText(entry, initText);
  Gtk.setEntryEditable(entry, false);
  const editedValue: B.Event<GD> = ((): B.Event<GD> => {
    if (nested.tag === "Nothing") return B.never();
    const selector = nested.value;
    // We can assume that the Entry widget already sets the ButtonPressMask for its window.
    const activated = registerIOSignal1(entry, Gtk.onWidgetButtonPressEvent, (ev: Gdk.EventButton) => {
      const t = Gdk.getEventButtonType(ev);
      const btn = Gdk.getEventButtonButton(ev);
      return btn === 1 && t === Gdk.EventType2buttonPress ? [true, Just(null)] as const : [false, Nothing] as const;
    });
    const popup = mkGtkPopupSelect(
      entry,
      iconTheme,
      envC,
      selector,
      B.mapE((x: GD): readonly [null, any] => [null, x._gdValue], B.tag(b, B.filterJust(activated))),
    );
    return B.mapE((v: any) => GadgetData(true, v), B.filterJust(B.mapE((p: [null, Maybe<any>]) => p[1], popup)));
  })();
  const allEvents = B.unionWith(constFirst, editedValue, e);
  const update = (w: Gtk.Entry, [env1, gd]: readonly [any, GD]): void => {
    if (gd._gdOk) Gtk.setEntryText(w, displayF(env1, gd._gdValue));
  };
  eventLink(entry, update, B.apply(B.mapB((env1: any) => (x: GD): readonly [any, GD] => [env1, x], envC.changesB), allEvents));
  behaviorLink(entry, update, B.liftA2B((env1: any, x: GD): readonly [any, GD] => [env1, x], envC.changesB, b));
  const w = Gtk.toWidget(entry);
  return GadgetOut([w], B.never(), initial, editedValue, b);
}

function renderGadget_FixedMemo(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  size: MemoBoxSize, vExpand: boolean, displayF: (e: any, a: any) => T.Text, nested: Maybe<DialogSelector_<any, any, any>>,
): Out {
  const scroll = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  wInit(scroll);
  const style = Gtk.widgetGetStyleContext(scroll);
  Gtk.styleContextAddClass(style, memoBoxCss(size));
  Gtk.set(scroll, {
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
  });
  Gtk.setScrolledWindowShadowType(scroll, Gtk.ShadowTypeIn);
  const vw = Gtk.new_(Gtk.TextView, {
    hexpand: true,
    vexpand: vExpand,
    wrapMode: Gtk.WrapModeWord,
    editable: false,
  });
  wInit(vw);
  Gtk.containerAdd(scroll, vw);
  const buffer = Gtk.textViewGetBuffer(vw);
  const updateBuffer = (env1: any, gd: GD): void => {
    if (!gd._gdOk) return;
    const txt = displayF(env1, gd._gdValue);
    const old = Gtk.getTextBufferText(buffer);
    if (old !== txt) Gtk.textBufferSetText(buffer, txt, -1);
  };
  Gtk.textBufferSetText(buffer, displayF(env, initial._gdValue), -1);
  const editedValue: B.Event<GD> = ((): B.Event<GD> => {
    if (nested.tag === "Nothing") return B.never();
    const selector = nested.value;
    const activated = registerIOSignal1(vw, Gtk.onWidgetButtonPressEvent, (ev: Gdk.EventButton) => {
      const btn = Gdk.getEventButtonButton(ev);
      const t = Gdk.getEventButtonType(ev);
      return btn === 1 && t === Gdk.EventType2buttonPress ? [true, Just(null)] as const : [false, Nothing] as const;
    });
    // Note: as in the Haskell, `activated` is not filtered here, so every button press (not only
    // the double click) is a trigger.
    const popup = mkGtkPopupSelect(
      vw,
      iconTheme,
      envC,
      selector,
      B.mapE((x: GD): readonly [null, any] => [null, x._gdValue], B.tag(b, activated)),
    );
    return B.mapE((v: any) => GadgetData(true, v), B.filterJust(B.mapE((p: [null, Maybe<any>]) => p[1], popup)));
  })();
  const allEvents = B.unionWith(constFirst, editedValue, e);
  const stop1 = reactimate1(B.apply(B.mapB((env1: any) => (x: GD) => () => updateBuffer(env1, x), envC.changesB), allEvents));
  const ch = B.changes(B.liftA2B((env1: any, x: GD) => () => updateBuffer(env1, x), envC.changesB, b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
  });
  const w = Gtk.toWidget(scroll);
  return GadgetOut([w], B.never(), initial, editedValue, b);
}

function renderGadget_ClickableList(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>): Out {
  const getLabelItem = (
    lbl: Gtk.Label,
    ref: IORef<(idx: number) => Maybe<GtkClickable<any>>>,
    [x, y]: readonly [number, number],
  ): Maybe<ClickableItem<any>> => {
    const idxFunc = readIORef(ref);
    const layout = Gtk.labelGetLayout(lbl);
    const x1 = Pango.unitsFromDouble(x);
    const y1 = Pango.unitsFromDouble(y);
    const [validIdx, idx] = Pango.layoutXyToIndex(layout, x1, y1);
    return validIdx ? mapMaybeValue((c: GtkClickable<any>) => c.gclickBase, idxFunc(idx)) : Nothing;
  };
  const evBox = Gtk.new_(Gtk.EventBox, { visibleWindow: true });
  const label = Gtk.labelNew(null);
  const ctx = Gtk.widgetGetStyleContext(label);
  Gtk.styleContextAddClass(ctx, "clickable-list");
  Gtk.containerAdd(evBox, label);
  Gtk.set(label, {
    wrap: true,
    justify: Gtk.JustificationLeft,
    hexpand: true,
    xalign: 0,
  });
  wInit(label);
  wInit(evBox);
  const clickMapRef = newIORef(displayClickables(label, initial));
  Gtk.widgetAddEvents(evBox, [Gdk.EventMaskButtonPressMask]);
  const stop1 = reactimate1(B.mapE((x: GD) => () => writeIORef(clickMapRef, displayClickables(label, x)), e));
  const ch = B.changes(B.mapB((x: GD) => () => writeIORef(clickMapRef, displayClickables(label, x)), b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(label, () => {
    stop1();
    stop2();
  });
  type Click = readonly [number, ClickableItem<any>];
  const mouseEvent = registerIOSignal1(evBox, Gtk.onWidgetButtonPressEvent, (ev: Gdk.EventButton): readonly [boolean, Maybe<Click>] => {
    const [lx, ly] = Gtk.labelGetLayoutOffsets(label);
    const t = Gdk.getEventButtonType(ev);
    const btn = Gdk.getEventButtonButton(ev);
    const [px, py] = [Gdk.getEventButtonX(ev), Gdk.getEventButtonY(ev)];
    const posn1: readonly [number, number] = [px - lx, py - ly];
    const item = getLabelItem(label, clickMapRef, posn1);
    if (item.tag === "Just") {
      if (btn === 1) {
        if (t === Gdk.EventTypeButtonPress) return [true, Just([1, item.value])]; // Single click
        if (t === Gdk.EventType2buttonPress) return [true, Just([2, item.value])]; // Double click
        return [false, Nothing];
      }
      if (btn === 3 && t === Gdk.EventTypeButtonPress) return [true, Just([3, item.value])]; // Right click.
      return [false, Nothing];
    }
    return [false, Nothing];
  });
  const mouseEvent1 = B.filterJust(mouseEvent);
  const singleClickEvent = B.mapE((c: Click) => c[1].clickSingle, B.filterE((c: Click) => c[0] === 1, mouseEvent1));
  const doubleClickEvent = B.mapE((c: Click) => c[1].clickDouble, B.filterE((c: Click) => c[0] === 2, mouseEvent1));
  const menuEvent = B.mapE((c: Click) => c[1].clickMenu, B.filterE((c: Click) => c[0] === 3, mouseEvent1));
  const menuDisplay = B.execute(B.mapE((m: Menu<any>) => () => mkGtkMenu(m), B.filterJust(menuEvent)));
  popupMenuOn(B.mapE((p: [Gtk.Menu, B.Event<any>]) => p[0], menuDisplay));
  const menuResult = B.switchE(B.mapE((p: [Gtk.Menu, B.Event<any>]) => p[1], menuDisplay));
  Gtk.onWidgetDestroy(label, stop1);
  const resultE = B.mapE(
    (m: Maybe<any>) => GadgetData(true, m),
    L.foldr1((x: B.Event<Maybe<any>>, acc: B.Event<Maybe<any>>) => B.unionWith(constFirst, x, acc), [
      singleClickEvent,
      doubleClickEvent,
      B.mapE((v: any): Maybe<any> => Just(v), menuResult),
    ]),
  );
  const w = Gtk.toWidget(evBox);
  return GadgetOut([w], B.never(), GadgetData(true, Nothing), resultE, B.pureB(GadgetData(true, Nothing)));
}

function renderGadget_DateBox(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>, fmt: T.Text): Out {
  const prsm: Prism<T.Text, Day> = datePrism(fmt);
  const [w, ev] = textBoxWithPopup(wInit, initial, e, b, prsm, (entry: Gtk.Entry) => {
    const [overlay, calendar] = createDatePopover(prsm, entry);
    Gtk.onWidgetDestroy(entry, () => {
      Gtk.widgetDestroy(overlay);
      Gtk.widgetDestroy(calendar);
    });
    return registerIOSignal(calendar, Gtk.onCalendarDaySelectedDoubleClick, () => {
      const [year, month, day] = Gtk.calendarGetDate(calendar);
      const date = fromGregorian(year, month + 1, day);
      Gtk.popoverPopdown(overlay);
      return [null, review(prsm, date)] as const;
      // Design note: callback ought to be integrated into createDatePopover once it no longer
      // has to support the legacy dialogs.
    });
  });
  return GadgetOut([w], B.never(), initial, ev, b);
}

function renderGadget_IconBox(
  iconTheme: Gtk.IconTheme, wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>, predicate: (t: T.Text) => boolean,
): Out {
  const updateImage = (ref: IORef<T.Text>, pic: Gtk.Image, gd: GadgetData<T.Text>): void => {
    if (!gd._gdOk) return;
    const v = gd._gdValue;
    const oldName = readIORef(ref);
    if (oldName !== v) {
      writeIORef(ref, v);
      const icon1 = safeLoadIcon(iconTheme, v, iconSize);
      if (icon1.tag === "Just") Gtk.imageSetFromPixbuf(pic, icon1.value);
    }
  };
  const currentName = newIORef<T.Text>(initial._gdValue);
  const icon1 = safeLoadIcon(iconTheme, initial._gdValue, iconSize);
  const pic = Gtk.imageNewFromPixbuf(toNull(icon1));
  Gtk.set(pic, { sensitive: true });
  wInit(pic);
  const button = Gtk.new_(Gtk.Button, { image: pic, alwaysShowImage: true });
  wInit(button);
  const [nameE, handler] = B.newEvent<GD>();
  const stop1 = reactimate1(B.mapE((x: GD) => () => updateImage(currentName, pic, x), e));
  const ch = B.changes(B.mapB((x: GD) => () => updateImage(currentName, pic, x), b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(button, () => {
    stop1();
    stop2();
  });
  Gtk.onButtonPressed(button, () => {
    // Debug code
    const ps = Gtk.iconThemeGetSearchPath(iconTheme);
    console.log("IconBox theme search path = " + JSON.stringify(ps));
    // End debug
    const icons = withWaitCursor(button, () => iconThemeContents(iconTheme, false, predicate));
    iconDialog(pic, icons, (newIcon: T.Text) => {
      Gtk.set(pic, { iconName: newIcon });
      handler(GadgetData(true, newIcon));
    });
  });
  const w = Gtk.toWidget(button);
  return GadgetOut([w], B.never(), initial, B.unionWith(constFirst, nameE, e), b);
}

function renderGadget_ColourBox(wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>): Out {
  const getValue = (entry: Gtk.Entry): Maybe<Colour> => {
    const styleCtx = Gtk.widgetGetStyleContext(entry);
    const t = Gtk.entryGetText(entry);
    const v = preview(colourPrism, t);
    switch (v.tag) {
      case "Nothing":
        Gtk.styleContextAddClass(styleCtx, "entry-error");
        return Nothing;
      case "Just":
        Gtk.styleContextRemoveClass(styleCtx, "entry-error");
        return Just(v.value);
      default:
        return absurd(v);
    }
  };
  const setEntryValue = (w: Gtk.Entry, c: Colour): void => {
    const old = Gtk.getEntryText(w);
    const nw = review(colourPrism, c);
    if (old !== nw) Gtk.setEntryText(w, nw);
  };
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true });
  wInit(entry);
  widgetLinkColour(
    entry,
    Just(initial._gdValue as Colour),
    B.mapE((x: GD) => Just(x._gdValue as Colour), e),
    B.mapB((x: GD) => Just(x._gdValue as Colour), b),
  );
  Gtk.entrySetIconFromIconName(entry, Gtk.EntryIconPositionSecondary, "applications-science");
  const [w, result] = makeField(entry, entryChangedSignal, setEntryValue, initial, e, b, () => getValue(entry));
  Gtk.onEntryIconPress(entry, () => {
    // Web: dialogRun returns a Promise, so the chooser is run asynchronously from the handler.
    void (async () => {
      const chooser = createColorDialog(entry);
      const r = await Gtk.dialogRun(chooser);
      switch (r) {
        case Gtk.ResponseTypeOk: {
          const colour = rgbaToColour(Gtk.colorChooserGetRgba(chooser));
          setEntryValue(entry, colour);
          Gtk.widgetGrabFocus(entry); // So that FocusOutEvent will be triggered.
          break;
        }
        default:
          break;
      }
      Gtk.widgetDestroy(chooser);
    })();
  });
  return GadgetOut([w], B.never(), initial, result, b);
}

/** A tree selector item: name, optional tooltip and optional value. */
type SelectorItem = readonly [T.Text, Maybe<T.Text>, Maybe<any>];

function renderGadget_TreeSelector(
  wInit: WInit, env: any, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>,
  forestF: (e: any) => Forest<SelectorItem>,
): Out {
  const selectionFunc = (tbl: M.Map<number[], any>) =>
    (_sel: Gtk.TreeSelection, _model: Gtk.TreeModel, path: Gtk.TreePath, old: boolean): boolean => {
      const p2 = Gtk.treePathGetIndices(path) ?? [];
      const r = M.member(p2, tbl) || old; // Always allow deselection
      return r;
    };
  const trimTree = (t: Tree<SelectorItem>): Maybe<Tree<SelectorItem>> => {
    const sub = trimForest(t.subForest);
    if (sub.length === 0) return isJust(t.rootLabel[2]) ? Just(Node(t.rootLabel, [])) : Nothing;
    return Just(Node(t.rootLabel, sub));
  };
  const trimForest = (f: Forest<SelectorItem>): Tree<SelectorItem>[] => mapMaybe(trimTree, f);
  // Insert the tree into the store, returning a list of pairs of values and integers.
  const addStoreTree = (store1: Gtk.TreeStore, iter1: Gtk.TreeIter | null, t: Tree<SelectorItem>): [number[], any][] => {
    const v1 = t.rootLabel;
    // iter is changed by "treeStoreInsert". Hence work with a clone.
    const iter2 = iter1 !== null ? Gtk.treeIterCopy(iter1) : noTreeIter;
    const newRow = Gtk.treeStoreInsert(store1, iter2, -1);
    const row = [Gtk.toGValue(v1[0]), Gtk.toGValue(toNull(v1[1]))];
    let pair1: [number[], any][];
    switch (v1[2].tag) {
      case "Nothing":
        pair1 = [];
        break;
      case "Just": {
        const path = Gtk.treePathGetIndices(Gtk.treeModelGetPath(store1, newRow)) ?? [];
        pair1 = [[path, v1[2].value]];
        break;
      }
      default:
        pair1 = absurd(v1[2]);
    }
    Gtk.treeStoreSet(store1, newRow, [0, 1], row);
    const pairs = addStoreForest(store1, newRow, t.subForest);
    return [...pair1, ...pairs];
  };
  const addStoreForest = (store1: Gtk.TreeStore, iter: Gtk.TreeIter | null, forest: Forest<SelectorItem>): [number[], any][] =>
    L.concat(forest.map((t) => addStoreTree(store1, iter, t)));

  const items1 = trimForest(forestF(env));
  const store = Gtk.treeStoreNew([Gtk.gtypeString, Gtk.gtypeString]);
  // Contents are name and optional tooltip
  const pairs = addStoreForest(store, null, items1);
  // "store" contains names. "pairs" maps store paths to actual values.
  const idx = M.fromList(pairs);
  const revIndex = M.fromList(pairs.map(([x, y]): [any, number[]] => [y, x]));
  // setSelection :: (Ord a) =>
  //    Gtk.TreeView -> Gtk.TreeSelection -> Set a -> IO ()
  const setSelection = (vw1: Gtk.TreeView, sel: Gtk.TreeSelection, gd: GadgetData<S.Set<any>>): void => {
    if (!gd._gdOk) return;
    const vs = gd._gdValue;
    const [oldGtkPaths] = Gtk.treeSelectionGetSelectedRows(sel);
    const oldPaths = S.fromList(catMaybes(oldGtkPaths.map((p) => fromNullable(Gtk.treePathGetIndices(p)))));
    const newPaths = mapMaybe((v: any) => M.lookup(v, revIndex), S.toList(vs));
    if (!equals(S.fromList(newPaths), oldPaths)) {
      const paths = newPaths.map((p) => Gtk.treePathNewFromIndices(p));
      Gtk.treeSelectionUnselectAll(sel);
      for (const path of paths) {
        Gtk.treeViewExpandToPath(vw1, path);
        Gtk.treeSelectionSelectPath(sel, path);
      }
    }
  };
  const scroll = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  Gtk.set(scroll, {
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
  });
  wInit(scroll);
  Gtk.setScrolledWindowShadowType(scroll, Gtk.ShadowTypeIn);
  const vw = Gtk.treeViewNewWithModel(store);
  Gtk.set(vw, {
    hexpand: true,
    vexpand: true,
    heightRequest: 300, // Not good to hard code a size, but default is too small.
  });
  wInit(vw);
  Gtk.treeViewSetHeadersVisible(vw, false);
  const column = Gtk.treeViewColumnNew();
  Gtk.treeViewAppendColumn(vw, column);
  const txt = Gtk.cellRendererTextNew();
  Gtk.setCellRendererTextEditable(txt, false);
  Gtk.treeViewColumnPackEnd(column, txt, true);
  Gtk.cellLayoutAddAttribute(column, txt, "text", 0);
  Gtk.treeViewSetEnableTreeLines(vw, true);
  const path0 = Gtk.treePathNewFromIndices([0]);
  Gtk.treeViewExpandRow(vw, path0, false);
  Gtk.treeViewSetTooltipColumn(vw, 1);
  const selection = Gtk.treeViewGetSelection(vw);
  Gtk.treeSelectionSetMode(selection, Gtk.SelectionModeMultiple);
  setSelection(vw, selection, initial);
  Gtk.treeSelectionSetSelectFunction(selection, selectionFunc(idx));
  const blockSignals = newIORef(false);
  const selectionE = B.filterJust(registerIOSignal(selection, Gtk.onTreeSelectionChanged, () => {
    const blockFlag = readIORef(blockSignals);
    if (blockFlag) return [null, Nothing] as const;
    const [gtkPaths] = Gtk.treeSelectionGetSelectedRows(selection);
    const paths = S.fromList(mapMaybe(
      (p: number[]) => M.lookup(p, idx),
      catMaybes(gtkPaths.map((p) => fromNullable(Gtk.treePathGetIndices(p)))),
    ));
    return [null, Just(GadgetData(true, paths))] as const;
  }));
  const stop1 = reactimate1(B.mapE((x: GD) => () => setSelection(vw, selection, x), e));
  const ch = B.changes(B.mapB((v: GD) => () => {
    writeIORef(blockSignals, true);
    setSelection(vw, selection, v);
    writeIORef(blockSignals, false);
  }, b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
  });
  Gtk.containerAdd(scroll, vw);
  const w = Gtk.toWidget(scroll);
  return GadgetOut([w], B.never(), initial, selectionE, b);
}

function renderGadget_Table(
  iconTheme: Gtk.IconTheme, wInit: WInit, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  flags: readonly Tbl.TableEditing<any>[], columns: Tbl.Table<any>, nested: Maybe<DialogSelector_<any, any, any>>,
): Out {
  const [vw, store, activated, userEdit] = mkTableView(
    iconTheme,
    flags,
    isJust(nested),
    columns,
    initial._gdValue,
    B.mapE((x: GD) => x._gdValue, e),
    B.mapB((x: GD) => x._gdValue, b),
  );
  wInit(vw);
  if (nested.tag === "Just") {
    const selector = nested.value;
    const editedRow = mkGtkPopupSelect(vw, iconTheme, envC, selector, activated);
    const stop = reactimate1(B.mapE(([n, mv]: [number, Maybe<any>]) => () => {
      if (mv.tag === "Just") Gtk.seqStoreSetValue(store, n, mv.value);
    }, editedRow));
    Gtk.onWidgetDestroy(vw, stop);
  }
  const widget = Gtk.toWidget(vw);
  return GadgetOut([widget], B.never(), initial, B.mapE((rows: readonly any[]) => GadgetData(true, rows), userEdit), b);
}

function renderGadget_ForestTable(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  headerGroups: readonly (readonly [T.Text, readonly (readonly [T.Text, AnyGadget])[]])[],
  lensForest: (e: any) => Forest<readonly [any, Lens<any, any>]>,
): Out {
  type Size = [number, number];
  const liftBoth = (f: (x: number, y: number) => number, [v1a, v2a]: readonly [number, number], [v1b, v2b]: readonly [number, number]): Size =>
    [f(v1a, v1b), f(v2a, v2b)];
  const bothMax = (x: readonly [number, number], y: readonly [number, number]): Size => liftBoth(Math.max, x, y);
  const longZip = <A>(f: (x: A, y: A) => A, xs1: readonly A[], xs2: readonly A[]): A[] => {
    if (xs1.length === 0) return [...xs2];
    if (xs2.length === 0) return [...xs1];
    return [f(xs1[0], xs2[0]), ...longZip(f, xs1.slice(1), xs2.slice(1))];
  };
  const longestWord = (txt: T.Text): number => L.maximum([0, ...T.words(txt).map(T.length)]);
  const sum = (xs: readonly number[]): number => xs.reduce((x, y) => x + y, 0);
  const maximum0 = (xs: readonly number[]): number => L.maximum([0, ...xs]);

  const headerWidget = (txt: T.Text): Gtk.Widget => {
    const label = Gtk.labelNew(txt);
    const longest = longestWord(txt);
    Gtk.set(label, {
      wrap: true,
      justify: Gtk.JustificationCenter,
      wrapMode: Pango.WrapModeWordChar,
      ellipsize: Pango.EllipsizeModeMiddle,
      widthChars: Math.min(5, longest),
      maxWidthChars: longest,
      lines: 3,
      widthRequest: 10 * Math.min(5, longest),
    });
    Gtk.labelSetLineWrap(label, true);
    Gtk.labelSetJustify(label, Gtk.JustificationCenter);
    Gtk.labelSetLineWrapMode(label, Pango.WrapModeWordChar);
    const style = Gtk.widgetGetStyleContext(label);
    Gtk.styleContextAddClass(style, "table-header");
    return Gtk.toWidget(label);
  };
  const headerWidgets = (
    groups: readonly (readonly [T.Text, readonly (readonly [T.Text, any])[]])[],
  ): [Gtk.Widget[], [Gtk.Widget, Gtk.Widget[]][]] => {
    if (groups.length === 0) return [[], []];
    if (groups.length === 1) return [groups[0][1].map((c) => headerWidget(c[0])), []];
    const [[, group1], ...rest] = groups;
    const widgets1 = group1.map((c) => headerWidget(c[0]));
    const widgetss = rest.map(([groupName, columns]): [Gtk.Widget, Gtk.Widget[]] => {
      const groupLabel = headerWidget(groupName);
      const columnLabels = columns.map((c) => headerWidget(c[0]));
      return [groupLabel, columnLabels];
    });
    return [widgets1, widgetss];
  };
  const headerWidthRequests = (widget: Gtk.Widget): Size => {
    const minReq = Gtk.widgetGetPreferredWidth(widget)[0];
    const prefReq = Gtk.widgetGetPreferredWidthForHeight(widget, 30)[1]; // Single line
    return [minReq, prefReq];
  };
  const headerGroupWidths = ([top, cols]: readonly [Gtk.Widget, readonly Gtk.Widget[]]): Size[] => {
    const expand = (t: number, xs: readonly number[]): number[] => {
      const s = sum(xs);
      const d = t - s;
      if (s > 0 && d > 0) {
        const f = 1.0 + d / s;
        return xs.map((x) => ceiling(f * x));
      }
      return [...xs];
    };
    const [topMin, topReq] = headerWidthRequests(top);
    const [colMins, colReqs] = L.unzip(cols.map(headerWidthRequests));
    return L.zip(expand(topMin, colMins), expand(topReq, colReqs));
  };
  // Gadgets must have 0 or 1 widget.
  const boxGadget = (g: Out): Out => {
    const w1 = boxWidgets(wInit, "Vertical", g.gadgetView);
    return { ...g, gadgetView: w1.tag === "Just" ? [w1.value] : [] };
  };
  const gadgetTree = (gs: readonly AnyGadget[], gss: readonly (readonly AnyGadget[])[], node: Tree<readonly [any, Lens<any, any>]>): Tree<Out[]> => {
    const [k, lns1] = node.rootLabel;
    const v = gs.map((g) => {
      const g2 = focusingOver(
        getLens(lns1),
        gDot(send((x: any) => Just(Right([k, x]))), sendMap((w: any) => Just(Left(w)), g)),
      );
      return boxGadget(renderGadget(iconTheme, wInit, env, initial, envC, e, b, g2));
    });
    const forestOut = gadgetForest(gss, node.subForest);
    return Node(v, forestOut);
  };
  const gadgetForest = (gss: readonly (readonly AnyGadget[])[], nodes: Forest<readonly [any, Lens<any, any>]>): Tree<Out[]>[] => {
    if (gss.length === 0) return [];
    const [gs, ...gss1] = gss;
    return nodes.map((n) => gadgetTree(gs, gss1, n));
  };
  const columnWidthsTree = (t: Tree<Out[]>): Size[][] => {
    const widths = t.rootLabel.map((g) =>
      L.foldr(bothMax, [0, 0] as Size, g.gadgetView.map((w) => Gtk.widgetGetPreferredWidth(w))));
    const widthss = columnWidthsForest(t.subForest);
    return [widths, ...widthss];
  };
  const columnWidthsForest = (nodes: Forest<Out[]>): Size[][] =>
    L.foldr((x: Size[][], acc: Size[][]) => longZip((p: Size[], q: Size[]) => longZip(bothMax, p, q), x, acc), [] as Size[][], nodes.map(columnWidthsTree));
  const allocateColumns = (available: Maybe<number>, requests: readonly (readonly Size[])[]): number[][] => {
    const allCols = L.concat(requests);
    const totalMin = sum(allCols.map(fst));
    const totalReq = sum(allCols.map(snd));
    const colCount = allCols.length;
    switch (available.tag) {
      case "Just": {
        const w = available.value;
        const minExtra = (w - totalMin) / colCount;
        const reqExtra = (w - totalReq) / colCount;
        if (w > totalReq) return requests.map((r) => r.map((x) => floor(reqExtra) + x[1])); // Allocate excess space between widgets.
        if (w > totalMin) return requests.map((r) => r.map((x) => floor(minExtra) + x[0])); // Allocate space in excess of min between widgets
        return requests.map((r) => r.map(fst)); // Minimum sizes only.
      }
      case "Nothing":
        // No space limit, so give columns everything they ask for.
        return requests.map((r) => r.map(snd));
      default:
        return absurd(available);
    }
  };
  const getHeightsTree = (t: Tree<Out[]>, widthsList: readonly (readonly number[])[]): Tree<number> => {
    if (widthsList.length === 0) {
      // Should never happen.
      const hs = t.rootLabel.map((g) => sum(g.gadgetView.map((w) => Gtk.widgetGetPreferredHeight(w)[0])));
      const childHeights = getHeightsForest(t.subForest, []);
      return Node(maximum0(hs), childHeights);
    }
    const [widths, ...widthss] = widthsList;
    const gadgetHeight = (g: Out, width: number): number =>
      sum(g.gadgetView.map((widget) => Gtk.widgetGetPreferredHeightForWidth(widget, width)[0]));
    const hs = L.zipWith(gadgetHeight, t.rootLabel, widths);
    const childHeights = getHeightsForest(t.subForest, widthss);
    return Node(maximum0(hs), childHeights);
  };
  const getHeightsForest = (forest: Forest<Out[]>, widthss: readonly (readonly number[])[]): Tree<number>[] =>
    forest.map((node) => getHeightsTree(node, widthss));
  const treeHeightAdjust = (t: Tree<number>): Tree<number> => {
    const newChilds = t.subForest.map(treeHeightAdjust);
    return Node(Math.max(t.rootLabel, sum(newChilds.map((c) => c.rootLabel))), newChilds);
  };
  const headerGroupAdjust = (x: number, y: number, h: number, widgets: readonly Gtk.Widget[], widths: readonly number[]): void => {
    const xs = L.scanl((acc: number, w: number) => acc + w, x, widths);
    const adj = (height: number, [w, x1, width]: readonly [Gtk.Widget, number, number]): void => {
      const p: Gdk.Rectangle = { x: x1, y, width, height };
      Gtk.widgetSizeAllocate(w, p);
    };
    for (const t of L.zip3(widgets, xs, widths)) adj(h, t);
  };
  const headersAdjust = (
    group1: readonly Gtk.Widget[],
    groups: readonly (readonly [Gtk.Widget, readonly Gtk.Widget[]])[],
    widthsList: readonly (readonly number[])[],
  ): number => {
    if (widthsList.length === 0) return 0; // Should never happen.
    const [widths1, ...widthss] = widthsList;
    const groupHeights = ([spanWidget, widgets]: readonly [Gtk.Widget, readonly Gtk.Widget[]], widths: readonly number[]): Size => {
      const spanH = Gtk.widgetGetPreferredHeightForWidth(spanWidget, sum(widths));
      const subH = maximum0(L.zipWith((w: Gtk.Widget, width: number) => Gtk.widgetGetPreferredHeightForWidth(w, width)[0], widgets, widths));
      return [spanH[0], subH];
    };
    // Height of first group of header widgets
    const h1 = maximum0(L.zipWith((w: Gtk.Widget, width: number) => Gtk.widgetGetPreferredHeightForWidth(w, width)[0], group1, widths1));
    const [hs2, hs3] = L.unzip(L.zipWith(groupHeights, groups, widthss));
    const h2 = maximum0(hs2); // Height of spanning header widgets.
    const h3 = maximum0(hs3); // Height of sub-header widgets
    const height = Math.max(h1, h2 + h3); // Total height of header rows.
    const h2a = Math.max(h2, height - h3); // Spanning header wigets expanded to match h1.
    const xs = L.scanl((acc: number, w: number) => acc + w, sum(widths1), widthss.map(sum)); // Start x for each group.
    headerGroupAdjust(0, 0, height, group1, widths1);
    headerGroupAdjust(sum(widths1), 0, h2a, groups.map(fst), widthss.map(sum));
    for (const [g, ws, x] of L.zip3(groups.map(snd), widthss, xs)) headerGroupAdjust(x, h2a, h3, g, ws);
    return height;
  };
  const treeAdjust = (
    x: number, y: number, // X and Y for top left of this tree.
    t: Tree<Out[]>, // Gadgets to place.
    widthsList: readonly (readonly number[])[], heights: Tree<number>, // Widths and heights.
  ): void => {
    if (widthsList.length === 0) return;
    const [widths, ...widthss] = widthsList;
    const height = heights.rootLabel;
    const xs = L.scanl((acc: number, w: number) => acc + w, x, widths);
    const childX = x + sum(widths);
    const adjustGadget = ([gadget, width, x1]: readonly [Out, number, number]): void => {
      const p: Gdk.Rectangle = { x: x1, y, width, height };
      for (const w of gadget.gadgetView) Gtk.widgetSizeAllocate(w, p);
    };
    for (const g of L.zip3(t.rootLabel, widths, xs)) adjustGadget(g);
    forestAdjust(childX, y, t.subForest, widthss, heights.subForest);
  };
  const forestAdjust = (
    x: number, y: number, nodes: Forest<Out[]>, widthss: readonly (readonly number[])[], heights: Forest<number>,
  ): void => {
    const ys = L.scanl((acc: number, h: number) => acc + h, y, heights.map((h) => h.rootLabel));
    for (const [y1, c1, h1] of L.zip3(ys, nodes, heights)) treeAdjust(x, y1, c1, widthss, h1);
  };
  const baseSize = (
    headerBase1: Gtk.Layout, base1: Gtk.Layout, space: number, widthss: readonly (readonly number[])[], headHeight: number,
    heights: Forest<number>,
  ): void => {
    const width = sum(L.concat(widthss));
    const height = sum(heights.map((h) => h.rootLabel));
    Gtk.layoutSetSize(headerBase1, width, headHeight);
    Gtk.widgetSetSizeRequest(headerBase1, 1, headHeight);
    Gtk.layoutSetSize(base1, width, height);
    Gtk.widgetSetSizeRequest(base1, Math.max(space, width), height);
  };

  // Create the widget hierarchy.
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  const base = Gtk.layoutNew(null, null);
  const hAdjust = Gtk.scrollableGetHadjustment(base);
  const headerBase = Gtk.layoutNew(hAdjust, null);
  const [header1, headers] = headerWidgets(headerGroups);
  for (const w of header1) Gtk.containerAdd(headerBase, w);
  for (const [w1, ws] of headers) {
    Gtk.containerAdd(headerBase, w1);
    for (const w of ws) Gtk.containerAdd(headerBase, w);
  }
  Gtk.widgetShowAll(headerBase);
  const headerWidth1 = header1.map(headerWidthRequests);
  const headerWidthsRest = headers.map(headerGroupWidths);
  let headerWidths = [headerWidth1, ...headerWidthsRest];
  const gadgets = gadgetForest(headerGroups.map(([, cols]) => cols.map(snd)), lensForest(env));
  for (const t of gadgets) for (const gs of flatten(t)) for (const g of gs) for (const w of g.gadgetView) Gtk.containerAdd(base, w);
  const scroll = Gtk.scrolledWindowNew(hAdjust, null);
  Gtk.containerAdd(scroll, base);
  Gtk.set(scroll, {
    expand: true,
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
    halign: Gtk.AlignFill,
    valign: Gtk.AlignFill,
  });
  Gtk.boxPackStart(vbox, headerBase, false, false, 0);
  Gtk.boxPackStart(vbox, scroll, true, true, 0);
  Gtk.widgetShowAll(vbox);
  // Compute the initial sizes.
  const computeWidthGroups = (): Size[][] =>
    L.zipWith((hs: readonly Size[], cs: readonly Size[]) => L.zipWith(bothMax, hs, cs), headerWidths, columnWidthsForest(gadgets));
  let widthGroups = computeWidthGroups();
  const widthss = allocateColumns(Nothing, widthGroups);
  const headHeight = headersAdjust(header1, headers, widthss);
  const heights = getHeightsForest(gadgets, allocateColumns(Nothing, widthGroups)).map(treeHeightAdjust);
  baseSize(headerBase, base, 0, widthss, headHeight, heights);
  forestAdjust(0, 0, gadgets, widthss, heights);
  // Set up resize callback on base.
  // Web: preferred sizes are only known once the widgets are in the page, so the column width
  // requests (measured once in GTK) are measured again at the first allocation after mapping.
  let measured = false;
  Gtk.onWidgetSizeAllocate(base, (rect) => {
    if (!measured && base.el !== null) {
      measured = true;
      headerWidths = [header1.map(headerWidthRequests), ...headers.map(headerGroupWidths)];
      widthGroups = computeWidthGroups();
    }
    const space = Gdk.getRectangleWidth(rect);
    const widthss2 = allocateColumns(Just(space - 5), widthGroups);
    const headHeight2 = headersAdjust(header1, headers, widthss2);
    const heights2 = getHeightsForest(gadgets, widthss2).map(treeHeightAdjust);
    baseSize(headerBase, base, space, widthss2, headHeight2, heights2);
    forestAdjust(0, 0, gadgets, widthss2, heights2);
  });
  // Assemble the resulting GadgetOut.
  const widget = Gtk.toWidget(vbox);
  return { ...mergeOutputs(L.concatMap((t: Tree<Out[]>) => L.concat(flatten(t)), gadgets)), gadgetView: [widget] };
}

function renderGadget_ButtonBar(wInit: WInit, e: B.Event<GD>, b: B.Behavior<GD>, buttons: readonly (readonly [T.Text, (a: any) => any])[]): Out {
  type F = (a: any) => any;
  const idF: F = (a: any) => a;
  const u = (x: GadgetData<F>, y: GadgetData<F>): GadgetData<F> => {
    if (x._gdOk && y._gdOk) return GadgetData(true, (a: any) => x._gdValue(y._gdValue(a)));
    if (!x._gdOk && y._gdOk) return y;
    if (x._gdOk && !y._gdOk) return x;
    return GadgetData(false, idF);
  };
  const buttonBox = Gtk.buttonBoxNew(Gtk.OrientationHorizontal);
  wInit(buttonBox);
  Gtk.buttonBoxSetLayout(buttonBox, Gtk.ButtonBoxStyleCenter);
  const clicks = buttons.map(([nm, func]) => {
    const btn = Gtk.new_(Gtk.Button, { label: nm });
    wInit(buttonBox);
    Gtk.boxPackStart(buttonBox, btn, false, false, 0);
    return registerIOSignal(btn, Gtk.onButtonClicked, () => [null, func] as const);
  });
  const w = Gtk.toWidget(buttonBox);
  const constGD = (x: GD): GadgetData<F> => gdFmap((v: any) => (_: any) => v, x); // fmap const
  const e1 = B.mapE(constGD, e);
  const clicks1 = [e1, ...clicks.map((c) => B.mapE((f: F) => GadgetData(true, f), c))];
  return GadgetOut(
    [w],
    B.never(),
    GadgetData(true, idF),
    L.foldr((c: B.Event<GadgetData<F>>, acc: B.Event<GadgetData<F>>) => B.unionWith(u, c, acc), B.never<GadgetData<F>>(), clicks1),
    B.mapB(constGD, b),
  );
}

function renderGadget_ButtonIO(wInit: WInit, envC: Changes<any>, b: B.Behavior<GD>, label: T.Text, act: (e: any, i: any) => any): Out {
  const errMsg = (err: unknown): T.Text =>
    "Could not complete the operation.\n\n" + "Technical details: " + T.pack(String(err));
  const runAction = async (parent: Gtk.Widget, e1: any, gd: GD, act1: (e: any, i: any) => any): Promise<Maybe<any>> => {
    if (!gd._gdOk) return Nothing;
    try {
      return Just(await act1(e1, gd._gdValue));
    } catch (err) {
      await errorBox(parent, errMsg(err));
      return Nothing;
    }
  };
  const button = Gtk.new_(Gtk.Button, { label });
  wInit(button);
  const click = registerIOSignal(button, Gtk.onButtonClicked, () => [null, act] as const);
  // Web: `mapEventIO` runs the (possibly asynchronous) action and its error box. Here the click
  // starts the action and the result event fires when it has completed.
  const [result, fireResult] = B.newEvent<Maybe<any>>();
  B.reactimate(B.apply(
    B.liftA2B((env1: any, i: GD) => (act1: (e: any, i: any) => any) => () => {
      void runAction(button, env1, i, act1).then(fireResult);
    }, envC.changesB, b),
    click,
  ));
  const result1 = B.mapE((m: Maybe<any>) => GadgetData(true, m), result);
  const resultB = B.stepper(GadgetData<Maybe<any>>(true, Nothing), result1);
  const w = Gtk.toWidget(button);
  return GadgetOut([w], B.never(), GadgetData(true, Nothing), result1, resultB);
}

function renderGadget_Image(wInit: WInit, initial: GD, e: B.Event<GD>, path: string): Out {
  const imageWidget = Gtk.imageNewFromFile(path);
  wInit(imageWidget);
  Gtk.widgetShow(imageWidget);
  const click = registerIOSignal1(imageWidget, Gtk.onWidgetButtonPressEvent, (ev: Gdk.EventButton) => {
    const btn = Gdk.getEventButtonButton(ev);
    if (btn === 1) {
      const x = round(Gdk.getEventButtonX(ev));
      const y = round(Gdk.getEventButtonY(ev));
      return [true, Just([x, y] as [number, number])] as const;
    }
    return [false, Nothing] as const;
  });
  const result = B.unionWith(constFirst, B.mapE((p: [number, number]) => GadgetData(true, p), B.filterJust(click)), e);
  const resultB = B.stepper(initial, result);
  const w = Gtk.toWidget(imageWidget);
  return GadgetOut([w], B.never(), initial, result, resultB);
}

function renderGadget_ForestEditor(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  labelFunc: (e: any, a: any) => T.Text,
  menuFunc: (m: Maybe<any>) => Menu<TreeOper<any>>,
  legalParent: (a: any) => boolean,
  dSel: Maybe<DialogSelector_<any, any, any>>,
): Out {
  type Path = Gtk.TreePath;
  type Insertion = readonly [readonly [Path, number], any];
  const createStore = (column: Gtk.TreeViewColumn, render: Gtk.CellRendererText, vw: Gtk.TreeView, v: Forest<any>): Gtk.ForestStore<any> => {
    const store = Gtk.forestStoreNew(v);
    Gtk.mvCellLayoutSetAttributes(column, render, store, (v1: any) => ({
      ellipsize: Pango.EllipsizeModeEnd,
      editable: false,
      text: labelFunc(env, v1),
    }));
    Gtk.treeViewSetModel(vw, store);
    Gtk.treeViewExpandAll(vw);
    return store;
  };
  const updateIfNeeded = (store: Gtk.ForestStore<any>, vw: Gtk.TreeView, gd: GD): void => {
    if (!gd._gdOk) return;
    const newVal = gd._gdValue;
    const oldVal = Gtk.forestStoreGetForest(store);
    if (notEquals(newVal, oldVal)) {
      Gtk.forestStoreClear(store);
      const path = Gtk.treePathNew(); // Root
      Gtk.forestStoreInsertForest(store, path, 0, newVal);
      Gtk.treeViewExpandAll(vw);
    }
  };
  const targetName = (info: number): T.Text => "treePath-" + T.pack(String(info));
  const dragTargets = (info: number): Gtk.TargetEntry[] => {
    const entityTarget = Gtk.targetEntryNew(
      targetName(info),
      Gtk.TargetFlagsSameWidget,
      0, // Can't use the "info" field, so appending it to the target name.
    );
    return [entityTarget];
  };
  const checkTargets = (info: number, context: Gdk.DragContext): boolean => {
    const targets = Gdk.dragContextListTargets(context).map(Gdk.atomName);
    return targets.includes(targetName(info));
  };
  const dragPositionTarget = (vw: Gtk.TreeView, model: Gtk.ForestStore<any>, x1: number, y1: number): Maybe<[Path, Gtk.TreeViewDropPosition]> => {
    const [x2, y2] = Gtk.treeViewConvertWidgetToBinWindowCoords(vw, x1, y1);
    const [, mPath, , , cellY] = Gtk.treeViewGetPathAtPos(vw, x2, y2);
    const rowRect = Gtk.treeViewGetBackgroundArea(vw, mPath, noTreeViewColumn);
    if (mPath === null) return Nothing;
    const path = mPath;
    const rowH = Gdk.getRectangleHeight(rowRect);
    const rowH3 = Math.floor(rowH / 3);
    const t = Gtk.forestStoreLookup(model, path);
    if (t === null) return cannotHappen("Render ForestEditorSpec: clicked item not found in tree.", Nothing);
    const v = t.rootLabel;
    const pos: Gtk.TreeViewDropPosition = legalParent(v)
      ? cellY < rowH3
        ? Gtk.TreeViewDropPositionBefore
        : cellY > rowH - rowH3
          ? Gtk.TreeViewDropPositionAfter
          : Gtk.TreeViewDropPositionIntoOrBefore
      : cellY < Math.floor(rowH / 2)
        ? Gtk.TreeViewDropPositionBefore
        : Gtk.TreeViewDropPositionAfter;
    return Just([path, pos]);
  };
  const dragMotionHandler = (
    info: number, model: Gtk.ForestStore<any>, vw: Gtk.TreeView, context: Gdk.DragContext, x1: number, y1: number, t: number,
  ): boolean => {
    const validDrop = checkTargets(info, context);
    if (validDrop) {
      const r = dragPositionTarget(vw, model, x1, y1);
      if (r.tag === "Just") Gtk.treeViewSetDragDestRow(vw, r.value[0], r.value[1]);
      else Gtk.treeViewSetDragDestRow(vw, null, Gtk.TreeViewDropPositionAfter);
      Gdk.dragStatus(context, Gdk.DragActionMove, t);
    }
    return validDrop;
  };
  const dragDropHandler = (
    editHandler: () => void, info: number, model: Gtk.ForestStore<any>, vw: Gtk.TreeView,
    context: Gdk.DragContext, x1: number, y1: number, t: number,
  ): boolean => {
    const validDrop = checkTargets(info, context);
    Gtk.signalStopEmissionByName(vw, "drag_drop"); // Identifier as string: yuck.
    // Need to do this to stop the default GTK tree drop processing.
    if (!validDrop) return false;
    const [parentRef, position] = ((): [Gtk.TreeRowReference | null, number] => {
      const r = dragPositionTarget(vw, model, x1, y1);
      if (r.tag === "Nothing") return [null, -1];
      const [path, pos] = r.value;
      const path2 = L.reverse(Gtk.treePathGetIndices(path) ?? []);
      switch (pos) {
        case Gtk.TreeViewDropPositionBefore: {
          if (path2.length === 0) return [null, -1];
          if (path2.length === 1) return [null, path2[0]];
          const n = path2[0];
          Gtk.treePathUp(path); // Side effect on path.
          const pathRef = Gtk.treeRowReferenceNew(model, path);
          return [pathRef, n];
        }
        case Gtk.TreeViewDropPositionAfter: {
          if (path2.length === 0) return [null, -1];
          if (path2.length === 1) return [null, path2[0]];
          const n = path2[0];
          Gtk.treePathUp(path); // Side effect on path.
          const pathRef = Gtk.treeRowReferenceNew(model, path);
          return [pathRef, n + 1];
        }
        default: {
          const pathRef = Gtk.treeRowReferenceNew(model, path);
          return [pathRef, -1];
        }
      }
    })();
    const sel = Gtk.treeViewGetSelection(vw);
    const [rows] = Gtk.treeSelectionGetSelectedRows(sel);
    const rowRefs = rows.map((r) => Gtk.treeRowReferenceNew(model, r));
    const moved = rowRefs.map((sourceRef): boolean => {
      // runMaybeT
      const v = ((): Maybe<[Tree<any>, Path]> => {
        const source = sourceRef === null ? null : Gtk.treeRowReferenceGetPath(sourceRef);
        if (source === null) return Nothing;
        const tree = Gtk.forestStoreLookup(model, source);
        if (tree === null) return Nothing;
        const parent = parentRef !== null
          ? Gtk.treeRowReferenceGetPath(parentRef)
          : Gtk.treePathNew(); // Default points at root.
        if (parent === null) return Nothing;
        return Just([tree, parent]);
      })();
      if (v.tag === "Nothing") return cannotHappen("Render ForestEditorSpec: item being moved not found in tree.", false);
      const [tree, parent] = v.value;
      Gtk.forestStoreInsertTree(model, parent, position, tree);
      // Source path may have changed due to insertion, so get the new one.
      const source = sourceRef === null ? null : Gtk.treeRowReferenceGetPath(sourceRef);
      if (source === null) cannotHappen("Render ForestEditorSepc: old position missing.", null);
      else Gtk.forestStoreRemove(model, source);
      return rows.length > 0;
    });
    const moved1 = L.or(moved);
    Gtk.dragFinish(context, moved1, false, t); // Delete flag false because we have done it.
    if (moved1) editHandler();
    return moved1;
  };
  const buttonHandler = (store: Gtk.ForestStore<any>, vw: Gtk.TreeView, event: Gdk.EventButton): readonly [boolean, Maybe<Menu<readonly [Maybe<Path>, TreeOper<any>]>>] => {
    const button = Gdk.getEventButtonButton(event);
    const x1 = round(Gdk.getEventButtonX(event));
    const y1 = round(Gdk.getEventButtonY(event));
    const [x2, y2] = Gtk.treeViewConvertWidgetToBinWindowCoords(vw, x1, y1);
    if (button === 3) {
      // Right button
      const [, path1] = Gtk.treeViewGetPathAtPos(vw, x2, y2);
      if (path1 !== null) {
        const t = Gtk.forestStoreLookup(store, path1);
        if (t === null) return cannotHappen("Render ForestEditorSpec: clicked item not found in tree.", [false, Nothing] as const);
        const path2 = Gtk.treePathCopy(path1); // path1 gets deallocated after exit.
        return [true, Just(fmap_Menu((op: TreeOper<any>) => [Just(path2), op] as const, menuFunc(Just(t.rootLabel))))]; // Clicked
      }
      return [true, Just(fmap_Menu((op: TreeOper<any>) => [Nothing, op] as const, menuFunc(Nothing)))]; // Not on tree.
    }
    return [false, Nothing]; // Pass other buttons to standard processing.
  };
  const processMenuSelection = (
    insertHandler: (ins: Insertion) => void, editHandler: () => void, store: Gtk.ForestStore<any>,
    [mPath, oper]: readonly [Maybe<Path>, TreeOper<any>],
  ): void => {
    if (mPath.tag === "Just") {
      const path1 = mPath.value;
      switch (oper.tag) {
        case "TreeAddBefore": {
          const n = L.last([0, ...(Gtk.treePathGetIndices(path1) ?? [])]);
          // Position = 0 if no indices there. Insert before root = insert at start of root.
          const path2 = Gtk.treePathCopy(path1);
          Gtk.treePathUp(path2);
          insertHandler([[path2, n], oper._0]);
          return;
        }
        case "TreeAddIn":
          insertHandler([[path1, -1], oper._0]);
          return;
        case "TreeAddAfter": {
          const n = L.last([-2, ...(Gtk.treePathGetIndices(path1) ?? [])]);
          // Position = end if no indices there.
          Gtk.treePathUp(path1);
          insertHandler([[path1, n + 1], oper._0]);
          return;
        }
        case "TreeDelete":
          Gtk.forestStoreRemove(store, path1);
          editHandler();
          return;
        default:
          return absurd(oper);
      }
    }
    switch (oper.tag) {
      case "TreeAddAfter": {
        const path = Gtk.treePathNew();
        insertHandler([[path, -1], oper._0]);
        return;
      }
      case "TreeAddBefore": {
        const path = Gtk.treePathNew();
        insertHandler([[path, 0], oper._0]);
        return;
      }
      default:
        return; // Do nothing.
    }
  };

  // mdo
  const info = Math.floor(Math.random() * 0x100000000); // Unique identifier for this tree editor instance.
  // Configure the tree view with one column for the item text.
  const vw = Gtk.treeViewNew();
  wInit(vw);
  const column = Gtk.treeViewColumnNew();
  const render = Gtk.cellRendererTextNew();
  const store = createStore(column, render, vw, initial._gdValue);
  const stop1 = reactimate1(B.mapE((env1: any) => () =>
    Gtk.mvCellLayoutSetAttributes(column, render, store, (v1: any) => ({
      ellipsize: Pango.EllipsizeModeEnd,
      editable: false,
      text: labelFunc(env1, v1),
    })), envC.changesE));
  const [editEvent, editHandler] = B.newEvent<Forest<any>>();
  const blockSignals = newIORef(false);
  const sendEditEvent = (): void => {
    const blockFlag = readIORef(blockSignals);
    if (!blockFlag) editHandler(Gtk.forestStoreGetForest(store));
  };
  const editB = B.stepper<Forest<any>>(initial._gdValue, editEvent);
  Gtk.treeViewSetHeadersVisible(vw, false);
  Gtk.treeViewColumnPackStart(column, render, true);
  Gtk.treeViewAppendColumn(vw, column);
  // Update tree from incoming data.
  const stop2 = reactimate1(B.mapE((x: GD) => () => updateIfNeeded(store, vw, x), e));
  const ch = B.changes(B.mapB((v: GD) => () => {
    writeIORef(blockSignals, true);
    updateIfNeeded(store, vw, v);
    writeIORef(blockSignals, false);
  }, b));
  const stop3 = reactimate1_(ch);
  // Configure the view for drag and drop. ForestStore DND isn't working so do this manually.
  const targets = dragTargets(info);
  Gtk.treeViewEnableModelDragSource(vw, [Gdk.ModifierTypeButton1Mask], targets, [Gdk.DragActionCopy, Gdk.DragActionMove]);
  Gtk.treeViewEnableModelDragDest(vw, targets, [Gdk.DragActionCopy, Gdk.DragActionMove]);
  Gtk.onWidgetDragMotion(vw, (context, x1, y1, t) => dragMotionHandler(info, store, vw, context, x1, y1, t));
  Gtk.onWidgetDragDrop(vw, (context, x1, y1, t) => dragDropHandler(sendEditEvent, info, store, vw, context, x1, y1, t));
  // Insertion of new tree elements
  const [insertion, insertHandler] = B.newEvent<Insertion>();
  const insertsNoDialog: B.Event<readonly [readonly [Path, number], Maybe<any>]> = dSel.tag === "Just"
    ? B.mapE(
      ([, [pn, v]]: readonly [any, Insertion]) => [pn, Just(v)] as const,
      B.filterE(
        ([env1, [, v]]: readonly [any, Insertion]) => isNothing(dSel.value(env1, v)),
        B.apply(B.mapB((env1: any) => (ins: Insertion): readonly [any, Insertion] => [env1, ins], envC.changesB), insertion),
      ),
    )
    : B.never();
  const inserts: B.Event<readonly [readonly [Path, number], Maybe<any>]> = dSel.tag === "Just"
    ? mkGtkPopupSelect(vw, iconTheme, envC, disableApply1(dSel.value), insertion)
    : B.never();
  const stop6 = reactimate1(B.mapE(([[path, n], mVal]: readonly [readonly [Path, number], Maybe<any>]) => () => {
    if (mVal.tag === "Nothing") return; // Cancel pressed.
    Gtk.forestStoreInsert(store, path, n, mVal.value);
    sendEditEvent();
  }, B.unionWith(constFirst, inserts, insertsNoDialog)));
  // Activation of existing tree elements.
  const activations = B.filterJust(registerIOSignal2(vw, Gtk.onTreeViewRowActivated, (path1: Path, _c: Gtk.TreeViewColumn) => {
    const path2 = Gtk.treePathCopy(path1); // path1 gets deallocated after exit.
    const t = Gtk.forestStoreLookup(store, path2);
    if (t === null) {
      return cannotHappen("Render ForestEditorSpec: path for activated item does not exist.", [null, Nothing] as const);
    }
    return [null, Just([path2, t.rootLabel] as const)] as const;
  }));
  const edits: B.Event<[Path, Maybe<any>]> = dSel.tag === "Just"
    ? mkGtkPopupSelect(vw, iconTheme, envC, dSel.value, activations)
    : B.never();
  const stop4 = reactimate1(B.mapE(([path, mVal]: [Path, Maybe<any>]) => () => {
    if (mVal.tag === "Nothing") return;
    Gtk.forestStoreSetValue(store, path, mVal.value);
    sendEditEvent();
  }, edits));
  // Context menus
  const menuClick = B.filterJust(registerIOSignal1(vw, Gtk.onWidgetButtonPressEvent, (ev: Gdk.EventButton) => buttonHandler(store, vw, ev)));
  const menuEvent = B.execute(B.mapE((m: Menu<readonly [Maybe<Path>, TreeOper<any>]>) => () => mkGtkMenu(m), menuClick));
  popupMenuOn(B.mapE((p: [Gtk.Menu, B.Event<readonly [Maybe<Path>, TreeOper<any>]>]) => p[0], menuEvent));
  const menuEventOut = B.switchE(B.mapE((p: [Gtk.Menu, B.Event<readonly [Maybe<Path>, TreeOper<any>]>]) => p[1], menuEvent));
  const stop5 = reactimate1(B.mapE((s: readonly [Maybe<Path>, TreeOper<any>]) => () =>
    processMenuSelection(insertHandler, sendEditEvent, store, s), menuEventOut));
  // Final widget set-up
  Gtk.treeViewSetEnableTreeLines(vw, true);
  Gtk.treeViewExpandAll(vw);
  const scroll = Gtk.new_(Gtk.ScrolledWindow, {
    propagateNaturalHeight: true,
    propagateNaturalWidth: true,
    hexpand: true,
    vexpand: true,
  });
  Gtk.containerAdd(scroll, vw);
  const w = Gtk.toWidget(scroll);
  Gtk.widgetShowAll(w);
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
    stop3();
    stop4();
    stop5();
    stop6();
  });
  return GadgetOut(
    [w],
    B.never(),
    initial,
    B.mapE((f: Forest<any>) => GadgetData(true, f), editEvent),
    B.mapB((f: Forest<any>) => GadgetData(true, f), editB),
  );
}

function renderGadget_FilePathSelector(
  wInit: WInit, initial: GD, e: B.Event<GD>, b: B.Behavior<GD>,
  title: T.Text, purpose: FilePathPurpose, filterList: readonly FilePathFilter[], confirmFlag: boolean,
): Out {
  // Web: the native file chooser is asynchronous.
  const fileDialog = async (entry: Gtk.Entry): Promise<Maybe<GadgetData<string>>> => {
    const d = Gtk.new_(Gtk.FileChooserNative, {
      action: ((): Gtk.FileChooserAction => {
        switch (purpose) {
          case "FilePathOpen": return Gtk.FileChooserActionOpen;
          case "FilePathSave": return Gtk.FileChooserActionSave;
          case "FilePathFolder": return Gtk.FileChooserActionSelectFolder;
          default: return absurd(purpose);
        }
      })(),
      title,
    });
    const parentWin = Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(entry));
    if (parentWin !== null) Gtk.set(d, { transientFor: parentWin });
    for (const [lbl, filters] of filterList) {
      const filt = Gtk.fileFilterNew();
      Gtk.fileFilterSetName(filt, lbl);
      for (const f of filters) {
        switch (f.tag) {
          case "FilePathGlob": Gtk.fileFilterAddPattern(filt, f._0); break;
          case "FilePathMime": Gtk.fileFilterAddMimeType(filt, f._0); break;
          case "FilePathImages": Gtk.fileFilterAddPixbufFormats(filt); break;
          default: absurd(f);
        }
      }
      Gtk.fileChooserAddFilter(d, filt);
    }
    Gtk.fileChooserSetDoOverwriteConfirmation(d, confirmFlag);
    const path = Gtk.getEntryText(entry);
    if (!T.isNull(path)) Gtk.fileChooserSetFilename(d, T.unpack(path));
    const result = await Gtk.nativeDialogRun(d);
    if (result === Gtk.ResponseTypeAccept) {
      const mTarget = Gtk.fileChooserGetFilename(d);
      Gtk.nativeDialogDestroy(d);
      return mTarget === null ? Nothing : Just(GadgetData(true, mTarget));
    }
    Gtk.nativeDialogDestroy(d);
    return Nothing;
  };
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true, widthChars: 30 });
  wInit(entry);
  Gtk.setEntryText(entry, T.pack(initial._gdValue));
  Gtk.setEntryEditable(entry, false);
  // We can assume that the Entry widget already sets the ButtonPressMask for its window.
  const activated = registerIOSignal1(entry, Gtk.onWidgetButtonPressEvent, (ev: Gdk.EventButton) => {
    const btn = Gdk.getEventButtonButton(ev);
    return btn === 1 ? [true, Just(null)] as const : [false, Nothing] as const;
  });
  // Web: Haskell `mapEventIO (\() -> fileDialog entry)` blocks in the chooser. Here the click
  // starts the chooser and the edited value fires when it is closed.
  const [editedValue0, fireEdited] = B.newEvent<Maybe<GadgetData<string>>>();
  B.reactimate(B.mapE(() => () => {
    void fileDialog(entry).then(fireEdited, (err: unknown) => {
      void errorBox(entry, "Could not open the file chooser.\n\nTechnical details: " + String(err));
    });
  }, B.filterJust(activated)));
  const editedValue = B.filterJust(editedValue0);
  const allEvents = B.unionWith(constFirst, editedValue, e);
  const update = (w: Gtk.Entry, gd: GD): void => {
    if (gd._gdOk) Gtk.setEntryText(w, T.pack(gd._gdValue));
  };
  eventLink(entry, update, allEvents);
  behaviorLink(entry, update, b);
  const w = Gtk.toWidget(entry);
  return GadgetOut([w], B.never(), initial, editedValue, b);
}

function renderGadget_Trace(
  iconTheme: Gtk.IconTheme, wInit: WInit, env: any, initial: GD, envC: Changes<any>, e: B.Event<GD>, b: B.Behavior<GD>,
  lbl: string, inF: (i: any) => string, outF: (i: any, o: any) => string, g: AnyGadget,
): Out {
  // hPutStrLn stderr
  const hPutStrLn = (s: string): void => console.error(s);
  const inF1 = (gd: GD): string => (gd._gdOk ? inF(gd._gdValue) : "Invalid: " + inF(gd._gdValue));
  const outF1 = (gi: GD, go: GD): string =>
    "(" + showBool(gi._gdOk) + "," + showBool(go._gdOk) + ")" + outF(gi._gdValue, go._gdValue);
  const result = renderGadget(iconTheme, wInit, env, initial, envC, e, b, g);
  hPutStrLn("Initialising " + lbl + ": " + inF(initial._gdValue) + " -> " + outF1(initial, result.gadgetInitial));
  const inE = B.mapE(inF1, e);
  const outE = B.apply(B.mapB((i: GD) => (o: GD) => outF1(i, o), b), result.gadgetUser);
  const inB = B.mapB(inF1, b);
  const outB = B.liftA2B(outF1, b, result.gadgetValue);
  B.reactimate(B.mapE((s: string) => () => hPutStrLn(lbl + " output event: " + s), outE));
  B.reactimate(B.mapE((s: string) => () => hPutStrLn(lbl + " input event: " + s), inE));
  const ch1 = B.changes(B.mapB((s: string) => () => hPutStrLn(lbl + " input behav: " + s), inB));
  B.reactimatePrime(ch1);
  const ch2 = B.changes(B.mapB((s: string) => () => hPutStrLn(lbl + " output behav: " + s), outB));
  B.reactimatePrime(ch2);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Widget helpers

/**
 * Text box with an extra source of events.
 *
 * @param wInit Run on all newly created widgets.
 * @param initial Initial value for display.
 * @param e User-driven updates.
 * @param b Background updates.
 * @param prsm Relationship between displayed text and value.
 * @param popoverF Should create a popover for the entry.
 */
function textBoxWithPopup<A>(
  wInit: WInit,
  initial: GadgetData<A>,
  e: B.Event<GadgetData<A>>,
  b: B.Behavior<GadgetData<A>>,
  prsm: Prism<T.Text, A>,
  popoverF: (entry: Gtk.Entry) => B.Event<T.Text>,
): [Gtk.Widget, B.Event<GadgetData<A>>] {
  const updateText = (w: Gtk.Entry, nw: T.Text): void => {
    const old = Gtk.entryGetText(w);
    if (nw !== old) Gtk.setEntryText(w, nw);
  };
  const entry = Gtk.new_(Gtk.Entry, { hexpand: true });
  wInit(entry);
  const styleCtx = Gtk.widgetGetStyleContext(entry);
  const toText = (x: GadgetData<A>): GadgetData<T.Text> => gdFmap((v: A) => review(prsm, v), x);
  const [w, outE] = makeField(entry, entryChangedSignal, updateText, toText(initial), B.mapE(toText, e), B.mapB(toText, b), () => {
    const t = Gtk.entryGetText(entry);
    const v = preview(prsm, t);
    switch (v.tag) {
      case "Nothing":
        Gtk.styleContextAddClass(styleCtx, "entry-error");
        return Nothing;
      case "Just":
        Gtk.styleContextRemoveClass(styleCtx, "entry-error");
        return Just(v.value);
      default:
        return absurd(v);
    }
  });
  const textE = popoverF(entry);
  const stop = reactimate1(B.mapE((newText: T.Text) => () => {
    const oldText = Gtk.entryGetText(entry);
    if (oldText !== newText) Gtk.entrySetText(entry, newText);
  }, textE));
  Gtk.onWidgetDestroy(entry, stop);
  return [w, outE];
}

/** CSS class names for memo box sizes. */
function memoBoxCss(size: MemoBoxSize): T.Text {
  switch (size) {
    case "MemoSmall": return "memo-small";
    case "MemoMedium": return "memo-medium";
    case "MemoLarge": return "memo-large";
    default: return absurd(size);
  }
}

/**
 * The old @Entry changed@ signal has disappeared, so this simulates it by triggering on
 * insertions and deletions in the buffer. In fact there are two signal handlers, but only
 * one is returned in accordance with the type. Since these are ignored anyway it doesn't matter.
 *
 * Web: the toolkit's entry buffer only signals user edits, while the entry's own "changed"
 * signal is emitted once for every change of the text, whether by the user or by
 * `entrySetText` (as the GTK buffer signals are). Connecting to it keeps the Haskell behaviour
 * that programmatic changes (the date popover, the colour chooser) are reported.
 */
function entryChangedSignal(entry: Gtk.Entry, action: () => void): Gtk.SignalHandlerId {
  // buf <- Gtk.entryGetBuffer entry
  // void $ Gtk.onEntryBufferDeletedText buf $ \_ _ -> action
  // Gtk.onEntryBufferInsertedText buf $ \_ _ _ -> action
  return Gtk.onEditableChanged(entry, action);
}

/**
 * Create a new field widget with the plubming for setting the value and triggering events.
 *
 * @param widget Widget.
 * @param signal Signal for a change in widget display value.
 * @param setter Setter for widget display value.
 * @param initial The initial value to display.
 * @param e The value to display.
 * @param getValue Get current user value from widget, if valid.
 */
function makeField<Wd extends Gtk.Widget, V, A>(
  widget: Wd,
  signal: (w: Wd, act: () => void) => Gtk.SignalHandlerId,
  setter: (w: Wd, v: V) => void,
  initial: GadgetData<V>,
  e: B.Event<GadgetData<V>>,
  b: B.Behavior<GadgetData<V>>,
  getValue: () => Maybe<A>,
): [Gtk.Widget, B.Event<GadgetData<A>>] {
  setter(widget, initial._gdValue);
  const blockSignals = newIORef(false);
  const valueChanged = B.filterJust(registerIOSignal(widget, signal, () => {
    const blockFlag = readIORef(blockSignals);
    if (blockFlag) return [null, Nothing] as const;
    return [null, Just(mapMaybeValue((v: A) => GadgetData(true, v), getValue()))] as const;
  }));
  const stop1 = reactimate1(B.mapE((gd: GadgetData<V>) => () => {
    if (gd._gdOk) setter(widget, gd._gdValue);
  }, e));
  const ch = B.changes(B.mapB((gd: GadgetData<V>) => () => {
    if (gd._gdOk) {
      writeIORef(blockSignals, true);
      setter(widget, gd._gdValue);
      writeIORef(blockSignals, false);
    }
  }, b));
  const stop2 = reactimate1_(ch);
  Gtk.onWidgetDestroy(widget, () => {
    stop1();
    stop2();
  });
  const w = Gtk.toWidget(widget);
  return [w, B.filterJust(valueChanged)];
}

/**
 * Wrap a list of widgets up in a box. If the list contains just one widget
 * then no box is created and the widget is returned on its own. If the list is empty then @Nothing@
 * is returned.
 *
 * @param wInit Run on all newly created widgets.
 */
export function boxWidgets(wInit: WInit, orient: Orientation, ws: readonly Gtk.Widget[]): Maybe<Gtk.Widget> {
  if (ws.length === 0) return Nothing;
  if (ws.length === 1) return Just(ws[0]);
  const gtkOrient = ((): Gtk.Orientation => {
    switch (orient) {
      case "Vertical": return Gtk.OrientationVertical;
      case "Horizontal": return Gtk.OrientationHorizontal;
      default: return absurd(orient);
    }
  })();
  const boxWidget = Gtk.boxNew(gtkOrient, 3);
  wInit(boxWidget);
  for (const w of ws) Gtk.boxPackStart(boxWidget, w, true, true, 0);
  const w = Gtk.toWidget(boxWidget);
  return Just(w);
}

// Specialisations of Nothing to satisfy the type system.
const noAdjustment: Gtk.Adjustment | null = null;

const noWidget: Gtk.Widget | null = null;

const noTreeViewColumn: Gtk.TreeViewColumn | null = null;

const noTreeIter: Gtk.TreeIter | null = null;

const noPixbuf: Gdk.Pixbuf | null = null;

// Size of data icons in dialogs.
const iconSize = 48;
