import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const renderer = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
const protocolSource = await readFile(new URL('src/infinity/ExperimentProtocol.ts', root), 'utf8')

const rendererJs = ts.transpileModule(renderer, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.equal(rendererJs.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), false)

assert.ok(renderer.includes('get worldSeed(): string { return this.fieldSampler.surfaceProvider.seed }'))
assert.equal(renderer.split('const seed = this.worldSeed').length - 1, 2,
  'settlement generators must derive their deterministic layouts from the active surface seed')
assert.ok(renderer.includes('this.objects.scatter(this.worldSeed, kind'),
  'scatter placement must use the active surface seed')
assert.equal(renderer.includes('this.objects.scatter(this.generator.seed, kind'), false)
assert.equal(renderer.includes('const seed = this.generator.seed'), false)

const startAt = renderer.indexOf('  startExperiment(metadata:')
assert.ok(startAt >= 0, 'startExperiment method must exist')
const experimentBody = renderer.slice(startAt, renderer.indexOf('\n  recordExperimentResult(', startAt))
assert.ok(experimentBody.includes('const surfaceProvider = this.fieldSampler.surfaceProvider'))
assert.ok(experimentBody.includes('seed: surfaceProvider.seed'))
assert.ok(experimentBody.includes('providerId: surfaceProvider.id'))
assert.ok(experimentBody.includes('providerVersion: surfaceProvider.version'))

const schema = ts.transpileModule(protocolSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.equal(schema.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), false)
assert.ok(protocolSource.includes('surface?: {'), 'experiment schema must retain optional surface provenance')
assert.ok(protocolSource.includes('providerId: string'))
assert.ok(protocolSource.includes('providerVersion: string'))

const bootstrap = await readFile(new URL('src/infinityBootstrap.ts', root), 'utf8')
assert.ok(bootstrap.includes('worldSeed: world.worldSeed'))
assert.ok(bootstrap.includes('generatorSeed: world.generator.seed'))

console.log('World seed provenance regression: PASS')
console.log('PASS: procedural scatter and settlement layouts use the active surface seed')
console.log('PASS: experiment protocol records generator and surface provenance separately')
console.log('PASS: public surface diagnostics expose both seeds without conflating them')
