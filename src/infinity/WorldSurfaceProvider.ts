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
  /** Optional bounds; absent bounds mean the source is not vertically clamped. */
  readonly minimumElevation?: number
  readonly maximumElevation?: number
  /** Null/absent means this surface has no global sea plane. */
  readonly waterLevel?: number | null
  /**
   * Optional fast path for a chunk water mask. Returning null means the
   * provider has no water mask for this chunk; omitting the method requests
   * that the renderer derive a mask from sampleSurface().
   */
  getWaterMaskForChunk?(chunk: WorldSurfaceWaterChunk): Float32Array | null
  sampleSurface(x: number, z: number, heightOverride?: number): WorldSurfaceSample
}

export type WorldSurfaceWaterChunk = {
  cx: number
  cz: number
  water: Float32Array
}

type WaterLevelSource = Pick<WorldSurfaceProvider, 'waterLevel'>

/** Resolve a valid global water plane; absent, null and non-finite values fail closed. */
export function resolveWorldWaterLevel(provider: WaterLevelSource): number | null {
  const level = provider.waterLevel
  return typeof level === 'number' && Number.isFinite(level) ? level : null
}

export function isBelowWorldWaterSurface(
  provider: WaterLevelSource,
  height: number,
  clearance = 0.25,
): boolean {
  const level = resolveWorldWaterLevel(provider)
  return level !== null && Number.isFinite(height) && Number.isFinite(clearance) &&
    clearance >= 0 && height < level - clearance
}

/** Use the global water plane when present, otherwise a local terrain midpoint. */
export function resolveBridgeDeckHeight(
  provider: WaterLevelSource,
  startHeight: number,
  endHeight: number,
  clearance = 0.45,
): number {
  const level = resolveWorldWaterLevel(provider)
  const base = level ?? (startHeight + endHeight) * 0.5
  return base + clearance
}

export type FlatWorldSurfaceOptions = {
  seed?: string
  elevation?: number
  temperature?: number
  moisture?: number
  biome?: Biome
}

/**
 * Neutral, unbounded construction surface for a tool-first workspace.
 * It deliberately declares no global water plane; scientific-field state
 * remains owned by the separately selected ScientificFieldProvider.
 */
export class FlatWorldSurfaceProvider implements WorldSurfaceProvider {
  readonly id = 'flat-workspace-surface'
  readonly version = 'flat-workspace-surface-v1'
  readonly seed: string
  readonly referenceBuildElevation: number
  readonly elevation: number
  readonly temperature: number
  readonly moisture: number
  readonly biome: Biome
  readonly waterLevel = null

  constructor(options: FlatWorldSurfaceOptions = {}) {
    const seed = options.seed ?? 'reality-engine-empty-workspace-v1'
    const elevation = options.elevation ?? 0
    const temperature = options.temperature ?? 0.5
    const moisture = options.moisture ?? 0.5
    const biome = options.biome ?? 'plains'
    if (typeof seed !== 'string' || !seed.trim()) {
      throw new TypeError('Flat world surface seed must be a non-empty string')
    }
    if (!Number.isFinite(elevation) || !Number.isFinite(temperature) ||
        temperature < 0 || temperature > 1 || !Number.isFinite(moisture) ||
        moisture < 0 || moisture > 1 || !Object.prototype.hasOwnProperty.call(BIOME_ID, biome)) {
      throw new RangeError('Flat world surface requires finite elevation and normalized climate values')
    }
    this.seed = seed
    this.elevation = elevation
    this.referenceBuildElevation = elevation
    this.temperature = temperature
    this.moisture = moisture
    this.biome = biome
  }

  sampleSurface(x: number, z: number): WorldSurfaceSample {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new RangeError('Flat world surface coordinates must be finite')
    }
    return {
      height: this.elevation,
      temperature: this.temperature,
      moisture: this.moisture,
      biome: this.biome,
      biomeId: BIOME_ID[this.biome],
      waterDepth: 0,
    }
  }
}

export type WorldSurfaceProviderSnapshot = {
  version: 1
  kind: 'flat-workspace-surface'
  seed: string
  elevation: number
  temperature: number
  moisture: number
  biome: Biome
}

/** Serialize only built-in providers with a known, versioned reconstruction path. */
export function serializeWorldSurfaceProvider(provider: WorldSurfaceProvider): WorldSurfaceProviderSnapshot | null {
  if (!(provider instanceof FlatWorldSurfaceProvider)) return null
  return {
    version: 1,
    kind: 'flat-workspace-surface',
    seed: provider.seed,
    elevation: provider.elevation,
    temperature: provider.temperature,
    moisture: provider.moisture,
    biome: provider.biome,
  }
}

/** Restore a trusted built-in surface snapshot; malformed or unknown versions fail closed. */
export function restoreWorldSurfaceProvider(snapshot: unknown): WorldSurfaceProvider | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const value = snapshot as Partial<WorldSurfaceProviderSnapshot>
  if (value.version !== 1 || value.kind !== 'flat-workspace-surface' ||
      typeof value.seed !== 'string' || typeof value.elevation !== 'number' ||
      typeof value.temperature !== 'number' || typeof value.moisture !== 'number' ||
      typeof value.biome !== 'string') return null
  try {
    return new FlatWorldSurfaceProvider({
      seed: value.seed,
      elevation: value.elevation,
      temperature: value.temperature,
      moisture: value.moisture,
      biome: value.biome as Biome,
    })
  } catch {
    return null
  }
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

  get minimumElevation(): number {
    return 0
  }

  get maximumElevation(): number {
    return this.generator.maxElevation
  }

  get waterLevel(): number {
    return this.generator.seaLevel
  }

  getWaterMaskForChunk(chunk: WorldSurfaceWaterChunk): Float32Array {
    // InfiniteChunkManager has already generated this deterministic mask.
    // Reuse it instead of re-sampling 1024 cells during every terrain patch rebuild.
    return chunk.water
  }

  sampleSurface(x: number, z: number, heightOverride?: number): WorldSurfaceSample {
    const height = this.generator.sampleHeight(x, z)
    const climateHeight = typeof heightOverride === 'number' && Number.isFinite(heightOverride)
      ? heightOverride
      : height
    const climate = this.generator.sampleClimate(x, z, climateHeight)
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
