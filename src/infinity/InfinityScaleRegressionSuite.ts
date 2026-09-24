import { runInfinityScaleLODBoundaryCellMapperRegression } from "./InfinityScaleLODBoundaryCellMapper.regression";
import { runInfinityScaleLODBoundaryRegression } from "./InfinityScaleLODBoundarySnapshot.regression";
import {
  runInfinityScaleMixedLODCPURegression,
  runInfinityScaleMixedLODCPUProlongationRegression,
} from "./InfinityScaleMixedLODCPUExecutor.regression";
import { runInfinityScaleUnifiedTransactionRegression } from "./InfinityScaleUnifiedTransaction.regression";
import { runInfinityScaleLODResetInvalidationRegression } from "./InfinityScaleLODState.regression";
import { runInfinityScaleLODMultiFrameRegression } from "./InfinityScaleLODMultiFrame.regression";
import { runInfinityScaleMixedLODMultiFrameRegression } from "./InfinityScaleMixedLODMultiFrame.regression";
import { runInfinityScaleExecutionAdapterBoundaryRegression } from "./InfinityScaleExecutionAdapter.regression";
import { runInfinityScaleChunkExecutionContextBoundaryRegression } from "./InfinityScaleChunkExecutionContext.regression";
import { runInfinityScaleLODTransferInvariantRegression } from "./InfinityScaleLODTransfer.regression";
import { runInfinityScaleGPUBoundaryTransferContractRegression } from "./InfinityScaleGPUBoundaryTransferContract.regression";
import { runInfinityScaleAdaptiveStabilityRegression } from "./InfinityScaleAdaptiveStability.regression";
import { runInfinityScaleAdaptiveEndToEndRegression } from "./InfinityScaleAdaptiveEndToEnd.regression";
import { runInfinityScalePredictionEngineRegression } from "./InfinityScalePredictionEngine.regression";
import { runInfinityScaleResolutionGoalRegistryRegression } from "./InfinityScaleResolutionGoalRegistry.regression";
import { runInfinityScaleResolutionUtilityRegression } from "./InfinityScaleResolutionUtility.regression";
import { runInfinityScalePredictiveAdaptiveControllerRegression } from "./InfinityScalePredictiveAdaptiveController.regression";
import { runInfinityScaleGlobalAdaptivePlannerRegression } from "./InfinityScaleGlobalAdaptivePlanner.regression";
import { runInfinityScaleSpatialConstraintClosureRegression } from "./InfinityScaleSpatialConstraintClosure.regression";
import { runInfinityScaleTopologyMutationBridgeRegression } from "./InfinityScaleTopologyMutationBridge.regression";
import { runInfinityScaleAdaptiveTransferCompilerRegression } from "./InfinityScaleAdaptiveTransferCompiler.regression";
import { runInfinityScaleAdaptiveExecutionGraphCompilerRegression } from "./InfinityScaleAdaptiveExecutionGraphCompiler.regression";
import { runInfinityScaleGPUExecutionPlanAdapterRegression } from "./InfinityScaleGPUExecutionPlanAdapter.regression";
import { runInfinityScaleAdaptiveTransactionGateRegression } from "./InfinityScaleAdaptiveTransactionGate.regression";
import { runInfinityScalePredictiveAdaptivePipelineRegression } from "./InfinityScalePredictiveAdaptivePipeline.regression";
import { runInfinityScaleAdaptiveTelemetryRecorderRegression } from "./InfinityScaleAdaptiveTelemetryRecorder.regression";

export interface InfinityScaleRegressionResult {
  name: string;
  passed: boolean;
}

export function runInfinityScaleRegressionSuite(): InfinityScaleRegressionResult[] {
  const tests: Array<[string, () => void]> = [
    ["canonical-boundary-mapper", runInfinityScaleLODBoundaryCellMapperRegression],
    ["execution-adapter-canonical-boundary", runInfinityScaleExecutionAdapterBoundaryRegression],
    ["chunk-context-canonical-boundary", runInfinityScaleChunkExecutionContextBoundaryRegression],
    ["lod-boundary-transfer-and-convergence", runInfinityScaleLODBoundaryRegression],
    ["mixed-lod-cpu-restriction", runInfinityScaleMixedLODCPURegression],
    ["mixed-lod-cpu-prolongation", runInfinityScaleMixedLODCPUProlongationRegression],
    ["lod-transfer-physical-invariants", runInfinityScaleLODTransferInvariantRegression],
    ["gpu-boundary-transfer-contract", runInfinityScaleGPUBoundaryTransferContractRegression],
    ["unified-transaction", runInfinityScaleUnifiedTransactionRegression],
    ["lod-reset-invalidation", runInfinityScaleLODResetInvalidationRegression],
    ["lod-multi-frame", runInfinityScaleLODMultiFrameRegression],
    ["mixed-lod-multi-frame", runInfinityScaleMixedLODMultiFrameRegression],
    ["adaptive-stability-anti-thrashing", runInfinityScaleAdaptiveStabilityRegression],
    ["adaptive-end-to-end", runInfinityScaleAdaptiveEndToEndRegression],
    ["predictive-resolution-engine", runInfinityScalePredictionEngineRegression],
    ["goal-directed-resolution-registry", runInfinityScaleResolutionGoalRegistryRegression],
    ["resolution-utility-budget-optimizer", runInfinityScaleResolutionUtilityRegression],
    ["predictive-adaptive-controller", runInfinityScalePredictiveAdaptiveControllerRegression],
    ["global-adaptive-planner", runInfinityScaleGlobalAdaptivePlannerRegression],
    ["spatial-constraint-closure", runInfinityScaleSpatialConstraintClosureRegression],
    ["topology-mutation-bridge", runInfinityScaleTopologyMutationBridgeRegression],
    ["adaptive-transfer-compiler", runInfinityScaleAdaptiveTransferCompilerRegression],
    ["adaptive-execution-graph-compiler", runInfinityScaleAdaptiveExecutionGraphCompilerRegression],
    ["gpu-execution-plan-adapter", runInfinityScaleGPUExecutionPlanAdapterRegression],
    ["adaptive-transaction-gate", runInfinityScaleAdaptiveTransactionGateRegression],
    ["predictive-adaptive-pipeline", runInfinityScalePredictiveAdaptivePipelineRegression],
    ["adaptive-telemetry-recorder", runInfinityScaleAdaptiveTelemetryRecorderRegression],
  ];

  const results: InfinityScaleRegressionResult[] = [];
  for (const [name, test] of tests) {
    try {
      test();
      results.push({ name, passed: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Infinity Scale regression failed [${name}]: ${message}`);
    }
  }
  return results;
}
