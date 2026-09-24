import { runInfinityScaleFailureReplay } from "./InfinityScaleFailureReplay";

export function runInfinityScaleFailureReplayRegression(): void {
  const result = runInfinityScaleFailureReplay();
  if (!result.deferredDeterministic) throw new Error("Deferred GPU replay is not deterministic");
  if (!result.incompleteDeterministic) throw new Error("Incomplete GPU replay is not deterministic");
  if (!result.commitBlocked) throw new Error("Failure replay did not block commit readiness");
  if (result.deferredCount !== 1 || result.incompleteCount !== 1) throw new Error("Unexpected failure replay counts");
}
