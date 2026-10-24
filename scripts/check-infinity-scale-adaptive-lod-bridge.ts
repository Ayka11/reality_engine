import { runInfinityScaleAdaptiveLODTransactionBridgeRegression } from "../src/infinity/InfinityScaleAdaptiveLODTransactionBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveExecutionGraphCompiler.regression";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "../src/infinity/InfinityScaleGPUBoundaryTransferContract.regression";
import { runInfinityScaleCausalAdaptiveAttributionRegression } from "../src/infinity/InfinityScaleCausalAdaptiveAttribution.regression";
import { runInfinityScaleResolutionUtilityRegression } from "../src/infinity/InfinityScaleResolutionUtility.regression";
import { runInfinityScaleAdaptiveTransactionPreflightRegression } from "../src/infinity/InfinityScaleAdaptiveTransactionPreflight.regression";

runInfinityScaleAdaptiveLODTransactionBridgeRegression();
runInfinityScaleAdaptiveTransferCompilerRegression();
runInfinityScaleAdaptiveExecutionGraphCompilerRegression();
runInfinityScaleGPUBoundaryTransferContractRegression();
runInfinityScaleCausalAdaptiveAttributionRegression();
runInfinityScaleResolutionUtilityRegression();
runInfinityScaleAdaptiveTransactionPreflightRegression();
console.log("Infinity Scale adaptive LOD bridge, execution graph, GPU boundary contract, causal attribution, and isolated resolution utility and transaction preflight regressions: PASS");
