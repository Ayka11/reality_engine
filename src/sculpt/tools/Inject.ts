import { F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';

function addField(ctx: SculptToolContext, field: number, value: number, max: number): void {
  const offset = ctx.grid.idx(ctx.x, ctx.y, ctx.z) + field;
  ctx.grid.buffer[offset] = Math.min(max, Math.max(0, ctx.grid.buffer[offset] + value));
}

export class InjectTool implements SculptTool {
  id = 'inject' as const;
  label = 'Inject';

  apply(ctx: SculptToolContext): void {
    const fields = ctx.stroke.parameters.fields ?? {};
    const amount = ctx.stroke.strength * ctx.weight;
    addField(ctx, F.ENERGY, amount * 12 * (fields.energy ?? 0), 9999);
    addField(ctx, F.DENSITY, amount * 0.012 * (fields.density ?? 0), 1);
    addField(ctx, F.TEMPERATURE, amount * 8 * (fields.temperature ?? 0), 2000);
    addField(ctx, F.BIO_POTENTIAL, amount * 0.01 * (fields.bio ?? 0), 1);
    addField(ctx, F.INFORMATION, amount * 2 * (fields.information ?? 0), 999);
    addField(ctx, F.ENTROPY, amount * 0.005 * (fields.entropy ?? 0), 1);

    if (typeof ctx.stroke.parameters.materialId === 'number' && ctx.stroke.parameters.materialId > 0) {
      ctx.grid.buffer[ctx.grid.idx(ctx.x, ctx.y, ctx.z) + F.MATERIAL_ID] = ctx.stroke.parameters.materialId;
    }
  }
}
