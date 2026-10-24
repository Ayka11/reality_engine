import { CELL_FIELDS, F } from "../core/CellState";
import { VoxelGrid } from "../core/VoxelGrid";
import { EntityLayer, type EntityLayerSnapshot } from "./EntityLayer";

type Coordinate = [number, number, number];

function writeBlob(grid: VoxelGrid, cells: Coordinate[], energy = 500): void {
  for (const [x, y, z] of cells) {
    const index = z * grid.H * grid.W + y * grid.W + x;
    const base = index * CELL_FIELDS;
    grid.buffer[base + F.BIO_POTENTIAL] = 0.8;
    grid.buffer[base + F.ENERGY] = energy;
  }
}

function cloneSnapshot(snapshot: EntityLayerSnapshot): EntityLayerSnapshot {
  return {
    entities: snapshot.entities.map(entity => ({
      ...entity,
      cells: [...entity.cells],
      centroid: [...entity.centroid] as [number, number, number],
      genome: { ...entity.genome },
      memoryBuffer: new Float32Array(entity.memoryBuffer),
      colorRgb: [...entity.colorRgb] as [number, number, number],
    })),
    bioThreshold: snapshot.bioThreshold,
    mutationStrength: snapshot.mutationStrength,
    nextId: snapshot.nextId,
    extinctCount: snapshot.extinctCount,
    rngState: snapshot.rngState,
  };
}

function equal(a: unknown, b: unknown, message: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message);
}

export function runEntityLayerRecoveryRegression(): void {
  const grid = new VoxelGrid(12, 12, 6);
  const layer = new EntityLayer(0x13579bdf);
  writeBlob(grid, [[2, 2, 1], [3, 2, 1], [2, 3, 1], [3, 3, 1]]);
  layer.tick(grid, 1 / 60);

  const checkpoint = layer.snapshot();
  if (checkpoint.entities.length !== 1 ||
      checkpoint.entities[0].id !== 1 ||
      checkpoint.nextId !== 2 ||
      checkpoint.rngState === 0) {
    throw new Error("EntityLayer checkpoint did not capture the expected entity and allocator state");
  }

  // Add a second disconnected bio-blob. Creating its entity consumes RNG for
  // the genome, symbol and color. Replaying from the checkpoint must reproduce
  // every generated value and every grid write.
  writeBlob(grid, [[8, 8, 1], [9, 8, 1], [8, 9, 1], [9, 9, 1]], 700);
  const branchGrid = grid.buffer.slice();
  layer.tick(grid, 1 / 60);
  const expectedState = layer.snapshot();
  const expectedGrid = grid.buffer.slice();
  if (expectedState.entities.length !== 2 ||
      expectedState.entities[1].id !== checkpoint.nextId) {
    throw new Error("EntityLayer replay fixture did not exercise a new entity ID");
  }

  layer.restore(checkpoint, grid.size);
  grid.buffer.set(branchGrid);
  layer.tick(grid, 1 / 60);
  equal(layer.snapshot(), expectedState, "EntityLayer recovery did not replay entity generation and state");
  equal(Array.from(grid.buffer), Array.from(expectedGrid), "EntityLayer recovery did not replay grid mutations");

  // Every nested mutable member must be copied in both snapshot and restore.
  const liveBeforeDetachedMutation = layer.snapshot();
  const detached = layer.snapshot();
  detached.entities[0].cells[0] = -99;
  detached.entities[0].centroid[0] = -99;
  detached.entities[0].genome.metabolismRate = -99;
  detached.entities[0].memoryBuffer[0] = -99;
  detached.entities[0].colorRgb[0] = -99;
  equal(layer.snapshot(), liveBeforeDetachedMutation, "EntityLayer snapshot aliases nested live entity data");

  const suppliedSnapshot = cloneSnapshot(checkpoint);
  layer.restore(suppliedSnapshot, grid.size);
  suppliedSnapshot.entities[0].cells[0] = -100;
  suppliedSnapshot.entities[0].genome.bioAffinity = -100;
  suppliedSnapshot.entities[0].memoryBuffer[0] = -100;
  if (layer.snapshot().entities[0].cells[0] < 0 ||
      layer.snapshot().entities[0].genome.bioAffinity < 0 ||
      layer.snapshot().entities[0].memoryBuffer[0] < 0) {
    throw new Error("EntityLayer restore retained references to caller-owned snapshot data");
  }

  // Run malformed snapshots against a two-entity state so cross-entity
  // duplicate-cell rejection is exercised, not just the single-entity case.
  layer.restore(expectedState, grid.size);
  runEntityLayerInvalidSnapshotRegression(layer, grid.size);

  // Entity IDs and extinction counters are per instance, not module-global.
  const gridA = new VoxelGrid(12, 12, 6);
  const gridB = new VoxelGrid(12, 12, 6);
  writeBlob(gridA, [[2, 2, 1], [3, 2, 1]]);
  writeBlob(gridB, [[2, 2, 1], [3, 2, 1]]);
  const layerA = new EntityLayer(11);
  const layerB = new EntityLayer(22);
  layerA.tick(gridA, 1 / 60);
  layerB.tick(gridB, 1 / 60);
  if (layerA.getEntities()[0]?.id !== 1 ||
      layerB.getEntities()[0]?.id !== 1 ||
      layerA.totalSpawned !== 1 ||
      layerB.totalSpawned !== 1) {
    throw new Error("EntityLayer IDs are not isolated per instance");
  }
  layerA.clear();
  if (layerB.totalSpawned !== 1 || layerB.extinctCount !== 0) {
    throw new Error("Clearing one EntityLayer changed another instance's counters");
  }
}

export function runEntityLayerInvalidSnapshotRegression(
  layer = new EntityLayer(0x13579bdf),
  cellCount = 12 * 12 * 6,
): void {
  if (layer.getEntities().length === 0) {
    const grid = new VoxelGrid(12, 12, 6);
    writeBlob(grid, [[2, 2, 1], [3, 2, 1], [2, 3, 1]]);
    layer.tick(grid, 1 / 60);
  }
  const baseline = layer.snapshot();

  const assertRejectedWithoutMutation = (candidate: unknown, label: string): void => {
    const before = JSON.stringify(layer.snapshot());
    let rejected = false;
    try {
      layer.restore(candidate as EntityLayerSnapshot, cellCount);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`EntityLayer accepted malformed recovery snapshot: ${label}`);
    }
    if (JSON.stringify(layer.snapshot()) !== before) {
      throw new Error(`Rejected EntityLayer snapshot partially mutated live state: ${label}`);
    }
  };

  assertRejectedWithoutMutation(null, "null snapshot");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), rngState: 0 }, "zero PRNG state");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), rngState: 0x100000000 }, "out-of-range PRNG state");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), nextId: 0 }, "invalid entity ID allocator");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), extinctCount: -1 }, "negative extinction counter");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), bioThreshold: Number.NaN }, "non-finite bio threshold");
  assertRejectedWithoutMutation({ ...cloneSnapshot(baseline), mutationStrength: -1 }, "negative mutation strength");

  const nullEntity = cloneSnapshot(baseline);
  (nullEntity.entities as unknown[])[0] = null;
  assertRejectedWithoutMutation(nullEntity, "null entity record");

  const duplicateId = cloneSnapshot(baseline);
  if (duplicateId.entities.length < 2) {
    duplicateId.entities.push({ ...duplicateId.entities[0], cells: [...duplicateId.entities[0].cells],
      centroid: [...duplicateId.entities[0].centroid] as [number, number, number],
      genome: { ...duplicateId.entities[0].genome },
      memoryBuffer: new Float32Array(duplicateId.entities[0].memoryBuffer),
      colorRgb: [...duplicateId.entities[0].colorRgb] as [number, number, number],
    });
    duplicateId.nextId = Math.max(duplicateId.nextId, duplicateId.entities.length + 1);
  }
  duplicateId.entities[1].id = duplicateId.entities[0].id;
  assertRejectedWithoutMutation(duplicateId, "duplicate entity ID");

  const invalidAllocator = cloneSnapshot(baseline);
  invalidAllocator.nextId = Math.max(...invalidAllocator.entities.map(entity => entity.id));
  assertRejectedWithoutMutation(invalidAllocator, "allocator not greater than restored IDs");

  const outOfBoundsCell = cloneSnapshot(baseline);
  outOfBoundsCell.entities[0].cells[0] = cellCount;
  assertRejectedWithoutMutation(outOfBoundsCell, "cell index out of range");

  const duplicateCell = cloneSnapshot(baseline);
  duplicateCell.entities[0].cells.push(duplicateCell.entities[0].cells[0]);
  assertRejectedWithoutMutation(duplicateCell, "duplicate cell within an entity");

  const nonFiniteGenome = cloneSnapshot(baseline);
  nonFiniteGenome.entities[0].genome.metabolismRate = Number.NaN;
  assertRejectedWithoutMutation(nonFiniteGenome, "non-finite genome field");

  const outOfRangeGenome = cloneSnapshot(baseline);
  outOfRangeGenome.entities[0].genome.memoryDecay = 2;
  assertRejectedWithoutMutation(outOfRangeGenome, "out-of-range genome field");

  const wrongMemoryBufferType = cloneSnapshot(baseline);
  (wrongMemoryBufferType.entities[0] as unknown as { memoryBuffer: unknown }).memoryBuffer = [0];
  assertRejectedWithoutMutation(wrongMemoryBufferType, "non-Float32Array memory buffer");

  const wrongMemoryBufferLength = cloneSnapshot(baseline);
  wrongMemoryBufferLength.entities[0].memoryBuffer = new Float32Array(7);
  assertRejectedWithoutMutation(wrongMemoryBufferLength, "wrong memory buffer length");

  const nonFiniteMemory = cloneSnapshot(baseline);
  nonFiniteMemory.entities[0].memoryBuffer[0] = Number.POSITIVE_INFINITY;
  assertRejectedWithoutMutation(nonFiniteMemory, "non-finite memory buffer value");

  const invalidSymbol = cloneSnapshot(baseline);
  invalidSymbol.entities[0].symbol = "!";
  assertRejectedWithoutMutation(invalidSymbol, "invalid entity symbol");

  const invalidStage = cloneSnapshot(baseline);
  (invalidStage.entities[0] as unknown as { stage: string }).stage = "unknown";
  assertRejectedWithoutMutation(invalidStage, "invalid entity stage");

  const invalidReproductionGauge = cloneSnapshot(baseline);
  invalidReproductionGauge.entities[0].reproCounter = 1.5;
  assertRejectedWithoutMutation(invalidReproductionGauge, "out-of-range reproduction gauge");

  if (baseline.entities.length >= 2) {
    const overlap = cloneSnapshot(baseline);
    overlap.entities[1].cells[0] = overlap.entities[0].cells[0];
    assertRejectedWithoutMutation(overlap, "overlapping cells across entities");
  }
}
