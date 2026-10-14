import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import * as Cairo from "@/lib/GI/Cairo";
import type * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { identity, lens, preview, prism, review, set, view, type Prism } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import {
  type Action, type ActionOutput, type BoundBox, type Command, type Diagram, type DiagramId, type Point,
  type View, type ViewSet,
  Action as mkAction, Activate, BoundBox as BB, CommentBox, Connected, Drag, EndDrag, Ellipse, LineShape,
  NoBox, Point as P, Rectangle, Select, Unconnected, applyDelta, deltaStateOf, diagramFromList,
  diagramToList, lineEnds, lineFractionPoint, mkDiagramState, mkScriptAction, noMod, noPaint, processAction, rectangleCorners,
  startDelta, tellAll, updateViewSet, mempty_ViewSet, yieldViews, BoxShapeClass_Ellipse, BoxShapeClass_Rectangle,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesEnv, type HadesRender, drawPolygon, hadesConfig, layoutTitle, noArrowHead, runLayout_,
  withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, extract } from "@/hades/src/Model/Reflection/Reflective";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import {
  type Entity, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  Name, Package, emptyModel, goToEntity, mkEntity, mkPackage, modelStartState, modifyRelations, nameField,
  nameText, packageName, runModelEdit,
} from "@/hades/src/Model/Abstract/PackageTree";
import {
  type DiagramEntity, type ModelScriptAct, type UserScriptFunctor,
  DiagramEntity as mkDiagramEntity, DiagramWrapper, JSON_DiagramEntity, diagramEntityName, keyCommands,
  stepScript,
} from "@/hades/src/Model/Abstract/DiagramType";
import {
  type QueryData, Avatar_QueryElement, FilterVariants, InDiagram, QElemArrow, QElemBox, QueryArrow, QueryBox,
  QueryDiagram, QueryInput, QueryOutput,
} from "@/hades/src/Model/Query/Diagram";
import {
  type DiagramAppearance, DiagramAppearance as mkDA, EntityShowField, EntityShowFields, FieldStyleNone,
  JSON_DiagramAppearance, append_DiagramAppearance, mempty_DiagramAppearance,
} from "./Appearance";
import {
  type Element, type GenericContext, type GenericDiagramClass, type Graphic,
  AppearanceDef, Arrow, Avatar_Element, Box, Comment, Connectable_Element, ElemArrow, ElemBox,
  ElemComment, ElemLink, ErrorGraphic, GenericContext as mkGenericContext, HasId_Element, JSON_Comment,
  JSON_Element, JSON_Graphic, Link, NoAvatar, PixelGraphic, SimpleArrow, SimpleBox, VectorGraphic, Viewable_Element,
  _ElemArrow, _ElemBox, _ElemComment, _ElemLink, append_AppearanceDef, arrowShape, base64DecodeLenient,
  base64Encode, boxPeg, compileAppearance, decodedGraphic, def_Comment, def_Link, diagramAppearanceDef,
  diagramTypeClassDefaults, edgeLinks, elementDialog, elementMapAvatars, eq_Box, isLinkable, linkTarget,
  mempty_AppearanceDef, newArrowEntityTool, newBoxEntityTool, newCommentTool, show_Link,
} from "./GenericDiagram";

// ---------------------------------------------------------------------------------------------
// A toy diagram type and model.

/** The diagram type: box and arrow types are strings, and the model subtype is the whole model. */
interface Toy {
  readonly BoxType: string;
  readonly ArrowType: string;
  readonly ModelSubtype: TV;
}
type TE = Element<Toy, TV>;
type DA = DiagramAppearance<Toy, TV>;

type TV =
  | { readonly tag: "Pkg"; readonly pkg: Package<TV, DA> }
  | { readonly tag: "Goal"; readonly name: Name; readonly desc: string }
  | { readonly tag: "Note"; readonly name: Name }
  | { readonly tag: "Edge"; readonly name: Name }
  | { readonly tag: "Dgm"; readonly dgm: DiagramEntity<TE, DA> }
  | { readonly tag: "Query"; readonly qd: QueryDiagram<TV> };

const Goal = (n: string, desc = ""): TV => ({ tag: "Goal", name: Name(n), desc });
const Note = (n: string): TV => ({ tag: "Note", name: Name(n) });
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
/** A prism that never matches (lookup tables, matrices and reports). */
const never = <A>(): Prism<TV, A> => prism((_a: A): TV => { throw new Error("not used"); }, (v: TV) => Left(v));

const activations: Maybe<ModelId>[] = [];
const boxColour = (border: Maybe<Colour>): string => (border.tag === "Just" ? C.sRGB24show(border.value) : "plain");

const cls: GenericDiagramClass<Toy, TV> = {
  // Reflective
  reflectiveName: (v) => Variant(v.tag === "Pkg" ? "Package" : v.tag === "Dgm" ? "Toy Diagram" : v.tag),
  variantUserLabel: defaultVariantUserLabel,
  reflectiveDefaults: [Goal(""), Note(""), Edge("")],
  reflectiveBuiltIn: () => [nameField],
  reflectiveGet: (v) => M.singleton(nameField, ExtText(view(nameL.dot(nameText), v))),
  reflectiveSet: (st, v) => set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v),
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  // EntityClass
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
  // AppearanceClass
  getDiagramAppearance: (pm: DA) => pm,
  // HasDiagrams
  isDiagram: (v) => v.tag === "Dgm" || v.tag === "Query",
  getDiagramWrapper: (ctx, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return Nothing;
    const vctx = compileAppearance(cls, ctx, v.dgm._diagramEntityData, mkGenericContext<Toy, TV>(e.entityId, mempty_AppearanceDef));
    return Just(DiagramWrapper(Avatar_Element(cls), e.entityId, v.dgm._diagramEntityContents, _Dgm, identity<TV>(),
      elementDialog<Toy, TV>(cls), vctx, Nothing, () => ({ toolbarLeft: [], toolbarRight: [] })));
  },
  diagramEntityTypes: M.empty(),
  diagramMapAvatars: (f, e) => {
    const v = e._entityContents;
    if (v.tag !== "Dgm") return e;
    const items = diagramToList(v.dgm._diagramEntityContents).map((x) => elementMapAvatars(f, x));
    return { ...e, _entityContents: Dgm(v.dgm._diagramEntityName._0, items, v.dgm._diagramEntityData) };
  },
  // Editable
  editableActivation: (e) => function* () {
    activations.push(e.tag === "Just" ? Just(e.value.entityId) : Nothing);
    return Just("Activated");
  },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
  // HasLookups, Queryable, HasMatrices, HasReports
  _LookupTable: never(),
  _QueryDiagram: _Query,
  queryAvatars: (v) => (v.tag === "Dgm"
    ? diagramToList(v.dgm._diagramEntityContents).flatMap((x) =>
      x.tag === "ElemBox" ? [x._0.boxEntity] : x.tag === "ElemArrow" ? [x._0.arrowEntity] : [])
    : []),
  _Matrix: never(),
  _Report: never(),
  // DiagramTypeClass
  ...diagramTypeClassDefaults<Toy, TV>(),
  boxTypeJ: J.textJ,
  arrowTypeJ: J.textJ,
  mkBox: (diagId, modelId, typ, peg, bound) => (typ === "Solution"
    ? Box(BoxShapeClass_Ellipse, diagId, modelId, typ, peg, Ellipse(bound))
    : Box(BoxShapeClass_Rectangle, diagId, modelId, typ, peg, Rectangle(bound))),
  *boxTypeDraw(_d, b, contents, border) {
    return (bb: BoundBox): HadesRender => (env) => {
      const outline = drawPolygon(rectangleCorners(Rectangle(bb)));
      (border.tag === "Just" ? withLineColour(border.value, outline) : outline)(env);
      runLayout_(bb, (e1, st) => {
        layoutTitle(Nothing, b.boxType === "Goal" ? boxColour(border) : "N")(e1, st);
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
    return b.boxType === "Note" && a.arrowType === "Support" ? Just("Pegged") : Nothing;
  },
  avatarType: (_prsm, v) => {
    switch (v.tag) {
      case "Goal": return SimpleBox("Goal");
      case "Note": return SimpleBox("Note");
      case "Edge": return SimpleArrow("Support");
      default: return NoAvatar;
    }
  },
  diagramTypeName: () => "Toy",
  arrowTailRelation: () => NR.edgeFromRelation,
  arrowHeadRelation: () => NR.edgeToRelation,
  arrowTailExportRelation: () => Nothing,
  arrowHeadExportRelation: () => Nothing,
  arrowHeadDraw: () => noArrowHead,
  arrowLineDashes: () => [],
  *arrowCanConnect(_d, _dir, _arrow, b) {
    return b.boxType === "Goal";
  },
};

const ecls = Avatar_Element(cls);

// Model construction.

function edit<A>(st: ModelEditState<TV>, act: (c: ModelEditCtx<TV, TV>) => A): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, identity<TV>(), st, act);
  if (r.tag === "Left") throw new Error("Model edit failed: " + JSON.stringify(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

let counter = 0;
const did = (): DiagramId => U.fromWords(0x6d1a, 0, 0, ++counter);

const box = (ent: ModelId, typ: string, x: number, y: number, w = 100, h = 50): Box<Toy, TV> =>
  cls.mkBox(did(), ent, typ, Nothing, BB(P(x, y), P(x + w, y + h)));

/** A query diagram: Input -> steps... -> Output. */
function pipeline(steps: readonly QueryData<TV>[]): QueryDiagram<TV> {
  const qcls = Avatar_QueryElement(cls);
  const boxes = [QueryInput, ...steps, QueryOutput].map((d, i) =>
    QueryBox<TV>(did(), Rectangle(BB(P(0, 150 * i), P(200, 150 * i + 100))), d));
  const arrows = boxes.slice(1).map((b, i) => QueryArrow(did(),
    LineShape([Connected(P(0, 0), boxes[i].queryBoxId, Nothing), Connected(P(0, 0), b.queryBoxId, Nothing)], [])));
  return QueryDiagram<TV>(mkDiagramEntity(Name("Q"), diagramFromList(qcls,
    [...boxes.map((b) => QElemBox(b)), ...arrows.map((a) => QElemArrow<TV>(a))]), null), S.empty(), "");
}

const red = Colour(C.sRGB24(204, 0, 0));
const blue = Colour(C.sRGB24(0, 0, 204));

interface TestModel {
  st: ModelEditState<TV>;
  pkg: ModelId; a: ModelId; b: ModelId; c: ModelId; n: ModelId; e: ModelId; q: ModelId; dgm: ModelId;
  boxA: Box<Toy, TV>; boxB: Box<Toy, TV>; boxC: Box<Toy, TV>; boxN: Box<Toy, TV>; arrowE: Arrow<Toy, TV>;
  comment: Comment; link: Link;
}

/**
 * Root / P (package appearance: arrow labels off) containing goals A, B, C, note N, edge E (A -> B),
 * a highlight query Q (goals in the input diagram) and diagram D (arrow labels on, highlights Q in
 * red) showing A, B, C, N, E, a comment and a link to Q.
 */
function testModel(): TestModel {
  const [ids, st] = edit(modelStartState(newGenerator(), emptyModel(cls, "Test")), (c) => {
    const pkg = mkPackage(c, Name("P"));
    goToEntity(c, pkg);
    const a = mkEntity(c, Goal("A", "First goal")).entityId;
    const b = mkEntity(c, Goal("B")).entityId;
    const cc = mkEntity(c, Goal("C")).entityId;
    const n = mkEntity(c, Note("N")).entityId;
    const e = mkEntity(c, Edge("E")).entityId;
    modifyRelations(c, (r) => NR.insert(e, a, NR.edgeFromRelation, NR.insert(e, b, NR.edgeToRelation, r)));
    const q = mkEntity(c, { tag: "Query", qd: pipeline([InDiagram, FilterVariants<TV>(S.fromList([Variant("Goal")]))]) }).entityId;
    const boxA = box(a, "Goal", 0, 0);
    const boxB = box(b, "Goal", 300, 0);
    const boxC = box(cc, "Goal", 300, 300);
    const boxN = box(n, "Note", 0, 300);
    const arrowE = Arrow<Toy, TV>(did(), e, "Support", LineShape([
      Connected(P(100, 25), boxA.boxId, Nothing), Connected(P(300, 25), boxB.boxId, Nothing)], []));
    const comment = Comment(did(), CommentBox(BB(P(0, 500), P(200, 560))), Nothing, "A comment\n\nSecond para");
    const link = Link(did(), Just(q), CommentBox(BB(P(300, 500), P(450, 530))), "Link text");
    const dgm = mkEntity(c, Dgm("D",
      [ElemBox(boxA), ElemBox(boxB), ElemBox(boxC), ElemBox(boxN), ElemArrow(arrowE), ElemComment(comment), ElemLink(link)],
      mkDA(Just(true), EntityShowFields([["Goal", [EntityShowField(FieldStyleNone, nameField)]]]), [[q, red]]),
    )).entityId;
    return { pkg, a, b, c: cc, n, e, q, dgm, boxA, boxB, boxC, boxN, arrowE, comment, link };
  });
  // Package appearance: arrow labels off, highlight in blue (the diagram's red comes first).
  const withMeta: ModelEditState<TV> = {
    ...st,
    stateModel: {
      ...st.stateModel,
      modelContents: M.adjust((e: Entity<TV>) => (e._entityContents.tag === "Pkg"
        ? { ...e, _entityContents: { tag: "Pkg", pkg: Package<TV, DA>(Name("P"), mkDA(Just(false), EntityShowFields([]), [[ids.q, blue]])) } as TV }
        : e), ids.pkg, st.stateModel.modelContents),
    },
  };
  return { st: withMeta, ...ids };
}

const tm = testModel();

// ---------------------------------------------------------------------------------------------
// A script interpreter and diagram editor, as Model.GI.ModelDiagrams does it.

interface Env {
  hint: Maybe<string>;
  log: string[];
  /** Answer to a ScriptDialog instruction. */
  dialog: (v: any, sel: any) => Maybe<any>;
}

const newEnv = (dialog: Env["dialog"] = (v) => Just(v)): Env => ({ hint: Nothing, log: [], dialog });

function interpret<A>(st0: ModelEditState<TV>, script: ModelScriptAct<HadesRender, TV, TV, A>, env: Env):
  Either<ModelError, [A, ModelEditState<TV>]> {
  let st = st0;
  let act = script;
  for (;;) {
    const r = runModelEdit(cls, identity<TV>(), st, (c) => stepScript(c, act));
    if (r.tag === "Left") return Left(r.value);
    const [upd, newState] = r.value;
    const step = upd.updateValue;
    if (step.tag === "Pure") return Right([step._0, newState]);
    const instr: UserScriptFunctor<HadesRender, TV> = step._0;
    env.log.push(instr.tag);
    let answer: any = null;
    switch (instr.tag) {
      case "ScriptProperties": {
        const e = M.lookup(instr._0, newState.stateModel.modelContents);
        answer = e.tag === "Just" ? Just([e.value, M.empty()]) : Nothing;
        break;
      }
      case "ScriptDialog": answer = env.dialog(instr._1, instr._0); break;
      case "ScriptGetHint": answer = env.hint; break;
      case "ScriptSetHint": env.hint = instr._0; break;
      case "ScriptGetSelection": answer = S.empty(); break;
      default: break;
    }
    st = newState;
    act = step._1(answer);
  }
}

function ok<A>(r: Either<ModelError, A>): A {
  if (r.tag === "Left") throw new Error("Script failed: " + JSON.stringify(r.value));
  return r.value;
}

class Editor {
  nxt: ReturnType<typeof startDelta<TE>>;
  st: ModelEditState<TV>;
  out: ActionOutput<TE> | null = null;
  views: ViewSet<TE> = mempty_ViewSet<TE>();
  checkpoints: string[] = [];
  constructor(st: ModelEditState<TV>, readonly env: Env = newEnv()) {
    this.st = st;
    const [w] = edit(st, (c) => {
      const e = M.lookup(tm.dgm, c.state.stateModel.modelContents);
      if (e.tag === "Nothing") throw new Error("no diagram");
      return cls.getDiagramWrapper(c, e.value);
    });
    if (w.tag === "Nothing" || w.value.tag !== "DiagramWrapper") throw new Error("no wrapper");
    this.nxt = startDelta<TE>(ecls, (d, a) => processAction(d, () => noPaint, keyCommands<TE>(), a),
      mkDiagramState(w.value.diagramContext, 1, w.value.diagramToEdit));
    this.script(function* (d) {
      yield* tellAll(d);
      return yield* yieldViews(d);
    });
  }
  action(a: Action<TE>): void {
    const nxt = this.nxt;
    const self = this;
    const script = function* (c: ModelEditCtx<TV, TV>): Generator<any, null, any> {
      const [out] = yield* applyDelta(c, nxt, a);
      self.out = out;
      return null;
    };
    const [, st2] = ok(interpret(this.st, script, this.env));
    this.st = st2;
    if (this.out !== null) {
      this.views = updateViewSet(this.views, this.out.outViews);
      if (this.out.outCheckpoint.tag === "Just") this.checkpoints.push(this.out.outCheckpoint.value);
    }
  }
  /** The top-most view touching the point. */
  targetAt(pt: Point): Maybe<readonly [DiagramId, View<TE>]> {
    for (const u of deltaStateOf(this.nxt)._deltaDiagram._diagramOrder) {
      const v = M.lookup(u, this.views._0);
      if (v.tag === "Just" && v.value.viewTouched(pt)) return Just([u, v.value] as const);
    }
    return Nothing;
  }
  apply(cmd: Command<TE>, at: Point = P(0, 0)): void {
    this.action(mkAction(cmd, at, noMod, this.targetAt(at)));
  }
  /** A complete drag from one point to another. */
  drag(from: Point, to: Point): void {
    const dd: [number, number] = [to._pX - from._pX, to._pY - from._pY];
    const target = this.targetAt(from);
    this.action(mkAction(Drag<TE>([dd[0] / 2, dd[1] / 2]), from, noMod, target));
    this.action(mkAction(Drag<TE>(dd), from, noMod, target));
    this.action(mkAction(EndDrag<TE>(dd), from, noMod, target));
  }
  script(f: (d: any) => Generator<any, Action<TE>, any>): void {
    this.action(mkScriptAction<TE>(f));
  }
  items(): TE[] {
    return diagramToList(deltaStateOf(this.nxt)._deltaDiagram);
  }
  item(id: DiagramId): TE {
    const x = this.items().find((i) => HasId_Element.identifier(i) === id);
    if (x === undefined) throw new Error("no item " + id);
    return x;
  }
  relation(e: ModelId, rel: string): ModelId[] {
    return S.toList(NR.relation(e, rel, this.st.stateModel.modelRelations));
  }
  /** Run a Delta function within the editor, returning its result. */
  run<A>(f: (d: any) => Generator<any, A, any>): A {
    let r: A | undefined;
    this.script(function* (d) {
      r = yield* f(d);
      return yield* yieldViews(d);
    });
    return r as A;
  }
}

/** Render a view on an SVG surface and return the document. */
function render(vw: View<TE>): string {
  const s = new Cairo.SvgSurface(1000, 1000);
  const env: HadesEnv = { style: hadesConfig({} as Gtk.IconTheme), cr: s.context() };
  vw.viewDraw(env);
  return s.document();
}

function menuLabels(m: Menu<Action<TE>>): string[] {
  return m._0.flat().map((i) => i.menuLabel);
}

// ---------------------------------------------------------------------------------------------

describe("JSON", () => {
  const codec = JSON_Element(cls);
  const examplesDir = path.resolve(__dirname, "../../../dsm/share/examples");
  const elements: [string, any][] = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".dsm")).flatMap((f) => {
    const m = JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"));
    return (m.modelContents as any[])
      .filter((e) => e.contents?.type === "GSN Diagram" || e.contents?.type === "Bow Tie Diagram")
      .flatMap((e) => (e.contents.contents as any[]).map((x, i): [string, any] => [`${f}: ${e.contents.name} #${i}`, x]));
  });

  it("finds generic diagram elements of every kind in the examples", () => {
    const kinds = new Set(elements.map(([, x]) => ("boxId" in x ? "box" : "arrowId" in x ? "arrow" : "commentId" in x ? "comment" : "link")));
    expect(elements.length).toBeGreaterThan(100);
    expect([...kinds].sort()).toEqual(["arrow", "box", "comment", "link"]);
    expect(elements.some(([, x]) => x.graphic && x.graphic.image)).toBe(true);
    expect(elements.some(([, x]) => x.peg)).toBe(true);
  });

  it.each(elements)("round trips %s", (_name, js) => {
    const e = codec.parseJSON(js);
    expect(codec.toJSON(e)).toEqual(js);
  });

  it("parses each kind of element to the right constructor", () => {
    for (const [, js] of elements) {
      const e = codec.parseJSON(js);
      const expected = "boxId" in js ? "ElemBox" : "arrowId" in js ? "ElemArrow" : "commentId" in js ? "ElemComment" : "ElemLink";
      expect(e.tag).toBe(expected);
      if (e.tag === "ElemComment" && js.graphic) expect(e._0._commentGraphic.tag === "Just" && e._0._commentGraphic.value.tag).toBe("PixelGraphic");
    }
  });

  it("writes boxes, arrows, comments and links as the Haskell program does", () => {
    expect(codec.toJSON(ElemBox(tm.boxA))).toEqual({
      boxId: tm.boxA.boxId, entity: tm.a, type: "Goal", peg: null,
      shape: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 50 } },
    });
    const pegged = set(boxPeg<Toy, TV>(), Just([tm.arrowE.arrowId, 0.25] as const), tm.boxN);
    expect((codec.toJSON(ElemBox(pegged)) as any).peg).toEqual([tm.arrowE.arrowId, 0.25]);
    expect(codec.toJSON(ElemArrow(tm.arrowE))).toMatchObject({ arrowId: tm.arrowE.arrowId, entity: tm.e, type: "Support" });
    expect(JSON_Comment.toJSON(tm.comment)).toEqual({
      commentId: tm.comment.commentId, graphic: null, text: "A comment\n\nSecond para",
      shape: { p1: { x: 0, y: 500 }, p2: { x: 200, y: 560 } },
    });
    expect(codec.toJSON(ElemLink(tm.link))).toEqual({
      linkId: tm.link.linkId, linkTarget: tm.q, linkText: "Link text",
      linkShape: { p1: { x: 300, y: 500 }, p2: { x: 450, y: 530 } },
    });
    // A diagram entity with its appearance.
    const dcodec = JSON_DiagramEntity(ecls, codec);
    const de = mkDiagramEntity<TE, DA>(Name("D"), diagramFromList(HasId_Element, [ElemBox(tm.boxA)]), mempty_DiagramAppearance);
    const js = dcodec.toJSON(de) as any;
    expect(js.type).toBe("Toy Diagram");
    expect(js.appearance).toEqual({ arrowNames: null, fields: [], highlights: [] });
    expect(equals(dcodec.parseJSON(js), de)).toBe(true);
  });

  it("encodes and decodes Base64 leniently", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 65]);
    for (let n = 0; n <= bytes.length; n++) {
      const b = bytes.slice(0, n);
      expect(base64Encode(b)).toBe(Buffer.from(b).toString("base64"));
      expect(Array.from(base64DecodeLenient(base64Encode(b)))).toEqual(Array.from(b));
    }
    expect(Array.from(base64DecodeLenient("AAEC\n+vv8/f7/QQ"))).toEqual(Array.from(bytes));
    expect(Array.from(base64DecodeLenient("!!QUJD!!"))).toEqual([65, 66, 67]);
    // Padding is skipped in the first two places of a group and ends the data in the last two.
    expect(Array.from(base64DecodeLenient("Q=UJD"))).toEqual([65, 66, 67]);
    expect(Array.from(base64DecodeLenient("=QUJD"))).toEqual([65, 66, 67]);
    expect(Array.from(base64DecodeLenient("QQ=AQUJD"))).toEqual([65]);
    expect(Array.from(base64DecodeLenient("QUI=QUJD"))).toEqual([65, 66]);
    expect(Array.from(base64DecodeLenient("QUJD="))).toEqual([65, 66, 67]);
    expect(Array.from(base64DecodeLenient("Q"))).toEqual([]);
  });

  it("treats a pixel image the browser cannot decode as the Haskell ErrorGraphic", () => {
    // (Pixbufs are shared per image data, so these bytes are used by no other test.)
    const raw = { image: "BwgJ\n", extra: true };
    const g = JSON_Graphic.parseJSON(raw);
    if (g.tag !== "PixelGraphic") throw new Error("not a pixel graphic");
    expect(Array.from(g._0)).toEqual([7, 8, 9]);
    // While it is (or could be) decoding it is a pixel image.
    expect(decodedGraphic(g)).toBe(g);
    expect(JSON_Graphic.toJSON(g)).toEqual({ image: "BwgJ" });
    expect(equals<Graphic>(g, PixelGraphic(Uint8Array.from([7, 8, 9]), g._1))).toBe(true);
    // Once the browser has failed to decode it, it is the raw JSON with the decoder's message.
    g._1.failed = true;
    const d = decodedGraphic(g);
    expect(d.tag === "ErrorGraphic" && [d._0, d._1]).toEqual([raw, "Error during image decoding."]);
    expect(JSON_Graphic.toJSON(g)).toEqual(raw);
    expect(equals<Graphic>(g, ErrorGraphic({ image: "BwgJ\n", extra: true }, "other"))).toBe(true);
    expect(equals<Graphic>(g, PixelGraphic(Uint8Array.from([7, 8, 9]), g._1))).toBe(false);
    expect(JSON_Comment.toJSON(Comment("c", CommentBox(NoBox), Just(g), "t"))).toMatchObject({ graphic: raw });
    // A pixel graphic that was not read from JSON keeps its data.
    const own = PixelGraphic(Uint8Array.from([7, 8, 9]), g._1);
    expect(decodedGraphic(own)).toBe(own);
    expect(JSON_Graphic.toJSON(own)).toEqual({ image: "BwgJ" });
  });

  it("keeps undecodable graphics as raw JSON", () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='10'><rect width='20' height='10'/></svg>";
    const g = JSON_Graphic.parseJSON({ svg });
    expect(g.tag).toBe("VectorGraphic");
    expect(JSON_Graphic.toJSON(g)).toEqual({ svg });
    const bad = JSON_Graphic.parseJSON({ svg: "this is not SVG", extra: 1 });
    expect(bad.tag).toBe("ErrorGraphic");
    expect(bad.tag === "ErrorGraphic" && bad._1).toBe("Error during image decoding.");
    expect(JSON_Graphic.toJSON(bad)).toEqual({ svg: "this is not SVG", extra: 1 });
    expect(() => JSON_Graphic.parseJSON({ neither: 1 })).toThrow();
  });
});

describe("equality", () => {
  it("compares boxes by their shape definition", () => {
    const b1 = Box<Toy, TV, any>(BoxShapeClass_Rectangle, "x", tm.a, "Goal", Nothing, Rectangle(BB(P(0, 0), P(10, 10))));
    const b2 = Box<Toy, TV, any>(BoxShapeClass_Ellipse, "x", tm.a, "Goal", Nothing, Ellipse(BB(P(0, 0), P(10, 10))));
    expect(eq_Box(b1, b2)).toBe(true);
    expect(equals(ElemBox(b1), ElemBox(b2))).toBe(true);
    expect(equals(b1, set(boxPeg<Toy, TV>(), Just(["y", 0.5] as const), b2))).toBe(false);
    expect(equals(b1, { ...b2, boxType: "Note" })).toBe(false);
    expect(equals(ElemBox(b1), ElemArrow(tm.arrowE))).toBe(false);
  });

  it("compares graphics by their stored data only", () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='5' height='5'/>";
    const g1 = JSON_Graphic.parseJSON({ svg });
    const g2 = JSON_Graphic.parseJSON({ svg });
    expect(g1 === g2).toBe(false);
    expect(equals(g1, g2)).toBe(true);
    expect(equals<Graphic>(g1, ErrorGraphic({ svg }, "x"))).toBe(false);
    expect(equals<Graphic>(ErrorGraphic({ a: 1 }, "x"), ErrorGraphic({ a: 1 }, "y"))).toBe(true);
    const c1 = Comment("c", CommentBox(NoBox), Just(g1), "t");
    expect(equals(c1, Comment("c", CommentBox(NoBox), Just(g2), "t"))).toBe(true);
    expect(g1.tag === "VectorGraphic" && equals<Graphic>(VectorGraphic(svg + " ", g1._1), g1)).toBe(false);
  });

  it("has defaults, Show and prisms", () => {
    expect(def_Comment).toEqual(Comment(U.nil, CommentBox(NoBox), Nothing, ""));
    expect(def_Link).toEqual(Link(U.nil, Nothing, CommentBox(NoBox), ""));
    expect(show_Link(Link(U.nil, Just(tm.q), CommentBox(NoBox), "a \"b\""))).toBe(
      `Link linkId=${U.nil} _linkTarget=Just ${tm.q} _linkText="a \\"b\\""`);
    expect(show_Link(def_Link)).toBe(`Link linkId=${U.nil} _linkTarget=Nothing _linkText=""`);
    expect(view(arrowShape<Toy, TV>(), tm.arrowE)).toBe(tm.arrowE._arrowShape);
    expect(preview(_ElemBox<Toy, TV>(), ElemBox(tm.boxA))).toEqual(Just(tm.boxA));
    expect(preview(_ElemArrow<Toy, TV>(), ElemBox(tm.boxA))).toEqual(Nothing);
    expect(preview(_ElemComment<Toy, TV>(), ElemComment(tm.comment))).toEqual(Just(tm.comment));
    expect(preview(_ElemLink<Toy, TV>(), ElemLink(tm.link))).toEqual(Just(tm.link));
    expect(review(_ElemLink<Toy, TV>(), tm.link)).toEqual(ElemLink(tm.link));
  });
});

describe("appearance", () => {
  it("combines appearance definitions", () => {
    const e = ElemBox(tm.boxA);
    const d1 = AppearanceDef<TV, TE>(Just(true), EntityShowFields([]), () => Just(red));
    const d2 = AppearanceDef<TV, TE>(Just(false), EntityShowFields([]), () => Just(blue));
    const d12 = append_AppearanceDef(d1, d2);
    expect(d12.appDefArrowLabels).toEqual(Just(true)); // Left-biased.
    expect(d12.appDefBorderColour(e)).toEqual(Just(blue)); // Right-biased, as in Haskell.
    expect(append_AppearanceDef(d1, mempty_AppearanceDef).appDefBorderColour(e)).toEqual(Just(red));
    expect(append_AppearanceDef(mempty_AppearanceDef, d2).appDefArrowLabels).toEqual(Just(false));
  });

  it("compiles the cascade of appearances and the highlight queries", () => {
    const [vctx] = edit(tm.st, (c) => compileAppearance(cls, c, mempty_DiagramAppearance,
      mkGenericContext<Toy, TV>(tm.dgm, mempty_AppearanceDef)));
    // From the package.
    expect(vctx.diagramId).toBe(tm.dgm);
    expect(vctx._diagramAppearanceDef.appDefArrowLabels).toEqual(Just(false));
    // Q finds the goals in diagram D, so goal boxes are highlighted; arrows and notes are not.
    const border = view(diagramAppearanceDef<Toy, TV>(), vctx).appDefBorderColour;
    expect(border(ElemBox(tm.boxA))).toEqual(Just(blue));
    expect(border(ElemBox(tm.boxN))).toEqual(Nothing);
    expect(border(ElemArrow(tm.arrowE))).toEqual(Nothing);
    expect(border(ElemComment(tm.comment))).toEqual(Nothing);
    // The diagram's own appearance comes first.
    const d = M.lookup(tm.dgm, tm.st.stateModel.modelContents);
    if (d.tag === "Nothing" || d.value._entityContents.tag !== "Dgm") throw new Error("no diagram");
    const [vctx2] = edit(tm.st, (c) => compileAppearance(cls, c, (d.value._entityContents as any).dgm._diagramEntityData,
      mkGenericContext<Toy, TV>(tm.dgm, mempty_AppearanceDef)));
    expect(vctx2._diagramAppearanceDef.appDefArrowLabels).toEqual(Just(true));
    expect(vctx2._diagramAppearanceDef.appDefBorderColour(ElemBox(tm.boxB))).toEqual(Just(red));
    expect(vctx2._diagramAppearanceDef.appDefEntityShowFields._fieldsShown.map(([v]) => v)).toEqual(["Goal"]);
    // A missing query is ignored.
    const [vctx3] = edit(tm.st, (c) => compileAppearance(cls, c, mkDA<Toy, TV>(Nothing, EntityShowFields([]), [[did(), red]]),
      mkGenericContext<Toy, TV>(tm.dgm, mempty_AppearanceDef)));
    expect(vctx3._diagramAppearanceDef.appDefBorderColour(ElemBox(tm.boxA))).toEqual(Just(blue));
  });
});

describe("model links", () => {
  it("finds the ends of an edge", () => {
    const [ends] = edit(tm.st, (c) => edgeLinks(cls, c, "Support", tm.e));
    expect(ends).toEqual([Just([tm.a, Nothing]), Just([tm.b, Nothing])]);
    const [none] = edit(tm.st, (c) => edgeLinks(cls, c, "Support", tm.c));
    expect(none).toEqual([Nothing, Nothing]);
    // With export relations, the export target comes first and the entity second.
    const xcls = { ...cls, arrowHeadExportRelation: () => Just(NR.edgeFromRelation) };
    const [x] = edit(tm.st, (c) => edgeLinks(xcls, c, "Support", tm.e));
    expect(x).toEqual([Just([tm.a, Nothing]), Just([tm.a, Just(tm.b)])]);
  });

  it("knows what can be linked to", () => {
    const ent = (u: ModelId): Entity<TV> => {
      const e = M.lookup(u, tm.st.stateModel.modelContents);
      if (e.tag === "Nothing") throw new Error("missing");
      return e.value;
    };
    expect(isLinkable(cls, ent(tm.dgm))).toBe(true);
    expect(isLinkable(cls, ent(tm.q))).toBe(true);
    expect(isLinkable(cls, ent(tm.a))).toBe(false);
  });

  it("maps model IDs in elements", () => {
    const f = (u: ModelId): Maybe<ModelId> => (u === tm.a ? Just("aa") : u === tm.q ? Just("qq") : Nothing);
    const b = elementMapAvatars(f, ElemBox(tm.boxA));
    expect(b.tag === "ElemBox" && b._0.boxEntity).toBe("aa");
    expect(equals(elementMapAvatars(f, ElemBox(tm.boxB)), ElemBox(tm.boxB))).toBe(true);
    const arrow = Arrow<Toy, TV>("arr", tm.a, "Support",
      LineShape([Connected(P(0, 0), tm.boxA.boxId, Just(tm.a)), Unconnected(P(1, 1))], []));
    const a = elementMapAvatars(f, ElemArrow(arrow));
    if (a.tag !== "ElemArrow") throw new Error("not an arrow");
    expect(a._0.arrowEntity).toBe("aa");
    expect(a._0._arrowShape._lineEnds[0]).toMatchObject({ connectorTarget: tm.boxA.boxId, connectorTargetChild: Just("aa") });
    const l = elementMapAvatars(f, ElemLink(tm.link));
    expect(l.tag === "ElemLink" && view(linkTarget, l._0)).toEqual(Just("qq"));
    expect(elementMapAvatars(f, ElemComment(tm.comment))).toEqual(ElemComment(tm.comment));
  });

  it("selects dialogs for comments and links only", () => {
    const sel = elementDialog<Toy, TV>(cls);
    const title = (e: TE): Maybe<string> => {
      const r = sel(tm.st.stateModel, e);
      return r.tag === "Just" ? Just(r.value.dialogTitle) : Nothing;
    };
    expect(title(ElemComment(tm.comment))).toEqual(Just("Comment"));
    expect(title(ElemLink(tm.link))).toEqual(Just("Diagram Link"));
    expect(title(ElemBox(tm.boxA))).toEqual(Nothing);
    expect(title(ElemArrow(tm.arrowE))).toEqual(Nothing);
  });
});

describe("diagram editing", () => {
  it("uses one cached dictionary for Viewable, Connectable and Avatar", () => {
    expect(Avatar_Element(cls)).toBe(ecls);
    expect(Viewable_Element(cls)).toBe(ecls);
    expect(Connectable_Element(cls)).toBe(ecls);
    expect(ecls.itemType(ElemBox(tm.boxA))).toBe("Toy");
    expect(ecls.ascendedId(ElemBox(tm.boxA))).toEqual(Just(tm.a));
    expect(ecls.ascendedId(ElemArrow(tm.arrowE))).toEqual(Just(tm.e));
    expect(ecls.ascendedId(ElemComment(tm.comment))).toEqual(Nothing);
    expect(ecls.diagramMetadataJ.toJSON(mempty_DiagramAppearance)).toEqual({ arrowNames: null, fields: [], highlights: [] });
    expect(ecls.itemBounds(ElemComment(tm.comment))).toEqual(BB(P(-10, 490), P(210, 570)));
    expect(ecls.itemTouched(ElemBox(tm.boxA), 1, P(50, 25))).toBe(true);
    expect(ecls.itemTouched(ElemArrow(tm.arrowE), 1, P(200, 27))).toBe(true);
    expect(ecls.itemInBox(ElemBox(tm.boxA), BB(P(-1, -1), P(101, 51)))).toBe(true);
    expect(ecls.itemInBox(ElemBox(tm.boxA), BB(P(1, 1), P(101, 51)))).toBe(false);
  });

  it("draws boxes, arrows, comments and links from the model", () => {
    const ed = new Editor(tm.st);
    const svg = (id: DiagramId): string => {
      const v = M.lookup(id, ed.views._0);
      if (v.tag === "Nothing") throw new Error("no view");
      return render(v.value);
    };
    // Box title from boxTypeDraw, with the highlight border; fields from the appearance.
    expect(svg(tm.boxA.boxId)).toContain(">#cc0000<");
    expect(svg(tm.boxA.boxId)).toContain("stroke=\"rgb(204, 0, 0)\"");
    expect(svg(tm.boxA.boxId)).toContain(">A<");
    expect(svg(tm.boxN.boxId)).not.toContain("rgb(204, 0, 0)");
    // Arrow labels are on in the diagram's appearance.
    expect(svg(tm.arrowE.arrowId)).toContain(">E<");
    expect(svg(tm.comment.commentId)).toContain("comment");
    expect(svg(tm.link.linkId)).toContain("➔ Q");
    expect(svg(tm.link.linkId)).toContain("Link text");
  });

  it("describes elements and provides menus", () => {
    const ed = new Editor(tm.st);
    const descs = ed.run(function* (d) {
      const r: string[] = [];
      for (const x of [ElemBox(tm.boxA), ElemArrow(tm.arrowE), ElemComment(tm.comment), ElemLink(tm.link)]) {
        r.push(yield* d.cls.itemDescription(d, x));
      }
      return r;
    });
    expect(descs).toEqual(["A", "E", "comment", "link"]);
    const menu = (id: DiagramId): string[] => {
      const v = M.lookup(id, ed.views._0);
      if (v.tag === "Nothing") throw new Error("no view");
      return menuLabels(v.value.viewMenu(P(150, 25)));
    };
    expect(menu(tm.boxA.boxId)).toEqual(["Properties", "Select in model", "Find in other diagrams", "To front",
      "To back", "Delete from diagram", "Delete from model"]);
    expect(menu(tm.arrowE.arrowId)[0]).toBe("Add bend");
    expect(menu(tm.arrowE.arrowId)).toContain("Delete from model");
    expect(menu(tm.comment.commentId)).toEqual(["Properties", "To top", "To bottom", "Delete"]);
    expect(menu(tm.link.linkId)).toEqual(["Properties", "To top", "To bottom", "Delete"]);
  });

  it("shows deleted link targets and activates links", () => {
    const ed = new Editor(tm.st);
    activations.length = 0;
    ed.apply(Activate, P(310, 510));
    expect(activations).toEqual([Just(tm.q)]);
    expect(ed.checkpoints).toContain("Activated");
    // A link without a target fails with a user error.
    const noTarget = Link(did(), Nothing, CommentBox(BB(P(600, 600), P(700, 650))), "");
    ed.run(function* (d) {
      yield* d.cls.itemView(d, ElemLink(noTarget));
      return null;
    });
    const ed2 = new Editor(tm.st);
    ed2.run(function* (d) {
      d.state = { ...d.state, _deltaDiagram: diagramFromList(HasId_Element, [ElemLink(noTarget)]) };
      yield* tellAll(d);
      return null;
    });
    expect(() => ed2.apply(Activate, P(650, 620))).toThrow(/Link has no target set/);
    // Deleted target.
    const gone = Link(did(), Just(did()), CommentBox(BB(P(0, 0), P(100, 50))), "");
    const v = ed.run(function* (d) {
      return yield* d.cls.itemView(d, ElemLink(gone));
    });
    expect(render(v)).toContain("✘ item deleted");
  });

  it("creates avatars of model entities", () => {
    const ed = new Editor(tm.st);
    const ent = (u: ModelId): Entity<TV> => {
      const e = M.lookup(u, ed.st.stateModel.modelContents);
      if (e.tag === "Nothing") throw new Error("missing");
      return e.value;
    };
    const made = ed.run(function* (d) {
      return [
        yield* ecls.entityAvatar(d, ent(tm.c), P(600, 100)),
        yield* ecls.entityAvatar(d, ent(tm.e), P(600, 400)),
        yield* ecls.entityAvatar(d, ent(tm.dgm), P(600, 600)),
        yield* ecls.entityAvatar(d, ent(tm.pkg), P(600, 600)),
      ];
    });
    const [c, e, dg, pkg] = made;
    expect(c.tag === "Just" && c.value.tag === "ElemBox" && c.value._0.boxType).toBe("Goal");
    expect(c.tag === "Just" && ecls.itemBounds(c.value)).toEqual(BB(P(500, 50), P(700, 150)));
    // The new arrow connects to the nearest existing avatars of its ends.
    if (e.tag !== "Just" || e.value.tag !== "ElemArrow") throw new Error("no arrow");
    const [from, to] = e.value._0._arrowShape._lineEnds;
    expect(from.tag === "Connected" && from.connectorTarget).toBe(tm.boxA.boxId);
    expect(to.tag === "Connected" && to.connectorTarget).toBe(tm.boxB.boxId);
    // A diagram is linkable, so it gets a link box.
    expect(dg.tag === "Just" && dg.value.tag === "ElemLink" && view(linkTarget, dg.value._0)).toEqual(Just(tm.dgm));
    expect(pkg).toEqual(Nothing);
  });

  it("adds new entities with the box tool", () => {
    const ed = new Editor(tm.st);
    const before = ed.items().length;
    ed.script((d) => newBoxEntityTool(cls, d, tm.pkg, Goal("New goal"), "Goal"));
    expect(ed.env.hint).toEqual(Just("Click and drag to define the new shape."));
    ed.apply(Select, P(700, 700));
    expect(ed.items().length).toBe(before + 1);
    const added = ed.items().find((x) => x.tag === "ElemBox" && ecls.itemBounds(x).tag === "BoundBox" &&
      equals(ecls.itemBounds(x), BB(P(600, 650), P(800, 750))));
    expect(added).toBeDefined();
    expect(ed.checkpoints).toContain("Add New goal1 to diagram"); // modelNewName numbers new names.
    expect(ed.env.log).toContain("ScriptProperties");
  });

  it("adds new edges with the arrow tool and links them in the model", () => {
    const ed = new Editor(tm.st);
    ed.script((d) => newArrowEntityTool(cls, d, true, tm.pkg, Edge("Edge"), "Support"));
    ed.drag(P(50, 25), P(350, 325)); // From A to C.
    const arrows = ed.items().filter((x) => x.tag === "ElemArrow" && x._0.arrowId !== tm.arrowE.arrowId);
    expect(arrows.length).toBe(1);
    const arrow = arrows[0];
    if (arrow.tag !== "ElemArrow") throw new Error("not an arrow");
    const [from, to] = arrow._0._arrowShape._lineEnds;
    expect(from.tag === "Connected" && from.connectorTarget).toBe(tm.boxA.boxId);
    expect(to.tag === "Connected" && to.connectorTarget).toBe(tm.boxC.boxId);
    const edge = arrow._0.arrowEntity;
    expect(ed.relation(edge, NR.edgeFromRelation)).toEqual([tm.a]);
    expect(ed.relation(edge, NR.edgeToRelation)).toEqual([tm.c]);
    expect(ed.checkpoints).toContain("Auto-added Arrows package");
    // The edge was created in the "Arrows" package with a fresh name.
    const e = M.lookup(edge, ed.st.stateModel.modelContents);
    if (e.tag === "Nothing") throw new Error("no edge");
    const parent = M.lookup(e.value._entityParent, ed.st.stateModel.modelContents);
    expect(parent.tag === "Just" && view(nameL, parent.value._entityContents)._0).toBe("Arrows");
  });

  it("moves arrow ends and updates the model relations", () => {
    const ed = new Editor(tm.st);
    ed.apply(Select, P(200, 25)); // Select the arrow to get its handles.
    expect(S.toList(deltaStateOf(ed.nxt)._deltaSelection)).toEqual([tm.arrowE.arrowId]);
    // Drag the head handle from B to C.
    const head = (view(lineEnds, (ed.item(tm.arrowE.arrowId) as any)._0._arrowShape) as any)[1].connectorPoint as Point;
    const target = ed.out?.outTransients._0;
    expect(target && M.size(target)).toBeGreaterThan(0);
    const handleView = M.lookup(tm.arrowE.arrowId, ed.out!.outTransients._0);
    if (handleView.tag === "Nothing") throw new Error("no handles");
    const dd: [number, number] = [350 - head._pX, 325 - head._pY];
    const tgt = Just([tm.arrowE.arrowId, handleView.value] as const);
    ed.action(mkAction(Drag<TE>(dd), head, noMod, tgt));
    ed.action(mkAction(EndDrag<TE>(dd), head, noMod, tgt));
    const arrow = ed.item(tm.arrowE.arrowId);
    if (arrow.tag !== "ElemArrow") throw new Error("not an arrow");
    const to = arrow._0._arrowShape._lineEnds[1];
    expect(to.tag === "Connected" && to.connectorTarget).toBe(tm.boxC.boxId);
    expect(ed.relation(tm.e, NR.edgeToRelation)).toEqual([tm.c]);
    expect(ed.relation(tm.e, NR.edgeFromRelation)).toEqual([tm.a]);
  });

  it("updates arrows from the model", () => {
    const ed = new Editor(tm.st);
    // Move the head of E to C in the model, and drop its tail.
    const [, st2] = edit(ed.st, (c) => modifyRelations(c, (r) =>
      NR.insert(tm.e, tm.c, NR.edgeToRelation, NR.delete_(tm.e, tm.b, NR.edgeToRelation, NR.delete_(tm.e, tm.a, NR.edgeFromRelation, r)))));
    ed.st = st2;
    const changed = ed.run((d) => ecls.updateAvatar(d, ed.item(tm.arrowE.arrowId)));
    expect(changed).toBe(true);
    const arrow = ed.item(tm.arrowE.arrowId);
    if (arrow.tag !== "ElemArrow") throw new Error("not an arrow");
    const [from, to] = arrow._0._arrowShape._lineEnds;
    expect(to.tag === "Connected" && to.connectorTarget).toBe(tm.boxC.boxId);
    // The tail is disconnected and pulled back 10% towards the other end.
    expect(from.tag).toBe("Unconnected");
    // Nothing more to do the second time.
    expect(ed.run((d) => ecls.updateAvatar(d, ed.item(tm.arrowE.arrowId)))).toBe(false);
    // An edge whose head is not on the diagram cannot be shown, so its arrow is deleted.
    const [, st3] = edit(ed.st, (c) => modifyRelations(c, (r) => NR.insert(tm.e, tm.n, NR.edgeToRelation,
      NR.delete_(tm.e, tm.c, NR.edgeToRelation, r))));
    ed.st = st3;
    ed.run(function* (d) {
      d.state = { ...d.state, _deltaDiagram: diagramFromList(HasId_Element, ed.items().filter((x) => !(x.tag === "ElemBox" && x._0.boxId === tm.boxN.boxId))) };
      return null;
    });
    expect(ed.run((d) => ecls.updateAvatar(d, ed.item(tm.arrowE.arrowId)))).toBe(true);
    expect(ed.items().some((x) => x.tag === "ElemArrow")).toBe(false);
  });

  it("pegs boxes to arrows and unpegs them", () => {
    const ed = new Editor(tm.st);
    // Drag N (centre 50,325) so that its centre lands near the middle of E (200,25).
    ed.drag(P(50, 325), P(195, 30));
    const pegged = ed.item(tm.boxN.boxId);
    if (pegged.tag !== "ElemBox") throw new Error("not a box");
    expect(pegged._0._boxPeg.tag).toBe("Just");
    const [arrId, f] = (pegged._0._boxPeg as any).value;
    expect(arrId).toBe(tm.arrowE.arrowId);
    expect(f).toBeCloseTo(0.475, 10); // The nearest point on the line, (195, 25).
    expect(ecls.itemBounds(pegged)).toEqual(BB(P(145, 0), P(245, 50))); // Snapped onto the line.
    expect(NR.member(tm.n, tm.e, "Pegged", ed.st.stateModel.modelRelations)).toBe(true);
    expect(ed.run((d) => ecls.itemPegPoint(d, [tm.arrowE.arrowId, 0.5]))).toEqual(Just(P(200, 25)));
    // The relation is removed in the model: the box jumps sideways and is unpegged.
    const [, st2] = edit(ed.st, (c) => modifyRelations(c, (r) => NR.delete_(tm.n, tm.e, "Pegged", r)));
    ed.st = st2;
    expect(ed.run((d) => ecls.updateAvatar(d, ed.item(tm.boxN.boxId)))).toBe(true);
    const jumped = ed.item(tm.boxN.boxId);
    if (jumped.tag !== "ElemBox") throw new Error("not a box");
    expect(jumped._0._boxPeg).toEqual(Nothing);
    const bb = ecls.itemBounds(jumped);
    expect(bb.tag === "BoundBox" && Math.abs(bb._0._pY + 50)).toBeLessThan(1e-9); // 50 up from the line.
    // Peg again, then drag away: the peg and its relation are removed.
    ed.drag(P(200, -25), P(200, 25));
    expect((ed.item(tm.boxN.boxId) as any)._0._boxPeg.tag).toBe("Just");
    expect(NR.member(tm.n, tm.e, "Pegged", ed.st.stateModel.modelRelations)).toBe(true);
    ed.drag(P(200, 25), P(200, 400));
    expect((ed.item(tm.boxN.boxId) as any)._0._boxPeg).toEqual(Nothing);
    expect(NR.member(tm.n, tm.e, "Pegged", ed.st.stateModel.modelRelations)).toBe(false);
  });

  it("moves pegged boxes with their arrows", () => {
    const ed = new Editor(tm.st);
    ed.drag(P(50, 325), P(195, 30));
    // Drag box B down: the arrow follows and the pegged box moves to stay on it.
    ed.drag(P(350, 10), P(350, 210));
    const n = ed.item(tm.boxN.boxId);
    const centre = ecls.itemBounds(n);
    const arrow = ed.item(tm.arrowE.arrowId);
    if (arrow.tag !== "ElemArrow" || centre.tag !== "BoundBox") throw new Error("bad items");
    expect(arrow._0._arrowShape._lineEnds[1].connectorPoint._pY).toBeGreaterThan(200);
    const pt = lineFractionPoint(0.475, arrow._0._arrowShape);
    expect((centre._0._pX + centre._1._pX) / 2).toBeCloseTo(pt._pX, 6);
    expect((centre._0._pY + centre._1._pY) / 2).toBeCloseTo(pt._pY, 6);
  });

  it("adds, resizes and edits comments", () => {
    const ed = new Editor(tm.st, newEnv((v) => Just([Nothing, "New comment"])));
    ed.action(newCommentTool<Toy, TV>());
    ed.apply(Select, P(700, 300));
    const c = ed.items().find((x) => x.tag === "ElemComment" && x._0._commentText === "New comment");
    if (c === undefined || c.tag !== "ElemComment") throw new Error("no comment");
    expect(c._0._commentShape).toEqual(CommentBox(BB(P(600, 250), P(800, 350))));
    expect(ed.checkpoints).toContain("Add comment to diagram");
    const resized = ed.run((d) => ecls.itemResize(d, [100, 60], c));
    expect(resized.tag === "ElemComment" && resized._0._commentShape).toEqual(CommentBox(BB(P(660, 280), P(740, 320))));
    // Double-clicking a comment asks for its properties.
    ed.apply(Activate, P(650, 290));
    expect(ed.out?.outProperties.length).toBe(1);
    expect(ed.out?.outProperties[0].tag).toBe("ElemComment");
    // Arrows cannot be resized.
    const a = ElemArrow(tm.arrowE);
    expect(ed.run((d) => ecls.itemResize(d, [1, 1], a))).toBe(a);
  });

  it("lays out comment graphics, including undecodable ones", () => {
    const ed = new Editor(tm.st);
    const draw = (g: Maybe<Graphic>): string => render(ed.run((d) =>
      ecls.itemView(d, ElemComment(Comment(did(), CommentBox(BB(P(0, 0), P(300, 300))), g, "Caption")))));
    /** The y coordinate of the caption text. */
    const captionY = (svg: string): number => {
      const m = /<text[^>]*\by="([-\d.]+)"[^>]*>Caption</.exec(svg);
      if (m === null) throw new Error("no caption in " + svg);
      return Number(m[1]);
    };
    const plain = draw(Nothing);
    // Raw JSON that could not be decoded is kept, and its error message is shown between rules.
    const bad = JSON_Graphic.parseJSON({ svg: "not svg" });
    const withError = draw(Just(bad));
    expect(withError).toContain("Error during image decoding.");
    expect(captionY(withError)).toBeGreaterThan(captionY(plain));
    // An SVG reserves its height (it is drawn once the browser has loaded it).
    const svg = JSON_Graphic.parseJSON({ svg: "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'/>" });
    expect(captionY(draw(Just(svg))) - captionY(plain)).toBeCloseTo(80, 0);
    // A pixel image takes no space until it has loaded; one that the browser cannot decode is
    // shown with the message GdkPixbuf's GError gives in the Haskell program.
    const px = JSON_Graphic.parseJSON({ image: base64Encode(Uint8Array.from([1, 2, 3])) });
    if (px.tag !== "PixelGraphic") throw new Error("not a pixel graphic");
    expect(draw(Just(px))).not.toContain("Error during image decoding.");
    expect(captionY(draw(Just(px)))).toBe(captionY(plain));
    px._1.failed = true;
    expect(draw(Just(px))).toContain("Error during image decoding.");
    // A loaded image consumes its height, scaled down to the available width (300 of 560).
    const big = JSON_Graphic.parseJSON({ image: base64Encode(Uint8Array.from([4, 5, 6])) });
    if (big.tag !== "PixelGraphic") throw new Error("not a pixel graphic");
    Object.assign(big._1, { loaded: true, width: 560, height: 100 });
    expect(captionY(draw(Just(big))) - captionY(plain)).toBeCloseTo(100 * 300 / 560, 1);
  });

  it("connects arrows only where the diagram type allows", () => {
    const ed = new Editor(tm.st);
    const r = ed.run(function* (d) {
      return [
        yield* ecls.itemCanConnect(d, "ConnectionTo", ElemArrow(tm.arrowE), ElemBox(tm.boxA), Nothing),
        yield* ecls.itemCanConnect(d, "ConnectionTo", ElemArrow(tm.arrowE), ElemBox(tm.boxN), Nothing),
        yield* ecls.itemCanConnect(d, "ConnectionTo", ElemBox(tm.boxA), ElemBox(tm.boxB), Nothing),
        yield* ecls.itemCanConnect(d, "ConnectionTo", ElemArrow(tm.arrowE), ElemComment(tm.comment), Nothing),
      ];
    });
    expect(r).toEqual([true, false, false, false]);
  });
});
