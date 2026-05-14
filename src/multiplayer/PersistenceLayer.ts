export class PersistenceLayer {
  private db: any = null;

  constructor(provider?: any) {
    this.db = provider ?? null;
  }

  async saveWorld(worldId: string, snapshot: any) {
    // v1: save to IndexedDB via idb if available, else use localStorage as fallback
    try {
      if (this.db && this.db.put) {
        await this.db.put('worlds', { id: worldId, snapshot, version: Date.now() });
      } else {
        localStorage.setItem(`world:${worldId}:latest`, JSON.stringify({ snapshot, version: Date.now() }));
      }
      return true;
    } catch (e) {
      console.error('PersistenceLayer.saveWorld error', e);
      return false;
    }
  }

  async loadWorld(worldId: string, version?: number) {
    try {
      const key = version ? `world:${worldId}:v:${version}` : `world:${worldId}:latest`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.snapshot;
    } catch (e) {
      console.error('PersistenceLayer.loadWorld error', e);
      return null;
    }
  }

  async forkWorld(originalId: string, newName: string): Promise<string> {
    const snapshot = await this.loadWorld(originalId);
    const newId = `${newName.replace(/\s+/g, '-')}-${Math.random().toString(36).slice(2,8)}`;
    await this.saveWorld(newId, snapshot);
    return newId;
  }
}
