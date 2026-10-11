/**
 * Haskell `Data.UUID`, `Data.UUID.V4` and `Data.UUID.V5`.
 *
 * UUIDs are represented as canonical lower-case strings, e.g.
 * `"e386bb76-c5dd-5182-b2c8-f76ca3de8f8c"`. String order matches Haskell's `Ord UUID`.
 */
import { Just, Nothing, type Maybe } from "./Maybe";

export type UUID = string;

export const nil: UUID = "00000000-0000-0000-0000-000000000000";

export function isNil(u: UUID): boolean {
  return u === nil;
}
/** Haskell `Data.UUID.null` */
export { isNil as null };

export function toText(u: UUID): string {
  return u;
}
export const toString = toText;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function fromText(t: string): Maybe<UUID> {
  return UUID_RE.test(t) ? Just(t.toLowerCase()) : Nothing;
}
export const fromString = fromText;

export function toBytes(u: UUID): Uint8Array {
  const hex = u.replace(/-/g, "");
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}
export const toByteString = toBytes;

export function fromBytes(b: Uint8Array): UUID {
  const h = Array.from(b.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
export function fromByteString(b: Uint8Array): Maybe<UUID> {
  return b.length === 16 ? Just(fromBytes(b)) : Nothing;
}

/** Four 32-bit words, as in `Data.UUID.toWords`. */
export function toWords(u: UUID): [number, number, number, number] {
  const b = toBytes(u);
  const w = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  return [w(0), w(4), w(8), w(12)];
}
export function fromWords(w0: number, w1: number, w2: number, w3: number): UUID {
  const b = new Uint8Array(16);
  [w0, w1, w2, w3].forEach((w, i) => {
    b[i * 4] = (w >>> 24) & 255;
    b[i * 4 + 1] = (w >>> 16) & 255;
    b[i * 4 + 2] = (w >>> 8) & 255;
    b[i * 4 + 3] = w & 255;
  });
  return fromBytes(b);
}

/** `Data.UUID.V4.nextRandom` (synchronous in the browser). */
export function nextRandom(): UUID {
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return fromBytes(b);
}

// ---------------------------------------------------------------------------------------------
// SHA-1 (synchronous), needed for name-based version 5 UUIDs.

export function sha1(msg: Uint8Array): Uint8Array {
  const ml = msg.length;
  const withPad = new Uint8Array(((ml + 9 + 63) >> 6) << 6);
  withPad.set(msg);
  withPad[ml] = 0x80;
  const bitLen = ml * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h));
  return out;
}

/** `Data.UUID.V5.generateNamed namespace bytes` */
export function generateNamed(namespace: UUID, name: Uint8Array | readonly number[]): UUID {
  const ns = toBytes(namespace);
  const nm = name instanceof Uint8Array ? name : Uint8Array.from(name);
  const buf = new Uint8Array(ns.length + nm.length);
  buf.set(ns);
  buf.set(nm, ns.length);
  const h = sha1(buf).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  return fromBytes(h);
}

/** Standard namespaces from `Data.UUID.V5`. */
export const namespaceDNS: UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
export const namespaceURL: UUID = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
export const namespaceOID: UUID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
export const namespaceX500: UUID = "6ba7b814-9dad-11d1-80b4-00c04fd430c8";

/** UTF-8 encode text into bytes (`Data.Text.Encoding.encodeUtf8`). */
export function encodeUtf8(t: string): Uint8Array {
  return new TextEncoder().encode(t);
}
export function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}
