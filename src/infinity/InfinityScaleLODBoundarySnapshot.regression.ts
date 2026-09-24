import { F } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleLODBoundarySnapshot } from "./InfinityScaleLODBoundarySnapshot";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";
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
    for (let z = 2; z < 4; z++)
      for (let y = 2; y < 4; y++)
        write(state, coarse, 1, 4, y, z, 7);

    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 1, CHUNK);
    const out = assertNotNull(snapshot.read(s, [3, 2, 2]), "fine-to-coarse +X");
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


  // Y+ and Z- face coverage with ratio 2.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const local = key(0, 0);
    const neighborY = key(1, 0, 1, 0);
    const neighborZ = key(1, 0, 0, -1);
    write(state, neighborY, 1, 2, 4, 2, 17);
    write(state, neighborZ, 1, 2, 2, -4, 19);

    const sy = spec(local, neighborY, "fine-to-coarse", 0, 1);
    const sz = spec(local, neighborZ, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(
      state,
      [sy, sz],
      4,
      CHUNK,
    );

    const yOut = assertNotNull(snapshot.read(sy, [2, 3, 2]), "fine-to-coarse +Y");
    const zOut = assertNotNull(snapshot.read(sz, [2, 2, 0]), "fine-to-coarse -Z");
    assertEqual(yOut[F.ENERGY], 17, "fine-to-coarse +Y energy");
    assertEqual(zOut[F.ENERGY], 19, "fine-to-coarse -Z energy");
  }


  // Y- and Z+ faces.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const local = key(0, 0);
    const neighborY = key(1, 0, -1, 0);
    const neighborZ = key(1, 0, 0, 1);
    write(state, neighborY, 1, 2, -4, 2, 29);
    write(state, neighborZ, 1, 2, 2, 4, 31);

    const sy = spec(local, neighborY, "fine-to-coarse", 0, 1);
    const sz = spec(local, neighborZ, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(
      state,
      [sy, sz],
      6,
      CHUNK,
    );

    const yOut = assertNotNull(snapshot.read(sy, [2, 0, 2]), "fine-to-coarse -Y");
    const zOut = assertNotNull(snapshot.read(sz, [2, 2, 3]), "fine-to-coarse +Z");
    assertEqual(yOut[F.ENERGY], 29, "fine-to-coarse -Y energy");
    assertEqual(zOut[F.ENERGY], 31, "fine-to-coarse +Z energy");
  }

  // Edge cell: X+ and Y+ dependencies can both be resolved from the same
  // local corner without confusing one face for the other.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const xNeighbor = key(1, 1, 0, 0);
    const yNeighbor = key(1, 0, 1, 0);
    write(state, xNeighbor, 1, 4, 2, 2, 37);
    write(state, yNeighbor, 1, 2, 4, 2, 41);

    const sx = spec(key(0, 0), xNeighbor, "fine-to-coarse", 0, 1);
    const sy = spec(key(0, 0), yNeighbor, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(
      state,
      [sx, sy],
      7,
      CHUNK,
    );

    const xOut = assertNotNull(snapshot.read(sx, [3, 2, 2]), "edge X+");
    const yOut = assertNotNull(snapshot.read(sy, [2, 3, 2]), "edge Y+");
    assertEqual(xOut[F.ENERGY], 37, "edge X+ energy");
    assertEqual(yOut[F.ENERGY], 41, "edge Y+ energy");
  }

  // Ratio 4: coarse local cell receives a full 4^3 fine block.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(2, 0);
    const fine = key(0, 4);
    for (let dz = 0; dz < 4; dz++)
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++)
          write(state, fine, 0, 16 + dx, dy, dz, 23);

    const s = spec(coarse, fine, "coarse-to-fine", 2, 0);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 5, CHUNK);
    const out = assertNotNull(snapshot.read(s, [15, 1, 1]), "coarse-to-fine ratio 4");
    assertEqual(out[F.ENERGY], 23, "coarse-to-fine ratio 4 energy");
  }

  // Numerical conservation: fine -> coarse restriction preserves extensive
  // quantities as a sum and intensive quantities as a volume average.
  {
    const ratio = 2;
    const sourceLevel = 0;
    const targetLevel = 1;
    const sources = Array.from({ length: ratio ** 3 }, (_, i) => {
      const out = cell(i + 1);
      out[F.ENERGY] = i + 1;
      out[F.DENSITY] = 100 + i;
      out[F.INFORMATION] = 2 * (i + 1);
      return out;
    });
    const target = new Array<number>(24).fill(0);
    InfinityScaleLODTransfer.restrict(sources, target, sourceLevel, targetLevel);

    const invariant = InfinityScaleLODTransfer.validateRestrictionInvariant(
      sources,
      target,
      sourceLevel,
      targetLevel,
    );
    if (!invariant.valid) {
      throw new Error(
        `Infinity Scale regression failed: ratio-2 restriction invariant violated in fields ${invariant.violations.join(",")}`,
      );
    }
    assertEqual(target[F.ENERGY], 36, "ratio-2 extensive energy");
    assertEqual(target[F.INFORMATION], 72, "ratio-2 extensive information");
    assertEqual(target[F.DENSITY], 103.5, "ratio-2 intensive density");
  }

  // Ratio 4 conservation: 64 fine cells must collapse to one coarse cell
  // without losing extensive quantities.
  {
    const ratio = 4;
    const sources = Array.from({ length: ratio ** 3 }, (_, i) => {
      const out = cell(1);
      out[F.ENERGY] = i + 1;
      out[F.INFORMATION] = 3;
      out[F.DENSITY] = 20 + (i % 4);
      return out;
    });
    const target = new Array<number>(24).fill(0);
    InfinityScaleLODTransfer.restrict(sources, target, 0, 2);

    const invariant = InfinityScaleLODTransfer.validateRestrictionInvariant(
      sources,
      target,
      0,
      2,
    );
    if (!invariant.valid) {
      throw new Error(
        `Infinity Scale regression failed: ratio-4 restriction invariant violated in fields ${invariant.violations.join(",")}`,
      );
    }
    assertEqual(target[F.ENERGY], 2080, "ratio-4 extensive energy");
    assertEqual(target[F.INFORMATION], 192, "ratio-4 extensive information");
    assertEqual(target[F.DENSITY], 21.5, "ratio-4 intensive density");
  }

  // Negative-side face: fine local x=[4..7], coarse neighbor x=[0..3].
  {
    const state = new InfinityScaleLODState(CHUNK);
    const fine = key(0, 0);
    const coarse = key(1, -1);
    write(state, coarse, 1, -4, 4, 4, 13);
    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 3, CHUNK);
    const out = assertNotNull(snapshot.read(s, [0, 2, 2]), "fine-to-coarse -X");
    assertEqual(out[F.ENERGY], 13, "fine-to-coarse -X energy");
  }
}
