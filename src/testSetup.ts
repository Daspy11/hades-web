/**
 * Global vitest setup. Persistent maps and sets are AVL trees, so two equal values can have
 * different shapes; compare them with the library's structural `equals` instead.
 */
import { expect } from "vitest";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import { equals } from "@/lib/Data/Ord";

expect.addEqualityTesters([
  (a: unknown, b: unknown) =>
    a instanceof M.HMap || a instanceof S.HSet || b instanceof M.HMap || b instanceof S.HSet ? equals(a, b) : undefined,
]);
