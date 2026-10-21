import assert from "node:assert/strict";
import { InfinityScaleExecutionAdapter } from "../src/infinity/InfinityScaleExecutionAdapter.ts";
import type { InfinityScaleFramePlan, InfinityScaleChunkPlan } from "../src/infinity/InfinityScaleFramePlan.ts";

function chunk(level: number, x: number, y: number, z: number, simulationEligible = false): InfinityScaleChunkPlan {
  const key = `${level}:${x},${y},${z}`;
  return {
    key,
    chunk: { level, x, y, z },
    state: simulationEligible ? "simulating" : "cached",
    lod: level,
    amr: 0,
    pinned: false,
    distance: simulationEligible ? 0 : 1,
    simulationEligible,
    renderEligible: true,
  };
}

function relations(children: Array<[number, number]>): string[] {
  const coarse = chunk(1, 0, 0, 0, true);
  const fine = children.map(([y, z]) => chunk(0, 2, y, z));
  const frame: InfinityScaleFramePlan = {
    observer: { x: 0, y: 0, z: 0 },
    chunks: [coarse, ...fine],
    simulating: [coarse.key],
    visible: [coarse.key, ...fine.map(c => c.key)],
    background: [],
    cached: fine.map(c => c.key),
    unloaded: [],
    residentCount: 1 + fine.length,
    simulationCount: 1,
    visibleCount: 1 + fine.length,
    maxSimulatingChunks: 1,
    maxResidentChunks: 16,
    revision: 17,
    generatedAt: 0,
  };
  return new InfinityScaleExecutionAdapter().update(frame).boundaryReadRelations
    .map(relation => relation.targetChunk);
}

const partial = relations([[0, 0]]);
assert(partial.includes("1:1,0,0"),
  "partial fine coverage must retain the same-level fallback for uncovered face regions");
assert(partial.includes("0:2,0,0"),
  "partial fine coverage must retain the actual fine neighbor dependency");

const complete = relations([[0, 0], [0, 1], [1, 0], [1, 1]]);
assert(!complete.includes("1:1,0,0"),
  "a face fully covered by multiple fine chunks must not retain a redundant same-level fallback");
for (const key of ["0:2,0,0", "0:2,0,1", "0:2,1,0", "0:2,1,1"]) {
  assert(complete.includes(key), `full face coverage must preserve dependency ${key}`);
}

const missingChild = relations([[0, 0], [0, 1], [1, 0]]);
assert(missingChild.includes("1:1,0,0"),
  "a missing fine child that leaves a face gap must retain the fallback dependency");

console.log("Infinity Scale mixed-LOD face coverage: PASS");
