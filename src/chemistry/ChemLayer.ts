import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export const CHEM = {
  GAS:      0,
  LIQUID:   1,
  SOLID:    2,
  ORGANIC:  3,
  REACTIVE: 4,
} as const;
export type ChemState = typeof CHEM[keyof typeof CHEM];

export class ChemLayer {
  tick(grid: VoxelGrid, dt: number): void {
    const { W, H, D, buffer: buf } = grid;
    const WH = W * H;

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i    = z * WH + y * W + x;
      const base = i * CELL_FIELDS;

      const energy  = buf[base + F.ENERGY];
      const temp    = buf[base + F.TEMPERATURE];
      const density = buf[base + F.DENSITY];
      const entropy = buf[base + F.ENTROPY];
      const info    = buf[base + F.INFORMATION];
      const chem    = buf[base + F.CHEM_STATE];

      // ── Auto-derive chemical state from physics fields ─────────────────────
      let newChem = chem;
      if (temp > 600 && density < 0.2)        newChem = CHEM.GAS;
      else if (temp > 400)                     newChem = CHEM.GAS;
      else if (density > 0.6 && temp < 80)    newChem = CHEM.SOLID;
      else if (density > 0.1 && temp < 350)   newChem = CHEM.LIQUID;
      // Organic and reactive states are only set externally (by material or presets)
      // and persist unless conditions change drastically
      if ((chem === CHEM.ORGANIC || chem === CHEM.REACTIVE) && energy < 10) newChem = CHEM.SOLID;
      buf[base + F.CHEM_STATE] = newChem;

      // ── Reaction rules ─────────────────────────────────────────────────────

      // Rule 1: Combustion — organic + high energy → energy burst, entropy surge
      if (newChem === CHEM.ORGANIC && energy > 500) {
        buf[base + F.ENERGY]    = Math.min(9999, energy + 300 * dt * 60);
        buf[base + F.ENTROPY]   = Math.min(1, entropy + 0.12 * dt * 60);
        buf[base + F.TEMPERATURE] = Math.min(9999, temp + 200 * dt * 60);
        buf[base + F.CHEM_STATE]  = CHEM.GAS;
      }

      // Rule 2: Freezing — liquid at very low temp → solid with density gain
      if (newChem === CHEM.LIQUID && temp < 30) {
        buf[base + F.DENSITY]    = Math.min(1, density + 0.04 * dt * 60);
        buf[base + F.ENTROPY]    = Math.max(0, entropy - 0.03 * dt * 60);
        buf[base + F.CHEM_STATE] = CHEM.SOLID;
      }

      // Rule 3: Catalysis — reactive cells boost information growth
      if (newChem === CHEM.REACTIVE && energy > 50) {
        buf[base + F.INFORMATION] = Math.min(999, info + 12 * dt);
        buf[base + F.ENERGY]      = Math.max(0, energy - 5 * dt * 60);
      }

      // Rule 4: Dissolution — liquid touching solid neighbors transfers density
      if (newChem === CHEM.LIQUID && density > 0.3) {
        const neighbors = [
          x > 0 ?   (i-1)    : -1,
          x < W-1 ? (i+1)    : -1,
          y > 0 ?   (i-W)    : -1,
          y < H-1 ? (i+W)    : -1,
          z > 0 ?   (i-WH)   : -1,
          z < D-1 ? (i+WH)   : -1,
        ];
        for (const ni of neighbors) {
          if (ni < 0) continue;
          const nb = ni * CELL_FIELDS;
          if (buf[nb + F.CHEM_STATE] === CHEM.SOLID) {
            const transfer = 0.002 * dt * 60;
            buf[nb + F.DENSITY]   = Math.max(0, buf[nb + F.DENSITY] - transfer);
            buf[base + F.DENSITY] = Math.min(1, density + transfer * 0.5);
          }
        }
      }
    }
  }
}
