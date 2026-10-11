import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { identity, lens, prism_, set, view } from "@/lib/Control/Lens";
import { Node } from "@/lib/Data/Tree";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { RefTypeTable, mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { BuiltInDef, Field, migrateField } from "@/hades/src/Model/Reflection/Types";
import { ExtText, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type Package, Name, Package as mkPackageValue,
  addCheckedRelation, checkModel, current, emptyModel, entityName, getModel, goToEntity, goToRoot, mkEntity,
  mkPackage, modelStartState, nameField, nameText, runModelEdit,
} from "./PackageTree";
import {
  JSON_ModelExport, ModelExport, exportEntities, exportTree, importEntities, importMetadata, makeExport,
} from "./ModelExport";

// Compare persistent maps and sets by their contents (Haskell Eq), not their tree shapes.
expect.addEqualityTesters([
  (a: unknown, b: unknown) =>
    a instanceof M.HMap || a instanceof S.HSet || b instanceof M.HMap || b instanceof S.HSet
      ? equals(a, b)
      : undefined,
]);

// A minimal entity type: packages and named items. Items cannot have children.
type TV =
  | { readonly tag: "P"; readonly _0: Package<TV, null> }
  | { readonly tag: "I"; readonly _0: Name };
const pkgV = (p: Package<TV, null>): TV => ({ tag: "P", _0: p });
const itemV = (n: string): TV => ({ tag: "I", _0: Name(n) });
const tvName = lens(
  (v: TV) => (v.tag === "P" ? v._0._packageName : v._0),
  (v: TV, n: Name): TV => (v.tag === "P" ? pkgV({ ...v._0, _packageName: n }) : { tag: "I", _0: n }),
);
const tvJ: J.JSONCodec<TV> = J.codec(
  (v) => J.object([["tag", v.tag], ["name", view(tvName, v)._0]]),
  (j) => J.withObject("TV", (o) => {
    const nm = Name(J.field(o, "name", J.textJ));
    return J.field(o, "tag", J.textJ) === "P" ? pkgV(mkPackageValue(nm, null)) : { tag: "I", _0: nm };
  }, j),
);
const cls: EntityClass<TV, null> = {
  reflectiveName: (v) => (v.tag === "P" ? "Package" : "Item"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [pkgV(mkPackageValue(Name(""), null)), itemV("")],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(tvName, v)._0)),
  reflectiveSet: (st, v) => set(tvName, Name(extract(st, view(tvName, v)._0, _ExtText, nameField)), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: tvName,
  _Package: prism_((p: Package<TV, null>) => pkgV(p), (v: TV) => (v.tag === "P" ? Just(v._0) : Nothing)),
  entityCanHaveChild: (p) => p.tag === "P",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: tvJ,
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
};

function run<A>(model: Model<TV>, act: (c: ModelEditCtx<TV, TV>) => A): [A, Model<TV>] {
  const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), model), act);
  if (r.tag === "Left") throw new Error(JSON.stringify(r.value));
  return [r.value[0].updateValue, r.value[0].updateNewModel];
}

const nameOf = (e: Entity<TV>) => view(entityName(cls).dot(nameText), e);

// Root: package P1 containing items A and B; item C at the root. Relations A-B and A-C.
const colourId = migrateField("Colour");
const [ids, model1] = run(emptyModel(cls, "Test"), (c) => {
  const p1 = mkPackage(c, Name("P1"));
  goToEntity(c, p1);
  const a = mkEntity(c, itemV("A"));
  const b = mkEntity(c, itemV("B"));
  goToRoot(c);
  const cc = mkEntity(c, itemV("C"));
  addCheckedRelation(c, "Ref", a, b);
  addCheckedRelation(c, "Ref", a, cc);
  return { p1, a: a.entityId, b: b.entityId, c: cc.entityId };
});
const model: Model<TV> = {
  ...model1,
  modelFields: M.singleton(colourId, Field(false, colourId, "Colour", "One", BuiltInDef("ModelText"))),
  modelExtensions: M.singleton("Item", [colourId]),
};

describe("exportTree and exportEntities", () => {
  const e = (n: string, parent: U.UUID, ident: number): Entity<TV> => ({
    entityId: U.fromWords(0, 0, 0, ident),
    _entityParent: parent,
    _entityChildren: M.empty(),
    _entityContents: itemV(n),
    _entityExtensions: M.empty(),
    entityCreated: ["u", "2020-01-01"],
    _entityModified: ["u", "2020-01-01"],
  });
  it("flattens a tree and detaches the root", () => {
    const root = e("R", U.fromWords(0, 0, 0, 9), 1);
    const kid = e("K", root.entityId, 2);
    const grandKid = e("G", kid.entityId, 3);
    const list = exportTree(Node(root, [Node(kid, [Node(grandKid)])]));
    expect(list.map(nameOf)).toEqual(["R", "K", "G"]);
    expect(list[0]._entityParent).toBe(U.nil);
    expect(list[2]._entityParent).toBe(kid.entityId);
  });
  it("prefers parented duplicates and keeps relations between exported entities", () => {
    const x = e("X", U.nil, 1);
    const xParented = e("X", U.fromWords(0, 0, 0, 7), 1);
    const y = e("Y", U.nil, 2);
    const nr = NR.insert(x.entityId, U.fromWords(0, 0, 0, 5), "R",
      NR.insert(x.entityId, y.entityId, "R", NR.empty<U.UUID>()));
    const [rels, list] = exportEntities(nr, [x, y, xParented]);
    expect(list).toEqual([xParented, y]);
    // ("toList" lists each relation once, under the lesser ID.)
    expect(NR.toList(rels)).toEqual([[x.entityId, [[y.entityId, "R"]]], [y.entityId, []]]);
    const [rels2, list2] = exportEntities(nr, [xParented, x]);
    expect(list2).toEqual([xParented]);
    expect(NR.toList(rels2)).toEqual([]);
  });
});

describe("makeExport", () => {
  it("exports a subtree with its internal relations", () => {
    const [ex] = run(model, (c) => makeExport(c, S.singleton(ids.p1), false));
    expect(ex.exportContents.map(nameOf)).toEqual(
      [...M.elems(model.modelContents)].filter((x) => nameOf(x) !== "C").map(nameOf));
    expect(NR.relation(ids.a, "Ref", ex.exportRelations)).toEqual(S.singleton(ids.b));
    expect(ex.exportFields).toEqual(M.empty());
    const [ex2] = run(model, (c) => makeExport(c, S.singleton(U.nil), true));
    expect(ex2.exportContents.length).toBe(4);
    expect(ex2.exportFields).toEqual(model.modelFields);
    expect(ex2.exportExtensions).toEqual(model.modelExtensions);
  });
});

describe("JSON", () => {
  it("writes the aeson field names and round trips", () => {
    const [ex] = run(model, (c) => makeExport(c, S.singleton(U.nil), true));
    const codec = JSON_ModelExport(cls);
    const js = codec.toJSON(ex) as J.JSONObject;
    expect(Object.keys(js)).toEqual(
      ["exportContents", "exportRelations", "exportFields", "exportRefTypes", "exportExtensions"]);
    expect(js.exportExtensions).toEqual({ Item: [colourId] });
    expect(Object.keys(js.exportFields as J.JSONObject)).toEqual([colourId]);
    const back = codec.parseJSON(JSON.parse(JSON.stringify(js)));
    expect(back).toEqual(ex);
  });
});

describe("importEntities and importMetadata", () => {
  it("copies an export into another model", () => {
    const [ex] = run(model, (c) => makeExport(c, S.singleton(ids.p1), true));
    const [, imported] = run(emptyModel(cls, "Other"), (c) => {
      importEntities(c, U.nil, ex.exportRelations, ex.exportContents);
      importMetadata(c, ex);
      checkModel(c);
    });
    expect([...M.elems(imported.modelContents)].map(nameOf).sort()).toEqual(["A", "B", "P1"]);
    expect(M.keys(imported.modelRoot).map((n) => n._0)).toEqual(["P1"]);
    expect(NR.relation(ids.b, "Ref", imported.modelRelations)).toEqual(S.singleton(ids.a));
    expect(imported.modelFields).toEqual(model.modelFields);
    expect(imported.modelExtensions).toEqual(model.modelExtensions);
  });

  it("overwrites existing entities with the same ID", () => {
    const [ex] = run(model, (c) => makeExport(c, S.singleton(ids.p1), false));
    const [, again] = run(model, (c) => {
      importEntities(c, U.nil, ex.exportRelations, ex.exportContents);
      goToEntity(c, ids.a);
      return current(c);
    });
    expect(M.size(again.modelContents)).toBe(4);
    // Deleting the old version of A also deleted its relation to C, which was not exported.
    expect(NR.relation(ids.a, "Ref", again.modelRelations)).toEqual(S.fromList([ids.b]));
    expect(NR.relation(ids.c, "Ref", again.modelRelations)).toEqual(S.empty());
  });

  it("rolls back on errors", () => {
    const [ex] = run(model, (c) => makeExport(c, S.singleton(ids.p1), false));
    // Importing a package under an item is not allowed.
    const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), model), (c) => {
      importEntities(c, ids.c, ex.exportRelations, ex.exportContents);
      return getModel(c);
    });
    expect(r.tag).toBe("Left");
    if (r.tag === "Left") {
      expect(r.value.tag).toBe("UserError");
      expect(r.value._0.startsWith("Error found during import. Rolling back.\n\n\"")).toBe(true);
    }
  });

  it("merges metadata", () => {
    const otherId = migrateField("Other");
    const ex = ModelExport<TV>([], NR.empty(),
      M.singleton(otherId, Field(false, otherId, "Other", "One", BuiltInDef("ModelInt"))),
      RefTypeTable(M.empty()), M.singleton("Item", [otherId, colourId]));
    const [, m2] = run(model, (c) => importMetadata(c, ex));
    expect(M.keys(m2.modelFields).sort()).toEqual([colourId, otherId].sort());
    expect(M.findWithDefault([], "Item", m2.modelExtensions)).toEqual([colourId, otherId]);
  });
});
