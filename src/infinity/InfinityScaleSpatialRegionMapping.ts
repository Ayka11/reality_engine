import {
  getInfinityScaleChildChunkKeys,
  getInfinityScaleParentChunkKey,
  mapInfinityScaleChunkToSparseChunks,
} from "./InfinityScaleSpatialChunkMapping";
import { parseInfinityScaleChunkKey } from "./InfinityScaleChunkKey";
import type { InfinityScaleAdaptiveMutation } from "./InfinityScaleAdaptiveTransferCompiler";

export interface InfinityScaleSpatialRegionMappingOptions {
  /** Maximum number of hierarchical chunk records materialized by one transaction. */
  maxHierarchicalChunkCount?: number;
  /** Maximum number of unique level-zero SparseVoxelGrid chunks covered by a transaction. */
  maxSparseChunkCount?: number;
}

export interface InfinityScaleSpatialRegionMutationMapping {
  readonly regionId: string;
  readonly fromLOD: number;
  readonly toLOD: number;
  readonly sourceChunkKeys: readonly string[];
  readonly targetChunkKeys: readonly string[];
  readonly sourceSparseChunkKeys: readonly string[];
  readonly targetSparseChunkKeys: readonly string[];
}

const DEFAULT_MAX_HIERARCHICAL_CHUNKS = 4096;
const DEFAULT_MAX_SPARSE_CHUNKS = 4096;

function assertLimit(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(label + " must be a positive safe integer");
  }
}

function sortedUniqueChunkKeys(keys: readonly string[], regionId: string, level: number): string[] {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error(
      "Adaptive LOD transaction requires physical chunk remapping metadata for region " + regionId,
    );
  }
  const unique = new Set<string>();
  for (const candidate of keys) {
    const parsed = parseInfinityScaleChunkKey(candidate);
    if (parsed.level !== level) {
      throw new Error(
        "Adaptive LOD region " + regionId + " source chunk level does not match fromLOD: " + parsed.key,
      );
    }
    if (unique.has(parsed.key)) {
      throw new Error("Adaptive LOD region " + regionId + " contains a duplicate source chunk: " + parsed.key);
    }
    unique.add(parsed.key);
  }
  return [...unique].sort();
}

function refineOneLevel(chunkKeys: readonly string[]): string[] {
  const children = chunkKeys.flatMap(key => [...getInfinityScaleChildChunkKeys(key)]);
  return children.sort();
}

function coarsenOneLevel(chunkKeys: readonly string[], regionId: string): string[] {
  const siblingsByParent = new Map<string, string[]>();
  for (const key of chunkKeys) {
    const parsed = parseInfinityScaleChunkKey(key);
    if (parsed.level >= 30) {
      throw new RangeError("Adaptive LOD region " + regionId + " cannot coarsen beyond level 30");
    }
    const parentKey =
      `${parsed.level + 1}:${Math.floor(parsed.x / 2)},${Math.floor(parsed.y / 2)},${Math.floor(parsed.z / 2)}`;
    const group = siblingsByParent.get(parentKey) ?? [];
    group.push(key);
    siblingsByParent.set(parentKey, group);
  }

  const parents = [...siblingsByParent.values()].map(group => getInfinityScaleParentChunkKey(group));
  if (new Set(parents).size !== parents.length) {
    throw new Error("Adaptive LOD region " + regionId + " produced duplicate parent chunks during coarsening");
  }
  return parents.sort();
}

function getSparseCoverage(
  chunkKeys: readonly string[],
  maxSparseChunkCount: number,
  regionId: string,
  direction: "source" | "target",
): string[] {
  const sparseKeys = new Set<string>();
  for (const chunkKey of chunkKeys) {
    const coverage = mapInfinityScaleChunkToSparseChunks(chunkKey, {
      maxSparseChunkCount,
    });
    for (const sparse of coverage.sparseChunks) {
      sparseKeys.add(sparse.key);
      if (sparseKeys.size > maxSparseChunkCount) {
        throw new RangeError(
          "Adaptive LOD region " + regionId + " " + direction +
          " coverage exceeds the SparseVoxelGrid chunk limit",
        );
      }
    }
  }
  return [...sparseKeys].sort();
}

/**
 * Compile logical-region ownership into deterministic hierarchical source and
 * target chunks, then prove both describe the exact same physical base-chunk
 * footprint. This is a pure preflight: it never creates chunks or moves cells.
 *
 * Coarsening requires complete sets of eight sibling chunks at every level.
 * Refinement enumerates every child at every level. Region ownership may not
 * overlap another region in physical SparseVoxelGrid space.
 */
export function compileInfinityScaleSpatialRegionMappings(
  mutations: readonly InfinityScaleAdaptiveMutation[],
  options: InfinityScaleSpatialRegionMappingOptions = {},
): readonly InfinityScaleSpatialRegionMutationMapping[] {
  if (!Array.isArray(mutations)) {
    throw new TypeError("Infinity Scale spatial region mapping requires a mutation array");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Infinity Scale spatial region mapping options must be an object");
  }

  const maxHierarchicalChunkCount =
    options.maxHierarchicalChunkCount ?? DEFAULT_MAX_HIERARCHICAL_CHUNKS;
  const maxSparseChunkCount = options.maxSparseChunkCount ?? DEFAULT_MAX_SPARSE_CHUNKS;
  assertLimit(maxHierarchicalChunkCount, "maxHierarchicalChunkCount");
  assertLimit(maxSparseChunkCount, "maxSparseChunkCount");

  const seenRegionIds = new Set<string>();
  const physicalOwners = new Map<string, string>();
  let totalSparseChunks = 0;
  const mappings: InfinityScaleSpatialRegionMutationMapping[] = [];

  for (let index = 0; index < mutations.length; index++) {
    const mutation = mutations[index];
    if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) {
      throw new TypeError("Infinity Scale spatial region mutation " + index + " must be an object");
    }
    const { regionId, fromLOD, toLOD } = mutation;
    if (typeof regionId !== "string" || regionId.length === 0 || regionId.trim() !== regionId) {
      throw new TypeError("Infinity Scale spatial region ID must be a non-empty canonical string");
    }
    if (seenRegionIds.has(regionId)) {
      throw new Error("Infinity Scale spatial region mapping contains duplicate region ID " + regionId);
    }
    seenRegionIds.add(regionId);

    if (!Number.isInteger(fromLOD) || !Number.isInteger(toLOD) ||
        fromLOD < 0 || fromLOD > 30 || toLOD < 0 || toLOD > 30) {
      throw new RangeError("Infinity Scale spatial region LOD values must be integers in the range 0..30");
    }
    if (fromLOD === toLOD) continue;

    const sourceChunkKeys = sortedUniqueChunkKeys(
      mutation.spatialChunkKeys ?? [],
      regionId,
      fromLOD,
    );
    if (sourceChunkKeys.length > maxHierarchicalChunkCount) {
      throw new RangeError(
        "Adaptive LOD region " + regionId + " source chunk count exceeds the configured limit",
      );
    }

    const sourceSparseChunkKeys = getSparseCoverage(
      sourceChunkKeys,
      maxSparseChunkCount,
      regionId,
      "source",
    );

    let targetChunkKeys = sourceChunkKeys;
    while (targetChunkKeys.some(key => parseInfinityScaleChunkKey(key).level !== toLOD)) {
      const currentLevel = parseInfinityScaleChunkKey(targetChunkKeys[0]).level;
      if (currentLevel > toLOD) {
        targetChunkKeys = refineOneLevel(targetChunkKeys);
      } else {
        targetChunkKeys = coarsenOneLevel(targetChunkKeys, regionId);
      }
      if (targetChunkKeys.length > maxHierarchicalChunkCount) {
        throw new RangeError(
          "Adaptive LOD region " + regionId + " target chunk count exceeds the configured limit",
        );
      }
    }

    // The source/target grids must cover exactly the same base-resolution chunks.
    const targetSparseChunkKeys = getSparseCoverage(
      targetChunkKeys,
      maxSparseChunkCount,
      regionId,
      "target",
    );
    if (sourceSparseChunkKeys.length !== targetSparseChunkKeys.length ||
        sourceSparseChunkKeys.some((key, i) => key !== targetSparseChunkKeys[i])) {
      throw new Error(
        "Adaptive LOD region " + regionId + " source and target physical chunk coverage is not equivalent",
      );
    }

    for (const sparseChunkKey of sourceSparseChunkKeys) {
      const previousOwner = physicalOwners.get(sparseChunkKey);
      if (previousOwner !== undefined && previousOwner !== regionId) {
        throw new Error(
          "Adaptive LOD spatial region ownership overlaps at SparseVoxelGrid chunk " +
          sparseChunkKey + " between " + previousOwner + " and " + regionId,
        );
      }
      physicalOwners.set(sparseChunkKey, regionId);
    }

    totalSparseChunks += sourceSparseChunkKeys.length;
    if (totalSparseChunks > maxSparseChunkCount) {
      throw new RangeError("Adaptive LOD transaction exceeds the total SparseVoxelGrid chunk mapping limit");
    }

    mappings.push(Object.freeze({
      regionId,
      fromLOD,
      toLOD,
      sourceChunkKeys: Object.freeze([...sourceChunkKeys]),
      targetChunkKeys: Object.freeze([...targetChunkKeys]),
      sourceSparseChunkKeys: Object.freeze([...sourceSparseChunkKeys]),
      targetSparseChunkKeys: Object.freeze([...targetSparseChunkKeys]),
    }));
  }

  mappings.sort((a, b) => a.regionId.localeCompare(b.regionId));
  return Object.freeze(mappings);
}
