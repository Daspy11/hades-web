import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import { equals } from "@/lib/Data/Ord";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { identity, lens, prism_, set, view } from "@/lib/Control/Lens";
import { OkApplyButton, OkButton } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { ExtText, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, Name, Package, addCheckedRelation, currentId,
  descriptionField, emptyModel, goToEntity, goToRoot, mkEntity, mkPackage, modelStartState, nameField,
  runModelEdit, show_ModelError,
} from "./PackageTree";
import {
  compareReferenceValues, getReferenceValues, modelFilter, modelItemSpecifier, modelSubsetSpecifier,
  putReferenceValues, reflectiveDialog, refPicker, showEntitySet,
} from "./Properties";

// Compare persistent maps and sets by their contents (Haskell Eq), not their tree shapes.
expect.addEqualityTesters([
  (a: unknown, b: unknown) =>
    a instanceof M.HMap || a instanceof S.HSet || b instanceof M.HMap || b instanceof S.HSet
      ? equals(a, b)
      : undefined,
]);

interface TV {
  readonly nm: Name;
}
const cls = {
  name: lens((v: TV) => v.nm, (v: TV, n: Name) => ({ ...v, nm: n })),
} as unknown as EntityClass<TV>;

const id = (n: number): U.UUID => U.fromWords(0, 0, 0, n);

describe("reference values", () => {
  const rels = NR.insert(id(1), id(4), "Tail",
    NR.insert(id(1), id(3), "Ref",
      NR.insert(id(1), id(2), "Ref", NR.empty<U.UUID>())));

  it("getReferenceValues groups the related entities by relation", () => {
    expect(getReferenceValues(id(1), rels)).toEqual(M.fromList([
      ["Ref", S.fromList([id(2), id(3)])],
      ["Tail", S.fromList([id(4)])],
    ]));
    expect(getReferenceValues(id(2), rels)).toEqual(M.fromList([["Ref", S.fromList([id(1)])]]));
    expect(getReferenceValues(id(9), rels)).toEqual(M.empty());
  });

  it("compareReferenceValues lists the changed entities", () => {
    const refs1 = M.fromList([["Ref", S.fromList([id(2), id(3)])], ["Tail", S.fromList([id(4)])]]);
    const refs2 = M.fromList([["Ref", S.fromList([id(3), id(5)])], ["Head", S.fromList([id(6)])]]);
    expect(compareReferenceValues(refs1, refs2)).toEqual([id(2), id(4), id(5), id(6)]);
    expect(compareReferenceValues(refs1, refs1)).toEqual([]);
  });
});

describe("showEntitySet", () => {
  const ent = (n: number, nm: string): Entity<TV> =>
    ({ entityId: id(n), _entityContents: { nm: Name(nm) } }) as unknown as Entity<TV>;
  const model = {
    modelContents: M.fromList([[id(1), ent(1, "item10")], [id(2), ent(2, "item9")], [id(3), ent(3, "Alpha")]]),
  } as unknown as Model<TV>;

  it("lists names in natural order", () => {
    expect(showEntitySet(cls, model, S.fromList([id(1), id(2), id(3), id(7)]))).toBe("Alpha, item9, item10");
    expect(showEntitySet(cls, model, S.empty())).toBe(" - ");
  });
});

// ---------------------------------------------------------------------------------------------
// Model based functions, with a minimal entity type: packages and named items with descriptions.

type TV2 =
  | { readonly tag: "P"; readonly _0: Package<TV2, null> }
  | { readonly tag: "I"; readonly _0: Name; readonly desc: string };
const pkgV = (p: Package<TV2, null>): TV2 => ({ tag: "P", _0: p });
const itemV = (n: string, desc = ""): TV2 => ({ tag: "I", _0: Name(n), desc });
const tvName = lens(
  (v: TV2) => (v.tag === "P" ? v._0._packageName : v._0),
  (v: TV2, n: Name): TV2 => (v.tag === "P" ? pkgV({ ...v._0, _packageName: n }) : { ...v, _0: n }),
);
const cls2: EntityClass<TV2, null> = {
  reflectiveName: (v) => (v.tag === "P" ? "Package" : "Item"),
  variantUserLabel: (v) => "The " + v,
  reflectiveDefaults: [pkgV(Package(Name(""), null)), itemV("")],
  reflectiveBuiltIn: (v) => (v.tag === "P" ? [nameField] : [nameField, descriptionField]),
  reflectiveGet: (v) => v.tag === "P"
    ? M.singleton(nameField, ExtText(view(tvName, v)._0))
    : M.fromList([[nameField, ExtText(v._0._0)], [descriptionField, ExtText(v.desc)]]),
  reflectiveSet: (st, v) => {
    const v2 = set(tvName, Name(extract(st, view(tvName, v)._0, _ExtText, nameField)), v);
    return v2.tag === "P" ? v2 : { ...v2, desc: extract(st, v2.desc, _ExtText, descriptionField) };
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: tvName,
  _Package: prism_((p: Package<TV2, null>) => pkgV(p), (v: TV2) => (v.tag === "P" ? Just(v._0) : Nothing)),
  entityCanHaveChild: (p) => p.tag === "P",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(() => null, () => itemV("")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
};

function run<A>(model: Model<TV2>, act: (c: ModelEditCtx<TV2, TV2>) => A): [A, Model<TV2>] {
  const r = runModelEdit(cls2, identity<TV2>(), modelStartState(newGenerator(), model), act);
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  return [r.value[0].updateValue, r.value[0].updateNewModel];
}

const [ids, model2] = run(emptyModel(cls2, "Test"), (c) => {
  const p = mkPackage(c, Name("Pkg"));
  goToEntity(c, p);
  const a = mkEntity(c, itemV("A", "First para.\n\nSecond para."));
  const b = mkEntity(c, itemV("B"));
  goToRoot(c);
  const cc = mkEntity(c, itemV("C"));
  addCheckedRelation(c, "Ref", a, cc);
  return { p, a: a.entityId, b: b.entityId, c: cc.entityId };
});

describe("modelFilter", () => {
  it("returns the package tree with selectable entities and descriptions", () => {
    const forest = modelFilter(cls2, (e) => e._entityContents.tag === "I", model2);
    const flat = forest.map((t) => [t.rootLabel, t.subForest.map((s) => s.rootLabel)]);
    expect(flat).toEqual([
      [["C", Nothing, Just(ids.c)], []],
      [["Pkg", Nothing, Nothing], [["A", Just("First para."), Just(ids.a)], ["B", Nothing, Just(ids.b)]]],
    ]);
  });
});

describe("putReferenceValues", () => {
  it("replaces the references of an entity", () => {
    const ent = (m: Model<TV2>, u: U.UUID) => M.findWithDefault(undefined as never, u, m.modelContents);
    const refs = M.fromList([["Ref", S.fromList([ids.b])], ["Other", S.fromList([ids.c, ids.p])]]);
    const [, m] = run(model2, (c) => {
      goToEntity(c, ids.b);
      putReferenceValues(c, ent(model2, ids.a), refs);
      return currentId(c);
    });
    expect(getReferenceValues(ids.a, m.modelRelations)).toEqual(refs);
    expect(getReferenceValues(ids.c, m.modelRelations)).toEqual(M.fromList([["Other", S.fromList([ids.a])]]));
    expect(compareReferenceValues(getReferenceValues(ids.a, model2.modelRelations), refs))
      .toEqual(S.toList(S.fromList([ids.b, ids.c, ids.p])));
  });
});

describe("dialogs", () => {
  it("reflectiveDialog builds a properties dialog for the selected entity", () => {
    const ent = M.findWithDefault(undefined as never, ids.a, model2.modelContents);
    const sel = reflectiveDialog<TV2, null>(cls2, () => Nothing);
    const d = sel(model2, Just([ent, getReferenceValues(ids.a, model2.modelRelations)] as const));
    expect(d.tag).toBe("Just");
    if (d.tag === "Just") {
      expect(d.value.dialogTitle).toBe("The Item properties");
      expect(d.value.dialogButtons).toEqual(OkApplyButton);
      expect(d.value.dialogGadget.tag).toBe("Accum");
    }
    const none = sel(model2, Nothing);
    expect(none.tag === "Just" && none.value.dialogTitle).toBe("Nothing selected");
  });

  it("refPicker validates the number of selected items", () => {
    const single = refPicker<TV2>(cls2, true, () => true);
    expect(single.dialogTitle).toBe("Single Selector");
    expect(single.dialogButtons).toEqual(OkButton);
    const g = single.dialogGadget;
    expect(g.tag).toBe("Validate");
    if (g.tag === "Validate") {
      expect(g._0(model2, S.empty(), S.fromList([ids.a]))).toBe(true);
      expect(g._0(model2, S.empty(), S.fromList([ids.a, ids.b]))).toBe(false);
    }
    expect(refPicker<TV2>(cls2, false, () => true).dialogTitle).toBe("Multi Selector");
  });

  it("modelItemSpecifier intercepts clicks with the picker", () => {
    const g = modelItemSpecifier<TV2, null>(cls2, () => () => true, () => Nothing);
    expect(g.tag).toBe("Intercept");
    if (g.tag === "Intercept") {
      expect(g._0).toBe(false);
      const d = g._1(model2, S.empty());
      expect(d.tag === "Just" && d.value.dialogTitle).toBe("Single Selector");
    }
    const g2 = modelSubsetSpecifier<TV2, null>(cls2, () => () => true, () => Nothing);
    expect(g2.tag === "Intercept" && g2._1(model2, S.empty()).tag === "Just").toBe(true);
  });
});
