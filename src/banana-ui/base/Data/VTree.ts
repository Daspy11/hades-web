// Ported from banana-ui/base/Data/VTree.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Vector-based rose trees. Similar to "Data.Tree", but using vectors to store children rather
 * than lists. This makes for more efficient accessing.
 *
 * TypeScript port: vectors are plain readonly arrays. The `Ixed (VTree a)` instance is
 * `ix_VTree(address)`.
 */
import { Just, Nothing, type Maybe, bindMaybe } from "@/lib/Data/Maybe";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { iso, lens, traversal, type Iso, type Lens, type Traversal } from "@/lib/Control/Lens";

// * Types

export interface VTree<A> {
  readonly _root: A;
  readonly _branches: VForest<A>;
}
export function VNode<A>(_root: A, _branches: VForest<A>): VTree<A> {
  return { _root, _branches };
}

/** `instance Functor VTree` */
export function fmap_VTree<A, R>(f: (a: A) => R, t: VTree<A>): VTree<R> {
  return VNode(f(t._root), t._branches.map((c) => fmap_VTree(f, c)));
}

export type VForest<A> = readonly VTree<A>[];

/**
 * A node in a VTree can be referenced by an Address.
 * This is a list of indices within the vectors, one for each level. The empty address refers to
 * the root of the tree.
 */
export type Address = readonly number[];

// type instance Index (VTree a) = Address
// type instance IxValue (VTree a) = a

/**
 * `instance Ixed (VTree a)`: `ix :: Address -> Traversal' (VTree a) a`.
 *
 * Cribbed from the Ixed Tree instance.
 */
export function ix_VTree<A = any>(xs0: Address): Traversal<VTree<A>, A> {
  const go = (xs: Address, t: VTree<A>, f: (a: A) => A): VTree<A> => {
    if (xs.length === 0) return VNode(f(t._root), t._branches);
    const [i, ...is] = xs;
    const as = t._branches;
    if (i < 0 || i >= as.length) return t;
    return VNode(t._root, as.map((c, j) => (j === i ? go(is, c, f) : c)));
  };
  return traversal(
    (t: VTree<A>, f: (a: A) => A) => go(xs0, t, f),
    (t: VTree<A>) => {
      const v = getValue(xs0, t);
      return v.tag === "Just" ? [v.value] : [];
    },
  );
}

// * Lenses

/** Lens focusing on the value at the root of the tree. */
export function root<A = any>(): Lens<VTree<A>, A> {
  return lens((s: VTree<A>) => s._root, (s, v: A) => ({ ...s, _root: v }));
}

/** Lens focusing on the immediate children of the tree. */
export function branches<A = any>(): Lens<VTree<A>, VForest<A>> {
  return lens((s: VTree<A>) => s._branches, (s, b: VForest<A>) => ({ ...s, _branches: b }));
}

/** ISO with list-based rose tree. */
export function treeIso<A = any>(): Iso<Tree<A>, VTree<A>> {
  return iso((t: Tree<A>) => fromTree(t), (v: VTree<A>) => toTree(v));
}

/** `V.vector . mapping treeIso` */
export function forestIso<A = any>(): Iso<Forest<A>, VForest<A>> {
  return iso(
    (f: Forest<A>): VForest<A> => f.map(fromTree),
    (v: VForest<A>): Forest<A> => v.map(toTree),
  );
}

// * Accessors

/**
 * Retrieve the node referenced by the address. Returns @Nothing@ if the address does not exist
 * in the tree.
 */
export function getNode<A>(addr: Address, node: VTree<A>): Maybe<VTree<A>> {
  if (addr.length === 0) return Just(node);
  const [n, ...ns] = addr;
  const forest = node._branches;
  const child: Maybe<VTree<A>> = n >= 0 && n < forest.length ? Just(forest[n]) : Nothing; // forest !? n
  return bindMaybe(child, (c) => getNode(ns, c));
}

/** Get the value referenced by the address. Returns @Nothing@ if the address does not exist. */
export function getValue<A>(addr: Address, tree: VTree<A>): Maybe<A> {
  const n = getNode(addr, tree);
  return n.tag === "Just" ? Just(n.value._root) : Nothing;
}

/**
 * Set the node value at the address. Returns Nothing if the address does not exist.
 *
 * Note: ported faithfully from the Haskell, which returns the updated *subtree* at the address
 * rather than the whole tree when the address is not empty.
 */
export function setValue<A>(addr: Address, v: A, tree: VTree<A>): Maybe<VTree<A>> {
  if (addr.length === 0) return Just(VNode(v, tree._branches));
  const [n, ...ns] = addr;
  const forest = tree._branches;
  if (n < 0 || n >= forest.length) return Nothing; // child <- forest !? n
  const child = forest[n];
  return setValue(ns, v, child);
}

export function toTree<A>(t: VTree<A>): Tree<A> {
  return Node(t._root, t._branches.map(toTree));
}

export function fromTree<A>(t: Tree<A>): VTree<A> {
  return VNode(t.rootLabel, t.subForest.map(fromTree));
}

// * Traversal

/** Return the first child of the current node, if it exists. */
export function goDown<A>(tree: VTree<A>, addr: Address): Maybe<Address> {
  const node = getNode(addr, tree);
  if (node.tag === "Nothing") return Nothing;
  return node.value._branches.length === 0 ? Nothing : Just([...addr, 0]);
}

/** Return the parent of the current node. @Nothing@ if already at root. */
export function goUp(addr: Address): Maybe<Address> {
  if (addr.length === 0) return Nothing;
  return Just(addr.slice(0, -1));
}

/** Return the right sibling of the current node. @Nothing@ if there is none. */
export function goNext<A>(tree: VTree<A>, addr: Address): Maybe<Address> {
  const parent = goUp(addr);
  if (parent.tag === "Nothing") return Nothing;
  const n: Maybe<number> = addr.length === 0 ? Nothing : Just(addr[addr.length - 1]);
  if (n.tag === "Nothing") return Nothing;
  const r = [...parent.value, n.value + 1];
  if (getValue(r, tree).tag === "Nothing") return Nothing; // Verify that the sibling exists.
  return Just(r);
}
