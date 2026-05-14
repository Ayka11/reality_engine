import { SimulationEngine } from '../simulation/SimulationEngine';
import { CivilizationSystem } from '../simulation/CivilizationSystem';
import { F } from '../core/CellState';

export interface HealthAlert { level: 'critical' | 'warn' | 'info' | 'success'; msg: string; }
export interface HealthData {
  stability: number;
  emergencePot: number;
  extinctionRisk: number;
  mutationActivity: number;
  complexity: number;
  alerts: HealthAlert[];
  agents: number;
  civs: number;
  avgEntropy: string;
  avgBio: string;
  avgInfo: string;
}

export class WorldHealth {
  constructor(
    private sim: SimulationEngine,
    private civSystem: CivilizationSystem | null = null
  ) {}

  compute(): HealthData {
    const { grid } = this.sim;
    const SZ = grid.size;
    const totE  = grid.totalField(F.ENERGY);
    const totS  = grid.totalField(F.ENTROPY);
    const totI  = grid.totalField(F.INFORMATION);
    const totB  = grid.totalField(F.BIO_POTENTIAL);

    const avgS = totS / SZ;
    const avgB = totB / SZ;
    const avgI = totI / SZ;
    const avgE = totE / SZ;

    const agentArr  = this.sim.agents.getAgents();
    const agents    = agentArr.length;
    const civs      = this.civSystem?.civs?.length ?? 0;

    const stability      = Math.round((1 - avgS) * 100);
    const emergencePot   = Math.min(100, Math.round((avgB * 50 + avgI / 10 + avgE / 20) * (1 - avgS)));
    const extinctionRisk = Math.round(Math.max(0, avgS * 100 - 20));
    const mutationActivity = agents > 0
      ? Math.round(agentArr.filter(a => a.energy > 200).length / agents * 100)
      : 0;
    const complexity = Math.round((avgI / 100 + avgB * 5) * (1 - avgS) * 100) / 100;

    const alerts: HealthAlert[] = [];
    if (avgS > 0.7)                              alerts.push({ level:'critical', msg:'Entropy Critical — order collapsing' });
    else if (avgS > 0.5)                         alerts.push({ level:'warn',    msg:'High entropy — structures at risk' });
    if (avgB < 0.05 && this.sim.tick > 200)      alerts.push({ level:'warn',    msg:'Life Collapse Risk — bio potential very low' });
    if (avgE < 10)                               alerts.push({ level:'info',    msg:'Energy Depletion — world going cold' });
    if (avgI > 300)                              alerts.push({ level:'info',    msg:'Information Saturation — consider more entropy' });
    if (agents > 50)                             alerts.push({ level:'info',    msg:'Population Boom — agent density high' });
    if (complexity > 3)                          alerts.push({ level:'success', msg:'Complexity ↑ — emergence detected' });
    if (civs > 5)                               alerts.push({ level:'success', msg:`Civilization Expansion — ${civs} civs active` });

    return {
      stability, emergencePot, extinctionRisk, mutationActivity,
      complexity, alerts, agents, civs,
      avgEntropy: avgS.toFixed(4),
      avgBio:     avgB.toFixed(3),
      avgInfo:    avgI.toFixed(1),
    };
  }

  static semanticEntropy(s: number): { label: string; color: string } {
    if (s < 0.05) return { label:'Frozen',    color:'#6080ff' };
    if (s < 0.15) return { label:'Ordered',   color:'#40c060' };
    if (s < 0.35) return { label:'Dynamic',   color:'#e0c030' };
    if (s < 0.6)  return { label:'Turbulent', color:'#e06030' };
    if (s < 0.8)  return { label:'Chaotic',   color:'#e04040' };
    return               { label:'Collapsing',color:'#ff2020' };
  }
  static semanticBio(b: number): { label: string; color: string } {
    if (b < 0.05) return { label:'Barren',      color:'#555' };
    if (b < 0.2)  return { label:'Sparse life', color:'#608060' };
    if (b < 0.5)  return { label:'Fertile',     color:'#40c060' };
    if (b < 0.8)  return { label:'Thriving',    color:'#20e060' };
    return               { label:'Dominant',    color:'#00ff80' };
  }
  static semanticEnergy(e: number): { label: string; color: string } {
    if (e < 20)   return { label:'Dead',       color:'#333' };
    if (e < 100)  return { label:'Low energy', color:'#446' };
    if (e < 300)  return { label:'Active',     color:'#6080ff' };
    if (e < 600)  return { label:'Energetic',  color:'#ef8030' };
    return               { label:'Volcanic',   color:'#ff4020' };
  }
}
