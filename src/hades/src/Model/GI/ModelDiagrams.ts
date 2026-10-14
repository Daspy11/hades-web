// Ported from hades/src/Model/GI/ModelDiagrams.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Model editor windows: the package tree, the property panel and the notebooks of diagram (and
 * view) editors, together with the interpreter that runs "ModelScript"s (popping up dialogs,
 * opening diagrams, changing the selection and the hint, performing IO) and feeds their model
 * updates back to the application.
 *
 * TypeScript port
 * ---------------
 * * **Dictionaries.** Functions with an `EntityClass v` constraint take the dictionary first:
 *   `interpretScript(cls, ...)`, `processModelScripts(cls, ...)`, `entityEditor(cls, ...)`,
 *   `openDiagramInBook(cls, ...)`, `editorWindows(cls, ...)` (where `cls` is the
 *   `Editable HadesRender v` and `EntityClass v` dictionary). Delta functions with an `Avatar`
 *   constraint ("diagramInsertSelection", "diagramInsertEntity") find it as `d.cls`.
 *   "renderForExport" takes the `Connectable d` dictionary of the diagram and the `EntityClass v`
 *   dictionary of the model (needed to run the "ModelScript" in which the diagram is drawn).
 * * **Scripts.** A "ModelScript" value is a `ModelScriptAct` (PORTING.md §7.5). The interpreter
 *   ("interpretScript") steps it with "stepScript" of "Model.Abstract.DiagramType", whose
 *   continuations may be resumed more than once (live first, by replay afterwards), so the
 *   *Apply* button of a dialog re-runs the rest of the script, as in Haskell.
 * * **Web: dialogs opened from inside a diagram Delta.** The diagram editor runs each batch of
 *   diagram actions in a script ("entityEditor": `hadesActionExecute` then
 *   "updateDiagramInModel"). Such a script cannot be replayed: the Delta stream processor it
 *   drives is consumed linearly. Its instructions are therefore marked ("fromDeltaScript"), and
 *   the interpreter shows the dialogs they open without an Apply button (`disableApply` /
 *   `disableApply1`), so their continuations run exactly once.
 * * **Web: `ScriptPerformIO`.** The IO thunk may return a Promise. The interpreter runs it from a
 *   `reactimate` handler; a synchronous result continues the script at once, a Promise is
 *   awaited first. IO exceptions (`IOError`, `DOMException`) become user errors, as Haskell's
 *   `Ex.try` of an `IOException` does.
 * * **Web: opening a diagram.** In Haskell the continuation of a `ScriptOpenDiagram` instruction
 *   is fed straight back into the script event (`fst <$> diagrams`), a cycle within one moment.
 *   The TypeScript FRP library cannot evaluate an event that depends on itself in the same moment,
 *   so the continuation goes through the same feedback event as the other instantaneous steps
 *   (it runs in the moment after the diagram has been opened).
 * * `MomentIO` functions are synchronous network-building functions; the "IO ()" that
 *   "openDiagramInBook" returns is a `() => void`.
 * * **Web: browser history.** "EditorOutput" has two extra members for `App.ModelMain`:
 *   `editorActiveEntity` (fires whenever a diagram or view becomes the active one) and
 *   `editorActivate(modelId, viewTag?)` (brings an open editor to the front and makes it active).
 *   Diagrams that are not open are opened by sending a script (`openDiagram`) through the
 *   `scriptE` argument of "editorWindows".
 * * Exported although internal in Haskell: everything except the local helpers of `where`
 *   clauses that need the enclosing variables (those are local functions).
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Cairo from "@/lib/GI/Cairo";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { zlibSync } from "fflate";
import {
  Just, Nothing, type Maybe, appendMaybe, fmapMaybe, fromMaybe, isJust, mapMaybe, maybe,
} from "@/lib/Data/Maybe";
import { Left, Right, type Either, fromRight, isRight } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import {
  _Just, assign, identity, modifying, preview, set, to, use, view, type Traversal,
} from "@/lib/Control/Lens";
import { absurd, ceiling, div, readIORef, round } from "@/lib/Prelude";
import { IOError, writeFileData } from "@/lib/System/IO";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type Changes, GadgetData, fmap_Changes, pure_Changes, reactimate1,
} from "@/banana-ui/base/Reactive/Banana/Common";
import {
  type Dialog_, type DialogSelector_, type Gadget_, Dialog, OkButton, arr, disableApply, disableApply1,
  gFirst, gPipe,
} from "@/banana-ui/base/Reactive/Banana/GadgetPrimitives";
import { message1, radio } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import {
  type GadgetOut, createDialog, mkDialogWidget, mkGtkPopupSelect, renderGadget, runDialog,
} from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { plainChanges, sameWidget } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Common";
import { behaviorLink, registerIOSignal4 } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { cannotHappen, errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import {
  type Action, type BoundBox, type Connectable, type Delta, type DeltaCtx as DeltaCtxT, type Diagram,
  type DiagramId, type Point as PointT, type Scale, type ViewContext, type ViewSet, DeltaCtx, NoBox,
  Point, append_BoundBox, boxHeight, boxWidth, deltaContext, deltaDiagram, deltaZoom, diagramModify,
  diagramOrder, growBox, mkDiagramState, mkScriptAction, pX, pY, startStreamT, streamStateT, tellAll,
  tellCheckpoint, tellItem, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type ExportType, type HadesActionResult, type HadesGtk, type HadesRender, catchFileError_,
  checkExtension, hadesActionExecute, hadesConfig, hadesState, makeBottomBar, makeDrawingGtk,
  makeGtkDeltaToolbar, renderStatic, renderStaticSize, runHadesRender,
} from "@/hades/src/Hades/GI";
import {
  type ActivationScript, type Avatar, type DiagramEntity, type Editable, type EntityMenu,
  type EntityWrapper, type ModelScript, type ModelScriptAct, type UserScriptFunctor, avatar,
  diagramEntityContents, diagramEntityData, keyCommands, performIO, promoteScript, sameEntityView,
  scriptContext, stepScript, updateDiagram,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelEditState, type ModelError,
  type ModelId, InternalError, ModelUpdate, current, currentName, entityContents, entityName,
  entityProperties, evalModelEdit, goToEntity, modelStartState, modifyValue, nameText, queryRelations,
  runModelEdit, setVariantData, show_ModelEditLog, show_ModelError, stateModel, throwUser, try_,
} from "@/hades/src/Model/Abstract/PackageTree";
import {
  type ReferenceValues, getReferenceValues, putReferenceValues, reflectiveDialog,
} from "@/hades/src/Model/Abstract/Properties";
import {
  type ActiveEntity, type BookManager, type DiagramExport, ActiveEntity as mkActiveEntity, allBooks,
  newBookManager,
} from "./Notebooks";
import {
  type GtkTreeInfo, type StockFunc, dragTargets, modelErrorWarning, modelErrorWarningOn, modelWidget,
  replaceGtkTree,
} from "./PackageTree";

export type { ActivationScript, EntityMenu, DiagramExport };

// ---------------------------------------------------------------------------------------------
// Local helpers (TypeScript)

/** Haskell `const` as a union combiner: the first occurrence wins. */
function constFirst<A>(a: A, _b: A): A {
  return a;
}

/** List concatenation, the `(++)` of `unionWith (++)`. */
function appendList<A>(a: readonly A[], b: readonly A[]): A[] {
  return [...a, ...b];
}

/** Haskell `show` of a `Maybe Text`. */
function showMaybeText(m: Maybe<string>): string {
  return m.tag === "Just" ? "Just " + T.showText(m.value) : "Nothing";
}

/** A thenable result of an IO thunk. */
function isPromiseLike(x: unknown): x is PromiseLike<unknown> {
  return x !== null && (typeof x === "object" || typeof x === "function") &&
    typeof (x as { then?: unknown }).then === "function";
}

/** Haskell `IOException`: file system errors of `@/lib/System/IO` and the browser. */
function isIOException(e: unknown): e is Error {
  return e instanceof IOError || (typeof DOMException !== "undefined" && e instanceof DOMException);
}

/** Haskell `Ex.displayException` of an `IOException`. */
function displayException(e: Error): string {
  if (typeof DOMException !== "undefined" && e instanceof DOMException) return e.name + ": " + e.message;
  return e.message;
}

/**
 * Web: marks the instructions of scripts that drive a diagram Delta (see the module header).
 * The interpreter shows the dialogs they open without an Apply button.
 */
const deltaInstructionKey: unique symbol = Symbol("ModelDiagrams.deltaInstruction");

/**
 * Web: pass the instructions of the script through, marked as coming from a diagram Delta (whose
 * continuations must not be run more than once).
 */
export function* fromDeltaScript<P, V, A>(gen: ModelScript<P, V, A>): ModelScript<P, V, A> {
  let res = gen.next();
  for (;;) {
    if (res.done) return res.value;
    let r: unknown;
    try {
      const marked: UserScriptFunctor<P, V> = Object.assign({}, res.value, { [deltaInstructionKey]: true });
      r = yield marked;
    } catch (err) {
      res = gen.throw(err);
      continue;
    }
    res = gen.next(r);
  }
}

/** Web: true if the instruction comes from a diagram Delta (see "fromDeltaScript"). */
export function isDeltaInstruction<P, V>(instr: UserScriptFunctor<P, V>): boolean {
  return (instr as { [deltaInstructionKey]?: boolean })[deltaInstructionKey] === true;
}

// ---------------------------------------------------------------------------------------------
// The script interpreter

/** A script and the state to run it from: Haskell `(ModelEditState v, ModelScript p v v a)`. */
export type StateScript<P, V, A> = readonly [ModelEditState<V>, ModelScriptAct<P, V, V, A>];

/**
 * The continuation of a properties dialog with its state:
 * Haskell `(ModelEditState v, Maybe (Entity v, ReferenceValues) -> ModelScript p v v a)`.
 */
export type PropertiesContinuation<P, V, A> = readonly [
  ModelEditState<V>,
  (r: Maybe<readonly [Entity<V>, ReferenceValues]>) => ModelScriptAct<P, V, V, A>,
];

/**
 * Union of all the things that can happen in a "ModelScript". Apart from an Error and a Result
 * these all include a model edit state and something that returns a continuation script.
 * The result of the specified operation is passed to this continuation.
 */
export type InterpreterResult<P, V, A> =
  /** An error occured. */
  | { readonly tag: "InterpreterError"; readonly _0: ModelError }
  /** The script returned an update to the model. */
  | { readonly tag: "InterpreterUpdate"; readonly _0: ModelUpdate<V, A> }
  /**
   * Properties dialog. State and continuation are passed to dialog as "k" parameter.
   *
   * (Web: the third member is false when the continuation must run only once, i.e. the dialog
   * gets no Apply button; see the module header.)
   */
  | {
    readonly tag: "InterpreterOpenProperties";
    readonly _0: readonly [PropertiesContinuation<P, V, A>, ModelId, boolean];
  }
  /**
   * Result from other dialog. @Left@ means no dialog to open, @Right@ carries output
   * events. (The `MomentIO` action is a function run while the network is being built.)
   */
  | {
    readonly tag: "InterpreterOpenDialog";
    readonly _0: () => Either<StateScript<P, V, A>, B.Event<StateScript<P, V, A>>>;
  }
  /** Continuation, and entity to open in a diagram window. */
  | { readonly tag: "InterpreterOpenEntity"; readonly _0: readonly [StateScript<P, V, A>, EntityWrapper<P, V>] }
  /** Continuation, and set of paths to set as selection in the model window. */
  | { readonly tag: "InterpreterSelection"; readonly _0: readonly [StateScript<P, V, A>, S.Set<ModelId>] }
  /** Continuation and text to set as hint in the bottom bar. */
  | { readonly tag: "InterpreterSetHint"; readonly _0: readonly [StateScript<P, V, A>, Maybe<string>] }
  /**
   * Execute the IO action. The result is the continuation. (Web: the action may return a
   * Promise of the continuation.)
   */
  | {
    readonly tag: "InterpreterIOAction";
    readonly _0: readonly [
      () => ModelScriptAct<P, V, V, A> | PromiseLike<ModelScriptAct<P, V, V, A>>,
      ModelEditState<V>,
    ];
  };

export function InterpreterError<P, V, A>(_0: ModelError): InterpreterResult<P, V, A> {
  return { tag: "InterpreterError", _0 };
}
export function InterpreterUpdate<P, V, A>(_0: ModelUpdate<V, A>): InterpreterResult<P, V, A> {
  return { tag: "InterpreterUpdate", _0 };
}
export function InterpreterOpenProperties<P, V, A>(
  _0: readonly [PropertiesContinuation<P, V, A>, ModelId, boolean],
): InterpreterResult<P, V, A> {
  return { tag: "InterpreterOpenProperties", _0 };
}
export function InterpreterOpenDialog<P, V, A>(
  _0: () => Either<StateScript<P, V, A>, B.Event<StateScript<P, V, A>>>,
): InterpreterResult<P, V, A> {
  return { tag: "InterpreterOpenDialog", _0 };
}
export function InterpreterOpenEntity<P, V, A>(
  _0: readonly [StateScript<P, V, A>, EntityWrapper<P, V>],
): InterpreterResult<P, V, A> {
  return { tag: "InterpreterOpenEntity", _0 };
}
export function InterpreterSelection<P, V, A>(
  _0: readonly [StateScript<P, V, A>, S.Set<ModelId>],
): InterpreterResult<P, V, A> {
  return { tag: "InterpreterSelection", _0 };
}
export function InterpreterSetHint<P, V, A>(
  _0: readonly [StateScript<P, V, A>, Maybe<string>],
): InterpreterResult<P, V, A> {
  return { tag: "InterpreterSetHint", _0 };
}
export function InterpreterIOAction<P, V, A>(
  _0: readonly [() => ModelScriptAct<P, V, V, A> | PromiseLike<ModelScriptAct<P, V, V, A>>, ModelEditState<V>],
): InterpreterResult<P, V, A> {
  return { tag: "InterpreterIOAction", _0 };
}

/** `instance (EntityClass v) => Show (InterpreterResult p v a)` */
export function show_InterpreterResult<P, V, A>(r: InterpreterResult<P, V, A>): string {
  switch (r.tag) {
    case "InterpreterError":
      return "InterpreterError " + show_ModelError(r._0);
    case "InterpreterUpdate":
      return "InterpreterUpdate " + "[" + r._0.updateEditLog.map(show_ModelEditLog).join(",") + "]";
    case "InterpreterOpenProperties":
      return "InterperterOpenProperties " + U.toText(r._0[1]);
    case "InterpreterOpenDialog":
      return "InterpreterOpenDialog ...";
    case "InterpreterOpenEntity": {
      const w = r._0[1];
      return w.tag === "DiagramWrapper"
        ? "InterpreterOpenEntity Diagram " + U.toText(w.wrappedEntityId)
        : "InterpreterOpenEntity View " + U.toText(w.wrappedEntityId);
    }
    case "InterpreterSelection":
      return "InterpreterSelection " + "[" + S.toList(r._0[1]).map(U.toText).join(",") + "]";
    case "InterpreterSetHint":
      return "InterpreterSetHint " + showMaybeText(r._0[1]);
    case "InterpreterIOAction":
      return "InterpreterIOAction ...";
    default:
      return absurd(r);
  }
}

export function getInterpreterError<P, V, A>(r: InterpreterResult<P, V, A>): Maybe<ModelError> {
  return r.tag === "InterpreterError" ? Just(r._0) : Nothing;
}

export function getInterpreterUpdate<P, V, A>(r: InterpreterResult<P, V, A>): Maybe<ModelUpdate<V, A>> {
  return r.tag === "InterpreterUpdate" ? Just(r._0) : Nothing;
}

export function getInterpreterOpenProperties<P, V, A>(
  r: InterpreterResult<P, V, A>,
): Maybe<readonly [PropertiesContinuation<P, V, A>, ModelId, boolean]> {
  return r.tag === "InterpreterOpenProperties" ? Just(r._0) : Nothing;
}

export function getInterpreterOpenDialog<P, V, A>(
  r: InterpreterResult<P, V, A>,
): Maybe<() => Either<StateScript<P, V, A>, B.Event<StateScript<P, V, A>>>> {
  return r.tag === "InterpreterOpenDialog" ? Just(r._0) : Nothing;
}

export function getInterpreterOpenEntity<P, V, A>(
  r: InterpreterResult<P, V, A>,
): Maybe<readonly [StateScript<P, V, A>, EntityWrapper<P, V>]> {
  return r.tag === "InterpreterOpenEntity" ? Just(r._0) : Nothing;
}

export function getInterpreterSelection<P, V, A>(
  r: InterpreterResult<P, V, A>,
): Maybe<readonly [StateScript<P, V, A>, S.Set<ModelId>]> {
  return r.tag === "InterpreterSelection" ? Just(r._0) : Nothing;
}

export function getInterpreterSetHint<P, V, A>(
  r: InterpreterResult<P, V, A>,
): Maybe<readonly [StateScript<P, V, A>, Maybe<string>]> {
  return r.tag === "InterpreterSetHint" ? Just(r._0) : Nothing;
}

export function getInterpreterIOAction<P, V, A>(
  r: InterpreterResult<P, V, A>,
): Maybe<readonly [() => ModelScriptAct<P, V, V, A> | PromiseLike<ModelScriptAct<P, V, V, A>>, ModelEditState<V>]> {
  return r.tag === "InterpreterIOAction" ? Just(r._0) : Nothing;
}

/**
 * Interpret incoming "ModelScript" events in a Reactive Banana circuit, including any
 * resulting pop-up dialogs.
 *
 * Returns an event for the results of a completed script, an event for updates to the selected
 * set of entities, and an event for updates to the hint text.
 *
 * @param widget Widget to act as parent for dialogs.
 * @param selection Set of selected entities.
 * @param scriptsIn The model editing scripts to execute and the model to apply them to.
 */
export function processModelScripts<V, A>(
  cls: EntityClass<V>,
  widget: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  book: BookManager<HadesRender, V>,
  selection: B.Behavior<S.Set<ModelId>>,
  modelC: Changes<Model<V>>,
  scriptsIn: B.Event<ModelScriptAct<HadesRender, V, V, A>>,
): [B.Event<ModelUpdate<V, A>>, B.Event<S.Set<ModelId>>, B.Event<Maybe<string>>, B.Event<ModelError>] {
  type P = HadesRender;
  type SS = StateScript<P, V, A>;
  // mdo
  const activateDiagram = (wrapper: EntityWrapper<P, V>): (() => void) =>
    openDiagramInBook(cls, iconTheme, book, wrapper, selection, modelC);
  const performIOAction = (
    resultH: B.Handler<SS>,
    [act, state]: readonly [() => ModelScriptAct<P, V, V, A> | PromiseLike<ModelScriptAct<P, V, V, A>>, ModelEditState<V>],
  ): void => {
    // Haskell `Ex.try act`, catching `IOException`s only.
    const failed = (ex: unknown): void => {
      if (!isIOException(ex)) throw ex;
      const msg = T.pack(displayException(ex));
      resultH([state, function* (c) {
        return throwUser(c, msg);
      }]);
    };
    let result: ModelScriptAct<P, V, V, A> | PromiseLike<ModelScriptAct<P, V, V, A>>;
    try {
      result = act();
    } catch (ex) {
      failed(ex);
      return;
    }
    // Web: an asynchronous action is awaited before the script continues.
    if (isPromiseLike(result)) {
      Promise.resolve(result).then((r) => resultH([state, r]), failed);
    } else {
      resultH([state, result]);
    }
  };

  const gen = B.fromPoll(newGenerator);
  // Some steps are instantaneous, so they must be fed back via a new event to prevent an
  // effect being simultaneous with its cause.
  const [nextE, nextH] = B.newEvent<SS>();
  const startB = B.liftA2B(modelStartState, gen, modelC.changesB);
  const newPropertyEventsRef: B.Event<[PropertiesContinuation<P, V, A>, Maybe<readonly [Entity<V>, ReferenceValues]>]> =
    B.lazyE(() => newPropertyEvents);
  const newDialogEventsRef: B.Event<SS> = B.lazyE(() => newDialogEvents);
  const hintBRef: B.Behavior<Maybe<string>> = B.lazyB(() => hintB);
  // scripts :: Event (ModelEditState v, ModelScript p v v a)
  const scripts: B.Event<SS> = [
    B.apply(B.mapB((st: ModelEditState<V>) => (s: ModelScriptAct<P, V, V, A>): SS => [st, s], startB), scriptsIn),
    // Haskell: `fst <$> diagrams` (the continuation after a diagram has been opened). Web: fed
    // back through `nextE` below (see the module header).
    nextE, // Continuations fed back through handlers.
    B.mapE(([[es, contF], r]: [PropertiesContinuation<P, V, A>, Maybe<readonly [Entity<V>, ReferenceValues]>]): SS =>
      [es, contF(r)], newPropertyEventsRef),
    newDialogEventsRef, // Continuation when dialog OK or Apply clicked.
  ].reduceRight((acc, e) => B.unionWith(constFirst, e, acc));
  const results = B.apply(
    B.liftA2B(
      (sel: S.Set<ModelId>, hint: Maybe<string>) => (ss: SS) =>
        interpretScript<P, V, A>(cls, widget, iconTheme, modelC, sel, hint, ss),
      selection,
      hintBRef,
    ),
    scripts,
  );
  const errors = B.filterJust(B.mapE(getInterpreterError, results));
  const properties = B.filterJust(B.mapE(getInterpreterOpenProperties, results));
  const dialogs = B.filterJust(B.mapE(getInterpreterOpenDialog, results));
  const diagrams = B.filterJust(B.mapE(getInterpreterOpenEntity, results));
  const newSelections = B.filterJust(B.mapE(getInterpreterSelection, results));
  const hints = B.filterJust(B.mapE(getInterpreterSetHint, results));
  const ioActions = B.filterJust(B.mapE(getInterpreterIOAction, results));
  const output = B.filterJust(B.mapE(getInterpreterUpdate, results));
  // Respond to different events.
  modelErrorWarningOn(widget, errors);
  const propertyUpdates = B.execute(B.mapE(
    (p: readonly [PropertiesContinuation<P, V, A>, ModelId, boolean]) => () =>
      popupPropertiesEvent(cls, widget, iconTheme, p),
    properties,
  ));
  const newPropertyEvents = B.switchE(B.accumE(
    B.never<[PropertiesContinuation<P, V, A>, Maybe<readonly [Entity<V>, ReferenceValues]>]>(),
    B.mapE((e: B.Event<[PropertiesContinuation<P, V, A>, Maybe<readonly [Entity<V>, ReferenceValues]>]>) =>
      (acc: B.Event<[PropertiesContinuation<P, V, A>, Maybe<readonly [Entity<V>, ReferenceValues]>]>) =>
        B.unionWith(constFirst, e, acc), propertyUpdates),
  ));
  const [nullDialogEvents, dialogUpdates] = B.split(B.execute(dialogs));
  const newDialogEvents = B.switchE(B.accumE(
    B.never<SS>(),
    B.mapE((e: B.Event<SS>) => (acc: B.Event<SS>) => B.unionWith(constFirst, e, acc), dialogUpdates),
  ));
  const hintB = B.stepper<Maybe<string>>(Nothing, B.mapE(([, h]: readonly [SS, Maybe<string>]) => h, hints));
  const diagramOpen = B.execute(B.mapE(([, w]: readonly [SS, EntityWrapper<P, V>]) => () => activateDiagram(w), diagrams));
  const stop1 = reactimate1(diagramOpen); // Make sure the "execute" happens.
  const stop2 = reactimate1(B.mapE((a: readonly [() => ModelScriptAct<P, V, V, A> | PromiseLike<ModelScriptAct<P, V, V, A>>, ModelEditState<V>]) =>
    () => performIOAction(nextH, a), ioActions));
  const stop3 = reactimate1(B.mapE(([k]: readonly [SS, Maybe<string>]) => () => nextH(k), hints));
  const stop4 = reactimate1(B.mapE(([k]: readonly [SS, S.Set<ModelId>]) => () => nextH(k), newSelections));
  const stop5 = reactimate1(B.mapE((k: SS) => () => nextH(k), nullDialogEvents));
  // Web: the continuation after opening a diagram (`fst <$> diagrams` in Haskell).
  const stop6 = reactimate1(B.mapE(([k]: readonly [SS, EntityWrapper<P, V>]) => () => nextH(k), diagrams));
  Gtk.onWidgetDestroy(widget, () => {
    stop1();
    stop2();
    stop3();
    stop4();
    stop5();
    stop6();
  });
  return [
    output,
    B.mapE(([, s]: readonly [SS, S.Set<ModelId>]) => s, newSelections),
    B.mapE(([, h]: readonly [SS, Maybe<string>]) => h, hints),
    errors,
  ];
}

/**
 * Compile the model extensions into a dialog selector and use that to display a dialog.
 *
 * (Web: the optional third member of the argument is false for a properties dialog whose
 * continuation must run only once: it gets no Apply button.)
 */
export function popupPropertiesEvent<V, C>(
  cls: EntityClass<V>,
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  [k, uuid, replayable = true]: readonly [readonly [ModelEditState<V>, C], ModelId, boolean?],
): B.Event<[readonly [ModelEditState<V>, C], Maybe<readonly [Entity<V>, ReferenceValues]>]> {
  type K = readonly [ModelEditState<V>, C];
  type EV = readonly [Entity<V>, ReferenceValues];
  const [state] = k;
  const model = stateModel(state);
  const found = M.lookup(uuid, model.modelContents);
  if (found.tag === "Nothing") {
    // Web: the warning is shown without waiting for it to be closed.
    void modelErrorWarning(parent, InternalError(T.pack("Missing entity: " + U.toText(uuid))));
    return B.never();
  }
  const ent = found.value;
  const refs = getReferenceValues(uuid, model.modelRelations);
  const v: EV = [ent, refs];
  let r: B.Event<[K, Maybe<Maybe<EV>>]>;
  const d = reflectiveDialog<V, null>(cls, () => Nothing)(model, Just(v));
  if (d.tag === "Nothing") {
    r = B.never();
  } else {
    const dialog: Dialog_<Model<V>, null, Maybe<EV>> = replayable ? d.value : disableApply(d.value);
    r = createDialog(parent, iconTheme, pure_Changes(model), [k, Just(v), dialog] as const);
  }
  return B.mapE(([k1, mv]: [K, Maybe<Maybe<EV>>]): [K, Maybe<EV>] =>
    [k1, fmapMaybe((x: Maybe<EV>) => fromMaybe(v, x), mv)], r);
}

/**
 * Interprets a script and returns the next externally visible action.
 *
 * @param selection Current selection set.
 * @param hint Current hint value.
 */
export function interpretScript<P, V, A>(
  cls: EntityClass<V>,
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  modelC: Changes<Model<V>>,
  selection: S.Set<ModelId>,
  hint: Maybe<string>,
  [state, script]: StateScript<P, V, A>,
): InterpreterResult<P, V, A> {
  const r = runModelEdit(cls, identity<V>(), state, (c: ModelEditCtx<V, V>) => stepScript(c, script));
  if (r.tag === "Left") return InterpreterError(r.value);
  const [{ updateValue: result, updateNewModel: newModel, updateEditLog: newLogs }, newState] = r.value;
  if (result.tag === "Pure") return InterpreterUpdate(ModelUpdate(result._0, newModel, newLogs));
  const instr = result._0;
  const nxt = result._1;
  // Web: instructions from a diagram Delta cannot be replayed (see the module header).
  const replayable = !isDeltaInstruction(instr);
  switch (instr.tag) {
    case "ScriptProperties":
      return InterpreterOpenProperties([[newState, (x) => nxt(x)], instr._0, replayable]);
    case "ScriptDialog": {
      const dSel: DialogSelector_<Model<V>, null, any> = replayable ? instr._0 : disableApply1(instr._0);
      const v = instr._1;
      return InterpreterOpenDialog(() => {
        const model = B.valueB(modelC.changesB);
        const d = dSel(model, v);
        if (d.tag === "Just") {
          const clicks = createDialog(parent, iconTheme, modelC, [nxt, v, d.value] as const);
          return Right(B.mapE(([f, x]: [(r: any) => ModelScriptAct<P, V, V, A>, Maybe<any>]): StateScript<P, V, A> =>
            [newState, f(x)], clicks));
        }
        return Left([newState, nxt(Just(v))] as const);
      });
    }
    case "ScriptOpenDiagram":
      return InterpreterOpenEntity([[newState, nxt(null)], instr._0]);
    case "ScriptGetSelection":
      // Faithful: the continuation runs from the state before this step (`state`, not
      // `newState`), as in Haskell, so model edits made earlier in the step are dropped.
      // ("getModelSelection" is not used anywhere in HADES.)
      return interpretScript(cls, parent, iconTheme, modelC, selection, hint, [state, nxt(selection)]);
    case "ScriptSetSelection":
      return InterpreterSelection([[newState, nxt(null)], instr._0]);
    case "ScriptGetHint":
      return interpretScript(cls, parent, iconTheme, modelC, selection, hint, [newState, nxt(hint)]);
    case "ScriptSetHint":
      return InterpreterSetHint([[newState, nxt(null)], instr._0]);
    case "ScriptPerformIO": {
      const act = instr._0;
      // `UserScript <$> act`
      return InterpreterIOAction([() => {
        const x = act();
        return isPromiseLike(x) ? Promise.resolve(x).then(nxt) : nxt(x);
      }, newState]);
    }
    default:
      return absurd(instr);
  }
}

// ---------------------------------------------------------------------------------------------
// Entity editors

/**
 * Create an entity editor linked to the model that contains the
 * entity. The return result is the active entity and an event which is triggered if
 * this diagram hyperlinks to another one.
 *
 * @param manager The notebook windows for new diagrams opened by this one.
 * @param selectionB The selected items in the model.
 * @param modelC The model that contains this diagram.
 */
export function entityEditor<V>(
  cls: EntityClass<V>,
  iconTheme: Gtk.IconTheme,
  manager: BookManager<HadesRender, V>,
  wrapper: EntityWrapper<HadesRender, V>,
  selectionB: B.Behavior<S.Set<ModelId>>,
  modelC: Changes<Model<V>>,
): Maybe<ActiveEntity<HadesRender, V>> {
  switch (wrapper.tag) {
    case "DiagramWrapper":
      return entityEditorDiagram<V, any, any>(cls, iconTheme, manager, wrapper, selectionB, modelC);
    case "ViewWrapper":
      return entityEditorView<V, any, any>(iconTheme, manager, wrapper, selectionB, modelC);
    default:
      return absurd(wrapper);
  }
}

/** "entityEditor": the DiagramWrapper case. */
function entityEditorDiagram<V, W, D>(
  cls: EntityClass<V>,
  iconTheme: Gtk.IconTheme,
  manager: BookManager<HadesRender, V>,
  wrapper: Extract<EntityWrapper<HadesRender, V>, { tag: "DiagramWrapper" }>,
  selectionB: B.Behavior<S.Set<ModelId>>,
  modelC: Changes<Model<V>>,
): Maybe<ActiveEntity<HadesRender, V>> {
  type P = HadesRender;
  // wrapper@(DiagramWrapper uuid diagram dPrism prsm dSel ctx menu toolbar)
  const dcls = wrapper.diagramClass as Avatar<P, V, W, D>;
  const uuid: ModelId = wrapper.wrappedEntityId;
  const diagram: Diagram<D> = wrapper.diagramToEdit;
  const dPrism: Traversal<W, DiagramEntity<D>> = wrapper.diagramEntityTraversal;
  const prsm: Traversal<V, W> = wrapper.diagramTraversal;
  const dSel: DialogSelector_<Model<V>, null, D> = wrapper.diagramDialog;
  const ctx: ViewContext<D> = wrapper.diagramContext;
  const menu: Maybe<(p: PointT) => import("@/banana-ui/base/Reactive/Banana/Menu").Menu<Action<D>>> = wrapper.diagramMenu;
  const toolbar = wrapper.diagramToolbar;

  const updateZoom = (newZoom: Scale): Action<D> => mkScriptAction<D>(function* (d) {
    assign(d, deltaZoom<D>(), newZoom);
    yield* tellAll(d);
    return yield* yieldViews(d);
  });
  // Store the modified diagram back into the model.
  const updateDiagramInModel = function* (
    c: ModelEditCtx<V, W>,
    modelUpdateH: B.Handler<readonly [HadesGtk<D>, readonly D[]]>,
    actionResult: HadesActionResult<D>,
  ): ModelScript<P, V, Maybe<string>> { // ModelScript monad
    if (isJust(actionResult.hadesActionCheckpoint)) {
      // Update the diagram in the model.
      const d = view(
        hadesState<D>().dot(to((m: HadesGtk<D>["_hadesState"]) => streamStateT(m))).dot(deltaDiagram<D>()),
        actionResult.hadesActionNewState,
      );
      void try_(c, (c1) => {
        // If this fails the diagram has been deleted, so it doesn't matter.
        goToEntity(c1, uuid);
        return modifyValue(c1, (w: W) => set(dPrism.dot(diagramEntityContents<D>()), d, w));
      });
    }
    // Update the diagram on the screen and feed the state back in to the diagram editor.
    yield* performIO<P, V, W, void>(c, () => {
      actionResult.hadesActionDraw();
      modelUpdateH([actionResult.hadesActionNewState, actionResult.hadesActionProperties]);
    });
    return actionResult.hadesActionCheckpoint;
  };
  // Emit an event to makeGtkPopupSelect for each item in the popup list.
  const diagramProperties = (parent: Gtk.Widget, events: B.Event<readonly D[]>): B.Event<readonly [DiagramId, D]> => {
    const [propertyItems, itemH] = B.newEvent<readonly [DiagramId, D]>();
    const stop = reactimate1(B.mapE((items: readonly D[]) => () => {
      for (const item of items) itemH([dcls.identifier(item), item]);
    }, events));
    Gtk.onWidgetDestroy(parent, stop);
    return B.filterJust(B.mapE(promoteMaybe, mkGtkPopupSelect(parent, iconTheme, modelC, dSel, propertyItems)));
  };
  const promoteMaybe = <A1, B1>([v1, mv2]: readonly [A1, Maybe<B1>]): Maybe<readonly [A1, B1]> =>
    mv2.tag === "Nothing" ? Nothing : Just([v1, mv2.value] as const);
  // Script action to update a property of an element on the diagram.
  const updatePropertyAction = ([u, v]: readonly [DiagramId, D]): Action<D> => mkScriptAction<D>(function* (d) {
    modifying(d, deltaDiagram<D>(), (dg: Diagram<D>) => diagramModify(() => v, u, dg));
    yield* tellItem(d, v);
    const desc = yield* d.cls.itemDescription(d, v);
    yield* tellCheckpoint(d, "Set properties of " + desc);
    return yield* yieldViews(d);
  });
  // When Refresh is clicked, update the appearance data.
  const updateAppearance: Action<D>[] = [mkScriptAction<D>(function* (d) {
    goToEntity(scriptContext<V, W>(d), uuid);
    const meta = preview(
      _Just<Entity<V>>().dot(entityContents<V>()).dot(prsm).dot(dPrism).dot(diagramEntityData<D>()),
      current(scriptContext<V, W>(d)),
    );
    if (meta.tag === "Nothing") return yield* yieldViews(d); // Should never happen.
    const ctx1 = use(d, deltaContext<D>());
    const ctx2 = avatar<P, V, W, D>(d).updateViewContext(scriptContext<V, W>(d), meta.value, ctx1);
    assign(d, deltaContext<D>(), ctx2);
    yield* tellAll(d);
    return yield* yieldViews(d);
  })];

  // mdo
  const style = hadesConfig(iconTheme);
  /* Create the diagram widget and set up the reactive circuit for edits. The diagram
    outputs are executed by "hadesActionExecute", which returns a value in the ModelScript
    monad. This has to sent out unevaluated so that any updates to the model can be applied
    by the caller. Unfortunately we need the evaluated result because it contains the
    continuation in hadesActionNewState and any element property dialogs we need to show.
    The only way to get these values back is to create a new event and use "performIO"
    to call the handler. This is done in "updateDiagramInModel", which also
    runs the screen update.

    I'm not sure if this is inspired design or a terrible kludge.
  */
  const [modelUpdateE, modelUpdateH] = B.newEvent<readonly [HadesGtk<D>, readonly D[]]>();
  // Refresh this diagram.
  const [refreshE, refreshH] = B.newEvent<null>();
  const hadesUpdateE = B.mapE(([h]: readonly [HadesGtk<D>, readonly D[]]) => h, modelUpdateE);
  const propertyDialogE = B.filterE(
    (ds: readonly D[]) => ds.length > 0,
    B.mapE(([, ds]: readonly [HadesGtk<D>, readonly D[]]) => ds, modelUpdateE),
  );
  const zoomInit = 1;
  const [toolbarWidget, toolbarActions] = makeGtkDeltaToolbar(dcls, toolbar(modelC));
  // Track zoom events.
  const isCurrentDiagram = B.stepper(false, B.mapE(
    (a: ActiveEntity<P, V>) => sameEntityView(wrapper, a.activeWrapper),
    manager.bookManagerActiveEvent,
  ));
  const zoomE = B.unionWith(
    constFirst,
    B.mapE((h: HadesGtk<D>) => view(deltaZoom<D>(), streamStateT(view(hadesState<D>(), h))), hadesUpdateE), // Mouse zoom.
    B.whenE(isCurrentDiagram, manager.bookManagerZoom), // Zoom from the bottom bar.
  );
  const zoomB = B.stepper<Scale>(zoomInit, zoomE);
  // Track Hades state, including the Delta script continuation. A refresh event resets
  // this to the initial state.
  const hadesBRef: B.Behavior<HadesGtk<D>> = B.lazyB(() => hadesB);
  const [drawingWidget, hadesInit, diagramActions] =
    makeDrawingGtk<D>(dcls, diagram, ctx, menu, keyCommands<D>(), style, zoomInit, hadesBRef);
  const hadesB = B.stepper(hadesInit, B.unionWith(constFirst, B.constE(hadesInit, refreshE), hadesUpdateE));
  const newModelE = plainChanges(drawingWidget, modelC.changesB);
  // newModelE must fire *after* the model behavior changes. Hence plainChanges is used
  // to introduce a delay.
  const dropEvent = drawingDragAndDrop<D>(hadesInit.hadesCanvas, selectionB);
  const diagramPropertyUpdatesRef: B.Event<readonly [DiagramId, D]> = B.lazyE(() => diagramPropertyUpdates);
  const modelEdits1: B.Event<Action<D>[]> = [
    B.mapE((z: Scale) => [updateZoom(z)], B.filterApply(B.mapB((z0: Scale) => (z: Scale) => z0 !== z, zoomB), zoomE)),
    B.constE([mkScriptAction<D>(function* (d) {
      yield* updateDiagram<P, V, W, D>(d, dPrism);
      return yield* yieldViews(d);
    })], newModelE),
    diagramActions,
    dropEvent,
    toolbarActions,
    B.constE(updateAppearance, refreshE),
    B.mapE((uv: readonly [DiagramId, D]) => [updatePropertyAction(uv)], diagramPropertyUpdatesRef),
  ].reduceRight((acc, e) => B.unionWith(appendList, e, acc));
  const modelEdits = B.apply(
    B.mapB((h: HadesGtk<D>) => (acts: Action<D>[]) => (c: ModelEditCtx<V, W>) =>
      hadesActionExecute(c, h, acts) as unknown as ModelScript<P, V, HadesActionResult<D>>, hadesB),
    modelEdits1,
  );
  const updateE = B.mapE(
    (script: (c: ModelEditCtx<V, W>) => ModelScript<P, V, HadesActionResult<D>>) =>
      promoteScript<P, V, V, W, Maybe<string>>(prsm, (c) => fromDeltaScript((function* () {
        const r: HadesActionResult<D> = yield* script(c);
        return yield* updateDiagramInModel(c, modelUpdateH, r);
      })())),
    modelEdits,
  );
  const diagramPropertyUpdates = diagramProperties(drawingWidget, propertyDialogE);
  // Monitor model for diagram deletion.
  const modelHasDiagram = (m: Model<V>): boolean =>
    isRight(evalModelEdit(cls, identity<V>(), m, (c) => goToEntity(c, uuid)));
  const diagramDeleted = B.filterE((b: boolean) => !b, B.mapE(modelHasDiagram, modelC.changesE));
  const exportB = B.mapB(
    (h: HadesGtk<D>): Maybe<DiagramExport> => Just([renderStatic(style, h), renderStaticSize(h)] as const),
    hadesB,
  );
  const widget = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.boxPackStart(widget, toolbarWidget, false, false, 0);
  Gtk.boxPackStart(widget, drawingWidget, true, true, 0);
  let stop1: () => void = () => {};
  stop1 = reactimate1(B.constE(() => {
    Gtk.widgetDestroy(widget);
    stop1();
  }, diagramDeleted));
  const w = Gtk.toWidget(widget);
  const c = Gtk.toWidget(hadesInit.hadesCanvas);
  const r = mkActiveEntity<P, V>(
    w,
    c,
    () => refreshH(null),
    B.mapE((s: ModelScriptAct<P, V, V, Maybe<string>>) => [s], updateE),
    zoomB,
    exportB,
    wrapper,
  );
  // Events which mean this is the active diagram.
  const unitE = (e: B.Event<unknown>): B.Event<null> => B.constE(null, e);
  const stop2 = reactimate1(B.constE(
    () => manager.bookManagerActiveHandler(r),
    [unitE(diagramActions), unitE(dropEvent), unitE(toolbarActions)]
      .reduceRight((acc, e) => B.unionWith(constFirst, e, acc), B.never<null>()),
  ));
  Gtk.onWidgetDestroy(widget, stop2);
  return Just(r);
}

/** "entityEditor": the ViewWrapper case. */
function entityEditorView<V, St, I>(
  iconTheme: Gtk.IconTheme,
  _manager: BookManager<HadesRender, V>,
  wrapper: Extract<EntityWrapper<HadesRender, V>, { tag: "ViewWrapper" }>,
  _selectionB: B.Behavior<S.Set<ModelId>>,
  modelC: Changes<Model<V>>,
): Maybe<ActiveEntity<HadesRender, V>> {
  type P = HadesRender;
  type Script = ModelScriptAct<P, V, V, Maybe<string>>;
  // wrapper@(ViewWrapper _ _ state1 inputState gadget)
  const state1: St = wrapper.viewInitial;
  const inputState: Either<I, (m: Model<V>) => Maybe<I>> = wrapper.viewInput;
  const gadget: Gadget_<Model<V>, Script, [St, I]> = wrapper.viewGadget;
  // First argument is local feedback, second argument is application feedback.
  // Local value is taken if it is invalid. Otherwise application value is taken.
  // This ensures that feedback continues even when the gadget output is invalid.
  const mergeState = (localVal: GadgetData<[St, I]>, outerVal: I): [St, I] =>
    localVal._gdOk ? [localVal._gdValue[0], outerVal] : localVal._gdValue;

  const [refreshE, refreshH] = B.newEvent<null>();
  const model1 = B.valueB(modelC.changesB);
  let inputs: Maybe<readonly [I, Changes<I>]>;
  if (inputState.tag === "Left") {
    const v = inputState.value;
    inputs = Just([v, pure_Changes(v)] as const);
  } else {
    const inputF = inputState.value;
    const r = inputF(model1);
    inputs = r.tag === "Nothing"
      ? Nothing
      : Just([r.value, fmap_Changes((m: Model<V>) => fromMaybe(r.value, inputF(m)), modelC)] as const);
  }
  if (inputs.tag === "Nothing") return Nothing; // View data not found so do nothing.
  const [input1, inputC] = inputs.value;
  // mdo
  // Widgets
  const outer = Gtk.boxNew(Gtk.OrientationVertical, 3);
  // State update
  const userOutputBRef: B.Behavior<GadgetData<[St, I]>> = B.lazyB(() => userOutputB);
  // State events are ignored because merging them with the model behavior would
  // result in old model values being fed back in, cancelling the latest update.
  const loopB: B.Behavior<GadgetData<[St, I]>> = B.mapB(
    (x: [St, I]) => GadgetData(true, x),
    B.liftA2B(mergeState, userOutputBRef, inputC.changesB),
  );
  const widgetFocusInit = (_w: Gtk.Widget): void => {};
  const outputInit: GadgetOut<Script, [St, I]> = // {-# SCC "Original-view" #-}
    renderGadget(iconTheme, widgetFocusInit, model1, GadgetData(true, [state1, input1] as [St, I]), modelC,
      B.never(), loopB, gadget);
  const outputRefreshed: B.Event<GadgetOut<Script, [St, I]>> = B.execute(B.tag( // {-# SCC "outputRefreshed" #-}
    B.liftA2B(
      (model: Model<V>, initial: GadgetData<[St, I]>) => () =>
        renderGadget(iconTheme, widgetFocusInit, model, initial, modelC, B.never(), loopB, gadget),
      modelC.changesB,
      loopB,
    ),
    refreshE,
  ));
  const userOutputE = B.switchE(B.mapE((o: GadgetOut<Script, [St, I]>) => o.gadgetUser, outputRefreshed), outputInit.gadgetUser);
  const userOutputB = B.stepper(outputInit.gadgetInitial, userOutputE);
  // Widget display
  for (const w of outputInit.gadgetView) Gtk.boxPackStart(outer, w, true, true, 0);
  const stop = reactimate1(B.mapE((newOut: GadgetOut<Script, [St, I]>) => () => {
    for (const w of Gtk.containerGetChildren(outer)) Gtk.widgetDestroy(w);
    for (const w of newOut.gadgetView) Gtk.boxPackStart(outer, w, true, true, 0);
    Gtk.widgetShowAll(outer);
  }, outputRefreshed));
  Gtk.onWidgetDestroy(outer, stop);
  // Model edits
  // `fmap mconcat . sequence`: run the scripts in order and concatenate their descriptions.
  const sequenceScripts = (ws: readonly Script[]): Script => function* (c) {
    let acc: Maybe<string> = Nothing;
    for (const s of ws) acc = appendMaybe(T.append, acc, yield* s(c));
    return acc;
  };
  const updateE = B.mapE(sequenceScripts, // {-# SCC "updateE" #-}
    B.switchE(B.mapE((o: GadgetOut<Script, [St, I]>) => o.gadgetEvents, outputRefreshed), outputInit.gadgetEvents));
  // Output
  const widget = Gtk.toWidget(outer);
  const result = mkActiveEntity<P, V>(
    widget,
    widget,
    () => refreshH(null),
    B.mapE((s: Script) => [s], updateE),
    B.pureB(1), // Dialog widgets have no zoom.
    B.pureB(Nothing),
    wrapper,
  );
  return Just(result);
}

/** Configure the canvas to accept entities dropped from the model. */
export function drawingDragAndDrop<D>(
  /** Canvas where drop events can take place. */
  canvas: Gtk.DrawingArea,
  selection: B.Behavior<S.Set<ModelId>>,
): B.Event<Action<D>[]> {
  const targets = dragTargets();
  Gtk.widgetDragDestSet(canvas, [], targets, [Gdk.DragActionCopy]);
  Gtk.onWidgetDragMotion(canvas, (context, _x, _y, t) => {
    const goodSource = Gtk.widgetDragDestFindTarget(canvas, context, null) !== null;
    Gdk.dragStatus(context, goodSource ? [Gdk.DragActionCopy] : [], t);
    return true;
  });
  const dragDropEvent = registerIOSignal4(canvas, Gtk.onWidgetDragDrop,
    (_ctx: Gdk.DragContext, x: number, y: number, _t: number) =>
      [true, Point(Math.trunc(x), Math.trunc(y))] as const); // `fromIntegral` of the gint coordinates.
  return B.mapE(
    (act: (d: DeltaCtxT<D>) => Delta<D, void>): Action<D>[] => [mkScriptAction<D>(function* (d) {
      yield* act(d);
      return yield* yieldViews(d);
    })],
    B.apply(
      B.mapB((idSet: S.Set<ModelId>) => (pt: PointT) => (d: DeltaCtxT<D>) => diagramInsertSelection(d, idSet, pt), selection),
      dragDropEvent,
    ),
  );
}

/** Insert avatars for the current selection at the given point. */
export function* diagramInsertSelection<D>(d: DeltaCtxT<D>, idSet: S.Set<ModelId>, pt: PointT): Delta<D, void> {
  const ids = S.toList(idSet);
  if (ids.length === 0) return throwUser(scriptContext(d), "Nothing to insert.");
  if (ids.length === 1) return yield* diagramInsertEntity(d, pt, ids[0]);
  for (const modelId of ids) yield* diagramInsertEntity(d, pt, modelId);
  yield* tellCheckpoint(d, "Add " + T.pack(String(ids.length)) + " entities to diagram");
}

/**
 * Given the path of an entity in the model, create an avatar and drop it on the diagram
 * at the given point.
 */
export function* diagramInsertEntity<D>(d: DeltaCtxT<D>, pt: PointT, modelId: ModelId): Delta<D, void> {
  const base = scriptContext(d);
  goToEntity(base, modelId);
  const cur = current(base);
  if (cur.tag === "Nothing") return throwUser(scriptContext(d), "Cannot add the model root to a diagram.");
  const ent = cur.value;
  const nm = currentName(scriptContext(d));
  const r = yield* avatar<HadesRender, any, any, D>(d).entityAvatar(d, ent, pt);
  if (r.tag === "Nothing") return throwUser(scriptContext(d), nm + " cannot be added to this diagram.");
  yield* tellCheckpoint(d, "Add " + nm + " to diagram");
}

/**
 * If the diagram is already open then jump to it. Otherwise open it as a new page and return
 * its updates to the model. Returns the IO action which actually displays the diagram.
 *
 * @param manager The notebook where this editor is to be displayed.
 * @param wrapper Details of the diagram to be edited.
 * @param selection Set of selected entities.
 * @param model The model that contains the diagram.
 */
export function openDiagramInBook<V>(
  cls: EntityClass<V>,
  iconTheme: Gtk.IconTheme,
  manager: BookManager<HadesRender, V>,
  wrapper: EntityWrapper<HadesRender, V>,
  selection: B.Behavior<S.Set<ModelId>>,
  model: Changes<Model<V>>,
): () => void {
  const uuid = wrapper.wrappedEntityId;
  const closeDiagram = (widget: Gtk.Widget): void => {
    const oldContents = readIORef(manager.bookManagerContents);
    const newContents = oldContents.filter((a) => !sameWidget(widget, a.activeEntityWidget));
    manager.bookManagerModelHandler(newContents);
    // (Haskell forces `length newContents` here to avoid lazy retention of old pages.)
  };
  const diagramName: Changes<string> = fmap_Changes(
    (m: Model<V>) => maybe("-deleted-", (e: Entity<V>) => view(entityName(cls).dot(nameText), e), M.lookup(uuid, m.modelContents)),
    model,
  );
  const contents = readIORef(manager.bookManagerContents);
  const found = contents.find((a) => sameEntityView(wrapper, a.activeWrapper));
  if (found === undefined) {
    // Create a new entry in the book manager.
    const ed = entityEditor(cls, iconTheme, manager, wrapper, selection, model);
    if (ed.tag === "Nothing") return () => {}; // Nothing to show.
    const newDiagram = ed.value;
    const books = allBooks(manager);
    if (books.length === 0) {
      // Web: the error box is shown without waiting for it to be closed.
      return () => void errorBox(null, "There are no tabbed windows. Something has gone wrong.");
    }
    const sizes = books.map((b) => [b, Gtk.notebookGetNPages(b)] as const);
    // minimumBy is safe because "books" was checked for null. (The first of equal minima.)
    const display = sizes.reduce((best, s) => (s[1] < best[1] ? s : best))[0];
    const widget = newDiagram.activeEntityWidget;
    const canvas = newDiagram.activeEntityCanvas;
    const newContents = [newDiagram, ...contents];
    // The diagram name may change, so it is a behavior
    // and the relevant widgets are here.
    const lbl = newTabLabel(widget, diagramName.changesB);
    const startName = B.valueB(diagramName.changesB);
    const menuLbl = Gtk.labelNew(startName);
    behaviorLink(menuLbl, Gtk.labelSetLabel, diagramName.changesB);
    return () => {
      // Put the new diagram in the BookManager list AND THEN add the
      // widget to the GTK notebook. The change in the GTK notebook page
      // triggers the event to select the diagram update events.
      manager.bookManagerModelHandler(newContents);
      const n = Gtk.notebookAppendPageMenu(display, widget, lbl, menuLbl);
      Gtk.notebookSetTabDetachable(display, widget, true);
      Gtk.widgetShowAll(widget);
      Gtk.onWidgetDestroy(widget, () => {
        // Destroy labels. Doesn't seem to happen otherwise.
        closeDiagram(widget);
        Gtk.widgetDestroy(lbl);
        Gtk.widgetDestroy(menuLbl);
      });
      /*
      -- Any click will select this diagram.
      canvasTree <- widgetTree canvas
      forM_ canvasTree $ \w -> do
          void $ Gtk.onWidgetFocusInEvent w $ \_ -> do
            bookManagerActiveHandler manager newDiagram
            return False
          void $ Gtk.onWidgetButtonPressEvent w $ \_ -> do
            bookManagerActiveHandler manager newDiagram
            return False
      */
      Gtk.notebookSetCurrentPage(display, n);
      Gtk.widgetGrabFocus(canvas);
      manager.bookManagerActiveHandler(newDiagram);
    };
  }
  const newlyActive = found;
  return () => {
    const p1 = Gtk.widgetGetParent(newlyActive.activeEntityWidget);
    if (p1 === null) return; // Should never happen.
    const display = Gtk.castTo(Gtk.Notebook, p1);
    if (display === null) return; // Should never happen.
    const n = Gtk.notebookPageNum(display, newlyActive.activeEntityWidget);
    Gtk.notebookSetCurrentPage(display, n);
    Gtk.widgetGrabFocus(newlyActive.activeEntityCanvas);
    // Also triggers this diagram to become the primary focus for HADES.
  };
}

// ---------------------------------------------------------------------------------------------
// The model editor

/** The outputs from the model editor. */
export interface EditorOutput<V> {
  /** Updated versions of the model. */
  readonly editorUpdates: B.Event<ModelUpdate<V, Maybe<string>>>;
  /** A snapshot of the current state of the diagram, ready for export. */
  readonly editorDiagramExport: B.Behavior<Maybe<DiagramExport>>;
  /** The GTK tree model. This must be updated in parallel with the model. */
  readonly editorTreeInfo: GtkTreeInfo<V>;
  /** The GUI widget containing the editor. */
  readonly editorWidget: Gtk.Widget;
  /**
   * Web: fires whenever a diagram or view editor becomes the active one (the book manager's
   * active event), e.g. for browser-history navigation in `App.ModelMain`.
   */
  readonly editorActiveEntity: B.Event<ActiveEntity<HadesRender, V>>;
  /**
   * Web: bring the open editor of the entity (with the view tag, for a "ViewWrapper") to the
   * front of its notebook and make it the active one. Returns false if no such editor is open
   * (open it with an `openDiagram` script through the `scriptE` argument of "editorWindows").
   * Call it outside a network moment (e.g. from a `popstate` handler).
   */
  readonly editorActivate: (modelId: ModelId, viewTag?: string) => boolean;
}

/** The `EditorOutput` constructor. */
export function EditorOutput<V>(
  editorUpdates: B.Event<ModelUpdate<V, Maybe<string>>>,
  editorDiagramExport: B.Behavior<Maybe<DiagramExport>>,
  editorTreeInfo: GtkTreeInfo<V>,
  editorWidget: Gtk.Widget,
  editorActiveEntity: B.Event<ActiveEntity<HadesRender, V>> = B.never(),
  editorActivate: (modelId: ModelId, viewTag?: string) => boolean = () => false,
): EditorOutput<V> {
  return { editorUpdates, editorDiagramExport, editorTreeInfo, editorWidget, editorActiveEntity, editorActivate };
}

/**
 * When a new entity is selected look up the value and references for the property dialog.
 * (A `where` helper of "editorWindows".)
 */
export function selectionAdded(oldSet: S.Set<ModelId>, newSet: S.Set<ModelId>): Maybe<ModelId> {
  return S.lookupMin(S.difference(newSet, oldSet));
}

/**
 * Sequence two scripts and combine their change descriptions. (A `where` helper of
 * "editorWindows", for any `Monad m`; here for model scripts.)
 */
export function mergeScripts<P, V, W>(
  s1: ModelScriptAct<P, V, W, Maybe<string>>,
  s2: ModelScriptAct<P, V, W, Maybe<string>>,
): ModelScriptAct<P, V, W, Maybe<string>> {
  return function* (c) {
    const r1: Maybe<string> = yield* s1(c);
    const r2: Maybe<string> = yield* s2(c);
    if (r1.tag === "Just" && r2.tag === "Just") return Just(r1.value + ", " + r2.value);
    return appendMaybe(T.append, r1, r2);
  };
}

/**
 * Set up a model editor with the tree widget and empty notebook in a Horizontal Pane.
 *
 * @param window The top level window in which the editor is displayed.
 * @param picF The stock icons to use with each @v@.
 * @param modelInit The initial value of the model to display.
 * @param modelC The model.
 * @param refreshE Refresh button clicks.
 * @param scriptE Other scripts sent in by the outer GUI.
 */
export function editorWindows<V>(
  cls: Editable<HadesRender, V> & EntityClass<V>,
  window: Gtk.Window,
  iconTheme: Gtk.IconTheme,
  picF: StockFunc<V>,
  modelInit: Model<V>,
  modelC: Changes<Model<V>>,
  refreshE: B.Event<null>,
  scriptE: B.Event<ModelScriptAct<HadesRender, V, V, Maybe<string>>>,
): EditorOutput<V> {
  type P = HadesRender;
  type Script = ModelScriptAct<P, V, V, Maybe<string>>;
  type EV = readonly [Entity<V>, ReferenceValues];
  // Refresh action
  const refreshWindows = (manager: BookManager<P, V>, treeInfo: GtkTreeInfo<V>, model: Model<V>): void => {
    replaceGtkTree(cls, treeInfo, model);
    for (const a of readIORef(manager.bookManagerContents)) a.activeEntityRefresh();
  };
  // entityPropertyData :: (EntityClass v) =>
  //    ModelId -> (ModelId, Behavior (Maybe (Entity v, ReferenceValues)))
  const entityPropertyData = (modelId: ModelId): readonly [ModelId, B.Behavior<Maybe<EV>>] => {
    const extractData = (model: Model<V>): Maybe<EV> => { // Maybe monad
      const ent = fromRight(Nothing, evalModelEdit(cls, identity<V>(), model, (c) => {
        goToEntity(c, modelId);
        return current(c);
      }));
      if (ent.tag === "Nothing") return Nothing;
      const references = getReferenceValues(ent.value.entityId, model.modelRelations);
      return Just([ent.value, references] as const);
    };
    return [modelId, B.mapB(extractData, modelC.changesB)];
  };
  // ModelEdit action to update an entity from the property widget events.
  const updateFromProperty = ([modelId, mv]: readonly [ModelId, Maybe<EV>]): Script => function* (c) {
    if (mv.tag === "Nothing") return Nothing;
    const [ent, newRefs] = mv.value;
    goToEntity(c, modelId);
    const c1 = setVariantData(c, view(entityProperties(cls), ent));
    const oldRefs = queryRelations(c, (rels) => getReferenceValues(modelId, rels));
    let c2: boolean;
    if (equals(oldRefs, newRefs)) {
      c2 = false;
    } else {
      putReferenceValues(c, ent, newRefs);
      c2 = true;
    }
    const changed = c1 || c2;
    if (changed) return Just("Modified properties of " + view(entityName(cls).dot(nameText), ent));
    return Nothing;
  };
  const returnNothing: Script = function* (_c) {
    return Nothing;
  };

  // mdo
  const width = Gtk.windowGetSize(window)[0];
  // To set sensible widths for the children.
  const zoomERef: B.Event<Scale> = B.lazyE(() => zoomE);
  const [initialBook, manager] = newBookManager<P, V>(zoomERef, refreshE);
  const selectBRef: B.Behavior<S.Set<ModelId>> = B.lazyB(() => selectB);
  const [treeInfo, treeSelectEvent, treeScripts] = modelWidget<P, V>(cls, picF, modelInit, modelC, selectBRef);
  const treeWidget = treeInfo._2;
  // Track active diagram state.
  const stop1 = reactimate1(B.mapE((active: ActiveEntity<P, V>) => () => {
    const activeClass = "active-diagram"; // CSS class selector for the active diagram.
    const contents = readIORef(manager.bookManagerContents);
    for (const inactive of contents) {
      const style = Gtk.widgetGetStyleContext(inactive.activeEntityCanvas);
      Gtk.styleContextRemoveClass(style, activeClass);
    }
    const style = Gtk.widgetGetStyleContext(active.activeEntityCanvas);
    Gtk.styleContextAddClass(style, activeClass);
  }, manager.bookManagerActiveEvent));
  // Update model and export when a diagram is edited.
  const diagramScriptE = B.switchE(B.mapE(
    (as: readonly ActiveEntity<P, V>[]) => as.reduceRight(
      (acc: B.Event<Script[]>, a) => B.unionWith(appendList, a.activeEntityUpdates, acc),
      B.never<Script[]>(),
    ),
    manager.bookManagerModelUpdate,
  ));
  const diagramExport = B.switchB(
    B.pureB<Maybe<DiagramExport>>(Nothing),
    B.mapE((a: ActiveEntity<P, V>) => a.activeEntityExport, manager.bookManagerActiveEvent),
  );
  // Entity selection from tree widget and scripts.
  const scriptSelectionsRef: B.Event<S.Set<ModelId>> = B.lazyE(() => scriptSelections);
  const selectE = B.unionWith(S.union, treeSelectEvent, scriptSelectionsRef);
  const selectB = B.stepper(S.empty<ModelId>(), selectE);
  // Property editing widget
  const propertySelectionE1 = B.filterJust(B.apply(
    B.mapB((oldSet: S.Set<ModelId>) => (newSet: S.Set<ModelId>) => selectionAdded(oldSet, newSet), selectB),
    selectE,
  ));
  // New entity is selected. This can happen simultaneously with a model change, so the
  // event has to be delayed until the model behavior has been updated.
  const [propertySelectionE2, propertySelectionH2] = B.newEvent<ModelId>();
  const stop2 = reactimate1(B.mapE((m: ModelId) => () => propertySelectionH2(m), propertySelectionE1));
  const latestProperty = B.mapE(entityPropertyData, propertySelectionE2);
  const [propertiesFrame, propertiesUpdates, propertyScriptE] = mkDialogWidget<Model<V>, Script, ModelId, Maybe<EV>, Maybe<EV>>(
    iconTheme,
    () => {}, // mempty
    modelInit,
    modelC,
    B.pureB(reflectiveDialog<V, Script>(cls, (e: Entity<V>) => cls.editableDisplayMenu(Just(e)))),
    [U.nil, B.pureB<Maybe<EV>>(Nothing)],
    latestProperty,
  );
  // Web: activation requests for open editors (see "EditorOutput").
  const [modelUpdates, scriptSelections, hintE, exceptionE] = processModelScripts<V, Maybe<string>>(
    cls, treeWidget, iconTheme, manager, selectB, modelC,
    [
      treeScripts,
      B.mapE(updateFromProperty, propertiesUpdates),
      scriptE,
      B.mapE(
        (ss: readonly Script[]) => ss.reduceRight((acc: Script, s) => mergeScripts(s, acc), returnNothing),
        B.unionWith(appendList, propertyScriptE as B.Event<readonly Script[]>, diagramScriptE),
      ),
    ].reduceRight((acc: B.Event<Script>, e) => B.unionWith(mergeScripts, e, acc), B.never<Script>()),
  );
  // Refresh all open windows when Refresh is clicked or an exception occurs.
  const stop3 = reactimate1(B.mapE((m: Model<V>) => () => refreshWindows(manager, treeInfo, m), B.tag(modelC.changesB, refreshE)));
  const stop4 = reactimate1(B.mapE((m: Model<V>) => () => refreshWindows(manager, treeInfo, m), B.tag(modelC.changesB, exceptionE)));
  // Connect up bottom bar to script hints and diagram state zoom.
  const hintB = B.stepper<Maybe<string>>(Nothing, [
    hintE,
    B.constE<Maybe<string>>(Nothing, refreshE),
    B.constE<Maybe<string>>(Nothing, exceptionE),
  ].reduceRight((acc, e) => B.unionWith(constFirst, e, acc)));
  const zoomB = B.switchB(B.pureB<Scale>(1), B.mapE((a: ActiveEntity<P, V>) => a.activeEntityZoom, manager.bookManagerActiveEvent));
  const [bottomBar, zoomE] = makeBottomBar(hintB, zoomB);
  // Set up GTK widget hierarchy inside mainBox.
  const diagramFrame = Gtk.frameNew(null);
  Gtk.frameSetShadowType(diagramFrame, Gtk.ShadowTypeIn);
  Gtk.containerAdd(diagramFrame, initialBook);
  const diagramBox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.boxPackStart(diagramBox, diagramFrame, true, true, 0);
  Gtk.boxPackEnd(diagramBox, bottomBar, false, false, 0);
  const modelFrame = Gtk.frameNew(null);
  Gtk.frameSetShadowType(modelFrame, Gtk.ShadowTypeIn);
  const noAdjustment: Gtk.Adjustment | null = null;
  const scrolled = Gtk.scrolledWindowNew(noAdjustment, noAdjustment);
  Gtk.containerAdd(scrolled, treeWidget);
  Gtk.containerAdd(modelFrame, scrolled);
  const modelPaned = Gtk.panedNew(Gtk.OrientationVertical);
  Gtk.panedPack1(modelPaned, modelFrame, true, true);
  Gtk.panedPack2(modelPaned, propertiesFrame, true, true);
  const mainBox = Gtk.panedNew(Gtk.OrientationHorizontal);
  Gtk.panedPack1(mainBox, diagramBox, true, true);
  Gtk.panedPack2(mainBox, modelPaned, true, true);
  Gtk.panedSetPosition(mainBox, div(width * 8, 10));
  Gtk.onWidgetDestroy(mainBox, () => {
    stop1();
    stop2();
    stop3();
    stop4();
  });
  Gtk.widgetShowAll(mainBox);
  const w = Gtk.toWidget(mainBox);
  // Web: bring an open editor to the front and make it active (for browser history).
  const editorActivate = (modelId: ModelId, viewTag?: string): boolean => {
    const active = readIORef(manager.bookManagerContents).find((a) => {
      const aw = a.activeWrapper;
      if (aw.wrappedEntityId !== modelId) return false;
      return viewTag === undefined || (aw.tag === "ViewWrapper" && aw.viewTag === viewTag);
    });
    if (active === undefined) return false;
    const display = Gtk.castTo(Gtk.Notebook, Gtk.widgetGetParent(active.activeEntityWidget));
    if (display !== null) {
      Gtk.notebookSetCurrentPage(display, Gtk.notebookPageNum(display, active.activeEntityWidget));
    }
    Gtk.widgetGrabFocus(active.activeEntityCanvas);
    manager.bookManagerActiveHandler(active);
    return true;
  };
  return EditorOutput(modelUpdates, diagramExport, treeInfo, w, manager.bookManagerActiveEvent, editorActivate);
}

/*
Debugging code. Not currently used, so commented out to prevent warnings.

function printSelection<V>(cls: EntityClass<V>, model: Model<V>, sel: S.Set<ModelPath>): void {
  console.log("Selection = ");
  for (const path of S.toList(sel)) {
    const r = evalModelEdit(cls, identity<V>(), model, (c) => { goToTreePath(c, path); return currentName(c); });
    if (r.tag === "Left") console.log("   Path " + show(path) + " is broken: " + show_ModelError(r.value));
    else console.log("   Path " + show(path) + " point to " + show(r.value));
  }
}
*/

/**
 * Create a tab label widget containing the string and a close button. When the
 * close button is clicked the widget is destroyed.
 */
export function newTabLabel(widget: Gtk.Widget, textB: B.Behavior<string>): Gtk.Box {
  const startStr = B.valueB(textB);
  const label = Gtk.labelNew(startStr);
  behaviorLink(label, Gtk.labelSetLabel, textB);
  const boxWidget = Gtk.boxNew(Gtk.OrientationHorizontal, 1);
  const button = Gtk.buttonNewWithLabel("✖"); // U+2716: Heavy Multiplication X
  Gtk.setButtonRelief(button, Gtk.ReliefStyleNone);
  Gtk.boxPackStart(boxWidget, label, true, true, 0);
  Gtk.boxPackEnd(boxWidget, button, false, false, 0);
  Gtk.onButtonClicked(button, () => Gtk.widgetDestroy(widget));
  Gtk.widgetShowAll(boxWidget);
  return boxWidget;
}

// ---------------------------------------------------------------------------------------------
// Export

/** The export file types offered by "exportDrawing": name, type and file name pattern. */
export const exportTypes: readonly (readonly [string, ExportType, string])[] = [
  ["Scalable Vector Graphics (SVG)", "SVG", "*.svg"],
  ["Portable Network Graphics (PNG)", "PNG", "*.png"],
  ["Postscript (PS)", "Postscript", "*.ps"],
  ["Portable Document Format (PDF)", "PDF", "*.pdf"],
];

/** The dialog of "exportDrawing" that asks for the file type. */
export function exportTypeDialog(): Dialog_<null, never, readonly [string, ExportType, string]> {
  type X = readonly [string, ExportType, string];
  /*
  proc t -> do
    _ <- message1 "Select the type of image file to export:" -< ()
    radio $ const $ map (\v -> (v ^. _1, v)) exportTypes -< t
  */
  const g: Gadget_<null, never, X> = gPipe(
    arr<null, never, X, [null, X]>((t: X) => [null, t]),
    gFirst<null, never, null, null, X>(message1<null, never, null>("Select the type of image file to export:")),
    arr<null, never, [null, X], X>(([, t]) => t),
    radio<null, never, X>((_e: null) => exportTypes.map((v): readonly [string, X] => [v[0], v])),
  );
  return Dialog("Diagram Export Type", OkButton, g);
}

/**
 * Export a drawing to a file in one of the supported formats.
 *
 * (Web: async; the file is written through `@/lib/System/IO`, so the chosen path is a virtual
 * path, typically a download.)
 *
 * @param parent Widget in parent window for dialog.
 */
export async function exportDrawing(
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  /** Drawing to be exported. */
  [drawing, boxWidget]: DiagramExport,
): Promise<void> {
  const typeDialog = exportTypeDialog();
  // "head" is safe because exportTypes is constant
  const r = await runDialog(parent, iconTheme, typeDialog, null, exportTypes[0]);
  if (r.tag === "Nothing") return;
  const [typName, typ, glob] = r.value;
  const picFilter = Gtk.fileFilterNew();
  Gtk.fileFilterSetName(picFilter, typName);
  Gtk.fileFilterAddPattern(picFilter, glob);
  const chooser = Gtk.new_(Gtk.FileChooserNative, {
    doOverwriteConfirmation: true,
    action: Gtk.FileChooserActionSave,
    title: "Export Diagram",
    acceptLabel: "Export",
  });
  Gtk.fileChooserAddFilter(chooser, picFilter);
  const parentWin = Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(parent));
  if (parentWin !== null) Gtk.set(chooser, { transientFor: parentWin });
  const result = await Gtk.nativeDialogRun(chooser);
  if (result === Gtk.ResponseTypeAccept) {
    const mTarget = Gtk.fileChooserGetFilename(chooser);
    Gtk.nativeDialogDestroy(chooser);
    if (mTarget === null) return;
    const target = mTarget;
    await catchFileError_(parent, async () => {
      const width = boxWidth(boxWidget);
      const height = boxHeight(boxWidget);
      switch (typ) {
        case "SVG": {
          const path = checkExtension("svg", target);
          const [, svg] = Cairo.withSVGSurface(path, width, height, (srf) => Cairo.renderWith(srf, drawing));
          await writeFileData(path, svg, "image/svg+xml");
          return;
        }
        case "Postscript": {
          const path = checkExtension("ps", target);
          const [, ps] = Cairo.withPSSurface(path, width, height, (srf) => Cairo.renderWith(srf, drawing));
          await writeFileData(path, ps, "application/postscript");
          return;
        }
        case "PDF": {
          const path = checkExtension("pdf", target);
          const [, pdf] = Cairo.withPDFSurface(path, width, height, (srf) => Cairo.renderWith(srf, drawing));
          await writeFileData(path, pdf, "application/pdf");
          return;
        }
        case "PNG": {
          const path = checkExtension("png", target);
          const png = await Cairo.withImageSurface(Cairo.FormatARGB32, ceiling(width), ceiling(height), (srf) => {
            Cairo.renderWith(srf, drawing);
            return Cairo.surfaceWriteToPNG(srf);
          });
          await writeFileData(path, png, "image/png");
          return;
        }
        default:
          return absurd(typ);
      }
    });
  } else {
    Gtk.nativeDialogDestroy(chooser);
  }
}

/** The bytes (a, r, g, b) of a Cairo ARGB32 pixel. (A `where` helper of "renderOnPng".) */
export function getBytes(pixel: number): [number, number, number, number] {
  const b0 = pixel & 0xff;
  const b1 = (pixel >>> 8) & 0xff;
  const b2 = (pixel >>> 16) & 0xff;
  const b3 = (pixel >>> 24) & 0xff;
  return [b3, b2, b1, b0];
}

/**
 * Render the image to a PNG file which is returned as a lazy ByteString. Drawing operations
 * are in points.
 *
 * (TypeScript: the PNG bytes. The pixels are copied from the Cairo surface as the Haskell does,
 * i.e. with Cairo's premultiplied colour values, and encoded with a pHYs chunk for the
 * resolution, as JuicyPixels' `encodePngWithMetadata (mkDpiMetadata res)`.)
 */
export function renderOnPng(
  /** Resolution in pixels per inch. */
  res: number,
  /** Width and height in points. */
  [w, h]: readonly [number, number],
  /** Drawing for the PNG. Drawing unit is points regardless of resolution. */
  drawing: Cairo.Render<void>,
): Uint8Array {
  const zoom1 = res / 72; // 72 points per inch.
  const w1 = Math.max(1, ceiling(w * zoom1));
  const h1 = Math.max(1, ceiling(h * zoom1));
  return Cairo.withImageSurface(Cairo.FormatARGB32, w1, h1, (surface) => {
    Cairo.renderWith(surface, (cr) => {
      Cairo.scale(cr, zoom1, zoom1);
      drawing(cr);
    });
    const d2 = Cairo.imageSurfaceGetPixels(surface);
    const words = new DataView(d2.buffer, d2.byteOffset, d2.byteLength);
    const stride = Cairo.imageSurfaceGetStride(surface);
    const stride4 = div(stride, 4); // Taken from docs for Graphics.Rendering.Cairo.
    const readPix = (x: number, y: number): [number, number, number, number] => {
      const [a, r, g, b] = getBytes(words.getUint32((y * stride4 + x) * 4, true));
      return [r, g, b, a]; // PixelRGBA8 r g b a
    };
    return encodePngWithMetadata(round(res), w1, h1, readPix);
  });
}

/** CRC-32 of PNG chunks. */
const crcTable: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * JuicyPixels `encodePngWithMetadata (mkDpiMetadata dpi)` of an RGBA8 image given by its pixel
 * function: IHDR, pHYs (dots per metre = dpi * 10000 `div` 254), IDAT (filter 0), IEND.
 */
export function encodePngWithMetadata(
  dpi: number,
  w: number,
  h: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 4));
  let i = 0;
  for (let y = 0; y < h; y++) {
    raw[i++] = 0; // Filter type None.
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[i++] = r;
      raw[i++] = g;
      raw[i++] = b;
      raw[i++] = a;
    }
  }
  const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const chunk = (typ: string, data: Uint8Array): number[] => {
    const body = new Uint8Array(4 + data.length);
    for (let k = 0; k < 4; k++) body[k] = typ.charCodeAt(k);
    body.set(data, 4);
    return [...be32(data.length), ...body, ...be32(crc32(body))];
  };
  const dpm = div(dpi * 10000, 254);
  const ihdr = new Uint8Array([...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
  const phys = new Uint8Array([...be32(dpm), ...be32(dpm), 1]);
  const idat = zlibSync(raw);
  const out: number[] = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("pHYs", phys),
  ];
  const idatChunk = chunk("IDAT", idat);
  const iend = chunk("IEND", new Uint8Array(0));
  const result = new Uint8Array(out.length + idatChunk.length + iend.length);
  result.set(out, 0);
  result.set(idatChunk, out.length);
  result.set(iend, out.length + idatChunk.length);
  return result;
}

/**
 * Render a model for export. The result is a render operation scaled to points (1/72 inch) so
 * that text appears the correct size. The result also includes the size of the diagram in points.
 * The diagram is moved to the top left corner and 10
 * points of padding is added around each side.
 *
 * (TypeScript: `cls` is the `Connectable d` dictionary of the diagram, `vcls` the `EntityClass v`
 * dictionary of the model, needed to run the "ModelScript" that draws it.)
 *
 * @param prsm Relationship between diagram and model entities.
 * @param model Model containing this diagram.
 * @param ctx Application context, including how the diagram is to be rendered.
 * @param d Diagram to render.
 */
export function renderForExport<P, V, W, D>(
  cls: Connectable<D>,
  vcls: EntityClass<V>,
  iconTheme: Gtk.IconTheme,
  prsm: Traversal<V, W>,
  model: Model<V>,
  ctx: ViewContext<D>,
  d: Diagram<D>,
): [Cairo.Render<void>, [number, number]] {
  const drawForever = function* (dc: DeltaCtxT<D>): Delta<D, never> {
    for (;;) {
      yield* tellAll(dc);
      yield* yieldViews(dc);
    }
  };
  const staticScale = 72 / 96; // Convert from 96 dpi to 72 points per inch.
  const scalePoint = (s: number, p: PointT): PointT => Point(s * p._pX, s * p._pY);
  const scaleBox = (s: number, b: BoundBox): BoundBox =>
    b.tag === "NoBox" ? NoBox : { tag: "BoundBox", _0: scalePoint(s, b._0), _1: scalePoint(s, b._1) };

  const viewOrder = [...view(diagramOrder<D>(), d)].reverse();
  const dState = mkDiagramState(ctx, 1, d);
  // Safe because the diagram is not edited, so there is no risk of reuse of UUIDs.
  const result: ModelScriptAct<P, V, W, ViewSet<D>> = function* (c) {
    const [out] = yield* (startStreamT((st) => {
      const dc = new DeltaCtx<D>(cls, st);
      dc.base = c;
      return drawForever(dc);
    }, dState) as unknown as Generator<UserScriptFunctor<P, V>, [{ outViews: ViewSet<D> }, unknown], any>);
    return out.outViews;
  };
  // Interpret "result" as a ModelScript action.
  const r = evalModelEdit(vcls, prsm, model, (c) => stepScript(c, result));
  const noPaint: HadesRender<void> = () => {};
  let paint: HadesRender<void>;
  let bounds: BoundBox;
  if (r.tag === "Left") {
    [paint, bounds] = cannotHappen(T.pack(show_ModelError(r.value)), [noPaint, NoBox] as [HadesRender<void>, BoundBox]);
  } else if (r.value.tag === "Pure") {
    const drawing = r.value._0._0;
    const vs = mapMaybe((u: DiagramId) => M.lookup(u, drawing), viewOrder);
    paint = (env) => {
      for (const v of vs) v.viewDraw(env);
    };
    bounds = growBox(10, vs.map((v) => v.viewBox).reduce(append_BoundBox, NoBox));
    // Add 10 pixel slop around diagram.
  } else {
    [paint, bounds] = cannotHappen("getDrawingStatic: impossible UI action.", [noPaint, NoBox] as [HadesRender<void>, BoundBox]);
  }
  const boundsScaled = scaleBox(staticScale, bounds);
  const w = boxWidth(boundsScaled);
  const h = boxHeight(boundsScaled);
  const [xOff, yOff] = boundsScaled.tag === "NoBox"
    ? [0, 0]
    : [view(pX, boundsScaled._0), view(pY, boundsScaled._0)];
  const render: Cairo.Render<void> = (cr) => {
    const style = hadesConfig(iconTheme);
    Cairo.translate(cr, -xOff, -yOff);
    Cairo.scale(cr, staticScale, staticScale);
    runHadesRender(paint, style, cr);
    Cairo.showPage(cr);
  };
  return [render, [w, h]];
}
