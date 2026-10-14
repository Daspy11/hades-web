# gsn: GSN.Model

`src/dsm/gsn/GSN/Model.ts` (tests: `Model.test.ts` next to it, 114 tests). Every definition of
`dsm/gsn/GSN/Model.hs` is ported, exported or not. Demo: `src/scratch/gsnDemo.ts`
(`?demo=gsn`, `&file=1..4` picks the example model, `&page=<n>` the notebook page).

## Dictionaries and calling convention

* `HasGsn<V>` = `{ _Gsn: Prism<V, GsnItem<V>> }` (no superclass, as in Haskell).
* `GsnClass<V>` is the dictionary for the instance context
  `(AppearanceClass (GsnDiagramType v) v, Editable HadesRender v, EntityClass v,
  HasDiagrams HadesRender v, HasEvidence v, HasGsn v, HasLookups v, HasReports v)`
  (it includes `Queryable` through `HasReports`). `GsnBaseClass<V>` is
  `(EntityClass v, HasDiagrams HadesRender v, HasEvidence v, HasGsn v, Queryable v)`.
  DSM.SafetyCase's `SafetyModel` dictionary must satisfy `GsnClass<SafetyModel>`; its
  `getDiagramAppearance(pm)` is the `AppearanceClass (GsnDiagramType SafetyModel) SafetyModel`
  instance (`coerceDiagramAppearance(M.findWithDefault(mempty_DiagramAppearance, gsnDiagramVariant, pm))`).
* Dictionary first, then context, then Haskell arguments:
  `gsnIsDiagram(cls, item)`, `gsnDiagramWrapper(cls, ctx, ent)` (a `ModelEdit` at
  `W = GsnItem<V>`; from `getDiagramWrapper(ctx, e)` use
  `withSubtype(ctx, cls._Gsn, (c) => gsnDiagramWrapper(cls, c, e))`),
  `gsnActivation(cls, mEnt)` (returns the `ModelScriptAct`; SafetyCase:
  `promoteScript(_GsnItem, gsnActivation(cls, Just(e)))`; `gsnActivationScript(cls)` is the
  `ActivationScript` itself), `gsnEntityMenu(cls, ent, item)`, `gsnAddEntityMenu(cls, parent)`,
  `gsnToolbar(cls, diagId, parent)`, `gsnStockItem(cls, item)`, `gsnAvatarType(cls, prsm, v)`,
  `drawGsnBox(cls, d, box, contents, border)`, `gsnArrowCanConnect(cls, d, dir, arrow, box)`,
  `addNode(cls, ctx, parent, creator)`, `addEdge(cls, ctx, parent, typ)` (script generators).
* Constrained values/optics with no other argument take the dictionary as an optional unused
  argument: `_GsnDiagramItem<V>(cls?)`, `gsnItemName<V>(cls?)`, `gsnDiagramEntityTypes<V>(cls?)`.
  `_GsnNodeItem<V>()`, `_GsnEdgeItem<V>()` are zero-arg functions.
* `createGoal` ... `createGsnOption` are `ModelEdit`s: `(ctx: ModelEditCtx<V, W>) => GsnNode`.
  Note `insertEntity`/`modelNewName` always append a number, so a goal created under
  "Goal 1.2: X" is named "G1.2.1" (as in Haskell).

## Types

* `GsnDiagramType<V>` is the phantom interface App.GenericDiagram asks for:
  `{ BoxType: BoxType; ArrowType: ArrowType; ModelSubtype: ModelSubtype<V> }`;
  `GsnElement<V> = Element<GsnDiagramType<V>, V>`.
* `BoxType` = `"GoalBox" | "StrategyBox" | ... | "EvidenceBox"`, `boxTypeValues`, and constants
  `GoalBox`, ..., `EvidenceBox` (so Causality's `GSN.GoalBox` works). `show_BoxType`, `JSON_BoxType`.
* `ArrowType` = `GsnArrow(edgeType)` | `TraceArrow` (constant); `show_ArrowType` (variant names),
  `JSON_ArrowType`.
* `ModelSubtype<V>` = `GsnItem<V>` = `GsnNodeItem(n)` | `GsnEdgeItem(e)` | `GsnDiagramItem(d)` with
  `d: DiagramEntity<GsnElement<V>, DiagramAppearance<GsnDiagramType<V>, V>>`. The GADT's packed
  `HasDiagrams` dictionary is not stored. Instances: `eq_ModelSubtype`, `JSON_ModelSubtype(cls)`,
  `Reflective_ModelSubtype(cls)` (aliases `eq_GsnItem`, `JSON_GsnItem`, `Reflective_GsnItem`).
  The codec and the Reflective dictionary are cached per `cls` (WeakMap), and their diagram parts
  (`JSON_DiagramEntity`/`Reflective_DiagramEntity` over `Avatar_Element(DiagramTypeClass_GsnDiagramType(cls))`)
  are built on first use, so a model dictionary (SafetyModel) may call them from its own members
  while it is being built, as long as it does not *use* them during construction.
  `reflectiveDefaults` is a memoised getter. `eq_ModelSubtype` compares diagrams with `eq_DiagramEntity`.
* `GsnNode`: tagged union with record fields; constructors `Goal(name, text, developed,
  instantiated)`, `Strategy(...)` (same), `Solution/Context/Assumption/Justification/GsnOption(name,
  text, instantiated)`. `show_GsnNode`, `JSON_GsnNode`. Lenses `gsnNodeName`, `gsnNodeText`,
  `gsnInstantiated` and the Traversal `gsnDeveloped` are constants.
* `GsnEdgeType` = `"ContextArrow" | "SupportArrow"`, `gsnEdgeTypeValues`, constants, `show_GsnEdgeType`,
  `JSON_GsnEdgeType`. `GsnEdge(type, name, card)` = `{ gsnEdgeType, _gsnEdgeName, _gsnEdgeCard }`,
  function `gsnEdgeType(e)`, lenses `gsnEdgeName`, `gsnEdgeCard`, `show_GsnEdge`, `JSON_GsnEdge`.
* `GsnScript<V, A> = ModelScript<HadesRender, V, A>`; `GsnScriptAct<V, A>` is the first-class
  script at `W = GsnItem<V>` (menu values, activation).

## The DiagramTypeClass instance

* `DiagramTypeClass_GsnDiagramType(cls: GsnClass<V>): GsnDiagramTypeClass<V>` — the
  `GenericDiagramClass<GsnDiagramType<V>, V>` dictionary for App.GenericDiagram. It is
  `Object.create(cls)` plus the class methods (`mkBox`, `boxTypeDraw`, ..., `boxTypeJ`,
  `arrowTypeJ`), so it *is* also the model dictionary (getters stay lazy); cached per `cls`, so
  `Avatar_Element(DiagramTypeClass_GsnDiagramType(cls))` is always the same object (needed by
  `startDelta`/`DiagramWrapper`). `gsnDiagramWrapper` uses exactly that element dictionary.
* `drawGsnBoxRaw(shapeCls, typ, mNode, contents, border, shape, box)` takes the `BoxShapeClass`
  of the shape first (from a GenericDiagram box: `drawGsnBoxRaw(b.boxShapeClass, GoalBox, ...,
  b.boxShape, bb)` — Causality/Risk use it this way) and returns a `HadesRender`.

## Faithfully kept oddities

* `gsnBoxDecoration`: (instantiated, undeveloped) draws the triangle and (uninstantiated,
  developed) the diamond, i.e. the reverse of the GSN Community Standard (undeveloped = diamond,
  uninstantiated = triangle); both = diamond split by a line. Kept as in Haskell (visible in the
  demo's "GSN Notation" page).
* The "GSN Items" submenu labels the edges with the derived `Show` ("ContextArrow",
  "SupportArrow"), and `addEdge` names them after it ("ContextArrow1").
* `gsnDiagramEntityTypes` omits Option nodes; node names are not stripped by `reflectiveSet`
  (edge and diagram names are).

## Tests and demo

* All GSN entities (nodes, edges, diagrams with boxes, arrows, comments with images, links) of
  the four example files round-trip exactly through `JSON_GsnItem`, and whole models load.
  The test file has a SafetyModel-like toy dictionary (GSN + packages + evidence + traces +
  raw "Other" entities) that loads the example files; reuse it for DSM.SafetyCase tests. It is
  typed as `ClsT` (the constraint set spelt out) and cast to `GsnClass<TV>`, so that it keeps its
  types even if `GsnClass` degrades to `any` (as it did while `Model.Report.Base` was missing).
* The demo's last page, "GSN Notation", shows every element (goal, strategy, solution, context,
  assumption, justification, option, evidence), context/support arrows with each cardinality, a
  trace, and the decorations (laid out so that no arrow crosses a box). Toolbar tools and the
  connection rules were exercised in the browser (box tool + drag adds "G7"; a support arrow from a
  goal does not connect its head to a justification; goal → goal connects both ends).
* The demo drives the real GenericDiagram editor (`makeDrawingGtk` with `Avatar_Element`) inside
  `ModelScript`s on the `_GsnItem` subtype, answering script instructions like a user pressing OK.

## Toolkit

* No toolkit changes. (The `emblem-symbolic-link` icon of GenericDiagram's "Link" tool is the
  pale modern Adwaita one and is barely visible on the toolbar; not a GSN issue.)
