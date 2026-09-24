import { buildInfinityScaleReleaseEvidence } from "./InfinityScaleReleaseEvidence";

export function runInfinityScaleReleaseEvidenceRegression(): void {
  const evidence = buildInfinityScaleReleaseEvidence();

  if (evidence.releaseCandidate !== "Infinity Scale RC-1") throw new Error("unexpected release candidate");
  if (evidence.branch !== "infinity-scale-real-diagnostics") throw new Error("unexpected release branch");
  if (evidence.status !== "CANDIDATE") throw new Error("release evidence is not candidate status");
  if (evidence.validationHarness !== "InfinityScaleReleaseValidation") throw new Error("unexpected validation harness");
  if (evidence.validationTests !== 59) throw new Error("expected 59 validation tests, got " + evidence.validationTests);
  if (evidence.passed !== 59 || evidence.failed !== 0) throw new Error("release evidence does not report a clean validation");
  if (!/^[0-9a-f]{8}$/.test(evidence.validationHash)) throw new Error("invalid validation hash");
  if (!evidence.deterministicReplay || !evidence.failureReplay || !evidence.causalClosedLoop) {
    throw new Error("release evidence capability flags are incomplete");
  }
}
