import { CELL_FIELDS, F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';

export class SmoothTool implements SculptTool {
  id = 'smooth' as const;
  label = 'Smooth';

  apply(ctx: SculptToolContext): void {
    const base = ctx.grid.idx(ctx.x, ctx.y, ctx.z);
    const neighbors = ctx.grid.neighbors6(ctx.x, ctx.y, ctx.z);
    if (!neighbors.length) return;
    for (const field of [F.ENERGY, F.DENSITY, F.INFORMATION, F.ENTROPY, F.TEMPERATURE, F.BIO_POTENTIAL]) {
      let sum = 0;
      for (const [nx, ny, nz] of neighbors) sum += ctx.grid.buffer[ctx.grid.idx(nx, ny, nz) + field];
      const avg = sum / neighbors.length;
      const t = Math.min(1, ctx.stroke.strength * ctx.weight * 0.65);
      ctx.grid.buffer[base + field] = ctx.grid.buffer[base + field] * (1 - t) + avg * t;
    }
    void CELL_FIELDS;
  }
}
