// Ported from banana-ui/gtk/src/Reactive/Banana/GI/Common.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Common GTK-based functions for tables and dialogs.
 *
 * TypeScript port
 * ---------------
 * * `MonadIO m` and `MomentIO` actions are synchronous functions.
 * * A Haskell `Maybe` of a GTK object (`Maybe Gtk.Window`, `Maybe Gdk.Pixbuf`, the `Maybe w`
 *   widget argument of `plainChanges`) is `X | null`, as in the toolkit. Other `Maybe`s
 *   (`Maybe Colour`) are explicit `Maybe` values.
 * * `iconDialog` builds its own event network, as in the Haskell (`mdo`: the network is
 *   referenced from inside its own definition to pause it).
 * * `withWaitCursor` also accepts an action returning a Promise; the cursor is restored when it
 *   settles.
 * * `widgetLinkColour`: only canvas widgets emit `draw` in the browser, so the colour of other
 *   widgets is applied as inline CSS whenever it changes (see `// Web:` below). The
 *   `hades-transparent-dark`/`-light` classes are defined in `Common.css`.
 */
import "./Common.css";
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, catMaybes, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { getCurrentTime, toGregorian, utctDay, type Day } from "@/lib/Data/Time";
import { Node, type Forest, type Tree } from "@/lib/Data/Tree";
import { preview, type Prism } from "@/lib/Control/Lens";
import { newIORef, readIORef, writeIORef } from "@/lib/Prelude";
import { getDataFileName } from "@/lib/System/Paths";
import {
  Colour, colourPrism, getColour, noIconName, reactimate1, reactimate1_, type Changes,
} from "@/banana-ui/base/Reactive/Banana/Common";
import { registerIOSignal1 } from "./Connect";

/**
 * Put a calendar icon at the end of the field and create a Calendar widget in a popover. The
 * popover is attached to the Entry widget.
 */
export function createDatePopover(prsm: Prism<T.Text, Day>, entry: Gtk.Entry): [Gtk.Popover, Gtk.Calendar] {
  Gtk.entrySetIconFromIconName(
    entry,
    Gtk.EntryIconPositionSecondary,
    "x-office-calendar-symbolic",
  );
  const calendar = Gtk.calendarNew();
  const overlay = Gtk.popoverNew(entry);
  Gtk.containerAdd(overlay, calendar);
  Gtk.widgetShow(calendar);
  const today = utctDay(getCurrentTime());
  const str = Gtk.entryGetText(entry);
  const [year, month, day] = toGregorian(fromMaybe(today, preview(prsm, str)));
  Gtk.calendarSelectMonth(calendar, month - 1, year);
  Gtk.calendarSelectDay(calendar, day);
  Gtk.onEntryIconPress(entry, (_pos, _ev) => Gtk.popoverPopup(overlay));
  return [overlay, calendar];
}

/**
 * Put a colour icon at the end of the field and create a colour chooser widget in a popover. The
 * popover is attached to the Entry widget.
 */
export function createColorDialog(entry: Gtk.Entry): Gtk.ColorChooserDialog {
  Gtk.entrySetIconFromIconName(
    entry,
    Gtk.EntryIconPositionSecondary,
    "applications-science",
  );
  const parent = widgetWindow(entry);
  const chooser = Gtk.colorChooserDialogNew(null, parent);
  const str = Gtk.entryGetText(entry);
  const colour = fromMaybe(Colour(C.white), preview(colourPrism, str));
  const bg = colourToRGBA(colour);
  Gtk.colorChooserSetRgba(chooser, bg);
  return chooser;
}

/** White for dark colours, black for bright or pale colours. */
export function contrastText(c: Colour): Colour {
  return Colour(C.luminance(getColour(c)) > 0.5 ? C.black : C.white);
}

/** Opaque representation of a colour for GTK. */
export function colourToRGBA(colour: Colour): Gdk.RGBA {
  const { channelRed: r, channelGreen: g, channelBlue: b } = C.toSRGB(getColour(colour));
  return { alpha: 1.0, red: r, green: g, blue: b };
}

/** Extract the Colour component of an RGBA (i.e. ignoring transparency). */
export function rgbaToColour(rgba: Gdk.RGBA): Colour {
  return Colour(C.sRGB(Gdk.getRGBARed(rgba), Gdk.getRGBAGreen(rgba), Gdk.getRGBABlue(rgba)));
}

/** Data about an icon. */
export interface IconData {
  /** The name of the icon. */
  readonly iconName: T.Text;
  /** The image for the icon. */
  readonly iconPixbuf: Gdk.Pixbuf;
}
export function IconData(iconName: T.Text, iconPixbuf: Gdk.Pixbuf): IconData {
  return { iconName, iconPixbuf };
}

/**
 * Load a named icon at "Gtk.IconSizeButton" or a broken icon if the icon is not found. The
 * size is in pixels.
 *
 * "Gtk.iconThemeLoadIcon" throws an error instead of returning "Nothing", so this checks first.
 */
export function safeLoadIcon(theme: Gtk.IconTheme, name: T.Text, sz: number): Gdk.Pixbuf | null {
  const failIcon = (): Gdk.Pixbuf | null => {
    const i = Gtk.imageNewFromIconName(null, Gtk.IconSizeButton);
    return Gtk.imageGetPixbuf(i);
  };
  if (Gtk.iconThemeHasIcon(theme, name)) {
    const icon1 = loadIconOrNull(theme, name, sz, []);
    const f = failIcon();
    return icon1 ?? f;
  }
  return failIcon();
}

/** `Gtk.iconThemeLoadIcon` with gi-gtk's nullable result (the toolkit version throws). */
function loadIconOrNull(theme: Gtk.IconTheme, name: T.Text, sz: number, flags: unknown): Gdk.Pixbuf | null {
  try {
    return Gtk.iconThemeLoadIcon(theme, name, sz, flags);
  } catch {
    return null;
  }
}

/**
 * Extract a tree of icon names from the theme. The result is a list of pairs, one for
 * each context, with the context name and a list of the icons in that context.
 *
 * @param flag If true, then include \"no-icon\" icon at start of each context.
 * @param predicate Filter for context names.
 */
export function iconThemeContents(
  theme: Gtk.IconTheme,
  flag: boolean,
  predicate: (t: T.Text) => boolean,
): [T.Text, IconData[]][] {
  const ctxs = L.sort(Gtk.iconThemeListContexts(theme).filter(predicate));
  return ctxs.map((ctx): [T.Text, IconData[]] => {
    const iconNames = L.sort(Gtk.iconThemeListIcons(theme, ctx));
    const iconNames1 = flag ? [noIconName, ...iconNames] : iconNames;
    const icons = iconNames1.map((nm): Maybe<IconData> => {
      // Web: a missing icon gives Nothing rather than a GError.
      const pb = loadIconOrNull(theme, nm, 48, [Gtk.IconLookupFlagsForceSize]);
      return pb === null ? Nothing : Just(IconData(nm, pb));
    });
    return [ctx, catMaybes(icons)];
  });
}

/** A table of icons for the user to pick one. The event carries the selected icon name. */
export function iconListWidget(icons: readonly IconData[]): [Gtk.ScrolledWindow, B.Event<T.Text>] {
  const store = Gtk.seqStoreNew(icons);
  Gtk.customStoreSetColumn(store, Gtk.makeColumnIdString<IconData>(0), (d) => d.iconName);
  Gtk.customStoreSetColumn(store, Gtk.makeColumnIdPixbuf<IconData>(1), (d) => d.iconPixbuf);
  const vw = Gtk.new_(Gtk.IconView, { model: store, pixbufColumn: 1, selectionMode: Gtk.SelectionModeBrowse });
  const scrolled = Gtk.new_(Gtk.ScrolledWindow, { minContentHeight: 800 });
  Gtk.containerAdd(scrolled, vw);
  const [ev, handleE] = B.newEvent<T.Text>();
  Gtk.onIconViewItemActivated(vw, (path) => {
    const ix = Gtk.treePathGetIndices(path);
    if (ix !== null && ix.length > 0) {
      const v = Gtk.seqStoreGetValue(store, ix[0]);
      handleE(v.iconName);
    }
  });
  return [scrolled, ev];
}

/** A notebook with one tab for each icon context. The event carries the selected icon name. */
export function iconTabsWidget(ctxs: readonly (readonly [T.Text, readonly IconData[]])[]): [Gtk.Notebook, B.Event<T.Text>] {
  const book = Gtk.notebookNew();
  Gtk.notebookSetScrollable(book, true);
  Gtk.notebookPopupEnable(book);
  const events = ctxs.map(([ctx, icons]) => {
    const [page, event] = iconListWidget(icons);
    Gtk.notebookAppendPage(book, page, null);
    Gtk.notebookSetTabLabelText(book, page, ctx);
    return event;
  });
  return [book, L.foldr((e: B.Event<T.Text>, acc: B.Event<T.Text>) => B.unionWith((x: T.Text, _y: T.Text) => x, e, acc), B.never<T.Text>(), events)];
}

/**
 * A popup dialog which returns when the first icon is selected. Last argument is an IO
 * continuation to process the result. This is used to avoid race conditions.
 */
export function iconDialog(
  parent: Gtk.Widget,
  ctxs: readonly (readonly [T.Text, readonly IconData[]])[],
  cont: (t: T.Text) => void,
): void {
  const dialog = Gtk.new_(Gtk.Window, { title: "Icon Selection", modal: true });
  Gtk.windowSetTransientFor(dialog, Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(parent)));
  Gtk.windowSetDefaultSize(dialog, 800, -1);
  // mdo: `net` is used inside its own definition.
  const net: B.EventNetwork = B.compile(() => withWaitCursor(parent, () => {
    const [widget, event] = iconTabsWidget(ctxs);
    Gtk.widgetShowAll(widget);
    Gtk.containerAdd(dialog, widget);
    B.reactimate(B.mapE((str: T.Text) => () => { // Within local net, so no need to cancel it.
      cont(str);
      Gtk.widgetDestroy(dialog);
      B.pause(net);
    }, event));
    Gtk.widgetShowAll(dialog);
  }));
  B.actuate(net);
}

/**
 * Execute an IO action with a \"wait\" cursor.
 *
 * TypeScript: if the action returns a Promise the cursor is restored when it settles.
 */
export function withWaitCursor<A>(widget: Gtk.Widget, action: () => A): A {
  const topWidget = Gtk.widgetGetToplevel(widget);
  const mGdkWin = Gtk.widgetGetWindow(topWidget);
  if (mGdkWin !== null) {
    const display = Gdk.windowGetDisplay(mGdkWin);
    const busy = Gdk.cursorNewForDisplay(display, Gdk.CursorTypeWatch);
    Gdk.windowSetCursor(mGdkWin, busy);
  }
  const restore = (): void => {
    if (mGdkWin !== null) Gdk.windowSetCursor(mGdkWin, null);
  };
  let result: A;
  try {
    result = action();
  } catch (err) {
    restore();
    throw err;
  }
  if (result instanceof Promise) return result.finally(restore) as A;
  restore();
  return result;
}

/** Try to get the window that contains the widget. */
export function widgetWindow(w: Gtk.Widget): Gtk.Window | null {
  const topWidget = Gtk.widgetGetToplevel(w);
  return Gtk.castTo(Gtk.Window, topWidget);
}

/** Are these two references actually pointing to the same widget? */
export function sameWidget(w1: Gtk.Widget, w2: Gtk.Widget): boolean {
  return w1 === w2;
}

/** The tree of widgets underneath the argument. */
export function widgetTree(widget1: Gtk.Widget): Tree<Gtk.Widget> {
  const widget2 = Gtk.toWidget(widget1);
  return Node(widget2, widgetForest(widget2));
}

/** The children of the argument as a forest of widgets. */
export function widgetForest(widget1: Gtk.Widget): Forest<Gtk.Widget> {
  const c = Gtk.castTo(Gtk.Container, widget1);
  if (c === null) return [];
  const childs = Gtk.containerGetChildren(c);
  return childs.map(widgetTree);
}

/**
 * Have the widget background colour follow a behavior. Foreground is either white or black
 * for contrast. If the behavior is @Nothing@ then the widget is drawn normally.
 *
 * The colour is implemented using transparency. The style file should include
 * @hades-transparent-dark@ and @hades-transparent-light@ classes that set the background to
 * transparent.
 */
export function widgetLinkColour(
  widget: Gtk.Widget,
  colourInit: Maybe<Colour>,
  colourE: B.Event<Maybe<Colour>>,
  colourB: B.Behavior<Maybe<Colour>>,
): void {
  const lightClass = "hades-transparent-light";
  const darkClass = "hades-transparent-dark";
  const customPaint = (mc: Maybe<Colour>, ctx: Cairo.Context): void => {
    if (mc.tag === "Nothing") {
      const style = Gtk.widgetGetStyleContext(widget);
      for (const cls of [lightClass, darkClass]) Gtk.styleContextRemoveClass(style, cls);
      return;
    }
    const c = mc.value;
    const w = Gtk.widgetGetAllocatedWidth(widget);
    const h = Gtk.widgetGetAllocatedHeight(widget);
    const style = Gtk.widgetGetStyleContext(widget);
    for (const cls of [lightClass, darkClass]) Gtk.styleContextRemoveClass(style, cls);
    Gtk.styleContextAddClass(style, C.luminance(getColour(c)) > 0.5 ? lightClass : darkClass);
    Cairo.renderWithContext((cr) => {
      const { channelRed: r1, channelGreen: g1, channelBlue: b1 } = C.toSRGB(getColour(c));
      Cairo.setSourceRGB(cr, r1, g1, b1);
      Cairo.rectangle(cr, 0, 0, w, h);
      Cairo.fill(cr);
    }, ctx);
  };
  // Web: widgets other than drawing areas do not emit "draw", so the colour is also applied as
  // inline CSS (background and contrasting text) whenever it changes.
  const webPaint = (mc: Maybe<Colour>): void => {
    const style = Gtk.widgetGetStyleContext(widget);
    for (const cls of [lightClass, darkClass]) Gtk.styleContextRemoveClass(style, cls);
    const { backgroundColor: _bg, color: _fg, ...rest } = widget.style;
    if (mc.tag === "Nothing") {
      widget.style = rest;
    } else {
      const c = mc.value;
      Gtk.styleContextAddClass(style, C.luminance(getColour(c)) > 0.5 ? lightClass : darkClass);
      widget.style = { ...rest, backgroundColor: C.toCss(getColour(c)), color: C.toCss(getColour(contrastText(c))) };
    }
    widget.changed();
  };
  const colourE1 = plainChanges(widget, colourB);
  const colourB1 = B.stepper(colourInit, B.unionWith((x: Maybe<Colour>, _y: Maybe<Colour>) => x, colourE, colourE1));
  const drawContext = registerIOSignal1(widget, Gtk.onWidgetDraw, (ctx: Cairo.Context) => [false, ctx]);
  const stop1 = reactimate1(B.apply(B.mapB((mc: Maybe<Colour>) => (ctx: Cairo.Context) => () => customPaint(mc, ctx), colourB1), drawContext));
  webPaint(colourInit);
  const colourChanges = B.changes(B.mapB((mc: Maybe<Colour>) => () => {
    webPaint(mc);
    Gtk.widgetQueueDraw(widget);
  }, colourB1));
  const stop2 = reactimate1_(colourChanges);
  Gtk.onWidgetDestroy(widget, () => {
    stop1();
    stop2();
  });
}

/** Debugging routine. */
export function objectDescription(w: Gtk.Widget): string {
  const typ = T.unpack(Gtk.widgetGetName(w));
  // Web: the object id stands in for the foreign pointer.
  const ptr = "0x" + w.objectId.toString(16).padStart(16, "0");
  return typ + "(" + ptr + ")";
}

/**
 * Do the action when the input changes unless the widget has focus or it is already in
 * the middle of an update.
 */
export function unlessFocused<A>(w: Gtk.Widget, value: Changes<A>, action: (a: A) => void): void {
  const nugatory = Gtk.widgetInDestruction(w);
  if (nugatory) console.error("Warning: still updating a widget in destruction.");
  const blocker = newIORef(false);
  const stop = reactimate1(B.mapE((v: A) => () => {
    const focused = Gtk.widgetHasFocus(w);
    const b = readIORef(blocker);
    // Block value changes during "setter" because these are probably being triggered by the
    // setter. GTK widgets can trigger arbitrary numbers of events during updates, and these can
    // go infinite if re-entrant calls are permitted.
    if (!(b || focused)) {
      writeIORef(blocker, true);
      action(v);
      writeIORef(blocker, false);
    }
  }, value.changesE));
  Gtk.onWidgetDestroy(w, stop);
}

/**
 * This is based on the function in the Reactive Banana documentation, but also takes a widget
 * argument. When the widget is destroyed the output event will stop.
 */
export function plainChanges<A>(w: Gtk.Widget | null, b: B.Behavior<A>): B.Event<A> {
  const [e, handle] = B.newEvent<A>();
  const eb = B.changes(b);
  const stop = reactimate1_(B.mapE((f: B.Future<A>) => B.mapFuture((a: A) => () => handle(a), f), eb));
  if (w !== null) Gtk.onWidgetDestroy(w, stop);
  return e;
}

/**
 * The Banana UI GTK CSS file. Pass this to "Gtk.styleContextAddproviderForScreen" with a
 * priority of "Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION".
 *
 * Web: the CSS is already part of the toolkit stylesheet (`theme.css`), so loading is a no-op.
 */
export function bananaCss(): Gtk.CssProvider {
  const r = Gtk.cssProviderNew();
  const p = getDataFileName("banana-ui-gtk", "banana-gtk.css");
  Gtk.cssProviderLoadFromPath(r, T.pack(p));
  return r;
}
