import { VoxelGrid } from '../core/VoxelGrid';
import { withMutableBuffers } from '../core/TrackedFloat32Array';
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

export interface AgentSystemSnapshot {
  agents: Agent[];
  nextAgentId: number;
  rngState: number;
}

const BEHAVIORS: AgentBehavior[] = ['explorer', 'harvester', 'signaler', 'builder', 'destroyer'];

function randomBehavior(random: () => number): AgentBehavior {
  return BEHAVIORS[Math.floor(random() * BEHAVIORS.length)];
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
  private readonly initialRngState: number;
  private _rngState = 0x0a63c9d1;
  private _nextAgentId = 1;
  readonly maxAgents = 64;

  constructor(seed = 0x0a63c9d1) {
    this.initialRngState = Number.isSafeInteger(seed) ? (seed >>> 0) || 0x0a63c9d1 : 0x0a63c9d1;
    this._rngState = this.initialRngState;
  }

  private _random(): number {
    let x = this._rngState >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState / 0x100000000;
  }

  snapshotRandomState(): number { return this._rngState; }

  restoreRandomState(state: number): void {
    if (!Number.isSafeInteger(state) || state <= 0 || state > 0xffffffff) {
      throw new Error("Invalid AgentSystem PRNG state");
    }
    this._rngState = state >>> 0;
  }

  snapshot(): AgentSystemSnapshot {
    return {
      agents: [...this.agents.values()].map(agent => ({ ...agent })),
      nextAgentId: this._nextAgentId,
      rngState: this._rngState,
    };
  }

  restore(snapshot: AgentSystemSnapshot): void {
    if (!snapshot ||
        typeof snapshot !== "object" ||
        !Array.isArray(snapshot.agents) ||
        snapshot.agents.length > this.maxAgents ||
        !Number.isSafeInteger(snapshot.nextAgentId) ||
        snapshot.nextAgentId < 1 ||
        !Number.isSafeInteger(snapshot.rngState) ||
        snapshot.rngState <= 0 ||
        snapshot.rngState > 0xffffffff) {
      throw new Error("Invalid AgentSystem snapshot envelope");
    }

    const restored = new Map<number, Agent>();
    let maxId = 0;
    for (const candidate of snapshot.agents as unknown[]) {
      if (!candidate || typeof candidate !== "object") {
        throw new Error("Invalid AgentSystem snapshot agent");
      }
      const agent = candidate as Partial<Agent>;
      if (!Number.isSafeInteger(agent.id) ||
          (agent.id as number) < 1 ||
          restored.has(agent.id as number) ||
          !Number.isSafeInteger(agent.x) || (agent.x as number) < 0 ||
          !Number.isSafeInteger(agent.y) || (agent.y as number) < 0 ||
          !Number.isSafeInteger(agent.z) || (agent.z as number) < 0 ||
          typeof agent.energy !== "number" ||
          !Number.isFinite(agent.energy) || agent.energy < 0 ||
          !Number.isSafeInteger(agent.age) || (agent.age as number) < 0 ||
          typeof agent.behavior !== "string" ||
          !BEHAVIORS.includes(agent.behavior as AgentBehavior) ||
          typeof agent.memory !== "number" || !Number.isFinite(agent.memory) ||
          typeof agent.signal !== "number" || !Number.isFinite(agent.signal) ||
          !Number.isSafeInteger(agent.children) || (agent.children as number) < 0) {
        throw new Error("Invalid AgentSystem snapshot agent state");
      }

      const restoredAgent: Agent = {
        id: agent.id as number,
        x: agent.x as number,
        y: agent.y as number,
        z: agent.z as number,
        energy: agent.energy,
        age: agent.age as number,
        behavior: agent.behavior as AgentBehavior,
        memory: agent.memory,
        signal: agent.signal,
        children: agent.children as number,
      };
      restored.set(restoredAgent.id, restoredAgent);
      maxId = Math.max(maxId, restoredAgent.id);
    }

    if (snapshot.nextAgentId <= maxId) {
      throw new Error("Invalid AgentSystem snapshot allocator state");
    }

    // Replace live state only after the whole candidate has been validated
    // and detached from its caller-owned objects.
    this.agents = restored;
    this._nextAgentId = snapshot.nextAgentId;
    this._rngState = snapshot.rngState >>> 0;
  }

  // Seed agents + inject local energy so they survive from a cold start
  seed(grid: VoxelGrid, count = 8): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.maxAgents) {
      throw new RangeError(`AgentSystem seed count must be a safe integer from 0 to ${this.maxAgents}`);
    }
    // A no-op seed must not acquire a mutable grid buffer (which advances the
    // tracked mutation revision) when no agents can be added.
    if (count === 0 || this.agents.size >= this.maxAgents) return;
    withMutableBuffers(grid, (front, _back) => {
      for (let i = 0; i < count && this.agents.size < this.maxAgents; i++) {
        // Keep seeded agents in-bounds for small test worlds as well as the
        // default world. The previous fixed margins could create coordinates
        // outside grids narrower than eight cells or shallower than three.
        const x = Math.min(grid.W - 1, Math.max(0, Math.floor(4 + this._random() * Math.max(1, grid.W - 8))));
        const y = Math.min(grid.H - 1, Math.max(0, Math.floor(4 + this._random() * Math.max(1, grid.H - 8))));
        const z = Math.min(grid.D - 1, Math.max(0, Math.floor(2 + this._random() * Math.max(1, grid.D * 0.6))));

        // Inject a small energy patch so agents have something to harvest
        for (let dz = -1; dz <= 1; dz++)
        for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (!grid.inBounds(x+dx, y+dy, z+dz)) continue;
          const base = (((z+dz) * grid.H * grid.W) + (y+dy) * grid.W + (x+dx)) * CELL_FIELDS;
          front[base + F.ENERGY] = Math.max(front[base + F.ENERGY], 150);
        }

        this._spawn(x, y, z, randomBehavior(() => this._random()), 200);
      }
    });
  }

  tick(grid: VoxelGrid, dt: number): void {
    // Public callers may bypass SimulationEngine; reject invalid time before
    // agent counters, PRNG state, or grid fields can be changed.
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError("AgentSystem tick dt must be a finite non-negative number");
    }

    withMutableBuffers(grid, (front, _back) => {
      const dead: number[] = [];

      for (const [id, agent] of this.agents) {
        agent.age++;

        const base = this._base(grid, agent.x, agent.y, agent.z);
        const localEnergy = front[base + F.ENERGY];

        agent.memory = agent.memory * 0.95 + (localEnergy / 1000) * 0.05;

        // Low base metabolism — agents can survive without a rich world
        const consume = 0.4 * dt * 60;
        agent.energy -= consume;
        front[base + F.ENERGY] = Math.max(0, localEnergy - consume * 0.5);

        if (agent.energy <= 0) { dead.push(id); continue; }

        switch (agent.behavior) {
          case 'explorer':  this._explore(grid, agent, dt, front);  break;
          case 'harvester': this._harvest(grid, agent, dt, front);  break;
          case 'signaler':  this._signal(grid, agent, dt, front);   break;
          case 'builder':   this._build(grid, agent, dt, front);    break;
          case 'destroyer': this._destroy(grid, agent, dt, front);  break;
        }

        // Stamp presence
        front[base + F.AGENT_MARK] = agent.id;

        // Replicate when well-fed
        if (agent.energy > 300 && this.agents.size < this.maxAgents) {
          agent.energy *= 0.55;
          const childBehavior = this._random() < 0.15 ? randomBehavior(() => this._random()) : agent.behavior;
          this._spawn(
            Math.max(0, Math.min(grid.W-1, agent.x + Math.round(this._random()*4-2))),
            Math.max(0, Math.min(grid.H-1, agent.y + Math.round(this._random()*4-2))),
            Math.max(0, Math.min(grid.D-1, agent.z + Math.round(this._random()*2-1))),
            childBehavior, agent.energy * 0.6,
          );
          agent.children++;
        }
      }

      for (const id of dead) {
        const agent = this.agents.get(id)!;
        const base = this._base(grid, agent.x, agent.y, agent.z);
        // Leave energy ghost on death
        front[base + F.ENERGY] = Math.min(9999,
          front[base + F.ENERGY] + agent.energy);
        front[base + F.AGENT_MARK] = 0;
        this.agents.delete(id);
      }
    });
  }

  private _base(grid: VoxelGrid, x: number, y: number, z: number): number {
    return (z * grid.H * grid.W + y * grid.W + x) * CELL_FIELDS;
  }

  private _spawn(x: number, y: number, z: number, behavior: AgentBehavior, energy = 200): void {
    const id = this._nextAgentId++;
    this.agents.set(id, { id, x, y, z, energy, age: 0, behavior, memory: 0, signal: 0, children: 0 });
  }

  private _explore(grid: VoxelGrid, agent: Agent, dt: number, buf: Float32Array): void {
    const { W, H, D } = grid;
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
      buf[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
      agent.x=bx; agent.y=by; agent.z=bz;
    }
    // Explorers passively harvest a tiny amount while moving
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(3 * dt * 60, buf[base + F.ENERGY]);
    buf[base + F.ENERGY] -= take;
    agent.energy = Math.min(500, agent.energy + take);
  }

  private _harvest(grid: VoxelGrid, agent: Agent, dt: number, buf: Float32Array): void {
    // Harvest locally, then move to richest neighbor
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const take = Math.min(20 * dt * 60, buf[base + F.ENERGY]);
    buf[base + F.ENERGY] -= take;
    agent.energy = Math.min(600, agent.energy + take);

    // Move toward richest neighbor every few ticks
    if (agent.age % 4 === 0) {
      const { W, H, D } = grid;
      let bestE = buf[base + F.ENERGY], bx = agent.x, by = agent.y, bz = agent.z;
      const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;
      for (const [dx,dy,dz] of dirs) {
        const nx=agent.x+dx, ny=agent.y+dy, nz=agent.z+dz;
        if (nx<0||nx>=W||ny<0||ny>=H||nz<0||nz>=D) continue;
        const e = buf[(nz*H*W+ny*W+nx)*CELL_FIELDS+F.ENERGY];
        if (e > bestE) { bestE=e; bx=nx; by=ny; bz=nz; }
      }
      if (bx !== agent.x || by !== agent.y || bz !== agent.z) {
        buf[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
        agent.x=bx; agent.y=by; agent.z=bz;
      }
    }
  }

  private _signal(grid: VoxelGrid, agent: Agent, dt: number, buf: Float32Array): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    agent.signal = Math.min(100, agent.signal + 8 * dt * 60);
    buf[base + F.SIGNAL] = Math.min(100,
      buf[base + F.SIGNAL] + agent.signal * 0.5 * dt);
    // Signalers also move slowly toward high-signal neighbors
    if (agent.age % 6 === 0) {
      const { W, H } = grid;
      let bestS = -1, bx = agent.x, by = agent.y;
      const dirs = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0]] as const;
      for (const [dx,dy] of dirs) {
        const nx=agent.x+dx, ny=agent.y+dy;
        if (nx<0||nx>=W||ny<0||ny>=H) continue;
        const s = buf[(agent.z*H*W+ny*W+nx)*CELL_FIELDS+F.SIGNAL];
        if (s > bestS) { bestS = s; bx = nx; by = ny; }
      }
      if (bx !== agent.x || by !== agent.y) {
        buf[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
        agent.x = bx; agent.y = by;
      }
    }
    agent.energy -= agent.signal * 0.005 * dt * 60;
  }

  private _build(grid: VoxelGrid, agent: Agent, dt: number, buf: Float32Array): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    buf[base + F.INFORMATION]   = Math.min(999, buf[base + F.INFORMATION]   + 5  * dt * 60);
    buf[base + F.BIO_POTENTIAL] = Math.min(1,   buf[base + F.BIO_POTENTIAL] + 0.015 * dt * 60);
    buf[base + F.ENTROPY]       = Math.max(0,   buf[base + F.ENTROPY]       - 0.005 * dt * 60);
    agent.energy -= 0.8 * dt * 60;
  }

  private _destroy(grid: VoxelGrid, agent: Agent, dt: number, buf: Float32Array): void {
    const base = this._base(grid, agent.x, agent.y, agent.z);
    const stolenE = Math.min(15 * dt * 60, buf[base + F.ENERGY]);
    buf[base + F.ENERGY]  = Math.max(0, buf[base + F.ENERGY] - stolenE);
    buf[base + F.ENTROPY] = Math.min(1, buf[base + F.ENTROPY] + 0.03 * dt * 60);
    agent.energy = Math.min(500, agent.energy + stolenE * 0.7);
    // Destroyers roam randomly
    if (agent.age % 3 === 0) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      const [dx,dy] = dirs[Math.floor(this._random()*4)];
      const nx = Math.max(0, Math.min(grid.W-1, agent.x+dx));
      const ny = Math.max(0, Math.min(grid.H-1, agent.y+dy));
      if (nx !== agent.x || ny !== agent.y) {
        buf[this._base(grid, agent.x, agent.y, agent.z) + F.AGENT_MARK] = 0;
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

  clear(): void {
    this.agents.clear();
    this._nextAgentId = 1;
    this._rngState = this.initialRngState;
  }
}
