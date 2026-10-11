import { describe, expect, it } from "vitest";
import * as M from "@/lib/Data/Map";
import { equals } from "@/lib/Data/Ord";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import { Left, Right } from "@/lib/Data/Either";
import { lens } from "@/lib/Control/Lens";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { type Entity, type EntityClass, type Model, Name } from "@/hades/src/Model/Abstract/PackageTree";
import {
  QueryStep, append_QueryStep, childrenStep, compileQuery, filterStep, filterVariants, followArrows,
  inStep, mconcat_QueryStep, mempty_QueryStep, noStep, parentStep, runQuery, runStep, step, subQuery,
} from "./Base";

// Compare persistent maps and sets by their contents (Haskell Eq), not their tree shapes.
expect.addEqualityTesters([
  (a: unknown, b: unknown) =>
    a instanceof M.HMap || a instanceof S.HSet || b instanceof M.HMap || b instanceof S.HSet
      ? equals(a, b)
      : undefined,
]);

// A minimal entity type: a name and a variant.
interface TV {
  readonly nm: Name;
  readonly variant: string;
}

const cls = {
  reflectiveName: (v: TV) => v.variant,
  variantUserLabel: (v: string) => v,
  reflectiveDefaults: [],
  reflectiveBuiltIn: () => [],
  reflectiveGet: () => M.empty(),
  reflectiveSet: (_st: unknown, v: TV) => v,
  reflectiveBuiltInRefs: { _0: M.empty() },
  reflectiveArrows: M.empty(),
  name: lens((v: TV) => v.nm, (v: TV, n: Name) => ({ ...v, nm: n })),
} as unknown as EntityClass<TV>;

const id = (n: number): U.UUID => U.fromWords(0, 0, 0, n);

function mkEntity(n: number, parent: number, variant: string, children: number[] = []): Entity<TV> {
  return {
    entityId: id(n),
    _entityParent: parent === 0 ? U.nil : id(parent),
    _entityChildren: M.fromList(children.map((c) => [Name("e" + c), id(c)] as const)),
    _entityContents: { nm: Name("e" + n), variant },
    _entityExtensions: M.empty(),
    entityCreated: ["test", "2020-01-01"],
    _entityModified: ["test", "2020-01-01"],
  } as unknown as Entity<TV>;
}

// Model: 1 (Box) has children 2 (Box), 3 (Arrow). 3 -tail-> 2, 3 -head-> 4. 4 is a Box at the root.
const entities = [
  mkEntity(1, 0, "Box", [2, 3]),
  mkEntity(2, 1, "Box"),
  mkEntity(3, 1, "Arrow"),
  mkEntity(4, 0, "Box"),
];
const relations = NR.insert(id(3), id(4), "Head", NR.insert(id(3), id(2), "Tail", NR.empty<U.UUID>()));
const model = {
  modelContents: M.fromList(entities.map((e) => [e.entityId, e] as const)),
  modelRelations: relations,
  modelExtensions: M.empty(),
} as unknown as Model<TV>;

const ids = (...ns: number[]) => S.fromList(ns.map(id));
const addStep = (n: number) => QueryStep<TV>((_o, _m, i) => [S.insert(id(n), i), ["added " + n]]);

describe("QueryStep monoid", () => {
  it("mempty copies its input and noStep produces nothing", () => {
    expect(runStep(mempty_QueryStep, [], model, ids(1, 2))).toEqual([ids(1, 2), []]);
    expect(runStep(noStep, [], model, ids(1, 2))).toEqual([S.empty(), []]);
  });
  it("append runs steps in sequence", () => {
    const qs = append_QueryStep(addStep(1), addStep(2));
    expect(qs.runStep([], model, ids())).toEqual([ids(1, 2), ["added 1", "added 2"]]);
    expect(mconcat_QueryStep([addStep(1), parentStep(cls), addStep(3)]).runStep([], model, ids()))
      .toEqual([S.fromList([U.nil, id(3)]), ["added 1", "added 3"]]);
  });
  it("inStep runs steps in parallel", () => {
    const qs = inStep(addStep(1), addStep(2));
    expect(qs.runStep([], model, ids(4))).toEqual([ids(1, 2, 4), ["added 1", "added 2"]]);
  });
});

describe("built in steps", () => {
  it("parentStep and childrenStep", () => {
    expect(parentStep(cls).runStep([], model, ids(2, 3))[0]).toEqual(ids(1));
    expect(parentStep(cls).runStep([], model, ids(1, 99))[0]).toEqual(S.fromList([U.nil]));
    expect(childrenStep(cls).runStep([], model, ids(1, 2))[0]).toEqual(ids(2, 3));
  });
  it("step follows relations", () => {
    expect(step(cls, S.fromList(["Tail"])).runStep([], model, ids(2, 3))[0]).toEqual(ids(2, 3));
    expect(step(cls, S.fromList(["Tail", "Head"])).runStep([], model, ids(3))[0]).toEqual(ids(2, 4));
  });
  it("filterVariants and filterStep", () => {
    expect(filterVariants(cls, S.fromList(["Arrow"])).runStep([], model, ids(1, 2, 3))).toEqual([ids(3), []]);
    const fs = filterStep(cls, (_o, e) =>
      e._entityContents.variant === "Arrow" ? Left("no arrows") : Right(true));
    expect(fs.runStep([], model, ids(2, 3, 99))).toEqual([
      ids(2),
      ["e3: no arrows", "Internal error: UUID " + id(99) + " not found in model."],
    ]);
  });
  it("followArrows goes from box to box", () => {
    expect(followArrows(cls, S.fromList(["Arrow"]), "Tail", "Head").runStep([], model, ids(2))[0]).toEqual(ids(4));
    expect(followArrows(cls, S.fromList(["Arrow"]), "Head", "Tail").runStep([], model, ids(4))[0]).toEqual(ids(2));
  });
});

describe("compileQuery and runQuery", () => {
  const u = (n: number) => U.fromWords(1, 0, 0, n);
  it("connects input to output through steps", () => {
    const q = compileQuery<TV>(
      [[u(1), childrenStep(cls)], [u(2), filterVariants(cls, S.fromList(["Box"]))]],
      [[U.nil, u(1)], [u(1), u(2)], [u(2), U.nil], [u(3), U.nil]],
    );
    expect(runQuery(q, [], model, ids(1))).toEqual([ids(2), []]);
  });
  it("an empty query passes nothing through", () => {
    const q = compileQuery<TV>([], []);
    expect(runQuery(q, [], model, ids(1))).toEqual([S.empty(), []]);
  });
  it("a direct link copies the input", () => {
    const q = compileQuery<TV>([], [[U.nil, U.nil]]);
    expect(runQuery(q, [], model, ids(1, 2))).toEqual([ids(1, 2), []]);
  });
  it("iterates loops to a fixpoint and de-duplicates messages", () => {
    // Input -> parent -> output, with parent looping back to itself.
    const q = compileQuery<TV>(
      [[u(1), append_QueryStep(parentStep(cls), QueryStep<TV>((_o, _m, i) => [i, S.isNull(i) ? [] : ["step"]]))]],
      [[U.nil, u(1)], [u(1), u(1)], [u(1), U.nil]],
    );
    const [result, msgs] = runQuery(q, [], model, ids(2));
    expect(result).toEqual(S.fromList([id(1), U.nil]));
    expect(msgs).toEqual(["step"]);
    expect(subQuery(q).runStep([], model, ids(2))).toEqual([result, msgs]);
  });
});
