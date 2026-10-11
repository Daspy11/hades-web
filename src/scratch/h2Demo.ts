/**
 * Scratch demo for Hades.GI.{Rendering,MouseMachine,Toolbar} (open with `?demo=h2`).
 *
 * A diagram of labelled boxes in a `makeDrawingGtk` editor with a toolbar and the bottom bar.
 * Click to select, shift-click to toggle, drag to move, drag the background to rubber-band
 * select, drag a handle to resize, control-wheel or the bottom bar to zoom, control-drag to
 * scroll, right-click for menus, Delete to delete the selection.
 *
 * `window.h2` exposes the editor state for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { use, view } from "@/lib/Control/Lens";
import { mempty_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  type Action, type Connectable, type DeltaAct, type DeltaCtx, type KeyCommands, type Modifiers, type Rectangle,
  type View, BoxShapeClass_Rectangle, DeltaToolbar, DeltaTool, DeltaToolAction, Point, Rectangle as mkRectangle,
  BoundBox, ShapeClass_Rectangle, addItemsMenu, alignmentTools, applyToSelection, basicShapeMenu,
  connectableDefaults, deleteItem, deltaDiagram, deltaSelection, deltaZoom, diagramContents, diagramFromList,
  handleDelegatedAction, itemsDescription, mkScriptAction, noMod, simpleHandle, streamStateT, tellAll,
  tellCheckpoint, tellItem, updateItem, yieldViews, growBox, shrinkBox, runInner,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesGtk, fillBox, hadesActionExecute, hadesConfig, hadesState, makeBottomBar, makeDrawingGtk,
  makeGtkDeltaToolbar, squareHandle, textBlock,
} from "@/hades/src/Hades/GI";
import * as Saving from "@/hades/src/Hades/GI/Saving";
import * as IO from "@/lib/System/IO";
import * as J from "@/lib/Data/Aeson";

interface Item {
  readonly id: string;
  readonly shape: Rectangle;
  readonly label: string;
}

const cls: Connectable<Item> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles(d, v) {
    const hs: View<Item>[] = [];
    for (const [pt, f] of BoxShapeClass_Rectangle.shapeHandles(v.shape)) {
      hs.push(yield* simpleHandle(d, "Resize ", mempty_Menu(), squareHandle, [pt, (p: Point): Item => ({ ...v, shape: f(p) })]));
    }
    return hs;
  },
  itemTouched: (v, s, p) => ShapeClass_Rectangle.shapeTouched(v.shape, s, p),
  *itemChildren() {
    return [];
  },
  itemInBox: (v, b) => ShapeClass_Rectangle.shapeInBox(v.shape, b),
  itemBounds: (v) => ShapeClass_Rectangle.shapeBounds(v.shape),
  *itemResize(d, wh, v) {
    const v1: Item = { ...v, shape: BoxShapeClass_Rectangle.shapeResize(wh, v.shape) };
    yield* updateItem(d, v1);
    return v1;
  },
  *itemMove(d, xy, v) {
    const v1: Item = { ...v, shape: ShapeClass_Rectangle.shapeDrag(xy, v.shape) };
    yield* updateItem(d, v1);
    return v1;
  },
  *itemDrag(d, xy, v) {
    return yield* cls.itemMove(d, xy, v);
  },
  *itemDescription(_d, v) {
    return v.label;
  },
  *itemView(_d, v) {
    const box = v.shape._rectangleShape;
    const r: View<Item> = {
      viewDraw: (env) => {
        if (box.tag === "BoundBox") {
          Cairo.rectangle(env.cr, box._0._pX, box._0._pY, box._1._pX - box._0._pX, box._1._pY - box._0._pY);
          fillBox(env);
          textBlock(v.label, ["Box " + v.id], shrinkBox(4, box))(env);
        }
      },
      viewTouched: (p) => cls.itemTouched(v, 1, p),
      viewBox: growBox(2, cls.itemBounds(v)),
      viewMenu: basicShapeMenu<Item>(v.id),
      viewAction: (d1, a) => handleDelegatedAction(d1, v, yieldViews, (d2) => yieldViews(d2), a),
    };
    return r;
  },
  itemType: () => "demo",
  *itemAdjust(d, v) {
    yield* tellItem(d, v);
  },
};

const box = (id: string, label: string, x: number, y: number, w = 120, h = 60): Item =>
  ({ id, label, shape: mkRectangle(BoundBox(Point(x, y), Point(x + w, y + h))) });

let counter = 0;
const backgroundMenu = addItemsMenu<Item>([
  ["Add box", (p: Point, uuid: string) => box(uuid, "New box " + ++counter, p._pX, p._pY)],
]);

const keyCommands: KeyCommands<Item> = M.fromList<readonly [Modifiers, string], DeltaAct<Item, void>>([[
  [noMod, "\x7f"],
  (d: DeltaCtx<Item>) => applyToSelection(d,
    function* (d1, xs) {
      return "Delete " + (yield* itemsDescription(d1, xs));
    },
    deleteItem),
]]);

export function main(): void {
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Hades rendering demo");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, vbox);
  const style = hadesConfig(Gtk.iconThemeGetDefault());
  const diagram = diagramFromList(cls, [
    box("a", "Alpha", 40, 40),
    box("b", "Beta", 240, 60),
    box("c", "Gamma", 120, 200),
    box("d", "Far away", 1100, 700),
  ]);
  const deselect: Action<Item> = mkScriptAction<Item>(function* (d) {
    yield* tellAll(d);
    const sel = use(d, deltaSelection<Item>());
    yield* tellCheckpoint(d, `${S.size(sel)} items were selected`);
    return yield* yieldViews(d);
  });
  const toolbar = DeltaToolbar<Item>(
    [alignmentTools<Item>()],
    [[DeltaTool<Item>("view-refresh", "Redraw", DeltaToolAction(deselect))]],
  );

  let current: HadesGtk<Item> | null = null;
  const net = B.compile(() => {
    const [toolbarWidget, toolbarActions] = makeGtkDeltaToolbar(cls, toolbar);
    const hadesRef: B.Behavior<HadesGtk<Item>> = B.lazyB(() => hadesB);
    const [drawingWidget, hadesInit, diagramActions] = makeDrawingGtk(
      cls, diagram, null, Just(backgroundMenu), keyCommands, style, 1, hadesRef);
    const zoomRef: B.Event<number> = B.lazyE(() => zoomE);
    const updateZoom = (z: number): Action<Item> => mkScriptAction<Item>(function* (d) {
      d.state = { ...d.state, _deltaZoom: z };
      yield* tellAll(d);
      return yield* yieldViews(d);
    });
    const allActions = [diagramActions, toolbarActions, B.mapE((z: number) => [updateZoom(z)], zoomRef)]
      .reduceRight((acc, e) => B.unionWith((a: Action<Item>[], b: Action<Item>[]) => [...a, ...b], e, acc));
    const results = B.execute(B.apply(
      B.mapB((h: HadesGtk<Item>) => (acts: Action<Item>[]) => () => runInner(hadesActionExecute(null, h, acts)), hadesRef),
      allActions));
    const hadesB: B.Behavior<HadesGtk<Item>> = B.stepper(hadesInit, B.mapE((r) => r.hadesActionNewState, results));
    B.reactimate(B.mapE((r) => () => {
      current = r.hadesActionNewState;
      r.hadesActionDraw();
    }, results));
    const zoomOf = (h: HadesGtk<Item>): number =>
      view(deltaZoom<Item>(), streamStateT(view(hadesState<Item>(), h)));
    const hintB: B.Behavior<Maybe<string>> = B.stepper<Maybe<string>>(Nothing,
      B.filterJust(B.mapE((r) => r.hadesActionCheckpoint.tag === "Just" ? Just(r.hadesActionCheckpoint) : Nothing, results)));
    const [bottomBar, zoomE] = makeBottomBar(hintB, B.mapB(zoomOf, hadesB));
    Gtk.boxPackStart(vbox, toolbarWidget, false, false, 0);
    Gtk.boxPackStart(vbox, drawingWidget, true, true, 0);
    Gtk.boxPackStart(vbox, bottomBar, false, false, 0);
    current = hadesInit;
  });
  B.actuate(net);

  const state = () => (current === null ? null : streamStateT(view(hadesState<Item>(), current)));
  (window as any).h2 = {
    selection: () => {
      const s = state();
      return s === null ? [] : S.toList(view(deltaSelection<Item>(), s));
    },
    zoom: () => {
      const s = state();
      return s === null ? null : view(deltaZoom<Item>(), s);
    },
    items: () => {
      const s = state();
      if (s === null) return [];
      return M.elems(view(deltaDiagram<Item>().dot(diagramContents<Item>()), s)).map((v) => {
        const b = v.shape._rectangleShape;
        return b.tag === "BoundBox" ? [v.id, v.label, b._0._pX, b._0._pY, b._1._pX, b._1._pY] : [v.id];
      });
    },
    // For checking the file functions from the browser console / test scripts.
    Saving, IO, J, Just, Nothing, win,
    canvasRect: () => {
      const el = document.querySelector("canvas");
      const r = el?.getBoundingClientRect();
      return r ? [r.left, r.top, r.width, r.height] : null;
    },
  };
  Gtk.widgetShowAll(win);
  Gtk.main();
}
