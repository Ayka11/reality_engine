import { CellState, CELL_FIELDS } from './CellState';

export const CHUNK_SIZE = 32;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  buffer: Float32Array;
  backBuffer: Float32Array;
  active = true;
  lastAccessed = Date.now();

  constructor(cx: number, cy: number, cz: number) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.buffer = new Float32Array(CHUNK_VOLUME * CELL_FIELDS);
    this.backBuffer = new Float32Array(CHUNK_VOLUME * CELL_FIELDS);
  }

  localIdx(lx: number, ly: number, lz: number): number {
    return ((lz * CHUNK_SIZE + ly) * CHUNK_SIZE + lx) * CELL_FIELDS;
  }

  getCell(lx: number, ly: number, lz: number): CellState {
    this.lastAccessed = Date.now();
    return new CellState(this.buffer, this.localIdx(lx, ly, lz));
  }

  snapshot(): void {
    this.backBuffer.set(this.buffer);
  }

  swapBuffers(): void {
    const tmp = this.buffer;
    this.buffer = this.backBuffer;
    this.backBuffer = tmp;
  }

  isEmpty(threshold = 0.0001): boolean {
    for (let i = 0; i < this.buffer.length; i += CELL_FIELDS) {
      if (Math.abs(this.buffer[i]) > threshold) return false;
    }
    return true;
  }

  memoryBytes(): number {
    return this.buffer.byteLength + this.backBuffer.byteLength;
  }
}
