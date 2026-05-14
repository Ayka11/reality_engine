import { F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';

export class StampTool implements SculptTool {
  id = 'stamp' as const;
  label = 'Stamp';

  apply(ctx: SculptToolContext): void {
    const rel = [
      Math.round(ctx.x - ctx.stroke.position[0]),
      Math.round(ctx.y - ctx.stroke.position[1]),
      Math.round(ctx.z - ctx.stroke.position[2]),
    ];
    const lattice = (Math.abs(rel[0]) % 4 === 0 || Math.abs(rel[1]) % 4 === 0 || Math.abs(rel[2]) % 4 === 0) ? 1 : 0.2;
    const base = ctx.grid.idx(ctx.x, ctx.y, ctx.z);
    ctx.grid.buffer[base + F.DENSITY] = Math.min(1, ctx.grid.buffer[base + F.DENSITY] + lattice * ctx.weight * 0.02);
    ctx.grid.buffer[base + F.INFORMATION] = Math.min(999, ctx.grid.buffer[base + F.INFORMATION] + lattice * ctx.weight * ctx.stroke.strength);
  }
}
