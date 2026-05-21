/**
 * Node-based Law Editor — canvas drag-and-drop graph.
 *
 * Node types:
 *   SOURCE    — field tap (reads E/D/I/S/T/B from world)
 *   PROCESS   — physics op (diffuse, react-diff, advect)
 *   LAW       — MetaLaw with evolving fitness
 *   TRANSFORM — math op (scale, clamp, threshold, mix, multiply)
 *   OUTPUT    — target param (writes DIFF/ENT/INFO/BIO)
 *   MONITOR   — live sparkline display
 *
 * Compile: walk graph from outputs → build CompiledPipeline → execute each tick.
 */

export type NodeType = 'source' | 'process' | 'law' | 'transform' | 'output' | 'monitor'

export interface NodePort {
  id: string; label: string; type: 'in' | 'out'; dataType: 'field' | 'scalar'
}

export interface LawNode {
  id:     string
  type:   NodeType
  x:      number; y: number
  w:      number; h: number
  label:  string
  color:  string
  active: boolean
  ports:  NodePort[]
  params: Record<string, number | string | boolean>
  lastValue?: number
  sparkline?: number[]
}

export interface NodeEdge {
  id: string; from: string; fromPort: string; to: string; toPort: string
}

export type TransformFn = (v: number) => number

export interface PipelineStep {
  target: string; sourceNode: LawNode; sourcePort: string; transform: TransformFn
}

export interface CompiledPipeline {
  steps: PipelineStep[]; nodes: LawNode[]; edges: NodeEdge[]
}

// ── Templates ─────────────────────────────────────────────────────────────────

type TemplateEntry = Partial<Omit<LawNode, 'id' | 'x' | 'y' | 'w' | 'h'>>

const TEMPLATES: Record<NodeType, TemplateEntry[]> = {
  source: [
    { label: 'Energy Field',  color: '#6080ff', params: { field: 0 },
      ports: [{ id: 'out', label: 'E', type: 'out', dataType: 'field' }] },
    { label: 'Info Field',    color: '#a060e0', params: { field: 2 },
      ports: [{ id: 'out', label: 'I', type: 'out', dataType: 'field' }] },
    { label: 'Bio Field',     color: '#30a060', params: { field: 10 },
      ports: [{ id: 'out', label: 'B', type: 'out', dataType: 'field' }] },
    { label: 'Entropy Field', color: '#e04040', params: { field: 3 },
      ports: [{ id: 'out', label: 'S', type: 'out', dataType: 'field' }] },
  ],
  process: [
    { label: 'Diffuse',    color: '#5060a0', params: { rate: 0.09 },
      ports: [{ id: 'in',  label: 'field', type: 'in',  dataType: 'field' },
              { id: 'out', label: 'out',   type: 'out', dataType: 'field' }] },
    { label: 'React-Diff', color: '#8040a0', params: { Du: 0.16, Dv: 0.08, f: 0.035, k: 0.065 },
      ports: [{ id: 'u',    label: 'u',  type: 'in',  dataType: 'field' },
              { id: 'v',    label: 'v',  type: 'in',  dataType: 'field' },
              { id: 'uout', label: "u'", type: 'out', dataType: 'field' },
              { id: 'vout', label: "v'", type: 'out', dataType: 'field' }] },
  ],
  law: [
    { label: 'Energy Law',  color: '#6080ff', params: { strength: 0.09, fitness: 0.8 },
      ports: [{ id: 'fit', label: 'fitness', type: 'in',  dataType: 'scalar' },
              { id: 'out', label: 'DIFF',    type: 'out', dataType: 'scalar' }] },
    { label: 'Entropy Law', color: '#e04040', params: { strength: 0.0004, fitness: 0.75 },
      ports: [{ id: 'fit', label: 'fitness', type: 'in',  dataType: 'scalar' },
              { id: 'out', label: 'ENT',     type: 'out', dataType: 'scalar' }] },
    { label: 'Bio Law',     color: '#30a060', params: { strength: 0.25,   fitness: 0.7 },
      ports: [{ id: 'fit', label: 'fitness', type: 'in',  dataType: 'scalar' },
              { id: 'out', label: 'BIO',     type: 'out', dataType: 'scalar' }] },
  ],
  transform: [
    { label: 'Scale',     color: '#806040', params: { factor: 1.0 },
      ports: [{ id: 'in', label: 'in', type: 'in', dataType: 'scalar' },
              { id: 'out', label: 'out', type: 'out', dataType: 'scalar' }] },
    { label: 'Clamp',     color: '#806040', params: { min: 0, max: 1 },
      ports: [{ id: 'in', label: 'in', type: 'in', dataType: 'scalar' },
              { id: 'out', label: 'out', type: 'out', dataType: 'scalar' }] },
    { label: 'Threshold', color: '#806040', params: { threshold: 0.5, above: 1, below: 0 },
      ports: [{ id: 'in', label: 'in', type: 'in', dataType: 'scalar' },
              { id: 'out', label: 'out', type: 'out', dataType: 'scalar' }] },
    { label: 'Mix',       color: '#806040', params: { blend: 0.5 },
      ports: [{ id: 'a', label: 'a', type: 'in', dataType: 'scalar' },
              { id: 'b', label: 'b', type: 'in', dataType: 'scalar' },
              { id: 'out', label: 'out', type: 'out', dataType: 'scalar' }] },
  ],
  output: [
    { label: '→ DIFF', color: '#40c060', params: { target: 'DIFF' },
      ports: [{ id: 'in', label: 'value', type: 'in', dataType: 'scalar' }] },
    { label: '→ ENT',  color: '#e04040', params: { target: 'ENT' },
      ports: [{ id: 'in', label: 'value', type: 'in', dataType: 'scalar' }] },
    { label: '→ INFO', color: '#a060e0', params: { target: 'INFO' },
      ports: [{ id: 'in', label: 'value', type: 'in', dataType: 'scalar' }] },
    { label: '→ BIO',  color: '#30a060', params: { target: 'BIO' },
      ports: [{ id: 'in', label: 'value', type: 'in', dataType: 'scalar' }] },
  ],
  monitor: [
    { label: 'Monitor', color: '#608080', params: {},
      ports: [{ id: 'in', label: 'value', type: 'in', dataType: 'scalar' }] },
  ],
}

let _nodeId = 0

function makeNode(type: NodeType, tmplIdx: number, x: number, y: number): LawNode {
  const tmpl = TEMPLATES[type]?.[tmplIdx] ?? TEMPLATES[type]?.[0] ?? {}
  const id = `n${++_nodeId}`
  return {
    id, type, x, y,
    w: type === 'source' ? 110 : type === 'monitor' ? 120 : 130,
    h: 44 + ((tmpl.ports?.length ?? 0) * 14),
    label:  tmpl.label  ?? type,
    color:  tmpl.color  ?? '#555',
    active: true,
    ports: (tmpl.ports ?? []).map(p => ({ ...p, id: `${id}_${p.id}` })),
    params: { ...(tmpl.params ?? {}) },
    sparkline: [],
  }
}

// ── Editor class ──────────────────────────────────────────────────────────────

export class NodeLawEditor {
  nodes: LawNode[] = []
  edges: NodeEdge[] = []
  canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  selected:   LawNode | null = null
  dragging:   { node: LawNode; ox: number; oy: number } | null = null
  connecting: { fromNode: LawNode; fromPort: string; x: number; y: number } | null = null

  onCompile: ((pipeline: CompiledPipeline) => void) | null = null
  onSelect:  ((node: LawNode | null) => void) | null = null

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx    = canvas.getContext('2d')!
    this._loadDefaultGraph()
    this._bindEvents()
    this.draw()
  }

  private _loadDefaultGraph() {
    const src = makeNode('source', 0, 40, 60)
    const law = makeNode('law',    0, 200, 60)
    const mon = makeNode('monitor',0, 200, 160)
    const out = makeNode('output', 0, 370, 60)
    this.nodes = [src, law, mon, out]
    this.edges = [
      { id: 'e1', from: src.id, fromPort: src.ports[0].id, to: law.id, toPort: law.ports[0].id },
      { id: 'e2', from: law.id, fromPort: law.ports[1].id, to: out.id, toPort: out.ports[0].id },
      { id: 'e3', from: law.id, fromPort: law.ports[1].id, to: mon.id, toPort: mon.ports[0].id },
    ]
  }

  addNode(type: NodeType, tmplIdx = 0) {
    const x = 60 + Math.random() * 300
    const y = 40 + Math.random() * 200
    this.nodes.push(makeNode(type, tmplIdx, x, y))
    this.draw()
  }

  removeSelected() {
    if (!this.selected) return
    const id = this.selected.id
    this.nodes = this.nodes.filter(n => n.id !== id)
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id)
    this.selected = null
    this.draw()
  }

  compile(): CompiledPipeline {
    const outputs = this.nodes.filter(n => n.type === 'output')
    const steps: PipelineStep[] = []
    for (const out of outputs) {
      const inEdge = this.edges.find(e => e.to === out.id)
      if (!inEdge) continue
      const srcNode = this.nodes.find(n => n.id === inEdge.from)
      if (!srcNode) continue
      steps.push({
        target:     String(out.params.target ?? 'DIFF'),
        sourceNode: srcNode,
        sourcePort: inEdge.fromPort,
        transform:  this._buildTransform(srcNode),
      })
    }
    return { steps, nodes: this.nodes, edges: this.edges }
  }

  private _buildTransform(node: LawNode): TransformFn {
    if (node.type === 'law') {
      const str = Number(node.params.strength ?? 0.09)
      const fit = Number(node.params.fitness  ?? 0.5)
      return () => str * Math.max(0.1, fit) * 10
    }
    if (node.type === 'transform') {
      const { label, params } = node
      if (label === 'Scale')     return (v) => v * Number(params.factor ?? 1)
      if (label === 'Clamp')     return (v) => Math.max(Number(params.min ?? 0), Math.min(Number(params.max ?? 1), v))
      if (label === 'Threshold') return (v) => v >= Number(params.threshold ?? 0.5) ? Number(params.above ?? 1) : Number(params.below ?? 0)
    }
    return (v) => v
  }

  applyPipeline(
    pipeline: CompiledPipeline,
    simParams: { DIFF: number; ENT: number; INFO: number; BIO: number },
  ) {
    for (const step of pipeline.steps) {
      const value = step.transform(0)
      ;(simParams as Record<string, number>)[step.target] = Math.max(0.00001, value)
    }
    this.onCompile?.(pipeline)
  }

  tick(stats: { energy: number; entropy: number; info: number; bio: number }) {
    for (const node of this.nodes) {
      if (node.type !== 'monitor') continue
      const inEdge = this.edges.find(e => e.to === node.id)
      if (!inEdge) continue
      const src = this.nodes.find(n => n.id === inEdge.from)
      let v = 0
      if (src?.type === 'source') {
        const f = Number(src.params.field ?? 0)
        v = [stats.energy, 0, stats.info, stats.entropy, 0, stats.bio][f] ?? 0
      } else if (src?.type === 'law') {
        v = Number(src.params.fitness ?? 0)
      }
      node.lastValue  = v
      node.sparkline  = node.sparkline ?? []
      node.sparkline.push(v)
      if (node.sparkline.length > 30) node.sparkline.shift()
    }
    this.draw()
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  draw() {
    if (!this.canvas || !this.ctx) return
    const ctx = this.ctx
    const w = this.canvas.width  = this.canvas.offsetWidth  || 520
    const h = this.canvas.height = this.canvas.offsetHeight || 280

    ctx.fillStyle = '#07070e'; ctx.fillRect(0, 0, w, h)

    ctx.strokeStyle = '#0d0d18'; ctx.lineWidth = 0.5
    for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
    for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

    for (const edge of this.edges) this._drawEdge(edge)
    if (this.connecting) this._drawConnecting()
    for (const node of this.nodes) this._drawNode(node)
  }

  private _drawEdge(edge: NodeEdge) {
    const ctx = this.ctx!
    const fromNode = this.nodes.find(n => n.id === edge.from)
    const toNode   = this.nodes.find(n => n.id === edge.to)
    if (!fromNode || !toNode) return
    const [x1, y1] = this._portPos(fromNode, edge.fromPort)
    const [x2, y2] = this._portPos(toNode,   edge.toPort)
    const dx = Math.abs(x2 - x1) * 0.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2)
    const fromPort = fromNode.ports.find(p => p.id === edge.fromPort)
    ctx.strokeStyle = fromPort?.dataType === 'field' ? 'rgba(100,150,255,0.5)' : 'rgba(180,180,100,0.5)'
    ctx.lineWidth = 1.5; ctx.stroke()

    // animated flow dot
    const t = (Date.now() * 0.001) % 1
    const bx = this._bezierPt(x1, x1 + dx, x2 - dx, x2, t)
    const by = this._bezierPt(y1, y1,       y2,       y2, t)
    ctx.beginPath(); ctx.arc(bx, by, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(200,200,255,0.8)'; ctx.fill()
  }

  private _drawConnecting() {
    const ctx = this.ctx!
    const { fromNode, fromPort, x, y } = this.connecting!
    const [x1, y1] = this._portPos(fromNode, fromPort)
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(255,255,100,0.6)'; ctx.lineWidth = 1.5
    ctx.setLineDash([4, 4])
    ctx.moveTo(x1, y1); ctx.lineTo(x, y); ctx.stroke()
    ctx.setLineDash([])
  }

  private _drawNode(node: LawNode) {
    const ctx = this.ctx!
    const { x, y, w, h, label, color, active, type } = node
    const sel = node === this.selected

    if (sel) { ctx.shadowColor = color; ctx.shadowBlur = 12 }

    ctx.beginPath(); ctx.roundRect(x, y, w, h, 6)
    ctx.fillStyle   = sel ? color + '25' : '#111120'; ctx.fill()
    ctx.strokeStyle = active ? color : '#333'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke()
    ctx.shadowBlur  = 0

    ctx.beginPath()
    // @ts-ignore — roundRect corners object
    ctx.roundRect(x, y, w, 18, { upperLeft: 6, upperRight: 6, lowerLeft: 0, lowerRight: 0 })
    ctx.fillStyle = active ? color + '55' : '#1a1a28'; ctx.fill()

    ctx.fillStyle = active ? '#ddd' : '#555'; ctx.font = 'bold 9px system-ui'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, x + w / 2, y + 9)

    ctx.fillStyle = active ? color + 'aa' : '#333'; ctx.font = '7px system-ui'
    ctx.textAlign = 'left'; ctx.fillText(type, x + 4, y + 9)

    // fitness bar for law/source nodes
    if (type === 'law' || type === 'source') {
      const fit = Number(node.params.fitness ?? 0.5)
      ctx.fillStyle = '#1a1a28'; ctx.fillRect(x + 4, y + h - 8, w - 8, 4)
      ctx.fillStyle = active ? color : '#333'; ctx.fillRect(x + 4, y + h - 8, (w - 8) * fit, 4)
    }

    // sparkline for monitor nodes
    if (type === 'monitor' && node.sparkline && node.sparkline.length > 2) {
      const sl = node.sparkline
      const mx = Math.max(...sl, 0.001)
      const sx = x + 4, sw = w - 8, sh = 20, sy = y + 20
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2
      sl.forEach((v, i) => {
        const px = sx + i / (sl.length - 1) * sw, py = sy + sh - (v / mx) * sh
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      })
      ctx.stroke()
      if (node.lastValue !== undefined) {
        ctx.fillStyle = '#888'; ctx.font = '8px monospace'; ctx.textAlign = 'center'
        ctx.fillText(node.lastValue.toFixed(3), x + w / 2, y + h - 14)
      }
    }

    // first param display
    const pkeys = Object.keys(node.params)
    if (pkeys.length && type !== 'output') {
      const k = pkeys[0], v = node.params[k]
      ctx.fillStyle = '#555'; ctx.font = '8px monospace'; ctx.textAlign = 'center'
      ctx.fillText(`${k}:${typeof v === 'number' ? (v as number).toFixed(3) : v}`, x + w / 2, y + 28)
    }

    // ports
    node.ports.forEach(port => {
      const [px, py] = this._portPos(node, port.id)
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2)
      ctx.fillStyle   = port.dataType === 'field' ? '#5070c0' : '#a09040'; ctx.fill()
      ctx.strokeStyle = active ? color : '#333'; ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle  = '#666'; ctx.font = '7px system-ui'
      ctx.textAlign  = port.type === 'in' ? 'left' : 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(port.label, port.type === 'in' ? px + 8 : px - 8, py)
    })
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────

  private _portPos(node: LawNode, portId: string): [number, number] {
    const port = node.ports.find(p => p.id === portId)
    if (!port) return [node.x, node.y]
    const sameSide = node.ports.filter(p => p.type === port.type)
    const idx = sameSide.indexOf(port)
    const total = sameSide.length
    const y = node.y + 22 + (idx + 1) * (node.h - 22) / (total + 1)
    const x = port.type === 'in' ? node.x : node.x + node.w
    return [x, y]
  }

  private _bezierPt(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const u = 1 - t
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  }

  private _hitEdge(x: number, y: number, tol = 8): NodeEdge | null {
    for (const edge of this.edges) {
      const fn = this.nodes.find(n => n.id === edge.from)
      const tn = this.nodes.find(n => n.id === edge.to)
      if (!fn || !tn) continue
      const [x1, y1] = this._portPos(fn, edge.fromPort)
      const [x2, y2] = this._portPos(tn, edge.toPort)
      const dx = Math.abs(x2 - x1) * 0.5
      for (let t = 0; t <= 1; t += 0.04) {
        const bx = this._bezierPt(x1, x1 + dx, x2 - dx, x2, t)
        const by = this._bezierPt(y1, y1,       y2,       y2, t)
        if (Math.hypot(x - bx, y - by) < tol) return edge
      }
    }
    return null
  }

  private _hitNode(x: number, y: number): LawNode | null {
    return this.nodes.find(n => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) ?? null
  }

  private _hitPort(x: number, y: number): { node: LawNode; port: NodePort } | null {
    for (const node of this.nodes) {
      for (const port of node.ports) {
        const [px, py] = this._portPos(node, port.id)
        if (Math.hypot(x - px, y - py) < 8) return { node, port }
      }
    }
    return null
  }

  private _pos(e: MouseEvent): [number, number] {
    const r = this.canvas!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  private _bindEvents() {
    const cv = this.canvas!

    cv.addEventListener('pointerdown', e => {
      const [x, y] = this._pos(e)
      const portHit = this._hitPort(x, y)
      if (portHit && portHit.port.type === 'out') {
        this.connecting = { fromNode: portHit.node, fromPort: portHit.port.id, x, y }
        cv.setPointerCapture(e.pointerId); return
      }
      const node = this._hitNode(x, y)
      const prev = this.selected
      this.selected = node
      if (prev !== node) this.onSelect?.(node)
      if (node) this.dragging = { node, ox: x - node.x, oy: y - node.y }
      cv.setPointerCapture(e.pointerId); this.draw()
    })

    cv.addEventListener('pointermove', e => {
      const [x, y] = this._pos(e)
      if (this.connecting) { this.connecting.x = x; this.connecting.y = y; this.draw(); return }
      if (this.dragging) {
        this.dragging.node.x = Math.max(0, x - this.dragging.ox)
        this.dragging.node.y = Math.max(0, y - this.dragging.oy)
        this.draw()
      }
    })

    cv.addEventListener('pointerup', e => {
      const [x, y] = this._pos(e)
      if (this.connecting) {
        const portHit = this._hitPort(x, y)
        if (portHit && portHit.port.type === 'in' && portHit.node.id !== this.connecting.fromNode.id) {
          this.edges.push({
            id: `e${Date.now()}`,
            from: this.connecting.fromNode.id, fromPort: this.connecting.fromPort,
            to: portHit.node.id,              toPort:   portHit.port.id,
          })
          this.onCompile?.(this.compile())
        }
        this.connecting = null
      }
      this.dragging = null; this.draw()
    })

    // Header area (top 18px) → toggle active. Body → edit first numeric param
    cv.addEventListener('dblclick', e => {
      const [x, y] = this._pos(e)
      const node = this._hitNode(x, y)
      if (!node) return
      if (y <= node.y + 18) {
        node.active = !node.active
        this.draw()
        this.onCompile?.(this.compile())
      } else {
        const numKeys = Object.keys(node.params).filter(k => typeof node.params[k] === 'number')
        if (!numKeys.length) return
        const k   = numKeys[0]
        const raw = prompt(`${node.label} → ${k}`, (node.params[k] as number).toFixed(5))
        if (raw === null) return
        const n = parseFloat(raw)
        if (!isNaN(n)) { node.params[k] = n; this.onSelect?.(node) }
        this.draw()
        this.onCompile?.(this.compile())
      }
    })

    // Right-click on edge → remove it
    cv.addEventListener('contextmenu', e => {
      e.preventDefault()
      const [x, y] = this._pos(e)
      const edge = this._hitEdge(x, y)
      if (edge) {
        this.edges = this.edges.filter(ed => ed.id !== edge.id)
        this.draw()
      }
    })

    // Delete/Backspace → remove selected node; Escape → deselect/cancel
    document.addEventListener('keydown', e => {
      if (!this.canvas) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selected) {
          e.preventDefault()
          this.removeSelected()
          this.onSelect?.(null)
          this.onCompile?.(this.compile())
        }
      }
      if (e.key === 'Escape') {
        this.connecting = null
        this.selected   = null
        this.onSelect?.(null)
        this.draw()
      }
    })
  }

  serialize():  string { return JSON.stringify({ nodes: this.nodes, edges: this.edges }) }
  deserialize(json: string) {
    const d = JSON.parse(json)
    this.nodes = d.nodes ?? []; this.edges = d.edges ?? []
    this.draw()
  }
}
