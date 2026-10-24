import {
  runInfinityScaleMixedLODCPURegression,
  runInfinityScaleMixedLODCPUProlongationRegression,
  runInfinityScaleMixedLODCPURollbackRegression,
  runInfinityScaleLODPartialBoundaryCommitRollbackRegression,
} from "../src/infinity/InfinityScaleMixedLODCPUExecutor.regression";
import { runInfinityScaleLODBoundaryCellMapperRegression } from "../src/infinity/InfinityScaleLODBoundaryCellMapper.regression";
import { runInfinityScaleGlobalLODTransactionRegression } from "../src/infinity/InfinityScaleGlobalLODTransaction.regression";
import { runInfinityScaleChunkExecutionContextBoundaryRegression } from "../src/infinity/InfinityScaleChunkExecutionContext.regression";
import { runInfinityScaleLODStateRecoveryRegression } from "../src/infinity/InfinityScaleLODStateRecovery.regression";
import { runInfinityScaleExecutionAdapterBoundaryRegression } from "../src/infinity/InfinityScaleExecutionAdapter.regression";
import { runInfinityScaleLODTransferInvariantRegression } from "../src/infinity/InfinityScaleLODTransfer.regression";

runInfinityScaleMixedLODCPURegression();
runInfinityScaleMixedLODCPUProlongationRegression();
runInfinityScaleMixedLODCPURollbackRegression();
runInfinityScaleLODPartialBoundaryCommitRollbackRegression();
runInfinityScaleLODBoundaryCellMapperRegression();
runInfinityScaleChunkExecutionContextBoundaryRegression();
runInfinityScaleGlobalLODTransactionRegression();
runInfinityScaleExecutionAdapterBoundaryRegression();
runInfinityScaleLODTransferInvariantRegression();
runInfinityScaleLODStateRecoveryRegression();

console.log("PASS: Infinity Scale mixed-LOD CPU, rollback, mapper, chunk context, LOD transaction, execution adapter, transfer invariants, and state recovery regressions");
