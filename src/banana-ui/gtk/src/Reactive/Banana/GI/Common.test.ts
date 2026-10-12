// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { flatten } from "@/lib/Data/Tree";
import { datePrism, longDate, makeChanges, noIconName, type Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import {
  colourToRGBA, contrastText, createColorDialog, createDatePopover, iconDialog, iconTabsWidget, iconThemeContents,
  objectDescription, plainChanges, rgbaToColour, safeLoadIcon, sameWidget, unlessFocused, widgetLinkColour,
  widgetTree, widgetWindow, withWaitCursor,
} from "./Common";

describe("colours", () => {
  test("contrastText picks black on pale colours and white on dark ones", () => {
    expect(C.sRGB24show(contrastText(C.sRGB24(255, 255, 200)))).toBe("#000000");
    expect(C.sRGB24show(contrastText(C.sRGB24(20, 20, 120)))).toBe("#ffffff");
  });
  test("RGBA round trip", () => {
    const c = C.sRGB24(18, 52, 86);
    const rgba = colourToRGBA(c);
    expect(rgba.alpha).toBe(1);
    expect(Math.round(rgba.red * 255)).toBe(18);
    expect(C.sRGB24show(rgbaToColour(rgba))).toBe("#123456");
  });
});

describe("widgets", () => {
  test("widgetTree and widgetWindow", () => {
    const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
    const box = Gtk.boxNew(Gtk.OrientationVertical, 0);
    const l1 = Gtk.labelNew("a"), l2 = Gtk.labelNew("b");
    Gtk.boxPackStart(box, l1, false, false, 0);
    Gtk.boxPackStart(box, l2, false, false, 0);
    Gtk.containerAdd(win, box);
    expect(flatten(widgetTree(win))).toEqual([win, box, l1, l2]);
    expect(widgetWindow(l2)).toBe(win);
    expect(widgetWindow(Gtk.labelNew("loose"))).toBe(null);
    expect(sameWidget(l1, l1)).toBe(true);
    expect(sameWidget(l1, l2)).toBe(false);
  });

  test("createDatePopover selects the entry's date", () => {
    const entry = Gtk.entryNew();
    Gtk.entrySetText(entry, "3 January 2018");
    const [pop, cal] = createDatePopover(datePrism(longDate), entry);
    expect(Gtk.calendarGetDate(cal)).toEqual([2018, 0, 3]);
    expect(entry.icons.EntryIconPositionSecondary).toBe("x-office-calendar-symbolic");
    entry.emit("icon-press", Gtk.EntryIconPositionSecondary, null);
    expect(pop.open).toBe(true);
  });

  test("createColorDialog starts from the entry's colour", () => {
    const entry = Gtk.entryNew();
    Gtk.entrySetText(entry, "#ff8000");
    const d = createColorDialog(entry);
    expect(C.sRGB24show(rgbaToColour(Gtk.colorChooserGetRgba(d)))).toBe("#ff8000");
  });

  test("withWaitCursor returns the action's result, also for promises", async () => {
    const l = Gtk.labelNew("x");
    expect(withWaitCursor(l, () => 42)).toBe(42);
    await expect(withWaitCursor(l, () => Promise.resolve("done"))).resolves.toBe("done");
  });
});

describe("icons", () => {
  const theme = Gtk.iconThemeGetDefault();

  /** The first widget of a class in a widget tree. */
  function find<W extends Gtk.Widget>(cls: new (...args: any[]) => W, w: Gtk.Widget): W {
    const ws = flatten(widgetTree(w)).filter((x): x is W => x instanceof cls);
    expect(ws.length).toBeGreaterThan(0);
    return ws[0];
  }

  test("safeLoadIcon loads known icons and gives Nothing for unknown ones", () => {
    const pb = safeLoadIcon(theme, "document-open", 22);
    expect(pb.tag).toBe("Just");
    expect(pb.tag === "Just" && pb.value.width).toBe(22);
    expect(safeLoadIcon(theme, "no-such-icon-anywhere", 22)).toEqual(Nothing);
  });

  test("iconThemeContents lists sorted, filtered contexts, optionally led by the no-icon icon", () => {
    const all = iconThemeContents(theme, false, () => true);
    const names = all.map(([c]) => c);
    expect(names.length).toBeGreaterThan(1);
    expect(names).toEqual([...names].sort());
    for (const [, icons] of all) {
      const ns = icons.map((i) => i.iconName);
      expect(ns).toEqual([...ns].sort());
    }
    const withNone = iconThemeContents(theme, true, (c) => c === names[0]);
    expect(withNone.map(([c]) => c)).toEqual([names[0]]);
    expect(withNone[0][1][0].iconName).toBe(noIconName);
    expect(withNone[0][1].slice(1).map((i) => i.iconName)).toEqual(all[0][1].map((i) => i.iconName));
    expect(withNone[0][1][0].iconPixbuf.width).toBe(48);
  });

  test("iconTabsWidget has a page per context; activating an icon fires its name", () => {
    const ctxs = iconThemeContents(theme, false, () => true).slice(0, 2);
    const seen: string[] = [];
    const [book, ev] = B.liftMomentIO(() => iconTabsWidget(ctxs));
    B.subscribeE(ev, (n) => seen.push(n));
    expect(Gtk.notebookGetNPages(book)).toBe(2);
    const page1 = Gtk.notebookGetNthPage(book, 1)!;
    expect(Gtk.labelGetText(Gtk.notebookGetTabLabel(book, page1) as Gtk.Label)).toBe(ctxs[1][0]);
    const vw = find(Gtk.IconView, page1);
    expect(vw.pixbufColumn).toBe(1);
    vw.emit("item-activated", Gtk.treePathNewFromString("1"));
    expect(seen).toEqual([ctxs[1][1][1].iconName]);
  });

  test("iconDialog calls the continuation with the chosen icon and closes", () => {
    const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
    const btn = Gtk.buttonNewWithLabel("x");
    Gtk.containerAdd(win, btn);
    const ctxs = iconThemeContents(theme, true, () => true).slice(0, 1);
    const chosen: string[] = [];
    iconDialog(btn, ctxs, (t) => chosen.push(t));
    const dialog = Gtk.toplevels.list().find((w): w is Gtk.Window =>
      w instanceof Gtk.Window && w.title === "Icon Selection" && !w.destroyed)!;
    expect(dialog).toBeDefined();
    expect(dialog.modal).toBe(true);
    expect(dialog.transientFor).toBe(win);
    find(Gtk.IconView, dialog).emit("item-activated", Gtk.treePathNewFromString("0"));
    expect(chosen).toEqual([noIconName]);
    expect(dialog.destroyed).toBe(true);
  });

  test("objectDescription gives the widget name (by default its type name) and an address", () => {
    const l = Gtk.labelNew("x");
    expect(objectDescription(l)).toMatch(/^GtkLabel\(0x[0-9a-f]{16}\)$/);
    Gtk.widgetSetName(l, "status");
    expect(objectDescription(l)).toMatch(/^status\(0x[0-9a-f]{16}\)$/);
  });
});

describe("FRP links", () => {
  test("plainChanges fires after the behavior changes and stops when the widget is destroyed", async () => {
    const w = Gtk.labelNew("x");
    const [e, fire] = B.newEvent<number>();
    const seen: number[] = [];
    B.liftMomentIO(() => {
      const b = B.stepper(0, e);
      B.reactimate(B.mapE((v: number) => () => seen.push(v), plainChanges(w, b)));
    });
    fire(1);
    fire(2);
    expect(seen).toEqual([1, 2]);
    Gtk.widgetDestroy(w);
    await new Promise((r) => setTimeout(r, 0));
    fire(3);
    expect(seen).toEqual([1, 2]);
  });

  test("unlessFocused runs the action when the widget is not focused", () => {
    const w = Gtk.labelNew("x");
    const [e, fire] = B.newEvent<string>();
    B.liftMomentIO(() => unlessFocused(w, makeChanges("", e), (v) => Gtk.labelSetText(w, v)));
    fire("new");
    expect(Gtk.labelGetText(w)).toBe("new");
  });

  test("widgetLinkColour colours the widget and follows changes", () => {
    const entry = Gtk.entryNew();
    const [e, fire] = B.newEvent<Maybe<Colour>>();
    B.liftMomentIO(() => {
      const b = B.stepper<Maybe<Colour>>(Just(C.sRGB24(0, 0, 0)), e);
      widgetLinkColour(entry, Just(C.sRGB24(0, 0, 0)), B.never(), b);
    });
    expect(entry.style.backgroundColor).toBeDefined();
    expect(Gtk.styleContextHasClass(entry, "hades-transparent-dark")).toBe(true);
    fire(Just(C.sRGB24(255, 255, 255)));
    expect(Gtk.styleContextHasClass(entry, "hades-transparent-light")).toBe(true);
    expect(Gtk.styleContextHasClass(entry, "hades-transparent-dark")).toBe(false);
    fire(Nothing);
    expect(entry.style.backgroundColor).toBeUndefined();
    expect(Gtk.styleContextHasClass(entry, "hades-transparent-light")).toBe(false);
  });
});
