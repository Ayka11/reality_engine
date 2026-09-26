import { classifyBiome, type BiomeDefinition } from './BiomeEngine';
import { worldEnvironmentResolver, type WorldEnvironment, type ResolvedWorldElement } from './WorldEnvironmentResolver';

export type WorldGenerationPlan = {
  environment: WorldEnvironment;
  biome?: BiomeDefinition;
  elements: ResolvedWorldElement[];
  preferredElementIds: string[];
  generatedAt: number;
};

export function buildWorldGenerationPlan(environment: WorldEnvironment): WorldGenerationPlan {
  const biome = classifyBiome(environment);
  const resolved = worldEnvironmentResolver.resolve(
    biome ? { ...environment, biome: biome.id } : environment,
  );

  const related = biome
    ? worldEnvironmentResolver.related(
        { ...environment, biome: biome.id },
        biome.preferredElements,
      )
    : [];

  const merged = new Map<string, ResolvedWorldElement>();
  for (const item of resolved) merged.set(item.entry.id, item);
  for (const item of related) {
    const existing = merged.get(item.entry.id);
    if (!existing || item.score > existing.score) merged.set(item.entry.id, item);
  }

  return {
    environment,
    biome,
    elements: [...merged.values()].sort((a, b) => b.score - a.score),
    preferredElementIds: biome?.preferredElements ?? [],
    generatedAt: Date.now(),
  };
}
