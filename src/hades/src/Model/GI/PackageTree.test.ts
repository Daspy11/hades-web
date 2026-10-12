// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { type Either } from "@/lib/Data/Either";
import { fmapTree, type Tree } from "@/lib/Data/Tree";
import { identity, lens, prism_, set, view, type Prism } from "@/lib/Control/Lens";
import { CryptoRandomGen_Generator, newGenerator, type Generator as UUIDGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import type { Editable, ModelScript, ModelScriptAct } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelUpdate,
  InternalError, JSON_Package, Name, Package, UserError, currentId, delete_, emptyModel, evalModelEdit, goToEntity,
  mkEntity, mkPackage, modelStartState, nameField, runModelEdit,
} from "@/hades/src/Model/Abstract/PackageTree";
import {
  type GtkTreeInfo, GtkEntity, clearTree, currentTreePath, entityColumnTypes, entityToTreeRow, getEntityTree,
  getSelectedRows, goToTreePath, modelErrorWarning, modelWidget, processModelUpdates, replaceGtkTree,
  show_GtkEntity, storeEntityForest, treeIterFromPath, treeRowToEntity, treeSortF, updateGtkTree,
} from "./PackageTree";

/** Messages shown with "errorBox" (mocked). */
const shownErrors: string[] = vi.hoisted(() => []);
vi.mock("@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox", async (orig) => ({
  ...(await orig<typeof import("@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox")>()),
  errorBox: async (_parent: unknown, msg: string) => {
    shownErrors.push(msg);
  },
}));

// ---------------------------------------------------------------------------------------------
// A small entity type: packages and leaves. Leaves named "Fixed..." cannot be moved.

type Item =
  | { readonly tag: "Pkg"; readonly _0: Package<Item, null> }
  | { readonly tag: "Leaf"; readonly name: Name };

const itemPackage: Prism<Item, Package<Item, null>> = prism_(
  (p: Package<Item, null>): Item => ({ tag: "Pkg", _0: p }),
  (v: Item) => (v.tag === "Pkg" ? Just(v._0) : Nothing),
);
const itemName = lens(
  (v: Item): Name => (v.tag === "Pkg" ? v._0._packageName : v.name),
  (v: Item, n: Name): Item => (v.tag === "Pkg" ? { tag: "Pkg", _0: { ...v._0, _packageName: n } } : { ...v, name: n }),
);
const Leaf = (n: string): Item => ({ tag: "Leaf", name: Name(n) });

type Script = ModelScriptAct<string, Item, Item, Maybe<string>>;

/** Activations seen by the Editable instance. */
const activated: Maybe<string>[] = [];

const itemClass: EntityClass<Item, null> & Editable<string, Item> = {
  reflectiveName: (v) => Variant(v.tag),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(itemName, v)._0)),
  reflectiveSet: (st, v) => set(itemName, Name(extract(st, view(itemName, v)._0, _ExtText, nameField)), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: itemName,
  _Package: itemPackage,
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: (v) => !view(itemName, v)._0.startsWith("Fixed"),
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: Item): J.Value => (v.tag === "Pkg" ? JSON_Package(itemClass).toJSON(v._0) : { type: "leaf", name: v.name._0 }),
    (val) => J.withObject("Item", (o): Item =>
      (o.type === "package" ? { tag: "Pkg", _0: JSON_Package(itemClass).parseJSON(o) } : Leaf(String(o.name))), val),
  ),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  editableActivation: (e) => function* (_c): ModelScript<string, Item, Maybe<string>> {
    activated.push(e.tag === "Just" ? Just(view(itemName, e.value._entityContents)._0) : Nothing);
    return Nothing;
  },
  editableTreeMenu: (e) => (e.tag === "Nothing" ? Nothing : Just(Menu<Script>([[
    menuItem("Delete", function* (c): ModelScript<string, Item, Maybe<string>> {
      goToEntity(c, e.value.entityId);
      delete_(c);
      return Just("Menu delete " + view(itemName, e.value._entityContents)._0);
    }),
  ]]))),
  editableDisplayMenu: () => Nothing,
};

const picF = (e: Entity<Item>): string => (e._entityContents.tag === "Pkg" ? "model-package" : "gsn_goal");

const gen0: UUIDGenerator = (() => {
  const r = CryptoRandomGen_Generator.newGen(U.encodeUtf8("b".repeat(47)));
  if (r.tag === "Left") throw new Error("newGen");
  return r.value;
})();

function ok<L, R>(e: Either<L, R>): R {
  if (e.tag === "Left") throw new Error("Unexpected Left: " + JSON.stringify(e.value));
  return e.value;
}

/**
 * Root "Test" with packages "Pkg 10" (leaves "x", "Fixed"), "Pkg 9" (package "Inner" with leaf
 * "deep") and a leaf "a" at the root. Natural order puts "Pkg 9" before "Pkg 10".
 */
function sampleModel(): [Model<Item>, Record<string, string>] {
  const ids: Record<string, string> = {};
  const r = runModelEdit(itemClass, identity<Item>(), modelStartState(gen0, emptyModel(itemClass, "Test")), (c) => {
    const at = (parent: string | null, f: () => string, nm: string) => {
      goToEntity(c, parent === null ? U.nil : ids[parent]);
      ids[nm] = f();
    };
    at(null, () => mkPackage(c, Name("Pkg 10")), "Pkg 10");
    at(null, () => mkPackage(c, Name("Pkg 9")), "Pkg 9");
    at(null, () => mkEntity(c, Leaf("a")).entityId, "a");
    at("Pkg 10", () => mkEntity(c, Leaf("x")).entityId, "x");
    at("Pkg 10", () => mkEntity(c, Leaf("Fixed")).entityId, "Fixed");
    at("Pkg 9", () => mkPackage(c, Name("Inner")), "Inner");
    at("Inner", () => mkEntity(c, Leaf("deep")).entityId, "deep");
  });
  return [ok(r)[0].updateNewModel, ids];
}

/** Run a script that does not yield. (A fresh UUID generator, so new ids do not clash.) */
function runScript(model: Model<Item>, act: Script): ModelUpdate<Item, Maybe<string>> {
  return ok(runModelEdit(itemClass, identity<Item>(), modelStartState(newGenerator(), model), (c) => {
    const step = act(c).next();
    if (!step.done) throw new Error("The script yielded an instruction");
    return step.value;
  }))[0];
}

/** The names shown in the tree view (in sorted order). */
function shownTree(info: GtkTreeInfo<Item>): Tree<string> {
  const [, iter] = Gtk.treeModelGetIter(info._1, Gtk.treePathNewFromIndices([0]));
  return fmapTree((e: GtkEntity) => e.gtkName._0, getEntityTree(info._1, iter));
}
const N = (s: string, kids: Tree<string>[] = []): Tree<string> => ({ rootLabel: s, subForest: kids });

afterEach(() => {
  shownErrors.length = 0;
  activated.length = 0;
});

// ---------------------------------------------------------------------------------------------

describe("rows of the GTK tree store", () => {
  it("entityToTreeRow and treeRowToEntity round-trip, with the UUID as four words", () => {
    const e = GtkEntity(Name("Goal 1"), "gsn_goal", "0123abcd-4567-89ef-fedc-ba9876543210");
    const row = entityToTreeRow(e);
    expect(row.length).toBe(entityColumnTypes.length);
    expect(Gtk.fromGValue(row[0])).toBe("Goal 1");
    expect(row.slice(2).map((g) => Gtk.fromGValue<number>(g))).toEqual(U.toWords(e.gtkId));
    expect(treeRowToEntity(row)).toEqual(e);
    expect(treeRowToEntity([Gtk.toGValue(null), Gtk.toGValue(null), ...row.slice(2)]))
      .toEqual(GtkEntity(Name("*error*"), "", e.gtkId));
    expect(() => treeRowToEntity(row.slice(0, 5))).toThrow("insufficient elements");
    expect(show_GtkEntity(e)).toBe(
      'GtkEntity {gtkName = Name "Goal 1", gtkIcon = "gsn_goal", gtkId = 0123abcd-4567-89ef-fedc-ba9876543210}');
  });

  it("the sorted view uses natural order and getEntityTree reads it back", () => {
    const store = Gtk.treeStoreNew(entityColumnTypes);
    const sorted = Gtk.new_(Gtk.TreeModelSort, { model: store });
    Gtk.treeSortableSetSortFunc(sorted, 0, treeSortF);
    Gtk.treeSortableSetSortColumnId(sorted, 0, Gtk.SortTypeAscending);
    const root = clearTree(store, Name("Model"));
    const leaf = (n: string) => ({ rootLabel: GtkEntity(Name(n), "", U.nextRandom()), subForest: [] });
    storeEntityForest(store, root, [leaf("Item 10"), leaf("item 2"), { ...leaf("Item 9"), subForest: [leaf("b"), leaf("A")] }]);
    const [, it] = Gtk.treeModelGetIterFirst(sorted);
    const t = fmapTree((e: GtkEntity) => e.gtkName._0, getEntityTree(sorted, it));
    expect(t).toEqual(N("Model", [N("item 2"), N("Item 9", [N("A"), N("b")]), N("Item 10")]));
    expect(getEntityTree(sorted, it).rootLabel).toEqual(GtkEntity(Name("Model"), "model-home", U.nil));
  });
});

describe("goToTreePath and currentTreePath", () => {
  const [model, ids] = sampleModel();
  it("are inverse, with the root at [0]", () => {
    const paths = ok(evalModelEdit(itemClass, identity<Item>(), model, (c) => {
      const r: Record<string, number[]> = {};
      for (const [nm, id] of Object.entries(ids)) {
        goToEntity(c, id);
        r[nm] = currentTreePath(c);
        goToTreePath(c, r[nm]);
        expect(currentId(c)).toBe(id);
      }
      goToEntity(c, U.nil);
      r.root = currentTreePath(c);
      return r;
    }));
    expect(paths).toEqual({
      "root": [0], "Pkg 9": [0, 1], "Pkg 10": [0, 2], "a": [0, 0], "x": [0, 2, 1], "Fixed": [0, 2, 0],
      "Inner": [0, 1, 0], "deep": [0, 1, 0, 0],
    });
  });

  it("report bad paths as user errors", () => {
    const r1 = evalModelEdit(itemClass, identity<Item>(), model, (c) => goToTreePath(c, []));
    expect(r1).toEqual({ tag: "Left", value: UserError("Cannot go to the node above root.") });
    const r2 = evalModelEdit(itemClass, identity<Item>(), model, (c) => goToTreePath(c, [0, 3]));
    expect(r2).toEqual({ tag: "Left", value: UserError("Path does not exist in model") });
  });
});

describe("modelErrorWarning", () => {
  it("explains internal errors and shows user errors as they are", async () => {
    const w = Gtk.labelNew("x");
    await modelErrorWarning(w, UserError("No such thing."));
    await modelErrorWarning(w, InternalError("Broken."));
    expect(shownErrors).toEqual([
      "No such thing.",
      "An internal error has been detected:\n\n   Broken.\n\nPlease save your work in a new file and report this bug.",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The tree widget in a reactive network, wired as the application does.

interface Harness {
  readonly info: GtkTreeInfo<Item>;
  readonly vw: Gtk.TreeView;
  model: Model<Item>;
  readonly selections: S.Set<string>[];
  readonly scripts: Script[];
  /** Set the application's selection behaviour. */
  select(ids: readonly string[]): void;
  /** Run a script from the widget and feed its update back as the application does. */
  apply(s: Script): Maybe<string>;
  /** Replace the whole model. */
  blat(m: Model<Item>): void;
}

function harness(model0: Model<Item>): Harness {
  const h = B.liftMomentIO(() => {
    const [modelE, fireModel] = B.newEvent<Model<Item>>();
    const modelC = Changes(modelE, B.stepper(model0, modelE));
    const [selE, fireSel] = B.newEvent<S.Set<string>>();
    const selectB = B.stepper(S.empty<string>(), selE);
    const [info, selectE, scriptE] = modelWidget(itemClass, picF, model0, modelC, selectB);
    const [updateE, fireUpdate] = B.newEvent<ModelUpdate<Item, Maybe<string>>>();
    const [blatE, fireBlat] = B.newEvent<Model<Item>>();
    const modelOut = processModelUpdates(itemClass, info, updateE, blatE);
    return { info, selectE, scriptE, modelOut, fireModel, fireSel, fireUpdate, fireBlat };
  });
  const r: Harness = {
    info: h.info,
    vw: h.info._2,
    model: model0,
    selections: [],
    scripts: [],
    select: (ids) => h.fireSel(S.fromList(ids)),
    apply: (s) => {
      const u = runScript(r.model, s);
      h.fireUpdate(u);
      return u.updateValue;
    },
    blat: (m) => h.fireBlat(m),
  };
  B.subscribeE(h.selectE, (s) => r.selections.push(s));
  B.subscribeE(h.scriptE, (s) => r.scripts.push(s));
  B.subscribeE(h.modelOut, (m) => {
    r.model = m;
    h.fireModel(m);
  });
  return r;
}

/**
 * Give the tree view a fake DOM so that `treeViewGetPathAtPos` works under jsdom: the rows of
 * the given paths are 20 pixels high, from the top.
 */
function fakeRows(vw: Gtk.TreeView, paths: readonly string[]): (path: string) => number {
  const root = document.createElement("div");
  const els = paths.map((p) => {
    const el = document.createElement("div");
    el.dataset.path = p;
    el.dataset.col = "0";
    root.appendChild(el);
    return el;
  });
  document.body.appendChild(root);
  vw.el = root;
  document.elementFromPoint = (_x: number, y: number) => els[Math.floor(y / 20)] ?? null;
  return (path) => paths.indexOf(path) * 20 + 10;
}

const buttonEvent = (button: number, y: number): Gdk.EventButton => ({
  type: "EventTypeButtonPress", button, x: 10, y, xRoot: 10, yRoot: y, state: [], time: 0,
});

describe("modelWidget", () => {
  it("shows the model under a home node, sorted, with icons, the root expanded", () => {
    const [model] = sampleModel();
    const h = harness(model);
    expect(shownTree(h.info)).toEqual(N("Test", [
      N("a"), N("Pkg 9", [N("Inner", [N("deep")])]), N("Pkg 10", [N("Fixed"), N("x")]),
    ]));
    expect(Gtk.treeViewRowExpanded(h.vw, Gtk.treePathNewFromIndices([0]))).toBe(true);
    expect(Gtk.treeViewRowExpanded(h.vw, Gtk.treePathNewFromIndices([0, 1]))).toBe(false);
    const [, it] = Gtk.treeModelGetIter(h.info._1, Gtk.treePathNewFromIndices([0, 2]));
    const col = Gtk.treeViewGetColumn(h.vw, 0)!;
    const [icon, txt] = col.cells.map((p) => p.cell);
    expect(Gtk.computeCellProps(h.info._1, it.node!, col, icon).iconName).toBe("model-package");
    expect(Gtk.computeCellProps(h.info._1, it.node!, col, txt).text).toBe("Pkg 10");
    expect(txt.base.editable).toBe(true);
    expect(h.vw.selection.mode).toBe(Gtk.SelectionModeMultiple);
    expect(h.vw.headersVisible).toBe(false);
  });

  it("reports the selected entities, and follows the selection behaviour without reporting it", () => {
    const [model, ids] = sampleModel();
    const h = harness(model);
    Gtk.treeSelectionSelectPath(h.vw.selection, Gtk.treePathNewFromIndices([0, 2]));
    expect(h.selections.at(-1)).toEqual(S.fromList([ids["Pkg 10"]]));
    const n = h.selections.length;
    h.select([ids.deep, ids.a]);
    expect(h.selections.length).toBe(n);
    expect(getSelectedRows(h.vw.selection)).toEqual(S.fromList([[0, 0], [0, 1, 0, 0]]));
    // The ancestors of a selected entity are expanded.
    expect(Gtk.treeViewRowExpanded(h.vw, Gtk.treePathNewFromIndices([0, 1, 0]))).toBe(true);
    h.select([ids.a]);
    expect(getSelectedRows(h.vw.selection)).toEqual(S.fromList([[0, 0]]));
  });

  it("renames an entity edited in place, and re-sorts the tree", () => {
    const [model] = sampleModel();
    const h = harness(model);
    const txt = Gtk.treeViewGetColumn(h.vw, 0)!.cells[1].cell;
    txt.emit("edited", "0:0", "z last");
    expect(h.scripts.length).toBe(1);
    expect(h.apply(h.scripts[0])).toEqual(Just("Rename a as z last"));
    expect(shownTree(h.info).subForest.map((t) => t.rootLabel)).toEqual(["Pkg 9", "Pkg 10", "z last"]);
    // No change: no description, nothing to undo.
    txt.emit("edited", "0:2", "z last");
    expect(h.apply(h.scripts[1])).toEqual(Nothing);
    // A path that is not a number list is ignored.
    txt.emit("edited", "0:x", "q");
    expect(h.scripts.length).toBe(2);
  });

  it("runs the activation script of an activated row", () => {
    const [model] = sampleModel();
    const h = harness(model);
    h.vw.emit("row-activated", Gtk.treePathNewFromIndices([0, 2, 1]), Gtk.treeViewGetColumn(h.vw, 0));
    h.vw.emit("row-activated", Gtk.treePathNewFromIndices([0]), Gtk.treeViewGetColumn(h.vw, 0));
    expect(h.scripts.length).toBe(2);
    h.scripts.forEach((s) => h.apply(s));
    expect(activated).toEqual([Just("x"), Nothing]);
  });

  it("deletes the selected entities with the Delete key", () => {
    const [model, ids] = sampleModel();
    const h = harness(model);
    const key = (keyval: number) => h.vw.emit("key-press-event", { keyval, key: "", state: [], time: 0 });
    expect(key(Gdk.KEY_Return)).toBe(false);
    expect(h.scripts.length).toBe(0);
    h.select([ids.x]);
    expect(key(Gdk.KEY_Delete)).toBe(true);
    expect(h.apply(h.scripts[0])).toEqual(Just("Deleted x"));
    h.select([ids.a, ids.Inner]);
    expect(key(Gdk.KEY_Delete)).toBe(true);
    expect(h.apply(h.scripts[1])).toEqual(Just("Deleleted 2 entities"));
    expect(shownTree(h.info)).toEqual(N("Test", [N("Pkg 9"), N("Pkg 10", [N("Fixed")])]));
    h.select([]);
    key(Gdk.KEY_Delete);
    expect(h.apply(h.scripts[2])).toEqual(Nothing);
  });

  it("pops up the entity's context menu on a right click and runs the chosen item", () => {
    const [model] = sampleModel();
    const h = harness(model);
    const yOf = fakeRows(h.vw, ["0", "0:0", "0:1", "0:2"]);
    // Left clicks are left to the tree view.
    expect(h.vw.emit("button-press-event", buttonEvent(1, yOf("0:2")))).toBe(false);
    // The root has no menu in this application.
    expect(h.vw.emit("button-press-event", buttonEvent(3, yOf("0")))).toBe(true);
    expect(Gtk.toplevels.list().some((w) => w instanceof Gtk.Menu && w.open)).toBe(false);
    expect(h.vw.emit("button-press-event", buttonEvent(3, yOf("0:2")))).toBe(true);
    const menu = Gtk.toplevels.list().find((w): w is Gtk.Menu => w instanceof Gtk.Menu && w.open)!;
    expect(menu.children.map((c) => (c as Gtk.MenuItem).label)).toEqual(["Delete"]);
    (menu.children[0] as Gtk.MenuItem).activate();
    expect(h.apply(h.scripts[0])).toEqual(Just("Menu delete Pkg 10"));
    expect(shownTree(h.info).subForest.map((t) => t.rootLabel)).toEqual(["a", "Pkg 9"]);
    // A right click below the rows asks for the menu of no entity: nothing is shown.
    expect(h.vw.emit("button-press-event", buttonEvent(3, 500))).toBe(false);
  });

  it("moves an entity dropped on a package, and refuses other drops", () => {
    const [model, ids] = sampleModel();
    const h = harness(model);
    const yOf = fakeRows(h.vw, ["0", "0:0", "0:1", "0:2"]);
    h.select([ids.a]);
    const ctx = new Gdk.DragContext(["modelEntity"]);
    // Over a package: accepted, highlighted "into".
    expect(h.vw.emit("drag-motion", ctx, 10, yOf("0:2"), 0)).toBe(true);
    expect(ctx.status).toBe(Gdk.DragActionCopy);
    expect(h.vw.dragDestRow?.path.indices).toEqual([0, 2]);
    expect(h.vw.dragDestRow?.pos).toBe(Gtk.TreeViewDropPositionIntoOrAfter);
    // Over a leaf: refused, no highlight.
    expect(h.vw.emit("drag-motion", ctx, 10, yOf("0:0"), 0)).toBe(false);
    expect(ctx.status).toBe(null);
    expect(h.vw.dragDestRow).toBe(null);
    // Dropping on the package moves the entity.
    expect(h.vw.emit("drag-drop", ctx, 10, yOf("0:2"), 0)).toBe(true);
    expect([ctx.finished, ctx.success]).toEqual([true, true]);
    expect(h.apply(h.scripts[0])).toEqual(Just("Move a to Pkg 10"));
    expect(shownTree(h.info)).toEqual(N("Test", [
      N("Pkg 9", [N("Inner", [N("deep")])]), N("Pkg 10", [N("a"), N("Fixed"), N("x")]),
    ]));
    // An entity that cannot move is refused everywhere.
    Gtk.treeSelectionUnselectAll(h.vw.selection);
    h.select([ids.Fixed]);
    const ctx2 = new Gdk.DragContext(["modelEntity"]);
    expect(h.vw.emit("drag-motion", ctx2, 10, yOf("0"), 0)).toBe(false);
    expect(h.vw.emit("drag-drop", ctx2, 10, yOf("0"), 0)).toBe(false);
    expect([ctx2.finished, ctx2.success]).toEqual([true, false]);
    expect(h.scripts.length).toBe(1);
    // The default drop processing (drag-data-received) is stopped.
    let after = false;
    h.vw.connect("drag-data-received", () => {
      after = true;
    });
    h.vw.emit("drag-data-received", ctx2, 0, 0, null, 0, 0);
    expect(after).toBe(false);
  });

  it("replaces the whole tree, keeping expanded rows and the selection by entity", () => {
    const [model, ids] = sampleModel();
    const h = harness(model);
    h.select([ids.deep]);
    expect(Gtk.treeViewRowExpanded(h.vw, Gtk.treePathNewFromIndices([0, 1, 0]))).toBe(true);
    // A new model in which "Pkg 9" sorts first: the paths of the expanded entities change.
    const renamed = ok(runModelEdit(itemClass, identity<Item>(), modelStartState(newGenerator(), model), (c) => {
      goToEntity(c, ids.a);
      delete_(c);
      goToEntity(c, U.nil);
      mkEntity(c, Leaf("zz"));
    }))[0].updateNewModel;
    h.blat(renamed);
    expect(shownTree(h.info).subForest.map((t) => t.rootLabel)).toEqual(["Pkg 9", "Pkg 10", "zz"]);
    expect(Gtk.treeViewRowExpanded(h.vw, Gtk.treePathNewFromIndices([0, 0]))).toBe(true);
    expect(Gtk.treeViewRowExpanded(h.vw, Gtk.treePathNewFromIndices([0, 0, 0]))).toBe(true);
    expect(getSelectedRows(h.vw.selection)).toEqual(S.fromList([[0, 0, 0, 0]]));
    expect(shownErrors).toEqual([]);
  });
});

describe("updateGtkTree", () => {
  it("does not duplicate an entity added twice (Apply clicked twice)", () => {
    const [model, ids] = sampleModel();
    const h = harness(model);
    const u = runScript(model, function* (c): ModelScript<string, Item, Maybe<string>> {
      goToEntity(c, ids["Pkg 9"]);
      mkEntity(c, Leaf("new"));
      return Just("Add new");
    });
    const log = u.updateEditLog;
    expect(log.map((l) => l.tag)).toEqual(["ModelAdd"]);
    updateGtkTree(itemClass, h.vw, h.info, [...log, ...log]);
    expect(shownTree(h.info).subForest[1]).toEqual(N("Pkg 9", [N("Inner", [N("deep")]), N("new")]));
    expect(shownErrors).toEqual([]);
  });

  it("restores the home node when the root is deleted", () => {
    const [model] = sampleModel();
    const h = harness(model);
    const u = runScript(model, function* (c): ModelScript<string, Item, Maybe<string>> {
      goToEntity(c, U.nil);
      delete_(c);
      return Just("Clear");
    });
    updateGtkTree(itemClass, h.vw, h.info, u.updateEditLog);
    expect(shownTree(h.info)).toEqual(N("Test"));
  });

  it("warns when the tree and the model are out of step", () => {
    const [model, ids] = sampleModel();
    const h = harness(model);
    // Make the widget lose an entity behind the model's back.
    const it = treeIterFromPath(h.info, [0, 1]);
    if (it.tag === "Nothing") throw new Error("missing");
    Gtk.treeStoreRemove(h.info._0, it.value);
    const u = runScript(model, function* (c): ModelScript<string, Item, Maybe<string>> {
      goToEntity(c, ids.deep);
      delete_(c);
      return Just("Delete");
    });
    updateGtkTree(itemClass, h.vw, h.info, u.updateEditLog);
    expect(shownErrors).toEqual([
      "An internal error has been detected:\n\n   updateGtkTree Delete: [0,1,0,0] not found in tree widget: cannot update." +
      "\n\nPlease save your work in a new file and report this bug.",
    ]);
  });
});

describe("replaceGtkTree", () => {
  it("rebuilds the store from the model", () => {
    const [model] = sampleModel();
    const h = harness(model);
    replaceGtkTree(itemClass, h.info, emptyModel(itemClass, "Other"));
    expect(shownTree(h.info)).toEqual(N("Other"));
  });
});
