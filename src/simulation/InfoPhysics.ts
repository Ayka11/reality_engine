import { VoxelGrid } from '../core/VoxelGrid';
import { withMutableBuffers } from '../core/TrackedFloat32Array';
import { CELL_FIELDS, F } from '../core/CellState';
import { PROC, defaultProcessMask } from '../process/ProcessDef';

function on(mask: number, proc: number) { return (mask & (1 << proc)) !== 0; }

// Information physics treats INFORMATION as a process-governed quantity.
// It must not mutate information, memory, entropy, or energy when that process
// is disabled; the caller supplies the same canonical process mask as the
// finite CPU/GPU solvers.
export class InfoPhysics {
  tick(grid: VoxelGrid, dt: number, mask: number = defaultProcessMask()): void {
    if (!on(mask, PROC.INFORMATION)) return;

    withMutableBuffers(grid, (front, _back) => {
      const { W, H, D } = grid;
      const WH = W * H;
      const dtN = dt * 60; // normalized to 60 fps

      for (let z = 0; z < D; z++)
      for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i    = z * WH + y * W + x;
        const base = i * CELL_FIELDS;

        const info    = front[base + F.INFORMATION];
        const entropy = front[base + F.ENTROPY];
        const energy  = front[base + F.ENERGY];
        const signal  = front[base + F.SIGNAL];
        const mem     = front[base + F.MEM_FIELD];

        if (info < 0.5 && mem < 0.001) continue;

        // Information decay toward entropy-driven equilibrium.
        const decayRate = 0.004 * entropy * dtN;
        front[base + F.INFORMATION] = Math.max(0, info - decayRate * info);

        // Coherence: a present signal boosts information stability.
        if (signal > 5) {
          const coherence = Math.min(1, signal / 100);
          front[base + F.INFORMATION] = Math.min(999,
            front[base + F.INFORMATION] + coherence * 0.8 * dtN);
        }

        // Memory imprint: when information peaks, leave a trace in MEM_FIELD.
        if (info > 200) {
          const imprint = (info / 999) * 0.02 * dtN;
          front[base + F.MEM_FIELD] = Math.min(1, mem + imprint);
        } else {
          front[base + F.MEM_FIELD] = Math.max(0, mem - 0.001 * dtN);
        }

        // Resonance: nearby information clusters amplify each other.
        let resonanceSum = 0, resonanceCount = 0;
        const neighbors = [
          x > 0   ? (i-1)   : -1,
          x < W-1 ? (i+1)   : -1,
          y > 0   ? (i-W)   : -1,
          y < H-1 ? (i+W)   : -1,
          z > 0   ? (i-WH)  : -1,
          z < D-1 ? (i+WH)  : -1,
        ];
        for (const ni of neighbors) {
          if (ni < 0) continue;
          const nInfo = front[ni * CELL_FIELDS + F.INFORMATION];
          if (Math.abs(nInfo - info) < info * 0.3) {
            resonanceSum += nInfo;
            resonanceCount++;
          }
        }

        if (resonanceCount >= 3) {
          const boost = (resonanceSum / resonanceCount / 999) * 1.5 * dtN;
          front[base + F.INFORMATION] = Math.min(999, front[base + F.INFORMATION] + boost);
          front[base + F.ENTROPY] = Math.max(0, entropy - 0.001 * dtN);
        }

        // High information can radiate energy only as part of enabled information dynamics.
        if (info > 700) {
          front[base + F.ENERGY] = Math.min(9999, energy + (info - 700) / 999 * 2 * dtN);
          front[base + F.INFORMATION] = Math.max(0, front[base + F.INFORMATION] - 0.5 * dtN);
        }
      }
    });
  }
}
