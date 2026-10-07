import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
async function load(path) {
  const source = await readFile(new URL(path, root), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const mod = await load("src/infinity/LegacyScientificFieldBridge.ts");
const {
  LEGACY_WORLD_AXIS_MAP,
  legacyToWorldCoordinate,
  isLegacyCoordinateInBounds,
  normalizeLegacyCell,
  legacyBrushDeltaToMutation,
  sculptInjectToMutation,
  sculptErodeToMutation,
  sculptNoiseToMutation,
  sculptPatternToMutation,
  sculptStampToMutation,
  sculptSmartBrushToMutation,
  sculptSmoothToMutation,
  sculptEraseToMutation,
} = mod;

assert.deepEqual(LEGACY_WORLD_AXIS_MAP, { x: "x", y: "z", z: "y" });
assert.equal(isLegacyCoordinateInBounds({x: 0, y: 0, z: 0}, {W:64,H:64,D:32}), true);
assert.equal(isLegacyCoordinateInBounds({x: 63, y: 63, z: 31}, {W:64,H:64,D:32}), true);
assert.equal(isLegacyCoordinateInBounds({x: 64, y: 0, z: 0}, {W:64,H:64,D:32}), false);

assert.deepEqual(
  legacyToWorldCoordinate({x: 7, y: 11, z: 3}, {W:64,H:64,D:32}),
  {x: 7, y: 3, z: 11},
);

assert.deepEqual(
  normalizeLegacyCell({
    energy: 1000,
    density: 0.8,
    information: 120,
    entropy: 0.4,
    temperature: 500,
    bioPotential: 0.7,
    materialId: 3,
  }),
  {
    energy: 10,
    density: 0.8,
    information: 12,
    entropy: 0.4,
    temperature: 50,
    biology: 0.7,
    material: 3,
  },
);

const mutation = legacyBrushDeltaToMutation(
  {x: 4, y: 9, z: 2},
  {energy: 200, density: 0.2, information: 30, entropy: 0.1, temperature: 50, bioPotential: 0.4},
  8,
  { source: "legacy-smart-brush", brush: "Forest" },
);
assert.deepEqual({x: mutation.x, y: mutation.y, z: mutation.z}, {x: 4, y: 2, z: 9});
assert.deepEqual(mutation.delta, {
  energy: 2,
  density: 0.2,
  information: 3,
  entropy: 0.1,
  temperature: 5,
  biology: 0.4,
});
assert.equal(mutation.metadata.coordinateContract, "legacy-grid-x-y-z-to-world-x-z-y-v1");
assert.ok(Array.isArray(mutation.metadata.unsupportedFields));
assert.ok(mutation.metadata.unsupportedFields.includes("materialId"));

const inject = sculptInjectToMutation({x: 3, y: 5, z: 2}, 4, 2, {energy: 1, density: 0.5});
assert.deepEqual(inject.delta, {energy: 0.24, density: 0.00024});
assert.equal(inject.metadata.source, "legacy-sculpt-inject");

const erode = sculptErodeToMutation({x: 3, y: 5, z: 2}, 4, 2);
assert.deepEqual(erode.delta, {density: -0.02, entropy: 0.012, temperature: -0.03});
assert.equal(erode.metadata.source, "legacy-sculpt-erode");

const noise = sculptNoiseToMutation({x:3,y:5,z:2}, 6, 2, 8, 17, {energy:1, information:1});
assert.deepEqual({x:noise.x,y:noise.y,z:noise.z}, {x:3,y:2,z:5});
assert.equal(noise.delta.energy, 0.2);
assert.equal(noise.delta.information, 0.04);
assert.equal(noise.spatialPattern.kind, "noise3");
assert.equal(noise.spatialPattern.seed, 17);

const pattern = sculptPatternToMutation({x:3,y:5,z:2}, 6, 2, 8, {energy:1,density:1,information:1});
assert.equal(pattern.delta.energy, 0.16);
assert.equal(pattern.delta.density, 0.02);
assert.equal(pattern.delta.information, 0.3);
assert.equal(pattern.spatialPattern.kind, "pattern3");

const stamp = sculptStampToMutation({x:3,y:5,z:2}, 6, 2);
assert.equal(stamp.delta.density, 0.02);
assert.equal(stamp.delta.information, 0.2);
assert.equal(stamp.spatialPattern.kind, "stamp-lattice");
assert.equal(stamp.spatialPattern.period, 4);

const volcano = sculptSmartBrushToMutation("Volcano", {x:8,y:9,z:3}, 5);
assert.deepEqual({x:volcano.x,y:volcano.y,z:volcano.z}, {x:8,y:0,z:9});
assert.equal(volcano.spatialPattern.kind, "smart-brush");
assert.equal(volcano.spatialPattern.name, "Volcano");
assert.equal(volcano.delta.energy, 9);
assert.equal(volcano.delta.temperature, 60);

const ocean = sculptSmartBrushToMutation("Ocean", {x:8,y:9,z:3}, 5);
assert.deepEqual(ocean.operations.density, {mode:"max",value:.7});
assert.deepEqual(ocean.operations.temperature, {mode:"max",value:7});

const forest = sculptSmartBrushToMutation("Forest", {x:8,y:9,z:3}, 5, 3);
assert.equal(forest.spatialPattern.selectedLegacyZ, 3);
assert.equal(forest.delta.information, 18);

const radiation = sculptSmartBrushToMutation("Radiation", {x:8,y:9,z:3}, 5);
assert.equal(radiation.delta.information, -5);

const erase = sculptEraseToMutation({x:3,y:5,z:2}, 4, 0.75);
assert.deepEqual({x:erase.x,y:erase.y,z:erase.z}, {x:3,y:2,z:5});
assert.deepEqual(erase.scale, {energy:.25,density:.25,information:.25,entropy:.25,temperature:.25,biology:.25});
assert.equal(erase.metadata.brush, "Erase");
assert.ok(erase.metadata.unsupportedFields.includes("materialId"));

const smoothMutation = sculptSmoothToMutation({x:3,y:5,z:2}, 4, 1);
assert.deepEqual({x:smoothMutation.x,y:smoothMutation.y,z:smoothMutation.z}, {x:3,y:2,z:5});
assert.equal(smoothMutation.operations.energy.mode, "smooth6");
assert.equal(smoothMutation.operations.energy.value, 1);
assert.equal(smoothMutation.metadata.brush, "Smooth");

assert.throws(
  () => legacyToWorldCoordinate({x: -1, y: 0, z: 0}, {W:64,H:64,D:32}),
  /out of bounds/,
);

console.log("PASS: explicit legacy grid -> Infinite World axis contract");
console.log("PASS: legacy field normalization");
console.log("PASS: legacy brush mutation conversion and provenance metadata");
console.log("PASS: unsupported legacy-only fields fail closed");
