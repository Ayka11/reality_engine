import { runInfinityScaleReleaseValidation } from "../src/infinity/InfinityScaleReleaseValidation";
import { runSimulationEngineFrameRollbackRegression } from "../src/infinity/SimulationEngineFrameRollback.regression";
import { runWorldGenerationRNGRecoveryRegression } from "../src/infinity/WorldGenerationRNGRecovery.regression";
import { runInfinityScaleRuntimeRegressionSuite } from "../src/infinity/InfinityScaleRuntimeRegressionSuite";

const result = runInfinityScaleReleaseValidation();
if (!result.allPassed) {
  throw new Error(`Infinity Scale release validation failed: ${result.failed}/${result.total}`);
}
const runtimeRegressionResults = await runInfinityScaleRuntimeRegressionSuite();
await runSimulationEngineFrameRollbackRegression();
runWorldGenerationRNGRecoveryRegression();
console.log(JSON.stringify({ ...result, runtimeRegressionResults, frameRollbackRegression: "passed", worldGenerationRNGRecoveryRegression: "passed" }));
