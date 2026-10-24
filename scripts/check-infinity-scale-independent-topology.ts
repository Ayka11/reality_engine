import assert from "node:assert/strict";
import { validateIndependentMixedLodTopology } from "../src/infinity/InfinityScaleIndependentTopology.ts";
import type { InfinityScaleFramePlan } from "../src/infinity/InfinityScaleFramePlan.ts";
import type { InfinityScaleBoundaryReadRelation } from "../src/infinity/InfinityScaleChunkExecutionContext.ts";

type FrameChunk = InfinityScaleFramePlan["chunks"][number];
const chunk = (key: string, level: number, x: number, y: number, z: number): FrameChunk =>
  ({ key, chunk: { level, x, y, z } } as unknown as FrameChunk);

const fine = chunk("0:1,0,0", 0, 1, 0, 0);
const coarse = chunk("1:1,0,0", 1, 1, 0, 0);
const selected = [fine];
const candidates = [fine, coarse];
const requiredRelation: InfinityScaleBoundaryReadRelation = {
  sourceChunk: fine.key,
  targetChunk: coarse.key,
  relation: "fine-to-coarse",
};

const complete = validateIndependentMixedLodTopology(selected, candidates, [requiredRelation]);
assert.equal(complete.complete, true, "observed relation matching independent frame geometry must pass");

const missing = validateIndependentMixedLodTopology(selected, candidates, []);
assert.equal(missing.complete, false, "missing relation must fail even when the source chunk remains present");
assert.deepEqual(missing.missing, ["0:1,0,0|1:1,0,0|fine-to-coarse"]);

const unexpected = validateIndependentMixedLodTopology(selected, candidates, [{
  ...requiredRelation,
  targetChunk: "1:9,9,9",
}]);
assert.equal(unexpected.complete, false, "unexpected relation must fail closed");
assert.equal(unexpected.unexpected.length, 1);

console.log("Independent mixed-LOD topology inventory: PASS");
