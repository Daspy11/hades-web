// Ported from dsm/causality/Causality/FieldNames.hs. Copyright © Paul Johnson. See LICENSE.
/**
 * Constant strings used to identify variants, fields and references in GSN models.
 */
import { ix, previewOrThrow, to } from "@/lib/Control/Lens";
import type { Relation } from "@/hades/src/Model/Reflection/NamedRelation";
import { builtInFields, fieldsByName, type Field, type FieldId, type FieldName } from "@/hades/src/Model/Reflection/Types";
import { Variant } from "@/hades/src/Model/Reflection/Values";

export const temporalEdgeVariant: Variant<any> = Variant("Sequence Arrow");

export const triggerEdgeVariant: Variant<any> = Variant("Trigger Arrow");

export const guardEdgeVariant: Variant<any> = Variant("Guard Arrow");

export const hazardEdgeVariant: Variant<any> = Variant("Hazard Arrow");

export const threatEdgeVariant: Variant<any> = Variant("Threat Line");

export const causalStateVariant: Variant<any> = Variant("State");

export const causalStateLogicVariant: Variant<any> = Variant("State Logic");

export const causalEventLogicVariant: Variant<any> = Variant("Event Logic");

export const causalInstanceVariant: Variant<any> = Variant("Instance");

export const causalComponentVariant: Variant<any> = Variant("Component");

export const causalHazardVariant: Variant<any> = Variant("Hazard");

export const causalDiagramVariant: Variant<any> = Variant("Causal Diagram");

export const causalControlVariant: Variant<any> = Variant("Control");

export const bowTieDiagramVariant: Variant<any> = Variant("Bow Tie Diagram");

export const bowTieRiskEventVariant: Variant<any> = Variant("Bow Tie Event");

/** `fieldsByName builtInFields ^?! ix name . to fieldId` */
function builtInFieldId(name: FieldName): FieldId {
  return previewOrThrow(ix<FieldName, Field>(name).dot(to((f: Field) => f.fieldId)), fieldsByName(builtInFields));
}

export const hiddenField: FieldId = builtInFieldId("Hidden");

export const inhibitField: FieldId = builtInFieldId("Inhibit");

export const countField: FieldId = builtInFieldId("Count");

export const componentInstanceRelation: Relation = "Component instance";

export const controlThreatRelation: Relation = "Threat control";

export const arrowHeadInstance: Relation = "Instance input";

export const arrowTailInstance: Relation = "Instance output";
