/**
 * Haskell `Text.Blaze.Html` (blaze-html / blaze-markup) and its renderers
 * (`Text.Blaze.Html.Renderer.Text`, `.String`, `.Utf8`).
 *
 * Elements are in `Text/Blaze/Html5` (`import * as H`), attributes in
 * `Text/Blaze/Html5/Attributes` (`import * as HA`).
 *
 * Mapping
 * -------
 * | Haskell                                   | TypeScript                                       |
 * |-------------------------------------------|--------------------------------------------------|
 * | `Html` (`Markup`)                         | `Html`: an immutable list of nodes               |
 * | `H.div $ do a; b`                         | `H.div(a, b)` (children: `Html` or text strings)  |
 * | `H.div ! HA.id "x" ! HA.class_ "y" $ c`   | `with_(H.div(c), HA.id("x"), HA.class_("y"))`     |
 * | `H.img ! HA.src u`                        | `with_(H.img(), HA.src(u))`                       |
 * | `H.th ! HA.rowspan "2"` (a function)      | `with_(H.th, HA.rowspan("2"))` (a function)       |
 * | `h !? (cond, attr)`                       | `withIf(h, [cond, attr])`                         |
 * | `"literal"` as `Html` (OverloadedStrings) | a string child, or `text("literal")`             |
 * | `do { a; b }`, `mconcat`, `mapM_`         | `mconcat_Html([a, b])`, `append_Html(a, b)`       |
 * | `return ()` / `mempty`                    | `mempty_Html`                                    |
 * | `toHtml x`, `toMarkup x`                  | `toHtml(x)` (text, number, boolean or `Html`)     |
 * | `"literal"` as `AttributeValue`           | a string attribute argument                      |
 * | `renderHtml`                              | `renderHtml` (returns a string)                  |
 *
 * As in blaze, `with_` (the `!` operator) adds the attributes to every top-level element of its
 * argument, text is escaped when rendered (`&`, `<`, `>`, `"`, `'`), and the `preEscaped*`
 * functions insert raw text.
 */
import { showDouble } from "@/lib/Prelude";

// ---------------------------------------------------------------------------------------------
// Attribute values

/** `AttributeValue`: the value of an HTML attribute. */
export class AttributeValue {
  constructor(
    /** The text of the value. */
    readonly text: string,
    /** True if the text is already escaped. */
    readonly preEscaped: boolean,
  ) {}
}

/** An attribute value, or a string literal (escaped, as an OverloadedStrings literal). */
export type AttributeValueLike = AttributeValue | string;

/** An attribute with its value, ready to be added to an element with `with_`. */
export interface Attribute {
  readonly name: string;
  readonly value: AttributeValue;
}

function attrValue(v: AttributeValueLike): AttributeValue {
  return typeof v === "string" ? new AttributeValue(v, false) : v;
}

/** Make an attribute function (`Text.Blaze.Internal.attribute`). */
export function attribute(name: string): (v: AttributeValueLike) => Attribute {
  return (v) => ({ name, value: attrValue(v) });
}

/** `customAttribute`: an attribute with any name. */
export function customAttribute(name: string, v: AttributeValueLike): Attribute {
  return { name, value: attrValue(v) };
}

/** `dataAttribute`: a `data-*` attribute. */
export function dataAttribute(name: string, v: AttributeValueLike): Attribute {
  return { name: "data-" + name, value: attrValue(v) };
}

export function textValue(t: string): AttributeValue {
  return new AttributeValue(t, false);
}
export const stringValue = textValue;
export const lazyTextValue = textValue;
export function preEscapedTextValue(t: string): AttributeValue {
  return new AttributeValue(t, true);
}
export const preEscapedStringValue = preEscapedTextValue;
export const preEscapedLazyTextValue = preEscapedTextValue;
/** `preEscapedToValue`: a raw attribute value from text, a number or a boolean. */
export function preEscapedToValue(v: string | number | boolean): AttributeValue {
  return new AttributeValue(showValue(v), true);
}
/** `toValue`: an attribute value from text, a number or a boolean. */
export function toValue(v: string | number | boolean): AttributeValue {
  return new AttributeValue(showValue(v), false);
}

// ---------------------------------------------------------------------------------------------
// Markup

/** One node of markup. */
export type HtmlNode =
  | {
      readonly tag: "Element";
      readonly name: string;
      readonly attrs: readonly Attribute[];
      /** `null` for a leaf element (`<img>`, `<br>`, ...), which has no closing tag. */
      readonly children: Html | null;
      /** A leaf rendered XML style, `<name ... />` (`customLeaf name True`). */
      readonly close: boolean;
    }
  | { readonly tag: "Text"; readonly text: string }
  | { readonly tag: "Raw"; readonly html: string };

/** `Html` (blaze `Markup`): a sequence of nodes. */
export class Html {
  constructor(readonly nodes: readonly HtmlNode[]) {}
  toString(): string {
    return renderHtml(this);
  }
}

/** A child of an element: markup, or a text literal (escaped). */
export type HtmlLike = Html | string;

function toNodes(h: HtmlLike): readonly HtmlNode[] {
  return typeof h === "string" ? (h === "" ? [] : [{ tag: "Text", text: h }]) : h.nodes;
}

/** `mempty`/`return ()` for Html. */
export const mempty_Html: Html = new Html([]);

/** `a <> b` / `do { a; b }` for Html. */
export function append_Html(a: HtmlLike, b: HtmlLike): Html {
  return new Html([...toNodes(a), ...toNodes(b)]);
}

/** `mconcat`, `sequence_`, `mapM_` for Html. */
export function mconcat_Html(hs: readonly HtmlLike[]): Html {
  return new Html(hs.flatMap((h) => [...toNodes(h)]));
}

/** An element constructor taking children, such as `H.div` or `H.th`. */
export type HtmlFunction = (...children: readonly HtmlLike[]) => Html;

/**
 * Haskell `(!)`: add attributes to every top-level element of the markup.
 *
 * As blaze's `Attributable` instance for functions, `with_` also accepts an element function and
 * returns one: `(H.th ! HA.rowspan "2") . H.text` is
 * `(t) => with_(H.th, HA.rowspan("2"))(H.text(t))`.
 */
export function with_(h: HtmlLike, ...attrs: readonly Attribute[]): Html;
export function with_(h: HtmlFunction, ...attrs: readonly Attribute[]): HtmlFunction;
export function with_(h: HtmlLike | HtmlFunction, ...attrs: readonly Attribute[]): Html | HtmlFunction {
  if (typeof h === "function") return (...children) => with_(h(...children), ...attrs);
  return new Html(
    toNodes(h).map((n) => (n.tag === "Element" ? { ...n, attrs: [...n.attrs, ...attrs] } : n)),
  );
}

/** Haskell `(!?)`: add the attribute only if the condition holds (`h !? (cond, attr)`). */
export function withIf(h: HtmlLike, [cond, attr]: readonly [boolean, Attribute]): Html {
  return cond ? with_(h, attr) : toHtml(h);
}

/** An element with children (`Text.Blaze.Internal.Parent`). */
export function parent(name: string, children: readonly HtmlLike[]): Html {
  return new Html([{ tag: "Element", name, attrs: [], children: mconcat_Html(children), close: false }]);
}

/** An element without closing tag (`Text.Blaze.Internal.Leaf`). */
export function leaf(name: string): Html {
  return new Html([{ tag: "Element", name, attrs: [], children: null, close: false }]);
}

/** `customParent`: an element with any tag name and children. */
export function customParent(tagName: string, ...children: readonly HtmlLike[]): Html {
  return parent(tagName, children);
}

/** `customLeaf tag close`: an element without children, ending in ` />` if `close` is true. */
export function customLeaf(tagName: string, close: boolean): Html {
  return new Html([{ tag: "Element", name: tagName, attrs: [], children: null, close }]);
}

function showValue(v: string | number | boolean): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  return Number.isInteger(v) ? String(v) : showDouble(v);
}

/**
 * `toHtml` / `toMarkup`: text (escaped), a number (shown as Haskell would show an `Int`, or a
 * `Double` if not integral), a `Bool` (as `True`/`False`), or markup unchanged.
 */
export function toHtml(v: Html | string | number | boolean): Html {
  return v instanceof Html ? v : new Html(toNodes(showValue(v)));
}
export const toMarkup = toHtml;

/** `text`: escaped text. Also `string`, `lazyText`. */
export function text(t: string): Html {
  return new Html(toNodes(t));
}
export const string = text;
export const lazyText = text;

/** `preEscapedToHtml` and friends: raw markup, inserted unchanged. */
export function preEscapedText(t: string): Html {
  return new Html(t === "" ? [] : [{ tag: "Raw", html: t }]);
}
export const preEscapedString = preEscapedText;
export const preEscapedLazyText = preEscapedText;
export const preEscapedToHtml = preEscapedText;
export const preEscapedToMarkup = preEscapedText;

/** `textComment`: an HTML comment. */
export function textComment(t: string): Html {
  return preEscapedText("<!-- " + t + " -->");
}

// ---------------------------------------------------------------------------------------------
// Rendering

/** Escape text as blaze does. */
export function escapeHtml(t: string): string {
  return t.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function renderNodes(nodes: readonly HtmlNode[], out: string[]): void {
  for (const n of nodes) {
    switch (n.tag) {
      case "Text":
        out.push(escapeHtml(n.text));
        break;
      case "Raw":
        out.push(n.html);
        break;
      case "Element": {
        out.push("<", n.name);
        for (const a of n.attrs) {
          out.push(" ", a.name, '="', a.value.preEscaped ? a.value.text : escapeHtml(a.value.text), '"');
        }
        out.push(n.children === null && n.close ? " />" : ">");
        if (n.children !== null) {
          renderNodes(n.children.nodes, out);
          out.push("</", n.name, ">");
        }
        break;
      }
    }
  }
}

/** `renderHtml` (Text.Blaze.Html.Renderer.Text / .String / .Utf8 as text). */
export function renderHtml(h: HtmlLike): string {
  const out: string[] = [];
  renderNodes(toNodes(h), out);
  return out.join("");
}
export const renderMarkup = renderHtml;
