import { InfinityScaleAdaptiveFeedbackLoop, type InfinityScaleAdaptivePostCommitObservation } from "./InfinityScaleAdaptiveFeedbackLoop";
import type { InfinityScaleAdaptiveRuntimeResult } from "./InfinityScaleAdaptiveRuntime";

export interface InfinityScalePostCommitRuntimeObservationInput {
  epoch: number;
  errorBefore: number;
  errorAfter: number;
  runtime: InfinityScaleAdaptiveRuntimeResult;
}

export function observeInfinityScalePostCommitRuntime(
  feedback: InfinityScaleAdaptiveFeedbackLoop,
  input: InfinityScalePostCommitRuntimeObservationInput,
): InfinityScaleAdaptivePostCommitObservation {
  const observation: InfinityScaleAdaptivePostCommitObservation = {
    epoch: input.epoch,
    committed: input.runtime.committed,
    stateRevision: input.runtime.stateRevision,
    topologyRevision: input.runtime.topologyRevision,
    lodByRegion: input.runtime.lodByRegion,
    errorBefore: input.errorBefore,
    errorAfter: input.errorAfter,
    errorDelta: input.errorAfter - input.errorBefore,
    topologyChanged: input.runtime.topologyRevision > input.runtime.stateRevision - 1,
    observationHash: hashObservation(input),
  };
  feedback.observePostCommit(observation);
  return observation;
}

function hashObservation(input: InfinityScalePostCommitRuntimeObservationInput): string {
  const payload = JSON.stringify({
    epoch: input.epoch,
    errorBefore: input.errorBefore,
    errorAfter: input.errorAfter,
    committed: input.runtime.committed,
    stateRevision: input.runtime.stateRevision,
    topologyRevision: input.runtime.topologyRevision,
    lodByRegion: Object.fromEntries(Object.entries(input.runtime.lodByRegion).sort(([a], [b]) => a.localeCompare(b))),
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) hash = Math.imul(hash ^ payload.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
