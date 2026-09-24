import { buildInfinityScaleReleaseCandidateManifest } from "./InfinityScaleReleaseCandidate";
import { runInfinityScaleReleaseValidation } from "./InfinityScaleReleaseValidation";

export interface InfinityScaleReleaseEvidence {
  releaseCandidate: string;
  branch: string;
  status: "CANDIDATE";
  validationHarness: string;
  validationTests: number;
  passed: number;
  failed: number;
  validationHash: string;
  deterministicReplay: boolean;
  failureReplay: boolean;
  causalClosedLoop: boolean;
}

export function buildInfinityScaleReleaseEvidence(
  branch = "infinity-scale-real-diagnostics",
): InfinityScaleReleaseEvidence {
  const validation = runInfinityScaleReleaseValidation();
  const manifest = buildInfinityScaleReleaseCandidateManifest(branch);

  return {
    releaseCandidate: manifest.releaseCandidate,
    branch: manifest.branch,
    status: manifest.status,
    validationHarness: manifest.validationHarness,
    validationTests: manifest.validationTests,
    passed: validation.passed,
    failed: validation.failed,
    validationHash: validation.validationHash,
    deterministicReplay: manifest.deterministicReplay,
    failureReplay: manifest.failureReplay,
    causalClosedLoop: manifest.causalClosedLoop,
  };
}
