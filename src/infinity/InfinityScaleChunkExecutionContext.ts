import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

export interface ExecutionCellRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Safe execution geometry for the current dense SparseVoxelGrid.
 *
 * It translates logical 32^3 Infinity Scale chunks into dense-cell ranges and
 * explicitly includes the one-chunk stencil halo. The context is descriptive
 * until every simulation layer supports selective execution.
 */
export class InfinityScaleChunkExecutionContext {
  readonly simulationRanges: ExecutionCellRange[];
  readonly readRanges: ExecutionCellRange[];
  readonly simulationCellCount: number;
  readonly readCellCount: number;

  constructor(
    plan: InfinityScaleExecutionPlan,
    readonly gridWidth: number,
    readonly gridHeight: number,
    readonly gridDepth: number,
    readonly chunkSize = 32,
  ) {
    this.simulationRanges = plan.chunks.map(chunk =>
      this.chunkRange(chunk.key),
    );
    this.readRanges = plan.boundaryReadChunks.map(key =>
      this.chunkRange(key),
    );

    this.simulationCellCount = this.simulationRanges.reduce(
      (sum, range) => sum + this.rangeVolume(range), 0,
    );
    this.readCellCount = this.readRanges.reduce(
      (sum, range) => sum + this.rangeVolume(range), 0,
    );
  }

  containsSimulationCell(x: number, y: number, z: number): boolean {
    return this.simulationRanges.some(range => this.contains(range, x, y, z));
  }

  containsReadCell(x: number, y: number, z: number): boolean {
    if (this.containsSimulationCell(x, y, z)) return true;
    return this.readRanges.some(range => this.contains(range, x, y, z));
  }

  private chunkRange(key: string): ExecutionCellRange {
    const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
    if (!match) {
      throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
    }

    const x = Number(match[2]) * this.chunkSize;
    const y = Number(match[3]) * this.chunkSize;
    const z = Number(match[4]) * this.chunkSize;

    return {
      minX: Math.max(0, x),
      maxX: Math.min(this.gridWidth - 1, x + this.chunkSize - 1),
      minY: Math.max(0, y),
      maxY: Math.min(this.gridHeight - 1, y + this.chunkSize - 1),
      minZ: Math.max(0, z),
      maxZ: Math.min(this.gridDepth - 1, z + this.chunkSize - 1),
    };
  }

  private contains(range: ExecutionCellRange, x: number, y: number, z: number): boolean {
    return (
      x >= range.minX && x <= range.maxX &&
      y >= range.minY && y <= range.maxY &&
      z >= range.minZ && z <= range.maxZ
    );
  }

  private rangeVolume(range: ExecutionCellRange): number {
    if (
      range.maxX < range.minX ||
      range.maxY < range.minY ||
      range.maxZ < range.minZ
    ) return 0;

    return (
      (range.maxX - range.minX + 1) *
      (range.maxY - range.minY + 1) *
      (range.maxZ - range.minZ + 1)
    );
  }
}
