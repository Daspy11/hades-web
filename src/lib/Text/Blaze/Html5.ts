/**
 * Haskell `Text.Blaze.Html5`: HTML5 element combinators. Use as `import * as H from
 * "@/lib/Text/Blaze/Html5"`. Also re-exports `Text.Blaze.Html` (markup, `with_` for `!`,
 * `toHtml`, attribute values, `renderHtml`). See `Text/Blaze/Html.ts` for the mapping.
 *
 * Elements with content take their children as arguments: `H.div(a, b)` is
 * `H.div $ do { a; b }`; a string child is escaped text. Leaf elements (`img`, `br`, `input`,
 * `link`, `meta`, `hr`, ...) take no arguments: `H.img()`.
 */
import { leaf, parent, preEscapedText, type Html, type HtmlLike } from "./Html";

export * from "./Html";

type P = (...children: readonly HtmlLike[]) => Html;
const p = (name: string): P => (...children) => parent(name, children);
const l = (name: string): (() => Html) => () => leaf(name);

/** `docType`: `<!DOCTYPE HTML>`. */
export function docType(): Html {
  return preEscapedText("<!DOCTYPE HTML>\n");
}
/** `docTypeHtml`: the doctype followed by an `html` element. */
export function docTypeHtml(...children: readonly HtmlLike[]): Html {
  return parent("html", [docType(), ...children]);
}

export const a: P = p("a");
export const abbr: P = p("abbr");
export const address: P = p("address");
export const area = l("area");
export const article: P = p("article");
export const aside: P = p("aside");
export const audio: P = p("audio");
export const b: P = p("b");
export const base = l("base");
export const bdo: P = p("bdo");
export const blockquote: P = p("blockquote");
export const body: P = p("body");
export const br = l("br");
export const button: P = p("button");
export const canvas: P = p("canvas");
export const caption: P = p("caption");
export const cite: P = p("cite");
export const code: P = p("code");
export const col = l("col");
export const colgroup: P = p("colgroup");
export const datalist: P = p("datalist");
export const dd: P = p("dd");
export const del: P = p("del");
export const details: P = p("details");
export const dfn: P = p("dfn");
export const div: P = p("div");
export const dl: P = p("dl");
export const dt: P = p("dt");
export const em: P = p("em");
export const embed = l("embed");
export const fieldset: P = p("fieldset");
export const figcaption: P = p("figcaption");
export const figure: P = p("figure");
export const footer: P = p("footer");
export const form: P = p("form");
export const h1: P = p("h1");
export const h2: P = p("h2");
export const h3: P = p("h3");
export const h4: P = p("h4");
export const h5: P = p("h5");
export const h6: P = p("h6");
export const head: P = p("head");
export const header: P = p("header");
export const hgroup: P = p("hgroup");
export const hr = l("hr");
export const html: P = p("html");
export const i: P = p("i");
export const iframe: P = p("iframe");
export const img = l("img");
export const input = l("input");
export const ins: P = p("ins");
export const kbd: P = p("kbd");
export const label: P = p("label");
export const legend: P = p("legend");
export const li: P = p("li");
export const link = l("link");
export const main: P = p("main");
export const mark: P = p("mark");
export const menu: P = p("menu");
export const meta = l("meta");
export const meter: P = p("meter");
export const nav: P = p("nav");
export const noscript: P = p("noscript");
export const ol: P = p("ol");
export const optgroup: P = p("optgroup");
export const option: P = p("option");
export const output: P = p("output");
export const p_: P = p("p");
export { p_ as p };
export const param = l("param");
export const pre: P = p("pre");
export const progress: P = p("progress");
export const q: P = p("q");
export const samp: P = p("samp");
export const script: P = p("script");
export const section: P = p("section");
export const select: P = p("select");
export const small: P = p("small");
export const source = l("source");
export const span: P = p("span");
export const strong: P = p("strong");
export const style: P = p("style");
export const sub: P = p("sub");
export const summary: P = p("summary");
export const sup: P = p("sup");
export const table: P = p("table");
export const tbody: P = p("tbody");
export const td: P = p("td");
export const textarea: P = p("textarea");
export const tfoot: P = p("tfoot");
export const th: P = p("th");
export const thead: P = p("thead");
export const time: P = p("time");
export const title: P = p("title");
export const tr: P = p("tr");
export const track = l("track");
export const u: P = p("u");
export const ul: P = p("ul");
export const var_: P = p("var");
export const video: P = p("video");
export const wbr = l("wbr");
