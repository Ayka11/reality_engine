import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const coordinateSource = await readFile(new URL('src/infinity/WorldCoordinate.ts', root), 'utf8')
const persistenceSource = await readFile(new URL('src/infinity/WorldPersistence.ts', root), 'utf8')
const bootstrapSource = await readFile(new URL('src/infinityBootstrap.ts', root), 'utf8')
const rendererSource = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')

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
const {
  WorldPersistence,
  ACTIVE_WORLD_SEED_STORAGE_KEY,
  loadActiveWorldSeed,
  saveActiveWorldSeed,
} = await import(persistenceUrl)

const entries = new Map()
globalThis.localStorage = {
  get length() { return entries.size },
  key(index) { return [...entries.keys()][index] ?? null },
  getItem(key) { return entries.get(key) ?? null },
  setItem(key, value) { entries.set(String(key), String(value)) },
  removeItem(key) { entries.delete(String(key)) },
}

assert.equal(loadActiveWorldSeed('fallback-seed'), 'fallback-seed',
  'startup must use its fallback when no active-world seed has been saved')
assert.equal(saveActiveWorldSeed('restart-world-seed'), true,
  'the active world seed must be durably persisted')
assert.equal(loadActiveWorldSeed('fallback-seed'), 'restart-world-seed',
  'startup must select the saved seed-scoped world namespace after restart')
entries.set(ACTIVE_WORLD_SEED_STORAGE_KEY, '   ')
assert.equal(loadActiveWorldSeed('fallback-seed'), 'fallback-seed',
  'malformed active seed data must fail closed to the configured fallback')
assert.equal(entries.has(ACTIVE_WORLD_SEED_STORAGE_KEY), false,
  'malformed active seed data must be removed rather than retried on every restart')
assert.equal(saveActiveWorldSeed(''), false, 'empty active seeds must not be persisted')
assert.equal(saveActiveWorldSeed('x'.repeat(513)), false,
  'oversized active seeds must not be persisted')
const originalSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = (key, value) => {
  if (key === ACTIVE_WORLD_SEED_STORAGE_KEY) throw new Error('injected active seed storage failure')
  originalSetItem(key, value)
}
assert.equal(saveActiveWorldSeed('storage-blocked-seed'), false,
  'active seed persistence must report browser storage failures')
globalThis.localStorage.setItem = originalSetItem
assert.match(bootstrapSource, /loadActiveWorldSeed\('reality-seed-1'\)/,
  'bootstrap must restore the saved world seed before constructing InfiniteWorldRenderer')
assert.match(rendererSource, /saveActiveWorldSeed\(this\.generator\.seed\)/,
  'every world save must persist the active seed namespace')
assert.match(rendererSource, /saveActiveWorldSeed\(newSeed\)/,
  'explicit world reseeding must immediately persist its new active seed')

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

const assetManifest = {
  version: '1.0',
  generatedAt: '2026-11-03T12:00:00.000Z',
  project: 'surface-persistence-test',
  entries: [{
    id: 'asset.persisted.tree',
    providerId: 'polyhaven',
    sourceUrl: 'https://polyhaven.com/a/tree',
    name: 'Tree',
    license: 'CC0',
    attribution: 'Poly Haven',
  }],
}
assert.equal(persistence.saveAssetManifestState(assetManifest), true,
  'asset provenance metadata must persist independently of external GLTF downloads')
assert.deepEqual(persistence.loadAssetManifestState(), assetManifest,
  'asset provenance metadata must round-trip for the matching world seed')
assert.equal(otherWorldPersistence.loadAssetManifestState(), null,
  'asset provenance manifests must be isolated by world seed')
const assetPlacements = [{
  instanceId: 'flora.tree:instance:17:0',
  sourceAssetId: 'oak',
  semanticEntryId: 'flora.tree',
  x: 145.5, y: 12.25, z: -32, scale: 0.85, rotationY: 1.2,
}]
assert.equal(persistence.saveAssetPlacementsState(assetPlacements), true,
  'portable external placement descriptors must persist without downloading models')
assert.deepEqual(persistence.loadAssetPlacementsState(), assetPlacements,
  'external placement descriptors must round-trip under the matching world seed')
assert.equal(otherWorldPersistence.loadAssetPlacementsState(), null,
  'external placement descriptors must be isolated by world seed')
const placementsKey = 'reality-engine-world:surface-save-seed:asset-placements'
entries.set(placementsKey, '{malformed-placement-sidecar')
assert.equal(persistence.loadAssetPlacementsState(), null, 'malformed placement sidecar must be rejected')
assert.equal(entries.has(placementsKey), false, 'malformed placement sidecar must be removed')
assert.equal(persistence.saveAssetPlacementsState(assetPlacements), true)
const provenanceTrace = {
  schemaVersion: 'reality-runtime-provenance-v1',
  traceId: 'trace-persistence-test',
  events: [{ id: 'world-state-1', stage: 'world-state', timestamp: 1700000000000,
    payload: { seed: 'surface-save-seed' } }],
  latestWorldState: { seed: 'surface-save-seed' },
}
assert.equal(persistence.saveProvenanceState(provenanceTrace), true,
  'runtime provenance must persist independently of finite simulation state')
assert.deepEqual(persistence.loadProvenanceState(), provenanceTrace,
  'runtime provenance must round-trip for the matching world seed')
assert.equal(otherWorldPersistence.loadProvenanceState(), null,
  'runtime provenance traces must be isolated by world seed')
const provenanceKey = 'reality-engine-world:surface-save-seed:provenance'
entries.set(provenanceKey, '{broken-provenance')
assert.equal(persistence.loadProvenanceState(), null,
  'malformed provenance sidecar data must be rejected')
assert.equal(entries.has(provenanceKey), false,
  'malformed provenance sidecar data must be removed')
assert.equal(persistence.saveProvenanceState(provenanceTrace), true)
const assetManifestKey = 'reality-engine-world:surface-save-seed:asset-manifest'
entries.set(assetManifestKey, '{broken-asset-manifest')
assert.equal(persistence.loadAssetManifestState(), null,
  'malformed asset manifest storage must be rejected')
assert.equal(entries.has(assetManifestKey), false,
  'malformed asset manifest storage must be removed')
assert.equal(persistence.saveAssetManifestState(assetManifest), true)
assert.equal(persistence.clear(), true,
  'clearing a world must remove asset provenance as well as terrain and field state')
assert.equal(persistence.loadAssetManifestState(), null,
  'clearing a world must remove its asset provenance manifest')
assert.equal(persistence.loadProvenanceState(), null,
  'clearing a world must remove its runtime provenance trace')

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
assert.equal(persistence.loadAssetManifestState(), null)
assert.equal(persistence.loadAssetPlacementsState(), null,
  'clearing a world must remove external placement sidecar descriptors')
console.log('World surface persistence regression: PASS')
console.log('PASS: versioned surface snapshot round-trips and remains world-seed scoped')
console.log('PASS: clearing world persistence removes surface selection')
console.log('PASS: active world seed survives restart and selects the matching sidecar namespace')
console.log('PASS: malformed and unavailable active-seed storage fail closed without blocking startup')
