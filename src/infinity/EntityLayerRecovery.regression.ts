import { CELL_FIELDS, F } from "../core/CellState";
import { VoxelGrid } from "../core/VoxelGrid";
import { EntityLayer } from "../simulation/EntityLayer";

export function runEntityLayerRecoveryRegression(): void {
  const randomLayer = new EntityLayer(24681357);
  const randomStart = randomLayer.snapshot();
  const randomGridA = new VoxelGrid(4, 4, 1);
  randomGridA.buffer[randomGridA.idx(1, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  randomGridA.buffer[randomGridA.idx(2, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  randomGridA.buffer[randomGridA.idx(1, 1, 0) + F.ENERGY] = 120;
  randomGridA.buffer[randomGridA.idx(2, 1, 0) + F.ENERGY] = 130;
  randomLayer.tick(randomGridA, 0.01);
  const generatedA = JSON.stringify(randomLayer.getEntities().map(entity => ({
    ...entity,
    memoryBuffer: Array.from(entity.memoryBuffer),
  })));
  const rngAfterA = randomLayer.snapshot().rngState;

  randomLayer.restore(randomStart);
  const randomGridB = new VoxelGrid(4, 4, 1);
  randomGridB.buffer[randomGridB.idx(1, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  randomGridB.buffer[randomGridB.idx(2, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  randomGridB.buffer[randomGridB.idx(1, 1, 0) + F.ENERGY] = 120;
  randomGridB.buffer[randomGridB.idx(2, 1, 0) + F.ENERGY] = 130;
  randomLayer.tick(randomGridB, 0.01);
  const generatedB = JSON.stringify(randomLayer.getEntities().map(entity => ({
    ...entity,
    memoryBuffer: Array.from(entity.memoryBuffer),
  })));
  if (generatedA !== generatedB || randomLayer.snapshot().rngState !== rngAfterA) {
    throw new Error("EntityLayer restore did not replay randomized entity generation");
  }
  const grid = new VoxelGrid(4, 4, 1);
  grid.buffer[grid.idx(1, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  grid.buffer[grid.idx(2, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  grid.buffer[grid.idx(1, 1, 0) + F.ENERGY] = 120;
  grid.buffer[grid.idx(2, 1, 0) + F.ENERGY] = 130;

  const layer = new EntityLayer();
  layer.tick(grid, 0.01);
  const before = layer.getEntities();
  if (before.length !== 1) throw new Error("EntityLayer test fixture did not create one entity");

  const id = before[0].id;
  before[0].age = 73;
  before[0].stage = "mature";
  before[0].memoryBuffer[2] = 42;
  before[0].memPtr = 3;
  before[0].genome.metabolismRate = 0.7;

  const snapshot = layer.snapshot();
  layer.getEntities()[0].age = 900;
  layer.getEntities()[0].memoryBuffer[2] = -1;
  layer.getEntities()[0].genome.metabolismRate = 1.9;
  layer.clear();

  layer.restore(snapshot);
  const restored = layer.getEntities();
  if (restored.length !== 1 || restored[0].id !== id) {
    throw new Error("EntityLayer restore did not recover entity membership");
  }
  if (restored[0].age !== 73 || restored[0].stage !== "mature" ||
      restored[0].memoryBuffer[2] !== 42 || restored[0].memPtr !== 3 ||
      restored[0].genome.metabolismRate !== 0.7) {
    throw new Error("EntityLayer restore did not recover lifecycle, memory, or genome state");
  }

  snapshot.entities[0].age = -50;
  snapshot.entities[0].memoryBuffer[2] = 999;
  snapshot.entities[0].genome.metabolismRate = 99;
  if (restored[0].age !== 73 || restored[0].memoryBuffer[2] !== 42 ||
      restored[0].genome.metabolismRate !== 0.7) {
    throw new Error("EntityLayer restore retained aliases to snapshot data");
  }

  const nextId = restored[0].id + 1;
  layer.clear();
  layer.restore({ ...snapshot, entities: [], nextId });
  grid.buffer[grid.idx(1, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  grid.buffer[grid.idx(2, 1, 0) + F.BIO_POTENTIAL] = 0.8;
  layer.tick(grid, 0.01);
  if (layer.getEntities().length !== 1 || layer.getEntities()[0].id !== nextId) {
    throw new Error("EntityLayer restore did not recover the entity ID allocator");
  }

  const invalid = layer.snapshot();
  invalid.nextId = 1;
  let rejected = false;
  try {
    layer.restore(invalid);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("EntityLayer restore accepted an invalid ID allocator");

  if (grid.buffer.length !== grid.size * CELL_FIELDS) {
    throw new Error("EntityLayer recovery fixture grid has an invalid shape");
  }
}
