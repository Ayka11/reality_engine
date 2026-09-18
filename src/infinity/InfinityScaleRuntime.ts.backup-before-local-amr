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
 * - AMR uses a real solver residual when available.
 * - When no residual is available, AMR falls back to the real
 *   spatial gradient diagnostic.
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

  /**
   * Update AMR using the available scientific diagnostics.
   *
   * If a real solver residual is supplied, the existing residual-aware
   * AMR logic is used.
   *
   * If no real residual is available, the gradient-only AMR path is used.
   *
   * No artificial residual value is injected.
   */
  updateAMR(
    gradientNorm: number,
    residual?: number,
  ): ResidencyRecord[] {
    if (Number.isFinite(residual)) {
      this.lastRecords = this.residency.updateAMR(
        this.lastRecords,
        gradientNorm,
        residual as number,
      );
    } else {
      this.lastRecords = this.residency.updateAMRFromGradient(
        this.lastRecords,
        gradientNorm,
      );
    }

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
      Number.isFinite(diagnostics.gradientNorm)
    ) {
      return this.updateAMR(
        diagnostics.gradientNorm as number,
        Number.isFinite(diagnostics.residual)
          ? diagnostics.residual as number
          : undefined,
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
