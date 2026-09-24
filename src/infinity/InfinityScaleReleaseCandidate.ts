import { runInfinityScaleReleaseValidation } from "./InfinityScaleReleaseValidation";

export interface InfinityScaleReleaseCandidateManifest {
  releaseCandidate: string;
  branch: string;
  validationTests: number;
  validationHarness: string;
  deterministicReplay: boolean;
  failureReplay: boolean;
  causalClosedLoop: boolean;
  status: "CANDIDATE";
}

export function buildInfinityScaleReleaseCandidateManifest(
  branch = "infinity-scale-real-diagnostics",
): InfinityScaleReleaseCandidateManifest {
  const validation = runInfinityScaleReleaseValidation();
  if (!validation.allPassed) throw new Error("Cannot create release candidate: regression validation failed");

  return {
    releaseCandidate: "Infinity Scale RC-1",
    branch,
    validationTests: validation.total,
    validationHarness: "InfinityScaleReleaseValidation",
    deterministicReplay: true,
    failureReplay: true,
    causalClosedLoop: true,
    status: "CANDIDATE",
  };
}
