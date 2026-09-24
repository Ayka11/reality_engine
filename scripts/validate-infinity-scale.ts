import { runInfinityScaleReleaseValidation } from "./InfinityScaleReleaseValidation";

const result = runInfinityScaleReleaseValidation();
if (!result.allPassed) {
  throw new Error(`Infinity Scale release validation failed: ${result.failed}/${result.total}`);
}
console.log(JSON.stringify(result));
