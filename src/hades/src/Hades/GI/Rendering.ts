// Ported from hades/src/Hades/GI/Rendering.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module provides a GTK and Cairo implementation of the abstract diagram editing given by
 * the "Delta" monad in "Hades.Abstract.Delta". The "makeDrawingGtk" function takes a diagram with
 * elements of type @v@ and displays it in a scrolling window. Mouse events are interpreted to edit
 * the diagram, with diagram updates made available through events carrying "HadesActionResult"
 * values. These values are wrapped in an application monad @m@, so by extracting the result the
 * associated actions will be applied.
 *
 * TypeScript port
 * ---------------
 * * `makeDrawingGtk` takes the `Connectable` dictionary of its constraint first.
 * * `hadesActionExecute` runs in the base monad @Base v@: it is a generator in the base monad's
 *   protocol whose first argument is the base context (`d.base` of the Delta computation, see
 *   §7.3 of PORTING.md). When the base monad is a `ModelScript` it is called from a script as
 *   `yield* hadesActionExecute(ctx, hades, actions)`; when it is plain IO use
 *   `runInner(hadesActionExecute(null, hades, actions))`.
 * * The Delta continuation (Haskell "DeltaNext v") is a `HadesMachine`, see below. The
 *   `hadesState` lens views it; `streamStateT` of it is the "DeltaState" at that point.
 * * `HadesRender` is the function-of-environment representation from "Hades.GI.BasicShapes".
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe, appendMaybe, fmapMaybe, fromMaybe, mapMaybe, orElse } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { lens, modifying, multiplying, to, view, type Lens } from "@/lib/Control/Lens";
import { type IORef, ceiling, logBase, newIORef, readIORef, readInt, round, writeIORef } from "@/lib/Prelude";
import type { UUID } from "@/lib/Data/UUID";
import { reactimate1 } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { behaviorLink, eventLink, registerIOSignal } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { mkGtkMenu, popupMenuOn } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Menu";
import { streamStateT } from "../Abstract/AutoMonad";
import { type KeyCommands, processAction } from "../Abstract/Commands";
import type { Connectable } from "../Abstract/Connections";
import {
  type Action, type ActionOutput, type BaseInstruction, type DeltaCtx, type DeltaNext, type DeltaState,
  type View, type ViewContext, Action as mkAction, Activate, Drag, EndDrag, Key, Modifiers, Select, ViewSet,
  applyDelta, deltaDiagram, deltaZoom, mempty_ViewSet, mkDiagramState, mkScriptAction, startDelta, tellAll,
  viewSetBoundBox, yieldViews,
} from "../Abstract/Delta";
import { type Diagram, diagramOrder } from "../Abstract/Diagram";
import { type BoundBox, type Scale, BoundBox as mkBoundBox, NoBox, Point, growBox, pX, pY, pointDiff } from "../Abstract/Geometry";
import { type HadesRender, type HadesStyle, renderWithHades, runHadesRender } from "./BasicShapes";
import { type MouseCommand, mouseCommandEvent } from "./MouseMachine";

// ---------------------------------------------------------------------------------------------
// Hades on GTK

/**
 * The Delta stream processor of a "HadesGtk" (the Haskell @DeltaNext v@).
 *
 * Web: a Haskell "DeltaNext" is an immutable continuation, so an old "HadesGtk" value can be used
 * again: an editor resets its state behavior to the initial "HadesGtk" on refresh, and the script
 * interpreter re-runs a script (and so "hadesActionExecute") to emulate multi-shot continuations.
 * JavaScript generators are one-shot. A `HadesMachine` therefore holds its own snapshot of the
 * "DeltaState" (`cell`), the running generator it continues (`gen`, with its context `ctx`) and a
 * record shared by all machines continuing the same generator (`live`) naming the one machine
 * that may resume it. Applying an action to any other machine (a stale one, or one whose run was
 * abandoned or failed) starts a fresh Delta machine from that machine's snapshot with `restart`.
 * At a quiescent point (between commands) this is exactly equivalent to resuming the old
 * continuation; in the middle of a multi-action command such as a drag it restarts the command.
 */
export interface HadesMachine<V> extends DeltaNext<V> {
  /** Context of the running generator. */
  readonly ctx: DeltaCtx<V>;
  /** Start a fresh machine from a state. */
  readonly restart: (s: DeltaState<V>) => HadesMachine<V>;
  /** The machine that may resume the running generator, if any. */
  readonly live: { current: HadesMachine<V> | null };
}

/** Top level state for a Hades diagram editor in the GTK environment. */
export interface HadesGtk<V> {
  /** "runDelta" input and output. */
  readonly _hadesState: HadesMachine<V>;
  /** Currently drawn "View"s */
  readonly _hadesViews: ViewSet<V>;
  /** Currently drawn transient views. */
  readonly _hadesTransients: ViewSet<V>;
  /** Canvas for the Hades editor. */
  readonly hadesCanvas: Gtk.DrawingArea;
  /** Action to paint diagram updates. */
  readonly hadesPaint: IORef<HadesRender<void>>;
}

/* Design Note:

The hadesPaint IORef is used to communicate between the diagram update code and the "on" event
which is triggered when the canvas is to be repainted. This is a kludge, but it works and its
not visible outside this module.

In the longer term this code needs to be ported to Reactive Banana, which would use events
and behaviors for the same thing.

Its also a design issue that the lens components of HadesGtk are in fact abstract, while the
canvas and paint members are GTK-specific. This suggests that the type should be refactored to
move the abstract stuff back over to the Hades.Abstract hierarchy.
*/

/** "runDelta" input and output. */
export function hadesState<V = any>(): Lens<HadesGtk<V>, HadesMachine<V>> {
  return lens((h: HadesGtk<V>) => h._hadesState, (h, v: HadesMachine<V>) => ({ ...h, _hadesState: v }));
}

/** Currently drawn "View"s */
export function hadesViews<V = any>(): Lens<HadesGtk<V>, ViewSet<V>> {
  return lens((h: HadesGtk<V>) => h._hadesViews, (h, v: ViewSet<V>) => ({ ...h, _hadesViews: v }));
}

/** Currently drawn transient Views. */
export function hadesTransients<V = any>(): Lens<HadesGtk<V>, ViewSet<V>> {
  return lens((h: HadesGtk<V>) => h._hadesTransients, (h, t: ViewSet<V>) => ({ ...h, _hadesTransients: t }));
}

/** @hades ^. hadesState . to streamStateT@ */
function hadesDeltaState<V>(hades: HadesGtk<V>): DeltaState<V> {
  return view(hadesState<V>().dot(to((m: HadesMachine<V>) => streamStateT(m))), hades);
}

/** @hades ^. hadesState . to streamStateT . deltaZoom@ */
function hadesZoom<V>(hades: HadesGtk<V>): Scale {
  return view(deltaZoom<V>(), hadesDeltaState(hades));
}

/** @hades ^. hadesState . to streamStateT . deltaDiagram . diagramOrder@ */
function hadesOrder<V>(hades: HadesGtk<V>): readonly UUID[] {
  return view(deltaDiagram<V>().dot(diagramOrder<V>()), hadesDeltaState(hades));
}

/**
 * The initial "HadesMachine" for a diagram (Haskell
 * @startStreamT1 (stepDelta . processAction drawSelectionBox keyCommands) dState@).
 */
function startHadesMachine<V>(
  cls: Connectable<V>,
  keyCommands: KeyCommands<V>,
  state0: DeltaState<V>,
): HadesMachine<V> {
  const restart = (s: DeltaState<V>): HadesMachine<V> => {
    const d = startDelta<V>(cls, (dc, a) => processAction(dc, drawSelectionBox, keyCommands, a), s);
    const m: HadesMachine<V> = { gen: null, start: d.start, cell: { state: s }, ctx: d.ctx, restart, live: { current: null } };
    m.live.current = m;
    return m;
  };
  return restart(state0);
}

/**
 * Pass an action to a "HadesMachine" (Haskell "applyInputT"), returning the output and the new
 * machine. This runs in the base monad of the diagram: base-monad instructions yielded by the
 * Delta computation are passed on to the caller.
 */
function* applyHadesInput<V>(
  base: any,
  m: HadesMachine<V>,
  action: Action<V>,
): Generator<BaseInstruction, [ActionOutput<V>, HadesMachine<V>], any> {
  // Web: resume the running generator only if this machine is its latest state (see HadesMachine).
  const runner = m.live.current === m ? m : m.restart(m.cell.state);
  const live = runner.live;
  live.current = null; // While running, and after a failure, no machine may resume the generator.
  runner.ctx.cell.state = m.cell.state;
  const nxt = { gen: runner.gen, start: runner.start, cell: runner.ctx.cell, ctx: runner.ctx };
  const [output] = yield* applyDelta(base, nxt, action);
  const next: HadesMachine<V> = {
    gen: nxt.gen,
    start: runner.start,
    cell: { state: runner.ctx.cell.state },
    ctx: runner.ctx,
    restart: runner.restart,
    live,
  };
  live.current = next;
  return [output, next];
}

/** Hades diagram coordinates of the mouse position. */
function hadesPosition<V>(hades: HadesGtk<V>, [px, py]: readonly [number, number]): Point {
  const zm = hadesZoom(hades);
  return Point(px / zm, py / zm);
}

/** Find the top-most "View" object in the diagram at the point. */
function hadesTarget<V>(hades: HadesGtk<V>, pt: Point): Maybe<[UUID, View<V>]> {
  const viewMap = view(hadesViews<V>(), hades)._0;
  const transientMap = view(hadesTransients<V>(), hades)._0;
  const order = hadesOrder(hades);
  const vs = mapMaybe((u: UUID) => fmapMaybe((v: View<V>): [UUID, View<V>] => [u, v], M.lookup(u, viewMap)), order);
  const ts = M.toList(transientMap);
  const r = [...ts, ...vs].find(([, v]) => v.viewTouched(pt));
  return r === undefined ? Nothing : Just(r);
}

/** The current boundbox of the diagram. */
function hadesDiagramBounds<V>(hades: HadesGtk<V>): BoundBox {
  return viewSetBoundBox(view(hadesViews<V>(), hades));
  // Note: this may be too slow. Perhaps we need to memoise it.
}

/** The current size (width, height) of the diagram in pixels. */
function hadesDiagramSize<V>(hades: HadesGtk<V>): [number, number] {
  const zm = hadesZoom(hades);
  const b = hadesDiagramBounds(hades);
  switch (b.tag) {
    case "BoundBox": return [ceiling(b._1._pX * zm), ceiling(b._1._pY * zm)];
    case "NoBox": return [0, 0];
  }
}

/**
 * Create an empty diagram within a GTK DrawingArea. The DrawingArea is added to the Container
 * inside a scrolled viewport.
 *
 * Returns the scrolled window containing the drawing and updates to the drawing state as events
 * containing actions. The caller is responsible for applying these actions to the diagram behavior
 * and thereby updating the behavior.
 */
export function makeDrawingGtk<V>(
  cls: Connectable<V>,
  /** The diagram to start editing. */
  diagram: Diagram<V>,
  /** The application context for this diagram. Read by @use deltaContext@. */
  ctx: ViewContext<V>,
  /** Context menu for the diagram background. */
  backgroundMenu: Maybe<(p: Point) => Menu<Action<V>>>,
  /** The command keys for this diagram. */
  keyCommands: KeyCommands<V>,
  /** The style in which this diagram is to be rendered. */
  style: HadesStyle,
  /** The initial zoom factor for the display. */
  z: Scale,
  /** The current state of the drawing. */
  hadesB: B.Behavior<HadesGtk<V>>,
): [Gtk.Widget, HadesGtk<V>, B.Event<Action<V>[]>] {
  // Create the diagram state.
  const canvas = Gtk.drawingAreaNew();
  const gtkStyle = Gtk.widgetGetStyleContext(canvas);
  Gtk.widgetSetName(canvas, "hades-diagram");
  Gtk.styleContextAddClass(gtkStyle, "hades-diagram");
  Gtk.widgetSetCanFocus(canvas, true);
  Gtk.widgetSetFocusOnClick(canvas, true);
  const paintRef = newIORef<HadesRender<void>>(() => {});
  const dState: DeltaState<V> = mkDiagramState(ctx, z, diagram);
  const machine: HadesMachine<V> = startHadesMachine(cls, keyCommands, dState);
  const hadesInit: HadesGtk<V> = {
    _hadesState: machine,
    _hadesViews: mempty_ViewSet<V>(),
    _hadesTransients: mempty_ViewSet<V>(),
    hadesCanvas: canvas,
    hadesPaint: paintRef,
  };

  const zoomAction = (d: number): Action<V>[] => [mkScriptAction<V>(function* (dc) {
    multiplying(dc, deltaZoom<V>(), d);
    modifying(dc, deltaZoom<V>(), (x: number) => Math.max(1 / zoomLimit, Math.min(zoomLimit, x)));
    yield* tellAll(dc);
    return yield* yieldViews(dc);
  })];

  const mouseToAction = (
    hades: HadesGtk<V>,
    mc: MouseCommand,
  ): Either<
    Either<Action<V>, Maybe<Menu<Action<V>>>>,
    Either<
      readonly [number, number], // Diagram scroll distance
      number // Mouse wheel zoom factor
    >
  > => {
    if (mc.tag === "MouseZoom") return Right(Right(mc._0));
    const loc = hadesPosition(hades, mc.mouseLocation);
    const gtkMods = mc.mouseModifiers;
    const mods = Modifiers(
      gtkMods.includes(Gdk.ModifierTypeShiftMask),
      gtkMods.includes(Gdk.ModifierTypeControlMask),
      gtkMods.includes(Gdk.ModifierTypeMod1Mask),
    );
    const targetView = hadesTarget(hades, loc);
    const menu = orElse(fmapMaybe(([, v]: [UUID, View<V>]) => v.viewMenu, targetView), backgroundMenu);
    const zm = hadesZoom(hades);
    const mt = mc.mouseType;
    switch (mt.tag) {
      case "SingleClick": return Left(Left(mkAction(Select, loc, mods, targetView)));
      case "DoubleClick": return Left(Left(mkAction(Activate, loc, mods, targetView)));
      case "RightClick": return Left(Right(fmapMaybe((f: (p: Point) => Menu<Action<V>>) => f(loc), menu))); // Context menu.
      case "MouseDrag": {
        const [mdx, mdy] = mt._0;
        if (mods.modCtrl) return Right(Left([mdx, mdy] as const));
        return Left(Left(mkAction(Drag<V>([mdx / zm, mdy / zm]), loc, mods, targetView)));
      }
      case "MouseEndDrag": {
        const [mdx, mdy] = mt._0;
        return Left(Left(mkAction(EndDrag<V>([mdx / zm, mdy / zm]), loc, mods, targetView)));
      }
      case "MouseKey": return Left(Left(mkAction(Key<V>(mt._0), loc, mods, targetView)));
    }
  };

  const adjustDrag = (adj: Gtk.Adjustment, d: number): void => {
    const p = Gtk.adjustmentGetValue(adj);
    Gtk.adjustmentSetValue(adj, p - d);
  };
  const dragScroll = (scroll: Gtk.ScrolledWindow, scrollEvent: B.Event<readonly [number, number]>): (() => void) => {
    const hAdj = Gtk.scrolledWindowGetHadjustment(scroll);
    const vAdj = Gtk.scrolledWindowGetVadjustment(scroll);
    const stopH = reactimate1(B.mapE(([dx]: readonly [number, number]) => () => adjustDrag(hAdj, dx), scrollEvent));
    const stopV = reactimate1(B.mapE(([, dy]: readonly [number, number]) => () => adjustDrag(vAdj, dy), scrollEvent));
    return () => { // Returned to caller, not executed now.
      stopH();
      stopV();
    };
  };

  // Set up Reactive Banana circuit
  const mouseCommands = mouseCommandEvent(canvas);
  const [diagramActions, screenActions] = B.split(
    B.apply(B.mapB((h: HadesGtk<V>) => (mc: MouseCommand) => mouseToAction(h, mc), hadesB), mouseCommands));
  const [mouseActions, menus] = B.split(diagramActions);
  const [scrollEvent, zoomEvent] = B.split(screenActions);
  const gtkMenus = B.execute(B.mapE((m: Menu<Action<V>>) => () => mkGtkMenu(m), B.filterJust(menus)));
  popupMenuOn(B.mapE(([m]: [Gtk.Menu, B.Event<Action<V>>]) => m, gtkMenus));
  const menuOutputs = B.switchE(B.mapE(([, e]: [Gtk.Menu, B.Event<Action<V>>]) => e, gtkMenus));
  const mapEventsRef: B.Event<Action<V>[]> = B.lazyE(() => mapEvents);
  const hadesActions = [
    B.mapE((a: Action<V>) => [a], mouseActions),
    B.mapE((a: Action<V>) => [a], menuOutputs),
    B.mapE(zoomAction, zoomEvent),
    mapEventsRef,
  ].reduceRight((acc, e) => B.unionWith((a: Action<V>[], b: Action<V>[]) => [...a, ...b], e, acc));
  // Create the DrawingArea and set it up in the frame.
  const scroll = makeScrollingWidget(canvas, B.mapB(hadesDiagramSize, hadesB));
  const stop = dragScroll(scroll, scrollEvent);
  Gtk.onWidgetDestroy(scroll, stop);
  Gtk.onWidgetDraw(canvas, (gtkCtx: Cairo.Context) => {
    const drawAction = readIORef(paintRef);
    renderWithHades(gtkCtx, style, drawAction);
    return true;
  });
  // Get the initial diagram drawn on the canvas
  const mapEvents: B.Event<Action<V>[]> = registerIOSignal(scroll, Gtk.afterWidgetMap,
    () => [undefined, [mkScriptAction<V>(function* (dc) {
      yield* tellAll(dc);
      return yield* yieldViews(dc);
    })]] as const);
  // Refresh when diagram gets focus.
  const w = Gtk.toWidget(scroll);
  return [w, hadesInit, hadesActions];
}

// ---------------------------------------------------------------------------------------------
// Actions on the Diagram

/** The result of applying an "Action" to the Hades state. */
export interface HadesActionResult<V> {
  /** The updated diagram state. */
  readonly hadesActionNewState: HadesGtk<V>;
  /** Execute this to update the diagram on the screen. */
  readonly hadesActionDraw: () => void;
  /** If this action resulted in an undo checkpoint then the text describes it. */
  readonly hadesActionCheckpoint: Maybe<string>;
  /**
   * If one or more actions call for a properties dialog then these are the elements for
   * the dialogs. The dialog updates will feed event actions back into "makeDrawingGtk".
   */
  readonly hadesActionProperties: readonly V[];
}
export function HadesActionResult<V>(
  hadesActionNewState: HadesGtk<V>,
  hadesActionDraw: () => void,
  hadesActionCheckpoint: Maybe<string>,
  hadesActionProperties: readonly V[],
): HadesActionResult<V> {
  return { hadesActionNewState, hadesActionDraw, hadesActionCheckpoint, hadesActionProperties };
}

/**
 * Executes Hades Actions and accumulates the results in monad @Base v@.
 *
 * A generator in the base monad's protocol; `base` is the base monad's context.
 */
export function* hadesActionExecute<V>(
  base: any,
  /** Initial state. */
  initial: HadesGtk<V>,
  /** Actions that update the diagram state. */
  actions: readonly Action<V>[],
): Generator<BaseInstruction, HadesActionResult<V>, any> {
  // Accumulate changes and associated actions.
  function* procInput(r1: HadesActionResult<V>, act: Action<V>): Generator<BaseInstruction, HadesActionResult<V>, any> {
    const r2 = yield* hadesAction(base, r1.hadesActionNewState, act);
    const drw1 = r1.hadesActionDraw;
    const drw2 = r2.hadesActionDraw;
    return HadesActionResult(
      r2.hadesActionNewState,
      () => {
        drw1();
        drw2();
      },
      appendMaybe(T.append, r1.hadesActionCheckpoint, r2.hadesActionCheckpoint),
      [...r1.hadesActionProperties, ...r2.hadesActionProperties],
    );
  }
  // Convert to HadesActionResult
  const wrapResult = (h: HadesGtk<V>): HadesActionResult<V> => HadesActionResult(h, () => {}, Nothing, []);
  let acc = wrapResult(initial);
  for (const act of actions) acc = yield* procInput(acc, act);
  return acc;
}

/**
 * Applies a user "Action" to a "HadesGtk" state. The result encapsulates the new state
 * and any action in the inner monad that may be called for.
 */
function* hadesAction<V>(
  base: any,
  hades: HadesGtk<V>,
  action: Action<V>,
): Generator<BaseInstruction, HadesActionResult<V>, any> {
  const nonNullViews = (m: M.Map<UUID, View<V>>): M.Map<UUID, View<V>> =>
    M.filter((v: View<V>) => v.viewBox.tag !== "NoBox", m);
  const [output, newState] = yield* applyHadesInput(base, view(hadesState<V>(), hades), action);
  // Compute the updates to the views in the HadesGtk state based on the output.
  const updates = output.outViews._0;
  const oldViews = view(hadesViews<V>(), hades)._0;
  const unchangedViews = M.difference(oldViews, updates);
  const transientUpdates = output.outTransients._0;
  const oldTransients = view(hadesTransients<V>(), hades)._0;
  const unchangedTransients = M.difference(oldTransients, transientUpdates);
  const newViews = nonNullViews(updates);
  const newTransients = nonNullViews(transientUpdates);
  // The updated HadesGtk state resulting from the output.
  const newHades: HadesGtk<V> = {
    ...hades,
    _hadesState: newState,
    _hadesViews: ViewSet(M.union(newViews, unchangedViews)),
    _hadesTransients: ViewSet(M.union(newTransients, unchangedTransients)),
  };
  // The IO action to draw the updates. Adds an arbitrary bit of slop around the
  // changes for safety.
  const drawAction = (): void => {
    writeIORef(newHades.hadesPaint, repaint(newHades));
    Gtk.widgetQueueDraw(newHades.hadesCanvas);
  };
  return HadesActionResult(newHades, drawAction, output.outCheckpoint, output.outProperties);
}

/** Redraw the diagram in response to a Gtk.redraw signal. */
function repaint<V>(hades: HadesGtk<V>): HadesRender<void> {
  return (env) => {
    const vs = view(hadesViews<V>(), hades)._0;
    const ts = view(hadesTransients<V>(), hades)._0;
    const order = hadesOrder(hades);
    const viewList = mapMaybe((u: UUID) => M.lookup(u, vs), order);
    const z = hadesZoom(hades);
    const style = Gtk.widgetGetStyleContext(hades.hadesCanvas);
    const w = Gtk.widgetGetAllocatedWidth(hades.hadesCanvas);
    const h = Gtk.widgetGetAllocatedHeight(hades.hadesCanvas);
    Cairo.toRender((ctx) => Gtk.renderBackground(style, ctx, 0, 0, w, h))(env.cr);
    Cairo.scale(env.cr, z, z);
    for (const v of [...viewList].reverse()) v.viewDraw(env);
    for (const v of M.elems(ts)) v.viewDraw(env);
  };
}

/** Draw a box with thin dashed lines for area selection. */
function drawSelectionBox(p1: Point, p2: Point): HadesRender<void> {
  const adjust = (v: number): number => round(v) + 0.5;
  return ({ cr }) => {
    Cairo.setSourceRGB(cr, 0, 0, 0);
    const [dx, dy] = pointDiff(p1, p2);
    Cairo.rectangle(cr, adjust(view(pX, p1)), adjust(view(pY, p1)), dx, dy);
    Cairo.save(cr);
    Cairo.identityMatrix(cr);
    Cairo.setLineWidth(cr, 0.5);
    Cairo.setDash(cr, [3, 3], 0);
    Cairo.stroke(cr);
    Cairo.restore(cr);
  };
}

/**
 * Puts a widget into a GTK Viewport inside a GTK ScrolledWindow. The size of the
 * widget is controlled by a Behavior so it can be varied over time. Use @always (-1,-1)@
 * for the default size of the widget.
 */
function makeScrollingWidget(
  /** The widget to be made scrollable. */
  widget: Gtk.Widget,
  /** The width and height of the widget. */
  size: B.Behavior<readonly [number, number]>,
): Gtk.ScrolledWindow {
  // A scrolledWindow can take a non-scrolling widget and will automatically add a viewport.
  // However GTK then hooks up the scroll bars to the container focus adjustments, so that focus
  // grabs cause the scroll bars to move to the top left hand corner of the widget. This is the
  // Wrong Thing for a big diagram, so we avoid this "helpful" behaviour by manually creating a
  // viewport.
  const noAdjustment: Gtk.Adjustment | null = null;
  const vw = Gtk.viewportNew(noAdjustment, noAdjustment);
  Gtk.containerAdd(vw, widget);
  const scroll = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  Gtk.containerAdd(scroll, vw);
  Gtk.scrolledWindowSetPolicy(scroll, Gtk.PolicyTypeAutomatic, Gtk.PolicyTypeAutomatic);
  Gtk.scrolledWindowSetShadowType(scroll, Gtk.ShadowTypeIn);
  behaviorLink(widget, Gtk.setWidgetWidthRequest, B.mapB(([w]: readonly [number, number]) => w, size));
  behaviorLink(widget, Gtk.setWidgetHeightRequest, B.mapB(([, h]: readonly [number, number]) => h, size));
  return scroll;
}

/**
 * The bottom bar for a diagram. Currently contains a hint text and a scale widget.
 *
 * The resulting widget will follow the input scale and generate events when it changes.
 */
export function makeBottomBar(hintB: B.Behavior<Maybe<string>>, scaleB: B.Behavior<Scale>): [Gtk.Widget, B.Event<Scale>] {
  const txtToSlide = (v: number): number => logBase(zoomLimit, v / 100);
  const slideToTxt = (v: number): number => round(100 * Math.exp(v * Math.log(zoomLimit)));
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 0);
  // Set up hint widget.
  const hintBox = Gtk.labelNew(null);
  Gtk.labelSetSelectable(hintBox, false);
  behaviorLink(hintBox, Gtk.labelSetText, B.mapB((h: Maybe<string>) => fromMaybe("", h), hintB));
  Gtk.boxPackStart(bar, hintBox, false, false, 0);
  // Set up scale widgets.
  const slider = Gtk.scaleNewWithRange(Gtk.OrientationHorizontal, -1, 1, 0.1);
  const textBox = Gtk.entryNew();
  const scaleBox = Gtk.boxNew(Gtk.OrientationHorizontal, 2);
  Gtk.scaleSetDrawValue(slider, false);
  Gtk.widgetSetSizeRequest(slider, 100, -1);
  Gtk.rangeSetValue(slider, 0);
  Gtk.entrySetText(textBox, "100");
  Gtk.entrySetMaxLength(textBox, 3);
  Gtk.entrySetWidthChars(textBox, 3);
  const label1 = Gtk.labelNew("Scale =");
  const label2 = Gtk.labelNew("%");
  Gtk.boxPackStart(scaleBox, label1, false, false, 0);
  Gtk.boxPackStart(scaleBox, textBox, false, false, 0);
  Gtk.boxPackStart(scaleBox, label2, false, false, 0);
  Gtk.boxPackEnd(scaleBox, slider, false, false, 0);
  const textE = B.filterJust(registerIOSignal(textBox, Gtk.onEditableChanged, (): readonly [void, Maybe<number>] => {
    const str = Gtk.editableGetChars(textBox, 0, -1);
    const n = readInt(T.unpack(str));
    if (n.tag === "Just") {
      const s = txtToSlide(n.value);
      return s >= -1 && s <= 1 ? [undefined, Just(n.value)] : [undefined, Nothing];
    }
    return [undefined, Nothing];
  }));
  const sliderE = registerIOSignal(slider, Gtk.onRangeValueChanged, (): readonly [void, number] => {
    const z = Gtk.rangeGetValue(slider);
    return [undefined, z];
  });
  behaviorLink(slider, Gtk.rangeSetValue, B.mapB((s: Scale) => logBase(zoomLimit, s), scaleB));
  eventLink(textBox, Gtk.setEntryText, B.mapE((v: number) => T.pack(String(slideToTxt(v))), sliderE));
  eventLink(slider, Gtk.rangeSetValue, B.mapE(txtToSlide, textE));
  const scaleE = B.mapE((n: number) => n / 100, textE);
  Gtk.boxPackEnd(bar, scaleBox, false, false, 5);
  const w = Gtk.toWidget(bar);
  return [w, scaleE];
}

/** Limit on how large or small the rendered diagram can be on the screen. */
export const zoomLimit: number = 4;

/** Compensate for the change from pixels to points when exporting a diagram. */
const staticScale: number = 72 / 96; // 72 points per inch, 96 pixels per inch.

/**
 * Create a static rendering of a diagram, for instance for file export or printing. The
 * missing context is taken from the Cairo Surface. The diagram is moved up to the top left
 * of the rendering space.
 */
export function renderStatic<V>(style: HadesStyle, hades: HadesGtk<V>): Cairo.Render<void> {
  return (cr) => {
    const vs = view(hadesViews<V>(), hades)._0;
    const order = hadesOrder(hades);
    const viewList = mapMaybe((u: UUID) => M.lookup(u, vs), order);
    const box = renderStaticSize(hades);
    const [xOff, yOff] = box.tag === "NoBox" ? [0, 0] : [view(pX, box._0), view(pY, box._0)];
    Cairo.translate(cr, -xOff, -yOff);
    Cairo.scale(cr, staticScale, staticScale);
    runHadesRender((env) => {
      for (const v of [...viewList].reverse()) v.viewDraw(env);
    }, style, cr);
    Cairo.showPage(cr);
  };
}

/** The maximum X and Y coordinates of the diagram views, with a bit of slop. */
export function renderStaticSize<V>(hades: HadesGtk<V>): BoundBox {
  const scalePoint = (s: number, p: Point): Point => Point(s * p._pX, s * p._pY);
  const scaleBox = (s: number, b: BoundBox): BoundBox =>
    b.tag === "NoBox" ? NoBox : mkBoundBox(scalePoint(s, b._0), scalePoint(s, b._1));
  return scaleBox(staticScale, growBox(5, viewSetBoundBox(view(hadesViews<V>(), hades))));
}
