import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from "fflate";
import * as M from "@/lib/Data/Map";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import * as Cairo from "@/lib/GI/Cairo";
import * as X from "@/lib/Text/XML/Light";
import { DiagramRef, IconRef, ReportPageLayout, type ImageRef } from "./Base";
import {
  Attr, Div, Emph, Heading, Highlight, Icon, Link, LinkOut, Matrix, MatrixHeader, Para, Picture, Plain,
  Space, Str, Strong, noAttr,
  type Block, type MatrixCell,
} from "./Document";
import {
  addImages, attrBookmark, blockToDocx, inlineToDocx, insertDocx, listItem, makeDocx, matrixToDocx,
  modifyDocumentAttrs, appendBodyElements, type ImageFiles,
} from "./Docx";
import {
  addExternal, addMedia, docStart, ecmaImage, getMediaRef, newId, pIndent, pgSz, relationshipXml, wText,
  type DocMonad,
} from "./Docx/Document";
import { inlinePicture, points } from "./Docx/Drawing";
import {
  getSkeletonStyles, isExtensionOf, namedBlankStyle, walkDirectory, getSkeletonDir, renderXml, updateXml,
} from "./Docx/File";
import * as XC from "@/lib/Text/XML/Light/Cursor";
import { checkDocxFile } from "@/hades/test/Test/Report/DocxCheck";

/** Files written and read through `@/lib/System/IO` (jsdom cannot read blobs back). */
const files = vi.hoisted(() => new Map<string, Uint8Array>());

vi.mock("@/lib/System/IO", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/System/IO")>();
  return {
    ...orig,
    writeFileData: async (p: string, data: Uint8Array | string | Blob): Promise<void> => {
      if (!(data instanceof Uint8Array)) throw new Error("test: expected bytes");
      files.set(p, data);
    },
    readFileBytes: async (p: string): Promise<Uint8Array> => {
      const b = files.get(p);
      if (b === undefined) throw new orig.IOError(p + ": no such file");
      return b;
    },
  };
});

const show = (es: readonly X.Element[]): string => es.map((e) => X.showElement(e)).join("");
const fresh = (): DocMonad => ({ state: docStart });
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const uuid = U.fromWords(0xd1a9, 1, 2, 3);
const uuid2 = U.fromWords(0xb00c, 4, 5, 6);

// ---------------------------------------------------------------------------------------------
// Test images: a PNG made by hand and an SVG drawn with the Cairo port.

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A solid colour RGB PNG. */
function makePng(w: number, h: number, rgb: readonly [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (1 + 3 * w) + 1 + 3 * x);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibSync(raw)), pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function makeSvg(): Uint8Array {
  const [, svg] = Cairo.withSVGSurface("diagram.svg", 200, 100, (s) => Cairo.renderWith(s, (cr) => {
    Cairo.setSourceRGB(cr, 0.2, 0.4, 0.8);
    Cairo.rectangle(cr, 10, 10, 180, 80);
    Cairo.fill(cr);
  }));
  return strToU8(svg);
}

const iconPng = makePng(16, 16, [200, 30, 30]);
const diagramPng = makePng(200, 100, [50, 100, 200]);
const diagramSvg = makeSvg();
const imageMap: ImageFiles = M.fromList<ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]>([
  [DiagramRef(uuid), [diagramPng, Just(diagramSvg)]],
  [IconRef("flag"), [iconPng, Nothing]],
]);

const cell = (txt: string): MatrixCell => [Attr(Nothing, Just("Text")), [Para([Str(txt)])]];

/** A document using every kind of block and inline. */
const richDoc: Block[] = [
  Heading(1, Attr(Just([uuid2, 1]), Nothing), [Str("Report Title")]),
  Para([Str("See "), LinkOut("http://example.com/?a=1&b=2", [Str("the site")]), Space, Icon("flag"),
    Space, Link(uuid2, [Str("back to the top")]), Space, Highlight(C.sRGB24(255, 0, 0), [Strong([Emph([Str("red")])])])]),
  Plain([Str("Größe: Groß “quoted” — ✓")]),
  Picture(Attr(Nothing, Just("DiagramBox")), [Str("The Diagram")], "The Diagram", [300, 150], uuid),
  Matrix(noAttr, [Str("Matrix caption")], [
    MatrixHeader([Str("Q1")], [[Str("A")], [Str("B")]]),
    MatrixHeader([Str("Q2")], [[Str("C")]]),
  ], [
    Node([cell("a1"), cell("b1")], [Node([cell("c1")], []), Node([cell("c2")], [])]),
    Node([cell("a2"), cell("b2")], [Node([[noAttr, []] as MatrixCell], [])]),
  ]),
  Div(Attr(Just([uuid, 2]), Just("MyStyle")), [Para([Str("In a div")])]),
];

// ---------------------------------------------------------------------------------------------

describe("Docx.Document combinators", () => {
  it("builds text, page sizes and indents", () => {
    expect(X.showElement(wText(" a"))).toBe("<w:t xml:space=\"preserve\"> a</w:t>");
    expect(X.showElement(wText("a"))).toBe("<w:t>a</w:t>");
    expect(X.showElement(pgSz(Just(841.89), Just(595.276), Just(true))))
      .toBe("<w:pgSz w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\" />");
    expect(X.showElement(pgSz(Nothing, Just(10), Nothing))).toBe("<w:pgSz w:h=\"200\" />");
    expect(pIndent(0, false)).toEqual([]);
    expect(show(pIndent(0, true))).toBe("<w:ind w:start=\"0\" w:hanging=\"720\" />");
    expect(show(pIndent(2, false))).toBe("<w:ind w:start=\"1440\" />");
  });

  it("keeps the document state", () => {
    const st = fresh();
    expect([newId(st), newId(st)]).toEqual(["0", "1"]);
    addMedia(st, IconRef("i"), ecmaImage, "PngTarget");
    addMedia(st, IconRef("i"), ecmaImage, "SvgTarget");
    const png = getMediaRef(st, IconRef("i"), "PngTarget");
    expect(png.tag === "Just" && png.value.relTarget).toBe("media/image-dsmId2.png");
    const svg = getMediaRef(st, IconRef("i"), "SvgTarget");
    expect(svg.tag === "Just" && svg.value.relId).toBe("dsmId3");
    expect(getMediaRef(st, DiagramRef(uuid), "PngTarget")).toEqual(Nothing);
    const ext = addExternal(st, "http://x");
    expect(X.showElement(relationshipXml(ext))).toBe(
      "<Relationship TargetMode=\"External\" Id=\"dsmId4\" " +
      "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink\" Target=\"http://x\" />",
    );
  });
});

describe("Drawing", () => {
  it("converts points to EMUs", () => {
    expect(points(12)).toBe(152400);
    expect(points(0.5)).toBe(6350);
  });

  it("embeds a PNG with an SVG extension", () => {
    const st = fresh();
    addImages(st, imageMap);
    const xml = X.showElement(inlinePicture(st, [300, 150], DiagramRef(uuid), "D"));
    expect(xml).toContain("<wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"3810000\" cy=\"1905000\" />");
    expect(xml).toContain("<wp:docPr id=\"3\" name=\"D\" />");
    expect(xml).toContain(
      "<a:blip r:embed=\"dsmId1\"><a:extLst><a:ext uri=\"{96DAC541-7B7A-43D3-8B79-37D633B846F1}\">" +
      "<asvg:svgBlip xmlns:asvg=\"http://schemas.microsoft.com/office/drawing/2016/SVG/main\" r:embed=\"dsmId2\" />" +
      "</a:ext></a:extLst></a:blip>",
    );
    const icon = X.showElement(inlinePicture(st, [12, 12], IconRef("flag"), "Icon"));
    expect(icon).toContain("<a:blip r:embed=\"dsmId0\" />");
    expect(X.showElement(inlinePicture(st, [12, 12], IconRef("none"), "Icon"))).toContain("<w:t>Missing image</w:t>");
  });
});

describe("blocks and inlines", () => {
  it("formats runs", () => {
    const st = fresh();
    expect(show(inlineToDocx(st, [], Highlight(C.sRGB24(255, 0, 0), [Strong([Emph([Str("x")])])])))).toBe(
      "<w:r><w:rPr><w:i /><w:b /><w:shd w:fill=\"FF0000\" w:val=\"clear\" /></w:rPr><w:t>x</w:t></w:r>",
    );
    expect(show(inlineToDocx(st, [], Link(uuid, [Str("l")]))))
      .toBe(`<w:hyperlink w:anchor="${U.toText(uuid)}"><w:r><w:t>l</w:t></w:r></w:hyperlink>`);
    expect(show(inlineToDocx(st, [], LinkOut("http://y", [])))).toBe(
      "<w:hyperlink r:id=\"dsmId0\"><w:rPr><w:rStyle w:val=\"Hyperlink\" /></w:rPr><w:r><w:t></w:t></w:r></w:hyperlink>",
    );
  });

  it("numbers and bullets list items", () => {
    const st = fresh();
    expect(show(listItem(st, "NumList", 1, Nothing, true, []))).toBe(
      "<w:p><w:pPr><w:ind w:start=\"720\" w:hanging=\"720\" /></w:pPr>" +
      "<w:r><w:fldSimple w:instr=\"LISTNUM NumberValue \\l 1 \\s 1\" w:dirty=\"true\" /></w:r></w:p>",
    );
    expect(show(listItem(st, "NumList", 1, Nothing, false, []))).toContain("w:instr=\"LISTNUM NumberValue \\l 1\"");
    expect(show(listItem(st, "BulletList", 2, Nothing, false, [Para([Str("x")])]))).toBe(
      "<w:p><w:pPr><w:ind w:start=\"1440\" w:hanging=\"720\" /></w:pPr>" +
      "<w:r><w:t>&#9702;</w:t><w:tab /></w:r><w:r><w:t>x</w:t></w:r></w:p>",
    );
    expect(show(listItem(st, "BulletList", 6, Nothing, false, [Plain([Str("x")])])))
      .toContain("<w:pStyle w:val=\"Compact\" /><w:ind w:start=\"4320\" w:hanging=\"720\" /></w:pPr><w:r><w:t>&#8226;</w:t>");
  });

  it("bookmarks identified blocks", () => {
    const st = fresh();
    expect(show(blockToDocx(st, 0, Nothing, Heading(2, Attr(Just([uuid, 2]), Nothing), [Str("H")])))).toBe(
      "<w:p><w:pPr><w:pStyle w:val=\"Heading2\" /></w:pPr>" +
      `<w:bookmarkStart w:id="0" w:name="${U.toText(uuid)}" /><w:r><w:t>H</w:t></w:r><w:bookmarkEnd w:id="0" /></w:p>`,
    );
    expect(attrBookmark(st, noAttr, [])).toEqual([]);
    expect(show(blockToDocx(st, 1, Just("S"), Para([Str("p")]))))
      .toBe("<w:p><w:pPr><w:pStyle w:val=\"S\" /><w:ind w:start=\"720\" /></w:pPr><w:r><w:t>p</w:t></w:r></w:p>");
  });

  it("tabulates matrices with merged cells", () => {
    const st = fresh();
    const m = richDoc[4];
    if (m.tag !== "Matrix") throw new Error("not a matrix");
    const [tbl, caption] = matrixToDocx(st, m._0, m._1, m._2, m._3);
    const rows = X.findChildren(X.QName("tr", Nothing, Just("w")), tbl);
    expect(rows.length).toBe(5);
    const cellsOf = (r: X.Element): string[] => X.findChildren(X.QName("tc", Nothing, Just("w")), r).map((c) => {
      const props = X.showElement(X.elChildren(c)[0]);
      const txt = X.findElements(X.QName("t", Nothing, Just("w")), c).map(X.strContent).join("");
      return txt + (props.includes("restart") ? "^" : props.includes("<w:vMerge />") ? "|" : "") +
        (props.includes("gridSpan") ? "*" : "");
    });
    expect(rows.map(cellsOf)).toEqual([
      ["A^", "B^", "Q2*"],
      ["|", "|", "C"],
      ["a1^", "b1^", "c1"],
      ["|", "|", "c2"],
      ["a2", "b2", ""],
    ]);
    expect(X.showElement(caption)).toContain("<w:fldSimple w:instr=\" SEQ Table \\* ARABIC \" w:dirty=\"true\" />");
    expect(X.showElement(tbl)).toContain("<w:tblStyle w:val=\"Matrix\" />");
  });
});

describe("Docx.File", () => {
  it("walks the bundled skeleton", () => {
    const dir = getSkeletonDir();
    expect(dir).toBe("/src/hades/share/docx");
    expect(walkDirectory(dir).map((p) => p.slice(dir.length + 1))).toEqual([
      "[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml",
      "word/_rels/document.xml.rels", "word/document.xml", "word/fontTable.xml", "word/numbering.xml",
      "word/settings.xml", "word/styles.xml", "word/theme/theme1.xml", "word/webSettings.xml",
    ]);
    expect(walkDirectory(dir + "/word/styles.xml")).toEqual([dir + "/word/styles.xml"]);
    expect(walkDirectory(dir + "/nothing")).toEqual([]);
  });

  it("reads skeleton styles, with blank styles for missing ones", () => {
    const [caption, other] = getSkeletonStyles(["Caption", "Other"]);
    expect(X.showElement(caption)).toContain("w:styleId=\"Caption\"");
    expect(X.showElement(other)).toBe(X.showElement(namedBlankStyle("Other")));
    expect(X.showElement(other)).toBe(
      "<w:style w:type=\"paragraph\" w:customStyle=\"1\" w:styleId=\"Other\"><w:name w:val=\"Other\" />" +
      "<w:basedOn w:val=\"Normal\" /><w:qFormat /><w:pPr /></w:style>",
    );
  });

  it("renders XML content", () => {
    expect(strFromU8(renderXml(X.parseXML("<?xml version=\"1.0\"?><a b='1'/>")))).toBe("<?xml version=\"1.0\" ?><a b=\"1\" />");
  });

  it("checks extensions as System.FilePath.isExtensionOf does", () => {
    expect(isExtensionOf("docx", "/download/report.docx")).toBe(true);
    expect(isExtensionOf(".docx", "/download/report.docx")).toBe(true);
    expect(isExtensionOf("docx", "/download/report.old.docx")).toBe(true);
    expect(isExtensionOf("old.docx", "/download/report.old.docx")).toBe(true);
    expect(isExtensionOf("docx", "/download/.docx")).toBe(true);
    // Case-sensitive, and only the file name counts.
    expect(isExtensionOf("docx", "/download/report.DOCX")).toBe(false);
    expect(isExtensionOf("docx", "/download/report")).toBe(false);
    expect(isExtensionOf("docx", "/handle/a.docx/report")).toBe(false);
    expect(isExtensionOf("docx", "/download/reportdocx")).toBe(false);
  });

  it("parses edited parts as Latin-1, as Haskell does", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("<?xml version=\"1.0\"?>\r\n<a>Café</a>")]);
    expect(strFromU8(updateXml((c) => c, bytes)))
      .toBe("&#239;&#187;&#191;<?xml version=\"1.0\" ?>\n<a>Caf&#195;&#169;</a>");
    // A part without XML content is left alone.
    expect(updateXml((c) => c, new Uint8Array(0))).toEqual(new Uint8Array(0));
  });
});

// ---------------------------------------------------------------------------------------------
// Whole documents, checked with Python.

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hades-docx-"));

function saveAndCheck(name: string, bytes: Uint8Array): ReturnType<typeof checkDocxFile> {
  const p = path.join(tempDir, name);
  fs.writeFileSync(p, bytes);
  return checkDocxFile(p);
}

describe("makeDocx", () => {
  it("writes a complete Word document with images, links and tables", async () => {
    await makeDocx(Just(ReportPageLayout("Letter", "Portrait")), "Rich & Test", "/download/rich", richDoc, imageMap);
    const bytes = files.get("/download/rich.docx");
    expect(bytes).toBeDefined();
    const r = saveAndCheck("rich.docx", bytes!);
    // As in Haskell, makeDocx does not add styles for custom classes (insertDocx does).
    expect(r.problems).toEqual(["undefined style MyStyle"]);
    expect(r.names).toContain("word/media/image-dsmId0.png");
    expect(r.names).toContain("word/media/image-dsmId2.svg");
    expect(r.used_rels).toEqual(["dsmId0", "dsmId1", "dsmId2", "dsmId4"]);
    expect(r.text).toContain("Größe: Groß “quoted” — ✓");
    expect(r.core).toContain("<dc:title>Rich &amp; Test</dc:title>");
    if (r.python_docx !== null) expect(r.python_docx.tables).toBe(1);
    const zip = unzipSync(bytes!);
    expect(zip["word/media/image-dsmId0.png"]).toEqual(iconPng);
    expect(strFromU8(zip["word/media/image-dsmId2.svg"])).toContain("<svg");
    const doc = strFromU8(zip["word/document.xml"]);
    expect(doc).toContain("<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\" w:orient=\"portrait\" /></w:sectPr></w:body>");
    const rels = strFromU8(zip["word/_rels/document.xml.rels"]);
    // New relationships come first: external ones, then the images in ImageRef order.
    expect([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]).slice(0, 4)).toEqual(["dsmId4", "dsmId0", "dsmId2", "dsmId1"]);
  });

  it("appends the .docx suffix unless the target has it (case-sensitive)", async () => {
    await makeDocx(Nothing, "T", "/download/plain.docx", [Para([Str("x")])], M.empty());
    await makeDocx(Nothing, "T", "/download/Upper.DOCX", [Para([Str("x")])], M.empty());
    expect(files.has("/download/plain.docx")).toBe(true);
    expect(files.has("/download/plain.docx.docx")).toBe(false);
    expect(files.has("/download/Upper.DOCX.docx")).toBe(true);
    expect(files.has("/download/Upper.DOCX")).toBe(false);
  });
});

describe("insertDocx", () => {
  /** A template: the skeleton with its own body, fewer namespaces, no PNG/SVG types and no Caption style. */
  function makeTemplate(): Uint8Array {
    const dir = path.resolve(__dirname, "../../../share/docx");
    const out: Record<string, Uint8Array> = {};
    for (const p of walkDirectory(getSkeletonDir())) {
      const rel = p.slice(getSkeletonDir().length + 1);
      out[rel] = new Uint8Array(fs.readFileSync(path.join(dir, rel)));
    }
    const ct = strFromU8(out["[Content_Types].xml"])
      .replace("<Default Extension=\"png\" ContentType=\"image/png\"/>", "")
      .replace("<Default Extension=\"svg\" ContentType=\"image/svg+xml\"/>", "");
    out["[Content_Types].xml"] = strToU8(ct);
    out["word/document.xml"] = strToU8(
      "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n" +
      `<w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
      "xmlns:x14=\"urn:extra\" mc:Ignorable=\"x14 w14\"><w:body><w:p><w:r><w:t>Template text</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Café</w:t></w:r></w:p>" +
      "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/></w:sectPr></w:body></w:document>",
    );
    const styles = strFromU8(out["word/styles.xml"]);
    const start = styles.indexOf("<w:style w:type=\"paragraph\" w:styleId=\"Caption\"");
    expect(start).toBeGreaterThan(0);
    const end = styles.indexOf("</w:style>", start) + "</w:style>".length;
    out["word/styles.xml"] = strToU8(styles.slice(0, start) + styles.slice(end));
    // Copy into fflate's realm (TextEncoder output comes from another realm under jsdom).
    const u8 = zipSync({}).constructor as Uint8ArrayConstructor;
    return zipSync(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, new u8(v)])));
  }

  it("inserts the content into a template", async () => {
    files.set("/upload/1/template.docx", makeTemplate());
    await insertDocx("/upload/1/template.docx", "/download/inserted.docx", richDoc, imageMap);
    const bytes = files.get("/download/inserted.docx");
    expect(bytes).toBeDefined();
    const r = saveAndCheck("inserted.docx", bytes!);
    expect(r.problems).toEqual([]);
    const zip = unzipSync(bytes!);
    const ct = strFromU8(zip["[Content_Types].xml"]);
    expect(ct).toContain("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"png\" ContentType=\"image/png\" /><Default Extension=\"svg\" ContentType=\"image/svg+xml\" />");
    const doc = strFromU8(zip["word/document.xml"]);
    // Namespaces merged and sorted, ignorable prefixes merged.
    expect(doc).toContain(`xmlns:w="${W}" xmlns:w10=`);
    expect(doc).toContain("xmlns:x14=\"urn:extra\" mc:Ignorable=\"w14 w15 w16cid w16se wp14 x14\"><w:body>");
    // The template text comes first and the section properties stay last.
    expect(doc.indexOf("Template text")).toBeLessThan(doc.indexOf("Report Title"));
    expect(doc.endsWith("<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\" /></w:sectPr></w:body></w:document>")).toBe(true);
    // Faithful quirk: template parts are read as Latin-1 bytes, so non-ASCII template text is
    // written back one character reference per UTF-8 byte (as in the Haskell program), while the
    // inserted report text is correct.
    expect(doc).toContain("Caf&#195;&#169;");
    expect(doc).toContain("Gr&#246;&#223;e");
    const styles = strFromU8(zip["word/styles.xml"]);
    expect(styles).toContain("w:styleId=\"Caption\"");
    expect(styles).toContain("<w:style w:type=\"paragraph\" w:customStyle=\"1\" w:styleId=\"MyStyle\">");
    expect(styles.match(/w:styleId="Matrix"/g)?.length).toBe(1);
    const core = strFromU8(zip["docProps/core.xml"]);
    expect(core).toContain("<cp:lastModifiedBy>user</cp:lastModifiedBy>");
    expect(core).toContain("<dc:title />");
    expect(core).not.toContain("2019-03-25T18:46:00Z");
    expect(core).toContain("2019-03-25T18:45:00Z");
  });

  it("leaves documents without a body alone", () => {
    const c = XC.fromForest(X.parseXML("<w:document><w:other/></w:document>"));
    if (c.tag === "Nothing") throw new Error("no cursor");
    expect(modifyDocumentAttrs(c.value).tag).toBe("Just");
    expect(appendBodyElements([], c.value)).toEqual(Nothing);
  });
});
