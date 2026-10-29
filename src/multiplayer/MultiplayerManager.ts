import { PersistenceLayer } from './PersistenceLayer';
import { WorldSync } from './WorldSync';
import type { Participant } from './types';

export class MultiplayerManager {
  currentWorldId: string | null = null;
  participants = new Map<string, Participant>();

  constructor(private persistence: PersistenceLayer, private sync: WorldSync, private localUserId = `u-${Math.random().toString(36).slice(2,8)}`) {}

  async hostNewWorld(name: string) {
    const worldId = `${name.replace(/\s+/g,'-')}-${Math.random().toString(36).slice(2,6)}`;
    this.currentWorldId = worldId;
    const snapshot = this.captureFullState();
    await this.persistence.saveWorld(worldId, snapshot);
    this.sync.connect(worldId, this.localUserId);
    return worldId;
  }

  async joinWorld(worldId: string) {
    this.currentWorldId = worldId;
    this.sync.connect(worldId, this.localUserId);
    const state = await this.persistence.loadWorld(worldId);
    if (state) this.applyWorldState(state);
    return state;
  }

  captureFullState() {
    // integration point: capture grid, graph, laws, and metadata
    return { timestamp: Date.now(), meta: { note: 'snapshot' } };
  }

  applyWorldState(state: any) {
    // integration point: apply loaded state to local runtime
    console.log('Applying world state', state);
  }
}
