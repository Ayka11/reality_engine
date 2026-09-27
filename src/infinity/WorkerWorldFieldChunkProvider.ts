import type { ScientificFieldProvider, ScientificFieldSample } from './ScientificFieldProvider'
import type { WorldFieldChunkCoord } from './WorldFieldChunkStore'
import type { WorldViewSnapshot } from './WorldViewContract'
import { F, CHUNK_FLOATS, CX, CY, GRID_D, GRID_H, GRID_W, NF } from '../core/ChunkGrid'

const WORLD_CHUNK_SIZE = 32

/** Bridges the existing 8³ worker chunks into a 32³ world-coordinate chunk. */
export class WorkerWorldFieldChunkProvider implements ScientificFieldProvider {
  readonly id = 'worker-world-field-chunk'
  readonly version = 'worker-world-field-chunk-v1'

  constructor(
    private readonly coord: WorldFieldChunkCoord,
    private readonly chunks: Map<number, Float32Array>,
    private readonly getView: () => WorldViewSnapshot,
    private readonly fallback: ScientificFieldProvider,
  ) {}

  sample(x: number, y: number, z: number): ScientificFieldSample {
    const originX = this.coord.cx * WORLD_CHUNK_SIZE
    const originY = this.coord.cy * WORLD_CHUNK_SIZE
    const originZ = this.coord.cz * WORLD_CHUNK_SIZE
    const lxWorld = Math.floor(x - originX)
    const lyWorld = Math.floor(y - originY)
    const lzWorld = Math.floor(z - originZ)
    if (lxWorld < 0 || lxWorld >= WORLD_CHUNK_SIZE || lyWorld < 0 || lyWorld >= WORLD_CHUNK_SIZE || lzWorld < 0 || lzWorld >= WORLD_CHUNK_SIZE) return this.fallback.sample(x, y, z)

    const view = this.getView()
    const wx = Math.round(x - view.center.x + GRID_W / 2)
    const wy = Math.round(y - view.center.y + GRID_D * 0.45)
    const wz = Math.round(z - view.center.z + GRID_H / 2)
    if (wx < 0 || wx >= GRID_W || wy < 0 || wy >= GRID_D || wz < 0 || wz >= GRID_H) return this.fallback.sample(x, y, z)

    const cx = wx >> 3
    const cy = wy >> 3
    const cz = wz >> 3
    const key = cz * (GRID_H / CY) * (GRID_W / CX) + cy * (GRID_W / CX) + cx
    const chunk = this.chunks.get(key)
    if (!chunk || chunk.length < CHUNK_FLOATS) return this.fallback.sample(x, y, z)

    const ox = wx & 7
    const oy = wy & 7
    const oz = wz & 7
    const base = (oz * CY * CX + oy * CX + ox) * NF
    return {
      energy: chunk[base + F.E] || 0,
      density: chunk[base + F.D] || 0,
      information: chunk[base + F.I] || 0,
      entropy: chunk[base + F.S] || 0,
      temperature: chunk[base + F.T] || 0,
      biology: chunk[base + F.BIO] || 0,
      material: chunk[base + F.MAT] || 0,
    }
  }
}
