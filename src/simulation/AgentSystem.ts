import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

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

export interface AgentMarker {
  id: string;
  position: [number, number, number]; // grid coords
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
  explorer:  [0.49, 0.62, 1.00],  // blue
  harvester: [0.30, 0.69, 0.49],  // green
  signaler:  [0.75, 0.52, 0.99],  // purple
  builder:   [0.94, 0.56, 0.25],  // orange
  destroyer: [0.96, 0.48, 0.48],  // red
};

export class AgentSystem {
  private agents: Map<number, Agent> = new Map();
  readonly maxAgents = 64;

  // Seed agents + inject local energy so they survive from a cold start
  seed(grid: VoxelGrid, count = 8): void {
    for (let i = 0; i < count && this.agents.size < this.maxAgents; i++) {
      const x = Math.floor(4 + Math.random() * (grid.W - 8));
      const y = Math.floor(4 + Math.random() * (grid.H - 8));
      const z = Math.floor(2 + Math.random() * (grid.D * 0.6));

      // Inject a small energy patch so agents have something to harvest
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

  tick(grid: VoxelGrid, dt: number): void {
    const dead: number[] = [];

    for (const [id, agent] of this.agents) {
      agent.age++;

      const base = this._base(grid, agent.x, agent.y, agent.z);
      const buf  = grid.buffer;
      const localEnergy = buf[base + F.ENERGY];

      agent.memory = agent.memory * 0.95 + (localEnergy / 1000) * 0.05;

      // Low base metabolism — agents can survive without a rich world
      const consume = 0.4 * dt * 60;
      agent.energy -= consume;
      buf[base + F.ENERGY] = Math.max(0, localEnergy - consume * 0.5);

      if (agent.energy <= 0) { dead.push(id); continue; }

      switch (agent.behavior) {
        case 'explorer':  this._explore(grid, agent, dt);  break;
        case 'harvester': this._harvest(grid, agent, dt);  break;
        case 'signaler':  this._signal(grid, agent, dt);   break;
        case 'builder':   this._build(grid, agent, dt);    break;
        case 'destroyer': this._destroy(grid, agent, dt);  break;
      }

      // Stamp presence
      buf[base + F.AGENT_MARK] = agent.id;

      // Replicate when well-fed
      if (agent.energy > 300 && this.agents.size < this.maxAgents) {
        agent.energy *= 0.55;
        const childBehavior = Math.random() < 0.15 ? randomBehavior() : agent.behavior;
        this._spawn(
          Math.max(0, Math.min(grid.W-1, agent.x + Math.round(Math.random()*4-2))),
          Math.max(0, Math.min(grid.H-1, agent.y + Math.round(Math.random()*4-2))),
          Math.max(0, Math.min(grid.D-1, agent.z + Math.round(Math.random()*2-1))),
          childBehavior, agent.energy * 0.6,
        );
        agent.children++;
      }
    }

    for (const id of dead) {
      const agent = this.agents.get(id)!;
      const base = this._base(grid, agent.x, agent.y, agent.z);
      // Leave energy ghost on death
      grid.buffer[base + F.ENERGY] = Math.min(9999,
        grid.buffer[base + F.ENERGY] + agent.energy);
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

  private _explore(grid: VoxelGrid, agent: Agent, dt: number): void {
    const { W, H, D, buffer: buf } = grid;
    let bestE = -1, bx = agent.x, by = agent.y, bz = agent.z;
    const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
    for (const [dx,dy,dz] of dirs) {
      const nx=agent.x+dx, ny=agent.y+dy, nz=agent.z+dz;
      if (nx<0||nx>=W||ny<0||ny>=H||nz<0||nz>=D) continue;
      const e = buf[(nz*H*W+ny*W+nx)*CELL_FIELDS+F.ENERGY];
      if (e > bestE) { bestE=e; bx=nx; by=ny; bz=nz; }
    }
    // Always move (not probability-gated) — makes explorers visibly traverse the world
    if (bx !== agent.x || by !== agent.y || bz !== agent.z) {
      // Clear old mark
      grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
      agent.x=bx; agent.y=by; agent.z=bz;
    }
    // Explorers passively harvest a tiny amount while moving
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(3 * dt * 60, grid.buffer[base + F.ENERGY]);
    grid.buffer[base + F.ENERGY] -= take;
    agent.energy = Math.min(500, agent.energy + take);
  }

  private _harvest(grid: VoxelGrid, agent: Agent, dt: number): void {
    // Harvest locally, then move to richest neighbor
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(20 * dt * 60, grid.buffer[base + F.ENERGY]);
    grid.buffer[base + F.ENERGY] -= take;
    agent.energy = Math.min(600, agent.energy + take);

    // Move toward richest neighbor every few ticks
    if (agent.age % 4 === 0) {
      const { W, H, D, buffer: buf } = grid;
      let bestE = grid.buffer[base + F.ENERGY], bx = agent.x, by = agent.y, bz = agent.z;
      const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
      for (const [dx,dy,dz] of dirs) {
        const nx=agent.x+dx, ny=agent.y+dy, nz=agent.z+dz;
        if (nx<0||nx>=W||ny<0||ny>=H||nz<0||nz>=D) continue;
        const e = buf[(nz*H*W+ny*W+nx)*CELL_FIELDS+F.ENERGY];
        if (e > bestE) { bestE=e; bx=nx; by=ny; bz=nz; }
      }
      if (bx !== agent.x || by !== agent.y || bz !== agent.z) {
        grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
        agent.x=bx; agent.y=by; agent.z=bz;
      }
    }
  }

  private _signal(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    agent.signal = Math.min(100, agent.signal + 8 * dt * 60);
    grid.buffer[base + F.SIGNAL] = Math.min(100,
      grid.buffer[base + F.SIGNAL] + agent.signal * 0.5 * dt);
    // Signalers also move slowly toward high-signal neighbors
    if (agent.age % 6 === 0) {
      const { W, H, buffer: buf } = grid;
      let bestS = -1, bx = agent.x, by = agent.y;
      const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0]] as const;
      for (const [dx,dy] of dirs) {
        const nx=agent.x+dx, ny=agent.y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const s = buf[(agent.z*H*W+ny*W+nx)*CELL_FIELDS+F.SIGNAL];
        if (s > bestS) { bestS = s; bx = nx; by = ny; }
      }
      if (bx !== agent.x || by !== agent.y) {
        grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
        agent.x = bx; agent.y = by;
      }
    }
    agent.energy -= agent.signal * 0.005 * dt * 60;
  }

  private _build(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    grid.buffer[base + F.INFORMATION]   = Math.min(999, grid.buffer[base + F.INFORMATION]   + 5  * dt * 60);
    grid.buffer[base + F.BIO_POTENTIAL] = Math.min(1,   grid.buffer[base + F.BIO_POTENTIAL] + 0.015 * dt * 60);
    grid.buffer[base + F.ENTROPY]       = Math.max(0,   grid.buffer[base + F.ENTROPY]       - 0.005 * dt * 60);
    agent.energy -= 0.8 * dt * 60;
  }

  private _destroy(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const stolenE = Math.min(15 * dt * 60, grid.buffer[base + F.ENERGY]);
    grid.buffer[base + F.ENERGY]  = Math.max(0, grid.buffer[base + F.ENERGY] - stolenE);
    grid.buffer[base + F.ENTROPY] = Math.min(1, grid.buffer[base + F.ENTROPY] + 0.03 * dt * 60);
    agent.energy = Math.min(500, agent.energy + stolenE * 0.7);
    // Destroyers roam randomly
    if (agent.age % 3 === 0) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      const [dx,dy] = dirs[Math.floor(Math.random()*4)];
      const nx = Math.max(0, Math.min(grid.W-1, agent.x+dx));
      const ny = Math.max(0, Math.min(grid.H-1, agent.y+dy));
      if (nx !== agent.x || ny !== agent.y) {
        grid.buffer[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
        agent.x=nx; agent.y=ny;
      }
    }
  }

  getAgents(): Agent[] { return [...this.agents.values()]; }

  agentMarkers(): AgentMarker[] {
    return this.getAgents().map(a => ({
      id: String(a.id),
      position: [a.x, a.y, a.z] as [number, number, number],
      behavior: a.behavior,
      energy: a.energy,
      age: a.age,
    }));
  }

  clear(): void { this.agents.clear(); _agentId = 1; }
}
