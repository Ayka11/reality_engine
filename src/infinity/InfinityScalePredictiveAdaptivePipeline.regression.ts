import { InfinityScalePredictiveAdaptivePipeline } from "./InfinityScalePredictiveAdaptivePipeline";

export function runInfinityScalePredictiveAdaptivePipelineRegression(): void {
  const pipeline = new InfinityScalePredictiveAdaptivePipeline();

  const input = {
    stateRevision: 10,
    topologyRevision: 20,
    expectedStateRevision: 10,
    expectedTopologyRevision: 20,
    mutations: [
      { regionId: "B", fromLOD: 2, toLOD: 1 },
      { regionId: "A", fromLOD: 1, toLOD: 2 },
    ],
    gpuBudget: {
      maxDispatches: 10,
      maxWorkgroups: 10,
      maxDescriptors: 10,
    },
    conservationValid: true,
    gpuComplete: true,
  };

  const result = pipeline.run(input);

  if (!result.executable || !result.commitReady) {
    throw new Error("Valid predictive adaptive pipeline did not reach commit-ready state");
  }
  if (result.mutationCount !== 2 || result.transferCount !== 2) {
    throw new Error("Unexpected predictive adaptive pipeline counts");
  }
  if (!result.transferPlanHash || !result.graphHash || !result.gpuPlanHash || !result.pipelineHash) {
    throw new Error("Missing pipeline provenance hashes");
  }
  if (result.deferredNodeIds.length !== 0) {
    throw new Error("Unexpected deferred nodes under sufficient budget");
  }

  const replay = pipeline.run({
    ...input,
    mutations: [
      { regionId: "A", fromLOD: 1, toLOD: 2 },
      { regionId: "B", fromLOD: 2, toLOD: 1 },
    ],
  });

  if (replay.pipelineHash !== result.pipelineHash) {
    throw new Error("Predictive adaptive pipeline is not deterministic");
  }

  const stale = pipeline.run({
    ...input,
    expectedStateRevision: 11,
  });
  if (stale.executable || stale.commitReady) {
    throw new Error("Stale state was permitted through the pipeline");
  }

  const budgetLimited = pipeline.run({
    ...input,
    gpuBudget: {
      maxDispatches: 1,
      maxWorkgroups: 1,
      maxDescriptors: 1,
    },
  });
  if (budgetLimited.commitReady) {
    throw new Error("Budget-limited pipeline incorrectly reached commit-ready state");
  }

  const conservationFailure = pipeline.run({
    ...input,
    conservationValid: false,
  });
  if (conservationFailure.executable !== true || conservationFailure.commitReady !== false) {
    throw new Error("Conservation failure did not block commit");
  }
}
