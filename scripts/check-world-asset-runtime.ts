import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { WorldAssetRuntime } from '../src/worldLibrary/WorldAssetRuntime.ts'
import { detachAndDisposeObjectGroups } from '../src/render/ResourceCleanup.ts'
import {
  materializeExternalAssetPlacements,
  mergeExternalAssetPlacements,
  validateExternalAssetPlacements,
} from '../src/infinity/ExternalAssetPlacement.ts'

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
const runtime = new WorldAssetRuntime(scene, loader)
const createGltfScene = (map = new THREE.Texture()) => {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map }),
  ))
  group.add(new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()))
  group.add(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()))
  return group
}

const staleScene = createGltfScene()
let staleGeometryDisposed = false
let staleMaterialDisposed = false
;(staleScene.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => {
  staleGeometryDisposed = true
  throw new Error('injected stale geometry disposal failure')
})
const staleMaterial = (staleScene.children[0] as THREE.Mesh).material as THREE.Material
staleMaterial.addEventListener('dispose', () => {
  staleMaterialDisposed = true
  throw new Error('injected stale material disposal failure')
})
const staleLoad = runtime.load('oak', 'https://assets.example.test/old-oak.glb', {
  semanticEntryId: 'flora.oak',
})
assert.equal(requests.length, 1)

runtime.clear()
await assert.rejects(staleLoad, /Asset load invalidated by world replacement/)
const currentLoad = runtime.load('oak', 'https://assets.example.test/current-oak.glb', {
  semanticEntryId: 'flora.oak',
})
assert.equal(requests.length, 2, 'clear must release the old pending ID for a new world load')

assert.doesNotThrow(() => requests[0].onLoad({ scene: staleScene }),
  'late GLTF callbacks must not throw into the loader event loop when stale resource disposal fails')
assert.equal(staleGeometryDisposed, true, 'late stale GLTF geometry disposal must be attempted')
assert.equal(staleMaterialDisposed, true, 'late stale GLTF material disposal must continue after geometry failure')
assert.equal(scene.children.length, 0, 'late stale GLTF payloads must never enter the new scene')

const duplicateCurrentLoad = runtime.load('oak', 'https://assets.example.test/duplicate-oak.glb', {
  semanticEntryId: 'flora.oak',
})
assert.equal(requests.length, 2, 'a stale task finalizer must not erase a newer pending task with the same ID')

const currentScene = createGltfScene()
requests[1].onLoad({ scene: currentScene })
const [asset, duplicateAsset] = await Promise.all([currentLoad, duplicateCurrentLoad])
assert.equal(asset, duplicateAsset, 'concurrent requests for the current asset must share one loaded asset')
assert.equal(runtime.getSemanticSource('flora.oak'), asset)
assert.equal(scene.children.length, 1)

const instance = runtime.placeInstance('oak:instance:1', 'flora.oak', { x: 4, y: 0, z: 8 })
assert.ok(instance)
assert.equal(runtime.getInstanceSourceAssetId('oak:instance:1'), 'oak')
assert.equal(runtime.getInstanceRuntimeOwnerId('oak:instance:1'), null)
assert.equal(runtime.setInstanceRuntimeOwnerId('oak:instance:1', 'asset-runtime-test'), true)
assert.equal(runtime.getInstanceRuntimeOwnerId('oak:instance:1'), 'asset-runtime-test')
const sourcePoints = currentScene.children.find(node => (node as THREE.Points).isPoints) as THREE.Points
const instancePoints = instance!.children.find(node => (node as THREE.Points).isPoints) as THREE.Points
const sourceLine = currentScene.children.find(node => (node as THREE.Line).isLine) as THREE.Line
const instanceLine = instance!.children.find(node => (node as THREE.Line).isLine) as THREE.Line
assert.notEqual(instancePoints.geometry, sourcePoints.geometry,
  'placed Points instances must own cloned geometry rather than sharing the source asset')
assert.notEqual(instancePoints.material, sourcePoints.material,
  'placed Points instances must own cloned materials rather than sharing the source asset')
assert.notEqual(instanceLine.geometry, sourceLine.geometry,
  'placed Line instances must own cloned geometry rather than sharing the source asset')
assert.notEqual(instanceLine.material, sourceLine.material,
  'placed Line instances must own cloned materials rather than sharing the source asset')
assert.equal(scene.children.length, 2)
const placementManifest = {
  version: '1.0' as const,
  generatedAt: '2026-11-04T00:00:00.000Z',
  project: 'WorldAssetRuntime regression',
  entries: [{
    id: 'oak-source',
    providerId: 'test-provider',
    sourceUrl: 'https://assets.example.test/oak.glb',
    sourceAssetId: 'oak',
    name: 'Oak',
    license: 'CC0' as const,
    semanticEntryId: 'flora.oak',
  }],
}
assert.deepEqual(runtime.snapshotPlacements(), [{
  instanceId: 'oak:instance:1',
  sourceAssetId: 'oak',
  semanticEntryId: 'flora.oak',
  x: 4, y: 0, z: 8, scale: 1, rotationY: 0,
}], 'runtime snapshot must capture absolute world coordinates and transforms')
const placementValidation = validateExternalAssetPlacements(runtime.snapshotPlacements(), placementManifest, true)
assert.equal(placementValidation.valid, true, 'placement intent must resolve to licensed manifest metadata')
assert.equal(validateExternalAssetPlacements([
  ...runtime.snapshotPlacements(), ...runtime.snapshotPlacements(),
], placementManifest, true).valid, false, 'duplicate placement IDs must be rejected')
assert.equal(validateExternalAssetPlacements(runtime.snapshotPlacements(), {
  ...placementManifest,
  entries: [{ ...placementManifest.entries[0], sourceAssetId: 'unregistered-source' }],
}, true).valid, false, 'placement source IDs must match the asset provenance manifest')
const movedPlacement = { ...runtime.snapshotPlacements()[0], x: 99 }
assert.equal(
  mergeExternalAssetPlacements([runtime.snapshotPlacements()[0]], [movedPlacement])[0].x,
  99,
  'live transform must override a stale pending descriptor with the same instance ID',
)
const pendingPlacements = [
  runtime.snapshotPlacements()[0],
  { ...runtime.snapshotPlacements()[0], instanceId: 'tree:other-source', sourceAssetId: 'other-tree' },
  { ...runtime.snapshotPlacements()[0], instanceId: 'fauna.creature:pending', semanticEntryId: 'fauna.creature' },
  { ...runtime.snapshotPlacements()[0], instanceId: 'oak:deferred', x: 123 },
]
const materializedOptions: Array<{ x: number; y: number; z: number; scale: number; rotationY: number; sourceAssetId: string }> = []
const placementMaterializer = materializeExternalAssetPlacements({
  placeInstance: (_instanceId, _semanticId, options) => {
    materializedOptions.push(options)
    return options.x === 123 ? null : { placed: true }
  },
}, pendingPlacements, 'oak', 'flora.oak')
assert.equal(placementMaterializer.restoredCount, 1,
  'only exact source and semantic matches should be materialized')
assert.deepEqual(placementMaterializer.restoredIds, ['oak:instance:1'])
assert.deepEqual(materializedOptions, [
  { x: 4, y: 0, z: 8, scale: 1, rotationY: 0, sourceAssetId: 'oak' },
  { x: 123, y: 0, z: 8, scale: 1, rotationY: 0, sourceAssetId: 'oak' },
], 'restoration must pass saved absolute coordinates, scale and rotation to every matching placement')
assert.deepEqual(placementMaterializer.remaining.map(placement => placement.instanceId), [
  'tree:other-source',
  'fauna.creature:pending',
  'oak:deferred',
], 'unmatched and failed placements must remain pending for retry')


assert.deepEqual(placementMaterializer.errors, [],
  'a null materialization result is pending but is not an exception')

const materializerFailureScene = new THREE.Scene()
const materializerFailureRuntime = new WorldAssetRuntime(materializerFailureScene, loader)
const materializerFailureTexture = new THREE.Texture()
const materializerFailureMaterial = new THREE.MeshStandardMaterial({ map: materializerFailureTexture })
const materializerFailureGeometry = new THREE.BoxGeometry(1, 1, 1)
const materializerFailureSource = new THREE.Group()
materializerFailureSource.add(new THREE.Mesh(materializerFailureGeometry, materializerFailureMaterial))
const materializerFailureLoad = materializerFailureRuntime.load(
  'materializer-failure-source',
  'https://assets.example.test/materializer-failure.glb',
  { semanticEntryId: 'flora.materializer-failure' },
)
requests[requests.length - 1].onLoad({ scene: materializerFailureSource })
await materializerFailureLoad
const originalMaterializerTextureClone = materializerFailureTexture.clone.bind(materializerFailureTexture)
let materializerTextureCloneAttempts = 0
materializerFailureTexture.clone = function () {
  materializerTextureCloneAttempts += 1
  if (materializerTextureCloneAttempts === 1) {
    throw new Error('injected first descriptor texture clone failure')
  }
  return originalMaterializerTextureClone()
}
const materializerFailureDescriptors: ExternalAssetPlacementSnapshot[] = [
  {
    instanceId: 'materializer:failed-first',
    sourceAssetId: 'materializer-failure-source',
    semanticEntryId: 'flora.materializer-failure',
    x: 1, y: 0, z: 1, scale: 1, rotationY: 0,
  },
  {
    instanceId: 'materializer:successful-second',
    sourceAssetId: 'materializer-failure-source',
    semanticEntryId: 'flora.materializer-failure',
    x: 2, y: 0, z: 2, scale: 1, rotationY: 0,
  },
]
const materializerFailureResult = materializeExternalAssetPlacements(
  materializerFailureRuntime,
  materializerFailureDescriptors,
  'materializer-failure-source',
  'flora.materializer-failure',
)
assert.deepEqual(materializerFailureResult.restoredIds, ['materializer:successful-second'],
  'one failed descriptor must not prevent later descriptors from being restored')
assert.deepEqual(materializerFailureResult.remaining.map(item => item.instanceId), ['materializer:failed-first'],
  'a descriptor whose clone failed before publication must remain pending')
assert.deepEqual(materializerFailureResult.errors, [{
  instanceId: 'materializer:failed-first',
  message: 'injected first descriptor texture clone failure',
}], 'per-descriptor materialization errors must be returned with the retained descriptor')
assert.equal(materializerFailureRuntime.hasInstance('materializer:failed-first'), false)
assert.equal(materializerFailureRuntime.hasInstance('materializer:successful-second'), true)
assert.equal(materializerFailureRuntime.remove('materializer-failure-source'), true)

const materializerNotificationScene = new THREE.Scene()
let materializerNotificationAttempts = 0
const materializerNotificationRuntime = new WorldAssetRuntime(
  materializerNotificationScene,
  loader,
  () => {
    materializerNotificationAttempts += 1
    if (materializerNotificationAttempts === 1) {
      throw new Error('injected post-publication placement notification failure')
    }
  },
)
const materializerNotificationLoad = materializerNotificationRuntime.load(
  'materializer-notification-source',
  'https://assets.example.test/materializer-notification.glb',
  { semanticEntryId: 'flora.materializer-notification' },
)
requests[requests.length - 1].onLoad({ scene: new THREE.Group() })
await materializerNotificationLoad
const materializerNotificationDescriptors: ExternalAssetPlacementSnapshot[] = [
  {
    instanceId: 'materializer:committed-first',
    sourceAssetId: 'materializer-notification-source',
    semanticEntryId: 'flora.materializer-notification',
    x: 3, y: 0, z: 3, scale: 1, rotationY: 0,
  },
  {
    instanceId: 'materializer:committed-second',
    sourceAssetId: 'materializer-notification-source',
    semanticEntryId: 'flora.materializer-notification',
    x: 4, y: 0, z: 4, scale: 1, rotationY: 0,
  },
]
const materializerNotificationResult = materializeExternalAssetPlacements(
  materializerNotificationRuntime,
  materializerNotificationDescriptors,
  'materializer-notification-source',
  'flora.materializer-notification',
)
assert.deepEqual(materializerNotificationResult.restoredIds, [
  'materializer:committed-first',
  'materializer:committed-second',
], 'a callback error after publication must not retain a duplicate pending descriptor')
assert.deepEqual(materializerNotificationResult.remaining, [],
  'materialization must complete later descriptors after a post-publication callback error')
assert.deepEqual(materializerNotificationResult.errors, [{
  instanceId: 'materializer:committed-first',
  message: 'injected post-publication placement notification failure',
}], 'post-publication callback errors must still be reported to the caller')
assert.equal(materializerNotificationRuntime.stats().instances, 2)
assert.equal(materializerNotificationAttempts, 2)
assert.equal(materializerNotificationRuntime.remove('materializer-notification-source'), true)

const alternateOakLoad = runtime.load('oak-alt', 'https://assets.example.test/alternate-oak.glb', {
  semanticEntryId: 'flora.oak',
})
requests[2].onLoad({ scene: createGltfScene() })
const alternateOakAsset = await alternateOakLoad
assert.equal(runtime.getSemanticSource('flora.oak'), alternateOakAsset)
const alternateOakInstance = runtime.placeInstance('oak-alt:instance:1', 'flora.oak', { x: 6, y: 0, z: 9 })
assert.ok(alternateOakInstance)
assert.equal(runtime.remove('oak-alt'), true)
assert.equal(scene.children.includes(alternateOakInstance), false, 'removing a source asset must also remove its placements')
assert.equal(runtime.getSemanticSource('flora.oak'), asset, 'removing the latest semantic source must restore another loaded source')
const fallbackOakInstance = runtime.placeInstance('oak:fallback:1', 'flora.oak', { x: 7, y: 0, z: 10 })
assert.ok(fallbackOakInstance)
assert.equal(runtime.remove('oak'), true)
assert.equal(scene.children.length, 0, 'removing the original source must remove all instances derived from it')
assert.equal(runtime.getSemanticSource('flora.oak'), undefined)

const sourceTexture = new THREE.Texture()
const texturedSourceScene = createGltfScene(sourceTexture)
const texturedAssetLoad = runtime.load('pine', 'https://assets.example.test/pine.glb', {
  semanticEntryId: 'flora.pine',
})
requests[3].onLoad({ scene: texturedSourceScene })
const texturedAsset = await texturedAssetLoad
const sourceMesh = texturedAsset.object.children[0] as THREE.Mesh
const sourceMaterial = sourceMesh.material as THREE.MeshStandardMaterial
let sourceTextureDisposed = false
sourceTexture.addEventListener('dispose', () => { sourceTextureDisposed = true })
const texturedInstance = runtime.placeInstance('pine:instance:1', 'flora.pine', { x: 2, y: 0, z: 3 })
assert.ok(texturedInstance)
const instanceMesh = texturedInstance.children[0] as THREE.Mesh
const instanceMaterial = instanceMesh.material as THREE.MeshStandardMaterial
assert.ok(instanceMaterial.map)
assert.notEqual(instanceMaterial.map, sourceMaterial.map, 'placed instances must own cloned texture resources')
let instanceTextureDisposed = false
instanceMaterial.map!.addEventListener('dispose', () => { instanceTextureDisposed = true })
const secondTexturedInstance = runtime.placeInstance('pine:instance:2', 'flora.pine', { x: 5, y: 0, z: 6 })
assert.ok(secondTexturedInstance)
const secondInstanceMaterial = ((secondTexturedInstance.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial)
let secondInstanceTextureDisposed = false
secondInstanceMaterial.map!.addEventListener('dispose', () => { secondInstanceTextureDisposed = true })
assert.equal(runtime.removeInstance('pine:instance:1'), true)
assert.equal(instanceTextureDisposed, true, 'removing one instance must dispose its private texture')
assert.equal(sourceTextureDisposed, false, 'removing an instance must not dispose the source texture')
assert.equal(runtime.remove('pine'), true)
assert.equal(sourceTextureDisposed, true, 'removing a source asset must dispose its owned texture')
assert.equal(secondInstanceTextureDisposed, true, 'removing a source asset must dispose remaining instance-owned textures')
assert.equal(scene.children.length, 0, 'removing an asset must remove all its remaining placements')

runtime.clear()
assert.equal(runtime.stats().loaded, 0)
assert.equal(scene.children.length, 0, 'clear must remove loaded source assets and placed instances')
assert.equal(runtime.getSemanticSource('flora.oak'), undefined)

const createCreatureScene = () => {
  const group = new THREE.Group()
  const rootBone = new THREE.Bone()
  rootBone.name = 'root'
  const childBone = new THREE.Bone()
  childBone.name = 'child'
  childBone.position.y = 1
  rootBone.add(childBone)
  group.add(rootBone)
  const skinnedMesh = new THREE.SkinnedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  )
  group.add(skinnedMesh)
  group.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton([rootBone, childBone])
  skinnedMesh.bind(skeleton)
  return group
}
const boneRoot = createCreatureScene()
const walkClip = new THREE.AnimationClip('Walk', 1, [
  new THREE.NumberKeyframeTrack('root.position[y]', [0, 1], [0, 2]),
])
const idleClip = new THREE.AnimationClip('Idle', 1, [
  new THREE.NumberKeyframeTrack('root.position[x]', [0, 1], [0, 1]),
])
const animatedLoad = runtime.load('creature', 'https://assets.example.test/creature.glb', {
  semanticEntryId: 'fauna.creature',
})
requests[4].onLoad({ scene: boneRoot, animations: [walkClip, idleClip] })
const animatedAsset = await animatedLoad
assert.equal(animatedAsset.animations.length, 2, 'loaded GLTF animation clips must be preserved')
const findSkinnedMesh = (object: THREE.Object3D) => {
  let found: THREE.SkinnedMesh | undefined
  object.traverse(node => {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) found = node as THREE.SkinnedMesh
  })
  assert.ok(found, 'fixture must contain a skinned mesh')
  return found
}
const animatedSourceMesh = findSkinnedMesh(animatedAsset.object)
const sourceSkeletonAtRest = animatedSourceMesh.skeleton
const firstCreature = runtime.placeInstance('creature:instance:1', 'fauna.creature', { x: 1, y: 0, z: 1 })
const secondCreature = runtime.placeInstance('creature:instance:2', 'fauna.creature', { x: 2, y: 0, z: 2 })
assert.ok(firstCreature && secondCreature)
const firstSkinnedMesh = findSkinnedMesh(firstCreature)
const secondSkinnedMesh = findSkinnedMesh(secondCreature)
assert.notEqual(firstSkinnedMesh.skeleton, sourceSkeletonAtRest, 'first instance must own an independent skeleton')
assert.notEqual(secondSkinnedMesh.skeleton, sourceSkeletonAtRest, 'second instance must own an independent skeleton')
assert.notEqual(firstSkinnedMesh.skeleton, secondSkinnedMesh.skeleton, 'instances must not share skeleton state')
assert.notEqual(firstSkinnedMesh.skeleton.bones[0], sourceSkeletonAtRest.bones[0], 'instance bones must be cloned')
assert.deepEqual(runtime.getInstanceAnimationNames('creature:instance:1'), ['Walk', 'Idle'])
assert.equal(runtime.setInstanceAnimationState('creature:instance:1', 'Idle'), true)
assert.equal(runtime.updateAnimations(0.5), 1)
assert.ok(firstSkinnedMesh.skeleton.bones[0].position.x > 0.25, 'Idle state must animate the selected instance')
assert.equal(runtime.setInstanceAnimationState('creature:instance:1', 'Walk', { fadeDuration: 0.1 }), true)
assert.equal(runtime.updateAnimations(0.5), 1)
assert.ok(firstSkinnedMesh.skeleton.bones[0].position.y > 0.5, 'playing an instance clip must animate its cloned bone')
assert.equal(sourceSkeletonAtRest.bones[0].position.y, 0, 'instance animation must not mutate the source skeleton')
assert.equal(secondSkinnedMesh.skeleton.bones[0].position.y, 0, 'instance animation must not mutate sibling skeletons')
assert.deepEqual(
  runtime.setSemanticAnimationState('fauna.creature', 'Walk', { fadeDuration: 0.05 }),
  { matched: 2, started: 2 },
  'semantic animation state must control every placed instance in the group',
)
assert.equal(runtime.updateAnimations(0.1), 2)
assert.equal(runtime.stopSemanticAnimation('fauna.creature'), 2, 'semantic stop must release every group mixer')
assert.equal(runtime.updateAnimations(0.1), 0)
assert.equal(runtime.removeInstance('creature:instance:1'), true)
assert.equal(runtime.updateAnimations(0.5), 0, 'removing an animated instance must uncache its mixer')
assert.equal(runtime.remove('creature'), true)
assert.equal(runtime.stats().loaded, 0)
assert.equal(scene.children.length, 0)

const lodNear = runtime.load('lod-near', 'https://assets.example.test/lod-near.glb', { semanticEntryId: 'fauna.lod-near' })
requests[5].onLoad({ scene: createCreatureScene(), animations: [walkClip] })
const nearAsset = await lodNear
const nearInstance = runtime.placeInstance('lod-near:instance', 'fauna.lod-near', { x: 10, y: 0, z: 0 })
assert.ok(nearInstance)
const lodFar = runtime.load('lod-far', 'https://assets.example.test/lod-far.glb', { semanticEntryId: 'fauna.lod-far' })
requests[6].onLoad({ scene: createCreatureScene(), animations: [walkClip] })
await lodFar
const farInstance = runtime.placeInstance('lod-far:instance', 'fauna.lod-far', { x: 400, y: 0, z: 0 })
assert.ok(farInstance)
assert.equal(runtime.playInstanceAnimation('lod-near:instance', 'Walk'), true)
assert.equal(runtime.playInstanceAnimation('lod-far:instance', 'Walk'), true)
const lodCamera = new THREE.PerspectiveCamera()
lodCamera.position.set(0, 0, 0)
const farMesh = findSkinnedMesh(farInstance)
assert.deepEqual(runtime.updateVisibility(lodCamera), { total: 2, visible: 2 })
assert.equal(nearAsset.object.visible, false, 'loaded source assets remain hidden templates')
assert.equal(runtime.get('lod-far')?.object.visible, false, 'far source assets remain hidden templates')
assert.equal(runtime.updateAnimations(1 / 60, lodCamera), 1, 'near instances update every frame while mid/far instances are throttled')
assert.equal(farMesh.skeleton.bones[0].position.y, 0, 'far instance must wait for its lower-frequency animation tick')
runtime.updateVisibility(lodCamera)
assert.equal(runtime.updateAnimations(1 / 60, lodCamera), 1)
runtime.updateVisibility(lodCamera)
assert.equal(runtime.updateAnimations(1 / 60, lodCamera), 1)
runtime.updateVisibility(lodCamera)
assert.equal(runtime.updateAnimations(1 / 60, lodCamera), 2, 'far instance updates after accumulating one 15 Hz interval')
assert.ok(farMesh.skeleton.bones[0].position.y > 0, 'far instance animation advances on its throttled tick')
const lodCulled = runtime.load('lod-culled', 'https://assets.example.test/lod-culled.glb', { semanticEntryId: 'fauna.lod-culled' })
requests[7].onLoad({ scene: createCreatureScene(), animations: [walkClip] })
await lodCulled
const culledInstance = runtime.placeInstance('lod-culled:instance', 'fauna.lod-culled', { x: 800, y: 0, z: 0 })
assert.ok(culledInstance)
assert.equal(runtime.playInstanceAnimation('lod-culled:instance', 'Walk'), true)
const culledMesh = findSkinnedMesh(culledInstance)
runtime.updateVisibility(lodCamera)
assert.equal(runtime.updateAnimations(1 / 60, lodCamera), 1, 'objects beyond the visibility range must not consume animation updates')
assert.equal(culledMesh.skeleton.bones[0].position.y, 0, 'out-of-range animation must remain paused')
lodCamera.position.set(800, 0, 0)
runtime.updateVisibility(lodCamera)
assert.equal(runtime.updateAnimations(1 / 60, lodCamera), 1, 'an instance must resume animation when it returns to the active camera range')
assert.ok(culledMesh.skeleton.bones[0].position.y > 0, 'resumed instance animation must advance')
assert.equal(runtime.remove('lod-near'), true)
assert.equal(runtime.remove('lod-far'), true)
assert.equal(runtime.remove('lod-culled'), true)
assert.deepEqual(runtime.stats(), {
  loaded: 0,
  ids: [],
  instances: 0,
  animatedInstances: 0,
  visibleInstances: 0,
})
assert.equal(scene.children.length, 0)


const cleanupScene = new THREE.Scene()
const cleanupRuntime = new WorldAssetRuntime(cleanupScene, loader)
const cleanupInternal = cleanupRuntime as unknown as {
  assets: Map<string, { id: string; semanticEntryId?: string; sourceUrl: string; object: THREE.Object3D; animations: THREE.AnimationClip[]; loadedAt: number }>
  instances: Map<string, THREE.Object3D>
  semanticSources: Map<string, unknown>
  instanceMixers: Map<string, THREE.AnimationMixer>
  instanceActions: Map<string, THREE.AnimationAction>
  pendingAnimationStops: Map<string, unknown>
  animationAccumulators: Map<string, number>
  loading: Map<string, Promise<unknown>>
  pendingRejectors: Map<string, (reason: Error) => void>
}
const cleanupFlags = {
  failingInstanceGeometry: false,
  goodInstanceGeometry: false,
  failingInstanceMaterial: false,
  goodInstanceMaterial: false,
  sourceGeometry: false,
  sourceMaterial: false,
  sourcePointsGeometry: false,
  sourcePointsMaterial: false,
  sourceLineGeometry: false,
  sourceLineMaterial: false,
  mixerUncached: false,
  pendingCancelContinued: false,
}
const trackedMesh = (material: THREE.Material, onGeometryDispose: () => void) => {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.addEventListener('dispose', onGeometryDispose)
  return new THREE.Mesh(geometry, material)
}
const failingInstanceMaterial = new THREE.MeshBasicMaterial()
failingInstanceMaterial.addEventListener('dispose', () => {
  cleanupFlags.failingInstanceMaterial = true
  throw new Error('injected instance material dispose failure')
})
const failingInstance = new THREE.Group()
failingInstance.add(trackedMesh(failingInstanceMaterial, () => {
  cleanupFlags.failingInstanceGeometry = true
  throw new Error('injected instance geometry dispose failure')
}))
const goodInstanceMaterial = new THREE.MeshBasicMaterial()
goodInstanceMaterial.addEventListener('dispose', () => { cleanupFlags.goodInstanceMaterial = true })
const goodInstance = new THREE.Group()
goodInstance.add(trackedMesh(goodInstanceMaterial, () => { cleanupFlags.goodInstanceGeometry = true }))

const cleanupSourceMaterial = new THREE.MeshBasicMaterial()
cleanupSourceMaterial.addEventListener('dispose', () => { cleanupFlags.sourceMaterial = true })
const sourceObject = new THREE.Group()
sourceObject.add(trackedMesh(cleanupSourceMaterial, () => { cleanupFlags.sourceGeometry = true }))
const sourcePointsGeometry = new THREE.BufferGeometry()
sourcePointsGeometry.addEventListener('dispose', () => { cleanupFlags.sourcePointsGeometry = true })
const sourcePointsMaterial = new THREE.PointsMaterial()
sourcePointsMaterial.addEventListener('dispose', () => { cleanupFlags.sourcePointsMaterial = true })
sourceObject.add(new THREE.Points(sourcePointsGeometry, sourcePointsMaterial))
const sourceLineGeometry = new THREE.BufferGeometry()
sourceLineGeometry.addEventListener('dispose', () => { cleanupFlags.sourceLineGeometry = true })
const sourceLineMaterial = new THREE.LineBasicMaterial()
sourceLineMaterial.addEventListener('dispose', () => { cleanupFlags.sourceLineMaterial = true })
sourceObject.add(new THREE.Line(sourceLineGeometry, sourceLineMaterial))

cleanupScene.add(failingInstance, goodInstance, sourceObject)
cleanupInternal.instances.set('failing-instance', failingInstance)
cleanupInternal.instances.set('good-instance', goodInstance)
cleanupInternal.assets.set('source-asset', {
  id: 'source-asset',
  semanticEntryId: 'flora.cleanup',
  sourceUrl: 'https://assets.example.test/cleanup-source.glb',
  object: sourceObject,
  animations: [],
  loadedAt: Date.now(),
})
cleanupInternal.semanticSources.set('flora.cleanup', { id: 'source-asset' })
const cleanupMixer = new THREE.AnimationMixer(failingInstance)
cleanupMixer.stopAllAction = () => { throw new Error('injected animation stop failure') }
cleanupMixer.uncacheRoot = () => { cleanupFlags.mixerUncached = true }
cleanupInternal.instanceMixers.set('failing-instance', cleanupMixer)
cleanupInternal.instanceActions.set('failing-instance', {} as THREE.AnimationAction)
cleanupInternal.pendingAnimationStops.set('failing-instance', [])
cleanupInternal.animationAccumulators.set('failing-instance', 1)
cleanupInternal.loading.set('pending-load', Promise.resolve({}))
cleanupInternal.pendingRejectors.set('failing-cancel', () => {
  throw new Error('injected pending cancellation failure')
})
cleanupInternal.pendingRejectors.set('good-cancel', () => {
  cleanupFlags.pendingCancelContinued = true
})

assert.throws(() => cleanupRuntime.clear(), AggregateError,
  'clear must report resource failures after attempting every remaining cleanup action')
assert.equal(cleanupScene.children.length, 0,
  'a failing disposer must not leave old asset or instance roots attached to the scene')
assert.equal(cleanupInternal.instances.size, 0)
assert.equal(cleanupInternal.assets.size, 0)
assert.equal(cleanupInternal.semanticSources.size, 0)
assert.equal(cleanupInternal.instanceMixers.size, 0)
assert.equal(cleanupInternal.instanceActions.size, 0)
assert.equal(cleanupInternal.pendingAnimationStops.size, 0)
assert.equal(cleanupInternal.animationAccumulators.size, 0)
assert.equal(cleanupInternal.loading.size, 0)
assert.equal(cleanupInternal.pendingRejectors.size, 0)
assert.deepEqual(cleanupFlags, {
  failingInstanceGeometry: true,
  goodInstanceGeometry: true,
  failingInstanceMaterial: true,
  goodInstanceMaterial: true,
  sourceGeometry: true,
  sourceMaterial: true,
  sourcePointsGeometry: true,
  sourcePointsMaterial: true,
  sourceLineGeometry: true,
  sourceLineMaterial: true,
  mixerUncached: true,
  pendingCancelContinued: true,
}, 'cleanup must continue through failures in cancellation, animation, geometry and material disposal')

// Direct instance removal must release scene/maps even when animation, GPU
// disposal and placement-notification callbacks fail independently.
const directRemoveScene = new THREE.Scene()
let directRemoveNotifications = 0
const directRemoveRuntime = new WorldAssetRuntime(directRemoveScene, loader, () => {
  directRemoveNotifications += 1
  throw new Error('injected direct placement notification failure')
})
const directRemoveInternal = directRemoveRuntime as unknown as {
  instances: Map<string, THREE.Object3D>
  instanceMixers: Map<string, THREE.AnimationMixer>
  instanceActions: Map<string, THREE.AnimationAction>
  pendingAnimationStops: Map<string, unknown>
  animationAccumulators: Map<string, number>
}
const directRemoveFlags = { geometry: false, material: false, mixerStop: false, mixerUncache: false }
const directRemoveMaterial = new THREE.MeshBasicMaterial()
directRemoveMaterial.addEventListener('dispose', () => {
  directRemoveFlags.material = true
  throw new Error('injected direct instance material disposal failure')
})
const directRemoveGeometry = new THREE.BoxGeometry(1, 1, 1)
directRemoveGeometry.addEventListener('dispose', () => {
  directRemoveFlags.geometry = true
  throw new Error('injected direct instance geometry disposal failure')
})
const directRemoveInstance = new THREE.Group()
directRemoveInstance.add(new THREE.Mesh(directRemoveGeometry, directRemoveMaterial))
directRemoveInstance.userData.persistentWorldAssetPlacement = true
directRemoveScene.add(directRemoveInstance)
directRemoveInternal.instances.set('direct-remove', directRemoveInstance)
const directRemoveMixer = new THREE.AnimationMixer(directRemoveInstance)
directRemoveMixer.stopAllAction = () => {
  directRemoveFlags.mixerStop = true
  throw new Error('injected direct instance animation-stop failure')
}
directRemoveMixer.uncacheRoot = () => { directRemoveFlags.mixerUncache = true }
directRemoveInternal.instanceMixers.set('direct-remove', directRemoveMixer)
directRemoveInternal.instanceActions.set('direct-remove', {} as THREE.AnimationAction)
directRemoveInternal.pendingAnimationStops.set('direct-remove', [])
directRemoveInternal.animationAccumulators.set('direct-remove', 1)
assert.throws(() => directRemoveRuntime.removeInstance('direct-remove'), AggregateError,
  'direct instance removal must report failures only after removing the instance')
assert.equal(directRemoveScene.children.length, 0)
assert.equal(directRemoveInternal.instances.size, 0)
assert.equal(directRemoveInternal.instanceMixers.size, 0)
assert.equal(directRemoveInternal.instanceActions.size, 0)
assert.equal(directRemoveInternal.pendingAnimationStops.size, 0)
assert.equal(directRemoveInternal.animationAccumulators.size, 0)
assert.deepEqual(directRemoveFlags, {
  geometry: true, material: true, mixerStop: true, mixerUncache: true,
})
assert.equal(directRemoveNotifications, 1,
  'a failing placement callback must be reported without skipping instance bookkeeping')

// Removing a source asset must continue through every dependent placement and
// dispose the source object even when one child instance fails cleanup.
const sourceRemoveScene = new THREE.Scene()
let sourceRemoveNotifications = 0
const sourceRemoveRuntime = new WorldAssetRuntime(sourceRemoveScene, loader, () => {
  sourceRemoveNotifications += 1
  if (sourceRemoveNotifications === 1) throw new Error('injected first placement notification failure')
})
const sourceRemoveInternal = sourceRemoveRuntime as unknown as {
  assets: Map<string, { id: string; semanticEntryId?: string; sourceUrl: string; object: THREE.Object3D; animations: THREE.AnimationClip[]; loadedAt: number }>
  instances: Map<string, THREE.Object3D>
  semanticSources: Map<string, unknown>
  instanceMixers: Map<string, THREE.AnimationMixer>
  instanceActions: Map<string, THREE.AnimationAction>
  pendingAnimationStops: Map<string, unknown>
  animationAccumulators: Map<string, number>
}
const sourceRemoveFlags = {
  failingGeometry: false,
  failingMaterial: false,
  healthyGeometry: false,
  healthyMaterial: false,
  sourceGeometry: false,
  sourceMaterial: false,
  mixerStop: false,
  mixerUncache: false,
}
const trackedRemoveMesh = (material: THREE.Material, onDispose: () => void) => {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.addEventListener('dispose', onDispose)
  return new THREE.Mesh(geometry, material)
}
const failingRemoveMaterial = new THREE.MeshBasicMaterial()
failingRemoveMaterial.addEventListener('dispose', () => {
  sourceRemoveFlags.failingMaterial = true
  throw new Error('injected dependent instance material disposal failure')
})
const failingRemoveInstance = new THREE.Group()
failingRemoveInstance.add(trackedRemoveMesh(failingRemoveMaterial, () => {
  sourceRemoveFlags.failingGeometry = true
  throw new Error('injected dependent instance geometry disposal failure')
}))
failingRemoveInstance.userData.runtimeAssetSourceId = 'remove-source'
failingRemoveInstance.userData.persistentWorldAssetPlacement = true
const healthyRemoveMaterial = new THREE.MeshBasicMaterial()
healthyRemoveMaterial.addEventListener('dispose', () => { sourceRemoveFlags.healthyMaterial = true })
const healthyRemoveInstance = new THREE.Group()
healthyRemoveInstance.add(trackedRemoveMesh(healthyRemoveMaterial, () => { sourceRemoveFlags.healthyGeometry = true }))
healthyRemoveInstance.userData.runtimeAssetSourceId = 'remove-source'
healthyRemoveInstance.userData.persistentWorldAssetPlacement = true
const sourceRemoveMaterial = new THREE.MeshBasicMaterial()
sourceRemoveMaterial.addEventListener('dispose', () => { sourceRemoveFlags.sourceMaterial = true })
const sourceRemoveObject = new THREE.Group()
sourceRemoveObject.add(trackedRemoveMesh(sourceRemoveMaterial, () => { sourceRemoveFlags.sourceGeometry = true }))
sourceRemoveScene.add(failingRemoveInstance, healthyRemoveInstance, sourceRemoveObject)
const sourceRemoveAsset = {
  id: 'remove-source',
  semanticEntryId: 'flora.remove',
  sourceUrl: 'https://assets.example.test/remove-source.glb',
  object: sourceRemoveObject,
  animations: [],
  loadedAt: Date.now(),
}
sourceRemoveInternal.assets.set('remove-source', sourceRemoveAsset)
sourceRemoveInternal.semanticSources.set('flora.remove', sourceRemoveAsset)
sourceRemoveInternal.instances.set('failing-dependent', failingRemoveInstance)
sourceRemoveInternal.instances.set('healthy-dependent', healthyRemoveInstance)
const sourceRemoveMixer = new THREE.AnimationMixer(failingRemoveInstance)
sourceRemoveMixer.stopAllAction = () => {
  sourceRemoveFlags.mixerStop = true
  throw new Error('injected dependent mixer-stop failure')
}
sourceRemoveMixer.uncacheRoot = () => { sourceRemoveFlags.mixerUncache = true }
sourceRemoveInternal.instanceMixers.set('failing-dependent', sourceRemoveMixer)
sourceRemoveInternal.instanceActions.set('failing-dependent', {} as THREE.AnimationAction)
sourceRemoveInternal.pendingAnimationStops.set('failing-dependent', [])
sourceRemoveInternal.animationAccumulators.set('failing-dependent', 1)
assert.throws(() => sourceRemoveRuntime.remove('remove-source'), AggregateError,
  'source removal must aggregate dependent cleanup failures after completing the whole source removal')
assert.equal(sourceRemoveScene.children.length, 0,
  'a failed dependent cleanup must not leave any source or placement roots attached')
assert.equal(sourceRemoveInternal.instances.size, 0)
assert.equal(sourceRemoveInternal.assets.size, 0)
assert.equal(sourceRemoveInternal.semanticSources.size, 0)
assert.equal(sourceRemoveInternal.instanceMixers.size, 0)
assert.equal(sourceRemoveInternal.instanceActions.size, 0)
assert.equal(sourceRemoveInternal.pendingAnimationStops.size, 0)
assert.equal(sourceRemoveInternal.animationAccumulators.size, 0)
assert.equal(sourceRemoveNotifications, 2,
  'source removal must continue to notify for every persistent dependent after a callback failure')
assert.deepEqual(sourceRemoveFlags, {
  failingGeometry: true,
  failingMaterial: true,
  healthyGeometry: true,
  healthyMaterial: true,
  sourceGeometry: true,
  sourceMaterial: true,
  mixerStop: true,
  mixerUncache: true,
}, 'source removal must dispose failing and healthy dependent resources plus its own source resources')


const restoreCleanupScene = new THREE.Scene()
const restoreCleanupFlags = {
  failingGeometry: false,
  healthyGeometry: false,
  failingMaterial: false,
  healthyMaterial: false,
  sharedMaterial: false,
  sharedTexture: false,
  laterGroupGeometry: false,
  pointsGeometry: false,
  pointsMaterial: false,
}
const restoreSharedTexture = new THREE.Texture()
restoreSharedTexture.addEventListener('dispose', () => { restoreCleanupFlags.sharedTexture = true })
const restoreSharedMaterial = new THREE.MeshStandardMaterial({ map: restoreSharedTexture })
restoreSharedMaterial.addEventListener('dispose', () => { restoreCleanupFlags.sharedMaterial = true })
const restoreFailingMaterial = new THREE.MeshBasicMaterial()
restoreFailingMaterial.addEventListener('dispose', () => {
  restoreCleanupFlags.failingMaterial = true
  throw new Error('injected portable restore material disposal failure')
})
const restoreFailingGeometry = new THREE.BoxGeometry(1, 1, 1)
restoreFailingGeometry.addEventListener('dispose', () => {
  restoreCleanupFlags.failingGeometry = true
  throw new Error('injected portable restore geometry disposal failure')
})
const restoreFailingRoot = new THREE.Group()
restoreFailingRoot.add(new THREE.Mesh(restoreFailingGeometry, restoreFailingMaterial))
restoreFailingRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), restoreSharedMaterial))
const restoreHealthyMaterial = new THREE.MeshBasicMaterial()
restoreHealthyMaterial.addEventListener('dispose', () => { restoreCleanupFlags.healthyMaterial = true })
const restoreHealthyGeometry = new THREE.BoxGeometry(1, 1, 1)
restoreHealthyGeometry.addEventListener('dispose', () => { restoreCleanupFlags.healthyGeometry = true })
const restoreHealthyRoot = new THREE.Group()
restoreHealthyRoot.add(new THREE.Mesh(restoreHealthyGeometry, restoreHealthyMaterial))
restoreHealthyRoot.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), restoreSharedMaterial))
const restoreLaterGeometry = new THREE.BoxGeometry(1, 1, 1)
restoreLaterGeometry.addEventListener('dispose', () => { restoreCleanupFlags.laterGroupGeometry = true })
const restoreLaterRoot = new THREE.Group()
restoreLaterRoot.add(new THREE.Mesh(restoreLaterGeometry, new THREE.MeshBasicMaterial()))
const restorePointsGeometry = new THREE.BufferGeometry()
restorePointsGeometry.addEventListener('dispose', () => { restoreCleanupFlags.pointsGeometry = true })
const restorePointsMaterial = new THREE.PointsMaterial()
restorePointsMaterial.addEventListener('dispose', () => { restoreCleanupFlags.pointsMaterial = true })
const restorePointsRoot = new THREE.Group()
restorePointsRoot.add(new THREE.Points(restorePointsGeometry, restorePointsMaterial))
restoreCleanupScene.add(restoreFailingRoot, restoreHealthyRoot, restoreLaterRoot, restorePointsRoot)

let sharedMaterialDisposals = 0
let sharedTextureDisposals = 0
restoreSharedMaterial.addEventListener('dispose', () => { sharedMaterialDisposals += 1 })
restoreSharedTexture.addEventListener('dispose', () => { sharedTextureDisposals += 1 })

const restoreCleanupFailures = detachAndDisposeObjectGroups(
  restoreCleanupScene,
  [restoreFailingRoot, restoreHealthyRoot, restoreLaterRoot, restorePointsRoot],
  'Portable restore fixture',
)
assert.equal(restoreCleanupScene.children.length, 0,
  'portable restore cleanup must detach every old scene root despite disposal errors')
assert.equal(restoreCleanupFailures.length, 2,
  'portable restore cleanup must report both independent geometry and material failures')
assert.deepEqual(restoreCleanupFlags, {
  failingGeometry: true,
  healthyGeometry: true,
  failingMaterial: true,
  healthyMaterial: true,
  sharedMaterial: true,
  sharedTexture: true,
  laterGroupGeometry: true,
  pointsGeometry: true,
  pointsMaterial: true,
}, 'portable restore cleanup must continue through every root and release shared resources, including Points')
assert.equal(sharedMaterialDisposals, 1,
  'shared materials must be disposed exactly once across the whole replacement scene')
assert.equal(sharedTextureDisposals, 1,
  'shared textures must be disposed exactly once across the whole replacement scene')

const restoreTraversalFailureRoot = new THREE.Group()
const restoreTraversalHealthyRoot = new THREE.Group()
const traversalHealthyGeometry = new THREE.BoxGeometry(1, 1, 1)
let traversalHealthyDisposed = false
traversalHealthyGeometry.addEventListener('dispose', () => { traversalHealthyDisposed = true })
restoreTraversalHealthyRoot.add(new THREE.Mesh(traversalHealthyGeometry, new THREE.MeshBasicMaterial()))
restoreCleanupScene.add(restoreTraversalFailureRoot, restoreTraversalHealthyRoot)
restoreTraversalFailureRoot.traverse = () => { throw new Error('injected traversal failure') }
const traversalFailures = detachAndDisposeObjectGroups(
  restoreCleanupScene,
  [restoreTraversalFailureRoot, restoreTraversalHealthyRoot],
  'Portable restore traversal fixture',
)
assert.equal(restoreCleanupScene.children.length, 0,
  'a traversal failure must not leave later roots attached to the old scene')
assert.equal(traversalHealthyDisposed, true,
  'a traversal failure for one root must not skip resource disposal for later roots')
assert.equal(traversalFailures.length, 1)


const partialCloneScene = new THREE.Scene()
let partialCloneNotifications = 0
const partialCloneRuntime = new WorldAssetRuntime(partialCloneScene, loader, () => {
  partialCloneNotifications += 1
})
const partialCloneFlags = {
  firstGeometry: false,
  secondGeometry: false,
  firstMaterial: false,
  secondMaterial: false,
  firstTexture: false,
  sourceFirstGeometry: false,
  sourceSecondGeometry: false,
  sourceFirstMaterial: false,
  sourceSecondMaterial: false,
  sourceFirstTexture: false,
  sourceFailingTexture: false,
}
const partialFirstTexture = new THREE.Texture()
const partialFailingTexture = new THREE.Texture()
partialFirstTexture.addEventListener('dispose', () => { partialCloneFlags.sourceFirstTexture = true })
partialFailingTexture.addEventListener('dispose', () => { partialCloneFlags.sourceFailingTexture = true })
const partialFirstMaterial = new THREE.MeshStandardMaterial({ map: partialFirstTexture })
const partialSecondMaterial = new THREE.MeshStandardMaterial({ map: partialFailingTexture })
partialFirstMaterial.addEventListener('dispose', () => { partialCloneFlags.sourceFirstMaterial = true })
partialSecondMaterial.addEventListener('dispose', () => { partialCloneFlags.sourceSecondMaterial = true })
const partialFirstGeometry = new THREE.BoxGeometry(1, 1, 1)
const partialSecondGeometry = new THREE.BoxGeometry(2, 2, 2)
partialFirstGeometry.addEventListener('dispose', () => { partialCloneFlags.sourceFirstGeometry = true })
partialSecondGeometry.addEventListener('dispose', () => { partialCloneFlags.sourceSecondGeometry = true })
const partialCloneSource = new THREE.Group()
partialCloneSource.add(
  new THREE.Mesh(partialFirstGeometry, partialFirstMaterial),
  new THREE.Mesh(partialSecondGeometry, partialSecondMaterial),
)
const partialCloneLoad = partialCloneRuntime.load(
  'partial-clone-source',
  'https://assets.example.test/partial-clone.glb',
  { semanticEntryId: 'flora.partial-clone' },
)
requests[requests.length - 1].onLoad({ scene: partialCloneSource })
await partialCloneLoad

const originalFirstGeometryClone = partialFirstGeometry.clone.bind(partialFirstGeometry)
partialFirstGeometry.clone = function () {
  const cloned = originalFirstGeometryClone()
  cloned.addEventListener('dispose', () => { partialCloneFlags.firstGeometry = true })
  return cloned
}
const originalSecondGeometryClone = partialSecondGeometry.clone.bind(partialSecondGeometry)
partialSecondGeometry.clone = function () {
  const cloned = originalSecondGeometryClone()
  cloned.addEventListener('dispose', () => { partialCloneFlags.secondGeometry = true })
  return cloned
}
const originalFirstMaterialClone = partialFirstMaterial.clone.bind(partialFirstMaterial)
partialFirstMaterial.clone = function () {
  const cloned = originalFirstMaterialClone()
  cloned.addEventListener('dispose', () => { partialCloneFlags.firstMaterial = true })
  return cloned
}
const originalSecondMaterialClone = partialSecondMaterial.clone.bind(partialSecondMaterial)
partialSecondMaterial.clone = function () {
  const cloned = originalSecondMaterialClone()
  cloned.addEventListener('dispose', () => { partialCloneFlags.secondMaterial = true })
  return cloned
}
const originalFirstTextureClone = partialFirstTexture.clone.bind(partialFirstTexture)
partialFirstTexture.clone = function () {
  const cloned = originalFirstTextureClone()
  cloned.addEventListener('dispose', () => { partialCloneFlags.firstTexture = true })
  return cloned
}
partialFailingTexture.clone = function () {
  throw new Error('injected second texture clone failure')
}

assert.throws(
  () => partialCloneRuntime.placeInstance(
    'partial-clone-instance',
    'flora.partial-clone',
    { x: 1, y: 0, z: 1 },
  ),
  /injected second texture clone failure/,
  'a partial placement clone must preserve the original cloning failure',
)
assert.deepEqual(partialCloneFlags, {
  firstGeometry: true,
  secondGeometry: true,
  firstMaterial: true,
  secondMaterial: true,
  firstTexture: true,
  sourceFirstGeometry: false,
  sourceSecondGeometry: false,
  sourceFirstMaterial: false,
  sourceSecondMaterial: false,
  sourceFirstTexture: false,
  sourceFailingTexture: false,
}, 'partial placement cloning must release only the cloned resources and preserve source asset resources')
assert.equal(partialCloneScene.children.length, 1,
  'a failed partial placement must never attach a half-cloned object to the live scene')
assert.equal(partialCloneRuntime.hasInstance('partial-clone-instance'), false,
  'a failed partial placement must not publish an instance ID')
assert.equal(partialCloneNotifications, 0,
  'a failed partial placement must not notify persistence of a nonexistent instance')
assert.equal(partialCloneRuntime.remove('partial-clone-source'), true,
  'the source asset must remain valid and removable after a failed instance clone')
assert.equal(partialCloneScene.children.length, 0)


const failedPublishScene = new THREE.Scene()
failedPublishScene.add = (..._objects: THREE.Object3D[]) => {
  throw new Error('injected scene attachment failure')
}
const failedPublishRuntime = new WorldAssetRuntime(failedPublishScene, loader)
const failedPublishFlags = { geometry: false, material: false, texture: false }
const failedPublishTexture = new THREE.Texture()
failedPublishTexture.addEventListener('dispose', () => { failedPublishFlags.texture = true })
const failedPublishMaterial = new THREE.MeshStandardMaterial({ map: failedPublishTexture })
failedPublishMaterial.addEventListener('dispose', () => { failedPublishFlags.material = true })
const failedPublishGeometry = new THREE.BoxGeometry(1, 1, 1)
failedPublishGeometry.addEventListener('dispose', () => { failedPublishFlags.geometry = true })
const failedPublishObject = new THREE.Group()
failedPublishObject.add(new THREE.Mesh(failedPublishGeometry, failedPublishMaterial))
const failedPublishPromise = failedPublishRuntime.load(
  'failed-publish',
  'https://assets.example.test/failed-publish.glb',
  { semanticEntryId: 'flora.failed-publish' },
)
requests[requests.length - 1].onLoad({ scene: failedPublishObject })
await assert.rejects(failedPublishPromise, /injected scene attachment failure/,
  'an exception during asynchronous scene publication must reject the load promise')
assert.deepEqual(failedPublishFlags, { geometry: true, material: true, texture: true },
  'failed asset publication must release the loaded geometry, material and texture')
assert.equal(failedPublishScene.children.length, 0,
  'failed asset publication must not leave an attached scene root')
assert.equal(failedPublishRuntime.stats().loaded, 0,
  'failed asset publication must not leave an asset registry entry')
assert.equal(failedPublishRuntime.getSemanticSource('flora.failed-publish'), undefined,
  'failed asset publication must not leave a semantic source entry')


const invalidTransformRuntime = new WorldAssetRuntime(new THREE.Scene(), loader)
const requestsBeforeInvalidLoad = requests.length
await assert.rejects(
  invalidTransformRuntime.load('invalid-transform-load', 'https://assets.example.test/invalid.glb', { x: Number.NaN }),
  /finite coordinates, scale and rotation/,
  'asset loading must reject non-finite transforms before starting a network request',
)
assert.equal(requests.length, requestsBeforeInvalidLoad,
  'invalid asset transforms must not create a loader request')

const attachFailureScene = new THREE.Scene()
const attachFailureSceneAdd = attachFailureScene.add.bind(attachFailureScene)
attachFailureScene.add = (...objects: THREE.Object3D[]) => {
  attachFailureSceneAdd(...objects)
  throw new Error('injected instance scene attachment failure')
}
let attachFailureNotifications = 0
const attachFailureRuntime = new WorldAssetRuntime(attachFailureScene, loader, () => {
  attachFailureNotifications += 1
})
const attachFailureInternal = attachFailureRuntime as unknown as {
  assets: Map<string, { id: string; semanticEntryId: string; sourceUrl: string; object: THREE.Object3D; animations: THREE.AnimationClip[]; loadedAt: number }>
  semanticSources: Map<string, unknown>
  instances: Map<string, THREE.Object3D>
}
const attachFailureFlags = {
  clonedGeometry: false,
  clonedMaterial: false,
  clonedTexture: false,
  sourceGeometry: false,
  sourceMaterial: false,
  sourceTexture: false,
}
const attachSourceTexture = new THREE.Texture()
attachSourceTexture.addEventListener('dispose', () => { attachFailureFlags.sourceTexture = true })
const attachSourceMaterial = new THREE.MeshStandardMaterial({ map: attachSourceTexture })
attachSourceMaterial.addEventListener('dispose', () => { attachFailureFlags.sourceMaterial = true })
const attachSourceGeometry = new THREE.BoxGeometry(1, 1, 1)
attachSourceGeometry.addEventListener('dispose', () => { attachFailureFlags.sourceGeometry = true })
const attachSourceMesh = new THREE.Mesh(attachSourceGeometry, attachSourceMaterial)
const attachSourceObject = new THREE.Group()
attachSourceObject.add(attachSourceMesh)
const attachSourceAsset = {
  id: 'attach-failure-source',
  semanticEntryId: 'flora.attach-failure',
  sourceUrl: 'https://assets.example.test/attach-failure.glb',
  object: attachSourceObject,
  animations: [],
  loadedAt: Date.now(),
}
attachFailureInternal.assets.set(attachSourceAsset.id, attachSourceAsset)
attachFailureInternal.semanticSources.set(attachSourceAsset.semanticEntryId, attachSourceAsset)

const originalAttachGeometryClone = attachSourceGeometry.clone.bind(attachSourceGeometry)
attachSourceGeometry.clone = function () {
  const cloned = originalAttachGeometryClone()
  cloned.addEventListener('dispose', () => { attachFailureFlags.clonedGeometry = true })
  return cloned
}
const originalAttachMaterialClone = attachSourceMaterial.clone.bind(attachSourceMaterial)
attachSourceMaterial.clone = function () {
  const cloned = originalAttachMaterialClone()
  cloned.addEventListener('dispose', () => { attachFailureFlags.clonedMaterial = true })
  return cloned
}
const originalAttachTextureClone = attachSourceTexture.clone.bind(attachSourceTexture)
attachSourceTexture.clone = function () {
  const cloned = originalAttachTextureClone()
  cloned.addEventListener('dispose', () => { attachFailureFlags.clonedTexture = true })
  return cloned
}

assert.throws(
  () => attachFailureRuntime.placeInstance(
    'invalid-instance-transform',
    'flora.attach-failure',
    { x: Number.NaN, y: 0, z: 0 },
  ),
  /finite coordinates, scale and rotation/,
  'instance placement must reject non-finite coordinates before cloning resources',
)
assert.throws(
  () => attachFailureRuntime.placeInstance(
    'failed-attach-instance',
    'flora.attach-failure',
    { x: 1, y: 0, z: 1 },
  ),
  /injected instance scene attachment failure/,
  'an exception after partial scene attachment must propagate to the caller',
)
assert.deepEqual(attachFailureFlags, {
  clonedGeometry: true,
  clonedMaterial: true,
  clonedTexture: true,
  sourceGeometry: false,
  sourceMaterial: false,
  sourceTexture: false,
}, 'failed instance publication must release only cloned resources and preserve the source asset')
assert.equal(attachFailureScene.children.length, 0,
  'failed instance publication must detach a root even when scene.add throws after attachment')
assert.equal(attachFailureInternal.instances.size, 0,
  'failed instance publication must not leave an instance registry entry')
assert.equal(attachFailureRuntime.hasInstance('failed-attach-instance'), false)
assert.equal(attachFailureNotifications, 0,
  'failed instance publication must not notify persistence of a missing instance')
assert.equal(attachFailureRuntime.remove('attach-failure-source'), true,
  'the source asset must remain usable and removable after failed instance publication')
assert.deepEqual({
  geometry: attachFailureFlags.sourceGeometry,
  material: attachFailureFlags.sourceMaterial,
  texture: attachFailureFlags.sourceTexture,
}, { geometry: true, material: true, texture: true },
'the preserved source asset must release its own resources when subsequently removed')

const rebasedScene = new THREE.Scene()
const rebasedRuntime = new WorldAssetRuntime(rebasedScene, loader)
const rebasedLoad = rebasedRuntime.load(
  'rebased-source',
  'https://assets.example.test/rebased-source.glb',
  { semanticEntryId: 'flora.rebased' },
)
requests[requests.length - 1].onLoad({ scene: new THREE.Group() })
await rebasedLoad
rebasedRuntime.rebase({ x: 1000, y: 64, z: -2000 })
const rebasedInstance = rebasedRuntime.placeInstance(
  'rebased-source:instance:1',
  'flora.rebased',
  { x: 1012, y: 68, z: -1990 },
)
assert.ok(rebasedInstance)
assert.deepEqual(rebasedInstance.position.toArray(), [12, 4, 10],
  'instance render coordinates must be local to a non-zero world anchor')
const rebasedWorldPosition = rebasedRuntime.getInstanceWorldPosition('rebased-source:instance:1')
assert.deepEqual(rebasedWorldPosition, { x: 1012, y: 68, z: -1990 },
  'world position metadata must remain absolute after origin rebasing')
const sampledRebasedHeight = rebasedWorldPosition!.x * 0.001 + rebasedWorldPosition!.z * 0.002
assert.equal(rebasedRuntime.setInstanceWorldTransform('rebased-source:instance:1', {
  position: { x: rebasedWorldPosition!.x, y: sampledRebasedHeight, z: rebasedWorldPosition!.z },
}), true)
assert.ok(Math.abs(rebasedInstance.position.y - (sampledRebasedHeight - 64)) < 1e-10,
  'terrain height must be converted back to renderer-local Y after a vertical origin rebase')
assert.deepEqual(rebasedRuntime.getInstanceWorldPosition('rebased-source:instance:1'), {
  x: 1012, y: sampledRebasedHeight, z: -1990,
}, 'grounding must update absolute placement metadata without losing world X/Z')
assert.equal(rebasedRuntime.remove('rebased-source'), true)


const scatterRollbackScene = new THREE.Scene()
let scatterRollbackNotifications = 0
const scatterRollbackRuntime = new WorldAssetRuntime(scatterRollbackScene, loader, () => {
  scatterRollbackNotifications += 1
})
const scatterSourceTexture = new THREE.Texture()
let scatterSourceTextureDisposed = false
scatterSourceTexture.addEventListener('dispose', () => { scatterSourceTextureDisposed = true })
const scatterSourceMaterial = new THREE.MeshStandardMaterial({ map: scatterSourceTexture })
let scatterSourceMaterialDisposed = false
scatterSourceMaterial.addEventListener('dispose', () => { scatterSourceMaterialDisposed = true })
const scatterSourceGeometry = new THREE.BoxGeometry(1, 1, 1)
let scatterSourceGeometryDisposed = false
scatterSourceGeometry.addEventListener('dispose', () => { scatterSourceGeometryDisposed = true })
const scatterSourceObject = new THREE.Group()
scatterSourceObject.add(new THREE.Mesh(scatterSourceGeometry, scatterSourceMaterial))
const scatterSourceLoad = scatterRollbackRuntime.load(
  'scatter-rollback-source',
  'https://assets.example.test/scatter-rollback.glb',
  { semanticEntryId: 'flora.scatter-rollback' },
)
requests[requests.length - 1].onLoad({ scene: scatterSourceObject })
await scatterSourceLoad

const scatterRollbackFlags = {
  geometries: [] as number[],
  materials: [] as number[],
  textures: [] as number[],
}
let scatterGeometryCloneCount = 0
const originalScatterGeometryClone = scatterSourceGeometry.clone.bind(scatterSourceGeometry)
scatterSourceGeometry.clone = function () {
  const index = ++scatterGeometryCloneCount
  const cloned = originalScatterGeometryClone()
  cloned.addEventListener('dispose', () => { scatterRollbackFlags.geometries.push(index) })
  return cloned
}
let scatterMaterialCloneCount = 0
const originalScatterMaterialClone = scatterSourceMaterial.clone.bind(scatterSourceMaterial)
scatterSourceMaterial.clone = function () {
  const index = ++scatterMaterialCloneCount
  const cloned = originalScatterMaterialClone()
  cloned.addEventListener('dispose', () => { scatterRollbackFlags.materials.push(index) })
  return cloned
}
let scatterTextureCloneCount = 0
const originalScatterTextureClone = scatterSourceTexture.clone.bind(scatterSourceTexture)
scatterSourceTexture.clone = function () {
  const index = ++scatterTextureCloneCount
  if (index === 2) throw new Error('injected second scatter texture clone failure')
  const cloned = originalScatterTextureClone()
  cloned.addEventListener('dispose', () => { scatterRollbackFlags.textures.push(index) })
  return cloned
}

assert.throws(
  () => scatterRollbackRuntime.scatterSemantic(
    'flora.scatter-rollback',
    { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    3,
    29,
    1,
  ),
  /injected second scatter texture clone failure/,
  'a failed later clone in a scatter batch must surface the original construction failure',
)
assert.deepEqual(scatterRollbackFlags, {
  geometries: [2, 1],
  materials: [2, 1],
  textures: [1],
}, 'scatter failure must dispose the later partial clone before rolling back the earlier committed clone')
assert.equal(scatterRollbackScene.children.length, 1,
  'scatter rollback must leave only the registered source asset in the scene')
assert.equal(scatterRollbackRuntime.stats().instances, 0,
  'scatter rollback must remove every instance created by the failed batch')
assert.equal(scatterRollbackNotifications, 2,
  'scatter rollback must notify for the committed placement and its removal')
assert.equal(scatterSourceGeometryDisposed, false)
assert.equal(scatterSourceMaterialDisposed, false)
assert.equal(scatterSourceTextureDisposed, false,
  'scatter rollback must never dispose resources owned by the source asset')
assert.throws(
  () => scatterRollbackRuntime.scatterSemantic(
    'flora.scatter-rollback',
    { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    Number.POSITIVE_INFINITY,
  ),
  /bounds, count, seed and scale must be finite/,
  'non-finite scatter count must be rejected before entering the placement loop',
)
assert.equal(scatterRollbackRuntime.stats().instances, 0)
assert.equal(scatterRollbackRuntime.remove('scatter-rollback-source'), true)
assert.deepEqual({
  geometry: scatterSourceGeometryDisposed,
  material: scatterSourceMaterialDisposed,
  texture: scatterSourceTextureDisposed,
}, { geometry: true, material: true, texture: true })

const scatterNotificationScene = new THREE.Scene()
let scatterNotificationAttempts = 0
const scatterNotificationRuntime = new WorldAssetRuntime(scatterNotificationScene, loader, () => {
  scatterNotificationAttempts += 1
  if (scatterNotificationAttempts === 1) throw new Error('injected first scatter placement notification failure')
})
const scatterNotificationLoad = scatterNotificationRuntime.load(
  'scatter-notification-source',
  'https://assets.example.test/scatter-notification.glb',
  { semanticEntryId: 'flora.scatter-notification' },
)
requests[requests.length - 1].onLoad({ scene: createGltfScene() })
await scatterNotificationLoad
assert.throws(
  () => scatterNotificationRuntime.scatterSemantic(
    'flora.scatter-notification',
    { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
    2,
    41,
    1,
  ),
  /injected first scatter placement notification failure/,
  'a persistence callback failure after publishing a placement must abort the batch'
)
assert.equal(scatterNotificationRuntime.stats().instances, 0,
  'scatter rollback must include the current instance even when placeInstance throws after publication')
assert.equal(scatterNotificationScene.children.length, 1,
  'notification failure rollback must leave only the source asset attached')
assert.equal(scatterNotificationAttempts, 2,
  'rollback must invoke placement bookkeeping for the removal of the published instance')
assert.equal(scatterNotificationRuntime.remove('scatter-notification-source'), true)

const rendererSource = await readFile(new URL('../src/render/InfiniteWorldRenderer.ts', import.meta.url), 'utf8')

const removalWithoutInstancesScene = new THREE.Scene()
let removalWithoutInstancesNotifications = 0
const removalWithoutInstancesRuntime = new WorldAssetRuntime(
  removalWithoutInstancesScene,
  loader,
  () => { removalWithoutInstancesNotifications += 1 },
)
const removalWithoutInstancesLoad = removalWithoutInstancesRuntime.load(
  'source-with-pending-only',
  'https://assets.example.test/source-with-pending-only.glb',
  { semanticEntryId: 'flora.pending-only' },
)
requests[requests.length - 1].onLoad({ scene: new THREE.Group() })
await removalWithoutInstancesLoad
assert.equal(removalWithoutInstancesRuntime.stats().instances, 0)
assert.equal(removalWithoutInstancesRuntime.remove('source-with-pending-only'), true)
assert.equal(removalWithoutInstancesNotifications, 0,
  'removing a source asset without materialized placements does not emit placement-change notifications')

const rendererRemovalSource = rendererSource.match(/removeExternalAsset\(assetId: string\) \{([\s\S]*?)\n  \}/)?.[1]
assert.ok(rendererRemovalSource, 'renderer must expose external asset removal bookkeeping')
assert.match(rendererRemovalSource, /if \(pendingRemoved\) this\.scheduleSave\(\)/,
  'removing pending placements must schedule autosave even when the source asset has no runtime instances')
const pendingAutosaveIndex = rendererRemovalSource.indexOf('if (pendingRemoved) this.scheduleSave()')
const runtimeRemovalIndex = rendererRemovalSource.indexOf('this.worldAssetRuntime.remove(assetId)')
assert.ok(pendingAutosaveIndex >= 0 && runtimeRemovalIndex >= 0 && pendingAutosaveIndex < runtimeRemovalIndex,
  'pending placement autosave must be queued before runtime disposal can throw and abort the removal call')
assert.doesNotMatch(rendererRemovalSource, /pendingRemoved && !runtimeRemoved/,
  'pending-placement autosave must not depend on whether the source asset was also removed')

const externalLoadSource = rendererSource.match(/async loadExternalAsset\([\s\S]*?\n  \}/)?.[0]
assert.ok(externalLoadSource, 'renderer must expose external asset load and placement restoration')
assert.match(externalLoadSource, /materialized\.errors\.length/,
  'renderer must report per-descriptor restoration failures without dropping pending descriptors')

assert.match(rendererSource, /private groundExternalAssetInstances\(instances: THREE\.Object3D\[\]\)/,
  'renderer must centralize external asset terrain grounding')
assert.equal((rendererSource.match(/this\.groundExternalAssetInstances\((?:placed|instances)\)/g) ?? []).length, 3,
  'biome population, world composition and direct scatter must all use world-coordinate-safe grounding')
assert.doesNotMatch(rendererSource, /const (?:worldX|x) = instance\.position\.x/,
  'renderer must not treat rebased local instance X as an absolute world coordinate')
const groundingHelperStart = rendererSource.indexOf('  private groundExternalAssetInstances(instances: THREE.Object3D[]) {')
const groundingHelperEnd = rendererSource.indexOf('  async loadExternalAsset(', groundingHelperStart)
const groundingHelper = rendererSource.slice(groundingHelperStart, groundingHelperEnd)
assert.match(groundingHelper, /try\s*\{[\s\S]*setInstanceWorldTransform/,
  'external asset grounding must guard the complete batch')
assert.match(groundingHelper, /catch \(error\)[\s\S]*createdInstanceIds\.reverse\(\)[\s\S]*removeInstance/,
  'failed external asset grounding must remove every newly created placement')
assert.match(groundingHelper, /AggregateError/,
  'grounding rollback failures must be preserved alongside the original error')

console.log('WorldAssetRuntime asset lifecycle, independent skeletal animation states, crossfades, distance LOD and disposal: PASS')
