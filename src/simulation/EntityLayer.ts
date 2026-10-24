import { VoxelGrid } from '../core/VoxelGrid';
import { SparseVoxelGrid } from '../core/SparseVoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';
import type { InfinityScaleExecutionPlan } from '../infinity/InfinityScaleExecutionAdapter';
import { EntityChunkConnectivity } from '../infinity/EntityChunkConnectivity';
import { EntityChunkReconciliation } from '../infinity/EntityChunkReconciliation';
import { EntityDomainInventoryAuthority } from '../infinity/EntityDomainInventory';

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

export interface EntityLayerSnapshot {
  entities: Entity[];
  bioThreshold: number;
  mutationStrength: number;
  nextId: number;
  extinctCount: number;
  rngState: number;
}

const LIFE_STAGES: readonly LifeStage[] = ['juvenile', 'mature', 'elder'];

function defaultGenome(random: () => number): EntityGenome {
  return {
    metabolismRate:  0.4 + random() * 0.4,
    reproThreshold:  300 + random() * 200,
    signalStrength:  0.3 + random() * 0.4,
    bioAffinity:     0.3 + random() * 0.5,
    mutationRate:    0.02 + random() * 0.04,
    memoryDecay:     0.05 + random() * 0.1,
  };
}

function mutateGenome(parent: EntityGenome, rate: number, random: () => number): EntityGenome {
  const noise = () => (random() - 0.5) * 2 * rate;
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

function createFullDomainExecutionContext(grid: VoxelGrid): InfinityScaleChunkExecutionContext {
  const chunkSize = 32;
  const chunks: Array<{ key: string; lod: number; amr: number; distance: number }> = [];
  for (let z = 0; z < Math.ceil(grid.D / chunkSize); z++) {
    for (let y = 0; y < Math.ceil(grid.H / chunkSize); y++) {
      for (let x = 0; x < Math.ceil(grid.W / chunkSize); x++) {
        chunks.push({ key: `0:${x},${y},${z}`, lod: 0, amr: 0, distance: 0 });
      }
    }
  }

  const plan = {
    revision: 0,
    mode: "advisory",
    observer: { x: 0, y: 0, z: 0 },
    chunks,
    simulationBudget: chunks.length,
    requestedSimulationCount: chunks.length,
    selectedSimulationCount: chunks.length,
    maxSimulatingChunks: chunks.length,
    boundaryReadChunks: [],
    boundaryReadCount: 0,
    boundaryReadRelations: [],
    simulationCellCount: 0,
    boundaryReadCellCount: 0,
    localExecutionLayers: [],
    globalExecutionLayers: [],
    selectiveCpuReady: false,
    selectiveGpuReady: false,
    gpuPhysicsReady: false,
    lodBoundaryTransferReady: false,
    mixedLodExecutionReady: false,
    entityExecutionReady: false,
    agentMigrationReady: false,
  } satisfies InfinityScaleExecutionPlan;

  const context = new InfinityScaleChunkExecutionContext(
    plan,
    grid.W,
    grid.H,
    grid.D,
    chunkSize,
  );
  if (
    context.overlappingSimulationRangeCount !== 0 ||
    context.simulationCellCount !== grid.size ||
    context.readCellCount !== 0 ||
    context.overlappingReadRangeCount !== 0
  ) {
    throw new Error("EntityLayer refuses reconciliation without complete, non-overlapping full-domain coverage");
  }
  return context;
}

function cloneEntity(entity: Entity): Entity {
  return {
    ...entity,
    cells: entity.cells.slice(),
    centroid: [...entity.centroid] as [number, number, number],
    genome: { ...entity.genome },
    memoryBuffer: new Float32Array(entity.memoryBuffer),
    colorRgb: [...entity.colorRgb] as [number, number, number],
  };
}

export class EntityLayer {
  private entities: Map<number, Entity> = new Map();
  private nextId = 1;
  private extinctCountValue = 0;
  private bioThreshold = 0.05;
  mutationStrength = 1.0;
  private readonly initialRngState: number;
  private _rngState: number;
  private readonly domainInventoryAuthority = new EntityDomainInventoryAuthority("entity-layer");
  private readonly chunkReconciliation = new EntityChunkReconciliation();

  constructor(seed = 0x4f1bbcdc) {
    this.initialRngState = Number.isSafeInteger(seed) ? (seed >>> 0) || 0x4f1bbcdc : 0x4f1bbcdc;
    this._rngState = this.initialRngState;
  }

  private _random(): number {
    let x = this._rngState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState / 0x100000000;
  }

  get extinctCount(): number { return this.extinctCountValue; }
  get totalSpawned(): number { return this.nextId - 1; }

  /** Set a reproducible non-zero xorshift32 seed. */
  setRandomSeed(seed: number): void {
    if (!Number.isSafeInteger(seed) || seed <= 0 || seed > 0xffffffff) {
      throw new Error('EntityLayer seed must be a non-zero uint32');
    }
    this._rngState = seed >>> 0;
  }

  private _captureCurrentDomainInventory(cellCount: number) {
    const entities = [...this.entities.values()];
    const ownership = entities.map(entity => {
      if (
        !Number.isSafeInteger(entity.id) || entity.id < 1 ||
        !entity.cells.every(cell => Number.isSafeInteger(cell) && cell >= 0 && cell < cellCount)
      ) {
        throw new Error("EntityLayer cannot inventory invalid authoritative entity cells");
      }
      return { entityId: entity.id, cells: [...entity.cells] };
    });
    return this.domainInventoryAuthority.update({
      completeness: "complete",
      entityIds: entities.map(entity => entity.id),
      occupiedCells: ownership.flatMap(entry => entry.cells),
      entityCellOwnership: ownership,
    });
  }

  snapshot(): EntityLayerSnapshot {
    return {
      entities: [...this.entities.values()].map(entity => ({
        ...entity,
        cells: [...entity.cells],
        centroid: [...entity.centroid] as [number, number, number],
        genome: { ...entity.genome },
        memoryBuffer: new Float32Array(entity.memoryBuffer),
        colorRgb: [...entity.colorRgb] as [number, number, number],
      })),
      bioThreshold: this.bioThreshold,
      mutationStrength: this.mutationStrength,
      nextId: this.nextId,
      extinctCount: this.extinctCountValue,
      rngState: this._rngState,
    };
  }

  restore(snapshot: EntityLayerSnapshot, cellCount?: number): void {
    if (cellCount !== undefined &&
        (!Number.isSafeInteger(cellCount) || cellCount < 0)) {
      throw new Error("Invalid EntityLayer expected cell count");
    }
    if (!snapshot ||
        typeof snapshot !== "object" ||
        !Array.isArray(snapshot.entities) ||
        !Number.isFinite(snapshot.bioThreshold) ||
        snapshot.bioThreshold <= 0 ||
        !Number.isFinite(snapshot.mutationStrength) ||
        snapshot.mutationStrength < 0 ||
        !Number.isSafeInteger(snapshot.nextId) ||
        snapshot.nextId < 1 ||
        !Number.isSafeInteger(snapshot.extinctCount) ||
        snapshot.extinctCount < 0 ||
        !Number.isSafeInteger(snapshot.rngState) ||
        snapshot.rngState <= 0 ||
        snapshot.rngState > 0xffffffff) {
      throw new Error("Invalid EntityLayer snapshot envelope");
    }

    const restored = new Map<number, Entity>();
    const seenCells = new Set<number>();
    let maxId = 0;
    for (const candidate of snapshot.entities as unknown[]) {
      if (!candidate || typeof candidate !== "object") {
        throw new Error("Invalid EntityLayer snapshot entity");
      }
      const entity = candidate as Partial<Entity>;
      const genome = entity.genome as EntityGenome | undefined;
      const genomeValues = genome ? [
        genome.metabolismRate,
        genome.reproThreshold,
        genome.signalStrength,
        genome.bioAffinity,
        genome.mutationRate,
        genome.memoryDecay,
      ] : [];

      if (!Number.isSafeInteger(entity.id) ||
          (entity.id as number) < 1 ||
          restored.has(entity.id as number) ||
          !Array.isArray(entity.cells) ||
          entity.cells.length < 1 ||
          !entity.cells.every(index =>
            Number.isSafeInteger(index) &&
            index >= 0 &&
            (cellCount === undefined || index < cellCount)) ||
          !Array.isArray(entity.centroid) ||
          entity.centroid.length !== 3 ||
          !entity.centroid.every(value => Number.isFinite(value) && value >= 0) ||
          !genome ||
          genomeValues.length !== 6 ||
          !genomeValues.every(value => typeof value === "number" && Number.isFinite(value)) ||
          genome.metabolismRate < 0.05 ||
          genome.reproThreshold < 50 ||
          genome.signalStrength < 0 || genome.signalStrength > 1 ||
          genome.bioAffinity < 0 || genome.bioAffinity > 1 ||
          genome.mutationRate < 0.001 || genome.mutationRate > 0.2 ||
          genome.memoryDecay < 0.01 || genome.memoryDecay > 0.5 ||
          !Number.isSafeInteger(entity.age) ||
          (entity.age as number) < 0 ||
          typeof entity.energy !== "number" ||
          !Number.isFinite(entity.energy) ||
          !LIFE_STAGES.includes(entity.stage as LifeStage) ||
          !(entity.memoryBuffer instanceof Float32Array) ||
          entity.memoryBuffer.length !== 8 ||
          !Array.from(entity.memoryBuffer).every(Number.isFinite) ||
          !Number.isSafeInteger(entity.memPtr) ||
          (entity.memPtr as number) < 0 ||
          typeof entity.symbol !== "string" ||
          !SYMBOLS.includes(entity.symbol as typeof SYMBOLS[number]) ||
          !Array.isArray(entity.colorRgb) ||
          entity.colorRgb.length !== 3 ||
          !entity.colorRgb.every(Number.isFinite) ||
          !Number.isSafeInteger(entity.children) ||
          (entity.children as number) < 0 ||
          typeof entity.reproCounter !== "number" ||
          !Number.isFinite(entity.reproCounter) ||
          entity.reproCounter < 0 ||
          entity.reproCounter > 1) {
        throw new Error("Invalid EntityLayer snapshot entity state");
      }

      const entityCells = entity.cells as number[];
      const localCells = new Set<number>();
      for (const cellIndex of entityCells) {
        if (localCells.has(cellIndex) || seenCells.has(cellIndex)) {
          throw new Error("Invalid EntityLayer snapshot: overlapping entity cells");
        }
        localCells.add(cellIndex);
      }
      for (const cellIndex of localCells) seenCells.add(cellIndex);

      const id = entity.id as number;
      restored.set(id, {
        id,
        cells: [...entityCells],
        centroid: [...entity.centroid] as [number, number, number],
        genome: { ...genome },
        age: entity.age as number,
        energy: entity.energy,
        stage: entity.stage as LifeStage,
        memoryBuffer: new Float32Array(entity.memoryBuffer),
        memPtr: entity.memPtr as number,
        symbol: entity.symbol,
        colorRgb: [...entity.colorRgb] as [number, number, number],
        children: entity.children as number,
        reproCounter: entity.reproCounter,
      });
      maxId = Math.max(maxId, id);
    }

    if (snapshot.nextId <= maxId) {
      throw new Error("Invalid EntityLayer snapshot allocator state");
    }

    // Install the fully validated, detached candidate as one state transition.
    this.entities = restored;
    this.bioThreshold = snapshot.bioThreshold;
    this.mutationStrength = snapshot.mutationStrength;
    this.nextId = snapshot.nextId;
    this.extinctCountValue = snapshot.extinctCount;
    this._rngState = snapshot.rngState >>> 0;
  }

  tick(grid: VoxelGrid, dt: number): void {
    const originalEntities = new Map(this.entities);
    const entitySnapshots = new Map<number, Entity>();
    const entityMutableRefs = new Map<number, Pick<Entity, "cells" | "centroid" | "genome" | "memoryBuffer" | "colorRgb">>();
    for (const [id, currentEntity] of originalEntities) {
      entitySnapshots.set(id, cloneEntity(currentEntity));
      entityMutableRefs.set(id, {
        cells: currentEntity.cells,
        centroid: currentEntity.centroid,
        genome: currentEntity.genome,
        memoryBuffer: currentEntity.memoryBuffer,
        colorRgb: currentEntity.colorRgb,
      });
    }
    const bufferSnapshot = grid.buffer.slice();
    const sparseBackBufferSnapshot = grid instanceof SparseVoxelGrid ? grid.backBuffer.slice() : null;
    const thresholdSnapshot = this.bioThreshold;
    const nextIdSnapshot = this.nextId;
    const extinctSnapshot = this.extinctCountValue;
    const rngSnapshot = this._rngState;

    try {
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
        const nextCellSet = new Set(blob);
        for (const previousCell of best.cells) {
          if (nextCellSet.has(previousCell)) continue;
          const previousBase = previousCell * CELL_FIELDS;
          if (buf[previousBase + F.ENTITY_ID] === best.id) {
            buf[previousBase + F.ENTITY_ID] = 0;
          }
        }
        best.cells = blob;
        best.centroid = c;
        nextEntities.set(best.id, best);
      } else {
        // New entity — inherit any genome from field or start fresh
        const id = this.nextId++;
        const ent: Entity = {
          id, cells: blob, centroid: c,
          genome: defaultGenome(() => this._random()),
          age: 0, energy: 0, stage: 'juvenile',
          memoryBuffer: new Float32Array(8),
          memPtr: 0,
          symbol: SYMBOLS[Math.floor(this._random() * SYMBOLS.length)],
          colorRgb: [
            0.3 + this._random() * 0.7,
            0.3 + this._random() * 0.7,
            0.3 + this._random() * 0.7,
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
        this.extinctCountValue++;
        const dead = this.entities.get(id)!;
        for (const i of dead.cells) {
          const base = i * CELL_FIELDS;
          buf[base + F.ENERGY] = Math.min(9999, buf[base + F.ENERGY] + dead.energy * 0.3 / Math.max(1, dead.cells.length));
          if (buf[base + F.ENTITY_ID] === id) {
            buf[base + F.ENTITY_ID] = 0;
          }
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
    } catch (error) {
      grid.buffer.set(bufferSnapshot);
      if (grid instanceof SparseVoxelGrid) {
        if (sparseBackBufferSnapshot) grid.backBuffer.set(sparseBackBufferSnapshot);
        grid.syncDenseToChunks();
      }
      for (const [id, original] of originalEntities) {
        const snapshot = entitySnapshots.get(id)!;
        const refs = entityMutableRefs.get(id)!;
        original.cells = refs.cells;
        original.centroid = refs.centroid;
        original.genome = refs.genome;
        original.memoryBuffer = refs.memoryBuffer;
        original.colorRgb = refs.colorRgb;
        original.cells.length = 0;
        for (const index of snapshot.cells) original.cells.push(index);
        original.centroid[0] = snapshot.centroid[0];
        original.centroid[1] = snapshot.centroid[1];
        original.centroid[2] = snapshot.centroid[2];
        Object.assign(original.genome, snapshot.genome);
        original.age = snapshot.age;
        original.energy = snapshot.energy;
        original.stage = snapshot.stage;
        original.memoryBuffer.set(snapshot.memoryBuffer);
        original.memPtr = snapshot.memPtr;
        original.symbol = snapshot.symbol;
        original.colorRgb[0] = snapshot.colorRgb[0];
        original.colorRgb[1] = snapshot.colorRgb[1];
        original.colorRgb[2] = snapshot.colorRgb[2];
        original.children = snapshot.children;
        original.reproCounter = snapshot.reproCounter;
      }
      this.entities = originalEntities;
      this.bioThreshold = thresholdSnapshot;
      this.nextId = nextIdSnapshot;
      this.extinctCountValue = extinctSnapshot;
      this._rngState = rngSnapshot;
      throw error;
    }
  }

  private _spawnChild(grid: VoxelGrid, parent: Entity, W: number, H: number, D: number): void {
    // Pick a random parent cell and try to seed child in a random adjacent empty location
    const srcIdx = parent.cells[Math.floor(this._random() * parent.cells.length)];
    const WH = W * H;
    const pz = Math.floor(srcIdx / WH);
    const rem = srcIdx - pz * WH;
    const py = Math.floor(rem / W);
    const px = rem - py * W;

    // Random offset 2..4 cells away
    const offsets = [-3, -2, 2, 3];
    const ox = offsets[Math.floor(this._random() * 4)];
    const oy = offsets[Math.floor(this._random() * 4)];
    const nx = Math.max(0, Math.min(W - 1, px + ox));
    const ny = Math.max(0, Math.min(H - 1, py + oy));
    const nz = Math.max(0, Math.min(D - 1, pz));

    const childBase = (nz * WH + ny * W + nx) * CELL_FIELDS;
    const buf = grid.buffer;

    // Only spawn if target is low-bio
    if (buf[childBase + F.BIO_POTENTIAL] < 0.02) {
      const childGenome = mutateGenome(parent.genome, parent.genome.mutationRate * this.mutationStrength, () => this._random());
      buf[childBase + F.BIO_POTENTIAL] = 0.15;
      buf[childBase + F.ENERGY]        = parent.genome.reproThreshold * 0.3;
      buf[childBase + F.INFORMATION]   = 5;

      parent.children++;

      // Register new entity immediately
      const id = this.nextId++;
      const c = centroid([nz * WH + ny * W + nx], W, H);
      this.entities.set(id, {
        id, cells: [nz * WH + ny * W + nx], centroid: c,
        genome: childGenome,
        age: 0, energy: buf[childBase + F.ENERGY], stage: 'juvenile',
        memoryBuffer: new Float32Array(8),
        memPtr: 0,
        symbol: SYMBOLS[Math.floor(this._random() * SYMBOLS.length)],
        colorRgb: [
          Math.max(0.2, parent.colorRgb[0] + (this._random() - 0.5) * 0.3),
          Math.max(0.2, parent.colorRgb[1] + (this._random() - 0.5) * 0.3),
          Math.max(0.2, parent.colorRgb[2] + (this._random() - 0.5) * 0.3),
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
    this.nextId = 1;
    this.extinctCountValue = 0;
    this._rngState = this.initialRngState;
  }
}
