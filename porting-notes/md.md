# md: Model.GI.ModelDiagrams

File: `src/hades/src/Model/GI/ModelDiagrams.ts` (tests: `ModelDiagrams.test.ts` next to it, 27 tests:
interpreter steps, replayed Apply continuations, IO (sync/async/errors), opening diagram and view
editors, deleting an open diagram, `diagramInsertSelection`, `renderForExport`, PNG encoding, and
the `editorWindows` browser-history hooks). Every definition of the Haskell module is ported.
Demo: `src/scratch/mdDemo.ts` (`?demo=md`): a small model of packages, "things" and box
diagrams edited with `editorWindows`. It covers the tree, the property panel, opening diagrams,
moving/adding/deleting boxes, the properties dialog of a new thing, Refresh, Export and
`renderForExport` + `renderOnPng` (the "PNG" button). `window.md` exposes the state (`log`,
`model()`, `names()`, `boxes(name)`, `open(1|2)`, `activate(1|2)`, `showPng()`).

## API for App.ModelMain and others

* `editorWindows<V>(cls: Editable<HadesRender, V> & EntityClass<V>, window, iconTheme, picF,
  modelInit, modelC: Changes<Model<V>>, refreshE: Event<null>, scriptE: Event<ModelScriptAct<HadesRender, V, V, Maybe<string>>>)`
  → `EditorOutput<V>`. Synchronous MomentIO: call it while a network is being built.
* `EditorOutput<V>` has the Haskell fields `editorUpdates`, `editorDiagramExport`,
  `editorTreeInfo` and `editorWidget`, plus two **Web-only browser-history hooks**:
  * `editorActiveEntity: B.Event<ActiveEntity<HadesRender, V>>` fires whenever a diagram or view
    editor becomes the active one (this is the book manager's active event). Read
    `a.activeWrapper.wrappedEntityId` (and `viewTag` for a `ViewWrapper`) to push a history entry.
  * `editorActivate(modelId, viewTag?) => boolean` brings an *open* editor to the front of its
    notebook, focuses its canvas and makes it active, which fires `editorActiveEntity`. It returns
    false if no such editor is open. Without a view tag it matches only a diagram editor, with
    one only the view editor of that tag (as `sameEntityView`). In that case, open it by sending an `openDiagram` script
    through `scriptE`. Call it outside a network moment, e.g. from a `popstate` handler.
    Suppress your own history push for the activation you triggered.
* **Feed back only described updates.** As in Haskell (`processModelUpdates` keeps `Just`
  values), the model behaviour given to `editorWindows` must change only for updates whose
  `updateValue` is `Just`. Each model change makes every open diagram run `updateDiagram`, and
  that update's value is `Nothing`. Feeding back every update therefore loops forever.
* `exportDrawing(parent, iconTheme, export): Promise<void>` (async: type dialog, then the
  native save chooser; the file is written with `@/lib/System/IO.writeFileData`, normally a
  download). `exportTypes`, `exportTypeDialog()` exported.
* `renderForExport<P, V, W, D>(cls: Connectable<D>, vcls: EntityClass<V>, iconTheme, prsm, model,
  ctx, diagram)` → `[Cairo.Render<void>, [w, h]]` (points). The two dictionaries come first.
* `renderOnPng(res, [w, h], drawing): Uint8Array` (synchronous; PNG with a pHYs chunk, as
  JuicyPixels `encodePngWithMetadata (mkDpiMetadata res)`); helpers `encodePngWithMetadata(dpi, w,
  h, pixelFn)` and `getBytes(pixel)` are exported.
* Re-exported types: `ActivationScript`, `EntityMenu`, `DiagramExport`.
* Exported although internal in Haskell: `InterpreterResult` (+ constructors, `getInterpreter*`,
  `show_InterpreterResult`), `StateScript`, `PropertiesContinuation`, `processModelScripts(cls,
  widget, iconTheme, book, selectionB, modelC, scriptsIn)` → `[updates, selections, hints,
  errors]`, `popupPropertiesEvent(cls, parent, iconTheme, [k, uuid, replayable?])`,
  `interpretScript(cls, parent, iconTheme, modelC, selection, hint, [state, script])`,
  `entityEditor(cls, iconTheme, manager, wrapper, selectionB, modelC): Maybe<ActiveEntity>`,
  `drawingDragAndDrop(canvas, selectionB)`, `*diagramInsertSelection(d, ids, pt)`,
  `*diagramInsertEntity(d, pt, id)`, `openDiagramInBook(cls, ...)` (returns `() => void`),
  `newTabLabel(widget, textB)`, `selectionAdded`, `mergeScripts` (where-helpers).

## Interpreter decisions (`// Web:`)

* `interpretScript` steps scripts with `stepScript` (DiagramType), whose continuations can be
  resumed any number of times. The Apply button of `openDialog`/`openProperties` dialogs therefore
  re-runs the rest of the script, as in Haskell.
* Diagram Delta scripts cannot be replayed, because the Delta stream is consumed linearly. The
  diagram editor wraps every diagram script in `fromDeltaScript`, which marks each instruction
  (`isDeltaInstruction`). Dialogs opened from marked instructions are shown without an Apply
  button (`disableApply1` for `ScriptDialog`, `disableApply` for properties), so their
  continuation runs once.
* `ScriptPerformIO`: the thunk may return a Promise. It is awaited in a `reactimate` handler
  before the script continues. `IOError`/`DOMException` become user errors, as Haskell's
  `Ex.try` of an `IOException` does. Other exceptions propagate to the network's error handler
  (`B.setErrorHandler`, ModelMain's panic recovery); for a rejected Promise this is done by
  rethrowing it inside the network where the script would have continued (review fix: it used
  to become an unhandled rejection).
* In Haskell the continuation of `ScriptOpenDiagram` feeds straight back into the script event
  (an instantaneous cycle). The TS FRP library cannot do that, so it goes through the same
  feedback event (`nextE`) as hints and selections. It runs in the moment after the diagram is
  opened.
* Faithful quirk: `ScriptGetSelection` continues from the state *before* the step, as the
  Haskell does. Nothing in HADES uses it.

## Toolkit

* No toolkit changes in this task.

## Known gaps

* Dialogs opened from inside a diagram (avatar properties, "Find in other diagrams") have no
  Apply button (see above).
* Drag and drop from the tree onto a canvas is wired (`widgetDragDestSet`, `drag-drop`) but was
  not driven in headless Chrome. The test covers `diagramInsertSelection` directly.

## Review (independent side-by-side check against the Haskell)

* Every top-level and `where` definition was checked against `ModelDiagrams.hs`; names, argument
  order, control flow and message texts match. Fixed: async `performIO` failures (above) and
  `editorActivate` matching a view editor for a diagram history entry. Test added:
  "passes other exceptions of IO actions ... to the network's error handler".
* The known gap (no Apply button for dialogs opened from inside a diagram Delta) remains: a
  replay restarts the Delta machine from the `HadesGtk` snapshot of the batch, which is only
  equivalent at a quiescent point; a dialog at the end of a multi-batch command (e.g. a tool's
  drag that creates an entity and opens its properties) would replay differently.
