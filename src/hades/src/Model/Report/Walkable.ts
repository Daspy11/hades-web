// Ported from hades/src/Model/Report/Walkable.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Walk a document tree.
 *
 * Porting notes.
 *
 * `Walkable a b` is a multi-parameter class whose instances are chosen by type, including
 * overlapping instances. In TypeScript each instance is an explicit dictionary named
 * `Walkable_<A>_<B>`, where `[Inline]` is written `InlineList`, e.g. `Walkable_Inline_Block`,
 * `Walkable_InlineList_InlineList`. The overlappable instance
 * `(Traversable t, Walkable a b) => Walkable a (t b)` becomes `Walkable_Traversable`, with the
 * specialisations `Walkable_List`, `Walkable_Tree`, `Walkable_Pair` (for `(,) x`, which
 * traverses only the second component) and `Walkable_Maybe`. So Haskell's
 * `walk fixInlines blocks` with `fixInlines :: [Inline] -> [Inline]` and `blocks :: [Block]`
 * is `walk(Walkable_List(Walkable_InlineList_Block), fixInlines, blocks)`, or using the
 * prebuilt list instance `walk(Walkable_InlineList_BlockList, fixInlines, blocks)`.
 *
 * Note that `Walkable a [Inline]` resolves to the overlapping `Walkable [Inline] [Inline]`
 * instance when `a` is `[Inline]` (the function is also applied to each whole list of inlines),
 * but to the list instance `Walkable_List(Walkable_A_Inline)` for any other `a`.
 *
 * `walkM` is written in direct style: the monadic function `a -> m a` becomes a function that
 * performs its effects when it is called (for instance on a `StateCell`, as `unifyIdents`
 * does). The traversal calls it in exactly the order in which the Haskell code sequences the
 * effects (left to right, children before parents). `walk` is then the same traversal with a
 * pure function, as in the class default `walk f = runIdentity . walkM (return . f)`.
 *
 * `query` takes the `Monoid` dictionary of its result type first.
 */
import * as M from "@/lib/Data/Map";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node, type Tree } from "@/lib/Data/Tree";
import { gets, modifyState, type StateCell } from "@/lib/Control/Lens";
import { absurd } from "@/lib/Prelude";
import {
  Attr,
  DefinitionList,
  Div,
  Emph,
  Heading,
  Highlight,
  Link,
  LinkOut,
  Matrix,
  MatrixHeader,
  Null,
  OrderedList,
  Para,
  Picture,
  Plain,
  Span,
  Strong,
  UnorderedList,
  noAttr,
  type Block,
  type Ident,
  type Inline,
  type MatrixCell,
} from "./Document";

// ---------------------------------------------------------------------------------------------
// Supporting dictionaries.

/** Haskell `Monoid c`, the dictionary for `query`. */
export interface Monoid<C> {
  readonly mempty: C;
  append(x: C, y: C): C;
}

/** `instance Monoid [a]`. */
export function Monoid_List<A>(): Monoid<readonly A[]> {
  return { mempty: [], append: (x, y) => (x.length === 0 ? y : y.length === 0 ? x : [...x, ...y]) };
}

/** `mconcat (map f xs)`, i.e. `foldMap f xs` for a list (a right fold, as in Haskell). */
function foldMap<B, C>(m: Monoid<C>, f: (b: B) => C, xs: readonly B[]): C {
  const cs = xs.map(f);
  let acc = m.mempty;
  for (let i = cs.length - 1; i >= 0; i--) acc = m.append(cs[i], acc);
  return acc;
}

/**
 * A `Traversable` (and `Foldable`) container `TB` of `B` values, in direct style: `traverse`
 * applies the function to each element in order and rebuilds the container.
 */
export interface Traversable<B, TB> {
  traverse(f: (b: B) => B, tb: TB): TB;
  toList(tb: TB): readonly B[];
}

/** `instance Traversable []` */
export function Traversable_List<B>(): Traversable<B, readonly B[]> {
  return { traverse: (f, xs) => xs.map((x) => f(x)), toList: (xs) => xs };
}

/** `instance Traversable Tree`: pre-order. */
export function Traversable_Tree<B>(): Traversable<B, Tree<B>> {
  const traverse = (f: (b: B) => B, t: Tree<B>): Tree<B> => {
    const x = f(t.rootLabel);
    return Node(x, t.subForest.map((c) => traverse(f, c)));
  };
  const toList = (t: Tree<B>): B[] => [t.rootLabel, ...t.subForest.flatMap(toList)];
  return { traverse, toList };
}

/** `instance Traversable ((,) x)`: only the second component is traversed. */
export function Traversable_Pair<X, B>(): Traversable<B, readonly [X, B]> {
  return { traverse: (f, p) => [p[0], f(p[1])] as const, toList: (p) => [p[1]] };
}

/** `instance Traversable Maybe` */
export function Traversable_Maybe<B>(): Traversable<B, Maybe<B>> {
  return {
    traverse: (f, m) => (m.tag === "Just" ? Just(f(m.value)) : Nothing),
    toList: (m) => (m.tag === "Just" ? [m.value] : []),
  };
}

// ---------------------------------------------------------------------------------------------
// The class.

/** Walk structures of type @b@ applying a function to every @a@ found within them. */
export interface Walkable<A, B> {
  /** `walk :: (a -> a) -> b -> b` */
  walk(f: (a: A) => A, b: B): B;
  /** `walkM :: (Monad m) => (a -> m a) -> b -> m b`, in direct style (see the module notes). */
  walkM(f: (a: A) => A, b: B): B;
  /** `query :: (Monoid c) => (a -> c) -> b -> c` */
  query<C>(m: Monoid<C>, f: (a: A) => C, b: B): C;
}

/** The class method `walk`. */
export function walk<A, B>(w: Walkable<A, B>, f: (a: A) => A, b: B): B {
  return w.walk(f, b);
}

/** The class method `walkM`. */
export function walkM<A, B>(w: Walkable<A, B>, f: (a: A) => A, b: B): B {
  return w.walkM(f, b);
}

/** The class method `query`. */
export function query<A, B, C>(w: Walkable<A, B>, m: Monoid<C>, f: (a: A) => C, b: B): C {
  return w.query(m, f, b);
}

/** An instance given `walkM` and `query`, with the class default for `walk`. */
function instance<A, B>(
  walkM_: (f: (a: A) => A, b: B) => B,
  query_: <C>(m: Monoid<C>, f: (a: A) => C, b: B) => C,
): Walkable<A, B> {
  return {
    walk: (f, b) => walkM_(f, b), // walk f = runIdentity . walkM (return . f)
    walkM: walkM_,
    query: query_,
  };
}

/** Instances that find nothing: `walkM _ = return` and `query _ = mempty`. */
function noneInstance<A, B>(): Walkable<A, B> {
  return instance<A, B>((_f, b) => b, (m, _f, _b) => m.mempty);
}

/** Instances for the walked type itself: `walkM f = f` and `query f = f`. */
function selfInstance<A>(): Walkable<A, A> {
  return instance<A, A>((f, a) => f(a), (_m, f, a) => f(a));
}

/** `instance {-# OVERLAPPABLE #-} (Foldable t, Traversable t, Walkable a b) => Walkable a (t b)` */
export function Walkable_Traversable<A, B, TB>(t: Traversable<B, TB>, w: Walkable<A, B>): Walkable<A, TB> {
  return {
    walk: (f, tb) => t.traverse((b) => w.walk(f, b), tb), // DT.fmapDefault (walk f)
    walkM: (f, tb) => t.traverse((b) => w.walkM(f, b), tb), // DT.mapM (walkM f)
    query: (m, f, tb) => foldMap(m, (b: B) => w.query(m, f, b), t.toList(tb)), // DF.foldMap (query f)
  };
}

/** `Walkable a [b]` from `Walkable a b`. */
export function Walkable_List<A, B>(w: Walkable<A, B>): Walkable<A, readonly B[]> {
  return Walkable_Traversable(Traversable_List<B>(), w);
}

/** `Walkable a (Tree b)` from `Walkable a b`. */
export function Walkable_Tree<A, B>(w: Walkable<A, B>): Walkable<A, Tree<B>> {
  return Walkable_Traversable(Traversable_Tree<B>(), w);
}

/** `Walkable a (x, b)` from `Walkable a b`. The first component is not walked. */
export function Walkable_Pair<X, A, B>(w: Walkable<A, B>): Walkable<A, readonly [X, B]> {
  return Walkable_Traversable(Traversable_Pair<X, B>(), w);
}

/** `Walkable a (Maybe b)` from `Walkable a b`. */
export function Walkable_Maybe<A, B>(w: Walkable<A, B>): Walkable<A, Maybe<B>> {
  return Walkable_Traversable(Traversable_Maybe<B>(), w);
}

// ---------------------------------------------------------------------------------------------
// Instances.

export const Walkable_Block_Block: Walkable<Block, Block> = instance(
  (f, blk) => f(walkBlock(blockDicts, f, blk)),
  (m, f, blk) => m.append(f(blk), queryBlock(blockDicts, m, f, blk)),
);

export const Walkable_Inline_Block: Walkable<Inline, Block> = instance(
  (f, blk) => walkBlock(inlineDicts, f, blk),
  (m, f, blk) => queryBlock(inlineDicts, m, f, blk),
);

/** `instance {-# OVERLAPPING #-} Walkable [Inline] Block` */
export const Walkable_InlineList_Block: Walkable<readonly Inline[], Block> = instance(
  (f, blk) => walkBlock(inlineListDicts, f, blk),
  (m, f, blk) => queryBlock(inlineListDicts, m, f, blk),
);

export const Walkable_Attr_Block: Walkable<Attr, Block> = instance(
  (f, blk) => walkBlock(attrDicts, f, blk),
  (m, f, blk) => queryBlock(attrDicts, m, f, blk),
);

export const Walkable_MatrixHeader_Block: Walkable<MatrixHeader, Block> = instance(
  (f, blk) => walkBlock(matrixHeaderDicts, f, blk),
  (m, f, blk) => queryBlock(matrixHeaderDicts, m, f, blk),
);

/** No blocks inside inlines. */
export const Walkable_Block_Inline: Walkable<Block, Inline> = noneInstance();

export const Walkable_Inline_Inline: Walkable<Inline, Inline> = instance(
  (f, inline) => f(walkInline(inlineDicts, f, inline)),
  (m, f, inline) => m.append(f(inline), queryInline(inlineDicts, m, f, inline)),
);

/** `instance {-# OVERLAPPING #-} Walkable [Inline] [Inline]` */
export const Walkable_InlineList_InlineList: Walkable<readonly Inline[], readonly Inline[]> = instance(
  (f, inlines) => f(inlines.map((i) => Walkable_InlineList_Inline.walkM(f, i))),
  (m, f, inlines) =>
    m.append(f(inlines), foldMap(m, (i: Inline) => queryInline(inlineListDicts, m, f, i), inlines)),
);

/** `instance {-# OVERLAPPING #-} Walkable [Inline] Inline` */
export const Walkable_InlineList_Inline: Walkable<readonly Inline[], Inline> = instance(
  (f, inline) => walkInline(inlineListDicts, f, inline),
  (m, f, inline) => queryInline(inlineListDicts, m, f, inline),
);

export const Walkable_Attr_Inline: Walkable<Attr, Inline> = instance(
  (f, inline) => walkInline(attrDicts, f, inline),
  (m, f, inline) => queryInline(attrDicts, m, f, inline),
);

export const Walkable_MatrixHeader_Inline: Walkable<MatrixHeader, Inline> = instance(
  (f, inline) => walkInline(matrixHeaderDicts, f, inline),
  (m, f, inline) => queryInline(matrixHeaderDicts, m, f, inline),
);

/** No blocks inside attributes. */
export const Walkable_Block_Attr: Walkable<Block, Attr> = noneInstance();

/** No inlines inside attributes. */
export const Walkable_Inline_Attr: Walkable<Inline, Attr> = noneInstance();

/** `instance {-# OVERLAPPING #-} Walkable [Inline] Attr` */
export const Walkable_InlineList_Attr: Walkable<readonly Inline[], Attr> = noneInstance();

export const Walkable_Attr_Attr: Walkable<Attr, Attr> = selfInstance();

/** No matrix headers inside attributes. */
export const Walkable_MatrixHeader_Attr: Walkable<MatrixHeader, Attr> = noneInstance();

/** No blocks inside matrix headers. */
export const Walkable_Block_MatrixHeader: Walkable<Block, MatrixHeader> = noneInstance();

/** `walkM`/`query` on the name and columns of a matrix header. */
function matrixHeaderInstance<A>(
  name: () => Walkable<A, readonly Inline[]>,
  cols: () => Walkable<A, readonly (readonly Inline[])[]>,
): Walkable<A, MatrixHeader> {
  return instance<A, MatrixHeader>(
    (f, h) => MatrixHeader(name().walkM(f, h.matrixHeaderName), cols().walkM(f, h.matrixHeaderColumns)),
    (m, f, h) => m.append(name().query(m, f, h.matrixHeaderName), cols().query(m, f, h.matrixHeaderColumns)),
  );
}

export const Walkable_Inline_MatrixHeader: Walkable<Inline, MatrixHeader> = matrixHeaderInstance(
  () => inlineDicts.inlines,
  () => inlineDicts.inlinesList,
);

/** `instance {-# OVERLAPPING #-} Walkable [Inline] MatrixHeader` */
export const Walkable_InlineList_MatrixHeader: Walkable<readonly Inline[], MatrixHeader> = matrixHeaderInstance(
  () => inlineListDicts.inlines,
  () => inlineListDicts.inlinesList,
);

export const Walkable_Attr_MatrixHeader: Walkable<Attr, MatrixHeader> = matrixHeaderInstance(
  () => attrDicts.inlines,
  () => attrDicts.inlinesList,
);

export const Walkable_MatrixHeader_MatrixHeader: Walkable<MatrixHeader, MatrixHeader> = selfInstance();

// ---------------------------------------------------------------------------------------------
// The dictionaries used by walkBlock, walkInline, queryBlock and queryInline for each walked
// type, as resolved by GHC at the instance declarations.

interface WalkDicts<A> {
  readonly matrixHeader: Walkable<A, MatrixHeader>;
  readonly attr: Walkable<A, Attr>;
  /** `Walkable a [Inline]` */
  readonly inlines: Walkable<A, readonly Inline[]>;
  readonly block: Walkable<A, Block>;
  /** `Walkable a [[Inline]]` */
  readonly inlinesList: Walkable<A, readonly (readonly Inline[])[]>;
  /** `Walkable a [Block]` */
  readonly blocks: Walkable<A, readonly Block[]>;
  /** `Walkable a [[Block]]` */
  readonly blocksList: Walkable<A, readonly (readonly Block[])[]>;
  /** `Walkable a [MatrixHeader]` */
  readonly headers: Walkable<A, readonly MatrixHeader[]>;
  /** `Walkable a (Forest [MatrixCell])` */
  readonly cells: Walkable<A, readonly Tree<readonly MatrixCell[]>[]>;
}

function walkDicts<A>(
  matrixHeader: Walkable<A, MatrixHeader>,
  attr: Walkable<A, Attr>,
  inlines: Walkable<A, readonly Inline[]>,
  block: Walkable<A, Block>,
): WalkDicts<A> {
  const blocks = Walkable_List(block);
  return {
    matrixHeader,
    attr,
    inlines,
    block,
    inlinesList: Walkable_List(inlines),
    blocks,
    blocksList: Walkable_List(blocks),
    headers: Walkable_List(matrixHeader),
    cells: Walkable_List(Walkable_Tree(Walkable_List(Walkable_Pair<Attr, A, readonly Block[]>(blocks)))),
  };
}

const blockDicts: WalkDicts<Block> = walkDicts(
  Walkable_Block_MatrixHeader,
  Walkable_Block_Attr,
  Walkable_List(Walkable_Block_Inline),
  Walkable_Block_Block,
);

const inlineDicts: WalkDicts<Inline> = walkDicts(
  Walkable_Inline_MatrixHeader,
  Walkable_Inline_Attr,
  Walkable_List(Walkable_Inline_Inline),
  Walkable_Inline_Block,
);

const inlineListDicts: WalkDicts<readonly Inline[]> = walkDicts(
  Walkable_InlineList_MatrixHeader,
  Walkable_InlineList_Attr,
  Walkable_InlineList_InlineList,
  Walkable_InlineList_Block,
);

const attrDicts: WalkDicts<Attr> = walkDicts(
  Walkable_Attr_MatrixHeader,
  Walkable_Attr_Attr,
  Walkable_List(Walkable_Attr_Inline),
  Walkable_Attr_Block,
);

const matrixHeaderDicts: WalkDicts<MatrixHeader> = walkDicts(
  Walkable_MatrixHeader_MatrixHeader,
  Walkable_MatrixHeader_Attr,
  Walkable_List(Walkable_MatrixHeader_Inline),
  Walkable_MatrixHeader_Block,
);

/** `Walkable Block [Block]` */
export const Walkable_Block_BlockList: Walkable<Block, readonly Block[]> = blockDicts.blocks;
/** `Walkable Inline [Block]` */
export const Walkable_Inline_BlockList: Walkable<Inline, readonly Block[]> = inlineDicts.blocks;
/** `Walkable [Inline] [Block]` */
export const Walkable_InlineList_BlockList: Walkable<readonly Inline[], readonly Block[]> = inlineListDicts.blocks;
/** `Walkable Attr [Block]` */
export const Walkable_Attr_BlockList: Walkable<Attr, readonly Block[]> = attrDicts.blocks;
/** `Walkable MatrixHeader [Block]` */
export const Walkable_MatrixHeader_BlockList: Walkable<MatrixHeader, readonly Block[]> = matrixHeaderDicts.blocks;

// ---------------------------------------------------------------------------------------------

/** Apply the function to each item in the block. */
function walkBlock<A>(w: WalkDicts<A>, f: (a: A) => A, blk: Block): Block {
  switch (blk.tag) {
    case "Plain":
      return Plain(w.inlines.walkM(f, blk._0));
    case "Para":
      return Para(w.inlines.walkM(f, blk._0));
    case "OrderedList":
      return OrderedList(blk._0, w.blocksList.walkM(f, blk._1));
    case "UnorderedList":
      return UnorderedList(w.blocksList.walkM(f, blk._0));
    case "DefinitionList":
      return DefinitionList(
        blk._0.map(([inlines, blocks]) => {
          const inlines1 = w.inlines.walkM(f, inlines);
          return [inlines1, w.blocks.walkM(f, blocks)] as const;
        }),
      );
    case "Heading": {
      const attr = w.attr.walkM(f, blk._1);
      return Heading(blk._0, attr, w.inlines.walkM(f, blk._2));
    }
    case "Matrix": {
      const attr = w.attr.walkM(f, blk._0);
      const caption = w.inlines.walkM(f, blk._1);
      const headerss = w.headers.walkM(f, blk._2);
      return Matrix(attr, caption, headerss, w.cells.walkM(f, blk._3));
    }
    case "Div": {
      const attr = w.attr.walkM(f, blk._0);
      return Div(attr, w.blocks.walkM(f, blk._1));
    }
    case "Picture": {
      const attr = w.attr.walkM(f, blk._0);
      return Picture(attr, w.inlines.walkM(f, blk._1), blk._2, blk._3, blk._4);
    }
    case "Null":
      return Null;
    default:
      return absurd(blk);
  }
}

/** Apply the function to each item in the inline. */
function walkInline<A>(w: WalkDicts<A>, f: (a: A) => A, x: Inline): Inline {
  switch (x.tag) {
    case "Str":
      return x;
    case "Emph":
      return Emph(w.inlines.walkM(f, x._0));
    case "Strong":
      return Strong(w.inlines.walkM(f, x._0));
    case "Space":
      return x;
    case "Link":
      return Link(x._0, w.inlines.walkM(f, x._1));
    case "LinkOut":
      return LinkOut(x._0, w.inlines.walkM(f, x._1));
    case "Icon":
      return x;
    case "Highlight":
      return Highlight(x._0, w.inlines.walkM(f, x._1));
    case "Span": {
      const attr = w.attr.walkM(f, x._0);
      return Span(attr, w.inlines.walkM(f, x._1));
    }
    default:
      return absurd(x);
  }
}

/** Apply the query function to each item in the block. */
function queryBlock<A, C>(w: WalkDicts<A>, m: Monoid<C>, f: (a: A) => C, blk: Block): C {
  switch (blk.tag) {
    case "Plain":
      return w.inlines.query(m, f, blk._0);
    case "Para":
      return w.inlines.query(m, f, blk._0);
    case "OrderedList":
      return w.blocksList.query(m, f, blk._1);
    case "UnorderedList":
      return w.blocksList.query(m, f, blk._0);
    case "DefinitionList":
      return foldMap(
        m,
        ([inlines, blocks]: readonly [readonly Inline[], readonly Block[]]) =>
          m.append(w.inlines.query(m, f, inlines), w.blocks.query(m, f, blocks)),
        blk._0,
      );
    case "Heading":
      return m.append(w.attr.query(m, f, blk._1), w.inlines.query(m, f, blk._2));
    case "Matrix":
      return m.append(
        w.attr.query(m, f, blk._0),
        m.append(
          w.inlines.query(m, f, blk._1),
          m.append(w.headers.query(m, f, blk._2), w.cells.query(m, f, blk._3)),
        ),
      );
    case "Div":
      return m.append(w.attr.query(m, f, blk._0), w.blocks.query(m, f, blk._1));
    case "Picture":
      return m.append(w.attr.query(m, f, blk._0), w.inlines.query(m, f, blk._1));
    case "Null":
      return m.mempty;
    default:
      return absurd(blk);
  }
}

/** Apply the query function to each item in the inline. */
function queryInline<A, C>(w: WalkDicts<A>, m: Monoid<C>, f: (a: A) => C, x: Inline): C {
  switch (x.tag) {
    case "Str":
      return m.mempty;
    case "Emph":
      return w.inlines.query(m, f, x._0);
    case "Strong":
      return w.inlines.query(m, f, x._0);
    case "Space":
      return m.mempty;
    case "Link":
      return w.inlines.query(m, f, x._1);
    case "LinkOut":
      return w.inlines.query(m, f, x._1);
    case "Icon":
      return m.mempty;
    case "Highlight":
      return w.inlines.query(m, f, x._1);
    case "Span":
      return m.append(w.attr.query(m, f, x._0), w.inlines.query(m, f, x._1));
    default:
      return absurd(x);
  }
}

// ---------------------------------------------------------------------------------------------

/**
 * Find the highest priority (i.e. lowest score) of each cross reference identifier using
 * the monoid instance.
 */
interface PriorityIdents {
  readonly _0: M.Map<Ident, number>;
}
function PriorityIdents(_0: M.Map<Ident, number>): PriorityIdents {
  return { _0 };
}

/** `instance Semigroup PriorityIdents` */
function append_PriorityIdents(p1: PriorityIdents, p2: PriorityIdents): PriorityIdents {
  return PriorityIdents(M.unionWith((x: number, y: number) => Math.min(x, y), p1._0, p2._0));
}

/** `instance Monoid PriorityIdents` */
const mempty_PriorityIdents: PriorityIdents = PriorityIdents(M.empty());

const Monoid_PriorityIdents: Monoid<PriorityIdents> = {
  mempty: mempty_PriorityIdents,
  append: append_PriorityIdents,
};

/**
 * Remove duplicate labels from the blocks and return the blocks with the list of known labels.
 * If the same identifier appears in multiple places then the one with the lowest numerical
 * priority is used. In the case of a tie the earliest one is used.
 *
 * The blocks are also scanned for internal links that do not have targets. These are removed.
 */
export function unifyIdents(blocks: readonly Block[]): [Block[], Ident[]] {
  const findLabels = (a: Attr): PriorityIdents => {
    const i = a.attrIdentifier;
    return PriorityIdents(i.tag === "Just" ? M.singleton(i.value[0], i.value[1]) : M.empty());
  };
  const labels = query(Walkable_Attr_BlockList, Monoid_PriorityIdents, findLabels, blocks)._0;
  const clearLabel = (ident: Ident, m: M.Map<Ident, number>) => M.delete(ident, m);
  const doLinks = (x: Inline): Inline => {
    if (x.tag === "Link") return M.member(x._0, labels) ? x : Span(noAttr, x._1);
    return x;
  };
  // evalState (walkM doAttrs blocks) labels
  const st: StateCell<M.Map<Ident, number>> = { state: labels };
  const doAttrs = (x: Attr): Attr => {
    const i = x.attrIdentifier;
    if (i.tag === "Nothing") return x;
    const [ident, priority1] = i.value;
    const found = gets(st, (s: M.Map<Ident, number>) => M.lookup(ident, s));
    if (found.tag === "Nothing") return Attr(Nothing, x.attrClass); // Must have already seen this one.
    if (priority1 === found.value) {
      modifyState(st, (s: M.Map<Ident, number>) => clearLabel(ident, s));
      return x;
    }
    return Attr(Nothing, x.attrClass); // Higher priority somewhere else.
  };
  const blocks1 = walkM(Walkable_Attr_BlockList, doAttrs, blocks);
  return [[...walk(Walkable_Inline_BlockList, doLinks, blocks1)], M.keys(labels)];
}
