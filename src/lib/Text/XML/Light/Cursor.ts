/**
 * Haskell `Text.XML.Light.Cursor` (package `xml`): XML cursors for working XML content
 * within the context of an XML document. This implementation is based on the general tree
 * zipper written by Krasimir Angelov and Iavor S. Diatchki.
 *
 * Cursors are immutable values; lists (`lefts`, `rights`, `parents`) are arrays in Haskell
 * list order (so `lefts` has the closest sibling first). `modifyContentM` is in direct style.
 */
import { Just, Nothing, type Maybe } from "../../../Data/Maybe";
import { Elem, Element, type Attr, type Content, type Line, type QName } from "./Types";

export interface Tag {
  readonly tagName: QName;
  readonly tagAttribs: readonly Attr[];
  readonly tagLine: Maybe<Line>;
}
export function Tag(tagName: QName, tagAttribs: readonly Attr[], tagLine: Maybe<Line>): Tag {
  return { tagName, tagAttribs, tagLine };
}

export function getTag(e: Element): Tag {
  return Tag(e.elName, e.elAttribs, e.elLine);
}

export function setTag(t: Tag, e: Element): Element {
  return fromTag(t, e.elContent);
}

export function fromTag(t: Tag, cs: readonly Content[]): Element {
  return Element(t.tagName, t.tagAttribs, cs, t.tagLine);
}

export type Path = readonly (readonly [readonly Content[], Tag, readonly Content[]])[];

/** The position of a piece of content in an XML document. */
export interface Cursor {
  /** The currently selected content. */
  readonly current: Content;
  /** Siblings on the left, closest first. */
  readonly lefts: readonly Content[];
  /** Siblings on the right, closest first. */
  readonly rights: readonly Content[];
  /** The contexts of the parent elements of this location. */
  readonly parents: Path;
}
/** The `Cur` constructor of `Cursor`. */
export function Cur(current: Content, lefts: readonly Content[], rights: readonly Content[], parents: Path): Cursor {
  return { current, lefts, rights, parents };
}

// Moving around ---------------------------------------------------------------

/** The parent of the given location. */
export function parent(loc: Cursor): Maybe<Cursor> {
  if (loc.parents.length === 0) return Nothing;
  const [[pls, v, prs], ...ps] = loc.parents;
  return Just(Cur(Elem(fromTag(v, combChildren(loc.lefts, loc.current, loc.rights))), pls, prs, ps));
}

/** The top-most parent of the given location. */
export function root(loc: Cursor): Cursor {
  let c = loc;
  for (;;) {
    const p = parent(c);
    if (p.tag === "Nothing") return c;
    c = p.value;
  }
}

/** The left sibling of the given location. */
export function left(loc: Cursor): Maybe<Cursor> {
  if (loc.lefts.length === 0) return Nothing;
  const [t, ...ts] = loc.lefts;
  return Just(Cur(t, ts, [loc.current, ...loc.rights], loc.parents));
}

/** The right sibling of the given location. */
export function right(loc: Cursor): Maybe<Cursor> {
  if (loc.rights.length === 0) return Nothing;
  const [t, ...ts] = loc.rights;
  return Just(Cur(t, [loc.current, ...loc.lefts], ts, loc.parents));
}

/** The first child of the given location. */
export function firstChild(loc: Cursor): Maybe<Cursor> {
  const d = downParents(loc);
  if (d.tag === "Nothing") return Nothing;
  const [ts0, ps] = d.value;
  if (ts0.length === 0) return Nothing;
  const [t, ...ts] = ts0;
  return Just(Cur(t, [], ts, ps));
}

/** The last child of the given location. */
export function lastChild(loc: Cursor): Maybe<Cursor> {
  const d = downParents(loc);
  if (d.tag === "Nothing") return Nothing;
  const [ts, ps] = d.value;
  const rev = [...ts].reverse();
  if (rev.length === 0) return Nothing;
  const [l, ...ls] = rev;
  return Just(Cur(l, ls, [], ps));
}

/** Find the next left sibling that satisfies a predicate. */
export function findLeft(p: (c: Cursor) => boolean, loc: Cursor): Maybe<Cursor> {
  let c = left(loc);
  while (c.tag === "Just") {
    if (p(c.value)) return c;
    c = left(c.value);
  }
  return Nothing;
}

/** Find the next right sibling that satisfies a predicate. */
export function findRight(p: (c: Cursor) => boolean, loc: Cursor): Maybe<Cursor> {
  let c = right(loc);
  while (c.tag === "Just") {
    if (p(c.value)) return c;
    c = right(c.value);
  }
  return Nothing;
}

/** The first child that satisfies a predicate. */
export function findChild(p: (c: Cursor) => boolean, loc: Cursor): Maybe<Cursor> {
  const loc1 = firstChild(loc);
  if (loc1.tag === "Nothing") return Nothing;
  return p(loc1.value) ? loc1 : findRight(p, loc1.value);
}

/**
 * The next position in a left-to-right depth-first traversal of a document:
 * either the first child, right sibling, or the right sibling of a parent that
 * has one.
 */
export function nextDF(c: Cursor): Maybe<Cursor> {
  const fc = firstChild(c);
  if (fc.tag === "Just") return fc;
  // up x = right x `mplus` (up =<< parent x)
  let x = c;
  for (;;) {
    const r = right(x);
    if (r.tag === "Just") return r;
    const p = parent(x);
    if (p.tag === "Nothing") return Nothing;
    x = p.value;
  }
}

/**
 * Perform a depth first search for a descendant that satisfies the
 * given predicate.
 */
export function findRec(p: (c: Cursor) => boolean, c: Cursor): Maybe<Cursor> {
  let cur: Cursor = c;
  for (;;) {
    if (p(cur)) return Just(cur);
    const n = nextDF(cur);
    if (n.tag === "Nothing") return Nothing;
    cur = n.value;
  }
}

/** The child with the given index (starting from 0). */
export function getChild(n: number, loc: Cursor): Maybe<Cursor> {
  const d = downParents(loc);
  if (d.tag === "Nothing") return Nothing;
  const [ts, ps] = d.value;
  const s = splitChildren(ts, n);
  if (s.tag === "Nothing") return Nothing;
  const [ls, t, rs] = s.value;
  return Just(Cur(t, ls, rs, ps));
}

/** private: computes the parent for "down" operations. */
function downParents(loc: Cursor): Maybe<[readonly Content[], Path]> {
  const c = loc.current;
  if (c.tag !== "Elem") return Nothing;
  const e = c._0;
  return Just([e.elContent, [[loc.lefts, getTag(e), loc.rights] as const, ...loc.parents]]);
}

// Conversions -----------------------------------------------------------------

/** A cursor for the given content. */
export function fromContent(t: Content): Cursor {
  return Cur(t, [], [], []);
}

/** A cursor for the given element. */
export function fromElement(e: Element): Cursor {
  return fromContent(Elem(e));
}

/** The location of the first tree in a forest. */
export function fromForest(cs: readonly Content[]): Maybe<Cursor> {
  if (cs.length === 0) return Nothing;
  const [t, ...ts] = cs;
  return Just(Cur(t, [], ts, []));
}

/** Computes the tree containing this location. */
export function toTree(loc: Cursor): Content {
  return root(loc).current;
}

/** Computes the forest containing this location. */
export function toForest(loc: Cursor): Content[] {
  const r = root(loc);
  return combChildren(r.lefts, r.current, r.rights);
}

// Queries ---------------------------------------------------------------------

/** Are we at the top of the document? */
export function isRoot(loc: Cursor): boolean {
  return loc.parents.length === 0;
}

/** Are we at the left end of the the document? */
export function isFirst(loc: Cursor): boolean {
  return loc.lefts.length === 0;
}

/** Are we at the right end of the document? */
export function isLast(loc: Cursor): boolean {
  return loc.rights.length === 0;
}

/** Are we at the bottom of the document? */
export function isLeaf(loc: Cursor): boolean {
  return downParents(loc).tag === "Nothing";
}

/** Do we have a parent? */
export function isChild(loc: Cursor): boolean {
  return !isRoot(loc);
}

/** Get the node index inside the sequence of children */
export function getNodeIndex(loc: Cursor): number {
  return loc.lefts.length;
}

/** Do we have children? */
export function hasChildren(loc: Cursor): boolean {
  return !isLeaf(loc);
}

// Updates ---------------------------------------------------------------------

/** Change the current content. */
export function setContent(t: Content, loc: Cursor): Cursor {
  return Cur(t, loc.lefts, loc.rights, loc.parents);
}

/** Modify the current content. */
export function modifyContent(f: (c: Content) => Content, loc: Cursor): Cursor {
  return setContent(f(loc.current), loc);
}

/** Modify the current content, allowing for an effect (direct style). */
export function modifyContentM(f: (c: Content) => Content, loc: Cursor): Cursor {
  const x = f(loc.current);
  return setContent(x, loc);
}

/** Insert content to the left of the current position. */
export function insertLeft(t: Content, loc: Cursor): Cursor {
  return Cur(loc.current, [t, ...loc.lefts], loc.rights, loc.parents);
}

/** Insert content to the right of the current position. */
export function insertRight(t: Content, loc: Cursor): Cursor {
  return Cur(loc.current, loc.lefts, [t, ...loc.rights], loc.parents);
}

/**
 * Insert content to the left of the current position.
 * The new content is inserted in the order of the list.
 */
export function insertManyLeft(t: readonly Content[], loc: Cursor): Cursor {
  return Cur(loc.current, [...[...t].reverse(), ...loc.lefts], loc.rights, loc.parents);
}

/** Insert content to the right of the current position. */
export function insertManyRight(t: readonly Content[], loc: Cursor): Cursor {
  return Cur(loc.current, loc.lefts, [...t, ...loc.rights], loc.parents);
}

/** Insert content as the first child of the current position. */
function mapChildren(f: (cs: readonly Content[]) => readonly Content[], loc: Cursor): Maybe<Cursor> {
  const e = loc.current;
  if (e.tag !== "Elem") return Nothing;
  const e1 = e._0;
  return Just(setContent(Elem(Element(e1.elName, e1.elAttribs, f(e1.elContent), e1.elLine)), loc));
}

/** Insert content as the first child of the current position. */
export function insertFirstChild(t: Content, loc: Cursor): Maybe<Cursor> {
  return mapChildren((cs) => [t, ...cs], loc);
}

/** Insert content as the last child of the current position. */
export function insertLastChild(t: Content, loc: Cursor): Maybe<Cursor> {
  return mapChildren((cs) => [...cs, t], loc);
}

/** Insert content as the first children of the current position. */
export function insertManyFirstChild(t: readonly Content[], loc: Cursor): Maybe<Cursor> {
  return mapChildren((cs) => [...t, ...cs], loc);
}

/** Insert content as the last children of the current position. */
export function insertManyLastChild(t: readonly Content[], loc: Cursor): Maybe<Cursor> {
  return mapChildren((cs) => [...cs, ...t], loc);
}

/** Remove the content on the left of the current position, if any. */
export function removeLeft(loc: Cursor): Maybe<[Content, Cursor]> {
  if (loc.lefts.length === 0) return Nothing;
  const [l, ...ls] = loc.lefts;
  return Just([l, Cur(loc.current, ls, loc.rights, loc.parents)]);
}

/** Remove the content on the right of the current position, if any. */
export function removeRight(loc: Cursor): Maybe<[Content, Cursor]> {
  if (loc.rights.length === 0) return Nothing;
  const [l, ...ls] = loc.rights;
  return Just([l, Cur(loc.current, loc.lefts, ls, loc.parents)]);
}

/**
 * Insert content to the left of the current position,
 * and move to the new content.
 */
export function insertGoLeft(t: Content, loc: Cursor): Cursor {
  return Cur(t, loc.lefts, [loc.current, ...loc.rights], loc.parents);
}

/**
 * Insert content to the right of the current position,
 * and move to the new content.
 */
export function insertGoRight(t: Content, loc: Cursor): Cursor {
  return Cur(t, [loc.current, ...loc.lefts], loc.rights, loc.parents);
}

/** Remove the current element, and move to the item on the left, if any. */
export function removeGoLeft(loc: Cursor): Maybe<Cursor> {
  if (loc.lefts.length === 0) return Nothing;
  const [l, ...ls] = loc.lefts;
  return Just(Cur(l, ls, loc.rights, loc.parents));
}

/** Remove the current element, and move to the item on the right, if any. */
export function removeGoRight(loc: Cursor): Maybe<Cursor> {
  if (loc.rights.length === 0) return Nothing;
  const [l, ...ls] = loc.rights;
  return Just(Cur(l, loc.lefts, ls, loc.parents));
}

/** Remove the current element, and move to the parent, if any. */
export function removeGoUp(loc: Cursor): Maybe<Cursor> {
  if (loc.parents.length === 0) return Nothing;
  const [[pls, v, prs], ...ps] = loc.parents;
  return Just(Cur(Elem(fromTag(v, [...[...loc.lefts].reverse(), ...loc.rights])), pls, prs, ps));
}

/**
 * private: Gets the given element of a list.
 * Also returns the preceding elements (reversed) and the following elements.
 */
function splitChildren<A>(cs: readonly A[], pos: number): Maybe<[A[], A, A[]]> {
  if (pos < 0 || pos >= cs.length) return Nothing;
  return Just([cs.slice(0, pos).reverse(), cs[pos], cs.slice(pos + 1)]);
}

/** private: combChildren ls x ys = reverse ls ++ [x] ++ ys */
function combChildren<A>(ls: readonly A[], t: A, rs: readonly A[]): A[] {
  return [...[...ls].reverse(), t, ...rs];
}
