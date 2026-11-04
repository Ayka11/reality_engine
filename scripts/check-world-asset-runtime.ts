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
const createGltfScene = () => {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()))
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
const currentLoad = runtime.load('oak', 'https://assets.example.test/current-oak.glb', {
  semanticEntryId: 'flora.oak',
})
assert.equal(requests.length, 2, 'clear must release the old pending ID for a new world load')

requests[0].onLoad({ scene: staleScene })
await assert.rejects(staleLoad, /invalidated by world replacement/)
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

runtime.clear()
assert.equal(runtime.stats().loaded, 0)
assert.equal(scene.children.length, 0, 'clear must remove loaded source assets and placed instances')
assert.equal(runtime.getSemanticSource('flora.oak'), undefined)

console.log('WorldAssetRuntime generation invalidation, same-ID reload, stale-finalizer isolation, and disposal: PASS')
