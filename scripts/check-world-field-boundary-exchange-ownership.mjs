import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/infinity/WorldFieldBoundaryExchange.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { WorldFieldBoundaryExchange } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)

const fields = {
  energy: 10, density: 0.2, information: 3, entropy: 0.1,
  temperature: 22, biology: 0.4, material: 2,
}
const exchange = new WorldFieldBoundaryExchange()
const positiveInput = [{ ...fields }]
const positive = exchange.publish({ cx: 0, cy: 0, cz: 0 }, 'x', 1, positiveInput)
positiveInput[0].energy = 999
positive.samples[0].energy = 888
positive.coord.cx = 42

const storedPositive = exchange.get({ cx: 0, cy: 0, cz: 0 }, 'x', 1)
assert.ok(storedPositive)
assert.equal(storedPositive.samples[0].energy, 10)
assert.equal(storedPositive.coord.cx, 0)

// get() must not return the mutable internal face or sample records.
storedPositive.samples[0].energy = 777
storedPositive.coord.cy = 33
const rereadPositive = exchange.get({ cx: 0, cy: 0, cz: 0 }, 'x', 1)
assert.ok(rereadPositive)
assert.equal(rereadPositive.samples[0].energy, 10)
assert.equal(rereadPositive.coord.cy, 0)

const negativeInput = [{ ...fields }]
const negative = exchange.publish({ cx: 1, cy: 0, cz: 0 }, 'x', -1, negativeInput)
negative.samples[0].energy = 555
negativeInput[0].energy = 444
assert.deepEqual(exchange.validatePair({ cx: 0, cy: 0, cz: 0 }, 'x'), {
  paired: true,
  samples: 1,
  maxDelta: 0,
})

const mismatched = exchange.publish(
  { cx: 1, cy: 0, cz: 0 },
  'x',
  -1,
  [{ ...fields, energy: 11 }],
)
mismatched.samples[0].energy = -1
assert.equal(exchange.validatePair({ cx: 0, cy: 0, cz: 0 }, 'x').maxDelta, 1)

exchange.clearForChunk({ cx: 1, cy: 0, cz: 0 })
assert.equal(exchange.get({ cx: 1, cy: 0, cz: 0 }, 'x', -1), null)
assert.equal(exchange.size(), 1)

console.log('World field boundary exchange detached-snapshot ownership regression: PASS')
