import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

function makePlan(
  sourceChunk: string,
  targetChunk: string,
  relation: "same-level" | "coarse-to-fine" | "fine-to-coarse",
  sourceLevel: number,
  targetLevel: number,
): InfinityScaleExecutionPlan {
  return {
    revision: 1,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [{
      key: sourceChunk,
      lod: sourceLevel,
      amr: 2 ** sourceLevel,
      distance: 0,
      simulationEligible: true,
      state: "simulating",
      chunk: (() => {
        const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(sourceChunk)!;
        return { level: Number(match[1]), x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) };
      })(),
      pinned: false,
      renderEligible: true,
    }],
    simulationBudget: 1,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [targetChunk],
    boundaryReadCount: 1,
    boundaryReadRelations: [{ sourceChunk, targetChunk, relation }],
    simulationCellCount: 0,
    boundaryReadCellCount: 0,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: true,
    agentMigrationReady: true,
  };
}

export function runInfinityScaleChunkExecutionContextBoundaryRegression(): void {
  {
    const context = new InfinityScaleChunkExecutionContext(
      makePlan("0:0,0,0", "0:1,0,0", "same-level", 0, 0),
      16, 16, 16, 4,
    );
    const boundary = context.getBoundaryRelationsForCell(3, 2, 2);
    if (boundary.length !== 1 || boundary[0].targetChunk !== "0:1,0,0") {
      throw new Error("Chunk context regression: same-level face lookup failed");
    }
    if (context.getBoundaryRelationsForCell(2, 2, 2).length !== 0) {
      throw new Error("Chunk context regression: interior cell accepted as boundary");
    }
  }

  {
    const context = new InfinityScaleChunkExecutionContext(
      makePlan("0:0,0,0", "1:1,0,0", "fine-to-coarse", 0, 1),
      32, 16, 16, 4,
    );
    const boundary = context.getBoundaryRelationsForCell(3, 2, 2);
    if (boundary.length !== 1 || boundary[0].relation !== "fine-to-coarse") {
      throw new Error("Chunk context regression: mixed-LOD source face lookup failed");
    }
    if (context.getBoundaryRelationsForCell(2, 2, 2).length !== 0) {
      throw new Error("Chunk context regression: mixed-LOD interior cell accepted");
    }
  }
}
