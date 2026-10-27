import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const terrainLod = await load("src/infinity/LODManager.ts");
assert.deepEqual(
  [0, 1, 2, 3].map(level => terrainLod.lodResolution(level)),
  [32, 16, 8, 4],
  "terrain mesh resolution must decrease with distance: finest near the observer, coarsest far away",
);
assert.deepEqual(
  [0, 2, 4, 8, 20].map(distance => terrainLod.lodForDistance(distance)),
  [0, 0, 1, 2, 3],
  "LOD selection must assign the finest level to nearby chunks",
);
async function load(path, replacements = []) {
  const source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const core = await load("src/InfinityScaleV2.ts");
const { InfinityScaleV2, cellToChunk, chunkCenter, chunkKeyString } = core;
assert.deepEqual(cellToChunk(-1, 32), [-1, 31]);
assert.deepEqual(cellToChunk(-32, 32), [-1, 0]);
assert.deepEqual(cellToChunk(32, 32), [1, 0]);
assert.deepEqual(chunkCenter({ x: -1, y: 2, z: 0, level: 1 }, 32), { x: -32, y: 160, z: 32 });
assert.equal(chunkKeyString({ x: -1, y: 2, z: 0, level: 1 }), "1:-1,2,0");

const scale = new InfinityScaleV2();
scale.setObserver({ x: 0, y: 0, z: 0 });
const telemetry = scale.telemetry();
assert.equal(telemetry.simulatingChunks, 75);
assert.equal(telemetry.residentChunks, 512, "visible candidates must respect the resident budget");
assert.equal(
  telemetry.visibleChunks + telemetry.backgroundChunks + telemetry.simulatingChunks + telemetry.cachedChunks,
  telemetry.residentChunks,
  "residency state counts must be disjoint and sum to the resident count",
);
assert.equal(scale.state({ x: 0, y: 0, z: 0, level: 0 }), "simulating");

const simulationLimited = new InfinityScaleV2({ maxSimulatingChunks: 16 });
simulationLimited.setObserver({ x: 0, y: 0, z: 0 });
assert.equal(simulationLimited.telemetry().simulatingChunks, 16,
  "the active simulation envelope must respect maxSimulatingChunks");
assert.throws(() => new InfinityScaleV2({ maxSimulatingChunks: -1 }), RangeError);
assert.throws(() => new InfinityScaleV2({ maxResidentChunks: 0 }), RangeError);
assert.equal(scale.selectLOD(0), 0);
assert.equal(scale.selectLOD(2), 1);
assert.equal(scale.selectLOD(3), 2);
assert.equal(scale.selectLOD(5), 3);
assert.equal(scale.selectAMRFromGradient(0.05), 0);
assert.equal(scale.selectAMRFromGradient(0.2), 1);
assert.equal(scale.selectAMRFromGradient(1.1), 2);
assert.equal(scale.selectAMR(0.02, 0.3), 1);

const pinned = { x: 100, y: 0, z: 0, level: 0 };
scale.pin(pinned);
scale.setObserver({ x: 0, y: 0, z: 0 });
assert.equal(scale.state(pinned), "cached", "pinned chunks must survive residency replanning");
assert.ok(scale.telemetry().residentChunks <= scale.config.maxResidentChunks);
scale.unpin(pinned);
scale.setObserver({ x: 0, y: 0, z: 0 });
assert.throws(() => scale.setObserver({ x: 0.5, y: 0, z: 0 }), RangeError);

const constrained = new InfinityScaleV2({ maxResidentChunks: 128 });
constrained.setObserver({ x: 0, y: 0, z: 0 });
assert.equal(constrained.telemetry().simulatingChunks, 75);
assert.equal(constrained.telemetry().residentChunks, 405,
  "when the cap is below the mandatory background envelope, active/background chunks must be preserved");

const managerMod = await load("src/ChunkResidencyManager.ts", [[
  /import \{[^}]+\} from "\.\/InfinityScaleV2";?/,
  'const chunkKeyString = (k) => `${k.level}:${k.x},${k.y},${k.z}`; const cellToChunk = (g, size = 32) => [Math.floor(g / size), ((g % size) + size) % size];'
]]);
const { ChunkResidencyManager } = managerMod;
const manager = new ChunkResidencyManager(scale);
const records = manager.plan({ x: 0, y: 0, z: 0 }, [
  { x: 0, y: 0, z: 0, level: 0 },
  { x: 1000, y: 0, z: 0, level: 0 },
]);
assert.equal(records[0].state, "simulating");
assert.equal(records[0].lod, 0);
assert.equal(records[1].state, "unloaded");
assert.equal(manager.updateAMR(records, 1.2, 0).every(record => record.amr === 2), true);

const originalChunk = { x: 5, y: 0, z: 0, level: 0 };
const detachedManagerRecord = manager.plan({ x: 160, y: 0, z: 0 }, [originalChunk])[0];
originalChunk.x = 99;
assert.equal(detachedManagerRecord.chunk.x, 5,
  "residency manager must not retain a caller-owned mutable ChunkKey");
detachedManagerRecord.chunk.x = 123;
assert.equal(originalChunk.x, 99,
  "residency manager must return a detached ChunkKey");

// Runtime observer updates are atomic and must not silently truncate invalid
// coordinates before the authoritative InfinityScaleV2 validates them.
globalThis.__infinityScaleCoreForTest = core;
globalThis.__infinityScaleManagerForTest = managerMod;
const runtimeMod = await load("src/infinity/InfinityScaleRuntime.ts", [
  [
    /import \{\s*InfinityScaleV2,[\s\S]*?\} from "\.\.\/InfinityScaleV2";?/,
    "const { InfinityScaleV2, DEFAULT_INFINITY_SCALE_V2 } = globalThis.__infinityScaleCoreForTest;",
  ],
  [
    /import \{\s*ChunkResidencyManager,[\s\S]*?\} from "\.\.\/ChunkResidencyManager";?/,
    "const { ChunkResidencyManager } = globalThis.__infinityScaleManagerForTest;",
  ],
  [
    /import \{\s*MemoryChunkStore,[\s\S]*?\} from "\.\.\/ChunkStore";?/,
    "class MemoryChunkStore {}",
  ],
  [
    /import type \{\s*ScaleTelemetry\s*\} from "\.\.\/ScaleTelemetry";?/,
    "",
  ],
]);
const { InfinityScaleRuntime } = runtimeMod;
const runtime = new InfinityScaleRuntime({});
runtime.setObserver({ x: 3200, y: -64, z: 0 });
assert.deepEqual(runtime.getObserver(), { x: 3200, y: -64, z: 0 });
assert.deepEqual(runtime.scale.getObserver(), { x: 3200, y: -64, z: 0 });

// The returned array, each record, its nested ChunkKey, and the original input
// must all be detached from the runtime's internal residency snapshot.
const runtimeInputChunk = { x: 100, y: -2, z: 0, level: 0 };
const exposedRecords = runtime.plan([runtimeInputChunk]);
const storedBeforeMutation = runtime.residencyRecords()[0];
runtimeInputChunk.x = 777;
exposedRecords[0].lod = 99;
exposedRecords[0].distance = 999;
exposedRecords[0].chunk.x = 888;
const exposedAgain = runtime.residencyRecords()[0];
assert.equal(exposedAgain.lod, storedBeforeMutation.lod,
  "mutating a public residency record must not change internal LOD");
assert.equal(exposedAgain.distance, storedBeforeMutation.distance,
  "mutating a public residency record must not change internal distance");
assert.equal(exposedAgain.chunk.x, 100,
  "mutating returned/input ChunkKeys must not change internal chunk identity");
const lastGoodObserver = runtime.getObserver();
const lastGoodPlannerObserver = runtime.scale.getObserver();
assert.throws(() => runtime.setObserver({ x: 0.5, y: 0, z: 0 }), RangeError);
assert.deepEqual(runtime.getObserver(), lastGoodObserver,
  "failed runtime observer update must not publish a truncated coordinate");
assert.deepEqual(runtime.scale.getObserver(), lastGoodPlannerObserver,
  "failed runtime observer update must not mutate the authoritative planner");
delete globalThis.__infinityScaleCoreForTest;
delete globalThis.__infinityScaleManagerForTest;

// ChunkResidencyManager receives observer coordinates in cells and must
// derive LOD distance in chunk units. The old implementation compared 3200
// cells directly with chunk index 100 and incorrectly selected LOD 3 nearby.
const translatedObserverRecords = manager.plan({ x: 3200, y: -64, z: 0 }, [
  { x: 99, y: -2, z: 0, level: 0 },
  { x: 100, y: -2, z: 0, level: 0 },
  { x: 101, y: -2, z: 0, level: 0 },
  { x: 102, y: -2, z: 0, level: 0 },
]);
assert.deepEqual(
  translatedObserverRecords.map(record => record.lod),
  [0, 0, 0, 1],
  "LOD selection must remain local after translating observer coordinates",
);
assert.deepEqual(
  translatedObserverRecords.map(record => record.distance),
  [1, 0, 1, 2],
  "distance must be measured from the observer chunk to the chunk footprint",
);
const negativeObserverRecords = manager.plan({ x: -1, y: 0, z: 0 }, [
  { x: -1, y: 0, z: 0, level: 0 },
  { x: 0, y: 0, z: 0, level: 0 },
]);
assert.deepEqual(
  negativeObserverRecords.map(record => record.distance),
  [0, 1],
  "negative observer coordinates must use floor-based chunk coordinates",
);

const storeMod = await load("src/ChunkStore.ts");
const { MemoryChunkStore } = storeMod;
const store = new MemoryChunkStore();
const payload = { key: "0:0,0,0", level: 0, cx: 0, cy: 0, cz: 0, data: new ArrayBuffer(8), updatedAt: 1 };
await store.save(payload);
assert.equal(await store.has(payload.key), true);
assert.equal((await store.load(payload.key)).data.byteLength, 8);
await store.remove(payload.key);
assert.equal(await store.has(payload.key), false);

const telemetrySource = await readFile(new URL("src/ScaleTelemetry.ts", root), "utf8");
assert.ok(telemetrySource.includes("residentChunks"), "scale telemetry must expose residency counts");
console.log("Infinity Scale core planner, residency budget, manager, and store: PASS");
