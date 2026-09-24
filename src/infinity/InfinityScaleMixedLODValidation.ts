import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { EntityChunkConnectivityResult } from "./EntityChunkConnectivity";
import type { EntityReconciliationPlan } from "./EntityChunkReconciliation";
import {
  validateInfinityScaleBoundaryChunks,
  validateInfinityScaleBoundaryCoverage,
  type InfinityScaleBoundaryCoverageValidation,
} from "./InfinityScaleLODBoundaryGeometry";

export interface InfinityScaleMixedLODValidation {
  ready: boolean;
  mixedRelationCount: number;
  invalidTransferSpecCount: number;
  unsupportedRelationCount: number;
  overlappingSimulationRanges: number;
  invalidBoundaryGeometryCount: number;
  invalidBoundaryCoverageCount: number;
  boundaryCoverage: InfinityScaleBoundaryCoverageValidation[];
  unresolvedTopology: boolean;
  topologyRepresentationReady: boolean;
  ambiguousTopologyComponentCount: number;
  reconciliationReady: boolean;
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
  entityTopology?: EntityChunkConnectivityResult,
  reconciliation?: EntityReconciliationPlan,
): InfinityScaleMixedLODValidation {
  const mixed = context.boundaryTransferSpecs.filter(
    spec => spec.sourceLevel !== spec.targetLevel,
  );
  const invalidGeometry = mixed.filter(spec =>
    !validateInfinityScaleBoundaryChunks(spec, context.chunkSize),
  );
  const boundaryCoverage = mixed.map(spec =>
    validateInfinityScaleBoundaryCoverage(spec, context.chunkSize),
  );
  const invalidBoundaryCoverageCount = boundaryCoverage.filter(result => !result.valid).length;
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
  const reconciliationReady = mixed.length === 0 || reconciliation?.commitReady === true;
  const topologyRepresentationReady = mixed.length === 0 || !!entityTopology;
  const ambiguousTopologyComponentCount = entityTopology
    ? entityTopology.components.filter(component => {
        if (!component.touchesMixedLODBoundary) return false;
        const ids = entityTopology.mixedLodTopology
          .filter(sample => component.cells.includes(sample.localCell) && sample.occupied)
          .map(sample => sample.sourceEntityId);
        return new Set(ids).size > 1;
      }).length
    : 0;

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
  if (invalidGeometry.length > 0) {
    reasons.push(`invalid mixed-LOD boundary geometry: ${invalidGeometry.length}`);
  }
  if (invalidBoundaryCoverageCount > 0) {
    reasons.push(`invalid mixed-LOD boundary coverage: ${invalidBoundaryCoverageCount}`);
  }

  // ENTITY_ID majority reduction cannot prove topology continuity across an
  // LOD boundary. Keep the global capability blocked until an entity-specific
  // boundary representation is implemented.
  const unresolvedTopology = mixed.length > 0 && (
    !topologyRepresentationReady ||
    ambiguousTopologyComponentCount > 0 ||
    !entityTopology ||
    entityTopology.mixedLodComponentCount > 0
  );
  if (mixed.length > 0 && !topologyRepresentationReady) {
    reasons.push("entity mixed-LOD topology evidence is not available");
  }
  if (ambiguousTopologyComponentCount > 0) {
    reasons.push(`ambiguous mixed-LOD entity identity topology: ${ambiguousTopologyComponentCount}`);
  }
  if (mixed.length > 0 && entityTopology && entityTopology.mixedLodComponentCount > 0 && !reconciliationReady) {
    reasons.push("mixed-LOD entity components remain boundary-owned and require deferred identity commit");
  }
  if (mixed.length > 0 && !reconciliationReady) {
    reasons.push("entity reconciliation transaction is not commit-ready");
  }

  const ready =
    mixed.length === 0 ||
    (
      topologyRepresentationReady &&
      reconciliationReady &&
      invalid.length === 0 &&
      invalidGeometry.length === 0 &&
      invalidBoundaryCoverageCount === 0 &&
      unsupported.length === 0 &&
      context.overlappingSimulationRangeCount === 0 &&
      !unresolvedTopology
    );

  return {
    ready,
    mixedRelationCount: mixed.length,
    invalidTransferSpecCount: invalid.length,
    unsupportedRelationCount: unsupported.length,
    invalidBoundaryGeometryCount: invalidGeometry.length,
    invalidBoundaryCoverageCount,
    boundaryCoverage,
    overlappingSimulationRanges: context.overlappingSimulationRangeCount,
    unresolvedTopology,
    topologyRepresentationReady,
    ambiguousTopologyComponentCount,
    reconciliationReady,
    reasons,
  };
}


