import assert from 'node:assert/strict'
import * as THREE from 'three'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { WorldAssetRuntime } from '../src/worldLibrary/WorldAssetRuntime.ts'

type LoadRequest = {
  onLoad: (gltf: { scene: THREE.Group }) => void
  onError?: (error: unknown) => void
}

const requests: LoadRequest[] = []
const loader = {
  load: (
    _url: string,
    onLoad: (gltf: { scene: THREE.Group }) => void,
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
  return group
}

const staleScene = createGltfScene()
let staleGeometryDisposed = false
;(staleScene.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => {
  staleGeometryDisposed = true
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

requests[0].onLoad({ scene: staleScene })
assert.equal(staleGeometryDisposed, true, 'late stale GLTF payloads must be disposed')
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
assert.equal(scene.children.length, 2)

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

console.log('WorldAssetRuntime generation invalidation, same-ID reload, instance texture ownership, and disposal: PASS')
