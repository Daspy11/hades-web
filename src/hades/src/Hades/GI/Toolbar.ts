// Ported from hades/src/Hades/GI/Toolbar.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * GTK rendering of the abstract Hades toolbar ("Hades.Abstract.Toolbar").
 *
 * TypeScript port
 * ---------------
 * `makeGtkDeltaToolbar` and `makeToolItem` take the `Viewable` dictionary of their Haskell
 * constraint first, although (as in Haskell) they do not use it.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import { mkGtkMenu, popupMenuOn } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Menu";
import type { Action, Viewable } from "../Abstract/Delta";
import type { DeltaTool, DeltaToolbar } from "../Abstract/Toolbar";

/** Haskell `unionWith (++)` on events of lists. */
function unionAppend<A>(e1: B.Event<A[]>, e2: B.Event<A[]>): B.Event<A[]> {
  return B.unionWith((a: A[], b: A[]) => [...a, ...b], e1, e2);
}

/**
 * Create a GTK toolbar from the Hades tool specification. If @v@ has a view control dialog
 * then the control button is automatically inserted at the far end.
 */
export function makeGtkDeltaToolbar<D>(
  cls: Viewable<D>,
  toolbar: DeltaToolbar<D>,
): [Gtk.Toolbar, B.Event<Action<D>[]>] {
  const l = toolbar.toolbarLeft;
  const r = toolbar.toolbarRight;
  const bar = Gtk.toolbarNew();
  const addSep = (): B.Event<Action<D>[]> => {
    const sep = Gtk.separatorToolItemNew();
    Gtk.toolbarInsert(bar, sep, -1);
    return B.never();
  };
  const addTools = (ts: readonly DeltaTool<D>[]): B.Event<Action<D>[]> => {
    const evs = ts.map((t) => {
      const [btn, ev] = makeToolItem(cls, t);
      Gtk.toolbarInsert(bar, btn, -1);
      return B.mapE((a: Action<D>) => [a], ev); // Turn Event Action into Event [Action]
    });
    return evs.reduceRight((acc: B.Event<Action<D>[]>, e) => unionAppend(e, acc), B.never());
  };
  // sequence $ intersperse (addSep bar) $ map (addTools bar) ts
  const addGroups = (groups: readonly (readonly DeltaTool<D>[])[]): B.Event<Action<D>[]>[] => {
    const evs: B.Event<Action<D>[]>[] = [];
    groups.forEach((ts, i) => {
      if (i > 0) evs.push(addSep());
      evs.push(addTools(ts));
    });
    return evs;
  };
  const evs1 = addGroups(l);
  const bigSep = Gtk.new_(Gtk.SeparatorToolItem, { draw: false });
  Gtk.toolbarInsert(bar, bigSep, -1);
  const trueValue = Gtk.toGValue(true);
  Gtk.containerChildSetProperty(bar, bigSep, "expand", trueValue); // See Gtk.Toolbar docs
  const evs2 = addGroups(r);
  return [bar, [...evs1, ...evs2].reduceRight((acc: B.Event<Action<D>[]>, e) => unionAppend(e, acc), B.never())];
}

function makeToolItem<D>(_cls: Viewable<D>, t: DeltaTool<D>): [Gtk.ToolButton, B.Event<Action<D>>] {
  const btn = Gtk.toolButtonNew(null, t.toolTip);
  Gtk.toolButtonSetIconName(btn, t.toolIcon);
  Gtk.toolItemSetTooltipText(btn, t.toolTip);
  const act = t.toolAction;
  switch (act.tag) {
    case "DeltaToolAction": {
      const [ev, handler] = B.newEvent<Action<D>>();
      Gtk.onToolButtonClicked(btn, () => handler(act._0));
      return [btn, ev];
    }
    case "DeltaToolMenu": {
      const [gMenu, result] = mkGtkMenu(act._0);
      const [ev, handler] = B.newEvent<Gtk.Menu>();
      Gtk.onToolButtonClicked(btn, () => handler(gMenu));
      popupMenuOn(ev);
      return [btn, result];
    }
  }
}
