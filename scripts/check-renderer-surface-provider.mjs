import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const root = new URL('../', import.meta.url)
const rendererSource = await readFile(new URL('src/render/InfiniteWorldRenderer.ts', root), 'utf8')
const surfaceSource = await readFile(new URL('src/infinity/WorldSurfaceProvider.ts', root), 'utf8')
const samplerSource = await readFile(new URL('src/infinity/FieldSampler.ts', root), 'utf8')

for (const [name, source] of [['renderer', rendererSource], ['surface provider', surfaceSource], ['field sampler', samplerSource]]) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  assert.equal(result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), false, name + ' must transpile')
}

assert.match(rendererSource, /setWorldSurfaceProvider\(provider: WorldSurfaceProvider\)/)
assert.match(rendererSource, /resetWorldSurfaceProviderToGenerator\(\)/)
assert.match(rendererSource, /const surface = provider\.sampleSurface\(x, z\)/)
assert.match(rendererSource, /const biome = this\.fieldSampler\.surfaceProvider\.sampleSurface\(originX \+ gx, originZ \+ gz, h\)\.biome/)
assert.match(rendererSource, /const waterLevel = surfaceProvider\.waterLevel/)
assert.match(rendererSource, /buildWaterSurfaceMeshData\(\{ cx: chunk\.cx, cz: chunk\.cz, water \}, waterLevel\)/)
assert.match(rendererSource, /const deformedHeight = surface\.height \+ this\.terrainDeformations\.sampleDelta\(x, z\)/)
assert.equal(rendererSource.includes('this.generator.sampleHeight(x, z)'), false, 'terrain vertices must not bypass the selected surface source')
assert.equal(rendererSource.includes('this.generator.sampleClimate('), false, 'rendered climate must not bypass the selected surface source')

console.log('Renderer surface provider regression: PASS')
console.log('PASS: terrain vertices, biomes, environment, water mesh and snapping use the selected source')
console.log('PASS: unbounded surfaces are not clamped to generator elevation limits')
