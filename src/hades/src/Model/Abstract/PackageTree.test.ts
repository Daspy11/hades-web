import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as B from "@/lib/Reactive/Banana";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { type Either } from "@/lib/Data/Either";
import { compare, equals } from "@/lib/Data/Ord";
import { flattenForest } from "@/lib/Data/Tree";
import { identity, lens, preview, prism_, set, view, type Prism } from "@/lib/Control/Lens";
import { CryptoRandomGen_Generator, type Generator as UUIDGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { mempty_RefTypeTable, mkOneToMany, refTypeTableFromList, refTypeTableToList } from "@/hades/src/Model/Reflection/References";
import { migrateField } from "@/hades/src/Model/Reflection/Types";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelEditState, type ModelError, Name,
  Package, JSON_Entity, JSON_Model, JSON_Package, JSON_Name, JSONKey_Name, ModelErrorException, UserError,
  addCheckedRelation, addEntity, catchError, checkModel, checkType, cloneEntity, createPath, current, currentId,
  currentName, currentPath, delete_, depth, emptyModel, entityName, entityStampsAsFields, eq_Model, evalModelEdit,
  execModelEdit, followPath, fromHere, getData, getMeta, goToEntity, goToEntity1, goToRoot, mkEntity, mkPackage,
  modelNewName, modelPackageForest, modelStartState, modifyValue, moveEntity, nameField, nameText, queryModel,
  renameEntity, runModelEdit, searchEntities, sequenceEvents, setData, setMeta, setValue, show_Model,
  show_ModelEditLog, stateLog, thisChange, throwUser, try_, unsafeEntityClone, withBaseType, withSubtype,
} from "./PackageTree";

// ---------------------------------------------------------------------------------------------
// A minimal entity class for the example files: packages are parsed properly, everything else
// is kept as an opaque JSON object whose name is read from "name" (or "diagram.name" for query
// diagrams).

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

const dsmClass: EntityClass<DsmItem, J.Value> = {
  reflectiveName: (v) => (v.tag === "DsmPackage" ? Variant("Package") : Variant(String(v._0.type ?? "Query Diagram"))),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(dsmName, v)._0)),
  reflectiveSet: (st, v) => set(dsmName, Name(extract(st, view(dsmName, v)._0, _ExtText, nameField)), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: dsmName,
  _Package: dsmPackage,
  entityCanHaveChild: () => true,
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: DsmItem): J.Value => (v.tag === "DsmPackage" ? JSON_Package_Dsm().toJSON(v._0) : v._0),
    (val) => J.withObject("DsmItem", (o): DsmItem =>
      (o.type === "package" ? { tag: "DsmPackage", _0: JSON_Package_Dsm().parseJSON(o) } : { tag: "DsmOther", _0: o }), val),
  ),
  packageMetaJ: J.valueJ,
  packageMetaMempty: {},
  packageMetaAppend: (a, b) => ({ ...(a as J.JSONObject), ...(b as J.JSONObject) }),
};
function JSON_Package_Dsm() {
  return JSON_Package(dsmClass);
}

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, J.JSONObject][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

const modelJ = JSON_Model(dsmClass);

describe("Model JSON with the example files", () => {
  it("has the examples", () => {
    expect(examples.length).toBe(4);
  });

  for (const [file, json] of examples) {
    describe(file, () => {
      const model = modelJ.parseJSON(json);

      it("parses every entity and the package tree is consistent", () => {
        expect(M.size(model.modelContents)).toBe((json.modelContents as J.Value[]).length);
        expect(model.modelName).toBe((json.modelName as string).trim());
        const r = evalModelEdit(dsmClass, identity<DsmItem>(), model, (c) => {
          checkModel(c);
          return flattenForest(modelPackageForest(c)).length;
        });
        expect(r).toEqual({ tag: "Right", value: M.size(model.modelContents) });
      });

      it("round-trips through JSON", () => {
        const encoded = modelJ.toJSON(model);
        expect(eq_Model(modelJ.parseJSON(encoded), model)).toBe(true);
        if (Array.isArray(json.modelFields)) {
          // Current file format: the encoding is exactly the original JSON.
          expect(encoded).toEqual(json);
        } else {
          // Old format: field tables are migrated to field IDs.
          const out = encoded as J.JSONObject;
          expect(Array.isArray(out.modelFields)).toBe(true);
          expect((out.modelFields as J.Value[]).length).toBe(Object.keys(json.modelFields as J.JSONObject).length);
          const exts = model.modelExtensions;
          const oldExts = json.modelExtensions as Record<string, string[]>;
          for (const [variant, names] of Object.entries(oldExts)) {
            expect(M.lookup(Variant(variant), exts)).toEqual(Just(names.map(migrateField)));
          }
        }
      });

      it("migrates entity extension keys", () => {
        for (const ejson of json.modelContents as J.JSONObject[]) {
          const ent = M.find(model.modelContents, ejson.identity as string);
          const keys = Object.keys(ejson.extensions as J.JSONObject);
          expect(M.keys(ent._entityExtensions).sort()).toEqual(keys.map((k) => U.fromText(k).tag === "Just" ? k : migrateField(k)).sort());
          expect(ent.entityCreated).toEqual(ejson.created);
          expect(ent._entityModified).toEqual(ejson.modified);
          expect(view(entityName(dsmClass), ent)._0).toBe(rawName(ejson.contents as J.JSONObject).trim());
        }
      });

      it("shows the model tree", () => {
        const s = show_Model(dsmClass, model);
        expect(s.startsWith("Model " + model.modelName + "\n")).toBe(true);
        expect(s).not.toContain("showModelTree");
      });
    });
  }

  it("searches entity properties", () => {
    const model = modelJ.parseJSON(examples.find(([f]) => f.startsWith("3"))![1]);
    const r = evalModelEdit(dsmClass, identity<DsmItem>(), model, (c) => searchEntities(c, true, "PILOTAGE"));
    expect(r.tag).toBe("Right");
    if (r.tag === "Right") {
      expect(r.value.length).toBeGreaterThan(0);
      for (const [mId, hits] of r.value) {
        expect(M.member(mId, model.modelContents)).toBe(true);
        expect(hits.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("Entity JSON", () => {
  const entJ = JSON_Entity(dsmClass);
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";

  it("parses version 0.5 package entities", () => {
    const e = entJ.parseJSON({ identity: a, parent: U.nil, name: "Pkg", package: { " Child": b } });
    expect(e.entityId).toBe(a);
    expect(preview(dsmPackage, e._entityContents)).toEqual(Just(Package(Name("Pkg"), {})));
    // V0.5 keys are not stripped.
    expect(M.keys(e._entityChildren)).toEqual([Name(" Child")]);
    expect(e.entityCreated).toEqual(thisChange());
  });

  it("parses version 0.5 items with old-style extensions", () => {
    const item = { name: "Thing", type: "Goal", extensions: { Owner: { type: "text", value: "me" } } };
    const e = entJ.parseJSON({ identity: a, parent: b, item });
    expect(e._entityContents).toEqual({ tag: "DsmOther", _0: item });
    expect(M.toList(e._entityExtensions)).toEqual([[migrateField("Owner"), ExtText("me")]]);
    expect(M.size(e._entityChildren)).toBe(0);
  });

  it("defaults missing stamps and strips child names", () => {
    const e = entJ.parseJSON({
      identity: a, parent: U.nil, children: { " x ": b }, extensions: {},
      contents: { type: "package", name: " P ", meta: null },
    });
    expect(M.keys(e._entityChildren)).toEqual([Name("x")]);
    expect(preview(dsmPackage, e._entityContents)).toEqual(Just(Package(Name("P"), {})));
    expect(e._entityModified).toEqual(thisChange());
  });

  it("rejects a non-package as a package", () => {
    expect(() => JSON_Package(dsmClass).parseJSON({ type: "Goal", name: "x" })).toThrow(/Goal is not a package/);
  });

  it("checkType", () => {
    expect(() => checkType({ type: "foo" }, "foo")).not.toThrow();
    expect(() => checkType({ type: "bar" }, "foo")).toThrow(/Type = "bar", expected "foo"/);
  });
});

describe("Name", () => {
  it("uses natural order", () => {
    const names = ["item10", "item9", "Alpha", "item 2"].map(Name);
    expect([...names].sort(compare).map((n) => n._0)).toEqual(["Alpha", "item 2", "item9", "item10"]);
    expect(equals(Name("x"), Name("x"))).toBe(true);
    expect(equals(Name("x"), Name("y"))).toBe(false);
    const m = M.fromList([[Name("b10"), 1], [Name("b9"), 2]]);
    expect(M.keys(m).map((n) => view(nameText, n))).toEqual(["b9", "b10"]);
  });

  it("JSON strips white space", () => {
    expect(JSON_Name.parseJSON("  hello ")).toEqual(Name("hello"));
    expect(JSON_Name.toJSON(Name(" a "))).toBe(" a ");
    expect(JSONKey_Name.fromKey(" k ")).toEqual(Name("k"));
    expect(J.mapJ(JSONKey_Name, J.intJ).toJSON(M.fromList([[Name("a"), 1]]))).toEqual({ a: 1 });
  });
});

// ---------------------------------------------------------------------------------------------
// ModelEdit operations, with a small test entity type.

type Item =
  | { readonly tag: "Pkg"; readonly _0: Package<Item, null> }
  | { readonly tag: "Leaf"; readonly name: Name; readonly value: number };

const itemPackage: Prism<Item, Package<Item, null>> = prism_(
  (p: Package<Item, null>): Item => ({ tag: "Pkg", _0: p }),
  (v: Item) => (v.tag === "Pkg" ? Just(v._0) : Nothing),
);
const itemName = lens(
  (v: Item): Name => (v.tag === "Pkg" ? v._0._packageName : v.name),
  (v: Item, n: Name): Item => (v.tag === "Pkg" ? { tag: "Pkg", _0: { ...v._0, _packageName: n } } : { ...v, name: n }),
);
type Leaf = Extract<Item, { tag: "Leaf" }>;
const _Leaf: Prism<Item, Leaf> = prism_((l: Leaf): Item => l, (v: Item) => (v.tag === "Leaf" ? Just(v) : Nothing));
const leafValue = lens((l: Leaf) => l.value, (l: Leaf, value: number): Leaf => ({ ...l, value }));
const Leaf = (n: string, value = 0): Item => ({ tag: "Leaf", name: Name(n), value });

const itemClass: EntityClass<Item, null> = {
  reflectiveName: (v) => Variant(v.tag),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(itemName, v)._0)),
  reflectiveSet: (st, v) => set(itemName, Name(extract(st, view(itemName, v)._0, _ExtText, nameField)), v),
  // One package owns many leaves: each leaf has a single owner.
  reflectiveBuiltInRefs: mkOneToMany("Owner", [Variant("Pkg")], [Variant("Leaf")]),
  reflectiveArrows: M.empty(),
  name: itemName,
  _Package: itemPackage,
  // Leaves cannot have children.
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: (e, n) => (e._entityContents.tag === "Leaf" ? Just((c) => unsafeEntityClone(c, e, n)) : Nothing),
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: Item): J.Value => (v.tag === "Pkg"
      ? JSON_Package(itemClass).toJSON(v._0)
      : { type: "leaf", name: JSON_Name.toJSON(v.name), value: v.value }),
    (val) => J.withObject("Item", (o): Item => (o.type === "package"
      ? { tag: "Pkg", _0: JSON_Package(itemClass).parseJSON(o) }
      : { tag: "Leaf", name: J.field(o, "name", JSON_Name), value: J.field(o, "value", J.intJ) }), val),
  ),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
};

const gen0: UUIDGenerator = (() => {
  const r = CryptoRandomGen_Generator.newGen(U.encodeUtf8("a".repeat(47)));
  if (r.tag === "Left") throw new Error("newGen");
  return r.value;
})();

function run<A>(st: ModelEditState<Item>, act: (c: ModelEditCtx<Item, Item>) => A) {
  return runModelEdit(itemClass, identity<Item>(), st, act);
}
function ok<L, R>(e: Either<L, R>): R {
  if (e.tag === "Left") throw new Error("Unexpected Left: " + JSON.stringify(e.value));
  return e.value;
}
function errOf<R>(e: Either<ModelError, R>): ModelError {
  if (e.tag === "Right") throw new Error("Expected Left");
  return e.value;
}

/** A model with packages A (containing leaves x, y) and B, and a leaf z at the root. */
function sample() {
  const st0 = modelStartState(gen0, emptyModel(itemClass, "Sample"));
  const [u, st] = ok(run(st0, (c) => {
    const a = mkPackage(c, Name("A"));
    const b = mkPackage(c, Name("B"));
    const z = mkEntity(c, Leaf("z")).entityId;
    goToEntity(c, a);
    const x = mkEntity(c, Leaf("x", 1)).entityId;
    const y = mkEntity(c, Leaf("y", 2)).entityId;
    goToRoot(c);
    return { a, b, x, y, z };
  }));
  // A fresh state (empty edit log) that continues with the same UUID generator.
  const fresh = modelStartState(st.stateGenerator, u.updateNewModel);
  return { ids: u.updateValue, st: fresh, model: u.updateNewModel, log: u.updateEditLog };
}
const consistent = (m: Model<Item>) => evalModelEdit(itemClass, identity<Item>(), m, checkModel).tag === "Right";

describe("ModelEdit", () => {
  it("builds a consistent tree and logs additions", () => {
    const { ids, model, log } = sample();
    expect(consistent(model)).toBe(true);
    expect(M.size(model.modelContents)).toBe(5);
    expect(log.map((l) => l.tag)).toEqual(["ModelAdd", "ModelAdd", "ModelAdd", "ModelAdd", "ModelAdd"]);
    expect(show_ModelEditLog(log[0])).toBe("ModelAdd " + ids.a + "\n");
    expect(M.keys(model.modelRoot).map((n) => n._0)).toEqual(["A", "B", "z"]);
    const r = ok(evalModelEdit(itemClass, identity<Item>(), model, (c) => {
      followPath(c, [Name("A"), Name("y")]);
      return [currentId(c), depth(c), currentName(c), currentPath(c).map((e) => e.entityId)] as const;
    }));
    expect(r).toEqual([ids.y, 2, "y", [ids.y, ids.a]]);
  });

  it("rejects duplicate names and illegal children", () => {
    const { ids, st } = sample();
    expect(errOf(run(st, (c) => mkPackage(c, Name("A"))))).toEqual(UserError("A already exists."));
    expect(errOf(run(st, (c) => { goToEntity(c, ids.z); mkEntity(c, Leaf("q")); })))
      .toEqual(UserError("z cannot have q as a child."));
    expect(errOf(run(st, (c) => goToEntity(c, U.nextRandom()))).tag).toBe("UserError");
    expect(errOf(run(st, (c) => goToEntity1(c, "friendly", U.nextRandom())))).toEqual(UserError("friendly"));
    expect(errOf(run(st, (c) => followPath(c, [Name("A"), Name("nope")])))).toEqual(UserError("nope not found."));
  });

  it("try_ restores the state on user errors only", () => {
    const { st } = sample();
    const [u] = ok(run(st, (c) => {
      const r = try_(c, (c1) => {
        mkPackage(c1, Name("New"));
        return throwUser(c1, "boom");
      });
      return [r, M.size(c.state.stateModel.modelContents)] as const;
    }));
    expect(u.updateValue).toEqual([{ tag: "Left", value: "boom" }, 5]);
    expect(u.updateEditLog).toEqual([]);
    const e = run(st, (c) => try_(c, (c1) => { throw new ModelErrorException({ tag: "InternalError", _0: "bad" }); }));
    expect(errOf(e)).toEqual({ tag: "InternalError", _0: "bad" });
    const caught = ok(run(st, (c) => catchError(c, (c1) => { mkPackage(c1, Name("C")); return throwUser("x"); },
      (c1, err) => [err, M.size(getModelContents(c1))] as const)));
    expect(caught[0].updateValue).toEqual([UserError("x"), 5]);
  });

  it("renames entities and the model", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      goToEntity(c, ids.x);
      const r1 = renameEntity(c, Name(" w "));
      const r2 = renameEntity(c, Name("w"));
      goToRoot(c);
      const r3 = renameEntity(c, Name("Renamed"));
      return [r1, r2, r3];
    }));
    expect(u.updateValue).toEqual([true, false, true]);
    expect(u.updateNewModel.modelName).toBe("Renamed");
    expect(consistent(u.updateNewModel)).toBe(true);
    const pkgA = M.find(u.updateNewModel.modelContents, ids.a);
    expect(M.keys(pkgA._entityChildren).map((n) => n._0)).toEqual(["w", "y"]);
    expect(u.updateEditLog.map((l) => l.tag)).toEqual(["ModelRename", "ModelRename"]);
    expect(errOf(run(st, (c) => { goToEntity(c, ids.x); renameEntity(c, Name("y")); })))
      .toEqual(UserError("y already exists."));
  });

  it("modifies values through a subtype traversal", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      goToEntity(c, ids.x);
      const changed = withSubtype(c, _Leaf.dot(leafValue), (c1) => modifyValue(c1, (n) => n + 10));
      const same = withSubtype(c, _Leaf.dot(leafValue), (c1) => setValue(c1, 11));
      goToEntity(c, ids.a);
      const notLeaf = withSubtype(c, _Leaf.dot(leafValue), (c1) => setValue(c1, 3));
      return [changed, same, notLeaf];
    }));
    expect(u.updateValue).toEqual([true, false, false]);
    expect(M.find(u.updateNewModel.modelContents, ids.x)._entityContents).toEqual(Leaf("x", 11));
  });

  it("setData and getData", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      goToEntity(c, ids.y);
      const d = getData(c);
      const unchanged = setData(c, d);
      const changed = setData(c, M.insert(nameField, ExtText("yy"), d));
      goToRoot(c);
      const rootChanged = setData(c, M.singleton(nameField, ExtText(" Top ")));
      return [unchanged, changed, rootChanged, M.size(d)];
    }));
    // Name plus the four stamp fields.
    expect(u.updateValue).toEqual([false, true, true, 5]);
    expect(u.updateNewModel.modelName).toBe("Top");
    expect(view(entityName(itemClass), M.find(u.updateNewModel.modelContents, ids.y))).toEqual(Name("yy"));
    expect(consistent(u.updateNewModel)).toBe(true);
    const stamps = entityStampsAsFields(itemClass, M.find(u.updateNewModel.modelContents, ids.y));
    expect(M.size(stamps)).toBe(4);
  });

  it("package metadata", () => {
    const { ids, st } = sample();
    const r = ok(run(st, (c) => {
      const root = getMeta(c);
      goToEntity(c, ids.a);
      const pkg = getMeta(c);
      setMeta(c, null);
      goToEntity(c, ids.x);
      return [root, pkg, getMeta(c)];
    }));
    expect(r[0].updateValue).toEqual([Just(null), Just(null), Nothing]);
  });

  it("deletes subtrees and the whole model", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      goToEntity(c, ids.x);
      delete_(c);
      const afterLeaf = currentId(c);
      goToEntity(c, ids.a);
      delete_(c);
      return [afterLeaf, currentId(c)];
    }));
    expect(u.updateValue).toEqual([ids.a, U.nil]);
    expect(M.keys(u.updateNewModel.modelContents).sort()).toEqual([ids.b, ids.z].sort());
    expect(consistent(u.updateNewModel)).toBe(true);
    const [m2] = ok(execModelEdit(itemClass, identity<Item>(), st, (c) => delete_(c)));
    expect(M.size(m2.modelContents)).toBe(0);
    expect(m2.modelName).toBe("Sample");
  });

  it("moves entities, refusing cycles and conflicts", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      goToEntity(c, ids.z);
      moveEntity(c, ids.a);
      const here = currentId(c);
      goToEntity(c, ids.a);
      moveEntity(c, ids.b);
      return here;
    }));
    expect(u.updateValue).toBe(ids.z);
    const m = u.updateNewModel;
    expect(consistent(m)).toBe(true);
    expect(M.find(m.modelContents, ids.a)._entityParent).toBe(ids.b);
    expect(M.find(m.modelContents, ids.z)._entityParent).toBe(ids.a);
    expect(M.keys(m.modelRoot).map((n) => n._0)).toEqual(["B"]);
    expect(errOf(run(st, (c) => { goToEntity(c, ids.a); moveEntity(c, ids.x); })))
      .toEqual(UserError("Cannot move an entity inside itself."));
    expect(errOf(run(st, (c) => { goToEntity(c, ids.y); moveEntity(c, ids.z); })))
      .toEqual(UserError("Destination cannot have y as a child."));
    expect(errOf(run(st, (c) => moveEntity(c, ids.a)))).toEqual(UserError("Cannot move the model root."));
  });

  it("createPath, modelNewName and cloneEntity", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      const p1 = createPath(c, [Name("A"), Name("New"), Name("Deeper")]);
      goToRoot(c);
      const p2 = createPath(c, [Name("A"), Name("New")]);
      goToRoot(c);
      // "z" is a leaf, so a new package "z1" is made instead.
      const p3 = createPath(c, [Name("z")]);
      const n3 = currentName(c);
      goToRoot(c);
      const nn = modelNewName(c, Name("A"));
      goToEntity(c, ids.x);
      const cl = cloneEntity(c);
      goToEntity(c, ids.a);
      const clPkg = cloneEntity(c);
      return { p1, p2, p3, n3, nn, cl, clPkg };
    }));
    const v = u.updateValue;
    expect(v.p1[1]).toBe(true);
    expect(v.p2).toEqual([M.find(u.updateNewModel.modelContents, v.p1[0])._entityParent, false]);
    expect(v.p3[1]).toBe(true);
    expect(v.n3).toBe("z1");
    expect(v.nn).toEqual(Name("A1"));
    expect(v.cl.tag).toBe("Just");
    if (v.cl.tag === "Just") {
      expect(view(entityName(itemClass), v.cl.value)._0).toBe("x clone-1");
      expect(v.cl.value._entityParent).toBe(ids.a);
    }
    expect(v.clPkg).toEqual(Nothing);
    expect(consistent(u.updateNewModel)).toBe(true);
    expect(errOf(run(st, (c) => cloneEntity(c)))).toEqual(UserError("Cannot clone root."));
  });

  it("addCheckedRelation enforces single cardinality", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => {
      const ent = (i: string) => M.find(c.state.stateModel.modelContents, i);
      addCheckedRelation(c, "Owner", ent(ids.x), ent(ids.a));
      // A Leaf may only have one owner, so this replaces the first relation.
      addCheckedRelation(c, "Owner", ent(ids.x), ent(ids.b));
      addCheckedRelation(c, "Owner", ent(ids.y), ent(ids.b));
      // An unknown relation is not checked.
      addCheckedRelation(c, "Other", ent(ids.x), ent(ids.z));
      addCheckedRelation(c, "Other", ent(ids.y), ent(ids.z));
      return null;
    }));
    const rels = u.updateNewModel.modelRelations;
    expect(S.toList(NR.relation(ids.x, "Owner", rels))).toEqual([ids.b]);
    expect(S.toList(NR.relation(ids.b, "Owner", rels)).sort()).toEqual([ids.x, ids.y].sort());
    expect(S.toList(NR.relation(ids.z, "Other", rels)).sort()).toEqual([ids.x, ids.y].sort());
    expect(consistent(u.updateNewModel)).toBe(true);
    // Deleting an entity removes its relations.
    const [m2] = ok(execModelEdit(itemClass, identity<Item>(), modelStartState(gen0, u.updateNewModel), (c) => {
      goToEntity(c, ids.b);
      delete_(c);
    }));
    expect(S.size(NR.relation(ids.x, "Owner", m2.modelRelations))).toBe(0);
    expect(consistent(m2)).toBe(true);
  });

  it("fromHere returns to the nearest surviving ancestor", () => {
    const { ids, st } = sample();
    const r = ok(run(st, (c) => {
      goToEntity(c, ids.x);
      fromHere(c, (c1) => { goToEntity(c1, ids.x); delete_(c1); });
      const afterDelete = currentId(c);
      goToEntity(c, ids.y);
      fromHere(c, (c1) => goToRoot(c1));
      return [afterDelete, currentId(c)];
    }));
    expect(r[0].updateValue).toEqual([ids.a, ids.y]);
  });

  it("checkModel detects inconsistencies", () => {
    const { ids, model } = sample();
    const broken: Model<Item> = { ...model, modelContents: M.delete_(ids.y, model.modelContents) };
    const r = evalModelEdit(itemClass, identity<Item>(), broken, checkModel);
    expect(r.tag).toBe("Left");
    const badParent: Model<Item> = {
      ...model,
      modelContents: M.adjust((e: Entity<Item>) => ({ ...e, _entityParent: ids.b }), ids.x, model.modelContents),
    };
    expect(errOf(evalModelEdit(itemClass, identity<Item>(), badParent, checkModel)))
      .toEqual({ tag: "InternalError", _0: "Element not a child of its parent: \"x\"" });
    const badRel: Model<Item> = { ...model, modelRelations: NR.insert(ids.x, U.nextRandom(), "R", model.modelRelations) };
    expect(errOf(evalModelEdit(itemClass, identity<Item>(), badRel, checkModel)))
      .toEqual({ tag: "InternalError", _0: "Relations are not a subset of contents." });
    expect(show_Model(itemClass, broken)).toMatch(/^showModelTree: Model library/);
  });

  it("round-trips a generated model through JSON", () => {
    const { model } = sample();
    const j = JSON_Model(itemClass);
    const enc = j.toJSON(model);
    expect(eq_Model(j.parseJSON(JSON.parse(JSON.stringify(enc))), model)).toBe(true);
    expect(stateLog(modelStartState(gen0, model))).toEqual([]);
  });

  it("withBaseType and addEntity at a given parent", () => {
    const { ids, st } = sample();
    const [u] = ok(run(st, (c) => withSubtype(c, _Leaf, (c1) => {
      goToEntity(c1, ids.b);
      return withBaseType(c1, (c2) => addEntity(c2, (parent) => ({
        entityId: "33333333-3333-4333-8333-333333333333",
        _entityParent: parent,
        _entityChildren: M.empty(),
        _entityContents: Leaf("added"),
        _entityExtensions: M.empty(),
        entityCreated: thisChange(),
        _entityModified: thisChange(),
      }))._entityParent);
    })));
    expect(u.updateValue).toBe(ids.b);
    expect(consistent(u.updateNewModel)).toBe(true);
    expect(view(entityName(itemClass), M.find(u.updateNewModel.modelContents, "33333333-3333-4333-8333-333333333333")))
      .toEqual(Name("added"));
  });

  it("current at the root and refTypes table helpers", () => {
    const { model } = sample();
    expect(ok(evalModelEdit(itemClass, identity<Item>(), model, current))).toEqual(Nothing);
    expect(refTypeTableToList(refTypeTableFromList([])).length).toBe(0);
  });
});

describe("FRP wrappers", () => {
  it("queryModel splits results and errors", () => {
    const { ids, model } = sample();
    const results: unknown[] = [];
    const errors: ModelError[] = [];
    const [e, fire] = B.newEvent<U.UUID>();
    const net = B.compile(() => {
      const modelB = B.stepper(model, B.never<Model<Item>>());
      const [errE, resE] = queryModel(itemClass, identity<Item>(), modelB, e, (c, u: U.UUID) => {
        goToEntity(c, u);
        return currentName(c);
      });
      B.reactimate(B.mapE((x: string) => () => { results.push(x); }, resE));
      B.reactimate(B.mapE((x: ModelError) => () => { errors.push(x); }, errE));
    });
    B.actuate(net);
    fire(ids.x);
    fire(U.nextRandom());
    expect(results).toEqual(["x"]);
    expect(errors.length).toBe(1);
  });

  it("sequenceEvents combines simultaneous messages", () => {
    const { model } = sample();
    const out: Maybe<string>[] = [];
    const [e, fire] = B.newEvent<null>();
    const net = B.compile(() => {
      const acts = sequenceEvents<Item, Item>([
        B.mapE(() => () => Just("one"), e),
        B.mapE(() => () => Nothing, e),
        B.mapE(() => (c: ModelEditCtx<Item, Item>) => Just(getModelContentsSize(c)), e),
      ]);
      B.reactimate(B.mapE((act) => () => {
        const r = evalModelEdit(itemClass, identity<Item>(), model, act);
        if (r.tag === "Right") out.push(r.value);
      }, acts));
    });
    B.actuate(net);
    fire(null);
    expect(out).toEqual([Just("one, 5")]);
  });
});

function getModelContents(c: ModelEditCtx<Item, Item>) {
  return c.state.stateModel.modelContents;
}
function getModelContentsSize(c: ModelEditCtx<Item, Item>): string {
  return String(M.size(getModelContents(c)));
}
