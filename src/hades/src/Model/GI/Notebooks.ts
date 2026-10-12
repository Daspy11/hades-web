// Ported from hades/src/Model/GI/Notebooks.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Manage a binary tree of Gtk Paned widgets with Notebooks at the leaves.
 *
 * TypeScript port
 * ---------------
 * * `IO` actions are synchronous functions; `MomentIO` (`newBookManager`) is a synchronous
 *   network-building function (call it inside `B.compile` / `B.liftMomentIO`).
 * * `IORef (Maybe Gtk.Widget)` is `IORef<Maybe<Gtk.Widget>>` (explicit `Maybe`, as all data);
 *   gi-gtk results typed `Maybe Widget` are `Widget | null` (toolkit convention).
 * * A `Handler a` is `B.Handler<A>` (`(a: A) => void`). `Event ()` is `B.Event<null>`.
 * * `ModelScript p v v (Maybe Text)` values are first-class scripts, `ModelScriptAct<P, V, V, Maybe<string>>`.
 * * `splitBook`, `mergeBook`, `newHadesBook` and `hadesGroup` are internal in Haskell; they are
 *   exported here for the tests.
 * * Tabs are moved between notebooks of the same group (`hadesGroup`) by HTML5 drag and drop
 *   on the tab strip (see the toolkit's notebook renderer); within a notebook, dropping a
 *   detachable tab reorders it, as GTK does.
 */
import * as Gtk from "@/lib/GI/Gtk";
import type * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as L from "@/lib/Data/List";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { newIORef, readIORef, writeIORef, type IORef } from "@/lib/Prelude";
import type { BoundBox, Scale } from "@/hades/src/Hades/Abstract";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { EntityWrapper, ModelScriptAct } from "@/hades/src/Model/Abstract/DiagramType";
import { sameWidget } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Common";

export { sameWidget };

/**
 * Diagrams are exported by rendering them on a suitable Cairo \"Surface\". This carries
 * the render operation and the required surface size.
 */
export type DiagramExport = readonly [Cairo.Render<void>, BoundBox];

/** Data for each entity currently being edited. */
export interface ActiveEntity<P, V> {
  /** The top level widget for the whole diagram, to be inserted into the application. */
  readonly activeEntityWidget: Gtk.Widget;
  /**
   * The widget where the diagram is actually drawn. Make this the keyboard focus when
   * you want this to become the primary diagram. May or may not be the same as the
   * @activeEntityWidget@.
   */
  readonly activeEntityCanvas: Gtk.Widget;
  /**
   * Action to trigger a refresh of the view of the entity. An action is used instead
   * of just piping an event in order to ensure that only live views are refreshed.
   */
  readonly activeEntityRefresh: () => void;
  /** Updates to the model. */
  readonly activeEntityUpdates: B.Event<ModelScriptAct<P, V, V, Maybe<string>>[]>;
  /** The zoom level of this diagram. */
  readonly activeEntityZoom: B.Behavior<Scale>;
  /** The current state of the diagram prepared for export. */
  readonly activeEntityExport: B.Behavior<Maybe<DiagramExport>>;
  /** The model ID of the diagram. */
  readonly activeWrapper: EntityWrapper<HadesRender, V>;
}

/** The `ActiveEntity` constructor. */
export function ActiveEntity<P, V>(
  activeEntityWidget: Gtk.Widget,
  activeEntityCanvas: Gtk.Widget,
  activeEntityRefresh: () => void,
  activeEntityUpdates: B.Event<ModelScriptAct<P, V, V, Maybe<string>>[]>,
  activeEntityZoom: B.Behavior<Scale>,
  activeEntityExport: B.Behavior<Maybe<DiagramExport>>,
  activeWrapper: EntityWrapper<HadesRender, V>,
): ActiveEntity<P, V> {
  return {
    activeEntityWidget, activeEntityCanvas, activeEntityRefresh, activeEntityUpdates, activeEntityZoom,
    activeEntityExport, activeWrapper,
  };
}

/**
 * GTK Notebooks can have pages added, deleted and reordered by the user. The application needs
 * to keep track of which diagrams are open, and when a diagram is opened for a second time it
 * should move to that diagram. Hence the need for a mapping from Diagram UUID to GTK Widget.
 *
 * IORefs are used rather than Behaviors because they are simpler to manage and there is no need for
 * actions to be taken when they change.
 */
export interface BookManager<P, V> {
  /** Root of a binary tree of Paned widgets with Notebooks at the leaves. */
  readonly bookManagerDisplay: IORef<Maybe<Gtk.Widget>>;
  /**
   * A table of the diagrams in the notebook, indexed by widget and UUID. For each diagram
   * we have the associated display widget and an event for edits to the diagram that might
   * also lead to updates to the model. Update this via \"bookManagerModelHandler\" only.
   */
  readonly bookManagerContents: IORef<readonly ActiveEntity<P, V>[]>;
  /**
   * When the active tab is changed the associated event stream will
   * be emitted as an event. Use \"switchE\" to tune into the stream of update events from the
   * currently selected diagram.
   */
  readonly bookManagerActiveEvent: B.Event<ActiveEntity<P, V>>;
  /** Callback for when a diagram becomes active. */
  readonly bookManagerActiveHandler: B.Handler<ActiveEntity<P, V>>;
  /** The contents have changed. */
  readonly bookManagerModelUpdate: B.Event<readonly ActiveEntity<P, V>[]>;
  /** Callback for when the contents change. Also updates the \"bookManagerContents\". */
  readonly bookManagerModelHandler: B.Handler<readonly ActiveEntity<P, V>[]>;
  /** The current scale for diagrams to be drawn, and any changes to that scale. */
  readonly bookManagerZoom: B.Event<Scale>;
  /** Events on this cause the contents of the notebooks to refresh. */
  readonly bookManagerRefresh: B.Event<null>;
}

/** The `BookManager` constructor. */
export function BookManager<P, V>(
  bookManagerDisplay: IORef<Maybe<Gtk.Widget>>,
  bookManagerContents: IORef<readonly ActiveEntity<P, V>[]>,
  bookManagerActiveEvent: B.Event<ActiveEntity<P, V>>,
  bookManagerActiveHandler: B.Handler<ActiveEntity<P, V>>,
  bookManagerModelUpdate: B.Event<readonly ActiveEntity<P, V>[]>,
  bookManagerModelHandler: B.Handler<readonly ActiveEntity<P, V>[]>,
  bookManagerZoom: B.Event<Scale>,
  bookManagerRefresh: B.Event<null>,
): BookManager<P, V> {
  return {
    bookManagerDisplay, bookManagerContents, bookManagerActiveEvent, bookManagerActiveHandler,
    bookManagerModelUpdate, bookManagerModelHandler, bookManagerZoom, bookManagerRefresh,
  };
}

/** Common name for all Notebooks in the BookManager to enable them to exchange tabs. */
export const hadesGroup: string = "hades-diagram-tabs";

/** `maybe False (sameWidget w1) mw` */
function isWidget(w1: Gtk.Widget, mw: Maybe<Gtk.Widget> | Gtk.Widget | null): boolean {
  if (mw === null) return false;
  if (mw instanceof Gtk.Widget) return sameWidget(w1, mw);
  return mw.tag === "Just" && sameWidget(w1, mw.value);
}

/** gi-gtk `getWidgetParent`, which returns a `Maybe Container`. */
function getWidgetParent(w: Gtk.Widget): Gtk.Container | null {
  return Gtk.castTo(Gtk.Container, Gtk.getWidgetParent(w));
}

/** Extract the list of all GTK notebooks currently underneath the \"BookManager\". */
export function allBooks<P, V>(manager: BookManager<P, V>): Gtk.Notebook[] {
  const traverseWidget = (mw: Gtk.Widget | null): Gtk.Notebook[] => {
    if (mw === null) return [];
    const w = mw;
    const paned = Gtk.castTo(Gtk.Paned, w);
    if (paned !== null) {
      const results1 = traverseWidget(Gtk.panedGetChild1(paned));
      const results2 = traverseWidget(Gtk.panedGetChild2(paned));
      return [...results1, ...results2];
    }
    const nb = Gtk.castTo(Gtk.Notebook, w);
    if (nb !== null) return [nb];
    return [];
  };
  const w = readIORef(manager.bookManagerDisplay);
  return traverseWidget(w.tag === "Just" ? w.value : null);
}

/**
 * Split the nominated notebook in two. If the original notebook was the current display widget
 * then a new widget is passed to the Handler.
 */
export function splitBook<P, V>(handler: B.Handler<Gtk.Widget>, book: Gtk.Notebook, manager: BookManager<P, V>): void {
  const replace = (orient: Gtk.Orientation): Gtk.Paned => {
    const splitWidget = Gtk.panedNew(orient);
    const blank = newHadesBook(handler, manager);
    Gtk.panedPack1(splitWidget, book, true, true);
    Gtk.panedPack2(splitWidget, blank, true, true);
    Gtk.widgetShow(splitWidget);
    Gtk.widgetShow(blank);
    return splitWidget;
  };
  const display = readIORef(manager.bookManagerDisplay);
  const w1 = Gtk.toWidget(book);
  const parentContainer = getWidgetParent(book);
  if (parentContainer === null) return; // Should never happen
  if (isWidget(w1, display)) {
    Gtk.containerRemove(parentContainer, book);
    const newWidget = replace(Gtk.OrientationHorizontal);
    Gtk.containerAdd(parentContainer, newWidget); // Assume its a simple container.
    const newWidget1 = Gtk.toWidget(newWidget);
    handler(newWidget1);
  } else {
    const parent = Gtk.castTo(Gtk.Paned, parentContainer);
    if (parent === null) return; // Should never happen.
    // parent == parentContainer, but with different types.
    const orient = Gtk.orientableGetOrientation(parent);
    const orient2 = orient === Gtk.OrientationHorizontal
      ? Gtk.OrientationVertical
      : Gtk.OrientationHorizontal;
    const child1 = Gtk.panedGetChild1(parent);
    const child2 = Gtk.panedGetChild2(parent);
    if (isWidget(w1, child1)) {
      Gtk.containerRemove(parent, w1);
      const newWidget = replace(orient2);
      Gtk.panedPack1(parent, newWidget, true, true);
    } else if (isWidget(w1, child2)) {
      Gtk.containerRemove(parent, w1);
      const newWidget = replace(orient2);
      Gtk.panedPack2(parent, newWidget, true, true);
    } else {
      return;
    }
  }
}

/**
 * Merge a notebook at a leaf of Paned widgets with its sibling. If the argument is already
 * the root display widget then do nothing. If the argument is a direct child of the current
 * display widget then call the handler with the merged widget.
 */
export function mergeBook<P, V>(handler: B.Handler<Gtk.Widget>, book: Gtk.Notebook, manager: BookManager<P, V>): void {
  // Transfer all w2 tabs into w1 and return w1.
  const merge = (mw1: Gtk.Widget | null, mw2: Gtk.Widget | null): Gtk.Notebook => {
    if (mw1 !== null && mw2 !== null) {
      const book1 = flatten(mw1);
      const book2 = flatten(mw2);
      const n2 = Gtk.notebookGetNPages(book2);
      for (let k = 1; k <= n2; k++) {
        const page = Gtk.notebookGetNthPage(book2, 0);
        if (page === null) continue;
        const label = Gtk.notebookGetTabLabel(book2, page);
        const menu = Gtk.notebookGetMenuLabel(book2, page);
        Gtk.containerRemove(book2, page); // Should also remove label and menu items.
        Gtk.notebookAppendPageMenu(book1, page, label, menu);
        Gtk.notebookSetTabDetachable(book1, page, true);
      }
      return book1;
    }
    if (mw1 !== null) return flatten(mw1);
    if (mw2 !== null) return flatten(mw2);
    return newHadesBook(handler, manager);
  };
  // If w is a Paned then merge its contents. If it is a notebook then just return it.
  // If neither then create a new notebook and return that.
  const flatten = (w: Gtk.Widget): Gtk.Notebook => {
    const paned = Gtk.castTo(Gtk.Paned, w);
    if (paned !== null) {
      const child1 = Gtk.panedGetChild1(paned);
      const child2 = Gtk.panedGetChild2(paned);
      if (child1 !== null) Gtk.containerRemove(paned, child1);
      if (child2 !== null) Gtk.containerRemove(paned, child2);
      return merge(child1, child2);
    }
    const nb = Gtk.castTo(Gtk.Notebook, w);
    if (nb !== null) return nb;
    return newHadesBook(handler, manager); // Should never happen.
  };
  const display = readIORef(manager.bookManagerDisplay);
  const w1 = Gtk.toWidget(book);
  if (isWidget(w1, display)) return; // Nothing to merge with.
  const p1 = getWidgetParent(book);
  if (p1 === null) return; // Should never happen.
  const parent = Gtk.toWidget(p1);
  const newWidget = flatten(parent);
  // Replace the parent with newWidget.
  const gp1 = getWidgetParent(parent);
  if (gp1 === null) return; // Should never happen.
  Gtk.containerRemove(gp1, parent);
  Gtk.containerAdd(gp1, newWidget);
  if (isWidget(parent, display)) handler(Gtk.toWidget(newWidget));
}

/**
 * Hades Notebooks exist as the leaves of a tree of Paned widgets. Each has action buttons for
 * splitting and joining.
 */
export function newHadesBook<P, V>(handler: B.Handler<Gtk.Widget>, manager: BookManager<P, V>): Gtk.Notebook {
  const focusOnPage = (widget: Gtk.Widget, _: unknown): void => {
    const contents = readIORef(manager.bookManagerContents);
    const selected = L.find((a: ActiveEntity<P, V>) => sameWidget(widget, a.activeEntityWidget), contents);
    if (selected.tag === "Just") {
      Gtk.widgetGrabFocus(selected.value.activeEntityCanvas);
    } else {
      // Should never happen.
      // A diagram is shown but not in the contents.
    }
  };
  const book = Gtk.notebookNew();
  Gtk.set(book, {
    scrollable: true,
    enablePopup: true,
  });
  Gtk.notebookSetGroupName(book, hadesGroup);
  const buttons = Gtk.boxNew(Gtk.OrientationHorizontal, 1);
  const splitButton = Gtk.buttonNewWithLabel("Split");
  Gtk.onButtonPressed(splitButton, () => splitBook(handler, book, manager));
  Gtk.boxPackStart(buttons, splitButton, true, false, 0);
  const mergeButton = Gtk.buttonNewWithLabel("Merge");
  Gtk.onButtonPressed(mergeButton, () => mergeBook(handler, book, manager));
  Gtk.boxPackStart(buttons, mergeButton, true, false, 0);
  Gtk.onNotebookSwitchPage(book, focusOnPage);
  Gtk.widgetShowAll(buttons);
  Gtk.notebookSetActionWidget(book, buttons, Gtk.PackTypeEnd);
  Gtk.widgetShowAll(book);
  // Work around issue in notebooks where nothing is shown until there is a tab.
  const dummy = Gtk.labelNew("You should never see this text.");
  Gtk.widgetShow(dummy);
  Gtk.notebookAppendPage(book, dummy, null);
  Gtk.containerRemove(book, dummy);
  return book;
}

/**
 * Create a new BookManager. Returns the initial widget along with the BookManager, which
 * includes a \"Behavior\" for future changes to the widget as it is split and merged.
 *
 * @param scaleE Changes to the diagram scale.
 * @param refreshE Refresh button clicked.
 */
export function newBookManager<P, V>(
  scaleE: B.Event<Scale>,
  refreshE: B.Event<null>,
): [Gtk.Widget, BookManager<P, V>] {
  // (The Haskell `{-# SCC ... #-}` profiling annotations are dropped.)
  const contents = newIORef<readonly ActiveEntity<P, V>[]>([]);
  const widgetRef = newIORef<Maybe<Gtk.Widget>>(Nothing);
  const [activeE, activeH] = B.newEvent<ActiveEntity<P, V>>();
  const [updateE, updateH] = B.newEvent<readonly ActiveEntity<P, V>[]>();
  const updateH1 = (v: readonly ActiveEntity<P, V>[]): void => {
    writeIORef(contents, v);
    updateH(v);
  };
  const replaceWidgetH = (w: Gtk.Widget): void => writeIORef(widgetRef, Just(w));
  const manager = BookManager<P, V>(widgetRef, contents, activeE, activeH, updateE, updateH1, scaleE, refreshE);
  const book = newHadesBook(replaceWidgetH, manager);
  const widget = Gtk.toWidget(book);
  replaceWidgetH(widget);
  return [widget, manager];
}
