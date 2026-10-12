/**
 * Scratch demo for task n1 (`?demo=n1`): the model package tree of "Model.GI.PackageTree" and the
 * diagram notebooks of "Model.GI.Notebooks", laid out as `editorWindows` (ModelDiagrams) does:
 * notebooks on the left, the model tree on the right.
 *
 * The model is "1 Quick Guide to the DSM.dsm", read with a minimal entity class (packages are
 * parsed properly, everything else is kept as JSON with its name). Scripts from the tree
 * (rename, drag-move, context menus, Delete key, activation) are run by a tiny interpreter and
 * fed back through `processModelUpdates`, as the application does. Double-clicking an entity
 * opens it as a notebook page; tabs have close buttons, can be reordered and dragged between
 * the notebooks; Split/Merge rearrange the notebooks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Left } from "@/lib/Data/Either";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { identity, lens, prism_, set, view, type Prism } from "@/lib/Control/Lens";
import { readIORef } from "@/lib/Prelude";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem, type MenuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { registerIOSignal } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import { ViewWrapper, type Editable, type ModelScript, type ModelScriptAct } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelUpdate, JSON_Model, JSON_Package, Name, Package, delete_,
  goToEntity, mkPackage, modelNewName, modelStartState, nameField, runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { modelWidget, processModelUpdates } from "@/hades/src/Model/GI/PackageTree";
import { allBooks, newBookManager, sameWidget, type ActiveEntity, type BookManager } from "@/hades/src/Model/GI/Notebooks";
import quickGuide from "@/dsm/share/examples/1 Quick Guide to the DSM.dsm?raw";

// ---------------------------------------------------------------------------------------------
// A minimal entity class for the example file.

type DsmItem =
  | { readonly tag: "DsmPackage"; readonly _0: Package<DsmItem, J.Value> }
  | { readonly tag: "DsmOther"; readonly _0: J.JSONObject };

const rawName = (o: J.JSONObject): string => {
  if (typeof o.name === "string") return o.name;
  const d = o.diagram;
  if (d !== undefined && J.isObject(d) && typeof d.name === "string") return d.name;
  return "";
};
const withRawName = (o: J.JSONObject, n: string): J.JSONObject => {
  const d = o.diagram;
  if (typeof o.name !== "string" && d !== undefined && J.isObject(d)) return { ...o, diagram: { ...d, name: n } };
  return { ...o, name: n };
};
const dsmPackage: Prism<DsmItem, Package<DsmItem, J.Value>> = prism_(
  (p: Package<DsmItem, J.Value>): DsmItem => ({ tag: "DsmPackage", _0: p }),
  (v: DsmItem) => (v.tag === "DsmPackage" ? Just(v._0) : Nothing),
);
const dsmName = lens(
  (v: DsmItem): Name => (v.tag === "DsmPackage" ? v._0._packageName : Name(rawName(v._0).trim())),
  (v: DsmItem, n: Name): DsmItem => (v.tag === "DsmPackage"
    ? { tag: "DsmPackage", _0: { ...v._0, _packageName: n } }
    : { tag: "DsmOther", _0: withRawName(v._0, n._0) }),
);
const typeOf = (v: DsmItem): string => (v.tag === "DsmPackage" ? "package" : String(v._0.type ?? "query"));

type Script = ModelScriptAct<string, DsmItem, DsmItem, Maybe<string>>;

/** Set once the notebooks exist: opens an entity as a notebook page. */
let openPage: (e: Entity<DsmItem>) => void = () => undefined;

const dsmClass: EntityClass<DsmItem, J.Value> & Editable<string, DsmItem> = {
  reflectiveName: (v) => Variant(typeOf(v)),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(dsmName, v)._0)),
  reflectiveSet: (st, v) => set(dsmName, Name(extract(st, view(dsmName, v)._0, _ExtText, nameField)), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: dsmName,
  _Package: dsmPackage,
  entityCanHaveChild: (p) => p.tag === "DsmPackage",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: DsmItem): J.Value => (v.tag === "DsmPackage" ? JSON_Package(dsmClass).toJSON(v._0) : v._0),
    (val) => J.withObject("DsmItem", (o): DsmItem =>
      (o.type === "package" ? { tag: "DsmPackage", _0: JSON_Package(dsmClass).parseJSON(o) } : { tag: "DsmOther", _0: o }), val),
  ),
  packageMetaJ: J.valueJ,
  packageMetaMempty: {},
  packageMetaAppend: (a, b) => ({ ...(a as J.JSONObject), ...(b as J.JSONObject) }),
  // Editable: double-click opens a page; the tree menu adds packages and deletes entities.
  editableActivation: (e) => function* (_c): ModelScript<string, DsmItem, Maybe<string>> {
    if (e.tag === "Just") openPage(e.value); // Demo only: a side effect instead of ScriptOpenDiagram.
    return Nothing;
  },
  editableTreeMenu: (e) => {
    const parent = e.tag === "Just" ? e.value.entityId : U.nil;
    const addPackage: MenuItem<Script> = menuItem("Add package", function* (c): ModelScript<string, DsmItem, Maybe<string>> {
      goToEntity(c, parent);
      const nm = modelNewName(c, Name("New package"));
      mkPackage(c, nm);
      return Just("Add package " + nm._0);
    });
    if (e.tag === "Nothing") return Just(Menu<Script>([[addPackage]]));
    const ent = e.value;
    const nm = view(dsmName, ent._entityContents)._0;
    const del: MenuItem<Script> = menuItem("Delete", function* (c): ModelScript<string, DsmItem, Maybe<string>> {
      goToEntity(c, ent.entityId);
      delete_(c);
      return Just("Delete " + nm);
    });
    const open: MenuItem<Script> = menuItem("Open", function* (_c): ModelScript<string, DsmItem, Maybe<string>> {
      openPage(ent);
      return Nothing;
    });
    return Just(Menu<Script>(ent._entityContents.tag === "DsmPackage" ? [[addPackage], [del]] : [[open], [del]]));
  },
  editableDisplayMenu: () => Nothing,
};

/** The tree icons, after `entityIcon` in DSM.SafetyCase. */
const icons: Record<string, string> = {
  "package": "model-package", "GSN Diagram": "gsn_gsn_diagram", "Goal": "gsn_goal", "Strategy": "gsn_strategy",
  "Solution": "gsn_solution", "Support": "gsn_support_arrow", "evidence": "evidence-doc", "trace": "trace-arrow",
  "RiskEvent": "causal_risk_event", "ThreatLine": "causal_risk_line", "Control": "causal_control",
  "Hazard": "causal_hazard", "IsHazard": "causal_is_hazard", "Bow Tie Diagram": "causal_bowtie",
  "matrix": "model-matrix", "report": "model-report", "lookup-table": "model-lookup", "query": "model-query",
};
const picF = (e: Entity<DsmItem>): string => icons[typeOf(e._entityContents)] ?? "no-icon";

/** Run a script from the tree. These scripts never yield instructions. */
function runScript(model: Model<DsmItem>, act: Script): ModelUpdate<DsmItem, Maybe<string>> | string {
  const r = runModelEdit(dsmClass, identity<DsmItem>(), modelStartState(newGenerator(), model), (c) => {
    const step = act(c).next();
    if (!step.done) throw new Error("This demo cannot interpret script instructions.");
    return step.value;
  });
  return r.tag === "Left" ? show_ModelError(r.value) : r.value[0];
}

// ---------------------------------------------------------------------------------------------
// Notebook pages, as `openDiagramInBook`/`newTabLabel` in Model.GI.ModelDiagrams.

function newTabLabel(widget: Gtk.Widget, text: string): Gtk.Box {
  const label = Gtk.labelNew(text);
  const boxWidget = Gtk.boxNew(Gtk.OrientationHorizontal, 1);
  const button = Gtk.buttonNewWithLabel("✖"); // U+2716: Heavy Multiplication X
  Gtk.setButtonRelief(button, Gtk.ReliefStyleNone);
  Gtk.boxPackStart(boxWidget, label, true, true, 0);
  Gtk.boxPackEnd(boxWidget, button, false, false, 0);
  Gtk.onButtonClicked(button, () => Gtk.widgetDestroy(widget));
  Gtk.widgetShowAll(boxWidget);
  return boxWidget;
}

function pageOpener(manager: BookManager<string, DsmItem>, status: (s: string) => void): (e: Entity<DsmItem>) => void {
  return (ent) => {
    const contents = readIORef(manager.bookManagerContents);
    const existing = contents.find((a) => a.activeWrapper.wrappedEntityId === ent.entityId);
    if (existing) {
      const display = Gtk.castTo(Gtk.Notebook, Gtk.widgetGetParent(existing.activeEntityWidget));
      if (display) Gtk.notebookSetCurrentPage(display, Gtk.notebookPageNum(display, existing.activeEntityWidget));
      status("Switched to " + view(dsmName, ent._entityContents)._0);
      return;
    }
    const books = allBooks(manager);
    const display = books.reduce((a, b) => (Gtk.notebookGetNPages(b) < Gtk.notebookGetNPages(a) ? b : a));
    const name = view(dsmName, ent._entityContents)._0;
    const widget = Gtk.boxNew(Gtk.OrientationVertical, 6);
    Gtk.containerSetBorderWidth(widget, 12);
    const title = Gtk.labelNew(null);
    Gtk.labelSetMarkup(title, "<big><b>" + name.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</b></big>");
    Gtk.labelSetXalign(title, 0);
    const canvas = Gtk.labelNew("A " + typeOf(ent._entityContents) + " would be edited here.\n\n" +
      "Drag this tab along the tab strip to reorder it, or onto the other notebook's tabs to move it there.");
    Gtk.labelSetXalign(canvas, 0);
    Gtk.boxPackStart(widget, title, false, false, 0);
    Gtk.boxPackStart(widget, canvas, false, false, 0);
    const active: ActiveEntity<string, DsmItem> = {
      activeEntityWidget: widget,
      activeEntityCanvas: canvas,
      activeEntityRefresh: () => undefined,
      activeEntityUpdates: B.never(),
      activeEntityZoom: B.pureB(1),
      activeEntityExport: B.pureB(Nothing),
      activeWrapper: ViewWrapper(ent.entityId, "n1-demo", null, Left(null), null as never),
    };
    manager.bookManagerModelHandler([active, ...contents]);
    const lbl = newTabLabel(widget, name);
    const menuLbl = Gtk.labelNew(name);
    const n = Gtk.notebookAppendPageMenu(display, widget, lbl, menuLbl);
    Gtk.notebookSetTabDetachable(display, widget, true);
    Gtk.widgetShowAll(widget);
    Gtk.onWidgetDestroy(widget, () => {
      const now = readIORef(manager.bookManagerContents);
      manager.bookManagerModelHandler(now.filter((a) => !sameWidget(widget, a.activeEntityWidget)));
      Gtk.widgetDestroy(lbl);
      Gtk.widgetDestroy(menuLbl);
    });
    Gtk.notebookSetCurrentPage(display, n);
    manager.bookManagerActiveHandler(active);
    status("Opened " + name);
  };
}

// ---------------------------------------------------------------------------------------------

export function main(): void {
  const model0 = JSON_Model(dsmClass).parseJSON(JSON.parse(quickGuide));
  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "n1 demo: model tree and diagram notebooks");
  Gtk.windowSetDefaultSize(win, 1300, 800);
  const outer = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, outer);
  const statusLabel = Gtk.labelNew("Double-click an entity to open it; right-click for its menu; drag entities onto packages.");
  Gtk.labelSetXalign(statusLabel, 0);
  Gtk.set(statusLabel, { name: "n1-status" });
  const status = (s: string) => Gtk.labelSetText(statusLabel, s);
  const reload = Gtk.buttonNewWithLabel("Reload model");

  const net = B.compile(() => {
    const [modelE, fireModel] = B.newEvent<Model<DsmItem>>();
    const modelC = Changes(modelE, B.stepper(model0, modelE));
    const [selE, fireSel] = B.newEvent<S.Set<string>>();
    const selectB = B.stepper(S.empty<string>(), selE);
    const [treeInfo, treeSelectEvent, treeScripts] = modelWidget(dsmClass, picF, model0, modelC, selectB);
    const [updateE, fireUpdate] = B.newEvent<ModelUpdate<DsmItem, Maybe<string>>>();
    const blats = registerIOSignal(reload, Gtk.onButtonClicked, () => [null, model0] as const);
    const modelOut = processModelUpdates(dsmClass, treeInfo, updateE, blats);
    const modelB = B.stepper(model0, modelOut);
    B.reactimate(B.mapE((m: Model<DsmItem>) => () => fireModel(m), modelOut));
    B.reactimate(B.mapE((s: S.Set<string>) => () => {
      fireSel(s);
      status(`Selected ${S.size(s)} ${S.size(s) === 1 ? "entity" : "entities"}`);
    }, treeSelectEvent));
    B.reactimate(B.apply(B.mapB((m: Model<DsmItem>) => (s: Script) => () => {
      const u = runScript(m, s);
      if (typeof u === "string") status("Error: " + u);
      else {
        if (u.updateValue.tag === "Just") status(u.updateValue.value);
        fireUpdate(u);
      }
    }, modelB), treeScripts));

    // The notebooks.
    const [initialBook, manager] = newBookManager<string, DsmItem>(B.never(), B.never());
    openPage = pageOpener(manager, status);
    B.reactimate(B.mapE((xs: readonly ActiveEntity<string, DsmItem>[]) => () =>
      console.log("Book manager contents:", xs.length), manager.bookManagerModelUpdate));

    // Widget hierarchy as in editorWindows.
    const diagramFrame = Gtk.frameNew(null);
    Gtk.frameSetShadowType(diagramFrame, Gtk.ShadowTypeIn);
    Gtk.containerAdd(diagramFrame, initialBook);
    const diagramBox = Gtk.boxNew(Gtk.OrientationVertical, 0);
    Gtk.boxPackStart(diagramBox, diagramFrame, true, true, 0);
    const bottom = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
    Gtk.containerSetBorderWidth(bottom, 4);
    Gtk.boxPackStart(bottom, statusLabel, true, true, 0);
    Gtk.boxPackEnd(bottom, reload, false, false, 0);
    Gtk.boxPackEnd(diagramBox, bottom, false, false, 0);
    const modelFrame = Gtk.frameNew(null);
    Gtk.frameSetShadowType(modelFrame, Gtk.ShadowTypeIn);
    const scrolled = Gtk.scrolledWindowNew(null, null);
    Gtk.containerAdd(scrolled, treeInfo._2);
    Gtk.containerAdd(modelFrame, scrolled);
    const mainBox = Gtk.panedNew(Gtk.OrientationHorizontal);
    Gtk.panedPack1(mainBox, diagramBox, true, true);
    Gtk.panedPack2(mainBox, modelFrame, true, true);
    Gtk.panedSetPosition(mainBox, 860);
    Gtk.boxPackStart(outer, mainBox, true, true, 0);

    // Start with a pair of notebooks: split the first one and open a few pages.
    const split = (initialBook as Gtk.Notebook).actionWidgets.end as Gtk.Box;
    (split.children[0] as Gtk.Button).emit("pressed");
    const byName = (nm: string) => M.elems(model0.modelContents).find((e) => view(dsmName, e._entityContents)._0 === nm);
    for (const nm of ["Test Argument", "Safety Case", "G1"]) {
      const e = byName(nm);
      if (e) openPage(e);
    }
  });
  B.actuate(net);
  Gtk.widgetShowAll(win);
  Gtk.main();
}
