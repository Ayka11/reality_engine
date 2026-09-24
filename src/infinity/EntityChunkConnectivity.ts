import type { VoxelGrid } from "../core/VoxelGrid";
import { CELL_FIELDS, F } from "../core/CellState";
import type {
  ExecutionCellRange,
} from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleChunkExecutionContext } from "./InfinityScaleChunkExecutionContext";
import type { InfinityScaleLODBoundarySnapshot } from "./InfinityScaleLODBoundarySnapshot";

export interface EntityChunkComponent {
  id: number;
  cells: number[];
  centroid: [number, number, number];
  touchesSimulationBoundary: boolean;
  touchesReadBoundary: boolean;
  touchesMixedLODBoundary: boolean;
}

export interface EntityChunkConnectivityResult {
  components: EntityChunkComponent[];
  closedComponentCount: number;
  boundaryComponentCount: number;
  openReadComponentCount: number;
  mixedLodComponentCount: number;
}

/**
 * Chunk-local connected-component analysis for EntityLayer.
 *
 * Components are labeled independently inside simulation chunks. Facing
 * simulation chunks are then stitched through their shared face. A component
 * touching a read-only chunk is marked open and is not safe for global entity
 * reconciliation until that neighboring chunk participates in execution.
 *
 * This follows the standard local-label + boundary-reconciliation pattern used
 * by distributed connected-component algorithms.
 */
export class EntityChunkConnectivity {
  constructor(
    private readonly threshold = 0.05,
  ) {}

  analyze(
    grid: VoxelGrid,
    context: InfinityScaleChunkExecutionContext,
    boundarySnapshot?: InfinityScaleLODBoundarySnapshot,
  ): EntityChunkConnectivityResult {
    const pieces: Piece[] = [];
    const pieceByCell = new Map<number, number>();

    for (const range of context.simulationRanges) {
      const pieceIds = this.labelRange(grid, range, context, pieces, pieceByCell, boundarySnapshot);
      void pieceIds;
    }

    const uf = new UnionFind(pieces.length);

    // Stitch only adjacent simulation ranges. This is the ownership boundary:
    // a face link is sufficient for the 6-neighbor entity topology.
    for (let a = 0; a < pieces.length; a++) {
      const pa = pieces[a];
      for (const cell of pa.boundaryCells) {
        const { x, y, z } = this.coords(cell, grid);
        const neighbors = [
          [x + 1, y, z],
          [x, y + 1, z],
          [x, y, z + 1],
        ];

        for (const [nx, ny, nz] of neighbors) {
          if (
            nx < 0 || nx >= grid.W ||
            ny < 0 || ny >= grid.H ||
            nz < 0 || nz >= grid.D
          ) continue;

          const ni = this.index(nx, ny, nz, grid);
          const other = pieceByCell.get(ni);
          if (other !== undefined) uf.union(a, other);
        }
      }
    }

    const merged = new Map<number, EntityChunkComponent>();
    for (let i = 0; i < pieces.length; i++) {
      const root = uf.find(i);
      let out = merged.get(root);
      if (!out) {
        out = {
          id: root,
          cells: [],
          centroid: [0, 0, 0],
          touchesSimulationBoundary: false,
          touchesReadBoundary: false,
          touchesMixedLODBoundary: false,
        };
        merged.set(root, out);
      }
      out.cells.push(...pieces[i].cells);
      out.centroid = this.centroid(out.cells, grid);
      out.touchesSimulationBoundary ||= pieces[i].touchesSimulationBoundary;
      out.touchesReadBoundary ||= pieces[i].touchesReadBoundary;
      out.touchesMixedLODBoundary ||= pieces[i].touchesMixedLODBoundary;
    }

    const components = [...merged.values()];
    return {
      components,
      closedComponentCount: components.filter(c => !c.touchesReadBoundary && !c.touchesMixedLODBoundary).length,
      boundaryComponentCount: components.filter(c => c.touchesSimulationBoundary).length,
      openReadComponentCount: components.filter(c => c.touchesReadBoundary).length,
      mixedLodComponentCount: components.filter(c => c.touchesMixedLODBoundary).length,
    };
  }

  private labelRange(
    grid: VoxelGrid,
    range: ExecutionCellRange,
    context: InfinityScaleChunkExecutionContext,
    pieces: Piece[],
    pieceByCell: Map<number, number>,
    boundarySnapshot?: InfinityScaleLODBoundarySnapshot,
  ): number[] {
    const visited = new Uint8Array(
      Math.max(0, rangeVolume(range)),
    );
    const pieceIds: number[] = [];

    const localIndex = (x: number, y: number, z: number) =>
      ((z - range.minZ) * (range.maxY - range.minY + 1) +
        (y - range.minY)) * (range.maxX - range.minX + 1) +
        (x - range.minX);

    for (let z = range.minZ; z <= range.maxZ; z++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
          const li = localIndex(x, y, z);
          if (visited[li]) continue;

          const index = this.index(x, y, z, grid);
          if (grid.buffer[index * CELL_FIELDS + F.BIO_POTENTIAL] < this.threshold) {
            visited[li] = 1;
            continue;
          }

          const stack = [index];
          visited[li] = 1;
          const cells: number[] = [];
          const boundaryCells: number[] = [];
          let touchesReadBoundary = false;
          let touchesMixedLODBoundary = false;

          while (stack.length) {
            const current = stack.pop()!;
            cells.push(current);

            const c = this.coords(current, grid);
            const onRangeBoundary =
              c.x === range.minX || c.x === range.maxX ||
              c.y === range.minY || c.y === range.maxY ||
              c.z === range.minZ || c.z === range.maxZ;

            if (onRangeBoundary) {
              boundaryCells.push(current);
              if (boundarySnapshot) {
                const mixedSpecs = context.getBoundaryTransferSpecsForCell(c.x, c.y, c.z)
                  .filter(spec => spec.sourceLevel !== spec.targetLevel);
                if (mixedSpecs.some(spec => boundarySnapshot.hasSourceChunk(spec.targetChunk))) {
                  touchesMixedLODBoundary = true;
                }
              }
            }

            const dirs = [
              [1, 0, 0], [-1, 0, 0],
              [0, 1, 0], [0, -1, 0],
              [0, 0, 1], [0, 0, -1],
            ];

            for (const [dx, dy, dz] of dirs) {
              const nx = c.x + dx, ny = c.y + dy, nz = c.z + dz;
              if (
                nx < range.minX || nx > range.maxX ||
                ny < range.minY || ny > range.maxY ||
                nz < range.minZ || nz > range.maxZ
              ) {
                if (
                  context.containsReadCell(nx, ny, nz) &&
                  !context.containsSimulationCell(nx, ny, nz)
                ) {
                  touchesReadBoundary = true;
                }
                continue;
              }

              const nli = localIndex(nx, ny, nz);
              if (visited[nli]) continue;
              const ni = this.index(nx, ny, nz, grid);
              visited[nli] = 1;
              if (grid.buffer[ni * CELL_FIELDS + F.BIO_POTENTIAL] >= this.threshold) {
                stack.push(ni);
              }
            }
          }

          if (cells.length >= 2) {
            const id = pieces.length;
            pieces.push({
              id,
              cells,
              boundaryCells,
              touchesSimulationBoundary: boundaryCells.length > 0,
              touchesReadBoundary,
              touchesMixedLODBoundary,
            });
            for (const cell of cells) pieceByCell.set(cell, id);
            pieceIds.push(id);
          }
        }
      }
    }

    return pieceIds;
  }

  private centroid(cells: number[], grid: VoxelGrid): [number, number, number] {
    let sx = 0, sy = 0, sz = 0;
    for (const index of cells) {
      const c = this.coords(index, grid);
      sx += c.x; sy += c.y; sz += c.z;
    }
    const n = Math.max(1, cells.length);
    return [sx / n, sy / n, sz / n];
  }

  private index(x: number, y: number, z: number, grid: VoxelGrid): number {
    return z * grid.W * grid.H + y * grid.W + x;
  }

  private coords(index: number, grid: VoxelGrid): {x:number;y:number;z:number} {
    const wh = grid.W * grid.H;
    const z = Math.floor(index / wh);
    const rem = index - z * wh;
    const y = Math.floor(rem / grid.W);
    return { x: rem - y * grid.W, y, z };
  }
}

interface Piece {
  id: number;
  cells: number[];
  boundaryCells: number[];
  touchesSimulationBoundary: boolean;
  touchesReadBoundary: boolean;
  touchesMixedLODBoundary: boolean;
}

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== x) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
  }
}

function rangeVolume(range: ExecutionCellRange): number {
  return (
    Math.max(0, range.maxX - range.minX + 1) *
    Math.max(0, range.maxY - range.minY + 1) *
    Math.max(0, range.maxZ - range.minZ + 1)
  );
}
