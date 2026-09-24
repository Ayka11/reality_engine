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
    for (const spec of specs) sourceKeys.add(spec.sourceChunk);

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
    const requiredSourceChunks = [...new Set(this.specs.map(spec => spec.sourceChunk))].sort();
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
    const source = this.chunks.get(spec.sourceChunk);
    if (!source) return null;

    const sourceRange = chunkRangeForKey(spec.sourceChunk, this.chunkSize);
    const targetRange = chunkRangeForKey(spec.targetChunk, this.chunkSize);
    const sourceScale = 2 ** spec.sourceLevel;
    const targetScale = 2 ** spec.targetLevel;
    const [x, y, z] = targetCell;
    const face = resolveBoundaryReadFace(sourceRange, targetRange, x, y, z);
    if (!face) return null;

    const out = new Float32Array(CELL_FIELDS);

    // The solver asks for the dependency cell across the interface.
    // For fine->coarse, that dependency is a fine face footprint matching
    // the coarse cell's tangential extent, so restrict exactly ratio^2 cells.
    if (spec.relation === "fine-to-coarse") {
      const ratio = spec.refinementRatio;
      const sourceFaceOrigin = [x, y, z] as [number, number, number];
      const axis = face.axis === "x" ? 0 : face.axis === "y" ? 1 : 2;
      const tangentialAxes = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];

      sourceFaceOrigin[tangentialAxes[0]] =
        Math.floor(sourceFaceOrigin[tangentialAxes[0]] / targetScale) * targetScale;
      sourceFaceOrigin[tangentialAxes[1]] =
        Math.floor(sourceFaceOrigin[tangentialAxes[1]] / targetScale) * targetScale;

      const sources: Float32Array[] = [];
      for (let b = 0; b < ratio; b++) {
        for (let a = 0; a < ratio; a++) {
          const coords: [number, number, number] = [...sourceFaceOrigin];
          coords[tangentialAxes[0]] += a * sourceScale;
          coords[tangentialAxes[1]] += b * sourceScale;
          const lx = Math.floor((coords[0] - sourceRange.minX) / sourceScale);
          const ly = Math.floor((coords[1] - sourceRange.minY) / sourceScale);
          const lz = Math.floor((coords[2] - sourceRange.minZ) / sourceScale);
          if (
            lx < 0 || lx >= this.chunkSize ||
            ly < 0 || ly >= this.chunkSize ||
            lz < 0 || lz >= this.chunkSize
          ) return null;
          const offset =
            ((lz * this.chunkSize * this.chunkSize) + ly * this.chunkSize + lx) * CELL_FIELDS;
          const cell = new Float32Array(CELL_FIELDS);
          cell.set(source.cells.subarray(offset, offset + CELL_FIELDS));
          sources.push(cell);
        }
      }
      InfinityScaleLODTransfer.restrictFace(
        sources,
        out,
        spec.sourceLevel,
        spec.targetLevel,
      );
      return out;
    }

    // For coarse->fine, the dependency is one coarse cell touching the
    // interface. Move one base cell into the source side before mapping it
    // into the coarse chunk.
    if (spec.relation === "coarse-to-fine") {
      const sourceCell = [
        Math.floor(shiftAcrossFace(targetCell, face, -face.direction)[0] / sourceScale) * sourceScale,
        Math.floor(shiftAcrossFace(targetCell, face, -face.direction)[1] / sourceScale) * sourceScale,
        Math.floor(shiftAcrossFace(targetCell, face, -face.direction)[2] / sourceScale) * sourceScale,
      ] as [number, number, number];
      const lx = Math.floor((sourceCell[0] - sourceRange.minX) / sourceScale);
      const ly = Math.floor((sourceCell[1] - sourceRange.minY) / sourceScale);
      const lz = Math.floor((sourceCell[2] - sourceRange.minZ) / sourceScale);
      if (
        lx < 0 || lx >= this.chunkSize ||
        ly < 0 || ly >= this.chunkSize ||
        lz < 0 || lz >= this.chunkSize
      ) return null;
      const offset =
        ((lz * this.chunkSize * this.chunkSize) + ly * this.chunkSize + lx) * CELL_FIELDS;
      out.set(source.cells.subarray(offset, offset + CELL_FIELDS));
      return out;
    }

    if (spec.relation === "same-level") {
      const sourceCell = shiftAcrossFace(targetCell, face, -face.direction);
      const lx = sourceCell[0] - sourceRange.minX;
      const ly = sourceCell[1] - sourceRange.minY;
      const lz = sourceCell[2] - sourceRange.minZ;
      if (
        lx < 0 || lx >= this.chunkSize ||
        ly < 0 || ly >= this.chunkSize ||
        lz < 0 || lz >= this.chunkSize
      ) return null;
      const offset =
        ((lz * this.chunkSize * this.chunkSize) + ly * this.chunkSize + lx) * CELL_FIELDS;
      out.set(source.cells.subarray(offset, offset + CELL_FIELDS));
      return out;
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

interface BoundaryFace {
  axis: "x" | "y" | "z";
  direction: -1 | 1;
}

function chunkRangeForKey(
  key: string,
  chunkSize: number,
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const [level, cx, cy, cz] = (() => {
    const match = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
    if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  })();
  const scale = 2 ** level;
  const extent = chunkSize * scale;
  return {
    minX: cx * extent,
    maxX: cx * extent + extent - 1,
    minY: cy * extent,
    maxY: cy * extent + extent - 1,
    minZ: cz * extent,
    maxZ: cz * extent + extent - 1,
  };
}


function resolveBoundaryReadFace(
  source: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  target: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  x: number,
  y: number,
  z: number,
): BoundaryFace | null {
  if (source.maxX + 1 === target.minX && x === target.minX && y >= target.minY && y <= target.maxY && z >= target.minZ && z <= target.maxZ) return { axis: "x", direction: 1 };
  if (target.maxX + 1 === source.minX && x === source.minX && y >= target.minY && y <= target.maxY && z >= target.minZ && z <= target.maxZ) return { axis: "x", direction: -1 };
  if (source.maxY + 1 === target.minY && y === target.minY && x >= target.minX && x <= target.maxX && z >= target.minZ && z <= target.maxZ) return { axis: "y", direction: 1 };
  if (target.maxY + 1 === source.minY && y === source.minY && x >= target.minX && x <= target.maxX && z >= target.minZ && z <= target.maxZ) return { axis: "y", direction: -1 };
  if (source.maxZ + 1 === target.minZ && z === target.minZ && x >= target.minX && x <= target.maxX && y >= target.minY && y <= target.maxY) return { axis: "z", direction: 1 };
  if (target.maxZ + 1 === source.minZ && z === source.minZ && x >= target.minX && x <= target.maxX && y >= target.minY && y <= target.maxY) return { axis: "z", direction: -1 };
  return null;
}
function resolveBoundaryFace(
  source: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  target: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  x: number,
  y: number,
  z: number,
): BoundaryFace | null {
  if (source.maxX + 1 === target.minX && x === source.maxX &&
      y >= target.minY && y <= target.maxY &&
      z >= target.minZ && z <= target.maxZ) return { axis: "x", direction: 1 };
  if (target.maxX + 1 === source.minX && x === source.minX &&
      y >= target.minY && y <= target.maxY &&
      z >= target.minZ && z <= target.maxZ) return { axis: "x", direction: -1 };
  if (source.maxY + 1 === target.minY && y === source.maxY &&
      x >= target.minX && x <= target.maxX &&
      z >= target.minZ && z <= target.maxZ) return { axis: "y", direction: 1 };
  if (target.maxY + 1 === source.minY && y === source.minY &&
      x >= target.minX && x <= target.maxX &&
      z >= target.minZ && z <= target.maxZ) return { axis: "y", direction: -1 };
  if (source.maxZ + 1 === target.minZ && z === source.maxZ &&
      x >= target.minX && x <= target.maxX &&
      y >= target.minY && y <= target.maxY) return { axis: "z", direction: 1 };
  if (target.maxZ + 1 === source.minZ && z === source.minZ &&
      x >= target.minX && x <= target.maxX &&
      y >= target.minY && y <= target.maxY) return { axis: "z", direction: -1 };
  return null;
}

function shiftAcrossFace(
  point: [number, number, number],
  face: BoundaryFace,
  distance: number,
): [number, number, number] {
  const shifted: [number, number, number] = [...point];
  shifted[face.axis === "x" ? 0 : face.axis === "y" ? 1 : 2] += face.direction * distance;
  return shifted;
}
