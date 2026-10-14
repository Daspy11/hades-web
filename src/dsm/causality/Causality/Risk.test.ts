import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import * as Cairo from "@/lib/GI/Cairo";
import * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { equals } from "@/lib/Data/Ord";
import { identity, over, preview, review, set, toListOf, view, type Prism } from "@/lib/Control/Lens";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type Diagram, BoundBox, BoxShapeClass_Oval, BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, Connected,
  DeltaCtx, LineShape, NoBox, Oval, Parallelogram, Point, Rectangle, Unconnected, diagramFromList, diagramToList,
  mkDiagramState,
} from "@/hades/src/Hades/Abstract";
import { hadesConfig, layoutText } from "@/hades/src/Hades/GI/BasicShapes";
import { mempty_DiagramAppearance } from "@/hades/src/App/Appearance";
import {
  type Box, Arrow, Avatar_Element, ElemArrow, ElemBox, GenericContext, JSON_Element, mempty_AppearanceDef,
} from "@/hades/src/App/GenericDiagram";
import { Evidence, Trace, evidenceVariant, traceArrowDash, traceArrowHead } from "@/hades/evidence/Evidence/Model";
import { type EntityWrapper, type ModelScriptAct, DiagramEntity, stepScript } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  JSON_Model, Name, Package, descriptionField, emptyModel, entityVariantProperties, evalModelEdit, goToEntity,
  mkEntity, mkPackage, modelStartState, modifyRelations, nameField, runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { runLookup, type LookupTable } from "@/hades/src/Model/Lookups/Base";
import { matrixCells } from "@/hades/src/Model/Matrices/Excel";
import type { Matrix } from "@/hades/src/Model/Matrices/Base";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { append_RefTypeTable, arrowRelations, mkManyToMany } from "@/hades/src/Model/Reflection/References";
import { migrateField } from "@/hades/src/Model/Reflection/Types";
import { ExtInt, ExtNone, ExtText } from "@/hades/src/Model/Reflection/Values";
import { Goal, GsnNodeItem, Solution } from "@/dsm/gsn/GSN/Model";
import { naturalOrder } from "@/hades/src/Text/NaturalOrder";
import { controlThreatRelation } from "./FieldNames";
import { eventVariants } from "./Model";
import {
  type ArrowType, type BowTie, type BowTieType, type BoxType, type ElemBowTie,
  BowTieControl, BowTieDiagram, BowTieHazard, BowTieIsHazard, BowTieRiskEvent, BowTieThreat, Control,
  DiagramTypeClass_BowTieType, Hazard, IsHazard, JSON_ArrowType, JSON_BowTie, JSON_BoxType, JSON_Control,
  JSON_Hazard, JSON_IsHazard, JSON_RiskEvent, JSON_ThreatLine, Reflective_BowTie, Reflective_ModelSubtype,
  RiskEvent, ThreatLine, _BowTieControl, _BowTieDiagram, _BowTieHazard, _BowTieIsHazard, _BowTieRiskEvent,
  _BowTieThreat, arrowTypeValues, bowTieActivation, bowTieActivationScript, bowTieAddEntityMenu,
  bowTieArrowCanConnect, bowTieEntityMenu, bowTieIcon, bowTieName, bowTieToolbar, boxTypeValues, controlName,
  controlText, drawBowTieBox, drawBowTieControlBox, drawBowTieHazardBox, drawBowTieRiskEventBox, eq_BowTie,
  hazardName, hazardText, isHazardName, read_ArrowType, read_BoxType, riskDiagramEntityTypes,
  riskDiagramWrapper, riskEventName, riskEventText, riskIsDiagram, show_ArrowType, show_BoxType, threatLineName,
} from "./Risk";
import { type TV, _BowTieItem, _Ev, _GsnItem, _Tr, cls, readBowTieModel, tvName } from "./testing/BowTieModel";

const dtc = DiagramTypeClass_BowTieType<TV>(cls);
const ecls = Avatar_Element<BowTieType<TV>, TV>(dtc);
type D = ElemBowTie<TV>;

const bowTie = (b: BowTie<TV>): TV => review(_BowTieItem, b);

// ---------------------------------------------------------------------------------------------
// Example files

const examplesDir = path.resolve(__dirname, "../../share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .sort()
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);
const example = (prefix: string): any => examples.find(([f]) => f.startsWith(prefix))![1];

const bowTieTypes = ["Hazard", "RiskEvent", "Control", "IsHazard", "ThreatLine", "Bow Tie Diagram"];

// ---------------------------------------------------------------------------------------------
// Helpers for running edits, scripts and Deltas

function edit<A>(st: ModelEditState<TV>, act: (c: any) => A, prsm: Prism<TV, any> = identity<TV>()): [A, ModelEditState<TV>] {
  const r = runModelEdit(cls, prsm, st, act);
  if (r.tag === "Left") throw new Error(show_ModelError(r.value));
  return [r.value[0].updateValue, r.value[1]];
}

const entityIn = (model: Model<TV>, uuid: ModelId): Entity<TV> => {
  const e = M.lookup(uuid, model.modelContents);
  if (e.tag === "Nothing") throw new Error("missing " + uuid);
  return e.value;
};
const entity = (st: ModelEditState<TV>, uuid: ModelId): Entity<TV> => entityIn(st.stateModel, uuid);
const nameOf = (st: ModelEditState<TV>, uuid: ModelId): string => view(tvName, entity(st, uuid)._entityContents)._0;
const childNames = (st: ModelEditState<TV>, uuid: ModelId): string[] => M.keys(entity(st, uuid)._entityChildren).map((n) => n._0);

/** Run a script to completion, answering a properties dialog with "OK" and no changes. */
function interpret<W, A>(
  st0: ModelEditState<TV>,
  prsm: Prism<TV, W>,
  script: ModelScriptAct<any, TV, W, A>,
): Either<ModelError, [A, ModelEditState<TV>, string[]]> {
  let st = st0;
  let act = script;
  const log: string[] = [];
  for (;;) {
    const r = runModelEdit(cls, prsm, st, (c) => stepScript(c, act));
    if (r.tag === "Left") return Left(r.value);
    const [upd, newState] = r.value;
    const step = upd.updateValue;
    if (step.tag === "Pure") return Right([step._0, newState, log]);
    const instr = step._0;
    log.push(instr.tag);
    st = newState;
    act = step._1(instr.tag === "ScriptProperties" ? Just([entity(newState, instr._0), M.empty()]) : null);
  }
}

/** Run a generator that must not yield (a Delta or script that performs no instructions). */
function runPure<A>(g: Generator<any, A, any>): A {
  const r = g.next();
  if (!r.done) throw new Error("Unexpected instruction: " + JSON.stringify(r.value?.tag));
  return r.value;
}

/** Run a Delta on the diagram `diagId` with the given contents, in a script on the bow tie subtype. */
function inDelta<A>(
  st: ModelEditState<TV>,
  diagId: ModelId,
  diagram: Diagram<D>,
  f: (d: DeltaCtx<D>, c: ModelEditCtx<TV, BowTie<TV>>) => A,
): [A, ModelEditState<TV>] {
  return edit(st, (c) => {
    const d = new DeltaCtx(ecls, { state: mkDiagramState(GenericContext(diagId, mempty_AppearanceDef), 1, diagram) });
    d.base = c;
    return f(d, c);
  }, _BowTieItem);
}

const emptyDiagram = (nm: string): BowTie<TV> =>
  BowTieDiagram<TV>(DiagramEntity(Name(nm), diagramFromList(ecls, []), mempty_DiagramAppearance));

interface Fixture {
  st: ModelEditState<TV>;
  ids: Record<string, ModelId>;
}

/**
 * A small bow tie model: package "Ship" with hazard "HAZ-1", events "Fire", "Smoke" and "Sinking",
 * control "Sprinkler", threat lines "Smoke to fire" and "Fire to sinking", a hazard arrow
 * "Fire is hazard", a bow tie diagram, a GSN goal and solution, evidence "Test report" and a trace.
 */
function fixture(): Fixture {
  const st0 = modelStartState<TV>(newGenerator(), emptyModel<TV>(cls, "Test"));
  const [ids, st] = edit(st0, (c: ModelEditCtx<TV, TV>) => {
    const out: Record<string, ModelId> = {};
    const pkg = mkPackage(c, Name("Ship"));
    out.pkg = pkg;
    const add = (key: string, v: TV): void => {
      goToEntity(c, pkg);
      out[key] = mkEntity(c, v).entityId;
    };
    add("hazard", bowTie(BowTieHazard(Hazard(Name("HAZ-1"), "Fire on board."))));
    add("fire", bowTie(BowTieRiskEvent(RiskEvent(Name("Fire"), "A fire starts."))));
    add("smoke", bowTie(BowTieRiskEvent(RiskEvent(Name("Smoke"), ""))));
    add("sinking", bowTie(BowTieRiskEvent(RiskEvent(Name("Sinking"), ""))));
    add("control", bowTie(BowTieControl(Control(Name("Sprinkler"), "Puts out fires."))));
    add("threat1", bowTie(BowTieThreat(ThreatLine(Name("Smoke to fire")))));
    add("threat2", bowTie(BowTieThreat(ThreatLine(Name("Fire to sinking")))));
    add("isHazard", bowTie(BowTieIsHazard(IsHazard(Name("Fire is hazard")))));
    add("diagram", bowTie(emptyDiagram("Fire Bow Tie")));
    add("goal", review(_GsnItem, GsnNodeItem<TV>(Goal(Name("G1"), "The ship is safe.", true, true))));
    add("solution", review(_GsnItem, GsnNodeItem<TV>(Solution(Name("Sn1"), "Tests.", true))));
    add("evidence", review(_Ev, Evidence(Name("Test report"))));
    add("trace", review(_Tr, Trace(Name("Trace 1"))));
    const rel = (edge: string, from: string, to: string) => {
      modifyRelations(c, (r) => NR.insert(out[edge], out[from], NR.edgeFromRelation, r));
      modifyRelations(c, (r) => NR.insert(out[edge], out[to], NR.edgeToRelation, r));
    };
    rel("threat1", "smoke", "fire");
    rel("threat2", "fire", "sinking");
    rel("isHazard", "fire", "hazard");
    return out;
  });
  return { st, ids };
}

// ---------------------------------------------------------------------------------------------

describe("JSON of the entities", () => {
  it("encodes risk events, controls and hazards", () => {
    const cases: [J.JSONCodec<any>, any, object][] = [
      [JSON_RiskEvent, RiskEvent(Name("Fire"), "A fire"), { type: "RiskEvent", name: "Fire", text: "A fire" }],
      [JSON_Control, Control(Name("Sprinkler"), "Water"), { type: "Control", name: "Sprinkler", text: "Water" }],
      [JSON_Hazard, Hazard(Name("HAZ-1"), "Heat"), { type: "Hazard", name: "HAZ-1", text: "Heat" }],
    ];
    for (const [codec, v, js] of cases) {
      expect(codec.toJSON(v)).toEqual(js);
      expect(codec.parseJSON(js as J.Value)).toEqual(v);
      // Every field is required.
      expect(J.parseEither((x) => codec.parseJSON(x), { ...js, text: undefined }).tag).toBe("Left");
    }
    // Names are stripped when read (JSON_Name).
    expect(JSON_Control.parseJSON({ type: "Control", name: " C1 ", text: "" })).toEqual(Control(Name("C1"), ""));
    expect(J.parseEither((x) => JSON_RiskEvent.parseJSON(x), { type: "Control", name: "C", text: "" }))
      .toEqual(Left('Type = "Control", expected "RiskEvent"'));
    expect(J.parseEither((x) => JSON_Hazard.parseJSON(x), [])).toEqual(Left(expect.stringContaining("Hazard")));
  });

  it("encodes the edges, reading the old name of threat lines", () => {
    expect(JSON_IsHazard.toJSON(IsHazard(Name("H1")))).toEqual({ type: "IsHazard", name: "H1" });
    expect(JSON_IsHazard.parseJSON({ type: "IsHazard", name: "H1" })).toEqual(IsHazard(Name("H1")));
    expect(JSON_ThreatLine.toJSON(ThreatLine(Name("T1")))).toEqual({ type: "ThreatLine", name: "T1" });
    expect(JSON_ThreatLine.parseJSON({ type: "ThreatLine", name: "T1" })).toEqual(ThreatLine(Name("T1")));
    // Early version used incorrect name; it is written back with the new one.
    expect(JSON_ThreatLine.parseJSON({ type: "RiskLine", name: "T2" })).toEqual(ThreatLine(Name("T2")));
    // The second alternative's error is reported, as aeson's (<|>).
    expect(J.parseEither((x) => JSON_ThreatLine.parseJSON(x), { type: "IsHazard", name: "T" }))
      .toEqual(Left('Type = "IsHazard", expected "ThreatLine"'));
    expect(J.parseEither((x) => JSON_ThreatLine.parseJSON(x), { type: "ThreatLine" }).tag).toBe("Left");
  });

  it("encodes box and arrow types with Show and reads them with Read", () => {
    expect(boxTypeValues.map((b) => JSON_BoxType.toJSON(b))).toEqual(boxTypeValues);
    expect(boxTypeValues.map(show_BoxType)).toEqual(boxTypeValues);
    for (const b of boxTypeValues) expect(JSON_BoxType.parseJSON(b)).toBe(b);
    expect(JSON_BoxType.parseJSON(" ( ControlBox ) ")).toBe("ControlBox");
    expect(J.parseEither((v) => JSON_BoxType.parseJSON(v), "Control")).toEqual(Left('Not a Bow Tie Box type: "Control"'));
    expect(J.parseEither((v) => JSON_BoxType.parseJSON(v), 1).tag).toBe("Left");
    expect(arrowTypeValues.map((a) => JSON_ArrowType.toJSON(a))).toEqual(["RiskArrow", "HazardArrow", "TraceArrow"]);
    expect(arrowTypeValues.map(show_ArrowType)).toEqual(arrowTypeValues);
    for (const a of arrowTypeValues) expect(JSON_ArrowType.parseJSON(a)).toBe(a);
    expect(J.parseEither((v) => JSON_ArrowType.parseJSON(v), "ThreatArrow")).toEqual(Left('Not a Bow Tie Arrow type: "ThreatArrow"'));
    expect(read_BoxType("((GoalBox))")).toEqual(Just("GoalBox"));
    expect(read_BoxType("Goal Box")).toEqual(Nothing);
    expect(read_BoxType("goalBox")).toEqual(Nothing);
    expect(read_ArrowType("TraceArrow\n")).toEqual(Just("TraceArrow"));
    expect(read_ArrowType("(RiskArrow")).toEqual(Nothing);
  });

  it("tells the bow tie variants apart", () => {
    const codec = JSON_BowTie(cls);
    expect(JSON_BowTie(cls)).toBe(codec); // Cached.
    const items: BowTie<TV>[] = [
      BowTieHazard(Hazard(Name("HAZ-1"), "h")),
      BowTieRiskEvent(RiskEvent(Name("Fire"), "r")),
      BowTieControl(Control(Name("Sprinkler"), "c")),
      BowTieIsHazard(IsHazard(Name("Is 1"))),
      BowTieThreat(ThreatLine(Name("Threat 1"))),
      emptyDiagram("Bow Tie 1"),
    ];
    for (const i of items) {
      const js = codec.toJSON(i);
      const back = codec.parseJSON(js);
      expect(back.tag).toBe(i.tag);
      expect(eq_BowTie(back, i)).toBe(true);
      expect(codec.toJSON(back)).toEqual(js);
    }
    expect(codec.toJSON(emptyDiagram("D"))).toEqual({
      name: "D", type: "Bow Tie Diagram", contents: [], appearance: { arrowNames: null, fields: [], highlights: [] },
    });
    expect(codec.parseJSON({ type: "RiskLine", name: "Old" })).toEqual(BowTieThreat(ThreatLine(Name("Old"))));
    // A version 0.5 diagram (no type) is read as a bow tie diagram; other diagram types are not.
    expect(codec.parseJSON({ name: "Old", contents: [] }).tag).toBe("BowTieDiagram");
    expect(() => codec.parseJSON({ name: "D", type: "GSN Diagram", contents: [] })).toThrow();
    expect(() => codec.parseJSON({ type: "Goal", name: "G1", text: "" })).toThrow();
  });

  it("has a hand-written Eq", () => {
    const ev = BowTieRiskEvent<TV>(RiskEvent(Name("Fire"), "t"));
    expect(eq_BowTie(ev, BowTieRiskEvent(RiskEvent(Name("Fire"), "t")))).toBe(true);
    expect(eq_BowTie(ev, BowTieRiskEvent(RiskEvent(Name("Fire"), "u")))).toBe(false);
    expect(eq_BowTie(BowTieControl(Control(Name("Fire"), "t")), ev)).toBe(false);
    expect(eq_BowTie(BowTieIsHazard(IsHazard(Name("A"))), BowTieIsHazard(IsHazard(Name("A"))))).toBe(true);
    expect(eq_BowTie(BowTieIsHazard(IsHazard(Name("A"))), BowTieThreat(ThreatLine(Name("A"))))).toBe(false);
    expect(eq_BowTie(emptyDiagram("D"), emptyDiagram("D"))).toBe(true);
    expect(eq_BowTie(emptyDiagram("D"), emptyDiagram("E"))).toBe(false);
  });
});

describe("the example models", () => {
  const codec = JSON_BowTie(cls);

  it.each(examples.map(([f]) => [f]))("reads and writes back every bow tie entity of %s exactly", (f) => {
    const js = examples.find(([n]) => n === f)![1];
    const counts: Record<string, number> = {};
    for (const e of js.modelContents as any[]) {
      const isBowTie = bowTieTypes.includes(e.contents?.type);
      const r = J.parseEither((v) => codec.parseJSON(v), e.contents);
      // Every bow tie entity is a bow tie item, and nothing else is.
      expect(r.tag, JSON.stringify(e.contents).slice(0, 100)).toBe(isBowTie ? "Right" : "Left");
      if (r.tag === "Right") {
        counts[r.value.tag] = (counts[r.value.tag] ?? 0) + 1;
        expect(codec.toJSON(r.value)).toEqual(e.contents);
      }
    }
    const expected: Record<string, Record<string, number>> = {
      "1": { BowTieHazard: 1, BowTieRiskEvent: 6, BowTieControl: 2, BowTieIsHazard: 1, BowTieThreat: 5, BowTieDiagram: 1 },
      "2": { BowTieHazard: 4, BowTieRiskEvent: 18, BowTieControl: 6, BowTieIsHazard: 4, BowTieThreat: 16, BowTieDiagram: 5 },
      "3": { BowTieRiskEvent: 16, BowTieControl: 8 },
      "4": { BowTieHazard: 6, BowTieRiskEvent: 27, BowTieControl: 13, BowTieIsHazard: 6, BowTieThreat: 21, BowTieDiagram: 7 },
    };
    expect(counts).toEqual(expected[f[0]]);
  });

  it.each(examples.map(([f]) => [f]))("loads the whole model %s and writes it back unchanged", (f) => {
    const js = examples.find(([n]) => n === f)![1];
    const model = readBowTieModel(js);
    const tags = M.elems(model.modelContents).map((e) => e._entityContents.tag);
    expect(tags.filter((t) => t === "BowTieItem").length)
      .toBe((js.modelContents as any[]).filter((e) => bowTieTypes.includes(e.contents?.type)).length);
    expect(tags.filter((t) => t === "Other").length) // Only the reports are unknown.
      .toBe((js.modelContents as any[]).filter((e) => e.contents?.type === "report").length);
    const out = JSON_Model<TV>(cls).toJSON(model) as any;
    // Package appearances and old matrices are migrated, so only compare the other entities.
    const sorted = (x: any) => [...(x.modelContents as any[])]
      .filter((e) => !["package", "matrix"].includes(e.contents?.type))
      .sort((a, b) => (a.identity < b.identity ? -1 : 1))
      .map((e: any) => e.contents);
    expect(sorted(out)).toEqual(sorted(js));
    expect(out.modelRelations).toEqual(js.modelRelations);
  });

  it("keeps the pegs of controls on their threat lines", () => {
    const model = readBowTieModel(example("2"));
    const diagrams = M.elems(model.modelContents).flatMap((e) => {
      const v = e._entityContents;
      return v.tag === "BowTieItem" && v._0.tag === "BowTieDiagram" ? [v._0._0] : [];
    });
    expect(diagrams.length).toBe(5);
    let pegs = 0;
    for (const d of diagrams) {
      const els = diagramToList(d._diagramEntityContents);
      for (const el of els) {
        if (el.tag !== "ElemBox" || el._0._boxPeg.tag === "Nothing") continue;
        pegs++;
        expect(el._0.boxType).toBe("ControlBox");
        // The peg names a threat line arrow in the same diagram ...
        const arrowId = el._0._boxPeg.value[0];
        const arrow = els.find((a) => a.tag === "ElemArrow" && a._0.arrowId === arrowId);
        if (arrow?.tag !== "ElemArrow") throw new Error("no arrow");
        expect(arrow._0.arrowType).toBe("RiskArrow");
        // ... and the model relates the control to the threat line.
        expect(NR.member(el._0.boxEntity, arrow._0.arrowEntity, controlThreatRelation, model.modelRelations) ||
          NR.member(arrow._0.arrowEntity, el._0.boxEntity, controlThreatRelation, model.modelRelations)).toBe(true);
      }
    }
    expect(pegs).toBe(10);
  });
});
