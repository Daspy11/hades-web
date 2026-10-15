# sc: DSM.SafetyCase and the `dsm` program (`dsm/Main`)

Files: `src/dsm/DSM/SafetyCase.ts` (+ `SafetyCase.test.ts`, 18 tests; the review added tests of the
instance members (causal JSON read as an unsupported package, names, `isDiagram`,
`entityCanHaveChild`, `diagramEntityTypes`, `queryAvatars`, `getDiagramWrapper`,
`diagramMapAvatars`), the tree/editable menus, and of BasicTypes' `matrixExport`, `matrixRun`,
`lookupEdit`, `basicsActivation`, `reportRun`, `reportPreview` scripts stepped on example 3; the
original 7: each example `.dsm` loads as a
`SafetyModel` model; examples 1 and 2 are written back to identical JSON, every entity of them
round-trips through `JSON_SafetyModel`; examples 3 and 4 are migrated on reading and stable after
that; reflective defaults build without recursion) and `src/dsm/Main.ts` (replaces the placeholder;
`src/main.ts` calls `main()` at `http://localhost:5173/`). Every definition of both Haskell files is
ported. No toolkit or `src/lib` changes.

## API

* `SafetyModel` tagged union (`GsnItem`, `CausalItem`, `BowTieItem`, `BasicItem`, `EvidenceItem`,
  `TraceItem`, field `_0`), constructor functions of the same names, `eq_SafetyModel`.
  The GSN/causal/bow tie modules are imported qualified (`GSN.GsnItem<V>` is the *type*; the
  constructor `GsnItem(...)` here builds a `SafetyModel`).
* Prisms (constants): `_GsnItem`, `_CausalItem`, `_BowTieItem`, `_BasicItem`, `_EvidenceItem`,
  `_TraceItem`, `_ModelPackage`, `_ModelQuery`, `_ModelMatrix`.
* `safetyModelClass: SafetyModelClass` — the one dictionary for every single-dictionary instance
  (Reflective, EntityClass with `PackageMeta = PackageAppearance SafetyModel`, Editable HadesRender,
  Queryable, HasMatrices, HasReports, HasBowTie, HasCausal, HasLookups, HasBasics, HasDiagrams,
  HasEvidence, HasGsn, JSON via `entityJ`). Aliases `Reflective_SafetyModel`,
  `EntityClass_SafetyModel`, `Editable_SafetyModel`, ..., `HasGsn_SafetyModel`; codec
  `JSON_SafetyModel`. This is the dictionary given to `modelMain`.
* The three `AppearanceClass t SafetyModel` instances are separate dictionaries inheriting from
  `safetyModelClass` (`Object.create`): `AppearanceClass_GsnDiagramType_SafetyModel` (pass to GSN
  functions needing `GsnClass`), `AppearanceClass_CausalType_SafetyModel` (`CausalClass`),
  `AppearanceClass_BowTieType_SafetyModel` (`BowTieClass`). `safetyModelClass` itself carries the
  GSN `getDiagramAppearance` only so that it satisfies those dictionary types.
* Laziness (q1.md/bt.md): sub-type dictionaries/codecs are built on first use; `reflectiveDefaults`,
  `reflectiveBuiltInRefs`, `reflectiveArrows`, `name`, `entityFunctions`, `entityJ`,
  `diagramEntityTypes` are (memoised) getters. Do not spread `safetyModelClass`.
* Menus/scripts: `topEntityMenu`, `topEditableMenu` (`EntityMenu`s), `safetyModelActivation`
  (`ActivationScript`), `editPackageDiagramAppearance(ctx, mId)` (generator script),
  `entityIcon(ent)`.
* `dsm/Main.ts`: `modelDescriptor(): MainDescriptor<SafetyModel>` (synchronous; data dir
  `getDataDir("dsm")` = `/src/dsm/share`), `main(): Promise<void>` (sets up the data icon theme
  "Diametric" with the data dir as search path, then `modelMain(safetyModelClass, modelDescriptor())`).

## Real app, driven in headless Chrome (all of this works, no console errors)

Welcome screen → "1 Quick Guide to the DSM" → Continue: the Start diagram opens, the package tree
shows the model. Tree expanders, double-click a package (properties dialog), double-click
"Top level argument." (GSN diagram opens in a new tab, renders correctly). Click G3 selects it
(handles), drag moves it (arrows follow), double-click G3 opens "Goal properties"; editing the
Description and OK updates the box. Ctrl+Z twice undoes text edit and move, Ctrl+Shift+Z twice
redoes both. Hazard Log > Bow Tie Analysis > "BowTie Diagram" opens and renders (colours,
highlights, evidence icon, trace arrow). File > Save → "Save Model File" name dialog → download of
`<name>.dsm` (877 kB, contains the edit, same structure as the example). Tree right-click menus
(Properties, Add package, GSN Items ▸, Bow Tie Items ▸, Add Evidence/Trace, Edit diagram style,
Add query/matrix/report/lookup table, Clone, Delete) and the "Style of Diagrams in this Package"
dialog work.

Driver: `scratchpad/sc/flow.mjs` + `steps.mjs` (playwright; `NOPICKER=1` removes
`showSaveFilePicker`).

## Notes for the video

* Selecting a box in a diagram does not change the property panel (faithful: in Haskell only tree
  selections and scripts set the model selection). Edit a box's text by double-clicking it (or via
  the tree). 
* Headless Chrome exposes `showSaveFilePicker`; with it, Save completes silently (no download
  event). Remove it (`delete Window.prototype.showSaveFilePicker` in an init script) to get the
  in-app "Save Model File" dialog and a normal download. In a headed Chrome the native picker shows.
* The save name defaults to "untitled" for an example opened from the welcome screen (it has no
  file name, as in the original).
