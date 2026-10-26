import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/render/InfiniteWorldRenderer.ts", root), "utf8");

function methodBody(name) {
  const signature = new RegExp("\\b" + name + "\\s*\\([^)]*\\)\\s*(?::[^\\{]+)?\\{", "m");
  const match = signature.exec(source);
  assert.ok(match, `Expected method ${name} to exist`);
  const open = source.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
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

const authoritativeMutation = methodBody("applyAuthoritativeFieldMutation");
assert.match(authoritativeMutation, /this\\.refreshTerrainPatches\\(\\)/,
  "the canonical authoritative mutation path must refresh the renderer");

const terrainBuilder = methodBody("buildTerrainPatch");
assert.match(terrainBuilder, /if\\s*\\(this\\.materialMode\\s*===\\s*'field'\\)[\\s\\S]*?this\\.fieldSampler\\.sample\\(/,
  "field visualization must sample the authoritative scientific field");
assert.match(terrainBuilder, /const\\s+density\\s*=\\s*Math\\.max\\(0,\\s*Math\\.min\\(1,\\s*field\\.density\\)\\)/,
  "field visualization must derive vertex color from the sampled field");

const refresh = methodBody("refreshTerrainPatches");
assert.match(refresh, /for\s*\(const\s*\[key,\s*patch\]\s*of\s*this\.patches\)/, "refresh must visit every loaded patch");
assert.match(refresh, /patch\.group\.traverse/, "refresh must dispose old patch resources");
assert.match(refresh, /this\.buildTerrainPatch\(patch\.chunk,\s*patch\.lod\)/, "refresh must rebuild geometry from the current field");
assert.match(refresh, /this\.terrainEdgeLodSignature\(patch\.chunk\)/, "refresh must recompute edge LOD metadata");
assert.match(refresh, /this\.scene\.add\(group\)/, "rebuilt patches must be attached to the scene");

console.log("PASS: legacy sculpt and Smart Brush refresh rendered terrain");
console.log("PASS: authoritative Undo/Redo refresh after successful transactions");
console.log("PASS: authoritative field mode colors terrain from sampled field values");
console.log("PASS: refresh rebuilds loaded patches and edge-LOD metadata");
