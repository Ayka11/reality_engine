import type { WorldEnvironment } from './WorldEnvironmentResolver';

export type BiomeDefinition = {
  id: string;
  name: string;
  description: string;
  environment: {
    temperature: [number, number];
    moisture: [number, number];
    elevation: [number, number];
    slope: [number, number];
  };
  preferredElements: string[];
};

export const BIOME_DEFINITIONS: BiomeDefinition[] = [
  {
    id: 'biome.forest',
    name: 'Temperate Forest',
    description: 'Moderate temperature, moderate-to-high moisture and mixed terrain.',
    environment: { temperature: [0.35, 0.7], moisture: [0.5, 0.9], elevation: [0.1, 0.7], slope: [0, 0.65] },
    preferredElements: ['flora.tree.oak', 'flora.tree.pine', 'fauna.deer', 'fauna.wolf', 'resource.wood'],
  },
  {
    id: 'biome.jungle',
    name: 'Tropical Jungle',
    description: 'Warm, humid, high-biomass environment.',
    environment: { temperature: [0.65, 1], moisture: [0.65, 1], elevation: [0, 0.55], slope: [0, 0.7] },
    preferredElements: ['flora.tree.palm', 'flora.mushroom', 'fauna.insect-swarm', 'water.river'],
  },
  {
    id: 'biome.desert',
    name: 'Desert',
    description: 'Hot or warm, very dry environment.',
    environment: { temperature: [0.45, 1], moisture: [0, 0.3], elevation: [0, 0.8], slope: [0, 0.8] },
    preferredElements: ['flora.cactus', 'terrain.dune', 'resource.stone', 'settlement.village'],
  },
  {
    id: 'biome.tundra',
    name: 'Tundra',
    description: 'Cold environment with low vegetation density.',
    environment: { temperature: [0, 0.25], moisture: [0.15, 0.7], elevation: [0, 0.9], slope: [0, 0.8] },
    preferredElements: ['flora.tree.pine', 'fauna.wolf', 'terrain.mountain'],
  },
  {
    id: 'biome.wetland',
    name: 'Wetland',
    description: 'Very moist lowland ecosystem.',
    environment: { temperature: [0.2, 0.8], moisture: [0.75, 1], elevation: [0, 0.35], slope: [0, 0.25] },
    preferredElements: ['water.lake', 'water.river', 'fauna.fish', 'flora.mushroom'],
  },
];

export function classifyBiome(environment: WorldEnvironment): BiomeDefinition | undefined {
  const matches = BIOME_DEFINITIONS.filter((biome) => {
    const e = biome.environment;
    return (
      environment.temperature >= e.temperature[0] &&
      environment.temperature <= e.temperature[1] &&
      environment.moisture >= e.moisture[0] &&
      environment.moisture <= e.moisture[1] &&
      environment.elevation >= e.elevation[0] &&
      environment.elevation <= e.elevation[1] &&
      environment.slope >= e.slope[0] &&
      environment.slope <= e.slope[1]
    );
  });

  return matches[0];
}
