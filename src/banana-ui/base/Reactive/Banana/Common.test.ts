import { describe, expect, test } from "vitest";
import * as B from "@/lib/Reactive/Banana";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { preview, review, view, set } from "@/lib/Control/Lens";
import { Node } from "@/lib/Data/Tree";
import {
  Changes, GadgetData, ap_Changes, ap_GadgetData, append_GadgetData, colourPrism, datePrism, def_Colour,
  filterChanges, fmap_GadgetData, forestCatMaybe, gdOk, gdValue, liftA2_Changes, longDate, makeChanges,
  mempty_GadgetData, prismToMaybe, pure_Changes, shortDate, show_Colour, sticky, textPrismDouble, textPrismInt,
  unionsC, firstEvent, add_Changes,
} from "./Common";

describe("datePrism", () => {
  test("formats with the given format", () => {
    expect(review(datePrism(longDate), "2018-01-03")).toBe("3 January 2018");
    expect(review(datePrism(shortDate), "2018-01-03")).toBe("3/1/2018");
  });
  test("round trip", () => {
    for (const fmt of [longDate, shortDate, "%Y-%m-%d"]) {
      const p = datePrism(fmt);
      for (const d of ["2018-01-03", "1999-12-31", "2024-02-29"]) {
        expect(preview(p, review(p, d))).toEqual(Just(d));
      }
    }
  });
  test("reads the built-in formats", () => {
    const p = datePrism(longDate);
    expect(preview(p, "2018-01-03")).toEqual(Just("2018-01-03"));
    expect(preview(p, "3/1/2018")).toEqual(Just("2018-01-03"));
    expect(preview(p, "3 Jan 2018")).toEqual(Just("2018-01-03"));
    expect(preview(p, " 3 January 2018 ")).toEqual(Just("2018-01-03"));
    expect(preview(p, "31/2/2018")).toEqual(Nothing);
    expect(preview(p, "not a date")).toEqual(Nothing);
  });
});

describe("colourPrism", () => {
  test("shows six digit hex", () => {
    expect(review(colourPrism, C.sRGB24(255, 128, 255))).toBe("#ff80ff");
    expect(show_Colour(def_Colour)).toBe("#808080");
  });
  test("reads hex with optional hash and surrounding spaces", () => {
    expect(preview(colourPrism, "  #FF80ff ").tag).toBe("Just");
    expect(review(colourPrism, (preview(colourPrism, "  #FF80ff ") as any).value)).toBe("#ff80ff");
    expect(review(colourPrism, (preview(colourPrism, "102030") as any).value)).toBe("#102030");
    expect(preview(colourPrism, "#12345")).toEqual(Nothing);
    expect(preview(colourPrism, "#1234567")).toEqual(Nothing);
  });
});

describe("textPrism and prismToMaybe", () => {
  test("textPrismInt", () => {
    expect(preview(textPrismInt, "42")).toEqual(Just(42));
    expect(preview(textPrismInt, "4.2")).toEqual(Nothing);
    expect(review(textPrismInt, -7)).toBe("-7");
  });
  test("textPrismDouble uses Haskell show", () => {
    expect(review(textPrismDouble, 3)).toBe("3.0");
    expect(preview(textPrismDouble, "2.5")).toEqual(Just(2.5));
  });
  test("prismToMaybe", () => {
    const p = prismToMaybe(textPrismInt);
    expect(preview(p, "")).toEqual(Just(Nothing));
    expect(preview(p, "12")).toEqual(Just(Just(12)));
    expect(preview(p, "x")).toEqual(Nothing);
    expect(review(p, Nothing)).toBe("");
    expect(review(p, Just(5))).toBe("5");
  });
});

describe("GadgetData", () => {
  test("instances and lenses", () => {
    const g = GadgetData(true, 3);
    expect(fmap_GadgetData((x: number) => x + 1, g)).toEqual(GadgetData(true, 4));
    expect(ap_GadgetData(GadgetData(false, (x: number) => x * 2), g)).toEqual(GadgetData(false, 6));
    expect(append_GadgetData((a: string, b: string) => a + b, GadgetData(true, "a"), GadgetData(false, "b")))
      .toEqual(GadgetData(false, "ab"));
    expect(mempty_GadgetData("")).toEqual(GadgetData(true, ""));
    expect(view(gdOk(), g)).toBe(true);
    expect(set(gdValue<number, string>(), "x", g)).toEqual(GadgetData(true, "x"));
  });
});

describe("forestCatMaybe", () => {
  test("prunes Nothing nodes with their children", () => {
    const f = [
      Node<Maybe<number>>(Just(1), [Node(Nothing, [Node(Just(2))]), Node(Just(3))]),
      Node<Maybe<number>>(Nothing, [Node(Just(4))]),
    ];
    expect(forestCatMaybe(f)).toEqual([Node(1, [Node(3)])]);
  });
});

describe("Changes", () => {
  test("ap_Changes handles separate and simultaneous events", () => {
    const out: number[] = [];
    let fireF: (f: (x: number) => number) => void = () => {};
    let fireX: (x: number) => void = () => {};
    let fireBoth: (p: [(x: number) => number, number]) => void = () => {};
    let result: Changes<number> | null = null;
    const net = B.compile(() => {
      const [ef, hf] = B.newEvent<(x: number) => number>();
      const [ex, hx] = B.newEvent<number>();
      const [eb, hb] = B.newEvent<[(x: number) => number, number]>();
      fireF = hf;
      fireX = hx;
      fireBoth = hb;
      const cf = makeChanges<(x: number) => number>((x) => x + 1, B.unionWith((a) => a, ef, B.mapE((p) => p[0], eb)));
      const cx = makeChanges(10, B.unionWith((a) => a, ex, B.mapE((p) => p[1], eb)));
      result = ap_Changes(cf, cx);
      B.reactimate(B.mapE((v: number) => () => { out.push(v); }, result.changesE));
    });
    B.actuate(net);
    expect(B.valueB(result!.changesB)).toBe(11);
    fireX(20); // old f, new x
    fireF((x) => x * 2); // new f, current x
    fireBoth([(x) => x - 1, 100]); // simultaneous: new f applied to new x
    expect(out).toEqual([21, 40, 99]);
    expect(B.valueB(result!.changesB)).toBe(99);
  });

  test("liftA2, pure, add, unionsC, filterChanges, sticky, firstEvent", () => {
    const sums: number[] = [];
    const filtered: number[] = [];
    const stuck: number[] = [];
    const fns: number[] = [];
    const firsts: string[] = [];
    let fire: (x: number) => void = () => {};
    let fireM: (m: Maybe<number>) => void = () => {};
    let fireS: (s: string) => void = () => {};
    const net = B.compile(() => {
      const [e, h] = B.newEvent<number>();
      const [em, hm] = B.newEvent<Maybe<number>>();
      const [es, hs] = B.newEvent<string>();
      fire = h;
      fireM = hm;
      fireS = hs;
      const c = makeChanges(1, e);
      const s = add_Changes(c, pure_Changes(100));
      B.reactimate(B.mapE((v: number) => () => { sums.push(v); }, liftA2_Changes((a: number, b: number) => a + b, s, c).changesE));
      B.reactimate(B.mapE((v: number) => () => { filtered.push(v); }, filterChanges(c).changesE));
      const st = sticky(-1, makeChanges<Maybe<number>>(Nothing, em));
      B.reactimate(B.mapE((v: number) => () => { stuck.push(v); }, st.changesE));
      const u = unionsC([
        Changes(B.mapE((x: number) => (y: number) => y + x, e), B.pureB((y: number) => y + 1)),
        Changes(B.mapE((x: number) => (y: number) => y * x, e), B.pureB((y: number) => y * 2)),
      ]);
      B.reactimate(B.mapE((f: (y: number) => number) => () => { fns.push(f(10)); }, u.changesE));
      expect(B.valueB(u.changesB)(10)).toBe(21); // (+1) . (*2)
      B.reactimate(B.mapE((v: string) => () => { firsts.push(v); },
        firstEvent([es, B.mapE((x: string) => x.toUpperCase(), es)])));
    });
    B.actuate(net);
    fire(2);
    fire(2);
    fire(5);
    fireM(Just(7));
    fireM(Nothing);
    fireS("a");
    expect(sums).toEqual([104, 104, 110]);
    expect(filtered).toEqual([2, 5]);
    expect(stuck).toEqual([7]);
    expect(fns).toEqual([22, 22, 55]); // (+x) . (*x) applied to 10
    expect(firsts).toEqual(["a"]);
  });
});
