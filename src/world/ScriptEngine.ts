import { SimulationEngine } from '../simulation/SimulationEngine';
import { CELL_FIELDS, F } from '../core/CellState';
import { Presets, PresetName } from './Presets';

const FIELD_MAP: Record<string, number> = {
  energy: F.ENERGY, density: F.DENSITY, information: F.INFORMATION,
  entropy: F.ENTROPY, temperature: F.TEMPERATURE, bioPotential: F.BIO_POTENTIAL,
  signal: F.SIGNAL, memory: F.MEM_FIELD,
};
const FIELD_MAX: Record<string, number> = {
  energy: 9999, density: 1, information: 999, entropy: 1,
  temperature: 2000, bioPotential: 1, signal: 100, memory: 1,
};

function hash3(a: number, b: number, c: number): number {
  let h = ((a * 1619 + b * 31337 + c * 6271) & 0x7fffffff);
  h = ((h >>> 16) ^ h) * 0x45d9f3b | 0;
  h = ((h >>> 16) ^ h) * 0x45d9f3b | 0;
  return (((h >>> 16) ^ h) & 0xffff) / 0xffff;
}

function valueNoise(nx: number, ny: number, nz: number): number {
  const xi = Math.floor(nx), yi = Math.floor(ny), zi = Math.floor(nz);
  const fx = nx - xi, fy = ny - yi, fz = nz - zi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const sx = s(fx), sy = s(fy), sz = s(fz);
  return hash3(xi,yi,zi)*(1-sx)*(1-sy)*(1-sz) + hash3(xi+1,yi,zi)*sx*(1-sy)*(1-sz)
       + hash3(xi,yi+1,zi)*(1-sx)*sy*(1-sz)   + hash3(xi+1,yi+1,zi)*sx*sy*(1-sz)
       + hash3(xi,yi,zi+1)*(1-sx)*(1-sy)*sz   + hash3(xi+1,yi,zi+1)*sx*(1-sy)*sz
       + hash3(xi,yi+1,zi+1)*(1-sx)*sy*sz     + hash3(xi+1,yi+1,zi+1)*sx*sy*sz;
}

export class ScriptEngine {
  constructor(private sim: SimulationEngine) {}

  buildWorldAPI(log: string[]) {
    const { grid, laws } = this.sim;
    const { W, H, D, buffer: buf } = grid;

    const fi = (name: string) => {
      const f = FIELD_MAP[name];
      if (f === undefined)
        throw new Error(`Unknown field "${name}". Valid: ${Object.keys(FIELD_MAP).join(', ')}`);
      return f;
    };
    const clampV = (name: string, v: number) =>
      Math.min(FIELD_MAX[name] ?? 9999, Math.max(0, v));
    const base = (x: number, y: number, z: number) =>
      (Math.floor(z) * H * W + Math.floor(y) * W + Math.floor(x)) * CELL_FIELDS;

    return {
      W, H, D,

      fill(x: number, y: number, z: number, field: string, value: number) {
        if (!grid.inBounds(Math.floor(x), Math.floor(y), Math.floor(z))) return;
        buf[base(x, y, z) + fi(field)] = clampV(field, value);
      },

      sphere(cx: number, cy: number, cz: number, r: number, field: string, value: number) {
        const f = fi(field); const v = clampV(field, value); const r2 = r * r;
        for (let z = Math.max(0, Math.ceil(cz-r)); z <= Math.min(D-1, Math.floor(cz+r)); z++)
        for (let y = Math.max(0, Math.ceil(cy-r)); y <= Math.min(H-1, Math.floor(cy+r)); y++)
        for (let x = Math.max(0, Math.ceil(cx-r)); x <= Math.min(W-1, Math.floor(cx+r)); x++) {
          if ((x-cx)**2+(y-cy)**2+(z-cz)**2 <= r2)
            buf[(z*H*W+y*W+x)*CELL_FIELDS+f] = v;
        }
      },

      box(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number,
          field: string, value: number) {
        const f = fi(field); const v = clampV(field, value);
        const [xa,xb] = [Math.max(0,Math.floor(Math.min(x1,x2))), Math.min(W-1,Math.floor(Math.max(x1,x2)))];
        const [ya,yb] = [Math.max(0,Math.floor(Math.min(y1,y2))), Math.min(H-1,Math.floor(Math.max(y1,y2)))];
        const [za,zb] = [Math.max(0,Math.floor(Math.min(z1,z2))), Math.min(D-1,Math.floor(Math.max(z1,z2)))];
        for (let z = za; z <= zb; z++)
        for (let y = ya; y <= yb; y++)
        for (let x = xa; x <= xb; x++)
          buf[(z*H*W+y*W+x)*CELL_FIELDS+f] = v;
      },

      layer(z: number, field: string, value: number) {
        const zz = Math.floor(z);
        if (zz < 0 || zz >= D) return;
        const f = fi(field); const v = clampV(field, value);
        for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          buf[(zz*H*W+y*W+x)*CELL_FIELDS+f] = v;
      },

      noise(field: string, scale: number, amplitude: number) {
        const f = fi(field); const mx = FIELD_MAX[field] ?? 9999;
        const sc = Math.max(0.1, scale) * 4;
        for (let z = 0; z < D; z++)
        for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const n = valueNoise(x / W * sc, y / H * sc, z / D * sc);
          const idx = (z*H*W+y*W+x)*CELL_FIELDS+f;
          buf[idx] = Math.min(mx, Math.max(0, buf[idx] + n * amplitude));
        }
      },

      gradient(field: string, axis: 'x'|'y'|'z', v0: number, v1: number) {
        const f = fi(field); const mx = FIELD_MAX[field] ?? 9999;
        const dim = axis === 'x' ? W : axis === 'y' ? H : D;
        for (let z = 0; z < D; z++)
        for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const t = (axis==='x'?x : axis==='y'?y : z) / Math.max(1, dim-1);
          buf[(z*H*W+y*W+x)*CELL_FIELDS+f] = Math.min(mx, Math.max(0, v0+t*(v1-v0)));
        }
      },

      preset(name: string) {
        Presets.apply(grid, name as PresetName);
      },

      spawnEntity(x: number, y: number, z: number) {
        const r = 2;
        for (let dz = -1; dz <= 1; dz++)
        for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx*dx+dy*dy > r*r) continue;
          const nx=Math.floor(x+dx), ny=Math.floor(y+dy), nz=Math.floor(z+dz);
          if (!grid.inBounds(nx, ny, nz)) continue;
          const b = (nz*H*W+ny*W+nx)*CELL_FIELDS;
          buf[b+F.BIO_POTENTIAL] = Math.max(buf[b+F.BIO_POTENTIAL], 0.4+Math.random()*0.3);
          buf[b+F.ENERGY]        = Math.max(buf[b+F.ENERGY],        200+Math.random()*150);
          buf[b+F.INFORMATION]   = Math.max(buf[b+F.INFORMATION],   50+Math.random()*30);
        }
      },

      setLaw(name: string, param: string, value: number) {
        const law = laws.laws.find(l => l.name.toLowerCase().includes(name.toLowerCase()));
        if (!law) throw new Error(`Law not found: "${name}"`);
        (law.paramOverrides as Record<string, number>)[param] = value;
      },

      mutateAllLaws(rate: number) {
        for (const law of laws.laws)
          law.mutationRate = Math.max(0, Math.min(0.1, rate));
      },

      clear() { grid.clear(); },

      tick(n: number) {
        const steps = Math.max(1, Math.min(500, Math.floor(n)));
        // syncTick is on sim
        (this as unknown as { _sim: SimulationEngine })._sim.syncTick(steps);
        log.push(`⏱ Ran ${steps} ticks.`);
      },

      print(msg: unknown) { log.push(String(msg)); },

      // back-ref for tick()
      _sim: this.sim,
    };
  }

  run(code: string): { success: boolean; log: string[] } {
    const log: string[] = [];
    const api = this.buildWorldAPI(log);
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('world', 'W', 'H', 'D', '"use strict";\n' + code);
      fn(api, this.sim.grid.W, this.sim.grid.H, this.sim.grid.D);
      this.sim.syncToGPU();
      if (!log.length) log.push('✓ Done.');
    } catch (e) {
      log.push('✗ ' + (e as Error).message);
      return { success: false, log };
    }
    return { success: true, log };
  }
}

// ── Starter script templates ──────────────────────────────────────────────────
export const SCRIPT_TEMPLATES: Record<string, string> = {
  ocean: `// Primordial Ocean
world.clear()
world.layer(0, 'density', 0.9)
world.layer(1, 'density', 0.65)
world.layer(2, 'density', 0.4)
world.noise('energy', 0.4, 320)
world.noise('temperature', 0.3, 110)
world.noise('information', 0.45, 55)
world.tick(60)
world.print('Primordial ocean ready. Watch bio layer for emergence.')`,

  volcano: `// Energy Volcano
world.clear()
world.box(0, 0, 0, W-1, H-1, 2, 'density', 0.75)
world.noise('density', 0.2, 0.2)
world.sphere(W/2, H/2, 0, 7, 'energy', 950)
world.sphere(W/2, H/2, 0, 5, 'temperature', 650)
world.sphere(W/2, H/2, 0, 2, 'density', 0.02)
world.tick(30)
world.print('Volcanic world ready. Energy erupting from core.')`,

  life: `// Life Explosion
world.clear()
world.noise('energy', 0.4, 260)
world.noise('density', 0.3, 0.5)
world.noise('information', 0.5, 80)
for (let i = 0; i < 12; i++) {
  world.spawnEntity(
    4 + Math.floor(Math.random() * (W-8)),
    4 + Math.floor(Math.random() * (H-8)),
    1 + Math.floor(Math.random() * 3)
  )
}
world.tick(40)
world.print('12 entity seeds planted. Press Play to watch evolution.')`,

  cambrian: `// Cambrian Explosion
world.clear()
world.layer(0, 'density', 0.9)
world.layer(1, 'density', 0.65)
world.layer(2, 'density', 0.35)
world.noise('energy', 0.35, 280)
world.noise('temperature', 0.25, 95)
world.noise('bioPotential', 0.4, 0.55)
world.noise('information', 0.45, 85)
for (let i = 0; i < 10; i++) {
  world.spawnEntity(
    4 + Math.floor(Math.random() * (W-8)),
    4 + Math.floor(Math.random() * (H-8)),
    1 + Math.floor(Math.random() * 3)
  )
}
world.tick(80)
world.print('Cambrian conditions set. Diversity explosion imminent.')`,

  infoage: `// Information Age
world.clear()
world.gradient('energy', 'z', 380, 40)
world.noise('density', 0.3, 0.45)
world.noise('information', 0.5, 200)
world.box(0, 0, 0, W-1, H-1, 0, 'density', 0.8)
for (let i = 0; i < 8; i++) {
  world.spawnEntity(
    4 + Math.floor(Math.random() * (W-8)),
    4 + Math.floor(Math.random() * (H-8)),
    1
  )
}
world.print('Information-rich world seeded. Entities will evolve fast cognition.')`,
};
