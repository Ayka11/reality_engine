import assert from 'node:assert/strict'
import { WorldFieldMetrics } from '../src/infinity/WorldFieldMetrics'
import type { FieldSampler } from '../src/infinity/FieldSampler'

let calls = 0
const sampler = {
  sample(x: number, y: number, z: number) {
    calls++
    return {
      energy: x + y + z,
      density: 0.25,
      information: x,
      entropy: 0.5,
      temperature: y * 2,
      biology: z,
      material: Number.NaN,
    }
  },
} as unknown as FieldSampler

const metrics = new WorldFieldMetrics(sampler, 2, 100)
const bounds = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } }
const resolution = { x: 3, y: 3, z: 3 }
const first = metrics.sample(10, bounds, resolution)
assert.equal(calls, 27)
assert.equal(first.energy.count, 27)
assert.equal(first.energy.min, 0)
assert.equal(first.energy.max, 6)
assert.equal(first.energy.mean, 3)
assert.equal(first.material.count, 0)
assert.equal(first.material.invalid, 27)
assert.equal(first.material.mean, 0)
assert.equal(metrics.getSeries('energy').length, 1)
assert.equal(metrics.getSeries('energy', 0).length, 0)
assert.equal(metrics.getStats('temperature').mean, 2)

metrics.sample(11, bounds, { x: 1, y: 1, z: 1 })
metrics.sample(12, bounds, { x: 1, y: 1, z: 1 })
assert.deepEqual(metrics.getSeries('energy').map(point => point.tick), [11, 12])
const csv = metrics.exportCSV()
assert.match(csv, /^tick,energy,density,information,entropy,temperature,biology,material/m)
assert.match(csv, /11,/)
assert.match(csv, /12,/)

assert.throws(() => metrics.sample(-1, bounds, resolution), /tick/)
assert.throws(() => metrics.sample(13, bounds, { x: 100, y: 100, z: 100 }), /exceeds configured limit/)
assert.throws(() => metrics.sample(13, { min: { x: 2, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }, resolution), /bounds/)
assert.throws(() => metrics.getSeries('energy', -1), /limit/)

metrics.clear()
assert.equal(metrics.getSeries('energy').length, 0)
assert.equal(metrics.getStats('energy').count, 0)
console.log('WORLD FIELD METRICS: PASS')
