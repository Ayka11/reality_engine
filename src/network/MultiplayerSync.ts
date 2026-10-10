import { SimulationEngine } from '../simulation/SimulationEngine';
import { CELL_FIELDS } from '../core/CellState';

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

const ROOM_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;

export class MultiplayerSync {
  private sim: SimulationEngine;
  readonly userId: string;
  private channel: BroadcastChannel;
  private socket: WebSocket | null = null;
  private readonly roomId: string | null;
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

    // Cross-device sync is opt-in: users must share a URL containing the same room token.
    const requestedRoom = new URLSearchParams(window.location.search).get('room') || '';
    this.roomId = ROOM_PATTERN.test(requestedRoom) ? requestedRoom : null;
    if (this.roomId && typeof WebSocket !== 'undefined') {
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = new WebSocket(`${scheme}//${window.location.host}/signal?room=${encodeURIComponent(this.roomId)}`);
      this.socket.addEventListener('open', () => {
        this._sendSocket({ type: 'announce', from: this.userId });
        if (this.connected) {
          this._sendSocket({ type: 'app-message', from: this.userId, payload: { type: 'join', userId: this.userId, color: this._randomColor() } });
          this._sendSocket({ type: 'app-message', from: this.userId, payload: { type: 'request_state', userId: this.userId } });
        }
      });
      this.socket.addEventListener('message', event => {
        let envelope: unknown;
        try { envelope = JSON.parse(String(event.data)); } catch { return; }
        if (!envelope || typeof envelope !== 'object') return;
        const message = envelope as { type?: string; from?: string; payload?: BroadcastMsg };
        if (message.type === 'announce' && typeof message.from === 'string') {
          this._handleMessage({ type: 'join', userId: message.from, color: '#888' });
          return;
        }
        if (message.type !== 'app-message' || !message.payload || typeof message.payload.userId !== 'string') return;
        this._handleMessage(message.payload);
      });
      this.socket.addEventListener('error', () => {
        // Keep same-origin BroadcastChannel collaboration available if network signalling fails.
      });
    }
  }

  connect(): string {
    if (this.connected) return this.userId;
    this.connected = true;
    // Re-announce on connect so the server replays peers that joined before this client.
    this._sendSocket({ type: 'announce', from: this.userId });
    const join: BroadcastMsg = { type: 'join', userId: this.userId, color: this._randomColor() };
    this._send(join);
    this.syncInterval = setInterval(() => this._broadcastDelta(), 500);
    this._send({ type: 'request_state', userId: this.userId });
    return this.userId;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this._send({ type: 'leave', userId: this.userId });
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
    this.pendingDeltas = [];
  }

  moveCursor(x: number, y: number, tool: string): void {
    if (!this.connected) return;
    this._send({ type: 'cursor', userId: this.userId, x, y, tool });
  }

  broadcastPaint(cells: Array<{ x: number; y: number; z: number; field: number; value: number }>): void {
    if (!this.connected) return;
    this._send({ type: 'paint', userId: this.userId, cells: cells.slice(0, 50) });
  }

  queueDelta(x: number, y: number, z: number, field: number, value: number): void {
    if (!this.connected) return;
    this.pendingDeltas.push({ x, y, z, field, value });
  }

  private _broadcastDelta(): void {
    if (!this.connected || !this.pendingDeltas.length) return;
    this._send({ type: 'delta', userId: this.userId, cells: this.pendingDeltas.slice(0, 100) });
    this.pendingDeltas = this.pendingDeltas.slice(100);
  }

  private _send(message: BroadcastMsg): void {
    this.channel.postMessage(message);
    this._sendSocket({ type: 'app-message', from: this.userId, payload: message });
  }

  private _sendSocket(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    try { this.socket.send(JSON.stringify(message)); } catch { /* local channel remains available */ }
  }

  private _listen(): void {
    this.channel.onmessage = ({ data }: MessageEvent<BroadcastMsg>) => this._handleMessage(data);
  }

  private _handleMessage(data: BroadcastMsg): void {
    if (!this.connected) return;
    if (!data || data.userId === this.userId || typeof data.userId !== 'string' || data.userId.length > 64) return;
    if (!['join', 'leave', 'cursor', 'paint', 'delta', 'full_state', 'request_state'].includes(data.type)) return;

    if (data.type === 'join') {
      this.peers.set(data.userId, { color: data.color ?? '#888', lastSeen: Date.now() });
      const wasHost = this.isHost;
      this._refreshHostRole();
      if (this.isHost && !wasHost) setTimeout(() => this._sendFullState(), 200);
    }

    if (data.type === 'leave') {
      this.peers.delete(data.userId);
      this.cursors.delete(data.userId);
      const wasHost = this.isHost;
      this._refreshHostRole();
      if (this.isHost && !wasHost) setTimeout(() => this._sendFullState(), 200);
    }

    if (data.type === 'cursor') {
      this.cursors.set(data.userId, {
        x: data.x ?? 0, y: data.y ?? 0, tool: data.tool ?? '',
        color: this.peers.get(data.userId)?.color ?? '#888',
        ts: Date.now(),
      });
    }

    if (data.type === 'paint' || data.type === 'delta') {
      if (!Array.isArray(data.cells)) return;
      const maxCells = data.type === 'paint' ? 50 : 100;
      if (data.cells.length > maxCells) return;
      const { grid } = this.sim;
      const buf = grid.buffer;
      for (const cell of data.cells) {
        if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !Number.isInteger(cell.z)
          || !Number.isInteger(cell.field) || cell.field < 0 || cell.field >= CELL_FIELDS
          || !Number.isFinite(cell.value) || Math.abs(cell.value) > 1e9
          || !grid.inBounds(cell.x, cell.y, cell.z)) continue;
        buf[grid.idx(cell.x, cell.y, cell.z) + cell.field] = cell.value;
      }
    }

    if (data.type === 'full_state' && !this.isHost && data.userId === [this.userId, ...this.peers.keys()].sort()[0] && Array.isArray(data.buf)) {
      const buf = this.sim.grid.buffer;
      // Check size before allocating a typed-array copy.
      if (data.buf.length !== buf.length || !data.buf.every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) return;
      buf.set(new Float32Array(data.buf));
    }

    if (data.type === 'request_state' && this.isHost) this._sendFullState();
  }

  private _refreshHostRole(): void {
    // Deterministic host election prevents two clients from answering state requests.
    const smallestPeerId = [...this.peers.keys()].sort()[0];
    this.isHost = !smallestPeerId || this.userId < smallestPeerId;
  }

  private _sendFullState(): void {
    this._send({
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
