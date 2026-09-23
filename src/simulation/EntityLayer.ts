import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import type { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';
import { EntityChunkConnectivity, type EntityChunkConnectivityResult } from '../infinity/EntityChunkConnectivity';
import { EntityChunkReconciliation, type EntityReconciliationPlan, type EntityReconciliationCommitRecord } from '../infinity/EntityChunkReconciliation';

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
  private readonly chunkConnectivity = new EntityChunkConnectivity(this.bioThreshold);
  private lastChunkConnectivity: EntityChunkConnectivityResult | null = null;
  private readonly chunkReconciliation = new EntityChunkReconciliation();
  private lastChunkReconciliation: EntityReconciliationPlan | null = null;
  private pendingBoundaryComponents = new Map<string, {
    sourceEntityIds: number[];
    centroid: [number, number, number];
    cellCount: number;
  }>();

  analyzeChunks(
    grid: VoxelGrid,
    context: InfinityScaleChunkExecutionContext,
  ): EntityChunkConnectivityResult {
    this.lastChunkConnectivity = this.chunkConnectivity.analyze(grid, context);
    const fullDomainCovered =
      context.simulationCellCount >= grid.size &&
      context.readCellCount === 0;
    this.lastChunkReconciliation = this.chunkReconciliation.plan(
      this.lastChunkConnectivity.components,
      this.getEntities(),
      fullDomainCovered,
    );

    const activePendingKeys = new Set<string>();
    for (const proposal of this.lastChunkReconciliation.proposals) {
      if (proposal.continuity !== 'pending') continue;
      const ancestry = proposal.sourceEntityIds.length > 0
        ? proposal.sourceEntityIds.join(',')
        : [
            Math.round(proposal.centroid[0] * 4) / 4,
            Math.round(proposal.centroid[1] * 4) / 4,
            Math.round(proposal.centroid[2] * 4) / 4,
            proposal.cellCount,
          ].join(',');
      const key = 'boundary:' + ancestry;
      activePendingKeys.add(key);
      this.pendingBoundaryComponents.set(key, {
        sourceEntityIds: [...proposal.sourceEntityIds],
        centroid: [...proposal.centroid],
        cellCount: proposal.cellCount,
      });
    }
    for (const key of this.pendingBoundaryComponents.keys()) {
      if (key.startsWith('boundary:') && !activePendingKeys.has(key)) {
        this.pendingBoundaryComponents.delete(key);
      }
    }
    return this.lastChunkConnectivity;
  }

  getChunkConnectivityDiagnostics(): EntityChunkConnectivityResult | null {
    return this.lastChunkConnectivity;
  }

  getChunkReconciliationDiagnostics(): EntityReconciliationPlan | null {
    return this.lastChunkReconciliation;
  }

  getPendingBoundaryCount(): number {
    return this.pendingBoundaryComponents.size;
  }

  getPendingBoundaryComponents(): Array<{
    componentId: string;
    sourceEntityIds: number[];
    centroid: [number, number, number];
    cellCount: number;
  }> {
    return [...this.pendingBoundaryComponents.entries()].map(([componentId, value]) => ({
      componentId,
      sourceEntityIds: [...value.sourceEntityIds],
      centroid: [...value.centroid],
      cellCount: value.cellCount,
    }));
  }

  canCommitChunkReconciliation(): boolean {
    return this.lastChunkReconciliation?.commitReady === true;
  }

  getChunkReconciliationCommitRecords(
    grid: VoxelGrid,
    context: InfinityScaleChunkExecutionContext,
  ): EntityReconciliationCommitRecord[] | null {
    const connectivity = this.chunkConnectivity.analyze(grid, context);
    const plan = this.chunkReconciliation.plan(
      connectivity.components,
      this.getEntities(),
      context.simulationCellCount >= grid.size && context.readCellCount === 0,
    );
    return this.chunkReconciliation.commitRecords(plan, connectivity.components);
  }

  /**
   * Applies only ownership-safe reconciliation records.
   *
   * Existing entities are retained only when every currently-owned cell is
   * inside the simulation workset; otherwise the transaction is rejected.
   * New entities are created from closed components. Partial worksets never
   * trigger extinction.
   */
  applyChunkReconciliation(
    grid: VoxelGrid,
    context: InfinityScaleChunkExecutionContext,
  ): boolean {
    const plan = this.lastChunkReconciliation;
    const connectivity = this.lastChunkConnectivity;
    if (!plan || !connectivity) return false;
    const records = this.chunkReconciliation.commitRecords(
      plan,
      connectivity.components,
    );
    if (!records) return false;

    const safeRecords = records.filter(record => {
      if (record.entityId === null) return true;
      const entity = this.entities.get(record.entityId);
      if (!entity) return false;
      return !entity.cells.some(index => {

        const z = Math.floor(index / (grid.W * grid.H));
        const rem = index - z * grid.W * grid.H;
        const y = Math.floor(rem / grid.W);
        const cellX = rem - y * grid.W;
        return !context.containsSimulationCell(cellX, y, z);
      });
    });

    const retained = new Set<number>();
    for (const record of safeRecords) {
      let entity: Entity | undefined;
      if (record.entityId !== null) {
        entity = this.entities.get(record.entityId);
        if (!entity) return false;
      } else {
        const source = record.sourceEntityIds.length > 0
          ? record.sourceEntityIds
              .map(id => this.entities.get(id))
              .find(candidate => !!candidate)
          : undefined;
        const id = _nextId++;
        entity = {
          id,
          cells: [],
          centroid: record.centroid,
          genome: source ? { ...source.genome } : defaultGenome(),
          age: source && record.continuity === 'split' ? source.age : 0,
          energy: 0,
          stage: source && record.continuity === 'split' ? source.stage : 'juvenile',
          memoryBuffer: source && record.continuity === 'split'
            ? new Float32Array(source.memoryBuffer)
            : new Float32Array(8),
          memPtr: source && record.continuity === 'split' ? source.memPtr : 0,
          symbol: source?.symbol ?? SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
          colorRgb: source ? [...source.colorRgb] as [number, number, number] : [
            0.3 + Math.random() * 0.7,
            0.3 + Math.random() * 0.7,
            0.3 + Math.random() * 0.7,
          ],
          children: 0,
          reproCounter: 0,
        };
        this.entities.set(id, entity);
      }

      // Continuity contract: a retained entity keeps genome, age, stage,
      // memory buffer, children and other lifecycle state. Only spatial
      // ownership and aggregate energy are replaced by reconciliation.
      entity.cells = [...record.cells];
      entity.centroid = [...record.centroid];
      retained.add(entity.id);

      let energy = 0;
      for (const index of entity.cells) {
        energy += grid.buffer[index * CELL_FIELDS + F.ENERGY];
        grid.buffer[index * CELL_FIELDS + F.ENTITY_ID] = entity.id;
      }
      entity.energy = energy;
      entity.reproCounter = Math.min(
        1,
        energy / Math.max(1, entity.genome.reproThreshold),
      );
    }

    if (fullDomainCovered && plan.commitReady) {
      // Merge resolution: the selected primary retains its lifecycle state;
      // secondary source identities are retired only after full-domain proof.
      const mergedSourceIds = new Set<number>();
      for (const record of safeRecords) {
        if (record.continuity !== 'merge' || record.entityId === null) continue;
        for (const sourceId of record.sourceEntityIds) {
          if (sourceId !== record.entityId) mergedSourceIds.add(sourceId);
        }
      }
      for (const sourceId of mergedSourceIds) {
        const source = this.entities.get(sourceId);
        if (!source) continue;
        _extinctCount++;
        this.entities.delete(sourceId);
      }

      for (const [id, entity] of [...this.entities]) {
        if (!retained.has(id)) {
          _extinctCount++;
          for (const index of entity.cells) {
            const base = index * CELL_FIELDS;
            grid.buffer[base + F.ENERGY] = Math.min(
              9999,
              grid.buffer[base + F.ENERGY] +
                entity.energy * 0.3 / Math.max(1, entity.cells.length),
            );
          }
          this.entities.delete(id);
        }
      }
    }

    return true;
  }

  /**
   * Analyze the bounded execution workset without mutating entity identity.
   *
   * This is the synchronization barrier before EntityLayer can become a
   * selective execution layer. Boundary-connected components remain pending
   * until their complete connected component is resident in the workset.
   */
  prepareChunkExecution(
    grid: VoxelGrid,
    context: InfinityScaleChunkExecutionContext,
  ): EntityReconciliationPlan {
    this.analyzeChunks(grid, context);
    return this.lastChunkReconciliation!;
  }

  tickChunks(
    grid: VoxelGrid,
    dt: number,
    context: InfinityScaleChunkExecutionContext,
  ): void {
    this.analyzeChunks(grid, context);

    const { W, H, D, buffer: buf } = grid;
    for (const entity of this.entities.values()) {
      if (entity.cells.length === 0) continue;
      if (entity.cells.some(index => {
        const z = Math.floor(index / (W * H));
        const rem = index - z * W * H;
        const y = Math.floor(rem / W);
        const x = rem - y * W;
        return !context.containsSimulationCell(x, y, z);
      })) continue;

      const { genome, cells } = entity;
      let poolEnergy = 0;
      for (const index of cells) {
        poolEnergy += buf[index * CELL_FIELDS + F.ENERGY];
      }
      entity.energy = poolEnergy;
      entity.reproCounter = Math.min(
        1,
        poolEnergy / Math.max(1, genome.reproThreshold),
      );

      entity.age += 1;
      entity.stage =
        entity.age < 60 ? 'juvenile' :
        entity.age < 400 ? 'mature' : 'elder';

      const drain = genome.metabolismRate * cells.length * dt * 60;
      const drainPer = drain / Math.max(1, cells.length);
      for (const index of cells) {
        const base = index * CELL_FIELDS;
        buf[base + F.ENERGY] = Math.max(0, buf[base + F.ENERGY] - drainPer);
        buf[base + F.BIO_POTENTIAL] = Math.min(
          1,
          buf[base + F.BIO_POTENTIAL] +
            genome.bioAffinity * 0.001 * dt * 60,
        );
      }

      entity.memoryBuffer[entity.memPtr % 8] =
        entity.energy / Math.max(1, cells.length);
      entity.memPtr++;
      const memAvg =
        entity.memoryBuffer.reduce((a, b) => a + b, 0) / 8;

      for (const index of cells) {
        const base = index * CELL_FIELDS;
        const cur = buf[base + F.MEM_FIELD];
        buf[base + F.MEM_FIELD] =
          cur * (1 - genome.memoryDecay * dt) +
          (memAvg / 1000) * genome.memoryDecay * dt;

        if (entity.stage !== 'juvenile') {
          const sig =
            genome.signalStrength *
            (entity.energy / Math.max(1, cells.length)) / 200;
          buf[base + F.SIGNAL] = Math.min(
            100,
            buf[base + F.SIGNAL] + sig * dt * 60,
          );
        }

        buf[base + F.ENTITY_ID] = entity.id;

        if (entity.stage === 'elder') {
          buf[base + F.BIO_POTENTIAL] = Math.max(
            0,
            buf[base + F.BIO_POTENTIAL] - 0.001 * dt * 60,
          );
        }
      }

      if (
        entity.stage === 'mature' &&
        entity.energy > genome.reproThreshold &&
        cells.length >= 4
      ) {
        this._spawnChild(grid, entity, W, H, D, context);
      }
    }

    // Signal decay is local to the simulation ownership set.
    for (const range of context.simulationRanges) {
      for (let z = range.minZ; z <= range.maxZ; z++) {
        for (let y = range.minY; y <= range.maxY; y++) {
          for (let x = range.minX; x <= range.maxX; x++) {
            const base = (z * W * H + y * W + x) * CELL_FIELDS;
            buf[base + F.SIGNAL] = Math.max(
              0,
              buf[base + F.SIGNAL] - 0.5 * dt * 60,
            );
          }
        }
      }
    }
  }

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

  private _spawnChild(
    grid: VoxelGrid,
    parent: Entity,
    W: number,
    H: number,
    D: number,
    context: InfinityScaleChunkExecutionContext | null = null,
  ): void {
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

    // Selective execution may only create child state inside the current
    // simulation ownership set.
    if (
      buf[childBase + F.BIO_POTENTIAL] < 0.02 &&
      (!context || context.containsSimulationCell(nx, ny, nz))
    ) {
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
