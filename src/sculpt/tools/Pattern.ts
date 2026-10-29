import { F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';
import { patternValue } from '../ProceduralBrushes';

export class PatternTool implements SculptTool {
  id = 'pattern' as const;
  label = 'Pattern';

  apply(ctx: SculptToolContext): void {
    const p = patternValue(ctx.x - ctx.stroke.position[0], ctx.y - ctx.stroke.position[1], ctx.z - ctx.stroke.position[2], Number(ctx.stroke.parameters.noiseScale ?? 8));
    const fields = ctx.stroke.parameters.fields ?? {};
    const amount = ctx.stroke.strength * ctx.weight * p;
    const base = ctx.grid.idx(ctx.x, ctx.y, ctx.z);
    ctx.grid.buffer[base + F.ENERGY] = Math.min(9999, ctx.grid.buffer[base + F.ENERGY] + amount * 8 * (fields.energy ?? 0));
    ctx.grid.buffer[base + F.DENSITY] = Math.min(1, ctx.grid.buffer[base + F.DENSITY] + amount * 0.01 * (fields.density ?? 0));
    ctx.grid.buffer[base + F.INFORMATION] = Math.min(999, ctx.grid.buffer[base + F.INFORMATION] + amount * 1.5 * (fields.information ?? 0));
  }
}
