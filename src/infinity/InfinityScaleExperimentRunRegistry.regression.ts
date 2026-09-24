import {
  registerInfinityScaleExperimentRuns,
  validateInfinityScaleExperimentRunRegistry,
} from "./InfinityScaleExperimentRunRegistry";
import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";

function telemetry(epoch: number): InfinityScaleAdaptiveTelemetryRecord {
  return {
    epoch,
    stateRevision: epoch,
    topologyRevision: epoch,
    mutationCount: 1,
    transferCount: 1,
    deferredNodeCount: 0,
    conservationValid: true,
    gpuComplete: true,
    executable: true,
    commitReady: true,
    transferPlanHash: `transfer-${epoch}`,
    graphHash: `graph-${epoch}`,
    gpuPlanHash: `gpu-${epoch}`,
    pipelineHash: `pipeline-${epoch}`,
  };
}

export function runInfinityScaleExperimentRunRegistryRegression(): void {
  const registry = registerInfinityScaleExperimentRuns("experiment-001", [
    {
      runId: "run-002",
      scenarioId: "scenario-a",
      policy: "PREDICTIVE",
      seed: 2,
      records: [telemetry(1), telemetry(2)],
    },
    {
      runId: "run-001",
      scenarioId: "scenario-a",
      policy: "PREDICTIVE",
      seed: 1,
      records: [telemetry(1)],
    },
  ]);

  if (registry.runs[0].runId !== "run-001") {
    throw new Error("Run registry ordering is not deterministic");
  }
  if (!validateInfinityScaleExperimentRunRegistry(registry)) {
    throw new Error("Run registry validation failed");
  }
  if (!registry.registryHash) throw new Error("Registry hash missing");

  const replay = registerInfinityScaleExperimentRuns("experiment-001", [
    {
      runId: "run-002",
      scenarioId: "scenario-a",
      policy: "PREDICTIVE",
      seed: 2,
      records: [telemetry(1), telemetry(2)],
    },
    {
      runId: "run-001",
      scenarioId: "scenario-a",
      policy: "PREDICTIVE",
      seed: 1,
      records: [telemetry(1)],
    },
  ]);

  if (replay.registryHash !== registry.registryHash) {
    throw new Error("Run registry replay is not deterministic");
  }
}
