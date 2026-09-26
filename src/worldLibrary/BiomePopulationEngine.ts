import type { BiomeDefinition } from './BiomeEngine'
import { BIOME_DEFINITIONS, classifyBiome } from './BiomeEngine'
import type { WorldEnvironment } from './WorldEnvironmentResolver'
import { worldRuleGraph } from './registry'

export type BiomePopulationRule = {
  semanticEntryId: string
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
  reason: string[]
}

export class BiomePopulationEngine {
  classify(environment: WorldEnvironment): BiomeDefinition | undefined {
    return classifyBiome(environment)
  }

  plan(environment: WorldEnvironment, maxElements = 24): BiomePopulationPlan {
    const biome = this.classify(environment)
    if (!biome) {
      return { biomeId: 'unknown', rules: [], count: 0, reason: ['no-biome-match'] }
    }

    const rules: BiomePopulationRule[] = biome.preferredElements.map((semanticEntryId, index) => {
      const outgoing = worldRuleGraph.outgoing(semanticEntryId)
      const supported = worldRuleGraph.incoming(semanticEntryId, 'supports')
      const enabled = worldRuleGraph.incoming(semanticEntryId, 'enables')
      const weight = 1 + outgoing.length * 0.15 + supported.length * 0.2 + enabled.length * 0.1
      const minCount = semanticEntryId.startsWith('fauna.') ? 1 : 2
      const maxCount = semanticEntryId.startsWith('resource.') ? 4 : semanticEntryId.startsWith('fauna.') ? 8 : 12
      return {
        semanticEntryId,
        weight: weight + Math.max(0, biome.preferredElements.length - index) * 0.05,
        minCount,
        maxCount,
        scale: semanticEntryId.startsWith('flora.') ? 1 : 0.85,
        requiredRelations: ['supports', 'compatible'],
      }
    })

    return {
      biomeId: biome.id,
      rules: rules.slice(0, maxElements),
      count: rules.length,
      reason: [
        'biome-classified',
        'preferred-elements',
        'world-rule-graph-weighted',
      ],
    }
  }

  planByBiomeId(biomeId: string, maxElements = 24): BiomePopulationPlan {
    const biome = BIOME_DEFINITIONS.find((entry) => entry.id === biomeId)
    if (!biome) return { biomeId, rules: [], count: 0, reason: ['unknown-biome'] }
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
