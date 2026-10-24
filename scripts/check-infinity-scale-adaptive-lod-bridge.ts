import { runInfinityScaleAdaptiveLODTransactionBridgeRegression } from "../src/infinity/InfinityScaleAdaptiveLODTransactionBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveExecutionGraphCompiler.regression";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "../src/infinity/InfinityScaleGPUBoundaryTransferContract.regression";

runInfinityScaleAdaptiveLODTransactionBridgeRegression();
runInfinityScaleAdaptiveTransferCompilerRegression();
runInfinityScaleAdaptiveExecutionGraphCompilerRegression();
runInfinityScaleGPUBoundaryTransferContractRegression();
console.log("Infinity Scale adaptive LOD bridge, execution graph, and GPU boundary contract regressions: PASS");
