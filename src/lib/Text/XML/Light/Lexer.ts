/**
 * Haskell `Text.XML.Light.Lexer` (package `xml`, version 1.3.14): the tokeniser used by
 * `Text.XML.Light.Input`.
 *
 * `XmlSource` instances: a `string` is read as characters (code points), as the `String` and
 * `Text` instances do; a `Uint8Array` is read one byte per character (Latin-1), exactly as the
 * `ByteString` instances (`chr . fromEnum`) do. So UTF-8 bytes are *not* decoded: decode them
 * first (`U.decodeUtf8`) if the document holds non-ASCII text.
 *
 * The Haskell lexer works on a lazy list of `(Line, Char)` pairs (`LString`). Here the
 * characters and their line numbers are two arrays and positions are indices into them, so the
 * functions take and return indices instead of list suffixes. The results are the same tokens.
 */
import { Just, Nothing, type Maybe } from "../../../Data/Maybe";
import { Attr, CData, QName, type Line } from "./Types";

/** `class XmlSource s`: input to the XML parser. */
export type XmlSource = string | Uint8Array;

/** `type LChar = (Line, Char)` */
export type LChar = readonly [Line, string];

/**
 * `type LString = [LChar]`, as two parallel arrays: the characters (one code point each) and
 * their line numbers.
 */
export interface LString {
  readonly chars: readonly string[];
  readonly lines: readonly Line[];
}

/** XML lexical tokens. */
export type Token =
  | { readonly tag: "TokStart"; readonly _0: Line; readonly _1: QName; readonly _2: readonly Attr[]; readonly _3: boolean }
  | { readonly tag: "TokEnd"; readonly _0: Line; readonly _1: QName }
  | { readonly tag: "TokCRef"; readonly _0: string }
  | { readonly tag: "TokText"; readonly _0: CData };
export function TokStart(_0: Line, _1: QName, _2: readonly Attr[], _3: boolean): Token {
  return { tag: "TokStart", _0, _1, _2, _3 };
}
export function TokEnd(_0: Line, _1: QName): Token {
  return { tag: "TokEnd", _0, _1 };
}
export function TokCRef(_0: string): Token {
  return { tag: "TokCRef", _0 };
}
export function TokText(_0: CData): Token {
  return { tag: "TokText", _0 };
}

/** The characters of a source: code points of a string, or bytes as Latin-1 characters. */
function sourceChars(s: XmlSource): string[] {
  if (typeof s === "string") return Array.from(s);
  const out = new Array<string>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = String.fromCharCode(s[i]);
  return out;
}

/**
 * Number the lines of the source, starting with the given line. `\r\n` and a lone `\r` are
 * both read as `\n`.
 */
export function linenumber(n: Line, s: XmlSource): LString {
  const src = sourceChars(s);
  const chars: string[] = [];
  const lines: Line[] = [];
  let line = n;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\r") {
      if (i + 1 < src.length && src[i + 1] === "\n") i++;
      chars.push("\n");
      lines.push(line);
      line++;
    } else if (c === "\n") {
      chars.push("\n");
      lines.push(line);
      line++;
    } else {
      chars.push(c);
      lines.push(line);
    }
  }
  return { chars, lines };
}

/** Haskell `Data.Char.isSpace` (Latin-1 white space, and the Unicode space separators). */
function isSpace(c: string): boolean {
  const n = c.codePointAt(0)!;
  if (n <= 0x377) return n === 32 || (n >= 9 && n <= 13) || n === 0xa0;
  return /^\p{Zs}$/u.test(c);
}

/** Run the lexical analysis. */
export function tokens(source: XmlSource): Token[] {
  return tokens_(linenumber(1, source), 0);
}

/** `tokens'`: the tokens from the given position to the end of the input. */
export function tokens_(ls: LString, start: number): Token[] {
  const out: Token[] = [];
  const { chars, lines } = ls;
  const n = chars.length;
  let i = start;
  while (i < n) {
    if (chars[i] === "<" && i + 1 < n && chars[i + 1] === "!") {
      const r = special(ls, i + 1, i + 2, out);
      if (r === null) return out;
      i = r;
    } else if (chars[i] === "<") {
      const r = tag(ls, dropSpace(ls, i + 1), out);
      if (r === null) return out;
      i = r;
    } else {
      const l = lines[i];
      const [as, j] = breakn((c) => c === "<", ls, i);
      for (const bit of decode_text(as)) {
        if (bit.tag === "TxtBit") {
          out.push(TokText(CData("CDataText", bit._0, Just(l))));
        } else {
          const c = cref_to_char(bit._0);
          out.push(c.tag === "Just" ? TokText(CData("CDataText", c.value, Just(l))) : TokCRef(bit._0));
        }
      }
      i = j;
    }
  }
  return out;
}

/**
 * Lex a `<!` construct: a comment, a CDATA section or other markup such as a DTD. `c` is the
 * position of the `!`, `i` the position after it. Pushes the tokens and returns the position at
 * which to continue, or `null` if the input ends (an unterminated comment ends all tokens).
 */
export function special(ls: LString, c: number, i: number, out: Token[]): number | null {
  const { chars, lines } = ls;
  const n = chars.length;
  const at = (k: number, s: string): boolean => {
    for (let x = 0; x < s.length; x++) if (k + x >= n || chars[k + x] !== s[x]) return false;
    return true;
  };
  if (at(i, "--")) {
    // skip
    for (let k = i + 2; k < n; k++) if (at(k, "-->")) return k + 3;
    return null; // unterminated comment
  }
  if (at(i, "[CDATA[")) {
    const xs: string[] = [];
    let k = i + 7;
    for (; k < n; k++) {
      if (at(k, "]]>")) break;
      xs.push(chars[k]);
    }
    out.push(TokText(CData("CDataVerbatim", xs.join(""), Just(lines[c]))));
    return k < n ? k + 3 : n;
  }
  // munch
  const acc: string[] = [];
  let nesting = 0;
  let k = i;
  for (; k < n; k++) {
    const x = chars[k];
    if (x === ">") {
      acc.push(">");
      if (nesting === 0) {
        k++;
        break;
      }
      nesting--;
    } else if (x === "<") {
      acc.push("<");
      nesting++;
    } else {
      acc.push(x);
    }
  }
  out.push(TokText(CData("CDataRaw", "<!" + acc.join(""), Just(lines[c]))));
  return k;
}

/** Split a qualified name off the front of the input. Returns the name and the position after it. */
export function qualName(ls: LString, i: number): [QName, number] {
  const endName = (x: string): boolean => isSpace(x) || x === "=" || x === ">" || x === "/";
  const [as, j] = breakn(endName, ls, i);
  const colon = as.indexOf(":");
  const [q, nm] = colon >= 0 ? [Just(as.slice(0, colon)), as.slice(colon + 1)] : [Nothing as Maybe<string>, as];
  return [QName(nm, Nothing, q), j];
}

/**
 * Lex a tag (after the `<`, with leading space dropped). Pushes the tokens and returns the
 * position at which to continue, or `null` at the end of the input.
 */
export function tag(ls: LString, i: number, out: Token[]): number | null {
  const { chars, lines } = ls;
  const n = chars.length;
  if (i < n && chars[i] === "/") {
    const p = lines[i];
    const [nm, ds] = qualName(ls, dropSpace(ls, i + 1));
    out.push(TokEnd(p, nm));
    // tag was not properly closed if there is no '>'.
    return ds < n && chars[ds] === ">" ? ds + 1 : ds;
  }
  if (i >= n) return null;
  const p = lines[i];
  const [nm, ds] = qualName(ls, i);
  const [as, b, next] = attribs(ls, dropSpace(ls, ds));
  out.push(TokStart(p, nm, as, b));
  return next;
}

/**
 * Lex the attributes of a start tag. Returns the attributes, whether the tag is empty, and the
 * position at which to continue (`null` if the document ended within the tag).
 */
export function attribs(ls: LString, i0: number): [Attr[], boolean, number | null] {
  const { chars } = ls;
  const n = chars.length;
  const as: Attr[] = [];
  let i = i0;
  for (;;) {
    if (i >= n) return [as, false, null]; // doc ended within a tag..
    const c = chars[i];
    if (c === ">") return [as, false, i + 1];
    if (c === "/") return [as, true, i + 1 < n && chars[i + 1] === ">" ? i + 2 : i + 1]; // insert missing >
    if (c === "?" && i + 1 < n && chars[i + 1] === ">") return [as, true, i + 2];
    const [a, j] = attrib(ls, i);
    as.push(a);
    i = j;
  }
}

/** Lex one attribute. Returns it and the position after it (and any following space). */
export function attrib(ls: LString, i: number): [Attr, number] {
  const [ks, cs1] = qualName(ls, i);
  const [vs, cs2] = attr_val(ls, dropSpace(ls, cs1));
  return [Attr(ks, decode_attr(vs)), dropSpace(ls, cs2)];
}

/** The value of an attribute after its name, if there is an `=`. */
export function attr_val(ls: LString, i: number): [string, number] {
  if (i < ls.chars.length && ls.chars[i] === "=") return string(ls, dropSpace(ls, i + 1));
  return ["", i];
}

/** Skip white space. */
export function dropSpace(ls: LString, i: number): number {
  let k = i;
  while (k < ls.chars.length && isSpace(ls.chars[k])) k++;
  return k;
}

/**
 * Match the value for an attribute. For malformed XML we do our best to guess the programmer's
 * intention.
 */
export function string(ls: LString, i: number): [string, number] {
  const c = i < ls.chars.length ? ls.chars[i] : "";
  if (c === '"') return break_((x) => x === '"', ls, i + 1);
  // Allow attributes to be enclosed between ' '.
  if (c === "'") return break_((x) => x === "'", ls, i + 1);
  // Allow attributes that are not enclosed by anything.
  return breakn((x) => isSpace(x) || x === ">" || x === "/", ls, i);
}

/** `break'`: the text up to the first character satisfying the predicate, which is dropped. */
export function break_(p: (c: string) => boolean, ls: LString, i: number): [string, number] {
  const [as, j] = breakn(p, ls, i);
  return [as, j < ls.chars.length ? j + 1 : j];
}

/** The text up to the first character satisfying the predicate, and the position of that character. */
export function breakn(p: (c: string) => boolean, ls: LString, i: number): [string, number] {
  let k = i;
  while (k < ls.chars.length && !p(ls.chars[k])) k++;
  return [ls.chars.slice(i, k).join(""), k];
}

/** Decode the character references in an attribute value. */
export function decode_attr(cs: string): string {
  return decode_text(cs).map((bit) => {
    if (bit.tag === "TxtBit") return bit._0;
    const c = cref_to_char(bit._0);
    return c.tag === "Just" ? c.value : "&" + bit._0 + ";";
  }).join("");
}

/** Pieces of text: plain text, or the name of a character reference (between `&` and `;`). */
export type Txt = { readonly tag: "TxtBit"; readonly _0: string } | { readonly tag: "CRefBit"; readonly _0: string };
export function TxtBit(_0: string): Txt {
  return { tag: "TxtBit", _0 };
}
export function CRefBit(_0: string): Txt {
  return { tag: "CRefBit", _0 };
}

/** Split text into plain text and character references. */
export function decode_text(xs: string): Txt[] {
  const out: Txt[] = [];
  let i = 0;
  while (i < xs.length) {
    if (xs[i] === "&") {
      const semi = xs.indexOf(";", i + 1);
      if (semi < 0) {
        out.push(TxtBit(xs.slice(i)));
        return out;
      }
      out.push(CRefBit(xs.slice(i + 1, semi)));
      i = semi + 1;
    } else {
      const amp = xs.indexOf("&", i);
      const j = amp < 0 ? xs.length : amp;
      out.push(TxtBit(xs.slice(i, j)));
      i = j;
    }
  }
  return out;
}

/** The character named by a character reference. */
export function cref_to_char(cs: string): Maybe<string> {
  if (cs.startsWith("#")) return num_esc(cs.slice(1));
  switch (cs) {
    case "lt": return Just("<");
    case "gt": return Just(">");
    case "amp": return Just("&");
    case "apos": return Just("'");
    case "quot": return Just('"');
    default: return Nothing;
  }
}

/** A numeric character reference (`x` followed by hex digits, or a decimal number). */
export function num_esc(cs: string): Maybe<string> {
  if (cs.startsWith("x")) {
    // readHex: one or more hex digits, which must be the whole string.
    return /^[0-9a-fA-F]+$/.test(cs.slice(1)) ? cvt_char(parseInt(cs.slice(1), 16)) : Nothing;
  }
  // reads :: ReadS Int: optional leading space and sign, a decimal (or Haskell 0x/0o) literal,
  // and the whole string consumed.
  const m = /^\s*(-?)(?:0[xX]([0-9a-fA-F]+)|0[oO]([0-7]+)|([0-9]+))$/.exec(cs);
  if (m === null) return Nothing;
  const v = m[2] !== undefined ? parseInt(m[2], 16) : m[3] !== undefined ? parseInt(m[3], 8) : parseInt(m[4], 10);
  return cvt_char(m[1] === "-" ? -v : v);
}

/** The character with the code, if it is a valid character. */
export function cvt_char(x: number): Maybe<string> {
  return x >= 0 && x <= 0x10ffff ? Just(String.fromCodePoint(x)) : Nothing;
}
