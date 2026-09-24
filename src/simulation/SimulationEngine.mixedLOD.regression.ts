import { SimulationEngine } from "./SimulationEngine";
import { F } from "../core/CellState";
import type { InfinityScaleExecutionPlan } from "../infinity/InfinityScaleExecutionAdapter";

function mixedPlan(): InfinityScaleExecutionPlan {
  return {
    revision: 1,
    mode: "selective-cpu-ready",
    observer: [32, 16, 16],
    chunks: [{ key: "1:0,0,0", lod: 1, distance: 0 }],
    simulationBudget: 65536,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: ["0:64,0,0"],
    boundaryReadCount: 1,
    boundaryReadRelations: [{
      sourceChunk: "0:64,0,0",
      targetChunk: "1:0,0,0",
      relation: "fine-to-coarse",
    }],
    simulationCellCount: 65536,
    boundaryReadCellCount: 32768,
    localExecutionLayers: 1,
    globalExecutionLayers: 1,
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: true,
    agentMigrationReady: true,
  };
}

export async function runSimulationEngineMixedLODMultiFrameRegression(): Promise<void> {
  // 128-wide world permits a genuine 64-cell coarse LOD chunk adjacent to a
  // 32^3 fine chunk without overlapping simulation ownership.
  const engine = new SimulationEngine(128, 64, 32);
  engine.grid.cell(20, 20, 16).set(F.ENERGY, 100);
  // Place the source directly on the fine chunk's inner boundary so the
  // coarse solver must consume it through the mixed-LOD boundary snapshot.
  engine.grid.cell(64, 20, 16).set(F.ENERGY, 500);

  engine.setInfinityScaleExecutionPlan(mixedPlan());

  await engine.step(0.016);
  const firstTick = engine.tick;
  const firstBoundaryEnergy = engine.grid.cell(64, 20, 16).get(F.ENERGY);

  await engine.step(0.016);
  const secondTick = engine.tick;
  const secondBoundaryEnergy = engine.grid.cell(64, 20, 16).get(F.ENERGY);

  if (firstTick !== 1 || secondTick !== 2) {
    throw new Error(`Expected mixed-LOD runtime ticks 1 and 2, received ${firstTick} and ${secondTick}`);
  }
  if (!Number.isFinite(firstBoundaryEnergy) || !Number.isFinite(secondBoundaryEnergy)) {
    throw new Error("Mixed-LOD runtime produced non-finite boundary state");
  }
  if (firstBoundaryEnergy <= 0) {
    throw new Error(
      `Expected first-frame coarse boundary to receive fine-side influence, received ${firstBoundaryEnergy}`,
    );
  }
  if (secondBoundaryEnergy === firstBoundaryEnergy) {
    throw new Error(
      "Expected second frame to consume an updated fine-side boundary state",
    );
  }

  const validation = engine.getInfinityScaleMixedLODValidation();
  if (!validation || !validation.ready) {
    throw new Error(
      `Expected mixed-LOD runtime validation to remain ready: ${validation?.reasons.join("; ") ?? "missing"}`,
    );
  }
}
