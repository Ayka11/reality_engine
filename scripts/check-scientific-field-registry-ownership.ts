import assert from 'node:assert/strict'
import { ScientificFieldRegistry } from '../src/infinity/ScientificFieldRegistry'
import type { ScientificFieldProvider } from '../src/infinity/ScientificFieldProvider'

const sharedState = { bias: 4 }
const provider: ScientificFieldProvider & { bias: number } = {
  id: 'mutable-provider-id',
  version: 'mutable-provider-v1',
  bias: sharedState.bias,
  sample(x, y, z) {
    return {
      energy: this.bias + x + y + z,
      density: 0.2,
      information: 1,
      entropy: 0.1,
      temperature: 0.5,
      biology: 0.3,
      material: 0.7,
    }
  },
}

const registry = new ScientificFieldRegistry()
const registered = registry.register(provider, true)
assert.equal(registered.id, 'mutable-provider-id')
assert.equal(registered.version, 'mutable-provider-v1')
assert.equal(Object.isFrozen(registered), true)
assert.equal(registry.getActive(), registered)
assert.equal(registry.get('mutable-provider-id'), registered)
assert.equal(registered.sample(1, 2, 3).energy, 10, 'captured sampler must preserve provider receiver')

// Mutating the source object's metadata or replacing its sample method must not
// rewrite the identity or callable installed in the registry.
provider.id = 'attacker-relabelled-provider'
provider.version = 'untracked-version'
provider.sample = () => ({
  energy: 999, density: 0, information: 0, entropy: 0,
  temperature: 0, biology: 0, material: 0,
})
assert.equal(registry.activeProviderId, 'mutable-provider-id')
assert.deepEqual(registry.list(), [
  { id: 'mutable-provider-id', version: 'mutable-provider-v1', active: true },
])
assert.equal(registry.getActive()?.id, 'mutable-provider-id')
assert.equal(registry.getActive()?.version, 'mutable-provider-v1')
assert.equal(registry.getActive()?.sample(1, 2, 3).energy, 10)

// A new invalid registration must fail without replacing the valid active entry.
assert.throws(() => registry.register({ id: ' ', version: 'v1', sample: () => registered.sample(0, 0, 0) }), /requires non-empty id\/version and sample/)
assert.equal(registry.getActive(), registered)
assert.equal(registry.activate('missing-provider'), false)

const second: ScientificFieldProvider = {
  id: 'second-provider',
  version: 'second-v1',
  sample: () => ({
    energy: 2, density: 0, information: 0, entropy: 0,
    temperature: 0, biology: 0, material: 0,
  }),
}
registry.register(second)
assert.equal(registry.activeProviderId, 'mutable-provider-id', 'non-activating registration must preserve active selection')
assert.equal(registry.unregister('mutable-provider-id'), true)
assert.equal(registry.activeProviderId, 'second-provider', 'active removal must select the next registered provider')
assert.equal(registry.getActive()?.sample(0, 0, 0).energy, 2)

console.log('Scientific field registry provider identity regression: PASS')
