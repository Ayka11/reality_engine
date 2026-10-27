import { ChunkKey, ChunkState, InfinityScaleV2, Vec3i, cellToChunk, chunkKeyString } from "./InfinityScaleV2";

function validateResidencyChunkKey(chunk: ChunkKey): void {
  if (!chunk || typeof chunk !== "object" ||
      ![chunk.x, chunk.y, chunk.z, chunk.level].every(Number.isSafeInteger) ||
      chunk.level < 0 || chunk.level > 30) {
    throw new RangeError("ChunkResidencyManager received an invalid chunk key or LOD level");
  }

  const scale = 2 ** chunk.level;
  const min = [chunk.x * scale, chunk.y * scale, chunk.z * scale];
  const max = min.map(value => value + scale - 1);
  if (![...min, ...max].every(Number.isSafeInteger)) {
    throw new RangeError(
      "ChunkResidencyManager chunk geometry exceeds safe integer bounds: " +
      chunkKeyString(chunk),
    );
  }
}

export interface ResidencyRecord {
  key: string;
  chunk: ChunkKey;
  state: ChunkState;
  lod: number;
  amr: number;
  pinned: boolean;
  /** Chebyshev distance from the observer chunk to this chunk's footprint, in base-chunk units. */
  distance: number;
}

/**
 * Adapter between InfinityScaleV2 planning and a real storage/simulation/render backend.
 * The callbacks are intentionally dependency-free so the class can be wired to
 * SparseVoxelGrid, IndexedDB, WebGPU buffers, or a future remote chunk store.
 */
export class ChunkResidencyManager {
  constructor(private readonly scale: InfinityScaleV2) {}

  plan(observer: Vec3i, chunkKeys: ChunkKey[]): ResidencyRecord[] {
    if (!Array.isArray(chunkKeys)) {
      throw new TypeError("ChunkResidencyManager.plan requires a chunk-key array");
    }
    for (const chunk of chunkKeys) validateResidencyChunkKey(chunk);

    // Preflight all supplied keys before changing the planner's observer. A
    // malformed late item must not leave a partially updated residency frame.
    this.scale.setObserver(observer);
    return chunkKeys.map(chunk => {
      // Observer coordinates are cells; ChunkKey coordinates are
      // LOD-local chunk indices. Compare in base-chunk units so an observer at
      // cell 3200 is near chunk x=100, not thousands of chunks away.
      const observerChunk = [
        cellToChunk(observer.x, this.scale.config.chunkSize)[0],
        cellToChunk(observer.y, this.scale.config.chunkSize)[0],
        cellToChunk(observer.z, this.scale.config.chunkSize)[0],
      ];
      const chunkScale = 2 ** chunk.level;
      const chunkMin = [
        chunk.x * chunkScale,
        chunk.y * chunkScale,
        chunk.z * chunkScale,
      ];
      const chunkMax = chunkMin.map(value => value + chunkScale - 1);
      const distanceAxis = (coordinate: number, min: number, max: number) =>
        coordinate < min ? min - coordinate : coordinate > max ? coordinate - max : 0;
      const distance = Math.max(
        distanceAxis(observerChunk[0], chunkMin[0], chunkMax[0]),
        distanceAxis(observerChunk[1], chunkMin[1], chunkMax[1]),
        distanceAxis(observerChunk[2], chunkMin[2], chunkMax[2]),
      );
      return {
        key: chunkKeyString(chunk),
        chunk: { ...chunk },
        state: this.scale.state(chunk),
        lod: this.scale.selectLOD(distance),
        amr: 0,
        pinned: false,
        distance,
      };
    });
  }

  updateAMRFromGradient(records: ResidencyRecord[], gradientNorm: number): ResidencyRecord[] {
    return records.map(r => ({ ...r, amr: this.scale.selectAMRFromGradient(gradientNorm) }));
  }

  updateAMR(records: ResidencyRecord[], gradientNorm: number, residual: number): ResidencyRecord[] {
    return records.map(r => ({ ...r, amr: this.scale.selectAMR(gradientNorm, residual) }));
  }
}
