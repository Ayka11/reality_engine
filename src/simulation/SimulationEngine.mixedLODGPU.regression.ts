import { SimulationEngine } from "./SimulationEngine";
import type { InfinityScaleExecutionPlan } from "../infinity/InfinityScaleExecutionAdapter";

export function runSimulationEngineMixedLODGPUReadinessRegression(): void {
  const engine = new SimulationEngine(128, 64, 32);
  const plan: InfinityScaleExecutionPlan = {
    revision: 1,
    mode: "selective-gpu-ready",
    observer: { x: 32, y: 16, z: 16 },
    chunks: [{ key: "1:0,0,0", lod: 1, amr: 2, distance: 0 }],
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
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: true,
    gpuPhysicsReady: true,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: true,
    agentMigrationReady: true,
  };

  let rejected = false;
  try {
    engine.setInfinityScaleExecutionPlan(plan);
  } catch (error) {
    rejected = error instanceof Error &&
      error.message.includes("mixed-LOD GPU execution is not enabled");
  }

  if (!rejected) {
    throw new Error("Expected mixed-LOD GPU execution plan to remain disabled until GPU boundary synchronization is implemented");
  }
}
