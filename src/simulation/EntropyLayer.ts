import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import { PhysicsParams } from '../laws/MetaLaw';
import { PROC } from '../process/ProcessDef';
import { getMutableBuffer } from '../core/TrackedFloat32Array';

function on(mask: number, proc: number) { return (mask & (1 << proc)) !== 0; }

export class EntropyLayer {
  tick(grid: VoxelGrid, dt: number, p: Readonly<PhysicsParams>, mask: number): void {
    const buf = getMutableBuffer(grid);
    const { size } = grid;

    for (let i = 0; i < size; i++) {
      const base = i * CELL_FIELDS;

      if (on(mask, PROC.ENTROPY_GROWTH)) {
        const dS = (p.entropyGrowthRate
          + buf[base + F.ENERGY] * p.entropyEnergyCoupling
          + buf[base + F.TEMPERATURE] * 0.00005) * dt;
        buf[base + F.ENTROPY] = Math.min(1, buf[base + F.ENTROPY] + dS);
        buf[base + F.ENERGY] = Math.max(0,
          buf[base + F.ENERGY] * (1 - buf[base + F.ENTROPY] * 0.0005 * dt * 60));
      }

      if (on(mask, PROC.INFORMATION)) {
        const supp = 1 - buf[base + F.ENTROPY] * p.infoEntropySupp;
        if (buf[base + F.ENERGY] > p.infoGrowthThreshE &&
            buf[base + F.DENSITY] > p.infoGrowthThreshD && supp > 0) {
          buf[base + F.INFORMATION] = Math.min(999,
            buf[base + F.INFORMATION] + p.infoGrowthRate * supp * dt);
        } else {
          buf[base + F.INFORMATION] *= Math.pow(1 - 0.001, dt * 60);
        }
      }

      if (on(mask, PROC.BIO_POTENTIAL)) {
        const bio = (buf[base + F.INFORMATION] / 200) * 0.4
          + Math.min(buf[base + F.ENERGY] / 500, 1) * 0.3
          + buf[base + F.DENSITY] * 0.2
          + (1 - buf[base + F.ENTROPY]) * 0.1;
        buf[base + F.BIO_POTENTIAL] = Math.max(0, Math.min(1, bio));
      }

      if (on(mask, PROC.METABOLISM) && buf[base + F.BIO_POTENTIAL] > 0.45) {
        const rate = buf[base + F.BIO_POTENTIAL] * 0.12 * dt;
        buf[base + F.ENERGY] = Math.max(0, buf[base + F.ENERGY] - rate * 60);
        buf[base + F.INFORMATION] = Math.min(999, buf[base + F.INFORMATION] + rate * 25);
        buf[base + F.ENTROPY] = Math.min(1, buf[base + F.ENTROPY] + rate * 0.008);
      }

      buf[base + F.LOCAL_TIME] += dt * p.timeBaseRate *
        (1 + buf[base + F.ENERGY] * p.timeEnergyBoost + buf[base + F.ENTROPY] * 0.5);
    }
  }
}
