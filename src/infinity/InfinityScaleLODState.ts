import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODTransfer } from "./InfinityScaleLODTransfer";

export interface InfinityScaleLODChunkState {
  key: string;
  level: number;
  scale: number;
  cells: Float32Array;
}

/**
 * Hierarchical state store for Infinity Scale LOD chunks.
 *
 * Every logical chunk contains chunkSize^3 simulation cells at its own
 * resolution. A level-N cell covers 2^N base-resolution cells along each
 * axis. This is deliberately separate from SparseVoxelGrid: dense storage
 * remains the level-0 execution substrate until a layer explicitly opts into
 * hierarchical state.
 */
export class InfinityScaleLODState {
  private readonly states = new Map<string, InfinityScaleLODChunkState>();

  constructor(readonly chunkSize = 32) {}

  ensureChunk(key: string, level: number): InfinityScaleLODChunkState {
    const existing = this.states.get(key);
    if (existing) {
      if (existing.level !== level) {
        throw new Error(`Infinity Scale LOD chunk level mismatch for ${key}`);
      }
      return existing;
    }

    if (!Number.isInteger(level) || level < 0 || level > 30) {
      throw new Error(`Invalid Infinity Scale LOD level: ${level}`);
    }

    const scale = 2 ** level;
    const state: InfinityScaleLODChunkState = {
      key,
      level,
      scale,
      cells: new Float32Array(this.chunkSize ** 3 * CELL_FIELDS),
    };
    this.states.set(key, state);
    return state;
  }

  getChunk(key: string): InfinityScaleLODChunkState | undefined {
    return this.states.get(key);
  }

  hasChunk(key: string): boolean {
    return this.states.has(key);
  }

  deleteChunk(key: string): boolean {
    return this.states.delete(key);
  }

  clear(): void {
    this.states.clear();
  }

  keys(): string[] {
    return [...this.states.keys()];
  }

  /**
   * Reads the hierarchical cell corresponding to a base-resolution coordinate.
   */
  readBaseCell(
    key: string,
    level: number,
    baseX: number,
    baseY: number,
    baseZ: number,
  ): Float32Array {
    const state = this.ensureChunk(key, level);
    const [cx, cy, cz] = parseChunkKey(key);
    const scale = state.scale;

    const originX = cx * this.chunkSize * scale;
    const originY = cy * this.chunkSize * scale;
    const originZ = cz * this.chunkSize * scale;

    const lx = Math.floor((baseX - originX) / scale);
    const ly = Math.floor((baseY - originY) / scale);
    const lz = Math.floor((baseZ - originZ) / scale);

    if (
      lx < 0 || lx >= this.chunkSize ||
      ly < 0 || ly >= this.chunkSize ||
      lz < 0 || lz >= this.chunkSize
    ) {
      throw new Error(`Base coordinate is outside LOD chunk ${key}`);
    }

    const out = new Float32Array(CELL_FIELDS);
    const offset = ((lz * this.chunkSize * this.chunkSize) +
      (ly * this.chunkSize) + lx) * CELL_FIELDS;
    out.set(state.cells.subarray(offset, offset + CELL_FIELDS));
    return out;
  }

  writeBaseCell(
    key: string,
    level: number,
    baseX: number,
    baseY: number,
    baseZ: number,
    source: ReadonlyArray<number>,
  ): void {
    if (source.length !== CELL_FIELDS) {
      throw new Error(`Infinity Scale LOD cell requires ${CELL_FIELDS} fields`);
    }

    const state = this.ensureChunk(key, level);
    const [cx, cy, cz] = parseChunkKey(key);
    const scale = state.scale;

    const originX = cx * this.chunkSize * scale;
    const originY = cy * this.chunkSize * scale;
    const originZ = cz * this.chunkSize * scale;

    const lx = Math.floor((baseX - originX) / scale);
    const ly = Math.floor((baseY - originY) / scale);
    const lz = Math.floor((baseZ - originZ) / scale);

    if (
      lx < 0 || lx >= this.chunkSize ||
      ly < 0 || ly >= this.chunkSize ||
      lz < 0 || lz >= this.chunkSize
    ) {
      throw new Error(`Base coordinate is outside LOD chunk ${key}`);
    }

    const offset = ((lz * this.chunkSize * this.chunkSize) +
      (ly * this.chunkSize) + lx) * CELL_FIELDS;
    state.cells.set(source, offset);
  }

  /**
   * Restricts a complete fine cell block into one coarse LOD cell.
   */
  restrictCellBlock(
    sourceCells: ReadonlyArray<ReadonlyArray<number>>,
    target: number[],
    sourceLevel: number,
    targetLevel: number,
  ): void {
    InfinityScaleLODTransfer.restrict(
      sourceCells,
      target,
      sourceLevel,
      targetLevel,
    );
  }

  /**
   * Prolongates one coarse cell into its complete fine child block.
   */
  prolongateCellBlock(
    source: ReadonlyArray<number>,
    targets: Array<number[]>,
    sourceLevel: number,
    targetLevel: number,
  ): void {
    InfinityScaleLODTransfer.prolongate(
      source,
      targets,
      sourceLevel,
      targetLevel,
    );
  }
}

function parseChunkKey(key: string): [number, number, number] {
  const match = /^(?:\d+):(-?\d+),(-?\d+),(-?\d+)$/.exec(key);
  if (!match) throw new Error(`Invalid Infinity Scale chunk key: ${key}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
