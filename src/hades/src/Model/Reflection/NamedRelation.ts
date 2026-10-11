// Ported from hades/src/Model/Reflection/NamedRelation.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Named Relations store named pair-wise associations between items. Internally they are stored
 * as a map of sets of (item, name) pairs. When a new association is inserted between two items the
 * association is inserted twice, once for each direction.
 *
 * This module is intended to be imported qualified
 * (`import * as NR from "@/hades/src/Model/Reflection/NamedRelation"`).
 *
 * TypeScript port
 * ---------------
 * `NamedRelation a` is a newtype with its own JSON instances, so it is represented as the
 * single-constructor type `{ _0: Map a (Set (a, Relation)) }`. As in Haskell the constructor is
 * not exported; use `empty`, `insert`, `fromList` etc. Items are ordered with the generic
 * structural `compare`. `check` (polymorphic in `MonadError Text m`) returns an explicit
 * `Either<Text, null>`, which is what `runExcept . check` gives in Haskell.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing, mapMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { compare } from "@/lib/Data/Ord";

/** Relationships are identified by name. */
export type Relation = string;

/** Standard name for a relationship formed when an arrow tail is connected. */
export const edgeFromRelation: Relation = "Arrow Tail";

/** Standard name for a relationship formed when an arrow head is connected. */
export const edgeToRelation: Relation = "Arrow Head";

/**
 * A NamedRelation stores the existence of named relationships between pairs of entities.
 * Each relationship has a name, so two entities can have more than one relationship between them.
 */
export interface NamedRelation<A> {
  readonly _0: M.Map<A, S.Set<[A, Relation]>>;
}
function NamedRelation<A>(_0: M.Map<A, S.Set<[A, Relation]>>): NamedRelation<A> {
  return { _0 };
}

/**
 * `instance (Ord a, ToJSON a) => ToJSON (NamedRelation a)` and
 * `instance (Ord a, FromJSON a) => FromJSON (NamedRelation a)`.
 *
 * The encoding is that of "toList": an array of `[item, [[item, relation], ...]]` pairs.
 */
export function JSON_NamedRelation<A>(ca: J.JSONCodec<A>): J.JSONCodec<NamedRelation<A>> {
  const entry = J.tuple2J(ca, J.listJ(J.tuple2J(ca, J.textJ)));
  return J.codec(
    (r) => toList(r).map((e) => entry.toJSON(e)),
    (v) => J.withArray("named relations", (arr) => fromList(arr.map((x) => entry.parseJSON(x))), v),
  );
}

/** Empty relation. */
export function empty<A>(): NamedRelation<A> {
  return NamedRelation(M.empty<A, S.Set<[A, Relation]>>());
}

/**
 * Record the association between these entities. If the association already exists
 * then no change is made.
 */
export function insert<A>(v1: A, v2: A, txt: Relation, r: NamedRelation<A>): NamedRelation<A> {
  const addItem = (v1_: A, v2_: A, er: M.Map<A, S.Set<[A, Relation]>>) =>
    M.insertWith(S.union, v1_, S.singleton<[A, Relation]>([v2_, txt]), er);
  return NamedRelation(addItem(v1, v2, addItem(v2, v1, r._0)));
}

/** Delete the association between these entities. No-op if it doesn't exist. */
export function delete_<A>(v1: A, v2: A, txt: Relation, r: NamedRelation<A>): NamedRelation<A> {
  const remove2 = (v: A, s: S.Set<[A, Relation]>): Maybe<S.Set<[A, Relation]>> => {
    const ns = S.delete_<[A, Relation]>([v, txt], s);
    return S.isNull(ns) ? Nothing : Just(ns);
  };
  const remove = (v1_: A, v2_: A, er: M.Map<A, S.Set<[A, Relation]>>) =>
    M.update((s: S.Set<[A, Relation]>) => remove2(v2_, s), v1_, er);
  return NamedRelation(remove(v1, v2, remove(v2, v1, r._0)));
}
export { delete_ as delete };

/** Delete any associations this entity has via this relation. */
export function deleteRelation<A>(v1: A, r: Relation, nr: NamedRelation<A>): NamedRelation<A> {
  return S.foldr((v2: A, acc: NamedRelation<A>) => delete_(v1, v2, r, acc), nr, relation(v1, r, nr));
}

/** Delete all associations involving this entity. No-op if there are none. */
export function deleteAll<A>(v1: A, r: NamedRelation<A>): NamedRelation<A> {
  return S.foldr(
    ([v2, txt]: [A, Relation], acc: NamedRelation<A>) => delete_(v1, v2, txt, acc),
    r,
    relations(v1, r),
  );
}

/** Does the relation contain this association? */
export function member<A>(v1: A, v2: A, txt: Relation, r: NamedRelation<A>): boolean {
  return S.member<[A, Relation]>([v2, txt], relations(v1, r));
}

/** The set of entities that the argument is linked to by the specified relationship. */
export function relation<A>(v: A, r: Relation, nr: NamedRelation<A>): S.Set<A> {
  return S.map(
    (p: [A, Relation]) => p[0],
    S.filter((p: [A, Relation]) => p[1] === r, M.findWithDefault(S.empty<[A, Relation]>(), v, nr._0)),
  );
}

/** The set of all relations that the argument has. */
export function relations<A>(v: A, nr: NamedRelation<A>): S.Set<[A, Relation]> {
  return M.findWithDefault(S.empty<[A, Relation]>(), v, nr._0);
}

/** The union of the relations. */
export function union<A>(r1: NamedRelation<A>, r2: NamedRelation<A>): NamedRelation<A> {
  return NamedRelation(M.unionWith(S.union, r1._0, r2._0));
}

/** The intersection of the relations. */
export function intersection<A>(r1: NamedRelation<A>, r2: NamedRelation<A>): NamedRelation<A> {
  return NamedRelation(clean(M.intersectionWith(S.intersection, r1._0, r2._0)));
}

/**
 * Verify that the NamedRelation is properly symmetric, so for every relation @a -> (b, name)@
 * there is an equivalent relation @b ->(a, name)@. Throws an error giving some clue if a
 * problem is found.
 *
 * The Haskell version is polymorphic in `MonadError Text m`; here the error is returned as
 * `Left` (as `runExcept` would give). The optional `show` argument stands in for the `Show a`
 * instance; it defaults to `String`, which matches `show` for `UUID` (`ModelId`).
 */
export function check<A>(r: NamedRelation<A>, show: (a: A) => string = String): Either<string, null> {
  const prs: [A, A, Relation][] = toList(r).flatMap(([v1, rs]) =>
    rs.map(([v2, txt]) => [v1, v2, txt] as [A, A, Relation]));
  const checkPair = ([v1, v2, txt]: [A, A, Relation]): Maybe<string> =>
    member(v2, v1, txt, r)
      ? Nothing
      : Just(show(v1) + " >-" + txt + "->" + show(v2) + " has no converse.");
  const results = mapMaybe(checkPair, prs);
  return results.length === 0 ? Right(null) : Left(results.join("\n"));
}

/** Internal utility to remove any empty sets. */
function clean<A>(m: M.Map<A, S.Set<[A, Relation]>>): M.Map<A, S.Set<[A, Relation]>> {
  return M.filter((s: S.Set<[A, Relation]>) => !S.isNull(s), m);
}

/** Convert the structure to a compact list. Symmetric relations are not included. */
export function toList<A>(r: NamedRelation<A>): [A, [A, Relation][]][] {
  return M.toList(M.mapWithKey(
    (k: A, s: S.Set<[A, Relation]>) => S.toList(s).filter((p) => compare(p[0], k) >= 0),
    r._0,
  ));
}

/** Convert a list into a "NamedRelation". Convers of "toList". */
export function fromList<A>(inputs: readonly (readonly [A, readonly (readonly [A, Relation])[]])[]): NamedRelation<A> {
  const prs: [A, A, Relation][] = inputs.flatMap(([v1, rs]) =>
    rs.map(([v2, txt]) => [v1, v2, txt] as [A, A, Relation]));
  // foldr: the last pair is inserted first.
  let acc = empty<A>();
  for (let i = prs.length - 1; i >= 0; i--) {
    const [v1, v2, txt] = prs[i];
    acc = insert(v1, v2, txt, acc);
  }
  return acc;
}

/** Change all instances of the first relation to the second. */
export function renameRelation<A>(oldRel: Relation, newRel: Relation, nr: NamedRelation<A>): NamedRelation<A> {
  const changeName2 = ([v2, nm]: [A, Relation]): [A, Relation] => (nm === oldRel ? [v2, newRel] : [v2, nm]);
  const changeName = ([v1, rels]: [A, [A, Relation][]]): [A, [A, Relation][]] => [v1, rels.map(changeName2)];
  return fromList(toList(nr).map(changeName));
}

