import { F } from "./CellState";
import { SparseVoxelGridPhysicalChunk } from "./SparseVoxelGridPhysicalChunk";
import { SparseVoxelGridPhysicalChunkStore } from "./SparseVoxelGridPhysicalChunkStore";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  if (!rejected) throw new Error("Physical chunk store accepted " + label);
}

export function runSparseVoxelGridPhysicalChunkStoreRegression(): void {
  const store = new SparseVoxelGridPhysicalChunkStore();
  if (store.revision !== 0 || store.size !== 0 || store.topology.chunks.length !== 0) {
    throw new Error("Physical chunk store did not initialize as an empty revision-zero owner");
  }

  const coarse = new SparseVoxelGridPhysicalChunk("1:0,0,0");
  const fine = new SparseVoxelGridPhysicalChunk("2,0,0");
  const separate = new SparseVoxelGridPhysicalChunk("2:1,0,0");
  coarse.buffer[0] = 11.5;
  coarse.backBuffer[0] = 7.25;
  coarse.active = false;
  const publishedRevision = store.replaceAll(0, [coarse, fine, separate]);
  if (publishedRevision !== 1 || store.revision !== 1 || store.size !== 3 ||
      store.topology.chunks.length !== 3 ||
      store.topology.chunks.find(item => item.key === coarse.key)?.scale !== 2) {
    throw new Error("Physical chunk store failed to publish a valid mixed-LOD topology atomically");
  }

  const storedCoarse = store.get(coarse.key);
  if (!storedCoarse || storedCoarse === coarse ||
      storedCoarse.buffer[0] !== 11.5 || storedCoarse.backBuffer[0] !== 7.25 ||
      storedCoarse.active !== false || storedCoarse.level !== 1) {
    throw new Error("Physical chunk store did not preserve detached front/back data and metadata");
  }
  storedCoarse.buffer[0] = 99;
  storedCoarse.backBuffer[0] = 88;
  if (store.get(coarse.key)?.buffer[0] !== 11.5 ||
      store.get(coarse.key)?.backBuffer[0] !== 7.25 ||
      store.revision !== 1) {
    throw new Error("A detached read mutated authoritative store data or revision");
  }

  const snapshot = store.snapshot();
  if (!Object.isFrozen(snapshot) || snapshot.length !== 3 ||
      snapshot[0].key > snapshot[1].key || snapshot[1].key > snapshot[2].key) {
    throw new Error("Physical chunk store snapshot is not a frozen canonical detached list");
  }
  snapshot[0].getCell(0, 0, 0).set(F.ENERGY, 123);
  if (store.revision !== 1 || store.get(coarse.key)?.buffer[0] !== 11.5) {
    throw new Error("Mutating a snapshot leaked into the physical chunk store");
  }

  const beforeFailedPublication = store.snapshot();
  expectRejected("a stale expected revision", () => store.replaceAll(0, []));
  expectRejected("duplicate chunk keys", () => store.replaceAll(1, [fine, fine]));
  expectRejected("overlapping coarse/fine chunks", () =>
    store.replaceAll(1, [coarse, new SparseVoxelGridPhysicalChunk("0,0,0")]));
  expectRejected("a non-physical chunk object", () => store.replaceAll(1, [{} as SparseVoxelGridPhysicalChunk]));
  expectRejected("a non-array candidate", () => store.replaceAll(1, null as unknown as SparseVoxelGridPhysicalChunk[]));
  if (store.revision !== 1 || store.size !== 3 ||
      store.snapshot().some((chunk, index) =>
        chunk.key !== beforeFailedPublication[index].key ||
        chunk.buffer[0] !== beforeFailedPublication[index].buffer[0] ||
        chunk.backBuffer[0] !== beforeFailedPublication[index].backBuffer[0])) {
    throw new Error("A rejected physical topology replacement partially changed authoritative state");
  }

  const replacement = new SparseVoxelGridPhysicalChunk("3:2,0,0");
  replacement.buffer[4] = 42;
  if (store.replaceAll(1, [replacement]) !== 2 ||
      store.revision !== 2 || store.size !== 1 ||
      store.keys[0] !== replacement.key ||
      store.get(replacement.key)?.buffer[4] !== 42) {
    throw new Error("Physical chunk store failed to atomically replace its complete topology");
  }
  if (store.replaceAll(2, []) !== 3 || store.size !== 0) {
    throw new Error("Physical chunk store could not atomically publish an empty topology");
  }

  console.log("SparseVoxelGrid physical chunk store compare-and-swap publication, detached ownership, mixed-LOD topology and rollback regressions: PASS");
}
