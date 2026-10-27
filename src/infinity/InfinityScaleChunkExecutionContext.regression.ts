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
    // Relations must describe a physical face, not merely compatible LODs.
    makePlan("0:0,0,0", "0:2,0,0", "same-level", 0, 0),
    makePlan("0:0,0,0", "0:1,1,0", "same-level", 0, 0),
    makePlan("0:0,0,0", "1:5,0,0", "fine-to-coarse", 0, 1),
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

  const advisoryPlan: InfinityScaleExecutionPlan = {
    ...validPlan,
    mode: "advisory",
    selectiveCpuReady: false,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: false,
    mixedLodExecutionReady: false,
  };
  const advisoryContext = new InfinityScaleChunkExecutionContext(
    advisoryPlan,
    16,
    16,
    16,
    4,
  );
  const forgedReadyPlan: InfinityScaleExecutionPlan = {
    ...advisoryPlan,
    mode: "selective-cpu-ready",
    selectiveCpuReady: true,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
  };
  let readinessEscalationRejected = false;
  try {
    advisoryContext.assertCompatiblePlan(forgedReadyPlan);
  } catch (error) {
    readinessEscalationRejected = error instanceof Error &&
      error.message.includes("context/plan geometry mismatch");
  }
  if (!readinessEscalationRejected) {
    throw new Error("Chunk context allowed an advisory plan to be upgraded to execution-ready without rebuilding context");
  }

  const validContext = new InfinityScaleChunkExecutionContext(validPlan, 16, 16, 16, 4);
  const downgradedPlan: InfinityScaleExecutionPlan = {
    ...validPlan,
    mode: "advisory",
    selectiveCpuReady: false,
  };
  let readinessDowngradeDetected = false;
  try {
    validContext.assertCompatiblePlan(downgradedPlan);
  } catch {
    readinessDowngradeDetected = true;
  }
  if (!readinessDowngradeDetected) {
    throw new Error("Chunk context failed to detect changed execution readiness flags");
  }

  const immutableContext = new InfinityScaleChunkExecutionContext(
    validPlan,
    16,
    16,
    16,
    4,
  );
  if (
    !Object.isFrozen(immutableContext.simulationRanges) ||
    !Object.isFrozen(immutableContext.readRanges) ||
    !Object.isFrozen(immutableContext.levelRangeScales) ||
    !Object.isFrozen(immutableContext.boundaryReadRelations) ||
    !Object.isFrozen(immutableContext.boundaryTransferSpecs) ||
    immutableContext.simulationRanges.some(range => !Object.isFrozen(range)) ||
    immutableContext.readRanges.some(range => !Object.isFrozen(range)) ||
    immutableContext.boundaryReadRelations.some(relation => !Object.isFrozen(relation)) ||
    immutableContext.boundaryTransferSpecs.some(spec => !Object.isFrozen(spec))
  ) {
    throw new Error("Chunk execution context exposed mutable geometry or transfer contracts");
  }

  const mutableRanges = immutableContext.simulationRanges as unknown as Array<{ minX: number }>;
  let rangeAppendRejected = false;
  try {
    mutableRanges.push({ minX: 999 });
  } catch {
    rangeAppendRejected = true;
  }
  if (!rangeAppendRejected || immutableContext.simulationRanges.length !== 1) {
    throw new Error("Chunk execution context allowed public simulation ownership ranges to be appended");
  }
  let rangeMutationRejected = false;
  try {
    (immutableContext.simulationRanges[0] as unknown as { minX: number }).minX = 999;
  } catch {
    rangeMutationRejected = true;
  }
  if (!rangeMutationRejected || immutableContext.simulationRanges[0].minX !== 0) {
    throw new Error("Chunk execution context allowed public simulation geometry to be mutated");
  }
  let transferMutationRejected = false;
  try {
    (immutableContext.boundaryTransferSpecs[0] as unknown as { targetChunk: string }).targetChunk = "0:99,0,0";
  } catch {
    transferMutationRejected = true;
  }
  if (!transferMutationRejected || immutableContext.boundaryTransferSpecs[0].targetChunk !== "0:1,0,0") {
    throw new Error("Chunk execution context allowed a public boundary transfer target to be changed");
  }

  const mismatchedExecutionLODPlan = {
    ...validPlan,
    chunks: [{ ...validPlan.chunks[0], key: "1:0,0,0" }],
  };
  let mismatchedExecutionLODRejected = false;
  try {
    new InfinityScaleChunkExecutionContext(mismatchedExecutionLODPlan, 16, 16, 16, 4);
  } catch {
    mismatchedExecutionLODRejected = true;
  }
  if (!mismatchedExecutionLODRejected) {
    throw new Error("Chunk context accepted an execution LOD that disagrees with its canonical chunk key");
  }

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
  const hugePlan = {
    ...validPlan,
    // Model a read dependency that aliases the same owned region solely to
    // exercise containment/deduplication; no boundary transfer is declared.
    boundaryReadChunks: ["0:0,0,0"],
    boundaryReadRelations: [],
  };
  const hugeContext = new InfinityScaleChunkExecutionContext(
    hugePlan,
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
