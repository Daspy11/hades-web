// Ported from hades/src/Model/Report/Docx.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Generate Word files from report documents.
 *
 * TypeScript port
 * ---------------
 * * `insertDocx` and `makeDocx` are `async` (they read and write files through
 *   `@/lib/System/IO` virtual paths; a `/download/<name>` target downloads the document).
 * * The image map `Map ImageRef (BL.ByteString, Maybe BL.ByteString)` is an
 *   `M.Map<ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]>` (`ImageFiles`): the PNG version
 *   of each image and, optionally, an SVG version.
 * * The `DocMonad` (`State DocState`) functions take the `StateCell<DocState>` first
 *   (`blockToDocx(st, l, style, blk)`); `runState act docStart` is
 *   `const st = { state: docStart }; const r = act(st);` with the final state in `st.state`.
 * * Kept as in Haskell: every numbered list paragraph restarts its `LISTNUM` field (`\s 1`);
 *   matrix cells take their paragraph style from the matrix class, not the cell's; a `Span`
 *   inline makes a run inside a run; `makeDocx` adds no styles for custom classes (only
 *   `insertDocx` does); see `Model.Report.Docx.File.updateXml` for the template encoding quirk.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, fromMaybe, maybeToList, type Maybe } from "@/lib/Data/Maybe";
import type { Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import { over, preview, view } from "@/lib/Control/Lens";
import type { FilePath } from "@/lib/System/IO";
import * as X from "@/lib/Text/XML/Light";
import * as XC from "@/lib/Text/XML/Light/Cursor";
import * as XL from "@/lib/Text/XML/Light/Lens";
import { getColour } from "@/banana-ui/base/Reactive/Banana/Common";
import { DiagramRef, IconRef, type ImageRef, type ReportPageLayout } from "@/hades/src/Model/Report/Base";
import {
  Strong, type Attr, type Block, type Inline, type MatrixCell, type MatrixHeader,
} from "@/hades/src/Model/Report/Document";
import {
  addMissingStyle, bookmark, docStart, dsmStyleNames, ecmaImage, externalRelationships, getMediaRef,
  internalRelationships, linkExternal, linkInternal, pIndent, pJc, pPr, pStyle, pgSz, rPr, rStyle,
  relationshipXml, sectPr, tShow, wAttr, wBody, wField, wGridSpan, wName, wPara, wRun, wTab, wTbl,
  wTblHeader, wTc, wTcPr, wText, wTr, wTrPr, wVAlign, wVMerge, wordDocType, addMedia,
  type DocMonad, type DocState,
} from "@/hades/src/Model/Report/Docx/Document";
import { inlinePicture } from "@/hades/src/Model/Report/Docx/Drawing";
import { findNameDF, getSkeletonStyles, insertDocxFile, writeDocxFile } from "@/hades/src/Model/Report/Docx/File";
import { applyAll } from "@/hades/src/Model/Report/Docx/Utils";
import { Monoid_List, Walkable_Attr_BlockList, query } from "@/hades/src/Model/Report/Walkable";

type Text = T.Text;

/** The files to include: the PNG version of each image, and optionally an SVG version. */
export type ImageFiles = M.Map<ImageRef, readonly [Uint8Array, Maybe<Uint8Array>]>;

/** An edit to an XML file within the Word document. */
type XmlUpdate = readonly [FilePath, (c: XC.Cursor) => XC.Cursor];


/**
 * Insert document content into an existing Word file.
 *
 * @param template Existing Word file.
 * @param target File to store new document in.
 * @param blocks Content to be inserted.
 * @param imageMap Files to include.
 */
export async function insertDocx(
  template: FilePath,
  target: FilePath,
  blocks: readonly Block[],
  imageMap: ImageFiles,
): Promise<void> {
  // where ((docBody, internalFiles), result) = flip runState docStart $ do ...
  const st: DocMonad = { state: docStart };
  const [docBody, internalFiles] = ((): [X.Element[], [FilePath, Uint8Array][]] => {
    addImages(st, imageMap);
    const b = L.concat(blocks.map((blk) => blockToDocx(st, 0, Nothing, blk)));
    const fs = M.toList(imageMap).map(([ref, [png, svg]]): [FilePath, Uint8Array][] => {
      const r1 = getMediaRef(st, ref, "PngTarget");
      const f1: [FilePath, Uint8Array][] = r1.tag === "Just"
        ? [["word/" + r1.value.relTarget, png]]
        // Zip file, so deliberately not using System.Filepath.</>
        : []; // Cannot happen.
      let f2: [FilePath, Uint8Array][] = [];
      if (svg.tag === "Just") {
        const r2 = getMediaRef(st, ref, "SvgTarget");
        f2 = r2.tag === "Just" ? [["word/" + r2.value.relTarget, svg.value]] : [];
      }
      return [...f1, ...f2];
    });
    return [b, L.concat(fs)];
  })();
  const result: DocState = st.state;
  const xrefs = [
    ...view(externalRelationships, result),
    ...L.concat(M.elems(view(internalRelationships, result))),
  ];
  const rels = xrefs.map((r) => X.Elem(relationshipXml(r)));
  const addRels = (r: readonly X.Content[], c: XC.Cursor): XC.Cursor =>
    over(XL.currentL.dot(XL._Elem).dot(XL.elContentL), (cs: readonly X.Content[]) => [...r, ...cs], c);
  const styleNames = L.nub([
    ...dsmStyleNames,
    ...query(Walkable_Attr_BlockList, Monoid_List<Text>(), (a: Attr) => maybeToList(a.attrClass), blocks),
  ]);
  const isContentType = (ext: string, x: X.Content): boolean => {
    if (x.tag !== "Elem") return false;
    const e = x._0;
    const a = e.elAttribs.find((at) => "Extension" === at.attrKey.qName);
    return e.elName.qName === "Default" && a !== undefined && a.attrVal === ext;
  };
  const addMissingContentType = (extension: string, mime: string, c1: XC.Cursor): XC.Cursor => {
    const c2 = XC.findRec(
      (c) => {
        const n = preview(XL.currentL.dot(XL._Elem).dot(XL.elNameL).dot(XL.qNameL), c);
        return n.tag === "Just" && n.value === "Types";
      },
      c1,
    );
    if (c2.tag === "Nothing") return c1; // Template document is seriously broken.
    if (XC.findChild((c) => isContentType(extension, c.current), c2.value).tag === "Just") {
      return c1; // Content type already listed. Do nothing.
    }
    return over(
      XL.currentL.dot(XL._Elem).dot(XL.elContentL),
      (cs: readonly X.Content[]) => [
        X.Elem(X.unode("Default", [
          X.Attr(X.unqual("Extension"), extension),
          X.Attr(X.unqual("ContentType"), mime),
        ])),
        ...cs,
      ],
      c2.value,
    );
  };
  const defaultStyles = getSkeletonStyles(styleNames);
  const xmlUpdates: XmlUpdate[] = [
    [
      "[Content_Types].xml",
      (c) => addMissingContentType("png", "image/png", addMissingContentType("svg", "image/svg+xml", c)),
    ],
    [
      "word/_rels/document.xml.rels",
      (c) => {
        const r = findNameDF(X.unqual("Relationships"), c);
        return r.tag === "Nothing" ? c : addRels(rels, r.value);
      },
    ],
    [
      "word/document.xml",
      (c) => {
        const c1 = modifyDocumentAttrs(c);
        const c2 = c1.tag === "Nothing" ? c1 : appendBodyElements(docBody, c1.value);
        return fromMaybe(c, c2);
      },
    ],
    [
      "word/styles.xml",
      (c) => applyAll(defaultStyles.map((s) => (cur: XC.Cursor) => addMissingStyle(s, cur)), c),
    ],
  ];
  await insertDocxFile(template, target, xmlUpdates, internalFiles);
}


/** The XML namespaces that must appear in the @w.document@ node. */
export const requiredNamespaces: M.Map<string, string> = M.fromList([
  ["wpc", "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"],
  ["cx", "http://schemas.microsoft.com/office/drawing/2014/chartex"],
  ["cx1", "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex"],
  ["cx2", "http://schemas.microsoft.com/office/drawing/2015/10/21/chartex"],
  ["cx3", "http://schemas.microsoft.com/office/drawing/2016/5/9/chartex"],
  ["cx4", "http://schemas.microsoft.com/office/drawing/2016/5/10/chartex"],
  ["cx5", "http://schemas.microsoft.com/office/drawing/2016/5/11/chartex"],
  ["cx6", "http://schemas.microsoft.com/office/drawing/2016/5/12/chartex"],
  ["cx7", "http://schemas.microsoft.com/office/drawing/2016/5/13/chartex"],
  ["cx8", "http://schemas.microsoft.com/office/drawing/2016/5/14/chartex"],
  ["mc", "http://schemas.openxmlformats.org/markup-compatibility/2006"],
  ["aink", "http://schemas.microsoft.com/office/drawing/2016/ink"],
  ["am3d", "http://schemas.microsoft.com/office/drawing/2017/model3d"],
  ["o", "urn:schemas-microsoft-com:office:office"],
  ["r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"],
  ["m", "http://schemas.openxmlformats.org/officeDocument/2006/math"],
  ["v", "urn:schemas-microsoft-com:vml"],
  ["wp14", "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"],
  ["wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"],
  ["w10", "urn:schemas-microsoft-com:office:word"],
  ["w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main"],
  ["w14", "http://schemas.microsoft.com/office/word/2010/wordml"],
  ["w15", "http://schemas.microsoft.com/office/word/2012/wordml"],
  ["w16cid", "http://schemas.microsoft.com/office/word/2016/wordml/cid"],
  ["w16se", "http://schemas.microsoft.com/office/word/2015/wordml/symex"],
  ["wpg", "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"],
  ["wpi", "http://schemas.microsoft.com/office/word/2010/wordprocessingInk"],
  ["wne", "http://schemas.microsoft.com/office/word/2006/wordml"],
  ["wps", "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"],
] as [string, string][]);


/** The set of XML namespaces that can be listed as ignorable in the @w:document@ node. */
export const ignorableNamespaces: S.Set<string> = S.fromList(["w14", "w15", "w16se", "w16cid", "wp14"]);


/** Insert any missing namespaces into the @w:document@ node. */
export function modifyDocumentAttrs(c: XC.Cursor): Maybe<XC.Cursor> {
  const isDocument = (x: X.Content): boolean => isNamedElem("document", x);
  const isMcIgnorable = (x: X.QName): boolean =>
    x.qName === "Ignorable" && x.qPrefix.tag === "Just" && x.qPrefix.value === "mc";
  const addRequired = (cur: XC.Cursor): XC.Cursor => XC.modifyContent((x) => {
    if (x.tag !== "Elem") return x;
    const e = x._0;
    const [oldNs, rest1] = L.partition(
      (a: X.Attr) => a.attrKey.qPrefix.tag === "Just" && a.attrKey.qPrefix.value === "xmlns",
      e.elAttribs,
    );
    const oldNsMap = M.fromList(oldNs.map((a): [string, string] => [a.attrKey.qName, a.attrVal]));
    const [oldIgnore, rest2] = L.partition((a: X.Attr) => isMcIgnorable(a.attrKey), rest1);
    const oldIgnoreSet = oldIgnore.reduceRight(
      (acc: S.Set<string>, a) => S.union(S.fromList(T.words(a.attrVal)), acc),
      S.empty<string>(),
    );
    const newNs = M.toList(M.union(oldNsMap, requiredNamespaces)).map(([n, v]) =>
      X.Attr(X.QName(n, Nothing, Just("xmlns")), v));
    const newIgnore = X.Attr(
      X.QName("Ignorable", Nothing, Just("mc")),
      T.unwords(S.toList(S.union(oldIgnoreSet, ignorableNamespaces))),
    );
    return X.Elem(X.Element(e.elName, [...newNs, newIgnore, ...rest2], e.elContent, e.elLine));
  }, cur);
  // XC.root >>> XC.findRec (isDocument . XC.current) >>> fmap addRequired
  const found = XC.findRec((cur) => isDocument(cur.current), XC.root(c));
  return found.tag === "Nothing" ? found : Just(addRequired(found.value));
}


/**
 * Append the elements to the word document. The new elements are added at the end of the @w:body@
 * node, except that if there is a final @w:sectPr@ node then that will be preserved as the final
 * node in the @w:body@.
 */
export function appendBodyElements(newElements: readonly X.Element[], c: XC.Cursor): Maybe<XC.Cursor> {
  const isBody = (x: X.Content): boolean => isNamedElem("body", x);
  const isSectPr = (x: X.Content): boolean => isNamedElem("sectPr", x);
  const go = (x: X.Content): X.Content => {
    if (x.tag !== "Elem") return x;
    const body = x._0;
    const oldContents = body.elContent;
    // case oldContents ^? _Snoc of ...
    const [mainContents, sect] = ((): [readonly X.Content[], X.Content[]] => {
      if (oldContents.length === 0) return [oldContents, []];
      const m = oldContents.slice(0, -1);
      const s = oldContents[oldContents.length - 1];
      return isSectPr(s) ? [m, [s]] : [oldContents, []];
    })();
    return X.Elem(X.Element(
      body.elName,
      body.elAttribs,
      [...mainContents, ...newElements.map((e) => X.Elem(e)), ...sect],
      body.elLine,
    ));
  };
  // XC.root >>> XC.findRec (isBody . XC.current) >>> fmap (XC.modifyContent go)
  const found = XC.findRec((cur) => isBody(cur.current), XC.root(c));
  return found.tag === "Nothing" ? found : Just(XC.modifyContent(go, found.value));
}


/** True if the content has the @qName@ given and the namespace prefix "w". */
export function isNamedElem(nm: string, x: X.Content): boolean {
  if (x.tag !== "Elem") return false;
  const n = x._0.elName;
  return n.qName === nm && n.qPrefix.tag === "Just" && n.qPrefix.value === "w";
}


/**
 * Create a new Word file using the built-in template.
 *
 * @param title Document title.
 * @param target File to store document in.
 * @param blocks Document content.
 * @param imageMap Files to include.
 */
export async function makeDocx(
  fmt: Maybe<ReportPageLayout>,
  title: Text,
  target: FilePath,
  blocks: readonly Block[],
  imageMap: ImageFiles,
): Promise<void> {
  const addRels = (xrefs1: readonly X.Content[], c: XC.Cursor): XC.Cursor =>
    over(XL.currentL.dot(XL._Elem).dot(XL.elContentL), (cs: readonly X.Content[]) => [...xrefs1, ...cs], c);
  // Similar to X.showTopElement, but with the attributes that Word likes to see.
  const xml_header = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>";
  const wordShowTopElement = (c: X.Element): string => xml_header + X.showElement(c);
  const pageProperty = ((): X.Element[] => {
    if (fmt.tag === "Nothing") return [];
    const p = fmt.value;
    const size = ((): X.Element => {
      const paper = p._reportPagePaper;
      const landscape = p._reportPageOrientation === "Landscape";
      switch (paper) {
        case "Letter":
          return landscape
            ? pgSz(Just(11 * 72), Just(8.5 * 72), Just(true))
            : pgSz(Just(8.5 * 72), Just(11 * 72), Just(false));
        case "A4":
          return landscape
            ? pgSz(Just(841.89), Just(595.276), Just(true))
            : pgSz(Just(595.276), Just(841.89), Just(false));
        case "A3":
          return landscape
            ? pgSz(Just(1190.55), Just(841.89), Just(true))
            : pgSz(Just(841.89), Just(1190.55), Just(false));
        default:
          return absurd(paper);
      }
    })();
    return [sectPr(size)];
  })();
  // ((docBody, internalFiles), result) = flip runState docStart $ do ...
  const st: DocMonad = { state: docStart };
  const [docBody, internalFiles] = ((): [X.Element[], [FilePath, Uint8Array][]] => {
    addImages(st, imageMap);
    const b = L.concat(blocks.map((blk) => blockToDocx(st, 0, Nothing, blk)));
    const fs = M.toList(imageMap).map(([ref, [png, svg]]): [FilePath, Uint8Array][] => {
      const r1 = getMediaRef(st, ref, "PngTarget");
      const f1: [FilePath, Uint8Array][] = r1.tag === "Just"
        ? [["word/" + r1.value.relTarget, png]]
        // Zip file, so deliberately not using System.Filepath.</>
        : []; // Cannot happen.
      let f2: [FilePath, Uint8Array][] = [];
      if (svg.tag === "Just") {
        const r2 = getMediaRef(st, ref, "SvgTarget");
        f2 = r2.tag === "Just" ? [["word/" + r2.value.relTarget, svg.value]] : [];
      }
      return [...f1, ...f2];
    });
    return [b, L.concat(fs)];
  })();
  const result: DocState = st.state;
  const document = wordDocType(wBody([...docBody, ...pageProperty]));
  const xrefs = [
    ...view(externalRelationships, result),
    ...L.concat(M.elems(view(internalRelationships, result))),
  ];
  const rels = xrefs.map((r) => X.Elem(relationshipXml(r)));
  const xmlUpdates: XmlUpdate[] = [[
    "word/_rels/document.xml.rels",
    (c) => {
      const r = findNameDF(X.unqual("Relationships"), c);
      return r.tag === "Nothing" ? c : addRels(rels, r.value);
    },
  ]];
  const binaryDoc: [FilePath, Uint8Array] = ["word/document.xml", U.encodeUtf8(wordShowTopElement(document))];
  await writeDocxFile(title, target, xmlUpdates, [binaryDoc, ...internalFiles]);
}


/* Design note:

Zip files use "/" as a separator, so on Windows System.FilePath.</> does the wrong thing for paths
in zip files. The zip-archive library normalises paths with "\", but it is possible that in future
this program will extend existing template Word files rather than creating its own, which would
break any code that assumed the use of "\". Hence all zip file paths in Hades use the "/" at all
times.
*/


/** Add these images to the document state. */
export function addImages<A>(st: DocMonad, map1: M.Map<ImageRef, readonly [A, Maybe<A>]>): void {
  for (const [ref, [, svg]] of M.toList(map1)) {
    addMedia(st, ref, ecmaImage, "PngTarget");
    if (svg.tag === "Just") addMedia(st, ref, ecmaImage, "SvgTarget");
  }
}


/**
 * Generate a fragment of WordProcessingML for the block. The text argument is an optional
 * style name for the paragraphs in the block.
 *
 * @param l Indented list level of current block.
 * @param style Optional style name for paragraphs in this block.
 */
export function blockToDocx(st: DocMonad, l: number, style: Maybe<Text>, blk: Block): X.Element[] {
  switch (blk.tag) {
    // PLain
    case "Plain":
      return [wPara([pPr([...pStyle(Just("Compact")), ...pIndent(l, false)]), ...inlinesToDocx(st, [], blk._0)])];
      // Note: return :: a -> [a]
    // Para
    case "Para":
      if (l === 0 && style.tag === "Nothing") return [wPara(inlinesToDocx(st, [], blk._0))];
      return [wPara([pPr([...pStyle(style), ...pIndent(l, false)]), ...inlinesToDocx(st, [], blk._0)])];
    // Heading
    case "Heading": {
      const txt = attrBookmark(st, blk._1, inlinesToDocx(st, [], blk._2));
      const style1 = Just("Heading" + T.pack(String(blk._0)));
      return [wPara([pPr(pStyle(style1)), ...txt])];
    }
    // OrderedList
    case "OrderedList": {
      if (blk._1.length === 0) return [];
      const [blocks, ...blockss] = blk._1;
      const firstItem = listItem(st, "NumList", l + 1, style, true, blocks);
      const restItems = blockss.map((bs) => listItem(st, "NumList", l + 1, style, false, bs));
      return [...firstItem, ...L.concat(restItems)];
    }
    // UnorderedList
    case "UnorderedList":
      return L.concat(blk._0.map((bs) => listItem(st, "BulletList", l + 1, style, false, bs)));
    // DefinitionList
    case "DefinitionList": {
      const rs = blk._0.map(([term, paras]): X.Element[] => {
        const termPara = wPara([pPr([...pStyle(style), ...pIndent(l, false)]), ...inlineToDocx(st, [], Strong(term))]);
        const defParas = paras.map((p) => blockToDocx(st, l + 1, style, p));
        return [termPara, ...L.concat(defParas)];
      });
      return L.concat(rs);
    }
    // Matrix
    case "Matrix":
      return matrixToDocx(st, blk._0, blk._1, blk._2, blk._3);
    // Div
    case "Div": {
      const paras = L.concat(blk._1.map((b) => blockToDocx(st, l, blk._0.attrClass, b)));
      return attrBookmark(st, blk._0, paras);
    }
    // Picture
    case "Picture": {
      const [attr, caption, altText, size, modelId] = [blk._0, blk._1, blk._2, blk._3, blk._4];
      const drawing = inlinePicture(st, size, DiagramRef(modelId), altText);
      const c = inlinesToDocx(st, [], caption);
      const picPara = wPara([pPr(pStyle(Just("DiagramBox"))), wRun(drawing)]);
      const captionPara = wPara([
        pPr(pStyle(Just("Caption"))),
        wRun(wText("Figure ")),
        wField(" SEQ Figure \\* ARABIC "),
        wRun(wText(": ")),
        ...c,
      ]);
      return attrBookmark(st, attr, [picPara, captionPara]);
    }
    // Null
    case "Null":
      return [];
    default:
      return absurd(blk);
  }
}


/** Internal type for numbered or bulleted lists. */
export type ListType = "NumList" | "BulletList";
export const listTypeValues: readonly ListType[] = ["NumList", "BulletList"];


/**
 * Numbered item. First paragraph is outdented with the number, the rest are just
 * indented.
 *
 * @param level Indentation level of this item.
 * @param style Optional paragraph style.
 * @param isFirst True if this is the first item in the list, so restart numbering.
 */
export function listItem(
  st: DocMonad,
  typ: ListType,
  level: number,
  style: Maybe<Text>,
  isFirst: boolean,
  blocks: readonly Block[],
): X.Element[] {
  const numField = (restart: boolean): X.Element => {
    switch (typ) {
      case "NumList":
        return wField("LISTNUM NumberValue \\l " + tShow(level) + (restart ? " \\s 1" : ""));
      case "BulletList": {
        // concat (repeat "•◦⁃‣▪") !! max 0 (level-1)
        const bullets = Array.from("•◦⁃‣▪");
        return wText(T.singleton(bullets[Math.max(0, level - 1) % bullets.length]));
      }
      default:
        return absurd(typ);
    }
  };
  const numPara = (style1: Maybe<Text>, paraBody: readonly X.Element[]): X.Element[] => [wPara([
    pPr([...pStyle(style1), ...pIndent(level, true)]),
    wRun([numField(true), wTab]),
    ...paraBody,
  ])];
  if (blocks.length === 0) {
    return [wPara([pPr([...pStyle(style), ...pIndent(level, true)]), wRun(numField(isFirst))])];
  }
  const [firstBlock, ...restBlocks] = blocks;
  const firstPara = ((): X.Element[] => {
    switch (firstBlock.tag) {
      case "Plain": return numPara(Just("Compact"), inlinesToDocx(st, [], firstBlock._0));
      case "Para": return numPara(style, inlinesToDocx(st, [], firstBlock._0));
      default: {
        const paraBody = blockToDocx(st, level, style, firstBlock);
        return [...numPara(style, []), ...paraBody]; // Separate paragraph for number.
      }
    }
  })();
  const restParas = restBlocks.map((b) => blockToDocx(st, level, style, b));
  return [...firstPara, ...L.concat(restParas)];
}


/** Wrap the elements in a bookmark if the Attr has an identifier. */
export function attrBookmark(st: DocMonad, attr: Attr, es: readonly X.Element[]): X.Element[] {
  const ident = attr.attrIdentifier;
  if (ident.tag === "Nothing") return [...es]; // Do nothing.
  return bookmark(st, T.pack(U.toText(ident.value[0])), es);
}


/**
 * Convert a list of inlines into DocX XML markup.
 *
 * @param props Properties to apply to the text.
 * @param inlines Text.
 */
export function inlinesToDocx(st: DocMonad, props: readonly X.Element[], inlines: readonly Inline[]): X.Element[] {
  if (inlines.length === 0) return [wRun(wText(""))];
  return L.concat(inlines.map((i) => inlineToDocx(st, props, i)));
}


/**
 * Convert an Inline to DocX XML markup. (Icons not implemented yet)
 *
 * @param props Properties to apply to the text.
 */
export function inlineToDocx(st: DocMonad, props: readonly X.Element[], inline: Inline): X.Element[] {
  switch (inline.tag) {
    case "Str":
      return props.length === 0 ? [wRun(wText(inline._0))] : [wRun([rPr(props), wText(inline._0)])];
    case "Emph":
      return inlinesToDocx(st, [X.node(wName("i"), null), ...props], inline._0);
    case "Strong":
      return inlinesToDocx(st, [X.node(wName("b"), null), ...props], inline._0);
    case "Space":
      return props.length === 0 ? [wRun(wText(" "))] : [wRun([rPr(props), wText(" ")])];
    case "Link":
      return [linkInternal(T.pack(U.toText(inline._0)), inlinesToDocx(st, props, inline._1))];
    case "LinkOut": {
      const txt = inlinesToDocx(st, props, inline._1);
      const r = linkExternal(st, inline._0, txt);
      return [r];
    }
    case "Icon": {
      const r = inlinePicture(st, iconSize, IconRef(inline._0), "Icon");
      return props.length === 0 ? [wRun(r)] : [wRun([rPr(props), r])];
    }
    case "Highlight": {
      const hex = T.toUpper(C.sRGB24show(getColour(inline._0)).slice(1));
      return inlinesToDocx(
        st,
        [X.node(wName("shd"), [wAttr("fill", T.pack(hex)), wAttr("val", "clear")]), ...props],
        inline._1,
      );
    }
    case "Span": {
      const r = attrRun(st, inline._0, inline._1);
      return [r];
    }
    default:
      return absurd(inline);
  }
}


/**
 * The first class in the attribute is the run style. Other classes are ignored.
 * The elements are also bracketed by a bookmark if there is an identifier.
 */
export function attrRun(st: DocMonad, attr: Attr, inlines: readonly Inline[]): X.Element {
  // Take the first class as a style name. Ignore the rest.
  const style = maybeToList(attr.attrClass).map(rStyle);
  const ident = attr.attrIdentifier;
  const txt = ident.tag === "Nothing"
    ? inlinesToDocx(st, [], inlines)
    : bookmark(st, T.pack(U.toText(ident.value[0])), inlinesToDocx(st, [], inlines));
  return wRun([...style, ...txt]);
}


/** Size of icons within the document, in points. */
export const iconSize: readonly [number, number] = [12, 12];


/** Translate a matrix into a table in the Word document. */
export function matrixToDocx(
  st: DocMonad,
  attr: Attr,
  caption: readonly Inline[],
  headers: readonly MatrixHeader[],
  cells: readonly Tree<readonly MatrixCell[]>[],
): X.Element[] {
  const styleId: Text = fromMaybe("Matrix", attr.attrClass);
  const xmlCaption = (): X.Element => {
    const c = inlinesToDocx(st, [], caption);
    return wPara([
      pPr(pStyle(Just("Caption"))),
      wRun(wText("Table ")),
      wField(" SEQ Table \\* ARABIC "),
      wRun(wText(": ")),
      ...c,
    ]);
  };
  const headerStyle = [X.node(wName("b"), null)];
  const autoWidth = X.node(wName("tcW"), [wAttr("w", "0"), wAttr("type", "auto")]);
  // Blank cells to merge with argument list above.
  const blanks = <A>(xs: readonly A[]): X.Element[] =>
    xs.map(() => wTc([wTcPr([autoWidth, wVMerge(false)]), wPara(null)]));
  const groupHeader = (mh: MatrixHeader): [X.Element[], X.Element[]] => {
    const cols = mh.matrixHeaderColumns;
    const nameRuns = inlinesToDocx(st, headerStyle, mh.matrixHeaderName);
    const colRuns = cols.map((c) => {
      const r = inlinesToDocx(st, headerStyle, c);
      return wTc([wTcPr([autoWidth, wVAlign("center")]), wPara([pPr(pJc("center")), ...r])]);
    });
    const r1 = [wTc([
      wTcPr([autoWidth, wGridSpan(cols.length), wVAlign("center")]),
      wPara([pPr(pJc("center")), ...nameRuns]),
    ])];
    return [r1, colRuns];
  };
  const firstGroupHeader = (mh: MatrixHeader): [X.Element[], X.Element[]] => {
    const cols = mh.matrixHeaderColumns;
    const colRuns = cols.map((c) => {
      const rs = inlinesToDocx(st, headerStyle, c);
      return wTc([
        wTcPr([autoWidth, wVMerge(true), wVAlign("center")]),
        wPara([pPr(pJc("center")), ...rs]),
      ]);
    });
    return [colRuns, blanks(cols)];
  };
  const complexHeader = (): [X.Element[], X.Element[]] => {
    // Only used when headers is not empty, so "head" and ":" are safe.
    const [h1, ...hs] = headers;
    const grp1 = firstGroupHeader(h1);
    const grps = hs.map(groupHeader);
    // grp1 <> mconcat grps
    return [
      [...grp1[0], ...L.concat(grps.map((g) => g[0]))],
      [...grp1[1], ...L.concat(grps.map((g) => g[1]))],
    ];
  };
  const headerRows = (): X.Element[] => {
    if (headers.length === 0) return [];
    if (headers.length === 1) return [wTr([wTrPr(wTblHeader), ...groupHeader(headers[0])[1]])];
    const [r1, r2] = complexHeader();
    return [wTr([wTrPr(wTblHeader), ...r1]), wTr([wTrPr(wTblHeader), ...r2])];
  };
  const wordCell = (mergeFlag: boolean, [attr1, blks]: MatrixCell): X.Element => { // True for merge.
    const style = attr.attrClass;
    const content = attrBookmark(st, attr1, L.concat(blks.map((b) => blockToDocx(st, 0, style, b))));
    const content1 = content.length === 0 ? [wPara(null)] : content;
    const properties = mergeFlag
      ? [autoWidth, wVMerge(true), wVAlign("center")]
      : [autoWidth, wVAlign("center")];
    return wTc([wTcPr(properties), ...content1]);
  };
  const dataRow = (node: Tree<readonly MatrixCell[]>): X.Element[][] => {
    const cells1 = node.rootLabel;
    const childRows = dataRows(node.subForest);
    if (childRows.length === 0) {
      const thisRow = cells1.map((c) => wordCell(false, c));
      return [thisRow];
    }
    if (childRows.length === 1) {
      const thisRow = cells1.map((c) => wordCell(false, c));
      return [[...thisRow, ...childRows[0]]];
    }
    const [row1, ...rows] = childRows;
    const thisRow = cells1.map((c) => wordCell(true, c));
    return [[...thisRow, ...row1], ...rows.map((r) => [...blanks(cells1), ...r])];
  };
  const dataRows = (trees: readonly Tree<readonly MatrixCell[]>[]): X.Element[][] =>
    L.concat(trees.map(dataRow));
  const h = headerRows();
  const d = dataRows(cells).map(wTr);
  const c = xmlCaption();
  return [wTbl(styleId, [...h, ...d]), c];
}

