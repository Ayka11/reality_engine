import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const saveSystemSource = await readFile(new URL("src/world/save/WorldSaveSystem.ts", root), "utf8");
assert.match(saveSystemSource, /this\.context\.mutateAuthoritativeState\(apply\)/,
  "world snapshot import must commit through the authoritative simulation transaction");
assert.match(saveSystemSource, /const graphBefore = this\.context\.graphProvider\?\.\(\)/,
  "world snapshot import must checkpoint the external graph domain");
assert.match(saveSystemSource, /const civBefore = this\.context\.getCivSnapshot\?\.\(\)/,
  "world snapshot import must checkpoint the external civilization domain");
assert.match(saveSystemSource, /this\.context\.restoreCivSnapshot\(civBefore\)/,
  "failed world snapshot import must restore civilization state");
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

console.log("PASS: field persistence round-trip and seed isolation");
console.log("PASS: quota, read, delete, and corrupt-storage failures are contained");
