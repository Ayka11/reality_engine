import { buildInfinityScaleReleaseIntegrity } from "../src/infinity/InfinityScaleReleaseIntegrity";

const sourceCommit = process.env.GITHUB_SHA;
if (!sourceCommit) {
  throw new Error("Release package requires GITHUB_SHA; refusing to invent source provenance");
}

const integrity = buildInfinityScaleReleaseIntegrity(sourceCommit);

const packageRecord = {
  package: "Infinity Scale RC-1",
  packageVersion: "RC-1",
  sourceCommit: integrity.sourceCommit,
  reproducibility: {
    branch: integrity.branch,
    validationHash: integrity.validationHash,
    provenanceHash: integrity.provenanceHash,
  },
  status: integrity.status,
};

console.log(JSON.stringify(packageRecord, null, 2));
