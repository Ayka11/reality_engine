import { InfinityScaleAdaptiveTransferCompiler } from "./InfinityScaleAdaptiveTransferCompiler";

export function runInfinityScaleAdaptiveTransferCompilerRegression(): void {
  const compiler = new InfinityScaleAdaptiveTransferCompiler();

  const plan = compiler.compile([
    { regionId: "B", fromLOD: 2, toLOD: 1 },
    { regionId: "A", fromLOD: 1, toLOD: 2 },
  ]);

  if (plan.transfers.length !== 2) throw new Error("Expected two compiled transfers");
  if (plan.transfers[0].regionId !== "A" || plan.transfers[1].regionId !== "B") {
    throw new Error("Transfer compilation ordering is not deterministic");
  }
  if (plan.transfers[0].operation !== "TOPOLOGY_RESTRICTION" || plan.transfers[1].operation !== "TOPOLOGY_PROLONGATION") {
    throw new Error("Incorrect topology transfer direction for coarse/fine LOD levels");
  }
  if (plan.transfers[0].ratio !== 2 || plan.transfers[1].ratio !== 2) {
    throw new Error("Incorrect refinement ratio");
  }
  if (!plan.conservationRequired || !plan.gpuExecutionRequired) {
    throw new Error("Compiled adaptive plan did not require conservation/GPU execution");
  }
  if (!plan.transferPlanHash) throw new Error("Missing deterministic transfer plan hash");

  const replay = compiler.compile([
    { regionId: "A", fromLOD: 1, toLOD: 2 },
    { regionId: "B", fromLOD: 2, toLOD: 1 },
  ]);
  if (replay.transferPlanHash !== plan.transferPlanHash) {
    throw new Error("Transfer plan hash is not deterministic");
  }

  const noop = compiler.compile([{ regionId: "A", fromLOD: 1, toLOD: 1 }]);
  if (noop.transfers.length !== 0 || noop.gpuExecutionRequired) {
    throw new Error("No-op mutation generated executable transfer work");
  }

  const invalidInputs: Array<{ label: string; input: unknown }> = [
    { label: "negative no-op LOD", input: [{ regionId: "A", fromLOD: -1, toLOD: -1 }] },
    { label: "above-range no-op LOD", input: [{ regionId: "A", fromLOD: 31, toLOD: 31 }] },
    { label: "empty region ID", input: [{ regionId: " ", fromLOD: 0, toLOD: 0 }] },
    { label: "non-array input", input: undefined },
  ];
  for (const invalid of invalidInputs) {
    let rejected = false;
    try {
      compiler.compile(invalid.input as never);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Adaptive transfer compiler accepted " + invalid.label);
  }

  const callerOwned = { regionId: "snapshot", fromLOD: 1, toLOD: 1 };
  const detachedPlan = compiler.compile([callerOwned]);
  callerOwned.toLOD = 2;
  if (detachedPlan.mutations[0]?.toLOD !== 1 || detachedPlan.transfers.length !== 0) {
    throw new Error("Compiled plan retained a caller-owned mutable mutation record");
  }

  const callerOwnedSpatialKeys = ["1:-1,0,-1", "1:0,0,0"];
  const spatialPlan = compiler.compile([{
    regionId: "spatial-snapshot",
    fromLOD: 1,
    toLOD: 0,
    spatialChunkKeys: callerOwnedSpatialKeys,
  }]);
  callerOwnedSpatialKeys.reverse();
  callerOwnedSpatialKeys[0] = "1:50,50,50";
  const capturedKeys = spatialPlan.mutations[0]?.spatialChunkKeys ?? [];
  if (capturedKeys.join("|") !== "1:-1,0,-1|1:0,0,0" || !Object.isFrozen(capturedKeys)) {
    throw new Error("Compiled adaptive plan did not detach and freeze physical region ownership keys");
  }
  const alternateSpatialPlan = compiler.compile([{
    regionId: "spatial-snapshot",
    fromLOD: 1,
    toLOD: 0,
    spatialChunkKeys: ["1:0,0,0", "1:1,0,0"],
  }]);
  if (alternateSpatialPlan.transferPlanHash === spatialPlan.transferPlanHash) {
    throw new Error("Transfer-plan hash ignored a changed physical region ownership mapping");
  }

  const invalidSpatialInputs: Array<{ label: string; keys: unknown }> = [
    { label: "empty physical key set", keys: [] },
    { label: "non-canonical physical key", keys: ["01:0,0,0"] },
    { label: "physical key from another LOD", keys: ["0:0,0,0"] },
    { label: "duplicate physical key", keys: ["1:0,0,0", "1:0,0,0"] },
    { label: "non-array physical key set", keys: "1:0,0,0" },
  ];
  for (const invalid of invalidSpatialInputs) {
    let rejected = false;
    try {
      compiler.compile([{
        regionId: "invalid-spatial",
        fromLOD: 1,
        toLOD: 0,
        spatialChunkKeys: invalid.keys as readonly string[],
      }]);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Adaptive compiler accepted " + invalid.label);
  }
}
