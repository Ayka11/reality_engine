import { CELL_FIELDS } from '../core/CellState';
import { PhysicsParams } from '../laws/MetaLaw';
import { MAT_COUNT } from '../materials/MaterialDef';

// ─── WGSL compute shader ──────────────────────────────────────────────────────
const SHADER = /* wgsl */`
struct Cell {
  energy:       f32,  // 0
  density:      f32,  // 1
  information:  f32,  // 2
  entropy:      f32,  // 3
  temperature:  f32,  // 4
  pressure:     f32,  // 5
  field_x:      f32,  // 6
  field_y:      f32,  // 7
  field_z:      f32,  // 8
  local_time:   f32,  // 9
  causality_id: f32,  // 10
  bio_potential:f32,  // 11
  wave_phase:   f32,  // 12
  wave_amp:     f32,  // 13
  gravity_pot:  f32,  // 14
  material_id:  f32,  // 15 — material type (MAT enum)
  chem_state:   f32,  // 16 — chemical state (CHEM enum)
  signal:       f32,  // 17 — entity communication signal
  mem_field:    f32,  // 18 — information memory trace
  agent_mark:   f32,  // 19 — AI agent occupancy
  entity_id:    f32,  // 20 — entity membership id
  spare1:       f32,  // 21
  spare2:       f32,  // 22
  spare3:       f32,  // 23
}

// Flat storage layout (4-byte aligned, no padding needed)
struct SimParams {
  W: u32,                      // [0]
  H: u32,                      // [1]
  D: u32,                      // [2]
  activeProcesses: u32,        // [3]
  dt: f32,                     // [4]
  energyDiffusion: f32,        // [5]
  tempDiffusion: f32,          // [6]
  tempEnergyCoupling: f32,     // [7]
  pressureDensityCoupling: f32,// [8]
  entropyGrowthRate: f32,      // [9]
  entropyEnergyCoupling: f32,  // [10]
  infoGrowthRate: f32,         // [11]
  infoEntropySupp: f32,        // [12]
  infoGrowthThreshE: f32,      // [13]
  infoGrowthThreshD: f32,      // [14]
  waveSpeed: f32,              // [15]
  waveDamping: f32,            // [16]
  gravityDensityCoupling: f32, // [17]
  timeBaseRate: f32,           // [18]
  timeEnergyBoost: f32,        // [19]
}

// Material coefficients: MAT_COUNT × 7 floats
// [0]=conductivity [1]=heatCapacity [2]=elasticity [3]=erosionResistance
// [4]=crystallizationRate [5]=bioAffinity [6]=radiationAbsorption
struct MatCoeffs {
  conductivity:        f32,
  heatCapacity:        f32,
  elasticity:          f32,
  erosionResistance:   f32,
  crystallizationRate: f32,
  bioAffinity:         f32,
  radiationAbsorption: f32,
  _pad:                f32,  // pad to 32 bytes (8 × f32)
}

@group(0) @binding(0) var<storage, read>       src:     array<Cell>;
@group(0) @binding(1) var<storage, read_write> dst:     array<Cell>;
@group(0) @binding(2) var<storage, read>       params:  SimParams;
@group(0) @binding(3) var<storage, read>       matBuf:  array<MatCoeffs>;

fn cidx(x: u32, y: u32, z: u32) -> u32 {
  return z * params.H * params.W + y * params.W + x;
}

fn active(flag: u32) -> bool {
  return (params.activeProcesses & flag) != 0u;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x; let y = gid.y; let z = gid.z;
  if (x >= params.W || y >= params.H || z >= params.D) { return; }

  let i = cidx(x, y, z);
  let c = src[i];
  var o = c;

  let dt = params.dt;
  let ix = i32(x); let iy = i32(y); let iz = i32(z);

  // ── Material coefficients for this cell ───────────────────────────────────
  let matIdx = clamp(u32(c.material_id), 0u, 13u);
  let mat = matBuf[matIdx];

  // ── 6-neighbor Laplacians ──────────────────────────────────────────────────
  var lapE = 0.0; var lapT = 0.0; var lapD = 0.0; var lapI = 0.0;
  var fxSum = 0.0; var fySum = 0.0; var fzSum = 0.0;

  // Neumann boundary: out-of-bounds neighbors reflect (same as center cell)
  var nbE = array<f32,6>(c.energy,c.energy,c.energy,c.energy,c.energy,c.energy);
  var nbT = array<f32,6>(c.temperature,c.temperature,c.temperature,c.temperature,c.temperature,c.temperature);
  var nbD = array<f32,6>(c.density,c.density,c.density,c.density,c.density,c.density);
  var nbI = array<f32,6>(c.information,c.information,c.information,c.information,c.information,c.information);
  var nbFx = array<f32,6>(c.field_x,c.field_x,c.field_x,c.field_x,c.field_x,c.field_x);
  var nbFy = array<f32,6>(c.field_y,c.field_y,c.field_y,c.field_y,c.field_y,c.field_y);
  var nbFz = array<f32,6>(c.field_z,c.field_z,c.field_z,c.field_z,c.field_z,c.field_z);

  let dx = array<i32,6>(-1, 1, 0, 0, 0, 0);
  let dy = array<i32,6>( 0, 0,-1, 1, 0, 0);
  let dz = array<i32,6>( 0, 0, 0, 0,-1, 1);

  for (var d = 0; d < 6; d++) {
    let nx = ix + dx[d]; let ny = iy + dy[d]; let nz = iz + dz[d];
    if (nx >= 0 && nx < i32(params.W) && ny >= 0 && ny < i32(params.H) && nz >= 0 && nz < i32(params.D)) {
      let nb = src[cidx(u32(nx), u32(ny), u32(nz))];
      nbE[d]  = nb.energy;
      nbT[d]  = nb.temperature;
      nbD[d]  = nb.density;
      nbI[d]  = nb.information;
      nbFx[d] = nb.field_x;
      nbFy[d] = nb.field_y;
      nbFz[d] = nb.field_z;
    }
    lapE += nbE[d] - c.energy;
    lapT += nbT[d] - c.temperature;
    lapD += nbD[d] - c.density;
    lapI += nbI[d] - c.information;
    fxSum += nbFx[d];
    fySum += nbFy[d];
    fzSum += nbFz[d];
  }

  // ── PROC 0: Energy Diffusion ───────────────────────────────────────────────
  if (active(1u)) {
    o.energy = clamp(c.energy + params.energyDiffusion * mat.conductivity * dt * lapE, 0.0, 9999.0);
  }

  // ── PROC 1: Thermal Flow ───────────────────────────────────────────────────
  if (active(2u)) {
    let heat = c.energy * params.tempEnergyCoupling * dt;
    let tDiff = params.tempDiffusion / max(mat.heatCapacity, 0.1);
    o.temperature = max(0.0, c.temperature + tDiff * dt * lapT + heat);
  }

  // ── PROC 2: Density Flow ───────────────────────────────────────────────────
  if (active(4u)) {
    o.density = clamp(c.density + 0.02 * params.energyDiffusion * dt * lapD, 0.0, 1.0);
  }

  // ── PROC 3: Entropy Growth (second law — cannot be disabled by MetaLaw) ───
  if (active(8u)) {
    let dS = (params.entropyGrowthRate
              + c.energy * params.entropyEnergyCoupling
              + c.temperature * 0.00005) * dt;
    o.entropy = min(1.0, c.entropy + dS);
    // Entropy degrades energy
    o.energy = max(0.0, o.energy * (1.0 - c.entropy * 0.0005 * dt * 60.0));
  }

  // ── PROC 4: Information Dynamics ──────────────────────────────────────────
  if (active(16u)) {
    let supp = 1.0 - c.entropy * params.infoEntropySupp;
    if (c.energy > params.infoGrowthThreshE && c.density > params.infoGrowthThreshD && supp > 0.0) {
      o.information = min(999.0, c.information + params.infoGrowthRate * supp * dt);
    } else {
      o.information = c.information * pow(0.999, dt * 60.0);
    }
  }

  // ── PROC 5: Bio-Emergence ─────────────────────────────────────────────────
  if (active(32u)) {
    let bio = (c.information / 200.0) * 0.4
            + min(c.energy / 500.0, 1.0) * 0.3
            + c.density * 0.2
            + (1.0 - c.entropy) * 0.1
            + mat.bioAffinity;
    o.bio_potential = clamp(bio, 0.0, 1.0);
  }

  // ── PROC 6: Wave Propagation ──────────────────────────────────────────────
  if (active(64u)) {
    o.wave_phase = (c.wave_phase + params.waveSpeed * dt) % 6.28318530;
    o.wave_amp   = c.wave_amp * params.waveDamping;
    o.energy     = o.energy + c.wave_amp * sin(c.wave_phase) * 0.008;
  }

  // ── PROC 7: Gravity ───────────────────────────────────────────────────────
  if (active(128u)) {
    o.density = clamp(c.density + params.gravityDensityCoupling * c.gravity_pot * dt, 0.0, 1.0);
  }

  // ── PROC 8: Phase Transitions ─────────────────────────────────────────────
  if (active(256u)) {
    if (c.temperature > 500.0 && c.density > 0.5) {
      // Boiling
      o.density   = max(0.0, c.density - 0.008 * dt * 60.0);
      o.entropy   = min(1.0, c.entropy + 0.008 * dt * 60.0);
      o.information = max(0.0, c.information - 3.0 * dt);
    } else if (c.temperature < 40.0 && c.density > 0.55) {
      // Freezing / solidification
      o.density = min(1.0, c.density + 0.004 * dt * 60.0);
      o.entropy = max(0.0, c.entropy - 0.004 * dt * 60.0);
    }
  }

  // ── PROC 9: Metabolism ────────────────────────────────────────────────────
  if (active(512u)) {
    if (c.bio_potential > 0.45) {
      let rate = c.bio_potential * 0.12 * dt;
      o.energy      = max(0.0, o.energy - rate * 60.0);
      o.information = min(999.0, o.information + rate * 25.0);
      o.entropy     = min(1.0, o.entropy + rate * 0.008);
    }
  }

  // ── PROC 10: Signal Propagation ───────────────────────────────────────────
  if (active(1024u)) {
    let sigRate = 0.06 * params.infoGrowthRate * dt;
    o.information = clamp(c.information + sigRate * lapI, 0.0, 999.0);
  }

  // ── PROC 11: Crystallization ──────────────────────────────────────────────
  if (active(2048u)) {
    if (c.entropy < 0.18 && c.density > 0.38) {
      let cRate = 0.003 * mat.crystallizationRate;
      o.density = min(1.0, c.density + cRate * (0.18 - c.entropy) * dt * 60.0);
      o.entropy = max(0.0, c.entropy - cRate * 0.5 * dt * 60.0);
    }
  }

  // ── PROC 12: Radiation Pressure ───────────────────────────────────────────
  if (active(4096u)) {
    if (c.energy > 400.0) {
      let absorbed = mat.radiationAbsorption;
      o.density = max(0.0, c.density - (c.energy - 400.0) * 0.00008 * (1.0 - absorbed) * dt * 60.0);
      o.energy  = max(0.0, o.energy - (c.energy - 400.0) * 0.0001 * dt * 60.0);
    }
  }

  // ── PROC 13: Pressure Diffusion ───────────────────────────────────────────
  if (active(8192u)) {
    o.pressure = c.density * params.pressureDensityCoupling - c.temperature * 0.1;
  }

  // ── PROC 14: Field Rotation (curl) ────────────────────────────────────────
  if (active(16384u)) {
    let avgFx = fxSum / 6.0; let avgFy = fySum / 6.0; let avgFz = fzSum / 6.0;
    o.field_x = c.field_x * 0.94 + avgFx * 0.05 + c.field_y * 0.01;
    o.field_y = c.field_y * 0.94 + avgFy * 0.05 - c.field_x * 0.01;
    o.field_z = c.field_z * 0.94 + avgFz * 0.05;
  } else {
    o.field_x = c.field_x * 0.95 + (fxSum / 6.0) * 0.05;
    o.field_y = c.field_y * 0.95 + (fySum / 6.0) * 0.05;
    o.field_z = c.field_z * 0.95 + (fzSum / 6.0) * 0.05;
  }

  // ── PROC 15: Erosion ──────────────────────────────────────────────────────
  if (active(32768u)) {
    let flow = abs(c.field_x) + abs(c.field_y) + abs(c.field_z);
    if (c.density > 0.65 && flow > 8.0) {
      let resistance = mat.erosionResistance;
      o.density     = max(0.0, c.density - 0.0018 * (1.0 - resistance) * dt * 60.0);
      o.information = max(0.0, c.information - 0.4 * (1.0 - resistance) * dt);
    }
  }

  // ── Always: local time ────────────────────────────────────────────────────
  o.local_time = c.local_time + params.timeBaseRate * dt
    * (1.0 + c.energy * params.timeEnergyBoost + c.entropy * 0.5);

  dst[i] = o;
}
`;

// Byte layout of SimParams in the storage buffer (matches WGSL struct)
const PARAMS_FLOATS = 20; // 20 × 4 bytes = 80 bytes

export class GPUBackend {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private srcBuf: GPUBuffer | null = null;
  private dstBuf: GPUBuffer | null = null;
  private paramsBuf: GPUBuffer | null = null;
  private matBuf: GPUBuffer | null = null;
  private stagingBuf: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  W = 0; H = 0; D = 0;
  private cellCount = 0;
  private bufSize = 0;

  get isAvailable() { return this.device !== null; }

  async init(W: number, H: number, D: number): Promise<boolean> {
    this.W = W; this.H = H; this.D = D;
    this.cellCount = W * H * D;
    this.bufSize = this.cellCount * CELL_FIELDS * 4; // CELL_FIELDS f32 × 4 bytes

    if (!navigator.gpu) {
      console.warn('[GPU] WebGPU not supported — CPU fallback active');
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      console.warn('[GPU] No adapter found — CPU fallback active');
      return false;
    }

    this.device = await adapter.requestDevice();

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.srcBuf = this.device.createBuffer({ size: this.bufSize, usage });
    this.dstBuf = this.device.createBuffer({ size: this.bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.stagingBuf = this.device.createBuffer({
      size: this.bufSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.paramsBuf = this.device.createBuffer({
      size: Math.max(256, PARAMS_FLOATS * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Material coefficient buffer: MAT_COUNT × 8 floats (7 coeffs + 1 pad) × 4 bytes
    this.matBuf = this.device.createBuffer({
      size: Math.max(256, MAT_COUNT * 8 * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const mod = this.device.createShaderModule({ code: SHADER });
    this.pipeline = await this.device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: mod, entryPoint: 'main' },
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.srcBuf } },
        { binding: 1, resource: { buffer: this.dstBuf } },
        { binding: 2, resource: { buffer: this.paramsBuf } },
        { binding: 3, resource: { buffer: this.matBuf } },
      ],
    });

    console.log(`[GPU] WebGPU ready — ${adapter.info?.device ?? 'unknown device'}`);
    return true;
  }

  uploadMaterials(data: Float32Array): void {
    if (!this.device || !this.matBuf) return;
    // data is MAT_COUNT × 7 floats; pad each entry to 8 floats for GPU alignment
    const padded = new Float32Array(MAT_COUNT * 8);
    for (let i = 0; i < MAT_COUNT; i++) {
      for (let j = 0; j < 7; j++) padded[i * 8 + j] = data[i * 7 + j];
    }
    this.device.queue.writeBuffer(this.matBuf, 0, padded.buffer, 0, padded.byteLength);
  }

  upload(data: Float32Array): void {
    if (!this.device || !this.srcBuf) return;
    // Pass the underlying ArrayBuffer to avoid SharedArrayBuffer type mismatch
    this.device.queue.writeBuffer(this.srcBuf, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  writeParams(p: Readonly<PhysicsParams>, activeMask: number, dt: number): void {
    if (!this.device || !this.paramsBuf) return;
    const ab  = new ArrayBuffer(PARAMS_FLOATS * 4);
    const u32 = new Uint32Array(ab);
    const f32 = new Float32Array(ab);
    u32[0] = this.W;  u32[1] = this.H;  u32[2] = this.D;  u32[3] = activeMask;
    f32[4]  = dt;
    f32[5]  = p.energyDiffusion;
    f32[6]  = p.tempDiffusion;
    f32[7]  = p.tempEnergyCoupling;
    f32[8]  = p.pressureDensityCoupling;
    f32[9]  = p.entropyGrowthRate;
    f32[10] = p.entropyEnergyCoupling;
    f32[11] = p.infoGrowthRate;
    f32[12] = p.infoEntropySupp;
    f32[13] = p.infoGrowthThreshE;
    f32[14] = p.infoGrowthThreshD;
    f32[15] = p.waveSpeed;
    f32[16] = p.waveDamping;
    f32[17] = p.gravityDensityCoupling;
    f32[18] = p.timeBaseRate;
    f32[19] = p.timeEnergyBoost;
    this.device.queue.writeBuffer(this.paramsBuf, 0, ab);
  }

  // Dispatch N compute steps in a single command encoder (efficient multi-step)
  submitCompute(nSteps: number): void {
    if (!this.device || !this.pipeline || !this.bindGroup || !this.srcBuf || !this.dstBuf) return;
    const enc = this.device.createCommandEncoder();
    const wx = Math.ceil(this.W / 8);
    const wy = Math.ceil(this.H / 8);

    for (let s = 0; s < nSteps; s++) {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.dispatchWorkgroups(wx, wy, this.D);
      pass.end();
      // Swap dst → src for next step (srcBuf always contains latest state)
      enc.copyBufferToBuffer(this.dstBuf, 0, this.srcBuf, 0, this.bufSize);
    }

    // Copy final result from srcBuf to staging for CPU readback
    enc.copyBufferToBuffer(this.srcBuf, 0, this.stagingBuf!, 0, this.bufSize);
    this.device.queue.submit([enc.finish()]);
  }

  async readback(): Promise<Float32Array> {
    if (!this.device || !this.stagingBuf) return new Float32Array(0);
    await this.stagingBuf.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(this.stagingBuf.getMappedRange().slice(0));
    this.stagingBuf.unmap();
    return data;
  }

  destroy(): void {
    this.srcBuf?.destroy();
    this.dstBuf?.destroy();
    this.stagingBuf?.destroy();
    this.paramsBuf?.destroy();
    this.matBuf?.destroy();
    this.device?.destroy();
    this.device = null;
  }
}
