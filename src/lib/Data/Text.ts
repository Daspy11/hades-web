/**
 * Haskell `Data.Text` on JavaScript strings. Use as `import * as T from "@/lib/Data/Text"`.
 * Haskell argument order is preserved: `T.isPrefixOf(prefix, txt)`, `T.splitOn(sep, txt)`.
 *
 * Note: JavaScript strings are UTF-16. Functions that count characters work on code points
 * (`T.length`, `T.take`, ...) so that astral characters behave as single characters as they do
 * in Haskell `Text`.
 */
import { isSpace } from "./Char";
import { Just, Nothing, type Maybe } from "./Maybe";

export type Text = string;

export const empty: Text = "";
export function pack(s: string): Text { return s; }
export function unpack(t: Text): string { return t; }
export function singleton(c: string): Text { return c; }

function cps(t: Text): string[] {
  return Array.from(t);
}

export function isNull(t: Text): boolean { return t.length === 0; }
export { isNull as null };
export function length(t: Text): number {
  // Fast path for BMP-only strings.
  // eslint-disable-next-line no-control-regex
  return /[\uD800-\uDFFF]/.test(t) ? cps(t).length : t.length;
}
export function compareLength(t: Text, n: number): -1 | 0 | 1 {
  const l = length(t);
  return l < n ? -1 : l > n ? 1 : 0;
}

export function append(a: Text, b: Text): Text { return a + b; }
export function concat(ts: readonly Text[]): Text { return ts.join(""); }
export function concatMap(f: (c: string) => Text, t: Text): Text { return cps(t).map(f).join(""); }
export function cons(c: string, t: Text): Text { return c + t; }
export function snoc(t: Text, c: string): Text { return t + c; }
export function uncons(t: Text): Maybe<[string, Text]> {
  if (t.length === 0) return Nothing;
  const c = String.fromCodePoint(t.codePointAt(0)!);
  return Just([c, t.slice(c.length)]);
}
export function unsnoc(t: Text): Maybe<[Text, string]> {
  if (t.length === 0) return Nothing;
  const a = cps(t);
  const c = a.pop()!;
  return Just([a.join(""), c]);
}
export function head(t: Text): string {
  if (t.length === 0) throw new Error("Text.head: empty");
  return String.fromCodePoint(t.codePointAt(0)!);
}
export function last(t: Text): string {
  const a = cps(t);
  if (a.length === 0) throw new Error("Text.last: empty");
  return a[a.length - 1];
}
export function tail(t: Text): Text { return cps(t).slice(1).join(""); }
export function init(t: Text): Text { return cps(t).slice(0, -1).join(""); }
export function index(t: Text, i: number): string { return cps(t)[i]; }

export function map(f: (c: string) => string, t: Text): Text { return cps(t).map(f).join(""); }
export function filter(p: (c: string) => boolean, t: Text): Text { return cps(t).filter(p).join(""); }
export function any(p: (c: string) => boolean, t: Text): boolean { return cps(t).some(p); }
export function all(p: (c: string) => boolean, t: Text): boolean { return cps(t).every(p); }
export function elem(c: string, t: Text): boolean { return t.includes(c); }
export function find(p: (c: string) => boolean, t: Text): Maybe<string> {
  const r = cps(t).find(p);
  return r === undefined ? Nothing : Just(r);
}
export function findIndex(p: (c: string) => boolean, t: Text): Maybe<number> {
  const i = cps(t).findIndex(p);
  return i < 0 ? Nothing : Just(i);
}
export function foldr<B>(f: (c: string, acc: B) => B, z: B, t: Text): B {
  const a = cps(t);
  let acc = z;
  for (let i = a.length - 1; i >= 0; i--) acc = f(a[i], acc);
  return acc;
}
export function foldl<B>(f: (acc: B, c: string) => B, z: B, t: Text): B {
  let acc = z;
  for (const c of t) acc = f(acc, c);
  return acc;
}

export function reverse(t: Text): Text { return cps(t).reverse().join(""); }
export function replicate(n: number, t: Text): Text { return n > 0 ? t.repeat(n) : ""; }
export function intercalate(sep: Text, ts: readonly Text[]): Text { return ts.join(sep); }
export function intersperse(c: string, t: Text): Text { return cps(t).join(c); }
export function transpose(ts: readonly Text[]): Text[] {
  const arrs = ts.map(cps);
  const n = Math.max(0, ...arrs.map((a) => a.length));
  const r: Text[] = [];
  for (let i = 0; i < n; i++) r.push(arrs.map((a) => a[i] ?? "").join(""));
  return r;
}

export function toLower(t: Text): Text { return t.toLowerCase(); }
export function toUpper(t: Text): Text { return t.toUpperCase(); }
export function toCaseFold(t: Text): Text { return t.toLowerCase(); }
export function toTitle(t: Text): Text {
  return t.replace(/\p{L}[\p{L}\p{M}']*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function take(n: number, t: Text): Text { return n <= 0 ? "" : cps(t).slice(0, n).join(""); }
export function drop(n: number, t: Text): Text { return n <= 0 ? t : cps(t).slice(n).join(""); }
export function takeEnd(n: number, t: Text): Text { return n <= 0 ? "" : cps(t).slice(-n).join(""); }
export function dropEnd(n: number, t: Text): Text { return n <= 0 ? t : cps(t).slice(0, -n).join(""); }
export function splitAt(n: number, t: Text): [Text, Text] { return [take(n, t), drop(n, t)]; }

export function takeWhile(p: (c: string) => boolean, t: Text): Text {
  const a = cps(t);
  let i = 0;
  while (i < a.length && p(a[i])) i++;
  return a.slice(0, i).join("");
}
export function dropWhile(p: (c: string) => boolean, t: Text): Text {
  const a = cps(t);
  let i = 0;
  while (i < a.length && p(a[i])) i++;
  return a.slice(i).join("");
}
export function takeWhileEnd(p: (c: string) => boolean, t: Text): Text {
  const a = cps(t);
  let i = a.length;
  while (i > 0 && p(a[i - 1])) i--;
  return a.slice(i).join("");
}
export function dropWhileEnd(p: (c: string) => boolean, t: Text): Text {
  const a = cps(t);
  let i = a.length;
  while (i > 0 && p(a[i - 1])) i--;
  return a.slice(0, i).join("");
}
export function dropAround(p: (c: string) => boolean, t: Text): Text {
  return dropWhileEnd(p, dropWhile(p, t));
}
export function span(p: (c: string) => boolean, t: Text): [Text, Text] {
  const a = cps(t);
  let i = 0;
  while (i < a.length && p(a[i])) i++;
  return [a.slice(0, i).join(""), a.slice(i).join("")];
}
export function break_(p: (c: string) => boolean, t: Text): [Text, Text] {
  return span((c) => !p(c), t);
}
export { break_ as break };

export function strip(t: Text): Text { return dropAround(isSpace, t); }
export function stripStart(t: Text): Text { return dropWhile(isSpace, t); }
export function stripEnd(t: Text): Text { return dropWhileEnd(isSpace, t); }

export function isPrefixOf(p: Text, t: Text): boolean { return t.startsWith(p); }
export function isSuffixOf(p: Text, t: Text): boolean { return t.endsWith(p); }
export function isInfixOf(p: Text, t: Text): boolean { return t.includes(p); }
export function stripPrefix(p: Text, t: Text): Maybe<Text> {
  return t.startsWith(p) ? Just(t.slice(p.length)) : Nothing;
}
export function stripSuffix(p: Text, t: Text): Maybe<Text> {
  return t.endsWith(p) ? Just(t.slice(0, t.length - p.length)) : Nothing;
}
export function commonPrefixes(a: Text, b: Text): Maybe<[Text, Text, Text]> {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i === 0 ? Nothing : Just([a.slice(0, i), a.slice(i), b.slice(i)]);
}

/** `splitOn sep t`. The separator must be non-empty. */
export function splitOn(sep: Text, t: Text): Text[] {
  if (sep.length === 0) throw new Error("Text.splitOn: empty delimiter");
  return t.split(sep);
}
/** `split p t`: split on characters matching the predicate. */
export function split(p: (c: string) => boolean, t: Text): Text[] {
  const r: Text[] = [];
  let cur = "";
  for (const c of t) {
    if (p(c)) {
      r.push(cur);
      cur = "";
    } else cur += c;
  }
  r.push(cur);
  return r;
}
export function chunksOf(n: number, t: Text): Text[] {
  if (n <= 0) return [];
  const a = cps(t);
  const r: Text[] = [];
  for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n).join(""));
  return r;
}
/** `breakOn needle t`: text before the first occurrence, and the rest (including needle). */
export function breakOn(needle: Text, t: Text): [Text, Text] {
  const i = t.indexOf(needle);
  return i < 0 ? [t, ""] : [t.slice(0, i), t.slice(i)];
}
/** `breakOnEnd needle t`: split after the last occurrence of needle. */
export function breakOnEnd(needle: Text, t: Text): [Text, Text] {
  const i = t.lastIndexOf(needle);
  return i < 0 ? ["", t] : [t.slice(0, i + needle.length), t.slice(i + needle.length)];
}
export function breakOnAll(needle: Text, t: Text): [Text, Text][] {
  // As in Data.Text (and avoiding an infinite loop below).
  if (needle.length === 0) throw new Error("Data.Text.breakOnAll: empty input");
  const r: [Text, Text][] = [];
  let i = t.indexOf(needle);
  while (i >= 0) {
    r.push([t.slice(0, i), t.slice(i)]);
    i = t.indexOf(needle, i + Math.max(1, needle.length));
  }
  return r;
}
export function replace(needle: Text, rep: Text, t: Text): Text {
  if (needle.length === 0) throw new Error("Text.replace: empty input");
  return t.split(needle).join(rep);
}
export function count(needle: Text, t: Text): number {
  if (needle.length === 0) throw new Error("Text.count: empty input");
  return t.split(needle).length - 1;
}

export function lines(t: Text): Text[] {
  if (t.length === 0) return [];
  const r = t.split("\n");
  if (r[r.length - 1] === "") r.pop();
  return r;
}
export function unlines(ts: readonly Text[]): Text { return ts.map((l) => l + "\n").join(""); }
export function words(t: Text): Text[] { return t.split(/[\s ]+/u).filter((w) => w.length > 0); }
export function unwords(ts: readonly Text[]): Text { return ts.join(" "); }

export function justifyLeft(n: number, c: string, t: Text): Text {
  const l = length(t);
  return l >= n ? t : t + c.repeat(n - l);
}
export function justifyRight(n: number, c: string, t: Text): Text {
  const l = length(t);
  return l >= n ? t : c.repeat(n - l) + t;
}
export function center(n: number, c: string, t: Text): Text {
  const l = length(t);
  if (l >= n) return t;
  const d = n - l;
  const r = Math.floor(d / 2), lft = d - r;
  return c.repeat(lft) + t + c.repeat(r);
}

export function zip(a: Text, b: Text): [string, string][] {
  const xa = cps(a), xb = cps(b);
  const n = Math.min(xa.length, xb.length);
  const r: [string, string][] = [];
  for (let i = 0; i < n; i++) r.push([xa[i], xb[i]]);
  return r;
}

export function inits(t: Text): Text[] {
  const a = cps(t);
  const r: Text[] = [];
  for (let i = 0; i <= a.length; i++) r.push(a.slice(0, i).join(""));
  return r;
}
export function tails(t: Text): Text[] {
  const a = cps(t);
  const r: Text[] = [];
  for (let i = 0; i <= a.length; i++) r.push(a.slice(i).join(""));
  return r;
}

/** Haskell `show` for a Text value: a double-quoted, escaped string literal. */
export function showText(t: Text): string {
  return JSON.stringify(t);
}
