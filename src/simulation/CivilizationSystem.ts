import { VoxelGrid } from '../core/VoxelGrid';
import { CELL_FIELDS, F } from '../core/CellState';

export interface Civilization {
  id: number;
  name: string;
  color: [number, number, number];
  origin: [number, number, number];
  territory: number[];
  techLevel: number;
  population: number;
  energy: number;
  age: number;
  diplomacy: Record<number, 'neutral' | 'ally' | 'war'>;
  history: string[];
}

const CIV_NAMES = [
  'Azurians','Terrex','Synthis','Voidborn','Aurex','Corion',
  'Nexali','Biolum','Crystas','Emberkin','Deepweld','Starfall',
];
const MAX_CIVS = 12;
const BIO_THRESH = 0.35;

export class CivilizationSystem {
  private grid: VoxelGrid;
  civs: Civilization[] = [];
  private nextId = 0;
  private tickCount = 0;
  historyLog: string[] = [];

  constructor(grid: VoxelGrid) {
    this.grid = grid;
  }

  tick(): void {
    if (++this.tickCount % 20 !== 0) return;
    this._trySpawn();
    for (const civ of this.civs) {
      this._grow(civ);
      this._expand(civ);
      this._techResearch(civ);
    }
    this._diplomacy();
    this._prune();
  }

  private _enc(x: number, y: number, z: number): number {
    const { W, H } = this.grid;
    return z * H * W + y * W + x;
  }

  private _dec(enc: number): [number, number, number] {
    const { W, H } = this.grid;
    const z = Math.floor(enc / (H * W));
    const r = enc % (H * W);
    return [r % W, Math.floor(r / W), z];
  }

  private _trySpawn(): void {
    if (this.civs.length >= MAX_CIVS) return;
    const { grid } = this;
    const { W, H, D } = grid;
    const buf = grid.buffer;
    const occupied = new Set<number>();
    for (const c of this.civs) c.territory.forEach(t => occupied.add(t));

    let bestVal = BIO_THRESH, bx = -1, by = -1, bz = -1;
    for (let _ = 0; _ < 300; _++) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H);
      const z = Math.floor(Math.random() * D);
      if (occupied.has(this._enc(x, y, z))) continue;
      const bio = buf[(z * H * W + y * W + x) * CELL_FIELDS + F.BIO_POTENTIAL];
      if (bio > bestVal) { bestVal = bio; bx = x; by = y; bz = z; }
    }
    if (bx < 0) return;

    const id = this.nextId++;
    const h = (id * 137.5) % 360;
    const toRGB = (deg: number) => Math.max(0, Math.min(1, 0.5 + 0.5 * Math.cos((deg * Math.PI) / 180)));
    const civ: Civilization = {
      id, name: CIV_NAMES[id % CIV_NAMES.length],
      color: [toRGB(h), toRGB(h + 120), toRGB(h + 240)],
      origin: [bx, by, bz],
      territory: [this._enc(bx, by, bz)],
      techLevel: 0, population: 10, energy: 100, age: 0,
      diplomacy: {},
      history: [`t:${this.tickCount} Founded at (${bx},${by},${bz})`],
    };
    this.civs.push(civ);
    this._log(`${civ.name} founded`);
  }

  private _grow(civ: Civilization): void {
    const { grid } = this;
    const { W, H } = grid;
    const buf = grid.buffer;
    let totalBio = 0;
    for (const enc of civ.territory) {
      const [x, y, z] = this._dec(enc);
      const idx = (z * H * W + y * W + x) * CELL_FIELDS;
      totalBio  += buf[idx + F.BIO_POTENTIAL];
      civ.energy += buf[idx + F.ENERGY] * 0.00005;
    }
    civ.population = Math.min(10000, civ.population * (1 + totalBio * 0.000005));
    civ.energy     = Math.max(0, civ.energy - civ.population * 0.0005);
    civ.age++;
  }

  private _expand(civ: Civilization): void {
    if (civ.territory.length > 200 + civ.techLevel * 40) return;
    if (civ.energy < 10) return;
    const { grid } = this;
    const { W, H, D } = grid;
    const occupied = new Set<number>();
    for (const c of this.civs) c.territory.forEach(t => occupied.add(t));

    const src = civ.territory[Math.floor(Math.random() * civ.territory.length)];
    const [x, y, z] = this._dec(src);
    const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const [dx, dy, dz] = dirs[Math.floor(Math.random() * dirs.length)];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H || nz < 0 || nz >= D) return;
    const enc = this._enc(nx, ny, nz);
    if (occupied.has(enc)) return;
    civ.territory.push(enc);
    civ.energy -= 3;
  }

  private _techResearch(civ: Civilization): void {
    if (civ.energy > 150 && civ.population > 30 && civ.techLevel < 10) {
      if (Math.random() < 0.005) {
        civ.techLevel = Math.min(10, civ.techLevel + 1);
        civ.history.push(`t:${this.tickCount} Tech level ${civ.techLevel}`);
        this._log(`${civ.name} tech ${civ.techLevel}`);
      }
    }
  }

  private _diplomacy(): void {
    if (this.civs.length < 2) return;
    const a = this.civs[Math.floor(Math.random() * this.civs.length)];
    const b = this.civs[Math.floor(Math.random() * this.civs.length)];
    if (a.id === b.id) return;
    const cur = a.diplomacy[b.id] ?? 'neutral';
    const aSet = new Set(a.territory);
    const overlap = b.territory.filter(t => aSet.has(t)).length;
    if (overlap > 5 && cur !== 'war' && Math.random() < 0.12) {
      a.diplomacy[b.id] = b.diplomacy[a.id] = 'war';
      this._log(`${a.name} ⚔ ${b.name}`);
    } else if (overlap === 0 && cur === 'neutral' && Math.random() < 0.04) {
      a.diplomacy[b.id] = b.diplomacy[a.id] = 'ally';
      this._log(`${a.name} + ${b.name} ally`);
    } else if (cur === 'war' && Math.random() < 0.02) {
      a.diplomacy[b.id] = b.diplomacy[a.id] = 'neutral';
      this._log(`${a.name} peace ${b.name}`);
    }
  }

  private _prune(): void {
    const before = this.civs.length;
    this.civs = this.civs.filter(c => c.population >= 1 && (c.energy > 0 || c.age < 10));
    if (this.civs.length < before) this._log(`${before - this.civs.length} civ(s) collapsed`);
  }

  private _log(msg: string): void {
    this.historyLog.unshift(`t:${this.tickCount} ${msg}`);
    if (this.historyLog.length > 60) this.historyLog.pop();
  }

  seedFromGrid(): void {
    this.civs = [];
    this.nextId = 0;
    for (let _ = 0; _ < 40; _++) this._trySpawn();
  }
}
