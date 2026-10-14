# cr: Causality.Risk (bow tie diagrams)

`src/dsm/causality/Causality/Risk.ts` (tests: `Risk.test.ts` next to it, 49 tests). Every
definition of `dsm/causality/Causality/Risk.hs` is ported, exported or not. Test/demo support (not
a Haskell port): `BowTieTestModel.ts` next to it — a SafetyModel-like dictionary (`cls`, `gsnCls`,
`TV`, `_BowTieItem`, `_GsnItem`, `_Ev`, `_Tr`, `tvName`, `readBowTieModel(json)`) that loads every
example `.dsm` (reports kept as raw JSON). Demo: `src/scratch/crDemo.ts` (`?demo=cr`, `&file=1..4`,
default 4; `&page=<n>`): every bow tie diagram of the model in a notebook, edited through
GenericDiagram with the bow tie toolbar; `window.cr` exposes the editor state.

## Dictionaries and calling convention

* `HasBowTie<V>` = `{ _BowTie: Prism<V, BowTie<V>> }`.
* `BowTieClass<V>` = the instance context `(AppearanceClass (BowTieType v) v, Editable HadesRender v,
  EntityClass v, HasBowTie v, HasDiagrams HadesRender v, HasEvidence v, GSN.HasGsn v, HasLookups v,
  HasReports v)`. `BowTieBaseClass<V>` = `(EntityClass v, HasBowTie v, HasDiagrams HadesRender v,
  HasEvidence v, GSN.HasGsn v, Queryable v)` (menus, activation).
* **`AppearanceClass` is per diagram type** (as noted in cm.md): SafetyCase needs one dictionary
  object per diagram type, e.g. `gsnCls = Object.assign(Object.create(cls), { getDiagramAppearance:
  <GSN version> })`; the bow tie functions take the one whose `getDiagramAppearance` returns the
  bow tie appearance (`coerceDiagramAppearance(M.findWithDefault(mempty_DiagramAppearance,
  bowTieDiagramVariant, pm))`). See `BowTieTestModel.ts`.
* `DiagramTypeClass_BowTieType(cls)` = `Object.create(cls)` + the class methods, cached per `cls`
  (so `Avatar_Element(DiagramTypeClass_BowTieType(cls))` is stable). Type `BowTieDiagramTypeClass<V>`
  = `BowTieClass<V> & GenericDiagramClass<BowTieType<V>, V>`.
* Dictionary first, then context, then Haskell arguments:
  `riskDiagramWrapper(cls, ctx, ent)` (ModelEdit at `W = BowTie<V>`; from `getDiagramWrapper(ctx, e)`
  use `withSubtype(ctx, cls._BowTie, (c) => riskDiagramWrapper(cls, c, e))`),
  `drawBowTieBox(cls, d, box, contents, border)`, `bowTieArrowCanConnect(cls, d, dir, arrow, box, mChild)`,
  `bowTieToolbar(cls, diagId, parent)`, `bowTieEntityMenu(cls, ent, b)`,
  `bowTieAddEntityMenu(cls, parent)`, `bowTieActivation(cls, mEnt)` (returns the `ModelScriptAct`;
  `bowTieActivationScript(cls)` is the `ActivationScript`; SafetyCase:
  `promoteScript(_BowTieItem, bowTieActivation(cls, Just(e)))`).
* Drawing: `drawBowTieControlBox(shapeCls, cls, mEnt, contents, border, shape, box)`, same for
  `drawBowTieRiskEventBox`, `drawBowTieHazardBox`; `shapeCls` = `box.boxShapeClass`; return `HadesRender`.
* Pure: `riskIsDiagram(b)`, `bowTieIcon(b)`; `riskDiagramEntityTypes` is a constant.

## Types and instances

* `BowTieType<V>` phantom interface (`BoxType`, `ArrowType`, `ModelSubtype<V>` members).
  `ElemBowTie<V>` = `Element<BowTieType<V>, V>`; `BowTieDiagram<V>` = `DiagramEntity<ElemBowTie<V>,
  DiagramAppearance<BowTieType<V>, V>>`; `BowTie<V>` = `ModelSubtype<V>`.
* `BoxType` string enum (`EventBox | StateBox | RiskEventBox | ControlBox | HazardBox | GoalBox |
  EvidenceBox`, `boxTypeValues`, a constant per constructor); `ArrowType` (`RiskArrow | HazardArrow |
  TraceArrow`, `arrowTypeValues`). JSON = the constructor name; `show_/read_BoxType`,
  `show_/read_ArrowType` (`readMaybe`-like). **Name clashes** with Causality.Model and GSN.Model
  (`EventBox`, `StateBox`, `HazardBox`, `GoalBox`, `EvidenceBox`, `HazardArrow`, `TraceArrow`,
  `BoxType`, `ArrowType`, `ModelSubtype`, `JSON_ModelSubtype`, ...): import qualified
  (`import * as Risk from "@/dsm/causality/Causality/Risk"`).
* `ModelSubtype<V>`: `BowTieHazard(h)`, `BowTieRiskEvent(r)`, `BowTieControl(c)`, `BowTieIsHazard(i)`,
  `BowTieThreat(t)`, `BowTieDiagram(d)` (constructor functions `<V = any>`, field `_0`). Prisms are
  zero-arg functions `_BowTieHazard<V>()` ... `_BowTieDiagram<V>()`; `bowTieName<V>()` is the name lens.
* Records: `RiskEvent(name, text)` (`_riskEventName`, `_riskEventText`; lenses `riskEventName`,
  `riskEventText`), `Control(name, text)` (`controlName`, `controlText`), `Hazard(name, text)`
  (`hazardName`, `hazardText`), `ThreatLine(name)` = `{ _threatLineName }` (iso `threatLineName`),
  `IsHazard(name)` = `{ _isHazardName }` (iso `isHazardName`). Optics on these are constants.
* Codecs: `JSON_RiskEvent`, `JSON_Control`, `JSON_Hazard`, `JSON_ThreatLine` (also reads the old
  `"RiskLine"` type), `JSON_IsHazard`, `JSON_BoxType`, `JSON_ArrowType`, `JSON_ModelSubtype(cls)`
  (cached per `cls`, diagram codec built lazily on first use). `eq_ModelSubtype` (diagrams via
  `eq_DiagramEntity`). `Reflective_ModelSubtype(_cls?)`: the Haskell instance has no context, so it
  is one shared dictionary (argument ignored); `reflectiveDefaults` is a memoised getter;
  `variantUserLabel` shows `bowTieRiskEventVariant` as "Event". Aliases `eq_BowTie`, `JSON_BowTie`,
  `Reflective_BowTie`.
* `BowTieScriptAct<V, A>` = `ModelScriptAct<HadesRender, V, BowTie<V>, A>`.

## Tests

* All bow tie entities of the four example files round-trip through `JSON_BowTie` (counts per
  variant checked; non-bow-tie entities are rejected); whole models load and are written back.
  Example 4's old bow tie appearances (`{style, name}`) are written back migrated (`{style, field:
  uuid5(nil, name)}`), as the Haskell `JSON_EntityShowField` does, checked against an independent
  migration; stable after that. Also: Reflective, optics, DiagramTypeClass methods, connection
  rules, drawing (SVG), menus, activation, wrapper and toolbar.
* Speed mode: no exhaustive tests were added in this round; the existing suite passes and the demo
  renders example 4's six bow ties correctly in Chrome.

## Toolkit

* No toolkit or `src/lib` changes.
