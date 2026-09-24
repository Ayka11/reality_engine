import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

export interface ExecutionCellRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type InfinityScaleBoundaryRelation =
  | "same-level"
  | "coarse-to-fine"
  | "fine-to-coarse";

export interface InfinityScaleBoundaryReadRelation {
  sourceChunk: string;
  targetChunk: string;
  relation: InfinityScaleBoundaryRelation;
}

export interface InfinityScaleBoundaryTransferSpec {
  sourceChunk: string;
  targetChunk: string;
  relation: InfinityScaleBoundaryRelation;
  sourceLevel: number;
  targetLevel: number;
  refinementRatio: number;
  operation: "copy" | "prolongation" | "restriction";
  readOperation: "copy" | "prolongation" | "restriction";
}

export class InfinityScaleChunkExecutionContext {
  readonly simulationRanges: ExecutionCellRange[];
  readonly readRanges: ExecutionCellRange[];
  readonly simulationCellCount: number;
  readonly readCellCount: number;
  readonly overlappingSimulationRangeCount: number;
  readonly overlappingReadRangeCount: number;
  readonly uniqueBoundaryReadCellCount: number;
  readonly levelRangeScales: number[];
  readonly boundaryReadRelations: InfinityScaleBoundaryReadRelation[];
  readonly boundaryTransferSpecs: InfinityScaleBoundaryTransferSpec[];
  readonly sameLevelTransferCount: number;
  readonly prolongationTransferCount: number;
  readonly restrictionTransferCount: number;

  private readonly boundaryRelationsBySource = new Map<
    string,
    InfinityScaleBoundaryReadRelation[]
  >();

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
    this.levelRangeScales = plan.chunks.map(chunk => 2 ** chunkLevel(chunk.key));
    this.simulationRanges = rawSimulationRanges;
    this.readRanges = plan.boundaryReadChunks.map(key => this.chunkRange(key));
    this.boundaryReadRelations = plan.boundaryReadRelations.map(relation => ({ ...relation }));
    this.boundaryTransferSpecs = this.buildBoundaryTransferSpecs();
    this.sameLevelTransferCount = this.boundaryTransferSpecs.filter(spec => spec.operation === "copy").length;
    this.prolongationTransferCount = this.boundaryTransferSpecs.filter(spec => spec.operation === "prolongation").length;
    this.restrictionTransferCount = this.boundaryTransferSpecs.filter(spec => spec.operation === "restriction").length;
    for (const relation of this.boundaryReadRelations) {
      const existing = this.boundaryRelationsBySource.get(relation.sourceChunk) ?? [];
      existing.push({ ...relation });
      this.boundaryRelationsBySource.set(relation.sourceChunk, existing);
    }
    this.overlappingReadRangeCount = this.countOverlappingRanges(this.readRanges);

    this.simulationCellCount = this.countUniqueCells(this.simulationRanges);
    this.uniqueBoundaryReadCellCount = this.countUniqueCells(
      this.readRanges.filter((range) => !this.isFullyContainedBySimulation(range)),
    );
    this.readCellCount = this.uniqueBoundaryReadCellCount;
  }

  containsSimulationCell(x: number, y: number, z: number): boolean {
    return this.simulationRanges.some(range => this.contains(range, x, y, z));
  }

  containsReadCell(x: number, y: number, z: number): boolean {
    if (this.containsSimulationCell(x, y, z)) return true;
    return this.readRanges.some(range => this.contains(range, x, y, z));
  }

  private buildBoundaryTransferSpecs(): InfinityScaleBoundaryTransferSpec[] {
    return this.boundaryReadRelations.map(relation => {
      const sourceLevel = chunkLevel(relation.sourceChunk);
      const targetLevel = chunkLevel(relation.targetChunk);
      const refinementRatio = 2 ** Math.abs(sourceLevel - targetLevel);
      return {
        sourceChunk: relation.sourceChunk,
        targetChunk: relation.targetChunk,
        relation: relation.relation,
        sourceLevel,
        targetLevel,
        refinementRatio,
        operation:
          relation.relation === "same-level"
            ? "copy"
            : relation.relation === "coarse-to-fine"
              ? "prolongation"
              : "restriction",
        readOperation:
          relation.relation === "same-level"
            ? "copy"
            : relation.relation === "coarse-to-fine"
              ? "restriction"
              : "prolongation",
      };
    });
  }

  getBoundaryTransferSpecs(sourceChunk?: string): InfinityScaleBoundaryTransferSpec[] {
    const relations = sourceChunk === undefined
      ? this.boundaryReadRelations
      : this.boundaryRelationsBySource.get(sourceChunk) ?? [];

    return relations.map(relation => {
      const sourceLevel = chunkLevel(relation.sourceChunk);
      const targetLevel = chunkLevel(relation.targetChunk);
      const refinementRatio = 2 ** Math.abs(sourceLevel - targetLevel);

      return {
        sourceChunk: relation.sourceChunk,
        targetChunk: relation.targetChunk,
        relation: relation.relation,
        sourceLevel,
        targetLevel,
        refinementRatio,
        operation:
          relation.relation === "same-level"
            ? "copy"
            : relation.relation === "coarse-to-fine"
              ? "prolongation"
              : "restriction",
        readOperation:
          relation.relation === "same-level"
            ? "copy"
            : relation.relation === "coarse-to-fine"
              ? "restriction"
              : "prolongation",
      };
    });
  }

  getBoundaryRelations(sourceChunk?: string): InfinityScaleBoundaryReadRelation[] {
    if (sourceChunk !== undefined) {
      return (this.boundaryRelationsBySource.get(sourceChunk) ?? []).map(relation => ({ ...relation }));
    }
    return this.boundaryReadRelations.map(relation => ({ ...relation }));
  }

  getBoundaryTransferSpecsForCell(
    x: number,
    y: number,
    z: number,
  ): InfinityScaleBoundaryTransferSpec[] {
    const relations = this.getBoundaryRelationsForCell(x, y, z);
    return relations.map(relation => {
      const sourceLevel = chunkLevel(relation.sourceChunk);
      const targetLevel = chunkLevel(relation.targetChunk);
      return {
        sourceChunk: relation.sourceChunk,
        targetChunk: relation.targetChunk,
        relation: relation.relation,
        sourceLevel,
        targetLevel,
        refinementRatio: 2 ** Math.abs(sourceLevel - targetLevel),
        operation:
          relation.relation === "same-level"
            ? "copy"
            : relation.relation === "coarse-to-fine"
              ? "prolongation"
              : "restriction",
        readOperation:
          relation.relation === "same-level"
            ? "copy"
            : relation.relation === "coarse-to-fine"
              ? "restriction"
              : "prolongation",
      };
    });
  }

  getBoundaryRelationsForCell(
    x: number,
    y: number,
    z: number,
  ): InfinityScaleBoundaryReadRelation[] {
    const relations: InfinityScaleBoundaryReadRelation[] = [];

    for (const [sourceChunk, sourceRelations] of this.boundaryRelationsBySource) {
      const sourceRange = this.chunkRange(sourceChunk);
      if (!this.contains(sourceRange, x, y, z)) continue;

      for (const relation of sourceRelations) {
        const targetRange = this.chunkRange(relation.targetChunk);
        if (this.isAdjacentToTargetBoundary(sourceRange, targetRange, x, y, z)) {
          relations.push({ ...relation });
        }
      }
    }

    return relations;
  }

  /**
   * A transfer relation is usable for a local cell only when that cell lies
   * on the source chunk face adjacent to the target chunk footprint.
   *
   * This prevents a mixed-LOD relation from being attached to every cell in a
   * large source chunk merely because the source and target chunks are
   * related somewhere along one face.
   */
  private isAdjacentToTargetBoundary(
    source: ExecutionCellRange,
    target: ExecutionCellRange,
    x: number,
    y: number,
    z: number,
  ): boolean {
    const xOverlap = x >= target.minX && x <= target.maxX;
    const yOverlap = y >= target.minY && y <= target.maxY;
    const zOverlap = z >= target.minZ && z <= target.maxZ;

    const xFace =
      (source.maxX + 1 === target.minX && x === source.maxX) ||
      (target.maxX + 1 === source.minX && x === source.minX);
    const yFace =
      (source.maxY + 1 === target.minY && y === source.maxY) ||
      (target.maxY + 1 === source.minY && y === source.minY);
    const zFace =
      (source.maxZ + 1 === target.minZ && z === source.maxZ) ||
      (target.maxZ + 1 === source.minZ && z === source.minZ);

    return (
      (xFace && yOverlap && zOverlap) ||
      (yFace && xOverlap && zOverlap) ||
      (zFace && xOverlap && yOverlap)
    );
  }

  private chunkRange(key: string): ExecutionCellRange {
    const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
    if (!match) {
      throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
    }

    const level = Number(match[1]);
    if (!Number.isInteger(level) || level < 0 || level > 30) {
      throw new Error(`Invalid Infinity Scale LOD level: ${match[1]}`);
    }

    const scale = 2 ** level;
    const extent = this.chunkSize * scale;
    const x = Number(match[2]) * extent;
    const y = Number(match[3]) * extent;
    const z = Number(match[4]) * extent;

    return {
      minX: Math.max(0, x),
      maxX: Math.min(this.gridWidth - 1, x + extent - 1),
      minY: Math.max(0, y),
      maxY: Math.min(this.gridHeight - 1, y + extent - 1),
      minZ: Math.max(0, z),
      maxZ: Math.min(this.gridDepth - 1, z + extent - 1),
    };
  }

function chunkLevel(key: string): number {
  const match = /^(\d+):/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  return Number(match[1]);
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
}
