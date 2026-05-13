import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export type AgentBehavior = 'explorer' | 'harvester' | 'signaler' | 'builder' | 'destroyer';

export interface Agent {
  id: number;
  x: number; y: number; z: number;
  energy: number;
  age: number;
  behavior: AgentBehavior;
  memory: number;       // rolling observation average
  signal: number;       // emitted signal strength
  children: number;     // offspring count
}

let _agentId = 1;

const BEHAVIORS: AgentBehavior[] = ['explorer', 'harvester', 'signaler', 'builder', 'destroyer'];

function randomBehavior(): AgentBehavior {
  return BEHAVIORS[Math.floor(Math.random() * BEHAVIORS.length)];
}

export class AgentSystem {
  private agents: Map<number, Agent> = new Map();
  readonly maxAgents = 64;

  seed(grid: VoxelGrid, count = 8): void {
    for (let i = 0; i < count && this.agents.size < this.maxAgents; i++) {
      const x = Math.floor(Math.random() * grid.W);
      const y = Math.floor(Math.random() * grid.H);
      const z = Math.floor(Math.random() * grid.D);
      this._spawn(x, y, z, randomBehavior());
    }
  }

  tick(grid: VoxelGrid, dt: number): void {
    const dead: number[] = [];

    for (const [id, agent] of this.agents) {
      agent.age++;

      // ── Observe local state ───────────────────────────────────────────────
      const base = this._base(grid, agent.x, agent.y, agent.z);
      const buf  = grid.buffer;
      const localEnergy = buf[base + F.ENERGY];

      // Update rolling memory
      agent.memory = agent.memory * 0.95 + (localEnergy / 1000) * 0.05;

      // ── Consume energy to survive ─────────────────────────────────────────
      const consume = 2 * dt * 60;
      agent.energy -= consume;
      buf[base + F.ENERGY] = Math.max(0, localEnergy - consume);

      if (agent.energy <= 0) { dead.push(id); continue; }

      // ── Behavior-specific actions ─────────────────────────────────────────
      switch (agent.behavior) {
        case 'explorer': this._explore(grid, agent, dt);   break;
        case 'harvester': this._harvest(grid, agent, dt);  break;
        case 'signaler':  this._signal(grid, agent, dt);   break;
        case 'builder':   this._build(grid, agent, dt);    break;
        case 'destroyer': this._destroy(grid, agent, dt);  break;
      }

      // ── Mark cell with agent presence ─────────────────────────────────────
      buf[base + F.AGENT_MARK] = 1;

      // ── Replicate if energy rich ──────────────────────────────────────────
      if (agent.energy > 200 && this.agents.size < this.maxAgents) {
        agent.energy *= 0.5;
        // Mutate behavior occasionally
        const childBehavior = Math.random() < 0.15 ? randomBehavior() : agent.behavior;
        this._spawn(
          Math.max(0, Math.min(grid.W-1, agent.x + Math.round(Math.random()*4-2))),
          Math.max(0, Math.min(grid.H-1, agent.y + Math.round(Math.random()*4-2))),
          Math.max(0, Math.min(grid.D-1, agent.z + Math.round(Math.random()*2-1))),
          childBehavior, agent.energy * 0.5,
        );
        agent.children++;
      }
    }

    for (const id of dead) {
      const agent = this.agents.get(id)!;
      // Leave an energy trace on death
      const base = this._base(grid, agent.x, agent.y, agent.z);
      grid.buffer[base + F.ENERGY] = Math.min(9999,
        grid.buffer[base + F.ENERGY] + agent.energy * 0.5);
      grid.buffer[base + F.AGENT_MARK] = 0;
      this.agents.delete(id);
    }
  }

  private _base(grid: VoxelGrid, x: number, y: number, z: number): number {
    return (z * grid.H * grid.W + y * grid.W + x) * CELL_FIELDS;
  }

  private _spawn(x: number, y: number, z: number, behavior: AgentBehavior, energy = 80): void {
    const id = _agentId++;
    this.agents.set(id, { id, x, y, z, energy, age: 0, behavior, memory: 0, signal: 0, children: 0 });
  }

  private _explore(grid: VoxelGrid, agent: Agent, dt: number): void {
    // Move toward highest energy neighbor
    const { W, H, D, buffer: buf } = grid;
    let bestE = -1, bx = agent.x, by = agent.y, bz = agent.z;
    const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
    for (const [dx,dy,dz] of dirs) {
      const nx=agent.x+dx, ny=agent.y+dy, nz=agent.z+dz;
      if (nx<0||nx>=W||ny<0||ny>=H||nz<0||nz>=D) continue;
      const e = buf[(nz*H*W+ny*W+nx)*CELL_FIELDS+F.ENERGY];
      if (e > bestE) { bestE=e; bx=nx; by=ny; bz=nz; }
    }
    if (Math.random() < 0.3 * dt * 60) { agent.x=bx; agent.y=by; agent.z=bz; }
  }

  private _harvest(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(10 * dt * 60, grid.buffer[base + F.ENERGY]);
    grid.buffer[base + F.ENERGY] -= take;
    agent.energy = Math.min(500, agent.energy + take);
  }

  private _signal(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    agent.signal = Math.min(100, agent.signal + 5 * dt * 60);
    grid.buffer[base + F.SIGNAL] = Math.min(100,
      grid.buffer[base + F.SIGNAL] + agent.signal * dt);
    agent.energy -= agent.signal * 0.01 * dt * 60;
  }

  private _build(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    grid.buffer[base + F.INFORMATION] = Math.min(999,
      grid.buffer[base + F.INFORMATION] + 3 * dt * 60);
    grid.buffer[base + F.BIO_POTENTIAL] = Math.min(1,
      grid.buffer[base + F.BIO_POTENTIAL] + 0.01 * dt * 60);
    agent.energy -= 1 * dt * 60;
  }

  private _destroy(grid: VoxelGrid, agent: Agent, dt: number): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    grid.buffer[base + F.ENTROPY] = Math.min(1,
      grid.buffer[base + F.ENTROPY] + 0.05 * dt * 60);
    grid.buffer[base + F.ENERGY] = Math.max(0,
      grid.buffer[base + F.ENERGY] - 20 * dt * 60);
    agent.energy += 5 * dt * 60;
    // Move randomly
    if (Math.random() < 0.4 * dt * 60) {
      agent.x = Math.max(0, Math.min(grid.W-1, agent.x + Math.round(Math.random()*2-1)));
      agent.y = Math.max(0, Math.min(grid.H-1, agent.y + Math.round(Math.random()*2-1)));
    }
  }

  getAgents(): Agent[] { return [...this.agents.values()]; }

  clear(): void { this.agents.clear(); _agentId = 1; }
}
