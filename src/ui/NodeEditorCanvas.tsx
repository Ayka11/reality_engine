import type { GraphExecutionPlan, RealityEdge, RealityNode } from '../creator';

interface CanvasEditorOptions {
  nodes: RealityNode[];
  edges: RealityEdge[];
  getActiveProcessMask: () => number;
  onSelectNode: (node: RealityNode | null) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onToggleNode: (nodeId: string) => void;
  onCompile: () => GraphExecutionPlan;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

export class NodeEditorCanvas {
  private ctx: CanvasRenderingContext2D;
  private selectedId: string | null = null;
  private connectingFrom: string | null = null;
  private draggingId: string | null = null;
  private dragOffset = { x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, private options: CanvasEditorOptions) {
    this.ctx = canvas.getContext('2d')!;
    this.wireEvents();
  }

  setData(nodes: RealityNode[], edges: RealityEdge[]): void {
    this.options.nodes = nodes;
    this.options.edges = edges;
    this.draw();
  }

  setPlan(plan: GraphExecutionPlan): void {
    if (plan.issues.some(issue => issue.level === 'error')) this.connectingFrom = null;
    this.draw();
  }

  draw(): void {
    const { canvas, ctx } = this;
    const width = canvas.width = canvas.offsetWidth || 640;
    const height = canvas.height = canvas.offsetHeight || 420;
    const pulse = (Math.sin(performance.now() / 260) + 1) / 2;

    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, width, height);
    this.drawGrid(width, height);

    for (const edge of this.options.edges) {
      const source = this.options.nodes.find(node => node.id === edge.source);
      const target = this.options.nodes.find(node => node.id === edge.target);
      if (!source || !target) continue;
      const from = { x: source.position.x + 168, y: source.position.y + 39 };
      const to = { x: target.position.x, y: target.position.y + 39 };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      const mid = from.x + (to.x - from.x) * 0.5;
      ctx.bezierCurveTo(mid, from.y, mid, to.y, to.x, to.y);
      ctx.strokeStyle = source.enabled && target.enabled ? '#3a8f6a' : '#2a2a35';
      ctx.lineWidth = source.enabled && target.enabled ? 2 : 1;
      ctx.stroke();
    }

    const activeProcessMask = this.options.getActiveProcessMask();
    for (const node of this.options.nodes) {
      const active = node.enabled && this.isRuntimeActive(node, activeProcessMask);
      const selected = node.id === this.selectedId;
      const color = node.metadata.color;
      const x = node.position.x;
      const y = node.position.y;
      const w = 168;
      const h = 78;

      ctx.shadowColor = active ? color : 'transparent';
      ctx.shadowBlur = active ? 8 + pulse * 14 : 0;
      ctx.fillStyle = node.enabled ? `${color}18` : '#111118';
      ctx.strokeStyle = selected ? '#e0dff5' : active ? color : '#333344';
      ctx.lineWidth = selected ? 2 : active ? 1.5 : 1;
      roundedRect(ctx, x, y, w, h, 7);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = node.enabled ? color : '#555';
      ctx.font = '10px system-ui';
      ctx.fillText(node.category.toUpperCase(), x + 12, y + 17);

      ctx.fillStyle = node.enabled ? '#eeeef8' : '#666';
      ctx.font = '600 13px system-ui';
      ctx.fillText(node.label.slice(0, 21), x + 12, y + 38);

      const entropy = Number(node.parameters.entropyCost ?? 0);
      const fitness = Number(node.parameters.fitness ?? node.parameters.stabilityImpact ?? 0);
      const throughput = active ? Math.max(1, Math.round((Number(node.metadata.gpuCost ?? 1) + pulse) * 10)) : 0;
      this.badge(x + 12, y + 54, `S ${entropy.toFixed(3)}`, entropy > 0 ? '#f47b7b' : '#4caf7d');
      this.badge(x + 72, y + 54, `F ${fitness.toFixed(2)}`, '#7c9fff');
      this.badge(x + 124, y + 54, `${throughput}/s`, active ? '#22ff88' : '#666');
    }

    if (this.connectingFrom) {
      const node = this.options.nodes.find(candidate => candidate.id === this.connectingFrom);
      if (node) {
        ctx.fillStyle = '#e0dff5';
        ctx.font = '11px system-ui';
        ctx.fillText('click another node to connect', node.position.x, Math.max(12, node.position.y - 8));
      }
    }
  }

  private drawGrid(width: number, height: number): void {
    this.ctx.strokeStyle = '#15151f';
    this.ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 24) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, height);
      this.ctx.stroke();
    }
    for (let y = 0; y < height; y += 24) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(width, y);
      this.ctx.stroke();
    }
  }

  private badge(x: number, y: number, text: string, color: string): void {
    this.ctx.fillStyle = `${color}22`;
    roundedRect(this.ctx, x, y, 46, 15, 4);
    this.ctx.fill();
    this.ctx.fillStyle = color;
    this.ctx.font = '9px Consolas, monospace';
    this.ctx.fillText(text, x + 5, y + 11);
  }

  private isRuntimeActive(node: RealityNode, activeProcessMask: number): boolean {
    const processId = node.parameters.processId;
    if (typeof processId !== 'number') return node.enabled;
    return (activeProcessMask & (1 << processId)) !== 0;
  }

  private wireEvents(): void {
    this.canvas.addEventListener('pointerdown', event => {
      const node = this.nodeAt(event);
      this.selectedId = node?.id ?? null;
      this.options.onSelectNode(node);
      if (!node) {
        this.connectingFrom = null;
        this.draw();
        return;
      }

      if (event.altKey) {
        this.options.onToggleNode(node.id);
        this.draw();
        return;
      }

      if (event.shiftKey) {
        if (this.connectingFrom && this.connectingFrom !== node.id) {
          this.options.onConnect(this.connectingFrom, node.id);
          this.connectingFrom = null;
        } else {
          this.connectingFrom = node.id;
        }
        this.draw();
        return;
      }

      const point = this.canvasPoint(event);
      this.draggingId = node.id;
      this.dragOffset = { x: point.x - node.position.x, y: point.y - node.position.y };
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener('pointermove', event => {
      if (!this.draggingId) return;
      const point = this.canvasPoint(event);
      this.options.onMoveNode(this.draggingId, {
        x: point.x - this.dragOffset.x,
        y: point.y - this.dragOffset.y,
      });
      this.draw();
    });

    this.canvas.addEventListener('pointerup', () => {
      this.draggingId = null;
    });

    this.canvas.addEventListener('dblclick', () => {
      const plan = this.options.onCompile();
      this.setPlan(plan);
    });
  }

  private nodeAt(event: PointerEvent | MouseEvent): RealityNode | null {
    const point = this.canvasPoint(event);
    for (let i = this.options.nodes.length - 1; i >= 0; i--) {
      const node = this.options.nodes[i];
      if (
        point.x >= node.position.x &&
        point.x <= node.position.x + 168 &&
        point.y >= node.position.y &&
        point.y <= node.position.y + 78
      ) return node;
    }
    return null;
  }

  private canvasPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }
}
