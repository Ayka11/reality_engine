import assert from "node:assert/strict";
import { EntityChunkReconciliation } from "../src/infinity/EntityChunkReconciliation.ts";
import type { EntityChunkComponent, EntityChunkConnectivityResult } from "../src/infinity/EntityChunkConnectivity.ts";
import type { Entity } from "../src/simulation/EntityLayer.ts";

const component: EntityChunkComponent = {
  id: 4,
  cells: [10],
  centroid: [10, 0, 0],
  touchesSimulationBoundary: true,
  touchesReadBoundary: false,
  touchesMixedLODBoundary: true,
};

const entity = {
  id: 77,
  cells: [999],
  centroid: [100, 100, 100],
} as unknown as Entity;

const incompleteConnectivity: EntityChunkConnectivityResult = {
  components: [component],
  closedComponentCount: 0,
  boundaryComponentCount: 1,
  openReadComponentCount: 0,
  mixedLodComponentCount: 1,
  mixedLodTopology: [],
  mixedLodCoverageComplete: false,
};

const planner = new EntityChunkReconciliation();
const plan = planner.plan([component], [entity], true, incompleteConnectivity);

assert.equal(plan.commitReady, false, "incomplete mixed-LOD coverage must block commit");
assert.deepEqual(plan.ambiguousMixedLodComponents, [4], "boundary component must be marked ambiguous even with zero observed source IDs");
assert.equal(plan.proposals[0]?.safeToCommit, false, "ambiguous component must remain pending");
assert.deepEqual(plan.extinctEntityIds, [], "unresolved topology must never infer entity extinction");

const noSnapshotPlan = planner.plan([component], [entity], true, {
  ...incompleteConnectivity,
  mixedLodCoverageComplete: false,
});
assert.equal(noSnapshotPlan.commitReady, false, "missing boundary evidence must fail closed");
assert.deepEqual(noSnapshotPlan.extinctEntityIds, [], "missing boundary evidence must suppress extinction");

console.log("Entity chunk reconciliation boundary safety: PASS");
