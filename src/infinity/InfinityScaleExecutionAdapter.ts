import type { InfinityScaleFramePlan } from "./InfinityScaleFramePlan";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type {
  InfinityScaleBoundaryRelation,
  InfinityScaleBoundaryReadRelation,
} from "./InfinityScaleChunkExecutionContext";
import { WORLD } from "../core/WorldConstants";
import { resolveInfinityScaleBoundaryFaceGeometry } from "./InfinityScaleLODBoundaryCellMapper";
import { resolveInfinityScaleBoundaryFaceGeometry } from "./InfinityScaleLODBoundaryCellMapper";

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
    const coveredFaces = new Set<string>();
    const level = chunk.chunk.level;
    const scale = 2 ** level;
    const minX = chunk.chunk.x * scale;
    const minY = chunk.chunk.y * scale;
    const minZ = chunk.chunk.z * scale;
    const maxX = minX + scale - 1;
    const maxY = minY + scale - 1;
    const maxZ = minZ + scale - 1;

    const faceKey = (axis: 0 | 1 | 2, coordinate: number): string =>
      `${axis}:${coordinate}`;

    // Neighbor discovery remains an adapter concern, but shared-face geometry
    // is delegated to the canonical LOD boundary resolver. This prevents the
    // execution planner from maintaining a second coarse/fine face definition.
    for (const other of candidates) {
      if (other.key === chunk.key) continue;

      const relation: InfinityScaleBoundaryRelation =
        other.chunk.level === level
          ? "same-level"
          : level < other.chunk.level
            ? "fine-to-coarse"
            : "coarse-to-fine";

      const spec = {
        sourceChunk: chunk.key,
        targetChunk: other.key,
        relation,
        sourceLevel: level,
        targetLevel: other.chunk.level,
        refinementRatio: 2 ** Math.abs(level - other.chunk.level),
        operation:
          relation === "same-level"
            ? "copy"
            : relation === "coarse-to-fine"
              ? "prolongation"
              : "restriction",
        readOperation:
          relation === "same-level"
            ? "copy"
            : relation === "coarse-to-fine"
              ? "restriction"
              : "prolongation",
      } as const;

      const face = resolveInfinityScaleBoundaryFaceGeometry(spec, 32);
      if (face === null) continue;

      coveredFaces.add(faceKey(face.axis, face.coordinate));
      const key = `${other.key}|${relation}`;
      out.set(key, {
        sourceChunk: chunk.key,
        targetChunk: other.key,
        relation,
      });
    }

    // No explicit frame chunk owns a face. Request the logical same-level
    // halo only for uncovered faces. Negative chunk coordinates are preserved
    // directly; this is equivalent to floorDiv for a one-chunk step.
    const fallbackFaces: Array<{
      key: string;
      targetChunk: string;
    }> = [
      { key: faceKey(0, minX - 1), targetChunk: `${level}:${chunk.chunk.x - 1},${chunk.chunk.y},${chunk.chunk.z}` },
      { key: faceKey(0, maxX + 1), targetChunk: `${level}:${chunk.chunk.x + 1},${chunk.chunk.y},${chunk.chunk.z}` },
      { key: faceKey(1, minY - 1), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y - 1},${chunk.chunk.z}` },
      { key: faceKey(1, maxY + 1), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y + 1},${chunk.chunk.z}` },
      { key: faceKey(2, minZ - 1), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y},${chunk.chunk.z - 1}` },
      { key: faceKey(2, maxZ + 1), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y},${chunk.chunk.z + 1}` },
    ];

    for (const fallback of fallbackFaces) {
      if (coveredFaces.has(fallback.key)) continue;
      out.set(`${fallback.targetChunk}|same-level`, {
        sourceChunk: chunk.key,
        targetChunk: fallback.targetChunk,
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
