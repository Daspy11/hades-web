import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Gtk from "@/lib/GI/Gtk";
import * as B from "@/lib/Reactive/Banana";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as U from "@/lib/Data/UUID";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { equals } from "@/lib/Data/Ord";
import { Node } from "@/lib/Data/Tree";
import { preview, review, set, view } from "@/lib/Control/Lens";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import { GadgetData, pure_Changes } from "@/banana-ui/base/Reactive/Banana/Common";
import { renderGadget } from "@/banana-ui/gtk/src/Reactive/Banana/GI/ArrowDialog";
import {
  Name, modelStartState, nameField, runModelEdit, withStampFields,
  type Model, type ModelEdit, type ModelId,
} from "@/hades/src/Model/Abstract/PackageTree";
import { migrateField, withBuiltIn } from "@/hades/src/Model/Reflection/Types";
import {
  ColumnGroup, ExprColumn, FieldColumn, FieldColumnData, LookupColumn, Matrix, MatrixColumn, QueryColumn,
  SortOrder, def_FieldColumnData,
} from "./Base";
import {
  DesignColumn, DesignQuery, _DesignColumn, _DesignQuery, canBeParent, columnDesignIso, designItemText, designMenu,
  itemDialog, matrixDelta, matrixDesignGadget, matrixDesignIso, sortOrderGadget, validDesign,
  type Design, type DesignItem, type MatrixDesign,
} from "./Design";
import { findEntity, readRiskModel, riskClass, type RV } from "./testing/RiskModel";

const exampleJson = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../../../../dsm/share/examples/3 Managing Risks.dsm"), "utf8"));
const model: Model<RV> = readRiskModel(exampleJson);
const fid = (n: string) => migrateField(n);
const matrixId = findEntity(model, "Matrix", "Risk Register");
const matrixOf = (mId: ModelId): Matrix => {
  const e = M.lookup(mId, model.modelContents);
  if (e.tag === "Nothing" || e.value._entityContents.tag !== "Matrix") throw new Error("not a matrix");
  return e.value._entityContents._0;
};
const riskRegister = matrixOf(matrixId);
const risksQ = findEntity(model, "Query", "Finding Risks");
const controlsQ = findEntity(model, "Query", "Controls for Risks");
const inherentQ = findEntity(model, "Lookup", "Inherent Risk Level");

const col = (name: string, d: Parameters<typeof MatrixColumn>[1]): DesignItem => DesignColumn(MatrixColumn(name, d));

describe("Design items", () => {
  it("has prisms for both kinds of item", () => {
    const q = DesignQuery(risksQ, SortOrder([[nameField, "Ascending"]]));
    const c = col("N", FieldColumn(def_FieldColumnData));
    expect(preview(_DesignQuery, q)).toEqual(Just([risksQ, SortOrder([[nameField, "Ascending"]])]));
    expect(preview(_DesignQuery, c)).toEqual(Nothing);
    expect(preview(_DesignColumn, c)).toEqual(Just(MatrixColumn("N", FieldColumn(def_FieldColumnData))));
    expect(review(_DesignQuery, [U.nil, SortOrder([])])).toEqual(DesignQuery(U.nil, SortOrder([])));
    expect(canBeParent(q)).toBe(true);
    expect(canBeParent(c)).toBe(false);
  });

  it("describes groups and columns", () => {
    const text = (i: DesignItem) => designItemText(riskClass, model, i);
    expect(text(DesignQuery(risksQ, SortOrder([])))).toBe("Finding Risks");
    expect(text(DesignQuery(risksQ, SortOrder([[nameField, "Ascending"], [fid("Category"), "Descending"]]))))
      .toBe("Finding Risks sorted by Name▲, Category▼");
    // Stamp fields are known in sort orders; unknown ones show as -?-.
    expect(text(DesignQuery(U.nil, SortOrder([[fid("Created"), "Ascending"], [fid("Nonsense"), "Ascending"]]))))
      .toBe("- ? - sorted by Created▲, -?-▲");
    expect(text(col("T", FieldColumn(FieldColumnData(fid("Category"), Nothing))))).toBe("T: Field <Category>");
    expect(text(col("T", FieldColumn(FieldColumnData(fid("Previous Version"), Just(fid("Gone")))))))
      .toBe("T: Field <Previous Version> with link <<deleted>>");
    expect(text(col("T", FieldColumn(FieldColumnData(fid("ModifiedBy"), Nothing))))).toBe("T: Field <ModifiedBy>");
    expect(text(col("F", ExprColumn(false, "1 + 2")))).toBe("F: Formula: 1 + 2");
    expect(text(col("F", ExprColumn(true, "Name")))).toBe("F: Memo formula: Name");
    expect(text(col("Q", QueryColumn(controlsQ)))).toBe("Q: Query <Controls for Risks>");
    expect(text(col("Q", QueryColumn(U.nil)))).toBe("Q: Query <- ? ->");
    expect(text(col("L", LookupColumn(inherentQ)))).toBe("L: Lookup table <Inherent Risk Level>");
  });
});

describe("matrixDesignIso", () => {
  it("round-trips every matrix of the example", () => {
    const matrices = M.elems(model.modelContents).filter((e) => e._entityContents.tag === "Matrix");
    expect(matrices.length).toBe(4);
    for (const e of matrices) {
      const m = (e._entityContents as { _0: Matrix })._0;
      const d = view(matrixDesignIso, m);
      expect(d[0]).toEqual(m._matrixName);
      expect(d[3].length).toBe(m._matrixGroups.length);
      expect(equals(review(matrixDesignIso, d), m)).toBe(true);
    }
  });

  it("turns groups into trees of columns and strips the name", () => {
    const d = view(matrixDesignIso, riskRegister);
    const g = riskRegister._matrixGroups[0];
    expect(d[3]).toEqual([Node(DesignQuery(g._groupQuery, g._groupSort), g._groupColumns.map((c) => Node(DesignColumn(c), [])))]);
    const m2 = review(matrixDesignIso, [Name("  Spaced  "), "D", S.fromList([risksQ]), d[3]] as MatrixDesign);
    expect(m2._matrixName).toEqual(Name("Spaced"));
    expect(m2._matrixDescription).toBe("D");
    expect(m2._matrixDefaultInput).toEqual(S.fromList([risksQ]));
  });

  it("drops items that break the design laws", () => {
    const c = MatrixColumn("C", FieldColumn(def_FieldColumnData));
    const design: Design = [
      Node(DesignColumn(c), []),  // A column at the top level is dropped.
      Node(DesignQuery(risksQ, SortOrder([])), [
        Node(DesignColumn(c), [Node(DesignColumn(c), [])]),  // Children of columns are dropped.
        Node(DesignQuery(controlsQ, SortOrder([])), []),     // Nested groups are dropped.
      ]),
    ];
    expect(review(columnDesignIso, design)).toEqual([ColumnGroup(risksQ, [c], SortOrder([]))]);
  });
});

describe("validDesign", () => {
  const valid = (d: Design) => validDesign(riskClass, model, [], d);
  const group = (...cols: DesignItem[]) => Node(DesignQuery(risksQ, SortOrder([])), cols.map((c) => Node(c, [])));

  it("accepts the example designs", () => {
    for (const e of M.elems(model.modelContents)) {
      if (e._entityContents.tag !== "Matrix") continue;
      expect(valid(view(matrixDesignIso, e._entityContents._0)[3])).toEqual(Nothing);
    }
    expect(valid([])).toEqual(Nothing);
  });

  it("reports the first problem, numbering the groups", () => {
    expect(valid([group(), Node(DesignQuery(U.nil, SortOrder([])), [])]))
      .toEqual(Just("Group 2: Query missing or invalid."));
    expect(valid([group(), Node(col("C", QueryColumn(risksQ)), [])]))
      .toEqual(Just("Item 2: Not a column group."));
    expect(valid([group(col("", FieldColumn(def_FieldColumnData)))])).toEqual(Just("Group 1: Column with no name."));
    expect(valid([group(col("C", FieldColumn(FieldColumnData(fid("Gone"), Nothing))))]))
      .toEqual(Just("Group 1: C: Unknown or deleted field"));
    expect(valid([group(col("C", FieldColumn(FieldColumnData(nameField, Just(fid("Gone"))))))]))
      .toEqual(Just("Group 1: C: Unknown or deleted field"));
    expect(valid([group(col("C", QueryColumn(inherentQ)))])).toEqual(Just("Group 1: C: Query missing or invalid."));
    expect(valid([group(col("C", LookupColumn(risksQ)))])).toEqual(Just("Group 1: C: Lookup table missing or invalid."));
    expect(valid([group(col("C", LookupColumn(inherentQ)), col("D", QueryColumn(controlsQ)))])).toEqual(Nothing);
    const bad = valid([group(col("C", ExprColumn(true, "Name ++")))]);
    expect(bad.tag === "Just" && bad.value.startsWith("Group 1: C: ")).toBe(true);
    expect(valid([group(col("C", ExprColumn(true, "[Business Unit] ++ \" \" ++ Created")))])).toEqual(Nothing);
    expect(valid([Node(DesignQuery(risksQ, SortOrder([])), [Node(col("C", ExprColumn(true, "1")), [Node(col("D", ExprColumn(true, "1")), [])])])]))
      .toEqual(Just("Group 1: C has children."));
    expect(valid([Node(DesignQuery(risksQ, SortOrder([])), [Node(DesignQuery(risksQ, SortOrder([])), [])])]))
      .toEqual(Just("Group 1: Contains another group"));
  });
});

describe("matrixDelta", () => {
  const d0 = view(matrixDesignIso, riskRegister);
  const run = (edit: Maybe<ModelEdit<RV, Matrix, Maybe<string>>>): [Maybe<string>, Matrix] => {
    if (edit.tag === "Nothing") throw new Error("no edit");
    const r = runModelEdit(riskClass, riskClass._Matrix, modelStartState(newGenerator(), model), edit.value);
    if (r.tag === "Left") throw new Error(JSON.stringify(r.value));
    const e = M.lookup(matrixId, r.value[0].updateNewModel.modelContents);
    if (e.tag === "Nothing" || e.value._entityContents.tag !== "Matrix") throw new Error("lost the matrix");
    return [r.value[0].updateValue, e.value._entityContents._0];
  };
  const delta = (v2: MatrixDesign) => matrixDelta(riskClass, matrixId, "RR", [model, d0, v2]);
  const withDesign = (d: Design): MatrixDesign => [d0[0], d0[1], d0[2], d];

  it("does nothing when nothing changed", () => {
    expect(delta(d0)).toEqual(Nothing);
  });

  it("renames, describes and sets the default inputs", () => {
    const [msg1, m1] = run(delta([Name("Register"), d0[1], d0[2], d0[3]]));
    expect(msg1).toEqual(Just("Renamed RR"));
    expect(m1._matrixName).toEqual(Name("Register"));
    const [msg2, m2] = run(delta([d0[0], "New description", d0[2], d0[3]]));
    expect(msg2).toEqual(Just("Edited RR description"));
    expect(m2._matrixDescription).toBe("New description");
    const [msg3, m3] = run(delta([d0[0], d0[1], S.fromList([risksQ]), d0[3]]));
    expect(msg3).toEqual(Just("Edited RR default inputs"));
    expect(m3._matrixDefaultInput).toEqual(S.fromList([risksQ]));
  });

  it("describes edits of the design tree", () => {
    const [grp] = d0[3];
    const cols = grp.subForest;
    const deleted = withDesign([Node(grp.rootLabel, cols.filter((_, i) => i !== 2))]);
    const [msg1, m1] = run(delta(deleted));
    expect(msg1).toEqual(Just("Edit RR: Deleted Business Unit: Field <Business Unit>"));
    expect(m1._matrixGroups[0]._groupColumns.length).toBe(cols.length - 1);
    // Deleting the last column: no differing pair, so the last item of the old design is named.
    const [msg2] = run(delta(withDesign([Node(grp.rootLabel, cols.slice(0, -1))])));
    expect(msg2).toEqual(Just("Edit RR: Deleted Previous Version: Field <Previous Version> with link <Previous Version>"));
    const added = col("New", ExprColumn(true, "1"));
    const [msg3, m3] = run(delta(withDesign([Node(grp.rootLabel, [Node(added, []), ...cols])])));
    expect(msg3).toEqual(Just("Edit RR: Inserted New: Memo formula: 1"));
    expect(m3._matrixGroups[0]._groupColumns[0]).toEqual(MatrixColumn("New", ExprColumn(true, "1")));
    const [msg4] = run(delta(withDesign([Node(grp.rootLabel, [...cols, Node(added, [])])])));
    expect(msg4).toEqual(Just("Edit RR: Inserted New: Memo formula: 1"));
    const changed = withDesign([Node(DesignQuery(grp.rootLabel._0 as ModelId, SortOrder([])), cols)]);
    const [msg5, m5] = run(delta(changed));
    expect(msg5).toEqual(Just("Edit RR: Changed Finding Risks sorted by Name▲"));
    expect(m5._matrixGroups[0]._groupSort).toEqual(SortOrder([]));
  });
});

describe("Design menus and dialogs", () => {
  const labels = (m: ReturnType<typeof designMenu>) => m._0.map((grp) => grp.map((i) => i.menuLabel));

  it("offers a new group on the background", () => {
    const m = designMenu(Nothing);
    expect(labels(m)).toEqual([["Add group"]]);
    const v = m._0[0][0].menuValue;
    expect(v).toEqual({ tag: "Right", value: { tag: "TreeAddAfter", _0: DesignQuery(U.nil, SortOrder([[nameField, "Ascending"]])) } });
  });

  it("offers columns and groups on a group", () => {
    const m = designMenu(Just(DesignQuery(risksQ, SortOrder([]))));
    expect(labels(m)).toEqual([
      ["Add field column", "Add formula column", "Add query column", "Add lookup table column"],
      ["New group before", "New group after"],
      ["Delete group"],
    ]);
    const ops = m._0.flat().map((i) => (i.menuValue.tag === "Right" ? i.menuValue.value : null));
    expect(ops[0]).toEqual({ tag: "TreeAddIn", _0: col("-title-", FieldColumn(FieldColumnData(nameField, Nothing))) });
    expect(ops[1]).toEqual({ tag: "TreeAddIn", _0: col("-title-", ExprColumn(true, "Name ++ \": \" ++ Description")) });
    expect(ops[2]).toEqual({ tag: "TreeAddIn", _0: col("-title-", QueryColumn(U.nil)) });
    expect(ops[3]).toEqual({ tag: "TreeAddIn", _0: col("-title-", LookupColumn(U.nil)) });
    expect(ops[4]?.tag).toBe("TreeAddBefore");
    expect(ops[6]).toEqual({ tag: "TreeDelete" });
  });

  it("offers columns before and after a column", () => {
    const m = designMenu(Just(col("C", QueryColumn(U.nil))));
    expect(labels(m)).toEqual([
      ["Insert field column before", "Insert formula column before", "Insert query column before",
        "Insert lookup table column before"],
      ["Insert field column after", "Insert formula column after", "Insert query column after",
        "Insert lookup table column after"],
      ["Delete column"],
    ]);
  });

  it("selects a dialog for each kind of item", () => {
    const title = (i: DesignItem) => {
      const d = itemDialog(riskClass, i);
      return d.tag === "Just" ? [d.value.dialogTitle, d.value.dialogButtons.tag] : null;
    };
    expect(title(DesignQuery(U.nil, SortOrder([])))).toEqual(["Matrix Column Group", "OkApplyButton"]);
    expect(title(col("C", FieldColumn(def_FieldColumnData)))).toEqual(["Matrix Column", "OkApplyButton"]);
    expect(title(col("C", ExprColumn(true, "")))).toEqual(["Field Column", "OkApplyButton"]);
    expect(title(col("C", QueryColumn(U.nil)))).toEqual(["Query Column", "OkApplyButton"]);
    expect(title(col("C", LookupColumn(U.nil)))).toEqual(["Lookup Column", "OkApplyButton"]);
  });
});

describe("Column dialogs in the GTK toolkit", () => {
  const theme = Gtk.iconThemeGetDefault();
  const allWidgets = (w: Gtk.Widget): Gtk.Widget[] => [w, ...w.getChildren().flatMap(allWidgets)];
  const render = (item: DesignItem) => B.liftMomentIO(() => {
    const d = itemDialog<RV, null>(riskClass, item);
    if (d.tag === "Nothing") throw new Error("no dialog");
    const initial = GadgetData(true, item);
    const o = renderGadget(theme, () => {}, model, initial, pure_Changes(model), B.never(), B.pureB(initial), d.value.dialogGadget);
    const seen: DesignItem[] = [];
    B.subscribeE(o.gadgetUser, (x) => { if (x._gdOk) seen.push(x._gdValue); });
    return [o.gadgetView.flatMap(allWidgets), seen] as const;
  });

  it("offers every field for the text and only URL fields for the link", () => {
    const pv = fid("Previous Version");
    const [ws, seen] = render(col("Old", FieldColumn(FieldColumnData(pv, Just(pv)))));
    const combos = ws.filter((w): w is Gtk.ComboBox => w instanceof Gtk.ComboBox);
    expect(combos.length).toBe(2);
    // Field names sorted, including the built-in and stamp fields.
    const names = M.elems(withStampFields(withBuiltIn(model.modelFields))).map((f) => f._fieldName).sort();
    expect(Gtk.comboBoxGetActive(combos[0])).toBe(names.indexOf("Previous Version"));
    // " - " then the URL fields of the model, in field ID order.
    const urls = M.elems(model.modelFields).filter((f) => f._fieldType.tag === "BuiltInDef" && f._fieldType._0 === "ModelURL");
    expect(urls.length).toBe(2);
    expect(Gtk.comboBoxGetActive(combos[1])).toBe(1 + urls.findIndex((f) => f.fieldId === pv));
    // (The input is not fed back here, so each edit applies to the initial item.)
    Gtk.comboBoxSetActive(combos[1], 0);
    expect(seen.at(-1)).toEqual(col("Old", FieldColumn(FieldColumnData(pv, Nothing))));
    Gtk.comboBoxSetActive(combos[0], names.indexOf("Category"));
    expect(seen.at(-1)).toEqual(col("Old", FieldColumn(FieldColumnData(fid("Category"), Just(pv)))));
  });

  // The tree selectors of the query, lookup and group dialogs: names of the rows, the selected
  // rows, and picking a row by name.
  const treeRows = (vw: Gtk.TreeView): [string, Gtk.TreePath][] => {
    const rows: [string, Gtk.TreePath][] = [];
    Gtk.treeModelForeach(Gtk.treeViewGetModel(vw)!, (m, p, it) => {
      rows.push([Gtk.fromGValue<string>(Gtk.treeModelGetValue(m, it, 0)), p]);
      return false;
    });
    return rows;
  };
  const selectedNames = (vw: Gtk.TreeView): string[] => {
    const [paths, m] = Gtk.treeSelectionGetSelectedRows(Gtk.treeViewGetSelection(vw));
    return paths.map((p) => Gtk.fromGValue<string>(Gtk.treeModelGetValue(m!, Gtk.treeModelGetIter(m!, p)[1], 0)));
  };
  const pick = (vw: Gtk.TreeView, name: string | null): void => {
    const sel = Gtk.treeViewGetSelection(vw);
    Gtk.treeSelectionUnselectAll(sel);
    if (name === null) return;
    const row = treeRows(vw).find(([n]) => n === name);
    if (!row) throw new Error("no row " + name);
    Gtk.treeSelectionSelectPath(sel, row[1]);
  };
  const treeViews = (ws: Gtk.Widget[]): Gtk.TreeView[] => ws.filter((w): w is Gtk.TreeView => w instanceof Gtk.TreeView);
  const treeViewOf = (ws: Gtk.Widget[]): Gtk.TreeView => {
    const vws = treeViews(ws);
    expect(vws.length).toBe(1);
    return vws[0];
  };

  it("picks the query of a query column, the nil query meaning none", () => {
    const [ws, seen] = render(col("Q", QueryColumn(controlsQ)));
    const vw = treeViewOf(ws);
    const names = treeRows(vw).map(([n]) => n);
    expect(names).toContain("Finding Risks");
    expect(names).not.toContain("Inherent Risk Level");
    expect(selectedNames(vw)).toEqual(["Controls for Risks"]);
    pick(vw, "Finding Risks");
    expect(seen.at(-1)).toEqual(col("Q", QueryColumn(risksQ)));
    pick(vw, null);
    expect(seen.at(-1)).toEqual(col("Q", QueryColumn(U.nil)));
  });

  it("picks the lookup table of a lookup column", () => {
    const [ws, seen] = render(col("L", LookupColumn(U.nil)));
    const vw = treeViewOf(ws);
    expect(treeRows(vw).map(([n]) => n)).not.toContain("Finding Risks");
    expect(selectedNames(vw)).toEqual([]);
    pick(vw, "Inherent Risk Level");
    expect(seen.at(-1)).toEqual(col("L", LookupColumn(inherentQ)));
  });

  it("picks the query of a group and shows its sort order", () => {
    const sortByName = SortOrder([[nameField, "Ascending"]]);
    const [ws, seen] = render(DesignQuery(risksQ, sortByName));
    // The query picker, then the sort order table (with its blank row for additions).
    const [vw, sortTable] = treeViews(ws);
    expect(treeViews(ws).length).toBe(2);
    expect(treeRows(sortTable).map(([row]) => row as unknown)).toEqual([["Name", "Ascending"], [" -?- ", "Ascending"]]);
    expect(selectedNames(vw)).toEqual(["Finding Risks"]);
    pick(vw, "Controls for Risks");
    expect(seen.at(-1)).toEqual(DesignQuery(controlsQ, sortByName));
  });

  it("edits the heading and formula of a formula column", () => {
    const [ws, seen] = render(col("F", ExprColumn(false, "Name")));
    const [heading] = ws.filter((w): w is Gtk.Entry => w instanceof Gtk.Entry);
    heading.userSetText("Formula");
    expect(seen.at(-1)).toEqual(col("Formula", ExprColumn(false, "Name")));
    const [tick] = ws.filter((w): w is Gtk.CheckButton => w instanceof Gtk.CheckButton);
    Gtk.toggleButtonSetActive(tick, true);
    expect(seen.at(-1)).toEqual(col("F", ExprColumn(true, "Name")));
  });
});

describe("sortOrderGadget", () => {
  // getInitialEnv $ \model -> focusing (sortOrderIso . extraIso) $ table ...
  const g = sortOrderGadget<RV>(riskClass) as any;
  const focused = g._0(model);
  const lns = focused._0;

  it("shows the sort order as rows of names with a blank row for additions", () => {
    expect(g.tag).toBe("GetInitialEnv");
    expect(focused.tag).toBe("Focusing");
    expect(focused._1.tag).toBe("Table");
    expect(view(lns, SortOrder([[nameField, "Ascending"], [fid("Category"), "Descending"]])))
      .toEqual([["Name", "Ascending"], ["Category", "Descending"], [" -?- ", "Ascending"]]);
    // Unknown fields are dropped; stamp fields are shown.
    expect(view(lns, SortOrder([[fid("Gone"), "Ascending"], [fid("Created"), "Ascending"]])))
      .toEqual([["Created", "Ascending"], [" -?- ", "Ascending"]]);
  });

  it("reads the rows back, dropping blank rows and unknown names", () => {
    const so = set(lns, [["Category", "Descending"], ["  -?-  ", "Descending"], ["Nonsense", "Ascending"], ["Name", "Ascending"]], SortOrder([]));
    expect(so).toEqual(SortOrder([[fid("Category"), "Descending"], [nameField, "Ascending"]]));
    // Stamp fields cannot be chosen (only built-in and model fields are looked up by name).
    expect(set(lns, [["Created", "Ascending"]], SortOrder([]))).toEqual(SortOrder([]));
  });

  it("offers the sorted field names, including the stamps", () => {
    const fieldCol = focused._1._1[0]._0;
    expect(fieldCol.columnName).toBe("Field Name");
    const names: string[] = fieldCol.fieldEditor._0;
    expect(names).toEqual([...names].sort());
    expect(names).toContain("Created");
    expect(names).toContain("Category");
    expect(focused._1._1[1]._0.fieldEditor._1).toEqual(["Ascending", "Descending"]);
    expect(focused._1._0.map((e: any) => e.tag)).toEqual(["TableDelete", "TableShuffle"]);
  });
});

describe("matrixDesignGadget in the GTK toolkit", () => {
  const theme = Gtk.iconThemeGetDefault();
  const allWidgets = (w: Gtk.Widget): Gtk.Widget[] => [w, ...w.getChildren().flatMap(allWidgets)];

  it("shows the design and sends a rename edit", () => {
    const g = matrixDesignGadget(riskClass, matrixId);
    const initial = GadgetData(true, [null, riskRegister] as [null, Matrix]);
    const [out, sent] = B.liftMomentIO(() => {
      const o = renderGadget(theme, () => {}, model, initial, pure_Changes(model), B.never(), B.pureB(initial), g);
      const ws: ModelEdit<RV, Matrix, Maybe<string>>[][] = [];
      B.subscribeE(o.gadgetEvents, (x) => ws.push([...x]));
      return [o, ws] as const;
    });
    const widgets = out.gadgetView.flatMap(allWidgets);
    const entries = widgets.filter((w): w is Gtk.Entry => w instanceof Gtk.Entry);
    expect(Gtk.entryGetText(entries[0])).toBe("Risk Register");
    const views = widgets.filter((w): w is Gtk.TreeView => w instanceof Gtk.TreeView);
    expect(views.length).toBe(1);
    const store = Gtk.treeViewGetModel(views[0]) as Gtk.ForestStore<DesignItem>;
    const forest = Gtk.forestStoreGetForest(store);
    expect(forest.length).toBe(1);
    expect(forest[0].rootLabel).toEqual(DesignQuery(risksQ, SortOrder([[nameField, "Ascending"]])));
    expect(forest[0].subForest.length).toBe(17);

    entries[0].userSetText("Risk Register 2");
    expect(sent.length).toBe(1);
    expect(sent[0].length).toBe(1);
    const r = runModelEdit(riskClass, riskClass._Matrix, modelStartState(newGenerator(), model), sent[0][0]);
    if (r.tag === "Left") throw new Error("edit failed");
    expect(r.value[0].updateValue).toEqual(Just("Renamed Risk Register"));
    const e = M.lookup(matrixId, r.value[0].updateNewModel.modelContents);
    expect(e.tag === "Just" && e.value._entityContents.tag === "Matrix" && e.value._entityContents._0._matrixName)
      .toEqual(Name("Risk Register 2"));
  });
});
