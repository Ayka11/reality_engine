import { CELL_FIELDS } from "../core/CellState";
import {
  InfinityScaleLODState,
  type InfinityScaleLODChunkState,
} from "./InfinityScaleLODState";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";

export interface InfinityScaleLODTransferSample {
  sourceChunk: string;
  targetChunk: string;
  relation: "same-level" | "coarse-to-fine" | "fine-to-coarse";
  targetCell: [number, number, number];
  value: Float32Array;
}

export interface InfinityScaleLODBoundaryCoverage {
  requiredSourceChunks: string[];
  missingSourceChunks: string[];
  complete: boolean;
}

/**
 * Immutable read-only boundary snapshot.
 *
 * Local solvers consume this object during a frame instead of reading and
 * mutating another LOD owner's state. The snapshot is intentionally detached
 * from InfinityScaleLODState so later local writes cannot change the values
 * observed by the current tick.
 */
export class InfinityScaleLODBoundarySnapshot {
  private readonly chunks = new Map<string, InfinityScaleLODChunkState>();

  private constructor(
    readonly specs: InfinityScaleBoundaryTransferSpec[],
    chunkStates: InfinityScaleLODChunkState[],
    readonly revision: number,
    readonly chunkSize = 32,
  ) {
    for (const state of chunkStates) {
      this.chunks.set(state.key, {
        key: state.key,
        level: state.level,
        scale: state.scale,
        cells: new Float32Array(state.cells),
      });
    }
  }

  static capture(
    state: InfinityScaleLODState,
    specs: InfinityScaleBoundaryTransferSpec[],
    revision: number,
    chunkSize = 32,
  ): InfinityScaleLODBoundarySnapshot {
    const sourceKeys = new Set<string>();
    for (const spec of specs) sourceKeys.add(spec.targetChunk);

    const chunks: InfinityScaleLODChunkState[] = [];
    for (const key of sourceKeys) {
      const source = state.getChunk(key);
      if (source) chunks.push(source);
    }

    return new InfinityScaleLODBoundarySnapshot(
      specs.map(spec => ({ ...spec })),
      chunks,
      revision,
      chunkSize,
    );
  }

  hasSourceChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  /**
   * Returns an explicit coverage report for every source chunk required by
   * the immutable transfer contract. A missing source is a hard execution
   * error; local solvers must not silently fall back to mutable or stale state.
   */
  getCoverage(): InfinityScaleLODBoundaryCoverage {
    const requiredSourceChunks = [...new Set(this.specs.map(spec => spec.targetChunk))].sort();
    const missingSourceChunks = requiredSourceChunks.filter(
      key => !this.chunks.has(key),
    );
    return {
      requiredSourceChunks,
      missingSourceChunks,
      complete: missingSourceChunks.length === 0,
    };
  }

  assertCoverage(): void {
    const coverage = this.getCoverage();
    if (!coverage.complete) {
      throw new Error(
        `Infinity Scale mixed-LOD boundary snapshot is incomplete; missing source chunks: ${coverage.missingSourceChunks.join(", ")}`,
      );
    }
  }

  /**
   * Reads a base-resolution target coordinate from the corresponding
   * neighboring LOD owner. For a coarse source, the source cell covering the
   * target coordinate is returned as piecewise-constant prolongation.
   */
  read(
    spec: InfinityScaleBoundaryTransferSpec,
    targetCell: [number, number, number],
  ): Float32Array | null {
    const source = this.chunks.get(spec.targetChunk);
    if (!source) return null;

    const [x, y, z] = targetCell;
    const [cx, cy, cz] = parseChunkKey(spec.targetChunk);
    const originScale = source.scale;
    const originX = cx * this.chunkSize * originScale;
    const originY = cy * this.chunkSize * originScale;
    const originZ = cz * this.chunkSize * originScale;

    const lx = Math.floor((x - originX) / originScale);
    const ly = Math.floor((y - originY) / originScale);
    const lz = Math.floor((z - originZ) / originScale);

    if (
      lx < 0 || lx >= this.chunkSize ||
      ly < 0 || ly >= this.chunkSize ||
      lz < 0 || lz >= this.chunkSize
    ) return null;

    const offset = ((lz * this.chunkSize * this.chunkSize) + ly * this.chunkSize + lx) * CELL_FIELDS;
    const out = new Float32Array(CELL_FIELDS);

    if (spec.readOperation === "copy" || spec.readOperation === "prolongation") {
      out.set(source.cells.subarray(offset, offset + CELL_FIELDS));
      return out;
    }

    if (spec.readOperation === "restriction") {
      const sourceScale = source.scale;
      const fineBaseX = Math.floor(x / sourceScale) * sourceScale;
      const fineBaseY = Math.floor(y / sourceScale) * sourceScale;
      const fineBaseZ = Math.floor(z / sourceScale) * sourceScale;
      const ratio = spec.refinementRatio;
      const fineCells: Float32Array[] = [];

      for (let dz = 0; dz < ratio; dz++) {
        for (let dy = 0; dy < ratio; dy++) {
          for (let dx = 0; dx < ratio; dx++) {
            const fx = fineBaseX + dx * sourceScale;
            const fy = fineBaseY + dy * sourceScale;
            const fz = fineBaseZ + dz * sourceScale;
            const flx = Math.floor((fx - originX) / sourceScale);
            const fly = Math.floor((fy - originY) / sourceScale);
            const flz = Math.floor((fz - originZ) / sourceScale);
            if (
              flx < 0 || flx >= this.chunkSize ||
              fly < 0 || fly >= this.chunkSize ||
              flz < 0 || flz >= this.chunkSize
            ) return null;

            const fineOffset = ((flz * this.chunkSize * this.chunkSize) + fly * this.chunkSize + flx) * CELL_FIELDS;
            const cell = new Float32Array(CELL_FIELDS);
            cell.set(source.cells.subarray(fineOffset, fineOffset + CELL_FIELDS));
            fineCells.push(cell);
          }
        }
      }

      const restricted = new Float32Array(CELL_FIELDS);
      const numeric = new Array<number>(CELL_FIELDS).fill(0);
      InfinityScaleLODTransfer.restrict(fineCells, numeric, spec.targetLevel, spec.sourceLevel);
      restricted.set(numeric);
      return restricted;
    }

    return null;
  }

  getSpecs(): InfinityScaleBoundaryTransferSpec[] {
    return this.specs.map(spec => ({ ...spec }));
  }

  get revisionId(): number {
    return this.revision;
  }
}

function parseChunkKey(key: string): [number, number, number] {
  const match = /^(?:\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
