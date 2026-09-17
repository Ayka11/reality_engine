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

/**
 * Runtime bridge for Reality Engine Infinity Scale v2.0.
 *
 * Keeps Infinity Scale separate from SimulationEngine while exposing
 * a simple API for the application and future UI/telemetry panels.
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
    this.lastRecords = [];
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
