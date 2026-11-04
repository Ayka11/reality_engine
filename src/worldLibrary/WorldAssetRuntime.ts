import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

export type RuntimeAsset = {
  id: string
  semanticEntryId?: string
  sourceUrl: string
  object: THREE.Object3D
  animations: THREE.AnimationClip[]
  loadedAt: number
}

export class WorldAssetRuntime {
  private readonly loader: Pick<GLTFLoader, 'load'>
  private generation = 0
  private readonly assets = new Map<string, RuntimeAsset>()
  private readonly loading = new Map<string, Promise<RuntimeAsset>>()
  private readonly pendingRejectors = new Map<string, (reason: Error) => void>()
  private readonly semanticSources = new Map<string, RuntimeAsset>()
  private readonly instances = new Map<string, THREE.Object3D>()
  private readonly instanceMixers = new Map<string, THREE.AnimationMixer>()

  constructor(private readonly scene: THREE.Scene, loader: Pick<GLTFLoader, 'load'> = new GLTFLoader()) {
    this.loader = loader
  }

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

    const generation = this.generation
    let task: Promise<RuntimeAsset>
    let cancelTask: ((reason: Error) => void) | undefined
    task = new Promise<RuntimeAsset>((resolve, reject) => {
      cancelTask = reject
      this.loader.load(
        sourceUrl,
        (gltf) => {
          const object = gltf.scene
          if (generation !== this.generation) {
            this.disposeObject(object)
            reject(new Error(`Asset load invalidated by world replacement: ${id}`))
            return
          }
          object.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 0)
          object.rotation.y = options.rotationY ?? 0
          object.scale.setScalar(Math.max(0.001, options.scale ?? 1))
          object.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = false
            mesh.receiveShadow = false
          })
          object.visible = false
          this.scene.add(object)
          const asset: RuntimeAsset = {
            id,
            semanticEntryId: options.semanticEntryId,
            sourceUrl,
            object,
            animations: [...(gltf.animations ?? [])],
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
      if (this.loading.get(id) === task) {
        this.loading.delete(id)
        if (this.pendingRejectors.get(id) === cancelTask) this.pendingRejectors.delete(id)
      }
    })

    this.loading.set(id, task)
    if (cancelTask) this.pendingRejectors.set(id, cancelTask)
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
    // SkeletonUtils rewires every SkinnedMesh to cloned bones/skeletons.
    // Object3D.clone(true) alone would keep the source skeleton shared.
    const instance = cloneSkeleton(source.object)
    instance.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry = mesh.geometry.clone()
      if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material) => this.cloneMaterialWithOwnedTextures(material))
      else mesh.material = this.cloneMaterialWithOwnedTextures(mesh.material)
    })
    instance.position.set(options.x, options.y, options.z)
    instance.userData.worldPosition = { x: options.x, y: options.y, z: options.z }
    instance.rotation.y = options.rotationY ?? 0
    instance.scale.setScalar(Math.max(0.001, options.scale ?? 1))
    instance.userData.runtimeAssetInstanceId = instanceId
    instance.userData.runtimeAssetSourceId = source.id
    instance.userData.semanticEntryId = semanticEntryId
    this.scene.add(instance)
    this.instances.set(instanceId, instance)
    return instance
  }

  private cloneMaterialWithOwnedTextures<T extends THREE.Material>(material: T): T {
    const clone = material.clone() as T
    const clonedTextures = new Map<THREE.Texture, THREE.Texture>()
    const cloneValue = (value: unknown): unknown => {
      if (value instanceof THREE.Texture) {
        let texture = clonedTextures.get(value)
        if (!texture) {
          texture = value.clone()
          clonedTextures.set(value, texture)
        }
        return texture
      }
      if (Array.isArray(value)) return value.map(cloneValue)
      if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]))
      }
      return value
    }
    for (const key of Object.keys(clone) as Array<keyof T>) {
      const value = clone[key]
      if (value instanceof THREE.Texture || Array.isArray(value) ||
        (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)) {
        ;(clone as any)[key] = cloneValue(value)
      }
    }
    return clone
  }

  private disposeObject(object: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    const textures = new Set<THREE.Texture>()
    const skeletons = new Set<THREE.Skeleton>()
    const instancedMeshes = new Set<THREE.InstancedMesh>()
    const collectTextures = (value: unknown, seen = new Set<object>()) => {
      if (value instanceof THREE.Texture) {
        textures.add(value)
        return
      }
      if (!value || typeof value !== 'object' || seen.has(value as object)) return
      seen.add(value as object)
      if (Array.isArray(value)) {
        value.forEach(entry => collectTextures(entry, seen))
      } else if (Object.getPrototypeOf(value) === Object.prototype) {
        Object.values(value).forEach(entry => collectTextures(entry, seen))
      }
    }
    object.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      geometries.add(mesh.geometry)
      const skinnedMesh = node as THREE.SkinnedMesh
      if (skinnedMesh.isSkinnedMesh) skeletons.add(skinnedMesh.skeleton)
      const instancedMesh = node as THREE.InstancedMesh
      if (instancedMesh.isInstancedMesh) instancedMeshes.add(instancedMesh)
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      meshMaterials.forEach(material => {
        materials.add(material)
        for (const value of Object.values(material)) collectTextures(value)
      })
    })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    textures.forEach(texture => texture.dispose())
    skeletons.forEach(skeleton => skeleton.dispose())
    instancedMeshes.forEach(mesh => mesh.dispose())
  }

  playInstanceAnimation(instanceId: string, clipName?: string) {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    const sourceId = instance.userData.runtimeAssetSourceId as string | undefined
    const source = sourceId ? this.assets.get(sourceId) : undefined
    if (!source?.animations.length) return false
    const clip = clipName
      ? source.animations.find(candidate => candidate.name === clipName)
      : source.animations[0]
    if (!clip) return false

    this.stopInstanceAnimation(instanceId)
    const mixer = new THREE.AnimationMixer(instance)
    mixer.clipAction(clip).reset().play()
    this.instanceMixers.set(instanceId, mixer)
    return true
  }

  stopInstanceAnimation(instanceId: string) {
    const mixer = this.instanceMixers.get(instanceId)
    if (!mixer) return false
    const instance = this.instances.get(instanceId)
    mixer.stopAllAction()
    if (instance) mixer.uncacheRoot(instance)
    this.instanceMixers.delete(instanceId)
    return true
  }

  updateAnimations(deltaSeconds: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0
    for (const mixer of this.instanceMixers.values()) mixer.update(deltaSeconds)
    return this.instanceMixers.size
  }

  removeInstance(instanceId: string) {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    this.stopInstanceAnimation(instanceId)
    this.scene.remove(instance)
    this.disposeObject(instance)
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

  private refreshSemanticSource(semanticEntryId: string) {
    const replacement = [...this.assets.values()]
      .reverse()
      .find(asset => asset.semanticEntryId === semanticEntryId)
    if (replacement) this.semanticSources.set(semanticEntryId, replacement)
    else this.semanticSources.delete(semanticEntryId)
  }

  remove(id: string) {
    const asset = this.assets.get(id)
    if (!asset) return false

    // Instances own cloned GPU resources, but remain semantically dependent on
    // their source asset. Remove those placements before releasing the source.
    for (const [instanceId, instance] of this.instances) {
      if (instance.userData.runtimeAssetSourceId === id) this.removeInstance(instanceId)
    }

    this.scene.remove(asset.object)
    this.assets.delete(id)
    if (asset.semanticEntryId && this.semanticSources.get(asset.semanticEntryId) === asset) {
      this.refreshSemanticSource(asset.semanticEntryId)
    }
    this.disposeObject(asset.object)
    return true
  }

  clear() {
    // Invalidate outstanding GLTF callbacks before releasing the current world.
    // Clear the map immediately so a new world can request the same asset ID.
    this.generation += 1
    for (const cancel of this.pendingRejectors.values()) {
      cancel(new Error('Asset load invalidated by world replacement'))
    }
    this.pendingRejectors.clear()
    this.loading.clear()
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
