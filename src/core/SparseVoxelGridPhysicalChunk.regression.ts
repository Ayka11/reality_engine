import { CELL_FIELDS, F } from "./CellState";
import { CHUNK_SIZE } from "./Chunk";
import { SparseVoxelGrid } from "./SparseVoxelGrid";
import { SparseVoxelGridPhysicalChunk } from "./SparseVoxelGridPhysicalChunk";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  if (!rejected) throw new Error("Sparse physical chunk accepted " + label);
}

export function runSparseVoxelGridPhysicalChunkRegression(): void {
  const coarse = new SparseVoxelGridPhysicalChunk("2:-1,0,0");
  if (coarse.key !== "2:-1,0,0" || coarse.level !== 2 || coarse.scale !== 4 ||
      coarse.cx !== -1 || coarse.cy !== 0 || coarse.cz !== 0 ||
      coarse.extent !== CHUNK_SIZE * 4 ||
      coarse.minX !== -128 || coarse.maxXExclusive !== 0 ||
      coarse.minY !== 0 || coarse.maxYExclusive !== 128 ||
      coarse.minZ !== 0 || coarse.maxZExclusive !== 128) {
    throw new Error("Sparse physical chunk did not preserve its complete LOD identity and base-space bounds");
  }

  const lastCell = coarse.resolveBaseCell(-1, 127, 127);
  if (!lastCell || lastCell.localX !== 31 || lastCell.localY !== 31 ||
      lastCell.localZ !== 31 ||
      lastCell.cellIndex !== CHUNK_SIZE ** 3 - 1 ||
      lastCell.bufferOffset !== (CHUNK_SIZE ** 3 - 1) * CELL_FIELDS ||
      !Object.isFrozen(lastCell)) {
    throw new Error("Sparse physical chunk resolved an incorrect final coarse cell");
  }

  const sameStoredCell = coarse.resolveBaseCell(-4, 124, 124);
  if (!sameStoredCell || sameStoredCell.bufferOffset !== lastCell.bufferOffset) {
    throw new Error("Base-space coordinates inside one coarse cell did not resolve to the same stored cell");
  }

  if (coarse.resolveBaseCell(0, 127, 127) !== null ||
      coarse.resolveBaseCell(-129, 0, 0) !== null ||
      coarse.getCellAtBase(0, 0, 0) !== null) {
    throw new Error("Sparse physical chunk violated its half-open physical bounds");
  }
  expectRejected("non-integer base-cell coordinates", () => coarse.resolveBaseCell(-0.5, 0, 0));

  let mutationCount = 0;
  coarse.addMutationListener(() => { mutationCount += 1; });
  const cell = coarse.getCellAtBase(-1, 127, 127);
  if (!cell) throw new Error("Sparse physical chunk did not return a cell inside its bounds");
  cell.set(F.ENERGY, 12.5);
  if (coarse.buffer[lastCell.bufferOffset + F.ENERGY] !== 12.5 || mutationCount === 0) {
    throw new Error("Sparse physical chunk cell writes bypassed its tracked front buffer or mutation listener");
  }

  coarse.backBuffer[lastCell.bufferOffset + F.ENERGY] = 7.25;
  if (coarse.buffer[lastCell.bufferOffset + F.ENERGY] !== 12.5 ||
      coarse.backBuffer[lastCell.bufferOffset + F.ENERGY] !== 7.25) {
    throw new Error("Sparse physical chunk front/back buffers are not independent");
  }
  coarse.swapBuffers();
  if (coarse.buffer[lastCell.bufferOffset + F.ENERGY] !== 7.25 ||
      coarse.backBuffer[lastCell.bufferOffset + F.ENERGY] !== 12.5 ||
      mutationCount < 3) {
    throw new Error("Sparse physical chunk buffer swap did not preserve tracked mutation semantics");
  }

  const legacy = new SparseVoxelGridPhysicalChunk("-3,0,0");
  const legacyAddress = legacy.resolveBaseCell(-65, 4, 5);
  if (legacy.level !== 0 || legacy.scale !== 1 ||
      legacy.key !== "-3,0,0" ||
      legacyAddress?.localX !== 31 ||
      legacyAddress.localY !== 4 ||
      legacyAddress.localZ !== 5) {
    throw new Error("Level-zero physical chunk compatibility changed");
  }

  for (const property of ["key", "level", "scale", "cx", "cy", "cz", "minX", "maxXExclusive"]) {
    const descriptor = Object.getOwnPropertyDescriptor(coarse, property);
    if (!descriptor || descriptor.writable !== false || descriptor.configurable !== false) {
      throw new Error("Sparse physical chunk identity is mutable: " + property);
    }
  }

  expectRejected("a non-canonical physical key", () => new SparseVoxelGridPhysicalChunk("02:-1,0,0"));
  expectRejected("unsafe physical bounds", () => new SparseVoxelGridPhysicalChunk("30:9007199254740991,0,0"));

  // The runtime record must remain fail-closed until SparseVoxelGrid's
  // authoritative map, dense-window and persistence paths are LOD-aware.
  const legacyGrid = new SparseVoxelGrid(1, 1, 1);
  // The stricter identity guard must still accept an explicitly identified
  // level-zero physical record with the canonical legacy key.
  legacyGrid.chunks.set(legacy.key, legacy);
  if (legacyGrid.chunks.get(legacy.key) !== legacy) {
    throw new Error("Level-zero physical chunk was rejected by the legacy production map");
  }
  expectRejected("a non-zero-LOD chunk in the level-zero production map", () => {
    legacyGrid.chunks.set(coarse.key, coarse);
  });
  // Coarse chunks share integer chunk coordinates with the legacy map key.
  // The map must inspect physical identity, not just the coordinate string.
  expectRejected("a coarse chunk smuggled through its legacy coordinate key", () => {
    legacyGrid.chunks.set("-1,0,0", coarse);
  });
  if (legacyGrid.chunks.has("-1,0,0")) {
    throw new Error("Rejected coarse chunk leaked into the authoritative level-zero map");
  }
  expectRejected("a non-zero-LOD dirty key in the level-zero production metadata", () => {
    legacyGrid.dirtyChunks.add(coarse.key);
  });
  expectRejected("a non-zero-LOD owner key in the level-zero production metadata", () => {
    legacyGrid.chunkOwners.set(coarse.key, "coarse-owner");
  });

  console.log("SparseVoxelGrid level-aware physical chunk identity, addressing, buffers, mutation tracking and level-zero production fail-closed guards: PASS");
}
