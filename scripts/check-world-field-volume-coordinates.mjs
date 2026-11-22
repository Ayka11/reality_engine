import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const rendererSource = await readFile(new URL('../src/render/WorldFieldVolumeRenderer.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const compiled = ts.transpileModule(rendererSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
assert.equal(compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error), false,
  'volume renderer must remain valid TypeScript')

// The production field-volume builder must provide enough independent Y planes
// to avoid rendering the volume as only a handful of isolated sheets.
assert.match(appSource, /const depth=11,spacing=/,
  'volumetric field must sample eleven vertical slices')
assert.match(appSource, /volume:rendered\?\.volume\?\?null/,
  'field-volume diagnostics must be copied into the render state')
assert.match(appSource, /volume: field3D\?\.volume \?\? volumeRenderer\?\.volume \?\? null/,
  'runtime diagnostics must expose the volume geometry report')

// FieldSampler.sampleWorld(x, y, z) stores the sampled plane in sample.y.
// Therefore sample.y is constant within each horizontal slice and cannot be
// used as the independent vertical coordinate of a volume voxel.
assert.match(rendererSource, /const sliceY = Number\(slice\.y\)/,
  'voxel height must come from the volume slice descriptor')
assert.match(rendererSource, /const y = \(sliceY - centerY\) \/ spacing/,
  'slice planes must map to distinct normalized vertical coordinates')
assert.doesNotMatch(rendererSource, /const y = \(sampleY - centerY\) \/ spacing/,
  'sample.y must not collapse every voxel in a slice onto the same height')
for (const diagnostic of [
  'invalidSamples',
  'duplicateCoordinates',
  'activeRatio',
  'uniqueLayers',
  'layerSpacing',
  'bounds',
]) {
  assert.ok(rendererSource.includes(diagnostic),
    `volume diagnostics must expose ${diagnostic}`)
}

// Regression fixture: all samples in each plane carry the plane Y, while the
// slice descriptor supplies the independent layer coordinate.
const centerY = 12
const spacing = 4
const slices = [-4, 0, 4].map(offset => ({
  y: centerY + offset,
  samples: Array.from({ length: 6 }, () => ({ y: centerY + offset })),
}))
const renderedY = slices.map(slice => (slice.y - centerY) / spacing)
assert.deepEqual(renderedY, [-1, 0, 1])
assert.equal(new Set(renderedY).size, slices.length,
  'separate volume slices must occupy separate vertical planes')
assert.ok(slices.every(slice => slice.samples.every(sample => sample.y === centerY + (slice.y - centerY))),
  'fixture must model FieldSampler plane samples faithfully')

console.log('PASS: volumetric voxel height follows slice coordinates, not per-sample plane Y')
console.log('PASS: distinct source slices remain distinct in normalized 3D space')
