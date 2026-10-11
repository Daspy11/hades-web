// Ported from hades/src/Model/Report/Docx/Utils.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Utility functions for manipulating XML files.
 */
import * as X from "@/lib/Text/XML/Light";
import * as XC from "@/lib/Text/XML/Light/Cursor";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";

/** Create a qualified name, The arguments are the name space and the node name. */
export function qual(ns: string, nm: string): X.QName {
  return X.QName(nm, Nothing, Just(ns));
}

/** Go to the root, and then as far left as possible. */
export function goStart(c: XC.Cursor): XC.Cursor {
  const repeatWhile = <V>(f: (v: V) => Maybe<V>, v: V): V => {
    let cur = v;
    for (;;) {
      const v1 = f(cur);
      if (v1.tag === "Nothing") return cur;
      cur = v1.value;
    }
  };
  return repeatWhile(XC.left, XC.root(c));
}

/** Apply all the functions in order, ignoring any failures. */
export function applyAll<A>(fs: readonly ((a: A) => Maybe<A>)[], v: A): A {
  let cur = v;
  for (const f of fs) {
    const v2 = f(cur);
    if (v2.tag === "Just") cur = v2.value;
  }
  return cur;
}

/** Find the next content (in depth-first order) satisfying the predicate */
export function findDF(f: (c: X.Content) => boolean, c: XC.Cursor): Maybe<XC.Cursor> {
  let cur = c;
  for (;;) {
    if (f(cur.current)) return Just(cur);
    const n = XC.nextDF(cur);
    if (n.tag === "Nothing") return Nothing;
    cur = n.value;
  }
}

/** Find the next element with this name. */
export function findNameDF(qn: X.QName, c: XC.Cursor): Maybe<XC.Cursor> {
  const p = (x: X.Content): boolean => x.tag === "Elem" && isNamed(qn, x._0);
  return findDF(p, c);
}

/**
 * True if the element has the given name. Ignores the URI and focuses on the namespace, unlike
 * the Eq instance.
 */
export function isNamed(qn: X.QName, e: X.Element): boolean {
  return nameEq(e.elName, qn);
}

/** True if the two qualified names share the same namespace and name. Ignores the URI. */
export function nameEq(x: X.QName, y: X.QName): boolean {
  return x.qName === y.qName && equals(x.qPrefix, y.qPrefix);
}

/** If this is an element then set its content to the string. Otherwise do nothing. */
export function setElemText(str: string, v: X.Content): X.Content {
  if (v.tag !== "Elem") return v;
  const e = v._0;
  return X.Elem(X.Element(e.elName, e.elAttribs, [X.Text(X.CData("CDataText", str, Nothing))], e.elLine));
}
