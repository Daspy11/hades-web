// Ported from hades/src/Text/NaturalOrder.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Natural order sorting for Text. Separates out numbers from the rest of the text, and uses
 * the Unicode sort order for the text and numerical order for the numbers.
 *
 * Porting notes:
 *
 *  - `NaturalChunk` derives `Ord` in Haskell, and the constructor order matters
 *    (`SpaceChunk < OtherChunk < NumberChunk < LetterChunk`), so the generic structural
 *    `compare` (which orders tags alphabetically) must not be used on chunks. Use
 *    `compareNaturalChunk` / `compareNaturalChunks` instead.
 *  - `NumberChunk` holds a Haskell `Integer`, represented as a `bigint` so that long digit
 *    strings keep their exact value.
 *  - `Text` comparison in Haskell is by code point. JavaScript `<` compares UTF-16 code units,
 *    which differs for astral characters, so a code point comparison is used here.
 *  - `isSpace` and `T.toCaseFold` follow the Haskell definitions exactly (see `hsIsSpace`
 *    and `caseFold` below) rather than the approximations in the runtime library.
 */
import * as T from "@/lib/Data/Text";
import { isDigit, isLetter, isMark } from "@/lib/Data/Char";
import type { Ordering } from "@/lib/Data/Ord";
import { absurd } from "@/lib/Prelude";

type Text = T.Text;
type Char = string;

/** A chunk of text suitable for sorting as an element, in collation order. */
export type NaturalChunk =
  /** Whitespace of any kind. */
  | { readonly tag: "SpaceChunk" }
  /** All characters not otherwise recognised. */
  | { readonly tag: "OtherChunk"; readonly _0: Text }
  | { readonly tag: "NumberChunk"; readonly _0: bigint }
  /** Must have been converted to folded case using "T.toCaseFold" */
  | { readonly tag: "LetterChunk"; readonly _0: Text };

/** Whitespace of any kind. */
export const SpaceChunk: NaturalChunk = { tag: "SpaceChunk" };
/** All characters not otherwise recognised. */
export function OtherChunk(_0: Text): NaturalChunk {
  return { tag: "OtherChunk", _0 };
}
export function NumberChunk(_0: bigint): NaturalChunk {
  return { tag: "NumberChunk", _0 };
}
/** Must have been converted to folded case using "T.toCaseFold" */
export function LetterChunk(_0: Text): NaturalChunk {
  return { tag: "LetterChunk", _0 };
}

/** Constructor order of `NaturalChunk`, used by the derived `Ord` instance. */
export const naturalChunkTags: readonly NaturalChunk["tag"][] = [
  "SpaceChunk",
  "OtherChunk",
  "NumberChunk",
  "LetterChunk",
];

function chunkRank(c: NaturalChunk): number {
  switch (c.tag) {
    case "SpaceChunk": return 0;
    case "OtherChunk": return 1;
    case "NumberChunk": return 2;
    case "LetterChunk": return 3;
    default: return absurd(c);
  }
}

/** Haskell `compare` on `Text`: lexicographic by code point. */
function compareText(a: Text, b: Text): Ordering {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x !== y) {
      // Move the surrogates above the rest of the BMP so that code unit order becomes code
      // point order at the first difference.
      const fx = x >= 0xe000 ? x - 0x800 : x >= 0xd800 ? x + 0x2000 : x;
      const fy = y >= 0xe000 ? y - 0x800 : y >= 0xd800 ? y + 0x2000 : y;
      return fx < fy ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

/** The derived `instance Ord NaturalChunk`. */
export function compareNaturalChunk(a: NaturalChunk, b: NaturalChunk): Ordering {
  const ra = chunkRank(a), rb = chunkRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  switch (a.tag) {
    case "SpaceChunk":
      return 0;
    case "OtherChunk":
    case "LetterChunk":
      return compareText(a._0, (b as typeof a)._0);
    case "NumberChunk": {
      const x = a._0, y = (b as typeof a)._0;
      return x < y ? -1 : x > y ? 1 : 0;
    }
    default:
      return absurd(a);
  }
}

/** The derived `instance Eq NaturalChunk`. */
export function eqNaturalChunk(a: NaturalChunk, b: NaturalChunk): boolean {
  return compareNaturalChunk(a, b) === 0;
}

/** `instance Ord [NaturalChunk]`: lexicographic comparison of chunk lists. */
export function compareNaturalChunks(xs: readonly NaturalChunk[], ys: readonly NaturalChunk[]): Ordering {
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const c = compareNaturalChunk(xs[i], ys[i]);
    if (c !== 0) return c;
  }
  return xs.length < ys.length ? -1 : xs.length > ys.length ? 1 : 0;
}

/** The derived `instance Show NaturalChunk`. */
export function show_NaturalChunk(c: NaturalChunk): string {
  switch (c.tag) {
    case "SpaceChunk": return "SpaceChunk";
    case "OtherChunk": return "OtherChunk " + T.showText(c._0);
    case "NumberChunk": return "NumberChunk " + c._0.toString();
    case "LetterChunk": return "LetterChunk " + T.showText(c._0);
    default: return absurd(c);
  }
}

/**
 * Haskell `Data.Char.isSpace`: the Latin-1 spaces (tab, newline, vertical tab, form feed,
 * carriage return, space and no-break space) plus the Unicode @Space@ (Zs) category. Unlike
 * JavaScript's @\s@ this does not include U+2028, U+2029 or U+FEFF.
 */
function hsIsSpace(c: Char): boolean {
  const n = c.codePointAt(0) ?? 0;
  if (n <= 0x377) return n === 32 || (n >= 9 && n <= 13) || n === 0xa0;
  return /^\p{Zs}$/u.test(c);
}

/** `T.strip` using `hsIsSpace`. */
function strip(t: Text): Text {
  return T.dropAround(hsIsSpace, t);
}

/**
 * Haskell `T.toCaseFold`: full Unicode case folding. JavaScript has no case folding primitive;
 * mapping each character to upper case and then to lower case gives the full case folding for
 * everything except the few characters handled specially here (dotless i, capital sharp s and
 * Cherokee, whose folding goes to upper case).
 */
function caseFold(t: Text): Text {
  // Fast path: ASCII only.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(t)) return t.toLowerCase();
  let r = "";
  for (const c of t) {
    const n = c.codePointAt(0)!;
    if (n === 0x131) r += c; // ı folds to itself.
    else if (n === 0x1e9e) r += "ss"; // ẞ
    else if ((n >= 0x13a0 && n <= 0x13ff) || (n >= 0xab70 && n <= 0xabbf)) r += c.toUpperCase();
    else r += c.toUpperCase().toLowerCase();
  }
  return r;
}

/** Functions to classify characters. First match wins. */
export const chunkClasses: readonly (readonly [(c: Char) => boolean, (t: Text) => NaturalChunk])[] = [
  [hsIsSpace, (_t: Text) => SpaceChunk],
  [(c: Char) => isLetter(c) || isMark(c), (t: Text) => LetterChunk(caseFold(t))],
  [isDigit, (t: Text) => NumberChunk(BigInt(t))], // "BigInt" is safe because argument is all digits.
];

/** True if character is not one of the "chunkClasses" */
export function isOther(c: Char): boolean {
  return chunkClasses.every(([p]) => !p(c));
}

/** Split the text into runs of the same type. */
export function chunkText(txt: Text): NaturalChunk[] {
  // Equivalent to the recursive Haskell definition
  //   go txt = case T.uncons txt of
  //     Nothing -> []
  //     Just (c1, _) -> case find (($ c1) . fst) chunkClasses of
  //       Just (predicate, typ) -> let (t1, t2) = T.span predicate txt in typ t1 : go t2
  //       Nothing -> let (t1, t2) = T.span isOther txt in OtherChunk (T.toCaseFold t1) : go t2
  // but working over an array of code points in a single pass.
  const cs = Array.from(strip(txt));
  const result: NaturalChunk[] = [];
  let i = 0;
  while (i < cs.length) {
    const c1 = cs[i];
    const cls = chunkClasses.find(([p]) => p(c1));
    const predicate = cls ? cls[0] : isOther;
    let j = i + 1;
    while (j < cs.length && predicate(cs[j])) j++;
    const t1 = cs.slice(i, j).join("");
    result.push(cls ? cls[1](t1) : OtherChunk(caseFold(t1)));
    i = j;
  }
  return result;
}

/** Compare the two strings using natural order sorting. */
export function naturalOrder(t1: Text, t2: Text): Ordering {
  if (t1 === t2) return 0;
  const o = compareNaturalChunks(chunkText(t1), chunkText(t2));
  return o === 0 ? compareText(t1, t2) : o;
}
