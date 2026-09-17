import {
  InfinityScaleV2,
  DEFAULT_INFINITY_SCALE_V2,
  type Vec3i,
  type ChunkKey,
} from "../InfinityScaleV2";
import {
  ChunkResidencyManager,
  type ResidencyRecord,
} from "../ChunkResidencyManager";
import {
  MemoryChunkStore,
  type ChunkStore,
} from "../ChunkStore";
import type { ScaleTelemetry } from "../ScaleTelemetry";

export interface InfinityScaleDiagnostics {
  gradientNorm?: number;
  residual?: number;
}

/**
 * Runtime bridge between the existing SparseVoxelGrid and Infinity Scale.
 *
 * Important:
 * - SparseVoxelGrid remains the authoritative chunk storage.
 * - Infinity Scale plans residency/LOD around the current observer.
 * - No physical grid chunks are deleted by this runtime.
 * - AMR is applied only when real solver diagnostics are supplied.
 */
export class InfinityScaleRuntime {
  readonly scale: InfinityScaleV2;
  readonly residency: ChunkResidencyManager;
  readonly store: ChunkStore;

  private observer: Vec3i = { x: 0, y: 0, z: 0 };
  private lastRecords: ResidencyRecord[] = [];

  constructor(store: ChunkStore = new MemoryChunkStore()) {
    this.scale = new InfinityScaleV2(DEFAULT_INFINITY_SCALE_V2);
    this.residency = new ChunkResidencyManager(this.scale);
    this.store = store;
  }

  setObserver(observer: Vec3i): void {
    this.observer = {
      x: Math.trunc(observer.x),
      y: Math.trunc(observer.y),
      z: Math.trunc(observer.z),
    };

    this.scale.setObserver(this.observer);
  }

  getObserver(): Vec3i {
    return { ...this.observer };
  }

  plan(chunks: ChunkKey[]): ResidencyRecord[] {
    this.lastRecords = this.residency.plan(
      this.observer,
      chunks,
    );

    return [...this.lastRecords];
  }

  updateAMR(
    gradientNorm: number,
    residual: number,
  ): ResidencyRecord[] {
    this.lastRecords = this.residency.updateAMR(
      this.lastRecords,
      gradientNorm,
      residual,
    );

    return [...this.lastRecords];
  }

  /**
   * Update Infinity Scale from the actual simulation chunk coordinates.
   *
   * The supplied chunks come from SparseVoxelGrid.chunks.
   * Infinity Scale does not become a second authoritative chunk store.
   */
  update(
    chunks: ChunkKey[],
    diagnostics?: InfinityScaleDiagnostics,
  ): ResidencyRecord[] {
    const records = this.plan(chunks);

    if (
      diagnostics &&
      Number.isFinite(diagnostics.gradientNorm) &&
      Number.isFinite(diagnostics.residual)
    ) {
      return this.updateAMR(
        diagnostics.gradientNorm as number,
        diagnostics.residual as number,
      );
    }

    return records;
  }

  telemetry(): ScaleTelemetry {
    return this.scale.telemetry();
  }

  residencyRecords(): ResidencyRecord[] {
    return [...this.lastRecords];
  }
}

export function createInfinityScaleRuntime(): InfinityScaleRuntime {
  return new InfinityScaleRuntime();
}
