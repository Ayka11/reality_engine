import type { ScientificFieldSample } from './FieldSampler'
import type { WorldFieldChunkCoord } from './WorldFieldChunkStore'

export type BoundaryAxis = 'x' | 'y' | 'z'
export type BoundarySide = -1 | 1

export type WorldFieldBoundaryKey = string

export type WorldFieldBoundarySnapshot = {
  key: WorldFieldBoundaryKey
  coord: WorldFieldChunkCoord
  axis: BoundaryAxis
  side: BoundarySide
  samples: ScientificFieldSample[]
  version: number
}

/**
 * Explicit seam exchange between adjacent streamed chunks.
 *
 * This is intentionally a transport-level contract: simulation workers can
 * publish their boundary state here, while consumers can validate that both
 * sides of a shared face refer to the same world-space seam.
 */
export class WorldFieldBoundaryExchange {
  private readonly faces = new Map<WorldFieldBoundaryKey, WorldFieldBoundarySnapshot>()
  private version = 0

  static key(coord: WorldFieldChunkCoord, axis: BoundaryAxis, side: BoundarySide): string {
    return `${coord.cx},${coord.cy},${coord.cz}|${axis}|${side}`
  }

  publish(coord: WorldFieldChunkCoord, axis: BoundaryAxis, side: BoundarySide, samples: ScientificFieldSample[]): WorldFieldBoundarySnapshot {
    const key = WorldFieldBoundaryExchange.key(coord, axis, side)
    const snapshot: WorldFieldBoundarySnapshot = {
      key,
      coord: { ...coord },
      axis,
      side,
      samples: samples.map((sample) => ({ ...sample })),
      version: ++this.version,
    }
    this.faces.set(key, snapshot)
    return snapshot
  }

  get(coord: WorldFieldChunkCoord, axis: BoundaryAxis, side: BoundarySide): WorldFieldBoundarySnapshot | null {
    return this.faces.get(WorldFieldBoundaryExchange.key(coord, axis, side)) ?? null
  }

  clear(): void {
    this.faces.clear()
  }

  size(): number {
    return this.faces.size
  }

  neighbor(coord: WorldFieldChunkCoord, axis: BoundaryAxis, side: BoundarySide): WorldFieldChunkCoord {
    const delta = side
    if (axis === 'x') return { cx: coord.cx + delta, cy: coord.cy, cz: coord.cz }
    if (axis === 'y') return { cx: coord.cx, cy: coord.cy + delta, cz: coord.cz }
    return { cx: coord.cx, cy: coord.cy, cz: coord.cz + delta }
  }

  validatePair(coord: WorldFieldChunkCoord, axis: BoundaryAxis): { paired: boolean; samples: number; maxDelta: number } {
    const positive = this.get(coord, axis, 1)
    const next = this.neighbor(coord, axis, 1)
    const negative = this.get(next, axis, -1)
    if (!positive || !negative) return { paired: false, samples: 0, maxDelta: Infinity }
    const count = Math.min(positive.samples.length, negative.samples.length)
    let maxDelta = 0
    for (let i = 0; i < count; i++) {
      const a = positive.samples[i]
      const b = negative.samples[i]
      for (const field of ['energy','density','information','entropy','temperature','biology','material'] as const) {
        maxDelta = Math.max(maxDelta, Math.abs(a[field] - b[field]))
      }
    }
    return { paired: positive.samples.length === negative.samples.length, samples: count, maxDelta }
  }
}

export const worldFieldBoundaryExchange = new WorldFieldBoundaryExchange()
