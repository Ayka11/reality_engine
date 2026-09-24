import { InfinityScalePredictionEngine, type InfinityScalePredictionResult } from "./InfinityScalePredictionEngine";
import type { InfinityScaleAdaptiveFeedbackSample } from "./InfinityScaleAdaptiveFeedbackLoop";

export interface InfinityScaleRuntimePredictionFeedback {
  regionId: string;
  epoch: number;
  observedError: number;
  prediction: InfinityScalePredictionResult;
}

export class InfinityScaleRuntimePredictionFeedback {
  private readonly engine: InfinityScalePredictionEngine;

  constructor(engine = new InfinityScalePredictionEngine()) {
    this.engine = engine;
  }

  observe(sample: InfinityScaleAdaptiveFeedbackSample & { regionId?: string }): InfinityScaleRuntimePredictionFeedback {
    const regionId = sample.regionId ?? "global";
    this.engine.observe(regionId, sample.epoch, sample.error);
    const prediction = this.engine.predict(regionId, 1);
    return { regionId, epoch: sample.epoch, observedError: sample.error, prediction };
  }

  observeCausalError(regionId: string, epoch: number, physicalError: number, attribution: { numericalResidual?: number; transitionEffect?: number; transferEffect?: number; attributionHash?: string }, horizon = 1): InfinityScaleRuntimePredictionFeedback {\n    this.engine.observeCausal(regionId, epoch, physicalError, attribution);\n    return { regionId, epoch, observedError: physicalError, prediction: this.engine.predict(regionId, horizon) };\n  }\n\n  observeError(regionId: string, epoch: number, error: number, horizon = 1): InfinityScaleRuntimePredictionFeedback {
    this.engine.observe(regionId, epoch, error);
    return { regionId, epoch, observedError: error, prediction: this.engine.predict(regionId, horizon) };
  }

  state(regionId: string) {
    return this.engine.state(regionId);
  }

  reset(regionId: string): void {
    this.engine.reset(regionId);
  }
}
