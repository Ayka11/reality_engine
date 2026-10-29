import { BIOME_ID, type Biome, type WorldGenerator } from './WorldGenerator'

/**
 * A source of world-surface/environment samples, independent of how that
 * surface was authored. Implementations may wrap a procedural generator,
 * an edited field, imported data, or a future empty workspace substrate.
 */
export type WorldSurfaceSample = {
  height: number
  temperature: number
  moisture: number
  biome: Biome
  biomeId: number
  waterDepth: number
}

export interface WorldSurfaceProvider {
  readonly id: string
  readonly version: string
  readonly seed: string
  /** Reference elevation used by construction scoring, defined by the surface source. */
  readonly referenceBuildElevation: number
  sampleSurface(x: number, z: number): WorldSurfaceSample
}

/** Adapts the existing deterministic generator without changing its results. */
export class GeneratorWorldSurfaceProvider implements WorldSurfaceProvider {
  readonly id = 'world-generator-surface'
  readonly version = 'world-generator-surface-v1'

  constructor(private readonly generator: WorldGenerator) {}

  get seed(): string {
    return this.generator.seed
  }

  get referenceBuildElevation(): number {
    return this.generator.seaLevel + 10
  }

  sampleSurface(x: number, z: number): WorldSurfaceSample {
    const height = this.generator.sampleHeight(x, z)
    const climate = this.generator.sampleClimate(x, z, height)
    return {
      height,
      temperature: climate.temperature,
      moisture: climate.moisture,
      biome: climate.biome,
      biomeId: BIOME_ID[climate.biome],
      waterDepth: Math.max(0, this.generator.seaLevel - height),
    }
  }
}
