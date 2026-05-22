import { VoxelGrid } from '../core/VoxelGrid';
import { F } from '../core/CellState';
import { MAT } from '../materials/MaterialDef';
import { CHEM } from '../chemistry/ChemLayer';
import { HeightmapImporter } from './HeightmapImporter';

export type PresetName =
  | 'burst' | 'wave' | 'life' | 'vortex' | 'entropy_storm' | 'ecosystem' | 'clear'
  // Phase 3.2 new presets
  | 'plasma_universe' | 'frozen_world' | 'high_gravity' | 'low_entropy_vacuum'
  | 'fungal_ecosystem' | 'ocean_biosphere' | 'toxic_ecosystem'
  | 'nebula' | 'proto_planet' | 'star_formation'
  | 'abandoned_megacity' | 'machine_ecology' | 'energy_economy'
  | 'self_replicating_field' | 'causality_collapse'
  | 'gaia' | 'world_machine_test';

export class Presets {
  static apply(grid: VoxelGrid, name: PresetName): void {
    grid.clear();
    switch (name) {
      case 'burst':                this._burst(grid);              break;
      case 'wave':                 this._wave(grid);               break;
      case 'life':                 this._life(grid);               break;
      case 'vortex':               this._vortex(grid);             break;
      case 'entropy_storm':        this._entropyStorm(grid);       break;
      case 'ecosystem':            this._ecosystem(grid);          break;
      case 'clear':                                                 break;
      // Phase 3.2
      case 'plasma_universe':      this._plasmaUniverse(grid);     break;
      case 'frozen_world':         this._frozenWorld(grid);        break;
      case 'high_gravity':         this._highGravity(grid);        break;
      case 'low_entropy_vacuum':   this._lowEntropyVacuum(grid);   break;
      case 'fungal_ecosystem':     this._fungalEcosystem(grid);    break;
      case 'ocean_biosphere':      this._oceanBiosphere(grid);     break;
      case 'toxic_ecosystem':      this._toxicEcosystem(grid);     break;
      case 'nebula':               this._nebula(grid);             break;
      case 'proto_planet':         this._protoPlanet(grid);        break;
      case 'star_formation':       this._starFormation(grid);      break;
      case 'abandoned_megacity':   this._abandonedMegacity(grid);  break;
      case 'machine_ecology':      this._machineEcology(grid);     break;
      case 'energy_economy':       this._energyEconomy(grid);      break;
      case 'self_replicating_field': this._selfReplicatingField(grid); break;
      case 'causality_collapse':   this._causalityCollapse(grid);  break;
      case 'gaia':                 this._gaia(grid);               break;
      case 'world_machine_test':   this._worldMachineTest(grid);   break;
    }
  }

  // ── Original presets ───────────────────────────────────────────────────────

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

  // ── Phase 3.2 — Cosmic / Physical Environments ────────────────────────────

  private static _plasmaUniverse(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.energy=2000+Math.random()*5000;
      cell.temperature=3000+Math.random()*6000;
      cell.density=0.05+Math.random()*0.15;
      cell.entropy=0.6+Math.random()*0.3;
      cell.materialId=MAT.PLASMA;
      cell.set(F.CHEM_STATE, CHEM.GAS);
    }
  }

  private static _frozenWorld(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      const isBase = z < 4;
      cell.density   = isBase ? 0.9+Math.random()*0.1 : 0.1+Math.random()*0.3;
      cell.temperature = 5+Math.random()*20;
      cell.energy    = 10+Math.random()*30;
      cell.entropy   = 0.01+Math.random()*0.05;
      cell.materialId = isBase ? MAT.ICE : MAT.VACUUM;
      cell.set(F.CHEM_STATE, isBase ? CHEM.SOLID : CHEM.GAS);
    }
  }

  private static _highGravity(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      const depth=z/grid.D;
      cell.density = 0.9-depth*0.4+Math.random()*0.05;
      cell.energy  = 100+depth*500+Math.random()*200;
      cell.temperature = 50+depth*800;
      cell.materialId = z < 2 ? MAT.METAL : z < 6 ? MAT.STONE : MAT.VACUUM;
    }
  }

  private static _lowEntropyVacuum(grid: VoxelGrid) {
    // Nearly empty universe — just a few seed energy clusters
    for (let i=0;i<8;i++) {
      const x=Math.floor(4+Math.random()*(grid.W-8));
      const y=Math.floor(4+Math.random()*(grid.H-8));
      const z=Math.floor(4+Math.random()*(grid.D-8));
      for (let dz=-2;dz<=2;dz++) for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
        if (!grid.inBounds(x+dx,y+dy,z+dz)) continue;
        const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
        const cell=grid.cell(x+dx,y+dy,z+dz);
        const g=Math.exp(-d);
        cell.energy=500*g; cell.information=100*g; cell.entropy=0.001;
      }
    }
  }

  // ── Biological Environments ────────────────────────────────────────────────

  private static _fungalEcosystem(grid: VoxelGrid) {
    // Dense mycelial network: organic + bio patches + signal threads
    for (let z=0;z<3;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.density=0.7; cell.energy=60; cell.temperature=30; cell.materialId=MAT.BIOMASS;
      cell.set(F.CHEM_STATE, CHEM.ORGANIC);
    }
    // Mycelial threads — sinusoidal paths
    for (let thread=0;thread<12;thread++) {
      const sx=Math.floor(Math.random()*grid.W);
      let y=Math.floor(Math.random()*grid.H), z=3;
      for (let x=sx;x<grid.W&&x>=0;x+=thread%2===0?1:-1) {
        if (!grid.inBounds(x,y,z)) break;
        const cell=grid.cell(x,y,z);
        cell.bioPotential=0.6+Math.random()*0.3; cell.information=80+Math.random()*120;
        cell.energy=200; cell.materialId=MAT.ORGANIC_TISSUE;
        cell.set(F.CHEM_STATE, CHEM.ORGANIC);
        cell.set(F.SIGNAL, 30+Math.random()*40);
        y=Math.max(0,Math.min(grid.H-1,y+(Math.random()<0.4?Math.round(Math.random()*2-1):0)));
        z=Math.max(3,Math.min(grid.D-1,z+(Math.random()<0.2?1:0)));
      }
    }
  }

  private static _oceanBiosphere(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      if (z < 12) {
        cell.density=0.8-z*0.03; cell.temperature=200-z*10; cell.energy=80+z*20;
        cell.materialId=MAT.VACUUM; cell.set(F.CHEM_STATE, CHEM.LIQUID);
      }
      if (z===0) { cell.density=0.95; cell.materialId=MAT.STONE; }
    }
    // Thermal vents
    for (let i=0;i<5;i++) {
      const vx=Math.floor(4+Math.random()*(grid.W-8));
      const vy=Math.floor(4+Math.random()*(grid.H-8));
      for (let z=0;z<8;z++) {
        const cell=grid.cell(vx,vy,z);
        cell.energy=400+z*50; cell.temperature=600+z*80;
        cell.bioPotential=0.7; cell.information=150;
        cell.materialId=MAT.ORGANIC_TISSUE; cell.set(F.CHEM_STATE, CHEM.ORGANIC);
      }
    }
  }

  private static _toxicEcosystem(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.entropy=0.4+Math.random()*0.4;
      cell.temperature=120+Math.random()*80;
      cell.density=0.2+Math.random()*0.3;
      cell.energy=100+Math.random()*200;
      cell.materialId=MAT.SPORES;
      cell.set(F.CHEM_STATE, CHEM.REACTIVE);
    }
    // Adapted survivors
    for (let i=0;i<15;i++) {
      const x=Math.floor(Math.random()*grid.W), y=Math.floor(Math.random()*grid.H);
      const cell=grid.cell(x,y,Math.floor(grid.D/2));
      cell.bioPotential=0.8; cell.information=200; cell.entropy=0.1;
      cell.materialId=MAT.MEMBRANE; cell.set(F.CHEM_STATE, CHEM.ORGANIC);
    }
  }

  // ── Astronomical Environments ─────────────────────────────────────────────

  private static _nebula(grid: VoxelGrid) {
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      const n=Math.sin(x*0.3)*Math.cos(y*0.25)*Math.sin(z*0.4+1.2);
      if (n > 0.1) {
        cell.energy=50+n*300; cell.density=0.05+n*0.2;
        cell.temperature=100+n*500; cell.entropy=0.1+n*0.3;
        cell.materialId=MAT.PLASMA; cell.set(F.CHEM_STATE, CHEM.GAS);
        cell.set(F.WAVE_AMP, n*100);
      }
    }
  }

  private static _protoPlanet(grid: VoxelGrid) {
    const cx=grid.W/2, cy=grid.H/2;
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const d=Math.sqrt((x-cx)**2+(y-cy)**2+(z*1.5)**2);
      if (d < 12) {
        const cell=grid.cell(x,y,z);
        const depth=1-d/12;
        cell.density=depth*0.9; cell.energy=depth*400; cell.temperature=depth*800;
        cell.materialId=d<4 ? MAT.METAL : d<8 ? MAT.STONE : MAT.SAND;
        cell.set(F.CHEM_STATE, d<4 ? CHEM.LIQUID : CHEM.SOLID);
      }
    }
  }

  private static _starFormation(grid: VoxelGrid) {
    // Molecular cloud with collapsing cores
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const cell=grid.cell(x,y,z);
      cell.density=0.01+Math.random()*0.05; cell.temperature=10+Math.random()*20;
      cell.energy=5+Math.random()*20; cell.materialId=MAT.PLASMA;
      cell.set(F.CHEM_STATE, CHEM.GAS);
    }
    // 3 collapsing cores
    for (let c=0;c<3;c++) {
      const cx=Math.floor(10+Math.random()*(grid.W-20));
      const cy=Math.floor(10+Math.random()*(grid.H-20));
      const cz=Math.floor(grid.D/2);
      for (let dz=-5;dz<=5;dz++) for (let dy=-5;dy<=5;dy++) for (let dx=-5;dx<=5;dx++) {
        const d=Math.sqrt(dx*dx+dy*dy+dz*dz);
        if (d>6 || !grid.inBounds(cx+dx,cy+dy,cz+dz)) continue;
        const cell=grid.cell(cx+dx,cy+dy,cz+dz);
        const g=1-d/6;
        cell.density=0.4*g; cell.energy=2000*g; cell.temperature=5000*g;
        cell.set(F.FIELD_X,-(dx/d||0)*g*20); cell.set(F.FIELD_Y,-(dy/d||0)*g*20);
      }
    }
  }

  // ── Civilizational / Technological Environments ───────────────────────────

  private static _abandonedMegacity(grid: VoxelGrid) {
    // Grid of structures with slow decay
    for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      const bldg = (x%8 < 5 && y%8 < 5); // block pattern
      if (!bldg) continue;
      const height = 2+Math.floor(Math.random()*8);
      for (let z=0;z<height;z++) {
        if (!grid.inBounds(x,y,z)) continue;
        const cell=grid.cell(x,y,z);
        cell.density=0.7+Math.random()*0.2; cell.energy=20+Math.random()*50;
        cell.temperature=15+Math.random()*10; cell.entropy=0.1+Math.random()*0.2;
        cell.information=50+Math.random()*100;
        cell.materialId = z===0 ? MAT.METAL : MAT.STONE;
        cell.set(F.CHEM_STATE, CHEM.SOLID);
      }
    }
  }

  private static _machineEcology(grid: VoxelGrid) {
    // Crystalline lattice machines converting energy → information
    for (let z=0;z<grid.D;z++) for (let y=0;y<grid.H;y++) for (let x=0;x<grid.W;x++) {
      if ((x+y+z)%3 === 0) {
        const cell=grid.cell(x,y,z);
        cell.density=0.8; cell.energy=100+Math.random()*200;
        cell.information=80+Math.random()*120; cell.entropy=0.05;
        cell.materialId=MAT.SUPERCONDUCTIVE_MATTER; cell.set(F.CHEM_STATE, CHEM.REACTIVE);
        cell.set(F.SIGNAL, 20);
      }
    }
  }

  private static _energyEconomy(grid: VoxelGrid) {
    // Producers (high energy) and consumers (high info) linked by signal channels
    for (let i=0;i<20;i++) {
      const px=Math.floor(Math.random()*grid.W), py=Math.floor(Math.random()*grid.H);
      const pz=Math.floor(Math.random()*grid.D);
      const isProducer = i < 10;
      for (let dz=-1;dz<=1;dz++) for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        if (!grid.inBounds(px+dx,py+dy,pz+dz)) continue;
        const cell=grid.cell(px+dx,py+dy,pz+dz);
        if (isProducer) {
          cell.energy=800+Math.random()*200; cell.temperature=200;
          cell.materialId=MAT.PLASMA; cell.set(F.CHEM_STATE, CHEM.REACTIVE);
        } else {
          cell.information=400+Math.random()*100; cell.bioPotential=0.9;
          cell.materialId=MAT.INFORMATION_SUBSTRATE; cell.set(F.CHEM_STATE, CHEM.ORGANIC);
        }
        cell.set(F.SIGNAL, 80);
      }
    }
  }

  // ── Exotic / Strange Environments ─────────────────────────────────────────

  private static _selfReplicatingField(grid: VoxelGrid) {
    // Sparse seeds of reactive+bio that should reproduce via EntityLayer
    for (let i=0;i<12;i++) {
      const x=Math.floor(4+Math.random()*(grid.W-8));
      const y=Math.floor(4+Math.random()*(grid.H-8));
      const z=Math.floor(grid.D*0.3+Math.random()*grid.D*0.4);
      for (let dz=-1;dz<=1;dz++) for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        if (!grid.inBounds(x+dx,y+dy,z+dz)) continue;
        const cell=grid.cell(x+dx,y+dy,z+dz);
        cell.bioPotential=0.8+Math.random()*0.2;
        cell.energy=400+Math.random()*300;
        cell.information=200+Math.random()*100;
        cell.entropy=0.05;
        cell.materialId=MAT.MEMBRANE;
        cell.set(F.CHEM_STATE, CHEM.ORGANIC);
      }
    }
  }

  private static _causalityCollapse(grid: VoxelGrid) {
    // Extreme energy spikes to flood causality log with events
    for (let i=0;i<30;i++) {
      const x=Math.floor(Math.random()*grid.W), y=Math.floor(Math.random()*grid.H);
      const z=Math.floor(Math.random()*grid.D);
      const cell=grid.cell(x,y,z);
      cell.energy=9000+Math.random()*999; cell.temperature=9000;
      cell.density=0.9; cell.entropy=0.95;
    }
  }

  private static _gaia(grid: VoxelGrid) {
    const cx=grid.W/2, cy=grid.H/2, cz=grid.D/2;
    for (let z=0; z<grid.D; z++) for (let y=0; y<grid.H; y++) for (let x=0; x<grid.W; x++) {
      const dx=x-cx, dy=y-cy, dz=z-cz;
      const d=Math.sqrt(dx*dx + dy*dy + dz*dz*2);
      const cell = grid.cell(x,y,z);

      if (d < 6) { // Core
        cell.energy = 800 * (1 - d/6);
        cell.temperature = 1200 * (1 - d/6);
        cell.density = 0.9;
        cell.materialId = MAT.METAL;
      } else if (d < 12) { // Mantle/Crust
        cell.energy = 200;
        cell.temperature = 400 * (1 - d/12);
        cell.density = 0.7;
        cell.materialId = MAT.STONE;
        if (d > 10.5) { // Surface
           if (Math.random() < 0.6) { // Ocean
             cell.density = 0.8;
             cell.set(F.CHEM_STATE, CHEM.LIQUID);
             cell.bioPotential = 0.3;
           } else { // Land
             cell.density = 0.6;
             cell.bioPotential = 0.6;
             cell.information = 50;
             cell.materialId = MAT.BIOMASS;
             cell.set(F.CHEM_STATE, CHEM.ORGANIC);
           }
        }
      } else if (d < 15) { // Atmosphere
        cell.density = 0.1 * (1 - d/15);
        cell.energy = 50;
        cell.information = 20 * (1 - d/15);
        cell.entropy = 0.05;
        cell.set(F.CHEM_STATE, CHEM.GAS);
      }
    }
  }

  private static _worldMachineTest(grid: VoxelGrid) {
    // Simulate an imported World Machine heightmap using procedural noise
    const width = grid.W, height = grid.H;
    const heightData = new Float32Array(width * height);
    const rockWeight = new Float32Array(width * height);
    const grassWeight = new Float32Array(width * height);
    const sandWeight = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
        const x = i % width, y = Math.floor(i / width);
        // Procedural mountain
        const d = Math.sqrt((x - width/2)**2 + (y - height/2)**2);
        const h = Math.max(0.1, 0.8 * Math.exp(-d*d / 200) + 0.1 * Math.random());
        heightData[i] = h;

        // Complex weight mapping
        if (h > 0.6) { rockWeight[i] = 1.0; }
        else if (h > 0.3) { grassWeight[i] = 1.0; }
        else { sandWeight[i] = 1.0; }
    }

    // Use the importer with multi-material support
    HeightmapImporter.importWithWeights(grid, heightData, width, height, {
      heightScale: grid.D * 0.8,
      weights: [
        { materialId: MAT.STONE, weight: rockWeight },
        { materialId: MAT.BIOMASS, weight: grassWeight },
        { materialId: MAT.SAND, weight: sandWeight }
      ]
    });
  }
}
