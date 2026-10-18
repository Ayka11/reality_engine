import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
async function load(path, replacements = []) {
  let source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement);
  return js;
}
const spatialJs = await load("src/infinity/ScientificFieldSpatialPattern.ts");
const spatialUrl = `data:text/javascript;base64,${Buffer.from(spatialJs).toString("base64")}`;
const profileJs = await load("src/infinity/ScientificFieldProfile.ts");
const profileUrl = `data:text/javascript;base64,${Buffer.from(profileJs).toString("base64")}`;
const providerJs = await load("src/infinity/MutableWorldFieldProvider.ts", [
  [/import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from ['"]\.\/ScientificFieldSpatialPattern['"]/, `import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from "${spatialUrl}"`],
  [/import type \{ ScientificFieldSpatialPattern, ScientificSmartBrushPattern \} from ['"]\.\/ScientificFieldSpatialPattern['"]/, ""],
  [/import { assertScientificFieldProfile, evaluateScientificFieldProfile } from ['"]\.\/ScientificFieldProfile['"]/, `import { assertScientificFieldProfile, evaluateScientificFieldProfile } from "${profileUrl}"`],
  [/import type \{ ScientificFieldProfile \} from ['"]\.\/ScientificFieldProfile['"]/, ""],
  [/import type \{ ScientificFieldProvider \} from ['"]\.\/ScientificFieldProvider['"]/, ""],
  [/import type \{ ScientificFieldSample \} from ['"]\.\/FieldSampler['"]/, ""],
]);
const { MutableWorldFieldProvider } = await import(`data:text/javascript;base64,${Buffer.from(providerJs).toString("base64")}`);
const base = { sample: () => ({ energy: 1, density: .2, information: 1, entropy: .1, temperature: 1, biology: .2, material: 0 }) };
const field = new MutableWorldFieldProvider(base);
const initial = field.serialize();

for (const bad of [
  { kind: "brush", x: NaN, y: 0, z: 0, radius: 1, delta: { energy: 1 } },
  { kind: "brush", x: 0, y: Infinity, z: 0, radius: 1, delta: { energy: 1 } },
  { kind: "brush", x: 0, y: 0, z: 0, radius: Infinity, delta: { energy: 1 } },
  { kind: "brush", x: 0, y: 0, z: 0, radius: 1, delta: { energy: NaN } },
  { kind: "brush", x: 0, y: 0, z: 0, radius: 1, scale: { density: Infinity } },
  { kind: "brush", x: 0, y: 0, z: 0, radius: 1, operations: { energy: { mode: "add", value: NaN } } },
]) {
  assert.throws(() => field.apply(bad), /finite|Invalid mutation|Invalid world field mutation/);
  assert.deepEqual(field.serialize(), initial, "rejected mutation must not change counters or field state");
}
assert.throws(() => field.setGlobal("law", { energy: NaN }, {}), /Invalid global overlay scale/);
assert.deepEqual(field.serialize(), initial, "rejected overlay must not change state");

field.apply({ kind: "brush", x: 0, y: 0, z: 0, radius: 1, delta: { energy: 2 } });
const validState = field.serialize();
const target = new MutableWorldFieldProvider(base);
target.restore(validState);
assert.deepEqual(target.serialize(), validState);

const corrupted = structuredClone(validState);
corrupted.mutations[0].delta.energy = NaN;
const beforeRestore = target.serialize();
assert.throws(() => target.restore(corrupted), /Invalid mutation delta/);
assert.deepEqual(target.serialize(), beforeRestore, "failed restore must preserve previous state");

const corruptedOverlay = structuredClone(validState);
corruptedOverlay.globalOverlays = [{ kind: "preset", scale: { temperature: Infinity }, delta: {} }];
assert.throws(() => target.restore(corruptedOverlay), /Invalid global overlay scale/);
assert.deepEqual(target.serialize(), beforeRestore, "invalid overlay restore must be atomic");

console.log("PASS: rejects non-finite mutation coordinates, radius, deltas, scales and operations");
console.log("PASS: rejected mutations and overlays leave version, IDs and history unchanged");
console.log("PASS: corrupt snapshots and overlays fail closed without partial restore");
