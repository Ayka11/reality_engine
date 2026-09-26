import { WorldLibraryEntry } from './WorldLibrary';

const e = (
  id: string,
  name: string,
  category: WorldLibraryEntry['category'],
  description: string,
  tags: string[],
  visualKind: string,
  extra: Partial<WorldLibraryEntry> = {},
): WorldLibraryEntry => ({
  id,
  name,
  category,
  description,
  tags,
  scale: 'medium',
  rarity: 'common',
  visualKind,
  ...extra,
});

export const WORLD_LIBRARY_CATALOG: WorldLibraryEntry[] = [
  // TERRAIN / GEOLOGY
  e('terrain.plain', 'Plain', 'terrain', 'Broad low-relief terrain.', ['land', 'flat'], 'terrain.plain', { scale: 'large' }),
  e('terrain.hill', 'Hill', 'terrain', 'Rounded elevated terrain.', ['land', 'elevation'], 'terrain.hill', { scale: 'large' }),
  e('terrain.mountain', 'Mountain', 'terrain', 'Large steep elevation.', ['land', 'elevation', 'steep'], 'terrain.mountain', { scale: 'large', rarity: 'uncommon' }),
  e('terrain.canyon', 'Canyon', 'terrain', 'Deep erosional valley.', ['land', 'erosion', 'valley'], 'terrain.canyon', { scale: 'large', rarity: 'uncommon' }),
  e('terrain.dune', 'Dune Field', 'terrain', 'Wind-shaped granular terrain.', ['land', 'desert', 'wind'], 'terrain.dune', { scale: 'large', conditions: { moisture: { max: 0.3 } } }),
  e('terrain.crater', 'Impact Crater', 'terrain', 'Circular impact depression.', ['land', 'impact'], 'terrain.crater', { scale: 'large', rarity: 'rare' }),
  e('geology.granite', 'Granite Outcrop', 'geology', 'Exposed crystalline bedrock.', ['rock', 'igneous', 'resource'], 'rock.outcrop'),
  e('geology.basalt', 'Basalt Field', 'geology', 'Dark volcanic rock formation.', ['rock', 'volcanic', 'igneous'], 'rock.basalt'),
  e('geology.crystal', 'Crystal Formation', 'geology', 'Large exposed crystal cluster.', ['crystal', 'rare', 'exotic'], 'crystal.cluster', { rarity: 'rare', variants: ['quartz', 'amethyst', 'luminous'] }),
  e('geology.ore-vein', 'Ore Vein', 'geology', 'Mineral-bearing geological deposit.', ['ore', 'resource', 'underground'], 'resource.vein', { rarity: 'uncommon', produces: ['resource.metal'] }),

  // WATER / CLIMATE / BIOMES
  e('water.river', 'River', 'water', 'Connected flowing freshwater network.', ['water', 'flow', 'freshwater'], 'water.river', { scale: 'large', simulationHooks: ['hydrology.flow'] }),
  e('water.lake', 'Lake', 'water', 'Inland standing water body.', ['water', 'freshwater'], 'water.lake', { scale: 'large' }),
  e('water.ocean', 'Ocean', 'water', 'Planet-scale saline water body.', ['water', 'saltwater', 'planetary'], 'water.ocean', { scale: 'planetary' }),
  e('water.waterfall', 'Waterfall', 'water', 'Steep vertical flow transition.', ['water', 'flow', 'elevation'], 'water.waterfall', { rarity: 'uncommon' }),
  e('climate.rain', 'Rainfall', 'climate', 'Atmospheric precipitation process.', ['weather', 'water', 'cycle'], 'effect.rain', { simulationHooks: ['hydrology.precipitation'] }),
  e('climate.snow', 'Snowfall', 'climate', 'Frozen atmospheric precipitation.', ['weather', 'cold', 'water'], 'effect.snow'),
  e('biome.forest', 'Temperate Forest', 'biome', 'Moist woodland ecosystem.', ['biome', 'forest', 'temperate'], 'biome.forest', { scale: 'large' }),
  e('biome.jungle', 'Tropical Jungle', 'biome', 'Hot, humid high-biomass ecosystem.', ['biome', 'forest', 'tropical'], 'biome.jungle', { scale: 'large', conditions: { temperature: { min: 0.65 }, moisture: { min: 0.65 } } }),
  e('biome.desert', 'Desert', 'biome', 'Dry low-moisture ecosystem.', ['biome', 'desert', 'arid'], 'biome.desert', { scale: 'large', conditions: { moisture: { max: 0.3 } } }),
  e('biome.tundra', 'Tundra', 'biome', 'Cold low-tree ecosystem.', ['biome', 'cold', 'arctic'], 'biome.tundra', { scale: 'large', conditions: { temperature: { max: 0.25 } } }),
  e('biome.wetland', 'Wetland', 'biome', 'Water-saturated lowland ecosystem.', ['biome', 'wetland', 'water'], 'biome.wetland', { scale: 'large', conditions: { moisture: { min: 0.75 } } }),

  // FLORA
  e('flora.grass', 'Grass', 'flora', 'Low herbaceous vegetation.', ['plant', 'grass', 'common'], 'flora.grass', { scale: 'small' }),
  e('flora.tree.oak', 'Oak Tree', 'flora', 'Large temperate broadleaf tree.', ['plant', 'tree', 'temperate'], 'flora.tree', { scale: 'medium', conditions: { biome: ['biome.forest'] } }),
  e('flora.tree.pine', 'Pine Tree', 'flora', 'Conifer adapted to cool climates.', ['plant', 'tree', 'conifer'], 'flora.tree', { scale: 'medium', conditions: { biome: ['biome.forest', 'biome.tundra'] } }),
  e('flora.tree.palm', 'Palm Tree', 'flora', 'Warm-climate tropical tree.', ['plant', 'tree', 'tropical'], 'flora.tree', { scale: 'medium', conditions: { biome: ['biome.jungle'] } }),
  e('flora.cactus', 'Cactus', 'flora', 'Water-efficient desert plant.', ['plant', 'desert', 'arid'], 'flora.cactus', { scale: 'small', conditions: { biome: ['biome.desert'] } }),
  e('flora.mushroom', 'Mushroom Colony', 'flora', 'Fungal colony in moist environments.', ['plant', 'fungus', 'moist'], 'flora.mushroom', { scale: 'small', conditions: { moisture: { min: 0.6 } } }),

  // FAUNA
  e('fauna.deer', 'Deer', 'fauna', 'Medium terrestrial herbivore.', ['animal', 'herbivore', 'forest'], 'fauna.deer', { scale: 'medium', conditions: { biome: ['biome.forest'] } }),
  e('fauna.wolf', 'Wolf', 'fauna', 'Pack-oriented terrestrial predator.', ['animal', 'predator', 'forest'], 'fauna.wolf', { scale: 'medium', conditions: { biome: ['biome.forest', 'biome.tundra'] } }),
  e('fauna.eagle', 'Eagle', 'fauna', 'Large aerial predator.', ['animal', 'bird', 'predator'], 'fauna.eagle', { scale: 'medium' }),
  e('fauna.fish', 'Fish School', 'fauna', 'Aquatic population cluster.', ['animal', 'aquatic', 'water'], 'fauna.fish', { scale: 'medium', conditions: { biome: ['biome.wetland'] } }),
  e('fauna.insect-swarm', 'Insect Swarm', 'fauna', 'Dense mobile insect population.', ['animal', 'swarm', 'ecosystem'], 'fauna.swarm', { scale: 'medium', rarity: 'uncommon' }),

  // RESOURCES
  e('resource.wood', 'Timber Resource', 'resource', 'Renewable biomass resource from trees.', ['resource', 'wood', 'renewable'], 'resource.wood', { produces: ['resource.fuel'] }),
  e('resource.stone', 'Stone Deposit', 'resource', 'Common construction mineral.', ['resource', 'stone', 'construction'], 'resource.stone'),
  e('resource.iron', 'Iron Deposit', 'resource', 'Metal-bearing mineral resource.', ['resource', 'metal', 'industry'], 'resource.ore', { rarity: 'uncommon' }),
  e('resource.crystal', 'Exotic Crystal', 'resource', 'Rare crystal with anomalous properties.', ['resource', 'crystal', 'exotic'], 'resource.crystal', { rarity: 'rare', produces: ['phenomenon.resonance'] }),
  e('resource.water', 'Freshwater Reserve', 'resource', 'Accessible freshwater resource.', ['resource', 'water', 'essential'], 'resource.water'),

  // STRUCTURES / INFRASTRUCTURE
  e('structure.house', 'House', 'structure', 'Small residential building.', ['building', 'residential'], 'building.house', { scale: 'small' }),
  e('structure.tower', 'Tower', 'structure', 'Vertical landmark or defensive structure.', ['building', 'vertical', 'landmark'], 'building.tower', { rarity: 'uncommon' }),
  e('structure.temple', 'Temple', 'structure', 'Ceremonial architecture.', ['building', 'ceremonial', 'culture'], 'building.temple', { rarity: 'rare' }),
  e('structure.research-station', 'Research Station', 'structure', 'Scientific or exploratory facility.', ['building', 'science', 'technology'], 'building.station', { rarity: 'rare' }),
  e('infrastructure.road', 'Road', 'infrastructure', 'Land transport corridor.', ['transport', 'road', 'network'], 'road', { scale: 'large' }),
  e('infrastructure.bridge', 'Bridge', 'infrastructure', 'Crossing structure over a barrier.', ['transport', 'bridge', 'network'], 'bridge', { scale: 'medium', requires: ['water.river'] }),
  e('infrastructure.harbor', 'Harbor', 'infrastructure', 'Coastal transport and docking facility.', ['transport', 'water', 'trade'], 'harbor', { scale: 'large', requires: ['water.ocean'] }),
  e('infrastructure.power-grid', 'Power Grid', 'infrastructure', 'Energy distribution network.', ['energy', 'network', 'technology'], 'infrastructure.grid', { scale: 'large', rarity: 'uncommon' }),

  // SETTLEMENTS / CIVILIZATION
  e('settlement.village', 'Village', 'settlement', 'Small organized settlement.', ['settlement', 'residential', 'community'], 'settlement.village', { scale: 'large' }),
  e('settlement.town', 'Town', 'settlement', 'Medium-density settlement.', ['settlement', 'urban', 'community'], 'settlement.town', { scale: 'large' }),
  e('settlement.city', 'City', 'settlement', 'Large structured urban settlement.', ['settlement', 'urban', 'infrastructure'], 'settlement.city', { scale: 'large', rarity: 'uncommon' }),
  e('settlement.megacity', 'Megacity', 'settlement', 'Very high-density urban system.', ['settlement', 'urban', 'large-scale'], 'settlement.megacity', { scale: 'large', rarity: 'rare' }),
  e('civilization.agricultural', 'Agricultural Civilization', 'civilization', 'Society organized around agriculture.', ['civilization', 'agriculture', 'society'], 'civilization.agricultural', { scale: 'planetary' }),
  e('civilization.industrial', 'Industrial Civilization', 'civilization', 'Society with large-scale industrial systems.', ['civilization', 'industry', 'technology'], 'civilization.industrial', { scale: 'planetary', rarity: 'uncommon' }),
  e('civilization.post-scarcity', 'Post-Scarcity Civilization', 'civilization', 'Civilization with highly abundant automated resources.', ['civilization', 'technology', 'advanced'], 'civilization.post-scarcity', { scale: 'planetary', rarity: 'rare' }),

  // ANOMALIES / CELESTIAL / PHENOMENA
  e('anomaly.gravity-well', 'Gravity Well', 'anomaly', 'Localized gravitational distortion.', ['anomaly', 'gravity', 'field'], 'gravity.well', { rarity: 'rare', simulationHooks: ['physics.gravity'] }),
  e('anomaly.entropy-sink', 'Entropy Sink', 'anomaly', 'Localized reduction of effective entropy.', ['anomaly', 'entropy', 'field'], 'entropy.sink', { rarity: 'rare', simulationHooks: ['physics.entropy'] }),
  e('anomaly.quantum-emitter', 'Quantum Emitter', 'anomaly', 'Localized information/energy emission source.', ['anomaly', 'quantum', 'energy'], 'quantum.emitter', { rarity: 'rare' }),
  e('anomaly.force-field', 'Force Field', 'anomaly', 'Localized non-contact interaction field.', ['anomaly', 'force', 'field'], 'force.field', { rarity: 'uncommon' }),
  e('anomaly.resonance-node', 'Resonance Node', 'anomaly', 'Stable oscillatory information node.', ['anomaly', 'resonance', 'information'], 'resonance.node', { rarity: 'rare', produces: ['phenomenon.resonance'] }),
  e('celestial.star', 'Star', 'celestial', 'Stellar energy source.', ['celestial', 'star', 'energy'], 'celestial.star', { scale: 'planetary' }),
  e('celestial.moon', 'Moon', 'celestial', 'Natural satellite.', ['celestial', 'satellite'], 'celestial.moon', { scale: 'planetary' }),
  e('celestial.asteroid', 'Asteroid', 'celestial', 'Small rocky celestial body.', ['celestial', 'rock', 'impact'], 'celestial.asteroid', { scale: 'large', rarity: 'uncommon' }),
  e('phenomenon.aurora', 'Aurora', 'phenomenon', 'Atmospheric light phenomenon.', ['phenomenon', 'light', 'magnetic'], 'effect.aurora', { rarity: 'uncommon' }),
  e('phenomenon.resonance', 'Resonance Event', 'phenomenon', 'Large-scale oscillatory field event.', ['phenomenon', 'resonance', 'field'], 'effect.resonance', { rarity: 'rare' }),
  e('phenomenon.meteor-shower', 'Meteor Shower', 'phenomenon', 'Transient celestial impact event.', ['phenomenon', 'celestial', 'event'], 'effect.meteor', { rarity: 'uncommon', simulationHooks: ['world.impact'] }),
];

export const WORLD_LIBRARY_COUNTS = {
  entries: WORLD_LIBRARY_CATALOG.length,
  categories: [...new Set(WORLD_LIBRARY_CATALOG.map((entry) => entry.category))].length,
};
