import { SimulationEngine } from '../simulation/SimulationEngine';

export interface ExplainLine { field: string; value: string; why: string; icon: string; }

export class Explainer {
  constructor(private sim: SimulationEngine) {}

  explain(x: number, y: number, z: number): ExplainLine[] {
    const { grid } = this.sim;
    const cell = grid.cell(x, y, z);
    const { W, H, D } = grid;
    const lines: ExplainLine[] = [];

    const E = cell.energy, T = cell.temperature, D_ = cell.density;
    const S = cell.entropy, I = cell.information, B = cell.bioPotential;
    const tau = cell.localTime;

    // Energy
    if (E > 500)       lines.push({ field:'Energy',      value:E.toFixed(0), icon:'⚡', why:'Very high — this zone is a major energy source. Actively diffusing to neighbors.' });
    else if (E > 100)  lines.push({ field:'Energy',      value:E.toFixed(0), icon:'⚡', why:'Moderate energy. Stable diffusion in progress.' });
    else if (E < 10)   lines.push({ field:'Energy',      value:E.toFixed(0), icon:'⚡', why:'Near-zero. Energy has been consumed or diffused away.' });
    else               lines.push({ field:'Energy',      value:E.toFixed(0), icon:'⚡', why:'Low but non-zero energy. Slowly dissipating.' });

    // Temperature
    if (T > 500)       lines.push({ field:'Temperature', value:T.toFixed(0), icon:'🌡️', why:'Plasma-level heat. Phase transitions active. Entropy rising fast.' });
    else if (T > 200)  lines.push({ field:'Temperature', value:T.toFixed(0), icon:'🌡️', why:'Very hot. Energy coupling is strong here.' });
    else if (T < 20)   lines.push({ field:'Temperature', value:T.toFixed(0), icon:'🌡️', why:'Near-freezing. Ice-like order possible. Low entropy.' });

    // Entropy with cause detection
    const enCauses: string[] = [];
    if (E > 200)       enCauses.push('high energy input');
    if (T > 300)       enCauses.push('thermal activity');
    const agents = this.sim.agents.getAgents();
    if (agents.some(a => a.x === x && a.y === y)) enCauses.push('agent metabolism');
    const cause = enCauses.length ? 'because of ' + enCauses.join(' + ') : 'from baseline disorder increase';
    if (S > 0.6)       lines.push({ field:'Entropy',     value:S.toFixed(3), icon:'🔥', why:`Critical — ${cause}. Structures here are decaying.` });
    else if (S > 0.3)  lines.push({ field:'Entropy',     value:S.toFixed(3), icon:'🔥', why:`Elevated ${cause}. Order is being eroded.` });
    else if (S < 0.1)  lines.push({ field:'Entropy',     value:S.toFixed(3), icon:'🔥', why:'Very low — ordered state. Possible crystal or ice structure.' });
    else               lines.push({ field:'Entropy',     value:S.toFixed(3), icon:'🔥', why:'Normal. Order and disorder in balance.' });

    // Information
    if (I > 300)                       lines.push({ field:'Information', value:I.toFixed(0), icon:'🧠', why:'High complexity. Information is self-sustaining here.' });
    else if (I > 50 && E > 80 && D_ > 0.2) lines.push({ field:'Information', value:I.toFixed(0), icon:'🧠', why:'Growing — energy + density threshold met. Biology possible.' });
    else if (I < 5)                    lines.push({ field:'Information', value:I.toFixed(0), icon:'🧠', why:'Near zero — entropy is suppressing information growth.' });
    else                               lines.push({ field:'Information', value:I.toFixed(0), icon:'🧠', why:'Moderate information present.' });

    // Bio potential
    if (B > 0.7)       lines.push({ field:'Bio potential', value:B.toFixed(2), icon:'🧬', why:'High — multiple life conditions met simultaneously.' });
    else if (B > 0.3)  lines.push({ field:'Bio potential', value:B.toFixed(2), icon:'🧬', why:'Moderate — partial conditions for life. Needs more info or energy.' });
    else               lines.push({ field:'Bio potential', value:B.toFixed(2), icon:'🧬', why:'Low — entropy or energy imbalance preventing biology.' });

    // Local time
    const timePct = this.sim.tick > 0 ? (tau / this.sim.tick * 100).toFixed(0) : '100';
    lines.push({ field:'Local τ', value:tau.toFixed(1), icon:'⏱️', why:`Time passes ${timePct}% of global rate here. High energy zones age faster.` });

    // Neighbor context
    const nbCtx: string[] = [];
    if (x > 0   && grid.cell(x-1, y, z).energy > E + 100) nbCtx.push('← high energy');
    if (x < W-1 && grid.cell(x+1, y, z).energy > E + 100) nbCtx.push('→ high energy');
    if (y > 0   && grid.cell(x, y-1, z).energy > E + 100) nbCtx.push('↑ high energy');
    if (y < H-1 && grid.cell(x, y+1, z).energy > E + 100) nbCtx.push('↓ high energy');
    if (z > 0   && grid.cell(x, y, z-1).energy > E + 100) nbCtx.push('⬆ high energy above');
    if (z < D-1 && grid.cell(x, y, z+1).energy > E + 100) nbCtx.push('⬇ high energy below');
    if (nbCtx.length) {
      lines.push({ field:'Context', value:'', icon:'💡', why:`Receiving energy from ${nbCtx.join(', ')}` });
    }

    return lines;
  }
}
