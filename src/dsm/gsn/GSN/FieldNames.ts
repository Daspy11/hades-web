// Ported from dsm/gsn/GSN/FieldNames.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Constant strings used to identify variants, fields and references in GSN models.
 */
import { ix, previewOrThrow, to } from "@/lib/Control/Lens";
import { builtInFields, fieldsByName, type Field, type FieldId, type FieldName } from "@/hades/src/Model/Reflection/Types";
import { Variant } from "@/hades/src/Model/Reflection/Values";

export const goalVariant: Variant<any> = Variant("Goal");

export const strategyVariant: Variant<any> = Variant("Strategy");

export const solutionVariant: Variant<any> = Variant("Solution");

export const contextVariant: Variant<any> = Variant("Context");

export const assumptionVariant: Variant<any> = Variant("Assumption");

export const justificationVariant: Variant<any> = Variant("Justification");

export const gsnOptionVariant: Variant<any> = Variant("Option");

export const contextArrowVariant: Variant<any> = Variant("Context Arrow");

export const supportArrowVariant: Variant<any> = Variant("Support Arrow");

export const gsnDiagramVariant: Variant<any> = Variant("GSN Diagram");

/** `fieldsByName builtInFields ^?! ix name . to fieldId` */
function builtInFieldId(name: FieldName): FieldId {
  return previewOrThrow(ix<FieldName, Field>(name).dot(to((f: Field) => f.fieldId)), fieldsByName(builtInFields));
}

export const instantiatedField: FieldId = builtInFieldId("Instantiated");

export const developedField: FieldId = builtInFieldId("Developed");

export const cardinalityField: FieldId = builtInFieldId("Cardinality");
