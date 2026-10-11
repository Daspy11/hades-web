import { describe, expect, test } from "vitest";
import { sRGB24 } from "@/lib/Data/Colour";
import { Just, Nothing, maybeToList } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import {
  Attr,
  DefinitionList,
  Div,
  Emph,
  Heading,
  Highlight,
  Icon,
  Link,
  Matrix,
  MatrixHeader,
  Null,
  OrderedList,
  Para,
  Picture,
  Plain,
  Space,
  Span,
  Str,
  UnorderedList,
  noAttr,
  type Block,
  type Inline,
} from "./Document";
import {
  Monoid_List,
  Walkable_Attr_BlockList,
  Walkable_Block_Block,
  Walkable_Block_BlockList,
  Walkable_Inline_Block,
  Walkable_Inline_BlockList,
  Walkable_InlineList_Block,
  Walkable_InlineList_BlockList,
  Walkable_InlineList_InlineList,
  Walkable_List,
  Walkable_MatrixHeader_Block,
  query,
  unifyIdents,
  walk,
  walkM,
} from "./Walkable";

const red = sRGB24(255, 0, 0);
const idA = "00000000-0000-0000-0000-00000000000a";
const idB = "00000000-0000-0000-0000-00000000000b";
const idC = "00000000-0000-0000-0000-00000000000c";
const idD = "00000000-0000-0000-0000-00000000000d";

const cls = (c: string) => Attr(Nothing, Just(c));
const ident = (i: string, p: number, c?: string) => Attr(Just([i, p] as const), c === undefined ? Nothing : Just(c));

/** A block exercising every constructor. */
const sample: Block[] = [
  Heading(1, cls("h"), [Str("a"), Space, Emph([Str("a")])]),
  Para([Span(cls("span"), [Str("a")]), Link(idA, [Str("a")])]),
  Plain([Highlight(red, [Str("a")]), Icon("icon")]),
  OrderedList("ListDecimal", [[Para([Str("a")])], [Null]]),
  UnorderedList([[Plain([Str("a")])]]),
  DefinitionList([[[Str("a")], [Para([Str("a")])]]]),
  Matrix(
    cls("matrix"),
    [Str("a")],
    [MatrixHeader([Str("a")], [[Str("a")], [Span(cls("header"), [Str("a")])]])],
    [Node([[cls("cell"), [Para([Span(cls("in-cell"), [Str("a")])])]]], [Node([[cls("cell2"), [Null]]])])],
  ),
  Div(cls("div"), [Picture(cls("picture"), [Str("a")], "alt", [10, 20], idB)]),
  Null,
];

const strings = (blks: readonly Block[]): string[] =>
  query(Walkable_Inline_BlockList, Monoid_List<string>(), (i: Inline) => (i.tag === "Str" ? [i._0] : []), blks) as string[];

describe("walk", () => {
  test("Inline over blocks reaches every inline", () => {
    expect(strings(sample).length).toBe(15);
    const renamed = walk(Walkable_Inline_BlockList, (i: Inline) => (i.tag === "Str" && i._0 === "a" ? Str("b") : i), sample);
    expect(strings(renamed)).toEqual(Array(15).fill("b"));
    // Nothing else changed.
    const back = walk(Walkable_Inline_BlockList, (i: Inline) => (i.tag === "Str" && i._0 === "b" ? Str("a") : i), renamed);
    expect(back).toEqual(sample);
  });

  test("Inline walk is bottom up", () => {
    const seen: string[] = [];
    walkM(
      Walkable_Inline_Block,
      (i: Inline) => {
        seen.push(i.tag === "Str" ? i._0 : i.tag);
        return i;
      },
      Para([Emph([Str("x"), Str("y")]), Str("z")]),
    );
    expect(seen).toEqual(["x", "y", "Emph", "z"]);
  });

  test("[Inline] over blocks applies the function to every inline list, innermost first", () => {
    const fix = (is: readonly Inline[]): Inline[] => (is.length === 0 ? [] : [Highlight(red, is)]);
    expect(walk(Walkable_InlineList_Block, fix, Para([Str("x"), Emph([Str("y")])]))).toEqual(
      Para([Highlight(red, [Str("x"), Emph([Highlight(red, [Str("y")])])])]),
    );
    expect(walk(Walkable_InlineList_Block, fix, Para([]))).toEqual(Para([]));
    const header = walk(Walkable_InlineList_BlockList, fix, [
      Matrix(noAttr, [], [MatrixHeader([Str("n")], [[Str("c")]])], []),
    ]);
    expect(header).toEqual([
      Matrix(noAttr, [], [MatrixHeader([Highlight(red, [Str("n")])], [[Highlight(red, [Str("c")])]])], []),
    ]);
  });

  test("[Inline] over [Inline] includes the outer list", () => {
    const lengths = query(
      Walkable_InlineList_InlineList,
      Monoid_List<number>(),
      (is: readonly Inline[]) => [is.length],
      [Emph([Str("a"), Str("b")]), Str("c")],
    );
    expect(lengths).toEqual([2, 2]);
  });

  test("Block over blocks: walk bottom up, query top down", () => {
    const blk = Div(noAttr, [Para([]), Div(cls("inner"), [Null])]);
    const tags = query(Walkable_Block_Block, Monoid_List<string>(), (b: Block) => [b.tag], blk);
    expect(tags).toEqual(["Div", "Para", "Div", "Null"]);
    const order: string[] = [];
    walkM(
      Walkable_Block_Block,
      (b: Block) => {
        order.push(b.tag);
        return b;
      },
      blk,
    );
    expect(order).toEqual(["Para", "Null", "Div", "Div"]);
    const replaced = walk(Walkable_Block_BlockList, (b: Block) => (b.tag === "Null" ? Plain([Str("was null")]) : b), [blk]);
    expect(replaced).toEqual([Div(noAttr, [Para([]), Div(cls("inner"), [Plain([Str("was null")])])])]);
  });

  test("MatrixHeader over blocks", () => {
    const names = query(
      Walkable_MatrixHeader_Block,
      Monoid_List<number>(),
      (h: MatrixHeader) => [h.matrixHeaderColumns.length],
      sample[6],
    );
    expect(names).toEqual([2]);
  });
});

describe("query", () => {
  test("Attr over blocks finds every attribute except those of matrix cells", () => {
    const classes = query(Walkable_Attr_BlockList, Monoid_List<string>(), (a: Attr) => maybeToList(a.attrClass), sample);
    expect(classes).toEqual(["h", "span", "matrix", "header", "in-cell", "div", "picture"]);
  });

  test("lists of lists", () => {
    const w = Walkable_List(Walkable_Inline_BlockList);
    expect(walk(w, (i: Inline) => i, [[Null], []])).toEqual([[Null], []]);
  });
});

describe("unifyIdents", () => {
  test("keeps the highest priority, earliest label and removes dangling links", () => {
    const blocks: Block[] = [
      Heading(1, ident(idA, 2), [Str("A heading")]),
      Para([Span(ident(idA, 1, "c"), [Str("A span")])]),
      Para([Link(idA, [Str("ref")]), Space, Link(idB, [Emph([Str("dangling")])])]),
      Div(ident(idC, 5), [Heading(2, ident(idC, 5, "k"), [Str("C again")])]),
      // Matrix cell attributes are not visited, so idD is not a label.
      Matrix(noAttr, [Link(idD, [Str("to cell")])], [], [Node([[ident(idD, 0), [Null]]])]),
    ];
    const [result, labels] = unifyIdents(blocks);
    expect(labels).toEqual([idA, idC]);
    expect(result).toEqual([
      Heading(1, Attr(Nothing, Nothing), [Str("A heading")]),
      Para([Span(ident(idA, 1, "c"), [Str("A span")])]),
      Para([Link(idA, [Str("ref")]), Space, Span(noAttr, [Emph([Str("dangling")])])]),
      Div(ident(idC, 5), [Heading(2, Attr(Nothing, Just("k")), [Str("C again")])]),
      Matrix(noAttr, [Span(noAttr, [Str("to cell")])], [], [Node([[ident(idD, 0), [Null]]])]),
    ]);
  });

  test("no labels", () => {
    expect(unifyIdents([Para([Str("x")])])).toEqual([[Para([Str("x")])], []]);
    expect(unifyIdents([])).toEqual([[], []]);
  });
});
