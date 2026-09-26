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
  private readonly rules = new Map<string, WorldRule>();

  add(rule: WorldRule): WorldRule {
    if (!rule.id || !rule.from || !rule.to) {
      throw new Error('World rule requires id, from and to');
    }
    this.rules.set(rule.id, rule);
    return rule;
  }

  addMany(rules: WorldRule[]): number {
    rules.forEach((rule) => this.add(rule));
    return rules.length;
  }

  get(id: string): WorldRule | undefined {
    return this.rules.get(id);
  }

  all(): WorldRule[] {
    return [...this.rules.values()];
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
      total: this.rules.size,
      relations: byRelation,
    };
  }
}

export function createWorldRuleGraph(rules: WorldRule[] = []): WorldRuleGraph {
  return new WorldRuleGraph(rules);
}
