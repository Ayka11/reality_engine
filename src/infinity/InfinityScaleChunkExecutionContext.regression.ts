import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

function makePlan(
  sourceChunk: string,
  targetChunk: string,
  relation: "same-level" | "coarse-to-fine" | "fine-to-coarse",
  sourceLevel: number,
  _targetLevel: number,
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
      makePlan("0:1,0,0", "1:1,0,0", "fine-to-coarse", 0, 1),
      32, 16, 16, 4,
    );
    const boundary = context.getBoundaryRelationsForCell(7, 2, 2);
    if (boundary.length !== 1 || boundary[0].relation !== "fine-to-coarse") {
      throw new Error("Chunk context regression: mixed-LOD source face lookup failed");
    }
    if (context.getBoundaryRelationsForCell(6, 2, 2).length !== 0) {
      throw new Error("Chunk context regression: mixed-LOD interior cell accepted");
    }
  }

  const malformedPlans = [
    makePlan("00:0,0,0", "0:1,0,0", "same-level", 0, 0),
    makePlan("0:0,0,0", "1:0,0,0", "same-level", 0, 1),
    makePlan("0:0,0,0", "1:0,0,0", "coarse-to-fine", 0, 1),
  ];
  for (const [index, invalidPlan] of malformedPlans.entries()) {
    let rejected = false;
    try {
      new InfinityScaleChunkExecutionContext(invalidPlan, 16, 16, 16, 4);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Chunk context accepted inconsistent LOD identity/relation ${index}`);
  }

  const validPlan = makePlan("0:0,0,0", "0:1,0,0", "same-level", 0, 0);
  const invalidDimensions: Array<[number, number, number, number]> = [
    [0, 16, 16, 4],
    [16, -1, 16, 4],
    [16, Number.NaN, 16, 4],
    [16, 16, Number.POSITIVE_INFINITY, 4],
    [16.5, 16, 16, 4],
    [16, 16, 16, 0],
    [16, 16, 16, 1.25],
    [16, 16, 16, Number.MAX_SAFE_INTEGER + 1],
  ];
  for (const [index, [width, height, depth, size]] of invalidDimensions.entries()) {
    let rejected = false;
    try {
      new InfinityScaleChunkExecutionContext(validPlan, width, height, depth, size);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`Chunk context accepted invalid grid/chunk dimensions ${index}: ${width},${height},${depth},${size}`);
    }
  }

  // Each dimension is individually safe, but the linearized grid volume is not.
  // Reject it before coordinate indexing can lose integer precision.
  const unsafeVolumes: Array<[number, number, number]> = [
    [Number.MAX_SAFE_INTEGER, 2, 1],
    [2 ** 27, 2 ** 27, 1],
    [Number.MAX_SAFE_INTEGER, 1, 2],
  ];
  for (const [index, [width, height, depth]] of unsafeVolumes.entries()) {
    let rejected = false;
    try {
      new InfinityScaleChunkExecutionContext(validPlan, width, height, depth, 4);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(
        `Chunk context accepted unsafe linearized grid volume ${index}: ${width},${height},${depth}`,
      );
    }
  }

  // Huge but safe integer ranges must be counted mathematically, not by
  // iterating their represented cells (this range contains one trillion cells).
  const hugeDimension = 1_000_000_000_000;
  const hugeContext = new InfinityScaleChunkExecutionContext(
    validPlan,
    hugeDimension,
    1,
    1,
    hugeDimension,
  );
  if (hugeContext.simulationCellCount !== hugeDimension) {
    throw new Error(
      `Chunk context counted huge range incorrectly: expected ${hugeDimension}, received ${hugeContext.simulationCellCount}`,
    );
  }
  if (hugeContext.readCellCount !== 0) {
    throw new Error("Chunk context failed to deduplicate a read range fully covered by simulation ownership");
  }

  // Overlapping ranges must count the union only once.
  const overlappingPlan = {
    ...validPlan,
    chunks: [
      { key: "1:0,0,0", lod: 1, amr: 2, distance: 0 },
      { key: "0:1,0,0", lod: 0, amr: 1, distance: 1 },
    ],
    boundaryReadChunks: [],
    boundaryReadRelations: [],
  };
  const overlappingContext = new InfinityScaleChunkExecutionContext(
    overlappingPlan,
    8,
    4,
    4,
    4,
  );
  if (overlappingContext.simulationCellCount !== 8 * 4 * 4) {
    throw new Error("Chunk context counted overlapping simulation ranges more than once");
  }
}
