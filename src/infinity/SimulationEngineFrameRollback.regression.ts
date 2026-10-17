import { F } from "../core/CellState";
import { SimulationEngine } from "../simulation/SimulationEngine";

export async function runSimulationEngineFrameRollbackRegression(): Promise<void> {
  const engine = new SimulationEngine(4, 4, 2);
  const fieldIndex = engine.grid.idx(1, 1, 1) + F.ENERGY;
  engine.grid.buffer[fieldIndex] = 25;
  engine.grid.backBuffer[fieldIndex] = 17;
  const agentId = engine.agents.spawnAt(1, 1, 1, "explorer", 90);
  engine.restoreTick(7);

  engine.setInfinityScaleExecutionPlan({
    revision: 1,
    mode: "selective-cpu-ready",
    observer: { x: 1, y: 1, z: 1 },
    chunks: [{ key: "0:0,0,0", lod: 0, amr: 1, distance: 0 }],
    simulationBudget: 32,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 32,
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
  });

  const before = engine.captureCoreRecoveryState();
  const fieldPhysics = (engine as unknown as { fieldPhysics: { tickChunks: (...args: any[]) => void } }).fieldPhysics;
  const originalTickChunks = fieldPhysics.tickChunks;
  fieldPhysics.tickChunks = ((...args: Parameters<typeof originalTickChunks>) => {
    args[0].buffer[fieldIndex] = 999;
    engine.agents.getAgents()[0].energy = 1;
    throw new Error("intentional frame rollback regression failure");
  }) as typeof originalTickChunks;

  let rejected = false;
  try {
    await engine.step(0.016);
  } catch (error) {
    rejected = error instanceof Error && error.message === "intentional frame rollback regression failure";
  } finally {
    fieldPhysics.tickChunks = originalTickChunks;
  }

  if (!rejected) {
    throw new Error("Selective frame failure did not propagate the injected error");
  }
  if (engine.tick !== before.tick ||
      engine.grid.buffer[fieldIndex] !== before.grid.buffer[fieldIndex] ||
      engine.grid.backBuffer[fieldIndex] !== before.grid.backBuffer[fieldIndex]) {
    throw new Error("Selective frame failure did not restore tick and grid buffers");
  }
  const agent = engine.agents.getAgents().find(candidate => candidate.id === agentId);
  if (!agent || agent.energy !== 90 || engine.agents.getAgents().length !== 1) {
    throw new Error("Selective frame failure did not restore agent state");
  }
  const after = engine.captureCoreRecoveryState();
  if (JSON.stringify(after.chemistry.pendingDensityTransfers) !== JSON.stringify(before.chemistry.pendingDensityTransfers) ||
      after.lod.chunks.length !== before.lod.chunks.length) {
    throw new Error("Selective frame failure did not restore deferred chemistry or LOD state");
  }
}
