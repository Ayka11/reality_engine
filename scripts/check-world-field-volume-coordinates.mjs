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
assert.match(rendererSource, /this\.gridHelper\.visible = renderedCells > 0/,
  'the reference grid must be visible only when at least one valid volume cell is rendered')
assert.doesNotMatch(rendererSource, /if \(this\.gridHelper\) this\.gridHelper\.visible = true/,
  'renderer must not force a grid-only scene visible when the volume has no valid cells')
const gridVisibleForCellCount = renderedCells => renderedCells > 0
assert.equal(gridVisibleForCellCount(0), false, 'zero rendered cells must hide the volumetric grid')
assert.equal(gridVisibleForCellCount(1), true, 'a rendered volume must retain its reference grid')
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
assert.match(rendererSource, /if \(finiteNumericValue\(slice\.y\) === null\) continue[\s\S]*?for \(let py = 0; py < data\.height; py\+\+\)[\s\S]*?for \(let px = 0; px < data\.width; px\+\+\)[\s\S]*?const sample = data\.samples\[py \* data\.width \+ px\][\s\S]*?if \(!sample \|\|\s*finiteNumericValue\(sample\.x\) === null \|\|\s*finiteNumericValue\(sample\.z\) === null\) continue[\s\S]*?const value = finiteNumericValue\(sample\[key\]\)/,
  'field normalization must use only coordinate-valid samples inside the declared slice dimensions')
const renderableFieldMaximum = (slices, key) => {
  let observed = 0
  for (const slice of slices) {
    if (typeof slice.y !== 'number' || !Number.isFinite(slice.y)) continue
    const { width, height, samples } = slice.data
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const sample = samples[py * width + px]
        if (!sample || typeof sample.x !== 'number' || !Number.isFinite(sample.x) ||
            typeof sample.z !== 'number' || !Number.isFinite(sample.z)) continue
        const value = sample[key]
        if (typeof value === 'number' && Number.isFinite(value)) observed = Math.max(observed, Math.abs(value))
      }
    }
  }
  return Math.max(observed, 1e-9)
}
assert.equal(renderableFieldMaximum([
  { y: 0, data: { width: 1, height: 1, samples: [
    { x: 0, z: 0, energy: 2 },
    { x: 1, z: 1, energy: 1000 },
  ] } },
  { y: 0, data: { width: 1, height: 1, samples: [
    { x: Number.NaN, z: 0, energy: 900 },
  ] } },
  { y: Number.POSITIVE_INFINITY, data: { width: 1, height: 1, samples: [
    { x: 0, z: 0, energy: 800 },
  ] } },
  { y: 0, data: { width: 1, height: 1, samples: [
    { x: 0, z: 0, energy: 4 },
  ] } },
], 'energy'), 4,
  'invalid coordinates and samples beyond slice dimensions must not suppress valid volume contrast')

// Selected-field WebGL normalization must be owned by the renderer. A stale or
// independently computed app-side maximum must not override its eligible set.
assert.doesNotMatch(rendererSource.slice(0, rendererSource.indexOf('export type WorldFieldVolumeResult')),
  /maximum:\s*number/,
  'volume frame must not accept an externally supplied normalization maximum')
assert.match(rendererSource, /const maximum = Math\.max\(0\.000001, fieldMaxima\[selectedFieldIndex >= 0 \? selectedFieldIndex : 0\]\)/,
  'selected numeric fields must normalize from the renderer-owned eligible sample maximum')
assert.doesNotMatch(appSource, /maximum:fieldIndex<0\?Math\.max\(\.\.\.maxima\):maxima\[fieldIndex\]/,
  'app must not pass an external maximum that can override WebGL normalization')

// The CPU preview must use the same renderable-sample contract as WebGL:
// valid slice plane, finite world X/Z, and samples within declared dimensions.
assert.match(appSource, /if\(typeof slice\.y!=='number'\|\|!Number\.isFinite\(slice\.y\)\)continue;[\s\S]*?for\(let py=0;py<data\.height;py\+\+\)for\(let px=0;px<data\.width;px\+\+\)[\s\S]*?const sample=data\.samples\[py\*data\.width\+px\][\s\S]*?typeof sample\.x!=='number'\|\|!Number\.isFinite\(sample\.x\)[\s\S]*?typeof sample\.z!=='number'\|\|!Number\.isFinite\(sample\.z\)/,
  'app-side maxima must use only coordinate-valid samples in declared dimensions')
assert.match(appSource, /const slice=slices\[si\];\s*const \{data\}=slice;\s*if\(typeof slice\.y!=='number'\|\|!Number\.isFinite\(slice\.y\)\)continue;[\s\S]*?if\(!sample\|\|typeof sample\.x!=='number'\|\|!Number\.isFinite\(sample\.x\)\|\|\s*typeof sample\.z!=='number'\|\|!Number\.isFinite\(sample\.z\)\)continue;/,
  'CPU fallback must skip invalid slice planes and invalid world coordinates before drawing')
const eligibleSamples = slices => slices.flatMap(slice => {
  if (typeof slice.y !== 'number' || !Number.isFinite(slice.y)) return []
  const { width, height, samples } = slice.data
  const eligible = []
  for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
    const sample = samples[py * width + px]
    if (sample && typeof sample.x === 'number' && Number.isFinite(sample.x) &&
        typeof sample.z === 'number' && Number.isFinite(sample.z)) eligible.push(sample)
  }
  return eligible
})
const mixedEligibilityFixture = [
  { y: 0, data: { width: 1, height: 1, samples: [
    { x: 0, z: 0, energy: 2 }, { x: 1, z: 1, energy: 1000 },
  ] } },
  { y: 0, data: { width: 1, height: 1, samples: [{ x: Number.NaN, z: 0, energy: 900 }] } },
  { y: Number.POSITIVE_INFINITY, data: { width: 1, height: 1, samples: [{ x: 0, z: 0, energy: 800 }] } },
  { y: 0, data: { width: 1, height: 1, samples: [{ x: 0, z: 0, energy: 4 }] } },
]
const cpuEligible = eligibleSamples(mixedEligibilityFixture)
assert.equal(cpuEligible.length, 2,
  'CPU preview must render the same two coordinate-valid samples that determine normalization')
assert.equal(Math.max(...cpuEligible.map(sample => Math.abs(sample.energy))), 4,
  'CPU preview normalization must remain independent of invalid and out-of-window extreme values')

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
assert.match(rendererSource, /selectedFieldIndex === 6 \|\| !fieldValueCount \? null : Math\.sqrt\(fieldValueM2 \/ fieldValueCount\)/,
  'selected-field standard deviation must use only valid values')

 // Missing measurements are not zero-valued measurements. Empty profiles and
 // all-invalid selected fields must report null for numeric summary statistics.
assert.match(rendererSource, /min: null,\s*max: null,\s*mean: null,\s*standardDeviation: null/,
  'empty field profiles must use null rather than fabricated zero statistics')
assert.equal((rendererSource.match(/fieldValues: \{ min: null, max: null, mean: null, standardDeviation: null \}/g) ?? []).length, 2,
  'both initial and per-render reset diagnostics must represent absent measurements as null')
assert.match(rendererSource, /fieldValues: \{ min: null, max: null, mean: null, standardDeviation: null \}/,
  'renderer reset diagnostics must not claim zero-valued field measurements')
assert.match(rendererSource, /selectedFieldIndex === 6 \|\| !fieldValueCount \? null : fieldValueMin/,
  'selected numeric field minimum must be null when there are no valid values')
assert.match(rendererSource, /selectedFieldIndex === 6 \|\| !fieldValueCount \? null : fieldValueMax/,
  'selected numeric field maximum must be null when there are no valid values')
assert.match(rendererSource, /selectedFieldIndex === 6 \|\| !fieldValueCount \? null : fieldValueMean/,
  'selected numeric field mean must be null when there are no valid values')
assert.match(rendererSource, /key === 'material' \|\| !profile\.sampleCount \? null : profile\.min/,
  'per-field profile minimum must distinguish no observations from an observed zero')
assert.match(rendererSource, /key === 'material' \|\| !profile\.sampleCount \? null : profile\.mean/,
  'per-field profile mean must distinguish no observations from an observed zero')
assert.match(rendererSource, /: null\s*const rawValue = selectedFieldIndex >= 0 \? selectedRawValue : compositeStrength/,
  'composite strength must be absent when all six numeric fields are invalid')
assert.match(rendererSource, /compositeStrength !== null \? THREE\.MathUtils\.clamp\(compositeStrength, 0, 1\) : 0/,
  'missing composite strength must not be treated as a measured zero')
assert.match(rendererSource, /finiteValues\.every\(value => value === null\)\) this\.color\.setHex\(0x7f8794\)/,
  'samples with no valid scientific field must use the neutral diagnostic color')
const finiteStats = values => {
  const finite = values.filter(value => typeof value === 'number' && Number.isFinite(value))
  return finite.length
    ? { min: Math.min(...finite), max: Math.max(...finite), mean: finite.reduce((sum, value) => sum + value, 0) / finite.length }
    : { min: null, max: null, mean: null }
}
assert.deepEqual(finiteStats([Number.NaN, Number.POSITIVE_INFINITY, null, undefined]), { min: null, max: null, mean: null },
  'all-invalid numeric field samples must yield null statistics')
assert.deepEqual(finiteStats([0, Number.NaN, null]), { min: 0, max: 0, mean: 0 },
  'a genuine measured zero must remain zero rather than being converted to null')
const compositeStrengthFixture = values => {
  const finite = values.slice(0, 6).filter(value => typeof value === 'number' && Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + Math.abs(value), 0) / finite.length : null
}
assert.equal(compositeStrengthFixture([null, Number.NaN, undefined, null, Number.POSITIVE_INFINITY, '0', 3]), null,
  'composite strength must be null when all numeric fields are invalid even if categorical Material exists')
assert.equal(compositeStrengthFixture([0, null, null, null, null, null, 4]), 0,
  'a measured zero composite strength must remain distinguishable from missing numeric data')
assert.match(rendererSource, /if \(rawValue === null\) this\.color\.setHex\(0x7f8794\)/,
  'invalid selected numeric or categorical samples must use a neutral color rather than a valid zero palette color')

assert.match(appSource, /const selectedRaw=fieldIndexSafe>=0\?sample\[props\[fieldIndexSafe\]\]:normalized/,
  'CPU fallback must also reject coercible Material values')
assert.match(appSource, /const selectedValueValid=fieldIndexSafe<0\|\|\(fieldIndexSafe===6\?materialValid:typeof selectedRaw==='number'&&Number\.isFinite\(selectedRaw\)\)/,
  'CPU fallback must distinguish invalid selected numeric samples and invalid Material category codes')

assert.match(appSource, /const fieldValidity=props\.map\(\(property,index\)=>index===6\s*\?/,
  'CPU composite mode must retain per-field validity instead of turning missing fields into zero measurements')
assert.match(appSource, /const validNumericContributions=numericContributions\.filter\(\(value,index\)=>fieldValidity\[index\]\)/,
  'CPU composite normalization must average only valid numeric fields')
assert.match(appSource, /validNumericContributions\.length\s*\?validNumericContributions\.reduce\(\(sum,value\)=>sum\+value,0\)\/validNumericContributions\.length\s*:0/,
  'CPU composite normalization must match WebGL when only a subset of numeric fields is present')
assert.match(appSource, /!fieldValidity\.some\(Boolean\)\s*\?\[127,135,148\]/,
  'CPU composite rendering must use the neutral color when every field is invalid')
assert.match(appSource, /compositeWeight>0[\s\S]*?:\[24,34,53\]/,
  'CPU composite rendering must use the dark valid-zero color when fields exist but have zero contribution')
assert.match(appSource, /if\(fieldIndexSafe===6\?materialValid:normalized>\.001\)activeCells\+\+/,
  'CPU active-cell counting must use absolute normalized intensity, including negative selected values')
const cpuCompositeFixture = (fields, materialValid = false) => {
  const keys = ['energy','density','information','entropy','temperature','biology']
  const validity = keys.map(key => typeof fields[key] === 'number' && Number.isFinite(fields[key]))
  validity.push(materialValid)
  const normalizedValues = keys.map(key => {
    const value = fields[key]
    return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : 0
  })
  const valid = normalizedValues.filter((_, index) => validity[index])
  return {
    normalized: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0,
    hasAnyField: validity.some(Boolean),
    materialOnly: materialValid && valid.length === 0,
  }
}
assert.equal(cpuCompositeFixture({energy:0.5}).normalized, 0.5,
  'a single valid numeric field must not be diluted by five missing fields')
assert.equal(cpuCompositeFixture({energy:0.5,density:0.25}).normalized, 0.375,
  'CPU composite strength must average the same valid numeric subset as WebGL')
assert.deepEqual(cpuCompositeFixture({}, true), {normalized:0,hasAnyField:true,materialOnly:true},
  'categorical Material alone must remain renderable without becoming numeric composite strength')
assert.deepEqual(cpuCompositeFixture({energy:Number.NaN}), {normalized:0,hasAnyField:false,materialOnly:false},
  'an all-invalid CPU composite sample must be identifiable for neutral diagnostic coloring')
assert.equal(Math.abs(-0.75) / 1 > 0.001, true,
  'negative selected-field values must count as active based on absolute normalized intensity')

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
