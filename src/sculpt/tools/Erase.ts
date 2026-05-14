import { F } from '../../core/CellState';
import type { SculptTool, SculptToolContext } from '../SculptTool';

export class EraseTool implements SculptTool {
  id = 'erase' as const;
  label = 'Erase';

  apply(ctx: SculptToolContext): void {
    const fade = Math.max(0, 1 - ctx.weight * ctx.stroke.strength);
    const base = ctx.grid.idx(ctx.x, ctx.y, ctx.z);
    for (const field of [F.ENERGY, F.DENSITY, F.INFORMATION, F.ENTROPY, F.TEMPERATURE, F.BIO_POTENTIAL, F.SIGNAL, F.MEM_FIELD]) {
      ctx.grid.buffer[base + field] *= fade;
    }
    if (fade < 0.08) ctx.grid.buffer[base + F.MATERIAL_ID] = 0;
  }
}
