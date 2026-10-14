# rd: Model.Report.Dialogs

File: `src/hades/src/Model/Report/Dialogs.ts` (tests: `Dialogs.test.ts` next to it, 33 tests, including
the dialogs rendered with the GTK toolkit under jsdom). Every definition of
`hades/src/Model/Report/Dialogs.hs` is ported, exported or not. Demo: `src/scratch/rdDemo.ts`
(`?demo=rd`; `&report=<n>` picks a report of "3 Managing Risks.dsm", `&section=1` first adds a
section with three children, `&dialog=run|preview|warnings|<n>` opens the run, preview or warnings
dialog, or the dialog of top-level fragment `n`, at start-up). The design editor's edits are applied
to the model and their undo messages are shown.

## API (dictionary first, then the Haskell arguments)

* `ReportDialogClass<V> = EntityClass<V> & HasLookups<V> & HasMatrices<V>` (the
  `(EntityClass v, HasLookups v, HasMatrices v)` constraint; `HasMatrices` includes `Queryable`).
* Tree conversion: `reportFragmentToTree(frag)`, `reportFragmentsToForest(frags)`,
  `reportFragmentFromTree(tree)`, `reportFragmentsFromForest(forest)`; `reportTreeIso<V>()` is a
  zero-argument generic function returning the `Iso<ReportFragment<V>, Tree<ReportFragment<V>>>`.
* `reportDesignGadget(cls: ReportDialogClass<V>, reportId)` →
  `Gadget_<Model<V>, ModelEdit<V, Report<V>, Maybe<Text>>, [null, Report<V>]>`. The side channel
  carries `(ctx: ModelEditCtx<V, Report<V>>) => Maybe<Text>` functions. BasicTypes' `reportEdit`
  (`sendMap (Just . lift . withSubtype (prsm . _BasicReport)) $ reportDesignGadget mId`):
  `sendMap((e) => Just(function* (ctx) { return withSubtype(ctx, prsm.dot(_BasicReport), e); }), reportDesignGadget(cls, mId))`.
* `reportDialogSelector<V, W = any>(cls: ReportDialogClass<V>)` → the uncurried selector
  `(model, frag) => Maybe<Dialog_<Model<V>, W, ReportFragment<V>>>` (`Nothing` for `ReportDiagram`).
* `ReportFormat` tagged union: `ReportHtml(target)`, `ReportDocx(layout, target)`,
  `ReportTemplate(template, target)` (positional `_0`, `_1`); derived `Eq` = structural `equals`;
  `show_ReportFormat` (derived `Show`, e.g. `ReportDocx US Letter Portrait "r.docx"`). The prisms
  `_ReportHtml`, `_ReportDocx` (focus `readonly [ReportPageLayout, FilePath]`), `_ReportTemplate`
  (focus `readonly [FilePath, FilePath]`) are exported constants (unexported in Haskell).
* `ReportRunParameters(target: S.Set<ModelId>, format)` record `{ _reportTarget, _reportFormat }`;
  constant lenses `reportTarget`, `reportFormat`; `show_ReportRunParameters`.
* `reportRunDefault(rpt)`; `reportRunDialog(cls: EntityClass<V> & HasMatrices<V>, previewFlag, report)`
  → `Dialog_<Model<V>, null, ReportRunParameters>`; `reportWarningsDialog(cls: EntityClass<V>, warnings:
  readonly (readonly [ModelId, Text])[])` → `Dialog_<Model<V>, null, null>`.
  BasicTypes: `const p = yield* openDialog(ctx, constantDialog(reportRunDialog(cls, true, rpt)), reportRunDefault(rpt))`;
  target id `fromMaybe(U.nil, listToMaybe(S.toList(view(reportTarget, p))))`; warnings:
  `openDialog(ctx, constantDialog(reportWarningsDialog(cls, warns)), null)`.
* Model.GI.Export's `writeReportToFile` switches on `format.tag`: `ReportHtml` → `_0` is the target,
  `ReportDocx` → `makeDocx(Just(f._0), title, f._1, …)`, `ReportTemplate` → `insertDocx(f._0, f._1, …)`.
  The paths are whatever the toolkit's `filePathSelector` returns (`@/lib/System/IO` virtual paths:
  `/download/...` or a `/handle/...` from the save picker for outputs, `/upload/...` or `/handle/...` for
  the template).
* Exported for the tests only (`where` bindings in Haskell, taking what they close over first):
  `treeMenu(mItem)`, `addOptions<V>()` (a function, so module initialisation does not depend on
  `nameField`), `reportDelta(cls, reportId, oldName, [model, r1, r2])`, and the run dialog's input
  helpers `topQueryIds(report)`, `topQueries(cls, report, model)`, `queryInputSet(cls, report, model)`,
  `topMatrixIds(report)`, `topMatrices(cls, report, model)`, `matrixInputs(cls, report, model)`,
  `inputFilter(cls, report, model): (e: Entity<V>) => boolean`.

## Notes

* No async code: the dialogs are plain `Dialog` values run by the interpreter (`runDialog`/scripts).
* `proc` blocks (`reportDesignGadget`, the section dialog, the warnings dialog) are desugared with
  `gPipe`/`gFanout`/`arr`, originals kept as comments. `mapping reportTreeIso` uses a local list
  `mapping` helper (not in `@/lib/Control/Lens`).
* Behaviour kept as in Haskell: the design tree shows a section as
  `Section: <query> ordered by Name▲.  ` with nothing after it (its children are tree children, so its
  own sub-report list is empty); the heading dialog's field combo is in field-ID order while the
  field dialog's is sorted by name; `reportDelta` names only the first difference but stores the whole
  new report; fragment descriptions in undo messages are cut to 39 characters plus "…".
* GTK interpreter behaviour seen in the tests (not this module's): after switching the output format
  tab of the run dialog to a page whose file name is empty, the emitted value has `_gdOk` true (the
  page's validation is not applied to the value read on a tab switch); a dialog opened on such a page
  starts with OK disabled. This is the Haskell behaviour too, not a porting bug: `UnionTab` emits
  `valueB . gadgetValue` of the newly selected tab, and each tab is `accum $ form ...`, whose
  `gadgetValue` is the incoming behaviour `b` (carrying the previous OK state), not the validated
  output.
* No toolkit (`src/lib/GI`) or `src/lib` changes.
