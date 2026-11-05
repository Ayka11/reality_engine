import { GraphCompiler, NodeRegistry, PackageSerializer, RealityGraph } from '../creator';
import type { EntitySnapshot, GraphExecutionPlan, LawSnapshot, RealityGraphData, RealityNode, RealityPackage } from '../creator';
import { LawEngine, type LawEngineSnapshot } from '../laws/LawEngine';
import { EntityLayer, type EntityLayerSnapshot } from '../simulation/EntityLayer';
import { CELL_FIELDS, F } from '../core/CellState';
import type { MetaLaw } from '../laws/MetaLaw';
import { PROCESS_LIBRARY } from '../process/ProcessDef';
import { NodeEditorCanvas } from './NodeEditorCanvas';

interface LawProcessEditorOptions {
  lawEngine: LawEngine;
  simulation?: {
    grid: {
      W: number;
      H: number;
      D: number;
      size: number;
      buffer: Float32Array;
      totalField: (fieldIdx: number) => number;
      chunkSize?: number;
      activeChunkCount?: number;
      serializeChunks?: (includeEmpty?: boolean) => NonNullable<RealityPackage['chunks']>['serialized'];
      loadChunks?: (chunks: NonNullable<RealityPackage['chunks']>['serialized']) => void;
    };
    tick: number;
    syncToGPU: () => void;
    entityLayer: {
      getEntities: () => unknown[];
      snapshot: () => EntityLayerSnapshot;
      restore: (snapshot: EntityLayerSnapshot, cellCount?: number) => void;
      clear: () => void;
    };
    mutateAuthoritativeState: <T>(mutation: () => T) => T;
    runAtStepBoundary: <T>(operation: () => T) => Promise<T>;
  };
  /** Route application exports through WorldSaveSystem for full runtime/chunk coverage. */
  exportWorldPackage?: (name: string) => Promise<Blob>;
  /** Route application imports through the same complete, transactional restore path. */
  importWorldPackage?: (file: File) => Promise<void>;
  thumbnailCanvas?: HTMLCanvasElement | null;
  processSystem?: { setActiveProcesses?: (processes: unknown[]) => void };
}

function firstPort(node: RealityNode, direction: 'input' | 'output', type: string): string | null {
  return (direction === 'input' ? node.inputs : node.outputs).find(port => port.type === type)?.id ?? null;
}

export class LawProcessEditor {
  readonly graph = new RealityGraph();
  readonly compiler = new GraphCompiler();
  readonly registry = new NodeRegistry();
  readonly serializer: PackageSerializer;
  private canvasEditor: NodeEditorCanvas | null = null;
  private selectedNode: RealityNode | null = null;
  private inspector: HTMLDivElement | null = null;
  private status: HTMLDivElement | null = null;
  private fileInput: HTMLInputElement | null = null;

  constructor(private root: HTMLElement, private options: LawProcessEditorOptions) {
    this.serializer = new PackageSerializer(options.thumbnailCanvas);
    this.registry.initializeFromEngine(options.lawEngine, PROCESS_LIBRARY);
    this.seedExampleGraph();
    this.render();
  }

  compileAndApply(): GraphExecutionPlan {
    const plan = this.compiler.compile(this.graph);
    this.options.lawEngine.applyGraphPlan(plan);
    this.options.processSystem?.setActiveProcesses?.(plan.executionOrder);
    console.info('[RealityCreator] compiled graph plan', plan);
    this.status!.textContent = plan.issues.length
      ? `Compiled with ${plan.issues.length} issue(s). Active processes: ${plan.activeProcessIds.length}`
      : `Compiled. Active processes: ${plan.activeProcessIds.length}`;
    this.canvasEditor?.setPlan(plan);
    return plan;
  }

  async exportPackage(): Promise<void> {
    try {
      const simulation = this.options.simulation;
      if (!simulation) {
        this.status!.textContent = 'Package export needs a simulation instance.';
        return;
      }

      const packageName = `Reality t${simulation.tick}`;
      let blob: Blob;
      if (this.options.exportWorldPackage) {
        // The application's World Save System owns the complete runtime, chunk,
        // graph and simulation-clock snapshot for every normal .reality export.
        blob = await this.options.exportWorldPackage(packageName);
      } else {
        // Retain a coherent, self-contained fallback for editors used without the
        // application's World Save System integration.
        const pkg = await simulation.runAtStepBoundary(() => this.buildPackage());
        blob = await this.serializer.pack(pkg);
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${packageName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.reality`;
      anchor.click();
      URL.revokeObjectURL(url);
      this.status!.textContent = `Exported ${anchor.download}`;
    } catch (error) {
      this.status!.textContent = error instanceof Error
        ? `Export failed: ${error.message}`
        : 'Export failed.';
      console.error('[RealityCreator] package export failed', error);
    }
  }

  async importPackageFile(file: File): Promise<void> {
    try {
      if (this.options.importWorldPackage) {
        // The application World Save System restores the complete runtime,
        // sparse chunks, graph, simulation clock and engine-owned field atomically.
        await this.options.importWorldPackage(file);
        this.status!.textContent = `Imported ${file.name}.`;
        return;
      }

      // Keep standalone Creator Studio instances functional without the app's
      // World Save System integration.
      const pkg = await this.serializer.unpack(file);
      this.applyPackage(pkg);
      this.status!.textContent = `Imported ${pkg.manifest.name}.`;
    } catch (error) {
      this.status!.textContent = error instanceof Error ? error.message : 'Import failed.';
    }
  }

  loadGraph(graph: RealityGraphData): void {
    this.graph.load(graph);
    this.canvasEditor?.setData(this.graph.nodes, this.graph.edges);
    this.selectedNode = null;
    this.renderInspector();
  }

  private buildPackage(): RealityPackage {
    const sim = this.options.simulation!;
    const activeMask = this.options.lawEngine.activeProcessMask;
    const totalEnergy = sim.grid.totalField(0);
    const entropy = sim.grid.totalField(3) / sim.grid.size;
    const activeLaws = this.options.lawEngine.laws.filter(law => law.active);

    return {
      manifest: {
        version: '1.0',
        name: `Reality t${sim.tick}`,
        author: 'Reality Engine',
        created: new Date().toISOString(),
        description: 'Portable Reality Engine package exported from Creator Studio.',
        tags: ['creator-engine', 'node-graph', 'simulation'],
        compatibility: 'v4+',
      },
      graph: this.graph.toJSON(),
      voxelState: sim.grid.buffer.slice().buffer,
      chunks: sim.grid.serializeChunks ? {
        chunkSize: sim.grid.chunkSize ?? 32,
        activeCount: sim.grid.activeChunkCount ?? 0,
        serialized: sim.grid.serializeChunks(false),
      } : undefined,
      entities: this.snapshotEntities(),
      runtimeEntityLayer: sim.entityLayer.snapshot(),
      laws: this.options.lawEngine.laws.map(law => this.snapshotLaw(law)),
      lawEngineState: this.options.lawEngine.snapshot(),
      processes: PROCESS_LIBRARY.map(process => ({
        id: process.id,
        name: process.name,
        enabled: (activeMask & (1 << process.id)) !== 0,
        parameters: {
          entropyCost: process.entropyCost,
          stabilityImpact: process.stabilityImpact,
          mutable: process.mutable,
        },
      })),
      metadata: {
        gridSize: { x: sim.grid.W, y: sim.grid.H, z: sim.grid.D },
        simulationTicks: sim.tick,
        totalEnergy,
        entropy,
        complexityScore: sim.grid.totalField(4) / sim.grid.size + sim.grid.totalField(5) / sim.grid.size,
        dominantLaws: activeLaws.slice(0, 5).map(law => law.name),
      },
    };
  }

  private snapshotEntities(): EntitySnapshot[] {
    const entities = this.options.simulation?.entityLayer?.getEntities?.() ?? [];
    return entities.map((entity, index) => {
      const e = entity as Record<string, any>;
      const centroid = Array.isArray(e.centroid) ? e.centroid : [0, 0, 0];
      return {
        id: String(e.id ?? index),
        type: String(e.stage ?? e.type ?? 'entity'),
        genome: e.genome ?? e.traits ?? null,
        position: [Number(centroid[0] ?? 0), Number(centroid[1] ?? 0), Number(centroid[2] ?? 0)],
        energy: Number(e.energy ?? 0),
        memory: e.memory,
      };
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

  private applyPackage(pkg: RealityPackage): void {
    const candidate = this.preflightPackage(pkg);
    const sim = this.options.simulation!;
    const graphBefore = this.graph.toJSON();

    try {
      // The engine transaction owns field, entity and law rollback. The graph is
      // an editor-side domain, so its prior value is restored explicitly below.
      sim.mutateAuthoritativeState(() => {
        if (sim.grid.loadChunks) {
          // Legacy packages without chunk payloads replace the sparse domain with an empty one.
          sim.grid.loadChunks(candidate.chunks?.serialized ?? []);
        }
        sim.grid.buffer.set(candidate.voxelState);
        if (candidate.entityLayer) {
          sim.entityLayer.restore(candidate.entityLayer, sim.grid.size);
        } else {
          // Legacy packages only carried entity summaries, not cell membership,
          // allocator or RNG state. Clear both the entity model and stale cell IDs.
          sim.entityLayer.clear();
          for (let offset = F.ENTITY_ID; offset < sim.grid.buffer.length; offset += CELL_FIELDS) {
            sim.grid.buffer[offset] = 0;
          }
        }
        this.options.lawEngine.restore(candidate.lawEngine);
        this.graph.load(candidate.graph);
      });
    } catch (error) {
      try {
        this.graph.load(graphBefore);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Reality package import failed and the Creator Graph rollback also failed',
        );
      }
      throw error;
    }

    this.canvasEditor?.setData(this.graph.nodes, this.graph.edges);
    this.selectedNode = null;
    this.renderInspector();
  }

  private preflightPackage(pkg: RealityPackage): {
    graph: RealityGraphData;
    voxelState: Float32Array;
    chunks: NonNullable<RealityPackage['chunks']> | null;
    entityLayer: EntityLayerSnapshot | null;
    lawEngine: LawEngineSnapshot;
  } {
    const sim = this.options.simulation;
    if (!sim) throw new Error('Package import needs a simulation instance.');
    if (!pkg || typeof pkg !== 'object' ||
        !pkg.manifest || typeof pkg.manifest !== 'object' ||
        !pkg.metadata || typeof pkg.metadata !== 'object' ||
        !Array.isArray(pkg.entities) || !Array.isArray(pkg.laws) || !Array.isArray(pkg.processes)) {
      throw new Error('Reality package has an invalid envelope.');
    }

    for (const [field, value] of Object.entries({
      version: pkg.manifest.version,
      name: pkg.manifest.name,
      author: pkg.manifest.author,
      created: pkg.manifest.created,
      description: pkg.manifest.description,
      compatibility: pkg.manifest.compatibility,
    })) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Reality package manifest field "${field}" is invalid.`);
      }
    }
    if (!Array.isArray(pkg.manifest.tags) ||
        !pkg.manifest.tags.every(tag => typeof tag === 'string')) {
      throw new Error('Reality package manifest tags are invalid.');
    }

    const dimensions = pkg.metadata.gridSize;
    if (!dimensions ||
        !Number.isSafeInteger(dimensions.x) || dimensions.x <= 0 ||
        !Number.isSafeInteger(dimensions.y) || dimensions.y <= 0 ||
        !Number.isSafeInteger(dimensions.z) || dimensions.z <= 0 ||
        dimensions.x !== sim.grid.W ||
        dimensions.y !== sim.grid.H ||
        dimensions.z !== sim.grid.D) {
      throw new Error(
        `Reality package grid dimensions do not match the active simulation: ${dimensions?.x}x${dimensions?.y}x${dimensions?.z}.`,
      );
    }
    if (!(pkg.voxelState instanceof ArrayBuffer) ||
        pkg.voxelState.byteLength !== sim.grid.buffer.byteLength) {
      throw new Error(
        `Voxel state size mismatch: package has ${pkg.voxelState instanceof ArrayBuffer ? pkg.voxelState.byteLength : 'invalid'} bytes, grid expects ${sim.grid.buffer.byteLength}.`,
      );
    }
    const voxelState = new Float32Array(pkg.voxelState.slice(0));
    if (!voxelState.every(Number.isFinite)) {
      throw new Error('Reality package voxel state contains non-finite field values.');
    }

    let chunks: NonNullable<RealityPackage['chunks']> | null = null;
    if (pkg.chunks !== undefined) {
      const expectedChunkSize = sim.grid.chunkSize ?? 32;
      if (!pkg.chunks || !Number.isSafeInteger(pkg.chunks.chunkSize) ||
          pkg.chunks.chunkSize !== expectedChunkSize ||
          !Number.isSafeInteger(pkg.chunks.activeCount) || pkg.chunks.activeCount < 0 ||
          !Array.isArray(pkg.chunks.serialized) || !sim.grid.loadChunks) {
        throw new Error('Reality package sparse chunk envelope is invalid or unsupported by the active grid.');
      }
      const expectedChunkBytes = expectedChunkSize ** 3 * CELL_FIELDS * Float32Array.BYTES_PER_ELEMENT;
      const chunkKeys = new Set<string>();
      const serialized = pkg.chunks.serialized.map((chunk, index) => {
        if (!chunk || typeof chunk.key !== 'string' ||
            !Number.isSafeInteger(chunk.cx) ||
            !Number.isSafeInteger(chunk.cy) ||
            !Number.isSafeInteger(chunk.cz) ||
            chunk.key !== `${chunk.cx},${chunk.cy},${chunk.cz}` ||
            chunkKeys.has(chunk.key) ||
            typeof chunk.active !== 'boolean' ||
            !(chunk.buffer instanceof ArrayBuffer) ||
            chunk.buffer.byteLength !== expectedChunkBytes ||
            !new Float32Array(chunk.buffer).every(Number.isFinite)) {
          throw new Error(`Reality package sparse chunk record ${index} is invalid.`);
        }
        chunkKeys.add(chunk.key);
        return { ...chunk, buffer: chunk.buffer.slice(0) };
      });
      chunks = {
        chunkSize: expectedChunkSize,
        activeCount: pkg.chunks.activeCount,
        serialized,
      };
    }

    for (const [field, value] of Object.entries({
      totalEnergy: pkg.metadata.totalEnergy,
      entropy: pkg.metadata.entropy,
      complexityScore: pkg.metadata.complexityScore,
    })) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Reality package metadata field "${field}" is invalid.`);
      }
    }
    if (!Array.isArray(pkg.metadata.dominantLaws) ||
        !pkg.metadata.dominantLaws.every(name => typeof name === 'string')) {
      throw new Error('Reality package dominant law metadata is invalid.');
    }
    if (pkg.metadata.simulationTicks !== undefined &&
        (!Number.isSafeInteger(pkg.metadata.simulationTicks) || pkg.metadata.simulationTicks < 0)) {
      throw new Error('Reality package simulation tick metadata is invalid.');
    }

    // Validate the graph on a detached instance; no active editor state changes
    // during preflight, even if a later package component is malformed.
    const graphCandidate = new RealityGraph();
    graphCandidate.load(pkg.graph);

    const allowedProcessIds = new Set(PROCESS_LIBRARY.map(process => process.id));
    const processIds = new Set<number>();
    for (const process of pkg.processes) {
      if (!process || !Number.isSafeInteger(process.id) ||
          !allowedProcessIds.has(process.id as never) ||
          typeof process.name !== 'string' || !process.name ||
          typeof process.enabled !== 'boolean' ||
          !process.parameters || typeof process.parameters !== 'object' || Array.isArray(process.parameters) ||
          Object.values(process.parameters).some(value => typeof value !== 'number' && typeof value !== 'boolean')) {
        throw new Error('Reality package contains an invalid process snapshot.');
      }
      if (processIds.has(process.id)) throw new Error(`Reality package contains duplicate process ID ${process.id}.`);
      processIds.add(process.id);
    }

    let lawEngineState: LawEngineSnapshot;
    if (pkg.lawEngineState) {
      lawEngineState = structuredClone(pkg.lawEngineState);
    } else {
      const legacyLaws = pkg.laws.map(snapshot => {
        if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id ||
            typeof snapshot.name !== 'string' || !snapshot.name ||
            typeof snapshot.fitness !== 'number' || !Number.isFinite(snapshot.fitness) ||
            typeof snapshot.mutationRate !== 'number' || !Number.isFinite(snapshot.mutationRate)) {
          throw new Error('Reality package contains an invalid legacy law snapshot.');
        }
        const effects = snapshot.effects && typeof snapshot.effects === 'object'
          ? snapshot.effects as Record<string, unknown>
          : {};
        return {
          id: snapshot.id,
          name: snapshot.name,
          active: effects.active === true,
          conditions: Array.isArray(snapshot.conditions) ? snapshot.conditions : [],
          enablesProcesses: Array.isArray(effects.enablesProcesses) ? effects.enablesProcesses : [],
          disablesProcesses: Array.isArray(effects.disablesProcesses) ? effects.disablesProcesses : [],
          paramOverrides: effects.paramOverrides && typeof effects.paramOverrides === 'object'
            ? effects.paramOverrides
            : {},
          fitness: snapshot.fitness,
          age: Number.isSafeInteger(effects.age) && (effects.age as number) >= 0 ? effects.age as number : 0,
          mutationRate: snapshot.mutationRate,
          generation: Number.isSafeInteger(effects.generation) && (effects.generation as number) >= 0
            ? effects.generation as number
            : 0,
          parentId: snapshot.parentId,
          color: typeof effects.color === 'string' ? effects.color : '#7c9fff',
        };
      });
      lawEngineState = {
        ...this.options.lawEngine.snapshot(),
        laws: legacyLaws,
        lawOverrides: [],
        manualOn: [],
        manualOff: [],
        graphProcessIds: pkg.processes.filter(process => process.enabled).map(process => process.id),
      };
    }
    const lawValidator = new LawEngine();
    lawValidator.restore(lawEngineState);
    lawEngineState = lawValidator.snapshot();

    let entityLayer: EntityLayerSnapshot | null = null;
    if (pkg.runtimeEntityLayer !== undefined) {
      const entityValidator = new EntityLayer();
      entityValidator.restore(pkg.runtimeEntityLayer, sim.grid.size);
      entityLayer = entityValidator.snapshot();

      // The spatial entity model and the voxel ENTITY_ID channel are one domain.
      // Reject packages where either side points at a different owner/cell set.
      const ownerByCell = new Map<number, number>();
      for (const entity of entityLayer.entities) {
        for (const cellIndex of entity.cells) {
          ownerByCell.set(cellIndex, entity.id);
          const fieldOwner = voxelState[cellIndex * CELL_FIELDS + F.ENTITY_ID];
          if (fieldOwner !== entity.id) {
            throw new Error(`Reality package entity ${entity.id} does not match voxel ownership at cell ${cellIndex}.`);
          }
        }
      }
      for (let cellIndex = 0; cellIndex < sim.grid.size; cellIndex++) {
        const fieldOwner = voxelState[cellIndex * CELL_FIELDS + F.ENTITY_ID];
        if (fieldOwner !== 0 && ownerByCell.get(cellIndex) !== fieldOwner) {
          throw new Error(`Reality package voxel cell ${cellIndex} references missing entity ${fieldOwner}.`);
        }
      }
    } else {
      // Old packages cannot reconstruct full entities from position/genome summaries.
      // Clear their orphaned ENTITY_ID field during apply rather than inventing IDs.
      for (let offset = F.ENTITY_ID; offset < voxelState.length; offset += CELL_FIELDS) {
        voxelState[offset] = 0;
      }
    }

    return {
      graph: graphCandidate.toJSON(),
      voxelState,
      chunks,
      entityLayer,
      lawEngine: lawEngineState,
    };
  }

  private seedExampleGraph(): void {
    const wanted = [
      ['field.energy', 24, 34],
      ['field.density', 24, 144],
      ['field.information', 24, 254],
      ['process.ENERGY_DIFFUSION', 238, 28],
      ['process.GRAVITY', 238, 138],
      ['process.INFORMATION', 238, 248],
      ['process.BIO_POTENTIAL', 452, 158],
      ['law.law_info', 666, 158],
    ] as const;

    for (const [type, x, y] of wanted) {
      const node = this.registry.createNode(type, { x, y });
      if (node) this.graph.addNode(node);
    }

    const byType = new Map(this.graph.nodes.map(node => [node.type, node]));
    this.connectFirst(byType.get('field.energy'), byType.get('process.ENERGY_DIFFUSION'), 'field');
    this.connectFirst(byType.get('field.density'), byType.get('process.GRAVITY'), 'field');
    this.connectFirst(byType.get('field.energy'), byType.get('process.INFORMATION'), 'field');
    this.connectFirst(byType.get('field.information'), byType.get('process.BIO_POTENTIAL'), 'field');
    this.connectFirst(byType.get('process.INFORMATION'), byType.get('law.law_info'), 'process');
  }

  private connectFirst(source: RealityNode | undefined, target: RealityNode | undefined, type: string): void {
    if (!source || !target) return;
    const out = firstPort(source, 'output', type);
    const input = firstPort(target, 'input', type);
    if (out && input) this.graph.connect(source.id, target.id, out, input);
  }

  private render(): void {
    this.root.className = 'creator-shell';
    this.root.innerHTML = `
      <div class="creator-palette">
        <div class="creator-title">Creator Studio</div>
        <div class="creator-sub">Shift-click links nodes. Alt-click toggles. Double-click canvas compiles.</div>
        <div id="creatorPaletteList"></div>
      </div>
      <canvas id="creatorCanvas"></canvas>
      <div class="creator-inspector">
        <div class="creator-title">Inspector</div>
        <div id="creatorInspector"></div>
        <button id="creatorCompileBtn" class="creator-compile">Compile & Apply</button>
        <div class="creator-package-row">
          <button id="creatorExportBtn" class="creator-small-btn">Export .reality</button>
          <button id="creatorImportBtn" class="creator-small-btn">Import</button>
        </div>
        <input id="creatorFileInput" type="file" accept=".reality,application/zip" style="display:none">
        <div id="creatorStatus" class="creator-status">Ready.</div>
      </div>
    `;

    this.inspector = this.root.querySelector('#creatorInspector');
    this.status = this.root.querySelector('#creatorStatus');
    this.renderPalette();
    this.renderInspector();

    const canvas = this.root.querySelector<HTMLCanvasElement>('#creatorCanvas')!;
    this.canvasEditor = new NodeEditorCanvas(canvas, {
      nodes: this.graph.nodes,
      edges: this.graph.edges,
      getActiveProcessMask: () => this.options.lawEngine.activeProcessMask,
      onSelectNode: node => {
        this.selectedNode = node;
        this.renderInspector();
      },
      onMoveNode: (nodeId, position) => {
        this.graph.updateNode(nodeId, { position });
      },
      onConnect: (sourceId, targetId) => this.connectNodes(sourceId, targetId),
      onToggleNode: nodeId => this.toggleNode(nodeId),
      onCompile: () => this.compileAndApply(),
    });

    this.root.querySelector<HTMLButtonElement>('#creatorCompileBtn')!
      .addEventListener('click', () => this.compileAndApply());
    this.root.querySelector<HTMLButtonElement>('#creatorExportBtn')!
      .addEventListener('click', () => void this.exportPackage());
    this.root.querySelector<HTMLButtonElement>('#creatorImportBtn')!
      .addEventListener('click', () => this.fileInput?.click());
    this.fileInput = this.root.querySelector<HTMLInputElement>('#creatorFileInput');
    this.fileInput?.addEventListener('change', () => {
      const file = this.fileInput?.files?.[0];
      if (file) void this.importPackageFile(file);
      if (this.fileInput) this.fileInput.value = '';
    });

    const drawLoop = () => {
      this.canvasEditor?.draw();
      requestAnimationFrame(drawLoop);
    };
    drawLoop();
  }

  private renderPalette(): void {
    const list = this.root.querySelector<HTMLDivElement>('#creatorPaletteList')!;
    const templates = this.registry.getAllTemplates();
    const groups = [...new Set(templates.map(template => template.category))];
    list.innerHTML = groups.map(group => `
      <div class="creator-group">${group}</div>
      ${templates.filter(template => template.category === group).slice(0, 8).map(template => `
        <button class="creator-template" data-template="${template.type}" style="border-color:${template.metadata.color}55">
          <span style="background:${template.metadata.color}"></span>${template.label}
        </button>
      `).join('')}
    `).join('');

    list.querySelectorAll<HTMLButtonElement>('[data-template]').forEach(button => {
      button.addEventListener('click', () => {
        const type = button.dataset.template!;
        const node = this.registry.createNode(type, { x: 120 + Math.random() * 360, y: 40 + Math.random() * 250 });
        if (!node) return;
        this.graph.addNode(node);
        this.canvasEditor?.setData(this.graph.nodes, this.graph.edges);
      });
    });
  }

  private renderInspector(): void {
    if (!this.inspector) return;
    if (!this.selectedNode) {
      this.inspector.innerHTML = '<div class="creator-empty">Select a node to edit its parameters.</div>';
      return;
    }

    const node = this.selectedNode;
    this.inspector.innerHTML = `
      <div class="creator-node-head" style="border-color:${node.metadata.color}">
        <strong>${node.label}</strong>
        <span>${node.category}</span>
      </div>
      <p>${node.metadata.description}</p>
      <label class="creator-check"><input id="creatorEnabled" type="checkbox" ${node.enabled ? 'checked' : ''}> Enabled</label>
      <div class="creator-param-list">
        ${Object.entries(node.parameters).map(([key, value]) => `
          <label>${key}<input data-param="${key}" value="${String(value)}"></label>
        `).join('')}
      </div>
    `;

    this.inspector.querySelector<HTMLInputElement>('#creatorEnabled')?.addEventListener('input', event => {
      const enabled = (event.currentTarget as HTMLInputElement).checked;
      this.graph.updateNode(node.id, { enabled });
      node.enabled = enabled;
      this.canvasEditor?.draw();
    });

    this.inspector.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input => {
      input.addEventListener('change', () => {
        const key = input.dataset.param!;
        const current = node.parameters[key];
        const value = typeof current === 'number' ? Number(input.value) : input.value;
        node.parameters = { ...node.parameters, [key]: value };
        this.graph.updateNode(node.id, { parameters: node.parameters });
      });
    });
  }

  private connectNodes(sourceId: string, targetId: string): void {
    const source = this.graph.nodes.find(node => node.id === sourceId);
    const target = this.graph.nodes.find(node => node.id === targetId);
    if (!source || !target) return;

    const out = source.outputs.find(sourcePort =>
      target.inputs.some(targetPort => targetPort.type === sourcePort.type));
    const input = out ? target.inputs.find(targetPort => targetPort.type === out.type) : null;
    if (!out || !input) {
      this.status!.textContent = `No compatible port from ${source.label} to ${target.label}.`;
      return;
    }

    this.graph.connect(source.id, target.id, out.id, input.id);
    this.canvasEditor?.setData(this.graph.nodes, this.graph.edges);
  }

  private toggleNode(nodeId: string): void {
    const node = this.graph.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return;
    node.enabled = !node.enabled;
    this.graph.updateNode(node.id, { enabled: node.enabled });
    this.renderInspector();
  }
}
