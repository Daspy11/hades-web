// Ported from banana-ui/base/Reactive/Banana/Menu.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Statically defined menus.
 */
import type { Either } from "@/lib/Data/Either";
import { Left, Right } from "@/lib/Data/Either";

/** Menu items are displayed in groups with separators in between. Each sublist is a group. */
export interface Menu<A> {
  readonly _0: readonly (readonly MenuItem<A>[])[];
}
export function Menu<A>(_0: readonly (readonly MenuItem<A>[])[]): Menu<A> {
  return { _0 };
}

/** `instance Functor Menu` */
export function fmap_Menu<A, B>(f: (a: A) => B, m: Menu<A>): Menu<B> {
  return Menu(m._0.map((items) => items.map((i) => fmap_MenuItem(f, i))));
}

/** `instance Semigroup (Menu a)` */
export function append_Menu<A>(m1: Menu<A>, m2: Menu<A>): Menu<A> {
  return Menu([...m1._0, ...m2._0]);
}

/** `instance Monoid (Menu a)` */
export function mempty_Menu<A>(): Menu<A> {
  return Menu<A>([]);
}

/** `mconcat` for menus. */
export function mconcat_Menu<A>(ms: readonly Menu<A>[]): Menu<A> {
  return Menu(ms.flatMap((m) => m._0));
}

/**
 * The selection of a menu item triggers an @Event a@.
 *
 * Use @pure True@ if the item is always enabled.
 */
export interface MenuItem<A> {
  readonly menuLabel: string;
  /** @Left@ for a sub-menu, @Right@ for an item. */
  readonly menuValue: Either<Menu<A>, A>;
}
export function MenuItem<A>(menuLabel: string, menuValue: Either<Menu<A>, A>): MenuItem<A> {
  return { menuLabel, menuValue };
}

/** `instance Functor MenuItem` */
export function fmap_MenuItem<A, B>(f: (a: A) => B, item: MenuItem<A>): MenuItem<B> {
  const v = item.menuValue;
  return MenuItem(item.menuLabel, v.tag === "Left" ? Left(fmap_Menu(f, v.value)) : Right(f(v.value)));
}

/** A single menu item which is always enabled. */
export function menuItem<A>(label: string, v: A): MenuItem<A> {
  return MenuItem<A>(label, Right(v));
}

/** A sub-menu which is always enabled. */
export function subMenu<A>(label: string, sub: Menu<A>): MenuItem<A> {
  return MenuItem<A>(label, Left(sub));
}
