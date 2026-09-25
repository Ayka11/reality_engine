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
  ;(window as any).infinityResetCamera = () => world.resetCameraView()
  ;(window as any).infinitySetCameraPreset = (preset: 'top' | 'front' | 'orbit') => world.setCameraPreset(preset)
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
  ;(window as any).infinityGenerateSettlementV2 = (x: number, z: number, radius = 120, blocks = 4) => world.generateSettlementV2(x, z, radius, blocks)
  ;(window as any).infinityAnalyzeBuildZone = (x: number, z: number, radius = 160, samples = 25) => world.analyzeBuildZone(x, z, radius, samples)
  ;(window as any).infinityAnalyzeHydrology = (x: number, z: number, radius = 220, samples = 41) => world.analyzeHydrology(x, z, radius, samples)
  ;(window as any).infinityAnalyzeWatershed = (x: number, z: number, radius = 220, samples = 41) => world.analyzeWatershed(x, z, radius, samples)
  ;(window as any).infinityBuildZoneCost = (x: number, z: number) => world.buildZoneCost(x, z)
  ;(window as any).infinityBuildAnalyticalOverlay = (x: number, z: number, radius = 160, samples = 33, mode: 'suitability' | 'flood' | 'slope' = 'suitability') => world.buildAnalyticalOverlay(x, z, radius, samples, mode)
  ;(window as any).infinitySetAnalyticalOverlay = (mode: 'suitability' | 'flood' | 'slope' | null) => world.setAnalyticalOverlay(mode)
  ;(window as any).infinityExplainBuildDecision = (x: number, z: number) => world.explainBuildDecision(x, z)
  ;(window as any).infinityGenerateRiverNetwork = (x: number, z: number, radius = 220, samples = 41) => world.generateRiverNetwork(x, z, radius, samples)
  ;(window as any).infinityTraceRiverSource = (x: number, z: number, maxSteps = 160, step = 8) => world.traceRiverSource(x, z, maxSteps, step)
  ;(window as any).infinityGenerateRiverTraces = (x: number, z: number, radius = 220, sources = 6) => world.generateRiverTraces(x, z, radius, sources)
  ;(window as any).infinityBuildRiverMeshes = (x: number, z: number, radius = 220, sources = 6, width = 5) => world.buildRiverMeshes(x, z, radius, sources, width)
  ;(window as any).infinityPlanCity = (x: number, z: number, radius = 180, samples = 31) => world.planCity(x, z, radius, samples)
  ;(window as any).infinityGenerateCityPlan = (x: number, z: number, radius = 180, samples = 31) => world.generateCityPlan(x, z, radius, samples)
  ;(window as any).infinityAnalyzeRoute = (x0: number, z0: number, x1: number, z1: number, samples = 32) => world.analyzeRoute(x0, z0, x1, z1, samples)
  ;(window as any).infinityBuildSmartRoute = (x0: number, z0: number, x1: number, z1: number, spacing = 12) => world.buildSmartRoute(x0, z0, x1, z1, spacing)
  ;(window as any).infinityOptimizeRoute = (x0: number, z0: number, x1: number, z1: number, gridSize = 12) => world.optimizeRoute(x0, z0, x1, z1, gridSize)
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
  panel.style.cssText = 'position:fixed;top:56px;left:64px;z-index:5000;padding:10px;background:rgba(12,18,28,.86);color:#fff;font:12px system-ui;border:1px solid rgba(255,255,255,.18);border-radius:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:420px'
  panel.innerHTML = '<strong>World Builder</strong>'
  const addButton = (label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'cursor:pointer;padding:4px 7px;border-radius:5px;border:1px solid #667;background:#202938;color:#fff'
    b.onclick = onClick
    panel.appendChild(b)
  }
  addButton('Orbit Camera', () => world.setFlyMode(false))
  addButton('Fly Camera', () => world.setFlyMode(true))
  addButton('Reset View', () => world.resetCameraView())
  addButton('Top View', () => world.setCameraPreset('top'))
  addButton('Front View', () => world.setCameraPreset('front'))
  addButton('Orbit View', () => world.setCameraPreset('orbit'))
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
  addButton('Settlement V2', () => world.generateSettlementV2(world.worldCoordinates.x, world.worldCoordinates.z, 120, 4))
  addButton('City Plan', () => world.generateCityPlan(world.worldCoordinates.x, world.worldCoordinates.z, 180, 31))
  addButton('River Network', () => world.generateRiverNetwork(world.worldCoordinates.x, world.worldCoordinates.z, 220, 41))
  addButton('Smart Route', () => world.buildSmartRoute(world.worldCoordinates.x - 120, world.worldCoordinates.z - 120, world.worldCoordinates.x + 120, world.worldCoordinates.z + 120, 12))
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
