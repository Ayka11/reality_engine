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

export interface InfinityScaleRegressionResult {
  name: string;
  passed: boolean;
}

export function runInfinityScaleRegressionSuite(): InfinityScaleRegressionResult[] {
  const tests: Array<[string, () => void]> = [
    ["canonical-boundary-mapper", runInfinityScaleLODBoundaryCellMapperRegression],
    ["lod-boundary-transfer", runInfinityScaleLODBoundaryRegression],
    ["lod-convergence", runInfinityScaleLODBoundaryRegression],
    ["mixed-lod-cpu-restriction", runInfinityScaleMixedLODCPURegression],
    ["mixed-lod-cpu-prolongation", runInfinityScaleMixedLODCPUProlongationRegression],
    ["unified-transaction", runInfinityScaleUnifiedTransactionRegression],
    ["lod-reset-invalidation", runInfinityScaleLODResetInvalidationRegression],
    ["lod-multi-frame", runInfinityScaleLODMultiFrameRegression],
    ["mixed-lod-multi-frame", runInfinityScaleMixedLODMultiFrameRegression],
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
