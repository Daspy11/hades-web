// Ported from banana-ui/base/Reactive/Banana/Table.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * A dialog table is a rectangular grid where each row represents a value in a list and each
 * column represents a field in the row values.
 *
 * Tables are updated via the 'RowChange' type. This allows displays to be updated more efficiently
 * than if the only thing known was that something in the table had changed.
 *
 * TypeScript port
 * ---------------
 * The `FieldEditor` GADT is a tagged union; existentially quantified types are `any`. The
 * nullary constructors `EditBool`, `EditNote` and `EditColour` are constants. Functions with
 * `Show`/`Bounded`/`Enum` constraints take the show function or the list of values explicitly.
 */
import type { Maybe } from "@/lib/Data/Maybe";
import type { Day } from "@/lib/Data/Time";
import type { Prism, Traversal } from "@/lib/Control/Lens";
import * as T from "@/lib/Data/Text";
import type { Colour, DateFormat } from "./Common";

/** Ways in which column data may be displayed. */
export type FieldEditor<A> =
  | { readonly tag: "EditBool" }
  /** Edit the column as text. Only entries with a valid read will be accepted. */
  | { readonly tag: "EditEntry"; readonly _0: Prism<T.Text, A> }
  /** Edit a multi-line text. */
  | { readonly tag: "EditNote" }
  /** Select column value from a built-in type. */
  | { readonly tag: "EditEnum"; readonly _0: (a: A) => T.Text; readonly _1: readonly A[] }
  /** Column represents a date. */
  | { readonly tag: "EditDate"; readonly _0: DateFormat }
  /** Column represents a colour. */
  | { readonly tag: "EditColour" }
  /**
   * Column contains an icon identified by its name. The function argument is a predicate to
   * filter the icon context names so only some context tabs are displayed in the dialog.
   */
  | { readonly tag: "EditIcon"; readonly _0: (t: T.Text) => boolean }
  /** Select the column value from a menu of text strings provided by the user. */
  | { readonly tag: "EditCombo"; readonly _0: readonly T.Text[] }
  /** Display a read-only column. */
  | { readonly tag: "EditFixed"; readonly _0: (a: A) => T.Text }
  /**
   * The argument field is optional and may be left blank. Nested "Opt" is not
   * supported.
   */
  | { readonly tag: "Opt"; readonly _0: FieldEditor<any> };

/** `EditBool :: FieldEditor Bool` */
export const EditBool: FieldEditor<boolean> = { tag: "EditBool" };

/** Edit the column as text. Only entries with a valid read will be accepted. */
export function EditEntry<A>(_0: Prism<T.Text, A>): FieldEditor<A> {
  return { tag: "EditEntry", _0 };
}

/** Edit a multi-line text. */
export const EditNote: FieldEditor<T.Text> = { tag: "EditNote" };

/** Select column value from a built-in type. (The Haskell `Ord a` constraint is structural.) */
export function EditEnum<A>(_0: (a: A) => T.Text, _1: readonly A[]): FieldEditor<A> {
  return { tag: "EditEnum", _0, _1 };
}

/** Column represents a date. */
export function EditDate(_0: DateFormat): FieldEditor<Day> {
  return { tag: "EditDate", _0 };
}

/** Column represents a colour. */
export const EditColour: FieldEditor<Colour> = { tag: "EditColour" };

/**
 * Column contains an icon identified by its name. The function argument is a predicate to
 * filter the icon context names so only some context tabs are displayed in the dialog.
 */
export function EditIcon(_0: (t: T.Text) => boolean): FieldEditor<T.Text> {
  return { tag: "EditIcon", _0 };
}

/** Select the column value from a menu of text strings provided by the user. */
export function EditCombo(_0: readonly T.Text[]): FieldEditor<T.Text> {
  return { tag: "EditCombo", _0 };
}

/** Display a read-only column. */
export function EditFixed<A>(_0: (a: A) => T.Text): FieldEditor<A> {
  return { tag: "EditFixed", _0 };
}

/**
 * The argument field is optional and may be left blank. Nested "Opt" is not
 * supported.
 */
export function Opt<A>(_0: FieldEditor<A>): FieldEditor<Maybe<A>> {
  return { tag: "Opt", _0 };
}

/**
 * Utiltity for enumerations with a "Show" instance.
 *
 * The `Show` instance is passed as the optional `show` argument; the default (`String`) is the
 * `show` of an enumeration represented by its constructor names.
 */
export function enumField<A>(values: readonly A[], show: (a: A) => string = String): FieldEditor<A> {
  return EditEnum((a: A) => T.pack(show(a)), values);
}

/**
 * The list of values from @minBound@ to @maxBound@.
 *
 * The `Bounded`/`Enum` dictionary is the list of all values of the type in constructor order
 * (the `<type>Values` array of an enumeration, e.g. `memoBoxSizeValues`).
 */
export function allValues<A>(values: readonly A[]): A[] {
  return values.slice();
}

/** A field of type @a@ within a table of type @row@. */
export interface TableField<Row, A> {
  readonly columnName: T.Text;
  readonly fieldValue: Traversal<Row, A>;
  /** Icon name. */
  readonly fieldIcon: Maybe<(a: A) => T.Text>;
  readonly fieldEditor: FieldEditor<A>;
  readonly fieldColour: Maybe<(a: A) => Colour>;
}
export function TableField<Row, A>(
  columnName: T.Text,
  fieldValue: Traversal<Row, A>,
  fieldIcon: Maybe<(a: A) => T.Text>,
  fieldEditor: FieldEditor<A>,
  fieldColour: Maybe<(a: A) => Colour>,
): TableField<Row, A> {
  return { columnName, fieldValue, fieldIcon, fieldEditor, fieldColour };
}

/** Data for a table column. (`forall a . TableColumn (TableField row a)`) */
export interface TableColumn<Row> {
  readonly _0: TableField<Row, any>;
}
export function TableColumn<Row, A>(_0: TableField<Row, A>): TableColumn<Row> {
  return { _0 };
}

/** Convenience function for constructing a @TableColumn@. */
export function mkField<Row, A>(
  txt: T.Text,
  lns: Traversal<Row, A>,
  /** Icon name */
  icon: Maybe<(a: A) => T.Text>,
  ed: FieldEditor<A>,
  /** Colour */
  clr: Maybe<(a: A) => Colour>,
): TableColumn<Row> {
  return TableColumn(TableField(txt, lns, icon, ed, clr));
}

export type Table<Row> = readonly TableColumn<Row>[];

/** How can this table be edited? */
export type TableEditing<A> =
  | { readonly tag: "TableAdd"; readonly _0: T.Text; readonly _1: A }
  | { readonly tag: "TableDelete" }
  | { readonly tag: "TableShuffle" };

export function TableAdd<A>(_0: T.Text, _1: A): TableEditing<A> {
  return { tag: "TableAdd", _0, _1 };
}
export const TableDelete: TableEditing<never> = { tag: "TableDelete" };
export const TableShuffle: TableEditing<never> = { tag: "TableShuffle" };
