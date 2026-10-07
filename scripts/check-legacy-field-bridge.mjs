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

assert.throws(
  () => legacyToWorldCoordinate({x: -1, y: 0, z: 0}, {W:64,H:64,D:32}),
  /out of bounds/,
);

console.log("PASS: explicit legacy grid -> Infinite World axis contract");
console.log("PASS: legacy field normalization");
console.log("PASS: legacy brush mutation conversion and provenance metadata");
console.log("PASS: unsupported legacy-only fields fail closed");
