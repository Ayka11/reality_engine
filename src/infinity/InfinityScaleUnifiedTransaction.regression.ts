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
    observer: { x: 9, y: 2, z: 2 },
    chunks: [{ key: fineKey, lod: 0, amr: 1, distance: 0 }],
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
  const oldMarker = grid.buffer[grid.idx(9, 2, 2) + F.AGENT_MARK];
  const newMarker = grid.buffer[grid.idx(10, 2, 2) + F.AGENT_MARK];
  if (oldMarker !== 0 || newMarker !== agentId) {
    throw new Error("Unified transaction left inconsistent agent markers");
  }
  if (agents.peekMigrationRequests().length !== 0) {
    throw new Error("Committed migration requests were not acknowledged");
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

  // Negative integrity test: remove one mixed-LOD staged update and ensure
  // the unified barrier refuses to commit an incomplete boundary.
  const integrityFrame: InfinityScaleGlobalExecutionFrame = {
    ...frame,
    revision: 5,
    phase: "local-execution",
    committed: false,
    finalized: false,
  };
  const integrityPlan = { ...plan, revision: 5 };
  const integrityState = new InfinityScaleLODState(4);
  integrityState.ensureChunk(coarseKey, 1);
  integrityState.ensureChunk(fineKey, 0);
  const integrityContext = new InfinityScaleChunkExecutionContext(
    integrityPlan,
    12,
    8,
    8,
    4,
  );
  const integrityLod = beginInfinityScaleGlobalLODTransaction(
    integrityFrame,
    integrityPlan,
    integrityState,
  );
  const integrityTx = beginInfinityScaleUnifiedTransaction(
    integrityFrame,
    integrityPlan,
    integrityLod,
    entityLayer,
    agents,
    grid,
    integrityContext,
  );

  const { InfinityScaleMixedLODCPUExecutor } = require("./InfinityScaleMixedLODCPUExecutor") as typeof import("./InfinityScaleMixedLODCPUExecutor");
  const executor = new InfinityScaleMixedLODCPUExecutor(integrityState, integrityContext);
  executor.stageBoundaryTransfers(integrityLod);
  const staged = integrityLod.synchronization.getStagedUpdates();
  if (staged.length < 2) {
    throw new Error("Expected multiple staged mixed-LOD boundary updates for integrity regression");
  }
  integrityLod.synchronization.rollback();
  for (const update of staged.slice(0, staged.length - 1)) {
    integrityLod.synchronization.stageTransfer(
      {
        sourceChunk: update.sourceChunk,
        targetChunk: update.targetChunk,
        relation: update.relation,
        sourceLevel: Number(update.sourceChunk.split(":")[0]),
        targetLevel: Number(update.targetChunk.split(":")[0]),
        refinementRatio: 2,
        operation: update.relation === "coarse-to-fine" ? "prolongation" : "restriction",
        readOperation: update.relation === "coarse-to-fine" ? "restriction" : "prolongation",
      },
      update.targetCell,
      update.sourceCells,
    );
  }
  const incomplete = validateInfinityScaleUnifiedTransaction(integrityTx, integrityFrame);
  if (incomplete.readyToCommit || !incomplete.reasons.some(reason => reason.includes("missing mixed-LOD boundary updates"))) {
    throw new Error("Expected incomplete mixed-LOD boundary staging to block unified commit");
  }

  // A second transaction with two divergent destinations for the same agent
  // must be rejected before any LOD/entity/agent mutation occurs.
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
  }, {
    agentId,
    from: [10, 2, 2],
    to: [9, 2, 2],
    behavior: moved.behavior,
    energy: moved.energy,
  }]);

  const conflict = validateInfinityScaleUnifiedTransaction(transaction2, frame2);
  if (conflict.readyToCommit) {
    throw new Error("Expected invalid commit phase to block unified transaction");
  }

  frame2.phase = "boundary-reconciliation";
  const conflictAfterPhase = validateInfinityScaleUnifiedTransaction(transaction2, frame2);
  if (conflictAfterPhase.readyToCommit || conflictAfterPhase.migrationConflicts === 0) {
    throw new Error("Expected divergent agent migrations to remain blocked at commit phase");
  }
}
