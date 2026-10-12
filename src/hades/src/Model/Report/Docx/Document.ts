// Ported from hades/src/Model/Report/Docx/Document.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Word OOXML combinators
 *
 * TypeScript port
 * ---------------
 * * `DocMonad = State DocState` is a `StateCell<DocState>` passed first to the functions that
 *   use it (`newId(st)`, `addMedia(st, ...)`, `bookmark(st, ...)`, `linkExternal(st, ...)`).
 *   Run it with `const st = { state: docStart }; ...; st.state`.
 * * `(X.Node t) => t -> X.Element` arguments are `X.NodeArg` values (see `X.node`): `null` for
 *   `()`, a list of elements or attributes, a single element or attribute, a string, or a pair
 *   `[attrs, contents]`.
 * * `RelTargetType` is a string enumeration (`relTargetTypeValues`; use
 *   `enumComparator(relTargetTypeValues)` if the derived `Ord` is needed). `Relationship` is a
 *   record with the Haskell field names; `show_Relationship` is the derived `Show`.
 */
import * as M from "@/lib/Data/Map";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, catMaybes, mapMaybeValue, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { round } from "@/lib/Prelude";
import { at, lens, modifying, non, use, type Lens, type StateCell } from "@/lib/Control/Lens";
import type { FilePath } from "@/lib/System/IO";
import * as X from "@/lib/Text/XML/Light";
import * as XC from "@/lib/Text/XML/Light/Cursor";
import { show_ImageRef, type ImageRef } from "@/hades/src/Model/Report/Base";
import { goStart, nameEq, qual } from "@/hades/src/Model/Report/Docx/Utils";

type Text = T.Text;

export { qual };

// ---------------------------------------------------------------------------------------------
// Document Monad

/** Types of target for a relationship. */
export type RelTargetType = "PngTarget" | "SvgTarget" | "ExternalTarget";
export const relTargetTypeValues: readonly RelTargetType[] = ["PngTarget", "SvgTarget", "ExternalTarget"];


/**
 * A relationship with some resource.
 *
 * If "relExternal" is false then the "relTarget" must be within the Word document package.
 */
export interface Relationship {
  readonly relId: Text;
  readonly relExternal: boolean;
  /** The URI of the type as defined by ECMA-376. */
  readonly relType: Text;
  readonly relTargetType: RelTargetType;
  /** Either the internal filepath or the external URL. */
  readonly relTarget: string;
}
export function Relationship(
  relId: Text,
  relExternal: boolean,
  relType: Text,
  relTargetType: RelTargetType,
  relTarget: string,
): Relationship {
  return { relId, relExternal, relType, relTargetType, relTarget };
}

/** Derived `instance Show Relationship`. */
export function show_Relationship(r: Relationship): string {
  return "Relationship {relId = " + T.showText(r.relId) +
    ", relExternal = " + (r.relExternal ? "True" : "False") +
    ", relType = " + T.showText(r.relType) +
    ", relTargetType = " + r.relTargetType +
    ", relTarget = " + T.showText(r.relTarget) + "}";
}


/** An XML version of the relationship suitable for placing in an OOXML Relationships file. */
export function relationshipXml(r: Relationship): X.Element {
  const attrs1 = [
    X.Attr(X.unqual("Id"), r.relId),
    X.Attr(X.unqual("Type"), r.relType),
    X.Attr(X.unqual("Target"), r.relTarget),
  ];
  const attrs = r.relExternal ? [X.Attr(X.unqual("TargetMode"), "External"), ...attrs1] : attrs1;
  return X.unode("Relationship", attrs);
}

/** The document generator state. */
export interface DocState {
  readonly _idCount: number;
  readonly _internalRelationships: M.Map<ImageRef, readonly Relationship[]>;
  readonly _externalRelationships: readonly Relationship[];
}
export function DocState(
  _idCount: number,
  _internalRelationships: M.Map<ImageRef, readonly Relationship[]>,
  _externalRelationships: readonly Relationship[],
): DocState {
  return { _idCount, _internalRelationships, _externalRelationships };
}

/** Debugging aid: the state as text (no Haskell `Show` instance). */
export function describeDocState(s: DocState): string {
  return "DocState " + String(s._idCount) + " [" +
    M.toList(s._internalRelationships).map(([k, rs]) => show_ImageRef(k) + ": " + rs.map(show_Relationship).join(", ")).join("; ") +
    "] [" + s._externalRelationships.map(show_Relationship).join(", ") + "]";
}


export const idCount: Lens<DocState, number> =
  lens((s: DocState) => s._idCount, (s, n: number) => ({ ...s, _idCount: n }));


/**
 * Map of image resources to document relationships. An image may have multiple resources,
 * such as an SVG file with a PNG fallback.
 */
export const internalRelationships: Lens<DocState, M.Map<ImageRef, readonly Relationship[]>> =
  lens(
    (s: DocState) => s._internalRelationships,
    (s, rs: M.Map<ImageRef, readonly Relationship[]>) => ({ ...s, _internalRelationships: rs }),
  );


/**
 * A convenient lens for accessing the relationships, if any, associated with an ImageRef.
 * (Not exported by the Haskell module.)
 */
export function internalRelationshipsAt(r: ImageRef): Lens<DocState, readonly Relationship[]> {
  return internalRelationships.dot(at<ImageRef, readonly Relationship[]>(r)).dot(non<readonly Relationship[]>([]));
}


/** List of external document relationships. */
export const externalRelationships: Lens<DocState, readonly Relationship[]> =
  lens((s: DocState) => s._externalRelationships, (s, rs: readonly Relationship[]) => ({ ...s, _externalRelationships: rs }));


/** The initial state for the document monad. */
export const docStart: DocState = DocState(0, M.empty(), []);


/** Document generation requires the tracking of state. (`State DocState`.) */
export type DocMonad = StateCell<DocState>;


/** The type of a related file, as defined by ECMA-376 Part 1. */
export type EcmaType = Text;


/** Type for images. */
export const ecmaImage: EcmaType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";


/** Type for external resources. (Not exported by the Haskell module.) */
export const ecmaExternal: EcmaType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";


/** Get a new decimal identifier which is unique in this document. */
export function newId(st: DocMonad): Text {
  const n = use(st, idCount);
  modifying(st, idCount, (x: number) => x + 1);
  return T.pack(String(n));
}


/** Add a relationship to an internal media file. */
export function addMedia(st: DocMonad, imgRef: ImageRef, typ: EcmaType, targetType: RelTargetType): void {
  const suffix = targetType === "PngTarget" ? "png" : targetType === "SvgTarget" ? "svg" : "";
  const rId = "dsmId" + newId(st);
  const rel = Relationship(rId, false, typ, targetType, addExt("media/image-" + T.unpack(rId), suffix));
  modifying(st, internalRelationshipsAt(imgRef), (rs: readonly Relationship[]) => [rel, ...rs]);
}


/** `System.FilePath.(<.>)`: add an extension (none if it is empty). */
function addExt(file: FilePath, ext: string): FilePath {
  if (ext === "") return file;
  return ext.startsWith(".") ? file + ext : file + "." + ext;
}


/** Get a reference to an internal media file, if one exists. */
export function getMediaRef(st: DocMonad, imgRef: ImageRef, targetType: RelTargetType): Maybe<Relationship> {
  const existing = use(st, internalRelationshipsAt(imgRef));
  const r = existing.find((x) => targetType === x.relTargetType);
  return r === undefined ? Nothing : Just(r);
}


/** Add an external relationship to a URL and return it. */
export function addExternal(st: DocMonad, url: FilePath): Relationship {
  const rId = "dsmId" + newId(st);
  const rel = Relationship(rId, true, ecmaExternal, "ExternalTarget", url);
  modifying(st, externalRelationships, (rs: readonly Relationship[]) => [rel, ...rs]);
  return rel;
}


// ---------------------------------------------------------------------------------------------
// Mung other XML files

/** Search the style file for a style with the given @styleId@. */
export function getStyleById(style: Text, contents: readonly X.Content[]): Maybe<X.Element> {
  const c1 = XC.fromForest(contents);
  if (c1.tag === "Nothing") return Nothing;
  const c2 = XC.findRec((c) => atNamedStyle(style, c), c1.value);
  if (c2.tag === "Nothing") return Nothing;
  const cur = c2.value.current;
  return cur.tag === "Elem" ? Just(cur._0) : Nothing; // Should never happen. However previous actions could fail.
}


/**
 * Add a style to the \"styles.xml\" file, if it is not already present. Returns @Nothing@
 * if the preconditions are not met.
 *
 * @param newStyle The style to add. Must be a @w:style@ node.
 * @param c The style file to edit. Must contain a @w:styles@ node.
 */
export function addMissingStyle(newStyle: X.Element, c: XC.Cursor): Maybe<XC.Cursor> {
  const atStyles = (cur: XC.Cursor): boolean =>
    cur.current.tag === "Elem" && nameEq(wName("styles"), cur.current._0.elName);
  const addStyle = (x: X.Content): X.Content => {
    if (x.tag !== "Elem") return x;
    const e = x._0;
    return X.Elem(X.Element(e.elName, e.elAttribs, [...e.elContent, X.Elem(newStyle)], e.elLine));
  };
  const n = styleId(newStyle);
  if (n.tag === "Nothing") return Nothing;
  // Maybe monad
  const c1 = XC.findRec(atStyles, goStart(c));
  if (c1.tag === "Nothing") return Nothing;
  return Just(
    XC.findChild((x) => atNamedStyle(n.value, x), c1.value).tag === "Just"
      ? c
      : XC.modifyContent(addStyle, c1.value),
  );
}


/** True if the cursor is at a style with the given styleId. */
export function atNamedStyle(nm: Text, c: XC.Cursor): boolean {
  const cur = c.current;
  if (cur.tag !== "Elem") return false;
  const el = cur._0;
  return nameEq(wName("style"), el.elName) && equals(styleId(el), Just(nm));
}


/** The styleId attribute of the element, if any. */
export function styleId(e: X.Element): Maybe<Text> {
  const a = e.elAttribs.find((x) => nameEq(wName("styleId"), x.attrKey));
  return mapMaybeValue((x: X.Attr) => T.pack(x.attrVal), a === undefined ? Nothing : Just(a));
}


/** Style names hard-coded into the DSM report generator */
export const dsmStyleNames: readonly Text[] = ["Caption", "Compact", "Matrix", "Hyperlink"];
// The user may have other paragraph styles, but "Matrix" is the only table style.


/**
 * "show" for text. The argument is shown as Haskell would: numbers as `Int`, strings quoted,
 * booleans as `True`/`False`.
 */
export function tShow(a: number | string | boolean): Text {
  if (typeof a === "string") return T.showText(a);
  if (typeof a === "boolean") return a ? "True" : "False";
  return T.pack(String(a));
}



// ---------------------------------------------------------------------------------------------
// Word Namespace

/** Create a node with the qualified name. */
export function qNode(ns: string, nm: string, t: X.NodeArg): X.Element {
  return X.node(qual(ns, nm), t);
}


/** Attribute with a qualified name for Word XML. */
export function wAttr(nm: Text, v: Text): X.Attr {
  return X.Attr(wName(nm), T.unpack(v));
}


/** Qualfiied name for a Word XML node. */
export function wName(n: Text): X.QName {
  return qual("w", T.unpack(n));
}


// ---------------------------------------------------------------------------------------------
// Basic Combinators

/** The top level declaration for a Document part. */
export function wordDocType(t: X.Element): X.Element {
  const attr = [
    // nameSpace "xsi" "http://www.w3.org/2001/XMLSchema-instance",
    nameSpace("wpc", "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"),
    nameSpace("cx", "http://schemas.microsoft.com/office/drawing/2014/chartex"),
    nameSpace("cx1", "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex"),
    nameSpace("cx2", "http://schemas.microsoft.com/office/drawing/2015/10/21/chartex"),
    nameSpace("cx3", "http://schemas.microsoft.com/office/drawing/2016/5/9/chartex"),
    nameSpace("cx4", "http://schemas.microsoft.com/office/drawing/2016/5/10/chartex"),
    nameSpace("cx5", "http://schemas.microsoft.com/office/drawing/2016/5/11/chartex"),
    nameSpace("cx6", "http://schemas.microsoft.com/office/drawing/2016/5/12/chartex"),
    nameSpace("cx7", "http://schemas.microsoft.com/office/drawing/2016/5/13/chartex"),
    nameSpace("cx8", "http://schemas.microsoft.com/office/drawing/2016/5/14/chartex"),
    nameSpace("mc", "http://schemas.openxmlformats.org/markup-compatibility/2006"),
    nameSpace("aink", "http://schemas.microsoft.com/office/drawing/2016/ink"),
    nameSpace("am3d", "http://schemas.microsoft.com/office/drawing/2017/model3d"),
    nameSpace("o", "urn:schemas-microsoft-com:office:office"),
    nameSpace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"),
    nameSpace("m", "http://schemas.openxmlformats.org/officeDocument/2006/math"),
    nameSpace("v", "urn:schemas-microsoft-com:vml"),
    nameSpace("wp14", "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"),
    nameSpace("wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"),
    nameSpace("w10", "urn:schemas-microsoft-com:office:word"),
    nameSpace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main"),
    nameSpace("w14", "http://schemas.microsoft.com/office/word/2010/wordml"),
    nameSpace("w15", "http://schemas.microsoft.com/office/word/2012/wordml"),
    nameSpace("w16cid", "http://schemas.microsoft.com/office/word/2016/wordml/cid"),
    nameSpace("w16se", "http://schemas.microsoft.com/office/word/2015/wordml/symex"),
    nameSpace("wpg", "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"),
    nameSpace("wpi", "http://schemas.microsoft.com/office/word/2010/wordprocessingInk"),
    nameSpace("wne", "http://schemas.microsoft.com/office/word/2006/wordml"),
    nameSpace("wps", "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"),
    X.Attr(qual("mc", "Ignorable"), "w14 w15 w16se w16cid wp14"),
    /* , X.Attr
        (qual "xsi" "schemaLocation")
        "http://purl.oclc.org/ooxml/wordprocessingml/main \
          \ /home/paul/packages/ooxml/wml.xsd\n\
        \http://purl.oclc.org/ooxml/drawingml/main \
          \ /home/paul/packages/ooxml/dml-main.xsd"  */
  ];
  // The schemaLocation attribute and xsi namesapce are for debugging purposes.
  return X.node(wName("document"), [attr, t]);
}

/** XML namespace declaration attribute. */
export function nameSpace(str: string, v: string): X.Attr {
  return X.Attr(qual("xmlns", str), v);
}


/** Property to keep this paragraph with the next one. */
export const keepNext: X.Element = X.node(wName("keepNext"), null);


/** Document main body. */
export function wBody(t: X.NodeArg): X.Element {
  return X.node(wName("body"), t);
}


/** Section properties. */
export function sectPr(t: X.NodeArg): X.Element {
  return X.node(wName("sectPr"), t);
}

/**
 * Page size. Width, height, orientation. Measurements are in points.
 * Orientation is True for landscape, False for portrait.
 */
export function pgSz(w: Maybe<number>, h: Maybe<number>, o: Maybe<boolean>): X.Element {
  const r = (x: number): number => round(x);
  const w1 = mapMaybeValue((x: number) => wAttr("w", T.pack(String(r(x * 20)))), w);
  const h1 = mapMaybeValue((x: number) => wAttr("h", T.pack(String(r(x * 20)))), h);
  const o1 = mapMaybeValue((b: boolean) => wAttr("orient", b ? "landscape" : "portrait"), o);
  return X.node(wName("pgSz"), catMaybes([w1, h1, o1]));
}


/** Document paragraph. */
export function wPara(t: X.NodeArg): X.Element {
  return X.node(wName("p"), t);
}


/** Paragraph properties. */
export function pPr(t: X.NodeArg): X.Element {
  return X.node(wName("pPr"), t);
}


/** Paragraph style property. */
export function pStyle(m: Maybe<Text>): X.Element[] {
  return m.tag === "Just" ? [X.node(wName("pStyle"), wAttr("val", m.value))] : [];
}


/**
 * Indentation for this paragraph. @pIndent 0 False@ returns an empty list.
 *
 * @param level List nesting level. Text is indented 0.5 inches per level.
 * @param outdent If true, outdent the first line by one level.
 */
export function pIndent(level: number, outdent: boolean): X.Element[] {
  if (level === 0 && !outdent) return [];
  const indentIncrement = 720; // 0.5 inches in 20ths of a point.
  const wIn = [wAttr("start", tShow(level * indentIncrement))];
  const wOut = outdent ? [wAttr("hanging", T.pack(String(indentIncrement)))] : [];
  return [X.node(wName("ind"), [...wIn, ...wOut])];
}


/** Paragraph justification. Legal values include "start", "center", "end" and "both". */
export function pJc(txt: Text): X.Element {
  return X.node(wName("jc"), wAttr("val", txt));
}

/** Run of data with uniform formatting. */
export function wRun(t: X.NodeArg): X.Element {
  return X.node(wName("r"), t);
}

/** Run properties */
export function rPr(t: X.NodeArg): X.Element {
  return X.node(wName("rPr"), t);
}


/** Run style property. */
export function rStyle(txt: Text): X.Element {
  return X.node(wName("rStyle"), wAttr("val", txt));
}


/** Plain text within a run. */
export function wText(txt: Text): X.Element {
  if (T.take(1, txt) === " " || T.takeEnd(1, txt) === " ") {
    return X.node(wName("t"), [X.Attr(qual("xml", "space"), "preserve"), T.unpack(txt)]);
  }
  return X.node(wName("t"), T.unpack(txt));
}


/** Tab character within a run. */
export const wTab: X.Element = X.node(wName("tab"), null);


// ---------------------------------------------------------------------------------------------
// Links and References

/** Tag a section of text with a bookmark. */
export function bookmark(st: DocMonad, nm: Text, es: readonly X.Element[]): X.Element[] {
  const bookmarkStart = (ident: Text): X.Element =>
    X.node(wName("bookmarkStart"), [wAttr("id", ident), wAttr("name", nm)]);
  const bookmarkEnd = (ident: Text): X.Element => X.node(wName("bookmarkEnd"), wAttr("id", ident));
  const ident = newId(st);
  return [bookmarkStart(ident), ...es, bookmarkEnd(ident)];
}


/** Hyperlink to a bookmark elsewhere in the document. First argument is bookmark name. */
export function linkInternal(nm: Text, es: readonly X.Element[]): X.Element {
  return X.node(wName("hyperlink"), [[wAttr("anchor", nm)], es]);
}


/** Hyperlink to a remote URL. First argument is the target URL. */
export function linkExternal(st: DocMonad, url: Text, es: readonly X.Element[]): X.Element {
  const hyperlinkStyle = rPr(rStyle("Hyperlink"));
  const rId = addExternal(st, T.unpack(url));
  return X.node(wName("hyperlink"), [[X.Attr(qual("r", "id"), T.unpack(rId.relId))], [hyperlinkStyle, ...es]]);
}


/**
 * Insert a simple field code into the document. The field is flagged as \"dirty\" so that
 * it will be automatically recalculated when the document is loaded.
 */
export function wField(field: Text): X.Element {
  return X.node(wName("fldSimple"), [wAttr("instr", field), wAttr("dirty", "true")]);
}


// ---------------------------------------------------------------------------------------------
// Tables

/**
 * Docx Table
 *
 * @param style Table style name.
 * @param rows Table rows.
 */
export function wTbl(style: Text, rows: readonly X.Element[]): X.Element {
  const props = X.node(wName("tblPr"), [
    X.node(wName("tblStyle"), wAttr("val", style)),
    X.node(wName("tblLayout"), wAttr("type", "autofit")),
  ]);
  const grid = X.node(wName("tblGrid"), null); // No grid data defined.
  return X.node(wName("tbl"), [props, grid, ...rows]);
}

/** Table row. */
export function wTr(es: readonly X.Element[]): X.Element {
  return X.node(wName("tr"), es);
}


/** Table row properties. */
export function wTrPr(t: X.NodeArg): X.Element {
  return X.node(wName("trPr"), t);
}


/** Table header row property. */
export const wTblHeader: X.Element = X.node(wName("tblHeader"), null);


/** Table cell. */
export function wTc(t: X.NodeArg): X.Element {
  return X.node(wName("tc"), t);
}

/** Table cell properties. */
export function wTcPr(t: X.NodeArg): X.Element {
  return X.node(wName("tcPr"), t);
}


/** Horizontal cell merge table cell property. Argument is number of columns to span. */
export function wGridSpan(n: number): X.Element {
  return X.node(wName("gridSpan"), wAttr("val", T.pack(String(n))));
}


/**
 * Table cell vertical alignment property.
 * Legal arguments are "top", "bottom", "centre" or "both".
 */
export function wVAlign(txt: Text): X.Element {
  return X.node(wName("vAlign"), wAttr("val", txt));
}


/**
 * Table cell is merged with others. Argument is True if this is the first cell in the merge
 * set, False if this is a continuation of merged cells.
 */
export function wVMerge(b: boolean): X.Element {
  return b
    ? X.node(wName("vMerge"), wAttr("val", "restart"))
    : X.node(wName("vMerge"), null);
}


// ---------------------------------------------------------------------------------------------
// Drawing

/** The content is a drawing. This is treated as a Run on its own. */
export function wDrawing(t: X.NodeArg): X.Element {
  return wRun(X.node(wName("drawing"), t));
}
