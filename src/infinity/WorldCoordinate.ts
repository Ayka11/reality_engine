export type ChunkCoord = { cx: number; cy: number; cz: number }
export type LocalCoord = { lx: number; ly: number; lz: number }

export const WORLD_CHUNK_SIZE = 32
export const WORLD_CHUNK_HEIGHT = 64

/** Mathematical floor division for negative world coordinates. */
export function floorDiv(n: number, d = WORLD_CHUNK_SIZE): number {
  return Math.floor(n / d)
}

export function mod(n: number, d = WORLD_CHUNK_SIZE): number {
  return ((n % d) + d) % d
}

export function worldToChunk(x: number, y: number, z: number): { chunk: ChunkCoord; local: LocalCoord } {
  return {
    chunk: { cx: floorDiv(x), cy: floorDiv(y, WORLD_CHUNK_HEIGHT), cz: floorDiv(z) },
    local: {
      lx: mod(x),
      ly: mod(y, WORLD_CHUNK_HEIGHT),
      lz: mod(z),
    },
  }
}

export function chunkOrigin(cx: number, cy: number, cz: number) {
  return {
    x: cx * WORLD_CHUNK_SIZE,
    y: cy * WORLD_CHUNK_HEIGHT,
    z: cz * WORLD_CHUNK_SIZE,
  }
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`
}

export function parseChunkKey(key: string): ChunkCoord {
  const [cx, cy, cz] = key.split(',').map(Number)
  if (![cx, cy, cz].every(Number.isInteger)) throw new Error(`Invalid chunk key: ${key}`)
  return { cx, cy, cz }
}
