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
const reseedAt = renderer.indexOf('  reseed(newSeed: string)')
assert.ok(reseedAt >= 0, 'renderer reseed must exist')
const reseedBody = renderer.slice(reseedAt, renderer.indexOf('\n  dispose()', reseedAt))
assert.ok(reseedBody.includes('this.fieldSampler.setGenerator(this.generator)'))
assert.ok(reseedBody.includes('worldViewContract.setSeed(this.fieldSampler.surfaceProvider.seed)'),
  'reseed must retain the selected authored surface identity')

const saveWorldAt = renderer.indexOf('  saveWorld(options:')
const loadWorldAt = renderer.indexOf('  loadWorld(options:', saveWorldAt)
assert.ok(saveWorldAt >= 0 && loadWorldAt > saveWorldAt, 'renderer saveWorld method must exist')
const saveWorldBody = renderer.slice(saveWorldAt, loadWorldAt)
const chunkWriteAt = saveWorldBody.lastIndexOf('this.persistence.saveChunk(cx, cy, cz, list)')
const activeSeedCommitAt = saveWorldBody.indexOf('saveActiveWorldSeed(this.generator.seed)')
assert.ok(chunkWriteAt >= 0 && activeSeedCommitAt > chunkWriteAt,
  'active seed must be published only after all seed-scoped chunk writes')
const journalBeginAt = saveWorldBody.indexOf('beginSaveTransaction')
const journalFinishAt = saveWorldBody.indexOf('finishSaveTransaction')
assert.ok(journalBeginAt >= 0 && journalBeginAt < saveWorldBody.indexOf('persistAuthoritativeFieldState'),
  'the world journal must open before the first sidecar write')
assert.ok(journalFinishAt > activeSeedCommitAt,
  'the journal marker must be removed only after the active seed selector is published')
assert.match(saveWorldBody, /failedPersistenceOperations\.length === 0 && !saveActiveWorldSeed\(this\.generator\.seed\)/,
  'an incomplete sidecar/chunk save must not switch startup to the imported seed namespace')
const portablePersistAt = renderer.indexOf('  persistPortableWorldSnapshot(')
const saveWorldCallAt = renderer.indexOf('this.saveWorld({ checkpoint: false, preflightFailures })', portablePersistAt)
assert.ok(portablePersistAt >= 0 && saveWorldCallAt > portablePersistAt,
  'imported surface/asset sidecar failures must be passed into the seed-scoped save commit')
assert.match(saveWorldBody, /const failedPersistenceOperations: string\[\] = \[\.\.\.\(options\.preflightFailures \?\? \[\]\)\]/,
  'preflight sidecar failures must prevent active-seed publication')
assert.equal(reseedBody.includes('worldViewContract.setSeed(newSeed)'), false,
  'procedural generator reseed must not overwrite an independently selected surface seed')
const clearSavedWorldAt = renderer.indexOf('  clearSavedWorld(): boolean')
const clearSavedWorldEnd = renderer.indexOf('  reseed(newSeed: string)', clearSavedWorldAt)
assert.ok(clearSavedWorldAt >= 0 && clearSavedWorldEnd > clearSavedWorldAt,
  'clearSavedWorld must expose its durable completion result')
const clearSavedWorldBody = renderer.slice(clearSavedWorldAt, clearSavedWorldEnd)
assert.match(clearSavedWorldBody, /window\.clearTimeout\(this\.saveTimer\)/,
  'clearing the world must cancel a pending autosave before touching persistence')
assert.match(clearSavedWorldBody, /return cleared/,
  'reseed must be able to distinguish a durable clear from a failed clear')
assert.ok(clearSavedWorldBody.indexOf('const cleared = this.persistence.clear()') <
  clearSavedWorldBody.indexOf('this.clearExternalAssetRuntime()'),
  'a durable clear must succeed before the live external asset runtime is destroyed')
assert.match(clearSavedWorldBody, /if \(!cleared\) \{[\s\S]*?return false[\s\S]*?\}\s*this\.pendingExternalAssetPlacements = \[\]/,
  'a failed durable clear must preserve live placements and other in-memory world state')
const reseedClearAt = reseedBody.indexOf('const previousNamespaceCleared = this.clearSavedWorld()')
const reseedMeshDisposalAt = reseedBody.indexOf('this.patches.clear()')
assert.ok(reseedClearAt >= 0 && reseedMeshDisposalAt > reseedClearAt,
  'reseed must not dispose the visible world until its durable source namespace has cleared')
assert.match(reseedBody, /const previousNamespaceCleared = this\.clearSavedWorld\(\)/)
assert.match(reseedBody, /if \(!previousNamespaceCleared\)[\s\S]*?return/,
  'reseed must not switch away from a namespace that could not be safely cleared')
assert.match(reseedBody, /this\.persistence\.beginSaveTransaction\(\{ recoverIncomplete: true \}\)/,
  'reseed must open a journal on the target seed before publishing it')
assert.match(reseedBody, /newSeed !== previousSeed && !this\.persistence\.clear\(\)/,
  'reseed must clear a previously used target seed to prevent stale chunks from returning')
const targetClearAt = reseedBody.indexOf('newSeed !== previousSeed && !this.persistence.clear()')
const surfacePersistAt = reseedBody.indexOf("this.persistActiveSurfaceProvider()")
const seedPublishAt = reseedBody.indexOf('saveActiveWorldSeed(newSeed)')
const reseedJournalFinishAt = reseedBody.indexOf('finishSaveTransaction(ready)')
assert.ok(targetClearAt >= 0 && surfacePersistAt > targetClearAt && seedPublishAt > surfacePersistAt && reseedJournalFinishAt > seedPublishAt,
  'target namespace cleanup, surface persistence, active-seed publication and journal close must be ordered')


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
