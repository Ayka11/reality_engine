import type { ChunkKey } from "../InfinityScaleV2";
import {
  InfinityScaleRuntime,
  type InfinityScaleDiagnostics,
} from "./InfinityScaleRuntime";
import type {
  InfinityScaleChunkPlan,
  InfinityScaleFramePlan,
} from "./InfinityScaleFramePlan";

/**
 * Turns InfinityScaleRuntime residency records into a stable per-frame contract.
 *
 * The bridge is deliberately downstream-facing: it does not own physical
 * simulation state and does not perform AMR refinement. Consumers can use the
 * plan to decide which physical work is eligible for simulation and rendering.
 */
export class InfinityScaleBridge {
  private revision = 0;

  constructor(readonly runtime: InfinityScaleRuntime) {}

  update(
    chunks: ChunkKey[],
    diagnostics?: InfinityScaleDiagnostics,
  ): InfinityScaleFramePlan {
    const records = this.runtime.update(chunks, diagnostics);
    const observer = this.runtime.getObserver();

    const planned: InfinityScaleChunkPlan[] = records.map((record) => {
      const distance = Math.max(
        Math.abs(record.chunk.x - observer.x),
        Math.abs(record.chunk.y - observer.y),
        Math.abs(record.chunk.z - observer.z),
      );

      return {
        key: record.key,
        chunk: record.chunk,
        state: record.state,
        lod: record.lod,
        amr: record.amr,
        pinned: record.pinned,
        distance,
        simulationEligible: record.state === "simulating",
        renderEligible:
          record.state === "visible" || record.state === "background",
      };
    });

    const simulating = planned
      .filter((p) => p.simulationEligible)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.runtime.scale.config.maxSimulatingChunks)
      .map((p) => p.key);

    const visible = planned
      .filter((p) => p.state === "visible")
      .map((p) => p.key);

    const background = planned
      .filter((p) => p.state === "background")
      .map((p) => p.key);

    const cached = planned
      .filter((p) => p.state === "cached")
      .map((p) => p.key);

    const unloaded = planned
      .filter((p) => p.state === "unloaded")
      .map((p) => p.key);

    this.revision += 1;

    return {
      observer,
      chunks: planned,
      simulating,
      visible,
      background,
      cached,
      unloaded,
      residentCount: planned.filter((p) => p.state !== "unloaded").length,
      simulationCount: simulating.length,
      visibleCount: visible.length,
      maxSimulatingChunks: this.runtime.scale.config.maxSimulatingChunks,
      maxResidentChunks: this.runtime.scale.config.maxResidentChunks,
      revision: this.revision,
      generatedAt: Date.now(),
    };
  }
}
