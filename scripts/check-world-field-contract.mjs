import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
async function load(path, replacements = []) {
  let source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const gridMod = await load("src/core/ChunkGrid.ts");
const { ChunkGrid, CHUNK_FLOATS } = gridMod;
const restoreGrid = new ChunkGrid();
const validChunk = new Float32Array(CHUNK_FLOATS).fill(0.25);
assert.equal(restoreGrid.restoreChunk(0, validChunk), true);
assert.equal(restoreGrid.chunks.get(0)?.[0], 0.25);
assert.equal(restoreGrid.dirtyChunks.has(0), true);
assert.equal(restoreGrid.restoreChunk(-1, validChunk), false);
assert.equal(restoreGrid.restoreChunk(2048, validChunk), false);
assert.equal(restoreGrid.restoreChunk(1, [1, 2]), false);
const invalidChunk = new Float32Array(CHUNK_FLOATS).fill(0.5);
invalidChunk[12] = Number.NaN;
assert.equal(restoreGrid.restoreChunk(1, invalidChunk), false);
assert.equal(restoreGrid.chunks.has(1), false);
const workerSource = await readFile(new URL("src/core/ChunkSimWorker.ts", root), "utf8");
assert.ok(workerSource.includes("cmd === 'restoreBegin'"), "worker restore begin command missing");
assert.ok(workerSource.includes("cmd === 'restoreChunkAck'") === false, "worker must emit ACKs, not consume its own ACK command");
assert.ok(workerSource.includes("cmd: 'restoreChunkAck'"), "worker restore ACK emission missing");
assert.ok(workerSource.includes("Roll back every chunk already replaced"), "partial restore rollback missing");

const view = await load("src/infinity/WorldViewContract.ts");
const { WorldViewContract } = view;
const contract = new WorldViewContract();
contract.setCenter(10, 4, -6);
contract.setVisibleRadius(100);
const world = contract.sliceToWorld(50, 50, 100, 100);
const pixel = contract.worldToSlice(world.x, world.z, 100, 100);
assert.ok(Math.abs(pixel.x - 50) < 1e-9);
assert.ok(Math.abs(pixel.y - 50) < 1e-9);

const gridConstants = await load("src/core/ChunkGrid.ts");
const { F, NF, chunkKey } = gridConstants;
const workerProviderMod = await load("src/infinity/WorkerWorldFieldChunkProvider.ts", [[
  /import \{ F, CHUNK_FLOATS, CX, CY, GRID_D, GRID_H, GRID_W, NF \} from '\.\.\/core\/ChunkGrid';?/,
  "const F = { E: 0, D: 1, I: 2, S: 3, T: 4, BIO: 10, MAT: 11 }; const CHUNK_FLOATS = 7680; const CX = 8; const CY = 8; const GRID_D = 64; const GRID_H = 128; const GRID_W = 128; const NF = 15;"
]]);
const { WorkerWorldFieldChunkProvider } = workerProviderMod;
const defaultView = {
  version: 1, center: { x: 0, y: 0, z: 0 }, visibleRadius: 128,
  sliceY: 0, simulationTime: 0, seed: "reality-engine-infinity-v1", renderMode: "3d",
};
const workerKey = chunkKey(8, 8, 3); // world (0,0,0) maps to worker x=64, z=29, y=64
const workerChunk = new Float32Array(CHUNK_FLOATS);
workerChunk[(5 * 64 + 0 * 8 + 0) * NF + F.E] = 123;
const workerProvider = new WorkerWorldFieldChunkProvider(
  { cx: 0, cy: 0, cz: 0 }, new Map([[workerKey, workerChunk]]), () => defaultView,
  { sample: () => ({ energy: 0, density: 0, information: 0, entropy: 0, temperature: 0, biology: 0, material: 0 }) }
);
assert.equal(workerProvider.sample(0, 0, 0).energy, 123);
assert.equal(workerProvider.snapshotWorkerChunks().some(chunk => chunk.key === workerKey), true);

const storeMod = await load("src/infinity/WorldFieldChunkStore.ts");
const { WorldFieldChunkStore, worldFieldChunkCoord } = storeMod;
const fakeProvider = { sample: () => ({ energy: 1, density: .2, information: 3, entropy: .1, temperature: 4, biology: .5, material: 2 }) };
const store = new WorldFieldChunkStore(2);
store.set({cx:0,cy:0,cz:0}, "s", fakeProvider);
store.set({cx:1,cy:0,cz:0}, "s", fakeProvider);
store.get({cx:0,cy:0,cz:0});
store.set({cx:2,cy:0,cz:0}, "s", fakeProvider);
assert.equal(store.stats().loaded, 2);
assert.equal(worldFieldChunkCoord(-1, 0, 32).cx, -1);
assert.equal(WorldFieldChunkStore.coord("1000,0,0")?.cx, 1000);
assert.equal(WorldFieldChunkStore.coord("1e3,0,0"), null, "chunk keys must use canonical integer notation");
assert.equal(WorldFieldChunkStore.coord("9007199254740992,0,0"), null, "unsafe chunk coordinates must be rejected");
assert.throws(() => WorldFieldChunkStore.key({cx:Number.MAX_SAFE_INTEGER + 1,cy:0,cz:0}), RangeError);
assert.throws(() => worldFieldChunkCoord(Infinity, 0, 0), RangeError);
assert.throws(() => worldFieldChunkCoord(Number.MAX_VALUE, 0, 0), RangeError);
assert.equal(new WorldFieldChunkStore(Number.NaN).stats().capacity, 128, "NaN capacity must use a safe default");
assert.equal(new WorldFieldChunkStore(Infinity).stats().capacity, 128, "infinite capacity must use a safe default");
assert.equal(new WorldFieldChunkStore(1000000).stats().capacity, 4096, "chunk capacity must have a hard upper bound");
const boundedStore = new WorldFieldChunkStore(Number.NaN);
for (let i = 0; i < 140; i++) boundedStore.set({cx:i,cy:0,cz:0}, "s", fakeProvider);
assert.equal(boundedStore.stats().loaded, 128, "invalid capacity must not disable eviction");


const boundaryMod = await load("src/infinity/WorldFieldBoundaryExchange.ts");
const { WorldFieldBoundaryExchange } = boundaryMod;
const exchange = new WorldFieldBoundaryExchange();
const face = exchange.snapshotFace(fakeProvider, {cx:0,cy:0,cz:0}, "x", 1, 2);
exchange.publish({cx:1,cy:0,cz:0}, "x", -1, face.samples);
assert.equal(exchange.validatePair({cx:0,cy:0,cz:0}, "x").paired, true);
assert.equal(exchange.validatePair({cx:0,cy:0,cz:0}, "x").maxDelta, 0);
const emptyExchange = new WorldFieldBoundaryExchange();
emptyExchange.publish({cx:0,cy:0,cz:0}, "x", 1, []);
emptyExchange.publish({cx:1,cy:0,cz:0}, "x", -1, []);
assert.equal(emptyExchange.validatePair({cx:0,cy:0,cz:0}, "x").paired, false, "empty seams must not validate");
assert.equal(emptyExchange.validatePair({cx:0,cy:0,cz:0}, "x").maxDelta, Infinity, "empty seams must report invalid delta");
const unevenExchange = new WorldFieldBoundaryExchange();
unevenExchange.publish({cx:0,cy:0,cz:0}, "x", 1, [fakeProvider.sample()]);
unevenExchange.publish({cx:1,cy:0,cz:0}, "x", -1, [fakeProvider.sample(), fakeProvider.sample()]);
assert.equal(unevenExchange.validatePair({cx:0,cy:0,cz:0}, "x").paired, false, "unequal seam samples must not validate");
const invalidExchange = new WorldFieldBoundaryExchange();
invalidExchange.publish({cx:0,cy:0,cz:0}, "x", 1, [{...fakeProvider.sample(), energy: NaN}]);
invalidExchange.publish({cx:1,cy:0,cz:0}, "x", -1, [fakeProvider.sample()]);
assert.equal(invalidExchange.validatePair({cx:0,cy:0,cz:0}, "x").paired, false, "non-finite seam values must not validate");

assert.equal(exchange.snapshotFace(fakeProvider, {cx:0,cy:0,cz:0}, "y", 1, Infinity).samples.length, 64, "infinite resolution must use a bounded fallback");
assert.equal(exchange.snapshotFace(fakeProvider, {cx:0,cy:0,cz:0}, "y", 1, NaN).samples.length, 64, "NaN resolution must use a bounded fallback");
assert.equal(exchange.snapshotFace(fakeProvider, {cx:0,cy:0,cz:0}, "y", 1, 1000000).samples.length, 4096, "large resolution must be capped at 64 per edge");


const spatialJs = await readFile(new URL("src/infinity/ScientificFieldSpatialPattern.ts", root), "utf8");
const spatialCompiled = ts.transpileModule(spatialJs, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const spatialUrl = `data:text/javascript;base64,${Buffer.from(spatialCompiled).toString("base64")}`;
const profileJs = await readFile(new URL("src/infinity/ScientificFieldProfile.ts", root), "utf8");
const profileCompiled = ts.transpileModule(profileJs, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const profileUrl = `data:text/javascript;base64,${Buffer.from(profileCompiled).toString("base64")}`;

const fieldSamplerSource = await readFile(new URL("src/infinity/FieldSampler.ts", root), "utf8");
assert.ok(fieldSamplerSource.includes("const activeProvider = this.registry.getActive()"), "sample must follow the registry active provider");
assert.ok(fieldSamplerSource.includes("No active scientific field provider"), "sample must fail closed when the registry has no active provider");
assert.ok(fieldSamplerSource.includes("return activeProvider.sample(x, y, z)"), "sample must use the active registry provider");

assert.match(fieldSamplerSource, /setGenerator\(generator: WorldGenerator\)[\s\S]*?this\.registry\.register\(provider, true\)/,
  "setGenerator must update the active provider registry as well as direct sampling");

const mutableMod = await load("src/infinity/MutableWorldFieldProvider.ts", [
  [/from ['"]\.\/ScientificFieldSpatialPattern['"]/, `from "${spatialUrl}"`],
  [/from ['"]\.\/ScientificFieldProfile['"]/, `from "${profileUrl}"`],
]);
const { MutableWorldFieldProvider } = mutableMod;
const mutable = new MutableWorldFieldProvider(fakeProvider);
const before = mutable.sample(0,0,0).energy;
mutable.applyRadial("brush", 0,0,0,10,{ energy: 9 });
assert.ok(mutable.sample(0,0,0).energy > before);
assert.ok(mutable.getVersion() > 0);

globalThis.localStorage = { data:new Map(), setItem(k,v){this.data.set(k,v)}, getItem(k){return this.data.get(k)??null}, removeItem(k){this.data.delete(k)} };
const worldCoordinateJs = await readFile(new URL("src/infinity/WorldCoordinate.ts", root), "utf8");
const worldCoordinateCompiled = ts.transpileModule(worldCoordinateJs, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const worldCoordinateUrl = `data:text/javascript;base64,${Buffer.from(worldCoordinateCompiled).toString("base64")}`;
const worldPersistenceMod = await load("src/infinity/WorldPersistence.ts", [
  [/from ['"]\.\/WorldCoordinate['"]/, `from "${worldCoordinateUrl}"`],
]);
const { WorldPersistence } = worldPersistenceMod;
const worldPersistence = new WorldPersistence("seed");
worldPersistence.saveFieldState({schemaVersion:"world-field-state-v2",mutationCount:1});
assert.deepEqual(worldPersistence.loadFieldState(), {schemaVersion:"world-field-state-v2",mutationCount:1});
worldPersistence.deleteFieldState();
assert.equal(worldPersistence.loadFieldState(), null);
const persistenceSource = await readFile(new URL("src/infinity/WorldFieldChunkPersistence.ts", root), "utf8");
assert.match(persistenceSource, /private readonly durabilityFailures = new Map<string, string>\(\)/,
  "durability failures must be tracked per persisted chunk");
assert.match(persistenceSource, /private globalDurabilityError: string \| null = null/,
  "clear/open failures must remain global until a successful durable clear");
assert.match(persistenceSource, /if \(key === null\) \{\s*this\.durabilityFailures\.clear\(\)\s*this\.globalDurabilityError = null/s,
  "only a successful clear may reset global durability failures");
assert.match(persistenceSource, /this\.enqueueWrite\(snapshot\.key, store => store\.put\(cloneSnapshot\(isolated\)\)\)/,
  "every snapshot save must associate its durability failure with the snapshot key");
assert.match(persistenceSource, /this\.durabilityFailures\.delete\(key\)/,
  "a successful write may clear only the failure for its own key");
assert.match(persistenceSource, /this\.globalDurabilityError\s*\?\?\s*this\.durabilityFailures\.values\(\)\.next\(\)\.value/,
  "flush status must preserve failures from unrelated pending durable state");


assert.match(persistenceSource, /if \(db === null && this\.databasePromise === cachedPromise\) this\.databasePromise = null/,
  "failed IndexedDB opens must clear their cached promise so later calls can retry");
assert.match(persistenceSource, /if \(settled\) \{\s*db\.close\(\)\s*return\s*\}/,
  "late success after an already-settled blocked request must close its unused connection");
assert.match(persistenceSource, /request\.onblocked = \(\) => \{\s*if \(settled\) return/,
  "IndexedDB callbacks must not settle an open request more than once");

const persistenceMod = await load("src/infinity/WorldFieldChunkPersistence.ts", [
  [/import \{ CHUNK_FLOATS \} from [^;]+;/, "const CHUNK_FLOATS = 7168;"],
]);
const { WorldFieldChunkPersistence } = persistenceMod;
const persistence = new WorldFieldChunkPersistence();
const workerData = [{ key: 0, data: Array(7168).fill(1) }];
const saved = persistence.saveWorkerChunks(
  {cx:0,cy:0,cz:0},
  "seed",
  workerData,
  { center: {x:0,y:0,z:0}, sliceY:0, seed:"seed" },
);
assert.equal(persistence.validate(saved), true);
saved.values[0] = 999;
saved.workerChunks[0].data[0] = 999;
assert.equal(persistence.loadValid({cx:0,cy:0,cz:0})?.values[0], 0,
  "mutating a returned worker snapshot must not mutate the cache");
assert.equal(persistence.loadValid({cx:0,cy:0,cz:0})?.workerChunks?.[0]?.data[0], 1,
  "nested worker data must be isolated from callers");
const loaded = persistence.load({cx:0,cy:0,cz:0});
loaded.values[0] = 888;
assert.equal(persistence.loadValid({cx:0,cy:0,cz:0})?.values[0], 0,
  "mutating a loaded snapshot must not mutate the cache");
const legacy = persistence.save({cx:1,cy:0,cz:0}, "seed", [3, 4]);
legacy.values[0] = 100;
assert.deepEqual(persistence.load({cx:1,cy:0,cz:0})?.values, [3, 4],
  "mutating a returned legacy snapshot must not mutate the cache");
assert.throws(() => persistence.save({cx:Number.MAX_SAFE_INTEGER + 1,cy:0,cz:0}, "seed", [1]), RangeError);
assert.equal(persistence.validate({ ...saved, coord: {cx:Number.MAX_SAFE_INTEGER + 1,cy:0,cz:0}, key:"9007199254740992,0,0" }), false,
  "snapshots with unsafe coordinates must be rejected");
assert.equal(persistence.loadValid({cx:0,cy:0,cz:0})?.workerChunks?.[0]?.data.length, 7168);
const tampered = { ...saved, values: [...saved.values, 99] };
assert.equal(persistence.validate(tampered), false);
const cachedWorkerSnapshot = persistence.load({cx:0,cy:0,cz:0});
const inconsistent = { ...cachedWorkerSnapshot, values: [...cachedWorkerSnapshot.values] };
inconsistent.values[1] = 123456;
assert.equal(persistence.validate(inconsistent), false,
  "v2 snapshots must reject values that differ from canonical worker chunk data");
const orderedCoord = {cx:2,cy:0,cz:0};
persistence.save(orderedCoord, "first", [1, 2]);
assert.equal(persistence.remove(orderedCoord), true);
persistence.save(orderedCoord, "second", [7, 8]);
assert.deepEqual(persistence.loadValid(orderedCoord)?.values, [7, 8],
  "save-remove-save must leave the last snapshot in cache");
persistence.save({cx:3,cy:0,cz:0}, "clear-target", [9]);
persistence.clear();
assert.equal(persistence.size(), 0, "clear must synchronously empty the in-memory cache");

const provenanceMod = await load("src/infinity/RuntimeProvenance.ts");
const { RuntimeProvenance } = provenanceMod;
const provenance = new RuntimeProvenance();
const preset = provenance.record("preset", {name:"wave"});
provenance.record("law", {name:"density-gravity"}, preset.id);
provenance.record("brush", {name:"Volcano"});
provenance.record("world-state", {version:1});
assert.equal(provenance.validate().valid, true);
assert.equal(provenance.getTrace().events.length, 4);

console.log("PASS: world/slice coordinate round-trip");
console.log("PASS: canonical world chunk addressing and eviction");
console.log("PASS: adjacent boundary exchange");
console.log("PASS: authoritative mutable field overlay");
console.log("PASS: world-field persistence round-trip and checksum validation");
console.log("PASS: runtime provenance chain");
