import { CELL_FIELDS } from "./CellState";
import { Chunk, CHUNK_SIZE } from "./Chunk";
import { SparseVoxelGrid } from "./SparseVoxelGrid";
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

  // SparseVoxelGrid exposes one canonical immutable index derived from its
  // authoritative map. Repeated reads reuse the snapshot; cell writes do not
  // invalidate topology, while structural map changes do.
  const grid = new SparseVoxelGrid(1, 1, 1);
  const guardedTopology = grid.physicalTopology;
  const guardedRevision = grid.mutationRevision;
  const chunksPrototype = Object.getPrototypeOf(grid.chunks);
  const ownersPrototype = Object.getPrototypeOf(grid.chunkOwners);
  const dirtyPrototype = Object.getPrototypeOf(grid.dirtyChunks);

  // Replacing a tracked collection's prototype would expose native mutators
  // and bypass validation/revision hooks. Both throwing and reflective APIs
  // must reject the attempt without changing any collection.
  expectRejected("prototype replacement on chunks", () =>
    Object.setPrototypeOf(grid.chunks, Map.prototype));
  expectRejected("prototype replacement on chunk owners", () =>
    Object.setPrototypeOf(grid.chunkOwners, Map.prototype));
  expectRejected("prototype replacement on dirty chunks", () =>
    Object.setPrototypeOf(grid.dirtyChunks, Set.prototype));
  if (Reflect.setPrototypeOf(grid.chunks, Map.prototype) ||
      Reflect.setPrototypeOf(grid.chunkOwners, Map.prototype) ||
      Reflect.setPrototypeOf(grid.dirtyChunks, Set.prototype)) {
    throw new Error("Tracked collection accepted reflective prototype replacement");
  }

  // A native prototype call normally bypasses an overridden subclass method.
  // The public collection proxies must reject these calls before changing data.
  expectRejected("native Map.prototype.set bypass on chunks", () =>
    Map.prototype.set.call(grid.chunks, "1,0,0", new Chunk(1, 0, 0)));
  expectRejected("native Map.prototype.delete bypass on chunks", () =>
    Map.prototype.delete.call(grid.chunks, "0,0,0"));
  expectRejected("native Map.prototype.clear bypass on chunks", () =>
    Map.prototype.clear.call(grid.chunks));
  expectRejected("native Map.prototype.set bypass on chunk owners", () =>
    Map.prototype.set.call(grid.chunkOwners, "0,0,0", "owner"));
  expectRejected("native Map.prototype.clear bypass on chunk owners", () =>
    Map.prototype.clear.call(grid.chunkOwners));
  expectRejected("native Set.prototype.add bypass on dirty chunks", () =>
    Set.prototype.add.call(grid.dirtyChunks, "0,0,0"));
  expectRejected("native Set.prototype.delete bypass on dirty chunks", () =>
    Set.prototype.delete.call(grid.dirtyChunks, "0,0,0"));
  expectRejected("native Set.prototype.clear bypass on dirty chunks", () =>
    Set.prototype.clear.call(grid.dirtyChunks));

  // Native forEach must not leak the wrapped target as its third callback
  // argument. Otherwise a callback can call Map/Set prototype mutators on
  // that raw instance and bypass the public proxy.
  expectRejected("native Map.prototype.set bypass through chunks.forEach receiver", () =>
    grid.chunks.forEach((_chunk, _key, collection) =>
      Map.prototype.set.call(collection, "1,0,0", new Chunk(1, 0, 0))));
  if (!(grid.chunks instanceof Map) || !(grid.chunkOwners instanceof Map) ||
      !(grid.dirtyChunks instanceof Set) ||
      grid.chunks.size !== 1 || !grid.chunks.has("0,0,0") ||
      grid.chunkOwners.size !== 0 || grid.dirtyChunks.size !== 0 ||
      Object.getPrototypeOf(grid.chunks) !== chunksPrototype ||
      Object.getPrototypeOf(grid.chunkOwners) !== ownersPrototype ||
      Object.getPrototypeOf(grid.dirtyChunks) !== dirtyPrototype ||
      grid.mutationRevision !== guardedRevision || grid.physicalTopology !== guardedTopology) {
    throw new Error("Native Map/Set prototype bypass changed tracked collection state or revision");
  }

  // Seed each collection so forEach actually invokes its callback. Verify that
  // the third callback argument is the public proxy, not the raw target.
  grid.chunkOwners.set("0,0,0", "owner");
  grid.dirtyChunks.add("0,0,0");
  const forEachRevision = grid.mutationRevision;
  expectRejected("native Map.prototype.set bypass through chunkOwners.forEach receiver", () =>
    grid.chunkOwners.forEach((_owner, _key, collection) =>
      Map.prototype.set.call(collection, "0,0,0", "bypass")));
  expectRejected("native Set.prototype.add bypass through dirtyChunks.forEach receiver", () =>
    grid.dirtyChunks.forEach((_key, _sameKey, collection) =>
      Set.prototype.add.call(collection, "1,0,0")));
  if (grid.chunkOwners.size !== 1 || grid.chunkOwners.get("0,0,0") !== "owner" ||
      grid.dirtyChunks.size !== 1 || !grid.dirtyChunks.has("0,0,0") ||
      grid.mutationRevision !== forEachRevision) {
    throw new Error("forEach callback exposed a raw tracked collection or changed state");
  }
  grid.chunkOwners.clear();
  grid.dirtyChunks.clear();

  // The guarded proxies must retain normal collection behavior and tracking.
  const normalOwnerRevision = grid.mutationRevision;
  grid.chunkOwners.set("0,0,0", "owner");
  grid.dirtyChunks.add("0,0,0");
  if (grid.chunkOwners.get("0,0,0") !== "owner" ||
      !grid.dirtyChunks.has("0,0,0") ||
      grid.mutationRevision <= normalOwnerRevision) {
    throw new Error("Guarded tracked collections broke ordinary Map/Set mutation behavior");
  }
  grid.chunkOwners.clear();
  grid.dirtyChunks.clear();

  const initialTopology = grid.physicalTopology;
  if (initialTopology !== grid.physicalTopology ||
      initialTopology.chunks.length !== grid.chunks.size ||
      initialTopology.chunks[0]?.key !== "0,0,0") {
    throw new Error("SparseVoxelGrid did not cache its canonical physical topology snapshot");
  }
  const initialRevision = grid.mutationRevision;
  const originChunk = grid.chunks.get("0,0,0");
  if (!originChunk) throw new Error("SparseVoxelGrid did not seed its origin chunk");
  originChunk.buffer[0] = 3.5;
  if (grid.mutationRevision <= initialRevision || grid.physicalTopology !== initialTopology) {
    throw new Error("Chunk content mutation incorrectly invalidated physical topology or skipped revision tracking");
  }
  const negativeChunk = new Chunk(-1, 0, 0);
  grid.chunks.set("-1,0,0", negativeChunk);
  const expandedTopology = grid.physicalTopology;
  const negativeAddress = grid.resolvePhysicalCellAddress(-1, 0, 0);
  if (expandedTopology === initialTopology ||
      expandedTopology.chunks.length !== grid.chunks.size ||
      !negativeAddress ||
      negativeAddress.chunk.key !== "-1,0,0" ||
      negativeAddress.localX !== 31) {
    throw new Error("SparseVoxelGrid physical topology did not reflect a newly inserted negative-coordinate chunk");
  }
  if (!grid.chunks.delete("-1,0,0")) {
    throw new Error("SparseVoxelGrid failed to remove a topology test chunk");
  }
  const restoredTopology = grid.physicalTopology;
  if (restoredTopology === expandedTopology ||
      restoredTopology.chunks.some(chunk => chunk.key === "-1,0,0") ||
      grid.resolvePhysicalCellAddress(-1, 0, 0) !== null) {
    throw new Error("SparseVoxelGrid physical topology cache remained stale after chunk deletion");
  }

  console.log("SparseVoxelGrid mixed-LOD physical topology preflight, grid index lifecycle and coordinate lookup: PASS");
}
