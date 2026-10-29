// Sparse chunk grid — 128×128×64, chunk size 8×8×8
// At 15% fill: ~200 active chunks out of 1024 total = ~9 MB

export const NF = 15  // fields per cell in the sparse worker layout

// Field indices — short names matching the worker's F layout
export const F = {
  E:   0,  // energy
  D:   1,  // density
  I:   2,  // information
  S:   3,  // entropy
  T:   4,  // temperature
  P:   5,  // pressure
  FX:  6,  // field vector X
  FY:  7,  // field vector Y
  TAU: 8,  // local time dilation
  CID: 9,  // causality event ID
  BIO: 10, // bio potential
  MAT: 11, // material ID
  WAVE:12, // wave amplitude
  PROC:13, // process activity
  FZ:  14, // field vector Z
} as const

export const CX = 8   // chunk size X
export const CY = 8   // chunk size Y
export const CZ = 8   // chunk size Z
export const CHUNK_CELLS = CX * CY * CZ        // 512
export const CHUNK_FLOATS = CHUNK_CELLS * NF   // 7168

// The global sparse threshold is suitable for energy-like fields but not for
// density in [0, 1]: the default density mobility (0.0024) transfers ~1.9e-5
// from a 0.5 source into an empty neighbor in one 1/60s step.
export const SPARSE_FIELD_EPSILON = 0.001
export const DENSITY_ACTIVITY_EPSILON = 1e-6

export function fieldActivityEpsilon(field: number): number {
  return field === F.D ? DENSITY_ACTIVITY_EPSILON : SPARSE_FIELD_EPSILON
}

export const GRID_W = 128
export const GRID_H = 128
export const GRID_D = 64
export const CHUNKS_X = GRID_W / CX  // 16
export const CHUNKS_Y = GRID_H / CY  // 16
export const CHUNKS_Z = GRID_D / CZ  // 8

export type ChunkKey = number

export function chunkKey(cx: number, cy: number, cz: number): ChunkKey {
  return cz * CHUNKS_Y * CHUNKS_X + cy * CHUNKS_X + cx
}

export function decodeChunkKey(key: ChunkKey): [number, number, number] {
  const cx = key % CHUNKS_X
  const cy = Math.floor(key / CHUNKS_X) % CHUNKS_Y
  const cz = Math.floor(key / (CHUNKS_X * CHUNKS_Y))
  return [cx, cy, cz]
}

export class ChunkGrid {
  readonly W = GRID_W
  readonly H = GRID_H
  readonly D = GRID_D
  readonly NF = NF

  chunks     = new Map<ChunkKey, Float32Array>()
  dirtyChunks= new Set<ChunkKey>()

  private chunkOf(x: number, y: number, z: number): [ChunkKey, number] {
    const cx = x >> 3
    const cy = y >> 3
    const cz = z >> 3
    const lx = x & 7
    const ly = y & 7
    const lz = z & 7
    const key = chunkKey(cx, cy, cz)
    const localIdx = (lz * CY * CX + ly * CX + lx) * NF
    return [key, localIdx]
  }

  get(x: number, y: number, z: number, f: number): number {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H || z < 0 || z >= GRID_D) return 0
    const [key, li] = this.chunkOf(x, y, z)
    const chunk = this.chunks.get(key)
    return chunk ? chunk[li + f] : 0
  }

  set(x: number, y: number, z: number, f: number, v: number): void {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H || z < 0 || z >= GRID_D) return
    const [key, li] = this.chunkOf(x, y, z)
    let chunk = this.chunks.get(key)
    if (!chunk) {
      if (Math.abs(v) <= fieldActivityEpsilon(f)) return
      chunk = new Float32Array(CHUNK_FLOATS)
      this.chunks.set(key, chunk)
    }
    chunk[li + f] = Math.max(-9999, Math.min(9999, v))
    this.dirtyChunks.add(key)
  }

  add(x: number, y: number, z: number, f: number, delta: number): void {
    const cur = this.get(x, y, z, f)
    this.set(x, y, z, f, cur + delta)
  }

  prune(threshold = 0.01): number {
    let pruned = 0
    for (const [key, chunk] of this.chunks) {
      let maxVal = 0
      let maxDensity = 0
      for (let i = 0; i < CHUNK_FLOATS; i++) {
        const value = Math.abs(chunk[i])
        maxVal = Math.max(maxVal, value)
        if (i % NF === F.D) maxDensity = Math.max(maxDensity, value)
      }
      // A sub-threshold chunk that carries resolvable density is not empty:
      // pruning it discards mass that is still being transported across cells.
      if (maxVal < threshold && maxDensity <= DENSITY_ACTIVITY_EPSILON) {
        // Publish a zero-filled dirty payload for removed chunks so consumers
        // can clear stale geometry/state instead of retaining deleted data.
        this.chunks.delete(key)
        this.dirtyChunks.add(key)
        pruned++
      }
    }
    return pruned
  }

  *activeCells(): Generator<{ x: number; y: number; z: number; base: number; chunk: Float32Array }> {
    for (const [key, chunk] of this.chunks) {
      const [cx, cy, cz] = decodeChunkKey(key)
      const bx = cx * CX, by = cy * CY, bz = cz * CZ
      for (let lz = 0; lz < CZ; lz++) for (let ly = 0; ly < CY; ly++) for (let lx = 0; lx < CX; lx++) {
        const base = (lz * CY * CX + ly * CX + lx) * NF
        let hasVal = false
        for (let f = 0; f < NF; f++) {
          if (Math.abs(chunk[base + f]) > fieldActivityEpsilon(f)) { hasVal = true; break }
        }
        if (hasVal) yield { x: bx + lx, y: by + ly, z: bz + lz, base, chunk }
      }
    }
  }

  fillRegion(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, f: number, value: number): void {
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      this.set(x, y, z, f, value)
  }

  paintSphere(cx: number, cy: number, cz: number, r: number, f: number, value: number, mode: 'add' | 'set' = 'set'): void {
    const ir = Math.ceil(r)
    for (let dz = -ir; dz <= ir; dz++) for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d > r) continue
      const g = Math.exp(-d * d / (r * r) * 2.5)
      const x = cx + dx, y = cy + dy, z = cz + dz
      this.set(x, y, z, f, mode === 'add' ? this.get(x, y, z, f) + value * g : value * g)
    }
  }

  eraseSphere(cx: number, cy: number, cz: number, r: number): void {
    const ir = Math.ceil(r)
    for (let dz = -ir; dz <= ir; dz++) for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > r) continue
      for (let f = 0; f < NF; f++) this.set(cx + dx, cy + dy, cz + dz, f, 0)
    }
  }

  noiseFill(f: number, scale: number, amplitude: number, seed = 0): void {
    for (let z = 0; z < GRID_D; z++) for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const n = this._fbm(x * scale / GRID_W, y * scale / GRID_H, z * scale / GRID_D, 4, seed)
      const v = n * amplitude
      if (Math.abs(v) > 0.1) this.set(x, y, z, f, v)
    }
  }

  private _fbm(x: number, y: number, z: number, oct: number, seed: number): number {
    let v = 0, amp = 0.5, freq = 1
    for (let i = 0; i < oct; i++) {
      const s = seed + i * 37
      v += amp * (Math.sin(x * freq * 6.28 + s) * Math.cos(y * freq * 4.71 + s * 0.3) * Math.sin(z * freq * 5.1 + s * 0.7))
      amp *= 0.5; freq *= 2.1
    }
    return (v + 1) / 2
  }

  snapshot(): Array<{ key: number; data: number[] }> {
    return [...this.chunks.entries()].map(([key, chunk]) => ({ key, data: Array.from(chunk) }))
  }

  restoreChunk(key: number, data: number[] | Float32Array): boolean {
    if (!Number.isInteger(key) || key < 0 || key >= CHUNKS_X * CHUNKS_Y * CHUNKS_Z ||
        !data || data.length !== CHUNK_FLOATS) return false
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) return false
    this.chunks.set(key, new Float32Array(data))
    this.dirtyChunks.add(key)
    return true
  }

  restore(snap: Array<{ key: number; data: number[] }>): void {
    // Snapshot restore replaces the complete chunk set. Mark removed keys so
    // frame consumers can clear any geometry/state retained for those chunks.
    for (const key of this.chunks.keys()) this.dirtyChunks.add(key)
    this.chunks.clear()
    for (const { key, data } of snap) {
      this.chunks.set(key, new Float32Array(data))
      this.dirtyChunks.add(key)
    }
  }

  clear(): void {
    // Every previously materialized chunk may already exist downstream. Publish
    // zero-filled dirty payloads for those keys before dropping local storage.
    for (const key of this.chunks.keys()) this.dirtyChunks.add(key)
    this.chunks.clear()
  }

  get stats() {
    const active = this.chunks.size
    const total  = CHUNKS_X * CHUNKS_Y * CHUNKS_Z
    let cells = 0
    for (const c of this.chunks.values()) {
      for (let i = 0; i < CHUNK_FLOATS; i += NF) {
        let any = false
        for (let f = 0; f < NF; f++) {
          if (Math.abs(c[i + f]) > fieldActivityEpsilon(f)) { any = true; break }
        }
        if (any) cells++
      }
    }
    return {
      activeChunks: active,
      totalChunks:  total,
      fillRate:     active / total,
      activeCells:  cells,
      memoryMB:     (active * CHUNK_FLOATS * 4 / 1024 / 1024).toFixed(2),
    }
  }
}
