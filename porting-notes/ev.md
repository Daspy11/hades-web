# ev: Evidence.Model and App.Appearance

Files: `src/hades/evidence/Evidence/Model.ts` (+ `Model.test.ts`), `src/hades/src/App/Appearance.ts`
(+ `Appearance.test.ts`), demo `src/scratch/evDemo.ts` (`?demo=ev`; `&dialog=diagram|package`
opens a dialog at start-up).

## Evidence.Model

* `HasEvidence<V, PM = any>` extends `EntityClass<V, PM>` with members `_Evidence: Prism<V, Evidence>`
  and `_Trace: Prism<V, Trace>`.
* `Evidence`/`Trace` are records `{ _evidenceName: Name }` / `{ _traceName: Name }` built with
  `Evidence(name)` / `Trace(name)`; instances `JSON_Evidence`, `Reflective_Evidence`,
  `show_Evidence`, `JSON_Trace`, `Reflective_Trace`, `show_Trace`; isos `evidenceName`, `traceName`
  are constants. `evidenceVariant`, `traceVariant`, `traceTailRelation`, `traceHeadRelation`,
  `traceArrowDash`, `traceArrowHead`, `evidenceIconName`, `traceIconName` are constants.
* Menus/activations take no dictionary (the script context carries it, like
  `cloneEntityMenuItem`): `evidenceEntityMenu(ent)`, `traceEntityMenu(modelId)`,
  `evidenceActivation(mEnt)`, `traceActivation(mEnt)` (both `ActivationScript`s, i.e. return a
  `ModelScriptAct`). `addEvidenceEntityMenu(cls: HasEvidence<V>, parent)` needs the prisms.
  In DSM.SafetyCase: `promoteScript(_EvidenceItem, …)` over `fmap_Menu` of these.
* `drawEvidence(cls: EntityClass<V>, mEnt, contents: HadesLayout, border: Maybe<Colour>, box)`
  returns a `HadesRender`.
* `evidenceIconPixbuf()` is a function (the Haskell `unsafePerformIO` constant): memoised, but
  recomputed if `setDataIconTheme` installed a different theme since. The icon is found when the
  data icon theme is set up as DSM `Main` does (`iconThemeSetCustomTheme(t, "Diametric")`,
  `iconThemeSetSearchPath(t, [getDataDir("dsm")])`).

## App.Appearance

* `AppearanceClass<T, V, PM = any>` extends `EntityClass<V, PM>`: `getDiagramAppearance(pm: PM)`.
  Instances (DSM.SafetyCase) are `AppearanceClass_<DiagramType>_<Model>` dictionaries.
* `FieldStyle` string enum (`fieldStyleValues`, constants `FieldStyleNone|Outdent|Above`),
  `JSON_FieldStyle` ("None"/"Outdent"/"Above").
* `EntityShowField(style, fid)` record (`_entityShowFieldStyle`, `_entityShowFieldId`), lenses
  `entityShowFieldStyle`, `entityShowFieldId` (constants), `JSON_EntityShowField` (reads the old
  `"name"` key via `migrateField`).
* `EntityShowFields<A>` = `{ _fieldsShown: readonly FieldsShownRow<A>[] }` where
  `FieldsShownRow<A> = readonly [Variant<A>, readonly EntityShowField[]]`; build with
  `EntityShowFields(rows)`. `append_EntityShowFields` (left-biased, result sorted by variant),
  `mempty_EntityShowFields`, `JSON_EntityShowFields` (list of pairs; also reads the old object
  format), iso `fieldsShown<A, B>()`. Module-local helpers exported for tests: `fieldsShownMap`,
  `showFieldsClean`.
* `DiagramAppearance<T, V>` = `{ _arrowLabels: Maybe<boolean>, _entityShowFields, _highlights:
  readonly (readonly [QueryId, Colour])[] }`; constructor `DiagramAppearance(labels, fields,
  highlights)`; `append_DiagramAppearance`, `mempty_DiagramAppearance`,
  `mconcat_DiagramAppearance(list)` (for GenericDiagram's `mconcat` cascade),
  `show_DiagramAppearance` (derived Show; also `show_EntityShowField`, `show_EntityShowFields`),
  `JSON_DiagramAppearance` (keys `arrowNames`, `fields`, `highlights`; round-trips every
  appearance in the example `.dsm` files). Lenses are zero-arg generics: `arrowLabels()`,
  `entityShowFields()` (type-changing), `highlights()`. `cloneDiagramAppearance(f, da)`,
  `coerceDiagramAppearance(da)`, `diagramAppearanceClean(da)`.
* `PackageAppearance<A>` = `M.Map<Variant<A>, DiagramAppearance<null, A>>`;
  `JSON_PackageAppearance` (object keyed by variant; this is the DSM `modelMeta`/package meta
  format), `clonePackageAppearance(f, pa)`, `packageAppearanceClean(pa)`.
* Dialogs take the `(EntityClass v, HasDiagrams p v, Queryable v)` dictionary
  `AppearanceDialogClass<P, V> = HasDiagrams<P, V> & Queryable<V>` first:
  `diagramAppearanceDialog(cls, var_)`, `diagramAppearanceGadget(cls, var_)`,
  `packageAppearanceDialog(cls)`, `packageAppearanceGadget(cls)` (`Dialog_`/`GadgetF_` over
  `Model<V>`). Also exported (local in Haskell): `highlightTable(cls)`, `entityShowTable(cls,
  variants)`, `highlightIso`, `styleName`, `uniqueVariants(cls, rows)`.
* `diagramLayout(ctx: ModelEditCtx<V, W>, style: EntityShowFields<V>): HadesLayout<void>` (a
  `ModelEdit`; GenericDiagram's `liftBase $ lift $ do goToEntity …; diagramLayout contentDef` is
  `goToEntity(d.base, id); diagramLayout(d.base, contentDef)`). Icons come from
  `env.style.dataIcons` when the layout runs; they draw once loaded (repaint on
  `Gdk.onImagesLoaded`).
* Pango helpers exported for tests: `colourText(mColour, s, e)`, `colourForFont(c)`,
  `labelledFieldAttributes(label, value, mColour)`.

### Faithfully kept quirks of the original

* Outdented labels: the Haskell computes the Pango indices (UTF-8 **byte** offsets) from
  `T.length` (characters). The port does the same (code points, via `T.length`), so a label or
  value with non-ASCII characters gets its bold/colour spans cut short exactly as in the GTK
  program (e.g. "Größe: Groß" renders "Größ" bold). Tested. To fix it, use the UTF-8 byte
  lengths in `labelledFieldAttributes`.
* The background colour attribute has no indices, so it covers the label as well as the value.
* `layoutSetIndent(-20)` is in Pango units (≈0.02 px), i.e. no visible hanging indent.

## Toolkit change

* `src/lib/GI/Gtk/Render.tsx` (ComboBox) and `RenderTree.tsx` (cell combo editor): a combo with
  no active item passes `value=""` instead of `undefined` to Radix `Select.Root`, so it stays a
  controlled component (fixes the React "Select is changing from uncontrolled to controlled"
  warning when an item is first chosen, e.g. "Select Entity Type" in the appearance dialog).
