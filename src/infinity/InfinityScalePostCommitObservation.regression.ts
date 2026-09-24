import { InfinityScaleAdaptiveFeedbackLoop } from "./InfinityScaleAdaptiveFeedbackLoop";
import { observeInfinityScalePostCommitRuntime } from "./InfinityScalePostCommitRuntimeObservation";
import type { InfinityScaleAdaptiveRuntimeResult } from "./InfinityScaleAdaptiveRuntime";

export function runInfinityScalePostCommitObservationRegression(): void {
  const feedback = new InfinityScaleAdaptiveFeedbackLoop();
  const runtime = {
    committed: true,
    topologyChanged: true,
    stateRevision: 3,
    topologyRevision: 2,
    lodByRegion: { a: 2, b: 1 },
  } as InfinityScaleAdaptiveRuntimeResult;

  const first = observeInfinityScalePostCommitRuntime(feedback, {
    epoch: 4, errorBefore: 0.8, errorAfter: 0.35, runtime,
  });
  if (!first.committed || !first.topologyChanged) throw new Error("Post-commit state was not recorded");
  if (first.errorDelta !== -0.45) throw new Error("Post-commit error delta is incorrect");
  if (first.observationHash.length !== 8) throw new Error("Post-commit observation hash is invalid");

  const second = observeInfinityScalePostCommitRuntime(feedback, {
    epoch: 5, errorBefore: 0.35, errorAfter: 0.3, runtime: { ...runtime, stateRevision: 4, topologyChanged: false } as InfinityScaleAdaptiveRuntimeResult,
  });
  if (second.observationHash !== observeInfinityScalePostCommitRuntime(feedback, {
    epoch: 6, errorBefore: 0.3, errorAfter: 0.25, runtime: { ...runtime, stateRevision: 4, topologyChanged: false } as InfinityScaleAdaptiveRuntimeResult,
  }).observationHash) throw new Error("Observation hashing is not deterministic for equivalent state");
  if (feedback.getPostCommitObservations().length !== 3) throw new Error("Post-commit history length is incorrect");
  if (feedback.summary().committedRate !== 1) throw new Error("Committed rate is incorrect");
}
