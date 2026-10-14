/**
 * Scratch demo for task rd (`?demo=rd`): `Model.Report.Dialogs` on the example model
 * "3 Managing Risks.dsm".
 *
 * The combo box picks one of the reports of the model (kept as raw JSON by the test model, read
 * with `JSON_Report`); the page shows its design editor (`reportDesignGadget`), whose edits are
 * applied to the model with the undo message shown in the status line. The buttons open the run
 * dialog (`reportRunDialog False`), the preview dialog (`reportRunDialog True`) and a warnings
 * dialog (`reportWarningsDialog`) and show the result.
 *
 * `&report=<n>` picks the report; `&dialog=run|preview|warnings|<fragment number>` opens a dialog
 * at start-up (a fragment number opens that top-level fragment's dialog from
 * `reportDialogSelector`); `&section=1` first adds a section with two children to the report.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { preview, prism, type Prism } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { GadgetData, makeChanges } from "@/banana-ui/base/Reactive/Banana/Common";
import { renderGadget, runDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import {
  goToEntity, modelStartState, nameField, runModelEdit, setValue, show_ModelError,
  type Model, type ModelEdit, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { SortOrder } from "@/hades/src/Model/Matrices/Base";
import { readRiskModel, riskClass, type RV } from "@/hades/src/Model/Matrices/testing/RiskModel";
import { JSON_Report, ReportField, ReportHeading, ReportLiteral, SubReport, type Report } from "@/hades/src/Model/Report/Base";
import {
  reportDesignGadget, reportDialogSelector, reportRunDefault, reportRunDialog, reportWarningsDialog,
  show_ReportRunParameters,
} from "@/hades/src/Model/Report/Dialogs";
import risksJson from "@/dsm/share/examples/3 Managing Risks.dsm?raw";

type DesignEdit = ModelEdit<RV, Report<RV>, Maybe<string>>;

const _ReportRV: Prism<RV, Report<RV>> = prism(
  (r: Report<RV>): RV => ({ tag: "Other", _0: JSON_Report.toJSON(r) as J.JSONObject }),
  (v: RV) => (v.tag === "Other" && v._0.type === "report" ? Right(JSON_Report.parseJSON(v._0) as Report<RV>) : Left(v)),
);

export function main(): void {
  const params = new URLSearchParams(location.search);
  let model: Model<RV> = readRiskModel(JSON.parse(risksJson));
  const reports: [ModelId, string][] = M.toList(model.modelContents).flatMap(([k, e]): [ModelId, string][] => {
    const r = preview(_ReportRV, e._entityContents);
    return r.tag === "Just" ? [[k, r.value._reportName._0]] : [];
  });
  const theme = Gtk.iconThemeGetDefault();

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Reports: " + model.modelName);
  Gtk.windowSetDefaultSize(win, 900, 650);
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  Gtk.containerSetBorderWidth(vbox, 6);
  Gtk.containerAdd(win, vbox);
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  const combo = Gtk.comboBoxTextNew();
  for (const [, n] of reports) Gtk.comboBoxTextAppendText(combo, n);
  const runButton = Gtk.buttonNewWithLabel("Run…");
  const previewButton = Gtk.buttonNewWithLabel("Preview…");
  const warnButton = Gtk.buttonNewWithLabel("Warnings…");
  const status = Gtk.labelNew("Edit the report; the change message appears here.");
  Gtk.labelSetXalign(status, 0);
  Gtk.labelSetLineWrap(status, true);
  for (const w of [combo, runButton, previewButton, warnButton]) Gtk.boxPackStart(bar, w, false, false, 0);
  Gtk.boxPackStart(vbox, bar, false, false, 0);
  Gtk.boxPackStart(vbox, status, false, false, 0);
  const page = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.boxPackStart(vbox, page, true, true, 0);

  const say = (txt: string): void => Gtk.labelSetText(status, txt);
  let current = Math.min(Number(params.get("report") ?? 0), reports.length - 1);
  let stopNet: (() => void) | null = null;
  let fireModel: (m: Model<RV>) => void = () => {};

  const currentReport = (): Report<RV> | null => {
    const e = M.lookup(reports[current][0], model.modelContents);
    if (e.tag === "Nothing") return null;
    const r = preview(_ReportRV, e.value._entityContents);
    return r.tag === "Just" ? r.value : null;
  };

  const applyEdit = (act: DesignEdit): void => {
    const r = runModelEdit(riskClass, _ReportRV, modelStartState(newGenerator(), model), act);
    if (r.tag === "Left") {
      say("Error: " + show_ModelError(r.value));
      return;
    }
    model = r.value[0].updateNewModel;
    const msg = r.value[0].updateValue;
    say(msg.tag === "Just" ? msg.value : "(no change)");
    fireModel(model);
  };

  if (params.get("section") === "1") {
    const rpt = currentReport();
    if (rpt) {
      const [rId] = reports[current];
      const r2: Report<RV> = {
        ...rpt,
        _reportSpec: [...rpt._reportSpec, SubReport<RV>(Nothing, SortOrder([[nameField, "Ascending"]]), [
          ReportHeading<RV>(2, "Risk", Just([nameField, ""] as const)),
          ReportField<RV>(nameField),
          ReportLiteral<RV>("Some text\nover two lines"),
        ])],
      };
      // goToEntity + setValue, as the edits of reportDelta do.
      applyEdit((ctx) => {
        goToEntity(ctx, rId);
        void setValue(ctx, r2);
        return Just("Added a section");
      });
    }
  }

  const show = (): void => {
    if (stopNet) stopNet();
    for (const c of Gtk.containerGetChildren(page)) Gtk.widgetDestroy(c);
    const [rId] = reports[current];
    const rpt = currentReport();
    if (!rpt) return;
    const net = B.compile(() => {
      const [modelE, fire] = B.newEvent<Model<RV>>();
      fireModel = fire;
      const envC = makeChanges(model, modelE);
      const init = GadgetData(true, [null, rpt] as [null, Report<RV>]);
      const design = renderGadget(theme, () => {}, model, init, envC, B.never(), B.pureB(init), reportDesignGadget(riskClass, rId));
      for (const w of design.gadgetView) Gtk.boxPackStart(page, w, true, true, 0);
      B.reactimate(B.mapE((ws: readonly DesignEdit[]) => () => {
        for (const w of ws) applyEdit(w);
      }, design.gadgetEvents));
    });
    B.actuate(net);
    stopNet = () => B.pause(net);
    Gtk.widgetShowAll(page);
  };

  const openRun = async (previewFlag: boolean): Promise<void> => {
    const rpt = currentReport();
    if (!rpt) return;
    const r = await runDialog(win, theme, reportRunDialog(riskClass, previewFlag, rpt), model, reportRunDefault(rpt));
    say(r.tag === "Just" ? show_ReportRunParameters(r.value) : "Cancelled");
  };
  const openWarnings = async (): Promise<void> => {
    const warns: [ModelId, string][] = [
      [reports[current][0], "This report has a warning."],
      [U.nil, "This warning has no entity."],
    ];
    const r = await runDialog(win, theme, reportWarningsDialog(riskClass, warns), model, null);
    say(r.tag === "Just" ? "Go ahead" : "Cancelled");
  };
  const openFragment = async (n: number): Promise<void> => {
    const rpt = currentReport();
    if (!rpt || n >= rpt._reportSpec.length) return;
    const frag = rpt._reportSpec[n];
    const d = reportDialogSelector<RV, null>(riskClass)(model, frag);
    if (d.tag === "Nothing") {
      say("No dialog for this fragment");
      return;
    }
    const r = await runDialog(win, theme, d.value, model, frag);
    say(r.tag === "Just" ? JSON.stringify(r.value) : "Cancelled");
  };

  Gtk.comboBoxSetActive(combo, current);
  Gtk.onComboBoxChanged(combo, () => {
    current = Gtk.comboBoxGetActive(combo);
    show();
  });
  Gtk.onButtonClicked(runButton, () => void openRun(false));
  Gtk.onButtonClicked(previewButton, () => void openRun(true));
  Gtk.onButtonClicked(warnButton, () => void openWarnings());

  show();
  Gtk.widgetShowAll(win);
  const dlg = params.get("dialog");
  if (dlg === "run") void openRun(false);
  else if (dlg === "preview") void openRun(true);
  else if (dlg === "warnings") void openWarnings();
  else if (dlg !== null && /^\d+$/.test(dlg)) void openFragment(Number(dlg));
  Gtk.main();
}

