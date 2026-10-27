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
    relation => relation.targetChunk === "1:1,0,0",
  );
  if (!mixed || mixed.relation !== "fine-to-coarse") {
    throw new Error("Canonical adapter regression: fine-to-coarse face neighbor was not resolved");
  }

  const corner = plan.boundaryReadRelations.find(
    relation => relation.targetChunk === "1:1,1,0",
  );
  if (corner) {
    throw new Error("Canonical adapter regression: corner-only chunk was accepted as a face neighbor");
  }

  const plusXFallback = plan.boundaryReadRelations.find(
    relation =>
      relation.targetChunk === "0:2,0,0" &&
      relation.relation === "same-level",
  );
  if (plusXFallback) {
    throw new Error("Canonical adapter regression: covered mixed-LOD face incorrectly received same-level fallback");
  }

  const minusXFallback = plan.boundaryReadRelations.find(
    relation =>
      relation.targetChunk === "0:0,0,0" &&
      relation.relation === "same-level",
  );
  if (!minusXFallback) {
    throw new Error("Canonical adapter regression: uncovered negative-X face lost same-level fallback");
  }

  const planBeforeRejectedUpdate = adapter.getPlan();
  const capabilitiesBeforeRejectedUpdate = adapter.getCapabilities();
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
