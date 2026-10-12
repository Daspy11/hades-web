/**
 * Scratch demo for `App.GenericDiagram` (open with `?demo=gd`).
 *
 * A generic box-and-arrow diagram over a small model: goal boxes (rectangles) and note boxes
 * (ellipses) that are avatars of model entities, support arrows that are avatars of edge
 * entities, a comment with an SVG image, a comment with a pixel (PNG) image, and a link to
 * another diagram. The diagram's appearance shows arrow labels and the goals' descriptions, and
 * highlights notes in blue through a query.
 *
 * Click to select, drag to move (drop a note on an arrow to peg it there; moving the arrow's
 * ends moves the note), drag an arrow end handle to connect it to another goal (the model edge
 * follows), right-click for menus, double-click for properties, Delete to delete. The toolbar
 * adds goals, notes, arrows (drag from goal to goal), comments and links.
 *
 * Diagram actions run in model scripts, interpreted here as `Model.GI.ModelDiagrams` does: the
 * diagram is written back into the model at each checkpoint, then updated from the model.
 * `window.gd` exposes the state for automated checks.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, fromMaybe, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { identity, lens, modifying, prism, set, view, type Prism } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { runDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { errorBox } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ErrorBox";
import {
  type Action, type BoundBox, type Diagram, type DiagramId, type Point,
  BoundBox as BB, BoxShapeClass_Ellipse, BoxShapeClass_Rectangle, CommentBox, Connected, DeltaTool,
  DeltaToolAction, DeltaToolbar, Ellipse, LineShape, Point as P, Rectangle, alignmentTools, deltaDiagram,
  deltaSelection, deltaZoom, diagramContents, diagramFromList, diagramModify, diagramToList, mkScriptAction,
  rectangleCorners, streamStateT, tellAll, tellCheckpoint, tellItem, yieldViews,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesActionResult, type HadesGtk, type HadesRender, closedArrowHead, drawEllipse, drawPolygon, hadesActionExecute, hadesConfig,
  hadesState, layoutParagraphGap, layoutTitle, makeBottomBar, makeDrawingGtk, makeGtkDeltaToolbar, runLayout_,
  withLineColour,
} from "@/hades/src/Hades/GI";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  Name, Package, currentName, descriptionField, emptyModel, goToEntity, mkEntity, mkPackage, modelStartState,
  modifyRelations, modifyValue, nameField, nameText, packageName, runModelEdit, show_ModelError, try_,
} from "@/hades/src/Model/Abstract/PackageTree";
import { getReferenceValues, reflectiveDialog } from "@/hades/src/Model/Abstract/Properties";
import {
  type DiagramEntity, type ModelScriptAct, type UserScriptFunctor,
  DiagramEntity as mkDiagramEntity, DiagramWrapper, diagramEntityContents, diagramEntityName, keyCommands,
  stepScript, updateDiagram,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type QueryData, Avatar_QueryElement, FilterVariants, InDiagram, QElemArrow, QElemBox, QueryArrow, QueryBox,
  QueryDiagram, QueryInput, QueryOutput,
} from "@/hades/src/Model/Query/Diagram";
import {
  type DiagramAppearance, DiagramAppearance as mkDA, EntityShowField, EntityShowFields, FieldStyleNone,
  JSON_DiagramAppearance, append_DiagramAppearance, mempty_DiagramAppearance,
} from "@/hades/src/App/Appearance";
import {
  type Element, type GenericDiagramClass, type Graphic,
  Arrow, Avatar_Element, Box, Comment, ElemArrow, ElemBox, ElemComment, ElemLink, GenericContext, HasId_Element,
  JSON_Element, JSON_Graphic, Link, NoAvatar, SimpleArrow, SimpleBox, compileAppearance, diagramTypeClassDefaults,
  elementDialog, elementMapAvatars, mempty_AppearanceDef, newArrowEntityTool, newBoxEntityTool,
  newCommentTool, newLinkTool,
} from "@/hades/src/App/GenericDiagram";

// ---------------------------------------------------------------------------------------------
// The diagram type and the model.

interface Demo {
  readonly BoxType: "Goal" | "Note";
  readonly ArrowType: "Support";
  readonly ModelSubtype: TV;
}
type TE = Element<Demo, TV>;
type DA = DiagramAppearance<Demo, TV>;

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, DA> }
  | { readonly tag: "Goal"; readonly name: Name; readonly desc: string }
  | { readonly tag: "Note"; readonly name: Name; readonly desc: string }
  | { readonly tag: "Edge"; readonly name: Name }
  | { readonly tag: "Dgm"; readonly dgm: DiagramEntity<TE, DA> }
  | { readonly tag: "Query"; readonly qd: QueryDiagram<TV> };

const Goal = (n: string, desc = ""): TV => ({ tag: "Goal", name: Name(n), desc });
const Note = (n: string, desc = ""): TV => ({ tag: "Note", name: Name(n), desc });
const Edge = (n: string): TV => ({ tag: "Edge", name: Name(n) });
const Dgm = (n: string, items: readonly TE[], meta: DA = mempty_DiagramAppearance): TV =>
  ({ tag: "Dgm", dgm: mkDiagramEntity(Name(n), diagramFromList(HasId_Element, items), meta) });

const nameL = lens(
  (v: TV): Name => {
    switch (v.tag) {
      case "Pkg": return v.pkg._packageName;
      case "Dgm": return v.dgm._diagramEntityName;
      case "Query": return v.qd._queryDiagram._diagramEntityName;
      default: return v.name;
    }
  },
  (v: TV, n: Name): TV => {
    switch (v.tag) {
      case "Pkg": return { ...v, pkg: set(packageName(), n, v.pkg) };
      case "Dgm": return { ...v, dgm: set(diagramEntityName(), n, v.dgm) };
      case "Query": return v;
      default: return { ...v, name: n };
    }
  },
);

const _Pkg: Prism<TV, Package<TV, DA>> = prism(
  (p: Package<TV, DA>): TV => ({ tag: "Pkg", pkg: p }),
  (v: TV) => (v.tag === "Pkg" ? Right(v.pkg) : Left(v)),
);
const _Dgm: Prism<TV, DiagramEntity<TE, DA>> = prism(
  (d: DiagramEntity<TE, DA>): TV => ({ tag: "Dgm", dgm: d }),
  (v: TV) => (v.tag === "Dgm" ? Right(v.dgm) : Left(v)),
);
const _Query: Prism<TV, QueryDiagram<TV>> = prism(
  (qd: QueryDiagram<TV>): TV => ({ tag: "Query", qd }),
  (v: TV) => (v.tag === "Query" ? Right(v.qd) : Left(v)),
);
const never = <A>(): Prism<TV, A> => prism((_a: A): TV => { throw new Error("not used"); }, (v: TV) => Left(v));

let statusText: (s: string) => void = () => {};

/** Draw a goal (rectangle) or note (ellipse) with its name as the title and then its contents. */
const cls: GenericDiagramClass<Demo, TV> = {
  reflectiveName: (v) => Variant(v.tag === "Pkg" ? "Package" : v.tag === "Dgm" ? "Demo Diagram" : v.tag),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Goal(""), Note(""), Edge("")],
  reflectiveBuiltIn: (v) => (v.tag === "Goal" || v.tag === "Note" ? [nameField, descriptionField] : [nameField]),
  reflectiveGet: (v) => (v.tag === "Goal" || v.tag === "Note"
    ? M.fromList([[nameField, ExtText(v.name._0)], [descriptionField, ExtText(v.desc)]])
    : M.singleton(nameField, ExtText(view(nameL.dot(nameText), v)))),
  reflectiveSet: (st, v) => {
    const v2 = set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v);
    return v2.tag === "Goal" || v2.tag === "Note" ? { ...v2, desc: extract(st, v2.desc, _ExtText, descriptionField) } : v2;
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: nameL,
  _Package: _Pkg,
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(() => null, () => J.fail("not used")),
  packageMetaJ: JSON_DiagramAppearance,
  packageMetaMempty: mempty_DiagramAppearance,
  packageMetaAppend: (a, b) => append_DiagramAppearance(a, b),
  getDiagramAppearance: (pm: DA) => pm,
  isDiagram: (v) => v.tag === "Dgm" || v.tag === "Query",
  getDiagramWrapper: (ctx, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return Nothing;
    const vctx = compileAppearance(cls, ctx, v.dgm._diagramEntityData, GenericContext<Demo, TV>(e.entityId, mempty_AppearanceDef));
    return Just(DiagramWrapper(Avatar_Element(cls), e.entityId, v.dgm._diagramEntityContents, _Dgm, identity<TV>(),
      elementDialog<Demo, TV>(cls), vctx, Nothing, () => DeltaToolbar<TE>([], [])));
  },
  diagramEntityTypes: M.empty(),
  diagramMapAvatars: (f, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return e;
    const items = diagramToList(v.dgm._diagramEntityContents).map((x) => elementMapAvatars(f, x));
    return { ...e, _entityContents: Dgm(v.dgm._diagramEntityName._0, items, v.dgm._diagramEntityData) };
  },
  editableActivation: (e) => function* () {
    statusText("Activated " + (e.tag === "Just" ? view(nameL, e.value._entityContents)._0 : "root"));
    return Nothing;
  },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
  _LookupTable: never(),
  _QueryDiagram: _Query,
  queryAvatars: (v) => (v.tag === "Dgm"
    ? diagramToList(v.dgm._diagramEntityContents).flatMap((x) =>
      x.tag === "ElemBox" ? [x._0.boxEntity] : x.tag === "ElemArrow" ? [x._0.arrowEntity] : [])
    : []),
  _Matrix: never(),
  _Report: never(),
  ...diagramTypeClassDefaults<Demo, TV>(),
  boxTypeJ: J.enumJ("BoxType", ["Goal", "Note"] as const),
  arrowTypeJ: J.enumJ("ArrowType", ["Support"] as const),
  mkBox: (diagId, modelId, typ, peg, bound) => (typ === "Note"
    ? Box(BoxShapeClass_Ellipse, diagId, modelId, typ, peg, Ellipse(bound))
    : Box(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound))),
  *boxTypeDraw(d, b, contents, border) {
    // May be called with the null ModelId (rubber band of a new box).
    const nm = U.isNil(b.boxEntity) ? "" : try_(d.base as ModelEditCtx<TV, TV>, (c) => {
      goToEntity(c, b.boxEntity);
      return currentName(c);
    });
    const title = typeof nm === "string" ? nm : nm.tag === "Right" ? nm.value : "?";
    return (bb: BoundBox): HadesRender => (env) => {
      const outline: HadesRender = b.boxType === "Note" ? drawEllipse(Ellipse(bb)) : drawPolygon(rectangleCorners(Rectangle(bb)));
      (border.tag === "Just" ? withLineColour(border.value, outline) : outline)(env);
      const inner = b.boxType === "Note" ? BoxShapeClass_Ellipse.shapeInnerBox(Ellipse(bb)) : BoxShapeClass_Rectangle.shapeInnerBox(Rectangle(bb));
      runLayout_(inner, (e1, st) => {
        layoutTitle(Nothing, title)(e1, st);
        layoutParagraphGap(e1, st);
        contents(e1, st);
      })(env);
    };
  },
  *boxChildren() {
    return [];
  },
  *boxChildConnection() {
    return (p: Point) => p;
  },
  *boxCanPeg(_d, b, a) {
    return b.boxType === "Note" && a.arrowType === "Support" ? Just("Pegged to") : Nothing;
  },
  avatarType: (_prsm, v) => {
    switch (v.tag) {
      case "Goal": return SimpleBox("Goal");
      case "Note": return SimpleBox("Note");
      case "Edge": return SimpleArrow("Support");
      default: return NoAvatar;
    }
  },
  diagramTypeName: () => "Demo",
  arrowTailRelation: () => NR.edgeFromRelation,
  arrowHeadRelation: () => NR.edgeToRelation,
  arrowTailExportRelation: () => Nothing,
  arrowHeadExportRelation: () => Nothing,
  arrowHeadDraw: () => closedArrowHead(30, 10, true),
  arrowLineDashes: () => [],
  *arrowCanConnect(_d, _dir, _arrow, b) {
    return b.boxType === "Goal";
  },
};

const ecls = Avatar_Element(cls);

let counter = 0;
const did = (): DiagramId => U.fromWords(0x9d, 0xde70, 0, ++counter);

function pipeline(steps: readonly QueryData<TV>[]): QueryDiagram<TV> {
  const boxes = [QueryInput, ...steps, QueryOutput].map((d, i) =>
    QueryBox<TV>(did(), Rectangle(BB(P(0, 150 * i), P(200, 150 * i + 100))), d));
  const arrows = boxes.slice(1).map((b, i) => QueryArrow(did(),
    LineShape([Connected(P(0, 0), boxes[i].queryBoxId, Nothing), Connected(P(0, 0), b.queryBoxId, Nothing)], [])));
  return QueryDiagram<TV>(mkDiagramEntity(Name("Notes"), diagramFromList(Avatar_QueryElement(cls),
    [...boxes.map((b) => QElemBox(b)), ...arrows.map((a) => QElemArrow<TV>(a))]), null), S.empty(), "Notes in the diagram");
}

const svgPicture = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">
  <rect x="2" y="2" width="156" height="86" rx="10" fill="#dbe9f7" stroke="#3465a4" stroke-width="3"/>
  <circle cx="45" cy="45" r="26" fill="#f57900"/>
  <path d="M85 70 L110 22 L135 70 Z" fill="#4e9a06"/>
  <text x="80" y="84" font-size="11" text-anchor="middle" font-family="sans-serif">SVG image</text>
</svg>`;

/** A PNG drawn with a 2D canvas (a pixel image stored as Base64 in the model). */
function pngPicture(): Maybe<Graphic> {
  const canvas = document.createElement("canvas");
  canvas.width = 150;
  canvas.height = 60;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return Nothing;
  const grad = ctx.createLinearGradient(0, 0, 150, 0);
  grad.addColorStop(0, "#cc0000");
  grad.addColorStop(0.5, "#edd400");
  grad.addColorStop(1, "#73d216");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 150, 60);
  ctx.fillStyle = "#000";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("PNG image", 38, 36);
  const b64 = canvas.toDataURL("image/png").split(",")[1];
  return Just(JSON_Graphic.parseJSON({ image: b64 }));
}

interface Ids { pkg: ModelId; g1: ModelId; g2: ModelId; g3: ModelId; note: ModelId; dgm: ModelId; details: ModelId }

function buildModel(): [ModelEditState<TV>, Ids] {
  const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), emptyModel(cls, "Demo")), (c) => {
    const pkg = mkPackage(c, Name("Safety case"));
    goToEntity(c, pkg);
    const g1 = mkEntity(c, Goal("System is safe", "The train doors are safe to operate.")).entityId;
    const g2 = mkEntity(c, Goal("Hazards mitigated", "All identified hazards are mitigated.")).entityId;
    const g3 = mkEntity(c, Goal("Software verified", "Door controller software meets its requirements.")).entityId;
    const note = mkEntity(c, Note("Assumption", "Platform edge doors present.")).entityId;
    const e1 = mkEntity(c, Edge("Support 1")).entityId;
    const e2 = mkEntity(c, Edge("Support 2")).entityId;
    modifyRelations(c, (rs) => NR.insert(e1, g1, NR.edgeFromRelation, NR.insert(e1, g2, NR.edgeToRelation,
      NR.insert(e2, g1, NR.edgeFromRelation, NR.insert(e2, g3, NR.edgeToRelation, rs)))));
    const q = mkEntity(c, { tag: "Query", qd: pipeline([InDiagram, FilterVariants<TV>(S.fromList([Variant("Note")]))]) }).entityId;
    const details = mkEntity(c, Dgm("Details", [])).entityId;
    const boxG1 = cls.mkBox(did(), g1, "Goal", Nothing, BB(P(260, 30), P(470, 130)));
    const boxG2 = cls.mkBox(did(), g2, "Goal", Nothing, BB(P(80, 300), P(290, 400)));
    const boxG3 = cls.mkBox(did(), g3, "Goal", Nothing, BB(P(440, 300), P(650, 400)));
    const boxNote = cls.mkBox(did(), note, "Note", Nothing, BB(P(700, 40), P(880, 130)));
    const a1 = Arrow<Demo, TV>(did(), e1, "Support", LineShape([
      Connected(P(330, 130), boxG1.boxId, Nothing), Connected(P(220, 300), boxG2.boxId, Nothing)], []));
    const a2 = Arrow<Demo, TV>(did(), e2, "Support", LineShape([
      Connected(P(400, 130), boxG1.boxId, Nothing), Connected(P(510, 300), boxG3.boxId, Nothing)], []));
    const svg = JSON_Graphic.parseJSON({ svg: svgPicture });
    const comment1 = Comment(did(), CommentBox(BB(P(720, 200), P(900, 340))), Just(svg), "A comment with an SVG image.");
    const comment2 = Comment(did(), CommentBox(BB(P(40, 470), P(240, 580))), pngPicture(), "A comment with a PNG image.");
    const link = Link(did(), Just(details), CommentBox(BB(P(440, 480), P(640, 530))), "Double-click to activate.");
    const dgm = mkEntity(c, Dgm("Overview",
      [ElemBox(boxG1), ElemBox(boxG2), ElemBox(boxG3), ElemBox(boxNote), ElemArrow(a1), ElemArrow(a2),
        ElemComment(comment1), ElemComment(comment2), ElemLink(link)],
      mkDA(Just(true), EntityShowFields([
        ["Goal", [EntityShowField(FieldStyleNone, descriptionField)]],
        ["Note", [EntityShowField(FieldStyleNone, descriptionField)]],
      ]), [[q, Colour(C.sRGB24(32, 74, 135))]]),
    )).entityId;
    return { pkg, g1, g2, g3, note, dgm, details };
  });
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  return [r.value[1], r.value[0].updateValue];
}

// ---------------------------------------------------------------------------------------------

export function main(): void {
  const theme = Gtk.iconThemeGetDefault();
  const style = hadesConfig(theme);
  let [st, ids] = buildModel();
  let selection = S.empty<ModelId>();
  let hint: Maybe<string> = Nothing;
  const log: string[] = [];

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Generic diagram demo");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  Gtk.containerAdd(win, vbox);
  const status = Gtk.labelNew("");
  Gtk.widgetSetHalign(status, Gtk.AlignStart);
  statusText = (s) => {
    log.push(s);
    Gtk.labelSetText(status, s);
  };

  const [w] = (() => {
    const r = runModelEdit(cls, identity<TV>(), st, (c) => {
      const e = M.lookup(ids.dgm, c.state.stateModel.modelContents);
      if (e.tag === "Nothing") throw new Error("no diagram");
      return cls.getDiagramWrapper(c, e.value);
    });
    if (r.tag === "Left") throw new Error(show_ModelError(r.value));
    return [r.value[0].updateValue];
  })();
  if (w.tag === "Nothing" || w.tag === "Just" && w.value.tag !== "DiagramWrapper") throw new Error("no wrapper");
  const wrapper = w.value as Extract<typeof w.value, { tag: "DiagramWrapper" }>;

  const toolbar = DeltaToolbar<TE>([[
    DeltaTool("gsn_goal", "Goal", DeltaToolAction(mkScriptAction<TE>((d) =>
      newBoxEntityTool(cls, d, ids.pkg, Goal("Goal", "New goal."), "Goal")))),
    DeltaTool("gsn_assumption", "Note", DeltaToolAction(mkScriptAction<TE>((d) =>
      newBoxEntityTool(cls, d, ids.pkg, Note("Note", "New note."), "Note")))),
    DeltaTool("gsn_support_arrow", "Support", DeltaToolAction(mkScriptAction<TE>((d) =>
      newArrowEntityTool(cls, d, true, ids.pkg, Edge("Support"), "Support")))),
  ], [
    DeltaTool("basic_comment", "Comment", DeltaToolAction(newCommentTool<Demo, TV>())),
    DeltaTool("emblem-symbolic-link", "Link", DeltaToolAction(newLinkTool<Demo, TV>(cls))),
  ]], [alignmentTools<TE>()]);

  // -------------------------------------------------------------------------------------------
  // Script interpreter (Model.GI.ModelDiagrams.interpretScript, with asynchronous dialogs).

  const properties = async (state: ModelEditState<TV>, uuid: ModelId): Promise<Maybe<any>> => {
    const model = state.stateModel;
    const e = M.lookup(uuid, model.modelContents);
    if (e.tag === "Nothing") return Nothing;
    const v = [e.value, getReferenceValues(uuid, model.modelRelations)] as const;
    const dlg = reflectiveDialog<TV, null>(cls, () => Nothing)(model, Just(v));
    if (dlg.tag === "Nothing") return Nothing;
    const r = await runDialog(win, theme, dlg.value, model, Just(v));
    return r.tag === "Just" ? Just(fromMaybe(v, r.value)) : Nothing;
  };

  const interpret = async <A>(st0: ModelEditState<TV>, script: ModelScriptAct<HadesRender, TV, TV, A>):
    Promise<Either<ModelError, [A, ModelEditState<TV>]>> => {
    let state = st0;
    let act = script;
    for (;;) {
      const r = runModelEdit(cls, identity<TV>(), state, (c) => stepScript(c, act));
      if (r.tag === "Left") return Left(r.value);
      const [upd, newState] = r.value;
      const step = upd.updateValue;
      if (step.tag === "Pure") return Right([step._0, newState]);
      const instr: UserScriptFunctor<HadesRender, TV> = step._0;
      let answer: any = null;
      switch (instr.tag) {
        case "ScriptProperties": answer = await properties(newState, instr._0); break;
        case "ScriptDialog": {
          const dlg = instr._0(newState.stateModel, instr._1);
          answer = dlg.tag === "Just" ? await runDialog(win, theme, dlg.value, newState.stateModel, instr._1) : Just(instr._1);
          break;
        }
        case "ScriptOpenDiagram": statusText("Open diagram " + instr._0.wrappedEntityId); break;
        case "ScriptGetSelection": answer = selection; break;
        case "ScriptSetSelection": selection = instr._0; statusText(S.size(selection) + " entities selected in the model"); break;
        case "ScriptGetHint": answer = hint; break;
        case "ScriptSetHint": hint = instr._0; fireHint(hint); break;
        case "ScriptPerformIO": answer = await instr._0(); break;
        default: break;
      }
      state = newState;
      act = step._1(answer);
    }
  };

  const [resultE, fireResult] = B.newEvent<HadesGtk<TE>>();
  const [hintE, fireHint] = B.newEvent<Maybe<string>>();
  let current: HadesGtk<TE> | null = null;
  const queue: [Action<TE>[], boolean][] = [];
  let running = false;

  /** Store the edited diagram in the model at a checkpoint (`updateDiagramInModel`). */
  const storeDiagram = (c: ModelEditCtx<TV, TV>, h: HadesGtk<TE>): void => {
    const dg = streamStateT(view(hadesState<TE>(), h))._deltaDiagram;
    try_(c, (c1) => {
      // If this fails the diagram has been deleted, so it doesn't matter.
      goToEntity(c1, ids.dgm);
      modifyValue(c1, (v: TV) => set(_Dgm.dot(diagramEntityContents<TE, DA>()), dg, v));
    });
  };

  /** Update the diagram from the model (`updateDiagram dPrism >> yieldViews`). */
  const updateFromModel = (): Action<TE> => mkScriptAction<TE>(function* (d) {
    yield* updateDiagram(d, _Dgm);
    return yield* yieldViews(d);
  });

  /** Set the properties of a diagram element after its dialog (`updatePropertyAction`). */
  const updatePropertyAction = (u: DiagramId, v: TE): Action<TE> => mkScriptAction<TE>(function* (d) {
    modifying(d, deltaDiagram<TE>(), (dg: Diagram<TE>) => diagramModify(() => v, u, dg));
    yield* tellItem(d, v);
    const desc = yield* d.cls.itemDescription(d, v);
    yield* tellCheckpoint(d, "Set properties of " + desc);
    return yield* yieldViews(d);
  });

  const runBatch = async (acts: Action<TE>[], fromModel: boolean): Promise<void> => {
    if (current === null) return;
    const h0 = current;
    const r = await interpret<HadesActionResult<TE>>(st, function* (ctx) {
      // The Delta's base-monad instructions are the script's instructions.
      const res = yield* (hadesActionExecute(ctx, h0, acts) as Generator<any, HadesActionResult<TE>, any>);
      if (res.hadesActionCheckpoint.tag === "Just") storeDiagram(ctx, res.hadesActionNewState);
      return res;
    });
    if (r.tag === "Left") {
      await errorBox(win, show_ModelError(r.value));
      return;
    }
    const [res, newState] = r.value;
    st = newState;
    const h1 = res.hadesActionNewState;
    current = h1;
    fireResult(h1);
    res.hadesActionDraw();
    const cp = res.hadesActionCheckpoint;
    if (cp.tag === "Just" && cp.value !== "") statusText(cp.value);
    // Property dialogs of diagram elements that are not avatars.
    for (const item of res.hadesActionProperties) {
      const dlg = wrapper.diagramDialog(st.stateModel, item);
      if (dlg.tag === "Nothing") continue;
      const v = await runDialog(win, theme, dlg.value, st.stateModel, item);
      if (v.tag === "Just") queue.push([[updatePropertyAction(HasId_Element.identifier(item), v.value)], false]);
    }
    // The model has changed: update the diagram from it.
    if (cp.tag === "Just" && !fromModel) queue.push([[updateFromModel()], true]);
  };

  const enqueue = (acts: Action<TE>[]): void => {
    queue.push([acts, false]);
    if (running) return;
    running = true;
    void (async () => {
      try {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) await runBatch(next[0], next[1]);
      } catch (e) {
        console.error(e);
        await errorBox(win, String(e));
      } finally {
        running = false;
      }
    })();
  };

  const net = B.compile(() => {
    const [toolbarWidget, toolbarActions] = makeGtkDeltaToolbar(ecls, toolbar);
    const hadesRef: B.Behavior<HadesGtk<TE>> = B.lazyB(() => hadesB);
    const [drawingWidget, hadesInit, diagramActions] = makeDrawingGtk(
      ecls, wrapper.diagramToEdit, wrapper.diagramContext, wrapper.diagramMenu, keyCommands<TE>(), style, 1, hadesRef);
    const hadesB: B.Behavior<HadesGtk<TE>> = B.stepper(hadesInit, resultE);
    const zoomRef: B.Event<number> = B.lazyE(() => zoomE);
    const updateZoom = (z: number): Action<TE> => mkScriptAction<TE>(function* (d) {
      d.state = { ...d.state, _deltaZoom: z };
      yield* tellAll(d);
      return yield* yieldViews(d);
    });
    const allActions = [diagramActions, toolbarActions, B.mapE((z: number) => [updateZoom(z)], zoomRef)]
      .reduceRight((acc, e) => B.unionWith((a: Action<TE>[], b: Action<TE>[]) => [...a, ...b], e, acc));
    B.reactimate(B.mapE((acts: Action<TE>[]) => () => enqueue(acts), allActions));
    const zoomOf = (h: HadesGtk<TE>): number => view(deltaZoom<TE>(), streamStateT(view(hadesState<TE>(), h)));
    const [bottomBar, zoomE] = makeBottomBar(B.stepper<Maybe<string>>(Nothing, hintE), B.mapB(zoomOf, hadesB));
    Gtk.boxPackStart(vbox, toolbarWidget, false, false, 0);
    Gtk.boxPackStart(vbox, drawingWidget, true, true, 0);
    Gtk.boxPackStart(vbox, status, false, false, 2);
    Gtk.boxPackStart(vbox, bottomBar, false, false, 0);
    current = hadesInit;
  });
  B.actuate(net);

  const dstate = () => (current === null ? null : streamStateT(view(hadesState<TE>(), current)));
  const describe = (x: TE): unknown[] => {
    const b = ecls.itemBounds(x);
    const bounds = b.tag === "BoundBox" ? [b._0._pX, b._0._pY, b._1._pX, b._1._pY].map((n) => Math.round(n)) : [];
    switch (x.tag) {
      case "ElemBox": return ["box", x._0.boxId, x._0.boxType, nameOf(x._0.boxEntity), bounds,
        x._0._boxPeg.tag === "Just" ? x._0._boxPeg.value[1] : null];
      case "ElemArrow": return ["arrow", x._0.arrowId, nameOf(x._0.arrowEntity),
        x._0._arrowShape._lineEnds.map((e) => (e.tag === "Connected" ? targetName(e.connectorTarget) : "-"))];
      case "ElemComment": return ["comment", x._0.commentId, x._0._commentText, bounds];
      case "ElemLink": return ["link", x._0.linkId, x._0._linkText, bounds];
    }
  };
  const nameOf = (u: ModelId): string => {
    const e = M.lookup(u, st.stateModel.modelContents);
    return e.tag === "Just" ? view(nameL, e.value._entityContents)._0 : "?";
  };
  const targetName = (d: DiagramId): string => {
    const s = dstate();
    if (s === null) return "?";
    const x = M.lookup(d, view(deltaDiagram<TE>().dot(diagramContents<TE>()), s));
    return x.tag === "Just" && x.value.tag === "ElemBox" ? nameOf(x.value._0.boxEntity) : "?";
  };
  (window as any).gd = {
    items: () => {
      const s = dstate();
      return s === null ? [] : diagramToList(view(deltaDiagram<TE>(), s)).map(describe);
    },
    selection: () => {
      const s = dstate();
      return s === null ? [] : S.toList(view(deltaSelection<TE>(), s)).map((u) => {
        const x = M.lookup(u, view(deltaDiagram<TE>().dot(diagramContents<TE>()), s));
        return x.tag === "Just" ? describe(x.value)[0] + ":" + u : u;
      });
    },
    /** Edge relations in the model, as [edge name, tail, head]. */
    edges: () => M.elems(st.stateModel.modelContents).filter((e: Entity<TV>) => e._entityContents.tag === "Edge").map((e: Entity<TV>) => [
      nameOf(e.entityId),
      S.toList(NR.relation(e.entityId, NR.edgeFromRelation, st.stateModel.modelRelations)).map(nameOf),
      S.toList(NR.relation(e.entityId, NR.edgeToRelation, st.stateModel.modelRelations)).map(nameOf),
    ]),
    pegs: () => S.toList(NR.relation(ids.note, "Pegged to", st.stateModel.modelRelations)).map(nameOf),
    /** The diagram as stored in the model, as JSON. */
    stored: () => {
      const e = M.lookup(ids.dgm, st.stateModel.modelContents);
      if (e.tag === "Nothing" || e.value._entityContents.tag !== "Dgm") return null;
      return diagramToList(e.value._entityContents.dgm._diagramEntityContents).map((x) => JSON_Element(cls).toJSON(x));
    },
    names: () => M.elems(st.stateModel.modelContents).map((e: Entity<TV>) => view(nameL, e._entityContents)._0),
    log: () => log,
    canvasRect: () => {
      const el = document.querySelector("canvas");
      const r = el?.getBoundingClientRect();
      return r ? [r.left, r.top, r.width, r.height] : null;
    },
  };
  Gtk.widgetShowAll(win);
  Gtk.main();
}
