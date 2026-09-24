import { buildInfinityScaleReleaseIntegrity } from "../src/infinity/InfinityScaleReleaseIntegrity";

const sourceCommit = process.env.GITHUB_SHA ?? "release-integrity-test-commit";
const first = buildInfinityScaleReleaseIntegrity(sourceCommit);
const second = buildInfinityScaleReleaseIntegrity(sourceCommit);

if (first.provenanceHash !== second.provenanceHash) {
  throw new Error("release provenance hash is not deterministic");
}

if (process.env.GITHUB_SHA && first.sourceCommit !== process.env.GITHUB_SHA) {
  throw new Error("CI source commit was not preserved");
}

console.log(JSON.stringify({
  status: "PASS",
  validation: "Infinity Scale RC-1 release integrity",
  sourceCommit: first.sourceCommit,
  provenanceHash: first.provenanceHash,
}, null, 2));
