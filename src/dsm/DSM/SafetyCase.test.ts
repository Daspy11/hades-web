import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import { Just, Nothing } from "@/lib/Data/Maybe";
import { identity, view } from "@/lib/Control/Lens";
import type { Menu } from "@/banana-ui/base/Reactive/Banana/Menu";
import { type Entity, JSON_Model, Name, evalModelEdit, nameText } from "@/hades/src/Model/Abstract/PackageTree";
import * as Causal from "@/dsm/causality/Causality/Model";
import * as S from "@/lib/Data/Set";
import { ModelEditCtx, modelStartState } from "@/hades/src/Model/Abstract/PackageTree";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import type { UserScript } from "@/hades/src/Model/Abstract/DiagramType";
import {
  basicsActivation, lookupEdit, matrixExport, matrixRun, reportPreview, reportRun,
} from "@/hades/src/Model/Abstract/BasicTypes";
import { ReportHtml, ReportRunParameters } from "@/hades/src/Model/Report/Dialogs";
import {
  type SafetyModel, AppearanceClass_CausalType_SafetyModel, JSON_SafetyModel, entityIcon, eq_SafetyModel,
  safetyModelClass, topEditableMenu, topEntityMenu,
} from "./SafetyCase";

const examplesDir = path.resolve(__dirname, "../share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .sort()
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

const modelJ = JSON_Model<SafetyModel>(safetyModelClass);

describe("DSM.SafetyCase", () => {
  it("has the four example models", () => {
    expect(examples.map(([f]) => f)).toEqual([
      "1 Quick Guide to the DSM.dsm", "2 FMEA.dsm", "3 Managing Risks.dsm", "4 Managing Hazards.dsm",
    ]);
  });

  it.each(examples.map(([f]) => [f]))("loads %s as a SafetyModel and writes it back", (f) => {
    const json = examples.find(([n]) => n === f)![1];
    const model = modelJ.parseJSON(json);
    expect(M.size(model.modelContents)).toBeGreaterThan(0);
    for (const e of M.elems(model.modelContents)) expect(typeof entityIcon(e)).toBe("string");
    const out = JSON.parse(JSON.stringify(modelJ.toJSON(model)));
    if (f.startsWith("1 ") || f.startsWith("2 ")) {
      // Current-format files are written back identically.
      expect(out).toEqual(json);
    }
    // Old-format files (3, 4) are migrated on reading (matrices, bow tie appearances); the
    // migrated JSON is stable.
    const model2 = modelJ.parseJSON(out);
    expect(JSON.parse(JSON.stringify(modelJ.toJSON(model2)))).toEqual(out);
    for (const [k, e] of M.toList(model.modelContents)) {
      const e2 = M.lookup(k, model2.modelContents);
      expect(e2.tag).toBe("Just");
      if (e2.tag === "Just") expect(eq_SafetyModel(e._entityContents, e2.value._entityContents)).toBe(true);
    }
  });

  it("every entity of the examples round-trips through JSON_SafetyModel", () => {
    for (const [, json] of examples.slice(0, 2)) {
      const ents = json.modelContents as any[];
      expect(ents.length).toBeGreaterThan(10);
      for (const ent of ents) {
        const v = JSON_SafetyModel.parseJSON(ent.contents);
        expect(JSON.parse(JSON.stringify(JSON_SafetyModel.toJSON(v)))).toEqual(ent.contents);
      }
    }
  });

  it("builds the reflective defaults without recursion", () => {
    const vs = safetyModelClass.reflectiveDefaults.map((v) => safetyModelClass.reflectiveName(v));
    expect(vs).toContain("GSN Diagram");
    expect(vs).toContain("Bow Tie Diagram");
    expect(vs).toContain("Evidence");
    expect(safetyModelClass.variantUserLabel("Bow Tie Event")).toBe("Event");
  });
});

/** The labels of a menu, groups separated by "|", submenus as "label>[...]". */
function menuLabels(m: Menu<unknown>): string[] {
  return m._0.flatMap((group, i) => [
    ...(i > 0 ? ["|"] : []),
    ...group.map((it) => (it.menuValue.tag === "Left"
      ? it.menuLabel + ">[" + menuLabels(it.menuValue.value).join(",") + "]"
      : it.menuLabel)),
  ]);
}

describe("DSM.SafetyCase instances on the example models", () => {
  const model = modelJ.parseJSON(examples.find(([f]) => f.startsWith("1 "))![1]);
  const ents = M.elems(model.modelContents) as Entity<SafetyModel>[];
  const find = (p: (v: SafetyModel) => boolean): Entity<SafetyModel> => ents.find((e) => p(e._entityContents))!;
  const gsnDiagram = find((v) => v.tag === "GsnItem" && v._0.tag === "GsnDiagramItem");
  const bowTie = find((v) => v.tag === "BowTieItem" && v._0.tag === "BowTieDiagram");
  const pkg = find((v) => v.tag === "BasicItem" && v._0.tag === "BasicPackage");
  const report = find((v) => v.tag === "BasicItem" && v._0.tag === "BasicReport");
  const evidence = find((v) => v.tag === "EvidenceItem");

  it("reads an old causal entity as an unsupported package", () => {
    const c = Causal.CausalState<SafetyModel>(Causal.State(Name("Old state"), "", false));
    const json = Causal.JSON_Causal<SafetyModel>(AppearanceClass_CausalType_SafetyModel).toJSON(c);
    const v = JSON_SafetyModel.parseJSON(json);
    expect(v.tag).toBe("BasicItem");
    if (v.tag === "BasicItem" && v._0.tag === "BasicPackage") {
      expect(v._0._0._packageName._0).toBe("Old state (not supported)");
    } else {
      throw new Error("not a package");
    }
  });

  it("names every entity and knows which are diagrams", () => {
    for (const e of ents) expect(typeof view(safetyModelClass.name.dot(nameText), e._entityContents)).toBe("string");
    expect(safetyModelClass.isDiagram(gsnDiagram._entityContents)).toBe(true);
    expect(safetyModelClass.isDiagram(bowTie._entityContents)).toBe(true);
    expect(safetyModelClass.isDiagram(pkg._entityContents)).toBe(false);
    expect(safetyModelClass.entityCanHaveChild(pkg._entityContents, evidence._entityContents)).toBe(true);
    expect(safetyModelClass.entityCanHaveChild(evidence._entityContents, pkg._entityContents)).toBe(false);
    expect([...M.keys(safetyModelClass.diagramEntityTypes)].sort()).toEqual(["Bow Tie Diagram", "GSN Diagram"]);
  });

  it("finds the avatars of GSN and bow tie diagrams", () => {
    expect(safetyModelClass.queryAvatars(gsnDiagram._entityContents).length).toBeGreaterThan(0);
    expect(safetyModelClass.queryAvatars(bowTie._entityContents).length).toBeGreaterThan(0);
    expect(safetyModelClass.queryAvatars(pkg._entityContents)).toEqual([]);
  });

  it("gives diagram wrappers for GSN and bow tie diagrams only", () => {
    const wrapper = (e: Entity<SafetyModel>) =>
      evalModelEdit(safetyModelClass, identity<SafetyModel>(), model,
        (ctx) => safetyModelClass.getDiagramWrapper(ctx, e));
    for (const e of [gsnDiagram, bowTie]) {
      const w = wrapper(e);
      expect(w.tag).toBe("Right");
      if (w.tag === "Right") {
        expect(w.value.tag).toBe("Just");
        if (w.value.tag === "Just") expect(w.value.value.wrappedEntityId).toBe(e.entityId);
      }
    }
    for (const e of [pkg, evidence, report]) expect(wrapper(e)).toEqual({ tag: "Right", value: Nothing });
  });

  it("keeps the diagram avatars when mapped with the identity", () => {
    const e2 = safetyModelClass.diagramMapAvatars((x) => Just(x), gsnDiagram);
    expect(eq_SafetyModel(e2._entityContents, gsnDiagram._entityContents)).toBe(true);
    const e3 = safetyModelClass.diagramMapAvatars((x) => Just(x), evidence);
    expect(e3._entityContents).toBe(evidence._entityContents);
  });

  it("builds the tree menus", () => {
    const root = topEntityMenu(Nothing);
    expect(root.tag).toBe("Just");
    if (root.tag === "Just") {
      expect(menuLabels(root.value)).toEqual([
        "Add package", "|",
        "Add GSN Diagram", "GSN Items>[Goal,Strategy,Solution,Context,Assumption,Justification,Option,|,ContextArrow,SupportArrow]",
        "|", "Add Bow Tie Diagram", "Bow Tie Items>[Hazard,Event,Control,Hazard arrow,Threat line]",
        "|", "Add Evidence", "Add Trace", "|", "Edit diagram style", "|",
        "Add query", "Add matrix", "Add report", "Add lookup table",
      ]);
    }
    const rpt = topEntityMenu(Just(report));
    expect(rpt.tag).toBe("Just");
    if (rpt.tag === "Just") expect(menuLabels(rpt.value).slice(0, 3)).toEqual(["Preview Report", "Write to File", "Edit Report"]);
    const diag = topEditableMenu(Just(gsnDiagram));
    expect(diag.tag).toBe("Just");
    if (diag.tag === "Just") expect(menuLabels(diag.value)).toEqual(["Open Diagram", "Properties", "Find in model"]);
    const ev = topEditableMenu(Just(evidence));
    expect(ev.tag).toBe("Just");
    if (ev.tag === "Just") expect(menuLabels(ev.value)).toEqual(["Properties", "Find in model"]);
    expect(topEditableMenu(Nothing)).toEqual(Nothing);
  });
});

describe("Model.Abstract.BasicTypes scripts on the DSM model", () => {
  const model = modelJ.parseJSON(examples.find(([f]) => f.startsWith("3 "))![1]);
  const ents = M.elems(model.modelContents) as Entity<SafetyModel>[];
  const named = (n: string): Entity<SafetyModel> =>
    ents.find((e) => view(safetyModelClass.name.dot(nameText), e._entityContents) === n)!;
  const newCtx = () => new ModelEditCtx<SafetyModel, SafetyModel>(
    safetyModelClass, identity<SafetyModel>(), { state: modelStartState(newGenerator(), model) });

  /**
   * Run a script, answering its instructions with `answer`; returns the instruction tags (and the
   * dialog's initial value for dialogs) and the script's result.
   */
  function run<A>(script: UserScript<any, SafetyModel, A>, answer: (tag: string, instr: any) => unknown) {
    const log: [string, unknown][] = [];
    let r = script.next();
    while (!r.done) {
      const instr = r.value as any;
      log.push([instr.tag, instr.tag === "ScriptDialog" ? instr._1 : undefined]);
      r = script.next(answer(instr.tag, instr));
    }
    return { log, result: r.value };
  }

  it("matrixExport asks for the input, then writes the workbook in IO", () => {
    const mat = named("Risk Register");
    const risks = named("List of Risks");
    let io: unknown = null;
    const { log, result } = run(matrixExport(safetyModelClass, newCtx(), mat.entityId), (tag, instr) => {
      if (tag === "ScriptDialog") return Just(S.singleton(risks.entityId));
      if (tag === "ScriptPerformIO") { io = instr._0; return null; }
      throw new Error("unexpected " + tag);
    });
    expect(log.map(([t]) => t)).toEqual(["ScriptDialog", "ScriptPerformIO"]);
    expect(typeof io).toBe("function");
    expect(result).toEqual(Nothing);
  });

  it("matrixExport stops when the dialog is cancelled", () => {
    const { log, result } = run(matrixExport(safetyModelClass, newCtx(), named("Risk Register").entityId), () => Nothing);
    expect(log.map(([t]) => t)).toEqual(["ScriptDialog"]);
    expect(result).toEqual(Nothing);
  });

  it("matrixRun opens the matrix view; activation of a lookup table edits it", () => {
    const r1 = run(matrixRun(safetyModelClass, newCtx(), named("Risk Register").entityId), () => null);
    expect(r1.log.map(([t]) => t)).toEqual(["ScriptOpenDiagram"]);
    const r2 = run(lookupEdit(safetyModelClass, newCtx(), named("Inherent Risk Level").entityId), () => null);
    expect(r2.log.map(([t]) => t)).toEqual(["ScriptOpenDiagram"]);
    const r3 = run(basicsActivation(safetyModelClass, newCtx(), named("Inherent Risk Level")), () => null);
    expect(r3.log.map(([t]) => t)).toEqual(["ScriptOpenDiagram"]);
  });

  it("reportRun and reportPreview run the report and do their IO", () => {
    const rpt = named("Risk Report");
    const risk1 = ents.find((e) => view(safetyModelClass.name.dot(nameText), e._entityContents).startsWith("Risk 1"))!;
    for (const script of [reportRun, reportPreview]) {
      const { log, result } = run(script(safetyModelClass, newCtx(), rpt.entityId), (tag) => {
        if (tag === "ScriptDialog") return Just(ReportRunParameters(S.singleton(risk1.entityId), ReportHtml("/download/r")));
        if (tag === "ScriptPerformIO") return null;
        throw new Error("unexpected " + tag);
      });
      expect(log.map(([t]) => t)).toEqual(["ScriptDialog", "ScriptPerformIO"]);
      expect(result).toEqual(Nothing);
    }
  });

  it("scripts on a deleted entity fail as in Haskell", () => {
    const missing = "00000000-0000-0000-0000-00000000abcd";
    expect(() => run(matrixRun(safetyModelClass, newCtx(), missing), () => null)).toThrow();
    expect(() => run(reportPreview(safetyModelClass, newCtx(), missing), () => null)).toThrow();
  });
});
