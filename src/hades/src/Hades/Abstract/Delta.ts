// Ported from hades/src/Hades/Abstract/Delta.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The Delta monad transformer wraps an inner monad in a stateful stream processor.
 *
 * Because it is a stream processor the top-most
 * monadic action can never return (hence the use of "Void" in "applyInputT"). Instead the monadic
 * action can yield an output using either "yieldViews" or "yieldCheckpoint". These actions cause
 * the "applyInputT" function to return the yielded value together with a continuation function that
 * takes the next input action. Values are yielded in the inner monad, so applications can combine
 * diagram editing actions with actions in an application-specific inner monad.
 *
 * The output of the stream processor is a stream of "ActionOutput" values. Each contains a set of
 * updates for the picture on the screen, represented as "ViewSet". It can also optionally include
 * an undo checkpoint.
 *
 * The stream processor is held in "DeltaState". Part of this state is the accumulated "ViewSet"
 * which will be placed in the output stream on the next yield. When a diagram element needs to be
 * redrawn then "tellViews" is called to add it to this ViewSet.
 *
 * This means that the "Delta" monad can act in a stateful way without using an explicit state
 * machine. Instead an action will call "yieldViews" to get an input,
 * update the diagram accordingly, and then use another "yieldViews" to get the next input.
 *
 * TypeScript port
 * ---------------
 * A `Delta v a` computation is a generator (`Delta<V, A>`). Generator functions for Delta actions
 * take a `DeltaCtx<V>` as their first argument; the context holds the mutable `DeltaState`
 * (`d.state`), the `Viewable` dictionary for `V` (`d.cls`) and the context of the inner `Base`
 * monad (`d.base`). The generator yields `Output<ActionOutput<V>>` values (via `yieldViews`) and,
 * when the base monad is a `ModelScript`, script instructions, which `applyInputT` passes on to
 * its caller.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe, catMaybes, mapMaybe } from "@/lib/Data/Maybe";
import { lens, use, assign, type Lens, type StateCell } from "@/lib/Control/Lens";
import { nextRandom } from "@/lib/Data/UUID";
import { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  Output, applyInputT as autoApplyInputT, type StreamNextT,
} from "./AutoMonad";
import {
  type Diagram, type DiagramId, type HasId, diagramContents, diagramToList, diagramOrder,
} from "./Diagram";
import { type BoundBox, type Point, type Scale, NoBox, Point as mkPoint, append_BoundBox } from "./Geometry";

export { applyInputT } from "./AutoMonad";

// ---------------------------------------------------------------------------------------------
// Hades State

/**
 * The state for the "Delta" monad.
 *
 * Care must be taken when updating individual fields. The Selection must only contain elements
 * in the Diagram. If the Diagram, Zoom or Selection is changed then the Views must also be
 * updated, as this will not be done by the Lenses.
 */
export interface DeltaState<V> {
  readonly _deltaDiagram: Diagram<V>;
  /**
   * Zoom factor of the diagram. For the most part diagram elements should
   * ignore this as painting the diagram on the screen is done by the outer
   * application. However some visual elements (notably editing handles) need
   * a constant screen size regardless of zoom, so they need to scale inversely
   * with the zoom factor.
   */
  readonly _deltaZoom: Scale;
  /** Diagram items that are currently selected. */
  readonly _deltaSelection: S.Set<DiagramId>;
  /** Application data that travels with the edited diagram. */
  readonly _deltaContext: ViewContext<V>;
  /**
   * Views that have been changed since the last yield.
   * The views are accumulated using "tellViews" and automatically cleared after
   * being yielded.
   */
  readonly deltaViews: ViewSet<V>;
  /**
   * Simlar to deltaViews, but holds views used during editing commands, such as handles
   * and rubber bands. Transients are always shown in front of everything else and do not
   * need to be in the diagram order list.
   */
  readonly deltaTransients: ViewSet<V>;
  /** Source of fresh DiagramIds (the Haskell version holds an infinite list). */
  readonly deltaNames: () => DiagramId;
  /** If the diagram has been changed then this will be a description of the latest change. */
  readonly deltaCheckpoint: Maybe<string>;
}

/** Lens for diagram within "DeltaState". */
export function deltaDiagram<V = any>(): Lens<DeltaState<V>, Diagram<V>> {
  return lens((s: DeltaState<V>) => s._deltaDiagram, (s, d: Diagram<V>) => ({ ...s, _deltaDiagram: d }));
}

/** Lens for the zoom factor. */
export function deltaZoom<V = any>(): Lens<DeltaState<V>, Scale> {
  return lens((s: DeltaState<V>) => s._deltaZoom, (s, z: Scale) => ({ ...s, _deltaZoom: z }));
}

/** Lens for selection. */
export function deltaSelection<V = any>(): Lens<DeltaState<V>, S.Set<DiagramId>> {
  return lens((s: DeltaState<V>) => s._deltaSelection, (s, t: S.Set<DiagramId>) => ({ ...s, _deltaSelection: t }));
}

/**
 * User-editable description of how the diagram elements should be shown to the user.
 * When it changes the "deltaViewDef" should be updated to match.
 */
export function deltaContext<V = any>(): Lens<DeltaState<V>, ViewContext<V>> {
  return lens((s: DeltaState<V>) => s._deltaContext, (s, v: ViewContext<V>) => ({ ...s, _deltaContext: v }));
}

/**
 * Create an initial DeltaState from a Diagram. This is in the IO monad because it contains
 * a random generator for new DiagramIds.
 */
export function mkDiagramState<V>(ctx: ViewContext<V>, z: Scale, d: Diagram<V>): DeltaState<V> {
  return {
    _deltaDiagram: d,
    _deltaZoom: z,
    _deltaSelection: S.empty<DiagramId>(),
    _deltaContext: ctx,
    deltaViews: mempty_ViewSet<V>(),
    deltaTransients: mempty_ViewSet<V>(),
    deltaNames: nextRandom,
    deltaCheckpoint: Nothing,
  };
}

/** Return a fresh name. */
export function* nextDiagramId<V>(d: DeltaCtx<V>): Delta<V, DiagramId> {
  return d.state.deltaNames();
}

// ---------------------------------------------------------------------------------------------
// Hades Inputs

/**
 * Commands which the application can issue to Hades. A "MoveDrag" must be
 * followed by another "MoveDrag" or an "EndDrag", and an "EndDrag" may only follow a
 * "MoveDrag". Apart from that commands can occur in any order.
 *
 * "Drag" and "EndDrag" event positions are the start of the drag. The pair of doubles gives the
 * offset to the current position during and after the drag.
 */
export type Command<V> =
  /** Typically a left click. */
  | { readonly tag: "Select" }
  /** Typically a double click. */
  | { readonly tag: "Activate" }
  /** Cumulative delta x and y from start position. */
  | { readonly tag: "Drag"; readonly _0: readonly [number, number] }
  | { readonly tag: "EndDrag"; readonly _0: readonly [number, number] }
  | { readonly tag: "Key"; readonly _0: string }
  /** Run a Delta action to modify the diagram in an arbitrary way. */
  | { readonly tag: "Script"; readonly _0: DeltaAct<V, Action<V>> };

export const Select: Command<any> = { tag: "Select" };
export const Activate: Command<any> = { tag: "Activate" };
export function Drag<V>(_0: readonly [number, number]): Command<V> {
  return { tag: "Drag", _0 };
}
export function EndDrag<V>(_0: readonly [number, number]): Command<V> {
  return { tag: "EndDrag", _0 };
}
export function Key<V>(_0: string): Command<V> {
  return { tag: "Key", _0 };
}
export function Script<V>(_0: DeltaAct<V, Action<V>>): Command<V> {
  return { tag: "Script", _0 };
}

/** `instance Show (Command v)` */
export function show_Command<V>(c: Command<V>): string {
  switch (c.tag) {
    case "Select": return "Select";
    case "Activate": return "Activate";
    case "Drag": return `Drag (${c._0[0]},${c._0[1]})`;
    case "EndDrag": return `EndDrag (${c._0[0]},${c._0[1]})`;
    case "Key": return `Key ${JSON.stringify(c._0)}`;
    case "Script": return "Script";
  }
}

/** Command modifiers. Monoid instance is logical OR for each field. */
export interface Modifiers {
  readonly modShift: boolean;
  readonly modCtrl: boolean;
  readonly modAlt: boolean;
}
export function Modifiers(modShift: boolean, modCtrl: boolean, modAlt: boolean): Modifiers {
  return { modShift, modCtrl, modAlt };
}

/** `instance Semigroup Modifiers` */
export function append_Modifiers(a: Modifiers, b: Modifiers): Modifiers {
  return Modifiers(a.modShift || b.modShift, a.modCtrl || b.modCtrl, a.modAlt || b.modAlt);
}

/** `instance Show Modifiers` */
export function show_Modifiers(m: Modifiers): string {
  return "{ " + (m.modShift ? "Shift " : "") + (m.modCtrl ? "Ctrl " : "") + (m.modAlt ? "Alt " : "") + "}";
}

export const noMod: Modifiers = Modifiers(false, false, false);
export const shiftMod: Modifiers = Modifiers(true, false, false);
export const ctrlMod: Modifiers = Modifiers(false, true, false);
export const altMod: Modifiers = Modifiers(false, false, true);
export const mempty_Modifiers: Modifiers = noMod;

/**
 * An action is a command, the point where the mouse was when it was issued, and any modifier
 * keys pressed at the time.
 *
 * Note: this was originally called \"Event\". However having GTK events, Hades events and
 * Reactive Banana events meant there was too much scope for muddle, so Hades events are now
 * known as actions.
 */
export interface Action<V> {
  readonly actionCommand: Command<V>;
  /** In the case of drags, this is the point the drag started. */
  readonly actionLocation: Point;
  readonly actionModifiers: Modifiers;
  /** The View of the item at the @actionLocation@, if any. */
  readonly actionTarget: Maybe<readonly [DiagramId, View<V>]>;
}
export function Action<V>(
  actionCommand: Command<V>,
  actionLocation: Point,
  actionModifiers: Modifiers,
  actionTarget: Maybe<readonly [DiagramId, View<V>]>,
): Action<V> {
  return { actionCommand, actionLocation, actionModifiers, actionTarget };
}

/** `instance Show (Action v)` */
export function show_Action<V>(ev: Action<V>): string {
  const p = ev.actionLocation;
  return ["Action ", show_Command(ev.actionCommand), " ",
    `Point {_pX = ${p._pX}, _pY = ${p._pY}}`, " ", show_Modifiers(ev.actionModifiers), " ",
    ev.actionTarget.tag === "Just" ? ev.actionTarget.value[0] : " "].join("");
}

/** Convert a Delta into an Action. The action will occur at (0,0) and target Nothing. */
export function mkScriptAction<V>(d: DeltaAct<V, Action<V>>): Action<V> {
  return Action(Script(d), mkPoint(0, 0), Modifiers(false, false, false), Nothing);
}

// ---------------------------------------------------------------------------------------------
// Hades Output

/** The response to an action contains data for the application GUI. */
export interface ActionOutput<V> {
  /** Visual updates. */
  readonly outViews: ViewSet<V>;
  /** Transient visual updates. */
  readonly outTransients: ViewSet<V>;
  /**
   * If the diagram has been modified then this is the new version. The string describes
   * the change.
   */
  readonly outCheckpoint: Maybe<string>;
  readonly outProperties: readonly V[];
}

/** A no-operation action. */
export function nullAction<V>(): Action<V> {
  return mkScriptAction<V>(yieldViews);
}

// ---------------------------------------------------------------------------------------------
// Diagram Editing Action

/**
 * The Delta monad describes edits to a diagram. @v@ is the type of diagram element.
 *
 * A `Delta<V, A>` is a running generator. It yields `Output<ActionOutput<V>>` values (see
 * `yieldViews`) and instructions of the base monad, and returns an `A`.
 */
export type DeltaYield<V> = Output<ActionOutput<V>> | BaseInstruction;
export type Delta<V, A> = Generator<DeltaYield<V>, A, any>;

/** A first-class Delta action (a Haskell value of type @Delta v a@). */
export type DeltaAct<V, A> = (d: DeltaCtx<V>) => Delta<V, A>;

/**
 * Instructions of the base monad that pass through a Delta computation unchanged (for a
 * `ModelScript` base these are `UserScriptFunctor` values). They are opaque at this level.
 */
export type BaseInstruction = { readonly tag: string };

/**
 * The context of a running Delta computation. It is a `StateCell` for the `DeltaState`, so the
 * Lens state operators (`use`, `assign`, `modifying`, ...) can be applied to it directly.
 */
export class DeltaCtx<V> implements StateCell<DeltaState<V>> {
  /** Context of the base monad, set by the runner before each step (see `applyInputT`). */
  base: any = null;
  constructor(
    /** The `Viewable` (or `Connectable`) dictionary for the diagram element type. */
    readonly cls: Viewable<V>,
    readonly cell: StateCell<DeltaState<V>>,
  ) {}
  get state(): DeltaState<V> {
    return this.cell.state;
  }
  set state(s: DeltaState<V>) {
    this.cell.state = s;
  }
}

/** The continuation returned from "applyInputT". */
export type DeltaNext<V> = StreamNextT<Action<V>, ActionOutput<V>, never, DeltaState<V>, BaseInstruction>;

/**
 * Start a Delta stream processor which defers execution until its first input
 * (`startStreamT1 (stepDelta . f) state`). The base context for each step is supplied to
 * `applyDelta`.
 */
export function startDelta<V>(
  cls: Viewable<V>,
  f: (d: DeltaCtx<V>, a: Action<V>) => Delta<V, never>,
  state0: DeltaState<V>,
): DeltaNext<V> & { ctx: DeltaCtx<V> } {
  const cell: StateCell<DeltaState<V>> = { state: state0 };
  const ctx = new DeltaCtx(cls, cell);
  return {
    gen: null,
    start: (_st, i) => f(ctx, i),
    cell,
    ctx,
  };
}

/**
 * Apply an input action to a Delta stream processor created with `startDelta`, running in the
 * base monad whose context is `base` (a generator in the base monad's protocol).
 */
export function* applyDelta<V>(
  base: any,
  nxt: DeltaNext<V> & { ctx: DeltaCtx<V> },
  action: Action<V>,
): Generator<BaseInstruction, [ActionOutput<V>, DeltaNext<V> & { ctx: DeltaCtx<V> }], any> {
  nxt.ctx.base = base;
  const [out] = yield* autoApplyInputT(nxt, action);
  return [out, nxt];
}

/** The state of a Delta stream processor (`streamStateT`). */
export function deltaStateOf<V>(nxt: DeltaNext<V>): DeltaState<V> {
  return nxt.cell.state;
}

// ---------------------------------------------------------------------------------------------
// Generating Viewable Output

/**
 * Things of type @v@ have a representation drawn in monad @Paint v@. This also includes
 * common behaviour for all Viewable objects.
 *
 * The geometric properties default to those of the item shape. However they can be overridden. The
 * only exception is for the handles. The shape provides a list of handle locations and functions
 * for updating the shape when the handle is moved. However it is for the Viewable to interpret
 * this as a set of Views.
 *
 * The associated types are: `Base v` (base monad for Delta actions, whose context is `d.base`),
 * `Paint v` (the drawing monad, see `View.viewDraw`) and the data family `ViewContext v`
 * (application data that runs with the diagram).
 */
export interface Viewable<V> extends HasId<V> {
  /** Transient handles for the shape, allowing it to be edited. */
  itemHandles(d: DeltaCtx<V>, v: V): Delta<V, View<V>[]>;
  /**
   * True if the point is on the Viewable. Usually the same as the "viewTouched"
   * function for the @itemView@ when not selected. Takes "Scale" because lines need some
   * scale-invariant slop around them.
   */
  itemTouched(v: V, s: Scale, p: Point): boolean;
  /**
   * Any child connection points within this item. The second item in the pair is a predicate
   * for its area.
   */
  itemChildren(d: DeltaCtx<V>, v: V): Delta<V, [DiagramId, (p: Point) => boolean][]>;
  /** True if the Viewable is contained in the BoundBox. */
  itemInBox(v: V, b: BoundBox): boolean;
  /** Bound box for this item. Should match the one in the "itemView". */
  itemBounds(v: V): BoundBox;
  /**
   * Attempt to set the width and height of @itemBounds@. May not succeed.
   * In particular lines are expected to ignore this.
   */
  itemResize(d: DeltaCtx<V>, wh: readonly [number, number], v: V): Delta<V, V>;
  /** Move the Viewable by (x,y) relative, updating the diagram, but not changing any connections. */
  itemMove(d: DeltaCtx<V>, xy: readonly [number, number], v: V): Delta<V, V>;
  /**
   * Move the Viewable by (x,y) relative, updating the diagram, making or breaking connections,
   * snapping to other items as appropriate, and returning the new value.
   */
  itemDrag(d: DeltaCtx<V>, xy: readonly [number, number], v: V): Delta<V, V>;
  /** A user-level description of the Viewable, such as \"rect023\" or \"Fuel pump\". */
  itemDescription(d: DeltaCtx<V>, v: V): Delta<V, string>;
  /** Current View (taking into account zoom and selection) of the Viewable. */
  itemView(d: DeltaCtx<V>, v: V): Delta<V, View<V>>;
  /**
   * Type name for the item, used to distinguish different types of diagram. The
   * implementation MUST NOT inspect its argument.
   */
  itemType(v: V): string;
}

/** The data family `ViewContext v`. Each instance defines its own representation. */
export type ViewContext<_V> = any;

/** The bound box of a diagram. */
export function diagramBounds<V>(cls: Viewable<V>, d: Diagram<V>): BoundBox {
  return diagramToList(d).map((i) => cls.itemBounds(i)).reduce(append_BoundBox, NoBox);
}

/**
 * Lift a computation in the Base monad up into the Delta monad.
 *
 * The base computation is a generator in the base monad's protocol taking the base context;
 * its instructions are passed through to the runner.
 */
export function* liftBase<V, A>(d: DeltaCtx<V>, act: (base: any) => Generator<any, A, any>): Delta<V, A> {
  return yield* act(d.base);
}

/** The child item, if any, that the point is over. */
function* itemChild<V>(d: DeltaCtx<V>, item: V, pt: Point): Delta<V, Maybe<DiagramId>> {
  const candidates = yield* d.cls.itemChildren(d, item);
  const r = candidates.find(([, p]) => p(pt));
  return r ? Just(r[0]) : Nothing;
}

/**
 * The top-most element (if any) at the point in the diagram that complies with the predicate
 * and the "DiagramId" of the child connection at that point.
 */
export function* diagramAt<V>(
  d: DeltaCtx<V>,
  s: Scale,
  pt: Point,
  /** The predicate arguments are an item and optionally a child of that item. */
  predicate: (d: DeltaCtx<V>, v: V, child: Maybe<DiagramId>) => Delta<V, boolean>,
  diagram: Diagram<V>,
): Delta<V, Maybe<[V, Maybe<DiagramId>]>> {
  const candidates: Maybe<[V, Maybe<DiagramId>]>[] = [];
  for (const v of diagramToList(diagram)) {
    if (d.cls.itemTouched(v, s, pt)) {
      const child = yield* itemChild(d, v, pt);
      const r = yield* predicate(d, v, child);
      candidates.push(r ? Just([v, child] as [V, Maybe<DiagramId>]) : Nothing);
    } else candidates.push(Nothing);
  }
  const found = catMaybes(candidates);
  return found.length > 0 ? Just(found[0]) : Nothing;
}

/**
 * A View of an object knows what points it occupies and how to respond to actions.
 *
 * The Monoid instance puts the first View in front of the second.
 *
 * `viewDraw` is an action in the `Paint v` monad. For HADES diagrams this is `HadesRender`,
 * a function of the rendering context (see `Hades.GI.BasicShapes`).
 */
export interface View<V> {
  readonly viewDraw: Paint;
  /** True if the point touches the object. */
  readonly viewTouched: (p: Point) => boolean;
  /** The object is entirely contained within this box. */
  readonly viewBox: BoundBox;
  /**
   * The action for right-clicks at this point. The @Point@ is available for objects that
   * have different menus in different places; if the menu is always the same then ignore it.
   */
  readonly viewMenu: (p: Point) => Menu<Action<V>>;
  /**
   * What the View will do with a user "Action". This will include yielding the updates
   * and returning the next action.
   */
  readonly viewAction: (d: DeltaCtx<V>, a: Action<V>) => Delta<V, Action<V>>;
}

/**
 * An action in the drawing monad `Paint v`. Drawing actions take the drawing environment
 * (for HADES, the `HadesRender` context) and draw on it.
 */
export type Paint = (env: any) => void;

/** `return ()` in the Paint monad. */
export const noPaint: Paint = () => {};

/** `instance (Viewable v) => Semigroup (View v)` */
export function append_View<V>(v1: View<V>, v2: View<V>): View<V> {
  return {
    viewDraw: (env) => {
      v2.viewDraw(env);
      v1.viewDraw(env);
    },
    viewTouched: (p) => v1.viewTouched(p) || v2.viewTouched(p),
    viewBox: append_BoundBox(v1.viewBox, v2.viewBox),
    viewMenu: (p) => (v1.viewTouched(p) ? v1.viewMenu(p) : v2.viewMenu(p)),
    viewAction: (d, action) =>
      v1.viewTouched(action.actionLocation) ? v1.viewAction(d, action) : v2.viewAction(d, action),
  };
}

/** `instance (Viewable v) => Monoid (View v)` */
export function mempty_View<V>(): View<V> {
  return {
    viewDraw: noPaint,
    viewTouched: () => false,
    viewBox: NoBox,
    viewMenu: () => Menu<Action<V>>([]),
    viewAction: (d) => yieldViews(d),
  };
}

/** `mconcat` for views. */
export function mconcat_View<V>(vs: readonly View<V>[]): View<V> {
  return vs.reduceRight((acc, v) => append_View(v, acc), mempty_View<V>());
}

/**
 * A set of views related to specific drawing items.
 * The Monoid instance aggregates the views by key.
 */
export interface ViewSet<V> {
  readonly _0: M.Map<DiagramId, View<V>>;
}
export function ViewSet<V>(_0: M.Map<DiagramId, View<V>>): ViewSet<V> {
  return { _0 };
}

/** `instance (Viewable v) => Semigroup (ViewSet v)` */
export function append_ViewSet<V>(m1: ViewSet<V>, m2: ViewSet<V>): ViewSet<V> {
  return ViewSet(M.unionWith(append_View, m2._0, m1._0));
}

/** `instance (Viewable v) => Monoid (ViewSet v)` */
export function mempty_ViewSet<V>(): ViewSet<V> {
  return ViewSet(M.empty<DiagramId, View<V>>());
}

/** Similar to "mappend", but replaces views with the same key rather than appending to them. */
export function updateViewSet<V>(m1: ViewSet<V>, m2: ViewSet<V>): ViewSet<V> {
  return ViewSet(M.union(m2._0, m1._0));
}

/** The bounding box around an entire ViewSet */
export function viewSetBoundBox<V>(vs: ViewSet<V>): BoundBox {
  return M.toList(vs._0).reduceRight((acc: BoundBox, [, v]) => append_BoundBox(v.viewBox, acc), NoBox);
}

/** Record that the entire diagram needs to be redrawn. */
export function* tellAll<V>(d: DeltaCtx<V>): Delta<V, void> {
  // Views
  const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  let vs = M.empty<DiagramId, View<V>>();
  for (const [k, item] of M.toList(contents)) vs = M.insert(k, yield* d.cls.itemView(d, item), vs);
  yield* tellViews(d, ViewSet(vs));
  // Selection handles
  const sel = mapMaybe((u: DiagramId) => M.lookup(u, contents), S.toList(use(d, deltaSelection<V>())));
  const ts: [DiagramId, View<V>][] = [];
  for (const i of sel) {
    const t = mconcat_View(yield* d.cls.itemHandles(d, i));
    ts.push([d.cls.identifier(i), t]);
  }
  yield* tellTransients(d, ViewSet(M.fromList(ts)));
}

/** Record updates to the diagram view. */
export function* tellViews<V>(d: DeltaCtx<V>, vs: ViewSet<V>): Delta<V, void> {
  d.state = { ...d.state, deltaViews: updateViewSet(d.state.deltaViews, vs) };
}

/** Record update to a transient view. */
export function* tellTransients<V>(d: DeltaCtx<V>, vs: ViewSet<V>): Delta<V, void> {
  d.state = { ...d.state, deltaTransients: updateViewSet(d.state.deltaTransients, vs) };
}

/** Record that a single element in the diagram has changed. */
export function* tellItem<V>(d: DeltaCtx<V>, item: V): Delta<V, void> {
  const v = yield* d.cls.itemView(d, item);
  const ident = d.cls.identifier(item);
  yield* tellViews(d, ViewSet(M.singleton(ident, v)));
  const sel = use(d, deltaSelection<V>());
  if (S.member(ident, sel)) {
    const ts = yield* d.cls.itemHandles(d, item);
    yield* tellTransients(d, ViewSet(M.singleton(ident, mconcat_View(ts))));
  } else {
    yield* tellTransients(d, ViewSet(M.singleton(ident, mempty_View<V>())));
  }
}

/** Record an undo point with a description of the last change. */
export function* tellCheckpoint<V>(d: DeltaCtx<V>, str: string): Delta<V, void> {
  d.state = { ...d.state, deltaCheckpoint: Just(str) };
}

/**
 * Private function to yield changes to the diagram view. The parameter is 0 or more items to
 * be opened with property dialogs.
 */
function* yieldViews1<V>(d: DeltaCtx<V>, items: readonly V[]): Delta<V, Action<V>> {
  const s = d.state;
  d.state = {
    ...s,
    deltaViews: mempty_ViewSet<V>(),
    deltaTransients: mempty_ViewSet<V>(),
    deltaCheckpoint: Nothing,
  };
  const action: Action<V> = yield new Output<ActionOutput<V>>({
    outViews: s.deltaViews,
    outTransients: s.deltaTransients,
    outCheckpoint: s.deltaCheckpoint,
    outProperties: items,
  });
  return action;
}

/** Yield changes to the diagram view and get the next input action. */
export function* yieldViews<V>(d: DeltaCtx<V>): Delta<V, Action<V>> {
  return yield* yieldViews1(d, []);
}

/**
 * Request a properties dialog for the argument. Also yields the changes and gets the next
 * input action. The next action is not necessarily the response to the dialog.
 */
export function* yieldProperties<V>(d: DeltaCtx<V>, item: V): Delta<V, Action<V>> {
  return yield* yieldViews1(d, [item]);
}

// ---------------------------------------------------------------------------------------------
// Selection

export function* getSelection<V>(d: DeltaCtx<V>): Delta<V, S.Set<DiagramId>> {
  return use(d, deltaSelection<V>());
}

/** Replace the current selection with a new one. Tells the changed views. */
export function* changeSelection<V>(d: DeltaCtx<V>, newSet: S.Set<DiagramId>): Delta<V, void> {
  const oldSet = use(d, deltaSelection<V>());
  assign(d, deltaSelection<V>(), newSet);
  const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const unchanged = S.intersection(oldSet, newSet);
  const newlySelected = S.toList(S.difference(newSet, unchanged));
  const deselected = S.toList(S.difference(oldSet, unchanged));
  const vs: [DiagramId, View<V>][] = [];
  for (const uuid of newlySelected) {
    const i = M.lookup(uuid, contents);
    if (i.tag === "Just") vs.push([uuid, mconcat_View(yield* d.cls.itemHandles(d, i.value))]);
  }
  const ds: [DiagramId, View<V>][] = deselected.map((u) => [u, mempty_View<V>()]);
  yield* tellTransients(d, ViewSet(M.fromList([...vs, ...ds])));
}

/** Toggle the selection of the identified item and tell the changed view. */
export function* toggleSelectItem<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const item = M.lookup(uuid, contents);
  if (item.tag === "Nothing") return;
  const oldSet = use(d, deltaSelection<V>());
  assign(d, deltaSelection<V>(), S.member(uuid, oldSet) ? S.delete(uuid, oldSet) : S.insert(uuid, oldSet));
  yield* tellItem(d, item.value);
}

/** Items currently selected. */
export function* selectedItems<V>(d: DeltaCtx<V>): Delta<V, [DiagramId, V][]> {
  const sel = S.toList(use(d, deltaSelection<V>()));
  const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  return mapMaybe((u: DiagramId) => {
    const v = M.lookup(u, contents);
    return v.tag === "Just" ? Just([u, v.value] as [DiagramId, V]) : Nothing;
  }, sel);
}

/** For a single item, give its description. For multiple items just say \"n items\" */
export function* itemsDescription<V>(d: DeltaCtx<V>, xs: readonly V[]): Delta<V, string> {
  if (xs.length === 0) return "nothing"; // Should never happen.
  if (xs.length === 1) return yield* d.cls.itemDescription(d, xs[0]);
  return `${xs.length} items`;
}

/** Re-exported so that diagram code can refer to the order lens alongside the others. */
export { diagramOrder };
