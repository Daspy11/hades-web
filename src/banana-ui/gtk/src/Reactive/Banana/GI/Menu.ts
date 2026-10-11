// Ported from banana-ui/gtk/src/Reactive/Banana/GI/Menu.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Generate GTK menu widgets within the Reactive Banana MomentIO monad.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { firstEvent } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Menu, MenuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { registerIOSignal } from "./Connect";

/**
 * Convert a Reactive Banana menu into a GTK menu. The associated event
 * is triggered by the user clicking on an item in the menu.
 */
export function mkGtkMenu<A>(menu: Menu<A>): [Gtk.Menu, B.Event<A>] {
  const items = menu._0;
  const result = Gtk.menuNew();
  const addSections = items.map((section) => () => addMenuSection(result, section));
  const addSep = (): B.Event<A> => {
    const sep = Gtk.separatorMenuItemNew();
    Gtk.menuShellAppend(result, sep);
    return B.never<A>();
  };
  // `sequence $ intersperse addSep addSections`
  const evs: B.Event<A>[] = [];
  addSections.forEach((addSection, i) => {
    if (i > 0) evs.push(addSep());
    evs.push(addSection());
  });
  Gtk.widgetShowAll(result);
  return [result, firstEvent(evs)];
}

/** Add a section of the menu (between two separators) to the menu. */
function addMenuSection<A>(target: Gtk.Menu, items: readonly MenuItem<A>[]): B.Event<A> {
  return firstEvent(items.map((item) => {
    const [gtkItem, ev] = mkGtkMenuItem(item);
    Gtk.menuShellAppend(target, gtkItem);
    return ev;
  }));
}

/** Convert a Hades @MenuItem@ into a GTK @MenuItem@ */
function mkGtkMenuItem<A>(item: MenuItem<A>): [Gtk.MenuItem, B.Event<A>] {
  const label = item.menuLabel;
  const result = Gtk.menuItemNewWithLabel(label);
  const v = item.menuValue;
  switch (v.tag) {
    case "Left": {
      const [submenu, event] = mkGtkMenu(v.value);
      Gtk.menuItemSetSubmenu(result, submenu);
      return [result, event];
    }
    case "Right": {
      const event = registerIOSignal(result, Gtk.onMenuItemActivate, () => [null, v.value]);
      return [result, event];
    }
  }
}

/** Link an event with the appearance of a menu. */
export function popupMenuOn(e: B.Event<Gtk.Menu>): void {
  B.reactimate(B.mapE((m: Gtk.Menu) => () => Gtk.menuPopupAtPointer(m, null), e));
}
