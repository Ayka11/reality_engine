import { Recorder } from "../simulation/Recorder";
import { VoxelGrid } from "../core/VoxelGrid";

export function runRecorderRecoveryRegression(): void {
  const grid = new VoxelGrid(2, 2, 1);
  const recorder = new Recorder(4, 1);
  recorder.startRecording();
  grid.buffer[0] = 5;
  recorder.tick(grid, 1);
  grid.buffer[0] = 9;
  recorder.tick(grid, 2);
  const snapshot = recorder.snapshotState();

  grid.buffer[0] = 100;
  recorder.clearSnapshots();
  recorder.restoreState(snapshot, grid.buffer.length);
  if (recorder.count !== 2 || recorder.snapList[0].buffer[0] !== 5 ||
      recorder.snapList[1].buffer[0] !== 9 || !recorder.recording) {
    throw new Error("Recorder restore did not recover snapshot history and control state");
  }

  snapshot.snapshots[0].buffer[0] = -123;
  snapshot.snapshots[0].metrics.totalEnergy = -123;
  if (recorder.snapList[0].buffer[0] !== 5 ||
      recorder.snapList[0].metrics.totalEnergy === -123) {
    throw new Error("Recorder restore retained aliases to snapshot history");
  }

  const before = recorder.snapshotState();
  const invalid = recorder.snapshotState();
  invalid.snapshots[0].buffer = new Float32Array(1);
  let rejected = false;
  try {
    recorder.restoreState(invalid, grid.buffer.length);
  } catch {
    rejected = true;
  }
  if (!rejected || recorder.count !== before.snapshots.length ||
      recorder.snapList[0].buffer[0] !== before.snapshots[0].buffer[0]) {
    throw new Error("Recorder accepted incompatible snapshot or mutated before validation");
  }
}
