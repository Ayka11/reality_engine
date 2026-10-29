import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import { PhysicsParams } from '../laws/MetaLaw';
import { PROC } from '../process/ProcessDef';
import { withMutableBuffers } from '../core/TrackedFloat32Array';

function on(mask: number, proc: number) { return (mask & (1 << proc)) !== 0; }

export class EntropyLayer {
  tick(grid: VoxelGrid, dt: number, p: Readonly<PhysicsParams>, mask: number): void {
    withMutableBuffers(grid, (front, _back) => {
      const { size } = grid;

      for (let i = 0; i < size; i++) {
        const base = i * CELL_FIELDS;

        if (on(mask, PROC.ENTROPY_GROWTH)) {
          const dS = (p.entropyGrowthRate
            + front[base + F.ENERGY] * p.entropyEnergyCoupling
            + front[base + F.TEMPERATURE] * 0.00005) * dt;
          front[base + F.ENTROPY] = Math.min(1, front[base + F.ENTROPY] + dS);
          front[base + F.ENERGY] = Math.max(0,
            front[base + F.ENERGY] * (1 - front[base + F.ENTROPY] * 0.0005 * dt * 60));
        }

        if (on(mask, PROC.INFORMATION)) {
          const supp = 1 - front[base + F.ENTROPY] * p.infoEntropySupp;
          if (front[base + F.ENERGY] > p.infoGrowthThreshE &&
              front[base + F.DENSITY] > p.infoGrowthThreshD && supp > 0) {
            front[base + F.INFORMATION] = Math.min(999,
              front[base + F.INFORMATION] + p.infoGrowthRate * supp * dt);
          } else {
            front[base + F.INFORMATION] *= Math.pow(1 - 0.001, dt * 60);
          }
        }

        if (on(mask, PROC.BIO_POTENTIAL)) {
          const bio = (front[base + F.INFORMATION] / 200) * 0.4
            + Math.min(front[base + F.ENERGY] / 500, 1) * 0.3
            + front[base + F.DENSITY] * 0.2
            + (1 - front[base + F.ENTROPY]) * 0.1;
          front[base + F.BIO_POTENTIAL] = Math.max(0, Math.min(1, bio));
        }

        if (on(mask, PROC.METABOLISM) && front[base + F.BIO_POTENTIAL] > 0.45) {
          const rate = front[base + F.BIO_POTENTIAL] * 0.12 * dt;
          front[base + F.ENERGY] = Math.max(0, front[base + F.ENERGY] - rate * 60);
          front[base + F.INFORMATION] = Math.min(999, front[base + F.INFORMATION] + rate * 25);
          front[base + F.ENTROPY] = Math.min(1, front[base + F.ENTROPY] + rate * 0.008);
        }

        front[base + F.LOCAL_TIME] += dt * p.timeBaseRate *
          (1 + front[base + F.ENERGY] * p.timeEnergyBoost + front[base + F.ENTROPY] * 0.5);
      }
    });
  }
}
