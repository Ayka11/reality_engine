import type { InfinityScaleFramePlan } from "./InfinityScaleFramePlan";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type {
  InfinityScaleBoundaryRelation,
  InfinityScaleBoundaryReadRelation,
} from "./InfinityScaleChunkExecutionContext";
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
  boundaryReadRelations: InfinityScaleBoundaryReadRelation[];
  simulationCellCount: number;
  boundaryReadCellCount: number;
  localExecutionLayers: string[];
  globalExecutionLayers: string[];
  selectiveCpuReady: boolean;
  selectiveGpuReady: boolean;
  gpuPhysicsReady: boolean;
  lodBoundaryTransferReady: boolean;
  mixedLodExecutionReady: boolean;
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
  lodBoundaryTransferReady: boolean;
  mixedLodExecutionReady: boolean;
}

export class InfinityScaleExecutionAdapter {
  private plan: InfinityScaleExecutionPlan;
  private capabilities: InfinityScaleExecutionCapabilities = {
    selectiveCpuReady: true,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: false,
    mixedLodExecutionReady: false,
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
      boundaryReadRelations: [],
      simulationCellCount: 0,
      boundaryReadCellCount: 0,
      localExecutionLayers: [],
      globalExecutionLayers: [],
      selectiveCpuReady: this.capabilities.selectiveCpuReady,
      selectiveGpuReady: this.capabilities.selectiveGpuReady,
      gpuPhysicsReady: this.capabilities.gpuPhysicsReady,
      lodBoundaryTransferReady: this.capabilities.lodBoundaryTransferReady,
      mixedLodExecutionReady: this.capabilities.mixedLodExecutionReady,
      entityExecutionReady: true,
      agentMigrationReady: true,
    };

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
    const boundaryReadRelations: InfinityScaleBoundaryReadRelation[] = [];

    // Resolve the six face neighbors in physical space. At mixed LOD, a face
    // may touch one coarser parent or multiple finer children; emit every
    // logical neighbor whose dense footprint can intersect that face.
    for (const chunk of selected) {
      for (const dependency of this.resolveFaceNeighbors(chunk, frame.chunks)) {
        boundaryReadKeys.add(dependency.targetChunk);
        if (!simulationKeys.has(dependency.targetChunk)) {
          boundaryReadRelations.push(dependency);
        }
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
        boundaryReadRelations: boundaryReadRelations.sort((a, b) =>
          a.sourceChunk.localeCompare(b.sourceChunk) ||
          a.targetChunk.localeCompare(b.targetChunk) ||
          a.relation.localeCompare(b.relation),
        ),
        simulationCellCount: 0,
        boundaryReadCellCount: 0,
      },
      WORLD.W,
      WORLD.H,
      WORLD.D,
    );

    if (geometry.overlappingSimulationRangeCount > 0) {
      throw new Error(
        `Infinity Scale execution contains overlapping simulation ownership ranges: ${geometry.overlappingSimulationRangeCount}`,
      );
    }

    const hasMixedLodBoundary = boundaryReadRelations.some(
      relation => relation.relation !== "same-level",
    );
    const lodBoundaryReady =
      !hasMixedLodBoundary ||
      (
        this.capabilities.lodBoundaryTransferReady &&
        this.capabilities.mixedLodExecutionReady
      );

    const mode: InfinityScaleExecutionMode =
      lodBoundaryReady && this.capabilities.selectiveGpuReady && this.capabilities.gpuPhysicsReady
        ? "selective-gpu-ready"
        : lodBoundaryReady && this.capabilities.selectiveCpuReady
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
      boundaryReadRelations: boundaryReadRelations.map(relation => ({ ...relation })),
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
      lodBoundaryTransferReady: this.capabilities.lodBoundaryTransferReady,
      mixedLodExecutionReady: this.capabilities.mixedLodExecutionReady,
      entityExecutionReady: true,
      agentMigrationReady: true,
    };

    return this.getPlan();
  }

  private resolveFaceNeighbors(
    chunk: InfinityScaleFramePlan["chunks"][number],
    candidates: InfinityScaleFramePlan["chunks"],
  ): InfinityScaleBoundaryReadRelation[] {
    const out = new Map<string, InfinityScaleBoundaryReadRelation>();
    const level = chunk.chunk.level;
    const scale = 2 ** level;
    const baseX = chunk.chunk.x * scale;
    const baseY = chunk.chunk.y * scale;
    const baseZ = chunk.chunk.z * scale;
    const maxX = baseX + scale - 1;
    const maxY = baseY + scale - 1;
    const maxZ = baseZ + scale - 1;

    type Face = {
      axis: "x" | "y" | "z";
      coordinate: number;
      minU: number;
      maxU: number;
      minV: number;
      maxV: number;
    };

    // A face is represented by its full 2-D footprint in base-cell space.
    // This is essential for mixed LOD: a coarse face may touch several fine
    // children, and point sampling can silently miss all but one of them.
    const faces: Face[] = [
      { axis: "x", coordinate: baseX - 1, minU: baseY, maxU: maxY, minV: baseZ, maxV: maxZ },
      { axis: "x", coordinate: maxX + 1, minU: baseY, maxU: maxY, minV: baseZ, maxV: maxZ },
      { axis: "y", coordinate: baseY - 1, minU: baseX, maxU: maxX, minV: baseZ, maxV: maxZ },
      { axis: "y", coordinate: maxY + 1, minU: baseX, maxU: maxX, minV: baseZ, maxV: maxZ },
      { axis: "z", coordinate: baseZ - 1, minU: baseX, maxU: maxX, minV: baseY, maxV: maxY },
      { axis: "z", coordinate: maxZ + 1, minU: baseX, maxU: maxX, minV: baseY, maxV: maxY },
    ];

    for (const face of faces) {
      const containing = candidates.filter(other => {
        const otherScale = 2 ** other.chunk.level;
        const ox = other.chunk.x * otherScale;
        const oy = other.chunk.y * otherScale;
        const oz = other.chunk.z * otherScale;
        const otherMaxX = ox + otherScale - 1;
        const otherMaxY = oy + otherScale - 1;
        const otherMaxZ = oz + otherScale - 1;

        if (face.axis === "x") {
          return (
            (face.coordinate === ox || face.coordinate === otherMaxX + 1) &&
            face.minU <= otherMaxY && face.maxU >= oy &&
            face.minV <= otherMaxZ && face.maxV >= oz
          );
        }

        if (face.axis === "y") {
          return (
            (face.coordinate === oy || face.coordinate === otherMaxY + 1) &&
            face.minU <= otherMaxX && face.maxU >= ox &&
            face.minV <= otherMaxZ && face.maxV >= oz
          );
        }

        return (
          (face.coordinate === oz || face.coordinate === otherMaxZ + 1) &&
          face.minU <= otherMaxX && face.maxU >= ox &&
          face.minV <= otherMaxY && face.maxV >= oy
        );
      });

      if (containing.length) {
        for (const other of containing) {
          const relation: InfinityScaleBoundaryRelation =
            other.chunk.level === level
              ? "same-level"
              : level < other.chunk.level
                ? "fine-to-coarse"
                : "coarse-to-fine";
          const key = `${other.key}|${relation}`;
          out.set(key, {
            sourceChunk: chunk.key,
            targetChunk: other.key,
            relation,
          });
        }
        continue;
      }

      // No explicit frame chunk owns this face. Request the logical same-level
      // halo at the face coordinate. floorDiv semantics are required for
      // negative coordinates so -1 maps to chunk -1 rather than zero.
      const floorDiv = (value: number, divisor: number): number =>
        Math.floor(value / divisor);

      let nx = chunk.chunk.x;
      let ny = chunk.chunk.y;
      let nz = chunk.chunk.z;

      if (face.axis === "x") nx = floorDiv(face.coordinate, scale);
      if (face.axis === "y") ny = floorDiv(face.coordinate, scale);
      if (face.axis === "z") nz = floorDiv(face.coordinate, scale);

      const targetChunk = `${level}:${nx},${ny},${nz}`;
      out.set(`${targetChunk}|same-level`, {
        sourceChunk: chunk.key,
        targetChunk,
        relation: "same-level",
      });
    }

    return [...out.values()];
  }

  getPlan(): InfinityScaleExecutionPlan {
    return {
      ...this.plan,
      observer: { ...this.plan.observer },
      chunks: this.plan.chunks.map(chunk => ({ ...chunk })),
      boundaryReadChunks: [...this.plan.boundaryReadChunks],
      boundaryReadRelations: this.plan.boundaryReadRelations.map(relation => ({ ...relation })),
    };
  }

  isSimulationChunk(key: string): boolean {
    return this.plan.chunks.some(chunk => chunk.key === key);
  }
}
