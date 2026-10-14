import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as M from "@/lib/Data/Map";
import * as S from "@/lib/Data/Set";
import * as J from "@/lib/Data/Aeson";
import { Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { prism, set, view, type Prism } from "@/lib/Control/Lens";
import {
  Entity, JSON_Model, Name, nameText,
} from "@/hades/src/Model/Abstract/PackageTree";
import { type Editable, type HasDiagrams } from "@/hades/src/Model/Abstract/DiagramType";
import type { HadesRender } from "@/hades/src/Hades/GI/BasicShapes";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { reflectiveNames } from "@/hades/src/Model/Reflection/Reflective";
import { Variant } from "@/hades/src/Model/Reflection/Values";
import { Matrix } from "@/hades/src/Model/Matrices/Base";
import { def_LookupTable } from "@/hades/src/Model/Lookups/Base";
import {
  BasicLookup, BasicMatrix, BasicPackage, BasicQuery, JSON_ModelBasics, Reflective_ModelBasics,
  _BasicMatrix, _BasicPackage, _BasicQuery, basicsCanHaveChild, basicsIcon, basicsIsDiagram, basicsMenu,
  basicsName, rootMenu,
  type HasBasics, type ModelBasics,
} from "./BasicTypes";

/** A toy model type: the basic types plus opaque JSON for everything else. */
type TV =
  | { readonly tag: "Basic"; readonly _0: ModelBasics<TV> }
  | { readonly tag: "Other"; readonly _0: J.JSONObject };

const _Basic: Prism<TV, ModelBasics<TV>> = prism(
  (b: ModelBasics<TV>): TV => ({ tag: "Basic", _0: b }),
  (v: TV) => (v.tag === "Basic" ? Right(v._0) : Left(v)),
);
const _Other: Prism<TV, J.JSONObject> = prism(
  (o: J.JSONObject): TV => ({ tag: "Other", _0: o }),
  (v: TV) => (v.tag === "Other" ? Right(v._0) : Left(v)),
);

type TC = HasBasics<TV> & HasDiagrams<HadesRender, TV> & Editable<HadesRender, TV>;

// The model dictionary delegates to the BasicTypes instances, built while it is itself being built.
const basicsJ = (): J.JSONCodec<ModelBasics<TV>> => JSON_ModelBasics(tc);

const tc: TC = {
  reflectiveName: (v) => (v.tag === "Basic" ? basicsR.reflectiveName(v._0) : Variant(String(v._0.type))),
  variantUserLabel: (v) => v,
  get reflectiveDefaults(): readonly TV[] {
    return basicsR.reflectiveDefaults.map((b) => ({ tag: "Basic", _0: b }) as TV);
  },
  reflectiveBuiltIn: (v) => (v.tag === "Basic" ? basicsR.reflectiveBuiltIn(v._0) : []),
  reflectiveGet: (v) => (v.tag === "Basic" ? basicsR.reflectiveGet(v._0) : M.empty()),
  reflectiveSet: (st, v) => (v.tag === "Basic" ? { tag: "Basic", _0: basicsR.reflectiveSet(st, v._0) } : v),
  get reflectiveBuiltInRefs() { return basicsR.reflectiveBuiltInRefs; },
  get reflectiveArrows() { return basicsR.reflectiveArrows; },
  name: _Basic.dot(basicsName<TV>()) as any,
  get _Package() { return _Basic.dot(_BasicPackage<TV>()); },
  entityCanHaveChild: (p) => p.tag === "Basic" && basicsCanHaveChild(tc, p._0),
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: TV): J.Value => (v.tag === "Basic" ? basicsJ().toJSON(v._0) : v._0),
    (val) => J.alt<TV>(
      (x) => ({ tag: "Basic", _0: basicsJ().parseJSON(x) }),
      (x) => J.withObject("Other", (o): TV => ({ tag: "Other", _0: o }), x),
    )(val),
  ),
  packageMetaJ: J.valueJ,
  packageMetaMempty: {},
  packageMetaAppend: (a, b) => ({ ...(a as J.JSONObject), ...(b as J.JSONObject) }),
  get _QueryDiagram() { return _Basic.dot(_BasicQuery<TV>()); },
  queryAvatars: () => [],
  get _Matrix() { return _Basic.dot(_BasicMatrix<TV>()); },
  get _Report() { return _Basic.dot(prism((r: any) => ({ tag: "BasicReport", _0: r }) as ModelBasics<TV>,
    (b: ModelBasics<TV>) => (b.tag === "BasicReport" ? Right(b._0) : Left(b)))); },
  get _LookupTable() { return _Basic.dot(prism((t: any) => BasicLookup<TV>(t),
    (b: ModelBasics<TV>) => (b.tag === "BasicLookup" ? Right(b._0) : Left(b)))); },
  _Basics: _Basic,
  isDiagram: (v) => v.tag === "Basic" && basicsIsDiagram(tc, v._0),
  getDiagramWrapper: () => Nothing,
  diagramEntityTypes: M.empty(),
  diagramMapAvatars: (_f, e) => e,
  editableActivation: () => function* () { return Nothing; },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
};
void _Other;
const basicsR = Reflective_ModelBasics<TV>(tc);

const examplesDir = path.resolve(__dirname, "../../../../dsm/share/examples");
const examples: [string, any][] = fs.readdirSync(examplesDir)
  .filter((f) => f.endsWith(".dsm"))
  .sort()
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(examplesDir, f), "utf8"))]);

const basicTypes: Record<string, ModelBasics<TV>["tag"]> = {
  "package": "BasicPackage",
  "Query Diagram": "BasicQuery",
  "matrix": "BasicMatrix",
  "report": "BasicReport",
  "lookup-table": "BasicLookup",
};

describe("JSON_ModelBasics", () => {
  const codec = JSON_ModelBasics(tc);
  for (const [file, model] of examples) {
    it(`round-trips the basic entities of ${file}`, () => {
      let count = 0;
      for (const ent of model.modelContents) {
        const obj = ent.contents;
        const tag = basicTypes[obj.type];
        if (tag === undefined) continue;
        count++;
        const b = codec.parseJSON(obj);
        expect(b.tag).toBe(tag);
        const out = codec.toJSON(b);
        // Packages and queries are written back exactly; old-format matrices, lookup tables and
        // reports are migrated, and stable from then on.
        if (tag === "BasicPackage" || tag === "BasicQuery") expect(out).toEqual(obj);
        expect(codec.toJSON(codec.parseJSON(out))).toEqual(out);
      }
      expect(count).toBeGreaterThan(0);
    });
  }

  it("loads each example model with the toy model type and writes back the same entities", () => {
    for (const [, model] of examples) {
      const m = JSON_Model(tc).parseJSON(model);
      const out = JSON_Model(tc).toJSON(m) as J.JSONObject;
      const again = JSON_Model(tc).toJSON(JSON_Model(tc).parseJSON(out));
      expect(again).toEqual(out);
    }
  });

  it("rejects unknown types and reads a typeless object as a query", () => {
    expect(() => codec.parseJSON({ type: "widget" })).toThrow(/Unknown entity type: widget/);
    // V0.5 query: no "type" field, so the query parser is tried (and fails on this junk).
    expect(() => codec.parseJSON({ name: "x" })).toThrow();
  });
});

describe("Reflective_ModelBasics", () => {
  it("lists one default per variant without recursing", () => {
    expect(reflectiveNames(basicsR)).toEqual(["Package", "Query", "Matrix", "Report", "Lookup Table"]);
    // The default query's inputs are all the variants of the model type.
    const q = basicsR.reflectiveDefaults[1];
    expect(q.tag).toBe("BasicQuery");
    if (q.tag === "BasicQuery") {
      expect(S.toList(q._0._queryInputs)).toEqual(S.toList(S.fromList(reflectiveNames(tc))));
    }
    expect(basicsR.reflectiveBuiltInRefs).toEqual(mempty_RefTypeTable);
    expect(M.size(basicsR.reflectiveArrows)).toBe(0);
  });

  it("basicsName reads and writes every variant", () => {
    const vals: ModelBasics<TV>[] = [
      BasicPackage<TV>({ _packageName: Name("P"), _packageMeta: {} }),
      BasicMatrix<TV>(Matrix(Name("Mx"), "", S.empty(), [])),
      BasicLookup<TV>({ ...def_LookupTable, _tableName: Name("L") }),
      BasicQuery<TV>(basicsR.reflectiveDefaults[1]._0 as any),
    ];
    for (const v of vals) {
      const v2 = set(basicsName<TV>().dot(nameText), "renamed", v);
      expect(v2.tag).toBe(v.tag);
      expect(view(basicsName<TV>().dot(nameText), v2)).toBe("renamed");
    }
    expect(vals.map((v) => basicsIcon(tc, v)))
      .toEqual(["model-package", "model-matrix", "model-lookup", "model-query"]);
  });
});

describe("menus", () => {
  const labels = (m: { _0: readonly (readonly { menuLabel: string }[])[] }) => m._0.map((g) => g.map((i) => i.menuLabel));
  it("root menu offers the basic insertions around the application menu", () => {
    expect(labels(rootMenu(tc, _Basic, { _0: [[]] }))).toEqual([
      ["Add package"], [], ["Add query", "Add matrix", "Add report", "Add lookup table"],
    ]);
  });
  it("matrix entities get run/edit/export plus the entity menu", () => {
    const ent = Entity<TV>("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000000", M.empty(),
      { tag: "Basic", _0: BasicMatrix(Matrix(Name("Mx"), "", S.empty(), [])) } as TV,
      M.empty(), ["", "2020-01-01"], ["", "2020-01-01"]);
    expect(labels(basicsMenu(tc, _Basic, { _0: [] }, ent))).toEqual([
      ["Run Matrix", "Edit Matrix", "Export to Excel"], ["Properties", "Delete"],
    ]);
  });
});
