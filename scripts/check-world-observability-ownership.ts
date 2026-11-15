import assert from 'node:assert/strict'
import { DecisionGraph } from '../src/infinity/DecisionGraph'
import { PhysicsInteractionLog } from '../src/infinity/PhysicsInteractionLog'
import { ExperimentCatalog } from '../src/infinity/ExperimentCatalog'
import { ExperimentRunner } from '../src/infinity/ExperimentRunner'
import type { ExperimentProtocol } from '../src/infinity/ExperimentProtocol'
import type { PhysicsInteractionRecord } from '../src/infinity/PhysicsInteractionRecord'

function makePhysicsRecord(): PhysicsInteractionRecord {
  return {
    id: 'physics-ownership-1',
    timestamp: 1,
    type: 'gravity',
    objectKind: 'building',
    objectId: 'object-1',
    particleIndex: 3,
    position: { x: 1, y: 2, z: 3 },
    field: { energy: 1, density: 0.2, information: 3, entropy: 0.01, temperature: 0.5, biology: 0.4, material: 0.7 },
    modulation: { gravity: 12 },
    magnitude: 5,
  }
}

function makeProtocol(): ExperimentProtocol {
  return {
    protocolVersion: 'experiment-protocol-v1',
    experimentId: 'experiment-ownership-1',
    timestamp: 1,
    world: { seed: 'seed-a', generatorVersion: 'world-generator-v1', surface: {
      seed: 'surface-a', providerId: 'surface-provider', providerVersion: 'v1',
    } },
    field: { providerId: 'field-provider', providerVersion: 'v1' },
    decision: { version: 'decision-v1', weights: {
      slope: 0.3, water: 0.25, elevation: 0.15, entropy: 0.08,
      density: 0.05, biology: 0.05, information: 0.04, distance: 0.08,
    } },
    physics: { version: 'physics-v1', parameters: {
      gravity: 48, entropyDamping: 0.82, quantumLift: 35, forcePush: 40, metaLawOrbit: 22,
    } },
    metadata: { label: 'original' },
  }
}

// DecisionGraph: caller-owned inputs and all observable read/write results are detached.
{
  const graph = new DecisionGraph()
  const source = {
    id: 'node-a',
    kind: 'analysis' as const,
    label: 'baseline',
    data: { nested: { scores: [1, 2, 3] } },
  }
  const inserted = graph.addNode(source)
  source.data.nested.scores[0] = 91
  inserted.data!.nested && ((inserted.data!.nested as { scores: number[] }).scores[1] = 92)
  assert.deepEqual((graph.getNode('node-a')!.data!.nested as { scores: number[] }).scores, [1, 2, 3])

  const fetched = graph.getNode('node-a')!
  ;(fetched.data!.nested as { scores: number[] }).scores[2] = 93
  const nodes = graph.getNodes()
  ;(nodes[0].data!.nested as { scores: number[] }).scores[0] = 94
  const snapshot = graph.snapshot()
  ;(snapshot.nodes[0].data!.nested as { scores: number[] }).scores[1] = 95
  assert.deepEqual((graph.getNode('node-a')!.data!.nested as { scores: number[] }).scores, [1, 2, 3])

  graph.addNode({ id: 'node-b', kind: 'world-object', label: 'linked' })
  const edge = graph.addEdge('node-a', 'node-b', 'supports')
  edge.from = 'tampered'
  const edges = graph.getEdges()
  edges[0].to = 'tampered'
  const snapshotEdges = graph.snapshot().edges
  snapshotEdges[0].type = 'created'
  assert.deepEqual(graph.getEdges(), [{ from: 'node-a', to: 'node-b', type: 'supports' }])

  const related = graph.relatedTo('node-a')
  related[0].label = 'tampered'
  assert.equal(graph.getNode('node-b')!.label, 'linked')
}

// PhysicsInteractionLog: records are copied on insertion and every read surface.
{
  const log = new PhysicsInteractionLog()
  const source = makePhysicsRecord()
  log.add(source)
  source.position.x = 91
  source.field.energy = 92
  source.modulation.gravity = 93
  const expected = makePhysicsRecord()

  const recent = log.recent()
  recent[0].position.x = 94
  log.byParticle(3)[0].field.energy = 95
  log.byObject('object-1')[0].modulation.gravity = 96
  log.snapshot()[0].position.z = 97
  assert.deepEqual(log.recent()[0], expected)
}

// ExperimentRunner: protocol and result inputs are detached, and returned snapshots cannot rewrite the run.
{
  const runner = new ExperimentRunner()
  const protocol = makeProtocol()
  const started = runner.start(protocol)
  protocol.world.seed = 'tampered-input'
  protocol.decision.weights.slope = 0.99
  started.protocol.world.seed = 'tampered-start-result'
  started.protocol.decision.weights.slope = 0.98

  const input = { samples: [{ tick: 1, values: [1, 2] }] }
  runner.record('trace', input)
  input.samples[0].values[0] = 99
  const finished = runner.finish('completed')
  const committedFingerprint = finished.fingerprint
  finished.protocol.world.surface!.seed = 'tampered-output'
  ;(finished.results.trace as typeof input).samples[0].values[1] = 98

  const later = runner.finish('completed')
  assert.equal(later.protocol.world.seed, 'seed-a')
  assert.equal(later.protocol.world.surface!.seed, 'surface-a')
  assert.equal(later.protocol.decision.weights.slope, 0.3)
  assert.deepEqual(later.results.trace, { samples: [{ tick: 1, values: [1, 2] }] })
  assert.equal(later.fingerprint, committedFingerprint)
}

// ExperimentCatalog: insertion, lookup, list, recent, and filter do not expose stored snapshots.
{
  const runner = new ExperimentRunner()
  runner.start(makeProtocol())
  runner.record('trace', { points: [{ value: 7 }] })
  const source = runner.finish('completed')
  const catalog = new ExperimentCatalog()
  const returnedFromAdd = catalog.add(source)
  source.results.trace = { points: [{ value: 80 }] }
  returnedFromAdd.protocol.world.seed = 'tampered-add-result'

  const fromGet = catalog.get('experiment-ownership-1')!
  fromGet.results.trace = { points: [{ value: 81 }] }
  const fromFingerprint = catalog.getByFingerprint(catalog.get('experiment-ownership-1')!.fingerprint)!
  fromFingerprint.protocol.world.seed = 'tampered-fingerprint-result'
  const fromList = catalog.list()
  fromList[0].protocol.world.seed = 'tampered-list-result'
  const fromRecent = catalog.recent()
  fromRecent[0].results.trace = { points: [{ value: 82 }] }
  const fromFilter = catalog.filter(snapshot => {
    snapshot.protocol.world.seed = 'tampered-filter-predicate'
    return true
  })
  fromFilter[0].protocol.world.seed = 'tampered-filter-result'

  const stored = catalog.get('experiment-ownership-1')!
  assert.equal(stored.protocol.world.seed, 'seed-a')
  assert.deepEqual(stored.results.trace, { points: [{ value: 7 }] })
  assert.equal(catalog.size, 1)
}

console.log('World observability ownership regressions: PASS')
console.log('PASS: DecisionGraph ingress, query, relationship and snapshot APIs return detached data')
console.log('PASS: PhysicsInteractionLog insertion and read APIs preserve private history')
console.log('PASS: ExperimentRunner detaches protocols, recorded values and returned snapshots')
console.log('PASS: ExperimentCatalog isolates stored snapshots from all lookup/filter results')
