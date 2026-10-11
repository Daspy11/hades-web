import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { identity, lens, prism, set, view, type Prism, type Traversal } from "@/lib/Control/Lens";
import { mempty_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type Action, type BoundBox, type Command, type DiagramId, type Point, type View,
  Action as mkAction, Activate, Key, Point as P, Select, addItem, applyDelta, boxCentre,
  connectableDefaults, deltaStateOf, diagramContents, diagramFromList, growBox, inBox, mkBoundBox,
  mkDiagramState, mkScriptAction, moveBox, noMod, noPaint, processAction, shiftMod, startDelta,
  tellItem, updateItem, yieldViews,
} from "@/hades/src/Hades/Abstract";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import {
  type Entity, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  Name, Package, current, currentName, emptyModel, entityName, entityProperties,
  goToEntity, goToRoot, mkEntity, mkPackage, modelStartState, nameField, nameText, packageName,
  runModelEdit, throwUser, unsafeEntityClone, modifyRelations,
} from "./PackageTree";
import {
  type Avatar, type DiagramEntity, type DiagramMetadataClass, type HasDiagrams, type ModelScriptAct,
  type UserScriptFunctor,
  DiagramEntity as mkDiagramEntity, DiagramWrapper, JSON_DiagramEntity, Reflective_DiagramEntity,
  ViewWrapper, ascend, avatarConnector, avatarProperties, clonePackage, deleteEntity,
  diagramAvatars, diagramEntityMenu, diagramEntityName, editEntityProperties,
  entityMenu, eq_DiagramEntity, findTextTool, insertEntity, keyCommands, logInsertion,
  nearestAvatar, newBoxAvatarTool, openDialog, openProperties, promoteScript, sameEntityView,
  setModelSelection, stepScript, updateDiagram, updateManyToOne, withBaseScript, withHint,
  diagramNameDialog, packageNameDialog, cloneEntityMenuItem, performIO,
} from "./DiagramType";

// ---------------------------------------------------------------------------------------------
// A test model: packages, "things" and diagrams of boxes that are avatars of things.

interface Item {
  readonly id: DiagramId;
  readonly ent: ModelId;
  readonly box: BoundBox;
}

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, null> }
  | { readonly tag: "Thing"; readonly name: Name }
  | { readonly tag: "Dgm"; readonly dgm: DiagramEntity<Item, null> };

const Pkg = (n: string): TV => ({ tag: "Pkg", pkg: Package<TV, null>(Name(n), null) });
const Thing = (n: string): TV => ({ tag: "Thing", name: Name(n) });
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
const _Thing: Prism<TV, Name> = prism(
  (n: Name): TV => ({ tag: "Thing", name: n }),
  (v: TV) => (v.tag === "Thing" ? Right(v.name) : Left(v)),
);
const _Dgm: Prism<TV, DiagramEntity<Item, null>> = prism(
  (d: DiagramEntity<Item, null>): TV => ({ tag: "Dgm", dgm: d }),
  (v: TV) => (v.tag === "Dgm" ? Right(v.dgm) : Left(v)),
);

/** The two corners of a (non-empty) box. */
function corners(b: BoundBox): [Point, Point] {
  if (b.tag !== "BoundBox") throw new Error("NoBox");
  return [b._0, b._1];
}

const JSON_Item: J.JSONCodec<Item> = J.codec(
  (i) => {
    const [p1, p2] = corners(i.box);
    return J.object([["id", i.id], ["ent", i.ent], ["box", [p1._pX, p1._pY, p2._pX, p2._pY]]]);
  },
  (v) => J.withObject("Item", (o) => {
    const [x1, y1, x2, y2] = J.field(o, "box", J.listJ(J.doubleJ));
    return { id: J.field(o, "id", J.uuidJ), ent: J.field(o, "ent", J.uuidJ), box: mkBoundBox(P(x1, y1), P(x2, y2)) };
  }, v),
);

/** The `Avatar` dictionary of the test diagram (also its `Connectable` dictionary). */
const Avatar_Item: Avatar<null, TV, TV, Item, null> & DiagramMetadataClass<null> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles() { return []; },
  itemTouched: (v, _s, p) => inBox(p, v.box),
  *itemChildren() { return []; },
  itemInBox: (v, b) => corners(v.box).every((p) => inBox(p, b)),
  itemBounds: (v) => v.box,
  *itemResize(_d, _wh, v) { return v; },
  *itemMove(d, xy, v) {
    const v1 = { ...v, box: moveBox(v.box, xy) };
    yield* updateItem(d, v1);
    return v1;
  },
  *itemDrag(d, xy, v) { return yield* Avatar_Item.itemMove(d, xy, v); },
  *itemDescription(d, v) {
    const e = yield* ascend<null, TV, TV, Item>(d, v);
    return e.tag === "Just" ? view(nameL.dot(nameText), e.value._entityContents) : "item";
  },
  *itemView(_d, v) {
    const vw: View<Item> = {
      viewDraw: noPaint,
      viewTouched: (p) => inBox(p, v.box),
      viewBox: v.box,
      viewMenu: () => mempty_Menu(),
      viewAction: (d1, a) => (a.actionCommand.tag === "Activate" ? avatarProperties(d1, v) : yieldViews(d1)),
    };
    return vw;
  },
  itemType: () => "Item",
  *itemConnectionPoint(_d, v) { return () => view(boxCentre, v.box); },
  *itemAdjust(d, v) { yield* tellItem(d, v); },
  updateViewContext: (_c, _m, vc) => vc,
  *getDiagramModelId(d) { return d.state._deltaContext as ModelId; },
  *entityAvatar(d, e, p) {
    if (e._entityContents.tag !== "Thing") return Nothing;
    const v = yield* addItem(d, (u) => ({ id: u, ent: e.entityId, box: growBox(10, mkBoundBox(p, p)) }));
    return Just(v);
  },
  ascendedId: (v) => (U.isNil(v.ent) ? Nothing : Just(v.ent)),
  *avatarChildren() { return []; },
  *updateAvatar() { return false; },
  diagramMetadataJ: J.unitJ,
  diagramMetadataMempty: null,
  diagramMetadataAppend: () => null,
};

const reflectiveDiagram = Reflective_DiagramEntity(Avatar_Item);

/** `EntityClass TV` and `HasDiagrams () TV`. */
const cls: HasDiagrams<null, TV, null> = {
  reflectiveName: (v) => Variant(v.tag === "Pkg" ? "Package" : v.tag === "Thing" ? "Thing" : "Item Diagram"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Pkg(""), Thing(""), Dgm("", [])],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(nameL.dot(nameText), v))),
  reflectiveSet: (st, v) => set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: nameL,
  _Package: _Pkg,
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: (e, nm) => (e._entityContents.tag === "Pkg"
    ? Just((c: ModelEditCtx<TV, TV>) => clonePackage(cls, c, (_f, pm) => pm, e, nm))
    : e._entityContents.tag === "Thing" ? Just((c: ModelEditCtx<TV, TV>) => unsafeEntityClone(c, e, nm)) : Nothing),
  entityFunctions: M.empty(),
  entityJ: J.codec((_v) => null, () => J.fail("not used")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  isDiagram: (v) => v.tag === "Dgm",
  getDiagramWrapper: (_ctx, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return Nothing;
    return Just(DiagramWrapper<null, TV, TV, Item>(
      Avatar_Item, e.entityId, v.dgm._diagramEntityContents, _Dgm, identity<TV>(),
      () => Nothing, e.entityId, Nothing, () => ({ toolbarLeft: [], toolbarRight: [] })));
  },
  diagramEntityTypes: M.singleton(Variant("Item Diagram"), [Variant("Thing")]),
  diagramMapAvatars: (f, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return e;
    const items = M.elems(v.dgm._diagramEntityContents._diagramContents).map((i) => {
      const n = f(i.ent);
      return n.tag === "Just" ? { ...i, ent: n.value } : i;
    });
    return { ...e, _entityContents: Dgm(v.dgm._diagramEntityName._0, items) };
  },
};

function startState(): ModelEditState<TV> {
  return modelStartState(newGenerator(), emptyModel(cls, "Test"));
}

/** Run a model edit, failing the test on error. */
function edit<A>(st: ModelEditState<TV>, act: (c: ModelEditCtx<TV, TV>) => A): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, identity<TV>(), st, act);
  if (r.tag === "Left") throw new Error("Model edit failed: " + JSON.stringify(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

/** A test model: Root/Pkg "P" containing things "A" and "B" and diagram "D". */
function testModel(): { st: ModelEditState<TV>; pkg: ModelId; a: ModelId; b: ModelId; dgm: ModelId } {
  const [ids, st] = edit(startState(), (c) => {
    const pkg = mkPackage(c, Name("P"));
    goToEntity(c, pkg);
    const a = mkEntity(c, Thing("A")).entityId;
    const b = mkEntity(c, Thing("B")).entityId;
    const dgm = mkEntity(c, Dgm("D", [])).entityId;
    return { pkg, a, b, dgm };
  });
  return { st, ...ids };
}

// ---------------------------------------------------------------------------------------------
// A small interpreter for scripts, following Model.GI.ModelDiagrams.interpretScript.

interface Env {
  hint: Maybe<string>;
  selection: S.Set<ModelId>;
  log: string[];
  opened: ModelId[];
  /** Answer to a ScriptProperties instruction. */
  props: (uuid: ModelId, st: ModelEditState<TV>) => Maybe<[Entity<TV>, M.Map<string, S.Set<ModelId>>]>;
  /** Answer to a ScriptDialog instruction. */
  dialog: (v: any) => Maybe<any>;
}

function newEnv(partial: Partial<Env> = {}): Env {
  return {
    hint: Nothing, selection: S.empty(), log: [], opened: [],
    props: () => Nothing, dialog: (v) => Just(v), ...partial,
  };
}

function interpret<A>(
  st0: ModelEditState<TV>,
  script: ModelScriptAct<null, TV, TV, A>,
  env: Env,
): Either<ModelError, [A, ModelEditState<TV>]> {
  let st = st0;
  let act = script;
  for (;;) {
    const r = runModelEdit(cls, identity<TV>(), st, (c) => stepScript(c, act));
    if (r.tag === "Left") return Left(r.value);
    const [upd, newState] = r.value;
    const step = upd.updateValue;
    if (step.tag === "Pure") return Right([step._0, newState]);
    const instr: UserScriptFunctor<null, TV> = step._0;
    env.log.push(instr.tag);
    let answer: any = null;
    switch (instr.tag) {
      case "ScriptProperties": answer = env.props(instr._0, newState); break;
      case "ScriptDialog": answer = env.dialog(instr._1); break;
      case "ScriptOpenDiagram": env.opened.push(instr._0.wrappedEntityId); break;
      case "ScriptGetSelection": answer = env.selection; break;
      case "ScriptSetSelection": env.selection = instr._0; break;
      case "ScriptGetHint": answer = env.hint; break;
      case "ScriptSetHint": env.hint = instr._0; break;
      case "ScriptPerformIO": answer = instr._0(); break;
    }
    st = newState;
    act = step._1(answer);
  }
}

function ok<A>(r: Either<ModelError, A>): A {
  if (r.tag === "Left") throw new Error("Script failed: " + JSON.stringify(r.value));
  return r.value;
}

function entityAt(st: ModelEditState<TV>, uuid: ModelId): Maybe<Entity<TV>> {
  return M.lookup(uuid, st.stateModel.modelContents);
}

function nameOf(st: ModelEditState<TV>, uuid: ModelId): string {
  const e = entityAt(st, uuid);
  if (e.tag === "Nothing") throw new Error("missing " + uuid);
  return view(entityName(cls).dot(nameText), e.value);
}

function childNames(st: ModelEditState<TV>, uuid: ModelId): string[] {
  const e = entityAt(st, uuid);
  if (e.tag === "Nothing") throw new Error("missing " + uuid);
  return M.keys(e.value._entityChildren).map((n) => n._0);
}

// ---------------------------------------------------------------------------------------------

describe("DiagramEntity", () => {
  const item: Item = { id: "11111111-1111-1111-1111-111111111111", ent: U.nil, box: mkBoundBox(P(0, 0), P(10, 20)) };
  const de = mkDiagramEntity<Item, null>(Name("My diagram"), diagramFromList(Avatar_Item, [item]), null);
  const codec = JSON_DiagramEntity(Avatar_Item, JSON_Item);

  it("has a Reflective instance named after the item type", () => {
    expect(reflectiveDiagram.reflectiveName(de)).toBe("Item Diagram");
    expect(reflectiveDiagram.reflectiveGet(de)).toEqual(M.singleton(nameField, ExtText("My diagram")));
    const st = { state: M.singleton(nameField, ExtText("Renamed")) };
    const de2 = reflectiveDiagram.reflectiveSet(st, de);
    expect(view(diagramEntityName().dot(nameText), de2)).toBe("Renamed");
    expect(M.size(st.state)).toBe(0);
    expect(reflectiveDiagram.reflectiveDefaults.length).toBe(1);
  });

  it("round trips through JSON", () => {
    const js = codec.toJSON(de);
    expect(js).toEqual({
      name: "My diagram",
      type: "Item Diagram",
      contents: [{ id: item.id, ent: U.nil, box: [0, 0, 10, 20] }],
      appearance: [],
    });
    const back = codec.parseJSON(js);
    expect(eq_DiagramEntity(back, de)).toBe(true);
  });

  it("accepts version 0.5 diagrams without type or appearance, and rejects the wrong type", () => {
    const back = codec.parseJSON({ name: " Old ", contents: [] });
    expect(back._diagramEntityName._0).toBe("Old");
    expect(back._diagramEntityData).toBe(null);
    expect(() => codec.parseJSON({ name: "X", type: "GSN Diagram", contents: [] }))
      .toThrow(/Wrong type of diagram: expected Item Diagram but got GSN Diagram/);
  });

  it("has name dialogs and wrappers", () => {
    expect(packageNameDialog().dialogTitle).toBe("Package name");
    expect(diagramNameDialog().dialogTitle).toBe("Diagram name");
    const w1 = DiagramWrapper<null, TV, TV, Item>(Avatar_Item, "x", diagramFromList(Avatar_Item, []), _Dgm,
      identity(), () => Nothing, null, Nothing, () => ({ toolbarLeft: [], toolbarRight: [] }));
    const v1 = ViewWrapper<null, TV, number, null>("x", "t1", null, Left(1), null as any);
    const v2 = ViewWrapper<null, TV, number, null>("x", "t2", null, Left(1), null as any);
    expect(sameEntityView(w1, w1)).toBe(true);
    expect(sameEntityView(w1, v1)).toBe(false);
    expect(sameEntityView(v1, v1)).toBe(true);
    expect(sameEntityView(v1, v2)).toBe(false);
  });
});

describe("stepScript", () => {
  it("returns Pure for a script without instructions", () => {
    const [step, st] = edit(startState(), (c) => stepScript(c, function* (c1) {
      return mkPackage(c1, Name("Q"));
    }));
    expect(step.tag).toBe("Pure");
    expect(M.keys(st.stateModel.modelRoot).map((n) => n._0)).toEqual(["Q"]);
  });

  it("runs continuations more than once, each time from the state it is given", () => {
    let starts = 0;
    const script: ModelScriptAct<null, TV, TV, Maybe<number>> = function* (c) {
      starts++;
      const pkg = mkPackage(c, Name("A"));
      const r = yield* openDialog<null, TV, TV, number>(c, () => Nothing, 1);
      if (r.tag === "Just") {
        goToEntity(c, pkg);
        mkPackage(c, Name("B" + r.value));
      }
      return r;
    };
    const [step, st1] = edit(startState(), (c) => stepScript(c, script));
    expect(step.tag).toBe("Free");
    if (step.tag !== "Free") return;
    expect(step._0.tag).toBe("ScriptDialog");
    const pkgId = M.elems(st1.stateModel.modelRoot)[0];
    // First run: the suspended generator itself.
    const [r2, st2] = edit(st1, (c) => stepScript(c, step._1(Just(2))));
    expect(r2).toEqual({ tag: "Pure", _0: Just(2) });
    expect(starts).toBe(1);
    expect(childNames(st2, pkgId)).toEqual(["B2"]);
    // Second run (OK after Apply): replayed from the start, from the dialog's state.
    const [r3, st3] = edit(st1, (c) => stepScript(c, step._1(Just(3))));
    expect(r3).toEqual({ tag: "Pure", _0: Just(3) });
    expect(starts).toBe(2);
    expect(childNames(st3, pkgId)).toEqual(["B3"]);
    // Deterministic: the replay created the same package ID as the first run.
    const kids = (s: ModelEditState<TV>): ModelId[] => {
      const e = entityAt(s, pkgId);
      return e.tag === "Just" ? M.elems(e.value._entityChildren) : [];
    };
    expect(kids(st3)).toEqual(kids(st2));
    // The continuation runs in whatever state it is given (Haskell `runModelEdit s (nxt r)`).
    const [, st4] = edit(st2, (c) => stepScript(c, step._1(Just(4))));
    expect(childNames(st4, pkgId)).toEqual(["B2", "B4"]);
  });

  it("replays earlier instruction results without asking again", () => {
    const script: ModelScriptAct<null, TV, TV, string> = function* (c) {
      const a = yield* openDialog<null, TV, TV, string>(c, () => Nothing, "a");
      const sel = yield* (function* () { return (yield { tag: "ScriptGetSelection" }) as S.Set<ModelId>; })();
      const b = yield* openDialog<null, TV, TV, string>(c, () => Nothing, "b");
      return [a, S.size(sel), b].map((x) => JSON.stringify(x)).join(" ");
    };
    const [s1, st1] = edit(startState(), (c) => stepScript(c, script));
    if (s1.tag !== "Free") throw new Error("expected Free");
    const [s2, st2] = edit(st1, (c) => stepScript(c, s1._1(Just("x"))));
    if (s2.tag !== "Free") throw new Error("expected Free");
    expect(s2._0.tag).toBe("ScriptGetSelection");
    const [s3, st3] = edit(st2, (c) => stepScript(c, s2._1(S.fromList(["u1", "u2"]))));
    if (s3.tag !== "Free") throw new Error("expected Free");
    const [d1] = edit(st3, (c) => stepScript(c, s3._1(Just("y"))));
    const [d2] = edit(st3, (c) => stepScript(c, s3._1(Just("z"))));
    expect(d1).toEqual({ tag: "Pure", _0: `{"tag":"Just","value":"x"} 2 {"tag":"Just","value":"y"}` });
    expect(d2).toEqual({ tag: "Pure", _0: `{"tag":"Just","value":"x"} 2 {"tag":"Just","value":"z"}` });
  });

  it("propagates model errors and can be run with yield* as an ordinary script", () => {
    const failing: ModelScriptAct<null, TV, TV, number> = function* (c) {
      yield* setModelSelection(c, S.empty());
      return throwUser(c, "boom");
    };
    const env = newEnv();
    const r = interpret(startState(), failing, env);
    expect(r).toEqual(Left({ tag: "UserError", _0: "boom" }));
    // A continuation used inside another script.
    const inner: ModelScriptAct<null, TV, TV, number> = function* (c) {
      const r1 = yield* openDialog<null, TV, TV, number>(c, () => Nothing, 1);
      return r1.tag === "Just" ? r1.value * 10 : 0;
    };
    const [s1, st1] = edit(startState(), (c) => stepScript(c, inner));
    if (s1.tag !== "Free") throw new Error("expected Free");
    const k = s1._1(Just(5));
    const outer: ModelScriptAct<null, TV, TV, number> = function* (c) {
      const x = yield* k(c);
      const y = yield* performIO<null, TV, TV, number>(c, () => 7);
      return x + y;
    };
    const env2 = newEnv();
    expect(ok(interpret(st1, outer, env2))[0]).toBe(57);
    expect(env2.log).toEqual(["ScriptPerformIO"]);
  });

  it("promotes scripts to a subtype and back", () => {
    const { st, a } = testModel();
    const rename: ModelScriptAct<null, TV, Name, boolean> = function* (c) {
      goToEntity(c, a);
      const v = current(c);
      return v.tag === "Just" && c.prsm !== undefined && view(nameText, view(nameL, v.value._entityContents)) === "A";
    };
    const promoted = promoteScript<null, TV, TV, Name, boolean>(_Thing, rename);
    expect(ok(interpret(st, promoted, newEnv()))[0]).toBe(true);
    const based = withBaseScript<null, TV, Name, string>(function* (c) {
      goToRoot(c);
      return currentName(c);
    });
    expect(ok(interpret(st, promoteScript<null, TV, TV, Name, string>(_Thing, based), newEnv()))[0]).toBe("Test");
  });
});

describe("script operations", () => {
  it("withHint sets and restores the hint", () => {
    const env = newEnv({ hint: Just("old") });
    const hints: Maybe<string>[] = [];
    const script: ModelScriptAct<null, TV, TV, number> = function* (c) {
      return yield* withHint<null, TV, TV, any, number>(c, "new", (function* () {
        hints.push(env.hint);
        return 3;
      })());
    };
    expect(ok(interpret(startState(), script, env))[0]).toBe(3);
    expect(hints).toEqual([Just("new")]);
    expect(env.hint).toEqual(Just("old"));
    expect(env.log).toEqual(["ScriptGetHint", "ScriptSetHint", "ScriptSetHint"]);
  });

  it("insertEntity deletes the new entity when the dialog is cancelled", () => {
    const { st, pkg } = testModel();
    const [r, st2] = ok(interpret(st, (c) => insertEntity<null, TV, TV>(c, Thing("A"), pkg), newEnv()));
    expect(r).toEqual(Nothing);
    expect(childNames(st2, pkg)).toEqual(["A", "B", "D"]);
  });

  it("insertEntity applies the edited properties", () => {
    const { st, pkg } = testModel();
    const env = newEnv({
      props: (uuid, s) => {
        const e = entityAt(s, uuid);
        if (e.tag === "Nothing") return Nothing;
        expect(nameOf(s, uuid)).toBe("A1");
        return Just([set(entityProperties(cls), M.singleton(nameField, ExtText("New thing")), e.value), M.empty()]);
      },
    });
    const [r, st2] = ok(interpret(st, (c) => insertEntity<null, TV, TV>(c, Thing("A"), pkg), env));
    expect(r.tag).toBe("Just");
    if (r.tag !== "Just") return;
    expect(r.value[0]._0).toBe("New thing");
    expect(nameOf(st2, r.value[1])).toBe("New thing");
    expect(logInsertion(r)).toEqual(Just("Insert New thing"));
    expect(logInsertion(Nothing)).toEqual(Nothing);
  });

  it("editEntityProperties reports changes", () => {
    const { st, a } = testModel();
    const renameTo = (n: string): Env => newEnv({
      props: (uuid, s) => {
        const e = entityAt(s, uuid);
        if (e.tag === "Nothing") return Nothing;
        return Just([set(entityProperties(cls), M.singleton(nameField, ExtText(n)), e.value), M.empty()]);
      },
    });
    const [r1, st1] = ok(interpret(st, (c) => editEntityProperties<null, TV, TV>(c, a), renameTo("A2")));
    expect(r1).toEqual(Just("Edit A properties"));
    expect(nameOf(st1, a)).toBe("A2");
    const [r2] = ok(interpret(st1, (c) => editEntityProperties<null, TV, TV>(c, a), renameTo("A2")));
    expect(r2).toEqual(Nothing);
    const r3 = interpret(st1, (c) => editEntityProperties<null, TV, TV>(c, U.nil), renameTo("x"));
    expect(r3).toEqual(Left({ tag: "UserError", _0: "Root has no editable properties." }));
  });

  it("deleteEntity and the entity menus", () => {
    const { st, pkg, a, dgm } = testModel();
    const [r, st2] = ok(interpret(st, (c) => deleteEntity<null, TV, TV>(c, a), newEnv()));
    expect(r).toEqual(Just("Delete A"));
    expect(childNames(st2, pkg)).toEqual(["B", "D"]);
    const entA = entityAt(st, a);
    if (entA.tag === "Nothing") throw new Error("missing");
    expect(entityMenu(cls, entA.value)._0[0].map((i) => i.menuLabel)).toEqual(["Properties", "Clone", "Delete"]);
    const dMenu = diagramEntityMenu<null, TV, TV>(cls, dgm);
    expect(dMenu._0[0].map((i) => i.menuLabel)).toEqual(["Open diagram", "Properties", "Clone", "Delete"]);
    const open = dMenu._0[0][0].menuValue;
    if (open.tag !== "Right") throw new Error("expected item");
    const env = newEnv();
    expect(ok(interpret(st, open.value, env))[0]).toEqual(Nothing);
    expect(env.opened).toEqual([dgm]);
    // Opening something that is not a diagram is an internal error.
    expect(interpret(st, function* (c) {
      yield* (diagramEntityMenu<null, TV, TV>(cls, a)._0[0][0].menuValue as any).value(c);
      return null;
    }, newEnv()).tag).toBe("Left");
  });

  it("clones entities and selects the clone", () => {
    const { st, pkg, a } = testModel();
    const item = cloneEntityMenuItem<null, TV, TV>(a);
    if (item.menuValue.tag !== "Right") throw new Error("expected item");
    const env = newEnv();
    const [r, st2] = ok(interpret(st, item.menuValue.value, env));
    expect(r).toEqual(Just("Cloned A"));
    expect(childNames(st2, pkg)).toEqual(["A", "A clone-1", "B", "D"]);
    expect(S.size(env.selection)).toBe(1);
  });

  it("clonePackage clones trees, relations and diagram avatars", () => {
    const { st, pkg, a, b, dgm } = testModel();
    // Diagram D shows A; A is related to B; B is related to something outside the package.
    const [outside, st1] = edit(st, (c) => {
      goToEntity(c, dgm);
      const item: Item = { id: "22222222-2222-2222-2222-222222222222", ent: a, box: mkBoundBox(P(0, 0), P(1, 1)) };
      const d = current(c);
      if (d.tag === "Nothing") throw new Error("missing");
      c.state = {
        ...c.state,
        stateModel: {
          ...c.state.stateModel,
          modelContents: M.insert(dgm, { ...d.value, _entityContents: Dgm("D", [item]) }, c.state.stateModel.modelContents),
        },
      };
      modifyRelations(c, (r) => NR.insert(a, b, "rel", r));
      goToRoot(c);
      const o = mkEntity(c, Pkg("Outside")).entityId;
      modifyRelations(c, (r) => NR.insert(b, o, "other", r));
      return o;
    });
    const [clone, st2] = edit(st1, (c) => {
      goToEntity(c, pkg);
      const ent = current(c);
      if (ent.tag === "Nothing") throw new Error("missing");
      goToRoot(c);
      return clonePackage(cls, c, (_f, pm) => pm, ent.value, Name("P copy"));
    });
    expect(M.keys(st2.stateModel.modelRoot).map((n) => n._0)).toEqual(["Outside", "P", "P copy"]);
    expect(childNames(st2, clone.entityId)).toEqual(["A", "B", "D"]);
    const cloneEnt = entityAt(st2, clone.entityId);
    if (cloneEnt.tag === "Nothing") throw new Error("missing clone");
    const kids = M.toList(cloneEnt.value._entityChildren);
    const kid = (n: string) => kids.find(([k]) => k._0 === n)![1];
    const [a2, b2, d2] = [kid("A"), kid("B"), kid("D")];
    expect([a2, b2, d2].some((u) => [a, b, dgm].includes(u))).toBe(false);
    const rels = st2.stateModel.modelRelations;
    // Relation within the cloned set refers to the clones; relation outside is kept.
    expect(NR.member(a2, b2, "rel", rels)).toBe(true);
    expect(NR.member(b2, outside, "other", rels)).toBe(true);
    // The original relations are untouched.
    expect(NR.member(a, b, "rel", rels)).toBe(true);
    // The cloned diagram's avatar refers to the cloned entity.
    const dEnt = entityAt(st2, d2);
    if (dEnt.tag === "Nothing" || dEnt.value._entityContents.tag !== "Dgm") throw new Error("missing diagram");
    expect(M.elems(dEnt.value._entityContents.dgm._diagramEntityContents._diagramContents).map((i) => i.ent)).toEqual([a2]);
  });

  it("updateManyToOne replaces the old relation", () => {
    const { st, a, b, dgm } = testModel();
    const [rels] = edit(st, (c) => {
      updateManyToOne(c, "owner", a, b);
      updateManyToOne(c, "owner", a, dgm);
      const r1 = c.state.stateModel.modelRelations;
      updateManyToOne(c, "owner", a, U.nil);
      return [r1, c.state.stateModel.modelRelations];
    });
    expect(S.toList(NR.relation(a, "owner", rels[0]))).toEqual([dgm]);
    expect(S.toList(NR.relation(a, "owner", rels[1]))).toEqual([]);
  });

  it("findTextTool selects matching entities", () => {
    const { st, a, b } = testModel();
    const env = newEnv({ dialog: () => Just([true, "a"]) });
    expect(ok(interpret(st, findTextTool, env))[0]).toEqual(Nothing);
    expect(S.toList(env.selection).includes(a)).toBe(true);
    expect(S.toList(env.selection).includes(b)).toBe(false);
    const env2 = newEnv({ selection: S.fromList([a]), dialog: () => Just([true, ""]) });
    ok(interpret(st, findTextTool, env2));
    expect(S.size(env2.selection)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Diagram editing inside ModelScripts.

/** A diagram editor whose Delta runs inside model scripts, as in Model.GI.ModelDiagrams. */
class Editor {
  nxt: ReturnType<typeof startDelta<Item>>;
  st: ModelEditState<TV>;
  constructor(st: ModelEditState<TV>, dgm: ModelId, items: readonly Item[], readonly env: Env = newEnv()) {
    this.st = st;
    this.nxt = startDelta<Item>(Avatar_Item, (d, a) => processAction(d, () => noPaint, keyCommands<Item>(), a),
      mkDiagramState(dgm, 1, diagramFromList(Avatar_Item, items)));
  }
  action(a: Action<Item>): void {
    const nxt = this.nxt;
    const script = function* (c: ModelEditCtx<TV, TV>): Generator<any, null, any> {
      yield* applyDelta(c, nxt, a);
      return null;
    };
    const [, st2] = ok(interpret(this.st, script as ModelScriptAct<null, TV, TV, null>, this.env));
    this.st = st2;
  }
  apply(cmd: Command<Item>, at: Point = P(0, 0), mods = noMod, target: Maybe<readonly [DiagramId, View<Item>]> = Nothing): void {
    this.action(mkAction(cmd, at, mods, target));
  }
  script(f: (d: any) => Generator<any, Action<Item>, any>): void {
    this.action(mkScriptAction<Item>(f));
  }
  items(): Item[] {
    return M.elems(view(diagramContents<Item>(), deltaStateOf(this.nxt)._deltaDiagram));
  }
  target(id: DiagramId): Maybe<readonly [DiagramId, View<Item>]> {
    const v = this.items().find((i) => i.id === id)!;
    const g = Avatar_Item.itemView(this.nxt.ctx, v);
    return Just([id, g.next().value as View<Item>] as const);
  }
}

describe("avatars", () => {
  const box = (id: string, ent: ModelId, x: number): Item =>
    ({ id, ent, box: mkBoundBox(P(x, 0), P(x + 10, 10)) });

  it("finds avatars and the nearest one", () => {
    const { st, a, b, dgm } = testModel();
    const items = [box("i1", a, 0), box("i2", a, 100), box("i3", b, 50)];
    const ed = new Editor(st, dgm, items);
    let found: any[] = [];
    ed.script(function* (d) {
      found = [
        (yield* diagramAvatars<null, TV, TV, Item>(d, a)).map((i: Item) => i.id).sort(),
        yield* nearestAvatar(d, a, P(90, 0)),
        yield* nearestAvatar(d, b, P(0, 0)),
        yield* nearestAvatar(d, U.nil, P(0, 0)),
      ];
      return yield* yieldViews(d);
    });
    expect(found[0]).toEqual(["i1", "i2"]);
    expect(found[1]).toEqual(Just(items[1]));
    expect(found[2]).toEqual(Just(items[2]));
    expect(found[3]).toEqual(Nothing);
  });

  it("avatarConnector creates missing avatars", () => {
    const { st, a, pkg, dgm } = testModel();
    const ed = new Editor(st, dgm, []);
    const ends: any[] = [];
    ed.script(function* (d) {
      ends.push(yield* avatarConnector(d, Nothing, P(0, 0), P(5, 5)));
      ends.push(yield* avatarConnector(d, Just([a, Nothing] as const), P(0, 0), P(100, 100)));
      ends.push(yield* avatarConnector(d, Just([a, Nothing] as const), P(0, 0), P(300, 300)));
      ends.push(yield* avatarConnector(d, Just(["99999999-9999-9999-9999-999999999999", Nothing] as const), P(0, 0), P(7, 7)));
      return yield* yieldViews(d);
    });
    expect(ends[0].tag).toBe("Unconnected");
    const items = ed.items();
    expect(items.length).toBe(1);
    expect(items[0].ent).toBe(a);
    expect(ends[1]).toMatchObject({ tag: "Connected", connectorTarget: items[0].id, connectorPoint: P(100, 100) });
    expect(ends[2]).toMatchObject({ tag: "Connected", connectorTarget: items[0].id });
    expect(ends[3]).toMatchObject({ tag: "Unconnected", connectorPoint: P(7, 7) });
    // A package is not allowed on the diagram.
    expect(() => ed.script(function* (d) {
      yield* avatarConnector(d, Just([pkg, Nothing] as const), P(0, 0), P(1, 1));
      return yield* yieldViews(d);
    })).toThrow(/not legal on this diagram/);
  });

  it("updateDiagram loads the diagram from the model", () => {
    const { st, a, dgm } = testModel();
    const [, st1] = edit(st, (c) => {
      goToEntity(c, dgm);
      const d = current(c);
      if (d.tag === "Nothing") throw new Error("missing");
      c.state = {
        ...c.state,
        stateModel: {
          ...c.state.stateModel,
          modelContents: M.insert(dgm, { ...d.value, _entityContents: Dgm("D", [box("m1", a, 0)]) }, c.state.stateModel.modelContents),
        },
      };
    });
    const ed = new Editor(st1, dgm, []);
    ed.script(function* (d) {
      yield* updateDiagram(d, _Dgm as Traversal<TV, DiagramEntity<Item>>);
      return yield* yieldViews(d);
    });
    expect(ed.items().map((i) => i.id)).toEqual(["m1"]);
  });

  it("shift-delete deletes the model entity of the selected avatar", () => {
    const { st, a, pkg, dgm } = testModel();
    const ed = new Editor(st, dgm, [box("i1", a, 0)]);
    ed.apply(Select, P(5, 5), noMod, ed.target("i1"));
    ed.apply(Key("\x7f"), P(0, 0), shiftMod);
    expect(childNames(ed.st, pkg)).toEqual(["B", "D"]);
    expect(ed.items().length).toBe(1); // Removed later by updateAvatar.
    ed.apply(Key("\x7f"), P(0, 0), noMod);
    expect(ed.items().length).toBe(0);
  });

  it("avatarProperties edits the entity through the properties dialog", () => {
    const { st, a, dgm } = testModel();
    const env = newEnv({
      props: (uuid, s) => {
        const e = entityAt(s, uuid);
        if (e.tag === "Nothing") return Nothing;
        return Just([set(entityProperties(cls), M.singleton(nameField, ExtText("Renamed")), e.value), M.empty()]);
      },
    });
    const ed = new Editor(st, dgm, [box("i1", a, 0)], env);
    ed.apply(Activate, P(5, 5), noMod, ed.target("i1"));
    expect(env.log).toEqual(["ScriptProperties"]);
    expect(nameOf(ed.st, a)).toBe("Renamed");
  });

  it("newBoxAvatarTool inserts a new entity and its avatar", () => {
    const { st, pkg, dgm } = testModel();
    const env = newEnv({
      hint: Just("idle"),
      props: (uuid, s) => {
        const e = entityAt(s, uuid);
        return e.tag === "Nothing" ? Nothing : Just([e.value, M.empty()]);
      },
    });
    const ed = new Editor(st, dgm, [], env);
    ed.script((d) => newBoxAvatarTool(d, pkg,
      (m: ModelId, u: DiagramId, bb: BoundBox): Item => ({ id: u, ent: m, box: bb }), () => noPaint, Thing("Thing")));
    expect(env.hint).toEqual(Just("Click and drag to define the new shape."));
    ed.apply(Select, P(200, 200));
    expect(env.hint).toEqual(Just("idle"));
    expect(env.log).toEqual([
      "ScriptGetHint", "ScriptSetHint", // withHint "Click and drag ..."
      "ScriptSetHint", // ... restored after the first action.
      "ScriptProperties", // insertEntity
      "ScriptGetHint", "ScriptSetHint", "ScriptSetHint", // withHint "Enter details."
    ]);
    expect(childNames(ed.st, pkg)).toEqual(["A", "B", "D", "Thing1"]);
    const items = ed.items();
    expect(items.length).toBe(1);
    expect(nameOf(ed.st, items[0].ent)).toBe("Thing1");
    expect(items[0].box).toEqual(mkBoundBox(P(100, 150), P(300, 250)));
  });
});

describe("openProperties", () => {
  it("yields a ScriptProperties instruction", () => {
    const g = openProperties<null, TV, TV>(null as any, "x");
    expect(g.next().value).toEqual({ tag: "ScriptProperties", _0: "x" });
    expect(g.next(Nothing)).toEqual({ done: true, value: Nothing });
  });
});
