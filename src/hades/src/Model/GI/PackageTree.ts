// Ported from hades/src/Model/GI/PackageTree.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Maps the abstract PackageTree hierarchy to a GTK3 Tree model.
 *
 * The \"modelWidget\" function is used to create the GTK3 tree widget. The architecture allows
 * the application to have a number of model editing widgets (typically a \"modelWidget\" and some
 * diagrams). Each such editor takes a @Behavior (Model v)@ value and returns an
 * @Event (ModelUpdate v Text)@. The top level application should feed all these updates into
 * \"processModelUpdates\".
 *
 * TypeScript port
 * ---------------
 * * Constrained functions take the `EntityClass` dictionary first (`modelWidget` takes the
 *   `Editable p v` & `EntityClass v` dictionary): `entityToGtk(cls, picF, ent)`,
 *   `updateGtkTree(cls, parent, info, logs)`, `replaceGtkTree(cls, info, model)`,
 *   `modelWidget(cls, picF, modelInit, modelC, selectB)`, `processModelUpdates(cls, info, updates, blats)`.
 *   `ModelEdit` functions take the context first: `goToTreePath(ctx, path)`, `currentTreePath(ctx)`.
 * * `MonadIO m` / `IO` functions are synchronous. `MomentIO` functions build network nodes
 *   synchronously (call them inside `B.compile`/`B.liftMomentIO`).
 * * `modelErrorWarning` returns the Promise of `errorBox`. Synchronous callers (the tree update
 *   functions and `reactimate` handlers) show the box without waiting for it to be closed.
 * * `ModelScript p v v (Maybe Text)` values carried by events are `ModelScriptAct`s (generator
 *   functions of the script context). `lift $ do ...` (a `ModelEdit` inside a script) is a
 *   generator that makes direct `ModelEdit` calls on its context and never yields.
 * * `ModelPath` (`[Int32]`) is `readonly number[]`; sets of paths are `S.Set<ModelPath>`
 *   ordered like Haskell lists.
 * * The GTK tree store is the toolkit's `Gtk.TreeStore` of GValue columns, viewed through a
 *   `Gtk.TreeModelSort`, exactly as in the original. Drag and drop uses the toolkit's HTML5
 *   emulation of the GTK signals (`drag-motion`, `drag-drop`, `drag-data-received`).
 * * `GtkEntity` derives `Eq`/`Ord`/`Show`: structural `equals`/`compare` (the `Name` field
 *   uses natural order) and `show_GtkEntity`. `GtkTreeInfo` is a positional record `{_0.._3}`.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, catMaybes, fromNullable, isJust, traverseMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Node, fmapTree, type Forest, type Tree } from "@/lib/Data/Tree";
import { identity, review, view } from "@/lib/Control/Lens";
import { absurd, error, modifyIORef, newIORef, readIORef, readInt, round, showInt, writeIORef, type IORef } from "@/lib/Prelude";
import type { Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { reactimate1, reactimate1_ } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { registerIOSignal, registerIOSignal1, registerIOSignal2, registerIOSignal4, registerIOSignal6 } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import { mkGtkMenu, popupMenuOn } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Menu";
import type { Editable, ModelScript, ModelScriptAct } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelEditLog, type ModelError, type ModelId,
  type ModelUpdate, InternalError, Name, Package, current, currentChildren, currentId, currentName, delete_,
  entityContents, entityName, evalModelEdit, fromHere, goToEntity, goToRoot, modelPackageForest, monadic,
  moveDown, moveEntity, moveUp, nameText, renameEntity, show_Name, throwInternal, throwUser,
} from "@/hades/src/Model/Abstract/PackageTree";
import { naturalOrder } from "@/hades/src/Text/NaturalOrder";

export type { ModelUpdate };

/** Path to a model entity expressed as the indices of each child. */
export type ModelPath = readonly number[];

/** Haskell `show` of a `[Int32]`. */
function showModelPath(path: ModelPath): string {
  return "[" + path.map((x) => showInt(x)).join(",") + "]";
}

/** Convert a ModelPath into a GTK Tree Iterator that points to the unsorted store. */
export function treeIterFromPath<V>(info: GtkTreeInfo<V>, path1: ModelPath): Maybe<Gtk.TreeIter> {
  const sorted = info._1;
  const path2 = Gtk.treePathNewFromIndices(path1);
  const [b, iter] = Gtk.treeModelGetIter(sorted, path2);
  if (b) return Just(Gtk.treeModelSortConvertIterToChildIter(sorted, iter));
  return Nothing;
}

/** Follow a \"TreePath\" from the root to its target entity. */
export function goToTreePath<V, W>(ctx: ModelEditCtx<V, W>, path: ModelPath): void {
  if (path.length === 0) return throwUser("Cannot go to the node above root.");
  goToRoot(ctx);
  for (const x of path.slice(1)) {
    moveDown(ctx, (_c, tbl) => {
      if (x < 0 || x >= M.size(tbl)) throwUser("Path does not exist in model");
      return M.elemAt(x, tbl)[1];
    });
  }
}

/**
 * The entities from the root to the current one, expressed as numerical
 * indices within each package starting from zero. Note that the root has path of [0], so
 * the result is never nil.
 */
export function currentTreePath<V, W>(ctx: ModelEditCtx<V, W>): number[] {
  const go = (c: ModelEditCtx<V, W>): number[] => {
    const e = current(c);
    if (e.tag === "Just") {
      moveUp(c);
      const tbl = currentChildren(c);
      const n = M.lookupIndex(view(entityName(c.cls), e.value), tbl);
      if (n.tag === "Just") return [n.value, ...go(c)];
      return throwInternal(
        "Path item " + view(entityName(c.cls).dot(nameText), e.value) + " has gone missing.");
    }
    return [0];
  };
  return fromHere(ctx, go).reverse();
}

/** A node in the GTK version of the model. */
export interface GtkEntity {
  readonly gtkName: Name;
  /** GTK stock ID for the icon to display. */
  readonly gtkIcon: string;
  readonly gtkId: ModelId;
}

/** The `GtkEntity` constructor. */
export function GtkEntity(gtkName: Name, gtkIcon: string, gtkId: ModelId): GtkEntity {
  return { gtkName, gtkIcon, gtkId };
}

/** Derived `instance Show GtkEntity`. */
export function show_GtkEntity(e: GtkEntity): string {
  return "GtkEntity {gtkName = " + show_Name(e.gtkName) +
    ", gtkIcon = " + T.showText(e.gtkIcon) + ", gtkId = " + U.toText(e.gtkId) + "}";
}

/** The column types to store a GtkEntity structure in a row. */
export const entityColumnTypes: readonly Gtk.GType[] = [
  Gtk.gtypeString, // Name
  Gtk.gtypeString, // Icon
  Gtk.gtypeUInt, // UUID as 4 word32 values
  Gtk.gtypeUInt,
  Gtk.gtypeUInt,
  Gtk.gtypeUInt,
];

/** `[0 .. genericLength entityColumnTypes - 1]` */
const columns: readonly number[] = entityColumnTypes.map((_t, i) => i);

/** Convert a GtkEntity to a row. */
export function entityToTreeRow(ent: GtkEntity): Gtk.GValue[] {
  const [s1, s2, s3, s4] = U.toWords(ent.gtkId);
  return [
    Gtk.toGValue(view(nameText, ent.gtkName)),
    Gtk.toGValue(ent.gtkIcon),
    Gtk.toGValue(s1),
    Gtk.toGValue(s2),
    Gtk.toGValue(s3),
    Gtk.toGValue(s4),
  ];
}

/** Convert a row back to a GtkEntity. */
export function treeRowToEntity(row: readonly Gtk.GValue[]): GtkEntity {
  if (row.length < 6) return error("treeRowToEntity: insufficient elements provided.");
  const [nm, ic, s1, s2, s3, s4] = row;
  return GtkEntity(
    Name(Gtk.fromGValue<string | null>(nm) ?? "*error*"),
    Gtk.fromGValue<string | null>(ic) ?? "",
    U.fromWords(
      Gtk.fromGValue<number>(s1),
      Gtk.fromGValue<number>(s2),
      Gtk.fromGValue<number>(s3),
      Gtk.fromGValue<number>(s4),
    ),
  );
}

/** Clear the GTK tree and create a new root node. Returns an iterator on the root. */
export function clearTree(tree: Gtk.TreeStore, nm: Name): Gtk.TreeIter {
  Gtk.treeStoreClear(tree);
  const newRow = Gtk.treeStoreInsert(tree, null, -1);
  const row = entityToTreeRow(GtkEntity(nm, "model-home", U.nil));
  Gtk.treeStoreSet(tree, newRow, columns, row);
  return newRow;
}

/**
 * Store a GtkEntity as a child of the iterator position and return an iterator that
 * points to it. It is not possible to create a new root with this function.
 */
export function storeEntity(tree: Gtk.TreeStore, iter: Gtk.TreeIter, ent: GtkEntity): Gtk.TreeIter {
  const newRow = Gtk.treeStoreInsert(tree, iter, -1);
  const row = entityToTreeRow(ent);
  Gtk.treeStoreSet(tree, newRow, columns, row);
  return newRow;
}

/** Store a tree as a child of the iterator position. */
export function storeEntityTree(tree: Gtk.TreeStore, iter: Gtk.TreeIter, t: Tree<GtkEntity>): void {
  const newIter = storeEntity(tree, iter, t.rootLabel);
  storeEntityForest(tree, newIter, t.subForest);
}

/** Store a list of trees as children of the iterator position. */
export function storeEntityForest(tree: Gtk.TreeStore, iter: Gtk.TreeIter, forest: Forest<GtkEntity>): void {
  for (const t of forest) storeEntityTree(tree, iter, t);
}

/** Retrieve a GtkEntity from the iterator position. */
export function getEntity(tree: Gtk.TreeModel, iter: Gtk.TreeIter): GtkEntity {
  const row = columns.map((c) => Gtk.treeModelGetValue(tree, iter, c));
  return treeRowToEntity(row);
}

/** Retrieve the current node and any descendants as a Tree. */
export function getEntityTree(tree: Gtk.TreeModel, iter: Gtk.TreeIter): Tree<GtkEntity> {
  const ent = getEntity(tree, iter);
  const [b, child] = Gtk.treeModelIterNthChild(tree, iter, 0);
  const entlings = b ? getEntityForest(tree, child) : [];
  return Node(ent, entlings);
}

/**
 * Starting at the current location, get the current node and all the siblings that follow it,
 * and all their descendants.
 *
 * (TypeScript: the Haskell recursion over the siblings is a loop; as in Haskell the iterator is
 * advanced in place.)
 */
export function getEntityForest(tree: Gtk.TreeModel, iter: Gtk.TreeIter): Forest<GtkEntity> {
  const result: Tree<GtkEntity>[] = [];
  for (;;) {
    const x = getEntityTree(tree, iter);
    result.push(x);
    const b = Gtk.treeModelIterNext(tree, iter);
    if (!b) return result;
  }
}

/** Get the selected rows as a set of ModelPaths */
export function getSelectedRows(sel: Gtk.TreeSelection): S.Set<ModelPath> {
  const [paths1] = Gtk.treeSelectionGetSelectedRows(sel);
  // paths2 <- catMaybes <$> mapM Gtk.treePathGetIndices paths1
  const paths2 = catMaybes(paths1.map((p): Maybe<ModelPath> => fromNullable(Gtk.treePathGetIndices(p))));
  return S.fromList(paths2);
}

/** Maps entity values onto stock icon IDs for the TreeView. */
export type StockFunc<V> = (e: Entity<V>) => string;

/** Extract the GtkEntity information from the Entity. */
export function entityToGtk<V>(cls: EntityClass<V>, picF: StockFunc<V>, ent: Entity<V>): GtkEntity {
  return GtkEntity(
    view(entityName(cls), ent),
    picF(ent),
    ent.entityId,
  );
}

/** The GTK tree model information required for model updates to be reflected in the widget. */
export interface GtkTreeInfo<V> {
  readonly _0: Gtk.TreeStore;
  readonly _1: Gtk.TreeModelSort;
  readonly _2: Gtk.TreeView;
  readonly _3: StockFunc<V>;
}

/** The `GtkTreeInfo` constructor. */
export function GtkTreeInfo<V>(
  _0: Gtk.TreeStore,
  _1: Gtk.TreeModelSort,
  _2: Gtk.TreeView,
  _3: StockFunc<V>,
): GtkTreeInfo<V> {
  return { _0, _1, _2, _3 };
}

/*
Design Note:

The GTK TreeModel lives in the IO monad, while the internal Model lives in the ModelEdit monad.
Hence the only ways to keep the internal Model in synch with the visible GTK TreeModel are:

1: Rebuild the GTK TreeModel every time the internal Model changes (which is O(n) and potentially
very slow on large models).

2: Record changes to the internal Model and then apply those to the GTK TreeModel.

The latter is fragile, but the fragility is manageable. It turns out that only four operations on
the internal Model are visible in the GTK TreeModel, and these are encoded in the ModelEditLog
type, which is recorded by the primitive operations in the ModelEdit monad. Hence the
updateGtkTree function can take this log and apply matching operations to the GTK TreeModel in the
IO monad.

See the note about checkGtkTree at the end of this file for details on test and debug for this
function.
*/

/**
 * Interpret a log of model changes as instructions to update the GTK TreeModel.
 *
 * @param parent Parent widget for error pop-ups.
 * @param info GTK objects to update.
 * @param logs Changes to make.
 */
export function updateGtkTree<V>(
  cls: EntityClass<V>,
  parent: Gtk.Widget,
  info: GtkTreeInfo<V>,
  logs: readonly ModelEditLog<V>[],
): void {
  const { _0: store, _2: vw, _3: picF } = info;
  const warn = (err: ModelError): void => {
    // Web: the error box is shown without waiting for it to be closed.
    void modelErrorWarning(parent, err);
  };
  const entityPath = (c: ModelEditCtx<V, V>, uuid: ModelId): [number[], Maybe<Entity<V>>] => {
    goToEntity(c, uuid);
    const p = currentTreePath(c);
    const e = current(c);
    return [p, e];
  };
  const pathNotFound = (txt: string, path: ModelPath): void =>
    warn(InternalError(
      "updateGtkTree " + txt + ": " + T.pack(showModelPath(path)) +
      " not found in tree widget: cannot update."));
  const pathOf = (model: Model<V>, uuid: ModelId) =>
    evalModelEdit(cls, identity<V>(), model, (c) => {
      goToEntity(c, uuid);
      return currentTreePath(c);
    });
  const doUpdate = (l: ModelEditLog<V>): void => {
    switch (l.tag) {
      case "ModelAdd": {
        const uuid = l._0, model = l._1;
        const r = evalModelEdit(cls, identity<V>(), model, (c) => entityPath(c, uuid));
        if (r.tag === "Left") return warn(r.value);
        const [path, mEnt] = r.value;
        if (mEnt.tag === "Nothing") {
          return warn(InternalError(
            "updateGtkTree Add: New entity has gone missing. Cannot update tree widget."));
        }
        const ent = mEnt.value;
        const old = treeIterFromPath(info, path); // Check if it already exists. See note below.
        if (old.tag === "Just") {
          const gtkEnt = getEntity(store, old.value);
          if (gtkEnt.gtkId === ent.entityId) Gtk.treeStoreRemove(store, old.value);
        } // Nothing: normal case.
        // init is safe because currentTreePath never returns [].
        const parentPath = path.slice(0, -1);
        const it = treeIterFromPath(info, parentPath);
        if (it.tag === "Nothing") return pathNotFound("Add " + view(entityName(cls).dot(nameText), ent), parentPath);
        const newIter = storeEntity(store, it.value, entityToGtk(cls, picF, ent));
        const newPath = Gtk.treeModelGetPath(store, newIter);
        // As in the original, this is a path in the unsorted store, used on the sorted view.
        Gtk.treeViewExpandToPath(vw, newPath);
        return;
      }
      case "ModelDelete": {
        const uuid = l._0, model = l._1;
        const r = pathOf(model, uuid);
        if (r.tag === "Left") warn(r.value);
        else {
          const path = r.value;
          const it = treeIterFromPath(info, path);
          if (it.tag === "Nothing") pathNotFound("Delete", path);
          else Gtk.treeStoreRemove(store, it.value);
        }
        if (U.isNil(uuid)) { // We have just deleted the root node, so now restore it.
          clearTree(store, Name(model.modelName));
        }
        return;
      }
      case "ModelMove": {
        const uuid = l._0, before = l._1, after = l._2;
        const r = pathOf(before, uuid);
        if (r.tag === "Left") return warn(r.value);
        const oldPath = r.value;
        const oldIter = treeIterFromPath(info, oldPath);
        if (oldIter.tag === "Nothing") return pathNotFound("Move (old)", oldPath);
        const target = getEntityTree(store, oldIter.value);
        Gtk.treeStoreRemove(store, oldIter.value);
        const r2 = evalModelEdit(cls, identity<V>(), after, (c) => {
          goToEntity(c, uuid);
          moveUp(c);
          return currentTreePath(c);
        });
        if (r2.tag === "Left") return warn(r2.value);
        const newPath = r2.value;
        const newIter = treeIterFromPath(info, newPath);
        if (newIter.tag === "Nothing") return pathNotFound("Move (new)", newPath);
        storeEntityTree(store, newIter.value, target);
        return;
      }
      case "ModelRename": {
        const uuid = l._0, before = l._1, after = l._2;
        if (U.isNil(uuid)) {
          const it = treeIterFromPath(info, [0]);
          if (it.tag === "Nothing") return pathNotFound("Rename root", [0]);
          const replacement = entityToTreeRow(GtkEntity(
            Name(after.modelName),
            "model-home",
            U.nil,
          ));
          Gtk.treeStoreSet(store, it.value, columns, replacement);
          return;
        }
        const r = pathOf(before, uuid);
        if (r.tag === "Left") return warn(r.value);
        const path = r.value;
        const it = treeIterFromPath(info, path);
        if (it.tag === "Nothing") return pathNotFound("Rename", path);
        const r2 = evalModelEdit(cls, identity<V>(), after, (c) => {
          goToEntity(c, uuid);
          return current(c);
        });
        if (r2.tag === "Left") return warn(r2.value);
        if (r2.value.tag === "Nothing") {
          return warn(InternalError(
            "updateGtkTree: Renamed entity is missing. Cannot update widget."));
        }
        const replacement = entityToTreeRow(entityToGtk(cls, picF, r2.value.value));
        Gtk.treeStoreSet(store, it.value, columns, replacement);
        return;
      }
      case "ModelOther":
        return;
      default:
        return absurd(l);
    }
  };
  logs.forEach(doUpdate);
}

/*
Design note: if "Apply" is clicked repeatedly when creating a new entity the script will return
a log containing a ModelAdd for each click. This must be checked for in the ModelAdd.
*/

/**
 * The entire model has just changed. Overwrite the current model in the GTK tree with a new one.
 *
 * @param info GTK objects to update.
 * @param newModel Replacement model value.
 */
export function replaceGtkTree<V>(cls: EntityClass<V>, info: GtkTreeInfo<V>, newModel: Model<V>): void {
  const { _0: store, _1: sorted, _2: vw, _3: picF } = info;
  const warn = (err: ModelError): void => {
    // Web: the error box is shown without waiting for it to be closed.
    void modelErrorWarning(vw, err);
  };
  const getModelId = (path: Gtk.TreePath): Maybe<ModelId> => {
    const [b, i] = Gtk.treeModelGetIter(sorted, path);
    if (b) {
      const n = Gtk.treeModelGetNColumns(sorted);
      const vals: Gtk.GValue[] = [];
      for (let c = 0; c <= n - 1; c++) vals.push(Gtk.treeModelGetValue(sorted, i, c));
      return Just(treeRowToEntity(vals).gtkId);
    }
    return Nothing;
  };
  const logExpanded = (ref: IORef<ModelId[]>, _: Gtk.TreeView, path: Gtk.TreePath): void => {
    const m = getModelId(path);
    modifyIORef(ref, (xs) => (m.tag === "Just" ? [m.value, ...xs] : xs));
  };
  const r = evalModelEdit(cls, identity<V>(), newModel, (c) => {
    goToRoot(c);
    return modelPackageForest(c);
  });
  if (r.tag === "Left") return warn(r.value);
  const forest = r.value;
  // Get the selected set.
  const treeSel = Gtk.treeViewGetSelection(vw);
  const [paths] = Gtk.treeSelectionGetSelectedRows(treeSel);
  Gtk.treeSelectionUnselectAll(treeSel); // Probably happens anyway, but make sure.
  const selected = catMaybes(paths.map(getModelId));
  // treeViewMapExpandedRows cannot return anything, so stash results in IORef.
  const expandedRef = newIORef<ModelId[]>([]);
  Gtk.treeViewMapExpandedRows(vw, (v, p) => logExpanded(expandedRef, v, p));
  const i = clearTree(store, Name(newModel.modelName));
  const gtkForest = forest.map((t) => fmapTree((e: Entity<V>) => entityToGtk(cls, picF, e), t));
  storeEntityForest(store, i, gtkForest);
  const expanded = readIORef(expandedRef);
  const pathIn = (modelId: ModelId) => evalModelEdit(cls, identity<V>(), newModel, (c) => {
    goToEntity(c, modelId);
    return currentTreePath(c);
  });
  // Restore tree expansion state.
  for (const modelId of expanded) {
    const p = pathIn(modelId);
    if (p.tag === "Left") warn(p.value);
    else {
      const path2 = Gtk.treePathNewFromIndices(p.value);
      Gtk.treeViewExpandToPath(vw, path2);
    }
  }
  // Restore tree selection state.
  for (const modelId of selected) {
    const p = pathIn(modelId);
    if (p.tag === "Left") warn(p.value);
    else {
      const path2 = Gtk.treePathNewFromIndices(p.value);
      Gtk.treeSelectionSelectPath(treeSel, path2);
    }
  }
}

/**
 * A point in the model history is represented as the model state and the description of
 * the change that *followed* it. Hence for \"undo\" it is only necessary to revert to the model
 * state corresponding to the change description being undone. For "redo" the state from the
 * following entry must be used.
 */
export interface HistoryItem<V> {
  /** Model state after the unde or redo. */
  readonly undoValue: Model<V>;
  /** Description of the change. */
  readonly undoText: string;
}

/** The `HistoryItem` constructor. */
export function HistoryItem<V>(undoValue: Model<V>, undoText: string): HistoryItem<V> {
  return { undoValue, undoText };
}

/*
Design note.

The model is a forest, but this creates problems with dragging and dropping in a TreeView; you
can't move anything to the root because there is no representation to drop it on. Hence modelWidget
creates a fake "home" node as the parent of everything.

In the future there will be more than one model open at a time, and hence multiple "home" nodes.

This means that TreePath values from GTK have an extra leading 0 item prefixed, which has to be
ignored by goToTreePath.
*/

/** A first-class `ModelScript p v v (Maybe Text)`. */
type Script<P, V> = ModelScriptAct<P, V, V, Maybe<string>>;

/**
 * `sequenceEvents` (from "Model.Abstract.PackageTree") at the @ModelScript p v v@ monad.
 *
 * TypeScript: the TypeScript `sequenceEvents` is specialised to `ModelEdit` actions, and scripts
 * are generators, so they are sequenced here with `yield*`.
 */
function sequenceEvents<P, V>(es: readonly B.Event<Script<P, V>>[]): B.Event<Script<P, V>> {
  // Simultaneous events probably can't happen. If so then this is dead code.
  const seqResults = (act1: Script<P, V>, act2: Script<P, V>): Script<P, V> =>
    function* (ctx): ModelScript<P, V, Maybe<string>> {
      const str1: Maybe<string> = yield* act1(ctx);
      const str2: Maybe<string> = yield* act2(ctx);
      if (str1.tag === "Nothing") return str2.tag === "Nothing" ? Nothing : Just(str2.value);
      if (str2.tag === "Nothing") return Just(str1.value);
      return Just(str1.value + ", " + str2.value);
    };
  return es.reduceRight<B.Event<Script<P, V>>>((acc, ev) => B.unionWith(seqResults, ev, acc), B.never());
}

/**
 * Tree widget for a model. Visualised in a scrolled window in a viewport. The return values
 * are the GTK widget and tree data, update events, and menu events.
 *
 * There is no way to keep the widget up to date with changes to the model behavior. Hence one
 * return value is the @GtkTreeInfo@, which provides access to the data being displayed by GTK.
 * It is up to the application to update this when the model changes.
 *
 * @param modelInit The initial value of the model.
 * @param modelC The ongoing model to display.
 * @param selectB The currently selected paths in the tree.
 */
export function modelWidget<P, V>(
  cls: Editable<P, V> & EntityClass<V>,
  picF: StockFunc<V>,
  modelInit: Model<V>,
  modelC: Changes<Model<V>>,
  selectB: B.Behavior<S.Set<ModelId>>,
): [GtkTreeInfo<V>, B.Event<S.Set<ModelId>>, B.Event<Script<P, V>>] {
  const gtkEntities = (c: ModelEditCtx<V, V>): Forest<GtkEntity> =>
    modelPackageForest(c).map((t) => fmapTree((e: Entity<V>) => entityToGtk(cls, picF, e), t));

  // Set up the TreeView widget with a column for the name and icon.
  // This code is sensitive to the order of the side effects within GTK.
  // And people wonder why Haskellers think declarative interfaces are a good idea!
  const createTreeview = (nm: Name, forest0: Forest<GtkEntity>): [
    Gtk.TreeView, Gtk.TreeStore, Gtk.TreeModelSort, B.Event<readonly [number[], Name]>, B.Event<ModelId>,
    B.Event<ModelPath>, B.Event<S.Set<ModelId>>,
  ] => {
    // Set up the initial treeStore and create a treeView of it showing a single column.
    const store = Gtk.treeStoreNew(entityColumnTypes);
    const sorted = Gtk.new_(Gtk.TreeModelSort, { model: store });
    Gtk.treeSortableSetSortFunc(sorted, 0, treeSortF);
    Gtk.treeSortableSetSortColumnId(sorted, 0, Gtk.SortTypeAscending);
    const iter = clearTree(store, nm);
    storeEntityForest(store, iter, forest0);
    const vw = Gtk.treeViewNewWithModel(sorted);
    const selection = Gtk.treeViewGetSelection(vw);
    Gtk.treeSelectionSetMode(selection, Gtk.SelectionModeMultiple);
    Gtk.treeViewSetHeadersVisible(vw, false);
    Gtk.treeViewSetReorderable(vw, true);
    // styleContext <- Gtk.widgetGetStyleContext vw
    // Gtk.styleContextAddClass styleContext "hades"
    // Add a column to the view.
    const column = Gtk.treeViewColumnNew();
    Gtk.treeViewAppendColumn(vw, column);
    // Put two renderers for icon and name in the column.
    const icon = Gtk.cellRendererPixbufNew();
    Gtk.treeViewColumnPackStart(column, icon, false);
    const txt = Gtk.cellRendererTextNew();
    Gtk.setCellRendererTextEditable(txt, true);
    // Set up rename event.
    const renameEvent = B.filterJust(registerIOSignal2(txt, Gtk.onCellRendererTextEdited,
      (path1: string, newName: string) => { // path1 is the text version of the ModelPath.
        const path2 = traverseMaybe(readInt, T.splitOn(":", path1));
        if (path2.tag === "Just") return [null, Just([path2.value, Name(newName)] as const)];
        return [null, Nothing];
      },
    ));
    // Set up row activation event carrying the UUID of the activated entity.
    const activateEvent = registerIOSignal2(vw, Gtk.onTreeViewRowActivated,
      (path: Gtk.TreePath, _: Gtk.TreeViewColumn) => {
        const [, i] = Gtk.treeModelGetIter(sorted, path);
        const item = getEntity(sorted, i); // Trust TreeView for valid path
        return [null, item.gtkId];
      });
    // Set up the menu handling events. There is no direct support for context menus in
    // GTK3 TreeView, so we have to build it out of low level mouse events.
    const menuEvent = B.filterJust(registerIOSignal1(
      vw,
      Gtk.onWidgetButtonPressEvent,
      (ev: Gdk.EventButton) => buttonHandler(vw, ev),
    ));
    // Track the selected tree paths. Do not emit an event when updating from selectB.
    const selectBlock = newIORef(false);
    const selectEvent = registerIOSignal(selection, Gtk.onTreeSelectionChanged, () => {
      const blk = readIORef(selectBlock);
      if (blk) return [null, Nothing];
      const [rows, tree] = Gtk.treeSelectionGetSelectedRows(selection);
      const result = rows.map((row) => {
        const [, i] = Gtk.treeModelGetIter(tree!, row);
        return getEntity(tree!, i).gtkId;
      });
      return [null, Just(S.fromList(result))];
    });
    const selectChange = B.changes(B.liftA2B(
      (m: Model<V>, s: S.Set<ModelId>) => () => updateSelection(selectBlock, selection, m, s),
      modelC.changesB,
      selectB,
    ));
    const stop = reactimate1_(selectChange);
    Gtk.onWidgetDestroy(vw, stop);
    // Finish assembling the widgets ready for display.
    Gtk.treeViewColumnPackEnd(column, txt, true);
    Gtk.cellLayoutAddAttribute(column, txt, "text", 0); // GTK cells are stringly typed!
    Gtk.cellLayoutAddAttribute(column, icon, "icon-name", 1);
    Gtk.treeViewSetEnableTreeLines(vw, true);
    const path = Gtk.treePathNewFromIndices([0]);
    Gtk.treeViewExpandRow(vw, path, false);
    return [vw, store, sorted, renameEvent, activateEvent, menuEvent, B.filterJust(selectEvent)];
  };

  // Handle mouse clicks to put up and remove menus. Right click activates a menu, next click
  // removes it. Other clicks are rejected.
  const buttonHandler = (vw: Gtk.TreeView, event: Gdk.EventButton): [boolean, Maybe<ModelPath>] => {
    const button = Gdk.getEventButtonButton(event);
    const x1 = round(Gdk.getEventButtonX(event));
    const y1 = round(Gdk.getEventButtonY(event));
    const [x2, y2] = Gtk.treeViewConvertWidgetToBinWindowCoords(vw, x1, y1);
    if (button === 3) { // Right button
      const [, path1] = Gtk.treeViewGetPathAtPos(vw, x2, y2);
      if (path1 !== null) {
        // path2 <- fromMaybe [] <$> Gtk.treePathGetIndices path1
        const path2 = fromNullable<ModelPath>(Gtk.treePathGetIndices(path1));
        return [true, path2];
      }
      return [false, Just([])];
    }
    return [false, Nothing];
  };

  // Handle key presses. For now only <Delete> is processed.
  const recognisedKeys = M.fromList<number, (sel: S.Set<ModelId>) => Script<P, V>>([
    [Gdk.KEY_Delete, (sel) => function* (c): ModelScript<P, V, Maybe<string>> { // lift $ do
      const nms = S.toList(sel).map((i) => {
        goToEntity(c, i);
        const nm = currentName(c);
        delete_(c);
        return nm;
      });
      if (nms.length === 0) return Nothing;
      if (nms.length === 1) return Just("Deleted " + nms[0]);
      return Just("Deleleted " + T.pack(showInt(nms.length)) + " entities");
    }],
  ]);
  const keyPressHandler = (k: Gdk.EventKey): [boolean, Maybe<(sel: S.Set<ModelId>) => Script<P, V>>] => {
    const v = Gdk.getEventKeyKeyval(k);
    const r = M.lookup(v, recognisedKeys);
    return [isJust(r), r];
  };

  // Track the tree selection. The set of selected rows is not an attribute so we can't
  // use behaviorLink here. Also we have to be careful not to touch the selection when
  // nothing has changed.
  const updateSelection = (
    ref: IORef<boolean>, selection: Gtk.TreeSelection, model: Model<V>, newSet1: S.Set<ModelId>,
  ): void => {
    writeIORef(ref, true); // Block creation of selection events from these changes.
    const getPaths = (c: ModelEditCtx<V, V>): number[][] => S.toList(newSet1).map((i) => {
      goToEntity(c, i);
      return currentTreePath(c);
    });
    const r = evalModelEdit(cls, identity<V>(), model, getPaths);
    if (r.tag === "Left") {
      // Should never happen.
    } else {
      const newPaths = r.value;
      const newSet2 = S.fromList<ModelPath>(newPaths);
      const treeView = Gtk.treeSelectionGetTreeView(selection);
      const oldSet = getSelectedRows(selection);
      const addSet = S.toList(S.difference(newSet2, oldSet)).map(Gtk.treePathNewFromIndices);
      const unSet = S.toList(S.difference(oldSet, newSet2)).map(Gtk.treePathNewFromIndices);
      for (const path of addSet) {
        Gtk.treeViewExpandToPath(treeView, path);
        Gtk.treeSelectionSelectPath(selection, path);
      }
      for (const path of unSet) Gtk.treeSelectionUnselectPath(selection, path);
    }
    writeIORef(ref, false); // Re-enble selection events.
  };

  // Get the data into a TreeStore.
  const forest = monadic<ModelError, Forest<GtkEntity>>([], evalModelEdit(cls, identity<V>(), modelInit, gtkEntities));
  const [vw, store, sorted, renameEvent, activateEvent, menuPath, selectE] =
    createTreeview(Name(modelInit.modelName), forest);
  // Set up event for activation dialogs.
  const info = GtkTreeInfo(store, sorted, vw, picF);
  const [activationError, activatedItem] = B.split(B.apply(
    B.mapB((m: Model<V>) => (act: (c: ModelEditCtx<V, V>) => Maybe<Entity<V>>) => evalModelEdit(cls, identity<V>(), m, act),
      modelC.changesB),
    B.mapE((uuid: ModelId) => (c: ModelEditCtx<V, V>): Maybe<Entity<V>> => {
      goToEntity(c, uuid);
      return current(c);
    }, activateEvent),
  ));
  const activationUpdates = B.mapE((e: Maybe<Entity<V>>) => cls.editableActivation(e), activatedItem);
  // Web: the error boxes of these handlers are shown without waiting for them to be closed.
  const stop1 = reactimate1(B.mapE((err: ModelError) => () => void modelErrorWarning(vw, err), activationError));
  // Set up event for menus.
  type MenuF = Maybe<Menu<Script<P, V>>>;
  const [menuError, menu] = B.split(B.apply(
    B.mapB((m: Model<V>) => (act: (c: ModelEditCtx<V, V>) => MenuF) => evalModelEdit(cls, identity<V>(), m, act),
      modelC.changesB),
    B.mapE((path: ModelPath) => (c: ModelEditCtx<V, V>): MenuF => {
      if (path.length === 0) return Nothing;
      goToTreePath(c, path);
      return cls.editableTreeMenu(current(c));
    }, menuPath),
  ));
  const menuEvent = B.execute(B.mapE((m: Menu<Script<P, V>>) => () => mkGtkMenu(m), B.filterJust(menu)));
  popupMenuOn(B.mapE((x: [Gtk.Menu, B.Event<Script<P, V>>]) => x[0], menuEvent));
  const menuEventOut = B.switchE(B.mapE((x: [Gtk.Menu, B.Event<Script<P, V>>]) => x[1], menuEvent));
  const stop2 = reactimate1(B.mapE((err: ModelError) => () => void modelErrorWarning(vw, err), menuError));
  // Get current model into an IORef. This is needed by D&D during callbacks.
  const modelRef = newIORef(modelInit);
  const stop3 = reactimate1(B.mapE((m: Model<V>) => () => writeIORef(modelRef, m), modelC.changesE));
  // Configure the TreeView for drag and drop, synchronised with the model.
  const moveEvent = modelDragAndDrop<P, V>(cls, info, vw, modelRef);
  // Intercept key commands.
  const keyEvent = B.filterJust(registerIOSignal1(vw, Gtk.onWidgetKeyPressEvent, keyPressHandler));
  const keyCommand = B.apply(  // keyEvent applied to selectB
    B.mapB((sel: S.Set<ModelId>) => (f: (sel: S.Set<ModelId>) => Script<P, V>) => f(sel), selectB),
    keyEvent,
  );
  // Define the model behaviour and apply these events to it.
  const renameEvent1 = B.mapE(([path, newName]: readonly [number[], Name]): Script<P, V> =>
    function* (c): ModelScript<P, V, Maybe<string>> { // lift $ do -- ModelEdit monad
      goToTreePath(c, path);
      const oldName = currentName(c);
      const changed = renameEntity(c, newName);
      if (changed) return Just("Rename " + oldName + " as " + view(nameText, newName));
      return Nothing;
    }, renameEvent);
  const modelScripts = sequenceEvents<P, V>(
    [renameEvent1, moveEvent, activationUpdates, menuEventOut, keyCommand]);
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
    stop3();
  });
  return [info, selectE, modelScripts];
}

/** Set up drag and drop for the GTK Treeview displaying the model. */
export function modelDragAndDrop<P, V>(
  cls: EntityClass<V>,
  info: GtkTreeInfo<V>,
  vw: Gtk.TreeView,
  modelRef: IORef<Model<V>>,
): B.Event<Script<P, V>> {
  const store = info._0;
  // Get the entity contents for the path. If root then return a fictional Package.
  // This is only used for checking D&D destinations, so a Package is the Right Thing.
  const getModelContents = (path: ModelPath): Maybe<V> => {
    const iter = treeIterFromPath(info, path);
    if (iter.tag === "Nothing") return Nothing;
    const model = readIORef(modelRef);
    const gEnt = getEntity(store, iter.value);
    if (U.isNil(gEnt.gtkId)) { // Root entity.
      return Just(review(cls._Package, Package<V>(Name(model.modelName), cls.packageMetaMempty)));
    }
    const ent = M.lookup(gEnt.gtkId, model.modelContents);
    if (ent.tag === "Nothing") { // GTK tree entity no longer in model. Got out of sych somehow.
      return Nothing;
    }
    return Just(view(entityContents<V>(), ent.value));
  };
  // True if you can drop the source on to the target.
  const moveCheck = (source: ModelPath, target: ModelPath): boolean => {
    const mSource = getModelContents(source);
    const mTarget = getModelContents(target);
    if (mSource.tag === "Just" && mTarget.tag === "Just") {
      const src = mSource.value, tgt = mTarget.value;
      return cls.entityCanMove(src) && cls.entityCanHaveChild(tgt, src);
    }
    return false; // Something has gone wrong, so disallow everything.
  };
  const makeMove = (source: ModelPath, target: ModelPath): Script<P, V> =>
    function* (c): ModelScript<P, V, Maybe<string>> { // lift $ do -- :: ModelEdit v (Maybe Text)
      goToTreePath(c, target);
      const targetId = currentId(c);
      const targetName = currentName(c);
      goToTreePath(c, source);
      const sourceName = currentName(c);
      moveEntity(c, targetId);
      return Just("Move " + sourceName + " to " + targetName);
    };

  // Start by doing the basic enabling for DnD on the model.
  const targets = dragTargets();
  Gtk.treeViewEnableModelDragSource(vw,
    [Gdk.ModifierTypeButton1Mask],
    targets,
    [Gdk.DragActionCopy]);
  Gtk.treeViewEnableModelDragDest(vw, targets, [Gdk.DragActionCopy]);
  // Notification of drop events.
  registerIOSignal6(vw, Gtk.onWidgetDragDataReceived, () => {
    Gtk.signalStopEmissionByName(vw, "drag_data_received");
    // Identifier as string: yuck! Have to do this or GTK throws a tantrum.
    return [null, Nothing];
  });
  registerIOSignal4(vw, Gtk.onWidgetDragMotion,
    (context: Gdk.DragContext, x1: number, y1: number, t: number): [boolean, Maybe<null>] => {
      // Not sure whether Gtk.dragStatus needs to be called in here or if it could be
      // done by reactimate, so I'll play safe and keep it in here.
      const [x2, y2] = Gtk.treeViewConvertWidgetToBinWindowCoords(vw, x1, y1);
      const [, mPath] = Gtk.treeViewGetPathAtPos(vw, x2, y2);
      if (mPath === null) return [false, Nothing];
      const path = mPath;
      const sel = Gtk.treeViewGetSelection(vw);
      const target = Gtk.treePathGetIndices(path) ?? [];
      const rows = S.toList(getSelectedRows(sel));
      if (rows.length === 1) {
        const source = rows[0];
        const ok = moveCheck(source, target);
        Gtk.treeViewSetDragDestRow(
          vw,
          ok ? path : null,
          Gtk.TreeViewDropPositionIntoOrAfter);
        Gdk.dragStatus(context, ok ? [Gdk.DragActionCopy] : [], t);
        return [ok, Nothing];
      }
      return [false, Nothing];
    });
  return B.filterJust(registerIOSignal4(vw, Gtk.onWidgetDragDrop,
    (context: Gdk.DragContext, x1: number, y1: number, t: number): [boolean, Maybe<Script<P, V>>] => {
      Gtk.signalStopEmissionByName(vw, "drag_drop"); // Identifier as string: yuck.
      // Need to do this to stop the default GTK tree drop processing.
      const [x2, y2] = Gtk.treeViewConvertWidgetToBinWindowCoords(vw, x1, y1);
      const [, mPath] = Gtk.treeViewGetPathAtPos(vw, x2, y2);
      if (mPath === null) {
        Gtk.dragFinish(context, false, false, t);
        return [false, Nothing];
      }
      const path = mPath;
      // target <- fromMaybe [] <$> Gtk.treePathGetIndices path
      const target = Gtk.treePathGetIndices(path) ?? [];
      const sel = Gtk.treeViewGetSelection(vw);
      const rows = S.toList(getSelectedRows(sel));
      if (rows.length === 1) {
        const source = rows[0];
        const ok = moveCheck(source, target);
        if (ok) {
          Gtk.dragFinish(context, true, false, t);
          return [true, Just(makeMove(source, target))];
        }
        Gtk.dragFinish(context, false, false, t);
        return [false, Nothing];
      }
      Gtk.dragFinish(context, false, false, t);
      return [false, Nothing];
    },
  ));
}

/* Design note:
DO NOT USE treeSetRowDragData and treeGetRowDragData. They seem to transmit the TreePath
of the underlying TreeModel instead of the sorted path used as input. This is the Wrong Thing
in this case.

The dragDataReceived signal is supposed to provide the coordinates of the signal in the widget.
However this is always (0,0). This is probably a bug in GTK3.
*/

/* Design note: how GTK3 drag and drop works, more or less. You can also do the "dragGetData"
sequence as part of the dragMotion handler.

    Sender               GTK3                  Receiver
     |                   |                       |
     |                   |--------dragDrop------>M
     |                   |                       M
     |                   M<---dragGetData--------M
     |                   M                       |
     M<---dragDataGet----M                       |
     M                   |                       |
     M-selectionDataSet->M                       |
     |                   M---dragDataReceived--->M
     |                   |                       M
     |                   M<--selectionDataGet----M
     |                   M----{returned data}--->M
     |                   |                       M
     |                   |<-----dragFinish-------M
     |                   |                       M
*/

/**
 * Comparison function for the sorted view of the GTK tree, using natural order sorting.
 * This ensures that the GTK tree order will match the model tree order.
 */
export function treeSortF(store: Gtk.TreeModel, iter1: Gtk.TreeIter, iter2: Gtk.TreeIter): number {
  const v1 = getEntity(store, iter1);
  const v2 = getEntity(store, iter2);
  switch (naturalOrder(view(nameText, v1.gtkName), view(nameText, v2.gtkName))) {
    case -1: return -1;
    case 0: return 0;
    case 1: return 1;
  }
}

/** Target information for dragging model entities around. */
export function dragTargets(): Gtk.TargetEntry[] {
  const entityTarget = Gtk.targetEntryNew(
    "modelEntity",
    Gtk.TargetFlagsSameApp,
    0, // InfoID not used, so just 0 for now.
  );
  return [entityTarget];
}

/** Pop up a warning about a failed model edit on the event. */
export function modelErrorWarningOn(parent: Gtk.Widget, errE: B.Event<ModelError>): void {
  // Web: the error box is shown without waiting for it to be closed.
  const stop = reactimate1(B.mapE((err: ModelError) => () => void modelErrorWarning(parent, err), errE));
  Gtk.onWidgetDestroy(parent, stop);
}

/**
 * Pop up a warning about a failed model edit.
 *
 * (Web: returns the Promise of `errorBox`, which resolves when the box is closed.)
 */
export function modelErrorWarning(parent: Gtk.Widget, err: ModelError): Promise<void> {
  switch (err.tag) {
    case "InternalError":
      return errorBox(parent, "An internal error has been detected:\n\n   " + err._0 +
        "\n\nPlease save your work in a new file and report this bug.");
    case "UserError":
      return errorBox(parent, err._0);
    default:
      return absurd(err);
  }
}

/**
 * Integrate model updates into a @Behavior@, updating the widget along
 * the way. Each \"ModelEdit\" event also triggers a corresponding \"HistoryItem\" event.
 * The return model is carried by both an event (with the latest update) and a behavior (with
 * the original value).
 *
 * @param gtkTree The GTK tree that needs to be updated in parallel with the model.
 * @param updates Updates to the model.
 * @param modelBlats Whole new model replacing existing one.
 */
export function processModelUpdates<V>(
  cls: EntityClass<V>,
  gtkTree: GtkTreeInfo<V>,
  updates: B.Event<ModelUpdate<V, Maybe<string>>>,
  modelBlats: B.Event<Model<V>>,
): B.Event<Model<V>> {
  const isUpdate = (u: ModelUpdate<V, Maybe<string>>): boolean => isJust(u.updateValue);
  const vw = gtkTree._2;
  const newModels = B.mapE((u: ModelUpdate<V, Maybe<string>>) => u.updateNewModel, B.filterE(isUpdate, updates));
  const logChanges = B.mapE((u: ModelUpdate<V, Maybe<string>>) => u.updateEditLog, B.filterE(isUpdate, updates));
  const modelE = B.unionWith((x: Model<V>, _y: Model<V>) => x, newModels, modelBlats);
  // Debug code: check that the updated model corresponds with the widget tree.
  // const stop3 = reactimate1(B.mapE((m) => () => checkGtkTree(cls, gtkTree, m), newModels));
  const stop1 = reactimate1(B.mapE((m: Model<V>) => () => replaceGtkTree(cls, gtkTree, m), modelBlats));
  const stop2 = reactimate1(B.mapE((l: readonly ModelEditLog<V>[]) => () => updateGtkTree(cls, vw, gtkTree, l), logChanges));
  Gtk.onWidgetDestroy(vw, () => {
    stop1();
    stop2();
  });
  return modelE;
}

/* Design note:

checkGtkTree should be enabled if there is doubt over whether the displayed tree in the GTK
TreeView matches the tree in the Hades Model. The most typical symptoms are that edits to the tree
cause errors about entity paths not existing or unrelated entities, or entities
mysteriously disappear from the TreeView. The updateGtkTree function is supposed to keep the two
in synch, but the code is complex and hence fragile.

The reactimate call to "checkGtkTree" above is in a race condition with the other two reactimates.
The ordering is imposed by Reactive Banana, and is deterministic but undefined. If it happens in
the wrong order then spurious warnings will be generated showing that the update has not occured.
If this happens then move the call to the other end of the list.

The test folder contains QuickCheck tests for the updateGtkTree routine.
*/

/*
// | Check that the model is consistent with the GTK tree.
// If discrepancies are found then it displays a diagnostic.
// (Commented out in the original; TypeScript translation kept here, also commented out.)
function checkGtkTree<V>(cls: EntityClass<V>, treeInfo: GtkTreeInfo<V>, model: Model<V>): void {
  const getGtkTree = (mdl: Model<V>): Tree<GtkEntity> => {
    const gtkEntities = (c: ModelEditCtx<V, V>) =>
      modelPackageForest(c).map((t) => fmapTree((e: Entity<V>) => entityToGtk(cls, () => "", e), t));
    const forest = monadic([], evalModelEdit(cls, identity<V>(), mdl, gtkEntities));
    return Node(GtkEntity(Name(mdl.modelName), "model-home", U.nil), forest);
  };
  const compareTree = (out: string[], path: string, t1: Tree<Name>, t2: Tree<Name>): void => {
    if (!equals(t1.rootLabel, t2.rootLabel)) out.push(path + ": " + show_Name(t1.rootLabel) + " /= " + show_Name(t2.rootLabel));
    if (t1.subForest.length === t2.subForest.length) {
      t1.subForest.forEach((c, i) => compareTree(out, path + "/" + show_Name(t1.rootLabel), c, t2.subForest[i]));
    } else {
      out.push(path + ": child count " + t1.subForest.length + " /= " + t2.subForest.length);
    }
  };
  const gtkSorted = treeInfo._1;
  const [, iter] = Gtk.treeModelGetIter(gtkSorted, Gtk.treePathNewFromIndices([0]));
  const widgetTree = fmapTree((e: GtkEntity) => e.gtkName, getEntityTree(gtkSorted, iter));
  const modelTree = fmapTree((e: GtkEntity) => e.gtkName, getGtkTree(model));
  if (!equals(modelTree, widgetTree)) {
    const out: string[] = [];
    compareTree(out, "/", modelTree, widgetTree);
    cannotHappen(out.join("\n"), null);
  }
}
*/
