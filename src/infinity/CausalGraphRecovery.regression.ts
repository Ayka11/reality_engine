import { CausalGraph } from "../simulation/CausalGraph";

export function runCausalGraphRecoveryRegression(): void {
  const graph = new CausalGraph();
  const first = graph.log(2, 1, 2, 0, 9, "energy_spike", 12);
  graph.log(3, 1, 2, 0, 9, "entropy_burst", -4);
  const snapshot = graph.snapshot();

  graph.log(4, 3, 1, 0, 10, "bio_emergence", 7);
  snapshot.events[0].delta = 999;
  snapshot.lastEventByCell[0][1] = 999;
  if (graph.recent(1)[0]?.delta !== 7) {
    throw new Error("CausalGraph snapshot retained event aliases");
  }

  const clean = graph.snapshot();
  graph.clear();
  graph.restore(clean);
  const recent = graph.recent(2);
  if (recent.length !== 2 || recent[0].tick !== 4 || recent[1].tick !== 3) {
    throw new Error("CausalGraph restore did not recover event history");
  }

  const next = graph.log(5, 1, 2, 0, 9, "energy_spike", 1);
  if (next.id !== clean.nextId || next.parentId !== 2) {
    throw new Error("CausalGraph restore did not recover event sequence state");
  }

  const before = graph.snapshot();
  const invalid = graph.snapshot();
  invalid.events[0].type = "invalid" as typeof invalid.events[0]["type"];
  let rejected = false;
  try {
    graph.restore(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected || graph.snapshot().nextId !== before.nextId ||
      graph.recent(1)[0]?.id !== before.events[before.events.length - 1]?.id) {
    throw new Error("CausalGraph accepted invalid state or mutated before validation");
  }

  if (first.id !== 1) throw new Error("CausalGraph initial id changed unexpectedly");
}
