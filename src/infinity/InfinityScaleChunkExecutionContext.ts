import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";
import { isInfinityScaleSourceBoundaryCell } from "./InfinityScaleLODBoundaryCellMapper";
import { getInfinityScaleChunkBounds, parseInfinityScaleChunkKey, validateInfinityScaleChunkPair } from "./InfinityScaleChunkKey";

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

function chunkLevel(key: string): number {
  return parseInfinityScaleChunkKey(key).level;
}

function executionGeometryFingerprint(plan: InfinityScaleExecutionPlan): string {
  const chunks = plan.chunks
    .map(chunk => [chunk.key, chunk.lod, chunk.amr, chunk.distance])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const relations = plan.boundaryReadRelations
    .map(relation => [relation.sourceChunk, relation.targetChunk, relation.relation])
    .sort((a, b) =>
      `${a[0]}>${a[1]}:${a[2]}`.localeCompare(`${b[0]}>${b[1]}:${b[2]}`)
    );

  return JSON.stringify({
    revision: plan.revision,
    chunks,
    boundaryReadChunks: [...plan.boundaryReadChunks].sort(),
    boundaryReadRelations: relations,
  });
}

export class InfinityScaleChunkExecutionContext {
  readonly simulationRanges: ReadonlyArray<Readonly<ExecutionCellRange>>;
  readonly readRanges: ReadonlyArray<Readonly<ExecutionCellRange>>;
  readonly simulationCellCount: number;
  readonly readCellCount: number;
  readonly overlappingSimulationRangeCount: number;
  readonly overlappingReadRangeCount: number;
  readonly uniqueBoundaryReadCellCount: number;
  readonly levelRangeScales: ReadonlyArray<number>;
  readonly boundaryReadRelations: ReadonlyArray<Readonly<InfinityScaleBoundaryReadRelation>>;
  readonly boundaryTransferSpecs: ReadonlyArray<Readonly<InfinityScaleBoundaryTransferSpec>>;
  readonly sameLevelTransferCount: number;
  readonly prolongationTransferCount: number;
  readonly restrictionTransferCount: number;

  private readonly planFingerprint: string;

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
    for (const [name, dimension] of [
      ["gridWidth", gridWidth],
      ["gridHeight", gridHeight],
      ["gridDepth", gridDepth],
      ["chunkSize", chunkSize],
    ] as const) {
      if (!Number.isSafeInteger(dimension) || dimension <= 0) {
        throw new Error(`Infinity Scale execution context ${name} must be a positive safe integer`);
      }
    }

    // Range volumes and linear cell counts rely on exact safe-integer products.
    // Individually safe dimensions are not sufficient: their products must
    // also remain exact safe integers.
    const gridPlaneCellCount = gridWidth * gridHeight;
    const gridCellCount = gridPlaneCellCount * gridDepth;
    if (!Number.isSafeInteger(gridPlaneCellCount) ||
        !Number.isSafeInteger(gridCellCount)) {
      throw new Error("Infinity Scale execution context grid cell count must be a safe integer");
    }

    for (const chunk of plan.chunks) {
      const parsed = parseInfinityScaleChunkKey(chunk.key);
      if (chunk.lod !== parsed.level) {
        throw new Error(
          `Infinity Scale execution plan chunk LOD/key mismatch for ${chunk.key}: key=${parsed.level}, lod=${chunk.lod}`,
        );
      }
    }
    this.planFingerprint = executionGeometryFingerprint(plan);

    const rawSimulationRanges = plan.chunks.map(chunk =>
      this.chunkRange(chunk.key),
    );
    this.overlappingSimulationRangeCount = this.countOverlappingRanges(rawSimulationRanges);
    this.levelRangeScales = Object.freeze(plan.chunks.map(chunk => 2 ** chunkLevel(chunk.key)));
    this.simulationRanges = Object.freeze(
      rawSimulationRanges.map(range => Object.freeze({ ...range })),
    );
    const rawReadRanges = plan.boundaryReadChunks.map(key => this.chunkRange(key));
    this.readRanges = Object.freeze(
      rawReadRanges.map(range => Object.freeze({ ...range })),
    );
    this.boundaryReadRelations = Object.freeze(
      plan.boundaryReadRelations.map(relation => Object.freeze({ ...relation })),
    );
    this.boundaryTransferSpecs = Object.freeze(
      this.buildBoundaryTransferSpecs().map(spec => Object.freeze({ ...spec })),
    );
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

  assertCompatiblePlan(plan: InfinityScaleExecutionPlan): void {
    if (executionGeometryFingerprint(plan) !== this.planFingerprint) {
      throw new Error("Infinity Scale execution context/plan geometry mismatch");
    }
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
      const pair = validateInfinityScaleChunkPair(relation.sourceChunk, relation.targetChunk, relation.relation);
      const sourceLevel = pair.source.level;
      const targetLevel = pair.target.level;
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
      const pair = validateInfinityScaleChunkPair(relation.sourceChunk, relation.targetChunk, relation.relation);
      const sourceLevel = pair.source.level;
      const targetLevel = pair.target.level;
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
      const pair = validateInfinityScaleChunkPair(relation.sourceChunk, relation.targetChunk, relation.relation);
      const sourceLevel = pair.source.level;
      const targetLevel = pair.target.level;
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

    for (const sourceRelations of this.boundaryRelationsBySource.values()) {
      for (const relation of sourceRelations) {
        const spec = this.relationToTransferSpec(relation);
        if (isInfinityScaleSourceBoundaryCell(spec, [x, y, z], this.chunkSize)) {
          relations.push({ ...relation });
        }
      }
    }

    return relations;
  }

  private relationToTransferSpec(
    relation: InfinityScaleBoundaryReadRelation,
  ): InfinityScaleBoundaryTransferSpec {
    const pair = validateInfinityScaleChunkPair(relation.sourceChunk, relation.targetChunk, relation.relation);
    const sourceLevel = pair.source.level;
    const targetLevel = pair.target.level;
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
  }

  private chunkRange(key: string): ExecutionCellRange {
    const bounds = getInfinityScaleChunkBounds(key, this.chunkSize);
    return {
      minX: Math.max(0, bounds.minX),
      maxX: Math.min(this.gridWidth - 1, bounds.maxX),
      minY: Math.max(0, bounds.minY),
      maxY: Math.min(this.gridHeight - 1, bounds.maxY),
      minZ: Math.max(0, bounds.minZ),
      maxZ: Math.min(this.gridDepth - 1, bounds.maxZ),
    };
  }

  private isFullyContainedBySimulation(range: ExecutionCellRange): boolean {
    const expectedCellCount = this.rangeCellCount(range);
    if (expectedCellCount === 0) return true;

    const intersections = this.simulationRanges
      .map(simulation => ({
        minX: Math.max(range.minX, simulation.minX),
        maxX: Math.min(range.maxX, simulation.maxX),
        minY: Math.max(range.minY, simulation.minY),
        maxY: Math.min(range.maxY, simulation.maxY),
        minZ: Math.max(range.minZ, simulation.minZ),
        maxZ: Math.min(range.maxZ, simulation.maxZ),
      }))
      .filter(candidate =>
        candidate.minX <= candidate.maxX &&
        candidate.minY <= candidate.maxY &&
        candidate.minZ <= candidate.maxZ
      );

    return this.countUniqueCells(intersections) === expectedCellCount;
  }

  private countOverlappingRanges(ranges: ReadonlyArray<Readonly<ExecutionCellRange>>): number {
    let overlaps = 0;
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (this.rangesOverlap(ranges[i], ranges[j])) overlaps++;
      }
    }
    return overlaps;
  }

  /**
   * Count the union of inclusive axis-aligned cell ranges without visiting
   * individual cells. Coordinate compression keeps runtime dependent on the
   * number of chunk ranges rather than the represented world volume.
   */
  private countUniqueCells(ranges: ReadonlyArray<Readonly<ExecutionCellRange>>): number {
    const nonEmpty = ranges.filter(range =>
      range.minX <= range.maxX &&
      range.minY <= range.maxY &&
      range.minZ <= range.maxZ
    );
    if (nonEmpty.length === 0) return 0;

    const xEdges = new Set<number>();
    for (const range of nonEmpty) {
      xEdges.add(range.minX);
      xEdges.add(range.maxX + 1);
    }
    const sortedX = [...xEdges].sort((a, b) => a - b);
    let total = 0;

    for (let index = 0; index < sortedX.length - 1; index++) {
      const xStart = sortedX[index];
      const xEnd = sortedX[index + 1];
      if (xStart >= xEnd) continue;

      const active = nonEmpty.filter(range =>
        range.minX <= xStart && range.maxX + 1 >= xEnd
      );
      if (active.length === 0) continue;
      total += (xEnd - xStart) * this.countUniqueYZCells(active);
    }

    return total;
  }

  private countUniqueYZCells(ranges: ExecutionCellRange[]): number {
    const yEdges = new Set<number>();
    for (const range of ranges) {
      yEdges.add(range.minY);
      yEdges.add(range.maxY + 1);
    }
    const sortedY = [...yEdges].sort((a, b) => a - b);
    let area = 0;

    for (let index = 0; index < sortedY.length - 1; index++) {
      const yStart = sortedY[index];
      const yEnd = sortedY[index + 1];
      if (yStart >= yEnd) continue;

      const zIntervals = ranges
        .filter(range => range.minY <= yStart && range.maxY + 1 >= yEnd)
        .map(range => [range.minZ, range.maxZ + 1] as const)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (zIntervals.length === 0) continue;

      let coveredStart = zIntervals[0][0];
      let coveredEnd = zIntervals[0][1];
      let coveredLength = 0;
      for (let intervalIndex = 1; intervalIndex < zIntervals.length; intervalIndex++) {
        const [start, end] = zIntervals[intervalIndex];
        if (start > coveredEnd) {
          coveredLength += coveredEnd - coveredStart;
          coveredStart = start;
          coveredEnd = end;
        } else if (end > coveredEnd) {
          coveredEnd = end;
        }
      }
      coveredLength += coveredEnd - coveredStart;
      area += (yEnd - yStart) * coveredLength;
    }

    return area;
  }

  private rangeCellCount(range: ExecutionCellRange): number {
    if (
      range.minX > range.maxX ||
      range.minY > range.maxY ||
      range.minZ > range.maxZ
    ) return 0;

    return (
      (range.maxX - range.minX + 1) *
      (range.maxY - range.minY + 1) *
      (range.maxZ - range.minZ + 1)
    );
  }

  private rangesOverlap(a: Readonly<ExecutionCellRange>, b: Readonly<ExecutionCellRange>): boolean {
    return (
      a.minX <= b.maxX && a.maxX >= b.minX &&
      a.minY <= b.maxY && a.maxY >= b.minY &&
      a.minZ <= b.maxZ && a.maxZ >= b.minZ
    );
  }

  private contains(range: Readonly<ExecutionCellRange>, x: number, y: number, z: number): boolean {
    return (
      x >= range.minX && x <= range.maxX &&
      y >= range.minY && y <= range.maxY &&
      z >= range.minZ && z <= range.maxZ
    );
  }
}
