// Ported from banana-ui/webits/src/Network/Webits/StyleSheets.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * = Stylesheets for Arrowised Web GUIs
 *
 * The "Network.Webits.ArrowDialog" module uses CSS classes. This module defines a default
 * stylesheet, along with a function that puts the stylesheet in the appropriate URL using Scotty.
 *
 * TypeScript port
 * ---------------
 * The Haskell module builds the stylesheet with the Clay CSS DSL (clay 0.13.3). Here `Css` is the
 * list of rules that the Clay `do` block builds, with each selector and property value already in
 * the text Clay renders for it, and `stylesheetInternal` renders it as Clay's `renderWith pretty []`
 * does (aligned colons, one blank line between rules, the "Generated with Clay" banner), so the page
 * gets the same stylesheet text as the original. Clay renders an opaque colour as @#rrggbb@
 * (`grayish n` is `rgb n n n`, @transparent@ is @rgba(0,0,0,0.0)@), sizes without trailing zeros
 * (@px 1@ is @1px@), times with Haskell `show` (@sec 1@ is @1.0s@), and gives the `animation` key one
 * copy per browser prefix. `a ** b` is the descendant combinator, `a |> b` the child combinator,
 * `a # b` a refinement; `after` is the pseudo element @::after@.
 *
 * Note: as in the original, `stylesheetInternal` puts the CSS in the @style@ element as escaped
 * text (blaze `H.lazyText`). The browser does not decode entities in a @style@ element, so the
 * rules containing @>@ or @"@ (the @*@ font family and the @.horizontal@/@.vertical@ child
 * rules) are not effective, exactly as in the original web pages.
 */
import * as H from "@/lib/Text/Blaze/Html5";
import { showDouble } from "@/lib/Prelude";

/** One property of a rule: the key and the rendered value. */
export type CssProperty = readonly [string, string];

/** One rule of a stylesheet (Clay `selector ? do ...`): the rendered selector and its properties. */
export interface CssRule {
  readonly selector: string;
  readonly properties: readonly CssProperty[];
}

/** A stylesheet (Clay `Css`): its rules in order. */
export type Css = readonly CssRule[];

/** Clay `selector ? do props`. Prefixed properties (see `prefixed`) are lists of properties. */
function rule(selector: string, ...props: readonly (CssProperty | readonly CssProperty[])[]): CssRule {
  const properties: CssProperty[] = [];
  for (const p of props) {
    if (typeof p[0] === "string") properties.push(p as CssProperty);
    else properties.push(...(p as readonly CssProperty[]));
  }
  return { selector, properties };
}

// Clay values, rendered as clay-0.13.3 renders them.

/** Two lower-case hex digits (`printf "%02x"`). */
function hex2(n: number): string {
  return n.toString(16).padStart(2, "0");
}

/** Clay `rgb r g b` (alpha 1): rendered as @#rrggbb@. */
function rgb(r: number, g: number, b: number): string {
  return "#" + hex2(r) + hex2(g) + hex2(b);
}

/** Clay `grayish g = rgb g g g`. */
function grayish(g: number): string {
  return rgb(g, g, g);
}

const white = rgb(255, 255, 255);
const black = rgb(0, 0, 0);
const lightcoral = rgb(240, 128, 128);
/** Clay `transparent = rgba 0 0 0 0` (rendered with `rgba(...)` because the alpha is not 1). */
const transparent = "rgba(0,0,0,0.0)";

/** Clay `cssDoubleText`: a `Fixed E5` number shown without trailing zeros. */
function cssDoubleText(d: number): string {
  return String(Math.floor(d * 1e5) / 1e5);
}

/** Clay `px`. */
function px(d: number): string {
  return cssDoubleText(d) + "px";
}

/** Clay `pct`. */
function pct(d: number): string {
  return cssDoubleText(d) + "%";
}

/** Clay `em`. */
function em(d: number): string {
  return cssDoubleText(d) + "em";
}

/** Clay `rem`. */
function rem(d: number): string {
  return cssDoubleText(d) + "rem";
}

/** Clay `sec i = Time (value (pack (show i) <> "s"))`: Haskell `show` of the `Double`. */
function sec(d: number): string {
  return showDouble(d) + "s";
}

/** Clay `browsers`: the vendor prefixes of a `Prefixed` key, in Clay's order. */
const browsers: readonly string[] = ["-webkit-", "-moz-", "-ms-", "-o-", ""];

/** Clay `prefixed (browsers <> k) v`: one property per browser prefix. */
function prefixed(k: string, v: string): CssProperty[] {
  return browsers.map((p): CssProperty => [p + k, v]);
}

/** A standard CSS file. Applications can override this as they see fit. */
export const webitStdCss: Css = [
  // star ? fontFamily ["Roboto"] [sansSerif]
  rule("*", ["font-family", '"Roboto", sans-serif']),
  rule(
    ".dialog",
    ["overflow", "scroll"],
    ["background-color", grayish(0xfe)],
    ["border", "solid " + px(1) + " " + grayish(0x80)],
    ["position", "fixed"],
    ["left", pct(20)],
    ["max-width", pct(60)],
    ["top", pct(20)],
    ["max-height", pct(60)],
  ),
  // ".disabled" ** star
  rule(".disabled *", ["color", grayish(0x40)]),
  // ul # ".fancytree-container"
  rule("ul.fancytree-container", ["min-height", px(10)], ["padding-bottom", px(10)]),
  // ".grid" ** th
  rule(".grid th", ["font-weight", "bold"], ["align-content", "center"]),
  // ".horizontal" |> star
  rule(".horizontal > *", ["display", "inline"]),
  rule(
    ".icon-menu",
    ["position", "fixed"],
    ["left", pct(25)],
    ["right", pct(15)],
    ["top", pct(30)],
    ["bottom", pct(15)],
    ["background-color", white],
    ["border", "solid " + px(1) + " " + black],
    ["overflow", "scroll"],
  ),
  // let m = px 5
  rule(".icon-display", ["width", px(48)], ["height", px(48)], ["border", "solid " + px(5) + " " + white]),
  rule(".icon-inline", ["width", px(16)], ["height", px(16)]),
  rule(".image-small", ["max-width", px(150)], ["max-height", px(100)]),
  rule(".image-medium", ["max-width", px(300)], ["max-height", px(200)]),
  rule(".image-large", ["max-width", px(600)], ["max-height", px(400)]),
  rule(".invalid", ["background-color", lightcoral]),
  // ".invalid" ** star
  rule(".invalid *", ["background-color", lightcoral]),
  // table # ".matrix"
  rule("table.matrix", ["border-collapse", "collapse"]),
  rule(".matrix td", ["border", "solid " + px(1) + " " + black]),
  rule(".matrix th", ["border", "solid " + px(1) + " " + black]),
  rule(".memo-small", ["width", em(20)], ["height", rem(3)]),
  rule(".memo-medium", ["width", em(40)], ["height", rem(8)]),
  rule(".memo-large", ["width", em(40)], ["height", rem(15)]),
  rule(
    ".no-box",
    ["padding", [px(0), px(0), px(0), px(0)].join(" ")],
    ["border-width", px(0)],
    ["padding", [px(0), px(0), px(0), px(0)].join(" ")],
    ["margin", [px(0), px(0), px(0), px(0)].join(" ")],
  ),
  rule(".popup", ["position", "relative"], ["display", "inline-block"]),
  rule(
    ".popup .popup-widget",
    ["visibility", "hidden"],
    ["width", em(40)],
    ["background-color", grayish(0x50)],
    ["color", white],
    ["padding", [px(8), px(0), px(8), px(0)].join(" ")],
    ["position", "absolute"],
    ["top", px(-10)],
    ["left", px(10)],
  ),
  // ".popup" ** ".popup-widget" # after
  rule(
    ".popup .popup-widget::after",
    ["content", "none"],
    ["position", "absolute"],
    ["top", pct(100)],
    ["left", pct(50)],
    ["margin-left", px(-5)],
    ["border-width", px(5)],
    ["border-style", "solid"],
    ["border-color", [grayish(0x50), transparent, transparent, transparent].join(" ")],
  ),
  rule(
    ".popup .show",
    ["visibility", "visible"],
    // animation "fadeIn" (sec 0) linear (sec 1) infinite normal forwards
    prefixed("animation", ["fadeIn", sec(0), "linear", sec(1), "infinite", "normal", "forwards"].join(" ")),
    ["overflow", "scroll"],
  ),
  rule(".popup-menu", ["position", "absolute"]),
  rule(".scrolled", ["overflow", "scroll"]),
  rule(
    ".tab-form",
    ["padding", [px(6), px(12), px(6), px(12)].join(" ")],
    // -- borderTop none none none
  ),
  rule(".tab-header", ["overflow", "hidden"], ["border", "solid " + px(1) + " " + grayish(0xc0)], ["background-color", grayish(0xf1)]),
  rule(
    ".tab-header button",
    ["background-color", "inherit"],
    ["float", "left"],
    ["border-width", px(0)],
    ["outline-width", px(0)],
    ["cursor", "pointer"],
    ["padding", [px(7), px(8), px(7), px(8)].join(" ")],
    ["transition-duration", sec(0.3)],
  ),
  // ".tab-header" ** button # hover
  rule(".tab-header button:hover", ["background-color", grayish(0xd0)]),
  rule(".tab-header .active", ["background-color", grayish(0xc0)]),
  // ".vertical" |> star
  rule(".vertical > *", ["display", "block"]),
  rule(".window-title", ["background-color", grayish(0x30)], ["color", white], ["font-weight", "bold"], ["align-content", "center"]),
  rule(".vl", ["border-left", "solid " + px(1) + " " + grayish(0x20)], ["height", pct(100)]),
];

/**
 * Clay `renderWith pretty []`: two-space indentation, the colons of a rule aligned, a final
 * semicolon, a blank line after each rule and the Clay banner at the end.
 */
function renderWithPretty(css: Css): string {
  const out: string[] = ["\n"];
  for (const r of css) {
    if (r.properties.length > 0) {
      const width = 1 + Math.max(...r.properties.map(([k]) => k.length));
      const lines = r.properties.map(([k, v]) => "  " + k + " ".repeat(width - k.length) + ": " + v);
      out.push(r.selector + "\n{\n" + lines.join(";\n") + ";\n}\n");
    }
    out.push("\n");
  }
  out.push("\n/* Generated with Clay, http://fvisser.nl/clay */");
  return out.join("");
}

/** The stylesheet as a HTML style tag. */
export function stylesheetInternal(css: Css): H.Html {
  return H.style(H.lazyText(renderWithPretty(css)));
}

/** The standard CSS plus the sebitScriptLibrary, ready to go in the @head@ of a web page. */
export const standardHeader: H.Html = stylesheetInternal(webitStdCss);
