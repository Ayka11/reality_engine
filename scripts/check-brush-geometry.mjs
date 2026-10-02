import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function loadTypeScriptModule(relativePath, replacements = []) {
  const source = await readFile(new URL(relativePath, root), "utf8");
  let javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;

  for (const [pattern, replacement] of replacements) {
    javascript = javascript.replace(pattern, replacement);
  }

  const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  return import(url);
}

const mathModule = await loadTypeScriptModule("src/brushes/BrushMath.ts");
const mathSource = await readFile(new URL("src/brushes/BrushMath.ts", root), "utf8");
const mathJavascript = ts.transpileModule(mathSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const mathUrl = `data:text/javascript;base64,${Buffer.from(mathJavascript).toString("base64")}`;

const geometryModule = await loadTypeScriptModule("src/brushes/BrushGeometry.ts", [
  [/from ["']\.\/BrushMath["']/, `from "${mathUrl}"`]
]);
const { brushGeometryWeight } = geometryModule;
const center = { x: 0, y: 0, z: 0 };

function weight(shape, point, options = {}) {
  return brushGeometryWeight({
    center,
    point,
    selectedLayerY: options.selectedLayerY,
    geometry: {
      shape,
      falloff: options.falloff ?? "constant",
      verticalExtent: options.verticalExtent ?? "bounded-volume",
      radius: options.radius ?? 5,
      shellThickness: options.shellThickness,
      layerThickness: options.layerThickness
    }
  });
}

// Sphere uses three-dimensional distance.
assert.equal(weight("sphere", { x: 3, y: 4, z: 0 }), 1);
assert.equal(weight("sphere", { x: 3, y: 4, z: 1 }), 0);

// Shell affects a band around the spherical surface.
assert.equal(weight("shell", { x: 5, y: 0, z: 0 }, { shellThickness: 0.5 }), 1);
assert.equal(weight("shell", { x: 0, y: 0, z: 0 }, { shellThickness: 0.5 }), 0);

// Column uses X/Z horizontal distance and explicit vertical extent.
assert.equal(weight("column", { x: 3, y: 100, z: 4 }, { verticalExtent: "full-column" }), 1);
assert.equal(weight("column", { x: 6, y: 0, z: 0 }, { verticalExtent: "full-column" }), 0);
assert.equal(weight("column", { x: 0, y: 6, z: 0 }, { verticalExtent: "bounded-volume" }), 0);

// Layer requires an explicit selected height.
assert.equal(weight("layer", { x: 2, y: 10, z: 0 }, { selectedLayerY: 10, layerThickness: 0.5 }), 1);
assert.equal(weight("layer", { x: 2, y: 12, z: 0 }, { selectedLayerY: 10, layerThickness: 0.5 }), 0);
assert.equal(weight("layer", { x: 2, y: 10, z: 0 }), 0);

// Invalid input is rejected safely.
assert.equal(weight("sphere", { x: 0, y: 0, z: 0 }, { radius: 0 }), 0);
assert.equal(weight("sphere", { x: Number.NaN, y: 0, z: 0 }), 0);

console.log("PASS: sphere geometry");
console.log("PASS: shell geometry");
console.log("PASS: column geometry and vertical extent");
console.log("PASS: layer geometry");
console.log("PASS: invalid-input handling");
