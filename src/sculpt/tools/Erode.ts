import { F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';

export class ErodeTool implements SculptTool {
  id = 'erode' as const;
  label = 'Erode';

  apply(ctx: SculptToolContext): void {
    const base = ctx.grid.idx(ctx.x, ctx.y, ctx.z);
    const amount = ctx.stroke.strength * ctx.weight;
    ctx.grid.buffer[base + F.DENSITY] = Math.max(0, ctx.grid.buffer[base + F.DENSITY] - amount * 0.01);
    ctx.grid.buffer[base + F.ENTROPY] = Math.min(1, ctx.grid.buffer[base + F.ENTROPY] + amount * 0.006);
    ctx.grid.buffer[base + F.TEMPERATURE] = Math.max(0, ctx.grid.buffer[base + F.TEMPERATURE] - amount * 1.5);
  }
}
