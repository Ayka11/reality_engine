import { F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';
import { fbm3 } from '../ProceduralBrushes';

export class NoiseTool implements SculptTool {
  id = 'noise' as const;
  label = 'Noise';

  apply(ctx: SculptToolContext): void {
    const fields = ctx.stroke.parameters.fields ?? {};
    const scale = Number(ctx.stroke.parameters.noiseScale ?? 10);
    const seed = Number(ctx.stroke.parameters.seed ?? 1);
    const n = fbm3(ctx.x / scale, ctx.y / scale, ctx.z / scale, seed, 4);
    const amount = ctx.stroke.strength * ctx.weight * n;
    const base = ctx.grid.idx(ctx.x, ctx.y, ctx.z);
    ctx.grid.buffer[base + F.ENERGY] = Math.min(9999, ctx.grid.buffer[base + F.ENERGY] + amount * 10 * (fields.energy ?? 0));
    ctx.grid.buffer[base + F.INFORMATION] = Math.min(999, ctx.grid.buffer[base + F.INFORMATION] + amount * 2 * (fields.information ?? 0));
    ctx.grid.buffer[base + F.BIO_POTENTIAL] = Math.min(1, ctx.grid.buffer[base + F.BIO_POTENTIAL] + amount * 0.01 * (fields.bio ?? 0));
    ctx.grid.buffer[base + F.TEMPERATURE] = Math.min(2000, ctx.grid.buffer[base + F.TEMPERATURE] + amount * 6 * (fields.temperature ?? 0));
  }
}
