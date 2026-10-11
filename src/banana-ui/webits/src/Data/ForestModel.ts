// Ported from banana-ui/webits/src/Data/ForestModel.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * A TreeModel is a way to represent a mutable forest of data. Nodes can be created, edited, moved and
 * deleted by reference to unique IDs.
 *
 * This module is designed to be imported qualified.
 *
 * TypeScript port
 * ---------------
 * * `Edit a b` (a newtype over `State (Model a)`) is `Edit<A, B>` = `(st: StateCell<Model<A>>) =>
 *   B`; functions in `Edit` take the state cell first (PORTING.md §7.1):
 *   `FM.evalEdit((st) => { FM.delete_(st, 1); return FM.getForest(st); }, model)`.
 * * `Model` has a hand-written `Eq` (equal forests), so it is a class implementing `[EqSym]`;
 *   build models with `Model(...)`, `emptyModel()` or `makeModel(...)`. `eq_Model` is the same
 *   test as a function.
 * * `instance Ixed (Model a)` is `ix_Model(k)`; the `Functor` instance is `fmap_Model`.
 * * `delete` is `delete_` (also exported as `delete`); `Insertion` is a string enumeration with
 *   `insertionValues` in constructor order.
 * * Partial functions (`getItem`, `getTree`, ...) throw an `Error` as Haskell `error` does.
 */
import { Just, Nothing, catMaybes, fromMaybe, isJust, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import * as M from "@/lib/Data/Map";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Tree";
import { EqSym, equals } from "@/lib/Data/Ord";
import { error } from "@/lib/Prelude";
import {
  assign,
  at,
  iso,
  ix,
  lens,
  modifying,
  over,
  preview,
  traversal,
  use,
  view,
  type Iso,
  type Lens,
  type StateCell,
  type Traversal,
} from "@/lib/Control/Lens";

/** The model is indexed by integers. */
export type ModelIndex = number;

/** A flag value for root. All other indices are @> rootIndex@. */
export const rootIndex: number = -1;

/** A tree node within the model. (`deriving (Functor, Eq)`: structural equality.) */
interface Node<A> {
  readonly _parent: ModelIndex;
  readonly _children: readonly ModelIndex[];
  readonly _value: A;
}
function Node<A>(_parent: ModelIndex, _children: readonly ModelIndex[], _value: A): Node<A> {
  return { _parent, _children, _value };
}

/** `deriving Functor` for Node. */
function fmap_Node<A, B>(f: (a: A) => B, n: Node<A>): Node<B> {
  return Node(n._parent, n._children, f(n._value));
}

function parent<A = any>(): Lens<Node<A>, ModelIndex> {
  return lens(
    (s: Node<A>) => s._parent,
    (s, x: ModelIndex) => ({ ...s, _parent: x }),
  );
}

function children<A = any>(): Lens<Node<A>, readonly ModelIndex[]> {
  return lens(
    (s: Node<A>) => s._children,
    (s, x: readonly ModelIndex[]) => ({ ...s, _children: x }),
  );
}

function value<A = any, B = A>(): Lens<Node<A>, A, Node<B>, B> {
  return lens(
    (s: Node<A>) => s._value,
    (s: Node<A>, x: B): Node<B> => ({ ...s, _value: x }),
  );
}

/**
 * A tree represented as a graph. Two models are considered equal if they contain the same
 * underlying forest, even if the indices to the two forests are different.
 */
export class Model<A> {
  constructor(
    /** Source of new indices. */
    readonly _modelTop: ModelIndex,
    readonly _modelRoots: readonly ModelIndex[],
    readonly _modelStore: M.Map<ModelIndex, Node<A>>,
  ) {}

  /** `instance (Eq a) => Eq (Model a)` */
  [EqSym](other: unknown): boolean {
    return other instanceof Model && eq_Model(this, other as Model<A>);
  }
}
/** The `Model` constructor (not exported by the Haskell module). */
function mkModel<A>(top: ModelIndex, roots: readonly ModelIndex[], store: M.Map<ModelIndex, Node<A>>): Model<A> {
  return new Model(top, roots, store);
}

/** `m1 == m2 = evalEdit getForest m1 == evalEdit getForest m2` */
export function eq_Model<A>(m1: Model<A>, m2: Model<A>): boolean {
  return equals(evalEdit(getForest, m1), evalEdit(getForest, m2));
}

/** `deriving Functor` for Model. */
export function fmap_Model<A, B>(f: (a: A) => B, m: Model<A>): Model<B> {
  return over(modelStore<A, B>(), (s) => M.map((n: Node<A>) => fmap_Node(f, n), s), m);
}

/** `instance Ixed (Model a)`: the value at an index, if it exists. */
export function ix_Model<A = any>(k: ModelIndex): Traversal<Model<A>, A> {
  const l = modelStore<A>().dot(ix<ModelIndex, Node<A>>(k)).dot(value<A>());
  return traversal(
    (m: Model<A>, f: (a: A) => A) => {
      const v = preview(l, m);
      return v.tag === "Just" ? over(l, () => f(v.value), m) : m;
    },
    (m: Model<A>) => {
      const v = preview(l, m);
      return v.tag === "Just" ? [v.value] : [];
    },
  );
}

function modelTop<A = any>(): Lens<Model<A>, ModelIndex> {
  return lens(
    (s: Model<A>) => s._modelTop,
    (s, x: ModelIndex) => mkModel(x, s._modelRoots, s._modelStore),
  );
}

function modelRoots<A = any>(): Lens<Model<A>, readonly ModelIndex[]> {
  return lens(
    (s: Model<A>) => s._modelRoots,
    (s, x: readonly ModelIndex[]) => mkModel(s._modelTop, x, s._modelStore),
  );
}

function modelStore<A = any, B = A>(): Lens<Model<A>, M.Map<ModelIndex, Node<A>>, Model<B>, M.Map<ModelIndex, Node<B>>> {
  return lens(
    (s: Model<A>) => s._modelStore,
    (s: Model<A>, x: M.Map<ModelIndex, Node<B>>): Model<B> => mkModel(s._modelTop, s._modelRoots, x),
  );
}

/** Equivalence of models and forests. */
export function modelIso<A = any, B = A>(): Iso<T.Forest<A>, Model<A>, T.Forest<B>, Model<B>> {
  return iso(
    (f: T.Forest<A>) => makeModel(f),
    (m: Model<B>) => evalEdit(getForest, m),
  );
}

/** A model containing no nodes. */
export function emptyModel<A = any>(): Model<A> {
  return mkModel<A>(0, [], M.empty());
}

/** `newtype Edit a b = Edit {getEdit :: State (Model a) b}`: a function on a state cell. */
export type Edit<A, B> = (st: StateCell<Model<A>>) => B;

/** `getEdit` (the newtype field): the state function itself. */
export function getEdit<A, B>(e: Edit<A, B>): Edit<A, B> {
  return e;
}

export function runEdit<A, B>(act: Edit<A, B>, m: Model<A>): [B, Model<A>] {
  const st: StateCell<Model<A>> = { state: m };
  const b = act(st);
  return [b, st.state];
}

export function evalEdit<A, B>(act: Edit<A, B>, m: Model<A>): B {
  return runEdit(act, m)[0];
}

export function execEdit<A, B>(act: Edit<A, B>, m: Model<A>): Model<A> {
  return runEdit(act, m)[1];
}

/** Get a new locally unique index for an item. */
function newIndex<A>(st: StateCell<Model<A>>): ModelIndex {
  modifying(st, modelTop<A>(), (n) => n + 1);
  return st.state._modelTop;
}

/** Convert a traditional Forest into a Model. */
export function makeModel<A>(f: T.Forest<A>): Model<A> {
  const goTree = (st: StateCell<Model<A>>, p: ModelIndex, t: T.Tree<A>): ModelIndex => {
    const idx = newIndex(st);
    const cs1 = t.subForest.map((c) => goTree(st, idx, c));
    modifying(st, modelStore<A>(), (s) => M.insert(idx, Node(p, cs1, t.rootLabel), s));
    return idx;
  };
  return execEdit((st) => {
    const roots = f.map((t) => goTree(st, rootIndex, t));
    assign(st, modelRoots<A>(), roots);
  }, emptyModel<A>());
}

/** Map contents with the node indices included. */
export function mapWithIndex<A, B>(f: (i: ModelIndex, a: A) => B, m: Model<A>): Model<B> {
  return over(modelStore<A, B>(), (s) => M.mapWithKey((i: ModelIndex, n: Node<A>) => over(value<A, B>(), (v) => f(i, v), n), s), m);
}

/** Return true iff the index is valid in the model. */
export function checkIndex<A>(st: StateCell<Model<A>>, i: ModelIndex): boolean {
  return M.member(i, use(st, modelStore<A>()));
}

/**
 * Test if the first argument is a descendant (i.e. direct or indirect child) of the second.
 *
 * @False@ if either argument is not a valid index.
 *
 * If and only if @x@ is a valid index then @isDescendantOf x x@ returns @True@.
 */
export function isDescendantOf<A>(st: StateCell<Model<A>>, x1: ModelIndex, x2: ModelIndex): boolean {
  const cs: Maybe<ModelIndex[]> =
    x2 === rootIndex
      ? Just(M.keys(use(st, modelStore<A>())))
      : ((): Maybe<ModelIndex[]> => {
          const t = getTreeIndices1(st, x2);
          return t.tag === "Just" ? Just(T.flatten(t.value)) : Nothing;
        })();
  return fromMaybe<ModelIndex[]>([], cs).includes(x1);
}

/**
 * Test if the second argument is a strict descendant of the first.
 *
 * @isStrictDescendantOf x x@ returns @False@.
 */
export function isStrictDescendantOf<A>(st: StateCell<Model<A>>, x1: ModelIndex, x2: ModelIndex): boolean {
  return x1 === x2 ? false : isDescendantOf(st, x1, x2);
}

/**
 * Extract a value from the tree. This is a partial function: if the @ModelIndex@ is not found
 * then an error will be thrown.
 */
export function getItem<A>(st: StateCell<Model<A>>, i: ModelIndex): A {
  const n = use(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(i)));
  if (n.tag === "Just") return view(value<A>(), n.value);
  return error("ForestModel.getItem: index " + String(i) + " not found.");
}

/** Safe version of 'getItem' */
export function getItem1<A>(st: StateCell<Model<A>>, i: ModelIndex): Maybe<A> {
  const n = use(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(i)));
  return n.tag === "Just" ? Just(view(value<A>(), n.value)) : Nothing;
}

/**
 * Extract a tree from the Model. This is a partial function: if the @ModelIndex@ is not found
 * then an error will be thrown.
 */
export function getTree<A>(st: StateCell<Model<A>>, i: ModelIndex): T.Tree<A> {
  const n = getTree1(st, i);
  if (n.tag === "Just") return n.value;
  return error("ForestModel.getTree: index " + String(i) + " not found.");
}

/** Safe version of 'getTree'. */
export function getTree1<A>(st: StateCell<Model<A>>, i: ModelIndex): Maybe<T.Tree<A>> {
  const n = use(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(i)));
  if (n.tag === "Just") {
    const cs = catMaybes(view(children<A>(), n.value).map((c) => getTree1(st, c)));
    return Just(T.Node(view(value<A>(), n.value), cs));
  }
  return Nothing;
}

/** Extract the entire forest from the Model. */
export function getForest<A>(st: StateCell<Model<A>>): T.Tree<A>[] {
  const rs = use(st, modelRoots<A>());
  return rs.map((r) => getTree(st, r));
}

/**
 * Extract a tree of indices from the model. This is a partial function: if the @ModelIndex@ is
 * not found then an error will be thrown. Also fails for @rootIndex@.
 */
export function getTreeIndices<A>(st: StateCell<Model<A>>, i: ModelIndex): T.Tree<ModelIndex> {
  const n = getTreeIndices1(st, i);
  if (n.tag === "Just") return n.value;
  return error("ForestModel.getTreeIndices: index " + String(i) + " not found.");
}

/** Safe version of 'getTreeIndices' */
export function getTreeIndices1<A>(st: StateCell<Model<A>>, i: ModelIndex): Maybe<T.Tree<ModelIndex>> {
  const n = use(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(i)));
  if (n.tag === "Just") {
    const cs = catMaybes(view(children<A>(), n.value).map((c) => getTreeIndices1(st, c)));
    return Just(T.Node(i, cs));
  }
  return Nothing;
}

/** Extract the forest of indexes from the model. */
export function getForestIndices<A>(st: StateCell<Model<A>>): T.Tree<ModelIndex>[] {
  const go = (i: ModelIndex): T.Tree<ModelIndex> => {
    const n = use(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(i)));
    if (n.tag === "Just") {
      const cs = view(children<A>(), n.value).map(go);
      return T.Node(i, cs);
    }
    return error("ForestModel.getForestIndicies: index " + String(i) + " not found.");
  };
  const rs = use(st, modelRoots<A>());
  return rs.map(go);
}

/**
 * Relative positions for the targets of tree insertion and move operations.
 *
 * @InsertChild@ and @AppendChild@ can be targetted at the 'rootIndex'. The others will fail.
 *
 * * `InsertChild`: Create a new node as the first child of the index.
 * * `AppendChild`: Create a new node as the last child of the index.
 * * `InsertBefore`: Create a new node as a sibling of the given index immediately before it.
 * * `InsertAfter`: Create a new node as a sibling of the given index immediately after it.
 */
export type Insertion = "InsertChild" | "AppendChild" | "InsertBefore" | "InsertAfter";
/** `[minBound .. maxBound] :: [Insertion]` */
export const insertionValues: readonly Insertion[] = ["InsertChild", "AppendChild", "InsertBefore", "InsertAfter"];

/** Insert the new index before the first occurrence of `idx` (`break (== idx)`). */
function spliceBefore(idx: ModelIndex, newIdx: ModelIndex, xs: readonly ModelIndex[]): ModelIndex[] {
  const [xs1, xs2] = L.break_((x: ModelIndex) => x === idx, xs);
  return [...xs1, newIdx, ...xs2];
}

/** Insert the new index after the first occurrence of `idx`, or at the end. */
function spliceAfter(idx: ModelIndex, newIdx: ModelIndex, xs: readonly ModelIndex[]): ModelIndex[] {
  const [xs1, xs2] = L.break_((x: ModelIndex) => x === idx, xs);
  if (xs2.length > 0) return [...xs1, xs2[0], newIdx, ...xs2.slice(1)];
  return [...xs1, newIdx];
}

/**
 * Internal function for modifying a model by inserting a node. The 'Edit' action needs
 * access to the internals of the model; hence this is not exported. If the insertion succeeds
 * then the it returns the index of the adopted node. The 'Edit' action will only be run if
 * the adoption is successful.
 */
function privateAdopt<A>(
  st: StateCell<Model<A>>,
  ins: Insertion,
  idx: ModelIndex,
  /**
   * This must place the new node in the model and return its index, but the node must not
   * be spliced into the tree structure (i.e. it must not appear in a 'children' list).
   * Its 'parent' value will be overwritten.
   */
  src: Edit<A, ModelIndex>,
): Maybe<ModelIndex> {
  const store = modelStore<A>();
  const nodeAt = (i: ModelIndex) => store.dot(ix<ModelIndex, Node<A>>(i));
  const src2 = (p: ModelIndex): ModelIndex => {
    const newIdx = src(st);
    assign(st, nodeAt(newIdx).dot(parent<A>()), p); // Set parent of the new node.
    return newIdx;
  };
  if (idx === rootIndex) {
    const newIdx = src2(idx);
    switch (ins) {
      case "InsertChild":
        modifying(st, modelRoots<A>(), (rs) => [newIdx, ...rs]);
        break;
      case "InsertBefore":
        modifying(st, modelRoots<A>(), (rs) => [newIdx, ...rs]);
        break;
      case "AppendChild":
        modifying(st, modelRoots<A>(), (rs) => [...rs, newIdx]);
        break;
      case "InsertAfter":
        modifying(st, modelRoots<A>(), (rs) => [...rs, newIdx]);
        break;
    }
    return Just(newIdx);
  }
  const s = use(st, store);
  const target = M.lookup(idx, s);
  if (target.tag === "Nothing") return Nothing;
  const node = target.value;
  switch (ins) {
    case "InsertChild": {
      const newIdx = src2(idx);
      modifying(st, nodeAt(idx).dot(children<A>()), (cs) => [newIdx, ...cs]);
      return Just(newIdx);
    }
    case "AppendChild": {
      const newIdx = src2(idx);
      modifying(st, nodeAt(idx).dot(children<A>()), (cs) => [...cs, newIdx]);
      return Just(newIdx);
    }
    case "InsertBefore":
      if (M.member(view(parent<A>(), node), s)) {
        const newIdx = src2(view(parent<A>(), node));
        modifying(st, nodeAt(view(parent<A>(), node)).dot(children<A>()), (xs) => spliceBefore(idx, newIdx, xs));
        return Just(newIdx);
      } else if (view(parent<A>(), node) === rootIndex) {
        const newIdx = src2(view(parent<A>(), node));
        modifying(st, modelRoots<A>(), (xs) => spliceBefore(idx, newIdx, xs));
        return Just(newIdx);
      } else return Nothing;
    case "InsertAfter":
      if (M.member(view(parent<A>(), node), s)) {
        const newIdx = src2(view(parent<A>(), node));
        modifying(st, nodeAt(view(parent<A>(), node)).dot(children<A>()), (xs) => spliceAfter(idx, newIdx, xs));
        return Just(newIdx);
      } else if (view(parent<A>(), node) === rootIndex) {
        const newIdx = src2(view(parent<A>(), node));
        modifying(st, modelRoots<A>(), (xs) => spliceAfter(idx, newIdx, xs));
        return Just(newIdx);
      } else return Nothing;
  }
}

/**
 * Internal function for modifying a model by unlinking a node from the
 * tree while leaving it in the model store.
 *
 * If it succeeds then it returns @True@, otherwise @False@.
 */
function privateOrphan<A>(st: StateCell<Model<A>>, idx: ModelIndex): boolean {
  const s = use(st, modelStore<A>());
  const n = use(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(idx)));
  if (n.tag === "Nothing") return false;
  const node = n.value;
  if (view(parent<A>(), node) === rootIndex) {
    modifying(st, modelRoots<A>(), (rs) => L.delete_(idx, rs));
    return true;
  } else if (M.member(view(parent<A>(), node), s)) {
    modifying(
      st,
      modelStore<A>().dot(ix<ModelIndex, Node<A>>(view(parent<A>(), node))).dot(children<A>()),
      (cs) => L.delete_(idx, cs),
    );
    return true;
  } else return false;
}

/**
 * Insert a new value into the tree. Returns the index of the new element if it is successful.
 *
 * As a special case, where the @ModelIndex@ equals @rootIndex@ the @InsertBefore@ and
 * @InsertAfter@ are equivalent to @InsertChild@ and @AppendChild@ respectively.
 */
export function insert<A>(st: StateCell<Model<A>>, ins: Insertion, idx: ModelIndex, v: A): Maybe<ModelIndex> {
  return privateAdopt(st, ins, idx, (st1) => {
    const i = newIndex(st1);
    assign(st1, modelStore<A>().dot(at<ModelIndex, Node<A>>(i)), Just(Node(0, [], v)));
    return i;
  });
}

/** Delete a node from the tree, including all its children. */
export function delete_<A>(st: StateCell<Model<A>>, idx: ModelIndex): boolean {
  const delTree = (t: T.Tree<ModelIndex>): void => {
    assign(st, modelStore<A>().dot(at<ModelIndex, Node<A>>(t.rootLabel)), Nothing);
    t.subForest.forEach(delTree);
  };
  const ok = privateOrphan(st, idx);
  if (ok) {
    const ns = getTreeIndices(st, idx); // Safe because privateOrphan already checked it exists.
    delTree(ns);
  }
  return ok;
}
export { delete_ as delete };

/**
 * Move a node from one place in the tree to another. Returns @True@ if the move was successful.
 *
 * A node may not be moved to become a child of itself. The @Insertion@ follows the same logic
 * as 'insert'.
 */
export function move<A>(
  st: StateCell<Model<A>>,
  /** The node to be moved. */
  i: ModelIndex,
  ins: Insertion,
  /** The new location. */
  target: ModelIndex,
): boolean {
  if (isDescendantOf(st, target, i)) return false;
  const oldState = st.state;
  const step1 = privateOrphan(st, i);
  if (step1) {
    const step2 = privateAdopt(st, ins, target, () => i);
    if (step1 && isJust(step2)) {
      return true;
    } else {
      st.state = oldState;
      return false;
    }
  } else {
    st.state = oldState;
    return false;
  }
}

/**
 * Update the model from a forest of the existing indices. Any branch with indices that are not
 * found in the model will be silently pruned. Any indices not used in the new tree will be
 * deleted.
 */
export function stableUpdate<A>(frst: T.Forest<ModelIndex>, old: Model<A>): Model<A> {
  const walkTree = (p: ModelIndex, t: T.Tree<ModelIndex>): Maybe<[ModelIndex, M.Map<ModelIndex, Node<A>>]> => {
    const node = view(modelStore<A>().dot(at<ModelIndex, Node<A>>(t.rootLabel)), old);
    if (node.tag === "Nothing") return Nothing;
    const [cs1, tbl] = walkForest(t.rootLabel, t.subForest);
    return Just([t.rootLabel, M.insert(t.rootLabel, Node(p, cs1, view(value<A>(), node.value)), tbl)]);
  };
  const walkForest = (p: ModelIndex, idxs: T.Forest<ModelIndex>): [ModelIndex[], M.Map<ModelIndex, Node<A>>] => {
    const [idxs1, tbls] = L.unzip(mapMaybe((t: T.Tree<ModelIndex>) => walkTree(p, t), idxs));
    return [idxs1, M.unions(tbls)];
  };
  const [newRoots, newStore] = walkForest(rootIndex, frst);
  return mkModel(view(modelTop<A>(), old), newRoots, newStore);
}
