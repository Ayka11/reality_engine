import { InfinityScaleLODState } from "./InfinityScaleLODState";
import { InfinityScaleLODBoundaryCellMapper } from "./InfinityScaleLODBoundaryCellMapper";
import type { InfinityScaleBoundaryTransferSpec } from "./InfinityScaleChunkExecutionContext";
import { CELL_FIELDS } from "../core/CellState";

function spec(
  sourceChunk: string,
  targetChunk: string,
  sourceLevel: number,
  targetLevel: number,
  relation: "coarse-to-fine" | "fine-to-coarse",
): InfinityScaleBoundaryTransferSpec {
  return {
    sourceChunk,
    targetChunk,
    sourceLevel,
    targetLevel,
    refinementRatio: 2 ** Math.abs(sourceLevel - targetLevel),
    relation,
    operation: relation === "coarse-to-fine" ? "prolongation" : "restriction",
    readOperation: relation === "coarse-to-fine" ? "restriction" : "prolongation",
  };
}

export function runInfinityScaleLODBoundaryCellMapperRegression(): void {
  const state = new InfinityScaleLODState(4);
  const mapper = new InfinityScaleLODBoundaryCellMapper(state, 4);

  const cases: Array<{
    name: string;
    transfer: InfinityScaleBoundaryTransferSpec;
    expectedTargetCount: number;
    expectedSourceCount: number;
  }> = [
    {
      name: "fine-to-coarse-x+",
      transfer: spec("0:4,0,0", "1:0,0,0", 0, 1, "fine-to-coarse"),
      expectedTargetCount: 4,
      expectedSourceCount: 4,
    },
    {
      name: "coarse-to-fine-x+",
      transfer: spec("1:0,0,0", "0:4,0,0", 1, 0, "coarse-to-fine"),
      expectedTargetCount: 16,
      expectedSourceCount: 1,
    },
    {
      name: "fine-to-coarse-y-",
      transfer: spec("0:0,0,0", "1:0,0,1", 0, 1, "fine-to-coarse"),
      expectedTargetCount: 4,
      expectedSourceCount: 4,
    },
    {
      name: "fine-to-coarse-z+",
      transfer: spec("0:0,0,4", "1:0,0,0", 0, 1, "fine-to-coarse"),
      expectedTargetCount: 4,
      expectedSourceCount: 4,
    },
  ];

  for (const test of cases) {
    state.ensureChunk(test.transfer.sourceChunk, test.transfer.sourceLevel);
    state.ensureChunk(test.transfer.targetChunk, test.transfer.targetLevel);

    const cells = mapper.enumerateTargetFaceCells(test.transfer, 8, 8, 8);
    if (cells.length !== test.expectedTargetCount) {
      throw new Error(
        `${test.name}: expected ${test.expectedTargetCount} target cells, got ${cells.length}`,
      );
    }

    const uniqueTargets = new Set(cells.map(cell => cell.join(",")));
    if (uniqueTargets.size !== cells.length) {
      throw new Error(`${test.name}: duplicate target cells`);
    }

    for (const targetCell of cells) {
      const mapping = mapper.map(test.transfer, targetCell);
      if (mapping.sourceCells.length !== test.expectedSourceCount) {
        throw new Error(
          `${test.name}: expected ${test.expectedSourceCount} source cells, got ${mapping.sourceCells.length}`,
        );
      }
      if (mapping.targetCell.join(",") !== targetCell.join(",")) {
        throw new Error(`${test.name}: target cell identity changed`);
      }
    }
  }

  // Face adjacency must require tangential overlap; touching only at a
  // corner is not a valid boundary interface.
  {
    const diagonal = spec("0:4,4,0", "1:0,0,0", 0, 1, "fine-to-coarse");
    state.ensureChunk(diagonal.sourceChunk, 0);
    state.ensureChunk(diagonal.targetChunk, 1);
    const diagonalTarget = mapper.enumerateTargetFaceCells(diagonal, 16, 16, 16);
    if (diagonalTarget.length !== 0) {
      throw new Error("corner-only chunks incorrectly produced a mixed-LOD face");
    }
    try {
      mapper.map(diagonal, [3, 3, 1]);
      throw new Error("corner-only chunks were accepted as adjacent");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("adjacent chunks")) {
        throw error;
      }
    }
  }

  // Ratio-4 fine-to-coarse: one coarse face target must consume a 4x4
  // tangential fine footprint.
  const ratio4 = spec("0:8,0,0", "2:0,0,0", 0, 2, "fine-to-coarse");
  state.ensureChunk(ratio4.sourceChunk, 0);
  state.ensureChunk(ratio4.targetChunk, 2);
  const ratio4Targets = mapper.enumerateTargetFaceCells(ratio4, 16, 16, 16);
  if (ratio4Targets.length !== 16) {
    throw new Error(`ratio-4: expected 16 target cells, got ${ratio4Targets.length}`);
  }
  const ratio4Mapping = mapper.map(ratio4, ratio4Targets[0]);
  if (ratio4Mapping.sourceCells.length !== 16) {
    throw new Error(`ratio-4: expected 16 source face cells, got ${ratio4Mapping.sourceCells.length}`);
  }

  // Canonical alignment: coarse source cells must land on scale-aligned
  // origins, while fine source face coordinates remain exact fine cells.
  {
    const coarseToFine = spec("1:0,0,0", "0:8,0,0", 1, 0, "coarse-to-fine");
    state.ensureChunk(coarseToFine.sourceChunk, 1);
    state.ensureChunk(coarseToFine.targetChunk, 0);
    const coarseMapping = mapper.map(coarseToFine, [8, 3, 3]);
    if (coarseMapping.sourceCells[0].join(",") !== "6,2,2") {
      throw new Error(
        `coarse-to-fine alignment mismatch: ${coarseMapping.sourceCells[0].join(",")}`,
      );
    }

    const fineToCoarse = spec("0:4,0,0", "1:0,0,0", 0, 1, "fine-to-coarse");
    const fineMapping = mapper.map(fineToCoarse, [6, 2, 2]);
    if (fineMapping.sourceCells[0][0] !== 4) {
      throw new Error(
        `fine-to-coarse face alignment mismatch: ${fineMapping.sourceCells[0].join(",")}`,
      );
    }
  }

  // Negative-coordinate boundary must remain geometrically valid.
  const negative = spec("0:-4,0,0", "1:-1,0,0", 0, 1, "fine-to-coarse");
  state.ensureChunk(negative.sourceChunk, 0);
  state.ensureChunk(negative.targetChunk, 1);
  const negativeTargets = mapper.enumerateTargetFaceCells(negative, 0, 8, 8);
  if (negativeTargets.length !== 0) {
    throw new Error("negative boundary incorrectly emitted cells outside the grid");
  }

  // Field-state access remains independent from geometry.
  const value = new Float32Array(CELL_FIELDS);
  state.writeBaseCell("0:4,0,0", 0, 4, 0, 0, value);
  const resolved = mapper.resolveValues(
    cases[0].transfer,
    [3, 0, 0],
  );
  if (resolved.length !== 4) {
    throw new Error("resolveValues returned an incomplete fine-face footprint");
  }
}
