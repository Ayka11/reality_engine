import { hash3 } from './WorldSeed'

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Smooth deterministic 3D value noise in [0,1]. */
export function valueNoise3D(x: number, y: number, z: number, seed: string | number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z)
  const tx = fade(x - x0), ty = fade(y - y0), tz = fade(z - z0)

  const n000 = hash3(seed, x0, y0, z0)
  const n100 = hash3(seed, x0 + 1, y0, z0)
  const n010 = hash3(seed, x0, y0 + 1, z0)
  const n110 = hash3(seed, x0 + 1, y0 + 1, z0)
  const n001 = hash3(seed, x0, y0, z0 + 1)
  const n101 = hash3(seed, x0 + 1, y0, z0 + 1)
  const n011 = hash3(seed, x0, y0 + 1, z0 + 1)
  const n111 = hash3(seed, x0 + 1, y0 + 1, z0 + 1)

  const x00 = lerp(n000, n100, tx)
  const x10 = lerp(n010, n110, tx)
  const x01 = lerp(n001, n101, tx)
  const x11 = lerp(n011, n111, tx)
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz)
}

export function fbm3D(
  x: number, y: number, z: number,
  seed: string | number,
  octaves = 5,
  lacunarity = 2,
  gain = 0.5,
): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise3D(x * freq, y * freq, z * freq, `${seed}:${i}`) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return norm > 0 ? sum / norm : 0
}

export function ridgedFbm3D(
  x: number, y: number, z: number,
  seed: string | number,
  octaves = 5,
): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let weight = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(valueNoise3D(x * freq, y * freq, z * freq, `${seed}:r${i}`) * 2 - 1)
    n *= n
    n *= weight
    weight = Math.min(1, Math.max(0, n * 2))
    sum += n * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return norm > 0 ? sum / norm : 0
}
