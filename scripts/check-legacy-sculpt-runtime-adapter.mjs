import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const cache = new Map();
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = await readFile(new URL(path, root), "utf8");
  let js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = [...js.matchAll(/from\\s+["'](\\.\\/?[^"']+)["']/g)];
  for (const match of imports) {
    const specifier = match[1];
    const resolved = new URL(specifier.endsWith(".ts") ? specifier : specifier + ".ts", new URL(path, root)).pathname.split("/").pop();
    const base = path.split("/").slice(0, -1).join("/");
    const child = await load(base ? base + "/" + resolved : resolved);
    js = js.replace(match[0], match[0].replace(specifier, child));
  }
  const url = "data:text/javascript;base64," + Buffer.from(js).toString("base64");
  cache.set(path, url);
  return url;
}

const { LegacySculptRuntimeAdapter } = await import(await load("src/infinity/LegacySculptRuntimeAdapter.ts"));
const captured=[];
const adapter=new LegacySculptRuntimeAdapter(m=>{captured.push(m);return {...m,id:captured.length}});
const cell={x:3,y:5,z:2};
const out=adapter.inject(cell,4,2,{energy:1,density:.5});
assert.equal(out.id,1); assert.equal(captured[0].metadata.source,"legacy-sculpt-inject");
adapter.erase(cell,4,.75); assert.equal(captured[1].metadata.brush,"Erase");
adapter.smooth(cell,4,1); assert.equal(captured[2].operations.energy.mode,"smooth6");
adapter.noise(cell,4,2,8,17,{energy:1}); assert.equal(captured[3].spatialPattern.kind,"noise3");
adapter.pattern(cell,4,2,8,{energy:1}); assert.equal(captured[4].spatialPattern.kind,"pattern3");
adapter.stamp(cell,4,2); assert.equal(captured[5].spatialPattern.kind,"stamp-lattice");
adapter.smartBrush("Volcano",cell,4); assert.equal(captured[6].spatialPattern.name,"Volcano");
console.log("PASS: legacy sculpt authoritative runtime adapter");
