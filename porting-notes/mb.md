# mb: Model.Matrices.Base

`src/hades/src/Model/Matrices/Base.ts` (tests: `Base.test.ts` next to it). Every definition of
`hades/src/Model/Matrices/Base.hs` is ported, exported and internal.

## Classes

* `HasMatrices<V> extends Queryable<V>` with the member `_Matrix: Prism<V, Matrix>`. A model
  dictionary for `(EntityClass v, HasMatrices v)` is `EntityClass<V> & HasMatrices<V>`;
  `HasMatrices` already includes `Queryable`, so `QueryableEntityClass<V> & HasMatrices<V>` works too.
* `MatrixId = ModelId`.

## Data

* `FieldColumnData(text: FieldId, link: Maybe<FieldId>)`: record `{ _fieldColumnText, _fieldColumnLink }`;
  `def_FieldColumnData` (`nameField`, `Nothing`), `JSON_FieldColumnData` (also reads a plain
  field-name string; names go through `migrateField1`), `show_FieldColumnData`. Lenses
  `fieldColumnText`, `fieldColumnLink` are constants.
* `MatrixColumnData` is a tagged union: `FieldColumn(f)` (`_0`), `ExprColumn(isMemo, expr)` (`_0`, `_1`),
  `QueryColumn(qId)`, `LookupColumn(tableId)` (`_0`). Prisms are constants: `_FieldColumn`,
  `_ExprColumn` (focus `readonly [boolean, Text]`), `_QueryColumn`, `_LookupColumn`.
  `show_MatrixColumnData` is the derived Show.
* `MatrixColumn(name, data)`: `{ _columnName, _columnData }` (Haskell field names; the lenses are
  `matrixColumnName`, `matrixColumnData`). `JSON_MatrixColumn`, `show_MatrixColumn`.
* `SortDir` = `"Ascending" | "Descending"`, `sortDirValues`, `JSON_SortDir`, `show_SortDir`.
  Use `enumComparator(sortDirValues)` if the derived `Ord` is ever needed.
* `SortOrder` has its own JSON instances, so it is **not erased**: it is the record
  `{ getSortOrder: readonly (readonly [FieldId, SortDir])[] }` built with
  `SortOrder([[fid, "Ascending"], ...])`. Haskell `getSortOrder s` is `s.getSortOrder` or the function
  `getSortOrder(s)`; the pattern `(SortOrder [])` is `s.getSortOrder.length === 0`.
  `JSON_SortOrder` (list of `[fieldId, dir]` pairs; reads field names via `migrateField1`) is the
  instance Report.Base needs for `v .:? "sort" .!= SortOrder [(nameField, Ascending)]`
  (`J.fieldDefault(o, "sort", JSON_SortOrder, SortOrder([[nameField, "Ascending"]]))`).
* `ColumnGroup(query, columns, sort)`: `{ _groupQuery, _groupColumns, _groupSort }`; lenses
  `groupQuery`, `groupColumns`, `groupSort`. `JSON_ColumnGroup` (missing/null `"sort"` defaults to
  name ascending; also reads the old list-of-names sort).
* `Matrix(name: Name, description, defaultInput: S.Set<ModelId>, groups)`:
  `{ _matrixName, _matrixDescription, _matrixDefaultInput, _matrixGroups }`; lenses `matrixName`,
  `matrixDescription`, `matrixDefaultInput`, `matrixGroups` are constants. `JSON_Matrix` (`"type":
  "matrix"`, checked with `checkType`) and `Reflective_Matrix` (constant). Model types
  (BasicTypes) delegate their Matrix variant to `Reflective_Matrix`.
* Equality is the structural `equals` (derived `Eq`).

## Functions

* `showSortOrder(fieldTable, sortOrder): Text` ("Name▲, Rank▼", unknown fields "-?-").
* `matrixInputSet(cls: QueryableEntityClass<V>, matrix, model): S.Set<Variant<V>>`.
* `compileMatrix(cls: QueryableEntityClass<V>, matrix, model): Either<Text[], Query<V>[]>`. As in
  Haskell the error prefix numbers count the *failing* groups (1, 2, ...), not group positions.
* `runMatrix(queries, model, inputs): [Forest<ModelId>, Text[]]` (no dictionary).
* `compareValues(sortOrder, e1: ExtensionValues, e2): Ordering` (missing fields sort first).
* `sortForest(cls: EntityClass<V>, sorts: SortOrder[], forest: Forest<Entity<V>>)` and
  `sortTree(cls, sorts, tree)` (stable; one sort order per level; deeper levels unsorted).
* `mapTreeM(f, tree)`, `mapForestM(f, forest)`, `walkForestM(fs, forest)` are **direct style**
  (like `walkM` in Report.Walkable): `f: (a) => B` performs its effects when called, in pre-order.
  In a `ModelEdit` (Excel/Report): `mapForestM((i) => { goToEntity(ctx, i); return current(ctx); }, idForest)`,
  `walkForestM(groups.map((g) => (vs) => tabulateRow(ctx, g, vs)), forest1)`. Each `walkForestM`
  function (`(vs: readonly A[]) => B`; annotate the parameter `readonly`, not `A[]`) receives
  `[current, parent, grandparent, ...]`; the forest is truncated where the list
  of functions ends. There are no generator versions (no caller runs them in a Delta/script).

## Notes

* No async code, no toolkit changes.
* Tests round-trip every matrix in `src/dsm/share/examples/*.dsm`: the current-format ones
  (examples 1 and 2) reproduce the original JSON exactly; the old-format ones (examples 3 and 4:
  field names instead of IDs, sort as a list of names, no `"input"`) are written back migrated,
  exactly as the Haskell would (checked against an independent migration in the test), and are
  stable from then on. The test file also has a toy `HasMatrices` model with real query diagrams
  (`Children` steps) for `compileMatrix`/`runMatrix`/`sortForest`.
