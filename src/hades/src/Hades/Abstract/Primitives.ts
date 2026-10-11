// Ported from hades/src/Hades/Abstract/Primitives.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Primitive editing actions for abstract diagrams.
 *
 * TypeScript port
 * ---------------
 * All of these are Delta generator functions taking the `DeltaCtx` first. Functions that take a
 * Haskell action argument of type @v -> Delta v a@ (`withItem`, `withItem1`, `modifyItem`) take a
 * function `(d, v) => Delta<V, A>`, which is called with the same context.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { use, assign, modifying, over } from "@/lib/Control/Lens";
import { connectable, isConnectedTo, getAllConnected, Unconnected, type ConnectorEnd } from "./Connections";
import {
  type Delta, type DeltaCtx, ViewSet, deltaDiagram, deltaSelection, tellViews, tellTransients, tellAll,
  tellItem, changeSelection, getSelection, nextDiagramId, mempty_View,
} from "./Delta";
import {
  type Diagram, type DiagramId, diagramContents, diagramList, diagramToList, diagramAdd, diagramDelete,
  diagramModify, diagramMoveUp, diagramMoveTop, diagramMoveDown, diagramMoveBottom, append_Diagram,
} from "./Diagram";

/** Set the Diagram to be the argument, and update the Views accordingly. */
export function* setDiagram<V>(d: DeltaCtx<V>, dg: Diagram<V>): Delta<V, void> {
  const oldItems = use(d, deltaDiagram<V>().dot(diagramList<V>(d.cls)));
  const v = ViewSet(M.fromList(oldItems.map((i) => [d.cls.identifier(i), mempty_View<V>()] as const)));
  yield* tellViews(d, v); // Clear old diagram views.
  yield* tellTransients(d, v);
  assign(d, deltaDiagram<V>(), dg); // Lens (.=) is hidden, so use `assign` synonym instead.
  assign(d, deltaSelection<V>(), S.empty<DiagramId>());
  yield* tellAll(d);
}

/**
 * Merge an existing diagram into the current one. The new items are placed at the front and
 * selected.
 */
export function* mergeDiagram<V>(d: DeltaCtx<V>, dg: Diagram<V>): Delta<V, void> {
  modifying(d, deltaDiagram<V>(), (old) => append_Diagram(dg, old));
  yield* changeSelection(d, S.fromList(diagramToList(dg).map((i) => d.cls.identifier(i))));
  yield* tellAll(d);
}

/**
 * Add a new item to the Diagram. The new item is assigned a "DiagramId"
 * and put at the front. Returns the new item.
 */
export function* addItem<V>(d: DeltaCtx<V>, f: (uuid: DiagramId) => V): Delta<V, V> {
  const uuid = yield* nextDiagramId(d);
  const item = f(uuid);
  modifying(d, deltaDiagram<V>(), (dg) => diagramAdd(d.cls, item, dg));
  yield* tellItem(d, item);
  return item;
}

/**
 * Remove an item from the Diagram. If any other entities are connected to it then disconnect
 * them.
 */
export function* deleteItem<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  const cls = connectable(d);
  const disconnect = (c: ConnectorEnd): ConnectorEnd =>
    isConnectedTo(c, uuid) ? Unconnected(c.connectorPoint) : c;
  const sel = yield* getSelection(d);
  yield* changeSelection(d, S.delete(uuid, sel));
  const connected = yield* getAllConnected(d, uuid);
  for (const c of connected) yield* updateItem(d, over(cls.itemConnectors, disconnect, c));
  modifying(d, deltaDiagram<V>(), (dg) => diagramDelete(uuid, dg));
  const v = ViewSet(M.singleton(uuid, mempty_View<V>()));
  yield* tellViews(d, v);
  yield* tellTransients(d, v);
}

/**
 * Execute an action with the item corresponding to a UUID. If the UUID is not found
 * then @Nothing@ is returned.
 */
export function* withItem<V, A>(
  d: DeltaCtx<V>,
  uuid: DiagramId,
  actionF: (d: DeltaCtx<V>, v: V) => Delta<V, A>,
): Delta<V, Maybe<A>> {
  const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const item = M.lookup(uuid, cs);
  if (item.tag === "Nothing") return Nothing;
  return Just(yield* actionF(d, item.value));
}

/** Similar to "withItem", except that if the item is not found then the action is ignored. */
export function* withItem1<V>(
  d: DeltaCtx<V>,
  uuid: DiagramId,
  act: (d: DeltaCtx<V>, v: V) => Delta<V, unknown>,
): Delta<V, void> {
  yield* withItem(d, uuid, act);
}

/**
 * Modify an item in the Diagram if it exists, and return the new version. The modification
 * is a monadic action so that the modified item can have side effects elsewhere in the diagram,
 * such as moving connectors to follow a box.
 */
export function* modifyItem<V>(
  d: DeltaCtx<V>,
  uuid: DiagramId,
  actionF: (d: DeltaCtx<V>, v: V) => Delta<V, V>,
): Delta<V, Maybe<V>> {
  const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const item = M.lookup(uuid, cs);
  if (item.tag === "Nothing") return Nothing;
  const newItem = yield* actionF(d, item.value);
  modifying(d, deltaDiagram<V>(), (dg) => diagramModify(() => newItem, uuid, dg));
  yield* tellItem(d, newItem);
  return Just(newItem);
}

/**
 * If there is an element in the diagram with the same UUID then this will replace it.
 * Otherwise it will be added.
 */
export function* updateItem<V>(d: DeltaCtx<V>, item: V): Delta<V, void> {
  const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const uuid = d.cls.identifier(item);
  if (M.lookup(uuid, cs).tag === "Nothing") {
    modifying(d, deltaDiagram<V>(), (dg) => diagramAdd(d.cls, item, dg));
  } else {
    modifying(d, deltaDiagram<V>(), (dg) => diagramModify(() => item, uuid, dg));
  }
  yield* tellItem(d, item);
}

/**
 * Private utility function. If the UUID exists then modify the diagram and "tell" that the
 * item in question must be redrawn.
 */
function* alterDiagram<V>(d: DeltaCtx<V>, f: (dg: Diagram<V>) => Diagram<V>, uuid: DiagramId): Delta<V, void> {
  const cs = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
  const item = M.lookup(uuid, cs);
  if (item.tag === "Nothing") return;
  modifying(d, deltaDiagram<V>(), f);
  yield* tellItem(d, item.value);
}

/** Move an element up one layer in the diagram. */
export function* moveUp<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  yield* alterDiagram(d, (dg) => diagramMoveUp(uuid, dg), uuid);
}

/** Move an element to the top of the diagram. */
export function* moveTop<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  yield* alterDiagram(d, (dg) => diagramMoveTop(uuid, dg), uuid);
}

/** Move an element down one layer in the diagram. */
export function* moveDown<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  yield* alterDiagram(d, (dg) => diagramMoveDown(uuid, dg), uuid);
}

/** Move an element to the bottom of the diagram. */
export function* moveBottom<V>(d: DeltaCtx<V>, uuid: DiagramId): Delta<V, void> {
  yield* alterDiagram(d, (dg) => diagramMoveBottom(uuid, dg), uuid);
}
