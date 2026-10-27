import { InfinityScaleMixedLODCPUExecutor } from "./InfinityScaleMixedLODCPUExecutor";
import {
  beginInfinityScaleGlobalLODTransaction,
  commitInfinityScaleGlobalLODTransaction,
  rollbackInfinityScaleGlobalLODTransaction,
} from "./InfinityScaleGlobalLODTransaction";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { CELL_FIELDS } from "../core/CellState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import {
  advanceInfinityScaleGlobalFrame,
  beginInfinityScaleGlobalFrame,
} from "./InfinityScaleGlobalExecutionFrame";
import type { InfinityScaleGlobalExecutionFrame } from "./InfinityScaleGlobalExecutionFrame";

function makeLocalExecutionFrame(
  plan: InfinityScaleExecutionPlan,
  tickStart: number,
  tickEnd: number,
): InfinityScaleGlobalExecutionFrame {
  return advanceInfinityScaleGlobalFrame(
    beginInfinityScaleGlobalFrame(plan, tickStart, tickEnd),
    "local-execution",
  );
}

export function runInfinityScaleMixedLODCPURegression(): void {
  const state = new InfinityScaleLODState(4);
  const coarseKey = "1:0,0,0";
  const fineKeys = ["0:2,0,0", "0:2,1,0", "0:2,0,1", "0:2,1,1"];

  state.ensureChunk(coarseKey, 1);
  for (const fineKey of fineKeys) state.ensureChunk(fineKey, 0);

  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const coarse = new Float32Array(CELL_FIELDS);
        coarse[0] = 8;
        coarse[1] = 3;
        state.writeBaseCell(coarseKey, 1, x * 2, y * 2, z * 2, coarse);
      }
    }
  }

  for (const fineKey of fineKeys) {
    const parts = fineKey.split(":")[1].split(",").map(Number);
    const baseX = parts[0] * 4;
    const baseY = parts[1] * 4;
    const baseZ = parts[2] * 4;
    for (let z = 0; z < 4; z++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const fine = new Float32Array(CELL_FIELDS);
          fine[0] = 1;
          fine[1] = 5;
          state.writeBaseCell(fineKey, 0, baseX + x, baseY + y, baseZ + z, fine);
        }
      }
    }
  }

  const plan: InfinityScaleExecutionPlan = {
    revision: 1,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [
      { key: coarseKey, lod: 1, amr: 2, distance: 0 },
    ],
    simulationBudget: 64,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [...fineKeys],
    boundaryReadCount: fineKeys.length,
    boundaryReadRelations: fineKeys.map(sourceChunk => ({
      sourceChunk,
      targetChunk: coarseKey,
      relation: "fine-to-coarse" as const,
    })),
    simulationCellCount: 512,
    boundaryReadCellCount: 256,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: false,
    agentMigrationReady: false,
  };

  const context = new InfinityScaleChunkExecutionContext(plan, 12, 8, 8, 4);
  const frame: InfinityScaleGlobalExecutionFrame = makeLocalExecutionFrame(plan, 0, 1);

  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
  const executor = new InfinityScaleMixedLODCPUExecutor(state, context);
  const snapshotFingerprint = () => JSON.stringify(
    state.snapshot().chunks
      .map(chunk => ({
        key: chunk.key,
        level: chunk.level,
        scale: chunk.scale,
        cells: Array.from(chunk.cells),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );
  const beforeRejectedExecution = snapshotFingerprint();

  const alteredPlan: InfinityScaleExecutionPlan = {
    ...plan,
    chunks: [{ ...plan.chunks[0], key: fineKeys[0], lod: 0, amr: 1 }],
  };
  let alteredPlanRejected = false;
  try {
    executor.execute(frame, alteredPlan, transaction, cell => new Float32Array(cell.input));
  } catch (error) {
    alteredPlanRejected = error instanceof Error &&
      error.message.includes("context/plan geometry mismatch");
  }
  if (!alteredPlanRejected) {
    throw new Error("CPU executor accepted changed chunk ownership under the same plan revision");
  }

  const changedBudgetPlan: InfinityScaleExecutionPlan = {
    ...plan,
    simulationBudget: plan.simulationBudget + 1,
  };
  let changedBudgetRejected = false;
  try {
    executor.execute(frame, changedBudgetPlan, transaction, cell => new Float32Array(cell.input));
  } catch (error) {
    changedBudgetRejected = error instanceof Error &&
      error.message.includes("frame ownership changed");
  }
  if (!changedBudgetRejected) {
    throw new Error("CPU executor accepted a same-revision plan with changed scheduling budget");
  }

  const changedCellCountPlan: InfinityScaleExecutionPlan = {
    ...plan,
    simulationCellCount: plan.simulationCellCount + 1,
  };
  const changedCellCountFrame = makeLocalExecutionFrame(changedCellCountPlan, 0, 1);
  let changedCellCountRejected = false;
  try {
    executor.execute(
      changedCellCountFrame,
      changedCellCountPlan,
      transaction,
      cell => new Float32Array(cell.input),
    );
  } catch (error) {
    changedCellCountRejected = error instanceof Error &&
      error.message.includes("simulation geometry changed during frame");
  }
  if (!changedCellCountRejected) {
    throw new Error("CPU executor accepted frame cell counts inconsistent with its captured geometry context");
  }

  const wrongFrame = { ...frame, revision: frame.revision + 1 };
  let wrongFrameRejected = false;
  try {
    executor.execute(wrongFrame, plan, transaction, cell => new Float32Array(cell.input));
  } catch (error) {
    wrongFrameRejected = error instanceof Error &&
      error.message.includes("frame/transaction revision mismatch");
  }
  if (!wrongFrameRejected) {
    throw new Error("CPU executor accepted a transaction created for a different frame revision");
  }
  if (snapshotFingerprint() !== beforeRejectedExecution) {
    throw new Error("Rejected CPU execution mutated LOD state before validation");
  }

  const result = executor.execute(
    frame,
    plan,
    transaction,
    cell => {
      const output = new Float32Array(cell.input);
      output[0] += 1;
      return output;
    },
  );

  if (result.executedCells !== 64) {
    throw new Error(`Expected 64 executed coarse cells, received ${result.executedCells}`);
  }
  if (result.stagedBoundaryUpdates !== 16) {
    throw new Error(
      `Expected 16 boundary updates from four fine neighbors, received ${result.stagedBoundaryUpdates}`,
    );
  }
  if (!result.transactionReady) {
    throw new Error("Expected CPU mixed-LOD transaction to be ready");
  }

  const staged = transaction.synchronization.getStagedUpdates();
  if (staged.length !== 16 || staged.some(update => update.sourceCells.length !== 4)) {
    throw new Error("Expected ratio-2 face restriction to use exactly four source cells");
  }
  const targetKeys = new Set(
    staged.map(update => `${update.targetCell[0]},${update.targetCell[1]},${update.targetCell[2]}`),
  );
  if (targetKeys.size !== staged.length) {
    throw new Error("Four fine neighbors produced overlapping boundary target ownership");
  }

  frame.phase = "boundary-reconciliation";
  commitInfinityScaleGlobalLODTransaction(transaction, frame);

  const sample = state.readBaseCell(coarseKey, 1, 0, 0, 0);
  if (!sample || sample[0] !== 9) {
    throw new Error("CPU mixed-LOD local execution did not commit owned coarse state");
  }

  const advisoryPlan: InfinityScaleExecutionPlan = {
    ...plan,
    revision: plan.revision + 1,
    mode: "advisory",
    selectiveCpuReady: false,
  };
  const advisoryContext = new InfinityScaleChunkExecutionContext(advisoryPlan, 12, 8, 8, 4);
  const advisoryFrame: InfinityScaleGlobalExecutionFrame = makeLocalExecutionFrame(
    advisoryPlan,
    frame.tickEnd,
    frame.tickEnd + 1,
  );
  const advisoryTransaction = beginInfinityScaleGlobalLODTransaction(
    advisoryFrame,
    advisoryPlan,
    state,
  );
  const beforeAdvisoryExecution = snapshotFingerprint();
  let advisoryRejected = false;
  try {
    new InfinityScaleMixedLODCPUExecutor(state, advisoryContext).execute(
      advisoryFrame,
      advisoryPlan,
      advisoryTransaction,
      cell => new Float32Array(cell.input),
    );
  } catch (error) {
    advisoryRejected = error instanceof Error &&
      error.message.includes("selective CPU-ready plan");
  }
  if (!advisoryRejected) {
    throw new Error("CPU executor accepted an advisory plan with selective execution disabled");
  }
  if (snapshotFingerprint() !== beforeAdvisoryExecution) {
    throw new Error("Advisory CPU execution mutated LOD state despite readiness gates");
  }

  // The adapter normally rejects overlapping writable ownership. Exercise the
  // lower-level CPU executor directly so it cannot be used to write the same
  // physical cells through two different LOD chunks.
  const overlapState = new InfinityScaleLODState(4);
  overlapState.ensureChunk("1:0,0,0", 1);
  overlapState.ensureChunk("0:0,0,0", 0);
  const overlapPlan: InfinityScaleExecutionPlan = {
    ...plan,
    revision: 203,
    mode: "selective-cpu-ready",
    chunks: [
      { key: "1:0,0,0", lod: 1, amr: 2, distance: 0 },
      { key: "0:0,0,0", lod: 0, amr: 1, distance: 1 },
    ],
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 512,
    boundaryReadCellCount: 0,
  };
  const overlapContext = new InfinityScaleChunkExecutionContext(
    overlapPlan,
    8,
    8,
    8,
    4,
  );
  if (overlapContext.overlappingSimulationRangeCount === 0) {
    throw new Error("Overlap regression fixture does not contain overlapping physical ownership");
  }
  const overlapFrame: InfinityScaleGlobalExecutionFrame = makeLocalExecutionFrame(
    overlapPlan,
    2,
    3,
  );
  const overlapTransaction = beginInfinityScaleGlobalLODTransaction(
    overlapFrame,
    overlapPlan,
    overlapState,
  );
  const overlapStateBefore = JSON.stringify(
    overlapState.snapshot().chunks.map(chunk => ({
      key: chunk.key,
      level: chunk.level,
      cells: Array.from(chunk.cells),
    })).sort((a, b) => a.key.localeCompare(b.key)),
  );
  let overlapExecutionRejected = false;
  try {
    new InfinityScaleMixedLODCPUExecutor(overlapState, overlapContext).execute(
      overlapFrame,
      overlapPlan,
      overlapTransaction,
      cell => new Float32Array(cell.input),
    );
  } catch (error) {
    overlapExecutionRejected = error instanceof Error &&
      error.message.includes("overlapping simulation ownership");
  }
  if (!overlapExecutionRejected) {
    throw new Error("CPU executor accepted overlapping simulation ownership");
  }
  const overlapStateAfter = JSON.stringify(
    overlapState.snapshot().chunks.map(chunk => ({
      key: chunk.key,
      level: chunk.level,
      cells: Array.from(chunk.cells),
    })).sort((a, b) => a.key.localeCompare(b.key)),
  );
  if (overlapStateAfter !== overlapStateBefore) {
    throw new Error("Rejected overlapping CPU execution mutated hierarchical state");
  }
  rollbackInfinityScaleGlobalLODTransaction(overlapTransaction);
}


export function runInfinityScaleMixedLODCPUProlongationRegression(): void {
  const state = new InfinityScaleLODState(4);
  const coarseKey = "1:0,0,0";
  const fineKeys = ["0:2,0,0", "0:2,1,0", "0:2,0,1", "0:2,1,1"];

  state.ensureChunk(coarseKey, 1);
  for (const fineKey of fineKeys) state.ensureChunk(fineKey, 0);

  // Give every coarse face cell a distinct extensive energy value. Each fine
  // face cell receives one eighth of its source value, with four tangential
  // fine cells sharing each coarse face cell (2x2 footprint).
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const coarse = new Float32Array(CELL_FIELDS);
        coarse[0] = 100 + y * 10 + z;
        coarse[1] = 7;
        state.writeBaseCell(coarseKey, 1, x * 2, y * 2, z * 2, coarse);
      }
    }
  }

  for (const fineKey of fineKeys) {
    const parts = fineKey.split(":")[1].split(",").map(Number);
    const baseX = parts[0] * 4;
    const baseY = parts[1] * 4;
    const baseZ = parts[2] * 4;
    for (let z = 0; z < 4; z++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const fine = new Float32Array(CELL_FIELDS);
          fine[0] = 0;
          fine[1] = 11;
          state.writeBaseCell(fineKey, 0, baseX + x, baseY + y, baseZ + z, fine);
        }
      }
    }
  }

  const plan: InfinityScaleExecutionPlan = {
    revision: 2,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: fineKeys.map(key => ({ key, lod: 0, amr: 1, distance: 0 })),
    simulationBudget: 256,
    requestedSimulationCount: 4,
    selectedSimulationCount: 4,
    maxSimulatingChunks: 4,
    boundaryReadChunks: [coarseKey],
    boundaryReadCount: 1,
    boundaryReadRelations: fineKeys.map(targetChunk => ({
      sourceChunk: coarseKey,
      targetChunk,
      relation: "coarse-to-fine" as const,
    })),
    simulationCellCount: 256,
    boundaryReadCellCount: 512,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: false,
    agentMigrationReady: false,
  };

  const context = new InfinityScaleChunkExecutionContext(plan, 12, 8, 8, 4);
  const frame: InfinityScaleGlobalExecutionFrame = makeLocalExecutionFrame(plan, 1, 2);

  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
  const executor = new InfinityScaleMixedLODCPUExecutor(state, context);

  const result = executor.execute(
    frame,
    plan,
    transaction,
    cell => new Float32Array(cell.input),
  );

  if (result.executedCells !== 256) {
    throw new Error(
      `Expected 256 executed fine cells, received ${result.executedCells}`,
    );
  }
  if (result.stagedBoundaryUpdates !== 64) {
    throw new Error(
      `Expected 64 coarse-to-fine boundary updates, received ${result.stagedBoundaryUpdates}`,
    );
  }
  if (!result.transactionReady) {
    throw new Error("Expected CPU coarse-to-fine transaction to be ready");
  }

  const staged = transaction.synchronization.getStagedUpdates();
  if (staged.length !== 64 || staged.some(update => update.sourceCells.length !== 1)) {
    throw new Error(
      "Expected coarse-to-fine prolongation to use exactly one coarse source cell per fine target",
    );
  }

  const targetKeys = new Set(
    staged.map(update => `${update.targetCell[0]},${update.targetCell[1]},${update.targetCell[2]}`),
  );
  if (targetKeys.size !== 64) {
    throw new Error("Coarse-to-fine boundary staging produced overlapping fine target ownership");
  }

  const sourceToTargets = new Map<string, number>();
  for (const update of staged) {
    const source = update.sourceCells[0];
    const key = `${source[0]},${source[1]},${source[2]}`;
    sourceToTargets.set(key, (sourceToTargets.get(key) ?? 0) + 1);
  }
  if (sourceToTargets.size !== 16 || [...sourceToTargets.values()].some(count => count !== 4)) {
    throw new Error(
      "Expected each of the 16 coarse face cells to feed exactly four fine boundary cells",
    );
  }

  frame.phase = "boundary-reconciliation";
  commitInfinityScaleGlobalLODTransaction(transaction, frame);

  for (const update of staged) {
    const expected = (
      100 +
      Math.floor(update.targetCell[1] / 2) * 10 +
      Math.floor(update.targetCell[2] / 2)
    ) / 8;
    const actual = state.readBaseCell(
      update.targetChunk,
      update.targetLevel,
      ...update.targetCell,
    );
    if (!actual || actual[0] !== expected) {
      throw new Error(
        `Coarse-to-fine prolongation mismatch at ${update.targetChunk}:${update.targetCell.join(",")}: expected ${expected}, received ${actual?.[0]}`,
      );
    }
  }
}


export function runInfinityScaleMixedLODCPURollbackRegression(): void {
  const state = new InfinityScaleLODState(4);
  const key = "0:0,0,0";
  state.ensureChunk(key, 0);
  for (let z = 0; z < 4; z++) {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const cell = new Float32Array(CELL_FIELDS);
        cell[0] = x + y * 4 + z * 16;
        state.writeBaseCell(key, 0, x, y, z, cell);
      }
    }
  }

  const plan = {
    revision: 99,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [{ key, lod: 0, amr: 1, distance: 0 }],
    simulationBudget: 64,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 64,
    boundaryReadCellCount: 0,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: true,
    mixedLodExecutionReady: true,
    entityExecutionReady: false,
    agentMigrationReady: false,
  } as unknown as InfinityScaleExecutionPlan;
  const context = new InfinityScaleChunkExecutionContext(plan, 4, 4, 4, 4);
  const frame: InfinityScaleGlobalExecutionFrame = makeLocalExecutionFrame(plan, 0, 1);
  const before = state.snapshot();
  const revisionBefore = state.getRevision();
  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
  const executor = new InfinityScaleMixedLODCPUExecutor(state, context);
  let calls = 0;
  let failed = false;
  try {
    executor.execute(frame, plan, transaction, cell => {
      calls++;
      const output = new Float32Array(cell.input);
      output[0] += 1000;
      if (calls === 3) throw new Error("injected kernel failure");
      return output;
    });
  } catch (error) {
    failed = error instanceof Error && error.message === "injected kernel failure";
  }

  if (!failed || calls !== 3) {
    throw new Error("Expected the injected mid-frame CPU kernel failure");
  }
  if (state.getRevision() <= revisionBefore) {
    throw new Error("Rollback did not invalidate the failed transaction revision");
  }
  const after = state.snapshot();
  if (after.chunks.length !== before.chunks.length) {
    throw new Error("Rollback did not restore the original chunk set");
  }
  for (let i = 0; i < before.chunks.length; i++) {
    const expected = before.chunks[i];
    const actual = after.chunks.find(chunk => chunk.key === expected.key);
    if (!actual || actual.level !== expected.level || actual.scale !== expected.scale ||
        actual.cells.length !== expected.cells.length) {
      throw new Error("Rollback did not restore original chunk metadata");
    }
    for (let j = 0; j < expected.cells.length; j++) {
      if (actual.cells[j] !== expected.cells[j]) {
        throw new Error(`Rollback left a partial CPU write at ${expected.key} buffer offset ${j}`);
      }
    }
  }
}


/**
 * A boundary commit can fail after one or more target cells have already been
 * written. Verify the global transaction restores every byte of the original
 * state rather than leaving a partially reconciled frame.
 */
export function runInfinityScaleLODPartialBoundaryCommitRollbackRegression(): void {
  const state = new InfinityScaleLODState(4);
  const key = "0:0,0,0";
  const targetKey = "0:1,0,0";
  state.ensureChunk(key, 0);
  state.ensureChunk(targetKey, 0);
  const initial = new Float32Array(CELL_FIELDS);
  initial[0] = 17;
  initial[1] = 3;
  state.writeBaseCell(key, 0, 0, 0, 0, initial);
  const before = state.snapshot();

  const plan: InfinityScaleExecutionPlan = {
    revision: 101,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [{ key, lod: 0, amr: 1, distance: 0 }],
    simulationBudget: 64,
    requestedSimulationCount: 1,
    selectedSimulationCount: 1,
    maxSimulatingChunks: 1,
    boundaryReadChunks: [targetKey],
    boundaryReadCount: 1,
    boundaryReadRelations: [{
      sourceChunk: targetKey,
      targetChunk: key,
      relation: "same-level",
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
    entityExecutionReady: false,
    agentMigrationReady: false,
  };
  const frame: InfinityScaleGlobalExecutionFrame = {
    revision: 101,
    tickStart: 0,
    tickEnd: 1,
    phase: "boundary-reconciliation",
    planRevision: 101,
    simulationCellCount: 64,
    boundaryReadCellCount: 64,
    committed: false,
    finalized: false,
    ownershipFingerprint: "partial-boundary-rollback",
    capabilityFingerprint: "partial-boundary-rollback",
  };
  const transaction = beginInfinityScaleGlobalLODTransaction(frame, plan, state);
  const spec = {
    sourceChunk: targetKey,
    targetChunk: key,
    relation: "same-level" as const,
    sourceLevel: 0,
    targetLevel: 0,
    refinementRatio: 1,
    operation: "copy" as const,
    readOperation: "copy" as const,
  };
  const stagedValue = new Float32Array(initial);
  stagedValue[0] = 99;
  transaction.synchronization.stageTransfer(spec, [3, 0, 0], [stagedValue]);
  transaction.synchronization.stageTransfer(spec, [3, 1, 0], [stagedValue]);

  // Inject a failure on the second authoritative write after both valid face
  // updates have passed preflight. The transaction must restore the snapshot.
  const originalWrite = state.writeBaseCellForTransaction.bind(state);
  let boundaryWriteCalls = 0;
  state.writeBaseCellForTransaction = (
    expectedRevision,
    targetChunk,
    level,
    x,
    y,
    z,
    source,
  ) => {
    boundaryWriteCalls++;
    if (boundaryWriteCalls === 2) {
      throw new Error("injected boundary write failure");
    }
    originalWrite(expectedRevision, targetChunk, level, x, y, z, source);
  };

  let failed = false;
  try {
    commitInfinityScaleGlobalLODTransaction(transaction, frame);
  } catch (error) {
    failed = error instanceof Error && error.message.includes("injected boundary write failure");
  }
  if (!failed || boundaryWriteCalls !== 2) {
    throw new Error("Expected an injected partial boundary write failure after the first target was written");
  }

  const after = state.snapshot();
  if (state.getRevision() <= 0 || after.chunks.length !== before.chunks.length) {
    throw new Error("Partial boundary commit rollback did not restore the original chunk set");
  }
  for (const expectedChunk of before.chunks) {
    const actualChunk = after.chunks.find(chunk => chunk.key === expectedChunk.key);
    if (!actualChunk || actualChunk.level !== expectedChunk.level ||
        actualChunk.scale !== expectedChunk.scale ||
        actualChunk.cells.length !== expectedChunk.cells.length) {
      throw new Error("Partial boundary commit rollback changed chunk metadata");
    }
    for (let i = 0; i < expectedChunk.cells.length; i++) {
      if (actualChunk.cells[i] !== expectedChunk.cells[i]) {
        throw new Error(`Partial boundary commit left mutation at ${expectedChunk.key} offset ${i}`);
      }
    }
  }
}
