// Ported from banana-ui/webits/test/TestMain.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Tests for `Data.ForestModel`: the hspec test cases and the QuickCheck properties of the
 * original. QuickCheck's `arbitrary` forests are replaced by a small seeded random generator;
 * each property runs on 1000 random cases, as with `withMaxSuccess 1000`.
 */
import { describe, expect, it } from "vitest";
import * as FM from "@/banana-ui/webits/src/Data/ForestModel";
import * as T from "@/lib/Data/Tree";
import { view, from } from "@/lib/Control/Lens";
import type { StateCell } from "@/lib/Control/Lens";

type Forest = T.Forest<number>;
const Node = T.Node;

/** Test forest. Node values chosen to be equal to model indices. */
const testForest: Forest = [Node(1, [Node(2, []), Node(3, [])]), Node(4, [Node(5, []), Node(6, []), Node(7, [])]), Node(8, [])];

const testModel: FM.Model<number> = FM.makeModel(testForest);

/** `FM.evalEdit (act >> FM.getForest) testModel` */
function forestAfter(act: (st: StateCell<FM.Model<number>>) => unknown): T.Tree<number>[] {
  return FM.evalEdit((st) => {
    act(st);
    return FM.getForest(st);
  }, testModel);
}

describe("testCases", () => {
  it("DeleteRoot: Deletes node 1 in the model.", () => {
    expect(forestAfter((st) => FM.delete_(st, 1))).toEqual(testForest.slice(1));
  });
  it("DeleteChild: Deletes node 2 in the model.", () => {
    const [n1, ...ns1] = testForest;
    const n1_ = Node(n1.rootLabel, n1.subForest.slice(1));
    expect(forestAfter((st) => FM.delete_(st, 2))).toEqual([n1_, ...ns1]);
  });
  it("InsertRoot1: Inserts a node value 99 at the start of the tree.", () => {
    expect(forestAfter((st) => FM.insert(st, "InsertBefore", 1, 99))).toEqual([Node(99, []), ...testForest]);
  });
  it("InsertRoot2: Inserts a node value 99 after node 1.", () => {
    const f1 = testForest.slice(0, 1), f2 = testForest.slice(1);
    expect(forestAfter((st) => FM.insert(st, "InsertAfter", 1, 99))).toEqual([...f1, Node(99, []), ...f2]);
  });
  it("InsertRoot3: Inserts a child of the rootIndex", () => {
    expect(forestAfter((st) => FM.insert(st, "InsertChild", FM.rootIndex, 99))).toEqual([Node(99, []), ...testForest]);
  });
  it("InsertRoot4: Appends a child of the rootIndex", () => {
    expect(forestAfter((st) => FM.insert(st, "AppendChild", FM.rootIndex, 99))).toEqual([...testForest, Node(99, [])]);
  });
  it("InsertChild: Inserts a node value 99 at the start of the node 1 children.", () => {
    const [n1, ...ns] = testForest;
    const n1_ = Node(n1.rootLabel, [Node(99, []), ...n1.subForest]);
    expect(forestAfter((st) => FM.insert(st, "InsertChild", 1, 99))).toEqual([n1_, ...ns]);
  });
  it("AppendChild: Appends a node value 99 at the end of the node 1 children.", () => {
    const [n1, ...ns] = testForest;
    const n1_ = Node(n1.rootLabel, [...n1.subForest, Node(99, [])]);
    expect(forestAfter((st) => FM.insert(st, "AppendChild", 1, 99))).toEqual([n1_, ...ns]);
  });
  it("InsertAfterChild1: Inserts a node value 99 after node 2.", () => {
    const [n1, ...ns1] = testForest;
    const [n2, ...ns2] = n1.subForest;
    const n1_ = Node(n1.rootLabel, [n2, Node(99, []), ...ns2]);
    expect(forestAfter((st) => FM.insert(st, "InsertAfter", 2, 99))).toEqual([n1_, ...ns1]);
  });
  it("InsertAfterChild2: Inserts a node value 99 after node 3.", () => {
    const [n1, ...ns1] = testForest;
    const n1_ = Node(n1.rootLabel, [...n1.subForest, Node(99, [])]);
    expect(forestAfter((st) => FM.insert(st, "InsertAfter", 3, 99))).toEqual([n1_, ...ns1]);
  });
  it("InsertBeforeChild: Inserts a node value 99 before node 3.", () => {
    const [n1, ...ns1] = testForest;
    const [n2, ...ns2] = n1.subForest;
    const n1_ = Node(n1.rootLabel, [n2, Node(99, []), ...ns2]);
    expect(forestAfter((st) => FM.insert(st, "InsertBefore", 3, 99))).toEqual([n1_, ...ns1]);
  });
  it("Move1: Moves node 1 to be a child of node 8.", () => {
    const [n1, n4, n8] = testForest;
    expect(forestAfter((st) => FM.move(st, 1, "InsertChild", 8))).toEqual([n4, Node(n8.rootLabel, [n1])]);
  });
  it("Move2: Fails to move node 1 to be a child of node 2.", () => {
    expect(forestAfter((st) => FM.move(st, 1, "InsertChild", 2))).toEqual(testForest);
  });
  it("Move3: Moves node 2 to be the first root node.", () => {
    const [n1, n4, n8] = testForest;
    const [n2, ...ns] = n1.subForest;
    expect(forestAfter((st) => FM.move(st, 2, "InsertChild", FM.rootIndex))).toEqual([n2, Node(n1.rootLabel, ns), n4, n8]);
  });
  it("Move4: Moves node 2 to be the last root node.", () => {
    const [n1, n4, n8] = testForest;
    const [n2, ...ns] = n1.subForest;
    expect(forestAfter((st) => FM.move(st, 2, "AppendChild", FM.rootIndex))).toEqual([Node(n1.rootLabel, ns), n4, n8, n2]);
  });
  it("Move5: Fails to move root to be a child of node 1.", () => {
    expect(forestAfter((st) => FM.move(st, FM.rootIndex, "InsertChild", 1))).toEqual(testForest);
  });
});

// ---------------------------------------------------------------------------------------------
// Property tests

/** A small deterministic PRNG (mulberry32) standing in for QuickCheck's generator. */
function mkRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Gen {
  int(lo: number, hi: number): number;
  elements<A>(xs: readonly A[]): A;
  arbitraryInt(): number;
  forest(size: number): Forest;
  tree(size: number): T.Tree<number>;
}

function gen(seed: number): Gen {
  const rnd = mkRandom(seed);
  const g: Gen = {
    int: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),
    elements: (xs) => xs[Math.floor(rnd() * xs.length)],
    arbitraryInt: () => g.int(-30, 30),
    // QuickCheck's `Arbitrary (Tree a)` splits the size between the children.
    tree: (size) => {
      const n = size <= 0 ? 0 : g.int(0, Math.min(4, size));
      const childSize = n === 0 ? 0 : Math.floor((size - 1) / n);
      const kids: T.Tree<number>[] = [];
      for (let i = 0; i < n; i++) kids.push(g.tree(childSize));
      return Node(g.arbitraryInt(), kids);
    },
    forest: (size) => {
      const n = g.int(0, Math.max(0, Math.min(5, size)));
      const out: T.Tree<number>[] = [];
      for (let i = 0; i < n; i++) out.push(g.tree(Math.floor(size / Math.max(1, n))));
      return out;
    },
  };
  return g;
}

const insertions: readonly FM.Insertion[] = FM.insertionValues; // chooseEnum (InsertChild, InsertAfter)

/** `withMaxSuccess 1000` */
function forAll(name: string, prop: (g: Gen, size: number) => void): void {
  it(name, () => {
    for (let i = 0; i < 1000; i++) prop(gen(1000 * i + name.length), i % 30);
  });
}

describe("testProperties", () => {
  forAll("ModelIso", (g, size) => {
    const x = g.forest(size);
    expect(view(FM.modelIso<number>().dot(from(FM.modelIso<number>())), x)).toEqual(x);
  });

  forAll("InsertDelete1", (g, size) => {
    const x = g.forest(size);
    const mdl = view(FM.modelIso<number>(), x);
    const keys = FM.evalEdit(FM.getForestIndices, mdl).flatMap(T.flatten);
    const [n, ins]: [number, FM.Insertion] =
      keys.length === 0 || g.int(1, 11) === 1
        ? [FM.rootIndex, g.elements<FM.Insertion>(["InsertChild", "AppendChild"])]
        : [g.elements(keys), g.elements(insertions)];
    const v = g.arbitraryInt();
    const result = FM.evalEdit((st) => {
      const k = FM.insert(st, ins, n, v);
      if (k.tag === "Nothing") throw new Error("Invalid insert.");
      if (!FM.delete_(st, k.value)) throw new Error("Delete failed.");
      return FM.getForest(st);
    }, mdl);
    expect(result).toEqual(x);
  });

  forAll("InsertDelete2", (g, size) => {
    const x = g.forest(size);
    const mdl = view(FM.modelIso<number>(), x);
    const n = g.int(0, 1) === 0 ? FM.rootIndex : Math.abs(g.arbitraryInt());
    const ins = g.elements(insertions);
    const v = g.arbitraryInt();
    const result = FM.evalEdit((st) => {
      const k = FM.insert(st, ins, n, v);
      if (k.tag === "Just") {
        if (!FM.delete_(st, k.value)) throw new Error("Delete failed.");
      }
      return FM.getForest(st);
    }, mdl);
    expect(result).toEqual(x);
  });

  forAll("StableUpdate", (g, size) => {
    // NonEmptyList (Tree Int)
    const x = [g.tree(size), ...g.forest(size)];
    const mdl1 = view(FM.modelIso<number>(), x);
    const keys = FM.evalEdit(FM.getForestIndices, mdl1).flatMap(T.flatten);
    const n1 = g.elements(keys);
    const ins = g.elements(insertions);
    const n2 = g.elements([FM.rootIndex, ...keys]);
    const mdl2 = FM.execEdit((st) => FM.move(st, n1, ins, n2), mdl1);
    const forest2 = FM.evalEdit(FM.getForestIndices, mdl2);
    const mdl3 = FM.stableUpdate(forest2, mdl1);
    expect(view(from(FM.modelIso<number>()), mdl3)).toEqual(view(from(FM.modelIso<number>()), mdl2));
  });
});

describe("Model Eq instance", () => {
  it("compares the forests, not the indices", () => {
    const m1 = FM.makeModel(testForest);
    const m2 = FM.execEdit((st) => {
      FM.delete_(st, 8);
      FM.insert(st, "AppendChild", FM.rootIndex, 8);
    }, m1);
    expect(m2._modelTop).not.toBe(m1._modelTop);
    expect(FM.eq_Model(m1, m2)).toBe(true);
    expect(FM.eq_Model(m1, FM.emptyModel())).toBe(false);
  });

  it("isDescendantOf / isStrictDescendantOf", () => {
    expect(FM.evalEdit((st) => FM.isDescendantOf(st, 2, 1), testModel)).toBe(true);
    expect(FM.evalEdit((st) => FM.isDescendantOf(st, 1, 1), testModel)).toBe(true);
    expect(FM.evalEdit((st) => FM.isStrictDescendantOf(st, 1, 1), testModel)).toBe(false);
    expect(FM.evalEdit((st) => FM.isDescendantOf(st, 5, 1), testModel)).toBe(false);
    expect(FM.evalEdit((st) => FM.isDescendantOf(st, 99, FM.rootIndex), testModel)).toBe(false);
  });

  it("mapWithIndex and ix", () => {
    const m = FM.mapWithIndex((i, v) => i * 100 + v, testModel);
    expect(FM.evalEdit((st) => FM.getItem(st, 3), m)).toBe(303);
    expect(() => FM.evalEdit((st) => FM.getItem(st, 42), m)).toThrow(/not found/);
  });
});
