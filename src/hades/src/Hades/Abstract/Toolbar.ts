// Ported from hades/src/Hades/Abstract/Toolbar.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This provides the abstract command toolbar for Hades diagrams. Each tool has an associated
 * Delta command run when the tool is activated.
 *
 * The following type variables are used:
 *
 * [@v@] The type of drawing.
 *
 * [@m@] The underlying monad for the drawing.
 *
 * TypeScript port
 * ---------------
 * Values of type `(Connectable v) => ...` (`alignmentTools` and the private menus) are functions
 * of no arguments, like the `Action` values in "Hades.Abstract.Commands": the `Connectable`
 * dictionary arrives with the `DeltaCtx` when the actions run.
 */
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  alignLeft, alignRight, alignTop, alignBottom, alignVertical, alignHorizontal,
  sizeWidest, sizeNarrowest, sizeTallest, sizeShortest,
  distributeH, distributeV, spaceH, spaceV,
} from "./Commands";
import type { Action } from "./Delta";

/** When a toolbutton is clicked it either does something or provides a menu of actions. */
export type DeltaToolClick<V> =
  | { readonly tag: "DeltaToolAction"; readonly _0: Action<V> }
  | { readonly tag: "DeltaToolMenu"; readonly _0: Menu<Action<V>> };

export function DeltaToolAction<V>(_0: Action<V>): DeltaToolClick<V> {
  return { tag: "DeltaToolAction", _0 };
}
export function DeltaToolMenu<V>(_0: Menu<Action<V>>): DeltaToolClick<V> {
  return { tag: "DeltaToolMenu", _0 };
}

export interface DeltaTool<V> {
  /** The back end is expected to know what to do with this. */
  readonly toolIcon: string;
  /** Description of the tool. */
  readonly toolTip: string;
  readonly toolAction: DeltaToolClick<V>;
}
export function DeltaTool<V>(toolIcon: string, toolTip: string, toolAction: DeltaToolClick<V>): DeltaTool<V> {
  return { toolIcon, toolTip, toolAction };
}

/**
 * An abstract toolbar with slots for icons on the left and the right. Sublists are rendered
 * with separators between them. The monoid instance is concatenation with a separator.
 */
export interface DeltaToolbar<V> {
  readonly toolbarLeft: readonly (readonly DeltaTool<V>[])[];
  readonly toolbarRight: readonly (readonly DeltaTool<V>[])[];
}
export function DeltaToolbar<V>(
  toolbarLeft: readonly (readonly DeltaTool<V>[])[],
  toolbarRight: readonly (readonly DeltaTool<V>[])[],
): DeltaToolbar<V> {
  return { toolbarLeft, toolbarRight };
}

/** `instance Semigroup (DeltaToolbar v)` */
export function append_DeltaToolbar<V>(t1: DeltaToolbar<V>, t2: DeltaToolbar<V>): DeltaToolbar<V> {
  return DeltaToolbar([...t1.toolbarLeft, ...t2.toolbarLeft], [...t1.toolbarRight, ...t2.toolbarRight]);
}

/** `instance Monoid (DeltaToolbar v)` */
export function mempty_DeltaToolbar<V>(): DeltaToolbar<V> {
  return DeltaToolbar<V>([], []);
}

/** `mconcat` for toolbars. */
export function mconcat_DeltaToolbar<V>(ts: readonly DeltaToolbar<V>[]): DeltaToolbar<V> {
  return ts.reduceRight((acc: DeltaToolbar<V>, t) => append_DeltaToolbar(t, acc), mempty_DeltaToolbar<V>());
}

/** Common menu buttons for box alignment. */
export function alignmentTools<V>(): DeltaTool<V>[] {
  return [
    DeltaTool<V>("align", "Align positions", DeltaToolMenu(alignMenu<V>())),
    DeltaTool<V>("align-size", "Align sizes", DeltaToolMenu(sizeMenu<V>())),
    DeltaTool<V>("align-distribute", "Distribute selection", DeltaToolMenu(distributeMenu<V>())),
  ];
}

function alignMenu<V>(): Menu<Action<V>> {
  return Menu([[
    menuItem("Left", alignLeft<V>()),
    menuItem("Right", alignRight<V>()),
    menuItem("Top", alignTop<V>()),
    menuItem("Bottom", alignBottom<V>()),
    menuItem("Vertical", alignVertical<V>()),
    menuItem("Horizontal", alignHorizontal<V>()),
  ]]);
}

function sizeMenu<V>(): Menu<Action<V>> {
  return Menu([[
    menuItem("Widest", sizeWidest<V>()),
    menuItem("Narrowest", sizeNarrowest<V>()),
    menuItem("Tallest", sizeTallest<V>()),
    menuItem("Shortest", sizeShortest<V>()),
  ]]);
}

function distributeMenu<V>(): Menu<Action<V>> {
  return Menu([[
    menuItem("Distribute horizontally", distributeH<V>()),
    menuItem("Distribute vertically", distributeV<V>()),
    menuItem("Space horizontally", spaceH<V>()),
    menuItem("Space vertically", spaceV<V>()),
  ]]);
}
