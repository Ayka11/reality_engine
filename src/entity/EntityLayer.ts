import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS } from '../core/CellState';

// Field offsets (must match CellState F enum)
const F_BIO  = 11;
const F_ENT  = 3;
const F_INFO = 2;
const F_ENERGY = 0;

export interface Entity {
  id: string;
  cells: number[];                    // flat linear cell indices
  centroid: [number, number, number]; // grid (x, y, z)
  age: number;
  stability: number;                  // avg bio-potential of member cells
  metabolicRate: number;              // avg energy consumption estimate
  color: [number, number, number];    // RGB 0..1
}

export class EntityLayer {
  private _entities: Map<string, Entity> = new Map();
  private _nextId = 1;

  // ── Detection thresholds (can be tuned by MetaLaw) ────────────────────────
  bioPotentialMin = 0.32;
  entropyMax      = 0.50;
  infoMin         = 25;
  minClusterSize  = 5;

  update(grid: VoxelGrid): void {
    const candidates = this._scanCandidates(grid);
    const clusters   = this._floodFill(grid, candidates);
    this._reconcile(clusters);
  }

  // ── Step 1: mark each cell that meets conditions ─────────────────────────
  private _scanCandidates(grid: VoxelGrid): Uint8Array {
    const { size, buffer } = grid;
    const out = new Uint8Array(size);
    const bMin = this.bioPotentialMin;
    const eMax = this.entropyMax;
    const iMin = this.infoMin;

    for (let i = 0; i < size; i++) {
      const base = i * CELL_FIELDS;
      if (
        buffer[base + F_BIO]  > bMin &&
        buffer[base + F_ENT]  < eMax &&
        buffer[base + F_INFO] > iMin
      ) out[i] = 1;
    }
    return out;
  }

  // ── Step 2: 6-connected flood-fill to find clusters ───────────────────────
  private _floodFill(grid: VoxelGrid, cand: Uint8Array): Entity[] {
    const { W, H, D } = grid;
    const visited = new Uint8Array(cand.length);
    const WH = W * H;
    const result: Entity[] = [];

    for (let seed = 0; seed < cand.length; seed++) {
      if (!cand[seed] || visited[seed]) continue;

      const cluster: number[] = [];
      const stack = [seed];

      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (visited[cur] || !cand[cur]) continue;
        visited[cur] = 1;
        cluster.push(cur);

        const x = cur % W;
        const y = Math.floor(cur / W) % H;
        const z = Math.floor(cur / WH);

        if (x > 0)   { const n = cur - 1;  if (!visited[n] && cand[n]) stack.push(n); }
        if (x < W-1) { const n = cur + 1;  if (!visited[n] && cand[n]) stack.push(n); }
        if (y > 0)   { const n = cur - W;  if (!visited[n] && cand[n]) stack.push(n); }
        if (y < H-1) { const n = cur + W;  if (!visited[n] && cand[n]) stack.push(n); }
        if (z > 0)   { const n = cur - WH; if (!visited[n] && cand[n]) stack.push(n); }
        if (z < D-1) { const n = cur + WH; if (!visited[n] && cand[n]) stack.push(n); }
      }

      if (cluster.length >= this.minClusterSize) {
        result.push(this._buildEntity(cluster, grid, W, H));
      }
    }

    return result;
  }

  private _buildEntity(cells: number[], grid: VoxelGrid, W: number, H: number): Entity {
    const buf = grid.buffer;
    const WH = W * H;
    let cx = 0, cy = 0, cz = 0, bioSum = 0, eSum = 0;

    for (const idx of cells) {
      const x = idx % W;
      const y = Math.floor(idx / W) % H;
      const z = Math.floor(idx / WH);
      cx += x; cy += y; cz += z;
      const base = idx * CELL_FIELDS;
      bioSum += buf[base + F_BIO];
      eSum   += buf[base + F_ENERGY];
    }
    const n = cells.length;
    const stability = bioSum / n;

    // Stable color seed based on centroid (deterministic per spatial location)
    const hSeed = ((cx / n * 73.1) + (cy / n * 31.7) + (cz / n * 17.3)) % 1;
    const [r, g, b] = hsvToRgb(hSeed, 0.8, 0.95);

    return {
      id: String(this._nextId++),
      cells,
      centroid: [cx / n, cy / n, cz / n],
      age: 0,
      stability,
      metabolicRate: eSum / n,
      color: [r, g, b],
    };
  }

  // ── Step 3: match new clusters to existing entities by proximity ──────────
  private _reconcile(newEntities: Entity[]): void {
    const nextMap = new Map<string, Entity>();
    const used    = new Set<string>();

    for (const ne of newEntities) {
      let bestId: string | null = null;
      let bestDist = 12; // max match radius in grid units

      for (const [id, old] of this._entities) {
        if (used.has(id)) continue;
        const d = Math.hypot(
          ne.centroid[0] - old.centroid[0],
          ne.centroid[1] - old.centroid[1],
          ne.centroid[2] - old.centroid[2],
        );
        if (d < bestDist) { bestDist = d; bestId = id; }
      }

      if (bestId !== null) {
        const old = this._entities.get(bestId)!;
        ne.id         = bestId;
        ne.age        = old.age + 1;
        ne.stability  = old.stability * 0.88 + ne.stability * 0.12;
        ne.color      = old.color;
        used.add(bestId);
      }

      nextMap.set(ne.id, ne);
    }

    this._entities = nextMap;
  }

  get all(): Entity[]  { return Array.from(this._entities.values()); }
  get count(): number  { return this._entities.size; }
}

// ── HSV → RGB helper ─────────────────────────────────────────────────────────
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  if (mod === 0) return [v, t, p];
  if (mod === 1) return [q, v, p];
  if (mod === 2) return [p, v, t];
  if (mod === 3) return [p, q, v];
  if (mod === 4) return [t, p, v];
  return [v, p, q];
}
