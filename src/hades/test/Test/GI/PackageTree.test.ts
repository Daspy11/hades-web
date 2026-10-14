// Ported from hades/test/Test/GI/PackageTree.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Randomised tests of the model package tree ("Model.Abstract.PackageTree") and of the GTK
 * tree view that mirrors it ("Model.GI.PackageTree").
 *
 * TypeScript port
 * ---------------
 * * QuickCheck is replaced by a tiny deterministic generator library defined here: a
 *   `Gen<A>` is a function of a `GenCtx` (a seeded PRNG plus the QuickCheck "size"), and the
 *   `Arbitrary a` class is the dictionary `Arbitrary<A>` (`arbitrary`, `shrink`). Instances are
 *   `Arbitrary_TestItem` and `Arbitrary_Model(cls, arbA)`.
 * * `TestItem` (`newtype TestItem = TestPackage {getPackage :: Package TestItem}`) is the record
 *   `{ getPackage }`; its `Reflective`/`EntityClass` instance is `EntityClass_TestItem`. The
 *   Haskell type has no JSON instances; the TypeScript dictionary needs `entityJ`, which is
 *   provided through the package codec.
 * * The GTK half of the original test (`getGtkTree`, `gtkTestTree`, `prop_treeOp`, `runTests`)
 *   runs against the toolkit's `Gtk.TreeStore`/`Gtk.TreeModelSort` at the end of this file.
 *   `runTests` returns the QuickCheck result as `[success, counterexample]`, and the vitest
 *   test asserts it. In addition, "edit log replay" checks the same property without GTK:
 *   replaying the "ModelEditLog" of a random sequence of tree operations onto a plain tree
 *   (what `updateGtkTree` does to the GTK tree store) gives the tree of the new model.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Gtk from "@/lib/GI/Gtk";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { compare, equals } from "@/lib/Data/Ord";
import { Node, drawTree, fmapTree, flattenForest, type Forest, type Tree } from "@/lib/Data/Tree";
import { error } from "@/lib/Prelude";
import { identity, iso, view, type Iso } from "@/lib/Control/Lens";
import { CryptoRandomGen_Generator, type Generator as UUIDGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { Variant } from "@/hades/src/Model/Reflection/Values";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import {
  type Entity, type EntityClass, type Model, type ModelEdit, type ModelEditCtx, type ModelEditLog, type ModelEditState,
  type ModelId, type ModelUpdate, Name, Package, JSON_Model, JSON_Package, Reflective_Package, checkModel, currentPath, delete_,
  emptyModel, entityName, eq_Model, evalModelEdit, execModelEdit, goToEntity, mkEntity, modelPackageForest,
  modelStartState, monadic, moveEntity, nameText, packageName, renameEntity, runModelEdit, show_ModelEditLog,
  show_ModelError, stateModel,
} from "@/hades/src/Model/Abstract/PackageTree";
import {
  GtkEntity, GtkTreeInfo, clearTree, entityColumnTypes, entityToGtk, getEntityTree, show_GtkEntity,
  storeEntityForest, treeSortF, updateGtkTree,
} from "@/hades/src/Model/GI/PackageTree";

/** Messages of the error boxes shown by "modelErrorWarning" (errorBox is mocked). */
const shownErrors: string[] = vi.hoisted(() => []);
vi.mock("@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox", async (orig) => ({
  ...(await orig<typeof import("@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox")>()),
  errorBox: async (_parent: unknown, msg: string) => {
    shownErrors.push(msg);
  },
}));

// ---------------------------------------------------------------------------------------------
// Minimal QuickCheck replacement.

/** The generator context: a PRNG returning numbers in [0, 1) and the QuickCheck size. */
interface GenCtx {
  readonly rng: () => number;
  readonly size: number;
}
/** QuickCheck `Gen a`. */
type Gen<A> = (g: GenCtx) => A;

/** The `Arbitrary` class. */
interface Arbitrary<A> {
  readonly arbitrary: Gen<A>;
  shrink(a: A): A[];
}

/** mulberry32: a small seeded PRNG. */
function mkRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `choose (lo, hi)` for integers (inclusive). */
function chooseInt(lo: number, hi: number): Gen<number> {
  return (g) => lo + Math.floor(g.rng() * (hi - lo + 1));
}
/** `choose (lo, hi)` for characters. */
function chooseChar(lo: string, hi: string): Gen<string> {
  return (g) => String.fromCodePoint(chooseInt(lo.codePointAt(0)!, hi.codePointAt(0)!)(g));
}
function oneof<A>(gens: readonly Gen<A>[]): Gen<A> {
  return (g) => gens[chooseInt(0, gens.length - 1)(g)](g);
}
function vectorOf<A>(n: number, gen: Gen<A>): Gen<A[]> {
  return (g) => Array.from({ length: n }, () => gen(g));
}
function elements<A>(xs: readonly A[]): Gen<A> {
  if (xs.length === 0) return error("QuickCheck.elements used with empty list");
  return (g) => xs[chooseInt(0, xs.length - 1)(g)];
}
/** `arbitrary :: Gen Int`: uniform in [-size, size]. */
const arbitraryInt: Gen<number> = (g) => chooseInt(-g.size, g.size)(g);
/** `Positive n <- arbitrary`. */
const arbitraryPositive: Gen<number> = (g) => chooseInt(1, Math.max(1, g.size))(g);

/** Haskell `Right (gen :: Generator) = newGen "..."`. */
function newGenOrFail(seed: string): UUIDGenerator {
  const r = CryptoRandomGen_Generator.newGen(U.encodeUtf8(seed));
  if (r.tag === "Left") return error("Irrefutable pattern failed for pattern Right gen");
  return r.value;
}

// ---------------------------------------------------------------------------------------------
// Test entity type

/** `newtype TestItem = TestPackage {getPackage :: Package TestItem} deriving Eq` */
interface TestItem {
  readonly getPackage: Package<TestItem, null>;
}
function TestPackage(getPackage: Package<TestItem, null>): TestItem {
  return { getPackage };
}

const testPackage: Iso<TestItem, Package<TestItem, null>> = iso(
  (t: TestItem) => t.getPackage,
  (p: Package<TestItem, null>) => TestPackage(p),
);

/** The `Reflective (Package TestItem)` instance the `TestItem` instance delegates to. */
function pkgReflective(): Reflective<Package<TestItem, null>> {
  return Reflective_Package_TestItem;
}

/** `instance Reflective TestItem` and `instance EntityClass TestItem` (`PackageMeta TestItem = ()`). */
const EntityClass_TestItem: EntityClass<TestItem, null> = {
  reflectiveName: (_t) => Variant("Test"),
  variantUserLabel: (v) => v,
  get reflectiveDefaults() {
    return pkgReflective().reflectiveDefaults.map(TestPackage);
  },
  reflectiveBuiltIn: (t) => pkgReflective().reflectiveBuiltIn(t.getPackage),
  reflectiveGet: (t) => pkgReflective().reflectiveGet(t.getPackage),
  reflectiveSet: (st, t) => TestPackage(pkgReflective().reflectiveSet(st, t.getPackage)),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: testPackage.dot(packageName<TestItem, null>()),
  _Package: testPackage,
  entityCanHaveChild: (_p, _c) => true,
  entityCanMove: (_t) => true,
  entityExports: (_ctx, _e) => [],
  entityClone: (_e, _n) => error("TestItem entityClone not implemented."),
  get entityFunctions(): never {
    return error("TestItem entityFunctions not implemented.");
  },
  // TypeScript only: the Haskell TestItem has no JSON instances.
  entityJ: J.codec(
    (t: TestItem) => JSON_Package(EntityClass_TestItem).toJSON(t.getPackage),
    (v) => TestPackage(JSON_Package(EntityClass_TestItem).parseJSON(v)),
  ),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
};

const Reflective_Package_TestItem = Reflective_Package(EntityClass_TestItem);

/** `instance Arbitrary TestItem` */
const Arbitrary_TestItem: Arbitrary<TestItem> = {
  arbitrary: (g) => {
    const arbName: Gen<Name> = (g1) => Name(vectorOf(10, oneof([chooseChar("A", "Z"), chooseChar("a", "z")]))(g1).join(""));
    return TestPackage(Package(arbName(g), null));
  },
  shrink: () => [],
};

/** `instance (Arbitrary a, EntityClass a) => Arbitrary (Model a)` */
function Arbitrary_Model<A>(cls: EntityClass<A>, arbA: Arbitrary<A>): Arbitrary<Model<A>> {
  const genA = newGenOrFail("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const genS = newGenOrFail("1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  return {
    arbitrary: (g) => {
      const n = Math.abs(arbitraryInt(g));
      const go = (i: number, state: ModelEditState<A>): Model<A> => {
        let st = state;
        for (let k = i; k > 0; k--) st = modelGen(cls, arbA, (m) => addArbitraryEntity(cls, arbA, m), st)(g);
        return stateModel(st);
      };
      return go(n, modelStartState(genA, emptyModel(cls, "Test")));
    },
    shrink: (model) => {
      const uuids = M.keys(model.modelContents);
      const delOne = (uuid: ModelId): Model<A> => {
        const r = execModelEdit(cls, identity<A>(), modelStartState(genS, model), (c) => {
          goToEntity(c, uuid);
          delete_(c);
        });
        if (r.tag === "Left") return error("Failed to delete an item during shrink: " + show_ModelError(r.value));
        return r.value[0];
      };
      return uuids.map(delOne);
    },
  };
}

/** Execute an arbitrary model edit on the model state. */
function modelStep<A>(
  cls: EntityClass<A>,
  _arbA: Arbitrary<A>,
  gen: (m: Model<A>) => Gen<ModelEdit<A, A, void>>,
  state: ModelEditState<A>,
): Gen<[ModelUpdate<A, void>, ModelEditState<A>]> {
  return (g) => {
    const act = gen(stateModel(state))(g);
    const r = runModelEdit(cls, identity<A>(), state, act);
    if (r.tag === "Left") return error("modelGen: " + show_ModelError(r.value));
    return r.value;
  };
}

/** Like "modelStep", but throw away the results and keep only the mutated state. */
function modelGen<A>(
  cls: EntityClass<A>,
  arbA: Arbitrary<A>,
  gen: (m: Model<A>) => Gen<ModelEdit<A, A, void>>,
  state: ModelEditState<A>,
): Gen<ModelEditState<A>> {
  return (g) => modelStep(cls, arbA, gen, state)(g)[1];
}

function addArbitraryEntity<A>(cls: EntityClass<A>, arbA: Arbitrary<A>, model: Model<A>): Gen<ModelEdit<A, A, void>> {
  const entity = (parent: ModelId, v: A): ModelEdit<A, A, void> => (c) => {
    goToEntity(c, parent);
    mkEntity(c, v);
  };
  return (g) => {
    const v = arbA.arbitrary(g);
    const parent = pickPackage(cls, model)(g);
    return entity(parent, v);
  };
}

/** Select one of the operations that change the visible tree. */
function arbitraryTreeOp<A>(cls: EntityClass<A>, arbA: Arbitrary<A>, model: Model<A>): Gen<[ModelEdit<A, A, void>, string]> {
  return (g) => {
    const entityM = pickEntity(cls, model)(g);
    const pkg = pickPackage(cls, model)(g);
    const newItem = arbA.arbitrary(g);
    const newItemName = view(cls.name, newItem);
    const showT = (n: Name) => JSON.stringify(view(nameText, n));
    const ops: [ModelEdit<A, A, void>, string][] = [
      [
        (c) => {   // Add a new entity.
          goToEntity(c, pkg);
          mkEntity(c, newItem);
        },
        "Add new package in " + pkg + ": " + showT(newItemName),
      ],
    ];
    if (entityM.tag === "Just") {
      const entity = entityM.value;
      const entName = view(entityName(cls), entity);
      ops.push(
        [
          (c) => {   // Rename an entity.
            goToEntity(c, entity.entityId);
            renameEntity(c, newItemName);
          },
          "Rename " + showT(entName) + " as " + showT(newItemName),
        ],
        [
          (c) => {   // Delete an entity.
            goToEntity(c, entity.entityId);
            delete_(c);
          },
          "Delete " + showT(entName) + " " + entity.entityId,
        ],
        [
          (c) => {   // Move an entity. No-op if the package is a child of the entity.
            goToEntity(c, pkg);
            const p = currentPath(c).map((e) => e.entityId);
            if (!p.includes(entity.entityId)) {
              goToEntity(c, entity.entityId);
              moveEntity(c, pkg);
            }
          },
          "Move " + showT(entName) + " to " + pkg,
        ],
      );
    }
    return elements(ops)(g);
  };
}

function arbitraryTreeOpSequence<A>(
  cls: EntityClass<A>,
  arbA: Arbitrary<A>,
  n: number,
  state: ModelEditState<A>,
): Gen<[ModelEdit<A, A, void>, string][]> {
  return (g) => {
    const result: [ModelEdit<A, A, void>, string][] = [];
    let st = state;
    for (let i = n; i >= 1; i--) {
      const op1 = arbitraryTreeOp(cls, arbA, stateModel(st))(g);
      const r = runModelEdit(cls, identity<A>(), st, op1[0]);
      if (r.tag === "Left") return error("Irrefutable pattern failed: " + op1[1] + ": " + show_ModelError(r.value));
      st = r.value[1];
      result.push(op1);
    }
    return result;
  };
}

/** Pick an arbitrary entity from the model. Returns @Nothing@ for an empty model. */
function pickEntity<A>(_cls: EntityClass<A>, model: Model<A>): Gen<Maybe<Entity<A>>> {
  const es = M.elems(model.modelContents);
  if (es.length === 0) return () => Nothing;
  return (g) => Just(elements(es)(g));
}

/** Pick an arbitrary package, possibly the root. */
function pickPackage<A>(_cls: EntityClass<A>, model: Model<A>): Gen<ModelId> {
  return elements([U.nil, ...M.elems(model.modelContents).map((e) => e.entityId)]);
}

function sortTree<A>(t: Tree<A>): Tree<A> {
  const kids = t.subForest.map(sortTree);
  return Node(t.rootLabel, [...kids].sort((x, y) => compare(x.rootLabel, y.rootLabel)));
}

// ---------------------------------------------------------------------------------------------
// GTK-free analogue of `prop_treeOp`: the tree shown to the user, as (name, id) pairs.

/** Stand-in for `GtkEntity` (name and id; the icon is always "" in the original test). */
type TreeEntity = readonly [string, ModelId];

/** As `getGtkTree`, but with plain (name, id) labels. */
function modelTree<A>(cls: EntityClass<A>, model: Model<A>): Tree<TreeEntity> {
  const forest = monadic<unknown, Forest<Entity<A>>>([], evalModelEdit(cls, identity<A>(), model, modelPackageForest));
  return Node([model.modelName, U.nil] as TreeEntity,
    forest.map((t) => fmapTree((e: Entity<A>): TreeEntity => [view(entityName(cls), e)._0, e.entityId], t)));
}

/**
 * Apply an edit log to a displayed tree, in the way "updateGtkTree" applies it to the GTK
 * tree store.
 */
function replayLog<A>(cls: EntityClass<A>, tree0: Tree<TreeEntity>, logs: readonly ModelEditLog<A>[]): Tree<TreeEntity> {
  type T = Tree<TreeEntity>;
  const remove = (t: T, u: ModelId): [T, Maybe<T>] => {
    let found: Maybe<T> = Nothing;
    const go = (n: T): T => Node(n.rootLabel, n.subForest.filter((c) => {
      if (c.rootLabel[1] === u) {
        found = Just(c);
        return false;
      }
      return true;
    }).map(go));
    const r = go(t);
    return [r, found];
  };
  const insertUnder = (t: T, parent: ModelId, sub: T): T =>
    t.rootLabel[1] === parent
      ? Node(t.rootLabel, [...t.subForest, sub])
      : Node(t.rootLabel, t.subForest.map((c) => insertUnder(c, parent, sub)));
  const rename = (t: T, u: ModelId, nm: string): T =>
    Node(t.rootLabel[1] === u ? [nm, u] : t.rootLabel, t.subForest.map((c) => rename(c, u, nm)));
  const nameIn = (m: Model<A>, u: ModelId): string =>
    U.isNil(u) ? m.modelName : view(entityName(cls), M.find(m.modelContents, u))._0;
  let tree = tree0;
  for (const l of logs) {
    switch (l.tag) {
      case "ModelAdd": {
        const e = M.find(l._1.modelContents, l._0);
        tree = insertUnder(tree, e._entityParent, Node([view(entityName(cls), e)._0, e.entityId] as TreeEntity, []));
        break;
      }
      case "ModelDelete":
        tree = U.isNil(l._0) ? Node(tree.rootLabel, []) : remove(tree, l._0)[0];
        break;
      case "ModelMove": {
        const [t1, sub] = remove(tree, l._0);
        if (sub.tag === "Nothing") throw new Error("ModelMove of an entity not in the tree");
        const e = M.find(l._2.modelContents, l._0);
        tree = insertUnder(t1, e._entityParent, sub.value);
        break;
      }
      case "ModelRename":
        tree = rename(tree, l._0, nameIn(l._2, l._0));
        break;
      case "ModelOther":
        break;
    }
  }
  return tree;
}

// ---------------------------------------------------------------------------------------------
// Tests

const runGen = <A>(gen: Gen<A>, seed: number, size: number): A => gen({ rng: mkRng(seed), size });
const arbModel = Arbitrary_Model(EntityClass_TestItem, Arbitrary_TestItem);
const consistent = (m: Model<TestItem>) =>
  evalModelEdit(EntityClass_TestItem, identity<TestItem>(), m, checkModel);

describe("Test.GI.PackageTree: model generation", () => {
  it("arbitrary models are consistent and have the requested size", () => {
    for (let i = 0; i < 100; i++) {
      const m = runGen(arbModel.arbitrary, i, i);
      expect(consistent(m)).toEqual({ tag: "Right", value: undefined });
      expect(M.size(m.modelContents)).toBeLessThanOrEqual(i);
      expect(M.size(m.modelRoot)).toBeLessThanOrEqual(M.size(m.modelContents));
    }
  });

  it("generated names are ten ASCII letters", () => {
    const t = runGen(Arbitrary_TestItem.arbitrary, 1, 10);
    expect(view(EntityClass_TestItem.name, t)._0).toMatch(/^[A-Za-z]{10}$/);
  });

  it("shrinking deletes an entity and its subtree, keeping the model consistent", () => {
    for (let i = 0; i < 30; i++) {
      const m = runGen(arbModel.arbitrary, 1000 + i, 20 + i);
      const smaller = arbModel.shrink(m);
      expect(smaller.length).toBe(M.size(m.modelContents));
      for (const s of smaller) {
        expect(consistent(s).tag).toBe("Right");
        expect(M.size(s.modelContents)).toBeLessThan(M.size(m.modelContents));
      }
    }
  });

  it("generated models round-trip through JSON", () => {
    const j = JSON_Model(EntityClass_TestItem);
    for (let i = 0; i < 20; i++) {
      const m = runGen(arbModel.arbitrary, 2000 + i, 30);
      expect(eq_Model(j.parseJSON(JSON.parse(JSON.stringify(j.toJSON(m)))), m)).toBe(true);
    }
  });
});

describe("Test.GI.PackageTree: random tree operations", () => {
  const gen = newGenOrFail("3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

  it("keep the model consistent, and the edit log replays to the new tree (prop_treeOp without GTK)", () => {
    const cls = EntityClass_TestItem;
    for (let i = 0; i < 300; i++) {
      const size = i % 100;
      const g: GenCtx = { rng: mkRng(7919 * i + 13), size };
      const model = arbModel.arbitrary(g);
      const n = arbitraryPositive(g);
      const state = modelStartState(gen, model);
      const acts = arbitraryTreeOpSequence(cls, Arbitrary_TestItem, n, state)(g);
      const r = runModelEdit(cls, identity<TestItem>(), state, (c) => acts.map(([act]) => act(c)));
      if (r.tag === "Left") throw new Error("prop_treeOp: " + show_ModelError(r.value));
      const [update, newState] = r.value;
      const counterexample = () =>
        "Acts = " + JSON.stringify(acts.map((a) => a[1])) + "\nEditLog = " +
        update.updateEditLog.map(show_ModelEditLog).join("");
      expect(consistent(stateModel(newState)).tag, counterexample()).toBe("Right");
      const newModelTree = modelTree(cls, stateModel(newState));
      const replayed = replayLog(cls, modelTree(cls, model), update.updateEditLog);
      const sortT = (t: Tree<TreeEntity>) => sortTree(t);
      expect(sortT(replayed), counterexample() + "\nTree = " + drawTree(fmapTree((x) => x.join(" "), replayed)))
        .toEqual(sortT(newModelTree));
      // Every entity in the model is in the tree exactly once.
      expect(flattenForest(newModelTree.subForest).length).toBe(M.size(stateModel(newState).modelContents));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The GTK half of the original test: the tree store is updated with "updateGtkTree".

function getGtkTree<A>(cls: EntityClass<A>, model: Model<A>): Tree<GtkEntity> {
  const gtkEntities = (c: ModelEditCtx<A, A>): Forest<GtkEntity> =>
    modelPackageForest(c).map((t) => fmapTree((e: Entity<A>) => entityToGtk(cls, () => "", e), t));
  const forest = monadic<unknown, Forest<GtkEntity>>([], evalModelEdit(cls, identity<A>(), model, gtkEntities));
  return Node(GtkEntity(Name(model.modelName), "model-home", U.nil), forest);
}

/** Set up the GTK test data. */
function gtkTestTree<A>(cls: EntityClass<A>, model: Model<A>): GtkTreeInfo<A> {
  const forest = getGtkTree(cls, model).subForest;
  const store = Gtk.treeStoreNew(entityColumnTypes);
  const sorted = Gtk.new_(Gtk.TreeModelSort, { model: store });
  const vw = Gtk.treeViewNewWithModel(sorted);
  Gtk.treeSortableSetSortFunc(sorted, 0, treeSortF);
  Gtk.treeSortableSetSortColumnId(sorted, 0, Gtk.SortTypeAscending);
  const iter = clearTree(store, Name(model.modelName));
  storeEntityForest(store, iter, forest);
  return GtkTreeInfo(store, sorted, vw, () => "");
}

/** QuickCheck `Property` result: success, or the counterexample text. */
type Property = { readonly ok: true } | { readonly ok: false; readonly counterexample: string };

function prop_treeOp(
  window: Gtk.Widget,
  state: ModelEditState<TestItem>,
  acts: readonly [ModelEdit<TestItem, TestItem, void>, string][],
): Property {
  const cls = EntityClass_TestItem;
  const monitor: string[] = [];
  monitor.push("Acts = " + JSON.stringify(acts.map((a) => a[1])));
  const r = runModelEdit(cls, identity<TestItem>(), state, (c) => acts.map(([act]) => act(c)));
  if (r.tag === "Left") return error("prop_treeOp: " + show_ModelError(r.value));
  const [update, newState] = r.value;
  const newModelTree = getGtkTree(cls, stateModel(newState));
  monitor.push("EditLog = " + update.updateEditLog.map(show_ModelEditLog).join(""));
  // run $ do
  const treeInfo = gtkTestTree(cls, stateModel(state));
  updateGtkTree(cls, window, treeInfo, update.updateEditLog);
  const gtkSorted = treeInfo._1;
  const [, iter] = Gtk.treeModelGetIter(gtkSorted, Gtk.treePathNewFromIndices([0]));
  const newGtkTree = getEntityTree(gtkSorted, iter);
  monitor.push("GTK tree = " + drawTree(fmapTree(show_GtkEntity, newGtkTree)));
  return equals(newGtkTree, newModelTree) ? { ok: true } : { ok: false, counterexample: monitor.join("\n") };
}

/**
 * Run many tests. Note that this calls Gtk.initGUI and creates a window.
 *
 * (TypeScript: `quickCheckWithResult stdArgs {maxSuccess = 1000}` is a loop over 1000 seeded
 * cases with the QuickCheck size cycling through 0..99; the result also carries the first
 * counterexample.)
 */
function runTests(): [boolean, string] {
  const gen = newGenOrFail("3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  Gtk.init(null);
  const window = Gtk.windowNew(Gtk.WindowTypeToplevel);
  const maxSuccess = 1000;
  for (let i = 0; i < maxSuccess; i++) {
    const g: GenCtx = { rng: mkRng(104729 * i + 7), size: i % 100 };
    const model = arbModel.arbitrary(g);
    const n = arbitraryPositive(g);
    const state = modelStartState(gen, model);
    const acts = arbitraryTreeOpSequence(EntityClass_TestItem, Arbitrary_TestItem, n, state)(g);
    const p = prop_treeOp(window, state, acts);
    if (!p.ok) return [false, "Failed after " + (i + 1) + " tests:\n" + p.counterexample];
  }
  return [true, ""];
}

describe("Test.GI.PackageTree: GTK tree view", () => {
  it("prop_treeOp: updateGtkTree keeps the GTK tree in step with the model (runTests)", () => {
    shownErrors.length = 0;
    const [ok, counterexample] = runTests();
    // Any "modelErrorWarning" from updateGtkTree would have shown an error box.
    expect(shownErrors).toEqual([]);
    expect(ok, counterexample).toBe(true);
  }, 120000);

  it("sortTree sorts children by label at every level", () => {
    const t = Node(3, [Node(2, [Node(9), Node(1)]), Node(1)]);
    expect(sortTree(t)).toEqual(Node(3, [Node(1), Node(2, [Node(1), Node(9)])]));
  });
});
