import { CELL_FIELDS, F } from "./CellState";
import { SparseVoxelGridPhysicalAddressAdapter } from "./SparseVoxelGridPhysicalAddressAdapter";
import { SparseVoxelGridPhysicalChunk } from "./SparseVoxelGridPhysicalChunk";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  if (!rejected) throw new Error("Physical address adapter accepted " + label);
}

export function runSparseVoxelGridPhysicalAddressAdapterRegression(): void {
  const coarse = new SparseVoxelGridPhysicalChunk("1:0,0,0");
  const fine = new SparseVoxelGridPhysicalChunk("2,0,0");
  coarse.getCell(1, 2, 3).set(F.ENERGY, 31);
  fine.getCell(0, 0, 0).set(F.ENERGY, 9);
  // Every chunk participates in publication, so prepare its complete next state.
  fine.getBackCell(0, 0, 0).set(F.ENERGY, 9);

  const adapter = new SparseVoxelGridPhysicalAddressAdapter([coarse, fine]);
  if (adapter.size !== 2 || adapter.topology.chunks.length !== 2) {
    throw new Error("Physical address adapter did not retain its validated topology");
  }

  // LOD 1 cells cover 2^3 base cells: (2,4,6) maps to local (1,2,3).
  const coarseAddress = adapter.resolve(2, 4, 6);
  if (!coarseAddress || coarseAddress.chunk.key !== coarse.key ||
      coarseAddress.localX !== 1 || coarseAddress.localY !== 2 ||
      coarseAddress.localZ !== 3 || coarseAddress.bufferOffset !== coarse.localIdx(1, 2, 3)) {
    throw new Error("Physical address adapter resolved an incorrect coarse-cell address");
  }
  const coarseCell = adapter.getCellAtBase(3, 5, 7);
  if (!coarseCell || coarseCell.get(F.ENERGY) !== 31) {
    throw new Error("Physical address adapter failed to read a coarse stored cell");
  }
  coarseCell.set(F.ENERGY, 44);
  if (adapter.getCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 44) {
    throw new Error("Physical address adapter did not preserve tracked writes to a coarse cell");
  }

  // Back-buffer preparation is isolated until an explicit buffer swap.
  const preparedCoarseCell = adapter.getBackCellAtBase(3, 5, 7);
  if (!preparedCoarseCell || preparedCoarseCell.get(F.ENERGY) !== 0) {
    throw new Error("Physical address adapter did not expose the independent coarse back buffer");
  }
  // Give every slot a distinct value so the projection proves the complete
  // 24-field cell layout is copied, not only the commonly inspected fields.
  for (let field = 0; field < CELL_FIELDS; field++) {
    preparedCoarseCell.set(field, 2000 + field);
  }
  preparedCoarseCell.set(F.ENERGY, 72);
  if (adapter.getCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 44 ||
      adapter.getBackCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 72) {
    throw new Error("Physical back-buffer write leaked into or failed to update the front buffer");
  }
  if (adapter.getBackCell(fine.key, 0, 0, 0)?.get(F.ENERGY) !== 9) {
    throw new Error("Physical chunk-key back-buffer access returned the wrong cell");
  }
  const preparedRevision = adapter.revision;
  if (adapter.swapBuffers(preparedRevision) !== preparedRevision + 2 ||
      adapter.getCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 72 ||
      adapter.getBackCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 44) {
    throw new Error("Physical address adapter did not atomically promote prepared buffers");
  }
  expectRejected("a stale buffer publication revision", () => adapter.swapBuffers(preparedRevision));
  if (adapter.getCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 72) {
    throw new Error("Rejected stale buffer publication changed the visible front buffer");
  }

  // The adjacent level-zero chunk begins exactly at the coarse chunk's exclusive bound.
  const fineAddress = adapter.resolve(64, 0, 0);
  if (!fineAddress || fineAddress.chunk.key !== fine.key ||
      fineAddress.localX !== 0 || fineAddress.localY !== 0 || fineAddress.localZ !== 0 ||
      adapter.getCellAtBase(64, 0, 0)?.get(F.ENERGY) !== 9) {
    throw new Error("Physical address adapter failed at a mixed-LOD boundary");
  }
  if (adapter.resolve(96, 0, 0) !== null || adapter.getCellAtBase(96, 0, 0) !== null) {
    throw new Error("Physical address adapter resolved a coordinate outside its topology");
  }

  // Dense-window-local coordinates are translated through the window origin,
  // then resolved using physical topology rather than level-zero chunk math.
  const coarseWindow = { width: 2, height: 2, depth: 2, origin: { x: 2, y: 4, z: 6 } };
  const denseOrigin = adapter.resolveDenseWindowCell(0, 0, 0, coarseWindow);
  const denseFarCorner = adapter.resolveDenseWindowCell(1, 1, 1, coarseWindow);
  if (!denseOrigin || !denseFarCorner ||
      denseOrigin.denseIndex !== 0 || denseFarCorner.denseIndex !== 7 ||
      denseOrigin.baseX !== 2 || denseOrigin.baseY !== 4 || denseOrigin.baseZ !== 6 ||
      denseFarCorner.baseX !== 3 || denseFarCorner.baseY !== 5 || denseFarCorner.baseZ !== 7 ||
      denseOrigin.physical.chunk.key !== coarse.key ||
      denseFarCorner.physical.chunk.key !== coarse.key ||
      denseOrigin.physical.cellIndex !== denseFarCorner.physical.cellIndex ||
      !Object.isFrozen(denseOrigin) || !Object.isFrozen(denseOrigin.physical)) {
    throw new Error("Physical dense-window bridge failed to map coarse-cell aliases through the global origin");
  }
  const coarseProjection = adapter.projectDenseWindow(coarseWindow);
  if (coarseProjection.values.length !== 8 * CELL_FIELDS ||
      coarseProjection.revision !== adapter.revision ||
      coarseProjection.coarseCellAliases.length !== 1 ||
      coarseProjection.coarseCellAliases[0].chunkKey !== coarse.key ||
      coarseProjection.coarseCellAliases[0].cellIndex !== denseOrigin.physical.cellIndex ||
      coarseProjection.coarseCellAliases[0].level !== 1 ||
      coarseProjection.coarseCellAliases[0].denseIndices.join(",") !== "0,1,2,3,4,5,6,7" ||
      !Object.isFrozen(coarseProjection) ||
      !Object.isFrozen(coarseProjection.coarseCellAliases) ||
      !Object.isFrozen(coarseProjection.coarseCellAliases[0].denseIndices)) {
    throw new Error("Physical dense-window projection failed to expose detached values and coarse-cell alias groups");
  }
  for (let denseIndex = 0; denseIndex < 8; denseIndex++) {
    for (let field = 0; field < CELL_FIELDS; field++) {
      const expected = field === F.ENERGY ? 72 : 2000 + field;
      if (coarseProjection.values[denseIndex * CELL_FIELDS + field] !== expected) {
        throw new Error(
          "Physical dense-window projection failed to copy field " + field +
          " for coarse alias sample " + denseIndex,
        );
      }
    }
  }
  const fullCoarseCoverage = adapter.analyzeDenseWindowCoverage(coarseWindow);
  if (!fullCoarseCoverage.complete || fullCoarseCoverage.incompleteCellCount !== 0 ||
      fullCoarseCoverage.cells.length !== 1 ||
      fullCoarseCoverage.cells[0].expectedBaseSamples !== 8 ||
      fullCoarseCoverage.cells[0].observedBaseSamples !== 8 ||
      !fullCoarseCoverage.cells[0].complete ||
      fullCoarseCoverage.cells[0].denseIndices.join(",") !== "0,1,2,3,4,5,6,7" ||
      !Object.isFrozen(fullCoarseCoverage) ||
      !Object.isFrozen(fullCoarseCoverage.cells[0].denseIndices)) {
    throw new Error("Physical dense-window coverage did not recognize complete coarse-cell coverage");
  }
  const partialCoarseCoverage = adapter.analyzeDenseWindowCoverage({
    width: 1, height: 1, depth: 1, origin: { x: 2, y: 4, z: 6 },
  });
  if (partialCoarseCoverage.complete || partialCoarseCoverage.incompleteCellCount !== 1 ||
      partialCoarseCoverage.cells.length !== 1 ||
      partialCoarseCoverage.cells[0].expectedBaseSamples !== 8 ||
      partialCoarseCoverage.cells[0].observedBaseSamples !== 1 ||
      partialCoarseCoverage.cells[0].complete) {
    throw new Error("Physical dense-window coverage treated a partial coarse-cell intersection as complete");
  }
  const fineCoverage = adapter.analyzeDenseWindowCoverage(boundaryWindow);
  if (!fineCoverage.complete || fineCoverage.cells.length !== 1 ||
      fineCoverage.cells[0].level !== 0 ||
      fineCoverage.cells[0].expectedBaseSamples !== 1 ||
      fineCoverage.cells[0].observedBaseSamples !== 1) {
    throw new Error("Physical dense-window coverage did not recognize one-to-one level-zero coverage");
  }
  const missingCoverage = adapter.analyzeDenseWindowCoverage({
    width: 1, height: 1, depth: 1, origin: { x: 96, y: 0, z: 0 },
  });
  if (!missingCoverage.complete || missingCoverage.cells.length !== 0 ||
      missingCoverage.incompleteCellCount !== 0) {
    throw new Error("Physical dense-window coverage incorrectly created reduction targets for missing topology");
  }
  expectRejected("unsafe LOD coverage sample geometry", () =>
    adapter.analyzeDenseWindowCoverage({
      width: 1, height: 1, depth: 1, origin: { x: Number.MAX_SAFE_INTEGER, y: 0, z: 0 },
    }));

  coarseProjection.values[F.ENERGY] = -123;
  if (adapter.getCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 72) {
    throw new Error("Mutating a detached dense-window projection changed physical storage");
  }

  const boundaryWindow = { width: 1, height: 1, depth: 1, origin: { x: 64, y: 0, z: 0 } };
  const denseBoundary = adapter.resolveDenseWindowCell(0, 0, 0, boundaryWindow);
  if (!denseBoundary || denseBoundary.physical.chunk.key !== fine.key ||
      denseBoundary.physical.localX !== 0) {
    throw new Error("Physical dense-window bridge failed at a mixed-LOD chunk boundary");
  }
  const fineProjection = adapter.projectDenseWindow(boundaryWindow);
  if (fineProjection.values[F.ENERGY] !== 9 || fineProjection.coarseCellAliases.length !== 0) {
    throw new Error("Physical dense-window projection failed to read a level-zero boundary cell");
  }
  const missingProjection = adapter.projectDenseWindow({
    width: 1, height: 1, depth: 1, origin: { x: 96, y: 0, z: 0 },
  });
  if (missingProjection.values.some(value => value !== 0) ||
      missingProjection.coarseCellAliases.length !== 0) {
    throw new Error("Physical dense-window projection did not zero-fill missing topology");
  }
  if (adapter.resolveDenseWindowCell(0, 0, 0, {
    width: 1, height: 1, depth: 1, origin: { x: 96, y: 0, z: 0 },
  }) !== null) {
    throw new Error("Physical dense-window bridge resolved a sample outside physical topology");
  }
  expectRejected("dense-window local coordinates outside dimensions", () =>
    adapter.resolveDenseWindowCell(2, 0, 0, coarseWindow));
  expectRejected("fractional dense-window origin", () =>
    adapter.resolveDenseWindowCell(0, 0, 0, {
      width: 1, height: 1, depth: 1, origin: { x: 0.5, y: 0, z: 0 },
    }));
  expectRejected("unsafe dense-window global coordinate", () =>
    adapter.resolveDenseWindowCell(1, 0, 0, {
      width: 2, height: 1, depth: 1, origin: { x: Number.MAX_SAFE_INTEGER, y: 0, z: 0 },
    }));

  // Adapter ownership is detached from the caller's chunk objects.
  coarse.getCell(1, 2, 3).set(F.ENERGY, 100);
  coarse.getBackCell(1, 2, 3).set(F.ENERGY, 101);
  if (adapter.getCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 72 ||
      adapter.getBackCellAtBase(2, 4, 6)?.get(F.ENERGY) !== 44) {
    throw new Error("Caller-owned front/back chunk mutation leaked into the address adapter");
  }

  expectRejected("overlapping coarse/fine topology", () =>
    new SparseVoxelGridPhysicalAddressAdapter([
      new SparseVoxelGridPhysicalChunk("1:0,0,0"),
      new SparseVoxelGridPhysicalChunk("0,0,0"),
    ]));
  expectRejected("duplicate keys", () =>
    new SparseVoxelGridPhysicalAddressAdapter([fine, fine]));
  expectRejected("non-physical chunks", () =>
    new SparseVoxelGridPhysicalAddressAdapter([{} as SparseVoxelGridPhysicalChunk]));
  expectRejected("out-of-range local coordinates", () =>
    adapter.getCell(fine.key, 32, 0, 0));
  expectRejected("out-of-range back-buffer coordinates", () =>
    adapter.getBackCell(fine.key, 0, -1, 0));

  console.log("SparseVoxelGrid physical address adapter mixed-LOD resolution, dense-window addressing/projection, alias detection, boundary, detached ownership and tracked-write regressions: PASS");
}
