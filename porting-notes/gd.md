# gd: App.GenericDiagram

`src/hades/src/App/GenericDiagram.ts` (tests: `GenericDiagram.test.ts` next to it, 310 tests).
Every definition of `hades/src/App/GenericDiagram.hs` is ported, exported or not. Demo:
`src/scratch/gdDemo.ts` (`?demo=gd`): goal boxes, note ellipses, support arrows (model edges),
comments with an SVG and a PNG image, a link to another diagram, a query highlight; toolbar tools
for goals, notes, arrows, comments and links. `window.gd` exposes the state for automated checks
(`items()`, `selection()`, `edges()`, `pegs()`, `stored()`, `names()`, `log()`).

## The diagram type and its dictionaries

* The diagram type `t` is a phantom type parameter `T` that is never instantiated. Its data
  families are named by members of `T`:
  `interface MyDiagramType { readonly BoxType: MyBoxType; readonly ArrowType: MyArrowType;
  readonly ModelSubtype: MySubtype }`. `BoxType<T>`, `ArrowType<T>`, `ModelSubtype<T>` extract them.
  Elements are `Element<T, V>`.
* `DiagramTypeClass<T, V>` extends `HasDiagrams<HadesRender, V>`; the JSON superclasses are the
  members `boxTypeJ` and `arrowTypeJ` (codecs); `Eq` is structural `equals`. Spread
  `diagramTypeClassDefaults<T, V>()` for `arrowDecorations`. Delta methods take the `DeltaCtx`
  first: `*boxTypeDraw(d, box, contents, border)` (returns `(bb) => HadesRender`), `*boxChildren(d, box)`,
  `*boxChildConnection(d, box, child)`, `*boxCanPeg(d, box, arrow)`,
  `*arrowCanConnect(d, dir, arrow, box, child)`. Pure: `mkBox(diagId, modelId, typ, peg, bound)`,
  `avatarType(prsm, v)`, `diagramTypeName(t)` (called with `undefined`), the relation functions,
  `arrowHeadDraw(mSub, typ)`, `arrowLineDashes(typ)`.
* `GenericDiagramClass<T, V>` = the instance constraint set `(AppearanceClass t v, DiagramTypeClass t v,
  Editable HadesRender v, EntityClass v, HasDiagrams HadesRender v, HasLookups v, Queryable v,
  HasReports v)`; `LinkableClass<V>` = `(EntityClass v, HasDiagrams HadesRender v, HasLookups v,
  HasReports v)`. Functions take the dictionary first, then the context, then the Haskell arguments.
* **`Avatar_Element(cls)`** is the one dictionary for the `Viewable`, `Connectable` and
  `Avatar HadesRender v (ModelSubtype t) (Element t v)` instances (aliases `Viewable_Element`,
  `Connectable_Element`), with the `DiagramMetadataClass` members for
  `DiagramMetadata (Element t v) = DiagramAppearance t v`, so it can be passed to
  `JSON_DiagramEntity(ecls, JSON_Element(cls))`, `Reflective_DiagramEntity`, `DiagramWrapper`,
  `startDelta`, `makeDrawingGtk`. Cached per `cls` (WeakMap): always the same object.
  Inside a Delta, `d.base` is the `ModelEditCtx<V, ModelSubtype<T>>` of the running script.

## Data

* `GenericContext(diagramId, appearanceDef)` is `ViewContext (Element t v)`; lens
  `diagramAppearanceDef<T, V>()`. A wrapper builds it as
  `compileAppearance(cls, ctx, diagramEntity._diagramEntityData, GenericContext(entityId, mempty_AppearanceDef))`
  (a `ModelEdit`; `updateViewContext` of the dictionary calls it).
* `AppearanceDef(arrowLabels, entityShowFields, borderColour)`, `append_AppearanceDef`,
  `mempty_AppearanceDef`.
* `Box<T, V>`: the existential shape carries its `BoxShapeClass` dictionary as the extra field
  `boxShapeClass`, the **first** argument of the constructor:
  `Box(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound))`. Shape methods go
  through it (`b.boxShapeClass.shapeInnerBox(b.boxShape)`). Always build boxes with `Box(...)`: it
  attaches the hand-written `Eq` (compares shape definitions only) as `[EqSym]` (kept by spreads).
  `eq_Box`, `HasId_Box`, `JSON_Box(cls)` (reads `"shape"` as a `BoundBox` through `cls.mkBox`),
  lens `boxPeg<T, V>()`.
* `Arrow(arrowId, entity, type, shape)`, lens `arrowShape<T, V>()`, `eq_Arrow`, `JSON_Arrow(cls)`.
* `Comment(id, CommentBox, Maybe<Graphic>, text)`, constant lenses `commentShape`, `commentText`,
  `commentGraphic`; `def_Comment`, `JSON_Comment`. `Link(id, Maybe<target>, CommentBox, text)`,
  constant lenses `linkTarget`, `linkShape`, `linkText`; `def_Link`, `show_Link`, `JSON_Link`.
* `Graphic` = `VectorGraphic(svgText, SVG.Handle)` | `PixelGraphic(bytes, Gdk.Pixbuf)` |
  `ErrorGraphic(rawJsonObject, message)`; build with the constructors (they carry the Haskell
  `Eq`, which compares the stored data only). `JSON_Graphic`, `eq_Graphic`, `layoutGraphic(g)`,
  `decodedGraphic(g)` (web-only, see below). Helpers `base64Encode`, `base64DecodeLenient`
  (base64-bytestring compatible, including its handling of `=` and invalid characters).
* `Element<T, V>` = `ElemBox | ElemArrow | ElemComment | ElemLink` (constructor functions of the
  same names); prisms `_ElemBox<T, V>()`, `_ElemArrow()`, `_ElemComment()`, `_ElemLink()`;
  `HasId_Element`, `eq_Element`, `JSON_Element(cls)` (round-trips every GSN/Bow Tie element in the
  example `.dsm` files exactly).
* `AvatarCreation`: `NoAvatar` (constant), `SimpleBox(typ)`, `SimpleArrow(typ)`,
  `AvatarScript((d, entity, pt) => Delta<Element, Maybe<Element>>)`.

## Functions

* `edgeLinks(cls, ctx, arrowType, modelId)` (a `ModelEdit` at `W = ModelSubtype<T>`; in a Delta pass
  `d.base`), `isLinkable(cls, entity)`, `elementMapAvatars(f, element)` (for `diagramMapAvatars`).
* `elementDialog<T, V>(cls)` → `DialogSelector_<Model<V>, null, Element<T, V>>` (the wrapper's
  `diagramDialog`); `linkDialog(cls)`; gadgets `commentGadget()`, `commentGadget1()`.
* Tools (Delta generators that return the tool's `Action`; wrap with `mkScriptAction`):
  `newBoxEntityTool(cls, d, parent, prototype, boxType)`,
  `newArrowEntityTool(cls, d, arrowsInSubPackage, parent, prototype, arrowType)`.
  Plain actions: `newCommentTool<T, V>()`, `newLinkTool<T, V>(cls)`.
  Toolbar example: `DeltaTool("basic_comment", "Comment", DeltaToolAction(newCommentTool<T, V>()))`.
* Exported although internal in Haskell: `boxView`, `arrowView`, `importImageFile`,
  `HasId_*`, `eq_*`.

## Async / browser decisions (`// Web:`)

* SVG graphics are parsed synchronously (`@/lib/GI/Rsvg`), so a bad SVG becomes an
  `ErrorGraphic(..., "Error during image decoding.")` exactly as in Haskell. Pixel images decode
  asynchronously: `JSON_Graphic` returns a `PixelGraphic` at once (until loaded it takes no
  space). Once the browser has failed to decode it, `decodedGraphic(g)` gives the
  `ErrorGraphic(rawJson, "Error during image decoding.")` the Haskell parser returns, and equality,
  JSON output (the raw JSON object, unchanged), layout and the comment dialog's image display all go
  through it. Canvases repaint on `Gdk.onImagesLoaded`, so images (and the error) appear once the
  decoding has finished.
* `importImageFile()` (the "Import Image" `buttonIO`) is async (`openUserFile`), and waits for the
  pixbuf to decode so that undecodable files get the Haskell error box.

## Notes for Model.GI.ModelDiagrams (and other interpreters of diagram scripts)

* As in Haskell (`processModelUpdates` keeps only updates whose value is `Just`), the model state
  returned by a diagram action must be committed **only when the action has a checkpoint**. The
  generic diagram relies on it: `boxDrag` is called with the box as it was at the start of the drag
  for every drag step and pegs the box (adding a model relation) to every arrow it snaps to on the
  way; only the final step's edits (with the checkpoint) are kept. The demo interpreter does this.

## Faithful quirks

* SVG import goes through `tryDecodeXml`, so an SVG file without an `<?xml ...?>` declaration is
  rejected with "SVG file contents could not be decoded. … Not an XML file." (as the original).
* `boxAdjust` on a box whose shape is `NoBox`: Haskell stores a lazily failing shape; the port
  leaves the box alone (commented).
* After any model change, `updateArrow` re-optimises the ends of straight arrows, so hand-placed
  connection points move to the box outlines nearest the other end (as in the GTK program).

## Toolkit

* No toolkit changes.
