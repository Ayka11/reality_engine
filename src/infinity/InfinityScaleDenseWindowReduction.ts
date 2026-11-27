import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODTransfer, INFINITY_SCALE_MAX_TRANSFER_CELL_COUNT } from "./InfinityScaleLODTransfer";

/** Structural input contract produced by SparseVoxelGridPhysicalAddressAdapter. */
export interface DenseWindowCoverageCell {
  readonly chunkKey: string;
  readonly cellIndex: number;
  readonly level: number;
  readonly expectedBaseSamples: number;
  readonly observedBaseSamples: number;
  readonly denseIndices: readonly number[];
  readonly complete: boolean;
}

export interface DenseWindowCoverageReport {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly revision: number;
  readonly complete: boolean;
  readonly incompleteCellCount: number;
  readonly cells: readonly DenseWindowCoverageCell[];
}

export interface DenseWindowPhysicalReduction {
  readonly chunkKey: string;
  readonly cellIndex: number;
  readonly level: number;
  readonly denseIndices: readonly number[];
  readonly values: readonly number[];
  readonly transferredFields: readonly number[];
  readonly skippedFields: readonly number[];
}

/**
 * Pure, staged dense-to-physical reduction.
 *
 * The dense values must come from the actual dense simulation state, not from
 * projectDenseWindow(): that read projection repeats coarse physical values
 * and is not a valid fine-source dataset. Every touched physical cell must be
 * fully covered before any reducer is invoked. No physical buffer is written.
 */
export function stageDenseWindowPhysicalReductions(
  denseValues: ArrayLike<number>,
  coverage: DenseWindowCoverageReport,
  currentCoverageRevision: number,
): readonly DenseWindowPhysicalReduction[] {
  if (!coverage || typeof coverage !== "object" ||
      ![coverage.width, coverage.height, coverage.depth].every(Number.isSafeInteger) ||
      coverage.width <= 0 || coverage.height <= 0 || coverage.depth <= 0 ||
      !Number.isSafeInteger(coverage.revision) || coverage.revision < 0 ||
      !Number.isSafeInteger(currentCoverageRevision) || currentCoverageRevision < 0 ||
      !Array.isArray(coverage.cells) ||
      typeof coverage.complete !== "boolean" ||
      !Number.isSafeInteger(coverage.incompleteCellCount) || coverage.incompleteCellCount < 0) {
    throw new RangeError("Dense-window physical reduction requires a valid coverage report");
  }

  if (coverage.revision !== currentCoverageRevision) {
    throw new Error("Dense-window physical reduction rejected: coverage revision is stale");
  }

  const sampleCount = coverage.width * coverage.height * coverage.depth;
  const expectedValueCount = sampleCount * CELL_FIELDS;
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0 ||
      !Number.isSafeInteger(expectedValueCount) || expectedValueCount <= 0 ||
      denseValues.length !== expectedValueCount) {
    throw new RangeError("Dense-window physical reduction source dimensions do not match the coverage window");
  }

  // Reject the whole reduction batch before invoking any field reducer.
  if (!coverage.complete || coverage.incompleteCellCount !== 0 ||
      coverage.cells.some(cell => !cell.complete)) {
    throw new Error("Dense-window physical reduction rejected: incomplete physical-cell coverage");
  }

  const physicalIdentities = new Set<string>();
  const denseOwnership = new Set<number>();
  const prepared: Array<{
    chunkKey: string;
    cellIndex: number;
    level: number;
    denseIndices: number[];
  }> = [];

  for (const cell of coverage.cells) {
    if (!cell || typeof cell.chunkKey !== "string" || cell.chunkKey.length === 0 ||
        !Number.isSafeInteger(cell.cellIndex) || cell.cellIndex < 0 ||
        !Number.isSafeInteger(cell.level) || cell.level < 0 ||
        !Number.isSafeInteger(cell.expectedBaseSamples) ||
        !Number.isSafeInteger(cell.observedBaseSamples) ||
        !Array.isArray(cell.denseIndices)) {
      throw new Error("Dense-window physical reduction received malformed physical-cell coverage metadata");
    }
    const identity = cell.chunkKey + "#" + cell.cellIndex;
    if (physicalIdentities.has(identity)) {
      throw new Error("Dense-window physical reduction contains duplicate physical-cell identity " + identity);
    }
    physicalIdentities.add(identity);

    const scale = 2 ** cell.level;
    const expected = scale ** 3;
    if (!Number.isSafeInteger(expected) || expected > INFINITY_SCALE_MAX_TRANSFER_CELL_COUNT ||
        cell.expectedBaseSamples !== expected ||
        cell.observedBaseSamples !== expected ||
        cell.denseIndices.length !== expected) {
      throw new Error("Dense-window physical reduction coverage count does not match LOD geometry for " + identity);
    }

    const indices = [...cell.denseIndices];
    const localSeen = new Set<number>();
    for (const index of indices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= sampleCount ||
          localSeen.has(index) || denseOwnership.has(index)) {
        throw new Error("Dense-window physical reduction has invalid or multiply-owned dense sample index " + index);
      }
      localSeen.add(index);
      denseOwnership.add(index);
    }
    prepared.push({
      chunkKey: cell.chunkKey,
      cellIndex: cell.cellIndex,
      level: cell.level,
      denseIndices: indices.sort((a, b) => a - b),
    });
  }

  // Stage every result in detached arrays. No caller-owned output or physical
  // back buffer is mutated if a later cell fails field validation/reduction.
  const staged: DenseWindowPhysicalReduction[] = [];
  for (const cell of prepared) {
    const sources = cell.denseIndices.map(index => {
      const start = index * CELL_FIELDS;
      const vector = new Array<number>(CELL_FIELDS);
      for (let field = 0; field < CELL_FIELDS; field++) vector[field] = denseValues[start + field];
      return vector;
    });
    const target = new Array<number>(CELL_FIELDS).fill(0);
    const transfer = cell.level === 0
      ? InfinityScaleLODTransfer.copy(sources[0], target)
      : InfinityScaleLODTransfer.restrict(sources, target, 0, cell.level);
    staged.push(Object.freeze({
      chunkKey: cell.chunkKey,
      cellIndex: cell.cellIndex,
      level: cell.level,
      denseIndices: Object.freeze(cell.denseIndices.slice()),
      values: Object.freeze(target.slice()),
      transferredFields: Object.freeze(transfer.transferredFields.slice()),
      skippedFields: Object.freeze(transfer.skippedFields.slice()),
    }));
  }

  return Object.freeze(staged);
}
