import { F } from "./CellState";
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

  console.log("SparseVoxelGrid physical address adapter mixed-LOD resolution, boundary, detached ownership and tracked-write regressions: PASS");
}
