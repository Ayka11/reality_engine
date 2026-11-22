import { CELL_FIELDS } from "./CellState";
import { CHUNK_SIZE } from "./Chunk";
import {
  compileSparseVoxelGridPhysicalTopology,
  formatSparseVoxelGridPhysicalChunkKey,
  parseSparseVoxelGridPhysicalChunkKey,
  resolveSparseVoxelGridPhysicalCell,
  resolveSparseVoxelGridPhysicalChunk,
} from "./SparseVoxelGridPhysicalTopology";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  if (!rejected) throw new Error("Sparse physical topology accepted " + label);
}

export function runSparseVoxelGridPhysicalTopologyRegression(): void {
  const topology = compileSparseVoxelGridPhysicalTopology([
    "2:0,0,0",
    "4,0,0",
    "1:-1,0,0",
    "-3,0,0",
  ]);

  if (topology.chunks.length !== 4 || !Object.isFrozen(topology) ||
      !Object.isFrozen(topology.chunks) ||
      topology.chunks.some(chunk => !Object.isFrozen(chunk))) {
    throw new Error("Sparse physical topology did not publish a detached immutable descriptor set");
  }

  const expected = [
    { point: [127, 127, 127], key: "2:0,0,0", level: 2 },
    { point: [128, 1, 1], key: "4,0,0", level: 0 },
    { point: [-1, 63, 63], key: "1:-1,0,0", level: 1 },
    { point: [-65, 1, 1], key: "-3,0,0", level: 0 },
  ] as const;
  for (const candidate of expected) {
    const resolved = resolveSparseVoxelGridPhysicalChunk(
      topology,
      candidate.point[0],
      candidate.point[1],
      candidate.point[2],
    );
    if (!resolved || resolved.key !== candidate.key || resolved.level !== candidate.level ||
        resolved.scale !== 2 ** candidate.level) {
      throw new Error(
        "Sparse physical topology resolved " + candidate.point.join(",") +
        " to " + String(resolved?.key) + " instead of " + candidate.key,
      );
    }
  }

  // Resolve base-cell coordinates to the stored cell at that chunk's LOD.
  // The same base-space footprint maps to different local cell indices by scale.
  const cellAddressCases = [
    { point: [127, 127, 127] as const, key: "2:0,0,0", local: [31, 31, 31] as const },
    { point: [128, 1, 1] as const, key: "4,0,0", local: [0, 1, 1] as const },
    { point: [-1, 63, 63] as const, key: "1:-1,0,0", local: [31, 31, 31] as const },
    { point: [-65, 1, 1] as const, key: "-3,0,0", local: [31, 1, 1] as const },
  ] as const;
  for (const candidate of cellAddressCases) {
    const address = resolveSparseVoxelGridPhysicalCell(
      topology,
      candidate.point[0],
      candidate.point[1],
      candidate.point[2],
    );
    const [localX, localY, localZ] = candidate.local;
    const expectedCellIndex = (localZ * CHUNK_SIZE + localY) * CHUNK_SIZE + localX;
    if (!address ||
        address.chunk.key !== candidate.key ||
        address.localX !== localX ||
        address.localY !== localY ||
        address.localZ !== localZ ||
        address.cellIndex !== expectedCellIndex ||
        address.bufferOffset !== expectedCellIndex * CELL_FIELDS ||
        address.bufferOffset + CELL_FIELDS > CHUNK_SIZE ** 3 * CELL_FIELDS ||
        !Object.isFrozen(address) ||
        !Object.isFrozen(address.chunk)) {
      throw new Error(
        "Sparse physical cell addressing returned an inconsistent local cell for " +
        candidate.point.join(","),
      );
    }
  }

  // Half-open upper bounds must place adjacent cells into the next chunk.
  const leftOfBoundary = resolveSparseVoxelGridPhysicalCell(topology, 127, 0, 0);
  const atBoundary = resolveSparseVoxelGridPhysicalCell(topology, 128, 0, 0);
  if (leftOfBoundary?.chunk.key !== "2:0,0,0" ||
      atBoundary?.chunk.key !== "4,0,0") {
    throw new Error("Sparse physical cell addressing violated half-open adjacent-LOD chunk bounds");
  }
  if (resolveSparseVoxelGridPhysicalCell(topology, 160, 0, 0) !== null) {
    throw new Error("Sparse physical cell addressing resolved a base cell outside the topology");
  }
  expectRejected("non-integer physical cell coordinates", () =>
    resolveSparseVoxelGridPhysicalCell(topology, 0.5, 0, 0));

  if (resolveSparseVoxelGridPhysicalChunk(topology, 160, 0, 0) !== null) {
    throw new Error("Sparse physical topology resolved a base cell outside all registered chunks");
  }

  const parsedLegacy = parseSparseVoxelGridPhysicalChunkKey("-3,2,1");
  const parsedCoarse = parseSparseVoxelGridPhysicalChunkKey("3:-2,1,0");
  if (parsedLegacy.level !== 0 || parsedLegacy.scale !== 1 ||
      parsedCoarse.level !== 3 || parsedCoarse.scale !== 8 ||
      formatSparseVoxelGridPhysicalChunkKey(parsedCoarse.level, parsedCoarse.cx, parsedCoarse.cy, parsedCoarse.cz) !== parsedCoarse.key) {
    throw new Error("Sparse physical chunk identity did not preserve canonical level/scale/key invariants");
  }
  expectRejected("level/scale identity outside the supported range", () =>
    formatSparseVoxelGridPhysicalChunkKey(31, 0, 0, 0));

  expectRejected("duplicate level-zero keys", () =>
    compileSparseVoxelGridPhysicalTopology(["-1,0,0", "-1,0,0"]));
  expectRejected("a fine chunk inside a coarse ancestor", () =>
    compileSparseVoxelGridPhysicalTopology(["1:0,0,0", "0:0,0,0"]));
  expectRejected("a negative-coordinate child inside its coarse ancestor", () =>
    compileSparseVoxelGridPhysicalTopology(["1:-1,0,0", "0:-1,0,0"]));
  expectRejected("a non-canonical legacy key", () =>
    compileSparseVoxelGridPhysicalTopology(["00,0,0"]));
  expectRejected("a level-zero prefixed key that would collide with legacy form", () =>
    compileSparseVoxelGridPhysicalTopology(["0:0,0,0"]));
  expectRejected("unsafe physical bounds", () =>
    compileSparseVoxelGridPhysicalTopology(["30:9007199254740991,0,0"]));
  expectRejected("a chunk count above the configured cap", () =>
    compileSparseVoxelGridPhysicalTopology(["0,0,0", "1,0,0"], 1));
  expectRejected("a caller-created topology object", () =>
    resolveSparseVoxelGridPhysicalChunk({ chunks: [] }, 0, 0, 0));

  console.log("SparseVoxelGrid mixed-LOD physical topology preflight and coordinate lookup: PASS");
}
