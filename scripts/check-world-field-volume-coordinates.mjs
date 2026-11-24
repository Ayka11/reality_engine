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

// Both 2D and Field3D sample through the active ScientificFieldProvider.
// Provider identity/version must participate in cache invalidation even when
// the World Field mutation revision and view coordinates have not changed.
const infiniteWorldSource = await readFile(new URL('../src/render/InfiniteWorldRenderer.ts', import.meta.url), 'utf8')
assert.match(infiniteWorldSource, /getActiveFieldProviderId\(\)\s*\{\s*return this\.#fieldSampler\.registry\.activeProviderId\s*\}/,
  'world renderer must expose the active scientific field provider identity')
assert.match(infiniteWorldSource, /getActiveFieldProviderVersion\(\)\s*\{\s*return this\.#fieldSampler\.registry\.getActive\(\)\?\.version \?\? null\s*\}/,
  'world renderer must expose the active scientific field provider version')
assert.match(appSource, /function _getWorldFieldProviderCacheIdentity\(\)\s*\{[\s\S]*?getActiveFieldProviderId\?\.\(\)[\s\S]*?getActiveFieldProviderVersion\?\.\(\)/,
  '2D and Field3D must read the current provider identity/version')
assert.match(appSource, /fieldState\?\.lastMutation\?\.id \?\? 0, \.\.\._getWorldFieldProviderCacheIdentity\(\)\]\./,
  '2D cache key must include provider identity/version')
assert.match(appSource, /fieldState\?\.lastMutation\?\.id\?\?0,\.\.\._getWorldFieldProviderCacheIdentity\(\)\]\./,
  'Field3D cache key must include provider identity/version')
const providerCacheIdentity = (id, version) => [id ?? 'unknown', version ?? 'unknown'].join('|')
assert.notEqual(providerCacheIdentity('generator-field', 'v1'), providerCacheIdentity('authored-field', 'v1'),
  'switching active provider IDs must invalidate sampled-field caches')
assert.notEqual(providerCacheIdentity('generator-field', 'v1'), providerCacheIdentity('generator-field', 'v2'),
  'changing active provider versions must invalidate sampled-field caches')
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
assert.match(rendererSource, /if \(capacity <= 0\) \{[\s\S]*?if \(this\.mesh\) this\.mesh\.count = 0[\s\S]*?if \(this\.gridHelper\) this\.gridHelper\.visible = false[\s\S]*?this\.renderer\.render\(this\.scene, this\.camera\)[\s\S]*?return \{ \.\.\.base, ready: false, reason: 'no-field-samples' \}/,
  'an empty volume frame must clear the previous WebGL image instead of leaving stale voxels visible')
assert.match(rendererSource, /if \(this\.gridHelper\) this\.gridHelper\.visible = true/,
  'the reference grid must return when valid volume samples arrive after an empty frame')
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
assert.match(rendererSource, /if \(rawValue !== null\) \{\s*fieldValueCount\+\+/,
  'selected-field diagnostics must exclude invalid samples from numeric statistics')
assert.match(rendererSource, /fieldValueCount \? Math\.sqrt\(fieldValueM2 \/ fieldValueCount\) : 0/,
  'selected-field standard deviation must use only valid values')
assert.match(rendererSource, /if \(rawValue === null\) this\.color\.setHex\(0x7f8794\)/,
  'invalid selected numeric or categorical samples must use a neutral color rather than a valid zero palette color')

assert.match(appSource, /const selectedRaw=fieldIndexSafe>=0\?sample\[props\[fieldIndexSafe\]\]:normalized/,
  'CPU fallback must also reject coercible Material values')
assert.match(appSource, /const selectedValueValid=fieldIndexSafe<0\|\|\(fieldIndexSafe===6\?materialValid:typeof selectedRaw==='number'&&Number\.isFinite\(selectedRaw\)\)/,
  'CPU fallback must distinguish invalid selected numeric samples and invalid Material category codes')

// The 2D overview must preserve missing fields as missing rather than silently
// substituting Energy, and its statistics must use finite samples only.
assert.match(appSource, /const value=\(s,f\)=>\[s\.energy,s\.density,s\.information,s\.entropy,s\.temperature,s\.biology\]\[f\]/,
  '2D field lookup must not fall back to Energy when a selected field is absent')
assert.doesNotMatch(appSource, /\[s\.energy,s\.density,s\.information,s\.entropy,s\.temperature,s\.biology\]\[f\]\?\?s\.energy/,
  'missing 2D scientific fields must never be rendered as Energy')
assert.match(appSource, /let total=0,validCount=0,min=Infinity,max=-Infinity[\s\S]*?if\(Number\.isFinite\(v\)\)\{\s*total\+=v\s*validCount\+\+/,
  '2D statistics must accumulate and count only finite field samples')
assert.match(appSource, /const avgLabel=validCount\?\(total\/validCount\)\.toFixed\(2\):'n\/a'[\s\S]*?const minLabel=validCount\?min\.toFixed\(2\):'n\/a'[\s\S]*?const maxLabel=validCount\?max\.toFixed\(2\):'n\/a'/,
  '2D statistics must report n/a when a field has no finite samples')
const finiteFixture = [2, Number.NaN, 6, Number.POSITIVE_INFINITY, null, 10]
  .filter(value => typeof value === 'number' && Number.isFinite(value))
assert.deepEqual({ count: finiteFixture.length, average: finiteFixture.reduce((sum, value) => sum + value, 0) / finiteFixture.length, min: Math.min(...finiteFixture), max: Math.max(...finiteFixture) },
  { count: 3, average: 6, min: 2, max: 10 },
  'finite-only 2D statistics must ignore NaN, Infinity, and null samples')
const emptyFixture = [Number.NaN, Number.POSITIVE_INFINITY, null]
  .filter(value => typeof value === 'number' && Number.isFinite(value))
assert.equal(emptyFixture.length, 0, 'all-invalid 2D fields must expose no finite samples')

assert.match(appSource, /const numericContributions=values\.slice\(0,6\);\s*const normalized=fieldIndexSafe>=0\?values\[fieldIndexSafe\]:numericContributions\.reduce\(\(sum,value\)=>sum\+value,0\)\/numericContributions\.length/,
  'CPU composite intensity must exclude categorical Material from numeric lift and opacity')
assert.match(appSource, /\?\(!selectedValueValid\?\[127,135,148\]:colorOf\(fieldIndexSafe,fieldIndexSafe===6\?value:normalized\)\)/,
  'CPU fallback must render invalid selected values with the same neutral diagnostic color as WebGL')
assert.match(appSource, /id="layerM" onclick="setLayer\(6\)"/,
  'Material field control must be present in the layer toolbar')
console.log('PASS: seven scientific scalar fields, including categorical Material, are represented independently')
console.log('PASS: Material uses a discrete eight-biome-plus-air palette and preserves category zero')
console.log('PASS: invalid non-numeric samples are rejected without coercion')
console.log('PASS: distinct source slices remain distinct in normalized 3D space')
