function hash3(x: number, y: number, z: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise3(x: number, y: number, z: number, seed = 1): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smoothstep(x - ix), fy = smoothstep(y - iy), fz = smoothstep(z - iz);
  let value = 0;

  for (let dz = 0; dz <= 1; dz++)
  for (let dy = 0; dy <= 1; dy++)
  for (let dx = 0; dx <= 1; dx++) {
    const wx = dx ? fx : 1 - fx;
    const wy = dy ? fy : 1 - fy;
    const wz = dz ? fz : 1 - fz;
    value += hash3(ix + dx, iy + dy, iz + dz, seed) * wx * wy * wz;
  }

  return value;
}

export function fbm3(x: number, y: number, z: number, seed = 1, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    value += valueNoise3(x * freq, y * freq, z * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }

  return norm > 0 ? value / norm : value;
}

export function patternValue(x: number, y: number, z: number, scale = 8): number {
  const stripes = Math.sin((x + z) / Math.max(1, scale) * Math.PI);
  const rings = Math.sin(Math.sqrt(x * x + y * y + z * z) / Math.max(1, scale) * Math.PI * 2);
  return (stripes * 0.5 + rings * 0.5 + 1) * 0.5;
}
