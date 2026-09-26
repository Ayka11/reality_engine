import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type RuntimeAsset = {
  id: string
  semanticEntryId?: string
  sourceUrl: string
  object: THREE.Object3D
  loadedAt: number
}

export class WorldAssetRuntime {
  private readonly loader = new GLTFLoader()
  private readonly assets = new Map<string, RuntimeAsset>()
  private readonly loading = new Map<string, Promise<RuntimeAsset>>()
  private readonly semanticSources = new Map<string, RuntimeAsset>()
  private readonly instances = new Map<string, THREE.Object3D>()

  constructor(private readonly scene: THREE.Scene) {}

  has(id: string) {
    return this.assets.has(id)
  }

  get(id: string) {
    return this.assets.get(id)
  }

  all() {
    return [...this.assets.values()]
  }

  async load(
    id: string,
    sourceUrl: string,
    options: {
      semanticEntryId?: string
      x?: number
      y?: number
      z?: number
      scale?: number
      rotationY?: number
    } = {},
  ): Promise<RuntimeAsset> {
    const existing = this.assets.get(id)
    if (existing) return existing
    const pending = this.loading.get(id)
    if (pending) return pending

    const task = new Promise<RuntimeAsset>((resolve, reject) => {
      this.loader.load(
        sourceUrl,
        (gltf) => {
          const object = gltf.scene
          object.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0)
          object.rotation.y = options.rotationY ?? 0
          object.scale.setScalar(Math.max(0.001, options.scale ?? 1))
          object.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = false
            mesh.receiveShadow = false
          })
          this.scene.add(object)
          const asset: RuntimeAsset = {
            id,
            semanticEntryId: options.semanticEntryId,
            sourceUrl,
            object,
            loadedAt: Date.now(),
          }
          object.userData.worldPosition = { x: options.x ?? 0, y: options.y ?? 0, z: options.z ?? 0 }
          this.assets.set(id, asset)
          if (asset.semanticEntryId) this.semanticSources.set(asset.semanticEntryId, asset)
          resolve(asset)
        },
        undefined,
        reject,
      )
    }).finally(() => {
      this.loading.delete(id)
    })

    this.loading.set(id, task)
    return task
  }

  getSemanticSource(semanticEntryId: string) {
    return this.semanticSources.get(semanticEntryId)
  }

  placeInstance(
    instanceId: string,
    semanticEntryId: string,
    options: { x: number; y: number; z: number; scale?: number; rotationY?: number },
  ) {
    if (this.instances.has(instanceId)) return this.instances.get(instanceId) || null
    const source = this.semanticSources.get(semanticEntryId)
    if (!source) return null
    const instance = source.object.clone(true)
    instance.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry = mesh.geometry.clone()
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => material.clone())
      else mesh.material = mesh.material.clone()
    })
    instance.position.set(options.x, options.y, options.z)
    instance.userData.worldPosition = { x: options.x, y: options.y, z: options.z }
    instance.rotation.y = options.rotationY ?? 0
    instance.scale.setScalar(Math.max(0.001, options.scale ?? 1))
    instance.userData.runtimeAssetInstanceId = instanceId
    instance.userData.semanticEntryId = semanticEntryId
    this.scene.add(instance)
    this.instances.set(instanceId, instance)
    return instance
  }

  removeInstance(instanceId: string) {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    this.scene.remove(instance)
    this.instances.delete(instanceId)
    return true
  }

  scatterSemantic(
    semanticEntryId: string,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    count: number,
    seed = 1,
    scale = 1,
  ) {
    if (!this.semanticSources.has(semanticEntryId)) return []
    const placed: THREE.Object3D[] = []
    let state = seed >>> 0
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0
      return state / 4294967296
    }
    const total = Math.max(0, Math.floor(count))
    for (let i = 0; i < total; i++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX)
      const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ)
      const instance = this.placeInstance(
        `${semanticEntryId}:instance:${seed}:${i}`,
        semanticEntryId,
        { x, y: 0, z, scale: scale * (0.85 + random() * 0.3), rotationY: random() * Math.PI * 2 },
      )
      if (instance) placed.push(instance)
    }
    return placed
  }

  remove(id: string) {
    const asset = this.assets.get(id)
    if (!asset) return false
    this.scene.remove(asset.object)
    if (asset.semanticEntryId) this.semanticSources.delete(asset.semanticEntryId)
    asset.object.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => material.dispose())
    })
    this.assets.delete(id)
    return true
  }

  clear() {
    for (const id of [...this.instances.keys()]) this.removeInstance(id)
    for (const id of [...this.assets.keys()]) this.remove(id)
  }

  rebase(worldAnchor: { x: number; y?: number; z: number }) {
    for (const asset of this.assets.values()) {
      const world = asset.object.userData.worldPosition as { x: number; y: number; z: number } | undefined
      if (world) asset.object.position.set(world.x - worldAnchor.x, world.y - (worldAnchor.y ?? 0), world.z - worldAnchor.z)
    }
    for (const instance of this.instances.values()) {
      const world = instance.userData.worldPosition as { x: number; y: number; z: number } | undefined
      if (world) instance.position.set(world.x - worldAnchor.x, world.y - (worldAnchor.y ?? 0), world.z - worldAnchor.z)
    }
  }

  updateVisibility(camera: THREE.Camera, maxDistance = 650, maxVisible = 500) {
    const cameraPosition = new THREE.Vector3()
    camera.getWorldPosition(cameraPosition)
    const candidates = [...this.instances.values(), ...[...this.assets.values()].map(asset => asset.object)]
    const ranked = candidates.map(object => ({ object, distance: object.position.distanceTo(cameraPosition) }))
      .sort((a, b) => a.distance - b.distance)
    const visible = new Set(ranked.slice(0, maxVisible).filter(item => item.distance <= maxDistance).map(item => item.object))
    candidates.forEach(object => { object.visible = visible.has(object) })
    return { total: candidates.length, visible: visible.size }
  }

  stats() {
    return {
      loaded: this.assets.size,
      ids: [...this.assets.keys()],
    }
  }
}
