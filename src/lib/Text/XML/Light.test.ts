/**
 * Tests of the `xml` package port (`Text.XML.Light` with its `Input`, `Output`, `Proc`, `Lexer`
 * and `Lens` modules), against the behaviour of xml-1.3.14.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { over, preview, view } from "@/lib/Control/Lens";
import * as X from "./Light";
import * as XC from "./Light/Cursor";
import * as XL from "./Light/Lens";
import { tokens } from "./Light/Lexer";

const show = (cs: readonly X.Content[]): string => cs.map(X.showContent).join("");

describe("Text.XML.Light.Output", () => {
  it("escapes text and attributes, and writes non-ASCII as character references", () => {
    const e = X.unode("a", [[X.Attr(X.unqual("x"), "1 < 2 & \"q\" 'é'")], "t<&>\"'é€\t\n"]);
    expect(X.showElement(e)).toBe(
      "<a x=\"1 &lt; 2 &amp; &quot;q&quot; &#39;&#233;&#39;\">t&lt;&amp;&gt;&quot;&#39;&#233;&#8364;&#9;\n</a>",
    );
  });

  it("writes empty elements in the short form, and ?-elements with ?>", () => {
    expect(X.showElement(X.unode("e", null))).toBe("<e />");
    expect(X.showElement(X.unode("?xml", [X.Attr(X.unqual("version"), "1.0")]))).toBe("<?xml version=\"1.0\" ?>");
    expect(X.showTopElement(X.unode("r", X.unode("s", "x")))).toBe("<?xml version='1.0' ?><r><s>x</s></r>");
  });

  it("writes verbatim and raw character data", () => {
    const cd = (k: X.CDataKind, s: string): X.Content => X.Text(X.CData(k, s, Nothing));
    expect(X.showContent(cd("CDataVerbatim", "a]]>b<"))).toBe("<![CDATA[a]]]]><![CDATA[>b<]]>");
    expect(X.showContent(cd("CDataRaw", "<!-- x -->"))).toBe("<!-- x -->");
    expect(X.showContent(X.CRef("nbsp"))).toBe("&nbsp;");
  });

  it("pretty prints", () => {
    const e = X.unode("a", [X.unode("b", "x\ny"), X.unode("c", null)]);
    expect(X.ppElement(e)).toBe("<a>\n  <b>x\ny</b>\n  <c />\n</a>");
    expect(X.ppTopElement(X.unode("a", null))).toBe("<?xml version='1.0' ?>\n<a />\n");
  });
});

describe("Text.XML.Light.Input", () => {
  it("parses elements, attributes, references and namespaces", () => {
    const cs = X.parseXML("<?xml version=\"1.0\"?><w:doc xmlns:w=\"urn:w\" a='1' b=c><w:p>x &amp; y&#65;&#x42;&foo;</w:p><q/></w:doc>");
    expect(cs.length).toBe(2);
    const e = X.onlyElems(cs)[1];
    expect(e.elName).toEqual(X.QName("doc", Just("urn:w"), Just("w")));
    expect(e.elAttribs.map((a) => [X.showQName(a.attrKey), a.attrVal])).toEqual([["xmlns:w", "urn:w"], ["a", "1"], ["b", "c"]]);
    const p = X.elChildren(e)[0];
    // Text tokens merge; an unknown entity is a CRef.
    expect(p.elContent.map((c) => c.tag)).toEqual(["Text", "CRef"]);
    expect(X.strContent(p)).toBe("x & yAB");
    expect(show(cs)).toBe("<?xml version=\"1.0\" ?><w:doc xmlns:w=\"urn:w\" a=\"1\" b=\"c\"><w:p>x &amp; yAB&foo;</w:p><q /></w:doc>");
    expect(e.elLine).toEqual(Just(1));
  });

  it("repairs malformed documents as the Haskell parser does", () => {
    // Unknown closing tags become text; unclosed elements are closed at their parent's end.
    expect(show(X.parseXML("<a>x</b>y<c>z</a>w"))).toBe("<a>x&lt;/b&gt;y<c>z</c></a>w");
    expect(show(X.parseXML("<a><b>"))).toBe("<a><b /></a>");
    // Comments are dropped, CDATA is verbatim, other markup is raw.
    expect(show(X.parseXML("<a><!-- c --><![CDATA[<x>]]><!DOCTYPE <q>></a>"))).toBe(
      "<a><![CDATA[<x>]]><!DOCTYPE <q>></a>",
    );
  });

  it("reads bytes as Latin-1, as the ByteString instances do", () => {
    const utf8 = new TextEncoder().encode("<a>é</a>");
    expect(show(X.parseXML(utf8))).toBe("<a>&#195;&#169;</a>");
    expect(show(X.parseXML("<a>é</a>"))).toBe("<a>&#233;</a>");
  });

  it("numbers lines and reads \\r\\n as \\n", () => {
    const ts = tokens("<a>\r\n<b/>\r<c/></a>");
    expect(ts.filter((t) => t.tag === "TokStart").map((t) => (t.tag === "TokStart" ? t._0 : 0))).toEqual([1, 2, 3]);
  });

  it("parseXMLDoc skips the XML declaration", () => {
    expect(X.parseXMLDoc("<?xml version='1.0'?><r/>")).toEqual(Just(X.Element(X.unqual("r"), [], [], Just(1))));
    expect(X.parseXMLDoc("text only")).toEqual(Nothing);
  });

  it("round trips the Word skeleton files", () => {
    const dir = path.resolve(__dirname, "../../../hades/share/docx");
    for (const f of ["[Content_Types].xml", "word/_rels/document.xml.rels", "docProps/core.xml", "word/document.xml"]) {
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      const out = show(X.parseXML(txt));
      // Same document up to the (short) form of empty elements, the declaration's "?>" and the
      // line ends (the lexer reads "\r\n" as "\n").
      const norm = (s: string): string => s
        .replace(/<([^\s>/]+)([^>]*)><\/\1>/g, "<$1$2/>")
        .replace(/\s*\/>/g, "/>").replace(/\s*\?>/g, "?>").replace(/></g, ">\n<");
      expect(norm(out)).toBe(norm(txt.replace(/\r\n?/g, "\n")));
    }
  });
});

describe("Text.XML.Light.Proc", () => {
  const e = X.unode("r", [
    X.unode("a", [[X.Attr(X.unqual("k"), "1")], "one"]),
    X.unode("b", X.unode("a", "nested")),
    X.unode("a", "two"),
  ]);
  it("finds children and elements", () => {
    expect(X.findChildren(X.unqual("a"), e).map(X.strContent)).toEqual(["one", "two"]);
    expect(X.findChild(X.unqual("b"), e).tag).toBe("Just");
    expect(X.findElements(X.unqual("a"), e).map(X.strContent)).toEqual(["one", "nested", "two"]);
    expect(X.findElement(X.unqual("r"), e)).toEqual(Just(e));
    expect(X.findAttr(X.unqual("k"), X.elChildren(e)[0])).toEqual(Just("1"));
    expect(X.findAttr(X.unqual("z"), X.elChildren(e)[0])).toEqual(Nothing);
  });
});

describe("Text.XML.Light.Lens", () => {
  it("edits through a cursor", () => {
    const c = XC.fromElement(X.unode("r", X.unode("a", null)));
    expect(preview(XL.currentL.dot(XL._Elem).dot(XL.elNameL).dot(XL.qNameL), c)).toEqual(Just("r"));
    const c2 = over(XL.currentL.dot(XL._Elem).dot(XL.elContentL), (cs: readonly X.Content[]) => [X.Elem(X.unode("z", null)), ...cs], c);
    expect(X.showContent(XC.toTree(c2))).toBe("<r><z /><a /></r>");
    expect(view(XL.qPrefixL, X.QName("n", Nothing, Just("p")))).toEqual(Just("p"));
  });
});
