import { runInfinityScaleAdaptiveLODTransactionBridgeRegression } from "../src/infinity/InfinityScaleAdaptiveLODTransactionBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "../src/infinity/InfinityScaleAdaptiveExecutionGraphCompiler.regression";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "../src/infinity/InfinityScaleGPUBoundaryTransferContract.regression";
import { runInfinityScaleCausalAdaptiveAttributionRegression } from "../src/infinity/InfinityScaleCausalAdaptiveAttribution.regression";

runInfinityScaleAdaptiveLODTransactionBridgeRegression();
runInfinityScaleAdaptiveTransferCompilerRegression();
runInfinityScaleAdaptiveExecutionGraphCompilerRegression();
runInfinityScaleGPUBoundaryTransferContractRegression();
runInfinityScaleCausalAdaptiveAttributionRegression();
console.log("Infinity Scale adaptive LOD bridge, execution graph, GPU boundary contract, and causal attribution regressions: PASS");
