// Ported from hades/test/Test/Report/TestDocument.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Document tests: write a Word document and an HTML file made from a document that exercises
 * the "Block" and "Inline" combinators for nested lists.
 *
 * The Haskell `runDocumentTest :: IO Bool` (run from the test suite's `main`) only writes the two
 * files into the temporary directory for inspection. Here it is a vitest test that writes the same
 * files into the temporary directory (`os.tmpdir()`), and then checks them: the Word document must
 * be a well-formed OOXML package (checked with Python's `zipfile` and XML parser, and with
 * `python-docx` when it is installed), and the HTML must contain the document.
 *
 * Web: `makeDocx` writes through the virtual file system of `@/lib/System/IO`, which cannot read
 * back blobs under jsdom. The test replaces `writeFileData` with a version that keeps the bytes
 * (`writtenFiles`), and copies them to the temporary directory.
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import { Nothing } from "@/lib/Data/Maybe";
import * as H from "@/lib/Text/Blaze/Html5";
import {
  DefinitionList, Emph, Heading, OrderedList, Para, Plain, Str, UnorderedList, noAttr,
  type Block,
} from "@/hades/src/Model/Report/Document";
import { makeDocx } from "@/hades/src/Model/Report/Docx";
import { mkHtmlDocument } from "@/hades/src/Model/Report/Html";
import type { ImageRef } from "@/hades/src/Model/Report/Base";
import { checkDocxFile } from "./DocxCheck";

/** Files written through `@/lib/System/IO` during the tests. */
const writtenFiles = vi.hoisted(() => new Map<string, Uint8Array>());

vi.mock("@/lib/System/IO", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/System/IO")>();
  return {
    ...orig,
    writeFileData: async (p: string, data: Uint8Array | string | Blob): Promise<void> => {
      if (!(data instanceof Uint8Array)) throw new Error("test: expected bytes");
      writtenFiles.set(p, data);
    },
  };
});


export async function runDocumentTest(): Promise<boolean> {
  const temp = os.tmpdir();
  console.log("Writing test documents in " + temp);
  const docPath = path.join(temp, "testWordDoc.docx");
  await makeDocx(Nothing, "Test Document", docPath, testDoc, M.empty());
  // Web: copy the bytes captured from writeFileData to the real file.
  fs.writeFileSync(docPath, writtenFiles.get(docPath)!);
  // mkHtmlDocument mempty mempty testDoc: the image path function is "mempty" (always "").
  const html = mkHtmlDocument((_: ImageRef) => "", H.mempty_Html, testDoc);
  fs.writeFileSync(path.join(temp, "testHtml.html"), H.renderHtml(html), "utf8");
  return true;
}



/** A document that exercises the "Block" and "Inline" combinators for nested lists. */
export const testDoc: Block[] = [
  Heading(1, noAttr, [Str("First Heading with "), Emph([Str("Italic Text")])]),
  Plain([Str("Plain text block. Lorem ipsum dolor sit amet, consectetur adipiscing elit, " +
    "sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
    "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo " +
    "consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum " +
    "dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, " +
    "sunt in culpa qui officia deserunt mollit anim id est laborum.")]),
  Para([Str("Paragraph block. Lorem ipsum dolor sit amet, consectetur adipiscing elit, " +
    "sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim " +
    "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo " +
    "consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum " +
    "dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, " +
    "sunt in culpa qui officia deserunt mollit anim id est laborum.")]),
  OrderedList("ListRomanLower", [
    [Para([Str("First item in an ordered list which is indexed with lower case roman " +
      "numerals. Note that the number type is ignored by Word.")]),
    Para([Str("Second paragraph of the first item in the ordered list. Ut enim ad minim " +
      "veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo " +
      "consequat.")])],
    [Para([Str("Second item in the ordered list. This one has a sub-list of bullets:")]),
    UnorderedList([
      [Para([Str("Duis aute irure dolor in reprehenderit in voluptate velit esse " +
        "cillum.")]),
      Para([Str("Faucibus nisl tincidunt eget nullam non nisi est. Nunc sed blandit " +
        "libero volutpat sed cras ornare.")]),
      ], [Para([Str("Rhoncus est pellentesque elit ullamcorper dignissim cras tincidunt " +
        "lobortis.")])],
    ])],
    [Para([Str("Third item in the ordered list. This one has an ordered sub-list:")]),
    OrderedList("ListDecimal", [
      [Para([Str("Duis aute irure dolor in reprehenderit in voluptate velit esse " +
        "cillum.")]),
      Para([Str("Faucibus nisl tincidunt eget nullam non nisi est. Nunc sed blandit " +
        "libero volutpat sed cras ornare.")]),

      ], [Para([Str("Rhoncus est pellentesque elit ullamcorper dignissim cras tincidunt " +
        "lobortis.")])],
    ])],
  ]),
  Heading(1, noAttr, [Str("Definition List Section")]),
  DefinitionList([
    [
      [Str("Def 1")],
      [Para([Str("Neque gravida in fermentum et sollicitudin ac orci phasellus egestas. " +
        "Volutpat maecenas volutpat blandit aliquam etiam. Mattis vulputate enim " +
        "nulla aliquet porttitor lacus luctus. ")])],
    ], [
      [Str("Def 2")],
      [Para([Str("Sed adipiscing diam donec adipiscing tristique risus. Neque volutpat ac " +
        "tincidunt vitae. Velit ut tortor pretium viverra suspendisse potenti nullam " +
        "ac tortor.")])],
    ],
  ]),
];


// ---------------------------------------------------------------------------------------------
// Checks of the written files (not in the Haskell test).

describe("Test.Report.TestDocument", () => {
  it("runDocumentTest writes the Word and HTML documents", async () => {
    expect(await runDocumentTest()).toBe(true);
    const temp = os.tmpdir();
    expect(fs.existsSync(path.join(temp, "testWordDoc.docx"))).toBe(true);
    expect(fs.existsSync(path.join(temp, "testHtml.html"))).toBe(true);
  });

  it("writes a well-formed Word package", () => {
    const r = checkDocxFile(path.join(os.tmpdir(), "testWordDoc.docx"));
    expect(r.problems).toEqual([]);
    expect(r.names).toEqual([
      "[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml",
      "word/_rels/document.xml.rels", "word/document.xml", "word/fontTable.xml", "word/numbering.xml",
      "word/settings.xml", "word/styles.xml", "word/theme/theme1.xml", "word/webSettings.xml",
    ]);
    expect(r.text).toContain("First Heading with Italic Text");
    expect(r.text).toContain("Third item in the ordered list.");
    expect(r.text).toContain("Def 2");
    expect(r.core).toContain("<dc:title>Test Document</dc:title>");
    if (r.python_docx !== null) expect(r.python_docx.paragraphs).toBeGreaterThan(10);
  });

  it("writes the HTML document", () => {
    const html = fs.readFileSync(path.join(os.tmpdir(), "testHtml.html"), "utf8");
    expect(html.startsWith("<!DOCTYPE HTML>\n<html><head><meta charset=\"UTF-8\"></head><body>")).toBe(true);
    expect(html).toContain("<h1>First Heading with <em>Italic Text</em></h1>");
    expect(html).toContain("<ol type=\"i\"><li><p>First item");
    expect(html).toContain("<ol type=\"1\"><li><p>Duis aute");
    expect(html).toContain("<dl><dt>Def 1</dt><dd><p>Neque gravida");
    expect(html.endsWith("</dl></body></html>")).toBe(true);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("li").length).toBe(7);
  });
});
