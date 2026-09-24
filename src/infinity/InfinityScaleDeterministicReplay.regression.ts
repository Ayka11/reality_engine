import { runInfinityScaleDeterministicReplay } from "./InfinityScaleDeterministicReplay";

export function runInfinityScaleDeterministicReplayRegression(): void {
  const input = {
    regions: [
      {
        regionId: "front",
        epoch: 1,
        currentLOD: 0,
        runtimeError: 0.8,
        field: "density",
        estimatedErrorReduction: 0.9,
        estimatedNewCells: 8,
        estimatedTransferDescriptors: 2,
        estimatedMemoryBytes: 1024,
        estimatedGPUWork: 4,
        physicalCriticality: 0.9,
        budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
      },
      {
        regionId: "background",
        epoch: 1,
        currentLOD: 0,
        runtimeError: 0.1,
        field: "density",
        estimatedErrorReduction: 0.3,
        estimatedNewCells: 8,
        estimatedTransferDescriptors: 2,
        estimatedMemoryBytes: 1024,
        estimatedGPUWork: 4,
        physicalCriticality: 0.2,
        budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
      },
    ],
    topology: [
      { regionId: "front", currentLOD: 0, proposedLOD: 0, neighbors: ["background"] },
      { regionId: "background", currentLOD: 0, proposedLOD: 0, neighbors: ["front"] },
    ],
  } as any;

  const a = runInfinityScaleDeterministicReplay(input);
  const b = runInfinityScaleDeterministicReplay(input);

  if (a.mutationPlanHash !== b.mutationPlanHash) throw new Error("Mutation plan replay is not deterministic");
  if (a.executablePlanHash !== b.executablePlanHash) throw new Error("Executable plan replay is not deterministic");
  if (JSON.stringify(a.recommendationHashes) !== JSON.stringify(b.recommendationHashes)) throw new Error("Recommendation replay is not deterministic");
}
