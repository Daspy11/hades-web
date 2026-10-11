/** Haskell `Data.Char`. Characters are single-code-point strings. */

export function isSpace(c: string): boolean {
  return /^[\s ]$/u.test(c);
}
export function isDigit(c: string): boolean {
  return c >= "0" && c <= "9" && c.length === 1;
}
export function isOctDigit(c: string): boolean {
  return c >= "0" && c <= "7" && c.length === 1;
}
export function isHexDigit(c: string): boolean {
  return /^[0-9a-fA-F]$/.test(c);
}
export function isLetter(c: string): boolean {
  return /^\p{L}$/u.test(c);
}
export const isAlpha = isLetter;
export function isMark(c: string): boolean {
  return /^\p{M}$/u.test(c);
}
export function isNumber(c: string): boolean {
  return /^\p{N}$/u.test(c);
}
export function isAlphaNum(c: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(c);
}
export function isUpper(c: string): boolean {
  return /^\p{Lu}|\p{Lt}$/u.test(c);
}
export function isLower(c: string): boolean {
  return /^\p{Ll}$/u.test(c);
}
export function isPunctuation(c: string): boolean {
  return /^\p{P}$/u.test(c);
}
export function isSymbol(c: string): boolean {
  return /^\p{S}$/u.test(c);
}
export function isControl(c: string): boolean {
  return /^\p{Cc}$/u.test(c);
}
export function isPrint(c: string): boolean {
  return !/^[\p{C}]$/u.test(c);
}
export function isAscii(c: string): boolean {
  return c.length === 1 && c.charCodeAt(0) < 128;
}
export function isSeparator(c: string): boolean {
  return /^\p{Z}$/u.test(c);
}
export function toUpper(c: string): string {
  return c.toUpperCase();
}
export function toLower(c: string): string {
  return c.toLowerCase();
}
export function ord(c: string): number {
  return c.codePointAt(0) ?? 0;
}
export function chr(n: number): string {
  return String.fromCodePoint(n);
}
export function digitToInt(c: string): number {
  const n = parseInt(c, 16);
  if (Number.isNaN(n)) throw new Error("Char.digitToInt: not a digit " + c);
  return n;
}
export function intToDigit(n: number): string {
  return n.toString(16);
}
