import assert from 'node:assert/strict'
import {
  agentGridToWorld,
  agentWorldToGrid,
  agentWorldToGridCell,
  validateAgentGridWorldTransform,
  type AgentGridWorldTransform,
} from '../src/simulation/AgentGridWorldTransform.ts'

const axisAligned: AgentGridWorldTransform = {
  schemaVersion: 'agent-grid-world-transform-v1',
  gridDimensions: { width: 10, height: 8, depth: 6 },
  // World-space center of finite grid cell (0, 0, 0).
  worldOrigin: { x: 100, y: 20, z: -50 },
  // Explicit world displacement for one grid step along each grid axis.
  gridBasis: {
    x: { x: 2, y: 0, z: 0 },
    y: { x: 0, y: 3, z: 0 },
    z: { x: 0, y: 0, z: 4 },
  },
}

const validated = validateAgentGridWorldTransform(axisAligned)
assert.equal(validated.valid, true)
assert.deepEqual(validated.errors, [])
assert.ok(validated.transform)
assert.deepEqual(agentGridToWorld(axisAligned, { x: 4, y: 2, z: 3 }), {
  x: 108, y: 26, z: -38,
}, 'axis-aligned grid coordinates must apply per-axis world scale and origin')

const world = agentGridToWorld(axisAligned, { x: 4, y: 2, z: 3 })
assert.deepEqual(agentWorldToGrid(axisAligned, world), { x: 4, y: 2, z: 3 })
assert.deepEqual(agentWorldToGridCell(axisAligned, world), { x: 4, y: 2, z: 3 })
assert.deepEqual(agentWorldToGridCell(axisAligned, { x: 109, y: 27.4, z: -38 }), {
  x: 5, y: 2, z: 3,
}, 'world coordinates must resolve to the nearest in-bounds grid cell')
assert.equal(agentWorldToGridCell(axisAligned, { x: 1000, y: 20, z: -50 }), null)

const rotated: AgentGridWorldTransform = {
  schemaVersion: 'agent-grid-world-transform-v1',
  gridDimensions: { width: 5, height: 5, depth: 5 },
  worldOrigin: { x: 10, y: 20, z: 30 },
  // Grid X maps to world +Z; grid Z maps to world -X.
  gridBasis: {
    x: { x: 0, y: 0, z: 1 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: -1, y: 0, z: 0 },
  },
}
const rotatedWorld = agentGridToWorld(rotated, { x: 2, y: 3, z: 4 })
assert.deepEqual(rotatedWorld, { x: 6, y: 23, z: 32 },
  'the transform must support explicit axis rotation and reordering')
assert.deepEqual(agentWorldToGrid(rotated, rotatedWorld), { x: 2, y: 3, z: 4 })

const oblique: AgentGridWorldTransform = {
  schemaVersion: 'agent-grid-world-transform-v1',
  gridDimensions: { width: 10, height: 10, depth: 10 },
  worldOrigin: { x: -4, y: 2, z: 8 },
  gridBasis: {
    x: { x: 1, y: 0.2, z: 0 },
    y: { x: 0.1, y: 2, z: 0.3 },
    z: { x: 0, y: -0.2, z: 3 },
  },
}
const obliqueGrid = { x: 5, y: 4, z: 6 }
const obliqueWorld = agentGridToWorld(oblique, obliqueGrid)
const inverse = agentWorldToGrid(oblique, obliqueWorld)
assert.ok(Math.abs(inverse.x - obliqueGrid.x) < 1e-10)
assert.ok(Math.abs(inverse.y - obliqueGrid.y) < 1e-10)
assert.ok(Math.abs(inverse.z - obliqueGrid.z) < 1e-10,
  'inverse transform must recover oblique basis coordinates')

const detachedInput = structuredClone(axisAligned)
const detached = validateAgentGridWorldTransform(detachedInput)
detachedInput.worldOrigin.x = 999
assert.equal(detached.transform?.worldOrigin.x, 100,
  'validated transform must be detached from caller-owned mutable input')

const invalidTransforms: unknown[] = [
  null,
  {},
  { ...axisAligned, schemaVersion: 'legacy' },
  { ...axisAligned, gridDimensions: { width: 0, height: 8, depth: 6 } },
  { ...axisAligned, gridDimensions: { width: 10, height: 1.5, depth: 6 } },
  { ...axisAligned, worldOrigin: { x: Number.NaN, y: 0, z: 0 } },
  { ...axisAligned, gridBasis: { ...axisAligned.gridBasis, x: { x: 0, y: 0, z: 0 } } },
  { ...axisAligned, gridBasis: {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 2, y: 0, z: 0 },
    z: { x: 0, y: 0, z: 1 },
  } },
  { ...axisAligned, gridBasis: {
    x: { x: 1, y: 0, z: 0 },
    y: { x: 0, y: 1, z: 0 },
    z: { x: 1e-12, y: 1, z: 0 },
  } },
]
for (const candidate of invalidTransforms) {
  assert.equal(validateAgentGridWorldTransform(candidate).valid, false,
    'invalid or non-invertible transform configurations must be rejected')
}

assert.throws(() => agentGridToWorld(axisAligned, { x: 10, y: 0, z: 0 }), /outside/)
assert.throws(() => agentGridToWorld(axisAligned, { x: Number.POSITIVE_INFINITY, y: 0, z: 0 }), /finite/)
assert.throws(() => agentWorldToGrid(axisAligned, { x: 0, y: Number.NaN, z: 0 }), /finite/)

const badScale = {
  ...axisAligned,
  gridBasis: {
    ...axisAligned.gridBasis,
    x: { x: 0.0000000001, y: 0, z: 0 },
  },
}
assert.equal(validateAgentGridWorldTransform(badScale).valid, false,
  'near-zero grid scale must not create unstable inverse transforms')

console.log('AgentGridWorldTransform affine mapping, axis permutation, inversion, bounds and validation: PASS')
