import { DirectorBrain } from './DirectorBrain';

export interface DirectorGoal {
  description: string;
  targetComplexity?: number;
  timeHorizon: number;
  constraints: string[];
  style: 'natural' | 'chaotic' | 'scientific' | 'cinematic' | 'extremal';
}

export interface ExecutionPlan {
  name: string;
  steps: Array<any>;
}

export class AIDirector {
  private brain: DirectorBrain;
  private currentCampaign: any = null;

  constructor(
    private grid: any,
    private graph: any,
    private lawEngine: any,
    private saveSystem: any,
    private sculptingManager?: any
  ) {
    this.brain = new DirectorBrain();
  }

  async executeGoal(goal: DirectorGoal) {
    const plan: ExecutionPlan = await this.brain.createPlan(goal);
      this.currentCampaign = plan;

    console.log('🎬 AI Director starting campaign:', plan.name);

    for (const step of plan.steps) {
      await this.executeStep(step);
      await this.evaluateProgress();
    }
  }

  private async executeStep(step: any) {
    switch (step.type) {
      case 'modify_graph':
        await this.applyGraphChanges(step.changes);
        break;
      case 'sculpt_region':
        if (this.sculptingManager?.applyProceduralBrush) {
          this.sculptingManager.applyProceduralBrush(step.brushParams);
        }
        break;
      case 'evolve_laws':
        if (this.lawEngine?.boostMutationInRegion) {
          this.lawEngine.boostMutationInRegion(step.region, step.intensity);
        }
        break;
      case 'run_simulation':
        await this.runSimulationTicks(step.ticks || 1);
        break;
      case 'save_snapshot':
        if (this.saveSystem?.quickSave) {
          await this.saveSystem.quickSave(step.name);
        }
        break;
      default:
        console.warn('Unknown director step type:', step.type);
    }
  }

  private async applyGraphChanges(changes: any) {
    if (!this.graph || !changes) return;
    for (const c of changes) {
      try {
        if (c.op === 'add') this.graph.addNode?.(c.node);
        if (c.op === 'update') this.graph.updateNode?.(c.nodeId, c.patch);
        if (c.op === 'remove') this.graph.removeNode?.(c.nodeId);
      } catch (e) {
        console.error('applyGraphChanges error', e);
      }
    }
  }

  private async runSimulationTicks(ticks: number) {
    for (let i = 0; i < ticks; i++) {
      await this.graph?.tick?.();
    }
  }

  private async evaluateProgress() {
    const metrics: any = {
      complexity: this.graph?.computeComplexity?.() ?? 0,
      gridSize: this.grid?.size ?? null,
      campaign: this.currentCampaign?.name ?? null,
    };
    console.log('Director progress metrics:', metrics);
  }
}
