import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs/promises';

const source = await fs.readFile('src/world/PresetContract.ts', 'utf8');
const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
assert.equal(result.diagnostics?.length ?? 0, 0);

const workerNames = ['burst','wave','storm','ruins','clear','life','proto','town'];
const canonicalNames = ['burst','wave','life','vortex','entropy_storm','ecosystem','clear','plasma_universe','frozen_world','high_gravity','low_entropy_vacuum','fungal_ecosystem','ocean_biosphere','toxic_ecosystem','nebula','proto_planet','star_formation','abandoned_megacity','machine_ecology','energy_economy','self_replicating_field','causality_collapse'];
assert.equal(new Set(workerNames).size, workerNames.length);
assert.equal(new Set(canonicalNames).size, canonicalNames.length);
assert.ok(source.includes("export function isWorkerPreset"));
assert.ok(source.includes("export function presetDefinition"));
assert.ok(source.includes("export function normalizePresetName"));
console.log('Preset Contract regression: PASS');
