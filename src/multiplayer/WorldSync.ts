import type { SyncOperation } from './types';

export class WorldSync {
  private socket: WebSocket | null = null;
  constructor(private grid: any, private graph: any, private sculptManager?: any) {
    // reference grid to avoid unused var warning
    if (this.grid && (this.grid.size || this.grid.W)) { /* noop */ }
  }

  connect(worldId: string, userId: string, url = '') {
    // MVP: use BroadcastChannel for same-origin tabs, fallback to no-op WebSocket stub
    if (typeof window !== 'undefined' && (window as any).BroadcastChannel) {
      const chan = new (window as any).BroadcastChannel(`world-${worldId}`);
      chan.onmessage = (ev: any) => this.handleRemoteOperation(ev.data);
      (this as any)._chan = chan;
      return userId;
    }

    if (!url) return userId;
    this.socket = new WebSocket(url);
    this.socket.onmessage = ev => {
      try { const op: SyncOperation = JSON.parse(ev.data); this.handleRemoteOperation(op); } catch (e) { }
    };
    this.socket.onopen = () => this.socket?.send(JSON.stringify({ type: 'join', worldId, userId }));
    return userId;
  }

  broadcast(op: SyncOperation) {
    try {
      const chan = (this as any)._chan;
      if (chan) { chan.postMessage(op); return; }
      if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(op));
    } catch (e) { console.error('WorldSync.broadcast', e); }
  }

  applyOptimistic(op: SyncOperation) {
    switch (op.type) {
      case 'brush_stroke':
        this.sculptManager?.applyStroke?.(op.data);
        break;
      case 'graph_update':
        this.updateGraph(op.data);
        break;
    }
  }

  handleRemoteOperation(op: SyncOperation) {
    // v1: last-writer-wins — apply directly
    this.applyOperation(op);
  }

  applyOperation(op: SyncOperation) {
    if (!op) return;
    switch (op.type) {
      case 'brush_stroke':
        this.sculptManager?.applyStroke?.(op.data);
        break;
      case 'graph_update':
        this.updateGraph(op.data);
        break;
      case 'chunk_update':
        // apply chunk data to grid — left as integration point
        break;
    }
  }

  updateGraph(data: any) {
    try {
      if (data.op === 'add') this.graph.addNode?.(data.node);
      if (data.op === 'update') this.graph.updateNode?.(data.nodeId, data.patch);
      if (data.op === 'remove') this.graph.removeNode?.(data.nodeId);
    } catch (e) { console.error('WorldSync.updateGraph', e); }
  }
}
