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
  #mutationObserver: (() => void) | null = null;

  /** Bind the owning engine's stale-readback invalidation hook exactly once. */
  bindMutationObserver(observer: () => void): void {
    if (typeof observer !== "function") {
      throw new TypeError("Mutation observer must be a function");
    }
    if (this.#mutationObserver !== null) {
      throw new Error("Mutation observer is already bound");
    }
    this.#mutationObserver = observer;
  }

  #notifyMutation(): void { this.#mutationObserver?.(); }

  snapshot(): CausalGraphSnapshot {
    return {
      events: this.events.map(event => ({ ...event })),
      nextId: this.nextId,
      lastEventByCell: [...this.lastEventByCell.entries()].map(([cellIndex, eventId]) => [cellIndex, eventId] as [number, number]),
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

    const events: CausalEvent[] = [];
    const ids = new Set<number>();
    let previousId = 0;
    for (const event of snapshot.events) {
      if (!event ||
          !Number.isSafeInteger(event.id) || event.id < 1 ||
          !Number.isSafeInteger(event.tick) || event.tick < 0 ||
          ![event.x, event.y, event.z].every(Number.isSafeInteger) ||
          event.x < 0 || event.y < 0 || event.z < 0 ||
          !CAUSAL_EVENT_TYPES.includes(event.type) ||
          !Number.isFinite(event.delta) ||
          (event.parentId !== undefined &&
            (!Number.isSafeInteger(event.parentId) ||
              event.parentId < 1 ||
              event.parentId >= event.id)) ||
          event.id >= snapshot.nextId ||
          event.id <= previousId ||
          ids.has(event.id)) {
        throw new Error("Invalid CausalGraph event");
      }
      previousId = event.id;
      ids.add(event.id);
      events.push({ ...event });
    }

    const lastEventByCell = new Map<number, number>();
    for (const entry of snapshot.lastEventByCell) {
      if (!Array.isArray(entry) ||
          entry.length !== 2 ||
          !Number.isSafeInteger(entry[0]) ||
          entry[0] < 0 ||
          !Number.isSafeInteger(entry[1]) ||
          entry[1] < 1 ||
          entry[1] >= snapshot.nextId ||
          lastEventByCell.has(entry[0])) {
        throw new Error("Invalid CausalGraph cell index");
      }
      lastEventByCell.set(entry[0], entry[1]);
    }

    // All validation and deep copies finish before any live field is replaced.
    this.events = events;
    this.nextId = snapshot.nextId;
    this.lastEventByCell = lastEventByCell;
    this.#notifyMutation();
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
    this.#notifyMutation();
    return { ...ev };
  }

  recent(n: number): CausalEvent[] {
    return this.events.slice(-n).map(event => ({ ...event })).reverse();
  }

  chainFrom(eventId: number): CausalEvent[] {
    const chain: CausalEvent[] = [];
    let current = this.events.find(e => e.id === eventId);
    while (current) {
      chain.push({ ...current });
      const parent = current.parentId;
      current = parent ? this.events.find(e => e.id === parent) : undefined;
    }
    return chain;
  }

  clear(): void {
    this.events = [];
    this.lastEventByCell.clear();
    this.nextId = 1;
    this.#notifyMutation();
  }
}
