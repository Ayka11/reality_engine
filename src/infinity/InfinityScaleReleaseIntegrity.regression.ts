import { buildInfinityScaleReleaseIntegrity } from "./InfinityScaleReleaseIntegrity";

export function runInfinityScaleReleaseIntegrityRegression(): void {
  const sourceCommit = "release-integrity-test-commit";
  const first = buildInfinityScaleReleaseIntegrity(sourceCommit);
  const second = buildInfinityScaleReleaseIntegrity(sourceCommit);

  if (first.status !== "PROVENANCE_READY") throw new Error("provenance status is invalid");
  if (first.releaseCandidate !== "Infinity Scale RC-1") throw new Error("release candidate is invalid");
  if (first.branch !== "infinity-scale-real-diagnostics") throw new Error("release branch is invalid");
  if (first.sourceCommit !== sourceCommit) throw new Error("source commit was not preserved");
  if (!/^[0-9a-f]{8}$/.test(first.provenanceHash)) throw new Error("invalid provenance hash");
  if (first.provenanceHash !== second.provenanceHash) throw new Error("provenance hash is not deterministic");
}
