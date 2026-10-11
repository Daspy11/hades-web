/**
 * Scratch demo for `Evidence.Model` and `App.Appearance` (open the app with `?demo=ev`).
 *
 * A drawing area shows entity boxes from a small model, each rendered with a different
 * "DiagramAppearance": the default (description only), outdented labels, fields above their
 * values, unlabelled fields with icons and colours, evidence boxes (`drawEvidence`) with a
 * highlight border, and trace arrows (`traceArrowHead`, `traceArrowDash`). The fields include
 * an enumeration with colours, a decorated Boolean with icons and colours, and a field with a
 * non-ASCII name and value (Pango attribute indices are UTF-8 byte offsets).
 *
 * The buttons open the diagram and package appearance dialogs; the last box ("User style")
 * shows the cascade of the two (`diagram <> package`), and arrow labels follow its "Show arrow
 * labels" setting. `&dialog=diagram` or `&dialog=package` opens a dialog at start-up.
 */
import * as Gtk from "@/lib/GI/Gtk";
import * as Gdk from "@/lib/GI/Gdk";
import * as Cairo from "@/lib/GI/Cairo";
import * as Pango from "@/lib/GI/Pango";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { identity, lens, prism, set, view, type Prism } from "@/lib/Control/Lens";
import { getDataDir } from "@/lib/System/Paths";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { setDataIconTheme } from "@/banana-ui/gtk/src/Reactive/Banana/GI/DataIconTheme";
import { runDialog } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import { BoundBox, Point } from "@/hades/src/Hades/Abstract/Geometry";
import { BoxShapeClass_Rectangle, Rectangle, rectangleCorners } from "@/hades/src/Hades/Abstract/BasicShapes";
import {
  type HadesLayout, type HadesRender, drawPolyLine, drawPolygon, hadesConfig, layoutParagraphGap, layoutText,
  layoutTitle, renderWithHades, runLayout_, withLineColour,
} from "@/hades/src/Hades/GI/BasicShapes";
import {
  type Entity, type Model, type ModelId, Name, Package, descriptionField, emptyModel, evalModelEdit, goToEntity,
  mkEntity, mkPackage, modelStartState, nameField, runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { extract } from "@/hades/src/Model/Reflection/Reflective";
import {
  BuiltInDef, DecoBool, DecoBoolDef, EnumDef, EnumItem, Field, type FieldId,
} from "@/hades/src/Model/Reflection/Types";
import { ExtBool, ExtText, _ExtText, type ExtensionValues } from "@/hades/src/Model/Reflection/Values";
import * as U from "@/lib/Data/UUID";
import {
  Evidence, Trace, drawEvidence, evidenceVariant, traceArrowDash, traceArrowHead, traceVariant,
} from "@/hades/evidence/Evidence/Model";
import {
  type AppearanceDialogClass, type DiagramAppearance, type EntityShowField, type PackageAppearance,
  DiagramAppearance as mkDA, EntityShowField as ESF, EntityShowFields, FieldStyleAbove, FieldStyleNone,
  FieldStyleOutdent, append_DiagramAppearance, coerceDiagramAppearance, diagramAppearanceClean,
  diagramAppearanceDialog, diagramLayout, mempty_DiagramAppearance, packageAppearanceClean,
  packageAppearanceDialog,
} from "@/hades/src/App/Appearance";

// ---------------------------------------------------------------------------------------------
// A small model: packages, items with descriptions, evidence and traces.

type TV =
  | { readonly tag: "P"; readonly _0: Package<TV, null> }
  | { readonly tag: "I"; readonly _0: Name; readonly desc: string }
  | { readonly tag: "E"; readonly _0: Evidence }
  | { readonly tag: "T"; readonly _0: Trace };

const tvName = lens(
  (v: TV): Name => (v.tag === "P" ? v._0._packageName : v.tag === "I" ? v._0 : v.tag === "E" ? v._0._evidenceName : v._0._traceName),
  (v: TV, n: Name): TV => (v.tag === "P" ? { tag: "P", _0: { ...v._0, _packageName: n } }
    : v.tag === "I" ? { ...v, _0: n } : v.tag === "E" ? { tag: "E", _0: Evidence(n) } : { tag: "T", _0: Trace(n) }),
);
const _P: Prism<TV, Package<TV, null>> = prism((p: Package<TV, null>): TV => ({ tag: "P", _0: p }),
  (v: TV) => (v.tag === "P" ? Right(v._0) : Left(v)));

const cls: AppearanceDialogClass<HadesRender, TV> = {
  reflectiveName: (v) => (v.tag === "P" ? "Package" : v.tag === "I" ? "Item" : v.tag === "E" ? evidenceVariant : traceVariant),
  variantUserLabel: (v) => v,
  reflectiveDefaults: [
    { tag: "P", _0: Package(Name(""), null) }, { tag: "I", _0: Name(""), desc: "" },
    { tag: "E", _0: Evidence(Name("")) }, { tag: "T", _0: Trace(Name("")) },
  ],
  reflectiveBuiltIn: (v) => (v.tag === "I" ? [nameField, descriptionField] : [nameField]),
  reflectiveGet: (v) => v.tag === "I"
    ? M.fromList([[nameField, ExtText(v._0._0)], [descriptionField, ExtText(v.desc)]])
    : M.singleton(nameField, ExtText(view(tvName, v)._0)),
  reflectiveSet: (st, v) => {
    const v2 = set(tvName, Name(extract(st, view(tvName, v)._0, _ExtText, nameField)), v);
    return v2.tag === "I" ? { ...v2, desc: extract(st, v2.desc, _ExtText, descriptionField) } : v2;
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: tvName,
  _Package: _P,
  entityCanHaveChild: (p) => p.tag === "P",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(() => null, () => J.fail("unused")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
  isDiagram: () => false,
  getDiagramWrapper: () => Nothing,
  diagramEntityTypes: M.fromList([
    ["Item Diagram", ["Item", "Evidence"]],
    ["Evidence Diagram", ["Evidence"]],
  ]),
  diagramMapAvatars: (_f, e) => e,
  _QueryDiagram: prism((q: never) => q, (v: TV) => Left(v)),
  queryAvatars: () => [],
};

const fid = (n: number): FieldId => U.fromWords(0x5eed, 0, 0, n);
const fStatus = fid(1), fVerified = fid(2), fSize = fid(3), fAuthor = fid(4);
const green = Colour(C.sRGB24(78, 154, 6)), red = Colour(C.sRGB24(204, 0, 0));
const amber = Colour(C.sRGB24(252, 233, 79)), blue = Colour(C.sRGB24(32, 74, 135));

interface Ids { a: ModelId; b: ModelId; e1: ModelId; e2: ModelId }

function buildModel(): [Model<TV>, Ids] {
  const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), emptyModel(cls, "Demo")), (c) => {
    const pkg = mkPackage(c, Name("Safety case"));
    goToEntity(c, pkg);
    const a = mkEntity(c, { tag: "I", _0: Name("Hazard H1"), desc: "Loss of braking on wet rails.\n\nMitigated by sanding." }).entityId;
    const b = mkEntity(c, { tag: "I", _0: Name("Hazard H2"), desc: "Door opens while moving." }).entityId;
    const e1 = mkEntity(c, { tag: "E", _0: Evidence(Name("Brake test report")) }).entityId;
    const e2 = mkEntity(c, { tag: "E", _0: Evidence(Name("Field data")) }).entityId;
    return { a, b, e1, e2 };
  });
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  const m0 = r.value[0].updateNewModel;
  const ids = r.value[0].updateValue;
  const exts = new Map<ModelId, ExtensionValues>([
    [ids.a, M.fromList([[fStatus, ExtText("Closed")], [fVerified, ExtBool(true)], [fSize, ExtText("Groß")], [fAuthor, ExtText("Zoë Brontë")]])],
    [ids.b, M.fromList([[fStatus, ExtText("Open")], [fVerified, ExtBool(false)], [fAuthor, ExtText("Ann")]])],
    [ids.e1, M.fromList([[fStatus, ExtText("Review")], [fVerified, ExtBool(true)], [fAuthor, ExtText("Paul")]])],
    [ids.e2, M.fromList([[fVerified, ExtBool(false)], [fSize, ExtText("Übergröße")]])],
  ]);
  let contents = m0.modelContents;
  for (const [k, v] of exts) contents = M.adjust((e: Entity<TV>) => ({ ...e, _entityExtensions: v }), k, contents);
  const ext = [fStatus, fVerified, fSize, fAuthor];
  return [{
    ...m0,
    modelContents: contents,
    modelFields: M.fromList([
      [fStatus, Field(false, fStatus, "Status", "One", EnumDef([
        EnumItem("Open", Just("general-warning"), Just(red)),
        EnumItem("Review", Nothing, Just(amber)),
        EnumItem("Closed", Just("general-tick"), Just(green)),
      ]))],
      [fVerified, Field(false, fVerified, "Verified", "One",
        DecoBoolDef(DecoBool(Just(["general-cross", "general-tick"]), Just([red, green]))))],
      [fSize, Field(false, fSize, "Größe", "One", BuiltInDef("ModelText"))],
      [fAuthor, Field(false, fAuthor, "Author", "One", BuiltInDef("ModelText"))],
    ]),
    modelExtensions: M.fromList([["Item", ext], ["Evidence", ext]]),
  }, ids];
}

// ---------------------------------------------------------------------------------------------

const box = (x1: number, y1: number, x2: number, y2: number): BoundBox => BoundBox(Point(x1, y1), Point(x2, y2));
const shown = (variant: string, fs: readonly EntityShowField[]): DiagramAppearance<null, TV> =>
  mkDA(Nothing, EntityShowFields([[variant, fs]]), []);

export function main(): void {
  const params = new URLSearchParams(location.search);
  // The data icon theme, as Main.hs of the DSM sets it up.
  const dataTheme = Gtk.iconThemeNew();
  Gtk.iconThemeSetCustomTheme(dataTheme, "Diametric");
  Gtk.iconThemeSetSearchPath(dataTheme, [getDataDir("dsm")]);
  setDataIconTheme(dataTheme);
  const style = hadesConfig(dataTheme);
  const theme = Gtk.iconThemeGetDefault();
  const [model, ids] = buildModel();

  let userDiagram: DiagramAppearance<null, TV> = mkDA(Just(true), EntityShowFields([
    ["Item", [ESF(FieldStyleAbove, fStatus), ESF(FieldStyleNone, descriptionField)]],
  ]), [[ids.e1, blue]]);
  let userPackage: PackageAppearance<TV> = M.singleton("Item Diagram", mkDA<null, TV>(Nothing, EntityShowFields([
    ["Evidence", [ESF(FieldStyleOutdent, fAuthor)]],
  ]), []));

  const win = Gtk.applicationWindowNew(null);
  Gtk.windowSetTitle(win, "Evidence and Appearance demo");
  const vbox = Gtk.boxNew(Gtk.OrientationVertical, 0);
  const bar = Gtk.boxNew(Gtk.OrientationHorizontal, 6);
  Gtk.containerSetBorderWidth(bar, 6);
  const diagramButton = Gtk.buttonNewWithLabel("Diagram style…");
  const packageButton = Gtk.buttonNewWithLabel("Package style…");
  const status = Gtk.labelNew("");
  Gtk.boxPackStart(bar, diagramButton, false, false, 0);
  Gtk.boxPackStart(bar, packageButton, false, false, 0);
  Gtk.boxPackStart(bar, status, false, false, 6);
  const da = Gtk.drawingAreaNew();
  Gtk.styleContextAddClass(Gtk.widgetGetStyleContext(da), "hades-diagram");
  Gtk.widgetSetVexpand(da, true);
  Gtk.boxPackStart(vbox, bar, false, false, 0);
  Gtk.boxPackStart(vbox, da, true, true, 0);
  Gtk.containerAdd(win, vbox);

  const showStatus = (): void => {
    const eff = effective();
    Gtk.labelSetText(status, "User style: arrow labels " +
      (eff._arrowLabels.tag === "Just" ? String(eff._arrowLabels.value) : "unset") +
      ", " + eff._entityShowFields._fieldsShown.map(([v, fs]) => `${v} (${fs.length})`).join(", ") +
      ", " + eff._highlights.length + " highlight(s)");
  };
  /** The cascade: diagram appearance, then the package's appearance for the diagram type. */
  const effective = (): DiagramAppearance<null, TV> => append_DiagramAppearance(
    userDiagram,
    coerceDiagramAppearance(M.findWithDefault(mempty_DiagramAppearance, "Item Diagram", userPackage)),
  );

  /** The contents layout of an entity under an appearance (`diagramLayout` in the ModelEdit monad). */
  const contentsOf = (uuid: ModelId, appearance: DiagramAppearance<null, TV>): HadesLayout => {
    const r = evalModelEdit(cls, identity<TV>(), model, (c) => {
      goToEntity(c, uuid);
      return diagramLayout(c, appearance._entityShowFields);
    });
    if (r.tag === "Left") throw new Error(show_ModelError(r.value));
    return r.value;
  };
  const entityOf = (uuid: ModelId): Entity<TV> => {
    const e = M.lookup(uuid, model.modelContents);
    if (e.tag === "Nothing") throw new Error("missing entity");
    return e.value;
  };
  /** A plain item box: outline, bold title, then the appearance's fields. */
  const itemBox = (uuid: ModelId, appearance: DiagramAppearance<null, TV>, b: BoundBox, border: Maybe<Colour>): HadesRender => (env) => {
    const outline = drawPolygon(rectangleCorners(Rectangle(b)));
    (border.tag === "Just" ? withLineColour(border.value, outline) : outline)(env);
    const contents = contentsOf(uuid, appearance);
    runLayout_(BoxShapeClass_Rectangle.shapeInnerBox(Rectangle(b)), (e, st) => {
      layoutTitle(Nothing, view(tvName, entityOf(uuid)._entityContents)._0)(e, st);
      layoutParagraphGap(e, st);
      contents(e, st);
    })(env);
  };
  const evidenceBox = (uuid: ModelId, appearance: DiagramAppearance<null, TV>, b: BoundBox, border: Maybe<Colour>): HadesRender =>
    (env) => drawEvidence(cls, Just(entityOf(uuid)), contentsOf(uuid, appearance), border, b)(env);
  const caption = (x: number, y: number, txt: string): HadesRender => (env) =>
    runLayout_(box(x, y, x + 230, y + 30), layoutText([(l) => () => {
      Pango.layoutSetAlignment(l, Pango.AlignmentCenter);
      const attrs = Pango.attrListNew();
      Pango.attrListInsert(attrs, Pango.attrForegroundNew(0x5555, 0x5555, 0x5555));
      Pango.layoutSetAttributes(l, attrs);
    }], txt))(env);

  const allFields = [fStatus, fVerified, fSize, fAuthor];
  const picture: HadesRender = (env) => {
    // Row 1: items under different appearances.
    itemBox(ids.a, mempty_DiagramAppearance, box(20, 20, 250, 190), Nothing)(env);
    caption(20, 195, "mempty: the description only")(env);
    itemBox(ids.a, shown("Item", allFields.map((f) => ESF(FieldStyleOutdent, f))), box(280, 20, 510, 190), Nothing)(env);
    caption(280, 195, "FieldStyleOutdent (non-ASCII \"Größe\")")(env);
    itemBox(ids.a, shown("Item", [ESF(FieldStyleAbove, fStatus), ESF(FieldStyleAbove, fSize), ESF(FieldStyleAbove, descriptionField)]),
      box(540, 20, 770, 190), Nothing)(env);
    caption(540, 195, "FieldStyleAbove")(env);
    itemBox(ids.b, shown("Item", [ESF(FieldStyleNone, fStatus), ESF(FieldStyleNone, fVerified), ESF(FieldStyleNone, fAuthor)]),
      box(800, 20, 1030, 190), Nothing)(env);
    caption(800, 195, "FieldStyleNone with icons and colours")(env);
    itemBox(ids.b, shown("Item", [ESF(FieldStyleOutdent, fStatus), ESF(FieldStyleOutdent, fVerified), ESF(FieldStyleOutdent, fSize)]),
      box(1060, 20, 1290, 190), Nothing)(env);
    caption(1060, 195, "Outdent: icons beside the label")(env);

    // Row 2: evidence boxes, the user style, and trace arrows.
    const evAppearance = shown("Evidence", [ESF(FieldStyleOutdent, fStatus), ESF(FieldStyleOutdent, fVerified), ESF(FieldStyleOutdent, fAuthor)]);
    evidenceBox(ids.e1, evAppearance, box(280, 300, 510, 440), Just(blue))(env);
    caption(280, 445, "drawEvidence, highlight border")(env);
    evidenceBox(ids.e2, shown("Evidence", [ESF(FieldStyleNone, fVerified), ESF(FieldStyleAbove, fSize)]), box(540, 300, 770, 440), Nothing)(env);
    caption(540, 445, "drawEvidence, default border")(env);
    const eff = effective();
    const hl = eff._highlights.length > 0 ? Just(eff._highlights[0][1]) : Nothing;
    itemBox(ids.a, eff, box(20, 300, 250, 470), hl)(env);
    caption(20, 475, "User style (diagram <> package)")(env);
    evidenceBox(ids.e1, eff, box(800, 300, 1030, 440), Nothing)(env);
    caption(800, 445, "User style on evidence")(env);
    const label = (t: string): Maybe<string> => (eff._arrowLabels.tag === "Just" && eff._arrowLabels.value ? Just(t) : Nothing);
    drawPolyLine(traceArrowHead, traceArrowDash, Point(250, 385), [], Point(280, 370), label("Trace"))(env);
    drawPolyLine(traceArrowHead, traceArrowDash, Point(395, 190), [], Point(395, 300), label("Trace 1"))(env);
    drawPolyLine(traceArrowHead, traceArrowDash, Point(915, 190), [Point(915, 250), Point(655, 250)], Point(655, 300), label("Trace 2"))(env);
  };

  Gtk.onWidgetDraw(da, (cr: Cairo.Context) => {
    Gtk.renderBackground(Gtk.widgetGetStyleContext(da), cr, 0, 0, 4000, 4000);
    renderWithHades(cr, style, picture);
    return true;
  });
  Gdk.onImagesLoaded(() => Gtk.widgetQueueDraw(da));

  const openDiagramDialog = async (): Promise<void> => {
    const r = await runDialog(win, theme, diagramAppearanceDialog<HadesRender, TV, never, null>(cls, "Item Diagram"), model, userDiagram);
    if (r.tag === "Just") userDiagram = diagramAppearanceClean(r.value);
    showStatus();
    Gtk.widgetQueueDraw(da);
  };
  const openPackageDialog = async (): Promise<void> => {
    const r = await runDialog(win, theme, packageAppearanceDialog<HadesRender, TV, never>(cls), model, userPackage);
    if (r.tag === "Just") userPackage = packageAppearanceClean(r.value);
    showStatus();
    Gtk.widgetQueueDraw(da);
  };
  Gtk.onButtonClicked(diagramButton, () => void openDiagramDialog());
  Gtk.onButtonClicked(packageButton, () => void openPackageDialog());
  showStatus();
  Gtk.windowPresent(win);
  Gtk.main();
  if (params.get("dialog") === "diagram") void openDiagramDialog();
  if (params.get("dialog") === "package") void openPackageDialog();
}
