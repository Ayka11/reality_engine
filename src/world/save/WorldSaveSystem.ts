import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { PackageSerializer, type EntitySnapshot, type LawSnapshot, type ProcessSnapshot, type RealityPackage } from '../../creator';
import type { RealityGraph } from '../../creator/types';
import { F } from '../../core/CellState';
import { PROCESS_LIBRARY } from '../../process/ProcessDef';
import type { MetaLaw } from '../../laws/MetaLaw';
import type { CivSnapshot, StoredWorldSnapshot, WorldSaveSummary, WorldSnapshot } from './SaveFormats';
import { WorldSerializer } from './WorldSerializer';

interface RealitySaveDb extends DBSchema {
  saves: {
    key: string;
    value: StoredWorldSnapshot;
    indexes: { 'by-timestamp': number };
  };
}

interface GridLike {
  W: number;
  H: number;
  D: number;
  size: number;
  buffer: Float32Array;
  totalField: (fieldIdx: number) => number;
  chunkSize?: number;
  activeChunkCount?: number;
  serializeChunks?: (includeEmpty?: boolean) => NonNullable<WorldSnapshot['chunks']>['serialized'];
  loadChunks?: (chunks: NonNullable<WorldSnapshot['chunks']>['serialized']) => void;
}

interface LawEngineLike {
  laws: MetaLaw[];
  activeProcessMask: number;
  applyGraphPlan: (plan: any) => void;
}

interface SaveContext {
  graphProvider?: () => RealityGraph | undefined;
  graphLoader?: (graph: RealityGraph) => void;
  syncToGPU?: () => void;
  getTick?: () => number;
  setTick?: (tick: number) => void;
  getEntities?: () => unknown[];
  getCivs?: () => unknown[];
  loadCivs?: (civs: CivSnapshot[]) => void;
  getCausalLog?: () => unknown[];
  thumbnailCanvas?: HTMLCanvasElement | null;
}

export class WorldSaveSystem {
  private currentSnapshot: WorldSnapshot | null = null;
  private serializer = new WorldSerializer();
  private packageSerializer: PackageSerializer;
  private dbPromise: Promise<IDBPDatabase<RealitySaveDb>> | null = null;

  constructor(private voxelGrid: GridLike, private lawEngine: LawEngineLike, private processSystem: unknown, private context: SaveContext = {}) {
    void this.processSystem;
    this.packageSerializer = new PackageSerializer(context.thumbnailCanvas);
  }

  async quickSave(name = `World_${Date.now()}`): Promise<string> {
    const snapshot = this.captureSnapshot(name);
    this.currentSnapshot = snapshot;
    await this.saveToIndexedDB(snapshot);
    return snapshot.name;
  }

  getCurrentSnapshot(): WorldSnapshot | null {
    return this.currentSnapshot;
  }

  async loadQuickSave(idOrName?: string): Promise<WorldSnapshot | null> {
    const db = await this.db();
    const saves = await db.getAll('saves');
    const sorted = saves.sort((a, b) => b.timestamp - a.timestamp);
    const found = idOrName
      ? sorted.find(save => save.id === idOrName || save.name === idOrName)
      : sorted[0];
    if (!found) return null;
    await this.applySnapshot(found.snapshot);
    return found.snapshot;
  }

  async listQuickSaves(): Promise<WorldSaveSummary[]> {
    const db = await this.db();
    const saves = await db.getAll('saves');
    return saves
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(save => ({
        id: save.id,
        name: save.name,
        timestamp: save.timestamp,
        format: save.format,
        metadata: save.snapshot.metadata,
      }));
  }

  async exportRealityPackage(name: string): Promise<Blob> {
    const snapshot = this.captureSnapshot(name);
    return this.packageSerializer.pack(this.snapshotToPackage(snapshot));
  }

  async importRealityPackage(file: File): Promise<void> {
    const pkg = await this.packageSerializer.unpack(file);
    await this.applySnapshot(this.packageToSnapshot(pkg));
  }

  captureSnapshot(name: string): WorldSnapshot {
    const fields = this.serializer.captureAllFields(this.voxelGrid.buffer);
    const activeLaws = this.lawEngine.laws.filter(law => law.active);

    return {
      version: '4.1',
      timestamp: Date.now(),
      name,
      gridSize: { width: this.voxelGrid.W, height: this.voxelGrid.H, depth: this.voxelGrid.D },
      fields,
      realityGraph: this.context.graphProvider?.(),
      activeLaws: activeLaws.map(law => this.snapshotLaw(law)),
      activeProcesses: this.captureProcesses(),
      entities: this.captureEntities(),
      civilizations: this.captureCivs(),
      metadata: this.calculateMetadata(activeLaws.length),
      causalLog: this.context.getCausalLog?.() ?? [],
      chunks: this.voxelGrid.serializeChunks ? {
        chunkSize: this.voxelGrid.chunkSize ?? 32,
        activeCount: this.voxelGrid.activeChunkCount ?? 0,
        serialized: this.voxelGrid.serializeChunks(false),
      } : undefined,
    };
  }

  async applySnapshot(snapshot: WorldSnapshot): Promise<void> {
    this.serializer.applyFields(snapshot.fields, this.voxelGrid.buffer);
    if (snapshot.chunks && this.voxelGrid.loadChunks) this.voxelGrid.loadChunks(snapshot.chunks.serialized);
    if (snapshot.realityGraph) this.context.graphLoader?.(snapshot.realityGraph);
    this.loadLaws(snapshot.activeLaws);
    this.loadProcesses(snapshot.activeProcesses);
    this.context.loadCivs?.(snapshot.civilizations);
    this.context.setTick?.(snapshot.metadata.simulationTicks);
    this.context.syncToGPU?.();
    this.currentSnapshot = snapshot;
    console.info(`World "${snapshot.name}" fully restored.`);
  }

  private async saveToIndexedDB(snapshot: WorldSnapshot): Promise<void> {
    const db = await this.db();
    const id = `${snapshot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${snapshot.timestamp}`;
    await db.put('saves', { id, name: snapshot.name, timestamp: snapshot.timestamp, format: 'quick', snapshot });
  }

  private db(): Promise<IDBPDatabase<RealitySaveDb>> {
    this.dbPromise ??= openDB<RealitySaveDb>('reality-engine-world-saves', 1, {
      upgrade(db) {
        const store = db.createObjectStore('saves', { keyPath: 'id' });
        store.createIndex('by-timestamp', 'timestamp');
      },
    });
    return this.dbPromise;
  }

  private snapshotToPackage(snapshot: WorldSnapshot): RealityPackage {
    return {
      manifest: {
        version: '1.0',
        name: snapshot.name,
        author: 'Reality Engine',
        created: new Date(snapshot.timestamp).toISOString(),
        description: 'World Save System export.',
        tags: ['world-save', 'reality-package'],
        compatibility: 'v4+',
      },
      graph: snapshot.realityGraph ?? {
        nodes: [],
        edges: [],
        metadata: { name: snapshot.name, version: '1.0.0', author: 'Reality Engine', timestamp: snapshot.timestamp },
      },
      voxelState: this.serializer.flattenFields(snapshot.fields, this.voxelGrid.size),
      entities: snapshot.entities,
      laws: snapshot.activeLaws,
      processes: snapshot.activeProcesses,
      metadata: {
        gridSize: { x: snapshot.gridSize.width, y: snapshot.gridSize.height, z: snapshot.gridSize.depth },
        totalEnergy: snapshot.metadata.totalEnergy,
        entropy: snapshot.metadata.entropy,
        complexityScore: snapshot.metadata.complexity,
        dominantLaws: snapshot.activeLaws.slice(0, 5).map(law => law.name),
      },
    };
  }

  private packageToSnapshot(pkg: RealityPackage): WorldSnapshot {
    return {
      version: '4.1',
      timestamp: Date.now(),
      name: pkg.manifest.name,
      gridSize: { width: pkg.metadata.gridSize.x, height: pkg.metadata.gridSize.y, depth: pkg.metadata.gridSize.z },
      fields: this.serializer.fieldsFromFlatBuffer(pkg.voxelState),
      realityGraph: pkg.graph,
      activeLaws: pkg.laws,
      activeProcesses: pkg.processes,
      entities: pkg.entities,
      civilizations: [],
      metadata: {
        totalEnergy: pkg.metadata.totalEnergy,
        entropy: pkg.metadata.entropy,
        complexity: pkg.metadata.complexityScore,
        activeLawsCount: pkg.laws.length,
        entityCount: pkg.entities.length,
        simulationTicks: this.context.getTick?.() ?? 0,
        dominantBiome: 'imported',
      },
    };
  }

  private loadLaws(laws: LawSnapshot[]): void {
    this.lawEngine.laws = laws.map(snapshot => {
      const effects = (snapshot.effects ?? {}) as Record<string, any>;
      return {
        id: snapshot.id,
        name: snapshot.name,
        active: true,
        conditions: Array.isArray(snapshot.conditions) ? snapshot.conditions : [],
        enablesProcesses: Array.isArray(effects.enablesProcesses) ? effects.enablesProcesses : [],
        disablesProcesses: Array.isArray(effects.disablesProcesses) ? effects.disablesProcesses : [],
        paramOverrides: effects.paramOverrides ?? {},
        fitness: snapshot.fitness,
        age: Number(effects.age ?? 0),
        mutationRate: snapshot.mutationRate,
        generation: Number(effects.generation ?? 0),
        parentId: snapshot.parentId,
        color: String(effects.color ?? '#7c9fff'),
      };
    });
  }

  private loadProcesses(processes: ProcessSnapshot[]): void {
    this.lawEngine.applyGraphPlan({
      executionOrder: [],
      boundParameters: new Map(),
      gpuPasses: [],
      activeProcessIds: processes.filter(process => process.enabled).map(process => process.id),
      issues: [],
    });
  }

  private snapshotLaw(law: MetaLaw): LawSnapshot {
    return {
      id: law.id,
      name: law.name,
      conditions: law.conditions,
      effects: {
        active: law.active,
        enablesProcesses: law.enablesProcesses,
        disablesProcesses: law.disablesProcesses,
        paramOverrides: law.paramOverrides,
        color: law.color,
        age: law.age,
        generation: law.generation,
      },
      fitness: law.fitness,
      mutationRate: law.mutationRate,
      parentId: law.parentId,
    };
  }

  private captureProcesses(): ProcessSnapshot[] {
    const mask = this.lawEngine.activeProcessMask;
    return PROCESS_LIBRARY.map(process => ({
      id: process.id,
      name: process.name,
      enabled: (mask & (1 << process.id)) !== 0,
      parameters: {
        entropyCost: process.entropyCost,
        stabilityImpact: process.stabilityImpact,
        mutable: process.mutable,
      },
    }));
  }

  private captureEntities(): EntitySnapshot[] {
    const entities = this.context.getEntities?.() ?? [];
    return entities.map((entity, index) => {
      const e = entity as Record<string, any>;
      return {
        id: String(e.id ?? index),
        type: String(e.stage ?? e.type ?? 'entity'),
        genome: e.genome ?? null,
        position: Array.isArray(e.centroid) ? [Number(e.centroid[0]), Number(e.centroid[1]), Number(e.centroid[2])] : [0, 0, 0],
        energy: Number(e.energy ?? 0),
        memory: e.memoryBuffer ? Array.from(e.memoryBuffer as ArrayLike<number>) : undefined,
      };
    });
  }

  private captureCivs(): CivSnapshot[] {
    const civs = this.context.getCivs?.() ?? [];
    return civs.map(civ => structuredClone(civ as CivSnapshot));
  }

  private calculateMetadata(activeLawsCount: number): WorldSnapshot['metadata'] {
    const entityCount = this.context.getEntities?.().length ?? 0;
    const entropy = this.voxelGrid.totalField(F.ENTROPY) / this.voxelGrid.size;
    return {
      totalEnergy: this.voxelGrid.totalField(F.ENERGY),
      entropy,
      complexity: this.voxelGrid.totalField(F.INFORMATION) / this.voxelGrid.size + this.voxelGrid.totalField(F.BIO_POTENTIAL) / this.voxelGrid.size,
      activeLawsCount,
      entityCount,
      simulationTicks: this.context.getTick?.() ?? 0,
      dominantBiome: 'dynamic',
    };
  }
}
