export type InfinityScaleAdaptiveTransferOperation =
  | "TOPOLOGY_PROLONGATION"
  | "TOPOLOGY_RESTRICTION"
  | "BOUNDARY_COPY"
  | "BOUNDARY_PROLONGATION"
  | "BOUNDARY_RESTRICTION";

export interface InfinityScaleAdaptiveMutation {
  regionId: string;
  fromLOD: number;
  toLOD: number;
}

export interface InfinityScaleCompiledTransfer {
  transferId: string;
  regionId: string;
  operation: InfinityScaleAdaptiveTransferOperation;
  ratio: number;
  sourceLOD: number;
  targetLOD: number;
  conservationRequired: boolean;
  dependencyIds: string[];
}

export interface InfinityScaleAdaptiveCompiledPlan {
  mutations: InfinityScaleAdaptiveMutation[];
  transfers: InfinityScaleCompiledTransfer[];
  transferPlanHash: string;
  conservationRequired: boolean;
  gpuExecutionRequired: boolean;
}

export class InfinityScaleAdaptiveTransferCompiler {
  compile(mutations: InfinityScaleAdaptiveMutation[]): InfinityScaleAdaptiveCompiledPlan {
    const ordered = [...mutations].sort((a, b) => a.regionId.localeCompare(b.regionId));
    const transfers: InfinityScaleCompiledTransfer[] = [];

    for (const mutation of ordered) {
      if (!Number.isInteger(mutation.fromLOD) || !Number.isInteger(mutation.toLOD)) {
        throw new Error("Adaptive mutation LOD values must be integers");
      }
      if (mutation.fromLOD === mutation.toLOD) continue;

      const delta = mutation.toLOD - mutation.fromLOD;
      const ratio = 2 ** Math.abs(delta);
      const operation =
        delta > 0 ? "TOPOLOGY_PROLONGATION" : "TOPOLOGY_RESTRICTION";

      transfers.push({
        transferId: `${mutation.regionId}:${mutation.fromLOD}->${mutation.toLOD}`,
        regionId: mutation.regionId,
        operation,
        ratio,
        sourceLOD: mutation.fromLOD,
        targetLOD: mutation.toLOD,
        conservationRequired: true,
        dependencyIds: [],
      });
    }

    for (let i = 0; i < transfers.length; i++) {
      if (i > 0) transfers[i].dependencyIds.push(transfers[i - 1].transferId);
    }

    const transferPlanHash = stableHash(JSON.stringify(transfers));
    return {
      mutations: ordered,
      transfers,
      transferPlanHash,
      conservationRequired: transfers.length > 0,
      gpuExecutionRequired: transfers.length > 0,
    };
  }
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
