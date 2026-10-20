import {
  runInfinityScaleMixedLODCPURegression,
  runInfinityScaleMixedLODCPUProlongationRegression,
  runInfinityScaleMixedLODCPURollbackRegression,
  runInfinityScaleLODPartialBoundaryCommitRollbackRegression,
} from "../src/infinity/InfinityScaleMixedLODCPUExecutor.regression";

runInfinityScaleMixedLODCPURegression();
runInfinityScaleMixedLODCPUProlongationRegression();
runInfinityScaleMixedLODCPURollbackRegression();
runInfinityScaleLODPartialBoundaryCommitRollbackRegression();

console.log("PASS: Infinity Scale mixed-LOD CPU and rollback regressions");
