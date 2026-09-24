import type { InfinityScaleAdaptiveTelemetryRecord } from "./InfinityScaleAdaptiveTelemetryRecorder";
import {
  type InfinityScaleExperimentRun,
  registerInfinityScaleExperimentRuns,
} from "./InfinityScaleExperimentRunRegistry";

export type InfinityScaleBenchmarkMatrixPolicy =
  | "REACTIVE"
  | "PREDICTIVE"
  | "GOAL_DIRECTED_PREDICTIVE";

export interface InfinityScaleBenchmarkMatrixCell {
  scenarioId: string;
  policy: InfinityScaleBenchmarkMatrixPolicy;
  seed: number;
  runId: string;
  run: InfinityScaleExperimentRun;
}

export interface InfinityScaleBenchmarkMatrix {
  experimentId: string;
  scenarios: string[];
  policies: InfinityScaleBenchmarkMatrixPolicy[];
  seeds: number[];
  cells: InfinityScaleBenchmarkMatrixCell[];
  complete: boolean;
  matrixHash: string;
}

export function createInfinityScaleBenchmarkMatrix(
  experimentId: string,
  scenarios: string[],
  policies: InfinityScaleBenchmarkMatrixPolicy[],
  seeds: number[],
  telemetryProvider: (
    scenarioId: string,
    policy: InfinityScaleBenchmarkMatrixPolicy,
    seed: number,
  ) => InfinityScaleAdaptiveTelemetryRecord[],
): InfinityScaleBenchmarkMatrix {
  if (!experimentId) throw new Error("Experiment identifier is required");
  if (scenarios.length === 0) throw new Error("At least one scenario is required");
  if (policies.length === 0) throw new Error("At least one policy is required");
  if (seeds.length === 0) throw new Error("At least one seed is required");

  const uniqueScenarios = [...new Set(scenarios)].sort();
  const uniquePolicies = [...new Set(policies)].sort();
  const uniqueSeeds = [...new Set(seeds)].sort((a, b) => a - b);

  const inputs: Array<{
    runId: string;
    scenarioId: string;
    policy: InfinityScaleBenchmarkMatrixPolicy;
    seed: number;
    records: InfinityScaleAdaptiveTelemetryRecord[];
  }> = [];

  for (const scenarioId of uniqueScenarios) {
    for (const policy of uniquePolicies) {
      for (const seed of uniqueSeeds) {
        const runId = `${experimentId}::${scenarioId}::${policy}::${seed}`;
        inputs.push({
          runId,
          scenarioId,
          policy,
          seed,
          records: telemetryProvider(scenarioId, policy, seed).map(record => ({ ...record })),
        });
      }
    }
  }

  const registry = registerInfinityScaleExperimentRuns(experimentId, inputs);
  const cells = registry.runs.map(run => ({
    scenarioId: run.scenarioId,
    policy: run.policy as InfinityScaleBenchmarkMatrixPolicy,
    seed: run.seed,
    runId: run.runId,
    run,
  }));

  const expectedCells = uniqueScenarios.length * uniquePolicies.length * uniqueSeeds.length;

  return {
    experimentId,
    scenarios: uniqueScenarios,
    policies: uniquePolicies,
    seeds: uniqueSeeds,
    cells,
    complete: cells.length === expectedCells,
    matrixHash: stableHash(JSON.stringify({
      experimentId,
      scenarios: uniqueScenarios,
      policies: uniquePolicies,
      seeds: uniqueSeeds,
      cells: cells.map(cell => ({
        scenarioId: cell.scenarioId,
        policy: cell.policy,
        seed: cell.seed,
        runId: cell.runId,
        telemetryHash: cell.run.telemetryHash,
      })),
    })),
  };
}

export function validateInfinityScaleBenchmarkMatrix(
  matrix: InfinityScaleBenchmarkMatrix,
): boolean {
  const expected = matrix.scenarios.length * matrix.policies.length * matrix.seeds.length;
  if (!matrix.experimentId || matrix.cells.length !== expected || !matrix.complete) return false;

  const keys = new Set<string>();
  for (const cell of matrix.cells) {
    const key = `${cell.scenarioId}::${cell.policy}::${cell.seed}`;
    if (keys.has(key)) return false;
    if (cell.runId !== `${matrix.experimentId}::${key}`) return false;
    keys.add(key);
  }

  return matrix.matrixHash === stableHash(JSON.stringify({
    experimentId: matrix.experimentId,
    scenarios: matrix.scenarios,
    policies: matrix.policies,
    seeds: matrix.seeds,
    cells: matrix.cells.map(cell => ({
      scenarioId: cell.scenarioId,
      policy: cell.policy,
      seed: cell.seed,
      runId: cell.runId,
      telemetryHash: cell.run.telemetryHash,
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
