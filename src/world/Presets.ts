import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';

export type PresetName = 'burst' | 'wave' | 'life' | 'vortex' | 'entropy_storm' | 'ecosystem' | 'clear';

export class Presets {
  static apply(grid: VoxelGrid, name: PresetName): void {
    grid.clear();
    switch (name) {
      case 'burst':         this._burst(grid); break;
      case 'wave':          this._wave(grid); break;
      case 'life':          this._life(grid); break;
      case 'vortex':        this._vortex(grid); break;
      case 'entropy_storm': this._entropyStorm(grid); break;
      case 'ecosystem':     this._ecosystem(grid); break;
      case 'clear':         break;
    }
  }

  private static _burst(grid: VoxelGrid) {
    const cx=grid.W/2, cy=grid.H/2, cz=grid.D/2;
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const d=Math.sqrt((x-cx)**2+(y-cy)**2+(z-cz)**2);
      if (d<8) {
        const cell=grid.cell(x,y,z);
        const g=Math.exp(-d*d/20);
        cell.energy=1000*g; cell.temperature=500*g; cell.density=0.8*g;
        cell.set(F.FIELD_X,(x-cx)*g*0.1); cell.set(F.FIELD_Y,(y-cy)*g*0.1);
      }
    }
  }

  private static _wave(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.energy=400+400*Math.sin(x*0.6)*Math.cos(y*0.4)*Math.sin(z*0.3+0.5);
      cell.temperature=200+200*Math.cos(x*0.3+y*0.3);
      cell.density=0.4+0.3*Math.sin(x*0.3+y*0.3);
      cell.set(F.WAVE_AMP, 200); cell.set(F.WAVE_PHASE, x*0.4+y*0.3);
    }
  }

  private static _life(grid: VoxelGrid) {
    for (let i=0;i<40;i++) {
      const x=Math.floor(6+Math.random()*(grid.W-12));
      const y=Math.floor(6+Math.random()*(grid.H-12));
      const z=Math.floor(grid.D*0.3+Math.random()*grid.D*0.4);
      const e=200+Math.random()*600;
      const cell=grid.cell(x,y,z);
      cell.energy=e; cell.density=0.3+Math.random()*0.6;
      cell.information=e*0.3; cell.temperature=100+Math.random()*200;
      cell.entropy=Math.random()*0.3;
    }
  }

  private static _vortex(grid: VoxelGrid) {
    const cx=grid.W/2, cy=grid.H/2;
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const dx=x-cx, dy=y-cy, d=Math.sqrt(dx*dx+dy*dy);
      if (d>2&&d<14) {
        const cell=grid.cell(x,y,z);
        const g=1-d/14;
        cell.energy=500*g; cell.density=0.5*g; cell.temperature=300*g;
        cell.set(F.FIELD_X,-dy/d*g*50); cell.set(F.FIELD_Y, dx/d*g*50);
      }
    }
  }

  private static _entropyStorm(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.energy=Math.random()*800; cell.entropy=0.3+Math.random()*0.6;
      cell.temperature=Math.random()*400; cell.density=Math.random()*0.8;
    }
  }

  private static _ecosystem(grid: VoxelGrid) {
    for (let z=0;z<3;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.density=0.7+Math.random()*0.3; cell.energy=50+Math.random()*100;
      cell.temperature=50+Math.random()*50;
    }
    for (let i=0;i<20;i++) {
      const x=Math.floor(Math.random()*grid.W), y=Math.floor(Math.random()*grid.H);
      const z=3+Math.floor(Math.random()*4);
      const cell=grid.cell(x,y,z);
      cell.energy=300+Math.random()*400; cell.density=0.4+Math.random()*0.4;
      cell.information=100+Math.random()*200; cell.bioPotential=0.5+Math.random()*0.4;
    }
  }
}
