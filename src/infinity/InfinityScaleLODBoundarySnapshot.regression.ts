import { F } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleLODBoundarySnapshot } from "./InfinityScaleLODBoundarySnapshot";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import { InfinityScaleLODBoundaryCellMapper } from "./InfinityScaleLODBoundaryCellMapper";
import { validateInfinityScaleBoundaryGeometry } from "./InfinityScaleLODBoundaryGeometry";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleExecutionPlan } from "./InfinityScaleExecutionAdapter";

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
  // Geometry validation must use the same canonical face definition as the mapper.
  {
    const s = spec(key(0, 8), key(1, 0), "fine-to-coarse", 0, 1);
    const valid = validateInfinityScaleBoundaryGeometry(s, [7, 2, 2], CHUNK);
    if (!valid || valid.axis !== "x" || valid.direction !== 1) {
      throw new Error("Infinity Scale regression failed: canonical boundary geometry validation");
    }
    const interior = validateInfinityScaleBoundaryGeometry(s, [6, 2, 2], CHUNK);
    if (interior !== null) {
      throw new Error("Infinity Scale regression failed: interior target cell accepted as boundary");
    }
  }

  // Cross-layer contract: the immutable snapshot and state-backed mapper must
  // resolve the same canonical fine->coarse footprint.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    let value = 10;
    for (let z = 0; z < 2; z++) {
      for (let y = 0; y < 2; y++) {
        const cell = new Float32Array(CELL_FIELDS);
        cell[F.ENERGY] = value++;
        state.writeBaseCell(fine, 0, 8, y, z, cell);
      }
    }
    const transfer = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const mapper = new InfinityScaleLODBoundaryCellMapper(state, CHUNK);
    const mapping = mapper.map(transfer, [7, 0, 0]);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [transfer], 101, CHUNK);
    const out = assertNotNull(snapshot.read(transfer, [7, 0, 0]), "canonical cross-layer snapshot read");
    const mapped = mapper.resolveValues(transfer, [7, 0, 0]);
    if (mapping.sourceCells.length !== mapped.length || out[F.ENERGY] !== 46) {
      throw new Error("Infinity Scale regression failed: canonical mapper/snapshot contract");
    }
  }

  // Fine local chunk at x=[0..3], coarse neighbor at x=[4..11].
  {
    const state = new InfinityScaleLODState(CHUNK);
    const fine = key(0, 0);
    const coarse = key(1, 0);
    for (let z = 0; z < 2; z++)
      for (let y = 0; y < 2; y++)
        write(state, fine, 0, 8, y, z, 7);

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
    const fine = key(0, 8);
    for (let dz = 0; dz < 4; dz++)
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 4; dx++)
          write(state, fine, 0, 16 + dx, dy, dz, 23);

    const s = spec(coarse, fine, "coarse-to-fine", 2, 0);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 5, CHUNK);
    const out = assertNotNull(snapshot.read(s, [15, 1, 1]), "coarse-to-fine ratio 4");
    assertEqual(out[F.ENERGY], 23, "coarse-to-fine ratio 4 energy");
  }

  // Mixed-LOD coarse -> fine must map one coarse face cell to the
  // correct fine boundary cells without collapsing the tangential mapping.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);

    // Coarse X+ face cell at base coordinate (6, 2, 2) carries a unique value.
    write(state, coarse, 1, 6, 2, 2, 77);

    const s = spec(coarse, fine, "coarse-to-fine", 1, 0);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 12, CHUNK);

    const values: number[] = [];
    for (const y of [2, 3]) {
      for (const z of [2, 3]) {
        const out = assertNotNull(
          snapshot.read(s, [8, y, z]),
          `coarse-to-fine face cell 4,${y},${z}`,
        );
        values.push(out[F.ENERGY]);
      }
    }

    if (values.length !== 4 || values.some(value => value !== 77)) {
      throw new Error(
        `Infinity Scale regression failed: coarse-to-fine face mapping produced [${values.join(",")}]`,
      );
    }

    const outside = snapshot.read(s, [4, 4, 4]);
    if (outside !== null) {
      throw new Error(
        "Infinity Scale regression failed: coarse-to-fine read accepted a non-face target cell",
      );
    }
  }

  // Face coverage must validate source dependencies as well, not merely
  // whether the target simulation chunk exists.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    write(state, fine, 0, 8, 0, 0, 55);

    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 14, CHUNK);
    const coverage = snapshot.getCoverage();
    if (!coverage.complete || coverage.missingSourceChunks.length !== 0) {
      throw new Error("Infinity Scale regression failed: source dependency coverage is incomplete");
    }
  }

  // Context relation lookup must be expressed in target simulation-cell
  // coordinates, including coarse->fine and fine->coarse interfaces.
  {
    const plan: InfinityScaleExecutionPlan = {
      revision: 1, mode: "selective-cpu-ready" as const, observer: [0, 0, 0] as [number,number,number],
      chunks: [{ key: "1:0,0,0", lod: 1, distance: 0 }],
      simulationBudget: 1, requestedSimulationCount: 1, selectedSimulationCount: 1,
      maxSimulatingChunks: 1, boundaryReadChunks: ["0:8,0,0"], boundaryReadCount: 1,
      boundaryReadRelations: [{ sourceChunk: "0:8,0,0", targetChunk: "1:0,0,0", relation: "fine-to-coarse" as const }],
      simulationCellCount: 64, boundaryReadCellCount: 64, localExecutionLayers: 1, globalExecutionLayers: 1,
      selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
      lodBoundaryTransferReady: true, mixedLodExecutionReady: true,
      entityExecutionReady: false, agentMigrationReady: false,
    };
    const context = new InfinityScaleChunkExecutionContext(plan, 12, 8, 8, 4);
    const relations = context.getBoundaryRelationsForCell(7, 2, 2);
    if (relations.length !== 1 || relations[0].sourceChunk !== "0:8,0,0") {
      throw new Error("Infinity Scale regression failed: target-cell boundary relation lookup");
    }
    if (context.getBoundaryRelationsForCell(6, 2, 2).length !== 0) {
      throw new Error("Infinity Scale regression failed: non-boundary target cell received relation");
    }
  }

  // Context relation lookup must reject corner-only adjacency and accept exact faces.
  {
    const plan: InfinityScaleExecutionPlan = {
      revision: 77, mode: "selective-cpu-ready", observer: [0, 0, 0],
      chunks: [{ key: "1:0,0,0", lod: 1, distance: 0 }], simulationBudget: 1,
      requestedSimulationCount: 1, selectedSimulationCount: 1, maxSimulatingChunks: 1,
      boundaryReadChunks: ["0:8,0,0"], boundaryReadCount: 1,
      boundaryReadRelations: [{ sourceChunk: "0:8,0,0", targetChunk: "1:0,0,0", relation: "fine-to-coarse" }],
      simulationCellCount: 64, boundaryReadCellCount: 64, localExecutionLayers: 1, globalExecutionLayers: 1,
      selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
      lodBoundaryTransferReady: true, mixedLodExecutionReady: true, entityExecutionReady: false, agentMigrationReady: false,
    };
    const context = new InfinityScaleChunkExecutionContext(plan, 16, 16, 16, 4);
    if (context.getBoundaryRelationsForCell(7, 2, 2).length !== 1) throw new Error("context exact face lookup failed");
    if (context.getBoundaryRelationsForCell(7, 7, 7).length !== 1) throw new Error("context face corner lookup failed");
    if (context.getBoundaryRelationsForCell(6, 2, 2).length !== 0) throw new Error("context admitted non-face target");
  }

  // Face coverage must count invalid reads deterministically and expose
  // the first failing dependency instead of silently passing the boundary.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    state.ensureChunk(coarse, 1);
    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 16, CHUNK);
    const coverage = snapshot.validateFaceCoverage(
      new InfinityScaleChunkExecutionContext(
        {
          revision: 16, mode: "selective-cpu-ready", observer: [0, 0, 0],
          chunks: [{ key: coarse, lod: 1, distance: 0 }],
          simulationBudget: 1, requestedSimulationCount: 1, selectedSimulationCount: 1,
          maxSimulatingChunks: 1, boundaryReadChunks: [fine], boundaryReadCount: 1,
          boundaryReadRelations: [{ sourceChunk: fine, targetChunk: coarse, relation: "fine-to-coarse" }],
          simulationCellCount: 64, boundaryReadCellCount: 16,
          localExecutionLayers: 1, globalExecutionLayers: 1,
          selectiveCpuReady: true, selectiveGpuReady: false, gpuPhysicsReady: false,
          lodBoundaryTransferReady: true, mixedLodExecutionReady: true,
          entityExecutionReady: false, agentMigrationReady: false,
        },
        8, 8, 8, 4,
      ),
    );
    if (coverage.complete || coverage.invalidBoundaryReads === 0 || !coverage.firstInvalidRead) {
      throw new Error("Infinity Scale regression failed: invalid boundary coverage was not reported");
    }
    if (coverage.firstInvalidRead.sourceChunk !== fine) {
      throw new Error("Infinity Scale regression failed: first invalid read lost source dependency");
    }
  }

  // Missing dependency must remain a hard coverage failure.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    state.ensureChunk(coarse, 1);

    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 15, CHUNK);
    const coverage = snapshot.getCoverage();
    if (coverage.complete || coverage.missingSourceChunks[0] !== fine) {
      throw new Error(
        "Infinity Scale regression failed: missing source dependency was not reported",
      );
    }
  }

  // Snapshot coverage must materialize the dependency source chunk, not the
  // simulation target chunk. This catches source/target inversion at capture time.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    write(state, fine, 0, 8, 0, 0, 91);

    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 13, CHUNK);
    const coverage = snapshot.getCoverage();
    if (!coverage.complete || coverage.requiredSourceChunks.length !== 1 ||
        coverage.requiredSourceChunks[0] !== fine) {
      throw new Error(
        `Infinity Scale regression failed: snapshot dependency coverage is [${coverage.requiredSourceChunks.join(",")}]`,
      );
    }
    if (!snapshot.hasSourceChunk(fine) || snapshot.hasSourceChunk(coarse)) {
      throw new Error(
        "Infinity Scale regression failed: snapshot captured target chunk instead of source dependency",
      );
    }
  }

  // Mixed-LOD face restriction must aggregate exactly ratio^2 fine cells,
  // not the ratio^3 volume used by interior restriction.
  {
    const state = new InfinityScaleLODState(CHUNK);
    const coarse = key(1, 0);
    const fine = key(0, 8);
    let value = 1;
    for (let z = 0; z < 2; z++) {
      for (let y = 0; y < 2; y++) {
        const v = value++;
        write(state, fine, 0, 8, y, z, v);
      }
    }

    const s = spec(fine, coarse, "fine-to-coarse", 0, 1);
    const snapshot = InfinityScaleLODBoundarySnapshot.capture(state, [s], 11, CHUNK);
    const out = assertNotNull(snapshot.read(s, [3, 1, 1]), "fine-to-coarse face restriction");

    // ENERGY is extensive, so the boundary face sample is the sum of the four
    // fine cells: 1 + 2 + 3 + 4 = 10.
    assertEqual(out[F.ENERGY], 10, "fine-to-coarse face extensive energy");
    // DENSITY is intensive, so the same face footprint is averaged.
    assertEqual(out[F.DENSITY], 25, "fine-to-coarse face intensive density");
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

  // Prolongation invariant: one coarse state must reproduce the same
  // intensive state in every fine child.
  {
    const source = cell(42);
    source[F.DENSITY] = 12.5;
    source[F.TEMPERATURE] = 287.4;
    const targets = Array.from({ length: 8 }, () => new Array<number>(24).fill(0));
    InfinityScaleLODTransfer.prolongate(source, targets, 1, 0);

    const invariant = InfinityScaleLODTransfer.validateProlongationInvariant(
      source,
      targets,
      1,
      0,
    );
    if (!invariant.valid) {
      throw new Error(
        `Infinity Scale regression failed: prolongation invariant violated in fields ${invariant.violations.join(",")}`,
      );
    }
    assertEqual(targets[0][F.DENSITY], 12.5, "ratio-2 prolongation density");
    assertEqual(targets[7][F.TEMPERATURE], 287.4, "ratio-2 prolongation temperature");
  }

  // Prolongation/restriction round trip for a uniform state. The state must
  // return exactly to the original value for both intensive and extensive
  // policies under the baseline operators.
  {
    const source = cell(9);
    source[F.ENERGY] = 64;
    source[F.INFORMATION] = 32;
    source[F.DENSITY] = 4;

    const children = Array.from({ length: 8 }, () => new Array<number>(24).fill(0));
    InfinityScaleLODTransfer.prolongate(source, children, 1, 0);

    const roundTrip = new Array<number>(24).fill(0);
    InfinityScaleLODTransfer.restrict(children, roundTrip, 0, 1);

    assertEqual(roundTrip[F.DENSITY], source[F.DENSITY], "uniform round-trip density");
    assertEqual(roundTrip[F.ENERGY], source[F.ENERGY], "uniform round-trip extensive energy");
    assertEqual(
      roundTrip[F.INFORMATION],
      source[F.INFORMATION],
      "uniform round-trip extensive information",
    );
  }

  // Full-cell convergence contract: uniform states must survive
  // coarse -> fine -> coarse transfer within numerical tolerance.
  {
    const source = cell(17);
    source[F.ENERGY] = 96;
    source[F.INFORMATION] = 48;
    source[F.DENSITY] = 0.625;
    source[F.TEMPERATURE] = 291.25;
    source[F.WAVE_PHASE] = 1.2345;
    source[F.MATERIAL_ID] = 7;

    const children = Array.from({ length: 8 }, () => new Array<number>(24).fill(0));
    InfinityScaleLODTransfer.prolongate(source, children, 1, 0);

    const roundTrip = new Array<number>(24).fill(0);
    InfinityScaleLODTransfer.restrict(children, roundTrip, 0, 1);

    const tolerance = 1e-6;
    for (const field of [
      F.ENERGY,
      F.INFORMATION,
      F.DENSITY,
      F.TEMPERATURE,
      F.WAVE_PHASE,
      F.MATERIAL_ID,
    ]) {
      const error = field === F.WAVE_PHASE
        ? Math.abs(
            Math.atan2(
              Math.sin(roundTrip[field] - source[field]),
              Math.cos(roundTrip[field] - source[field]),
            ),
          )
        : Math.abs(roundTrip[field] - source[field]);
      if (error > tolerance) {
        throw new Error(
          `Infinity Scale convergence regression failed for field ${field}: error=${error}`,
        );
      }
    }
  }

  // Circular phase regression: arithmetic averaging of +179° and -179°
  // would incorrectly approach 0°, while phasor averaging stays near pi.
  {
    const sources = Array.from({ length: 8 }, (_, i) => {
      const out = cell(i + 1);
      out[F.WAVE_PHASE] = i % 2 === 0 ? (179 * Math.PI) / 180 : (-179 * Math.PI) / 180;
      return out;
    });
    const target = new Array<number>(24).fill(0);
    InfinityScaleLODTransfer.restrict(sources, target, 0, 1);

    const expected = Math.PI;
    const phaseError = Math.abs(
      Math.atan2(
        Math.sin(target[F.WAVE_PHASE] - expected),
        Math.cos(target[F.WAVE_PHASE] - expected),
      ),
    );
    if (phaseError > 1e-6) {
      throw new Error(
        `Infinity Scale regression failed: circular phase error ${phaseError}`,
      );
    }

    const invariant = InfinityScaleLODTransfer.validateRestrictionInvariant(
      sources,
      target,
      0,
      1,
    );
    if (!invariant.valid && invariant.violations.includes(F.WAVE_PHASE)) {
      throw new Error("Infinity Scale regression failed: phase treated as arithmetic field");
    }
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
