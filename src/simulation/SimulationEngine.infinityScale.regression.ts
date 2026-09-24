import { SimulationEngine } from "./SimulationEngine";
import { F } from "../core/CellState";

export async function runSimulationEngineInfinityScaleSelectiveCPURegression(): Promise<void> {
  const engine = new SimulationEngine();
  const plan = {
    revision: 1,
    mode: "selective-cpu-ready" as const,
    observer: { x: 0, y: 0, z: 0 },
    chunks: [{ key: "0:0,0,0", lod: 0, amr: 1, distance: 0 }],
    simulationBudget: 32 * 32 * 32,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 32 * 32 * 32,
    boundaryReadCellCount: 0,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: false,
    mixedLodExecutionReady: true,
    entityExecutionReady: true,
    agentMigrationReady: true,
  };

  const owned = engine.grid.cell(8, 8, 8);
  owned.set(F.ENERGY, 100);
  const outside = engine.grid.cell(40, 8, 8);
  outside.set(F.ENERGY, 250);

  engine.setInfinityScaleExecutionPlan(plan);
  await engine.step(0.016);

  if (engine.tick !== 1) {
    throw new Error(`Expected selective CPU frame to advance tick to 1, received ${engine.tick}`);
  }

  const outsideAfter = engine.grid.cell(40, 8, 8).get(F.ENERGY);
  if (outsideAfter !== 250) {
    throw new Error(
      `Selective CPU execution modified an unowned dense cell: expected 250, received ${outsideAfter}`,
    );
  }

  const ownedAfter = engine.grid.cell(8, 8, 8).get(F.ENERGY);
  if (!Number.isFinite(ownedAfter)) {
    throw new Error("Selective CPU execution produced a non-finite owned field value");
  }

  const metrics = engine.totalField(F.ENERGY);
  if (!Number.isFinite(metrics)) {
    throw new Error("Selective CPU execution produced non-finite global metrics");
  }
}
