import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs/promises';

const contract = await fs.readFile('src/infinity/WorldConstructionContract.ts', 'utf8');
const renderer = await fs.readFile('src/render/InfiniteWorldRenderer.ts', 'utf8');

const out = ts.transpileModule(contract, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
assert.equal(out.diagnostics?.length ?? 0, 0);

for (const kind of ['building', 'road', 'bridge', 'water']) {
  assert.ok(contract.includes("'"+kind+"'"), 'missing structural kind '+kind);
}
assert.ok(contract.includes('buildability.score >= 0.2'));
assert.ok(contract.includes('laws.penalty < 0.25'));
assert.ok(renderer.includes('this.constructionContract.materialize(\'water\''));
assert.ok(renderer.includes('return this.constructionContract.authorize(kind, x, z)'));
console.log('World Construction Contract regression: PASS');
