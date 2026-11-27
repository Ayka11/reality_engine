import { CELL_FIELDS, F } from "../core/CellState";
import { stageDenseWindowPhysicalReductions } from "./InfinityScaleDenseWindowReduction";

function rejected(label: string, operation: () => unknown, message: string): void {
  let failure: unknown;
  try { operation(); } catch (error) { failure = error; }
  if (!(failure instanceof Error) || !failure.message.includes(message)) {
    throw new Error(label + " was not rejected at the expected boundary: " + String(failure));
  }
}

export function runInfinityScaleDenseWindowReductionRegression(): void {
  const values = new Float32Array(8 * CELL_FIELDS);
  for (let index = 0; index < 8; index++) {
    const start = index * CELL_FIELDS;
    values[start + F.ENERGY] = index + 1;
    values[start + F.DENSITY] = 10 + index;
    values[start + F.TEMPERATURE] = 280 + index;
    values[start + F.MATERIAL_ID] = index < 4 ? 3 : 5;
    values[start + F.AGENT_MARK] = 0;
    values[start + F.ENTITY_ID] = 0;
  }
  const completeCoverage = {
    width: 2, height: 2, depth: 2, revision: 17,
    complete: true, incompleteCellCount: 0,
    cells: [{
      chunkKey: "1:0,0,0", cellIndex: 7, level: 1,
      expectedBaseSamples: 8, observedBaseSamples: 8,
      denseIndices: [7, 6, 5, 4, 3, 2, 1, 0], complete: true,
    }],
  };
  const staged = stageDenseWindowPhysicalReductions(values, completeCoverage, completeCoverage.revision);
  if (staged.length !== 1 || staged[0].chunkKey !== "1:0,0,0" ||
      staged[0].cellIndex !== 7 || staged[0].level !== 1 ||
      staged[0].values[F.ENERGY] !== 36 ||
      staged[0].values[F.DENSITY] !== 13.5 ||
      staged[0].values[F.TEMPERATURE] !== 283.5 ||
      staged[0].values[F.MATERIAL_ID] !== 3 ||
      staged[0].denseIndices.join(",") !== "0,1,2,3,4,5,6,7" ||
      !Object.isFrozen(staged) || !Object.isFrozen(staged[0]) ||
      !Object.isFrozen(staged[0].values) || !Object.isFrozen(staged[0].denseIndices)) {
    throw new Error("Coverage-gated dense-window reduction did not stage the expected full-cell field result");
  }

  const emptyCoverage = {
    width: 2, height: 2, depth: 2, revision: 19,
    complete: true, incompleteCellCount: 0, cells: [],
  };
  if (stageDenseWindowPhysicalReductions(values, emptyCoverage, 19).length !== 0) {
    throw new Error("Coverage-gated dense-window reduction invented targets for an empty physical intersection");
  }

  const levelZeroCoverage = {
    width: 2, height: 2, depth: 2, revision: 18,
    complete: true, incompleteCellCount: 0,
    cells: [{
      chunkKey: "0:0,0,0", cellIndex: 0, level: 0,
      expectedBaseSamples: 1, observedBaseSamples: 1,
      denseIndices: [3], complete: true,
    }],
  };
  const levelZero = stageDenseWindowPhysicalReductions(values, levelZeroCoverage, 18);
  if (levelZero.length !== 1 || levelZero[0].values[F.ENERGY] !== 4 ||
      levelZero[0].values[F.DENSITY] !== 13) {
    throw new Error("Coverage-gated dense-window reduction failed exact level-zero copy");
  }

  rejected("stale physical coverage revision", () =>
    stageDenseWindowPhysicalReductions(values, completeCoverage, completeCoverage.revision + 1),
  "coverage revision is stale");

  const partialCoverage = {
    ...completeCoverage, complete: false, incompleteCellCount: 1,
    cells: [{ ...completeCoverage.cells[0], observedBaseSamples: 1, denseIndices: [0], complete: false }],
  };
  rejected("partial coarse-cell coverage", () =>
    stageDenseWindowPhysicalReductions(values, partialCoverage, partialCoverage.revision),
  "incomplete physical-cell coverage");

  const wrongCountCoverage = {
    ...completeCoverage,
    cells: [{ ...completeCoverage.cells[0], expectedBaseSamples: 7 }],
  };
  rejected("incorrect expected sample count", () =>
    stageDenseWindowPhysicalReductions(values, wrongCountCoverage, wrongCountCoverage.revision),
  "does not match LOD geometry");

  const duplicateIdentityCoverage = {
    ...completeCoverage,
    cells: [
      completeCoverage.cells[0],
      { ...completeCoverage.cells[0], chunkKey: "1:1,0,0", cellIndex: 0 },
    ],
  };
  rejected("duplicate physical-cell identity", () =>
    stageDenseWindowPhysicalReductions(values, duplicateIdentityCoverage, duplicateIdentityCoverage.revision),
  "duplicate physical-cell identity");

  const duplicateSampleCoverage = {
    ...completeCoverage,
    cells: [
      completeCoverage.cells[0],
      {
        chunkKey: "1:1,0,0", cellIndex: 0, level: 1,
        expectedBaseSamples: 8, observedBaseSamples: 8,
        denseIndices: [0, 1, 2, 3, 4, 5, 6, 7], complete: true,
      },
    ],
  };
  rejected("same dense sample assigned to distinct physical cells", () =>
    stageDenseWindowPhysicalReductions(values, duplicateSampleCoverage, duplicateSampleCoverage.revision),
  "multiply-owned dense sample");

  const mixedIdentity = new Float32Array(values);
  mixedIdentity[F.ENTITY_ID] = 41;
  mixedIdentity[7 * CELL_FIELDS + F.ENTITY_ID] = 99;
  rejected("mixed entity identities", () =>
    stageDenseWindowPhysicalReductions(mixedIdentity, completeCoverage, completeCoverage.revision),
  "mixed identity/occupancy");

  const invalidNumeric = new Float32Array(values);
  invalidNumeric[F.ENERGY] = Number.NaN;
  rejected("non-finite dense field", () =>
    stageDenseWindowPhysicalReductions(invalidNumeric, completeCoverage, completeCoverage.revision),
  "finite and Float32-representable");

  rejected("dense vector dimension mismatch", () =>
    stageDenseWindowPhysicalReductions(new Float32Array(7 * CELL_FIELDS), completeCoverage, completeCoverage.revision),
  "dimensions do not match");

  console.log("Infinity Scale coverage-gated dense-window physical reduction staging, full/partial coverage, stale revision, exact copy, identity validation, and detached result regressions: PASS");
}
