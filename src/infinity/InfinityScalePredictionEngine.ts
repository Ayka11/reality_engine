export interface InfinityScalePredictionSample {
  epoch: number;
  error: number;
  physicalError?: number;
  numericalResidual?: number;
  transitionEffect?: number;
  transferEffect?: number;
  attributionHash?: string;
}

export interface InfinityScalePredictionResult {
  predictedError: number;
  trend: number;
  acceleration: number;
  horizon: number;
  confidence: number;
  modelVersion: string;
}

export interface InfinityScalePredictiveState {
  regionId: string;
  samples: InfinityScalePredictionSample[];
  lastPredictionEpoch: number;
  lastResult?: InfinityScalePredictionResult;
}

export interface InfinityScalePredictionConfig {
  historyLength: number;
  minSamples: number;
  maxHorizon: number;
  confidenceResidualScale: number;
}

export const DEFAULT_INFINITY_SCALE_PREDICTION: InfinityScalePredictionConfig = {
  historyLength: 8,
  minSamples: 3,
  maxHorizon: 4,
  confidenceResidualScale: 0.25,
};

export class InfinityScalePredictionEngine {
  private readonly config: InfinityScalePredictionConfig;
  private readonly states = new Map<string, InfinityScalePredictiveState>();

  constructor(config: Partial<InfinityScalePredictionConfig> = {}) {
    this.config = { ...DEFAULT_INFINITY_SCALE_PREDICTION, ...config };
    if (this.config.historyLength < this.config.minSamples || this.config.minSamples < 2) {
      throw new Error("Prediction historyLength must be >= minSamples >= 2");
    }
    if (this.config.maxHorizon < 1) throw new Error("Prediction maxHorizon must be >= 1");
  }

  observe(regionId: string, epoch: number, error: number): InfinityScalePredictiveState {
    return this.record(regionId, epoch, error);
  }

  observeCausal(
    regionId: string,
    epoch: number,
    physicalError: number,
    attribution?: {
      numericalResidual?: number;
      transitionEffect?: number;
      transferEffect?: number;
      attributionHash?: string;
    },
  ): InfinityScalePredictiveState {
    return this.record(regionId, epoch, physicalError, attribution);
  }

  private record(
    regionId: string,
    epoch: number,
    error: number,
    attribution?: {
      numericalResidual?: number;
      transitionEffect?: number;
      transferEffect?: number;
      attributionHash?: string;
    },
  ): InfinityScalePredictiveState {
    if (!Number.isInteger(epoch) || epoch < 0) throw new Error("Prediction epoch must be non-negative");
    if (!Number.isFinite(error)) throw new Error("Prediction error must be finite");

    const state = this.states.get(regionId) ?? { regionId, samples: [], lastPredictionEpoch: -1 };
    const previous = state.samples[state.samples.length - 1];
    if (previous && epoch <= previous.epoch) throw new Error(`Prediction samples must be strictly increasing for ${regionId}`);

    state.samples.push({
      epoch,
      error: clamp01(error),
      physicalError: clamp01(error),
      numericalResidual: attribution?.numericalResidual,
      transitionEffect: attribution?.transitionEffect,
      transferEffect: attribution?.transferEffect,
      attributionHash: attribution?.attributionHash,
    });
    if (state.samples.length > this.config.historyLength) state.samples.splice(0, state.samples.length - this.config.historyLength);
    this.states.set(regionId, state);
    return cloneState(state);
  }

  predict(regionId: string, horizon = 1): InfinityScalePredictionResult {
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > this.config.maxHorizon) {
      throw new Error(`Prediction horizon must be in [1, ${this.config.maxHorizon}]`);
    }

    const state = this.states.get(regionId);
    if (!state || state.samples.length < this.config.minSamples) {
      const result = {
        predictedError: state?.samples.at(-1)?.physicalError ?? state?.samples.at(-1)?.error ?? 0,
        trend: 0,
        acceleration: 0,
        horizon,
        confidence: 0,
        modelVersion: "causal-linear-quadratic-v2",
      };
      if (state) {
        state.lastPredictionEpoch = state.samples.at(-1)?.epoch ?? -1;
        state.lastResult = result;
      }
      return result;
    }

    const samples = state.samples;
    const value = (sample: InfinityScalePredictionSample) => sample.physicalError ?? sample.error;
    const last = samples[samples.length - 1];
    const previous = samples[samples.length - 2];
    const trend = (value(last) - value(previous)) / Math.max(1, last.epoch - previous.epoch);

    let acceleration = 0;
    if (samples.length >= 3) {
      const before = samples[samples.length - 3];
      const previousTrend = (value(previous) - value(before)) / Math.max(1, previous.epoch - before.epoch);
      acceleration = trend - previousTrend;
    }

    const predictedError = clamp01(value(last) + horizon * trend + 0.5 * horizon * horizon * acceleration);
    const residuals: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = samples[i].epoch - samples[i - 1].epoch;
      const predicted = clamp01(value(samples[i - 1]) + trend * dt + 0.5 * acceleration * dt * dt);
      residuals.push(Math.abs(value(samples[i]) - predicted));
    }

    const residual = residuals.length ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length : 0;
    const sampleConfidence = Math.min(1, samples.length / this.config.historyLength);
    const residualConfidence = Math.max(0, 1 - residual / this.config.confidenceResidualScale);
    const confidence = clamp01(sampleConfidence * residualConfidence);

    const result: InfinityScalePredictionResult = {
      predictedError,
      trend,
      acceleration,
      horizon,
      confidence,
      modelVersion: "causal-linear-quadratic-v2",
    };
    state.lastPredictionEpoch = last.epoch;
    state.lastResult = result;
    return result;
  }

  state(regionId: string): InfinityScalePredictiveState | undefined {
    const state = this.states.get(regionId);
    return state ? cloneState(state) : undefined;
  }

  reset(regionId: string): void { this.states.delete(regionId); }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }

function cloneState(state: InfinityScalePredictiveState): InfinityScalePredictiveState {
  return {
    ...state,
    samples: state.samples.map(sample => ({ ...sample })),
    lastResult: state.lastResult ? { ...state.lastResult } : undefined,
  };
}
