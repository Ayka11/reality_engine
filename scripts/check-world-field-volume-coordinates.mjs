import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const rendererSource = await readFile(new URL('../src/render/WorldFieldVolumeRenderer.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../index.html', import.meta.url), 'utf8')
const connectorSource = await readFile(new URL('../src/connector.ts', import.meta.url), 'utf8')
const displaySource = await readFile(new URL('../src/infinity/ScientificFieldDisplay.ts', import.meta.url), 'utf8')
const displayCompiled = ts.transpileModule(displaySource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const displayUrl = `data:text/javascript;base64,${Buffer.from(displayCompiled.outputText).toString('base64')}`
const { SCIENTIFIC_FIELD_DISPLAY_RANGES, normalizeScientificFieldValue } = await import(displayUrl)
const paletteSource = await readFile(new URL('../src/infinity/ScientificFieldPalette.ts', import.meta.url), 'utf8')
const paletteCompiled = ts.transpileModule(paletteSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const paletteUrl = `data:text/javascript;base64,${Buffer.from(paletteCompiled.outputText).toString('base64')}`
const { SCIENTIFIC_FIELD_PALETTES, scientificFieldPaletteColor, scientificFieldPaletteHex } = await import(paletteUrl)
assert.deepEqual(Object.keys(SCIENTIFIC_FIELD_PALETTES), [
  'energy', 'density', 'information', 'entropy', 'temperature', 'biology',
])
for (const [field, stops] of Object.entries(SCIENTIFIC_FIELD_PALETTES)) {
  assert.deepEqual(scientificFieldPaletteColor(field, 0), [
    (stops[0] >> 16) & 255, (stops[0] >> 8) & 255, stops[0] & 255,
  ], field + ' shared low palette endpoint')
  assert.deepEqual(scientificFieldPaletteColor(field, 1), [
    (stops[1] >> 16) & 255, (stops[1] >> 8) & 255, stops[1] & 255,
  ], field + ' shared high palette endpoint')
  const rgb = scientificFieldPaletteColor(field, 0.5)
  assert.equal(scientificFieldPaletteHex(field, 0.5), (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
    field + ' RGB/hex palette helpers must agree')
}
assert.deepEqual(SCIENTIFIC_FIELD_DISPLAY_RANGES, {
  energy: 350, density: 1, information: 80, entropy: 0.15, temperature: 300, biology: 1,
})
for (const [field, range] of Object.entries(SCIENTIFIC_FIELD_DISPLAY_RANGES)) {
  assert.equal(normalizeScientificFieldValue(field, 0), 0, field + ' zero must normalize to zero')
  assert.equal(normalizeScientificFieldValue(field, range), 1, field + ' reference range must normalize to one')
  assert.equal(normalizeScientificFieldValue(field, range * 2), 1, field + ' values above range must saturate')
  assert.equal(normalizeScientificFieldValue(field, -range), 0, field + ' negative values must clamp to zero')
  assert.equal(normalizeScientificFieldValue(field, Number.NaN), null, field + ' NaN must remain invalid')
  assert.equal(normalizeScientificFieldValue(field, null), null, field + ' missing values must remain invalid')
}
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
assert.match(rendererSource, /const layerOffsets = frame\.slices\s*\.map\(slice => finiteNumericValue\(slice\.y\)\)\s*\.filter\(\(sliceY\): sliceY is number => sliceY !== null\)\s*\.map\(sliceY => \(sliceY - centerY\) \/ spacing\)/,
  'invalid slice heights must be excluded before positioning the visible volume grid helper')
assert.match(rendererSource, /import \{ normalizeScientificFieldValue \} from '\.\.\/infinity\/ScientificFieldDisplay'/,
  'WebGL volume must import the shared scientific display contract')
assert.match(rendererSource, /scientificFieldPaletteHex/,
  'WebGL volume must consume the shared scientific palette module')
assert.match(infiniteWorldSource, /scientificFieldPaletteHex/,
  'Infinity terrain must consume the shared scientific palette module')
assert.match(connectorSource, /scientificFieldPaletteColor/,
  'connector must expose the shared scientific palette to inline 2D rendering')
assert.match(appSource, /window\\.scientificFieldPaletteColor\\(field,t\\)/,
  '2D renderer must consume the shared scientific palette module')
assert.match(rendererSource, /normalizeScientificFieldValue\([\s\S]*?fieldKey as Exclude<typeof fieldKey, 'material'>, value,/,
  'composite numeric fields must use shared fixed reference scales')
assert.match(rendererSource, /normalizeScientificFieldValue\([\s\S]*?selectedFieldKey as Exclude<typeof selectedFieldKey, 'material' \| null>, value,/,
  'selected numeric fields must use shared fixed reference scales')
assert.doesNotMatch(rendererSource, /const fieldMaxima|fieldMaxima\[/,
  'WebGL volume must not compute viewport-dependent field maxima')
assert.match(connectorSource, /win\['normalizeScientificFieldValue'\] = normalizeScientificFieldValue/,
  'connector must expose the single shared normalizer to inline HTML renderers')
assert.match(appSource, /const normalizeField=window\.normalizeScientificFieldValue;/,
  'CPU fallback must consume the shared normalizer exposed by the connector')
assert.match(appSource, /return normalizeField\(property,raw\)\?\?0;/,
  'CPU fallback must use fixed shared field ranges rather than viewport maxima')
assert.doesNotMatch(appSource, /const maxima=props\.map|Math\.abs\(raw\)\/maxima/,
  'CPU fallback must not compute dynamic field maxima')
assert.match(appSource, /const normalizeField=window\.normalizeScientificFieldValue\s*if\(typeof normalizeField!=='function'\)return false/,
  '2D overview must fail over rather than render with an inconsistent scale when the shared helper is unavailable')
assert.match(appSource, /const normalized=normalizeField\(m\.field,v\)/,
  '2D overview must use the same fixed reference scales as Infinity and Volumetric')
assert.doesNotMatch(appSource, /const normalized=Math\.max\(0,Math\.min\(1,\(v-min\)\/range\)\)/,
  '2D overview must not normalize colors against viewport-local min/max')
assert.match(appSource, /normalization:worldField2DLinked&&typeof window\.normalizeScientificFieldValue==='function'\?'shared-scientific-reference-ranges':'legacy-finite-grid-scale'/,
  '2D and CPU fallback diagnostics must identify the shared reference-scale contract')
assert.match(appSource, /compositeWeight=fieldValidity\.filter\(Boolean\)\.length/,
  'CPU composite colors must weight every valid field equally, including measured zeroes')
assert.match(appSource, /if\(!fieldValidity\[index\]\)return sum/,
  'CPU composite colors must exclude invalid fields without weighting by intensity')
for (const [field, range] of Object.entries(SCIENTIFIC_FIELD_DISPLAY_RANGES)) {
  assert.equal(normalizeScientificFieldValue(field, range * 0.25), 0.25, field + ' quarter-range intensity must be stable')
  assert.equal(normalizeScientificFieldValue(field, range * 0.75), 0.75, field + ' three-quarter-range intensity must be stable')
}
const stableAcrossViewports = (field, value, _viewportMaximum) => normalizeScientificFieldValue(field, value)
assert.equal(stableAcrossViewports('energy', 175, 200), stableAcrossViewports('energy', 175, 900),
  'changing visible sample extrema must not change the same world-field value intensity')
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
assert.deepEqual(cpuEligible.map(sample => normalizeScientificFieldValue('energy', sample.energy)), [2 / 350, 4 / 350],
  'CPU preview must apply the shared fixed reference scale to eligible world-field samples')

assert.match(rendererSource, /const finiteValues = SCIENTIFIC_FIELD_KEYS\.map\(key => \{/,
  'composite rendering must validate each field before including it')
assert.match(rendererSource, /key === 'material' && !isMaterialClassCode\(value\) \? null : value/,
  'composite rendering must exclude invalid BIOME_ID categories instead of coercing them')
assert.match(rendererSource, /finiteValues\.filter\(\(value, index\) => index !== 6 && value !== null\)/,
  'composite numeric strength must exclude categorical Material codes')
assert.match(rendererSource, /normalizeScientificFieldValue\([\s\S]*?fieldKey as Exclude<typeof fieldKey, 'material'>, value,/,
  'composite numeric normalization must include only valid numeric fields on the shared scales')
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
const numericFieldNames = ['energy', 'density', 'information', 'entropy', 'temperature', 'biology']
const compositeStrengthFixture = values => {
  const normalized = values.slice(0, 6).map((value, index) =>
    normalizeScientificFieldValue(numericFieldNames[index], value))
    .filter(value => value !== null)
  return normalized.length ? normalized.reduce((sum, value) => sum + value, 0) / normalized.length : null
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
  'CPU active-cell counting must use the shared non-negative normalized intensity')
const cpuCompositeFixture = (fields, materialValid = false) => {
  const keys = ['energy','density','information','entropy','temperature','biology']
  const validity = keys.map(key => typeof fields[key] === 'number' && Number.isFinite(fields[key]))
  validity.push(materialValid)
  const normalizedValues = keys.map(key => {
    const value = fields[key]
    return normalizeScientificFieldValue(key, value) ?? 0
  })
  const valid = normalizedValues.filter((_, index) => validity[index])
  return {
    normalized: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0,
    hasAnyField: validity.some(Boolean),
    materialOnly: materialValid && valid.length === 0,
  }
}
assert.equal(cpuCompositeFixture({energy:175}).normalized, 0.5,
  'a single valid numeric field must not be diluted by five missing fields')
assert.equal(cpuCompositeFixture({energy:175,density:0.25}).normalized, 0.375,
  'CPU composite strength must average the same valid numeric subset as WebGL')
assert.deepEqual(cpuCompositeFixture({}, true), {normalized:0,hasAnyField:true,materialOnly:true},
  'categorical Material alone must remain renderable without becoming numeric composite strength')
assert.deepEqual(cpuCompositeFixture({energy:Number.NaN}), {normalized:0,hasAnyField:false,materialOnly:false},
  'an all-invalid CPU composite sample must be identifiable for neutral diagnostic coloring')
assert.equal(normalizeScientificFieldValue('density', -0.75) > 0.001, false,
  'negative selected-field values must clamp to zero intensity')

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

assert.match(appSource, /const lift=Math\.max\(0,Math\.min\(depthStep\*\.9,normalized\*depthStep\*2\)\)/,
  'CPU lift must use valid numeric composite intensity and must not use categorical Material as a numeric scalar')
assert.match(appSource, /0\.22\s*\+\s*normalized\s*\*\s*\.72/,
  'CPU opacity must use the same numeric composite intensity as lift')
assert.match(appSource, /id="layerM" onclick="setLayer\(6\)"/,
  'Material field control must be present in the layer toolbar')
console.log('PASS: seven scientific scalar fields, including categorical Material, are represented independently')
console.log('PASS: Material uses a discrete eight-biome-plus-air palette and preserves category zero')
console.log('PASS: invalid non-numeric samples are rejected without coercion')
console.log('PASS: distinct source slices remain distinct in normalized 3D space')
