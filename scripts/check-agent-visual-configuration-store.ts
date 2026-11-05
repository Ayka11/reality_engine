import assert from 'node:assert/strict'
import {
  AGENT_VISUAL_CONFIGURATION_STORAGE_KEY,
  AgentVisualConfigurationStore,
  validateAgentVisualConfiguration,
} from '../src/modes/agents/AgentVisualConfigurationStore.ts'
import { createPlanarAgentGridWorldTransform } from '../src/simulation/AgentGridWorldTransform.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()
  failGet = false
  failSet = false
  failRemove = false

  getItem(key: string) {
    if (this.failGet) throw new Error('storage read denied')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('storage quota exceeded')
    this.values.set(key, value)
  }

  removeItem(key: string) {
    if (this.failRemove) throw new Error('storage cleanup denied')
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()
const store = new AgentVisualConfigurationStore(storage)
const configuration = {
  schemaVersion: 'agent-visual-configuration-v1',
  sourceAssetId: 'polyhaven-oak-character',
  profile: {
    schemaVersion: 'agent-visual-profile-v1',
    semanticEntryId: 'fauna.creature',
    scale: 0.85,
    fadeDuration: 0.2,
    clips: {
      idle: 'Idle',
      explore: 'Walk Cycle',
      seek_energy: 'Run',
    },
    fallbackClip: 'Idle',
  },
  transform: createPlanarAgentGridWorldTransform(
    36,
    28,
    { x: 120, y: 5, z: -80 },
    2.5,
  ),
}

const validation = validateAgentVisualConfiguration(configuration)
assert.equal(validation.valid, true)
assert.deepEqual(validation.errors, [])
assert.ok(validation.configuration)

assert.equal(store.save(configuration), true)
assert.equal(storage.values.size, 1)
assert.equal(storage.values.has(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY), true)
const storedText = storage.values.get(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY)!
assert.ok(storedText.includes('polyhaven-oak-character'))
assert.ok(!storedText.includes('https://'),
  'saved preferences must not persist source URLs or initiate asset downloads')
assert.ok(!storedText.includes('runtimeUrl'),
  'saved preferences must contain no runtime asset URL')
assert.ok(!storedText.includes('glb'),
  'saved preferences must not contain model binaries or binary URLs')

const loaded = store.load()
assert.deepEqual(loaded, configuration,
  'saved visual profile, exact source identity and grid transform must round-trip')

loaded!.profile.clips!.explore = 'mutated-by-caller'
loaded!.transform.worldOrigin.x = -999
assert.deepEqual(store.load(), configuration,
  'loaded configuration must be detached from internal storage contents')

assert.equal(store.save({
  ...configuration,
  sourceAssetId: '',
}), false, 'invalid source identity must not overwrite a valid stored preference')
assert.deepEqual(store.load(), configuration)

assert.equal(validateAgentVisualConfiguration({
  ...configuration,
  transform: { ...configuration.transform, gridBasis: {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 2, y: 0, z: 0 },
    z: { x: 0, y: 0, z: 1 },
  } },
}).valid, false, 'non-invertible transforms must not be persisted')

storage.values.set(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY, '{malformed json')
assert.equal(store.load(), null)
assert.equal(storage.values.has(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY), false,
  'corrupted JSON must be rejected and removed')

storage.values.set(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY, JSON.stringify({
  ...configuration,
  sourceAssetId: 123,
}))
assert.equal(store.load(), null)
assert.equal(storage.values.has(AGENT_VISUAL_CONFIGURATION_STORAGE_KEY), false,
  'wrongly typed payloads must be rejected and removed')

assert.equal(store.save(configuration), true)
storage.failGet = true
assert.equal(store.load(), null, 'storage read failures must not escape into the app')
storage.failGet = false
storage.failSet = true
assert.equal(store.save(configuration), false, 'storage quota failures must report unsaved preferences')
storage.failSet = false
storage.failRemove = true
assert.equal(store.clear(), false, 'storage cleanup failures must be reported without throwing')
storage.failRemove = false
assert.equal(store.clear(), true)
assert.equal(store.load(), null)

const unavailable = new AgentVisualConfigurationStore(null)
assert.equal(unavailable.save(configuration), false)
assert.equal(unavailable.load(), null)
assert.equal(unavailable.clear(), false)

console.log('Agent visual configuration store schema, round-trip, source identity, detached reads, corruption cleanup and storage failure handling: PASS')
