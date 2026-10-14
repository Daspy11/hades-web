# mm: App.ModelMain

File: `src/hades/src/App/ModelMain.ts` (tests: `ModelMain.test.ts`, 5 tests: undo/redo/recordUndo,
`processHistoryClick` multi-step undo, `fixOldRelations`, `?open=` resolution). Every definition of
`hades/src/App/ModelMain.hs` is ported. Demo: `src/scratch/mmDemo.ts`, `?demo=mm` (welcome screen)
or `?demo=mm&open=2%20FMEA`: the real `modelMain` with the GSN + bow tie test dictionary of
`dsm/causality/Causality/BowTieTestModel.ts` (plus DSM-like activation/tree menus and `entityIcon`)
and the DSM descriptor, until `DSM.SafetyCase` / `dsm/Main` are ported. Driven in headless Chrome:
welcome screen → example, Start diagram opened, drag edits, Ctrl+Z / Ctrl+Shift+Z, history
dropdown menus, Data > Fields / Extension Fields, Find, About, Help > Manual (opens
`/src/dsm/share/documentation/Manual.pdf`, `application/pdf`), Recover from auto-save, browser
back/forward between diagrams (also reopening a closed one), dropping a `.dsm` file (with the
unsaved-changes prompt), Ctrl+Q → "program finished" page.

## API for dsm/Main

* `modelMain<V>(cls: ModelMainClass<V>, descriptor: MainDescriptor<V>): Promise<void>` — async
  (welcome screen and the initial read are awaited); resolves once the network is running. DSM:
  ```ts
  const dataTheme = getDataIconTheme();
  const dataDir = getDataDir("dsm");
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [dataDir]);
  void modelMain(safetyModelClass, MainDescriptor("dsm", "Diametric Safety Case Manager", "dsm",
    entityIcon, [dataDir], (_ctx) => {}, dataDir + "/documentation", Just(dataDir + "/examples")));
  ```
* `ModelMainClass<V> = Editable<HadesRender, V> & HasDiagrams<HadesRender, V> & HasEvidence<V>`
  (JSON via `JSON_Model(cls)`, i.e. `cls.entityJ`). The *same* dictionary should drive the
  diagram dictionaries' activation (GenericDiagram links call `cls.editableActivation` of the
  diagram type's dictionary).
* `MainDescriptor<V>` record with the Haskell fields; constructor `MainDescriptor(...)` in field
  order. `programAfterLoad: ModelEdit<V, V, void>` (`(ctx) => void`); `programStock: (e) => string`;
  folders are virtual data dirs (`getDataDir("dsm") + "/documentation"`).
* Also exported: `CmdOpts`, `cmdOpts(search?)`, `resolveOpenArg(desc, arg)`, `ModelHistory`,
  `emptyHistory`, `undo`, `redo`, `recordUndo`, `maxUndoLength`, `historyActions(window)`,
  `historyMenus(...)` → `[undoE, redoE, () => void]`, `processHistoryClick`, `openStartDiagram(cls, ctx)`
  (generator), `runAfterLoad(cls, desc, gen, model)`, `fixOldRelations(_cls, model)`,
  `extensionMenu(cls, parent, iconTheme, builder, modelC)`, `saveFileFilters(desc)`,
  `exportFileFilters(desc)` (synchronous), `confirmUnsaved(parent, changedB, event, action)` (async
  action allowed; result event fires when done), all `action*` functions (dictionary first where
  Haskell has `EntityClass`/`FromJSON`/`ToJSON`/`Reflective` constraints), `quitProgram(status)` (async).

## Web behaviour (`// Web:` in the code)

1. `?open=<example name | /builtin/... | /src/.../file.dsm>` replaces the command line file. Bundled
   files are read-only, so such a file is loaded like a welcome-screen example (unsaved, no edit
   lock). An unknown name gives an error box, then the welcome screen. `?font-config=` is accepted
   and ignored.
2. Browser history: each time a diagram/view becomes active (`editorActiveEntity` of the current
   editor) a `history.pushState({hadesActive: {modelId, viewTag}})` is made (replaceState for the
   first one). `popstate` → `editorActivate(modelId, viewTag)`; if it is not open, the entity's
   `cls.editableActivation(Just(ent))` script is sent (via an extra script input of
   `editorWindows`). Entries from an earlier model are ignored.
3. Dropping a file on the page (`dragover`/`drop` on the window, only for drags carrying files):
   `confirmUnsaved`, then `registerUpload` + `forEditing` + JSON decode, then like File > Open.
   Saving it later downloads it (an upload cannot be written in place).
4. `Gtk.windowSetUnloadGuard(window, () => changed)`.
5. Quit (menu, Ctrl+Q, window close) runs the `confirmUnsaved` path, drops the edit lock, then
   replaces the page with "The program has finished. Reload the page to start again." + Reload.
6. Autosave/recovery use `System.Hades.Autosave` (IndexedDB).
7. Help files are taken from `programDocs` (the Haskell used hades' own data dir, where the
   installer had copied them). A missing file (e.g. `Credits.html`, which does not exist in
   either package) gives GIO's "No such file or directory" error box instead of a blank tab.
* Window title shows the file *name* (`displayPath`), not the virtual path.
* `openStartDiagram` is sent in the moment *after* the new editor is built (the editor's own
  newly created inputs do not see the simultaneous `mapEventIO` occurrence in the TS FRP library).
* Panic recovery: `B.setErrorHandler` shows the Haskell "internal error" box and restarts the
  editor with the latest model and no file name (as the `catch Gtk.main` loop). Async action
  failures go to the same handler.
* Fix of an original bug (documented in code): every editor built for a loaded file kept running
  in the Haskell (dynamically created networks are never removed), so after opening a second file
  the window's Undo/Redo actions and the start-diagram script also reached the old, hidden editor
  (which could overwrite the undo menus and autosave the old model under the new name). Editors
  carry a generation number and only the current one receives these shared inputs.
* `Gtk.set action [#enabled := False]` → `Gio.simpleActionSetEnabled` (notifies menus/tool buttons).

## Toolkit changes

* `Gtk/Builder.ts`: Glade `<accelerator key modifiers signal="activate">` on a widget with an
  `action_name` is registered in its window's accelerator table (as GTK's accel group). Menus already
  showed the hints; now Ctrl+N/O/S/Shift+Ctrl+S/Q/Z/Shift+Ctrl+Z/F work in the app window.
* `Gio.ts` `accelOfEvent`: Shift is kept for letters (`<Shift><Control>z` is Ctrl+Shift+Z; it used
  to be read as Ctrl+Z). Unchanged for other printable characters.
* `Gtk/Widgets.ts` `menuAttach(menu, child, left, right, top, bottom)` now has gi-gtk's meaning
  (places the item in row `top`); it was an alias of `menuAttachToWidget`. No other callers.
* `Gtk/RenderBars.tsx`: the dropdown arrow of an insensitive `MenuToolButton` is disabled too (an
  empty undo history left the stale menu reachable).
* `Gtk/theme.css`: the About dialog's licence is a bounded scrolled box (the DSM licence made the
  dialog taller than the screen).

## Known gaps

* `BowTieTestModel` (demo only) has no reflective fields for packages and its diagram dictionaries'
  activation does nothing, so in the demo package names are blank in the property panel and
  GenericDiagram links are not followed; DSM.SafetyCase will provide both.
* Message dialog button order (Yes left of No) is the toolkit's AlertDialog rendering.
