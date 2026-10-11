/**
 * A small parser-combinator library mirroring the parts of Haskell's `megaparsec`
 * (`Text.Megaparsec`, `Text.Megaparsec.Char`, `Text.Megaparsec.Char.Lexer`) and
 * `parser-combinators` (`Control.Monad.Combinators`, `Control.Monad.Combinators.Expr`) used by
 * HADES. The stream is always text (`Parsec e Text`). Use as
 * `import * as MP from "@/lib/Text/Megaparsec"`.
 *
 * ## Representation
 *
 * Parsers are direct-style functions over a mutable `ParseState`:
 *
 * ```ts
 * type Parser<A> = (st: ParseState) => A;   // throws ParseFailure on failure
 * ```
 *
 * A `do` block becomes an ordinary function body calling parsers in sequence:
 *
 * ```haskell
 * parExp = do { void $ lexeme $ char '('; e <- expr; void $ lexeme $ char ')'; return e }
 * ```
 * ```ts
 * const parExp: Parser<Expr> = (st) => { lexeme(char("("))(st); const e = expr(st); lexeme(char(")"))(st); return e; };
 * ```
 *
 * ## Semantics
 *
 * The megaparsec semantics are kept exactly, including the error messages:
 *
 * * A parser either *consumes* input or not. `alt(p, q)` (Haskell `p <|> q`) only tries `q` when
 *   `p` failed **without consuming** input. Backtracking after consumption only happens through
 *   `try_`.
 * * Errors carry an offset (in characters, i.e. code points) and either the unexpected item and
 *   the set of expected items (`TrivialError`) or a set of fancy errors (`FancyError`). Errors of
 *   alternatives are merged as `mergeError` does: the error at the greater offset wins, errors at
 *   the same offset are combined.
 * * Megaparsec's *hints* are kept: when a parser succeeds without consuming input after an
 *   alternative failed (e.g. `many p` stopping, `optional p` returning `Nothing`, a skipped
 *   `space`), the expected items of that failure are added to a later error at the same position.
 *   This is what produces messages such as
 *   `unexpected '5' expecting end of input, operator, or white space`.
 *
 * The contract of a `Parser<A>` called with `st.hints = H` (the hints left by the previous parser
 * in the same sequence) is: on success after consuming input `st.hints` holds the parser's own
 * hints; on success without consuming input `st.hints` is `H` plus its own hints; on failure
 * without consuming input `st.offset` is unchanged and a `TrivialError` has `H` added to its
 * expected items; on failure after consuming input `st.offset` is beyond its starting value.
 * Plain TypeScript code between parser calls (Haskell `return`/`pure`) does not touch the state.
 *
 * Error components (`ErrorCustom e`) are rendered through a `ShowErrorComponent<E>` dictionary.
 * The rendering functions accept it as an optional first argument; the default renders text
 * components verbatim, as the orphan `instance ShowErrorComponent Text` in
 * `Model.Reflection.Parser` does.
 *
 * Deviations: `many`/`some`/`skipMany` throw an `Error` instead of looping forever when their
 * argument succeeds without consuming input. Integers are JavaScript numbers.
 */
import { Just, Nothing, type Maybe } from "../Data/Maybe";
import { Left, Right, type Either } from "../Data/Either";
import { compare, type Ordering } from "../Data/Ord";
import * as S from "../Data/Set";
import { isAlphaNum, isDigit, isHexDigit, isLetter, isLower, isOctDigit, isPrint, isSpace, isUpper } from "../Data/Char";

// =============================================================================================
// Text.Megaparsec.Error

/** A data type that is used to represent “unexpected/expected” items in parse errors. */
export type ErrorItem =
  /** Non-empty stream of tokens. */
  | { readonly tag: "Tokens"; readonly _0: readonly string[] }
  /** Label (cannot be empty). */
  | { readonly tag: "Label"; readonly _0: string }
  /** End of input. */
  | { readonly tag: "EndOfInput" };
export function Tokens(_0: readonly string[]): ErrorItem {
  return { tag: "Tokens", _0 };
}
export function Label(_0: string): ErrorItem {
  return { tag: "Label", _0 };
}
export const EndOfInput: ErrorItem = { tag: "EndOfInput" };

const errorItemRank = { Tokens: 0, Label: 1, EndOfInput: 2 } as const;

/** The derived `Ord ErrorItem` instance: `Tokens < Label < EndOfInput`. */
export function compareErrorItem(a: ErrorItem, b: ErrorItem): Ordering {
  if (a.tag !== b.tag) return errorItemRank[a.tag] < errorItemRank[b.tag] ? -1 : 1;
  switch (a.tag) {
    case "Tokens": return compare(a._0, (b as typeof a)._0);
    case "Label": return compare(a._0, (b as typeof a)._0);
    case "EndOfInput": return 0;
  }
}

/** Additional error data, extendable by user. When no custom data is necessary, the type is typically indexed by `Void`. */
export type ErrorFancy<E> =
  /** `fail` has been used in parser monad. */
  | { readonly tag: "ErrorFail"; readonly _0: string }
  /** Incorrect indentation error: desired ordering between reference level and actual level, reference indentation level, actual indentation level. */
  | { readonly tag: "ErrorIndentation"; readonly _0: Ordering; readonly _1: number; readonly _2: number }
  /** Custom error data. */
  | { readonly tag: "ErrorCustom"; readonly _0: E };
export function ErrorFail<E = never>(_0: string): ErrorFancy<E> {
  return { tag: "ErrorFail", _0 };
}
export function ErrorIndentation<E = never>(_0: Ordering, _1: number, _2: number): ErrorFancy<E> {
  return { tag: "ErrorIndentation", _0, _1, _2 };
}
export function ErrorCustom<E>(_0: E): ErrorFancy<E> {
  return { tag: "ErrorCustom", _0 };
}

const errorFancyRank = { ErrorFail: 0, ErrorIndentation: 1, ErrorCustom: 2 } as const;

/** The derived `Ord (ErrorFancy e)` instance (constructor order, then contents). */
export function compareErrorFancy<E>(a: ErrorFancy<E>, b: ErrorFancy<E>): Ordering {
  if (a.tag !== b.tag) return errorFancyRank[a.tag] < errorFancyRank[b.tag] ? -1 : 1;
  switch (a.tag) {
    case "ErrorFail": return compare(a._0, (b as typeof a)._0);
    case "ErrorIndentation": {
      const o = b as typeof a;
      return compare([a._0, a._1, a._2], [o._0, o._1, o._2]);
    }
    case "ErrorCustom": return compare(a._0, (b as typeof a)._0);
  }
}

/**
 * @ParseError s e@ represents a parse error parametrized over the stream type @s@ and the custom
 * data @e@. The offset is in tokens (characters).
 */
export type ParseError<E> =
  /** Trivial errors, generated by Megaparsec's machinery. The data constructor includes the offset of error, unexpected token (if any), and expected tokens. */
  | { readonly tag: "TrivialError"; readonly _0: number; readonly _1: Maybe<ErrorItem>; readonly _2: S.Set<ErrorItem> }
  /** Fancy, custom errors. */
  | { readonly tag: "FancyError"; readonly _0: number; readonly _1: S.Set<ErrorFancy<E>> };
export function TrivialError<E = never>(_0: number, _1: Maybe<ErrorItem>, _2: S.Set<ErrorItem>): ParseError<E> {
  return { tag: "TrivialError", _0, _1, _2 };
}
export function FancyError<E>(_0: number, _1: S.Set<ErrorFancy<E>>): ParseError<E> {
  return { tag: "FancyError", _0, _1 };
}

/** An empty set of expected items. */
export function noItems(): S.Set<ErrorItem> {
  return S.empty<ErrorItem>(compareErrorItem);
}
/** A set of expected items. */
export function itemSet(xs: readonly ErrorItem[]): S.Set<ErrorItem> {
  return S.fromList(xs, compareErrorItem);
}
function fancySet<E>(xs: readonly ErrorFancy<E>[]): S.Set<ErrorFancy<E>> {
  return S.fromList(xs, compareErrorFancy as (a: ErrorFancy<E>, b: ErrorFancy<E>) => Ordering);
}

/** Get the offset of a `ParseError`. */
export function errorOffset<E>(e: ParseError<E>): number {
  return e._0;
}

/**
 * Merge two error data structures into one joining their collections of message items and
 * preferring the longest match. In other words, earlier error message is discarded. This may
 * seem counter-intuitive, but `mergeError` is only used to merge error messages of alternative
 * branches of parsing and in this case longest match should be preferred.
 */
export function mergeError<E>(e1: ParseError<E>, e2: ParseError<E>): ParseError<E> {
  const o1 = errorOffset(e1), o2 = errorOffset(e2);
  if (o1 < o2) return e2;
  if (o1 > o2) return e1;
  if (e1.tag === "TrivialError" && e2.tag === "TrivialError") {
    const u1 = e1._1, u2 = e2._1;
    const u: Maybe<ErrorItem> =
      u1.tag === "Nothing" ? u2
        : u2.tag === "Nothing" ? u1
          : compareErrorItem(u1.value, u2.value) >= 0 ? u1 : u2;
    return TrivialError(e1._0, u, S.union(e1._2, e2._2));
  }
  if (e1.tag === "FancyError" && e2.tag === "TrivialError") return e1;
  if (e1.tag === "TrivialError" && e2.tag === "FancyError") return e2;
  return FancyError(e1._0, S.union((e1 as any)._1, (e2 as any)._1));
}

/** The type class defines how to print a custom component of `ParseError`. */
export interface ShowErrorComponent<E> {
  /** Pretty-print a component of `ParseError`. */
  showErrorComponent(e: E): string;
  /** Length of the error component in characters, used for highlighting of parse errors in input string. Defaults to 1. */
  errorComponentLen?(e: E): number;
}

/** Default rendering of custom error components: text verbatim, anything else via `String`. */
export const ShowErrorComponent_default: ShowErrorComponent<any> = {
  showErrorComponent: (e: any) => (typeof e === "string" ? e : String(e)),
};

/** The position in a source file. Lines and columns start at 1. */
export interface SourcePos {
  readonly sourceName: string;
  readonly sourceLine: number;
  readonly sourceColumn: number;
}
export function SourcePos(sourceName: string, sourceLine: number, sourceColumn: number): SourcePos {
  return { sourceName, sourceLine, sourceColumn };
}
/** Construct initial position (line 1, column 1) given the name of the source file. */
export function initialPos(name: string): SourcePos {
  return SourcePos(name, 1, 1);
}
/** Pretty-print a `SourcePos`. */
export function sourcePosPretty(p: SourcePos): string {
  const showLC = String(p.sourceLine) + ":" + String(p.sourceColumn);
  return p.sourceName.length === 0 ? showLC : p.sourceName + ":" + showLC;
}

/** A special kind of state that is used to calculate line/column positions on demand. */
export interface PosState {
  /** The rest of input to process. */
  readonly pstateInput: string;
  /** Offset corresponding to beginning of `pstateInput`. */
  readonly pstateOffset: number;
  /** Source position corresponding to beginning of `pstateInput`. */
  readonly pstateSourcePos: SourcePos;
  /** Tab width to use for column calculation. */
  readonly pstateTabWidth: number;
  /** Prefix to prepend to offending line. */
  readonly pstateLinePrefix: string;
}
export function PosState(
  pstateInput: string, pstateOffset: number, pstateSourcePos: SourcePos, pstateTabWidth: number,
  pstateLinePrefix: string,
): PosState {
  return { pstateInput, pstateOffset, pstateSourcePos, pstateTabWidth, pstateLinePrefix };
}

/** Value of tab width used by default. */
export const defaultTabWidth = 8;

/**
 * A non-empty collection of `ParseError`s equipped with `PosState` that allows us to pretty-print
 * the errors efficiently and correctly.
 */
export interface ParseErrorBundle<E> {
  /** A collection of `ParseError`s that is sorted by parse error offsets. */
  readonly bundleErrors: readonly ParseError<E>[];
  /** The state that is used for line/column calculation. */
  readonly bundlePosState: PosState;
}
export function ParseErrorBundle<E>(bundleErrors: readonly ParseError<E>[], bundlePosState: PosState): ParseErrorBundle<E> {
  return { bundleErrors, bundlePosState };
}

/**
 * Given an offset and a `PosState`, return the offending line (with tabs expanded) and the
 * updated `PosState` (`reachOffset` for a `Text` stream).
 */
export function reachOffset(o: number, pst: PosState): [Maybe<string>, PosState] {
  const input = Array.from(pst.pstateInput);
  const n = Math.max(0, o - pst.pstateOffset);
  const pre = input.slice(0, n), post = input.slice(n);
  const w = pst.pstateTabWidth;
  let line = pst.pstateSourcePos.sourceLine;
  let col = pst.pstateSourcePos.sourceColumn;
  let lineChars: string[] = [];
  for (const ch of pre) {
    if (ch === "\n") {
      line += 1;
      col = 1;
      lineChars = [];
    } else if (ch === "\t") {
      col = col + w - ((col - 1) % w);
      lineChars.push(ch);
    } else {
      col += 1;
      lineChars.push(ch);
    }
  }
  const spos = SourcePos(pst.pstateSourcePos.sourceName, line, col);
  const sameLine = line === pst.pstateSourcePos.sourceLine;
  const restOfLine: string[] = [];
  for (const ch of post) {
    if (ch === "\n") break;
    restOfLine.push(ch);
  }
  const before = lineChars.join("");
  const shown = expandTab(w, (sameLine ? pst.pstateLinePrefix : "") + before + restOfLine.join(""));
  return [
    Just(shown.length === 0 ? "<empty line>" : shown),
    PosState(post.join(""), Math.max(pst.pstateOffset, o), spos, w, sameLine ? pst.pstateLinePrefix + before : before),
  ];
}

function expandTab(w: number, s: string): string {
  return s.replace(/\t/g, " ".repeat(w));
}

/**
 * Pretty-print a `ParseErrorBundle`. All `ParseError`s in the bundle will be pretty-printed in
 * order together with the corresponding offending lines by doing a single pass over the input
 * stream. The rendered `String` always ends with a newline.
 */
export function errorBundlePretty<E>(bundle: ParseErrorBundle<E>): string;
export function errorBundlePretty<E>(dict: ShowErrorComponent<E>, bundle: ParseErrorBundle<E>): string;
export function errorBundlePretty<E>(a: any, b?: any): string {
  const [dict, bundle] = b === undefined
    ? [ShowErrorComponent_default as ShowErrorComponent<E>, a as ParseErrorBundle<E>]
    : [a as ShowErrorComponent<E>, b as ParseErrorBundle<E>];
  let out = "";
  let pst = bundle.bundlePosState;
  for (const e of bundle.bundleErrors) {
    const [msline, pst1] = reachOffset(errorOffset(e), pst);
    pst = pst1;
    const epos = pst1.pstateSourcePos;
    let elen: number;
    if (e.tag === "TrivialError") {
      elen = e._1.tag === "Nothing" ? 1 : errorItemLength(e._1.value);
    } else {
      elen = S.foldl((acc: number, x: ErrorFancy<E>) => Math.max(acc, errorFancyLength(dict, x)), 1, e._1);
    }
    let offendingLine = "";
    if (msline.tag === "Just") {
      const sline = msline.value;
      const slineLen = Array.from(sline).length;
      const rpshift = epos.sourceColumn - 1;
      const pointerLen = rpshift + elen > slineLen ? slineLen - rpshift + 1 : elen;
      const rpadding = pointerLen > 0 ? " ".repeat(rpshift) : "";
      const pointer = "^".repeat(Math.max(0, pointerLen));
      const lineNumber = String(epos.sourceLine);
      const padding = " ".repeat(lineNumber.length + 1);
      offendingLine = padding + "|\n" + lineNumber + " | " + sline + "\n" + padding + "| " + rpadding + pointer + "\n";
    }
    out += "\n" + sourcePosPretty(epos) + ":\n" + offendingLine + parseErrorTextPretty(dict, e);
  }
  return out.slice(1);
}

/** Pretty-print a `ParseError`. The rendered `String` always ends with a newline. */
export function parseErrorPretty<E>(e: ParseError<E>): string;
export function parseErrorPretty<E>(dict: ShowErrorComponent<E>, e: ParseError<E>): string;
export function parseErrorPretty<E>(a: any, b?: any): string {
  const [dict, e] = b === undefined ? [ShowErrorComponent_default, a] : [a, b];
  return "offset=" + String(errorOffset(e)) + ":\n" + parseErrorTextPretty(dict, e);
}

/**
 * Pretty-print a textual part of a `ParseError`, that is, everything except for its position.
 * The rendered `String` always ends with a newline.
 */
export function parseErrorTextPretty<E>(e: ParseError<E>): string;
export function parseErrorTextPretty<E>(dict: ShowErrorComponent<E>, e: ParseError<E>): string;
export function parseErrorTextPretty<E>(a: any, b?: any): string {
  const [dict, e] = (b === undefined ? [ShowErrorComponent_default, a] : [a, b]) as [ShowErrorComponent<E>, ParseError<E>];
  if (e.tag === "TrivialError") {
    const us = e._1, ps = e._2;
    if (us.tag === "Nothing" && S.size(ps) === 0) return "unknown parse error\n";
    return messageItemsPretty("unexpected ", us.tag === "Just" ? [showErrorItem(us.value)] : [])
      + messageItemsPretty("expecting ", S.toList(ps).map(showErrorItem));
  }
  const xs = S.toList(e._1);
  if (xs.length === 0) return "unknown fancy parse error\n";
  return xs.map((x) => showErrorFancy(dict, x) + "\n").join("");
}

/** Pretty-print an `ErrorItem`. */
export function showErrorItem(item: ErrorItem): string {
  switch (item.tag) {
    case "Tokens": return stringPretty(item._0);
    case "Label": return item._0;
    case "EndOfInput": return "end of input";
  }
}

function errorItemLength(item: ErrorItem): number {
  return item.tag === "Tokens" ? item._0.length : 1;
}

function showErrorFancy<E>(dict: ShowErrorComponent<E>, x: ErrorFancy<E>): string {
  switch (x.tag) {
    case "ErrorFail": return x._0;
    case "ErrorIndentation": {
      const ord = x._0 === 0 ? "equal to " : x._0 < 0 ? "less than " : "greater than ";
      return "incorrect indentation (got " + String(x._2) + ", should be " + ord + String(x._1) + ")";
    }
    case "ErrorCustom": return dict.showErrorComponent(x._0);
  }
}

function errorFancyLength<E>(dict: ShowErrorComponent<E>, x: ErrorFancy<E>): number {
  if (x.tag === "ErrorCustom") return dict.errorComponentLen ? dict.errorComponentLen(x._0) : 1;
  return 1;
}

/** Transform a list of message items into their textual representation (sorted and unique, as a `Set String`). */
function messageItemsPretty(prefix: string, items: readonly string[]): string {
  const ts = Array.from(new Set(items)).sort((x, y) => compare(Array.from(x).map(cp), Array.from(y).map(cp)));
  if (ts.length === 0) return "";
  return prefix + orList(ts) + "\n";
}
function cp(c: string): number {
  return c.codePointAt(0) ?? 0;
}

/** Print a pretty list where items are separated with commas and the word “or” according to the rules of English punctuation. */
function orList(xs: readonly string[]): string {
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return xs[0] + " or " + xs[1];
  return xs.slice(0, -1).join(", ") + ", or " + xs[xs.length - 1];
}

/** @stringPretty s@ returns pretty representation of string @s@. This is used when printing string tokens in error messages. */
function stringPretty(xs: readonly string[]): string {
  if (xs.length === 1) return charPretty(xs[0]);
  if (xs.length === 2 && xs[0] === "\r" && xs[1] === "\n") return "crlf newline";
  return "\"" + xs.map((ch) => {
    const p = charPretty_(ch);
    return p.tag === "Nothing" ? ch : "<" + p.value + ">";
  }).join("") + "\"";
}

/** @charPretty ch@ returns user-friendly string representation of given character @ch@, suitable for using in error messages. */
function charPretty(ch: string): string {
  if (ch === " ") return "space";
  const p = charPretty_(ch);
  return p.tag === "Just" ? p.value : "'" + ch + "'";
}

const charNames: readonly string[] = [
  "null", "start of heading", "start of text", "end of text", "end of transmission", "enquiry",
  "acknowledge", "bell", "backspace", "tab", "newline", "vertical tab", "form feed",
  "carriage return", "shift out", "shift in", "data link escape", "device control one",
  "device control two", "device control three", "device control four", "negative acknowledge",
  "synchronous idle", "end of transmission block", "cancel", "end of medium", "substitute",
  "escape", "file separator", "group separator", "record separator", "unit separator",
];

/** If the given character has a pretty representation, return that, otherwise `Nothing`. */
function charPretty_(ch: string): Maybe<string> {
  const c = cp(ch);
  if (c < 32) return Just(charNames[c]);
  if (c === 127) return Just("delete");
  if (c === 160) return Just("non-breaking space");
  return Nothing;
}

// =============================================================================================
// Parser state and running parsers

/** Hints: expected items that will be added to an error at the current position. */
export type Hints = S.Set<ErrorItem>;

/** The mutable state of a running parser. */
export interface ParseState {
  /** The whole input, as code points. */
  readonly input: readonly string[];
  /** Current offset into `input`. */
  offset: number;
  /** Hints left by the previous parser in the current sequence. */
  hints: Hints;
}

/** A parser: reads from the state, advancing `st.offset`, and returns the result or throws `ParseFailure`. */
export type Parser<A> = (st: ParseState) => A;

/** Thrown by a failing parser. Not an `Error` subclass, to keep backtracking cheap. */
export class ParseFailure {
  constructor(readonly error: ParseError<any>) {}
}

const NO_HINTS: Hints = S.empty<ErrorItem>(compareErrorItem);

/** A fresh parser state for the input text. */
export function initialState(input: string): ParseState {
  return { input: Array.from(input), offset: 0, hints: NO_HINTS };
}

/**
 * @parse p file input@ runs parser @p@ over the input. The @file@ is only used in error messages
 * and may be the empty string. Returns either a `ParseErrorBundle` or the parsed value.
 */
export function parse<A, E = string>(p: Parser<A>, name: string, input: string): Either<ParseErrorBundle<E>, A> {
  const st = initialState(input);
  const r = runReply(p, st);
  if (r.ok) return Right(r.value);
  return Left(ParseErrorBundle<E>([r.error], PosState(input, 0, initialPos(name), defaultTabWidth, "")));
}

/** The same as `parse`. */
export const runParser = parse;

/** @parseMaybe p input@ runs the parser @p@ on @input@ and returns the result inside `Just` on success and `Nothing` on failure. The parser must consume all input. */
export function parseMaybe<A>(p: Parser<A>, input: string): Maybe<A> {
  const r = parse(seqL(p, eof), "", input);
  return r.tag === "Right" ? Just(r.value) : Nothing;
}

// ---------------------------------------------------------------------------------------------
// Internal machinery: replies.

/** The outcome of running a parser in isolation (no incoming hints). */
type Reply<A> =
  | { readonly ok: true; readonly consumed: boolean; readonly value: A; readonly hints: Hints }
  | { readonly ok: false; readonly consumed: boolean; readonly error: ParseError<any> };

/**
 * Run a parser with no incoming hints and catch its failure. Afterwards `st.hints` is restored to
 * the incoming hints and `st.offset` reflects the outcome.
 */
function runReply<A>(p: Parser<A>, st: ParseState): Reply<A> {
  const start = st.offset;
  const hIn = st.hints;
  st.hints = NO_HINTS;
  try {
    const value = p(st);
    const hints = st.hints;
    st.hints = hIn;
    return { ok: true, consumed: st.offset > start, value, hints };
  } catch (e) {
    st.hints = hIn;
    if (e instanceof ParseFailure) return { ok: false, consumed: st.offset > start, error: e.error };
    throw e;
  }
}

/** Deliver a reply to the enclosing sequence, applying the incoming hints (`st.hints`). */
function deliver<A>(st: ParseState, start: number, r: Reply<A>): A {
  if (r.ok) {
    st.hints = r.consumed ? r.hints : unionHints(st.hints, r.hints);
    return r.value;
  }
  if (r.consumed) throw new ParseFailure(r.error);
  st.offset = start;
  throw new ParseFailure(withHints(st.hints, r.error));
}

function unionHints(h1: Hints, h2: Hints): Hints {
  if (S.size(h1) === 0) return h2;
  if (S.size(h2) === 0) return h1;
  return S.union(h1, h2);
}

/** Add hints to a trivial error. */
function withHints<E>(hs: Hints, e: ParseError<E>): ParseError<E> {
  if (e.tag === "TrivialError" && S.size(hs) > 0) return TrivialError(e._0, e._1, S.union(e._2, hs));
  return e;
}

/** Convert a parse error at the current stream position into hints. */
function toHints<E>(streamPos: number, e: ParseError<E>): Hints {
  if (e.tag === "TrivialError" && streamPos === e._0) return e._2;
  return NO_HINTS;
}

function refreshHints(hs: Hints, m: Maybe<ErrorItem>): Hints {
  if (m.tag === "Nothing") return NO_HINTS;
  return S.size(hs) === 0 ? hs : S.singleton(m.value, compareErrorItem);
}

/** Fail at the current position without consuming input. */
function emptyFailure(st: ParseState, e: ParseError<any>): never {
  throw new ParseFailure(withHints(st.hints, e));
}

// =============================================================================================
// Primitive parsers (MonadParsec)

/** Haskell `pure x` / `return x`: succeed without consuming input. */
export function pure<A>(x: A): Parser<A> {
  return () => x;
}

/** Haskell `empty` / `mzero`: fail without consuming input and with no error message items. */
export const empty: Parser<never> = (st) => emptyFailure(st, TrivialError(st.offset, Nothing, NO_HINTS));

/** Haskell `f <$> p` */
export function mapP<A, B>(f: (a: A) => B, p: Parser<A>): Parser<B> {
  return (st) => f(p(st));
}

/** Haskell `x <$ p` */
export function constP<A, B>(x: B, p: Parser<A>): Parser<B> {
  return (st) => {
    p(st);
    return x;
  };
}

/** Haskell `void p` */
export function void_<A>(p: Parser<A>): Parser<null> {
  return (st) => {
    p(st);
    return null;
  };
}

/** Haskell `p <* q` */
export function seqL<A, B>(p: Parser<A>, q: Parser<B>): Parser<A> {
  return (st) => {
    const x = p(st);
    q(st);
    return x;
  };
}

/** Haskell `p *> q` */
export function seqR<A, B>(p: Parser<A>, q: Parser<B>): Parser<B> {
  return (st) => {
    p(st);
    return q(st);
  };
}

/**
 * Haskell `p1 <|> p2 <|> ...` (left associative). The second alternative is only tried when the
 * first failed without consuming input. Errors at the same position are merged and failures turn
 * into hints when a later alternative succeeds without consuming input.
 */
export function alt<A>(...ps: readonly Parser<A>[]): Parser<A> {
  if (ps.length === 0) return empty;
  return ps.reduce((m, n) => alt2(m, n));
}

function alt2<A>(m: Parser<A>, n: Parser<A>): Parser<A> {
  return (st) => {
    const start = st.offset;
    const r1 = runReply(m, st);
    if (r1.ok || r1.consumed) return deliver(st, start, r1);
    st.offset = start;
    const r2 = runReply(n, st);
    if (r2.ok) {
      if (r2.consumed) return deliver(st, start, r2);
      return deliver(st, start, { ...r2, hints: unionHints(toHints(st.offset, r1.error), r2.hints) });
    }
    return deliver(st, start, { ok: false, consumed: r2.consumed, error: mergeError(r2.error, r1.error) });
  };
}

/**
 * The parser @try_(p)@ behaves like the parser @p@, except that it backtracks the parser state
 * when @p@ fails (either consuming input or not). (Haskell `try`.)
 */
export function try_<A>(p: Parser<A>): Parser<A> {
  return (st) => {
    const start = st.offset;
    const r = runReply(p, st);
    if (!r.ok) {
      st.offset = start;
      return deliver(st, start, { ...r, consumed: false });
    }
    return deliver(st, start, r);
  };
}

/**
 * If @p@ in @lookAhead(p)@ succeeds (either consuming input or not) the whole parser behaves
 * like @p@ succeeded without consuming anything. If @p@ fails, @lookAhead@ has the same effect.
 */
export function lookAhead<A>(p: Parser<A>): Parser<A> {
  return (st) => {
    const start = st.offset;
    const r = runReply(p, st);
    if (r.ok) {
      st.offset = start;
      return deliver(st, start, { ok: true, consumed: false, value: r.value, hints: NO_HINTS });
    }
    return deliver(st, start, r);
  };
}

/**
 * @notFollowedBy(p)@ only succeeds when the parser @p@ fails. This parser never consumes any
 * input and never modifies parser state.
 */
export function notFollowedBy<A>(p: Parser<A>): Parser<null> {
  return (st) => {
    const start = st.offset;
    const what = start < st.input.length ? Tokens([st.input[start]]) : EndOfInput;
    const r = runReply(p, st);
    st.offset = start;
    if (r.ok) return deliver(st, start, { ok: false, consumed: false, error: TrivialError(start, Just(what), NO_HINTS) });
    return deliver(st, start, { ok: true, consumed: false, value: null, hints: NO_HINTS });
  };
}

/**
 * The parser @label(name, p)@ behaves as parser @p@, but whenever the parser @p@ fails /without
 * consuming any input/, it replaces names of “expected” tokens with the name @name@.
 */
export function label<A>(l: string, p: Parser<A>): Parser<A> {
  const el: Maybe<ErrorItem> = l.length === 0 ? Nothing : Just(Label(l));
  return (st) => {
    const start = st.offset;
    const r = runReply(p, st);
    if (r.ok) {
      if (r.consumed) return deliver(st, start, el.tag === "Nothing" ? { ...r, hints: NO_HINTS } : r);
      return deliver(st, start, { ...r, hints: refreshHints(r.hints, el) });
    }
    if (!r.consumed && r.error.tag === "TrivialError") {
      const exp = el.tag === "Just" ? S.singleton(el.value, compareErrorItem) : NO_HINTS;
      return deliver(st, start, { ...r, error: TrivialError(r.error._0, r.error._1, exp) });
    }
    return deliver(st, start, r);
  };
}

/** Haskell @p <?> name@, the same as @label name p@. */
export function labelled<A>(p: Parser<A>, l: string): Parser<A> {
  return label(l, p);
}

/** @hidden(p)@ behaves just like parser @p@, but it doesn't show any “expected” tokens in error message when @p@ fails. */
export function hidden<A>(p: Parser<A>): Parser<A> {
  return label("", p);
}

/** Stop parsing and report a trivial `ParseError`. */
export function failure(us: Maybe<ErrorItem>, ps: S.Set<ErrorItem>): Parser<never> {
  return (st) => emptyFailure(st, TrivialError(st.offset, us, ps));
}

/** Stop parsing and report a fancy `ParseError`. */
export function fancyFailure<E>(xs: S.Set<ErrorFancy<E>>): Parser<never> {
  return (st) => {
    throw new ParseFailure(FancyError(st.offset, xs));
  };
}

/** The parser @unexpected(item)@ fails with an error message telling about unexpected item @item@ without consuming any input. */
export function unexpected(item: ErrorItem): Parser<never> {
  return failure(Just(item), NO_HINTS);
}

/** Report a custom parse error. */
export function customFailure<E>(e: E): Parser<never> {
  return fancyFailure(fancySet([ErrorCustom(e)]));
}

/** Haskell `fail` (MonadFail): report an `ErrorFail` message at the current position. */
export function fail(msg: string): Parser<never> {
  return fancyFailure(fancySet([ErrorFail(msg)]));
}

/** Return the number of characters consumed so far. */
export const getOffset: Parser<number> = (st) => st.offset;

/** Return the rest of the input. */
export const getInput: Parser<string> = (st) => st.input.slice(st.offset).join("");

/**
 * The parser @token(test, expected)@ accepts a token @t@ with result @x@ when the function
 * @test t@ returns @Just x@. @expected@ specifies the collection of expected items to report in
 * error messages.
 */
export function token<A>(test: (c: string) => Maybe<A>, expected: S.Set<ErrorItem>): Parser<A> {
  return (st) => {
    const o = st.offset;
    if (o >= st.input.length) return emptyFailure(st, TrivialError(o, Just(EndOfInput), expected));
    const c = st.input[o];
    const r = test(c);
    if (r.tag === "Nothing") return emptyFailure(st, TrivialError(o, Just(Tokens([c])), expected));
    st.offset = o + 1;
    st.hints = NO_HINTS;
    return r.value;
  };
}

/** The parser @tokens(test, chk)@ parses a chunk of input @chk@ and returns it, using @test@ to compare. The parser is atomic. */
export function tokens(test: (expected: string, actual: string) => boolean, chk: string): Parser<string> {
  const tts = Array.from(chk);
  const len = tts.length;
  return (st) => {
    const o = st.offset;
    const ps = len > 0 ? S.singleton(Tokens(tts), compareErrorItem) : NO_HINTS;
    if (len > 0 && o >= st.input.length) return emptyFailure(st, TrivialError(o, Just(EndOfInput), ps));
    const actual = st.input.slice(o, o + len);
    const actualStr = actual.join("");
    if (test(chk, actualStr)) {
      if (len === 0) return actualStr;
      st.offset = o + len;
      st.hints = NO_HINTS;
      return actualStr;
    }
    return emptyFailure(st, TrivialError(o, Just(Tokens(actual)), ps));
  };
}

/**
 * Parse /zero/ or more tokens for which the supplied predicate holds. The label, if given, is
 * used as a hint. This parser never fails.
 */
export function takeWhileP(ml: Maybe<string>, f: (c: string) => boolean): Parser<string> {
  const hs: Hints = ml.tag === "Just" && ml.value.length > 0 ? S.singleton(Label(ml.value), compareErrorItem) : NO_HINTS;
  return (st) => {
    const o = st.offset;
    let i = o;
    while (i < st.input.length && f(st.input[i])) i++;
    const ts = st.input.slice(o, i).join("");
    if (i === o) {
      st.hints = unionHints(st.hints, hs);
    } else {
      st.offset = i;
      st.hints = hs;
    }
    return ts;
  };
}

/** Like `takeWhileP`, but fails (without consuming input) unless at least one token matches. */
export function takeWhile1P(ml: Maybe<string>, f: (c: string) => boolean): Parser<string> {
  const el: Maybe<ErrorItem> = ml.tag === "Just" && ml.value.length > 0 ? Just(Label(ml.value)) : Nothing;
  const hs: Hints = el.tag === "Just" ? S.singleton(el.value, compareErrorItem) : NO_HINTS;
  return (st) => {
    const o = st.offset;
    let i = o;
    while (i < st.input.length && f(st.input[i])) i++;
    if (i === o) {
      const us = o < st.input.length ? Tokens([st.input[o]]) : EndOfInput;
      return emptyFailure(st, TrivialError(o, Just(us), hs));
    }
    st.offset = i;
    st.hints = hs;
    return st.input.slice(o, i).join("");
  };
}

/** Extract the specified number of tokens from the input stream and return them packed as a chunk. Fails if there are not enough tokens. */
export function takeP(ml: Maybe<string>, n: number): Parser<string> {
  const el: Maybe<ErrorItem> = ml.tag === "Just" && ml.value.length > 0 ? Just(Label(ml.value)) : Nothing;
  const ps: Hints = el.tag === "Just" ? S.singleton(el.value, compareErrorItem) : NO_HINTS;
  return (st) => {
    const o = st.offset;
    const len = Math.max(0, n);
    if (len === 0) return "";
    if (o + len > st.input.length) {
      return emptyFailure(st, TrivialError(st.input.length, Just(EndOfInput), ps));
    }
    st.offset = o + len;
    st.hints = NO_HINTS;
    return st.input.slice(o, o + len).join("");
  };
}

/** This parser only succeeds at the end of input. */
export const eof: Parser<null> = (st) => {
  const o = st.offset;
  if (o >= st.input.length) return null;
  return emptyFailure(st, TrivialError(o, Just(Tokens([st.input[o]])), S.singleton<ErrorItem>(EndOfInput, compareErrorItem)));
};

/** Match a single token (Haskell `single`). */
export function single(t: string): Parser<string> {
  const expected = S.singleton(Tokens([t]), compareErrorItem);
  return token((c) => (c === t ? Just(c) : Nothing), expected);
}

/** The parser @satisfy(f)@ succeeds for any token for which the supplied function @f@ returns `true`. */
export function satisfy(f: (c: string) => boolean): Parser<string> {
  return token((c) => (f(c) ? Just(c) : Nothing), NO_HINTS);
}

/** Parse and return a single token. It's a good idea to attach a `label` to this parser. */
export const anySingle: Parser<string> = satisfy(() => true);

/** Match any token but the given one. It's a good idea to attach a `label` to this parser. */
export function anySingleBut(t: string): Parser<string> {
  return satisfy((c) => c !== t);
}

/** @oneOf(ts)@ succeeds if the current token is in the supplied collection of tokens @ts@. */
export function oneOf(ts: string | readonly string[]): Parser<string> {
  const set = new Set(typeof ts === "string" ? Array.from(ts) : ts);
  return satisfy((c) => set.has(c));
}

/** As the dual of `oneOf`, @noneOf(ts)@ succeeds if the current token /not/ in the supplied list of tokens @ts@. */
export function noneOf(ts: string | readonly string[]): Parser<string> {
  const set = new Set(typeof ts === "string" ? Array.from(ts) : ts);
  return satisfy((c) => !set.has(c));
}

/** @chunk(chk)@ only matches the chunk @chk@. */
export function chunk(chk: string): Parser<string> {
  return tokens((a, b) => a === b, chk);
}

// =============================================================================================
// Control.Monad.Combinators

/** @optional(p)@ tries to apply the parser @p@. It will parse @p@ or `Nothing`. It only fails if @p@ fails after consuming input. */
export function optional<A>(p: Parser<A>): Parser<Maybe<A>> {
  return alt(mapP((x: A) => Just(x), p), pure(Nothing as Maybe<A>));
}

/** @option(x, p)@ tries to apply the parser @p@. If @p@ fails without consuming input, it returns the value @x@. */
export function option<A>(x: A, p: Parser<A>): Parser<A> {
  return alt(p, pure(x));
}

/** @choice(ps)@ tries to apply the parsers in the list @ps@ in order, until one of them succeeds. */
export function choice<A>(ps: readonly Parser<A>[]): Parser<A> {
  return ps.reduceRight<Parser<A>>((acc, p) => alt2(p, acc), empty);
}

/** @many(p)@ applies the parser @p@ /zero/ or more times and returns a list of the values returned by @p@. */
export function many<A>(p: Parser<A>): Parser<A[]> {
  const opt = optional(p);
  return (st) => {
    const xs: A[] = [];
    for (;;) {
      const start = st.offset;
      const r = opt(st);
      if (r.tag === "Nothing") return xs;
      if (st.offset === start) throw new Error("Megaparsec.many: the parser accepts an empty string");
      xs.push(r.value);
    }
  };
}

/** @some(p)@ applies the parser @p@ /one/ or more times and returns a list of the values returned by @p@. */
export function some<A>(p: Parser<A>): Parser<A[]> {
  const ps = many(p);
  return (st) => {
    const x = p(st);
    const xs = ps(st);
    return [x, ...xs];
  };
}

/** @skipMany(p)@ applies the parser @p@ /zero/ or more times, skipping its result. */
export function skipMany<A>(p: Parser<A>): Parser<null> {
  return void_(many(p));
}

/** @skipSome(p)@ applies the parser @p@ /one/ or more times, skipping its result. */
export function skipSome<A>(p: Parser<A>): Parser<null> {
  return void_(some(p));
}

/** @between(open, close, p)@ parses @open@, followed by @p@ and @close@. Returns the value returned by @p@. */
export function between<O, C, A>(open: Parser<O>, close: Parser<C>, p: Parser<A>): Parser<A> {
  return (st) => {
    open(st);
    const x = p(st);
    close(st);
    return x;
  };
}

/** @count(n, p)@ parses @n@ occurrences of @p@. If @n@ is smaller or equal to zero, the parser equals to @pure []@. */
export function count<A>(n: number, p: Parser<A>): Parser<A[]> {
  return (st) => {
    const xs: A[] = [];
    for (let i = 0; i < n; i++) xs.push(p(st));
    return xs;
  };
}

/**
 * @count_(m, n, p)@ (Haskell `count'`) parses from @m@ to @n@ occurrences of @p@. If @n@ is not
 * positive or @m > n@, the parser equals to @pure []@.
 */
export function count_<A>(m: number, n: number, p: Parser<A>): Parser<A[]> {
  const opt = optional(p);
  return (st) => {
    const xs: A[] = [];
    if (!(n > 0 && n >= m)) return xs;
    for (let i = 0; i < m; i++) xs.push(p(st));
    let d = m <= 0 ? n : n - m;
    while (d > 0) {
      const r = opt(st);
      if (r.tag === "Nothing") return xs;
      xs.push(r.value);
      d--;
    }
    return xs;
  };
}

/** @skipCount(n, p)@ parses @n@ occurrences of @p@, skipping its result. */
export function skipCount<A>(n: number, p: Parser<A>): Parser<null> {
  return void_(count(n, p));
}

/** @sepBy(p, sep)@ parses /zero/ or more occurrences of @p@, separated by @sep@. */
export function sepBy<A, S>(p: Parser<A>, sep: Parser<S>): Parser<A[]> {
  return alt(sepBy1(p, sep), pure<A[]>([]));
}

/** @sepBy1(p, sep)@ parses /one/ or more occurrences of @p@, separated by @sep@. */
export function sepBy1<A, S>(p: Parser<A>, sep: Parser<S>): Parser<A[]> {
  const rest = many(seqR(sep, p));
  return (st) => {
    const x = p(st);
    return [x, ...rest(st)];
  };
}

/** @endBy(p, sep)@ parses /zero/ or more occurrences of @p@, separated and ended by @sep@. */
export function endBy<A, S>(p: Parser<A>, sep: Parser<S>): Parser<A[]> {
  return many(seqL(p, sep));
}

/** @endBy1(p, sep)@ parses /one/ or more occurrences of @p@, separated and ended by @sep@. */
export function endBy1<A, S>(p: Parser<A>, sep: Parser<S>): Parser<A[]> {
  return some(seqL(p, sep));
}

/** @sepEndBy(p, sep)@ parses /zero/ or more occurrences of @p@, separated and optionally ended by @sep@. */
export function sepEndBy<A, S>(p: Parser<A>, sep: Parser<S>): Parser<A[]> {
  return alt(sepEndBy1(p, sep), pure<A[]>([]));
}

/** @sepEndBy1(p, sep)@ parses /one/ or more occurrences of @p@, separated and optionally ended by @sep@. */
export function sepEndBy1<A, S>(p: Parser<A>, sep: Parser<S>): Parser<A[]> {
  const self: Parser<A[]> = (st) => {
    const x = p(st);
    const xs = alt(seqR(sep, sepEndBy(p, sep)), pure<A[]>([]))(st);
    return [x, ...xs];
  };
  return self;
}

/**
 * @manyTill(p, end)@ applies parser @p@ /zero/ or more times until parser @end@ succeeds.
 * Returns the list of values returned by @p@.
 */
export function manyTill<A, End>(p: Parser<A>, end: Parser<End>): Parser<A[]> {
  const done = option(false, constP(true, end));
  return (st) => {
    const xs: A[] = [];
    for (;;) {
      if (done(st)) return xs;
      xs.push(p(st));
    }
  };
}

/** @someTill(p, end)@ works similarly to @manyTill(p, end)@, but @p@ should succeed at least once. */
export function someTill<A, End>(p: Parser<A>, end: Parser<End>): Parser<A[]> {
  const rest = manyTill(p, end);
  return (st) => {
    const x = p(st);
    return [x, ...rest(st)];
  };
}

// =============================================================================================
// Control.Monad.Combinators.Expr

/** This data type specifies operators that work on values of type @a@. An operator is either binary infix or unary prefix or postfix. A binary operator has also an associated associativity. */
export type Operator<A> =
  /** Non-associative infix. */
  | { readonly tag: "InfixN"; readonly _0: Parser<(x: A, y: A) => A> }
  /** Left-associative infix. */
  | { readonly tag: "InfixL"; readonly _0: Parser<(x: A, y: A) => A> }
  /** Right-associative infix. */
  | { readonly tag: "InfixR"; readonly _0: Parser<(x: A, y: A) => A> }
  /** Prefix. */
  | { readonly tag: "Prefix"; readonly _0: Parser<(x: A) => A> }
  /** Postfix. */
  | { readonly tag: "Postfix"; readonly _0: Parser<(x: A) => A> }
  /** Right-associative ternary. The outer parser parses the first separator and returns the parser of the second one. */
  | { readonly tag: "TernR"; readonly _0: Parser<Parser<(x: A, y: A, z: A) => A>> };
export function InfixN<A>(_0: Parser<(x: A, y: A) => A>): Operator<A> {
  return { tag: "InfixN", _0 };
}
export function InfixL<A>(_0: Parser<(x: A, y: A) => A>): Operator<A> {
  return { tag: "InfixL", _0 };
}
export function InfixR<A>(_0: Parser<(x: A, y: A) => A>): Operator<A> {
  return { tag: "InfixR", _0 };
}
export function Prefix<A>(_0: Parser<(x: A) => A>): Operator<A> {
  return { tag: "Prefix", _0 };
}
export function Postfix<A>(_0: Parser<(x: A) => A>): Operator<A> {
  return { tag: "Postfix", _0 };
}
export function TernR<A>(_0: Parser<Parser<(x: A, y: A, z: A) => A>>): Operator<A> {
  return { tag: "TernR", _0 };
}

/**
 * @makeExprParser(term, table)@ builds an expression parser for terms @term@ with operators from
 * @table@, taking the associativity and precedence specified in the @table@ into account.
 *
 * @table@ is a list of lists of `Operator`s. The outer list is ordered in descending precedence:
 * all operators in one list have the same precedence (but may have different associativity).
 * Prefix and postfix operators of the same precedence associate to the left (i.e. if @++@ is
 * postfix increment, than @-2++@ equals @-1@, not @-3@). Unary operators of the same precedence
 * can only occur once (i.e. @--2@ is not allowed if @-@ is prefix negate).
 */
export function makeExprParser<A>(term: Parser<A>, table: readonly (readonly Operator<A>[])[]): Parser<A> {
  return table.reduce<Parser<A>>((t, ops) => addPrecLevel(t, ops), term);
}

/** @addPrecLevel(p, ops)@ adds the ability to parse operators in table @ops@ to parser @p@. */
function addPrecLevel<A>(term: Parser<A>, ops: readonly Operator<A>[]): Parser<A> {
  const ras: Parser<(x: A, y: A) => A>[] = [];
  const las: Parser<(x: A, y: A) => A>[] = [];
  const nas: Parser<(x: A, y: A) => A>[] = [];
  const prefix: Parser<(x: A) => A>[] = [];
  const postfix: Parser<(x: A) => A>[] = [];
  const tern: Parser<Parser<(x: A, y: A, z: A) => A>>[] = [];
  for (const op of ops) {
    switch (op.tag) {
      case "InfixR": ras.push(op._0); break;
      case "InfixL": las.push(op._0); break;
      case "InfixN": nas.push(op._0); break;
      case "Prefix": prefix.push(op._0); break;
      case "Postfix": postfix.push(op._0); break;
      case "TernR": tern.push(op._0); break;
    }
  }
  const term_ = pTerm(choice(prefix), term, choice(postfix));
  const rasOp = choice(ras), lasOp = choice(las), nasOp = choice(nas), ternOp = choice(tern);
  return (st) => {
    const x = term_(st);
    return choice([
      pInfixR(rasOp, term_, x),
      pInfixL(lasOp, term_, x),
      pInfixN(nasOp, term_, x),
      pTernR(ternOp, term_, x),
      pure(x),
    ])(st);
  };
}

/** @pTerm(prefix, term, postfix)@ parses a @term@ surrounded by optional prefix and postfix unary operators. */
function pTerm<A>(prefix: Parser<(x: A) => A>, term: Parser<A>, postfix: Parser<(x: A) => A>): Parser<A> {
  const id = (x: A) => x;
  const pre = option(id, prefix);
  const post = option(id, postfix);
  return (st) => {
    const f = pre(st);
    const x = term(st);
    const g = post(st);
    return g(f(x));
  };
}

/** @pInfixN(op, p, x)@ parses non-associative infix operator @op@, then term with parser @p@, then returns result of the operator application on @x@ and the term. */
function pInfixN<A>(op: Parser<(x: A, y: A) => A>, p: Parser<A>, x: A): Parser<A> {
  return (st) => {
    const f = op(st);
    const y = p(st);
    return f(x, y);
  };
}

/**
 * @pInfixL(op, p, x)@ parses left-associative infix operator @op@, then term with parser @p@,
 * then returns result of the operator application on @x@ and the term.
 *
 * The Haskell definition recurses as @pInfixL op p r <|> return r@; this is the equivalent loop.
 */
function pInfixL<A>(op: Parser<(x: A, y: A) => A>, p: Parser<A>, x: A): Parser<A> {
  const step = (acc: A): Parser<A> => (st) => {
    const f = op(st);
    const y = p(st);
    return f(acc, y);
  };
  return (st) => {
    let acc = step(x)(st);
    for (;;) {
      const start = st.offset;
      const r = runReply(step(acc), st);
      if (!r.ok && !r.consumed) {
        // `<|> return acc`
        st.offset = start;
        st.hints = unionHints(st.hints, toHints(st.offset, r.error));
        return acc;
      }
      acc = deliver(st, start, r);
    }
  };
}

/** @pInfixR(op, p, x)@ parses right-associative infix operator @op@, then term with parser @p@, then returns result of the operator application on @x@ and the term. */
function pInfixR<A>(op: Parser<(x: A, y: A) => A>, p: Parser<A>, x: A): Parser<A> {
  return (st) => {
    const f = op(st);
    const r = p(st);
    const y = alt(pInfixR(op, p, r), pure(r))(st);
    return f(x, y);
  };
}

/** Parse the first separator of a ternary operator. */
function pTernR<A>(sep1: Parser<Parser<(x: A, y: A, z: A) => A>>, p: Parser<A>, x: A): Parser<A> {
  return (st) => {
    const sep2 = sep1(st);
    const r1 = p(st);
    const y = alt(pTernR(sep1, p, r1), pure(r1))(st);
    const f = sep2(st);
    const r2 = p(st);
    const z = alt(pTernR(sep1, p, r2), pure(r2))(st);
    return f(x, y, z);
  };
}

// =============================================================================================
// Text.Megaparsec.Char

/** Parse a newline character. */
export const newline: Parser<string> = single("\n");

/** Parse a carriage return character followed by a newline character. Return the sequence of characters parsed. */
export const crlf: Parser<string> = chunk("\r\n");

/** Parse a CRLF (see `crlf`) or LF (see `newline`) end of line. Return the sequence of characters parsed. */
export const eol: Parser<string> = label("end of line", alt(constP("\n", newline), crlf));

/** Parse a tab character. */
export const tab: Parser<string> = single("\t");

/** Skip /zero/ or more white space characters. */
export const space: Parser<null> = void_(takeWhileP(Just("white space"), isSpace));

/** Like `space`, but does not accept newlines and carriage returns. */
export const hspace: Parser<null> = void_(takeWhileP(Just("white space"), isHSpace));

/** Skip /one/ or more white space characters. */
export const space1: Parser<null> = void_(takeWhile1P(Just("white space"), isSpace));

/** Like `space1`, but does not accept newlines and carriage returns. */
export const hspace1: Parser<null> = void_(takeWhile1P(Just("white space"), isHSpace));

function isHSpace(c: string): boolean {
  return isSpace(c) && c !== "\n" && c !== "\r";
}

/** Parse a control character. */
export const controlChar: Parser<string> = label("control character", satisfy((c) => /^\p{Cc}$/u.test(c)));

/** Parse a Unicode space character, and the control characters: tab, newline, carriage return, form feed, and vertical tab. */
export const spaceChar: Parser<string> = label("white space", satisfy(isSpace));

/** Parse an upper-case or title-case alphabetic Unicode character. */
export const upperChar: Parser<string> = label("uppercase letter", satisfy(isUpper));

/** Parse a lower-case alphabetic Unicode character. */
export const lowerChar: Parser<string> = label("lowercase letter", satisfy(isLower));

/** Parse an alphabetic Unicode character: lower-case, upper-case, or title-case letter, or a letter of case-less scripts/modifier letter. */
export const letterChar: Parser<string> = label("letter", satisfy(isLetter));

/** Parse an alphabetic or numeric digit Unicode characters. */
export const alphaNumChar: Parser<string> = label("alphanumeric character", satisfy(isAlphaNum));

/** Parse a printable Unicode character: letter, number, mark, punctuation, symbol or space. */
export const printChar: Parser<string> = label("printable character", satisfy(isPrint));

/** Parse an ASCII digit, i.e between “0” and “9”. */
export const digitChar: Parser<string> = label("digit", satisfy(isDigit));

/** Parse a binary digit, i.e. "0" or "1". */
export const binDigitChar: Parser<string> = label("binary digit", satisfy((c) => c === "0" || c === "1"));

/** Parse an octal digit, i.e. between “0” and “7”. */
export const octDigitChar: Parser<string> = label("octal digit", satisfy(isOctDigit));

/** Parse a hexadecimal digit, i.e. between “0” and “9”, or “a” and “f”, or “A” and “F”. */
export const hexDigitChar: Parser<string> = label("hexadecimal digit", satisfy(isHexDigit));

/** A type-constrained version of `single`. */
export function char(c: string): Parser<string> {
  return single(c);
}

/** The same as `char` but case-insensitive (Haskell `char'`). */
export function char_(c: string): Parser<string> {
  return choice([char(c.toLowerCase()), char(c.toUpperCase()), char(c.toUpperCase())]);
}

/** A synonym for `chunk`. */
export function string(s: string): Parser<string> {
  return chunk(s);
}

/** The same as `string`, but case-insensitive (Haskell `string'`). */
export function string_(s: string): Parser<string> {
  return tokens((a, b) => a.toLowerCase() === b.toLowerCase(), s);
}

// =============================================================================================
// Text.Megaparsec.Char.Lexer

/**
 * @lexSpace(sc, lineComment, blockComment)@ produces a parser that can parse white space in
 * general (Haskell `Lex.space`).
 */
export function lexSpace<A, B, C>(sp: Parser<A>, lineComment: Parser<B>, blockComment: Parser<C>): Parser<null> {
  return skipMany(choice<unknown>([hidden(sp), hidden(lineComment), hidden(blockComment)]));
}

/** This is a wrapper for lexemes. The argument is the space consumer used after the lexeme. */
export function lexeme<S, A>(spc: Parser<S>, p: Parser<A>): Parser<A> {
  return seqL(p, spc);
}

/** This is a helper to parse symbols, i.e. verbatim strings followed by the space consumer. */
export function symbol<S>(spc: Parser<S>, s: string): Parser<string> {
  return lexeme(spc, string(s));
}

/** Given a comment prefix this function returns a parser that skips line comments. */
export function skipLineComment(prefix: string): Parser<null> {
  return (st) => {
    string(prefix)(st);
    takeWhileP(Just("character"), (c) => c !== "\n")(st);
    return null;
  };
}

/** @skipBlockComment(start, end)@ skips non-nested block comment starting with @start@ and ending with @end@. */
export function skipBlockComment(start: string, end: string): Parser<null> {
  return (st) => {
    string(start)(st);
    manyTill(anySingle, string(end))(st);
    return null;
  };
}

function digitsToNumber(digits: string, base: number): number {
  if (base === 10) return Number(digits);
  let n = 0;
  for (const c of digits) n = n * base + parseInt(c, base);
  return n;
}

const decimal_: Parser<number> = mapP((ds: string) => Number(ds), takeWhile1P(Just("digit"), isDigit));

/** Parse an integer in the decimal representation. It does not parse the sign. */
export const decimal: Parser<number> = label("integer", decimal_);

/** Parse an integer in binary representation. The binary number is expected to be a non-empty sequence of zeroes “0” and ones “1”. */
export const binary: Parser<number> = label("binary integer",
  mapP((ds: string) => digitsToNumber(ds, 2), takeWhile1P(Just("binary digit"), (c) => c === "0" || c === "1")));

/** Parse an integer in octal representation. */
export const octal: Parser<number> = label("octal integer",
  mapP((ds: string) => digitsToNumber(ds, 8), takeWhile1P(Just("octal digit"), isOctDigit)));

/** Parse an integer in hexadecimal representation. */
export const hexadecimal: Parser<number> = label("hexadecimal integer",
  mapP((ds: string) => digitsToNumber(ds, 16), takeWhile1P(Just("hexadecimal digit"), isHexDigit)));

/** The digits of the fraction after a decimal point. */
const dotDecimal_: Parser<string> = (st) => {
  char(".")(st);
  return takeWhile1P(Just("digit"), isDigit)(st);
};

/** The exponent part of a float, as text such as @"-3"@. */
const exponent_: Parser<number> = (st) => {
  char_("e")(st);
  return signed(pure(null), decimal_)(st);
};

/**
 * Parse a floating point number according to the syntax for floating point literals described in
 * the Haskell report. This function does not parse the sign. Plain integers are not accepted:
 * either a fractional part or an exponent is required.
 */
export const float: Parser<number> = (st) => {
  const intPart = takeWhile1P(Just("digit"), isDigit)(st);
  return alt<number>(
    (st1) => {
      const frac = dotDecimal_(st1);
      const e = option(0, try_(exponent_))(st1);
      return Number(intPart + "." + frac + "e" + String(e));
    },
    (st1) => {
      const e = exponent_(st1);
      return Number(intPart + "e" + String(e));
    },
  )(st);
};

/**
 * @signed(space, p)@ parses an optional sign character (“+” or “-”), then if there is a sign it
 * consumes optional white space (using the @space@ parser), then it runs the parser @p@ which
 * should return a number. The sign of the number is changed according to the previously parsed
 * sign character.
 */
export function signed<S>(spc: Parser<S>, p: Parser<number>): Parser<number> {
  const sign: Parser<(n: number) => number> = alt(
    constP((n: number) => n, char("+")),
    constP((n: number) => -n, char("-")),
  );
  const f = option((n: number) => n, lexeme(spc, sign));
  return (st) => {
    const g = f(st);
    return g(p(st));
  };
}

/**
 * The lexeme parser parses a single literal character without quotes. The purpose of this parser
 * is to help with parsing of conventional escape sequences. It's your responsibility to take care
 * of character literal syntax in your language (by surrounding it with single quotes or similar).
 *
 * The literal character is parsed according to the grammar rules defined in the Haskell report.
 */
export const charLiteral: Parser<string> = label("literal character", (st) => {
  const r = lookAhead(count_(1, 10, anySingle))(st);
  const lit = readLitChar(r);
  if (lit.tag === "Just") {
    const [c, n] = lit.value;
    skipCount(n, anySingle)(st);
    return c;
  }
  return unexpected(Tokens([r[0]]))(st);
});

const asciiNames: readonly (readonly [string, number])[] = [
  ["NUL", 0], ["STX", 2], ["ETX", 3], ["EOT", 4], ["ENQ", 5], ["ACK", 6], ["BEL", 7],
  ["BS", 8], ["HT", 9], ["LF", 10], ["VT", 11], ["FF", 12], ["CR", 13], ["SI", 15],
  ["DLE", 16], ["DC1", 17], ["DC2", 18], ["DC3", 19], ["DC4", 20], ["NAK", 21], ["SYN", 22],
  ["ETB", 23], ["CAN", 24], ["EM", 25], ["SUB", 26], ["ESC", 27], ["FS", 28], ["GS", 29],
  ["RS", 30], ["US", 31], ["SP", 32], ["DEL", 127],
];

/**
 * Haskell `readLitChar`: read a character literal with Haskell escape conventions from the start
 * of the characters. Returns the character and the number of characters it used.
 */
export function readLitChar(cs: readonly string[]): Maybe<[string, number]> {
  if (cs.length === 0) return Nothing;
  if (cs[0] !== "\\") return Just([cs[0], 1]);
  const rest = cs.slice(1);
  if (rest.length === 0) return Nothing;
  const c = rest[0];
  const simple: Record<string, string> = {
    a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", "\"": "\"", "'": "'",
  };
  if (Object.prototype.hasOwnProperty.call(simple, c)) return Just([simple[c], 2]);
  // Numeric escapes.
  let base = 10, i = 0;
  if (c === "o") {
    base = 8;
    i = 1;
  } else if (c === "x") {
    base = 16;
    i = 1;
  }
  const isBaseDigit = base === 8 ? isOctDigit : base === 16 ? isHexDigit : isDigit;
  let j = i;
  while (j < rest.length && isBaseDigit(rest[j])) j++;
  if (j > i) {
    const n = digitsToNumber(rest.slice(i, j).join(""), base);
    if (n > 0x10ffff) return Nothing;
    return Just([String.fromCodePoint(n), 1 + j]);
  }
  if (base !== 10) return Nothing;
  // Control characters.
  if (c === "^") {
    if (rest.length < 2) return Nothing;
    const k = rest[1].codePointAt(0) ?? 0;
    if (k >= 64 && k <= 95) return Just([String.fromCodePoint(k - 64), 3]);
    return Nothing;
  }
  // ASCII names. SOH and SO need maximal munch treatment.
  const str = rest.slice(0, 3).join("");
  if (str.startsWith("SOH")) return Just(["\x01", 4]);
  if (str.startsWith("SO")) return Just(["\x0e", 3]);
  for (const [nm, code] of asciiNames) {
    if (str.startsWith(nm)) return Just([String.fromCodePoint(code), 1 + nm.length]);
  }
  return Nothing;
}

/** The `Text.Megaparsec.Char.Lexer` functions, for use as `Lex.float` etc. */
export const Lex = {
  space: lexSpace,
  lexeme,
  symbol,
  skipLineComment,
  skipBlockComment,
  decimal,
  binary,
  octal,
  hexadecimal,
  float,
  signed,
  charLiteral,
} as const;
