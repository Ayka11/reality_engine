import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';
import { WORLD } from '../core/WorldConstants';
import { PhysicsParams } from '../laws/MetaLaw';
import { PROC } from '../process/ProcessDef';

function on(mask: number, proc: number) { return (mask & (1 << proc)) !== 0; }

export class FieldPhysics {
  tick(grid: VoxelGrid, dt: number, p: Readonly<PhysicsParams>, mask: number): void {
    const {W, H, D} = grid;

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const cell = grid.cell(x, y, z);
      const back = grid.cellBack(x, y, z);
      const nbrs = grid.neighbors6(x, y, z);
      const nCount = nbrs.length || 1;

      let lapE = -nCount * back.energy;
      let lapT = -nCount * back.temperature;
      let lapD = -nCount * back.density;
      let lapI = -nCount * back.information;
      let fxSum = 0, fySum = 0, fzSum = 0;

      for (const [nx, ny, nz] of nbrs) {
        const nb = grid.cellBack(nx, ny, nz);
        lapE += nb.energy;
        lapT += nb.temperature;
        lapD += nb.density;
        lapI += nb.information;
        fxSum += nb.get(F.FIELD_X);
        fySum += nb.get(F.FIELD_Y);
        fzSum += nb.get(F.FIELD_Z);
      }

      if (on(mask, PROC.ENERGY_DIFFUSION)) {
        cell.energy = Math.min(WORLD.ENERGY_MAX,
          Math.max(0, back.energy + p.energyDiffusion * dt * lapE));
      }

      if (on(mask, PROC.TEMP_DIFFUSION)) {
        const heat = back.energy * p.tempEnergyCoupling * dt;
        cell.temperature = Math.max(0, back.temperature + p.tempDiffusion * dt * lapT + heat);
      }

      if (on(mask, PROC.DENSITY_FLOW)) {
        cell.density = Math.max(0, Math.min(1,
          back.density + 0.02 * p.energyDiffusion * dt * lapD));
      }

      if (on(mask, PROC.GRAVITY)) {
        cell.density = Math.max(0, Math.min(1,
          cell.density + p.gravityDensityCoupling * back.get(F.GRAVITY_POT) * dt));
      }

      if (on(mask, PROC.PRESSURE_DIFFUSION)) {
        cell.pressure = back.density * p.pressureDensityCoupling - cell.temperature * 0.1;
      }

      if (on(mask, PROC.WAVE_PROPAGATION)) {
        const phase = back.get(F.WAVE_PHASE);
        cell.set(F.WAVE_PHASE, (phase + p.waveSpeed * dt) % (2 * Math.PI));
        cell.set(F.WAVE_AMP, back.get(F.WAVE_AMP) * p.waveDamping);
      }

      if (on(mask, PROC.SIGNAL_PROPAGATION)) {
        cell.information = Math.max(0, Math.min(999,
          back.information + 0.06 * p.infoGrowthRate * dt * lapI));
      }

      if (on(mask, PROC.FIELD_ROTATION)) {
        cell.set(F.FIELD_X, back.get(F.FIELD_X) * 0.94 + fxSum / nCount * 0.05 + back.get(F.FIELD_Y) * 0.01);
        cell.set(F.FIELD_Y, back.get(F.FIELD_Y) * 0.94 + fySum / nCount * 0.05 - back.get(F.FIELD_X) * 0.01);
        cell.set(F.FIELD_Z, back.get(F.FIELD_Z) * 0.94 + fzSum / nCount * 0.05);
      } else {
        cell.set(F.FIELD_X, back.get(F.FIELD_X) * 0.95 + fxSum / nCount * 0.05);
        cell.set(F.FIELD_Y, back.get(F.FIELD_Y) * 0.95 + fySum / nCount * 0.05);
        cell.set(F.FIELD_Z, back.get(F.FIELD_Z) * 0.95 + fzSum / nCount * 0.05);
      }

      if (on(mask, PROC.PHASE_TRANSITION)) {
        if (back.temperature > 500 && back.density > 0.5) {
          cell.density  = Math.max(0, cell.density - 0.008 * dt * 60);
          cell.entropy  = Math.min(1, cell.entropy + 0.008 * dt * 60);
          cell.information = Math.max(0, cell.information - 3 * dt);
        } else if (back.temperature < 40 && back.density > 0.55) {
          cell.density = Math.min(1, cell.density + 0.004 * dt * 60);
          cell.entropy = Math.max(0, cell.entropy - 0.004 * dt * 60);
        }
      }

      if (on(mask, PROC.RADIATION)) {
        if (back.energy > 400) {
          cell.density = Math.max(0, cell.density - (back.energy - 400) * 0.00008 * dt * 60);
          cell.energy  = Math.max(0, cell.energy  - (back.energy - 400) * 0.0001  * dt * 60);
        }
      }

      if (on(mask, PROC.CRYSTALLIZATION)) {
        if (back.entropy < 0.18 && back.density > 0.38) {
          cell.density = Math.min(1, cell.density + 0.003 * (0.18 - back.entropy) * dt * 60);
          cell.entropy = Math.max(0, cell.entropy - 0.0015 * dt * 60);
        }
      }
    }
  }
}
