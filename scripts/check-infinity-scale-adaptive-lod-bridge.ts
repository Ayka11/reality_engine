import { runInfinityScaleAdaptiveLODTransactionBridgeRegression } from "../src/infinity/InfinityScaleAdaptiveLODTransactionBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveExecutionGraphCompiler.regression";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "../src/infinity/InfinityScaleGPUBoundaryTransferContract.regression";
import { runInfinityScaleCausalAdaptiveAttributionRegression } from "../src/infinity/InfinityScaleCausalAdaptiveAttribution.regression";
import { runInfinityScaleResolutionUtilityRegression } from "../src/infinity/InfinityScaleResolutionUtility.regression";

runInfinityScaleAdaptiveLODTransactionBridgeRegression();
runInfinityScaleAdaptiveTransferCompilerRegression();
runInfinityScaleAdaptiveExecutionGraphCompilerRegression();
runInfinityScaleGPUBoundaryTransferContractRegression();
runInfinityScaleCausalAdaptiveAttributionRegression();
runInfinityScaleResolutionUtilityRegression();
console.log("Infinity Scale adaptive LOD bridge, execution graph, GPU boundary contract, causal attribution, and isolated resolution utility regressions: PASS");
