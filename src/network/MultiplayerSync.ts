import { SimulationEngine } from '../simulation/SimulationEngine';

interface PeerInfo { color: string; lastSeen: number; }
interface CursorInfo { x: number; y: number; tool: string; color: string; ts: number; }

interface BroadcastMsg {
  type: 'join' | 'leave' | 'cursor' | 'paint' | 'delta' | 'full_state' | 'request_state';
  userId: string;
  color?: string;
  x?: number;
  y?: number;
  tool?: string;
  cells?: Array<{ x: number; y: number; z: number; field: number; value: number }>;
  buf?: number[];
}

export class MultiplayerSync {
  private sim: SimulationEngine;
  readonly userId: string;
  private channel: BroadcastChannel;
  readonly peers: Map<string, PeerInfo> = new Map();
  readonly cursors: Map<string, CursorInfo> = new Map();
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  isHost = false;
  connected = false;
  private pendingDeltas: Array<{ x: number; y: number; z: number; field: number; value: number }> = [];

  constructor(sim: SimulationEngine) {
    this.sim = sim;
    this.userId = Math.random().toString(36).slice(2, 8);
    this.channel = new BroadcastChannel('reality_engine_v4');
    this._listen();
  }

  connect(): string {
    this.connected = true;
    this.channel.postMessage({ type: 'join', userId: this.userId, color: this._randomColor() });
    this.syncInterval = setInterval(() => this._broadcastDelta(), 500);
    this.channel.postMessage({ type: 'request_state', userId: this.userId });
    return this.userId;
  }

  disconnect(): void {
    this.connected = false;
    this.channel.postMessage({ type: 'leave', userId: this.userId });
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
  }

  moveCursor(x: number, y: number, tool: string): void {
    if (!this.connected) return;
    this.channel.postMessage({ type: 'cursor', userId: this.userId, x, y, tool });
  }

  broadcastPaint(cells: Array<{ x: number; y: number; z: number; field: number; value: number }>): void {
    if (!this.connected) return;
    this.channel.postMessage({ type: 'paint', userId: this.userId, cells: cells.slice(0, 50) });
  }

  queueDelta(x: number, y: number, z: number, field: number, value: number): void {
    this.pendingDeltas.push({ x, y, z, field, value });
  }

  private _broadcastDelta(): void {
    if (!this.connected || !this.pendingDeltas.length) return;
    this.channel.postMessage({ type: 'delta', userId: this.userId, cells: this.pendingDeltas.slice(0, 100) });
    this.pendingDeltas = [];
  }

  private _listen(): void {
    this.channel.onmessage = ({ data }: MessageEvent<BroadcastMsg>) => {
      if (data.userId === this.userId) return;

      if (data.type === 'join') {
        this.peers.set(data.userId, { color: data.color ?? '#888', lastSeen: Date.now() });
        if (!this.isHost || this.peers.size === 1) {
          this.isHost = true;
          setTimeout(() => this._sendFullState(), 200);
        }
      }

      if (data.type === 'leave') this.peers.delete(data.userId);

      if (data.type === 'cursor') {
        this.cursors.set(data.userId, {
          x: data.x ?? 0, y: data.y ?? 0, tool: data.tool ?? '',
          color: this.peers.get(data.userId)?.color ?? '#888',
          ts: Date.now(),
        });
      }

      if (data.type === 'paint' || data.type === 'delta') {
        const { grid } = this.sim;
        const buf = grid.buffer;
        for (const { x, y, z, field, value } of (data.cells ?? [])) {
          if (!grid.inBounds(x, y, z)) continue;
          buf[grid.idx(x, y, z) + field] = value;
        }
      }

      if (data.type === 'full_state' && !this.isHost && data.buf) {
        const buf = this.sim.grid.buffer;
        const incoming = new Float32Array(data.buf);
        if (incoming.length === buf.length) buf.set(incoming);
      }

      if (data.type === 'request_state' && this.isHost) {
        this._sendFullState();
      }
    };
  }

  private _sendFullState(): void {
    this.channel.postMessage({
      type: 'full_state',
      userId: this.userId,
      buf: Array.from(this.sim.grid.buffer),
    });
  }

  private _randomColor(): string {
    return `hsl(${Math.floor(Math.random() * 360)},70%,60%)`;
  }

  drawCursors(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, W: number, H: number): void {
    const cs = Math.min(canvas.width / W, canvas.height / H);
    const ox = (canvas.width - cs * W) / 2, oy = (canvas.height - cs * H) / 2;
    const now = Date.now();
    for (const [uid, cur] of this.cursors) {
      if (now - cur.ts > 3000) { this.cursors.delete(uid); continue; }
      const px = ox + cur.x * cs, py = oy + cur.y * cs;
      ctx.strokeStyle = cur.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = cur.color; ctx.font = '10px system-ui';
      ctx.fillText(uid, px + 10, py - 4);
    }
  }

  getStats(): { userId: string; peers: number; isHost: boolean; connected: boolean } {
    return { userId: this.userId, peers: this.peers.size, isHost: this.isHost, connected: this.connected };
  }
}
