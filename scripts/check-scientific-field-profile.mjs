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

const {
  evaluateScientificFieldProfile,
  assertScientificFieldProfile,
} = await load("src/infinity/ScientificFieldProfile.ts");

for (const falloff of ["linear", "smooth", "sphere", "sharp"]) {
  const profile = {
    schemaVersion: "scientific-field-profile-v1",
    kind: "radial",
    falloff,
    radius: 10,
  };
  assert.doesNotThrow(() => assertScientificFieldProfile(profile));
  assert.equal(evaluateScientificFieldProfile(profile, 11), 0);
  assert.equal(evaluateScientificFieldProfile(profile, 0), 1);
}

const linear = {
  schemaVersion: "scientific-field-profile-v1",
  kind: "radial",
  falloff: "linear",
  radius: 10,
};
assert.equal(evaluateScientificFieldProfile(linear, 5), 0.5);

const smooth = {
  ...linear,
  falloff: "smooth",
};
assert.equal(evaluateScientificFieldProfile(smooth, 5), 0.5);
assert.ok(evaluateScientificFieldProfile(smooth, 2) > evaluateScientificFieldProfile(linear, 2));

const sphere = {
  ...linear,
  falloff: "sphere",
};
assert.equal(evaluateScientificFieldProfile(sphere, 5), Math.sqrt(0.5));

const sharp = {
  ...linear,
  falloff: "sharp",
};
assert.equal(evaluateScientificFieldProfile(sharp, 5), 1);
assert.equal(evaluateScientificFieldProfile(sharp, 10), 0);

const zeroRadius = { ...linear, radius: 0 };
assert.equal(evaluateScientificFieldProfile(zeroRadius, 0), 1);
assert.equal(evaluateScientificFieldProfile(zeroRadius, 0.001), 0);

assert.throws(
  () => assertScientificFieldProfile({ ...linear, schemaVersion: "v0" }),
  /schema/,
);
assert.throws(
  () => assertScientificFieldProfile({ ...linear, radius: -1 }),
  /radius/,
);
assert.throws(
  () => assertScientificFieldProfile({ ...linear, falloff: "gaussian" }),
  /falloff/,
);
assert.throws(
  () => assertScientificFieldProfile({ ...linear, seed: Number.NaN }),
  /seed/,
);

console.log("PASS: radial profile schema validation");
console.log("PASS: linear/smooth/sphere/sharp falloff semantics");
console.log("PASS: boundary and zero-radius behavior");
console.log("PASS: invalid profiles fail closed");
