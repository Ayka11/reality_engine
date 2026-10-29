import { CellState, CELL_FIELDS } from "./CellState";
import { createTrackedFloat32Array, INTERNAL_MUTABLE_BUFFER, type MutableBufferSide } from "./TrackedFloat32Array";

export const CHUNK_SIZE = 32;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;

export class Chunk {
  readonly cx!: number;
  readonly cy!: number;
  readonly cz!: number;
  private _buffer: Float32Array;
  private _backBuffer: Float32Array;
  private _bufferView: Float32Array;
  private _backBufferView: Float32Array;
  private mutationListeners = new Set<() => void>();
  private _active = true;
  private _lastAccessed = Date.now();

  get lastAccessed(): number { return this._lastAccessed; }
  set lastAccessed(value: number) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("Chunk.lastAccessed must be a finite non-negative timestamp");
    }
    if (value !== this._lastAccessed) {
      this._lastAccessed = value;
      this.markMutation();
    }
  }

  constructor(cx: number, cy: number, cz: number) {
    // TypeScript readonly is erased at runtime. Spatial identity must stay
    // immutable because the owning grid's map key is derived from these fields.
    Object.defineProperties(this, {
      cx: { value: cx, enumerable: true, writable: false, configurable: false },
      cy: { value: cy, enumerable: true, writable: false, configurable: false },
      cz: { value: cz, enumerable: true, writable: false, configurable: false },
    });
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
  set active(value: boolean) {
    if (typeof value !== "boolean") {
      throw new TypeError("Chunk.active must be a boolean");
    }
    if (this._active !== value) {
      this._active = value;
      this.markMutation();
    }
  }

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
    // Treat LRU refresh as internal access bookkeeping, not a field/topology mutation.
    // Explicit external writes still go through the revision-tracked setter above.
    const accessTime = Date.now();
    if (accessTime > this._lastAccessed) this._lastAccessed = accessTime;
    return new CellState(this._buffer, this.localIdx(lx, ly, lz), () => this.markMutation());
  }
  /**
   * Copy a range from the authoritative front buffer into a caller-owned target.
   * The internal source view never escapes; the caller remains responsible for
   * tracking any mutation to its own destination buffer.
   */
  copyFrontRangeTo(
    target: Float32Array,
    sourceOffset: number,
    targetOffset: number,
    length: number,
  ): void {
    if (!(target instanceof Float32Array) ||
        !Number.isSafeInteger(sourceOffset) || sourceOffset < 0 ||
        !Number.isSafeInteger(targetOffset) || targetOffset < 0 ||
        !Number.isSafeInteger(length) || length < 0 ||
        sourceOffset + length > this._buffer.length ||
        targetOffset + length > target.length) {
      throw new RangeError("Chunk front-buffer copy range is invalid");
    }
    target.set(this._buffer.subarray(sourceOffset, sourceOffset + length), targetOffset);
  }

  /** Copy the current front buffer to back without exposing internal typed arrays. */
  copyFrontToBackBuffer(): void {
    this._backBuffer.set(this._buffer);
    this.markMutation();
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
