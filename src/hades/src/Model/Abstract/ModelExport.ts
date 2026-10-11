// Ported from hades/src/Model/Abstract/ModelExport.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Functions for exporting and importing parts of models.
 *
 * There are two kinds of thing that can be exported:
 *
 * * Metadata for data extensions and references.
 *
 * * Subsets of the entities in a model, along with their relationships.
 *
 * TypeScript port
 * ---------------
 * * `newtype ExportList v = ExportList [Entity v]` derives its instances (and its JSON is that of
 *   the list), so it is erased to `readonly Entity<V>[]`; `ExportList(vs)` is the identity and
 *   `append_ExportList`/`mempty_ExportList`/`mconcat_ExportList` are list concatenation.
 * * The JSON codecs take the `EntityClass` dictionary, whose `entityJ` member is the codec of
 *   `v`: `JSON_ExportList(cls)` and `JSON_ModelExport(cls)`.
 * * `ModelEdit` functions take the `ModelEditCtx` first (PORTING.md §7.4).
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import { identity, set } from "@/lib/Control/Lens";
import { flatten, type Tree } from "@/lib/Data/Tree";
import type { NamedRelation } from "@/hades/src/Model/Reflection/NamedRelation";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { JSON_RefTypeTable, RefTypeTable, mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { type FieldId, type FieldTable, JSON_Field } from "@/hades/src/Model/Reflection/Types";
import { type Variant, JSONKey_Variant } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type EntityClass, type Model, type ModelEdit, type ModelEditCtx, type ModelId,
  JSON_Entity, addCheckedRelation, addEntity, checkModel, current, delete_, emptyModel,
  entityChildren, entityParent, evalModelEdit, fromHere, getModel, goToEntity, goToRoot,
  modelPackageForest, modelPackageTree, setModel, show_ModelError, throwUser, try_, withBaseType,
} from "./PackageTree";

/**
 * A list of entities which has been flattened so that all parents are either in the
 * list or set to "U.nil"
 */
export type ExportList<V> = readonly Entity<V>[];
/** The `ExportList` newtype constructor (identity). */
export function ExportList<V>(vs: readonly Entity<V>[]): ExportList<V> {
  return vs;
}

/** `deriving Semigroup` of `ExportList` */
export function append_ExportList<V>(a: ExportList<V>, b: ExportList<V>): ExportList<V> {
  return [...a, ...b];
}
/** `deriving Monoid` of `ExportList` */
export const mempty_ExportList: ExportList<any> = [];
/** `mconcat` for `ExportList` */
export function mconcat_ExportList<V>(xs: readonly ExportList<V>[]): ExportList<V> {
  return L.concat(xs);
}

/**
 * `instance (ToJSON v) => ToJSON (ExportList v)` and
 * `instance (FromJSON v, EntityClass v) => FromJSON (ExportList v)`: the JSON list of entities.
 */
export function JSON_ExportList<V>(cls: EntityClass<V>): J.JSONCodec<ExportList<V>> {
  const c = J.listJ(JSON_Entity(cls));
  return J.codec(
    (vs) => c.toJSON(vs as Entity<V>[]),
    (v) => ExportList(c.parseJSON(v)),
  );
}

/** Exported data on its way to or from serialization. */
export interface ModelExport<V> {
  readonly exportContents: ExportList<V>;
  readonly exportRelations: NamedRelation<ModelId>;
  readonly exportFields: FieldTable;
  readonly exportRefTypes: RefTypeTable<V>;
  readonly exportExtensions: M.Map<Variant<V>, readonly FieldId[]>;
}
export function ModelExport<V>(
  exportContents: ExportList<V>,
  exportRelations: NamedRelation<ModelId>,
  exportFields: FieldTable,
  exportRefTypes: RefTypeTable<V>,
  exportExtensions: M.Map<Variant<V>, readonly FieldId[]>,
): ModelExport<V> {
  return { exportContents, exportRelations, exportFields, exportRefTypes, exportExtensions };
}

const relationsJ = NR.JSON_NamedRelation(J.uuidJ);
const fieldTableJ: J.JSONCodec<FieldTable> = J.mapJ(J.uuidKey, JSON_Field);
const extensionsJ: J.JSONCodec<M.Map<Variant<any>, FieldId[]>> = J.mapJ(JSONKey_Variant, J.listJ(J.uuidJ));

/**
 * `instance (ToJSON v) => ToJSON (ModelExport v)` and
 * `instance (FromJSON v, EntityClass v) => FromJSON (ModelExport v)`.
 */
export function JSON_ModelExport<V>(cls: EntityClass<V>): J.JSONCodec<ModelExport<V>> {
  const contentsJ = JSON_ExportList(cls);
  return J.codec(
    (v) => J.object([
      ["exportContents", contentsJ.toJSON(v.exportContents)],
      ["exportRelations", relationsJ.toJSON(v.exportRelations)],
      ["exportFields", fieldTableJ.toJSON(v.exportFields)],
      ["exportRefTypes", JSON_RefTypeTable.toJSON(v.exportRefTypes)],
      ["exportExtensions", extensionsJ.toJSON(v.exportExtensions as M.Map<Variant<any>, FieldId[]>)],
    ]),
    (v) => J.withObject("Model Export", (o) => ModelExport<V>(
      J.field(o, "exportContents", contentsJ),
      J.field(o, "exportRelations", relationsJ),
      J.field(o, "exportFields", fieldTableJ),
      J.field(o, "exportRefTypes", JSON_RefTypeTable) as RefTypeTable<V>,
      J.field(o, "exportExtensions", extensionsJ),
    ), v),
  );
}

/**
 * Create an export of part of the model.
 *
 * @param items Entities in the model to be exported. "U.nil" means everything.
 * @param metadata True if metadata is to be exported as well.
 */
export function makeExport<V, W>(ctx: ModelEditCtx<V, W>, items: S.Set<ModelId>, metadata: boolean): ModelExport<V> {
  const model = getModel(ctx);
  const trees: Tree<Entity<V>>[][] = S.toList(items).map((mId) => {
    goToEntity(ctx, mId);
    const t = modelPackageTree(ctx);
    return t.tag === "Nothing" ? [...modelPackageForest(ctx)] : [t.value];
  });
  const [rels, exports] =
    exportEntities(model.modelRelations, mconcat_ExportList(L.concat(trees).map(exportTree)));
  return metadata
    ? ModelExport<V>(exports, rels, model.modelFields, model.modelRefTypes, model.modelExtensions)
    : ModelExport<V>(exports, rels, M.empty(), mempty_RefTypeTable as RefTypeTable<V>, M.empty());
}

/**
 * Marshall a tree of entities into a list. The root entity is given a parent of "U.nil" because
 * it's parent isn't being exported.
 */
export function exportTree<V>(t: Tree<Entity<V>>): ExportList<V> {
  const fixedRoot = set(entityParent<V>(), U.nil, t.rootLabel);
  return ExportList([fixedRoot, ...L.concatMap(flatten, t.subForest)]);
}

/**
 * Locates all relations between items in the export list. Also removes duplicates in the
 * export list. If an item occurs twice, once with a parent and once without, the version with a
 * parent will be preferred.
 */
export function exportEntities<V>(
  nr: NamedRelation<ModelId>,
  vs: ExportList<V>,
): [NamedRelation<ModelId>, ExportList<V>] {
  const mkPair = (ent: Entity<V>): [ModelId, Entity<V>] => [ent.entityId, ent];
  const preferParented = (ent1: Entity<V>, ent2: Entity<V>): Entity<V> =>
    U.isNil(ent1._entityParent) ? ent2 : ent1;
  const entityTable = M.fromListWith(preferParented, vs.map(mkPair));
  const filterPair = <A>(xs: readonly (readonly [ModelId, A])[]): [ModelId, A][] =>
    xs.filter(([k]) => M.member(k, entityTable)).map(([k, a]): [ModelId, A] => [k, a]);
  const filterRelations = (r: NamedRelation<ModelId>): NamedRelation<ModelId> =>
    NR.fromList(filterPair(NR.toList(r)).map(([k, rs]): [ModelId, [ModelId, NR.Relation][]] => [k, filterPair(rs)]));
  return [filterRelations(nr), ExportList(M.elems(entityTable))];
}

/**
 * The converse of "exportEntities". This will overwrite any entity in the model with the same
 * ID.
 *
 * Relationships after the import are a union of the old and the new, except that where
 * the relation type has a \"1\" end the new relationship will replace the old.
 *
 * @param location New parent for the imported entities.
 */
export function importEntities<V, W>(
  ctx: ModelEditCtx<V, W>,
  location: ModelId,
  nr: NamedRelation<ModelId>,
  vs: ExportList<V>,
): void {
  const cls = ctx.cls;
  // Assemble the imported entities into a temporary model.
  // This is necessary so that the "tellLog" calls occur in a top-down order and hence can
  // be applied to the GUI tree.
  const mkRawModel = (c: ModelEditCtx<V, V>): Model<V> => {
    for (const ent of vs) {
      if (U.isNil(ent._entityParent)) {
        goToRoot(c);
        addEntity(c, (_p) => ent);
      } else {
        const m = getModel(c);
        setModel(c, { ...m, modelContents: M.insert(ent.entityId, ent, m.modelContents) });
      }
    }
    return getModel(c);
  };
  // Traverse the package tree in this model and return an action to copy that tree into
  // some other model in a top-down order.
  const importFromModel = (c: ModelEditCtx<V, V>): ModelEdit<V, V, void> => {
    goToRoot(c);
    const forest = modelPackageForest(c);
    return (c2) => {
      for (const t of forest) insertTree(c2, t);
    };
  };
  const insertTree = (c: ModelEditCtx<V, V>, t: Tree<Entity<V>>): void => fromHere(c, (c1) => {
    // Children will be automatically re-added by "addEntity" so insert without them.
    const ent2 = set(entityChildren<V>(), M.empty(), t.rootLabel);
    // Delete any existing version of the imported entity.
    fromHere(c1, (c2) => {
      const r = try_(c2, (c3) => goToEntity(c3, ent2.entityId));
      if (r.tag === "Right") delete_(c2);
    });
    // Add the entity and any children.
    addEntity(c1, (p) => set(entityParent<V>(), p, ent2));
    goToEntity(c1, ent2.entityId);
    for (const sub of t.subForest) insertTree(c1, sub);
  });
  // Main routine for this function.
  const go = (c: ModelEditCtx<V, V>): void => {
    const importAction = evalModelEdit(cls, identity<V>(), emptyModel(cls, ""), (c1) => {
      mkRawModel(c1);
      return importFromModel(c1);
    });
    if (importAction.tag === "Left") throwUser(c, show_ModelError(importAction.value));
    else importAction.value(c);
    for (const [id1, rs] of NR.toList(nr)) {
      for (const [id2, relName] of rs) {
        goToEntity(c, id1);
        const ent1 = current(c);
        goToEntity(c, id2);
        const ent2 = current(c);
        if (ent1.tag === "Just" && ent2.tag === "Just") addCheckedRelation(c, relName, ent1.value, ent2.value);
      }
    }
    checkModel(c);
  };
  withBaseType(ctx, (c) => {
    checkModel(c);
    goToEntity(c, location);
    const r = try_(c, go);
    if (r.tag === "Left") {
      throwUser(c, "Error found during import. Rolling back.\n\n" + T.showText(r.value));
    }
  });
}

/** Merge the metadata in the export into the model. */
export function importMetadata<V, W>(ctx: ModelEditCtx<V, W>, import1: ModelExport<V>): void {
  const combineExts = (es1: readonly FieldId[], es2: readonly FieldId[]): FieldId[] => L.nub([...es1, ...es2]);
  const m = getModel(ctx);
  const newFields = M.union(import1.exportFields, m.modelFields);
  const oldRefs = m.modelRefTypes._0;
  const importRefs = import1.exportRefTypes._0;
  const newRefs = RefTypeTable(M.union(importRefs, oldRefs));
  const newExts = M.unionWith(combineExts, m.modelExtensions, import1.exportExtensions);
  setModel(ctx, { ...m, modelFields: newFields, modelRefTypes: newRefs, modelExtensions: newExts });
}
