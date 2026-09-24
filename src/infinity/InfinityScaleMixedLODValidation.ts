import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";

export interface InfinityScaleMixedLODValidation {
  ready: boolean;
  mixedRelationCount: number;
  invalidTransferSpecCount: number;
  unsupportedRelationCount: number;
  overlappingSimulationRanges: number;
  unresolvedTopology: boolean;
  reasons: string[];
}

/**
 * Structural gate for mixed-LOD execution.
 *
 * This gate intentionally does not certify the physics of a field transfer.
 * It proves only that the execution contract is internally coherent. Entity
 * topology remains unresolved until a topology-preserving coarse/fine boundary
 * representation exists.
 */
export function validateInfinityScaleMixedLOD(
  plan: InfinityScaleExecutionPlan,
  context: InfinityScaleChunkExecutionContext,
): InfinityScaleMixedLODValidation {
  const mixed = context.boundaryTransferSpecs.filter(
    spec => spec.sourceLevel !== spec.targetLevel,
  );
  const invalid = mixed.filter(spec =>
    spec.refinementRatio < 2 ||
    !Number.isInteger(spec.refinementRatio) ||
    (spec.relation === "coarse-to-fine" && spec.operation !== "prolongation") ||
    (spec.relation === "fine-to-coarse" && spec.operation !== "restriction") ||
    (spec.relation === "coarse-to-fine" && spec.readOperation !== "restriction") ||
    (spec.relation === "fine-to-coarse" && spec.readOperation !== "prolongation"),
  );
  const unsupported = mixed.filter(spec =>
    !["coarse-to-fine", "fine-to-coarse"].includes(spec.relation),
  );
  const reasons: string[] = [];

  if (context.overlappingSimulationRangeCount > 0) {
    reasons.push(
      `simulation ownership overlaps: ${context.overlappingSimulationRangeCount}`,
    );
  }
  if (invalid.length > 0) {
    reasons.push(`invalid mixed-LOD transfer specs: ${invalid.length}`);
  }
  if (unsupported.length > 0) {
    reasons.push(`unsupported mixed-LOD relations: ${unsupported.length}`);
  }

  // ENTITY_ID majority reduction cannot prove topology continuity across an
  // LOD boundary. Keep the global capability blocked until an entity-specific
  // boundary representation is implemented.
  const unresolvedTopology = mixed.length > 0;
  if (unresolvedTopology) {
    reasons.push("entity topology continuity across mixed-LOD boundaries is unresolved");
  }

  const ready =
    plan.boundaryReadRelations.length === 0 ||
    (mixed.length > 0 &&
      invalid.length === 0 &&
      unsupported.length === 0 &&
      context.overlappingSimulationRangeCount === 0 &&
      !unresolvedTopology);

  return {
    ready,
    mixedRelationCount: mixed.length,
    invalidTransferSpecCount: invalid.length,
    unsupportedRelationCount: unsupported.length,
    overlappingSimulationRanges: context.overlappingSimulationRangeCount,
    unresolvedTopology,
    reasons,
  };
}
