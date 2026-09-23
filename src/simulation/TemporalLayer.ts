import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import type { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';
import type { InfinityScaleLODBoundarySnapshot } from '../infinity/InfinityScaleLODBoundarySnapshot';

// Local time field (F.LOCAL_TIME) controls how fast a cell's physics ticks
// relative to global dt. Dense/high-energy cells age faster; vacuum cells age slower.
// This creates "temporal ecology" — different regions of space have different ages.

export class TemporalLayer {
  tick(grid: VoxelGrid, dt: number): void {
    this.tickRegion(grid, dt, null);
  }

  tickChunks(
    grid: VoxelGrid,
    dt: number,
    context: InfinityScaleChunkExecutionContext,
    boundarySnapshot?: InfinityScaleLODBoundarySnapshot,
  ): void {
    this.tickRegion(grid, dt, context, boundarySnapshot);
  }

  private tickRegion(
    grid: VoxelGrid,
    dt: number,
    context: InfinityScaleChunkExecutionContext | null,
    boundarySnapshot?: InfinityScaleLODBoundarySnapshot,
  ): void {
    const { buffer: buf, size } = grid;

    for (let i = 0; i < size; i++) {
      const z = Math.floor(i / (grid.W * grid.H));
      const rem = i - z * grid.W * grid.H;
      const y = Math.floor(rem / grid.W);
      const x = rem - y * grid.W;
      if (context && !context.containsSimulationCell(x, y, z)) continue;

      const base = i * CELL_FIELDS;
      const energy  = buf[base + F.ENERGY];
      const density = buf[base + F.DENSITY];
      const info    = buf[base + F.INFORMATION];

      // Local time rate: high energy + density accelerates local time;
      // high information + low entropy decelerates it (complex structures age slowly)
      const entropy = buf[base + F.ENTROPY];
      const rate =
        0.3 + (energy / 1000) * 0.6 + density * 0.4
        - (info / 500) * 0.3 - (1 - entropy) * 0.1;

      const localRate = Math.max(0.05, Math.min(3.0, rate));

      // Accumulate local time
      buf[base + F.LOCAL_TIME] += dt * localRate;

      // Temporal pressure: neighboring cells with very different local times
      // create a "time gradient" that slightly transfers energy (frame dragging analogue)
    }

    // Temporal diffusion — smooth out extreme time gradients between neighbors
    if (context) {
      this._diffuseTimeChunks(grid, dt, context, boundarySnapshot);
    } else {
      this._diffuseTime(grid, dt);
    }
  }

  private _diffuseTimeChunks(
    grid: VoxelGrid,
    dt: number,
    context: InfinityScaleChunkExecutionContext,
    boundarySnapshot?: InfinityScaleLODBoundarySnapshot,
  ): void {
    const { W, H, D, buffer: buf } = grid;
    const WH = W * H;
    const α = 0.02 * dt * 60;

    for (let z = 1; z < D - 1; z++)
    for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!context.containsSimulationCell(x, y, z)) continue;

      const i = z * WH + y * W + x;
      const base = i * CELL_FIELDS;
      const lt = buf[base + F.LOCAL_TIME];
      const neighbors: number[] = [];
      const neighborCoords: Array<[number, number, number]> = [
        [x - 1, y, z],
        [x + 1, y, z],
        [x, y - 1, z],
        [x, y + 1, z],
        [x, y, z - 1],
        [x, y, z + 1],
      ];
      for (const [nx, ny, nz] of neighborCoords) {
        const ni = nz * WH + ny * W + nx;
        let value = buf[ni * CELL_FIELDS + F.LOCAL_TIME];
        if (boundarySnapshot && !context.containsSimulationCell(nx, ny, nz)) {
          for (const spec of context.getBoundaryTransferSpecsForCell(x, y, z)) {
            const sample = boundarySnapshot.read(spec, [nx, ny, nz]);
            if (sample) {
              value = sample[F.LOCAL_TIME];
              break;
            }
          }
        }
        neighbors.push(value);
      }
      const avg = neighbors.reduce((a, b) => a + b, 0) / 6;
      buf[base + F.LOCAL_TIME] = lt + α * (avg - lt);

      const gradient = avg - lt;
      if (Math.abs(gradient) > 0.5) {
        buf[base + F.ENERGY] = Math.max(
          0,
          buf[base + F.ENERGY] -
            Math.sign(gradient) * Math.abs(gradient) * 0.01 * dt * 60,
        );
      }
    }
  }

  private _diffuseTime(grid: VoxelGrid, dt: number): void {
    const { W, H, D, buffer: buf } = grid;
    const WH = W * H;
    const α = 0.02 * dt * 60; // diffusion coefficient

    for (let z = 1; z < D-1; z++)
    for (let y = 1; y < H-1; y++)
    for (let x = 1; x < W-1; x++) {
      const i = z * WH + y * W + x;
      const base = i * CELL_FIELDS;
      const lt = buf[base + F.LOCAL_TIME];

      const neighbors = [
        buf[(i-1)   * CELL_FIELDS + F.LOCAL_TIME],
        buf[(i+1)   * CELL_FIELDS + F.LOCAL_TIME],
        buf[(i-W)   * CELL_FIELDS + F.LOCAL_TIME],
        buf[(i+W)   * CELL_FIELDS + F.LOCAL_TIME],
        buf[(i-WH)  * CELL_FIELDS + F.LOCAL_TIME],
        buf[(i+WH)  * CELL_FIELDS + F.LOCAL_TIME],
      ];
      const avg = neighbors.reduce((a, b) => a + b, 0) / 6;
      buf[base + F.LOCAL_TIME] = lt + α * (avg - lt);

      // Time gradient → small energy transfer (gravitational time dilation analogue)
      const gradient = avg - lt;
      if (Math.abs(gradient) > 0.5) {
        buf[base + F.ENERGY] = Math.max(0,
          buf[base + F.ENERGY] - Math.sign(gradient) * Math.abs(gradient) * 0.01 * dt * 60);
      }
    }
  }
}
