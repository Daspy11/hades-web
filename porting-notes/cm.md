# cm: Causality.Model

`src/dsm/causality/Causality/Model.ts` (tests: `Model.test.ts` next to it, 58 tests). Every
definition of `dsm/causality/Causality/Model.hs` is ported, exported or not. Demo:
`src/scratch/cmDemo.ts` (`?demo=cm`, `&file=1..4` picks the example model the causal package is
added to (default 3), `&page=<n>` the notebook page). `window.cm` exposes the editor state
(`pages()`, `items(n)`, `children(name)`, `entityNames()`, `log()`).

## The example models have no causal entities

None of `src/dsm/share/examples/*.dsm` contains a causal entity (no `State`, `CausalComponent`,
`... EventEvent`, `Causal Net Diagram`, ...): causal models had been removed from the DSM before
they were written (DSM.SafetyCase only keeps `ignoreCausalJson`, which turns causal JSON into an
empty "(not supported)" package). Their "Hazard", "Control", "RiskEvent", "ThreatLine" and
"Bow Tie Diagram" entities belong to `Causality.Risk` (bow ties). So the tests check instead that
(a) no entity of any example parses as `Causal` (important for SafetyCase's `ignoreCausalJson`,
which comes second in its parser chain), (b) every example loads with a causal-aware model type
and writes its entities back unchanged, and (c) a synthetic causal model (components, instances
with the component relation, every entity kind, a diagram with instance/event boxes and an arrow to
an instance export) round-trips exactly through `JSON_Model`. The demo adds such a model to an
example model, saves and reloads the whole model, then edits the causal diagrams.

## Dictionaries and calling convention

* `HasCausal<V>` = `{ _Causal: Prism<V, Causal<V>> }`.
* `CausalClass<V>` = the instance context `(AppearanceClass (CausalType v) v, Editable HadesRender v,
  EntityClass v, HasDiagrams HadesRender v, HasCausal v, HasEvidence v, GSN.HasGsn v, HasLookups v,
  HasReports v)`; `CausalBaseClass<V>` = `(EntityClass v, HasCausal v, HasDiagrams HadesRender v,
  HasEvidence v, GSN.HasGsn v, Queryable v)` (menus, activation).
* **`AppearanceClass` is per diagram type**: a model dictionary has one `getDiagramAppearance`
  member, so a SafetyModel-like dictionary that serves both GSN and causal diagrams needs one object
  per diagram type. The tests/demo use `gsnCls = Object.assign(Object.create(cls), {
  getDiagramAppearance: <GSN version> })` for the GSN codecs/wrapper and `cls` (causal version)
  for the causal ones. (Same issue for SafetyCase with GSN + bow ties.)
* Dictionary first, then context, then Haskell arguments: `causalDiagramWrapper(cls, ctx, ent)`
  (ModelEdit at `W = Causal<V>`; from `getDiagramWrapper(ctx, e)` use
  `withSubtype(ctx, cls._Causal, (c) => causalDiagramWrapper(cls, c, e))`),
  `causalAvatarType(cls, prsm, v)`, `createInstance(cls, d, ent, pt)`,
  `createBoxAvatar(cls, d, boxType, ent, pt)`, `createArrowAvatar(cls, d, arrowType, ent, pt)`,
  `drawCausalBox(cls, d, box, contents, border)`, `causalBoxChildren(cls, d, box)`,
  `causalBoxChildConnection(cls, d, box, childId)`,
  `causalArrowCanConnect(cls, d, dir, arrow, box, mChild)`, `causalEntityMenu(cls, ent, c)`,
  `causalToolbar(cls, diagId, owner)`, `addCausalEntityMenu(cls, parent)`,
  `causalActivation(cls, mEnt)` (returns the `ModelScriptAct`; `causalActivationScript(cls)` is the
  `ActivationScript`), `fixOldComponents(cls, ctx)` (ModelEdit at `W = Causal<V>`),
  `componentCanHaveChild(cls: HasEvidence<V>, prsm, v)`.
* EntityClass-only ModelEdits use the context's dictionary: `instanceExports(ctx, modelId)`
  (ctx at `W = Causal<V>`); `isSibling(d, entity)` uses the Delta's.
* Drawing: `drawCausalStateBox(shapeCls, cls, mEnt, contents, border, shape, box)`,
  `drawCausalEventBox(...)` (same), `drawCausalLogicBox(shapeCls, cls, mEnt, border, shape, box)`,
  `drawCausalInstanceBox(shapeCls, cls, exports, mEnt, border, shape, box)`; `shapeCls` is the
  `BoxShapeClass` of the shape (`box.boxShapeClass`), all return a `HadesRender`.
* Pure: `causalIsDiagram(c)`, `causalExported(c)`, `causalCanMove(c)`, `causalIcon(c)`, `symbol(c)`,
  `logicIsState/logicIsEvent/logicTypeName(t)`, `edgeTypeName(e)`, `eventTypeName/eventTypeJson(t)`.
  `causalDiagramEntityTypes` and `eventVariants` are constants (`Variant` is a string).

## Types

* `CausalType<V>` is the phantom interface for App.GenericDiagram (`BoxType`, `ArrowType`,
  `ModelSubtype<V>` members); the unused Haskell unit constructor has no value. `CausalNet<V>` =
  `Element<CausalType<V>, V>`; `ComponentDiagram<V>` = `DiagramEntity<CausalNet<V>,
  DiagramAppearance<CausalType<V>, V>>`; `Causal<V>` = `ModelSubtype<V>`.
* `BoxType` (`"StateBox" | "EventBox" | "LogicBox" | "InstanceBox" | "HazardBox" | "GoalBox" |
  "EvidenceBox"`, `boxTypeValues`, a constant per constructor) and `ArrowType` (`"TemporalArrow" |
  "TriggerArrow" | "GuardArrow" | "HazardArrow" | "TraceArrow"`, `arrowTypeValues`). Their JSON is the
  constructor name (`show`); parsing goes through `read_BoxType`/`read_ArrowType` (`readMaybe`:
  white space and parentheses tolerated). Note `GoalBox`/`EvidenceBox`/`TraceArrow` clash with the
  GSN module's names: import one of the modules qualified (`import * as GSN`).
* `ModelSubtype<V>`: `CausalEvent(Event)`, `CausalState(State)`, `CausalLogic(Logic)`,
  `CausalInstance(Instance)`, `CausalEdge(Edge)`, `CausalComponent(ComponentModel)`,
  `CausalDiagram(ComponentDiagram)` (constructor functions `<V = any>`). Prisms are zero-arg
  functions `_CausalEvent<V>()` ... `_CausalDiagram<V>()`; `causalName<V>()` is the name lens.
* Records: `Event(eventType, name, text, hidden)` (`eventType` field + function `eventType(e)`,
  lenses `eventName`, `eventText`, `eventHidden`), `State(name, text, hidden)` (`stateName`,
  `stateText`, `stateHidden`), `Logic(logicType, name, hidden)` (`logicType(l)`, `logicName`,
  `logicHidden`, Traversal `logicCount`), `Instance(name)` = `{ _instanceName }` (`instanceName`),
  `ComponentModel(name)` = `{ _componentName }` (iso `componentName<V>()`).
  `LogicType` = `LogicCountState(n)` | constants `LogicAndState`, `LogicAndEvent`, `LogicOrEvent`
  (`show_LogicType`, `read_LogicType`). `Edge` = `TemporalEdge(name)` | `TriggerEdge(name)` |
  `GuardEdge(name, inhibit)` (lens `edgeName`, Traversal `edgeInhibit`). `EventType` string enum
  (`eventTypeValues`, constants, `show_EventType` = the Haskell custom Show = `eventTypeName`).
* Instances: `JSON_EventType` (`"Simple EventEvent"`, as the original), `JSON_Event`, `JSON_State`,
  `JSON_Logic`, `JSON_Instance`, `JSON_Edge`, `JSON_ComponentModel`, `JSON_BoxType`,
  `JSON_ArrowType`, `JSON_ModelSubtype(cls)`, `Reflective_ModelSubtype(cls: EntityClass<V>)`,
  `eq_ModelSubtype` (aliases `JSON_Causal`, `Reflective_Causal`, `eq_Causal`). The codec and the
  Reflective are cached per `cls` and build their diagram parts lazily (a model dictionary may
  reference them while being built, as long as it does not use them during construction).
  A causal diagram's JSON `"type"` is `"Causal Net Diagram"` (from `diagramTypeName`), while its
  reflective variant is `"Causal Diagram"` (`causalDiagramVariant`) — as in Haskell.
* `DiagramTypeClass_CausalType(cls)` = `Object.create(cls)` + the class methods, cached per `cls`
  (so `Avatar_Element(DiagramTypeClass_CausalType(cls))` is stable, as `startDelta`/`DiagramWrapper`
  need). `CausalDiagramTypeClass<V>` = `CausalClass<V> & GenericDiagramClass<CausalType<V>, V>`.
* `childBoxes(box)` is an infinite generator (Haskell infinite list); take with `.next()`.
* `CausalScriptAct<V, A>` = `ModelScriptAct<HadesRender, V, Causal<V>, A>` (menus, activation).

## Faithfully kept oddities

* `drawCornerLetter` puts the "C"/"M" of control/mishap events at the bottom right of the
  parallelogram's *bounding box*, i.e. outside the slanted shape.
* A mishap event is always outlined in black (the highlight colour is ignored); a simple event
  ignores the highlight colour too.
* A state's `reflectiveGet` omits the hidden field although `reflectiveBuiltIn` lists it and
  `reflectiveSet` reads it. Event/state names are stripped by `reflectiveSet`.
* The legacy `HazardBox` draws a thick yellow "Please Delete" box.
* `fixOldComponents` ends with `checkModel`, which validates the *whole* model (names of all
  entities via `cls.name`, `entityCanHaveChild` for every parent/child pair): a toy dictionary must
  name every entity correctly (query diagrams keep their name in `contents.diagram.name`).

## Toolkit

* No toolkit changes.
