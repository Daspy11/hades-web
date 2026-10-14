/**
 * Scratch demo for `Causality.Risk` (open the app with `?demo=cr`).
 *
 * Loads an example model (`&file=1` .. `&file=4`, default "4 Managing Hazards") with the
 * SafetyModel-like test model of `src/dsm/causality/Causality/BowTieTestModel.ts` and shows each
 * bow tie diagram in a notebook page, edited through `App.GenericDiagram` with the
 * `DiagramTypeClass (BowTieType v) v` instance and the bow tie toolbar. `&page=<n>` selects the
 * page shown at start-up. Script instructions are answered as a GUI would after pressing OK
 * without changes. `window.cr` exposes the editor state for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { identity, view } from "@/lib/Control/Lens";
import { fetchDataFile, getDataDir } from "@/lib/System/Paths";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { setDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import {
  type Action, type BoundBox as BoundBoxT, deltaDiagram, deltaZoom, diagramContents, mkScriptAction, streamStateT,
  tellAll, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesActionResult, type HadesGtk, HadesActionResult as mkHadesActionResult, hadesActionExecute,
  hadesConfig, hadesState, makeBottomBar, makeDrawingGtk, makeGtkDeltaToolbar,
} from "@/hades/src/Hades/GI";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import { Avatar_Element } from "@/hades/src/App/GenericDiagram";
import { type EntityWrapper, type UserScriptFunctor, keyCommands } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelId, JSON_Model, evalModelEdit,
  modelStartState, queryRelations, runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { getReferenceValues } from "@/hades/src/Model/Abstract/Properties";
import { type BowTieType, type ElemBowTie, DiagramTypeClass_BowTieType } from "@/dsm/causality/Causality/Risk";
import { type TV, _BowTieItem, cls, tvName } from "@/dsm/causality/Causality/BowTieTestModel";

const dtc = DiagramTypeClass_BowTieType<TV>(cls);
const ecls = Avatar_Element<BowTieType<TV>, TV>(dtc);
type D = ElemBowTie<TV>;

let modelState: ModelEditState<TV> = modelStartState<TV>(newGenerator(), {} as Model<TV>);
let currentHint: Maybe<string> = Nothing;
const statusLabel = Gtk.labelNew("");
const log: string[] = [];

function setStatus(msg: string): void {
  log.push(msg);
  Gtk.labelSetText(statusLabel, msg);
}

function answer(ctx: ModelEditCtx<TV, any>, instr: UserScriptFunctor<any, TV>): unknown {
  switch (instr.tag) {
    case "ScriptProperties": {
      const e = M.lookup(instr._0, ctx.state.stateModel.modelContents);
      if (e.tag === "Nothing") return Nothing;
      setStatus("Properties of " + view(tvName, e.value._entityContents)._0 + ": OK");
      return Just([e.value, queryRelations(ctx, (r) => getReferenceValues(instr._0, r))]);
    }
    case "ScriptDialog": return Just(instr._1);
    case "ScriptOpenDiagram": return null;
    case "ScriptGetSelection": return S.empty();
    case "ScriptSetSelection": return null;
    case "ScriptGetHint": return currentHint;
    case "ScriptSetHint":
      currentHint = instr._0;
      if (instr._0.tag === "Just") setStatus(instr._0.value);
      return null;
    case "ScriptPerformIO": return instr._0();
  }
}

/** Run the diagram actions in a "ModelScript" on the bow tie subtype, answering its instructions. */
function runActions(h: HadesGtk<D>, acts: readonly Action<D>[]): HadesActionResult<D> {
  const r = runModelEdit(cls, _BowTieItem, modelState, (ctx) => {
    const gen = hadesActionExecute(ctx, h, acts);
    let res = gen.next();
    while (!res.done) res = gen.next(answer(ctx, res.value as UserScriptFunctor<any, TV>));
    return res.value;
  });
  if (r.tag === "Left") {
    setStatus("Error: " + show_ModelError(r.value));
    return mkHadesActionResult(h, () => {}, Nothing, []);
  }
  modelState = r.value[1];
  return r.value[0].updateValue;
}

interface Page {
  readonly name: string;
  readonly entity: ModelId;
  current: HadesGtk<D> | null;
}

const style = (() => {
  const dataTheme = Gtk.iconThemeNew();
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [getDataDir("dsm")]);
  setDataIconTheme(dataTheme);
  const systemTheme = Gtk.iconThemeGetDefault();
  Gtk.iconThemeAppendSearchPath(systemTheme, getDataDir("dsm"));
  Gtk.iconThemeAppendSearchPath(systemTheme, getDataDir("hades"));
  return hadesConfig(dataTheme);
})();

function editorPage(page: Page): Gtk.Widget {
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  const ent = M.lookup(page.entity, modelState.stateModel.modelContents);
  if (ent.tag === "Nothing") throw new Error("missing diagram");
  const w = evalModelEdit<TV, TV, Maybe<EntityWrapper<HadesRender, TV>>>(cls, identity<TV>(), modelState.stateModel,
    (c) => cls.getDiagramWrapper(c, ent.value));
  if (w.tag === "Left" || w.value.tag === "Nothing" || w.value.value.tag !== "DiagramWrapper") {
    throw new Error("not a diagram: " + page.name);
  }
  const wrapper = w.value.value;
  const net = B.compile(() => {
    const [toolbarWidget, toolbarActions] = makeGtkDeltaToolbar(ecls, wrapper.diagramToolbar(null as any));
    const hadesRef: B.Behavior<HadesGtk<D>> = B.lazyB(() => hadesB);
    const [drawingWidget, hadesInit, diagramActions] = makeDrawingGtk<D>(
      ecls, wrapper.diagramToEdit, wrapper.diagramContext, wrapper.diagramMenu, keyCommands<D>(), style, 1, hadesRef);
    const zoomRef: B.Event<number> = B.lazyE(() => zoomE);
    const updateZoom = (z: number): Action<D> => mkScriptAction<D>(function* (d) {
      d.state = { ...d.state, _deltaZoom: z };
      yield* tellAll(d);
      return yield* yieldViews(d);
    });
    const allActions = [diagramActions, toolbarActions, B.mapE((z: number) => [updateZoom(z)], zoomRef)]
      .reduceRight((acc, e) => B.unionWith((a: Action<D>[], b: Action<D>[]) => [...a, ...b], e, acc));
    const results = B.execute(B.apply(
      B.mapB((h: HadesGtk<D>) => (acts: Action<D>[]) => () => runActions(h, acts), hadesRef),
      allActions));
    const hadesB: B.Behavior<HadesGtk<D>> = B.stepper(hadesInit, B.mapE((r) => r.hadesActionNewState, results));
    B.reactimate(B.mapE((r) => () => {
      page.current = r.hadesActionNewState;
      r.hadesActionDraw();
      if (r.hadesActionCheckpoint.tag === "Just") setStatus(r.hadesActionCheckpoint.value);
    }, results));
    const zoomOf = (h: HadesGtk<D>): number => view(deltaZoom<D>(), streamStateT(view(hadesState<D>(), h)));
    const hintB: B.Behavior<Maybe<string>> = B.stepper<Maybe<string>>(Nothing,
      B.filterJust(B.mapE((r) => (r.hadesActionCheckpoint.tag === "Just" ? Just(r.hadesActionCheckpoint) : Nothing), results)));
    const [bottomBar, zoomE] = makeBottomBar(hintB, B.mapB(zoomOf, hadesB));
    Gtk.boxPackStart(vbox, toolbarWidget, false, false, 0);
    Gtk.boxPackStart(vbox, drawingWidget, true, true, 0);
    Gtk.boxPackStart(vbox, bottomBar, false, false, 0);
    page.current = hadesInit;
  });
  B.actuate(net);
  return vbox;
}

const exampleFiles = ["1 Quick Guide to the DSM.dsm", "2 FMEA.dsm", "3 Managing Risks.dsm", "4 Managing Hazards.dsm"];

export async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const fileIx = Math.max(0, Math.min(exampleFiles.length - 1, Number(params.get("file") ?? "4") - 1));
  const fileName = exampleFiles[fileIx];
  const json = await (await fetchDataFile("dsm", "examples/" + fileName)).json();
  const model = JSON_Model<TV>(cls).parseJSON(json);
  modelState = modelStartState<TV>(newGenerator(), model);

  const diagrams: Entity<TV>[] = M.elems(model.modelContents)
    .filter((e) => e._entityContents.tag === "BowTieItem" && e._entityContents._0.tag === "BowTieDiagram")
    .sort((a, b) => (view(tvName, a._entityContents)._0 < view(tvName, b._entityContents)._0 ? -1 : 1));
  const pages: Page[] = diagrams.map((e) => ({ name: view(tvName, e._entityContents)._0, entity: e.entityId, current: null }));

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Bow tie demo — " + fileName);
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, vbox);
  const nb = Gtk.notebookNew();
  Gtk.notebookSetScrollable(nb, true);
  for (const p of pages) Gtk.notebookAppendPage(nb, editorPage(p), Gtk.labelNew(p.name));
  Gtk.boxPackStart(vbox, nb, true, true, 0);
  Gtk.widgetSetMarginStart(statusLabel, 6);
  Gtk.boxPackStart(vbox, statusLabel, false, false, 0);
  Gtk.notebookSetCurrentPage(nb, Number(params.get("page") ?? "0"));

  const stateOf = (p: Page) => (p.current === null ? null : streamStateT(view(hadesState<D>(), p.current)));
  const describe = (e: D): unknown[] => {
    switch (e.tag) {
      case "ElemBox": {
        const b = e._0;
        const bb = view(b.boxShapeClass.shapeDefinition, b.boxShape) as BoundBoxT;
        const ent = M.lookup(b.boxEntity, modelState.stateModel.modelContents);
        const nm = ent.tag === "Just" ? view(tvName, ent.value._entityContents)._0 : "?";
        return ["box", b.boxType, nm, ...(bb.tag === "BoundBox" ? [bb._0._pX, bb._0._pY, bb._1._pX, bb._1._pY] : [])];
      }
      case "ElemArrow": return ["arrow", e._0.arrowType];
      case "ElemComment": return ["comment", e._0._commentText];
      case "ElemLink": return ["link", e._0._linkText];
    }
  };
  (window as any).cr = {
    pages: () => pages.map((p) => p.name),
    items: (n: number) => {
      const s = stateOf(pages[n]);
      return s === null ? [] : M.elems(view(deltaDiagram<D>().dot(diagramContents<D>()), s)).map(describe);
    },
    entityNames: () => M.elems(modelState.stateModel.modelContents).map((e) => view(tvName, e._entityContents)._0).sort(),
    log: () => log,
  };
  Gtk.windowSetDefaultSize(win, 1300, 820);
  Gtk.widgetShowAll(win);
  Gtk.main();
}
