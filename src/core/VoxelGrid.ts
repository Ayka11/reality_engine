import { CellState, CELL_FIELDS, validateGridDimensions } from "./CellState";
import { createTrackedFloat32Array, INTERNAL_MUTABLE_BUFFER, type MutableBufferSide } from "./TrackedFloat32Array";

interface VoxelGridStorage {
  buffer: Float32Array;
  backBuffer: Float32Array;
  bufferView: Float32Array;
  backBufferView: Float32Array;
  mutationDepth: number;
  mutationPending: boolean;
  mutationRevision: number;
}

const storage = new WeakMap<object, VoxelGridStorage>();

function getStorage(owner: object): VoxelGridStorage {
  const state = storage.get(owner);
  if (!state) throw new Error("VoxelGrid storage is unavailable");
  return state;
}

function assertBuffer(value: Float32Array, expectedLength: number): void {
  if (!(value instanceof Float32Array) || value.length !== expectedLength) {
    throw new Error("VoxelGrid buffer length does not match the grid dimensions");
  }
}

export class VoxelGrid {
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly size: number;

  constructor(W: number, H: number, D: number) {
    const size = validateGridDimensions(W, H, D, "VoxelGrid");
    this.W = W;
    this.H = H;
    this.D = D;
    this.size = size;
    const state: VoxelGridStorage = {
      buffer: new Float32Array(this.size * CELL_FIELDS),
      backBuffer: new Float32Array(this.size * CELL_FIELDS),
      bufferView: new Float32Array(0),
      backBufferView: new Float32Array(0),
      mutationDepth: 0,
      mutationPending: false,
      mutationRevision: 0,
    };
    state.bufferView = createTrackedFloat32Array(state.buffer, () => this.markMutation());
    state.backBufferView = createTrackedFloat32Array(state.backBuffer, () => this.markMutation());
    storage.set(this, state);
  }

  get buffer(): Float32Array { return getStorage(this).bufferView; }
  set buffer(value: Float32Array) {
    assertBuffer(value, this.size * CELL_FIELDS);
    getStorage(this).buffer.set(value);
    this.markMutation();
  }

  get backBuffer(): Float32Array { return getStorage(this).backBufferView; }
  set backBuffer(value: Float32Array) {
    assertBuffer(value, this.size * CELL_FIELDS);
    getStorage(this).backBuffer.set(value);
    this.markMutation();
  }

  get mutationRevision(): number { return getStorage(this).mutationRevision; }

  beginMutation(): () => void {
    const state = getStorage(this);
    state.mutationDepth++;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      state.mutationDepth--;
      if (state.mutationDepth === 0 && state.mutationPending) {
        state.mutationPending = false;
        state.mutationRevision++;
      }
    };
  }

  markMutation(): void {
    const state = getStorage(this);
    if (state.mutationDepth > 0) {
      state.mutationPending = true;
      return;
    }
    state.mutationRevision++;
  }

  [INTERNAL_MUTABLE_BUFFER](side: MutableBufferSide = "front"): Float32Array {
    this.markMutation();
    const state = getStorage(this);
    return side === "back" ? state.backBuffer : state.buffer;
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.H * this.W + y * this.W + x) * CELL_FIELDS;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D;
  }

  cell(x: number, y: number, z: number): CellState {
    return new CellState(getStorage(this).buffer, this.idx(x, y, z), () => this.markMutation());
  }

  cellAt(linearIdx: number): CellState {
    return new CellState(getStorage(this).buffer, linearIdx * CELL_FIELDS, () => this.markMutation());
  }

  cellBack(x: number, y: number, z: number): CellState {
    return new CellState(getStorage(this).backBuffer, this.idx(x, y, z), () => this.markMutation());
  }

  swapBuffers(): void {
    const state = getStorage(this);
    const raw = state.buffer;
    state.buffer = state.backBuffer;
    state.backBuffer = raw;
    const view = state.bufferView;
    state.bufferView = state.backBufferView;
    state.backBufferView = view;
    this.markMutation();
  }

  snapshot(): void {
    const end = this.beginMutation();
    try {
      const state = getStorage(this);
      state.backBuffer.set(state.buffer);
      this.markMutation();
    } finally {
      end();
    }
  }

  neighbors6(x: number, y: number, z: number): Array<[number, number, number]> {
    const result: Array<[number, number, number]> = [];
    const dirs: Array<[number, number, number]> = [
      [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
    ];
    for (const [dx, dy, dz] of dirs) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.inBounds(nx, ny, nz)) result.push([nx, ny, nz]);
    }
    return result;
  }

  clear(): void {
    const end = this.beginMutation();
    try {
      const state = getStorage(this);
      state.buffer.fill(0);
      state.backBuffer.fill(0);
      this.markMutation();
    } finally {
      end();
    }
  }

  totalField(fieldOffset: number): number {
    const buf = getStorage(this).buffer;
    let sum = 0;
    for (let i = fieldOffset; i < buf.length; i += CELL_FIELDS) sum += buf[i];
    return sum;
  }
}
