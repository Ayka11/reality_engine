import { CELL_FIELDS } from '../core/CellState';
import type { Chunk } from '../core/Chunk';
import { CHUNK_SIZE } from '../core/Chunk';
import type { SparseVoxelGrid } from '../core/SparseVoxelGrid';
import type { BrushFalloff, BrushStroke, SculptTool, SculptToolId, StrokeRecord } from './SculptTool';
import { ErodeTool } from './tools/Erode';
import { EraseTool } from './tools/Erase';
import { InjectTool } from './tools/Inject';
import { NoiseTool } from './tools/Noise';
import { PatternTool } from './tools/Pattern';
import { SmoothTool } from './tools/Smooth';
import { StampTool } from './tools/Stamp';

function chunkCoord(g: number): number {
  return Math.floor(g / CHUNK_SIZE);
}

function falloffWeight(kind: BrushFalloff, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (kind === 'sharp') return clamped > 0 ? 1 : 0;
  if (kind === 'linear') return clamped;
  if (kind === 'sphere') return Math.sqrt(clamped);
  return clamped * clamped * (3 - 2 * clamped);
}

export class BrushEngine {
  private tools = new Map<SculptToolId, SculptTool>();
  private history: StrokeRecord[] = [];
  private redoStack: StrokeRecord[] = [];
  private maxHistory = 50;

  constructor(private grid: SparseVoxelGrid) {
    for (const tool of [
      new InjectTool(),
      new EraseTool(),
      new NoiseTool(),
      new SmoothTool(),
      new ErodeTool(),
      new StampTool(),
      new PatternTool(),
    ]) this.tools.set(tool.id, tool);
  }

  async applyStroke(stroke: BrushStroke): Promise<BrushStroke> {
    const chunks = this.getAffectedChunks(stroke);
    stroke.affectedChunks = chunks.map(chunk => this.grid.getChunkKey(chunk.cx, chunk.cy, chunk.cz));
    const tool = this.tools.get(stroke.tool) ?? this.tools.get('inject')!;
    const edits = new Map<number, { before: Float32Array; after: Float32Array }>();
    const [cx, cy, cz] = stroke.position;
    const radius = Math.max(0.5, stroke.radius);

    const minX = Math.floor(cx - radius);
    const maxX = Math.ceil(cx + radius);
    const minY = Math.floor(cy - radius);
    const maxY = Math.ceil(cy + radius);
    const minZ = Math.floor(cz - radius);
    const maxZ = Math.ceil(cz + radius);

    for (let z = minZ; z <= maxZ; z++)
    for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      if (!this.grid.inBounds(x, y, z)) continue;
      const dx = x - cx, dy = y - cy, dz = z - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > radius) continue;
      const offset = this.grid.idx(x, y, z);
      const before = this.grid.buffer.slice(offset, offset + CELL_FIELDS);
      const weight = falloffWeight(stroke.falloff, 1 - dist / radius);
      tool.apply({ grid: this.grid, stroke, x, y, z, distance: dist, weight });
      const after = this.grid.buffer.slice(offset, offset + CELL_FIELDS);
      if (!edits.has(offset)) edits.set(offset, { before, after });
      else edits.get(offset)!.after = after;
    }

    this.grid.syncDenseToChunks();
    this.grid.markChunksDirty(stroke.affectedChunks);
    this.history.push({
      stroke: { ...stroke, affectedChunks: [...stroke.affectedChunks] },
      edits: [...edits.entries()].map(([offset, edit]) => ({ offset, before: edit.before, after: edit.after })),
    });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack = [];
    return stroke;
  }

  undo(): BrushStroke | null {
    const record = this.history.pop();
    if (!record) return null;
    for (const edit of record.edits) this.grid.buffer.set(edit.before, edit.offset);
    this.grid.syncDenseToChunks();
    this.grid.markChunksDirty(record.stroke.affectedChunks);
    this.redoStack.push(record);
    return record.stroke;
  }

  redo(): BrushStroke | null {
    const record = this.redoStack.pop();
    if (!record) return null;
    for (const edit of record.edits) this.grid.buffer.set(edit.after, edit.offset);
    this.grid.syncDenseToChunks();
    this.grid.markChunksDirty(record.stroke.affectedChunks);
    this.history.push(record);
    return record.stroke;
  }

  get historyLength(): number {
    return this.history.length;
  }

  get redoLength(): number {
    return this.redoStack.length;
  }

  private getAffectedChunks(stroke: BrushStroke): Chunk[] {
    const [x, y, z] = stroke.position;
    const r = Math.max(1, stroke.radius);
    const minCx = chunkCoord(x - r);
    const maxCx = chunkCoord(x + r);
    const minCy = chunkCoord(y - r);
    const maxCy = chunkCoord(y + r);
    const minCz = chunkCoord(z - r);
    const maxCz = chunkCoord(z + r);
    const chunks: Chunk[] = [];

    for (let cz = minCz; cz <= maxCz; cz++)
    for (let cy = minCy; cy <= maxCy; cy++)
    for (let cx = minCx; cx <= maxCx; cx++) {
      chunks.push(this.grid.getOrCreateChunk(cx, cy, cz));
    }

    return chunks;
  }
}
