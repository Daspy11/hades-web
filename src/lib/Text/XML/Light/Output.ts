/**
 * Haskell `Text.XML.Light.Output` (package `xml`, version 1.3.14): output functions for XML
 * documents. Re-exported by `Text.XML.Light` (`import * as X from "@/lib/Text/XML/Light"`).
 *
 * As in the Haskell library, text and attribute values are escaped (`&lt;`, `&gt;`, `&amp;`,
 * `&quot;`, `&#39;`), and every character that is not printable ASCII (except `\n` and `\r`) is
 * written as a numeric character reference (`&#233;`), so the output is plain ASCII. Empty
 * elements are written `<name />` by default.
 *
 * `ShowS` functions (`ppContentS`, `showCDataS`, ...) take the text that follows as their last
 * argument and return the combined text.
 */
import type { Attr, CData, Content, Element, QName } from "./Types";

/** The XML 1.0 header */
export const xml_header: string = "<?xml version='1.0' ?>";

/** Haskell `type ShowS = String -> String`. */
export type ShowS = (rest: string) => string;

/** Pretty printing configuration. */
export interface ConfigPP {
  /** Should we output this tag in the short form (`<x />`) when it is empty? */
  readonly shortEmptyTag: (q: QName) => boolean;
  /** Use extra white space for nicer output. */
  readonly prettify: boolean;
}

/** Default pretty orinting configuration. Uses short empty tags and no extra white space. */
export const defaultConfigPP: ConfigPP = { shortEmptyTag: () => true, prettify: false };

/** The predicate specifies for which empty tags we should use XML's abbreviated notation `<x />`. */
export function useShortEmptyTags(p: (q: QName) => boolean, c: ConfigPP): ConfigPP {
  return { ...c, shortEmptyTag: p };
}

/** Specify if we should use extra white-space to make document more readable. */
export function useExtraWhiteSpace(p: boolean, c: ConfigPP): ConfigPP {
  return { ...c, prettify: p };
}

/** A configuration that tries to make things pretty (possibly at the cost of changing the semantics a bit through adding white space.) */
export const prettyConfigPP: ConfigPP = useExtraWhiteSpace(true, defaultConfigPP);

/** Pretty printing renders XML documents faithfully, with the exception that whitespace may be added/removed in non-verbatim character data. */
export function ppTopElement(e: Element): string {
  return ppcTopElement(prettyConfigPP, e);
}

/** Pretty printing elements */
export function ppElement(e: Element): string {
  return ppcElement(prettyConfigPP, e);
}

/** Pretty printing content */
export function ppContent(x: Content): string {
  return ppcContent(prettyConfigPP, x);
}

/** Pretty printing renders XML documents faithfully, with the exception that whitespace may be added/removed in non-verbatim character data. */
export function ppcTopElement(c: ConfigPP, e: Element): string {
  return [xml_header, ppcElement(c, e)].map((l) => l + "\n").join("");
}

/** Pretty printing elements */
export function ppcElement(c: ConfigPP, e: Element): string {
  return ppElementS(c, "", e, "");
}

/** Pretty printing content */
export function ppcContent(c: ConfigPP, x: Content): string {
  return ppContentS(c, "", x, "");
}

/** Pretty printing character data */
export function ppcCData(c: ConfigPP, x: CData): string {
  return ppCDataS(c, "", x, "");
}

/** Pretty printing content using ShowS */
export function ppContentS(c: ConfigPP, i: string, x: Content, xs: string): string {
  switch (x.tag) {
    case "Elem": return ppElementS(c, i, x._0, xs);
    case "Text": return ppCDataS(c, i, x._0, xs);
    case "CRef": return showCRefS(x._0, xs);
  }
}

/** Pretty printing elements using ShowS */
export function ppElementS(c: ConfigPP, i: string, e: Element, xs: string): string {
  const name = e.elName;
  const body = (): string => {
    const cs = e.elContent;
    if (cs.length === 0) {
      if (name.qName.startsWith("?")) return " ?>" + xs;
      if (c.shortEmptyTag(name)) return " />" + xs;
    }
    if (cs.length === 1 && cs[0].tag === "Text") return ">" + ppCDataS(c, "", cs[0]._0, tagEnd(name, xs));
    const [nl, sp] = c.prettify ? ["\n", "  "] : ["", ""];
    // foldr ppSub (i ++ tagEnd name xs) cs, where ppSub e1 = ppContentS c (sp ++ i) e1 . showString nl
    let acc = i + tagEnd(name, xs);
    for (let k = cs.length - 1; k >= 0; k--) acc = ppContentS(c, sp + i, cs[k], nl + acc);
    return ">" + nl + acc;
  };
  return i + tagStart(name, e.elAttribs, body());
}

/** Pretty printing character data using ShowS */
export function ppCDataS(c: ConfigPP, i: string, t: CData, xs: string): string {
  if (t.cdVerbatim !== "CDataText" || !c.prettify) return i + showCDataS(t, xs);
  // foldr cons xs (showCData t), where a newline is followed by the indentation.
  return i + showCData(t).replace(/\n/g, "\n" + i) + xs;
}

// --------------------------------------------------------------------------------

/** Adds the `<?xml?>` header. */
export function showTopElement(c: Element): string {
  return xml_header + showElement(c);
}

export function showContent(c: Content): string {
  return ppContentS(defaultConfigPP, "", c, "");
}

export function showElement(c: Element): string {
  return ppElementS(defaultConfigPP, "", c, "");
}

export function showCData(c: CData): string {
  return ppCDataS(defaultConfigPP, "", c, "");
}

/** Note: crefs should not contain '&', ';', etc. */
export function showCRefS(r: string, xs: string): string {
  return "&" + r + ";" + xs;
}

/** Convert a text element to characters. */
export function showCDataS(cd: CData, xs: string): string {
  switch (cd.cdVerbatim) {
    case "CDataText": return escStr(cd.cdData, xs);
    case "CDataVerbatim": return "<![CDATA[" + escCData(cd.cdData) + "]]>" + xs;
    case "CDataRaw": return cd.cdData + xs;
  }
}

// --------------------------------------------------------------------------------

/** Split `]]>` in verbatim character data across two CDATA sections. */
export function escCData(cs: string): string {
  return cs.split("]]>").join("]]]]><![CDATA[>");
}

/** Escape one character. */
export function escChar(c: string): string {
  switch (c) {
    case "<": return "&lt;";
    case ">": return "&gt;";
    case "&": return "&amp;";
    case '"': return "&quot;";
    // we use &#39 instead of &apos; because IE apparently has difficulties
    // rendering &apos; in xhtml.
    // Reported by Rohan Drape <rohan.drape@gmail.com>.
    case "'": return "&#39;";
    default: {
      // XXX: Is this really wortherd?
      // We could deal with these issues when we convert characters to bytes.
      const oc = c.codePointAt(0)!;
      if ((oc >= 0x20 && oc < 0x7f) || c === "\n" || c === "\r") return c;
      return "&#" + String(oc) + ";";
    }
  }
}

/** Escape a string (characters are code points). */
export function escStr(cs: string, rs: string): string {
  let out = "";
  for (const c of cs) out += escChar(c);
  return out + rs;
}

export function tagEnd(qn: QName, rs: string): string {
  return "</" + showQName(qn) + ">" + rs;
}

export function tagStart(qn: QName, as: readonly Attr[], rs: string): string {
  const as_str = as.length === 0 ? "" : " " + as.map(showAttr).join(" ");
  return "<" + showQName(qn) + as_str + rs;
}

export function showAttr(a: Attr): string {
  return showQName(a.attrKey) + "=" + '"' + escStr(a.attrVal, '"');
}

export function showQName(q: QName): string {
  const pre = q.qPrefix.tag === "Nothing" ? "" : q.qPrefix.value + ":";
  return pre + q.qName;
}
