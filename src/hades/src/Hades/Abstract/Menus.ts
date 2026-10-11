// Ported from hades/src/Hades/Abstract/Menus.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Utility module containing functions to produce some common menus.
 *
 * Menus in Hades diagrams are of type @Point -> Menu (Action v)@, so all of these functions
 * take a @Point@ even when they don't need it.
 *
 * TypeScript port
 * ---------------
 * `addItemsMenu` and `basicShapeMenu` take the `Point` as their last argument. As in Haskell
 * they can also be partially applied: called without the `Point` they return the
 * `(p: Point) => Menu<Action<V>>` function used as a `viewMenu`.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { mapMaybe } from "@/lib/Data/Maybe";
import { Right } from "@/lib/Data/Either";
import { use } from "@/lib/Control/Lens";
import type { UUID } from "@/lib/Data/UUID";
import { Menu, MenuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { type Point } from "./Geometry";
import {
  type Action, type Delta, type DeltaCtx, mkScriptAction, deltaSelection, deltaDiagram, tellCheckpoint,
  yieldViews, itemsDescription,
} from "./Delta";
import { diagramContents } from "./Diagram";
import { addItem, deleteItem, moveTop, moveBottom } from "./Primitives";

/**
 * A menu for adding new items to the diagram. The "UUID" is the new UUID for the item, and
 * the "Point" is the location for the new item (i.e. where the right click bought up the menu).
 */
export function addItemsMenu<V>(
  generators: readonly (readonly [string, (p: Point, uuid: UUID) => V])[],
): (p: Point) => Menu<Action<V>>;
export function addItemsMenu<V>(
  generators: readonly (readonly [string, (p: Point, uuid: UUID) => V])[],
  p: Point,
): Menu<Action<V>>;
export function addItemsMenu<V>(
  generators: readonly (readonly [string, (p: Point, uuid: UUID) => V])[],
  p?: Point,
): Menu<Action<V>> | ((p: Point) => Menu<Action<V>>) {
  if (p === undefined) return (p1: Point) => addItemsMenu(generators, p1);
  const add = ([str, f]: readonly [string, (p: Point, uuid: UUID) => V]): MenuItem<Action<V>> =>
    MenuItem(str, Right(mkScriptAction<V>(function* (d) {
      const v = yield* addItem(d, (uuid) => f(p, uuid));
      const desc = yield* d.cls.itemDescription(d, v);
      yield* tellCheckpoint(d, "Add " + desc);
      return yield* yieldViews(d);
    })));
  return Menu([generators.map(add)]);
}

/**
 * Basic menu for shapes in the diagram. The argument is the UUID of the shape. The @Point@ is
 * ignored.
 */
export function basicShapeMenu<V>(uuid: UUID): (p: Point) => Menu<Action<V>>;
export function basicShapeMenu<V>(uuid: UUID, p: Point): Menu<Action<V>>;
export function basicShapeMenu<V>(uuid: UUID, p?: Point): Menu<Action<V>> | ((p: Point) => Menu<Action<V>>) {
  const menu = (): Menu<Action<V>> => Menu<Action<V>>([[
    MenuItem("To top", Right(selectionOrTarget<V>(
      function* (d, vs) {
        return "Move " + (yield* itemsDescription(d, vs)) + " to top";
      },
      moveTop,
      uuid,
    ))),
    MenuItem("To bottom", Right(selectionOrTarget<V>(
      function* (d, vs) {
        return "Move " + (yield* itemsDescription(d, vs)) + " to bottom";
      },
      moveBottom,
      uuid,
    ))),
  ], [
    MenuItem("Delete", Right(selectionOrTarget<V>(
      function* (d, vs) {
        return "Delete " + (yield* itemsDescription(d, vs));
      },
      deleteItem,
      uuid,
    ))),
  ]]);
  return p === undefined ? () => menu() : menu();
}

/**
 * If the target is a member of the selected set then apply the action to all of the current
 * selection. If the target is not a member of the selected set then only apply it to the target.
 */
export function selectionOrTarget<V>(
  /** Message for the undo log, based on the items the action is applied to. */
  strF: (d: DeltaCtx<V>, vs: readonly V[]) => Delta<V, string>,
  /** Action for each item. */
  action: (d: DeltaCtx<V>, uuid: UUID) => Delta<V, void>,
  /** Item that has been clicked on. */
  uuid: UUID,
): Action<V> {
  return mkScriptAction<V>(function* (d) {
    const sel = use(d, deltaSelection<V>());
    const contents = use(d, deltaDiagram<V>().dot(diagramContents<V>()));
    if (S.member(uuid, sel)) {
      const msg = yield* strF(d, mapMaybe((u: UUID) => M.lookup(u, contents), S.toList(sel)));
      for (const u of S.toList(sel)) yield* action(d, u);
      yield* tellCheckpoint(d, msg);
    } else {
      const target = M.lookup(uuid, contents);
      if (target.tag === "Just") {
        const msg = yield* strF(d, [target.value]);
        yield* action(d, uuid);
        yield* tellCheckpoint(d, msg);
      }
    }
    return yield* yieldViews(d);
  });
}
