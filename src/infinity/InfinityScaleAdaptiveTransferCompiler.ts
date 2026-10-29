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
    if (!Array.isArray(mutations)) {
      throw new Error("Adaptive LOD compiler requires a mutation array");
    }

    const seenRegionIds = new Set<string>();
    // Snapshot caller-owned records before sorting or compiling. A region may
    // only have one target LOD in an atomic frame; accepting duplicate IDs or
    // mutable input objects can make the compiled plan disagree with its hash.
    const ordered = mutations.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error("Adaptive LOD mutation " + index + " must be an object");
      }
      const regionId = candidate.regionId;
      const fromLOD = candidate.fromLOD;
      const toLOD = candidate.toLOD;
      if (typeof regionId !== "string" || regionId.length === 0 || regionId.trim() !== regionId) {
        throw new Error("Adaptive LOD region ID must be a non-empty canonical string");
      }
      if (seenRegionIds.has(regionId)) {
        throw new Error("Adaptive LOD mutation contains duplicate region ID: " + regionId);
      }
      seenRegionIds.add(regionId);
      if (!Number.isInteger(fromLOD) || !Number.isInteger(toLOD) ||
          fromLOD < 0 || fromLOD > 30 || toLOD < 0 || toLOD > 30) {
        throw new Error("Adaptive mutation LOD values must be integers in the range 0..30");
      }
      return { regionId, fromLOD, toLOD };
    }).sort((a, b) => a.regionId.localeCompare(b.regionId));

    const transfers: InfinityScaleCompiledTransfer[] = [];

    for (const mutation of ordered) {
      if (mutation.fromLOD === mutation.toLOD) continue;

      const delta = mutation.toLOD - mutation.fromLOD;
      const ratio = 2 ** Math.abs(delta);
      // In InfinityScaleLODState, higher levels cover larger/coarser cells.
      // Refinement moves to a lower level and requires prolongation; coarsening
      // moves to a higher level and requires restriction.
      const operation =
        delta < 0 ? "TOPOLOGY_PROLONGATION" : "TOPOLOGY_RESTRICTION";

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
