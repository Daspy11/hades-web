/**
 * Scratch demo of the report output modules (open the app with `?demo=r1`): builds a document
 * with headings, lists, a definition list, a matrix with merged cells, links, an icon and a
 * diagram, then
 *
 *  * renders it with `Model.Report.Html.mkHtmlDocument` (with `share/report.css`) in an iframe;
 *  * writes it with `Model.Report.Docx.makeDocx` (PNG drawn on a canvas `ImageSurface`, SVG from
 *    an `SvgSurface`) to an in-memory file, unzips it and checks every XML part with `DOMParser`,
 *    and offers it for download.
 *
 * `window.r1Result` holds a summary (and the document as base64) for automated checks.
 */
import { unzipSync, strFromU8 } from "fflate";
import * as M from "@/lib/Data/Map";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import * as Cairo from "@/lib/GI/Cairo";
import { readFileBytes } from "@/lib/System/IO";
import * as H from "@/lib/Text/Blaze/Html5";
import reportCss from "@/hades/share/report.css?raw";
import { DiagramRef, IconRef, ReportPageLayout, type ImageRef } from "@/hades/src/Model/Report/Base";
import {
  Attr, DefinitionList, Emph, Heading, Highlight, Icon, LinkOut, Matrix, MatrixHeader, OrderedList, Para,
  Picture, Space, Str, Strong, UnorderedList, noAttr,
  type Block, type MatrixCell,
} from "@/hades/src/Model/Report/Document";
import { makeDocx } from "@/hades/src/Model/Report/Docx";
import { mkHtmlDocument } from "@/hades/src/Model/Report/Html";

const diagramId = U.fromWords(0xd1a9, 1, 2, 3);
const cell = (t: string): MatrixCell => [Attr(Nothing, Just("Text")), [Para([Str(t)])]];

const doc: Block[] = [
  Heading(1, Attr(Just([U.fromWords(1, 1, 1, 1), 1]), Nothing), [Str("Report demo with "), Emph([Str("italics")])]),
  Para([Str("A paragraph with a "), LinkOut("https://example.com/", [Str("link")]), Str(", an icon "), Icon("flag"),
    Space, Str("and "), Highlight(C.sRGB24(255, 200, 0), [Strong([Str("highlighted text")])]), Str(". Größe “quoted”.")]),
  OrderedList("ListDecimal", [
    [Para([Str("First item")])],
    [Para([Str("Second item with bullets:")]), UnorderedList([[Para([Str("Bullet a")])], [Para([Str("Bullet b")])]])],
  ]),
  DefinitionList([[[Str("Term")], [Para([Str("Definition.")])]]]),
  Picture(Attr(Nothing, Just("DiagramBox")), [Str("The diagram")], "The diagram", [240, 120], diagramId),
  Matrix(noAttr, [Str("A matrix")], [
    MatrixHeader([Str("Group 1")], [[Str("A")], [Str("B")]]),
    MatrixHeader([Str("Group 2")], [[Str("C")]]),
  ], [
    Node([cell("a1"), cell("b1")], [Node([cell("c1")], []), Node([cell("c2")], [])]),
    Node([cell("a2"), cell("b2")], [Node([cell("c3")], [])]),
  ]),
];

async function images(): Promise<M.Map<ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]>> {
  const draw = (w: number, h: number) => (cr: Cairo.Context): void => {
    Cairo.setSourceRGB(cr, 1, 1, 1);
    Cairo.rectangle(cr, 0, 0, w, h);
    Cairo.fill(cr);
    Cairo.setSourceRGB(cr, 0.2, 0.4, 0.8);
    Cairo.rectangle(cr, w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    Cairo.fill(cr);
  };
  const png = async (w: number, h: number): Promise<Uint8Array> => {
    const s = Cairo.imageSurfaceCreate(Cairo.FormatARGB32, w, h);
    Cairo.renderWith(s, draw(w, h));
    return Cairo.surfaceWriteToPNG(s);
  };
  const [, svg] = Cairo.withSVGSurface("diagram.svg", 320, 160, (s) => Cairo.renderWith(s, draw(320, 160)));
  return M.fromList<ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]>([
    [IconRef("flag"), [await png(16, 16), Nothing]],
    [DiagramRef(diagramId), [await png(320, 160), Just(new TextEncoder().encode(svg))]],
  ]);
}

export async function main(): Promise<void> {
  document.body.innerHTML = "";
  const status = document.createElement("pre");
  status.id = "status";
  status.style.cssText = "font: 12px monospace; margin: 8px;";
  document.body.appendChild(status);
  const imageMap = await images();
  const urls = new Map<string, string>();
  for (const [ref, [png, svg]] of M.toList(imageMap)) {
    const [bytes, type] = svg.tag === "Just" ? [svg.value, "image/svg+xml"] : [png, "image/png"];
    urls.set(JSON.stringify(ref), URL.createObjectURL(new Blob([bytes as BlobPart], { type })));
  }
  const head = H.mconcat_Html([H.style(H.preEscapedText(reportCss)), H.title("Report demo")]);
  const html = H.renderHtml(mkHtmlDocument((r) => urls.get(JSON.stringify(r)) ?? "missing", head, doc));
  const frame = document.createElement("iframe");
  frame.style.cssText = "width: 95%; height: 520px; border: 1px solid #888; margin: 8px;";
  frame.srcdoc = html;
  document.body.appendChild(frame);

  await makeDocx(Just(ReportPageLayout("A4", "Portrait")), "Report demo", "/memory/demo", doc, imageMap);
  const bytes = await readFileBytes("/memory/demo.docx");
  const zip = unzipSync(bytes);
  const parser = new DOMParser();
  const errors: string[] = [];
  for (const [name, data] of Object.entries(zip)) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const d = parser.parseFromString(strFromU8(data), "application/xml");
    if (d.getElementsByTagName("parsererror").length > 0) errors.push(name);
  }
  const lines = Object.entries(zip).map(([n, d]) => `${String(d.length).padStart(7)}  ${n}`);
  status.textContent = `Word document: ${bytes.length} bytes, ${lines.length} parts, ` +
    `${errors.length === 0 ? "all XML parts well-formed" : "BAD XML: " + errors.join(", ")}\n` + lines.join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  a.download = "demo.docx";
  a.textContent = "Download demo.docx";
  a.style.margin = "8px";
  document.body.insertBefore(a, status);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  (window as unknown as { r1Result: unknown }).r1Result = { parts: Object.keys(zip), errors, size: bytes.length, base64: btoa(bin) };
}
