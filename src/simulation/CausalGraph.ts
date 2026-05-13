export interface CausalEvent {
  id: number;
  tick: number;
  x: number; y: number; z: number;
  type: 'energy_spike' | 'info_bloom' | 'entropy_burst' | 'bio_emergence' | 'phase_transition';
  delta: number;
  parentId?: number;
}

export class CausalGraph {
  private events: CausalEvent[] = [];
  private nextId = 1;
  private lastEventByCell = new Map<number, number>();

  log(
    tick: number,
    x: number, y: number, z: number,
    cellIdx: number,
    type: CausalEvent['type'],
    delta: number
  ): CausalEvent {
    const parentId = this.lastEventByCell.get(cellIdx);
    const ev: CausalEvent = { id: this.nextId++, tick, x, y, z, type, delta, parentId };
    this.events.push(ev);
    this.lastEventByCell.set(cellIdx, ev.id);
    if (this.events.length > 500) this.events.shift();
    return ev;
  }

  recent(n: number): CausalEvent[] {
    return this.events.slice(-n).reverse();
  }

  chainFrom(eventId: number): CausalEvent[] {
    const chain: CausalEvent[] = [];
    let current = this.events.find(e => e.id === eventId);
    while (current) {
      chain.push(current);
      const parent = current.parentId;
      current = parent ? this.events.find(e => e.id === parent) : undefined;
    }
    return chain;
  }

  clear(): void { this.events = []; this.lastEventByCell.clear(); this.nextId = 1; }
}
