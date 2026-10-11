// Ported from hades/src/Model/Abstract/DiagramType.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Models contain diagrams, and diagrams show the graphical representations of model entities.
 * When a diagram is edited the changes may have to be reflected in the model, and of course the
 * diagram itself needs to be updated in the model. Conversely when entities in the model change
 * the associated diagram elements must be updated accordingly.
 *
 * This circular relationship between models and diagrams is encoded in this module. "DiagramEntity"
 * is used to store a diagram. When a diagram is being edited the "Delta" monad transformer used
 * for diagram editing is applied to the "ModelScript" monad, so edit commands in the diagram have
 * access to the both the model state and the various properties dialogs.
 *
 * When a diagram element is used to represent a model entity, the element is called the \"avatar\"
 * of the entity. A model entity may have multiple avatars of different types in different diagrams.
 * This relationship is described by instances of the "Avatar" class. An instance of @Avatar v d@
 * says that diagram elmenets of type @d@ can optionally represent model entities of type @v@.
 *
 * TypeScript port
 * ---------------
 * * **Type parameters.** `P` is the Haskell @p@ (the paint monad of the diagrams) and is a phantom
 *   type in TypeScript; `V` is the top-level model type, `W` the subtype a script works on, `D`
 *   a diagram element type and `DM` its `DiagramMetadata d`.
 * * **Scripts** (PORTING.md §7.5). `UserScript<P, V, A>` is a generator yielding
 *   `UserScriptFunctor<P, V>` instructions and resumed with each instruction's result
 *   (documented on each constructor). `ModelScript<P, V, A>` is the same type; the
 *   `ModelEdit v w` base monad is the `ModelEditCtx<V, W>` the generator closes over.
 *   A first-class `ModelScript p v w a` is a `ModelScriptAct<P, V, W, A>`
 *   (`(ctx) => generator`); `EntityMenu`, `ActivationScript`, `Editable`, `cloneEntityMenuItem`,
 *   `entityMenu` and `diagramEntityMenu` hold such values. `lift act` is a direct call with the
 *   script's context. The instructions carry no continuation: the suspended generator is the
 *   continuation, so the Haskell `Functor (UserScriptFunctor p v)` instance has no counterpart.
 * * **ScriptMonad.** Delta computations pass script instructions straight through to their
 *   runner (see "Hades.Abstract.Delta"), so a `UserScript` generator can be run with `yield*`
 *   both in a script and in a `Delta` whose base is a `ModelScript`: `liftScript` is the identity
 *   on generators. The functions with a `ScriptMonad` constraint ("openProperties",
 *   "openDialog", "withHint", "goBackToEntity", "insertEntity", ...) therefore take no
 *   dictionary; they take the script's `ModelEditCtx` first and return a `UserScript`
 *   generator. Inside a Delta the context is `d.base` (also available as `scriptContext(d)`):
 *   `liftBase (openDialog sel v)` is `yield* openDialog(d.base, sel, v)` and
 *   `withHint txt yieldViews` is `yield* withHint(d.base, txt, yieldViews(d))`. The class itself
 *   is the `ScriptMonad<Ctx>` interface with instances `ScriptMonad_UserScript` and
 *   `ScriptMonad_Delta`.
 * * **`d.base` changes between input actions.** The diagram editor applies each input action in a
 *   new script, and `applyDelta` points `d.base` at that script's context. Delta code must
 *   therefore read `d.base` again after every `yieldViews` (or other wait for the next action)
 *   instead of keeping it in a variable (see "newBoxAvatarTool"). Script instructions yielded
 *   within one action do not change it.
 * * **Classes.** `HasDiagrams p v` is the dictionary `HasDiagrams<P, V>`, which extends
 *   `EntityClass<V>`; `Editable p v` is `Editable<P, V>`. Functions with these constraints take
 *   the dictionary as their *first* argument, before any `ModelEditCtx`/`DeltaCtx`
 *   (`openDiagram(cls, ctx, mId)`, `clonePackage(cls, ctx, ...)`, `diagramEntityMenu(cls, mId)`,
 *   `avatarShapeMenu(cls, dId)`). The `EntityClass v` dictionary itself is not passed: it is
 *   `ctx.cls` (in a Delta, `d.base.cls`); pure functions take it explicitly (`entityMenu(cls, e)`).
 * * `Avatar p v w d` is the dictionary `Avatar<P, V, W, D, DM>`, which extends `Connectable<D>`.
 *   **The Avatar dictionary must be the `Viewable`/`Connectable` dictionary of the diagram** (the
 *   `cls` given to `startDelta`), because Delta functions with an `Avatar` constraint find it as
 *   `d.cls` (`avatar(d)`), just as "Hades.Abstract.Connections" does with `connectable(d)`. The
 *   associated type `DiagramMetadata d` is the type parameter `DM`. The constraints that some
 *   instances put on it (`Monoid`, `ToJSON`, `FromJSON`) are the separate dictionary
 *   `DiagramMetadataClass<DM>` (members `diagramMetadataJ`, `diagramMetadataMempty`,
 *   `diagramMetadataAppend`); Avatar instances will usually include those members as well, so the
 *   same object can be passed to `JSON_DiagramEntity` and `Reflective_DiagramEntity`. `Eq` is the
 *   structural `equals`.
 * * Constrained Haskell values (`keyCommands`) are zero-argument generic functions; the Dialog
 *   values `packageNameDialog` and `diagramNameDialog` are zero-argument functions too, like the
 *   gadget values of "Reactive.Banana.ArrowDialog". `findTextTool` is a generator function, i.e.
 *   it *is* a `ModelScriptAct`.
 * * `EntityWrapper` is a tagged union. The existential `DiagramWrapper` packs the `Avatar p v w d`
 *   dictionary of its hidden diagram type; in TypeScript that dictionary is the extra field
 *   `diagramClass` (first argument of the `DiagramWrapper` constructor function). The existential
 *   types are `any`. (`EntityClass v` and `Eq d` need no packing.)
 * * `DialogSelector' (Model v) () a` is `DialogSelector_<Model<V>, null, A>`.
 *
 * Multi-shot continuations: `stepScript`
 * --------------------------------------
 * The interpreter in "Model.GI.ModelDiagrams" evaluates `runModelEdit id state $ runFreeT $
 * stepScript script`, and may call the continuation of an instruction more than once: a dialog
 * with an \"Apply\" button runs the rest of the script on every Apply and again on OK, each time
 * from the state captured when the dialog was opened. Generators cannot be copied, so
 * `stepScript(ctx, script)` (a `ModelEdit` action) implements `runFreeT . stepScript` by
 * *replay*: it returns `Pure(a)` or `Free(instruction, next)`, where `next(r)` is a
 * `ModelScriptAct` for the rest of the script. When `next(r)` is run in a context with state
 * @s@ (normally through `stepScript` again, inside `runModelEdit(cls, prsm, s, ...)`):
 *
 * * the first time any continuation of a given step is run, the suspended generator itself is
 *   resumed with @r@, now writing to the new context's state @s@ (no replay, so ordinary
 *   single-shot use costs nothing);
 * * every later time, the original script is started again from its original start state, the
 *   recorded results of all earlier instructions are fed back in (each with the state that was
 *   supplied when it was originally resumed) without being performed again, and then the state
 *   is set to @s@ and the generator resumed with @r@.
 *
 * This reproduces the Haskell semantics (`runModelEdit s (nxt r)` for any @s@) provided scripts
 * are deterministic apart from their instructions (PORTING.md §7.5): all I/O must go through
 * "performIO", whose result is replayed rather than recomputed.
 *
 * Note for the interpreter (Model.GI.ModelDiagrams): a script that steps a *Delta stream
 * processor* (the diagram editor wraps each `applyDelta` of the hades state in a `ModelScript`)
 * is not deterministic in this sense, because the Delta generator inside the `StreamNextT` is
 * consumed linearly ("Hades.Abstract.AutoMonad"): a replay would call `applyDelta` again on a
 * stream that has already moved on. Dialogs opened from diagrams with an Apply button
 * ("avatarProperties", "Find in other diagrams") therefore need special handling there: either
 * make the hades stream itself replayable with the same live-first technique (keep the inputs
 * and base-instruction results since the stream was started, and rebuild the generator when a
 * stale `StreamNextT` is used again), or show such dialogs without Apply (`disableApply1`).
 */
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import * as J from "@/lib/Data/Aeson";
import { Just, Nothing, bindMaybe, catMaybes, isJust, mapMaybe, mapMaybeValue, type Maybe } from "@/lib/Data/Maybe";
import type { Either } from "@/lib/Data/Either";
import { Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { Node, flatten, flattenForest, type Tree } from "@/lib/Data/Tree";
import {
  _1, _2, _Just, assign, identity, lens, modifying, over, preview, set, use, view,
  type Lens, type Traversal,
} from "@/lib/Control/Lens";
import {
  ComboItem, Dialog, OkApplyButton, OkButton, accum, comboBox, constantDialog, focusing, form,
  simpleTextBox, styled1, tickBox, validate,
  type Dialog_, type DialogSelector_, type Gadget_,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import type { Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, MenuItem, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { cannotHappen } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import {
  type Action, type BoundBox, type Connectable, type ConnectorEnd, type Delta, type DeltaCtx,
  type DeltaTool, type DeltaToolbar, type Diagram, type DiagramId, type KeyCommands, type LineShape,
  type Modifiers, type Paint, type Point, type ViewContext, type Viewable,
  BoundBox as mkBox, Connected, DeltaTool as mkDeltaTool, DeltaToolAction, JSON_Diagram,
  LineShape as mkLineShape, Unconnected, ViewSet, addItem, applyToSelection, connectable, deleteItem,
  deltaContext, deltaDiagram, deltaSelection, diagramContents, distance, itemsDescription, lineEnds,
  lineUpdate, liftBase, mempty_Diagram, mempty_View, mkBoundBox, mkEndPoint, mkScriptAction,
  moveBottom, movePoint, moveTop, noMod, noPaint, pointDiff, processDrag1, processSingleAction,
  rubberBand, selectionOrTarget, shiftMod, tellAll, tellCheckpoint, tellTransients, withItem1,
  yieldProperties, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type Entity, type EntityClass, type Model, type ModelEditState, type ModelId,
  ModelEditCtx, Name, addCheckedRelation, addEntity, cloneEntity, current, currentIsModified,
  currentName, delete_, entityChildren, entityContents, entityName, entityParent, entityProperties,
  fromHere, getModel, goToEntity, goToRoot, mkEntity, mkModelId, modelNewName, modelPackageForest,
  modifyRelations, modifyValue, nameField, nameText, packageMeta, queryRelations, recordModified,
  searchEntities, setData, setVariantData, thisChange, throwInternal, throwUser, try_,
  usingTraversal, withBaseType, withBaseTypeCtx, withSubtypeCtx, JSON_Name,
} from "./PackageTree";
import {
  type ReferenceValues, compareReferenceValues, getReferenceValues, putReferenceValues,
} from "./Properties";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { type Reflective, defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { ExtText, JSON_Variant, Variant, _ExtText, show_Variant } from "@/hades/src/Model/Reflection/Values";

// ToDo: consider introducing strongly typed UUIDs

/**
 * TypeScript: a stand-in for the Haskell
 * @dummy = error \"Dummy value used for type name only.\"@: any use of the value throws.
 */
function dummyValue<A>(): A {
  const fail = (): never => {
    throw new Error("Dummy value used for type name only.");
  };
  return new Proxy({}, {
    get: fail, set: fail, has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail,
    getPrototypeOf: fail, defineProperty: fail, deleteProperty: fail,
  }) as A;
}

// ---------------------------------------------------------------------------------------------
// ** Diagram Editing Within Models

/**
 * A diagram stored within a model entity. Typically the type argument to the containing "Model"
 * will be a sum type including one or more values of type @DiagramEntity d@ for appropriate
 * types of @d@.
 *
 * This is an instance of "Reflective" as a matter of convenience.
 *
 * (`DM` is the associated type `DiagramMetadata d`.)
 */
export interface DiagramEntity<D, DM = any> {
  readonly _diagramEntityName: Name;
  readonly _diagramEntityContents: Diagram<D>;
  readonly _diagramEntityData: DM;
}
export function DiagramEntity<D, DM = any>(
  _diagramEntityName: Name,
  _diagramEntityContents: Diagram<D>,
  _diagramEntityData: DM,
): DiagramEntity<D, DM> {
  return { _diagramEntityName, _diagramEntityContents, _diagramEntityData };
}

/**
 * The constraints `Monoid (DiagramMetadata d)`, `ToJSON (DiagramMetadata d)` and
 * `FromJSON (DiagramMetadata d)` required by the "Reflective" and JSON instances of
 * "DiagramEntity". (`Eq (DiagramMetadata d)` is the structural `equals`.) Avatar dictionaries
 * usually include these members too.
 */
export interface DiagramMetadataClass<DM> {
  /** `ToJSON (DiagramMetadata d)` and `FromJSON (DiagramMetadata d)`. */
  readonly diagramMetadataJ: J.JSONCodec<DM>;
  /** `mempty` of `Monoid (DiagramMetadata d)`. */
  readonly diagramMetadataMempty: DM;
  /** `(<>)` of `Semigroup (DiagramMetadata d)`. */
  diagramMetadataAppend(m1: DM, m2: DM): DM;
}

/** `instance (Eq d, Viewable d, Eq (DiagramMetadata d)) => Eq (DiagramEntity d)` */
export function eq_DiagramEntity<D, DM>(e1: DiagramEntity<D, DM>, e2: DiagramEntity<D, DM>): boolean {
  return equals(e1._diagramEntityName, e2._diagramEntityName) &&
    equals(e1._diagramEntityContents, e2._diagramEntityContents) &&
    equals(e1._diagramEntityData, e2._diagramEntityData);
}

/** `instance (Viewable d, Monoid (DiagramMetadata d)) => Reflective (DiagramEntity d)` */
export function Reflective_DiagramEntity<D, DM>(
  cls: Viewable<D> & DiagramMetadataClass<DM>,
): Reflective<DiagramEntity<D, DM>> {
  const nameL = diagramEntityName<D, DM>().dot(nameText);
  return {
    reflectiveName: (_de) => Variant(cls.itemType(dummyValue<D>()) + " Diagram"),
    variantUserLabel: defaultVariantUserLabel,
    reflectiveDefaults: [DiagramEntity<D, DM>(Name(""), mempty_Diagram<D>(), cls.diagramMetadataMempty)],
    reflectiveBuiltIn: (_de) => [nameField],
    reflectiveGet: (de) => M.singleton(nameField, ExtText(view(nameL, de))),
    reflectiveSet: (st, de) => {
      const nm = extract(st, view(nameL, de), _ExtText, nameField);
      return set(nameL, nm, de);
    },
    reflectiveBuiltInRefs: mempty_RefTypeTable,
    reflectiveArrows: M.empty(),
  };
}

/**
 * `instance (Monoid (DiagramMetadata d), ToJSON d, ToJSON (DiagramMetadata d), Viewable d) =>
 * ToJSON (DiagramEntity d)` and `instance (Monoid (DiagramMetadata d), FromJSON d,
 * FromJSON (DiagramMetadata d), HasId d, Viewable d) => FromJSON (DiagramEntity d)`.
 * `cd` is the codec of the diagram elements.
 */
export function JSON_DiagramEntity<D, DM>(
  cls: Viewable<D> & DiagramMetadataClass<DM>,
  cd: J.JSONCodec<D>,
): J.JSONCodec<DiagramEntity<D, DM>> {
  const refl = Reflective_DiagramEntity(cls);
  const diagramJ = JSON_Diagram(cls, cd);
  return J.codec(
    (de) => J.object([
      ["name", JSON_Name.toJSON(de._diagramEntityName)],
      ["type", JSON_Variant.toJSON(refl.reflectiveName(de))],
      ["contents", diagramJ.toJSON(de._diagramEntityContents)],
      ["appearance", cls.diagramMetadataJ.toJSON(de._diagramEntityData)],
    ]),
    (val) => J.withObject("diagram", (v) => {
      const dummy = dummyValue<DiagramEntity<D, DM>>();
      const typ = J.fieldDefault(v, "type", JSON_Variant, refl.reflectiveName(dummy));
        // Version 0.5 diagrams had no type field.
      if (!equals(typ, refl.reflectiveName(dummy))) {
        J.fail("Wrong type of diagram: expected " +
          show_Variant(refl.reflectiveName(dummy)) + " but got " + show_Variant(typ));
      }
      return DiagramEntity<D, DM>(
        J.field(v, "name", JSON_Name),
        J.field(v, "contents", diagramJ),
        J.fieldDefault(v, "appearance", cls.diagramMetadataJ, cls.diagramMetadataMempty),
      );
    }, val),
  );
}

export function diagramEntityName<D = any, DM = any>(): Lens<DiagramEntity<D, DM>, Name> {
  return lens(
    (e: DiagramEntity<D, DM>) => e._diagramEntityName,
    (e, n: Name) => ({ ...e, _diagramEntityName: n }),
  );
}

export function diagramEntityContents<D = any, DM = any>(): Lens<DiagramEntity<D, DM>, Diagram<D>> {
  return lens(
    (e: DiagramEntity<D, DM>) => e._diagramEntityContents,
    (e, d: Diagram<D>) => ({ ...e, _diagramEntityContents: d }),
  );
}

export function diagramEntityData<D = any, DM = any>(): Lens<DiagramEntity<D, DM>, DM> {
  return lens(
    (e: DiagramEntity<D, DM>) => e._diagramEntityData,
    (e, d: DM) => ({ ...e, _diagramEntityData: d }),
  );
}

/**
 * When an entity is to be edited in a diagram window this structure specifies the editor
 * to use.
 *
 * The @p@ type parameter is the monad for drawing the actual shapes, such as the Cairo \"Render\"
 * -- monad.
 */
export type EntityWrapper<P, V> =
  /**
   * Typically the top level type @v@ is a union of several types @(w1, w2 ...)@,
   * each of which covers a specific domain (e.g. GSN arguments). Each @w@ type will have
   * constructors for the different types of domain-specific
   * entity, one or more of which will be diagrams. Hence there will be a family of prisms
   * of type @Prism' v w@, and for each type of diagram @d@ in @w@ there will also be a prism
   * of type @Prism' w (DiagramEntity d)@.
   */
  | {
    readonly tag: "DiagramWrapper";
    /**
     * TypeScript: the `Avatar p v w d` dictionary packed by the existential (also the
     * `Viewable`/`Connectable` dictionary of the diagram elements).
     */
    readonly diagramClass: Avatar<P, V, any, any>;
    /** The "ModelId" of the diagram in the model. */
    readonly wrappedEntityId: ModelId;
    readonly diagramToEdit: Diagram<any>;
    /** Convert the edited diagram back to an entity in the model. */
    readonly diagramEntityTraversal: Traversal<any, DiagramEntity<any>>;
    /** Link between diagram update scripts and the underlying model. */
    readonly diagramTraversal: Traversal<V, any>;
    /** The property dialogues for diagram elements. */
    readonly diagramDialog: DialogSelector_<Model<V>, null, any>;
    /** The initial control values for the diagram element rendering. */
    readonly diagramContext: ViewContext<any>;
    /** Context menu for the diagram background. @Nothing@ for no menu. */
    readonly diagramMenu: Maybe<(p: Point) => Menu<Action<any>>>;
    readonly diagramToolbar: (c: Changes<Model<V>>) => DeltaToolbar<any>;
  }
  /**
   * Generate a view of the model based on the entity.
   *
   * @s@ is a state value which is
   * not derived from or saved in the model but which persists across refresh events.
   *
   * The output from the gadget is ignored. Instead the gadget should generate "ModelEdit" events
   * using "send". This allows for finer control and better undo messages.
   */
  | {
    readonly tag: "ViewWrapper";
    /** The entity controlling this view. */
    readonly wrappedEntityId: ModelId;
    /** Identifier to differentiate views of the same entity. */
    readonly viewTag: string;
    /** Initial state. */
    readonly viewInitial: any;
    /**
     * Left: input is independent of model.
     * Right: input is extracted from the model. The initial value must not be @Nothing@.
     */
    readonly viewInput: Either<any, (m: Model<V>) => Maybe<any>>;
    /**
     * The view of the model. As entities are modified the "Gadget" should send
     * "ModelEdit" scripts. The text is the change description for the
     * undo menu. If @Nothing@ is returned then any changes are ignored.
     *
     * The Gadget is re-rendered whenever the "Refresh" button is pressed.
     */
    readonly viewGadget: Gadget_<Model<V>, ModelScriptAct<P, V, V, Maybe<string>>, [any, any]>;
  };

/** The `DiagramWrapper` constructor. The first argument is the packed `Avatar p v w d` dictionary. */
export function DiagramWrapper<P, V, W, D>(
  diagramClass: Avatar<P, V, W, D>,
  wrappedEntityId: ModelId,
  diagramToEdit: Diagram<D>,
  diagramEntityTraversal: Traversal<W, DiagramEntity<D>>,
  diagramTraversal: Traversal<V, W>,
  diagramDialog: DialogSelector_<Model<V>, null, D>,
  diagramContext: ViewContext<D>,
  diagramMenu: Maybe<(p: Point) => Menu<Action<D>>>,
  diagramToolbar: (c: Changes<Model<V>>) => DeltaToolbar<D>,
): EntityWrapper<P, V> {
  return {
    tag: "DiagramWrapper",
    diagramClass, wrappedEntityId, diagramToEdit, diagramEntityTraversal, diagramTraversal,
    diagramDialog, diagramContext, diagramMenu, diagramToolbar,
  };
}

/** The `ViewWrapper` constructor. */
export function ViewWrapper<P, V, A, St>(
  wrappedEntityId: ModelId,
  viewTag: string,
  viewInitial: St,
  viewInput: Either<A, (m: Model<V>) => Maybe<A>>,
  viewGadget: Gadget_<Model<V>, ModelScriptAct<P, V, V, Maybe<string>>, [St, A]>,
): EntityWrapper<P, V> {
  return { tag: "ViewWrapper", wrappedEntityId, viewTag, viewInitial, viewInput, viewGadget };
}

/** True if the two wrappers describe the same editor. */
export function sameEntityView<P1, V1, P2, V2>(w1: EntityWrapper<P1, V1>, w2: EntityWrapper<P2, V2>): boolean {
  if (w1.tag === "DiagramWrapper" && w2.tag === "DiagramWrapper") {
    return w1.wrappedEntityId === w2.wrappedEntityId;
  }
  if (w1.tag === "ViewWrapper" && w2.tag === "ViewWrapper") {
    return w1.wrappedEntityId === w2.wrappedEntityId && w1.viewTag === w2.viewTag;
  }
  return false;
}

/*
Design Note

The EntityWrapper does not take a "w" type parameter because the UserScriptFunctor needs to
have a hoist operation that can change "w1" into "w2" using a prism. However this cannot be
applied to the diagram menu items.
*/

/** A map from diagram variant types to the variants that they can hold avatars for. */
export type DiagramEntityTypes<V> = M.Map<Variant<V>, readonly Variant<V>[]>;

/**
 * Reflective data for types that can include diagrams.
 *
 * Laws:
 *
 * * @getDiagramWrapper@ returns a result if and only if @isDiagram@ returns True for the value
 * referenced.
 *
 * * @reflectiveName v `member` diagramEntityTypes ==> isDiagram v@
 *
 * (`PM` is `PackageMeta v`, as in `EntityClass`.)
 */
export interface HasDiagrams<P, V, PM = any> extends EntityClass<V, PM> {
  /** @True@ if the argument is an instance of @w@ and is a diagram. */
  isDiagram(v: V): boolean;
  /**
   * Returns a wrapper if the referenced entity is a diagram in an instance of @w@.
   * (A `ModelEdit v v`.)
   */
  getDiagramWrapper(ctx: ModelEditCtx<V, V>, e: Entity<V>): Maybe<EntityWrapper<P, V>>;
  /** Entities which can appear in diagrams. */
  readonly diagramEntityTypes: DiagramEntityTypes<V>;
  /**
   * If this @v@ is a diagram with avatars then replace the referenced entities according to the
   * supplied function.
   */
  diagramMapAvatars(f: (m: ModelId) => Maybe<ModelId>, e: Entity<V>): Entity<V>;
}

// ---------------------------------------------------------------------------------------------
// ** Avatars of Model Entities in Diagrams

/**
 * An instance of @Avatar@ defines a relationship between diagram element type @d@ and model
 * entity type @v@. When you drag a model entity into a diagram, the thing that appears in the
 * diagram is actually an avatar of the entity. The avatar can access its entity through the
 * "ModelScript" monad using the "liftBase" function.
 *
 * There is a circular dependency between model and diagram, such that when a model is updated all
 * the diagrams are updated, and a diagram update is then used to update the model. The
 * "updateAvatar" function breaks this endless loop by returning "False" if the updated model
 * has left the diagram element unaffected.
 *
 * If the diagram element type @d@ presents model entities as "itemChildren" then the "ModelId"s
 * should be used as the child "DiagramId"s.
 *
 * (TypeScript: `Base d ~ ModelScript p v w`, so within a Delta computation for @d@, `d.base` is
 * the `ModelEditCtx<V, W>` of the running script. `DM` is the associated type
 * `DiagramMetadata d`: application information that is recorded with the picture in the model.
 * This dictionary must also be the `Connectable` dictionary used for the diagram.)
 */
export interface Avatar<P, V, W, D, DM = any> extends Connectable<D> {
  /** Write the metadata in to the view context. */
  updateViewContext(ctx: ModelEditCtx<V, W>, meta: DM, vc: ViewContext<D>): ViewContext<D>;
  /** Model ID for the diagram being edited. Usually hidden in the "diagramViewContext". */
  getDiagramModelId(d: DeltaCtx<D>): Delta<D, DiagramId>;
  /**
   * If the argument is allowed on a @Diagram d@ then this adds a new avatar
   * to the diagram, centred at the specified point. If it is not allowed then
   * the result is @Nothing@.
   *
   * Some entities (e.g. connecting arrows) may need avatars for related entities as
   * well. @findOrCreateAvatar@ is useful in this case.
   */
  entityAvatar(d: DeltaCtx<D>, e: Entity<V>, p: Point): Delta<D, Maybe<D>>;
  /**
   * If the diagram element is an Avatar of an entity in the model then this is the ID of
   * that entity. Some diagram elements may be free standing (e.g. comment boxes) and these
   * will return @Nothing@.
   */
  ascendedId(v: D): Maybe<ModelId>;
  /**
   * Diagram elements have a list of \"child\" elements. This function links the model
   * entity to the displayed list. The results must be entities within the model, but need
   * not be the actual children of the ascended entity.
   */
  avatarChildren(d: DeltaCtx<D>, v: D): Delta<D, ModelId[]>;
  /**
   * Update the diagram avatar @d@ with data from the corresponding model entity.
   * If the model no longer contains the entity then the avatar should also be deleted.
   * If the diagram remains unchanged then return False, as this breaks the loop between
   * diagram changes and model updates. Note that merely updating the view of a diagram
   * element (e.g. with new values retrieved from the model) does not count as a change to
   * the diagram. Only return "True" if a new version of the Diagram data structure needs
   * to be pushed back into the model, for instance if the diagram element has been resized
   * to accomodate model changes.
   */
  updateAvatar(d: DeltaCtx<D>, v: D): Delta<D, boolean>;
}

/** TypeScript: the `Avatar` dictionary of a Delta computation (`d.cls`). */
export function avatar<P = any, V = any, W = any, D = any>(d: DeltaCtx<D>): Avatar<P, V, W, D> {
  return d.cls as Avatar<P, V, W, D>;
}

/**
 * TypeScript: the `ModelEditCtx` of the "ModelScript" in which a Delta computation runs
 * (`d.base`, the context of `liftBase`).
 *
 * Each input action is applied to the diagram by a new script (`applyDelta` sets `d.base`), so
 * the context must be read again after every `yieldViews` (or anything else that waits for the
 * next action): never keep it in a variable across one.
 */
export function scriptContext<V = any, W = any>(d: DeltaCtx<any>): ModelEditCtx<V, W> {
  return d.base as ModelEditCtx<V, W>;
}

/**
 * If an diagram element is an Avatar of an entity in the model then this is it. Also leaves
 * the cursor on the entity in question.
 *
 * @Nothing@ is returned if the target does not exist.
 */
export function* ascend<P, V, W, D>(d: DeltaCtx<D>, item: D): Delta<D, Maybe<Entity<V>>> {
  const target = avatar<P, V, W, D>(d).ascendedId(item);
  if (target.tag === "Nothing") return Nothing;
  const r = try_(scriptContext<V, W>(d), (c) => {
    goToEntity(c, target.value);
    return current(c);
  });
  if (r.tag === "Left") return Nothing;
  return r.value;
}

/**
 * When a diagram element is double-clicked then for avatars display the dialog box of the
 * ascended entity, and for non-avatars display the dialog box of the diagram element.
 */
export function* avatarProperties<P, V, W, D>(d: DeltaCtx<D>, item: D): Delta<D, Action<D>> {
  const asc = yield* ascend<P, V, W, D>(d, item);
  if (asc.tag === "Nothing") return yield* yieldProperties(d, item);
  const e = asc.value;
  // ModelScript monad.
  const base = scriptContext<V, W>(d);
  const nm = currentName(base);
  const mf = yield* openProperties<P, V, W>(base, e.entityId);
  /* This is a bit clunky. The property dialog has to take an entity in order to
  discriminate between variants and hence show the right dialog. However all the
  actual editing is done using the property values. */
  let changed: Maybe<boolean> = Nothing;
  if (mf.tag === "Just") {
    const [newEnt, newRefs] = mf.value;
    yield* goBackToEntity<P, V, W>(base, e.entityId, nm);
    const oldRefs = queryRelations(base, (r) => getReferenceValues(e.entityId, r));
    const changedRefs = compareReferenceValues(oldRefs, newRefs);
    const changedVal = setVariantData(base, view(entityProperties(base.cls), newEnt));
    if (changedRefs.length > 0) {
      currentIsModified(base);
      for (const u of changedRefs) recordModified(base, u);
      putReferenceValues(base, e, newRefs);
    }
    changed = Just(changedVal || changedRefs.length > 0);
  }
  const desc = yield* d.cls.itemDescription(d, item);
  if (changed.tag === "Just" && changed.value) yield* tellCheckpoint(d, "Edit " + desc + " properties");
  return yield* yieldViews(d);
}

/** Find all the avatars of the argument in the diagram, in no particular order. */
export function* diagramAvatars<P, V, W, D>(d: DeltaCtx<D>, modelId: ModelId): Delta<D, D[]> {
  const cls = avatar<P, V, W, D>(d);
  const es = M.elems(use(d, deltaDiagram<D>().dot(diagramContents<D>())));
  return es.filter((e) => equals(Just(modelId), cls.ascendedId(e)));
}

/**
 * Find the nearest avatar of the argument to the given point, or Nothing if there isn't
 * one on the diagram.
 */
export function* nearestAvatar<P, V, W, D>(d: DeltaCtx<D>, uuid: ModelId, pt: Point): Delta<D, Maybe<D>> {
  const ds = yield* diagramAvatars<P, V, W, D>(d, uuid);
  if (ds.length === 0) return Nothing;
  if (ds.length === 1) return Just(ds[0]);
  // Find the nearest.
  const results: [number, D][] = [];
  for (const v of ds) {
    const pt2 = (yield* connectable(d).itemConnectionPoint(d, v, Nothing))(pt); // Ignore the issue of which child
    results.push([distance(pointDiff(pt, pt2)), v]);
  }
  // Find the nearest one. (`minimumBy (comparing fst)`: the first of equal minima.)
  let best = results[0];
  for (const r of results.slice(1)) if (r[0] < best[0]) best = r;
  return Just(best[1]);
}

/**
 * Find or create an avatar of the entity in the diagram. If the entity already has one or more
 * avatars then return the nearest one. Otherwise create one at the given point and return that.
 *
 * Returns @Nothing@ if the entity is not allowed on this diagram.
 */
export function* findOrCreateAvatar<P, V, W, D>(
  d: DeltaCtx<D>,
  /** The entity that needs an avatar. */
  ent: Entity<V>,
  /** An entity exported by the avatar. */
  exportId: Maybe<ModelId>,
  /** The point on the diagram where a new avatar should be created. */
  pt: Point,
): Delta<D, Maybe<[D, Maybe<DiagramId>]>> {
  const near = yield* nearestAvatar<P, V, W, D>(d, ent.entityId, pt);
  if (near.tag === "Nothing") {
    const v = yield* avatar<P, V, W, D>(d).entityAvatar(d, ent, pt);
    if (v.tag === "Just") return Just([v.value, exportId] as [D, Maybe<DiagramId>]);
    return Nothing;
  }
  return Just([near.value, exportId] as [D, Maybe<DiagramId>]);
}

/** Mapping from key presses to diagram actions. */
export function keyCommands<D>(): KeyCommands<D> {
  const deleteMsg = function* (d: DeltaCtx<D>, xs: readonly D[]): Delta<D, string> {
    return "Delete " + (yield* itemsDescription(d, xs));
  };
  return M.fromList<readonly [Modifiers, string], (d: DeltaCtx<D>) => Delta<D, void>>([
    [[noMod, "\x7f"], (d) => applyToSelection(d, deleteMsg, deleteItem)],
    [[shiftMod, "\x7f"], (d) => applyToSelectionAvatars(d,
      deleteMsg,
      function* (d1: DeltaCtx<D>, ent: Entity<any>): Delta<D, void> {
        const base = scriptContext(d1);
        goToEntity(base, ent.entityId);
        delete_(base);
      },
      deleteItem)],
  ]);
}

/** Apply the command to all the avatars in the current diagram selection. */
function* applyToSelectionAvatars<V, D>(
  d: DeltaCtx<D>,
  /** Message for the undo log, based on the items the action is applied to. */
  strF: (d: DeltaCtx<D>, vs: readonly D[]) => Delta<D, string>,
  /** Action to apply to avatars. */
  avatarAction: (d: DeltaCtx<D>, ent: Entity<V>) => Delta<D, void>,
  /** Action to apply to any elements that do not have avatars. */
  elementAction: (d: DeltaCtx<D>, uuid: DiagramId) => Delta<D, void>,
): Delta<D, void> {
  const sel = use(d, deltaSelection<D>());
  if (!S.isNull(sel)) {
    const contents = use(d, deltaDiagram<D>().dot(diagramContents<D>()));
    const msg = yield* strF(d, mapMaybe((u: DiagramId) => M.lookup(u, contents), S.toList(sel)));
    for (const i of S.toList(sel)) {
      const e = M.lookup(i, contents);
      if (e.tag === "Nothing") {
        cannotHappen("Selected item not found in diagram", null);
      } else {
        const asc = yield* ascend<any, V, any, D>(d, e.value);
        if (asc.tag === "Nothing") yield* elementAction(d, i);
        else yield* avatarAction(d, asc.value);
      }
    }
    yield* tellCheckpoint(d, msg);
  }
}

/** Update all the elements in the diagram from the model. */
export function* updateDiagram<P, V, W, D>(d: DeltaCtx<D>, dTrav: Traversal<W, DiagramEntity<D>>): Delta<D, void> {
  const cls = avatar<P, V, W, D>(d);
  const base = scriptContext<V, W>(d);
  const uuid = yield* cls.getDiagramModelId(d);
  const mVal = try_(base, (c) => {
    const prsm = usingTraversal(c, (_c, p) => p);
    goToEntity(c, uuid);
    const e = current(c);
    return preview(
      _Just<Entity<V>>().dot(entityContents<V>()).dot(prsm).dot(dTrav).dot(diagramEntityContents<D>()),
      e,
    );
  });
  if (mVal.tag === "Left") return; // Diagram deleted.
  if (mVal.value.tag === "Nothing") return; // Should never happen.
  const newDiagram = mVal.value.value;
  assign(d, deltaDiagram<D>(), newDiagram);
  yield* tellAll(d);
  const contents = M.elems(use(d, deltaDiagram<D>().dot(diagramContents<D>())));
  const rs: boolean[] = [];
  for (const item of contents) rs.push(yield* cls.updateAvatar(d, item));
  const r = rs.some((x) => x);
  if (r) {
    const dg = use(d, deltaDiagram<D>());
    const base1 = scriptContext<V, W>(d);
    goToEntity(base1, uuid);
    modifyValue(base1, (w: W) => set(dTrav.dot(diagramEntityContents<D>()), dg, w));
    yield* tellCheckpoint(d, ""); // Flag value for update but no checkpoint.
  }
}

/**
 * Find or create an avatar for the model entity, and hence create a "ConnectorEnd" that
 * matches it. If the "ModelId" is nil or does not exist then an "Unconnected" result is returned.
 *
 * Once the caller has both connection ends it may need to adjust them with "optimiseEnds".
 */
export function* avatarConnector<P, V, W, D>(
  d: DeltaCtx<D>,
  /**
   * The identity of the model entity that needs to be connected to, and
   * the exported entity (if any) that needs to be connected within the model entity
   */
  target: Maybe<readonly [ModelId, Maybe<ModelId>]>,
  /**
   * The notional location of the entity that will own the connector. Used for
   * computing the connection point.
   */
  basePoint: Point,
  /** The point where the avatar of the model entity should be created. */
  pt: Point,
): Delta<D, ConnectorEnd> {
  if (target.tag === "Nothing") return Unconnected(pt);
  const [modelId, exportId] = target.value;
  const base = scriptContext<V, W>(d);
  const r = try_(base, (c) => {
    goToEntity(c, modelId);
    return current(c);
  });
  // Nil modelId means not connected rather than root, but the result is the same.
  if (r.tag === "Left") return Unconnected(pt);
  if (r.value.tag === "Nothing") return Unconnected(pt);
  const entity = r.value.value;
  const found = yield* findOrCreateAvatar<P, V, W, D>(d, entity, exportId, pt);
  if (found.tag === "Nothing") {
    return throwInternal(base, "Arrow is connected to something that is not legal on this diagram.");
  }
  const [av, child] = found.value;
  const pt2 = (yield* connectable(d).itemConnectionPoint(d, av, child))(basePoint);
  return Connected(pt2, d.cls.identifier(av), child);
}

/**
 * Standard menu items for an avatar. Similar to "Hades.Abstract.Menus.basicShapeMenu" except
 * that it distinguishes between deleting the just the shape on the diagram and deleting the
 * model entity as well.
 *
 * (Called without the `Point` it returns the `Point -> Menu` function; the point is ignored.)
 */
export function avatarShapeMenu<P, V, W, D>(cls: HasDiagrams<P, V>, dId: DiagramId): (p: Point) => Menu<Action<D>>;
export function avatarShapeMenu<P, V, W, D>(cls: HasDiagrams<P, V>, dId: DiagramId, p: Point): Menu<Action<D>>;
export function avatarShapeMenu<P, V, W, D>(
  cls: HasDiagrams<P, V>,
  dId: DiagramId,
  p?: Point,
): Menu<Action<D>> | ((p: Point) => Menu<Action<D>>) {
  const deleteModelItem = function* (d: DeltaCtx<D>, dId1: DiagramId): Delta<D, void> {
    yield* withItem1(d, dId1, function* (d1: DeltaCtx<D>, item: D) {
      yield* deleteItem(d1, dId1);
      const mId = avatar<P, V, W, D>(d1).ascendedId(item);
      if (mId.tag === "Just") {
        const base = scriptContext<V, W>(d1);
        goToEntity(base, mId.value);
        delete_(base);
      }
    });
  };
  const selectInModel = function* (d: DeltaCtx<D>): Delta<D, Action<D>> {
    const sel = use(d, deltaSelection<D>());
    const contents = use(d, deltaDiagram<D>().dot(diagramContents<D>()));
    const targets = S.member(dId, sel) ? S.toList(sel) : [dId];
    const newSet = S.fromList(mapMaybe(
      (u: DiagramId) => bindMaybe(M.lookup(u, contents), (v: D) => avatar<P, V, W, D>(d).ascendedId(v)),
      targets,
    ));
    yield* setModelSelection<P, V, W>(scriptContext<V, W>(d), newSet);
    return yield* yieldViews(d);
  };
  const describe = (f: (s: string) => string) =>
    function* (d: DeltaCtx<D>, vs: readonly D[]): Delta<D, string> {
      return f(yield* itemsDescription(d, vs));
    };
  const menu = (): Menu<Action<D>> => Menu<Action<D>>([
    [
      MenuItem("Properties", Right(mkScriptAction<D>(function* (d) {
        const item = M.lookup(dId, use(d, deltaDiagram<D>().dot(diagramContents<D>())));
        if (item.tag === "Nothing") return yield* yieldViews(d);
        return yield* avatarProperties<P, V, W, D>(d, item.value);
      }))),
      MenuItem("Select in model", Right(mkScriptAction<D>(selectInModel))),
      MenuItem("Find in other diagrams", Right(
        mkScriptAction<D>((d) => findInDiagrams<P, V, W, D>(cls, d, dId)))),
    ], [
      MenuItem("To front", Right(selectionOrTarget<D>(
        describe((s) => "Move " + s + " to front"),
        moveTop,
        dId,
      ))),
      MenuItem("To back", Right(selectionOrTarget<D>(
        describe((s) => "Move " + s + " to back"),
        moveBottom,
        dId,
      ))),
    ], [
      MenuItem("Delete from diagram", Right(
        selectionOrTarget<D>(
          describe((s) => "Delete from diagram " + s),
          deleteItem,
          dId,
        ))),
      MenuItem("Delete from model", Right(
        selectionOrTarget<D>(describe((s) => "Delete " + s), deleteModelItem, dId))),
    ],
  ]);
  return p === undefined ? () => menu() : menu();
}

function* findInDiagrams<P, V, W, D>(cls: HasDiagrams<P, V>, d: DeltaCtx<D>, dId: DiagramId): Delta<D, Action<D>> {
  const diagramPair = ([nm, dw]: readonly [Name, EntityWrapper<P, V>]): ComboItem<ModelId> =>
    ComboItem(view(nameText, nm), Nothing, Nothing, dw.wrappedEntityId);
  const getWrapper = (c: ModelEditCtx<V, W>, e: Entity<V>): Maybe<[Name, EntityWrapper<P, V>]> =>
    withBaseType(c, (c1) => mapMaybeValue(
      (w: EntityWrapper<P, V>): [Name, EntityWrapper<P, V>] => [view(entityName(c1.cls), e), w],
      cls.getDiagramWrapper(c1, e),
    ));
  const hasAvatar = (mId: ModelId, w: EntityWrapper<P, V>): boolean => {
    if (w.tag !== "DiagramWrapper") return false;
    const elems = M.elems(view(diagramContents<any>(), w.diagramToEdit));
    return elems.some((x) => equals(Just(mId), w.diagramClass.ascendedId(x)));
  };
  const linkDialog = (prs: (e: Model<V>) => readonly ComboItem<ModelId>[]): DialogSelector_<Model<V>, null, ModelId> =>
    constantDialog(Dialog("Diagrams", OkApplyButton,
      accum(form<Model<V>, null, ModelId>("Vertical", [
        ["Found in:", focusing(identity<ModelId>(),
          validate((u: ModelId) => !U.isNil(u), comboBox<Model<V>, null, ModelId>(prs)))],
      ]))));

  const contents = use(d, deltaDiagram<D>().dot(diagramContents<D>()));
  const tgt = bindMaybe(M.lookup(dId, contents), (v: D) => avatar<P, V, W, D>(d).ascendedId(v));
  if (tgt.tag === "Nothing") return yield* yieldViews(d); // Not an avatar. Should not happen.
  const target: ModelId = tgt.value;
  const base = scriptContext<V, W>(d);
  const ents = fromHere(base, (c) => {
    goToRoot(c);
    return modelPackageForest(c);
  });
  const wrappers = catMaybes(flattenForest(ents).map((e) => getWrapper(base, e)))
    .filter((pr) => hasAvatar(target, pr[1]));
  const prs = wrappers.map(diagramPair);
  const firstItem = prs.length === 0 ? U.nil : prs[0].menuItemValue;
  const r = yield* openDialog<P, V, W, ModelId>(base, linkDialog(() => prs), firstItem);
  if (r.tag === "Nothing") return yield* yieldViews(d);
  yield* openDiagram<P, V, W>(cls, base, r.value);
  return yield* yieldViews(d);
}

/**
 * Background menu for diagrams. Allows the diagram to be selected in the model.
 * Some diagrams may add other items using the monoid instance.
 */
export function diagramBackgroundMenu<D>(_p: Point): Menu<Action<D>> {
  return Menu<Action<D>>([[
    menuItem("Select diagram in model", mkScriptAction<D>(function* (d) {
      const diagId = yield* avatar<any, any, any, D>(d).getDiagramModelId(d);
      yield* setModelSelection(scriptContext(d), S.singleton(diagId));
      return yield* yieldViews(d);
    })),
  ]]);
}

// ---------------------------------------------------------------------------------------------
// ** Model Editing Scripts

/**
 * The core language for "ModelScript".
 *
 * (TypeScript: the instructions a script generator yields. The generator is resumed with the
 * value given for each constructor; the Haskell continuation fields are the suspended generator.)
 */
export type UserScriptFunctor<P, V> =
  /**
   * Pop up the standard dialog to edit an item of type @v@ along with its relationships.
   * Resumed with `Maybe<[Entity<V>, ReferenceValues]>`.
   */
  | { readonly tag: "ScriptProperties"; readonly _0: ModelId }
  /**
   * Pop up a dialog to edit an item of type @s@. Resumed with `Maybe<S>`. (If the selector
   * gives no dialog the Haskell interpreter resumes with @Just@ the initial value.)
   */
  | { readonly tag: "ScriptDialog"; readonly _0: DialogSelector_<Model<V>, null, any>; readonly _1: any }
  /**
   * Open an entity described by the wrapper in a diagram window.
   * Note that the subtype prism used in
   * the diagram is independent of the prism used in the script that opened it.
   * Resumed with `null`.
   */
  | { readonly tag: "ScriptOpenDiagram"; readonly _0: EntityWrapper<P, V> }
  /** Get the set of currently selected model items. Resumed with `S.Set<ModelId>`. */
  | { readonly tag: "ScriptGetSelection" }
  /** Change the set of currently selected model items. Resumed with `null`. */
  | { readonly tag: "ScriptSetSelection"; readonly _0: S.Set<ModelId> }
  /** Get the current hint text. Resumed with `Maybe<string>`. */
  | { readonly tag: "ScriptGetHint" }
  /** Set the hint text on the bottom bar. Resumed with `null`. */
  | { readonly tag: "ScriptSetHint"; readonly _0: Maybe<string> }
  /**
   * The IO will be performed and the result returned. (The action may return a Promise, which
   * the interpreter awaits; the script is resumed with the result.)
   */
  | { readonly tag: "ScriptPerformIO"; readonly _0: () => unknown };

export function ScriptProperties<P = any, V = any>(_0: ModelId): UserScriptFunctor<P, V> {
  return { tag: "ScriptProperties", _0 };
}
export function ScriptDialog<P = any, V = any, St = any>(
  _0: DialogSelector_<Model<V>, null, St>,
  _1: St,
): UserScriptFunctor<P, V> {
  return { tag: "ScriptDialog", _0, _1 };
}
export function ScriptOpenDiagram<P, V>(_0: EntityWrapper<P, V>): UserScriptFunctor<P, V> {
  return { tag: "ScriptOpenDiagram", _0 };
}
export const ScriptGetSelection: UserScriptFunctor<any, any> = { tag: "ScriptGetSelection" };
export function ScriptSetSelection<P = any, V = any>(_0: S.Set<ModelId>): UserScriptFunctor<P, V> {
  return { tag: "ScriptSetSelection", _0 };
}
export const ScriptGetHint: UserScriptFunctor<any, any> = { tag: "ScriptGetHint" };
export function ScriptSetHint<P = any, V = any>(_0: Maybe<string>): UserScriptFunctor<P, V> {
  return { tag: "ScriptSetHint", _0 };
}
export function ScriptPerformIO<P = any, V = any, A = any>(_0: () => A | Promise<A>): UserScriptFunctor<P, V> {
  return { tag: "ScriptPerformIO", _0 };
}

// `instance Functor (UserScriptFunctor p v)`: not needed in TypeScript. The instructions carry
// no continuation (the generator is the continuation), so there is nothing to map over.

/**
 * Monad for writing interactive scripts which can directly interact with the user by
 * popping up dialogs and opening diagrams.
 *
 * [@p@] The rendering monad for diagrams.
 *
 * [@v@] The underlying type for properties.
 *
 * [@m@] The base monad for the interactive scripts.
 *
 * (TypeScript: a generator yielding "UserScriptFunctor" instructions. The base monad is not a
 * type parameter: for a "ModelScript" it is the `ModelEditCtx` the generator closes over.
 * `MonadTrans`'s `lift` is a direct call, and `MonadError`'s `throwError` throws.)
 */
export type UserScript<P, V, A> = Generator<UserScriptFunctor<P, V>, A, any>;

/** The `UserScript` constructor of the (erased) newtype: the identity. */
export function UserScript<P, V, A>(s: UserScript<P, V, A>): UserScript<P, V, A> {
  return s;
}

/**
 * Class of monads derived from "UserScript".
 *
 * TypeScript: `Ctx` is the context of the monad (`ModelEditCtx` for scripts, `DeltaCtx` for
 * Delta computations). `liftScript(c, act)` runs the script action `act` (given the script's
 * `ModelEditCtx`) in that monad. Because Delta computations pass script instructions through,
 * the functions of this module with a `ScriptMonad` constraint do not need this dictionary
 * (see the module header).
 */
export interface ScriptMonad<Ctx> {
  liftScript<P, V, A>(c: Ctx, act: (ctx: ModelEditCtx<V, any>) => UserScript<P, V, A>): Generator<any, A, any>;
}

/** `instance (Monad m) => ScriptMonad p v m (UserScript p v m)`: `liftScript = id`. */
export const ScriptMonad_UserScript: ScriptMonad<ModelEditCtx<any, any>> = {
  liftScript: (ctx, act) => act(ctx),
};

/**
 * `instance (Monad m, Viewable d, p ~ Paint d, Base d ~ UserScript (Paint d) v m) =>
 * ScriptMonad p v m (Delta d)`: `liftScript = liftBase`.
 */
export const ScriptMonad_Delta: ScriptMonad<DeltaCtx<any>> = {
  liftScript: (d, act) => liftBase(d, act),
};

/**
 * Interactive scripts based on the ModelEdit monad.
 *
 * (TypeScript: the same generator type as "UserScript"; the `ModelEdit v w` base is the
 * `ModelEditCtx<V, W>` the generator closes over.)
 */
export type ModelScript<P, V, A> = UserScript<P, V, A>;

/** A first-class `ModelScript p v w a` value. */
export type ModelScriptAct<P, V, W, A> = (ctx: ModelEditCtx<V, W>) => ModelScript<P, V, A>;

/**
 * Underlying model types are often unions of different types, and we want to make these
 * composable. Hence given a type @Foo@ there will be a family of scripts in the
 * @ModelScript p v Foo@ monad, and likewise for models of type @Bar@. We can put them together
 * by creating a union type @FooBar@ with prisms @_Foo :: Prism FooBar Foo@ and similarly @_Bar@,
 * and then use @promoteScript _Foo@ to hoist a @ModelScript p FooBar Foo@ up to
 * @ModelScript p FooBar FooBar@.
 */
export function promoteScript<P, V, W1, W2, A>(
  prsm: Traversal<W1, W2>,
  act: ModelScriptAct<P, V, W2, A>,
): ModelScriptAct<P, V, W1, A> {
  return (ctx) => act(withSubtypeCtx(ctx, prsm));
}

export function withBaseScript<P, V, W, A>(act: ModelScriptAct<P, V, V, A>): ModelScriptAct<P, V, W, A> {
  return (ctx) => act(withBaseTypeCtx(ctx));
}

/**
 * Executed on activation (usually by double-clicking) of a model element.
 * @Nothing@ means root was activated.
 */
export type ActivationScript<P, V, W> = (e: Maybe<Entity<V>>) => ModelScriptAct<P, V, W, Maybe<string>>;

/**
 * The context menu for an entity. An argument of @Nothing@ means root. If the entity has
 * no context menu then return @Nothing@.
 *
 * Menu items are scripts which can manipulate the package tree and open dialog boxes
 * and diagrams. Scripts should return a description of what they have changed for the
 * benefit of the Undo list. Scripts that change nothing should return @Nothing@.
 */
export type EntityMenu<P, V, W> = (e: Maybe<Entity<V>>) => Maybe<Menu<ModelScriptAct<P, V, W, Maybe<string>>>>;

/** Class of entities that can be edited through ModelScripts */
export interface Editable<P, V> {
  /** Action when an entity is double-clicked. */
  readonly editableActivation: ActivationScript<P, V, V>;
  /** Context menu for an entity when right clicked in the model tree. */
  readonly editableTreeMenu: EntityMenu<P, V, V>;
  /** Context menu for an entity when right clicked in a dialog. */
  readonly editableDisplayMenu: EntityMenu<P, V, V>;
}

// ---------------------------------------------------------------------------------------------
// Running scripts with multi-shot continuations (see the module header).

/**
 * One layer of a running script: Haskell `FreeF (UserScriptFunctor p v) a (ModelScript p v w a)`,
 * the result of `runFreeT`.
 */
export type ScriptStep<P, V, W, A> =
  /** The script has finished. */
  | { readonly tag: "Pure"; readonly _0: A }
  | {
    readonly tag: "Free";
    /** The instruction to interpret. */
    readonly _0: UserScriptFunctor<P, V>;
    /**
     * The rest of the script given the instruction's result. It may be called (and its result
     * run) any number of times, in a context with any state.
     */
    readonly _1: (r: any) => ModelScriptAct<P, V, W, A>;
  };

/**
 * A state cell that forwards to another one, so that a suspended generator can be resumed
 * under a new `ModelEditCtx` (a new `runModelEdit`).
 */
class ForwardCell<V> {
  constructor(public target: { state: ModelEditState<V> }) {}
  get state(): ModelEditState<V> {
    return this.target.state;
  }
  set state(s: ModelEditState<V>) {
    this.target.state = s;
  }
}

/** Where a running script came from: what is needed to replay it. */
interface ScriptOrigin<P, V, W, A> {
  readonly script: ModelScriptAct<P, V, W, A>;
  readonly start: ModelEditState<V>;
  readonly cls: EntityClass<V>;
  readonly prsm: Traversal<V, W>;
}

/** A script suspended at an instruction. */
interface Suspension<P, V, W, A> {
  readonly origin: ScriptOrigin<P, V, W, A>;
  /** The results of the earlier instructions, each with the state it was resumed in. */
  readonly history: readonly (readonly [any, ModelEditState<V>])[];
  /** The suspended generator, until it is resumed for the first time. */
  live: { readonly gen: ModelScript<P, V, A>; readonly cell: ForwardCell<V> } | null;
}

/** A continuation: a suspension and the result to resume it with. */
interface Resumption<P, V, W, A> {
  readonly susp: Suspension<P, V, W, A>;
  readonly result: any;
}

/** A running script generator and its last step. */
interface Running<P, V, W, A> {
  readonly origin: ScriptOrigin<P, V, W, A>;
  readonly history: readonly (readonly [any, ModelEditState<V>])[];
  readonly gen: ModelScript<P, V, A>;
  readonly cell: ForwardCell<V>;
  readonly res: IteratorResult<UserScriptFunctor<P, V>, A>;
}

const resumptionKey: unique symbol = Symbol("DiagramType.Resumption");

/** Resume a suspended script in the context `ctx`, replaying it if necessary. */
function resumeScript<P, V, W, A>(ctx: ModelEditCtx<V, any>, k: Resumption<P, V, W, A>): Running<P, V, W, A> {
  const { susp, result } = k;
  const resumeState = ctx.state;
  const history: (readonly [any, ModelEditState<V>])[] = [...susp.history, [result, resumeState]];
  const live = susp.live;
  if (live !== null) {
    // First resumption: continue the suspended generator itself.
    susp.live = null;
    live.cell.target = ctx.cell;
    return { origin: susp.origin, history, gen: live.gen, cell: live.cell, res: live.gen.next(result) };
  }
  // Later resumptions: replay the script from its start.
  const origin = susp.origin;
  const cell = new ForwardCell<V>(ctx.cell);
  cell.state = origin.start;
  const gen = origin.script(new ModelEditCtx<V, W>(origin.cls, origin.prsm, cell));
  let res = gen.next();
  for (const [r, st] of history) {
    if (res.done) {
      throw new Error("UserScript replay: the script finished early. " +
        "Scripts must be deterministic apart from their instructions.");
    }
    cell.state = st;
    res = gen.next(r);
  }
  return { origin, history, gen, cell, res };
}

/** Convert a running script to its next step. */
function toScriptStep<P, V, W, A>(running: Running<P, V, W, A>): ScriptStep<P, V, W, A> {
  const res = running.res;
  if (res.done) return { tag: "Pure", _0: res.value };
  const susp: Suspension<P, V, W, A> = {
    origin: running.origin,
    history: running.history,
    live: { gen: running.gen, cell: running.cell },
  };
  return { tag: "Free", _0: res.value, _1: (r: any) => scriptContinuation(susp, r) };
}

/** The continuation script: resume (or replay) the suspension with the result. */
function scriptContinuation<P, V, W, A>(susp: Suspension<P, V, W, A>, result: any): ModelScriptAct<P, V, W, A> {
  const k: Resumption<P, V, W, A> = { susp, result };
  const act = function* (ctx: ModelEditCtx<V, W>): ModelScript<P, V, A> {
    // Run as an ordinary script (e.g. with `yield*`): pass the remaining instructions on.
    const running = resumeScript(ctx, k);
    let res = running.res;
    for (;;) {
      if (res.done) return res.value;
      let r: any;
      try {
        r = yield res.value;
      } catch (err) {
        res = running.gen.throw(err);
        continue;
      }
      res = running.gen.next(r);
    }
  };
  return Object.assign(act, { [resumptionKey]: k });
}

/**
 * TypeScript: Haskell `runFreeT (stepScript script)`, a `ModelEdit` action. Runs the script in
 * `ctx` up to its first instruction (or to its end) and returns that layer. The continuation in
 * a `Free` result is multi-shot (see the module header). Errors thrown by the script propagate
 * as from any `ModelEdit` action.
 *
 * The interpreter evaluates `runModelEdit(cls, identity(), state, (c) => stepScript(c, script))`
 * and then, for a `Free` step, `runModelEdit(cls, identity(), newState, (c) => stepScript(c, step._1(r)))`.
 */
export function stepScript<P, V, W, A>(ctx: ModelEditCtx<V, W>, script: ModelScriptAct<P, V, W, A>): ScriptStep<P, V, W, A> {
  const k = (script as { [resumptionKey]?: Resumption<P, V, W, A> })[resumptionKey];
  if (k !== undefined) return toScriptStep(resumeScript(ctx, k));
  const cell = new ForwardCell<V>(ctx.cell);
  const origin: ScriptOrigin<P, V, W, A> = { script, start: ctx.state, cls: ctx.cls, prsm: ctx.prsm };
  const gen = script(new ModelEditCtx<V, W>(ctx.cls, ctx.prsm, cell));
  return toScriptStep({ origin, history: [], gen, cell, res: gen.next() });
}

// ---------------------------------------------------------------------------------------------
// Script instructions

/**
 * Open the properties dialog for the argument, and return a function that will update
 * values with the edits that were made.
 *
 * If \"Cancel\" is clicked then this will return @Nothing@.
 *
 * If the dialog has an \"Apply\" button then the rest of the script will be run every time
 * the button is clicked. Scripts should ensure that they handle this correctly.
 */
export function* openProperties<P, V, W>(
  _ctx: ModelEditCtx<V, W>,
  /** The ID of the entity to be edited. */
  uuid: ModelId,
): UserScript<P, V, Maybe<[Entity<V>, ReferenceValues]>> {
  return yield ScriptProperties<P, V>(uuid);
}

/**
 * Open a specified "Dialog" for an arbitrary type. The caveats for "openProperties" apply
 * to this function as well.
 */
export function* openDialog<P, V, W, A>(
  _ctx: ModelEditCtx<V, W>,
  dialog: DialogSelector_<Model<V>, null, A>,
  v: A,
): UserScript<P, V, Maybe<A>> {
  return yield ScriptDialog<P, V, A>(dialog, v);
}

/** Given a model ID for a diagram of type @w@, open the diagram. */
export function* openDiagram<P, V, W>(
  cls: HasDiagrams<P, V>,
  ctx: ModelEditCtx<V, W>,
  modelId: ModelId,
): UserScript<P, V, void> {
  const r = try_(ctx, (c) => {
    goToEntity(c, modelId);
    return current(c);
  });
  if (r.tag === "Left") return throwUser(ctx, "The diagram has been deleted.");
  if (r.value.tag === "Nothing") return throwInternal(ctx, "Model root is not a diagram.");
  const ent = r.value.value;
  const entName = view(entityName(ctx.cls).dot(nameText), ent);
  const w = withBaseType(ctx, (c) => cls.getDiagramWrapper(c, ent));
  if (w.tag === "Nothing") return throwInternal(ctx, "\"" + entName + "\" is not a diagram.");
  yield ScriptOpenDiagram(w.value);
}

/** Open an entity in a diagram window. */
export function* openEditor<P, V, W>(_ctx: ModelEditCtx<V, W>, wrapper: EntityWrapper<P, V>): UserScript<P, V, void> {
  yield ScriptOpenDiagram(wrapper);
}

/**
 * The IO action will be performed. When it completes the result will be returned.
 * (The action may be asynchronous; the script receives the resolved value.)
 */
export function* performIO<P, V, W, A>(_ctx: ModelEditCtx<V, W>, act: () => A | Promise<A>): UserScript<P, V, A> {
  return yield ScriptPerformIO<P, V, A>(act);
}

/** Get the set of currently selected entities in the model. */
export function* getModelSelection<P, V, W>(_ctx: ModelEditCtx<V, W>): UserScript<P, V, S.Set<ModelId>> {
  return yield ScriptGetSelection;
}

/** Change the set of currently selected entities in the model. */
export function* setModelSelection<P, V, W>(_ctx: ModelEditCtx<V, W>, mIds: S.Set<ModelId>): UserScript<P, V, void> {
  yield ScriptSetSelection<P, V>(mIds);
}

/**
 * Display the hint in the bottom bar during the action, then reset it to the previous value
 * once the action exits.
 *
 * (TypeScript: the action is a generator of either monad, e.g. `withHint(ctx, txt, script)` or,
 * inside a Delta, `withHint(d.base, txt, yieldViews(d))`.)
 */
export function* withHint<P, V, W, Y, A>(
  _ctx: ModelEditCtx<V, W>,
  txt: string,
  act: Generator<Y, A, any>,
): Generator<Y | UserScriptFunctor<P, V>, A, any> {
  const oldHint: Maybe<string> = yield ScriptGetHint;
  yield ScriptSetHint<P, V>(Just(txt));
  const r = yield* act;
  yield ScriptSetHint<P, V>(oldHint);
  return r;
}

/** Clear the hint text. */
export function* clearHint<P, V, W>(_ctx: ModelEditCtx<V, W>): UserScript<P, V, void> {
  yield ScriptSetHint<P, V>(Nothing);
}

// ---------------------------------------------------------------------------------------------
// ** Common Operations

/**
 * Go to a "ModelId" with a known name. If it is not there then report its disappearance.
 *
 * This is commonly used after "openProperties" or "openDialog".
 */
export function* goBackToEntity<P, V, W>(ctx: ModelEditCtx<V, W>, uuid: ModelId, nm: string): UserScript<P, V, void> {
  const r = try_(ctx, (c) => goToEntity(c, uuid));
  if (r.tag === "Left") throwUser(ctx, nm + " has disappeared.");
}

/**
 * Ask the user for a value and insert it as an entity. Returns the name and "ModelId" of the new
 * entity if successful. The name of the template is used as the base for a new name which is
 * unique in the parent.
 */
export function* insertEntity<P, V, W>(
  ctx: ModelEditCtx<V, W>,
  /** Template entity. */
  value: V,
  /** Parent of new entity. */
  parent: ModelId,
): UserScript<P, V, Maybe<[Name, ModelId]>> {
  const cls = ctx.cls;
  goToEntity(ctx, parent);
  const nm1 = modelNewName(ctx, view(cls.name, value));
  const initEntity = mkEntity(ctx, set(cls.name, nm1, value));
  const uuid = initEntity.entityId;
  const props = yield* openProperties<P, V, W>(ctx, uuid);
  if (props.tag === "Nothing") {
    goToEntity(ctx, uuid);
    delete_(ctx);
    return Nothing;
  }
  const [newEntity, newRelations] = props.value;
  yield* goBackToEntity<P, V, W>(ctx, uuid, view(entityName(cls).dot(nameText), initEntity));
  const changed = S.toList(M.foldr(S.union, S.empty<ModelId>(), newRelations));
  for (const u of changed) recordModified(ctx, u);
  setData(ctx, view(entityProperties(cls), newEntity));
  putReferenceValues(ctx, initEntity, newRelations);
  const nm2 = currentName(ctx);
  return Just([Name(nm2), uuid] as [Name, ModelId]);
}

/**
 * Create a clone of a package or similar construct with children as a new child of the
 * current location. All the children are cloned recursively.
 *
 * Relations to enities within the cloned set are also duplicated. Relations to entities outside
 * the cloned set are updated according to their cardinality. Diagrams are cloned, with avatars
 * for entities within the cloned set being updated to refer to the clones.
 */
export function clonePackage<P, V, PM = any>(
  cls: HasDiagrams<P, V, PM>,
  ctx: ModelEditCtx<V, V>,
  /** Function for updating the package metadata with new model IDs. */
  metaUpdate: (f: (m: ModelId) => Maybe<ModelId>, pm: PM) => PM,
  /** Entity to be cloned. */
  ent: Entity<V>,
  /** New name for entity. */
  newName: Name,
): Entity<V> {
  const getEnt = (c: ModelEditCtx<V, V>, msg: string, modelId: ModelId): Entity<V> =>
    fromHere(c, (c1) => {
      goToEntity(c1, modelId);
      const e = current(c1);
      if (e.tag === "Nothing") return throwInternal(c1, msg);
      return e.value;
    });
  // Clone a single node with its children.
  const cloneTree = (c: ModelEditCtx<V, V>, f: (m: ModelId) => Maybe<ModelId>, t: Tree<Entity<V>>): Entity<V> =>
    fromHere(c, (c1) => {
      const e = t.rootLabel;
      const newIdM = f(e.entityId);
      if (newIdM.tag === "Nothing") return throwInternal(c1, "Cloned entity not in ID table.");
      const newId = newIdM.value;
      const newEnt = addEntity(c1, (parentId) =>
        set(entityParent<V>(), parentId,
          over(entityContents<V>().dot(cls._Package).dot(packageMeta<V, V, PM, PM>()), (pm: PM) => metaUpdate(f, pm),
            set(entityChildren<V>(), M.empty(), // Clear children so they can be added below.
              cls.diagramMapAvatars(f,
                { ...e, entityId: newId, entityCreated: thisChange() })))));
      goToEntity(c1, newEnt.entityId);
      for (const child of t.subForest) cloneTree(c1, f, child);
      return newEnt;
    });

  //  Get tree ready for cloning. IDs are original but the root is renamed.
  const entityTree = fromHere(ctx, (c) => {
    goToEntity(c, ent.entityId);
    return Node(set(entityName(cls), newName, ent), modelPackageForest(c));
  });
  const oldIds = flatten(entityTree).map((e) => e.entityId);
  const cloneMap = M.fromList<ModelId, ModelId>(oldIds.map((i) => [i, mkModelId(ctx)] as const));
  const cloneFunc = (u: ModelId): Maybe<ModelId> => M.lookup(u, cloneMap);
  const result = cloneTree(ctx, cloneFunc, entityTree);
  // Create new relations for the newly created entities. This is done after the tree clone
  // to ensure that all referenced entities exist.
  for (const [oldId, newId] of M.toList(cloneMap)) {
    const oldRefs = S.toList(queryRelations(ctx, (r) => NR.relations(oldId, r)));
    const newEnt = getEnt(ctx, "Cloned package includes root.", newId);
    for (const [oldTarget, refName] of oldRefs) {
      fromHere(ctx, (c) => {
        // If the old target has been cloned then ref the clone. Otherwise ref the old target.
        const tgt = M.lookup(oldTarget, cloneMap);
        const newTarget = tgt.tag === "Just" ? tgt.value : oldTarget;
        const newTargetEnt = getEnt(c, "Cloned entity references root.", newTarget);
        addCheckedRelation(c, refName, newEnt, newTargetEnt);
      });
    }
  }
  return result;
}

/**
 * Converts the output of "insertEntity" to a log format when the new ModelId is not required.
 *
 * (TypeScript: the Haskell result is in an arbitrary monad and has no effects, so this is a
 * pure function.)
 */
export function logInsertion<A>(r: Maybe<readonly [Name, A]>): Maybe<string> {
  if (r.tag === "Nothing") return Nothing;
  return Just("Insert " + view(nameText, r.value[0]));
}

/** Pop up a properties dialog for the entity. */
export function* editEntityProperties<P, V, W>(ctx: ModelEditCtx<V, W>, uuid: ModelId): UserScript<P, V, Maybe<string>> {
  goToEntity(ctx, uuid);
  const eName = currentName(ctx);
  const cur = current(ctx);
  if (cur.tag === "Nothing") return throwUser(ctx, "Root has no editable properties.");
  const oldRefs = queryRelations(ctx, (r) => getReferenceValues(uuid, r));
  const props = yield* openProperties<P, V, W>(ctx, uuid);
  if (props.tag === "Nothing") return Nothing;
  const [newEnt, newRefs] = props.value;
  yield* goBackToEntity<P, V, W>(ctx, uuid, eName);
  const changedRefs = compareReferenceValues(oldRefs, newRefs);
  for (const u of changedRefs) {
    fromHere(ctx, (c) => {
      goToEntity(c, u);
      currentIsModified(c);
    });
  }
  const changedVal = setData(ctx, view(entityProperties(ctx.cls), newEnt));
  putReferenceValues(ctx, newEnt, newRefs);
  if (changedVal || changedRefs.length > 0) return Just("Edit " + eName + " properties");
  return Nothing;
}

export function* deleteEntity<P, V, W>(ctx: ModelEditCtx<V, W>, uuid: ModelId): UserScript<P, V, Maybe<string>> {
  // ModelEdit monad
  goToEntity(ctx, uuid);
  const target = currentName(ctx);
  delete_(ctx);
  return Just("Delete " + target);
}

/**
 * Add a new element to a diagram as an avatar for a new entity in the model.
 *
 * During the rubber-band phase the diagram avatar will be given null "ModelId" and "DiagramId".
 * The drawing function should be able to cope with this. Once the points have been selected the
 * avatar will be recreated and inserted in the diagram with the "ModelId" of the entity it
 * represents.
 */
export function* newBoxAvatarTool<P, V, W, D>(
  d: DeltaCtx<D>,
  /** ID of the package which is going to have the new entity added. */
  parent: ModelId,
  /** Diagram avatar for the new item. */
  avatarFunc: (m: ModelId, dId: DiagramId, b: BoundBox) => D,
  /** Draw the new element given the two points. */
  drawFunc: (b: BoundBox) => Paint,
  /** The item to add. */
  newItem: V,
): Delta<D, Action<D>> {
  const drawShape = (p1: Point, p2: Point): Paint => drawFunc(mkBoundBox(p1, p2));
  const addShape = function* (p1: Point, p2: Point): Delta<D, void> {
    const base = scriptContext<V, W>(d);
    const newEnt = yield* insertEntity<P, V, W>(base, newItem, parent);
    if (newEnt.tag === "Nothing") return; // Cancel pressed in properties dialog.
    const [newName, modelId] = newEnt.value;
    yield* withHint<P, V, W, any, void>(base, "Enter details.", (function* (): Delta<D, void> {
      yield* addItem(d, (dgrmId) => avatarFunc(modelId, dgrmId, mkBoundBox(p1, p2)));
      yield* tellCheckpoint(d, "Add " + view(nameText, newName) + " to diagram");
    })());
  };
  const c1 = yield* withHint<P, V, W, any, Action<D>>(
    scriptContext<V, W>(d), "Click and drag to define the new shape.", yieldViews(d));
  // getCorners, as a loop.
  let act = c1;
  for (;;) {
    const cmd = act.actionCommand;
    switch (cmd.tag) {
      case "Select": {
        yield* addShape(
          movePoint(act.actionLocation, [-100, -50]),
          movePoint(act.actionLocation, [100, 50]),
        );
        return yield* yieldViews(d);
      }
      case "Drag": {
        const [p1, p2, act2] = yield* rubberBand(d, drawShape, act.actionLocation);
        yield* addShape(p1, p2);
        return act2;
      }
      default:
        act = yield* processSingleAction(d, drawShape, M.empty(), act);
    }
  }
}

export function* newArrowAvatarTool<P, V, W, D>(
  d: DeltaCtx<D>,
  /** ID of the package which is going to have the new entity added. */
  parent: ModelId,
  /** Diagram avatar for the new item. */
  avatarFunc: (m: ModelId, dId: DiagramId, s: LineShape) => D,
  /** The element to add. */
  newModelItem: V,
  /**
   * Update the model to match the new arrow. The entity already exists when this is called,
   * but any other actions (such as relationships with endpoints) should be handled here.
   */
  modelUpdateFunc: (d: DeltaCtx<D>, v: D) => Delta<D, void>,
): Delta<D, Action<D>> {
  goToEntity(scriptContext<V, W>(d), parent);
  const [mShape, action] = yield* getArrowPoints<P, V, W, D>(d, (dId, s) => avatarFunc(U.nil, dId, s));
  if (mShape.tag === "Just") {
    const shape = mShape.value;
    const base = scriptContext<V, W>(d); // Read again after the input actions (see `scriptContext`).
    goToEntity(base, parent);
    const ent = mkEntity(base, newModelItem);
    const newArrow = yield* addItem(d, (u) => avatarFunc(ent.entityId, u, shape));
    yield* modelUpdateFunc(d, newArrow);
    yield* tellCheckpoint(d, "Add " + view(entityName(base.cls).dot(nameText), ent));
    return action;
  }
  return action;
}

/** Read a sequence of points from the mouse and turn them into a line shape. */
function* getArrowPoints<P, V, W, D>(
  d: DeltaCtx<D>,
  /** Transient diagram element for drag animation. */
  arrowFunc: (dId: DiagramId, s: LineShape) => D,
): Delta<D, [Maybe<LineShape>, Action<D>]> {
  // A fixed but arbitrary UUID for the transient line.
  const transId: DiagramId = U.fromWords(0x585f9fe9, 0xa511a484, 0xf93f09bb, 0x274a2a10);
  const progressHint = "Click and drag to the next point. Finish with drag to target or single click.";
  const lineEnd2 = lineEnds.dot(_2<ConnectorEnd, ConnectorEnd>());
  const drawShape = (_p1: Point, _p2: Point): Paint => noPaint; // Only used when dragging anyway, so should never happen.
  const tellTransient = function* (v: Maybe<D>): Delta<D, void> {
    const vw = v.tag === "Just" ? yield* d.cls.itemView(d, v.value) : mempty_View<D>();
    yield* tellTransients(d, ViewSet(M.singleton(transId, vw)));
  };
  const dragShapeTo = function* (
    d1: DeltaCtx<D>,
    [transient, shape]: readonly [D, LineShape],
    act: Action<D>,
    dPos: readonly [number, number],
  ): Delta<D, void> {
    const pt = movePoint(act.actionLocation, dPos);
    const newEnd = yield* mkEndPoint(d1, "ConnectionTo", transient, pt);
    const finalShape = yield* lineUpdate(d1, set(lineEnd2, newEnd, shape));
    switch (act.actionCommand.tag) {
      case "Drag": {
        const trans = arrowFunc(transId, finalShape);
        const vw = yield* d1.cls.itemView(d1, trans);
        yield* tellTransients(d1, ViewSet(M.singleton(transId, vw)));
        break;
      }
      case "EndDrag":
        yield* tellTransients(d1, ViewSet(M.singleton(transId, mempty_View<D>())));
        break;
      default:
        break;
    }
  };
  const dragEnd = function* (shape1: LineShape, action1: Action<D>): Delta<D, [LineShape, Action<D>]> {
    const transient = arrowFunc(transId, shape1);
    const action2 = yield* processDrag1<D, readonly [D, LineShape]>(
      d,
      function* () {
        return [transient, shape1] as const;
      },
      dragShapeTo,
      action1,
    );
    const cmd2 = action2.actionCommand;
    const dragPoint = cmd2.tag === "Drag"
      ? movePoint(action2.actionLocation, cmd2._0) // Should never happen.
      : cmd2.tag === "EndDrag"
        ? movePoint(action2.actionLocation, cmd2._0)
        : action2.actionLocation;
    const end2 = yield* mkEndPoint(d, "ConnectionTo", transient, dragPoint);
    const shape2 = yield* lineUpdate(d, set(lineEnd2, end2, shape1));
    return [shape2, action2];
  };
  const pointAppend = (shape: LineShape, newEnd: ConnectorEnd): LineShape => {
    const [e1, e2] = shape._lineEnds;
    return mkLineShape([e1, newEnd], [...shape._lineMiddle, e2.connectorPoint]);
  };
  const getMorePoints = function* (shape0: LineShape, action0: Action<D>): Delta<D, [LineShape, Action<D>]> {
    let shape1 = shape0;
    let action1 = action0;
    for (;;) {
      const transient = arrowFunc(transId, shape1);
      switch (action1.actionCommand.tag) {
        case "EndDrag":
          action1 = yield* yieldViews(d);
          break;
        case "Drag": {
          const newEnd = yield* mkEndPoint(d, "ConnectionTo", transient, action1.actionLocation);
          const [shape2, action2] = yield* dragEnd(pointAppend(shape1, newEnd), action1);
          if (view(lineEnd2, shape2).tag === "Unconnected") {
            yield* tellTransient(Just(arrowFunc(transId, shape2)));
            shape1 = shape2;
            action1 = action2;
            break;
          }
          yield* tellTransient(Nothing);
          return [shape2, action2];
        }
        default:
          yield* tellTransient(Nothing);
          return [shape1, action1];
      }
    }
  };
  const execAction = function* (act0: Action<D>): Delta<D, [Maybe<LineShape>, Action<D>]> {
    let act = act0;
    for (;;) {
      if (act.actionCommand.tag === "Drag") {
        const pt1 = act.actionLocation;
        const arr = arrowFunc(transId, mkLineShape([Unconnected(pt1), Unconnected(pt1)], []));
        const end1 = yield* mkEndPoint(d, "ConnectionFrom", arr, pt1);
        const act1 = act;
        return yield* withHint<P, V, W, any, [Maybe<LineShape>, Action<D>]>(scriptContext<V, W>(d), progressHint,
          (function* (): Delta<D, [Maybe<LineShape>, Action<D>]> {
            const [shape, action2] = yield* dragEnd(mkLineShape([end1, Unconnected(pt1)], []), act1);
            if (view(lineEnd2, shape).tag === "Unconnected") {
              yield* tellTransient(Just(arrowFunc(transId, shape)));
              const [s3, a3] = yield* getMorePoints(shape, action2);
              return [Just(s3), a3];
            }
            yield* tellTransient(Nothing);
            return [Just(shape), action2];
          })());
      }
      act = yield* processSingleAction(d, drawShape, M.empty(), act);
    }
  };
  return yield* withHint<P, V, W, any, [Maybe<LineShape>, Action<D>]>(scriptContext<V, W>(d), "Click and drag to start the arrow.",
    (function* (): Delta<D, [Maybe<LineShape>, Action<D>]> {
      const action1 = yield* yieldViews(d);
      return yield* execAction(action1);
    })());
}

/** Add a new box element which is not associated with a new model entity. */
export function* newDiagramBoxTool<P, V, W, D, A>(
  d: DeltaCtx<D>,
  /** Default data to go inside the new element. */
  v1: A,
  /** Dialog to open (if any) when item is created. */
  dSel: DialogSelector_<Model<V>, null, A>,
  /** Diagram element. */
  newItemF: (dId: DiagramId, b: BoundBox, a: A) => D,
  /** Draw the new element. */
  drawF: (v: D) => Paint,
  /** Message for undo log. */
  msg: string,
): Delta<D, Action<D>> {
  return yield* withHint<P, V, W, any, Action<D>>(scriptContext<V, W>(d), "Click and drag to define the new shape.",
    (function* (): Delta<D, Action<D>> {
      const act = yield* yieldViews(d);
      let mShape: Maybe<BoundBox>;
      let act2: Action<D>;
      switch (act.actionCommand.tag) {
        case "Select": {
          const result = mkBox(
            movePoint(act.actionLocation, [-100, -50]),
            movePoint(act.actionLocation, [100, 50]),
          );
          mShape = Just(result);
          act2 = act;
          break;
        }
        case "Drag": {
          const [p1, p2, a2] = yield* rubberBand(
            d,
            (pa: Point, pb: Point) => drawF(newItemF(U.nil, mkBoundBox(pa, pb), v1)),
            act.actionLocation,
          );
          mShape = Just(mkBoundBox(p1, p2));
          act2 = a2;
          break;
        }
        default:
          mShape = Nothing;
          act2 = act;
      }
      if (mShape.tag === "Just") {
        const shape = mShape.value;
        const base = scriptContext<V, W>(d);
        yield* withHint<P, V, W, any, void>(base, "Enter details.", (function* (): Delta<D, void> {
          const r = yield* openDialog<P, V, W, A>(base, dSel, v1);
          if (r.tag === "Just") {
            const v2 = r.value;
            yield* addItem(d, (u) => newItemF(u, shape, v2));
            yield* tellCheckpoint(d, msg);
          }
        })());
      }
      return act2;
    })());
}

/** Add a new arrow which is not associated with a new model entity. */
export function* newDiagramArrowTool<P, V, W, D, A>(
  d: DeltaCtx<D>,
  /** Default data to go inside the new arrow. */
  v1: A,
  /** Dialog to open (if any) when item is created. */
  dialogM: Maybe<Dialog_<Model<V>, null, A>>,
  /** Diagram avatar for the new item. */
  newItemF: (dId: DiagramId, s: LineShape, a: A) => D,
  /** Message for undo log. */
  msg: string,
): Delta<D, Action<D>> {
  const [mShape, action] = yield* getArrowPoints<P, V, W, D>(d, (dId, s) => newItemF(dId, s, v1));
  if (mShape.tag === "Just") {
    const shape = mShape.value;
    const base = scriptContext<V, W>(d);
    if (dialogM.tag === "Just") {
      const dialog1: Dialog_<Model<V>, null, A> = { ...dialogM.value, dialogButtons: OkButton };
      const r = yield* openDialog<P, V, W, A>(base, (_e, _i) => Just(dialog1), v1);
      if (r.tag === "Just") {
        const v2 = r.value;
        yield* addItem(d, (u) => newItemF(u, shape, v2));
        yield* tellCheckpoint(d, msg);
      }
    } else {
      yield* addItem(d, (u) => newItemF(u, shape, v1));
      yield* tellCheckpoint(d, msg);
    }
    return action;
  }
  return action;
}

/** Tool for editing the view control (i.e. diagram appearance) dialog. */
export function viewControlTool<P, V, W, A, D>(
  /** The identity of this diagram. */
  modelId: ModelId,
  /** How to find the view data in the entity. */
  trav: Traversal<W, A>,
  /** Write updated view data back into the context. */
  storeView: (m: Model<V>, a: A, vc: ViewContext<D>) => ViewContext<D>,
  /** User dialog. */
  dialog: DialogSelector_<Model<V>, null, A>,
): DeltaTool<D> {
  return mkDeltaTool<D>("view-control", "Edit the diagram style", DeltaToolAction(mkScriptAction<D>(function* (d) {
    const base = scriptContext<V, W>(d);
    goToEntity(base, modelId);
    const prsm = usingTraversal(base, (_c, p) => p);
    const vcM = preview(_Just<Entity<V>>().dot(entityContents<V>()).dot(prsm).dot(trav), current(base));
    if (vcM.tag === "Just") {
      const vc = vcM.value;
      const model = getModel(base);
      const r = yield* openDialog<P, V, W, A>(base, dialog, vc);
      if (r.tag === "Nothing") return yield* yieldViews(d);
      const v2 = r.value;
      modifying(d, deltaContext<D>(), (c: ViewContext<D>) => storeView(model, v2, c));
        // (.=) is imported from Aeson not Lens, so using "modify" instead.
      modifyValue(base, (w: W) => set(trav, v2, w));
      yield* tellAll(d);
      yield* tellCheckpoint(d, "Diagram style edited.");
      return yield* yieldViews(d);
    }
    return yield* yieldViews(d); // Should never happen.
  })));
}

/**
 * Search for text in entities and select matches. The type matches other edit functions
 * for convenience, but it always returns @Nothing@.
 */
export function* findTextTool<P, V>(ctx: ModelEditCtx<V, V>): ModelScript<P, V, Maybe<string>> {
  type Find = readonly [boolean, string];
  const findDialog = Dialog("Find in Model", OkButton, accum(form<Model<V>, null, Find>("Vertical", [
    ["Case insensitive: ", focusing(_1<boolean, string>(), tickBox<Model<V>, null>())],
    ["Search for: ", focusing(_2<boolean, string>(), styled1("find-string", simpleTextBox<Model<V>, null>()))],
  ])));
  const findDefault: Find = [true, ""];
  const r = yield* openDialog<P, V, V, Find>(ctx, constantDialog(findDialog), findDefault);
  if (r.tag === "Nothing") return Nothing;
  const [caseBlind, needle] = r.value;
  if (T.isNull(needle)) {
    yield* setModelSelection<P, V, V>(ctx, S.empty<ModelId>());
    return Nothing;
  }
  const result = searchEntities(ctx, caseBlind, needle);
  yield* setModelSelection<P, V, V>(ctx, S.fromList(result.map((x) => x[0])));
  return Nothing;
}

/**
 * Where a many-to-one relationship exists between entities an update must
 * also delete any old relationship, otherwise the relationship will become many-to-many.
 *
 * Unlike "addCheckedRelation" this routine does not check the type of the relation, and so
 * can operate with only the UUIDs.
 */
export function updateManyToOne<V, W>(
  ctx: ModelEditCtx<V, W>,
  /** The relationship to be changed. */
  direction: NR.Relation,
  /** The ID of the item on the \"Many\" side of the relationship. */
  uuid: ModelId,
  /**
   * The new entity on the \"One\" side that the item will be connected to,
   * or "U.nil" for none.
   */
  newTarget: ModelId,
): void {
  fromHere(ctx, (c) => {
    const oldTargets = queryRelations(c, (r) => NR.relation(uuid, direction, r));
    if (!equals(S.toList(oldTargets), [newTarget])) { // No change means no-op.
      recordModified(c, uuid);
      for (const i of S.toList(oldTargets)) {
        recordModified(c, i);
        modifyRelations(c, (r) => NR.delete_(uuid, i, direction, r));
      }
      if (!U.isNil(newTarget)) {
        recordModified(c, newTarget);
        modifyRelations(c, (r) => NR.insert(uuid, newTarget, direction, r));
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// ** Stock Menus

export function cloneEntityMenuItem<P, V, W>(modelId: ModelId): MenuItem<ModelScriptAct<P, V, W, Maybe<string>>> {
  return menuItem<ModelScriptAct<P, V, W, Maybe<string>>>("Clone", function* (ctx) {
    goToEntity(ctx, modelId);
    const nm = currentName(ctx);
    const newEnt = cloneEntity(ctx);
    if (newEnt.tag === "Just") {
      yield* setModelSelection<P, V, W>(ctx, S.singleton(newEnt.value.entityId));
      return Just("Cloned " + nm);
    }
    return throwUser(ctx, "Could not clone " + nm);
  });
}

/** Context menu for entities in the model tree. */
export function entityMenu<P, V, W>(cls: EntityClass<V>, ent: Entity<V>): Menu<ModelScriptAct<P, V, W, Maybe<string>>> {
  type Item = ModelScriptAct<P, V, W, Maybe<string>>;
  if (isJust(cls.entityClone(ent, Name("dummy")))) { // Result function is never used.
    return Menu<Item>([[
      menuItem<Item>("Properties", (ctx) => editEntityProperties<P, V, W>(ctx, ent.entityId)),
      cloneEntityMenuItem<P, V, W>(ent.entityId),
      menuItem<Item>("Delete", (ctx) => deleteEntity<P, V, W>(ctx, ent.entityId)),
    ]]);
  }
  return Menu<Item>([[
    menuItem<Item>("Properties", (ctx) => editEntityProperties<P, V, W>(ctx, ent.entityId)),
    menuItem<Item>("Delete", (ctx) => deleteEntity<P, V, W>(ctx, ent.entityId)),
  ]]);
}

/** Context menu for diagrams in the model tree. */
export function diagramEntityMenu<P, V, W>(cls: HasDiagrams<P, V>, ent: ModelId): Menu<ModelScriptAct<P, V, W, Maybe<string>>> {
  type Item = ModelScriptAct<P, V, W, Maybe<string>>;
  return Menu<Item>([[
    menuItem<Item>("Open diagram", function* (ctx) {
      yield* openDiagram<P, V, W>(cls, ctx, ent);
      return Nothing;
    }),
    menuItem<Item>("Properties", (ctx) => editEntityProperties<P, V, W>(ctx, ent)),
    cloneEntityMenuItem<P, V, W>(ent),
    menuItem<Item>("Delete", (ctx) => deleteEntity<P, V, W>(ctx, ent)),
  ]]);
}

// ---------------------------------------------------------------------------------------------
// ** Stock Dialogs

/** Dialog for package names. Just a simple text field. */
export function packageNameDialog<E = any, W = any>(): Dialog_<E, W, Name> {
  return Dialog("Package name", OkButton,
    accum(focusing(nameText, validate((t: string) => !T.isNull(t), simpleTextBox<E, W>()))));
}

/** Dialog for diagram names. Just a simple text field. */
export function diagramNameDialog<E = any, W = any, D = any, DM = any>(): Dialog_<E, W, DiagramEntity<D, DM>> {
  return Dialog("Diagram name", OkButton,
    accum(
      focusing(diagramEntityName<D, DM>().dot(nameText),
        validate((t: string) => !T.isNull(t), simpleTextBox<E, W>()))));
}
