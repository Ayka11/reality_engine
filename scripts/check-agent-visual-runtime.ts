import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Agent } from '../src/modes/agents/AgentSystem.ts'
import { AgentVisualRuntime } from '../src/modes/agents/AgentVisualRuntime.ts'
import { createPlanarAgentGridWorldTransform } from '../src/simulation/AgentGridWorldTransform.ts'
import { WorldAssetRuntime } from '../src/worldLibrary/WorldAssetRuntime.ts'

type LoadRequest = {
  onLoad: (gltf: { scene: THREE.Group; animations?: THREE.AnimationClip[] }) => void
  onError?: (error: unknown) => void
}

const requests: LoadRequest[] = []
const loader = {
  load: (
    _url: string,
    onLoad: (gltf: { scene: THREE.Group; animations?: THREE.AnimationClip[] }) => void,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (error: unknown) => void,
  ) => {
    requests.push({ onLoad, onError })
    return {} as THREE.Group
  },
} as unknown as Pick<GLTFLoader, 'load'>

const scene = new THREE.Scene()
let persistentChangeNotifications = 0
const assets = new WorldAssetRuntime(scene, loader, () => { persistentChangeNotifications += 1 })
const root = new THREE.Group()
const animatedRoot = new THREE.Group()
animatedRoot.name = 'root'
root.add(animatedRoot)
const idleClip = new THREE.AnimationClip('Idle', 1, [
  new THREE.NumberKeyframeTrack('root.position[y]', [0, 1], [0, 0.2]),
])
const walkClip = new THREE.AnimationClip('Walk Cycle', 1, [
  new THREE.NumberKeyframeTrack('root.position[x]', [0, 1], [0, 1]),
])
const runClip = new THREE.AnimationClip('Run', 1, [
  new THREE.NumberKeyframeTrack('root.position[z]', [0, 1], [0, 2]),
])
const load = assets.load('creature-model', 'https://assets.example.test/creature.glb', {
  semanticEntryId: 'fauna.creature',
})
assert.equal(requests.length, 1)
requests[0].onLoad({ scene: root, animations: [idleClip, walkClip, runClip] })
await load
assert.deepEqual(assets.get('creature-model')?.animations.map(clip => clip.name),
  ['Idle', 'Walk Cycle', 'Run'])

const persistent = assets.placeInstance('persistent-tree:1', 'fauna.creature', {
  x: 1, y: 2, z: 3,
})
assert.ok(persistent)
assert.equal(persistentChangeNotifications, 1,
  'ordinary world placements must continue to trigger persistence notifications')

const transform = createPlanarAgentGridWorldTransform(
  10,
  8,
  { x: 100, y: 20, z: -50 },
  2,
)
const visuals = new AgentVisualRuntime(
  assets,
  transform,
  (position) => ({
    ...position,
    y: 7 + position.x * 0.1 - position.z * 0.05,
  }),
  'creature-model',
)
visuals.setProfile({
  schemaVersion: 'agent-visual-profile-v1',
  semanticEntryId: 'fauna.creature',
  scale: 0.75,
  fadeDuration: 0.15,
  clips: {
    explore: 'Walk Cycle',
    seek_energy: 'Run',
    rest: 'Idle',
    reproduce: 'Missing Reproduction Clip',
  },
  fallbackClip: 'Idle',
})

const agent = (id: number, x: number, y: number, state: Agent['state']): Agent => ({
  id,
  x,
  y,
  energy: 0.7,
  age: 10,
  genome: {
    seekEnergyW: 0.8,
    seekInfoW: 0.6,
    fleeEntropyW: 0.7,
    bioW: 0.4,
    exploreW: 0.3,
    reprodThresh: 0.65,
    maxAge: 700,
  },
  state,
  civId: 1,
  memory: [],
  memHead: 0,
  score: 0,
  plan: '',
  planBias: {},
})

const wrongSourceRuntime = new AgentVisualRuntime(
  assets,
  transform,
  undefined,
  'different-model-with-the-same-semantic',
)
wrongSourceRuntime.setProfile({
  schemaVersion: 'agent-visual-profile-v1',
  semanticEntryId: 'fauna.creature',
  clips: { explore: 'Walk Cycle' },
})
const wrongSource = wrongSourceRuntime.sync([agent(90, 1, 1, 'explore')])
assert.equal(wrongSource.awaitingAsset, 1,
  'a different loaded asset with the same semantic entry must not substitute for the exact selected source')
assert.equal(wrongSource.instances, 0)
wrongSourceRuntime.dispose()

const first = agent(1, 2, 3, 'explore')
const second = agent(2, 4, 1, 'rest')
const initial = visuals.sync([first, second])
assert.deepEqual(
  { agents: initial.agents, instances: initial.instances, created: initial.created, animated: initial.animated },
  { agents: 2, instances: 2, created: 2, animated: 2 },
  'sync must create one transient instance per live agent and start mapped/fallback clips',
)
assert.equal(initial.awaitingAsset, 0)
assert.equal(assets.getInstanceAnimationNames('agent-visual:1').includes('Walk Cycle'), true)

const firstWorld = assets.getInstanceWorldPosition('agent-visual:1')
assert.ok(firstWorld)
assert.deepEqual(firstWorld, {
  x: 104,
  y: 7 + 104 * 0.1 - (-44) * 0.05,
  z: -44,
}, '2D grid X/Y must map to absolute world X/Z before terrain height resolution')
assert.equal(assets.get('creature-model')?.object.visible, false,
  'the loaded source stays a hidden template')

const snapshotBeforeMove = assets.snapshotPlacements()
assert.deepEqual(snapshotBeforeMove.map(placement => placement.instanceId), ['persistent-tree:1'],
  'transient agent instances must never appear in persistent placement snapshots')
assert.equal(persistentChangeNotifications, 1,
  'creating transient agent instances must not autosave the persistent world')

const unchanged = visuals.sync([first, second])
assert.equal(unchanged.created, 0)
assert.equal(unchanged.updated, 2)
assert.equal(unchanged.animated, 0,
  'unchanged state-to-clip mappings must not restart mixers each simulation tick')

const moved = agent(1, 5, 6, 'seek_energy')
const stateChanged = visuals.sync([moved, second])
assert.equal(stateChanged.animated, 1,
  'a state change must transition to the exact matching imported animation name')
assert.equal(assets.getInstanceWorldPosition('agent-visual:1')?.x, 110)
assert.equal(assets.getInstanceWorldPosition('agent-visual:1')?.z, -38)

assets.rebase({ x: 90, y: 5, z: -40 })
const rebasedWorldPosition = assets.getInstanceWorldPosition('agent-visual:1')
assert.deepEqual(rebasedWorldPosition, {
  x: 110,
  y: 7 + 110 * 0.1 - (-38) * 0.05,
  z: -38,
}, 'origin rebasing must preserve the absolute world transform')
const rebasedInstance = scene.children.find(
  child => child.userData.runtimeAssetInstanceId === 'agent-visual:1',
)
assert.ok(rebasedInstance, 'agent visual instance must remain present after origin rebase')
assert.equal(rebasedInstance.position.x, 20)
assert.ok(Math.abs(rebasedInstance.position.y - (rebasedWorldPosition!.y - 5)) < 1e-10)
assert.equal(rebasedInstance.position.z, 2,
  'renderer-local position must be re-derived from preserved absolute world coordinates')

const fallback = visuals.sync([agent(1, 5, 6, 'reproduce'), second])
assert.equal(fallback.animated, 1,
  'a missing per-state clip must use the explicitly configured exact fallback clip')
visuals.setProfile({
  schemaVersion: 'agent-visual-profile-v1',
  semanticEntryId: 'fauna.creature',
  scale: 0.75,
  fadeDuration: 0.15,
  clips: { explore: 'Walk Cycle', seek_energy: 'Run', rest: 'Idle' },
})
const noClip = visuals.sync([agent(1, 5, 6, 'flee_entropy'), second])
assert.equal(noClip.missingClip, 1,
  'a state without an exact clip or fallback must remain unanimated rather than guessing a clip name')

const removed = visuals.sync([second])
assert.equal(removed.removed, 1)
assert.equal(assets.hasInstance('agent-visual:1'), false)
assert.equal(assets.hasInstance('agent-visual:2'), true)
assert.deepEqual(assets.snapshotPlacements().map(placement => placement.instanceId), ['persistent-tree:1'],
  'removing transient instances must not affect persistent scene placements')
assert.equal(persistentChangeNotifications, 1,
  'transient movement, animation and removal must not notify world persistence')

visuals.dispose()
assert.equal(assets.hasInstance('agent-visual:2'), false)
assert.equal(assets.hasInstance('persistent-tree:1'), true)
assert.equal(assets.remove('creature-model'), true)
assert.equal(scene.children.length, 0)
assert.equal(persistentChangeNotifications, 2,
  'removing the remaining persistent source must still update persistent world state')

const emptyRuntime = new AgentVisualRuntime(assets, transform)
emptyRuntime.setProfile({
  schemaVersion: 'agent-visual-profile-v1',
  semanticEntryId: 'fauna.not-loaded',
  clips: { explore: 'Walk Cycle' },
})
const waiting = emptyRuntime.sync([first, second])
assert.equal(waiting.awaitingAsset, 2,
  'agents must remain data-only while their explicitly selected model has not been loaded')
assert.equal(waiting.instances, 0)
emptyRuntime.dispose()

const { AgentSystem } = await import('../src/modes/agents/AgentSystem.ts')
const observedSystem = new AgentSystem()
const observedSnapshots: Agent[][] = []
let observerCalls = 0
const unsubscribe = observedSystem.onAgentsChanged(snapshot => {
  observerCalls += 1
  observedSnapshots.push(snapshot as Agent[])
})
observedSystem.spawn(18, 14, 3)
assert.equal(observerCalls, 1, 'spawning must notify visual observers once after the population is added')
const exposed = observedSnapshots[0][0]
const authoritativeEnergyWeight = observedSystem.agents[0].genome.seekEnergyW
exposed.genome.seekEnergyW = 999
exposed.memory[0] = 999
exposed.planBias.seekInfoW = 999
assert.equal(observedSystem.agents[0].genome.seekEnergyW, authoritativeEnergyWeight,
  'observer snapshots must not expose mutable genome objects')
assert.notEqual(observedSystem.agents[0].memory[0], 999,
  'observer snapshots must not expose the authoritative agent memory array')
assert.equal(observedSystem.agents[0].planBias.seekInfoW, undefined,
  'observer snapshots must detach nested plan-bias records')
observedSystem.step(new Float32Array(36 * 28 * 12), 36, 28, 12, 10)
assert.equal(observerCalls, 2, 'completed simulation steps must notify visual observers')
unsubscribe()
observedSystem.step(new Float32Array(36 * 28 * 12), 36, 28, 12, 10)
assert.equal(observerCalls, 2, 'unsubscribed observers must no longer receive agent ticks')

console.log('Agent visual runtime exact clip mapping, 2D-to-world placement, origin rebasing, transient persistence, lifecycle and safe agent notifications: PASS')
