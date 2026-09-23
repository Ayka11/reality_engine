import type { ChunkKey, Vec3i } from "../InfinityScaleV2";
import type { InfinityScaleChunkPlan } from "./InfinityScaleFramePlan";

export interface PhysicalChunkAddress {
  x: number;
  y: number;
  z: number;
}

export interface PhysicalGridGeometry {
  chunkSize: number;
  chunksX: number;
  chunksY: number;
  chunksZ: number;
}

/**
 * Maps between Infinity Scale logical chunks and the existing physical chunk grid.
 *
 * The current ChunkGrid uses 8^3 physical chunks while Infinity Scale v2 uses
 * 32^3 logical level-0 chunks. Therefore one logical chunk contains 4^3 = 64
 * physical chunks.
 *
 * This adapter only performs coordinate conversion. It does not allocate,
 * delete, refine, or simulate physical chunks.
 */
export class InfinityScaleSpatialAdapter {
  constructor(
    private readonly logicalChunkSize = 32,
    private readonly physicalChunkSize = 8,
  ) {
    if (logicalChunkSize <= 0 || physicalChunkSize <= 0) {
      throw new Error("Chunk sizes must be positive.");
    }
    if (logicalChunkSize % physicalChunkSize !== 0) {
      throw new Error("Logical chunk size must be divisible by physical chunk size.");
    }
  }

  physicalToLogical(chunk: PhysicalChunkAddress, level = 0): ChunkKey {
    const ratio = this.logicalChunkSize / this.physicalChunkSize;
    return {
      x: Math.floor(chunk.x / ratio),
      y: Math.floor(chunk.y / ratio),
      z: Math.floor(chunk.z / ratio),
      level,
    };
  }

  physicalChunksToLogical(chunks: PhysicalChunkAddress[], level = 0): ChunkKey[] {
    const seen = new Set<string>();
    const result: ChunkKey[] = [];

    for (const chunk of chunks) {
      const logical = this.physicalToLogical(chunk, level);
      const key = this.logicalKey(logical);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(logical);
      }
    }

    return result;
  }

  logicalToPhysical(
    chunk: ChunkKey,
    plan?: Pick<InfinityScaleChunkPlan, "lod" | "amr">,
  ): { infinity: ChunkKey; physical: PhysicalChunkAddress[]; lod: number; amr: number } {
    const ratio = this.logicalChunkSize / this.physicalChunkSize;
    const physical: PhysicalChunkAddress[] = [];
    const baseX = chunk.x * ratio;
    const baseY = chunk.y * ratio;
    const baseZ = chunk.z * ratio;

    for (let z = 0; z < ratio; z++) {
      for (let y = 0; y < ratio; y++) {
        for (let x = 0; x < ratio; x++) {
          physical.push({ x: baseX + x, y: baseY + y, z: baseZ + z });
        }
      }
    }

    return {
      infinity: { ...chunk },
      physical,
      lod: plan?.lod ?? 0,
      amr: plan?.amr ?? 0,
    };
  }

  observerToPhysicalChunk(
    observerCell: Vec3i,
    physicalGrid: PhysicalGridGeometry,
  ): PhysicalChunkAddress {
    return {
      x: this.clamp(Math.floor(observerCell.x / this.physicalChunkSize), 0, physicalGrid.chunksX - 1),
      y: this.clamp(Math.floor(observerCell.y / this.physicalChunkSize), 0, physicalGrid.chunksY - 1),
      z: this.clamp(Math.floor(observerCell.z / this.physicalChunkSize), 0, physicalGrid.chunksZ - 1),
    };
  }

  private logicalKey(chunk: ChunkKey): string {
    return `${chunk.x}:${chunk.y}:${chunk.z}:${chunk.level}`;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
