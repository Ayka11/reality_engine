import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { PackageSerializer, type EntitySnapshot, type LawSnapshot, type ProcessSnapshot, type RealityPackage } from '../../creator';
import type { RealityGraph } from '../../creator/types';
import { F } from '../../core/CellState';
import { PROCESS_LIBRARY } from '../../process/ProcessDef';
import type { MetaLaw } from '../../laws/MetaLaw';
import type { CivSnapshot, StoredWorldSnapshot, WorldSaveSummary, WorldSnapshot } from './SaveFormats';
import { WorldSerializer } from './WorldSerializer';
import type { EntityLayerSnapshot } from '../../simulation/EntityLayer';
import type { AgentSystemSnapshot } from '../../simulation/AgentSystem';
import type { CivilizationSystemSnapshot } from '../../simulation/CivilizationSystem';
import type { LawEngineSnapshot } from '../../laws/LawEngine';
import type { ChemLayerSnapshot } from '../../chemistry/ChemLayer';
import type { WorldEventsSnapshot } from '../WorldEvents';
import type { CausalGraphSnapshot } from '../../simulation/CausalGraph';
import type { ClimateSystemSnapshot } from '../../simulation/ClimateSystem';
import type { MultiScaleSystemSnapshot } from '../../simulation/MultiScaleSystem';
import type { LanguageSystemSnapshot } from '../../simulation/LanguageEmergence';
import type { EconomicSystemSnapshot } from '../../simulation/EconomicSystem';
import type { MetaLawEvolutionSnapshot } from '../../simulation/MetaLawEvolution';
import type { CosmologicalSimSnapshot } from '../../simulation/CosmologicalSim';
import type { SceneDirectorSnapshot } from '../../ai/SceneDirector';

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
  syncDenseToChunks?: () => void;
  syncBackBuffersFromFront?: () => void;
}

interface LawEngineLike {
  laws: MetaLaw[];
  activeProcessMask: number;
  applyGraphPlan: (plan: any) => void;
}

interface SaveContext {
  graphProvider?: () => RealityGraph | undefined;
  graphLoader?: (graph: RealityGraph) => void;
  /** Synchronous engine-owned transaction used for field import/restore publication. */
  mutateAuthoritativeState?: <T>(mutation: () => T) => T;
  getTick?: () => number;
  setTick?: (tick: number) => void;
  getEntities?: () => unknown[];
  getCivs?: () => unknown[];
  loadCivs?: (civs: CivSnapshot[]) => void;
  getEntityLayerSnapshot?: () => EntityLayerSnapshot;
  restoreEntityLayerSnapshot?: (snapshot: EntityLayerSnapshot) => void;
  clearEntityLayerRuntime?: () => void;
  getAgentSystemSnapshot?: () => AgentSystemSnapshot;
  restoreAgentSystemSnapshot?: (snapshot: AgentSystemSnapshot) => void;
  clearAgentRuntime?: () => void;
  getCivSnapshot?: () => CivilizationSystemSnapshot;
  restoreCivSnapshot?: (snapshot: CivilizationSystemSnapshot) => void;
  getLawEngineSnapshot?: () => LawEngineSnapshot;
  restoreLawEngineSnapshot?: (snapshot: LawEngineSnapshot) => void;
  getChemistrySnapshot?: () => ChemLayerSnapshot;
  restoreChemistrySnapshot?: (snapshot: ChemLayerSnapshot) => void;
  resetChemistry?: () => void;
  getWorldEventsSnapshot?: () => WorldEventsSnapshot;
  restoreWorldEventsSnapshot?: (snapshot: WorldEventsSnapshot) => void;
  resetWorldEvents?: () => void;
  getCausalSnapshot?: () => CausalGraphSnapshot;
  restoreCausalSnapshot?: (snapshot: CausalGraphSnapshot) => void;
  resetCausal?: () => void;
  getPreviousEnergySnapshot?: () => Float32Array;
  restorePreviousEnergySnapshot?: (snapshot: Float32Array) => void;
  resetPreviousEnergy?: () => void;
  clearRecorderSnapshots?: () => void;
  getClimateSnapshot?: () => ClimateSystemSnapshot;
  restoreClimateSnapshot?: (snapshot: ClimateSystemSnapshot) => void;
  resetClimate?: () => void;
  getMultiScaleSnapshot?: () => MultiScaleSystemSnapshot;
  restoreMultiScaleSnapshot?: (snapshot: MultiScaleSystemSnapshot) => void;
  resetMultiScale?: () => void;
  getLanguageSnapshot?: () => LanguageSystemSnapshot;
  restoreLanguageSnapshot?: (snapshot: LanguageSystemSnapshot) => void;
  resetLanguage?: () => void;
  getEconomicSnapshot?: () => EconomicSystemSnapshot;
  restoreEconomicSnapshot?: (snapshot: EconomicSystemSnapshot) => void;
  resetEconomic?: () => void;
  getMetaLawEvolutionSnapshot?: () => MetaLawEvolutionSnapshot;
  restoreMetaLawEvolutionSnapshot?: (snapshot: MetaLawEvolutionSnapshot) => void;
  resetMetaLawEvolution?: () => void;
  getCosmologicalSnapshot?: () => CosmologicalSimSnapshot;
  restoreCosmologicalSnapshot?: (snapshot: CosmologicalSimSnapshot) => void;
  resetCosmological?: () => void;
  clearTimeline?: () => void;
  getDirectorSnapshot?: () => SceneDirectorSnapshot;
  restoreDirectorSnapshot?: (snapshot: SceneDirectorSnapshot) => void;
  resetDirector?: () => void;
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
      runtimeState: {
        entityLayer: this.context.getEntityLayerSnapshot?.(),
        agents: this.context.getAgentSystemSnapshot?.(),
        civilizations: this.context.getCivSnapshot?.(),
        laws: this.context.getLawEngineSnapshot?.(),
        chemistry: this.context.getChemistrySnapshot?.(),
        worldEvents: this.context.getWorldEventsSnapshot?.(),
        causal: this.context.getCausalSnapshot?.(),
        previousEnergy: this.context.getPreviousEnergySnapshot?.(),
        climate: this.context.getClimateSnapshot?.(),
        multiScale: this.context.getMultiScaleSnapshot?.(),
        language: this.context.getLanguageSnapshot?.(),
        economy: this.context.getEconomicSnapshot?.(),
        metaLawEvolution: this.context.getMetaLawEvolutionSnapshot?.(),
        cosmologicalSim: this.context.getCosmologicalSnapshot?.(),
        director: this.context.getDirectorSnapshot?.(),
      },
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
    const mutate = this.context.mutateAuthoritativeState;
    if (!mutate) {
      throw new Error("World restore requires an engine-owned mutation transaction");
    }
    const graphBefore = this.context.graphProvider?.();
    const entityBefore = this.context.getEntityLayerSnapshot?.();
    const agentsBefore = this.context.getAgentSystemSnapshot?.();
    const civBefore = this.context.getCivSnapshot?.();
    const lawsBefore = this.context.getLawEngineSnapshot?.();
    const chemistryBefore = this.context.getChemistrySnapshot?.();
    const worldEventsBefore = this.context.getWorldEventsSnapshot?.();
    const causalBefore = this.context.getCausalSnapshot?.();
    const previousEnergyBefore = this.context.getPreviousEnergySnapshot?.();
    const climateBefore = this.context.getClimateSnapshot?.();
    const multiScaleBefore = this.context.getMultiScaleSnapshot?.();
    const languageBefore = this.context.getLanguageSnapshot?.();
    const economicBefore = this.context.getEconomicSnapshot?.();
    const metaLawEvolutionBefore = this.context.getMetaLawEvolutionSnapshot?.();
    const cosmologicalBefore = this.context.getCosmologicalSnapshot?.();
    const directorBefore = this.context.getDirectorSnapshot?.();

    const apply = () => {
      if (snapshot.chunks && !this.voxelGrid.loadChunks) {
        throw new Error("World snapshot contains sparse chunks but the target grid cannot load them");
      }
      // Clear stale sparse chunks even for portable saves without a chunk payload.
      // Load chunks first because loadChunks synchronizes their state into the dense
      // window; the packed field snapshot is authoritative for that dense window.
      if (this.voxelGrid.loadChunks) {
        this.voxelGrid.loadChunks(snapshot.chunks?.serialized ?? []);
      }
      this.serializer.applyFields(snapshot.fields, this.voxelGrid.buffer);
      // Publish packed dense fields into overlapping chunks and align front/back
      // buffers before the enclosing engine transaction uploads to the GPU.
      this.voxelGrid.syncDenseToChunks?.();
      this.voxelGrid.syncBackBuffersFromFront?.();
      if (snapshot.realityGraph) this.context.graphLoader?.(snapshot.realityGraph);

      const runtime = snapshot.runtimeState;
      if (runtime?.laws && this.context.restoreLawEngineSnapshot) {
        this.context.restoreLawEngineSnapshot(runtime.laws);
      } else {
        this.loadLaws(snapshot.activeLaws);
        this.loadProcesses(snapshot.activeProcesses);
      }

      if (runtime?.entityLayer && this.context.restoreEntityLayerSnapshot) {
        this.context.restoreEntityLayerSnapshot(runtime.entityLayer);
      } else {
        // Portable/older saves do not contain the full spatial entity model.
        // Drop stale in-memory entities instead of leaving them inconsistent
        // with the loaded field data; the main app also clears ENTITY_ID cells.
        this.context.clearEntityLayerRuntime?.();
      }

      if (runtime?.agents && this.context.restoreAgentSystemSnapshot) {
        this.context.restoreAgentSystemSnapshot(runtime.agents);
      } else {
        this.context.clearAgentRuntime?.();
      }

      if (runtime?.civilizations && this.context.restoreCivSnapshot) {
        this.context.restoreCivSnapshot(runtime.civilizations);
      } else {
        this.context.loadCivs?.(snapshot.civilizations);
      }

      if (runtime?.chemistry && this.context.restoreChemistrySnapshot) {
        this.context.restoreChemistrySnapshot(runtime.chemistry);
      } else {
        this.context.resetChemistry?.();
      }
      if (runtime?.worldEvents && this.context.restoreWorldEventsSnapshot) {
        this.context.restoreWorldEventsSnapshot(runtime.worldEvents);
      } else {
        this.context.resetWorldEvents?.();
      }
      if (runtime?.causal && this.context.restoreCausalSnapshot) {
        this.context.restoreCausalSnapshot(runtime.causal);
      } else {
        this.context.resetCausal?.();
      }
      if (runtime?.previousEnergy && this.context.restorePreviousEnergySnapshot) {
        this.context.restorePreviousEnergySnapshot(runtime.previousEnergy);
      } else {
        this.context.resetPreviousEnergy?.();
      }
      if (runtime?.climate && this.context.restoreClimateSnapshot) {
        this.context.restoreClimateSnapshot(runtime.climate);
      } else {
        this.context.resetClimate?.();
      }
      if (runtime?.multiScale && this.context.restoreMultiScaleSnapshot) {
        this.context.restoreMultiScaleSnapshot(runtime.multiScale);
      } else {
        this.context.resetMultiScale?.();
      }
      if (runtime?.language && this.context.restoreLanguageSnapshot) {
        this.context.restoreLanguageSnapshot(runtime.language);
      } else {
        this.context.resetLanguage?.();
      }
      if (runtime?.economy && this.context.restoreEconomicSnapshot) {
        this.context.restoreEconomicSnapshot(runtime.economy);
      } else {
        this.context.resetEconomic?.();
      }
      if (runtime?.metaLawEvolution && this.context.restoreMetaLawEvolutionSnapshot) {
        this.context.restoreMetaLawEvolutionSnapshot(runtime.metaLawEvolution);
      } else {
        this.context.resetMetaLawEvolution?.();
      }
      if (runtime?.cosmologicalSim && this.context.restoreCosmologicalSnapshot) {
        this.context.restoreCosmologicalSnapshot(runtime.cosmologicalSim);
      } else {
        this.context.resetCosmological?.();
      }
      if (runtime?.director && this.context.restoreDirectorSnapshot) {
        this.context.restoreDirectorSnapshot(runtime.director);
      } else {
        this.context.resetDirector?.();
      }

      // Recorder entries currently store field frames, not full runtime checkpoints.
      // Never leave history from the previous world attached to the restored field.
      this.context.clearRecorderSnapshots?.();
      this.context.setTick?.(snapshot.metadata.simulationTicks);
    };

    try {
      // One synchronous engine transaction covers field/chunk publication,
      // runtime subsystems, tick and GPU upload. This callback must not await.
      mutate(apply);
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      const rollback = (label: string, restore: (() => void) | undefined) => {
        if (!restore) return;
        try {
          restore();
        } catch (rollbackError) {
          rollbackErrors.push(new Error(`${label} rollback failed: ${String(rollbackError)}`));
        }
      };
      if (graphBefore !== undefined && this.context.graphLoader) {
        rollback("Graph", () => this.context.graphLoader!(graphBefore));
      }
      if (entityBefore !== undefined && this.context.restoreEntityLayerSnapshot) {
        rollback("Entity layer", () => this.context.restoreEntityLayerSnapshot!(entityBefore));
      }
      if (agentsBefore !== undefined && this.context.restoreAgentSystemSnapshot) {
        rollback("Agents", () => this.context.restoreAgentSystemSnapshot!(agentsBefore));
      }
      if (civBefore !== undefined && this.context.restoreCivSnapshot) {
        rollback("Civilization", () => this.context.restoreCivSnapshot!(civBefore));
      }
      if (lawsBefore !== undefined && this.context.restoreLawEngineSnapshot) {
        rollback("Laws", () => this.context.restoreLawEngineSnapshot!(lawsBefore));
      }
      if (chemistryBefore !== undefined && this.context.restoreChemistrySnapshot) {
        rollback("Chemistry", () => this.context.restoreChemistrySnapshot!(chemistryBefore));
      }
      if (worldEventsBefore !== undefined && this.context.restoreWorldEventsSnapshot) {
        rollback("World events", () => this.context.restoreWorldEventsSnapshot!(worldEventsBefore));
      }
      if (causalBefore !== undefined && this.context.restoreCausalSnapshot) {
        rollback("Causal graph", () => this.context.restoreCausalSnapshot!(causalBefore));
      }
      if (previousEnergyBefore !== undefined && this.context.restorePreviousEnergySnapshot) {
        rollback("Previous-energy baseline", () => this.context.restorePreviousEnergySnapshot!(previousEnergyBefore));
      }
      if (climateBefore !== undefined && this.context.restoreClimateSnapshot) {
        rollback("Climate", () => this.context.restoreClimateSnapshot!(climateBefore));
      }
      if (multiScaleBefore !== undefined && this.context.restoreMultiScaleSnapshot) {
        rollback("Multiscale", () => this.context.restoreMultiScaleSnapshot!(multiScaleBefore));
      }
      if (languageBefore !== undefined && this.context.restoreLanguageSnapshot) {
        rollback("Language", () => this.context.restoreLanguageSnapshot!(languageBefore));
      }
      if (economicBefore !== undefined && this.context.restoreEconomicSnapshot) {
        rollback("Economy", () => this.context.restoreEconomicSnapshot!(economicBefore));
      }
      if (metaLawEvolutionBefore !== undefined && this.context.restoreMetaLawEvolutionSnapshot) {
        rollback("Meta-law evolution", () => this.context.restoreMetaLawEvolutionSnapshot!(metaLawEvolutionBefore));
      }
      if (cosmologicalBefore !== undefined && this.context.restoreCosmologicalSnapshot) {
        rollback("Cosmological simulation", () => this.context.restoreCosmologicalSnapshot!(cosmologicalBefore));
      }
      if (directorBefore !== undefined && this.context.restoreDirectorSnapshot) {
        rollback("Scene director", () => this.context.restoreDirectorSnapshot!(directorBefore));
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "World restore failed and one or more runtime-domain rollbacks also failed",
        );
      }
      throw error;
    }

    // Timeline is a history of grid-only frames, not a full world checkpoint.
    // Clear it only after the new world transaction commits successfully.
    this.context.clearTimeline?.();
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
