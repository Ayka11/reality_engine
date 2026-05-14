import { ChunkOrchestrator } from './ChunkOrchestrator';
import { WorkerManager } from './WorkerManager';
import { LoadBalancer } from './LoadBalancer';
import { Partitioner } from './Partitioner';
import { WebRTCManager } from './WebRTCManager';
export class DistributedEngine {
  orchestrator = new ChunkOrchestrator();
  workers: WorkerManager;
  balancer = new LoadBalancer('dynamic');

  constructor(public localGrid: any) {
    this.workers = new WorkerManager(localGrid);
    // register a local "node"
    this.orchestrator.registerNode({ id: 'local', type: 'worker', capacity: 1, activeChunks: [], status: 'healthy' });
    this.partitioner = new Partitioner();
    this.webrtc = new WebRTCManager();
  }

  partitioner: Partitioner;
  webrtc: WebRTCManager;

  async initDistributed(mode: 'local' | 'multi-client' | 'cloud' = 'local') {
    if (mode === 'local') {
      // spawn a few local workers
      this.workers.spawnWorkers(2);
    }
  }

  async tick() {
    const localChunks = this.getLocalOwnedChunks();
    // dispatch simulation jobs to workers
    for (const [i, chunkKey] of localChunks.entries()) {
      this.workers.broadcast({ type: 'simulate', workerId: i + 1, tick: Date.now(), chunkKey });
    }
    // naive boundary sync (placeholder)
    await this.syncBoundaries(localChunks);
  }

  getLocalOwnedChunks(): string[] {
    // query orchestrator ownership map
    const keys: string[] = [];
    for (const [k, v] of this.orchestrator.ownership) if (v.ownerId === 'local') keys.push(k);
    return keys;
  }

  async syncBoundaries(chunkKeys: string[]) {
    // placeholder: in a real implementation we'd serialize ghost layers and send
    for (const chunkKey of chunkKeys) {
      // for now, dispatch simulate job to the worker assigned to this chunk
      this.workers.dispatchChunkSimulate(chunkKey, {});
    }
  }

  assignInitialPartition(regionKeys: string[]) {
    for (const key of regionKeys) {
      this.orchestrator.assignChunk(key, 'local');
      this.localGrid.assignChunkOwner(key, 'local');
      this.workers.assignChunkToWorker(key);
    }
  }

  createPartitionsForGrid(cxCount: number, cyCount: number, czCount: number, parts = 2) {
    return this.partitioner.partitionRect(cxCount, cyCount, czCount, parts);
  }
}
