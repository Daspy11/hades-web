import { describe, expect, it } from "vitest";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import * as H from "@/lib/Text/Blaze/Html5";
import { IconRef, show_ImageRef, type ImageRef } from "./Base";
import {
  Attr, DefinitionList, Div, Emph, Heading, Highlight, Icon, Link, LinkOut, Matrix, MatrixHeader,
  Null, OrderedList, Para, Picture, Plain, Space, Span, Str, Strong, UnorderedList, noAttr,
  type Block, type Inline, type MatrixCell,
} from "./Document";
import { attrToHtml, blockToHtml, inlinesToHtml, matrixToHtml, mkHtmlDocument } from "./Html";

const uuid = U.fromWords(1, 2, 3, 4);
const uuidText = U.toText(uuid);
const pathFunc = (r: ImageRef): string =>
  r.tag === "IconRef" ? "icons/" + r._0 + ".png" : U.toText(r._0) + ".svg";
const block = (b: Block): string => H.renderHtml(blockToHtml(pathFunc, b));
const inlines = (is: readonly Inline[]): string => H.renderHtml(inlinesToHtml(pathFunc, is));
const cell = (txt: string): MatrixCell => [Attr(Nothing, Just("Text")), [Para([Str(txt)])]];

describe("inlines", () => {
  it("renders text, emphasis, links and icons", () => {
    expect(inlines([Str("a<b"), Space, Emph([Str("e")]), Strong([Str("s")])])).toBe("a&lt;b <em>e</em><strong>s</strong>");
    expect(inlines([Link(uuid, [Str("x")])])).toBe(`<a href="#${uuidText}">x</a>`);
    expect(inlines([LinkOut("http://x.org/?a=1&b=2", [Str("y")])])).toBe("<a href=\"http://x.org/?a=1&amp;b=2\">y</a>");
    expect(inlines([Icon("flag")])).toBe("<img src=\"icons/flag.png\" alt=\"icon\" height=\"16\" width=\"16\">");
    expect(inlines([Span(Attr(Just([uuid, 1]), Just("c")), [Str("z")])])).toBe(`<span id="${uuidText}" class="c">z</span>`);
    expect(inlines([Span(noAttr, [Str("z")])])).toBe("<span>z</span>");
  });

  it("highlights with a contrasting foreground", () => {
    expect(inlines([Highlight(C.sRGB24(255, 0, 0), [Str("red")])]))
      .toBe("<span style=\"background-color:#ff0000;color:white\">red</span>");
    expect(inlines([Highlight(C.sRGB24(255, 255, 0), [Str("yellow")])]))
      .toBe("<span style=\"background-color:#ffff00;color:black\">yellow</span>");
  });

  it("formats identifiers and classes", () => {
    expect(attrToHtml(noAttr)).toEqual([]);
    expect(attrToHtml(Attr(Just([uuid, 2]), Just("k"))).map((a) => a.name)).toEqual(["id", "class"]);
  });
});

describe("blocks", () => {
  it("renders paragraphs, headings and lists", () => {
    expect(block(Plain([Str("p")]))).toBe("p");
    expect(block(Para([]))).toBe("");
    expect(block(Para([Str("p")]))).toBe("<p>p</p>");
    expect(block(Heading(2, noAttr, [Str("h")]))).toBe("<h2>h</h2>");
    expect(block(Heading(6, Attr(Just([uuid, 6]), Nothing), [Str("h")]))).toBe(`<h6 id="${uuidText}">h</h6>`);
    expect(block(Heading(7, Attr(Just([uuid, 7]), Just("deep")), [Str("h")])))
      .toBe(`<p id="${uuidText}" class="deep"><b>h</b></p>`);
    expect(block(OrderedList("ListAlphaUpper", [[Para([Str("a")])], [Plain([Str("b")])]])))
      .toBe("<ol type=\"A\"><li><p>a</p></li><li>b</li></ol>");
    expect(block(UnorderedList([[Para([Str("a")]), Para([Str("b")])]]))).toBe("<ul><li><p>a</p><p>b</p></li></ul>");
    expect(block(DefinitionList([[[Str("t")], [Para([Str("d")])]]]))).toBe("<dl><dt>t</dt><dd><p>d</p></dd></dl>");
    expect(block(Div(Attr(Nothing, Just("box")), [Para([Str("x")])]))).toBe("<div class=\"box\"><p>x</p></div>");
    expect(block(Null)).toBe("");
  });

  it("renders pictures with captions", () => {
    expect(block(Picture(Attr(Nothing, Just("DiagramBox")), [Str("Cap")], "Alt \"text\"", [100, 50], uuid))).toBe(
      `<figure class="DiagramBox"><img src="${uuidText}.svg" alt="Alt &quot;text&quot;">` +
      "<figcaption><span class=\"diagramCaption\">Cap</span></figcaption></figure>",
    );
  });
});

describe("matrixToHtml", () => {
  it("renders a single header group", () => {
    const html = H.renderHtml(matrixToHtml(
      pathFunc, noAttr, [], [MatrixHeader([Str("Q")], [[Str("A")], [Str("B")]])], [Node([cell("a"), cell("b")], [])],
    ));
    expect(html).toBe(
      "<table><tr><th>A</th><th>B</th></tr>" +
      "<tr><td class=\"Text\"><p>a</p></td><td class=\"Text\"><p>b</p></td></tr></table>",
    );
  });

  it("spans rows over the next level and lays out several header groups", () => {
    const headers = [
      MatrixHeader([Str("Q1")], [[Str("A")], [Str("B")]]),
      MatrixHeader([Str("Q2")], [[Str("C")]]),
    ];
    const cells = [
      Node([cell("a1"), cell("b1")], [Node([cell("c1")], []), Node([cell("c2")], [])]),
      Node([cell("a2"), cell("b2")], []),
    ];
    const html = H.renderHtml(blockToHtml(pathFunc, Matrix(Attr(Just([uuid, 1]), Just("matrix")), [Str("Cap")], headers, cells)));
    expect(html).toBe(
      `<table id="${uuidText}" class="matrix"><caption>Cap</caption>` +
      // (snd grp1, th colspan n) <> mconcat grps
      "<tr><th>A</th><th>B</th><th colspan=\"1\">Q2</th></tr>" +
      "<tr><th colspan=\"2\"></th><th>C</th></tr>" +
      "<tr><td rowspan=\"2\" class=\"Text\"><p>a1</p></td><td rowspan=\"2\" class=\"Text\"><p>b1</p></td>" +
      "<td class=\"Text\"><p>c1</p></td></tr>" +
      "<tr><td class=\"Text\"><p>c2</p></td></tr>" +
      "<tr><td class=\"Text\"><p>a2</p></td><td class=\"Text\"><p>b2</p></td></tr></table>",
    );
  });

  it("counts leaves through several levels", () => {
    const cells = [Node([cell("a")], [
      Node([cell("b1")], [Node([cell("c1")], []), Node([cell("c2")], []), Node([cell("c3")], [])]),
      Node([cell("b2")], []),
    ])];
    const html = H.renderHtml(matrixToHtml(pathFunc, noAttr, [], [], cells));
    expect(html.match(/rowspan="(\d)"/g)).toEqual(["rowspan=\"4\"", "rowspan=\"3\""]);
    expect(html.match(/<tr>/g)?.length).toBe(4);
  });
});

describe("mkHtmlDocument", () => {
  it("wraps the blocks in a document", () => {
    const html = H.renderHtml(mkHtmlDocument(pathFunc, H.title("T"), [Para([Icon("i")])]));
    expect(html).toBe(
      "<!DOCTYPE HTML>\n<html><head><meta charset=\"UTF-8\"><title>T</title></head>" +
      "<body><p><img src=\"icons/i.png\" alt=\"icon\" height=\"16\" width=\"16\"></p></body></html>",
    );
    expect(show_ImageRef(IconRef("i"))).toBe("IconRef \"i\"");
  });
});
