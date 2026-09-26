import type { WorldLibraryEntry } from './WorldLibrary';
import { worldLibrary } from './registry';
import { worldRuleGraph } from './registry';

export type WorldEnvironment = {
  temperature: number;
  moisture: number;
  elevation: number;
  slope: number;
  radiation?: number;
  stability?: number;
  biome?: string;
};

export type ResolvedWorldElement = {
  entry: WorldLibraryEntry;
  score: number;
  reasons: string[];
};

function scoreCondition(
  value: number | undefined,
  condition: { min?: number; max?: number } | undefined,
): { score: number; reason?: string } {
  if (value === undefined || !condition) return { score: 1 };

  if (condition.min !== undefined && value < condition.min) return { score: 0 };
  if (condition.max !== undefined && value > condition.max) return { score: 0 };

  const span = (condition.max ?? 1) - (condition.min ?? 0);
  if (span <= 0) return { score: 1 };

  const center = ((condition.min ?? 0) + (condition.max ?? 1)) / 2;
  const distance = Math.abs(value - center) / span;
  return { score: Math.max(0.5, 1 - distance * 0.5) };
}

export class WorldEnvironmentResolver {
  resolve(environment: WorldEnvironment, category?: WorldLibraryEntry['category']): ResolvedWorldElement[] {
    const candidates = worldLibrary.query({ category });

    return candidates
      .map((entry) => {
        const reasons: string[] = [];
        let score = 1;

        for (const [key, value] of [
          ['temperature', environment.temperature],
          ['moisture', environment.moisture],
          ['elevation', environment.elevation],
          ['slope', environment.slope],
          ['radiation', environment.radiation],
          ['stability', environment.stability],
        ] as const) {
          const result = scoreCondition(value, entry.conditions?.[key]);
          if (result.score === 0) return null;
          score *= result.score;
          if (entry.conditions?.[key]) reasons.push(`${key} compatible`);
        }

        if (environment.biome && entry.conditions?.biome?.length) {
          if (!entry.conditions.biome.includes(environment.biome)) return null;
          score *= 1.25;
          reasons.push(`biome: ${environment.biome}`);
        }

        return { entry, score, reasons };
      })
      .filter((result): result is ResolvedWorldElement => Boolean(result))
      .sort((a, b) => b.score - a.score);
  }

  related(environment: WorldEnvironment, seedIds: string[] = []): ResolvedWorldElement[] {
    const direct = this.resolve(environment);
    const expanded = new Map<string, ResolvedWorldElement>();

    for (const result of direct) expanded.set(result.entry.id, result);

    for (const seedId of seedIds) {
      for (const rule of worldRuleGraph.outgoing(seedId)) {
        const entry = worldLibrary.get(rule.to);
        if (!entry || expanded.has(entry.id)) continue;

        expanded.set(entry.id, {
          entry,
          score: Math.min(1, (rule.weight ?? 0.75) * 0.9),
          reasons: [`rule: ${seedId} ${rule.relation} ${rule.to}`],
        });
      }
    }

    return [...expanded.values()].sort((a, b) => b.score - a.score);
  }
}

export const worldEnvironmentResolver = new WorldEnvironmentResolver();
