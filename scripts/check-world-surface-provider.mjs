import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)

async function moduleUrl(path, replacements = []) {
  const source = await readFile(new URL(path, root), 'utf8')
  let js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [pattern, replacement] of replacements) js = js.replace(pattern, replacement)
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}

const seedUrl = await moduleUrl('src/infinity/WorldSeed.ts')
const coordinateUrl = await moduleUrl('src/infinity/WorldCoordinate.ts')
const noiseUrl = await moduleUrl('src/infinity/Noise.ts', [
  [/from ['"]\.\/WorldSeed['"]/g, 'from "' + seedUrl + '"'],
])
const generatorUrl = await moduleUrl('src/infinity/WorldGenerator.ts', [
  [/from ['"]\.\/WorldCoordinate['"]/g, 'from "' + coordinateUrl + '"'],
  [/from ['"]\.\/Noise['"]/g, 'from "' + noiseUrl + '"'],
])
const surfaceUrl = await moduleUrl('src/infinity/WorldSurfaceProvider.ts', [
  [/from ['"]\.\/WorldGenerator['"]/g, 'from "' + generatorUrl + '"'],
])
const fieldProviderUrl = await moduleUrl('src/infinity/ScientificFieldProvider.ts')
const registryUrl = await moduleUrl('src/infinity/ScientificFieldRegistry.ts')
const viewUrl = await moduleUrl('src/infinity/WorldViewContract.ts')
const samplerUrl = await moduleUrl('src/infinity/FieldSampler.ts', [
  [/from ['"]\.\/WorldGenerator['"]/g, 'from "' + generatorUrl + '"'],
  [/from ['"]\.\/WorldSurfaceProvider['"]/g, 'from "' + surfaceUrl + '"'],
  [/from ['"]\.\/ScientificFieldProvider['"]/g, 'from "' + fieldProviderUrl + '"'],
  [/from ['"]\.\/ScientificFieldRegistry['"]/g, 'from "' + registryUrl + '"'],
  [/from ['"]\.\/WorldViewContract['"]/g, 'from "' + viewUrl + '"'],
])
const decisionRecordUrl = await moduleUrl('src/infinity/DecisionRecord.ts')
const decisionUrl = await moduleUrl('src/infinity/WorldDecisionLayer.ts', [
  [/from ['"]\.\/FieldSampler['"]/g, 'from "' + samplerUrl + '"'],
  [/from ['"]\.\/DecisionRecord['"]/g, 'from "' + decisionRecordUrl + '"'],
])
const { WorldGenerator } = await import(generatorUrl)
const { GeneratorWorldSurfaceProvider, resolveWorldWaterLevel, isBelowWorldWaterSurface, resolveBridgeDeckHeight } = await import(surfaceUrl)
const { FieldSampler } = await import(samplerUrl)
const { WorldDecisionLayer } = await import(decisionUrl)

const generator = new WorldGenerator('surface-adapter-test', 16, 52)
const sampler = new FieldSampler(generator)
const x = 31
const z = -47
const terrain = sampler.sampleTerrain(x, z)
const height = generator.sampleHeight(x, z)
const climate = generator.sampleClimate(x, z, height)
assert.equal(terrain.height, height, 'default surface adapter must preserve generator height')
assert.equal(terrain.temperature, climate.temperature, 'default surface adapter must preserve temperature')
assert.equal(terrain.moisture, climate.moisture, 'default surface adapter must preserve moisture')
assert.equal(terrain.biome, climate.biome, 'default surface adapter must preserve biome')
assert.equal(terrain.waterDepth, Math.max(0, generator.seaLevel - height), 'default adapter must preserve water depth')
assert.equal(sampler.surfaceProvider.referenceBuildElevation, generator.seaLevel + 10)
assert.equal(sampler.surfaceProvider.seed, generator.seed)
assert.equal(resolveWorldWaterLevel(sampler.surfaceProvider), generator.seaLevel)
const fastWaterMask = new Float32Array(32 * 32).fill(0.75)
assert.equal(
  sampler.surfaceProvider.getWaterMaskForChunk({ cx: 0, cz: 0, water: fastWaterMask }),
  fastWaterMask,
  'generator surface adapter must reuse the already generated chunk water mask by reference',
)
assert.equal(isBelowWorldWaterSurface(sampler.surfaceProvider, generator.seaLevel - 1), true)
assert.equal(isBelowWorldWaterSurface(sampler.surfaceProvider, generator.seaLevel - 0.25), false,
  'water clearance boundary remains strict and deterministic')
assert.equal(resolveBridgeDeckHeight(sampler.surfaceProvider, 10, 12), generator.seaLevel + 0.45)
const noSeaPlane = { waterLevel: null }
assert.equal(resolveWorldWaterLevel(noSeaPlane), null)
assert.equal(isBelowWorldWaterSurface(noSeaPlane, -100), false,
  'a surface without global water level must not invent sea crossings')
assert.equal(resolveBridgeDeckHeight(noSeaPlane, 10, 14), 12.45,
  'bridge height must fall back to local terrain midpoint when no sea plane exists')
assert.equal(resolveWorldWaterLevel({ waterLevel: Number.NaN }), null)
assert.equal(resolveWorldWaterLevel({ waterLevel: Number.POSITIVE_INFINITY }), null)

const nextGenerator = new WorldGenerator('surface-adapter-next', 22, 60)
sampler.setGenerator(nextGenerator)
assert.equal(sampler.surfaceProvider.seed, nextGenerator.seed, 'generator-backed surface must follow generator changes')
assert.equal(sampler.sampleTerrain(x, z).height, nextGenerator.sampleHeight(x, z), 'height must use the newly selected generator')

const editablePlane = {
  id: 'editable-plane',
  version: 'editable-plane-v1',
  seed: 'author-authored-world',
  referenceBuildElevation: 0,
  sampleSurface() {
    return { height: 0, temperature: 0.6, moisture: 0.25, biome: 'plains', biomeId: 2, waterDepth: 0 }
  },
}
sampler.setSurfaceProvider(editablePlane)
const customTerrain = sampler.sampleTerrain(120, -80)
assert.equal(customTerrain.height, 0, 'custom surface must not read height from the generator')
assert.equal(customTerrain.moisture, 0.25)
assert.equal(customTerrain.waterDepth, 0)
const customContext = sampler.sampleWorld(120, undefined, -80)
assert.equal(customContext.height, 0)
assert.equal(customContext.y, 0, 'default sample Y must come from the active surface provider')

const weights = { slope: 0.3, water: 0.25, elevation: 0.15, entropy: 0.08, density: 0.05, biology: 0.05, information: 0.04, distance: 0.08 }
const decisions = new WorldDecisionLayer(sampler, weights, () => ({ processes: ['gravity', 'density', 'energy'] }))
const buildability = decisions.analyzeBuildability(120, -80)
assert.equal(buildability.slope, 0, 'construction slope must come from the active surface provider')
assert.equal(buildability.elevation, 0)
assert.equal(decisions.explainBuildDecision(120, -80).worldSeed, 'author-authored-world', 'decision provenance must use the active surface identity')

sampler.setGenerator(nextGenerator)
assert.equal(sampler.surfaceProvider.id, 'editable-plane', 'changing the field generator must not silently replace an explicitly selected surface')
assert.equal(sampler.sampleTerrain(120, -80).height, 0)

const renderer = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
const resetAt = renderer.indexOf('this.generator = new WorldGenerator(newSeed)')
assert.ok(resetAt >= 0, 'world-seed reset code must exist')
const setGeneratorAt = renderer.indexOf('this.fieldSampler.setGenerator(this.generator)', resetAt)
const setAuthoritativeBaseAt = renderer.indexOf('this.authoritativeField.setBase(new GeneratorFieldProvider(this.generator))', resetAt)
const setAuthoritativeProviderAt = renderer.indexOf('this.fieldSampler.setProvider(this.authoritativeField)', resetAt)
assert.ok(setGeneratorAt > resetAt && setAuthoritativeBaseAt > setGeneratorAt && setAuthoritativeProviderAt > setAuthoritativeBaseAt,
  'seed reset must update the sampler surface and then restore the authoritative scientific-field provider')

const surfaceContractSource = await readFile(new URL('src/infinity/WorldSurfaceProvider.ts', root), 'utf8')
assert.match(surfaceContractSource, /minimumElevation\?: number/)
assert.match(surfaceContractSource, /maximumElevation\?: number/)
assert.match(surfaceContractSource, /waterLevel\?: number \| null/)
const rendererSource = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
assert.match(rendererSource, /setWorldSurfaceProvider\(provider: WorldSurfaceProvider\)/)
assert.match(rendererSource, /provider\.sampleSurface\(x, z\)\s*\n\s*if \(!Number\.isFinite\(surface\.height\)\)/)
assert.match(rendererSource, /surfaceProvider\.sampleSurface\(originX \+ x, originZ \+ z\)/)
assert.equal(rendererSource.includes('this.generator.sampleHeight(x, z)'), false, 'renderer terrain height must use the selected surface provider')
assert.equal(rendererSource.includes('this.generator.sampleClimate('), false, 'renderer climate and biome must use the selected surface provider')
assert.match(rendererSource, /resetWorldSurfaceProviderToGenerator\(\)/)

const decisionSource = await readFile(new URL('src/infinity/WorldDecisionLayer.ts', root), 'utf8')
assert.equal(decisionSource.includes('this.sampler.generator'), false, 'decision layer must not directly depend on WorldGenerator')

console.log('World surface provider regression: PASS')
console.log('PASS: generator adapter preserves existing terrain/environment samples')
console.log('PASS: authored surface is independent from the scientific generator')
console.log('PASS: construction scoring and provenance use the selected surface')
console.log('PASS: seed reset updates both generator-backed surface and authoritative field provider')
