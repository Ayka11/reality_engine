import { runInfinityScaleAdaptiveLODTransactionBridgeRegression } from "../src/infinity/InfinityScaleAdaptiveLODTransactionBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveExecutionGraphCompiler.regression";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "../src/infinity/InfinityScaleGPUBoundaryTransferContract.regression";
import { runInfinityScaleCausalAdaptiveAttributionRegression } from "../src/infinity/InfinityScaleCausalAdaptiveAttribution.regression";
import { runInfinityScaleResolutionUtilityRegression } from "../src/infinity/InfinityScaleResolutionUtility.regression";
import { runInfinityScaleAdaptiveTransactionPreflightRegression } from "../src/infinity/InfinityScaleAdaptiveTransactionPreflight.regression";
import { runInfinityScaleLODStateRecoveryRegression } from "../src/infinity/InfinityScaleLODStateRecovery.regression";

runInfinityScaleAdaptiveLODTransactionBridgeRegression();
runInfinityScaleAdaptiveTransferCompilerRegression();
runInfinityScaleAdaptiveExecutionGraphCompilerRegression();
runInfinityScaleGPUBoundaryTransferContractRegression();
runInfinityScaleCausalAdaptiveAttributionRegression();
runInfinityScaleResolutionUtilityRegression();
runInfinityScaleAdaptiveTransactionPreflightRegression();
runInfinityScaleLODStateRecoveryRegression();
console.log("Infinity Scale adaptive LOD bridge, execution graph, GPU boundary contract, causal attribution, resolution utility, transaction preflight, and hierarchical state recovery/key validation regressions: PASS");
