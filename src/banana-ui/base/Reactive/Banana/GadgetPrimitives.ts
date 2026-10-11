// Ported from banana-ui/base/Reactive/Banana/GadgetPrimitives.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Primitive language for gadget-based GUIs. This exports all of the constructors for "Gadget".
 * These are normally used only by combinator libraries and interpreters.
 *
 * TypeScript port
 * ---------------
 * * The `Gadget` GADT is the tagged union `Gadget<E, W, I, O>`; the tags are the Haskell
 *   constructor names and the positional fields are `_0`, `_1`, ... Existentially quantified
 *   types, and types that the GADT refines per constructor (e.g. the `a` of `Accum`), are `any`
 *   in the union. The constructor functions (`Null()`, `Pure(f)`, `Dot(g1, g2)`, ...) carry the
 *   precise Haskell types. Nullary constructors are functions too (`Null()`, `GetEnv()`,
 *   `TickBox()`, ...) because they are polymorphic in their type parameters.
 * * Curried Haskell functions stored in constructors are uncurried: `e -> i -> o -> Bool`
 *   becomes `(e: E, i: I, o: O) => boolean`; a `DialogSelector` is `(e: E, i: I) => Maybe<Dialog>`.
 * * Haskell tuples in gadget inputs and outputs are TypeScript pairs `[A, B]`; lists are
 *   `readonly A[]`.
 * * The only fields of `Gadget` that consume the output type (`Validate`, `ValidateText` and
 *   `Trace`) are declared with method syntax, whose parameters TypeScript checks bivariantly.
 *   This makes `Gadget<E, W, I, O>` covariant in `O`, so that e.g. `focusing(_1(), g)` (whose
 *   output is a function returning a mutable tuple) is a `GadgetF_` over a readonly tuple.
 * * `ButtonIO` actions may be asynchronous: `(e: E, i: I) => O | Promise<O>`. Interpreters
 *   must `await` the result.
 * * The `Functor`, `Applicative`, `Category`, `Arrow` and `ArrowLoop` instances become the
 *   functions `arr`, `gId`, `gPipe`, `gDot`, `gProd`, `gFanout`, `gFirst`, `gSecond`, `gLoop`,
 *   `gFmap`, `gPure`, `gAp` and `gLiftA2` (see PORTING.md §9). Default class methods are
 *   expanded exactly as in `base`: `first g = g *** id`, `second g = id *** g`,
 *   `f &&& g = arr (\b -> (b,b)) >>> f *** g`, `fmap f g = g >>> Pure f`.
 */
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import type * as S from "@/lib/Data/Set";
import { Just, type Maybe, fromMaybe, mapMaybeValue } from "@/lib/Data/Maybe";
import type { Either } from "@/lib/Data/Either";
import type { Day } from "@/lib/Data/Time";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { preview, type Lens, type Prism, type Traversal } from "@/lib/Control/Lens";
import { absurd } from "@/lib/Prelude";
import type { Colour, DateFormat, IconName } from "./Common";
import type { Menu } from "./Menu";
import type * as Tbl from "./Table";

// ---------------------------------------------------------------------------------------------
// Basic types

/** Items in a combobox menu. */
export interface ComboItem<A> {
  readonly menuItemLabel: T.Text;
  readonly menuItemIcon: Maybe<T.Text>;
  readonly menuItemColour: Maybe<Colour>;
  readonly menuItemValue: A;
}
export function ComboItem<A>(
  menuItemLabel: T.Text,
  menuItemIcon: Maybe<T.Text>,
  menuItemColour: Maybe<Colour>,
  menuItemValue: A,
): ComboItem<A> {
  return { menuItemLabel, menuItemIcon, menuItemColour, menuItemValue };
}

/** `instance Functor ComboItem` */
export function fmap_ComboItem<A, R>(f: (a: A) => R, c: ComboItem<A>): ComboItem<R> {
  return ComboItem(c.menuItemLabel, c.menuItemIcon, c.menuItemColour, f(c.menuItemValue));
}

/**
 * Items in a clickable memo box. Single click values are best used for selection in pop-up
 * dialolgs, with double-click used for immediate activation elsewhere in the application. If both
 * are provided then a double click will emit both in undefined order.
 */
export interface ClickableItem<A> {
  readonly clickText: T.Text;
  readonly clickSingle: Maybe<A>;
  readonly clickDouble: Maybe<A>;
  /** Shown on right click. */
  readonly clickMenu: Maybe<Menu<A>>;
}
export function ClickableItem<A>(
  clickText: T.Text,
  clickSingle: Maybe<A>,
  clickDouble: Maybe<A>,
  clickMenu: Maybe<Menu<A>>,
): ClickableItem<A> {
  return { clickText, clickSingle, clickDouble, clickMenu };
}

/** Composite gadget orientation. */
export type Orientation = "Vertical" | "Horizontal";
export const orientationValues: readonly Orientation[] = ["Vertical", "Horizontal"];

/** Hint about how much text is expected in the memobox. */
export type MemoBoxSize =
  /** A small amounts of text, such as a sentence or two. */
  | "MemoSmall"
  /** several sentences or a couple of short paragraphs. */
  | "MemoMedium"
  /** Extended pieces of text. */
  | "MemoLarge";
export const memoBoxSizeValues: readonly MemoBoxSize[] = ["MemoSmall", "MemoMedium", "MemoLarge"];

/** Purpose for a FilePath gadget. */
export type FilePathPurpose = "FilePathOpen" | "FilePathSave" | "FilePathFolder";
export const filePathPurposeValues: readonly FilePathPurpose[] = ["FilePathOpen", "FilePathSave", "FilePathFolder"];

/** Filter rules for a FilePath gadget. */
export type FilePathFilterItem =
  /** Glob pattern (e.g. @*.txt@). */
  | { readonly tag: "FilePathGlob"; readonly _0: T.Text }
  /** Mime type. */
  | { readonly tag: "FilePathMime"; readonly _0: T.Text }
  /** Image files. */
  | { readonly tag: "FilePathImages" };

/** Glob pattern (e.g. @*.txt@). */
export function FilePathGlob(_0: T.Text): FilePathFilterItem {
  return { tag: "FilePathGlob", _0 };
}
/** Mime type. */
export function FilePathMime(_0: T.Text): FilePathFilterItem {
  return { tag: "FilePathMime", _0 };
}
/** Image files. */
export const FilePathImages: FilePathFilterItem = { tag: "FilePathImages" };

export type FilePathFilter = readonly [T.Text, readonly FilePathFilterItem[]];

/**
 * Tree operations for forest editing. Elements can be added or deleted.
 * The terms *before*, *after* and *in* refer to the item right clicked by the user.
 */
export type TreeOper<A> =
  | { readonly tag: "TreeAddBefore"; readonly _0: A }
  | { readonly tag: "TreeAddAfter"; readonly _0: A }
  | { readonly tag: "TreeAddIn"; readonly _0: A }
  | { readonly tag: "TreeDelete" };

export function TreeAddBefore<A>(_0: A): TreeOper<A> {
  return { tag: "TreeAddBefore", _0 };
}
export function TreeAddAfter<A>(_0: A): TreeOper<A> {
  return { tag: "TreeAddAfter", _0 };
}
export function TreeAddIn<A>(_0: A): TreeOper<A> {
  return { tag: "TreeAddIn", _0 };
}
export const TreeDelete: TreeOper<never> = { tag: "TreeDelete" };

// ---------------------------------------------------------------------------------------------
// Gadget types

/** Gadget where input and output are the same type. (Haskell `Gadget'`) */
export type Gadget_<E, W, A> = Gadget<E, W, A, A>;

/** Gadget where the output is a function. */
export type GadgetF<E, W, I, O> = Gadget<E, W, I, (i: I) => O>;

/** Gadget where the ouptut is an endofunction. (Haskell `GadgetF'`) */
export type GadgetF_<E, W, A> = Gadget<E, W, A, (a: A) => A>;

/** Pair of prism and gadget used for conditionals. (`forall a b . PrismaticGadget a (Prism i o a b) (Gadget e w a b)`) */
export interface PrismaticGadget<E, W, I, O> {
  readonly _0: any;
  readonly _1: Prism<I, any, O, any>;
  readonly _2: Gadget<E, W, any, any>;
}
export function PrismaticGadget<E, W, I, O, A, A2>(
  _0: A,
  _1: Prism<I, A, O, A2>,
  _2: Gadget<E, W, A, A2>,
): PrismaticGadget<E, W, I, O> {
  return { _0, _1, _2 };
}

/**
 * Lens wrapped in a newtype to avoid impredicative polymorphism.
 *
 * The newtype is erased: `Lens1(l)` and `getLens(l)` are identity functions.
 */
export type Lens1<S, A> = Lens<S, A>;
/** The `Lens1` newtype constructor (identity). */
export function Lens1<S, A>(l: Lens<S, A>): Lens1<S, A> {
  return l;
}
/** The `getLens` newtype field (identity). */
export function getLens<S, A>(l: Lens1<S, A>): Lens<S, A> {
  return l;
}

/**
 * The type parameters of a Gadget are:
 *
 * [@e@] The read-only environment for the gadget.
 *
 * [@w@] The write-only side channel for data events.
 *
 * [@i@] The input type.
 *
 * [@o@] The output type.
 *
 * See the constructor functions below for the documentation and precise type of each variant.
 */
export type Gadget<E, W, I, O> =
  | { readonly tag: "Null" }
  | { readonly tag: "Pure"; readonly _0: (i: I) => O }
  | { readonly tag: "Dot"; readonly _0: Gadget<E, W, any, O>; readonly _1: Gadget<E, W, I, any> }
  | { readonly tag: "Prod"; readonly _0: Gadget<E, W, any, any>; readonly _1: Gadget<E, W, any, any> }
  | { readonly tag: "Loop"; readonly _0: Gadget<E, W, [I, any], [O, any]> }
  | { readonly tag: "Accum"; readonly _0: GadgetF_<E, W, I> }
  | { readonly tag: "GetInitial"; readonly _0: (i: I) => Gadget<E, W, I, O> }
  | { readonly tag: "GetInitialEnv"; readonly _0: (e: E) => Gadget<E, W, I, O> }
  | { readonly tag: "Initially"; readonly _0: I }
  | { readonly tag: "GetEnv" }
  | { readonly tag: "WithEnv"; readonly _0: Gadget<E, W, I, any>; readonly _1: Gadget<any, W, I, O> }
  | { readonly tag: "Send"; readonly _0: (a: I) => Maybe<W> }
  | { readonly tag: "SendMap"; readonly _0: (w1: any) => Maybe<W>; readonly _1: Gadget<E, any, I, O> }
  | { readonly tag: "Focusing"; readonly _0: Lens<I, any, any, any>; readonly _1: Gadget<E, W, any, any> }
  | { readonly tag: "Prismatic"; readonly _0: any; readonly _1: Prism<I, any, O, any>; readonly _2: Gadget<E, W, any, any> }
  | { readonly tag: "PrismaticOver"; readonly _0: any; readonly _1: Prism<I, any>; readonly _2: GadgetF_<E, W, any> }
  | { readonly tag: "Traversing"; readonly _0: any; readonly _1: Traversal<I, any, any, any>; readonly _2: Gadget<E, W, any, any> }
  | { readonly tag: "TraversingOver"; readonly _0: any; readonly _1: Traversal<I, any, any, any>; readonly _2: GadgetF<E, W, any, any> }
  | { readonly tag: "Exec"; readonly _0: (a: any) => Gadget<E, W, any, O> }
  | { readonly tag: "Cond"; readonly _0: readonly PrismaticGadget<E, W, I, O>[] }
  | { readonly tag: "UnionTab"; readonly _0: readonly (readonly [T.Text, PrismaticGadget<E, W, I, O>])[] }
  | { readonly tag: "Enabled"; readonly _0: Gadget<E, W, any, O> }
  | { readonly tag: "Optional"; readonly _0: any; readonly _1: Gadget<E, W, any, any> }
  | { readonly tag: "Intercept"; readonly _0: boolean; readonly _1: DialogSelector_<E, W, I>; readonly _2: Gadget_<E, W, I> }
  | { readonly tag: "Icon"; readonly _0: (i: I) => T.Text; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "Coloured"; readonly _0: (i: I) => Maybe<Colour>; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "Linked"; readonly _0: (i: I) => Maybe<T.Text>; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "Styled"; readonly _0: (i: I) => Maybe<T.Text>; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "Frame"; readonly _0: (i: I) => Maybe<T.Text>; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "Form"; readonly _0: Orientation; readonly _1: readonly (readonly [T.Text, GadgetF_<E, W, I>])[] }
  | { readonly tag: "TabForm"; readonly _0: readonly (readonly [T.Text, GadgetF_<E, W, I>])[] }
  | { readonly tag: "Box"; readonly _0: Orientation; readonly _1: readonly (readonly GadgetF_<E, W, I>[])[] }
  | { readonly tag: "Grid"; readonly _0: readonly T.Text[]; readonly _1: readonly T.Text[]; readonly _2: readonly (readonly GadgetF_<E, W, I>[])[] }
  | { readonly tag: "Validate"; _0(e: E, i: I, o: O): boolean; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "ValidateText"; _0(e: E, i: I, o: O): Maybe<T.Text>; readonly _1: Gadget<E, W, I, O> }
  | { readonly tag: "TextBox"; readonly _0: (e: E) => Prism<T.Text, I> }
  | { readonly tag: "DisplayText" }
  | { readonly tag: "MemoBox"; readonly _0: MemoBoxSize; readonly _1: boolean }
  | { readonly tag: "DisplayMemo" }
  | { readonly tag: "Combo"; readonly _0: (e: E) => readonly ComboItem<I>[] }
  | { readonly tag: "Radio"; readonly _0: (e: E) => readonly (readonly [T.Text, I])[] }
  | { readonly tag: "TickBox" }
  | { readonly tag: "Message"; readonly _0: (e: E, a: I) => T.Text }
  | { readonly tag: "FixedText"; readonly _0: (e: E, a: I) => T.Text; readonly _1: Maybe<DialogSelector<E, W, I, I>> }
  | {
      readonly tag: "FixedMemo";
      readonly _0: MemoBoxSize;
      readonly _1: boolean;
      readonly _2: (e: E, a: I) => T.Text;
      readonly _3: Maybe<DialogSelector<E, W, I, I>>;
    }
  | { readonly tag: "ClickableList" }
  | { readonly tag: "DateBox"; readonly _0: DateFormat }
  | { readonly tag: "IconBox"; readonly _0: (t: T.Text) => boolean }
  | { readonly tag: "ColourBox" }
  | { readonly tag: "ImageDisplay"; readonly _0: MemoBoxSize }
  | { readonly tag: "TreeSelector"; readonly _0: (e: E) => Forest<readonly [T.Text, Maybe<T.Text>, Maybe<any>]> }
  | {
      readonly tag: "Table";
      readonly _0: readonly Tbl.TableEditing<any>[];
      readonly _1: Tbl.Table<any>;
      readonly _2: Maybe<DialogSelector<E, W, any, any>>;
    }
  | {
      readonly tag: "ForestTable";
      readonly _0: readonly (readonly [T.Text, readonly (readonly [T.Text, GadgetF_<E, any, any>])[]])[];
      readonly _1: (e: E) => Forest<readonly [any, Lens1<I, any>]>;
    }
  | {
      readonly tag: "ForestEditor";
      readonly _0: (e: E, a: any) => T.Text;
      readonly _1: (m: Maybe<any>) => Menu<TreeOper<any>>;
      readonly _2: (a: any) => boolean;
      readonly _3: Maybe<DialogSelector<E, W, any, any>>;
    }
  | {
      readonly tag: "FilePathSelector";
      readonly _0: T.Text;
      readonly _1: FilePathPurpose;
      readonly _2: readonly FilePathFilter[];
      readonly _3: boolean;
    }
  | { readonly tag: "Scrolled"; readonly _0: Gadget<E, W, I, O> }
  | { readonly tag: "ButtonBar"; readonly _0: readonly (readonly [T.Text, (a: I) => I])[] }
  | { readonly tag: "ButtonIO"; readonly _0: T.Text; readonly _1: (e: E, i: I) => any }
  | { readonly tag: "Image"; readonly _0: string }
  | {
      readonly tag: "Trace";
      readonly _0: string;
      readonly _1: (i: I) => string;
      _2(i: I, o: O): string;
      readonly _3: Gadget<E, W, I, O>;
    };

/** The tag (constructor name) of a gadget. */
export type GadgetTag = Gadget<any, any, any, any>["tag"];

// ---------------------------------------------------------------------------------------------
// Gadget constructors

/** `Null :: Gadget' e w a`. The identity gadget (Category `id`). */
export function Null<E = any, W = any, A = any>(): Gadget_<E, W, A> {
  return { tag: "Null" };
}

/** A pure function from input to output. The implementation of "arr" in the "Arrow" instance. */
export function Pure<E = any, W = any, I = any, O = any>(_0: (i: I) => O): Gadget<E, W, I, O> {
  return { tag: "Pure", _0 };
}

/** Gadget composition. The implementation of "(.)" in the "Arrow" instance */
export function Dot<E, W, A, A2, C>(_0: Gadget<E, W, A2, C>, _1: Gadget<E, W, A, A2>): Gadget<E, W, A, C> {
  return { tag: "Dot", _0, _1 };
}

/**
 * Gadget output as a tuple. The output changes whenever either gadget changes output.
 * The implementation of "(****)" in the "Arrow" instance.
 */
export function Prod<E, W, I1, O1, I2, O2>(_0: Gadget<E, W, I1, O1>, _1: Gadget<E, W, I2, O2>): Gadget<E, W, [I1, I2], [O1, O2]> {
  return { tag: "Prod", _0, _1 };
}

/** Gadgets with feedback. */
export function Loop<E, W, I, O, St>(_0: Gadget<E, W, [I, St], [O, St]>): Gadget<E, W, I, O> {
  return { tag: "Loop", _0 };
}

/** Accumulate edits. */
export function Accum<E, W, A>(_0: GadgetF_<E, W, A>): Gadget_<E, W, A> {
  return { tag: "Accum", _0 };
}

/** Get the initial input. */
export function GetInitial<E, W, I, O>(_0: (i: I) => Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "GetInitial", _0 };
}

/** Get the initial environment. */
export function GetInitialEnv<E, W, I, O>(_0: (e: E) => Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "GetInitialEnv", _0 };
}

/** A fixed initial value, regardless of the form inputs. After that it emits its input. */
export function Initially<E = any, W = any, A = any>(_0: A): Gadget_<E, W, A> {
  return { tag: "Initially", _0 };
}

/** Get access to the environment. */
export function GetEnv<E = any, W = any, I = any>(): Gadget<E, W, I, E> {
  return { tag: "GetEnv" };
}

/** Create a subsiduary environment. */
export function WithEnv<E, E2, W, I, O>(_0: Gadget<E, W, I, E2>, _1: Gadget<E2, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "WithEnv", _0, _1 };
}

/** A gadget that writes event data to the side channel. */
export function Send<E = any, W = any, A = any>(_0: (a: A) => Maybe<W>): Gadget_<E, W, A> {
  return { tag: "Send", _0 };
}

/** Modify the data sent on the side channel. */
export function SendMap<E, W1, W2, I, O>(_0: (w1: W1) => Maybe<W2>, _1: Gadget<E, W1, I, O>): Gadget<E, W2, I, O> {
  return { tag: "SendMap", _0, _1 };
}

/** A gadget that views its inputs and outputs through a lens. */
export function Focusing<E, W, I, O, A, A2>(_0: Lens<I, A, O, A2>, _1: Gadget<E, W, A, A2>): GadgetF<E, W, I, O> {
  return { tag: "Focusing", _0, _1 };
}

/**
 * A gadget that views its inputs and outputs through a "Prism". Typically used for
 * a dialog element that applies to a single variant of a union type.
 */
export function Prismatic<E, W, St, T2, A, A2>(_0: A, _1: Prism<St, A, T2, A2>, _2: Gadget<E, W, A, A2>): Gadget<E, W, St, T2> {
  return { tag: "Prismatic", _0, _1, _2 };
}

/** As for "Prismatic", but for when the inner Gadget already ouptuts a function. */
export function PrismaticOver<E, W, St, A>(_0: A, _1: Prism<St, A>, _2: GadgetF_<E, W, A>): GadgetF_<E, W, St> {
  return { tag: "PrismaticOver", _0, _1, _2 };
}

/**
 * A gadget that views its inputs and outputs through a "Traversal". Typically used
 * for a dialog element that accesses one part of a larger structure.
 * Note that traversals cannot change the shape of the input, so @Traversing _Left@
 * will ignore any @Right@ values rather than changing them.
 */
export function Traversing<E, W, I, O, A, A2>(_0: A, _1: Traversal<I, A, O, A2>, _2: Gadget<E, W, A, A2>): GadgetF<E, W, I, O> {
  return { tag: "Traversing", _0, _1, _2 };
}

/** As for "Traversing", but for when the inner Gadget already outputs a function. */
export function TraversingOver<E, W, I, O, A, A2>(_0: A, _1: Traversal<I, A, O, A2>, _2: GadgetF<E, W, A, A2>): GadgetF<E, W, I, O> {
  return { tag: "TraversingOver", _0, _1, _2 };
}

// -- | Accumulate edits.
// Accum :: GadgetF' e w a -> Gadget' e w a

/**
 * Dynamic gadgets. A new gadget is computed when the derived @a@ value changes, but this
 * means that any state in the old one is lost. (The Haskell `Eq a` constraint is structural.)
 */
export function Exec<E, W, A, I, O>(_0: (a: A) => Gadget<E, W, I, O>): Gadget<E, W, [A, I], O> {
  return { tag: "Exec", _0 };
}

/**
 * Select the first matching predicate from the list and display the associated gadget.
 * Unlike "Exec" the gadgets are persistent and receive all inputs, even when not displayed. The
 * first argument is the default when none of the predicates are true, so the argument must be
 * non-empty.
 */
export function Cond<E, W, I, O>(_0: readonly PrismaticGadget<E, W, I, O>[]): Gadget<E, W, I, O> {
  return { tag: "Cond", _0 };
}

/** Multiple tabs, each of which has a dialog for one variant. The argument must be non-empty. */
export function UnionTab<E, W, I, O>(_0: readonly (readonly [T.Text, PrismaticGadget<E, W, I, O>])[]): Gadget<E, W, I, O> {
  return { tag: "UnionTab", _0 };
}

/** The gadget is only enabled in the GUI when the @Bool@ input is true. */
export function Enabled<E, W, I, O>(_0: Gadget<E, W, I, O>): Gadget<E, W, [I, boolean], O> {
  return { tag: "Enabled", _0 };
}

/**
 * Optional values. Most arguments are decorated with a tick-box to enable them, but some have
 * special cases. E.g @Optional TextBox@ equates blank to @Nothing@.
 */
export function Optional<E, W, I, O>(_0: I, _1: Gadget<E, W, I, O>): Gadget<E, W, Maybe<I>, Maybe<O>> {
  return { tag: "Optional", _0, _1 };
}

/**
 * Intercept single or double clicks (first argument @True@ for double clicks) and open a
 * pop-up dialog based on the content of the underlying gadget. The dialog result is used
 * as the new output and input for the underlying gadget.
 */
export function Intercept<E, W, A>(_0: boolean, _1: DialogSelector_<E, W, A>, _2: Gadget_<E, W, A>): Gadget_<E, W, A> {
  return { tag: "Intercept", _0, _1, _2 };
}

/** Decorate with an icon. The function should return an icon name or \"blank-icon\" for blank. */
export function Icon<E, W, I, O>(_0: (i: I) => T.Text, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Icon", _0, _1 };
}

/**
 * Decorate with a background colour. The foreground will be either white or black
 * for contrast.
 */
export function Coloured<E, W, I, O>(_0: (i: I) => Maybe<Colour>, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Coloured", _0, _1 };
}

/** Display a hyperlink button with the gadget. */
export function Linked<E, W, I, O>(_0: (i: I) => Maybe<T.Text>, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Linked", _0, _1 };
}

/** With the named style. What this means depends on the back end. */
export function Styled<E, W, I, O>(_0: (i: I) => Maybe<T.Text>, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Styled", _0, _1 };
}

/** Frame drawn around the argument, optionally with a text label. */
export function Frame<E, W, I, O>(_0: (i: I) => Maybe<T.Text>, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Frame", _0, _1 };
}

/** Gadgets aligned vertically or horizontally with labels. */
export function Form<E, W, A>(_0: Orientation, _1: readonly (readonly [T.Text, GadgetF_<E, W, A>])[]): GadgetF_<E, W, A> {
  return { tag: "Form", _0, _1 };
}

/** Similar to form, except that elements are presented in tabs. */
export function TabForm<E, W, A>(_0: readonly (readonly [T.Text, GadgetF_<E, W, A>])[]): GadgetF_<E, W, A> {
  return { tag: "TabForm", _0 };
}

/**
 * Child gadgets are grouped together, either horizontally or vertically. Sublists have
 * separator lines between them.
 */
export function Box<E, W, A>(_0: Orientation, _1: readonly (readonly GadgetF_<E, W, A>[])[]): GadgetF_<E, W, A> {
  return { tag: "Box", _0, _1 };
}

/**
 * Elements are arranged in a grid. The inner lists are of the rows. Names are ignored.
 * The frirst two arguments are the column headers and the row headers respectively.
 */
export function Grid<E, W, A>(
  _0: readonly T.Text[],
  _1: readonly T.Text[],
  _2: readonly (readonly GadgetF_<E, W, A>[])[],
): GadgetF_<E, W, A> {
  return { tag: "Grid", _0, _1, _2 };
}

/**
 * Validate the output against a predicate, signalling an error and blocking the output
 * if it is not met.
 */
export function Validate<E, W, I, O>(_0: (e: E, i: I, o: O) => boolean, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Validate", _0, _1 };
}

/** Validate the output against a predicate which may return an error message. */
export function ValidateText<E, W, I, O>(_0: (e: E, i: I, o: O) => Maybe<T.Text>, _1: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "ValidateText", _0, _1 };
}

/** Text input. The prism is used in reverse to validate the input. */
export function TextBox<E = any, W = any, A = any>(_0: (e: E) => Prism<T.Text, A>): Gadget_<E, W, A> {
  return { tag: "TextBox", _0 };
}

/** Text displayed as a label, but presents a text box for editing when clicked. */
export function DisplayText<E = any, W = any>(): Gadget<E, W, T.Text, T.Text> {
  return { tag: "DisplayText" };
}

/**
 * Multi-line text input. If the @Bool@ is true the box can expand vertically
 * to fill the available space.
 */
export function MemoBox<E = any, W = any>(_0: MemoBoxSize, _1: boolean): Gadget<E, W, T.Text, T.Text> {
  return { tag: "MemoBox", _0, _1 };
}

/** Multi-line text displayed as a label, but presents a text box for editing when clicked. */
export function DisplayMemo<E = any, W = any>(): Gadget<E, W, T.Text, T.Text> {
  return { tag: "DisplayMemo" };
}

/** Menu selection box. (The Haskell `Eq a` constraint is structural.) */
export function Combo<E = any, W = any, A = any>(_0: (e: E) => readonly ComboItem<A>[]): Gadget_<E, W, A> {
  return { tag: "Combo", _0 };
}

/** Group of radio buttons. At most one can be selected. */
export function Radio<E = any, W = any, A = any>(_0: (e: E) => readonly (readonly [T.Text, A])[]): Gadget_<E, W, A> {
  return { tag: "Radio", _0 };
}

/** Boolean tick-box. */
export function TickBox<E = any, W = any>(): Gadget_<E, W, boolean> {
  return { tag: "TickBox" };
}

/** Read-only message for the user. */
export function Message<E = any, W = any, A = any>(_0: (e: E, a: A) => T.Text): Gadget_<E, W, A> {
  return { tag: "Message", _0 };
}

/**
 * Text box with read-only contents. If the optional selector is provided then clicking the
 * message will pop up a dialog.
 */
export function FixedText<E = any, W = any, A = any>(
  _0: (e: E, a: A) => T.Text,
  _1: Maybe<DialogSelector<E, W, A, A>>,
): Gadget_<E, W, A> {
  return { tag: "FixedText", _0, _1 };
}

/** Memo box with read-only contents. */
export function FixedMemo<E = any, W = any, A = any>(
  _0: MemoBoxSize,
  _1: boolean,
  _2: (e: E, a: A) => T.Text,
  _3: Maybe<DialogSelector<E, W, A, A>>,
): Gadget_<E, W, A> {
  return { tag: "FixedMemo", _0, _1, _2, _3 };
}

/**
 * A box containing a list of items separated by commas. Each item will emit the
 * relevant value when clicked.
 */
export function ClickableList<E = any, W = any, A = any>(): Gadget<E, W, readonly ClickableItem<A>[], Maybe<A>> {
  return { tag: "ClickableList" };
}

/** Select a date from a calendar, or type it in. */
export function DateBox<E = any, W = any>(_0: DateFormat): Gadget_<E, W, Day> {
  return { tag: "DateBox", _0 };
}

/** Select an icon. The argument is a predicate for the icon context name. */
export function IconBox<E = any, W = any>(_0: (t: T.Text) => boolean): Gadget_<E, W, IconName> {
  return { tag: "IconBox", _0 };
}

/** Select a colour. */
export function ColourBox<E = any, W = any>(): Gadget_<E, W, Colour> {
  return { tag: "ColourBox" };
}

/** Show an image binary from the ByteString. */
export function ImageDisplay<E = any, W = any>(_0: MemoBoxSize): Gadget_<E, W, Maybe<Uint8Array>> {
  return { tag: "ImageDisplay", _0 };
}

/**
 * Select items from a tree or a list. Only nodes with a @Just@ value may be picked, and
 * branches with no valid children will be trimmed. The @a@ values in the forest must all
 * be distinct. The texts are the node name and optional node tooltip.
 * (The Haskell `Ord a` constraint is structural.)
 */
export function TreeSelector<E = any, W = any, A = any>(
  _0: (e: E) => Forest<readonly [T.Text, Maybe<T.Text>, Maybe<A>]>,
): Gadget_<E, W, S.Set<A>> {
  return { tag: "TreeSelector", _0 };
}

/**
 * Present a list of items in a table. If the "DialogSelector" is present then activating
 * a row will bring up a sub-dialog. This comes with its own scroll box.
 */
export function Table<E = any, W = any, A = any>(
  _0: readonly Tbl.TableEditing<A>[],
  _1: Tbl.Table<A>,
  _2: Maybe<DialogSelector<E, W, A, A>>,
): Gadget_<E, W, readonly A[]> {
  return { tag: "Table", _0, _1, _2 };
}

/**
 * Present a tree of data from an underlying data type. When a node changes value send the
 * key and new node pair as an event.
 */
export function ForestTable<E, W, K, St, A>(
  _0: readonly (readonly [T.Text, readonly (readonly [T.Text, GadgetF_<E, W, A>])[]])[],
  _1: (e: E) => Forest<readonly [K, Lens1<St, A>]>,
): GadgetF_<E, Either<W, [K, (a: A) => A]>, St> {
  return { tag: "ForestTable", _0, _1 };
}

/** Edit a forest of items by clicking and dragging. (The Haskell `Eq a` constraint is structural.) */
export function ForestEditor<E = any, W = any, A = any>(
  /** Text label for a tree item. */
  _0: (e: E, a: A) => T.Text,
  /** Edit menu for tree item. */
  _1: (m: Maybe<A>) => Menu<TreeOper<A>>,
  /** Can this item have children? */
  _2: (a: A) => boolean,
  /** Activation pops up an edit dialog. */
  _3: Maybe<DialogSelector<E, W, A, A>>,
): Gadget_<E, W, Forest<A>> {
  return { tag: "ForestEditor", _0, _1, _2, _3 };
}

/** A file selector. The @Bool@ is True for overwrite confirmation. */
export function FilePathSelector<E = any, W = any>(
  _0: T.Text,
  _1: FilePathPurpose,
  _2: readonly FilePathFilter[],
  _3: boolean,
): Gadget_<E, W, string> {
  return { tag: "FilePathSelector", _0, _1, _2, _3 };
}

/** Puts scroll bars around its argument if necessary. */
export function Scrolled<E, W, I, O>(_0: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return { tag: "Scrolled", _0 };
}

/** Buttons that modify the inner gadget in some way. */
export function ButtonBar<E = any, W = any, A = any>(_0: readonly (readonly [T.Text, (a: A) => A])[]): GadgetF_<E, W, A> {
  return { tag: "ButtonBar", _0 };
}

/**
 * Perform an IO action when the button is clicked.
 *
 * TypeScript: the action may return a `Promise`, which the interpreter awaits.
 */
export function ButtonIO<E = any, W = any, I = any, O = any>(
  _0: T.Text,
  _1: (e: E, i: I) => O | Promise<O>,
): Gadget<E, W, I, Maybe<O>> {
  return { tag: "ButtonIO", _0, _1 };
}

/** Display a fixed image. Returns click coordinates. */
export function Image<E = any, W = any>(_0: string): Gadget_<E, W, [number, number]> {
  return { tag: "Image", _0 };
}

/** Print the input and output values to StdErr. */
export function Trace<E, W, I, O>(
  _0: string,
  _1: (i: I) => string,
  _2: (i: I, o: O) => string,
  _3: Gadget<E, W, I, O>,
): Gadget<E, W, I, O> {
  return { tag: "Trace", _0, _1, _2, _3 };
}

// ---------------------------------------------------------------------------------------------
// Category, Arrow, ArrowLoop, Functor and Applicative instances

/** Haskell `arr` (`instance Arrow (Gadget e w)`: `arr = Pure`). */
export function arr<E = any, W = any, I = any, O = any>(f: (i: I) => O): Gadget<E, W, I, O> {
  return Pure(f);
}

/** Haskell `id` / `returnA` (`instance Category (Gadget e w)`: `id = Null`). */
export function gId<E = any, W = any, A = any>(): Gadget_<E, W, A> {
  return Null();
}

/** Haskell `g1 . g2` / `g1 <<< g2` (`instance Category (Gadget e w)`: `(.) = Dot`). */
export function gDot<E, W, A, A2, C>(g1: Gadget<E, W, A2, C>, g2: Gadget<E, W, A, A2>): Gadget<E, W, A, C> {
  return Dot(g1, g2);
}

/**
 * Haskell `g1 >>> g2 >>> ... >>> gn`. As `(>>>)` is right associative and `f >>> g = g . f`,
 * this builds `Dot (Dot (... gn ...) g2) g1`.
 */
export function gPipe<E, W, A, O1>(g1: Gadget<E, W, A, O1>): Gadget<E, W, A, O1>;
export function gPipe<E, W, A, O1, O2>(g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>): Gadget<E, W, A, O2>;
export function gPipe<E, W, A, O1, O2, O3>(
  g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>, g3: Gadget<E, W, O2, O3>,
): Gadget<E, W, A, O3>;
export function gPipe<E, W, A, O1, O2, O3, O4>(
  g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>, g3: Gadget<E, W, O2, O3>, g4: Gadget<E, W, O3, O4>,
): Gadget<E, W, A, O4>;
export function gPipe<E, W, A, O1, O2, O3, O4, O5>(
  g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>, g3: Gadget<E, W, O2, O3>, g4: Gadget<E, W, O3, O4>,
  g5: Gadget<E, W, O4, O5>,
): Gadget<E, W, A, O5>;
export function gPipe<E, W, A, O1, O2, O3, O4, O5, O6>(
  g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>, g3: Gadget<E, W, O2, O3>, g4: Gadget<E, W, O3, O4>,
  g5: Gadget<E, W, O4, O5>, g6: Gadget<E, W, O5, O6>,
): Gadget<E, W, A, O6>;
export function gPipe<E, W, A, O1, O2, O3, O4, O5, O6, O7>(
  g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>, g3: Gadget<E, W, O2, O3>, g4: Gadget<E, W, O3, O4>,
  g5: Gadget<E, W, O4, O5>, g6: Gadget<E, W, O5, O6>, g7: Gadget<E, W, O6, O7>,
): Gadget<E, W, A, O7>;
export function gPipe<E, W, A, O1, O2, O3, O4, O5, O6, O7, O8>(
  g1: Gadget<E, W, A, O1>, g2: Gadget<E, W, O1, O2>, g3: Gadget<E, W, O2, O3>, g4: Gadget<E, W, O3, O4>,
  g5: Gadget<E, W, O4, O5>, g6: Gadget<E, W, O5, O6>, g7: Gadget<E, W, O6, O7>, g8: Gadget<E, W, O7, O8>,
): Gadget<E, W, A, O8>;
export function gPipe(...gs: Gadget<any, any, any, any>[]): Gadget<any, any, any, any>;
export function gPipe(...gs: Gadget<any, any, any, any>[]): Gadget<any, any, any, any> {
  if (gs.length === 0) return gId();
  let acc = gs[gs.length - 1];
  for (let i = gs.length - 2; i >= 0; i--) acc = Dot(acc, gs[i]);
  return acc;
}

/** Haskell `g1 *** g2` (`instance Arrow (Gadget e w)`: `(***) = Prod`). */
export function gProd<E, W, I1, O1, I2, O2>(g1: Gadget<E, W, I1, O1>, g2: Gadget<E, W, I2, O2>): Gadget<E, W, [I1, I2], [O1, O2]> {
  return Prod(g1, g2);
}

/** Haskell `f &&& g` (the default method: `f &&& g = arr (\b -> (b,b)) >>> f *** g`). */
export function gFanout<E, W, I, O1, O2>(f: Gadget<E, W, I, O1>, g: Gadget<E, W, I, O2>): Gadget<E, W, I, [O1, O2]> {
  return gPipe(arr<E, W, I, [I, I]>((b: I) => [b, b]), gProd(f, g));
}

/** Haskell `first g` (the default method: `first = (*** id)`). */
export function gFirst<E, W, I, O, D = any>(g: Gadget<E, W, I, O>): Gadget<E, W, [I, D], [O, D]> {
  return gProd(g, gId<E, W, D>());
}

/** Haskell `second g` (the default method: `second = (id ***)`). */
export function gSecond<E, W, I, O, D = any>(g: Gadget<E, W, I, O>): Gadget<E, W, [D, I], [D, O]> {
  return gProd(gId<E, W, D>(), g);
}

/** Haskell `loop g` (`instance ArrowLoop (Gadget e w)`: `loop = Loop`). */
export function gLoop<E, W, I, O, St>(g: Gadget<E, W, [I, St], [O, St]>): Gadget<E, W, I, O> {
  return Loop(g);
}

/** Haskell `fmap f g` / `f <$> g` (`instance Functor (Gadget e w i)`: `fmap f g = g >>> Pure f`). */
export function gFmap<E, W, I, O, R>(f: (o: O) => R, g: Gadget<E, W, I, O>): Gadget<E, W, I, R> {
  return gPipe(g, Pure<E, W, O, R>(f));
}

/** Haskell `pure v` (`instance Applicative (Gadget e w i)`: `pure v = arr $ const v`). */
export function gPure<E = any, W = any, I = any, O = any>(v: O): Gadget<E, W, I, O> {
  return arr<E, W, I, O>((_: I) => v);
}

/** Haskell `gf <*> gx` (`f <*> v = f &&& v >>> arr (uncurry ($))`). */
export function gAp<E, W, I, A, R>(gf: Gadget<E, W, I, (a: A) => R>, gx: Gadget<E, W, I, A>): Gadget<E, W, I, R> {
  return gPipe(gFanout(gf, gx), arr<E, W, [(a: A) => R, A], R>(([f, x]) => f(x)));
}

/** Haskell `liftA2 f g1 g2` (the default method: `liftA2 f x = (<*>) (fmap f x)`). */
export function gLiftA2<E, W, I, A, A2, R>(
  f: (a: A, b: A2) => R,
  g1: Gadget<E, W, I, A>,
  g2: Gadget<E, W, I, A2>,
): Gadget<E, W, I, R> {
  return gAp(gFmap((a: A) => (b: A2) => f(a, b), g1), g2);
}

// ---------------------------------------------------------------------------------------------
// Dialogs

/** Pop-up dialogs can have different buttons at the bottom. */
export type DialogButtons =
  /** OK and Cancel buttons. */
  | { readonly tag: "OkButton" }
  /** OK, Apply and Cancel buttons. */
  | { readonly tag: "OkApplyButton" }
  /** A single button with the specified text. Use for read-only dialogs. */
  | { readonly tag: "CloseButton"; readonly _0: T.Text };

/** OK and Cancel buttons. */
export const OkButton: DialogButtons = { tag: "OkButton" };
/** OK, Apply and Cancel buttons. */
export const OkApplyButton: DialogButtons = { tag: "OkApplyButton" };
/** A single button with the specified text. Use for read-only dialogs. */
export function CloseButton(_0: T.Text): DialogButtons {
  return { tag: "CloseButton", _0 };
}

/** A dialog is a gadget that can be popped up in its own window with buttons. */
export interface Dialog<E, W, I, O> {
  readonly dialogTitle: T.Text;
  readonly dialogButtons: DialogButtons;
  readonly dialogGadget: Gadget<E, W, I, O>;
}
export function Dialog<E, W, I, O>(
  dialogTitle: T.Text,
  dialogButtons: DialogButtons,
  dialogGadget: Gadget<E, W, I, O>,
): Dialog<E, W, I, O> {
  return { dialogTitle, dialogButtons, dialogGadget };
}

/** Disable the Apply button in a Dialog, for instance if the following actions are not idempotent. */
export function disableApply<E, W, I, O>(d: Dialog<E, W, I, O>): Dialog<E, W, I, O> {
  switch (d.dialogButtons.tag) {
    case "OkApplyButton":
      return { ...d, dialogButtons: OkButton };
    default:
      return d;
  }
}

/** Dialog where the input and output are the same type. (Haskell `Dialog'`) */
export type Dialog_<E, W, A> = Dialog<E, W, A, A>;

/** Change the type of a dialog. */
export function promoteDialog<E, W, I, O, I2, O2>(
  f: (g: Gadget<E, W, I, O>) => Gadget<E, W, I2, O2>,
  d: Dialog<E, W, I, O>,
): Dialog<E, W, I2, O2> {
  return Dialog(d.dialogTitle, d.dialogButtons, f(d.dialogGadget));
}

/**
 * A function from an item to the appropriate "Dialog" (if any) for that item.
 *
 * Dialog selectors are used for sum types. Given types @Foo@ and @Bar@, with
 * corresponding gadgets @fooGadget :: Gadget' Foo@ and @barGadget :: Gadget' Bar@
 * you can define:
 *
 * > type Foobar = Either Foo Bar
 * >
 * > foobarSelector :: DialogSelector Foobar
 * > foobarSelector (Left v) = const $ Just $ Dialog "Foo" OkButton $ prismatic _Left fooGadget
 * > foobarSelector (Right v) = const $ Just $ Dialog "Bar" OkButton $ prismatic _Right barGadget
 *
 * This makes the environment available in two ways: one passed through the selector argument,
 * and the other via the gadget. The latter may change during the lifetime of the gadget, so
 * aspects of the gadget can be made static or dynamic as required.
 *
 * TypeScript: the curried `e -> i -> Maybe (Dialog e w i o)` is uncurried.
 */
export type DialogSelector<E, W, I, O> = (e: E, i: I) => Maybe<Dialog<E, W, I, O>>;

/** Haskell `DialogSelector'` */
export type DialogSelector_<E, W, A> = DialogSelector<E, W, A, A>;

/** Disable the Apply button in a dialog selector. */
export function disableApply1<E, W, I, O>(sel: DialogSelector<E, W, I, O>): DialogSelector<E, W, I, O> {
  return (e, v) => mapMaybeValue((d: Dialog<E, W, I, O>) => disableApply(d), sel(e, v));
}

/** Change the type of a "DialogSelector". */
export function promoteDialogSelector<E, W, St, A>(
  d: A,
  prsm: Prism<St, A>,
  sel: DialogSelector_<E, W, A>,
): DialogSelector_<E, W, St> {
  return (e, v) =>
    mapMaybeValue(
      (dlg: Dialog_<E, W, A>) => promoteDialog((g: Gadget_<E, W, A>) => Prismatic(d, prsm, g), dlg),
      sel(e, fromMaybe(d, preview(prsm, v))),
    );
}

/** A dialog selector which always produces the same dialog. */
export function constantDialog<E, W, I, O>(d: Dialog<E, W, I, O>): DialogSelector<E, W, I, O> {
  return (_e, _i) => Just(d);
}

// ---------------------------------------------------------------------------------------------
// Debugging

/** Render the gadget as a tree of text for debugging. */
export function showGadget(g: Gadget<any, any, any, any>): Tree<string> {
  /** Prefix the label of a sub-gadget's tree. */
  const labelled = (prefix: string, sub: Gadget<any, any, any, any>): Tree<string> => {
    const n = showGadget(sub);
    return Node(prefix + n.rootLabel, n.subForest);
  };
  switch (g.tag) {
    case "Null": return Node("Null", []);
    case "Pure": return Node("Pure", []);
    case "Dot": return Node("Dot", [showGadget(g._1), showGadget(g._0)]); // Order is more intuitive
    case "Prod": return Node("Prod", [showGadget(g._0), showGadget(g._1)]);
    case "Loop": return Node("Loop", [showGadget(g._0)]);
    // showGadget (Feedback g) = Node "Feedback" [showGadget g]
    case "Accum": return Node("Accum", [showGadget(g._0)]);
    case "Initially": return Node("Initially", []);
    case "GetInitial": return Node("GetInitial", []);
    case "GetInitialEnv": return Node("GetInitialEnv", []);
    case "GetEnv": return Node("GetEnv", []);
    case "WithEnv": return Node("WithEnv", [showGadget(g._0), showGadget(g._1)]);
    case "Send": return Node("Send", []);
    case "SendMap": return Node("SendMap", [showGadget(g._1)]);
    case "Focusing": return Node("Focusing", [showGadget(g._1)]);
    case "Prismatic": return Node("Prismatic", [showGadget(g._2)]);
    case "PrismaticOver": return Node("PrismaticOver", [showGadget(g._2)]);
    case "Traversing": return Node("Traversing", [showGadget(g._2)]);
    case "TraversingOver": return Node("TraversingOver", [showGadget(g._2)]);
    // showGadget (Accum g) = Node "Accum" [showGadget g]
    case "Exec": return Node("Exec ...", []);
    case "Cond": return Node("Cond", g._0.map((pg) => showGadget(pg._2)));
    case "UnionTab": return Node("UnionTab", g._0.map(([l, pg]) => labelled(T.unpack(l) + " ", pg._2)));
    case "Enabled": return Node("Enabled", [showGadget(g._0)]);
    case "Optional": return Node("Optional", [showGadget(g._1)]);
    case "Intercept":
      return Node("Intercept " + (g._0 ? "single-click " : "double-click "), [showGadget(g._2)]);
    case "Icon": return Node("Icon", [showGadget(g._1)]);
    case "Coloured": return Node("Coloured", [showGadget(g._1)]);
    case "Linked": return Node("Linked", [showGadget(g._1)]);
    case "Styled": return Node("Styled", [showGadget(g._1)]);
    case "Frame": return Node("Frame", [showGadget(g._1)]);
    case "Form": return Node("Form " + g._0, g._1.map(([l, sub]) => labelled(T.unpack(l) + ": ", sub)));
    case "TabForm": return Node("TabForm", g._0.map(([l, sub]) => labelled(T.unpack(l) + ": ", sub)));
    case "Box": return Node("Box " + g._0, L.concat(g._1).map(showGadget));
    case "Validate": return Node("Validate", [showGadget(g._1)]);
    case "ValidateText": return Node("ValidateText", [showGadget(g._1)]);
    case "TextBox": return Node("TextBox", []);
    case "DisplayText": return Node("DisplayText", []);
    case "MemoBox": return Node("MemoBox", []);
    case "DisplayMemo": return Node("DisplayMemo", []);
    case "Combo": return Node("Combo", []);
    case "Radio": return Node("Radio", []);
    case "TickBox": return Node("TickBox", []);
    case "Message": return Node("Message", []);
    case "FixedText": return Node("FixedText", []);
    case "FixedMemo": return Node("FixeMemo", []);
    case "ClickableList": return Node("ClickableList", []);
    case "DateBox": return Node("DateBox " + T.showText(g._0), []);
    case "IconBox": return Node("IconBox", []);
    case "ColourBox": return Node("ColourBox", []);
    case "ImageDisplay": return Node("ImageDisplay " + g._0, []);
    case "TreeSelector": return Node("TreeSelector ...", []);
    case "Table": return Node("Table ...", []);
    case "ForestTable":
      return Node("ForestTable", g._0.flatMap(([, cols]) => cols.map(([nm, sub]) => labelled(T.unpack(nm) + ": ", sub))));
    case "ForestEditor": return Node("ForestEditor", []);
    case "FilePathSelector": return Node("FilePathSelector " + T.showText(g._0), []);
    case "Grid": {
      const colH = g._0, rowH = g._1, cells = g._2;
      const showCell = (rh: T.Text, ch: T.Text, cell: Gadget<any, any, any, any>): Tree<string> =>
        labelled("(" + T.unpack(ch) + ", " + T.unpack(rh) + "): ", cell);
      return Node(
        "Grid",
        L.concat(L.zipWith((rh: T.Text, row: readonly Gadget<any, any, any, any>[]) =>
          L.zipWith((ch: T.Text, cell: Gadget<any, any, any, any>) => showCell(rh, ch, cell), colH, row), rowH, cells)),
      );
    }
    case "Scrolled": return Node("Scrolled", []);
    case "ButtonBar": return Node("Buttons " + T.intercalate(", ", g._0.map((b) => T.unpack(b[0]))), []);
    case "ButtonIO": return Node("ButtonIO", []);
    case "Image": return Node("Image " + g._0, []);
    case "Trace": return Node("Trace " + g._0, [showGadget(g._3)]);
    default: return absurd(g);
  }
}
