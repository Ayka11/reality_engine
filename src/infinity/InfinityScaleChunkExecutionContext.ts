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
  readonly overlappingSimulationRangeCount: number;
  readonly overlappingReadRangeCount: number;
  readonly uniqueBoundaryReadCellCount: number;

  constructor(
    plan: InfinityScaleExecutionPlan,
    readonly gridWidth: number,
    readonly gridHeight: number,
    readonly gridDepth: number,
    readonly chunkSize = 32,
  ) {
    const rawSimulationRanges = plan.chunks.map(chunk =>
      this.chunkRange(chunk.key),
    );
    this.overlappingSimulationRangeCount = this.countOverlappingRanges(rawSimulationRanges);
    // Ownership is a set of cells, not a sum of overlapping LOD ranges. Keep
    // the execution geometry explicit, while exposing overlap diagnostics so
    // callers can reject ambiguous multi-LOD ownership before dispatch.
    this.simulationRanges = rawSimulationRanges;
    this.readRanges = plan.boundaryReadChunks.map(key =>
      this.chunkRange(key),
    );
    this.overlappingReadRangeCount = this.countOverlappingRanges(this.readRanges);

    this.simulationCellCount = this.countUniqueCells(this.simulationRanges);
    this.uniqueBoundaryReadCellCount = this.countUniqueCells(
      this.readRanges.filter((range) => !this.isFullyContainedBySimulation(range)),
    );
    // readCellCount is the unique halo footprint, excluding cells already
    // owned by simulation. This is the actual boundary transfer footprint.
    this.readCellCount = this.uniqueBoundaryReadCellCount;
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

  private isFullyContainedBySimulation(range: ExecutionCellRange): boolean {
    for (let z = range.minZ; z <= range.maxZ; z++)
    for (let y = range.minY; y <= range.maxY; y++)
    for (let x = range.minX; x <= range.maxX; x++) {
      if (!this.containsSimulationCell(x, y, z)) return false;
    }
    return true;
  }

  private countOverlappingRanges(ranges: ExecutionCellRange[]): number {
    let overlaps = 0;
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (this.rangesOverlap(ranges[i], ranges[j])) overlaps++;
      }
    }
    return overlaps;
  }

  private countUniqueCells(ranges: ExecutionCellRange[]): number {
    const seen = new Set<number>();
    for (const range of ranges) {
      for (let z = range.minZ; z <= range.maxZ; z++)
      for (let y = range.minY; y <= range.maxY; y++)
      for (let x = range.minX; x <= range.maxX; x++) {
        seen.add(z * this.gridHeight * this.gridWidth + y * this.gridWidth + x);
      }
    }
    return seen.size;
  }

  private rangesOverlap(a: ExecutionCellRange, b: ExecutionCellRange): boolean {
    return (
      a.minX <= b.maxX && a.maxX >= b.minX &&
      a.minY <= b.maxY && a.maxY >= b.minY &&
      a.minZ <= b.maxZ && a.maxZ >= b.minZ
    );
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
