import { WorldGenerator, type Biome } from './WorldGenerator'
import { GeneratorWorldSurfaceProvider, validateWorldSurfaceProvider, type WorldSurfaceProvider } from './WorldSurfaceProvider'
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
  private worldSurface: WorldSurfaceProvider
  private followsGeneratorSurface: boolean

  constructor(
    public generator: WorldGenerator,
    provider?: ScientificFieldProvider,
    surfaceProvider?: WorldSurfaceProvider,
  ) {
    this.provider = provider ?? new GeneratorFieldProvider(generator)
    this.worldSurface = surfaceProvider ?? new GeneratorWorldSurfaceProvider(generator)
    validateWorldSurfaceProvider(this.worldSurface)
    this.followsGeneratorSurface = surfaceProvider === undefined
    this.registry = new ScientificFieldRegistry()
    this.registry.register(this.provider, true)
  }

  /** Active surface source; scientific-field sampling remains a separate provider. */
  get surfaceProvider(): WorldSurfaceProvider {
    return this.worldSurface
  }

  /** Switch the spatial surface without replacing the active scientific field provider. */
  setSurfaceProvider(provider: WorldSurfaceProvider) {
    validateWorldSurfaceProvider(provider)
    this.worldSurface = provider
    this.followsGeneratorSurface = false
  }

  /** Explicitly restore the default procedural surface adapter. */
  resetSurfaceProviderToGenerator() {
    this.worldSurface = new GeneratorWorldSurfaceProvider(this.generator)
    this.followsGeneratorSurface = true
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
    // Keep the generator-backed surface in sync, but do not replace a deliberately
    // selected surface provider when only the scientific generator changes.
    if (this.followsGeneratorSurface) {
      this.worldSurface = new GeneratorWorldSurfaceProvider(generator)
    }
    const provider = new GeneratorFieldProvider(generator)
    this.provider = provider
    // Keep direct sampling and the public provider registry in sync after a generator swap.
    this.registry.register(provider, true)
  }

  sample(x: number, y: number, z: number): ScientificFieldSample {
    // The registry is public for runtime tooling; honor its active selection even
    // when a provider is activated or removed through that registry directly.
    const activeProvider = this.registry.getActive()
    if (!activeProvider) throw new Error('No active scientific field provider')
    this.provider = activeProvider
    return activeProvider.sample(x, y, z)
  }

  sampleWorld(x: number, y?: number, z?: number): WorldContextSample {
    const zz = z ?? 0
    const surface = this.worldSurface.sampleSurface(x, zz)
    const yy = y ?? surface.height
    const field = this.sample(x, yy, zz)

    return {
      x, y: yy, z: zz,
      ...field,
      height: surface.height,
      moisture: surface.moisture,
      biome: surface.biome,
      waterDepth: surface.waterDepth,
    }
  }


  /**
   * Samples a deterministic X/Z window on the selected world-space Y slice.
   * Pixel centers are mapped through the shared WorldViewContract so drawing
   * and sampling use the same coordinate transform.
   */
  sampleViewWindow(width: number, height: number, sliceY = worldViewContract.snapshot().sliceY) {
    const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1
    const safeHeight = Number.isFinite(height) ? Math.max(1, Math.floor(height)) : 1
    const safeSliceY = Number.isFinite(sliceY) ? sliceY : worldViewContract.snapshot().sliceY
    const view = worldViewContract.snapshot()
    const samples = new Array<WorldContextSample>(safeWidth * safeHeight)
    let index = 0

    for (let py = 0; py < safeHeight; py++) {
      for (let px = 0; px < safeWidth; px++) {
        const point = worldViewContract.sliceToWorld(px + 0.5, py + 0.5, safeWidth, safeHeight)
        samples[index++] = this.sampleWorld(point.x, safeSliceY, point.z)
      }
    }

    return { view, width: safeWidth, height: safeHeight, sliceY: safeSliceY, samples }
  }

  sampleTerrain(x: number, z: number) {
    return { x, z, ...this.worldSurface.sampleSurface(x, z) }
  }
}
