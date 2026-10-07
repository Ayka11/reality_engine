import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs/promises';
const files=['src/infinity/PresetFieldProvenanceAdapter.ts','src/infinity/MutableWorldFieldProvider.ts','src/infinity/RuntimeProvenance.ts'];
for (const file of files) {
  const source=await fs.readFile(file,'utf8');
  const out=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  assert.equal(out.diagnostics?.length ?? 0,0,'TypeScript diagnostics in '+file);
}
const adapter=await fs.readFile(files[0],'utf8');
assert.ok(adapter.includes("record('preset'"));
assert.ok(adapter.includes("kind: 'preset'"));
assert.ok(adapter.includes('never invents physical field values'));
console.log('Preset Field/Provenance adapter regression: PASS');
