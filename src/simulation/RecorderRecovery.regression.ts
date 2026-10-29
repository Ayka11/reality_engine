import { CELL_FIELDS } from "../core/CellState";
import { VoxelGrid } from "../core/VoxelGrid";
import { Recorder, type RecorderStateSnapshot } from "./Recorder";

function cloneSnapshot(snapshot: RecorderStateSnapshot): RecorderStateSnapshot {
  return {
    recording: snapshot.recording,
    maxSnapshots: snapshot.maxSnapshots,
    intervalTicks: snapshot.intervalTicks,
    lastSnapTick: snapshot.lastSnapTick,
    snapshots: snapshot.snapshots.map(entry => ({
      tick: entry.tick,
      buffer: new Float32Array(entry.buffer),
      metrics: { ...entry.metrics },
    })),
  };
}

export function runRecorderRecoveryRegression(): void {
  const grid = new VoxelGrid(2, 2, 2);
  const recorder = new Recorder(2, 2);
  recorder.startRecording();

  grid.buffer[0] = 2;
  grid.buffer[3] = 0.5;
  grid.buffer[4] = 1.25;
  grid.buffer[5] = 3;
  recorder.tick(grid, 2);

  grid.buffer[0] = 5;
  grid.buffer[CELL_FIELDS + 3] = 1.5;
  recorder.tick(grid, 4);

  grid.buffer[0] = 9;
  recorder.tick(grid, 6);

  const source = recorder.snapshotState();
  if (source.snapshots.length !== 2 ||
      source.snapshots[0].tick !== 4 ||
      source.snapshots[1].tick !== 6 ||
      source.lastSnapTick !== 6 ||
      source.recording !== true) {
    throw new Error("Recorder recovery fixture did not exercise bounded history/control state");
  }
  const expected = JSON.stringify(source);

  // Public snapshots are detached from live recorder buffers and metrics.
  const detached = recorder.snapshotState();
  detached.snapshots[0].buffer[0] = -999;
  detached.snapshots[0].metrics.totalEnergy = -999;
  if (recorder.snapList[0].buffer[0] !== source.snapshots[0].buffer[0] ||
      recorder.snapList[0].metrics.totalEnergy !== source.snapshots[0].metrics.totalEnergy) {
    throw new Error("Recorder snapshot aliases live history buffers or metrics");
  }

  recorder.stopRecording();
  recorder.clearSnapshots();
  grid.buffer.fill(-1);
  recorder.restoreState(source, grid.buffer.length);

  if (JSON.stringify(recorder.snapshotState()) !== expected) {
    throw new Error("Recorder recovery did not restore history and recording controls");
  }
  if (recorder.recording !== true || recorder.count !== 2) {
    throw new Error("Recorder recovery did not restore recording/count state");
  }

  const restoredCopy = recorder.snapshotState();
  restoredCopy.snapshots[1].buffer[0] = -123;
  restoredCopy.snapshots[1].metrics.avgBio = -456;
  if (recorder.snapList[1].buffer[0] === -123 ||
      recorder.snapList[1].metrics.avgBio === -456) {
    throw new Error("Restored Recorder history aliases the supplied snapshot");
  }

  // A restored recorder must continue with the same interval schedule.
  const beforeTick = recorder.count;
  recorder.tick(grid, 7);
  if (recorder.count !== beforeTick) {
    throw new Error("Recorder captured before the configured snapshot interval");
  }
  recorder.tick(grid, 8);
  if (recorder.count !== beforeTick) {
    throw new Error("Recorder did not enforce the bounded history limit after recovery");
  }
  if (recorder.snapList[1].tick !== 8 || recorder.snapshotState().lastSnapTick !== 8) {
    throw new Error("Recorder did not resume the snapshot schedule from restored control state");
  }

  runRecorderInvalidSnapshotRegression();
}

export function runRecorderInvalidSnapshotRegression(): void {
  const grid = new VoxelGrid(2, 2, 1);
  const recorder = new Recorder(3, 2);
  recorder.startRecording();
  grid.buffer[0] = 4;
  recorder.tick(grid, 2);
  grid.buffer[0] = 6;
  recorder.tick(grid, 4);
  const baseline = recorder.snapshotState();

  const assertRejectedWithoutMutation = (candidate: unknown, label: string, expectedLength?: number): void => {
    const before = JSON.stringify(recorder.snapshotState());
    let rejected = false;
    try {
      recorder.restoreState(candidate as RecorderStateSnapshot, expectedLength);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`Recorder recovery accepted malformed snapshot: ${label}`);
    }
    if (JSON.stringify(recorder.snapshotState()) !== before) {
      throw new Error(`Rejected Recorder snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), maxSnapshots: 0 }, "invalid capacity");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), intervalTicks: 0 }, "invalid interval");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), lastSnapTick: -1 }, "negative last-snapshot tick");
  assertRejectedWithoutMutation(
    { ...cloneSnapshot(baseline), maxSnapshots: 1 },
    "history exceeds capacity",
  );

  const invalidBufferType = cloneSnapshot(baseline);
  (invalidBufferType.snapshots[0] as unknown as { buffer: unknown }).buffer = [1, 2];
  assertRejectedWithoutMutation(invalidBufferType, "invalid typed-array type");

  const invalidBufferLength = cloneSnapshot(baseline);
  invalidBufferLength.snapshots[0].buffer = new Float32Array(1);
  assertRejectedWithoutMutation(invalidBufferLength, "buffer length not aligned to cell fields");

  const wrongExpectedLength = cloneSnapshot(baseline);
  assertRejectedWithoutMutation(wrongExpectedLength, "expected buffer length mismatch", grid.buffer.length + CELL_FIELDS);

  const nonFiniteBuffer = cloneSnapshot(baseline);
  nonFiniteBuffer.snapshots[0].buffer[0] = Number.NaN;
  assertRejectedWithoutMutation(nonFiniteBuffer, "non-finite history buffer");

  const invalidMetrics = cloneSnapshot(baseline);
  invalidMetrics.snapshots[0].metrics.avgEntropy = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(invalidMetrics, "non-finite metrics");

  const invalidTick = cloneSnapshot(baseline);
  invalidTick.snapshots[1].tick = invalidTick.snapshots[0].tick;
  assertRejectedWithoutMutation(invalidTick, "duplicate/non-monotonic ticks");

  const lateLastTick = cloneSnapshot(baseline);
  lateLastTick.lastSnapTick = lateLastTick.snapshots[1].tick - 1;
  assertRejectedWithoutMutation(lateLastTick, "last-snapshot tick precedes history");
}
