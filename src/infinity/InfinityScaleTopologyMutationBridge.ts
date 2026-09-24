import type { InfinityScaleSpatialConstraintClosureResult } from "./InfinityScaleSpatialConstraintClosure";

export interface InfinityScaleExecutableAdaptiveRegion {
  regionId: string;
  currentLOD: number;
  proposedLOD: number;
}

export interface InfinityScaleTopologyMutationBridgeResult {
  accepted: boolean;
  mutationSet: Array<{
    regionId: string;
    fromLOD: number;
    toLOD: number;
  }>;
  unchangedRegionIds: string[];
  topologyValid: boolean;
  requiresTransfer: boolean;
  requiresConservationValidation: boolean;
  requiresGPUExecution: boolean;
  reason: string;
}

export class InfinityScaleTopologyMutationBridge {
  evaluate(
    regions: InfinityScaleExecutableAdaptiveRegion[],
    closure: InfinityScaleSpatialConstraintClosureResult,
  ): InfinityScaleTopologyMutationBridgeResult {
    const mutations: InfinityScaleTopologyMutationBridgeResult["mutationSet"] = [];
    const unchangedRegionIds: string[] = [];

    for (const region of regions) {
      const finalLOD = closure.proposedLOD.get(region.regionId);
      if (finalLOD === undefined) {
        return {
          accepted: false,
          mutationSet: [],
          unchangedRegionIds: [],
          topologyValid: false,
          requiresTransfer: false,
          requiresConservationValidation: false,
          requiresGPUExecution: false,
          reason: `missing closed LOD for region ${region.regionId}`,
        };
      }

      if (finalLOD === region.currentLOD) {
        unchangedRegionIds.push(region.regionId);
      } else {
        mutations.push({
          regionId: region.regionId,
          fromLOD: region.currentLOD,
          toLOD: finalLOD,
        });
      }
    }

    if (!closure.valid) {
      return {
        accepted: false,
        mutationSet: [],
        unchangedRegionIds,
        topologyValid: false,
        requiresTransfer: false,
        requiresConservationValidation: false,
        requiresGPUExecution: false,
        reason: "spatial constraint closure is invalid",
      };
    }

    mutations.sort((a, b) => a.regionId.localeCompare(b.regionId));

    return {
      accepted: true,
      mutationSet: mutations,
      unchangedRegionIds: unchangedRegionIds.sort(),
      topologyValid: true,
      requiresTransfer: mutations.length > 0,
      requiresConservationValidation: mutations.length > 0,
      requiresGPUExecution: mutations.length > 0,
      reason: mutations.length ? "closed adaptive plan accepted for transactional execution" : "no topology mutation required",
    };
  }
}
