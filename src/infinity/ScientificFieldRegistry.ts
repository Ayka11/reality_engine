import type { ScientificFieldProvider } from './ScientificFieldProvider'

/**
 * Registry-owned provider facade.
 *
 * Provider services may hold mutable simulation state, but their registry
 * identity and sampling entry point must not be replaceable by a caller that
 * obtains a public registry reference. Capture id/version/sample at registration
 * and keep the original provider as the method receiver.
 */
function createRegisteredProvider(provider: ScientificFieldProvider): ScientificFieldProvider {
  if (!provider || typeof provider !== 'object' ||
      typeof provider.id !== 'string' || !provider.id.trim() ||
      typeof provider.version !== 'string' || !provider.version.trim() ||
      typeof provider.sample !== 'function') {
    throw new TypeError('Scientific field provider requires non-empty id/version and sample()')
  }

  const id = provider.id
  const version = provider.version
  const sample = provider.sample
  return Object.freeze({
    id,
    version,
    sample: (x: number, y: number, z: number) => sample.call(provider, x, y, z),
  })
}

export class ScientificFieldRegistry {
  private providers = new Map<string, ScientificFieldProvider>()
  private activeId: string | null = null

  register(provider: ScientificFieldProvider, activate = false) {
    const registered = createRegisteredProvider(provider)
    this.providers.set(registered.id, registered)
    if (activate || this.activeId === null) this.activeId = registered.id
    return registered
  }

  unregister(id: string) {
    const removed = this.providers.delete(id)
    if (this.activeId === id) {
      this.activeId = this.providers.keys().next().value ?? null
    }
    return removed
  }

  activate(id: string) {
    if (!this.providers.has(id)) return false
    this.activeId = id
    return true
  }

  getActive() {
    return this.activeId ? this.providers.get(this.activeId) : undefined
  }

  get(id: string) {
    return this.providers.get(id)
  }

  list() {
    return [...this.providers.values()].map(provider => ({
      id: provider.id,
      version: provider.version,
      active: provider.id === this.activeId,
    }))
  }

  get activeProviderId() {
    return this.activeId
  }
}
