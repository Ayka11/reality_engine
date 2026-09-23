import type { ChunkKey, ChunkState, Vec3i } from "../InfinityScaleV2";

export interface InfinityScaleChunkPlan {
  key: string;
  chunk: ChunkKey;
  state: ChunkState;
  lod: number;
  amr: number;
  pinned: boolean;
  distance: number;
  simulationEligible: boolean;
  renderEligible: boolean;
}

export interface InfinityScaleFramePlan {
  observer: Vec3i;
  chunks: InfinityScaleChunkPlan[];
  simulating: string[];
  visible: string[];
  background: string[];
  cached: string[];
  unloaded: string[];
  residentCount: number;
  simulationCount: number;
  visibleCount: number;
  maxSimulatingChunks: number;
  maxResidentChunks: number;
  revision: number;
  generatedAt: number;
}
