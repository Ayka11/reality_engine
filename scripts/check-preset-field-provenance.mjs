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
assert.ok(adapter.includes('Preset field delta requires an explicit spatial region'));
assert.ok(adapter.includes('Preset field region must have finite coordinates and a positive radius'));

const compiled=ts.transpileModule(adapter,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const module={exports:{}};
new Function('exports','module',compiled)(module.exports,module);
const {PresetFieldProvenanceAdapter}=module.exports;
const captured=[];
const events=[];
const field={apply(mutation){captured.push(mutation);return {...mutation,id:captured.length};}};
const provenance={record(stage,payload){const event={id:'event-'+(events.length+1),stage,payload};events.push(event);return event;}};
const presetAdapter=new PresetFieldProvenanceAdapter(field,provenance);
assert.throws(()=>presetAdapter.commit({preset:'forest',execution:'worker',delta:{biology:.2}}),/explicit spatial region/);
assert.equal(captured.length,0,'invalid preset delta must not mutate the field');
assert.equal(events.length,0,'invalid preset delta must not record a successful provenance event');
assert.throws(()=>presetAdapter.commit({preset:'forest',execution:'worker',delta:{biology:.2},region:{x:0,y:0,z:0,radius:0}}),/positive radius/);
assert.throws(()=>presetAdapter.commit({preset:'forest',execution:'worker',delta:{biology:Number.NaN},region:{x:10,y:4,z:8,radius:12}}),/delta values must be finite/);
assert.throws(()=>presetAdapter.commit({preset:'forest',execution:'worker',delta:{},region:{x:10,y:4,z:8,radius:12}}),/at least one field/);
assert.throws(()=>presetAdapter.commit({preset:'forest',execution:'worker',delta:{imaginaryField:1},region:{x:10,y:4,z:8,radius:12}}),/unsupported field/);
assert.throws(()=>presetAdapter.commit({preset:'   ',execution:'worker'}),/non-empty string/);
assert.throws(()=>presetAdapter.commit({preset:'forest',execution:'unknown'}),/execution mode/);
assert.equal(captured.length,0,'invalid preset inputs must not mutate the field');
assert.equal(events.length,0,'invalid preset inputs must not record provenance');
const committed=presetAdapter.commit({preset:'forest',execution:'worker',delta:{biology:.2},region:{x:10,y:4,z:8,radius:12},metadata:{preset:'spoofed',execution:'voxel',provenanceEventId:'spoofed-id',region:{x:0,y:0,z:0,radius:1}}});
assert.equal(committed.fieldMutationId,1);
assert.deepEqual({x:captured[0].x,y:captured[0].y,z:captured[0].z,radius:captured[0].radius},{x:10,y:4,z:8,radius:12});
assert.deepEqual(captured[0].delta,{biology:.2});
assert.equal(captured[0].metadata.provenanceEventId,'event-1');
assert.equal(captured[0].metadata.preset,'forest','metadata must not override authoritative preset name');
assert.equal(captured[0].metadata.execution,'worker','metadata must not override execution mode');
assert.deepEqual(captured[0].metadata.region,{x:10,y:4,z:8,radius:12},'metadata must not override spatial region');
assert.equal(events[0].payload.preset,'forest','metadata must not spoof provenance preset');
assert.equal(events[0].payload.execution,'worker','metadata must not spoof provenance execution');
console.log('Preset Field/Provenance adapter regression: PASS');
console.log('Preset field delta requires a valid explicit region: PASS');

// Exercise the adapter against the real mutable provider, not only a recording fake.
const spatialSource=await fs.readFile('src/infinity/ScientificFieldSpatialPattern.ts','utf8');
const spatialJs=ts.transpileModule(spatialSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const spatialUrl='data:text/javascript;base64,'+Buffer.from(spatialJs).toString('base64');
const profileSource=await fs.readFile('src/infinity/ScientificFieldProfile.ts','utf8');
const profileJs=ts.transpileModule(profileSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const profileUrl='data:text/javascript;base64,'+Buffer.from(profileJs).toString('base64');
let providerSource=await fs.readFile('src/infinity/MutableWorldFieldProvider.ts','utf8');
providerSource=ts.transpileModule(providerSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
providerSource=providerSource
  .replace(/import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from ['"]\.\/ScientificFieldSpatialPattern['"]/, `import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from "${spatialUrl}"`)
  .replace(/import type \\{ ScientificFieldSpatialPattern, ScientificSmartBrushPattern \\} from ['"]\.\/ScientificFieldSpatialPattern['"]/, '')
  .replace(/import { assertScientificFieldProfile, evaluateScientificFieldProfile } from ['"]\.\/ScientificFieldProfile['"]/, `import { assertScientificFieldProfile, evaluateScientificFieldProfile } from "${profileUrl}"`)
  .replace(/import type \\{ ScientificFieldProfile \\} from ['"]\.\/ScientificFieldProfile['"]/, '')
  .replace(/import type \\{ ScientificFieldProvider \\} from ['"]\.\/ScientificFieldProvider['"]/, '')
  .replace(/import type \\{ ScientificFieldSample \\} from ['"]\.\/FieldSampler['"]/, '');
const providerModule=await import('data:text/javascript;base64,'+Buffer.from(providerSource).toString('base64'));
const realBase={sample:()=>({energy:1,density:.2,information:1,entropy:.1,temperature:1,biology:.2,material:0})};
const realField=new providerModule.MutableWorldFieldProvider(realBase);
const realProvenance={record(stage,payload){const event={id:'real-event-'+(events.length+1),stage,payload};events.push(event);return event;}};
const realAdapter=new PresetFieldProvenanceAdapter(realField,realProvenance);
realAdapter.commit({preset:'forest',execution:'voxel',delta:{biology:.2,energy:.2},region:{x:0,y:0,z:0,radius:10}});
const centerSample=realField.sample(0,0,0);
const edgeSample=realField.sample(0,0,10);
assert.equal(centerSample.biology,.4,'regional preset delta must change the actual sampled field at its center');
assert.equal(edgeSample.biology,.2,'regional preset delta must fade to zero at the radius boundary');
assert.equal(centerSample.energy,1.2,'regional preset delta must change sampled energy');
assert.equal(edgeSample.energy,1,'energy delta must fade to zero at the radius boundary');
assert.equal(realField.getMutationCount(),1,'real field must contain the committed regional mutation');
const physicsSource=await fs.readFile('src/infinity/FieldModulatedPhysics.ts','utf8');
const physicsJs=ts.transpileModule(physicsSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const physicsModule={exports:{}};
new Function('exports','module',physicsJs.replace(/export /g,''))(physicsModule.exports,physicsModule);
const {FieldModulatedPhysics}=physicsModule.exports;
const physics=new FieldModulatedPhysics();
const centerModulation=physics.modulation(centerSample);
const edgeModulation=physics.modulation(edgeSample);
assert.ok(centerModulation.gravity>edgeModulation.gravity,'preset energy delta must propagate into physics gravity modulation');
console.log('PASS: preset adapter changes real authoritative samples within the explicit region');
console.log('PASS: sampled energy change propagates into field-modulated physics');
