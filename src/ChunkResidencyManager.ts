import { ChunkKey, ChunkState, InfinityScaleV2, Vec3i, chunkKeyString } from "./InfinityScaleV2";

export interface ResidencyRecord {
  key: string;
  chunk: ChunkKey;
  state: ChunkState;
  lod: number;
  amr: number;
  pinned: boolean;
}

/**
 * Adapter between InfinityScaleV2 planning and a real storage/simulation/render backend.
 * The callbacks are intentionally dependency-free so the class can be wired to
 * SparseVoxelGrid, IndexedDB, WebGPU buffers, or a future remote chunk store.
 */
export class ChunkResidencyManager {
  constructor(private readonly scale: InfinityScaleV2) {}

  plan(observer: Vec3i, chunkKeys: ChunkKey[]): ResidencyRecord[] {
    this.scale.setObserver(observer);
    return chunkKeys.map(chunk => {
      const distance = Math.max(
        Math.abs(chunk.x),
        Math.abs(chunk.y),
        Math.abs(chunk.z),
      );
      return {
        key: chunkKeyString(chunk),
        chunk,
        state: this.scale.state(chunk),
        lod: this.scale.selectLOD(distance),
        amr: 0,
        pinned: false,
      };
    });
  }

  updateAMR(records: ResidencyRecord[], gradientNorm: number, residual: number): ResidencyRecord[] {
    return records.map(r => ({ ...r, amr: this.scale.selectAMR(gradientNorm, residual) }));
  }
}
