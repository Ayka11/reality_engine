import { VoxelGrid } from "../core/VoxelGrid";
import { WorldEvents, type WorldEventsSnapshot } from "./WorldEvents";

function cloneSnapshot(snapshot: WorldEventsSnapshot): WorldEventsSnapshot {
  return {
    history: snapshot.history.map(event => ({ ...event })),
    nextAuto: snapshot.nextAuto,
    rngState: snapshot.rngState,
  };
}

function equal(a: unknown, b: unknown, message: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message);
}

export function runWorldEventsRecoveryRegression(): void {
  const world = new WorldEvents(0x1234abcd);
  const grid = new VoxelGrid(12, 12, 5);
  for (let i = 0; i < grid.size; i++) {
    const base = i * 24;
    grid.buffer[base] = (i * 7) % 101;
    grid.buffer[base + 1] = ((i * 3) % 100) / 100;
    grid.buffer[base + 3] = ((i * 11) % 100) / 100;
    grid.buffer[base + 4] = (i * 13) % 200;
    grid.buffer[base + 11] = ((i * 5) % 100) / 100;
  }

  const checkpoint = world.snapshot();
  const checkpointGrid = grid.buffer.slice();
  world.trigger(grid, "solar_flare", 10);
  world.trigger(grid, "tectonic_shift", 11);
  const expectedState = world.snapshot();
  const expectedGrid = grid.buffer.slice();

  // Restore event history, interval schedule and PRNG, then replay identical inputs.
  world.restore(checkpoint);
  grid.buffer.set(checkpointGrid);
  world.trigger(grid, "solar_flare", 10);
  world.trigger(grid, "tectonic_shift", 11);
  equal(world.snapshot(), expectedState, "WorldEvents recovery did not restore history and RNG progression");
  equal(Array.from(grid.buffer), Array.from(expectedGrid), "WorldEvents recovery did not replay event effects");

  // Snapshots must deep-copy event history and the legacy API should remain equivalent.
  const detached = world.snapshot();
  detached.history[0].label = "mutated externally";
  if (world.recent(1)[0]?.label === "mutated externally") {
    throw new Error("WorldEvents snapshot aliases live history");
  }
  equal(world.snapshotRandomState(), world.snapshot(), "Legacy WorldEvents RNG snapshot differs from canonical snapshot");
  const legacyCheckpoint = world.snapshotRandomState();
  world.trigger(grid, "radiation_storm", 12);
  world.restoreRandomState(legacyCheckpoint);
  equal(world.snapshot(), legacyCheckpoint, "Legacy WorldEvents restore did not delegate to canonical restore");

  // Exercise the automatic-event countdown path including a selected random event.
  const autoCheckpoint = { ...cloneSnapshot(world.snapshot()), nextAuto: 1 };
  world.restore(autoCheckpoint);
  const autoGridBaseline = grid.buffer.slice();
  const expectedAutoEvent = world.autoTick(grid, 20);
  const expectedAutoState = world.snapshot();
  const expectedAutoGrid = grid.buffer.slice();
  if (!expectedAutoEvent || expectedAutoState.nextAuto < 400 || expectedAutoState.nextAuto > 1199) {
    throw new Error("WorldEvents auto-tick did not exercise its event/interval transition");
  }
  world.restore(autoCheckpoint);
  grid.buffer.set(autoGridBaseline);
  const replayAutoEvent = world.autoTick(grid, 20);
  equal(replayAutoEvent, expectedAutoEvent, "WorldEvents auto-tick did not replay the selected event");
  equal(world.snapshot(), expectedAutoState, "WorldEvents auto-tick did not replay countdown and RNG state");
  equal(Array.from(grid.buffer), Array.from(expectedAutoGrid), "WorldEvents auto-tick did not replay world mutations");

  runWorldEventsInvalidSnapshotRegression(world);
}

export function runWorldEventsInvalidSnapshotRegression(world = new WorldEvents(0x1234abcd)): void {
  world.restore({
    rngState: 0x1234abcd,
    nextAuto: 600,
    history: [{ type: "solar_flare", tick: 1, label: "Solar Flare", description: "recorded event" }],
  });
  const baseline = world.snapshot();

  const assertRejectedWithoutMutation = (candidate: unknown, label: string): void => {
    const before = JSON.stringify(world.snapshot());
    let rejected = false;
    try {
      world.restore(candidate as WorldEventsSnapshot);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`WorldEvents accepted malformed recovery snapshot: ${label}`);
    }
    if (JSON.stringify(world.snapshot()) !== before) {
      throw new Error(`Rejected WorldEvents snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), rngState: 0 }, "zero PRNG state");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), rngState: 0x100000000 }, "out-of-range PRNG state");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), nextAuto: -1 }, "negative automatic-event countdown");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), history: null }, "non-array event history");

  const invalidType = cloneSnapshot(baseline);
  (invalidType.history[0] as unknown as { type: string }).type = "unknown_event";
  assertRejectedWithoutMutation(invalidType, "invalid event type");

  const invalidTick = cloneSnapshot(baseline);
  invalidTick.history[0].tick = -1;
  assertRejectedWithoutMutation(invalidTick, "negative event tick");

  const nonIntegerTick = cloneSnapshot(baseline);
  nonIntegerTick.history[0].tick = 1.5;
  assertRejectedWithoutMutation(nonIntegerTick, "non-integer event tick");

  const invalidLabel = cloneSnapshot(baseline);
  (invalidLabel.history[0] as unknown as { label: unknown }).label = 5;
  assertRejectedWithoutMutation(invalidLabel, "invalid event label");

  const invalidDescription = cloneSnapshot(baseline);
  (invalidDescription.history[0] as unknown as { description: unknown }).description = null;
  assertRejectedWithoutMutation(invalidDescription, "invalid event description");

  const nullEvent = cloneSnapshot(baseline);
  (nullEvent.history as unknown[])[0] = null;
  assertRejectedWithoutMutation(nullEvent, "null history entry");

  const overlongHistory = cloneSnapshot(baseline);
  overlongHistory.history = Array.from({ length: 21 }, (_, index) => ({
    type: "solar_flare" as const,
    tick: index,
    label: "Solar Flare",
    description: "event",
  }));
  assertRejectedWithoutMutation(overlongHistory, "history exceeds capacity");
}
