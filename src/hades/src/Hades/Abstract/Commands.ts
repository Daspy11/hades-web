// Ported from hades/src/Hades/Abstract/Commands.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Commands are represented as sequences of actions which will typically be created by the
 * user with mouse and keyboard. Each type of command is represented here as a function.
 *
 * In most cases the first user action that initiates the command also carries information required
 * to implement the command, so this action is passed as a parameter to the command function.
 * Likewise the end of a command sequence is generally the first action in a new command, so these
 * functions return this action for processing by the caller.
 *
 * TypeScript port
 * ---------------
 * * Every `Delta v a` function is a generator function taking the `DeltaCtx` first. The
 *   `Connectable` dictionary is `d.cls`.
 * * First-class Delta values (`Delta v s`, `Delta v ()` in `KeyCommands`) are `DeltaAct`s, and
 *   function arguments of the form `x -> Delta v a` are generator functions `(d, x) => Delta<V, A>`.
 * * Values of type `(Connectable v) => Action v` (`alignTop`, `sizeWidest`, `distributeH` ...)
 *   are functions of no arguments (like `nullAction`): the dictionary arrives with the `DeltaCtx`
 *   when the script runs. Consequently the pure callbacks of `alignGeneric`, `sizeGeneric` and
 *   `distributeGeneric`, which in Haskell close over the class dictionary, receive the
 *   `Connectable` dictionary as their first argument, exactly like a constrained function.
 * * Recursive drag loops (`processAction`, `process1`, `ignoreDrag`, `findAffected`,
 *   `rubberBand`) are `for (;;)` loops.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import { mapMaybe, isNothing } from "@/lib/Data/Maybe";
import { use, modifying, view, preview } from "@/lib/Control/Lens";
import { fromWords } from "@/lib/Data/UUID";
import { absurd, snd, fst } from "@/lib/Prelude";
import { type Connectable, connectable, getAllConnected, getAllPegged } from "./Connections";
import {
  type Action, type Delta, type DeltaAct, type DeltaCtx, type Modifiers, type Paint, type View,
  ViewSet, changeSelection, deltaDiagram, deltaSelection, itemsDescription, mempty_View,
  mkScriptAction, selectedItems, tellCheckpoint, tellTransients, toggleSelectItem, yieldViews,
} from "./Delta";
import { type DiagramId, diagramContents, diagramOrder } from "./Diagram";
import {
  type BoundBox, type Point, boxCentre, boxHeight, boxWidth, mconcat_BoundBox, mkBoundBox, movePoint,
  pX, pY,
} from "./Geometry";
import { deleteItem } from "./Primitives";

/** Haskell `min` on `Double`. */
function hmin(x: number, y: number): number {
  return x <= y ? x : y;
}

// ---------------------------------------------------------------------------------------------
// Action Processing

/**
 * Top level function for processing actions. Deals with selection and moving, and passes
 * anything else to the target item. Rather than returning it waits for the next action
 * and calls itself recursively.
 */
export function* processAction<V>(
  d: DeltaCtx<V>,
  /** Draw an area select box. Usually uses thin dashed lines. */
  areaBox: (p1: Point, p2: Point) => Paint,
  /** How to handle keys pressed. */
  keyCommands: KeyCommands<V>,
  /** The next action to process. */
  act1: Action<V>,
): Delta<V, never> {
  let act = act1;
  for (;;) act = yield* processSingleAction(d, areaBox, keyCommands, act);
}

/**
 * Table of actions for keyboard commands. The @Set DiagramId@ argument is the selection to which
 * the command is to be applied.
 *
 * The "SemiGroup" instance for "Map" means that these
 * can be conveniently combined.
 *
 * (Keys are `[modifiers, character]` pairs, compared structurally.)
 */
export type KeyCommands<V> = M.Map<readonly [Modifiers, string], DeltaAct<V, void>>;

/* Design Note

GTK can handle keys that do not directly translate into unicode characters (e.g. "Insert") via
its own encoding system. If you need this then Hades.GI.MouseMachine will have to be modified to
emit a suitable encoding instead of Char. The native GTK one *could* be used, except that at this
level we are trying not to have any direct GTK dependencies.
*/

/** Process a single action. Yields the changes and returns the next action. */
export function* processSingleAction<V>(
  d: DeltaCtx<V>,
  /** Draw an area select box. Usually uses thin dashed lines. */
  areaBox: (p1: Point, p2: Point) => Paint,
  /** How to handle keys pressed. */
  keyCommands: KeyCommands<V>,
  /** The next action to process. */
  ev: Action<V>,
): Delta<V, Action<V>> {
  const cmd = ev.actionCommand;
  switch (cmd.tag) {
    case "Select": {
      const target = ev.actionTarget;
      if (target.tag === "Just") {
        const [uuid] = target.value;
        if (ev.actionModifiers.modShift) yield* toggleSelectItem(d, uuid);
        else yield* changeSelection(d, S.singleton(uuid));
      } else {
        yield* changeSelection(d, S.empty<DiagramId>());
      }
      return yield* yieldViews(d);
    }
    case "Drag": {
      const s = use(d, deltaSelection<V>());
      const items = yield* selectedItems(d);
      const target = ev.actionTarget;
      if (target.tag === "Nothing") {
        return yield* areaSelect(d, areaBox, ev.actionLocation, ev.actionModifiers); // Cases 1 & 2.
      }
      const [uuid, v] = target.value;
      if (S.member(uuid, s)) {
        switch (items.length) {
          case 0: return yield* v.viewAction(d, ev);
          case 1: return yield* v.viewAction(d, ev); // Case 4.
          default: return yield* moveItems(d, items.map(snd), ev); // Cases 6 & 7.
        }
      }
      return yield* v.viewAction(d, ev); // Cases 3 & 5.
    }
    case "EndDrag":
      return yield* yieldViews(d);
    case "Script":
      return yield* cmd._0(d);
    case "Key": {
      const h = M.lookup([ev.actionModifiers, cmd._0] as const, keyCommands);
      if (h.tag === "Just") yield* h.value(d);
      return yield* yieldViews(d);
    }
    case "Activate": {
      // Anything else is delegated to the element.
      const target = ev.actionTarget; // Not a select or a move, so ...
      if (target.tag === "Just") return yield* target.value[1].viewAction(d, ev); // delegate to the View of an object in the diagram,
      return yield* yieldViews(d); // or if there isn't one, then no-op.
    }
    default:
      return absurd(cmd);
  }
}

/**
 * Apply the action to the selection. Ignore the target location. This is suitable for key
 * commands as they do not have a location.
 */
export function* applyToSelection<V>(
  d: DeltaCtx<V>,
  /** Message for the undo log, based on the items the action is applied to. */
  strF: (d: DeltaCtx<V>, vs: readonly V[]) => Delta<V, string>,
  /** Action for each item. */
  action: (d: DeltaCtx<V>, uuid: DiagramId) => Delta<V, void>,
): Delta<V, void> {
  const sel = use(d, deltaSelection<V>());
  if (!S.isNull(sel)) {
    const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
    const msg = yield* strF(d, mapMaybe((u: DiagramId) => M.lookup(u, contents), S.toList(sel)));
    for (const u of S.toList(sel)) yield* action(d, u);
    yield* tellCheckpoint(d, msg);
  }
}

/*
MoveDrag handling has a lot of sub-cases, so here they are in tabular format:

Case | Selection  |  Target   |  Modifiers  |  Process
-----+------------+-----------+-------------+------------------------------------------------
 1  |   -        | None      | None        | Box selection.
 2  |   -        | None      | Shift       | Box selection toggle.
 3  | Empty      | Item      |   -         | Pass actions to target.
 4  | Single     | Selected  |   -         | Pass actions to target.
 5  |   -        | Unselected|   -         | Pass actions to target.
 6  | Multiple   | Selected  | None        | Unconstrained drag of selected items.
 7  | Multiple   | Selected  | Shift       | Constrained drag of selected items

*/

/**
 * Generic function for handling a sequence of "Drag" actions. It returns the "EndDrag" action
 * that terminates this drag command.
 */
export function* processDrag1<V, St>(
  d: DeltaCtx<V>,
  /**
   * Any read-only state required by the drag functions. This is evaluated once and
   * then passed to each call to the movement function.
   */
  moveState: DeltaAct<V, St>,
  /**
   * The movement function. This is called for each "Drag" action that follows, and then
   * again for the "EndDrag".
   * The first argument is the read-only state, the second is the latest "Action" and the
   * third is the cumulative offset from the location of the first action.
   */
  moveAction: (d: DeltaCtx<V>, s: St, ev: Action<V>, dPos: readonly [number, number]) => Delta<V, void>,
  /** The first action. */
  ev1: Action<V>,
): Delta<V, Action<V>> {
  const s = yield* moveState(d);
  // process1 dd ev2, as a loop.
  let dd: readonly [number, number] = [0, 0];
  let ev2 = ev1;
  for (;;) {
    const cmd = ev2.actionCommand;
    switch (cmd.tag) {
      case "Drag": {
        const dPos = cmd._0;
        yield* moveAction(d, s, ev2, dPos);
        ev2 = yield* yieldViews(d);
        dd = dPos;
        break;
      }
      case "EndDrag": {
        yield* moveAction(d, s, ev2, cmd._0);
        return ev2;
      }
      case "Script":
        ev2 = yield* cmd._0(d);
        break;
      default:
        yield* moveAction(d, s, ev2, dd);
        return ev2;
    }
  }
}

/** As for "processDrag1", but also creates an undo checkpoint at the end of the drag. */
export function* processDrag<V, St>(
  d: DeltaCtx<V>,
  /** Checkpoint message for this drag. */
  msg: string,
  /**
   * Any read-only state required by the drag functions. This is evaluated once and
   * then passed to each call to the movement function.
   */
  moveState: DeltaAct<V, St>,
  /**
   * The movement function. This is called for each "Drag" action that follows, and then
   * again for the "EndDrag".
   * The first argument is the read-only state, the second is the latest "Action" and the
   * third is the cumulative offset from the location of the first action.
   */
  moveAction: (d: DeltaCtx<V>, s: St, ev: Action<V>, dPos: readonly [number, number]) => Delta<V, void>,
  /** The first action. */
  ev1: Action<V>,
): Delta<V, Action<V>> {
  const ev2 = yield* processDrag1(d, moveState, moveAction, ev1);
  yield* tellCheckpoint(d, msg);
  return ev2;
}

/*
Design note: Line behaviour during selection moves:

  Unconnected ends move if the line is selected.
  Connected ends move (or not) with the item they are connected to.

However if a line is both connected and selected then it needs to be handled once, because
trying to move it and update it in two separate actions will cause two different versions to be
emitted to the renderer. Hence this function identifies elements that are "targets" of the move,
elements that are affected by the targets, and elements that are both.

Pegged boxes are handled similarly.
*/

/**
 * For a move on a set of diagram items, compute the items that are:
 *
 * * Both targetted and possibly affected by the move. These should be moved and then adjusted.
 *
 * * Not targetted, but affected by a targetted item. These should be adjusted after everything
 * else.
 */
function* moveTargetSets<V>(
  d: DeltaCtx<V>,
  targetSet: S.Set<DiagramId>,
): Delta<V, [S.Set<DiagramId>, S.Set<DiagramId>]> {
  const targetAffectedSet = yield* findAffected(d, targetSet);
  const onlyAffectedSet = S.difference(targetAffectedSet, targetSet);
  return [targetAffectedSet, onlyAffectedSet];
}

// ---------------------------------------------------------------------------------------------
// Higher Level Commands

/** Move several items as a group. Returns the "EndDrag" action that terminates this command. */
export function* moveItems<V>(d: DeltaCtx<V>, targets: readonly V[], ev: Action<V>): Delta<V, Action<V>> {
  const cls = connectable(d);
  const constrainedDrag = function* (d1: DeltaCtx<V>, dPos: readonly [number, number], item: V): Delta<V, V> {
    const [dx, dy] = dPos;
    const newView = yield* cls.itemView(d1, yield* cls.itemDrag(d1, dPos, item));
    // Constrain the item not to go off the top or left of the diagram.
    const box = newView.viewBox;
    const adjustment: readonly [number, number] = box.tag === "NoBox"
      ? dPos
      : [dx - hmin(view(pX, box._0), 0), dy - hmin(view(pY, box._0), 0)];
    return yield* cls.itemDrag(d1, adjustment, item);
  };
  const targetSet = S.fromList(targets.map((t) => cls.identifier(t)));
  const [, onlyAffectedSet] = yield* moveTargetSets(d, targetSet);
  const desc = yield* itemsDescription(d, targets);
  return yield* processDrag(
    d,
    "Move " + desc,
    function* (): Delta<V, null> {
      return null;
    },
    function* (d1: DeltaCtx<V>, _s: null, _ev: Action<V>, dPos: readonly [number, number]): Delta<V, void> {
      const contents = use(d1, deltaDiagram<V>().dot(diagramContents<V>()));
      const dragged: V[] = [];
      for (const t of targets) dragged.push(yield* constrainedDrag(d1, dPos, t));
      const onlyAffected = mapMaybe((u: DiagramId) => M.lookup(u, contents), S.toList(onlyAffectedSet));
      for (const item of [...dragged, ...onlyAffected]) yield* cls.itemAdjust(d1, item);
    },
    ev,
  );
}

// ToDo: add shift modifier for constrained moves.

/**
 * Follow connections and pegs to find all the other elements on the diagram that must
 * be adjusted after something is moved.
 */
export function* findAffected<V>(d: DeltaCtx<V>, s: S.Set<DiagramId>): Delta<V, S.Set<DiagramId>> {
  const cls = connectable(d);
  let cur = s;
  for (;;) {
    const xs = S.toList(cur);
    const add1: DiagramId[] = [];
    for (const x of xs) for (const v of yield* getAllConnected(d, x)) add1.push(cls.identifier(v));
    const add2: DiagramId[] = [];
    for (const x of xs) for (const v of yield* getAllPegged(d, x)) add2.push(cls.identifier(v));
    const rs = S.union(S.fromList([...add1, ...add2]), cur);
    if (S.size(rs) === S.size(cur)) return cur;
    cur = rs;
  }
}

/** An attempt to drag something is to be ignored. */
export function* ignoreDrag<V>(d: DeltaCtx<V>, ev: Action<V>): Delta<V, Action<V>> {
  let ev1 = ev;
  while (ev1.actionCommand.tag === "Drag") ev1 = yield* yieldViews(d);
  return ev1;
}

/** Generic function for handling actions delegated to Connectable. */
export function* handleDelegatedAction<V>(
  d: DeltaCtx<V>,
  /** The Connectable item that has been delegated the action. */
  item: V,
  /**
   * What to do when the current item is activated (double-clicked). Typically will either
   * call "yieldProperties" or else open up some other dialog and then call "yieldViews"
   */
  activation: DeltaAct<V, Action<V>>,
  /**
   * Function for handling a key press. Delete is already handled. Note that this should
   * finish with a call to "yieldViews" to update the screen and get the next action.
   */
  charFunc: (d: DeltaCtx<V>, c: string) => Delta<V, Action<V>>,
  /** The action. */
  act: Action<V>,
): Delta<V, Action<V>> {
  const cmd = act.actionCommand;
  switch (cmd.tag) {
    case "Select": return yield* yieldViews(d); // Not delegated to shapes. Should never happen.
    case "Activate": return yield* activation(d);
    case "Drag": return yield* moveItems(d, [item], act);
    case "EndDrag": return yield* yieldViews(d); // Not delegated to shapes. Should never happen.
    case "Key":
      if (cmd._0 === "\x7f") {
        yield* deleteItem(d, connectable(d).identifier(item));
        return yield* yieldViews(d);
      }
      return yield* charFunc(d, cmd._0);
    case "Script":
      yield* cmd._0(d);
      return yield* yieldViews(d);
    default:
      return absurd(cmd);
  }
}

/**
 * Rubber band drawing. Returns the start and end location as well as the next action.
 * Should be called when the left button is already down as it returns at the first non-drag
 * action.
 */
export function* rubberBand<V>(
  d: DeltaCtx<V>,
  /** For drawing the rubber band from start to end. */
  drawBand: (p1: Point, p2: Point) => Paint,
  /** Start point. Usually the "actionLocation" of the last action. */
  start: Point,
): Delta<V, [Point, Point, Action<V>]> {
  const rubberView = (p1: Point, p2: Point): View<V> =>
    ({ ...mempty_View<V>(), viewDraw: drawBand(p1, p2), viewBox: mkBoundBox(p1, p2) });
  const uuid: DiagramId = fromWords(2369725315, 95306541, 2660896237, 3031441912);
  // Arbitrary constant UUID used only for rubber bands.
  const order = deltaDiagram<V>().dot(diagramOrder<V>());
  modifying(d, order, (o: readonly DiagramId[]) => [uuid, ...o]);
  // next end1 action, as a loop.
  let action = yield* yieldViews(d);
  let end1 = start;
  let result: [Point, Point, Action<V>];
  for (;;) {
    const cmd = action.actionCommand;
    if (cmd.tag === "Drag") {
      const end2 = movePoint(start, cmd._0);
      yield* tellTransients(d, ViewSet(M.singleton(uuid, rubberView(start, end2))));
      action = yield* yieldViews(d);
      end1 = end2;
    } else {
      yield* tellTransients(d, ViewSet(M.singleton(uuid, mempty_View<V>())));
      result = [start, end1, action];
      break;
    }
  }
  modifying(d, order, (o: readonly DiagramId[]) => L.delete(uuid, o));
  return result;
}

/**
 * Select by dragging a box from one corner to the other. Items that are enclosed by the box
 * are included. The "Paint" action should draw a rectangular box in thin dashed lines.
 */
export function* areaSelect<V>(
  d: DeltaCtx<V>,
  drawBox: (p1: Point, p2: Point) => Paint,
  start: Point,
  modifiers: Modifiers,
): Delta<V, Action<V>> {
  const [p1, p2, action] = yield* rubberBand(d, drawBox, start);
  const box = mkBoundBox(p1, p2);
  const items = M.toList(use(d, deltaDiagram<V>().dot(diagramContents<V>())));
  const selection = use(d, deltaSelection<V>());
  // Items in the selected area.
  const targets = S.fromList(items.filter(([, v]) => d.cls.itemInBox(v, box)).map(fst));
  yield* changeSelection(d, modifiers.modShift ? S.union(selection, targets) : targets);
  return action;
}

// ---------------------------------------------------------------------------------------------
// Alignment Operations

/** Align the selected items. */
export function alignGeneric<V>(
  /** Action description prefix. E.g. \"Aligned\". */
  desc: string,
  /** Offset for @Viewable@ to move for alignment. */
  offsetF: (cls: Connectable<V>, v: V, outer: BoundBox) => readonly [number, number],
): Action<V> {
  return mkScriptAction(function* (d: DeltaCtx<V>): Delta<V, Action<V>> {
    const cls = connectable(d);
    const sel = yield* selectedItems(d);
    if (sel.length >= 2) { // Alignment of 0 or 1 items is a no-op.
      const [targetAffectedSet, onlyAffectedSet] = yield* moveTargetSets(d, S.fromList(sel.map(fst)));
      const contentsBefore = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
      const targets = mapMaybe(([u]: readonly [DiagramId, V]) => M.lookup(u, contentsBefore), sel);
      const outer = mconcat_BoundBox(sel.map(([, v]) => cls.itemBounds(v)));
      for (const item of targets) yield* cls.itemMove(d, offsetF(cls, item, outer), item);
      const contentsAfter = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
      const targetAffected = mapMaybe((u: DiagramId) => M.lookup(u, contentsAfter), S.toList(targetAffectedSet));
      const onlyAffected = mapMaybe((u: DiagramId) => M.lookup(u, contentsAfter), S.toList(onlyAffectedSet));
      for (const item of [...targetAffected, ...onlyAffected]) yield* cls.itemAdjust(d, item);
      yield* tellCheckpoint(d, desc + " " + String(sel.length) + " items.");
    }
    return yield* yieldViews(d);
  });
}

/** Align to the top of the selection bound box. */
export function alignTop<V>(): Action<V> {
  const topFunc = (cls: Connectable<V>, item: V, outer: BoundBox): [number, number] => {
    const b = cls.itemBounds(item);
    if (b.tag === "BoundBox" && outer.tag === "BoundBox") return [0, view(pY, outer._0) - view(pY, b._0)];
    return [0, 0];
  };
  return alignGeneric<V>("Top aligned", topFunc);
}

/** Align to the top of the selection bound box. */
export function alignBottom<V>(): Action<V> {
  const bottomFunc = (cls: Connectable<V>, item: V, outer: BoundBox): [number, number] => {
    const b = cls.itemBounds(item);
    if (b.tag === "BoundBox" && outer.tag === "BoundBox") return [0, view(pY, outer._1) - view(pY, b._1)];
    return [0, 0];
  };
  return alignGeneric<V>("Bottom aligned", bottomFunc);
}

/** Align to left of selection bound box. */
export function alignLeft<V>(): Action<V> {
  const leftFunc = (cls: Connectable<V>, item: V, outer: BoundBox): [number, number] => {
    const b = cls.itemBounds(item);
    if (b.tag === "BoundBox" && outer.tag === "BoundBox") return [view(pX, outer._0) - view(pX, b._0), 0];
    return [0, 0];
  };
  return alignGeneric<V>("Left aligned", leftFunc);
}

/** Align to left of selection bound box. */
export function alignRight<V>(): Action<V> {
  const rightFunc = (cls: Connectable<V>, item: V, outer: BoundBox): [number, number] => {
    const b = cls.itemBounds(item);
    if (b.tag === "BoundBox" && outer.tag === "BoundBox") return [view(pX, outer._1) - view(pX, b._1), 0];
    return [0, 0];
  };
  return alignGeneric<V>("Right aligned", rightFunc);
}

export function alignVertical<V>(): Action<V> {
  const midFunc = (cls: Connectable<V>, item: V, outer: BoundBox): [number, number] => {
    const b = cls.itemBounds(item);
    if (b.tag === "BoundBox" && outer.tag === "BoundBox") {
      return [view(boxCentre.dot(pX), outer) - view(boxCentre.dot(pX), b), 0];
    }
    return [0, 0];
  };
  return alignGeneric<V>("Vertically aligned", midFunc);
}

export function alignHorizontal<V>(): Action<V> {
  const midFunc = (cls: Connectable<V>, item: V, outer: BoundBox): [number, number] => {
    const b = cls.itemBounds(item);
    if (b.tag === "BoundBox" && outer.tag === "BoundBox") {
      return [0, view(boxCentre.dot(pY), outer) - view(boxCentre.dot(pY), b)];
    }
    return [0, 0];
  };
  return alignGeneric<V>("Horizontally aligned", midFunc);
}

// ---------------------------------------------------------------------------------------------
// Sizing operations

export function sizeGeneric<V>(
  /** Function to extract update from list of items. */
  sizeF: (cls: Connectable<V>, vs: readonly V[]) => number,
  /** Function to update an item. */
  resizeF: (d: DeltaCtx<V>, p: number, v: V) => Delta<V, V>,
): Action<V> {
  return mkScriptAction(function* (d: DeltaCtx<V>): Delta<V, Action<V>> {
    const cls = connectable(d);
    const sel = yield* selectedItems(d);
    if (sel.length >= 2) { // Size adjustment of 0 or 1 items is a no-op.
      const contentsBefore = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
      const p = sizeF(cls, sel.map(snd));
      const targets = mapMaybe(([u]: readonly [DiagramId, V]) => M.lookup(u, contentsBefore), sel);
      for (const t of targets) yield* resizeF(d, p, t);
      const contentsAfter = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
      const [targetAffectedSet, onlyAffectedSet] = yield* moveTargetSets(d, S.fromList(sel.map(fst)));
      const targetAffected = mapMaybe((u: DiagramId) => M.lookup(u, contentsAfter), S.toList(targetAffectedSet));
      const onlyAffected = mapMaybe((u: DiagramId) => M.lookup(u, contentsAfter), S.toList(onlyAffectedSet));
      for (const item of [...targetAffected, ...onlyAffected]) yield* cls.itemAdjust(d, item);
      yield* tellCheckpoint(d, "Resized " + String(sel.length) + " items.");
    }
    return yield* yieldViews(d);
  });
}

export function sizeWidest<V>(): Action<V> {
  // Maximum is safe because this is never called with a list of less than 2 items.
  const widest = (cls: Connectable<V>, vs: readonly V[]): number =>
    L.maximum(vs.map((v) => boxWidth(cls.itemBounds(v))));
  return sizeGeneric<V>(widest, setWidth);
}

export function sizeNarrowest<V>(): Action<V> {
  const narrowest = (cls: Connectable<V>, vs: readonly V[]): number =>
    L.minimum(vs.map((v) => boxWidth(cls.itemBounds(v))));
  return sizeGeneric<V>(narrowest, setWidth);
}

export function sizeTallest<V>(): Action<V> {
  // Maximum is safe because this is never called with a list of less than 2 items.
  const tallest = (cls: Connectable<V>, vs: readonly V[]): number =>
    L.maximum(vs.map((v) => boxHeight(cls.itemBounds(v))));
  return sizeGeneric<V>(tallest, setHeight);
}

export function sizeShortest<V>(): Action<V> {
  const shortest = (cls: Connectable<V>, vs: readonly V[]): number =>
    L.minimum(vs.map((v) => boxHeight(cls.itemBounds(v))));
  return sizeGeneric<V>(shortest, setHeight);
}

function* setWidth<V>(d: DeltaCtx<V>, w: number, item: V): Delta<V, V> {
  return yield* d.cls.itemResize(d, [w, boxHeight(d.cls.itemBounds(item))], item);
}

function* setHeight<V>(d: DeltaCtx<V>, h: number, item: V): Delta<V, V> {
  return yield* d.cls.itemResize(d, [boxWidth(d.cls.itemBounds(item)), h], item);
}

// ---------------------------------------------------------------------------------------------
// Distribute operations

/**
 * A function which computes the distributions of items along an axis. Items are represented
 * by an unsorted list of of @(position, size)@ pairs, and the result is a list of the same
 * length containing adjusted positions for the corresponding items.
 */
type DistributionFunc = (pairs: readonly (readonly [number, number])[]) => number[];

/** Calculate a distribution which places items at regular intervals, ignoring spaces. */
const distributeEven: DistributionFunc = (pairs) => {
  if (pairs.length === 0) return [];
  if (pairs.length === 1) return [pairs[0][0]];
  const n = pairs.length;
  const start = L.minimum(pairs.map(fst));
  const end = L.maximum(pairs.map(fst));
  const sep = (end - start) / (n - 1);
  const indexes = L.sortOn(([p]: readonly [readonly [number, number], number]) => p[0],
    pairs.map((p, i) => [p, i] as const)).map(snd);
  const newPos = (i: number, l: number): [number, number] => [l * sep + start, i];
  return L.sortOn(snd, indexes.map((i, l) => newPos(i, l))).map(fst);
};

/**
 * Calculate a distribution which spaces the items evenly. If the residual space is
 * negative then they will overlap evenly.
 */
const distributeSpace: DistributionFunc = (pairs) => {
  if (pairs.length === 0) return [];
  if (pairs.length === 1) return [pairs[0][0]];
  type Item = readonly [readonly [number, number], number];
  const n = pairs.length;
  const pairs1: Item[] = L.sortOn(([p]: Item) => p[0], pairs.map((p, i): Item => [p, i]));
  const start = ((): number => {
    const [x, w] = pairs1[0][0];
    return x - w / 2;
  })();
  const end = ((): number => {
    const [x, w] = pairs1[pairs1.length - 1][0];
    return x + w / 2;
  })();
  const totalSpace = end - start;
  const used = L.sum(pairs.map(snd));
  const gap = (totalSpace - used) / (n - 1);
  const newPair = ([[p1, w1]]: Item, [[, w0], i]: Item): Item => [[p1 + (w0 + w1) / 2 + gap, w0], i];
  return L.sortOn(snd, L.scanl1(newPair, pairs1)).map(([[p]]) => p);
};

/** Horizontal position and width of the item. Assumes the item bounds are not "NoBox". */
function itemHPos<V>(cls: Connectable<V>, v: V): [number, number] {
  const b = cls.itemBounds(v);
  return [view(boxCentre.dot(pX), b), boxWidth(b)];
}

/** Vertical position and height of the item. Assumes the item bounds are not "NoBox". */
function itemVPos<V>(cls: Connectable<V>, v: V): [number, number] {
  const b = cls.itemBounds(v);
  return [view(boxCentre.dot(pY), b), boxHeight(b)];
}

/** Move the item to a horizontal position. */
function* itemHMove<V>(d: DeltaCtx<V>, x: number, v: V): Delta<V, void> {
  yield* d.cls.itemMove(d, [x - view(boxCentre.dot(pX), d.cls.itemBounds(v)), 0], v);
}

/** Move the item to a horizontal position. */
function* itemVMove<V>(d: DeltaCtx<V>, y: number, v: V): Delta<V, void> {
  yield* d.cls.itemMove(d, [0, y - view(boxCentre.dot(pY), d.cls.itemBounds(v))], v);
}

/** Distribute the current selection according to the rule functions given. */
export function distributeGeneric<V>(
  /** Description of operation. E.g. @\"Distribute\"@ or @\"Space\"@. */
  desc: string,
  distFunc: DistributionFunc,
  /** Current position and width or height. */
  posFunc: (cls: Connectable<V>, v: V) => readonly [number, number],
  /** Move the item to this position. */
  moveFunc: (d: DeltaCtx<V>, x: number, v: V) => Delta<V, void>,
): Action<V> {
  const validBox = (cls: Connectable<V>, v: V): boolean =>
    cls.itemBounds(v).tag !== "NoBox" && isNothing(preview(cls.itemConnectors, v));
  return mkScriptAction(function* (d: DeltaCtx<V>): Delta<V, Action<V>> {
    const cls = connectable(d);
    const sel = (yield* selectedItems(d)).filter(([, v]) => validBox(cls, v));
    if (sel.length >= 3) { // Distributing less than 3 items is a no-op.
      const newPositions = distFunc(sel.map(([, v]) => posFunc(cls, v)));
      const vs = sel.map(snd);
      for (let i = 0; i < Math.min(newPositions.length, vs.length); i++) yield* moveFunc(d, newPositions[i], vs[i]);
      const contentsAfter = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
      const [targetAffectedSet, onlyAffectedSet] = yield* moveTargetSets(d, S.fromList(sel.map(fst)));
      const targetAffected = mapMaybe((u: DiagramId) => M.lookup(u, contentsAfter), S.toList(targetAffectedSet));
      const onlyAffected = mapMaybe((u: DiagramId) => M.lookup(u, contentsAfter), S.toList(onlyAffectedSet));
      for (const item of [...targetAffected, ...onlyAffected]) yield* cls.itemAdjust(d, item);
      yield* tellCheckpoint(d, desc + " " + String(sel.length) + " items.");
    }
    return yield* yieldViews(d);
  });
}

/** Distribute the selection horizontally at regular intervals. */
export function distributeH<V>(): Action<V> {
  return distributeGeneric<V>("Horizontally distribute", distributeEven, itemHPos, itemHMove);
}

/** Distribute the selection vertically at regular intervals. */
export function distributeV<V>(): Action<V> {
  return distributeGeneric<V>("Vertically distribute", distributeEven, itemVPos, itemVMove);
}

/** Distribute the selection with regular horizontal spaces between them. */
export function spaceH<V>(): Action<V> {
  return distributeGeneric<V>("Horizontally space", distributeSpace, itemHPos, itemHMove);
}

/** Distribute the selection with regular vertical spaces between them. */
export function spaceV<V>(): Action<V> {
  return distributeGeneric<V>("Vertically space", distributeSpace, itemVPos, itemVMove);
}
