import type { SparseVoxelGrid } from '../core/SparseVoxelGrid';
import { BrushEngine } from './BrushEngine';
import type { BrushFalloff, BrushFields, BrushStroke, SculptToolId } from './SculptTool';

export interface SculptBrushSettings {
  radius: number;
  strength: number;
  falloff: BrushFalloff;
  fields: BrushFields;
  noiseScale: number;
  seed: number;
}

export class SculptManager {
  readonly brushEngine: BrushEngine;
  currentBrush: SculptBrushSettings = {
    radius: 8,
    strength: 1,
    falloff: 'smooth',
    noiseScale: 10,
    seed: 1337,
    fields: {
      energy: 1,
      density: 0.5,
      temperature: 0,
      bio: 0,
      information: 0,
      entropy: 0,
    },
  };
  lastStroke: BrushStroke | null = null;

  constructor(grid: SparseVoxelGrid, private onChanged?: () => void) {
    this.brushEngine = new BrushEngine(grid);
  }

  async onMouseDrag(
    worldPos: [number, number, number],
    tool: SculptToolId,
    options: { materialId?: number; layer?: string; additive?: boolean } = {},
  ): Promise<BrushStroke> {
    const stroke: BrushStroke = {
      tool: options.additive === false ? 'erase' : tool,
      position: worldPos,
      radius: this.currentBrush.radius,
      strength: this.currentBrush.strength,
      falloff: this.currentBrush.falloff,
      parameters: {
        fields: { ...this.currentBrush.fields },
        materialId: options.materialId,
        noiseScale: this.currentBrush.noiseScale,
        seed: this.currentBrush.seed,
        layer: options.layer,
      },
      affectedChunks: [],
    };

    this.lastStroke = await this.brushEngine.applyStroke(stroke);
    this.onChanged?.();
    return this.lastStroke;
  }

  setSingleLayer(layer: string, strength: number): void {
    this.currentBrush.fields = {
      energy: layer === 'energy' ? 1 : 0,
      density: layer === 'density' ? 1 : 0,
      temperature: layer === 'temperature' ? 1 : 0,
      bio: layer === 'bioPotential' ? 1 : 0,
      information: layer === 'information' ? 1 : 0,
      entropy: layer === 'entropy' ? 1 : 0,
    };
    this.currentBrush.strength = strength;
  }

  undo(): BrushStroke | null {
    const stroke = this.brushEngine.undo();
    if (stroke) this.onChanged?.();
    return stroke;
  }

  redo(): BrushStroke | null {
    const stroke = this.brushEngine.redo();
    if (stroke) this.onChanged?.();
    return stroke;
  }
}
