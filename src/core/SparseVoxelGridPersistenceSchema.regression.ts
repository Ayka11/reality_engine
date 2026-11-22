import {
  parseSparseVoxelGridPersistedChunkIdentity,
  upgradeSparseVoxelGridPersistenceDocument,
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

  console.log("SparseVoxelGrid versioned persistence identity and legacy-upgrade regressions: PASS");
}
