import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/brushes/BrushRegistry.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { BRUSH_PROFILES } = await import(url);

const expectedIds = [
  "volcano", "forest", "ocean", "crystal", "storm", "life-cluster",
  "radiation", "civilization-seed", "gravity-well", "entropy-sink",
  "quantum-core", "meta-law-node", "force-barrier"
];

assert.deepEqual(Object.keys(BRUSH_PROFILES).sort(), [...expectedIds].sort());

for (const id of expectedIds) {
  const profile = BRUSH_PROFILES[id];
  assert.equal(profile.id, id, `Profile ID mismatch: ${id}`);
  assert.ok(profile.label.trim(), `Missing label: ${id}`);
  assert.ok(profile.description.trim(), `Missing description: ${id}`);
  assert.ok(["sphere", "shell", "column", "layer"].includes(profile.shape), `Invalid shape: ${id}`);
  assert.ok(["gaussian", "linear", "constant"].includes(profile.falloff), `Invalid falloff: ${id}`);
  assert.ok(["selected-layer", "bounded-volume", "full-column"].includes(profile.verticalExtent), `Invalid vertical extent: ${id}`);
  assert.ok(Array.isArray(profile.effects) && profile.effects.length > 0, `Missing effects: ${id}`);

  for (const effect of profile.effects) {
    assert.ok(["energy", "density", "information", "entropy", "temperature", "biology", "material"].includes(effect.field), `Invalid field: ${id}`);
    assert.ok(["add", "set", "scale"].includes(effect.operation), `Invalid operation: ${id}`);
    assert.ok(Number.isFinite(effect.value), `Non-finite effect value: ${id}`);
  }
}

console.log(`PASS: ${expectedIds.length} brush profiles validated.`);
console.log("PASS: IDs, required fields, shapes, falloffs, effects and values.");
