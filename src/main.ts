import { SimulationEngine } from './simulation/SimulationEngine';
import { VoxelRenderer, LayerName } from './render/VoxelRenderer';
import { Presets, PresetName } from './world/Presets';
import { F } from './core/CellState';
import { PROCESS_LIBRARY } from './process/ProcessDef';
import { EntityLayer } from './entity/EntityLayer';

// ── Engine + renderer ─────────────────────────────────────────────────────────
const sim      = new SimulationEngine();
const canvas   = document.getElementById('gc') as HTMLCanvasElement;
const renderer = new VoxelRenderer(canvas, sim.grid.W, sim.grid.H, sim.grid.D);
const entities = new EntityLayer();

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
      cell.information = 0; cell.entropy = 0;
      continue;
    }
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

// ── Entity panel ──────────────────────────────────────────────────────────────
function updateEntityPanel() {
  const list = document.getElementById('entityList')!;
  const all  = entities.all;
  document.getElementById('entityCount')!.textContent = String(all.length);
  document.getElementById('entOut')!.textContent      = String(all.length);

  list.innerHTML = all.slice(0, 12).map(e => {
    const [r,g,b] = e.color.map(v => Math.round(v*255));
    return `<div style="display:flex;align-items:center;gap:5px;font-size:9px;padding:2px 3px;border-radius:4px;background:#1a1a22">
      <span style="width:7px;height:7px;border-radius:50%;background:rgb(${r},${g},${b});flex-shrink:0"></span>
      <span style="color:#888;">E#${e.id}</span>
      <span style="color:#555;">age:${e.age}</span>
      <span style="color:#4caf7d;">${(e.stability*100).toFixed(0)}%</span>
      <span style="color:#555;font-family:monospace;">(${Math.round(e.centroid[0])},${Math.round(e.centroid[1])},${Math.round(e.centroid[2])})</span>
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
        <button class="law-btn" data-action="mutate" data-id="${law.id}">⚡ Mutate</button>
        ${!isCore?`<button class="law-btn danger" data-action="remove" data-id="${law.id}">✕</button>`:''}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      if (btn.dataset.action === 'mutate') sim.laws.spawnMutation(id);
      if (btn.dataset.action === 'remove') sim.laws.removeLaw(id);
      renderLawPanel();
    });
  });
}

function renderProcGrid() {
  const grid = document.getElementById('procGrid')!;
  const curMask = sim.laws.activeProcessMask;
  grid.innerHTML = PROCESS_LIBRARY.map(p => {
    const on = (curMask & (1 << p.id)) !== 0;
    return `<div class="proc-row" title="${p.description}" data-procid="${p.id}">
      <span class="proc-led ${on?'on':'off'}"></span>
      <span class="proc-row-name" style="color:${on?'#ccc':'#444'}">${p.label}</span>
    </div>`;
  }).join('');
  grid.querySelectorAll<HTMLDivElement>('.proc-row').forEach(row => {
    row.addEventListener('click', () => {
      const pid = parseInt(row.dataset.procid!);
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

let entityTick = 0;

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

  // Entity detection every 15 ticks
  entityTick++;
  if (entityTick % 15 === 0) {
    entities.update(sim.grid);
    updateEntityPanel();
  }

  // 3D render with entity markers
  renderer.render(sim.grid, entities.all.map(e => ({
    id: e.id,
    centroid: e.centroid,
    stability: e.stability,
    age: e.age,
    color: e.color,
  })));

  // Right-panel updates
  if (selX >= 0 && sim.tick % 3 === 0) updateCellPanel();
  if (sim.tick % 12 === 0) updateEventLog();
  if (sim.tick % 20 === 0) { renderLawPanel(); renderProcGrid(); }

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
