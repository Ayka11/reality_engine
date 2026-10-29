import { DirectorGoal } from './AIDirector';

export interface ExecutionPlan {
  name: string;
  steps: Array<any>;
}

export class DirectorBrain {
  constructor(private llm?: any) {}

  async createPlan(goal: DirectorGoal): Promise<ExecutionPlan> {
    // Simple rule-based planner as MVP. Maps keywords to steps.
    // reference llm to avoid unused private error
    if (this.llm) { /* provider available */ }
    const steps: any[] = [];

    if (/sculpt|ocean|basin|terrain/i.test(goal.description)) {
      steps.push({ type: 'sculpt_region', brushParams: { style: goal.style } });
    }

    if (/crystal|seed|resource/i.test(goal.description)) {
      steps.push({ type: 'modify_graph', changes: [{ op: 'add', node: { type: 'crystal_seed' } }] });
    }

    if (/language|swarm|intelligence/i.test(goal.description)) {
      steps.push({ type: 'evolve_laws', region: null, intensity: 'high' });
      steps.push({ type: 'run_simulation', ticks: Math.max(1, Math.floor(goal.timeHorizon / 1000)) });
    }

    // always save a snapshot at the end of a campaign phase
    steps.push({ type: 'save_snapshot', name: `campaign-${Date.now()}` });

    return { name: `Plan for: ${goal.description.slice(0, 40)}`, steps };
  }
}
