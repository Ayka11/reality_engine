import {
  runInfinityScaleMixedLODCPURegression,
  runInfinityScaleMixedLODCPUProlongationRegression,
  runInfinityScaleMixedLODCPURollbackRegression,
  runInfinityScaleLODPartialBoundaryCommitRollbackRegression,
} from "../src/infinity/InfinityScaleMixedLODCPUExecutor.regression";
import { runInfinityScaleLODBoundaryCellMapperRegression } from "../src/infinity/InfinityScaleLODBoundaryCellMapper.regression";
import { runInfinityScaleGlobalLODTransactionRegression } from "../src/infinity/InfinityScaleGlobalLODTransaction.regression";
import { runInfinityScaleChunkExecutionContextBoundaryRegression } from "../src/infinity/InfinityScaleChunkExecutionContext.regression";

runInfinityScaleMixedLODCPURegression();
runInfinityScaleMixedLODCPUProlongationRegression();
runInfinityScaleMixedLODCPURollbackRegression();
runInfinityScaleLODPartialBoundaryCommitRollbackRegression();
runInfinityScaleLODBoundaryCellMapperRegression();
runInfinityScaleChunkExecutionContextBoundaryRegression();
runInfinityScaleGlobalLODTransactionRegression();

console.log("PASS: Infinity Scale mixed-LOD CPU, rollback, boundary mapper, chunk context, and LOD transaction regressions");
