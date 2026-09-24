import { InfinityScaleRuntimePredictionFeedback } from "./InfinityScaleRuntimePredictionFeedback";

export function runInfinityScaleRuntimePredictionFeedbackRegression(): void {
  const feedback = new InfinityScaleRuntimePredictionFeedback();
  feedback.observeError("front", 1, 0.20);
  feedback.observeError("front", 2, 0.30);
  feedback.observeError("front", 3, 0.45);
  const result = feedback.observeError("front", 4, 0.60, 2);
  if (result.prediction.predictedError <= 0.60) throw new Error("Prediction did not incorporate rising runtime error");
  if (result.prediction.trend <= 0) throw new Error("Runtime prediction trend was not positive");
  if (feedback.state("front")?.samples.length !== 4) throw new Error("Runtime feedback history was not retained");

  const replay = new InfinityScaleRuntimePredictionFeedback();
  replay.observeError("front", 1, 0.20);
  replay.observeError("front", 2, 0.30);
  replay.observeError("front", 3, 0.45);
  const replayResult = replay.observeError("front", 4, 0.60, 2);
  if (JSON.stringify(result.prediction) !== JSON.stringify(replayResult.prediction)) {
    throw new Error("Runtime prediction feedback is not deterministic");
  }
}
