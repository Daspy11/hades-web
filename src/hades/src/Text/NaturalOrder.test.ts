import { describe, expect, test } from "vitest";
import {
  chunkText,
  compareNaturalChunk,
  compareNaturalChunks,
  isOther,
  LetterChunk,
  naturalChunkTags,
  naturalOrder,
  NumberChunk,
  OtherChunk,
  show_NaturalChunk,
  SpaceChunk,
  type NaturalChunk,
} from "./NaturalOrder";

describe("chunkText", () => {
  test("splits into runs and strips surrounding space", () => {
    expect(chunkText("  Goal 10a-b  ")).toEqual([
      LetterChunk("goal"),
      SpaceChunk,
      NumberChunk(10n),
      LetterChunk("a"),
      OtherChunk("-"),
      LetterChunk("b"),
    ]);
  });
  test("empty and all-space text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText(" \t\n ")).toEqual([]);
  });
  test("runs of whitespace of any kind form one chunk", () => {
    expect(chunkText("a \t 　b")).toEqual([LetterChunk("a"), SpaceChunk, LetterChunk("b")]);
  });
  test("U+2028 and U+FEFF are not Haskell spaces", () => {
    expect(chunkText("a b")).toEqual([LetterChunk("a"), OtherChunk(" "), LetterChunk("b")]);
    expect(chunkText("﻿a")).toEqual([OtherChunk("﻿"), LetterChunk("a")]);
  });
  test("numbers are arbitrary precision and leading zeros are dropped", () => {
    expect(chunkText("x007")).toEqual([LetterChunk("x"), NumberChunk(7n)]);
    expect(chunkText("123456789012345678901234567890")).toEqual([
      NumberChunk(123456789012345678901234567890n),
    ]);
  });
  test("non-ASCII digits are not numbers", () => {
    // Haskell isDigit is ASCII only; Arabic-Indic digits are neither letters nor marks.
    expect(chunkText("١٢")).toEqual([OtherChunk("١٢")]);
  });
  test("letters are case folded, marks join letter runs", () => {
    expect(chunkText("ABC")).toEqual([LetterChunk("abc")]);
    expect(chunkText("Straße")).toEqual([LetterChunk("strasse")]);
    expect(chunkText("ﬁne")).toEqual([LetterChunk("fine")]);
    expect(chunkText("ΟΔΟΣ")).toEqual([LetterChunk("οδοσ")]);
    expect(chunkText("ς")).toEqual([LetterChunk("σ")]);
    expect(chunkText("été")).toEqual([LetterChunk("été")]);
    expect(chunkText("ı")).toEqual([LetterChunk("ı")]);
    expect(chunkText("İ")).toEqual([LetterChunk("i̇")]);
    expect(chunkText("µ")).toEqual([LetterChunk("μ")]);
  });
  test("other characters are grouped and case folded", () => {
    expect(chunkText("a+-*/b")).toEqual([LetterChunk("a"), OtherChunk("+-*/"), LetterChunk("b")]);
    expect(chunkText("\u{1F600}\u{1F601}")).toEqual([OtherChunk("\u{1F600}\u{1F601}")]);
  });
  test("isOther", () => {
    expect(isOther("-")).toBe(true);
    expect(isOther("a")).toBe(false);
    expect(isOther("1")).toBe(false);
    expect(isOther(" ")).toBe(false);
    expect(isOther("́")).toBe(false);
  });
});

describe("NaturalChunk ordering", () => {
  test("constructor order is SpaceChunk < OtherChunk < NumberChunk < LetterChunk", () => {
    expect(naturalChunkTags).toEqual(["SpaceChunk", "OtherChunk", "NumberChunk", "LetterChunk"]);
    const chunks: NaturalChunk[] = [LetterChunk("a"), NumberChunk(1n), OtherChunk("z"), SpaceChunk];
    const sorted = [...chunks].sort(compareNaturalChunk);
    expect(sorted).toEqual([SpaceChunk, OtherChunk("z"), NumberChunk(1n), LetterChunk("a")]);
  });
  test("fields compare within a constructor", () => {
    expect(compareNaturalChunk(NumberChunk(2n), NumberChunk(10n))).toBe(-1);
    expect(compareNaturalChunk(NumberChunk(10n), NumberChunk(10n))).toBe(0);
    expect(compareNaturalChunk(LetterChunk("b"), LetterChunk("a"))).toBe(1);
    expect(compareNaturalChunk(OtherChunk("-"), OtherChunk("+"))).toBe(1);
    expect(compareNaturalChunk(SpaceChunk, SpaceChunk)).toBe(0);
  });
  test("lists compare lexicographically", () => {
    expect(compareNaturalChunks([LetterChunk("a")], [LetterChunk("a"), SpaceChunk])).toBe(-1);
    expect(compareNaturalChunks([], [])).toBe(0);
    expect(compareNaturalChunks([NumberChunk(3n)], [])).toBe(1);
  });
  test("show", () => {
    expect(show_NaturalChunk(SpaceChunk)).toBe("SpaceChunk");
    expect(show_NaturalChunk(NumberChunk(12n))).toBe("NumberChunk 12");
    expect(show_NaturalChunk(LetterChunk("ab"))).toBe('LetterChunk "ab"');
  });
});

describe("naturalOrder", () => {
  test("numbers compare numerically", () => {
    expect(naturalOrder("a2", "a10")).toBe(-1);
    expect(naturalOrder("a10", "a2")).toBe(1);
    expect(naturalOrder("Item 10", "item 9")).toBe(1);
    expect(naturalOrder("file99999999999999999999", "file100000000000000000000")).toBe(-1);
  });
  test("equal text is EQ", () => {
    expect(naturalOrder("", "")).toBe(0);
    expect(naturalOrder("Goal 1", "Goal 1")).toBe(0);
  });
  test("ties on chunks are broken by plain text order", () => {
    expect(naturalOrder("abc", "ABC")).toBe(1);
    expect(naturalOrder("ABC", "abc")).toBe(-1);
    expect(naturalOrder(" a", "a")).toBe(-1);
    expect(naturalOrder("a01", "a1")).toBe(-1);
    expect(naturalOrder("straße", "strasse")).toBe(1);
  });
  test("chunk kinds order", () => {
    expect(naturalOrder("a b", "a-b")).toBe(-1); // SpaceChunk < OtherChunk
    expect(naturalOrder("a-", "a1")).toBe(-1); // OtherChunk < NumberChunk
    expect(naturalOrder("1", "a")).toBe(-1); // NumberChunk < LetterChunk
    expect(naturalOrder("a", "a1")).toBe(-1); // prefix first
    expect(naturalOrder("", "a")).toBe(-1);
  });
  test("text comparison is by code point", () => {
    // U+1F600 is above U+FF01 as a code point, but below it as UTF-16 code units.
    expect(naturalOrder("\u{1F600}", "！")).toBe(1);
    expect(naturalOrder("！", "\u{1F600}")).toBe(-1);
  });
  test("sorting a list", () => {
    const names = ["Goal 10", "Goal 2", "goal 1", "Strategy", "Goal 1", "10", "9", "-x"];
    expect([...names].sort(naturalOrder)).toEqual([
      "-x",
      "9",
      "10",
      "Goal 1",
      "goal 1",
      "Goal 2",
      "Goal 10",
      "Strategy",
    ]);
  });
  test("is antisymmetric", () => {
    const xs = ["a", "A", "a1", "a01", "a 1", "a-1", "b", "", " ", "10", "9", "é", "é"];
    for (const x of xs) {
      for (const y of xs) {
        expect(naturalOrder(x, y) + naturalOrder(y, x)).toBe(0);
        if (x !== y) expect(naturalOrder(x, y)).not.toBe(0);
      }
    }
  });
});
