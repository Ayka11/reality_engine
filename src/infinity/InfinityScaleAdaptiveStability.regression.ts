import {
  InfinityScaleAdaptiveStability,
} from "./InfinityScaleAdaptiveStability";

export function runInfinityScaleAdaptiveStabilityRegression(): void {
  const scheduler = new InfinityScaleAdaptiveStability({
    refineEvidenceEpochs: 2,
    coarsenEvidenceEpochs: 2,
    minResidenceEpochs: 2,
    cooldownEpochs: 2,
    oscillationTransitions: 2,
    freezeEpochs: 4,
    criticalThreshold: 0.98,
  });

  // Threshold noise must not mutate topology.
  const noise1 = scheduler.decide("R-noise", 1, { score: 0.76 }, 0);
  const noise2 = scheduler.decide("R-noise", 2, { score: 0.73 }, 0);
  if (noise1.decision !== "KEEP" || noise2.decision !== "KEEP") {
    throw new Error("Threshold noise caused an unexpected refinement");
  }

  // Persistent evidence must refine after the configured evidence window.
  const refine1 = scheduler.decide("R-refine", 1, { score: 0.80 }, 0);
  const refine2 = scheduler.decide("R-refine", 2, { score: 0.82 }, 0);
  if (refine1.decision !== "KEEP" || refine2.decision !== "REFINE") {
    throw new Error("Persistent refinement evidence was not applied");
  }

  // Residence/cooldown prevents an immediate reversal.
  const reversal = scheduler.decide("R-refine", 3, { score: 0.10 }, 1);
  if (reversal.decision !== "HOLD") {
    throw new Error("Immediate coarsening escaped residence/cooldown protection");
  }

  // Build repeated accepted transitions on a separate region and verify freeze.
  const oscillating = new InfinityScaleAdaptiveStability({
    refineEvidenceEpochs: 1,
    coarsenEvidenceEpochs: 1,
    minResidenceEpochs: 0,
    cooldownEpochs: 0,
    oscillationTransitions: 2,
    freezeEpochs: 4,
    criticalThreshold: 0.98,
  });

  const a = oscillating.decide("R-osc", 1, { score: 0.90 }, 0);
  if (a.decision !== "REFINE") throw new Error("Oscillation fixture did not refine");

  const b = oscillating.decide("R-osc", 2, { score: 0.10 }, 1);
  if (b.decision !== "COARSEN") throw new Error("Oscillation fixture did not coarsen");

  const c = oscillating.decide("R-osc", 3, { score: 0.90 }, 0);
  if (c.decision !== "REFINE") throw new Error("Oscillation fixture did not re-refine");

  const d = oscillating.decide("R-osc", 4, { score: 0.10 }, 1);
  if (d.decision !== "HOLD" || !d.oscillationDetected) {
    throw new Error("LOD oscillation was not frozen");
  }

  // Critical error may override stability locks.
  const critical = scheduler.decide("R-critical", 1, { score: 0.99 }, 0);
  if (critical.decision !== "REFINE" || !critical.criticalOverride) {
    throw new Error("Critical override did not trigger refinement");
  }

  // Physics is outside this scheduler: freezing only blocks adaptive mutation.
  if (oscillating.state("R-osc", 1).currentLOD !== 1) {
    throw new Error("Adaptive freeze corrupted physical LOD state");
  }
}
