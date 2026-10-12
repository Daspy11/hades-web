/**
 * Haskell `Text.XML.Light.Proc` (package `xml`, version 1.3.14): functions for processing XML
 * elements. Re-exported by `Text.XML.Light` (`import * as X from "@/lib/Text/XML/Light"`).
 *
 * Names are compared with the Haskell `Eq QName` instance (`eqQName`).
 */
import { Just, Nothing, type Maybe } from "../../../Data/Maybe";
import { eqQName, type Attr, type CData, type Content, type Element, type QName } from "./Types";

function listToMaybe<A>(xs: readonly A[]): Maybe<A> {
  return xs.length === 0 ? Nothing : Just(xs[0]);
}

/**
 * Get the text value of an XML element. This function ignores non-text elements, and
 * concatenates all text elements.
 */
export function strContent(e: Element): string {
  return onlyText(e.elContent).map((x) => x.cdData).join("");
}

/** Select only the elements from a list of XML content. */
export function onlyElems(xs: readonly Content[]): Element[] {
  const out: Element[] = [];
  for (const x of xs) if (x.tag === "Elem") out.push(x._0);
  return out;
}

/** Select only the elements from a parent. */
export function elChildren(e: Element): Element[] {
  return onlyElems(e.elContent);
}

/** Select only the text from a list of XML content. */
export function onlyText(xs: readonly Content[]): CData[] {
  const out: CData[] = [];
  for (const x of xs) if (x.tag === "Text") out.push(x._0);
  return out;
}

/** Find all immediate children with the given name. */
export function findChildren(q: QName, e: Element): Element[] {
  return filterChildren((x) => eqQName(q, x.elName), e);
}

/** Filter all immediate children wrt a given predicate. */
export function filterChildren(p: (e: Element) => boolean, e: Element): Element[] {
  return onlyElems(e.elContent).filter(p);
}

/** Filter all immediate children wrt a given predicate over their names. */
export function filterChildrenName(p: (q: QName) => boolean, e: Element): Element[] {
  return onlyElems(e.elContent).filter((x) => p(x.elName));
}

/** Find an immediate child with the given name. */
export function findChild(q: QName, e: Element): Maybe<Element> {
  return listToMaybe(findChildren(q, e));
}

/** Find an immediate child with the given name. */
export function filterChild(p: (e: Element) => boolean, e: Element): Maybe<Element> {
  return listToMaybe(filterChildren(p, e));
}

/** Find an immediate child with name matching a predicate. */
export function filterChildName(p: (q: QName) => boolean, e: Element): Maybe<Element> {
  return listToMaybe(filterChildrenName(p, e));
}

/** Find the left-most occurrence of an element matching given name. */
export function findElement(q: QName, e: Element): Maybe<Element> {
  return listToMaybe(findElements(q, e));
}

/** Filter the left-most occurrence of an element wrt. given predicate. */
export function filterElement(p: (e: Element) => boolean, e: Element): Maybe<Element> {
  return listToMaybe(filterElements(p, e));
}

/** Filter the left-most occurrence of an element wrt. given predicate. */
export function filterElementName(p: (q: QName) => boolean, e: Element): Maybe<Element> {
  return listToMaybe(filterElementsName(p, e));
}

/**
 * Find all non-nested occurances of an element. (i.e., once we have found an element, we do not
 * search for more occurances among the element's children).
 */
export function findElements(qn: QName, e: Element): Element[] {
  return filterElementsName((q) => eqQName(qn, q), e);
}

/**
 * Find all non-nested occurrences of an element wrt. given predicate. (i.e., once we have found
 * an element, we do not search for more occurances among the element's children).
 */
export function filterElements(p: (e: Element) => boolean, e: Element): Element[] {
  if (p(e)) return [e];
  return onlyElems(e.elContent).flatMap((x) => filterElements(p, x));
}

/**
 * Find all non-nested occurences of an element wrt a predicate over element names. (i.e., once
 * we have found an element, we do not search for more occurances among the element's children).
 */
export function filterElementsName(p: (q: QName) => boolean, e: Element): Element[] {
  return filterElements((x) => p(x.elName), e);
}

/** Lookup the value of an attribute. */
export function findAttr(x: QName, e: Element): Maybe<string> {
  return lookupAttr(x, e.elAttribs);
}

/** Lookup attribute name from list. */
export function lookupAttr(x: QName, as: readonly Attr[]): Maybe<string> {
  return lookupAttrBy((q) => eqQName(x, q), as);
}

/** Lookup the first attribute whose name satisfies the given predicate. */
export function lookupAttrBy(p: (q: QName) => boolean, as: readonly Attr[]): Maybe<string> {
  const a = as.find((x) => p(x.attrKey));
  return a === undefined ? Nothing : Just(a.attrVal);
}

/** Lookup the value of the first attribute whose name satisfies the given predicate. */
export function findAttrBy(p: (q: QName) => boolean, e: Element): Maybe<string> {
  return lookupAttrBy(p, e.elAttribs);
}
