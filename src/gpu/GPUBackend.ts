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
  velocity_x:   f32,  // 21 — dedicated velocity X
  velocity_y:   f32,  // 22 — dedicated velocity Y
  velocity_z:   f32,  // 23 — dedicated velocity Z
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
  erosionRate: f32,            // [20]
  pressureDiffusion: f32,       // [21]
  densityDiffusion: f32,        // [22]
  phaseTransitionRate: f32,     // [23]
  crystallizationRate: f32,     // [24]
  radiationDensityRate: f32,   // [25]
  radiationEnergyRate: f32,    // [26]
  radiationThreshold: f32,     // [27]
  fieldRotationDamping: f32,   // [28]
  fieldRotationNeighborCoupling: f32, // [29]
  fieldRotationCrossCoupling: f32, // [30]
  metabolismRate: f32,          // [31]
  signalPropagationRate: f32,   // [32]
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

fn isProcessEnabled(flag: u32) -> bool {
  return (params.activeProcesses & flag) != 0u;
}

fn densityAfterDiffusion(x: i32, y: i32, z: i32) -> f32 {
  let center = src[cidx(u32(x), u32(y), u32(z))].density;
  if (!isProcessEnabled(4u)) { return center; }
  let dx = array<i32,6>(-1, 1, 0, 0, 0, 0);
  let dy = array<i32,6>( 0, 0,-1, 1, 0, 0);
  let dz = array<i32,6>( 0, 0, 0, 0,-1, 1);
  var laplacian = 0.0;
  for (var d = 0; d < 6; d++) {
    let nx = x + dx[d]; let ny = y + dy[d]; let nz = z + dz[d];
    if (nx >= 0 && nx < i32(params.W) &&
        ny >= 0 && ny < i32(params.H) &&
        nz >= 0 && nz < i32(params.D)) {
      laplacian += src[cidx(u32(nx), u32(ny), u32(nz))].density - center;
    }
  }
  return clamp(center + params.densityDiffusion * params.dt * laplacian, 0.0, 1.0);
}

fn velocityAlong(cell: Cell, dx: i32, dy: i32, dz: i32) -> f32 {
  if (dx != 0) { return cell.velocity_x; }
  if (dy != 0) { return cell.velocity_y; }
  return cell.velocity_z;
}

// x = outgoing scale, y = incoming scale for this cell.
fn densityFluxLimiter(x: i32, y: i32, z: i32) -> vec2<f32> {
  let centerCell = src[cidx(u32(x), u32(y), u32(z))];
  let centerDensity = densityAfterDiffusion(x, y, z);
  let dx = array<i32,6>(-1, 1, 0, 0, 0, 0);
  let dy = array<i32,6>( 0, 0,-1, 1, 0, 0);
  let dz = array<i32,6>( 0, 0, 0, 0,-1, 1);
  var outgoing = 0.0;
  var incoming = 0.0;
  for (var d = 0; d < 6; d++) {
    let nx = x + dx[d]; let ny = y + dy[d]; let nz = z + dz[d];
    if (nx < 0 || nx >= i32(params.W) ||
        ny < 0 || ny >= i32(params.H) ||
        nz < 0 || nz >= i32(params.D)) { continue; }
    let neighbor = src[cidx(u32(nx), u32(ny), u32(nz))];
    let faceVelocity = 0.5 * (
      velocityAlong(centerCell, dx[d], dy[d], dz[d]) +
      velocityAlong(neighbor, dx[d], dy[d], dz[d])
    ) * f32(dx[d] + dy[d] + dz[d]);
    if (faceVelocity > 0.0) {
      outgoing += faceVelocity * params.dt * centerDensity;
    } else if (faceVelocity < 0.0) {
      incoming += -faceVelocity * params.dt * densityAfterDiffusion(nx, ny, nz);
    }
  }
  var outgoingScale = 1.0;
  if (outgoing > centerDensity && outgoing > 0.0) {
    outgoingScale = centerDensity / outgoing;
  }
  let freeCapacity = 1.0 - centerDensity;
  var incomingScale = 1.0;
  if (incoming > freeCapacity && incoming > 0.0) {
    incomingScale = freeCapacity / incoming;
  }
  return vec2<f32>(outgoingScale, incomingScale);
}

fn densityAdvectionDelta(x: i32, y: i32, z: i32) -> f32 {
  let centerCell = src[cidx(u32(x), u32(y), u32(z))];
  let dx = array<i32,6>(-1, 1, 0, 0, 0, 0);
  let dy = array<i32,6>( 0, 0,-1, 1, 0, 0);
  let dz = array<i32,6>( 0, 0, 0, 0,-1, 1);
  var hasMovingFace = false;
  for (var d = 0; d < 6; d++) {
    let nx = x + dx[d]; let ny = y + dy[d]; let nz = z + dz[d];
    if (nx < 0 || nx >= i32(params.W) ||
        ny < 0 || ny >= i32(params.H) ||
        nz < 0 || nz >= i32(params.D)) { continue; }
    let neighbor = src[cidx(u32(nx), u32(ny), u32(nz))];
    let faceVelocity = 0.5 * (
      velocityAlong(centerCell, dx[d], dy[d], dz[d]) +
      velocityAlong(neighbor, dx[d], dy[d], dz[d])
    ) * f32(dx[d] + dy[d] + dz[d]);
    if (faceVelocity != 0.0) { hasMovingFace = true; break; }
  }
  if (!hasMovingFace) { return 0.0; }
  let centerScale = densityFluxLimiter(x, y, z);
  var delta = 0.0;
  for (var d = 0; d < 6; d++) {
    let nx = x + dx[d]; let ny = y + dy[d]; let nz = z + dz[d];
    if (nx < 0 || nx >= i32(params.W) ||
        ny < 0 || ny >= i32(params.H) ||
        nz < 0 || nz >= i32(params.D)) { continue; }
    let neighbor = src[cidx(u32(nx), u32(ny), u32(nz))];
    let faceVelocity = 0.5 * (
      velocityAlong(centerCell, dx[d], dy[d], dz[d]) +
      velocityAlong(neighbor, dx[d], dy[d], dz[d])
    ) * f32(dx[d] + dy[d] + dz[d]);
    if (faceVelocity > 0.0) {
      let neighborScale = densityFluxLimiter(nx, ny, nz);
      let flux = faceVelocity * params.dt * densityAfterDiffusion(x, y, z)
        * min(centerScale.x, neighborScale.y);
      delta -= flux;
    } else if (faceVelocity < 0.0) {
      let neighborScale = densityFluxLimiter(nx, ny, nz);
      let flux = -faceVelocity * params.dt * densityAfterDiffusion(nx, ny, nz)
        * min(neighborScale.x, centerScale.y);
      delta += flux;
    }
  }
  return delta;
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
  var lapE = 0.0; var lapT = 0.0; var lapD = 0.0; var lapI = 0.0; var lapP = 0.0;
  var fxSum = 0.0; var fySum = 0.0; var fzSum = 0.0; var fieldNeighborCount = 0.0;

  // Neumann boundary: out-of-bounds neighbors reflect (same as center cell)
  var nbE = array<f32,6>(c.energy,c.energy,c.energy,c.energy,c.energy,c.energy);
  var nbT = array<f32,6>(c.temperature,c.temperature,c.temperature,c.temperature,c.temperature,c.temperature);
  var nbD = array<f32,6>(c.density,c.density,c.density,c.density,c.density,c.density);
  var nbI = array<f32,6>(c.information,c.information,c.information,c.information,c.information,c.information);
  var nbP = array<f32,6>(c.pressure,c.pressure,c.pressure,c.pressure,c.pressure,c.pressure);

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
      nbP[d]  = nb.pressure;
      fxSum += nb.field_x;
      fySum += nb.field_y;
      fzSum += nb.field_z;
      fieldNeighborCount += 1.0;
    }
    lapE += nbE[d] - c.energy;
    lapT += nbT[d] - c.temperature;
    lapD += nbD[d] - c.density;
    lapI += nbI[d] - c.information;
    lapP += nbP[d] - c.pressure;
  }

  // ── PROC 0: Energy Diffusion ───────────────────────────────────────────────
  if (isProcessEnabled(1u)) {
    o.energy = clamp(c.energy + params.energyDiffusion * mat.conductivity * dt * lapE, 0.0, 9999.0);
  }

  // ── PROC 1: Thermal Flow ───────────────────────────────────────────────────
  if (isProcessEnabled(2u)) {
    let heat = c.energy * params.tempEnergyCoupling * dt;
    let tDiff = params.tempDiffusion / max(mat.heatCapacity, 0.1);
    o.temperature = max(0.0, c.temperature + tDiff * dt * lapT + heat);
  }

  // ── PROC 2: Density Flow ───────────────────────────────────────────────────
  if (isProcessEnabled(4u)) {
    o.density = clamp(c.density + params.densityDiffusion * dt * lapD, 0.0, 1.0);
  }
  // PROC 16: Conservative density advection (closed boundaries, limited face fluxes).
  if (isProcessEnabled(65536u)) {
    o.density = clamp(
      densityAfterDiffusion(ix, iy, iz) + densityAdvectionDelta(ix, iy, iz),
      0.0, 1.0,
    );
  }

  // ── PROC 3: Entropy Growth (second law — cannot be disabled by MetaLaw) ───
  if (isProcessEnabled(8u)) {
    // Match the CPU operator order: energy/thermal diffusion has already
    // populated o.energy/o.temperature before entropy growth is evaluated.
    let dS = (params.entropyGrowthRate
              + o.energy * params.entropyEnergyCoupling
              + o.temperature * 0.00005) * dt;
    o.entropy = min(1.0, o.entropy + dS);
    // Energy attenuation uses the newly integrated entropy state.
    o.energy = max(0.0, o.energy * (1.0 - o.entropy * 0.0005 * dt * 60.0));
  }

  // Signal propagation is a FieldPhysics-stage output. Information dynamics
  // then consumes the updated information and the post-entropy field state.
  if (isProcessEnabled(1024u)) {
    let sigRate = params.signalPropagationRate * params.infoGrowthRate * dt;
    o.information = clamp(c.information + sigRate * lapI, 0.0, 999.0);
  }

  // ── PROC 4: Information Dynamics ──────────────────────────────────────────
  if (isProcessEnabled(16u)) {
    let supp = 1.0 - o.entropy * params.infoEntropySupp;
    if (o.energy > params.infoGrowthThreshE && o.density > params.infoGrowthThreshD && supp > 0.0) {
      o.information = min(999.0, o.information + params.infoGrowthRate * supp * dt);
    } else {
      o.information = o.information * pow(0.999, dt * 60.0);
    }
  }

  // ── PROC 5: Bio-Emergence ─────────────────────────────────────────────────
  if (isProcessEnabled(32u)) {
    let bio = (c.information / 200.0) * 0.4
            + min(c.energy / 500.0, 1.0) * 0.3
            + c.density * 0.2
            + (1.0 - c.entropy) * 0.1
            + mat.bioAffinity;
    o.bio_potential = clamp(bio, 0.0, 1.0);
  }

  // ── PROC 6: Wave Propagation ──────────────────────────────────────────────
  if (isProcessEnabled(64u)) {
    o.wave_phase = (c.wave_phase + params.waveSpeed * dt) % 6.28318530;
    o.wave_amp   = c.wave_amp * params.waveDamping;
    o.energy     = o.energy + c.wave_amp * sin(c.wave_phase) * 0.008;
  }

  // ── PROC 7: Gravity (density-gradient acceleration; Neumann boundaries) ──
  if (isProcessEnabled(128u)) {
    let acceleration_x = -params.gravityDensityCoupling * (nbD[1] - nbD[0]) * 0.5;
    let acceleration_y = -params.gravityDensityCoupling * (nbD[3] - nbD[2]) * 0.5;
    let acceleration_z = -params.gravityDensityCoupling * (nbD[5] - nbD[4]) * 0.5;
    o.field_x = c.field_x + acceleration_x * dt;
    o.field_y = c.field_y + acceleration_y * dt;
    o.field_z = c.field_z + acceleration_z * dt;
    o.velocity_x = c.velocity_x + acceleration_x * dt;
    o.velocity_y = c.velocity_y + acceleration_y * dt;
    o.velocity_z = c.velocity_z + acceleration_z * dt;
  }

  // ── PROC 8: Phase Transitions ─────────────────────────────────────────────
  if (isProcessEnabled(256u)) {
    if (c.temperature > 500.0 && c.density > 0.5) {
      // Boiling: gate on the pre-step state, but compose with prior outputs in this step.
      o.density = max(0.0, o.density - params.phaseTransitionRate * dt * 60.0);
      o.entropy = min(1.0, o.entropy + params.phaseTransitionRate * dt * 60.0);
      o.information = max(0.0, o.information - 3.0 * dt);
    } else if (c.temperature < 40.0 && c.density > 0.55) {
      // Freezing / solidification: preserve density diffusion/advection output.
      o.density = min(1.0, o.density + params.phaseTransitionRate * 0.5 * dt * 60.0);
      o.entropy = max(0.0, o.entropy - params.phaseTransitionRate * 0.5 * dt * 60.0);
    }
  }

  // ── PROC 9: Metabolism ────────────────────────────────────────────────────
  if (isProcessEnabled(512u)) {
    // Bio potential may have been recalculated earlier in this shader step.
    // Match CPU/worker ordering and use the canonical metabolism parameter.
    if (o.bio_potential > 0.45) {
      let rate = o.bio_potential * params.metabolismRate * dt;
      o.energy      = max(0.0, o.energy - rate * 60.0);
      o.information = min(999.0, o.information + rate * 25.0);
      o.entropy     = min(1.0, o.entropy + rate * 0.008);
    }
  }

  // ── PROC 11: Crystallization ──────────────────────────────────────────────
  if (isProcessEnabled(2048u)) {
    if (c.entropy < 0.18 && c.density > 0.38) {
      let materialRate = select(mat.crystallizationRate, 1.0, matIdx == 0u);
      let cRate = params.crystallizationRate * materialRate;
      // Use the immutable pre-step state for eligibility, then compose with prior field updates.
      o.density = min(1.0, o.density + cRate * (0.18 - c.entropy) * dt * 60.0);
      o.entropy = max(0.0, o.entropy - cRate * 0.5 * dt * 60.0);
      if (cRate > 0.0 && (matIdx == 0u || matIdx == 1u || matIdx == 2u)) {
        o.material_id = 3.0;
      }
    }
  }

  // ── PROC 12: Radiation Pressure ───────────────────────────────────────────
  if (isProcessEnabled(4096u)) {
    if (c.energy > params.radiationThreshold) {
      let absorbed = mat.radiationAbsorption;
      o.density = max(0.0, o.density - (c.energy - params.radiationThreshold)
        * params.radiationDensityRate * (1.0 - absorbed) * dt * 60.0);
      o.energy = max(0.0, o.energy - (c.energy - params.radiationThreshold)
        * params.radiationEnergyRate * dt * 60.0);
    }
  }

  // ── PROC 13: Pressure Diffusion ───────────────────────────────────────────
  if (isProcessEnabled(8192u)) {
    let equilibriumPressure = (c.density * params.pressureDensityCoupling - c.temperature * 0.1) * mat.elasticity;
    o.pressure = clamp(
      c.pressure + params.pressureDiffusion * dt * lapP
        + (equilibriumPressure - c.pressure) * dt,
      -9999.0, 9999.0
    );
  }

  // ── PROC 14: Field Rotation (heuristic vector relaxation) ──────────────────
  if (isProcessEnabled(16384u)) {
    let neighborCount = max(fieldNeighborCount, 1.0);
    let avgFx = fxSum / neighborCount;
    let avgFy = fySum / neighborCount;
    let avgFz = fzSum / neighborCount;
    let rotateFx = o.field_x;
    let rotateFy = o.field_y;
    let rotateFz = o.field_z;
    o.field_x = rotateFx * params.fieldRotationDamping
      + avgFx * params.fieldRotationNeighborCoupling
      + rotateFy * params.fieldRotationCrossCoupling;
    o.field_y = rotateFy * params.fieldRotationDamping
      + avgFy * params.fieldRotationNeighborCoupling
      - rotateFx * params.fieldRotationCrossCoupling;
    o.field_z = rotateFz * params.fieldRotationDamping
      + avgFz * params.fieldRotationNeighborCoupling;
  }

  // ── PROC 15: Erosion ──────────────────────────────────────────────────────
  if (isProcessEnabled(32768u)) {
    let flow = abs(c.field_x) + abs(c.field_y) + abs(c.field_z);
    if (c.density > 0.65 && flow > 8.0) {
      let resistance = mat.erosionResistance;
      o.density     = max(0.0, o.density - params.erosionRate * (1.0 - resistance) * dt * 60.0);
      o.information = max(0.0, o.information - 0.4 * (1.0 - resistance) * dt);
    }
  }

  // ── Always: local time ────────────────────────────────────────────────────
  // Match CPU operator order: local time consumes the fields after all enabled processes.
  o.local_time = c.local_time + params.timeBaseRate * dt
    * (1.0 + o.energy * params.timeEnergyBoost + o.entropy * 0.5);

  dst[i] = o;
}
`;

// Byte layout of SimParams in the storage buffer (matches WGSL struct)
const PARAMS_FLOATS = 33; // 33 × 4 bytes = 132 bytes

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
    const compilation = await mod.getCompilationInfo();
    const shaderErrors = compilation.messages.filter(message => message.type === 'error');
    if (shaderErrors.length > 0) {
      const details = shaderErrors.map(message =>
        `line ${message.lineNum}, column ${message.linePos}: ${message.message}`
      ).join('\\n');
      throw new Error(`[GPU] WGSL shader compilation failed:\\n${details}`);
    }
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
    f32[20] = p.erosionRate;
    f32[21] = p.pressureDiffusion;
    f32[22] = p.densityDiffusion;
    f32[23] = p.phaseTransitionRate;
    f32[24] = p.crystallizationRate;
    f32[25] = p.radiationDensityRate;
    f32[26] = p.radiationEnergyRate;
    f32[27] = p.radiationThreshold;
    f32[28] = p.fieldRotationDamping;
    f32[29] = p.fieldRotationNeighborCoupling;
    f32[30] = p.fieldRotationCrossCoupling;
    f32[31] = p.metabolismRate;
    f32[32] = p.signalPropagationRate;
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
