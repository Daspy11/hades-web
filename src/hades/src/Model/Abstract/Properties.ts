// Ported from hades/src/Model/Abstract/Properties.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Entity property dialogs and entity selection gadgets.
 *
 * TypeScript port
 * ---------------
 * * Constrained functions take the `EntityClass` dictionary first: `refPicker(cls, ...)`,
 *   `reflectiveDialog(cls, menuF)`, `modelFilter(cls, predicate, model)`,
 *   `modelItemSpecifier(cls, predicate, menuF)`, `modelSubsetSpecifier(cls, predicate, menuF)`,
 *   `showEntitySet(cls, model, s)`. "putReferenceValues" is a `ModelEdit` and takes the
 *   `ModelEditCtx` first.
 * * "reflectiveDialog" returns an (uncurried) `DialogSelector`: `reflectiveDialog(cls, menuF)`
 *   is the Haskell `reflectiveDialog menuF`.
 * * The predicates of "modelItemSpecifier" and "modelSubsetSpecifier" stay curried
 *   (`(model) => (entity) => boolean`) because the documented optimisation relies on partial
 *   application to the model.
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as L from "@/lib/Data/List";
import * as T from "@/lib/Data/Text";
import { Just, Nothing, type Maybe, catMaybes, listToMaybe, mapMaybe } from "@/lib/Data/Maybe";
import { formatDay } from "@/lib/Data/Time";
import { Node, fmapTree, type Forest } from "@/lib/Data/Tree";
import { _1, _2, _Just, identity, lens, view, type Lens } from "@/lib/Control/Lens";
import {
  ClickableItem, Dialog, OkApplyButton, OkButton, accum, arr, box, clickableList, focusing, form,
  frame, gFirst, gId, gPipe, gDot, getInitialEnv, intercept, message, send, traversingOver,
  treeSelector, validate,
  type Dialog_, type DialogSelector_, type Gadget_, type GadgetF_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { fieldElement1 } from "@/hades/src/Model/Reflection/Dialogs";
import type { NamedRelation, Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { reflection, valueReferences } from "@/hades/src/Model/Reflection/Reflective";
import { type FieldId, withBuiltIn } from "@/hades/src/Model/Reflection/Types";
import { type ExtValue, type ExtensionValues, type Variant, displayValue } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId, type Stamp,
  addCheckedRelation, current, descriptionField, entityName, entityProperties, evalModelEdit,
  fromHere, goToEntity, modelPackageForest, modifyRelations, nameText,
} from "./PackageTree";

// ---------------------------------------------------------------------------------------------
// * Property Dialog

/** The ModelIds of entities linked to this one by references. */
export type ReferenceValues = M.Map<Relation, S.Set<ModelId>>;

/** A map of the sets of entities cross-referenced with the argument, keyed by relationship name. */
export function getReferenceValues(uuid: ModelId, rels: NamedRelation<ModelId>): ReferenceValues {
  return S.foldr(
    ([u, r]: [ModelId, Relation], acc: ReferenceValues) =>
      M.unionWith(S.union, M.singleton(r, S.singleton(u)), acc),
    M.empty<Relation, S.Set<ModelId>>(),
    NR.relations(uuid, rels),
  );
}

/** Set the cross-references for the ModelId in the model to the contents of the reference values. */
export function putReferenceValues<V, W>(ctx: ModelEditCtx<V, W>, e: Entity<V>, refs: ReferenceValues): void {
  fromHere(ctx, (c) => {
    modifyRelations(c, (r) => NR.deleteAll(e.entityId, r));
    for (const [rel, s] of M.toList(refs)) {
      const es = catMaybes(S.toList(s).map((u) => {
        goToEntity(c, u);
        return current(c);
      }));
      for (const e2 of es) addCheckedRelation(c, rel, e, e2);
    }
  });
}

/** Compares the two sets of reference values and returns a list of those that have changed. */
export function compareReferenceValues(refs1: ReferenceValues, refs2: ReferenceValues): ModelId[] {
  const added = M.unionWith(S.difference, refs2, refs1); // In refs2 but not refs1
  const deleted = M.unionWith(S.difference, refs1, refs2); // In refs1 but not refs2
  const allChanges = M.unionWith(S.union, added, deleted);
  return S.toList(M.foldr(S.union, S.empty<ModelId>(), allChanges));
}

// ---------------------------------------------------------------------------------------------
// * Entity Selection Dialog

/**
 * A dialog for picking elements from a model, with the choice restricted by a predicate.
 *
 * @param singleFlag If true then only one item may be picked.
 * @param predicate Only entities that satisfy this can be picked.
 */
export function refPicker<V, W = any>(
  cls: EntityClass<V>,
  singleFlag: boolean,
  predicate: (e: Entity<V>) => boolean,
): Dialog_<Model<V>, W, S.Set<ModelId>> {
  const title = singleFlag ? "Single Selector" : "Multi Selector";
  const label = singleFlag ? "Selected entity: " : "Selected entities: ";
  return Dialog(title, OkButton,
    validate((s: S.Set<ModelId>) => !singleFlag || S.size(s) <= 1,
      frame((_: S.Set<ModelId>) => Just(label),
        treeSelector<Model<V>, W, ModelId>((model) => modelFilter(cls, predicate, model)))));
}

/**
 * Attempts to compile the reflection data within the model into a dialog selector.
 *
 * @param menuF Menus for referenced entities.
 */
export function reflectiveDialog<V, W>(
  cls: EntityClass<V>,
  menuF: (e: Entity<V>) => Maybe<Menu<W>>,
): DialogSelector_<Model<V>, W, Maybe<readonly [Entity<V>, ReferenceValues]>> {
  type Sel = Maybe<readonly [Entity<V>, ReferenceValues]>;
  return (model: Model<V>, sel: Sel) => {
    if (sel.tag === "Nothing") return Just(Dialog("Nothing selected", OkApplyButton, gId<Model<V>, W, Sel>()));
    const ent = sel.value[0];
    const extension = (v: Variant<V>): readonly FieldId[] => M.findWithDefault([], v, model.modelExtensions);
    const fields = mapMaybe(
      (f: FieldId) => M.lookup(f, withBuiltIn(model.modelFields)),
      reflection(cls, extension, ent._entityContents),
    );
    const refs = valueReferences(cls, model.modelRefTypes, ent._entityContents);
    // Reference lookup as a lens with the empty set as the default value.
    const relLens = (k: Relation): Lens<ReferenceValues, S.Set<ModelId>> => lens(
      (s: ReferenceValues) => M.findWithDefault(S.empty<ModelId>(), k, s),
      (s: ReferenceValues, v: S.Set<ModelId>) => (S.isNull(v) ? M.delete_(k, s) : M.insert(k, v, s)),
    );
    const refElement = (
      [nm, single, variants]: [Relation, boolean, S.Set<Variant<V>>],
    ): [T.Text, GadgetF_<Model<V>, W, ReferenceValues>] => {
      const vFilter = (e: Entity<V>): boolean => S.member(cls.reflectiveName(e._entityContents), variants);
      const g = focusing(relLens(nm),
        modelSubsetSpecifier1<V, W>(cls, single, (_: Model<V>) => vFilter, menuF));
      // Use traversing because we don't create an entity if none exists.
      return [nm, g];
    };
    const fieldsFrame: GadgetF_<Model<V>, W, Sel> =
      frame((_: Sel) => Just("Fields"),
        traversingOver(
          M.empty<FieldId, ExtValue>(),
          _Just<readonly [Entity<V>, ReferenceValues]>()
            .dot(_1<Entity<V>, ReferenceValues>())
            .dot(entityProperties(cls)),
          form<Model<V>, W, ExtensionValues>("Vertical",
            fields.map((f) => fieldElement1<Model<V>, W>(true, f)))));
      // Use traversingOver because we don't create an entity if none exists.
    const referencesFrame: GadgetF_<Model<V>, W, Sel> =
      frame((_: Sel) => Just("References"),
        traversingOver(
          M.empty<Relation, S.Set<ModelId>>(),
          _Just<readonly [Entity<V>, ReferenceValues]>().dot(_2<Entity<V>, ReferenceValues>()),
          form<Model<V>, W, ReferenceValues>("Vertical", refs.map(refElement))));
    const showDate = (day: string): T.Text => T.pack(formatDay("%d %b %y", day));
    const stampMessage = (msg: T.Text, [user, day]: Stamp): T.Text =>
      msg + showDate(day) + " by " + user + ".";
    const stampsMessage: GadgetF_<Model<V>, W, Sel> = gDot(
      arr((_: Sel) => (x: Sel) => x),
      message<Model<V>, W, Sel>((_e, s) => {
        if (s.tag === "Nothing") return "Entity deleted.";
        const e = s.value[0];
        return stampMessage("Created: ", e.entityCreated) + "\n" +
          stampMessage("Modified: ", e._entityModified);
      }),
    );
    return Just(Dialog(
      cls.variantUserLabel(cls.reflectiveName(ent._entityContents)) + " properties",
      OkApplyButton,
      accum(box<Model<V>, W, Sel>("Vertical", [[
        ...(L.isNull(fields) ? [] : [fieldsFrame]),
        ...(L.isNull(refs) ? [] : [referencesFrame]),
        stampsMessage,
      ]])),
    ));
  };
}

/** Extract the model tree, filtering out any contents that do not satisfy the predicate. */
export function modelFilter<V>(
  cls: EntityClass<V>,
  predicate: (e: Entity<V>) => boolean,
  model: Model<V>,
): Forest<readonly [T.Text, Maybe<T.Text>, Maybe<ModelId>]> {
  const getTuple = (ent: Entity<V>): readonly [T.Text, Maybe<T.Text>, Maybe<ModelId>] => {
    const nm = view(entityName(cls).dot(nameText), ent);
    const desc = ((): Maybe<T.Text> => { // Maybe monad
      const field = M.lookup(descriptionField, cls.reflectiveGet(ent._entityContents));
      if (field.tag === "Nothing") return Nothing;
      if (!(T.length(displayValue(field.value)) > 0)) return Nothing;
      return listToMaybe(T.splitOn("\n\n", displayValue(field.value)));
    })();
    return predicate(ent) ? [nm, desc, Just(ent.entityId)] : [nm, desc, Nothing];
  };
  const r = evalModelEdit(cls, identity<V>(), model, (c) => modelPackageForest(c));
  switch (r.tag) {
    case "Left": return [Node(["Internal error", Nothing, Nothing] as const, [])]; // Should never happen.
    case "Right": return r.value.map((t) => fmapTree(getTuple, t));
    // fromJust is safe because prism for evalModelEdit was id.
  }
}

/**
 * Displays a single model entity name. On left-click it opens up a dialog to change the
 * selection, limited to those entities that satisfy the predicate.
 *
 * If the initial set contains multiple elements then these will be displayed. However any updates
 * are constrained to be 0 or 1 item.
 *
 * The predicate is called with the model initially, and the result is then called with each
 * entity. Hence if the predicate takes just the model and returns a lambda for its second
 * argument then any evaluaiton which depends only on the model will be executed once.
 *
 * @param predicate Predicate for allowing the entity in the selection.
 * @param menuF Menu for displayed entities.
 */
export function modelItemSpecifier<V, W>(
  cls: EntityClass<V>,
  predicate: (model: Model<V>) => (e: Entity<V>) => boolean,
  menuF: (e: Entity<V>) => Maybe<Menu<W>>,
): Gadget_<Model<V>, W, S.Set<ModelId>> {
  return modelSubsetSpecifier1(cls, true, predicate, menuF);
}

/**
 * Displays a set of model items as a comma-separated list of names. On double-click it opens
 * up a dialog to change the selection restricted to those entities that satisfy the predicate.
 *
 * See note in "modelItemSpecifier" about optimising the predicate.
 *
 * @param predicate Predicate for allowing the entity in the selection.
 * @param menuF Menu for the displayed entities.
 */
export function modelSubsetSpecifier<V, W>(
  cls: EntityClass<V>,
  predicate: (model: Model<V>) => (e: Entity<V>) => boolean,
  menuF: (e: Entity<V>) => Maybe<Menu<W>>,
): Gadget_<Model<V>, W, S.Set<ModelId>> {
  return modelSubsetSpecifier1(cls, false, predicate, menuF);
}

/**
 * General case for model subsets and items. The first argument is @False@ to pick a subset and
 * @True@ to pick a single item.
 *
 * @param predicate Predicate for allowing the entity in the selection.
 * @param menuF Menu for the displayed entities.
 */
function modelSubsetSpecifier1<V, W>(
  cls: EntityClass<V>,
  singleFlag: boolean,
  predicate: (model: Model<V>) => (e: Entity<V>) => boolean,
  menuF: (e: Entity<V>) => Maybe<Menu<W>>,
): Gadget_<Model<V>, W, S.Set<ModelId>> {
  const clickFunc = (ent: Entity<V>): ClickableItem<W> => ClickableItem<W>(
    view(entityName(cls).dot(nameText), ent),
    Nothing,
    Nothing,
    menuF(ent),
  );
  const items = (model: Model<V>) => (s: S.Set<ModelId>): ClickableItem<W>[] =>
    mapMaybe((k: ModelId) => M.lookup(k, model.modelContents), S.toList(s)).map(clickFunc);
  const picker = (model: Model<V>, _: S.Set<ModelId>) => Just(refPicker<V, W>(cls, singleFlag, predicate(model)));
  // proc inSet -> do
  //     _ <- send id <<< clickableList <<< getInitialEnv (arr . items) -< inSet
  //     returnA -< inSet
  const body: Gadget_<Model<V>, W, S.Set<ModelId>> = gPipe(
    arr((inSet: S.Set<ModelId>): [S.Set<ModelId>, S.Set<ModelId>] => [inSet, inSet]),
    gFirst<Model<V>, W, S.Set<ModelId>, Maybe<W>, S.Set<ModelId>>(gPipe(
      getInitialEnv((model: Model<V>) => arr<Model<V>, W, S.Set<ModelId>, readonly ClickableItem<W>[]>(items(model))),
      clickableList<Model<V>, W, W>(),
      send<Model<V>, W, Maybe<W>>((x) => x),
    )),
    arr(([, inSet]: [Maybe<W>, S.Set<ModelId>]) => inSet),
  );
  // memoPopup MemoSmall False showEntitySet picker
  return intercept(false, picker, body);
}

/** Convert a set of Model IDs into a text string. */
export function showEntitySet<V>(cls: EntityClass<V>, model: Model<V>, s: S.Set<ModelId>): T.Text {
  if (S.isNull(s)) return " - ";
  return T.intercalate(", ",
    L.sort(mapMaybe((mId: ModelId) => {
      const e = M.lookup(mId, model.modelContents);
      return e.tag === "Just" ? Just(view(entityName(cls), e.value)) : Nothing;
    }, S.toList(s))).map((n) => view(nameText, n)));
}
