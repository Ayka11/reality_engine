import { Timeline } from '../world/Timeline';

export class MetricsPanel {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private timeline: Timeline;
  activeFields: Array<'energy' | 'entropy' | 'agents' | 'bio' | 'info'> = ['energy', 'entropy', 'agents', 'bio'];
  readonly colors = {
    energy:  '#6080ff',
    entropy: '#e04040',
    info:    '#a060e0',
    agents:  '#ef8030',
    bio:     '#30a060',
  };

  constructor(canvasEl: HTMLCanvasElement, timeline: Timeline) {
    this.canvas  = canvasEl;
    this.ctx     = canvasEl.getContext('2d')!;
    this.timeline = timeline;
  }

  draw(): void {
    const c = this.canvas;
    const ctx = this.ctx;
    const w = c.width = c.offsetWidth || 300;
    const h = c.height = 120;
    ctx.fillStyle = '#06060d'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1a1a2a'; ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke();
    }

    for (const field of this.activeFields) {
      const data = this.timeline.getMetricsForChart(field);
      if (data.length < 2) continue;
      const mx = Math.max(...data, 1);
      ctx.beginPath();
      ctx.strokeStyle = this.colors[field] || '#888';
      ctx.lineWidth = 1.5;
      data.forEach((v, i) => {
        const px = (i / (data.length - 1)) * w;
        const py = h - (v / mx) * (h - 4) - 2;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.stroke();
    }

    // Legend
    ctx.font = '9px system-ui'; ctx.textBaseline = 'top';
    this.activeFields.forEach((f, i) => {
      ctx.fillStyle = this.colors[f] || '#888';
      ctx.fillRect(6 + i * 52, 4, 8, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(f, 18 + i * 52, 4);
    });
  }
}
