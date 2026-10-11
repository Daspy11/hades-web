import { describe, expect, test } from "vitest";
import {
  CryptoRandomGen_Generator as G, NotEnoughEntropy, RequestedTooManyBytes, generateUUID, newGenerator, splitGen,
  uuidStream, uuidStreamIO,
} from "./Generate";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function take<A>(n: number, it: Iterator<A>): A[] {
  const r: A[] = [];
  for (let i = 0; i < n; i++) {
    const x = it.next();
    if (x.done) break;
    r.push(x.value);
  }
  return r;
}

describe("Data.UUID.Generate", () => {
  test("generateUUID is pure and yields v4 UUIDs", () => {
    const g = newGenerator();
    const r1 = generateUUID(g);
    const r2 = generateUUID(g);
    expect(r1).toEqual(r2);
    if (r1.tag !== "Right") throw new Error("generateUUID failed");
    const [u1, g1] = r1.value;
    expect(u1).toMatch(V4);
    const r3 = generateUUID(g1);
    expect(r3.tag === "Right" && r3.value[0]).not.toBe(u1);
  });

  test("streams are distinct and deterministic per generator", () => {
    const g = newGenerator();
    const xs = take(200, uuidStream(g));
    expect(new Set(xs).size).toBe(200);
    expect(take(5, uuidStream(g))).toEqual(xs.slice(0, 5));
    const ys = take(5, uuidStreamIO());
    expect(ys.every((u) => V4.test(u))).toBe(true);
    expect(ys).not.toEqual(xs.slice(0, 5));
  });

  test("newGen, genBytes and splitGen", () => {
    expect(G.newGen(new Uint8Array(3))).toEqual({ tag: "Left", value: NotEnoughEntropy });
    const seeded = G.newGen(new Uint8Array(32).fill(7));
    if (seeded.tag !== "Right") throw new Error("newGen failed");
    const again = G.newGen(new Uint8Array(32).fill(7));
    expect(again).toEqual(seeded);
    const b = G.genBytes(50, seeded.value);
    expect(b.tag === "Right" && b.value[0].length).toBe(50);
    expect(G.genBytes(1 << 20, seeded.value)).toEqual({ tag: "Left", value: RequestedTooManyBytes });
    const s = splitGen(G, seeded.value);
    if (s.tag !== "Right") throw new Error("splitGen failed");
    const [ga, gb] = s.value;
    const ua = generateUUID(ga), ub = generateUUID(gb);
    expect(ua.tag === "Right" && ub.tag === "Right" && ua.value[0] !== ub.value[0]).toBe(true);
  });
});
