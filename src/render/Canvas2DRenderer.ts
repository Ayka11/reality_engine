import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';

export type LayerName = 'energy' | 'density' | 'information' | 'entropy' | 'temperature' | 'bioPotential';

const FIELD_MAP: Record<LayerName, number> = {
  energy:       F.ENERGY,
  density:      F.DENSITY,
  information:  F.INFORMATION,
  entropy:      F.ENTROPY,
  temperature:  F.TEMPERATURE,
  bioPotential: F.BIO_POTENTIAL,
};

const MAX_MAP: Record<LayerName, number> = {
  energy: 1000, density: 1, information: 500,
  entropy: 1, temperature: 800, bioPotential: 1,
};

function colorEnergy(t: number): [number,number,number] {
  if (t < 0.15) return [0, 0, Math.round(t / 0.15 * 180)];
  if (t < 0.4) { const s=(t-0.15)/0.25; return [0, Math.round(s*180), Math.round(180-s*180)]; }
  if (t < 0.7) { const s=(t-0.4)/0.3; return [Math.round(s*255), Math.round(180-s*60), 0]; }
  const s=(t-0.7)/0.3; return [255, Math.round(120+s*135), Math.round(s*255)];
}
function colorDensity(t: number): [number,number,number] {
  if (t < 0.3) return [0, Math.round(t/0.3*80), Math.round(t/0.3*30)];
  if (t < 0.7) { const s=(t-0.3)/0.4; return [Math.round(s*60), Math.round(80+s*120), Math.round(30+s*20)]; }
  const s=(t-0.7)/0.3; return [Math.round(60+s*200), Math.round(200+s*55), Math.round(50+s*20)];
}
function colorInfo(t: number): [number,number,number] {
  if (t < 0.3) return [Math.round(t/0.3*60), 0, Math.round(t/0.3*80)];
  if (t < 0.65) { const s=(t-0.3)/0.35; return [Math.round(60+s*130), Math.round(s*20), Math.round(80+s*160)]; }
  const s=(t-0.65)/0.35; return [Math.round(190+s*65), Math.round(20+s*160), Math.round(240+s*15)];
}
function colorEntropy(t: number): [number,number,number] {
  return [Math.round(t*200), Math.round(t*50), Math.round(50+t*50)];
}
function colorTemperature(t: number): [number,number,number] {
  if (t < 0.5) return [Math.round(t*2*255), 0, Math.round((1-t*2)*200)];
  const s=(t-0.5)/0.5; return [255, Math.round(s*200), 0];
}
function colorBio(t: number): [number,number,number] {
  return [Math.round(t*50), Math.round(t*200), Math.round(t*80)];
}

function getColor(layer: LayerName, t: number): [number,number,number] {
  switch(layer) {
    case 'energy':       return colorEnergy(t);
    case 'density':      return colorDensity(t);
    case 'information':  return colorInfo(t);
    case 'entropy':      return colorEntropy(t);
    case 'temperature':  return colorTemperature(t);
    case 'bioPotential': return colorBio(t);
  }
}

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  layer: LayerName = 'energy';
  zSlice = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  render(grid: VoxelGrid): void {
    const { W, H } = grid;
    const cw = this.canvas.width, ch = this.canvas.height;
    this.ctx.fillStyle = '#0a0a12';
    this.ctx.fillRect(0, 0, cw, ch);
    const cs = Math.min(cw / W, ch / H);
    const ox = (cw - cs * W) / 2, oy = (ch - cs * H) / 2;
    const fieldIdx = FIELD_MAP[this.layer];
    const maxVal = MAX_MAP[this.layer];
    const z = Math.min(this.zSlice, grid.D - 1);

    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cell = grid.cell(x, y, z);
      const v = cell.get(fieldIdx);
      if (v < 0.001) continue;
      const t = Math.min(v / maxVal, 1);
      const [r,g,b] = getColor(this.layer, t);
      this.ctx.fillStyle = `rgb(${r},${g},${b})`;
      this.ctx.fillRect(ox + x*cs + 0.5, oy + y*cs + 0.5, cs-1, cs-1);
    }
  }
}
