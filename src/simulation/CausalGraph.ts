export interface CausalEvent {
  id: number;
  tick: number;
  x: number; y: number; z: number;
  type: 'energy_spike' | 'info_bloom' | 'entropy_burst' | 'bio_emergence' | 'phase_transition';
  delta: number;
  parentId?: number;
}


export interface CausalGraphSnapshot {
  events: CausalEvent[];
  nextId: number;
  lastEventByCell: Array<[number, number]>;
}

const CAUSAL_EVENT_TYPES: readonly CausalEvent["type"][] = [
  "energy_spike",
  "info_bloom",
  "entropy_burst",
  "bio_emergence",
  "phase_transition",
];

export class CausalGraph {
  private events: CausalEvent[] = [];
  private nextId = 1;
  private lastEventByCell = new Map<number, number>();

  snapshot(): CausalGraphSnapshot {
    return {
      events: this.events.map(event => ({ ...event })),
      nextId: this.nextId,
      lastEventByCell: [...this.lastEventByCell.entries()],
    };
  }

  restore(snapshot: CausalGraphSnapshot): void {
    if (!snapshot ||
        !Array.isArray(snapshot.events) ||
        snapshot.events.length > 500 ||
        !Number.isSafeInteger(snapshot.nextId) ||
        snapshot.nextId < 1 ||
        !Array.isArray(snapshot.lastEventByCell)) {
      throw new Error("Invalid CausalGraph snapshot");
    }

    const events = snapshot.events.map(event => {
      if (!event ||
          !Number.isSafeInteger(event.id) || event.id < 1 ||
          !Number.isSafeInteger(event.tick) || event.tick < 0 ||
          ![event.x, event.y, event.z].every(Number.isSafeInteger) ||
          event.x < 0 || event.y < 0 || event.z < 0 ||
          !CAUSAL_EVENT_TYPES.includes(event.type) ||
          !Number.isFinite(event.delta) ||
          (event.parentId !== undefined &&
            (!Number.isSafeInteger(event.parentId) || event.parentId < 1)) ||
          event.id >= snapshot.nextId) {
        throw new Error("Invalid CausalGraph event");
      }
      return { ...event };
    });
    const ids = new Set<number>();
    for (const event of events) {
      if (ids.has(event.id)) throw new Error("Duplicate CausalGraph event id");
      ids.add(event.id);
    }

    const lastEventByCell = new Map<number, number>();
    for (const entry of snapshot.lastEventByCell) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          !Number.isSafeInteger(entry[0]) || entry[0] < 0 ||
          !Number.isSafeInteger(entry[1]) || entry[1] < 1 ||
          entry[1] >= snapshot.nextId ||
          lastEventByCell.has(entry[0])) {
        throw new Error("Invalid CausalGraph cell index");
      }
      lastEventByCell.set(entry[0], entry[1]);
    }

    this.events = events;
    this.nextId = snapshot.nextId;
    this.lastEventByCell = lastEventByCell;
  }

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
