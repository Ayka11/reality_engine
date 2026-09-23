import { CELL_FIELDS } from "../core/CellState";
import {
  InfinityScaleLODState,
  type InfinityScaleLODChunkState,
} from "./InfinityScaleLODState";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

export interface InfinityScaleLODTransferSample {
  sourceChunk: string;
  targetChunk: string;
  relation: "same-level" | "coarse-to-fine" | "fine-to-coarse";
  targetCell: [number, number, number];
  value: Float32Array;
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
  ): InfinityScaleLODBoundarySnapshot {
    const sourceKeys = new Set<string>();
    for (const spec of specs) sourceKeys.add(spec.targetChunk);

    const chunks: InfinityScaleLODChunkState[] = [];
    for (const key of sourceKeys) {
      const source = state.getChunk(key);
      if (source) chunks.push(source);
    }

    return new InfinityScaleLODBoundarySnapshot(specs.map(spec => ({ ...spec })), chunks, revision);
  }

  hasSourceChunk(key: string): boolean {
    return this.chunks.has(key);
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
    const originX = cx * 32 * originScale;
    const originY = cy * 32 * originScale;
    const originZ = cz * 32 * originScale;

    const lx = Math.floor((x - originX) / originScale);
    const ly = Math.floor((y - originY) / originScale);
    const lz = Math.floor((z - originZ) / originScale);

    if (
      lx < 0 || lx >= 32 ||
      ly < 0 || ly >= 32 ||
      lz < 0 || lz >= 32
    ) return null;

    const offset = ((lz * 32 * 32) + ly * 32 + lx) * CELL_FIELDS;
    const out = new Float32Array(CELL_FIELDS);

    if (spec.operation === "copy" || spec.operation === "prolongation") {
      out.set(source.cells.subarray(offset, offset + CELL_FIELDS));
      return out;
    }

    // A restriction sample requires a complete fine block. A single base
    // target coordinate cannot safely synthesize that block from a coarse
    // source, so fail closed rather than inventing a value.
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
