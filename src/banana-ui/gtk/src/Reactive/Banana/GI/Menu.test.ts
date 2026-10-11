// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { Menu, menuItem, subMenu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { mkGtkMenu, popupMenuOn } from "./Menu";

describe("mkGtkMenu", () => {
  const menu = Menu<string>([
    [menuItem("One", "1"), menuItem("Two", "2")],
    [subMenu("More", Menu([[menuItem("Three", "3")]]))],
  ]);

  test("builds the items with separators between sections", () => {
    const [gtkMenu] = B.liftMomentIO(() => mkGtkMenu(menu));
    const kids = gtkMenu.children;
    expect(kids.map((k) => k.kind)).toEqual(["menuItem", "menuItem", "separatorMenuItem", "menuItem"]);
    expect((kids[0] as Gtk.MenuItem).label).toBe("One");
    const more = kids[3] as Gtk.MenuItem;
    expect(more.label).toBe("More");
    expect(more.submenu?.children.map((k) => (k as Gtk.MenuItem).label)).toEqual(["Three"]);
  });

  test("activating an item fires the event with its value, including sub-menu items", () => {
    const seen: string[] = [];
    const [gtkMenu, ev] = B.liftMomentIO(() => mkGtkMenu(menu));
    B.subscribeE(ev, (v) => seen.push(v));
    (gtkMenu.children[1] as Gtk.MenuItem).activate();
    const more = gtkMenu.children[3] as Gtk.MenuItem;
    (more.submenu!.children[0] as Gtk.MenuItem).activate();
    (gtkMenu.children[0] as Gtk.MenuItem).activate();
    expect(seen).toEqual(["2", "3", "1"]);
  });

  test("an empty menu never fires", () => {
    const [gtkMenu, ev] = B.liftMomentIO(() => mkGtkMenu(Menu<number>([])));
    expect(gtkMenu.children.length).toBe(0);
    expect(ev).toBe(B.never());
  });
});

describe("popupMenuOn", () => {
  test("pops the menu up when the event fires", () => {
    const [gtkMenu] = B.liftMomentIO(() => mkGtkMenu(Menu([[menuItem("A", 1)]])));
    const [e, fire] = B.newEvent<Gtk.Menu>();
    B.liftMomentIO(() => popupMenuOn(e));
    expect(gtkMenu.open).toBe(false);
    fire(gtkMenu);
    expect(gtkMenu.open).toBe(true);
  });
});
