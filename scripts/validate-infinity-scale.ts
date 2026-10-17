import { runInfinityScaleReleaseValidation } from "../src/infinity/InfinityScaleReleaseValidation";
import { runSimulationEngineFrameRollbackRegression } from "../src/infinity/SimulationEngineFrameRollback.regression";

const result = runInfinityScaleReleaseValidation();
if (!result.allPassed) {
  throw new Error(`Infinity Scale release validation failed: ${result.failed}/${result.total}`);
}
await runSimulationEngineFrameRollbackRegression();
console.log(JSON.stringify({ ...result, frameRollbackRegression: "passed" }));
