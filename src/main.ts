import { SimulationEngine } from './simulation/SimulationEngine';
import { VoxelRenderer, LayerName } from './render/VoxelRenderer';
import { Entity } from './simulation/EntityLayer';
import { Presets, PresetName } from './world/Presets';
import { ScriptEngine, SCRIPT_TEMPLATES } from './world/ScriptEngine';
import { F } from './core/CellState';
import { PROCESS_LIBRARY } from './process/ProcessDef';
import { MAT, MATERIAL_LIBRARY, MatId } from './materials/MaterialDef';
import { EventType } from './world/WorldEvents';

// ── Engine + renderer ─────────────────────────────────────────────────────────
const sim      = new SimulationEngine();
const canvas   = document.getElementById('gc') as HTMLCanvasElement;
const renderer = new VoxelRenderer(canvas, sim.grid.W, sim.grid.H, sim.grid.D);
// Async GPU init
sim.initGPU().then(ok => {
  const badge = document.getElementById('gpubadge')!;
  badge.textContent = ok ? 'GPU' : 'CPU';
  if (ok) badge.classList.remove('cpu');
});

// ── State ─────────────────────────────────────────────────────────────────────
let playing = false;
let selX = -1, selY = -1, selZ = 0;
let painting = false;
let tool: 'paint' | 'inject' | 'erase' | 'inspect' = 'paint';
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
document.addEventListener('keydown', e => { if (e.key === 'p' || e.key === 'P') setPaintMode(!paintModeOn); });
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

bsEl.addEventListener('input',    () => document.getElementById('bsOut')!.textContent    = bsEl.value);
bStrEl.addEventListener('input',  () => document.getElementById('bStrOut')!.textContent  = bStrEl.value);
speedSl.addEventListener('input', () => document.getElementById('speedOut')!.textContent = speedSl.value + 'x');

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
function paintAt(x: number, y: number, z: number) {
  const bs  = parseInt(bsEl.value);
  const str = parseInt(bStrEl.value);
  const grid = sim.grid;

  for (let dz = -bs; dz <= bs; dz++)
  for (let dy = -bs; dy <= bs; dy++)
  for (let dx = -bs; dx <= bs; dx++) {
    if (dx*dx + dy*dy + dz*dz > bs*bs) continue;
    const nx = x+dx, ny = y+dy, nz = z+dz;
    if (!grid.inBounds(nx, ny, nz)) continue;
    const cell = grid.cell(nx, ny, nz);
    const lyr  = renderer.layer;

    if (tool === 'erase') {
      cell.energy = 0; cell.temperature = 0; cell.density = 0;
      cell.information = 0; cell.entropy = 0; cell.materialId = MAT.VACUUM;
      continue;
    }
    // Always write material when a non-vacuum material is selected
    if (activeMaterial !== MAT.VACUUM) cell.materialId = activeMaterial;
    const add = tool === 'inject';
    if      (lyr === 'energy')       cell.energy      = add ? Math.min(cell.energy + str, 9999)      : str;
    else if (lyr === 'density')      cell.density     = add ? Math.min(cell.density + str/1000, 1)   : str/1000;
    else if (lyr === 'information')  cell.information = add ? Math.min(cell.information + str/2, 999): str/2;
    else if (lyr === 'entropy')      cell.entropy     = add ? Math.min(cell.entropy + str/1000, 1)   : str/1000;
    else if (lyr === 'temperature')  cell.temperature = add ? Math.min(cell.temperature + str, 2000) : str;
    else if (lyr === 'bioPotential') cell.bioPotential = add ? Math.min(cell.bioPotential + str/1000, 1) : str/1000;
  }
  sim.syncToGPU();
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !paintModeOn) return;
  painting = true;
  canvas.setPointerCapture(e.pointerId);
  const hit = renderer.pickGridCell(e);
  if (!hit) return;
  if (tool === 'inspect') { selX = hit.x; selY = hit.y; selZ = hit.z; clearHist(); }
  else paintAt(hit.x, hit.y, hit.z);
});
canvas.addEventListener('pointermove', e => {
  if (!painting || !paintModeOn) return;
  const hit = renderer.pickGridCell(e);
  if (!hit) return;
  if (tool === 'inspect') { selX = hit.x; selY = hit.y; }
  else paintAt(hit.x, hit.y, hit.z);
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
document.getElementById('saveBtn')!.addEventListener('click', () => {
  const g = sim.grid;
  const blob = new Blob(
    [JSON.stringify({ W: g.W, H: g.H, D: g.D, buffer: Array.from(g.buffer) })],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reality-world-${sim.tick}.json`;
  a.click();
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

async function loop(ts: number) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  frameCount++;
  if (ts - fpsTimer > 600) {
    fpsSmooth = Math.round(frameCount * 1000 / (ts - fpsTimer));
    frameCount = 0; fpsTimer = ts;
  }

  if (playing) {
    const nSteps = parseInt(speedSl.value);
    await sim.step(dt, nSteps);
  }

  // Entity panel refresh every 15 ticks
  if (sim.tick % 15 === 0) { updateEntityPanel(); updateAgentPanel(); }

  // 3D render with entity + agent markers from engine
  renderer.render(sim.grid, sim.entityMarkers(), sim.agentMarkers());

  // Right-panel updates
  if (selX >= 0 && sim.tick % 3 === 0) updateCellPanel();
  if (sim.tick % 12 === 0) { updateEventLog(); renderWorldEventLog(); drawCausalGraph(); }
  if (sim.tick % 20 === 0) { renderLawPanel(); renderProcGrid(); }
  if (sim.tick % 30 === 0) { renderSciPanel(); }

  // Bottom bar
  const totalE    = sim.grid.totalField(F.ENERGY);
  const totalS    = sim.grid.totalField(F.ENTROPY) / sim.grid.size;
  const activeLaws = sim.laws.laws.filter(l => l.active).length;
  document.getElementById('tickOut')!.textContent    = String(sim.tick);
  document.getElementById('energyOut')!.textContent  = Math.round(totalE).toLocaleString();
  document.getElementById('entropyOut')!.textContent = totalS.toFixed(4);
  document.getElementById('lawsOut')!.textContent    = `${activeLaws}/${sim.laws.laws.length}`;
  document.getElementById('fpsOut')!.textContent     = String(fpsSmooth);

  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { lastTs = ts; fpsTimer = ts; requestAnimationFrame(loop); });
