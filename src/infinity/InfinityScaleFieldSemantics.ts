import { F } from "../core/CellState";
import type { InfinityScaleLODFieldPolicy } from "./InfinityScaleLODTransfer";

export type InfinityScaleConservationRule =
  | "sum"
  | "average"
  | "circular"
  | "majority"
  | "none";

export interface InfinityScaleFieldSemantics {
  field: number;
  name: string;
  policy: InfinityScaleLODFieldPolicy;
  conservation: InfinityScaleConservationRule;
  /** Baseline semantic status: not a claim about SI units. */
  status: "baseline-model";
  rationale: string;
}

/**
 * Single source of truth for the current LOD transfer semantics.
 *
 * The model currently does not declare SI units for these fields. Therefore
 * "extensive" means only that the present numerical model treats the stored
 * quantity as volume-additive; it is not a physical units assertion.
 */
export const INFINITY_SCALE_FIELD_SEMANTICS: readonly InfinityScaleFieldSemantics[] = [
  { field: F.ENERGY, name: "energy", policy: "extensive", conservation: "sum", status: "baseline-model", rationale: "Current model treats stored energy as volume-additive." },
  { field: F.DENSITY, name: "density", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current model uses a bounded local density state." },
  { field: F.INFORMATION, name: "information", policy: "extensive", conservation: "sum", status: "baseline-model", rationale: "Current model treats stored information as volume-additive." },
  { field: F.ENTROPY, name: "entropy", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current model stores entropy as a bounded local scalar." },
  { field: F.TEMPERATURE, name: "temperature", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current model stores temperature as a local scalar." },
  { field: F.PRESSURE, name: "pressure", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current model stores pressure as a local scalar." },
  { field: F.FIELD_X, name: "field_x", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current baseline treats vector components as local intensive values." },
  { field: F.FIELD_Y, name: "field_y", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current baseline treats vector components as local intensive values." },
  { field: F.FIELD_Z, name: "field_z", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current baseline treats vector components as local intensive values." },
  { field: F.LOCAL_TIME, name: "local_time", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current model treats local time as a state scalar." },
  { field: F.CAUSALITY_ID, name: "causality_id", policy: "discrete", conservation: "majority", status: "baseline-model", rationale: "Identity-like field; arithmetic interpolation is invalid." },
  { field: F.BIO_POTENTIAL, name: "bio_potential", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current model stores a bounded local potential." },
  { field: F.WAVE_PHASE, name: "wave_phase", policy: "circular", conservation: "circular", status: "baseline-model", rationale: "Phase is periodic and requires circular aggregation." },
  { field: F.WAVE_AMP, name: "wave_amp", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current baseline treats amplitude as a local scalar." },
  { field: F.GRAVITY_POT, name: "gravity_pot", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current baseline treats gravity potential as a local scalar." },
  { field: F.MATERIAL_ID, name: "material_id", policy: "discrete", conservation: "majority", status: "baseline-model", rationale: "Material identity is discrete." },
  { field: F.CHEM_STATE, name: "chem_state", policy: "discrete", conservation: "majority", status: "baseline-model", rationale: "Chemical state is represented as a discrete enum." },
  { field: F.SIGNAL, name: "signal", policy: "intensive", conservation: "average", status: "baseline-model", rationale: "Current baseline treats signal as a local scalar." },
  { field: F.MEM_FIELD, name: "mem_field", policy: "extensive", conservation: "sum", status: "baseline-model", rationale: "Current model treats memory field as volume-additive." },
  { field: F.AGENT_MARK, name: "agent_mark", policy: "discrete", conservation: "majority", status: "baseline-model", rationale: "Agent occupancy marker is discrete and topology-sensitive." },
  { field: F.ENTITY_ID, name: "entity_id", policy: "discrete", conservation: "majority", status: "baseline-model", rationale: "Entity identity is discrete; mixed-LOD topology must override naive majority semantics." },
  { field: F.SPARE_1, name: "spare_1", policy: "unsupported", conservation: "none", status: "baseline-model", rationale: "No transfer semantics have been defined." },
  { field: F.SPARE_2, name: "spare_2", policy: "unsupported", conservation: "none", status: "baseline-model", rationale: "No transfer semantics have been defined." },
  { field: F.SPARE_3, name: "spare_3", policy: "unsupported", conservation: "none", status: "baseline-model", rationale: "No transfer semantics have been defined." },
] as const;

const BY_FIELD = new Map(
  INFINITY_SCALE_FIELD_SEMANTICS.map(entry => [entry.field, entry]),
);

export function getInfinityScaleFieldSemantics(field: number): InfinityScaleFieldSemantics {
  const semantics = BY_FIELD.get(field);
  if (!semantics) {
    throw new Error(`No Infinity Scale field semantics registered for field ${field}`);
  }
  return semantics;
}

export function validateInfinityScaleFieldSemantics(): void {
  for (let field = 0; field < 24; field++) getInfinityScaleFieldSemantics(field);
}
