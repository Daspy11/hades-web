// Ported from banana-ui/base/Data/UUID/Generate.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The uuid library has a "Random" instance for UUID, but we can't use it:
 *
 * * The GHC System.Random.StdGen only has about 61 bits of randomness, and by default is
 * always seeded with 0, so using that is a Bad Thing.
 *
 * * There is a suitable cryptographic random number generator in the crypto-api package, but
 * it isn't an instance of "RandomGen", so we can't use it with the Random instance for UUID.
 *
 * The Data.UUID.V4 UUID generator uses cryptographic random numbers, but
 * that implies an IO action for every UUID. If you want a good stream of UUIDs, you have to
 * roll your own.
 *
 * In theory this module could use any instance of "CryptoRandomGen", but in practice it is
 * specialised to "Generator" to simplify the types.
 *
 * TypeScript port
 * ---------------
 * * `Generator` stands in for the DRBG package's `CtrDRBG`. It is an immutable, deterministic
 *   random bit generator (SHA-1 in counter mode, re-keyed after every request), seeded from
 *   `crypto.getRandomValues`. As in Haskell, `generateUUID` is pure: the same generator always
 *   yields the same UUID, and the new generator is returned alongside it. This matters for
 *   state that holds a generator and is restored or replayed (e.g. `ModelEditState`).
 * * Generated UUIDs carry the version 4 / RFC 4122 variant bits (the Haskell original used the
 *   16 random bytes unchanged).
 * * The infinite Haskell list from `uuidStream` is an infinite iterator. Unlike a Haskell list it
 *   is consumed as it is read, so share it only where the Haskell code consumes it linearly.
 * * This module exports a class named `Generator`, which shadows the global `Generator` type of
 *   generator functions; import it under another name where both are needed.
 * * `CryptoRandomGen` is the dictionary interface of the crypto-api class; its instance for
 *   `Generator` is `CryptoRandomGen_Generator`. `splitGen` takes the dictionary first.
 */
import { Left, Right, type Either } from "@/lib/Data/Either";
import { atomicModifyIORef, error, newIORef, type IORef } from "@/lib/Prelude";
import { showText } from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import type { UUID } from "@/lib/Data/UUID";

// ---------------------------------------------------------------------------------------------
// Crypto.Random (crypto-api) types, re-exported by the Haskell module.

/** crypto-api `GenError`. */
export type GenError =
  | { readonly tag: "GenErrorOther"; readonly _0: string }
  | { readonly tag: "RequestedTooManyBytes" }
  | { readonly tag: "RangeInvalid" }
  | { readonly tag: "NeedReseed" }
  | { readonly tag: "NotEnoughEntropy" }
  | { readonly tag: "NeedsInfiniteSeed" };

export function GenErrorOther(_0: string): GenError {
  return { tag: "GenErrorOther", _0 };
}
export const RequestedTooManyBytes: GenError = { tag: "RequestedTooManyBytes" };
export const RangeInvalid: GenError = { tag: "RangeInvalid" };
export const NeedReseed: GenError = { tag: "NeedReseed" };
export const NotEnoughEntropy: GenError = { tag: "NotEnoughEntropy" };
export const NeedsInfiniteSeed: GenError = { tag: "NeedsInfiniteSeed" };

/** Derived `Show GenError`. */
export function show_GenError(e: GenError): string {
  return e.tag === "GenErrorOther" ? "GenErrorOther " + showText(e._0) : e.tag;
}

/** crypto-api `ReseedInfo`. */
export type ReseedInfo =
  | { readonly tag: "InXBytes"; readonly _0: number }
  | { readonly tag: "InXCalls"; readonly _0: number }
  | { readonly tag: "NotSoon" }
  | { readonly tag: "Never" };

/** crypto-api `type ByteLength = Int`. */
export type ByteLength = number;

/** The crypto-api `CryptoRandomGen` class, as a dictionary. */
export interface CryptoRandomGen<G> {
  /** Instantiate a new random bit generator. The provided bytestring should be of length >= genSeedLength. */
  newGen(seed: Uint8Array): Either<GenError, G>;
  /** Length of input entropy necessary to instantiate or reseed a generator. */
  readonly genSeedLength: ByteLength;
  /** Obtain random data using a generator. */
  genBytes(n: ByteLength, g: G): Either<GenError, [Uint8Array, G]>;
  /** Indicates how soon a reseed is needed. */
  reseedInfo(g: G): ReseedInfo;
  /** Indicates the period between reseeds. */
  reseedPeriod(g: G): ReseedInfo;
  /** Obtain random data using a generator, mixing in additional entropy. */
  genBytesWithEntropy(n: ByteLength, entropy: Uint8Array, g: G): Either<GenError, [Uint8Array, G]>;
  /** Reseed a generator. */
  reseed(entropy: Uint8Array, g: G): Either<GenError, G>;
  /** Seed the generator from the system entropy pool. */
  newGenIO(): G;
}

/**
 * crypto-api `splitGen`: obtain a tuple of new generators by using genBytes to get the
 * entropy for a new generator.
 */
export function splitGen<G>(cls: CryptoRandomGen<G>, g: G): Either<GenError, [G, G]> {
  const e = cls.genBytes(cls.genSeedLength, g);
  if (e.tag === "Left") return Left(e.value);
  const [ent, g_] = e.value;
  const n = cls.newGen(ent);
  if (n.tag === "Left") return Left(n.value);
  return Right([g_, n.value]);
}

// ---------------------------------------------------------------------------------------------
// The generator

/** Bytes of seed needed to instantiate a generator. */
const SEED_LENGTH = 32;
/** Largest request served by one call of `genBytes` (as for the CTR DRBG). */
const MAX_REQUEST = 65536;
/** Number of requests between reseeds (as for the CTR DRBG). */
const RESEED_INTERVAL = 2 ** 48;

/**
 * The random number generator. This is an instance of "CryptoRandomGen", so use its
 * functions to produce and manipulate values of this type.
 *
 * Values are immutable: every operation returns a new generator.
 */
export class Generator {
  /** @internal Use `CryptoRandomGen_Generator.newGen` or `newGenerator`. */
  constructor(
    /** @internal 20-byte key. */
    readonly key: Uint8Array,
    /** @internal Number of requests served since (re)seeding, starting at 1. */
    readonly counter: number,
  ) {}
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((acc, p) => acc + p.length, 0);
  const r = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    r.set(p, off);
    off += p.length;
  }
  return r;
}

function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, Math.floor(n / 0x100000000));
  dv.setUint32(4, n >>> 0);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

function systemEntropy(n: number): Uint8Array {
  const b = new Uint8Array(n);
  const c: Crypto | undefined = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
  return b;
}

/** `instance CryptoRandomGen CtrDRBG`, for the TypeScript `Generator`. */
export const CryptoRandomGen_Generator: CryptoRandomGen<Generator> = {
  newGen(seed) {
    if (seed.length < SEED_LENGTH) return Left(NotEnoughEntropy);
    return Right(new Generator(U.sha1(seed), 1));
  },
  genSeedLength: SEED_LENGTH,
  genBytes(n, g) {
    if (n > MAX_REQUEST) return Left(RequestedTooManyBytes);
    if (n < 0) return Left(RangeInvalid);
    if (g.counter >= RESEED_INTERVAL) return Left(NeedReseed);
    const ctr = u64(g.counter);
    const out = new Uint8Array(n);
    for (let block = 0, off = 0; off < n; block++, off += 20) {
      const h = U.sha1(concatBytes(g.key, ctr, u32(block)));
      out.set(h.subarray(0, Math.min(20, n - off)), off);
    }
    // Re-key after every request so that earlier output cannot be recomputed from the new state.
    const newKey = U.sha1(concatBytes(g.key, ctr, u32(0xffffffff)));
    return Right([out, new Generator(newKey, g.counter + 1)]);
  },
  reseedInfo(g) {
    return { tag: "InXCalls", _0: RESEED_INTERVAL - g.counter };
  },
  reseedPeriod(_g) {
    return { tag: "InXCalls", _0: RESEED_INTERVAL };
  },
  genBytesWithEntropy(n, entropy, g) {
    const r = CryptoRandomGen_Generator.reseed(entropy, g);
    if (r.tag === "Left") return Left(r.value);
    return CryptoRandomGen_Generator.genBytes(n, r.value);
  },
  reseed(entropy, g) {
    return Right(new Generator(U.sha1(concatBytes(g.key, entropy)), 1));
  },
  newGenIO() {
    return new Generator(U.sha1(systemEntropy(SEED_LENGTH)), 1);
  },
};

/**
 * Implicit single generator instance. This is modelled on the code in "System.Random". It uses
 * "unsafePerformIO" to create the singleton generator. (TypeScript: a module-level variable.)
 */
const theGenerator: IORef<Generator> = newIORef(CryptoRandomGen_Generator.newGenIO());

export function newGenerator(): Generator {
  return atomicModifyIORef(theGenerator, (g): [Generator, Generator] => {
    const r = splitGen(CryptoRandomGen_Generator, g);
    if (r.tag === "Left") return error(show_GenError(r.value)); // Should never happen: 2^48 bytes are available.
    return r.value;
  });
}

/** A stream of UUIDs seeded by the entropy pool. */
export function uuidStreamIO(): IterableIterator<UUID> {
  return uuidStream(newGenerator());
}

/**
 * A stream of UUIDs from the random generator. Use with "splitGen" and "newGenIO".
 *
 * >  do
 * >     gen <- newGenIO :: IO CtrDRBG
 * >     return $ uuidStream gen
 */
export function* uuidStream(g: Generator): IterableIterator<UUID> {
  // unfoldr $ either (const Nothing) Just . generateUUID
  let gen = g;
  for (;;) {
    const r = generateUUID(gen);
    if (r.tag === "Left") return;
    const [uuid, g2] = r.value;
    yield uuid;
    gen = g2;
  }
}

/** Produce one UUID. Should never fail. */
export function generateUUID(g1: Generator): Either<string, [UUID, Generator]> {
  const r = CryptoRandomGen_Generator.genBytes(16, g1);
  if (r.tag === "Left") return Left("UUID generator: " + show_GenError(r.value));
  //  The generator is good for 2 to the power 48 UUIDs per session, so this should never happen.
  const [bs, g2] = r.value;
  // TypeScript port: mark the bytes as a version 4 (random) UUID.
  const bytes = bs.slice();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const u = U.fromByteString(bytes);
  if (u.tag === "Nothing") return Left("UUID generator conversion error");
  //  The conversion should always succeed when given 16 bytes.
  return Right([u.value, g2]);
}
