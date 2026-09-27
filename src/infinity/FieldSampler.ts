import { WorldGenerator, BIOME_ID, type Biome } from './WorldGenerator'
import type { ScientificFieldProvider } from './ScientificFieldProvider'
import { GeneratorFieldProvider } from './ScientificFieldProvider'
import { ScientificFieldRegistry } from './ScientificFieldRegistry'
import { worldViewContract } from './WorldViewContract'

export type ScientificFieldSample = {
  energy: number
  density: number
  information: number
  entropy: number
  temperature: number
  biology: number
  material: number
}

export type WorldContextSample = ScientificFieldSample & {
  x: number
  y: number
  z: number
  height: number
  moisture: number
  biome: Biome
  waterDepth: number
}

/**
 * Single access point for deterministic scientific/world state.
 * This is a computational model interface, not a claim of physical validation.
 */
export class FieldSampler {
  private provider: ScientificFieldProvider
  readonly registry: ScientificFieldRegistry

  constructor(public generator: WorldGenerator, provider?: ScientificFieldProvider) {
    this.provider = provider ?? new GeneratorFieldProvider(generator)
    this.registry = new ScientificFieldRegistry()
    this.registry.register(this.provider, true)
  }

  setProvider(provider: ScientificFieldProvider) {
    this.provider = provider
    this.registry.register(provider, true)
  }

  activateProvider(id: string) {
    if (!this.registry.activate(id)) return false
    const provider = this.registry.getActive()
    if (!provider) return false
    this.provider = provider
    return true
  }

  listProviders() {
    return this.registry.list()
  }

  setGenerator(generator: WorldGenerator) {
    this.generator = generator
    this.provider = new GeneratorFieldProvider(generator)
  }

  sample(x: number, y: number, z: number): ScientificFieldSample {
    return this.provider.sample(x, y, z)
  }

  sampleWorld(x: number, y?: number, z?: number): WorldContextSample {
    const zz = z ?? 0
    const yy = y ?? this.generator.sampleHeight(x, zz)
    const height = this.generator.sampleHeight(x, zz)
    const climate = this.generator.sampleClimate(x, zz, height)
    const field = this.sample(x, yy, zz)

    return {
      x, y: yy, z: zz,
      ...field,
      height,
      moisture: climate.moisture,
      biome: climate.biome,
      waterDepth: Math.max(0, this.generator.seaLevel - height),
    }
  }


  sampleViewWindow(width: number, height: number, sliceY = worldViewContract.snapshot().sliceY) {
    const view = worldViewContract.snapshot()
    const out = new Array<WorldContextSample>(Math.max(1, width) * Math.max(1, height))
    let i = 0
    for (let py = 0; py < Math.max(1, height); py++) {
      for (let px = 0; px < Math.max(1, width); px++) {
        const p = worldViewContract.sliceToWorld(px + 0.5, py + 0.5, width, height)
        const sample = this.sampleWorld(p.x, sliceY, p.z)
        out[i++] = sample
      }
    }
    return { view, width: Math.max(1, width), height: Math.max(1, height), samples: out }
  }

  sampleTerrain(x: number, z: number) {
    const height = this.generator.sampleHeight(x, z)
    const climate = this.generator.sampleClimate(x, z, height)
    return {
      x, z, height,
      temperature: climate.temperature,
      moisture: climate.moisture,
      biome: climate.biome,
      biomeId: BIOME_ID[climate.biome],
      waterDepth: Math.max(0, this.generator.seaLevel - height),
    }
  }
}
