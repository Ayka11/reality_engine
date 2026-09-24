import { runInfinityScaleRuntimeReplay } from "./InfinityScaleRuntimeReplay";

export function runInfinityScaleRuntimeReplayRegression(): void {
  const region = (error: number) => ({
    regionId: "front",
    epoch: 1,
    runtimeError: error,
    field: "density",
    estimatedErrorReduction: 0.9,
    estimatedNewCells: 8,
    estimatedTransferDescriptors: 2,
    estimatedMemoryBytes: 1024,
    estimatedGPUWork: 4,
    physicalCriticality: 0.9,
    budget: { maxCells: 100, maxDescriptors: 100, maxMemoryBytes: 100000, maxGPUWork: 100 },
    topology: { regionId: "front", currentLOD: 0, proposedLOD: 0, neighbors: [] },
  });

  const epochs = [
    { epoch: 1, stateRevision: 0, topologyRevision: 0, regions: [region(0.8) as any], errorAfterCommit: 0.7, committed: true, topologyChanged: true },
    { epoch: 2, stateRevision: 1, topologyRevision: 1, regions: [region(0.6) as any], errorAfterCommit: 0.5, committed: true, topologyChanged: false },
    { epoch: 3, stateRevision: 2, topologyRevision: 1, regions: [region(0.4) as any], errorAfterCommit: 0.35, committed: false, topologyChanged: false },
  ];

  const a = runInfinityScaleRuntimeReplay(epochs);
  const b = runInfinityScaleRuntimeReplay(epochs);

  if (a.deterministicHash !== b.deterministicHash) throw new Error("Multi-epoch runtime replay is not deterministic");
  if (a.epochs !== 3) throw new Error("Unexpected runtime replay epoch count");
  if (a.finalStateRevision !== 2 || a.finalTopologyRevision !== 1) throw new Error("Runtime replay revision trace mismatch");
  if (a.transitionPenalties[1] <= 0) throw new Error("Post-commit transition penalty did not propagate to the next epoch");
}
