import { buildInfinityScaleReleaseEvidence } from "../src/infinity/InfinityScaleReleaseEvidence";

const evidence = buildInfinityScaleReleaseEvidence();
if (evidence.failed !== 0 || evidence.passed !== evidence.validationTests) {
  throw new Error("Cannot emit Infinity Scale release evidence: validation is not clean");
}
console.log(JSON.stringify(evidence, null, 2));
