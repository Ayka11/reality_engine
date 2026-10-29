import { F } from '../core/CellState';

type Grid = {
  buffer: Float32Array;
  W: number; H: number; D: number;
  inBounds(x: number, y: number, z: number): boolean;
  idx(x: number, y: number, z: number): number;
};

export type SmartBrushPaintFn = (grid: Grid, cx: number, cy: number, r: number, selZ: number) => void;
export interface SmartBrush { icon: string; desc: string; paint: SmartBrushPaintFn; }

export const SMART_BRUSHES: Record<string, SmartBrush> = {
  'Volcano': {
    icon:'🌋', desc:'Hot dense core with energy eruption',
    paint(grid, cx, cy, r) {
      const { buffer: buf, W, H, D } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, 0)) continue;
        const g = Math.exp(-d*d / (r*r) * 2);
        for (let z = 0; z < Math.min(D, 4); z++) {
          const bi = grid.idx(nx, ny, z);
          buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + g*900);
          buf[bi+F.DENSITY]     = Math.min(1,    buf[bi+F.DENSITY]     + g*0.7);
          buf[bi+F.TEMPERATURE] = Math.min(2000, buf[bi+F.TEMPERATURE] + g*600);
          buf[bi+F.ENTROPY]     = Math.min(1,    buf[bi+F.ENTROPY]     + g*0.2);
        }
        void W; void H;
      }
    },
  },
  'Forest': {
    icon:'🌲', desc:'Dense bio + information cluster',
    paint(grid, cx, cy, r, selZ) {
      const { buffer: buf, W, H } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, selZ)) continue;
        const g = Math.exp(-d*d / (r*r) * 1.5);
        const bi = grid.idx(nx, ny, selZ);
        buf[bi+F.ENERGY]        = Math.min(9999, buf[bi+F.ENERGY]        + g*200);
        buf[bi+F.DENSITY]       = Math.min(1,    buf[bi+F.DENSITY]       + g*0.5);
        buf[bi+F.INFORMATION]   = Math.min(999,  buf[bi+F.INFORMATION]   + g*180);
        buf[bi+F.BIO_POTENTIAL] = Math.min(1,    buf[bi+F.BIO_POTENTIAL] + g*0.7);
        buf[bi+F.TEMPERATURE]   = Math.min(2000, buf[bi+F.TEMPERATURE]   + g*80);
        buf[bi+F.ENTROPY]       = Math.max(0,    buf[bi+F.ENTROPY]       - g*0.05);
        void W; void H;
      }
    },
  },
  'Ocean': {
    icon:'🌊', desc:'Dense, cool, info-rich water body',
    paint(grid, cx, cy, r) {
      const { buffer: buf, D } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, 0)) continue;
        const g = 1 - d/r;
        for (let z = 0; z < Math.min(D, 5); z++) {
          const bi = grid.idx(nx, ny, z);
          buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + g*80);
          buf[bi+F.DENSITY]     = Math.min(1,    Math.max(buf[bi+F.DENSITY],     g*0.7));
          buf[bi+F.TEMPERATURE] = Math.min(2000, Math.max(buf[bi+F.TEMPERATURE], g*70));
          buf[bi+F.INFORMATION] = Math.min(999,  buf[bi+F.INFORMATION] + g*40);
        }
      }
    },
  },
  'Crystal': {
    icon:'💎', desc:'High energy, ultra-low entropy, ordered diamond pattern',
    paint(grid, cx, cy, r, selZ) {
      const { buffer: buf } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== Math.abs(dy) && dx !== 0 && dy !== 0) continue;
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, selZ)) continue;
        const bi = grid.idx(nx, ny, selZ);
        buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + 700);
        buf[bi+F.DENSITY]     = Math.min(1,    buf[bi+F.DENSITY]     + 0.8);
        buf[bi+F.ENTROPY]     = Math.max(0,    buf[bi+F.ENTROPY]     - 0.08);
        buf[bi+F.INFORMATION] = Math.min(999,  buf[bi+F.INFORMATION] + 250);
      }
    },
  },
  'Storm': {
    icon:'⚡', desc:'Turbulent energy + entropy surge',
    paint(grid, cx, cy, r, selZ) {
      const { buffer: buf } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, selZ)) continue;
        const noise = (Math.sin(nx*0.7+ny*0.5)*Math.cos(nx*0.3+ny*0.8)+1)/2;
        const bi = grid.idx(nx, ny, selZ);
        buf[bi+F.ENERGY]      = Math.min(9999, buf[bi+F.ENERGY]      + noise*500);
        buf[bi+F.ENTROPY]     = Math.min(1,    buf[bi+F.ENTROPY]     + 0.15);
        buf[bi+F.TEMPERATURE] = Math.min(2000, buf[bi+F.TEMPERATURE] + noise*200);
      }
    },
  },
  'Life Cluster': {
    icon:'🧬', desc:'Balanced conditions for immediate life emergence',
    paint(grid, cx, cy, r, selZ) {
      const { buffer: buf } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, selZ)) continue;
        const g = Math.exp(-d*d / (r*r) * 2);
        const bi = grid.idx(nx, ny, selZ);
        buf[bi+F.ENERGY]        = Math.min(9999, buf[bi+F.ENERGY]        + g*300);
        buf[bi+F.DENSITY]       = Math.min(1,    buf[bi+F.DENSITY]       + g*0.4);
        buf[bi+F.INFORMATION]   = Math.min(999,  buf[bi+F.INFORMATION]   + g*200);
        buf[bi+F.BIO_POTENTIAL] = Math.min(1,    buf[bi+F.BIO_POTENTIAL] + g*0.6);
        buf[bi+F.ENTROPY]       = Math.max(0,    buf[bi+F.ENTROPY]       - g*0.1);
        buf[bi+F.TEMPERATURE]   = Math.min(2000, buf[bi+F.TEMPERATURE]   + g*120);
      }
    },
  },
  'Radiation': {
    icon:'☢️', desc:'High entropy + info disruption zone',
    paint(grid, cx, cy, r, selZ) {
      const { buffer: buf, D } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, 0)) continue;
        const g = 1 - d/r;
        for (let z = 0; z < D; z++) {
          const bi = grid.idx(nx, ny, z);
          buf[bi+F.ENTROPY]     = Math.min(1,   buf[bi+F.ENTROPY]     + g*0.3);
          buf[bi+F.INFORMATION] = Math.max(0,   buf[bi+F.INFORMATION] - g*50);
        }
        void selZ;
      }
    },
  },
  'Civilization Seed': {
    icon:'🏛️', desc:'Optimal conditions for civilization emergence',
    paint(grid, cx, cy, r, selZ) {
      const { buffer: buf } = grid;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx*dx+dy*dy); if (d > r) continue;
        const nx = cx+dx, ny = cy+dy; if (!grid.inBounds(nx, ny, selZ)) continue;
        const g = Math.exp(-d*d / (r*r) * 1.5);
        const bi = grid.idx(nx, ny, selZ);
        buf[bi+F.ENERGY]        = Math.min(9999, buf[bi+F.ENERGY]        + g*400);
        buf[bi+F.DENSITY]       = Math.min(1,    buf[bi+F.DENSITY]       + g*0.5);
        buf[bi+F.INFORMATION]   = Math.min(999,  buf[bi+F.INFORMATION]   + g*400);
        buf[bi+F.BIO_POTENTIAL] = Math.min(1,    buf[bi+F.BIO_POTENTIAL] + g*0.8);
        buf[bi+F.ENTROPY]       = Math.max(0,    buf[bi+F.ENTROPY]       - g*0.15);
        buf[bi+F.TEMPERATURE]   = Math.min(2000, buf[bi+F.TEMPERATURE]   + g*100);
      }
    },
  },
};
