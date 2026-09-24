import { InfinityScaleResolutionGoalRegistry } from "./InfinityScaleResolutionGoalRegistry";

export function runInfinityScaleResolutionGoalRegistryRegression(): void {
  const registry = new InfinityScaleResolutionGoalRegistry();

  registry.register({
    goalId: "shock",
    name: "Shock front",
    fields: ["density"],
    minimumLOD: 1,
    preferredLOD: 3,
    maximumLOD: 4,
    priority: 1,
    accuracyTarget: 0.001,
    regions: ["R1"],
  });

  const high = registry.relevance("R1", "density", 1);
  const low = registry.relevance("R2", "density", 1);
  if (high <= low || high <= 0) {
    throw new Error("Goal relevance did not prioritize the targeted region");
  }

  const copy = registry.get("shock");
  if (!copy || copy.fields[0] !== "density") {
    throw new Error("Resolution goal was not retained");
  }

  registry.upsert({ ...copy, priority: 0.5 });
  if (registry.get("shock")?.priority !== 0.5) {
    throw new Error("Resolution goal upsert failed");
  }

  if (!registry.remove("shock") || registry.get("shock")) {
    throw new Error("Resolution goal removal failed");
  }
}
