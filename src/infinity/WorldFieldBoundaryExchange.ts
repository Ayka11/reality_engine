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

  snapshotFace(provider: { sample: (x: number, y: number, z: number) => ScientificFieldSample }, coord: WorldFieldChunkCoord, axis: BoundaryAxis, side: BoundarySide, resolution = 8): WorldFieldBoundarySnapshot {
    const size = 32
    const edge = side > 0 ? size : 0
    const samples: ScientificFieldSample[] = []
    const count = Math.max(2, Math.trunc(resolution))
    for (let v = 0; v < count; v++) {
      for (let u = 0; u < count; u++) {
        const a = (u / (count - 1)) * size
        const b = (v / (count - 1)) * size
        let x = coord.cx * size
        let y = coord.cy * size
        let z = coord.cz * size
        if (axis === 'x') { x += edge; y += a; z += b }
        else if (axis === 'y') { x += a; y += edge; z += b }
        else { x += a; y += b; z += edge }
        samples.push({ ...provider.sample(x, y, z) })
      }
    }
    return this.publish(coord, axis, side, samples)
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

  clearForChunk(coord: WorldFieldChunkCoord): number {
    let removed = 0
    for (const key of [...this.faces.keys()]) {
      if (key.startsWith(`${coord.cx},${coord.cy},${coord.cz}|`)) {
        this.faces.delete(key)
        removed++
      }
    }
    return removed
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
