/**
 * PrefabSystem — capture cell clusters as reusable prefabs, stamp them anywhere.
 */

export interface Prefab {
  id:          string
  name:        string
  description: string
  icon:        string
  thumbnail:   string   // base64 data-url (jpeg)
  cells:       Array<{ dx:number; dy:number; dz:number; fields:number[] }>
  metadata:    { width:number; height:number; depth:number; dominant:string }
}

export class PrefabSystem {
  library: Prefab[] = []

  constructor() {
    this.library = this._defaultPrefabs()
  }

  // ── Capture ───────────────────────────────────────────────────────────

  capture(
    cx: number, cy: number, cz: number,
    radius: number,
    buf: Float32Array,
    W: number, H: number, D: number, NF: number,
    name: string,
    simCanvas: HTMLCanvasElement | null,
  ): Prefab {
    const cells: Prefab['cells'] = []

    for (let dz = -radius; dz <= radius; dz++)
    for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx, ny = cy + dy, nz = cz + dz
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || nz < 0 || nz >= D) continue
      const base = (nz * H * W + ny * W + nx) * NF
      let any = false
      for (let f = 0; f < NF; f++) if (Math.abs(buf[base + f]) > 0.01) { any = true; break }
      if (any) cells.push({ dx, dy, dz, fields: Array.from(buf.subarray(base, base + NF)) })
    }

    let thumbnail = ''
    if (simCanvas) {
      try {
        const tc = document.createElement('canvas')
        tc.width  = 80
        tc.height = 60
        tc.getContext('2d')?.drawImage(simCanvas, 0, 0, 80, 60)
        thumbnail = tc.toDataURL('image/jpeg', 0.5)
      } catch { /* canvas tainted */ }
    }

    const FIELD_NAMES = ['energy','density','info','entropy','temp','pressure','fx','fy','tau','cid','bio','proc']
    const dominant = FIELD_NAMES
      .map((n, i) => ({ n, avg: cells.reduce((s, c) => s + (c.fields[i] ?? 0), 0) / Math.max(1, cells.length) }))
      .sort((a, b) => b.avg - a.avg)[0]?.n ?? 'energy'

    const p: Prefab = {
      id:          `prefab_${Date.now()}`,
      name,
      description: 'Custom prefab',
      icon:        '⬡',
      thumbnail,
      cells,
      metadata:    { width: radius * 2 + 1, height: radius * 2 + 1, depth: radius * 2 + 1, dominant },
    }
    this.library.push(p)
    return p
  }

  // ── Stamp ─────────────────────────────────────────────────────────────

  stamp(
    prefab: Prefab,
    x: number, y: number, z: number,
    buf: Float32Array,
    W: number, H: number, D: number, NF: number,
    mode: 'set' | 'add' = 'set',
  ): void {
    for (const cell of prefab.cells) {
      const nx = x + cell.dx, ny = y + cell.dy, nz = z + cell.dz
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || nz < 0 || nz >= D) continue
      const base = (nz * H * W + ny * W + nx) * NF
      for (let f = 0; f < NF && f < cell.fields.length; f++) {
        buf[base + f] = mode === 'set'
          ? cell.fields[f]
          : Math.max(-9999, Math.min(9999, (buf[base + f] ?? 0) + cell.fields[f]))
      }
    }
  }

  remove(id: string): void {
    this.library = this.library.filter(p => p.id !== id)
  }

  exportLibrary(): string {
    return JSON.stringify({
      format:  'reality_engine_prefabs_v1',
      prefabs: this.library.map(p => ({ ...p, thumbnail: '' })), // strip thumbnails for size
    }, null, 2)
  }

  importLibrary(json: string): void {
    const data = JSON.parse(json)
    this.library.push(...(data.prefabs ?? []))
  }

  // ── Default library ──────────────────────────────────────────────────

  private _defaultPrefabs(): Prefab[] {
    return [
      {
        id: 'pf_lifebloom', name: 'Life Bloom', icon: '🌱',
        description: 'High bio+info cluster',
        thumbnail: '', metadata: { width:5, height:5, depth:3, dominant:'bio' },
        cells: this._circle(2, { 0:250, 1:.4, 2:200, 10:.7, 4:120 }),
      },
      {
        id: 'pf_energysrc', name: 'Energy Source', icon: '⚡',
        description: 'Hot energy core',
        thumbnail: '', metadata: { width:5, height:5, depth:3, dominant:'energy' },
        cells: this._circle(2, { 0:900, 4:400, 1:.6 }),
      },
      {
        id: 'pf_crystal', name: 'Crystal Node', icon: '💎',
        description: 'Low-entropy crystal, high information',
        thumbnail: '', metadata: { width:3, height:3, depth:2, dominant:'info' },
        cells: this._circle(1, { 0:700, 2:280, 3:0.01 }),
      },
    ]
  }

  private _circle(r: number, fieldVals: Record<number, number>): Prefab['cells'] {
    const cells: Prefab['cells'] = []
    for (let dz = -1; dz <= 1; dz++)
    for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (Math.sqrt(dx * dx + dy * dy) > r) continue
      const g      = Math.exp(-(dx * dx + dy * dy) / (r * r) * 2)
      const fields = new Array(14).fill(0)
      for (const [f, v] of Object.entries(fieldVals)) fields[+f] = (v as number) * g
      cells.push({ dx, dy, dz, fields })
    }
    return cells
  }
}
