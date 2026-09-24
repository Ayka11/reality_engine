import { InfinityScalePredictionEngine } from "./InfinityScalePredictionEngine";

export function runInfinityScaleCausalPredictionHistoryRegression(): void {
  const engine = new InfinityScalePredictionEngine();

  engine.observeCausal("r", 1, 0.2, { numericalResidual: 0.02, transitionEffect: 0.4, transferEffect: 0.1, attributionHash: "aa" });
  engine.observeCausal("r", 2, 0.3, { numericalResidual: 0.03, transitionEffect: 0.2, transferEffect: 0.05, attributionHash: "bb" });
  engine.observeCausal("r", 3, 0.4, { numericalResidual: 0.04, transitionEffect: 0.1, transferEffect: 0.02, attributionHash: "cc" });

  const state = engine.state("r");
  if (!state || state.samples.length !== 3) throw new Error("Causal prediction history was not retained");
  if (state.samples[0].transitionEffect !== 0.4) throw new Error("Transition attribution was not retained");
  if (state.samples[2].attributionHash !== "cc") throw new Error("Attribution hash was not retained");

  const prediction = engine.predict("r", 1);
  if (prediction.modelVersion !== "causal-linear-quadratic-v2") throw new Error("Causal prediction model version missing");
  if (prediction.predictedError <= 0.4) throw new Error("Causal prediction did not use physical history");
}
