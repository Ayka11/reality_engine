import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/brushes/BrushMath.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
const { brushFalloffWeight, applyBrushOperation } = await import(url);

assert.equal(brushFalloffWeight(0, 10, "linear"), 1);
assert.equal(brushFalloffWeight(5, 10, "linear"), 0.5);
assert.equal(brushFalloffWeight(10, 10, "linear"), 0);
assert.equal(brushFalloffWeight(11, 10, "linear"), 0);
assert.equal(brushFalloffWeight(0, 10, "constant"), 1);
assert.equal(brushFalloffWeight(10, 10, "constant"), 1);
assert.ok(Math.abs(brushFalloffWeight(10, 10, "gaussian") - Math.exp(-2.5)) < 1e-12);
assert.equal(brushFalloffWeight(0, 0, "constant"), 0);
assert.equal(brushFalloffWeight(Number.NaN, 10, "linear"), 0);

assert.equal(applyBrushOperation(10, 2, "add", 0.5, 2), 12);
assert.equal(applyBrushOperation(10, 20, "set", 0.5), 15);
assert.equal(applyBrushOperation(10, 2, "scale", 1, 1), 10);
assert.equal(applyBrushOperation(10, 2, "scale", 0.5, 1), 5);
assert.equal(applyBrushOperation(10, 2, "add", 1, 0), 10);
assert.throws(() => applyBrushOperation(Number.NaN, 1, "add", 1), RangeError);

console.log("PASS: brush falloff math");
console.log("PASS: add/set/scale operations");
console.log("PASS: zero-strength and invalid-input handling");
