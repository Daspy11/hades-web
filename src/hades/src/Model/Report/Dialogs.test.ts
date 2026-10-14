import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as J from "@/lib/Data/Aeson";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { Node } from "@/lib/Data/Tree";
import { preview, prism, review, set, view, type Prism } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { GadgetData, pure_Changes, type GadgetData as GD } from "@/banana-ui/base/Reactive/Banana/Common";
import { renderGadget } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import {
  Name, modelStartState, nameField, nameText, runModelEdit, withStampFields,
  type Entity, type Model, type ModelEdit, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { SortOrder, matrixInputSet } from "@/hades/src/Model/Matrices/Base";
import { migrateField, withBuiltIn } from "@/hades/src/Model/Reflection/Types";
import { findEntity, readRiskModel, riskClass, type RV } from "@/hades/src/Model/Matrices/testing/RiskModel";
import {
  JSON_Report, Report, ReportDiagram, ReportField, ReportFieldList, ReportHeading, ReportLiteral, ReportLookup,
  ReportMatrix, ReportPageLayout, SubReport, reportPageDefault,
  type ReportFragment,
} from "./Base";
import {
  ReportDocx, ReportHtml, ReportRunParameters, ReportTemplate, _ReportDocx, _ReportHtml, _ReportTemplate,
  addOptions, inputFilter, matrixInputs, queryInputSet, reportDelta, reportDesignGadget, reportDialogSelector,
  reportFormat, reportFragmentFromTree, reportFragmentToTree, reportFragmentsFromForest, reportFragmentsToForest,
  reportRunDefault, reportRunDialog, reportTarget, reportTreeIso, reportWarningsDialog, show_ReportFormat,
  show_ReportRunParameters, topMatrixIds, topQueryIds, treeMenu,
  type ReportFormat,
} from "./Dialogs";

const exampleJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../../../../dsm/share/examples/3 Managing Risks.dsm"), "utf8"));
const model: Model<RV> = readRiskModel(exampleJson);
const fid = (n: string) => migrateField(n);

/** The example model keeps reports as raw JSON ("Other" entities); read them with the codec. */
const _ReportRV: Prism<RV, Report<RV>> = prism(
  (r: Report<RV>): RV => ({ tag: "Other", _0: JSON_Report.toJSON(r) as J.JSONObject }),
  (v: RV) => (v.tag === "Other" && v._0.type === "report" ? Right(JSON_Report.parseJSON(v._0) as Report<RV>) : Left(v)),
);
const reportNamed = (name: string): [ModelId, Report<RV>] => {
  for (const [mId, e] of M.toList(model.modelContents)) {
    const r = preview(_ReportRV, e._entityContents);
    if (r.tag === "Just" && r.value._reportName._0 === name) return [mId, r.value];
  }
  throw new Error("No report " + name);
};
const [riskReportId, riskReport] = reportNamed("Risk Report");
const [, controlReport] = reportNamed("Control Report");
const riskRegisterId = findEntity(model, "Matrix", "Risk Register");
const controlRegisterId = findEntity(model, "Matrix", "Control Register");
const riskReportMatrixId = findEntity(model, "Matrix", "Risk Report Matrix");
const risksQ = findEntity(model, "Query", "Finding Risks");
const controlsQ = findEntity(model, "Query", "Controls for Risks");
const inherentQ = findEntity(model, "Lookup", "Inherent Risk Level");
const byName = SortOrder([[nameField, "Ascending"]]);

const nested: ReportFragment<RV>[] = [
  ReportHeading(1, "Title", Nothing),
  SubReport(Just(risksQ), byName, [
    ReportField(nameField),
    SubReport(Just(controlsQ), SortOrder([]), [ReportLiteral("Control"), ReportDiagram]),
    ReportFieldList([nameField, fid("Description")]),
  ]),
  ReportMatrix(Just(riskRegisterId)),
];

describe("Tree conversion", () => {
  it("moves sub-report contents into the children", () => {
    const forest = reportFragmentsToForest(nested);
    expect(forest).toEqual([
      Node(ReportHeading(1, "Title", Nothing), []),
      Node(SubReport(Just(risksQ), byName, []), [
        Node(ReportField(nameField), []),
        Node(SubReport(Just(controlsQ), SortOrder([]), []), [
          Node(ReportLiteral("Control"), []),
          Node(ReportDiagram, []),
        ]),
        Node(ReportFieldList([nameField, fid("Description")]), []),
      ]),
      Node(ReportMatrix(Just(riskRegisterId)), []),
    ]);
    expect(reportFragmentsFromForest(forest)).toEqual(nested);
    expect(reportFragmentToTree(ReportLiteral("x"))).toEqual(Node(ReportLiteral("x"), []));
  });

  it("is an iso one way round, ignoring the children of plain fragments the other way", () => {
    for (const frag of nested) {
      expect(review(reportTreeIso<RV>(), view(reportTreeIso<RV>(), frag))).toEqual(frag);
    }
    // The sub-report list stored in a SubReport node is replaced by the children.
    expect(reportFragmentFromTree(Node(SubReport(Nothing, byName, [ReportLiteral("lost")]), [Node(ReportDiagram, [])])))
      .toEqual(SubReport(Nothing, byName, [ReportDiagram]));
    expect(reportFragmentFromTree(Node(ReportLiteral("x"), [Node(ReportDiagram, [])]))).toEqual(ReportLiteral("x"));
  });
});

describe("Report structure menus", () => {
  const labels = (m: ReturnType<typeof treeMenu>) => m._0.map((grp) => grp.map((i) => i.menuLabel));
  const optionNames = ["Literal", "Field", "Field List", "Heading", "Diagram", "Matrix", "Lookup Table", "Section"];

  it("offers new fragments with sensible initial values", () => {
    expect(addOptions().map(([t]) => t)).toEqual(optionNames);
    expect(addOptions().map(([, v]) => v)).toEqual([
      ReportLiteral(""),
      ReportField(nameField),
      ReportFieldList([nameField]),
      ReportHeading(1, "", Just([nameField, ""])),
      ReportDiagram,
      ReportMatrix(Nothing),
      ReportLookup(Nothing),
      SubReport(Nothing, byName, []),
    ]);
  });

  it("adds after on the background", () => {
    const m = treeMenu<RV>(Nothing);
    expect(labels(m)).toEqual([optionNames]);
    expect(m._0[0].map((i) => i.menuValue)).toEqual(addOptions().map(([, v]) => Right({ tag: "TreeAddAfter", _0: v })));
  });

  it("adds before, inside and after a section", () => {
    const m = treeMenu<RV>(Just(SubReport(Nothing, byName, [])));
    expect(labels(m)).toEqual([["Add before", "Add inside", "Add after", "Delete"]]);
    const sub = (n: number) => {
      const v = m._0[0][n].menuValue;
      if (v.tag !== "Left") throw new Error("not a sub-menu");
      return v.value;
    };
    expect(labels(sub(0))).toEqual([optionNames]);
    expect(sub(0)._0[0][0].menuValue).toEqual(Right({ tag: "TreeAddBefore", _0: ReportLiteral("") }));
    expect(sub(1)._0[0][7].menuValue).toEqual(Right({ tag: "TreeAddIn", _0: SubReport(Nothing, byName, []) }));
    expect(sub(2)._0[0][1].menuValue).toEqual(Right({ tag: "TreeAddAfter", _0: ReportField(nameField) }));
    expect(m._0[0][3].menuValue).toEqual(Right({ tag: "TreeDelete" }));
  });

  it("adds before and after any other fragment", () => {
    for (const frag of [ReportLiteral("x"), ReportDiagram, ReportMatrix(Nothing)]) {
      expect(labels(treeMenu<RV>(Just(frag)))).toEqual([["Add before", "Add after", "Delete"]]);
    }
  });

  it("has a dialog for every fragment except diagrams", () => {
    const sel = reportDialogSelector<RV, null>(riskClass);
    const title = (frag: ReportFragment<RV>) => {
      const d = sel(model, frag);
      return d.tag === "Just" ? d.value.dialogTitle : null;
    };
    expect(title(ReportLiteral("x"))).toBe("Literal text");
    expect(title(ReportField(nameField))).toBe("Field contents");
    expect(title(ReportFieldList([]))).toBe("Field definition list");
    expect(title(ReportHeading(2, "", Nothing))).toBe("Heading");
    expect(title(ReportDiagram)).toBe(null);
    expect(title(ReportMatrix(Nothing))).toBe("Select a matrix");
    expect(title(ReportLookup(Nothing))).toBe("Select a lookup table");
    expect(title(SubReport(Nothing, byName, []))).toBe("Report Section");
    const d = sel(model, ReportLiteral("x"));
    expect(d.tag === "Just" && d.value.dialogButtons).toEqual({ tag: "OkButton" });
  });
});

describe("reportDelta", () => {
  const run = (edit: Maybe<ModelEdit<RV, Report<RV>, Maybe<string>>>): [Maybe<string>, Report<RV>] => {
    if (edit.tag === "Nothing") throw new Error("no edit");
    const r = runModelEdit(riskClass, _ReportRV, modelStartState(newGenerator(), model), edit.value);
    if (r.tag === "Left") throw new Error(JSON.stringify(r.value));
    const e = M.lookup(riskReportId, r.value[0].updateNewModel.modelContents);
    if (e.tag === "Nothing") throw new Error("lost the report");
    const rpt = preview(_ReportRV, e.value._entityContents);
    if (rpt.tag === "Nothing") throw new Error("not a report");
    return [r.value[0].updateValue, rpt.value];
  };
  const delta = (r2: Report<RV>) => reportDelta(riskClass, riskReportId, "RR", [model, riskReport, r2]);
  const withSpec = (spec: ReportFragment<RV>[]): Report<RV> => ({ ...riskReport, _reportSpec: spec });

  it("does nothing when nothing changed", () => {
    expect(delta(riskReport)).toEqual(Nothing);
    expect(delta({ ...riskReport, _reportSpec: [...riskReport._reportSpec] })).toEqual(Nothing);
  });

  it("renames and edits the description, default input and template", () => {
    const [msg1, r1] = run(delta({ ...riskReport, _reportName: Name("Risks") }));
    expect(msg1).toEqual(Just("Renamed RR"));
    expect(r1._reportName).toEqual(Name("Risks"));
    const [msg2, r2] = run(delta({ ...riskReport, _reportDescription: "New" }));
    expect(msg2).toEqual(Just("Edited RR description"));
    expect(r2._reportDescription).toBe("New");
    const [msg3, r3] = run(delta({ ...riskReport, _reportDefaultInput: Just(risksQ) }));
    expect(msg3).toEqual(Just("Edited RR default input"));
    expect(r3._reportDefaultInput).toEqual(Just(risksQ));
    const [msg4, r4] = run(delta({ ...riskReport, _reportDefaultTemplate: Just("/upload/t.docx") }));
    expect(msg4).toEqual(Just("Edited RR default template"));
    expect(r4._reportDefaultTemplate).toEqual(Just("/upload/t.docx"));
    // Only the first difference is described, but the whole new report is stored.
    const [msg5, r5] = run(delta({ ...riskReport, _reportName: Name("X"), _reportDescription: "Y" }));
    expect(msg5).toEqual(Just("Renamed RR"));
    expect(r5._reportDescription).toBe("Y");
  });

  it("describes edits of the structure, including inside sections", () => {
    const base = withSpec(nested);
    const d = (r2: Report<RV>) => reportDelta(riskClass, riskReportId, "RR", [model, base, r2]);
    // Deleting the field inside the first section.
    const del = withSpec([nested[0], SubReport(Just(risksQ), byName, (nested[1] as any)._2.slice(1)), nested[2]]);
    const [msg1, r1] = run(d(del));
    expect(msg1).toEqual(Just("Edit RR: Deleted <Name>"));
    expect(r1._reportSpec).toEqual(del._reportSpec);
    // Deleting the last fragment: no differing pair, so the last old fragment is named.
    expect(run(d(withSpec(nested.slice(0, 2))))[0]).toEqual(Just("Edit RR: Deleted Matrix: Risk Register"));
    // Inserting.
    expect(run(d(withSpec([ReportLiteral("Hello\nWorld"), ...nested])))[0])
      .toEqual(Just("Edit RR: Inserted \"Hello\""));
    expect(run(d(withSpec([...nested, ReportLookup(Just(inherentQ))])))[0])
      .toEqual(Just("Edit RR: Inserted Lookup Table: Inherent Risk Level"));
    // Changing: the old fragment is named, cut to 40 characters (39 and an ellipsis).
    const changed = withSpec([ReportHeading(2, "A rather long heading for the risk register", Nothing), nested[1], nested[2]]);
    const [msg3] = run(d(changed));
    expect(msg3).toEqual(Just("Edit RR: Changed Heading 1: Title"));
    const [msg4] = run(d(withSpec([nested[0], nested[1], ReportMatrix(Just(controlRegisterId))])));
    expect(msg4).toEqual(Just("Edit RR: Changed Matrix: Risk Register"));
    const [msg5] = run(reportDelta(riskClass, riskReportId, "RR", [model, changed, base]));
    expect(msg5).toEqual(Just("Edit RR: Changed Heading 2: A rather long heading for th…"));
  });
});

describe("Report formats and run parameters", () => {
  it("has prisms for each format", () => {
    const docx = ReportDocx(ReportPageLayout("Letter", "Portrait"), "/download/r.docx");
    expect(preview(_ReportDocx, docx)).toEqual(Just([ReportPageLayout("Letter", "Portrait"), "/download/r.docx"]));
    expect(preview(_ReportHtml, docx)).toEqual(Nothing);
    expect(preview(_ReportTemplate, ReportTemplate("t", "o"))).toEqual(Just(["t", "o"]));
    expect(preview(_ReportHtml, ReportHtml("x.html"))).toEqual(Just("x.html"));
    expect(review(_ReportTemplate, ["a", "b"])).toEqual(ReportTemplate("a", "b"));
    expect(review(_ReportDocx, [reportPageDefault, "z"])).toEqual(ReportDocx(reportPageDefault, "z"));
  });

  it("shows formats and parameters as Haskell does", () => {
    expect(show_ReportFormat(ReportHtml("a \"b\".html"))).toBe("ReportHtml \"a \\\"b\\\".html\"");
    expect(show_ReportFormat(ReportDocx(ReportPageLayout("Letter", "Portrait"), "r.docx")))
      .toBe("ReportDocx US Letter Portrait \"r.docx\"");
    expect(show_ReportFormat(ReportTemplate("t.docx", "r.docx"))).toBe("ReportTemplate \"t.docx\" \"r.docx\"");
    expect(show_ReportRunParameters(ReportRunParameters(S.fromList([U.nil]), ReportHtml("x"))))
      .toBe("ReportRunParameters {_reportTarget = fromList [00000000-0000-0000-0000-000000000000], _reportFormat = ReportHtml \"x\"}");
  });

  it("has lenses for the parameters", () => {
    const p = ReportRunParameters(S.empty(), ReportHtml(""));
    expect(view(reportTarget, set(reportTarget, S.fromList([risksQ]), p))).toEqual(S.fromList([risksQ]));
    expect(view(reportFormat, set(reportFormat, ReportTemplate("a", "b"), p))).toEqual(ReportTemplate("a", "b"));
  });

  it("defaults to the report's default input and template", () => {
    expect(reportRunDefault(riskReport)).toEqual(ReportRunParameters(S.empty(), ReportDocx(reportPageDefault, "")));
    const r = { ...riskReport, _reportDefaultInput: Just(risksQ), _reportDefaultTemplate: Just("/upload/t.docx") };
    expect(reportRunDefault(r)).toEqual(ReportRunParameters(S.fromList([risksQ]), ReportTemplate("/upload/t.docx", "")));
  });
});

describe("Report inputs", () => {
  const entity = (mId: ModelId): Entity<RV> => {
    const e = M.lookup(mId, model.modelContents);
    if (e.tag === "Nothing") throw new Error("no entity");
    return e.value;
  };
  const items = (type: "Control" | "RiskEvent"): Entity<RV>[] =>
    M.elems(model.modelContents).filter((e) => e._entityContents.tag === "Item" && e._entityContents.type === type);
  const matrixOf = (mId: ModelId) => {
    const c = entity(mId)._entityContents;
    if (c.tag !== "Matrix") throw new Error("not a matrix");
    return c._0;
  };
  const queryOf = (mId: ModelId) => {
    const c = entity(mId)._entityContents;
    if (c.tag !== "Query") throw new Error("not a query");
    return c._0;
  };

  /** The model with the inputs of a query diagram replaced. */
  const withQueryInputs = (m: Model<RV>, qId: ModelId, vs: string[]): Model<RV> => {
    const e = M.lookup(qId, m.modelContents);
    if (e.tag === "Nothing" || e.value._entityContents.tag !== "Query") throw new Error("not a query");
    const q = { ...e.value._entityContents._0, _queryInputs: S.fromList(vs) };
    const e2: Entity<RV> = { ...e.value, _entityContents: { tag: "Query", _0: q } };
    return { ...m, modelContents: M.insert(qId, e2, m.modelContents) };
  };

  it("finds the top level queries and matrices", () => {
    const r = { ...riskReport, _reportSpec: [...nested, SubReport(Nothing, byName, []), ReportMatrix(Nothing)] };
    expect(topQueryIds(r)).toEqual([risksQ]);
    expect(topMatrixIds(r)).toEqual([riskRegisterId]);
    expect(topMatrixIds(riskReport)).toEqual([riskReportMatrixId]);
    expect(topQueryIds(riskReport)).toEqual([]);
  });

  it("takes the inputs from the top level matrices and queries", () => {
    const rrInputs = matrixInputSet(riskClass, matrixOf(riskReportMatrixId), model);
    expect(S.size(rrInputs)).toBeGreaterThan(0);
    expect(matrixInputs(riskClass, riskReport, model)).toEqual(rrInputs);
    expect(queryInputSet(riskClass, riskReport, model)).toEqual(S.empty());
    const r = { ...controlReport, _reportSpec: [...controlReport._reportSpec, SubReport(Just(risksQ), byName, [])] };
    expect(queryInputSet(riskClass, r, model)).toEqual(queryOf(risksQ)._queryInputs);
    const both = S.union(matrixInputs(riskClass, r, model), queryOf(risksQ)._queryInputs);
    const f = inputFilter(riskClass, r, model);
    for (const e of M.elems(model.modelContents)) {
      expect(f(e)).toBe(S.member(riskClass.reflectiveName(e._entityContents), both));
    }
    // The example reports' entities are kept as raw JSON with the variant "report", which no
    // query accepts.
    expect(f(entity(riskReportId))).toBe(false);
    expect(f(items("Control")[0])).toBe(true);
  });

  it("restricts the input to the union of the input variants", () => {
    const risks = items("RiskEvent");
    const controls = items("Control");
    expect(risks.length).toBeGreaterThan(0);
    expect(controls.length).toBeGreaterThan(0);
    // A section over a query that only takes risk events.
    const m1 = withQueryInputs(model, risksQ, ["Bow Tie Event"]);
    const r1 = { ...riskReport, _reportSpec: [SubReport(Just(risksQ), byName, [])] };
    const f1 = inputFilter(riskClass, r1, m1);
    expect(risks.every(f1)).toBe(true);
    expect(controls.some(f1)).toBe(false);
    expect(f1(entity(risksQ))).toBe(false);
    // Plus a section (or a matrix whose first group uses a query) that only takes controls.
    const m2 = withQueryInputs(m1, controlsQ, ["Control"]);
    const r2 = { ...r1, _reportSpec: [...r1._reportSpec, SubReport(Just(controlsQ), byName, [])] };
    const f2 = inputFilter(riskClass, r2, m2);
    expect(risks.every(f2) && controls.every(f2)).toBe(true);
    expect(f2(entity(risksQ))).toBe(false);
    const groupQ = matrixOf(controlRegisterId)._matrixGroups[0]._groupQuery;
    const m3 = withQueryInputs(m1, groupQ, ["Control"]);
    const r3 = { ...r1, _reportSpec: [...r1._reportSpec, ReportMatrix(Just(controlRegisterId))] };
    expect(matrixInputs(riskClass, r3, m3)).toEqual(S.fromList(["Control"]));
    const f3 = inputFilter(riskClass, r3, m3);
    expect(risks.every(f3) && controls.every(f3)).toBe(true);
    expect(f3(entity(risksQ))).toBe(false);
  });

  it("allows anything when the report has no top level matrix or query", () => {
    const f = inputFilter(riskClass, { ...riskReport, _reportSpec: [ReportLiteral("x"), ReportMatrix(Just(U.nil))] }, model);
    expect(M.elems(model.modelContents).every(f)).toBe(true);
  });
});


// ---------------------------------------------------------------------------------------------
// The dialogs rendered with the GTK toolkit.

const theme = Gtk.iconThemeGetDefault();
const allWidgets = (w: Gtk.Widget): Gtk.Widget[] => [w, ...w.getChildren().flatMap(allWidgets)];
const widgetsOf = <T extends Gtk.Widget>(cls: abstract new (...args: any[]) => T, ws: Gtk.Widget[]): T[] =>
  ws.filter((w): w is T => w instanceof cls);
const render = <A>(g: any, value: A) => B.liftMomentIO(() => {
  const initial = GadgetData(true, value);
  const o = renderGadget(theme, () => {}, model, initial, pure_Changes(model), B.never(), B.pureB(initial), g);
  const seen: GD<A>[] = [];
  B.subscribeE(o.gadgetUser as B.Event<GD<A>>, (x: GD<A>) => { seen.push(x); });
  const sent: any[][] = [];
  B.subscribeE(o.gadgetEvents, (x: readonly any[]) => { sent.push([...x]); });
  return [o, o.gadgetView.flatMap(allWidgets), seen, sent] as const;
});
const labelTexts = (ws: Gtk.Widget[]) => widgetsOf(Gtk.Label, ws).map((l) => Gtk.labelGetText(l));

describe("Fragment dialogs in the GTK toolkit", () => {
  const sel = reportDialogSelector<RV, null>(riskClass);
  const dialog = (frag: ReportFragment<RV>) => {
    const d = sel(model, frag);
    if (d.tag === "Nothing") throw new Error("no dialog");
    return render(d.value.dialogGadget, frag);
  };

  it("edits literal text", () => {
    const [, ws, seen] = dialog(ReportLiteral("Some text"));
    const [tv] = widgetsOf(Gtk.TextView, ws);
    expect(Gtk.textBufferGetText(Gtk.textViewGetBuffer(tv))).toBe("Some text");
  });

  it("picks a field, sorted by name", () => {
    const [out, ws, seen] = dialog(ReportField(fid("Description")));
    const [combo] = widgetsOf(Gtk.ComboBox, ws);
    expect(out.gadgetInitial._gdOk).toBe(true);
    Gtk.comboBoxSetActive(combo, 0);
    expect(seen.at(-1)?._gdValue.tag).toBe("ReportField");
  });

  it("edits a heading with an optional field", () => {
    const [out, ws, seen] = dialog(ReportHeading(2, "Risk", Nothing));
    const [level] = widgetsOf(Gtk.ComboBox, ws);
    expect(Gtk.comboBoxGetActive(level)).toBe(1);
    expect(labelTexts(ws)).toEqual(expect.arrayContaining(["Level:", "Text 1:", "Field:", "Text 2:"]));
    const [text1] = widgetsOf(Gtk.Entry, ws);
    expect(Gtk.entryGetText(text1)).toBe("Risk");
    text1.userSetText("Hazard");
    expect(seen.at(-1)?._gdValue).toEqual(ReportHeading(2, "Hazard", Nothing));
    Gtk.comboBoxSetActive(level, 4);
    expect(seen.at(-1)?._gdValue).toEqual(ReportHeading(5, "Risk", Nothing));
    // The tick box switches the field part on, with the default (Name, "").
    const [tick] = widgetsOf(Gtk.CheckButton, ws);
    Gtk.toggleButtonSetActive(tick, true);
    expect(seen.at(-1)?._gdValue).toEqual(ReportHeading(2, "Risk", Just([nameField, ""])));
    expect(out.gadgetInitial._gdOk).toBe(true);
  });

  it("rejects a nil field and an empty field list", () => {
    // reportFieldDialog: validate (not . U.null)
    expect(dialog(ReportField(U.nil))[0].gadgetInitial._gdOk).toBe(false);
    // reportFieldListDialog: validFields [] = False (unknown IDs are dropped by fieldNameIso, and
    // the blank " -?- " row is filtered out again on the way back).
    expect(dialog(ReportFieldList([]))[0].gadgetInitial._gdOk).toBe(false);
    expect(dialog(ReportFieldList([U.nil]))[0].gadgetInitial._gdOk).toBe(false);
    const [out] = dialog(ReportFieldList([nameField]));
    expect(out.gadgetInitial).toEqual({ _gdOk: true, _gdValue: ReportFieldList([nameField]) });
    // reportHeadingDialog: the optional field must not be nil.
    expect(dialog(ReportHeading(1, "", Just([U.nil, ""])))[0].gadgetInitial._gdOk).toBe(false);
    expect(dialog(ReportHeading(1, "", Just([nameField, ""])))[0].gadgetInitial._gdOk).toBe(true);
  });

  it("lists the field dialog's fields sorted by name and the heading's in field-ID order", () => {
    const comboLabels = (frag: ReportFragment<RV>, n: number): string[] => {
      const [, ws] = dialog(frag);
      const combo = widgetsOf(Gtk.ComboBox, ws)[n];
      const labels: string[] = [];
      Gtk.treeModelForeach(Gtk.comboBoxGetModel(combo)!, (m, _p, it) => {
        labels.push(String(Gtk.fromGValue<unknown>(Gtk.treeModelGetValue(m, it, 0))));
        return false;
      });
      return labels;
    };
    const fieldLabels = comboLabels(ReportField(nameField), 0);
    expect(fieldLabels.length).toBeGreaterThan(2);
    expect(fieldLabels).toEqual([...fieldLabels].sort());
    expect(fieldLabels).toContain("Name");
    // The heading dialog's second combo is the field (the first is the level), in field-ID order
    // (`M.elems`), not sorted by name.
    const headingLabels = comboLabels(ReportHeading(1, "", Just([nameField, ""])), 1);
    const byId = M.toList(withStampFields(withBuiltIn(model.modelFields))).map(([, f]) => f._fieldName);
    expect(headingLabels).toEqual(byId);
    expect([...headingLabels].sort()).toEqual(fieldLabels);
  });

  it("edits the field list as a table of names with a blank row", () => {
    const [out, ws] = dialog(ReportFieldList([nameField, fid("Description")]));
    const [vw] = widgetsOf(Gtk.TreeView, ws);
    const rows: unknown[] = [];
    Gtk.treeModelForeach(Gtk.treeViewGetModel(vw)!, (m, _p, it) => {
      rows.push(Gtk.fromGValue<unknown>(Gtk.treeModelGetValue(m, it, 0)));
      return false;
    });
    expect(rows).toEqual(["Name", "Description", " -?- "]);
    expect(out.gadgetInitial._gdOk).toBe(true);
  });

  const treeRows = (vw: Gtk.TreeView): [string, Gtk.TreePath][] => {
    const rows: [string, Gtk.TreePath][] = [];
    Gtk.treeModelForeach(Gtk.treeViewGetModel(vw)!, (m, p, it) => {
      rows.push([Gtk.fromGValue<string>(Gtk.treeModelGetValue(m, it, 0)), p]);
      return false;
    });
    return rows;
  };
  const pick = (vw: Gtk.TreeView, name: string | null): void => {
    const s = Gtk.treeViewGetSelection(vw);
    Gtk.treeSelectionUnselectAll(s);
    if (name === null) return;
    const row = treeRows(vw).find(([n]) => n === name);
    if (!row) throw new Error("no row " + name);
    Gtk.treeSelectionSelectPath(s, row[1]);
  };

  it("picks a matrix, and needs one", () => {
    const [out, ws, seen] = dialog(ReportMatrix(Nothing));
    expect(out.gadgetInitial._gdOk).toBe(false);
    const [vw] = widgetsOf(Gtk.TreeView, ws);
    const names = treeRows(vw).map(([n]) => n);
    expect(names).toContain("Risk Register");
    expect(names).not.toContain("Finding Risks");
    pick(vw, "Control Register");
    expect(seen.at(-1)).toEqual({ _gdOk: true, _gdValue: ReportMatrix(Just(controlRegisterId)) });
    pick(vw, null);
    expect(seen.at(-1)).toEqual({ _gdOk: false, _gdValue: ReportMatrix(Nothing) });
  });

  it("picks a lookup table", () => {
    const [out, ws, seen] = dialog(ReportLookup(Just(inherentQ)));
    expect(out.gadgetInitial._gdOk).toBe(true);
    const [vw] = widgetsOf(Gtk.TreeView, ws);
    expect(treeRows(vw).map(([n]) => n)).not.toContain("Risk Register");
    pick(vw, null);
    expect(seen.at(-1)).toEqual({ _gdOk: false, _gdValue: ReportLookup(Nothing) });
  });

  it("picks the query and ordering of a section, keeping its contents", () => {
    const contents = [ReportLiteral("x")];
    const [out, ws, seen] = dialog(SubReport(Just(risksQ), byName, contents));
    expect(out.gadgetInitial._gdOk).toBe(true);
    const [queries, sortTable] = widgetsOf(Gtk.TreeView, ws);
    expect(treeRows(sortTable).map(([row]) => row as unknown)).toEqual([["Name", "Ascending"], [" -?- ", "Ascending"]]);
    expect(labelTexts(ws).join(" ")).toContain("The children of this item will be added to the report once for each result of the query.");
    pick(queries, "Controls for Risks");
    expect(seen.at(-1)).toEqual({ _gdOk: true, _gdValue: SubReport(Just(controlsQ), byName, contents) });
    pick(queries, null);
    expect(seen.at(-1)).toEqual({ _gdOk: false, _gdValue: SubReport(Nothing, byName, contents) });
  });
});

describe("reportRunDialog in the GTK toolkit", () => {
  it("previews with the name, description and input only", () => {
    const d = reportRunDialog(riskClass, true, riskReport);
    expect(d.dialogTitle).toBe("Run Report");
    const [out, ws] = render(d.dialogGadget, reportRunDefault(riskReport));
    expect(widgetsOf(Gtk.Notebook, ws)).toEqual([]);
    const texts = labelTexts(ws).concat(widgetsOf(Gtk.Entry, ws).map((e) => Gtk.entryGetText(e)));
    expect(texts).toEqual(expect.arrayContaining(["Report name:", "Description:", "Input:", "Risk Report"]));
    // No input yet.
    expect(out.gadgetInitial._gdOk).toBe(false);
    const risk = M.elems(model.modelContents).find((e) => e._entityContents.tag === "Item" && e._entityContents.type === "RiskEvent")!;
    const [out2] = render(d.dialogGadget, ReportRunParameters(S.fromList([risk.entityId]), ReportDocx(reportPageDefault, "")));
    expect(out2.gadgetInitial._gdOk).toBe(true);
  });

  it("chooses the output format on tabs", () => {
    const d = reportRunDialog(riskClass, false, riskReport);
    const risk = M.elems(model.modelContents).find((e) => e._entityContents.tag === "Item")!;
    const p0 = ReportRunParameters(S.fromList([risk.entityId]), ReportDocx(reportPageDefault, "/download/r.docx"));
    const [out, ws, seen] = render(d.dialogGadget, p0);
    expect(out.gadgetInitial._gdOk).toBe(true);
    const [book] = widgetsOf(Gtk.Notebook, ws);
    expect(labelTexts(ws)).toEqual(expect.arrayContaining(
      ["New Word document", "From Word template", "HTML for Web", "Paper", "Orientation", "Output document", "Template document"]));
    expect(Gtk.notebookGetCurrentPage(book)).toBe(0);
    const [paper, orientation] = widgetsOf(Gtk.ComboBox, ws);
    expect(Gtk.comboBoxGetActive(paper)).toBe(2);
    expect(Gtk.comboBoxGetActive(orientation)).toBe(1);
    Gtk.comboBoxSetActive(paper, 0);
    expect(seen.at(-1)?._gdValue).toEqual({ ...p0, _reportFormat: ReportDocx(ReportPageLayout("Letter", "Landscape"), "/download/r.docx") });
    book.switchTo(2);
    expect(seen.at(-1)?._gdValue).toEqual({ ...p0, _reportFormat: ReportHtml("") });
    book.switchTo(1);
    expect(seen.at(-1)?._gdValue).toEqual({ ...p0, _reportFormat: ReportTemplate("", "") });
    const [, template] = widgetsOf(Gtk.Entry, ws).filter((e) => Gtk.entryGetText(e) === "");
    expect(template).toBeDefined();
  });

  it("needs output file names", () => {
    const d = reportRunDialog(riskClass, false, riskReport);
    const risk = M.elems(model.modelContents).find((e) => e._entityContents.tag === "Item")!;
    const target = S.fromList([risk.entityId]);
    for (const fmt of [ReportHtml(""), ReportDocx(reportPageDefault, ""), ReportTemplate("", "/download/x.docx"), ReportTemplate("/upload/t.docx", "")]) {
      expect(render(d.dialogGadget, ReportRunParameters(target, fmt))[0].gadgetInitial._gdOk).toBe(false);
    }
    for (const fmt of [ReportHtml("/download/x.html"), ReportTemplate("/upload/t.docx", "/download/x.docx")]) {
      expect(render(d.dialogGadget, ReportRunParameters(target, fmt))[0].gadgetInitial._gdOk).toBe(true);
    }
  });

  it("opens on the template tab when the report has a default template", () => {
    const r = { ...riskReport, _reportDefaultTemplate: Just("/upload/t.docx") };
    const [out, ws] = render(reportRunDialog(riskClass, false, r).dialogGadget, reportRunDefault(r));
    const [book] = widgetsOf(Gtk.Notebook, ws);
    expect(Gtk.notebookGetCurrentPage(book)).toBe(1);
    expect((out.gadgetInitial._gdValue as ReportRunParameters)._reportFormat as ReportFormat).toEqual(ReportTemplate("/upload/t.docx", ""));
  });
});

describe("reportWarningsDialog in the GTK toolkit", () => {
  it("lists the warnings with the entity names", () => {
    const d = reportWarningsDialog(riskClass, [[riskRegisterId, "Something odd"], [U.nil, "Missing"]]);
    expect(d.dialogTitle).toBe("Report Warnings");
    const [, ws] = render(d.dialogGadget, null);
    const [vw] = widgetsOf(Gtk.TreeView, ws);
    const rows: unknown[] = [];
    Gtk.treeModelForeach(Gtk.treeViewGetModel(vw)!, (m, _p, it) => {
      rows.push(Gtk.fromGValue<unknown>(Gtk.treeModelGetValue(m, it, 0)));
      return false;
    });
    expect(rows).toEqual([[Just("Risk Register"), "Something odd"], [Nothing, "Missing"]]);
  });
});

describe("reportDesignGadget in the GTK toolkit", () => {
  it("shows the report and sends a rename edit", () => {
    const g = reportDesignGadget(riskClass, riskReportId);
    const [, ws, , sent] = render(g, [null, riskReport]);
    const entries = widgetsOf(Gtk.Entry, ws);
    expect(Gtk.entryGetText(entries[0])).toBe("Risk Report");
    expect(labelTexts(ws)).toEqual(expect.arrayContaining(["Name:", "Description:", "Default Input:", "Default Template:"]));
    const [vw] = widgetsOf(Gtk.TreeView, ws);
    const store = Gtk.treeViewGetModel(vw) as Gtk.ForestStore<ReportFragment<RV>>;
    expect(Gtk.forestStoreGetForest(store)).toEqual(reportFragmentsToForest(riskReport._reportSpec));
    entries[0].userSetText("Risk Report 2");
    expect(sent.length).toBe(1);
    const r = runModelEdit(riskClass, _ReportRV, modelStartState(newGenerator(), model), sent[0][0]);
    if (r.tag === "Left") throw new Error("edit failed");
    expect(r.value[0].updateValue).toEqual(Just("Renamed Risk Report"));
    const e = M.lookup(riskReportId, r.value[0].updateNewModel.modelContents);
    const rpt = e.tag === "Just" ? preview(_ReportRV, e.value._entityContents) : Nothing;
    expect(rpt.tag === "Just" && view(nameText, rpt.value._reportName)).toBe("Risk Report 2");
  });
});
