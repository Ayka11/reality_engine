import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function compile(path, replacements = []) {
  let source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement);
  return js;
}

const spatialJs = await compile("src/infinity/ScientificFieldSpatialPattern.ts");
const spatialUrl = `data:text/javascript;base64,${Buffer.from(spatialJs).toString("base64")}`;

const profileJs = await compile("src/infinity/ScientificFieldProfile.ts");
const profileUrl = `data:text/javascript;base64,${Buffer.from(profileJs).toString("base64")}`;

const providerJs = await compile("src/infinity/MutableWorldFieldProvider.ts", [
  [/import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from ['"]\.\/ScientificFieldSpatialPattern['"]/, `import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from "${spatialUrl}"`],
  [/import type \{ ScientificFieldSpatialPattern, ScientificSmartBrushPattern \} from ['"]\.\/ScientificFieldSpatialPattern['"]/, ''],
  [/import { assertScientificFieldProfile, evaluateScientificFieldProfile } from ['"]\.\/ScientificFieldProfile['"]/, `import { assertScientificFieldProfile, evaluateScientificFieldProfile } from "${profileUrl}"`],
  [/import type { ScientificFieldProfile } from ['"]\.\/ScientificFieldProfile['"]/, ''],
  [/import type \{ ScientificFieldProvider \} from ['"]\.\/ScientificFieldProvider['"]/, ''],
  [/import type \{ ScientificFieldSample \} from ['"]\.\/FieldSampler['"]/, ''],
]);
const provider = await import(`data:text/javascript;base64,${Buffer.from(providerJs).toString("base64")}`);
const { MutableWorldFieldProvider } = provider;

const base = {
  sample: (x, y, z) => ({
    energy: 1 + x*x + y*y + z*z,
    density: 0.2,
    information: 1,
    entropy: 0.1,
    temperature: 1,
    biology: 0.2,
    material: 0,
  }),
};

const mutable = new MutableWorldFieldProvider(base);
const profile = {
  schemaVersion: "scientific-field-profile-v1",
  kind: "radial",
  falloff: "smooth",
  radius: 10,
};

mutable.apply({
  kind: "brush",
  x: 0,
  y: 0,
  z: 0,
  radius: 10,
  profile,
  delta: { energy: 10 },
});

assert.equal(mutable.sample(0, 0, 0).energy, 11);
assert.equal(mutable.sample(0, 0, 5).energy, 6);
assert.equal(mutable.sample(0, 0, 10).energy, 1);
assert.ok(mutable.sample(0, 0, 2).energy > mutable.sample(0, 0, 5).energy);

const state = mutable.getState();
assert.deepEqual(state.lastMutation?.profile, profile);
assert.equal(state.lastMutation?.radius, 10);

assert.throws(() => mutable.apply({
  kind: "brush",
  x: 0, y: 0, z: 0,
  radius: 8,
  profile,
  delta: { energy: 1 },
}), /radius must match/);

assert.throws(() => mutable.apply({
  kind: "brush",
  x: 0, y: 0, z: 0,
  profile: { ...profile, falloff: "invalid" },
  delta: { energy: 1 },
}), /falloff/);

const legacy = new MutableWorldFieldProvider(base);
legacy.applyRadial("brush", 0, 0, 0, 10, { energy: 10 });
assert.equal(legacy.sample(0, 0, 5).energy, 6);
assert.equal(legacy.sample(0, 0, 10).energy, 1);

const smooth = new MutableWorldFieldProvider(base);
smooth.apply({
  kind: "brush", x: 0, y: 0, z: 0, radius: 1,
  operations: {
    energy: { mode: "smooth6", value: 1 },
    density: { mode: "smooth6", value: 1 },
    information: { mode: "smooth6", value: 1 },
    entropy: { mode: "smooth6", value: 1 },
    temperature: { mode: "smooth6", value: 1 },
    biology: { mode: "smooth6", value: 1 },
  },
});
assert.equal(smooth.sample(0, 0, 0).energy, 1.65);
assert.equal(smooth.sample(0, 0, 0).energy, smooth.sample(0, 0, 0).energy);

console.log("PASS: profiled mutations use authoritative spatial falloff");
console.log("PASS: profile is retained in mutation state");
console.log("PASS: profile/radius mismatch fails closed");
console.log("PASS: invalid profiles fail closed");
console.log("PASS: legacy radial mutations retain linear semantics");
