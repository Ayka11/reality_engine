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
      chunk("0:0,0,0", 0, 0, 0, 0, true),
      // One coarse neighbor sharing the +X face.
      chunk("1:1,0,0", 1, 1, 0, 0, 10, false),
      // Corner-only coarse chunk: must not be treated as a face neighbor.
      chunk("1:1,1,0", 1, 1, 1, 0, 20, false),
    ],
    simulating: ["0:0,0,0"],
    visible: ["0:0,0,0"],
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
  if (!mixed || mixed.relation !== "coarse-to-fine") {
    throw new Error("Canonical adapter regression: coarse face neighbor was not resolved");
  }

  const corner = plan.boundaryReadRelations.find(
    relation => relation.targetChunk === "1:1,1,0",
  );
  if (corner) {
    throw new Error("Canonical adapter regression: corner-only chunk was accepted as a face neighbor");
  }

  const plusXFallback = plan.boundaryReadRelations.find(
    relation =>
      relation.targetChunk === "0:1,0,0" &&
      relation.relation === "same-level",
  );
  if (plusXFallback) {
    throw new Error("Canonical adapter regression: covered mixed-LOD face incorrectly received same-level fallback");
  }

  const minusXFallback = plan.boundaryReadRelations.find(
    relation =>
      relation.targetChunk === "0:-1,0,0" &&
      relation.relation === "same-level",
  );
  if (!minusXFallback) {
    throw new Error("Canonical adapter regression: uncovered negative-X face lost same-level fallback");
  }
}
