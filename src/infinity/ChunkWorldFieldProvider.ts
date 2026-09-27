import type { ScientificFieldProvider } from './ScientificFieldProvider'
import type { ScientificFieldSample } from './FieldSampler'
import { F, GRID_D, GRID_H, GRID_W, NF, CHUNK_FLOATS, CX, CY } from '../core/ChunkGrid'
import type { WorldViewSnapshot } from './WorldViewContract'

/**
 * Adapts the scientific ChunkSimWorker voxel state to world coordinates.
 * The worker remains authoritative for covered voxels; a fallback provider is
 * used outside the finite worker window so Infinite World remains continuous.
 */
export class ChunkWorldFieldProvider implements ScientificFieldProvider {
  readonly id = 'chunk-worker-world-field'
  readonly version = 'chunk-worker-world-field-v1'

  constructor(
    private readonly chunks: Map<number, Float32Array>,
    private readonly getView: () => WorldViewSnapshot,
    private readonly fallback: ScientificFieldProvider,
  ) {}

  sample(x: number, y: number, z: number): ScientificFieldSample {
    const view = this.getView()
    const lx = Math.round(x - view.center.x + GRID_W / 2)
    const ly = Math.round(y)
    const lz = Math.round(z - view.center.z + GRID_H / 2)

    if (lx >= 0 && lx < GRID_W && ly >= 0 && ly < GRID_D && lz >= 0 && lz < GRID_H) {
      const cx = lx >> 3
      const cy = ly >> 3
      const cz = lz >> 3
      const key = cz * (GRID_H / CY) * (GRID_W / CX) + cy * (GRID_W / CX) + cx
      const chunk = this.chunks.get(key)
      if (chunk && chunk.length >= CHUNK_FLOATS) {
        const ox = lx & 7
        const oy = ly & 7
        const oz = lz & 7
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

    return this.fallback.sample(x, y, z)
  }
}
