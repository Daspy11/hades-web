// Ported from hades/src/Hades/Abstract/Diagram.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module handles diagrams in their most abstract form.
 */
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as J from "@/lib/Data/Aeson";
import { catMaybes } from "@/lib/Data/Maybe";
import { lens, type Lens } from "@/lib/Control/Lens";
import type { UUID } from "@/lib/Data/UUID";

export type DiagramId = UUID;

/** Things that carry a unique ID with them. */
export interface HasId<A> {
  identifier(a: A): DiagramId;
}

/**
 * The type of diagrams. The "Monoid" instance places the first diagram in front of the second.
 * If the two diagrams share DiagramIds then those from the first diagram will be used.
 */
export interface Diagram<V> {
  /** Each element has a "DiagramId", which is used as a form of weak pointer. */
  readonly _diagramContents: M.Map<DiagramId, V>;
  /** Order of the contents from front to back. */
  readonly _diagramOrder: readonly DiagramId[];
}
export function Diagram<V>(_diagramContents: M.Map<DiagramId, V>, _diagramOrder: readonly DiagramId[]): Diagram<V> {
  return { _diagramContents, _diagramOrder };
}

/** `instance Semigroup (Diagram v)` */
export function append_Diagram<V>(d1: Diagram<V>, d2: Diagram<V>): Diagram<V> {
  return Diagram(
    M.union(d1._diagramContents, d2._diagramContents),
    L.nub([...d1._diagramOrder, ...d2._diagramOrder]),
  );
}

/** `instance Monoid (Diagram v)` */
export function mempty_Diagram<V>(): Diagram<V> {
  return emptyDiagram();
}

/** `instance (ToJSON v) => ToJSON (Diagram v)` and `instance (FromJSON v, HasId v) => FromJSON (Diagram v)` */
export function JSON_Diagram<V>(hasId: HasId<V>, cv: J.JSONCodec<V>): J.JSONCodec<Diagram<V>> {
  const lst = J.listJ(cv);
  return J.codec(
    (d) => lst.toJSON(diagramToList(d)),
    (v) => diagramFromList(hasId, lst.parseJSON(v)),
  );
}

// Template Haskell is not used for lens definitions because of painful problems
// with recursive datatypes.

/**
 * The elements in the diagram. Each element has a "DiagramId",
 * which is used as form of weak pointer.
 */
export function diagramContents<V = any>(): Lens<Diagram<V>, M.Map<DiagramId, V>> {
  return lens((s: Diagram<V>) => s._diagramContents, (s, c: M.Map<DiagramId, V>) => ({ ...s, _diagramContents: c }));
}

/** Order of the contents from front to back. */
export function diagramOrder<V = any>(): Lens<Diagram<V>, readonly DiagramId[]> {
  return lens((s: Diagram<V>) => s._diagramOrder, (s, o: readonly DiagramId[]) => ({ ...s, _diagramOrder: o }));
}

/** Diagram with nothing in it. */
export function emptyDiagram<V>(): Diagram<V> {
  return Diagram(M.empty<DiagramId, V>(), []);
}

/** Diagram contents in order from front to back. */
export function diagramToList<V>(d: Diagram<V>): V[] {
  return catMaybes(d._diagramOrder.map((u) => M.lookup(u, d._diagramContents)));
}

/**
 * Inverse of "diagramToList". If two elements have the same DiagramId then
 * the first (uppermost) will be used.
 */
export function diagramFromList<V>(cls: HasId<V>, items: readonly V[]): Diagram<V> {
  return L.foldr((item: V, d: Diagram<V>) => diagramAdd(cls, item, d), emptyDiagram<V>(), items);
}

/** Lens for the list of elements in the diagram */
export function diagramList<V>(cls: HasId<V>): Lens<Diagram<V>, readonly V[]> {
  return lens((d: Diagram<V>) => diagramToList(d), (_d, items: readonly V[]) => diagramFromList(cls, items));
}

/**
 * Add a new element to the front of the diagram. If the "DiagramId" already exists then
 * it replaces the old one.
 */
export function diagramAdd<V>(cls: HasId<V>, item: V, d: Diagram<V>): Diagram<V> {
  const uuid = cls.identifier(item);
  const newContents = M.insert(uuid, item, d._diagramContents);
  const newOrder = [uuid, ...(M.member(uuid, d._diagramContents) ? L.delete(uuid, d._diagramOrder) : d._diagramOrder)];
  return Diagram(newContents, newOrder);
}

/**
 * Remove an element from the diagram by its "DiagramId".
 * If the "DiagramId" is not found then no change.
 */
export function diagramDelete<V>(uuid: DiagramId, d: Diagram<V>): Diagram<V> {
  return Diagram(M.delete(uuid, d._diagramContents), L.delete(uuid, d._diagramOrder));
}

/** Modify an element within the diagram. Assumes that the "DiagramId" does not change. */
export function diagramModify<V>(f: (v: V) => V, uuid: DiagramId, d: Diagram<V>): Diagram<V> {
  return Diagram(M.adjust(f, uuid, d._diagramContents), d._diagramOrder);
}

/** Move a diagram element up one in the order, unless its already at the top. */
export function diagramMoveUp<V>(uuid: DiagramId, d: Diagram<V>): Diagram<V> {
  const [ids1, ids2] = contentsSplit(uuid, d._diagramOrder);
  if (ids1.length === 0) return d;
  const [ids1a, ids1b] = L.splitAt(ids1.length - 1, ids1);
  return Diagram(d._diagramContents, [...ids1a, uuid, ...ids1b, ...ids2]);
}

/** Move a diagram element down one in the order, unless its already at the bottom. */
export function diagramMoveDown<V>(uuid: DiagramId, d: Diagram<V>): Diagram<V> {
  const [ids1, ids2] = contentsSplit(uuid, d._diagramOrder);
  if (ids2.length === 0) return d;
  const [ids2a, ...ids2b] = ids2;
  return Diagram(d._diagramContents, [...ids1, ids2a, uuid, ...ids2b]);
}

/** Move a diagram element to the top. */
export function diagramMoveTop<V>(uuid: DiagramId, d: Diagram<V>): Diagram<V> {
  const [ids1, ids2] = contentsSplit(uuid, d._diagramOrder);
  if (ids1.length === 0) return d;
  return Diagram(d._diagramContents, [uuid, ...ids1, ...ids2]);
}

/** Move a diagram element to the bottom. */
export function diagramMoveBottom<V>(uuid: DiagramId, d: Diagram<V>): Diagram<V> {
  const [ids1, ids2] = contentsSplit(uuid, d._diagramOrder);
  if (ids2.length === 0) return d;
  return Diagram(d._diagramContents, [...ids1, ...ids2, uuid]);
}

/**
 * Private utility function. Splits the list at the "DiagramId"
 * and returns those before and those after.
 */
function contentsSplit(uuid: DiagramId, ids: readonly DiagramId[]): [DiagramId[], DiagramId[]] {
  const [ids1, ids2] = L.break((x: DiagramId) => x === uuid, ids);
  return [ids1, ids2.slice(1)];
}
