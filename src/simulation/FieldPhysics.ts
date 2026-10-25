import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';
import { WORLD } from '../core/WorldConstants';
import { PhysicsParams } from '../laws/MetaLaw';
import { PROC } from '../process/ProcessDef';
import { getMutableBuffer } from '../core/TrackedFloat32Array';

function on(mask: number, proc: number) { return (mask & (1 << proc)) !== 0; }

export class FieldPhysics {
  tick(grid: VoxelGrid, dt: number, p: Readonly<PhysicsParams>, mask: number): void {
    const front = getMutableBuffer(grid);
    const back = getMutableBuffer(grid, 'back');
    const { W, H, D } = grid;

    for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const base = grid.idx(x, y, z);
      const cE = back[base + F.ENERGY];
      const cT = back[base + F.TEMPERATURE];
      const cD = back[base + F.DENSITY];
      const cI = back[base + F.INFORMATION];
      const nbrs = grid.neighbors6(x, y, z);
      const nCount = nbrs.length || 1;

      let lapE = -nCount * cE;
      let lapT = -nCount * cT;
      let lapD = -nCount * cD;
      let lapI = -nCount * cI;
      let fxSum = 0, fySum = 0, fzSum = 0;

      for (const [nx, ny, nz] of nbrs) {
        const nb = grid.idx(nx, ny, nz);
        lapE += back[nb + F.ENERGY];
        lapT += back[nb + F.TEMPERATURE];
        lapD += back[nb + F.DENSITY];
        lapI += back[nb + F.INFORMATION];
        fxSum += back[nb + F.FIELD_X];
        fySum += back[nb + F.FIELD_Y];
        fzSum += back[nb + F.FIELD_Z];
      }

      if (on(mask, PROC.ENERGY_DIFFUSION)) {
        front[base + F.ENERGY] = Math.min(WORLD.ENERGY_MAX,
          Math.max(0, cE + p.energyDiffusion * dt * lapE));
      }

      if (on(mask, PROC.TEMP_DIFFUSION)) {
        const heat = cE * p.tempEnergyCoupling * dt;
        front[base + F.TEMPERATURE] = Math.max(0, cT + p.tempDiffusion * dt * lapT + heat);
      }

      if (on(mask, PROC.DENSITY_FLOW)) {
        front[base + F.DENSITY] = Math.max(0, Math.min(1,
          cD + 0.02 * p.energyDiffusion * dt * lapD));
      }

      if (on(mask, PROC.GRAVITY)) {
        front[base + F.DENSITY] = Math.max(0, Math.min(1,
          front[base + F.DENSITY] + p.gravityDensityCoupling * back[base + F.GRAVITY_POT] * dt));
      }

      if (on(mask, PROC.PRESSURE_DIFFUSION)) {
        front[base + F.PRESSURE] = cD * p.pressureDensityCoupling - front[base + F.TEMPERATURE] * 0.1;
      }

      if (on(mask, PROC.WAVE_PROPAGATION)) {
        const phase = back[base + F.WAVE_PHASE];
        front[base + F.WAVE_PHASE] = (phase + p.waveSpeed * dt) % (2 * Math.PI);
        front[base + F.WAVE_AMP] = back[base + F.WAVE_AMP] * p.waveDamping;
      }

      if (on(mask, PROC.SIGNAL_PROPAGATION)) {
        front[base + F.INFORMATION] = Math.max(0, Math.min(999,
          cI + 0.06 * p.infoGrowthRate * dt * lapI));
      }

      if (on(mask, PROC.FIELD_ROTATION)) {
        front[base + F.FIELD_X] = back[base + F.FIELD_X] * 0.94 + fxSum / nCount * 0.05 + back[base + F.FIELD_Y] * 0.01;
        front[base + F.FIELD_Y] = back[base + F.FIELD_Y] * 0.94 + fySum / nCount * 0.05 - back[base + F.FIELD_X] * 0.01;
        front[base + F.FIELD_Z] = back[base + F.FIELD_Z] * 0.94 + fzSum / nCount * 0.05;
      } else {
        front[base + F.FIELD_X] = back[base + F.FIELD_X] * 0.95 + fxSum / nCount * 0.05;
        front[base + F.FIELD_Y] = back[base + F.FIELD_Y] * 0.95 + fySum / nCount * 0.05;
        front[base + F.FIELD_Z] = back[base + F.FIELD_Z] * 0.95 + fzSum / nCount * 0.05;
      }

      if (on(mask, PROC.PHASE_TRANSITION)) {
        if (cT > 500 && cD > 0.5) {
          front[base + F.DENSITY] = Math.max(0, front[base + F.DENSITY] - 0.008 * dt * 60);
          front[base + F.ENTROPY] = Math.min(1, front[base + F.ENTROPY] + 0.008 * dt * 60);
          front[base + F.INFORMATION] = Math.max(0, front[base + F.INFORMATION] - 3 * dt);
        } else if (cT < 40 && cD > 0.55) {
          front[base + F.DENSITY] = Math.min(1, front[base + F.DENSITY] + 0.004 * dt * 60);
          front[base + F.ENTROPY] = Math.max(0, front[base + F.ENTROPY] - 0.004 * dt * 60);
        }
      }

      if (on(mask, PROC.RADIATION)) {
        if (cE > 400) {
          front[base + F.DENSITY] = Math.max(0, front[base + F.DENSITY] - (cE - 400) * 0.00008 * dt * 60);
          front[base + F.ENERGY] = Math.max(0, front[base + F.ENERGY] - (cE - 400) * 0.0001 * dt * 60);
        }
      }

      if (on(mask, PROC.CRYSTALLIZATION)) {
        if (back[base + F.ENTROPY] < 0.18 && cD > 0.38) {
          front[base + F.DENSITY] = Math.min(1, front[base + F.DENSITY] + 0.003 * (0.18 - back[base + F.ENTROPY]) * dt * 60);
          front[base + F.ENTROPY] = Math.max(0, front[base + F.ENTROPY] - 0.0015 * dt * 60);
        }
      }
    }
  }
}
