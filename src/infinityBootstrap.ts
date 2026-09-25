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
  ;(window as any).infinityPickAtScreen = (clientX: number, clientY: number) => world.pickAtScreen(clientX, clientY)
  ;(window as any).infinityPlaceAtScreen = (kind: WorldObjectKind, clientX: number, clientY: number, scale = 1) => world.placeAtScreen(kind, clientX, clientY, scale)
  ;(window as any).infinityEraseAtScreen = (clientX: number, clientY: number, radius = 2) => world.eraseAtScreen(clientX, clientY, radius)
  ;(window as any).infinitySelectAtScreen = (clientX: number, clientY: number) => world.selectAtScreen(clientX, clientY)
  ;(window as any).infinitySelectedObject = () => world.getSelectedObject()
  ;(window as any).infinityTransformSelected = (patch: { x?: number; y?: number; z?: number; rotationY?: number; scale?: number }) => world.transformSelected(patch)
  ;(window as any).infinityDeleteSelected = () => world.deleteSelected()
  ;(window as any).infinitySetObjectTool = (tool: 'select' | 'place' | 'erase') => world.setObjectTool(tool)
  ;(window as any).infinitySetObjectKind = (kind: WorldObjectKind) => world.setObjectKind(kind)
  ;(window as any).infinityGetObjectTool = () => world.getObjectTool()
  ;(window as any).infinityGetObjectKind = () => world.getObjectKind()
  ;(window as any).infinitySaveWorld = () => world.saveWorld()
  ;(window as any).infinityLoadWorld = () => world.loadWorld()
  ;(window as any).infinityClearSavedWorld = () => world.clearSavedWorld()
  ;(window as any).infinityUndo = () => world.undo()
  ;(window as any).infinityRedo = () => world.redo()
  ;(window as any).infinityEditHistoryState = () => world.getEditHistoryState()
  ;(window as any).infinitySetTransformMode = (mode: 'translate' | 'rotate' | 'scale') => world.setTransformMode(mode)
  ;(window as any).infinityGetTransformMode = () => world.getTransformMode()
  ;(window as any).infinitySetSnapGrid = (size: number) => world.setSnapToGrid(size)
  ;(window as any).infinityGetSnapGrid = () => world.getSnapToGrid()
  ;(window as any).infinitySnapWorld = (x: number, y: number, z: number, kind: WorldObjectKind) => world.snapWorld(x, y, z, kind)
  ;(window as any).infinityBuildRoad = (x0: number, z0: number, x1: number, z1: number, spacing = 12) => world.buildRoad(x0, z0, x1, z1, spacing)
  ;(window as any).infinityGenerateSettlement = (x: number, z: number, radius = 80, count = 12) => world.generateSettlement(x, z, radius, count)
  ;(window as any).infinityStorageKey = () => world.getStorageKey()
  ;(window as any).infinityHandlePointer = (clientX: number, clientY: number) => world.handlePointer(clientX, clientY)

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

  const panel = document.createElement('div')
  panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:20;padding:10px;background:rgba(12,18,28,.86);color:#fff;font:12px system-ui;border:1px solid rgba(255,255,255,.18);border-radius:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:420px'
  panel.innerHTML = '<strong>World Builder</strong>'
  const addButton = (label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'cursor:pointer;padding:4px 7px;border-radius:5px;border:1px solid #667;background:#202938;color:#fff'
    b.onclick = onClick
    panel.appendChild(b)
  }
  addButton('Select', () => world.setObjectTool('select'))
  addButton('Place Tree', () => { world.setObjectKind('tree'); world.setObjectTool('place') })
  addButton('Place Rock', () => { world.setObjectKind('rock'); world.setObjectTool('place') })
  addButton('Place Building', () => { world.setObjectKind('building'); world.setObjectTool('place') })
  addButton('Erase', () => world.setObjectTool('erase'))
  addButton('Save', () => world.saveWorld())
  addButton('Load', () => world.loadWorld())
  addButton('Clear Saved', () => world.clearSavedWorld())
  addButton('Undo', () => world.undo())
  addButton('Redo', () => world.redo())
  addButton('Move', () => world.setTransformMode('translate'))
  addButton('Rotate', () => world.setTransformMode('rotate'))
  addButton('Scale', () => world.setTransformMode('scale'))
  addButton('Snap 1m', () => world.setSnapToGrid(1))
  addButton('Snap 5m', () => world.setSnapToGrid(5))
  addButton('Test Settlement', () => world.generateSettlement(world.worldCoordinates.x, world.worldCoordinates.z, 70, 10))
  document.body.appendChild(panel)

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
