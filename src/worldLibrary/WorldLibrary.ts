/**
 * Reality Engine — World Library core schema and registry.
 *
 * The library is intentionally data-first: entries describe what a world
 * element IS and under which conditions it can exist. Rendering and simulation
 * remain separate consumers of the same catalogue.
 */

export type WorldLibraryCategory =
  | 'terrain'
  | 'geology'
  | 'water'
  | 'climate'
  | 'biome'
  | 'flora'
  | 'fauna'
  | 'resource'
  | 'structure'
  | 'infrastructure'
  | 'settlement'
  | 'civilization'
  | 'anomaly'
  | 'celestial'
  | 'phenomenon';

export type WorldCondition = {
  min?: number;
  max?: number;
  tags?: string[];
};

export type WorldLibraryEntry = {
  id: string;
  name: string;
  category: WorldLibraryCategory;
  description: string;
  tags: string[];
  scale: 'micro' | 'small' | 'medium' | 'large' | 'planetary';
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  conditions?: {
    temperature?: WorldCondition;
    moisture?: WorldCondition;
    elevation?: WorldCondition;
    slope?: WorldCondition;
    radiation?: WorldCondition;
    stability?: WorldCondition;
    biome?: string[];
  };
  compatibleWith?: string[];
  conflictsWith?: string[];
  produces?: string[];
  requires?: string[];
  visualKind?: string;
  simulationHooks?: string[];
  variants?: string[];
};

export type WorldLibraryQuery = {
  category?: WorldLibraryCategory;
  tags?: string[];
  rarity?: WorldLibraryEntry['rarity'];
  biome?: string;
  visualKind?: string;
  search?: string;
};

export class WorldLibrary {
  #entries = new Map<string, WorldLibraryEntry>();

  constructor(entries: WorldLibraryEntry[] = []) {
    entries.forEach((entry) => this.register(entry));
    Object.freeze(this);
  }

  register(entry: WorldLibraryEntry): WorldLibraryEntry {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error('World Library entry requires an id');
    }
    const stored = structuredClone(entry);
    this.#entries.set(stored.id, stored);
    return structuredClone(stored);
  }

  registerMany(entries: WorldLibraryEntry[]): number {
    entries.forEach((entry) => this.register(entry));
    return entries.length;
  }

  get(id: string): WorldLibraryEntry | undefined {
    const entry = this.#entries.get(id);
    return entry ? structuredClone(entry) : undefined;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  all(): WorldLibraryEntry[] {
    return structuredClone([...this.#entries.values()]);
  }

  query(query: WorldLibraryQuery = {}): WorldLibraryEntry[] {
    return this.all().filter((entry) => {
      if (query.category && entry.category !== query.category) return false;
      if (query.rarity && entry.rarity !== query.rarity) return false;
      if (query.visualKind && entry.visualKind !== query.visualKind) return false;
      if (query.search) {
        const needle = query.search.toLowerCase().trim();
        if (needle && ![entry.id, entry.name, entry.description, ...entry.tags].join(' ').toLowerCase().includes(needle)) return false;
      }
      if (query.tags?.length && !query.tags.every((tag) => entry.tags.includes(tag))) {
        return false;
      }
      if (query.biome && !entry.conditions?.biome?.includes(query.biome)) {
        return false;
      }
      return true;
    });
  }

  categories(): WorldLibraryCategory[] {
    return [...new Set(this.all().map((entry) => entry.category))];
  }

  stats() {
    const byCategory = Object.fromEntries(
      this.categories().map((category) => [
        category,
        this.query({ category }).length,
      ]),
    ) as Record<WorldLibraryCategory, number>;

    return {
      total: this.#entries.size,
      categories: byCategory,
    };
  }
}

export function createWorldLibrary(entries: WorldLibraryEntry[] = []): WorldLibrary {
  return new WorldLibrary(entries);
}
