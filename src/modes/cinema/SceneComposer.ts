/**
 * SceneComposer — drag-and-drop cinematic scene builder.
 *
 * Think: Blender Scene Collection, but for Reality Engine worlds.
 * Each SceneComponent auto-configures field values + processes.
 * Supports both 2D inline sim and 3D chunk worker.
 */

// Field indices (mirrors ChunkGrid.F)
const F = { E:0,D:1,I:2,S:3,T:4,P:5,FX:6,FY:7,TAU:8,CID:9,BIO:10,MAT:11,WAVE:12,PROC:13 }
const GRID_W = 128, GRID_H = 128

export interface PaintCmd {
  x: number; y: number; z: number
  f: number; v: number
  r?: number
  mode?: 'set' | 'add'
}

export interface SceneComponent {
  id:      string
  name:    string
  icon:    string
  desc:    string
  tags:    string[]
  apply2D: (buf: Float32Array, W: number, H: number, NF: number) => void
  chunkPaints: () => PaintCmd[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function noise2(x: number, y: number, scale = 0.08): number {
  return (Math.sin(x * scale + 1.3) * Math.cos(y * scale * 0.9 + 0.7) + 1) * 0.5
}
function set2(buf: Float32Array, x: number, y: number, W: number, NF: number, fld: number, v: number): void {
  buf[(y * W + x) * NF + fld] = v
}
function get2(buf: Float32Array, x: number, y: number, W: number, NF: number, fld: number): number {
  return buf[(y * W + x) * NF + fld]
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────

const COMPONENTS: SceneComponent[] = [

  // 1. Downtown Core — dense energy towers, high info, neural activity
  {
    id: 'downtown', name: 'Downtown Core', icon: '🏙️', tags: ['urban','energy'],
    desc: 'Dense urban center — towers of energy and information pulses',
    apply2D(buf, W, H, NF) {
      const cx = W / 2, cy = H / 2
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = x - cx, dy = y - cy, r = Math.sqrt(dx*dx + dy*dy)
        if (r > 22) continue
        const n = noise2(x, y, 0.15)
        const density = r < 8 ? 0.95 : r < 14 ? 0.80 : 0.65
        const energy  = r < 8 ? 400 + n * 300 : r < 14 ? 250 + n * 200 : 150 + n * 100
        set2(buf, x, y, W, NF, F.E, energy)
        set2(buf, x, y, W, NF, F.D, density)
        set2(buf, x, y, W, NF, F.I, energy * 0.45)
        set2(buf, x, y, W, NF, F.T, 120 + r * 3)
        set2(buf, x, y, W, NF, F.S, 0.04)
        set2(buf, x, y, W, NF, F.BIO, r < 14 ? 0.08 : 0.05)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const cx = GRID_W/2, cy = GRID_H/2
      // Ground-level dense zone
      for (let z = 0; z < 12; z++) {
        cmds.push({ x:cx, y:cy, z, f:F.E, v:520, r:8 })
        cmds.push({ x:cx, y:cy, z, f:F.D, v:0.92, r:8 })
        cmds.push({ x:cx, y:cy, z, f:F.I, v:280, r:8 })
        cmds.push({ x:cx, y:cy, z, f:F.T, v:180, r:8 })
        cmds.push({ x:cx, y:cy, z, f:F.S, v:0.04, r:8 })
      }
      // Mid-rise zone
      for (let z = 0; z < 8; z++) {
        cmds.push({ x:cx, y:cy, z, f:F.E, v:320, r:16 })
        cmds.push({ x:cx, y:cy, z, f:F.D, v:0.75, r:16 })
        cmds.push({ x:cx, y:cy, z, f:F.I, v:150, r:16 })
        cmds.push({ x:cx, y:cy, z, f:F.T, v:130, r:16 })
      }
      return cmds
    },
  },

  // 2. Park District — lush bio, low entropy, cool temperatures
  {
    id: 'park', name: 'Park District', icon: '🌳', tags: ['nature','bio'],
    desc: 'NW quadrant parks — high bio, low entropy, cool and lush',
    apply2D(buf, W, H, NF) {
      const xMax = Math.floor(W * 0.42), yMax = Math.floor(H * 0.42)
      for (let y = 0; y < yMax; y++) for (let x = 0; x < xMax; x++) {
        const n = noise2(x, y, 0.12)
        set2(buf, x, y, W, NF, F.E,   80 + n * 120)
        set2(buf, x, y, W, NF, F.D,   0.45 + n * 0.35)
        set2(buf, x, y, W, NF, F.I,   50 + n * 80)
        set2(buf, x, y, W, NF, F.T,   45 + n * 35)
        set2(buf, x, y, W, NF, F.S,   0.01 + Math.random() * 0.02)
        set2(buf, x, y, W, NF, F.BIO, 0.65 + n * 0.28)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      for (let z = 0; z < 6; z++) {
        cmds.push({ x:28, y:28, z, f:F.BIO, v:0.78, r:22 })
        cmds.push({ x:28, y:28, z, f:F.E,   v:90,   r:22 })
        cmds.push({ x:28, y:28, z, f:F.D,   v:0.5,  r:22 })
        cmds.push({ x:28, y:28, z, f:F.T,   v:50,   r:22 })
        cmds.push({ x:28, y:28, z, f:F.S,   v:0.01, r:22 })
      }
      return cmds
    },
  },

  // 3. Industrial Zone — max energy, high entropy, metallic density
  {
    id: 'industrial', name: 'Industrial Zone', icon: '🏭', tags: ['urban','energy'],
    desc: 'SE quadrant — high-energy factories, metal density, max entropy',
    apply2D(buf, W, H, NF) {
      const xMin = Math.floor(W * 0.58), yMin = Math.floor(H * 0.58)
      for (let y = yMin; y < H; y++) for (let x = xMin; x < W; x++) {
        const n = noise2(x, y, 0.18)
        set2(buf, x, y, W, NF, F.E, 450 + n * 350)
        set2(buf, x, y, W, NF, F.D, 0.78 + n * 0.18)
        set2(buf, x, y, W, NF, F.I, 60 + n * 60)
        set2(buf, x, y, W, NF, F.T, 300 + n * 400)
        set2(buf, x, y, W, NF, F.S, 0.30 + n * 0.45)
        set2(buf, x, y, W, NF, F.BIO, 0.02)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const ix = GRID_W * 3/4, iy = GRID_H * 3/4
      for (let z = 0; z < 14; z++) {
        const falloff = 1 - z / 16
        cmds.push({ x:ix, y:iy, z, f:F.E, v:650 * falloff, r:18 })
        cmds.push({ x:ix, y:iy, z, f:F.D, v:0.85,          r:18 })
        cmds.push({ x:ix, y:iy, z, f:F.T, v:450 * falloff, r:18 })
        cmds.push({ x:ix, y:iy, z, f:F.S, v:0.55,          r:18 })
      }
      return cmds
    },
  },

  // 4. Road Grid — info corridors every 16 units, moderate density
  {
    id: 'roads', name: 'Road Grid', icon: '🛣️', tags: ['urban','info'],
    desc: 'Information arteries — road corridors with neural flow',
    apply2D(buf, W, H, NF) {
      const SPACING = 16, WIDTH = 2
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const onRoad = (x % SPACING < WIDTH) || (y % SPACING < WIDTH)
        if (!onRoad) continue
        const cur = get2(buf, x, y, W, NF, F.D)
        set2(buf, x, y, W, NF, F.D, Math.max(cur, 0.55))
        set2(buf, x, y, W, NF, F.I, Math.max(get2(buf, x, y, W, NF, F.I), 180))
        set2(buf, x, y, W, NF, F.E, Math.max(get2(buf, x, y, W, NF, F.E), 120))
        set2(buf, x, y, W, NF, F.T, 80)
        set2(buf, x, y, W, NF, F.S, 0.05)
        set2(buf, x, y, W, NF, F.BIO, 0.02)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const SPACING = 16, WIDTH = 2
      for (let coord = 0; coord < GRID_W; coord += SPACING) {
        for (let other = 0; other < GRID_H; other++) {
          for (let dw = 0; dw < WIDTH; dw++) {
            for (let z = 0; z < 3; z++) {
              cmds.push({ x:coord+dw, y:other, z, f:F.I, v:200, mode:'set' })
              cmds.push({ x:coord+dw, y:other, z, f:F.D, v:0.6, mode:'set' })
              cmds.push({ x:other, y:coord+dw, z, f:F.I, v:200, mode:'set' })
              cmds.push({ x:other, y:coord+dw, z, f:F.D, v:0.6, mode:'set' })
            }
          }
        }
      }
      return cmds
    },
  },

  // 5. Ocean Layer — z=0..8, water material, low temp, high density
  {
    id: 'ocean', name: 'Ocean Layer', icon: '🌊', tags: ['nature','water'],
    desc: 'Fills lower z-levels with water — cool, dense, low entropy',
    apply2D(buf, W, H, NF) {
      // Ocean shows as coastal strip — lower strip of the world
      for (let y = Math.floor(H * 0.65); y < H; y++) for (let x = 0; x < W; x++) {
        const depth = (y - H * 0.65) / (H * 0.35)
        const n = noise2(x, y, 0.10)
        set2(buf, x, y, W, NF, F.E, 30 + n * 50)
        set2(buf, x, y, W, NF, F.D, 0.72 + depth * 0.25 + n * 0.05)
        set2(buf, x, y, W, NF, F.I, 15 + n * 20)
        set2(buf, x, y, W, NF, F.T, 18 + depth * 12)
        set2(buf, x, y, W, NF, F.S, 0.01)
        set2(buf, x, y, W, NF, F.BIO, 0.12 + n * 0.10)
        set2(buf, x, y, W, NF, F.WAVE, 0.4 + n * 0.5)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      for (let z = 0; z < 9; z++) {
        const depth = z / 8
        cmds.push({ x:GRID_W/2, y:GRID_H*0.82, z, f:F.D, v:0.80 + depth*0.15, r:48 })
        cmds.push({ x:GRID_W/2, y:GRID_H*0.82, z, f:F.T, v:18 + depth*10,     r:48 })
        cmds.push({ x:GRID_W/2, y:GRID_H*0.82, z, f:F.E, v:35,                r:48 })
        cmds.push({ x:GRID_W/2, y:GRID_H*0.82, z, f:F.S, v:0.01,              r:48 })
        cmds.push({ x:GRID_W/2, y:GRID_H*0.82, z, f:F.BIO, v:0.15,            r:48 })
      }
      return cmds
    },
  },

  // 6. Crystal Ridge — diagonal high-energy crystals, ultra-low entropy
  {
    id: 'crystal', name: 'Crystal Ridge', icon: '💎', tags: ['special','energy'],
    desc: 'Diagonal crystal vein — maximum order, high energy, ice-blue',
    apply2D(buf, W, H, NF) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        // diagonal band: y ≈ x
        const dist = Math.abs(y - x * (H/W)) / (W * 0.08)
        if (dist > 1) continue
        const n = noise2(x, y, 0.22)
        const fade = 1 - dist
        set2(buf, x, y, W, NF, F.E,   650 + n * 200)
        set2(buf, x, y, W, NF, F.D,   (0.3 + n * 0.2) * fade)
        set2(buf, x, y, W, NF, F.I,   500 + n * 100)
        set2(buf, x, y, W, NF, F.T,   30 + n * 40)
        set2(buf, x, y, W, NF, F.S,   0.005 + Math.random() * 0.005)
        set2(buf, x, y, W, NF, F.BIO, 0.01)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const steps = 12
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1)
        const px = Math.floor(GRID_W * t)
        const py = Math.floor(GRID_H * t)
        for (let z = 12; z < 32; z++) {
          cmds.push({ x:px, y:py, z, f:F.E, v:680, r:5 })
          cmds.push({ x:px, y:py, z, f:F.S, v:0.004, r:5 })
          cmds.push({ x:px, y:py, z, f:F.I, v:520, r:5 })
          cmds.push({ x:px, y:py, z, f:F.T, v:25,  r:5 })
          cmds.push({ x:px, y:py, z, f:F.D, v:0.35, r:5 })
        }
      }
      return cmds
    },
  },

  // 7. Life Cluster — random bio blooms, organic energy
  {
    id: 'life', name: 'Life Cluster', icon: '🧬', tags: ['nature','bio'],
    desc: 'Scattered bio-energy blooms — organic life taking root',
    apply2D(buf, W, H, NF) {
      const rng = (s: number) => { s = (s^61)^(s>>16); s *= 9; s ^= s>>4; s *= 0x27d4eb2d; return ((s^(s>>15))>>>0)/4294967296 }
      for (let k = 0; k < 24; k++) {
        const bx = Math.floor(rng(k * 7 + 1) * W)
        const by = Math.floor(rng(k * 7 + 2) * H)
        const br = 6 + Math.floor(rng(k * 7 + 3) * 12)
        const be = 120 + rng(k * 7 + 4) * 280
        for (let y = Math.max(0, by-br); y <= Math.min(H-1, by+br); y++) {
          for (let x = Math.max(0, bx-br); x <= Math.min(W-1, bx+br); x++) {
            const d = Math.sqrt((x-bx)**2 + (y-by)**2)
            if (d > br) continue
            const fade = 1 - d / br
            set2(buf, x, y, W, NF, F.E,   be * fade)
            set2(buf, x, y, W, NF, F.D,   0.35 + fade * 0.30)
            set2(buf, x, y, W, NF, F.I,   be * 0.4 * fade)
            set2(buf, x, y, W, NF, F.T,   50 + fade * 40)
            set2(buf, x, y, W, NF, F.S,   0.015)
            set2(buf, x, y, W, NF, F.BIO, 0.55 + fade * 0.35)
          }
        }
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const seeds = [
        [20,20],[40,80],[80,30],[90,90],[55,110],[110,55],[30,100],[100,30]
      ]
      for (const [bx, by] of seeds) {
        const r = 6 + Math.floor(Math.random() * 8)
        for (let z = 4; z < 18; z++) {
          const zFade = 1 - (z - 4) / 14
          cmds.push({ x:bx, y:by, z, f:F.E,   v:220 * zFade, r })
          cmds.push({ x:bx, y:by, z, f:F.BIO, v:0.70,        r })
          cmds.push({ x:bx, y:by, z, f:F.D,   v:0.50,        r })
          cmds.push({ x:bx, y:by, z, f:F.I,   v:100 * zFade, r })
          cmds.push({ x:bx, y:by, z, f:F.S,   v:0.012,       r })
        }
      }
      return cmds
    },
  },

  // 8. Storm Front — top strip, chaotic high entropy, turbulent
  {
    id: 'storm', name: 'Storm Front', icon: '⛈️', tags: ['special','entropy'],
    desc: 'Turbulent storm band — high entropy, kinetic energy, chaos',
    apply2D(buf, W, H, NF) {
      const yMax = Math.floor(H * 0.20)
      for (let y = 0; y < yMax; y++) for (let x = 0; x < W; x++) {
        const n = noise2(x + y * 3.7, y, 0.20)
        const n2 = noise2(x, y * 2.1, 0.28)
        set2(buf, x, y, W, NF, F.E,   300 + n * 500)
        set2(buf, x, y, W, NF, F.D,   0.40 + n * 0.35)
        set2(buf, x, y, W, NF, F.I,   80 + n2 * 60)
        set2(buf, x, y, W, NF, F.T,   500 + n * 700)
        set2(buf, x, y, W, NF, F.S,   0.60 + n2 * 0.35)
        set2(buf, x, y, W, NF, F.BIO, 0.02)
        set2(buf, x, y, W, NF, F.FX,  (n - 0.5) * 3.5)
        set2(buf, x, y, W, NF, F.FY,  (n2 - 0.5) * 2.8)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      for (let z = 36; z < 64; z++) {
        const altitude = (z - 36) / 28
        cmds.push({ x:GRID_W/2, y:16, z, f:F.E, v:500 + altitude*300, r:56 })
        cmds.push({ x:GRID_W/2, y:16, z, f:F.T, v:800 + altitude*400, r:56 })
        cmds.push({ x:GRID_W/2, y:16, z, f:F.S, v:0.70,               r:56 })
        cmds.push({ x:GRID_W/2, y:16, z, f:F.D, v:0.35,               r:56 })
      }
      return cmds
    },
  },

  // 9. Coastal City — NE: urban density facing water coast to the south
  {
    id: 'coastal', name: 'Coastal City', icon: '🌅', tags: ['urban','water'],
    desc: 'Dense city meets ocean — gradient from urban core to waterfront',
    apply2D(buf, W, H, NF) {
      const coastY = H * 0.62
      for (let y = 0; y < H; y++) for (let x = Math.floor(W * 0.52); x < W; x++) {
        const n = noise2(x, y, 0.11)
        const distCoast = (coastY - y) / coastY  // +1 inland, 0 coast, -1 ocean
        if (y > coastY) {
          // Ocean side
          const depth = (y - coastY) / (H - coastY)
          set2(buf, x, y, W, NF, F.E,   30 + n * 40)
          set2(buf, x, y, W, NF, F.D,   0.70 + depth * 0.25)
          set2(buf, x, y, W, NF, F.T,   18 + depth * 10)
          set2(buf, x, y, W, NF, F.S,   0.01)
          set2(buf, x, y, W, NF, F.BIO, 0.15)
        } else {
          // Urban side
          const urban = distCoast * (0.4 + n * 0.5)
          set2(buf, x, y, W, NF, F.E,   150 + urban * 400)
          set2(buf, x, y, W, NF, F.D,   0.50 + urban * 0.45)
          set2(buf, x, y, W, NF, F.I,   80 + urban * 250)
          set2(buf, x, y, W, NF, F.T,   80 + urban * 150)
          set2(buf, x, y, W, NF, F.S,   0.04 + (1 - distCoast) * 0.12)
          set2(buf, x, y, W, NF, F.BIO, 0.08 + (1 - distCoast) * 0.15)
        }
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const cx = GRID_W * 0.75, cy = GRID_H * 0.4
      // City towers
      for (let z = 0; z < 18; z++) {
        const falloff = Math.pow(1 - z/20, 0.6)
        cmds.push({ x:cx, y:cy, z, f:F.E, v:420 * falloff, r:16 })
        cmds.push({ x:cx, y:cy, z, f:F.D, v:0.80,          r:16 })
        cmds.push({ x:cx, y:cy, z, f:F.I, v:220 * falloff, r:16 })
        cmds.push({ x:cx, y:cy, z, f:F.T, v:160 * falloff, r:16 })
      }
      // Ocean
      for (let z = 0; z < 7; z++) {
        cmds.push({ x:GRID_W*0.75, y:GRID_H*0.80, z, f:F.D, v:0.85, r:40 })
        cmds.push({ x:GRID_W*0.75, y:GRID_H*0.80, z, f:F.T, v:20,   r:40 })
        cmds.push({ x:GRID_W*0.75, y:GRID_H*0.80, z, f:F.E, v:25,   r:40 })
        cmds.push({ x:GRID_W*0.75, y:GRID_H*0.80, z, f:F.S, v:0.01, r:40 })
      }
      return cmds
    },
  },

  // 10. Mountain Ridge — rugged terrain with snow caps at altitude
  {
    id: 'mountain', name: 'Mountain Ridge', icon: '🏔️', tags: ['nature','special'],
    desc: 'Rugged mountain spine — rocky base, icy peaks, mineral veins',
    apply2D(buf, W, H, NF) {
      // Diagonal ridge from top-left to bottom-right, offset
      for (let y = 0; y < H; y++) for (let x = 0; x < Math.floor(W * 0.48); x++) {
        const ridgeLine = H * 0.5 + Math.sin(x * 0.07) * 20 + Math.cos(x * 0.12) * 12
        const dist = Math.abs(y - ridgeLine)
        const n = noise2(x, y, 0.16) + noise2(x * 2.1, y * 2.1, 0.32) * 0.4
        const ridgeStr = Math.max(0, 1 - dist / 24)
        if (ridgeStr < 0.05) continue
        const height = ridgeStr  // 0..1 = base..peak
        // Rocky base
        set2(buf, x, y, W, NF, F.E,   40 + n * 80)
        set2(buf, x, y, W, NF, F.D,   0.70 + n * 0.25 + ridgeStr * 0.05)
        set2(buf, x, y, W, NF, F.I,   20 + n * 30)
        // Snow caps at peak (low temp, very low entropy)
        if (height > 0.75) {
          set2(buf, x, y, W, NF, F.T, 5 + n * 15)
          set2(buf, x, y, W, NF, F.S, 0.002)
          set2(buf, x, y, W, NF, F.E, 500 + n * 150)  // crystal energy for snow
        } else {
          set2(buf, x, y, W, NF, F.T, 30 + (1 - height) * 80 + n * 40)
          set2(buf, x, y, W, NF, F.S, 0.02 + (1 - height) * 0.06)
        }
        set2(buf, x, y, W, NF, F.BIO, height > 0.6 ? 0.01 : 0.15 + n * 0.15)
      }
    },
    chunkPaints() {
      const cmds: PaintCmd[] = []
      const steps = 14
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1)
        const px = Math.floor(GRID_W * 0.15 + t * GRID_W * 0.2)
        const py = Math.floor(GRID_H * 0.5 + Math.sin(t * Math.PI * 1.5) * 16)
        // Rocky base layers
        for (let z = 0; z < 8; z++) {
          cmds.push({ x:px, y:py, z, f:F.D, v:0.88, r:10 })
          cmds.push({ x:px, y:py, z, f:F.E, v:45,   r:10 })
          cmds.push({ x:px, y:py, z, f:F.T, v:30,   r:10 })
          cmds.push({ x:px, y:py, z, f:F.S, v:0.03, r:10 })
        }
        // Mountain peaks (snow = crystal E + low T + low S)
        for (let z = 28; z < 52; z++) {
          const zFade = (z - 28) / 24
          cmds.push({ x:px, y:py, z, f:F.E, v:580 + zFade*80, r:7 })
          cmds.push({ x:px, y:py, z, f:F.D, v:0.4 - zFade*0.15, r:7 })
          cmds.push({ x:px, y:py, z, f:F.T, v:10 - zFade*8,  r:7 })
          cmds.push({ x:px, y:py, z, f:F.S, v:0.003,          r:7 })
        }
      }
      return cmds
    },
  },
]

// ── SceneComposerUI ───────────────────────────────────────────────────────────

export interface ActiveComp {
  comp: SceneComponent
  enabled: boolean
}

export class SceneComposerUI {
  active: ActiveComp[] = []
  private onApply: ((cmds: PaintCmd[]) => void) | null = null

  /** Register callback that receives paint commands on applyAll() */
  setOnApply(fn: (cmds: PaintCmd[]) => void): void { this.onApply = fn }

  addComponent(id: string): void {
    if (this.active.find(a => a.comp.id === id)) return
    const comp = COMPONENTS.find(c => c.id === id)
    if (!comp) return
    this.active.push({ comp, enabled: true })
    this._refreshUI()
  }

  removeComponent(id: string): void {
    this.active = this.active.filter(a => a.comp.id !== id)
    this._refreshUI()
  }

  toggleComp(id: string): void {
    const a = this.active.find(x => x.comp.id === id)
    if (a) { a.enabled = !a.enabled; this._refreshUI() }
  }

  /** Apply all enabled components to the live sim via registered callbacks */
  applyAll(): void {
    const allCmds: PaintCmd[] = []
    for (const { comp, enabled } of this.active) {
      if (enabled) allCmds.push(...comp.chunkPaints())
    }
    this.onApply?.(allCmds)
  }

  /** Apply enabled components to a 2D inline sim buffer in-place */
  apply2DBuf(buf: Float32Array, W: number, H: number, NF: number): void {
    for (const { comp, enabled } of this.active) {
      if (enabled) comp.apply2D(buf, W, H, NF)
    }
  }

  /** Build and return the full panel HTML */
  buildHTML(): string {
    return `
<div class="sec">
  <div class="sechdr" onclick="toggleSec(this)">
    <span>🎬 Scene Composer</span><span class="sarr">▾</span>
  </div>
  <div class="secbody">
    <div style="font-size:9px;color:var(--sub);margin-bottom:5px;line-height:1.5">
      Build cinematic scenes by layering components.
      Each component auto-configures fields &amp; materials.
    </div>

    <!-- Component picker -->
    <select id="scCompPicker" style="width:100%;margin-bottom:4px;font-size:10px"
      onchange="window.addSceneComp&&window.addSceneComp(this.value);this.value=''">
      <option value="">+ Add component...</option>
      ${COMPONENTS.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('\n      ')}
    </select>

    <!-- Active component list -->
    <div id="scActiveList" style="display:flex;flex-direction:column;gap:3px;margin-bottom:6px">
      <div style="font-size:9px;color:var(--sub);font-style:italic">No components added yet.</div>
    </div>

    <!-- Action buttons -->
    <div style="display:flex;gap:4px">
      <button onclick="window.applyScene&&window.applyScene()"
        class="bb" style="flex:1;border-color:var(--ok);color:var(--ok)">▶ Apply All</button>
      <button onclick="window.clearScene&&window.clearScene()"
        class="bb" style="flex:1">🗑️ Clear</button>
    </div>
  </div>
</div>`
  }

  private _refreshUI(): void {
    const el = document.getElementById('scActiveList')
    if (!el) return
    if (this.active.length === 0) {
      el.innerHTML = '<div style="font-size:9px;color:var(--sub);font-style:italic">No components added yet.</div>'
      return
    }
    el.innerHTML = this.active.map(({ comp, enabled }) => `
      <div style="display:flex;align-items:center;gap:4px;padding:3px 5px;
          background:#0c0c18;border-radius:4px;border:1px solid ${enabled ? 'var(--bd)' : '#333'}">
        <span style="font-size:11px">${comp.icon}</span>
        <span style="flex:1;font-size:9px;color:${enabled ? 'var(--tx)' : 'var(--sub)'}">${comp.name}</span>
        <button onclick="window.toggleComp&&window.toggleComp('${comp.id}')"
          style="font-size:8px;padding:1px 4px;background:none;border:1px solid var(--bd);
          border-radius:3px;color:${enabled ? 'var(--ok)' : 'var(--sub)'};cursor:pointer">
          ${enabled ? '✓' : '○'}
        </button>
        <button onclick="window.removeComp&&window.removeComp('${comp.id}')"
          style="font-size:8px;padding:1px 4px;background:none;border:1px solid var(--bd);
          border-radius:3px;color:var(--err);cursor:pointer">×</button>
      </div>`
    ).join('')
  }
}

// Singleton export
export const sceneComposer = new SceneComposerUI()

// Export component registry for external lookup
export { COMPONENTS as SCENE_COMPONENTS }
