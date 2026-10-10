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
const grid = new ChunkGrid();
const validChunk = Array(CHUNK_FLOATS).fill(0.25);
assert.equal(grid.restoreChunk(0, validChunk), true);
assert.equal(grid.chunks.get(0)?.[0], 0.25);
assert.equal(grid.dirtyChunks.has(0), true);
assert.equal(grid.restoreChunk(-1, validChunk), false);
assert.equal(grid.restoreChunk(2047, validChunk), true);
assert.equal(grid.restoreChunk(2048, validChunk), false);
assert.equal(grid.restoreChunk(1, [1, 2]), false);
const invalidChunk = Array(CHUNK_FLOATS).fill(0.5);
invalidChunk[12] = Number.NaN;
assert.equal(grid.restoreChunk(1, invalidChunk), false);
assert.equal(grid.chunks.has(1), false);

const view = await load("src/infinity/WorldViewContract.ts");
const { WorldViewContract } = view;
const contract = new WorldViewContract();
contract.setCenter(10, 4, -6);
contract.setVisibleRadius(100);
const world = contract.sliceToWorld(50, 50, 100, 100);
const pixel = contract.worldToSlice(world.x, world.z, 100, 100);
assert.ok(Math.abs(pixel.x - 50) < 1e-9);
assert.ok(Math.abs(pixel.y - 50) < 1e-9);

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

const boundaryMod = await load("src/infinity/WorldFieldBoundaryExchange.ts");
const { WorldFieldBoundaryExchange } = boundaryMod;
const exchange = new WorldFieldBoundaryExchange();
const face = exchange.snapshotFace(fakeProvider, {cx:0,cy:0,cz:0}, "x", 1, 2);
exchange.publish({cx:1,cy:0,cz:0}, "x", -1, face.samples);
assert.equal(exchange.validatePair({cx:0,cy:0,cz:0}, "x").paired, true);
assert.equal(exchange.validatePair({cx:0,cy:0,cz:0}, "x").maxDelta, 0);

const spatialJs = await readFile(new URL("src/infinity/ScientificFieldSpatialPattern.ts", root), "utf8");
const spatialCompiled = ts.transpileModule(spatialJs, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const spatialUrl = `data:text/javascript;base64,${Buffer.from(spatialCompiled).toString("base64")}`;
const profileJs = await readFile(new URL("src/infinity/ScientificFieldProfile.ts", root), "utf8");
const profileCompiled = ts.transpileModule(profileJs, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const profileUrl = `data:text/javascript;base64,${Buffer.from(profileCompiled).toString("base64")}`;

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
assert.equal(persistence.loadValid({cx:0,cy:0,cz:0})?.workerChunks?.[0]?.data.length, 7168);
const tampered = { ...saved, values: [...saved.values, 99] };
assert.equal(persistence.validate(tampered), false);

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
