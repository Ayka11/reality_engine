export type LODLevel = 0 | 1 | 2 | 3

export function lodForDistance(distanceChunks: number): LODLevel {
  if (distanceChunks <= 2) return 0
  if (distanceChunks <= 4) return 1
  if (distanceChunks <= 8) return 2
  return 3
}

export function lodResolution(level: LODLevel): number {
  switch (level) {
    case 0: return 1
    case 1: return 2
    case 2: return 4
    default: return 8
  }
}
