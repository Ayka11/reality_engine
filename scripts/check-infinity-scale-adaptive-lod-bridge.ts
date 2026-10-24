import { runInfinityScaleAdaptiveLODTransactionBridgeRegression } from "../src/infinity/InfinityScaleAdaptiveLODTransactionBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveExecutionGraphCompiler.regression";

runInfinityScaleAdaptiveLODTransactionBridgeRegression();
runInfinityScaleAdaptiveTransferCompilerRegression();
runInfinityScaleAdaptiveExecutionGraphCompilerRegression();
console.log("Infinity Scale adaptive LOD transaction bridge and transfer compiler regressions: PASS");
