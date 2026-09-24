import type { InfinityScaleStatisticalSummary } from "./InfinityScaleStatisticalExperiment";
import type { InfinityScaleCrossPolicyComparison } from "./InfinityScaleCrossPolicyComparison";

export interface InfinityScaleReproducibilityManifest {
  manifestVersion: string;
  experimentId: string;
  scenarioId: string;
  policies: string[];
  seeds: number[];
  runsPerPolicy: Record<string, number>;
  configurationFingerprint: string;
  goalFingerprint: string;
  budgetFingerprint: string;
  predictionModelVersion: string;
  topologyConfigurationVersion: string;
  statisticalReproducibilityHashes: Record<string, string>;
  comparisonHash: string;
  deterministic: boolean;
  manifestHash: string;
}

export interface InfinityScaleReproducibilityInput {
  experimentId: string;
  scenarioId: string;
  policies: string[];
  seeds: number[];
  summaries: InfinityScaleStatisticalSummary[];
  comparison: InfinityScaleCrossPolicyComparison;
  configurationFingerprint: string;
  goalFingerprint: string;
  budgetFingerprint: string;
  predictionModelVersion: string;
  topologyConfigurationVersion: string;
}

export function createInfinityScaleReproducibilityManifest(
  input: InfinityScaleReproducibilityInput,
): InfinityScaleReproducibilityManifest {
  if (!input.experimentId || !input.scenarioId) {
    throw new Error("Experiment and scenario identifiers are required");
  }
  if (input.policies.length < 2) {
    throw new Error("At least two policies are required");
  }
  if (input.summaries.length !== input.policies.length) {
    throw new Error("Summary count must match policy count");
  }
  if (input.comparison.scenarioId !== input.scenarioId) {
    throw new Error("Comparison scenario does not match manifest scenario");
  }

  const runsPerPolicy: Record<string, number> = {};
  const statisticalReproducibilityHashes: Record<string, string> = {};

  for (const summary of input.summaries) {
    runsPerPolicy[summary.policy] = summary.runs;
    statisticalReproducibilityHashes[summary.policy] = summary.reproducibilityHash;
  }

  const deterministic =
    input.comparison.deterministic &&
    input.summaries.every(summary => summary.deterministic);

  const manifestPayload = {
    manifestVersion: "1.0",
    experimentId: input.experimentId,
    scenarioId: input.scenarioId,
    policies: [...input.policies],
    seeds: [...input.seeds],
    runsPerPolicy,
    configurationFingerprint: input.configurationFingerprint,
    goalFingerprint: input.goalFingerprint,
    budgetFingerprint: input.budgetFingerprint,
    predictionModelVersion: input.predictionModelVersion,
    topologyConfigurationVersion: input.topologyConfigurationVersion,
    statisticalReproducibilityHashes,
    comparisonHash: input.comparison.comparisonHash,
    deterministic,
  };

  return {
    ...manifestPayload,
    manifestHash: stableHash(JSON.stringify(manifestPayload)),
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
