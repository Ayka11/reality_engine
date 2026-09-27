import type { ScientificFieldProvider } from './ScientificFieldProvider'
import type { ScientificFieldSample } from './FieldSampler'
import type { WorldFieldChunkCoord } from './WorldFieldChunkStore'
import { WORLD_FIELD_CHUNK_SIZE, worldFieldChunkOrigin } from './WorldFieldChunkStore'

const ZERO: ScientificFieldSample = { energy: 0, density: 0, information: 0, entropy: 0, temperature: 0, biology: 0, material: 0 }

function hashSeed(seed: string, coord: WorldFieldChunkCoord): number {
  let h = 2166136261 >>> 0
  const text = `${seed}|${coord.cx},${coord.cy},${coord.cz}`
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mix(value: number): number {
  value ^= value >>> 16
  value = Math.imul(value, 2246822507) >>> 0
  value ^= value >>> 13
  value = Math.imul(value, 3266489909) >>> 0
  return (value ^ (value >>> 16)) >>> 0
}

/** Deterministic field source for a world chunk when no simulation snapshot exists. */
export class DeterministicWorldFieldChunkProvider implements ScientificFieldProvider {
  readonly id = 'deterministic-world-field-chunk'
  readonly version = 'world-field-chunk-seed-v1'
  private readonly seedHash: number
  private readonly origin: { x: number; y: number; z: number }

  constructor(seed: string, coord: WorldFieldChunkCoord) {
    this.seedHash = hashSeed(seed, coord)
    this.origin = worldFieldChunkOrigin(coord)
  }

  sample(x: number, y: number, z: number): ScientificFieldSample {
    const lx = Math.floor(x - this.origin.x)
    const ly = Math.floor(y - this.origin.y)
    const lz = Math.floor(z - this.origin.z)
    if (lx < 0 || lx >= WORLD_FIELD_CHUNK_SIZE || ly < 0 || ly >= WORLD_FIELD_CHUNK_SIZE || lz < 0 || lz >= WORLD_FIELD_CHUNK_SIZE) return ZERO

    const local = (lx * 73856093) ^ (ly * 19349663) ^ (lz * 83492791)
    const h = mix((this.seedHash ^ local) >>> 0)
    const n = h / 0xffffffff
    const wave = Math.sin((x + this.seedHash % 997) * 0.07) * Math.cos((z + this.seedHash % 991) * 0.05)
    const density = Math.max(0, Math.min(1, 0.5 + wave * 0.18 + (n - 0.5) * 0.08))
    const entropy = Math.max(0, Math.min(1, 0.5 + (n - 0.5) * 0.4))
    return {
      energy: Math.max(0, 0.5 + n * 2 + Math.abs(wave)),
      density,
      information: Math.max(0, 0.2 + (1 - entropy) * 0.8),
      entropy,
      temperature: 0.25 + density * 0.75,
      biology: Math.max(0, Math.min(1, density * (1 - entropy * 0.55))),
      material: density,
    }
  }
}
