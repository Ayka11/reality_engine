import type { SparseVoxelGrid } from '../core/SparseVoxelGrid';

export type SculptToolId = 'inject' | 'erase' | 'noise' | 'stamp' | 'erode' | 'smooth' | 'pattern';
export type BrushFalloff = 'linear' | 'smooth' | 'sphere' | 'sharp';

export interface BrushFields {
  energy: number;
  density: number;
  temperature: number;
  bio: number;
  information: number;
  entropy: number;
}

export interface BrushStroke {
  tool: SculptToolId;
  position: [number, number, number];
  radius: number;
  strength: number;
  falloff: BrushFalloff;
  parameters: Record<string, unknown> & {
    fields?: Partial<BrushFields>;
    materialId?: number;
    seed?: number;
    noiseScale?: number;
    layer?: string;
  };
  affectedChunks: string[];
}

export interface SculptTool {
  id: SculptToolId;
  label: string;
  apply(context: SculptToolContext): void;
}

export interface SculptToolContext {
  grid: SparseVoxelGrid;
  stroke: BrushStroke;
  x: number;
  y: number;
  z: number;
  distance: number;
  weight: number;
}

export interface CellEdit {
  offset: number;
  before: Float32Array;
  after: Float32Array;
}

export interface StrokeRecord {
  stroke: BrushStroke;
  edits: CellEdit[];
}
