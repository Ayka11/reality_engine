import { LawEngine } from "../laws/LawEngine";

export function runLawEngineRecoveryRegression(): void {
  const engine = new LawEngine();
  engine.setLawOverride("law_radiation", "on");
  engine.toggleProcess(27, false);
  const snapshot = engine.snapshot();
  const expectedMask = engine.activeProcessMask;
  const expectedEntropyRate = engine.params.entropyGrowthRate;

  engine.laws[0].name = "mutated live law";
  if (snapshot.laws[0].name !== "Thermodynamics") {
    throw new Error("LawEngine snapshot retained live law aliases");
  }
  engine.setLawOverride("law_radiation", "off");
  engine.toggleProcess(27, true);
  engine.restore(snapshot);

  if (engine.laws[0].name !== "Thermodynamics" ||
      engine.getLawOverride("law_radiation") !== "on" ||
      engine.activeProcessMask !== expectedMask ||
      engine.params.entropyGrowthRate !== expectedEntropyRate) {
    throw new Error("LawEngine restore did not recover laws and overrides");
  }

  const before = engine.snapshot();
  const invalid = engine.snapshot();
  invalid.laws[1].id = invalid.laws[0].id;
  let rejected = false;
  try {
    engine.restore(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected ||
      engine.snapshot().laws.map(law => law.id).join("|") !== before.laws.map(law => law.id).join("|") ||
      engine.activeProcessMask !== expectedMask) {
    throw new Error("LawEngine accepted invalid snapshot or mutated before validation");
  }
}
