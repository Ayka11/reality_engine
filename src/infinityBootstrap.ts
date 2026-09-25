import { InfiniteWorldRenderer } from './render/InfiniteWorldRenderer'
import type { WorldObjectKind } from './infinity/WorldObject'

const canvas = document.getElementById('c3d') as HTMLCanvasElement | null

if (canvas) {
  const world = new InfiniteWorldRenderer(canvas)
  ;(window as any).infiniteWorld = world

  ;(window as any).infinityPlaceObject = (kind: WorldObjectKind, x: number, z: number, y?: number, scale = 1) =>
    world.place(kind, x, z, y, scale)

  ;(window as any).infinityEraseObject = (x: number, y: number, z: number, radius = 2) =>
    world.erase(x, y, z, radius)

  ;(window as any).infinityScatter = (kind: WorldObjectKind, x0: number, z0: number, x1: number, z1: number, density = 0.15) =>
    world.scatter(kind, x0, z0, x1, z1, density)

  ;(window as any).infinitySetEnabled = (enabled: boolean) => world.setEnabled(enabled)
  ;(window as any).infinitySetFlyMode = (enabled: boolean) => world.setFlyMode(enabled)

  ;(window as any).infinityStats = () => ({
    loadedChunks: world.getLoadedChunkCount(),
    objects: world.getObjectCount(),
    camera: {
      x: world.camera.position.x,
      y: world.camera.position.y,
      z: world.camera.position.z,
      worldX: world.worldCoordinates.x,
      worldY: world.worldCoordinates.y,
      worldZ: world.worldCoordinates.z,
    },
  })

  const resize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    world.resize(Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight))
  }

  window.addEventListener('resize', resize)
  resize()

  let last = performance.now()
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    world.render(dt)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  console.log('[Reality Engine] Infinite World renderer ready — browser-side streaming terrain + objects')
}
