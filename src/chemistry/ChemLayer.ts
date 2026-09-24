import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import type { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';
import type { InfinityScaleLODBoundarySnapshot } from '../infinity/InfinityScaleLODBoundarySnapshot';

export const CHEM = {
  GAS:      0,
  LIQUID:   1,
  SOLID:    2,
  ORGANIC:  3,
  REACTIVE: 4,
} as const;
export type ChemState = typeof CHEM[keyof typeof CHEM];

function nxFromIndex(index: number, W: number, H: number): number { return index % W; }
function nyFromIndex(index: number, W: number, H: number): number { return Math.floor((index % (W * H)) / W); }
function nzFromIndex(index: number, W: number, H: number): number { return Math.floor(index / (W * H)); }

export interface ChemDensityTransfer {
  targetCell: number;
  delta: number;
}

export class ChemLayer {
  private pendingDensityTransfers = new Map<number, number>();

  getPendingDensityTransferCount(): number {
    return this.pendingDensityTransfers.size;
  }

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

  /**
   * Commits deferred density transfers after local chunk simulation.
   * This is the chemistry portion of the Infinity Scale boundary barrier.
   */
  commitPendingDensityTransfers(
    grid: VoxelGrid,
    context: InfinityScaleChunkExecutionContext,
  ): number {
    const { W, H, buffer: buf } = grid;
    const WH = W * H;
    let committed = 0;
    for (const [index, delta] of [...this.pendingDensityTransfers]) {
      const z = Math.floor(index / WH);
      const rem = index - z * WH;
      const y = Math.floor(rem / W);
      const x = rem - y * W;
      if (!context.containsSimulationCell(x, y, z)) continue;
      const base = index * CELL_FIELDS;
      buf[base + F.DENSITY] = Math.max(
        0,
        Math.min(1, buf[base + F.DENSITY] + delta),
      );
      this.pendingDensityTransfers.delete(index);
      committed++;
    }
    return committed;
  }

  private tickRegion(
    grid: VoxelGrid,
    dt: number,
    context: InfinityScaleChunkExecutionContext | null,
    boundarySnapshot?: InfinityScaleLODBoundarySnapshot,
  ): void {
    const { W, H, D, buffer: buf } = grid;
    const WH = W * H;
    const densityTransfers = context ? new Map<number, number>() : null;

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i    = z * WH + y * W + x;
      if (context && !context.containsSimulationCell(x, y, z)) continue;
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
          let neighborChem = buf[nb + F.CHEM_STATE];
          if (context && boundarySnapshot && !context.containsSimulationCell(
            nxFromIndex(ni, W, H), nyFromIndex(ni, W, H), nzFromIndex(ni, W, H)
          )) {
            const nx = nxFromIndex(ni, W, H);
            const ny = nyFromIndex(ni, W, H);
            const nz = nzFromIndex(ni, W, H);
            for (const spec of context.getBoundaryTransferSpecsForCell(x, y, z)) {
              const sample = boundarySnapshot.read(spec, [nx, ny, nz]);
              if (sample) {
                neighborChem = sample[F.CHEM_STATE];
                break;
              }
            }
          }
          if (neighborChem === CHEM.SOLID) {
            const transfer = 0.002 * dt * 60;
            if (densityTransfers) {
              const nx = ni % W;
              const ny = Math.floor((ni % WH) / W);
              const nz = Math.floor(ni / WH);
              if (context?.containsSimulationCell(nx, ny, nz)) {
                densityTransfers.set(ni, (densityTransfers.get(ni) ?? 0) - transfer);
              } else {
                this.pendingDensityTransfers.set(
                  ni,
                  (this.pendingDensityTransfers.get(ni) ?? 0) - transfer,
                );
              }
              densityTransfers.set(i, (densityTransfers.get(i) ?? 0) + transfer * 0.5);
            } else {
              buf[nb + F.DENSITY]   = Math.max(0, buf[nb + F.DENSITY] - transfer);
              buf[base + F.DENSITY] = Math.min(1, density + transfer * 0.5);
            }
          }
        }
      }
    }
    if (densityTransfers) {
      for (const [index, delta] of densityTransfers) {
        const base = index * CELL_FIELDS;
        buf[base + F.DENSITY] = Math.max(0, Math.min(1, buf[base + F.DENSITY] + delta));
      }
    }
  }
}
