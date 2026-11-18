import { CELL_FIELDS } from '../core/CellState';
import type { Chunk } from '../core/Chunk';
import { CHUNK_SIZE } from '../core/Chunk';
import {
  applySparseVoxelGridDelta,
  createSparseVoxelGridDelta,
  type SparseVoxelGrid,
  type SparseVoxelGridDelta,
} from '../core/SparseVoxelGrid';
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

function assertSynchronousCustomStrokeCallback(callback: () => void): void {
  const callbackFunction = callback;
  const callbackKind = Object.prototype.toString.call(callbackFunction);
  const callbackPrototype = Object.getPrototypeOf(callbackFunction) as {
    constructor?: { name?: string };
  } | null;
  const callbackConstructorName = callbackPrototype?.constructor?.name ?? "";
  const callbackSource = Function.prototype.toString.call(callbackFunction);
  const asyncSource = /^\s*async\b/.test(callbackSource);
  const generatorSource = /^\s*(?:async\s+)?function\s*\*/.test(callbackSource) ||
    /^\s*\*\s*[\w$]*\s*\(/.test(callbackSource);
  const nativeSource = /\{\s*\[native code\]\s*\}/.test(callbackSource);

  // Reject async/generator callbacks before invoking them. Bound functions
  // stringify as native code, so fail closed rather than trust an opaque wrapper.
  if (callbackKind === "[object AsyncFunction]" ||
      callbackKind === "[object AsyncGeneratorFunction]" ||
      callbackKind === "[object GeneratorFunction]" ||
      callbackConstructorName === "AsyncFunction" ||
      callbackConstructorName === "AsyncGeneratorFunction" ||
      callbackConstructorName === "GeneratorFunction" ||
      asyncSource || generatorSource || nativeSource) {
    throw new TypeError("Custom sculpt callback must remain synchronous");
  }
}

function falloffWeight(kind: BrushFalloff, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (kind === 'sharp') return clamped > 0 ? 1 : 0;
  if (kind === 'linear') return clamped;
  if (kind === 'sphere') return Math.sqrt(clamped);
  return clamped * clamped * (3 - 2 * clamped);
}

function rollbackDenseAndChunks(
  grid: SparseVoxelGrid,
  restoreDense: () => void,
  originalError: unknown,
  context: string,
): never {
  try {
    restoreDense();
    // syncDenseToChunks is itself preflight-before-publish. Re-run it after
    // restoring dense state so a later commit-stage failure cannot leave the
    // sparse chunk mirror containing the rejected stroke.
    grid.syncDenseToChunks();
  } catch (rollbackError) {
    const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
    const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    throw new AggregateError(
      [originalError, rollbackError],
      `${context} failed (${originalMessage}) and dense/chunk rollback failed (${rollbackMessage})`,
    );
  }
  throw originalError;
}

function rollbackGridSnapshot(
  grid: SparseVoxelGrid,
  snapshot: ReturnType<SparseVoxelGrid["captureState"]>,
  originalError: unknown,
  context: string,
): never {
  try {
    grid.restoreState(snapshot);
  } catch (rollbackError) {
    const originalMessage = originalError instanceof Error ? originalError.message : String(originalError);
    const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    throw new AggregateError(
      [originalError, rollbackError],
      `${context} failed (${originalMessage}) and full sparse-grid rollback failed (${rollbackMessage})`,
    );
  }
  throw originalError;
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

  async applyCustomStroke(stroke: BrushStroke, apply: () => void): Promise<BrushStroke> {
    if (typeof apply !== "function") {
      throw new TypeError("Custom sculpt callback must be a function");
    }
    assertSynchronousCustomStrokeCallback(apply);
    // Custom callbacks are allowed to interact with sparse chunks as well as
    // the dense window. Capture the complete authoritative grid before chunk
    // discovery itself creates or activates any affected chunks.
    const beforeGrid = this.grid.captureState();
    const chunks = this.getAffectedChunks(stroke);
    stroke.affectedChunks = chunks.map(chunk => this.grid.getChunkKey(chunk.cx, chunk.cy, chunk.cz));
    let delta: SparseVoxelGridDelta;
    try {
      const result = (apply as unknown as () => unknown)();
      if (result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          typeof (result as { then?: unknown }).then === "function") {
        throw new TypeError("Custom sculpt callback must remain synchronous");
      }
      this.grid.syncDenseToChunks();
      this.grid.markChunksDirty(stroke.affectedChunks);
      const afterGrid = this.grid.captureState();
      delta = createSparseVoxelGridDelta(beforeGrid, afterGrid);
    } catch (error) {
      rollbackGridSnapshot(this.grid, beforeGrid, error, "Custom sculpt transaction");
    }

    // Retain only values/topology that actually changed, not full copies of
    // every dense buffer and sparse chunk in the world.
    this.history.push({
      stroke: { ...stroke, affectedChunks: [...stroke.affectedChunks] },
      edits: [],
      gridDelta: delta!,
    });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack = [];
    return stroke;
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

    try {
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
        edits.set(offset, { before, after: before.slice() });
        tool.apply({ grid: this.grid, stroke, x, y, z, distance: dist, weight });
        edits.get(offset)!.after = this.grid.buffer.slice(offset, offset + CELL_FIELDS);
      }
    } catch (error) {
      rollbackDenseAndChunks(
        this.grid,
        () => {
          for (const [offset, edit] of edits) this.grid.buffer.set(edit.before, offset);
        },
        error,
        "Sculpt tool apply",
      );
    }

    try {
      this.grid.syncDenseToChunks();
      this.grid.markChunksDirty(stroke.affectedChunks);
    } catch (error) {
      rollbackDenseAndChunks(
        this.grid,
        () => {
          for (const [offset, edit] of edits) this.grid.buffer.set(edit.before, offset);
        },
        error,
        "Sculpt stroke commit",
      );
    }

    this.history.push({
      stroke: { ...stroke, affectedChunks: [...stroke.affectedChunks] },
      edits: [...edits.entries()].map(([offset, edit]) => ({ offset, before: edit.before, after: edit.after })),
    });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.redoStack = [];
    return stroke;
  }

  undo(): BrushStroke | null {
    const record = this.history[this.history.length - 1];
    if (!record) return null;
    const currentGrid = record.gridDelta || record.fullGridBefore ? this.grid.captureState() : null;
    const current = currentGrid
      ? null
      : record.edits.map(edit => ({ offset: edit.offset, value: this.grid.buffer.slice(edit.offset, edit.offset + CELL_FIELDS) }));

    try {
      if (record.gridDelta) {
        this.grid.restoreState(applySparseVoxelGridDelta(currentGrid!, record.gridDelta, "before"));
      } else if (record.fullGridBefore) {
        this.grid.restoreState(record.fullGridBefore);
        record.fullGridBefore = undefined;
        record.fullGridAfter = currentGrid!;
      } else {
        for (const edit of record.edits) this.grid.buffer.set(edit.before, edit.offset);
        this.grid.syncDenseToChunks();
        this.grid.markChunksDirty(record.stroke.affectedChunks);
      }
    } catch (error) {
      if (currentGrid) {
        rollbackGridSnapshot(this.grid, currentGrid, error, "Sculpt undo");
      }
      rollbackDenseAndChunks(
        this.grid,
        () => {
          for (const item of (current ?? []) as Array<{ offset: number; value: Float32Array }>) this.grid.buffer.set(item.value, item.offset);
        },
        error,
        "Sculpt undo",
      );
    }

    this.history.pop();
    this.redoStack.push(record);
    return record.stroke;
  }

  redo(): BrushStroke | null {
    const record = this.redoStack[this.redoStack.length - 1];
    if (!record) return null;
    const currentGrid = record.gridDelta || record.fullGridAfter ? this.grid.captureState() : null;
    const current = currentGrid
      ? null
      : record.edits.map(edit => ({ offset: edit.offset, value: this.grid.buffer.slice(edit.offset, edit.offset + CELL_FIELDS) }));

    try {
      if (record.gridDelta) {
        this.grid.restoreState(applySparseVoxelGridDelta(currentGrid!, record.gridDelta, "after"));
      } else if (record.fullGridAfter) {
        this.grid.restoreState(record.fullGridAfter);
        record.fullGridAfter = undefined;
        record.fullGridBefore = currentGrid!;
      } else {
        for (const edit of record.edits) this.grid.buffer.set(edit.after, edit.offset);
        this.grid.syncDenseToChunks();
        this.grid.markChunksDirty(record.stroke.affectedChunks);
      }
    } catch (error) {
      if (currentGrid) {
        rollbackGridSnapshot(this.grid, currentGrid, error, "Sculpt redo");
      }
      rollbackDenseAndChunks(
        this.grid,
        () => {
          for (const item of (current ?? []) as Array<{ offset: number; value: Float32Array }>) this.grid.buffer.set(item.value, item.offset);
        },
        error,
        "Sculpt redo",
      );
    }

    this.redoStack.pop();
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
