import { GraphCompiler, NodeRegistry, PackageSerializer, RealityGraph } from '../creator';
import type { EntitySnapshot, GraphExecutionPlan, LawSnapshot, ProcessSnapshot, RealityGraphData, RealityNode, RealityPackage } from '../creator';
import type { LawEngine } from '../laws/LawEngine';
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
    };
    tick: number;
    syncToGPU: () => void;
    entityLayer?: { getEntities: () => unknown[] };
  };
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
    if (!this.options.simulation) {
      this.status!.textContent = 'Package export needs a simulation instance.';
      return;
    }

    const pkg = this.buildPackage();
    const blob = await this.serializer.pack(pkg);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${pkg.manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.reality`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.status!.textContent = `Exported ${anchor.download}`;
  }

  async importPackageFile(file: File): Promise<void> {
    try {
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
      entities: this.snapshotEntities(),
      laws: this.options.lawEngine.laws.map(law => this.snapshotLaw(law)),
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
    this.loadGraph(pkg.graph);
    this.applyVoxelState(pkg);
    this.applyLawSnapshots(pkg.laws);
    this.applyProcessSnapshots(pkg.processes);
  }

  private applyVoxelState(pkg: RealityPackage): void {
    const sim = this.options.simulation;
    if (!sim) return;
    const incoming = new Float32Array(pkg.voxelState);
    if (incoming.length !== sim.grid.buffer.length) {
      throw new Error(`Voxel state size mismatch: package has ${incoming.length}, grid expects ${sim.grid.buffer.length}.`);
    }
    sim.grid.buffer.set(incoming);
    sim.syncToGPU();
  }

  private applyLawSnapshots(laws: LawSnapshot[]): void {
    this.options.lawEngine.laws = laws.map(snapshot => {
      const effects = (snapshot.effects ?? {}) as Record<string, any>;
      return {
        id: snapshot.id,
        name: snapshot.name,
        active: Boolean(effects.active),
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

  private applyProcessSnapshots(processes: ProcessSnapshot[]): void {
    const activeProcessIds = processes.filter(process => process.enabled).map(process => process.id);
    this.options.lawEngine.applyGraphPlan({
      executionOrder: [],
      boundParameters: new Map(),
      gpuPasses: [],
      activeProcessIds,
      issues: [],
    });
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
