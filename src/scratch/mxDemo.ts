/**
 * Scratch demo for task mx (`?demo=mx`): `Model.Matrices.Screen`, `Model.Matrices.Design` and
 * `Model.Matrices.Excel` on the example model "3 Managing Risks.dsm".
 *
 * The notebook has two pages for the matrix chosen in the combo box: "Run" shows the matrix
 * results (`matrixDisplay`, the "run" view of `getMatrixWrapper`) and "Design" shows the matrix
 * design editor (`matrixDesignGadget`). Edits from either page are applied to the model by a tiny
 * interpreter (the scripts of the matrix display never yield; design edits run in the `_Matrix`
 * subtype) and the resulting undo messages are shown in the status line. "Export to Excel"
 * downloads the matrix as an `.xlsx` file (`matrixCells` + `matrixBook`), showing the errors or
 * warnings dialogs first if there are any.
 *
 * `&matrix=<n>` chooses the n-th matrix at start-up; `&page=design` opens the design page.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import type { Maybe } from "@/lib/Data/Maybe";
import { identity } from "@/lib/Control/Lens";
import { fromXlsx } from "@/lib/Codec/Xlsx";
import { downloadBlob } from "@/lib/System/IO";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { GadgetData, makeChanges } from "@/banana-ui/base/Reactive/Banana/Common";
import { renderGadget, runDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import {
  modelStartState, runModelEdit, show_ModelError, type Model, type ModelEdit, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { ModelScriptAct } from "@/hades/src/Model/Abstract/DiagramType";
import type { Matrix } from "@/hades/src/Model/Matrices/Base";
import { matrixDesignGadget } from "@/hades/src/Model/Matrices/Design";
import { matrixBook, matrixCells, matrixErrorsDialog, matrixExportDialog, matrixWarningsDialog } from "@/hades/src/Model/Matrices/Excel";
import { matrixDisplay } from "@/hades/src/Model/Matrices/Screen";
import { readRiskModel, riskClass, type RV } from "@/hades/src/Model/Matrices/testing/RiskModel";
import risksJson from "@/dsm/share/examples/3 Managing Risks.dsm?raw";

type Script = ModelScriptAct<null, RV, RV, Maybe<string>>;
type DesignEdit = ModelEdit<RV, Matrix, Maybe<string>>;

export function main(): void {
  const params = new URLSearchParams(location.search);
  let model: Model<RV> = readRiskModel(JSON.parse(risksJson));
  const matrices: [ModelId, string][] = M.toList(model.modelContents)
    .filter(([, e]) => e._entityContents.tag === "Matrix")
    .map(([k, e]) => [k, (e._entityContents as { _0: Matrix })._0._matrixName._0]);
  const theme = Gtk.iconThemeGetDefault();

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Matrices: " + model.modelName);
  Gtk.windowSetDefaultSize(win, 1100, 700);
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  Gtk.containerSetBorderWidth(vbox, 6);
  Gtk.containerAdd(win, vbox);
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  const combo = Gtk.comboBoxTextNew();
  for (const [, n] of matrices) Gtk.comboBoxTextAppendText(combo, n);
  const exportButton = Gtk.buttonNewWithLabel("Export to Excel…");
  const status = Gtk.labelNew("Edit a cell or the design; the change message appears here.");
  Gtk.labelSetXalign(status, 0);
  Gtk.boxPackStart(bar, combo, false, false, 0);
  Gtk.boxPackStart(bar, exportButton, false, false, 0);
  Gtk.boxPackStart(bar, status, true, true, 6);
  Gtk.boxPackStart(vbox, bar, false, false, 0);
  const notebook = Gtk.notebookNew();
  Gtk.boxPackStart(vbox, notebook, true, true, 0);

  const say = (txt: string): void => Gtk.labelSetText(status, txt);
  let current = Math.min(Number(params.get("matrix") ?? 0), matrices.length - 1);
  let stopNet: (() => void) | null = null;

  /** Apply a model update and report the message. */
  const applyEdit = <W>(prsm: Parameters<typeof runModelEdit<RV, W, Maybe<string>>>[1], act: ModelEdit<RV, W, Maybe<string>>): void => {
    const r = runModelEdit(riskClass, prsm, modelStartState(newGenerator(), model), act);
    if (r.tag === "Left") {
      say("Error: " + show_ModelError(r.value));
      return;
    }
    model = r.value[0].updateNewModel;
    const msg = r.value[0].updateValue;
    say(msg.tag === "Just" ? msg.value : "(no change)");
    fireModel(model);
  };
  let fireModel: (m: Model<RV>) => void = () => {};

  const show = (): void => {
    if (stopNet) stopNet();
    while (Gtk.notebookGetNPages(notebook) > 0) Gtk.notebookRemovePage(notebook, 0);
    const [mId] = matrices[current];
    const e = M.lookup(mId, model.modelContents);
    if (e.tag === "Nothing" || e.value._entityContents.tag !== "Matrix") return;
    const matrix = e.value._entityContents._0;
    const net = B.compile(() => {
      const [modelE, fire] = B.newEvent<Model<RV>>();
      fireModel = fire;
      const envC = makeChanges(model, modelE);
      // "Run" page: the view of getMatrixWrapper.
      const runInit = GadgetData(true, [matrix._matrixDefaultInput, null] as [S.Set<ModelId>, null]);
      const run = renderGadget(theme, () => {}, model, runInit, envC, B.never(), B.pureB(runInit), matrixDisplay<null, RV>(riskClass, mId));
      const runBox = Gtk.boxNew(Gtk.OrientationVertical, 0);
      for (const w of run.gadgetView) Gtk.boxPackStart(runBox, w, false, false, 0);
      const runScroll = Gtk.scrolledWindowNew(null, null);
      Gtk.containerAdd(runScroll, runBox);
      Gtk.notebookAppendPage(notebook, runScroll, Gtk.labelNew("Run"));
      B.reactimate(B.mapE((ws: readonly Script[]) => () => {
        for (const w of ws) {
          applyEdit(identity<RV>(), (ctx) => {
            const gen = w(ctx);
            const step = gen.next();
            if (!step.done) throw new Error("A matrix edit script asked for user interaction.");
            return step.value;
          });
        }
      }, run.gadgetEvents));
      // "Design" page: the editor of matrixEdit (BasicTypes).
      const designInit = GadgetData(true, [null, matrix] as [null, Matrix]);
      const design = renderGadget(theme, () => {}, model, designInit, envC, B.never(), B.pureB(designInit),
        matrixDesignGadget(riskClass, mId));
      const designBox = Gtk.boxNew(Gtk.OrientationVertical, 0);
      for (const w of design.gadgetView) Gtk.boxPackStart(designBox, w, true, true, 0);
      Gtk.notebookAppendPage(notebook, designBox, Gtk.labelNew("Design"));
      B.reactimate(B.mapE((ws: readonly DesignEdit[]) => () => {
        for (const w of ws) applyEdit(riskClass._Matrix, w);
      }, design.gadgetEvents));
    });
    B.actuate(net);
    stopNet = () => B.pause(net);
    Gtk.widgetShowAll(notebook);
  };

  Gtk.comboBoxSetActive(combo, current);
  Gtk.onComboBoxChanged(combo, () => {
    current = Gtk.comboBoxGetActive(combo);
    show();
  });

  // matrixExport (BasicTypes): pick the input, then export or show the errors and warnings.
  Gtk.onButtonClicked(exportButton, () => {
    void (async () => {
      const [mId, name] = matrices[current];
      const e = M.lookup(mId, model.modelContents);
      if (e.tag === "Nothing" || e.value._entityContents.tag !== "Matrix") return;
      const matrix = e.value._entityContents._0;
      const picked = await runDialog(win, theme, matrixExportDialog(riskClass, model, matrix), model, matrix._matrixDefaultInput);
      if (picked.tag === "Nothing") return;
      const targetId = S.toList(picked.value)[0] ?? M.keys(model.modelContents)[0];
      const target = M.lookup(targetId, model.modelContents);
      const targetName = target.tag === "Just" ? riskClass.name.get(target.value._entityContents)._0 : model.modelName;
      const r = matrixCells(riskClass, model, targetId, matrix);
      if (r.tag === "Left") {
        await runDialog(win, theme, matrixErrorsDialog<Model<RV>, null>(r.value), model, null);
        return;
      }
      const [cells, warns] = r.value;
      if (warns.length > 0) {
        const ok = await runDialog(win, theme, matrixWarningsDialog<Model<RV>, null>(warns), model, null);
        if (ok.tag === "Nothing") return;
      }
      const title = name + " - " + targetName;
      const bytes = fromXlsx(Date.now() / 1000, matrixBook(riskClass, model, matrix, title, cells));
      downloadBlob(title + ".xlsx", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      say("Exported " + title + ".xlsx (" + String(M.size(cells)) + " cells)");
    })();
  });

  show();
  Gtk.widgetShowAll(win);
  if (params.get("page") === "design") Gtk.notebookSetCurrentPage(notebook, 1);
  Gtk.main();
}
