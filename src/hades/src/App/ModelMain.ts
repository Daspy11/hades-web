// Ported from hades/src/App/ModelMain.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * The standard main program of a HADES model editor: the application window (from
 * `share/editor-ui.glade`), the File/Edit/Data/Help actions, undo and redo with history menus,
 * autosave and recovery, and the model editor itself (`editorWindows`).
 *
 * TypeScript port
 * ---------------
 * * The constraint set of "modelMain" (`Editable p v, EntityClass v, ToJSON v, FromJSON v,
 *   Reflective v, HasDiagrams p v, p ~ HadesRender, HasEvidence v`) is the dictionary
 *   `ModelMainClass<V>`, passed first: `modelMain(cls, descriptor)`. JSON goes through
 *   `JSON_Model(cls)` (`cls.entityJ`).
 * * `modelMain` is `async`: the welcome screen and the initial file read are awaited before the
 *   reactive network is built. It returns once the network is running.
 * * The network (`hadesNet`, an `mdo` block) is built synchronously; forward references use
 *   `B.lazyE`/`B.lazyB` (PORTING.md §8). Haskell `MomentIO` code that ran blocking IO
 *   (`confirmUnsaved`'s `mapEventIO`, the recovery file list) starts the async action from a
 *   `reactimate` and fires a new event when it completes (`// Web:`).
 * * Browser-native behaviour, each marked `// Web:` in the code:
 *   1. the command line file comes from the page URL (`?open=<example name or builtin path>`);
 *   2. the active diagram is recorded in the browser history and activated again on `popstate`;
 *   3. dropping a model file on the page opens it (after the unsaved-changes check);
 *   4. leaving the page with unsaved changes asks for confirmation (`windowSetUnloadGuard`);
 *   5. Quit shows a small "program finished" page instead of exiting the process;
 *   6. autosave files live in IndexedDB (`System.Hades.Autosave`);
 *   7. the help files (manual, support page) open in a new browser tab.
 * * Panic recovery (the `catch Gtk.main` loop) is the FRP library's error handler: an exception
 *   in a network action shows the error box and restarts the editor with the latest model.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gio from "@/lib/GI/Gio";
import * as GLib from "@/lib/GI/GLib";
import * as B from "@/lib/Reactive/Banana";
import * as J from "@/lib/Data/Aeson";
import * as L from "@/lib/Data/List";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as T from "@/lib/Data/Text";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe, catMaybes, fromMaybe, isJust } from "@/lib/Data/Maybe";
import { Left, type Either } from "@/lib/Data/Either";
import { Node, fmapForest, type Tree } from "@/lib/Data/Tree";
import type { UTCTime } from "@/lib/Data/Time";
import { _Just, _Left, _Right, _1, _2, identity, preview, review, view } from "@/lib/Control/Lens";
import { type IORef, newIORef, readIORef, writeIORef } from "@/lib/Prelude";
import { type FilePath, displayPath, readFileBytes, registerUpload, takeExtension } from "@/lib/System/IO";
import { getDataDir, isDataFile } from "@/lib/System/Paths";
import editorUiGlade from "@/hades/share/editor-ui.glade?raw";
import { type Generator as UUIDGenerator, newGenerator, uuidStreamIO } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type Dialog_, type DialogSelector_, ComboItem, Dialog, OkButton, PrismaticGadget, accum, arr, comboBox,
  boundedCombo, constantDialog, focusing, form, gPipe, gProd, message1, simpleFrame, tickBox, treeSelector,
  unionTab, validate,
} from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { type Changes, makeChanges, pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { Menu, menuItem } from "@/banana-ui/base/Reactive/Banana/Menu";
import { mkGtkPopup, mkGtkPopupSelect } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { behaviorLink, registerIOSignal, registerIOSignal1 } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Connect";
import { getDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { cannotHappen, errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import { mkGtkMenu } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Menu";
import { bananaCss } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Common";
import { type HasEvidence, Evidence } from "@/hades/evidence/Evidence/Model";
import { builtinDataPath, manualFile, welcomeScreen } from "@/hades/src/App/Welcome";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import {
  type FileStatus, catchFileError, checkExtension, fileStatusLock, fileStatusPath, forEditing, openExcelFile,
  openJsonFile, readOnlyStatus, saveAsFile, saveFile, writeAsFile,
} from "@/hades/src/Hades/GI/Saving";
import {
  type Editable, type HasDiagrams, type ModelScript, type ModelScriptAct, findTextTool, openDiagram, openDialog,
} from "@/hades/src/Model/Abstract/DiagramType";
import { type NameClashAction, importExcel, nameClashActionValues, show_NameClashAction } from "@/hades/src/Model/Abstract/Import";
import {
  type ModelExport, JSON_ModelExport, importEntities, importMetadata, makeExport,
} from "@/hades/src/Model/Abstract/ModelExport";
import {
  type Entity, type Model, type ModelEdit, type ModelEditCtx, type ModelId, type ModelUpdate, JSON_Model, ModelOther,
  ModelUpdate as mkModelUpdate, Name, current, currentChildren, emptyModel, entityContents, entityName,
  evalModelEdit, execModelEdit, goToEntity, goToRoot, modelPackageForest, modelStartState, nameText, queryModel,
  show_ModelError, throwUser,
} from "@/hades/src/Model/Abstract/PackageTree";
import { type DiagramExport, type EditorOutput, editorWindows, exportDrawing } from "@/hades/src/Model/GI/ModelDiagrams";
import { HistoryItem, processModelUpdates } from "@/hades/src/Model/GI/PackageTree";
import type { ActiveEntity } from "@/hades/src/Model/GI/Notebooks";
import { previewFolderClean } from "@/hades/src/Model/GI/Export";
import { extensionDialog, fieldDialog, referenceListDialog } from "@/hades/src/Model/Reflection/Dialogs";
import { edgeFromRelation, edgeToRelation, renameRelation } from "@/hades/src/Model/Reflection/NamedRelation";
import { type RefTypeTable, refTypeTableFromList, refTypeTableToList } from "@/hades/src/Model/Reflection/References";
import type { Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { type Field, type FieldId, type FieldTable, fieldName } from "@/hades/src/Model/Reflection/Types";
import type { Variant } from "@/hades/src/Model/Reflection/Values";
import {
  type AppName, autosaveFiles, autosaveGetContents, autosaveProcess,
} from "@/hades/src/System/Hades/Autosave";
import { dropEditLock } from "@/hades/src/System/Hades/EditLock";

type P = HadesRender;

/**
 * The dictionary for the constraints of "modelMain":
 * `(Editable p v, EntityClass v, ToJSON v, FromJSON v, Reflective v, HasDiagrams p v,
 * p ~ HadesRender, HasEvidence v)`.
 */
export type ModelMainClass<V> = Editable<HadesRender, V> & HasDiagrams<HadesRender, V> & HasEvidence<V>;

/** True if the model has changed and hence may need to be saved. */
export type Changed = boolean;

/** `Paths_hades.version` (hades.cabal), shown by `showVersion`. */
const version = "2.0.0";

/**
 * Parameters for the "modelMain" routine.
 *
 * There are two sets of icons used by the model editor:
 *
 * 1. Icons used by specialised entity types for toolbar buttons and the model tree.
 * These are passed in the 'programIconDirs' field, from where they are added to the GTK default
 * icon theme search path.
 *
 * 2. Icons associated with field values in the \"Data\" menu. These are stored in a separate global
 * icon theme accessed by `getDataIconTheme`. This theme is initially empty. The caller should
 * populate this theme using 'Gtk.iconThemeSetSearchPath' and 'Gtk.iconThemeSetCustomTheme'.
 */
export interface MainDescriptor<V> {
  /** Short alphanumeric identifier, used in pathnames and the like. */
  readonly programName: AppName;
  /** Shown in the title bar of the main window. */
  readonly programTitle: string;
  /** Save file extension (without the dot). */
  readonly programXtn: string;
  /** Stock icon names for type @v@. */
  readonly programStock: (e: Entity<V>) => string;
  /** Folders to be added to the default icon theme search path. */
  readonly programIconDirs: readonly FilePath[];
  /**
   * This will be applied after a model is opened. Use it to update models in old
   * formats. It MUST be idempotent.
   */
  readonly programAfterLoad: ModelEdit<V, V, void>;
  /**
   * Folder where application-specific documentation files are stored. This must contain
   * @LICENSE.txt@, either @Manual.pdf@ (Linux) or
   * @Manual.html@ (Windows), @Support.html@, @Credits.html and @welcome.svg@.
   * See 'manualFile' for details of the Windows PDF issue.
   */
  readonly programDocs: FilePath;
  /**
   * The program may provide some example files which will be offered for loading from the
   * welcome screen. This is the path of the folder containing them.
   */
  readonly programSamples: Maybe<FilePath>;
}

/** The `MainDescriptor` constructor. */
export function MainDescriptor<V>(
  programName: AppName,
  programTitle: string,
  programXtn: string,
  programStock: (e: Entity<V>) => string,
  programIconDirs: readonly FilePath[],
  programAfterLoad: ModelEdit<V, V, void>,
  programDocs: FilePath,
  programSamples: Maybe<FilePath>,
): MainDescriptor<V> {
  return {
    programName, programTitle, programXtn, programStock, programIconDirs, programAfterLoad, programDocs,
    programSamples,
  };
}

export interface CmdOpts {
  readonly fileToLoad: Maybe<FilePath>;
  readonly fontConfig: Maybe<FilePath>;
}
export function CmdOpts(fileToLoad: Maybe<FilePath>, fontConfig: Maybe<FilePath>): CmdOpts {
  return { fileToLoad, fontConfig };
}

/**
 * The command line: an optional "File to edit" argument and an optional
 * `--font-config`/`-f` "Path for fontConfig files".
 *
 * Web: there is no command line. The file comes from the page URL, `?open=<file>`, and the font
 * configuration path (unused in a browser) from `?font-config=<path>`. The file is resolved by
 * "resolveOpenArg".
 */
export function cmdOpts(search: string = typeof location === "undefined" ? "" : location.search): CmdOpts {
  const params = new URLSearchParams(search);
  const opt = (k: string): Maybe<string> => {
    const v = params.get(k);
    return v === null || v === "" ? Nothing : Just(v);
  };
  return CmdOpts(opt("open"), opt("font-config"));
}

/**
 * Web: the virtual path of a `?open=` argument. A `/builtin/...` path is used as it is; a bundled
 * data file path (`/src/dsm/share/examples/2 FMEA.dsm`) becomes its `/builtin/` path; anything
 * else names one of the program's examples (`2 FMEA` or `2 FMEA.dsm`). `Nothing` if it cannot
 * be resolved.
 */
export function resolveOpenArg<V>(descriptor: MainDescriptor<V>, arg: string): Maybe<FilePath> {
  if (arg.startsWith("/builtin/")) return Just(arg);
  if (arg.startsWith("/")) return isDataFile(arg) ? Just(builtinDataPath(arg)) : Nothing;
  if (descriptor.programSamples.tag === "Nothing") return Nothing;
  const name = takeExtension(arg) === "." + descriptor.programXtn ? arg : arg + "." + descriptor.programXtn;
  const path = descriptor.programSamples.value + "/" + name;
  return isDataFile(path) ? Just(builtinDataPath(path)) : Nothing;
}

/**
 * The application state is stored in two lists; undo and redo. Combined with the current state
 * (held elsewhere) this is somewhat akin to a list zipper structure. However the models and texts
 * move differently.
 *
 * ```
 *           Undo log              Redo log
 *    t __ t __ t __ t --------- t __ t __ t __ t
 *    v    v    v    v -\     /- v    v    v    v
 *                      \    /
 *                   Application
 * ```
 *
 * When an undo is performed the value is moved from the head of the undo log into the application
 * and the current application value is moved into the redo log. Meanwhile the text from the
 * head of the undo log is moved directly from the undo to the redo, so that text is now associated
 * with the value that the application will get from a redo.
 *
 * Thus when the application looks forward along the redo log or backwards along the undo log it
 * always sees the change text which leads to the associated value.
 */
export interface ModelHistory<V> {
  readonly undoLog: readonly HistoryItem<V>[];
  readonly redoLog: readonly HistoryItem<V>[];
}
export function ModelHistory<V>(undoLog: readonly HistoryItem<V>[], redoLog: readonly HistoryItem<V>[]): ModelHistory<V> {
  return { undoLog, redoLog };
}

/*  Debugging function. Commented out until needed.

function showHistory<V>(h: ModelHistory<V>): string {
  return "History {"
    + show(h.undoLog.map((i) => i.undoText)) + ", "
    + show(h.redoLog.map((i) => i.undoText)) + "}";
}
*/

export const emptyHistory: ModelHistory<any> = ModelHistory([], []);

/** Perform an undo. Returns @Nothing@ if there is no available undo step. */
export function undo<V>(
  /** Current state of the model. */
  model: Model<V>,
  /** The current undo state. */
  log1: ModelHistory<V>,
): Maybe<[Model<V>, ModelHistory<V>]> {
  if (log1.undoLog.length === 0) return Nothing;
  const [u1, ...undos] = log1.undoLog;
  const newItem = HistoryItem(model, u1.undoText);
  const log2 = ModelHistory(undos, [newItem, ...log1.redoLog]);
  return Just([u1.undoValue, log2]);
}

/** Perform a redo. Returns @Nothing@ if there is no available redo step. */
export function redo<V>(
  /** Current state of the model. */
  v: Model<V>,
  /** The current undo state. */
  log1: ModelHistory<V>,
): Maybe<[Model<V>, ModelHistory<V>]> {
  if (log1.redoLog.length === 0) return Nothing;
  const [r1, ...redos] = log1.redoLog;
  const newItem = HistoryItem(v, r1.undoText);
  const log2 = ModelHistory([newItem, ...log1.undoLog], redos);
  return Just([r1.undoValue, log2]);
}

/**
 * Add the item to the undo state. Clears the redo log because there is no concept of redoing
 * from the new state. If the new item has the same text as the most recent undo then it is
 * ignored. From the user point of view this avoids long strings of undo items of the
 * form \"Modified Foo\". Behind the scenes it also hides the fact that some entity editors emit
 * multiple updates during a single edit.
 */
export function recordUndo<V>(
  /** Limit on the number of items stored in the Undo list. */
  n: number,
  h: HistoryItem<V>,
  log1: ModelHistory<V>,
): ModelHistory<V> {
  let addUndo: readonly HistoryItem<V>[];
  if (log1.undoLog.length === 0) {
    addUndo = [h];
  } else {
    const latest = log1.undoLog[0];
    addUndo = latest.undoText === h.undoText
      ? log1.undoLog // Ignore more recent change in favour of older version.
      : [h, ...log1.undoLog];
  }
  return ModelHistory(L.take(n, addUndo), []);
}

/* Design note:

This implementation risks creating a memory leak if the undo list is not forced, as it will
simply build up an unlimited chain of thunks until the "take" is evaluated. The GUI will therefore
need to ensure that it does something in IO with the whole list produced by this function.
(TypeScript: the list is strict, so this does not arise.)
*/

/** Hard coded limit on the number of items in the Undo history. */
export const maxUndoLength = 30;

/**
 * When the application is first started this initializes the undo and redo GUI actions
 * to each emit an event value of "1".
 */
export function historyActions(actionMap: Gtk.Window): [B.Event<number>, B.Event<number>] {
  const undoAction = Gio.simpleActionNew("undo", null);
  const redoAction = Gio.simpleActionNew("redo", null);
  Gio.actionMapAddAction(actionMap, undoAction);
  Gio.actionMapAddAction(actionMap, redoAction);
  const undoClicked = registerIOSignal1(undoAction, Gio.onSimpleActionActivate, (_) => [null, 1] as const);
  const redoClicked = registerIOSignal1(redoAction, Gio.onSimpleActionActivate, (_) => [null, 1] as const);
  return [undoClicked, redoClicked];
}

/**
 * Updates the menus attached to the undo and redo buttons, and returns events for them.
 * The number is the number of changes to be undone or redone respectively. The \"other widgets\"
 * are other buttons or menu items that should be enbaled or disabled as appropriate.
 *
 * This returns its IO actions as a separate value so that they can reliably be executed when
 * this function is called from "execute".
 */
export function historyMenus<V>(
  /** Undo button. */
  undoButton: Gtk.MenuToolButton,
  /** Other undo widgets */
  otherUndo: readonly Gtk.Widget[],
  /** Redo button. */
  redoButton: Gtk.MenuToolButton,
  /** Other redo widgets. */
  otherRedo: readonly Gtk.Widget[],
  history: ModelHistory<V>,
): [B.Event<number>, B.Event<number>, () => void] {
  const hMenu = (items: readonly HistoryItem<V>[]): Menu<number> =>
    Menu([items.map((item, i) => menuItem(item.undoText, i + 1))]);
  let undoE: B.Event<number>;
  let undoM: () => void;
  if (history.undoLog.length !== 0) {
    const [undoMenu, undoSelection] = mkGtkMenu(hMenu(history.undoLog));
    undoE = undoSelection;
    undoM = () => {
      Gtk.menuToolButtonSetMenu(undoButton, undoMenu);
      Gtk.widgetSetSensitive(undoButton, true);
      for (const w of otherUndo) Gtk.widgetSetSensitive(w, true);
    };
  } else {
    undoE = B.never();
    undoM = () => {
      Gtk.widgetSetSensitive(undoButton, false); // SetMenu should take a Maybe for this.
      for (const w of otherUndo) Gtk.widgetSetSensitive(w, false);
    };
  }
  let redoE: B.Event<number>;
  let redoM: () => void;
  if (history.redoLog.length !== 0) {
    const [redoMenu, redoSelection] = mkGtkMenu(hMenu(history.redoLog));
    redoE = redoSelection;
    redoM = () => {
      Gtk.menuToolButtonSetMenu(redoButton, redoMenu);
      Gtk.widgetSetSensitive(redoButton, true);
      for (const w of otherRedo) Gtk.widgetSetSensitive(w, true);
    };
  } else {
    redoE = B.never();
    redoM = () => {
      Gtk.widgetSetSensitive(redoButton, false);
      for (const w of otherRedo) Gtk.widgetSetSensitive(w, false);
    };
  }
  return [undoE, redoE, () => {
    undoM();
    redoM();
  }];
}

/**
 * When an Undo or Redo is clicked or selected an event is triggered. This routine returns
 * the new state of the history and model. The history should be passed to "historyMenus" and the
 * model used to replace the current one.
 */
export function processHistoryClick<V>(
  /** Undo event. */
  undoE: B.Event<number>,
  /** Redo event. */
  redoE: B.Event<number>,
  /** The state of the model. */
  modelB: B.Behavior<Model<V>>,
  /** The model history. */
  historyB: B.Behavior<ModelHistory<V>>,
): B.Event<[Model<V>, ModelHistory<V>]> {
  type F = (m: Model<V>, h: ModelHistory<V>) => Maybe<[Model<V>, ModelHistory<V>]>;
  const step = (f: F, model: Model<V>, h: ModelHistory<V>, n: number): Maybe<[Model<V>, ModelHistory<V>]> => {
    if (n < 1) return Just([model, h]);
    const r = f(model, h);
    return r.tag === "Just" ? step(f, r.value[0], r.value[1], n - 1) : Nothing;
  };
  const undoResult = B.filterJust(B.apply(
    B.liftA2B((m: Model<V>, h: ModelHistory<V>) => (n: number) => step(undo, m, h, n), modelB, historyB), undoE));
  const redoResult = B.filterJust(B.apply(
    B.liftA2B((m: Model<V>, h: ModelHistory<V>) => (n: number) => step(redo, m, h, n), modelB, historyB), redoE));
  return B.unionWith((a, _b) => a, undoResult, redoResult);
}

// ---------------------------------------------------------------------------------------------
// Web: process-level state of the browser program.

/**
 * Web: the handler for exceptions escaping from the program's actions (the `catch Gtk.main`
 * of the Haskell). "modelMain" installs its panic recovery here; async actions report their
 * failures to it.
 */
let panic: (err: unknown) => void = (err) => console.error(err);

/**
 * Web: how long (ms) the active editor must stay the same before it is recorded in the browser
 * history (see "modelMain").
 */
const activeSettleTime = 100;

/**
 * Web: an input whose values are passed on to `act` once they have settled: `ms` milliseconds
 * after a value is pushed when none is pending, the latest value pushed since then is passed on
 * (earlier ones are dropped). `cancel` drops the pending value.
 */
export function whenSettled<A>(act: (a: A) => void, ms: number): { push: (a: A) => void; cancel: () => void } {
  let latest: { readonly value: A } | null = null;
  let scheduled = false;
  return {
    push: (a: A): void => {
      latest = { value: a };
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        const l = latest;
        latest = null;
        if (l !== null) act(l.value);
      }, ms);
    },
    cancel: (): void => {
      latest = null;
    },
  };
}

/** Web: true once Quit has been confirmed (the unload guard then lets the page go). */
let programHasFinished = false;

/** Web: replace the page by a short note once the program has quit (there is no process to end). */
function showProgramFinished(): void {
  if (typeof document === "undefined") return;
  const page = document.createElement("div");
  page.className = "hades-program-finished";
  page.style.cssText = "font-family: Cantarell, sans-serif; display: flex; flex-direction: column; "
    + "align-items: center; justify-content: center; height: 100vh; gap: 1em; color: #2e3436; background: #f6f5f4;";
  const msg = document.createElement("p");
  msg.textContent = "The program has finished. Reload the page to start again.";
  const btn = document.createElement("button");
  btn.textContent = "Reload";
  btn.style.cssText = "font: inherit; padding: 0.4em 1.2em;";
  btn.onclick = () => location.reload();
  page.append(msg, btn);
  document.body.replaceChildren(page);
  document.title = "Program finished";
}

/** Haskell `formatTime defaultTimeLocale "%d/%m/%y %R"` of a "UTCTime". */
function formatRecoveryTime(t: UTCTime): string {
  const d = new Date(t);
  const two = (n: number): string => String(n).padStart(2, "0");
  return two(d.getUTCDate()) + "/" + two(d.getUTCMonth() + 1) + "/" + two(d.getUTCFullYear() % 100)
    + " " + two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
}

/** Web: read and decode a model file without a file chooser (a dropped file). */
async function readJsonFile<A>(codec: J.FromJSON<A>, parent: Gtk.Widget, target: FilePath): Promise<Maybe<[FilePath, A]>> {
  const bytes = await catchFileError(parent, () => readFileBytes(target));
  if (bytes.tag === "Nothing") return Nothing;
  const doc = J.eitherDecode(codec, U.decodeUtf8(bytes.value));
  if (doc.tag === "Left") {
    await errorBox(parent, "File \"" + displayPath(target) + "\" was corrupt and could not be read.\n\n"
      + "Technical details: " + doc.value);
    return Nothing;
  }
  return Just([target, doc.value]);
}

/** The value that a file operation delivers: a new file status and/or a new model. */
type FileEvent<V> = readonly [Maybe<FileStatus>, Maybe<Model<V>>];

/** Standard main function for model editors. */
export async function modelMain<V>(cls: ModelMainClass<V>, descriptor: MainDescriptor<V>): Promise<void> {
  type Script = ModelScriptAct<P, V, V, Maybe<string>>;
  // Set working directory to be the user's document folder.
  // (Web: there is no working directory.)
  // Set environment variable to disable dynamically disappearing scrollbars.
  // (Web: GTK_OVERLAY_SCROLLING has no counterpart.)
  // Parse command line and set fontConfig environment if instructed.
  const options = cmdOpts();
  switch (options.fontConfig.tag) {
    case "Nothing": break;
    case "Just":
      // FONTCONFIG_PATH and FC_DEBUG: Web: the browser has no fontconfig, so this does nothing.
      break;
  }
  // Initialise GTK and add application-specific settings.
  Gtk.init(null);
  const dataDir = getDataDir("hades");
  // Set up application GUI
  // Web: the Glade file is bundled (`?raw` import) and registered for the builder.
  const gladePath = dataDir + "/editor-ui.glade";
  Gtk.registerBuilderText(gladePath, editorUiGlade);
  const builder = Gtk.builderNewFromFile(gladePath);
  const winObj = Gtk.builderGetObject(builder, "app-window");
  if (winObj === null) throw new Error("Cannot get app-window");
  const window = Gtk.unsafeCastTo(Gtk.ApplicationWindow, winObj);
  // Web: the application window fills the browser page.
  Gtk.setMainWindow(window);
  const systemIconTheme = Gtk.iconThemeGetDefault();
  const dataIconTheme = getDataIconTheme();
  { // Set up GTK parameters
    const iconPaths = [...descriptor.programIconDirs, dataDir];
    for (const p of iconPaths) Gtk.iconThemeAppendSearchPath(systemIconTheme, p);
    const pri = Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION;
    const screen = Gtk.windowGetScreen(window);
    const bc = bananaCss();
    if (bc !== undefined && bc !== null) Gtk.styleContextAddProviderForScreen(screen, bc as Gtk.CssProvider, pri);
    const hadesCss = Gtk.cssProviderNew();
    Gtk.cssProviderLoadFromPath(hadesCss, dataDir + "/hades-gtk.css");
    Gtk.styleContextAddProviderForScreen(screen, hadesCss, pri);
    Gtk.windowSetDefaultIconName("diametric");
    Gtk.set(window, {
      role: "/hades/Main",
      title: descriptor.programTitle + ": <unknown>",
    });
  }
  const getWidget = <W extends Gtk.GObject>(clsW: abstract new (...args: any[]) => W, id: string, err: string): W => {
    const o = Gtk.builderGetObject(builder, id);
    if (o === null) throw new Error(err);
    return Gtk.unsafeCastTo(clsW, o);
  };
  const bx = getWidget(Gtk.Box, "main-box", "Cannot get application main-box widget.");
  const undoButtonWidget = getWidget(Gtk.MenuToolButton, "undo-button", "Cannot get undo button.");
  const redoButtonWidget = getWidget(Gtk.MenuToolButton, "redo-button", "Cannot get undo button.");
  const undoMenuItem = getWidget(Gtk.Widget, "menu-undo", "Cannot get undo menu item.");
  const redoMenuItem = getWidget(Gtk.Widget, "menu-redo", "Cannot get redo menu item.");
  // modelContainer holds the model tree.
  const modelFrame = Gtk.frameNew(null);
  Gtk.boxPackEnd(bx, modelFrame, true, true, 0);
  // Web: mount the user interface now; the welcome screen below is a dialog that must be shown.
  Gtk.main();
  // Web: the command line file is the `?open=` argument of the page.
  const fileToLoad: Maybe<FilePath> = options.fileToLoad.tag === "Just"
    ? resolveOpenArg(descriptor, options.fileToLoad.value)
    : Nothing;
  if (options.fileToLoad.tag === "Just" && fileToLoad.tag === "Nothing") {
    await errorBox(window, "File \"" + options.fileToLoad.value + "\" was not found.");
  }
  // Show the Welcome screen unless this has been disabled or we have a command-line filename.
  const initialFilePath: Maybe<FilePath> = fileToLoad.tag === "Just"
    ? Just(fileToLoad.value)
    : await welcomeScreen(window, false, descriptor.programDocs, descriptor.programSamples);
  const loadInitial = async (): Promise<readonly [Maybe<FileStatus>, Model<V>]> => {
    if (initialFilePath.tag === "Nothing") return [Nothing, emptyModel(cls, "Model")];
    const target = initialFilePath.value;
    const text = await catchFileError(window, () => readFileBytes(target));
    if (text.tag === "Nothing") return [Nothing, emptyModel(cls, "Model")];
    const doc = J.eitherDecode(JSON_Model(cls), U.decodeUtf8(text.value));
    if (doc.tag === "Left") {
      // Web: the file is named by "displayPath" (a virtual path means nothing to the user).
      await errorBox(window, T.pack(
        "File \"" + displayPath(target) + "\" was corrupt and could not be read.\n\n"
        + "Technical details: " + doc.value));
      return [Nothing, emptyModel(cls, "Model")];
    }
    // Web: a `?open=` file is one of the bundled (read-only) files, so it is treated like a
    // built-in example from the welcome screen: an unsaved initial model. (The desktop took an
    // edit lock on a command line file here: `forEditing window Nothing (return $ Just (target, doc))`.)
    const userFile = false;
    if (userFile) {
      const r = await forEditing(window, Nothing, async () => Just([target, doc.value] as const));
      return r.tag === "Just" ? [Just(r.value[0]), doc.value] : [Nothing, emptyModel(cls, "Model")];
    }
    // Built-in example file. Treat as unsaved initial model.
    return [Nothing, doc.value];
  };
  const initialModel = await loadInitial();
  // Set working directory to be the user's document folder. This is needed for file dialogs to
  // be based in the right folder. (Web: no working directory.)
  // IORefs used to manage start-up and panic from outside Reactive Banana's MomentIO monad.
  const startupHandlerRef: IORef<(v: FileEvent<V>) => void> = newIORef((_v: FileEvent<V>) => {});
  const latestModel: IORef<Model<V>> = newIORef(initialModel[1]);
  // Web: the latest value of the "changed" flag, for the unload guard.
  let changedNow = false;
  // Web: browser history of the active diagram.
  let currentOutput: EditorOutput<V> | null = null;
  let currentModel: Model<V> = initialModel[1];
  let fireHistoryScript: (s: Script) => void = () => {};
  let fireDrop: (f: File) => void = () => {};
  // Web: each new editor gets a generation number; inputs shared by all editors (the window's
  // undo/redo actions, the start diagram script) only reach the current one.
  let editorGeneration = 0;

  // The body of the program: a Reactive Banana circuit in the MomentIO monad.
  const hadesNet = (): void => { // mdo
    // Forward references.
    const changedBRef: B.Behavior<Changed> = B.lazyB(() => changedB);
    const statusBRef: B.Behavior<Maybe<FileStatus>> = B.lazyB(() => statusB);
    const saveEnableBRef: B.Behavior<boolean> = B.lazyB(() => saveEnableB);
    const modelBRef: B.Behavior<Model<V>> = B.lazyB(() => modelB);
    const exportBRef: B.Behavior<Maybe<DiagramExport>> = B.lazyB(() => exportB);
    const newFileLoadScriptRef: B.Event<Script> = B.lazyE(() => newFileLoadScript);
    // Window quit
    const quitE = registerIOSignal1(window, Gtk.onWidgetDeleteEvent, (_) => [true, Just(null)] as const);
    const [undo1Click, redo1Click] = historyActions(window);
    void confirmUnsaved(window, changedBRef, B.tag(statusBRef, quitE), quitProgram);
    // Program start event, which is also used to recover after a panic.
    const [programStart, programStartHandler] = B.newEvent<FileEvent<V>>();
    writeIORef(startupHandlerRef, programStartHandler);
    // Connect up the GTK actions to the associated Reactive Banana events.
    const fileOps: [B.Event<FileEvent<V>>, Gio.SimpleAction][] = [
      actionNew(window, Just(emptyModel(cls, "Model")), changedBRef),
      actionExit(window, changedBRef, statusBRef),
      actionOpen(cls, descriptor, window, changedBRef, statusBRef),
      actionSave(cls, descriptor, window, saveEnableBRef, statusBRef, modelBRef),
      actionSaveAs(cls, descriptor, window, statusBRef, modelBRef),
      actionRecovery(cls, descriptor, window, changedBRef, statusBRef),
      actionAbout(cls, descriptor, window, modelBRef),
      // Web: the help files are in the program's documentation folder (the desktop build used
      // hades' own data folder, where the installer had put them).
      actionDisplayFile("helpManual", descriptor.programDocs + "/" + manualFile),
      // Manual is actually PDF, but we use a HTML redirect because of issue with
      // opening PDFs on Windows.
      actionDisplayFile("helpSupport", descriptor.programDocs + "/Support.html"),
      actionDisplayFile("helpCredits", descriptor.programDocs + "/Credits.html"),
    ];
    const fileEvents = fileOps.map((p) => p[0]);
    const fileActions = fileOps.map((p) => p[1]);
    for (const a of fileActions) Gio.actionMapAddAction(window, a);
    Gio.actionMapAddAction(window, actionExportDiagram(window, dataIconTheme, exportBRef));
    // Web: a model file dropped on the page is opened (after the unsaved-changes check).
    const [dropE, dropHandler] = B.newEvent<File>();
    fireDrop = dropHandler;
    const dropOpened = confirmUnsaved(window, changedBRef,
      B.apply(B.mapB((s: Maybe<FileStatus>) => (f: File) => [s, f] as const, statusBRef), dropE),
      async ([status, file]): Promise<Maybe<FileEvent<V>>> => {
        const path = registerUpload(file);
        const r = await forEditing(window, status, () => readJsonFile(JSON_Model(cls), window, path));
        return r.tag === "Nothing" ? Nothing : Just([Just(r.value[0]), Just(fixOldRelations(cls, r.value[1]))]);
      });
    fileEvents.push(B.filterJust(dropOpened));
    const gen = B.fromPoll(newGenerator); // Used to execute import events.
    // Track the current file in the window title.
    const fileEvent = [programStart, ...fileEvents].reduceRight((acc, e) => B.unionWith((a, _b) => a, e, acc));
    const newModelE = B.apply(
      B.mapB((g: UUIDGenerator) => (m: Model<V>) => runAfterLoad(cls, descriptor, g, m), gen),
      B.filterJust(B.mapE((f: FileEvent<V>) => f[1], fileEvent)));
    const statusB = B.stepper(initialModel[0], B.mapE((f: FileEvent<V>) => f[0], fileEvent));
    const readOnlyB = B.mapB(readOnlyStatus, statusB);
    const saveEnableB = B.liftA2B((ro: boolean, ch: boolean) => !ro && ch, readOnlyB, changedBRef);
    behaviorLink(window, Gtk.windowSetTitle, B.mapB((t: Maybe<FileStatus>) =>
      descriptor.programTitle + ": "
      // Web: the file is shown by its name (a virtual path means nothing to the user).
      + fromMaybe("<unknown>", t.tag === "Just" ? Just(displayPath(view(fileStatusPath, t.value))) : Nothing)
      + (readOnlyStatus(t) ? " (read only)" : ""), statusB));
    // Create an editor for each new model that comes out of the file events.
    const newEditor = (newModel: Model<V>): [B.Behavior<Model<V>>, EditorOutput<V>, B.Behavior<Changed>] => { // mdo
      const generation = ++editorGeneration;
      const isCurrent = (): boolean => generation === editorGeneration;
      void previewFolderClean();
      // Forward references.
      const updatesRef: B.Event<ModelUpdate<V, Maybe<string>>> = B.lazyE(() => updates);
      const historySelectionRef: B.Event<[Model<V>, ModelHistory<V>]> = B.lazyE(() => historySelection);
      const undoERef: B.Event<number> = B.lazyE(() => undoE);
      const redoERef: B.Event<number> = B.lazyE(() => redoE);
      const historyBRef: B.Behavior<ModelHistory<V>> = B.lazyB(() => historyB);
      const modelERef: B.Event<Model<V>> = B.lazyE(() => modelE);
      const modelC = makeChanges(newModel, B.whenE(B.mapB((b: boolean) => !b, readOnlyB), modelERef));
      // Connect up the dialog actions.
      // This also drops any previous instances of these actions from old editors.
      const [fieldEvents, fieldAction] =
        actionFields(window, dataIconTheme, B.mapB((m: Model<V>) => m.modelFields, modelC.changesB));
      Gio.actionMapAddAction(window, fieldAction);
      const [refTypeEvents, refTypeAction] =
        actionRefTypes(cls, window, dataIconTheme, B.mapB((m: Model<V>) => m.modelRefTypes, modelC.changesB));
      Gio.actionMapAddAction(window, refTypeAction);
      const selectionExport = actionExportSelection(cls, descriptor, window, modelC);
      Gio.actionMapAddAction(window, selectionExport);
      const [importEvent, importAction] = actionImportData(cls, descriptor, window, modelC);
      Gio.actionMapAddAction(window, importAction);
      const [findEvent, findAction] = actionFind<V>(cls);
      Gio.actionMapAddAction(window, findAction);
      const [refreshEvent, refreshAction] = actionRefresh();
      Gio.actionMapAddAction(window, refreshAction);
      // Web: scripts that re-activate a diagram from the browser history.
      const [historyScriptE, historyScriptHandler] = B.newEvent<Script>();
      fireHistoryScript = historyScriptHandler;

      const output = editorWindows<V>(
        cls,
        window,
        dataIconTheme,
        descriptor.programStock,
        newModel,
        modelC,
        refreshEvent,
        [importEvent, findEvent, B.filterE(isCurrent, newFileLoadScriptRef), historyScriptE]
          .reduceRight((acc, e) => B.unionWith((a, _b) => a, e, acc), B.never<Script>()),
      );
      // Model update processing.
      const modelE = processModelUpdates(
        cls,
        output.editorTreeInfo,
        updatesRef,
        B.mapE((p: [Model<V>, ModelHistory<V>]) => p[0], historySelectionRef),
      );
      const fieldUpdate = (oldModel: Model<V>, newFields: FieldTable): ModelUpdate<V, Maybe<string>> => {
        const updatedModel: Model<V> = { ...oldModel, modelFields: newFields };
        return mkModelUpdate<V, Maybe<string>>(Just("Modify data fields"), updatedModel, [ModelOther(oldModel, updatedModel)]);
      };
      const refTypeUpdate = (oldModel: Model<V>, newRefs: RefTypeTable<V>): ModelUpdate<V, Maybe<string>> => {
        const updatedModel: Model<V> = { ...oldModel, modelRefTypes: newRefs };
        return mkModelUpdate<V, Maybe<string>>(Just("Modify reference types"), updatedModel, [ModelOther(oldModel, updatedModel)]);
      };
      const modelDataUpdates = [
        B.apply(B.mapB((m: Model<V>) => (f: FieldTable) => fieldUpdate(m, f), modelC.changesB), fieldEvents),
        B.apply(B.mapB((m: Model<V>) => (r: RefTypeTable<V>) => refTypeUpdate(m, r), modelC.changesB), refTypeEvents),
      ].reduceRight((acc, e) => B.unionWith((a, _b) => a, e, acc), B.never<ModelUpdate<V, Maybe<string>>>());
      // Connect up the extension menu.
      const modelExtensionUpdates = extensionMenu(cls, window, dataIconTheme, builder, modelC);
      // Model updates.
      const modelUpdates = output.editorUpdates;
      const modelHistoryItemsRef: B.Event<HistoryItem<V>> = B.lazyE(() => modelHistoryItems);
      const modelChanged = B.mapE(() => true, modelHistoryItemsRef);
      const modelUnchanged = B.mapE(() => false, fileEvent);
      const updates = [modelUpdates, modelDataUpdates, modelExtensionUpdates]
        .reduceRight((acc, e) => B.unionWith((a, _b) => a, e, acc));
      const changedB = B.stepper(false, B.unionWith((a: boolean, b: boolean) => a || b, modelChanged, modelUnchanged));
      // Autosave process fork. Save every 5 minutes and keep the last 5 autosave files.
      const writeAutosave = autosaveProcess(JSON_Model(cls), descriptor.programName, 5 * 60, 5);
      B.reactimate(B.apply(
        B.mapB((s: Maybe<FileStatus>) => (m: Model<V>) => () =>
          writeAutosave(s.tag === "Just" ? view(fileStatusPath, s.value) : "", m), statusB),
        modelC.changesE));
      // Keep a copy of the latest successful model edit for panic recovery.
      B.reactimate(B.mapE((m: Model<V>) => () => writeIORef(latestModel, m), modelC.changesE));
      // History mechanism for undo and redo.
      const modelHistoryItems = B.apply(
        B.mapB((m: Model<V>) => (t: string) => HistoryItem(m, t), modelC.changesB),
        B.filterE((t: string) => t !== "", B.filterJust(B.mapE((u: ModelUpdate<V, Maybe<string>>) => u.updateValue, updates))));
      // Note: this provides the *old* version of the model, not the updated one.
      const undoE1 = B.unionWith((a: number, b: number) => a + b, undoERef, B.filterE(isCurrent, undo1Click));
      const redoE1 = B.unionWith((a: number, b: number) => a + b, redoERef, B.filterE(isCurrent, redo1Click));
      const historySelection = processHistoryClick(undoE1, redoE1, modelC.changesB, historyBRef);
      const historyMenus1 = (h: ModelHistory<V>) =>
        historyMenus(undoButtonWidget, [undoMenuItem], redoButtonWidget, [redoMenuItem], h);
      historyMenus1(emptyHistory)[2](); // Clear the history widgets.
      const newHistory = B.apply(
        B.mapB((h: ModelHistory<V>) => (item: HistoryItem<V>) => recordUndo(maxUndoLength, item, h), historyBRef),
        modelHistoryItems);
      const historyUpdates = B.unionWith((a, _b) => a, newHistory,
        B.mapE((p: [Model<V>, ModelHistory<V>]) => p[1], historySelection));
      const newHistoryEvents = B.execute(B.mapE((h: ModelHistory<V>) => () => historyMenus1(h), historyUpdates));
      const undoE = B.switchE(B.mapE((t: [B.Event<number>, B.Event<number>, () => void]) => t[0], newHistoryEvents));
      const redoE = B.switchE(B.mapE((t: [B.Event<number>, B.Event<number>, () => void]) => t[1], newHistoryEvents));
      B.reactimate(B.mapE((t: [B.Event<number>, B.Event<number>, () => void]) => t[2], newHistoryEvents));
      const historyB = B.stepper<ModelHistory<V>>(emptyHistory, historyUpdates);
      // Replace the child widget of the modelFrame.
      const oldWidget = Gtk.binGetChild(modelFrame);
      if (oldWidget !== null) Gtk.containerRemove(modelFrame, oldWidget);
      Gtk.containerAdd(modelFrame, output.editorWidget);
      Gtk.widgetShowAll(modelFrame);
      return [modelC.changesB, output, changedB];
    };
    const newEditorE = B.execute(B.mapE((newModel: Model<V>) => () => newEditor(newModel), newModelE));
    const modelB = B.switchB(B.pureB(initialModel[1]), B.mapE((t: [B.Behavior<Model<V>>, EditorOutput<V>, B.Behavior<Changed>]) => t[0], newEditorE));
    const exportB = B.switchB(B.pureB<Maybe<DiagramExport>>(Nothing),
      B.mapE((t: [B.Behavior<Model<V>>, EditorOutput<V>, B.Behavior<Changed>]) => t[1].editorDiagramExport, newEditorE));
    const changedB = B.switchB(B.pureB(false), B.mapE((t: [B.Behavior<Model<V>>, EditorOutput<V>, B.Behavior<Changed>]) => t[2], newEditorE));
    // Trigger the execution of openStartDiagram *after* everything else has happened.
    // Web: `mapEventIO (const $ return openStartDiagram) newEditorE` fires in the moment the new
    // editor is built, which the editor's own (just created) inputs do not see in the TS FRP
    // library. The script is sent in the next moment instead.
    const [newFileLoadScript, newFileLoadHandler] = B.newEvent<Script>();
    B.reactimate(B.mapE(() => () => newFileLoadHandler((c) => openStartDiagram(cls, c)), newEditorE));

    // Web: state the browser program needs outside the network.
    B.reactimatePrime(B.mapE((f: B.Future<Changed>) => B.mapFuture((c: Changed) => () => {
      changedNow = c;
    }, f), B.changes(changedB)));
    B.reactimatePrime(B.mapE((f: B.Future<Model<V>>) => B.mapFuture((m: Model<V>) => () => {
      currentModel = m;
    }, f), B.changes(modelB)));
    B.reactimate(B.mapE((t: [B.Behavior<Model<V>>, EditorOutput<V>, B.Behavior<Changed>]) => () => {
      currentOutput = t[1];
    }, newEditorE));
    // Web: record the active diagram in the browser history.
    const activeE = B.switchE(B.mapE((t: [B.Behavior<Model<V>>, EditorOutput<V>, B.Behavior<Changed>]) =>
      t[1].editorActiveEntity, newEditorE));
    B.reactimate(B.mapE((a: ActiveEntity<P, V>) => () => recordActive(a), activeE));
  };

  // Web: browser history of the active diagram. An entry is pushed whenever another diagram (or
  // view) becomes active; going back or forward activates that diagram again, opening it if it
  // is no longer open.
  interface HistoryState { readonly hadesActive: { readonly modelId: ModelId; readonly viewTag: string | null } }
  const isHistoryState = (s: unknown): s is HistoryState =>
    typeof s === "object" && s !== null && "hadesActive" in s;
  let suppressPush = false;
  let pendingPop: ModelId | null = null;
  // One user action can make several editors active in turn (a double click on a link in one
  // diagram opens another, then the first diagram's own action makes it active again, then the
  // new page's focus makes the new one active). Only the editor that is active once these have
  // settled is recorded, so such an action adds one history entry.
  const settledActive = whenSettled((a: ActiveEntity<P, V>) => recordActiveNow(a), activeSettleTime);
  const recordActive = (a: ActiveEntity<P, V>): void => {
    if (typeof history === "undefined") return;
    if (suppressPush) settledActive.cancel();
    else settledActive.push(a);
  };
  const recordActiveNow = (a: ActiveEntity<P, V>): void => {
    const w = a.activeWrapper;
    const st: HistoryState = {
      hadesActive: { modelId: w.wrappedEntityId, viewTag: w.tag === "ViewWrapper" ? w.viewTag : null },
    };
    const old: unknown = history.state;
    if (pendingPop !== null && pendingPop === st.hadesActive.modelId) {
      pendingPop = null;
      history.replaceState(st, "");
      return;
    }
    if (isHistoryState(old) && old.hadesActive.modelId === st.hadesActive.modelId
      && old.hadesActive.viewTag === st.hadesActive.viewTag) return;
    if (isHistoryState(old)) history.pushState(st, "");
    else history.replaceState(st, "");
  };
  const onPopState = (ev: PopStateEvent): void => {
    settledActive.cancel(); // An activation not yet recorded is superseded by the navigation.
    if (!isHistoryState(ev.state) || currentOutput === null) return;
    const { modelId, viewTag } = ev.state.hadesActive;
    suppressPush = true;
    let activated: boolean;
    try {
      activated = currentOutput.editorActivate(modelId, viewTag ?? undefined);
    } finally {
      suppressPush = false;
    }
    if (activated) return;
    // Not open: activate the entity as a double click in the tree would (opening it).
    const ent = M.lookup(modelId, currentModel.modelContents);
    if (ent.tag === "Nothing") return; // From an earlier model.
    pendingPop = modelId;
    fireHistoryScript(cls.editableActivation(Just(ent.value)));
  };
  if (typeof window !== "undefined" && typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("popstate", onPopState as EventListener);
    // Web: drag and drop of model files onto the page.
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    globalThis.addEventListener("dragover", ((e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }) as EventListener);
    globalThis.addEventListener("drop", ((e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      const f = Array.from(e.dataTransfer.files)[0];
      if (f !== undefined) fireDrop(f);
    }) as EventListener);
  }
  // Web: leaving the page with unsaved changes asks for confirmation.
  Gtk.windowSetUnloadGuard(window, () => !programHasFinished && changedNow);

  // Web: panic recovery. `catch Gtk.main` becomes the network's error handler.
  let panicking = false;
  panic = (e: unknown): void => {
    console.error(e);
    if (panicking) return;
    panicking = true;
    void errorBox(window, T.pack(
      "An internal error has occured. I will try to recover your work. If I succeed "
      + "then please save it in a new file. You may also be able to recover an older "
      + "version by restarting the program and using the recovery option in the File "
      + "menu.\n\n"
      + "Please report this bug.\n\n"
      + "Technical details: " + showException(e) + "\n\n"
      + "Note: if the term \"user\" appears above, this is a reference to the "
      + "programmer, not you.")).then(() => {
      panicking = false;
      const saved = readIORef(latestModel);
      const h = readIORef(startupHandlerRef);
      h([Nothing, Just(saved)]); // Deliberately force user to pick a new file name.
    });
  };
  B.setErrorHandler((e) => panic(e));
  B.actuate(B.compile(hadesNet));
  Gtk.widgetShowAll(window);
  const h = readIORef(startupHandlerRef);
  h([initialModel[0], Just(initialModel[1])]);
}

/** Haskell `show` of an exception. */
function showException(e: unknown): string {
  if (e instanceof Error) return e.name + ": " + e.message;
  return String(e);
}

/*
Design note: the autosave code in modelMain could in theory have done something like:

  autosave = changes $ (,) <$> statusB <*> model

However this would have unpredictable race conditions when a new model is loaded; it could
potentially store the old model under the new name, or the new model under the old name. Therefore
the autosave event is triggered only when the model changes, and the current pathname is picked
up at that point. Using plainChanges is the most straightforward way of doing this.
*/

/** Open any diagrams with names beginning "Start" at the top level of the model. */
export function* openStartDiagram<P1, V>(cls: HasDiagrams<P1, V>, ctx: ModelEditCtx<V, V>): ModelScript<P1, V, Maybe<string>> {
  // lift $ do
  goToRoot(ctx);
  const ch = M.toList(currentChildren(ctx)).map(([n, uid]) => [view(nameText, n), uid] as const);
  const entIds = ch.filter(([n]) => T.isPrefixOf("Start", n)).map(([, uid]) => uid);
  const ents = entIds.map((uid) => {
    goToEntity(ctx, uid);
    return current(ctx);
  });
  for (const ent of catMaybes(ents)) {
    const w = cls.getDiagramWrapper(ctx, ent);
    switch (w.tag) {
      case "Nothing": break; // "Start" entity is not a diagram.
      case "Just": yield* openDiagram<P1, V, V>(cls, ctx, ent.entityId); break;
    }
  }
  return Nothing; // This script makes no changes.
}

/** Run an action to update the loaded model into a new format. */
export function runAfterLoad<V>(cls: ModelMainClass<V> | HasDiagrams<P, V>, desc: MainDescriptor<V>, gen: UUIDGenerator, model: Model<V>): Model<V> {
  const r = execModelEdit(cls, identity<V>(), modelStartState(gen, model), desc.programAfterLoad);
  switch (r.tag) {
    case "Left": return cannotHappen("Format update failed:\n" + show_ModelError(r.value), model);
    case "Right": return r.value[0];
  }
}

/**
 * Previous versions used many different relations for arrows. These have now been combined
 * into the \"@Arrow Head@\" and \"@Arrow Tail@\" relations. This function renames all the old
 * ones.
 *
 * This code should be deleted once it is no longer required.
 *
 * (The `EntityClass v` dictionary is not used.)
 */
export function fixOldRelations<V>(_cls: unknown, model: Model<V>): Model<V> {
  const renameOld = (r: Model<V>["modelRelations"]): Model<V>["modelRelations"] =>
    renameRelation("Before arrow", edgeFromRelation,
      renameRelation("After arrow", edgeToRelation,
        renameRelation("Trigger arrow out", edgeFromRelation,
          renameRelation("Trigger arrow in", edgeToRelation,
            renameRelation("Guard arrow out", edgeFromRelation,
              renameRelation("Guard arrow in", edgeToRelation,
                renameRelation("Hazard arrow out", edgeFromRelation,
                  renameRelation("Hazard arrow in", edgeToRelation,
                    renameRelation("Arrow From", edgeFromRelation,
                      renameRelation("Arrow To", edgeToRelation, r))))))))));
  return { ...model, modelRelations: renameOld(model.modelRelations) };
}

/**
 * Most of the application UI (command buttons, menus etc) are defined in XML using Glade.
 * However the extension menu is defined using the "Reflective" interface and is then attached
 * to the @ExtensionFields@ menu item.
 */
export function extensionMenu<V>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  builder: Gtk.Builder,
  modelC: Changes<Model<V>>,
): B.Event<ModelUpdate<V, Maybe<string>>> {
  // Marshal arguments for mkGtkPopup
  const extFields = (model: Model<V>, variant: Variant<V>): readonly [Variant<V>, readonly FieldId[], Dialog_<Model<V>, null, readonly FieldId[]>] => {
    const fields = M.findWithDefault<Variant<V>, readonly FieldId[]>([], variant, model.modelExtensions);
    const dialog = extensionDialog<V, Model<V>, null>(model.modelFields, variant);
    return [variant, fields, dialog];
  };
  // Marshal dialog output into model update.
  const mkUpdate = (model: Model<V>, [variant, mv]: [Variant<V>, Maybe<readonly FieldId[]>]): Maybe<ModelUpdate<V, Maybe<string>>> => {
    if (mv.tag === "Nothing") return Nothing;
    return Just(mkModelUpdate<V, Maybe<string>>(
      Just("Modify " + cls.variantUserLabel(variant) + " extension fields"),
      { ...model, modelExtensions: M.insert(variant, mv.value, model.modelExtensions) },
      [], // No change to tree widget.
    ));
  };
  const menu = Gtk.new_(Gtk.Menu, {});
  const model = B.valueBLater(modelC.changesB);
  const vs = L.nubBy((a: V, b: V) => cls.reflectiveName(a) === cls.reflectiveName(b),
    L.sortOn((v: V) => cls.variantUserLabel(cls.reflectiveName(v)), cls.reflectiveDefaults));
  // reflectiveName can have duplicates. Hence "nubBy".
  // `_ = evalModelEdit id model $ forM vs mkEntity` only told the compiler that vs contains the
  // same type as model; it is never evaluated.
  void model;
  const events = vs.map((v, n) => {
    const item = Gtk.new_(Gtk.MenuItem, { label: cls.variantUserLabel(cls.reflectiveName(v)), useUnderline: false });
    Gtk.menuAttach(menu, item, 0, 1, n, n + 1);
    return registerIOSignal(item, Gtk.onMenuItemActivate, () => [null, cls.reflectiveName(v)] as const);
  });
  const parentObj = Gtk.builderGetObject(builder, "ExtensionFields");
  if (parentObj === null) throw new Error("Error: cannot get ExtensionFields menu item");
  const parentItem = Gtk.unsafeCastTo(Gtk.MenuItem, parentObj);
  Gtk.widgetShowAll(menu);
  Gtk.menuItemSetSubmenu(parentItem, menu);
  const extensionEvent = events.reduceRight((acc, e) => B.unionWith((a, _b) => a, e, acc), B.never<Variant<V>>());
  const modelB = modelC.changesB;
  const updateEvent = mkGtkPopup(parent, iconTheme, modelC,
    B.apply(B.mapB((m: Model<V>) => (variant: Variant<V>) => extFields(m, variant), modelB), extensionEvent));
  return B.filterJust(B.apply(
    B.mapB((m: Model<V>) => (u: [Variant<V>, Maybe<readonly FieldId[]>]) => mkUpdate(m, u), modelC.changesB),
    updateEvent));
}

export function saveFileFilters<V>(descriptor: MainDescriptor<V>): Gtk.FileFilter[] {
  const saveFilter = Gtk.fileFilterNew();
  Gtk.fileFilterSetName(saveFilter, descriptor.programTitle + " files *." + descriptor.programXtn);
  Gtk.fileFilterAddPattern(saveFilter, "*." + descriptor.programXtn);
  const anyFilter = Gtk.fileFilterNew();
  Gtk.fileFilterAddPattern(anyFilter, "*");
  Gtk.fileFilterSetName(anyFilter, "Any file");
  return [saveFilter, anyFilter];
}

export function exportFileFilters<V>(descriptor: MainDescriptor<V>): Gtk.FileFilter[] {
  const extension = T.dropEnd(1, descriptor.programXtn) + "x";
  const saveFilter = Gtk.fileFilterNew();
  Gtk.fileFilterSetName(saveFilter, descriptor.programTitle + " export files *." + extension);
  Gtk.fileFilterAddPattern(saveFilter, "*." + extension);
  const anyFilter = Gtk.fileFilterNew();
  Gtk.fileFilterSetName(anyFilter, "Any file");
  Gtk.fileFilterAddPattern(anyFilter, "*");
  return [saveFilter, anyFilter];
}

/**
 * If the current value has been changed since the last save then confirm before proceeding.
 *
 * Web: the confirmation dialog and the action are asynchronous, so they run from a
 * `reactimate` and the result event fires when they complete (the Haskell used `mapEventIO`).
 */
export function confirmUnsaved<A, R>(
  /** Widget in parent window for confirmation dialog. */
  parent: Gtk.Widget,
  /** Has the model changed since the last save? If not then just proceed. */
  changedB: B.Behavior<Changed>,
  /** Event that needs to be confirmed. */
  event: B.Event<A>,
  /** Action to execute if confirmed. */
  action: (a: A) => R | Promise<R>,
): B.Event<R> {
  const confirm1 = async (flag: boolean, value: A): Promise<Maybe<R>> => {
    if (flag) {
      const dialog = Gtk.new_(Gtk.MessageDialog, {
        messageType: Gtk.MessageTypeWarning,
        buttons: Gtk.ButtonsTypeYesNo,
        text: "The current model has not been saved and any changes will be lost.\n\n"
          + "Are you sure?",
      });
      const parentWin = Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(parent));
      if (parentWin !== null) Gtk.set(dialog, { transientFor: parentWin });
      const result = await Gtk.dialogRun(dialog);
      Gtk.widgetDestroy(dialog);
      return result === Gtk.ResponseTypeYes ? Just(await action(value)) : Nothing;
    }
    return Just(await action(value));
  };
  const [result, handler] = B.newEvent<Maybe<R>>();
  B.reactimate(B.apply(B.mapB((flag: Changed) => (value: A) => () => {
    confirm1(flag, value).then(handler, (err) => panic(err));
  }, changedB), event));
  return B.filterJust(result);
}

/* $fileOps
All the file operations have the same return type so that they can be convienently
put in a list and registered in the GUI together. When any of these operations is invoked the
event is triggered. The event will contain a new filename and/or a new model value. On this event
the changed flag can be cleared.
*/

/** Create a new model. */
export function actionNew<A>(
  /** Parent widget for confirmation dialog. */
  parent: Gtk.Widget,
  newValue: A,
  /** Do we need to ask for confirmation? */
  changedB: B.Behavior<Changed>,
): [B.Event<readonly [Maybe<FileStatus>, A]>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("new", null);
  const newClicked = registerIOSignal1(action, Gio.onSimpleActionActivate,
    (_) => [null, [Nothing, newValue] as readonly [Maybe<FileStatus>, A]] as const);
  const newConfirmed = confirmUnsaved(parent, changedB, newClicked, (x) => x);
  return [newConfirmed, action];
}

/** Load an existing model from a file. */
export function actionOpen<V>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  descriptor: MainDescriptor<V>,
  /** Widget in parent window. */
  parent: Gtk.Widget,
  /** Do we need to ask for confirmation? */
  changedB: B.Behavior<Changed>,
  /** Current file status. */
  statusB: B.Behavior<Maybe<FileStatus>>,
): [B.Event<FileEvent<V>>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("open", null);
  const openClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const openConfirmed = confirmUnsaved(parent, changedB, B.tag(statusB, openClicked),
    async (status: Maybe<FileStatus>): Promise<Maybe<FileEvent<V>>> => {
      const filters = saveFileFilters(descriptor);
      const r = await forEditing(parent, status,
        () => openJsonFile(JSON_Model(cls), parent, filters, preview(_Just<FileStatus>().dot(fileStatusPath), status)));
      switch (r.tag) {
        case "Nothing": return Nothing;
        case "Just": return Just([Just(r.value[0]), Just(fixOldRelations(cls, r.value[1]))]);
      }
    });
  return [B.filterJust(openConfirmed), action];
}

/** Save the current model under the current filename. */
export function actionSave<V>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  descriptor: MainDescriptor<V>,
  /** Parent widget */
  parent: Gtk.Widget,
  /** Enabled? */
  enableB: B.Behavior<boolean>,
  /** Current edit lock and path name, if any. */
  statusB: B.Behavior<Maybe<FileStatus>>,
  /** Model state */
  modelB: B.Behavior<Model<V>>,
): [B.Event<FileEvent<V>>, Gio.SimpleAction] {
  const actionInput = B.liftA2B((s: Maybe<FileStatus>, m: Model<V>) => [s, m] as const, statusB, modelB);
  const action = Gio.simpleActionNew("save", null);
  // Initially no edits have been made, so can't save them.
  // (`Gtk.set action [#enabled := False]`; the toolkit's action needs its setter to notify menus.)
  Gio.simpleActionSetEnabled(action, false);
  const enableE = B.changes(B.mapB((b: boolean) => () => Gio.simpleActionSetEnabled(action, b), enableB));
  B.reactimatePrime(enableE);
  const saveClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const [fileSaved, savedHandler] = B.newEvent<FileEvent<V>>();
  B.reactimate(B.mapE(([status, model]: readonly [Maybe<FileStatus>, Model<V>]) => () => {
    const go = async (): Promise<void> => {
      const filters = saveFileFilters(descriptor);
      if (readOnlyStatus(status)) {
        await errorBox(parent, "This model is read-only.");
      } else {
        const newStatus = await forEditing(parent, status, () => saveFile(
          JSON_Model(cls),
          parent,
          filters,
          (p) => checkExtension(T.unpack(descriptor.programXtn), p),
          preview(_Just<FileStatus>().dot(fileStatusPath), status),
          model,
        ));
        savedHandler([newStatus.tag === "Just" ? Just(newStatus.value[0]) : Nothing, Nothing]);
      }
    };
    go().catch((err) => panic(err));
  }, B.tag(actionInput, saveClicked)));
  return [fileSaved, action];
}

/** Prompt for a new file name and save the model under that. */
export function actionSaveAs<V>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  descriptor: MainDescriptor<V>,
  /** Parent widget for dialog box. */
  parent: Gtk.Widget,
  statusB: B.Behavior<Maybe<FileStatus>>,
  modelB: B.Behavior<Model<V>>,
): [B.Event<FileEvent<V>>, Gio.SimpleAction] {
  const actionInput = B.liftA2B((s: Maybe<FileStatus>, m: Model<V>) => [s, m] as const, statusB, modelB);
  const action = Gio.simpleActionNew("saveAs", null);
  const saveClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const [fileSaved, savedHandler] = B.newEvent<FileEvent<V>>();
  B.reactimate(B.mapE(([status, model]: readonly [Maybe<FileStatus>, Model<V>]) => () => {
    const go = async (): Promise<void> => {
      const filters = saveFileFilters(descriptor);
      const newStatus = await forEditing(parent, status, () => saveAsFile(
        JSON_Model(cls),
        parent,
        filters,
        (p) => checkExtension(T.unpack(descriptor.programXtn), p),
        preview(_Just<FileStatus>().dot(fileStatusPath), status),
        model,
      ));
      savedHandler([newStatus.tag === "Just" ? Just(newStatus.value[0]) : Nothing, Nothing]);
    };
    go().catch((err) => panic(err));
  }, B.tag(actionInput, saveClicked)));
  return [fileSaved, action];
}

/** A row of the recovery dialog: autosave path, the file it was saved for, and when. */
type RecoveryRow = readonly [FilePath, FilePath, UTCTime];

function recoveryDialog<E, W>(contents: readonly RecoveryRow[]): Dialog_<E, W, FilePath> {
  const spec = comboBox<E, W, FilePath>((_) => contents.map(([path, content, time]) => {
    const nm = content === "" ? "<unnamed file>" : content;
    const tStr = formatRecoveryTime(time);
    // Web: the file is named by "displayPath" (a virtual path means nothing to the user).
    return ComboItem<FilePath>(tStr + ": " + T.pack(displayPath(nm)), Nothing, Nothing, path);
  }));
  return Dialog("Recover from auto-save", OkButton, simpleFrame("File to recover: ", spec));
}

export function actionRecovery<V>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  descriptor: MainDescriptor<V>,
  /** Parent widget for dialog. */
  parent: Gtk.Widget,
  /** Do we need to ask for confirmation? */
  changedB: B.Behavior<Changed>,
  /** Current edit lock status and file name. */
  statusB: B.Behavior<Maybe<FileStatus>>,
): [B.Event<FileEvent<V>>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("recovery", null);
  const recoveryClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const recoveryConfirmed = confirmUnsaved(parent, changedB, B.tag(statusB, recoveryClicked),
    async (_status): Promise<readonly [null, FilePath, Dialog_<null, null, FilePath>]> => {
      const files = L.sortOn((f) => -f.autosaveWhen, await autosaveFiles(descriptor.programName));
      const rows: Maybe<RecoveryRow>[] = [];
      for (const f of files) {
        const c = await autosaveGetContents(f.autosavePath);
        rows.push(c.tag === "Nothing" ? Nothing : Just([f.autosavePath, c.value.autosaveFor, f.autosaveWhen] as const));
      }
      const tbl = catMaybes(rows);
      const dflt = tbl.length === 0 ? "" : tbl[0][0];
      return [null, dflt, recoveryDialog<null, null>(tbl)];
    });
  const theme = Gtk.iconThemeGetDefault();
  const recoveryEvent = mkGtkPopup(parent, theme, pure_Changes(null), recoveryConfirmed);
  const [recoveryComplete, handler] = B.newEvent<FileEvent<V>>();
  B.reactimate(B.apply(
    B.mapB((oldStatus: Maybe<FileStatus>) => ([, mPath]: [null, Maybe<FilePath>]) => () => {
      if (mPath.tag === "Nothing") return;
      const path = mPath.value;
      const go = async (): Promise<void> => {
        const contents = await autosaveGetContents(path);
        if (contents.tag === "Nothing") {
          await errorBox(parent, "Could not recover autosave file.");
          return;
        }
        const result = contents.value;
        const decoded = J.eitherDecode(JSON_Model(cls), U.decodeUtf8(result.autosaveData));
        if (decoded.tag === "Left") {
          await errorBox(parent, T.pack("Could not recover autosave file:\n\n" + decoded.value));
          return;
        }
        const doc = decoded.value;
        const v: Maybe<readonly [FilePath, Model<V>]> = result.autosaveFor === ""
          ? Nothing
          : Just([result.autosaveFor, doc] as const);
        const lockResult = await forEditing(parent, oldStatus, async () => v);
        handler([lockResult.tag === "Just" ? Just(lockResult.value[0]) : Nothing, Just(doc)]);
      };
      go().catch((err) => panic(err));
    }, statusB),
    recoveryEvent));
  return [recoveryComplete, action];
}

/** Prompt for a new file name and export the current diagram under that. */
export function actionExportDiagram(
  /** Parent widget for confirmation dialog. */
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  exportB: B.Behavior<Maybe<DiagramExport>>,
): Gio.SimpleAction {
  const action = Gio.simpleActionNew("exportDiagram", null);
  const exportClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  B.reactimate(B.mapE((ex: DiagramExport) => () => {
    exportDrawing(parent, iconTheme, ex).catch((err) => panic(err));
  }, B.filterJust(B.tag(exportB, exportClicked))));
  return action;
}

/**
 * Pop up the field list dialog.
 *
 * (The Haskell `[FieldId]` stream of new IDs is an iterator.)
 */
export function actionFields(
  /** Parent widget for dialogs. */
  window: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  tbl: B.Behavior<FieldTable>,
): [B.Event<FieldTable>, Gio.SimpleAction] {
  const fromFieldList = (fs: readonly Field[]): FieldTable => M.fromList(fs.map((f) => [f.fieldId, f] as const));
  const replaceNullIds = (fids: Iterator<FieldId>, fields: readonly Field[]): Field[] => {
    const result: Field[] = [];
    let next = fids.next();
    for (const f of fields) {
      if (next.done) return [...result, ...cannotHappen<Field[]>("Field dialog ran out of new field IDs.", [])];
      if (U.isNil(f.fieldId)) {
        result.push({ ...f, fieldId: next.value });
        next = fids.next();
      } else {
        result.push(f);
      }
    }
    return result;
  };
  const newIds = B.fromPoll(uuidStreamIO);
  const action = Gio.simpleActionNew("fields", null);
  const typesClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const updates1 = mkGtkPopupSelect(
    window,
    iconTheme,
    pure_Changes(null),
    constantDialog(fieldDialog<null, null>()),
    B.tag(B.mapB((t: FieldTable) => [null, L.sortOn((f: Field) => T.toCaseFold(view(fieldName, f)), M.elems(t))] as const, tbl),
      typesClicked),
  );
  const updates2 = B.apply(B.mapB((ids: Iterator<FieldId>) => (fs: readonly Field[]) => replaceNullIds(ids, fs), newIds),
    B.filterJust(B.mapE((p: [null, Maybe<readonly Field[]>]) => p[1], updates1)));
  return [B.mapE(fromFieldList, updates2), action];
}

/** Pop up the reference type list dialog. */
export function actionRefTypes<A>(
  cls: Reflective<A>,
  /** Parent widget for dialogs. */
  parent: Gtk.Widget,
  iconTheme: Gtk.IconTheme,
  tbl: B.Behavior<RefTypeTable<A>>,
): [B.Event<RefTypeTable<A>>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("refTypes", null);
  const typesClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const updates = mkGtkPopupSelect(
    parent,
    iconTheme,
    pure_Changes(null),
    constantDialog(referenceListDialog<A, null, null>(cls)),
    B.tag(B.mapB((t: RefTypeTable<A>) => [true, refTypeTableToList(t)] as const, tbl), typesClicked),
  );
  return [
    B.filterJust(B.mapE((p) => (p[1].tag === "Just" ? Just(refTypeTableFromList(p[1].value)) : Nothing), updates)),
    action,
  ];
}

/** The import dialog's value: a model import or an Excel import. */
type ImportSelection<V> = Either<readonly [S.Set<U.UUID>, boolean], readonly [S.Set<U.UUID>, V, NameClashAction]>;

/**
 * Import the data into a selected location in the model. Returns an edit action that inserts
 * the data.
 */
export function actionImportData<V>(
  cls: ModelMainClass<V>,
  descriptor: MainDescriptor<V>,
  /** Parent widget for dialog. */
  parent: Gtk.Widget,
  modelC: Changes<Model<V>>,
): [B.Event<ModelScriptAct<P, V, V, Maybe<string>>>, Gio.SimpleAction] {
  type Script = ModelScriptAct<P, V, V, Maybe<string>>;
  type Sel = ImportSelection<V>;
  const defaultValue: Sel = Left([S.empty<U.UUID>(), false] as const);
  const mkSelectorItem = (ent: Entity<V>): readonly [string, Maybe<string>, Maybe<U.UUID>] => [
    view(entityName(cls).dot(nameText), ent),
    Nothing,
    isJust(preview(entityContents<V>().dot(cls._Package), ent)) ? Just(ent.entityId) : Nothing,
  ];
  const importDialog: DialogSelector_<Model<V>, null, Sel> = (m, _) => {
    const r = evalModelEdit(cls, identity<V>(), m, (c) => {
      goToRoot(c);
      return modelPackageForest(c);
    });
    const forest = r.tag === "Left"
      ? cannotHappen("Element import: " + show_ModelError(r.value), [] as Tree<readonly [string, Maybe<string>, Maybe<U.UUID>]>[])
      : fmapForest(mkSelectorItem, r.value);
    const tree = Node([m.modelName, Nothing, Just(U.nil)] as readonly [string, Maybe<string>, Maybe<U.UUID>], forest);
    /*
      proc (loc1, flg1) -> do
        _ <- message1 "Select location for import." -< ()
        loc2 <- simpleFrame "Import location:" $ treeSelector $ const [tree] -< loc1
        flg2 <- accum $ form Vertical [("Import extensions?", focusing id tickBox)] -< flg1
        returnA -< (loc2, flg2)
    */
    const modelImport = PrismaticGadget<Model<V>, null, Sel, Sel, readonly [S.Set<U.UUID>, boolean], readonly [S.Set<U.UUID>, boolean]>(
      [S.empty<U.UUID>(), false] as const, _Left(),
      gPipe(
        arr(([loc1, flg1]: readonly [S.Set<U.UUID>, boolean]) => [null, [loc1, flg1]] as [null, [S.Set<U.UUID>, boolean]]),
        gProd(
          message1<Model<V>, null, null>("Select location for import."),
          gProd(
            simpleFrame("Import location:", treeSelector<Model<V>, null, U.UUID>((_e) => [tree])),
            accum(form<Model<V>, null, boolean>("Vertical", [["Import extensions?", focusing(identity<boolean>(), tickBox<Model<V>, null>())]])),
          ),
        ),
        arr(([, [loc2, flg2]]: [null, [S.Set<U.UUID>, boolean]]) => [loc2, flg2] as const),
      ));
    /*
      proc (loc1, blank1, clash1) -> do
        _ <- message1 "Select import location and type." -< ()
        loc2 <- simpleFrame "Import Location:" $ treeSelector $ const [tree] -< loc1
        (blank2, clash2) <- accum $ form Vertical [
              ("Import type:", focusing _1 variantMenu),
              ("On name clash:", focusing _2 boundedCombo)
            ] -< (blank1, clash1)
        returnA -< (loc2, blank2, clash2)
    */
    type BC = readonly [V, NameClashAction];
    const excelImport = PrismaticGadget<Model<V>, null, Sel, Sel, readonly [S.Set<U.UUID>, V, NameClashAction], readonly [S.Set<U.UUID>, V, NameClashAction]>(
      [S.empty<U.UUID>(), blankEvidence, "CancelClash"] as const, _Right(),
      gPipe(
        arr(([loc1, blank1, clash1]: readonly [S.Set<U.UUID>, V, NameClashAction]) =>
          [null, [loc1, [blank1, clash1] as BC]] as [null, [S.Set<U.UUID>, BC]]),
        gProd(
          message1<Model<V>, null, null>("Select import location and type."),
          gProd(
            simpleFrame("Import Location:", treeSelector<Model<V>, null, U.UUID>((_e) => [tree])),
            accum(form<Model<V>, null, BC>("Vertical", [
              ["Import type:", focusing(_1<V, NameClashAction>(), variantMenu)],
              ["On name clash:", focusing(_2<V, NameClashAction>(),
                boundedCombo<Model<V>, null, NameClashAction>(nameClashActionValues, show_NameClashAction))],
            ])),
          ),
        ),
        arr(([, [loc2, [blank2, clash2]]]: [null, [S.Set<U.UUID>, BC]]) => [loc2, blank2, clash2] as const),
      ));
    return Just(Dialog("Import Data", OkButton, validate(validityCheck,
      unionTab<Model<V>, null, Sel, Sel>([["Import Model", modelImport], ["Import Excel", excelImport]]))));
  };
  const variantMenu = comboBox<Model<V>, null, V>((_) => L.sortOn((c: ComboItem<V>) => c.menuItemLabel,
    cls.reflectiveDefaults.map((r) => ComboItem(cls.variantUserLabel(cls.reflectiveName(r)), Nothing, Nothing, r))));
  const blankEvidence: V = review(cls._Evidence, Evidence(Name("")));
  const validityCheck = (v: Sel): boolean => S.size(v.tag === "Left" ? v.value[0] : v.value[0]) === 1;

  const action = Gio.simpleActionNew("importData", null);
  const importClicked = registerIOSignal1(action, Gio.onSimpleActionActivate,
    (_) => [null, [null, defaultValue] as readonly [null, Sel]] as const);
  const theme = Gtk.iconThemeGetDefault();
  const importE = mkGtkPopupSelect(parent, theme, modelC, importDialog, importClicked);
  const [resultE, resultH] = B.newEvent<Script>();
  B.reactimate(B.mapE(([, mSel]: [null, Maybe<Sel>]) => () => {
    if (mSel.tag === "Nothing") return; // Action cancelled.
    const selection = mSel.value;
    const go = async (): Promise<void> => {
      const targets = S.toList(selection.tag === "Left" ? selection.value[0] : selection.value[0]);
      // Nothing selected, so dump it in root. Multiple selections should never happen.
      const targetId = targets.length === 0 ? U.nil : targets[0];
      const filters = exportFileFilters(descriptor);
      switch (selection.tag) { // ModelEdit action
        case "Left": {
          const metaFlag = selection.value[1];
          const opened = await openJsonFile(JSON_ModelExport(cls), parent, filters, Nothing);
          if (opened.tag === "Nothing") return; // Action cancelled.
          const [path, v] = opened.value as [FilePath, ModelExport<V>];
          // Web: "Imported from" names the file by "displayPath" (here and below), not by its
          // virtual path.
          // eslint-disable-next-line require-yield
          resultH(function* (c): ModelScript<P, V, Maybe<string>> {
            importEntities(c, targetId, v.exportRelations, v.exportContents);
            if (metaFlag) importMetadata(c, v);
            return Just(T.pack("Imported from " + displayPath(path)));
          });
          return;
        }
        case "Right": {
          const [, template, clash] = selection.value;
          const opened = await openExcelFile(parent, Nothing);
          if (opened.tag === "Nothing") return; // Action cancelled.
          const [path, book] = opened.value;
          resultH(function* (c): ModelScript<P, V, Maybe<string>> {
            goToEntity(c, targetId);
            const warns = importExcel(c, clash, book, template);
            if (warns.length === 0) return Just(T.pack("Imported from " + displayPath(path))); // No warnings.
            const warnDialog = constantDialog(Dialog<Model<V>, null, null, null>("Warning", OkButton,
              message1<Model<V>, null, null>(
                "Warnings during import:\n\n"
                + T.intercalate("\n", warns)
                + "\n\nPress OK to proceed, Cancel to stop.")));
            const r = yield* openDialog<P, V, V, null>(c, warnDialog, null);
            if (r.tag === "Just") return Just(T.pack("Imported from " + displayPath(path)));
            return throwUser(c, "Import cancelled. No changes made.");
          });
          return;
        }
      }
    };
    go().catch((err) => panic(err));
  }, importE));
  return [resultE, action];
}

/*
Design Note:

The import dialog uses Either and tuples as a quick-and-dirty import type. If this gets any more
complicated then it should be given its own dedicated type.
*/

/** Dialog for exporting the selected items. */
export function actionExportSelection<V>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  descriptor: MainDescriptor<V>,
  /** Parent widget for dialogs. */
  parent: Gtk.Widget,
  modelC: Changes<Model<V>>,
): Gio.SimpleAction {
  type Sel = readonly [S.Set<ModelId>, boolean];
  const extension = T.dropEnd(1, descriptor.programXtn) + "x";
  const mkSelectorItem = (ent: Entity<V>): readonly [string, Maybe<string>, Maybe<ModelId>] =>
    [view(entityName(cls).dot(nameText), ent), Nothing, Just(ent.entityId)];
  const exportDialog: DialogSelector_<Model<V>, null, Sel> = (m, _) => {
    const r = evalModelEdit(cls, identity<V>(), m, (c) => {
      goToRoot(c);
      return modelPackageForest(c);
    });
    const forest = r.tag === "Left"
      ? cannotHappen("Element export: " + show_ModelError(r.value), [] as Tree<readonly [string, Maybe<string>, Maybe<ModelId>]>[])
      : fmapForest(mkSelectorItem, r.value);
    /*
      proc (selected1, flag1) -> do
        _ <- message1 "Select items to export. \
          \The children of the selected items will be included automatically." -< ()
        selected2 <- simpleFrame "Export Entities" $ treeSelector $ const forest -< selected1
        flag2 <- accum $ form Vertical [("Export extensions?", focusing id tickBox)] -< flag1
        returnA -< (selected2, flag2)
    */
    return Just(Dialog("Export Data", OkButton, gPipe(
      arr(([selected1, flag1]: Sel) => [null, [selected1, flag1]] as [null, [S.Set<ModelId>, boolean]]),
      gProd(
        message1<Model<V>, null, null>("Select items to export. "
          + "The children of the selected items will be included automatically."),
        gProd(
          simpleFrame("Export Entities", treeSelector<Model<V>, null, ModelId>((_e) => forest)),
          accum(form<Model<V>, null, boolean>("Vertical", [["Export extensions?", focusing(identity<boolean>(), tickBox<Model<V>, null>())]])),
        ),
      ),
      arr(([, [selected2, flag2]]: [null, [S.Set<ModelId>, boolean]]) => [selected2, flag2] as const),
    )));
  };
  const action = Gio.simpleActionNew("exportData", null);
  const exportSelectionClicked = registerIOSignal1(action, Gio.onSimpleActionActivate,
    (_) => [null, [null, [S.empty<ModelId>(), false] as Sel] as readonly [null, Sel]] as const);
  const theme = Gtk.iconThemeGetDefault();
  const exportE = mkGtkPopupSelect(parent, theme, modelC, exportDialog, exportSelectionClicked);
  const exportData = queryModel(cls, identity<V>(), modelC.changesB,
    B.filterJust(B.mapE((p: [null, Maybe<Sel>]) => p[1], exportE)),
    (c, [items, flag]: Sel) => makeExport(c, items, flag))[1];
  B.reactimate(B.mapE((dat: ModelExport<V>) => () => {
    const filters = exportFileFilters(descriptor);
    void writeAsFile(
      JSON_ModelExport(cls),
      parent,
      "Export Data to File",
      "Export",
      filters,
      (p) => checkExtension(T.unpack(extension), p),
      Nothing,
      dat,
    ).catch((err) => panic(err));
  }, exportData));
  return action;
}

/** Find text in the model. (The `EntityClass v` dictionary is not used.) */
export function actionFind<V>(_cls?: unknown): [B.Event<ModelScriptAct<P, V, V, Maybe<string>>>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("find", null);
  const findClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  const script: ModelScriptAct<P, V, V, Maybe<string>> = (c) => findTextTool<P, V>(c);
  return [B.mapE(() => script, findClicked), action];
}

/**
 * Refresh any matrices that are currently displayed. Actually, this sends a refresh signal
 * to all tabs, its just that only matrices actually do anything with it.
 */
export function actionRefresh(): [B.Event<null>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("refresh", null);
  const refreshClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  return [refreshClicked, action];
}

/** Exit the program */
export function actionExit<A = never>(
  /** Parent widget for confirmation dialog. */
  window: Gtk.Widget,
  changedB: B.Behavior<Changed>,
  statusB: B.Behavior<Maybe<FileStatus>>,
): [B.Event<A>, Gio.SimpleAction] {
  const action = Gio.simpleActionNew("quit", null);
  const exitClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  void confirmUnsaved(window, changedB, B.tag(statusB, exitClicked), quitProgram);
  return [B.never<A>(), action];
}

/**
 * An action that opens the named file.
 *
 * Web: the file opens in a new browser tab (`GLib.filenameToUri` gives the URL of a bundled data
 * file). GIO's error for a file that does not exist is reproduced, as the browser would only
 * show a blank tab.
 */
export function actionDisplayFile<A = never>(
  /** The UI name for this action. */
  lbl: string,
  /** The file to open on activation. */
  path: FilePath,
): [B.Event<A>, Gio.SimpleAction] {
  const uri = GLib.filenameToUri(path, null);
  const action = Gio.simpleActionNew(lbl, null);
  Gio.onSimpleActionActivate(action, (_) => {
    try {
      if (!isDataFile(path) && !path.startsWith("/builtin/")) {
        throw new Error("Error when getting information for file “" + path + "”: No such file or directory");
      }
      Gtk.showUriOnWindow(null, uri, 0); // Zero is magic timestamp value for "now".
    } catch (err) {
      void errorBox(null, T.pack(showException(err)));
    }
  });
  return [B.never<A>(), action];
}

/** An action that displays information about the program. */
export function actionAbout<V, A = never>(
  cls: HasDiagrams<P, V> | ModelMainClass<V>,
  desc: MainDescriptor<V>,
  /** Parent widget for dialog. */
  parent: Gtk.Widget,
  modelB: B.Behavior<Model<V>>,
): [B.Event<A>, Gio.SimpleAction] {
  void cls;
  const displayAbout = async (model: Model<V>): Promise<void> => {
    // Web: the documentation folder holds bundled data files, read through their URLs.
    const licensePath = desc.programDocs + "/LICENSE.txt";
    const licenseBytes = await readFileBytes(isDataFile(licensePath) ? builtinDataPath(licensePath) : licensePath);
    const licenseText = new TextDecoder("utf-8").decode(licenseBytes); // lenientDecode
    const about = Gtk.new_(Gtk.AboutDialog, {
      comments: "Current model contains " + String(M.size(model.modelContents)) + " entities.",
      copyright: "Copyright © Paul Johnson 2020. Licensed under BSD3 terms. "
        + "See License for details.",
      iconName: "diametric",
      license: licenseText,
      logoIconName: "diametric",
      programName: desc.programTitle,
      version: "Version " + version,
      website: "",
      websiteLabel: "",
    });
    const parentWin = Gtk.castTo(Gtk.Window, Gtk.widgetGetToplevel(parent));
    if (parentWin !== null) Gtk.set(about, { transientFor: parentWin });
    await Gtk.dialogRun(about);
    Gtk.widgetDestroy(about);
  };
  const action = Gio.simpleActionNew("helpAbout", null);
  const aboutClicked = registerIOSignal1(action, Gio.onSimpleActionActivate, (_) => [null, null] as const);
  B.reactimate(B.mapE((m: Model<V>) => () => {
    displayAbout(m).catch((err) => panic(err));
  }, B.tag(modelB, aboutClicked)));
  return [B.never<A>(), action];
}

/**
 * Quit the program.
 *
 * Web: a page cannot end its own process; after dropping the edit lock the window is replaced by
 * a short "program finished" page.
 */
export async function quitProgram(status: Maybe<FileStatus>): Promise<void> {
  const lock = preview(_Just<FileStatus>().dot(fileStatusLock).dot(_Just()), status);
  if (lock.tag === "Just") await dropEditLock(lock.value);
  Gtk.mainQuit();
  programHasFinished = true;
  showProgramFinished();
}
