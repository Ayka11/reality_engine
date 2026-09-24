import { AgentSystem } from "../simulation/AgentSystem";
import { EntityLayer } from "../simulation/EntityLayer";
import { VoxelGrid } from "../core/VoxelGrid";
import { F } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import {
  beginInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import {
  beginInfinityScaleUnifiedTransaction,
  stageInfinityScaleAgentMigrations,
  stageInfinityScaleEntityCommit,
  validateInfinityScaleUnifiedTransaction,
  commitInfinityScaleUnifiedTransaction,
} from "./InfinityScaleUnifiedTransaction";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";
import { CELL_FIELDS } from "../core/CellState";

export function runInfinityScaleUnifiedTransactionRegression(): void {
  const grid = new VoxelGrid(12, 8, 8);
  const state = new InfinityScaleLODState(4);
  const coarseKey = "1:0,0,0";
  const fineKey = "0:8,0,0";
  state.ensureChunk(coarseKey, 1);
  state.ensureChunk(fineKey, 0);

  // Coarse boundary source.
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const value = new Float32Array(CELL_FIELDS);
        value[0] = 16;
        state.writeBaseCell(coarseKey, 1, x * 2, y * 2, z * 2, value);
      }
    }
  }

  // One closed entity entirely inside the fine simulation chunk.
  const entityIndex = grid.idx(9, 2, 2) / CELL_FIELDS;
  grid.buffer[entityIndex * CELL_FIELDS + F.BIO_POTENTIAL] = 0.5;
  grid.buffer[entityIndex * CELL_FIELDS + F.ENERGY] = 20;

  const plan: InfinityScaleExecutionPlan = {
    revision: 3,
    mode: "selective-cpu-ready",
    observer: [9, 2, 2],
    chunks: [{ key: fineKey, lod: 0, distance: 0 }],
    simulationBudget: 64,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [coarseKey],
    boundaryReadCount: 1,
    boundaryReadRelations: [{
      sourceChunk: coarseKey,
      targetChunk: fineKey,
      relation: "coarse-to-fine",
    }],
    simulationCellCount: 64,
    boundaryReadCellCount: 64,
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

  const context = new InfinityScaleChunkExecutionContext(plan, 12, 8, 8, 4);
  const frame: InfinityScaleGlobalExecutionFrame = {
    revision: 3,
    tickStart: 2,
    tickEnd: 3,
    phase: "local-execution",
    planRevision: 3,
    simulationCellCount: 64,
    boundaryReadCellCount: 64,
    committed: false,
    finalized: false,
    ownershipFingerprint: "unified-regression",
    capabilityFingerprint: "unified-regression",
  };

  const entityLayer = new EntityLayer();
  const entityPlan = entityLayer.prepareChunkExecution(grid, context);
  if (!entityPlan.commitReady) {
    throw new Error("Expected closed fine-chunk entity reconciliation to be commit-ready");
  }

  const agents = new AgentSystem();
  const agentId = agents.spawnAt(9, 2, 2, "explorer", 250);
  const agent = agents.getAgents().find(candidate => candidate.id === agentId);
  if (!agent) throw new Error("Failed to create regression agent");

  const lodTransaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
  const transaction = beginInfinityScaleUnifiedTransaction(
    frame,
    plan,
    lodTransaction,
    entityLayer,
    agents,
    grid,
    context,
  );

  stageInfinityScaleEntityCommit(transaction);
  stageInfinityScaleAgentMigrations(transaction, [{
    agentId,
    from: [9, 2, 2],
    to: [10, 2, 2],
    behavior: agent.behavior,
    energy: agent.energy,
  }]);

  const validation = validateInfinityScaleUnifiedTransaction(transaction, frame);
  if (!validation.readyToCommit) {
    throw new Error(
      `Expected unified transaction to be ready: ${validation.reasons.join("; ")}`,
    );
  }

  frame.phase = "boundary-reconciliation";
  commitInfinityScaleUnifiedTransaction(transaction, frame);

  const moved = agents.getAgents().find(candidate => candidate.id === agentId);
  if (!moved || moved.x !== 10 || moved.y !== 2 || moved.z !== 2) {
    throw new Error("Unified transaction did not commit agent migration");
  }

  const entity = entityLayer.getEntities().find(candidate =>
    candidate.cells.includes(entityIndex),
  );
  if (!entity) {
    throw new Error("Unified transaction did not commit entity reconciliation");
  }

  if (!transaction.committed) {
    throw new Error("Unified transaction did not mark itself committed");
  }

  // A second transaction with a conflicting destination must be rejected
  // before any LOD/entity/agent mutation occurs.
  const frame2: InfinityScaleGlobalExecutionFrame = {
    ...frame,
    revision: 4,
    phase: "local-execution",
    committed: false,
    finalized: false,
  };
  const plan2 = { ...plan, revision: 4 };
  const lodTransaction2 = beginInfinityScaleGlobalLODTransaction(frame2, plan2, state);
  const transaction2 = beginInfinityScaleUnifiedTransaction(
    frame2,
    plan2,
    lodTransaction2,
    entityLayer,
    agents,
    grid,
    context,
  );
  stageInfinityScaleAgentMigrations(transaction2, [{
    agentId,
    from: [10, 2, 2],
    to: [11, 2, 2],
    behavior: moved.behavior,
    energy: moved.energy,
  }]);

  const conflict = validateInfinityScaleUnifiedTransaction(transaction2, frame2);
  if (conflict.readyToCommit) {
    throw new Error("Expected invalid commit phase to block unified transaction");
  }

  frame2.phase = "boundary-reconciliation";
  const conflictAfterPhase = validateInfinityScaleUnifiedTransaction(transaction2, frame2);
  if (!conflictAfterPhase.readyToCommit) {
    throw new Error(
      `Expected second valid migration transaction after phase transition: ${conflictAfterPhase.reasons.join("; ")}`,
    );
  }
}
