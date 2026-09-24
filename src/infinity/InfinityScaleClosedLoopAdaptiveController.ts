import type { InfinityScalePredictiveAdaptiveInput, InfinityScalePredictiveAdaptiveRecommendation } from "./InfinityScalePredictiveAdaptiveController";
import { InfinityScalePredictiveAdaptiveController } from "./InfinityScalePredictiveAdaptiveController";
import type { InfinityScaleAdaptiveFeedbackSample } from "./InfinityScaleAdaptiveFeedbackLoop";
import { InfinityScaleRuntimePredictionFeedback, type InfinityScaleRuntimePredictionFeedback as RuntimePrediction } from "./InfinityScaleRuntimePredictionFeedback";

export interface InfinityScaleClosedLoopAdaptiveInput extends InfinityScalePredictiveAdaptiveInput {
  runtimeError: number;
}

export interface InfinityScaleClosedLoopAdaptiveRecommendation extends InfinityScalePredictiveAdaptiveRecommendation {
  feedbackPrediction: RuntimePrediction;
  transitionAdjustedError: number;
  transitionPenalty: number;
}

export interface InfinityScaleClosedLoopPostCommitInput {
  regionId: string;
  epoch: number;
  errorBefore: number;
  errorAfter: number;
  committed: boolean;
  topologyChanged: boolean;
}

export class InfinityScaleClosedLoopAdaptiveController {
  private readonly controller: InfinityScalePredictiveAdaptiveController;
  private readonly feedback: InfinityScaleRuntimePredictionFeedback;
  private readonly transitionState = new Map<string, { epoch: number; delta: number; penalty: number }>();

  constructor(options: {
    controller?: InfinityScalePredictiveAdaptiveController;
    feedback?: InfinityScaleRuntimePredictionFeedback;
  } = {}) {
    this.controller = options.controller ?? new InfinityScalePredictiveAdaptiveController();
    this.feedback = options.feedback ?? new InfinityScaleRuntimePredictionFeedback();
  }

  observeAndRecommend(input: InfinityScaleClosedLoopAdaptiveInput): InfinityScaleClosedLoopAdaptiveRecommendation {
    const transition = this.transitionState.get(input.regionId);
    const penalty = transition && input.epoch <= transition.epoch + 1 ? transition.penalty : 0;
    const transitionAdjustedError = clamp01(input.runtimeError + penalty);
    const feedbackPrediction = this.feedback.observeError(input.regionId, input.epoch, transitionAdjustedError, 1);
    const recommendation = this.controller.recommend({
      ...input,
      error: transitionAdjustedError,
    });
    return { ...recommendation, feedbackPrediction, transitionAdjustedError, transitionPenalty: penalty };
  }

  observePostCommit(input: InfinityScaleClosedLoopPostCommitInput): void {
    if (!Number.isFinite(input.errorBefore) || !Number.isFinite(input.errorAfter)) throw new Error("Post-commit errors must be finite");
    if (input.errorBefore < 0 || input.errorAfter < 0) throw new Error("Post-commit errors must be non-negative");
    const delta = input.errorAfter - input.errorBefore;
    const penalty = input.committed && input.topologyChanged ? Math.min(0.25, Math.abs(delta) * 0.5) : 0;
    this.transitionState.set(input.regionId, { epoch: input.epoch, delta, penalty });
  }

  getFeedbackState(regionId: string) {
    return this.feedback.state(regionId);
  }

  getTransitionState(regionId: string) {
    const state = this.transitionState.get(regionId);
    return state ? { ...state } : undefined;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
