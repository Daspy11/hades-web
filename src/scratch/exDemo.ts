/**
 * Scratch demo of `Model.GI.Export` (open the app with `?demo=ex`).
 *
^ * Loads an example model (`&file=1..4`, default 1; bow tie / GSN model dictionary from `Causality.BowTieTestModel`),
 * collects the image resources of two icons and of the model's first diagrams with
 * `getImageResources`, writes an HTML report with `formatReportHtml` to an in-memory file and
 * shows it in an iframe. Buttons run `previewReport` (new tab), `writeReportToFile` (HTML and
 * Word downloads / save pickers) and `writeMatrixToFile` (the first matrix of the model, built with
 * `Model.Matrices.Excel`).
 *
 * `window.ex` exposes `result` (a summary for automated checks) and the actions.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { getDataDir } from "@/lib/System/Paths";
import { readFileText } from "@/lib/System/IO";
import { setDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { cls, readBowTieModel } from "@/dsm/causality/Causality/BowTieTestModel";
import { DiagramRef, IconRef, type ImageRef, reportPageDefault } from "@/hades/src/Model/Report/Base";
import { ReportDocx, ReportHtml } from "@/hades/src/Model/Report/Dialogs";
import { Heading, Icon, Para, Picture, Str, Attr, noAttr, type Block } from "@/hades/src/Model/Report/Document";
import { matrixBook, matrixCells } from "@/hades/src/Model/Matrices/Excel";
import { readRiskModel, riskClass } from "@/hades/src/Model/Matrices/testing/RiskModel";
import {
  formatReportHtml, getImageResources, previewReport, writeMatrixToFile, writeReportToFile,
} from "@/hades/src/Model/GI/Export";
import risksJson from "@/dsm/share/examples/3 Managing Risks.dsm?raw";

const examples = import.meta.glob("/src/dsm/share/examples/*.dsm", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export async function main(): Promise<void> {
  const dataTheme = Gtk.iconThemeNew();
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [getDataDir("dsm")]);
  setDataIconTheme(dataTheme);

  // `&file=1..4` picks the example model for the report (default 1); matrices come from example 3.
  const fileNo = new URLSearchParams(location.search).get("file") ?? "1";
  const exampleKey = Object.keys(examples).sort().find((k) => k.includes("/" + fileNo + " ")) ?? Object.keys(examples)[0];
  const json = JSON.parse(risksJson) as J.Value;
  const model = readBowTieModel(JSON.parse(examples[exampleKey]) as J.Value);
  const diagrams = M.toList(model.modelContents)
    .filter(([, e]) => cls.isDiagram(e._entityContents))
    .slice(0, 2);
  const refs: ImageRef[] = [
    IconRef("general-tick"), IconRef("general-warning"), IconRef("no-such-icon"),
    ...diagrams.map(([mId]) => DiagramRef(mId)),
  ];
  const blocks: Block[] = [
    Heading(1, noAttr, [Str("Export demo")]),
    Para([Str("Icons: "), Icon("general-tick"), Str(" "), Icon("general-warning")]),
    ...diagrams.map(([mId, e]) => {
      const name = cls.name.get(e._entityContents)._0;
      return Picture(Attr(Nothing, Just("DiagramBox")), [Str(name)], name, [400, 250], mId);
    }),
  ];
  const title = "Export demo";

  const t0 = performance.now();
  const imageMap = await getImageResources(cls, model, refs);
  const imagesMs = performance.now() - t0;
  const target = "/memory/exdemo/report.html";
  await formatReportHtml(title, target, blocks, imageMap);
  const html = await readFileText(target);

  const decoder = new TextDecoder();
  const result = {
    diagrams: diagrams.map(([mId, e]) => [U.toText(mId), cls.name.get(e._entityContents)._0]),
    images: M.toList(imageMap).map(([ref, [png, svg]]) => ({
      ref: ref.tag + " " + String(ref._0),
      pngBytes: png.length,
      pngSignature: Array.from(png.slice(1, 4)).map((b) => String.fromCharCode(b)).join(""),
      svgBytes: svg.tag === "Just" ? svg.value.length : null,
      svgStart: svg.tag === "Just" ? decoder.decode(svg.value.slice(0, 60)) : null,
    })),
    imagesMs: Math.round(imagesMs),
    htmlLength: html.length,
    dataUris: (html.match(/src="data:image\/(svg\+xml|png);base64,/g) ?? []).length,
    hasStyle: html.includes("<style>") && html.includes("</style>"),
    title: /<title>(.*?)<\/title>/.exec(html)?.[1] ?? null,
    preview: null as string | null,
    errors: [] as string[],
  };

  // Page
  const win = Gtk.windowNew(Gtk.WindowTypeToplevel);
  Gtk.windowSetTitle(win, "Model.GI.Export demo");
  Gtk.windowSetDefaultSize(win, 1000, 700);
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 6);
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  const status = Gtk.labelNew(`${M.size(imageMap)} images in ${result.imagesMs} ms, report ${html.length} characters`);
  const actions: Record<string, () => Promise<void>> = {};
  const button = (label: string, act: () => Promise<void>): void => {
    actions[label] = act;
    const b = Gtk.buttonNewWithLabel(label);
    Gtk.onButtonClicked(b, () => {
      void act().then(
        () => Gtk.labelSetText(status, label + ": done"),
        (err) => {
          result.errors.push(String(err));
          Gtk.labelSetText(status, label + ": " + String(err));
        },
      );
    });
    Gtk.boxPackStart(bar, b, false, false, 0);
  };
  button("Preview", () => previewReport(cls, model, title, blocks, refs));
  button("Save HTML", () => writeReportToFile(cls, ReportHtml("/download/Export demo.html"), title, model, blocks, refs));
  button("Save Word", () => writeReportToFile(cls, ReportDocx(reportPageDefault, "/download/Export demo.docx"), title, model, blocks, refs));
  button("Export matrix", async () => {
    const riskModel = readRiskModel(json);
    const m = M.toList(riskModel.modelContents).find(([, e]) => e._entityContents.tag === "Matrix");
    if (m === undefined || m[1]._entityContents.tag !== "Matrix") throw new Error("no matrix");
    const matrix = m[1]._entityContents._0;
    const input = S.toList(matrix._matrixDefaultInput)[0] ?? M.keys(riskModel.modelContents)[0];
    const r = matrixCells(riskClass, riskModel, input, matrix);
    if (r.tag === "Left") throw new Error(r.value.join("; "));
    await writeMatrixToFile(matrixBook(riskClass, riskModel, matrix, "Matrix export demo", r.value[0]));
  });
  Gtk.boxPackStart(bar, status, false, false, 6);
  Gtk.boxPackStart(vbox, bar, false, false, 0);
  Gtk.containerAdd(win, vbox);
  Gtk.widgetShowAll(win);

  const iframe = document.createElement("iframe");
  iframe.srcdoc = html;
  iframe.style.cssText = "position:fixed;left:0;right:0;top:60px;z-index:-1;bottom:0;width:100%;height:calc(100% - 60px);border:0;background:#fff";
  document.body.appendChild(iframe);

  (window as any).ex = { result, html, model, actions };
}
