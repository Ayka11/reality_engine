import type { ChunkOwnership, SimulationNode } from './types';

export class ChunkOrchestrator {
  ownership = new Map<string, ChunkOwnership>();
  nodes = new Map<string, SimulationNode>();

  registerNode(node: SimulationNode) {
    this.nodes.set(node.id, node);
  }

  assignChunk(chunkKey: string, preferredNode?: string) {
    // simple assignment: prefer preferredNode, else pick the least-loaded node
    const now = Date.now();
    let target: SimulationNode | undefined;
    if (preferredNode) target = this.nodes.get(preferredNode);
    if (!target) {
      target = [...this.nodes.values()].sort((a, b) => a.activeChunks.length - b.activeChunks.length)[0];
    }
    if (!target) return null;
    this.ownership.set(chunkKey, { chunkKey, ownerId: target.id, lastUpdated: now, version: 1 });
    if (!target.activeChunks.includes(chunkKey)) target.activeChunks.push(chunkKey);
    return target.id;
  }

  getResponsibleNode(chunkKey: string): string | null {
    return this.ownership.get(chunkKey)?.ownerId ?? null;
  }

  async rebalance() {
    // naive rebalance: move chunks from overloaded nodes to underloaded ones
    const nodes = [...this.nodes.values()];
    nodes.sort((a, b) => a.activeChunks.length - b.activeChunks.length);
    const min = nodes[0];
    const max = nodes[nodes.length - 1];
    if (!min || !max) return;
    const imbalance = max.activeChunks.length - min.activeChunks.length;
    if (imbalance <= 1) return;
    const moveCount = Math.floor(imbalance / 2);
    for (let i = 0; i < moveCount; i++) {
      const chunkKey = max.activeChunks.pop();
      if (!chunkKey) break;
      min.activeChunks.push(chunkKey);
      const meta = this.ownership.get(chunkKey);
      if (meta) { meta.ownerId = min.id; meta.lastUpdated = Date.now(); meta.version += 1; }
    }
  }
}
