// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzlibSync } from "fflate";
import * as Gtk from "@/lib/GI/Gtk";
import * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { identity, lens, prism, set, view, type Prism } from "@/lib/Control/Lens";
import { readIORef } from "@/lib/Prelude";
import { IOError } from "@/lib/System/IO";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { Changes, pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { Dialog, OkApplyButton, arr, constantDialog } from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { mempty_Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  type Action, type BoundBox, type DiagramId, type Point, type View, Point as P, addItem, applyDelta, boxCentre, connectableDefaults, diagramContents, diagramFromList,
  deltaStateOf, growBox, inBox, mkBoundBox, mkDiagramState, mkScriptAction, moveBox, processAction,
  startDelta, tellItem, updateItem, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type Avatar, type DiagramEntity, type DiagramMetadataClass, type Editable, type HasDiagrams, type ModelScriptAct,
  type UserScriptFunctor, DiagramEntity as mkDiagramEntity, DiagramWrapper, ViewWrapper, avatarProperties,
  diagramEntityName, insertEntity, keyCommands, logInsertion, openDialog, openDiagram, openEditor, openProperties,
  performIO, setModelSelection, stepScript, withHint,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId, type ModelUpdate,
  Name, Package, UserError, delete_, emptyModel, entityProperties, goToEntity, mkEntity, mkPackage, modelStartState,
  nameField, nameText, packageName, runModelEdit, throwUser,
} from "@/hades/src/Model/Abstract/PackageTree";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import type { ReferenceValues } from "@/hades/src/Model/Abstract/Properties";
import { newBookManager, type ActiveEntity, type BookManager } from "./Notebooks";
import {
  type StateScript, diagramInsertSelection, encodePngWithMetadata, exportTypeDialog,
  exportTypes, fromDeltaScript, getBytes, getInterpreterError, getInterpreterIOAction, getInterpreterOpenDialog,
  getInterpreterOpenEntity, getInterpreterOpenProperties, getInterpreterSelection, getInterpreterSetHint,
  getInterpreterUpdate, interpretScript, isDeltaInstruction, mergeScripts, newTabLabel, processModelScripts,
  renderForExport, selectionAdded, show_InterpreterResult, editorWindows,
} from "./ModelDiagrams";

/** Messages shown with "errorBox" (mocked). */
const shownErrors: string[] = vi.hoisted(() => []);
vi.mock("@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox", async (orig) => ({
  ...(await orig<typeof import("@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox")>()),
  errorBox: async (_parent: unknown, msg: string) => {
    shownErrors.push(msg);
  },
}));

/** Dialogs opened with "createDialog" (mocked): the test answers them by firing `answer`. */
interface OpenedDialog {
  readonly key: any;
  readonly initial: any;
  readonly dialog: any;
  readonly answer: (r: Maybe<any>) => void;
}
const openedDialogs: OpenedDialog[] = vi.hoisted(() => []);
vi.mock("@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog", async (orig) => {
  const m = await orig<typeof import("@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog")>();
  const Bn = await import("@/lib/Reactive/Banana");
  return {
    ...m,
    createDialog: (_p: unknown, _t: unknown, _env: unknown, [key, initial, dialog]: readonly [any, any, any]) => {
      const [e, fire] = Bn.newEvent<[any, Maybe<any>]>();
      openedDialogs.push({ key, initial, dialog, answer: (r) => fire([key, r]) });
      return e;
    },
  };
});

beforeEach(() => {
  shownErrors.length = 0;
  openedDialogs.length = 0;
});

// ---------------------------------------------------------------------------------------------
// A test model: packages, things and diagrams of boxes that are avatars of things.

type Pt = HadesRender;

interface Item {
  readonly id: DiagramId;
  readonly ent: ModelId;
  readonly box: BoundBox;
}

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, null> }
  | { readonly tag: "Thing"; readonly name: Name }
  | { readonly tag: "Dgm"; readonly dgm: DiagramEntity<Item, null> };

type Script = ModelScriptAct<Pt, TV, TV, Maybe<string>>;

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
const _Dgm: Prism<TV, DiagramEntity<Item, null>> = prism(
  (d: DiagramEntity<Item, null>): TV => ({ tag: "Dgm", dgm: d }),
  (v: TV) => (v.tag === "Dgm" ? Right(v.dgm) : Left(v)),
);

const Avatar_Item: Avatar<Pt, TV, TV, Item, null> & DiagramMetadataClass<null> = {
  ...connectableDefaults<Item>(),
  identifier: (v) => v.id,
  *itemHandles() { return []; },
  itemTouched: (v, _s, p) => inBox(p, v.box),
  *itemChildren() { return []; },
  itemInBox: (v, b) => inBox(view(boxCentre, v.box), b),
  itemBounds: (v) => v.box,
  *itemResize(_d, _wh, v) { return v; },
  *itemMove(d, xy, v) {
    const v1 = { ...v, box: moveBox(v.box, xy) };
    yield* updateItem(d, v1);
    return v1;
  },
  *itemDrag(d, xy, v) { return yield* Avatar_Item.itemMove(d, xy, v); },
  *itemDescription() { return "item"; },
  *itemView(_d, v) {
    const vw: View<Item> = {
      viewDraw: ({ cr }) => {
        if (v.box.tag !== "BoundBox") return;
        Cairo.rectangle(cr, v.box._0._pX, v.box._0._pY, v.box._1._pX - v.box._0._pX, v.box._1._pY - v.box._0._pY);
        Cairo.stroke(cr);
      },
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

const cls: HasDiagrams<Pt, TV, null> & Editable<Pt, TV> = {
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
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec((_v) => null, () => J.fail("not used")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  isDiagram: (v) => v.tag === "Dgm",
  getDiagramWrapper: (_ctx, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return Nothing;
    return Just(DiagramWrapper<Pt, TV, TV, Item>(
      Avatar_Item, e.entityId, v.dgm._diagramEntityContents, _Dgm, identity<TV>(),
      () => Nothing, e.entityId, Nothing, () => ({ toolbarLeft: [], toolbarRight: [] })));
  },
  diagramEntityTypes: M.singleton(Variant("Item Diagram"), [Variant("Thing")]),
  diagramMapAvatars: (_f, e) => e,
  editableActivation: () => function* () { return Nothing; },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
};

const box = (id: string, ent: ModelId, x: number, y: number): Item =>
  ({ id, ent, box: mkBoundBox(P(x, y), P(x + 100, y + 50)) });

/** Root/"P" with things "A", "B" and diagram "D" (with a box for A). */
function testModel(): { st: ModelEditState<TV>; pkg: ModelId; a: ModelId; b: ModelId; dgm: ModelId } {
  const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), emptyModel(cls, "Test")), (c) => {
    const pkg = mkPackage(c, Name("P"));
    goToEntity(c, pkg);
    const a = mkEntity(c, Thing("A")).entityId;
    goToEntity(c, pkg);
    const b = mkEntity(c, Thing("B")).entityId;
    goToEntity(c, pkg);
    const dgm = mkEntity(c, Dgm("D", [box("11111111-1111-4111-8111-111111111111", a, 10, 20)])).entityId;
    return { pkg, a, b, dgm };
  });
  if (r.tag === "Left") throw new Error("test model: " + JSON.stringify(r.value));
  // A fresh state, as the interpreter starts each script with (no edit log yet).
  return { st: modelStartState(newGenerator(), r.value[0].updateNewModel), ...r.value[0].updateValue };
}

const names = (m: Model<TV>): string[] =>
  M.elems(m.modelContents).map((e) => view(nameL.dot(nameText), e._entityContents)).sort();

const findId = (m: Model<TV>, n: string): ModelId => {
  const e = M.elems(m.modelContents).find((x) => view(nameL.dot(nameText), x._entityContents) === n);
  if (e === undefined) throw new Error("missing " + n);
  return e.entityId;
};

// ---------------------------------------------------------------------------------------------

describe("interpretScript", () => {
  const parent = Gtk.boxNew(Gtk.OrientationVertical, 0);
  const theme = Gtk.iconThemeGetDefault();
  const interp = <A>(st: ModelEditState<TV>, s: ModelScriptAct<Pt, TV, TV, A>, sel = S.empty<ModelId>(), hint: Maybe<string> = Nothing) =>
    interpretScript<Pt, TV, A>(cls, parent, theme, pure_Changes(st.stateModel), sel, hint, [st, s]);

  it("returns the update of a finished script, with the edit log", () => {
    const { st, pkg } = testModel();
    const r = interp(st, function* (c) {
      goToEntity(c, pkg);
      mkEntity(c, Thing("C"));
      return Just("Added C");
    });
    expect(r.tag).toBe("InterpreterUpdate");
    const u = getInterpreterUpdate(r);
    if (u.tag !== "Just") throw new Error("no update");
    expect(u.value.updateValue).toEqual(Just("Added C"));
    expect(names(u.value.updateNewModel)).toContain("C");
    expect(u.value.updateEditLog.map((l) => l.tag)).toEqual(["ModelAdd"]);
    expect(show_InterpreterResult(r)).toMatch(/^InterpreterUpdate \[ModelAdd [0-9a-f-]+\n\]$/);
  });

  it("reports model errors", () => {
    const { st } = testModel();
    const r = interp(st, function* (c) {
      return throwUser(c, "boom");
    });
    expect(getInterpreterError(r)).toEqual(Just(UserError("boom")));
    expect(show_InterpreterResult(r)).toBe("InterpreterError Model library client error: boom");
  });

  it("stops at a properties dialog with a continuation that can be run more than once", () => {
    const { st, a } = testModel();
    const script: Script = function* (c) {
      const r = yield* openProperties<Pt, TV, TV>(c, a);
      if (r.tag === "Nothing") return Nothing;
      goToEntity(c, a);
      mkEntity(c, Thing(view(nameL.dot(nameText), r.value[0]._entityContents) + " child"));
      return Just("done");
    };
    const r = interp(st, script);
    const p = getInterpreterOpenProperties(r);
    if (p.tag !== "Just") throw new Error("expected properties");
    const [[state, cont], uuid, replayable] = p.value;
    expect(uuid).toBe(a);
    expect(replayable).toBe(true);
    expect(show_InterpreterResult(r)).toBe("InterperterOpenProperties " + a);
    const ent = M.lookup(a, state.stateModel.modelContents);
    if (ent.tag === "Nothing") throw new Error("missing");
    const answer = (n: string): Maybe<readonly [Entity<TV>, ReferenceValues]> =>
      Just([{ ...ent.value, _entityContents: Thing(n) }, M.empty()] as const);
    // Things cannot have children, so the continuation fails; it still runs every time.
    const r1 = interp(state, cont(answer("X")));
    const r2 = interp(state, cont(answer("Y")));
    expect(r1.tag).toBe("InterpreterError");
    expect(r2.tag).toBe("InterpreterError");
    const r3 = interp(state, cont(Nothing));
    expect(getInterpreterUpdate(r3).tag === "Just" && getInterpreterUpdate(r3)).toMatchObject({ value: { updateValue: Nothing } });
  });

  it("marks properties dialogs from diagram Deltas as not replayable", () => {
    const { st, a } = testModel();
    const r = interp(st, (c) => fromDeltaScript((function* () {
      yield* openProperties<Pt, TV, TV>(c, a);
      return Nothing as Maybe<string>;
    })()));
    const p = getInterpreterOpenProperties(r);
    expect(p.tag === "Just" && p.value[2]).toBe(false);
  });

  it("continues with the initial value when a dialog selector gives no dialog", () => {
    const { st } = testModel();
    const r = interp(st, function* (c) {
      const x = yield* openDialog<Pt, TV, TV, number>(c, () => Nothing, 5);
      return Just("got " + JSON.stringify(x));
    });
    const d = getInterpreterOpenDialog(r);
    if (d.tag !== "Just") throw new Error("expected dialog");
    expect(show_InterpreterResult(r)).toBe("InterpreterOpenDialog ...");
    let e!: Either<StateScript<Pt, TV, Maybe<string>>, B.Event<StateScript<Pt, TV, Maybe<string>>>>;
    B.compile(() => {
      e = d.value();
    });
    if (e.tag !== "Left") throw new Error("expected Left");
    const r2 = interp(e.value[0], e.value[1]);
    expect(getInterpreterUpdate(r2).tag === "Just" && getInterpreterUpdate(r2)).toMatchObject({
      value: { updateValue: Just('got {"tag":"Just","value":5}') },
    });
  });

  it("opens diagrams, sets the selection and the hint, and passes on the current ones", () => {
    const { st, a, b, dgm } = testModel();
    const dEnt = M.lookup(dgm, st.stateModel.modelContents);
    if (dEnt.tag === "Nothing") throw new Error("missing diagram");
    const w = cls.getDiagramWrapper(null as unknown as ModelEditCtx<TV, TV>, dEnt.value);
    expect(w.tag).toBe("Just");
    if (w.tag === "Just") {
      const r = interp(st, function* (c) {
        yield* openEditor<Pt, TV, TV>(c, w.value);
        return Nothing as Maybe<string>;
      });
      const o = getInterpreterOpenEntity(r);
      expect(o.tag === "Just" && o.value[1].wrappedEntityId).toBe(dgm);
      expect(show_InterpreterResult(r)).toBe("InterpreterOpenEntity Diagram " + dgm);
    }
    const r2 = interp(st, function* (c) {
      yield* setModelSelection<Pt, TV, TV>(c, S.fromList([a, b]));
      return Nothing as Maybe<string>;
    });
    const s = getInterpreterSelection(r2);
    expect(s.tag === "Just" && S.toList(s.value[1]).sort()).toEqual([a, b].sort());
    expect(show_InterpreterResult(r2)).toBe("InterpreterSelection [" + S.toList(S.fromList([a, b])).join(",") + "]");
    const r3 = interp(st, (c) => withHint<Pt, TV, TV, never, Maybe<string>>(c, "Busy", (function* () {
      return Nothing as Maybe<string>;
    })()), S.empty(), Just("old"));
    // ScriptGetHint is answered directly; the next visible step is setting the new hint.
    const h = getInterpreterSetHint(r3);
    expect(h.tag === "Just" && h.value[1]).toEqual(Just("Busy"));
    expect(show_InterpreterResult(r3)).toBe('InterpreterSetHint Just "Busy"');
    if (h.tag !== "Just") return;
    const [st3, k3] = h.value[0];
    const r4 = interp(st3, k3);
    expect(getInterpreterSetHint(r4).tag === "Just" && (getInterpreterSetHint(r4) as any).value[1]).toEqual(Just("old"));
  });

  it("answers ScriptGetSelection from the state before the step (as Haskell)", () => {
    const { st, pkg } = testModel();
    const r = interp(st, function* (c) {
      goToEntity(c, pkg);
      mkEntity(c, Thing("Lost"));
      const sel: S.Set<ModelId> = yield { tag: "ScriptGetSelection" } as UserScriptFunctor<Pt, TV>;
      goToEntity(c, pkg);
      mkEntity(c, Thing("Kept" + S.size(sel)));
      return Just("x");
    }, S.fromList(["u"]));
    const u = getInterpreterUpdate(r);
    if (u.tag !== "Just") throw new Error("no update");
    expect(names(u.value.updateNewModel)).toContain("Kept1");
    expect(names(u.value.updateNewModel)).not.toContain("Lost");
  });

  it("wraps IO actions, synchronous or asynchronous", async () => {
    const { st } = testModel();
    const r = interp(st, function* (c) {
      const x: number = yield* performIO<Pt, TV, TV, number>(c, () => 2);
      const y: number = yield* performIO<Pt, TV, TV, number>(c, () => Promise.resolve(3));
      return Just(String(x + y));
    });
    expect(show_InterpreterResult(r)).toBe("InterpreterIOAction ...");
    const io = getInterpreterIOAction(r);
    if (io.tag !== "Just") throw new Error("expected IO");
    const [act, st1] = io.value;
    const k1 = act();
    expect(typeof k1).toBe("function"); // Synchronous result: the continuation itself.
    const r2 = interp(st1, k1 as Script);
    const io2 = getInterpreterIOAction(r2);
    if (io2.tag !== "Just") throw new Error("expected IO");
    const p = io2.value[0]();
    expect(typeof (p as PromiseLike<unknown>).then).toBe("function");
    const k2 = await p;
    const r3 = interp(io2.value[1], k2);
    expect(getInterpreterUpdate(r3).tag === "Just" && (getInterpreterUpdate(r3) as any).value.updateValue).toEqual(Just("5"));
  });
});

describe("helpers", () => {
  it("fromDeltaScript marks every instruction and passes results back", () => {
    const g = fromDeltaScript<Pt, TV, number>((function* () {
      const x: number = yield { tag: "ScriptGetHint" } as UserScriptFunctor<Pt, TV>;
      return x + 1;
    })());
    const i = g.next();
    expect(i.done).toBe(false);
    if (i.done) return;
    expect(i.value.tag).toBe("ScriptGetHint");
    expect(isDeltaInstruction(i.value)).toBe(true);
    expect(isDeltaInstruction({ tag: "ScriptGetHint" })).toBe(false);
    expect(g.next(41)).toEqual({ done: true, value: 42 });
  });

  it("selectionAdded finds the first newly selected entity", () => {
    expect(selectionAdded(S.fromList(["b"]), S.fromList(["a", "b", "c"]))).toEqual(Just("a"));
    expect(selectionAdded(S.fromList(["b"]), S.fromList(["b"]))).toEqual(Nothing);
  });

  it("mergeScripts sequences scripts and joins their descriptions", () => {
    const { st } = testModel();
    const s = (r: Maybe<string>): Script => function* () { return r; };
    const run = (x: Script): Maybe<string> => {
      const r = runModelEdit(cls, identity<TV>(), st, (c) => stepScript(c, x));
      if (r.tag === "Left" || r.value[0].updateValue.tag !== "Pure") throw new Error("failed");
      return r.value[0].updateValue._0;
    };
    expect(run(mergeScripts(s(Just("a")), s(Just("b"))))).toEqual(Just("a, b"));
    expect(run(mergeScripts(s(Just("a")), s(Nothing)))).toEqual(Just("a"));
    expect(run(mergeScripts(s(Nothing), s(Just("b"))))).toEqual(Just("b"));
    expect(run(mergeScripts(s(Nothing), s(Nothing)))).toEqual(Nothing);
  });

  it("getBytes splits a Cairo ARGB32 pixel into (a, r, g, b)", () => {
    expect(getBytes(0x80ff4010)).toEqual([0x80, 0xff, 0x40, 0x10]);
  });

  it("encodePngWithMetadata writes IHDR, pHYs, IDAT and IEND", () => {
    const png = encodePngWithMetadata(144, 2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 128]));
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const chunks: [string, Uint8Array][] = [];
    for (let i = 8; i < png.length;) {
      const n = dv.getUint32(i);
      const t = String.fromCharCode(...png.slice(i + 4, i + 8));
      chunks.push([t, png.slice(i + 8, i + 8 + n)]);
      i += 12 + n;
    }
    expect(chunks.map(([t]) => t)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    const ihdr = new DataView(chunks[0][1].buffer);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0][1][8], chunks[0][1][9]]).toEqual([2, 1, 8, 6]);
    const phys = new DataView(chunks[1][1].buffer);
    expect([phys.getUint32(0), phys.getUint32(4), chunks[1][1][8]]).toEqual([5669, 5669, 1]);
    expect(Array.from(unzlibSync(chunks[2][1]))).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 128]);
  });

  it("offers the four export types in a dialog", () => {
    expect(exportTypes.map(([, t]) => t)).toEqual(["SVG", "PNG", "Postscript", "PDF"]);
    const d = exportTypeDialog();
    expect(d.dialogTitle).toBe("Diagram Export Type");
    expect(d.dialogButtons.tag).toBe("OkButton");
  });

  it("newTabLabel follows the text and closes the page", () => {
    const page = Gtk.labelNew("page");
    let tab!: Gtk.Box;
    const net = B.compile(() => {
      tab = newTabLabel(page, B.pureB("Diagram"));
    });
    B.actuate(net);
    const [label, button] = Gtk.containerGetChildren(tab) as [Gtk.Label, Gtk.Button];
    expect(Gtk.labelGetText(label)).toBe("Diagram");
    expect(Gtk.buttonGetLabel(button)).toBe("✖");
    button.emit("clicked");
    expect(page.destroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The interpreter circuit.

interface Circuit {
  updates: ModelUpdate<TV, Maybe<string>>[];
  selections: S.Set<ModelId>[];
  hints: Maybe<string>[];
  errors: ModelError[];
  fire: (s: Script) => void;
  model: () => Model<TV>;
  manager: BookManager<Pt, TV>;
  book: Gtk.Widget;
}

function circuit(st: ModelEditState<TV>): Circuit {
  const c: Partial<Circuit> & { updates: any[]; selections: any[]; hints: any[]; errors: any[] } =
    { updates: [], selections: [], hints: [], errors: [] };
  let model = st.stateModel;
  const widget = Gtk.boxNew(Gtk.OrientationVertical, 0);
  const net = B.compile(() => {
    const [scriptE, fire] = B.newEvent<Script>();
    c.fire = fire;
    const [book, manager] = newBookManager<Pt, TV>(B.never(), B.never());
    Gtk.boxPackStart(widget, book, true, true, 0);
    c.manager = manager;
    c.book = book;
    const updatesRef: B.Event<ModelUpdate<TV, Maybe<string>>> = B.lazyE(() => upd);
    const modelE = B.mapE((u: ModelUpdate<TV, Maybe<string>>) => u.updateNewModel, updatesRef);
    const modelC = Changes(modelE, B.stepper(st.stateModel, modelE));
    const selsRef: B.Event<S.Set<ModelId>> = B.lazyE(() => sels);
    const selectB = B.stepper(S.empty<ModelId>(), selsRef);
    const [upd, sels, hints, errs] = processModelScripts<TV, Maybe<string>>(
      cls, widget, Gtk.iconThemeGetDefault(), manager, selectB, modelC, scriptE);
    B.reactimate(B.mapE((u: ModelUpdate<TV, Maybe<string>>) => () => {
      c.updates.push(u);
      model = u.updateNewModel;
    }, upd));
    B.reactimate(B.mapE((s: S.Set<ModelId>) => () => c.selections.push(s), sels));
    B.reactimate(B.mapE((h: Maybe<string>) => () => c.hints.push(h), hints));
    B.reactimate(B.mapE((e: ModelError) => () => c.errors.push(e), errs));
  });
  B.actuate(net);
  c.model = () => model;
  return c as Circuit;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("processModelScripts", () => {
  it("applies scripts and feeds instantaneous steps back", () => {
    const { st, a, pkg } = testModel();
    const c = circuit(st);
    c.fire(function* (ctx) {
      yield* setModelSelection<Pt, TV, TV>(ctx, S.singleton(a));
      return yield* withHint<Pt, TV, TV, never, Maybe<string>>(ctx, "Working", (function* () {
        goToEntity(ctx, pkg);
        mkEntity(ctx, Thing("New"));
        return Just("Add New");
      })());
    });
    expect(c.selections).toEqual([S.singleton(a)]);
    expect(c.hints).toEqual([Just("Working"), Nothing]);
    expect(c.updates.map((u) => u.updateValue)).toEqual([Just("Add New")]);
    expect(names(c.model())).toContain("New");
    expect(c.errors).toEqual([]);
  });

  it("runs IO actions and awaits asynchronous ones", async () => {
    const { st, pkg } = testModel();
    const c = circuit(st);
    const order: string[] = [];
    c.fire(function* (ctx) {
      const x: number = yield* performIO<Pt, TV, TV, number>(ctx, () => {
        order.push("sync");
        return 2;
      });
      const y: number = yield* performIO<Pt, TV, TV, number>(ctx, async () => {
        order.push("async");
        await tick();
        return 3;
      });
      goToEntity(ctx, pkg);
      mkEntity(ctx, Thing("T" + (x + y)));
      return Just("io");
    });
    expect(order).toEqual(["sync", "async"]);
    expect(c.updates).toEqual([]);
    await tick();
    await tick();
    expect(c.updates.map((u) => u.updateValue)).toEqual([Just("io")]);
    expect(names(c.model())).toContain("T5");
  });

  it("turns IO exceptions and model errors into error boxes", async () => {
    const { st } = testModel();
    const c = circuit(st);
    c.fire(function* (ctx) {
      yield* performIO<Pt, TV, TV, null>(ctx, () => {
        throw new IOError("foo.txt: does not exist");
      });
      return Just("never");
    });
    c.fire(function* (ctx) {
      yield* performIO<Pt, TV, TV, null>(ctx, () => Promise.reject(new IOError("bar.txt: denied")));
      return Just("never");
    });
    await tick();
    c.fire(function* (ctx) {
      return throwUser(ctx, "Script failed.");
    });
    await tick();
    expect(c.errors).toEqual([UserError("foo.txt: does not exist"), UserError("bar.txt: denied"), UserError("Script failed.")]);
    expect(shownErrors).toEqual(["foo.txt: does not exist", "bar.txt: denied", "Script failed."]);
    expect(c.updates).toEqual([]);
  });

  it("runs the rest of a script again for Apply and OK in a properties dialog", () => {
    const { st, pkg } = testModel();
    const c = circuit(st);
    c.fire(function* (ctx) {
      return logInsertion(yield* insertEntity<Pt, TV, TV>(ctx, Thing("Thing"), pkg));
    });
    expect(openedDialogs.length).toBe(1);
    const d = openedDialogs[0];
    expect(d.dialog.dialogButtons.tag).toBe("OkApplyButton");
    const [ent] = d.initial.value as [Entity<TV>, unknown];
    expect(view(nameL.dot(nameText), ent._entityContents)).toBe("Thing1");
    const named = (n: string) => Just(Just([set(entityProperties(cls), M.singleton(nameField, ExtText(n)), ent), M.empty()]));
    d.answer(named("Heater")); // Apply
    expect(c.updates.map((u) => u.updateValue)).toEqual([Just("Insert Heater")]);
    expect(names(c.model())).toContain("Heater");
    d.answer(named("Cooler")); // OK: the rest of the script runs again from the dialog's state.
    expect(c.updates.map((u) => u.updateValue)).toEqual([Just("Insert Heater"), Just("Insert Cooler")]);
    expect(names(c.model())).toContain("Cooler");
    expect(names(c.model())).not.toContain("Heater");
    expect(findId(c.model(), "Cooler")).toBe(ent.entityId);
    d.answer(Nothing); // Cancel: insertEntity deletes the new entity.
    expect(c.updates.map((u) => u.updateValue).slice(2)).toEqual([Nothing]);
    expect(names(c.model())).not.toContain("Thing1");
  });

  it("shows dialogs from diagram Deltas without an Apply button", () => {
    const { st, pkg } = testModel();
    const c = circuit(st);
    c.fire((ctx) => fromDeltaScript((function* () {
      const r = yield* openDialog<Pt, TV, TV, number>(ctx, constantDialog(Dialog("Number", OkApplyButton, arr((x: number) => x))), 1);
      goToEntity(ctx, pkg);
      mkEntity(ctx, Thing("N" + JSON.stringify(r)));
      return Just("dialog");
    })()));
    c.fire((ctx) => fromDeltaScript(insertEntity<Pt, TV, TV>(ctx, Thing("Other"), pkg)) as any);
    expect(openedDialogs.map((d) => d.dialog.dialogButtons.tag)).toEqual(["OkButton", "OkButton"]);
    openedDialogs[0].answer(Just(7));
    expect(names(c.model())).toContain('N{"tag":"Just","value":7}');
  });

  it("runs the continuation of a ScriptDialog once per Apply or OK", () => {
    const { st, pkg } = testModel();
    const c = circuit(st);
    c.fire(function* (ctx) {
      const r = yield* openDialog<Pt, TV, TV, number>(ctx, constantDialog(Dialog("Number", OkApplyButton, arr((x: number) => x))), 1);
      if (r.tag === "Nothing") return Nothing;
      goToEntity(ctx, pkg);
      mkEntity(ctx, Thing("N" + r.value));
      return Just("N" + r.value);
    });
    const d = openedDialogs[0];
    expect(d.dialog.dialogButtons.tag).toBe("OkApplyButton");
    d.answer(Just(1));
    d.answer(Just(2));
    expect(c.updates.map((u) => u.updateValue)).toEqual([Just("N1"), Just("N2")]);
    expect(names(c.model())).toContain("N2");
    expect(names(c.model())).not.toContain("N1");
  });

  it("opens diagram editors in the book and continues the script", async () => {
    const { st, dgm, pkg } = testModel();
    const c = circuit(st);
    c.fire(function* (ctx) {
      yield* openDiagram<Pt, TV, TV>(cls, ctx, dgm);
      goToEntity(ctx, pkg);
      mkEntity(ctx, Thing("After"));
      return Just("opened");
    });
    const contents = readIORef(c.manager.bookManagerContents) as readonly ActiveEntity<Pt, TV>[];
    expect(contents.map((x) => x.activeWrapper.wrappedEntityId)).toEqual([dgm]);
    const nb = Gtk.castTo(Gtk.Notebook, c.book);
    expect(nb !== null && Gtk.notebookGetNPages(nb)).toBe(1);
    expect(c.updates.map((u) => u.updateValue)).toEqual([Just("opened")]);
    // Opening it again only brings it to the front.
    c.fire(function* (ctx) {
      yield* openDiagram<Pt, TV, TV>(cls, ctx, dgm);
      return Nothing;
    });
    expect(readIORef(c.manager.bookManagerContents).length).toBe(1);
    expect(nb !== null && Gtk.notebookGetNPages(nb)).toBe(1);
    // A view of an entity (ViewWrapper) with input from the model.
    const g = arr<Model<TV>, Script, [null, string], [null, string]>((x) => x);
    c.fire(function* (ctx) {
      yield* openEditor<Pt, TV, TV>(ctx, ViewWrapper<Pt, TV, string, null>(pkg, "view", null,
        Right((m: Model<TV>) => Just(names(m).join(","))), g));
      return Nothing;
    });
    expect(readIORef(c.manager.bookManagerContents).length).toBe(2);
    // Deleting the diagram closes its editor.
    c.fire(function* (ctx) {
      goToEntity(ctx, dgm);
      delete_(ctx);
      return Just("Delete D");
    });
    await tick();
    expect(readIORef(c.manager.bookManagerContents).map((x) => x.activeWrapper.wrappedEntityId)).toEqual([pkg]);
  });
});

// ---------------------------------------------------------------------------------------------
// Delta functions and export.

/** A diagram editor whose Delta runs inside model scripts (as entityEditor does). */
class Editor {
  nxt: ReturnType<typeof startDelta<Item>>;
  st: ModelEditState<TV>;
  constructor(st: ModelEditState<TV>, dgm: ModelId, items: readonly Item[]) {
    this.st = st;
    this.nxt = startDelta<Item>(Avatar_Item, (d, a) => processAction(d, () => () => {}, keyCommands<Item>(), a),
      mkDiagramState(dgm, 1, diagramFromList(Avatar_Item, items)));
  }
  /** Run an action; returns the checkpoint text or the error. */
  action(a: Action<Item>): Either<ModelError, Maybe<string>> {
    const nxt = this.nxt;
    let st = this.st;
    let act: ModelScriptAct<Pt, TV, TV, Maybe<string>> = function* (c): Generator<any, Maybe<string>, any> {
      const [out] = yield* applyDelta(c, nxt, a);
      return out.outCheckpoint;
    };
    for (;;) {
      const r = runModelEdit(cls, identity<TV>(), st, (c) => stepScript(c, act));
      if (r.tag === "Left") return Left(r.value);
      const [u, st2] = r.value;
      if (u.updateValue.tag === "Pure") {
        this.st = st2;
        return Right(u.updateValue._0);
      }
      st = st2;
      act = u.updateValue._1(null);
    }
  }
  script(f: (d: any) => Generator<any, Action<Item>, any>): Either<ModelError, Maybe<string>> {
    return this.action(mkScriptAction<Item>(f));
  }
  items(): Item[] {
    return M.elems(view(diagramContents<Item>(), deltaStateOf(this.nxt)._deltaDiagram));
  }
}

describe("diagramInsertSelection", () => {
  it("adds avatars of the selected entities at the point", () => {
    const { st, a, b, dgm } = testModel();
    const ed = new Editor(st, dgm, []);
    const ins = (ids: readonly ModelId[], pt: Point) => ed.script(function* (d) {
      yield* diagramInsertSelection(d, S.fromList(ids), pt);
      return yield* yieldViews(d);
    });
    expect(ins([a], P(50, 50))).toEqual(Right(Just("Add A to diagram")));
    expect(ed.items().map((i) => [i.ent, i.box])).toEqual([[a, mkBoundBox(P(40, 40), P(60, 60))]]);
    expect(ins([a, b], P(100, 100))).toEqual(Right(Just("Add 2 entities to diagram")));
    expect(ed.items().length).toBe(3);
  });

  it("refuses the root, entities that are not allowed and an empty selection", () => {
    const { st, pkg, dgm, a, b } = testModel();
    // A failed action ends the Delta machine (the editor restarts it from its last state), so
    // each case gets its own editor.
    const ins = (ids: readonly ModelId[]) => new Editor(st, dgm, []).script(function* (d) {
      yield* diagramInsertSelection(d, S.fromList(ids), P(0, 0));
      return yield* yieldViews(d);
    });
    expect(ins([])).toEqual(Left(UserError("Nothing to insert.")));
    expect(ins([pkg])).toEqual(Left(UserError("P cannot be added to this diagram.")));
    expect(ins([U.nil])).toEqual(Left(UserError("Cannot add the model root to a diagram.")));
    const ed2 = new Editor(st, dgm, []);
    const r = ed2.script(function* (d) {
      yield* diagramInsertSelection(d, S.fromList([a, b]), P(0, 0));
      return yield* yieldViews(d);
    });
    expect(r.tag).toBe("Right");
    expect(ed2.items().map((i) => i.ent).sort()).toEqual([a, b].sort());
  });
});

describe("renderForExport", () => {
  it("computes the size in points with 10 pixels of slop and draws the views", () => {
    const { st, a, dgm } = testModel();
    const d = diagramFromList(Avatar_Item, [box("i1", a, 100, 40), box("i2", a, 300, 140)]);
    const [render, [w, h]] = renderForExport<Pt, TV, TV, Item>(Avatar_Item, cls, Gtk.iconThemeGetDefault(),
      identity<TV>(), st.stateModel, dgm, d);
    // Bounds (100,40)-(400,190), grown by 10, scaled by 72/96.
    expect([w, h]).toEqual([(320) * 0.75, (170) * 0.75]);
    const [, svg] = Cairo.withSVGSurface("x.svg", w, h, (s) => Cairo.renderWith(s, render));
    expect(svg).toContain("<path");
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("gives an empty size for an empty diagram", () => {
    const { st, dgm } = testModel();
    const [, [w, h]] = renderForExport<Pt, TV, TV, Item>(Avatar_Item, cls, Gtk.iconThemeGetDefault(),
      identity<TV>(), st.stateModel, dgm, diagramFromList(Avatar_Item, []));
    expect([w, h]).toEqual([0, 0]);
  });
});


describe("editorWindows", () => {
  it("reports the active editor and activates open editors (browser-history hooks)", () => {
    const { st, dgm } = testModel();
    // A second diagram.
    const r = runModelEdit(cls, identity<TV>(), st, (c) => {
      goToEntity(c, findId(st.stateModel, "P"));
      return mkEntity(c, Dgm("D2", [])).entityId;
    });
    if (r.tag === "Left") throw new Error("model");
    const model0 = r.value[0].updateNewModel;
    const dgm2 = r.value[0].updateValue;
    const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
    const active: ModelId[] = [];
    const updates: Maybe<string>[] = [];
    let fire: (s: Script) => void = () => {};
    let activate: (m: ModelId, tag?: string) => boolean = () => false;
    let editorWidget: Gtk.Widget | null = null;
    const net = B.compile(() => {
      const [scriptE, f] = B.newEvent<Script>();
      fire = f;
      const modelERef: B.Event<Model<TV>> = B.lazyE(() => modelE);
      const modelC = Changes(modelERef, B.stepper(model0, modelERef));
      const out = editorWindows<TV>(cls, win, Gtk.iconThemeGetDefault(), () => "model-package", model0, modelC,
        B.never(), scriptE);
      const modelE = B.mapE((u: ModelUpdate<TV, Maybe<string>>) => u.updateNewModel, out.editorUpdates);
      B.reactimate(B.mapE((u: ModelUpdate<TV, Maybe<string>>) => () => updates.push(u.updateValue), out.editorUpdates));
      B.reactimate(B.mapE((a: ActiveEntity<Pt, TV>) => () => active.push(a.activeWrapper.wrappedEntityId),
        out.editorActiveEntity));
      activate = out.editorActivate;
      editorWidget = out.editorWidget;
    });
    B.actuate(net);
    expect(editorWidget).not.toBeNull();
    const open = (m: ModelId): Script => function* (c) {
      yield* openDiagram<Pt, TV, TV>(cls, c, m);
      return Nothing;
    };
    expect(activate(dgm)).toBe(false); // Not open yet.
    fire(open(dgm));
    fire(open(dgm2));
    expect(active.slice(-1)).toEqual([dgm2]);
    expect(active).toContain(dgm);
    active.length = 0;
    expect(activate(dgm)).toBe(true);
    expect(active.slice(-1)).toEqual([dgm]);
    expect(activate(dgm, "no such view")).toBe(false);
    expect(updates.every((u) => u.tag === "Nothing")).toBe(true);
  });
});
