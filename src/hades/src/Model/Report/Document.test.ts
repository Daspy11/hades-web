import { describe, expect, test } from "vitest";
import { sRGB24 } from "@/lib/Data/Colour";
import {
  Emph,
  Highlight,
  Icon,
  Link,
  LinkOut,
  Space,
  Span,
  Str,
  Strong,
  listNumberValues,
  noAttr,
  trimSpaces,
} from "./Document";

const red = sRGB24(255, 0, 0);
const id1 = "e386bb76-c5dd-5182-b2c8-f76ca3de8f8c";

describe("trimSpaces", () => {
  test("drops Space items and surrounding white space in text", () => {
    expect(trimSpaces([Space, Str("  a "), Space])).toEqual([Str("a")]);
    expect(trimSpaces([Str(" \t "), Str(" a b "), Str("\n")])).toEqual([Str("a b")]);
    expect(trimSpaces([Str("   ")])).toEqual([]);
    expect(trimSpaces([])).toEqual([]);
  });
  test("keeps interior spaces", () => {
    const xs = [Str("a"), Space, Str("b")];
    expect(trimSpaces(xs)).toEqual(xs);
  });
  test("trims inside nested inlines", () => {
    expect(trimSpaces([Emph([Space, Str(" x")]), Str("y ")])).toEqual([Emph([Str("x")]), Str("y")]);
    expect(trimSpaces([Str("a"), Strong([Str("b"), Space])])).toEqual([Str("a"), Strong([Str("b")])]);
    expect(trimSpaces([Highlight(red, [Space, Str("h ")]), Space])).toEqual([Highlight(red, [Str("h")])]);
    expect(trimSpaces([Span(noAttr, [Str(" s")]), LinkOut("http://x", [Str("u "), Space])])).toEqual([
      Span(noAttr, [Str("s")]),
      LinkOut("http://x", [Str("u")]),
    ]);
  });
  test("nested inlines that are all space are removed", () => {
    expect(trimSpaces([Emph([Space]), Str(" z")])).toEqual([Str("z")]);
    expect(trimSpaces([Link(id1, [Space]), Str("x"), Strong([Str("  ")])])).toEqual([Str("x")]);
  });
  test("icons stop trimming", () => {
    expect(trimSpaces([Icon("i"), Space])).toEqual([Icon("i")]);
    expect(trimSpaces([Space, Icon("i"), Space, Str(" ")])).toEqual([Icon("i")]);
    expect(trimSpaces([Space, Icon("i"), Str(" a ")])).toEqual([Icon("i"), Str(" a")]);
  });
  test("does not modify its argument", () => {
    const xs = [Space, Str(" a ")];
    trimSpaces(xs);
    expect(xs).toEqual([Space, Str(" a ")]);
  });
});

test("ListNumber values in constructor order", () => {
  expect(listNumberValues).toEqual([
    "ListDecimal",
    "ListAlphaUpper",
    "ListAlphaLower",
    "ListRomanUpper",
    "ListRomanLower",
  ]);
});
