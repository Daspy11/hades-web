/**
 * Haskell `Text.XML.Light` (package `xml`): a lightweight XML library.
 *
 * Use as `import * as X from "@/lib/Text/XML/Light"`; the cursor module is
 * `import * as XC from "@/lib/Text/XML/Light/Cursor"`.
 *
 * This module re-exports `Text.XML.Light.Types` and defines the functions of the
 * `Text.XML.Light` module itself. The `Node` class (`node`, `unode`) chooses the kind of element
 * from the type of its argument; in TypeScript `node` inspects the argument at run time, which
 * gives the same results for every instance of the Haskell class (see `node`).
 *
 * Not yet provided: `Text.XML.Light.Proc`, `Text.XML.Light.Input` (`parseXML`, ...) and
 * `Text.XML.Light.Output` (`showTopElement`, ...), which the Haskell module also re-exports.
 * Add them as `Light/Proc.ts`, `Light/Input.ts` and `Light/Output.ts` with an `export *` here.
 */
import { blank_cdata, blank_element, blank_name, CData, Elem, Element, QName, Text } from "./Light/Types";
import type { Attr, Content } from "./Light/Types";

export * from "./Light/Types";

/** Add an attribute to an element. */
export function add_attr(a: Attr, e: Element): Element {
  return add_attrs([a], e);
}

/** Add some attributes to an element. */
export function add_attrs(as: readonly Attr[], e: Element): Element {
  return Element(e.elName, [...as, ...e.elAttribs], e.elContent, e.elLine);
}

/** Create an unqualified name. */
export function unqual(x: string): QName {
  return QName(x, blank_name.qURI, blank_name.qPrefix);
}

/** The content arguments of the `Node` instances. */
export type NodeContents =
  | readonly Content[]
  | Content
  | readonly Element[]
  | Element
  | readonly CData[]
  | CData
  | string;

/**
 * The argument types of the `Node` instances: `()` (as `null`), `[Attr]`, `Attr`, the content
 * types, and pairs of `[Attr]` or `Attr` with a content type.
 */
export type NodeArg = null | readonly Attr[] | Attr | NodeContents | readonly [readonly Attr[] | Attr, NodeContents];

function isAttr(v: unknown): v is Attr {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "attrKey" in v && "attrVal" in v;
}

function isContent(v: unknown): v is Content {
  const t = (v as any)?.tag;
  return t === "Elem" || t === "Text" || t === "CRef";
}

function isElement(v: unknown): v is Element {
  return typeof v === "object" && v !== null && "elName" in v && "elContent" in v;
}

function isCData(v: unknown): v is CData {
  return typeof v === "object" && v !== null && "cdVerbatim" in v && "cdData" in v;
}

/** The children made from a content argument. */
function toContents(c: NodeContents): readonly Content[] {
  if (typeof c === "string") return [Text(CData(blank_cdata.cdVerbatim, c, blank_cdata.cdLine))];
  if (Array.isArray(c)) {
    return (c as readonly unknown[]).map((x) => {
      if (isContent(x)) return x;
      if (isElement(x)) return Elem(x);
      if (isCData(x)) return Text(x);
      throw new Error("Text.XML.Light.node: not element content");
    });
  }
  if (isContent(c)) return [c];
  if (isElement(c)) return [Elem(c)];
  if (isCData(c)) return [Text(c)];
  throw new Error("Text.XML.Light.node: not element content");
}

/**
 * A smart element constructor which uses the type of its argument
 * to determine what sort of element to make.
 *
 * The Haskell instances are distinguished at run time: `null` is `()`, a string is text, an
 * array of length 2 whose first element is an array (or an `Attr` followed by something that is
 * not an `Attr`) is a pair of attributes and contents, any other array is a list of attributes
 * or contents according to its elements (an empty list makes an empty element whatever its type).
 */
export function node(n: QName, t: NodeArg): Element {
  const make = (attrs: readonly Attr[], cont: readonly Content[]): Element =>
    Element(n, attrs, cont, blank_element.elLine);
  if (t === null) return make([], []);
  if (typeof t === "string") return make([], toContents(t));
  if (Array.isArray(t)) {
    const xs = t as readonly unknown[];
    const isPair = xs.length === 2 && (Array.isArray(xs[0]) || (isAttr(xs[0]) && !isAttr(xs[1])));
    if (isPair) {
      const [as, cs] = xs as unknown as readonly [readonly Attr[] | Attr, NodeContents];
      return make(Array.isArray(as) ? (as as readonly Attr[]) : [as as Attr], toContents(cs));
    }
    if (xs.length === 0) return make([], []);
    if (isAttr(xs[0])) return make(xs as readonly Attr[], []);
    return make([], toContents(t as NodeContents));
  }
  if (isAttr(t)) return make([t], []);
  return make([], toContents(t as NodeContents));
}

/** Create node with unqualified name */
export function unode(s: string, t: NodeArg): Element {
  return node(unqual(s), t);
}
