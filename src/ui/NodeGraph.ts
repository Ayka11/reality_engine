import { SimulationEngine } from '../simulation/SimulationEngine';

interface GraphNode {
  id: string;
  label: string;
  type: 'source' | 'process' | 'output';
  procIds: number[];
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

interface GraphEdge {
  from: string;
  to: string;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export class NodeGraph {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sim: SimulationEngine;
  private nodes: GraphNode[];
  private edges: GraphEdge[];
  private dragging: GraphNode | null = null;
  private dragOX = 0;
  private dragOY = 0;

  constructor(canvas: HTMLCanvasElement, sim: SimulationEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.sim = sim;
    this.nodes = this._buildNodes();
    this.edges = this._buildEdges();
    this._wireEvents();
  }

  private _buildNodes(): GraphNode[] {
    return [
      // Sources
      { id: 'src_energy', label: 'Energy',    type: 'source',  procIds: [], x: 8,  y: 20,  w: 58, h: 22, color: '#ef8f3f' },
      { id: 'src_bio',    label: 'Bio Input', type: 'source',  procIds: [], x: 8,  y: 56,  w: 58, h: 22, color: '#4caf7d' },
      // Processes (procIds = PROC enum values)
      { id: 'proc_thermo',  label: 'Thermo',  type: 'process', procIds: [0, 1, 3, 8],       x: 80,  y: 8,   w: 58, h: 22, color: '#ef8f3f' },
      { id: 'proc_physics', label: 'Physics', type: 'process', procIds: [2, 7, 12, 13, 14], x: 80,  y: 44,  w: 58, h: 22, color: '#c084fc' },
      { id: 'proc_bio',     label: 'Biology', type: 'process', procIds: [5, 9, 10],          x: 80,  y: 80,  w: 58, h: 22, color: '#4caf7d' },
      { id: 'proc_info',    label: 'Info',    type: 'process', procIds: [4, 6],              x: 80,  y: 116, w: 58, h: 22, color: '#7c9fff' },
      { id: 'proc_geo',     label: 'Geology', type: 'process', procIds: [11, 15],            x: 80,  y: 152, w: 58, h: 22, color: '#a0855a' },
      // Outputs
      { id: 'out_entities', label: 'Entities', type: 'output', procIds: [], x: 152, y: 20,  w: 58, h: 22, color: '#4caf7d' },
      { id: 'out_signals',  label: 'Signals',  type: 'output', procIds: [], x: 152, y: 62,  w: 58, h: 22, color: '#7c9fff' },
      { id: 'out_matter',   label: 'Matter',   type: 'output', procIds: [], x: 152, y: 104, w: 58, h: 22, color: '#a0855a' },
    ];
  }

  private _buildEdges(): GraphEdge[] {
    return [
      { from: 'src_energy', to: 'proc_thermo' },
      { from: 'src_energy', to: 'proc_physics' },
      { from: 'src_energy', to: 'proc_info' },
      { from: 'src_bio',    to: 'proc_bio' },
      { from: 'proc_thermo',  to: 'out_entities' },
      { from: 'proc_physics', to: 'out_matter' },
      { from: 'proc_bio',     to: 'out_entities' },
      { from: 'proc_info',    to: 'out_signals' },
      { from: 'proc_geo',     to: 'out_matter' },
    ];
  }

  draw(): void {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const W = canvas.width = canvas.offsetWidth || 220;
    const H = canvas.height;

    // Reflow output nodes to right edge
    const outX = W - 66;
    for (const n of this.nodes) {
      if (n.type === 'output') n.x = outX;
    }

    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);

    const mask = this.sim.laws.activeProcessMask;

    // Draw bezier edges
    for (const edge of this.edges) {
      const a = this.nodes.find(n => n.id === edge.from);
      const b = this.nodes.find(n => n.id === edge.to);
      if (!a || !b) continue;
      const ax = a.x + a.w, ay = a.y + a.h / 2;
      const bx = b.x,       by = b.y + b.h / 2;
      const cpx = ax + (bx - ax) * 0.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(cpx, ay, cpx, by, bx, by);
      ctx.strokeStyle = '#2a2a45';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of this.nodes) {
      const anyOn  = node.procIds.length === 0 || node.procIds.some(id => (mask & (1 << id)) !== 0);
      const allOn  = node.procIds.length > 0   && node.procIds.every(id => (mask & (1 << id)) !== 0);

      ctx.fillStyle   = anyOn ? node.color + '22' : '#111118';
      ctx.strokeStyle = allOn ? node.color : anyOn ? node.color + '66' : '#2a2a35';
      ctx.lineWidth   = allOn ? 1.5 : 1;
      roundRect(ctx, node.x, node.y, node.w, node.h, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle     = anyOn ? node.color : '#444';
      ctx.font          = '9px system-ui';
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'middle';
      ctx.fillText(node.label, node.x + node.w / 2, node.y + node.h / 2 - (node.procIds.length ? 3 : 0));

      if (node.procIds.length > 0) {
        const onCount = node.procIds.filter(id => (mask & (1 << id)) !== 0).length;
        ctx.fillStyle = '#555';
        ctx.font = '7px monospace';
        ctx.fillText(`${onCount}/${node.procIds.length}`, node.x + node.w / 2, node.y + node.h - 4);
      }
    }
  }

  private _wireEvents(): void {
    const canvas = this.canvas;

    canvas.addEventListener('dblclick', (e) => {
      const node = this._nodeAt(e);
      if (!node || node.procIds.length === 0) return;
      const mask  = this.sim.laws.activeProcessMask;
      const allOn = node.procIds.every(id => (mask & (1 << id)) !== 0);
      for (const pid of node.procIds) this.sim.laws.toggleProcess(pid, !allOn);
      this.draw();
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const node = this._nodeAt(e);
      if (!node) return;
      this.dragging = node;
      const { mx, my } = this._canvasXY(e);
      this.dragOX = mx - node.x;
      this.dragOY = my - node.y;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const { mx, my } = this._canvasXY(e);
      this.dragging.x = mx - this.dragOX;
      this.dragging.y = my - this.dragOY;
      this.draw();
    });

    canvas.addEventListener('pointerup', () => { this.dragging = null; });
  }

  private _canvasXY(e: PointerEvent | MouseEvent): { mx: number; my: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      mx: (e.clientX - rect.left) * scaleX,
      my: (e.clientY - rect.top)  * scaleY,
    };
  }

  private _nodeAt(e: PointerEvent | MouseEvent): GraphNode | null {
    const { mx, my } = this._canvasXY(e);
    for (const n of this.nodes) {
      if (mx >= n.x && mx <= n.x + n.w && my >= n.y && my <= n.y + n.h) return n;
    }
    return null;
  }
}
