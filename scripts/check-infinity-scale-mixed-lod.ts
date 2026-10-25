import {
  runInfinityScaleMixedLODCPURegression,
  runInfinityScaleMixedLODCPUProlongationRegression,
  runInfinityScaleMixedLODCPURollbackRegression,
  runInfinityScaleLODPartialBoundaryCommitRollbackRegression,
} from "../src/infinity/InfinityScaleMixedLODCPUExecutor.regression";
import { runInfinityScaleLODBoundaryCellMapperRegression } from "../src/infinity/InfinityScaleLODBoundaryCellMapper.regression";
import { runInfinityScaleLODBoundaryRegression } from "../src/infinity/InfinityScaleLODBoundarySnapshot.regression";
import { runInfinityScaleGlobalLODTransactionRegression } from "../src/infinity/InfinityScaleGlobalLODTransaction.regression";
import { runInfinityScaleChunkExecutionContextBoundaryRegression } from "../src/infinity/InfinityScaleChunkExecutionContext.regression";
import { runInfinityScaleLODStateRecoveryRegression } from "../src/infinity/InfinityScaleLODStateRecovery.regression";
import { runInfinityScaleExecutionAdapterBoundaryRegression } from "../src/infinity/InfinityScaleExecutionAdapter.regression";
import { runInfinityScaleLODTransferInvariantRegression } from "../src/infinity/InfinityScaleLODTransfer.regression";
import { runInfinityScaleLODResetInvalidationRegression, runInfinityScaleLODTopologyRevisionRegression } from "../src/infinity/InfinityScaleLODState.regression";
import { runInfinityScaleLODMultiFrameRegression } from "../src/infinity/InfinityScaleLODMultiFrame.regression";
import { runInfinityScaleMixedLODMultiFrameRegression } from "../src/infinity/InfinityScaleMixedLODMultiFrame.regression";

runInfinityScaleMixedLODCPURegression();
runInfinityScaleMixedLODCPUProlongationRegression();
runInfinityScaleMixedLODCPURollbackRegression();
runInfinityScaleLODPartialBoundaryCommitRollbackRegression();
runInfinityScaleLODBoundaryCellMapperRegression();
runInfinityScaleLODBoundaryRegression();
runInfinityScaleChunkExecutionContextBoundaryRegression();
runInfinityScaleGlobalLODTransactionRegression();
runInfinityScaleExecutionAdapterBoundaryRegression();
runInfinityScaleLODTransferInvariantRegression();
runInfinityScaleLODStateRecoveryRegression();
runInfinityScaleLODResetInvalidationRegression();
runInfinityScaleLODTopologyRevisionRegression();
runInfinityScaleLODMultiFrameRegression();
runInfinityScaleMixedLODMultiFrameRegression();

console.log("PASS: Infinity Scale mixed-LOD CPU, rollback, multi-frame commits, reset/topology revision invalidation, mapper, chunk context, LOD transaction, execution adapter, transfer invariants, and state recovery regressions");
