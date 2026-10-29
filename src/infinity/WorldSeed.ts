/** Deterministic, dependency-free hashing for an effectively unbounded world. */
export function hashString(seed: string | number): number {
  const s = String(seed)
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function hash3(seed: string | number, x: number, y: number, z: number): number {
  let h = hashString(seed)
  h ^= Math.imul(x | 0, 374761393) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  h ^= Math.imul(y | 0, 668265263) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0
  h ^= Math.imul(z | 0, 3266489917) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

export function hash2(seed: string | number, x: number, z: number): number {
  return hash3(seed, x, 0, z)
}
