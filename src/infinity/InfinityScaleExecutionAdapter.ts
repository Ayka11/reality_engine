import type { InfinityScaleFramePlan } from "./InfinityScaleFramePlan";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import { WORLD } from "../core/WorldConstants";

export type InfinityScaleExecutionMode =
  | "advisory"
  | "selective-cpu-ready"
  | "selective-gpu-ready";

export interface InfinityScaleExecutionChunk {
  key: string;
  lod: number;
  amr: number;
  distance: number;
}

export interface InfinityScaleExecutionPlan {
  revision: number;
  mode: InfinityScaleExecutionMode;
  observer: InfinityScaleFramePlan["observer"];
  chunks: InfinityScaleExecutionChunk[];
  simulationBudget: number;
  requestedSimulationCount: number;
  selectedSimulationCount: number;
  maxSimulatingChunks: number;
  /**
   * One-cell stencil dependencies expressed as neighboring chunk keys.
   * These are read dependencies only; they are not additional simulation work.
   */
  boundaryReadChunks: string[];
  boundaryReadCount: number;
  simulationCellCount: number;
  boundaryReadCellCount: number;
  localExecutionLayers: string[];
  globalExecutionLayers: string[];
  selectiveCpuReady: boolean;
  selectiveGpuReady: boolean;
  gpuPhysicsReady: boolean;
  entityExecutionReady: boolean;
  agentMigrationReady: boolean;
}

/**
 * Converts the frame-level Infinity Scale plan into an execution contract.
 *
 * "advisory" is intentional for the current dense SparseVoxelGrid solver:
 * the plan describes the bounded work set, but SimulationEngine continues to
 * execute its existing full-domain stencil until chunk-local boundary and
 * synchronization semantics are implemented.
 */
export interface InfinityScaleExecutionCapabilities {
  selectiveCpuReady: boolean;
  selectiveGpuReady: boolean;
  gpuPhysicsReady: boolean;
}

export class InfinityScaleExecutionAdapter {
  private plan: InfinityScaleExecutionPlan;
  private capabilities: InfinityScaleExecutionCapabilities = {
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
  };

  setCapabilities(capabilities: InfinityScaleExecutionCapabilities): void {
    this.capabilities = { ...capabilities };
  }

  getCapabilities(): InfinityScaleExecutionCapabilities {
    return { ...this.capabilities };
  }

  constructor() {
    this.plan = {
      revision: 0,
      mode: "selective-cpu-ready",
      observer: { x: 0, y: 0, z: 0 },
      chunks: [],
      simulationBudget: 0,
      requestedSimulationCount: 0,
      selectedSimulationCount: 0,
      maxSimulatingChunks: 0,
      boundaryReadChunks: [],
      boundaryReadCount: 0,
      simulationCellCount: 0,
      boundaryReadCellCount: 0,
      localExecutionLayers: [],
      globalExecutionLayers: [],
      selectiveCpuReady: this.capabilities.selectiveCpuReady,
      selectiveGpuReady: this.capabilities.selectiveGpuReady,
      gpuPhysicsReady: this.capabilities.gpuPhysicsReady,
      entityExecutionReady: true,
      agentMigrationReady: true,
    };

    if (geometry.overlappingSimulationRangeCount > 0) {
      throw new Error(
        `Infinity Scale execution contains overlapping simulation ownership ranges: ${geometry.overlappingSimulationRangeCount}`,
      );
    }

    // Boundary halos are allowed to overlap: they are read dependencies, not
    // owners. The execution context deduplicates their cell footprint, so the
    // plan's boundary-read budget represents unique transferred cells.
  }

  update(
    frame: InfinityScaleFramePlan,
    capabilities: InfinityScaleExecutionCapabilities = this.capabilities,
  ): InfinityScaleExecutionPlan {
    this.setCapabilities(capabilities);
    const selected = frame.chunks
      .filter(chunk => chunk.simulationEligible)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, frame.maxSimulatingChunks);

    const simulationKeys = new Set(selected.map(chunk => chunk.key));
    const boundaryReadKeys = new Set<string>();

    // FieldPhysics uses a 6-neighbor stencil. A future selective solver must
    // therefore read the one-chunk halo around each simulated chunk. The halo
    // is a dependency set, not extra simulation budget.
    for (const chunk of selected) {
      const level = chunk.chunk.level;
      const x = chunk.chunk.x;
      const y = chunk.chunk.y;
      const z = chunk.chunk.z;
      for (const [dx, dy, dz] of [
        [-1, 0, 0], [1, 0, 0],
        [0, -1, 0], [0, 1, 0],
        [0, 0, -1], [0, 0, 1],
      ]) {
        const key = `${level}:${x + dx},${y + dy},${z + dz}`;
        if (!simulationKeys.has(key)) boundaryReadKeys.add(key);
      }
    }

    const geometry = new InfinityScaleChunkExecutionContext(
      {
        revision: frame.revision,
        mode: "selective-cpu-ready",
        observer: frame.observer,
        chunks: selected.map(chunk => ({
          key: chunk.key,
          lod: chunk.lod,
          amr: chunk.amr,
          distance: chunk.distance,
        })),
        simulationBudget: frame.maxSimulatingChunks,
        requestedSimulationCount: frame.simulating.length,
        selectedSimulationCount: selected.length,
        maxSimulatingChunks: frame.maxSimulatingChunks,
        boundaryReadChunks: [...boundaryReadKeys].sort(),
        boundaryReadCount: boundaryReadKeys.size,
        simulationCellCount: 0,
        boundaryReadCellCount: 0,
      },
      WORLD.W,
      WORLD.H,
      WORLD.D,
    );

    const mode: InfinityScaleExecutionMode =
      this.capabilities.selectiveGpuReady && this.capabilities.gpuPhysicsReady
        ? "selective-gpu-ready"
        : this.capabilities.selectiveCpuReady
          ? "selective-cpu-ready"
          : "advisory";

    this.plan = {
      revision: frame.revision,
      mode,
      observer: { ...frame.observer },
      chunks: selected.map(chunk => ({
        key: chunk.key,
        lod: chunk.lod,
        amr: chunk.amr,
        distance: chunk.distance,
      })),
      simulationBudget: frame.maxSimulatingChunks,
      requestedSimulationCount: frame.simulating.length,
      selectedSimulationCount: selected.length,
      maxSimulatingChunks: frame.maxSimulatingChunks,
      boundaryReadChunks: [...boundaryReadKeys].sort(),
      boundaryReadCount: boundaryReadKeys.size,
      simulationCellCount: geometry.simulationCellCount,
      boundaryReadCellCount: geometry.readCellCount,
      localExecutionLayers: [
        "FieldPhysics",
        "EntropyLayer",
        "InfoPhysics",
        "TemporalLayer",
        "ChemLayer",
        "AgentSystem",
        "EntityLayer",
        "Causality",
      ],
      globalExecutionLayers: [
        "Recorder",
        "LawEngine",
        "WorldEvents",
      ],
      selectiveCpuReady: this.capabilities.selectiveCpuReady,
      selectiveGpuReady: this.capabilities.selectiveGpuReady,
      gpuPhysicsReady: this.capabilities.gpuPhysicsReady,
      entityExecutionReady: true,
      agentMigrationReady: true,
    };

    return this.getPlan();
  }

  getPlan(): InfinityScaleExecutionPlan {
    return {
      ...this.plan,
      observer: { ...this.plan.observer },
      chunks: this.plan.chunks.map(chunk => ({ ...chunk })),
      boundaryReadChunks: [...this.plan.boundaryReadChunks],
    };
  }

  isSimulationChunk(key: string): boolean {
    return this.plan.chunks.some(chunk => chunk.key === key);
  }
}
