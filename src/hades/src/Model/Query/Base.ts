// Ported from hades/src/Model/Query/Base.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Core abstractions of the query language: query steps and the graphs of steps that make up a
 * query.
 *
 * TypeScript port
 * ---------------
 * * `newtype QueryStep v = QueryStep {runStep :: ...}` has its own `Semigroup`/`Monoid`
 *   instances, so it is a record `{ runStep }` built with `QueryStep(f)`. The curried Haskell
 *   function is uncurried: `runStep(outers, model, inputs)`. The free function
 *   `runStep(qs, outers, model, inputs)` is the Haskell field accessor applied in full.
 *   `qs1 <> qs2` is `append_QueryStep(qs1, qs2)`, `mempty` is `mempty_QueryStep` and `mconcat`
 *   is `mconcat_QueryStep`.
 * * Constrained steps take the `EntityClass` dictionary first: `step(cls, rels)`,
 *   `filterStep(cls, p)`, `parentStep(cls)`, `childrenStep(cls)`, `filterVariants(cls, vars)`,
 *   `followArrows(cls, variants, rel1, rel2)`.
 * * `Query v` is the fgl graph `Gr (QueryStep v) ()`. Only `mkGraph`, `labNodes` and `pre` are
 *   used, so it is represented directly as its labelled nodes (in ascending node order, as
 *   `labNodes` returns them) and its edge list. It is opaque to other modules, which only use
 *   `compileQuery` and `runQuery`.
 * * The `IntMap` of node results is an `M.Map<number, S.Set<ModelId>>`.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe, catMaybes, mapMaybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either, partitionEithers } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { view } from "@/lib/Control/Lens";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import type { ExtensionValues, Variant } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type EntityClass, type Model, type ModelId,
  entityName, entityVariantProperties, nameText,
} from "@/hades/src/Model/Abstract/PackageTree";

// ---------------------------------------------------------------------------------------------
// * Core abstractions

/** The UUID of a query diagram in the model. */
export type QueryId = ModelId;

/**
 * A query step uses a model to convert a set of incoming UUIDs from previous steps
 * into a set of outgoing UUIDs to be passed to succeeding steps. The function can also
 * return a list of text strings containing warning messages about the execution
 * of the query step. The first argument is a list of model IDs from outer queries in a matrix
 * or report. These are used in formulae to determine the complete set of visible extension values.
 *
 * The monoid instance allows two or more sequential steps to be joined together into a single one.
 *
 * Law: there is no cross-talk between set members in the @runStep@ function. Formally
 *
 * >    union (fst $ runStep q m s1) (fst $ runStep q m s2) == fst (runStep q m (union s1 s2))
 */
export interface QueryStep<V> {
  readonly runStep: (
    outers: readonly ModelId[],
    model: Model<V>,
    inputs: S.Set<ModelId>,
  ) => [S.Set<ModelId>, T.Text[]];
}
export function QueryStep<V>(
  runStep: (outers: readonly ModelId[], model: Model<V>, inputs: S.Set<ModelId>) => [S.Set<ModelId>, T.Text[]],
): QueryStep<V> {
  return { runStep };
}

/** The `runStep` field accessor, fully applied: `runStep qs outers model inputs`. */
export function runStep<V>(
  qs: QueryStep<V>,
  outers: readonly ModelId[],
  model: Model<V>,
  inputs: S.Set<ModelId>,
): [S.Set<ModelId>, T.Text[]] {
  return qs.runStep(outers, model, inputs);
}

/** `instance Semigroup (QueryStep v)`: run the first step, then feed its output to the second. */
export function append_QueryStep<V>(qs1: QueryStep<V>, qs2: QueryStep<V>): QueryStep<V> {
  return QueryStep<V>((evs, m, i) => {
    const [r1, msgs1] = qs1.runStep(evs, m, i);
    const [r2, msgs2] = qs2.runStep(evs, m, r1);
    return [r2, [...msgs1, ...msgs2]];
  });
}

/** `instance Monoid (QueryStep v)`: copies its inputs to its outputs. */
export const mempty_QueryStep: QueryStep<any> = QueryStep<any>((_evs, _m, i) => [i, []]);

/** `mconcat` for query steps. */
export function mconcat_QueryStep<V>(qss: readonly QueryStep<V>[]): QueryStep<V> {
  return L.foldr(append_QueryStep, mempty_QueryStep as QueryStep<V>, qss);
}

/**
 * A step with no output. This is distinct from "mempty" which copies its inputs to its outputs.
 * Hence this is the unit of parallelisation while "mempty" is the unit of sequencing.
 */
export const noStep: QueryStep<any> = QueryStep<any>((_evs, _m, _i) => [S.empty(), []]);

/** Run the two arguments in parallel and unify their outputs. */
export function inStep<V>(qs1: QueryStep<V>, qs2: QueryStep<V>): QueryStep<V> {
  // Haskell: QueryStep $ \m i -> runStep qs1 m i `mappend` runStep qs2 m i
  // (the "Monoid" of functions, sets and lists).
  return QueryStep<V>((evs, m, i) => {
    const [r1, msgs1] = qs1.runStep(evs, m, i);
    const [r2, msgs2] = qs2.runStep(evs, m, i);
    return [S.union(r1, r2), [...msgs1, ...msgs2]];
  });
}

/**
 * A query consists of a graph of query steps. Edges denote the flow of results between steps.
 *
 * Haskell `type Query v = Gr (QueryStep v) ()`: the labelled nodes in ascending node order and
 * the edges as (from, to) node pairs.
 */
export interface Query<V> {
  readonly queryNodes: readonly (readonly [number, QueryStep<V>])[];
  readonly queryEdges: readonly (readonly [number, number])[];
}

/** fgl `mkGraph`: nodes are kept in ascending order; a repeated node keeps its last label. */
function mkGraph<V>(
  ns: readonly (readonly [number, QueryStep<V>])[],
  es: readonly (readonly [number, number, null])[],
): Query<V> {
  return {
    queryNodes: M.toList(M.fromList(ns)),
    queryEdges: es.map(([n1, n2]) => [n1, n2] as const),
  };
}

/** fgl `labNodes`. */
function labNodes<V>(gr: Query<V>): readonly (readonly [number, QueryStep<V>])[] {
  return gr.queryNodes;
}

/** fgl `pre`: the predecessors of a node (with repeats for multiple edges). */
function pre<V>(gr: Query<V>, n: number): number[] {
  return gr.queryEdges.filter(([, n2]) => n2 === n).map(([n1]) => n1);
}

/**
 * Query steps in the model are themselves indexed by UUID. However the inductive graph library
 * indexes things by integers. Hence a function is needed to convert one to the other.
 *
 * A flow from the null UUID represents the query taking an incoming set of UUIDs from its
 * caller, and a flow to the null UUID represents the output flow from the query. The input
 * side becomes node 1 in the graph, and the output becomes node 2.
 */
export function compileQuery<V>(
  ns: readonly (readonly [U.UUID, QueryStep<V>])[],
  es: readonly (readonly [U.UUID, U.UUID])[],
): Query<V> {
  const zs: [number, readonly [U.UUID, QueryStep<V>]][] = ns.map((n, i) => [i + 3, n]);
  const ns1: [number, QueryStep<V>][] = [
    [1, mempty_QueryStep],
    [2, mempty_QueryStep],
    ...zs.map(([n, [, qs]]): [number, QueryStep<V>] => [n, qs]),
  ];
  const tbl = M.fromList(zs.map(([n, [u]]): [U.UUID, number] => [u, n]));
  const edgeLookup = ([u1, u2]: readonly [U.UUID, U.UUID]): Maybe<[number, number, null]> => {
    const n1 = U.isNil(u1) ? Just(1) : M.lookup(u1, tbl);
    if (n1.tag === "Nothing") return Nothing;
    const n2 = U.isNil(u2) ? Just(2) : M.lookup(u2, tbl);
    if (n2.tag === "Nothing") return Nothing;
    return Just([n1.value, n2.value, null]);
  };
  const es1 = mapMaybe(edgeLookup, es);
  return mkGraph(ns1, es1);
}

/** The results of one iteration of a query: the output of each node, and any messages. */
type NodeResults = [M.Map<number, S.Set<ModelId>>, T.Text[]];

/**
 * Execute a query in the context of a model. Returns a set of ModelIds and a list of any warning
 * messages (such as type mismatch errors) generated during the execution.
 *
 * @param query The query to run.
 * @param outers Any entities from outer queries in a report or matrix/.
 * @param model The model to run the query against.
 * @param input The inputs to the query.
 */
export function runQuery<V>(
  query: Query<V>,
  outers: readonly ModelId[],
  model: Model<V>,
  input: S.Set<ModelId>,
): [S.Set<ModelId>, T.Text[]] {
  // Notionally the result is the fixpoint of nodeOuts. However sets evaluate strictly so
  // instead we have to scan for the point where changes stop happening. Also as an optimisation
  // we only inject the input once rather than at every iteration, and then take the union
  // of the output from all iterations. This depends on the no-crosstalk law for QueryStep.

  // Calculate the output for each node given the union of its incoming sets.
  const nodeOuts = (gr: Query<V>, [tbl]: NodeResults): NodeResults => {
    const nodeOut = ([n, qs]: readonly [number, QueryStep<V>]): [number, [S.Set<ModelId>, T.Text[]]] => [
      n,
      qs.runStep(outers, model, S.unions(
        pre(gr, n).map((n1) => M.findWithDefault(S.empty<ModelId>(), n1, tbl)))),
    ];
    const outputs = labNodes(gr).map(nodeOut);
    const results = outputs.map(([n, [r]]): [number, S.Set<ModelId>] => [n, r]);
    const newErrs = outputs.map(([, [, es]]) => es);
    return [M.fromList(results), L.concat(newErrs)];
  };
  // Iterate steps, starting with the input set at node 1, until the node results stop changing.
  // (Haskell: stepList = iterate (nodeOuts query) (IM.singleton 1 input, []);
  //  stepList1 = head stepList : map snd (takeWhile (uncurry (/=)) $ zip stepList $ tail stepList))
  let prev: NodeResults = [M.singleton(1, input), []];
  const stepList1: NodeResults[] = [prev];
  for (;;) {
    const next = nodeOuts(query, prev);
    if (equals(prev, next)) break;
    stepList1.push(next);
    prev = next;
  }
  return [
    S.unions(stepList1.map(([tbl]) => M.findWithDefault(S.empty<ModelId>(), 2, tbl))),
    L.nub(L.concatMap(([, msgs]) => msgs, stepList1)),
  ];
}

/** Convert a query into a query step so that it can be used within another query. */
export function subQuery<V>(q: Query<V>): QueryStep<V> {
  return QueryStep<V>((outers, model, input) => runQuery(q, outers, model, input));
}

/** Follow a set of relations in the model to a new set of entities. */
export function step<V>(_cls: EntityClass<V>, rels: S.Set<Relation>): QueryStep<V> {
  const cartesian = <X, Y>(sx: S.Set<X>, sy: S.Set<Y>): [X, Y][] =>
    S.toList(sx).flatMap((x) => S.toList(sy).map((y): [X, Y] => [x, y]));
  return QueryStep<V>((_outers, model, input) => {
    const nexts = ([uuid, rel]: [ModelId, Relation]): S.Set<ModelId> =>
      NR.relation(uuid, rel, model.modelRelations);
    return [S.unions(cartesian(input, rels).map(nexts)), []];
  });
}

/**
 * Restrict the output to those entities that meet the predicate. Entities that produce
 * error messages will also be blocked.
 */
export function filterStep<V>(
  cls: EntityClass<V>,
  p: (outers: ExtensionValues, e: Entity<V>) => Either<T.Text, boolean>,
): QueryStep<V> {
  const test = (outers: ExtensionValues, model: Model<V>, uuid: ModelId): Either<T.Text, Maybe<ModelId>> => {
    const me = M.lookup(uuid, model.modelContents);
    if (me.tag === "Nothing") {
      return Left("Internal error: UUID " + U.toText(uuid) + " not found in model.");
    }
    const e = me.value;
    const r = p(outers, e);
    if (r.tag === "Left") return Left(view(entityName(cls).dot(nameText), e) + ": " + r.value);
    return r.value ? Right(Just(uuid)) : Right(Nothing);
  };
  return QueryStep<V>((outers, model, inputs) => {
    const outerValues: ExtensionValues = M.unions(
      mapMaybe((uuid: ModelId) => M.lookup(uuid, model.modelContents), outers)
        .map((e) => view(entityVariantProperties(cls, model), e)));
    const [msgs, results] = partitionEithers(S.toList(inputs).map((u) => test(outerValues, model, u)));
    return [S.fromList(catMaybes(results)), msgs];
  });
}

// ---------------------------------------------------------------------------------------------
// * Built in query steps.

/** Move to the parents of the inputs. */
export function parentStep<V>(_cls: EntityClass<V>): QueryStep<V> {
  const p = (m: Model<V>, uuid: ModelId): Maybe<ModelId> => {
    const e = M.lookup(uuid, m.modelContents);
    return e.tag === "Just" ? Just(e.value._entityParent) : Nothing;
  };
  return QueryStep<V>((_outers, model, inputs) =>
    [S.fromList(mapMaybe((u: ModelId) => p(model, u), S.toList(inputs))), []]);
}

/** Move to the children of the inputs. */
export function childrenStep<V>(_cls: EntityClass<V>): QueryStep<V> {
  const c = (m: Model<V>, uuid: ModelId): ModelId[] => {
    const e = M.lookup(uuid, m.modelContents);
    return e.tag === "Just" ? M.elems(e.value._entityChildren) : [];
  };
  return QueryStep<V>((_outers, model, inputs) =>
    [S.fromList(L.concatMap((u: ModelId) => c(model, u), S.toList(inputs))), []]);
}

/** Restrict the output to these variants. */
export function filterVariants<V>(cls: EntityClass<V>, vars: S.Set<Variant<V>>): QueryStep<V> {
  return filterStep(cls, (_, e) => Right(S.member(cls.reflectiveName(e._entityContents), vars)));
}

/**
 * Follow model arrows forwards. To follow them backwards reverse the head and tail connections.
 *
 * If the set of variants includes boxes then this can also move from an arrow backwards
 * across the box to a previous arrow.
 *
 * @param variants The arrow variants to follow.
 * @param rel1 Name of relation for tail connection of arrow.
 * @param rel2 Name of relation for head connection of arrow.
 */
export function followArrows<V>(
  cls: EntityClass<V>,
  variants: S.Set<Variant<V>>,
  rel1: Relation,
  rel2: Relation,
): QueryStep<V> {
  return mconcat_QueryStep([
    step(cls, S.singleton(rel1)),
    filterVariants(cls, variants),
    step(cls, S.singleton(rel2)),
  ]);
}
