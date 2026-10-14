/**
 * Scratch demo for `Model.GI.ModelDiagrams` (open the app with `?demo=md`).
 *
 * A minimal model type (packages, "things" with a name and a description, and box diagrams
 * whose boxes are avatars of things) edited with `editorWindows`: the package tree and property
 * panel on the right, diagram notebooks on the left with the bottom bar (hint and zoom).
 *
 * * Double-click a diagram in the tree (or use "Open diagram" in its menu) to open it; the
 *   first diagram is opened at start-up through the `scriptE` input.
 * * The toolbar "New thing" tool adds a thing to the model and a box for it (click, or drag a
 *   rectangle); the properties dialog of the new thing is opened (no Apply button: it comes
 *   from inside the diagram Delta).
 * * Boxes can be selected, moved, resized, deleted (Delete: from the diagram; Shift+Delete:
 *   from the model); double-click opens the thing's properties; right-click for the avatar menu.
 * * Drag things from the tree onto a diagram to add avatars.
 * * Selecting an entity in the tree shows its properties in the panel; editing them updates
 *   the model (and the boxes).
 * * "Refresh" refreshes the tree and the editors; "Export" exports the active diagram
 *   ("Model.GI.ModelDiagrams.exportDrawing"); "PNG" renders the first diagram with
 *   `renderForExport` + `renderOnPng` and shows it in a window.
 *
 * `window.md` exposes the model and editor state for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { identity, lens, prism, set, view, type Prism } from "@/lib/Control/Lens";
import { readIORef } from "@/lib/Prelude";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem, mempty_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { registerIOSignal } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import {
  type Action, type BoundBox, type DiagramId, type Rectangle, type View, BoxShapeClass_Rectangle, DeltaTool,
  DeltaToolAction, DeltaToolbar, Point, Rectangle as mkRectangle, ShapeClass_Rectangle, BoundBox as mkBoundBox,
  addItem, connectableDefaults, deleteItem, deltaDiagram, deltaSelection, diagramContents, diagramFromList,
  growBox, handleDelegatedAction, mkScriptAction, shrinkBox, simpleHandle, streamStateT,
  tellItem, updateItem, yieldViews,
} from "@/hades/src/Hades/Abstract";
import { fillBox, hadesState, squareHandle, stroke, textBlock } from "@/hades/src/Hades/GI";
import {
  type Avatar, type DiagramEntity, type DiagramMetadataClass, type Editable, type HasDiagrams, type ModelScript,
  type ModelScriptAct, DiagramEntity as mkDiagramEntity, DiagramWrapper, ascend,
  avatarProperties, avatarShapeMenu, diagramBackgroundMenu, diagramEntityMenu, diagramEntityName,
  editEntityProperties, entityMenu, insertEntity, logInsertion, newBoxAvatarTool, openDiagram,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelId, Name, Package, descriptionField, emptyModel,
  entityName, goToEntity, mkEntity, mkPackage, modelStartState, nameField, nameText, packageName, runModelEdit,
  unsafeEntityClone,
} from "@/hades/src/Model/Abstract/PackageTree";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import { processModelUpdates } from "@/hades/src/Model/GI/PackageTree";
import {
  type EditorOutput, editorWindows, exportDrawing, renderForExport, renderOnPng,
} from "@/hades/src/Model/GI/ModelDiagrams";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";

// ---------------------------------------------------------------------------------------------
// The model: packages, things and diagrams of boxes that are avatars of things.

type P = HadesRender;

interface Item {
  readonly id: DiagramId;
  readonly ent: ModelId;
  readonly shape: Rectangle;
}

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, null> }
  | { readonly tag: "Thing"; readonly name: Name; readonly text: string }
  | { readonly tag: "Dgm"; readonly dgm: DiagramEntity<Item, null> };

type Script = ModelScriptAct<P, TV, TV, Maybe<string>>;

const Pkg = (n: string): TV => ({ tag: "Pkg", pkg: Package<TV, null>(Name(n), null) });
const Thing = (n: string, text = ""): TV => ({ tag: "Thing", name: Name(n), text });
const Dgm = (n: string, items: readonly Item[]): TV =>
  ({ tag: "Dgm", dgm: mkDiagramEntity(Name(n), diagramFromList(Avatar_Item, items), null) });

const nameL = lens(
  (v: TV): Name => (v.tag === "Pkg" ? v.pkg._packageName : v.tag === "Thing" ? v.name : v.dgm._diagramEntityName),
  (v: TV, n: Name): TV => (v.tag === "Pkg" ? { ...v, pkg: set(packageName(), n, v.pkg) }
    : v.tag === "Thing" ? { ...v, name: n } : { ...v, dgm: set(diagramEntityName(), n, v.dgm) }),
);

const _Pkg: Prism<TV, Package<TV, null>> = prism(
  (p: Package<TV, null>): TV => ({ tag: "Pkg", pkg: p }),
  (v: TV) => (v.tag === "Pkg" ? Right(v.pkg) : Left(v)),
);
const _Dgm: Prism<TV, DiagramEntity<Item, null>> = prism(
  (d: DiagramEntity<Item, null>): TV => ({ tag: "Dgm", dgm: d }),
  (v: TV) => (v.tag === "Dgm" ? Right(v.dgm) : Left(v)),
);

const boxOf = (v: Item): BoundBox => v.shape._rectangleShape;

/** The `Avatar` (also `Connectable`) dictionary of the box diagrams. */
const Avatar_Item: Avatar<P, TV, TV, Item, null> & DiagramMetadataClass<null> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles(d, v) {
    const hs: View<Item>[] = [];
    for (const [pt, f] of BoxShapeClass_Rectangle.shapeHandles(v.shape)) {
      hs.push(yield* simpleHandle(d, "Resize ", mempty_Menu<Action<Item>>(), squareHandle, [pt, (p: Point): Item => ({ ...v, shape: f(p) })]));
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
    return yield* Avatar_Item.itemMove(d, xy, v);
  },
  *itemDescription(d, v) {
    const e = yield* ascend<P, TV, TV, Item>(d, v);
    return e.tag === "Just" ? view(nameL.dot(nameText), e.value._entityContents) : "box";
  },
  *itemView(d, v) {
    const e = yield* ascend<P, TV, TV, Item>(d, v);
    const title = e.tag === "Just" ? view(nameL.dot(nameText), e.value._entityContents) : "(deleted)";
    const text = e.tag === "Just" && e.value._entityContents.tag === "Thing" ? e.value._entityContents.text : "";
    const box = boxOf(v);
    const vw: View<Item> = {
      viewDraw: (env) => {
        if (box.tag !== "BoundBox") return;
        Cairo.rectangle(env.cr, box._0._pX, box._0._pY, box._1._pX - box._0._pX, box._1._pY - box._0._pY);
        fillBox(env);
        textBlock(title, text === "" ? [] : [text], shrinkBox(4, box))(env);
      },
      viewTouched: (p) => Avatar_Item.itemTouched(v, 1, p),
      viewBox: growBox(2, Avatar_Item.itemBounds(v)),
      viewMenu: avatarShapeMenu<P, TV, TV, Item>(modelClass, v.id),
      viewAction: (d1, a) => handleDelegatedAction(d1, v, (d2) => avatarProperties<P, TV, TV, Item>(d2, v),
        (d2) => yieldViews(d2), a),
    };
    return vw;
  },
  itemType: () => "Box",
  *itemAdjust(d, v) {
    yield* tellItem(d, v);
  },
  updateViewContext: (_c, _m, vc) => vc,
  *getDiagramModelId(d) {
    return d.state._deltaContext as ModelId;
  },
  *entityAvatar(d, e, p) {
    if (e._entityContents.tag !== "Thing") return Nothing;
    const v = yield* addItem(d, (u): Item => ({
      id: u, ent: e.entityId, shape: mkRectangle(mkBoundBox(Point(p._pX - 70, p._pY - 35), Point(p._pX + 70, p._pY + 35))),
    }));
    return Just(v);
  },
  ascendedId: (v) => (U.isNil(v.ent) ? Nothing : Just(v.ent)),
  *avatarChildren() {
    return [];
  },
  *updateAvatar(d, v) {
    // Avatars of deleted things are deleted from the diagram.
    const e = yield* ascend<P, TV, TV, Item>(d, v);
    if (e.tag === "Nothing") {
      yield* deleteItem(d, v.id);
      return true;
    }
    return false;
  },
  diagramMetadataJ: J.unitJ,
  diagramMetadataMempty: null,
  diagramMetadataAppend: () => null,
};

/** The parent package of an entity. */
const parentOf = (e: Entity<TV>): ModelId => e._entityParent;

/** The toolbar of a box diagram: a tool adding a new thing (and its box) to the diagram's package. */
function diagramToolbar(parent: ModelId): DeltaToolbar<Item> {
  const drawShape = (b: BoundBox) => (env: Parameters<HadesRender>[0]) => {
    if (b.tag !== "BoundBox") return;
    Cairo.rectangle(env.cr, b._0._pX, b._0._pY, b._1._pX - b._0._pX, b._1._pY - b._0._pY);
    stroke(env);
  };
  const newThing = DeltaTool<Item>("list-add", "New thing", DeltaToolAction(mkScriptAction<Item>((d) =>
    newBoxAvatarTool<P, TV, TV, Item>(d, parent,
      (m: ModelId, u: DiagramId, bb: BoundBox): Item => ({ id: u, ent: m, shape: mkRectangle(bb) }),
      drawShape, Thing("Thing")))));
  return DeltaToolbar<Item>([[newThing]], []);
}

/** `EntityClass TV`, `HasDiagrams HadesRender TV` and `Editable HadesRender TV`. */
const modelClass: HasDiagrams<P, TV, null> & Editable<P, TV> = {
  reflectiveName: (v) => Variant(v.tag === "Pkg" ? "Package" : v.tag === "Thing" ? "Thing" : "Box Diagram"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Pkg(""), Thing(""), Dgm("", [])],
  reflectiveBuiltIn: (v) => (v.tag === "Thing" ? [nameField, descriptionField] : [nameField]),
  reflectiveGet: (v) => v.tag === "Thing"
    ? M.fromList([[nameField, ExtText(v.name._0)], [descriptionField, ExtText(v.text)]])
    : M.singleton(nameField, ExtText(view(nameL.dot(nameText), v))),
  reflectiveSet: (st, v) => {
    const v1 = set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v);
    return v1.tag === "Thing" ? { ...v1, text: extract(st, v1.text, _ExtText, descriptionField) } : v1;
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: nameL,
  _Package: _Pkg,
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: (e, nm) => (e._entityContents.tag === "Thing"
    ? Just((c: ModelEditCtx<TV, TV>) => unsafeEntityClone(c, e, nm)) : Nothing),
  entityFunctions: M.empty(),
  entityJ: J.codec((_v) => null, () => J.fail("not used")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  isDiagram: (v) => v.tag === "Dgm",
  getDiagramWrapper: (_ctx, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return Nothing;
    return Just(DiagramWrapper<P, TV, TV, Item>(
      Avatar_Item, e.entityId, v.dgm._diagramEntityContents, _Dgm, identity<TV>(),
      () => Nothing, e.entityId, Just(diagramBackgroundMenu<Item>), () => diagramToolbar(parentOf(e))));
  },
  diagramEntityTypes: M.singleton(Variant("Box Diagram"), [Variant("Thing")]),
  diagramMapAvatars: (_f, e) => e,
  // Editable
  editableActivation: (mEnt) => function* (c): ModelScript<P, TV, Maybe<string>> {
    if (mEnt.tag === "Nothing") return Nothing;
    const e = mEnt.value;
    if (e._entityContents.tag === "Dgm") {
      yield* openDiagram<P, TV, TV>(modelClass, c, e.entityId);
      return Nothing;
    }
    if (e._entityContents.tag === "Thing") return yield* editEntityProperties<P, TV, TV>(c, e.entityId);
    return Nothing;
  },
  editableTreeMenu: (mEnt) => {
    const parent = mEnt.tag === "Just" ? mEnt.value.entityId : U.nil;
    const adder = (label: string, v: TV) => menuItem<Script>(label, function* (c): ModelScript<P, TV, Maybe<string>> {
      return logInsertion(yield* insertEntity<P, TV, TV>(c, v, parent));
    });
    const adders = Menu<Script>([[adder("Add package", Pkg("Package")), adder("Add thing", Thing("Thing")),
      adder("Add diagram", Dgm("Diagram", []))]]);
    if (mEnt.tag === "Nothing") return Just(adders);
    const e = mEnt.value;
    switch (e._entityContents.tag) {
      case "Pkg": return Just(Menu<Script>([...adders._0, ...entityMenu<P, TV, TV>(modelClass, e)._0]));
      case "Thing": return Just(entityMenu<P, TV, TV>(modelClass, e));
      case "Dgm": return Just(diagramEntityMenu<P, TV, TV>(modelClass, e.entityId));
    }
  },
  editableDisplayMenu: () => Nothing,
};

const picF = (e: Entity<TV>): string =>
  e._entityContents.tag === "Pkg" ? "model-package" : e._entityContents.tag === "Thing" ? "query-entities" : "view-control";

/** The demo model: package "Plant" with three things and two diagrams, package "Spares". */
function demoModel(): { model: Model<TV>; dgm1: ModelId; dgm2: ModelId } {
  const r = runModelEdit(modelClass, identity<TV>(), modelStartState(newGenerator(), emptyModel(modelClass, "Demo model")), (c) => {
    const plant = mkPackage(c, Name("Plant"));
    goToEntity(c, plant);
    const pump = mkEntity(c, Thing("Pump", "Moves water from the tank to the boiler.")).entityId;
    goToEntity(c, plant);
    const tank = mkEntity(c, Thing("Tank", "Holds 500 litres.")).entityId;
    goToEntity(c, plant);
    const valve = mkEntity(c, Thing("Valve")).entityId;
    goToEntity(c, plant);
    const box = (id: string, ent: ModelId, x: number, y: number): Item =>
      ({ id, ent, shape: mkRectangle(mkBoundBox(Point(x, y), Point(x + 160, y + 80))) });
    const dgm1 = mkEntity(c, Dgm("Overview", [
      box("11111111-1111-4111-8111-111111111111", pump, 60, 60),
      box("22222222-2222-4222-8222-222222222222", tank, 320, 60),
      box("33333333-3333-4333-8333-333333333333", valve, 190, 220),
    ])).entityId;
    goToEntity(c, plant);
    const dgm2 = mkEntity(c, Dgm("Pump detail", [box("44444444-4444-4444-8444-444444444444", pump, 80, 80)])).entityId;
    goToEntity(c, U.nil);
    const spares = mkPackage(c, Name("Spares"));
    goToEntity(c, spares);
    mkEntity(c, Thing("Gasket"));
    return { dgm1, dgm2 };
  });
  if (r.tag === "Left") throw new Error("demo model: " + JSON.stringify(r.value));
  return { model: r.value[0].updateNewModel, ...r.value[0].updateValue };
}

// ---------------------------------------------------------------------------------------------

export function main(): void {
  const { model: model0, dgm1, dgm2 } = demoModel();
  const iconTheme = Gtk.iconThemeGetDefault();
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Model diagrams demo");
  Gtk.windowSetDefaultSize(win, 1300, 820);
  const outer = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, outer);
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  Gtk.containerSetBorderWidth(bar, 4);
  const refreshBtn = Gtk.buttonNewWithLabel("Refresh");
  const exportBtn = Gtk.buttonNewWithLabel("Export…");
  const pngBtn = Gtk.buttonNewWithLabel("PNG");
  const statusLabel = Gtk.labelNew("");
  Gtk.labelSetXalign(statusLabel, 0);
  Gtk.set(statusLabel, { name: "md-status" });
  const activeLabel = Gtk.labelNew("");
  Gtk.set(activeLabel, { name: "md-active" });
  Gtk.boxPackStart(bar, refreshBtn, false, false, 0);
  Gtk.boxPackStart(bar, exportBtn, false, false, 0);
  Gtk.boxPackStart(bar, pngBtn, false, false, 0);
  Gtk.boxPackStart(bar, statusLabel, true, true, 0);
  Gtk.boxPackEnd(bar, activeLabel, false, false, 0);
  Gtk.boxPackStart(outer, bar, false, false, 0);

  const log: string[] = [];
  let fireScript: (s: Script) => void = () => {};
  let modelNow = model0;
  let output: EditorOutput<TV> | null = null;
  const net = B.compile(() => {
    const refreshE = registerIOSignal(refreshBtn, Gtk.onButtonClicked, () => [null, null] as const);
    const exportClicked = registerIOSignal(exportBtn, Gtk.onButtonClicked, () => [null, null] as const);
    const [scriptE, fire] = B.newEvent<Script>();
    fireScript = fire;
    const modelERef: B.Event<Model<TV>> = B.lazyE(() => modelE);
    const modelC = Changes(modelERef, B.stepper(model0, modelERef));
    const out = editorWindows<TV>(modelClass, win, iconTheme, picF, model0, modelC, refreshE, scriptE);
    output = out;
    const modelE = processModelUpdates(modelClass, out.editorTreeInfo, out.editorUpdates, B.never());
    B.reactimate(B.mapE((m: Model<TV>) => () => {
      modelNow = m;
    }, modelE));
    B.reactimate(B.mapE((u) => () => {
      const msg = u.updateValue.tag === "Just" ? u.updateValue.value : "(no change)";
      if (u.updateValue.tag === "Just") log.push(msg);
      if (u.updateValue.tag === "Just") Gtk.labelSetText(statusLabel, msg);
    }, out.editorUpdates));
    B.reactimate(B.mapE((a) => () => {
      const e = M.lookup(a.activeWrapper.wrappedEntityId, modelNow.modelContents);
      Gtk.labelSetText(activeLabel, "Active: " + (e.tag === "Just" ? view(entityName(modelClass).dot(nameText), e.value) : "?"));
    }, out.editorActiveEntity));
    // Export the active diagram (as App.ModelMain does).
    B.reactimate(B.mapE((ex) => () => void exportDrawing(win, iconTheme, ex),
      B.filterJust(B.tag(out.editorDiagramExport, exportClicked))));
    Gtk.boxPackStart(outer, out.editorWidget, true, true, 0);
  });
  B.actuate(net);

  // `renderForExport` + `renderOnPng` of the first diagram, shown in a window.
  const showPng = (): number => {
    const ent = M.lookup(dgm1, modelNow.modelContents);
    if (ent.tag === "Nothing" || ent.value._entityContents.tag !== "Dgm") return 0;
    const dgm = ent.value._entityContents.dgm._diagramEntityContents;
    const [draw, size] = renderForExport<P, TV, TV, Item>(Avatar_Item, modelClass, iconTheme, identity<TV>(), modelNow, dgm1, dgm);
    const png = renderOnPng(72 * 2, size, draw);
    const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
    const w = Gtk.windowNew(Gtk.WindowTypeToplevel);
    Gtk.windowSetTitle(w, `renderOnPng: ${Math.round(size[0])}×${Math.round(size[1])} pt at 144 dpi`);
    const img = Gtk.imageNewFromFile(url);
    Gtk.containerAdd(w, img);
    Gtk.widgetShowAll(w);
    return png.length;
  };
  Gtk.onButtonClicked(pngBtn, () => void showPng());

  const openScript = (mId: ModelId): Script => function* (c) {
    yield* openDiagram<P, TV, TV>(modelClass, c, mId);
    return Nothing;
  };

  (window as any).md = {
    log,
    model: () => modelNow,
    names: () => M.elems(modelNow.modelContents).map((e) => view(entityName(modelClass).dot(nameText), e)).sort(),
    thing: (name: string) => {
      const e = M.elems(modelNow.modelContents).find((x) => view(entityName(modelClass).dot(nameText), x) === name);
      return e === undefined ? null : e._entityContents;
    },
    boxes: (dgmName = "Overview") => {
      const e = M.elems(modelNow.modelContents).find((x) => view(entityName(modelClass).dot(nameText), x) === dgmName);
      if (e === undefined || e._entityContents.tag !== "Dgm") return null;
      return M.elems(view(diagramContents<Item>(), e._entityContents.dgm._diagramEntityContents)).map((i) => {
        const b = boxOf(i);
        const ent = M.lookup(i.ent, modelNow.modelContents);
        const nm = ent.tag === "Just" ? view(entityName(modelClass).dot(nameText), ent.value) : "?";
        return b.tag === "BoundBox" ? [nm, b._0._pX, b._0._pY, b._1._pX, b._1._pY] : [nm];
      });
    },
    open: (which: 1 | 2) => fireScript(openScript(which === 1 ? dgm1 : dgm2)),
    activate: (which: 1 | 2) => output?.editorActivate(which === 1 ? dgm1 : dgm2) ?? false,
    showPng,
    canvasRects: () => Array.from(document.querySelectorAll("canvas")).map((c) => {
      const r = c.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    }),
    // Unused helpers kept reachable for console checks.
    hadesState, streamStateT, deltaDiagram, deltaSelection, S, readIORef,
  };
  Gtk.widgetShowAll(win);
  Gtk.main();
  // Open the first diagram once the window is up (App.ModelMain opens its start diagram the
  // same way, through the script input).
  setTimeout(() => fireScript(openScript(dgm1)), 0);
}
