import { describe, expect, it } from "vitest";
import * as S from "@/lib/Data/Set";
import { flatten } from "@/lib/Data/Tree";
import * as QC from "./QuickCheck";

const run = <A>(g: QC.Gen<A>, size = 30, seed = 1): A => QC.generateWith(seed, size, g);

describe("Test.QuickCheck generators", () => {
  it("are deterministic for a seed", () => {
    const g = QC.vectorOf(20, QC.choose([0, 1000]));
    expect(run(g, 30, 42)).toEqual(run(g, 30, 42));
    expect(run(g, 30, 42)).not.toEqual(run(g, 30, 43));
  });

  it("choose stays in the inclusive range and reaches both ends", () => {
    const xs = run(QC.vectorOf(2000, QC.choose([-3, 3])));
    expect(Math.min(...xs)).toBe(-3);
    expect(Math.max(...xs)).toBe(3);
    expect(xs.every((x) => Number.isInteger(x))).toBe(true);
    const big = run(QC.vectorOf(200, QC.chooseInteger([-9999999999999 * 30, 9999999999999 * 30])));
    expect(big.every((x) => Number.isInteger(x) && Math.abs(x) <= 9999999999999 * 30)).toBe(true);
  });

  it("sized generators follow the size; resize overrides it", () => {
    const ints = run(QC.vectorOf(500, QC.Arbitrary_Int.arbitrary), 5);
    expect(ints.every((x) => x >= -5 && x <= 5)).toBe(true);
    expect(run(QC.resize(0, QC.Arbitrary_Integer.arbitrary), 30)).toBe(0);
    expect(() => QC.resize(-1, QC.Arbitrary_Int.arbitrary)).toThrow("Test.QuickCheck.resize: negative size");
    const lists = run(QC.vectorOf(200, QC.listOf(QC.Arbitrary_Bool.arbitrary)), 4);
    expect(Math.max(...lists.map((l) => l.length))).toBe(4);
    expect(lists.some((l) => l.length === 0)).toBe(true);
  });

  it("Word8 covers 0..255 at size 30, and small values at small sizes", () => {
    const big = run(QC.vectorOf(3000, QC.Arbitrary_Word8.arbitrary), 30);
    expect(Math.min(...big)).toBe(0);
    expect(Math.max(...big)).toBe(255);
    const small = run(QC.vectorOf(500, QC.Arbitrary_Word8.arbitrary), 5);
    // power = (40 * 5) div 80 = 2, so the range is 0 .. 4.
    expect(Math.max(...small)).toBe(4);
  });

  it("Double generators give finite numbers within the size", () => {
    const ds = run(QC.vectorOf(1000, QC.Arbitrary_Double.arbitrary), 10);
    expect(ds.every((d) => Number.isFinite(d) && Math.abs(d) <= 10)).toBe(true);
    expect(ds.some((d) => !Number.isInteger(d))).toBe(true);
    const fr = run(QC.vectorOf(200, QC.arbitrarySizedFractional), 3);
    expect(fr.every((d) => Math.abs(d) <= 3)).toBe(true);
  });

  it("elements, oneof and frequency pick from their arguments", () => {
    expect(() => QC.elements([])).toThrow("QuickCheck.elements used with empty list");
    expect(() => QC.oneof([])).toThrow("QuickCheck.oneof used with empty list");
    const xs = run(QC.vectorOf(300, QC.elements(["a", "b", "c"])));
    expect(new Set(xs)).toEqual(new Set(["a", "b", "c"]));
    const fs = run(QC.vectorOf(300, QC.frequency<string>([[0, QC.pure_Gen("never")], [1, QC.pure_Gen("x")]])));
    expect(new Set(fs)).toEqual(new Set(["x"]));
  });

  it("sublistOf keeps the order; shuffle permutes", () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (const sub of run(QC.vectorOf(50, QC.sublistOf(xs)))) {
      expect([...sub].sort((a, b) => a - b)).toEqual(sub);
      expect(sub.every((x) => xs.includes(x))).toBe(true);
    }
    const sh = run(QC.shuffle(xs));
    expect([...sh].sort((a, b) => a - b)).toEqual(xs);
  });

  it("trees have about `size` nodes", () => {
    const ts = run(QC.vectorOf(200, QC.Arbitrary_Tree(QC.Arbitrary_Int).arbitrary), 6);
    const sizes = ts.map((t) => flatten(t).length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(6);
    expect(Math.min(...sizes)).toBe(1);
    const forest = run(QC.resize(5, QC.Arbitrary_Forest(QC.Arbitrary_Bool).arbitrary));
    expect(forest.length).toBeLessThanOrEqual(5);
  });

  it("sets are built from arbitrary lists", () => {
    const s = run(QC.Arbitrary_Set(QC.Arbitrary_Int).arbitrary, 30, 3);
    expect(S.toList(s)).toEqual([...new Set(S.toList(s))].sort((a, b) => a - b));
  });

  it("suchThat retries until the predicate holds", () => {
    const evens = run(QC.vectorOf(50, QC.suchThat(QC.Arbitrary_Int.arbitrary, (n) => n % 2 === 0)));
    expect(evens.every((n) => n % 2 === 0)).toBe(true);
  });

  it("setQCGenSeed makes generate reproducible", () => {
    QC.setQCGenSeed(99);
    const a = QC.generate(QC.vectorOf(10, QC.Arbitrary_Int.arbitrary));
    QC.setQCGenSeed(99);
    const b = QC.generate(QC.vectorOf(10, QC.Arbitrary_Int.arbitrary));
    QC.setQCGenSeed(null);
    expect(a).toEqual(b);
  });
});

describe("Test.QuickCheck shrinking", () => {
  it("shrinkIntegral", () => {
    expect(QC.shrinkIntegral(10)).toEqual([0, 5, 8, 9]);
    expect(QC.shrinkIntegral(-10)).toEqual([10, 0, -5, -8, -9]);
    expect(QC.shrinkIntegral(0)).toEqual([]);
    expect(QC.shrinkIntegral(1)).toEqual([0]);
  });

  it("shrinkList removes chunks, then shrinks elements", () => {
    expect(QC.shrinkList(QC.shrinkIntegral, [1, 2])).toEqual([[], [2], [1], [0, 2], [1, 0], [1, 1]]);
    expect(QC.Arbitrary_Bool.shrink(true)).toEqual([false]);
  });

  it("shrinkDecimal prefers shorter decimals", () => {
    const sh = QC.shrinkDecimal(3.5);
    expect(sh.slice(0, 9)).toEqual([0, 2, 3, 0, 1.8, 2.7, 3.1, 3.3, 3.4]);
    expect(sh.every((y) => Math.abs(y) < 3.5)).toBe(true);
    expect(QC.shrinkDecimal(2.5).slice(0, 3)).toEqual([2, 0, 1]); // round 2.5 = 2 (banker's)
    expect(QC.shrinkDecimal(0)).toEqual([]);
  });
});
