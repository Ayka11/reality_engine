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
assert.match(terrainHeight, /this\\.generator\\.sampleHeight\\(x, z\\)\\s*\\+\\s*this\\.terrainDeformations\\.sampleDelta\\(x, z\\)/,
  "terrain geometry must add the authoritative deformation overlay to the deterministic baseline");
const terrainSculpt = methodBody("sculptTerrainAt");
assert.match(terrainSculpt, /this\\.terrainDeformations\\.applyBrush/);
assert.match(terrainSculpt, /this\\.refreshTerrainPatches\\(\\)/);
assert.match(terrainSculpt, /saveTerrainDeformationState/);
for (const name of ["undoTerrainSculpt", "redoTerrainSculpt"]) {
  const body = methodBody(name);
  assert.match(body, /this\\.terrainDeformations\\.(?:undo|redo)\\(\\)/);
  assert.match(body, /this\\.refreshTerrainPatches\\(\\)/);
  assert.match(body, /saveTerrainDeformationState/);
}
const terrainBuilderSource = methodBody("buildTerrainPatch");
assert.match(terrainBuilderSource, /this\\.sampleTerrainHeight\\(originX \\+ gx, originZ \\+ gz\\)/,
  "terrain mesh vertices must sample deformation-aware heights");
assert.match(methodBody("saveWorld"), /saveTerrainDeformationCheckpoint/);
assert.match(methodBody("loadWorld"), /loadTerrainDeformationCheckpoint/);

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
console.log("PASS: terrain geometry uses persisted deformation overlay with Undo/Redo and save checkpoints");
