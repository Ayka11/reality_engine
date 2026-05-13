import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';
import { MAT } from '../materials/MaterialDef';
import { CHEM } from '../chemistry/ChemLayer';

export type EventType =
  | 'meteor_strike'
  | 'solar_flare'
  | 'radiation_storm'
  | 'mutation_wave'
  | 'entropy_collapse'
  | 'tectonic_shift';

export interface WorldEvent {
  type: EventType;
  tick: number;
  label: string;
  description: string;
}

const EVENT_LABELS: Record<EventType, string> = {
  meteor_strike:    'Meteor Strike',
  solar_flare:      'Solar Flare',
  radiation_storm:  'Radiation Storm',
  mutation_wave:    'Mutation Wave',
  entropy_collapse: 'Entropy Collapse',
  tectonic_shift:   'Tectonic Shift',
};

const EVENT_DESC: Record<EventType, string> = {
  meteor_strike:    'High-energy impact at random location.',
  solar_flare:      'Burst of radiation energy across the top layers.',
  radiation_storm:  'Radiation increases entropy across all cells.',
  mutation_wave:    'Bio-potential surges — existing life mutates.',
  entropy_collapse: 'Local entropy drop — order crystallizes.',
  tectonic_shift:   'Density redistribution — layers shift.',
};

export class WorldEvents {
  private history: WorldEvent[] = [];
  private _nextAuto = 600; // ticks until next random event

  trigger(grid: VoxelGrid, type: EventType, tick: number): WorldEvent {
    switch (type) {
      case 'meteor_strike':    this._meteorStrike(grid);    break;
      case 'solar_flare':      this._solarFlare(grid);      break;
      case 'radiation_storm':  this._radiationStorm(grid);  break;
      case 'mutation_wave':    this._mutationWave(grid);    break;
      case 'entropy_collapse': this._entropyCollapse(grid); break;
      case 'tectonic_shift':   this._tectonicShift(grid);  break;
    }
    const ev: WorldEvent = {
      type, tick,
      label: EVENT_LABELS[type],
      description: EVENT_DESC[type],
    };
    this.history.unshift(ev);
    if (this.history.length > 20) this.history.pop();
    return ev;
  }

  // Fires random events at intervals — call from SimulationEngine.step()
  autoTick(grid: VoxelGrid, tick: number): WorldEvent | null {
    this._nextAuto--;
    if (this._nextAuto > 0) return null;
    // Randomize next interval: 400..1200 ticks
    this._nextAuto = 400 + Math.floor(Math.random() * 800);
    const types: EventType[] = [
      'meteor_strike','solar_flare','radiation_storm',
      'mutation_wave','entropy_collapse','tectonic_shift',
    ];
    const type = types[Math.floor(Math.random() * types.length)];
    return this.trigger(grid, type, tick);
  }

  recent(n: number): WorldEvent[] { return this.history.slice(0, n); }

  // ── Event implementations ─────────────────────────────────────────────────

  private _meteorStrike(grid: VoxelGrid) {
    const ix = Math.floor(Math.random() * grid.W);
    const iy = Math.floor(Math.random() * grid.H);
    const iz = grid.D - 1;
    for (let dz = -4; dz <= 4; dz++)
    for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const d = Math.sqrt(dx*dx+dy*dy+dz*dz);
      if (d > 5 || !grid.inBounds(ix+dx,iy+dy,iz+dz)) continue;
      const cell = grid.cell(ix+dx, iy+dy, iz+dz);
      const g = 1 - d/5;
      cell.energy      = Math.min(9999, cell.energy + 3000*g);
      cell.temperature = Math.min(9999, cell.temperature + 2000*g);
      cell.entropy     = Math.min(1, cell.entropy + 0.4*g);
      cell.density     = Math.min(1, cell.density + 0.5*g);
      cell.materialId  = MAT.MAGMA;
      cell.set(F.CHEM_STATE, CHEM.LIQUID);
    }
  }

  private _solarFlare(grid: VoxelGrid) {
    const topLayers = Math.floor(grid.D * 0.3);
    for (let z = grid.D - topLayers; z < grid.D; z++)
    for (let y = 0; y < grid.H; y++)
    for (let x = 0; x < grid.W; x++) {
      const cell = grid.cell(x, y, z);
      cell.energy      = Math.min(9999, cell.energy + 200 + Math.random()*300);
      cell.temperature = Math.min(9999, cell.temperature + 150 + Math.random()*200);
      cell.entropy     = Math.min(1, cell.entropy + 0.05 + Math.random()*0.1);
    }
  }

  private _radiationStorm(grid: VoxelGrid) {
    const n = grid.size;
    for (let i = 0; i < n; i++) {
      const cell = grid.cellAt(i);
      cell.entropy     = Math.min(1, cell.entropy + 0.02 + Math.random()*0.04);
      cell.energy      = Math.min(9999, cell.energy + Math.random()*30);
      cell.temperature = Math.min(9999, cell.temperature + Math.random()*20);
    }
  }

  private _mutationWave(grid: VoxelGrid) {
    const n = grid.size;
    for (let i = 0; i < n; i++) {
      const cell = grid.cellAt(i);
      if (cell.bioPotential > 0.1) {
        cell.bioPotential = Math.min(1, cell.bioPotential + 0.15 + Math.random()*0.2);
        cell.information  = Math.min(999, cell.information + 30 + Math.random()*50);
        cell.set(F.CHEM_STATE, CHEM.ORGANIC);
      }
    }
  }

  private _entropyCollapse(grid: VoxelGrid) {
    // Random region — entropy drops sharply, crystallization occurs
    const cx = Math.floor(4 + Math.random()*(grid.W-8));
    const cy = Math.floor(4 + Math.random()*(grid.H-8));
    const cz = Math.floor(Math.random()*grid.D);
    for (let dz=-6;dz<=6;dz++) for (let dy=-6;dy<=6;dy++) for (let dx=-6;dx<=6;dx++) {
      if (dx*dx+dy*dy+dz*dz>36 || !grid.inBounds(cx+dx,cy+dy,cz+dz)) continue;
      const cell = grid.cell(cx+dx,cy+dy,cz+dz);
      cell.entropy  = Math.max(0, cell.entropy  - 0.3 - Math.random()*0.2);
      cell.density  = Math.min(1, cell.density  + 0.1);
      cell.set(F.CHEM_STATE, CHEM.SOLID);
      cell.materialId = MAT.CRYSTAL;
    }
  }

  private _tectonicShift(grid: VoxelGrid) {
    // Shear a horizontal slice — shift density and energy by one column
    const shiftZ = Math.floor(Math.random() * grid.D);
    const shift  = Math.random() < 0.5 ? 1 : -1;
    for (let y = 0; y < grid.H; y++) {
      const srcX = shift > 0 ? grid.W - 1 : 0;
      const srcCell = grid.cell(srcX, y, shiftZ);
      const savedE = srcCell.energy, savedD = srcCell.density;
      for (let x = grid.W - 1; x >= 0; x--) {
        const nx = x + shift;
        if (!grid.inBounds(nx, y, shiftZ)) continue;
        const src = grid.cell(x, y, shiftZ);
        const dst = grid.cell(nx, y, shiftZ);
        dst.energy  = src.energy;
        dst.density = src.density;
        dst.temperature = src.temperature;
        dst.materialId  = src.materialId;
      }
      // Fill vacated column
      const fillX = shift > 0 ? 0 : grid.W - 1;
      const fill = grid.cell(fillX, y, shiftZ);
      fill.energy = savedE * 0.5; fill.density = savedD * 0.5;
    }
  }
}
