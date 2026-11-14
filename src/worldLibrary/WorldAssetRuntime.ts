import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { ExternalAssetPlacementSnapshot } from '../infinity/ExternalAssetPlacement'

export type InstanceAnimationOptions = {
  fadeDuration?: number
  loopOnce?: boolean
  repetitions?: number
  timeScale?: number
  clampWhenFinished?: boolean
}

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
  private readonly loadingRequests = new Map<string, { sourceUrl: string; semanticEntryId?: string }>()
  private readonly pendingRejectors = new Map<string, (reason: Error) => void>()
  private readonly semanticSources = new Map<string, RuntimeAsset>()
  private readonly instances = new Map<string, THREE.Object3D>()
  private readonly instanceMixers = new Map<string, THREE.AnimationMixer>()
  private readonly instanceActions = new Map<string, THREE.AnimationAction>()
  private readonly pendingAnimationStops = new Map<string, Array<{ action: THREE.AnimationAction; remainingSeconds: number }>>()
  private readonly animationAccumulators = new Map<string, number>()
  /** Latest absolute-world anchor used to rebase renderer-local instance positions. */
  private worldAnchor = { x: 0, y: 0, z: 0 }

  constructor(
    private readonly scene: THREE.Scene,
    loader: Pick<GLTFLoader, 'load'> = new GLTFLoader(),
    private readonly onPlacementsChanged?: () => void,
  ) {
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
    const transformValues = [
      options.x ?? 0,
      options.y ?? 0,
      options.z ?? 0,
      options.scale ?? 1,
      options.rotationY ?? 0,
    ]
    if (!transformValues.every(Number.isFinite)) {
      throw new TypeError('Asset load transform must contain finite coordinates, scale and rotation')
    }

    const existing = this.assets.get(id)
    if (existing) {
      if (existing.sourceUrl !== sourceUrl ||
          (options.semanticEntryId !== undefined && existing.semanticEntryId !== options.semanticEntryId)) {
        throw new Error(
          'Asset ID ' + id + ' is already owned by a different source URL or semantic entry',
        )
      }
      return existing
    }
    const pending = this.loading.get(id)
    if (pending) {
      const pendingRequest = this.loadingRequests.get(id)
      if (!pendingRequest ||
          pendingRequest.sourceUrl !== sourceUrl ||
          pendingRequest.semanticEntryId !== options.semanticEntryId) {
        throw new Error(
          'Asset ID ' + id + ' already has an in-flight load for a different source URL or semantic entry',
        )
      }
      return pending
    }

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
            // clear() already rejected this request before invalidating the
            // generation. The late callback owns only its detached GLTF payload:
            // attempt cleanup, report failures, and never settle the promise twice.
            try {
              this.disposeObject(object)
            } catch (disposeError) {
              console.warn('[WorldAssetRuntime] Stale asset ' + id + ' resource cleanup failed', disposeError)
            }
            return
          }

          const previousSemanticSource = options.semanticEntryId
            ? this.semanticSources.get(options.semanticEntryId)
            : undefined
          let asset: RuntimeAsset | undefined
          try {
            object.position.set(
              (options.x ?? 0) - this.worldAnchor.x,
              (options.y ?? 0) - this.worldAnchor.y,
              (options.z ?? 0) - this.worldAnchor.z,
            )
            object.rotation.y = options.rotationY ?? 0
            object.scale.setScalar(Math.max(0.001, options.scale ?? 1))
            object.traverse((node) => {
              const mesh = node as THREE.Mesh
              if (!mesh.isMesh) return
              mesh.castShadow = false
              mesh.receiveShadow = false
            })
            object.visible = false
            object.userData.worldPosition = { x: options.x ?? 0, y: options.y ?? 0, z: options.z ?? 0 }
            asset = {
              id,
              semanticEntryId: options.semanticEntryId,
              sourceUrl,
              object,
              animations: [...(gltf.animations ?? [])],
              loadedAt: Date.now(),
            }

            this.scene.add(object)
            this.assets.set(id, asset)
            if (asset.semanticEntryId) this.semanticSources.set(asset.semanticEntryId, asset)
            resolve(asset)
          } catch (error) {
            const cleanupFailures: unknown[] = []
            // Undo any partially published indexes before releasing the object.
            if (this.assets.get(id)?.object === object) this.assets.delete(id)
            if (asset?.semanticEntryId && this.semanticSources.get(asset.semanticEntryId) === asset) {
              if (previousSemanticSource) {
                this.semanticSources.set(asset.semanticEntryId, previousSemanticSource)
              } else {
                this.semanticSources.delete(asset.semanticEntryId)
              }
            }
            try {
              this.scene.remove(object)
            } catch (cleanupError) {
              cleanupFailures.push(new Error('Failed to detach partially loaded asset ' + id, { cause: cleanupError }))
            }
            try {
              this.disposeObject(object)
            } catch (cleanupError) {
              cleanupFailures.push(new Error('Failed to dispose partially loaded asset ' + id, { cause: cleanupError }))
            }
            reject(cleanupFailures.length > 0
              ? new AggregateError([error, ...cleanupFailures],
                'Asset ' + id + ' load publication and rollback failed')
              : error)
          }
        },
        undefined,
        reject,
      )
    }).finally(() => {
      if (this.loading.get(id) === task) {
        this.loading.delete(id)
        this.loadingRequests.delete(id)
        if (this.pendingRejectors.get(id) === cancelTask) this.pendingRejectors.delete(id)
      }
    })

    this.loading.set(id, task)
    this.loadingRequests.set(id, {
      sourceUrl,
      semanticEntryId: options.semanticEntryId,
    })
    if (cancelTask) this.pendingRejectors.set(id, cancelTask)
    return task
  }

  getSemanticSource(semanticEntryId: string) {
    return this.semanticSources.get(semanticEntryId)
  }

  placeInstance(
    instanceId: string,
    semanticEntryId: string,
    options: {
      x: number; y: number; z: number; scale?: number; rotationY?: number
      /** Transient instances are regenerated from simulation state and never enter world saves. */
      persistence?: 'persistent' | 'transient'
      /** Select an exact loaded asset when multiple files share one semantic entry. */
      sourceAssetId?: string
    },
  ) {
    if (options.sourceAssetId !== undefined &&
        (typeof options.sourceAssetId !== 'string' || !options.sourceAssetId.trim())) {
      throw new TypeError('External asset sourceAssetId must be a non-empty string')
    }
    if (![options.x, options.y, options.z].every(Number.isFinite) ||
        (options.scale !== undefined && !Number.isFinite(options.scale)) ||
        (options.rotationY !== undefined && !Number.isFinite(options.rotationY))) {
      throw new TypeError('External asset instance transform must contain finite coordinates, scale and rotation')
    }

    const expectedSource = options.sourceAssetId !== undefined
      ? this.assets.get(options.sourceAssetId)
      : this.semanticSources.get(semanticEntryId)
    const expectedSourceAssetId = expectedSource?.id
    const existing = this.instances.get(instanceId)
    if (existing) {
      const existingSourceAssetId = existing.userData.runtimeAssetSourceId
      const existingSemanticEntryId = existing.userData.semanticEntryId
      if (existingSemanticEntryId !== semanticEntryId ||
          existingSourceAssetId !== expectedSourceAssetId) {
        throw new Error(
          'External asset instance ID ' + instanceId +
          ' is already owned by a different asset source or semantic entry',
        )
      }
      return existing
    }

    const source = expectedSource
    if (!source || source.semanticEntryId !== semanticEntryId) return null
    // SkeletonUtils rewires every SkinnedMesh to cloned bones/skeletons.
    // Object3D.clone(true) alone would keep the source skeleton shared.
    const instance = cloneSkeleton(source.object)
    const ownedGeometries = new Set<THREE.BufferGeometry>()
    const ownedMaterials = new Set<THREE.Material>()
    const ownedTextures = new Set<THREE.Texture>()
    const ownedSkeletons = new Set<THREE.Skeleton>()
    let sceneAttachmentAttempted = false

    try {
      // Collect every cloned skeleton before resource cloning can fail partway
      // through the object graph.
      instance.traverse(node => {
        const skinnedMesh = node as THREE.SkinnedMesh
        if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton) {
          ownedSkeletons.add(skinnedMesh.skeleton)
        }
      })

      instance.traverse((node) => {
        const renderable = node as THREE.Object3D & {
          geometry?: THREE.BufferGeometry
          material?: THREE.Material | THREE.Material[]
        }
        if (renderable.geometry instanceof THREE.BufferGeometry) {
          const geometry = renderable.geometry.clone()
          ownedGeometries.add(geometry)
          renderable.geometry = geometry
        }
        if (Array.isArray(renderable.material)) {
          renderable.material = renderable.material.map(material =>
            this.cloneMaterialWithOwnedTextures(material, ownedMaterials, ownedTextures))
        } else if (renderable.material instanceof THREE.Material) {
          renderable.material = this.cloneMaterialWithOwnedTextures(
            renderable.material, ownedMaterials, ownedTextures)
        }
      })

      instance.position.set(
        options.x - this.worldAnchor.x,
        options.y - this.worldAnchor.y,
        options.z - this.worldAnchor.z,
      )
      instance.userData.worldPosition = { x: options.x, y: options.y, z: options.z }
      instance.userData.persistentWorldAssetPlacement = options.persistence !== 'transient'
      instance.rotation.y = options.rotationY ?? 0
      instance.scale.setScalar(Math.max(0.001, options.scale ?? 1))
      instance.userData.runtimeAssetInstanceId = instanceId
      instance.userData.runtimeAssetSourceId = source.id
      instance.userData.semanticEntryId = semanticEntryId
      sceneAttachmentAttempted = true
      this.scene.add(instance)
      this.instances.set(instanceId, instance)
    } catch (error) {
      const cleanupFailures: unknown[] = []
      if (this.instances.get(instanceId) === instance) this.instances.delete(instanceId)
      if (sceneAttachmentAttempted) {
        try { this.scene.remove(instance) } catch (cleanupError) { cleanupFailures.push(cleanupError) }
      }
      for (const geometry of ownedGeometries) {
        try { geometry.dispose() } catch (cleanupError) { cleanupFailures.push(cleanupError) }
      }
      for (const material of ownedMaterials) {
        try { material.dispose() } catch (cleanupError) { cleanupFailures.push(cleanupError) }
      }
      for (const texture of ownedTextures) {
        try { texture.dispose() } catch (cleanupError) { cleanupFailures.push(cleanupError) }
      }
      for (const skeleton of ownedSkeletons) {
        try { skeleton.dispose() } catch (cleanupError) { cleanupFailures.push(cleanupError) }
      }
      if (cleanupFailures.length > 0) {
        throw new AggregateError([error, ...cleanupFailures],
          `External asset instance ${instanceId} construction and partial resource cleanup failed`)
      }
      throw error
    }

    if (instance.userData.persistentWorldAssetPlacement !== false) this.onPlacementsChanged?.()
    return instance
  }

  snapshotPlacements(): ExternalAssetPlacementSnapshot[] {
    return [...this.instances]
      .filter(([, instance]) => instance.userData.persistentWorldAssetPlacement !== false)
      .map(([instanceId, instance]) => {
      const worldPosition = instance.userData.worldPosition as
        { x: number; y: number; z: number } | undefined
      const sourceAssetId = instance.userData.runtimeAssetSourceId
      const semanticEntryId = instance.userData.semanticEntryId
      if (!worldPosition ||
          typeof sourceAssetId !== 'string' || !sourceAssetId.trim() ||
          typeof semanticEntryId !== 'string' || !semanticEntryId.trim()) {
        throw new Error(`External asset instance ${instanceId} is missing portable placement metadata`)
      }
      const placement: ExternalAssetPlacementSnapshot = {
        instanceId,
        sourceAssetId,
        semanticEntryId,
        x: worldPosition.x,
        y: worldPosition.y,
        z: worldPosition.z,
        scale: instance.scale.x,
        rotationY: instance.rotation.y,
      }
      if (![placement.x, placement.y, placement.z, placement.scale, placement.rotationY].every(Number.isFinite) ||
          placement.scale <= 0) {
        throw new Error(`External asset instance ${instanceId} has an invalid portable transform`)
      }
      return placement
    })
  }

  hasInstance(instanceId: string) {
    return this.instances.has(instanceId)
  }

  getInstanceSourceAssetId(instanceId: string): string | null {
    const sourceAssetId = this.instances.get(instanceId)?.userData.runtimeAssetSourceId
    return typeof sourceAssetId === 'string' ? sourceAssetId : null
  }

  getInstanceSemanticEntryId(instanceId: string): string | null {
    const semanticEntryId = this.instances.get(instanceId)?.userData.semanticEntryId
    return typeof semanticEntryId === 'string' ? semanticEntryId : null
  }

  /** Assign a transient runtime owner without changing persistent world state. */
  setInstanceRuntimeOwnerId(instanceId: string, ownerId: string): boolean {
    if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 512) {
      throw new TypeError('External asset runtime owner ID must be a non-empty string')
    }
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    instance.userData.runtimeOwnerId = ownerId
    return true
  }

  getInstanceRuntimeOwnerId(instanceId: string): string | null {
    const ownerId = this.instances.get(instanceId)?.userData.runtimeOwnerId
    return typeof ownerId === 'string' ? ownerId : null
  }

  getInstanceWorldPosition(instanceId: string) {
    const position = this.instances.get(instanceId)?.userData.worldPosition as
      { x: number; y: number; z: number } | undefined
    return position ? { ...position } : null
  }

  /** Set an instance's absolute position while respecting the current origin rebase. */
  setInstanceWorldTransform(
    instanceId: string,
    options: {
      position: { x: number; y: number; z: number }
      scale?: number
      rotationY?: number
    },
  ) {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    const { x, y, z } = options.position
    if (![x, y, z].every(Number.isFinite) ||
        (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale <= 0)) ||
        (options.rotationY !== undefined && !Number.isFinite(options.rotationY))) {
      throw new TypeError('External asset world transform must contain finite coordinates and valid scale/rotation')
    }

    instance.userData.worldPosition = { x, y, z }
    instance.position.set(x - this.worldAnchor.x, y - this.worldAnchor.y, z - this.worldAnchor.z)
    if (options.scale !== undefined) instance.scale.setScalar(options.scale)
    if (options.rotationY !== undefined) instance.rotation.y = options.rotationY
    if (instance.userData.persistentWorldAssetPlacement !== false) this.onPlacementsChanged?.()
    return true
  }

  private cloneMaterialWithOwnedTextures<T extends THREE.Material>(
    material: T,
    ownedMaterials: Set<THREE.Material>,
    ownedTextures: Set<THREE.Texture>,
  ): T {
    const clone = material.clone() as T
    ownedMaterials.add(clone)
    const clonedTextures = new Map<THREE.Texture, THREE.Texture>()
    const cloneValue = (value: unknown): unknown => {
      if (value instanceof THREE.Texture) {
        let texture = clonedTextures.get(value)
        if (!texture) {
          texture = value.clone()
          clonedTextures.set(value, texture)
          ownedTextures.add(texture)
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
    const failures: unknown[] = []
    const attempt = (label: string, dispose: () => void) => {
      try {
        dispose()
      } catch (error) {
        failures.push(new Error(`${label} disposal failed: ${String(error)}`, { cause: error }))
      }
    }
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

    try {
      object.traverse(node => {
        try {
          // GLTF renderables include Mesh, Points and Line; all may own geometry
          // and materials that must be released when an asset or placement leaves.
          const renderable = node as THREE.Object3D & {
            geometry?: THREE.BufferGeometry
            material?: THREE.Material | THREE.Material[]
          }
          if (renderable.geometry instanceof THREE.BufferGeometry) {
            geometries.add(renderable.geometry)
          }
          const skinnedMesh = node as THREE.SkinnedMesh
          if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton) {
            skeletons.add(skinnedMesh.skeleton)
          }
          const instancedMesh = node as THREE.InstancedMesh
          if (instancedMesh.isInstancedMesh) instancedMeshes.add(instancedMesh)
          const nodeMaterials = Array.isArray(renderable.material)
            ? renderable.material
            : renderable.material instanceof THREE.Material ? [renderable.material] : []
          nodeMaterials.forEach(material => {
            materials.add(material)
            Object.values(material).forEach(value => collectTextures(value))
          })
        } catch (error) {
          failures.push(new Error(`Object resource collection failed: ${String(error)}`, { cause: error }))
        }
      })
    } catch (error) {
      failures.push(new Error(`Object resource traversal failed: ${String(error)}`, { cause: error }))
    }

    geometries.forEach(geometry => attempt('Geometry', () => geometry.dispose()))
    materials.forEach(material => attempt('Material', () => material.dispose()))
    textures.forEach(texture => attempt('Texture', () => texture.dispose()))
    skeletons.forEach(skeleton => attempt('Skeleton', () => skeleton.dispose()))
    instancedMeshes.forEach(mesh => attempt('Instanced mesh', () => mesh.dispose()))

    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more GLTF object resources failed to dispose')
    }
  }

  getInstanceAnimationNames(instanceId: string) {
    const instance = this.instances.get(instanceId)
    if (!instance) return []
    const sourceId = instance.userData.runtimeAssetSourceId as string | undefined
    const source = sourceId ? this.assets.get(sourceId) : undefined
    return source?.animations.map(clip => clip.name) ?? []
  }

  setInstanceAnimationState(
    instanceId: string,
    stateName: string,
    options: InstanceAnimationOptions = {},
  ) {
    return this.playInstanceAnimation(instanceId, stateName, options)
  }

  playInstanceAnimation(
    instanceId: string,
    clipName?: string,
    options: InstanceAnimationOptions = {},
  ) {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    const sourceId = instance.userData.runtimeAssetSourceId as string | undefined
    const source = sourceId ? this.assets.get(sourceId) : undefined
    if (!source?.animations.length) return false
    const clip = clipName
      ? source.animations.find(candidate => candidate.name === clipName)
      : source.animations[0]
    if (!clip) return false

    const fadeDuration = Number.isFinite(options.fadeDuration)
      ? Math.max(0, options.fadeDuration ?? 0)
      : 0
    const mixer = this.instanceMixers.get(instanceId) ?? new THREE.AnimationMixer(instance)
    const previousAction = this.instanceActions.get(instanceId)
    const action = mixer.clipAction(clip)
    action.stopFading()
    action.stopWarping()
    action.reset()
    action.enabled = true
    action.setEffectiveTimeScale(Number.isFinite(options.timeScale) ? options.timeScale ?? 1 : 1)
    action.setEffectiveWeight(1)
    action.setLoop(
      options.loopOnce ? THREE.LoopOnce : THREE.LoopRepeat,
      options.loopOnce
        ? 1
        : (Number.isFinite(options.repetitions) ? Math.max(1, Math.floor(options.repetitions ?? 1)) : Infinity),
    )
    action.clampWhenFinished = options.clampWhenFinished ?? Boolean(options.loopOnce)
    action.play()

    if (previousAction && previousAction !== action) {
      previousAction.stopFading()
      previousAction.stopWarping()
      if (fadeDuration > 0) {
        previousAction.crossFadeTo(action, fadeDuration, false)
        const pending = (this.pendingAnimationStops.get(instanceId) ?? [])
          .filter(transition => transition.action !== action)
        pending.push({ action: previousAction, remainingSeconds: fadeDuration })
        this.pendingAnimationStops.set(instanceId, pending)
      } else {
        previousAction.stop()
      }
    } else {
      const pending = (this.pendingAnimationStops.get(instanceId) ?? [])
        .filter(transition => transition.action !== action)
      if (pending.length) this.pendingAnimationStops.set(instanceId, pending)
      else this.pendingAnimationStops.delete(instanceId)
    }
    this.instanceMixers.set(instanceId, mixer)
    this.instanceActions.set(instanceId, action)
    return true
  }

  setSemanticAnimationState(
    semanticEntryId: string,
    stateName: string,
    options: InstanceAnimationOptions = {},
  ) {
    let matched = 0
    let started = 0
    for (const [instanceId, instance] of this.instances) {
      if (instance.userData.semanticEntryId !== semanticEntryId) continue
      matched += 1
      if (this.setInstanceAnimationState(instanceId, stateName, options)) started += 1
    }
    return { matched, started }
  }

  stopSemanticAnimation(semanticEntryId: string) {
    let stopped = 0
    for (const [instanceId, instance] of this.instances) {
      if (instance.userData.semanticEntryId !== semanticEntryId) continue
      if (this.stopInstanceAnimation(instanceId)) stopped += 1
    }
    return stopped
  }

  stopInstanceAnimation(instanceId: string) {
    const mixer = this.instanceMixers.get(instanceId)
    if (!mixer) return false
    const instance = this.instances.get(instanceId)
    mixer.stopAllAction()
    if (instance) mixer.uncacheRoot(instance)
    this.instanceMixers.delete(instanceId)
    this.instanceActions.delete(instanceId)
    this.pendingAnimationStops.delete(instanceId)
    this.animationAccumulators.delete(instanceId)
    return true
  }

  updateAnimations(deltaSeconds: number, camera?: THREE.Camera) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0
    const cameraPosition = camera ? camera.getWorldPosition(new THREE.Vector3()) : null
    let updated = 0

    for (const [instanceId, mixer] of this.instanceMixers) {
      const instance = this.instances.get(instanceId)
      if (!instance) continue
      if (cameraPosition && !instance.visible) {
        this.animationAccumulators.set(instanceId, 0)
        continue
      }

      let updateInterval = 0
      if (cameraPosition) {
        const instancePosition = instance.getWorldPosition(new THREE.Vector3())
        const distance = instancePosition.distanceTo(cameraPosition)
        if (distance > 650) {
          // Outside the external-asset visibility range: freeze without accumulating catch-up time.
          this.animationAccumulators.set(instanceId, 0)
          continue
        }
        if (distance > 300) updateInterval = 1 / 15
        else if (distance > 80) updateInterval = 1 / 30
      }

      const accumulated = (this.animationAccumulators.get(instanceId) ?? 0) + deltaSeconds
      if (updateInterval > 0 && accumulated < updateInterval) {
        this.animationAccumulators.set(instanceId, accumulated)
        continue
      }

      const appliedDelta = accumulated
      this.animationAccumulators.set(instanceId, 0)
      mixer.update(appliedDelta)
      updated += 1

      const pending = this.pendingAnimationStops.get(instanceId)
      if (pending?.length) {
        const remaining = pending.filter(transition => {
          transition.remainingSeconds -= appliedDelta
          if (transition.remainingSeconds <= 0) {
            transition.action.stop()
            return false
          }
          return true
        })
        if (remaining.length) this.pendingAnimationStops.set(instanceId, remaining)
        else this.pendingAnimationStops.delete(instanceId)
      }
    }
    return updated
  }

  removeInstance(instanceId: string) {
    const instance = this.instances.get(instanceId)
    if (!instance) return false

    const failures: unknown[] = []
    const attempt = (label: string, cleanup: () => void) => {
      try {
        cleanup()
      } catch (error) {
        failures.push(new Error(`${label} failed: ${String(error)}`, { cause: error }))
      }
    }

    const mixer = this.instanceMixers.get(instanceId)
    if (mixer) {
      attempt(`Instance ${instanceId} animation stop`, () => mixer.stopAllAction())
      attempt(`Instance ${instanceId} animation uncache`, () => mixer.uncacheRoot(instance))
    }

    // Release every animation index even when the mixer or disposer throws.
    this.instanceMixers.delete(instanceId)
    this.instanceActions.delete(instanceId)
    this.pendingAnimationStops.delete(instanceId)
    this.animationAccumulators.delete(instanceId)

    attempt(`Instance ${instanceId} scene removal`, () => this.scene.remove(instance))
    attempt(`Instance ${instanceId} resource disposal`, () => this.disposeObject(instance))
    const isPersistent = instance.userData.persistentWorldAssetPlacement !== false
    this.instances.delete(instanceId)
    if (isPersistent && this.onPlacementsChanged) {
      attempt(`Instance ${instanceId} placement notification`, () => this.onPlacementsChanged?.())
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, `Instance ${instanceId} was removed with one or more cleanup failures`)
    }
    return true
  }

  /**
   * Scatter an idempotent semantic batch and report which placements were
   * published by this invocation. Existing deterministic IDs are returned in
   * `instances`, but are never reported as newly created.
   */
  scatterSemanticWithResult(
    semanticEntryId: string,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    count: number,
    seed = 1,
    scale = 1,
  ): { instances: THREE.Object3D[]; createdInstanceIds: string[] } {
    if (![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ, count, seed, scale].every(Number.isFinite)) {
      throw new TypeError('External asset scatter bounds, count, seed and scale must be finite')
    }
    if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) {
      throw new RangeError('External asset scatter bounds must be ordered from minimum to maximum')
    }
    if (!this.semanticSources.has(semanticEntryId)) {
      return { instances: [], createdInstanceIds: [] }
    }

    const placed: THREE.Object3D[] = []
    const createdInstanceIds: string[] = []
    let state = seed >>> 0
    const random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0
      return state / 4294967296
    }
    const total = Math.max(0, Math.floor(count))
    for (let i = 0; i < total; i++) {
      const x = bounds.minX + random() * (bounds.maxX - bounds.minX)
      const z = bounds.minZ + random() * (bounds.maxZ - bounds.minZ)
      const instanceId = semanticEntryId + ':instance:' + seed + ':' + i
      const existedBefore = this.instances.has(instanceId)
      try {
        const instance = this.placeInstance(
          instanceId,
          semanticEntryId,
          { x, y: 0, z, scale: scale * (0.85 + random() * 0.3), rotationY: random() * Math.PI * 2 },
        )
        if (instance) {
          placed.push(instance)
          if (!existedBefore && this.instances.get(instanceId) === instance) {
            createdInstanceIds.push(instanceId)
          }
        }
      } catch (error) {
        // placeInstance can fail after publishing an instance if its persistence
        // notification throws. Include that committed object in the rollback.
        const partiallyPublished = this.instances.get(instanceId)
        if (!existedBefore && partiallyPublished && !createdInstanceIds.includes(instanceId)) {
          createdInstanceIds.push(instanceId)
        }

        const cleanupFailures: unknown[] = []
        for (const createdId of createdInstanceIds.reverse()) {
          if (!this.instances.has(createdId)) continue
          try {
            this.removeInstance(createdId)
          } catch (cleanupError) {
            cleanupFailures.push(new Error(
              'Scatter rollback failed for instance ' + createdId,
              { cause: cleanupError },
            ))
          }
        }
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [error, ...cleanupFailures],
            'External asset scatter failed and one or more created instances could not be rolled back',
          )
        }
        throw error
      }
    }
    return { instances: placed, createdInstanceIds }
  }

  /** Backwards-compatible object-only API for callers that do not ground a batch. */
  scatterSemantic(
    semanticEntryId: string,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    count: number,
    seed = 1,
    scale = 1,
  ): THREE.Object3D[] {
    return this.scatterSemanticWithResult(semanticEntryId, bounds, count, seed, scale).instances
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

    const failures: unknown[] = []
    const attempt = (label: string, cleanup: () => void) => {
      try {
        cleanup()
      } catch (error) {
        failures.push(new Error(`${label} failed: ${String(error)}`, { cause: error }))
      }
    }

    // Instances own cloned GPU resources, but remain semantically dependent on
    // their source asset. A broken instance disposer must not prevent remaining
    // placements or the source asset from being released.
    for (const [instanceId, instance] of [...this.instances]) {
      if (instance.userData.runtimeAssetSourceId === id) {
        attempt(`Asset ${id} dependent instance ${instanceId} removal`, () => this.removeInstance(instanceId))
      }
    }

    attempt(`Asset ${id} scene removal`, () => this.scene.remove(asset.object))
    this.assets.delete(id)
    if (asset.semanticEntryId && this.semanticSources.get(asset.semanticEntryId) === asset) {
      attempt(`Asset ${id} semantic source refresh`, () => this.refreshSemanticSource(asset.semanticEntryId!))
    }
    attempt(`Asset ${id} resource disposal`, () => this.disposeObject(asset.object))

    if (failures.length > 0) {
      throw new AggregateError(failures, `Asset ${id} was removed with one or more cleanup failures`)
    }
    return true
  }

  clear() {
    // Invalidate outstanding GLTF callbacks before releasing the current world.
    // Cleanup is best-effort: a broken disposer or callback for one object must
    // not prevent the remaining scene objects and GPU resources from release.
    this.generation += 1
    const failures: unknown[] = []
    const attempt = (label: string, cleanup: () => void) => {
      try {
        cleanup()
      } catch (error) {
        failures.push(new Error(`${label} failed: ${String(error)}`, { cause: error }))
      }
    }

    for (const [id, cancel] of [...this.pendingRejectors]) {
      attempt(`Pending asset load ${id} cancellation`, () => cancel(new Error('Asset load invalidated by world replacement')))
    }
    this.pendingRejectors.clear()
    this.loading.clear()
    this.loadingRequests.clear()

    for (const [instanceId, instance] of [...this.instances]) {
      const mixer = this.instanceMixers.get(instanceId)
      if (mixer) {
        attempt(`Instance ${instanceId} animation stop`, () => mixer.stopAllAction())
        attempt(`Instance ${instanceId} animation uncache`, () => mixer.uncacheRoot(instance))
      }
      attempt(`Instance ${instanceId} scene removal`, () => this.scene.remove(instance))
      attempt(`Instance ${instanceId} resource disposal`, () => this.disposeObject(instance))
      const isPersistent = instance.userData.persistentWorldAssetPlacement !== false
      this.instances.delete(instanceId)
      if (isPersistent && this.onPlacementsChanged) {
        attempt(`Instance ${instanceId} placement notification`, () => this.onPlacementsChanged?.())
      }
    }

    // Clear every animation index even when a mixer operation failed above.
    this.instanceMixers.clear()
    this.instanceActions.clear()
    this.pendingAnimationStops.clear()
    this.animationAccumulators.clear()

    for (const [id, asset] of [...this.assets]) {
      attempt(`Asset ${id} scene removal`, () => this.scene.remove(asset.object))
      this.assets.delete(id)
      attempt(`Asset ${id} resource disposal`, () => this.disposeObject(asset.object))
    }
    this.semanticSources.clear()

    if (failures.length > 0) {
      throw new AggregateError(failures, 'World asset runtime was cleared with one or more resource cleanup failures')
    }
  }

  rebase(worldAnchor: { x: number; y?: number; z: number }) {
    this.worldAnchor = { x: worldAnchor.x, y: worldAnchor.y ?? 0, z: worldAnchor.z }
    for (const asset of this.assets.values()) {
      const world = asset.object.userData.worldPosition as { x: number; y: number; z: number } | undefined
      if (world) asset.object.position.set(world.x - this.worldAnchor.x, world.y - this.worldAnchor.y, world.z - this.worldAnchor.z)
    }
    for (const instance of this.instances.values()) {
      const world = instance.userData.worldPosition as { x: number; y: number; z: number } | undefined
      if (world) instance.position.set(world.x - this.worldAnchor.x, world.y - this.worldAnchor.y, world.z - this.worldAnchor.z)
    }
  }

  updateVisibility(camera: THREE.Camera, maxDistance = 650, maxVisible = 500) {
    const cameraPosition = new THREE.Vector3()
    camera.getWorldPosition(cameraPosition)
    // Loaded source assets are hidden templates; only placed instances are render candidates.
    const candidates = [...this.instances.values()]
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
      instances: this.instances.size,
      animatedInstances: this.instanceMixers.size,
      visibleInstances: [...this.instances.values()].filter(instance => instance.visible).length,
    }
  }
}


/**
 * Ground a scatter batch against the active world surface as one transaction.
 *
 * `createdInstanceIds` is scoped to this scatter invocation. If terrain sampling
 * or transform publication fails, only those new instances are removed; older
 * deterministic placements are restored to their pre-grounding world transforms.
 */
export function groundWorldAssetInstances(
  runtime: Pick<WorldAssetRuntime,
    'rebase' | 'getInstanceWorldPosition' | 'setInstanceWorldTransform' | 'removeInstance'>,
  instances: THREE.Object3D[],
  createdInstanceIds: readonly string[],
  worldAnchor: { x: number; y?: number; z: number },
  sampleTerrainHeight: (x: number, z: number) => number,
): void {
  const createdIds = [...new Set(createdInstanceIds)]
  const createdSet = new Set(createdIds)
  const snapshots: Array<{
    instanceId: string
    position: { x: number; y: number; z: number }
    scale: number
    rotationY: number
  }> = []
  const updatedExistingIds = new Set<string>()

  try {
    runtime.rebase(worldAnchor)

    // Validate and snapshot the entire batch before changing any placement.
    const seenIds = new Set<string>()
    for (const instance of instances) {
      const instanceId = instance.userData.runtimeAssetInstanceId
      if (typeof instanceId !== 'string' || !instanceId.trim()) {
        throw new Error('External asset instance is missing runtime identity during terrain placement')
      }
      if (seenIds.has(instanceId)) {
        throw new Error('External asset grounding batch contains duplicate instance ID ' + instanceId)
      }
      seenIds.add(instanceId)
      const position = runtime.getInstanceWorldPosition(instanceId)
      if (!position) {
        throw new Error('External asset instance ' + instanceId + ' is missing its absolute world position')
      }
      snapshots.push({
        instanceId,
        position,
        scale: instance.scale.x,
        rotationY: instance.rotation.y,
      })
    }

    for (const snapshot of snapshots) {
      const worldY = sampleTerrainHeight(snapshot.position.x, snapshot.position.z)
      if (!Number.isFinite(worldY)) {
        throw new RangeError('Terrain returned a non-finite elevation for external asset instance ' + snapshot.instanceId)
      }
      // setInstanceWorldTransform can throw from its persistence callback after
      // committing the transform, so record existing IDs before invoking it.
      if (!createdSet.has(snapshot.instanceId)) updatedExistingIds.add(snapshot.instanceId)
      const updated = runtime.setInstanceWorldTransform(snapshot.instanceId, {
        position: { x: snapshot.position.x, y: worldY, z: snapshot.position.z },
      })
      if (!updated) {
        throw new Error('External asset instance ' + snapshot.instanceId + ' disappeared during terrain placement')
      }
    }
  } catch (error) {
    const cleanupFailures: unknown[] = []

    // Restore older placements first; never delete them just because a later
    // terrain sample failed while processing the current scatter operation.
    for (const snapshot of [...snapshots].reverse()) {
      if (createdSet.has(snapshot.instanceId) || !updatedExistingIds.has(snapshot.instanceId)) continue
      try {
        runtime.setInstanceWorldTransform(snapshot.instanceId, {
          position: snapshot.position,
          scale: snapshot.scale,
          rotationY: snapshot.rotationY,
        })
      } catch (cleanupError) {
        cleanupFailures.push(new Error(
          'Terrain grounding restore failed for pre-existing external asset instance ' + snapshot.instanceId,
          { cause: cleanupError },
        ))
      }
    }

    // Roll back only the instances created by this exact scatter invocation.
    for (const instanceId of [...createdIds].reverse()) {
      try {
        runtime.removeInstance(instanceId)
      } catch (cleanupError) {
        cleanupFailures.push(new Error(
          'Terrain grounding rollback failed for new external asset instance ' + instanceId,
          { cause: cleanupError },
        ))
      }
    }

    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        'External asset terrain grounding failed and one or more placements could not be restored',
      )
    }
    throw error
  }
}
