import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";
import {
  analyzeInfinityScaleAdaptiveTelemetry,
  type InfinityScaleAdaptiveScientificMetrics,
} from "./InfinityScaleAdaptiveScientificMetrics";

export interface InfinityScaleExperimentRun {
  runId: string;
  experimentId: string;
  scenarioId: string;
  policy: string;
  seed: number;
  records: InfinityScaleAdaptiveTelemetryRecord[];
  metrics: InfinityScaleAdaptiveScientificMetrics;
  telemetryHash: string;
}

export interface InfinityScaleExperimentRunRegistry {
  experimentId: string;
  runs: InfinityScaleExperimentRun[];
  registryHash: string;
}

export function registerInfinityScaleExperimentRuns(
  experimentId: string,
  runs: Array<{
    runId: string;
    scenarioId: string;
    policy: string;
    seed: number;
    records: InfinityScaleAdaptiveTelemetryRecord[];
  }>,
): InfinityScaleExperimentRunRegistry {
  if (!experimentId) throw new Error("Experiment identifier is required");
  if (runs.length === 0) throw new Error("At least one run is required");

  const seen = new Set<string>();
  const registered = runs.map(run => {
    if (!run.runId || seen.has(run.runId)) {
      throw new Error("Run identifiers must be non-empty and unique");
    }
    seen.add(run.runId);
    if (!run.scenarioId || !run.policy) {
      throw new Error("Scenario and policy are required for every run");
    }

    const metrics = analyzeInfinityScaleAdaptiveTelemetry(run.records);
    return {
      ...run,
      metrics,
      telemetryHash: stableHash(JSON.stringify(run.records)),
    };
  });

  registered.sort((a, b) => a.runId.localeCompare(b.runId));

  const registryPayload = {
    experimentId,
    runs: registered.map(run => ({
      runId: run.runId,
      scenarioId: run.scenarioId,
      policy: run.policy,
      seed: run.seed,
      telemetryHash: run.telemetryHash,
      metrics: run.metrics,
    })),
  };

  return {
    experimentId,
    runs: registered.map(run => ({
      ...run,
      records: run.records.map(record => ({ ...record })),
    })),
    registryHash: stableHash(JSON.stringify(registryPayload)),
  };
}

export function validateInfinityScaleExperimentRunRegistry(
  registry: InfinityScaleExperimentRunRegistry,
): boolean {
  if (!registry.experimentId || registry.runs.length === 0) return false;
  const ids = new Set<string>();

  for (const run of registry.runs) {
    if (!run.runId || ids.has(run.runId)) return false;
    if (run.experimentId !== registry.experimentId) return false;
    if (!run.scenarioId || !run.policy || !run.telemetryHash) return false;
    ids.add(run.runId);
  }

  return registry.registryHash === stableHash(JSON.stringify({
    experimentId: registry.experimentId,
    runs: registry.runs.map(run => ({
      runId: run.runId,
      scenarioId: run.scenarioId,
      policy: run.policy,
      seed: run.seed,
      telemetryHash: run.telemetryHash,
      metrics: run.metrics,
    })),
  }));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
