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
          this.assets.set(id, asset)
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

  remove(id: string) {
    const asset = this.assets.get(id)
    if (!asset) return false
    this.scene.remove(asset.object)
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
    for (const id of [...this.assets.keys()]) this.remove(id)
  }

  stats() {
    return {
      loaded: this.assets.size,
      ids: [...this.assets.keys()],
    }
  }
}
