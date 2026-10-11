import { describe, expect, test } from "vitest";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import { over, preview, review, toListOf, view } from "@/lib/Control/Lens";
import {
  VNode, fmap_VTree, forestIso, fromTree, getNode, getValue, goDown, goNext, goUp, ix_VTree, root, setValue,
  toTree, treeIso,
} from "./VTree";

const t = VNode("a", [VNode("b", [VNode("d", [])]), VNode("c", [])]);

describe("Data.VTree", () => {
  test("getNode / getValue", () => {
    expect(getValue([], t)).toEqual(Just("a"));
    expect(getValue([0, 0], t)).toEqual(Just("d"));
    expect(getValue([1], t)).toEqual(Just("c"));
    expect(getValue([2], t)).toEqual(Nothing);
    expect(getNode([0, 1], t)).toEqual(Nothing);
  });

  test("setValue returns the updated subtree (as in Haskell)", () => {
    expect(setValue([], "z", t)).toEqual(Just(VNode("z", t._branches)));
    expect(setValue([0], "z", t)).toEqual(Just(VNode("z", [VNode("d", [])])));
    expect(setValue([5], "z", t)).toEqual(Nothing);
  });

  test("ix_VTree", () => {
    expect(toListOf(ix_VTree([0, 0]), t)).toEqual(["d"]);
    expect(toListOf(ix_VTree([3]), t)).toEqual([]);
    const t2 = over(ix_VTree<string>([0, 0]), (s) => s.toUpperCase(), t);
    expect(getValue([0, 0], t2)).toEqual(Just("D"));
    expect(over(ix_VTree<string>([9]), (s) => s + "!", t)).toEqual(t);
    expect(preview(ix_VTree([]), t)).toEqual(Just("a"));
  });

  test("navigation", () => {
    expect(goDown(t, [])).toEqual(Just([0]));
    expect(goDown(t, [1])).toEqual(Nothing);
    expect(goUp([0, 0])).toEqual(Just([0]));
    expect(goUp([])).toEqual(Nothing);
    expect(goNext(t, [0])).toEqual(Just([1]));
    expect(goNext(t, [1])).toEqual(Nothing);
    expect(goNext(t, [])).toEqual(Nothing);
  });

  test("conversions, lenses and fmap", () => {
    const tree = Node(1, [Node(2, [Node(3)]), Node(4)]);
    expect(toTree(fromTree(tree))).toEqual(tree);
    expect(view(treeIso<number>(), tree)).toEqual(fromTree(tree));
    expect(review(treeIso<number>(), fromTree(tree))).toEqual(tree);
    expect(view(forestIso<number>(), [tree])).toEqual([fromTree(tree)]);
    expect(view(root(), t)).toBe("a");
    expect(toTree(fmap_VTree((x: number) => x * 10, fromTree(tree)))).toEqual(Node(10, [Node(20, [Node(30)]), Node(40)]));
  });
});
