export type AdaptiveLODDecision = "KEEP" | "REFINE" | "COARSEN" | "HOLD";

export interface InfinityScaleAdaptiveStabilityConfig {
  refineThreshold: number;
  coarsenThreshold: number;
  refineEvidenceEpochs: number;
  coarsenEvidenceEpochs: number;
  minResidenceEpochs: number;
  cooldownEpochs: number;
  oscillationWindow: number;
  oscillationTransitions: number;
  freezeEpochs: number;
  criticalThreshold: number;
}

export const DEFAULT_INFINITY_SCALE_ADAPTIVE_STABILITY: InfinityScaleAdaptiveStabilityConfig = {
  refineThreshold: 0.75,
  coarsenThreshold: 0.25,
  refineEvidenceEpochs: 2,
  coarsenEvidenceEpochs: 4,
  minResidenceEpochs: 4,
  cooldownEpochs: 3,
  oscillationWindow: 8,
  oscillationTransitions: 3,
  freezeEpochs: 8,
  criticalThreshold: 0.98,
};

export interface InfinityScaleAdaptiveMetrics {
  score: number;
  estimatedError?: number;
  conservationResidual?: number;
}

export interface InfinityScaleAdaptiveRegionState {
  regionId: string;
  currentLOD: number;
  candidateAction: AdaptiveLODDecision;
  consecutiveRefineVotes: number;
  consecutiveCoarsenVotes: number;
  lastMutationEpoch: number;
  residenceUntilEpoch: number;
  cooldownUntilEpoch: number;
  oscillationCount: number;
  decisionHistory: AdaptiveLODDecision[];
  frozenUntilEpoch: number;
}

export interface InfinityScaleAdaptiveDecision {
  regionId: string;
  epoch: number;
  decision: AdaptiveLODDecision;
  stabilityScore: number;
  hysteresisPassed: boolean;
  residencePassed: boolean;
  cooldownPassed: boolean;
  oscillationDetected: boolean;
  criticalOverride: boolean;
  reason: string;
}

export class InfinityScaleAdaptiveStability {
  private readonly config: InfinityScaleAdaptiveStabilityConfig;
  private readonly regions = new Map<string, InfinityScaleAdaptiveRegionState>();

  constructor(config: Partial<InfinityScaleAdaptiveStabilityConfig> = {}) {
    this.config = { ...DEFAULT_INFINITY_SCALE_ADAPTIVE_STABILITY, ...config };
    if (this.config.refineThreshold <= this.config.coarsenThreshold) {
      throw new Error("refineThreshold must be greater than coarsenThreshold");
    }
    if (this.config.refineEvidenceEpochs < 1 || this.config.coarsenEvidenceEpochs < 1) {
      throw new Error("Evidence epochs must be >= 1");
    }
    if (this.config.minResidenceEpochs < 0 || this.config.cooldownEpochs < 0) {
      throw new Error("Residence and cooldown epochs must be >= 0");
    }
  }

  state(regionId: string, currentLOD = 0): InfinityScaleAdaptiveRegionState {
    const existing = this.regions.get(regionId);
    if (existing) return cloneState(existing);
    const created: InfinityScaleAdaptiveRegionState = {
      regionId,
      currentLOD,
      candidateAction: "KEEP",
      consecutiveRefineVotes: 0,
      consecutiveCoarsenVotes: 0,
      lastMutationEpoch: -1,
      residenceUntilEpoch: -1,
      cooldownUntilEpoch: -1,
      oscillationCount: 0,
      decisionHistory: [],
      frozenUntilEpoch: -1,
    };
    this.regions.set(regionId, created);
    return cloneState(created);
  }

  decide(
    regionId: string,
    epoch: number,
    metrics: InfinityScaleAdaptiveMetrics,
    currentLOD = 0,
  ): InfinityScaleAdaptiveDecision {
    if (!Number.isFinite(metrics.score)) throw new Error("Adaptive score must be finite");
    if (!Number.isInteger(epoch) || epoch < 0) throw new Error("Epoch must be a non-negative integer");

    const state = this.regions.get(regionId) ?? this.create(regionId, currentLOD);
    if (state.currentLOD !== currentLOD) {
      throw new Error(`Adaptive LOD mismatch for ${regionId}: state=${state.currentLOD}, input=${currentLOD}`);
    }

    const score = Math.max(0, Math.min(1, metrics.score));
    const criticalOverride = score >= this.config.criticalThreshold ||
      Math.abs(metrics.estimatedError ?? 0) >= this.config.criticalThreshold;

    let candidate: AdaptiveLODDecision = "KEEP";
    if (score >= this.config.refineThreshold) candidate = "REFINE";
    else if (score <= this.config.coarsenThreshold && currentLOD > 0) candidate = "COARSEN";

    state.consecutiveRefineVotes = candidate === "REFINE" ? state.consecutiveRefineVotes + 1 : 0;
    state.consecutiveCoarsenVotes = candidate === "COARSEN" ? state.consecutiveCoarsenVotes + 1 : 0;
    state.candidateAction = candidate;

    const hysteresisPassed =
      candidate === "REFINE"
        ? state.consecutiveRefineVotes >= this.config.refineEvidenceEpochs
        : candidate === "COARSEN"
          ? state.consecutiveCoarsenVotes >= this.config.coarsenEvidenceEpochs
          : true;

    const residencePassed = epoch >= state.residenceUntilEpoch;
    const cooldownPassed = epoch >= state.cooldownUntilEpoch;
    const oscillationDetected = this.detectOscillation(state, candidate);

    if (epoch < state.frozenUntilEpoch && !criticalOverride) {
      return this.record(state, epoch, "HOLD", score, false, residencePassed, false, true, false,
        "adaptive region is frozen");
    }

    if (candidate === "KEEP" || !hysteresisPassed) {
      return this.record(state, epoch, "KEEP", score, hysteresisPassed, residencePassed, cooldownPassed,
        oscillationDetected, criticalOverride, "insufficient persistent evidence");
    }

    if (!criticalOverride && (!residencePassed || !cooldownPassed || oscillationDetected)) {
      if (oscillationDetected) state.frozenUntilEpoch = epoch + this.config.freezeEpochs;
      return this.record(state, epoch, "HOLD", score, true, residencePassed, cooldownPassed,
        oscillationDetected, false, oscillationDetected ? "LOD oscillation detected" : "stability constraint active");
    }

    const decision = candidate;
    state.currentLOD += decision === "REFINE" ? 1 : -1;
    state.lastMutationEpoch = epoch;
    state.residenceUntilEpoch = epoch + this.config.minResidenceEpochs;
    state.cooldownUntilEpoch = epoch + this.config.cooldownEpochs;
    state.consecutiveRefineVotes = 0;
    state.consecutiveCoarsenVotes = 0;
    state.oscillationCount = 0;
    state.decisionHistory.push(decision);
    trimHistory(state, this.config.oscillationWindow);

    return this.record(state, epoch, decision, score, true, true, true, false, criticalOverride,
      criticalOverride ? "critical override" : "persistent adaptive evidence");
  }

  stabilityScore(regionId: string, epoch: number): number {
    const state = this.regions.get(regionId);
    if (!state) return 1;
    const history = state.decisionHistory;
    const alternations = countAlternations(history);
    const temporal = history.length < 2 ? 1 : 1 - Math.min(1, alternations / (history.length - 1));
    const residence = state.lastMutationEpoch < 0
      ? 1
      : Math.min(1, Math.max(0, (epoch - state.lastMutationEpoch) / Math.max(1, this.config.minResidenceEpochs)));
    return Math.max(0, Math.min(1, temporal * residence));
  }

  private create(regionId: string, currentLOD: number): InfinityScaleAdaptiveRegionState {
    const state = this.state(regionId, currentLOD);
    return this.regions.get(regionId)!;
  }

  private detectOscillation(
    state: InfinityScaleAdaptiveRegionState,
    candidate: AdaptiveLODDecision,
  ): boolean {
    if (candidate === "KEEP" || state.decisionHistory.length === 0) return false;
    const recent = [...state.decisionHistory.slice(-(this.config.oscillationWindow - 1)), candidate];
    const alternations = countAlternations(recent);
    state.oscillationCount = alternations;
    return alternations >= this.config.oscillationTransitions;
  }

  private record(
    state: InfinityScaleAdaptiveRegionState,
    epoch: number,
    decision: AdaptiveLODDecision,
    score: number,
    hysteresisPassed: boolean,
    residencePassed: boolean,
    cooldownPassed: boolean,
    oscillationDetected: boolean,
    criticalOverride: boolean,
    reason: string,
  ): InfinityScaleAdaptiveDecision {
    if (decision !== "KEEP" && decision !== "HOLD") {
      state.decisionHistory.push(decision);
      trimHistory(state, this.config.oscillationWindow);
    }
    return {
      regionId: state.regionId,
      epoch,
      decision,
      stabilityScore: this.stabilityScore(state.regionId, epoch),
      hysteresisPassed,
      residencePassed,
      cooldownPassed,
      oscillationDetected,
      criticalOverride,
      reason,
    };
  }
}

function countAlternations(history: AdaptiveLODDecision[]): number {
  let count = 0;
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1];
    const b = history[i];
    if ((a === "REFINE" && b === "COARSEN") || (a === "COARSEN" && b === "REFINE")) count++;
  }
  return count;
}

function trimHistory(state: InfinityScaleAdaptiveRegionState, max: number): void {
  if (state.decisionHistory.length > max) {
    state.decisionHistory.splice(0, state.decisionHistory.length - max);
  }
}

function cloneState(state: InfinityScaleAdaptiveRegionState): InfinityScaleAdaptiveRegionState {
  return { ...state, decisionHistory: [...state.decisionHistory] };
}
