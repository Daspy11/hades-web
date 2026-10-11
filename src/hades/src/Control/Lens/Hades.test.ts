import { describe, expect, test } from "vitest";
import { _Just, prism_, review, set, view, type Prism } from "@/lib/Control/Lens";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import * as S from "@/lib/Data/Set";
import { down } from "@/lib/Data/Ord";
import { defaultIso, maybeLens, prismLens, setMaybeIso } from "./Hades";

type Shape = { tag: "Circle"; r: number } | { tag: "Square"; side: number };
const _Circle: Prism<Shape, number> = prism_(
  (r: number) => ({ tag: "Circle", r }) as Shape,
  (s: Shape) => (s.tag === "Circle" ? Just(s.r) : Nothing),
);

describe("Control.Lens.Hades", () => {
  test("defaultIso", () => {
    const optionalText = defaultIso("");
    expect(view(optionalText, Nothing)).toBe("");
    expect(view(optionalText, Just("x"))).toBe("x");
    expect(review(optionalText, "")).toEqual(Nothing);
    expect(review(optionalText, "y")).toEqual(Just("y"));
    // Not quite an Iso: Just d round-trips to Nothing.
    expect(set(optionalText, view(optionalText, Just("")), Just(""))).toEqual(Nothing);
  });

  test("prismLens", () => {
    const radius = prismLens(0, _Circle);
    const sq: Shape = { tag: "Square", side: 2 };
    expect(view(radius, { tag: "Circle", r: 3 })).toBe(3);
    expect(view(radius, sq)).toBe(0);
    // Setting the default on a non-matching value leaves it alone.
    expect(set(radius, 0, sq)).toBe(sq);
    expect(set(radius, 5, sq)).toEqual({ tag: "Circle", r: 5 });
    expect(set(radius, 0, { tag: "Circle", r: 3 })).toEqual({ tag: "Circle", r: 0 });
  });

  test("maybeLens", () => {
    const l = maybeLens(_Circle);
    expect(view(l, Nothing)).toEqual(Nothing);
    expect(view(l, Just<Shape>({ tag: "Square", side: 1 }))).toEqual(Nothing);
    expect(view(l, Just<Shape>({ tag: "Circle", r: 2 }))).toEqual(Just(2));
    expect(set(l, Nothing, Just<Shape>({ tag: "Circle", r: 2 }))).toEqual(Nothing);
    expect(set(l, Just(7), Nothing as Maybe<Shape>)).toEqual(Just({ tag: "Circle", r: 7 }));
    const nested = maybeLens(_Just<number>());
    expect(view(nested, Just(Just(1)))).toEqual(Just(1));
  });

  test("setMaybeIso", () => {
    const i = setMaybeIso<number>();
    expect(view(i, S.empty<number>())).toEqual(Nothing);
    expect(view(i, S.fromList([3, 1, 2]))).toEqual(Just(1));
    expect(S.toList(review(i, Just(4)))).toEqual([4]);
    expect(S.toList(review(i, Nothing))).toEqual([]);
    // With a custom ordering the lowest in that ordering is taken.
    const rev = setMaybeIso<number>(down());
    expect(view(rev, S.fromList([3, 1, 2], down()))).toEqual(Just(3));
    expect(review(rev, Just(1)).cmp).toBe(review(rev, Nothing).cmp);
  });
});
