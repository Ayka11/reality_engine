import * as THREE from 'three'

/**
 * Detach a collection of scene roots and release every uniquely-owned GPU
 * resource. Cleanup failures are returned to the caller so a world restore can
 * finish publishing the replacement state before reporting degraded cleanup.
 */
export function detachAndDisposeObjectGroups(
  scene: THREE.Scene,
  groups: Iterable<THREE.Object3D>,
  label = 'Scene object',
): unknown[] {
  const failures: unknown[] = []
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const skeletons = new Set<THREE.Skeleton>()
  const instancedMeshes = new Set<THREE.InstancedMesh>()
  const seenTextureContainers = new Set<object>()

  const attempt = (operation: string, cleanup: () => void) => {
    try {
      cleanup()
    } catch (error) {
      failures.push(new Error(`${operation} failed: ${String(error)}`, { cause: error }))
    }
  }

  const collectTextures = (value: unknown): void => {
    if (value instanceof THREE.Texture) {
      textures.add(value)
      return
    }
    if (!value || typeof value !== 'object' || seenTextureContainers.has(value as object)) return
    seenTextureContainers.add(value as object)
    if (Array.isArray(value)) {
      value.forEach(collectTextures)
    } else if (Object.getPrototypeOf(value) === Object.prototype) {
      Object.values(value).forEach(collectTextures)
    }
  }

  let index = 0
  for (const group of groups) {
    const current = `${label} ${index++}`
    attempt(`${current} scene removal`, () => scene.remove(group))
    attempt(`${current} resource traversal`, () => {
      group.traverse(node => {
        try {
          // Meshes, lines, points and sprites all own disposable render resources.
          const renderable = node as THREE.Object3D & {
            geometry?: THREE.BufferGeometry
            material?: THREE.Material | THREE.Material[]
          }
          if (renderable.geometry instanceof THREE.BufferGeometry) {
            geometries.add(renderable.geometry)
          }
          const skinnedMesh = node as THREE.SkinnedMesh
          if (skinnedMesh.isSkinnedMesh && skinnedMesh.skeleton) skeletons.add(skinnedMesh.skeleton)
          const instancedMesh = node as THREE.InstancedMesh
          if (instancedMesh.isInstancedMesh) instancedMeshes.add(instancedMesh)
          const nodeMaterials = Array.isArray(renderable.material)
            ? renderable.material
            : renderable.material ? [renderable.material] : []
          nodeMaterials.forEach(material => {
            if (!(material instanceof THREE.Material)) return
            materials.add(material)
            Object.values(material).forEach(collectTextures)
          })
        } catch (error) {
          failures.push(new Error(`${current} resource collection failed: ${String(error)}`, { cause: error }))
        }
      })
    })
  }

  geometries.forEach(geometry => attempt(`${label} geometry disposal`, () => geometry.dispose()))
  materials.forEach(material => attempt(`${label} material disposal`, () => material.dispose()))
  textures.forEach(texture => attempt(`${label} texture disposal`, () => texture.dispose()))
  skeletons.forEach(skeleton => attempt(`${label} skeleton disposal`, () => skeleton.dispose()))
  instancedMeshes.forEach(mesh => attempt(`${label} instanced mesh disposal`, () => mesh.dispose()))

  return failures
}
