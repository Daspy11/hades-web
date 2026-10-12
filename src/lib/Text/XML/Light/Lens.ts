/**
 * Haskell `Text.XML.Light.Lens` (package `lens-xml`): optics for the types of the `xml`
 * package. Use as `import * as XL from "@/lib/Text/XML/Light/Lens"`.
 *
 * Record fields have lenses named after the field with an `L` suffix (`elContentL`,
 * `qNameL`, `currentL`, ...), and the constructors of `Content` have prisms (`_Elem`, `_Text`,
 * `_CRef`). All are constants.
 *
 * `QName` values carry the Haskell `Eq`/`Ord` instances on their prototype, so the `QName`
 * lenses rebuild names with the `QName` constructor.
 */
import { Left, Right } from "../../../Data/Either";
import type { Maybe } from "../../../Data/Maybe";
import { lens, prism, type Lens, type Prism } from "../../../Control/Lens";
import { Cur, Tag, type Cursor, type Path } from "./Cursor";
import {
  Attr, CData, CRef, Elem, Element, QName, Text,
  type CDataKind, type Content, type Line,
} from "./Types";

// Content ---------------------------------------------------------------------

export const _Elem: Prism<Content, Element> = prism(
  (e: Element) => Elem(e),
  (c: Content) => (c.tag === "Elem" ? Right(c._0) : Left(c)),
);

export const _Text: Prism<Content, CData> = prism(
  (d: CData) => Text(d),
  (c: Content) => (c.tag === "Text" ? Right(c._0) : Left(c)),
);

export const _CRef: Prism<Content, string> = prism(
  (r: string) => CRef(r),
  (c: Content) => (c.tag === "CRef" ? Right(c._0) : Left(c)),
);

// Element ---------------------------------------------------------------------

export const elNameL: Lens<Element, QName> = lens(
  (e: Element) => e.elName,
  (e, n: QName) => Element(n, e.elAttribs, e.elContent, e.elLine),
);

export const elAttribsL: Lens<Element, readonly Attr[]> = lens(
  (e: Element) => e.elAttribs,
  (e, as: readonly Attr[]) => Element(e.elName, as, e.elContent, e.elLine),
);

export const elContentL: Lens<Element, readonly Content[]> = lens(
  (e: Element) => e.elContent,
  (e, cs: readonly Content[]) => Element(e.elName, e.elAttribs, cs, e.elLine),
);

export const elLineL: Lens<Element, Maybe<Line>> = lens(
  (e: Element) => e.elLine,
  (e, l: Maybe<Line>) => Element(e.elName, e.elAttribs, e.elContent, l),
);

// Attr ------------------------------------------------------------------------

export const attrKeyL: Lens<Attr, QName> = lens(
  (a: Attr) => a.attrKey,
  (a, k: QName) => Attr(k, a.attrVal),
);

export const attrValL: Lens<Attr, string> = lens(
  (a: Attr) => a.attrVal,
  (a, v: string) => Attr(a.attrKey, v),
);

// CData -----------------------------------------------------------------------

export const cdVerbatimL: Lens<CData, CDataKind> = lens(
  (d: CData) => d.cdVerbatim,
  (d, k: CDataKind) => CData(k, d.cdData, d.cdLine),
);

export const cdDataL: Lens<CData, string> = lens(
  (d: CData) => d.cdData,
  (d, s: string) => CData(d.cdVerbatim, s, d.cdLine),
);

export const cdLineL: Lens<CData, Maybe<Line>> = lens(
  (d: CData) => d.cdLine,
  (d, l: Maybe<Line>) => CData(d.cdVerbatim, d.cdData, l),
);

// QName -----------------------------------------------------------------------

export const qNameL: Lens<QName, string> = lens(
  (q: QName) => q.qName,
  (q, n: string) => QName(n, q.qURI, q.qPrefix),
);

export const qURIL: Lens<QName, Maybe<string>> = lens(
  (q: QName) => q.qURI,
  (q, u: Maybe<string>) => QName(q.qName, u, q.qPrefix),
);

export const qPrefixL: Lens<QName, Maybe<string>> = lens(
  (q: QName) => q.qPrefix,
  (q, p: Maybe<string>) => QName(q.qName, q.qURI, p),
);

// Cursor ----------------------------------------------------------------------

export const currentL: Lens<Cursor, Content> = lens(
  (c: Cursor) => c.current,
  (c, x: Content) => Cur(x, c.lefts, c.rights, c.parents),
);

export const leftsL: Lens<Cursor, readonly Content[]> = lens(
  (c: Cursor) => c.lefts,
  (c, x: readonly Content[]) => Cur(c.current, x, c.rights, c.parents),
);

export const rightsL: Lens<Cursor, readonly Content[]> = lens(
  (c: Cursor) => c.rights,
  (c, x: readonly Content[]) => Cur(c.current, c.lefts, x, c.parents),
);

export const parentsL: Lens<Cursor, Path> = lens(
  (c: Cursor) => c.parents,
  (c, x: Path) => Cur(c.current, c.lefts, c.rights, x),
);

// Tag -------------------------------------------------------------------------

export const tagNameL: Lens<Tag, QName> = lens(
  (t: Tag) => t.tagName,
  (t, n: QName) => Tag(n, t.tagAttribs, t.tagLine),
);

export const tagAttribsL: Lens<Tag, readonly Attr[]> = lens(
  (t: Tag) => t.tagAttribs,
  (t, as: readonly Attr[]) => Tag(t.tagName, as, t.tagLine),
);

export const tagLineL: Lens<Tag, Maybe<Line>> = lens(
  (t: Tag) => t.tagLine,
  (t, l: Maybe<Line>) => Tag(t.tagName, t.tagAttribs, l),
);
