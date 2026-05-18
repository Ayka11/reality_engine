/**
 * SolverClient — browser-side connector to the Python solver microservice.
 *
 * Endpoint: http://localhost:8765  (configured via SOLVER_URL)
 * Falls back gracefully when the microservice is offline.
 *
 * Usage:
 *   const client = new SolverClient()
 *   await client.checkStatus()
 *   const result = await client.solve({ solver: 'numpy_turing_patterns', W, H, NF, energy_field: [...] })
 *   client.applyResult(result, buf, W, H, NF)
 */

export const SOLVER_URL = 'http://localhost:8765'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SolverRequest {
  solver: string
  W: number; H: number; D?: number; NF?: number
  energy_field?:  number[]
  density_field?: number[]
  info_field?:    number[]
  entropy_field?: number[]
  temp_field?:    number[]
  bio_field?:     number[]
  [key: string]: unknown
}

export interface SolverResult {
  ok: boolean
  solver?: string
  equation?: string
  error?: string
  params?: Record<string, unknown>
  // Single-field result
  field_id?:        number
  values?:          number[]
  // Dual-field (e.g., Turing u/v)
  field_id_u?:      number
  field_id_v?:      number
  u_values?:        number[]
  v_values?:        number[]
  // Vector fields (flow)
  field_vy_id?:     number
  field_vx_id?:     number
  vx?:              number[]
  vy?:              number[]
  // Density + energy
  field_density_id?: number
  density?:          number[]
  // Extra
  active_cells?: number
  n_atoms?: number
  min?: number
  max?: number
}

export interface SolverMeta {
  label:    string
  desc:     string
  requires: string
  equation: string
}

export interface SolverStatus {
  online: boolean
  solvers: Record<string, SolverMeta>
  capabilities: {
    fenics: boolean; mfem: boolean; elmer: boolean
    moose: boolean; gromacs: boolean; numpy: boolean
  }
}

// ── SolverClient ──────────────────────────────────────────────────────────────

export class SolverClient {
  status: SolverStatus = {
    online: false,
    solvers: {},
    capabilities: { fenics:false, mfem:false, elmer:false, moose:false, gromacs:false, numpy:false },
  }
  private ws: WebSocket | null = null
  onProgress: ((msg: string) => void) | null = null

  async checkStatus(): Promise<boolean> {
    try {
      const res = await fetch(`${SOLVER_URL}/status`, {
        signal: AbortSignal.timeout(2500),
      })
      const data = await res.json()
      this.status = {
        online: data.status === 'ok',
        solvers: data.solvers ?? {},
        capabilities: data.capabilities ?? this.status.capabilities,
      }
      return this.status.online
    } catch {
      this.status.online = false
      return false
    }
  }

  async solve(req: SolverRequest): Promise<SolverResult> {
    if (!this.status.online) {
      return { ok: false, error: 'Solver microservice is offline. See setup instructions.' }
    }
    try {
      const res = await fetch(`${SOLVER_URL}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(90_000),
      })
      const data = await res.json()
      return { ok: !data.error, ...data }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }

  /** Open a WebSocket for streaming progress during long solves. */
  connectWS(onMessage: (data: Record<string, unknown>) => void) {
    if (this.ws?.readyState === WebSocket.OPEN) return
    this.ws = new WebSocket(`${SOLVER_URL.replace('http','ws')}/ws`)
    this.ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)) } catch {} }
    this.ws.onerror   = () => { this.ws = null }
  }

  async solveWS(req: SolverRequest): Promise<SolverResult> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connectWS(() => {})
        setTimeout(() => resolve(this.solve(req)), 400) // fallback to HTTP
        return
      }
      const handler = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Record<string, unknown>
          if (data.status === 'done' || data.error) {
            this.ws!.removeEventListener('message', handler)
            resolve({ ok: !data.error, ...(data as object) } as SolverResult)
          } else {
            this.onProgress?.(String(data.status ?? 'computing…'))
          }
        } catch {}
      }
      this.ws.addEventListener('message', handler)
      this.ws.send(JSON.stringify(req))
    })
  }

  // ── Field helpers ────────────────────────────────────────────────────────────

  /** Extract a 2D field slice from the simulation buffer as a plain number[]. */
  extractField(
    buf: Float32Array, W: number, H: number, NF: number,
    fieldIdx: number, zSlice = 0,
  ): number[] {
    const out: number[] = []
    const base = zSlice * H * W
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      out.push(buf[(base + y * W + x) * NF + fieldIdx] ?? 0)
    }
    return out
  }

  /** Write a solver result back into the simulation buffer. */
  applyResult(
    result: SolverResult, buf: Float32Array,
    W: number, H: number, NF: number, zSlice = 0,
  ): void {
    if (!result.ok) return
    const base = zSlice * H * W
    const clamp = (v: number) => Math.max(0, Math.min(9999, v))

    const writeField = (vals: number[] | undefined, fi: number | undefined) => {
      if (!vals || fi === undefined) return
      for (let i = 0; i < Math.min(vals.length, W * H); i++) {
        buf[(base + i) * NF + fi] = clamp(vals[i] ?? 0)
      }
    }

    writeField(result.values,   result.field_id)
    writeField(result.u_values, result.field_id_u)
    writeField(result.v_values, result.field_id_v)
    writeField(result.vx,       result.field_id ?? result.field_vx_id)
    writeField(result.vy,       result.field_vy_id)
    writeField(result.density,  result.field_density_id)
  }

  /** Build SolverRequest from current sim state. */
  buildRequest(
    solver: string,
    buf: Float32Array, W: number, H: number, NF: number,
    extraParams: Record<string, unknown> = {},
  ): SolverRequest {
    const [FE, FD, FI, FS, FT, , , , , , FBio] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    return {
      solver, W, H, D: 1, NF,
      energy_field:  this.extractField(buf, W, H, NF, FE),
      density_field: this.extractField(buf, W, H, NF, FD),
      info_field:    this.extractField(buf, W, H, NF, FI),
      entropy_field: this.extractField(buf, W, H, NF, FS),
      temp_field:    this.extractField(buf, W, H, NF, FT),
      bio_field:     this.extractField(buf, W, H, NF, FBio),
      ...extraParams,
    }
  }
}

// ── Solver Panel HTML builder ─────────────────────────────────────────────────

export interface SimDef {
  id: string; icon: string; label: string; desc: string; requires: string
  params: { key: string; label: string; min: number; max: number; step: number; default: number }[]
  equation: string
}

export const SIMULATION_CATALOG: SimDef[] = [
  {
    id: 'numpy_turing_patterns', icon: '🧪', label: 'Turing Patterns',
    desc: 'Gray-Scott reaction-diffusion → spots, stripes, labyrinth patterns',
    requires: 'Built-in — zero install',
    equation: '∂u/∂t = Dᵤ∇²u − uv² + f(1−u)',
    params: [
      { key: 'D_u',   label: 'D_u (activator)',  min: 0.05, max: 0.5,  step: 0.01, default: 0.16 },
      { key: 'D_v',   label: 'D_v (inhibitor)',  min: 0.01, max: 0.3,  step: 0.01, default: 0.08 },
      { key: 'f',     label: 'f (feed rate)',    min: 0.01, max: 0.1,  step: 0.001,default: 0.035},
      { key: 'k',     label: 'k (kill rate)',    min: 0.04, max: 0.09, step: 0.001,default: 0.065},
      { key: 'steps', label: 'Steps',            min: 200,  max: 3000, step: 100,  default: 800  },
    ],
  },
  {
    id: 'numpy_wave_equation', icon: '〰️', label: 'Wave Propagation',
    desc: '2D wave equation driven by energy distribution',
    requires: 'Built-in — zero install',
    equation: '∂²u/∂t² = c²∇²u',
    params: [
      { key: 'wave_speed', label: 'Wave speed',  min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
      { key: 'steps',      label: 'Time steps',  min: 50,  max: 600, step: 50,  default: 300 },
    ],
  },
  {
    id: 'numpy_heat_diffusion', icon: '🌡️', label: 'Heat Diffusion',
    desc: 'Steady-state Laplace/heat equation from energy sources',
    requires: 'Built-in — zero install',
    equation: '−∇·(k∇T) = f(energy)',
    params: [
      { key: 'conductivity', label: 'Conductivity k', min: 0.1, max: 10, step: 0.1, default: 1.0 },
    ],
  },
  {
    id: 'numpy_fluid_flow', icon: '💧', label: 'Fluid Flow (Stokes)',
    desc: 'Incompressible 2D flow from energy-pressure gradient',
    requires: 'Built-in — zero install',
    equation: 'μ∇²u = ∇p,  ∇·u = 0',
    params: [
      { key: 'viscosity', label: 'Viscosity μ', min: 0.001, max: 0.5, step: 0.001, default: 0.01 },
    ],
  },
  {
    id: 'numpy_thermal_convection', icon: '🔄', label: 'Thermal Convection',
    desc: 'Buoyancy-driven coupled heat + flow',
    requires: 'Built-in — zero install',
    equation: '∂T/∂t + u·∇T = κ∇²T',
    params: [
      { key: 'conductivity', label: 'Conductivity κ', min: 0.1, max: 5, step: 0.1, default: 0.5 },
    ],
  },
  {
    id: 'numpy_phase_separation', icon: '🔮', label: 'Phase Separation',
    desc: 'Cahn-Hilliard spinodal decomposition — two-phase patterns',
    requires: 'Built-in — zero install',
    equation: '∂c/∂t = ∇·(M∇μ)',
    params: [
      { key: 'kappa', label: 'κ (interface)', min: 0.0001, max: 0.01, step: 0.0001, default: 0.001 },
      { key: 'M',     label: 'Mobility M',   min: 0.1,    max: 5,    step: 0.1,    default: 1.0  },
      { key: 'steps', label: 'Steps',        min: 50,     max: 500,  step: 50,     default: 200  },
    ],
  },
  {
    id: 'numpy_electric_potential', icon: '⚡', label: 'Electric Potential',
    desc: 'Electrostatic potential from information-field charge density',
    requires: 'Built-in — zero install',
    equation: '∇²φ = −ρ/ε',
    params: [],
  },
  {
    id: 'numpy_entropy_dynamics', icon: '🔥', label: 'Entropy Production',
    desc: 'Irreversible entropy generation from energy gradients',
    requires: 'Built-in — zero install',
    equation: '∂S/∂t = σ_irr + D_S∇²S',
    params: [],
  },
  {
    id: 'numpy_molecular_dynamics', icon: '🧬', label: 'Molecular Dynamics',
    desc: 'Langevin particle simulation aggregated to voxel density',
    requires: 'Built-in — zero install',
    equation: 'mẍ = F_LJ − γẋ + √(2γkT)η',
    params: [
      { key: 'n_molecules',  label: 'Molecules',   min: 50,  max: 800, step: 50,  default: 300  },
      { key: 'temperature_K',label: 'Temp (K)',     min: 50,  max: 1000,step: 10,  default: 300  },
      { key: 'steps',        label: 'MD steps',    min: 500, max: 8000,step: 500, default: 2000 },
    ],
  },
  {
    id: 'fenics_heat_diffusion', icon: '🎯', label: 'Heat Diffusion (FEM)',
    desc: 'High-accuracy FEniCSx finite-element heat equation',
    requires: 'FEniCSx (fallback: NumPy)',
    equation: '−∇·(k∇T) = f  via FEM',
    params: [
      { key: 'conductivity', label: 'Conductivity k', min: 0.1, max: 10, step: 0.1, default: 1.0 },
    ],
  },
  {
    id: 'moose_phase_separation', icon: '💎', label: 'Phase Separation (MOOSE)',
    desc: 'Materials-science Cahn-Hilliard via MOOSE framework',
    requires: 'MOOSE (fallback: NumPy)',
    equation: '∂c/∂t = ∇·(M∇μ)  via MOOSE',
    params: [
      { key: 'kappa', label: 'κ (interface)', min: 0.0001, max: 0.01, step: 0.0001, default: 0.001 },
      { key: 'steps', label: 'Steps',        min: 20,     max: 200,  step: 10,     default: 50   },
    ],
  },
  {
    id: 'elmer_coupled_heat_flow', icon: '🌊', label: 'Coupled Heat+Flow (Elmer)',
    desc: 'Elmer multiphysics: Boussinesq buoyancy convection',
    requires: 'Elmer (fallback: NumPy)',
    equation: 'Navier-Stokes + Heat via Elmer FEM',
    params: [
      { key: 'viscosity',    label: 'Viscosity μ', min: 0.0001, max: 0.1, step: 0.0001, default: 0.001 },
      { key: 'conductivity', label: 'Conductivity', min: 0.1,   max: 5,   step: 0.1,    default: 0.5   },
    ],
  },
  {
    id: 'elmer_magnetostatics', icon: '🧲', label: 'Magnetostatics (Elmer)',
    desc: 'Magnetic field from current density (uses info field)',
    requires: 'Elmer (fallback: NumPy Biot-Savart)',
    equation: '∇²A = −μ₀J,  B = ∇×A',
    params: [],
  },
  {
    id: 'gromacs_water_md', icon: '💦', label: 'Water Box MD (GROMACS)',
    desc: 'All-atom water MD aggregated to density/temperature fields',
    requires: 'GROMACS (fallback: Langevin)',
    equation: 'All-atom MD with PME electrostatics',
    params: [
      { key: 'n_molecules',   label: 'Water molecules', min: 100, max: 1000, step: 50, default: 500 },
      { key: 'temperature_K', label: 'Temp (K)',         min: 250, max: 500,  step: 10, default: 300 },
      { key: 'steps',         label: 'MD steps',         min: 1000,max: 20000,step:1000,default: 5000},
    ],
  },
  {
    id: 'gromacs_protein_coarse', icon: '🦠', label: 'Protein CG Dynamics',
    desc: 'Coarse-grained bead-spring protein → bio/info patterns',
    requires: 'GROMACS (fallback: NumPy)',
    equation: 'CG bead-spring Langevin',
    params: [
      { key: 'n_molecules',   label: 'Residues (beads)', min: 30,  max: 300,  step: 10, default: 100 },
      { key: 'temperature_K', label: 'Temp (K)',          min: 250, max: 400,  step: 10, default: 310 },
      { key: 'steps',         label: 'Steps',             min: 500, max: 10000,step:500, default: 3000},
    ],
  },
]


export function buildSolverPanel(status: 'checking' | 'online' | 'offline'): string {
  const dotColor = status === 'online' ? 'var(--ok)' : status === 'offline' ? 'var(--err)' : 'var(--warn)'
  const dotLabel = status === 'online' ? '● online' : status === 'offline' ? '○ offline' : '◌ checking'

  const CATEGORIES = [
    { label: '⚡ Built-in (zero install)',  filter: (s: SimDef) => s.requires.includes('Built-in') },
    { label: '🎓 FEniCSx FEM',              filter: (s: SimDef) => s.requires.includes('FEniCSx') },
    { label: '🔬 Materials (MOOSE)',         filter: (s: SimDef) => s.requires.includes('MOOSE')   },
    { label: '🌊 Multiphysics (Elmer)',      filter: (s: SimDef) => s.requires.includes('Elmer')   },
    { label: '🧬 Molecular (GROMACS)',       filter: (s: SimDef) => s.requires.includes('GROMACS') },
  ]

  const optGroups = CATEGORIES.map(cat => {
    const sims = SIMULATION_CATALOG.filter(cat.filter)
    if (!sims.length) return ''
    return `<optgroup label="${cat.label}">${sims.map(s =>
      `<option value="${s.id}">${s.icon} ${s.label}</option>`
    ).join('')}</optgroup>`
  }).join('')

  return `
<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)">
    <span>Scientific Solvers</span>
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:9px;color:${dotColor};font-family:monospace">${dotLabel}</span>
      <span class="sarr">▾</span>
    </div>
  </div>
  <div class="secbody">

    ${status === 'offline' ? `
    <div style="background:#1a0808;border:1px solid var(--err);border-radius:6px;padding:8px;
      margin-bottom:8px;font-size:9px;color:#e06060;line-height:1.8">
      <b>Microservice not running.</b> Start it:<br>
      <code style="display:block;background:#0a0a10;padding:4px 6px;border-radius:4px;
        margin-top:4px;color:#a09af0;font-size:8px;line-height:1.7">
        cd solver<br>
        pip install fastapi uvicorn numpy<br>
        uvicorn reality_solver_api:app --port 8765
      </code>
      <div style="margin-top:4px;color:#888">Built-in NumPy solvers still work offline.</div>
    </div>` : ''}

    <div style="font-size:9px;color:var(--sub);margin-bottom:7px">
      Select a simulation — every solver has a fast NumPy fallback.
    </div>

    <select id="sciSolverSel" style="width:100%;font-size:9px;background:#0e0e18;
      color:var(--text);border:1px solid var(--bd);border-radius:5px;padding:3px 5px;
      margin-bottom:6px" onchange="onSciSolverSelect(this.value)">
      <option value="">— Choose simulation —</option>
      ${optGroups}
    </select>

    <div id="sciSolverDesc"
      style="font-size:9px;color:var(--sub);min-height:28px;margin-bottom:4px;
        font-style:italic;line-height:1.5"></div>

    <div id="sciSolverEq"
      style="font-size:10px;font-family:monospace;color:#9090e0;
        margin-bottom:6px;min-height:16px;letter-spacing:.02em"></div>

    <div id="sciSolverParams"
      style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px"></div>

    <div style="display:flex;gap:4px;margin-bottom:5px">
      <button id="btnSciRun" onclick="runSciSolver()"
        style="flex:1;padding:5px;border:1px solid var(--ok);border-radius:5px;
          cursor:pointer;background:#0a1a0e;color:var(--ok);font-size:10px;font-weight:500">
        ▶ Run Simulation
      </button>
      <button id="btnSciLive" onclick="toggleSciLive()"
        style="padding:5px 8px;border:1px solid var(--bd);border-radius:5px;
          cursor:pointer;background:transparent;color:var(--sub);font-size:9px"
        title="Re-run automatically every 3 s while playing">
        ↻ Live
      </button>
    </div>

    <div id="sciSolverStatus"
      style="font-size:9px;font-family:monospace;color:var(--sub);min-height:14px;
        margin-bottom:4px"></div>

    <div id="sciSolverInfo"
      style="display:none;font-size:8px;font-family:monospace;color:#444;
        background:#09090f;padding:5px 6px;border-radius:4px;border:1px solid #1a1a28;
        line-height:1.6;max-height:60px;overflow-y:auto"></div>
  </div>
</div>

<div class="sec sci-sec">
  <div class="sechdr" onclick="toggleSec(this)" style="cursor:pointer">
    <span>Setup Guide</span><span class="sarr" style="transform:rotate(-90deg)">▾</span>
  </div>
  <div class="secbody" style="display:none;font-size:9px;color:var(--sub);line-height:1.9">
    <b style="color:var(--tx)">Minimal (zero install):</b><br>
    All built-in solvers work with no extra packages.<br><br>
    <b style="color:var(--tx)">Microservice (recommended):</b><br>
    <code style="color:#a09af0;font-size:8px">cd solver</code><br>
    <code style="color:#a09af0;font-size:8px">pip install fastapi uvicorn numpy</code><br>
    <code style="color:#a09af0;font-size:8px">uvicorn reality_solver_api:app --port 8765</code><br><br>
    <b style="color:var(--tx)">FEniCSx (FEM accuracy):</b><br>
    <code style="color:#a09af0;font-size:8px">conda install -c conda-forge fenics-dolfinx</code><br><br>
    <b style="color:var(--tx)">Elmer (multiphysics):</b><br>
    <code style="color:#a09af0;font-size:8px">sudo apt install elmer</code><br><br>
    <b style="color:var(--tx)">MOOSE (materials):</b><br>
    <code style="color:#a09af0;font-size:8px">conda install -c conda-forge moose</code><br><br>
    <b style="color:var(--tx)">GROMACS (molecular):</b><br>
    <code style="color:#a09af0;font-size:8px">sudo apt install gromacs</code><br><br>
    <b style="color:var(--tx)">Docker (everything):</b><br>
    <code style="color:#a09af0;font-size:8px">docker-compose -f solver/docker/docker-compose.yml up</code>
  </div>
</div>
`
}
