import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Node } from "@/lib/Data/Tree";
import { identity, set, view } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { GadgetData, pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { renderGadget } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import {
  Name, entityStampsAsFields, entityVariantProperties, modelStartState, nameField, runModelEdit,
  type Entity, type Model, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { ModelScriptAct } from "@/hades/src/Model/Abstract/DiagramType";
import { BuiltInDef, Field, migrateField } from "@/hades/src/Model/Reflection/Types";
import { ExtInt, ExtText, type ExtensionValues } from "@/hades/src/Model/Reflection/Values";
import {
  ColumnGroup, ExprColumn, FieldColumn, FieldColumnData, LookupColumn, Matrix, MatrixColumn, QueryColumn,
  SortOrder, compileMatrix, def_FieldColumnData,
} from "./Base";
import {
  ancestorize, columnTableField, fieldColumn, getForest, getMatrixWrapper, matrixDisplay, matrixTable,
  type MatrixRow,
} from "./Screen";
import { findEntity, readRiskModel, riskClass, type RV } from "./testing/RiskModel";
import { naturalOrder } from "@/hades/src/Text/NaturalOrder";

const exampleJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../../../../dsm/share/examples/3 Managing Risks.dsm"), "utf8"));
const model: Model<RV> = readRiskModel(exampleJson);
const fid = (n: string) => migrateField(n);
const entity = (mId: ModelId): Entity<RV> => {
  const e = M.lookup(mId, model.modelContents);
  if (e.tag === "Nothing") throw new Error("no entity");
  return e.value;
};
const nameOf = (mId: ModelId): string => {
  const v = entity(mId)._entityContents;
  return v.tag === "Item" ? v.name._0 : "?";
};
const risksQ = findEntity(model, "Query", "Finding Risks");
const controlsQ = findEntity(model, "Query", "Finding Controls");
const risksForControlsQ = findEntity(model, "Query", "Risks for Controls");
const controlsForRisksQ = findEntity(model, "Query", "Controls for Risks");
const inherentT = findEntity(model, "Lookup", "Inherent Risk Level");
const registerId = findEntity(model, "Matrix", "Risk Register");
const risks = (exampleJson.modelContents as any[]).filter((e) => e.contents.type === "RiskEvent")
  .sort((a, b) => naturalOrder(a.contents.name.trim(), b.contents.name.trim()));

const compile = (m: Matrix) => {
  const r = compileMatrix(riskClass, m, model);
  if (r.tag === "Left") throw new Error(r.value.join("\n"));
  return r.value;
};

describe("ancestorize", () => {
  it("pairs each value with its ancestors", () => {
    expect(ancestorize([Node(1, [Node(2, [Node(3)]), Node(4)]), Node(5)])).toEqual([
      Node([1], [Node([2, 1], [Node([3, 2, 1])]), Node([4, 1])]),
      Node([5]),
    ]);
    expect(ancestorize([])).toEqual([]);
  });
});

describe("getForest", () => {
  it("gives one lens per entity, sorted, reading the entity values", () => {
    const groups = [ColumnGroup(risksQ, [], SortOrder([[nameField, "Ascending"]]))];
    const m = Matrix(Name("M"), "", S.empty(), groups);
    const [forest, warns] = getForest(riskClass, compile(m), [SortOrder([[nameField, "Ascending"]])], S.empty(), model);
    expect(warns).toEqual([]);
    expect(forest.map((t) => t.rootLabel[0])).toEqual(risks.map((r) => r.identity));
    const [mId, lns] = forest[0].rootLabel;
    const [ids, own, all] = view(lns, model.modelContents);
    expect(ids).toEqual([mId]);
    const ent = entity(mId);
    expect(M.lookup(nameField, own)).toEqual(Just(ExtText(risks[0].contents.name.trim())));
    expect(M.lookup(fid("Category"), own)).toEqual(Just(ExtText(risks[0].extensions.Category.value)));
    // Stamps are included in both.
    for (const [k, v] of M.toList(entityStampsAsFields(riskClass, ent))) {
      expect(M.lookup(k, own)).toEqual(Just(v));
      expect(M.lookup(k, all)).toEqual(Just(v));
    }
    // Fields not defined for the variant are not shown.
    expect(M.member(fid("Risk Title"), own)).toBe(false);
    // The setter writes the editable fields back to the entity.
    const own2 = M.insert(fid("Risk Number"), ExtInt(7), own);
    const store2 = set(lns, [ids, own2, all] as MatrixRow, model.modelContents);
    const e2 = M.lookup(mId, store2);
    expect(e2.tag === "Just" && M.lookup(fid("Risk Number"), e2.value._entityExtensions)).toEqual(Just(ExtInt(7)));
  });

  it("passes the ancestors' values in the third component (the root's values win)", () => {
    const m = Matrix(Name("M"), "", S.empty(), [
      ColumnGroup(controlsQ, [], SortOrder([[nameField, "Ascending"]])),
      ColumnGroup(risksForControlsQ, [], SortOrder([[nameField, "Ascending"]])),
    ]);
    const sorts = m._matrixGroups.map((g) => g._groupSort);
    const [forest] = getForest(riskClass, compile(m), sorts, S.empty(), model);
    expect(forest.length).toBe(8);
    const control = forest[0];
    expect(nameOf(control.rootLabel[0])).toBe("Control 1 - Nav Trg");
    expect(control.subForest.length).toBe(3);
    const [riskId, lns] = control.subForest[0].rootLabel;
    const [ids, own, all] = view(lns, model.modelContents);
    expect(ids).toEqual([riskId, control.rootLabel[0]]);
    expect(M.lookup(nameField, own)).toEqual(Just(ExtText(nameOf(riskId))));
    // foldr over [risk, control]: the control's values override the risk's.
    expect(M.lookup(nameField, all)).toEqual(Just(ExtText("Control 1 - Nav Trg")));
    // Fields only the risk has are still there.
    expect(M.member(fid("Inherent  Impact"), all)).toBe(true);
    // An entity that is not in the store reads as empty values.
    const [, , anc] = view(lns, M.delete_(riskId, model.modelContents));
    const [ids3, own3] = view(lns, M.delete_(riskId, model.modelContents));
    expect(ids3).toEqual(ids);
    expect(M.size(own3)).toBe(0);
    expect(M.lookup(nameField, anc)).toEqual(Just(ExtText("Control 1 - Nav Trg")));
  });
});

describe("Matrix tables", () => {
  const matrix = Matrix(Name("Screen"), "", S.empty(), [
    ColumnGroup(risksQ, [
      MatrixColumn("Risk", FieldColumn(def_FieldColumnData)),
      MatrixColumn("Number", FieldColumn(FieldColumnData(fid("Risk Number"), Nothing))),
      MatrixColumn("Category", FieldColumn(FieldColumnData(fid("Category"), Nothing))),
      MatrixColumn("Old version", FieldColumn(FieldColumnData(fid("Previous Version"), Just(fid("Previous Version"))))),
      MatrixColumn("Summary", ExprColumn(false, "Name ++ \" / \" ++ Category")),
      MatrixColumn("Bad", ExprColumn(true, "Name ++")),
      MatrixColumn("Controls", QueryColumn(controlsForRisksQ)),
      MatrixColumn("No query", QueryColumn(U.nil)),
      MatrixColumn("Rating", LookupColumn(inherentT)),
      MatrixColumn("No table", LookupColumn(U.nil)),
      MatrixColumn("Missing", FieldColumn(FieldColumnData(fid("Gone"), Nothing))),
    ], SortOrder([[nameField, "Ascending"]])),
    ColumnGroup(U.nil, [MatrixColumn("X", FieldColumn(def_FieldColumnData))], SortOrder([])),
  ]);
  /** The model with the Risk Register replaced by the test matrix. */
  const model2: Model<RV> = {
    ...model,
    modelContents: M.adjust((e: Entity<RV>) => ({ ...e, _entityContents: { tag: "Matrix", _0: matrix } as RV }),
      registerId, model.modelContents),
  };

  it("groups the columns under the query names, dropping deleted queries", () => {
    const t = matrixTable(riskClass, model2, matrix);
    expect(t.length).toBe(1);
    expect(t[0][0]).toBe("Finding Risks");
    expect(t[0][1].map(([n]) => n)).toEqual(matrix._matrixGroups[0]._groupColumns.map((c) => c._columnName));
    expect(columnTableField(riskClass, model2, matrix._matrixGroups[0]._groupColumns[0])[0]).toBe("Risk");
  });

  it("makes a field column gadget that sends an edit script", () => {
    const g = fieldColumn<null, RV>(riskClass, M.elems(model.modelFields).find((f) => f._fieldName === "Business Unit")!, Nothing);
    expect(g.tag).toBe("Dot");
  });

  it("edits optional text fields in a folded label, deleting the value when emptied", () => {
    const bu = M.elems(model.modelFields).find((f) => f._fieldName === "Business Unit")!;
    const optional = Field(false, bu.fieldId, bu._fieldName, "Optional", BuiltInDef("ModelText"));
    const risk = risks[0];
    const values = view(entityVariantProperties(riskClass, model), entity(risk.identity));
    expect(M.lookup(bu.fieldId, values)).toEqual(Just(ExtText(risk.extensions["Business Unit"].value)));
    const ws: Gtk.Widget[] = [];
    const [out, sent] = B.liftMomentIO(() => {
      const initial = GadgetData(true, [risk.identity, values] as readonly [ModelId, ExtensionValues]);
      const o = renderGadget(theme, (w) => ws.push(w), model, initial, pure_Changes(model), B.never(), B.pureB(initial),
        fieldColumn<null, RV>(riskClass, optional, Nothing));
      const s: W[] = [];
      B.subscribeE(o.gadgetEvents, (x) => s.push(...x));
      return [o, s] as const;
    });
    // displayText: a label in a button, with a popover entry for editing.
    const labels = out.gadgetView.flatMap(allWidgets).filter((w): w is Gtk.Label => w instanceof Gtk.Label);
    expect(labels.map((l) => Gtk.labelGetText(l))).toEqual([risk.extensions["Business Unit"].value]);
    const entry = ws.find((w): w is Gtk.Entry => w instanceof Gtk.Entry);
    if (entry === undefined) throw new Error("no entry");
    const apply = (script: W) => {
      const r = runModelEdit(riskClass, identity<RV>(), modelStartState(newGenerator(), model), (ctx) => {
        const step = script(ctx).next();
        expect(step.done).toBe(true);
        return step.value as Maybe<string>;
      });
      if (r.tag === "Left") throw new Error("script failed");
      const e = M.lookup(risk.identity, r.value[0].updateNewModel.modelContents);
      return [r.value[0].updateValue, e.tag === "Just" ? e.value._entityExtensions : M.empty<string, never>()] as const;
    };
    Gtk.entrySetText(entry, "Bridge");
    entry.emit("activate");
    expect(sent.length).toBe(1);
    const [msg1, exts1] = apply(sent[0]);
    expect(msg1).toEqual(Just("Edited " + risk.contents.name.trim()));
    expect(M.lookup(bu.fieldId, exts1)).toEqual(Just(ExtText("Bridge")));
    Gtk.entrySetText(entry, "");
    entry.emit("activate");
    expect(sent.length).toBe(2);
    const [, exts2] = apply(sent[1]);
    expect(M.member(bu.fieldId, exts2)).toBe(false);
  });

  it("uses the link field for a linked column", () => {
    const pv = M.elems(model.modelFields).find((f) => f._fieldName === "Previous Version")!;
    const risk = risks.find((r) => r.extensions["Previous Version"])!;
    const values = view(entityVariantProperties(riskClass, model), entity(risk.identity));
    const [out] = B.liftMomentIO(() => {
      const initial = GadgetData(true, [risk.identity, values] as readonly [ModelId, ExtensionValues]);
      const o = renderGadget(theme, () => {}, model, initial, pure_Changes(model), B.never(), B.pureB(initial),
        fieldColumn<null, RV>(riskClass, pv, Just(pv.fieldId)));
      return [o] as const;
    });
    const buttons = out.gadgetView.flatMap(allWidgets).filter((w): w is Gtk.LinkButton => w instanceof Gtk.LinkButton);
    expect(buttons.length).toBe(1);
    expect(Gtk.linkButtonGetUri(buttons[0])).toBe(risk.extensions["Previous Version"].value);
  });

  it("wraps matrices in a view", () => {
    const w = getMatrixWrapper(riskClass, null as any, entity(registerId));
    expect(w.tag).toBe("Just");
    if (w.tag === "Just" && w.value.tag === "ViewWrapper") {
      expect(w.value.wrappedEntityId).toBe(registerId);
      expect(w.value.viewTag).toBe("run");
      expect(w.value.viewInitial).toEqual(S.empty());
      expect(w.value.viewInput).toEqual({ tag: "Left", value: null });
    } else {
      throw new Error("not a view wrapper");
    }
    expect(getMatrixWrapper(riskClass, null as any, entity(risksQ))).toEqual(Nothing);
  });

  // ---------------------------------------------------------------------------------------------

  const theme = Gtk.iconThemeGetDefault();
  const allWidgets = (w: Gtk.Widget): Gtk.Widget[] => [w, ...w.getChildren().flatMap(allWidgets)];
  const texts = (ws: readonly Gtk.Widget[]): string[] => ws.flatMap(allWidgets).flatMap((w) => {
    if (w instanceof Gtk.Label) return [Gtk.labelGetText(w)];
    if (w instanceof Gtk.TextView) return [Gtk.textBufferGetText(Gtk.textViewGetBuffer(w))];
    if (w instanceof Gtk.Frame) return [Gtk.frameGetLabel(w) ?? ""];
    if (w instanceof Gtk.Entry) return [Gtk.entryGetText(w)];
    return [];
  });
  type W = ModelScriptAct<null, RV, RV, Maybe<string>>;
  const render = (m: Model<RV>, mId: ModelId) => B.liftMomentIO(() => {
    const initial = GadgetData(true, [S.empty<ModelId>(), null] as [S.Set<ModelId>, null]);
    const o = renderGadget(theme, () => {}, m, initial, pure_Changes(m), B.never(), B.pureB(initial),
      matrixDisplay<null, RV>(riskClass, mId));
    const sent: W[] = [];
    B.subscribeE(o.gadgetEvents, (x) => sent.push(...x));
    return [o, sent] as const;
  });

  it("shows a deleted matrix", () => {
    const [out] = render(model, U.nil);
    expect(texts(out.gadgetView)).toContain("The matrix has been deleted.");
  });

  it("shows the errors of a matrix whose queries do not compile", () => {
    const [out] = render(model2, registerId);
    expect(texts(out.gadgetView).join("\n")).toContain("1: Screen: Query does not exist (deleted?).");
    expect(texts(out.gadgetView)).toContain("Matrix Errors");
  });

  it("shows the matrix and turns edits into scripts", () => {
    const one = { ...matrix, _matrixGroups: [matrix._matrixGroups[0]] };
    const model3: Model<RV> = {
      ...model2,
      modelContents: M.adjust((e: Entity<RV>) => ({ ...e, _entityContents: { tag: "Matrix", _0: one } as RV }),
        registerId, model2.modelContents),
    };
    const [out, sent] = render(model3, registerId);
    const shown = texts(out.gadgetView);
    expect(shown).toContain("Matrix inputs");
    // (The name of the first column group is not shown by forestTable.)
    for (const h of ["Risk", "Number", "Category", "Summary", "Controls", "Rating"]) expect(shown).toContain(h);
    for (const r of risks) expect(shown).toContain(r.contents.name.trim());
    expect(shown).toContain(risks[0].contents.name.trim() + " / " + risks[0].extensions.Category.value);
    expect(shown.filter((s) => s === "Unknown or deleted field.").length).toBe(risks.length);
    expect(shown.filter((s) => s === "Invalid lookup").length).toBe(risks.length);
    expect(shown.filter((s) => s === "No such query").length).toBe(risks.length);
    expect(shown).toContain("Control 1 - Nav Trg");  // A query result.
    expect(shown).toContain("Unacceptable");          // A lookup result.

    // Edit the risk number of the first risk.
    const entries = out.gadgetView.flatMap(allWidgets).filter((w): w is Gtk.Entry => w instanceof Gtk.Entry);
    const first = risks[0];
    const entry = entries.find((e) => Gtk.entryGetText(e) === String(first.extensions["Risk Number"].value));
    if (entry === undefined) throw new Error("no risk number entry");
    Gtk.entrySetText(entry, "4242");
    expect(sent.length).toBe(1);
    const r = runModelEdit(riskClass, identity<RV>(), modelStartState(newGenerator(), model3), (ctx) => {
      const gen = sent[0](ctx);
      const step = gen.next();
      expect(step.done).toBe(true);
      return step.value as Maybe<string>;
    });
    if (r.tag === "Left") throw new Error("script failed");
    expect(r.value[0].updateValue).toEqual(Just("Edited " + first.contents.name.trim()));
    const e2 = M.lookup(first.identity, r.value[0].updateNewModel.modelContents);
    const exts: ExtensionValues = e2.tag === "Just" ? e2.value._entityExtensions : M.empty();
    expect(M.lookup(fid("Risk Number"), exts)).toEqual(Just(ExtInt(4242)));
  });
});
