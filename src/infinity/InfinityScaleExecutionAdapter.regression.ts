import { InfinityScaleExecutionAdapter } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleFramePlan } from "./InfinityScaleFramePlan";

function chunk(
  key: string,
  level: number,
  x: number,
  y: number,
  z: number,
  distance: number,
  simulationEligible: boolean,
) {
  return {
    key,
    chunk: { level, x, y, z },
    state: "simulating",
    lod: level,
    amr: 2 ** level,
    pinned: false,
    distance,
    simulationEligible,
    renderEligible: true,
  };
}

export function runInfinityScaleExecutionAdapterBoundaryRegression(): void {
  const adapter = new InfinityScaleExecutionAdapter();

  const frame = {
    observer: { x: 0, y: 0, z: 0 },
    chunks: [
      chunk("0:1,0,0", 0, 1, 0, 0, 0, true),
      // One coarse neighbor sharing the +X face.
      chunk("1:1,0,0", 1, 1, 0, 0, 10, false),
      // Corner-only coarse chunk: must not be treated as a face neighbor.
      chunk("1:1,1,0", 1, 1, 1, 0, 20, false),
    ],
    simulating: ["0:1,0,0"],
    visible: ["0:1,0,0"],
    background: [],
    cached: [],
    unloaded: [],
    residentCount: 3,
    simulationCount: 1,
    visibleCount: 1,
    maxSimulatingChunks: 1,
    maxResidentChunks: 3,
    revision: 1,
    generatedAt: 1,
  } as InfinityScaleFramePlan;

  const plan = adapter.update(frame);
  const mixed = plan.boundaryReadRelations.find(
    relation => relation.sourceChunk === "1:1,0,0",
  );
  if (
    !mixed ||
    mixed.targetChunk !== "0:1,0,0" ||
    mixed.relation !== "coarse-to-fine"
  ) {
    throw new Error("Canonical adapter regression: coarse read dependency was not directed into the selected fine chunk");
  }

  const corner = plan.boundaryReadRelations.find(
    relation => relation.sourceChunk === "1:1,1,0",
  );
  if (corner) {
    throw new Error("Canonical adapter regression: corner-only chunk was accepted as a face neighbor");
  }

  const plusXFallback = plan.boundaryReadRelations.find(
    relation =>
      relation.sourceChunk === "0:2,0,0" &&
      relation.relation === "same-level",
  );
  if (plusXFallback) {
    throw new Error("Canonical adapter regression: covered mixed-LOD face incorrectly received same-level fallback");
  }

  const minusXFallback = plan.boundaryReadRelations.find(
    relation =>
      relation.sourceChunk === "0:0,0,0" &&
      relation.relation === "same-level",
  );
  if (!minusXFallback) {
    throw new Error("Canonical adapter regression: uncovered negative-X face lost same-level fallback");
  }

  // Equal-distance candidates must select the same bounded work-set regardless
  // of Map/insertion order. A key tie-break makes the result reproducible.
  const tieAdapter = new InfinityScaleExecutionAdapter();
  const tieFrame = {
    ...frame,
    chunks: [
      chunk("0:2,0,0", 0, 2, 0, 0, 1, true),
      chunk("0:1,0,0", 0, 1, 0, 0, 1, true),
    ],
    simulating: ["0:2,0,0", "0:1,0,0"],
    visible: ["0:2,0,0", "0:1,0,0"],
    background: [],
    cached: [],
    unloaded: [],
    residentCount: 2,
    simulationCount: 2,
    visibleCount: 2,
    maxSimulatingChunks: 1,
    maxResidentChunks: 2,
  } as InfinityScaleFramePlan;
  const tiePlan = tieAdapter.update(tieFrame);
  if (tiePlan.chunks.length !== 1 || tiePlan.chunks[0].key !== "0:1,0,0") {
    throw new Error("Execution adapter tie-break did not select the canonical nearest chunk");
  }

  const planBeforeRejectedUpdate = adapter.getPlan();
  const capabilitiesBeforeRejectedUpdate = adapter.getCapabilities();
  const malformedCapabilities = {
    selectiveCpuReady: "true",
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
  } as unknown as Parameters<InfinityScaleExecutionAdapter["setCapabilities"]>[0];

  let malformedSetterRejected = false;
  try {
    adapter.setCapabilities(malformedCapabilities);
  } catch (error) {
    malformedSetterRejected = error instanceof TypeError &&
      error.message.includes("selectiveCpuReady must be a boolean");
  }
  if (!malformedSetterRejected) {
    throw new Error("Execution adapter accepted a non-boolean capability flag");
  }

  let malformedUpdateRejected = false;
  try {
    adapter.update(frame, malformedCapabilities);
  } catch (error) {
    malformedUpdateRejected = error instanceof TypeError &&
      error.message.includes("selectiveCpuReady must be a boolean");
  }
  if (!malformedUpdateRejected) {
    throw new Error("Execution adapter update accepted a non-boolean capability flag");
  }
  if (JSON.stringify(adapter.getCapabilities()) !== JSON.stringify(capabilitiesBeforeRejectedUpdate)) {
    throw new Error("Malformed capability input mutated adapter capabilities");
  }
  if (JSON.stringify(adapter.getPlan()) !== JSON.stringify(planBeforeRejectedUpdate)) {
    throw new Error("Malformed capability input replaced the last valid execution plan");
  }

  const requestedCapabilities = {
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
  };

  const mismatchedIdentityFrame = {
    ...frame,
    chunks: frame.chunks.map((candidate, index) =>
      index === 0 ? { ...candidate, lod: candidate.lod + 1 } : candidate
    ),
  } as InfinityScaleFramePlan;
  let identityRejected = false;
  try {
    adapter.update(mismatchedIdentityFrame, requestedCapabilities);
  } catch (error) {
    identityRejected = error instanceof Error && error.message.includes("identity/LOD mismatch");
  }
  if (!identityRejected) {
    throw new Error("Execution adapter accepted mismatched canonical chunk identity and LOD");
  }

  const invalidDistanceFrame = {
    ...frame,
    chunks: frame.chunks.map((candidate, index) =>
      index === 0 ? { ...candidate, distance: Number.NaN } : candidate
    ),
  } as InfinityScaleFramePlan;
  let invalidDistanceRejected = false;
  try {
    adapter.update(invalidDistanceFrame, requestedCapabilities);
  } catch (error) {
    invalidDistanceRejected = error instanceof Error &&
      error.message.includes("distance must be finite and non-negative");
  }
  if (!invalidDistanceRejected) {
    throw new Error("Execution adapter accepted an invalid distance into the simulation work-set");
  }

  const overlappingFrame = {
    ...frame,
    chunks: [
      chunk("1:0,0,0", 1, 0, 0, 0, 0, true),
      chunk("0:0,0,0", 0, 0, 0, 0, 1, true),
    ],
    simulating: ["1:0,0,0", "0:0,0,0"],
    maxSimulatingChunks: 2,
  } as InfinityScaleFramePlan;
  let overlapRejected = false;
  try {
    adapter.update(overlappingFrame, requestedCapabilities);
  } catch (error) {
    overlapRejected = error instanceof Error &&
      error.message.includes("overlapping simulation ownership ranges");
  }
  if (!overlapRejected) {
    throw new Error("Execution adapter did not reject overlapping simulation ownership");
  }

  if (JSON.stringify(adapter.getCapabilities()) !== JSON.stringify(capabilitiesBeforeRejectedUpdate)) {
    throw new Error("Rejected execution plan mutated adapter capabilities");
  }
  if (JSON.stringify(adapter.getPlan()) !== JSON.stringify(planBeforeRejectedUpdate)) {
    throw new Error("Rejected execution plan replaced the last valid plan");
  }
}
