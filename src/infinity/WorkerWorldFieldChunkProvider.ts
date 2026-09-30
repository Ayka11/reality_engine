import type { ScientificFieldProvider } from './ScientificFieldProvider'
import type { ScientificFieldSample } from './FieldSampler'
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

  snapshotWorkerChunks(): { key: number; data: number[] }[] {
    const view = this.getView()
    const ox = this.coord.cx * WORLD_CHUNK_SIZE
    const oy = this.coord.cy * WORLD_CHUNK_SIZE
    const oz = this.coord.cz * WORLD_CHUNK_SIZE
    const out: { key: number; data: number[] }[] = []
    for (const [key, chunk] of this.chunks) {
      if (chunk.length < CHUNK_FLOATS) continue
      const cz = Math.floor(key / ((GRID_H / CY) * (GRID_W / CX)))
      const rem = key - cz * (GRID_H / CY) * (GRID_W / CX)
      const cy = Math.floor(rem / (GRID_W / CX))
      const cx = rem % (GRID_W / CX)
      const wx0 = cx * CX - GRID_W / 2 + view.center.x
      const wy0 = cy * CY - GRID_D * 0.45 + view.center.y
      const wz0 = cz * 8 - GRID_H / 2 + view.center.z
      if (wx0 + CX <= ox || wx0 >= ox + WORLD_CHUNK_SIZE || wy0 + CY <= oy || wy0 >= oy + WORLD_CHUNK_SIZE || wz0 + 8 <= oz || wz0 >= oz + WORLD_CHUNK_SIZE) continue
      out.push({ key, data: Array.from(chunk) })
    }
    return out
  }

  snapshotValues(): number[] {
    const values: number[] = []
    const view = this.getView()
    const originX = this.coord.cx * WORLD_CHUNK_SIZE
    const originY = this.coord.cy * WORLD_CHUNK_SIZE
    const originZ = this.coord.cz * WORLD_CHUNK_SIZE
    for (let z = 0; z < WORLD_CHUNK_SIZE; z++) for (let y = 0; y < WORLD_CHUNK_SIZE; y++) for (let x = 0; x < WORLD_CHUNK_SIZE; x++) {
      const wx = Math.round(originX + x - view.center.x + GRID_W / 2)
      const wy = Math.round(originY + y - view.center.y + GRID_D * 0.45)
      const wz = Math.round(originZ + z - view.center.z + GRID_H / 2)
      if (wx < 0 || wx >= GRID_W || wy < 0 || wy >= GRID_D || wz < 0 || wz >= GRID_H) continue
      const cx = wx >> 3, cy = wy >> 3, cz = wz >> 3
      const key = cz * (GRID_H / CY) * (GRID_W / CX) + cy * (GRID_W / CX) + cx
      const chunk = this.chunks.get(key)
      if (!chunk || chunk.length < CHUNK_FLOATS) continue
      for (let i = 0; i < CHUNK_FLOATS; i++) values.push(chunk[i])
      break
    }
    return values
  }


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
