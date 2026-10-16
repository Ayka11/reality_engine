import { InfinityScaleV2 } from "../InfinityScaleV2";
import { InfinityScaleAdaptiveRuntime } from "./InfinityScaleAdaptiveRuntime";
import { beginInfinityScaleGlobalFrame, advanceInfinityScaleGlobalFrame } from "./InfinityScaleGlobalExecutionFrame";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

export function runInfinityScaleAdaptiveRuntimeRegression(): void {
  const runtime = new InfinityScaleAdaptiveRuntime(new InfinityScaleV2());
  const plan: InfinityScaleExecutionPlan = {
    revision: 0, mode: "selective-cpu-ready", observer: { x: 0, y: 0, z: 0 },
    chunks: [], simulationBudget: 0, requestedSimulationCount: 0, selectedSimulationCount: 0,
    maxSimulatingChunks: 0, boundaryReadChunks: [], boundaryReadCount: 0, boundaryReadRelations: [],
    simulationCellCount: 0, boundaryReadCellCount: 0, localExecutionLayers: [], globalExecutionLayers: [],
    selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
    lodBoundaryTransferReady: false, mixedLodExecutionReady: false,
    entityExecutionReady: false, agentMigrationReady: false,
  };
  const frame0 = beginInfinityScaleGlobalFrame(plan, 0, 1);
  const frame1 = advanceInfinityScaleGlobalFrame(frame0, "local-execution");
  const frame2 = advanceInfinityScaleGlobalFrame(frame1, "local-commit");
  const frame = advanceInfinityScaleGlobalFrame(frame2, "boundary-reconciliation");

  const committed = runtime.step({
    stateRevision: 0,
    topologyRevision: 0,
    mutations: [{
      regionId: "region-a",
      fromLOD: 0,
      toLOD: 1,
    }],
    gpuBudget: {
      maxDispatches: 8,
      maxWorkgroups: 8,
      maxDescriptors: 8,
    },
    conservationValid: true,
    gpuComplete: true,
  }, frame, plan);

  if (!committed.committed) throw new Error("Valid adaptive runtime step did not commit");
  if (committed.topologyRevision !== 1) {
    throw new Error("Topology revision did not advance after committed mutation");
  }
  if (committed.stateRevision !== 1) {
    throw new Error("State revision did not advance after commit");
  }
  if (committed.lodByRegion["region-a"] !== 1) {
    throw new Error("Committed LOD state was not persisted");
  }

  const blocked = runtime.step({
    stateRevision: 1,
    topologyRevision: 1,
    mutations: [{
      regionId: "region-a",
      fromLOD: 1,
      toLOD: 2,
    }],
    gpuBudget: {
      maxDispatches: 8,
      maxWorkgroups: 8,
      maxDescriptors: 8,
    },
    conservationValid: false,
    gpuComplete: true,
  });

  if (blocked.committed) throw new Error("Conservation failure must block runtime commit");
  if (runtime.getLOD("region-a") !== 1) {
    throw new Error("Blocked transaction mutated runtime LOD state");
  }

  let staleRejected = false;
  try {
    runtime.step({
      stateRevision: 0,
      topologyRevision: 1,
      mutations: [],
      gpuBudget: {
        maxDispatches: 8,
        maxWorkgroups: 8,
        maxDescriptors: 8,
      },
      conservationValid: true,
      gpuComplete: true,
    });
  } catch {
    staleRejected = true;
  }

  if (!staleRejected) throw new Error("Stale state revision was not rejected");
}
