import assert from 'node:assert/strict'
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
] as const

assert.deepEqual(MATERIAL_CLASS_COLORS, expected)
for (let code = 0; code < expected.length; code++) {
  assert.equal(isMaterialClassCode(code), true, `BIOME_ID ${code} must be valid`)
  assert.equal(materialClassColor(code), expected[code], `BIOME_ID ${code} must map to its own color`)
}
for (const invalid of [null, undefined, true, false, '3', Number.NaN, Infinity, -1, 8, 1.5]) {
  assert.equal(isMaterialClassCode(invalid), false, `invalid category ${String(invalid)} must be rejected`)
  assert.equal(materialClassColor(invalid), 0x7f8794, `invalid category ${String(invalid)} must use the neutral fallback`)
}
console.log('PASS: all eight BIOME_ID categories map to stable discrete colors')
console.log('PASS: invalid, fractional, coercible, and out-of-range material codes are rejected')
