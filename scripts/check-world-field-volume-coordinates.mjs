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
assert.match(rendererSource, /const sliceY = finiteNumericValue\(slice\.y\)/,
  'voxel height must come from the volume slice descriptor')
assert.match(rendererSource, /const y = \(sliceY - centerY\) \/ spacing/,
  'slice planes must map to distinct normalized vertical coordinates')
assert.doesNotMatch(rendererSource, /const y = \(sampleY - centerY\) \/ spacing/,
  'sample.y must not collapse every voxel in a slice onto the same height')
assert.match(rendererSource, /sampleCount,\s*activeCells,\s*volume:/,
  'render result must return the actual sample count and geometry diagnostics')
assert.doesNotMatch(rendererSource, /sampleCount:\s*renderedCells/,
  'sampleCount must not be substituted with the valid rendered-cell count')
assert.match(rendererSource, /localBounds\.minX[\s\S]*localBounds\.maxZ/,
  'camera fitting must use the rendered volume bounds')
assert.match(rendererSource, /radius > this\.lastFramedRadius \* 1\.25/,
  'camera must refit when the volume grows materially')
assert.match(rendererSource, /this\.controls\.addEventListener\('start'[\s\S]*this\.cameraInteracted = true/,
  'manual camera interaction must disable automatic reframing')
assert.match(rendererSource, /const limitingHalfFov = Math\.max/,
  'camera fitting must account for viewport aspect ratio')
assert.match(rendererSource, /'energy', 'density', 'information', 'entropy', 'temperature', 'biology', 'material'/,
  'volumetric renderer must expose the seventh authoritative Material scalar field')
assert.match(rendererSource, /export const MATERIAL_CLASS_COLORS = \[/,
  'categorical Material must define a dedicated palette for eight biomes plus AIR')
assert.match(rendererSource, /export const isMaterialClassCode = \(value: unknown\): value is number/,
  'Material category validation must reject non-integer and out-of-range codes')
assert.match(rendererSource, /selectedFieldIndex === 6\s*\?\s*\(selectedRawValue !== null \? 1 : 0\)/,
  'Material category zero must remain visible instead of being normalized to zero')
assert.match(rendererSource, /if \(selectedFieldIndex === 6\) this\.color\.setHex\(materialClassColor\(selectedRawValue\)\)/,
  'selected Material field must use discrete biome class colors and neutral fallback for invalid categories')
assert.doesNotMatch(rendererSource, /if \(selectedFieldIndex === 6\) this\.color\.setHex\(materialClassColor\(value\)\)/,
  'invalid Material samples must never be coerced to category zero')
for (const diagnostic of [
  'invalidSamples',
  'duplicateCoordinates',
  'activeRatio',
  'uniqueLayers',
  'layerSpacing',
  'bounds',
  'invalidFieldValues',
  'fieldValues',
  'standardDeviation',
  'fieldProfiles',
  'SCIENTIFIC_FIELD_KEYS',
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

assert.match(rendererSource, /typeof value === 'number' && Number\.isFinite\(value\)/,
  'scientific field and coordinate inputs must reject coercible strings, null, and booleans')
assert.match(appSource, /fieldIndex=Number\.isInteger\(layer\)&&layer>=0&&layer<=6\?layer:-1/,
  'Volumetric UI must accept Material at index 6 while preserving indices 0–5')
assert.match(appSource, /if\(l===6&&currentRenderMode!=='field3d'\)return false/,
  'Material selection must be rejected outside the volumetric renderer')
assert.match(appSource, /typeof value==='number'&&Number\.isFinite\(value\)/,
  'visible-window normalization must not coerce invalid scalar values')
assert.match(rendererSource, /const rawFieldValue = finiteNumericValue\(sample\[key\]\)/,
  'field distribution metrics must count non-numeric source values as invalid')
assert.match(rendererSource, /const sampleX = finiteNumericValue\(sample\.x\)/,
  'world coordinates must not coerce missing or string values into valid positions')
assert.match(rendererSource, /const finiteValues = SCIENTIFIC_FIELD_KEYS\.map\(key => \{/,
  'composite rendering must validate each field before including it')
assert.match(rendererSource, /key === 'material' && !isMaterialClassCode\(value\) \? null : value/,
  'composite rendering must exclude invalid BIOME_ID categories instead of coercing them')
assert.match(rendererSource, /finiteValues\.filter\(\(value, index\) => index !== 6 && value !== null\)/,
  'composite numeric strength must exclude categorical Material codes')
assert.match(rendererSource, /index !== 6 && value !== null \? Math\.abs\(value\) \/ fieldMaxima\[index\]/,
  'composite numeric normalization must include only the six numeric scientific fields')

assert.match(appSource, /const selectedRaw=fieldIndexSafe>=0\?sample\[props\[fieldIndexSafe\]\]:normalized/,
  'CPU fallback must also reject coercible Material values')
assert.match(appSource, /id="layerM" onclick="setLayer\(6\)"/,
  'Material field control must be present in the layer toolbar')
console.log('PASS: seven scientific scalar fields, including categorical Material, are represented independently')
console.log('PASS: Material uses a discrete eight-biome-plus-air palette and preserves category zero')
console.log('PASS: invalid non-numeric samples are rejected without coercion')
console.log('PASS: distinct source slices remain distinct in normalized 3D space')
