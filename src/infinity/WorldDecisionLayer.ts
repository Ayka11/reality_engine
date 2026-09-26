import { FieldSampler, type WorldContextSample } from './FieldSampler'
import { createDecisionRecord, type DecisionRecord } from './DecisionRecord'

export type DecisionWeights = {
  slope: number
  water: number
  elevation: number
  entropy: number
  density: number
  biology: number
  information: number
  distance: number
}

export const DEFAULT_DECISION_WEIGHTS: DecisionWeights = {
  slope: 0.30,
  water: 0.25,
  elevation: 0.15,
  entropy: 0.08,
  density: 0.05,
  biology: 0.05,
  information: 0.04,
  distance: 0.08,
}

export type BuildabilityResult = {
  score: number
  slope: number
  waterDepth: number
  elevation: number
  field: WorldContextSample
  components: {
    slope: number
    water: number
    elevation: number
    entropy: number
    density: number
    biology: number
    information: number
  }
}

export type ZoneCostResult = {
  cost: number
  components: Record<string, number>
  buildability: BuildabilityResult
}

export class WorldDecisionLayer {
  readonly version = 'world-decision-v1'

  constructor(
    readonly sampler: FieldSampler,
    readonly weights: DecisionWeights = DEFAULT_DECISION_WEIGHTS,
  ) {}

  private clamp01(value: number) {
    return Math.max(0, Math.min(1, value))
  }

  private slopeAt(x: number, z: number, step = 2) {
    const gx = this.sampler.generator.sampleHeight(x + step, z) - this.sampler.generator.sampleHeight(x - step, z)
    const gz = this.sampler.generator.sampleHeight(x, z + step) - this.sampler.generator.sampleHeight(x, z - step)
    return Math.hypot(gx, gz) / (2 * step)
  }

  analyzeBuildability(x: number, z: number): BuildabilityResult {
    const field = this.sampler.sampleWorld(x, undefined, z)
    const slope = this.slopeAt(x, z)

    const slopeScore = 1 - this.clamp01(slope / 0.45)
    const waterScore = 1 - this.clamp01(field.waterDepth / 8)
    const elevationScore = 1 - this.clamp01(Math.abs(field.height - (this.sampler.generator.seaLevel + 10)) / 30)
    const entropyScore = 1 - this.clamp01(field.entropy / 0.12)
    const densityScore = 1 - this.clamp01(field.density)
    const biologyScore = this.clamp01(field.biology)
    const informationScore = this.clamp01(field.information / 50)

    const score = this.clamp01(
      this.weights.slope * slopeScore +
      this.weights.water * waterScore +
      this.weights.elevation * elevationScore +
      this.weights.entropy * entropyScore +
      this.weights.density * densityScore +
      this.weights.biology * biologyScore +
      this.weights.information * informationScore,
    )

    return {
      score: field.waterDepth > 0.25 ? 0 : score,
      slope,
      waterDepth: field.waterDepth,
      elevation: field.height,
      field,
      components: {
        slope: slopeScore,
        water: waterScore,
        elevation: elevationScore,
        entropy: entropyScore,
        density: densityScore,
        biology: biologyScore,
        information: informationScore,
      },
    }
  }

  buildZoneCost(x: number, z: number, distanceFromHub = 0): ZoneCostResult {
    const buildability = this.analyzeBuildability(x, z)
    const w = this.weights

    const components = {
      slope: (1 - buildability.components.slope) * w.slope,
      water: (1 - buildability.components.water) * w.water,
      elevation: (1 - buildability.components.elevation) * w.elevation,
      entropy: (1 - buildability.components.entropy) * w.entropy,
      density: (1 - buildability.components.density) * w.density,
      biology: (1 - buildability.components.biology) * w.biology,
      information: (1 - buildability.components.information) * w.information,
      distance: this.clamp01(distanceFromHub / 500) * w.distance,
    }

    return {
      cost: this.clamp01(Object.values(components).reduce((sum, value) => sum + value, 0)),
      components,
      buildability,
    }
  }

  explainBuildDecision(x: number, z: number, distanceFromHub = 0): DecisionRecord {
    const result = this.buildZoneCost(x, z, distanceFromHub)
    return createDecisionRecord(
      'zone-cost',
      this.sampler.generator.seed,
      { x, z, distanceFromHub },
      this.weights,
      {
        cost: result.cost,
        score: result.buildability.score,
        components: result.components,
      },
      { x, y: result.buildability.elevation, z },
    )
  }
}
