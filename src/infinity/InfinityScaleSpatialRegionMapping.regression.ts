import {
  getInfinityScaleChildChunkKeys,
} from "./InfinityScaleSpatialChunkMapping";
import {
  compileInfinityScaleSpatialRegionMappings,
} from "./InfinityScaleSpatialRegionMapping";
import { InfinityScaleLODState } from "./InfinityScaleLODState";

function expectRejected(label: string, operation: () => unknown): void {
  let rejected = false;
  try {
    operation();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Spatial region mapping accepted " + label);
}

export function runInfinityScaleSpatialRegionMappingRegression(): void {
  const parentKey = "1:-1,0,-1";
  const childKeys = [...getInfinityScaleChildChunkKeys(parentKey)];
  const expectedChildren = [...childKeys].sort();

  const refined = compileInfinityScaleSpatialRegionMappings([{
    regionId: "forest-west",
    fromLOD: 1,
    toLOD: 0,
    spatialChunkKeys: [parentKey],
  }]);
  if (refined.length !== 1 ||
      refined[0].regionId !== "forest-west" ||
      refined[0].sourceChunkKeys[0] !== parentKey ||
      refined[0].targetChunkKeys.join("|") !== expectedChildren.join("|")) {
    throw new Error("Logical region refinement did not produce its exact deterministic physical child chunks");
  }
  if (refined[0].sourceSparseChunkKeys.length !== 8 ||
      refined[0].sourceSparseChunkKeys.join("|") !== refined[0].targetSparseChunkKeys.join("|")) {
    throw new Error("Refinement changed the logical region's physical SparseVoxelGrid footprint");
  }
  if (!Object.isFrozen(refined) ||
      !Object.isFrozen(refined[0]) ||
      !Object.isFrozen(refined[0].sourceChunkKeys) ||
      !Object.isFrozen(refined[0].targetChunkKeys) ||
      !Object.isFrozen(refined[0].sourceSparseChunkKeys) ||
      !Object.isFrozen(refined[0].targetSparseChunkKeys)) {
    throw new Error("Spatial region mapping exposed mutable ownership metadata");
  }

  const reversedChildren = [...childKeys].reverse();
  const coarsened = compileInfinityScaleSpatialRegionMappings([{
    regionId: "forest-west",
    fromLOD: 0,
    toLOD: 1,
    spatialChunkKeys: reversedChildren,
  }]);
  if (coarsened.length !== 1 ||
      coarsened[0].targetChunkKeys.length !== 1 ||
      coarsened[0].targetChunkKeys[0] !== parentKey ||
      coarsened[0].sourceSparseChunkKeys.join("|") !== coarsened[0].targetSparseChunkKeys.join("|")) {
    throw new Error("Complete sibling ownership did not coarsen to the exact original parent and base coverage");
  }

  const multiLevel = compileInfinityScaleSpatialRegionMappings([{
    regionId: "deep-region",
    fromLOD: 2,
    toLOD: 0,
    spatialChunkKeys: ["2:1,-1,0"],
  }]);
  if (multiLevel[0].targetChunkKeys.length !== 64 ||
      multiLevel[0].sourceSparseChunkKeys.length !== 64 ||
      multiLevel[0].sourceSparseChunkKeys.join("|") !== multiLevel[0].targetSparseChunkKeys.join("|")) {
    throw new Error("Multi-level refinement did not preserve all 64 physical base chunks");
  }

  const callerKeys = [parentKey];
  const detached = compileInfinityScaleSpatialRegionMappings([{
    regionId: "detached",
    fromLOD: 1,
    toLOD: 0,
    spatialChunkKeys: callerKeys,
  }]);
  callerKeys[0] = "1:99,99,99";
  if (detached[0].sourceChunkKeys[0] !== parentKey) {
    throw new Error("Spatial mapping retained a caller-owned chunk key array");
  }

  expectRejected("a changed-LOD region without physical chunk ownership", () =>
    compileInfinityScaleSpatialRegionMappings([{
      regionId: "unbound",
      fromLOD: 1,
      toLOD: 0,
    }]),
  );
  expectRejected("an incomplete sibling set during coarsening", () =>
    compileInfinityScaleSpatialRegionMappings([{
      regionId: "incomplete",
      fromLOD: 0,
      toLOD: 1,
      spatialChunkKeys: childKeys.slice(0, 7),
    }]),
  );
  expectRejected("a source key whose level disagrees with fromLOD", () =>
    compileInfinityScaleSpatialRegionMappings([{
      regionId: "wrong-level",
      fromLOD: 0,
      toLOD: 1,
      spatialChunkKeys: [parentKey],
    }]),
  );
  expectRejected("duplicate source chunk ownership", () =>
    compileInfinityScaleSpatialRegionMappings([{
      regionId: "duplicate-source",
      fromLOD: 1,
      toLOD: 0,
      spatialChunkKeys: [parentKey, parentKey],
    }]),
  );
  expectRejected("duplicate logical region IDs", () =>
    compileInfinityScaleSpatialRegionMappings([
      { regionId: "duplicate-region", fromLOD: 1, toLOD: 0, spatialChunkKeys: [parentKey] },
      { regionId: "duplicate-region", fromLOD: 1, toLOD: 0, spatialChunkKeys: ["1:0,0,0"] },
    ]),
  );
  expectRejected("overlapping physical coverage owned by separate logical regions", () =>
    compileInfinityScaleSpatialRegionMappings([
      { regionId: "coarse-owner", fromLOD: 1, toLOD: 0, spatialChunkKeys: [parentKey] },
      { regionId: "fine-owner", fromLOD: 0, toLOD: 1, spatialChunkKeys: childKeys },
    ]),
  );
  expectRejected("an expansion beyond the hierarchical chunk cap", () =>
    compileInfinityScaleSpatialRegionMappings(
      [{ regionId: "too-wide", fromLOD: 2, toLOD: 0, spatialChunkKeys: ["2:1,-1,0"] }],
      { maxHierarchicalChunkCount: 63 },
    ),
  );
  expectRejected("an expansion beyond the sparse chunk cap", () =>
    compileInfinityScaleSpatialRegionMappings(
      [{ regionId: "too-many-sparse", fromLOD: 2, toLOD: 0, spatialChunkKeys: ["2:1,-1,0"] }],
      { maxSparseChunkCount: 63 },
    ),
  );

  // Physical region ownership is durable authoritative state, not a mapping
  // supplied by the planner at commit time.
  const ownershipState = new InfinityScaleLODState();
  ownershipState.ensureChunk(parentKey, 1);
  ownershipState.bindRegionOwnership("forest-west", [parentKey]);
  const ownerKeys = ownershipState.getRegionChunkKeys("forest-west");
  if (!ownerKeys || ownerKeys.join("|") !== parentKey || !Object.isFrozen(ownerKeys)) {
    throw new Error("LOD state did not publish frozen authoritative region chunk ownership");
  }
  const ownershipRevision = ownershipState.getRevision();
  expectRejected("overlapping physical chunks bound to another logical region", () =>
    ownershipState.bindRegionOwnership("forest-east", [parentKey]),
  );
  if (ownershipState.getRevision() !== ownershipRevision ||
      ownershipState.getRegionChunkKeys("forest-west")?.join("|") !== parentKey ||
      ownershipState.getRegionChunkKeys("forest-east") !== undefined) {
    throw new Error("Rejected overlapping region bind partially changed authoritative ownership");
  }
  expectRejected("deleting a chunk while its logical region still owns it", () =>
    ownershipState.deleteChunk(parentKey),
  );
  if (!ownershipState.hasChunk(parentKey) ||
      ownershipState.getRegionChunkKeys("forest-west")?.join("|") !== parentKey) {
    throw new Error("Rejected owned-chunk deletion mutated chunk or region membership");
  }

  const ownershipSnapshot = ownershipState.snapshot();
  if (ownershipSnapshot.regionOwnership?.length !== 1 ||
      ownershipSnapshot.regionOwnership[0].regionId !== "forest-west" ||
      ownershipSnapshot.regionOwnership[0].chunkKeys.join("|") !== parentKey) {
    throw new Error("LOD state snapshot omitted authoritative logical region ownership");
  }
  const restoredOwnershipState = new InfinityScaleLODState();
  restoredOwnershipState.restore(ownershipSnapshot);
  if (restoredOwnershipState.getRegionChunkKeys("forest-west")?.join("|") !== parentKey ||
      !restoredOwnershipState.hasChunk(parentKey)) {
    throw new Error("LOD recovery did not restore region ownership with its hierarchical chunks");
  }

  const malformedOwnershipSnapshot = restoredOwnershipState.snapshot();
  malformedOwnershipSnapshot.regionOwnership![0].chunkKeys[0] = "1:88,88,88";
  const beforeMalformedRestoreRevision = restoredOwnershipState.getRevision();
  const beforeMalformedRestoreKeys = restoredOwnershipState.keys().join("|");
  expectRejected("a region snapshot pointing at a missing physical chunk", () =>
    restoredOwnershipState.restore(malformedOwnershipSnapshot),
  );
  if (restoredOwnershipState.getRevision() !== beforeMalformedRestoreRevision ||
      restoredOwnershipState.keys().join("|") !== beforeMalformedRestoreKeys ||
      restoredOwnershipState.getRegionChunkKeys("forest-west")?.join("|") !== parentKey) {
    throw new Error("Rejected region ownership restore partially changed chunks, membership or revision");
  }

  if (!restoredOwnershipState.removeRegionOwnership("forest-west") ||
      !restoredOwnershipState.deleteChunk(parentKey)) {
    throw new Error("Explicit region release did not permit subsequent physical chunk deletion");
  }
  if (restoredOwnershipState.getRegionChunkKeys("forest-west") !== undefined) {
    throw new Error("Region identity remained published after explicit ownership release");
  }

  console.log("Infinity Scale logical region ownership, recovery, and footprint-preserving LOD mapping: PASS");
}
