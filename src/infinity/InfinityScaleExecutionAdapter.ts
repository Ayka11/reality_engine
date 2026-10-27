import type { InfinityScaleFramePlan } from "./InfinityScaleFramePlan";
import { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type {
  InfinityScaleBoundaryRelation,
  InfinityScaleBoundaryReadRelation,
} from "./InfinityScaleChunkExecutionContext";
import { WORLD } from "../core/WorldConstants";
import { parseInfinityScaleChunkKey } from "./InfinityScaleChunkKey";
import { validateIndependentMixedLodTopology } from "./InfinityScaleIndependentTopology";

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
  /** True only when chunk-aware entity reconciliation is wired to the runtime transaction. */
  entityExecutionReady: boolean;
  /** True only when agent migration is integrated with the authoritative runtime transaction. */
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
    selectiveCpuReady: false,
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
      mode: "advisory",
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
      entityExecutionReady: false,
      agentMigrationReady: false,
    };

  }

  update(
    frame: InfinityScaleFramePlan,
    capabilities: InfinityScaleExecutionCapabilities = this.capabilities,
  ): InfinityScaleExecutionPlan {
    const nextCapabilities = { ...capabilities };

    // Frame geometry is represented twice (canonical key and decoded chunk
    // coordinates); reject any disagreement before touching adapter state.
    for (const candidate of frame.chunks) {
      const parsed = parseInfinityScaleChunkKey(candidate.key);
      if (
        !candidate.chunk ||
        candidate.chunk.level !== parsed.level ||
        candidate.chunk.x !== parsed.x ||
        candidate.chunk.y !== parsed.y ||
        candidate.chunk.z !== parsed.z ||
        candidate.lod !== parsed.level
      ) {
        throw new Error(`Infinity Scale frame chunk identity/LOD mismatch for ${candidate.key}`);
      }
    }

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
        boundaryReadKeys.add(dependency.sourceChunk);
        if (!simulationKeys.has(dependency.sourceChunk)) {
          boundaryReadRelations.push(dependency);
        }
      }
    }

    const topologyAudit = validateIndependentMixedLodTopology(
      selected,
      frame.chunks,
      boundaryReadRelations,
    );
    if (!topologyAudit.complete) {
      throw new Error(
        `Infinity Scale independent mixed-LOD topology mismatch: missing=[${topologyAudit.missing.join("; ")}], unexpected=[${topologyAudit.unexpected.join("; ")}]`,
      );
    }

    const geometry = new InfinityScaleChunkExecutionContext(
      {
        ...this.plan,
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
        nextCapabilities.lodBoundaryTransferReady &&
        nextCapabilities.mixedLodExecutionReady
      );

    const mode: InfinityScaleExecutionMode =
      lodBoundaryReady && nextCapabilities.selectiveGpuReady && nextCapabilities.gpuPhysicsReady
        ? "selective-gpu-ready"
        : lodBoundaryReady && nextCapabilities.selectiveCpuReady
          ? "selective-cpu-ready"
          : "advisory";

    const nextPlan: InfinityScaleExecutionPlan = {
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
      selectiveCpuReady: nextCapabilities.selectiveCpuReady,
      selectiveGpuReady: nextCapabilities.selectiveGpuReady,
      gpuPhysicsReady: nextCapabilities.gpuPhysicsReady,
      lodBoundaryTransferReady: nextCapabilities.lodBoundaryTransferReady,
      mixedLodExecutionReady: nextCapabilities.mixedLodExecutionReady,
      entityExecutionReady: false,
      agentMigrationReady: false,
    };

    // Failed topology/geometry validation must leave the previous plan and
    // capability declaration intact.
    this.capabilities = nextCapabilities;
    this.plan = nextPlan;
    return this.getPlan();
  }

  private resolveFaceNeighbors(
    chunk: InfinityScaleFramePlan["chunks"][number],
    candidates: InfinityScaleFramePlan["chunks"],
  ): InfinityScaleBoundaryReadRelation[] {
    const out = new Map<string, InfinityScaleBoundaryReadRelation>();
    type FaceRect = { minA: number; maxA: number; minB: number; maxB: number };
    const faceCoverage = new Map<string, FaceRect[]>();
    const level = chunk.chunk.level;
    // FramePlan chunk coordinates are level-local chunk indices. For adapter
    // topology, normalize each chunk into base-chunk units (not world cells).
    const scale = 2 ** level;
    const minX = chunk.chunk.x * scale;
    const minY = chunk.chunk.y * scale;
    const minZ = chunk.chunk.z * scale;
    const maxX = minX + scale - 1;
    const maxY = minY + scale - 1;
    const maxZ = minZ + scale - 1;

    const faceKey = (axis: 0 | 1 | 2, coordinate: number): string =>
      `${axis}:${coordinate}`;

    for (const other of candidates) {
      if (other.key === chunk.key) continue;

      const otherLevel = other.chunk.level;
      const otherScale = 2 ** otherLevel;
      const otherMinX = other.chunk.x * otherScale;
      const otherMinY = other.chunk.y * otherScale;
      const otherMinZ = other.chunk.z * otherScale;
      const otherMaxX = otherMinX + otherScale - 1;
      const otherMaxY = otherMinY + otherScale - 1;
      const otherMaxZ = otherMinZ + otherScale - 1;

      // Transfer direction is from the read dependency into the selected
      // simulation chunk, not from the selected chunk out to its neighbor.
      const relation: InfinityScaleBoundaryRelation =
        otherLevel === level
          ? "same-level"
          : otherLevel > level
            ? "coarse-to-fine"
            : "fine-to-coarse";

      const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) =>
        aMin <= bMax && aMax >= bMin;
      let axis: 0 | 1 | 2 | null = null;
      let coveredCoordinate: number | null = null;

      // Use base-chunk units consistently. Only face contact with overlap on
      // both tangential axes is accepted; edge/corner contact is rejected.
      if ((maxX + 1 === otherMinX || otherMaxX + 1 === minX) &&
          overlaps(minY, maxY, otherMinY, otherMaxY) &&
          overlaps(minZ, maxZ, otherMinZ, otherMaxZ)) {
        axis = 0;
        coveredCoordinate = maxX + 1 === otherMinX ? maxX + 1 : minX;
      } else if ((maxY + 1 === otherMinY || otherMaxY + 1 === minY) &&
          overlaps(minX, maxX, otherMinX, otherMaxX) &&
          overlaps(minZ, maxZ, otherMinZ, otherMaxZ)) {
        axis = 1;
        coveredCoordinate = maxY + 1 === otherMinY ? maxY + 1 : minY;
      } else if ((maxZ + 1 === otherMinZ || otherMaxZ + 1 === minZ) &&
          overlaps(minX, maxX, otherMinX, otherMaxX) &&
          overlaps(minY, maxY, otherMinY, otherMaxY)) {
        axis = 2;
        coveredCoordinate = maxZ + 1 === otherMinZ ? maxZ + 1 : minZ;
      }

      if (axis === null) continue;
      const coverageKey = faceKey(axis, coveredCoordinate!);
      const rect: FaceRect = axis === 0
        ? {
            minA: Math.max(minY, otherMinY),
            maxA: Math.min(maxY, otherMaxY),
            minB: Math.max(minZ, otherMinZ),
            maxB: Math.min(maxZ, otherMaxZ),
          }
        : axis === 1
          ? {
              minA: Math.max(minX, otherMinX),
              maxA: Math.min(maxX, otherMaxX),
              minB: Math.max(minZ, otherMinZ),
              maxB: Math.min(maxZ, otherMaxZ),
            }
          : {
              minA: Math.max(minX, otherMinX),
              maxA: Math.min(maxX, otherMaxX),
              minB: Math.max(minY, otherMinY),
              maxB: Math.min(maxY, otherMaxY),
            };
      const rectangles = faceCoverage.get(coverageKey) ?? [];
      rectangles.push(rect);
      faceCoverage.set(coverageKey, rectangles);
      const key = `${other.key}|${relation}`;
      out.set(key, {
        sourceChunk: other.key,
        targetChunk: chunk.key,
        relation,
      });
    }

    const faceIsFullyCovered = (
      key: string,
      minA: number,
      maxA: number,
      minB: number,
      maxB: number,
    ): boolean => {
      const rectangles = faceCoverage.get(key) ?? [];
      if (rectangles.length === 0) return false;
      // Coordinate compression checks the union of rectangles without
      // iterating every base-chunk unit (which can be large at high LOD).
      const aEdges = new Set<number>([minA, maxA + 1]);
      const bEdges = new Set<number>([minB, maxB + 1]);
      for (const rect of rectangles) {
        const a0 = Math.max(minA, rect.minA);
        const a1 = Math.min(maxA + 1, rect.maxA + 1);
        const b0 = Math.max(minB, rect.minB);
        const b1 = Math.min(maxB + 1, rect.maxB + 1);
        if (a0 < a1 && b0 < b1) {
          aEdges.add(a0);
          aEdges.add(a1);
          bEdges.add(b0);
          bEdges.add(b1);
        }
      }
      const as = [...aEdges].sort((a, b) => a - b);
      const bs = [...bEdges].sort((a, b) => a - b);
      for (let ai = 0; ai < as.length - 1; ai++) {
        for (let bi = 0; bi < bs.length - 1; bi++) {
          const a = as[ai];
          const b = bs[bi];
          if (a < minA || as[ai + 1] > maxA + 1 ||
              b < minB || bs[bi + 1] > maxB + 1) continue;
          if (!rectangles.some(rect =>
            rect.minA <= a && rect.maxA + 1 >= as[ai + 1] &&
            rect.minB <= b && rect.maxB + 1 >= bs[bi + 1]
          )) return false;
        }
      }
      return true;
    };

    const fallbackFaces: Array<{
      key: string;
      targetChunk: string;
      minA: number;
      maxA: number;
      minB: number;
      maxB: number;
    }> = [
      { key: faceKey(0, minX), targetChunk: `${level}:${chunk.chunk.x - 1},${chunk.chunk.y},${chunk.chunk.z}`, minA: minY, maxA: maxY, minB: minZ, maxB: maxZ },
      { key: faceKey(0, maxX + 1), targetChunk: `${level}:${chunk.chunk.x + 1},${chunk.chunk.y},${chunk.chunk.z}`, minA: minY, maxA: maxY, minB: minZ, maxB: maxZ },
      { key: faceKey(1, minY), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y - 1},${chunk.chunk.z}`, minA: minX, maxA: maxX, minB: minZ, maxB: maxZ },
      { key: faceKey(1, maxY + 1), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y + 1},${chunk.chunk.z}`, minA: minX, maxA: maxX, minB: minZ, maxB: maxZ },
      { key: faceKey(2, minZ), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y},${chunk.chunk.z - 1}`, minA: minX, maxA: maxX, minB: minY, maxB: maxY },
      { key: faceKey(2, maxZ + 1), targetChunk: `${level}:${chunk.chunk.x},${chunk.chunk.y},${chunk.chunk.z + 1}`, minA: minX, maxA: maxX, minB: minY, maxB: maxY },
    ];

    for (const fallback of fallbackFaces) {
      if (faceIsFullyCovered(
        fallback.key,
        fallback.minA,
        fallback.maxA,
        fallback.minB,
        fallback.maxB,
      )) continue;
      out.set(`${fallback.targetChunk}|same-level`, {
        sourceChunk: fallback.targetChunk,
        targetChunk: chunk.key,
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
