export interface InfinityScaleResolutionGoal {
  goalId: string;
  name: string;
  fields: string[];
  minimumLOD: number;
  preferredLOD: number;
  maximumLOD: number;
  priority: number;
  accuracyTarget: number;
  regions?: string[];
}

export class InfinityScaleResolutionGoalRegistry {
  private readonly goals = new Map<string, InfinityScaleResolutionGoal>();

  register(goal: InfinityScaleResolutionGoal): void {
    validateGoal(goal);
    if (this.goals.has(goal.goalId)) {
      throw new Error(`Resolution goal already exists: ${goal.goalId}`);
    }
    this.goals.set(goal.goalId, { ...goal, fields: [...goal.fields], regions: goal.regions ? [...goal.regions] : undefined });
  }

  upsert(goal: InfinityScaleResolutionGoal): void {
    validateGoal(goal);
    this.goals.set(goal.goalId, { ...goal, fields: [...goal.fields], regions: goal.regions ? [...goal.regions] : undefined });
  }

  remove(goalId: string): boolean {
    return this.goals.delete(goalId);
  }

  get(goalId: string): InfinityScaleResolutionGoal | undefined {
    const goal = this.goals.get(goalId);
    return goal ? cloneGoal(goal) : undefined;
  }

  list(): InfinityScaleResolutionGoal[] {
    return [...this.goals.values()].map(cloneGoal);
  }

  relevance(regionId: string, field: string, currentLOD: number): number {
    let relevance = 0;
    for (const goal of this.goals.values()) {
      if (!goal.fields.includes(field)) continue;
      if (goal.regions && !goal.regions.includes(regionId)) continue;

      const lodDistance = Math.abs(goal.preferredLOD - currentLOD);
      const lodFit = 1 - Math.min(1, lodDistance / Math.max(1, goal.maximumLOD));
      const targetFit = currentLOD >= goal.minimumLOD ? 1 : currentLOD / Math.max(1, goal.minimumLOD);
      const contribution = goal.priority * Math.max(0, Math.min(1, 0.5 * lodFit + 0.5 * targetFit));
      relevance = Math.max(relevance, contribution);
    }
    return Math.max(0, Math.min(1, relevance));
  }
}

function validateGoal(goal: InfinityScaleResolutionGoal): void {
  if (!goal.goalId || !goal.name) throw new Error("Resolution goal requires goalId and name");
  if (!goal.fields.length) throw new Error("Resolution goal requires at least one field");
  if (![goal.minimumLOD, goal.preferredLOD, goal.maximumLOD].every(Number.isInteger)) {
    throw new Error("Resolution goal LOD bounds must be integers");
  }
  if (goal.minimumLOD < 0 || goal.minimumLOD > goal.preferredLOD || goal.preferredLOD > goal.maximumLOD) {
    throw new Error("Resolution goal LOD bounds are invalid");
  }
  if (!Number.isFinite(goal.priority) || goal.priority < 0) throw new Error("Resolution goal priority must be non-negative");
  if (!Number.isFinite(goal.accuracyTarget) || goal.accuracyTarget < 0 || goal.accuracyTarget > 1) {
    throw new Error("Resolution goal accuracyTarget must be in [0,1]");
  }
}

function cloneGoal(goal: InfinityScaleResolutionGoal): InfinityScaleResolutionGoal {
  return {
    ...goal,
    fields: [...goal.fields],
    regions: goal.regions ? [...goal.regions] : undefined,
  };
}
