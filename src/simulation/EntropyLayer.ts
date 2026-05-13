import { VoxelGrid } from '../core/VoxelGrid';
import { PhysicsParams } from '../laws/MetaLaw';
import { PROC } from '../process/ProcessDef';

function on(mask: number, proc: number) { return (mask & (1 << proc)) !== 0; }

export class EntropyLayer {
  tick(grid: VoxelGrid, dt: number, p: Readonly<PhysicsParams>, mask: number): void {
    const {W, H, D} = grid;

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cell = grid.cell(x, y, z);

      if (on(mask, PROC.ENTROPY_GROWTH)) {
        const dS = (p.entropyGrowthRate
          + cell.energy * p.entropyEnergyCoupling
          + cell.temperature * 0.00005) * dt;
        cell.entropy = Math.min(1, cell.entropy + dS);
        cell.energy  = Math.max(0, cell.energy * (1 - cell.entropy * 0.0005 * dt * 60));
      }

      if (on(mask, PROC.INFORMATION)) {
        const supp = 1 - cell.entropy * p.infoEntropySupp;
        if (cell.energy > p.infoGrowthThreshE && cell.density > p.infoGrowthThreshD && supp > 0) {
          cell.information = Math.min(999, cell.information + p.infoGrowthRate * supp * dt);
        } else {
          cell.information *= Math.pow(1 - 0.001, dt * 60);
        }
      }

      if (on(mask, PROC.BIO_POTENTIAL)) {
        const bio = (cell.information / 200) * 0.4
          + Math.min(cell.energy / 500, 1) * 0.3
          + cell.density * 0.2
          + (1 - cell.entropy) * 0.1;
        cell.bioPotential = Math.max(0, Math.min(1, bio));
      }

      if (on(mask, PROC.METABOLISM) && cell.bioPotential > 0.45) {
        const rate = cell.bioPotential * 0.12 * dt;
        cell.energy      = Math.max(0, cell.energy - rate * 60);
        cell.information = Math.min(999, cell.information + rate * 25);
        cell.entropy     = Math.min(1, cell.entropy + rate * 0.008);
      }

      cell.localTime += dt * p.timeBaseRate * (1 + cell.energy * p.timeEnergyBoost + cell.entropy * 0.5);
    }
  }
}
