import type { SimulationNode } from './types';

export class LoadBalancer {
  constructor(private strategy: 'static' | 'dynamic' = 'static') {}

  chooseNode(nodes: SimulationNode[]): SimulationNode | null {
    if (!nodes.length) return null;
    if (this.strategy === 'static') return nodes.sort((a,b) => a.id.localeCompare(b.id))[0];
    // dynamic: choose least-loaded
    return nodes.sort((a,b) => a.activeChunks.length - b.activeChunks.length)[0];
  }
}
