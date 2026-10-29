import type { ScientificFieldProvider } from './ScientificFieldProvider'

export class ScientificFieldRegistry {
  private providers = new Map<string, ScientificFieldProvider>()
  private activeId: string | null = null

  register(provider: ScientificFieldProvider, activate = false) {
    this.providers.set(provider.id, provider)
    if (activate || this.activeId === null) this.activeId = provider.id
    return provider
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
