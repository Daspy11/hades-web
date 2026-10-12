/**
 * Test and demo support for the matrix modules (not part of the Haskell sources).
 *
 * A small entity class that can read the DSM example model "3 Managing Risks.dsm": packages,
 * query diagrams, matrices, lookup tables, controls and risk events ("Bow Tie Event" variant,
 * as in `Causality.Risk`), with reports and anything else kept as opaque JSON. Controls and risk
 * events have the built-in Name and Description fields, like the DSM originals.
 *
 * The class implements `EntityClass`, `Queryable`, `HasLookups`, `HasMatrices` and `Editable`
 * (activation and menus do nothing), which is everything `Model.Matrices.{Excel,Screen,Design}`
 * need.
 */
import * as M from "@/lib/Data/Map";
import * as J from "@/lib/Data/Aeson";
import { Nothing } from "@/lib/Data/Maybe";
import { Left, Right } from "@/lib/Data/Either";
import { lens, prism, set, view, type Prism } from "@/lib/Control/Lens";
import {
  JSON_Model, JSON_Package, Name, Package, descriptionField, nameField, nameText,
  type EntityClass, type Model,
} from "@/hades/src/Model/Abstract/PackageTree";
import type { Editable } from "@/hades/src/Model/Abstract/DiagramType";
import { mempty_RefTypeTable } from "@/hades/src/Model/Reflection/References";
import { defaultVariantUserLabel, extract, type Reflective } from "@/hades/src/Model/Reflection/Reflective";
import { ExtText, Variant, _ExtText } from "@/hades/src/Model/Reflection/Values";
import { JSON_LookupTable, Reflective_LookupTable, def_LookupTable, type HasLookups, type LookupTable } from "@/hades/src/Model/Lookups/Base";
import { JSON_Matrix, Reflective_Matrix, matrixName, type HasMatrices, type Matrix } from "@/hades/src/Model/Matrices/Base";
import {
  JSON_QueryDiagram, Reflective_QueryDiagram, queryDiagram, type QueryDiagram,
} from "@/hades/src/Model/Query/Diagram";
import { diagramEntityName } from "@/hades/src/Model/Abstract/DiagramType";

/** The entity type of the example model. */
export type RV =
  | { readonly tag: "Pkg"; readonly _0: Package<RV, J.Value> }
  | { readonly tag: "Query"; readonly _0: QueryDiagram<RV> }
  | { readonly tag: "Matrix"; readonly _0: Matrix }
  | { readonly tag: "Lookup"; readonly _0: LookupTable }
  | { readonly tag: "Item"; readonly type: "Control" | "RiskEvent"; readonly name: Name; readonly text: string }
  | { readonly tag: "Other"; readonly _0: J.JSONObject };

export type RiskClass = EntityClass<RV, J.Value> & HasLookups<RV> & HasMatrices<RV> & Editable<null, RV>;

const rawName = (o: J.JSONObject): string => (typeof o.name === "string" ? o.name : "");

const nameL = lens(
  (v: RV): Name => {
    switch (v.tag) {
      case "Pkg": return v._0._packageName;
      case "Query": return view(queryDiagram<RV>().dot(diagramEntityName()), v._0);
      case "Matrix": return v._0._matrixName;
      case "Lookup": return v._0._tableName;
      case "Item": return v.name;
      default: return Name(rawName(v._0));
    }
  },
  (v: RV, n: Name): RV => {
    switch (v.tag) {
      case "Pkg": return { tag: "Pkg", _0: { ...v._0, _packageName: n } };
      case "Query": return { tag: "Query", _0: set(queryDiagram<RV>().dot(diagramEntityName()), n, v._0) };
      case "Matrix": return { tag: "Matrix", _0: set(matrixName, n, v._0) };
      case "Lookup": return { tag: "Lookup", _0: { ...v._0, _tableName: n } };
      case "Item": return { ...v, name: n };
      default: return { tag: "Other", _0: { ...v._0, name: n._0 } };
    }
  },
);

const mkPrism = <A>(tag: "Pkg" | "Query" | "Matrix" | "Lookup"): Prism<RV, A> => prism(
  (a: A) => ({ tag, _0: a }) as unknown as RV,
  (v: RV) => (v.tag === tag ? Right((v as unknown as { _0: A })._0) : Left(v)),
);

let queryRefl: Reflective<QueryDiagram<RV>> | null = null;
const queryR = (): Reflective<QueryDiagram<RV>> => (queryRefl ??= Reflective_QueryDiagram(riskClass));

const pkgJ = (): J.JSONCodec<Package<RV, J.Value>> => JSON_Package(riskClass);
const queryJ = (): J.JSONCodec<QueryDiagram<RV>> => JSON_QueryDiagram(riskClass);

/** `EntityClass`, `Queryable`, `HasLookups`, `HasMatrices` and `Editable` for "RV". */
export const riskClass: RiskClass = {
  reflectiveName: (v) => {
    switch (v.tag) {
      case "Pkg": return Variant("Package");
      case "Query": return queryR().reflectiveName(v._0);
      case "Matrix": return Reflective_Matrix.reflectiveName(v._0);
      case "Lookup": return Reflective_LookupTable.reflectiveName(v._0);
      case "Item": return Variant(v.type === "Control" ? "Control" : "Bow Tie Event");
      default: return Variant(String(v._0.type ?? "Other"));
    }
  },
  variantUserLabel: defaultVariantUserLabel,
  get reflectiveDefaults(): readonly RV[] {
    return [
      { tag: "Pkg", _0: Package(Name(""), {}) },
      { tag: "Query", _0: queryR().reflectiveDefaults[0] },
      { tag: "Matrix", _0: Reflective_Matrix.reflectiveDefaults[0] },
      { tag: "Lookup", _0: def_LookupTable },
      { tag: "Item", type: "Control", name: Name(""), text: "" },
      { tag: "Item", type: "RiskEvent", name: Name(""), text: "" },
    ];
  },
  reflectiveBuiltIn: (v) => {
    switch (v.tag) {
      case "Query": return queryR().reflectiveBuiltIn(v._0);
      case "Matrix": return Reflective_Matrix.reflectiveBuiltIn(v._0);
      case "Lookup": return Reflective_LookupTable.reflectiveBuiltIn(v._0);
      case "Item": return [nameField, descriptionField];
      default: return [nameField];
    }
  },
  reflectiveGet: (v) => {
    switch (v.tag) {
      case "Query": return queryR().reflectiveGet(v._0);
      case "Matrix": return Reflective_Matrix.reflectiveGet(v._0);
      case "Lookup": return Reflective_LookupTable.reflectiveGet(v._0);
      case "Item": return M.fromList([[nameField, ExtText(v.name._0)], [descriptionField, ExtText(v.text)]]);
      default: return M.singleton(nameField, ExtText(view(nameL.dot(nameText), v)));
    }
  },
  reflectiveSet: (st, v) => {
    switch (v.tag) {
      case "Query": return { tag: "Query", _0: queryR().reflectiveSet(st, v._0) };
      case "Matrix": return { tag: "Matrix", _0: Reflective_Matrix.reflectiveSet(st, v._0) };
      case "Lookup": return { tag: "Lookup", _0: Reflective_LookupTable.reflectiveSet(st, v._0) };
      case "Item": {
        const name = Name(extract(st, v.name._0, _ExtText, nameField).trim());
        const text = extract(st, v.text, _ExtText, descriptionField);
        return { ...v, name, text };
      }
      default: return set(nameL.dot(nameText), extract(st, view(nameL.dot(nameText), v), _ExtText, nameField), v);
    }
  },
  reflectiveBuiltInRefs: mempty_RefTypeTable,
  reflectiveArrows: M.empty(),
  name: nameL,
  _Package: mkPrism<Package<RV, J.Value>>("Pkg"),
  entityCanHaveChild: (p) => p.tag === "Pkg",
  entityCanMove: () => true,
  entityExports: () => [],
  entityClone: () => Nothing,
  entityFunctions: M.empty(),
  entityJ: J.codec(
    (v: RV): J.Value => {
      switch (v.tag) {
        case "Pkg": return pkgJ().toJSON(v._0);
        case "Query": return queryJ().toJSON(v._0);
        case "Matrix": return JSON_Matrix.toJSON(v._0);
        case "Lookup": return JSON_LookupTable.toJSON(v._0);
        case "Item": return J.object([["type", v.type], ["name", v.name._0], ["text", v.text]]);
        default: return v._0;
      }
    },
    (val) => J.withObject("RV", (o): RV => {
      switch (o.type) {
        case "package": return { tag: "Pkg", _0: pkgJ().parseJSON(o) };
        case "matrix": return { tag: "Matrix", _0: JSON_Matrix.parseJSON(o) };
        case "lookup-table": return { tag: "Lookup", _0: JSON_LookupTable.parseJSON(o) };
        case "Control":
        case "RiskEvent":
          return { tag: "Item", type: o.type, name: Name(J.field(o, "name", J.textJ).trim()), text: J.field(o, "text", J.textJ) };
        default:
          return "diagram" in o ? { tag: "Query", _0: queryJ().parseJSON(o) } : { tag: "Other", _0: o };
      }
    }, val),
  ),
  packageMetaJ: J.valueJ,
  packageMetaMempty: {},
  packageMetaAppend: (a, b) => ({ ...(a as J.JSONObject), ...(b as J.JSONObject) }),
  _QueryDiagram: mkPrism<QueryDiagram<RV>>("Query"),
  queryAvatars: () => [],
  _LookupTable: mkPrism<LookupTable>("Lookup"),
  _Matrix: mkPrism<Matrix>("Matrix"),
  // Editable: nothing happens on activation, and there are no menus.
  editableActivation: () => function* () { return Nothing; },
  editableTreeMenu: () => Nothing,
  editableDisplayMenu: () => Nothing,
};

/** Read a model (e.g. the parsed JSON of "3 Managing Risks.dsm"). */
export function readRiskModel(json: J.Value): Model<RV, J.Value> {
  return JSON_Model(riskClass).parseJSON(json);
}

/** Find an entity by name and tag. */
export function findEntity(model: Model<RV>, tag: RV["tag"], name: string): string {
  for (const [mId, e] of M.toList(model.modelContents)) {
    if (e._entityContents.tag === tag && view(nameL.dot(nameText), e._entityContents) === name) return mId;
  }
  throw new Error("No " + tag + " called " + name);
}

