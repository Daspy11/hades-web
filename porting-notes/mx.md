# mx: Model.Matrices.{Design,Excel,Screen}

Files: `src/hades/src/Model/Matrices/{Design,Excel,Screen}.ts` with `Design.test.ts` (23 tests),
`Excel.test.ts` (27 tests, the workbook is checked with python3 openpyxl) and `Screen.test.ts`
(11 tests). Every definition of the three Haskell modules is ported, including the `where`-bound
helpers. Demo: `src/scratch/mxDemo.ts` (`?demo=mx`; `&matrix=<n>` picks the matrix,
`&page=design` opens the design page): runs, edits and exports the matrices of
"3 Managing Risks.dsm".

Test support (not Haskell ports, used by the three test files and the demo):
`src/hades/src/Model/Matrices/testing/RiskModel.ts` (a small `EntityClass & Queryable &
HasLookups & HasMatrices & Editable` dictionary, `riskClass`, that loads example 3: packages,
query diagrams, matrices, lookup tables, controls and risk events; other entities are kept as
raw JSON) and `testing/dumpXlsx.py` (dumps an `.xlsx` as JSON with openpyxl:
values, types, fonts, fills, borders, number formats, alignment, merges, column widths, row
heights; run as `python3 -I dumpXlsx.py file.xlsx`).

## Calling conventions (dictionary first, then context, then the Haskell arguments)

### Design (`Model.Matrices.Design`)

* `DesignItem` = `DesignQuery(mId, sortOrder)` | `DesignColumn(column)` (positional `_0`, `_1`);
  prisms `_DesignQuery` (focus `readonly [ModelId, SortOrder]`) and `_DesignColumn` are constants.
  `Design = Forest<DesignItem>`.
* `designItemText(cls: EntityClass<V>, model, item): Text`.
* `matrixDesignIso: Iso<Matrix, MatrixDesign>` (constant), where
  `MatrixDesign = readonly [Name, Text, S.Set<ModelId>, Design]` is the Haskell 4-tuple.
* `matrixDesignGadget(cls: MatrixDesignClass<V>, matrixId)` →
  `Gadget_<Model<V>, ModelEdit<V, Matrix, Maybe<Text>>, [null, Matrix]>`, with
  `MatrixDesignClass<V> = EntityClass<V> & HasLookups<V> & HasMatrices<V> & Queryable<V>`.
  The side channel carries `(ctx: ModelEditCtx<V, Matrix>) => Maybe<Text>` functions. BasicTypes'
  `sendMap (Just . lift . withSubtype _Matrix) $ matrixDesignGadget mId` is
  `sendMap((e) => Just(function* (ctx) { return withSubtype(ctx, cls._Matrix, e); }), matrixDesignGadget(cls, mId))`.
* `sortOrderGadget<V, W>(cls: EntityClass<V>): GadgetF_<Model<V>, W, SortOrder>` (Report.Dialogs:
  `focusingOver(_2(), sortOrderGadget(cls))`).
* Exported for the tests although local in Haskell: `validDesign(cls, model, old, new)`,
  `columnDesignIso`, `matrixDelta(cls, matrixId, oldName, [model, d1, d2])`, `designMenu(mItem)`,
  `canBeParent(item)`, `itemDialog(cls, item)`.

### Excel (`Model.Matrices.Excel`)

* `MatrixCells = M.Map<readonly [number, number], FormattedCell>` keyed `[row, column]` (1-based).
* `matrixExportDialog(cls: QueryableEntityClass<V>, model, matrix): Dialog_<Model<V>, null, S.Set<ModelId>>`.
* `matrixErrorsDialog(msgs)`, `matrixWarningsDialog(msgs)`: `Dialog_<E, null, A>`.
* `matrixCells(cls: QueryableEntityClass<V> & HasLookups<V>, model, input, matrix)` →
  `Either<Text[], [MatrixCells, Text[]]>` (Left = errors; Right = cells and warnings).
* `matrixBook(cls, model, matrix, title, cells): Xlsx`; write it with
  `fromXlsx(posixSeconds, xlsx)` (`@/lib/Codec/Xlsx`). **Difference:** for an empty cell map
  (a matrix with no column groups) it throws `Prelude.maximum: empty list` at once; the Haskell
  raised it lazily when the workbook was serialised (inside BasicTypes' `performIO $
  writeMatrixToFile ...`). Call it inside the `performIO` thunk to keep the error at that point.
* Also exported: `tabulateCell(cls, ctx: ModelEditCtx<V, V>, outerIds, valueses, column)`,
  `makeFieldCell(ctx, fid, value, link)`, `makeHeaderCell(txt)`, `extValueToExcel(v, link)`,
  `matrixColumn(cls, model, n, column)`, constants `matrixFormat`, `matrixFont`, `matrixBorders`,
  `matrixAlignment`.
* Output (checked with openpyxl): headers bold/centred in row 2 (group names merged across their
  columns in row 1 when there is more than one group), data from row 3, parent cells merged
  down over their children's rows, thin automatic-colour borders, vertical centring and wrap on
  every data cell, `d-mmm-yy` dates as Excel day numbers (epoch 1899-12-30), solid fills for
  enum/decorated colours (`FF` + upper-case hex), red (`FFA00000`) warning text, link columns as
  `HYPERLINK("url","text")` formulas without a cached value, column widths
  `min 30 (max (length heading / 2) typeWidth)` with `bestFit`, row heights 10 (automatic).
  Sheet names lose `[]*?:/\`, one leading and one trailing apostrophe, and are cut to 31 chars.

### Screen (`Model.Matrices.Screen`)

* `MatrixScreenClass<P, V> = Editable<P, V> & EntityClass<V> & HasLookups<V> & HasMatrices<V>`.
* `MatrixGadget<P, V, I> = GadgetF_<Model<V>, ModelScriptAct<P, V, V, Maybe<Text>>, I>`.
* `getMatrixWrapper(cls, ctx: ModelEditCtx<V, V>, ent): Maybe<EntityWrapper<P, V>>` (a `ModelEdit`;
  BasicTypes' `lift (getMatrixWrapper ent)` is `getMatrixWrapper(cls, ctx, ent)`): a
  `ViewWrapper` with tag `"run"`, `viewInput = Left(null)`, `viewInitial` = the default inputs.
* `matrixDisplay(cls, mId)` → `Gadget_<Model<V>, ModelScriptAct<P, V, V, Maybe<Text>>, [S.Set<ModelId>, null]>`.
  The field-edit scripts never yield (they are `lift $ do ...`); scripts from query columns
  (`clickableEntitySet`, i.e. `Editable` activation and menus) may yield instructions, so run
  them through the normal script interpreter.
* Exported for tests: `MatrixRow = readonly [readonly ModelId[], ExtensionValues, ExtensionValues]`,
  `getForest(cls, queries, sorts, inputs, model)`, `ancestorize(forest)`,
  `matrixTable(cls, model, matrix)`, `columnTableField(cls, model, column)`,
  `fieldColumn(cls, field, linkField)`.

## Notes

* No async code, no toolkit changes.
* Faithful quirks: the "anc" (third) component of a matrix row is root-biased (`foldr` with a
  left-biased union: an ancestor's value hides the entity's own value of the same field); the
  expression column dialog is titled "Field Column"; `sortOrderGadget` lists stamp fields but
  drops them when read back (they are not in its name map); in a multi-group matrix a group with
  no columns gives `Left ["Internal error: Model library client error: Query group has no
  columns."]`; `linkFieldMenu` lists URL fields in field-ID order (not sorted), `fieldNameMenu`
  sorted by name.
