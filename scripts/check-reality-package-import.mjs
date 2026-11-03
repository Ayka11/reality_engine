import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/creator/PackageSerializer.ts', root), 'utf8');
const stubModule = `export default class JSZip {}\nexport function deflate(value) { return value; }\nexport function inflate(value) { return value; }\n`;
const stubUrl = `data:text/javascript;base64,${Buffer.from(stubModule).toString('base64')}`;
const transformed = ts.transpileModule(source
  .replace("import JSZip from 'jszip';", `import JSZip from '${stubUrl}';`)
  .replace("import { deflate, inflate } from 'pako';", `import { deflate, inflate } from '${stubUrl}';`), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}`;
const { serializePackageJson, parsePackageJson } = await import(moduleUrl);

const snapshot = {
  entities: [{
    id: 7,
    cells: [1, 2, 3],
    centroid: [1, 2, 3],
    genome: { metabolismRate: 0.5 },
    memoryBuffer: new Float32Array([0.125, 0.25, 0.5, 1, 2, 4, 8, 16]),
    colorRgb: [0.1, 0.2, 0.3],
  }],
  rngState: 123456,
};
const decoded = parsePackageJson(serializePackageJson(snapshot));
assert.ok(decoded.entities[0].memoryBuffer instanceof Float32Array,
  'runtime entity memory buffers must survive JSON package serialization as Float32Array values');
assert.deepEqual(decoded.entities[0].memoryBuffer, snapshot.entities[0].memoryBuffer);
assert.deepEqual(decoded.entities[0].cells, snapshot.entities[0].cells);
assert.equal(decoded.rngState, snapshot.rngState);

assert.throws(
  () => parsePackageJson(JSON.stringify({
    memoryBuffer: { __realityTypedArray: 'Float32Array', values: [1, 'bad', 3] },
  })),
  /invalid Float32Array payload/,
  'malformed typed-array envelopes must be rejected during package decoding',
);

const editorSource = await readFile(new URL('src/ui/LawProcessEditor.tsx', root), 'utf8');
assert.match(editorSource, /const candidate = this\.preflightPackage\(pkg\);\s+const sim = this\.options\.simulation!;/,
  'package preflight must complete before opening the live mutation transaction');
assert.match(editorSource, /dimensions\.x !== sim\.grid\.W[\s\S]*dimensions\.y !== sim\.grid\.H[\s\S]*dimensions\.z !== sim\.grid\.D/,
  'package dimensions must match all active grid axes');
assert.match(editorSource, /sim\.mutateAuthoritativeState\(\(\) => \{/,
  'field, entity and law import must use the engine-owned atomic mutation boundary');
assert.match(editorSource, /sim\.entityLayer\.restore\(candidate\.entityLayer, sim\.grid\.size\)/,
  'new packages must restore complete authoritative entity state');
assert.match(editorSource, /fieldOwner !== entity\\.id[\\s\\S]*ownerByCell\\.get\(cellIndex\) !== fieldOwner/,
  'voxel ENTITY_ID ownership must agree with the restored spatial entity model');
assert.match(editorSource, /this\.options\.lawEngine\.restore\(candidate\.lawEngine\)/,
  'law import must restore manual overrides and graph bindings, not replace only law definitions');
assert.match(editorSource, /sim\.grid\.buffer\[offset\] = 0/,
  'legacy packages without spatial entity snapshots must clear orphan entity IDs');
assert.match(editorSource, /this\.graph\.load\(graphBefore\)/,
  'editor graph state must be rolled back if the engine transaction fails');
assert.doesNotMatch(editorSource, /private applyVoxelState\(/,
  'the old non-transactional voxel-only import path must not remain');

console.log('Reality package typed-array codec and atomic-import contract regression: PASS');
