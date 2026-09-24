import { evaluateInfinityScaleScenario } from "./InfinityScaleReactivePredictiveEvaluation";

export function runInfinityScaleReactivePredictiveEvaluationRegression(): void {
  const base = (epoch: number, mutations: number, transfers: number, commitReady: boolean) => ({
    epoch,
    stateRevision: epoch,
    topologyRevision: epoch,
    mutationCount: mutations,
    transferCount: transfers,
    deferredNodeCount: 0,
    conservationValid: true,
    gpuComplete: true,
    executable: true,
    commitReady,
    transferPlanHash: `tp-${epoch}`,
    graphHash: `g-${epoch}`,
    gpuPlanHash: `gpu-${epoch}`,
    pipelineHash: `p-${epoch}`,
  });

  const scenario = {
    scenarioId: "deterministic-comparison-001",
    reactive: [
      base(1, 2, 2, true),
      base(2, 2, 2, true),
      base(3, 1, 1, true),
    ],
    predictive: [
      base(1, 1, 1, true),
      base(2, 0, 0, true),
      base(3, 1, 1, true),
    ],
  };

  const comparison = evaluateInfinityScaleScenario(scenario);

  if (comparison.reactive.policy !== "REACTIVE") {
    throw new Error("Reactive policy was not labeled correctly");
  }
  if (comparison.predictive.policy !== "PREDICTIVE") {
    throw new Error("Predictive policy was not labeled correctly");
  }
  if (!comparison.deterministic) {
    throw new Error("Evaluation was not deterministic");
  }
  if (comparison.metricDeltas.averageMutationsPerEpoch >= 0) {
    throw new Error("Expected predictive mutation average to be lower");
  }
  if (!comparison.comparisonHash) {
    throw new Error("Missing comparison provenance hash");
  }

  const replay = evaluateInfinityScaleScenario(scenario);
  if (replay.comparisonHash !== comparison.comparisonHash) {
    throw new Error("Evaluation comparison hash is not deterministic");
  }
}
