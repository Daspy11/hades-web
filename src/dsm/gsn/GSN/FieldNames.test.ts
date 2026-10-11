import { expect, test } from "vitest";
import * as M from "@/lib/Data/Map";
import { builtInFields } from "@/hades/src/Model/Reflection/Types";
import * as G from "./FieldNames";
import * as C from "@/dsm/causality/Causality/FieldNames";

test("GSN and causality field names resolve to built-in fields", () => {
  const nameOf = (fid: string) => {
    const f = M.lookup(fid, builtInFields);
    return f.tag === "Just" ? f.value._fieldName : null;
  };
  expect(nameOf(G.instantiatedField)).toBe("Instantiated");
  expect(nameOf(G.developedField)).toBe("Developed");
  expect(nameOf(G.cardinalityField)).toBe("Cardinality");
  expect(nameOf(C.hiddenField)).toBe("Hidden");
  expect(nameOf(C.inhibitField)).toBe("Inhibit");
  expect(nameOf(C.countField)).toBe("Count");
  expect(G.goalVariant).toBe("Goal");
  expect(C.bowTieRiskEventVariant).toBe("Bow Tie Event");
  expect(C.arrowTailInstance).toBe("Instance output");
});
