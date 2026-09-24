import { InfinityScaleAdaptiveRuntime } from "./InfinityScaleAdaptiveRuntime";
import { InfinityScaleV2 } from "../InfinityScaleV2";

export function runInfinityScaleAdaptiveRuntimeClosedLoopRegression(): void {
  const runtime = new InfinityScaleAdaptiveRuntime(new InfinityScaleV2());
  const common = {
    field: "density",
    estimatedErrorReduction: 0.9,
    estimatedNewCells: 8,
    estimatedTransferDescriptors: 2,
    estimatedMemoryBytes: 1024,
    estimatedGPUWork: 4,
    physicalCriticality: 0.9,
    budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
  };

  const first = runtime.stepClosedLoop([
    { ...common, regionId: "front", epoch: 1, runtimeError: 0.2, topology: { regionId: "front", currentLOD: 0, proposedLOD: 0, neighbors: ["background"] } },
    { ...common, regionId: "background", epoch: 1, runtimeError: 0.1, topology: { regionId: "background", currentLOD: 0, proposedLOD: 0, neighbors: ["front"] } },
  ], { maxDispatches: 10, maxWorkgroups: 10, maxDescriptors: 10 }, true, false);

  if (first.recommendations.length !== 2) throw new Error("Closed-loop runtime did not evaluate all regions");
  if (first.executablePlanHash.length === 0) throw new Error("Closed-loop runtime plan hash missing");
  if (first.committed) throw new Error("Runtime must not commit without completed GPU execution");

  const second = runtime.stepClosedLoop([
    { ...common, regionId: "front", epoch: 2, runtimeError: 0.45, topology: { regionId: "front", currentLOD: 0, proposedLOD: 0, neighbors: ["background"] } },
    { ...common, regionId: "background", epoch: 2, runtimeError: 0.1, topology: { regionId: "background", currentLOD: 0, proposedLOD: 0, neighbors: ["front"] } },
  ], { maxDispatches: 10, maxWorkgroups: 10, maxDescriptors: 10 }, true, false);

  if (second.recommendations[0].prediction.confidence < 0) throw new Error("Invalid prediction confidence");
}
