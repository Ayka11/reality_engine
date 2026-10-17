import { VoxelGrid } from "../core/VoxelGrid";
import { WorldEvents } from "../world/WorldEvents";

export function runWorldEventsRecoveryRegression(): void {
  const grid = new VoxelGrid(4, 4, 2);
  const events = new WorldEvents();
  events.trigger(grid, "solar_flare", 3);
  const snapshot = events.snapshot();
  if (snapshot.history.length !== 1 || snapshot.history[0].type !== "solar_flare") {
    throw new Error("WorldEvents snapshot did not capture event history");
  }

  snapshot.history[0].label = "tampered";
  if (events.recent(1)[0].label === "tampered") {
    throw new Error("WorldEvents snapshot aliases live event history");
  }

  events.trigger(grid, "radiation_storm", 4);
  events.restore({ history: [{ type: "solar_flare", tick: 3, label: "Solar Flare", description: "Burst of radiation energy across the top layers." }], nextAuto: 599 });
  const restored = events.recent(5);
  if (restored.length !== 1 || restored[0].type !== "solar_flare" || restored[0].tick !== 3) {
    throw new Error("WorldEvents restore did not replace event history");
  }

  let rejected = false;
  try {
    events.restore({ history: [{ type: "unknown" as never, tick: -1, label: "bad", description: "bad" }], nextAuto: 0 });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("WorldEvents accepted an invalid recovery snapshot");
  if (events.recent(1)[0].type !== "solar_flare") {
    throw new Error("WorldEvents invalid restore changed the existing history");
  }
}
