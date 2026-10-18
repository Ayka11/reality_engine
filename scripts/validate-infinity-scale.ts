import { runInfinityScaleReleaseValidation } from "../src/infinity/InfinityScaleReleaseValidation";
import { runSimulationEngineFrameRollbackRegression } from "../src/infinity/SimulationEngineFrameRollback.regression";
import { runWorldGenerationRNGRecoveryRegression } from "../src/infinity/WorldGenerationRNGRecovery.regression";

const result = runInfinityScaleReleaseValidation();
if (!result.allPassed) {
  throw new Error(`Infinity Scale release validation failed: ${result.failed}/${result.total}`);
}
await runSimulationEngineFrameRollbackRegression();
runWorldGenerationRNGRecoveryRegression();
console.log(JSON.stringify({ ...result, frameRollbackRegression: "passed", worldGenerationRNGRecoveryRegression: "passed" }));
