import { CHUNK_SIZE } from "../core/Chunk";
import {
  getInfinityScaleChildChunkKeys,
  getInfinityScaleParentChunkKey,
  mapInfinityScaleChunkToSparseChunks,
} from "./InfinityScaleSpatialChunkMapping";

export function runInfinityScaleSpatialChunkMappingRegression(): void {
  const parentKey = "1:-1,0,-1";
  const childKeys = getInfinityScaleChildChunkKeys(parentKey);
  if (childKeys.length !== 8 || new Set(childKeys).size !== 8) {
    throw new Error("Physical LOD refinement mapping did not produce eight unique child chunk keys");
  }

  const expectedChildren = new Set([
    "0:-2,0,-2", "0:-1,0,-2",
    "0:-2,1,-2", "0:-1,1,-2",
    "0:-2,0,-1", "0:-1,0,-1",
    "0:-2,1,-1", "0:-1,1,-1",
  ]);
  if (childKeys.some(key => !expectedChildren.has(key)) ||
      expectedChildren.size !== childKeys.length) {
    throw new Error("Physical child chunk coordinates are incorrect for a negative parent coordinate");
  }
  if (getInfinityScaleParentChunkKey([...childKeys].reverse()) !== parentKey) {
    throw new Error("Complete child siblings did not resolve to the original parent independent of input order");
  }

  let levelZeroChildrenRejected = false;
  try {
    getInfinityScaleChildChunkKeys("0:0,0,0");
  } catch {
    levelZeroChildrenRejected = true;
  }
  if (!levelZeroChildrenRejected) {
    throw new Error("A level-zero chunk unexpectedly produced finer children");
  }

  const invalidSiblingSets: Array<{ label: string; keys: string[] }> = [
    { label: "incomplete sibling set", keys: childKeys.slice(0, 7) },
    { label: "duplicate sibling", keys: [...childKeys.slice(0, 7), childKeys[0]] },
    { label: "mixed child levels", keys: [...childKeys.slice(0, 7), "1:0,0,0"] },
    { label: "child from another parent", keys: [...childKeys.slice(0, 7), "0:20,20,20"] },
  ];
  for (const candidate of invalidSiblingSets) {
    let rejected = false;
    try {
      getInfinityScaleParentChunkKey(candidate.keys);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error("Physical LOD parent resolution accepted " + candidate.label);
    }
  }

  const overflowParent = "1:9007199254740991,0,0";
  let childCoordinateOverflowRejected = false;
  try {
    getInfinityScaleChildChunkKeys(overflowParent);
  } catch {
    childCoordinateOverflowRejected = true;
  }
  if (!childCoordinateOverflowRejected) {
    throw new Error("Physical LOD child mapping accepted unsafe doubled coordinates");
  }

  const levelZeroCoverage = mapInfinityScaleChunkToSparseChunks("0:-1,2,3");
  if (levelZeroCoverage.sparseChunkSize !== CHUNK_SIZE ||
      levelZeroCoverage.lodChunkSize !== CHUNK_SIZE ||
      levelZeroCoverage.sparseChunks.length !== 1 ||
      levelZeroCoverage.sparseChunks[0].key !== "-1,2,3") {
    throw new Error("Level-zero LOD chunk did not map to its exact SparseVoxelGrid key");
  }

  const parentCoverage = mapInfinityScaleChunkToSparseChunks(parentKey);
  const expectedSparseKeys = new Set([
    "-2,0,-2", "-1,0,-2", "-2,1,-2", "-1,1,-2",
    "-2,0,-1", "-1,0,-1", "-2,1,-1", "-1,1,-1",
  ]);
  if (parentCoverage.sparseChunks.length !== 8 ||
      parentCoverage.sparseChunks.some(chunk => !expectedSparseKeys.has(chunk.key)) ||
      expectedSparseKeys.size !== parentCoverage.sparseChunks.length ||
      parentCoverage.bounds.minX !== -64 || parentCoverage.bounds.maxX !== -1 ||
      parentCoverage.bounds.minY !== 0 || parentCoverage.bounds.maxY !== 63 ||
      parentCoverage.bounds.minZ !== -64 || parentCoverage.bounds.maxZ !== -1) {
    throw new Error("Hierarchical LOD chunk did not expand to its exact physical SparseVoxelGrid coverage");
  }
  if (!Object.isFrozen(parentCoverage) ||
      !Object.isFrozen(parentCoverage.bounds) ||
      !Object.isFrozen(parentCoverage.sparseChunks) ||
      parentCoverage.sparseChunks.some(chunk => !Object.isFrozen(chunk))) {
    throw new Error("Physical chunk coverage mapping exposed mutable result records");
  }

  const finerCoverage = mapInfinityScaleChunkToSparseChunks("2:1,-1,0");
  if (finerCoverage.sparseChunks.length !== 64) {
    throw new Error("Level-two hierarchical chunk did not expand to 64 base SparseVoxelGrid chunks");
  }
  const firstKey = finerCoverage.sparseChunks[0].key;
  const lastKey = finerCoverage.sparseChunks[finerCoverage.sparseChunks.length - 1].key;
  if (firstKey !== "4,-4,0" || lastKey !== "7,-1,3") {
    throw new Error("Level-two physical SparseVoxelGrid chunk enumeration is not deterministic");
  }

  const invalidMappings: Array<{ label: string; key: string; options: Parameters<typeof mapInfinityScaleChunkToSparseChunks>[1] }> = [
    { label: "partial sparse-chunk alignment", key: "0:0,0,0", options: { lodChunkSize: 48, sparseChunkSize: 32 } },
    { label: "expansion cap", key: "1:0,0,0", options: { maxSparseChunkCount: 7 } },
    { label: "invalid chunk size", key: "0:0,0,0", options: { sparseChunkSize: 0 } },
    { label: "invalid expansion cap", key: "0:0,0,0", options: { maxSparseChunkCount: 0 } },
  ];
  for (const candidate of invalidMappings) {
    let rejected = false;
    try {
      mapInfinityScaleChunkToSparseChunks(candidate.key, candidate.options);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error("Physical sparse chunk mapper accepted " + candidate.label);
    }
  }

  console.log("Infinity Scale parent/child physical chunk mapping and SparseVoxelGrid coverage: PASS");
}
