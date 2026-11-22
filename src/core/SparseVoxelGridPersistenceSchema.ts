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
export function upgradeSparseVoxelGridPersistenceDocument(
  value: unknown,
): SparseVoxelGridVersionedPersistenceDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("SparseVoxelGrid persistence document must be an object");
  }
  const document = value as Record<string, unknown>;
  const schemaVersion = document.schemaVersion;
  if ((schemaVersion !== 1 && schemaVersion !== SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION) ||
      !Array.isArray(document.chunks)) {
    throw new Error("Unsupported or malformed SparseVoxelGrid persistence document");
  }

  const chunks = document.chunks.map((candidate, index) => {
    const identity = parseSparseVoxelGridPersistedChunkIdentity(
      candidate, schemaVersion as SparseVoxelGridPersistenceSchemaVersion,
    );
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
  return Object.freeze({
    schemaVersion: SPARSE_VOXEL_GRID_PERSISTENCE_SCHEMA_VERSION,
    chunks: Object.freeze(chunks),
  });
}
