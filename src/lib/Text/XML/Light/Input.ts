/**
 * Haskell `Text.XML.Light.Input` (package `xml`, version 1.3.14): a lightweight XML parsing
 * library. Re-exported by `Text.XML.Light` (`import * as X from "@/lib/Text/XML/Light"`).
 *
 * The parser never fails: malformed input is repaired as the Haskell one does (unclosed
 * elements are closed at the end of their parent, unknown closing tags become text). Names are
 * annotated with their namespace URIs (`qURI`) from the `xmlns` declarations in scope.
 *
 * Input is an `XmlSource` (see `./Lexer`): a `string`, or a `Uint8Array` read as Latin-1, as
 * the Haskell `ByteString` instances do.
 */
import { Just, Nothing, type Maybe } from "../../../Data/Maybe";
import { equals } from "../../../Data/Ord";
import { tokens, type Token, type XmlSource } from "./Lexer";
import { showQName } from "./Output";
import { onlyElems } from "./Proc";
import { Attr, CData, CRef, Elem, Element, QName, Text, type Content, type Line } from "./Types";

export type { XmlSource } from "./Lexer";

/** parseXMLDoc, parse a XMLl document to maybe an element */
export function parseXMLDoc(xs: XmlSource): Maybe<Element> {
  const strip = (cs: readonly Content[]): Maybe<Element> => {
    let es = onlyElems(cs);
    for (;;) {
      if (es.length === 0) return Nothing;
      const [e, ...rest] = es;
      if (e.elName.qName.startsWith("?xml")) es = rest;
      else return Just(e);
    }
  };
  return strip(parseXML(xs));
}

/** parseXML to a list of content chunks */
export function parseXML(xs: XmlSource): Content[] {
  return parse(tokens(xs));
}

// ------------------------------------------------------------------------

/** Parse a list of tokens into content. */
export function parse(ts: readonly Token[]): Content[] {
  return nodes(NSInfo([], Nothing), ts);
}

/** Namespace information: the prefix bindings in scope (innermost first) and the default namespace. */
export type NSInfo = readonly [readonly (readonly [string, string])[], Maybe<string>];
function NSInfo(ns: readonly (readonly [string, string])[], def: Maybe<string>): NSInfo {
  return [ns, def];
}

/** Content being collected for one level, with the Haskell text-merging flag for each item. */
interface Frame {
  readonly name: QName | null;
  readonly info: NSInfo;
  readonly line: Line;
  readonly attrs: readonly Attr[];
  readonly content: { c: Content; absorbs: boolean }[];
}

/**
 * Haskell `nodes ns ps ts` at the top level (`ps = []`), run over all the tokens with an
 * explicit stack of open elements instead of recursion. The results are the same:
 *
 * * a text token is merged with the content that follows it if that is text of the same kind
 *   (a text made from an unknown closing tag is not merged with what follows it);
 * * a closing tag closes the innermost open element with the same name, and any elements opened
 *   inside it; a closing tag that matches no open element becomes text;
 * * the end of input closes all open elements.
 */
function nodes(info0: NSInfo, ts: readonly Token[]): Content[] {
  const root: Frame = { name: null, info: info0, line: 0, attrs: [], content: [] };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1];
  const push = (f: Frame, c: Content, absorbs: boolean): void => {
    const last = f.content.length > 0 ? f.content[f.content.length - 1] : undefined;
    if (
      c.tag === "Text" && last !== undefined && last.absorbs && last.c.tag === "Text" &&
      last.c._0.cdVerbatim === c._0.cdVerbatim
    ) {
      const cd = last.c._0;
      last.c = Text(CData(cd.cdVerbatim, cd.cdData + c._0.cdData, cd.cdLine));
      last.absorbs = absorbs;
    } else {
      f.content.push({ c, absorbs });
    }
  };
  const close = (): void => {
    const f = stack.pop()!;
    const e = Element(f.name!, f.attrs, f.content.map((x) => x.c), Just(f.line));
    push(top(), Elem(e), false);
  };
  for (const t of ts) {
    const cur = top();
    switch (t.tag) {
      case "TokCRef":
        push(cur, CRef(t._0), false);
        break;
      case "TokText":
        push(cur, Text(t._0), true);
        break;
      case "TokStart": {
        const newInfo = t._2.reduceRight((acc: NSInfo, a) => addNS(a, acc), cur.info);
        const newName = annotName(newInfo, t._1);
        const attrs = t._2.map((a) => annotAttr(newInfo, a));
        if (t._3) {
          push(cur, Elem(Element(newName, attrs, [], Just(t._0))), false);
        } else {
          stack.push({ name: newName, info: newInfo, line: t._0, attrs, content: [] });
        }
        break;
      }
      case "TokEnd": {
        const t1 = annotName(cur.info, t._1);
        // break (t1 ==) ps, where ps are the names of the open elements, innermost first.
        let k = -1;
        for (let d = stack.length - 1; d >= 1; d--) {
          if (equals(stack[d].name, t1)) {
            k = d;
            break;
          }
        }
        if (k < 0) {
          // Unknown closing tag. Insert as text.
          push(cur, Text(CData("CDataText", "</" + showQName(t._1) + ">", Just(t._0))), false);
        } else {
          while (stack.length > k) close();
        }
        break;
      }
    }
  }
  while (stack.length > 1) close();
  return root.content.map((x) => x.c);
}

/** Annotate a name with its namespace URI. */
export function annotName(info: NSInfo, n: QName): QName {
  const [namespaces, def_ns] = info;
  const uri: Maybe<string> = n.qPrefix.tag === "Nothing"
    ? def_ns
    : lookupNS(n.qPrefix.value, namespaces);
  return QName(n.qName, uri, n.qPrefix);
}

function lookupNS(k: string, ns: readonly (readonly [string, string])[]): Maybe<string> {
  const r = ns.find(([p]) => p === k);
  return r === undefined ? Nothing : Just(r[1]);
}

/**
 * Annotate an attribute name with its namespace URI. Do not apply the default name-space to
 * unqualified attributes. See Section 6.2 of <http://www.w3.org/TR/REC-xml-names>.
 */
export function annotAttr(info: NSInfo, a: Attr): Attr {
  if (a.attrKey.qPrefix.tag === "Nothing") return a;
  return Attr(annotName(info, a.attrKey), a.attrVal);
}

/** Add a namespace declaration attribute to the namespace information. */
export function addNS(a: Attr, info: NSInfo): NSInfo {
  const [ns, def] = info;
  const key = a.attrKey;
  if (key.qPrefix.tag === "Nothing" && key.qName === "xmlns") {
    return NSInfo(ns, a.attrVal === "" ? Nothing : Just(a.attrVal));
  }
  if (key.qPrefix.tag === "Just" && key.qPrefix.value === "xmlns") {
    return NSInfo([[key.qName, a.attrVal], ...ns], def);
  }
  return info;
}
