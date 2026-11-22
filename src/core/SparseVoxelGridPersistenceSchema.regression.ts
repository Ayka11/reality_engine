import {
  parseSparseVoxelGridPersistedChunkIdentity,
  upgradeSparseVoxelGridDeltaIdentity,
  upgradeSparseVoxelGridPersistenceDocument,
  upgradeSparseVoxelGridSnapshotIdentity,
} from "./SparseVoxelGridPersistenceSchema";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  if (!rejected) throw new Error("SparseVoxelGrid persistence schema accepted " + label);
}

export function runSparseVoxelGridPersistenceSchemaRegression(): void {
  const legacy = {
    schemaVersion: 1,
    chunks: [
      { key: "-2,1,0", cx: -2, cy: 1, cz: 0, active: true, payload: "legacy-a" },
      { key: "3,0,-1", cx: 3, cy: 0, cz: -1, active: false, payload: "legacy-b" },
    ],
  };
  const upgraded = upgradeSparseVoxelGridPersistenceDocument(legacy);
  if (upgraded.schemaVersion !== 2 || upgraded.chunks.length !== 2 ||
      upgraded.chunks[0].level !== 0 || upgraded.chunks[0].scale !== 1 ||
      upgraded.chunks[0].key !== "-2,1,0" ||
      upgraded.chunks[0].payload !== "legacy-a" ||
      (legacy.chunks[0] as Record<string, unknown>).level !== undefined) {
    throw new Error("SparseVoxelGrid legacy persistence upgrade changed data or mutated its input");
  }

  const legacySerializedArray = [
    { key: "-4,0,2", cx: -4, cy: 0, cz: 2, active: true, buffer: new ArrayBuffer(32) },
  ];
  const upgradedArray = upgradeSparseVoxelGridPersistenceDocument(legacySerializedArray);
  if (upgradedArray.schemaVersion !== 2 ||
      upgradedArray.chunks[0].key !== "-4,0,2" ||
      upgradedArray.chunks[0].level !== 0 ||
      upgradedArray.chunks[0].scale !== 1 ||
      upgradedArray.chunks[0].buffer !== legacySerializedArray[0].buffer) {
    throw new Error("SparseVoxelGrid historical serializeChunks() array was not upgraded losslessly");
  }

  const legacySnapshot = {
    width: 4,
    height: 4,
    depth: 4,
    chunks: [{ key: "-1,0,0", cx: -1, cy: 0, cz: 0, active: true, lastAccessed: 9 }],
    dirtyChunks: ["-1,0,0"],
    chunkOwners: [["-1,0,0", "worker-a"]],
  };
  const upgradedSnapshot = upgradeSparseVoxelGridSnapshotIdentity(legacySnapshot);
  if (upgradedSnapshot.schemaVersion !== 2 ||
      upgradedSnapshot.chunks[0].level !== 0 ||
      upgradedSnapshot.chunks[0].scale !== 1 ||
      upgradedSnapshot.chunks[0].lastAccessed !== 9 ||
      (legacySnapshot.chunks[0] as Record<string, unknown>).level !== undefined) {
    throw new Error("SparseVoxelGrid legacy snapshot identity upgrade failed or mutated its input");
  }

  const legacyDelta = {
    chunks: [{
      key: "2,0,0", cx: 2, cy: 0, cz: 0,
      beforeExists: false, afterExists: true,
      afterFull: {
        key: "2,0,0", cx: 2, cy: 0, cz: 0,
        active: true, lastAccessed: 10,
      },
    }],
  };
  const upgradedDelta = upgradeSparseVoxelGridDeltaIdentity(legacyDelta);
  const upgradedDeltaChunk = upgradedDelta.chunks[0];
  if (upgradedDelta.schemaVersion !== 2 ||
      upgradedDeltaChunk.level !== 0 ||
      upgradedDeltaChunk.scale !== 1 ||
      (upgradedDeltaChunk.afterFull as Record<string, unknown>).scale !== 1) {
    throw new Error("SparseVoxelGrid legacy delta identity upgrade failed");
  }

  const current = upgradeSparseVoxelGridPersistenceDocument({
    schemaVersion: 2,
    chunks: [
      { key: "1:0,0,0", cx: 0, cy: 0, cz: 0, level: 1, scale: 2, active: true },
      { key: "2,0,0", cx: 2, cy: 0, cz: 0, level: 0, scale: 1, active: true },
    ],
  });
  if (current.schemaVersion !== 2 || current.chunks[0].scale !== 2 ||
      current.chunks[1].scale !== 1) {
    throw new Error("SparseVoxelGrid version-2 persistence validation lost level/scale identity");
  }

  const parsed = parseSparseVoxelGridPersistedChunkIdentity({
    key: "4:-3,2,1", cx: -3, cy: 2, cz: 1, level: 4, scale: 16,
  }, 2);
  if (parsed.key !== "4:-3,2,1" || parsed.level !== 4 || parsed.scale !== 16) {
    throw new Error("SparseVoxelGrid persisted identity parser returned an inconsistent identity");
  }

  expectRejected("legacy records with mixed LOD metadata", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 1,
      chunks: [{ key: "0,0,0", cx: 0, cy: 0, cz: 0, level: 0, scale: 1 }],
    }));
  expectRejected("legacy key/coordinate mismatch", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 1,
      chunks: [{ key: "1,0,0", cx: 0, cy: 0, cz: 0 }],
    }));
  expectRejected("version-2 records without scale", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 2,
      chunks: [{ key: "1:0,0,0", cx: 0, cy: 0, cz: 0, level: 1 }],
    }));
  expectRejected("version-2 records with contradictory scale", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 2,
      chunks: [{ key: "1:0,0,0", cx: 0, cy: 0, cz: 0, level: 1, scale: 4 }],
    }));
  expectRejected("version-2 records with mismatched coordinates", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 2,
      chunks: [{ key: "1:0,0,0", cx: 1, cy: 0, cz: 0, level: 1, scale: 2 }],
    }));
  expectRejected("duplicate persisted physical identities", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 2,
      chunks: [
        { key: "0,0,0", cx: 0, cy: 0, cz: 0, level: 0, scale: 1 },
        { key: "0,0,0", cx: 0, cy: 0, cz: 0, level: 0, scale: 1 },
      ],
    }));
  expectRejected("overlapping persisted mixed-level chunks", () =>
    upgradeSparseVoxelGridPersistenceDocument({
      schemaVersion: 2,
      chunks: [
        { key: "1:0,0,0", cx: 0, cy: 0, cz: 0, level: 1, scale: 2 },
        { key: "0,0,0", cx: 0, cy: 0, cz: 0, level: 0, scale: 1 },
      ],
    }));
  expectRejected("unsupported schema versions", () =>
    upgradeSparseVoxelGridPersistenceDocument({ schemaVersion: 3, chunks: [] }));

  expectRejected("legacy bare arrays with coarse keys", () =>
    upgradeSparseVoxelGridPersistenceDocument([
      { key: "1:0,0,0", cx: 0, cy: 0, cz: 0 },
    ]));
  expectRejected("snapshots with contradictory schema-2 identity", () =>
    upgradeSparseVoxelGridSnapshotIdentity({
      schemaVersion: 2,
      chunks: [{ key: "0,0,0", cx: 0, cy: 0, cz: 0, level: 1, scale: 2 }],
    }));
  expectRejected("delta entry/full-snapshot identity mismatch", () =>
    upgradeSparseVoxelGridDeltaIdentity({
      chunks: [{
        key: "0,0,0", cx: 0, cy: 0, cz: 0,
        beforeExists: false, afterExists: true,
        afterFull: { key: "1,0,0", cx: 1, cy: 0, cz: 0 },
      }],
    }));
  expectRejected("delta topology additions without full snapshots", () =>
    upgradeSparseVoxelGridDeltaIdentity({
      chunks: [{
        key: "0,0,0", cx: 0, cy: 0, cz: 0,
        beforeExists: false, afterExists: true,
      }],
    }));
  expectRejected("version-2 delta without complete identity", () =>
    upgradeSparseVoxelGridDeltaIdentity({
      schemaVersion: 2,
      chunks: [{
        key: "0,0,0", cx: 0, cy: 0, cz: 0,
        beforeExists: true, afterExists: true,
      }],
    }));
  console.log("SparseVoxelGrid versioned persistence identity and legacy-upgrade regressions: PASS");
}
