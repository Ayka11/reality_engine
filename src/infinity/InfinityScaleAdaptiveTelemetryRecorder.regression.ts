import { InfinityScaleAdaptiveTelemetryRecorder } from "./InfinityScaleAdaptiveTelemetryRecorder";

export function runInfinityScaleAdaptiveTelemetryRecorderRegression(): void {
  const recorder = new InfinityScaleAdaptiveTelemetryRecorder();

  recorder.record({
    epoch: 1,
    stateRevision: 10,
    topologyRevision: 20,
    mutationCount: 2,
    transferCount: 2,
    deferredNodeCount: 0,
    conservationValid: true,
    gpuComplete: true,
    executable: true,
    commitReady: true,
    transferPlanHash: "tp-1",
    graphHash: "g-1",
    gpuPlanHash: "gpu-1",
    pipelineHash: "p-1",
  });

  recorder.record({
    epoch: 2,
    stateRevision: 11,
    topologyRevision: 21,
    mutationCount: 1,
    transferCount: 1,
    deferredNodeCount: 2,
    conservationValid: true,
    gpuComplete: false,
    executable: true,
    commitReady: false,
    transferPlanHash: "tp-2",
    graphHash: "g-2",
    gpuPlanHash: "gpu-2",
    pipelineHash: "p-2",
  });

  const summary = recorder.summarize();
  if (summary.epochs !== 2) throw new Error("Incorrect telemetry epoch count");
  if (summary.executableEpochs !== 2) throw new Error("Incorrect executable epoch count");
  if (summary.commitReadyEpochs !== 1) throw new Error("Incorrect commit-ready count");
  if (summary.deferredEpochs !== 1) throw new Error("Incorrect deferred epoch count");
  if (summary.gpuIncompleteEpochs !== 1) throw new Error("Incorrect GPU incomplete count");
  if (!summary.deterministic || !summary.telemetryHash) {
    throw new Error("Telemetry provenance is not deterministic");
  }

  const replay = recorder.list();
  if (replay[0].epoch !== 1 || replay[1].epoch !== 2) {
    throw new Error("Telemetry ordering is not deterministic");
  }

  let duplicateRejected = false;
  try {
    recorder.record({ ...replay[0] });
  } catch {
    duplicateRejected = true;
  }
  if (!duplicateRejected) throw new Error("Duplicate telemetry epoch was accepted");

  recorder.clear();
  if (recorder.summarize().epochs !== 0) {
    throw new Error("Telemetry clear failed");
  }
}
