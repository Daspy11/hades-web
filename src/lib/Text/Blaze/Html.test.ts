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

  it("! on an element function, !?, nested ! keeps source order", () => {
    const th2 = H.with_(H.th, HA.rowspan("2"));
    expect(H.renderHtml(H.tr(th2(H.text("a")), th2("b")))).toBe('<tr><th rowspan="2">a</th><th rowspan="2">b</th></tr>');
    expect(H.renderHtml(H.withIf(H.p("x"), [false, HA.hidden("1")]))).toBe("<p>x</p>");
    expect(H.renderHtml(H.withIf(H.p("x"), [true, HA.hidden("1")]))).toBe('<p hidden="1">x</p>');
    // H.label ! HA.for "n" ! HA.class_ "c" $ "t"
    expect(H.renderHtml(H.with_(H.with_(H.label("t"), HA.for("n")), HA.class_("c")))).toBe('<label for="n" class="c">t</label>');
    expect(H.renderHtml(H.with_(H.th("g"), HA.colspan(H.toValue(3))))).toBe('<th colspan="3">g</th>');
  });

  it("leaves, custom elements and the doctype", () => {
    expect(H.renderHtml(H.with_(H.input(), HA.type_("text"), HA.value("a'b")))).toBe('<input type="text" value="a&#39;b">');
    expect(H.renderHtml(H.customLeaf("x", true))).toBe("<x />");
    expect(H.renderHtml(H.customLeaf("x", false))).toBe("<x>");
    expect(H.renderHtml(H.customParent("my-el", "a"))).toBe("<my-el>a</my-el>");
    expect(H.renderHtml(H.docTypeHtml(H.body()))).toBe("<!DOCTYPE HTML>\n<html><body></body></html>");
    expect(H.renderHtml(H.legend(H.text("")))).toBe("<legend></legend>");
  });

  it("toHtml shows numbers and booleans as Haskell does", () => {
    expect(H.renderHtml(H.span(H.toHtml(3), H.toHtml(2.5), H.toHtml(true)))).toBe("<span>32.5True</span>");
  });
});
