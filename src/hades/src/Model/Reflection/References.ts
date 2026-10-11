// Ported from hades/src/Model/Reflection/References.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * References are associations between entities. A reference is not the same as an arrow. An
 * arrow is an entity just like a box. Instead an arrow has potentially two references; one to the
 * box it comes from, and the box it goes to.
 *
 * References are bidirectional: if entity Foo has a reference to Bar then Bar will also have
 * a reference to Foo.
 *
 * References are typed by the entity types that they can relate, and the multiplicity of those
 * relationships.
 *
 * TypeScript port
 * ---------------
 * `RefType a` is a record. `RefTypeTable a` is a newtype with its own `Semigroup` instance, so it
 * is the single-constructor type `{ _0: Map Relation (RefType a) }` (pattern match on `_0`).
 * `Semigroup`/`Monoid` are `append_RefType`/`mempty_RefType` and
 * `append_RefTypeTable`/`mempty_RefTypeTable`. The phantom parameter `a` only appears inside
 * `Variant a`, which is erased to `string`.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import { iso, lens, view, type Iso, type Lens } from "@/lib/Control/Lens";
import { type Relation } from "./NamedRelation";
import * as NR from "./NamedRelation";
import { JSON_Variant, Variant, variantName } from "./Values";

/**
 * A basic reference type has two sides. Each side is a set of variant names which can be
 * on one side of the reference, and a flag. If the flag is True then the reference can only
 * be instantiated with any given value on this side once. For instance, an arrow can only
 * point to one entity at a time, so the corresponding relationship for arrow type \"MyArrow\" that
 * can point to box type \"MyBox\" would look like this:
 *
 * ```haskell
 * RefType
 *    [(S.singleton "MyArrow", S.singleton "MyBox")]
 *    (False, True)
 * ```
 *
 * This shows that, given a @MyArrow@ entity, the other side of the relationship can only have zero
 * or one @MyBox@. However given a @MyBox@ entity there might be several @MyArrow@ entities
 * that point to it.
 *
 * It is prohibited for the same variant to appear on both sides of a one-many relationship.
 * If it did then it would have a one-many relationship with some variants and a many-one
 * relationship with others.
 *
 * The monoid instance isn't really safe. It merges the single flags using @(&&)@, so if they
 * conflict then inconsistencies will arise, and it can't defend against variants being introduced
 * on both sides of a one-many relationship. However as long as you use it for merging arrow heads
 * and tails this won't be a problem.
 */
export interface RefType<A> {
  readonly _refTypeSets: readonly (readonly [S.Set<Variant<A>>, S.Set<Variant<A>>])[];
  readonly _refTypeSingles: readonly [boolean, boolean];
}
export function RefType<A>(
  _refTypeSets: readonly (readonly [S.Set<Variant<A>>, S.Set<Variant<A>>])[],
  _refTypeSingles: readonly [boolean, boolean],
): RefType<A> {
  return { _refTypeSets, _refTypeSingles };
}

const variantSetJ: J.JSONCodec<S.Set<Variant<any>>> = J.setJ(JSON_Variant);
const refTypeSetsJ = J.listJ(J.tuple2J(variantSetJ, variantSetJ));
const singlesJ = J.tuple2J(J.boolJ, J.boolJ);

/** `instance ToJSON (RefType a)` and `instance FromJSON (RefType a)` */
export const JSON_RefType: J.JSONCodec<RefType<any>> = J.codec(
  (t) => J.object([
    ["sets", refTypeSetsJ.toJSON(t._refTypeSets as [S.Set<Variant<any>>, S.Set<Variant<any>>][])],
    ["singles", singlesJ.toJSON(t._refTypeSingles as [boolean, boolean])],
  ]),
  (v) => J.withObject("RefType definition", (o) =>
    RefType<any>(J.field(o, "sets", refTypeSetsJ), J.field(o, "singles", singlesJ)), v),
);

/** `instance Semigroup (RefType a)` */
export function append_RefType<A>(t1: RefType<A>, t2: RefType<A>): RefType<A> {
  const [s1a, s1b] = t1._refTypeSingles;
  const [s2a, s2b] = t2._refTypeSingles;
  return RefType([...t1._refTypeSets, ...t2._refTypeSets], [s1a && s2a, s1b && s2b]);
}

/** `instance Monoid (RefType a)` */
export const mempty_RefType: RefType<any> = RefType<any>([], [true, true]);

export function refTypeSets<A = any, B = A>(): Lens<
  RefType<A>,
  readonly (readonly [S.Set<Variant<A>>, S.Set<Variant<A>>])[],
  RefType<B>,
  readonly (readonly [S.Set<Variant<B>>, S.Set<Variant<B>>])[]
> {
  return lens(
    (t: RefType<A>) => t._refTypeSets,
    (t: RefType<A>, v: readonly (readonly [S.Set<Variant<B>>, S.Set<Variant<B>>])[]): RefType<B> =>
      ({ ...t, _refTypeSets: v }),
  );
}

export function refTypeSingles<A = any>(): Lens<RefType<A>, readonly [boolean, boolean]> {
  return lens(
    (t: RefType<A>) => t._refTypeSingles,
    (t: RefType<A>, v: readonly [boolean, boolean]) => ({ ...t, _refTypeSingles: v }),
  );
}

/** Reverses the A and B sides of the type. */
export function refTypeReverse<A>(t: RefType<A>): RefType<A> {
  const revPair = <X>([a, b]: readonly [X, X]): [X, X] => [b, a];
  return RefType(t._refTypeSets.map(revPair), revPair(t._refTypeSingles));
}

/**
 * The type parameter for "RefType" is actually a phantom. Hence it can be changed
 * without a function mapping one to another.
 */
export function refTypeCoerce<A, B>(t: RefType<A>): RefType<B> {
  const f = (s: S.Set<Variant<A>>): S.Set<Variant<B>> =>
    S.map((v: Variant<A>) => Variant<B>(view(variantName<A>(), v)), s);
  return RefType<B>(t._refTypeSets.map(([a, b]) => [f(a), f(b)] as const), t._refTypeSingles);
}

/**
 * Given a entity type name and a reference type, this returns the entity names that
 * can be linked by a reference, and a flag for the cardinality. @True@ indicates that
 * this variant can only be linked to a single instance of the returned variants.
 */
export function refTypeOtherSide<A>(v: Variant<A>, t: RefType<A>): [boolean, S.Set<Variant<A>>] {
  const merge = (
    [a, setA]: readonly [boolean, S.Set<Variant<A>>],
    [b, setB]: readonly [boolean, S.Set<Variant<A>>],
  ): [boolean, S.Set<Variant<A>>] => {
    if (a !== b && S.isNull(setA)) return [b, setB];
    if (a !== b && S.isNull(setB)) return [a, setA];
    if (a === b) return [a, S.union(setA, setB)];
    // Should never happen, but if it does then take the A->B direction and ignore B->A.
    return [b, setB];
  };
  const [singleA, singleB] = t._refTypeSingles;
  const f = (
    [setA, setB]: readonly [S.Set<Variant<A>>, S.Set<Variant<A>>],
    accum: S.Set<Variant<A>>,
  ): S.Set<Variant<A>> => (S.member(v, setA) ? S.union(setB, accum) : accum);
  const foldrSets = (prs: readonly (readonly [S.Set<Variant<A>>, S.Set<Variant<A>>])[]) =>
    prs.reduceRight((acc: S.Set<Variant<A>>, p) => f(p, acc), S.empty<Variant<A>>());
  const sideA: [boolean, S.Set<Variant<A>>] = [singleA, foldrSets(refTypeReverse(t)._refTypeSets)];
  const sideB: [boolean, S.Set<Variant<A>>] = [singleB, foldrSets(t._refTypeSets)];
  return merge(sideA, sideB);
}

/** Reference types have the namespace of Named References. */
export interface RefTypeTable<A> {
  readonly _0: M.Map<Relation, RefType<A>>;
}
export function RefTypeTable<A>(_0: M.Map<Relation, RefType<A>>): RefTypeTable<A> {
  return { _0 };
}

const refTypeMapJ: J.JSONCodec<M.Map<Relation, RefType<any>>> = J.mapJ(J.textKey, JSON_RefType);

/** `instance ToJSON (RefTypeTable a)` and `instance FromJSON (RefTypeTable a)` */
export const JSON_RefTypeTable: J.JSONCodec<RefTypeTable<any>> = J.codec(
  (t) => refTypeMapJ.toJSON(t._0),
  (v) => RefTypeTable<any>(refTypeMapJ.parseJSON(v)),
);

/** `instance Semigroup (RefTypeTable a)` */
export function append_RefTypeTable<A>(t1: RefTypeTable<A>, t2: RefTypeTable<A>): RefTypeTable<A> {
  return RefTypeTable(M.unionWith(append_RefType, t1._0, t2._0));
}

/** `instance Monoid (RefTypeTable a)` */
export const mempty_RefTypeTable: RefTypeTable<any> = RefTypeTable<any>(M.empty());

/** Change the type of a RefTypeTable. */
export function refTypeTableCoerce<A, B>(t: RefTypeTable<A>): RefTypeTable<B> {
  return RefTypeTable(M.map((r: RefType<A>) => refTypeCoerce<A, B>(r), t._0));
}

export function refTypeTableToList<A>(t: RefTypeTable<A>): [Relation, RefType<A>][] {
  return M.toList(t._0);
}

export function refTypeTableFromList<A>(xs: readonly (readonly [Relation, RefType<A>])[]): RefTypeTable<A> {
  return RefTypeTable(M.fromList(xs));
}

export function refTypeTableContents<A = any>(): Iso<RefTypeTable<A>, readonly (readonly [Relation, RefType<A>])[]> {
  return iso(
    (t: RefTypeTable<A>) => refTypeTableToList(t),
    (xs: readonly (readonly [Relation, RefType<A>])[]) => refTypeTableFromList(xs),
  );
}

/** Create a reference type which is constrained to be 1 to 1. */
export function mkOneToOne<A>(rel: Relation, v1: readonly Variant<A>[], v2: readonly Variant<A>[]): RefTypeTable<A> {
  return RefTypeTable(M.singleton(rel, RefType<A>([[S.fromList(v1), S.fromList(v2)]], [true, true])));
}

/** Create a reference type which is constrained to be 1 to many. */
export function mkOneToMany<A>(rel: Relation, v1: readonly Variant<A>[], v2: readonly Variant<A>[]): RefTypeTable<A> {
  return RefTypeTable(M.singleton(rel, RefType<A>([[S.fromList(v1), S.fromList(v2)]], [true, false])));
}

export function mkManyToMany<A>(rel: Relation, v1: readonly Variant<A>[], v2: readonly Variant<A>[]): RefTypeTable<A> {
  return RefTypeTable(M.singleton(rel, RefType<A>([[S.fromList(v1), S.fromList(v2)]], [false, false])));
}

/** Construct a RefTypeTable for an arrow variant. */
export function arrowRelations<A>(
  /** The arrow variant. */
  arrVariant: Variant<A>,
  /** The list of things the tail can connect to. */
  tailList: readonly Variant<A>[],
  /** The list of things the head can connect to. */
  headList: readonly Variant<A>[],
): RefTypeTable<A> {
  return append_RefTypeTable(
    mkOneToMany(NR.edgeFromRelation, tailList, [arrVariant]),
    mkOneToMany(NR.edgeToRelation, headList, [arrVariant]),
  );
}
