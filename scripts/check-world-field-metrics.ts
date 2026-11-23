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

let profileCalls = 0
const profileSampler = {
  sample(x: number, y: number, z: number) {
    profileCalls++
    return {
      energy: x + y + z,
      density: x,
      information: y,
      entropy: z,
      temperature: x * 2,
      biology: Number.isFinite(x) ? 1 : Number.NaN,
      material: profileCalls === 2 ? Number.NaN : z - 1,
    }
  },
} as unknown as FieldSampler
const profileMetrics = new WorldFieldMetrics(profileSampler, 2, 5)
const profileBounds = {
  min: { x: -4, y: 2, z: -8 },
  max: { x: 4, y: 6, z: 0 },
}
const xProfile = profileMetrics.sampleProfile('x', profileBounds, 3)
assert.equal(xProfile.axis, 'x')
assert.equal(xProfile.count, 3)
assert.equal(profileCalls, 3)
assert.deepEqual(xProfile.points.map(point => point.coordinate), [-4, 0, 4])
assert.deepEqual(xProfile.points.map(point => point.position.y), [4, 4, 4])
assert.deepEqual(xProfile.points.map(point => point.position.z), [-4, -4, -4])
assert.equal(xProfile.points[0].position.x, -4)
assert.equal(xProfile.points[1].values.material, null)
assert.equal(xProfile.points[1].validity.material, false)
assert.equal(xProfile.stats.material.count, 2)
assert.equal(xProfile.stats.material.invalid, 1)
assert.equal(xProfile.stats.energy.count, 3)
assert.equal(xProfile.stats.energy.mean, 0)

// A one-point profile samples the selected interval midpoint and keeps the
// other coordinates at their respective bounds midpoints.
const single = profileMetrics.sampleProfile('y', profileBounds, 1)
assert.equal(single.count, 1)
assert.equal(single.points[0].coordinate, 4)
assert.deepEqual(single.points[0].position, { x: 0, y: 4, z: -4 })

// Zero-width selected bounds and negative world coordinates are both valid.
const zeroWidth = profileMetrics.sampleProfile('z', {
  min: { x: -3, y: -2, z: -7 },
  max: { x: -3, y: -2, z: -7 },
}, 2)
assert.deepEqual(zeroWidth.points.map(point => point.coordinate), [-7, -7])
assert.deepEqual(zeroWidth.points.map(point => point.position.x), [-3, -3])
assert.deepEqual(zeroWidth.points.map(point => point.position.y), [-2, -2])
assert.throws(() => profileMetrics.sampleProfile('q' as any, profileBounds, 2), /axis/)
assert.throws(() => profileMetrics.sampleProfile('x', profileBounds, 0), /resolution/)
assert.throws(() => profileMetrics.sampleProfile('x', profileBounds, 6), /sample limit/)
assert.throws(() => profileMetrics.sampleProfile('x', {
  min: { x: 1, y: 0, z: 0 },
  max: { x: -1, y: 1, z: 1 },
}, 2), /bounds/)
assert.equal(profileMetrics.getSeries('energy').length, 0, 'profiles must not mutate time-series history')

console.log('WORLD FIELD METRICS: PASS')

