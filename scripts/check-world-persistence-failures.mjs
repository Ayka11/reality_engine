import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const saveSystemSource = await readFile(new URL("src/world/save/WorldSaveSystem.ts", root), "utf8");
const saveManagerSource = await readFile(new URL("src/world/save/SaveManager.ts", root), "utf8");
const mainSource = await readFile(new URL("src/main.ts", root), "utf8");
const climateSource = await readFile(new URL("src/simulation/ClimateSystem.ts", root), "utf8");
const multiScaleSource = await readFile(new URL("src/simulation/MultiScaleSystem.ts", root), "utf8");
const languageSource = await readFile(new URL("src/simulation/LanguageEmergence.ts", root), "utf8");
const economicSource = await readFile(new URL("src/simulation/EconomicSystem.ts", root), "utf8");
const metaLawSource = await readFile(new URL("src/simulation/MetaLawEvolution.ts", root), "utf8");
const cosmologicalSource = await readFile(new URL("src/simulation/CosmologicalSim.ts", root), "utf8");
const timelineSource = await readFile(new URL("src/world/Timeline.ts", root), "utf8");
const directorSource = await readFile(new URL("src/ai/SceneDirector.ts", root), "utf8");
const multiplayerSource = await readFile(new URL("src/network/MultiplayerSync.ts", root), "utf8");
const simulationEngineSource = await readFile(new URL("src/simulation/SimulationEngine.ts", root), "utf8");
assert.match(saveSystemSource, /const mutate = this\.context\.mutateAuthoritativeState;/,
  "world snapshot import must use the authoritative simulation transaction");
assert.match(saveSystemSource, /await this\.captureSnapshotAtBoundary\(name\)/,
  "quick save and package export must capture at a frame boundary");
assert.match(saveSystemSource, /this\.context\.runAtStepBoundary/,
  "save capture must use the simulation queue when configured");
assert.match(simulationEngineSource, /runAtStepBoundary<T>\(operation: \(\) => T\): Promise<T>/,
  "SimulationEngine must expose a serialized capture boundary");
assert.match(mainSource, /runAtStepBoundary: async operation => \{\s*await _applicationFrameSettled;\s*return sim\.runAtStepBoundary\(operation\)/,
  "the main app must wire world-save capture to the serialized step queue");
assert.match(saveSystemSource, /if \(!mutate\)\s*\{\s*throw new Error\("World restore requires an engine-owned mutation transaction"\)/,
  "world snapshot import must fail closed if the authoritative transaction port is missing");
assert.doesNotMatch(saveSystemSource, /this\.context\.syncToGPU\?\.\(\)/,
  "world snapshot import must not use an untransactional compatibility fallback");
assert.match(saveSystemSource, /const graphBefore = this\.context\.graphProvider\?\.\(\)/,
  "world snapshot import must checkpoint the external graph domain");
assert.match(saveSystemSource, /const civBefore = this\.context\.getCivSnapshot\?\.\(\)/,
  "world snapshot import must checkpoint the external civilization domain");
assert.match(saveSystemSource, /rollback\("Civilization", \(\) => this\.context\.restoreCivSnapshot!\(civBefore\)\)/,
  "failed world snapshot import must restore civilization state through the rollback coordinator");
assert.match(saveSystemSource, /runtimeState:\s*\{[\s\S]*entityLayer:\s*this\.context\.getEntityLayerSnapshot\?\.\(\)[\s\S]*agents:\s*this\.context\.getAgentSystemSnapshot\?\.\(\)[\s\S]*civilizations:\s*this\.context\.getCivSnapshot\?\.\(\)[\s\S]*laws:\s*this\.context\.getLawEngineSnapshot\?\.\(\)/,
  "quick saves must carry full runtime snapshots for entity, agent, civilization and law systems");
assert.match(saveSystemSource, /this\.context\.restoreEntityLayerSnapshot\(runtime\.entityLayer\)/,
  "quick save restore must rehydrate the full entity layer instead of leaving stale entity instances");
assert.match(saveSystemSource, /this\.context\.restoreAgentSystemSnapshot\(runtime\.agents\)/,
  "quick save restore must rehydrate the full agent system and RNG");
assert.match(saveSystemSource, /this\.context\.restoreLawEngineSnapshot\(runtime\.laws\)/,
  "quick save restore must preserve all laws, overrides and law RNG");
assert.match(saveSystemSource, /this\.context\.clearEntityLayerRuntime\?\.\(\)/,
  "portable or legacy saves without full runtime state must clear stale in-memory entities");
assert.match(saveSystemSource, /this\.context\.clearAgentRuntime\?\.\(\)/,
  "portable or legacy saves without full runtime state must clear stale in-memory agents");
assert.match(saveSystemSource, /chemistry: this\.context\.getChemistrySnapshot\?\.\(\)/,
  "quick saves must include deferred chemistry transfers");
assert.match(saveSystemSource, /worldEvents: this\.context\.getWorldEventsSnapshot\?\.\(\)/,
  "quick saves must include event history, interval state and event PRNG");
assert.match(saveSystemSource, /causal: this\.context\.getCausalSnapshot\?\.\(\)/,
  "quick saves must include causal graph identity/history");
assert.match(saveSystemSource, /previousEnergy: this\.context\.getPreviousEnergySnapshot\?\.\(\)/,
  "quick saves must include the previous-energy baseline used by causality tracking");
assert.match(saveSystemSource, /this\.context\.clearRecorderSnapshots\?\.\(\)/,
  "restoring another world must clear field-only recorder history from the previous world");
assert.match(mainSource, /sim\.mutateAuthoritativeState\(\(\) => sim\.recorder\.restoreSnapshot\(sim\.grid, scrubberIdx\)\)/,
  "recorded grid frames must invalidate stale GPU work before writing the grid");
assert.match(mainSource, /loadCivs: civs => \{\s*civSystem\.loadPortableCivs/,
  "portable civilization imports must reset the previous world's transient state");
assert.match(climateSource, /willWriteGridOnNextTick\(\): boolean/);
assert.match(multiScaleSource, /willWriteGridOnNextTick\(\): boolean/);
assert.match(languageSource, /willWriteGridOnNextTick\(\): boolean/);
assert.match(mainSource, /if \(externalGridWriteExpected\) sim\.invalidatePendingGPUReadback\(\)/,
  "post-step CPU writers must invalidate outstanding GPU readback before a grid-writing pass");
assert.match(mainSource, /if \(externalGridWriteExpected \|\| externalGridChanged\) sim\.syncToGPU\(\)/,
  "post-step CPU writers must publish dense/chunk/GPU state after a grid-writing pass");
for (const field of ["climate", "multiScale", "language", "economy", "metaLawEvolution", "cosmologicalSim"]) {
  assert.match(saveSystemSource, new RegExp(field + ": this\\.context\\.get[^\\n]+\\?\\.\\(\\)"),
    "quick saves must capture auxiliary runtime domain: " + field);
}
assert.match(saveSystemSource, /this\.context\.resetClimate\?\.\(\)/);
assert.match(saveSystemSource, /this\.context\.resetMultiScale\?\.\(\)/);
assert.match(saveSystemSource, /this\.context\.resetLanguage\?\.\(\)/);
assert.match(saveSystemSource, /this\.context\.resetEconomic\?\.\(\)/);
assert.match(saveSystemSource, /this\.context\.resetMetaLawEvolution\?\.\(\)/);
assert.match(saveSystemSource, /this\.context\.resetCosmological\?\.\(\)/);
assert.match(saveSystemSource, /this\.context\.clearTimeline\?\.\(\)/);
assert.match(saveSystemSource, /director: this\.context\.getDirectorSnapshot\?\.\(\)/,
  "quick saves must preserve SceneDirector history and world log");
assert.match(saveSystemSource, /this\.context\.resetDirector\?\.\(\)/,
  "portable/legacy imports must clear stale SceneDirector context");
assert.match(saveSystemSource, /MAX_AUTOSAVE_SNAPSHOTS = 12/,
  "runtime-heavy autosaves must have a bounded retention window");
assert.match(saveSystemSource, /db\.transaction\('saves', 'readwrite'\)/,
  "autosave pruning and insert must occur inside one IndexedDB transaction");
assert.match(saveSystemSource, /autosaves\.slice\(MAX_AUTOSAVE_SNAPSHOTS - 1\)/,
  "autosaves must prune only the oldest rows beyond the rolling limit");
assert.match(saveManagerSource, /quickSave.*Autosave_.*\.catch/s,
  "autosave quota/storage errors must be handled rather than becoming unhandled rejections");
assert.match(mainSource, /getDirectorSnapshot: \(\) => director\.snapshot\(\)/,
  "the application must wire SceneDirector snapshots into world saves");
assert.match(directorSource, /snapshot\(\): SceneDirectorSnapshot/);
assert.match(directorSource, /private contextGeneration = 0/);
assert.match(directorSource, /requestGeneration !== this\.contextGeneration/,
  'SceneDirector must discard requests started in an older world context');
assert.match(mainSource, /function clearDirectorUiContext\(\): void/);
assert.match(mainSource, /await _applicationFrameSettled/,
  'world capture must wait for the full application frame, including post-step systems');
assert.match(directorSource, /reset\(\): void/);
assert.match(multiplayerSource, /this\.sim\.mutateAuthoritativeState\(\(\) => \{/,
  "network paint/delta and full-state writes must use the engine-owned mutation transaction");
assert.match(simulationEngineSource, /this\.grid\.syncDenseToChunks\(\);\s*this\.grid\.syncBackBuffersFromFront\(\);/,
  "authoritative mutation commit must publish the dense state to sparse chunks and back buffers");
assert.match(economicSource, /snapshot\(\): EconomicSystemSnapshot/);
assert.match(metaLawSource, /snapshot\(\): MetaLawEvolutionSnapshot/);
assert.match(cosmologicalSource, /snapshot\(\): CosmologicalSimSnapshot/);
assert.match(timelineSource, /reset\(\): void/);
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = [...js.matchAll(/from\s+["'](\.\/?[^"']+)["']/g)];
  for (const match of imports) {
    const specifier = match[1];
    const target = specifier.endsWith(".ts") ? specifier : specifier + ".ts";
    const childPath = path.split("/").slice(0, -1).concat(target).join("/");
    const child = await load(childPath);
    js = js.replace(match[0], match[0].replace(specifier, child));
  }
  const url = "data:text/javascript;base64," + Buffer.from(js).toString("base64");
  cache.set(path, url);
  return url;
}

const { WorldSerializer, FIELD_ORDER } = await import(await load("src/world/save/WorldSerializer.ts"));
const serializer = new WorldSerializer();
const targetBuffer = new Float32Array(4 * 24);
targetBuffer.fill(17);
const validFields = serializer.captureAllFields(targetBuffer);
const stableTarget = targetBuffer.slice();

const missingField = { ...validFields };
delete missingField.information;
assert.throws(() => serializer.applyFields(missingField, targetBuffer), /field "information" has an invalid buffer size/);
assert.deepEqual(targetBuffer, stableTarget, "missing fields must be rejected before mutating the destination");

const truncatedField = { ...validFields, energy: new Float32Array([1, 2]).buffer };
assert.throws(() => serializer.applyFields(truncatedField, targetBuffer), /field "energy" has an invalid buffer size/);
assert.deepEqual(targetBuffer, stableTarget, "truncated fields must be rejected before mutating the destination");

const nonFiniteData = new Float32Array(4);
nonFiniteData[2] = Number.NaN;
const nonFiniteField = { ...validFields, entropy: nonFiniteData.buffer };
assert.throws(() => serializer.applyFields(nonFiniteField, targetBuffer), /field "entropy" contains non-finite values/);
assert.deepEqual(targetBuffer, stableTarget, "non-finite fields must be rejected before mutating the destination");

assert.deepEqual(Object.keys(validFields).sort(), [...FIELD_ORDER].sort(),
  "the serializer must emit every supported field");

const values = new Map();
let failSet = false;
let failGet = false;
let failRemove = false;
globalThis.localStorage = {
  setItem(key, value) {
    if (failSet) throw new Error("QuotaExceededError");
    values.set(String(key), String(value));
  },
  getItem(key) {
    if (failGet) throw new Error("SecurityError");
    return values.has(String(key)) ? values.get(String(key)) : null;
  },
  removeItem(key) {
    if (failRemove) throw new Error("SecurityError");
    values.delete(String(key));
  },
};

const { WorldPersistence } = await import(await load("src/infinity/WorldPersistence.ts"));
const persistence = new WorldPersistence("seed-a");
const fieldState = { schemaVersion: "world-field-state-v2", mutations: [{ id: 1 }] };

assert.equal(persistence.saveFieldState(fieldState), true);
assert.deepEqual(persistence.loadFieldState(), fieldState);
assert.equal(new WorldPersistence("seed-b").loadFieldState(), null);

const key = "reality-engine-world:seed-a:field-state";
const previousDurableValue = values.get(key);
failSet = true;
assert.equal(persistence.saveFieldState({ mutations: [{ id: 2 }] }), false,
  "quota/storage errors should return false instead of escaping");
assert.equal(values.get(key), previousDurableValue,
  "a failed write must not replace the last durable snapshot");
failSet = false;

failGet = true;
assert.equal(persistence.loadFieldState(), null,
  "unavailable storage should be treated as an unavailable saved state");
failGet = false;

values.set(key, "{broken-json");
assert.equal(persistence.loadFieldState(), null, "corrupt persisted JSON should be rejected");
assert.equal(persistence.saveFieldState(fieldState), true);

failRemove = true;
assert.equal(persistence.deleteFieldState(), false,
  "delete storage errors should be reported without throwing");
failRemove = false;
assert.equal(persistence.deleteFieldState(), true);
assert.equal(persistence.loadFieldState(), null);


function toModuleUrl(source) {
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}
function replaceImport(js, pattern, url, label) {
  assert.match(js, pattern, "missing runtime import for " + label);
  return js.replace(pattern, 'from "' + url + '"');
}
const runtimeCellUrl = toModuleUrl(`
export const CELL_FIELDS = 24;
export const F = {
  ENERGY:0,DENSITY:1,INFORMATION:2,ENTROPY:3,TEMPERATURE:4,PRESSURE:5,
  FIELD_X:6,FIELD_Y:7,FIELD_Z:8,LOCAL_TIME:9,CAUSALITY_ID:10,BIO_POTENTIAL:11,
  WAVE_PHASE:12,WAVE_AMP:13,GRAVITY_POT:14,MATERIAL_ID:15,CHEM_STATE:16,
  SIGNAL:17,MEM_FIELD:18,AGENT_MARK:19,ENTITY_ID:20,SPARE_1:21,SPARE_2:22,SPARE_3:23
};
`);
const runtimeIdbUrl = toModuleUrl(`export async function openDB() { throw new Error("IndexedDB must not be used by this unit test"); }`);
const runtimeCreatorUrl = toModuleUrl(`export class PackageSerializer { constructor() {} async pack() { return null; } async unpack() { return {}; } }`);
const runtimeProcessUrl = toModuleUrl(`export const PROCESS_LIBRARY = [];`);

const serializerSource = await readFile(new URL("src/world/save/WorldSerializer.ts", root), "utf8");
let serializerJs = ts.transpileModule(serializerSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
serializerJs = replaceImport(serializerJs, /from\s+["']\.\.\/\.\.\/core\/CellState["']/, runtimeCellUrl, "WorldSerializer CellState");
const runtimeSerializerUrl = toModuleUrl(serializerJs);

let saveSystemJs = ts.transpileModule(saveSystemSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
saveSystemJs = replaceImport(saveSystemJs, /from\s+["']idb["']/, runtimeIdbUrl, "idb");
saveSystemJs = replaceImport(saveSystemJs, /from\s+["']\.\.\/\.\.\/creator["']/, runtimeCreatorUrl, "PackageSerializer");
saveSystemJs = replaceImport(saveSystemJs, /from\s+["']\.\.\/\.\.\/core\/CellState["']/, runtimeCellUrl, "CellState fields");
saveSystemJs = replaceImport(saveSystemJs, /from\s+["']\.\.\/\.\.\/process\/ProcessDef["']/, runtimeProcessUrl, "PROCESS_LIBRARY");
saveSystemJs = replaceImport(saveSystemJs, /from\s+["']\.\/WorldSerializer["']/, runtimeSerializerUrl, "WorldSerializer");
const runtimeSaveUrl = toModuleUrl(saveSystemJs);
const { WorldSaveSystem: RuntimeWorldSaveSystem } = await import(runtimeSaveUrl);

const runtimeGrid = {
  W: 2, H: 1, D: 1, size: 2,
  buffer: new Float32Array(2 * 24),
  totalField(fieldIndex) {
    let sum = 0;
    for (let offset = fieldIndex; offset < this.buffer.length; offset += 24) sum += this.buffer[offset];
    return sum;
  },
};
runtimeGrid.buffer[0] = 51;
runtimeGrid.buffer[17] = 2;
runtimeGrid.buffer[18] = 8;
runtimeGrid.buffer[19] = 3;
runtimeGrid.buffer[20] = 4;
runtimeGrid.buffer[24] = 29;
const runtimeState = {
  entityRuntime: { source: "runtime-save", ids: [4] },
  agentRuntime: { source: "runtime-save", ids: [9] },
  civilizationRuntime: { source: "runtime-save", ids: [2], tickCount: 3, historyLog: ["old-world"], rngState: 19 },
  civs: [],
  lawRuntime: { source: "runtime-save", override: "keep" },
  chemistry: { pendingDensityTransfers: [[1, 0.25]] },
  worldEvents: { history: [], nextAuto: 177, rngState: 12345 },
  causal: { events: [], nextId: 7, lastEventByCell: [[1, 6]] },
  previousEnergy: new Float32Array([5, 6]),
  director: {
    history: [{ role: "user", content: "old world question" }, { role: "assistant", content: "old world answer" }],
    worldLog: [{ tick: 31, director: "old-world prompt", action: "old-world event" }],
  },
  tick: 44,
  recorderClears: 0,
  entityClearCount: 0,
  agentClearCount: 0,
};
const cloneValue = value => structuredClone(value);
const mockLawEngine = {
  laws: [],
  activeProcessMask: 0,
  applyGraphPlan(plan) {
    this.activeProcessMask = (plan.activeProcessIds ?? []).reduce((mask,id) => mask | (1 << id), 0);
  },
};
const transactionContext = {
  mutateAuthoritativeState(mutation) {
    const beforeBuffer = runtimeGrid.buffer.slice();
    const beforeState = cloneValue(runtimeState);
    const beforeLaws = cloneValue(mockLawEngine.laws);
    const beforeMask = mockLawEngine.activeProcessMask;
    try {
      return mutation();
    } catch (error) {
      runtimeGrid.buffer.set(beforeBuffer);
      Object.assign(runtimeState, beforeState);
      mockLawEngine.laws = beforeLaws;
      mockLawEngine.activeProcessMask = beforeMask;
      throw error;
    }
  },
  graphProvider: () => undefined,
  getTick: () => runtimeState.tick,
  setTick: tick => { runtimeState.tick = tick; },
  getEntities: () => [],
  getCivs: () => cloneValue(runtimeState.civs),
  loadCivs: civs => { runtimeState.civilizationRuntime = { mode: "portable", civs: cloneValue(civs), tickCount: 0, historyLog: [], rngState: 123 }; },
  getEntityLayerSnapshot: () => cloneValue(runtimeState.entityRuntime),
  restoreEntityLayerSnapshot: snapshot => { runtimeState.entityRuntime = cloneValue(snapshot); },
  clearEntityLayerRuntime: () => {
    runtimeState.entityRuntime = { mode: "cleared" };
    runtimeState.entityClearCount++;
    for (let cell = 0; cell < runtimeGrid.size; cell++) runtimeGrid.buffer[cell * 24 + 20] = 0;
  },
  getAgentSystemSnapshot: () => cloneValue(runtimeState.agentRuntime),
  restoreAgentSystemSnapshot: snapshot => { runtimeState.agentRuntime = cloneValue(snapshot); },
  clearAgentRuntime: () => {
    runtimeState.agentRuntime = { mode: "cleared" };
    runtimeState.agentClearCount++;
    for (let cell = 0; cell < runtimeGrid.size; cell++) runtimeGrid.buffer[cell * 24 + 19] = 0;
  },
  getCivSnapshot: () => cloneValue(runtimeState.civilizationRuntime),
  restoreCivSnapshot: snapshot => { runtimeState.civilizationRuntime = cloneValue(snapshot); },
  getLawEngineSnapshot: () => cloneValue(runtimeState.lawRuntime),
  restoreLawEngineSnapshot: snapshot => { runtimeState.lawRuntime = cloneValue(snapshot); },
  getChemistrySnapshot: () => cloneValue(runtimeState.chemistry),
  restoreChemistrySnapshot: snapshot => { runtimeState.chemistry = cloneValue(snapshot); },
  resetChemistry: () => { runtimeState.chemistry = { pendingDensityTransfers: [] }; },
  getWorldEventsSnapshot: () => cloneValue(runtimeState.worldEvents),
  restoreWorldEventsSnapshot: snapshot => { runtimeState.worldEvents = cloneValue(snapshot); },
  resetWorldEvents: () => { runtimeState.worldEvents = { history: [], nextAuto: 600, rngState: 0x6d2b79f5 }; },
  getCausalSnapshot: () => cloneValue(runtimeState.causal),
  restoreCausalSnapshot: snapshot => { runtimeState.causal = cloneValue(snapshot); },
  resetCausal: () => { runtimeState.causal = { events: [], nextId: 1, lastEventByCell: [] }; },
  getPreviousEnergySnapshot: () => new Float32Array(runtimeState.previousEnergy),
  restorePreviousEnergySnapshot: snapshot => { runtimeState.previousEnergy = new Float32Array(snapshot); },
  resetPreviousEnergy: () => { runtimeState.previousEnergy = new Float32Array(runtimeGrid.size); },
  clearRecorderSnapshots: () => { runtimeState.recorderClears++; },
  getDirectorSnapshot: () => cloneValue(runtimeState.director),
  restoreDirectorSnapshot: snapshot => { runtimeState.director = cloneValue(snapshot); },
  resetDirector: () => { runtimeState.director = { history: [], worldLog: [] }; },
  getCausalLog: () => cloneValue(runtimeState.causal.events),
};
const saveHarness = new RuntimeWorldSaveSystem(runtimeGrid, mockLawEngine, null, transactionContext);
const savedRuntimeWorld = saveHarness.captureSnapshot("Runtime checkpoint");
const expectedRuntimeBuffer = runtimeGrid.buffer.slice();
const expectedRuntimeState = cloneValue(runtimeState);

runtimeGrid.buffer.fill(99);
runtimeState.entityRuntime = { source: "wrong-world" };
runtimeState.agentRuntime = { source: "wrong-world" };
runtimeState.civilizationRuntime = { source: "wrong-world" };
runtimeState.lawRuntime = { source: "wrong-world" };
runtimeState.chemistry = { pendingDensityTransfers: [[0, 999]] };
runtimeState.worldEvents = { history: [], nextAuto: 1, rngState: 999 };
runtimeState.causal = { events: [], nextId: 900, lastEventByCell: [] };
runtimeState.previousEnergy.fill(999);
runtimeState.tick = 900;

await saveHarness.applySnapshot(savedRuntimeWorld);
assert.deepEqual(runtimeGrid.buffer, expectedRuntimeBuffer, "quick-save restore must restore every field value");
assert.deepEqual(runtimeState.entityRuntime, expectedRuntimeState.entityRuntime, "quick-save restore must recover entity runtime");
assert.deepEqual(runtimeState.agentRuntime, expectedRuntimeState.agentRuntime, "quick-save restore must recover agent runtime");
assert.deepEqual(runtimeState.civilizationRuntime, expectedRuntimeState.civilizationRuntime, "quick-save restore must recover civilization runtime");
assert.deepEqual(runtimeState.lawRuntime, expectedRuntimeState.lawRuntime, "quick-save restore must recover full law runtime");
assert.deepEqual(runtimeState.chemistry, expectedRuntimeState.chemistry, "quick-save restore must recover pending chemistry transfers");
assert.deepEqual(runtimeState.worldEvents, expectedRuntimeState.worldEvents, "quick-save restore must recover event queue and PRNG");
assert.deepEqual(runtimeState.causal, expectedRuntimeState.causal, "quick-save restore must recover causal graph identity state");
assert.deepEqual(runtimeState.previousEnergy, expectedRuntimeState.previousEnergy, "quick-save restore must recover previous-energy baseline");
assert.deepEqual(runtimeState.director, expectedRuntimeState.director, "quick-save restore must recover SceneDirector history and world log");
assert.equal(runtimeState.tick, savedRuntimeWorld.metadata.simulationTicks, "quick-save restore must restore simulation tick");
assert.equal(runtimeState.recorderClears, 1, "successful restore must clear field-only recorder history");

const legacySnapshot = { ...savedRuntimeWorld, civilizations: [] };
delete legacySnapshot.runtimeState;
runtimeState.entityRuntime = { source: "stale-entity" };
runtimeState.agentRuntime = { source: "stale-agent" };
runtimeState.civilizationRuntime = { source: "stale-civilization" };
runtimeState.chemistry = { pendingDensityTransfers: [[0, 999]] };
runtimeState.worldEvents = { history: [], nextAuto: 1, rngState: 999 };
runtimeState.causal = { events: [], nextId: 900, lastEventByCell: [] };
runtimeState.previousEnergy.fill(777);
runtimeState.director = { history: [{ role: "assistant", content: "stale context" }], worldLog: [{ tick: 999, director: "stale", action: "stale" }] };
runtimeGrid.buffer.fill(0);
await saveHarness.applySnapshot(legacySnapshot);
assert.deepEqual(runtimeState.entityRuntime, { mode: "cleared" }, "legacy restore must clear stale entity runtime");
assert.deepEqual(runtimeState.agentRuntime, { mode: "cleared" }, "legacy restore must clear stale agent runtime");
assert.deepEqual(runtimeState.civilizationRuntime, { mode: "portable", civs: [], tickCount: 0, historyLog: [], rngState: 123 },
  "legacy restore must reset civilization transient state rather than inherit the previous world");
assert.deepEqual(runtimeState.chemistry, { pendingDensityTransfers: [] }, "legacy restore must clear pending chemistry transfers");
assert.deepEqual(runtimeState.worldEvents, { history: [], nextAuto: 600, rngState: 0x6d2b79f5 }, "legacy restore must reset world-event history and PRNG");
assert.deepEqual(runtimeState.causal, { events: [], nextId: 1, lastEventByCell: [] }, "legacy restore must clear stale causal history");
assert.deepEqual(runtimeState.previousEnergy, new Float32Array(runtimeGrid.size), "legacy restore must reset the previous-energy baseline");
assert.deepEqual(runtimeState.director, { history: [], worldLog: [] }, "legacy restore must clear stale SceneDirector context");
assert.equal(runtimeState.recorderClears, 2, "each world restore must clear stale recorder history");
assert.equal(runtimeGrid.buffer[20], 0, "legacy restore must clear stale entity ownership marker");
assert.equal(runtimeGrid.buffer[19], 0, "legacy restore must clear stale agent marker");

const noTransactionSaver = new RuntimeWorldSaveSystem(runtimeGrid, mockLawEngine, null, {});
const beforeRejectedRestore = runtimeGrid.buffer.slice();
await assert.rejects(
  noTransactionSaver.applySnapshot(savedRuntimeWorld),
  /World restore requires an engine-owned mutation transaction/,
);
assert.deepEqual(runtimeGrid.buffer, beforeRejectedRestore, "restore without a transaction port must fail before mutation");

// Exercise the real sparse grid through WorldSaveSystem. The dense field
// payload is authoritative in the dense window, while serialized chunks retain
// data outside the window. Loading a world must also discard previous dirty/owner
// metadata and align the double buffers before the next tick.
const { SparseVoxelGrid: RuntimeSparseVoxelGrid } = await import(await load("src/core/SparseVoxelGrid.ts"));
const runtimeCellModule = await import(await load("src/core/CellState.ts"));
const runtimeGridReal = new RuntimeSparseVoxelGrid(4, 4, 4);
const denseIndexReal = runtimeGridReal.idx(1, 1, 1);
runtimeGridReal.buffer[denseIndexReal + runtimeCellModule.F.INFORMATION] = 0.75;
runtimeGridReal.buffer[denseIndexReal + runtimeCellModule.F.ENTROPY] = 0.125;
runtimeGridReal.syncDenseToChunks();
const remoteReal = runtimeGridReal.getOrCreateChunk(1, 0, 0);
remoteReal.buffer[remoteReal.localIdx(0, 0, 0) + runtimeCellModule.F.DENSITY] = 0.875;
runtimeGridReal.syncDenseToChunks();
const realSaveSystem = new RuntimeWorldSaveSystem(runtimeGridReal, mockLawEngine, null, {
  mutateAuthoritativeState(mutation) {
    const before = runtimeGridReal.captureState();
    try {
      const result = mutation();
      runtimeGridReal.syncDenseToChunks();
      runtimeGridReal.syncBackBuffersFromFront();
      return result;
    } catch (error) {
      runtimeGridReal.restoreState(before);
      throw error;
    }
  },
  getTick: () => 5,
  setTick() {},
  clearEntityLayerRuntime() {},
  clearAgentRuntime() {},
  resetChemistry() {},
  resetWorldEvents() {},
  resetCausal() {},
  resetPreviousEnergy() {},
  clearRecorderSnapshots() {},
});
const realSnapshot = realSaveSystem.captureSnapshot("Sparse field authority");
assert.ok(realSnapshot.chunks?.serialized.some(chunk => chunk.key === "0,0,0"),
  "sparse save must serialize a chunk with non-energy fields and zero energy");
assert.ok(realSnapshot.chunks?.serialized.some(chunk => chunk.key === "1,0,0"),
  "sparse save must serialize non-energy values outside the dense window");
runtimeGridReal.buffer.fill(42);
runtimeGridReal.backBuffer.fill(84);
runtimeGridReal.getOrCreateChunk(5, 0, 0).buffer[0] = 123;
runtimeGridReal.assignChunkOwner("5,0,0", "old-world-owner");
runtimeGridReal.markChunksDirty(["5,0,0"]);
await realSaveSystem.applySnapshot(realSnapshot);
assert.equal(runtimeGridReal.buffer[denseIndexReal + runtimeCellModule.F.INFORMATION], 0.75,
  "world restore must preserve the packed information field as dense-window authority");
assert.equal(runtimeGridReal.buffer[denseIndexReal + runtimeCellModule.F.ENTROPY], 0.125,
  "world restore must preserve the packed entropy field as dense-window authority");
assert.equal(runtimeGridReal.getCell(32, 0, 0)?.density, 0.875,
  "world restore must preserve chunk data outside the dense window");
assert.equal(runtimeGridReal.chunks.has("5,0,0"), false,
  "world restore must discard sparse chunks from the prior world");
assert.equal(runtimeGridReal.chunkOwners.size, 0, "world restore must discard stale chunk ownership");
assert.equal(runtimeGridReal.dirtyChunks.size, 0, "world restore must discard stale dirty-chunk flags");
assert.deepEqual(runtimeGridReal.backBuffer, runtimeGridReal.buffer,
  "world restore must reset dense double-buffer baseline");
for (const chunk of runtimeGridReal.chunks.values()) {
  assert.deepEqual(chunk.backBuffer, chunk.buffer, "world restore must reset sparse double-buffer baseline");
}



const { VoxelGrid: PostStepVoxelGrid } = await import(await load("src/core/VoxelGrid.ts"));
const { ClimateSystem: PostStepClimateSystem } = await import(await load("src/simulation/ClimateSystem.ts"));
const { MultiScaleSystem: PostStepMultiScaleSystem } = await import(await load("src/simulation/MultiScaleSystem.ts"));
const { LanguageSystem: PostStepLanguageSystem } = await import(await load("src/simulation/LanguageEmergence.ts"));

const climateGrid = new PostStepVoxelGrid(6, 6, 4);
const climate = new PostStepClimateSystem(climateGrid);
for (let tick = 1; tick <= 8; tick++) {
  const expectedWrite = tick % 5 === 0 || tick % 8 === 0;
  assert.equal(climate.willWriteGridOnNextTick(), expectedWrite,
    "ClimateSystem must predict its scheduled field-writing passes");
  assert.equal(climate.tick(0.016), expectedWrite,
    "ClimateSystem must report every scheduled field-writing pass");
}

const multiScaleGrid = new PostStepVoxelGrid(16, 16, 8);
const multiScale = new PostStepMultiScaleSystem(multiScaleGrid);
for (let tick = 1; tick <= 20; tick++) {
  assert.equal(multiScale.willWriteGridOnNextTick(), tick === 20,
    "MultiScaleSystem must predict its 20-tick field coupling pass");
  assert.equal(multiScale.tick(), tick === 20,
    "MultiScaleSystem must report its field coupling pass");
}

const languageGrid = new PostStepVoxelGrid(8, 8, 4);
const languageSim = {
  grid: languageGrid,
  agents: { getAgents: () => [
    { id: 1, x: 1, y: 1, z: 1, energy: 120, signal: 14, behavior: "signaler" },
    { id: 2, x: 2, y: 1, z: 1, energy: 180, signal: 20, behavior: "explorer" },
  ] },
  tick: 1,
};
const language = new PostStepLanguageSystem(languageSim);
for (let tick = 1; tick <= 5; tick++) {
  assert.equal(language.willWriteGridOnNextTick(), tick === 5,
    "LanguageSystem must predict its throttled field-writing pass only when agents can interact");
  assert.equal(language.tick(), tick === 5,
    "LanguageSystem must report when it writes information fields");
}
assert.ok(languageGrid.buffer.some(value => value > 0),
  "language propagation must actually mutate the test field");


const { ClimateSystem: RuntimeClimate } = await import(await load("src/simulation/ClimateSystem.ts"));
const { MultiScaleSystem: RuntimeMultiScale } = await import(await load("src/simulation/MultiScaleSystem.ts"));
const { LanguageSystem: RuntimeLanguage } = await import(await load("src/simulation/LanguageEmergence.ts"));
const { EconomicSystem: RuntimeEconomy } = await import(await load("src/simulation/EconomicSystem.ts"));
const { MetaLawEvolution: RuntimeMetaLaw } = await import(await load("src/simulation/MetaLawEvolution.ts"));
const { CosmologicalSim: RuntimeCosmological } = await import(await load("src/simulation/CosmologicalSim.ts"));
const { Timeline: RuntimeTimeline } = await import(await load("src/world/Timeline.ts"));
const { SceneDirector: RuntimeSceneDirector } = await import(await load("src/ai/SceneDirector.ts"));
const { MultiplayerSync: RuntimeMultiplayerSync } = await import(await load("src/network/MultiplayerSync.ts"));

function fakeGrid(W, H, D) {
  return {
    W, H, D, size: W * H * D, buffer: new Float32Array(W * H * D * 24),
    idx(x, y, z) { return (z * H * W + y * W + x) * 24; },
    inBounds(x, y, z) { return x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D; },
  };
}
const auxiliaryClimateGrid = fakeGrid(8, 8, 4);
const climateRuntime = new RuntimeClimate(auxiliaryClimateGrid);
for (let i = 0; i < 8; i++) climateRuntime.tick(0.016);
const climateSaved = climateRuntime.snapshot();
climateRuntime.tick(0.016);
climateRuntime.restore(climateSaved);
assert.deepEqual(climateRuntime.snapshot(), climateSaved, "climate snapshot must restore wind/pressure and tick phase");
climateRuntime.reset();
assert.deepEqual(climateRuntime.snapshot(), new RuntimeClimate(auxiliaryClimateGrid).snapshot(),
  "climate reset must return to constructor baseline");

const auxiliaryMultiscaleGrid = fakeGrid(16, 16, 8);
const multiscaleRuntime = new RuntimeMultiScale(auxiliaryMultiscaleGrid);
for (let i = 0; i < 20; i++) multiscaleRuntime.tick();
const multiscaleSaved = multiscaleRuntime.snapshot();
multiscaleRuntime.tick();
multiscaleRuntime.restore(multiscaleSaved);
assert.deepEqual(multiscaleRuntime.snapshot(), multiscaleSaved,
  "multiscale snapshot must restore macro caches and tick phase");
multiscaleRuntime.reset();
assert.equal(multiscaleRuntime.snapshot().tickCount, 0, "multiscale reset must clear the tick phase");

const auxiliaryLanguageGrid = fakeGrid(8, 8, 4);
const languageRuntime = new RuntimeLanguage({
  grid: auxiliaryLanguageGrid,
  tick: 10,
  agents: { getAgents: () => [
    { id: 1, x: 1, y: 1, z: 1, energy: 120, signal: 14, behavior: "signaler" },
    { id: 2, x: 2, y: 1, z: 1, energy: 180, signal: 20, behavior: "explorer" },
  ] },
});
const languageSaved = {
  vocabulary: [["1,2", { id: 1, meaning: { type: "contact", value: "nearby" }, firstSeen: 4 }]],
  signalLog: [{ tick: 4, word: "W1", meaning: "contact" }],
  lexiconAge: [["2,3", 3]],
  nextWordId: 2,
  communicationEvents: 7,
  tickCount: 5,
};
languageRuntime.restore(languageSaved);
assert.deepEqual(languageRuntime.snapshot(), languageSaved, "language snapshot must preserve vocabulary/log/learning counters");
const beforeInvalidLanguage = languageRuntime.snapshot();
assert.throws(() => languageRuntime.restore({ ...languageSaved, nextWordId: 1 }), /Invalid LanguageSystem next word id/);
assert.deepEqual(languageRuntime.snapshot(), beforeInvalidLanguage,
  "invalid language snapshots must be rejected without partial mutation");
languageRuntime.reset();
assert.equal(languageRuntime.snapshot().vocabulary.length, 0, "language reset must clear prior world vocabulary");

const economySim = { grid: fakeGrid(8, 8, 4), tick: 42 };
const civilizationSystemStub = { civs: [] };
const economyRuntime = new RuntimeEconomy(economySim, civilizationSystemStub);
const economySaved = {
  markets: [{
    x: 2, y: 3,
    prices: { energy: 1.5, density: 2.0, information: 3.0 },
    volume: { energy: 5, density: 6, information: 7 },
    history: [{ tick: 50, pE: 1.5, pI: 3.0, vol: 5 }],
    age: 77,
  }],
  gdp: [[1, 1200], [2, 900]],
  globalGDP: 2100,
  gini: 0.25,
  tickCount: 200,
};
economyRuntime.restore(economySaved);
assert.deepEqual(economyRuntime.snapshot(), economySaved, "economic snapshot must restore market state and GDP map");
const beforeInvalidEconomy = economyRuntime.snapshot();
assert.throws(() => economyRuntime.restore({ ...economySaved, gdp: [[1, Number.NaN]] }), /Invalid economic GDP entry/);
assert.deepEqual(economyRuntime.snapshot(), beforeInvalidEconomy,
  "invalid economy snapshots must leave live state unchanged");
economyRuntime.reset();
assert.equal(economyRuntime.snapshot().markets.length, 0, "economy reset must clear markets from prior world");

const fakeLawEngine = { laws: [], tick() {}, removeLaw() {}, spawnMutation() {} };
const metaLawRuntime = new RuntimeMetaLaw(fakeLawEngine, fakeGrid(2, 2, 2));
metaLawRuntime.tick(500);
const metaLawSaved = metaLawRuntime.snapshot();
metaLawRuntime.tick(1000);
metaLawRuntime.restore(metaLawSaved);
assert.deepEqual(metaLawRuntime.snapshot(), metaLawSaved, "meta-law snapshot must restore evolution cycle state");
metaLawRuntime.reset();
assert.deepEqual(metaLawRuntime.snapshot(), {
  lastCycle: 0, lastAction: "awaiting first cycle", cycleCount: 0, topLaw: "",
}, "meta-law reset must return to initial evolution phase");

const cosmologicalRuntime = new RuntimeCosmological(12345);
cosmologicalRuntime.bigBang();
cosmologicalRuntime.seedGalaxies(1);
cosmologicalRuntime.step(0.01);
const cosmologicalSaved = cosmologicalRuntime.snapshot();
cosmologicalRuntime.step(0.02);
cosmologicalRuntime.restore(cosmologicalSaved);
assert.deepEqual(cosmologicalRuntime.snapshot(), cosmologicalSaved,
  "cosmological snapshot must preserve sparse field contents, galaxies, tick and RNG");
cosmologicalRuntime.reset();
assert.equal(cosmologicalRuntime.tick, 0, "cosmological reset must clear tick");
assert.equal(cosmologicalRuntime.galaxies.length, 0, "cosmological reset must clear old galaxies");
assert.equal(cosmologicalRuntime.grid.size(), 0, "cosmological reset must clear old sparse cells");

const timelineGrid = fakeGrid(4, 4, 2);
const timelineRuntime = new RuntimeTimeline(timelineGrid, () => 0);
timelineGrid.buffer[0] = 10;
timelineRuntime.saveSnapshot("old world");
timelineRuntime.autoSave(1);
assert.ok(timelineRuntime.snapshots.length > 0, "timeline test must create old-world snapshots");
timelineRuntime.reset();
assert.equal(timelineRuntime.snapshots.length, 0, "timeline reset must clear previous-world field snapshots");
assert.equal(timelineRuntime.metrics.length, 0, "timeline reset must clear previous-world metrics");


const directorUnit = new RuntimeSceneDirector({
  grid: fakeGrid(2, 2, 2),
  agents: { getAgents: () => [] },
  laws: { laws: [] },
  tick: 0,
  causal: { recent: () => [] },
});
const directorCheckpoint = {
  history: [
    { role: "user", content: "describe this world" },
    { role: "assistant", content: "the field is ordered" },
  ],
  worldLog: [{ tick: 22, director: "seed structure", action: "created an energy pattern" }],
};
directorUnit.restore(directorCheckpoint);
assert.deepEqual(directorUnit.snapshot(), directorCheckpoint,
  "SceneDirector snapshot must preserve context and world log");
const directorBeforeInvalid = directorUnit.snapshot();
assert.throws(() => directorUnit.restore({
  ...directorCheckpoint,
  worldLog: [{ tick: -1, director: "bad", action: "invalid tick" }],
}), /Invalid SceneDirector world log entry/);
assert.deepEqual(directorUnit.snapshot(), directorBeforeInvalid,
  "invalid SceneDirector snapshots must be rejected without partial mutation");
directorUnit.reset();
assert.deepEqual(directorUnit.snapshot(), { history: [], worldLog: [] },
  "SceneDirector reset must clear world context without including or changing the API key");

const originalDirectorFetch = globalThis.fetch;
let resolveDirectorPayload;
let signalDirectorJsonStarted;
const directorJsonStarted = new Promise(resolve => { signalDirectorJsonStarted = resolve; });
directorUnit.apiKey = 'unit-test-key';
globalThis.fetch = async () => ({
  json: () => new Promise(resolve => {
    resolveDirectorPayload = resolve;
    signalDirectorJsonStarted();
  }),
});
const inFlightOldWorldAsk = directorUnit.ask('create an action for the old world');
await directorJsonStarted;
directorUnit.reset();
if (!resolveDirectorPayload) throw new Error('SceneDirector response resolver was not installed');
const fence = String.fromCharCode(96).repeat(3);
const oldWorldResponseText = "old response\n" + fence + "js\nworld.fill(1, 1, 1, 'energy', 999);\n" + fence;
assert.equal(oldWorldResponseText.split(fence)[1], "js\nworld.fill(1, 1, 1, 'energy', 999);\n",
  'stale-response fixture must contain a valid runnable JS fence before it is discarded');
resolveDirectorPayload({ content: [{ type: 'text', text: oldWorldResponseText }] });
const oldWorldResult = await inFlightOldWorldAsk;
assert.equal(oldWorldResult.code, null, 'late response from a previous world must not expose runnable code');
assert.match(oldWorldResult.text, /context changed/);
assert.deepEqual(directorUnit.snapshot(), { history: [], worldLog: [] },
  'late response must not repopulate reset SceneDirector context');
globalThis.fetch = originalDirectorFetch;



const multiplayerGrid = {
  W: 2, H: 1, D: 1, size: 2, buffer: new Float32Array(2 * 24),
  idx(x, y, z) { return (z * this.H * this.W + y * this.W + x) * 24; },
  inBounds(x, y, z) { return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D; },
};
const multiplayerStats = { transactions: 0, publications: 0 };
const multiplayerSim = {
  grid: multiplayerGrid,
  mutateAuthoritativeState(mutation) {
    multiplayerStats.transactions++;
    mutation();
    multiplayerGrid.backBuffer = new Float32Array(multiplayerGrid.buffer);
    multiplayerStats.publications++;
  },
};
const multiplayerUnit = Object.create(RuntimeMultiplayerSync.prototype);
Object.assign(multiplayerUnit, {
  sim: multiplayerSim,
  userId: "z-local",
  connected: true,
  isHost: false,
  peers: new Map([["a-remote", { color: "#fff", lastSeen: 0 }]]),
  cursors: new Map(),
  pendingDeltas: [],
});
multiplayerUnit._handleMessage({
  type: "delta", userId: "peer-delta",
  cells: [{ x: 1, y: 0, z: 0, field: 2, value: 5 }],
});
assert.equal(multiplayerStats.transactions, 1,
  "incoming remote deltas must use the authoritative mutation boundary");
assert.equal(multiplayerStats.publications, 1,
  "incoming remote deltas must publish after one transaction");
assert.equal(multiplayerGrid.buffer[24 + 2], 5,
  "valid remote delta must be applied to the target cell");
assert.equal(multiplayerGrid.backBuffer[24 + 2], 5,
  "remote delta publication must update the back-buffer baseline");

multiplayerUnit._handleMessage({
  type: "paint", userId: "peer-paint",
  cells: [{ x: 99, y: 0, z: 0, field: 2, value: 7 }],
});
assert.equal(multiplayerStats.transactions, 1,
  "all-invalid remote paint batches must not open a mutation transaction");

const fullState = Array.from({ length: multiplayerGrid.buffer.length }, (_, i) => i / 10);
multiplayerUnit._handleMessage({
  type: "full_state", userId: "a-remote", buf: fullState,
});
assert.equal(multiplayerStats.transactions, 2,
  "valid authoritative full-state sync must use exactly one mutation transaction");
assert.equal(multiplayerStats.publications, 2,
  "full-state sync must publish exactly once");
assert.deepEqual(multiplayerGrid.buffer, new Float32Array(fullState),
  "valid remote full-state sync must replace the dense buffer atomically");
assert.deepEqual(multiplayerGrid.backBuffer, multiplayerGrid.buffer,
  "full-state sync must keep dense front/back buffers coherent");

const beforeInvalidFullState = multiplayerGrid.buffer.slice();
multiplayerUnit._handleMessage({
  type: "full_state", userId: "a-remote", buf: [Number.NaN],
});
assert.equal(multiplayerStats.transactions, 2,
  "invalid full-state messages must be rejected before mutation");
assert.deepEqual(multiplayerGrid.buffer, beforeInvalidFullState,
  "invalid full-state messages must leave the current world unchanged");

console.log("PASS: field persistence round-trip and seed isolation");

let storedWorldRows = [
  ...Array.from({ length: 12 }, (_, index) => ({
    id: 'autosave-' + (index + 1),
    name: 'Autosave_' + (index + 1),
    timestamp: 100 + index,
    format: 'quick',
    snapshot: savedRuntimeWorld,
  })),
  {
    id: "manual-world-save",
    name: "Manual world snapshot",
    timestamp: 9999,
    format: "quick",
    snapshot: savedRuntimeWorld,
  },
];
let failAutosaveWrite = false;
const fakeSaveStore = {
  async getAll() { return storedWorldRows.slice(); },
  async delete(id) { storedWorldRows = storedWorldRows.filter(row => row.id !== id); },
  async put(row) {
    if (failAutosaveWrite) {
      failAutosaveWrite = false;
      throw new Error("injected IndexedDB quota failure");
    }
    storedWorldRows = storedWorldRows.filter(existing => existing.id !== row.id);
    storedWorldRows.push(row);
    return row.id;
  },
};
const fakeSaveDb = {
  put: async (_storeName, row) => fakeSaveStore.put(row),
  transaction(storeName, mode) {
    assert.equal(storeName, "saves");
    assert.equal(mode, "readwrite");
    return {
      objectStore: () => fakeSaveStore,
      done: Promise.resolve(),
      abort() {},
    };
  },
};
saveHarness.dbPromise = Promise.resolve(fakeSaveDb);
await saveHarness.quickSave("Autosave_latest");
const autosavesAfterPrune = storedWorldRows.filter(row => row.name.startsWith("Autosave_"));
assert.equal(autosavesAfterPrune.length, 12,
  "successful autosave must keep exactly the configured rolling window");
assert.equal(storedWorldRows.some(row => row.id === "autosave-1"), false,
  "autosave retention must remove the oldest automatic checkpoint first");
assert.equal(storedWorldRows.some(row => row.id === "manual-world-save"), true,
  "autosave retention must never delete a manual world save");
assert.equal(saveHarness.getCurrentSnapshot()?.name, "Autosave_latest",
  "current snapshot must reflect a successfully persisted autosave");

const lastCommittedSnapshot = saveHarness.getCurrentSnapshot();
failAutosaveWrite = true;
await assert.rejects(saveHarness.quickSave("Autosave_quota_failure"), /injected IndexedDB quota failure/);
assert.equal(saveHarness.getCurrentSnapshot(), lastCommittedSnapshot,
  "failed autosave persistence must not replace the last committed current snapshot");

console.log("PASS: quota, read, delete, and corrupt-storage failures are contained");
