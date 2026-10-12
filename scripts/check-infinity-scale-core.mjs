import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
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
  'const chunkKeyString = (k) => `${k.level}:${k.x},${k.y},${k.z}`;'
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
