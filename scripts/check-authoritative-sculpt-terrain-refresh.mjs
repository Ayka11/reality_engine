import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/render/InfiniteWorldRenderer.ts", root), "utf8");

function methodBody(name) {
  // Anchor to a class method declaration, not a call site or an object-shaped
  // parameter type. The parameter list can itself contain nested braces.
  const signature = new RegExp("^\\s{2}(?:private\\s+)?" + name + "\\s*\\(", "m");
  const match = signature.exec(source);
  assert.ok(match, `Expected method ${name} to exist`);
  const openParen = source.indexOf("(", match.index);
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  assert.ok(closeParen >= 0, `Method ${name} has an unbalanced parameter list`);
  const open = source.indexOf("{", closeParen);
  assert.ok(open >= 0, `Method ${name} has no body`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  assert.fail(`Method ${name} has unbalanced braces`);
}

for (const name of ["applyLegacySculptStroke", "applyLegacySmartBrush"]) {
  const body = methodBody(name);
  assert.match(body, /this\.refreshTerrainPatches\(\)/, `${name} must refresh rendered terrain after committing a field mutation`);
  assert.match(body, /this\.persistAuthoritativeFieldState\(\)/, `${name} must persist the committed authoritative field`);
  assert.ok(body.indexOf("this.refreshTerrainPatches()") < body.indexOf("this.persistAuthoritativeFieldState()"),
    `${name} must refresh terrain before completing its persisted mutation path`);
}

for (const name of ["undoLegacySculptAuthoritative", "redoLegacySculptAuthoritative"]) {
  const body = methodBody(name);
  assert.match(body, /if\s*\(transaction\)\s*\{[\s\S]*?this\.refreshTerrainPatches\(\)[\s\S]*?this\.persistAuthoritativeFieldState\(\)[\s\S]*?\}/,
    `${name} must refresh and persist only when the coordinator changes field state`);
}

const worldEnvironment = methodBody("getWorldEnvironment");
const settlementGeneration = methodBody("generateSettlement");
assert.match(settlementGeneration, /this\.fieldSampler\.sample\(cx \+ i, 0, cz\)\.entropy/,
  "settlement placement must use the authoritative entropy field");

assert.match(worldEnvironment, /this\.fieldSampler\.sample\(x, y, z\)/,
  "environment-driven civilization/production systems must consume the authoritative field");
assert.doesNotMatch(worldEnvironment, /this\.generator\.sampleField\(x, y, z\)/,
  "environment sampling must not bypass committed authoritative field mutations");

const authoritativeMutation = methodBody("applyAuthoritativeFieldMutation");
assert.match(authoritativeMutation, /this\.refreshTerrainPatches\(\)/,
  "the canonical authoritative mutation path must refresh the renderer");

const terrainBuilder = methodBody("buildTerrainPatch");
assert.match(terrainBuilder, /if\s*\(this\.materialMode\s*===\s*'field'\)[\s\S]*?this\.fieldSampler\.sample\(/,
  "field visualization must sample the authoritative scientific field");
assert.match(terrainBuilder, /const\s+density\s*=\s*Math\.max\(0,\s*Math\.min\(1,\s*field\.density\)\)/,
  "field visualization must derive vertex color from the sampled field");

const terrainGeometryFinalization = source.slice(source.indexOf("geometry.setIndex(indices)"), source.indexOf("geometry.computeBoundingSphere()", source.indexOf("geometry.setIndex(indices)")));
assert.match(terrainGeometryFinalization, /geometry\.computeVertexNormals\(\)/,
  "terrain normals must be recomputed from final indexed geometry so LOD-snapped edges and lighting agree");

const terrainHeight = methodBody("sampleTerrainHeight");
assert.ok(terrainHeight.includes('provider.sampleSurface(x, z)'),
  "terrain geometry must sample its selected surface provider baseline");
assert.ok(terrainHeight.includes('surface.height + this.terrainDeformations.sampleDelta(x, z)'),
  "terrain geometry must add the authoritative deformation overlay to the selected surface baseline");
const terrainPersistence = methodBody("persistTerrainDeformationState");
assert.match(terrainPersistence, /const saved = this\.persistence\.saveTerrainDeformationState/);
assert.match(terrainPersistence, /if \(!saved\)/,
  "renderer must detect failed terrain autosaves instead of silently ignoring storage errors");
assert.match(terrainPersistence, /console\.warn/,
  "failed terrain autosaves must surface a diagnostic while keeping in-memory edits usable");
const terrainSculpt = methodBody("sculptTerrainAt");
assert.match(terrainSculpt, /this\.terrainDeformations\.applyBrush/);
assert.match(terrainSculpt, /this\.refreshTerrainPatches\(\)/);
assert.match(terrainSculpt, /this\.persistTerrainDeformationState\(\)/);
for (const name of ["undoTerrainSculpt", "redoTerrainSculpt"]) {
  const body = methodBody(name);
  assert.match(body, /this\.terrainDeformations\.(?:undo|redo)\(\)/);
  assert.match(body, /this\.refreshTerrainPatches\(\)/);
  assert.match(body, /this\.persistTerrainDeformationState\(\)/);
}
const terrainBuilderSource = methodBody("buildTerrainPatch");
assert.match(terrainBuilderSource, /this\.sampleTerrainHeight\(originX \+ gx, originZ \+ gz\)/,
  "terrain mesh vertices must sample deformation-aware heights");
const saveWorldBody = methodBody("saveWorld");
assert.match(saveWorldBody, /saveFieldCheckpoint/);
assert.match(saveWorldBody, /if \(!fieldCheckpointSaved\)/,
  "manual authoritative field checkpoint failures must be diagnosed rather than silently ignored");
assert.match(saveWorldBody, /saveTerrainDeformationCheckpoint/);
assert.match(saveWorldBody, /if \(!checkpointSaved\)/,
  "manual terrain checkpoint failures must be diagnosed rather than silently ignored");
assert.match(saveWorldBody, /const failedPersistenceOperations: string\[\] = \[\]/);
assert.match(saveWorldBody, /if \(!this\.persistence\.deleteChunk\(cx, cy, cz\)\)/,
  "world save must detect failed chunk deletions");
assert.match(saveWorldBody, /if \(!this\.persistence\.saveChunk\(cx, cy, cz, list\)\)/,
  "world save must detect failed chunk writes");
assert.match(saveWorldBody, /World object persistence incomplete/,
  "world save must diagnose incomplete object persistence");
assert.match(methodBody("loadWorld"), /loadTerrainDeformationCheckpoint/);
assert.match(methodBody("loadWorld"), /knownChunks\(\{\s*recoverOrphans:\s*true\s*\}\)/,
  "world load must recover persisted chunk payloads omitted from a failed/corrupt manifest");
const clearSavedWorldBody = methodBody("clearSavedWorld");
assert.match(clearSavedWorldBody, /const cleared = this\.persistence\.clear\(\)/);
assert.match(clearSavedWorldBody, /if\s*\(!cleared\)[\s\S]*?console\.warn/,
  "the renderer must warn if persisted world cleanup was incomplete");

const refresh = methodBody("refreshTerrainPatches");
assert.match(refresh, /for\s*\(const\s*\[key,\s*patch\]\s*of\s*this\.patches\)/, "refresh must visit every loaded patch");
assert.match(refresh, /patch\.group\.traverse/, "refresh must dispose old patch resources");
assert.match(refresh, /this\.buildTerrainPatch\(patch\.chunk,\s*patch\.lod\)/, "refresh must rebuild geometry from the current field");
assert.match(refresh, /this\.terrainEdgeLodSignature\(patch\.chunk\)/, "refresh must recompute edge LOD metadata");
assert.match(refresh, /this\.scene\.add\(group\)/, "rebuilt patches must be attached to the scene");

console.log("PASS: legacy sculpt and Smart Brush refresh rendered terrain");
console.log("PASS: authoritative Undo/Redo refresh after successful transactions");
console.log("PASS: environment-driven systems sample the authoritative field");
console.log("PASS: authoritative field mode colors terrain from sampled field values");
console.log("PASS: refresh rebuilds loaded patches and edge-LOD metadata");
const bootstrap = await readFile(new URL("src/infinityBootstrap.ts", root), "utf8");
assert.match(bootstrap, /id="vTerrainRaise"/, "world dock must expose terrain raise control");
assert.match(bootstrap, /id="vTerrainLower"/, "world dock must expose terrain lower control");
assert.match(bootstrap, /world\.setTerrainBrushMode\(mode\)/, "terrain UI mode must activate renderer brush mode");
assert.match(bootstrap, /world\.setTerrainBrushSettings\(terrainBrushRadius, terrainBrushStrength\)/,
  "terrain UI radius/strength must configure the renderer brush");
assert.match(bootstrap, /world\.undoTerrainSculpt\(\)/, "terrain UI must expose geometric undo");
assert.match(bootstrap, /world\.redoTerrainSculpt\(\)/, "terrain UI must expose geometric redo");
assert.match(source, /if\s*\(this\.terrainBrushMode\)\s*\{[\s\S]*?this\.sculptTerrainAt\(point\.x, point\.z, this\.terrainBrushRadius, this\.terrainBrushStrength, this\.terrainBrushMode\)/,
  "terrain pointer hits must commit geometry edits using configured brush settings");

console.log("PASS: terrain geometry uses persisted deformation overlay with Undo/Redo and save checkpoints");
console.log("PASS: active world dock wires terrain Raise/Lower, brush settings, and Undo/Redo");
