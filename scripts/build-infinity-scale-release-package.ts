import { buildInfinityScaleReleaseEvidence } from "../src/infinity/InfinityScaleReleaseEvidence";

const evidence = buildInfinityScaleReleaseEvidence();

if (evidence.failed !== 0 || evidence.passed !== evidence.validationTests) {
  throw new Error("Release package blocked: validation evidence is not clean");
}

const packageRecord = {
  package: "Infinity Scale RC-1",
  packageVersion: "RC-1",
  generatedAt: new Date().toISOString(),
  reproducibility: {
    branch: evidence.branch,
    validationHarness: evidence.validationHarness,
    validationTests: evidence.validationTests,
    passed: evidence.passed,
    failed: evidence.failed,
    validationHash: evidence.validationHash,
  },
  capabilities: {
    deterministicReplay: evidence.deterministicReplay,
    failureReplay: evidence.failureReplay,
    causalClosedLoop: evidence.causalClosedLoop,
  },
  status: evidence.status,
};

console.log(JSON.stringify(packageRecord, null, 2));
