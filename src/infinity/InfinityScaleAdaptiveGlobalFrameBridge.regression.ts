import { InfinityScaleV2 } from "../InfinityScaleV2";
import { beginInfinityScaleGlobalFrame } from "./InfinityScaleGlobalExecutionFrame";
import { InfinityScaleAdaptiveRuntime } from "./InfinityScaleAdaptiveRuntime";
import { InfinityScaleAdaptiveGlobalFrameBridge } from "./InfinityScaleAdaptiveGlobalFrameBridge";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

export function runInfinityScaleAdaptiveGlobalFrameBridgeRegression(): void {
  const plan: InfinityScaleExecutionPlan = {
    revision: 0,
    mode: "selective-cpu-ready",
    observer: { x: 0, y: 0, z: 0 },
    chunks: [],
    simulationBudget: 0,
    requestedSimulationCount: 0,
    selectedSimulationCount: 0,
    maxSimulatingChunks: 0,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 0,
    boundaryReadCellCount: 0,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: false,
    mixedLodExecutionReady: false,
    entityExecutionReady: false,
    agentMigrationReady: false,
  };

  const frame = beginInfinityScaleGlobalFrame(plan, 0, 1);
  const runtime = new InfinityScaleAdaptiveRuntime(new InfinityScaleV2());
  const bridge = new InfinityScaleAdaptiveGlobalFrameBridge(runtime, plan);

  let rejected = false;
  try {
    bridge.commitAtBoundary(frame, {
      stateRevision: 0,
      topologyRevision: 0,
      mutations: [{ regionId: "r", fromLOD: 0, toLOD: 1 }],
      gpuBudget: { maxDispatches: 8, maxWorkgroups: 8, maxDescriptors: 8 },
      conservationValid: true,
      gpuComplete: true,
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Adaptive commit must be rejected before boundary reconciliation");

  const boundary = bridge.advanceToBoundary(frame);
  if (boundary.phase !== "boundary-reconciliation") {
    throw new Error("Bridge did not advance frame to boundary reconciliation");
  }

  let topologyRejected = false;
  try {
    bridge.commitAtBoundary(boundary, {
      stateRevision: 0,
      topologyRevision: 0,
      mutations: [{ regionId: "r", fromLOD: 0, toLOD: 1 }],
      gpuBudget: { maxDispatches: 8, maxWorkgroups: 8, maxDescriptors: 8 },
      conservationValid: true,
      gpuComplete: true,
    });
  } catch (error) {
    topologyRejected = error instanceof Error && error.message.includes("physical chunk remapping");
  }
  if (!topologyRejected) throw new Error("Boundary bridge must reject topology changes without physical remapping");
  if (runtime.getTopologyRevision() !== 0) throw new Error("Rejected boundary topology mutation advanced revision");
}
