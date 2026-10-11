import { describe, expect, test } from "vitest";
import * as M from "./Data/Map";
import * as S from "./Data/Set";
import { Just, Nothing, type Maybe } from "./Data/Maybe";
import { compare, equals } from "./Data/Ord";
import {
  _1, _2, _Just, at, each, ix, lens, non, over, preview, prism_, review, set, toListOf, view, re, iso,
  type Lens, type Prism, type Traversal, type Getter, to, failing,
} from "./Control/Lens";
import * as B from "./Reactive/Banana";
import { showDouble, readDouble, readInt } from "./Prelude";
import { formatDay, parseDay } from "./Data/Time";
import { sRGB24, sRGB24show, sRGB24read, luminance } from "./Data/Colour";

describe("Data.Map", () => {
  test("insert/lookup/order", () => {
    let m = M.empty<string, number>();
    for (const k of ["d", "b", "a", "c", "e"]) m = M.insert(k, k.charCodeAt(0), m);
    expect(M.keys(m)).toEqual(["a", "b", "c", "d", "e"]);
    expect(M.lookup("c", m)).toEqual(Just(99));
    expect(M.lookup("z", m)).toEqual(Nothing);
    const m2 = M.delete("c", m);
    expect(M.keys(m2)).toEqual(["a", "b", "d", "e"]);
    expect(M.keys(m)).toEqual(["a", "b", "c", "d", "e"]);
    expect(M.size(m2)).toBe(4);
  });
  test("union is left biased", () => {
    const a = M.fromList([["x", 1], ["y", 2]] as [string, number][]);
    const b = M.fromList([["y", 20], ["z", 30]] as [string, number][]);
    expect(M.toList(M.union(a, b))).toEqual([["x", 1], ["y", 2], ["z", 30]]);
    expect(M.toList(M.unionWith((p, q) => p + q, a, b))).toEqual([["x", 1], ["y", 22], ["z", 30]]);
    expect(M.toList(M.difference(a, b))).toEqual([["x", 1]]);
    expect(M.toList(M.intersection(a, b))).toEqual([["y", 2]]);
  });
  test("large", () => {
    let m = M.empty<number, number>();
    for (let i = 0; i < 5000; i++) m = M.insert((i * 7919) % 5000, i, m);
    expect(M.size(m)).toBe(5000);
    expect(M.keys(m).slice(0, 3)).toEqual([0, 1, 2]);
    for (let i = 0; i < 5000; i += 2) m = M.delete(i, m);
    expect(M.size(m)).toBe(2500);
    expect(equals(m, M.fromList(M.toList(m)))).toBe(true);
  });
  test("tuple keys and Maybe ordering", () => {
    expect(compare(Nothing as Maybe<number>, Just(1))).toBe(-1);
    expect(compare([1, "b"], [1, "a"])).toBe(1);
    const s = S.fromList([[2, 1], [1, 2], [1, 1]]);
    expect(S.toList(s)).toEqual([[1, 1], [1, 2], [2, 1]]);
  });
});

describe("Control.Lens", () => {
  interface P { name: string; inner: { n: number } }
  const name: Lens<P, string> = lens((p: P) => p.name, (p, n: string) => ({ ...p, name: n }));
  const inner: Lens<P, { n: number }> = lens((p: P) => p.inner, (p, i: { n: number }) => ({ ...p, inner: i }));
  const n: Lens<{ n: number }, number> = lens((x: { n: number }) => x.n, (_x, v: number) => ({ n: v }));
  test("compose lenses", () => {
    const p: P = { name: "a", inner: { n: 1 } };
    const l = inner.dot(n);
    expect(view(l, p)).toBe(1);
    expect(set(l, 5, p)).toEqual({ name: "a", inner: { n: 5 } });
    expect(over(name, (s) => s + "!", p).name).toBe("a!");
  });
  test("prisms and traversals", () => {
    const m = M.fromList([["a", Just(1)], ["b", Nothing as Maybe<number>]] as [string, Maybe<number>][]);
    const t: Traversal<M.HMap<string, Maybe<number>>, number> = ix<string, Maybe<number>>("a").dot(_Just<number>());
    expect(preview(t, m)).toEqual(Just(1));
    expect(preview(ix<string, Maybe<number>>("b").dot(_Just<number>()), m)).toEqual(Nothing);
    const evenP: Prism<number, number> = prism_((x: number) => x, (x: number) => (x % 2 === 0 ? Just(x) : Nothing));
    expect(toListOf(each<number>().dot(evenP), [1, 2, 3, 4])).toEqual([2, 4]);
    expect(review(_Just<number>(), 3)).toEqual(Just(3));
    expect(view(at<string, number>("q"), M.empty<string, number>())).toEqual(Nothing);
    expect(M.toList(set(at<string, number>("q"), Just(3), M.empty<string, number>()))).toEqual([["q", 3]]);
    expect(view(re(_Just<number>()), 4)).toEqual(Just(4));
    const g: Getter<readonly [number, string], string> = _2<number, string>().dot(to((s: string) => s.toUpperCase()));
    expect(view(g, [1, "x"])).toBe("X");
    expect(view(_1<number, string>(), [1, "x"])).toBe(1);
    expect(view(non(0), Nothing as Maybe<number>)).toBe(0);
    expect(set(non(0), 0, Just(3))).toEqual(Nothing);
    const i = iso((x: number) => x * 2, (y: number) => y / 2);
    expect(view(i.dot(i), 3)).toBe(12);
    const f = failing(_Just<number>(), each<number>() as any);
    expect(preview(f as any, Just(2))).toEqual(Just(2));
  });
});

describe("Reactive.Banana", () => {
  test("stepper sees old value at the moment of the event", () => {
    const log: string[] = [];
    let fireH: (n: number) => void = () => {};
    const net = B.compile(() => {
      const [e, h] = B.newEvent<number>();
      fireH = h;
      const b = B.stepper(0, e);
      B.reactimate(B.apply(B.mapB((old: number) => (nw: number) => () => { log.push(`${old}->${nw}`); }, b), e));
    });
    B.actuate(net);
    fireH(1);
    fireH(2);
    expect(log).toEqual(["0->1", "1->2"]);
  });
  test("accumE, unionWith, filter, switchE", () => {
    const out: number[] = [];
    let h1: (n: number) => void = () => {};
    let hs: (e: B.Event<number>) => void = () => {};
    const net = B.compile(() => {
      const [e, h] = B.newEvent<number>();
      h1 = h;
      const [es, hsw] = B.newEvent<B.Event<number>>();
      hs = hsw;
      const acc = B.accumE(0, B.mapE((x: number) => (s: number) => s + x, e));
      const sw = B.switchE(es, acc);
      B.reactimate(B.mapE((x: number) => () => { out.push(x); }, B.filterE((x) => x !== 3, sw)));
      (globalThis as any).__e = e;
    });
    B.actuate(net);
    h1(1);
    h1(2);
    h1(5);
    hs(B.mapE((x: number) => x * 100, (globalThis as any).__e));
    h1(1);
    expect(out).toEqual([1, 8, 100]);
  });
  test("changes and recursion via lazyB", () => {
    const seen: number[] = [];
    let h: (n: number) => void = () => {};
    const net = B.compile(() => {
      const [e, fire] = B.newEvent<number>();
      h = fire;
      // total = stepper 0 ((+) <$> total <@> e)
      const totalRef: B.Behavior<number> = B.lazyB(() => total);
      const sums: B.Event<number> = B.apply(B.mapB((t: number) => (x: number) => t + x, totalRef), e);
      const total: B.Behavior<number> = B.stepper(0, sums);
      B.reactimatePrime(B.mapE((f: B.Future<number>) => B.mapFuture((v: number) => () => { seen.push(v); }, f), B.changes(total)));
    });
    B.actuate(net);
    h(2);
    h(3);
    expect(seen).toEqual([2, 5]);
  });
  test("execute builds new network fragments", () => {
    const out: string[] = [];
    let h: (s: string) => void = () => {};
    const net = B.compile(() => {
      const [e, fire] = B.newEvent<string>();
      h = fire;
      const made = B.execute(B.mapE((s: string) => () => B.stepper(s, B.never<string>()), e));
      const latest = B.stepper(B.pureB("none"), made);
      const flat = B.switchB(B.pureB("none"), made);
      B.reactimate(B.mapE(() => () => { out.push(flat.sample()); }, e));
      void latest;
    });
    B.actuate(net);
    h("a");
    h("b");
    expect(out).toEqual(["a", "b"]);
  });
});

describe("Prelude / Time / Colour", () => {
  test("show Double like Haskell", () => {
    expect(showDouble(1)).toBe("1.0");
    expect(showDouble(0.1)).toBe("0.1");
    expect(showDouble(0.01)).toBe("1.0e-2");
    expect(showDouble(12345678.9)).toBe("1.23456789e7");
    expect(showDouble(-2.5)).toBe("-2.5");
    expect(showDouble(1234567)).toBe("1234567.0");
    expect(readDouble(" 3.5 ")).toEqual(Just(3.5));
    expect(readInt("+3")).toEqual(Nothing);
  });
  test("dates", () => {
    expect(formatDay("%-d %B %Y", "2018-01-03")).toBe("3 January 2018");
    expect(formatDay("%-d/%-m/%Y", "2018-01-03")).toBe("3/1/2018");
    expect(parseDay("%-d/%-m/%Y", "3/1/2018")).toEqual(Just("2018-01-03"));
    expect(parseDay("%-d %B %Y", "3 January 2018")).toEqual(Just("2018-01-03"));
    expect(parseDay("%Y-%m-%d", "2018-02-30")).toEqual(Nothing);
  });
  test("colours", () => {
    expect(sRGB24show(sRGB24(128, 128, 128))).toBe("#808080");
    const c = sRGB24read("#ff8000");
    expect(c.tag).toBe("Just");
    expect(luminance(sRGB24(255, 255, 255))).toBeCloseTo(1);
  });
});
