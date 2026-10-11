// Ported from hades/src/Model/Report/Document.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * This module is based on the ideas in PanDoc. It has been created for the following reasons:
 *
 * 1. PanDoc is licensed under the GPL, and therefore cannot be incorporated into proprietary
 * software.
 *
 * 2. PanDoc tables do not have the flexibility required for DSM matrices.
 *
 * 3. Colour markup is not supported by PanDoc.
 *
 * At the same time, this is much less ambitious than PanDoc: no import or serialisation, and the
 * number of formats supported is smaller.
 */
import * as T from "@/lib/Data/Text";
import { Nothing, type Maybe } from "@/lib/Data/Maybe";
import type { Forest } from "@/lib/Data/Tree";
import type { UUID } from "@/lib/Data/UUID";
import { absurd } from "@/lib/Prelude";
import type { Colour } from "@/banana-ui/base/Reactive/Banana/Common";

type Text = T.Text;

// ---------------------------------------------------------------------------------------------
// Main Types

export type Block =
  /** Plain text. */
  | { readonly tag: "Plain"; readonly _0: readonly Inline[] }
  /** A paragraph. */
  | { readonly tag: "Para"; readonly _0: readonly Inline[] }
  /** First argument is the list index. Ignored for DocX. */
  | { readonly tag: "OrderedList"; readonly _0: ListNumber; readonly _1: readonly (readonly Block[])[] }
  /** Bulleted list. First argument is the bullet. */
  | { readonly tag: "UnorderedList"; readonly _0: readonly (readonly Block[])[] }
  | { readonly tag: "DefinitionList"; readonly _0: readonly (readonly [readonly Inline[], readonly Block[]])[] }
  | { readonly tag: "Heading"; readonly _0: number; readonly _1: Attr; readonly _2: readonly Inline[] }
  /** Caption. List column header lists, one per level of forest. Forest of cell contents. */
  | {
      readonly tag: "Matrix";
      readonly _0: Attr;
      readonly _1: readonly Inline[];
      readonly _2: readonly MatrixHeader[];
      readonly _3: Forest<readonly MatrixCell[]>;
    }
  | { readonly tag: "Div"; readonly _0: Attr; readonly _1: readonly Block[] }
  /** Model diagram displayed as a block with a caption, alt-text and size in points. */
  | {
      readonly tag: "Picture";
      readonly _0: Attr;
      readonly _1: readonly Inline[];
      readonly _2: Text;
      readonly _3: readonly [number, number];
      readonly _4: UUID;
    }
  | { readonly tag: "Null" };

/** Plain text. */
export function Plain(_0: readonly Inline[]): Block {
  return { tag: "Plain", _0 };
}
/** A paragraph. */
export function Para(_0: readonly Inline[]): Block {
  return { tag: "Para", _0 };
}
/** First argument is the list index. Ignored for DocX. */
export function OrderedList(_0: ListNumber, _1: readonly (readonly Block[])[]): Block {
  return { tag: "OrderedList", _0, _1 };
}
/** Bulleted list. First argument is the bullet. */
export function UnorderedList(_0: readonly (readonly Block[])[]): Block {
  return { tag: "UnorderedList", _0 };
}
export function DefinitionList(_0: readonly (readonly [readonly Inline[], readonly Block[]])[]): Block {
  return { tag: "DefinitionList", _0 };
}
export function Heading(_0: number, _1: Attr, _2: readonly Inline[]): Block {
  return { tag: "Heading", _0, _1, _2 };
}
/** Caption. List column header lists, one per level of forest. Forest of cell contents. */
export function Matrix(
  _0: Attr,
  _1: readonly Inline[],
  _2: readonly MatrixHeader[],
  _3: Forest<readonly MatrixCell[]>,
): Block {
  return { tag: "Matrix", _0, _1, _2, _3 };
}
export function Div(_0: Attr, _1: readonly Block[]): Block {
  return { tag: "Div", _0, _1 };
}
/** Model diagram displayed as a block with a caption, alt-text and size in points. */
export function Picture(
  _0: Attr,
  _1: readonly Inline[],
  _2: Text,
  _3: readonly [number, number],
  _4: UUID,
): Block {
  return { tag: "Picture", _0, _1, _2, _3, _4 };
}
export const Null: Block = { tag: "Null" };

/** Type of numbering for ordered lists. */
export type ListNumber = "ListDecimal" | "ListAlphaUpper" | "ListAlphaLower" | "ListRomanUpper" | "ListRomanLower";
export const listNumberValues: readonly ListNumber[] = [
  "ListDecimal",
  "ListAlphaUpper",
  "ListAlphaLower",
  "ListRomanUpper",
  "ListRomanLower",
];

/** Matrix headers consist of groups of columns. */
export interface MatrixHeader {
  /** Title for this entire group. Ignored for the first group. */
  readonly matrixHeaderName: readonly Inline[];
  /** Columns within the group. Each column has a title made of a list of Inlines. */
  readonly matrixHeaderColumns: readonly (readonly Inline[])[];
}
export function MatrixHeader(
  matrixHeaderName: readonly Inline[],
  matrixHeaderColumns: readonly (readonly Inline[])[],
): MatrixHeader {
  return { matrixHeaderName, matrixHeaderColumns };
}

/**
 * A matrix cell is a list of blocks with an attribute. This allows different types of cells
 * to be formatted using CSS.
 */
export type MatrixCell = readonly [Attr, readonly Block[]];

/** Identifiers for cross references and diagrams. */
export type Ident = UUID;

/** Identifiers are used for internal cross references. */
export interface Attr {
  /** Optional cross reference identifier and priority. */
  readonly attrIdentifier: Maybe<readonly [Ident, number]>;
  /** Format class for the text. */
  readonly attrClass: Maybe<Text>;
}
export function Attr(attrIdentifier: Maybe<readonly [Ident, number]>, attrClass: Maybe<Text>): Attr {
  return { attrIdentifier, attrClass };
}

/** Empty attribute */
export const noAttr: Attr = Attr(Nothing, Nothing);

export type Inline =
  /** Plain text. */
  | { readonly tag: "Str"; readonly _0: Text }
  /** Emphasized text. */
  | { readonly tag: "Emph"; readonly _0: readonly Inline[] }
  /** Strongly emphasized text. */
  | { readonly tag: "Strong"; readonly _0: readonly Inline[] }
  /** Interword space. */
  | { readonly tag: "Space" }
  /** Internal cross reference */
  | { readonly tag: "Link"; readonly _0: Ident; readonly _1: readonly Inline[] }
  /** External reference. Text contains a URL. */
  | { readonly tag: "LinkOut"; readonly _0: Text; readonly _1: readonly Inline[] }
  /** In-line image. */
  | { readonly tag: "Icon"; readonly _0: Text }
  /** Highlight the text with the colour. Foreground is black or white for contrast. */
  | { readonly tag: "Highlight"; readonly _0: Colour; readonly _1: readonly Inline[] }
  /** Span this stretch of text with the attribute. */
  | { readonly tag: "Span"; readonly _0: Attr; readonly _1: readonly Inline[] };

/** Plain text. */
export function Str(_0: Text): Inline {
  return { tag: "Str", _0 };
}
/** Emphasized text. */
export function Emph(_0: readonly Inline[]): Inline {
  return { tag: "Emph", _0 };
}
/** Strongly emphasized text. */
export function Strong(_0: readonly Inline[]): Inline {
  return { tag: "Strong", _0 };
}
/** Interword space. */
export const Space: Inline = { tag: "Space" };
/** Internal cross reference */
export function Link(_0: Ident, _1: readonly Inline[]): Inline {
  return { tag: "Link", _0, _1 };
}
/** External reference. Text contains a URL. */
export function LinkOut(_0: Text, _1: readonly Inline[]): Inline {
  return { tag: "LinkOut", _0, _1 };
}
/** In-line image. */
export function Icon(_0: Text): Inline {
  return { tag: "Icon", _0 };
}
/** Highlight the text with the colour. Foreground is black or white for contrast. */
export function Highlight(_0: Colour, _1: readonly Inline[]): Inline {
  return { tag: "Highlight", _0, _1 };
}
/** Span this stretch of text with the attribute. */
export function Span(_0: Attr, _1: readonly Inline[]): Inline {
  return { tag: "Span", _0, _1 };
}

/**
 * Trim leading and trailing spaces from the list of Inlines.
 * Works on both "Space" items and text with leading spaces.
 */
export function trimSpaces(inlines: readonly Inline[]): Inline[] {
  // Double-reverse so trimTrailing can work from the start of the list.
  return trimLeading([...trimTrailing([...inlines].reverse())].reverse());
}

/** Drop leading spaces. The result shares the tail of the argument. */
function trimLeading(xs: readonly Inline[]): Inline[] {
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const ys = xs.slice(i + 1);
    switch (x.tag) {
      case "Str": {
        const txt2 = T.stripStart(x._0);
        if (txt2 === "") continue;
        return [Str(txt2), ...ys];
      }
      case "Emph": {
        const r = trimLeading1(Emph, x._0, ys);
        if (r === null) continue;
        return r;
      }
      case "Strong": {
        const r = trimLeading1(Strong, x._0, ys);
        if (r === null) continue;
        return r;
      }
      case "Space":
        continue;
      case "Link": {
        const r = trimLeading1((is) => Link(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      case "LinkOut": {
        const r = trimLeading1((is) => LinkOut(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      case "Icon":
        return [x, ...ys];
      case "Highlight": {
        const r = trimLeading1((is) => Highlight(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      case "Span": {
        const r = trimLeading1((is) => Span(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      default:
        return absurd(x);
    }
  }
  return [];
}

/**
 * `trimLeading1 f xs ys`. Returns `null` where the Haskell version continues with
 * `trimLeading ys` (the nested inlines were all space).
 */
function trimLeading1(f: (is: Inline[]) => Inline, xs: readonly Inline[], ys: readonly Inline[]): Inline[] | null {
  const xs1 = trimLeading(xs);
  return xs1.length === 0 ? null : [f(xs1), ...ys];
}

/** Drop trailing spaces, given the list in reverse order. The result is also reversed. */
function trimTrailing(xs: readonly Inline[]): Inline[] {
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const ys = xs.slice(i + 1);
    switch (x.tag) {
      case "Str": {
        const txt2 = T.stripEnd(x._0);
        if (txt2 === "") continue;
        return [Str(txt2), ...ys];
      }
      case "Emph": {
        const r = trimTrailing1(Emph, x._0, ys);
        if (r === null) continue;
        return r;
      }
      case "Strong": {
        const r = trimTrailing1(Strong, x._0, ys);
        if (r === null) continue;
        return r;
      }
      case "Space":
        continue;
      case "Link": {
        const r = trimTrailing1((is) => Link(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      case "LinkOut": {
        const r = trimTrailing1((is) => LinkOut(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      case "Icon":
        return [x, ...ys];
      case "Highlight": {
        const r = trimTrailing1((is) => Highlight(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      case "Span": {
        const r = trimTrailing1((is) => Span(x._0, is), x._1, ys);
        if (r === null) continue;
        return r;
      }
      default:
        return absurd(x);
    }
  }
  return [];
}

/**
 * `trimTrailing1 f xs ys`, where `xs` is in normal order. Returns `null` where the Haskell
 * version continues with `trimTrailing ys`.
 */
function trimTrailing1(f: (is: Inline[]) => Inline, xs: readonly Inline[], ys: readonly Inline[]): Inline[] | null {
  const xs1 = trimTrailing([...xs].reverse()).reverse();
  return xs1.length === 0 ? null : [f(xs1), ...ys];
}
