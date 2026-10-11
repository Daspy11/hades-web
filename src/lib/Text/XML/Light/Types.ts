/**
 * Haskell `Text.XML.Light.Types` (package `xml`): basic XML types.
 *
 * Representation follows PORTING.md: `Content` is a tagged union (`Elem`, `Text`, `CRef`),
 * the records are interfaces with constructor functions, `CDataKind` is a string enumeration
 * and `Maybe` fields are explicit `Maybe` values. `String` is `string`; `Line` is a number.
 *
 * `QName` has hand-written `Eq` and `Ord` instances (the prefix is only compared when neither
 * name has a URI). Build names with `QName(...)` (or `unqual`, `blank_name`): the constructed
 * objects carry the instances on their prototype, so the generic `compare`/`equals` and maps
 * keyed by names behave as in Haskell. Do not spread a `QName` into a new object literal; use
 * `QName(q.qName, q.qURI, prefix)` instead.
 */
import { compare, EqSym, OrdSym, type Ordering } from "../../../Data/Ord";
import { Nothing, type Maybe } from "../../../Data/Maybe";

/** A line is an Integer */
export type Line = number;

/** XML content */
export type Content =
  | { readonly tag: "Elem"; readonly _0: Element }
  | { readonly tag: "Text"; readonly _0: CData }
  | { readonly tag: "CRef"; readonly _0: string };
export function Elem(_0: Element): Content {
  return { tag: "Elem", _0 };
}
export function Text(_0: CData): Content {
  return { tag: "Text", _0 };
}
export function CRef(_0: string): Content {
  return { tag: "CRef", _0 };
}

/** XML elements */
export interface Element {
  readonly elName: QName;
  readonly elAttribs: readonly Attr[];
  readonly elContent: readonly Content[];
  readonly elLine: Maybe<Line>;
}
export function Element(
  elName: QName,
  elAttribs: readonly Attr[],
  elContent: readonly Content[],
  elLine: Maybe<Line>,
): Element {
  return { elName, elAttribs, elContent, elLine };
}

/** XML attributes */
export interface Attr {
  readonly attrKey: QName;
  readonly attrVal: string;
}
export function Attr(attrKey: QName, attrVal: string): Attr {
  return { attrKey, attrVal };
}

/** XML CData */
export interface CData {
  readonly cdVerbatim: CDataKind;
  readonly cdData: string;
  readonly cdLine: Maybe<Line>;
}
export function CData(cdVerbatim: CDataKind, cdData: string, cdLine: Maybe<Line>): CData {
  return { cdVerbatim, cdData, cdLine };
}

export type CDataKind =
  /** Ordinary character data; pretty printer escapes &, < etc. */
  | "CDataText"
  /** Unescaped character data; pretty printer embeds it in <![CDATA[.. */
  | "CDataVerbatim"
  /** As-is character data; pretty printer passes it along without any escaping or CDATA wrap-up. */
  | "CDataRaw";
export const cDataKindValues: readonly CDataKind[] = ["CDataText", "CDataVerbatim", "CDataRaw"];

/** XML qualified names */
export interface QName {
  readonly qName: string;
  readonly qURI: Maybe<string>;
  readonly qPrefix: Maybe<string>;
}

/** `instance Ord QName` */
export function compareQName(q1: QName, q2: QName): Ordering {
  const x = compare(q1.qName, q2.qName);
  if (x !== 0) return x;
  if (q1.qURI.tag === "Nothing" && q2.qURI.tag === "Nothing") return compare(q1.qPrefix, q2.qPrefix);
  return compare(q1.qURI, q2.qURI);
}

/** `instance Eq QName`: `q1 == q2 = compare q1 q2 == EQ` */
export function eqQName(q1: QName, q2: QName): boolean {
  return compareQName(q1, q2) === 0;
}

function isQName(v: unknown): v is QName {
  return typeof v === "object" && v !== null && typeof (v as any).qName === "string" && "qURI" in v && "qPrefix" in v;
}

/** Shared prototype giving constructed names the Haskell `Eq` and `Ord` instances. */
const qNameProto = {
  [EqSym](this: QName, other: unknown): boolean {
    return isQName(other) && compareQName(this, other) === 0;
  },
  [OrdSym](this: QName, other: unknown): Ordering {
    return compareQName(this, other as QName);
  },
};

export function QName(qName: string, qURI: Maybe<string>, qPrefix: Maybe<string>): QName {
  return Object.freeze(Object.assign(Object.create(qNameProto) as object, { qName, qURI, qPrefix })) as QName;
}

// blank elements --------------------------------------------------------------

/** Blank names */
export const blank_name: QName = QName("", Nothing, Nothing);

/** Blank cdata */
export const blank_cdata: CData = CData("CDataText", "", Nothing);

/** Blank elements */
export const blank_element: Element = Element(blank_name, [], [], Nothing);
