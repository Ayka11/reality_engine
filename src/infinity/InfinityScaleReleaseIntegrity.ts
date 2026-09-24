import { buildInfinityScaleReleaseEvidence } from "./InfinityScaleReleaseEvidence";

export interface InfinityScaleReleaseIntegrity {
  releaseCandidate: string;
  branch: string;
  validationHash: string;
  sourceCommit: string;
  provenanceHash: string;
  status: "PROVENANCE_READY";
}

export function buildInfinityScaleReleaseIntegrity(
  sourceCommit: string,
  branch = "infinity-scale-real-diagnostics",
): InfinityScaleReleaseIntegrity {
  const evidence = buildInfinityScaleReleaseEvidence(branch);
  if (evidence.failed !== 0 || evidence.passed !== evidence.validationTests) {
    throw new Error("Cannot establish release provenance from failed validation");
  }

  const provenanceHash = stableHash([
    evidence.releaseCandidate,
    evidence.branch,
    evidence.validationHarness,
    String(evidence.validationTests),
    String(evidence.passed),
    String(evidence.failed),
    evidence.validationHash,
    sourceCommit,
  ].join("|"));

  return {
    releaseCandidate: evidence.releaseCandidate,
    branch: evidence.branch,
    validationHash: evidence.validationHash,
    sourceCommit,
    provenanceHash,
    status: "PROVENANCE_READY",
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
