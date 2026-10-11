// Ported from banana-ui/webits/src/Network/Webits/StyleSheets.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * = Stylesheets for Arrowised Web GUIs
 *
 * The "Network.Webits.ArrowDialog" module uses CSS classes. This module defines a default
 * stylesheet, along with a function that puts the stylesheet in the appropriate URL using Scotty.
 *
 * TypeScript port
 * ---------------
 * The Haskell module builds the stylesheet with the Clay CSS DSL. Here `Css` is the CSS text that
 * Clay renders (`renderWith pretty []` is the identity), and `webitStdCss` is written out as CSS:
 * `grayish n` is `rgb(n,n,n)`, `pct`/`px`/`em`/`rem`/`sec` are the CSS units, `a ** b` is the
 * descendant combinator, `a |> b` the child combinator and `a # b` a refinement. Clay's vendor
 * prefixed copies of `animation` and `transition-duration` are left out.
 *
 * Note: as in the original, `stylesheetInternal` puts the CSS in the @style@ element as escaped
 * text (blaze `H.lazyText`). The browser does not decode entities in a @style@ element, so the
 * rules containing @>@ or @"@ (the @*@ font family and the @.horizontal@/@.vertical@ child
 * rules) are not effective, exactly as in the original web pages.
 */
import * as H from "@/lib/Text/Blaze/Html5";

/** A stylesheet (the CSS text rendered by Clay). */
export type Css = string;

/**
 * A standard CSS file. Applications can override this as they see fit.
 *
 * (The Clay source of @.tab-form@ also has a commented-out @-- borderTop none none none@.)
 */
export const webitStdCss: Css = `* {
  font-family: "Roboto", sans-serif;
}
.dialog {
  overflow: scroll;
  background-color: rgb(254,254,254);
  border: solid 1px rgb(128,128,128);
  position: fixed;
  left: 20%;
  max-width: 60%;
  top: 20%;
  max-height: 60%;
}
.disabled * {
  color: rgb(64,64,64);
}
ul.fancytree-container {
  min-height: 10px;
  padding-bottom: 10px;
}
.grid th {
  font-weight: bold;
  align-content: center;
}
.horizontal > * {
  display: inline;
}
.icon-menu {
  position: fixed;
  left: 25%;
  right: 15%;
  top: 30%;
  bottom: 15%;
  background-color: rgb(255,255,255);
  border: solid 1px rgb(0,0,0);
  overflow: scroll;
}
.icon-display {
  width: 48px;
  height: 48px;
  border: solid 5px rgb(255,255,255);
}
.icon-inline {
  width: 16px;
  height: 16px;
}
.image-small {
  max-width: 150px;
  max-height: 100px;
}
.image-medium {
  max-width: 300px;
  max-height: 200px;
}
.image-large {
  max-width: 600px;
  max-height: 400px;
}
.invalid {
  background-color: rgb(240,128,128);
}
.invalid * {
  background-color: rgb(240,128,128);
}
table.matrix {
  border-collapse: collapse;
}
.matrix td {
  border: solid 1px rgb(0,0,0);
}
.matrix th {
  border: solid 1px rgb(0,0,0);
}
.memo-small {
  width: 20em;
  height: 3rem;
}
.memo-medium {
  width: 40em;
  height: 8rem;
}
.memo-large {
  width: 40em;
  height: 15rem;
}
.no-box {
  padding: 0px 0px 0px 0px;
  border-width: 0px;
  padding: 0px 0px 0px 0px;
  margin: 0px 0px 0px 0px;
}
.popup {
  position: relative;
  display: inline-block;
}
.popup .popup-widget {
  visibility: hidden;
  width: 40em;
  background-color: rgb(80,80,80);
  color: rgb(255,255,255);
  padding: 8px 0px 8px 0px;
  position: absolute;
  top: -10px;
  left: 10px;
}
.popup .popup-widget:after {
  content: none;
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border-width: 5px;
  border-style: solid;
  border-color: rgb(80,80,80) transparent transparent transparent;
}
.popup .show {
  visibility: visible;
  animation: fadeIn 0s linear 1s infinite normal forwards;
  overflow: scroll;
}
.popup-menu {
  position: absolute;
}
.scrolled {
  overflow: scroll;
}
.tab-form {
  padding: 6px 12px 6px 12px;
}
.tab-header {
  overflow: hidden;
  border: solid 1px rgb(192,192,192);
  background-color: rgb(241,241,241);
}
.tab-header button {
  background-color: inherit;
  float: left;
  border-width: 0px;
  outline-width: 0px;
  cursor: pointer;
  padding: 7px 8px 7px 8px;
  transition-duration: 0.3s;
}
.tab-header button:hover {
  background-color: rgb(208,208,208);
}
.tab-header .active {
  background-color: rgb(192,192,192);
}
.vertical > * {
  display: block;
}
.window-title {
  background-color: rgb(48,48,48);
  color: rgb(255,255,255);
  font-weight: bold;
  align-content: center;
}
.vl {
  border-left: solid 1px rgb(32,32,32);
  height: 100%;
}
`;

/** The stylesheet as a HTML style tag. */
export function stylesheetInternal(css: Css): H.Html {
  return H.style(H.lazyText(css));
}

/** The standard CSS plus the sebitScriptLibrary, ready to go in the @head@ of a web page. */
export const standardHeader: H.Html = stylesheetInternal(webitStdCss);
