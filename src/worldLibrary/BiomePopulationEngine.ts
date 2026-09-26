import type { BiomeDefinition } from './BiomeEngine'
import { BIOME_DEFINITIONS, classifyBiome } from './BiomeEngine'
import type { WorldEnvironment } from './WorldEnvironmentResolver'
import { worldLibrary, worldRuleGraph } from './registry'

export type PopulationLayer = 'visual' | 'biological' | 'resource' | 'infrastructure' | 'civilization'

export type BiomePopulationRule = {
  semanticEntryId: string
  layer: PopulationLayer
  weight: number
  minCount: number
  maxCount: number
  scale: number
  requiredRelations?: Array<'supports' | 'compatible' | 'enables'>
}

export type BiomePopulationPlan = {
  biomeId: string
  rules: BiomePopulationRule[]
  count: number
  byLayer: Record<PopulationLayer, BiomePopulationRule[]>
  reason: string[]
}

const layerFor = (id: string): PopulationLayer => {
  if (id.startsWith('flora.') || id.startsWith('terrain.') || id.startsWith('geology.') || id.startsWith('water.') || id.startsWith('anomaly.') || id.startsWith('celestial.') || id.startsWith('phenomenon.')) return 'visual'
  if (id.startsWith('fauna.')) return 'biological'
  if (id.startsWith('resource.')) return 'resource'
  if (id.startsWith('infrastructure.') || id.startsWith('structure.') || id.startsWith('settlement.')) return 'infrastructure'
  if (id.startsWith('civilization.')) return 'civilization'
  return 'visual'
}

export class BiomePopulationEngine {
  classify(environment: WorldEnvironment): BiomeDefinition | undefined {
    return classifyBiome(environment)
  }

  plan(environment: WorldEnvironment, maxElements = 24): BiomePopulationPlan {
    const biome = this.classify(environment)
    const empty: Record<PopulationLayer, BiomePopulationRule[]> = {
      visual: [], biological: [], resource: [], infrastructure: [], civilization: [],
    }
    if (!biome) return { biomeId: 'unknown', rules: [], count: 0, byLayer: empty, reason: ['no-biome-match'] }

    const preferred = [...biome.preferredElements]
    const derived = worldRuleGraph
      .query({ from: biome.id })
      .filter((rule) => rule.relation === 'produces' || rule.relation === 'enables' || rule.relation === 'supports')
      .map((rule) => rule.to)
    const semanticIds = [...new Set([...preferred, ...derived])]

    const rules = semanticIds.map((semanticEntryId, index) => {
      const entry = worldLibrary.get(semanticEntryId)
      const outgoing = worldRuleGraph.outgoing(semanticEntryId)
      const supported = worldRuleGraph.incoming(semanticEntryId, 'supports')
      const enabled = worldRuleGraph.incoming(semanticEntryId, 'enables')
      const layer = layerFor(semanticEntryId)
      const weight = 1 + outgoing.length * 0.15 + supported.length * 0.2 + enabled.length * 0.1
      const minCount = layer === 'biological' ? 1 : layer === 'resource' ? 1 : layer === 'civilization' ? 0 : 2
      const maxCount = layer === 'resource' ? 4 : layer === 'biological' ? 8 : layer === 'civilization' ? 1 : layer === 'infrastructure' ? 3 : 12
      return {
        semanticEntryId,
        layer,
        weight: weight + Math.max(0, biome.preferredElements.length - index) * 0.05 + (entry ? 0.1 : 0),
        minCount,
        maxCount,
        scale: layer === 'visual' && semanticEntryId.startsWith('flora.') ? 1 : 0.85,
        requiredRelations: ['supports', 'compatible'],
      }
    })

    const ordered = rules.sort((a, b) => b.weight - a.weight)
    const limited = ordered.slice(0, maxElements)
    for (const rule of limited) empty[rule.layer].push(rule)
    return {
      biomeId: biome.id,
      rules: limited,
      count: limited.length,
      byLayer: empty,
      reason: ['biome-classified', 'preferred-elements', 'rule-derived-resources', 'rule-derived-infrastructure', 'world-rule-graph-weighted', 'layer-classified'],
    }
  }

  planByBiomeId(biomeId: string, maxElements = 24): BiomePopulationPlan {
    const biome = BIOME_DEFINITIONS.find((entry) => entry.id === biomeId)
    if (!biome) return this.plan({ temperature: 0.5, moisture: 0.5, elevation: 0.5, slope: 0.5, stability: 1, radiation: 0 }, maxElements)
    return this.plan({
      temperature: (biome.environment.temperature[0] + biome.environment.temperature[1]) / 2,
      moisture: (biome.environment.moisture[0] + biome.environment.moisture[1]) / 2,
      elevation: (biome.environment.elevation[0] + biome.environment.elevation[1]) / 2,
      slope: (biome.environment.slope[0] + biome.environment.slope[1]) / 2,
      stability: 1,
      radiation: 0,
    }, maxElements)
  }
}

export const biomePopulationEngine = new BiomePopulationEngine()
