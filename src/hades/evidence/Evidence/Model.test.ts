import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import * as Cairo from "@/lib/GI/Cairo";
import * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { identity, lens, prism, review, set, view, type Prism } from "@/lib/Control/Lens";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { getDataIconTheme, setDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { getDataDir } from "@/lib/System/Paths";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { BoundBox, Point } from "@/hades/src/Hades/Abstract/Geometry";
import { hadesConfig, layoutText } from "@/hades/src/Hades/GI/BasicShapes";
import { type ModelScriptAct, stepScript } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type ModelEditState, type ModelError, type ModelId, Name, Package, emptyModel,
  entityName, goToEntity, mkEntity, mkPackage, modelStartState, nameField, nameText, runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { mkOneToMany, append_RefTypeTable, mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { extract } from "@/hades/src/Model/Reflection/Reflective";
import { ExtText, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type HasEvidence, Evidence, JSON_Evidence, JSON_Trace, Reflective_Evidence, Reflective_Trace, Trace,
  addEvidenceEntityMenu, drawEvidence, evidenceActivation, evidenceEntityMenu, evidenceIconName,
  evidenceIconPixbuf, evidenceName, evidenceVariant, show_Evidence, show_Trace, traceActivation, traceArrowDash,
  traceArrowHead, traceArrowRelations, traceEntityMenu, traceHeadRelation, traceIconName, traceName,
  traceTailRelation, traceVariant,
} from "./Model";

describe("Evidence", () => {
  const e = Evidence(Name("E1"));
  it("encodes as aeson does", () => {
    expect(JSON_Evidence.toJSON(e)).toEqual({ type: "evidence", name: "E1" });
    expect(JSON_Evidence.parseJSON({ type: "evidence", name: " E2 " })).toEqual(Evidence(Name("E2")));
    expect(J.parseEither((v) => JSON_Evidence.parseJSON(v), { type: "trace", name: "E3" }))
      .toEqual(Left('Not an evidence item: Name "E3"'));
    expect(() => JSON_Evidence.parseJSON({ name: "E" })).toThrow();
  });
  it("is reflective, stripping white space from the name", () => {
    expect(Reflective_Evidence.reflectiveName(e)).toBe("Evidence");
    expect(Reflective_Evidence.reflectiveDefaults).toEqual([Evidence(Name(""))]);
    expect(Reflective_Evidence.reflectiveBuiltIn(e)).toEqual([nameField]);
    expect(Reflective_Evidence.reflectiveGet(e)).toEqual(M.singleton(nameField, ExtText("E1")));
    const st = { state: M.fromList([[nameField, ExtText("  New  ")], ["other", ExtText("x")]]) };
    expect(Reflective_Evidence.reflectiveSet(st, e)).toEqual(Evidence(Name("New")));
    expect(M.keys(st.state)).toEqual(["other"]);
    expect(Reflective_Evidence.reflectiveSet({ state: M.empty() }, e)).toEqual(e);
    expect(M.size(Reflective_Evidence.reflectiveArrows)).toBe(0);
    expect(Reflective_Evidence.reflectiveBuiltInRefs).toEqual(mempty_RefTypeTable);
  });
  it("has an iso, Show and constants", () => {
    expect(view(evidenceName, e)).toEqual(Name("E1"));
    expect(review(evidenceName, Name("x"))).toEqual(Evidence(Name("x")));
    expect(show_Evidence(e)).toBe('Evidence {_evidenceName = Name "E1"}');
    expect(evidenceVariant).toBe("Evidence");
    expect(evidenceIconName).toBe("evidence-doc");
  });
});

describe("Trace", () => {
  const t = Trace(Name("T1"));
  it("encodes as aeson does", () => {
    expect(JSON_Trace.toJSON(t)).toEqual({ type: "trace", name: "T1" });
    expect(JSON_Trace.parseJSON({ type: "trace", name: "T2" })).toEqual(Trace(Name("T2")));
    expect(J.parseEither((v) => JSON_Trace.parseJSON(v), { type: "evidence", name: "T3" }))
      .toEqual(Left('Type = "evidence", expected "trace"'));
  });
  it("is a reflective arrow from anything to evidence", () => {
    expect(Reflective_Trace.reflectiveName(t)).toBe("Trace");
    expect(Reflective_Trace.reflectiveGet(t)).toEqual(M.singleton(nameField, ExtText("T1")));
    // Unlike Evidence, the name is not stripped.
    expect(Reflective_Trace.reflectiveSet({ state: M.singleton(nameField, ExtText(" T ")) }, t)).toEqual(Trace(Name(" T ")));
    expect(Reflective_Trace.reflectiveArrows).toEqual(M.singleton("Trace", ["Trace Tail", "Trace Head"]));
    expect(Reflective_Trace.reflectiveBuiltInRefs).toEqual(traceArrowRelations([], [evidenceVariant]));
  });
  it("builds reference tables for the tail and head", () => {
    expect(traceArrowRelations(["Goal"], ["Evidence", "Solution"])).toEqual(append_RefTypeTable(
      mkOneToMany(traceTailRelation, ["Goal"], [traceVariant]),
      mkOneToMany(traceHeadRelation, ["Evidence", "Solution"], [traceVariant]),
    ));
    expect([traceTailRelation, traceHeadRelation]).toEqual(["Trace Tail", "Trace Head"]);
  });
  it("has an iso, Show and drawing constants", () => {
    expect(view(traceName, t)).toEqual(Name("T1"));
    expect(show_Trace(t)).toBe('Trace {_traceName = Name "T1"}');
    expect(traceArrowDash).toEqual([10, 5]);
    expect(traceArrowHead.arrowHeadLength).toBe(0); // An open head does not shorten the line.
    expect(traceArrowHead.arrowHeadWidth).toBeCloseTo(20 * Math.tan(Math.PI / 6), 10);
    expect(traceIconName).toBe("trace-arrow");
  });
});

// ---------------------------------------------------------------------------------------------
// A model with packages, evidence and traces.

type TV =
  | { readonly tag: "P"; readonly _0: Package<TV, null> }
  | { readonly tag: "E"; readonly _0: Evidence }
  | { readonly tag: "T"; readonly _0: Trace };
const tvName = lens(
  (v: TV): Name => (v.tag === "P" ? v._0._packageName : v.tag === "E" ? v._0._evidenceName : v._0._traceName),
  (v: TV, n: Name): TV => (v.tag === "P" ? { tag: "P", _0: { ...v._0, _packageName: n } }
    : v.tag === "E" ? { tag: "E", _0: Evidence(n) } : { tag: "T", _0: Trace(n) }),
);
const _P: Prism<TV, Package<TV, null>> = prism((p: Package<TV, null>): TV => ({ tag: "P", _0: p }),
  (v: TV) => (v.tag === "P" ? Right(v._0) : Left(v)));
const _E: Prism<TV, Evidence> = prism((e: Evidence): TV => ({ tag: "E", _0: e }),
  (v: TV) => (v.tag === "E" ? Right(v._0) : Left(v)));
const _T: Prism<TV, Trace> = prism((t: Trace): TV => ({ tag: "T", _0: t }),
  (v: TV) => (v.tag === "T" ? Right(v._0) : Left(v)));

const cls: HasEvidence<TV, null> = {
  reflectiveName: (v) => (v.tag === "P" ? "Package" : v.tag === "E" ? evidenceVariant : traceVariant),
  variantUserLabel: (v) => v,
  reflectiveDefaults: [{ tag: "P", _0: Package(Name(""), null) }, { tag: "E", _0: Evidence(Name("")) }],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(tvName, v)._0)),
  reflectiveSet: (st, v) => set(tvName, Name(extract(st, view(tvName, v)._0, _ExtText, nameField)), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: tvName,
  _Package: _P,
  entityCanHaveChild: (p) => p.tag === "P",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(() => null, () => J.fail("unused")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  _Evidence: _E,
  _Trace: _T,
};

function edit<A>(st: ModelEditState<TV>, act: (c: any) => A): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, identity<TV>(), st, act);
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

/**
 * Run a script to completion, answering instructions as a GUI would. A property dialog is
 * answered with "OK" and no changes, or cancelled if `cancel` is set.
 */
function interpret<W, A>(
  st0: ModelEditState<TV>,
  prsm: Prism<TV, W> | ReturnType<typeof identity<TV>>,
  script: ModelScriptAct<null, TV, W, A>,
  cancel = false,
): Either<ModelError, [A, ModelEditState<TV>, string[]]> {
  let st = st0;
  let act = script;
  const log: string[] = [];
  for (;;) {
    const r = runModelEdit(cls, prsm as Prism<TV, W>, st, (c) => stepScript(c, act));
    if (r.tag === "Left") return Left(r.value);
    const [upd, newState] = r.value;
    const step = upd.updateValue;
    if (step.tag === "Pure") return Right([step._0, newState, log]);
    const instr = step._0;
    log.push(instr.tag);
    st = newState;
    act = step._1(instr.tag === "ScriptProperties"
      ? (cancel ? Nothing : Just([entity(newState, instr._0), M.empty()]))
      : null);
  }
}

function setup(): { st: ModelEditState<TV>; pkg: ModelId; ev: ModelId; tr: ModelId } {
  const [ids, st] = edit(modelStartState(newGenerator(), emptyModel(cls, "Test")), (c) => {
    const pkg = mkPackage(c, Name("Pkg"));
    goToEntity(c, pkg);
    const ev = mkEntity(c, { tag: "E", _0: Evidence(Name("Report")) }).entityId;
    const tr = mkEntity(c, { tag: "T", _0: Trace(Name("Link")) }).entityId;
    return { pkg, ev, tr };
  });
  return { st, ...ids };
}

const childNames = (st: ModelEditState<TV>, uuid: ModelId): string[] => {
  const e = M.lookup(uuid, st.stateModel.modelContents);
  return e.tag === "Just" ? M.keys(e.value._entityChildren).map((n) => n._0) : [];
};
const entity = (st: ModelEditState<TV>, uuid: ModelId): Entity<TV> => {
  const e = M.lookup(uuid, st.stateModel.modelContents);
  if (e.tag === "Nothing") throw new Error("missing");
  return e.value;
};

describe("menus and activation", () => {
  it("adds evidence and traces to a package", () => {
    const { st, pkg } = setup();
    const menu = addEvidenceEntityMenu<null, TV>(cls, pkg);
    expect(menu._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Add Evidence", "Add Trace"]]);
    const items = menu._0[0];
    const run = (i: number, s: ModelEditState<TV>): [Maybe<string>, ModelEditState<TV>] => {
      const v = items[i].menuValue;
      if (v.tag !== "Right") throw new Error("submenu");
      const r = interpret(s, identity<TV>(), v.value);
      if (r.tag === "Left") throw new Error(show_ModelError(r.value));
      return [r.value[0], r.value[1]];
    };
    const [msg1, st1] = run(0, st);
    expect(msg1).toEqual(Just("Insert Evidence-1"));
    const [msg2, st2] = run(1, st1);
    expect(msg2).toEqual(Just("Insert Trace-1"));
    expect(childNames(st2, pkg)).toEqual(["Evidence-1", "Link", "Report", "Trace-1"]);
    const v = items[0].menuValue;
    if (v.tag !== "Right") throw new Error("submenu");
    const cancelled = interpret(st, identity<TV>(), v.value, true);
    expect(cancelled.tag === "Right" && cancelled.value[0]).toEqual(Nothing);
    expect(cancelled.tag === "Right" && childNames(cancelled.value[1], pkg)).toEqual(["Link", "Report"]);
  });

  it("has context menus for evidence and traces", () => {
    const { st, ev, tr, pkg } = setup();
    const em = evidenceEntityMenu<null, TV>(entity(st, ev));
    expect(em._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Properties", "Clone", "Delete"]]);
    const tm = traceEntityMenu<null, TV>(tr);
    expect(tm._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Properties", "Delete"]]);
    const del = tm._0[0][1].menuValue;
    if (del.tag !== "Right") throw new Error("submenu");
    const r = interpret(st, _T, del.value);
    if (r.tag === "Left") throw new Error(show_ModelError(r.value));
    expect(r.value[0]).toEqual(Just("Delete Link"));
    expect(childNames(r.value[1], pkg)).toEqual(["Report"]);
  });

  it("opens the properties on activation", () => {
    const { st, ev, tr } = setup();
    const none = interpret(st, _E, evidenceActivation<null, TV>(Nothing));
    expect(none.tag === "Right" && none.value[0]).toEqual(Nothing);
    const r = interpret(st, _E, evidenceActivation<null, TV>(Just(entity(st, ev))));
    expect(r.tag === "Right" && r.value[2]).toEqual(["ScriptProperties"]);
    const r2 = interpret(st, _T, traceActivation<null, TV>(Just(entity(st, tr))));
    expect(r2.tag === "Right" && r2.value[2]).toEqual(["ScriptProperties"]);
    const none2 = interpret(st, _T, traceActivation<null, TV>(Nothing));
    expect(none2.tag === "Right" && none2.value[0]).toEqual(Nothing);
  });
});

// ---------------------------------------------------------------------------------------------
// Drawing

describe("evidence icon and box", () => {
  const original = getDataIconTheme();

  it("looks the icon up in the data icon theme", () => {
    const empty = Gtk.iconThemeNew();
    setDataIconTheme(empty);
    expect(evidenceIconPixbuf()).toEqual(Nothing);
    const thm = Gtk.iconThemeNew();
    Gtk.iconThemeSetSearchPath(thm, [getDataDir("dsm")]);
    setDataIconTheme(thm);
    const p = evidenceIconPixbuf();
    expect(p.tag).toBe("Just");
    expect(p.tag === "Just" && [p.value.width, p.value.height]).toEqual([16, 16]);
    expect(evidenceIconPixbuf()).toBe(p); // Memoised.
    setDataIconTheme(original);
  });

  it("draws the outline, the title and the contents", () => {
    setDataIconTheme(Gtk.iconThemeNew()); // No icon, so no image in the drawing.
    const style = hadesConfig(Gtk.iconThemeNew());
    const draw = (mEnt: Maybe<Entity<TV>>, border: Maybe<Colour>): string => {
      const s = new Cairo.SvgSurface(300, 200);
      drawEvidence(cls, mEnt, layoutText([], "Body text"), border, BoundBox(Point(10, 10), Point(210, 110)))(
        { style, cr: s.context() });
      return s.document();
    };
    const { st, ev } = setup();
    const doc = draw(Just(entity(st, ev)), Nothing);
    expect(doc).toMatch(/<path d="M10 10 L210 10 L210 110 L10 110 Z"/);
    expect(doc).toMatch(/font-weight="700"[^>]*>Report<\/text>/);
    expect(doc).toMatch(/font-weight="400"[^>]*>Body text<\/text>/);
    expect(doc.indexOf(">Report<")).toBeLessThan(doc.indexOf(">Body text<"));
    expect(draw(Nothing, Nothing)).toMatch(/>Evidence<\/text>/);
    const red = draw(Nothing, Just(Colour(C.sRGB24(255, 0, 0))));
    expect(red).toMatch(/stroke="rgb\(255, 0, 0\)"/);
    expect(doc).not.toMatch(/stroke="rgb\(255, 0, 0\)"/);
    expect(view(entityName(cls).dot(nameText), entity(st, ev))).toBe("Report");
    setDataIconTheme(original);
  });
});
