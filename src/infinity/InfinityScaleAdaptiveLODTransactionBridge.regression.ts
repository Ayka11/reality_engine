import { InfinityScaleAdaptiveLODTransactionBridge } from "./InfinityScaleAdaptiveLODTransactionBridge";
import { beginInfinityScaleGlobalFrame, advanceInfinityScaleGlobalFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

export function runInfinityScaleAdaptiveLODTransactionBridgeRegression(): void {
  const plan: InfinityScaleExecutionPlan = {
    revision: 0, mode: "selective-cpu-ready", observer: { x: 0, y: 0, z: 0 },
    chunks: [], simulationBudget: 0, requestedSimulationCount: 0, selectedSimulationCount: 0,
    maxSimulatingChunks: 0, boundaryReadChunks: [], boundaryReadCount: 0, boundaryReadRelations: [],
    simulationCellCount: 0, boundaryReadCellCount: 0, localExecutionLayers: [], globalExecutionLayers: [],
    selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
    lodBoundaryTransferReady: false, mixedLodExecutionReady: false, entityExecutionReady: false, agentMigrationReady: false,
  };
  const state = new InfinityScaleLODState();
  const frame0 = beginInfinityScaleGlobalFrame(plan, 0, 1);
  const frame1 = advanceInfinityScaleGlobalFrame(frame0, "local-execution");
  const frame2 = advanceInfinityScaleGlobalFrame(frame1, "local-commit");
  const frame = advanceInfinityScaleGlobalFrame(frame2, "boundary-reconciliation");

  const bridge = new InfinityScaleAdaptiveLODTransactionBridge(plan, state);
  bridge.begin(frame);
  const result = bridge.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 0, toLOD: 1 }]);

  if (!result.committed) throw new Error("Adaptive LOD transaction did not commit");
  if (result.stateRevisionAfter !== 1) throw new Error("LOD state revision did not advance");
  if (!state.hasChunk("0:0,0,0")) throw new Error("Committed adaptive chunk is missing");

  const blocked = new InfinityScaleAdaptiveLODTransactionBridge(plan, state);
  blocked.begin(frame);
  let staleRejected = false;
  state.beginRevision();
  try {
    blocked.commit(frame, [{ regionId: "0:0,0,0", fromLOD: 1, toLOD: 2 }]);
  } catch {
    staleRejected = true;
  }
  if (!staleRejected) throw new Error("Stale LOD transaction was not rejected");
}
