import {
  compileSparseVoxelGridPhysicalTopology,
  formatSparseVoxelGridPhysicalChunkKey,
  parseSparseVoxelGridPhysicalChunkKey,
  type SparseVoxelGridPhysicalChunkIdentity,
} from "./SparseVoxelGridPhysicalTopology";

export const SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION = 2 as const;
export type SparseVoxelGridPersistenceSchemaVersion = 1 | 2;

export interface SparseVoxelGridVersionedChunkIdentity extends SparseVoxelGridPhysicalChunkIdentity {
  readonly schemaVersion: typeof SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION;
}

export interface SparseVoxelGridVersionedPersistenceChunk extends Record<string, unknown> {
  readonly key: string;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly level: number;
  readonly scale: number;
}

export interface SparseVoxelGridVersionedPersistenceDocument {
  readonly schemaVersion: typeof SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION;
  readonly chunks: readonly SparseVoxelGridVersionedPersistenceChunk[];
}

/**
 * Validate one persisted chunk identity. Version 1 is the historical
 * level-zero format; version 2 requires the complete physical identity.
 * This function deliberately validates identity only, not buffer payloads.
 */
export function parseSparseVoxelGridPersistedChunkIdentity(
  value: unknown,
  schemaVersion: SparseVoxelGridPersistenceSchemaVersion,
): SparseVoxelGridVersionedChunkIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("SparseVoxelGrid persisted chunk must be an object");
  }
  const record = value as Record<string, unknown>;
  const { key, cx, cy, cz } = record;
  if (typeof key !== "string" ||
      typeof cx !== "number" || !Number.isSafeInteger(cx) ||
      typeof cy !== "number" || !Number.isSafeInteger(cy) ||
      typeof cz !== "number" || !Number.isSafeInteger(cz)) {
    throw new Error("SparseVoxelGrid persisted chunk has an invalid key or coordinate");
  }

  if (schemaVersion === 1) {
    if (record.level !== undefined || record.scale !== undefined) {
      throw new Error("Legacy SparseVoxelGrid records must not mix in version-2 LOD fields");
    }
    const parsed = parseSparseVoxelGridPhysicalChunkKey(key);
    if (parsed.level !== 0 || parsed.cx !== cx || parsed.cy !== cy || parsed.cz !== cz) {
      throw new Error("Legacy SparseVoxelGrid key and coordinates do not describe the same level-zero chunk");
    }
    return Object.freeze({
      ...parsed,
      schemaVersion: SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION,
    });
  }

  if (schemaVersion !== SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION) {
    throw new Error("Unsupported SparseVoxelGrid persistence schema version");
  }
  const { level, scale } = record;
  if (typeof level !== "number" || !Number.isSafeInteger(level) ||
      typeof scale !== "number" || !Number.isSafeInteger(scale) ||
      level < 0 || level > 30 || scale !== 2 ** level) {
    throw new Error("Version-2 SparseVoxelGrid record has an invalid level/scale pair");
  }
  const expectedKey = formatSparseVoxelGridPhysicalChunkKey(
    level, cx, cy, cz,
  );
  if (key !== expectedKey) {
    throw new Error("Version-2 SparseVoxelGrid key does not match its complete physical identity");
  }
  const parsed = parseSparseVoxelGridPhysicalChunkKey(key);
  return Object.freeze({
    ...parsed,
    schemaVersion: SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION,
  });
}

/**
 * Upgrade or validate a persistence document without mutating its input.
 * Legacy v1 records are interpreted as level zero only; v2 records must
 * provide the complete key/coordinate/level/scale identity. The complete
 * candidate topology is checked for duplicates and physical overlap.
 */
function getPersistenceSchemaVersion(
  record: Record<string, unknown>,
  allowMissingLegacyVersion: boolean,
): SparseVoxelGridPersistenceSchemaVersion {
  const version = record.schemaVersion;
  if (version === undefined && allowMissingLegacyVersion) return 1;
  if (version !== 1 && version !== SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION) {
    throw new Error("Unsupported SparseVoxelGrid persistence schema version");
  }
  return version;
}

function upgradeChunkIdentityRecords(
  candidates: readonly unknown[],
  schemaVersion: SparseVoxelGridPersistenceSchemaVersion,
): SparseVoxelGridVersionedPersistenceChunk[] {
  const chunks = candidates.map(candidate => {
    const identity = parseSparseVoxelGridPersistedChunkIdentity(candidate, schemaVersion);
    const record = candidate as Record<string, unknown>;
    return Object.freeze({
      ...record,
      key: identity.key,
      cx: identity.cx,
      cy: identity.cy,
      cz: identity.cz,
      level: identity.level,
      scale: identity.scale,
    }) as SparseVoxelGridVersionedPersistenceChunk;
  });
  compileSparseVoxelGridPhysicalTopology(chunks.map(chunk => chunk.key));
  return chunks;
}

/**
 * Accept the actual historical serializeChunks() result (a bare array), as
 * well as explicit v1/v2 envelopes. Bare arrays have no version metadata and
 * are accepted only as legacy level-zero records.
 */
export function upgradeSparseVoxelGridPersistenceDocument(
  value: unknown,
): SparseVoxelGridVersionedPersistenceDocument {
  let schemaVersion: SparseVoxelGridPersistenceSchemaVersion;
  let candidates: readonly unknown[];
  if (Array.isArray(value)) {
    schemaVersion = 1;
    candidates = value;
  } else if (value && typeof value === "object") {
    const document = value as Record<string, unknown>;
    schemaVersion = getPersistenceSchemaVersion(document, false);
    if (!Array.isArray(document.chunks)) {
      throw new Error("Malformed SparseVoxelGrid persistence document");
    }
    candidates = document.chunks;
  } else {
    throw new TypeError("SparseVoxelGrid persistence document must be an object or legacy chunk array");
  }

  const chunks = upgradeChunkIdentityRecords(candidates, schemaVersion);
  return Object.freeze({
    schemaVersion: SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION,
    chunks: Object.freeze(chunks),
  });
}

export interface SparseVoxelGridVersionedSnapshotIdentity extends Record<string, unknown> {
  readonly schemaVersion: typeof SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION;
  readonly chunks: readonly SparseVoxelGridVersionedPersistenceChunk[];
}

/** Upgrade identity metadata for the legacy captureState() snapshot shape. */
export function upgradeSparseVoxelGridSnapshotIdentity(
  value: unknown,
): SparseVoxelGridVersionedSnapshotIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("SparseVoxelGrid snapshot must be an object");
  }
  const snapshot = value as Record<string, unknown>;
  if (!Array.isArray(snapshot.chunks)) {
    throw new Error("SparseVoxelGrid snapshot must contain a chunk array");
  }
  const schemaVersion = getPersistenceSchemaVersion(snapshot, true);
  const chunks = upgradeChunkIdentityRecords(snapshot.chunks, schemaVersion);
  return Object.freeze({
    ...snapshot,
    schemaVersion: SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION,
    chunks: Object.freeze(chunks),
  });
}

export interface SparseVoxelGridVersionedDeltaIdentity extends Record<string, unknown> {
  readonly schemaVersion: typeof SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION;
  readonly chunks: readonly (SparseVoxelGridVersionedPersistenceChunk & Record<string, unknown>)[];
}

/**
 * Validate delta entry identities and any full before/after chunk snapshots.
 * A delta may describe a topology replacement, so before/after records are
 * checked independently rather than combined into one overlap topology.
 */
export function upgradeSparseVoxelGridDeltaIdentity(
  value: unknown,
): SparseVoxelGridVersionedDeltaIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("SparseVoxelGrid delta must be an object");
  }
  const delta = value as Record<string, unknown>;
  if (!Array.isArray(delta.chunks)) {
    throw new Error("SparseVoxelGrid delta must contain a chunk array");
  }
  const schemaVersion = getPersistenceSchemaVersion(delta, true);
  const chunks = delta.chunks.map(candidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("SparseVoxelGrid delta chunk must be an object");
    }
    const entry = candidate as Record<string, unknown>;
    const identity = parseSparseVoxelGridPersistedChunkIdentity(entry, schemaVersion);
    if (typeof entry.beforeExists !== "boolean" || typeof entry.afterExists !== "boolean") {
      throw new Error("SparseVoxelGrid delta chunk must declare beforeExists and afterExists");
    }
    if (entry.beforeExists !== entry.afterExists &&
        ((entry.beforeExists && !entry.beforeFull) || (entry.afterExists && !entry.afterFull))) {
      throw new Error("SparseVoxelGrid topology delta is missing a required full chunk snapshot");
    }

    const upgraded: Record<string, unknown> = {
      ...entry,
      key: identity.key,
      cx: identity.cx,
      cy: identity.cy,
      cz: identity.cz,
      level: identity.level,
      scale: identity.scale,
    };
    for (const field of ["beforeFull", "afterFull"] as const) {
      const full = entry[field];
      if (full === undefined) continue;
      const fullIdentity = parseSparseVoxelGridPersistedChunkIdentity(full, schemaVersion);
      if (fullIdentity.key !== identity.key ||
          fullIdentity.level !== identity.level ||
          fullIdentity.scale !== identity.scale ||
          fullIdentity.cx !== identity.cx ||
          fullIdentity.cy !== identity.cy ||
          fullIdentity.cz !== identity.cz) {
        throw new Error("SparseVoxelGrid delta full snapshot identity contradicts its delta entry");
      }
      const fullRecord = full as Record<string, unknown>;
      upgraded[field] = Object.freeze({
        ...fullRecord,
        level: fullIdentity.level,
        scale: fullIdentity.scale,
      });
    }
    return Object.freeze(upgraded) as SparseVoxelGridVersionedPersistenceChunk & Record<string, unknown>;
  });
  return Object.freeze({
    ...delta,
    schemaVersion: SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION,
    chunks: Object.freeze(chunks),
  });
}
