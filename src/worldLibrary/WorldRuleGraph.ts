import type { WorldLibraryEntry } from './WorldLibrary';
import { worldLibrary } from './registry';

export type WorldRuleRelation =
  | 'requires'
  | 'enables'
  | 'supports'
  | 'produces'
  | 'conflicts'
  | 'compatible'
  | 'transforms';

export type WorldRule = {
  id: string;
  from: string;
  relation: WorldRuleRelation;
  to: string;
  weight?: number;
  conditions?: Record<string, string | number | boolean>;
  description?: string;
};

export type WorldRuleQuery = {
  from?: string;
  to?: string;
  relation?: WorldRuleRelation;
};

export class WorldRuleGraph {
  #rules = new Map<string, WorldRule>();

  constructor(rules: WorldRule[] = []) {
    this.addMany(rules)
    Object.freeze(this)
  }

  add(rule: WorldRule): WorldRule {
    if (!rule || typeof rule.id !== 'string' || !rule.id.trim() ||
        typeof rule.from !== 'string' || !rule.from.trim() ||
        typeof rule.to !== 'string' || !rule.to.trim()) {
      throw new Error('World rule requires id, from and to');
    }
    const stored = structuredClone(rule);
    this.#rules.set(stored.id, stored);
    return structuredClone(stored);
  }

  addMany(rules: WorldRule[]): number {
    rules.forEach((rule) => this.add(rule));
    return rules.length;
  }

  get(id: string): WorldRule | undefined {
    const rule = this.#rules.get(id);
    return rule ? structuredClone(rule) : undefined;
  }

  all(): WorldRule[] {
    return structuredClone([...this.#rules.values()]);
  }

  query(query: WorldRuleQuery = {}): WorldRule[] {
    return this.all().filter((rule) => {
      if (query.from && rule.from !== query.from) return false;
      if (query.to && rule.to !== query.to) return false;
      if (query.relation && rule.relation !== query.relation) return false;
      return true;
    });
  }

  outgoing(from: string, relation?: WorldRuleRelation): WorldRule[] {
    return this.query({ from, relation });
  }

  incoming(to: string, relation?: WorldRuleRelation): WorldRule[] {
    return this.query({ to, relation });
  }

  related(from: string): WorldLibraryEntry[] {
    const ids = this.outgoing(from).map((rule) => rule.to);
    return ids
      .map((id) => worldLibrary.get(id))
      .filter((entry): entry is WorldLibraryEntry => Boolean(entry));
  }

  stats() {
    const byRelation = Object.fromEntries(
      [...new Set(this.all().map((rule) => rule.relation))].map((relation) => [
        relation,
        this.query({ relation }).length,
      ]),
    );

    return {
      total: this.#rules.size,
      relations: byRelation,
    };
  }
}

export function createWorldRuleGraph(rules: WorldRule[] = []): WorldRuleGraph {
  return new WorldRuleGraph(rules);
}
