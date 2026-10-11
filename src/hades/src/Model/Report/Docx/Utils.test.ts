import { describe, expect, test } from "vitest";
import * as X from "@/lib/Text/XML/Light";
import * as XC from "@/lib/Text/XML/Light/Cursor";
import { Just, Nothing, fromJust } from "@/lib/Data/Maybe";
import { compare, equals } from "@/lib/Data/Ord";
import { applyAll, findDF, findNameDF, goStart, isNamed, nameEq, qual, setElemText } from "./Utils";

const w = (nm: string) => qual("w", nm);
const txt = (s: string) => X.Text(X.CData("CDataText", s, Nothing));

/** <w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:p/><w:sectPr/></w:body></w:document> */
const doc: X.Element = X.node(w("document"), [
  X.node(w("body"), [
    X.node(w("p"), [X.node(w("r"), [X.node(w("t"), "Hello")])]),
    X.node(w("p"), null),
    X.node(w("sectPr"), null),
  ]),
]);

const nameOf = (c: XC.Cursor) => (c.current.tag === "Elem" ? c.current._0.elName.qName : c.current.tag);

describe("XML names", () => {
  test("qual and nameEq ignore the URI", () => {
    const q = qual("w", "p");
    expect(q.qName).toBe("p");
    expect(q.qPrefix).toEqual(Just("w"));
    expect(q.qURI).toEqual(Nothing);
    const withUri = X.QName("p", Just("http://schemas.openxmlformats.org/wordprocessingml/2006/main"), Just("w"));
    expect(nameEq(withUri, q)).toBe(true);
    expect(nameEq(X.QName("p", Nothing, Just("v")), q)).toBe(false);
    expect(nameEq(X.unqual("p"), q)).toBe(false);
    // The Eq instance compares URIs, not prefixes, when there is a URI.
    expect(equals(withUri, q)).toBe(false);
    expect(equals(withUri, X.QName("p", withUri.qURI, Just("other")))).toBe(true);
    expect(X.eqQName(X.unqual("a"), X.QName("a", Nothing, Nothing))).toBe(true);
    expect(compare(X.unqual("a"), X.unqual("b"))).toBe(-1);
    expect(isNamed(w("document"), doc)).toBe(true);
  });
});

describe("cursor utilities", () => {
  test("findDF and findNameDF search depth first", () => {
    const c = XC.fromElement(doc);
    const t = fromJust(findNameDF(w("t"), c));
    expect(nameOf(t)).toBe("t");
    expect(t.parents.map(([, tag]) => tag.tagName.qName)).toEqual(["r", "p", "body", "document"]);
    const secondP = fromJust(findNameDF(w("p"), fromJust(XC.nextDF(fromJust(findNameDF(w("p"), c))))));
    expect(XC.getNodeIndex(secondP)).toBe(1);
    expect(findNameDF(w("tbl"), c)).toEqual(Nothing);
    const text = fromJust(findDF((x) => x.tag === "Text", c));
    expect(text.current).toEqual(txt("Hello"));
  });

  test("goStart returns to the start of the document", () => {
    const t = fromJust(findNameDF(w("t"), XC.fromElement(doc)));
    const s = goStart(t);
    expect(XC.isRoot(s)).toBe(true);
    expect(XC.isFirst(s)).toBe(true);
    expect(s.current).toEqual(X.Elem(doc));
    const forest = fromJust(XC.fromForest([txt("a"), X.Elem(doc), txt("b")]));
    const inner = fromJust(findNameDF(w("sectPr"), forest));
    expect(goStart(inner).current).toEqual(txt("a"));
  });

  test("applyAll ignores failures", () => {
    const c = XC.fromElement(doc);
    const r = applyAll([XC.firstChild, XC.parent, XC.firstChild, XC.firstChild, (x) => XC.getChild(2, x), XC.right], c);
    // firstChild -> body; parent -> document; firstChild -> body; firstChild -> p; getChild 2 fails; right -> p
    expect(nameOf(r)).toBe("p");
    expect(XC.getNodeIndex(r)).toBe(1);
    expect(applyAll([], 3)).toBe(3);
  });

  test("setElemText replaces element content and edits round trip through the cursor", () => {
    const t = fromJust(findNameDF(w("t"), XC.fromElement(doc)));
    const t2 = XC.modifyContent((x) => setElemText("Bye", x), t);
    const updated = XC.toTree(t2);
    const again = fromJust(findNameDF(w("t"), XC.fromContent(updated)));
    expect(again.current.tag === "Elem" && again.current._0.elContent).toEqual([txt("Bye")]);
    expect(setElemText("x", txt("y"))).toEqual(txt("y"));
    // Everything else is unchanged.
    expect(XC.toTree(XC.fromElement(doc))).toEqual(X.Elem(doc));
  });
});

describe("Text.XML.Light.Cursor", () => {
  test("navigation and editing", () => {
    const body = fromJust(XC.firstChild(XC.fromElement(doc)));
    expect(XC.hasChildren(body)).toBe(true);
    const last = fromJust(XC.lastChild(body));
    expect(nameOf(last)).toBe("sectPr");
    expect(XC.isLast(last)).toBe(true);
    expect(nameOf(fromJust(XC.left(last)))).toBe("p");
    expect(nameOf(fromJust(XC.findLeft((c) => XC.isFirst(c), last)))).toBe("p");
    expect(XC.getNodeIndex(fromJust(XC.findLeft((c) => XC.isFirst(c), last)))).toBe(0);
    expect(nameOf(fromJust(XC.findChild((c) => nameOf(c) === "sectPr", body)))).toBe("sectPr");
    const inserted = XC.insertGoLeft(X.Elem(X.unode("tbl", null)), last);
    const bodyAfter = fromJust(XC.parent(inserted));
    const kids = bodyAfter.current.tag === "Elem" ? bodyAfter.current._0.elContent : [];
    expect(kids.map((k) => (k.tag === "Elem" ? k._0.elName.qName : k.tag))).toEqual(["p", "p", "tbl", "sectPr"]);
    const removed = fromJust(XC.removeGoUp(inserted));
    const kids2 = removed.current.tag === "Elem" ? removed.current._0.elContent : [];
    expect(kids2.map((k) => (k.tag === "Elem" ? k._0.elName.qName : k.tag))).toEqual(["p", "p", "sectPr"]);
    const many = XC.insertManyLeft([txt("1"), txt("2")], last);
    expect(XC.toForest(many)).toHaveLength(1);
    const kids3 = fromJust(XC.parent(many)).current;
    expect(kids3.tag === "Elem" && kids3._0.elContent.slice(2, 4)).toEqual([txt("1"), txt("2")]);
    expect(XC.insertLastChild(txt("z"), XC.fromContent(txt("q")))).toEqual(Nothing);
    expect(XC.isLeaf(XC.fromContent(txt("q")))).toBe(true);
    const withChild = fromJust(XC.insertLastChild(txt("z"), last));
    expect(withChild.current.tag === "Elem" && withChild.current._0.elContent).toEqual([txt("z")]);
  });

  test("node builds elements from each argument type", () => {
    const a = X.Attr(X.unqual("k"), "v");
    expect(X.unode("e", null)).toEqual(X.Element(X.unqual("e"), [], [], Nothing));
    expect(X.unode("e", a).elAttribs).toEqual([a]);
    expect(X.unode("e", [a, a]).elAttribs).toEqual([a, a]);
    expect(X.unode("e", "hi").elContent).toEqual([txt("hi")]);
    expect(X.unode("e", "").elContent).toEqual([txt("")]);
    expect(X.unode("e", []).elContent).toEqual([]);
    expect(X.unode("e", [[a], "x"]).elAttribs).toEqual([a]);
    expect(X.unode("e", [a, "x"]).elContent).toEqual([txt("x")]);
    expect(X.unode("e", [[a], [X.unode("c", null)]]).elContent).toEqual([X.Elem(X.unode("c", null))]);
    expect(X.unode("e", X.CData("CDataRaw", "r", Nothing)).elContent).toEqual([X.Text(X.CData("CDataRaw", "r", Nothing))]);
    expect(X.add_attr(a, X.unode("e", null)).elAttribs).toEqual([a]);
  });
});
