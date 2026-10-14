# bt: Model.Abstract.BasicTypes

File: `src/hades/src/Model/Abstract/BasicTypes.ts` (tests: `BasicTypes.test.ts` next to it, 10 tests:
JSON round trip of every package/query/matrix/report/lookup entity in the four example `.dsm` files
through `JSON_ModelBasics`, whole-model load/save stability with a toy model type, reflective
defaults without recursion, `basicsName` on every variant, root and matrix menus). Every definition
of `hades/src/Model/Abstract/BasicTypes.hs` is ported, including the unexported `packageMenu1`,
`matrixEdit`, `matrixRun`, `matrixExport`, `reportEdit`, `reportPreview`, `reportRun`,
`lookupEdit` (all exported in TS). No toolkit or `src/lib` changes.

## Data and classes

* `ModelBasics<V>` tagged union, positional `_0`: `BasicPackage(p: Package<V>)`,
  `BasicQuery(q: QueryDiagram<V>)`, `BasicMatrix(m: Matrix)`, `BasicReport(r: Report<V>)`,
  `BasicLookup(t: LookupTable)` (constructor functions). Derived `Eq` = structural `equals`.
* `HasBasics<V> extends EntityClass<V>, HasReports<V>, HasLookups<V>` with
  `_Basics: Prism<V, ModelBasics<V>>`. (`HasReports` already brings `HasMatrices`/`Queryable`, so a
  `HasBasics` dictionary has `_Package`, `_QueryDiagram`, `queryAvatars`, `_Matrix`, `_Report`,
  `_LookupTable`, `_Basics`.)
* Prisms are zero-arg generic functions: `_BasicPackage<V>()`, `_BasicQuery<V>()`,
  `_BasicMatrix<V>()`, `_BasicReport<V>()`, `_BasicLookup<V>()` (the first four accept an optional,
  ignored `EntityClass` argument like `packageName`). `basicsName<V>()` is the `Lens<ModelBasics<V>, Name>`
  (`singular` of the `failing` chain).
* `basicsDiagramEntityTypes` is a constant (`M.empty()`).

## Instances (take `cls: QueryableEntityClass<V>`)

* `JSON_ModelBasics(cls)`: writes the variant's own JSON; reads by the `"type"` field
  (`package`, `Query Diagram`, `matrix`, `report`, `lookup-table`; missing → v0.5 query;
  otherwise `fail "Unknown entity type: <t>"`). Sub-codecs are built on first use.
* `Reflective_ModelBasics(cls)`: delegates to `Reflective_Package(cls)`, `Reflective_QueryDiagram(cls)`,
  `Reflective_Matrix`, `Reflective_Report`, `Reflective_LookupTable`. **`reflectiveDefaults`,
  `reflectiveBuiltInRefs` and `reflectiveArrows` are memoised getters and the sub-dictionaries are
  built lazily**, so it is safe to call `Reflective_ModelBasics(cls)` while `cls` (e.g. DSM's
  `SafetyModel`) is being built, and to define the model's own `reflectiveDefaults` as a getter that
  maps over `basicsR.reflectiveDefaults`. Do **not** spread this dictionary into the model's at
  construction time (that evaluates the getters); delegate per member (see the test file's `tc`).
  `variantUserLabel` is `defaultVariantUserLabel`.

## Functions (dictionary first, then context, then Haskell arguments)

* Pure: `basicsCanHaveChild(cls, b)`, `basicsIsDiagram(cls, b)`, `basicsIcon(cls, b)` (icon names
  `model-package`, `model-query`, `model-matrix`, `model-report`, `model-lookup`).
* `basicsDiagramWrapper(cls: QueryableEntityClass<V>, ctx: ModelEditCtx<V, ModelBasics<V>>, ent)`:
  a `ModelEdit v (ModelBasics v)`. SafetyCase's `withSubtype _BasicItem $ basicsDiagramWrapper e` is
  `withSubtype(ctx, _BasicItem, (c) => basicsDiagramWrapper(cls, c, e))`.
* Menus (`Menu<ModelScriptAct<P, V, V, Maybe<Text>>>`):
  `rootMenu(cls: HasBasics<V>, prsm, appMenu)`, `packageMenu(cls, prsm, appMenu, uuid)`,
  `packageMenu1(cls, prsm, appMenu, uuid)`, and
  `basicsMenu(cls: BasicsEditableClass<V>, prsm, appMenu, ent)` with
  `BasicsEditableClass<V> = Editable<HadesRender, V> & HasBasics<V> & HasDiagrams<HadesRender, V>`.
  The "Add ..." templates (`Package "`, `Query "`, ...) are built when the item runs; the query
  template's inputs are all variant names of `cls.reflectiveDefaults`.
* Scripts (generator functions, `ModelScript<P, V, Maybe<Text>>`, ctx is `ModelEditCtx<V, V>`):
  `basicsActivation(cls: BasicsEditableClass<V>, ctx, ent)` — as an `ActivationScript` branch:
  `(ctx) => basicsActivation(cls, ctx, e)`; `matrixEdit(cls, ctx, mId)`, `matrixRun(cls, ctx, mId)`,
  `matrixExport(cls, ctx, mId)`, `reportEdit(cls, ctx, prsm, mId)`, `reportPreview(cls, ctx, mId)`,
  `reportRun(cls, ctx, mId)`, `lookupEdit(cls, ctx, mId)`. Helper dictionary types
  `MatrixEditClass<V>`, `ReportRunClass<V>` are exported.
* I/O goes through `performIO`: `writeMatrixToFile(matrixBook(...))` (the book is built inside the
  thunk, per mx.md), `previewReport(cls, model, title, blks, imgs)`,
  `writeReportToFile(cls, format, title, model, blks, imgs)` (all async; the thunk returns their Promise).

## Known gaps

* Exercised only through the toy model in the test (JSON, reflective, menus); the scripts
  (`matrixExport`, `reportPreview`, ...) have not been run end-to-end inside the real app yet,
  because DSM.SafetyCase / ModelMain are not ported.
