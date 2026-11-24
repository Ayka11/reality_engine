import assert from 'node:assert/strict'
import { BIOME_ID, MATERIAL_AIR_CLASS, WorldGenerator } from '../src/infinity/WorldGenerator'
import {
  MATERIAL_CLASS_COLORS,
  isMaterialClassCode,
  materialClassColor,
} from '../src/render/WorldFieldVolumeRenderer'

const expected = [
  0x173b70, // ocean
  0x2d8aa6, // coast
  0x8caa5b, // plains
  0x26734d, // forest
  0xd5b45c, // desert
  0x9bb9d6, // tundra
  0x827b76, // mountain
  0xf0e6d2, // alpine
  0x9aa6b2, // air
] as const

assert.deepEqual(MATERIAL_CLASS_COLORS, expected)

// Keep the renderer palette aligned with the authoritative terrain generator enum.
const biomeEntries = Object.entries(BIOME_ID)
assert.equal(biomeEntries.length, expected.length - 1, 'every biome must have exactly one material color; AIR is not a biome')
assert.deepEqual(
  biomeEntries.map(([, code]) => code).sort((a, b) => a - b),
  expected.slice(0, 8).map((_, code) => code),
  'BIOME_ID codes must remain contiguous and match the material palette indices',
)
for (let code = 0; code < expected.length; code++) {
  assert.equal(isMaterialClassCode(code), true, `Material class ${code} must be valid`)
  assert.equal(materialClassColor(code), expected[code], `Material class ${code} must map to its own color`)
}
assert.equal(MATERIAL_AIR_CLASS, 8, 'AIR must use the first code after the stable BIOME_ID range')
assert.equal(isMaterialClassCode(MATERIAL_AIR_CLASS), true, 'AIR must be a valid material category')
assert.equal(materialClassColor(MATERIAL_AIR_CLASS), expected[MATERIAL_AIR_CLASS], 'AIR must have its own palette color')

// Locate a deterministic ocean column, then prove that submerged samples remain
// ocean while samples above sea level are classified as air.
const generator = new WorldGenerator('material-air-ocean-regression')
let oceanColumn: { x: number; z: number } | null = null
for (let z = -4096; z <= 4096 && !oceanColumn; z += 256) {
  for (let x = -4096; x <= 4096; x += 256) {
    if (generator.sampleHeight(x, z) < generator.seaLevel - 1) {
      oceanColumn = { x, z }
      break
    }
  }
}
assert.ok(oceanColumn, 'test seed must contain at least one ocean column')
assert.equal(generator.sampleField(oceanColumn.x, generator.seaLevel - 0.5, oceanColumn.z).material, BIOME_ID.ocean,
  'water below sea level must retain the ocean category')
assert.equal(generator.sampleField(oceanColumn.x, generator.seaLevel + 1, oceanColumn.z).material, MATERIAL_AIR_CLASS,
  'space above sea level must use the dedicated AIR category')

const mountainGenerator = new WorldGenerator('mountain-biome-regression')
let generatedMountain = false
for (let z = -8192; z <= 8192 && !generatedMountain; z += 256) {
  for (let x = -8192; x <= 8192; x += 256) {
    const height = mountainGenerator.sampleHeight(x, z)
    if (height > 38 && mountainGenerator.sampleClimate(x, z, height).biome === 'mountain') {
      generatedMountain = true
      break
    }
  }
}
assert.equal(generatedMountain, true, 'terrain generation must produce the Mountain biome for a deterministic seed')

for (const invalid of [null, undefined, true, false, '3', Number.NaN, Infinity, -1, 9, 1.5]) {
  assert.equal(isMaterialClassCode(invalid), false, `invalid category ${String(invalid)} must be rejected`)
  assert.equal(materialClassColor(invalid), 0x7f8794, `invalid category ${String(invalid)} must use the neutral fallback`)
}
console.log('PASS: renderer palette indices match the authoritative BIOME_ID mapping')
console.log('PASS: all eight BIOME_ID categories plus AIR map to stable discrete colors')
console.log('PASS: ocean water and above-sea-level air remain distinct material categories')
console.log('PASS: the Mountain category is reachable from generated terrain')
console.log('PASS: invalid, fractional, coercible, and out-of-range material codes are rejected')
