// Ported from hades/src/Model/Abstract/PackageTree.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The abstract @Model@ uses "ModelId"s as references. Each entity in the model has a @ModelId@ by
 * which it can be accessed. Entities are organised into a tree. A built-in entity type called
 * @Package@ is normally used at the nodes, but other entities can have children too.
 *
 * This structure provides a hybrid of functional and OO approaches. On the one hand the model is
 * persistent, while on the other hand a @ModelId@ acts like a pointer to an entity within the model.
 * Of course this means that the model is victim to all the usual vices of OO programming; stale
 * references and memory leaks are both possible. The package tree is stored purely in terms of
 * references, although it is possible to extract it as a "Tree" for easier traversal. Hence the
 * model structure can become inconsistent in several ways. In theory the interface provided here
 * should be \"safe\" in that it can't be used to create an inconsistent model. The "checkModel"
 * function can be used
 * to verify that the model is still consistent. If an inconsistency is detected at any point
 * then an "InternalError" will be returned.
 *
 * TypeScript port
 * ---------------
 * * `Name` is a class (`NameClass`, built with the constructor function `Name(txt)`, text in
 *   `_0`) implementing `[EqSym]`/`[OrdSym]` with "naturalOrder", so maps keyed by `Name`
 *   (`entityChildren`, `modelRoot`) use the Haskell ordering with the generic `compare`.
 *   `nameText` is the Iso, `JSON_Name` the codec (parsing strips white space) and `JSONKey_Name`
 *   the key codec (`J.mapJ(JSONKey_Name, J.uuidJ)` is the codec of `Map Name ModelId`).
 * * `thisChange` (an `unsafePerformIO` constant in Haskell) is the function `thisChange(): Stamp`.
 * * `EntityClass a` is the dictionary interface `EntityClass<A, PM>`, where `PM` stands for the
 *   associated type `PackageMeta a` (defaulting to `any`). The superclass constraints
 *   `ToJSON (PackageMeta a)`, `FromJSON (PackageMeta a)` and `Monoid (PackageMeta a)` become the
 *   members `packageMetaJ`, `packageMetaMempty` and `packageMetaAppend`. The `FromJSON a` /
 *   `ToJSON a` constraints that the JSON instances of `Entity` and `Model` need are the member
 *   `entityJ`. `Eq a` and `Eq (PackageMeta a)` are the structural `equals` of `@/lib/Data/Ord`
 *   (types with a custom equality implement `[EqSym]`).
 * * `ModelEdit v w a` is `ModelEdit<V, W, A> = (ctx: ModelEditCtx<V, W>) => A`. The context
 *   holds the dictionary (`ctx.cls`), the `Traversal' v w` (`ctx.prsm`) and a shared mutable
 *   cell with the `ModelEditState` (`ctx.cell`; `ctx.state` reads and writes it). Every
 *   Haskell function returning `ModelEdit v w a` is a direct-style function taking the context
 *   first: `goToEntity(ctx, uuid)`, `current(ctx)`, `addEntity(ctx, f)`, `delete_(ctx)`.
 *   Arguments of type `x -> ModelEdit v w a` are functions `(ctx, x) => A`; arguments of type
 *   `ModelEdit v w a` are action functions `(ctx) => A` (e.g. `fromHere(ctx, (c) => ...)`).
 * * Errors (`throwError`, `throwUser`, `throwInternal`) throw a `ModelErrorException` wrapping
 *   the `ModelError`. Because the Haskell state is a pure value, any catching combinator
 *   (`try_`, `catchError`) restores `ctx.state` to its value when the protected action started.
 *   `runModelEdit`, `execModelEdit` and `evalModelEdit` catch the exception and return `Either`
 *   as in Haskell. They (and `queryModel`) take the `EntityClass` dictionary first, because the
 *   context they create needs it.
 * * `withSubtype(ctx, prsm, act)`, `withBaseType(ctx, act)` and `usingTraversal(ctx, f)` run
 *   their action with a context sharing the same cell (`withSubtypeCtx`/`withBaseTypeCtx` build
 *   such contexts directly).
 * * Pure functions with an `EntityClass` constraint take the dictionary first
 *   (`entityName(cls)`, `entityProperties(cls)`, `emptyModel(cls, name)`, `JSON_Model(cls)`).
 *   `packageName` and `packageMeta` accept the (unused) dictionary as an optional argument.
 * * `ModelEditState`, `Model`, `Entity` and `Package` are readonly records. Haskell does not
 *   export the `Model` and `Entity` constructors; their TypeScript constructor functions are
 *   exported anyway (use them with care: the model invariants are not checked).
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as B from "@/lib/Reactive/Banana";
import { Just, Nothing, fromJust, fromMaybe, isJust, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { EqSym, OrdSym, compare, equals, type Ordering } from "@/lib/Data/Ord";
import { today, type Day } from "@/lib/Data/Time";
import { Node, drawForest, flatten, fmapTree, type Forest, type Tree } from "@/lib/Data/Tree";
import { absurd } from "@/lib/Prelude";
import {
  at, identity, iso, ix, lens, over, preview, previewOrThrow, review, set, to, view,
  type Iso, type Lens, type Prism, type StateCell, type Traversal,
} from "@/lib/Control/Lens";
import { Generator as UUIDGenerator, generateUUID, newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { type Reflective, defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import type { NamedRelation } from "@/hades/src/Model/Reflection/NamedRelation";
import type { FunctionTable } from "@/hades/src/Model/Reflection/Parser";
import {
  type RefTypeTable, JSON_RefTypeTable, append_RefTypeTable, mempty_RefTypeTable, refTypeOtherSide,
} from "@/hades/src/Model/Reflection/References";
import {
  BuiltInDef, Field, JSON_Field, JSON_Multiplicity, JSON_TypeDef, builtInFields, fieldsByName, migrateField,
  type FieldId, type FieldTable, type Multiplicity, type TypeDef,
} from "@/hades/src/Model/Reflection/Types";
import {
  ExtDate, ExtText, JSON_ExtValue, JSON_ExtensionValues, JSONKey_Variant, Variant, _ExtText, valueSearch,
  variantName, type ExtensionValues, type ExtValue,
} from "@/hades/src/Model/Reflection/Values";
import { getUserName } from "@/hades/src/System/Hades/DataFiles";
import { naturalOrder } from "@/hades/src/Text/NaturalOrder";

// ---------------------------------------------------------------------
// Model Structure
// ---------------------------------------------------------------------

/** An entity within the model. */
export type ModelId = U.UUID;

/**
 * Wrapper for text fields to be compared using natural order sort.
 * Note that @Name \"Foo\" == Name \"foo\"@
 *
 * (TypeScript: build values with the constructor function `Name(txt)`; the text is `_0`.
 * "naturalOrder" falls back to a code point comparison when the natural order chunks are equal,
 * so in practice the two names in the note above are different.)
 */
export class NameClass {
  constructor(readonly _0: string) {}

  /** `instance Eq Name` */
  [EqSym](other: unknown): boolean {
    return other instanceof NameClass && naturalOrder(this._0, other._0) === 0;
  }

  /** `instance Ord Name` */
  [OrdSym](other: unknown): Ordering {
    return naturalOrder(this._0, (other as NameClass)._0);
  }

  /** Derived `Show`: `Name "txt"`. */
  toString(): string {
    return show_Name(this);
  }
}

/** Wrapper for text fields to be compared using natural order sort. */
export type Name = NameClass;

/** The `Name` constructor. */
export function Name(txt: string): Name {
  return new NameClass(txt);
}

/** The underlying text of a Name. */
export const nameText: Iso<Name, string> = iso((n: Name) => n._0, (txt: string) => Name(txt));

/** `instance Eq Name` */
export function eq_Name(x: Name, y: Name): boolean {
  return naturalOrder(x._0, y._0) === 0;
}

/** `instance Ord Name` */
export function compare_Name(x: Name, y: Name): Ordering {
  return naturalOrder(x._0, y._0);
}

/** Derived `instance Show Name`. (The derived `Read` instance is not used and not ported.) */
export function show_Name(n: Name): string {
  return "Name " + T.showText(n._0);
}

/** `instance ToJSON Name` and `instance FromJSON Name` (which strips white space). */
export const JSON_Name: J.JSONCodec<Name> = J.codec(
  (n) => J.textJ.toJSON(n._0),
  (v) => J.withText("name", (txt) => Name(T.strip(txt)), v),
);

/**
 * `instance ToJSONKey Name` and `instance FromJSONKey Name` (which strips white space).
 *
 * The comparator is the generic `compare`, which orders names with their `[OrdSym]` method
 * (i.e. "compare_Name"); using the same function as `M.empty()` keeps parsed maps and maps
 * built in code identical.
 */
export const JSONKey_Name: J.JSONKey<Name> = {
  toKey: (n) => view(nameText, n),
  fromKey: (s) => Name(T.strip(s)),
  cmp: compare,
};

/** JSON codec for `Map Name ModelId`: an object keyed by the names. */
const nameMapJ: J.JSONCodec<M.Map<Name, ModelId>> = J.mapJ(JSONKey_Name, J.uuidJ);

/** The user name and date. */
export type Stamp = readonly [string, Day];

/** JSON codec for a "Stamp" (a pair). */
const stampJ: J.JSONCodec<Stamp> = J.tuple2J(J.textJ, J.dayJ);

/**
 * Every entity in a model has a mutable name, is reflective, and may have children.
 *
 * Law: "reflectiveBuiltIn" must contain "nameField".
 *
 * TypeScript: `PM` is the associated type `PackageMeta a`. The last four members stand in for
 * the constraints `ToJSON a`, `FromJSON a` (needed by the JSON instances of "Entity" and
 * "Model"), `ToJSON (PackageMeta a)`, `FromJSON (PackageMeta a)` and `Monoid (PackageMeta a)`.
 * `Eq a` and `Eq (PackageMeta a)` are structural equality (`equals`).
 */
export interface EntityClass<A, PM = any> extends Reflective<A> {
  /** The name of this entity. */
  readonly name: Lens<A, Name>;
  /** Cast this entity to and from package, if it is one. */
  readonly _Package: Prism<A, Package<A, PM>>;
  /**
   * True if the first argument can have the second argument as a child.
   * This should not depend on variable attributes of entities in a model.
   */
  entityCanHaveChild(parent: A, child: A): boolean;
  /** True if this entity can be moved somewhere else in the tree. */
  entityCanMove(a: A): boolean;
  /** Entities exported by this entity. (A `ModelEdit a a [Entity a]`.) */
  entityExports(ctx: ModelEditCtx<A, A>, e: Entity<A>): Entity<A>[];
  /**
   * Clone of the entity, giving it the new name, if possible. The clone should be inserted as a
   * child of the current location with a new name, and the new entity returned.
   */
  entityClone(e: Entity<A>, newName: Name): Maybe<ModelEdit<A, A, Entity<A>>>;
  /** Formula functions for entities in models. */
  readonly entityFunctions: FunctionTable<Model<A>>;
  /** TypeScript: the `ToJSON a` and `FromJSON a` instances of the entity type itself. */
  readonly entityJ: J.JSONCodec<A>;
  /** TypeScript: the `ToJSON (PackageMeta a)` and `FromJSON (PackageMeta a)` instances. */
  readonly packageMetaJ: J.JSONCodec<PM>;
  /** TypeScript: `mempty` of the `Monoid (PackageMeta a)` instance. */
  readonly packageMetaMempty: PM;
  /** TypeScript: `(<>)` of the `Semigroup (PackageMeta a)` instance. */
  packageMetaAppend(m1: PM, m2: PM): PM;
}

/** Constant text for the reflective \"Name\" field. Every entity should have this. */
export const nameField: FieldId =
  previewOrThrow(ix<string, Field>("Name").dot(to((f: Field) => f.fieldId)), fieldsByName(builtInFields));
  // Safe because its a constant.

/**
 * Constant text for the reflective \"Description\" field. If an entity has a descriptive text
 * field then this should be the name.
 */
export const descriptionField: FieldId =
  previewOrThrow(ix<string, Field>("Description").dot(to((f: Field) => f.fieldId)), fieldsByName(builtInFields));

/**
 * The stamp to be applied to model changes. The date is
 * current date in the current timezone treated as a pure value.
 *
 * Under the hood this uses the infamous @unsafePerformIO@. It is also agressively inlined so
 * it *should* stay up to date even if the program is run past midnight, rather than being
 * considered a global constant that only gets computed once.
 *
 * (TypeScript: a function, evaluated afresh at every use.)
 */
export function thisChange(): Stamp {
  return [T.pack(getUserName()), today()];
}

/**
 * The simplest type that can be put in a model. It carries a name and some metadata,
 * and can have anything as a child.
 *
 * (`PM` is `PackageMeta a`.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface Package<A, PM = any> {
  readonly _packageName: Name;
  readonly _packageMeta: PM;
}
export function Package<A = any, PM = any>(_packageName: Name, _packageMeta: PM): Package<A, PM> {
  return { _packageName, _packageMeta };
}

/** `instance (EntityClass a) => Eq (Package a)` */
export function eq_Package<A, PM>(p1: Package<A, PM>, p2: Package<A, PM>): boolean {
  return eq_Name(p1._packageName, p2._packageName) && equals(p1._packageMeta, p2._packageMeta);
}

/** `instance (EntityClass a) => ToJSON (Package a)` and `instance (EntityClass a) => FromJSON (Package a)` */
export function JSON_Package<A, PM = any>(cls: EntityClass<A, PM>): J.JSONCodec<Package<A, PM>> {
  return J.codec(
    (p) => J.object([
      ["type", "package"],
      ["name", JSON_Name.toJSON(p._packageName)],
      ["meta", cls.packageMetaJ.toJSON(p._packageMeta)],
    ]),
    (val) => J.withObject("Package", (v) => {
      const t = J.field(v, "type", J.textJ);
      if (t !== "package") J.fail(t + " is not a package.");
      return Package<A, PM>(
        J.field(v, "name", JSON_Name),
        J.fieldDefault(v, "meta", cls.packageMetaJ, cls.packageMetaMempty),
      );
    }, val),
  );
}

/** `instance (EntityClass a) => Reflective (Package a)` */
export const Reflective_Package = <A, PM = any>(cls: EntityClass<A, PM>): Reflective<Package<A, PM>> => ({
  reflectiveName: (_p) => Variant("Package"),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Package<A, PM>(Name(""), cls.packageMetaMempty)],
  reflectiveBuiltIn: (_p) => [nameField],
  reflectiveGet: (p) => M.singleton(nameField, ExtText(view(packageName<A, PM>().dot(nameText), p))),
  reflectiveSet: (st, p) => {
    const nm = Name(extract(st, view(packageName<A, PM>().dot(nameText), p), _ExtText, nameField));
    return set(packageName<A, PM>(), nm, p);
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
});

/** The name of a package. (The dictionary argument stands for the unused Haskell constraint.) */
export function packageName<A = any, PM = any>(_cls?: EntityClass<A, PM>): Lens<Package<A, PM>, Name> {
  return lens((s: Package<A, PM>) => s._packageName, (s, nm: Name) => ({ ...s, _packageName: nm }));
}

/**
 * The metadata of a package (a type-changing lens). The dictionary arguments stand for the
 * unused Haskell constraints.
 */
export function packageMeta<A = any, B = A, PMA = any, PMB = PMA>(
  _clsA?: EntityClass<A, PMA>,
  _clsB?: EntityClass<B, PMB>,
): Lens<Package<A, PMA>, PMA, Package<B, PMB>, PMB> {
  return lens(
    (s: Package<A, PMA>) => s._packageMeta,
    (s, m: PMB): Package<B, PMB> => ({ _packageName: s._packageName, _packageMeta: m }),
  );
}

/**
 * Entity stored in the model. The Id and Created fields are functions because they are not
 * changed during the life of the entity. Everything else is a lens.
 */
export interface Entity<V> {
  readonly entityId: ModelId;
  /** Nil if the parent is the root. */
  readonly _entityParent: ModelId;
  /** Models consist of nested entities indexed by name. */
  readonly _entityChildren: M.Map<Name, ModelId>;
  readonly _entityContents: V;
  /** Excluding values built in to @v@. */
  readonly _entityExtensions: ExtensionValues;
  /** Date the entity was created and who did it. */
  readonly entityCreated: Stamp;
  readonly _entityModified: Stamp;
}

/** The `Entity` constructor (not exported by the Haskell module). */
export function Entity<V>(
  entityId: ModelId,
  _entityParent: ModelId,
  _entityChildren: M.Map<Name, ModelId>,
  _entityContents: V,
  _entityExtensions: ExtensionValues,
  entityCreated: Stamp,
  _entityModified: Stamp,
): Entity<V> {
  return {
    entityId, _entityParent, _entityChildren, _entityContents, _entityExtensions, entityCreated, _entityModified,
  };
}

/**
 * Derived `instance (Show v) => Show (Entity v)`, given the `show` for @v@. (Approximate: maps
 * and extension values are shown with their TypeScript `toString`.)
 */
export function show_Entity<V>(showV: (v: V) => string, e: Entity<V>): string {
  const showStamp = ([u, d]: Stamp) => "(" + T.showText(u) + "," + d + ")";
  const children = "fromList [" + M.toList(e._entityChildren)
    .map(([k, u]) => "(" + show_Name(k) + "," + U.toText(u) + ")").join(",") + "]";
  return "Entity {entityId = " + U.toText(e.entityId) +
    ", _entityParent = " + U.toText(e._entityParent) +
    ", _entityChildren = " + children +
    ", _entityContents = " + showV(e._entityContents) +
    ", _entityExtensions = " + String(e._entityExtensions) +
    ", entityCreated = " + showStamp(e.entityCreated) +
    ", _entityModified = " + showStamp(e._entityModified) + "}";
}

/** `instance Functor Entity` */
export function fmap_Entity<V1, V2>(f: (v: V1) => V2, e: Entity<V1>): Entity<V2> {
  return over(entityContents<V1, V2>(), f, e);
}

/** `instance (ToJSON v) => ToJSON (Entity v)` */
export function ToJSON_Entity<V>(cv: J.ToJSON<V>): J.ToJSON<Entity<V>> {
  return {
    toJSON: (e: Entity<V>): J.Value => J.object([
      ["identity", J.uuidJ.toJSON(e.entityId)],
      ["parent", J.uuidJ.toJSON(e._entityParent)],
      ["children", nameMapJ.toJSON(e._entityChildren)],
      ["contents", cv.toJSON(e._entityContents)],
      ["extensions", JSON_ExtensionValues.toJSON(e._entityExtensions)],
      ["created", stampJ.toJSON(e.entityCreated)],
      ["modified", stampJ.toJSON(e._entityModified)],
    ]),
  };
}
/*
Old V0.5 code kept for reference. Packages were not first-class and extensions were the
the responsibility of each item.

  toJSON (Entity ident parent contents) =
    object $ ["identity" .= ident, "parent" .= parent] ++ case contents of
      EntityPackage n es -> ["name" .= n, "package" .= M.mapKeys (^. nameText) es ]
      EntityItem v -> ["item" .= v]
*/

/**
 * `instance (EntityClass v, FromJSON v) => FromJSON (Entity v)`, together with the `ToJSON`
 * instance. The codec of @v@ is `cls.entityJ`.
 */
export function JSON_Entity<V>(cls: EntityClass<V>): J.JSONCodec<Entity<V>> {
  const cv = cls.entityJ;
  // `v .:? k .!= thisChange`, evaluating "thisChange" only when it is needed.
  const fromMaybeStamp = (m: Maybe<Stamp>): Stamp => (m.tag === "Just" ? m.value : thisChange());
  const parseExtVals = (v: J.JSONObject, nm: string): ExtensionValues =>
    J.alt<ExtensionValues>(
      () => J.field(v, nm, JSON_ExtensionValues),
      () => M.mapKeys(migrateField, J.field(v, nm, J.mapJ(J.textKey, JSON_ExtValue))),
    )(v);
  const parseV06 = (v: J.JSONObject): Entity<V> => Entity<V>(
    J.field(v, "identity", J.uuidJ),
    J.field(v, "parent", J.uuidJ),
    J.field(v, "children", nameMapJ),
    J.field(v, "contents", cv),
    parseExtVals(v, "extensions"),
    fromMaybeStamp(J.fieldMaybe(v, "created", stampJ)),
    fromMaybeStamp(J.fieldMaybe(v, "modified", stampJ)),  // For legacy files, timestamp is now.
  );
  const parseV05 = (v: J.JSONObject): Entity<V> => {
    const pkg = J.fieldMaybe(v, "package", J.mapJ(J.textKey, J.uuidJ));
    if (pkg.tag === "Nothing") {
      // Non-package item
      const item = J.field(v, "item", (x) => J.withObject("Object", (o) => o, x));
        // JSON object which may contain an "extensions" field.
      return Entity<V>(
        J.field(v, "identity", J.uuidJ),
        J.field(v, "parent", J.uuidJ),
        M.empty(),  // No children in V0.5 except in parents.
        J.field(v, "item", cv),
        M.mapKeys(migrateField, J.fieldDefault(item, "extensions", J.mapJ(J.textKey, JSON_ExtValue), M.empty())),
        thisChange(),   // No creation or modified stamps in V0.5.
        thisChange(),
      );
    } else {
      // Package item
      const children1 = pkg.value;
      return Entity<V>(
        J.field(v, "identity", J.uuidJ),
        J.field(v, "parent", J.uuidJ),
        M.mapKeys((k: string) => Name(k), children1),
        review(cls._Package, Package<V>(Name(J.field(v, "name", J.textJ)), cls.packageMetaMempty)),
        M.empty(),
        thisChange(),
        thisChange(),
      );
    }
    /* Old V 0.5 code kept for reference.

      Entity <$> v .: "identity" <*> v .: "parent" <*> (
        (EntityPackage <$> v .: "name" <*> (M.mapKeys Name <$> v .: "package"))
        <|> (EntityItem <$> v .: "item")
      )
    */
  };
  return {
    toJSON: ToJSON_Entity(cv).toJSON,
    parseJSON: (val) => J.withObject("Entity", (v) =>
      Object.prototype.hasOwnProperty.call(v, "contents")
        ? parseV06(v)
        : parseV05(v),  // Also parses old-style version 0.5 model entities.
    val),
  };
}

/** Each Entity has a name. This is the last component in its pathname. */
export function entityName<V = any>(cls: EntityClass<V>): Lens<Entity<V>, Name> {
  return entityContents<V>().dot(cls.name);
}

/** Each Entity has a parent. This is the "null" ModelID if the parent is the root. */
export function entityParent<V = any>(): Lens<Entity<V>, ModelId> {
  return lens((s: Entity<V>) => s._entityParent, (s, p: ModelId) => ({ ...s, _entityParent: p }));
}

/**
 * Each entity has zero or more children. The model semantics may impose limits on which
 * entities can have children.
 */
export function entityChildren<V = any>(): Lens<Entity<V>, M.Map<Name, ModelId>> {
  return lens((s: Entity<V>) => s._entityChildren, (s, c: M.Map<Name, ModelId>) => ({ ...s, _entityChildren: c }));
}

/** The model value stored in this entity. */
export function entityContents<V1 = any, V2 = V1>(): Lens<Entity<V1>, V1, Entity<V2>, V2> {
  return lens(
    (s: Entity<V1>) => s._entityContents,
    (s, c: V2): Entity<V2> => ({ ...s, _entityContents: c }),
  );
}

/** Extension values in addition to the built-in fields. */
export function entityExtensions<V = any>(): Lens<Entity<V>, ExtensionValues> {
  return lens((s: Entity<V>) => s._entityExtensions, (s, e: ExtensionValues) => ({ ...s, _entityExtensions: e }));
}

/** Entity modifed stamp (user and date). */
export function entityModified<V = any>(): Lens<Entity<V>, Stamp> {
  return lens((s: Entity<V>) => s._entityModified, (s, d: Stamp) => ({ ...s, _entityModified: d }));
}

/**
 * Extension values including the built-in fields. Doesn't quite follow the lens laws because
 * an attempt to set a built-in field with the wrong type may be ignored.
 */
export function entityProperties<V = any>(cls: EntityClass<V>): Lens<Entity<V>, ExtensionValues> {
  const getProperties = (e: Entity<V>): ExtensionValues =>
    M.union(cls.reflectiveGet(e._entityContents), e._entityExtensions);
  const setProperties = (e1: Entity<V>, newExts1: ExtensionValues): Entity<V> => {
    const v1 = e1._entityContents;
    const st: StateCell<ExtensionValues> = { state: newExts1 };
    const v2 = cls.reflectiveSet(st, v1);
    const newExts2 = st.state;
    return { ...e1, _entityContents: v2, _entityExtensions: newExts2 };
  };
  return lens(getProperties, setProperties);
}

/**
 * As for "entityProperties", but limits both reading and writing to fields defined in the
 * entity variant.
 */
export function entityVariantProperties<V = any>(cls: EntityClass<V>, model: Model<V>): Lens<Entity<V>, ExtensionValues> {
  const fields = (e: Entity<V>): S.Set<FieldId> =>
    S.fromList(fromMaybe<readonly FieldId[]>([], preview(ix(cls.reflectiveName(e._entityContents)), model.modelExtensions)));
  const getProperties = (e: Entity<V>): ExtensionValues =>
    M.union(
      cls.reflectiveGet(e._entityContents),
      M.restrictKeys(e._entityExtensions, fields(e)),
    );
  const setProperties = (e1: Entity<V>, newExts1: ExtensionValues): Entity<V> => {
    const v1 = e1._entityContents;
    const st: StateCell<ExtensionValues> = { state: newExts1 };
    const v2 = cls.reflectiveSet(st, v1);
    const newExts2 = st.state;
    const newExts3 = M.restrictKeys(newExts2, fields(e1));
    return { ...e1, _entityContents: v2, _entityExtensions: M.union(newExts3, e1._entityExtensions) };
  };
  return lens(getProperties, setProperties);
}

/**
 * Converts the entity creation and modification stamps into extension fields called
 * \"Created\", \"CreatedBy\", \"Modified\" and \"ModifiedBy\".
 */
export function entityStampsAsFields<V>(_cls: EntityClass<V>, e: Entity<V>): ExtensionValues {
  const stampAsFields = (dateField: FieldId, userField: FieldId, [user, date]: Stamp): ExtensionValues =>
    M.fromList<FieldId, ExtValue>([[userField, ExtText(user)], [dateField, ExtDate(date)]]);
  const { created, createdBy, modified, modifiedBy } = stampFieldIds();
  return M.union(
    stampAsFields(created, createdBy, e.entityCreated),
    stampAsFields(modified, modifiedBy, e._entityModified),
  );
}

/**
 * Union of the entity properties with the creation and modification stamps.
 *
 * This is a bit of a mess. The stamps are treated like extension values for expressions but not
 * for anything else. Hence it is up to the caller to decide whether to include the stamps or not.
 */
export function entityPropertiesWithStamps<V>(cls: EntityClass<V>, e: Entity<V>): ExtensionValues {
  return M.union(view(entityProperties(cls), e), entityStampsAsFields(cls, e));
}

/**
 * The field IDs of the stamp fields (the `where` clause of "entityStampsAsFields", computed once).
 */
let stampFieldIdsCache: { created: FieldId; createdBy: FieldId; modified: FieldId; modifiedBy: FieldId } | null = null;
function stampFieldIds() {
  if (stampFieldIdsCache === null) {
    const entityStampsByName = fieldsByName(entityStampFields);
    stampFieldIdsCache = {
      created: fromJust(M.lookup("Created", entityStampsByName)).fieldId,
      createdBy: fromJust(M.lookup("CreatedBy", entityStampsByName)).fieldId,
      modified: fromJust(M.lookup("Modified", entityStampsByName)).fieldId,
      modifiedBy: fromJust(M.lookup("ModifiedBy", entityStampsByName)).fieldId,
    };
  }
  return stampFieldIdsCache;
}

/** The list of stamp fields definitions. These are read-only. */
export const entityStampFields: FieldTable = (() => {
  const mkPair = ([nm, multi, typ]: readonly [string, Multiplicity, TypeDef]): [FieldId, Field] => {
    const fid = migrateField(nm);
    return [fid, Field(true, fid, nm, multi, typ)];
  };
  const defs: readonly (readonly [string, Multiplicity, TypeDef])[] = [
    ["Created", "One", BuiltInDef("ModelDate")],
    ["CreatedBy", "One", BuiltInDef("ModelText")],
    ["Modified", "One", BuiltInDef("ModelDate")],
    ["ModifiedBy", "One", BuiltInDef("ModelText")],
  ];
  return M.fromList(defs.map(mkPair));
})();

/** The abstract concept of a model. (`PM` is `PackageMeta v`.) */
export interface Model<V, PM = any> {
  readonly modelName: string;
  /** Top level of model name tree. */
  readonly modelRoot: M.Map<Name, ModelId>;
  /** Entities keyed by ModelID */
  readonly modelContents: M.Map<ModelId, Entity<V>>;
  /** Metadata for the notional root package. */
  readonly modelMeta: PM;
  /**
   * Each side of a relationship can be with an entity on its own, or an export of
   * the entity. The first ID is the base entity. The second ID is either the ID
   * of an export or "U.nil" if the relationship is with the base entity.
   */
  readonly modelRelations: NamedRelation<ModelId>;
  readonly modelFields: FieldTable;
  readonly modelRefTypes: RefTypeTable<V>;
  readonly modelExtensions: M.Map<Variant<V>, readonly FieldId[]>;
}

/** The `Model` constructor (not exported by the Haskell module). */
export function Model<V, PM = any>(
  modelName: string,
  modelRoot: M.Map<Name, ModelId>,
  modelContents: M.Map<ModelId, Entity<V>>,
  modelMeta: PM,
  modelRelations: NamedRelation<ModelId>,
  modelFields: FieldTable,
  modelRefTypes: RefTypeTable<V>,
  modelExtensions: M.Map<Variant<V>, readonly FieldId[]>,
): Model<V, PM> {
  return {
    modelName, modelRoot, modelContents, modelMeta, modelRelations, modelFields, modelRefTypes, modelExtensions,
  };
}

/**
 * `instance (Eq v, EntityClass v) => Eq (Model v)`.
 *
 * Haskell "deriving" can't deduce (Eq (PackageMeta v)), so we have an explicit instance instead.
 */
export function eq_Model<V>(m1: Model<V>, m2: Model<V>): boolean {
  const by = <X>(f: (m: Model<V>) => X): boolean => equals(f(m1), f(m2));
  return [
    by((m) => m.modelName),
    by((m) => m.modelRoot),
    by((m) => m.modelContents),
    by((m) => m.modelMeta),
    by((m) => m.modelRelations),
    by((m) => m.modelFields),
    by((m) => m.modelRefTypes),
    by((m) => m.modelExtensions),
  ].every((b) => b);
}

/** JSON codec for the "modelExtensions" table. */
const extensionsJ: J.JSONCodec<M.Map<Variant<any>, readonly FieldId[]>> =
  J.mapJ(JSONKey_Variant, J.listJ(J.uuidJ));

/**
 * `instance (EntityClass v, ToJSON v) => ToJSON (Model v)` and
 * `instance (EntityClass v, FromJSON v) => FromJSON (Model v)`.
 */
export function JSON_Model<V>(cls: EntityClass<V>): J.JSONCodec<Model<V>> {
  const entityJ = JSON_Entity(cls);
  const relationsJ = NR.JSON_NamedRelation(J.uuidJ);
  const contentsFromList = (es: readonly Entity<V>[]): M.Map<ModelId, Entity<V>> =>
    M.fromList(es.map((e) => [e.entityId, e] as [ModelId, Entity<V>]));
  const toJSON = (m: Model<V>): J.Value => J.object([
    ["modelName", m.modelName],
    ["modelRoot", nameMapJ.toJSON(m.modelRoot)],
    ["modelContents", M.elems(m.modelContents).map((e) => entityJ.toJSON(e))],
    ["modelMeta", cls.packageMetaJ.toJSON(m.modelMeta)],
    ["modelRelations", relationsJ.toJSON(m.modelRelations)],
    ["modelFields", J.listJ(JSON_Field).toJSON(M.elems(m.modelFields))],
    ["modelRefTypes", JSON_RefTypeTable.toJSON(m.modelRefTypes)],
    ["modelExtensions", extensionsJ.toJSON(M.mapKeys((k: Variant<V>) => view(variantName<V>(), k), m.modelExtensions))],
  ]);
  // Migrate from fields identified by name to identifying by UUID.
  const parseFieldTable = (v: J.JSONObject, nm: string): FieldTable =>
    M.fromList(J.alt<Field[]>(
      () => J.field(v, nm, J.listJ(JSON_Field)),
      () => M.elems(J.field(v, nm, J.mapJ(J.textKey, JSON_Field))),
    )(v).map((f) => [f.fieldId, f] as [FieldId, Field]));
  const parseExtensions = (v: J.JSONObject, nm: string): M.Map<Variant<V>, readonly FieldId[]> =>
    J.alt<M.Map<Variant<V>, readonly FieldId[]>>(
      () => J.field(v, nm, extensionsJ),
      () => M.map(
        (xs: string[]): readonly FieldId[] => xs.map(migrateField),
        J.field(v, nm, J.mapJ(JSONKey_Variant, J.listJ(J.textJ))),
      ),
    )(v);
  const parseModel06 = (v: J.JSONObject): Model<V> => Model<V>(
    T.strip(J.field(v, "modelName", J.textJ)),
    J.field(v, "modelRoot", nameMapJ),
    contentsFromList(J.field(v, "modelContents", J.listJ(entityJ))),
    J.fieldDefault(v, "modelMeta", cls.packageMetaJ, cls.packageMetaMempty),
    J.field(v, "modelRelations", relationsJ),
    parseFieldTable(v, "modelFields"),
    J.field(v, "modelRefTypes", JSON_RefTypeTable),
    parseExtensions(v, "modelExtensions"),
  );
  const parseField05 = (typeTable: M.Map<string, TypeDef>, v: J.JSONObject): Field => {
    const nm = J.field(v, "name", J.textJ);
    const mult = J.field(v, "multi", JSON_Multiplicity);
    const typ = J.field(v, "type", J.textJ);
    const t = M.lookup(typ, typeTable);
    if (t.tag === "Just") return Field(false, migrateField(nm), nm, mult, t.value);
    return Field(false, migrateField(nm), nm, mult, BuiltInDef("ModelText"));
  };
  const objectJ: J.Parser<J.JSONObject> = (x) => J.withObject("Object", (o) => o, x);
  const parseModel05 = (v: J.JSONObject): Model<V> => {
    const mName = T.strip(J.field(v, "modelName", J.textJ));
    const root = M.mapKeys((k: string) => Name(k), J.field(v, "modelRoot", J.mapJ(J.textKey, J.uuidJ)));
    const contents = contentsFromList(J.field(v, "modelContents", J.listJ(entityJ)));
    const relations = J.field(v, "modelRelations", relationsJ);
    const typeTable = J.fieldDefault(v, "modelTypes", J.mapJ(J.textKey, JSON_TypeDef), M.empty<string, TypeDef>());
    const refs = J.fieldDefault(v, "modelRefTypes", JSON_RefTypeTable, mempty_RefTypeTable);
    const exts1: M.Map<string, J.JSONObject[]> = J.fieldDefault(
      v, "modelExtensions", J.mapJ(J.textKey, J.listJ(J.codec((o: J.JSONObject) => o, objectJ))), M.empty(),
    );
    const exts2: M.Map<string, Field[]> = M.map((os: J.JSONObject[]) => os.map((o) => parseField05(typeTable, o)), exts1);
    const allFields = M.fromList(M.elems(exts2).flat().map((f) => [f.fieldId, f] as [FieldId, Field]));
    const exts3 = M.mapKeys((k: string) => Variant<V>(k), M.map((fs: Field[]): readonly FieldId[] => fs.map((f) => f.fieldId), exts2));
    return Model<V>(mName, root, contents, cls.packageMetaMempty, relations, allFields, refs, exts3);
  };
  return {
    toJSON,
    parseJSON: (val) => J.withObject("model", (v) =>
      Object.prototype.hasOwnProperty.call(v, "modelFields") ? parseModel06(v) : parseModel05(v), val),
  };
}

/** `instance (EntityClass v) => Show (Model v)` */
export function show_Model<V>(cls: EntityClass<V>, model: Model<V>): string {
  const getForest = (c: ModelEditCtx<V, V>): Forest<Entity<V>> => {
    checkModel(c);
    return modelPackageForest(c);
  };
  const r = evalModelEdit(cls, identity<V>(), model, getForest);
  switch (r.tag) {
    case "Right": {
      const showNode = (v: Entity<V>): string =>
        "(" + show_Name(view(entityName(cls), v)) + "," + U.toText(v.entityId) + ")";
      const forestNames = r.value.map((t) => fmapTree(showNode, t));
      return "Model " + T.unpack(model.modelName) + "\n" + drawForest(forestNames);
    }
    case "Left":
      return "showModelTree: " + show_ModelError(r.value);
    default:
      return absurd(r);
  }
}

/** Create a new model with no contents. The argument is the model name. */
export function emptyModel<V>(cls: EntityClass<V>, mName: string): Model<V> {
  return Model<V>(
    mName, M.empty(), M.empty(), cls.packageMetaMempty, NR.empty(), M.empty(), mempty_RefTypeTable, M.empty(),
  );
}

/** Maximum number of entities permitted for trial licenses. */
export const trialModelSizeLimit: number = 300;

/** Maximum number of entities permitted for student licenses. */
export const studentModelSizeLimit: number = 500;

/**
 * Adds the stamp fields to the field table. The results should only be used in a read-only
 * context.
 */
export function withStampFields(ft: FieldTable): FieldTable {
  return M.union(entityStampFields, ft);
}

// ---------------------------------------------------------------------
// Editing Models
// ---------------------------------------------------------------------

/**
 * In order to pass information about model changes out to a GUI, the ModelEdit monad keeps
 * a log of changes made by its primitives. In all cases the nil ModelID means the whole model.
 *
 * * `ModelAdd`: The entity has been added to the model.
 * * `ModelDelete`: The entity to be deleted, and the model beforehand.
 * * `ModelMove`: The entity moved, and the model before and after.
 * * `ModelRename`: The entity, and the model before and after.
 * * `ModelOther`: A change that does not affect the tree view.
 */
export type ModelEditLog<V> =
  | { readonly tag: "ModelAdd"; readonly _0: ModelId; readonly _1: Model<V> }
  | { readonly tag: "ModelDelete"; readonly _0: ModelId; readonly _1: Model<V> }
  | { readonly tag: "ModelMove"; readonly _0: ModelId; readonly _1: Model<V>; readonly _2: Model<V> }
  | { readonly tag: "ModelRename"; readonly _0: ModelId; readonly _1: Model<V>; readonly _2: Model<V> }
  | { readonly tag: "ModelOther"; readonly _0: Model<V>; readonly _1: Model<V> };

/** The entity has been added to the model. */
export function ModelAdd<V>(_0: ModelId, _1: Model<V>): ModelEditLog<V> {
  return { tag: "ModelAdd", _0, _1 };
}
/** The entity to be deleted, and the model beforehand. */
export function ModelDelete<V>(_0: ModelId, _1: Model<V>): ModelEditLog<V> {
  return { tag: "ModelDelete", _0, _1 };
}
/** The entity moved, and the model before and after. */
export function ModelMove<V>(_0: ModelId, _1: Model<V>, _2: Model<V>): ModelEditLog<V> {
  return { tag: "ModelMove", _0, _1, _2 };
}
/** The entity, and the model before and after. */
export function ModelRename<V>(_0: ModelId, _1: Model<V>, _2: Model<V>): ModelEditLog<V> {
  return { tag: "ModelRename", _0, _1, _2 };
}
/** A change that does not affect the tree view. */
export function ModelOther<V>(_0: Model<V>, _1: Model<V>): ModelEditLog<V> {
  return { tag: "ModelOther", _0, _1 };
}

/** `instance (EntityClass v) => Show (ModelEditLog v)` */
export function show_ModelEditLog<V>(l: ModelEditLog<V>): string {
  switch (l.tag) {
    case "ModelAdd": return "ModelAdd " + U.toText(l._0) + "\n";
    case "ModelDelete": return "ModelDelete " + U.toText(l._0) + "\n";
    case "ModelMove": return "ModelMove " + U.toText(l._0) + "\n";
    case "ModelRename": return "ModelRename " + U.toText(l._0) + "\n";
    case "ModelOther": return "ModelOther " + "/n";
    default: return absurd(l);
  }
}

/**
 * Errors within the "ModelEdit" monad are either user errors (e.g. no such path) or
 * internal errors where the model has become inconsistent. "checkModel" performs a systematic
 * check, but other functions can also fail due to internal inconsistencies.
 *
 * A @UserError@ does not necessarily mean that the end user has made an error; it is more that
 * the problem is not an internal inconsistency in the model state.
 */
export type ModelError =
  | { readonly tag: "UserError"; readonly _0: string }
  | { readonly tag: "InternalError"; readonly _0: string };

export function UserError(_0: string): ModelError {
  return { tag: "UserError", _0 };
}
export function InternalError(_0: string): ModelError {
  return { tag: "InternalError", _0 };
}

/** `instance Show ModelError` */
export function show_ModelError(e: ModelError): string {
  switch (e.tag) {
    case "UserError": return "Model library client error: " + T.unpack(e._0);
    case "InternalError": return "Model library internal error: " + T.unpack(e._0);
    default: return absurd(e);
  }
}

/**
 * TypeScript: the exception thrown by a failing "ModelEdit" action (Haskell `throwError e`).
 * It is caught by "try_", "catchError" and the `run` functions.
 */
export class ModelErrorException extends Error {
  constructor(readonly modelError: ModelError) {
    super(show_ModelError(modelError));
    this.name = "ModelErrorException";
  }
  /** The wrapped error (same as `modelError`). */
  get error(): ModelError {
    return this.modelError;
  }
}

/** Internal state record for "ModelEdit". */
export interface ModelEditState<V> {
  readonly stateGenerator: UUIDGenerator;
  readonly stateModel: Model<V>;
  readonly statePosition: ModelId;
  /** Reverse order. */
  readonly stateLogR: readonly ModelEditLog<V>[];
}

/** The model held in the state (the record field `stateModel` as a function). */
export function stateModel<V>(ms: ModelEditState<V>): Model<V> {
  return ms.stateModel;
}

/** The initial state for running ModelEdits. */
export function modelStartState<V>(
  /** Random generator for ModelIDs. Cryptographic because StdGen doesn't have enought bits. */
  gen: UUIDGenerator,
  /** The model being accessed. */
  model: Model<V>,
): ModelEditState<V> {
  return { stateGenerator: gen, stateModel: model, statePosition: U.nil, stateLogR: [] };
}

/** The log of changes made so far. */
export function stateLog<V>(ms: ModelEditState<V>): ModelEditLog<V>[] {
  return [...ms.stateLogR].reverse();
}

/**
 * Internal function to access the current entity, or @Nothing@ if at root.
 * (TypeScript: the Haskell `Left` is thrown.)
 */
function lookupCurrent<V>(ms: ModelEditState<V>): Maybe<Entity<V>> {
  const u = ms.statePosition;
  const m = ms.stateModel;
  if (U.isNil(u)) return Nothing;
  const r = M.lookup(u, m.modelContents);
  if (r.tag === "Nothing") return throwInternal("ModelID " + U.toText(u) + " has gone missing.");
  return Just(r.value);
}

/**
 * The @ModelEdit@ monad provides a view on the underlying data through
 * a @Prism' v w@. This allows ModelEdit actions to be written which target the subset of the
 * data stored in the model of type @w@ without having to know about the underlying type of
 * @v@. So for instance given:
 *
 * > type FooBar = Either Foo Bar
 * > start :: ModelState FooBar
 *
 * we can have an edit action that only deals with objects of type @Foo@:
 *
 * > action :: ModelEdit v Foo ()
 *
 * which can be executed with
 *
 * > runModelEdit _Left start action
 *
 * The monadic state includes a cursor which can be moved up and down
 * the model tree, and hence used to access different entities in the model.
 * ModelIDs provide something like object identity. The ModelIDs
 * are visible and can be used in unsafe ways, for instance to construct a cycle in the tree.
 *
 * TypeScript: a first-class `ModelEdit v w a` action is a function of the context. Errors are
 * thrown as "ModelErrorException".
 */
export type ModelEdit<V, W, A> = (ctx: ModelEditCtx<V, W>) => A;

/**
 * TypeScript: the context of a running "ModelEdit" action. It holds the dictionary of the
 * top-level model type, the `Traversal' v w` of the action, and a shared mutable cell with the
 * "ModelEditState". Contexts derived with "withSubtype", "withBaseType" and "usingTraversal"
 * share the cell.
 */
export class ModelEditCtx<V, W> implements StateCell<ModelEditState<V>> {
  constructor(
    /** Dictionary of the top-level model type. */
    readonly cls: EntityClass<V>,
    /** The `Traversal' v w` of the Haskell ModelEdit. */
    readonly prsm: Traversal<V, W>,
    /** Shared, mutable. */
    readonly cell: { state: ModelEditState<V> },
  ) {}
  get state(): ModelEditState<V> {
    return this.cell.state;
  }
  set state(s: ModelEditState<V>) {
    this.cell.state = s;
  }
}

/** `pure` for "ModelEdit". */
export function pure_ModelEdit<V, W, A>(v: A): ModelEdit<V, W, A> {
  return (_ctx) => v;
}

/** `instance Functor (ModelEdit v w)` */
export function fmap_ModelEdit<V, W, A, R>(f: (a: A) => R, act: ModelEdit<V, W, A>): ModelEdit<V, W, R> {
  return (ctx) => f(act(ctx));
}

/** `(>>=)` of `instance Monad (ModelEdit v w)` */
export function bind_ModelEdit<V, W, A, R>(act: ModelEdit<V, W, A>, f: (a: A) => ModelEdit<V, W, R>): ModelEdit<V, W, R> {
  return (ctx) => f(act(ctx))(ctx);
}

/** `throwError` of `instance MonadError ModelError (ModelEdit v w)`. */
export function throwError(e: ModelError): never;
export function throwError<V, W>(ctx: ModelEditCtx<V, W>, e: ModelError): never;
export function throwError(...args: [ModelError] | [ModelEditCtx<any, any>, ModelError]): never {
  const e = args.length === 1 ? args[0] : args[1];
  throw new ModelErrorException(e);
}

/**
 * `catchError` of `instance MonadError ModelError (ModelEdit v w)`. If the action fails then
 * the state is restored and the handler is run.
 */
export function catchError<V, W, A>(
  ctx: ModelEditCtx<V, W>,
  act: ModelEdit<V, W, A>,
  handler: (ctx: ModelEditCtx<V, W>, e: ModelError) => A,
): A {
  const ms = ctx.state;
  try {
    return act(ctx);
  } catch (e) {
    if (!(e instanceof ModelErrorException)) throw e;
    ctx.state = ms;
    return handler(ctx, e.modelError);
  }
}

/** Updates to the model carry a return type, a model update function, and the log of edits made. */
export interface ModelUpdate<V, A> {
  readonly updateValue: A;
  readonly updateNewModel: Model<V>;
  readonly updateEditLog: readonly ModelEditLog<V>[];
}
export function ModelUpdate<V, A>(
  updateValue: A,
  updateNewModel: Model<V>,
  updateEditLog: readonly ModelEditLog<V>[],
): ModelUpdate<V, A> {
  return { updateValue, updateNewModel, updateEditLog };
}

/** `instance Functor (ModelUpdate v)` */
export function fmap_ModelUpdate<V, A, R>(f: (a: A) => R, u: ModelUpdate<V, A>): ModelUpdate<V, R> {
  return ModelUpdate(f(u.updateValue), u.updateNewModel, u.updateEditLog);
}

/**
 * Run an editing action, starting at the root. If the action is successful then it returns
 * the monadic value, the updated model, and a set of changes.
 *
 * The set of changed ModelIDs will list the entities that changed value, and the parents of those
 * inserted, deleted or renamed. In the case of a move both parents will be listed.
 *
 * The "ModelUpdate" contains a duplicate of the edit logs in the "ModelEditState", so use
 * one or the other but not both.
 *
 * (TypeScript: the dictionary of @v@ comes first; the context is created here.)
 */
export function runModelEdit<V, W, A>(
  cls: EntityClass<V>,
  prsm: Traversal<V, W>,
  st: ModelEditState<V>,
  act: ModelEdit<V, W, A>,
): Either<ModelError, [ModelUpdate<V, A>, ModelEditState<V>]> {
  const ctx = new ModelEditCtx<V, W>(cls, prsm, { state: st });
  try {
    const v = act(ctx);
    const ms = ctx.state;
    return Right([ModelUpdate(v, ms.stateModel, stateLog(ms)), ms]);
  } catch (e) {
    if (e instanceof ModelErrorException) return Left(e.modelError);
    throw e;
  }
}

/** As for "runModelEdit", except it ignores the result. */
export function execModelEdit<V, W, A>(
  cls: EntityClass<V>,
  prsm: Traversal<V, W>,
  st: ModelEditState<V>,
  act: ModelEdit<V, W, A>,
): Either<ModelError, [Model<V>, ModelEditLog<V>[]]> {
  const r = runModelEdit(cls, prsm, st, act);
  if (r.tag === "Left") return Left(r.value);
  const [u] = r.value;
  return Right([u.updateNewModel, [...u.updateEditLog]]);
}

/** As for "runModelEdit", except it ignores any change to the model. */
export function evalModelEdit<V, W, A>(
  cls: EntityClass<V>,
  prsm: Traversal<V, W>,
  m: Model<V>,
  act: ModelEdit<V, W, A>,
): Either<ModelError, A> {
  const g = newGenerator();
  // This is safe because 'g' is only used to create new ModelIDs for
  // additions to the model, and these are all thrown away.
  const r = runModelEdit(cls, prsm, modelStartState(g, m), act);
  if (r.tag === "Left") return Left(r.value);
  return Right(r.value[0].updateValue);
}

/**
 * Evaluate a model action in the context of a model behavior and an event. Any changes made
 * to the model by the edit action are ignored.
 *
 * This is actually a Reactive Banana wrapper around "evalModelEdit"
 *
 * (TypeScript: the `a -> ModelEdit v w b` argument is a function `(ctx, a) => B`.)
 */
export function queryModel<V, W, A, R>(
  cls: EntityClass<V>,
  prsm: Traversal<V, W>,
  modelB: B.Behavior<Model<V>>,
  e: B.Event<A>,
  f: (ctx: ModelEditCtx<V, W>, a: A) => R,
): [B.Event<ModelError>, B.Event<R>] {
  return B.split(B.apply(
    B.mapB((m: Model<V>) => (act: ModelEdit<V, W, R>) => evalModelEdit(cls, prsm, m, act), modelB),
    B.mapE((a: A): ModelEdit<V, W, R> => (c) => f(c, a), e),
  ));
}

/**
 * Combine monadic events by sequencing. This is intended for events carrying
 * @ModelEdit v w Text@, but could be used for any other monad.
 *
 * (TypeScript: specialised to events of "ModelEdit" action functions.)
 */
export function sequenceEvents<V, W>(
  es: readonly B.Event<ModelEdit<V, W, Maybe<string>>>[],
): B.Event<ModelEdit<V, W, Maybe<string>>> {
  // Simultaneous events probably can't happen. If so then this is dead code.
  const seqResults = (
    act1: ModelEdit<V, W, Maybe<string>>,
    act2: ModelEdit<V, W, Maybe<string>>,
  ): ModelEdit<V, W, Maybe<string>> => (ctx) => {
    const str1 = act1(ctx);
    const str2 = act2(ctx);
    if (str1.tag === "Nothing") return str2.tag === "Nothing" ? Nothing : Just(str2.value);
    if (str2.tag === "Nothing") return Just(str1.value);
    return Just(str1.value + ", " + str2.value);
  };
  return es.reduceRight<B.Event<ModelEdit<V, W, Maybe<string>>>>(
    (acc, ev) => B.unionWith(seqResults, ev, acc),
    B.never(),
  );
}

/** Internal function for logging changes. */
export function tellLog<V, W>(ctx: ModelEditCtx<V, W>, x: ModelEditLog<V>): void {
  const ms1 = ctx.state;
  ctx.state = { ...ms1, stateLogR: [x, ...ms1.stateLogR] };
}

/**
 * Convenience function for running ModelEdit actions in other monads. If the model edit
 * succeeds then return its value, otherwise return the first argument.
 */
export function monadic<E, A>(v: A, e: Either<E, A>): A {
  return e.tag === "Left" ? v : e.value;
}

/** Throw an error at the user level (e.g. named element does not exist) */
export function throwUser(msg: string): never;
export function throwUser<V, W>(ctx: ModelEditCtx<V, W>, msg: string): never;
export function throwUser(...args: [string] | [ModelEditCtx<any, any>, string]): never {
  const msg = args.length === 1 ? args[0] : args[1];
  throw new ModelErrorException(UserError(msg));
}

/** Throw an internal error due to failure of the Model to maintain consistency. */
export function throwInternal(msg: string): never;
export function throwInternal<V, W>(ctx: ModelEditCtx<V, W>, msg: string): never;
export function throwInternal(...args: [string] | [ModelEditCtx<any, any>, string]): never {
  const msg = args.length === 1 ? args[0] : args[1];
  throw new ModelErrorException(InternalError(msg));
}

/**
 * Try an action that may cause a user error. If it succeeds then return the result, otherwise
 * return the error message with no changes made. Internal errors are not caught.
 */
export function try_<V, W, A>(ctx: ModelEditCtx<V, W>, act: ModelEdit<V, W, A>): Either<string, A> {
  const ms1 = ctx.state;
  try {
    return Right(act(ctx));
  } catch (e) {
    if (e instanceof ModelErrorException && e.modelError.tag === "UserError") {
      ctx.state = ms1;
      return Left(e.modelError._0);
    }
    throw e;
  }
}
export { try_ as try };

// -----------------------------------------------------------
// ModelEdit actions
// -----------------------------------------------------------

export function getModel<V, W>(ctx: ModelEditCtx<V, W>): Model<V> {
  return ctx.state.stateModel;
}

/**
 * Replaces the model.
 *
 * Beware: this function is unsafe.
 * It is up to the application to ensure that the replacement
 * model is consistent and that "tellLog" has been called to update the UI widget.
 */
export function setModel<V, W>(ctx: ModelEditCtx<V, W>, newModel: Model<V>): void {
  ctx.state = { ...ctx.state, stateModel: newModel };
}

export function getModelName<V, W>(ctx: ModelEditCtx<V, W>): string {
  return ctx.state.stateModel.modelName;
}

/** TypeScript: the context used by "withSubtype": composed traversal, same cell. */
export function withSubtypeCtx<V, W1, W2>(ctx: ModelEditCtx<V, W1>, p2: Traversal<W1, W2>): ModelEditCtx<V, W2> {
  return new ModelEditCtx<V, W2>(ctx.cls, ctx.prsm.dot(p2), ctx.cell);
}

/** Convert a computation over an inner type @w2@ to an outer type @w1@. */
export function withSubtype<V, W1, W2, A>(
  ctx: ModelEditCtx<V, W1>,
  p2: Traversal<W1, W2>,
  act: ModelEdit<V, W2, A>,
): A {
  return act(withSubtypeCtx(ctx, p2));
}

/**
 * Get access to the current prism.
 *
 * (TypeScript: the `Traversal' v w -> ModelEdit v w a` argument is `(ctx, prsm) => A`.)
 */
export function usingTraversal<V, W, A>(
  ctx: ModelEditCtx<V, W>,
  f: (ctx: ModelEditCtx<V, W>, prsm: Traversal<V, W>) => A,
): A {
  return f(ctx, ctx.prsm);
}

/**
 * Search the model for a string. Returns a list of entity IDs where the string is found,
 * paired with lists of the field IDs and string indexes for each match within the entity.
 */
export function searchEntities<V, W>(
  ctx: ModelEditCtx<V, W>,
  /** True for case insensitive search. */
  caseBlind: boolean,
  /** Text to search for. All fields are searched using their text representation. */
  needle: string,
): [ModelId, [FieldId, number][]][] {
  const props = entityProperties(ctx.cls);
  const search = ([k, ent]: [ModelId, Entity<V>]): Maybe<[ModelId, [FieldId, number][]]> => {
    const rs = valueSearch(caseBlind, needle, view(props, ent));
    return rs.length === 0 ? Nothing : Just([k, rs]);
  };
  const r: [ModelId, [FieldId, number][]][] = [];
  for (const kv of M.toList(getModel(ctx).modelContents)) {
    const m = search(kv);
    if (m.tag === "Just") r.push(m.value);
  }
  return r;
}

/** TypeScript: the context used by "withBaseType": identity traversal, same cell. */
export function withBaseTypeCtx<V, W>(ctx: ModelEditCtx<V, W>): ModelEditCtx<V, V> {
  return new ModelEditCtx<V, V>(ctx.cls, identity<V>(), ctx.cell);
}

/** Lift a computation on the base type up to an inner type @w@. */
export function withBaseType<V, W, A>(ctx: ModelEditCtx<V, W>, act: ModelEdit<V, V, A>): A {
  return act(withBaseTypeCtx(ctx));
}

export function setModelName<V, W>(ctx: ModelEditCtx<V, W>, newName: string): void {
  const ms = ctx.state;
  const newModel = { ...ms.stateModel, modelName: newName };
  ctx.state = { ...ms, stateModel: newModel };
}

/** Get data about relationships between entities. */
export function queryRelations<V, W, A>(ctx: ModelEditCtx<V, W>, f: (r: NamedRelation<ModelId>) => A): A {
  return f(ctx.state.stateModel.modelRelations);
}

/** Modify relationships between entities. */
export function modifyRelations<V, W>(
  ctx: ModelEditCtx<V, W>,
  f: (r: NamedRelation<ModelId>) => NamedRelation<ModelId>,
): void {
  const ms = ctx.state;
  const relations = ms.stateModel.modelRelations;
  const newModel = { ...ms.stateModel, modelRelations: f(relations) };
  ctx.state = { ...ms, stateModel: newModel };
}

/**
 * Add a new relation. If either side of the relation is \"1\" as opposed to \"many\" then
 * any previous conflicting relations will be deleted.
 *
 * This only enforces cardinality. Relationships that are not described in the model reference
 * types are still permitted. Unit cardinality matters to the model semantics; for instance it
 * makes no sense for an arrow end to be connected to more than one box. Other relationships
 * can be preserved without damaging the model semantics, so they are permitted.
 */
export function addCheckedRelation<V, W>(
  ctx: ModelEditCtx<V, W>,
  relName: NR.Relation,
  entityA: Entity<V>,
  entityB: Entity<V>,
): void {
  const cls = ctx.cls;
  const oldState = queryRelations(ctx, (r) => NR.member(entityA.entityId, entityB.entityId, relName, r));
  if (oldState) return;   // Relation already exists. No-op.
  fromHere(ctx, (c) => {
    const model = getModel(c);
    const refTypes = append_RefTypeTable(model.modelRefTypes, cls.reflectiveBuiltInRefs)._0;
    const found = M.lookup(relName, refTypes);
    if (found.tag === "Just") {
      const refType = found.value;
      const variantA = cls.reflectiveName(entityA._entityContents);
      const variantB = cls.reflectiveName(entityB._entityContents);
      const singleA = refTypeOtherSide(variantA, refType)[0];
      const singleB = refTypeOtherSide(variantB, refType)[0];
      if (singleA) {
        const otherEnds = queryRelations(c, (r) => NR.relation(entityA.entityId, relName, r));
        for (const e of S.toList(otherEnds)) {
          modifyRelations(c, (r) => NR.delete_(entityA.entityId, e, relName, r));
          recordModified(c, e);
        }
      }
      if (singleB) {
        const otherEnds = queryRelations(c, (r) => NR.relation(entityB.entityId, relName, r));
        for (const e of S.toList(otherEnds)) {
          fromHere(c, (c2) => {
            modifyRelations(c2, (r) => NR.delete_(entityB.entityId, e, relName, r));
            recordModified(c2, e);
          });
        }
      }
    }
    recordModified(c, entityA.entityId);
    recordModified(c, entityB.entityId);
    modifyRelations(c, (r) => NR.insert(entityA.entityId, entityB.entityId, relName, r));
  });
}

/** Move the cursor to the root. */
export function goToRoot<V, W>(ctx: ModelEditCtx<V, W>): void {
  ctx.state = { ...ctx.state, statePosition: U.nil };
}

/** Move the cursor to the Entity with the ModelID. Nil argument means go to root. */
export function goToEntity<V, W>(ctx: ModelEditCtx<V, W>, uuid: ModelId): void {
  const ms = ctx.state;
  if (!U.isNil(uuid) && !M.member(uuid, ms.stateModel.modelContents)) {
    throwUser("Entity " + U.toText(uuid) + " does not exist.");
  }
  ctx.state = { ...ms, statePosition: uuid };
}

/** Similar to "goToEntity" but with a friendlier error message if it fails. */
export function goToEntity1<V, W>(ctx: ModelEditCtx<V, W>, msg: string, uuid: ModelId): void {
  const r = try_(ctx, (c) => goToEntity(c, uuid));
  if (r.tag === "Left") throwUser(msg);
}

/** How many levels from the root are we? Zero means at the root. */
export function depth<V, W>(ctx: ModelEditCtx<V, W>): number {
  return currentPath(ctx).length;
}

/** The entity at the current location in the tree. @Nothing@ if we are at the root. */
export function current<V, W>(ctx: ModelEditCtx<V, W>): Maybe<Entity<V>> {
  return lookupCurrent(ctx.state);
}

/** The ID of the current location in the tree. */
export function currentId<V, W>(ctx: ModelEditCtx<V, W>): ModelId {
  return ctx.state.statePosition;
}

/**
 * Update the "enitityModified" field of the entity with the current "Stamp". Does nothing
 * if the argument is the root.
 */
export function recordModified<V, W>(ctx: ModelEditCtx<V, W>, modelId: ModelId): void {
  if (U.isNil(modelId)) return;   // No-op for root.
  const ms = ctx.state;
  const r = M.lookup(modelId, ms.stateModel.modelContents);
  if (r.tag === "Nothing") throwInternal("ModelID " + U.toText(modelId) + " has gone missing.");
  const e2 = set(entityModified<V>(), thisChange(), r.value);
  const model = ms.stateModel;
  const newContents = M.insert(modelId, e2, model.modelContents);
  ctx.state = { ...ms, stateModel: { ...model, modelContents: newContents } };
}

/**
 * Update the "entityModified" stamp for the current entity. Does nothing if the current
 * entity is root.
 */
export function currentIsModified<V, W>(ctx: ModelEditCtx<V, W>): void {
  recordModified(ctx, currentId(ctx));
}

/** Get the reflective data for the current location. Root returns its name. */
export function getData<V, W>(ctx: ModelEditCtx<V, W>): ExtensionValues {
  const ms = ctx.state;
  const cur = lookupCurrent(ms);
  if (cur.tag === "Nothing") return M.singleton(nameField, ExtText(ms.stateModel.modelName));
  const e = cur.value;
  const e1 = ctx.cls.reflectiveGet(e._entityContents);
  const e2 = e._entityExtensions;
  const e3 = entityStampsAsFields(ctx.cls, e);
  return M.union(M.union(e1, e2), e3);
}

/**
 * Modify the reflective data for the current location. Root changes its name but ignores any
 * other values. Returns @True@ if the new data is not equal to the old (i.e. something has
 * actually changed).
 */
export function setData<V, W>(ctx: ModelEditCtx<V, W>, newExts1: ExtensionValues): boolean {
  const cls = ctx.cls;
  const cur = current(ctx);
  if (cur.tag === "Nothing") {
    const oldName = getModelName(ctx);
    const newName = T.strip(extract({ state: newExts1 }, oldName, _ExtText, nameField));
    setModelName(ctx, newName);
    return newName !== oldName;
  }
  const e1 = cur.value;
  const oldExts = getData(ctx);
  if (equals(oldExts, newExts1)) return false;
  const v1 = e1._entityContents;
  const st: StateCell<ExtensionValues> = { state: newExts1 };
  const v2 = cls.reflectiveSet(st, v1);
  const newExts2 = st.state;
  const v3 = over(cls.name.dot(nameText), T.strip, v2);
  const e3: Entity<V> = { ...e1, _entityContents: v3, _entityExtensions: newExts2 };
  const nameChange = !equals(view(cls.name, v1), view(cls.name, v3));
  // Important thzt any renaming is done first
  // so if it fails the rest will be cancelled.
  if (nameChange) renameEntity(ctx, view(cls.name, v3));
  if (equals(e1, e3)) return false;
  modelModify(ctx, set(entityModified<V>(), thisChange(), e3));
  return true;
}

/**
 * If "current" is a "Package" or root then get the metadata for it.
 * (`PM` is `PackageMeta v`.)
 */
export function getMeta<V, W, PM = any>(ctx: ModelEditCtx<V, W>): Maybe<PM> {
  const cur = current(ctx);
  if (cur.tag === "Nothing") return Just(getModel(ctx).modelMeta);
  return preview(entityContents<V>().dot(ctx.cls._Package).dot(packageMeta<V>()), cur.value);
}

/**
 * Set the metadata for the current value. If the value is not a package or root then this is
 * ignored.
 */
export function setMeta<V, W, PM = any>(ctx: ModelEditCtx<V, W>, pm: PM): void {
  const cur = current(ctx);
  if (cur.tag === "Nothing") {
    const m = getModel(ctx);
    setModel(ctx, { ...m, modelMeta: pm });
  } else {
    modelModify(ctx, set(entityContents<V>().dot(ctx.cls._Package).dot(packageMeta<V>()), pm, cur.value));
  }
}

/** The set of field IDs defined for the current entity in the model (including built-in fields). */
function currentVariantFields<V, W>(ctx: ModelEditCtx<V, W>): S.Set<FieldId> {
  const cur = current(ctx);
  if (cur.tag === "Nothing") return S.singleton(nameField);
  const e = cur.value;
  const typs = getModel(ctx).modelExtensions;
  return S.fromList([
    ...ctx.cls.reflectiveBuiltIn(e._entityContents),
    ...fromMaybe<readonly FieldId[]>([], preview(ix(ctx.cls.reflectiveName(e._entityContents)), typs)),
  ]);
}

/** Like "getData", but restricts the results to fields defined for the current variant. */
export function getVariantData<V, W>(ctx: ModelEditCtx<V, W>): ExtensionValues {
  const fields = currentVariantFields(ctx);
  const d = getData(ctx);
  return M.restrictKeys(d, fields);
}

/** Like "setData", but only modifies fields defined for the current variant. */
export function setVariantData<V, W>(ctx: ModelEditCtx<V, W>, newExts: ExtensionValues): boolean {
  const fields = currentVariantFields(ctx);
  return setData(ctx, M.restrictKeys(newExts, fields));
}

/** The name of the current location. */
export function currentName<V, W>(ctx: ModelEditCtx<V, W>): string {
  const ms = ctx.state;
  const cur = lookupCurrent(ms);
  if (cur.tag === "Just") return view(entityName(ctx.cls).dot(nameText), cur.value);
  return ms.stateModel.modelName;
}

/** The entities from the current one up to the root. */
export function currentPath<V, W>(ctx: ModelEditCtx<V, W>): Entity<V>[] {
  const entities: Entity<V>[] = [];
  let ms = ctx.state;
  for (;;) {
    const cur = lookupCurrent(ms);
    if (cur.tag === "Nothing") return entities;
    const e = cur.value;
    entities.push(e);
    ms = { ...ms, statePosition: e._entityParent };
  }
}

/** The children we can move down to from here. Always succeeds, even at a root or leaf. */
export function currentChildren<V, W>(ctx: ModelEditCtx<V, W>): M.Map<Name, ModelId> {
  const ms = ctx.state;
  const cur = lookupCurrent(ms);
  if (cur.tag === "Nothing") return ms.stateModel.modelRoot;
  return cur.value._entityChildren;
}

/** Move up towards the root. If already there then this is a no-op. */
export function moveUp<V, W>(ctx: ModelEditCtx<V, W>): void {
  const ms = ctx.state;
  const cur = lookupCurrent(ms);
  if (cur.tag === "Nothing") return;
  ctx.state = { ...ms, statePosition: cur.value._entityParent };
}

/**
 * Move down one level. The argument function is used to select the child.
 *
 * (TypeScript: the `Map Name ModelId -> ModelEdit v w ModelId` argument is `(ctx, table) => ModelId`.)
 */
export function moveDown<V, W>(
  ctx: ModelEditCtx<V, W>,
  child: (ctx: ModelEditCtx<V, W>, table: M.Map<Name, ModelId>) => ModelId,
): void {
  goToEntity(ctx, child(ctx, currentChildren(ctx)));
}

/**
 * Move down by following a path of names starting from the top. Note that this in reverse
 * order compared to the result of "currentPath"
 */
export function followPath<V, W>(ctx: ModelEditCtx<V, W>, path: readonly Name[]): void {
  for (const next of path) {
    const goNext = (_c: ModelEditCtx<V, W>, table: M.Map<Name, ModelId>): ModelId => {
      const r = M.lookup(next, table);
      if (r.tag === "Nothing") return throwUser(view(nameText, next) + " not found.");
      return r.value;
    };
    moveDown(ctx, goNext);
  }
}

/** Generate a new ModelId. */
export function mkModelId<V, W>(ctx: ModelEditCtx<V, W>): ModelId {
  const ms = ctx.state;
  const g1 = ms.stateGenerator;
  const r = generateUUID(g1);
  if (r.tag === "Left") return throwInternal(r.value);
  const [newId, g2] = r.value;
  ctx.state = { ...ms, stateGenerator: g2 };
  return newId;
}

/**
 * Insert the entity as a child of the current location. The new entity must
 * not exist already, either by name or ModelId. The latter is not checked.
 * The modified date is set to the current date.
 *
 * The new entity is passed as a function which takes the new parent ModelId.
 */
export function addEntity<V, W>(ctx: ModelEditCtx<V, W>, entF: (parent: ModelId) => Entity<V>): Entity<V> {
  const cls = ctx.cls;
  // Stand-in for root when testing if new entity is legal at the top level.
  const dummyPackage = (): V => review(cls._Package, Package<V>(Name(""), cls.packageMetaMempty));
  const add = (k: Name, val: ModelId, tbl: M.Map<Name, ModelId>): M.Map<Name, ModelId> => {
    if (M.member(k, tbl)) return throwUser(view(nameText, k) + " already exists.");
    return M.insert(k, val, tbl);
  };
  const ent = ((): Entity<V> => {
    const ms = ctx.state;
    const model = ms.stateModel;
    const newEntity = entF(ms.statePosition);
    const entContents = newEntity._entityContents;
    const newId = newEntity.entityId;
    const eName = view(entityName(cls), newEntity);
    const cur = lookupCurrent(ms);
    if (cur.tag === "Nothing") {
      const newRoot = add(eName, newId, model.modelRoot);
      const newContents = M.insert(newId, newEntity, model.modelContents);
      const newModel: Model<V> = { ...model, modelRoot: newRoot, modelContents: newContents };
      if (!cls.entityCanHaveChild(dummyPackage(), entContents)) {
        throwUser("Model root cannot have " + view(nameText, eName) + " as a child.");
      }
      ctx.state = { ...ms, stateModel: newModel };
      return newEntity;
    } else {
      const parent = cur.value;
      const parentContents = parent._entityContents;
      if (!cls.entityCanHaveChild(parentContents, entContents)) {
        throwUser(view(entityName(cls).dot(nameText), parent) +
          " cannot have " + view(nameText, eName) + " as a child.");
      }
      const newSiblings = add(eName, newId, parent._entityChildren);
      const newParent = set(entityChildren<V>(), newSiblings, parent);
      const newContents = M.insert(parent.entityId, newParent, M.insert(newId, newEntity, model.modelContents));
      const newModel: Model<V> = { ...model, modelContents: newContents };
      ctx.state = { ...ms, stateModel: newModel };
      return newEntity;
    }
  })();
  const m = getModel(ctx);
  currentIsModified(ctx);
  tellLog(ctx, ModelAdd(ent.entityId, m));
  return ent;
}

/**
 * Create a clone of the current entity with a suitably modified name.
 *
 * When a diagram is cloned the elements in the clone will have the same "DiagramId" values as
 * the original, breaking the principle that UUIDs should be unique. Diagram IDs are
 * local to each diagram so this should not be an issue. However if some future feature has
 * diagrams merging then this will become an issue.
 */
export function cloneEntity<V, W>(ctx: ModelEditCtx<V, W>): Maybe<Entity<V>> {
  return withBaseType(ctx, (c) => {
    const cur = current(c);
    if (cur.tag === "Nothing") return throwUser("Cannot clone root.");
    const e = cur.value;
    moveUp(c);
    const oldName = view(entityName(c.cls).dot(nameText), e);
    const newName = modelNewName(c, Name(oldName + " clone-"));
    const act = c.cls.entityClone(e, newName);
    if (act.tag === "Just") return Just(act.value(c));
    return Nothing;
  });
}

/**
 * An implementation for "entityClone" that will work for entities with no children. This
 * MUST NOT be used for entities that have children; doing so will leave the model in an
 * inconsistent state.
 *
 * The new entity is given a fresh creation stamp.
 */
export function unsafeEntityClone<V>(ctx: ModelEditCtx<V, V>, ent: Entity<V>, newName: Name): Entity<V> {
  const newId = mkModelId(ctx);
  const stamp = thisChange();
  return addEntity(ctx, (parentId) =>
    set(entityParent<V>(), parentId,
      set(entityModified<V>(), stamp,
        set(entityName(ctx.cls), newName,
          { ...ent, entityId: newId, entityCreated: stamp }))));
      // The only time when entity ID and creation stamp are modified.
}

/**
 * Create an empty package entity as a child of the current location. The new package must
 * not exist already.
 */
export function mkPackage<V, W>(ctx: ModelEditCtx<V, W>, newName: Name): ModelId {
  return withBaseType(ctx, (c) => {
    const newId = mkModelId(c);
    const e = addEntity(c, (parent) => Entity<V>(
      newId,
      parent,
      M.empty(),
      review(c.cls._Package, Package<V>(newName, c.cls.packageMetaMempty)),
      M.empty(),
      thisChange(),
      thisChange(),
    ));
    return e.entityId;
  });
}

/**
 * Follow a package name path, creating new packages along the way if necessary.
 *
 * If one of the entities already exists and cannot have this child
 * then it will use "modelNewName" to generate alternatives until it finds a name which is
 * either an existing package or is not taken.
 *
 * Returns the ID of the entity (whether it existed already or not) and a flag to indicate if any
 * new entities have been created.
 */
export function createPath<V, W>(ctx: ModelEditCtx<V, W>, names: readonly Name[]): [ModelId, boolean] {
  if (names.length === 0) return [currentId(ctx), false];
  // Try names from the argument until we either find an existing package or can create a
  // new one.
  const goDown = (ch: M.Map<Name, ModelId>, candidates: Iterator<Name>): [ModelId, boolean] => {
    for (;;) {
      const next = candidates.next();
      if (next.done) return throwInternal("Run out of numbers: cannot happen.");
      const nm = next.value;
      if (M.member(nm, ch)) {
        const existing = fromHere(ctx, (c) => {
          followPath(c, [nm]);
          return current(c);
        });
        if (existing.tag === "Nothing") {
          return throwInternal(view(nameText, nm) + " is in a package but does not exist.");
        }
        if (isJust(preview(entityContents<V>().dot(ctx.cls._Package), existing.value))) {
          followPath(ctx, [nm]);
          const i = currentId(ctx);
          return [i, false];
        }
        // Not a package: try the next candidate.
      } else {
        const pkg = mkPackage(ctx, nm);
        goToEntity(ctx, pkg);
        return [pkg, true];
      }
    }
  };
  function* candidatesOf(nm: Name): Generator<Name, void, unknown> {
    const txt = nm._0;
    yield nm;
    for (let x = 1; ; x++) yield Name(txt + String(x));
  }
  const results: [ModelId, boolean][] = [];
  for (const nm of names) {
    const ch = currentChildren(ctx);
    results.push(goDown(ch, candidatesOf(nm)));
  }
  const uuids = results.map((r) => r[0]);
  const flags = results.map((r) => r[1]);
  return [uuids[uuids.length - 1], flags.some((f) => f)];
  // "last" is safe because uuids cannot be empty because names cannot be empty.
}

/** Create a new entity */
export function mkEntity<V, W>(ctx: ModelEditCtx<V, W>, value: V): Entity<V> {
  const newId = mkModelId(ctx);
  return addEntity(ctx, (parent) => Entity<V>(
    newId,
    parent,
    M.empty(),
    value,
    M.empty(),
    thisChange(),
    thisChange(),
  ));
}

/**
 * Returns the current Entity and any children as a Tree of Entities which
 * can be traversed. Fails at the root.
 */
export function modelPackageTree<V, W>(ctx: ModelEditCtx<V, W>): Maybe<Tree<Entity<V>>> {
  const cur = current(ctx);
  if (cur.tag === "Nothing") return Nothing;
  return Just(Node(cur.value, modelPackageForest(ctx)));
}

/**
 * Returns the children of the current entity as a forest. Does not return the current
 * entity, but this means it succeeds at the root.
 */
export function modelPackageForest<V, W>(ctx: ModelEditCtx<V, W>): Tree<Entity<V>>[] {
  const cs = M.elems(currentChildren(ctx));  // Get the ModelIds of the children.
  return cs.map((child) => fromHere(ctx, (c) => {
    moveDown(c, () => child);  // We already have the child ModelId: don't get it again.
    const t = modelPackageTree(c);
    if (t.tag === "Just") return t.value;
    return throwInternal("modelPackageForest: child not found.");
  }));
}

/**
 * Executes the argument, and then returns to the original location if that still exists. If
 * not then it moves up to the first ancestor that does still exist. If the subtree has been moved
 * then the location will follow it.
 */
export function fromHere<V, W, A>(ctx: ModelEditCtx<V, W>, action: ModelEdit<V, W, A>): A {
  const land = (uuids: readonly ModelId[]): void => {
    for (const uuid of uuids) {
      const r = try_(ctx, (c) => goToEntity(c, uuid));
      if (r.tag === "Right") return;
    }
    goToRoot(ctx);
  };
  const uuids = currentPath(ctx).map((e) => e.entityId);
  const v = action(ctx);
  land(uuids);
  return v;
}

/**
 * Deletes the current Entity and any children, and moves up to the current parent. At
 * the root it deletes the whole model.
 */
export function delete_<V, W>(ctx: ModelEditCtx<V, W>): void {
  const cls = ctx.cls;
  // Remove entity from model contents and relations
  const clearEntity = (ent: Entity<V>): void => {
    const oldId = ent.entityId;
    const oldRelations = S.toList(S.map((p: [ModelId, NR.Relation]) => p[0], queryRelations(ctx, (r) => NR.relations(oldId, r))));
    for (const u of oldRelations) recordModified(ctx, u);
    modifyRelations(ctx, (r) => NR.deleteAll(oldId, r));
    const ms = ctx.state;
    const m1 = ms.stateModel;
    const m2: Model<V> = { ...m1, modelContents: M.delete_(oldId, m1.modelContents) };
    ctx.state = { ...ms, stateModel: m2 };
  };
  // Remove the current entity and all its children from the model contents and relations.
  const clearTree = (e: Entity<V>): void => {
    const targets = modelPackageForest(ctx).flatMap((t) => flatten(t));
    for (const t of targets) clearEntity(t);
    clearEntity(e);
  };
  // Remove a name from the specified package.
  const clearName = (nm: Name, ent1: Entity<V>): void => {
    const ent2 = set(entityChildren<V>().dot(at<Name, ModelId>(nm)), Nothing, ent1);
    const ms = ctx.state;
    const m1 = ms.stateModel;
    const m2: Model<V> = { ...m1, modelContents: M.insert(ent2.entityId, ent2, m1.modelContents) };
    ctx.state = { ...ms, stateModel: m2 };
  };
  // Modify the model root with 'f'.
  const modifyRoot = (f: (r: M.Map<Name, ModelId>) => M.Map<Name, ModelId>): void => {
    const ms = ctx.state;
    const m1 = ms.stateModel;
    ctx.state = { ...ms, stateModel: { ...m1, modelRoot: f(m1.modelRoot) } };
  };

  const mName = getModelName(ctx);
  const m = getModel(ctx);
  const p = currentPath(ctx);
  const oldId = currentId(ctx);
  const oldRelations = S.toList(S.map((x: [ModelId, NR.Relation]) => x[0], queryRelations(ctx, (r) => NR.relations(oldId, r))));
  modifyRelations(ctx, (r) => NR.deleteAll(oldId, r));
  for (const u of oldRelations) recordModified(ctx, u);
  if (p.length === 0) {
    // Delete whole model.
    tellLog(ctx, ModelDelete(U.nil, m));
    ctx.state = { ...ctx.state, stateModel: emptyModel(cls, mName) };
  } else if (p.length === 1) {
    // Delete one entry in root.
    const ent = p[0];
    tellLog(ctx, ModelDelete(ent.entityId, m));
    clearTree(ent);
    modifyRoot((r) => M.delete_(view(entityName(cls), ent), r));
    goToRoot(ctx);
  } else {
    // Delete 'ent' from 'parent'
    const ent = p[0];
    const parent = p[1];
    tellLog(ctx, ModelDelete(ent.entityId, m));
    clearTree(ent);
    clearName(view(entityName(cls), ent), parent);
    goToEntity(ctx, parent.entityId);
  }
}
export { delete_ as delete };

/** Find a possible new name for a child of entity by appending digits to the base name. */
export function modelNewName<V, W>(ctx: ModelEditCtx<V, W>, base: Name): Name {
  const baseTxt = view(nameText, base);
  const taken = currentChildren(ctx);
  for (let x = 1; ; x++) {
    const candidate = Name(baseTxt + String(x));
    if (!M.member(candidate, taken)) return candidate;
  }
  // head is safe because candidates is an infinite list and they can't all be taken.
}

/**
 * Private function to replace an old version of the entity in the model with a new one.
 * Note that this changes the argument entity (following its ModelId), not the current one. It
 * also does not check for a change of name, so this is unsafe.
 */
function modelModify<V, W>(ctx: ModelEditCtx<V, W>, e: Entity<V>): void {
  const ms = ctx.state;
  const model = ms.stateModel;
  const uuid = e.entityId;
  if (M.member(uuid, model.modelContents)) {
    ctx.state = { ...ms, stateModel: { ...model, modelContents: M.insert(uuid, e, model.modelContents) } };
  } else {
    throwUser(view(entityName(ctx.cls).dot(nameText), e) + " not in model.");
  }
}

/**
 * Rename the current entity. It is an error if a sibling of the same name already exists.
 * Renaming the root renames the model. The modification stamp is set unless the old name is the
 * same as the new name. Returns @True@ if the new name is different.
 */
export function renameEntity<V, W>(ctx: ModelEditCtx<V, W>, newName: Name): boolean {
  const cls = ctx.cls;
  const newName1 = over(nameText, T.strip, newName);
  const oldName = Name(currentName(ctx));
  if (eq_Name(oldName, newName1)) return false;
  const path = currentPath(ctx);
  const m1 = getModel(ctx);
  if (path.length === 0) {
    const tn = newName1._0;
    setModelName(ctx, tn);
    const m2 = getModel(ctx);
    tellLog(ctx, ModelRename(U.nil, m1, m2));
    return true;
  }
  const [e, ...parents] = path;
  const sibs = fromHere(ctx, (c) => {
    moveUp(c);
    return currentChildren(c);
  });
  const newEntity = set(entityName(cls), newName1, e);
  const uuid = e.entityId;
  const newSibs = M.insert(newName1, uuid, M.delete_(oldName, sibs));
  if (M.member(newName1, sibs) && !eq_Name(newName1, oldName)) {
    throwUser(view(nameText, newName1) + " already exists.");
  }
  modelModify(ctx, newEntity);
  if (parents.length === 0) {
    // Parent is root.
    const ms = ctx.state;
    const model = ms.stateModel;
    ctx.state = { ...ms, stateModel: { ...model, modelRoot: newSibs } };
  } else {
    // Parent is not root
    const parent = parents[0];
    modelModify(ctx, set(entityChildren<V>(), newSibs, parent));
  }
  currentIsModified(ctx);
  const m2 = getModel(ctx);
  tellLog(ctx, ModelRename(e.entityId, m1, m2));
  return true;
}

/**
 * Modify the value of the current entity, if it has a value of type @w@.
 * Returns @True@ if the new value is different from the old.
 */
export function modifyValue<V, W>(ctx: ModelEditCtx<V, W>, f: (w: W) => W): boolean {
  const cur = current(ctx);
  if (cur.tag === "Nothing") return false;
  const e: Entity<V> = cur.value;
  return usingTraversal(ctx, (c, prsm) => {
    const nameL = entityName(c.cls);
    const old = preview(entityContents<V>().dot(prsm), e);
    if (old.tag === "Nothing") return false;
    const oldVal = old.value;
    const newVal = f(oldVal);
    const newEnt = over(nameL.dot(nameText), T.strip, set(entityContents<V>().dot(prsm), newVal, e));
    if (equals(newEnt._entityContents, e._entityContents)) return false;
    if (!equals(view(nameL, newEnt), view(nameL, e))) renameEntity(c, view(nameL, newEnt));
    modelModify(c, newEnt);
    currentIsModified(c);
    return true;
  });
}

/**
 * Set the value of the current entity, if it currently has a value of type @w@.
 * If there is no value of type @w@ then nothing happens.
 *
 * Returns @True@ if the new value is different.
 */
export function setValue<V, W>(ctx: ModelEditCtx<V, W>, w: W): boolean {
  return modifyValue(ctx, () => w);
}

/**
 * Move the current entity to be a child of the argument.
 * It is an error if an entity of the same name already exists at the target. After the move
 * the current entity is the same as before, but at its new location. Timestamps are not modified.
 */
export function moveEntity<V, W>(ctx: ModelEditCtx<V, W>, dest: ModelId): void {
  const cls = ctx.cls;
  const unlink = (ent: Entity<V>): void => {
    const path = currentPath(ctx);
    if (path.length === 0) {
      throwInternal("moveEntity: empty path cannot happen.");
      // currentEntity not Nothing
    } else if (path.length === 1) {
      // Entity is at root: remove it from there.
      const ms = ctx.state;
      const model = ms.stateModel;
      ctx.state = { ...ms, stateModel: { ...model, modelRoot: M.delete_(view(entityName(cls), ent), model.modelRoot) } };
    } else {
      // Remove entity from parent.
      const parent = path[1];
      modelModify(ctx, set(entityChildren<V>().dot(at<Name, ModelId>(view(entityName(cls), ent))), Nothing, parent));
    }
  };
  const relink = (ent: Entity<V>): void => {
    const path = currentPath(ctx);
    const entContents = ent._entityContents;
    const ms = ctx.state;
    const model = ms.stateModel;
    const eName = view(entityName(cls), ent);
    if (path.length === 0) {
      // New parent is root.
      const newRoot = M.insert(eName, ent.entityId, model.modelRoot);
      const newContents = set(ix<ModelId, Entity<V>>(ent.entityId).dot(entityParent<V>()), dest, model.modelContents);
      if (!cls.entityCanHaveChild(review(cls._Package, Package<V>(Name(""), cls.packageMetaMempty)), entContents)) {
        throwUser("Model root cannot have " + view(nameText, eName) + " as a child.");
      }
      if (M.member(eName, model.modelRoot)) {
        throwUser(view(nameText, eName) + " already exists at the destination.");
      }
      ctx.state = {
        ...ms,
        stateModel: { ...model, modelRoot: newRoot, modelContents: newContents },
        statePosition: ent.entityId,
      };
    } else {
      const newParent = path[0];
      const nm = view(nameText, eName);
      const newContents =
        set(ix<ModelId, Entity<V>>(ent.entityId).dot(entityParent<V>()), dest,
          set(ix<ModelId, Entity<V>>(newParent.entityId).dot(entityChildren<V>()).dot(at<Name, ModelId>(eName)),
            Just(ent.entityId),
            model.modelContents));
      if (M.member(eName, newParent._entityChildren)) {
        throwUser(nm + " already exists at the destination.");
      }
      if (!cls.entityCanHaveChild(newParent._entityContents, entContents)) {
        throwUser("Destination cannot have " + nm + " as a child.");
      }
      ctx.state = {
        ...ms,
        stateModel: { ...model, modelContents: newContents },
        statePosition: ent.entityId,
      };
    }
  };

  const newPath = fromHere(ctx, (c) => {
    goToEntity(c, dest);
    return currentPath(c);
  }).map((e) => e.entityId);
  const cur = current(ctx);
  if (cur.tag === "Nothing") {
    throwUser("Cannot move the model root.");
  } else {
    const ent = cur.value;
    if (newPath.includes(ent.entityId)) throwUser("Cannot move an entity inside itself.");
    const before = getModel(ctx);
    unlink(ent);
    goToEntity(ctx, dest);
    relink(ent);
    goToEntity(ctx, ent.entityId);
    const after = getModel(ctx);
    tellLog(ctx, ModelMove(ent.entityId, before, after));
  }
}

/**
 * Verify that the model is consistent:
 *
 * * Package tree and contents contain the same set of ModelIds.
 *
 * * Every node is the child of its parent.
 *
 * * Content keys match value identities.
 *
 * * Package tree ModelIds contain no duplicates.
 *
 * * The directories in each package refer to entities with the same names and ModelIds.
 *
 * * Relations are internally consistent.
 *
 * * Relations contain a subset of content ModelIds.
 *
 * If a problem is found then a helpful internal error message will be produced,
 * but this should never happen. If there is no error then this is a no-op.
 */
export function checkModel<V, W>(ctx: ModelEditCtx<V, W>): void {
  const cls = ctx.cls;
  const nameL = entityName(cls);
  const nameOf = (e: Entity<V>): string => view(nameL.dot(nameText), e);
  // Check parent ModelIds match.
  const checkParent = (p: Entity<V>, node: Tree<Entity<V>>): void => {
    const e = node.rootLabel;
    if (p.entityId !== e._entityParent) {
      throwInternal("Element not a child of its parent: \"" + nameOf(e) + "\"");
    }
    if (!cls.entityCanHaveChild(p._entityContents, e._entityContents)) {
      throwInternal("Element \"" + nameOf(p) + "\" has illegitimate child " + nameOf(e) + "\"");
    }
    for (const c of node.subForest) checkParent(e, c);
  };
  // Check key ModelIds match package ModelIds
  const contentConsistent = ([u, v]: [ModelId, Entity<V>]): void => {
    if (u !== v.entityId) {
      throwInternal("Content ModelIds inconsistent: " + U.toText(u) + " -> " + U.toText(v.entityId));
    }
  };
  // Recursively descend the tree, checking children for consistent name and ModelId.
  const checkPackages = (contents: M.Map<ModelId, Entity<V>>, table: M.Map<Name, ModelId>): void => {
    for (const [key, uuid] of M.toList(table)) {
      const r = M.lookup(uuid, contents);
      if (r.tag === "Nothing") {
        throwInternal("\"" + view(nameText, key) + "\" refers to a nonexistent entity.");
      } else {
        const ent = r.value;
        if (!eq_Name(key, view(nameL, ent))) {
          throwInternal("\"" + view(nameText, key) + "\" refers to \"" + nameOf(ent) + "\"");
        }
        if (uuid !== ent.entityId) {
          throwInternal("\"" + view(nameText, key) + "\" refers to entity with wrong ModelId.");
          // This is a redundant check, but keep anyway.
        }
        checkPackages(contents, ent._entityChildren);
      }
    }
  };
  const rootAsEntity = (m: Model<V>): Entity<V> => Entity<V>(
    U.nil,
    U.nil,
    m.modelRoot,
    review(cls._Package, Package<V>(Name(m.modelName), cls.packageMetaMempty)),
    M.empty(),
    thisChange(),
    thisChange(),
  );

  fromHere(ctx, (c) => {
    goToRoot(c);
    const forest = modelPackageForest(c);
      // Safe because we are on base type.
    const model = c.state.stateModel;
    const rootList = forest.flatMap((t) => flatten(t)).map((e) => e.entityId);
    const rootSet = S.fromList(rootList);
    const contentList = M.toList(model.modelContents);
    const contentSet = S.fromList(contentList.map(([k]) => k));
    const relationSet = S.fromList(
      NR.toList(model.modelRelations).flatMap(([k, rs]) => [k, ...rs.map((r) => r[0])]),
    );
    // Package tree and contents contain the same set of ModelIds.
    if (!equals(rootSet, contentSet)) throwInternal("package tree /= model contents");
    // Every node is the child of its parent.
    const root = rootAsEntity(model);
    for (const t of forest) checkParent(root, t);
    // Package content table keys are consistent with corresponding entities.
    for (const kv of contentList) contentConsistent(kv);

    // If rootList contains duplicates then these will be eliminated in the set and hence
    // show up as a difference in the sizes.
    if (S.size(rootSet) !== rootList.length) {
      throwInternal("Package tree contains duplicate entries.");
    }

    // Directories in each package refer to entities with the same names and ModelIds.
    // Strictly speaking the ModelId check is redundant because contentConsistent has
    // already checked that, but it is kept here due to an abundance of caution.
    checkPackages(model.modelContents, model.modelRoot);

    const chk = NR.check(model.modelRelations);
    if (chk.tag === "Left") throwInternal(chk.value);

    // Relations contain a subset of content ModelIds.
    if (!S.isSubsetOf(relationSet, contentSet)) {
      throwInternal("Relations are not a subset of contents.");
    }
  });
}

// -----------------------------------------------------------
// JSON Utility
// -----------------------------------------------------------

/** Check that the @\"type\"@ field in the JSON is correct. */
export function checkType(ob: J.JSONObject, txt: string): void {
  const typ = J.field(ob, "type", J.textJ);
  if (typ !== txt) J.fail("Type = " + T.showText(typ) + ", expected " + T.showText(txt));
}
