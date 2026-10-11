// Ported from banana-ui/base/Reactive/Banana/ArrowDialog.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Arrowized language for defining abstract graphical user interfaces. Gadgets act as a combination
 * of stream and value transformer, in that the input and ouput values are considered to have both a
 * current value and an event when that value changes. When a value is edited in a gadget this triggers
 * an event to update the downstream gadgets.
 *
 * Gadgets also have side channels that are not part of the transformer semantics. These are the
 * environment (@e@ type parameter) and the event writer (@w@ type parameter). The former is used for
 * information that would otherwise have to tramp unchanged alongside every input and output. The
 * latter is useful when a large structure is being edited and the application needs the deltas rather
 * than the modified whole.
 *
 * TypeScript port
 * ---------------
 * * The arrow combinators (`arr`, `gId`, `gPipe`, `gDot`, `gProd`, `gFanout`, `gFirst`, `gSecond`,
 *   `gLoop`, `gFmap`, `gPure`, `gAp`, `gLiftA2`) are re-exported from "GadgetPrimitives".
 * * Gadgets that are plain values in Haskell (`getEnv`, `simpleTextBox`, `displayText`,
 *   `displayMemo`, `clickableList`, `tickBox`, `colourBox`) are functions of no arguments here,
 *   like `gId()`, because they are polymorphic.
 * * `Show`/`Read`/`Enum`/`Bounded` constraints become explicit arguments:
 *   `typedTextBox(show, read)`, `maybeTextBox(show, read)`, `simpleCombo(xs, show = String)`,
 *   `rangeCombo(enumDict, [x1, x2], show = String)`, `boundedCombo(values, show = String)` (the
 *   `Bounded`/`Enum` dictionary of an enumeration is its `<type>Values` array), and likewise for
 *   the radio buttons. `Enum_Int` and `enumOfValues(values)` are `Enum` dictionaries.
 * * `traceGadget`/`traceGadgetOver` take optional `show` functions for the input and output.
 */
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import type * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe, fromMaybe } from "@/lib/Data/Maybe";
import type { Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import type { Day } from "@/lib/Data/Time";
import type { Forest } from "@/lib/Data/Tree";
import { identity, lens, over, withLens, type Lens, type Prism, type Traversal } from "@/lib/Control/Lens";
import { error } from "@/lib/Prelude";
import { prismToMaybe, textPrism, type Colour, type DateFormat, type IconName } from "./Common";
import type { Menu } from "./Menu";
import type * as Tbl from "./Table";
import {
  Accum, ButtonBar, ButtonIO, ClickableItem, ClickableList, ColourBox, Coloured, Combo, ComboItem, Cond,
  DateBox, DisplayMemo, DisplayText, Enabled, Exec, FilePathSelector, FixedMemo, FixedText, Focusing,
  ForestEditor, ForestTable, Form, Frame, GetEnv, GetInitial, GetInitialEnv, Grid, Icon, IconBox, Image,
  ImageDisplay, Initially, Intercept, Linked, MemoBox, Message, Optional, Prismatic, PrismaticOver, Radio,
  Scrolled, Send, SendMap, Styled, TabForm, Table, TextBox, TickBox, Trace, Traversing, TraversingOver,
  TreeSelector, UnionTab, Validate, ValidateText, Box, WithEnv,
  arr, gDot, gPipe,
  type DialogSelector, type DialogSelector_, type FilePathFilter, type FilePathPurpose, type Gadget,
  type Gadget_, type GadgetF, type GadgetF_, type Lens1, type MemoBoxSize, type Orientation,
  type PrismaticGadget, type TreeOper,
} from "./GadgetPrimitives";

// * Basic Types, * Gadget Types, * Dialogs, * Debugging (re-exported from GadgetPrimitives)
export {
  ComboItem, fmap_ComboItem, ClickableItem, orientationValues, memoBoxSizeValues, filePathPurposeValues,
  FilePathGlob, FilePathMime, FilePathImages, PrismaticGadget, Lens1, getLens,
  TreeAddBefore, TreeAddAfter, TreeAddIn, TreeDelete,
  OkButton, OkApplyButton, CloseButton, Dialog, promoteDialog, promoteDialogSelector, constantDialog,
  showGadget,
  // Arrow, Category, ArrowLoop, Functor and Applicative instances (PORTING.md §9).
  arr, gId, gPipe, gDot, gProd, gFanout, gFirst, gSecond, gLoop, gFmap, gPure, gAp, gLiftA2,
} from "./GadgetPrimitives";
export type {
  Orientation, MemoBoxSize, FilePathPurpose, FilePathFilterItem, FilePathFilter,
  Gadget, Gadget_, GadgetF, GadgetF_, TreeOper,
  DialogButtons, Dialog_, DialogSelector, DialogSelector_,
} from "./GadgetPrimitives";

// ---------------------------------------------------------------------------------------------
// * Basic Combinators

/**
 * A gadget that views its inputs and outputs through a lens.
 *
 * @focusing id@ is often used to turn a "Gadget" into a "GadgetF"
 */
export function focusing<E, W, I, O, A, A2>(lns: Lens<I, A, O, A2>, g: Gadget<E, W, A, A2>): GadgetF<E, W, I, O> {
  return Focusing(lns, g);
}

/** As for "focusing", but for when the inner Gadget already outputs a function. */
export function focusingOver<E, W, I, O, A, A2>(lns: Lens<I, A, O, A2>, g: GadgetF<E, W, A, A2>): GadgetF<E, W, I, O> {
  return withLens(lns, (getter, _) =>
    focusing(lens<I, A, O, (a: A) => A2>(getter, (i, f) => over(lns, f, i)), g));
  // There is probably a simple and clever way of doing this.
}

/**
 * A gadget that views its inputs and outputs through a "Prism". Its output is a function which
 * overwrites the input using "re", so even if the input doesn't match the prism the output will.
 */
export function prismatic<E, W, St, T2, A, A2>(d: A, prsm: Prism<St, A, T2, A2>, g: Gadget<E, W, A, A2>): Gadget<E, W, St, T2> {
  return Prismatic(d, prsm, g);
}

/** As for "prismatic", but for when the inner Gadget already outputs a function. */
export function prismaticOver<E, W, St, A>(d: A, prsm: Prism<St, A>, g: GadgetF_<E, W, A>): GadgetF_<E, W, St> {
  return PrismaticOver(d, prsm, g);
}

/**
 * A gadget that views its inputs and outputs through a "Traversal". Its output is a function
 * which sets the relevant part of the input, so it is typically used
 * for a dialog element that accesses one part of a larger structure.
 *
 * Note that traversals cannot change the shape of the input, so @traversing _Left@
 * will ignore any @Right@ values rather than changing them.
 */
export function traversing<E, W, I, O, A, A2>(d: A, t: Traversal<I, A, O, A2>, g: Gadget<E, W, A, A2>): GadgetF<E, W, I, O> {
  return Traversing(d, t, g);
}

/** As for "traversing", but for when the inner Gadget already outputs a function. */
export function traversingOver<E, W, I, O, A, A2>(d: A, t: Traversal<I, A, O, A2>, g: GadgetF<E, W, A, A2>): GadgetF<E, W, I, O> {
  return TraversingOver(d, t, g);
}

/** Accumulate edits. The converse of "focusing" and its relatives. */
export function accum<E, W, A>(g: GadgetF_<E, W, A>): Gadget_<E, W, A> {
  return Accum(g);
}

/**
 * A fixed initial value, regardless of the form inputs. After that it emits its input. Used in
 * recursive loops to set an initial value.
 */
export function initially<E = any, W = any, A = any>(v: A): Gadget_<E, W, A> {
  return Initially(v);
}

/** Get the initial input, for when the gadget should not be recomputed if the input changes. */
export function getInitial<E, W, I, O>(f: (i: I) => Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return GetInitial(f);
}

/** Get access to the environment. Ignores its input. */
export function getEnv<E = any, W = any, I = any>(): Gadget<E, W, I, E> {
  return GetEnv();
}

/** Get the initial environment. */
export function getInitialEnv<E, W, I, O>(f: (e: E) => Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return GetInitialEnv(f);
}

/** Create a subsiduary environment. */
export function withEnv<E, E2, W, I, O>(ge: Gadget<E, W, I, E2>, g: Gadget<E2, W, I, O>): Gadget<E, W, I, O> {
  return WithEnv(ge, g);
}

/**
 * Send event data via the side channel when the input changes. Any data sent this way will
 * not be blocked by downstream validation checks, so put validation upstream of this gadget.
 */
export function send<E = any, W = any, A = any>(f: (a: A) => Maybe<W>): Gadget_<E, W, A> {
  return Send(f);
}

/** Modify the data sent over the side channel. */
export function sendMap<E, W1, W2, I, O>(f: (w1: W1) => Maybe<W2>, g: Gadget<E, W1, I, O>): Gadget<E, W2, I, O> {
  return SendMap(f, g);
}

/**
 * Block data sent over the side channel. Useful for coercing the types of gadgets that never
 * send anything.
 */
export function sendEmpty<E, W1, W2, I, O>(g: Gadget<E, W1, I, O>): Gadget<E, W2, I, O> {
  return sendMap((_: W1): Maybe<W2> => Nothing, g);
}

// ---------------------------------------------------------------------------------------------
// * Dynamic Gadgets

/**
 * Dynamic gadgets. A new gadget is computed when the derived @a@ value is changed by the user.
 * Any state in the old one is lost. Changes to @a@ from the application are ignored.
 */
export function exec<E, W, A, I, O>(f: (a: A) => Gadget<E, W, I, O>): Gadget<E, W, [A, I], O> {
  return Exec(f);
}

/**
 * Select the first matching prism from the list and display the associated gadget.
 * Unlike "exec" the gadgets are persistent. The
 * first argument is the default when none of the prisms match.
 */
export function cond<E, W, I, O>(gs: readonly PrismaticGadget<E, W, I, O>[]): Gadget<E, W, I, O> {
  return Cond(gs);
}

/** Multiple tabs, each of which has a dialog for one variant. */
export function unionTab<E, W, I, O>(gs: readonly (readonly [T.Text, PrismaticGadget<E, W, I, O>])[]): Gadget<E, W, I, O> {
  return UnionTab(gs);
}

// ---------------------------------------------------------------------------------------------
// * Decorations

/** The gadget is only enabled in the GUI when the @Bool@ input is true. */
export function enabled<E, W, I, O>(g: Gadget<E, W, I, O>): Gadget<E, W, [I, boolean], O> {
  return Enabled(g);
}

/**
 * Optional values. Most arguments are decorated with a tick-box to enable them, but some have
 * special cases. E.g @optional textBox@ equates blank to @Nothing@.
 */
export function optional<E, W, I, O>(d: I, g: Gadget<E, W, I, O>): Gadget<E, W, Maybe<I>, Maybe<O>> {
  return Optional(d, g);
}

/** Variant of "optional" for a "GadgetF". */
export function optionalOver<E, W, I, O>(d: I, g: GadgetF<E, W, I, O>): GadgetF<E, W, Maybe<I>, Maybe<O>> {
  // update :: Maybe (i -> o) -> Maybe i -> Maybe o
  const update = (mf: Maybe<(i: I) => O>) => (i: Maybe<I>): Maybe<O> =>
    mf.tag === "Nothing" ? Nothing : Just(mf.value(fromMaybe(d, i)));
  return gPipe(Optional(d, g), arr<E, W, Maybe<(i: I) => O>, (i: Maybe<I>) => Maybe<O>>(update));
}

/**
 * Intercept single or double clicks (first argument @True@ for double clicks) and open a
 * pop-up dialog based on the content of the underlying gadget. The dialog result is used
 * as the new input for the underlying gadget.
 *
 * Bear in mind that intercepting single button presses will also catch any double-button presses
 * as two single-button presses.
 */
export function intercept<E, W, A>(b: boolean, sel: DialogSelector_<E, W, A>, g: Gadget_<E, W, A>): Gadget_<E, W, A> {
  return Intercept(b, sel, g);
}

/** Decorate with an icon. The function should return an icon name or \"blank-icon\" for blank. */
export function icon<E, W, I, O>(f: (i: I) => T.Text, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Icon(f, g);
}

/**
 * Decorate with a background colour. The foreground will be either white or black
 * for contrast.
 */
export function coloured<E, W, I, O>(f: (i: I) => Maybe<Colour>, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Coloured(f, g);
}

/** Display a hyperlink button with the gadget. */
export function linked<E, W, I, O>(f: (i: I) => Maybe<T.Text>, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Linked(f, g);
}

/** Display the inner gadget with a named style. In GTK this is the class name in the CSS. */
export function styled<E, W, I, O>(f: (i: I) => Maybe<T.Text>, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Styled(f, g);
}

/** As for "styled", but with a fixed style name. */
export function styled1<E, W, I, O>(str: T.Text, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return styled((_: I) => Just(str), g);
}

/** Frame drawn around the argument, optionally with a text label. */
export function frame<E, W, I, O>(f: (i: I) => Maybe<T.Text>, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Frame(f, g);
}

/** Frame with no label. */
export function plainFrame<E, W, I, O>(g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Frame((_: I): Maybe<T.Text> => Nothing, g);
}

/** Frame with a constant label. */
export function simpleFrame<E, W, I, O>(txt: T.Text, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Frame((_: I) => Just(txt), g);
}

/** Read-only message for the user. The displayed message is a function of the input. */
export function message<E = any, W = any, A = any>(f: (e: E, a: A) => T.Text): Gadget_<E, W, A> {
  return Message(f);
}

/** Constant message regardless of input. */
export function message1<E = any, W = any, A = any>(txt: T.Text): Gadget_<E, W, A> {
  return Message((_e: E, _a: A) => txt);
}

/** Add scroll bars to the argument if necessary. */
export function scrolled<E, W, I, O>(g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Scrolled(g);
}

// ---------------------------------------------------------------------------------------------
// * Grouping

/**
 * Gadgets aligned vertically or horizontally with labels. This only emits the latest edit, so
 * it must be enclosed in an "accum".
 */
export function form<E, W, A>(o: Orientation, gs: readonly (readonly [T.Text, GadgetF_<E, W, A>])[]): GadgetF_<E, W, A> {
  return Form(o, gs);
}

/** Similar function to "form", but the gadgets are presented in a set of tabs. */
export function tabForm<E, W, A>(gs: readonly (readonly [T.Text, GadgetF_<E, W, A>])[]): GadgetF_<E, W, A> {
  return TabForm(gs);
}

/**
 * Child widgets are grouped together, either horizontally or vertically. Sublists have
 * separator lines between them. As with "form" it must be enclosed in an "accum".
 */
export function box<E, W, A>(o: Orientation, gss: readonly (readonly GadgetF_<E, W, A>[])[]): GadgetF_<E, W, A> {
  return Box(o, gss);
}

/**
 * Elements are arranged in a grid. The innter lists are of the rows.
 * The first two arguments are the column headers and the row headers respectively. As with "form"
 * it must be enclosed in an "accum".
 */
export function grid<E, W, A>(
  colH: readonly T.Text[],
  rowH: readonly T.Text[],
  cells: readonly (readonly GadgetF_<E, W, A>[])[],
): GadgetF_<E, W, A> {
  return Grid(colH, rowH, cells);
}

/**
 * Present a forest of data items. Each level in the tree is edited through the gadgets in
 * the corresponding column group. When a value changes the gadget emits the corresponding key
 * and update function. The GTK Grid widget is given the class \"forest-table\".
 */
export function forestTable<E, W, K, St, A>(
  /**
   * Groups of columns. The name of the first group is ignored. Each column has a heading
   * and a gadget template.
   */
  groups: readonly (readonly [T.Text, readonly (readonly [T.Text, GadgetF_<E, W, A>])[]])[],
  /**
   * The data to edit is represented as a forest of lenses, each accessing some underlying
   * data type. This is computed on widget creation and is not updated when the env changes.
   */
  f: (e: E) => Forest<readonly [K, Lens1<St, A>]>,
): GadgetF_<E, Either<W, [K, (a: A) => A]>, St> {
  return ForestTable(groups, f);
}

// ---------------------------------------------------------------------------------------------
// * Data Validation

/**
 * Validate the output against a predicate, signalling an error and blocking the output
 * if it is not met.
 */
export function validate<E, W, I, O>(f: (o: O) => boolean, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Validate((_e: E, _i: I, o: O) => f(o), g);
}

/** As for "validate", but for gadgets that output a function. */
export function validateOver<E, W, I, O>(f: (o: O) => boolean, g: GadgetF<E, W, I, O>): GadgetF<E, W, I, O> {
  return Validate((_e: E, i: I, o: (i: I) => O) => f(o(i)), g);
}

/** Validate the output against the input and environment. */
export function validate1<E, W, I, O>(f: (e: E, i: I, o: O) => boolean, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return Validate(f, g);
}

/** Validate the output against a predicate which may return an error message. */
export function validateText<E, W, I, O>(f: (o: O) => Maybe<T.Text>, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return ValidateText((_e: E, _i: I, o: O) => f(o), g);
}

/** As for "validateText", but for gadgets that output a function. */
export function validateTextOver<E, W, I, O>(f: (o: O) => Maybe<T.Text>, g: GadgetF<E, W, I, O>): GadgetF<E, W, I, O> {
  return ValidateText((_e: E, i: I, o: (i: I) => O) => f(o(i)), g);
}

/** Validate the output against the input. */
export function validateText1<E, W, I, O>(f: (e: E, i: I, o: O) => Maybe<T.Text>, g: Gadget<E, W, I, O>): Gadget<E, W, I, O> {
  return ValidateText(f, g);
}

// ---------------------------------------------------------------------------------------------
// * Data Entry Fields

/**
 * Single line text input. The prism is used in reverse to validate the input.
 *
 * There is a nasty gotcha with @textBox@ and its relatives; when a text box is updated from an
 * upstream arrow it will send two updates, one for an empty string and a second for the new value.
 * This transient behavior can cause issues. It can be detected using "traceGadget".
 */
export function textBox<E = any, W = any, A = any>(f: (e: E) => Prism<T.Text, A>): Gadget_<E, W, A> {
  return TextBox(f);
}

/** A single text box just holding a string. */
export function simpleTextBox<E = any, W = any>(): Gadget_<E, W, T.Text> {
  return TextBox((_: E) => identity<T.Text>());
}

/**
 * A text box for arbitrary data types via their @Read@ and @Show@ instances.
 *
 * TypeScript: the `Show` and `Read` instances are passed explicitly (e.g. `showInt`, `readInt`).
 */
export function typedTextBox<E = any, W = any, A = any>(
  show: (a: A) => string,
  read: (s: string) => Maybe<A>,
): Gadget_<E, W, A> {
  return TextBox((_: E) => textPrism(show, read));
}

/**
 * A text box for "Maybe" values. A blank entry equates to "Nothing".
 *
 * TypeScript: the `Show` and `Read` instances are passed explicitly.
 */
export function maybeTextBox<E = any, W = any, A = any>(
  show: (a: A) => string,
  read: (s: string) => Maybe<A>,
): Gadget_<E, W, Maybe<A>> {
  return TextBox((_: E) => prismToMaybe(textPrism(show, read)));
}

/** Text displayed as a label, but presents a text box for editing when clicked. */
export function displayText<E = any, W = any>(): Gadget<E, W, T.Text, T.Text> {
  return DisplayText();
}

/**
 * Multi-line text input. If the @Bool@ is true the box can expand vertically.
 * to fill the available space.
 */
export function memoBox<E = any, W = any>(size: MemoBoxSize, expand: boolean): Gadget_<E, W, T.Text> {
  return MemoBox(size, expand);
}

/**
 * Multi-line, multi-paragraph text displayed as a label, but presents a text box for
 * editing when clicked.
 */
export function displayMemo<E = any, W = any>(): Gadget_<E, W, T.Text> {
  return DisplayMemo();
}

/**
 * A box containing a list of items separated by commas. Each item will emit the
 * relevant value when clicked. The widget will be given the style \"clickable-list\".
 */
export function clickableList<E = any, W = any, A = any>(): Gadget<E, W, readonly ClickableItem<A>[], Maybe<A>> {
  return ClickableList();
}

/** A clickableList where each item can be selected with a single click. */
export function clickableSingle<E = any, W = any, A = any>(f: (a: A) => T.Text): Gadget<E, W, readonly A[], Maybe<A>> {
  const mkClick = (v: A): ClickableItem<A> => ClickableItem(f(v), Just(v), Nothing, Nothing);
  return gDot(
    ClickableList<E, W, A>(),
    arr<E, W, readonly A[], readonly ClickableItem<A>[]>((xs) => xs.map(mkClick)),
  );
}

/** A clickableList where each item can be selected with a double click. */
export function clickableDouble<E = any, W = any, A = any>(f: (a: A) => T.Text): Gadget<E, W, readonly A[], Maybe<A>> {
  const mkClick = (v: A): ClickableItem<A> => ClickableItem(f(v), Nothing, Just(v), Nothing);
  return gDot(
    ClickableList<E, W, A>(),
    arr<E, W, readonly A[], readonly ClickableItem<A>[]>((xs) => xs.map(mkClick)),
  );
}

/** Menu selection box. Menu items are derived from the environment. */
export function comboBox<E = any, W = any, A = any>(f: (e: E) => readonly ComboItem<A>[]): Gadget_<E, W, A> {
  return Combo(f);
}

/**
 * A menu for a fixed list of Showable items.
 *
 * TypeScript: `show` defaults to `String`, which is the Haskell `show` of an enumeration.
 */
export function simpleCombo<E = any, W = any, A = any>(xs: readonly A[], show: (a: A) => string = String): Gadget_<E, W, A> {
  const items = xs.map((x) => ComboItem(T.pack(show(x)), Nothing, Nothing, x));
  return Combo((_: E) => items);
}

/**
 * Haskell `Enum` dictionary, reduced to the `enumFromTo` method (@[x1 .. x2]@) needed here.
 * (TypeScript port helper; not in the Haskell module.)
 */
export interface Enum<A> {
  enumFromTo(x1: A, x2: A): A[];
}

/** `instance Enum Int` (TypeScript port helper). */
export const Enum_Int: Enum<number> = {
  enumFromTo: (x1, x2) => L.range(x1, x2),
};

/**
 * The derived `Enum` instance of an enumeration, given all its values in constructor order
 * (e.g. `memoBoxSizeValues`). (TypeScript port helper.)
 */
export function enumOfValues<A>(values: readonly A[]): Enum<A> {
  return {
    enumFromTo: (x1, x2) => {
      const i1 = values.findIndex((v) => equals(v, x1));
      const i2 = values.findIndex((v) => equals(v, x2));
      if (i1 < 0 || i2 < 0) return error("enumFromTo: value is not in the enumeration");
      return values.slice(i1, i2 + 1);
    },
  };
}

/** A menu for a range within an enumerated type. */
export function rangeCombo<E = any, W = any, A = any>(
  enumA: Enum<A>,
  range: readonly [A, A],
  show: (a: A) => string = String,
): Gadget_<E, W, A> {
  const [x1, x2] = range;
  return simpleCombo(enumA.enumFromTo(x1, x2), show);
}

/**
 * A menu for the whole of an enumerated type.
 *
 * Be careful what you use this for. @boundedCombo :: Gadget' Int@ will compile,
 * but will run out of memory trying to generate an entry for every value.
 *
 * TypeScript: the `Bounded`/`Enum` dictionary is the list of all values in constructor order
 * (e.g. `memoBoxSizeValues`).
 */
export function boundedCombo<E = any, W = any, A = any>(values: readonly A[], show: (a: A) => string = String): Gadget_<E, W, A> {
  return rangeCombo(enumOfValues(values), [values[0], values[values.length - 1]], show);
}

/** Radio buttons for a list of items. */
export function radio<E = any, W = any, A = any>(f: (e: E) => readonly (readonly [T.Text, A])[]): Gadget_<E, W, A> {
  return Radio(f);
}

/** Radio buttons for a fixed list of showable items. */
export function simpleRadio<E = any, W = any, A = any>(xs: readonly A[], show: (a: A) => string = String): Gadget_<E, W, A> {
  const items = xs.map((x): readonly [T.Text, A] => [T.pack(show(x)), x]);
  return Radio((_: E) => items);
}

/** Radio buttons for a range within an enumerated type. */
export function rangeRadio<E = any, W = any, A = any>(
  enumA: Enum<A>,
  range: readonly [A, A],
  show: (a: A) => string = String,
): Gadget_<E, W, A> {
  const [x1, x2] = range;
  return simpleRadio(enumA.enumFromTo(x1, x2), show);
}

/** Radio buttons for the whole of an enumerated type. See warning for 'boundedCombo'. */
export function boundedRadio<E = any, W = any, A = any>(values: readonly A[], show: (a: A) => string = String): Gadget_<E, W, A> {
  return rangeRadio(enumOfValues(values), [values[0], values[values.length - 1]], show);
}

/** Boolean tick-box. In combination with "optional" this will give a three-item menu. */
export function tickBox<E = any, W = any>(): Gadget_<E, W, boolean> {
  return TickBox();
}

/** Select a date from a calendar, or type it in. */
export function dateBox<E = any, W = any>(fmt: DateFormat): Gadget_<E, W, Day> {
  return DateBox(fmt);
}

/** Select an icon. The argument is a predicate for the icon context name. */
export function iconBox<E = any, W = any>(p: (t: T.Text) => boolean): Gadget_<E, W, IconName> {
  return IconBox(p);
}

/** Select a colour. */
export function colourBox<E = any, W = any>(): Gadget_<E, W, Colour> {
  return ColourBox();
}

/** Displays the image from the ByteString. */
export function imageDisplay<E = any, W = any>(size: MemoBoxSize): Gadget_<E, W, Maybe<Uint8Array>> {
  return ImageDisplay(size);
}

/**
 * Select items from a tree or a list. Only nodes with a @Just@ value may be picked and
 * branches with no valid children will be trimmed. The @a@ values in the forest must all
 * be distinct. The texts are the node name and optional node tooltip.
 *
 * For the moment the forest is computed only on widget creation and is not updated when the
 * environment changes.
 */
export function treeSelector<E = any, W = any, A = any>(
  f: (e: E) => Forest<readonly [T.Text, Maybe<T.Text>, Maybe<A>]>,
): Gadget_<E, W, S.Set<A>> {
  return TreeSelector(f);
}

/**
 * Present a list of items in a table. If the "DialogSelector" is present then activating
 * a row will bring up a sub-dialog. This comes with its own scroll box.
 *
 * The contents of the table are treated as a single value, with everything updated on each change.
 * Hence this is only suitable for small lists.
 */
export function table<E = any, W = any, A = any>(
  editing: readonly Tbl.TableEditing<A>[],
  tbl: Tbl.Table<A>,
  sel: Maybe<DialogSelector<E, W, A, A>>,
): Gadget_<E, W, readonly A[]> {
  return Table(editing, tbl, sel);
}

/**
 * Edit a forest of data items using a tree view. Items can be dragged and dropped to reorgainse
 * them, or clicked for individual editing via the menu and dialog selector.
 */
export function forestEditor<E = any, W = any, A = any>(
  /** Text label for a tree item. */
  label: (e: E, a: A) => T.Text,
  /** Edit menu for tree item. */
  menu: (m: Maybe<A>) => Menu<TreeOper<A>>,
  /** Can this item have children? */
  canHaveChildren: (a: A) => boolean,
  /** Activation pops up an edit dialog. */
  sel: Maybe<DialogSelector<E, W, A, A>>,
): Gadget_<E, W, Forest<A>> {
  return ForestEditor(label, menu, canHaveChildren, sel);
}

/** A file selector, with a text box that pops up a native file selector dialog when clicked. */
export function filePathSelector<E = any, W = any>(
  /** Title for the selector dialog. */
  title: T.Text,
  purpose: FilePathPurpose,
  filters: readonly FilePathFilter[],
  /** Display an overwrite confirmation dialog when an existing file is selected. */
  confirm: boolean,
): Gadget_<E, W, string> {
  return FilePathSelector(title, purpose, filters, confirm);
}

// ---------------------------------------------------------------------------------------------
// * Pop-up Dialogs

/** Text box with read-only contents. Clicking the text will pop up a dialog for the contents. */
export function textPopup<E = any, W = any, A = any>(f: (e: E, a: A) => T.Text, sel: DialogSelector<E, W, A, A>): Gadget_<E, W, A> {
  return FixedText(f, Just(sel));
}

/**
 * Buttons that modify the data in some way. This passes the input to the output unchanged
 * unless a button is pressed, in which case the output is the relevant function applied to the
 * input.
 */
export function buttonBar<E = any, W = any, A = any>(bs: readonly (readonly [T.Text, (a: A) => A])[]): GadgetF_<E, W, A> {
  return ButtonBar(bs);
}

/**
 * Perform an IO action when the button is clicked. If the action fails then a message box
 * will be displayed with an internal error and @Nothing@ will be returned. The output is @Nothinng@
 * until the button is pressed.
 *
 * TypeScript: the action may be asynchronous (return a `Promise`).
 */
export function buttonIO<E = any, W = any, I = any, O = any>(
  label: T.Text,
  act: (e: E, i: I) => O | Promise<O>,
): Gadget<E, W, I, Maybe<O>> {
  return ButtonIO(label, act);
}

/** Display a fixed image. Returns click coordinates. */
export function image<E = any, W = any>(path: string): Gadget_<E, W, [number, number]> {
  return Image(path);
}

/** Read-only text field. */
export function readOnlyText<E = any, W = any, A = any>(f: (e: E, a: A) => T.Text): Gadget_<E, W, A> {
  return FixedText(f, Nothing);
}

/** Multi-line text. Clicking it will pop up a dialog for the contents. */
export function memoPopup<E = any, W = any, A = any>(
  size: MemoBoxSize,
  expand: boolean,
  f: (e: E, a: A) => T.Text,
  sel: DialogSelector<E, W, A, A>,
): Gadget_<E, W, A> {
  return FixedMemo(size, expand, f, Just(sel));
}

/** Memo box with read-only contents. */
export function readOnlyMemo<E = any, W = any, A = any>(size: MemoBoxSize, expand: boolean, f: (e: E, a: A) => T.Text): Gadget_<E, W, A> {
  return FixedMemo(size, expand, f, Nothing);
}

// ---------------------------------------------------------------------------------------------
// GTK Icon Utilities

/**
 * True if the string is a member of the standard icon contexts. This is an embarassing bit of
 * GTK-specific code which is needed to implement application-specific icon dialogs.
 */
export function isStandardContext(t: T.Text): boolean {
  return gtkIconStandardContexts.includes(t);
}

/**
 * A convenience list of all the standard icon contexts provided by GTK. Useful to prevent
 * all the application icons from being shown in the icon selection dialog.
 */
export const gtkIconStandardContexts: readonly T.Text[] = [
  "Actions",
  "Animations",
  "Applications",
  "Categories",
  "Devices",
  "Emblems",
  "Emotes",
  "FileSystems",
  "International",
  "Legacy",
  "MimeTypes",
  "Places",
  "Status",
  "Stock",
  "UI",
];

// ---------------------------------------------------------------------------------------------
// * Debugging

/** Debug rendering used where Haskell uses a derived `Show` instance. */
function showAny(x: unknown): string {
  if (typeof x === "function") return "<function>";
  try {
    const s = JSON.stringify(x);
    return s === undefined ? String(x) : s;
  } catch {
    return String(x);
  }
}

/**
 * Print the input and output values to StdErr.
 *
 * TypeScript: the `Show` instances are optional arguments (default: a JSON rendering).
 */
export function traceGadget<E, W, I, O>(
  str: string,
  g: Gadget<E, W, I, O>,
  showI: (i: I) => string = showAny,
  showO: (o: O) => string = showAny,
): Gadget<E, W, I, O> {
  return Trace(str, showI, (_i: I, o: O) => showO(o), g);
}

/**
 * Print the input and output to StdErr, with the output function applied to the latest input.
 *
 * TypeScript: the `Show` instances are optional arguments (default: a JSON rendering).
 */
export function traceGadgetOver<E, W, I, O>(
  str: string,
  g: GadgetF<E, W, I, O>,
  showI: (i: I) => string = showAny,
  showO: (o: O) => string = showAny,
): GadgetF<E, W, I, O> {
  return Trace(str, showI, (i: I, f: (i: I) => O) => showO(f(i)), g);
}

/** Generalised tracing: provide your own functions to display the input and output. */
export function traceGadget1<E, W, I, O>(
  str: string,
  showI: (i: I) => string,
  showO: (i: I, o: O) => string,
  g: Gadget<E, W, I, O>,
): Gadget<E, W, I, O> {
  return Trace(str, showI, showO, g);
}
