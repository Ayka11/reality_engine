import type { SyncMessage } from './types';

export class WorkerManager {
  private workers: Worker[] = [];
  private nextId = 1;
  // mapping from chunkKey -> worker index
  private chunkToWorker = new Map<string, number>();

  constructor(private grid: any) { void this.grid; }

  spawnWorkers(count: number) {
    for (let i = 0; i < count; i++) this.spawnWorker();
  }

  spawnWorker() {
    // Create an inline worker that listens for simple messages
    const code = `
      self.onmessage = function(e) {
        const msg = e.data;
        if (msg && msg.type === 'simulate') {
          // pretend to simulate and reply with a tick
          setTimeout(() => {
            self.postMessage({ type: 'tick', worker: msg.workerId, tick: msg.tick });
          }, Math.random() * 100 + 10);
        }
        if (msg && msg.type === 'ping') {
          self.postMessage({ type: 'pong', ts: Date.now(), worker: msg.workerId });
        }
      };
    `;

    const blob = new Blob([code], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    const id = this.nextId++;
    worker.onmessage = (ev) => this.handleWorkerMessage(ev.data, id);
    this.workers.push(worker);
    return worker;
  }

  handleWorkerMessage(msg: SyncMessage | any, workerId: number) {
    // emit to console for now
    try { console.debug('WorkerManager message', workerId, msg); } catch {}
  }

  assignChunkToWorker(chunkKey: string) {
    if (!this.workers.length) return null;
    // simple round-robin assignment
    const idx = Math.abs(this.nextId++) % this.workers.length;
    this.chunkToWorker.set(chunkKey, idx);
    return idx;
  }

  dispatchChunkSimulate(chunkKey: string, payload: any) {
    const idx = this.chunkToWorker.get(chunkKey) ?? 0;
    const worker = this.workers[idx];
    if (!worker) return false;
    worker.postMessage({ type: 'simulate', workerId: idx + 1, tick: Date.now(), chunkKey, payload });
    return true;
  }

  broadcast(msg: any) {
    for (const w of this.workers) w.postMessage(msg);
  }

  terminateAll() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
