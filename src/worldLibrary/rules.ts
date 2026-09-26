import type { WorldRule } from './WorldRuleGraph';

export const WORLD_RULES: WorldRule[] = [
  { id: 'river-supports-fish', from: 'water.river', relation: 'supports', to: 'fauna.fish' },
  { id: 'river-supports-village', from: 'water.river', relation: 'supports', to: 'settlement.village' },
  { id: 'river-enables-bridge', from: 'water.river', relation: 'enables', to: 'infrastructure.bridge' },
  { id: 'river-enables-agriculture', from: 'water.river', relation: 'enables', to: 'civilization.agricultural' },

  { id: 'forest-supports-oak', from: 'biome.forest', relation: 'supports', to: 'flora.tree.oak' },
  { id: 'forest-supports-pine', from: 'biome.forest', relation: 'supports', to: 'flora.tree.pine' },
  { id: 'forest-supports-deer', from: 'biome.forest', relation: 'supports', to: 'fauna.deer' },
  { id: 'forest-supports-wolf', from: 'biome.forest', relation: 'supports', to: 'fauna.wolf' },
  { id: 'forest-supports-village', from: 'biome.forest', relation: 'supports', to: 'settlement.village' },
  { id: 'forest-produces-wood', from: 'biome.forest', relation: 'produces', to: 'resource.wood' },

  { id: 'jungle-supports-palm', from: 'biome.jungle', relation: 'supports', to: 'flora.tree.palm' },
  { id: 'jungle-supports-insects', from: 'biome.jungle', relation: 'supports', to: 'fauna.insect-swarm' },

  { id: 'desert-supports-cactus', from: 'biome.desert', relation: 'supports', to: 'flora.cactus' },
  { id: 'desert-conflicts-oak', from: 'biome.desert', relation: 'conflicts', to: 'flora.tree.oak' },
  { id: 'desert-enables-nomadic-village', from: 'biome.desert', relation: 'supports', to: 'settlement.village' },

  { id: 'tundra-supports-pine', from: 'biome.tundra', relation: 'supports', to: 'flora.tree.pine' },
  { id: 'tundra-supports-wolf', from: 'biome.tundra', relation: 'supports', to: 'fauna.wolf' },

  { id: 'mountain-produces-ore', from: 'terrain.mountain', relation: 'produces', to: 'resource.iron' },
  { id: 'mountain-produces-stone', from: 'terrain.mountain', relation: 'produces', to: 'resource.stone' },
  { id: 'mountain-enables-mine', from: 'terrain.mountain', relation: 'enables', to: 'structure.research-station' },

  { id: 'ore-enables-industry', from: 'resource.iron', relation: 'enables', to: 'civilization.industrial' },
  { id: 'wood-enables-agriculture', from: 'resource.wood', relation: 'enables', to: 'civilization.agricultural' },
  { id: 'water-supports-agriculture', from: 'resource.water', relation: 'enables', to: 'civilization.agricultural' },

  { id: 'village-enables-town', from: 'settlement.village', relation: 'transforms', to: 'settlement.town' },
  { id: 'town-enables-city', from: 'settlement.town', relation: 'transforms', to: 'settlement.city' },
  { id: 'city-enables-industry', from: 'settlement.city', relation: 'enables', to: 'civilization.industrial' },
  { id: 'city-requires-road', from: 'settlement.city', relation: 'requires', to: 'infrastructure.road' },

  { id: 'ocean-enables-harbor', from: 'water.ocean', relation: 'enables', to: 'infrastructure.harbor' },
  { id: 'harbor-supports-city', from: 'infrastructure.harbor', relation: 'supports', to: 'settlement.city' },

  { id: 'crystal-produces-resonance', from: 'resource.crystal', relation: 'produces', to: 'phenomenon.resonance' },
  { id: 'resonance-enables-advanced-civilization', from: 'phenomenon.resonance', relation: 'enables', to: 'civilization.post-scarcity' },
  { id: 'gravity-conflicts-stable', from: 'anomaly.gravity-well', relation: 'conflicts', to: 'settlement.city' },
  { id: 'quantum-enables-research', from: 'anomaly.quantum-emitter', relation: 'enables', to: 'structure.research-station' },
];
