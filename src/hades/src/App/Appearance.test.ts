import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as U from "@/lib/Data/UUID";
import * as C from "@/lib/Data/Colour";
import * as Cairo from "@/lib/GI/Cairo";
import * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { identity, lens, prism, review, set, view, type Prism } from "@/lib/Control/Lens";
import { showGadget } from "@/banana-ui/base/Reactive/Banana/ArrowDialog";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { contrastText } from "@/banana-ui/gtk/src/Reactive/Banana/GI/Common";
import { BoundBox, Point } from "@/hades/src/Hades/Abstract/Geometry";
import { hadesConfig, runLayout_ } from "@/hades/src/Hades/GI/BasicShapes";
import {
  type Entity, type EntityClass, type Model, type ModelEditCtx, type ModelId, Name, Package, descriptionField,
  emptyModel, evalModelEdit, goToEntity, goToRoot, mkEntity, mkPackage, modelStartState, nameField, nameText,
  runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { extract } from "@/hades/src/Model/Reflection/Reflective";
import {
  BuiltInDef, DecoBool, DecoBoolDef, EnumDef, EnumItem, Field, migrateField, type FieldId,
} from "@/hades/src/Model/Reflection/Types";
import { ExtBool, ExtText, Variant, _ExtText, type ExtensionValues } from "@/hades/src/Model/Reflection/Values";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type AppearanceDialogClass, type DiagramAppearance, type PackageAppearance,
  DiagramAppearance as mkDA, EntityShowField, EntityShowFields, FieldStyleAbove, FieldStyleNone, FieldStyleOutdent,
  JSON_DiagramAppearance, JSON_EntityShowField, JSON_EntityShowFields, JSON_FieldStyle, JSON_PackageAppearance,
  append_DiagramAppearance, append_EntityShowFields, arrowLabels, cloneDiagramAppearance, clonePackageAppearance,
  coerceDiagramAppearance, colourForFont, colourText, diagramAppearanceClean, diagramAppearanceDialog,
  diagramLayout, entityShowFieldId, entityShowFieldStyle, entityShowFields, fieldStyleValues, fieldsShown,
  fieldsShownMap, highlightIso, highlights, labelledFieldAttributes, mconcat_DiagramAppearance,
  mempty_DiagramAppearance, mempty_EntityShowFields, packageAppearanceClean, packageAppearanceDialog,
  showFieldsClean, show_DiagramAppearance, show_EntityShowField, show_EntityShowFields, styleName, uniqueVariants,
} from "./Appearance";

const id = (n: number): U.UUID => U.fromWords(0, 0, 0, n);
const fsf = (style: typeof FieldStyleNone, fid: FieldId) => EntityShowField(style, fid);

// ---------------------------------------------------------------------------------------------
// JSON

describe("FieldStyle", () => {
  it("encodes as aeson does", () => {
    expect(fieldStyleValues.map((s) => JSON_FieldStyle.toJSON(s))).toEqual(["None", "Outdent", "Above"]);
    expect(J.parseEither((v) => JSON_FieldStyle.parseJSON(v), "Above")).toEqual(Right(FieldStyleAbove));
  });
  it("rejects other values with the Haskell messages", () => {
    expect(J.parseEither((v) => JSON_FieldStyle.parseJSON(v), "Outdented"))
      .toEqual(Left('Unrecognised FieldNameStyle: "Outdented"'));
    const r = J.parseEither((v) => JSON_FieldStyle.parseJSON(v), 3);
    expect(r.tag).toBe("Left");
    expect(r.tag === "Left" && r.value).toMatch(/expected FieldNameStyle, but encountered Number/);
  });
  it("has the dialog names", () => {
    expect(fieldStyleValues.map((s) => view(styleName, s))).toEqual(["None", "Outdented", "Above"]);
    expect(review(styleName, "Above")).toBe(FieldStyleAbove);
    expect(review(styleName, "Outdented")).toBe(FieldStyleOutdent);
    expect(review(styleName, "Outdent")).toBe(FieldStyleNone);
  });
});

describe("EntityShowField", () => {
  it("round trips through JSON and migrates old field names", () => {
    const f = fsf(FieldStyleOutdent, id(7));
    const js = JSON_EntityShowField.toJSON(f);
    expect(js).toEqual({ style: "Outdent", field: id(7) });
    expect(JSON_EntityShowField.parseJSON(js)).toEqual(f);
    expect(JSON_EntityShowField.parseJSON({ style: "None", name: "Description" }))
      .toEqual(fsf(FieldStyleNone, migrateField("Description")));
    // The "Description" migration is the built-in description field.
    expect(migrateField("Description")).toBe(descriptionField);
  });
  it("has lenses and Show", () => {
    const f = fsf(FieldStyleNone, id(1));
    expect(view(entityShowFieldStyle, set(entityShowFieldStyle, FieldStyleAbove, f))).toBe(FieldStyleAbove);
    expect(view(entityShowFieldId, set(entityShowFieldId, id(2), f))).toBe(id(2));
    expect(show_EntityShowField(f)).toBe(
      "EntityShowField {_entityShowFieldStyle = FieldStyleNone, _entityShowFieldId = 00000000-0000-0000-0000-000000000001}");
    expect(show_EntityShowFields(EntityShowFields([["Goal", [f]]]))).toBe(
      "EntityShowFields {_fieldsShown = [(Goal,[" + show_EntityShowField(f) + "])]}");
  });
});

describe("EntityShowFields", () => {
  const a = fsf(FieldStyleNone, id(1)), b = fsf(FieldStyleOutdent, id(2)), c = fsf(FieldStyleAbove, id(3));
  it("is a left-biased monoid that does not concatenate the field lists", () => {
    const f1 = EntityShowFields([["Goal", [a]], ["Context", [b]]]);
    const f2 = EntityShowFields([["Goal", [c]], ["Assumption", [b, c]]]);
    expect(append_EntityShowFields(f1, f2)).toEqual(
      EntityShowFields([["Assumption", [b, c]], ["Context", [b]], ["Goal", [a]]]));
    expect(append_EntityShowFields(mempty_EntityShowFields, f2)).toEqual(
      EntityShowFields([["Assumption", [b, c]], ["Goal", [c]]]));
  });
  it("cleans duplicates and blank keys, keeping the field order", () => {
    const f = EntityShowFields([["Goal", [a]], ["", [b]], ["Context", [b]], ["Goal", [c, b]]]);
    expect(showFieldsClean(f)).toEqual(EntityShowFields([["Context", [b]], ["Goal", [a, c, b]]]));
    expect(fieldsShownMap(f)).toEqual(M.fromList([["", [b]], ["Context", [b]], ["Goal", [c, b]]]));
    expect(view(fieldsShown(), f)).toBe(f._fieldsShown);
  });
  it("reads the list format and the older map format", () => {
    const f = EntityShowFields([["Goal", [a]], ["Context", [b, c]]]);
    const js = JSON_EntityShowFields.toJSON(f);
    expect(js).toEqual([
      ["Goal", [{ style: "None", field: id(1) }]],
      ["Context", [{ style: "Outdent", field: id(2) }, { style: "Above", field: id(3) }]],
    ]);
    expect(JSON_EntityShowFields.parseJSON(js)).toEqual(f);
    const old = { Goal: [{ style: "None", field: id(1) }], Context: [{ style: "Outdent", name: "Description" }] };
    expect(JSON_EntityShowFields.parseJSON(old)).toEqual(
      EntityShowFields([["Context", [fsf(FieldStyleOutdent, descriptionField)]], ["Goal", [a]]]));
    expect(() => JSON_EntityShowFields.parseJSON("x")).toThrow();
  });
});

describe("DiagramAppearance", () => {
  const red = Colour(C.sRGB24(255, 0, 0)), blue = Colour(C.sRGB24(0, 0, 255));
  const f1 = EntityShowFields([["Goal", [fsf(FieldStyleNone, id(1))]]]);
  const f2 = EntityShowFields([["Goal", [fsf(FieldStyleAbove, id(2))]], ["Context", []]]);
  const d1 = mkDA(Nothing, f1, [[id(10), red]]);
  const d2 = mkDA(Just(true), f2, [[id(11), blue]]);

  it("combines left-biased", () => {
    const d = append_DiagramAppearance(d1, d2);
    expect(d._arrowLabels).toEqual(Just(true));
    expect(d._entityShowFields).toEqual(append_EntityShowFields(f1, f2));
    expect(d._highlights).toEqual([[id(10), red], [id(11), blue]]);
    expect(append_DiagramAppearance(mkDA(Just(false), f1, []), d2)._arrowLabels).toEqual(Just(false));
    expect(append_DiagramAppearance(mempty_DiagramAppearance, d1)).toEqual(d1);
    expect(append_DiagramAppearance(d1, mempty_DiagramAppearance)).toEqual(d1);
    expect(mconcat_DiagramAppearance([d1, d2, mempty_DiagramAppearance])).toEqual(d);
  });
  it("encodes as aeson does", () => {
    expect(JSON_DiagramAppearance.toJSON(d1)).toEqual({
      arrowNames: null,
      fields: [["Goal", [{ style: "None", field: id(1) }]]],
      highlights: [[id(10), "#ff0000"]],
    });
    expect(JSON_DiagramAppearance.parseJSON(JSON_DiagramAppearance.toJSON(d2))).toEqual(d2);
    // "fields" is optional, "highlights" is not.
    expect(JSON_DiagramAppearance.parseJSON({ highlights: [] })).toEqual(mempty_DiagramAppearance);
    expect(() => JSON_DiagramAppearance.parseJSON({ arrowNames: true })).toThrow();
  });
  it("has lenses, clone, coerce and clean", () => {
    expect(view(arrowLabels(), set(arrowLabels(), Just(false), d1))).toEqual(Just(false));
    expect(view(entityShowFields(), set(entityShowFields(), f2, d1))).toBe(f2);
    expect(view(highlights(), d1)).toEqual([[id(10), red]]);
    const cloned = cloneDiagramAppearance((q) => (q === id(10) ? Just(id(20)) : Nothing), append_DiagramAppearance(d1, d2));
    expect(cloned._highlights).toEqual([[id(20), red], [id(11), blue]]);
    expect(coerceDiagramAppearance(d2)).toEqual(d2);
    const dirty = mkDA(Nothing, EntityShowFields([["", []], ["Goal", [fsf(FieldStyleNone, id(1))]], ["Goal", [fsf(FieldStyleAbove, id(2))]]]), []);
    expect(diagramAppearanceClean(dirty)._entityShowFields).toEqual(
      EntityShowFields([["Goal", [fsf(FieldStyleNone, id(1)), fsf(FieldStyleAbove, id(2))]]]));
  });
  it("has the derived Show", () => {
    expect(show_DiagramAppearance(mempty_DiagramAppearance)).toBe(
      "DiagramAppearance {_arrowLabels = Nothing, _entityShowFields = EntityShowFields {_fieldsShown = []}, _highlights = []}");
    expect(show_DiagramAppearance(append_DiagramAppearance(d2, d1))).toBe(
      "DiagramAppearance {_arrowLabels = Just True, _entityShowFields = " +
      show_EntityShowFields(append_EntityShowFields(f2, f1)) +
      ", _highlights = [(00000000-0000-0000-0000-00000000000b,#0000ff),(00000000-0000-0000-0000-00000000000a,#ff0000)]}");
    expect(show_DiagramAppearance(mkDA(Just(false), mempty_EntityShowFields, []))).toMatch(/^DiagramAppearance \{_arrowLabels = Just False,/);
  });
  it("shows the highlights in a table with a blank row", () => {
    const black = Colour(C.black);
    const rows = view(highlightIso, [[id(1), red], [id(2), blue]] as const);
    expect(rows).toEqual([[S.singleton(id(1)), red], [S.singleton(id(2)), blue], [S.empty(), black]]);
    // The blank row is dropped, a new row with a query is kept.
    expect(review(highlightIso, [...rows, [S.fromList([id(5), id(3)]), black]])).toEqual(
      [[id(1), red], [id(2), blue], [id(3), black]]);
  });
});

describe("PackageAppearance", () => {
  const red = Colour(C.sRGB24(255, 0, 0));
  const pa: PackageAppearance<unknown> = M.fromList([
    ["GSN Diagram", mkDA<null>(Nothing, EntityShowFields([["", []]]), [[id(1), red]])],
    ["Bow Tie Diagram", mkDA<null>(Just(false), mempty_EntityShowFields, [[id(2), red]])],
  ]);
  it("clones and cleans each diagram type", () => {
    const c = clonePackageAppearance((m) => (m === id(1) ? Just(id(9)) : Nothing), pa);
    expect(M.toList(c).map(([k, v]) => [k, v._highlights])).toEqual([
      ["Bow Tie Diagram", [[id(2), red]]],
      ["GSN Diagram", [[id(9), red]]],
    ]);
    expect(M.toList(packageAppearanceClean(pa)).map(([k, v]) => [k, v._entityShowFields])).toEqual([
      ["Bow Tie Diagram", mempty_EntityShowFields],
      ["GSN Diagram", mempty_EntityShowFields],
    ]);
  });
});

describe("appearances in the example files", () => {
  const examplesDir = path.resolve(__dirname, "../../../dsm/share/examples");
  const found: { file: string; key: string; value: J.JSONObject }[] = [];
  const walk = (file: string, v: unknown, key: string): void => {
    if (v === null || typeof v !== "object") return;
    if (!Array.isArray(v) && "highlights" in v) found.push({ file, key, value: v as J.JSONObject });
    for (const [k, x] of Object.entries(v)) walk(file, x, k);
  };
  const metas: J.JSONObject[] = [];
  for (const f of fs.readdirSync(examplesDir).filter((x) => x.endsWith(".dsm"))) {
    const model = JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"));
    walk(f, model, "");
    if (model.modelMeta && Object.keys(model.modelMeta).length > 0) metas.push(model.modelMeta);
  }
  const usesOldNames = (v: unknown): boolean => JSON.stringify(v).includes('"name"');

  it("finds them", () => {
    expect(found.length).toBeGreaterThan(20);
    expect(metas.length).toBe(2);
  });
  it("round trips the current format exactly", () => {
    for (const { value } of found.filter((x) => !usesOldNames(x.value))) {
      expect(JSON_DiagramAppearance.toJSON(JSON_DiagramAppearance.parseJSON(value))).toEqual(value);
    }
    for (const m of metas) {
      expect(J.mapJ(J.textKey, J.valueJ).parseJSON(JSON_PackageAppearance.toJSON(JSON_PackageAppearance.parseJSON(m))))
        .toEqual(J.mapJ(J.textKey, J.valueJ).parseJSON(m));
    }
  });
  it("migrates fields stored by name", () => {
    const old = found.filter((x) => usesOldNames(x.value));
    expect(old.length).toBeGreaterThan(0);
    for (const { value } of old) {
      const da: DiagramAppearance<null, unknown> = JSON_DiagramAppearance.parseJSON(value);
      const rows = (value.fields as [string, { style: string; name?: string; field?: string }[]][]);
      expect(da._entityShowFields._fieldsShown.map(([v, fs]) => [v, fs.map((f) => f._entityShowFieldId)]))
        .toEqual(rows.map(([v, fs]) => [v, fs.map((f) => (f.field !== undefined ? f.field : migrateField(f.name!)))]));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Pango attributes

describe("colourText", () => {
  const yellow = Colour(C.sRGB24(255, 255, 0));
  it("is empty without a colour", () => {
    expect(colourText(Nothing, 0, 10).attrs).toEqual([]);
  });
  it("sets the background and the contrasting text colour", () => {
    const l = colourText(Just(yellow), 3, 7);
    expect(l.attrs.map((a) => [a.kind, a.value, a.startIndex, a.endIndex])).toEqual([
      ["foreground", "rgb(0, 0, 0)", 3, 7],
      ["background", "rgb(255, 255, 0)", 0, 0xffffffff],
    ]);
    expect(equals(contrastText(yellow), Colour(C.black))).toBe(true);
    expect(colourForFont(yellow)).toEqual([65535, 65535, 0]);
    // Channels are rounded (banker's rounding) to 16 bits.
    expect(colourForFont(Colour(C.sRGB24(128, 0, 1)))).toEqual([32896, 0, 257]);
  });
});

describe("labelledFieldAttributes", () => {
  const green = Colour(C.sRGB24(0, 128, 0));
  it("makes the label bold and colours the value", () => {
    const [txt, l] = labelledFieldAttributes("Status", ExtText("Done"), Just(green));
    expect(txt).toBe("Status: Done");
    expect(l.attrs.map((a) => [a.kind, a.startIndex, a.endIndex])).toEqual([
      ["foreground", 8, 12], ["background", 0, 0xffffffff], ["weight", 0, 7],
    ]);
  });
  it("uses character counts as Pango (byte) indices, as the Haskell does", () => {
    // "Größe" is 5 characters but 7 bytes of UTF-8; the value "Grün" is 4 characters, 5 bytes.
    const [txt, l] = labelledFieldAttributes("Größe", ExtText("Grün"), Just(green));
    expect(txt).toBe("Größe: Grün");
    expect(l.attrs.map((a) => [a.kind, a.startIndex, a.endIndex])).toEqual([
      ["foreground", 7, 11], ["background", 0, 0xffffffff], ["weight", 0, 6],
    ]);
    // Astral characters count once (T.length counts code points, not UTF-16 units).
    const [, l2] = labelledFieldAttributes("𝔸", ExtText("x"), Nothing);
    expect(l2.attrs.map((a) => [a.kind, a.startIndex, a.endIndex])).toEqual([["weight", 0, 2]]);
  });
});

// ---------------------------------------------------------------------------------------------
// diagramLayout, with a minimal model of packages and items with descriptions.

type TV =
  | { readonly tag: "P"; readonly _0: Package<TV, null> }
  | { readonly tag: "I"; readonly _0: Name; readonly desc: string };
const pkgV = (p: Package<TV, null>): TV => ({ tag: "P", _0: p });
const itemV = (n: string, desc = ""): TV => ({ tag: "I", _0: Name(n), desc });
const tvName = lens(
  (v: TV) => (v.tag === "P" ? v._0._packageName : v._0),
  (v: TV, n: Name): TV => (v.tag === "P" ? pkgV({ ...v._0, _packageName: n }) : { ...v, _0: n }),
);
const _P: Prism<TV, Package<TV, null>> = prism(
  (p: Package<TV, null>) => pkgV(p),
  (v: TV) => (v.tag === "P" ? Right(v._0) : Left(v)),
);
const cls: EntityClass<TV, null> = {
  reflectiveName: (v) => (v.tag === "P" ? "Package" : "Item"),
  variantUserLabel: (v) => "The " + v,
  reflectiveDefaults: [pkgV(Package(Name(""), null)), itemV("")],
  reflectiveBuiltIn: (v) => (v.tag === "P" ? [nameField] : [nameField, descriptionField]),
  reflectiveGet: (v) => v.tag === "P"
    ? M.singleton(nameField, ExtText(view(tvName, v)._0))
    : M.fromList([[nameField, ExtText(v._0._0)], [descriptionField, ExtText(v.desc)]]),
  reflectiveSet: (st, v) => {
    const v2 = set(tvName, Name(extract(st, view(tvName, v)._0, _ExtText, nameField)), v);
    return v2.tag === "P" ? v2 : { ...v2, desc: extract(st, v2.desc, _ExtText, descriptionField) };
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
  entityJ: J.codec(() => null, () => itemV("")),
  packageMetaJ: J.unitJ,
  packageMetaMempty: null,
  packageMetaAppend: () => null,
};

const fStatus = id(101), fDone = id(102), fSize = id(103), fMissing = id(104);
const green = Colour(C.sRGB24(0, 128, 0)), pink = Colour(C.sRGB24(255, 192, 203));

function testModel(): { model: Model<TV>; item: ModelId; plain: ModelId; pkg: ModelId } {
  const r = runModelEdit(cls, identity<TV>(), modelStartState(newGenerator(), emptyModel(cls, "Test")), (c) => {
    const pkg = mkPackage(c, Name("Pkg"));
    goToEntity(c, pkg);
    const item = mkEntity(c, itemV("A", "First para.\n\nSecond para.")).entityId;
    goToRoot(c);
    const plain = mkEntity(c, itemV("B", "Only the description.")).entityId;
    return { pkg, item, plain };
  });
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  const m0 = r.value[0].updateNewModel;
  const { item, plain, pkg } = r.value[0].updateValue;
  const exts: ExtensionValues = M.fromList([[fStatus, ExtText("Done")], [fDone, ExtBool(true)], [fSize, ExtText("Groß")]]);
  const modelContents = M.adjust((e: Entity<TV>) => ({ ...e, _entityExtensions: exts }), item, m0.modelContents);
  const model: Model<TV> = {
    ...m0,
    modelContents,
    modelFields: M.fromList([
      [fStatus, Field(false, fStatus, "Status", "One",
        EnumDef([EnumItem("Open", Nothing, Just(pink)), EnumItem("Done", Nothing, Just(green))]))],
      [fDone, Field(false, fDone, "Verified", "One", DecoBoolDef(DecoBool(Nothing, Just([pink, green]))))],
      [fSize, Field(false, fSize, "Größe", "One", BuiltInDef("ModelText"))],
    ]),
    modelExtensions: M.singleton("Item", [fStatus, fDone, fSize]),
  };
  return { model, item, plain, pkg };
}

const style = hadesConfig(Gtk.iconThemeNew());

/** Lay out the entity with the given fields shown and return the text runs drawn: [text, weight, fill]. */
function layoutRuns(model: Model<TV>, uuid: ModelId, shown: EntityShowFields<TV>): string[][] {
  const r = evalModelEdit(cls, identity<TV>(), model, (c: ModelEditCtx<TV, TV>) => {
    if (U.isNil(uuid)) goToRoot(c);
    else goToEntity(c, uuid);
    return diagramLayout(c, shown);
  });
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  const surface = new Cairo.SvgSurface(400, 400);
  runLayout_(BoundBox(Point(0, 0), Point(400, 400)), r.value)({ style, cr: surface.context() });
  const doc = surface.document();
  const runs: string[][] = [];
  for (const m of doc.matchAll(/<text [^>]*font-weight="([^"]*)"[^>]*fill="([^"]*)"[^>]*>([^<]*)<\/text>/g)) {
    runs.push([m[3], m[1], m[2]]);
  }
  for (const m of doc.matchAll(/<path d="[^"]*" fill="(rgb\([^"]*\))"\/>/g)) runs.push(["<bg>", m[1]]);
  if (doc.includes('stroke="rgb(0, 0, 0)" stroke-width="1"')) runs.push(["<hline>"]);
  return runs;
}

describe("diagramLayout", () => {
  const { model, item, plain } = testModel();

  it("shows the description for entity types that are not listed", () => {
    expect(layoutRuns(model, plain, mempty_EntityShowFields)).toEqual([["Only the description.", "400", "rgb(0, 0, 0)"]]);
    expect(layoutRuns(model, item, EntityShowFields([["Package", []]]))).toEqual([
      ["First para.", "400", "rgb(0, 0, 0)"],
      ["Second para.", "400", "rgb(0, 0, 0)"],
    ]);
  });

  it("reports the root as an internal error", () => {
    expect(layoutRuns(model, U.nil, mempty_EntityShowFields)).toEqual([
      ["Internal error: root entity should not appear on a diagram.", "400", "rgb(0, 0, 0)"],
    ]);
  });

  it("shows values in the colour of their format", () => {
    const runs = layoutRuns(model, item, EntityShowFields([["Item", [fsf(FieldStyleNone, fStatus), fsf(FieldStyleNone, fMissing)]]]));
    // Text in the contrasting colour (white on dark green), on a green background.
    expect(runs).toEqual([["Done", "400", "rgb(255, 255, 255)"], ["<bg>", "rgb(0, 128, 0)"]]);
  });

  it("labels outdented fields in bold", () => {
    const runs = layoutRuns(model, item, EntityShowFields([["Item", [fsf(FieldStyleOutdent, fDone)]]]));
    // As in the Haskell, the background attribute covers the label too; only the value is in the
    // contrasting text colour.
    expect(runs).toEqual([
      ["Verified:", "700", "rgb(0, 0, 0)"],
      [" ", "400", "rgb(0, 0, 0)"],
      ["Yes", "400", "rgb(255, 255, 255)"],
      ["<bg>", "rgb(0, 128, 0)"],
      ["<bg>", "rgb(0, 128, 0)"],
      ["<bg>", "rgb(0, 128, 0)"],
    ]);
  });

  it("keeps the Haskell's character-count indices for non-ASCII labels", () => {
    // "Größe: Groß": the bold span ends at byte 6 (inside the label), the value colour would start
    // at byte 7 (the colon); the field has no colour, so only the weight differs.
    const runs = layoutRuns(model, item, EntityShowFields([["Item", [fsf(FieldStyleOutdent, fSize)]]]));
    expect(runs).toEqual([["Größ", "700", "rgb(0, 0, 0)"], ["e: Groß", "400", "rgb(0, 0, 0)"]]);
  });

  it("puts fields above their values with a rule, and skips empty values", () => {
    const runs = layoutRuns(model, item, EntityShowFields([["Item", [
      fsf(FieldStyleAbove, fSize), fsf(FieldStyleAbove, fMissing), fsf(FieldStyleAbove, descriptionField),
    ]]]));
    expect(runs).toEqual([
      ["Größe", "700", "rgb(0, 0, 0)"],
      ["Groß", "400", "rgb(0, 0, 0)"],
      ["Description", "700", "rgb(0, 0, 0)"],
      ["First para.", "400", "rgb(0, 0, 0)"],
      ["Second para.", "400", "rgb(0, 0, 0)"],
      ["<hline>"],
    ]);
    const { model: m2, plain: p2 } = testModel();
    // The plain item has no "Größe" value, so nothing is drawn for it.
    expect(layoutRuns(m2, p2, EntityShowFields([["Item", [fsf(FieldStyleAbove, fSize)]]]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Dialogs

describe("appearance dialogs", () => {
  const dcls = {
    ...cls,
    diagramEntityTypes: M.fromList([["Item Diagram", ["Item"]], ["Other Diagram", []]]),
    _QueryDiagram: prism((q: never) => q, (v: TV) => Left(v)),
    queryAvatars: () => [],
  } as unknown as AppearanceDialogClass<null, TV>;

  it("builds the diagram style dialog", () => {
    const d = diagramAppearanceDialog(dcls, "Item Diagram");
    expect(d.dialogTitle).toBe("The Item Diagram Style");
    expect(d.dialogButtons.tag).toBe("OkApplyButton");
    expect(() => showGadget(d.dialogGadget)).not.toThrow();
  });

  it("builds a tab for each diagram type in the package style dialog", () => {
    const d = packageAppearanceDialog(dcls);
    expect(d.dialogTitle).toBe("Style of Diagrams in this Package");
    const shown = JSON.stringify(showGadget(d.dialogGadget));
    expect(shown).toContain("The Item Diagram");
    expect(shown).toContain("The Other Diagram");
  });

  it("validates that variants are listed once", () => {
    expect(uniqueVariants(cls, [["Item", []], ["Package", []]])).toEqual(Nothing);
    expect(uniqueVariants(cls, [["Package", []], ["Item", []], ["Package", []], ["Item", []]]))
      .toEqual(Just("The Item listed twice."));
  });
});
