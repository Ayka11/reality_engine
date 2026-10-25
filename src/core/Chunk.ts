import { CellState, CELL_FIELDS } from "./CellState";
import { createTrackedFloat32Array, INTERNAL_MUTABLE_BUFFER, type MutableBufferSide } from "./TrackedFloat32Array";

export const CHUNK_SIZE = 32;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  private _buffer: Float32Array;
  private _backBuffer: Float32Array;
  private _bufferView: Float32Array;
  private _backBufferView: Float32Array;
  private mutationListeners = new Set<() => void>();
  private _active = true;
  lastAccessed = Date.now();

  constructor(cx: number, cy: number, cz: number) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    this._buffer = new Float32Array(CHUNK_VOLUME * CELL_FIELDS);
    this._backBuffer = new Float32Array(CHUNK_VOLUME * CELL_FIELDS);
    this._bufferView = createTrackedFloat32Array(this._buffer, () => this.markMutation());
    this._backBufferView = createTrackedFloat32Array(this._backBuffer, () => this.markMutation());
  }

  get buffer(): Float32Array { return this._bufferView; }
  set buffer(value: Float32Array) { this.assertBuffer(value); this._buffer.set(value); this.markMutation(); }
  get backBuffer(): Float32Array { return this._backBufferView; }
  set backBuffer(value: Float32Array) { this.assertBuffer(value); this._backBuffer.set(value); this.markMutation(); }
  get active(): boolean { return this._active; }
  set active(value: boolean) { if (this._active !== value) { this._active = value; this.markMutation(); } }

  addMutationListener(listener: () => void): void { this.mutationListeners.add(listener); }
  removeMutationListener(listener: () => void): void { this.mutationListeners.delete(listener); }
  private assertBuffer(value: Float32Array): void {
    if (!(value instanceof Float32Array) || value.length !== CHUNK_VOLUME * CELL_FIELDS) {
      throw new Error("Chunk buffer must be a Float32Array with the canonical chunk size");
    }
  }
  private markMutation(): void { for (const listener of this.mutationListeners) listener(); }

  [INTERNAL_MUTABLE_BUFFER](side: MutableBufferSide = "front"): Float32Array {
    this.markMutation();
    return side === "back" ? this._backBuffer : this._buffer;
  }

  localIdx(lx: number, ly: number, lz: number): number {
    return ((lz * CHUNK_SIZE + ly) * CHUNK_SIZE + lx) * CELL_FIELDS;
  }
  getCell(lx: number, ly: number, lz: number): CellState {
    this.lastAccessed = Date.now();
    return new CellState(this._buffer, this.localIdx(lx, ly, lz), () => this.markMutation());
  }
  snapshot(): void { this._backBuffer.set(this._buffer); this.markMutation(); }
  swapBuffers(): void {
    const raw = this._buffer; this._buffer = this._backBuffer; this._backBuffer = raw;
    const view = this._bufferView; this._bufferView = this._backBufferView; this._backBufferView = view;
    this.markMutation();
  }
  isEmpty(threshold = 0.0001): boolean {
    for (let i = 0; i < this._buffer.length; i += CELL_FIELDS) {
      for (let field = 0; field < CELL_FIELDS; field++) {
        if (Math.abs(this._buffer[i + field]) > threshold) return false;
      }
    }
    return true;
  }
  memoryBytes(): number { return this._buffer.byteLength + this._backBuffer.byteLength; }
}
