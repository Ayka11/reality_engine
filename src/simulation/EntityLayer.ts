import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export interface EntityGenome {
  metabolismRate: number;    // 0.1..2.0 — energy consumed per tick
  reproThreshold: number;    // energy needed to reproduce
  signalStrength: number;    // 0..1 — communication intensity
  bioAffinity: number;       // 0..1 — how well it uses bioPotential
  mutationRate: number;      // 0..0.2 — per-field noise on offspring genome
  memoryDecay: number;       // 0..1 — how fast memory field fades
}

export type LifeStage = 'juvenile' | 'mature' | 'elder';

const SYMBOLS = ['@', '#', '*', 'O', 'X', '&', '%', '$'] as const;

export interface Entity {
  id: number;
  cells: number[];           // linear indices into the grid
  centroid: [number, number, number];
  genome: EntityGenome;
  age: number;               // ticks alive
  energy: number;            // pooled from member cells
  stage: LifeStage;
  memoryBuffer: Float32Array; // rolling average of last 8 energy readings
  memPtr: number;
  symbol: string;
  colorRgb: [number, number, number];
  children: number;
  reproCounter: number;      // energy / reproThreshold — 0..1 display gauge
}

let _nextId = 1;
let _extinctCount = 0;

function defaultGenome(): EntityGenome {
  return {
    metabolismRate:  0.4 + Math.random() * 0.4,
    reproThreshold:  300 + Math.random() * 200,
    signalStrength:  0.3 + Math.random() * 0.4,
    bioAffinity:     0.3 + Math.random() * 0.5,
    mutationRate:    0.02 + Math.random() * 0.04,
    memoryDecay:     0.05 + Math.random() * 0.1,
  };
}

function mutateGenome(parent: EntityGenome, rate: number): EntityGenome {
  const noise = () => (Math.random() - 0.5) * 2 * rate;
  return {
    metabolismRate:  Math.max(0.05, parent.metabolismRate  + noise()),
    reproThreshold:  Math.max(50,   parent.reproThreshold  + noise() * 200),
    signalStrength:  Math.max(0,    Math.min(1, parent.signalStrength + noise())),
    bioAffinity:     Math.max(0,    Math.min(1, parent.bioAffinity    + noise())),
    mutationRate:    Math.max(0.001,Math.min(0.2, parent.mutationRate + noise() * 0.05)),
    memoryDecay:     Math.max(0.01, Math.min(0.5, parent.memoryDecay + noise() * 0.05)),
  };
}

function flood(grid: VoxelGrid, seed: number, visited: Uint8Array, threshold = 0.05): number[] {
  const { W, H, D, buffer: buf } = grid;
  const WH = W * H;
  const stack = [seed];
  const cells: number[] = [];
  visited[seed] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const bio = buf[i * CELL_FIELDS + F.BIO_POTENTIAL];
    if (bio < threshold) continue;
    cells.push(i);
    const z = Math.floor(i / WH);
    const rem = i - z * WH;
    const y = Math.floor(rem / W);
    const x = rem - y * W;
    const neighbors = [
      x > 0   ? i - 1  : -1,
      x < W-1 ? i + 1  : -1,
      y > 0   ? i - W  : -1,
      y < H-1 ? i + W  : -1,
      z > 0   ? i - WH : -1,
      z < D-1 ? i + WH : -1,
    ];
    for (const ni of neighbors) {
      if (ni >= 0 && !visited[ni]) {
        visited[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return cells;
}

function centroid(cells: number[], W: number, H: number): [number, number, number] {
  let sx = 0, sy = 0, sz = 0;
  const WH = W * H;
  for (const i of cells) {
    const z = Math.floor(i / WH);
    const rem = i - z * WH;
    const y = Math.floor(rem / W);
    const x = rem - y * W;
    sx += x; sy += y; sz += z;
  }
  const n = cells.length;
  return [sx / n, sy / n, sz / n];
}

export class EntityLayer {
  private entities: Map<number, Entity> = new Map();
  private bioThreshold = 0.05;
  mutationStrength = 1.0;

  get extinctCount(): number { return _extinctCount; }
  get totalSpawned(): number { return _nextId - 1; }

  tick(grid: VoxelGrid, dt: number): void {
    const { W, H, D, buffer: buf } = grid;
    const n = grid.size;

    // ── Detect blobs via flood-fill ──────────────────────────────────────────
    const visited = new Uint8Array(n);
    const activeCells = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (buf[i * CELL_FIELDS + F.BIO_POTENTIAL] >= this.bioThreshold) activeCells.add(i);
    }

    const blobs: number[][] = [];
    for (const seed of activeCells) {
      if (!visited[seed]) {
        const blob = flood(grid, seed, visited, this.bioThreshold);
        if (blob.length >= 2) blobs.push(blob);
      }
    }

    // ── Reconcile blobs → entities (simple size-match) ───────────────────────
    const matched = new Set<number>();
    const nextEntities: Map<number, Entity> = new Map();

    for (const blob of blobs) {
      const c = centroid(blob, W, H);
      // Try to match an existing entity by centroid proximity
      let best: Entity | null = null;
      let bestDist = 5; // max 5-cell centroid drift per tick
      for (const [, ent] of this.entities) {
        if (matched.has(ent.id)) continue;
        const dx = c[0] - ent.centroid[0];
        const dy = c[1] - ent.centroid[1];
        const dz = c[2] - ent.centroid[2];
        const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (d < bestDist) { bestDist = d; best = ent; }
      }

      if (best) {
        matched.add(best.id);
        best.cells = blob;
        best.centroid = c;
        nextEntities.set(best.id, best);
      } else {
        // New entity — inherit any genome from field or start fresh
        const id = _nextId++;
        const ent: Entity = {
          id, cells: blob, centroid: c,
          genome: defaultGenome(),
          age: 0, energy: 0, stage: 'juvenile',
          memoryBuffer: new Float32Array(8),
          memPtr: 0,
          symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          colorRgb: [
            0.3 + Math.random() * 0.7,
            0.3 + Math.random() * 0.7,
            0.3 + Math.random() * 0.7,
          ],
          children: 0,
          reproCounter: 0,
        };
        nextEntities.set(id, ent);
      }
    }

    // Count extinction for entities whose blob disappeared
    for (const [id] of this.entities) {
      if (!nextEntities.has(id)) {
        _extinctCount++;
        const dead = this.entities.get(id)!;
        for (const i of dead.cells) {
          const base = i * CELL_FIELDS;
          buf[base + F.ENERGY] = Math.min(9999, buf[base + F.ENERGY] + dead.energy * 0.3 / Math.max(1, dead.cells.length));
        }
      }
    }
    this.entities = nextEntities;

    // ── Per-entity behaviour ─────────────────────────────────────────────────
    for (const [, ent] of this.entities) {
      const { genome, cells } = ent;

      // Pool energy from member cells
      let poolEnergy = 0;
      for (const i of cells) {
        poolEnergy += buf[i * CELL_FIELDS + F.ENERGY];
      }
      ent.energy = poolEnergy;
      ent.reproCounter = Math.min(1, ent.energy / Math.max(1, genome.reproThreshold));

      // Lifecycle stage
      ent.age += 1;
      ent.stage = ent.age < 60 ? 'juvenile' : ent.age < 400 ? 'mature' : 'elder';

      // Metabolism drain — consume energy proportional to size × rate
      const drain = genome.metabolismRate * cells.length * dt * 60;
      const drainPer = drain / cells.length;
      for (const i of cells) {
        buf[i * CELL_FIELDS + F.ENERGY] = Math.max(0, buf[i * CELL_FIELDS + F.ENERGY] - drainPer);
        // Bio-affinity: boost bioPotential by absorbing local energy
        const bio = buf[i * CELL_FIELDS + F.BIO_POTENTIAL];
        buf[i * CELL_FIELDS + F.BIO_POTENTIAL] = Math.min(1,
          bio + genome.bioAffinity * 0.001 * dt * 60);
      }

      // Memory — rolling average of energy
      ent.memoryBuffer[ent.memPtr % 8] = ent.energy / Math.max(1, cells.length);
      ent.memPtr++;
      const memAvg = ent.memoryBuffer.reduce((a, b) => a + b, 0) / 8;
      // Write memory field to cells (fades toward average)
      for (const i of cells) {
        const cur = buf[i * CELL_FIELDS + F.MEM_FIELD];
        buf[i * CELL_FIELDS + F.MEM_FIELD] = cur * (1 - genome.memoryDecay * dt)
          + (memAvg / 1000) * genome.memoryDecay * dt;
      }

      // Communication — broadcast SIGNAL to immediate cell faces
      if (ent.stage !== 'juvenile') {
        const sig = genome.signalStrength * (ent.energy / Math.max(1, cells.length)) / 200;
        for (const i of cells) {
          buf[i * CELL_FIELDS + F.SIGNAL] = Math.min(100, buf[i * CELL_FIELDS + F.SIGNAL] + sig * dt * 60);
        }
      }

      // Mark entity ID into cells
      for (const i of cells) {
        buf[i * CELL_FIELDS + F.ENTITY_ID] = ent.id;
      }

      // Adaptation — if energy consistently low, lower bioThresh drift
      if (memAvg < 50 && ent.stage === 'mature') {
        this.bioThreshold = Math.max(0.01, this.bioThreshold - 0.0001 * dt * 60);
      }

      // Reproduction — if energy above threshold and mature, spawn child blob nearby
      if (ent.stage === 'mature' && ent.energy > genome.reproThreshold && cells.length >= 4) {
        this._spawnChild(grid, ent, W, H, D);
      }

      // Elder decay — slowly reduce bioPotential
      if (ent.stage === 'elder') {
        for (const i of cells) {
          buf[i * CELL_FIELDS + F.BIO_POTENTIAL] = Math.max(0,
            buf[i * CELL_FIELDS + F.BIO_POTENTIAL] - 0.001 * dt * 60);
        }
      }
    }

    // Signal decay across whole grid
    for (let i = 0; i < n; i++) {
      const base = i * CELL_FIELDS;
      buf[base + F.SIGNAL] = Math.max(0, buf[base + F.SIGNAL] - 0.5 * dt * 60);
    }
  }

  private _spawnChild(grid: VoxelGrid, parent: Entity, W: number, H: number, D: number): void {
    // Pick a random parent cell and try to seed child in a random adjacent empty location
    const srcIdx = parent.cells[Math.floor(Math.random() * parent.cells.length)];
    const WH = W * H;
    const pz = Math.floor(srcIdx / WH);
    const rem = srcIdx - pz * WH;
    const py = Math.floor(rem / W);
    const px = rem - py * W;

    // Random offset 2..4 cells away
    const offsets = [-3, -2, 2, 3];
    const ox = offsets[Math.floor(Math.random() * 4)];
    const oy = offsets[Math.floor(Math.random() * 4)];
    const nx = Math.max(0, Math.min(W - 1, px + ox));
    const ny = Math.max(0, Math.min(H - 1, py + oy));
    const nz = Math.max(0, Math.min(D - 1, pz));

    const childBase = (nz * WH + ny * W + nx) * CELL_FIELDS;
    const buf = grid.buffer;

    // Only spawn if target is low-bio
    if (buf[childBase + F.BIO_POTENTIAL] < 0.02) {
      const childGenome = mutateGenome(parent.genome, parent.genome.mutationRate * this.mutationStrength);
      buf[childBase + F.BIO_POTENTIAL] = 0.15;
      buf[childBase + F.ENERGY]        = parent.genome.reproThreshold * 0.3;
      buf[childBase + F.INFORMATION]   = 5;

      parent.children++;

      // Register new entity immediately
      const id = _nextId++;
      const c = centroid([nz * WH + ny * W + nx], W, H);
      this.entities.set(id, {
        id, cells: [nz * WH + ny * W + nx], centroid: c,
        genome: childGenome,
        age: 0, energy: buf[childBase + F.ENERGY], stage: 'juvenile',
        memoryBuffer: new Float32Array(8),
        memPtr: 0,
        symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        colorRgb: [
          Math.max(0.2, parent.colorRgb[0] + (Math.random() - 0.5) * 0.3),
          Math.max(0.2, parent.colorRgb[1] + (Math.random() - 0.5) * 0.3),
          Math.max(0.2, parent.colorRgb[2] + (Math.random() - 0.5) * 0.3),
        ],
        children: 0,
        reproCounter: 0,
      });

      // Drain energy from parent
      const drainPer = parent.genome.reproThreshold * 0.35 / parent.cells.length;
      for (const i of parent.cells) {
        buf[i * CELL_FIELDS + F.ENERGY] = Math.max(0, buf[i * CELL_FIELDS + F.ENERGY] - drainPer);
      }
    }
  }

  getEntities(): Entity[] {
    return [...this.entities.values()];
  }

  clear(): void {
    this.entities.clear();
    _nextId = 1;
    _extinctCount = 0;
  }
}
