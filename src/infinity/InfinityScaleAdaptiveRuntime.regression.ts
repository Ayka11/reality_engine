import { InfinityScaleV2 } from "../InfinityScaleV2";
import { InfinityScaleAdaptiveRuntime } from "./InfinityScaleAdaptiveRuntime";

export function runInfinityScaleAdaptiveRuntimeRegression(): void {
  const runtime = new InfinityScaleAdaptiveRuntime(new InfinityScaleV2());

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
  });

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
