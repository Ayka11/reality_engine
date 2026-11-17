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

  #prepareEntry(entry: WorldLibraryEntry): WorldLibraryEntry {
    if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error('World Library entry requires an id');
    }
    if (typeof entry.name !== 'string' || !entry.name.trim() ||
        typeof entry.description !== 'string' ||
        !new Set<WorldLibraryCategory>([
          'terrain', 'geology', 'water', 'climate', 'biome', 'flora', 'fauna',
          'resource', 'structure', 'infrastructure', 'settlement', 'civilization',
          'anomaly', 'celestial', 'phenomenon',
        ]).has(entry.category) ||
        !['micro', 'small', 'medium', 'large', 'planetary'].includes(entry.scale) ||
        !['common', 'uncommon', 'rare', 'legendary'].includes(entry.rarity)) {
      throw new TypeError('World Library entry requires valid name, description, category, scale, and rarity fields');
    }
    if (!Array.isArray(entry.tags) || entry.tags.some(tag => typeof tag !== 'string')) {
      throw new TypeError('World Library entry tags must be an array of strings');
    }
    const stringArrayFields = [
      'compatibleWith', 'conflictsWith', 'produces', 'requires', 'simulationHooks', 'variants',
    ] as const;
    for (const field of stringArrayFields) {
      const value = entry[field];
      if (value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
        throw new TypeError(`World Library entry ${field} must be an array of strings`);
      }
    }
    if (entry.visualKind !== undefined && typeof entry.visualKind !== 'string') {
      throw new TypeError('World Library entry visualKind must be a string');
    }
    if (entry.conditions !== undefined) {
      if (!entry.conditions || typeof entry.conditions !== 'object' || Array.isArray(entry.conditions)) {
        throw new TypeError('World Library entry conditions must be a record');
      }
      if (entry.conditions.biome !== undefined &&
          (!Array.isArray(entry.conditions.biome) || entry.conditions.biome.some(item => typeof item !== 'string'))) {
        throw new TypeError('World Library biome conditions must be an array of strings');
      }
      const conditionKeys = ['temperature', 'moisture', 'elevation', 'slope', 'radiation', 'stability'] as const;
      for (const key of conditionKeys) {
        const condition = entry.conditions[key];
        if (condition === undefined) continue;
        if (!condition || typeof condition !== 'object' || Array.isArray(condition) ||
            (condition.min !== undefined && !Number.isFinite(condition.min)) ||
            (condition.max !== undefined && !Number.isFinite(condition.max)) ||
            (condition.min !== undefined && condition.max !== undefined && condition.min > condition.max) ||
            (condition.tags !== undefined &&
              (!Array.isArray(condition.tags) || condition.tags.some(tag => typeof tag !== 'string')))) {
          throw new TypeError(`World Library ${key} condition is invalid`);
        }
      }
    }
    return structuredClone(entry);
  }

  register(entry: WorldLibraryEntry): WorldLibraryEntry {
    const stored = this.#prepareEntry(entry);
    this.#entries.set(stored.id, stored);
    return structuredClone(stored);
  }

  registerMany(entries: WorldLibraryEntry[]): number {
    if (!Array.isArray(entries)) throw new TypeError('World Library batch registration requires an array');
    const next = new Map(this.#entries);
    for (const entry of entries) {
      const stored = this.#prepareEntry(entry);
      next.set(stored.id, stored);
    }
    // Publish the candidate catalogue only after every entry has cloned and validated.
    this.#entries = next;
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
