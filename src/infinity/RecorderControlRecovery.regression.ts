import { Recorder } from "../simulation/Recorder";

export function runRecorderControlRecoveryRegression(): void {
  const recorder = new Recorder(4, 7);
  recorder.startRecording();
  const snapshot = recorder.snapshotControlState();
  if (!snapshot.recording || snapshot.intervalTicks !== 7 || snapshot.nextSnapTick !== 7) {
    throw new Error("Recorder control snapshot missed recording schedule");
  }

  recorder.stopRecording();
  recorder.restoreControlState(snapshot);
  if (!recorder.recording) {
    throw new Error("Recorder restore did not recover recording state");
  }

  const before = recorder.snapshotControlState();
  const invalid = recorder.snapshotControlState();
  invalid.intervalTicks = 0;
  let rejected = false;
  try {
    recorder.restoreControlState(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected ||
      recorder.snapshotControlState().intervalTicks !== before.intervalTicks ||
      recorder.recording !== before.recording) {
    throw new Error("Recorder accepted invalid control state or mutated before validation");
  }
}
