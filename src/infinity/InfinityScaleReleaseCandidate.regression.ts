import { buildInfinityScaleReleaseCandidateManifest } from "./InfinityScaleReleaseCandidate";

export function runInfinityScaleReleaseCandidateRegression(): void {
  const manifest = buildInfinityScaleReleaseCandidateManifest();
  if (manifest.releaseCandidate !== "Infinity Scale RC-1") throw new Error("Unexpected release candidate identifier");
  if (manifest.validationTests !== 59) throw new Error("Release candidate validation count mismatch");
  if (manifest.status !== "CANDIDATE") throw new Error("Release candidate status mismatch");
  if (!manifest.deterministicReplay || !manifest.failureReplay || !manifest.causalClosedLoop) {
    throw new Error("Release candidate manifest is incomplete");
  }
}
