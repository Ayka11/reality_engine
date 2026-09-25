import { WORLD_CHUNK_SIZE, chunkOrigin } from './WorldCoordinate'
import { fbm3D, ridgedFbm3D } from './Noise'

export type Biome =
  | 'ocean' | 'coast' | 'plains' | 'forest' | 'desert'
  | 'tundra' | 'mountain' | 'alpine'

export type TerrainCell = {
  x: number
  y: number
  z: number
  height: number
  temperature: number
  moisture: number
  density: number
  water: number
  biome: Biome
}

export type WorldChunk = {
  cx: number
  cy: number
  cz: number
  heights: Float32Array
  moisture: Float32Array
  temperature: Float32Array
  water: Float32Array
  biome: Uint8Array
}

/**
 * Deterministic terrain generator.
 * Terrain is defined in world coordinates, so adjacent chunks share the same samples.
 */
export class WorldGenerator {
  readonly seed: string
  readonly seaLevel: number
  readonly maxElevation: number

  constructor(seed = 'reality-engine-infinity-v1', seaLevel = 16, maxElevation = 52) {
    this.seed = seed
    this.seaLevel = seaLevel
    this.maxElevation = maxElevation
  }

  sampleHeight(x: number, z: number): number {
    // Continental scale establishes landmasses; ridges shape mountains;
    // erosion-like low-frequency variation prevents repetitive stripes.
    const continental = fbm3D(x / 2048, 0, z / 2048, `${this.seed}:continent`, 5, 2, 0.55)
    const regional = fbm3D(x / 512, 0.11, z / 512, `${this.seed}:regional`, 5, 2, 0.52)
    const detail = fbm3D(x / 128, 0.23, z / 128, `${this.seed}:detail`, 4, 2.1, 0.5)
    const ridge = ridgedFbm3D(x / 700, 0, z / 700, `${this.seed}:ridge`, 4)

    const land = Math.max(0, (continental - 0.42) / 0.58)
    const base = this.seaLevel - 6 + land * 25
    const mountains = Math.pow(Math.max(0, ridge - 0.48) / 0.52, 1.7) * 34
    const rolling = (regional - 0.5) * 12 + (detail - 0.5) * 4

    return Math.max(0, Math.min(this.maxElevation, base + mountains + rolling))
  }

  sampleClimate(x: number, z: number, height: number): { temperature: number; moisture: number; biome: Biome } {
    const latLike = Math.min(1, Math.abs(z) / 12000)
    const tempNoise = fbm3D(x / 900, 0.41, z / 900, `${this.seed}:temp`, 4)
    const moistNoise = fbm3D(x / 1100, 0.73, z / 1100, `${this.seed}:moist`, 4)

    const temperature = Math.max(0, Math.min(1,
      0.82 - latLike * 0.68 - Math.max(0, height - this.seaLevel) / 100 * 0.35
      + (tempNoise - 0.5) * 0.22
    ))
    const moisture = Math.max(0, Math.min(1, moistNoise * 0.78 + (0.55 - latLike) * 0.22))

    let biome: Biome
    if (height < this.seaLevel - 1) biome = 'ocean'
    else if (height < this.seaLevel + 2) biome = 'coast'
    else if (temperature < 0.18) biome = height > 34 ? 'alpine' : 'tundra'
    else if (temperature < 0.35) biome = height > 38 ? 'alpine' : 'forest'
    else if (moisture < 0.18) biome = 'desert'
    else if (moisture > 0.58) biome = 'forest'
    else biome = 'plains'

    return { temperature, moisture, biome }
  }

  generateChunk(cx: number, cy: number, cz: number): WorldChunk {
    const origin = chunkOrigin(cx, cy, cz)
    const count = WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE
    const heights = new Float32Array(count)
    const moisture = new Float32Array(count)
    const temperature = new Float32Array(count)
    const water = new Float32Array(count)
    const biome = new Uint8Array(count)

    for (let lz = 0; lz < WORLD_CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < WORLD_CHUNK_SIZE; lx++) {
        const x = origin.x + lx
        const z = origin.z + lz
        const h = this.sampleHeight(x, z)
        const c = this.sampleClimate(x, z, h)
        const i = lz * WORLD_CHUNK_SIZE + lx
        heights[i] = h
        moisture[i] = c.moisture
        temperature[i] = c.temperature
        water[i] = Math.max(0, this.seaLevel - h)
        biome[i] = BIOME_ID[c.biome]
      }
    }
    return { cx, cy, cz, heights, moisture, temperature, water, biome }
  }

  /** Deterministic field sample for the scientific layer. */
  sampleField(x: number, y: number, z: number) {
    const h = this.sampleHeight(x, z)
    const climate = this.sampleClimate(x, z, h)
    const proximity = Math.max(0, 1 - Math.abs(y - h) / 18)
    return {
      energy: 30 + proximity * 220 + fbm3D(x / 48, y / 32, z / 48, `${this.seed}:energy`, 3) * 80,
      density: Math.max(0, Math.min(1, y <= h ? 0.25 + proximity * 0.65 : proximity * 0.2)),
      information: 10 + climate.moisture * 40 + (climate.biome === 'forest' ? 20 : 0),
      entropy: 0.02 + (1 - climate.moisture) * 0.08,
      temperature: climate.temperature * 280,
      biology: climate.moisture * proximity,
      material: y > h ? 0 : BIOME_ID[climate.biome],
    }
  }
}

export const BIOME_ID: Record<Biome, number> = {
  ocean: 0, coast: 1, plains: 2, forest: 3, desert: 4, tundra: 5, mountain: 6, alpine: 7,
}

