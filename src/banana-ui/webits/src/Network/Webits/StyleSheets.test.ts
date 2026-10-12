import { describe, expect, it } from "vitest";
import * as H from "@/lib/Text/Blaze/Html5";
import { standardHeader, stylesheetInternal, webitStdCss } from "./StyleSheets";

describe("StyleSheets", () => {
  const html = H.renderHtml(standardHeader);

  it("renders the stylesheet as Clay's renderWith pretty [] does", () => {
    // A blank line first, aligned colons, a blank line after each rule, the banner at the end.
    expect(html.startsWith("<style>\n*\n{\n  font-family : &quot;Roboto&quot;, sans-serif;\n}\n\n.dialog\n{\n")).toBe(true);
    expect(html).toContain(
      ".dialog\n{\n" +
        "  overflow         : scroll;\n" +
        "  background-color : #fefefe;\n" +
        "  border           : solid 1px #808080;\n" +
        "  position         : fixed;\n" +
        "  left             : 20%;\n" +
        "  max-width        : 60%;\n" +
        "  top              : 20%;\n" +
        "  max-height       : 60%;\n" +
        "}\n\n.disabled *\n{\n  color : #404040;\n}\n",
    );
    expect(html.endsWith(".vl\n{\n  border-left : solid 1px #202020;\n  height      : 100%;\n}\n\n\n/* Generated with Clay, http://fvisser.nl/clay */</style>")).toBe(true);
  });

  it("renders Clay values: colours, sizes, times, prefixed keys and pseudo elements", () => {
    expect(html).toContain(
      ".popup .show\n{\n" +
        "  visibility        : visible;\n" +
        "  -webkit-animation : fadeIn 0.0s linear 1.0s infinite normal forwards;\n" +
        "  -moz-animation    : fadeIn 0.0s linear 1.0s infinite normal forwards;\n" +
        "  -ms-animation     : fadeIn 0.0s linear 1.0s infinite normal forwards;\n" +
        "  -o-animation      : fadeIn 0.0s linear 1.0s infinite normal forwards;\n" +
        "  animation         : fadeIn 0.0s linear 1.0s infinite normal forwards;\n" +
        "  overflow          : scroll;\n}\n",
    );
    expect(html).toContain(".popup .popup-widget::after\n{\n");
    expect(html).toContain("  border-color : #505050 rgba(0,0,0,0.0) rgba(0,0,0,0.0) rgba(0,0,0,0.0);\n");
    expect(html).toContain("  top              : -10px;\n");
    expect(html).toContain("  transition-duration : 0.3s;\n");
    expect(html).toContain(".invalid\n{\n  background-color : #f08080;\n}\n");
    expect(html).toContain(".memo-small\n{\n  width  : 20em;\n  height : 3rem;\n}\n");
  });

  it("escapes the CSS text as blaze does (so the child rules are broken, as in the original)", () => {
    expect(html).toContain(".horizontal &gt; *\n{\n  display : inline;\n}\n");
    expect(html).toContain(".vertical &gt; *\n{\n  display : block;\n}\n");
  });

  it("keeps every rule of the Clay source, in order", () => {
    expect(webitStdCss.map((r) => r.selector)).toEqual([
      "*", ".dialog", ".disabled *", "ul.fancytree-container", ".grid th", ".horizontal > *",
      ".icon-menu", ".icon-display", ".icon-inline", ".image-small", ".image-medium", ".image-large",
      ".invalid", ".invalid *", "table.matrix", ".matrix td", ".matrix th", ".memo-small",
      ".memo-medium", ".memo-large", ".no-box", ".popup", ".popup .popup-widget",
      ".popup .popup-widget::after", ".popup .show", ".popup-menu", ".scrolled", ".tab-form",
      ".tab-header", ".tab-header button", ".tab-header button:hover", ".tab-header .active",
      ".vertical > *", ".window-title", ".vl",
    ]);
    expect(H.renderHtml(stylesheetInternal([]))).toBe("<style>\n\n/* Generated with Clay, http://fvisser.nl/clay */</style>");
  });
});
