import {
  runInfinityScaleMixedLODCPURegression,
  runInfinityScaleMixedLODCPUProlongationRegression,
  runInfinityScaleMixedLODCPURollbackRegression,
  runInfinityScaleLODPartialBoundaryCommitRollbackRegression,
} from "../src/infinity/InfinityScaleMixedLODCPUExecutor.regression";
import { runInfinityScaleLODBoundaryCellMapperRegression } from "../src/infinity/InfinityScaleLODBoundaryCellMapper.regression";

runInfinityScaleMixedLODCPURegression();
runInfinityScaleMixedLODCPUProlongationRegression();
runInfinityScaleMixedLODCPURollbackRegression();
runInfinityScaleLODPartialBoundaryCommitRollbackRegression();
runInfinityScaleLODBoundaryCellMapperRegression();

console.log("PASS: Infinity Scale mixed-LOD CPU, rollback, and boundary mapper regressions");
