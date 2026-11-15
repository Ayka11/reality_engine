import assert from 'node:assert/strict'
import { FieldSampler } from '../src/infinity/FieldSampler'
import { FlatWorldSurfaceProvider } from '../src/infinity/WorldSurfaceProvider'
import { DeterministicWorldFieldChunkProvider } from '../src/infinity/DeterministicWorldFieldChunkProvider'
import { WorldFieldChunkStore } from '../src/infinity/WorldFieldChunkStore'
import type { ScientificFieldProvider } from '../src/infinity/ScientificFieldProvider'
import type { ScientificFieldSample } from '../src/infinity/FieldSampler'
import type { WorldGenerator } from '../src/infinity/WorldGenerator'

const shared: ScientificFieldSample = {
  energy: 1, density: 0.2, information: 3, entropy: 0.1,
  temperature: 0.5, biology: 0.4, material: 0.7,
}
const provider: ScientificFieldProvider = {
  id: 'shared-sample-provider',
  version: 'shared-sample-v1',
  sample: () => shared,
}

// FieldSampler is the public scientific sampling boundary. A provider may reuse
// a scratch object internally; mutating the returned value must not mutate it.
{
  const sampler = new FieldSampler(
    {} as WorldGenerator,
    provider,
    new FlatWorldSurfaceProvider(),
  )
  const first = sampler.sample(1, 2, 3)
  first.energy = 901
  first.density = 902
  assert.equal(shared.energy, 1)
  assert.equal(shared.density, 0.2)
  assert.equal(sampler.sample(1, 2, 3).energy, 1)

  const world = sampler.sampleWorld(1, 2, 3)
  world.energy = 903
  assert.equal(shared.energy, 1)
  assert.equal(sampler.sample(1, 2, 3).energy, 1)
}

// WorldFieldChunkStore.sample must not leak a provider-owned scratch sample.
{
  const store = new WorldFieldChunkStore(2)
  store.set({ cx: 0, cy: 0, cz: 0 }, 'seed', provider)
  const first = store.sample({ cx: 0, cy: 0, cz: 0 }, 1, 2, 3)!
  first.energy = 904
  first.material = 905
  assert.equal(shared.energy, 1)
  assert.equal(shared.material, 0.7)
  assert.equal(store.sample({ cx: 0, cy: 0, cz: 0 }, 1, 2, 3)!.energy, 1)
}

// Deterministic provider's out-of-bounds zero value must be fresh on every call.
{
  const deterministic = new DeterministicWorldFieldChunkProvider('seed', { cx: 0, cy: 0, cz: 0 })
  const first = deterministic.sample(-1, 0, 0)
  first.energy = 906
  first.density = 907
  const second = deterministic.sample(-1, 0, 0)
  assert.equal(second.energy, 0)
  assert.equal(second.density, 0)
  assert.notEqual(first, second)
}

console.log('World field sample ownership regressions: PASS')
console.log('PASS: FieldSampler.sample/sampleWorld return detached samples')
console.log('PASS: WorldFieldChunkStore.sample returns detached provider samples')
console.log('PASS: deterministic out-of-bounds zero samples do not share mutable state')
