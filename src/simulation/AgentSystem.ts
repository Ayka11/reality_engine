import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';
import type { InfinityScaleChunkExecutionContext } from '../infinity/InfinityScaleChunkExecutionContext';
import type { InfinityScaleLODBoundarySnapshot } from '../infinity/InfinityScaleLODBoundarySnapshot';

export type AgentBehavior = 'explorer' | 'harvester' | 'signaler' | 'builder' | 'destroyer';

export interface Agent {
  id: number;
  x: number; y: number; z: number;
  energy: number;
  age: number;
  behavior: AgentBehavior;
  memory: number;
  signal: number;
  children: number;
}

export interface AgentMigrationRequest {
  agentId: number;
  from: [number, number, number];
  to: [number, number, number];
  behavior: AgentBehavior;
  energy: number;
}

export interface AgentMarker {
  id: string;
  position: [number, number, number];
  behavior: AgentBehavior;
  energy: number;
  age: number;
}

let _agentId = 1;
const BEHAVIORS: AgentBehavior[] = ['explorer', 'harvester', 'signaler', 'builder', 'destroyer'];

function randomBehavior(): AgentBehavior {
  return BEHAVIORS[Math.floor(Math.random() * BEHAVIORS.length)];
}

export const AGENT_COLORS: Record<AgentBehavior, [number, number, number]> = {
  explorer: [0.49, 0.62, 1.00],
  harvester: [0.30, 0.69, 0.49],
  signaler: [0.75, 0.52, 0.99],
  builder: [0.94, 0.56, 0.25],
  destroyer: [0.96, 0.48, 0.48],
};

export class AgentSystem {
  private agents: Map<number, Agent> = new Map();
  readonly maxAgents = 64;
  private pendingMigrations: AgentMigrationRequest[] = [];

  spawnAt(x: number, y: number, z: number, behavior: AgentBehavior = "explorer", energy = 200): number {
    if (this.agents.size >= this.maxAgents) throw new Error("Maximum agent count reached");
    this._spawn(x, y, z, behavior, energy);
    return _agentId - 1;
  }

  queueMigrationRequest(request: AgentMigrationRequest): void {
    this.pendingMigrations.push({
      ...request,
      from: [...request.from] as [number, number, number],
      to: [...request.to] as [number, number, number],
    });
  }

  peekMigrationRequests(): AgentMigrationRequest[] {
    return dedupeMigrationRequests(this.pendingMigrations);
  }

  consumeMigrationRequests(): AgentMigrationRequest[] {
    const requests = this.peekMigrationRequests();
    this.pendingMigrations = [];
    return requests;
  }

  acknowledgeMigrationRequests(requests: AgentMigrationRequest[]): void {
    const acknowledged = new Set(requests.map(migrationKey));
    this.pendingMigrations = this.pendingMigrations.filter(
      request => !acknowledged.has(migrationKey(request)),
    );
  }

  // Seed agents + inject local energy so they survive from a cold start
  seed(grid: VoxelGrid, count = 8): void {
    for (let i = 0; i < count && this.agents.size < this.maxAgents; i++) {
      const x = Math.floor(4 + Math.random() * (grid.W - 8));
      const y = Math.floor(4 + Math.random() * (grid.H - 8));
      const z = Math.floor(2 + Math.random() * (grid.D * 0.6));
      for (let dz = -1; dz <= 1; dz++)
      for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (!grid.inBounds(x+dx, y+dy, z+dz)) continue;
        const base = (((z+dz) * grid.H * grid.W) + (y+dy) * grid.W + (x+dx)) * CELL_FIELDS;
        grid.buffer[base + F.ENERGY] = Math.max(grid.buffer[base + F.ENERGY], 150);
      }
      this._spawn(x, y, z, randomBehavior(), 200);
    }
  }

  tick(grid: VoxelGrid, dt: number): void { this.tickRegion(grid, dt, null); }

  tickChunks(grid: VoxelGrid, dt: number, context: InfinityScaleChunkExecutionContext, boundarySnapshot?: InfinityScaleLODBoundarySnapshot): void {
    this.tickRegion(grid, dt, context, boundarySnapshot);
  }

  applyMigrationRequests(grid: VoxelGrid, requests: AgentMigrationRequest[], context: InfinityScaleChunkExecutionContext): number {
    let applied = 0;
    const appliedRequests: AgentMigrationRequest[] = [];
    for (const request of requests) {
      const agent = this.agents.get(request.agentId);
      if (!agent) continue;
      if (!context.containsSimulationCell(request.to[0], request.to[1], request.to[2])) continue;
      if (agent.x !== request.from[0] || agent.y !== request.from[1] || agent.z !== request.from[2]) continue;
      grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
      agent.x = request.to[0]; agent.y = request.to[1]; agent.z = request.to[2];
      grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = agent.id;
      applied++;
      appliedRequests.push(request);
    }
    this.acknowledgeMigrationRequests(appliedRequests);
    return applied;
  }

  private tickRegion(grid: VoxelGrid, dt: number, context: InfinityScaleChunkExecutionContext | null, boundarySnapshot?: InfinityScaleLODBoundarySnapshot): void {
    const dead: number[] = [];
    for (const [id, agent] of this.agents) {
      if (context && !context.containsSimulationCell(agent.x, agent.y, agent.z)) continue;
      agent.age++;
      const base = this._base(grid, agent.x, agent.y, agent.z);
      const buf = grid.buffer;
      const localEnergy = buf[base + F.ENERGY];
      agent.memory = agent.memory * 0.95 + (localEnergy / 1000) * 0.05;
      const consume = 0.4 * dt * 60;
      agent.energy -= consume;
      buf[base + F.ENERGY] = Math.max(0, localEnergy - consume * 0.5);
      if (agent.energy <= 0) { dead.push(id); continue; }
      switch (agent.behavior) {
        case 'explorer': this._explore(grid, agent, dt, context, boundarySnapshot); break;
        case 'harvester': this._harvest(grid, agent, dt, context, boundarySnapshot); break;
        case 'signaler': this._signal(grid, agent, dt, context); break;
        case 'builder': this._build(grid, agent, dt, context); break;
        case 'destroyer': this._destroy(grid, agent, dt, context); break;
      }
      const newBase = this._base(grid, agent.x, agent.y, agent.z);
      buf[newBase + F.AGENT_MARK] = agent.id;
      if (agent.energy > 300 && this.agents.size < this.maxAgents) {
        agent.energy *= 0.55;
        const childX = Math.max(0, Math.min(grid.W - 1, agent.x + Math.round(Math.random() * 4 - 2)));
        const childY = Math.max(0, Math.min(grid.H - 1, agent.y + Math.round(Math.random() * 4 - 2)));
        const childZ = Math.max(0, Math.min(grid.D - 1, agent.z + Math.round(Math.random() * 2 - 1)));
        if (context && !context.containsSimulationCell(childX, childY, childZ)) { agent.energy /= 0.55; continue; }
        const childBehavior = Math.random() < 0.15 ? randomBehavior() : agent.behavior;
        this._spawn(childX, childY, childZ, childBehavior, agent.energy * 0.6);
        agent.children++;
      }
    }
    for (const id of dead) {
      const agent = this.agents.get(id)!;
      const base = this._base(grid, agent.x, agent.y, agent.z);
      grid.buffer[base + F.ENERGY] = Math.min(9999, grid.buffer[base + F.ENERGY] + agent.energy);
      grid.buffer[base + F.AGENT_MARK] = 0;
      this.agents.delete(id);
    }
  }

  private _base(grid: VoxelGrid, x: number, y: number, z: number): number {
    return (z * grid.H * grid.W + y * grid.W + x) * CELL_FIELDS;
  }

  private _spawn(x: number, y: number, z: number, behavior: AgentBehavior, energy = 200): void {
    const id = _agentId++;
    this.agents.set(id, { id, x, y, z, energy, age: 0, behavior, memory: 0, signal: 0, children: 0 });
  }

  private _explore(grid: VoxelGrid, agent: Agent, dt: number, context: InfinityScaleChunkExecutionContext | null = null, boundarySnapshot?: InfinityScaleLODBoundarySnapshot): void {
    const { W, H, D, buffer: buf } = grid;
    let bestE = -1, bx = agent.x, by = agent.y, bz = agent.z;
    const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
    for (const [dx,dy,dz] of dirs) {
      const nx=agent.x+dx, ny=agent.y+dy, nz=agent.z+dz;
      if (nx<0||nx>=W||ny<0||ny>=H||nz<0||nz>=D) continue;
      let e = buf[(nz*H*W+ny*W+nx)*CELL_FIELDS+F.ENERGY];
      if (context && boundarySnapshot && !context.containsSimulationCell(nx, ny, nz)) {
        for (const spec of context.getBoundaryTransferSpecsForCell(agent.x, agent.y, agent.z)) {
          const sample = boundarySnapshot.read(spec, [nx, ny, nz]);
          if (sample) { e = sample[F.ENERGY]; break; }
        }
      }
      if (e > bestE) { bestE=e; bx=nx; by=ny; bz=nz; }
    }
    if (bx !== agent.x || by !== agent.y || bz !== agent.z) {
      grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
      if (!context || context.containsSimulationCell(bx, by, bz)) {
        agent.x=bx; agent.y=by; agent.z=bz;
      }
    }
    const newBase = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(3 * dt * 60, grid.buffer[newBase + F.ENERGY]);
    grid.buffer[newBase + F.ENERGY] -= take;
    agent.energy = Math.min(500, agent.energy + take);
  }

  private _harvest(grid: VoxelGrid, agent: Agent, dt: number, context: InfinityScaleChunkExecutionContext | null = null, boundarySnapshot?: InfinityScaleLODBoundarySnapshot): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(20 * dt * 60, grid.buffer[base + F.ENERGY]);
    grid.buffer[base + F.ENERGY] -= take;
    agent.energy = Math.min(600, agent.energy + take);
    if (agent.age % 4 === 0) {
      const { W, H, D, buffer: buf } = grid;
      let bestE = grid.buffer[base + F.ENERGY], bx = agent.x, by = agent.y, bz = agent.z;
      const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
      for (const [dx,dy,dz] of dirs) {
        const nx=agent.x+dx, ny=agent.y+dy, nz=agent.z+dz;
        if (nx<0||nx>=W||ny<0||ny>=H||nz<0||nz>=D) continue;
        let e = buf[(nz*H*W+ny*W+nx)*CELL_FIELDS+F.ENERGY];
        if (context && boundarySnapshot && !context.containsSimulationCell(nx, ny, nz)) {
          for (const spec of context.getBoundaryTransferSpecsForCell(agent.x, agent.y, agent.z)) {
            const sample = boundarySnapshot.read(spec, [nx, ny, nz]);
            if (sample) { e = sample[F.ENERGY]; break; }
          }
        }
        if (e > bestE) { bestE=e; bx=nx; by=ny; bz=nz; }
      }
      if (bx !== agent.x || by !== agent.y || bz !== agent.z) {
        if (!context || context.containsSimulationCell(bx, by, bz)) {
          grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
          agent.x=bx; agent.y=by; agent.z=bz;
        } else {
          this.pendingMigrations.push({ agentId: agent.id, from: [agent.x, agent.y, agent.z], to: [bx, by, bz], behavior: agent.behavior, energy: agent.energy });
        }
      }
    }
  }

  private _signal(grid: VoxelGrid, agent: Agent, dt: number, context: InfinityScaleChunkExecutionContext | null = null): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    agent.signal = Math.min(100, agent.signal + 8 * dt * 60);
    grid.buffer[base + F.SIGNAL] = Math.min(100, grid.buffer[base + F.SIGNAL] + agent.signal * 0.5 * dt);
    if (agent.age % 6 === 0) {
      const { W, H, buffer: buf } = grid;
      let bestS = -1, bx = agent.x, by = agent.y;
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]] as const;
      for (const [dx,dy] of dirs) {
        const nx=agent.x+dx, ny=agent.y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const s = buf[(agent.z*H*W+ny*W+nx)*CELL_FIELDS+F.SIGNAL];
        if (s > bestS) { bestS = s; bx = nx; by = ny; }
      }
      if (bx !== agent.x || by !== agent.y) {
        grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
        if (!context || context.containsSimulationCell(bx, by, agent.z)) { agent.x = bx; agent.y = by; }
      }
    }
    agent.energy -= agent.signal * 0.005 * dt * 60;
  }

  private _build(grid: VoxelGrid, agent: Agent, dt: number, context: InfinityScaleChunkExecutionContext | null = null): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    grid.buffer[base + F.INFORMATION] = Math.min(999, grid.buffer[base + F.INFORMATION] + 5 * dt * 60);
    grid.buffer[base + F.BIO_POTENTIAL] = Math.min(1, grid.buffer[base + F.BIO_POTENTIAL] + 0.015 * dt * 60);
    grid.buffer[base + F.ENTROPY] = Math.max(0, grid.buffer[base + F.ENTROPY] - 0.005 * dt * 60);
    agent.energy -= 0.8 * dt * 60;
  }

  private _destroy(grid: VoxelGrid, agent: Agent, dt: number, context: InfinityScaleChunkExecutionContext | null = null): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const stolenE = Math.min(15 * dt * 60, grid.buffer[base + F.ENERGY]);
    grid.buffer[base + F.ENERGY] = Math.max(0, grid.buffer[base + F.ENERGY] - stolenE);
    grid.buffer[base + F.ENTROPY] = Math.min(1, grid.buffer[base + F.ENTROPY] + 0.03 * dt * 60);
    agent.energy = Math.min(500, agent.energy + stolenE * 0.7);
    if (agent.age % 3 === 0) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      const [dx,dy] = dirs[Math.floor(Math.random()*4)];
      const nx = Math.max(0, Math.min(grid.W-1, agent.x+dx));
      const ny = Math.max(0, Math.min(grid.H-1, agent.y+dy));
      if (nx !== agent.x || ny !== agent.y) {
        if (!context || context.containsSimulationCell(nx, ny, agent.z)) {
          grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
          agent.x=nx; agent.y=ny;
        } else {
          this.pendingMigrations.push({ agentId: agent.id, from: [agent.x, agent.y, agent.z], to: [nx, ny, agent.z], behavior: agent.behavior, energy: agent.energy });
        }
      }
    }
  }

  getAgents(): Agent[] { return [...this.agents.values()]; }

  agentMarkers(): AgentMarker[] {
    return this.getAgents().map(a => ({ id: String(a.id), position: [a.x, a.y, a.z] as [number, number, number], behavior: a.behavior, energy: a.energy, age: a.age }));
  }

  clear(): void { this.agents.clear(); this.pendingMigrations = []; _agentId = 1; }
}

function migrationKey(request: AgentMigrationRequest): string {
  return [request.agentId, request.from.join(','), request.to.join(',')].join('|');
}

function dedupeMigrationRequests(requests: AgentMigrationRequest[]): AgentMigrationRequest[] {
  const deduped = new Map<string, AgentMigrationRequest>();
  for (const request of requests) {
    const key = migrationKey(request);
    deduped.set(key, {
      ...request,
      from: [...request.from] as [number, number, number],
      to: [...request.to] as [number, number, number],
    });
  }
  return [...deduped.values()];
}
