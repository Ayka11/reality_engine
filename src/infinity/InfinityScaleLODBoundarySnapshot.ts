import { CELL_FIELDS } from "../core/CellState";
import {
  InfinityScaleLODState,
  type InfinityScaleLODChunkState,
} from "./InfinityScaleLODState";
import type {
  InfinityScaleBoundaryTransferSpec,
  InfinityScaleChunkExecutionContext,
} from "./InfinityScaleChunkExecutionContext";
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
  invalidBoundaryReads: number;
  firstInvalidRead?: {
    sourceChunk: string;
    targetChunk: string;
    relation: string;
    targetCell: [number, number, number];
  };
}

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

  getCoverage(): InfinityScaleLODBoundaryCoverage {
    const requiredSourceChunks = [...new Set(this.specs.map(spec => spec.targetChunk))].sort();
    const missingSourceChunks = requiredSourceChunks.filter(key => !this.chunks.has(key));
    return {
      requiredSourceChunks,
      missingSourceChunks,
      complete: missingSourceChunks.length === 0,
      invalidBoundaryReads: 0,
    };
  }

  validateFaceCoverage(
    context: InfinityScaleChunkExecutionContext,
  ): InfinityScaleLODBoundaryCoverage {
    const base = this.getCoverage();
    let invalidBoundaryReads = 0;
    let firstInvalidRead = base.firstInvalidRead;

    for (const range of context.simulationRanges) {
      const faces = [
        { axis: "x", value: range.minX },
        { axis: "x", value: range.maxX },
        { axis: "y", value: range.minY },
        { axis: "y", value: range.maxY },
        { axis: "z", value: range.minZ },
        { axis: "z", value: range.maxZ },
      ] as const;

      const seen = new Set<string>();
      for (const face of faces) {
        for (let z = range.minZ; z <= range.maxZ; z++) {
          for (let y = range.minY; y <= range.maxY; y++) {
            for (let x = range.minX; x <= range.maxX; x++) {
              if (
                (face.axis === "x" && x !== face.value) ||
                (face.axis === "y" && y !== face.value) ||
                (face.axis === "z" && z !== face.value)
              ) continue;

              const key = `${x},${y},${z}`;
              if (seen.has(key)) continue;
              seen.add(key);

              const specs = context.getBoundaryTransferSpecsForCell(x, y, z)
                .filter(spec => spec.sourceLevel !== spec.targetLevel);

              for (const spec of specs) {
                if (!this.hasSourceChunk(spec.targetChunk) || !this.read(spec, [x, y, z])) {
                  invalidBoundaryReads++;
                  if (!firstInvalidRead) {
                    firstInvalidRead = {
                      sourceChunk: spec.sourceChunk,
                      targetChunk: spec.targetChunk,
                      relation: spec.relation,
                      targetCell: [x, y, z],
                    };
                  }
                }
              }
            }
          }
        }
      }
    }

    return {
      ...base,
      complete: base.complete && invalidBoundaryReads === 0,
      invalidBoundaryReads,
      ...(firstInvalidRead ? { firstInvalidRead } : {}),
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

  assertFaceCoverage(context: InfinityScaleChunkExecutionContext): void {
    const coverage = this.validateFaceCoverage(context);
    if (!coverage.complete) {
      const detail = coverage.firstInvalidRead
        ? ` at ${coverage.firstInvalidRead.targetCell.join(",")}`
        : "";
      throw new Error(
        `Infinity Scale mixed-LOD boundary face coverage is incomplete: ${coverage.invalidBoundaryReads} invalid reads${detail}`,
      );
    }
  }

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

            const fineOffset = ((flz * this.chunkSize * this.chunkSize) + fly * this.chunkSize + flz * 0 + flx) * CELL_FIELDS;
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
