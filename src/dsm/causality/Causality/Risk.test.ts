import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import * as C from "@/lib/Data/Colour";
import * as Cairo from "@/lib/GI/Cairo";
import * as Gtk from "@/lib/GI/Gtk";
import { Just, Nothing, type Maybe } from "@/lib/Data/Maybe";
import { Left, Right, type Either } from "@/lib/Data/Either";
import { identity, preview, review, set, view, type Prism } from "@/lib/Control/Lens";
import { Colour } from "@/banana-ui/base/Reactive/Banana/Common";
import { newGenerator } from "@/banana-ui/base/Data/UUID/Generate";
import {
  type Diagram, BoundBox, BoxShapeClass_Oval, BoxShapeClass_Parallelogram, BoxShapeClass_Rectangle, Connected,
  DeltaCtx, LineShape, NoBox, Oval, Parallelogram, Point, Rectangle, Unconnected, diagramFromList, diagramToList,
  mkDiagramState,
} from "@/hades/src/Hades/Abstract";
import {
  type HadesRender, closedArrowHead, hadesConfig, layoutText, openArrowHead,
} from "@/hades/src/Hades/GI/BasicShapes";
import { mempty_DiagramAppearance } from "@/hades/src/App/Appearance";
import {
  type Box, Arrow, Avatar_Element, ElemArrow, ElemBox, GenericContext, JSON_Element, mempty_AppearanceDef,
} from "@/hades/src/App/GenericDiagram";
import { Evidence, Trace, traceArrowDash, traceArrowHead } from "@/hades/evidence/Evidence/Model";
import { type EntityWrapper, type ModelScriptAct, DiagramEntity, stepScript } from "@/hades/src/Model/Abstract/DiagramType";
import {
  type Entity, type Model, type ModelEditCtx, type ModelEditState, type ModelError, type ModelId,
  JSON_Model, Name, descriptionField, emptyModel, entityVariantProperties, evalModelEdit, goToEntity,
  mkEntity, mkPackage, modelStartState, modifyRelations, nameField, runModelEdit, show_ModelError,
} from "@/hades/src/Model/Abstract/PackageTree";
import { runLookup, type LookupTable } from "@/hades/src/Model/Lookups/Base";
import { matrixCells } from "@/hades/src/Model/Matrices/Excel";
import type { Matrix } from "@/hades/src/Model/Matrices/Base";
import * as NR from "@/hades/src/Model/Reflection/NamedRelation";
import { append_RefTypeTable, arrowRelations, mkManyToMany } from "@/hades/src/Model/Reflection/References";
import { type ExtValue, ExtInt, ExtNone, ExtText } from "@/hades/src/Model/Reflection/Values";
import { Goal, GsnNodeItem, Solution } from "@/dsm/gsn/GSN/Model";
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
  controlText, drawBowTieControlBox, drawBowTieHazardBox, drawBowTieRiskEventBox, eq_BowTie,
  hazardName, hazardText, isHazardName, read_ArrowType, read_BoxType, riskDiagramEntityTypes,
  riskDiagramWrapper, riskEventName, riskEventText, riskIsDiagram, show_ArrowType, show_BoxType, threatLineName,
} from "./Risk";
import { type TV, _BowTieItem, _Ev, _GsnItem, _Tr, cls, readBowTieModel, tvName } from "./BowTieTestModel";

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
// An independent implementation of the migration of old files (examples 3 and 4 name their
// fields instead of giving their IDs). Haskell: `migrateField = U.generateNamed U.nil . B.unpack .
// T.encodeUtf8`, i.e. a version 5 UUID in the nil name space.

function uuid5Nil(name: string): string {
  const h = createHash("sha1").update(Buffer.concat([Buffer.alloc(16), Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join("-");
}
const isUuid = (s: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * The extensions of an entity as Haskell writes them back: `v .: nm <|> M.mapKeys migrateField
 * <$> v .: nm`, so if any key is not a UUID, every key is migrated.
 */
function migrateExtensions(exts: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(exts).every(isUuid)) return exts;
  return Object.fromEntries(Object.entries(exts).map(([k, v]) => [uuid5Nil(k), v]));
}

/** A diagram appearance as written back: old `{style, name}` fields become `{style, field}`. */
function migrateAppearance(a: any): any {
  return {
    ...a,
    fields: (a.fields as [string, any[]][]).map(([variant, fs1]) => [variant, fs1.map((f) =>
      ("field" in f ? f : { style: f.style, field: uuid5Nil(f.name) }))]),
  };
}

function migrateContents(c: any): any {
  return c?.type === "Bow Tie Diagram" && c.appearance !== undefined ? { ...c, appearance: migrateAppearance(c.appearance) } : c;
}

it("migrates field names as Haskell's migrateField does", () => {
  // Values computed with Python's uuid.uuid5(uuid.UUID(int=0), name).
  expect(uuid5Nil("Description")).toBe("e386bb76-c5dd-5182-b2c8-f76ca3de8f8c");
  expect(uuid5Nil("Severity")).toBe("9173e92b-e5ba-58cc-b843-8df5905810ea");
});

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
    const cases: [J.JSONCodec<any>, any, J.JSONObject][] = [
      [JSON_RiskEvent, RiskEvent(Name("Fire"), "A fire"), { type: "RiskEvent", name: "Fire", text: "A fire" }],
      [JSON_Control, Control(Name("Sprinkler"), "Water"), { type: "Control", name: "Sprinkler", text: "Water" }],
      [JSON_Hazard, Hazard(Name("HAZ-1"), "Heat"), { type: "Hazard", name: "HAZ-1", text: "Heat" }],
    ];
    for (const [codec, v, js] of cases) {
      expect(codec.toJSON(v)).toEqual(js);
      expect(codec.parseJSON(js)).toEqual(v);
      // Every field is required.
      const { text: _text, ...noText } = js;
      expect(J.parseEither((x) => codec.parseJSON(x), noText).tag).toBe("Left");
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

  it.each(examples.map(([f]) => [f]))("reads and writes back every bow tie entity of %s", (f) => {
    const js = examples.find(([n]) => n === f)![1];
    const counts: Record<string, number> = {};
    for (const e of js.modelContents as any[]) {
      const isBowTie = bowTieTypes.includes(e.contents?.type);
      const r = J.parseEither((v) => codec.parseJSON(v), e.contents);
      // Every bow tie entity is a bow tie item, and nothing else is.
      expect(r.tag, JSON.stringify(e.contents).slice(0, 100)).toBe(isBowTie ? "Right" : "Left");
      if (r.tag === "Right") {
        counts[r.value.tag] = (counts[r.value.tag] ?? 0) + 1;
        // Old appearances (field names) are written back migrated, as in Haskell; the rest exactly.
        const out = codec.toJSON(r.value);
        expect(out).toEqual(migrateContents(e.contents));
        // ... and are stable from then on.
        expect(codec.toJSON(codec.parseJSON(out))).toEqual(out);
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

  it("migrates the old appearance of the bow tie diagrams of example 4", () => {
    const js = example("4");
    const old = (js.modelContents as any[]).filter((e) => e.contents.type === "Bow Tie Diagram" &&
      (e.contents.appearance.fields as [string, any[]][]).some(([, fs1]) => fs1.some((x) => "name" in x)));
    expect(old.length).toBeGreaterThan(0);
    const out = codec.toJSON(codec.parseJSON(old[0].contents)) as any;
    const field0 = old[0].contents.appearance.fields[0][1][0];
    expect(out.appearance.fields[0][1][0]).toEqual({ style: field0.style, field: uuid5Nil(field0.name) });
  });

  it.each(examples.map(([f]) => [f]))("loads the whole model %s and writes it back", (f) => {
    const js = examples.find(([n]) => n === f)![1];
    const model = readBowTieModel(js);
    const tags = M.elems(model.modelContents).map((e) => e._entityContents.tag);
    expect(tags.filter((t) => t === "BowTieItem").length)
      .toBe((js.modelContents as any[]).filter((e) => bowTieTypes.includes(e.contents?.type)).length);
    expect(tags.filter((t) => t === "Other").length) // Only the reports are unknown.
      .toBe((js.modelContents as any[]).filter((e) => e.contents?.type === "report").length);
    const out = JSON_Model<TV>(cls).toJSON(model) as any;
    // Packages, matrices and lookup tables are migrated by their own modules (tested there), so
    // only compare the other entities, migrating the old field names independently.
    const entities = (x: any, migrate: boolean) => [...(x.modelContents as any[])]
      .filter((e) => !["package", "matrix", "lookup-table"].includes(e.contents?.type))
      .sort((a, b) => (a.identity < b.identity ? -1 : 1))
      .map((e: any) => (migrate ? { ...e, extensions: migrateExtensions(e.extensions), contents: migrateContents(e.contents) } : e));
    expect(entities(out, false)).toEqual(entities(js, true));
    expect(out.modelRelations).toEqual(js.modelRelations);
    // The migrated model is stable.
    expect(JSON_Model<TV>(cls).toJSON(readBowTieModel(out))).toEqual(out);
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

// ---------------------------------------------------------------------------------------------

describe("risk calculations on the risk data of 3 Managing Risks.dsm", () => {
  const js = example("3");
  const model = readBowTieModel(js);
  const rawRisks = (js.modelContents as any[]).filter((e) => e.contents.type === "RiskEvent");
  const rawRisk = (nm: string): any => rawRisks.find((r) => r.contents.name === nm);
  const rawTable = (nm: string): any => (js.modelContents as any[]).find((e) => e.contents.type === "lookup-table" &&
    e.contents.name === nm).contents;
  const table = (nm: string): LookupTable => {
    for (const e of M.elems(model.modelContents)) {
      const c = e._entityContents;
      if (c.tag === "Lookup" && c._0._tableName._0 === nm) return c._0;
    }
    throw new Error("no table " + nm);
  };
  /** The risk level computed from the raw JSON: the table entry for the entity's two axis values. */
  const expectedLevel = (raw: any, tbl: any): ExtValue => {
    const h = raw.extensions[tbl.horizontal]?.value;
    const v = raw.extensions[tbl.vertical]?.value;
    const entry = (tbl.values as [[any, any], any][]).find(([[a, b]]) => a.value === h && b.value === v);
    return entry === undefined ? ExtNone : ExtText(entry[1].value);
  };
  const props = (uuid: ModelId) => view(entityVariantProperties(cls, model), entityIn(model, uuid));
  const level = (risk: string, nm: string): ExtValue => runLookup(table(nm), props(rawRisk(risk).identity));

  it("reads every risk event with its variant fields", () => {
    expect(rawRisks.length).toBe(16);
    for (const raw of rawRisks) {
      const e = entityIn(model, raw.identity);
      const c = e._entityContents;
      expect(c.tag === "BowTieItem" && c._0.tag).toBe("BowTieRiskEvent");
      expect(cls.reflectiveName(c)).toBe("Bow Tie Event");
      const p = props(raw.identity);
      // The built-in fields come from the bow tie Reflective instance.
      expect(M.lookup(nameField, p)).toEqual(Just(ExtText(raw.contents.name.trim())));
      expect(M.lookup(descriptionField, p)).toEqual(Just(ExtText(raw.contents.text)));
      // The extensions are restricted to the fields of the "Bow Tie Event" variant.
      expect(M.lookup(uuid5Nil("Risk Number"), p)).toEqual(Just(ExtInt(raw.extensions["Risk Number"].value)));
      expect(M.lookup(uuid5Nil("Risk Title"), p)).toEqual(Nothing);
    }
  });

  it.each(["Inherent Risk Level", "Residual Risk Level"])("computes the %s of every risk with its lookup table", (nm) => {
    const tbl = table(nm);
    const raw = rawTable(nm);
    expect([tbl._horizontalAxis, tbl._verticalAxis]).toEqual([uuid5Nil(raw.horizontal), uuid5Nil(raw.vertical)]);
    const levels = rawRisks.map((r) => runLookup(tbl, props(r.identity)));
    expect(levels).toEqual(rawRisks.map((r) => expectedLevel(r, raw)));
    // Nearly every risk has both axis values in the table.
    expect(levels.filter((l) => l.tag !== "ExtNone").length).toBeGreaterThanOrEqual(14);
  });

  it("knows some risk levels", () => {
    // Inherent: Improbable × Catastrophic; Remote × Significant.
    expect(level("Risk 11 - Loss of Steering", "Inherent Risk Level")).toEqual(ExtText("Unacceptable"));
    expect(level("Risk 14 - Loss of Radar", "Inherent Risk Level"))
      .toEqual(expectedLevel(rawRisk("Risk 14 - Loss of Radar"), rawTable("Inherent Risk Level")));
    // Residual: Improbable × Moderate.
    expect(level("Risk 1- Aground at Sea", "Residual Risk Level")).toEqual(ExtText("Acceptable"));
  });

  it("puts the risk levels in the Risk Register matrix", () => {
    const mx = M.elems(model.modelContents).flatMap((e) => {
      const c = e._entityContents;
      return c.tag === "Matrix" && c._0._matrixName._0 === "Risk Register" ? [c._0] : [];
    })[0] as Matrix;
    const [, root] = M.toList(model.modelRoot)[0];
    const r = matrixCells(cls, model, root, mx);
    if (r.tag === "Left") throw new Error(r.value.join("\n"));
    const [cells, warnings] = r.value;
    expect(warnings).toEqual([]);
    const headings = mx._matrixGroups[0]._groupColumns.map((c) => c._columnName);
    const inherentCol = headings.indexOf("Inherent Rating") + 1;
    const residualCol = headings.indexOf("Residual Rating") + 1;
    expect([inherentCol, residualCol]).toEqual([9, 16]);
    const cellText = (row: number, col: number): Maybe<string> => {
      const c = M.lookup([row, col] as const, cells);
      if (c.tag === "Nothing") return Nothing;
      const v = c.value._formattedCell._cellValue;
      return v.tag === "Just" && v.value.tag === "CellText" ? Just(v.value._0) : Nothing;
    };
    const asText = (v: ExtValue): Maybe<string> => (v.tag === "ExtText" ? Just(v._0) : Nothing);
    let rows = 0;
    for (let row = 3; ; row++) {
      const nm = cellText(row, 1);
      if (nm.tag === "Nothing") break;
      rows++;
      const raw = rawRisks.find((x) => x.contents.name.trim() === nm.value);
      expect(raw, nm.value).toBeDefined();
      expect(cellText(row, inherentCol)).toEqual(asText(expectedLevel(raw, rawTable("Inherent Risk Level"))));
      expect(cellText(row, residualCol)).toEqual(asText(expectedLevel(raw, rawTable("Residual Risk Level"))));
    }
    expect(rows).toBe(16);
  });
});

// ---------------------------------------------------------------------------------------------

describe("Reflective", () => {
  const refl = Reflective_BowTie<TV>();
  const haz = BowTieHazard<TV>(Hazard(Name("HAZ-1"), "Heat"));
  const ev = BowTieRiskEvent<TV>(RiskEvent(Name("Fire"), "A fire"));
  const ctrl = BowTieControl<TV>(Control(Name("Sprinkler"), "Water"));
  const isH = BowTieIsHazard<TV>(IsHazard(Name("Is 1")));
  const thr = BowTieThreat<TV>(ThreatLine(Name("Threat 1")));
  const diag = emptyDiagram("Bow Tie 1");
  const all = [haz, ev, ctrl, isH, thr, diag];

  it("names the variants", () => {
    expect(all.map((i) => refl.reflectiveName(i))).toEqual([
      "Hazard", "Bow Tie Event", "Control", "Hazard Arrow", "Threat Line", "Bow Tie Diagram",
    ]);
    expect(refl.variantUserLabel("Bow Tie Event")).toBe("Event");
    expect(refl.variantUserLabel("Threat Line")).toBe("Threat Line");
    expect(Reflective_ModelSubtype<TV>(cls)).toBe(refl); // One shared dictionary.
    expect(refl.reflectiveDefaults).toBe(refl.reflectiveDefaults); // Memoised.
    expect(refl.reflectiveDefaults.map((i) => refl.reflectiveName(i))).toEqual([
      "Hazard", "Bow Tie Event", "Control", "Hazard Arrow", "Threat Line", "Bow Tie Diagram",
    ]);
    expect(refl.reflectiveDefaults.map((i) => view(bowTieName<TV>(), i)._0)).toEqual([
      "HAZ-", "Risk-", "Ctrl-", "is-hazard-", "ThreatLine-", "Bow Tie",
    ]);
    expect(refl.reflectiveDefaults.slice(0, 5)).toEqual([
      BowTieHazard(Hazard(Name("HAZ-"), "")), BowTieRiskEvent(RiskEvent(Name("Risk-"), "")),
      BowTieControl(Control(Name("Ctrl-"), "")), BowTieIsHazard(IsHazard(Name("is-hazard-"))),
      BowTieThreat(ThreatLine(Name("ThreatLine-"))),
    ]);
  });

  it("gets the built-in fields", () => {
    expect(all.map((i) => refl.reflectiveBuiltIn(i))).toEqual([
      [nameField, descriptionField], [nameField, descriptionField], [nameField, descriptionField],
      [nameField], [nameField], [nameField],
    ]);
    expect(refl.reflectiveGet(haz)).toEqual(M.fromList([[nameField, ExtText("HAZ-1")], [descriptionField, ExtText("Heat")]]));
    expect(refl.reflectiveGet(ev)).toEqual(M.fromList([[nameField, ExtText("Fire")], [descriptionField, ExtText("A fire")]]));
    expect(refl.reflectiveGet(ctrl)).toEqual(M.fromList([[nameField, ExtText("Sprinkler")], [descriptionField, ExtText("Water")]]));
    expect(refl.reflectiveGet(isH)).toEqual(M.singleton(nameField, ExtText("Is 1")));
    expect(refl.reflectiveGet(thr)).toEqual(M.singleton(nameField, ExtText("Threat 1")));
    expect(refl.reflectiveGet(diag)).toEqual(M.singleton(nameField, ExtText("Bow Tie 1")));
  });

  it("sets the built-in fields, stripping names", () => {
    const run = (vals: [string, any][], item: BowTie<TV>): [BowTie<TV>, string[]] => {
      const cell = { state: M.fromList(vals) };
      const r = refl.reflectiveSet(cell, item);
      return [r, M.keys(cell.state)];
    };
    expect(run([[nameField, ExtText(" HAZ-2 ")], [descriptionField, ExtText(" d ")], ["x", ExtText("y")]], haz))
      .toEqual([BowTieHazard(Hazard(Name("HAZ-2"), " d ")), ["x"]]);
    expect(run([[descriptionField, ExtText("t")]], ev)).toEqual([BowTieRiskEvent(RiskEvent(Name("Fire"), "t")), []]);
    expect(run([[nameField, ExtText("C ")]], ctrl)).toEqual([BowTieControl(Control(Name("C"), "Water")), []]);
    expect(run([[nameField, ExtText(" I")], [descriptionField, ExtText("d")]], isH))
      .toEqual([BowTieIsHazard(IsHazard(Name("I"))), [descriptionField]]);
    expect(run([[nameField, ExtText(" T ")]], thr)).toEqual([BowTieThreat(ThreatLine(Name("T"))), []]);
    const [d2] = run([[nameField, ExtText(" Renamed  ")]], diag);
    expect(d2.tag === "BowTieDiagram" && d2._0._diagramEntityName).toEqual(Name("Renamed"));
    expect(run([[nameField, ExtInt(3)]], ev)[0]).toEqual(ev); // Wrong type: keep the old value.
  });

  it("declares the reference types and arrows", () => {
    const expected = append_RefTypeTable(
      arrowRelations("Hazard Arrow", ["Bow Tie Event", ...eventVariants], ["Hazard"]),
      append_RefTypeTable(
        arrowRelations("Threat Line", ["Bow Tie Event", ...eventVariants], ["Control", "Bow Tie Event", ...eventVariants]),
        mkManyToMany(controlThreatRelation, ["Control"], ["Threat Line"]),
      ),
    );
    expect(refl.reflectiveBuiltInRefs).toEqual(expected);
    expect(refl.reflectiveArrows).toEqual(M.fromList([
      ["Hazard Arrow", [NR.edgeFromRelation, NR.edgeToRelation]],
      ["Threat Line", [NR.edgeFromRelation, NR.edgeToRelation]],
    ]));
  });
});

describe("entities, optics and small functions", () => {
  const all: BowTie<TV>[] = [
    BowTieHazard(Hazard(Name("H1"), "")),
    BowTieRiskEvent(RiskEvent(Name("E1"), "")),
    BowTieControl(Control(Name("C1"), "")),
    BowTieIsHazard(IsHazard(Name("I1"))),
    BowTieThreat(ThreatLine(Name("T1"))),
    emptyDiagram("D1"),
  ];

  it("has lenses and isos on the records", () => {
    const r = RiskEvent(Name("R"), "t");
    expect([view(riskEventName, r), view(riskEventText, r)]).toEqual([Name("R"), "t"]);
    expect(set(riskEventText, "u", set(riskEventName, Name("S"), r))).toEqual(RiskEvent(Name("S"), "u"));
    const c = Control(Name("C"), "t");
    expect([view(controlName, c), view(controlText, c)]).toEqual([Name("C"), "t"]);
    expect(set(controlText, "u", set(controlName, Name("D"), c))).toEqual(Control(Name("D"), "u"));
    const h = Hazard(Name("H"), "t");
    expect([view(hazardName, h), view(hazardText, h)]).toEqual([Name("H"), "t"]);
    expect(set(hazardText, "u", set(hazardName, Name("G"), h))).toEqual(Hazard(Name("G"), "u"));
    expect(view(threatLineName, ThreatLine(Name("T")))).toEqual(Name("T"));
    expect(review(threatLineName, Name("U"))).toEqual(ThreatLine(Name("U")));
    expect(view(isHazardName, IsHazard(Name("I")))).toEqual(Name("I"));
    expect(review(isHazardName, Name("J"))).toEqual(IsHazard(Name("J")));
  });

  it("names every bow tie entity", () => {
    expect(all.map((b) => view(bowTieName<TV>(), b)._0)).toEqual(["H1", "E1", "C1", "I1", "T1", "D1"]);
    const renamed = all.map((b) => set(bowTieName<TV>(), Name("X"), b));
    expect(renamed.map((b) => view(bowTieName<TV>(), b)._0)).toEqual(all.map(() => "X"));
    expect(renamed.map((b) => b.tag)).toEqual(all.map((b) => b.tag));
  });

  it("has prisms for every variant", () => {
    const prisms = [_BowTieHazard<TV>(), _BowTieRiskEvent<TV>(), _BowTieControl<TV>(), _BowTieIsHazard<TV>(),
      _BowTieThreat<TV>(), _BowTieDiagram<TV>()];
    all.forEach((b, i) => {
      expect(prisms.map((p) => preview(p as Prism<BowTie<TV>, any>, b).tag))
        .toEqual(prisms.map((_p, j) => (i === j ? "Just" : "Nothing")));
    });
    expect(review(_BowTieControl<TV>(), Control(Name("C"), ""))).toEqual(BowTieControl(Control(Name("C"), "")));
    expect(review(_BowTieHazard<TV>(), Hazard(Name("H"), ""))).toEqual(BowTieHazard(Hazard(Name("H"), "")));
  });

  it("knows the diagrams and icons", () => {
    expect(all.map(riskIsDiagram)).toEqual([false, false, false, false, false, true]);
    expect(all.map(bowTieIcon)).toEqual([
      "causal_hazard", "causal_risk_event", "causal_control", "causal_is_hazard", "causal_risk_line", "causal_bowtie",
    ]);
    // Every icon exists in the DSM icon theme.
    const iconDir = path.resolve(__dirname, "../../share/hicolor/scalable/categories");
    for (const i of all.map(bowTieIcon)) expect(fs.existsSync(path.join(iconDir, i + ".svg")), i).toBe(true);
  });

  it("lists the entity types of bow tie diagrams", () => {
    expect(riskDiagramEntityTypes).toEqual(M.singleton("Bow Tie Diagram", ["Hazard", "Bow Tie Event", "Control", "Evidence"]));
  });
});

// ---------------------------------------------------------------------------------------------

describe("the DiagramTypeClass instance", () => {
  it("is cached and inherits the model dictionary", () => {
    expect(DiagramTypeClass_BowTieType(cls)).toBe(dtc);
    expect(dtc._BowTie).toBe(_BowTieItem);
    expect(dtc.diagramTypeName(undefined as any)).toBe("Bow Tie");
    expect(Avatar_Element(dtc)).toBe(ecls);
    expect(ecls.itemType(undefined as any)).toBe("Bow Tie");
  });

  it("makes boxes of the right shapes", () => {
    const bb = BoundBox(Point(0, 0), Point(100, 50));
    expect(boxTypeValues.map((t) => dtc.mkBox("d", "m", t, Nothing, bb).boxShapeClass)).toEqual([
      BoxShapeClass_Parallelogram, BoxShapeClass_Oval, BoxShapeClass_Rectangle, BoxShapeClass_Rectangle,
      BoxShapeClass_Rectangle, BoxShapeClass_Rectangle, BoxShapeClass_Rectangle]);
    const b = dtc.mkBox("d", "m", "ControlBox", Just(["a", 0.5] as const), bb);
    expect([b.boxId, b.boxEntity, b.boxType, b._boxPeg]).toEqual(["d", "m", "ControlBox", Just(["a", 0.5])]);
    expect(b.boxShape).toEqual(Rectangle(bb));
    expect(dtc.mkBox("d", "m", "EventBox", Nothing, bb).boxShape).toEqual(Parallelogram(bb));
    expect(dtc.mkBox("d", "m", "StateBox", Nothing, bb).boxShape).toEqual(Oval(bb));
  });

  it("describes the arrows", () => {
    expect(arrowTypeValues.map((a) => dtc.arrowTailRelation(a))).toEqual(["Arrow Tail", "Arrow Tail", "Trace Tail"]);
    expect(arrowTypeValues.map((a) => dtc.arrowHeadRelation(a))).toEqual(["Arrow Head", "Arrow Head", "Trace Head"]);
    expect(arrowTypeValues.map((a) => dtc.arrowTailExportRelation(a))).toEqual([Nothing, Nothing, Nothing]);
    expect(arrowTypeValues.map((a) => dtc.arrowHeadExportRelation(a))).toEqual([Nothing, Nothing, Nothing]);
    expect(arrowTypeValues.map((a) => dtc.arrowLineDashes(a))).toEqual([[], [], traceArrowDash]);
    expect(arrowTypeValues.map((a) => dtc.arrowDecorations(Nothing, a))).toEqual([[], [], []]);
    expect(dtc.arrowHeadDraw(Nothing, "RiskArrow")).toEqual(openArrowHead(45, 10));
    expect(dtc.arrowHeadDraw(Nothing, "HazardArrow")).toEqual(closedArrowHead(90, 10, false));
    expect(dtc.arrowHeadDraw(Nothing, "TraceArrow")).toBe(traceArrowHead);
  });

  it("pegs controls on threat lines and nothing else", () => {
    const { st, ids } = fixture();
    const arrow = (t: ArrowType) =>
      Arrow<BowTieType<TV>, TV>("a", "m", t, LineShape([Unconnected(Point(0, 0)), Unconnected(Point(1, 1))], []));
    const [r] = inDelta(st, ids.diagram, diagramFromList(ecls, []), (d) =>
      boxTypeValues.flatMap((bt) => arrowTypeValues.map((at) =>
        [bt, at, runPure(dtc.boxCanPeg(d, dtc.mkBox("b", "m", bt, Nothing, NoBox), arrow(at)))] as const)));
    expect(r.filter(([, , p]) => p.tag === "Just")).toEqual([["ControlBox", "RiskArrow", Just(controlThreatRelation)]]);
  });

  it("has no box children", () => {
    const { st, ids } = fixture();
    const b = dtc.mkBox("b", ids.control, "ControlBox", Nothing, BoundBox(Point(0, 0), Point(10, 10)));
    const [[kids, conn]] = inDelta(st, ids.diagram, diagramFromList(ecls, [ElemBox(b)]), (d) =>
      [runPure(dtc.boxChildren(d, b)), runPure(dtc.boxChildConnection(d, b, "x"))] as const);
    expect(kids).toEqual([]);
    expect(conn(Point(3, 4))).toEqual(Point(3, 4));
  });

  it("chooses the avatar for an entity", () => {
    const { st, ids } = fixture();
    const t = (key: string) => dtc.avatarType(_BowTieItem, entity(st, ids[key])._entityContents);
    expect(["hazard", "fire", "control", "isHazard", "threat1", "diagram", "goal", "solution", "evidence", "trace", "pkg"].map(t))
      .toEqual([
        { tag: "SimpleBox", _0: "HazardBox" }, { tag: "SimpleBox", _0: "RiskEventBox" }, { tag: "SimpleBox", _0: "ControlBox" },
        { tag: "SimpleArrow", _0: "HazardArrow" }, { tag: "SimpleArrow", _0: "RiskArrow" }, { tag: "NoAvatar" },
        { tag: "SimpleBox", _0: "GoalBox" }, { tag: "NoAvatar" }, { tag: "SimpleBox", _0: "EvidenceBox" },
        { tag: "SimpleArrow", _0: "TraceArrow" }, { tag: "NoAvatar" },
      ]);
  });

  it("round trips diagram elements through the element codec", () => {
    const codec = JSON_Element(dtc);
    const b = dtc.mkBox("3a6c1b2e-0000-4000-8000-000000000001", "3a6c1b2e-0000-4000-8000-000000000002", "ControlBox",
      Just(["3a6c1b2e-0000-4000-8000-000000000003", 0.25] as const), BoundBox(Point(1, 2), Point(3, 4)));
    const js = codec.toJSON(ElemBox(b));
    expect(js).toEqual({
      boxId: b.boxId, entity: b.boxEntity, type: "ControlBox", peg: ["3a6c1b2e-0000-4000-8000-000000000003", 0.25],
      shape: { p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 } },
    });
    expect(codec.parseJSON(js)).toEqual(ElemBox(b));
    const a = ElemArrow(Arrow<BowTieType<TV>, TV>("3a6c1b2e-0000-4000-8000-000000000003", "3a6c1b2e-0000-4000-8000-000000000004",
      "RiskArrow", LineShape([Unconnected(Point(0, 0)), Connected(Point(5, 5), b.boxId, Nothing)], [])));
    expect(codec.parseJSON(codec.toJSON(a))).toEqual(a);
    expect((codec.toJSON(a) as any).type).toBe("RiskArrow");
  });
});

describe("arrow connection rules", () => {
  const { st, ids } = fixture();
  const bb = BoundBox(Point(0, 0), Point(100, 50));
  const boxes: Box<BowTieType<TV>, TV>[] = boxTypeValues.map((t) => dtc.mkBox("box-" + t, ids.fire, t, Nothing, bb));
  const diagram = diagramFromList(ecls, boxes.map((b) => ElemBox(b)));
  const arrowOf = (typ: ArrowType) =>
    Arrow<BowTieType<TV>, TV>("arr", "e", typ, LineShape([Unconnected(Point(0, 0)), Unconnected(Point(1, 1))], []));
  /** The box types an arrow can connect to. */
  const allowed = (typ: ArrowType, dir: "ConnectionFrom" | "ConnectionTo"): string[] =>
    inDelta(st, ids.diagram, diagram, (d) =>
      boxes.filter((b) => runPure(bowTieArrowCanConnect(cls, d, dir, arrowOf(typ), b, Nothing))).map((b) => b.boxType))[0];

  it("threat lines go from events to events and controls", () => {
    expect(allowed("RiskArrow", "ConnectionFrom")).toEqual(["EventBox", "StateBox", "RiskEventBox"]);
    expect(allowed("RiskArrow", "ConnectionTo")).toEqual(["EventBox", "StateBox", "RiskEventBox", "ControlBox"]);
  });

  it("hazard arrows go from events to hazards", () => {
    expect(allowed("HazardArrow", "ConnectionFrom")).toEqual(["EventBox", "StateBox", "RiskEventBox"]);
    expect(allowed("HazardArrow", "ConnectionTo")).toEqual(["HazardBox"]);
  });

  it("trace arrows go from controls to evidence and goals", () => {
    expect(allowed("TraceArrow", "ConnectionFrom")).toEqual(["ControlBox"]);
    expect(allowed("TraceArrow", "ConnectionTo")).toEqual(["GoalBox", "EvidenceBox"]);
  });

  it("is the arrowCanConnect method", () => {
    const [r] = inDelta(st, ids.diagram, diagram, (d) =>
      boxes.map((b) => runPure(dtc.arrowCanConnect(d, "ConnectionTo", arrowOf("HazardArrow"), b, Nothing))));
    expect(r).toEqual(boxTypeValues.map((t) => t === "HazardBox"));
  });
});

// ---------------------------------------------------------------------------------------------

describe("drawing", () => {
  const style = hadesConfig(Gtk.iconThemeNew());
  const bb = BoundBox(Point(10, 10), Point(210, 130));
  const { st, ids } = fixture();
  const ent = (k: string): Maybe<Entity<TV>> => Just(entity(st, ids[k]));
  const svg = (r: (env: any) => void): string => {
    const s = new Cairo.SvgSurface(400, 300);
    r({ style, cr: s.context() });
    return s.document();
  };
  const shape = (t: BoxType) => dtc.mkBox("d", "m", t, Nothing, BoundBox(Point(0, 0), Point(1, 1)));
  const blue = Just(Colour(C.sRGB24(0, 0, 255)));

  it("draws controls as green rectangles", () => {
    const b = shape("ControlBox");
    const doc = svg(drawBowTieControlBox(b.boxShapeClass, cls, ent("control"), layoutText([], "Body"), Nothing, b.boxShape, bb));
    expect(doc).toMatch(/>Sprinkler<\/text>/);
    expect(doc).toMatch(/>Body<\/text>/);
    expect(doc).toMatch(/fill="rgb\(200, 255, 200\)"/);
    expect(doc).toMatch(/stroke-width="2"/);
    expect(svg(drawBowTieControlBox(b.boxShapeClass, cls, ent("control"), () => {}, blue, b.boxShape, bb)))
      .toMatch(/stroke="rgb\(0, 0, 255\)"/);
    expect(svg(drawBowTieControlBox(b.boxShapeClass, cls, Nothing, () => {}, Nothing, b.boxShape, bb))).toMatch(/>Control<\/text>/);
    // Another kind of entity: the default title.
    expect(svg(drawBowTieControlBox(b.boxShapeClass, cls, ent("fire"), () => {}, Nothing, b.boxShape, bb))).toMatch(/>Control<\/text>/);
  });

  it("draws hazards as yellow rectangles with a thick border", () => {
    const b = shape("HazardBox");
    const doc = svg(drawBowTieHazardBox(b.boxShapeClass, cls, ent("hazard"), () => {}, blue, b.boxShape, bb));
    expect(doc).toMatch(/>HAZ-1<\/text>/);
    expect(doc).toMatch(/fill="rgb\(255, 255, 200\)"/);
    expect(doc).toMatch(/stroke-width="4"/);
    expect(doc).toMatch(/stroke="rgb\(0, 0, 255\)"/);
    expect(svg(drawBowTieHazardBox(b.boxShapeClass, cls, Nothing, () => {}, Nothing, b.boxShape, bb))).toMatch(/>Hazard<\/text>/);
  });

  it("draws events as plain rectangles", () => {
    const b = shape("RiskEventBox");
    const doc = svg(drawBowTieRiskEventBox(b.boxShapeClass, cls, ent("fire"), () => {}, Nothing, b.boxShape, bb));
    expect(doc).toMatch(/>Fire<\/text>/);
    expect(svg(drawBowTieRiskEventBox(b.boxShapeClass, cls, ent("fire"), () => {}, blue, b.boxShape, bb)))
      .toMatch(/stroke="rgb\(0, 0, 255\)"/);
    expect(svg(drawBowTieRiskEventBox(b.boxShapeClass, cls, Nothing, () => {}, Nothing, b.boxShape, bb))).toMatch(/>Event<\/text>/);
    // Even an oval (state box) or a parallelogram (event box) is drawn as a rectangle.
    const rect = svg(drawBowTieRiskEventBox(b.boxShapeClass, cls, ent("fire"), () => {}, Nothing, b.boxShape, bb));
    const outline = (s: string) => s.match(/<path[^>]* d="[^"]*"/)?.[0].replace(/^.* d=/, "");
    for (const t of ["StateBox", "EventBox"] as const) {
      const o = shape(t);
      expect(outline(svg(drawBowTieRiskEventBox(o.boxShapeClass, cls, ent("fire"), () => {}, Nothing, o.boxShape, bb))))
        .toEqual(outline(rect));
    }
  });

  it("draws boxes through the Delta, finding the entities in the model", () => {
    const draw = (key: string, typ: BoxType): string => {
      const b = dtc.mkBox("x", ids[key], typ, Nothing, bb);
      const [doc] = inDelta(st, ids.diagram, diagramFromList(ecls, []), (d) => {
        const f = runPure(dtc.boxTypeDraw(d, b, () => {}, Nothing));
        return svg(f(bb));
      });
      return doc;
    };
    expect(draw("goal", "GoalBox")).toMatch(/>G1<\/text>/);
    expect(draw("evidence", "EvidenceBox")).toMatch(/>Test report<\/text>/);
    expect(draw("fire", "RiskEventBox")).toMatch(/>Fire<\/text>/);
    expect(draw("smoke", "EventBox")).toMatch(/>Smoke<\/text>/);
    expect(draw("sinking", "StateBox")).toMatch(/>Sinking<\/text>/);
    expect(draw("control", "ControlBox")).toMatch(/fill="rgb\(200, 255, 200\)"/);
    expect(draw("hazard", "HazardBox")).toMatch(/>HAZ-1<\/text>/);
    // The prototype box drawn by the tools has the nil entity.
    const [proto] = inDelta(st, ids.diagram, diagramFromList(ecls, []), (d) =>
      svg(runPure(dtc.boxTypeDraw(d, dtc.mkBox("x", "00000000-0000-0000-0000-000000000000", "ControlBox", Nothing, NoBox), () => {}, Nothing))(bb)));
    expect(proto).toMatch(/>Control<\/text>/);
  });
});

// ---------------------------------------------------------------------------------------------

describe("menus, activation, wrapper and toolbar", () => {
  const bowTieOf = (st: ModelEditState<TV>, uuid: ModelId): BowTie<TV> => {
    const c = entity(st, uuid)._entityContents;
    if (c.tag !== "BowTieItem") throw new Error("not a bow tie item");
    return c._0;
  };

  it("has context menus for diagrams and other entities", () => {
    const { st, ids } = fixture();
    const labels = (key: string) =>
      bowTieEntityMenu(cls, entity(st, ids[key]), bowTieOf(st, ids[key]))._0.map((g) => g.map((i) => i.menuLabel));
    expect(labels("diagram")).toEqual([["Open diagram", "Properties", "Clone", "Delete"]]);
    expect(labels("fire")).toEqual([["Properties", "Delete"]]);
    expect(labels("threat1")).toEqual([["Properties", "Delete"]]);
  });

  it("adds bow tie diagrams and items to packages", () => {
    const { st, ids } = fixture();
    const menu = bowTieAddEntityMenu(cls, ids.pkg);
    expect(menu._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Add Bow Tie Diagram", "Bow Tie Items"]]);
    const sub = menu._0[0][1].menuValue;
    if (sub.tag !== "Left") throw new Error("not a submenu");
    expect(sub.value._0.map((g) => g.map((i) => i.menuLabel))).toEqual([["Hazard", "Event", "Control", "Hazard arrow", "Threat line"]]);
    const run = (v: any, s: ModelEditState<TV>) => {
      if (v.tag !== "Right") throw new Error("submenu");
      const r = interpret(s, _BowTieItem, v.value);
      if (r.tag === "Left") throw new Error(show_ModelError(r.value));
      return r.value;
    };
    let s1 = st;
    const results: unknown[] = [];
    for (const item of sub.value._0[0]) {
      const [m, s2, log] = run(item.menuValue, s1);
      results.push([m, log]);
      s1 = s2;
    }
    const [m, s3, log] = run(menu._0[0][0].menuValue, s1);
    expect([m, log]).toEqual([Just("Insert BowTie 1"), ["ScriptProperties"]]);
    expect(results).toEqual([
      [Just("Insert HAZ-2"), ["ScriptProperties"]], [Just("Insert Event 1"), ["ScriptProperties"]],
      [Just("Insert Control 1"), ["ScriptProperties"]], [Just("Insert Hazard arrow 1"), ["ScriptProperties"]],
      [Just("Insert Threat line 1"), ["ScriptProperties"]],
    ]);
    const added = childNames(s3, ids.pkg).filter((n) => !childNames(st, ids.pkg).includes(n));
    expect(added.sort()).toEqual(["BowTie 1", "Control 1", "Event 1", "HAZ-2", "Hazard arrow 1", "Threat line 1"]);
    const icons = M.elems(entity(s3, ids.pkg)._entityChildren).filter((u) => added.includes(nameOf(s3, u)))
      .map((u) => bowTieIcon(bowTieOf(s3, u)));
    expect(icons.sort()).toEqual(["causal_bowtie", "causal_control", "causal_hazard", "causal_is_hazard", "causal_risk_event", "causal_risk_line"]);
  });

  it("opens diagrams and edits other entities on activation", () => {
    const { st, ids } = fixture();
    const r1 = interpret(st, _BowTieItem, bowTieActivation(cls, Just(entity(st, ids.diagram))));
    expect(r1.tag === "Right" && [r1.value[0], r1.value[2]]).toEqual([Nothing, ["ScriptOpenDiagram"]]);
    const r2 = interpret(st, _BowTieItem, bowTieActivation(cls, Just(entity(st, ids.control))));
    expect(r2.tag === "Right" && r2.value[2]).toEqual(["ScriptProperties"]);
    const r3 = interpret(st, _BowTieItem, bowTieActivation(cls, Just(entity(st, ids.pkg))));
    expect(r3.tag === "Right" && [r3.value[0], r3.value[2]]).toEqual([Nothing, []]);
    const r4 = interpret(st, _BowTieItem, bowTieActivationScript(cls)(Nothing));
    expect(r4.tag === "Right" && [r4.value[0], r4.value[2]]).toEqual([Nothing, []]);
  });

  it("wraps bow tie diagrams and gives them the bow tie toolbar", () => {
    const { st, ids } = fixture();
    const e = entity(st, ids.diagram);
    const r = evalModelEdit<TV, BowTie<TV>, Maybe<EntityWrapper<HadesRender, TV>>>(cls, _BowTieItem, st.stateModel,
      (c) => riskDiagramWrapper(cls, c, e));
    if (r.tag !== "Right" || r.value.tag !== "Just" || r.value.value.tag !== "DiagramWrapper") throw new Error("no wrapper");
    const w = r.value.value;
    expect(w.diagramClass).toBe(ecls);
    expect(w.wrappedEntityId).toBe(ids.diagram);
    expect(w.diagramContext.diagramId).toBe(ids.diagram);
    expect(w.diagramMenu).toEqual(Nothing);
    expect(diagramToList(w.diagramToEdit)).toEqual([]);
    const tb = w.diagramToolbar(null as any);
    const expectedLeft = [
      [["causal_risk_event", "Event"], ["causal_hazard", "Hazard"], ["causal_is_hazard", "Hazard arrow"]],
      [["causal_control", "Control"], ["causal_risk_line", "Threat line"]],
      [["trace-arrow", "Trace"]],
      [["basic_comment", "Comment"], ["emblem-symbolic-link", "Link"]],
    ];
    expect(tb.toolbarLeft.map((g) => g.map((t) => [t.toolIcon, t.toolTip]))).toEqual(expectedLeft);
    expect(tb.toolbarRight.map((g) => g.map((t) => t.toolIcon))).toEqual([["align", "align-size", "align-distribute"], ["view-control"]]);
    expect(bowTieToolbar(cls, ids.diagram, ids.pkg).toolbarLeft.map((g) => g.map((t) => [t.toolIcon, t.toolTip]))).toEqual(expectedLeft);
    // Not a diagram.
    expect(evalModelEdit<TV, BowTie<TV>, Maybe<EntityWrapper<HadesRender, TV>>>(cls, _BowTieItem, st.stateModel,
      (c) => riskDiagramWrapper(cls, c, entity(st, ids.fire)))).toEqual(Right(Nothing));
    // Through the model dictionary.
    const r2 = evalModelEdit<TV, TV, Maybe<EntityWrapper<HadesRender, TV>>>(cls, identity<TV>(), st.stateModel,
      (c) => cls.getDiagramWrapper(c, e));
    expect(r2.tag === "Right" && r2.value.tag).toBe("Just");
  });
});
