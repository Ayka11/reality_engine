import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const coordinateSource = await readFile(new URL('src/infinity/WorldCoordinate.ts', root), 'utf8')
const persistenceSource = await readFile(new URL('src/infinity/WorldPersistence.ts', root), 'utf8')

function asDataModule(source, replacements = []) {
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement)
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}

const coordinateUrl = asDataModule(coordinateSource)
const persistenceUrl = asDataModule(persistenceSource, [
  [/from ['"]\.\/WorldCoordinate['"]/g, 'from "' + coordinateUrl + '"'],
])
const { WorldPersistence } = await import(persistenceUrl)

const entries = new Map()
globalThis.localStorage = {
  get length() { return entries.size },
  key(index) { return [...entries.keys()][index] ?? null },
  getItem(key) { return entries.get(key) ?? null },
  setItem(key, value) { entries.set(String(key), String(value)) },
  removeItem(key) { entries.delete(String(key)) },
}

const persistence = new WorldPersistence('surface-save-seed')
const snapshot = {
  version: 1,
  kind: 'flat-workspace-surface',
  seed: 'flat-user-authored-seed',
  elevation: 8,
  temperature: 0.4,
  moisture: 0.65,
  biome: 'forest',
}
assert.equal(persistence.saveSurfaceProviderState(snapshot), true)
assert.deepEqual(persistence.loadSurfaceProviderState(), snapshot,
  'valid provider snapshot must round-trip under the matching world seed')
const otherWorldPersistence = new WorldPersistence('another-seed')
assert.equal(otherWorldPersistence.loadSurfaceProviderState(), null,
  'surface snapshot state is isolated by the owning world seed')
assert.equal(persistence.deleteSurfaceProviderState(), true)
assert.equal(persistence.loadSurfaceProviderState(), null)

const surfaceKey = 'reality-engine-world:surface-save-seed:surface-provider'
entries.set(surfaceKey, '{corrupt-surface-snapshot')
assert.equal(persistence.loadSurfaceProviderState(), null,
  'malformed surface snapshot must be rejected')
assert.equal(entries.has(surfaceKey), false,
  'malformed surface snapshot must be removed rather than retried on every reload')

assert.equal(persistence.saveSurfaceProviderState(snapshot), true)
assert.equal(persistence.clear(), true,
  'clearing the world must remove the saved surface-provider selection as well as fields and chunks')
assert.equal(persistence.loadSurfaceProviderState(), null)
console.log('World surface persistence regression: PASS')
console.log('PASS: versioned surface snapshot round-trips and remains world-seed scoped')
console.log('PASS: clearing world persistence removes surface selection')
