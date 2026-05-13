import { CellState, CELL_FIELDS } from './CellState';

export class VoxelGrid {
  readonly W: number;
  readonly H: number;
  readonly D: number;
  readonly size: number;

  buffer: Float32Array;
  backBuffer: Float32Array;

  constructor(W: number, H: number, D: number) {
    this.W = W; this.H = H; this.D = D;
    this.size = W * H * D;
    this.buffer = new Float32Array(this.size * CELL_FIELDS);
    this.backBuffer = new Float32Array(this.size * CELL_FIELDS);
  }

  idx(x: number, y: number, z: number): number {
    return (z * this.H * this.W + y * this.W + x) * CELL_FIELDS;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.W && y >= 0 && y < this.H && z >= 0 && z < this.D;
  }

  cell(x: number, y: number, z: number): CellState {
    return new CellState(this.buffer, this.idx(x, y, z));
  }

  cellBack(x: number, y: number, z: number): CellState {
    return new CellState(this.backBuffer, this.idx(x, y, z));
  }

  swapBuffers(): void {
    const tmp = this.buffer;
    this.buffer = this.backBuffer;
    this.backBuffer = tmp;
  }

  snapshot(): void {
    this.backBuffer.set(this.buffer);
  }

  neighbors6(x: number, y: number, z: number): Array<[number,number,number]> {
    const result: Array<[number,number,number]> = [];
    const dirs: Array<[number,number,number]> = [
      [-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]
    ];
    for (const [dx,dy,dz] of dirs) {
      const nx=x+dx, ny=y+dy, nz=z+dz;
      if (this.inBounds(nx,ny,nz)) result.push([nx,ny,nz]);
    }
    return result;
  }

  clear(): void {
    this.buffer.fill(0);
    this.backBuffer.fill(0);
  }

  totalField(fieldOffset: number): number {
    let sum = 0;
    for (let i = fieldOffset; i < this.buffer.length; i += CELL_FIELDS) {
      sum += this.buffer[i];
    }
    return sum;
  }
}
