// Ported from hades/src/Model/Report/Html.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Convert Documents into HTML.
 *
 * TypeScript port
 * ---------------
 * * Html is built with the blaze-html port (`@/lib/Text/Blaze/Html5`), so the markup and its
 *   escaping are those of the original. Render the result with `H.renderHtml`.
 * * Blaze's `H.Attribute` is a monoid (`mempty`, `<>`); here a combination of attributes is a
 *   `readonly H.Attribute[]` (empty for `mempty`), applied with `H.with_(h, ...attrs)`. So
 *   `attrToHtml` returns an array.
 * * `ImageRef -> FilePath` arguments are functions `(r: ImageRef) => string`.
 */
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { absurd } from "@/lib/Prelude";
import type { Tree } from "@/lib/Data/Tree";
import * as H from "@/lib/Text/Blaze/Html5";
import * as HA from "@/lib/Text/Blaze/Html5/Attributes";
import { DiagramRef, IconRef, type ImageRef } from "@/hades/src/Model/Report/Base";
import type {
  Attr, Block, Inline, ListNumber, MatrixCell, MatrixHeader,
} from "@/hades/src/Model/Report/Document";
import { getColour } from "@/banana-ui/base/Reactive/Banana/Common";

type Html = H.Html;
type FilePath = string;
type Text = T.Text;

/** The HTML \"type\" code for ordered lists. */
function listNumber(n: ListNumber): H.Attribute {
  switch (n) {
    case "ListDecimal": return HA.type_("1");
    case "ListAlphaUpper": return HA.type_("A");
    case "ListAlphaLower": return HA.type_("a");
    case "ListRomanUpper": return HA.type_("I");
    case "ListRomanLower": return HA.type_("i");
    default: return absurd(n);
  }
}


/**
 * Top level conversion. Puts HTML head and body tags around the blocks.
 *
 * @param pathFunc Paths where images will be stored.
 * @param headStuff Contents for the head section.
 * @param blks Contents for the body section.
 */
export function mkHtmlDocument(
  pathFunc: (r: ImageRef) => FilePath,
  headStuff: Html,
  blks: readonly Block[],
): Html {
  return H.docTypeHtml(H.mconcat_Html([
    H.head(H.mconcat_Html([H.with_(H.meta(), HA.charset(H.toValue("UTF-8" as Text))), headStuff])),
    H.body(blocksToHtml(pathFunc, blks)),
  ]));
}


/** Generate the HTML for a block. */
export function blockToHtml(pathFunc: (r: ImageRef) => FilePath, blk: Block): Html {
  switch (blk.tag) {
    case "Plain":
      return inlinesToHtml(pathFunc, blk._0);
    case "Para":
      if (blk._0.length === 0) return H.mempty_Html;
      return H.p(inlinesToHtml(pathFunc, blk._0));
    case "OrderedList":
      return H.with_(H.ol(H.mconcat_Html(blk._1.map((bs) => H.li(blocksToHtml(pathFunc, bs))))), listNumber(blk._0));
    case "UnorderedList":
      return H.ul(H.mconcat_Html(blk._0.map((bs) => H.li(blocksToHtml(pathFunc, bs)))));
    case "DefinitionList": {
      const ddPair = ([term, def]: readonly [readonly Inline[], readonly Block[]]): Html =>
        H.append_Html(H.dt(inlinesToHtml(pathFunc, term)), H.dd(blocksToHtml(pathFunc, def)));
      return H.dl(H.mconcat_Html(blk._0.map(ddPair)));
    }
    case "Heading": {
      const h = (level: number): H.HtmlFunction => {
        switch (level) {
          case 1: return H.h1;
          case 2: return H.h2;
          case 3: return H.h3;
          case 4: return H.h4;
          case 5: return H.h5;
          case 6: return H.h6;
          default: return (...cs) => H.p(H.b(...cs));
        }
      };
      return H.with_(h(blk._0), ...attrToHtml(blk._1))(inlinesToHtml(pathFunc, blk._2));
    }
    case "Matrix":
      return matrixToHtml(pathFunc, blk._0, blk._1, blk._2, blk._3);
    case "Div":
      return H.with_(H.div(blocksToHtml(pathFunc, blk._1)), ...attrToHtml(blk._0));
    case "Picture": {
      const [attr, caption, alt, , diagramId] = [blk._0, blk._1, blk._2, blk._3, blk._4];
      return H.with_(
        H.figure(H.mconcat_Html([
          H.with_(H.img(), HA.src(H.toValue(pathFunc(DiagramRef(diagramId)))), HA.alt(H.toValue(alt))),
          H.figcaption(H.with_(H.span(inlinesToHtml(pathFunc, caption)), HA.class_("diagramCaption"))),
        ])),
        ...attrToHtml(attr),
      );
    }
    case "Null":
      return H.mempty_Html;
    default:
      return absurd(blk);
  }
}


export function blocksToHtml(pathFunc: (r: ImageRef) => FilePath, blks: readonly Block[]): Html {
  return H.mconcat_Html(blks.map((b) => blockToHtml(pathFunc, b)));
}


/** Generate the HTML for an Inline. */
export function inlineToHtml(pathFunc: (r: ImageRef) => FilePath, inline: Inline): Html {
  switch (inline.tag) {
    case "Str":
      return H.text(inline._0);
    case "Emph":
      return H.em(inlinesToHtml(pathFunc, inline._0));
    case "Strong":
      return H.strong(inlinesToHtml(pathFunc, inline._0));
    case "Space":
      return H.text(" ");
    case "Link":
      return H.with_(H.a(inlinesToHtml(pathFunc, inline._1)), HA.href(H.toValue("#" + U.toText(inline._0))));
    case "LinkOut":
      return H.with_(H.a(inlinesToHtml(pathFunc, inline._1)), HA.href(H.toValue(inline._0)));
    case "Icon":
      return H.with_(
        H.img(),
        HA.src(H.toValue(pathFunc(IconRef(inline._0)))),
        HA.alt("icon"),
        HA.height("16"),
        HA.width("16"),
      );
    case "Highlight": {
      const colour = inline._0;
      const colourSet =
        "background-color:" + C.sRGB24show(getColour(colour)) +
        ";color:" + (C.luminance(getColour(colour)) < 0.5 ? "white" : "black");
      return H.with_(H.span(inlinesToHtml(pathFunc, inline._1)), HA.style(H.toValue(colourSet)));
    }
    case "Span":
      return H.with_(H.span(inlinesToHtml(pathFunc, inline._1)), ...attrToHtml(inline._0));
    default:
      return absurd(inline);
  }
}


export function inlinesToHtml(pathFunc: (r: ImageRef) => FilePath, inlines: readonly Inline[]): Html {
  return H.mconcat_Html(inlines.map((i) => inlineToHtml(pathFunc, i)));
}


/** The attributes of an "Attr": blaze's `Attribute` monoid as a list (empty for `mempty`). */
export function attrToHtml(attr: Attr): H.Attribute[] {
  const ident = attr.attrIdentifier;
  const classes = attr.attrClass;
  const identAttr: H.Attribute[] = ident.tag === "Nothing" ? [] : [HA.id(H.toValue(U.toText(ident.value[0])))];
  const classesAttr: H.Attribute[] = classes.tag === "Nothing" ? [] : [HA.class_(H.toValue(classes.value))];
  return [...identAttr, ...classesAttr];
}


/**
 * Convert a matrix to HTML. The matrix cells are represented as a forest of values. Each value
 * is itself a list of cells. Each value is shown as a row of table cells which vertically spans
 * the rows of the next level.
 *
 * It is up to the caller to make sure that the cell layout agrees with the header layout.
 *
 * @param pathFunc Paths for image files.
 * @param attr Identifier and style classes for this matrix.
 * @param caption Caption for this matrix.
 * @param headers The outer list matches tree levels. The inner lists are colums within each level.
 */
export function matrixToHtml(
  pathFunc: (r: ImageRef) => FilePath,
  attr: Attr,
  caption: readonly Inline[],
  headers: readonly MatrixHeader[],
  cells: readonly Tree<readonly MatrixCell[]>[],
): Html {
  const captionHtml = caption.length === 0 ? H.mempty_Html : H.caption(inlinesToHtml(pathFunc, caption));
  const groupHeader = (mh: MatrixHeader): [Html, Html] => [
    H.with_(H.th(inlinesToHtml(pathFunc, mh.matrixHeaderName)), HA.colspan(H.toValue(mh.matrixHeaderColumns.length))),
    H.mconcat_Html(mh.matrixHeaderColumns.map((c) => H.th(inlinesToHtml(pathFunc, c)))),
  ];
  // Only used when headers is not empty, so "head" and ":" are safe.
  const complexHeader = (): [Html, Html] => {
    const [grp1, ...grps] = headers.map(groupHeader);
    const n = headers[0].matrixHeaderColumns.length;
    // (snd grp1, H.th ! HA.colspan n $ mempty) <> mconcat grps
    return [
      H.mconcat_Html([grp1[1], ...grps.map((g) => g[0])]),
      H.mconcat_Html([H.with_(H.th(H.mempty_Html), HA.colspan(H.toValue(n))), ...grps.map((g) => g[1])]),
    ];
  };
  const headerRows = ((): Html => {
    if (headers.length === 0) return H.mempty_Html;
    if (headers.length === 1) return H.tr(groupHeader(headers[0])[1]);
    const [r1, r2] = complexHeader();
    return H.append_Html(H.tr(r1), H.tr(r2));
  })();
  const leafCount = (t: Tree<readonly MatrixCell[]>): number =>
    t.subForest.length === 0 ? 1 : t.subForest.reduce((s, c) => s + leafCount(c), 0);
  const dataRow = (node: Tree<readonly MatrixCell[]>): Html[] => {
    const n = leafCount(node);
    const spread: H.Attribute[] = n === 1 ? [] : [HA.rowspan(H.toValue(n))];
    const htmlCell = ([attr1, blks]: MatrixCell): Html =>
      H.with_(H.td(blocksToHtml(pathFunc, blks)), ...spread, ...attrToHtml(attr1));
    const thisLevel = H.mconcat_Html(node.rootLabel.map(htmlCell));
    const childRows = dataRows(node.subForest);
    if (childRows.length === 0) return [thisLevel];
    const [row1, ...rows] = childRows;
    return [H.append_Html(thisLevel, row1), ...rows];
  };
  const dataRows = (ts: readonly Tree<readonly MatrixCell[]>[]): Html[] => ts.flatMap(dataRow);
  return H.with_(
    H.table(H.mconcat_Html([captionHtml, headerRows, H.mconcat_Html(dataRows(cells).map((r) => H.tr(r)))])),
    ...attrToHtml(attr),
  );
}
