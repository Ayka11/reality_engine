import { VoxelGrid } from '../core/VoxelGrid';
import { withMutableBuffers } from '../core/TrackedFloat32Array';
import { CELL_FIELDS, F } from '../core/CellState';

// Local time field (F.LOCAL_TIME) controls how fast a cell's physics ticks
// relative to global dt. Dense/high-energy cells age faster; vacuum cells age slower.
// This creates "temporal ecology" — different regions of space have different ages.

export class TemporalLayer {
  tick(grid: VoxelGrid, dt: number): void {
    withMutableBuffers(grid, (front, _back) => {
      const { size } = grid;

      for (let i = 0; i < size; i++) {
        const base = i * CELL_FIELDS;
        const energy  = front[base + F.ENERGY];
        const density = front[base + F.DENSITY];
        const info    = front[base + F.INFORMATION];

        // Local time rate: high energy + density accelerates local time;
        // high information + low entropy decelerates it (complex structures age slowly)
        const entropy = front[base + F.ENTROPY];
        const rate =
          0.3 + (energy / 1000) * 0.6 + density * 0.4
          - (info / 500) * 0.3 - (1 - entropy) * 0.1;

        const localRate = Math.max(0.05, Math.min(3.0, rate));

        // Accumulate local time
        front[base + F.LOCAL_TIME] += dt * localRate;

        // Temporal pressure: neighboring cells with very different local times
        // create a "time gradient" that slightly transfers energy (frame dragging analogue)
      }

    });

    // Temporal diffusion — smooth out extreme time gradients between neighbors
    this._diffuseTime(grid, dt);
  }

  private _diffuseTime(grid: VoxelGrid, dt: number): void {
    withMutableBuffers(grid, (front, _back) => {
      const { W, H, D } = grid;
      const WH = W * H;
      const α = 0.02 * dt * 60; // diffusion coefficient

      for (let z = 1; z < D-1; z++)
      for (let y = 1; y < H-1; y++)
      for (let x = 1; x < W-1; x++) {
        const i = z * WH + y * W + x;
        const base = i * CELL_FIELDS;
        const lt = front[base + F.LOCAL_TIME];

        const neighbors = [
          front[(i-1)   * CELL_FIELDS + F.LOCAL_TIME],
          front[(i+1)   * CELL_FIELDS + F.LOCAL_TIME],
          front[(i-W)   * CELL_FIELDS + F.LOCAL_TIME],
          front[(i+W)   * CELL_FIELDS + F.LOCAL_TIME],
          front[(i-WH)  * CELL_FIELDS + F.LOCAL_TIME],
          front[(i+WH)  * CELL_FIELDS + F.LOCAL_TIME],
        ];
        const avg = neighbors.reduce((a, b) => a + b, 0) / 6;
        front[base + F.LOCAL_TIME] = lt + α * (avg - lt);

        // Time gradient → small energy transfer (gravitational time dilation analogue)
        const gradient = avg - lt;
        if (Math.abs(gradient) > 0.5) {
          front[base + F.ENERGY] = Math.max(0,
            front[base + F.ENERGY] - Math.sign(gradient) * Math.abs(gradient) * 0.01 * dt * 60);
        }
      }
    });
  }
}
