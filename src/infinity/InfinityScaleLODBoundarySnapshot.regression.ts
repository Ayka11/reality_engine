import { F } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleLODBoundarySnapshot } from "./InfinityScaleLODBoundarySnapshot";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";

const CHUNK = 4;

function key(level: number, x: number, y = 0, z = 0): string {
  return `${level}:${x},${y},${z}`;
}

function cell(value: number): number[] {
  const out = new Array<number>(24).fill(0);
  out[F.ENERGY] = value;
  out[F.DENSITY] = value * 10;
  out[F.MATERIAL_ID] = value;
  return out;
}

function write(
  state: InfinityScaleLODState,
  chunk: string,
  level: number,
  x: number,
  y: number,
  z: number,
  value: number,
): void {
  state.writeBaseCell(chunk, level, x, y, z, cell(value));
}

function assertEqual(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`Infinity Scale regression failed: ${label}: ${actual} !== ${expected}`);
  }
}

function assertNotNull<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Infinity Scale regression failed: ${label}: null`);
  return value;
}

function spec(
  sourceChunk: string,
  targetChunk: string,
  relation: "coarse-to-fine" | "fine-to-coarse",
  sourceLevel: number,
  targetLevel: number,
): InfinityScaleBoundaryTransferSpec {
  return {
    sourceChunk,
    targetChunk,
    relation,
    sourceLevel,
    targetLevel,
    refinementRatio: 2 ** Math.abs(sourceLevel - targetLevel),
    operation: relation === "coarse-to-fine" ? "prolongation" : "restriction",
    readOperation: relation === "coarse-to-fine" ? "restriction" : "prolongation",
  };
}

/**
 * Deterministic numerical regression cases for the pure LOD boundary mapper.
 *
 * This module intentionally exports a runner rather than integrating a test
 * framework, so it can be invoked by any host without adding a test runtime.
 */
export function runInfinityScaleLODBoundaryRegression(): void {
  // Fine local chunk at x=[0..3], coarse neighbor at x=[4..11].
  {
    const state = new InfinityScaleLODState(CHUNK);
    const fine = key(0, 0);
    const coarse = key(1, 1);
    for (let z = 4; z < 6; z++)
      for (let y = 4; y < 6; y++)
        write(state, coarse, 1, 4, y, z, 7);

    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 1, CHUNK);
    const out = assertNotNull(snapshot.read(s, [3, 4, 4]), "fine-to-coarse +X");
    assertEqual(out[F.ENERGY], 7, "fine-to-coarse +X energy");
    assertEqual(out[F.DENSITY], 70, "fine-to-coarse +X density");
  }

  // Coarse local chunk at x=[0..7], fine neighbor at x=[8..11].
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    write(state, fine, 0, 8, 4, 4, 11);
    const s = spec(coarse, fine, "coarse-to-fine", 1, 0);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 2, CHUNK);
    const out = assertNotNull(snapshot.read(s, [7, 4, 4]), "coarse-to-fine +X");
    assertEqual(out[F.ENERGY], 11, "coarse-to-fine +X energy");
  }

  // Negative-side face: fine local x=[4..7], coarse neighbor x=[0..3].
  {
    const state = new InfinityScaleLODState(CHUNK);
    const fine = key(0, 1);
    const coarse = key(1, -1);
    write(state, coarse, 1, -4, 4, 4, 13);
    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 3, CHUNK);
    const out = assertNotNull(snapshot.read(s, [4, 4, 4]), "fine-to-coarse -X");
    assertEqual(out[F.ENERGY], 13, "fine-to-coarse -X energy");
  }
}
