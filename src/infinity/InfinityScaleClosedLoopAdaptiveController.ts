import type { InfinityScalePredictiveAdaptiveInput, InfinityScalePredictiveAdaptiveRecommendation } from "./InfinityScalePredictiveAdaptiveController";
import { InfinityScalePredictiveAdaptiveController } from "./InfinityScalePredictiveAdaptiveController";
import type { InfinityScaleAdaptiveFeedbackSample } from "./InfinityScaleAdaptiveFeedbackLoop";
import { InfinityScaleRuntimePredictionFeedback } from "./InfinityScaleRuntimePredictionFeedback";

export interface InfinityScaleClosedLoopAdaptiveInput extends InfinityScalePredictiveAdaptiveInput {
  runtimeError: number;
}

export interface InfinityScaleClosedLoopAdaptiveRecommendation extends InfinityScalePredictiveAdaptiveRecommendation {
  feedbackPrediction: ReturnType<InfinityScaleRuntimePredictionFeedback["observeError"]>;
}

export class InfinityScaleClosedLoopAdaptiveController {
  private readonly controller: InfinityScalePredictiveAdaptiveController;
  private readonly feedback: InfinityScaleRuntimePredictionFeedback;

  constructor(options: {
    controller?: InfinityScalePredictiveAdaptiveController;
    feedback?: InfinityScaleRuntimePredictionFeedback;
  } = {}) {
    this.controller = options.controller ?? new InfinityScalePredictiveAdaptiveController();
    this.feedback = options.feedback ?? new InfinityScaleRuntimePredictionFeedback();
  }

  observeAndRecommend(input: InfinityScaleClosedLoopAdaptiveInput): InfinityScaleClosedLoopAdaptiveRecommendation {
    const feedbackPrediction = this.feedback.observeError(
      input.regionId,
      input.epoch,
      input.runtimeError,
      1,
    );
    const recommendation = this.controller.recommend({
      ...input,
      error: input.runtimeError,
    });
    return { ...recommendation, feedbackPrediction };
  }

  getFeedbackState(regionId: string) {
    return this.feedback.state(regionId);
  }
}
