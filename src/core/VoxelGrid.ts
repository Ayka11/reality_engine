import { CellState, CELL_FIELDS } from "./CellState";
import { createTrackedFloat32Array, INTERNAL_MUTABLE_BUFFER, type MutableBufferSide } from "./TrackedFloat32Array";

export class VoxelGrid {
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly size: number;
  private _buffer: Float32Array;
  private _backBuffer: Float32Array;
  private _bufferView: Float32Array;
  private _backBufferView: Float32Array;
  private mutationDepth = 0;
  private mutationPending = false;
  private _mutationRevision = 0;

  constructor(W: number, H: number, D: number) {
    this.W = W; this.H = H; this.D = D; this.size = W * H * D;
    this._buffer = new Float32Array(this.size * CELL_FIELDS);
    this._backBuffer = new Float32Array(this.size * CELL_FIELDS);
    this._bufferView = createTrackedFloat32Array(this._buffer, () => this.markMutation());
    this._backBufferView = createTrackedFloat32Array(this._backBuffer, () => this.markMutation());
  }
  get buffer(): Float32Array { return this._bufferView; }
  set buffer(value: Float32Array) { this.assertBuffer(value); this._buffer.set(value); this.markMutation(); }
  get backBuffer(): Float32Array { return this._backBufferView; }
  set backBuffer(value: Float32Array) { this.assertBuffer(value); this._backBuffer.set(value); this.markMutation(); }
  get mutationRevision(): number { return this._mutationRevision; }

  beginMutation(): () => void {
    this.mutationDepth++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.mutationDepth--;
      if (this.mutationDepth === 0 && this.mutationPending) {
        this.mutationPending = false;
        this._mutationRevision++;
      }
    };
  }
  markMutation(): void {
    if (this.mutationDepth > 0) { this.mutationPending = true; return; }
    this._mutationRevision++;
  }
  [INTERNAL_MUTABLE_BUFFER](side: MutableBufferSide = "front"): Float32Array {
    this.markMutation();
    return side === "back" ? this._backBuffer : this._buffer;
  }
  private assertBuffer(value: Float32Array): void {
    if (!(value instanceof Float32Array) || value.length !== this.size * CELL_FIELDS) {
      throw new Error("VoxelGrid buffer length does not match the grid dimensions");
    }
  }

  idx(x: number, y: number, z: number): number { return (z * this.H * this.W + y * this.W + x) * CELL_FIELDS; }
  inBounds(x: number, y: number, z: number): boolean { return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D; }
  cell(x: number, y: number, z: number): CellState {
    return new CellState(this._buffer, this.idx(x, y, z), () => this.markMutation());
  }
  cellAt(linearIdx: number): CellState {
    return new CellState(this._buffer, linearIdx * CELL_FIELDS, () => this.markMutation());
  }
  cellBack(x: number, y: number, z: number): CellState {
    return new CellState(this._backBuffer, this.idx(x, y, z), () => this.markMutation());
  }
  swapBuffers(): void {
    const raw = this._buffer; this._buffer = this._backBuffer; this._backBuffer = raw;
    const view = this._bufferView; this._bufferView = this._backBufferView; this._backBufferView = view;
    this.markMutation();
  }
  snapshot(): void {
    const end = this.beginMutation();
    try { this._backBuffer.set(this._buffer); this.markMutation(); } finally { end(); }
  }
  neighbors6(x: number, y: number, z: number): Array<[number, number, number]> {
    const result: Array<[number, number, number]> = [];
    const dirs: Array<[number, number, number]> = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.inBounds(nx, ny, nz)) result.push([nx, ny, nz]);
    }
    return result;
  }
  clear(): void {
    const end = this.beginMutation();
    try { this._buffer.fill(0); this._backBuffer.fill(0); this.markMutation(); } finally { end(); }
  }
  totalField(fieldOffset: number): number {
    let sum = 0;
    for (let i = fieldOffset; i < this._buffer.length; i += CELL_FIELDS) sum += this._buffer[i];
    return sum;
  }
}
