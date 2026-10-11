import { describe, expect, it } from "vitest";
import * as H from "./Html5";
import * as HA from "./Html5/Attributes";

describe("blaze-html", () => {
  it("renders elements, attributes and escaped text", () => {
    const h = H.with_(H.div(H.text("a < b & c"), H.with_(H.img(), HA.src("x.png"), HA.alt('say "hi"'))), HA.id("d1"), HA.class_("c"));
    expect(H.renderHtml(h)).toBe('<div id="d1" class="c">a &lt; b &amp; c<img src="x.png" alt="say &quot;hi&quot;"></div>');
  });

  it("! adds attributes to every top-level element", () => {
    const h = H.with_(H.mconcat_Html([H.li("1"), "text", H.li("2")]), HA.class_("x"));
    expect(H.renderHtml(h)).toBe('<li class="x">1</li>text<li class="x">2</li>');
  });

  it("pre-escaped text and values are inserted unchanged", () => {
    expect(H.renderHtml(H.script(H.preEscapedText("if (a < b) {}")))).toBe("<script>if (a < b) {}</script>");
    expect(H.renderHtml(H.with_(H.a("x"), HA.href(H.preEscapedTextValue("a&amp;b"))))).toBe('<a href="a&amp;b">x</a>');
    expect(H.renderHtml(H.style(H.lazyText(".a > b {}")))).toBe("<style>.a &gt; b {}</style>");
  });

  it("toHtml shows numbers and booleans as Haskell does", () => {
    expect(H.renderHtml(H.span(H.toHtml(3), H.toHtml(2.5), H.toHtml(true)))).toBe("<span>32.5True</span>");
  });
});
