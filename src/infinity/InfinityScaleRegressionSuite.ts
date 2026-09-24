import { runInfinityScaleLODBoundaryCellMapperRegression } from "./InfinityScaleLODBoundaryCellMapper.regression";
import { runInfinityScaleLODBoundaryRegression } from "./InfinityScaleLODBoundarySnapshot.regression";
import { runInfinityScaleMixedLODCPUExecutorRegression } from "./InfinityScaleMixedLODCPUExecutor.regression";
import { runInfinityScaleUnifiedTransactionRegression } from "./InfinityScaleUnifiedTransaction.regression";

export interface InfinityScaleRegressionResult {
  name: string;
  passed: boolean;
}

export function runInfinityScaleRegressionSuite(): InfinityScaleRegressionResult[] {
  const tests: Array<[string, () => void]> = [
    ["canonical-boundary-mapper", runInfinityScaleLODBoundaryCellMapperRegression],
    ["lod-boundary-transfer", runInfinityScaleLODBoundaryRegression],
    ["mixed-lod-cpu-executor", runInfinityScaleMixedLODCPUExecutorRegression],
    ["unified-transaction", runInfinityScaleUnifiedTransactionRegression],
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
