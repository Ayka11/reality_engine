import { CELL_FIELDS } from "../core/CellState";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

export function runInfinityScaleLODStateRecoveryRegression(): void {
  const state = new InfinityScaleLODState(2);
  const key = "0:0,0,0";
  const original = state.ensureChunk(key, 0);
  original.cells[0] = 17;
  original.cells[1] = 3.5;

  const snapshot = state.snapshot();
  original.cells[0] = 99;
  state.ensureChunk("1:1,0,0", 1).cells[0] = 42;
  state.beginRevision();
  const revisionBeforeRestore = state.getRevision();

  state.restore(snapshot);

  const restored = state.getChunk(key);
  if (!restored) throw new Error("LOD recovery did not restore the original chunk");
  if (restored.cells[0] !== 17 || restored.cells[1] !== 3.5) {
    throw new Error("LOD recovery did not restore original cell values");
  }
  if (state.hasChunk("1:1,0,0")) {
    throw new Error("LOD recovery retained a chunk created after the snapshot");
  }
  if (state.getRevision() <= revisionBeforeRestore) {
    throw new Error("LOD recovery did not invalidate outstanding transaction revisions");
  }
  if (restored.cells.length !== 2 ** 3 * CELL_FIELDS) {
    throw new Error("LOD recovery restored a malformed cell buffer");
  }

  // The snapshot must not share storage with the restored state.
  snapshot.chunks[0].cells[0] = -1;
  if (restored.cells[0] !== 17) {
    throw new Error("LOD recovery snapshot aliases restored mutable state");
  }
}
