import { SimulationEngine } from './simulation/SimulationEngine';
import { VoxelRenderer, LayerName } from './render/VoxelRenderer';
import { Entity } from './simulation/EntityLayer';
import { Presets, PresetName } from './world/Presets';
import { ScriptEngine, SCRIPT_TEMPLATES } from './world/ScriptEngine';
import { NodeGraph } from './ui/NodeGraph';
import { UnrealBridge } from './export/UnrealBridge';
import { BlenderBridge } from './export/BlenderBridge';
import { F } from './core/CellState';
import { PROCESS_LIBRARY } from './process/ProcessDef';
import { MAT, MATERIAL_LIBRARY, MatId } from './materials/MaterialDef';
import { EventType } from './world/WorldEvents';
import { TerrainGenerator, BIOME_LIST } from './world/TerrainGenerator';
import { ClimateSystem } from './simulation/ClimateSystem';
import { Timeline } from './world/Timeline';
import { MetricsPanel } from './ui/MetricsPanel';
import { FieldAnimator } from './render/FieldAnimator';
import { CivilizationSystem } from './simulation/CivilizationSystem';
import { MultiScaleSystem } from './simulation/MultiScaleSystem';
import { MetaLawEvolution } from './simulation/MetaLawEvolution';
import { SceneDirector } from './ai/SceneDirector';
import './director/browserDemo';
import { CosmologicalSim } from './simulation/CosmologicalSim';
import { LanguageSystem } from './simulation/LanguageEmergence';
import { EconomicSystem } from './simulation/EconomicSystem';
import { MultiplayerSync } from './network/MultiplayerSync';
import { ScientificAPI } from './export/ScientificAPI';
import { GraphCompiler, RealityGraph } from './creator';
import { LawProcessEditor } from './ui/LawProcessEditor';
import { SaveManager, WorldSaveSystem } from './world/save';
import { SculptManager, type BrushFalloff, type SculptToolId } from './sculpt';
import { DistributedEngine } from './distributed/DistributedEngine';
import { WorldComposer, PHI_ARCHETYPES, FIELD_BALANCES, COMPLEXITY_MODES, SPACETIME_PROFILES } from './ux/WorldComposer';
import { WorldHealth } from './ux/WorldHealth';
import { Explainer } from './ux/Explainer';
import { SMART_BRUSHES } from './ux/SmartBrushes';

// ── Chunk system imports ───────────────────────────────────────────────────────
import { ChunkRenderer } from './render/ChunkRenderer';
import { RealityMonitor, buildRealityMonitorHTML, updateMonitorPanels } from './ui/RealityMonitor';
import { NodeLawEditor } from './ui/NodeLawEditor';

// ── UX System imports ─────────────────────────────────────────────────────────
import { initializeUXSystem } from './ui/UXIntegration';
import { applySemanticControls } from './composer/semanticMapper';
import './ui/ux-system.css';

// ── Engine + renderer ─────────────────────────────────────────────────────────
const sim      = new SimulationEngine();
const canvas   = document.getElementById('gc') as HTMLCanvasElement;
const renderer = new VoxelRenderer(canvas, sim.grid.W, sim.grid.H, sim.grid.D);
const realityCreatorGraph = new RealityGraph();
const realityCreatorCompiler = new GraphCompiler();
(window as unknown as { realityEngine?: SimulationEngine; realityCreator?: { graph: RealityGraph; compiler: GraphCompiler } }).realityEngine = sim;
(window as unknown as { realityCreator?: { graph: RealityGraph; compiler: GraphCompiler } }).realityCreator = {
  graph: realityCreatorGraph,
  compiler: realityCreatorCompiler,
};

// ── Chunk system — Three.js renderer + sparse worker ─────────────────────────
const c3dCanvas = document.getElementById('c3d') as HTMLCanvasElement;
const chunkRenderer = new ChunkRenderer(c3dCanvas);
const monitor    = new RealityMonitor();
const nodeEditor = new NodeLawEditor();

// Shadow map: chunkKey → Float32Array (our copy of worker state for monitor sampling)
const localChunks = new Map<number, Float32Array>();
let chunkTick = 0, chunkEvCount = 0;
let workerBusy = false;

const chunkWorker = new Worker(
  new URL('./core/ChunkSimWorker.ts', import.meta.url),
  { type: 'module' }
);

let DIFF_cw = 0.09, ENT_cw = 0.0004, INFO_cw = 0.35, BIO_cw = 0.25;

chunkWorker.onmessage = (e: MessageEvent) => {
  const { cmd, tick: wTick, evCount: wEv, ab, stats } = e.data;
  workerBusy = false;

  if (cmd === 'frame' && ab) {
    chunkTick    = wTick ?? chunkTick;
    chunkEvCount = wEv   ?? chunkEvCount;

    // Merge dirty chunks into shadow map
    const NF_W = 14, CF = 512 * NF_W;
    const u32 = new Uint32Array(ab as ArrayBuffer);
    const f32 = new Float32Array(ab as ArrayBuffer);
    const num = u32[0];
    let off = 1;
    for (let c = 0; c < num; c++) {
      const key = u32[off];
      localChunks.set(key, f32.slice(off + 1, off + 1 + CF));
      off += 1 + CF;
    }

    // Push dirty payload to renderer
    chunkRenderer.applyWorkerFrame(ab as ArrayBuffer);

    // Update bottom-bar chunk stats
    if (stats) {
      const el = document.getElementById('chunkStats');
      if (el) el.textContent = `${stats.activeChunks}/${stats.totalChunks} · ${stats.memoryMB}MB`;
    }
  }
};

// Seed initial world in worker
chunkWorker.postMessage({ cmd: 'generate', data: { DIFF: DIFF_cw, ENT: ENT_cw, INFO: INFO_cw, BIO: BIO_cw } });

// Compile node graph and push params to worker
function chunkWorkerCompile() {
  const pipeline = nodeEditor.compile();
  const params   = { DIFF: DIFF_cw, ENT: ENT_cw, INFO: INFO_cw, BIO: BIO_cw };
  nodeEditor.applyPipeline(pipeline, params);
  DIFF_cw = params.DIFF; ENT_cw = params.ENT; INFO_cw = params.INFO; BIO_cw = params.BIO;
  chunkWorker.postMessage({ cmd: 'setParams', data: params });
  const log = document.getElementById('ngCompileLog');
  if (log) log.textContent = `Compiled → DIFF:${DIFF_cw.toFixed(4)} ENT:${ENT_cw.toFixed(5)}`;
}

nodeEditor.onCompile = () => chunkWorkerCompile();
(window as unknown as Record<string, unknown>).chunkWorkerCompile = chunkWorkerCompile;
(window as unknown as Record<string, unknown>).nodeLawEditor      = nodeEditor;

// Initialize node editor canvas once the science panel opens (DOM may not exist yet)
function tryInitNodeEditor() {
  const canvas = document.getElementById('ngCanvas') as HTMLCanvasElement | null;
  if (canvas && !nodeEditor.canvas) nodeEditor.init(canvas);
  else if (canvas) nodeEditor.draw();
}

// Inject monitor HTML into the panel placeholder
function tryInitMonitorPanel() {
  const panel = document.getElementById('realityMonitorPanel');
  if (panel && panel.querySelector('#psiRCanvas') === null) {
    panel.innerHTML = buildRealityMonitorHTML();
  }
}

// ── Initialize UX System ──────────────────────────────────────────────────────
const { appModeManager, renderModeSwitch } = initializeUXSystem();
appModeManager.setMode('create');  // Start in Create mode for first-time UX

// Wire worldGenerated event to engine
window.addEventListener('worldGenerated', (evt: any) => {
  const { biome, seed, semanticControls } = evt.detail;
  console.log('🌍 Generating world:', { biome, seed, semanticControls });
  
  // Apply semantic controls to physics engine
  const physicsParams = applySemanticControls(semanticControls);
  console.log('⚙️ Applied physics params:', physicsParams);
  
  // Optionally apply terrain biome
  if (biome && BIOME_LIST.includes(biome as any)) {
    Presets.apply(sim.grid, biome as PresetName);
    console.log('🏔️ Applied biome preset:', biome);
  }
  
  // Sync to GPU and start simulation
  sim.syncToGPU();
  playing = true;
  document.getElementById('playbtn')!.innerHTML = '<i class="ti ti-player-pause"></i> Pause';
});

// Wire render mode changes to viewport
renderModeSwitch.onChange((mode) => {
  console.log('🎨 Switched render mode:', mode);
  document.getElementById('modeIndicator')?.setAttribute('data-mode', mode);
});

// Wire app mode changes
appModeManager.onChange((mode) => {
  console.log('📱 Switched app mode:', mode);
  document.getElementById('modeIndicator')?.setAttribute('data-app-mode', mode);
});

// Async GPU init
sim.initGPU().then(ok => {
  const badge = document.getElementById('gpubadge')!;
  badge.textContent = ok ? 'GPU' : 'CPU';
  if (ok) badge.classList.remove('cpu');
});

// ── State ─────────────────────────────────────────────────────────────────────
let playing = false;  // Must be defined before UX system uses it
let selX = -1, selY = -1, selZ = 0;
let painting = false;
let activeSmartBrush: string | null = null;
let worldHealth: WorldHealth;
let tool: 'paint' | 'inject' | 'erase' | 'inspect' | 'smooth' | 'noise' | 'erode' | 'pattern' | 'stamp' = 'paint';
let activeMaterial: MatId = MAT.VACUUM;
let paintModeOn = true;
let histBuffers: Record<string, number[]> = { e: [], t: [], i: [], s: [], b: [] };
let lastTs = 0, fpsSmooth = 0, frameCount = 0, fpsTimer = 0;

const LAYER_INFO: Record<LayerName, string> = {
  energy:       'Kinetic/potential energy. Diffuses via Laplacian. Source of all change.',
  density:      'Mass concentration. Attracted toward energy. Enables pressure.',
  information:  'Complexity. Grows where energy + density are both high. Suppressed by entropy.',
  entropy:      'Disorder. Always increases. Degrades energy and information. Enables aging.',
  temperature:  'Thermal energy. Coupled to energy. Drives phase transitions.',
  bioPotential: 'Emergence potential. Peaks where info, energy, density, and low entropy align.',
  material:     'Material type. Each material has unique conductivity, heat capacity, erosion resistance, and bio-affinity.',
  chemistry:    'Chemical state: gas (blue-grey), liquid (blue), solid (grey), organic (green), reactive (orange).',
  signal:       'Entity communication signal. Written by entities to propagate information between clusters.',
  memory:       'Geological/information memory trace. Persists for hundreds of ticks after high-information events.',
  diff:         'World diff: orange = energy gained since last snapshot, blue = energy lost. Use scrubber to compare.',
};

// ── Layer buttons ─────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.layer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderer.layer = btn.dataset.layer as LayerName;
    document.getElementById('layerinfo')!.textContent = LAYER_INFO[renderer.layer];
  });
});
document.getElementById('layerinfo')!.textContent = LAYER_INFO['energy'];

// ── Tool buttons ──────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool as typeof tool;
  });
});

// ── Paint-mode toggle (P key shortcut) ────────────────────────────────────────
const paintBtn = document.getElementById('paintModeBtn')!;
function setPaintMode(on: boolean) {
  paintModeOn = on;
  renderer.setPaintMode(on);
  paintBtn.innerHTML = on
    ? '<i class="ti ti-pencil"></i> Paint'
    : '<i class="ti ti-planet"></i> Explore';
  paintBtn.style.borderColor = on ? '#7c6fcd' : '';
  paintBtn.style.color = on ? '#b0a8f8' : '';
  canvas.style.cursor = on ? 'crosshair' : 'grab';
}
paintBtn.addEventListener('click', () => setPaintMode(!paintModeOn));
document.addEventListener('keydown', e => {
  if (e.key === 'p' || e.key === 'P') setPaintMode(!paintModeOn);
  if (e.key === 'b' || e.key === 'B') setPaintMode(true);
  if (e.key === '[') {
    bsEl.value = String(Math.max(parseInt(bsEl.min), parseInt(bsEl.value) - 1));
    document.getElementById('bsOut')!.textContent = bsEl.value;
  }
  if (e.key === ']') {
    bsEl.value = String(Math.min(parseInt(bsEl.max), parseInt(bsEl.value) + 1));
    document.getElementById('bsOut')!.textContent = bsEl.value;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    const stroke = e.shiftKey ? sculptManager.redo() : sculptManager.undo();
    if (sculptStatusEl) sculptStatusEl.textContent = stroke ? `${e.shiftKey ? 'Redo' : 'Undo'} ${stroke.tool}` : 'Sculpt history empty';
  }
  if (e.key === 'r' || e.key === 'R') renderer.resetCamera();
});
document.getElementById('resetCamBtn')?.addEventListener('click', () => renderer.resetCamera());
setPaintMode(true); // boot into paint mode (left-click paints, right-drag orbits)

// ── Material palette ──────────────────────────────────────────────────────────
function renderMaterialPalette() {
  const el = document.getElementById('materialPalette')!;
  if (!el) return;
  el.innerHTML = MATERIAL_LIBRARY.map(m => {
    const [r,g,b] = m.color.map(v => Math.round(v*255));
    const active = m.id === activeMaterial;
    return `<div class="mat-swatch ${active?'active':''}" data-mat="${m.id}" title="${m.name}"
      style="background:rgb(${r},${g},${b});outline:${active?'2px solid #fff':'1px solid #333'}"></div>`;
  }).join('');
  el.querySelectorAll<HTMLDivElement>('.mat-swatch').forEach(s => {
    s.addEventListener('click', () => {
      activeMaterial = parseInt(s.dataset.mat!) as MatId;
      renderMaterialPalette();
    });
  });
}

// ── Preset buttons ────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    Presets.apply(sim.grid, btn.dataset.preset as PresetName);
    sim.syncToGPU();
  });
});

// ── Sliders ───────────────────────────────────────────────────────────────────
const bsEl    = document.getElementById('brushSize')   as HTMLInputElement;
const bStrEl  = document.getElementById('brushStr')    as HTMLInputElement;
const zSlice  = document.getElementById('zslice')      as HTMLInputElement;
const speedSl = document.getElementById('speedSlider') as HTMLInputElement;
const falloffEl = document.getElementById('brushFalloff') as HTMLSelectElement;
const sculptStatusEl = document.getElementById('sculptStatus');
const sculptManager = new SculptManager(sim.grid, () => sim.syncToGPU());

bsEl.addEventListener('input',    () => document.getElementById('bsOut')!.textContent    = bsEl.value);
bStrEl.addEventListener('input',  () => document.getElementById('bStrOut')!.textContent  = bStrEl.value);
speedSl.addEventListener('input', () => document.getElementById('speedOut')!.textContent = speedSl.value + 'x');
falloffEl.addEventListener('change', () => {
  sculptManager.currentBrush.falloff = falloffEl.value as BrushFalloff;
});

function readSculptFields() {
  sculptManager.currentBrush.fields = {
    energy: parseInt((document.getElementById('sculptEnergy') as HTMLInputElement).value) / 100,
    density: parseInt((document.getElementById('sculptDensity') as HTMLInputElement).value) / 100,
    temperature: parseInt((document.getElementById('sculptTemp') as HTMLInputElement).value) / 100,
    bio: parseInt((document.getElementById('sculptBio') as HTMLInputElement).value) / 100,
    information: parseInt((document.getElementById('sculptInfo') as HTMLInputElement).value) / 100,
    entropy: parseInt((document.getElementById('sculptEntropy') as HTMLInputElement).value) / 100,
  };
}

['sculptEnergy','sculptDensity','sculptTemp','sculptBio','sculptInfo','sculptEntropy'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', readSculptFields);
});
readSculptFields();

document.getElementById('sculptUndoBtn')?.addEventListener('click', () => {
  const stroke = sculptManager.undo();
  if (sculptStatusEl) sculptStatusEl.textContent = stroke ? `Undo ${stroke.tool}` : 'Nothing to undo';
});
document.getElementById('sculptRedoBtn')?.addEventListener('click', () => {
  const stroke = sculptManager.redo();
  if (sculptStatusEl) sculptStatusEl.textContent = stroke ? `Redo ${stroke.tool}` : 'Nothing to redo';
});

zSlice.max = String(sim.grid.D - 1);
zSlice.addEventListener('input', () => {
  const z = parseInt(zSlice.value);
  renderer.paintAltitude = z;
  selZ = z;
  document.getElementById('zOut')!.textContent = zSlice.value;
});

// ── Play / pause ──────────────────────────────────────────────────────────────
document.getElementById('playbtn')!.addEventListener('click', () => {
  playing = !playing;
  document.getElementById('playbtn')!.innerHTML = playing
    ? '<i class="ti ti-player-pause"></i> Pause'
    : '<i class="ti ti-player-play"></i> Play';
});

// ── 3D Painting ───────────────────────────────────────────────────────────────
async function paintAt(x: number, y: number, z: number, event?: PointerEvent) {
  const bs  = parseInt(bsEl.value);
  const str = parseInt(bStrEl.value);
  sculptManager.currentBrush.radius = bs;
  sculptManager.currentBrush.strength = Math.max(0.1, str / 50);
  sculptManager.currentBrush.falloff = falloffEl.value as BrushFalloff;

  // Smart brush intercept
  if (activeSmartBrush && SMART_BRUSHES[activeSmartBrush]) {
    SMART_BRUSHES[activeSmartBrush].paint(sim.grid, x, y, bs + 1, selZ);
    sim.syncToGPU();
    return;
  }

  if (event?.altKey) {
    const cell = sim.grid.cell(x, y, z);
    const max = Math.max(cell.energy / 600, cell.density, cell.temperature / 600, cell.bioPotential, cell.information / 200, cell.entropy, 0.001);
    (document.getElementById('sculptEnergy') as HTMLInputElement).value = String(Math.min(100, Math.round(cell.energy / 600 / max * 100)));
    (document.getElementById('sculptDensity') as HTMLInputElement).value = String(Math.min(100, Math.round(cell.density / max * 100)));
    (document.getElementById('sculptTemp') as HTMLInputElement).value = String(Math.min(100, Math.round(cell.temperature / 600 / max * 100)));
    (document.getElementById('sculptBio') as HTMLInputElement).value = String(Math.min(100, Math.round(cell.bioPotential / max * 100)));
    (document.getElementById('sculptInfo') as HTMLInputElement).value = String(Math.min(100, Math.round(cell.information / 200 / max * 100)));
    (document.getElementById('sculptEntropy') as HTMLInputElement).value = String(Math.min(100, Math.round(cell.entropy / max * 100)));
    readSculptFields();
    if (sculptStatusEl) sculptStatusEl.textContent = `Sampled ${x},${y},${z}`;
    return;
  }

  let sculptTool: SculptToolId = tool === 'paint' || tool === 'inject' ? 'inject' : tool === 'inspect' ? 'inject' : tool;
  if (event?.shiftKey) sculptTool = 'smooth';
  if (event?.ctrlKey) sculptTool = 'erase';

  const stroke = await sculptManager.onMouseDrag([x, y, z], sculptTool, {
    materialId: activeMaterial,
    layer: renderer.layer,
    additive: sculptTool !== 'erase',
  });
  if (sculptStatusEl) {
    sculptStatusEl.textContent = `${stroke.tool} r${stroke.radius} chunks:${stroke.affectedChunks.length} hist:${sculptManager.brushEngine.historyLength}`;
  }
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !paintModeOn) return;
  painting = true;
  canvas.setPointerCapture(e.pointerId);
  const hit = renderer.pickGridCell(e);
  if (!hit) return;
  if (tool === 'inspect') { selX = hit.x; selY = hit.y; selZ = hit.z; clearHist(); }
  else void paintAt(hit.x, hit.y, hit.z, e);
});
canvas.addEventListener('pointermove', e => {
  if (!painting || !paintModeOn) return;
  const hit = renderer.pickGridCell(e);
  if (!hit) return;
  if (tool === 'inspect') { selX = hit.x; selY = hit.y; }
  else void paintAt(hit.x, hit.y, hit.z, e);
});
canvas.addEventListener('pointerup', () => { painting = false; });

// ── Cell inspector ────────────────────────────────────────────────────────────
function clearHist() { histBuffers = { e: [], t: [], i: [], s: [], b: [] }; }

function updateCellPanel() {
  if (selX < 0) return;
  const cell = sim.grid.cell(selX, selY, selZ);
  document.getElementById('cellprops')!.innerHTML = `
    <div class="cell-prop"><span>Position</span><span class="cell-val">${selX},${selY},${selZ}</span></div>
    <div class="cell-prop"><span>Energy</span><span class="cell-val" style="color:#7c9fff">${cell.energy.toFixed(1)}</span></div>
    <div class="cell-prop"><span>Temperature</span><span class="cell-val" style="color:#ef8f3f">${cell.temperature.toFixed(1)}</span></div>
    <div class="cell-prop"><span>Density</span><span class="cell-val" style="color:#8eceab">${cell.density.toFixed(3)}</span></div>
    <div class="cell-prop"><span>Information</span><span class="cell-val" style="color:#c084fc">${cell.information.toFixed(1)}</span></div>
    <div class="cell-prop"><span>Entropy</span><span class="cell-val" style="color:#f47b7b">${cell.entropy.toFixed(4)}</span></div>
    <div class="cell-prop"><span>Bio potential</span><span class="cell-val" style="color:#4caf7d">${cell.bioPotential.toFixed(3)}</span></div>
    <div class="cell-prop"><span>Pressure</span><span class="cell-val">${cell.pressure.toFixed(1)}</span></div>
    <div class="cell-prop"><span>Local τ</span><span class="cell-val">${cell.localTime.toFixed(2)}</span></div>
    <div class="cell-prop"><span>Causality</span><span class="cell-val">#${String(Math.round(cell.causalityId)).padStart(4,'0')}</span></div>`;

  histBuffers.e.push(cell.energy);
  histBuffers.t.push(cell.temperature);
  histBuffers.i.push(cell.information);
  histBuffers.s.push(cell.entropy * 1000);
  histBuffers.b.push(cell.bioPotential * 1000);
  for (const k of Object.keys(histBuffers)) {
    if (histBuffers[k].length > 200) histBuffers[k].shift();
  }
  drawHist();
}

function drawHist() {
  const hc = document.getElementById('histcanvas') as HTMLCanvasElement;
  const ctx = hc.getContext('2d')!;
  const w = hc.width = hc.offsetWidth || 200, h = 80;
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
  const all = (Object.values(histBuffers) as number[][]).flat();
  if (all.length < 2) return;
  const maxV = Math.max(...all, 1);
  const cols = ['#7c9fff','#ef8f3f','#c084fc','#f47b7b','#4caf7d'];
  ['e','t','i','s','b'].forEach((k, ci) => {
    const arr = histBuffers[k]; if (arr.length < 2) return;
    ctx.beginPath(); ctx.strokeStyle = cols[ci]; ctx.lineWidth = 1.5;
    arr.forEach((v, idx) => {
      const px = idx / (arr.length-1) * w;
      const py = h - (v/maxV)*(h-4) - 2;
      idx === 0 ? ctx.moveTo(px,py) : ctx.lineTo(px,py);
    });
    ctx.stroke();
  });
}

function updateEventLog() {
  const evs = sim.causal.recent(8);
  const el = document.getElementById('eventlog')!;
  if (!evs.length) { el.innerHTML = '<div style="font-size:10px;color:#555">No events yet</div>'; return; }
  el.innerHTML = evs.map(e =>
    `<div class="ev" data-x="${e.x}" data-y="${e.y}" data-z="${e.z}">
       #${String(e.id).padStart(4,'0')} t:${e.tick} (${e.x},${e.y},${e.z}) ${e.delta>0?'+':''}${e.delta}
     </div>`
  ).join('');
  el.querySelectorAll<HTMLDivElement>('.ev').forEach(d => {
    d.addEventListener('click', () => {
      selX = parseInt(d.dataset.x!);
      selY = parseInt(d.dataset.y!);
      selZ = parseInt(d.dataset.z!);
      clearHist();
    });
  });
}

// ── AI Agents ─────────────────────────────────────────────────────────────────
function updateAgentPanel() {
  const el = document.getElementById('agentList')!;
  if (!el) return;
  const all = sim.agents.getAgents();
  document.getElementById('agentCount')!.textContent = String(all.length);
  el.innerHTML = all.slice(0, 10).map(a => {
    const bCol: Record<string, string> = {
      explorer: '#7c9fff', harvester: '#4caf7d', signaler: '#c084fc',
      builder: '#ef8f3f', destroyer: '#f47b7b',
    };
    const col = bCol[a.behavior] ?? '#888';
    return `<div style="display:flex;gap:5px;font-size:9px;padding:2px 3px;border-radius:4px;background:#1a1a22;align-items:center">
      <span style="width:6px;height:6px;border-radius:50%;background:${col};flex-shrink:0"></span>
      <span style="color:${col}">${a.behavior.slice(0,4)}</span>
      <span style="color:#555">A#${a.id} age:${a.age}</span>
      <span style="color:#888">E:${Math.round(a.energy)}</span>
    </div>`;
  }).join('');
}

// ── Scientific Mode ───────────────────────────────────────────────────────────
let scrubberIdx = 0;
let replayTimer: ReturnType<typeof setInterval> | null = null;
let replayPlaying = false;

function renderSciPanel() {
  const snaps = sim.recorder.snapList;
  const recBtn = document.getElementById('recBtn')!;
  recBtn.textContent = sim.recorder.recording ? '⏹ Stop' : '⏺ Record';
  recBtn.style.color = sim.recorder.recording ? '#f47b7b' : '#aaa';

  const scrubber = document.getElementById('scrubber') as HTMLInputElement;
  scrubber.max = String(Math.max(0, snaps.length - 1));
  scrubberIdx = Math.min(scrubberIdx, Math.max(0, snaps.length - 1));
  scrubber.value = String(scrubberIdx);

  const snap = snaps[scrubberIdx];
  const snapInfo = document.getElementById('snapInfo')!;
  if (snap) {
    snapInfo.textContent =
      `[${scrubberIdx + 1}/${snaps.length}] t:${snap.tick} | E:${Math.round(snap.metrics.totalEnergy).toLocaleString()} | S:${snap.metrics.avgEntropy.toFixed(4)}`;
  } else {
    snapInfo.textContent = 'No snapshots — click ⏺ Record then Play';
  }

  drawMetricsChart();
  drawCausalGraph();
}

// ── Metrics chart: sparklines of all recorded snapshots ───────────────────────
function drawMetricsChart() {
  const canvas = document.getElementById('metricsChart') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width = canvas.offsetWidth || 200;
  const h = canvas.height;
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);

  const snaps = sim.recorder.snapList;
  if (snaps.length < 2) { ctx.fillStyle = '#333'; ctx.font = '9px monospace'; ctx.fillText('record to populate', 4, h/2); return; }

  const n = snaps.length;
  const maxE = Math.max(...snaps.map(s => s.metrics.totalEnergy), 1);

  // Scrubber tick line
  const sx = (scrubberIdx / (n - 1)) * w;
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();

  const drawLine = (vals: number[], max: number, col: string, yScale = 0.85) => {
    ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    vals.forEach((v, i) => {
      const px = (i / (n - 1)) * w;
      const py = h - (v / max) * h * yScale - 2;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
  };

  drawLine(snaps.map(s => s.metrics.totalEnergy), maxE, '#ef8f3f');
  drawLine(snaps.map(s => s.metrics.avgEntropy),   1,    '#f47b7b');
  drawLine(snaps.map(s => s.metrics.avgInfo),       Math.max(...snaps.map(s => s.metrics.avgInfo), 1), '#c084fc');
  drawLine(snaps.map(s => s.metrics.avgBio),        1,    '#4caf7d');
}

// ── Causal graph: DAG of the last 80 causal events ────────────────────────────
let _hoveredCausalId = -1;

function drawCausalGraph() {
  const canvas = document.getElementById('causalCanvas') as HTMLCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width = canvas.offsetWidth || 200;
  const h = canvas.height;
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);

  const evs = sim.causal.recent(80).reverse(); // oldest first
  if (evs.length < 2) { ctx.fillStyle = '#333'; ctx.font = '9px monospace'; ctx.fillText('no causal events yet', 4, h/2); return; }

  const minTick = evs[0].tick;
  const maxTick = evs[evs.length - 1].tick;
  const tickRange = Math.max(1, maxTick - minTick);

  // Map event → pixel
  const evPos = new Map<number, [number, number]>();
  const PAD = 8;
  for (const ev of evs) {
    const px = PAD + ((ev.tick - minTick) / tickRange) * (w - PAD * 2);
    // Y from cell XYZ projected: use x + y as "horizontal spatial" position
    const spatial = (ev.x + ev.y * sim.grid.W) / (sim.grid.W * sim.grid.H);
    const py = PAD + spatial * (h - PAD * 2);
    evPos.set(ev.id, [px, py]);
  }

  const typeCol: Record<string, string> = {
    energy_spike: '#ef8f3f', info_bloom: '#c084fc', entropy_burst: '#f47b7b',
    bio_emergence: '#4caf7d', phase_transition: '#7c9fff',
  };

  // Draw edges (parentId → child)
  ctx.lineWidth = 0.8;
  for (const ev of evs) {
    if (ev.parentId == null) continue;
    const a = evPos.get(ev.parentId);
    const b = evPos.get(ev.id);
    if (!a || !b) continue;
    ctx.strokeStyle = typeCol[ev.type] + '55';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }

  // Draw nodes
  for (const ev of evs) {
    const pos = evPos.get(ev.id);
    if (!pos) continue;
    const [px, py] = pos;
    const r = ev.id === _hoveredCausalId ? 5 : 3;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = typeCol[ev.type] ?? '#888';
    ctx.fill();
  }

  // Tick labels at bottom
  ctx.fillStyle = '#333'; ctx.font = '8px monospace';
  ctx.fillText(`t:${minTick}`, PAD, h - 2);
  ctx.fillText(`t:${maxTick}`, w - 40, h - 2);
}

// Causal graph click → jump inspector to that event's cell
(function wireCausalCanvas() {
  const canvas = document.getElementById('causalCanvas') as HTMLCanvasElement;
  if (!canvas) return;
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / rect.height);

    const evs = sim.causal.recent(80).reverse();
    if (evs.length < 2) return;
    const minTick = evs[0].tick, maxTick = evs[evs.length - 1].tick;
    const tickRange = Math.max(1, maxTick - minTick);
    const PAD = 8, w = canvas.width, h = canvas.height;

    let bestDist = 14, bestEv = null as typeof evs[0] | null;
    for (const ev of evs) {
      const px = PAD + ((ev.tick - minTick) / tickRange) * (w - PAD * 2);
      const spatial = (ev.x + ev.y * sim.grid.W) / (sim.grid.W * sim.grid.H);
      const py = PAD + spatial * (h - PAD * 2);
      const d = Math.hypot(mx - px, my - py);
      if (d < bestDist) { bestDist = d; bestEv = ev; }
    }
    if (bestEv) {
      _hoveredCausalId = bestEv.id;
      selX = bestEv.x; selY = bestEv.y; selZ = bestEv.z; clearHist();
      const chain = sim.causal.chainFrom(bestEv.id);
      document.getElementById('causalInfo')!.textContent =
        `#${bestEv.id} ${bestEv.type} Δ${bestEv.delta > 0 ? '+' : ''}${bestEv.delta} chain:${chain.length}`;
      drawCausalGraph();
    }
  });
})();

// ── World Events ──────────────────────────────────────────────────────────────
function renderWorldEventLog() {
  const el = document.getElementById('worldEventLog')!;
  if (!el) return;
  const evs = sim.worldEvents.recent(6);
  el.innerHTML = evs.length
    ? evs.map(e => `<div class="wev"><span class="wev-type">${e.label}</span><span class="wev-tick">t:${e.tick}</span></div>`).join('')
    : '<div style="font-size:10px;color:#555">No events yet</div>';
}

// ── Entity panel ──────────────────────────────────────────────────────────────
function entityStageColor(e: Entity): string {
  return e.stage === 'juvenile' ? '#4caf7d' : e.stage === 'mature' ? '#ef8f3f' : '#c084fc';
}

function updateEntityPanel() {
  const list = document.getElementById('entityList')!;
  const all  = sim.entityLayer.getEntities();
  const stats = sim.entityStats();
  document.getElementById('entityCount')!.textContent = String(all.length);
  document.getElementById('entOut')!.textContent      = String(all.length);
  document.getElementById('genOut')!.textContent      = String(stats.totalSpawned);
  document.getElementById('extinctOut')!.textContent  = String(stats.extinct);

  list.innerHTML = all.slice(0, 12).map(e => {
    const [r,g,b] = e.colorRgb.map(v => Math.round(v * 255));
    const stageCol = entityStageColor(e);
    const reproPct = Math.round(e.reproCounter * 100);
    const reproBar = `<span style="display:inline-block;width:${reproPct * 0.3}px;height:3px;background:#4caf7d44;border-radius:2px;vertical-align:middle;max-width:30px"></span>`;
    return `<div style="display:flex;align-items:center;gap:4px;font-size:9px;padding:2px 4px;border-radius:4px;background:#1a1a22;flex-wrap:wrap;">
      <span style="color:rgb(${r},${g},${b});font-family:monospace;font-size:11px;flex-shrink:0">${e.symbol}</span>
      <span style="color:#666">#${e.id}</span>
      <span style="color:${stageCol}">${e.stage.slice(0,3)}</span>
      <span style="color:#555">a:${Math.round(e.age)}</span>
      <span style="color:#4caf7d">${(e.reproCounter*100).toFixed(0)}%</span>${reproBar}
      <span style="color:#888">×${e.children}</span>
    </div>`;
  }).join('');
}

// ── MetaLaw panel ─────────────────────────────────────────────────────────────
function renderLawPanel() {
  const list = document.getElementById('lawList')!;
  list.innerHTML = sim.laws.laws.map(law => {
    const procNames = law.enablesProcesses
      .map(pid => PROCESS_LIBRARY.find(p => p.id === pid)?.label ?? '')
      .filter(Boolean).slice(0, 4);
    const isCore = ['law_thermo','law_gravity','law_info'].includes(law.id);
    const ovr = sim.laws.getLawOverride(law.id);
    const ovrLabel = ovr === 'auto' ? '⬡ Auto' : ovr === 'on' ? '🔒 ON' : '🔒 OFF';
    const ovrColor = ovr === 'on' ? '#4caf7d' : ovr === 'off' ? '#f47b7b' : '#555';
    return `
    <div class="law-card" style="border-color:${law.active ? law.color+'44' : '#2a2a35'}">
      <div class="law-header">
        <span class="law-dot" style="background:${law.active ? law.color : '#333'}"></span>
        <span class="law-name" title="${law.name} gen${law.generation}">${law.name}</span>
        <span class="law-status ${law.active?'on':'off'}">${law.active?'ON':'OFF'}</span>
      </div>
      <div class="law-meta">age:${law.age} fit:${law.fitness.toFixed(2)} μ:${law.mutationRate.toFixed(4)}</div>
      <div class="law-procs">${procNames.map(n=>`<span class="proc-tag">${n}</span>`).join('')}</div>
      <div class="law-btns">
        <button class="law-btn" data-action="override" data-id="${law.id}" style="color:${ovrColor};border-color:${ovrColor}44">${ovrLabel}</button>
        <button class="law-btn" data-action="mutate" data-id="${law.id}">⚡</button>
        ${!isCore?`<button class="law-btn danger" data-action="remove" data-id="${law.id}">✕</button>`:''}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      if (btn.dataset.action === 'override') {
        const cur = sim.laws.getLawOverride(id);
        const next = cur === 'auto' ? 'on' : cur === 'on' ? 'off' : 'auto';
        sim.laws.setLawOverride(id, next);
        renderLawPanel();
      }
      if (btn.dataset.action === 'mutate') { sim.laws.spawnMutation(id); renderLawPanel(); }
      if (btn.dataset.action === 'remove') { sim.laws.removeLaw(id); renderLawPanel(); }
    });
  });
}

const PROC_CAT_COLOR: Record<string, string> = {
  thermodynamic: '#ef8f3f', biological: '#4caf7d', geological: '#a0855a',
  informational: '#7c9fff', physical: '#c084fc',
};
const STAB_COLOR = (s: number) => s > 0.3 ? '#4caf7d' : s < -0.2 ? '#f47b7b' : '#aaa';

function renderProcGrid() {
  const container = document.getElementById('procGrid')!;
  const curMask = sim.laws.activeProcessMask;
  container.innerHTML = PROCESS_LIBRARY.map(p => {
    const on = (curMask & (1 << p.id)) !== 0;
    const catCol = PROC_CAT_COLOR[p.category] ?? '#888';
    const stabBar = Math.round(Math.abs(p.stabilityImpact) * 16);
    const stabCol = STAB_COLOR(p.stabilityImpact);
    const inputs  = p.inputs.map(i => `<span class="proc-field-tag in">${i}</span>`).join('');
    const outputs = p.outputs.map(o => `<span class="proc-field-tag out">${o}</span>`).join('');
    return `<div class="proc-card ${on?'active':''}" data-procid="${p.id}" title="${p.description}">
      <div class="proc-card-header">
        <span class="proc-led ${on?'on':'off'}"></span>
        <span class="proc-card-label" style="color:${on?catCol:'#555'}">${p.label}</span>
        <span class="proc-cat-badge" style="background:${catCol}22;color:${catCol}">${p.category.slice(0,5)}</span>
      </div>
      <div class="proc-card-body">
        <div class="proc-io-row">${inputs}<span class="proc-arrow">→</span>${outputs}</div>
        <div class="proc-stab-row">
          <span style="color:${stabCol};font-size:9px">stab ${p.stabilityImpact > 0 ? '+' : ''}${p.stabilityImpact.toFixed(1)}</span>
          <span class="proc-stab-bar" style="width:${stabBar}px;background:${stabCol}"></span>
        </div>
      </div>
    </div>`;
  }).join('');
  container.querySelectorAll<HTMLDivElement>('.proc-card').forEach(card => {
    card.addEventListener('click', () => {
      const pid = parseInt(card.dataset.procid!);
      const nowOn = (sim.laws.activeProcessMask & (1 << pid)) !== 0;
      sim.laws.toggleProcess(pid, !nowOn);
      renderProcGrid();
    });
  });
}

document.getElementById('addLawBtn')!.addEventListener('click', () => {
  const laws = sim.laws.laws;
  if (!laws.length) return;
  sim.laws.spawnMutation(laws[Math.floor(Math.random() * laws.length)].id);
  renderLawPanel(); renderProcGrid();
});

// ── Save world ────────────────────────────────────────────────────────────────
document.getElementById('saveBtn')!.addEventListener('click', async () => {
  const name = prompt('Quick save name', `World_${sim.tick}`) ?? `World_${sim.tick}`;
  const savedName = await saveSystem.quickSave(name.trim() || `World_${sim.tick}`);
  document.getElementById('exportStatus')!.textContent = `Quick saved: ${savedName}`;
});

document.getElementById('loadBtn')?.addEventListener('click', async () => {
  const saves = await saveSystem.listQuickSaves();
  if (!saves.length) {
    (document.getElementById('worldLoadInput') as HTMLInputElement | null)?.click();
    return;
  }
  const latest = saves[0];
  const ok = confirm(`Load latest quick save "${latest.name}" from ${new Date(latest.timestamp).toLocaleString()}?\n\nCancel opens a .reality file picker.`);
  if (ok) {
    await saveSystem.loadQuickSave(latest.id);
    document.getElementById('exportStatus')!.textContent = `Loaded quick save: ${latest.name}`;
  } else {
    (document.getElementById('worldLoadInput') as HTMLInputElement | null)?.click();
  }
});

document.getElementById('autoSaveBtn')?.addEventListener('click', () => {
  if (saveManager.enabled) saveManager.stopAutoSave();
  else saveManager.startAutoSave(120000);
  const btn = document.getElementById('autoSaveBtn')!;
  btn.style.color = saveManager.enabled ? '#80f0b0' : '';
});

document.getElementById('worldLoadInput')?.addEventListener('change', () => {
  const input = document.getElementById('worldLoadInput') as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void saveSystem.importRealityPackage(file);
  input.value = '';
});

document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    void saveSystem.quickSave(`World_${sim.tick}`).then(name => {
      document.getElementById('exportStatus')!.textContent = `Quick saved: ${name}`;
    });
  }
  if (event.key.toLowerCase() === 'o') {
    event.preventDefault();
    document.getElementById('loadBtn')?.click();
  }
});

// ── Onboarding ────────────────────────────────────────────────────────────────
const onboard = document.getElementById('onboard')!;
try { if (localStorage.getItem('re_v3_boarded')) onboard.style.display = 'none'; } catch {}
document.getElementById('obStart')!.addEventListener('click', () => {
  onboard.style.display = 'none';
  try { localStorage.setItem('re_v3_boarded', '1'); } catch {}
});

// ── Async game loop ───────────────────────────────────────────────────────────
renderLawPanel();
renderProcGrid();
renderMaterialPalette();

// ── Script Engine ──────────────────────────────────────────────────────────────
const scriptEngine = new ScriptEngine(sim);
const scriptArea    = document.getElementById('scriptArea')    as HTMLTextAreaElement;
const scriptLog     = document.getElementById('scriptLog')!;
const templateSel   = document.getElementById('templateSelect') as HTMLSelectElement;

templateSel?.addEventListener('change', () => {
  const key = templateSel.value;
  if (key && SCRIPT_TEMPLATES[key]) {
    scriptArea.value = SCRIPT_TEMPLATES[key];
    templateSel.value = '';
  }
});

document.getElementById('runScriptBtn')?.addEventListener('click', () => {
  const code = scriptArea.value.trim();
  if (!code) return;
  scriptLog.textContent = '⏳ Running…';
  // Defer one frame so the UI updates before potentially-heavy sync ticks
  setTimeout(() => {
    const { log } = scriptEngine.run(code);
    scriptLog.textContent = log.join('\n');
    scriptLog.style.color = log.some(l => l.startsWith('✗')) ? '#f47b7b' : '#4caf7d';
  }, 16);
});

document.getElementById('clearScriptBtn')?.addEventListener('click', () => {
  scriptArea.value = '';
  scriptLog.textContent = '';
});

// Mutation strength slider
const mutStrEl = document.getElementById('mutStrength') as HTMLInputElement | null;
mutStrEl?.addEventListener('input', () => {
  const v = parseInt(mutStrEl.value) / 100;
  sim.setEntityMutationStrength(v);
  document.getElementById('mutStrOut')!.textContent = v.toFixed(1) + '×';
});

// Agent controls
document.getElementById('seedAgentsBtn')?.addEventListener('click', () => {
  sim.agents.seed(sim.grid, 8);
});
document.getElementById('clearAgentsBtn')?.addEventListener('click', () => {
  sim.agents.clear();
  updateAgentPanel();
});

// Scientific mode controls
const recBtn       = document.getElementById('recBtn')!;
const scrubber     = document.getElementById('scrubber') as HTMLInputElement;
const restoreBtn   = document.getElementById('restoreBtn')!;
const exportCsvBtn = document.getElementById('exportCsvBtn')!;
const diffBtn      = document.getElementById('diffBtn')!;
const replayPlayBtn = document.getElementById('replayPlayBtn')!;
const replayBackBtn = document.getElementById('replayBackBtn')!;
const replayFwdBtn  = document.getElementById('replayFwdBtn')!;

recBtn?.addEventListener('click', () => {
  if (sim.recorder.recording) sim.recorder.stopRecording();
  else sim.recorder.startRecording();
  renderSciPanel();
});

scrubber?.addEventListener('input', () => {
  scrubberIdx = parseInt(scrubber.value);
  _applyDiffIfActive();
  renderSciPanel();
});

restoreBtn?.addEventListener('click', () => {
  const ok = sim.recorder.restoreSnapshot(sim.grid, scrubberIdx);
  if (ok) { playing = false; sim.syncToGPU(); }
});

exportCsvBtn?.addEventListener('click', () => {
  const csv = sim.recorder.exportCSV();
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `reality-metrics-${sim.tick}.csv`; a.click();
});

// Diff layer toggle
let _diffActive = false;
function _applyDiffIfActive() {
  if (!_diffActive) return;
  const prev = scrubberIdx > 0 ? scrubberIdx - 1 : 0;
  const diff = sim.recorder.diffAt(prev, scrubberIdx);
  renderer.setDiffBuffer(diff);
}
diffBtn?.addEventListener('click', () => {
  _diffActive = !_diffActive;
  diffBtn.style.color = _diffActive ? '#ef8f3f' : '#aaa';
  if (_diffActive) {
    _applyDiffIfActive();
    renderer.layer = 'diff';
    document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
  } else {
    renderer.setDiffBuffer(null);
    renderer.layer = 'energy';
    document.querySelector<HTMLButtonElement>('[data-layer="energy"]')?.classList.add('active');
  }
});

// Replay controls
replayBackBtn?.addEventListener('click', () => {
  scrubberIdx = Math.max(0, scrubberIdx - 1);
  const ok = sim.recorder.restoreSnapshot(sim.grid, scrubberIdx);
  if (ok) sim.syncToGPU();
  _applyDiffIfActive(); renderSciPanel();
});
replayFwdBtn?.addEventListener('click', () => {
  const n = sim.recorder.snapList.length;
  scrubberIdx = Math.min(n - 1, scrubberIdx + 1);
  const ok = sim.recorder.restoreSnapshot(sim.grid, scrubberIdx);
  if (ok) sim.syncToGPU();
  _applyDiffIfActive(); renderSciPanel();
});
replayPlayBtn?.addEventListener('click', () => {
  if (replayPlaying) {
    // pause
    clearInterval(replayTimer!); replayTimer = null; replayPlaying = false;
    replayPlayBtn.textContent = '▶ Replay';
  } else {
    // play
    const n = sim.recorder.snapList.length;
    if (n < 2) return;
    if (scrubberIdx >= n - 1) scrubberIdx = 0;
    replayPlaying = true; replayPlayBtn.textContent = '⏸ Pause';
    playing = false; // pause live sim
    replayTimer = setInterval(() => {
      const total = sim.recorder.snapList.length;
      scrubberIdx++;
      if (scrubberIdx >= total) {
        scrubberIdx = total - 1;
        clearInterval(replayTimer!); replayTimer = null; replayPlaying = false;
        replayPlayBtn.textContent = '▶ Replay';
      }
      const ok = sim.recorder.restoreSnapshot(sim.grid, scrubberIdx);
      if (ok) sim.syncToGPU();
      _applyDiffIfActive(); renderSciPanel();
    }, 120); // ~8fps playback
  }
});

// World event trigger buttons
document.querySelectorAll<HTMLButtonElement>('[data-event]').forEach(btn => {
  btn.addEventListener('click', () => {
    sim.triggerEvent(btn.dataset.event as EventType);
    renderWorldEventLog();
  });
});

// ── Node Graph ────────────────────────────────────────────────────────────────
const nodeGraphCanvas = document.getElementById('nodeGraph') as HTMLCanvasElement | null;
const nodeGraph = nodeGraphCanvas ? new NodeGraph(nodeGraphCanvas, sim) : null;
nodeGraph?.draw();
// Distributed engine (optional)
const distributed = new DistributedEngine(sim.grid);
(window as any).realityDistributed = distributed;

// Add a small status panel and spawn worker button
const distRoot = document.createElement('div');
distRoot.id = 'distributedStatus';
distRoot.style.position = 'fixed';
distRoot.style.left = '12px';
distRoot.style.bottom = '12px';
distRoot.style.padding = '10px';
distRoot.style.background = 'rgba(6,6,12,0.9)';
distRoot.style.color = '#dfe8ff';
distRoot.style.border = '1px solid #1f2a3a';
distRoot.style.zIndex = '9999';
distRoot.innerHTML = `
  <div style="font-weight:600;margin-bottom:6px">Distributed Status</div>
  <div id="distNodes">Nodes: 1 (local)</div>
  <div id="distChunks">Owned chunks: 0</div>
  <div style="margin-top:8px">
    <button id="spawnWorkerBtn">Spawn Worker</button>
    <button id="assignPartitionBtn">Assign Partition</button>
  </div>
`;
document.body.appendChild(distRoot);

document.getElementById('spawnWorkerBtn')?.addEventListener('click', () => {
  distributed.workers.spawnWorker();
  (document.getElementById('distNodes') as HTMLElement).textContent = `Nodes: ${distributed.orchestrator.nodes.size} (workers:${distributed.workers ? (distributed as any).workers ? 'local' : '' : ''})`;
});

document.getElementById('assignPartitionBtn')?.addEventListener('click', () => {
  // assign a simple grid partition (chunk keys) near origin
  const keys: string[] = [];
  for (let cz=0; cz<2; cz++) for (let cy=0; cy<2; cy++) for (let cx=0; cx<2; cx++) keys.push(`${cx},${cy},${cz}`);
  distributed.assignInitialPartition(keys);
  (document.getElementById('distChunks') as HTMLElement).textContent = `Owned chunks: ${distributed.getLocalOwnedChunks().length}`;
});
const creatorRoot = document.getElementById('creatorStudio');
const creatorEditor = creatorRoot ? new LawProcessEditor(creatorRoot, {
  lawEngine: sim.laws,
  simulation: sim,
  thumbnailCanvas: canvas,
}) : null;
void creatorEditor;
let civSystem: CivilizationSystem;
let saveSystem: WorldSaveSystem;
let saveManager: SaveManager;

canvas.addEventListener('dragover', event => {
  event.preventDefault();
  canvas.style.outline = '2px solid #22ff88';
});
canvas.addEventListener('dragleave', () => {
  canvas.style.outline = '';
});
canvas.addEventListener('drop', event => {
  event.preventDefault();
  canvas.style.outline = '';
  const file = event.dataTransfer?.files?.[0];
  if (file && file.name.endsWith('.reality')) {
    void saveSystem.importRealityPackage(file);
  }
});

// ── Export bridges ────────────────────────────────────────────────────────────
const unrealBridge  = new UnrealBridge(sim.grid);
const blenderBridge = new BlenderBridge(sim.grid);

function _exportStatus(msg: string, ok = true) {
  const el = document.getElementById('exportStatus');
  if (el) { el.textContent = msg; el.style.color = ok ? '#4caf7d' : '#f47b7b'; }
}

document.getElementById('exportUsdBtn')?.addEventListener('click', () => {
  unrealBridge.downloadUSD();
  _exportStatus('USD exported');
});
document.getElementById('exportLiveLinkBtn')?.addEventListener('click', () => {
  unrealBridge.downloadLiveLink();
  _exportStatus('LiveLink JSON exported');
});
document.getElementById('unrealGuideBtn')?.addEventListener('click', () => {
  alert(UnrealBridge.getInstructions());
});

document.getElementById('blendVoxBtn')?.addEventListener('click', () => {
  blenderBridge.downloadBlenderScript('voxels');
  _exportStatus('Blender voxels.py exported');
});
document.getElementById('blendBioBtn')?.addEventListener('click', () => {
  blenderBridge.downloadBlenderScript('bio_clusters');
  _exportStatus('Blender bio.py exported');
});
document.getElementById('blendCsvBtn')?.addEventListener('click', () => {
  blenderBridge.downloadCSV();
  _exportStatus('Point cloud CSV exported');
});

document.getElementById('exportRecordingBtn')?.addEventListener('click', () => {
  const snaps = sim.recorder.snapList;
  if (!snaps.length) { _exportStatus('No snapshots — hit ⏺ Record first', false); return; }
  const json = sim.recorder.exportRecording();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reality-recording-${sim.tick}.json`;
  a.click();
  _exportStatus(`Recording exported (${snaps.length} snapshots)`);
});

// ── Phase 2: Terrain, Climate, Timeline, Metrics ─────────────────────────────
const terrain  = new TerrainGenerator(sim.grid);
const climate  = new ClimateSystem(sim.grid);
const timeline = new Timeline(sim.grid, () => sim.agents.getAgents().length);
const p2metricsEl = document.getElementById('p2metricsCanvas') as HTMLCanvasElement | null;
const p2metrics   = p2metricsEl ? new MetricsPanel(p2metricsEl, timeline) : null;
let climateActive = false;

// ── Phase 3: FieldAnimator, CivSystem, MultiScale, MetaLawEvolution ──────────
const fieldAnim   = new FieldAnimator(renderer.scene, sim.grid);
civSystem = new CivilizationSystem(sim.grid);
const multiScale  = new MultiScaleSystem(sim.grid);
const metaLawEvol = new MetaLawEvolution(sim.laws, sim.grid);
saveSystem = new WorldSaveSystem(sim.grid, sim.laws, null, {
  graphProvider: () => creatorEditor?.graph.toJSON(),
  graphLoader: graph => {
    creatorEditor?.loadGraph(graph);
  },
  syncToGPU: () => sim.syncToGPU(),
  getTick: () => sim.tick,
  setTick: tick => sim.restoreTick(tick),
  getEntities: () => sim.entityLayer.getEntities(),
  getCivs: () => civSystem.civs,
  loadCivs: civs => {
    civSystem.civs = civs.map(civ => structuredClone(civ));
  },
  getCausalLog: () => sim.causal.recent(24),
  thumbnailCanvas: canvas,
});
saveManager = new SaveManager(saveSystem);
(window as unknown as { realitySave?: WorldSaveSystem }).realitySave = saveSystem;

// Phase 5 init (needs civSystem to be set)
worldHealth = new WorldHealth(sim, civSystem);
initWorldComposer();

// ── Phase 4: AI Director, Cosmological, Language, Economy, Multiplayer, Science
const director  = new SceneDirector(sim, civSystem, metaLawEvol);
const cosmoSim  = new CosmologicalSim();
const langSys   = new LanguageSystem(sim);
const econSys   = new EconomicSystem(sim, civSystem);
const multiplay = new MultiplayerSync(sim);
const sciAPI    = new ScientificAPI(sim);

// Biome selector
const biomeSelect = document.getElementById('biomeSelect') as HTMLSelectElement | null;
if (biomeSelect) {
  for (const b of BIOME_LIST) {
    const o = document.createElement('option'); o.value = b; o.textContent = b;
    biomeSelect.appendChild(o);
  }
}

document.getElementById('btnGenTerrain')?.addEventListener('click', () => {
  const biome = (biomeSelect?.value ?? 'earth') as typeof BIOME_LIST[number];
  const seed  = parseInt((document.getElementById('biomeSeed') as HTMLInputElement)?.value ?? '42');
  const msg   = terrain.generate(biome, seed);
  sim.syncToGPU();
  document.getElementById('scriptLog')!.textContent = msg;
});

document.getElementById('btnSpawnAgents')?.addEventListener('click', () => {
  sim.agents.seed(sim.grid, 5);
  document.getElementById('scriptLog')!.textContent = `Agents: ${sim.agents.getAgents().length} alive`;
});

document.getElementById('btnToggleClimate')?.addEventListener('click', () => {
  climateActive = !climateActive;
  const btn = document.getElementById('btnToggleClimate')!;
  btn.textContent = `🌬 Climate: ${climateActive ? 'ON' : 'OFF'}`;
});

function updateTimelineSnapList(): void {
  const el = document.getElementById('timelineSnapList');
  if (!el) return;
  document.getElementById('timelineSnapCount')!.textContent = String(timeline.snapshots.length);
  el.innerHTML = [...timeline.snapshots].reverse().map((s, ri) => {
    const i = timeline.snapshots.length - 1 - ri;
    return `<div style="display:flex;justify-content:space-between;align-items:center;
        font-size:9px;padding:2px 4px;border-radius:3px;cursor:pointer;
        background:#12121a;border:1px solid #1a1a25"
      data-snap-idx="${i}">
      <span style="color:#888">${s.label}</span>
      <span style="color:#555">E:${Math.round(s.totalEnergy/1000)}k</span>
    </div>`;
  }).join('');
  el.querySelectorAll<HTMLDivElement>('[data-snap-idx]').forEach(d => {
    d.addEventListener('click', () => {
      const idx = parseInt(d.dataset.snapIdx!);
      if (timeline.restore(idx)) { playing = false; sim.syncToGPU(); }
    });
  });
}

document.getElementById('btnSaveTimeline')?.addEventListener('click', () => {
  timeline.saveSnapshot(`Manual t${sim.tick}`);
  updateTimelineSnapList();
});
document.getElementById('btnExportRealityPackage')?.addEventListener('click', () => {
  void creatorEditor?.exportPackage();
});
document.getElementById('btnExportTimeline')?.addEventListener('click', () => timeline.exportCSV());

// Phase 3 UI
document.getElementById('btnSeedCivs')?.addEventListener('click', () => {
  civSystem.seedFromGrid();
  document.getElementById('scriptLog')!.textContent = `Civilizations: ${civSystem.civs.length} founded`;
  updateCivPanel();
});

function updateCivPanel(): void {
  const el = document.getElementById('civList');
  if (!el) return;
  document.getElementById('civCount')!.textContent = String(civSystem.civs.length);
  el.innerHTML = civSystem.civs.slice(0, 8).map(c => {
    const [r, g, b] = c.color.map(v => Math.round(v * 255));
    const dipEntries = Object.entries(c.diplomacy);
    const atWar  = dipEntries.filter(([,v]) => v === 'war').length;
    const allies = dipEntries.filter(([,v]) => v === 'ally').length;
    return `<div style="display:flex;gap:4px;font-size:9px;padding:2px 4px;border-radius:4px;background:#1a1a22;align-items:center;flex-wrap:wrap;">
      <span style="width:7px;height:7px;border-radius:50%;background:rgb(${r},${g},${b});flex-shrink:0"></span>
      <span style="color:rgb(${r},${g},${b});font-weight:500">${c.name}</span>
      <span style="color:#555">t${c.techLevel}</span>
      <span style="color:#888">pop:${Math.round(c.population)}</span>
      ${atWar ? `<span style="color:#f47b7b">⚔${atWar}</span>` : ''}
      ${allies ? `<span style="color:#4caf7d">↔${allies}</span>` : ''}
    </div>`;
  }).join('');
  const log = document.getElementById('civLog');
  if (log) log.innerHTML = civSystem.historyLog.slice(0, 8).map(l =>
    `<div style="font-size:9px;color:#555;font-family:monospace">${l}</div>`).join('');

  const ms = multiScale.getMacroStats();
  const msEl = document.getElementById('macroStats');
  if (msEl) msEl.textContent = `E:${ms.energy.toFixed(0)} S:${ms.entropy.toFixed(3)} Bio:${ms.bio.toFixed(3)} T:${ms.temp.toFixed(0)}`;

  const mleEl = document.getElementById('metaEvolLog');
  if (mleEl) mleEl.textContent = `cycle:${metaLawEvol.cycleCount} ${metaLawEvol.lastAction}`;
}

// ── Phase 4 UI ────────────────────────────────────────────────────────────────

// AI Director
let lastDirectorCode: string | null = null;

document.getElementById('btnAskDirector')?.addEventListener('click', async () => {
  const input = document.getElementById('directorInput') as HTMLInputElement;
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  const log = document.getElementById('directorLog')!;
  log.innerHTML += `<div style="color:#888">You: ${msg}</div>`;
  const result = await director.ask(msg);
  log.innerHTML += `<div style="color:#c0c8f0;margin-top:3px">Director: ${result.text}</div><br>`;
  log.scrollTop = log.scrollHeight;
  if (result.code) {
    lastDirectorCode = result.code;
    const codeEl = document.getElementById('directorCode')!;
    codeEl.style.display = 'block';
    codeEl.textContent = result.code.slice(0, 200) + (result.code.length > 200 ? '…' : '');
  }
});

document.getElementById('directorInput')?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') document.getElementById('btnAskDirector')?.click();
});

document.getElementById('btnRunDirectorCode')?.addEventListener('click', () => {
  if (!lastDirectorCode) return;
  const { log } = scriptEngine.run(lastDirectorCode);
  document.getElementById('directorLog')!.innerHTML +=
    `<div style="color:#4caf7d">Executed: ${log.join(' ') || 'done'}</div>`;
});

let autoDirectOn = false;
document.getElementById('btnAutoDirector')?.addEventListener('click', () => {
  autoDirectOn = !autoDirectOn;
  document.getElementById('btnAutoDirector')!.textContent = `Auto: ${autoDirectOn ? 'ON' : 'OFF'}`;
  if (autoDirectOn) director.startAutoDirecting(25000);
  else director.stopAutoDirecting();
});

document.getElementById('btnSetApiKey')?.addEventListener('click', () => {
  const inp = document.getElementById('directorApiKey') as HTMLInputElement;
  if (inp.value.trim()) { director.setApiKey(inp.value.trim()); inp.value = ''; }
});

// Cosmological sim
document.getElementById('btnBigBang')?.addEventListener('click', () => {
  cosmoSim.bigBang();
  cosmoSim.seedGalaxies(8);
  updateCosmoPanel();
  document.getElementById('scriptLog')!.textContent = 'Cosmological Big Bang seeded — 256×256×64 sparse grid';
});

function updateCosmoPanel(): void {
  const el = document.getElementById('cosmoStats');
  if (!el) return;
  const s = cosmoSim.getStats();
  el.textContent = `cells:${s.filledCells} E:${s.totalEnergy.toLocaleString()} galaxies:${s.galaxies} t:${s.tick}`;
}

// Language system
function updateLangPanel(): void {
  const el = document.getElementById('langStats');
  if (!el) return;
  const s = langSys.getStats();
  el.textContent = `vocab:${s.vocabularySize} comms:${s.communicationEvents} ${s.recentWords || '—'}`;
}

// Economic system
function updateEconPanel(): void {
  const el = document.getElementById('econStats');
  if (!el) return;
  const s = econSys.getStats();
  el.textContent = `markets:${s.markets} GDP:${s.globalGDP.toLocaleString()} GINI:${s.gini} avgP:${s.avgPrice}`;
}

// Multiplayer
document.getElementById('btnMultiplayer')?.addEventListener('click', () => {
  const btn = document.getElementById('btnMultiplayer')!;
  if (!multiplay.connected) {
    const uid = multiplay.connect();
    btn.textContent = `Disconnect (${uid})`;
    btn.style.color = '#4caf7d';
    document.getElementById('scriptLog')!.textContent = `Connected as ${uid} — open another tab to collaborate`;
  } else {
    multiplay.disconnect();
    btn.textContent = '🔗 Multiplayer';
    btn.style.color = '';
    document.getElementById('scriptLog')!.textContent = 'Disconnected from multiplayer';
  }
});

function updateMultiplayPanel(): void {
  const el = document.getElementById('multiplayStats');
  if (!el) return;
  const s = multiplay.getStats();
  el.textContent = `peers:${s.peers}${s.isHost ? ' (host)' : ''} ${s.connected ? 'connected' : 'offline'}`;
}

// Scientific export
document.getElementById('btnSciExportAll')?.addEventListener('click', () => {
  const msg = sciAPI.downloadAll();
  _exportStatus(msg);
});
document.getElementById('btnSciExportField')?.addEventListener('click', () => {
  _exportStatus(sciAPI.downloadField());
});
document.getElementById('btnSciExportNotebook')?.addEventListener('click', () => {
  _exportStatus(sciAPI.downloadNotebook());
});
document.getElementById('btnSciExportGraph')?.addEventListener('click', () => {
  _exportStatus(sciAPI.downloadCausalGraph());
});

// ── Phase 5: WorldComposer, WorldHealth, Explainer, SmartBrushes ─────────────

// Smart brushes dropdown
(function initSmartBrushes() {
  const sel = document.getElementById('smartBrushSel') as HTMLSelectElement | null;
  if (!sel) return;
  for (const [name, brush] of Object.entries(SMART_BRUSHES)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = `${brush.icon} ${name}`;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    activeSmartBrush = sel.value || null;
    if (activeSmartBrush) {
      document.getElementById('scriptLog')!.textContent =
        `Smart brush: ${SMART_BRUSHES[activeSmartBrush].desc}`;
    }
  });
})();

// WorldHealth panel (civSystem set after phase 3 init, declared in state section above)
function updateHealthPanel(): void {
  const data = worldHealth.compute();
  const BARS: [string, number, string][] = [
    ['Stability',      data.stability,      '#6080ff'],
    ['Emergence',      data.emergencePot,   '#40c060'],
    ['Extinction risk',data.extinctionRisk, '#e04040'],
    ['Mutation',       data.mutationActivity,'#c060e0'],
  ];
  const barsEl = document.getElementById('healthBars');
  if (barsEl) {
    barsEl.innerHTML = BARS.map(([label, val, color]) => `
      <div style="margin-bottom:4px">
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#666;margin-bottom:1px">
          <span>${label}</span><span>${val}%</span></div>
        <div style="height:3px;border-radius:2px;background:#1a1a22;overflow:hidden">
          <div style="height:100%;width:${val}%;background:${color};border-radius:2px;transition:width .3s"></div>
        </div>
      </div>`).join('');
  }
  const semEl = document.getElementById('healthSemanticRow');
  if (semEl) {
    const avgS = parseFloat(data.avgEntropy);
    const avgB = parseFloat(data.avgBio);
    const avgE = parseFloat(data.avgInfo);
    const sem = [WorldHealth.semanticEntropy(avgS), WorldHealth.semanticBio(avgB), WorldHealth.semanticEnergy(avgE)];
    semEl.innerHTML = sem.map(s =>
      `<span style="font-size:9px;padding:2px 7px;border-radius:12px;background:${s.color}22;color:${s.color};border:0.5px solid ${s.color}55">${s.label}</span>`
    ).join('');
  }
  const alertsEl = document.getElementById('healthAlerts');
  if (alertsEl) {
    const C: Record<string, string> = { critical:'#e04040', warn:'#ef8030', info:'#6080ff', success:'#40c060' };
    alertsEl.innerHTML = data.alerts.map(a =>
      `<div style="font-size:9px;padding:3px 7px;border-radius:4px;background:${C[a.level]}18;color:${C[a.level]};border-left:2px solid ${C[a.level]}">${a.msg}</div>`
    ).join('');
  }
}

// Explainer
const explainer = new Explainer(sim);
function updateExplainerPanel(): void {
  if (selX < 0) return;
  const expl = explainer.explain(selX, selY, selZ);
  const el = document.getElementById('cellExplainer');
  if (!el) return;
  el.style.display = 'block';
  el.innerHTML = `<div style="font-size:9px;color:#555;margin-bottom:5px">Why is (${selX},${selY},${selZ}) this way?</div>` +
    expl.map(e => `
      <div style="margin-bottom:5px;padding:5px 7px;background:#0e0e18;border-radius:6px;border:0.5px solid #2a2a35">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px">
          <span style="font-size:10px;color:#888">${e.icon} ${e.field}</span>
          <span style="font-size:10px;font-family:monospace;color:#ccc">${e.value}</span>
        </div>
        <div style="font-size:9px;color:#666;line-height:1.5">${e.why}</div>
      </div>`).join('');
}

// WorldComposer instance (UI is driven from index.html inline script; this provides the TS engine)
let worldComposer: WorldComposer;
let composerStep = 0;
const COMPOSER_STEPS = ['Φ Potential','ρ·E·I Fields','C Complexity','dτ·dV Dynamics','Generate'];

function initWorldComposer(): void {
  worldComposer = new WorldComposer(sim, civSystem);
  const modal = document.getElementById('composerModal');
  document.getElementById('btnOpenComposer')?.addEventListener('click', () => {
    composerStep = 0;
    if (modal) modal.style.display = 'flex';
    renderComposerStep();
  });
  document.getElementById('closeComposerBtn')?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });
  document.getElementById('composerNextBtn')?.addEventListener('click', () => {
    if (composerStep < COMPOSER_STEPS.length - 1) { composerStep++; renderComposerStep(); }
    else _composerGenerate();
  });
  document.getElementById('composerBackBtn')?.addEventListener('click', () => {
    if (composerStep > 0) { composerStep--; renderComposerStep(); }
  });
}

function renderComposerStep(): void {
  if (!worldComposer) return;
  const sel = worldComposer.selection;
  const stepsEl = document.getElementById('composerSteps');
  if (stepsEl) {
    stepsEl.innerHTML = COMPOSER_STEPS.map((s, i) => `
      <div onclick="window._gotoComposerStep(${i})" style="flex:1;padding:9px 4px;text-align:center;font-size:10px;cursor:pointer;
        color:${i===composerStep?'#9d96f0':i<composerStep?'#4caf7d':'#444'};
        border-bottom:2px solid ${i===composerStep?'#7c6fcd':i<composerStep?'#2a6644':'transparent'};
        background:${i===composerStep?'#1a1830':'transparent'}">
        ${i<composerStep?'✓ ':''}<b>${s}</b></div>`).join('');
  }

  const selDisplay = [sel.phi, sel.fields, sel.complexity, sel.spacetime].filter(Boolean).join(' · ');
  const selEl = document.getElementById('composerSelDisplay');
  if (selEl) selEl.textContent = selDisplay;

  const content = document.getElementById('composerContent');
  const nextBtn  = document.getElementById('composerNextBtn');
  const backBtn  = document.getElementById('composerBackBtn') as HTMLButtonElement | null;
  if (backBtn) backBtn.style.opacity = composerStep === 0 ? '0.3' : '1';
  if (nextBtn) nextBtn.textContent = composerStep === COMPOSER_STEPS.length - 1 ? '✦ Generate' : 'Next →';
  if (!content) return;

  if (composerStep === 0) {
    content.innerHTML = `<div style="font-size:11px;color:#666;margin-bottom:12px">Configure Φ — the fundamental potential substrate</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${Object.entries(PHI_ARCHETYPES).map(([name, a]) => `
          <div onclick="window._composerSelectPhi('${name}')" style="padding:11px;border-radius:8px;cursor:pointer;
            border:0.5px solid ${sel.phi===name?'#7c6fcd':'#2a2a35'};background:${sel.phi===name?'#1a1830':'#0e0e18'}">
            <div style="font-size:20px;margin-bottom:5px">${a.icon}</div>
            <div style="font-size:11px;font-weight:500;color:#c0b8f0;margin-bottom:3px">${name}</div>
            <div style="font-size:9px;color:#666;line-height:1.5">${a.desc}</div>
            <div style="font-size:8px;color:#444;font-family:monospace;margin-top:4px">Φ=${a.phiStrength.toFixed(2)} κ=${a.coupling.toFixed(2)}</div>
          </div>`).join('')}
      </div>`;
  } else if (composerStep === 1) {
    content.innerHTML = `<div style="font-size:11px;color:#666;margin-bottom:12px">Set the ρ·E·I field balance</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${Object.entries(FIELD_BALANCES).map(([name, f]) => `
          <div onclick="window._composerSelectFields('${name}')" style="padding:11px;border-radius:8px;cursor:pointer;
            border:0.5px solid ${sel.fields===name?'#6080ff':'#2a2a35'};background:${sel.fields===name?'#141828':'#0e0e18'}">
            <div style="font-size:20px;margin-bottom:5px">${f.icon}</div>
            <div style="font-size:11px;font-weight:500;color:#9090e0;margin-bottom:3px">${name}</div>
            <div style="font-size:9px;color:#666">${f.desc}</div>
            <div style="font-size:8px;color:#444;font-family:monospace;margin-top:4px">ρ=${f.rho} E=${f.E} I=${f.I}</div>
          </div>`).join('')}
      </div>`;
  } else if (composerStep === 2) {
    content.innerHTML = `<div style="font-size:11px;color:#666;margin-bottom:12px">Define C — complexity dynamics</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${Object.entries(COMPLEXITY_MODES).map(([name, c]) => `
          <div onclick="window._composerSelectComplexity('${name}')" style="padding:11px;border-radius:8px;cursor:pointer;
            border:0.5px solid ${sel.complexity===name?'#40c060':'#2a2a35'};background:${sel.complexity===name?'#0d2010':'#0e0e18'}">
            <div style="font-size:20px;margin-bottom:5px">${c.icon}</div>
            <div style="font-size:11px;font-weight:500;color:#80e080;margin-bottom:3px">${name}</div>
            <div style="font-size:9px;color:#666">${c.desc}</div>
            <div style="font-size:8px;color:#444;font-family:monospace;margin-top:4px">growth=${c.growth} stab=${c.stability}</div>
          </div>`).join('')}
      </div>`;
  } else if (composerStep === 3) {
    content.innerHTML = `<div style="font-size:11px;color:#666;margin-bottom:12px">Shape dτ·dV — process time and spatial character</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">
        ${Object.entries(SPACETIME_PROFILES).map(([name, s]) => `
          <div onclick="window._composerSelectSpacetime('${name}')" style="padding:11px;border-radius:8px;cursor:pointer;
            border:0.5px solid ${sel.spacetime===name?'#e09030':'#2a2a35'};background:${sel.spacetime===name?'#1e1408':'#0e0e18'}">
            <div style="font-size:20px;margin-bottom:5px">${s.icon}</div>
            <div style="font-size:11px;font-weight:500;color:#e0b060;margin-bottom:3px">${name}</div>
            <div style="font-size:9px;color:#666">${s.desc}</div>
            <div style="font-size:8px;color:#444;font-family:monospace;margin-top:4px">dτ=${s.timeDil} noise=${s.sNoise}</div>
          </div>`).join('')}
      </div>`;
  } else {
    const phi  = PHI_ARCHETYPES[sel.phi ?? ''];
    const fld  = FIELD_BALANCES[sel.fields]  ?? FIELD_BALANCES['Balanced'];
    const cplx = COMPLEXITY_MODES[sel.complexity] ?? COMPLEXITY_MODES['Emergent'];
    const st   = SPACETIME_PROFILES[sel.spacetime] ?? SPACETIME_PROFILES['Standard'];
    const est  = phi ? (phi.phiStrength*(fld.rho+fld.E+fld.I)/3*cplx.growth*st.timeDil).toFixed(3) : '—';
    content.innerHTML = `<div style="text-align:center;padding:16px 0">
        <div style="font-size:13px;font-family:monospace;color:#a09af0;margin-bottom:4px">𝒓 = ∫ Φ · ρ · E · I · C  dV dτ</div>
        <div style="font-size:11px;color:#666;margin-bottom:16px">Integral estimate ≈ <span style="color:#d0cef5;font-family:monospace">${est}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:380px;margin:0 auto 20px;text-align:left">
          ${([['Φ Potential',sel.phi??'—','#a09af0'],['ρ·E·I Fields',sel.fields,'#6080ff'],
             ['C Complexity',sel.complexity,'#40c060'],['dτ·dV',sel.spacetime,'#e09030']] as [string,string,string][])
            .map(([k,v,c]) => `<div style="padding:9px;background:#0e0e18;border-radius:8px;border:0.5px solid #2a2a35">
              <div style="font-size:9px;color:#555;margin-bottom:2px">${k}</div>
              <div style="font-size:10px;color:${c}">${v}</div>
            </div>`).join('')}
        </div>
        <button onclick="window._composerGenerate()" style="padding:11px 36px;border:0.5px solid #7c6fcd;border-radius:8px;cursor:pointer;background:#1a1830;color:#9d96f0;font-size:14px;font-weight:500">
          ✦ Generate Reality
        </button>
      </div>`;
  }
}

function _composerGenerate(): void {
  if (!worldComposer) return;
  const msg = worldComposer.generate();
  const modal = document.getElementById('composerModal');
  if (modal) modal.style.display = 'none';
  const log = document.getElementById('scriptLog');
  if (log) log.textContent = msg;
  playing = true;
}

const _win = window as unknown as Record<string, unknown>;
_win._gotoComposerStep        = (i: number) => { composerStep = i; renderComposerStep(); };
_win._composerSelectPhi       = (n: string) => { worldComposer.selection.phi        = n; renderComposerStep(); };
_win._composerSelectFields    = (n: string) => { worldComposer.selection.fields     = n; renderComposerStep(); };
_win._composerSelectComplexity= (n: string) => { worldComposer.selection.complexity = n; renderComposerStep(); };
_win._composerSelectSpacetime = (n: string) => { worldComposer.selection.spacetime  = n; renderComposerStep(); };
_win._composerGenerate        = _composerGenerate;

// ── Keyboard camera navigation ─────────────────────────────────────────────────
const _keys: Record<string, boolean> = {};
document.addEventListener('keydown', e => { _keys[e.code] = true; });
document.addEventListener('keyup',   e => { _keys[e.code] = false; });

function _applyKeyNav(): void {
  const dx = (_keys['KeyD'] || _keys['ArrowRight'] ? 1 : 0) - (_keys['KeyA'] || _keys['ArrowLeft'] ? 1 : 0);
  const dy = (_keys['KeyW'] || _keys['ArrowUp']    ? 1 : 0) - (_keys['KeyS'] || _keys['ArrowDown'] ? 1 : 0);
  if (dx !== 0 || dy !== 0) renderer.panCamera(dx * 4, dy * 4);
}

async function loop(ts: number) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  frameCount++;
  if (ts - fpsTimer > 600) {
    fpsSmooth = Math.round(frameCount * 1000 / (ts - fpsTimer));
    frameCount = 0; fpsTimer = ts;
  }

  _applyKeyNav();

  if (playing) {
    const nSteps = parseInt(speedSl.value);
    await sim.step(dt, nSteps);
    if (climateActive) climate.tick(dt * nSteps);
    timeline.autoSave(sim.tick);
    multiScale.tick();
    metaLawEvol.tick(sim.tick);
    civSystem.tick();
    langSys.tick();
    econSys.tick(dt);
    if (sim.tick % 5 === 0) cosmoSim.step(dt * 5);

    // Tick chunk worker (non-blocking — skip if previous frame not yet returned)
    if (!workerBusy) {
      workerBusy = true;
      chunkWorker.postMessage({ cmd: 'tick', data: { speed: Math.min(nSteps, 3) } });
    }
  }

  // Render Three.js chunk view
  chunkRenderer.render();

  fieldAnim.update(sim.tick, dt);

  // Entity panel refresh every 15 ticks
  if (sim.tick % 15 === 0) { updateEntityPanel(); updateAgentPanel(); }

  // 3D render with entity + agent markers from engine
  renderer.render(sim.grid, sim.entityMarkers(), sim.agentMarkers());

  // Right-panel updates
  if (selX >= 0 && sim.tick % 3 === 0) updateCellPanel();
  if (sim.tick % 12 === 0) { updateEventLog(); renderWorldEventLog(); drawCausalGraph(); }
  if (sim.tick % 20 === 0) { renderLawPanel(); renderProcGrid(); nodeGraph?.draw(); }
  if (sim.tick % 30 === 0) { renderSciPanel(); }
  if (sim.tick % 20 === 0) {
    p2metrics?.draw(); updateTimelineSnapList(); updateCivPanel();
    updateCosmoPanel(); updateLangPanel(); updateEconPanel(); updateMultiplayPanel();
    if (worldHealth) updateHealthPanel();
  }
  if (selX >= 0 && sim.tick % 10 === 0) updateExplainerPanel();

  // Chunk system UI updates
  if (sim.tick % 10 === 0) {
    tryInitMonitorPanel();
    tryInitNodeEditor();

    if (localChunks.size > 0) {
      const agentCount = sim.agents.getAgents().filter((a: any) => a.alive !== false).length;
      monitor.sample(chunkTick, localChunks, agentCount, chunkEvCount);

      // Law fitness data from existing law engine
      const lawsForRadar = sim.laws.laws.map(l => ({
        nm:  l.name,
        fit: l.fitness,
        on:  l.active,
        col: l.color,
      }));
      updateMonitorPanels(monitor, lawsForRadar);

      // Node editor tick
      if (nodeEditor.canvas) {
        const last = monitor.samples[monitor.samples.length - 1];
        if (last) nodeEditor.tick({ energy: last.energy, entropy: last.entropy, info: last.info, bio: last.bio });
      }
    }
  }

  // Bottom bar
  const totalE    = sim.grid.totalField(F.ENERGY);
  const totalS    = sim.grid.totalField(F.ENTROPY) / sim.grid.size;
  const activeLaws = sim.laws.laws.filter(l => l.active).length;
  document.getElementById('tickOut')!.textContent    = String(sim.tick);
  document.getElementById('energyOut')!.textContent  = Math.round(totalE).toLocaleString();
  document.getElementById('entropyOut')!.textContent = totalS.toFixed(4);
  document.getElementById('lawsOut')!.textContent    = `${activeLaws}/${sim.laws.laws.length}`;
  document.getElementById('chunksOut')!.textContent  = `${sim.grid.activeChunkCount}/${sim.grid.chunks.size}`;
  document.getElementById('chunkMemOut')!.textContent = `${(sim.grid.memoryBytes / 1048576).toFixed(1)} MB`;
  document.getElementById('fpsOut')!.textContent     = String(fpsSmooth);

  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { lastTs = ts; fpsTimer = ts; requestAnimationFrame(loop); });
