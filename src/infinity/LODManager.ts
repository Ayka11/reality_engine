export type LODLevel = 0 | 1 | 2 | 3

export function lodForDistance(distanceChunks: number): LODLevel {
  if (distanceChunks <= 2) return 0
  if (distanceChunks <= 4) return 1
  if (distanceChunks <= 8) return 2
  return 3
}

export function lodResolution(level: LODLevel): number {
  // LOD 0 is nearest to the observer and must have the finest mesh.
  // A 32-cell chunk uses progressively coarser grids as distance increases.
  switch (level) {
    case 0: return 32
    case 1: return 16
    case 2: return 8
    default: return 4
  }
}
