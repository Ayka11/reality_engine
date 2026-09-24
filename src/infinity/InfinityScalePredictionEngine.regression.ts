import {
  InfinityScalePredictionEngine,
} from "./InfinityScalePredictionEngine";

export function runInfinityScalePredictionEngineRegression(): void {
  const engine = new InfinityScalePredictionEngine({
    historyLength: 6,
    minSamples: 3,
    maxHorizon: 4,
  });

  engine.observe("rising", 0, 0.20);
  engine.observe("rising", 1, 0.30);
  engine.observe("rising", 2, 0.40);

  const rising = engine.predict("rising", 2);
  if (rising.predictedError <= 0.40) {
    throw new Error("Rising error was not predicted to increase");
  }
  if (rising.trend <= 0 || rising.confidence <= 0) {
    throw new Error("Rising error prediction has invalid trend/confidence");
  }

  engine.observe("falling", 0, 0.70);
  engine.observe("falling", 1, 0.50);
  engine.observe("falling", 2, 0.30);

  const falling = engine.predict("falling", 2);
  if (falling.predictedError >= 0.30) {
    throw new Error("Falling error was not predicted to decrease");
  }

  const insufficient = new InfinityScalePredictionEngine();
  insufficient.observe("new", 0, 0.40);
  insufficient.observe("new", 1, 0.45);
  const fallback = insufficient.predict("new", 1);
  if (fallback.confidence !== 0) {
    throw new Error("Insufficient history incorrectly reported prediction confidence");
  }

  const replayA = new InfinityScalePredictionEngine();
  const replayB = new InfinityScalePredictionEngine();
  for (const [epoch, error] of [[0, 0.2], [1, 0.3], [2, 0.45], [3, 0.6]] as const) {
    replayA.observe("replay", epoch, error);
    replayB.observe("replay", epoch, error);
  }

  const a = replayA.predict("replay", 3);
  const b = replayB.predict("replay", 3);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error("Prediction replay is not deterministic");
  }

  const state = replayA.state("replay");
  if (!state?.lastResult || state.lastResult.modelVersion !== "linear-quadratic-v1") {
    throw new Error("Prediction provenance state was not retained");
  }
}
