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
  panel.id = 'infiniteWorldTools'
  panel.style.cssText = 'position:fixed;top:112px;right:248px;z-index:5000;width:270px;max-height:calc(100vh - 170px);overflow:auto;padding:10px;background:rgba(12,18,28,.94);color:#fff;font:11px system-ui;border:1px solid rgba(124,111,205,.55);border-radius:8px'
  panel.innerHTML = '<b style="color:#c8c3ff">🌍 Infinite World Tools</b><div id="iwStatus" style="font-size:9px;color:#8e8aa8;margin:5px 0 7px">Streaming terrain · browser CPU</div>'
  const group = (title: string) => {
    const h = document.createElement('div')
    h.textContent = title
    h.style.cssText = 'margin:8px 0 4px;color:#8e8aa8;font-size:9px;text-transform:uppercase'
    panel.appendChild(h)
  }
  const row = () => {
    const r = document.createElement('div')
    r.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px'
    panel.appendChild(r)
    return r
  }
  const add = (parent: HTMLElement, label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'cursor:pointer;padding:5px 4px;border-radius:5px;border:1px solid #39405a;background:#202938;color:#fff;font-size:9px'
    b.onclick = () => { fn(); const s=document.getElementById('iwStatus'); if(s)s.textContent=label }
    parent.appendChild(b)
  }
  group('Camera')
  { const r=row(); add(r,'Orbit',()=>world.setFlyMode(false)); add(r,'Fly',()=>world.setFlyMode(true)); add(r,'Reset',()=>world.resetCameraView()); add(r,'Top',()=>world.setCameraPreset('top')); add(r,'Front',()=>world.setCameraPreset('front')); add(r,'Orbit View',()=>world.setCameraPreset('orbit')) }
  group('Objects')
  { const r=row(); add(r,'Select',()=>world.setObjectTool('select')); add(r,'Tree',()=>{world.setObjectKind('tree');world.setObjectTool('place')}); add(r,'Rock',()=>{world.setObjectKind('rock');world.setObjectTool('place')}); add(r,'Building',()=>{world.setObjectKind('building');world.setObjectTool('place')}); add(r,'Erase',()=>world.setObjectTool('erase')); add(r,'Move',()=>world.setTransformMode('translate')); add(r,'Rotate',()=>world.setTransformMode('rotate')); add(r,'Scale',()=>world.setTransformMode('scale')) }
  group('Persistence')
  { const r=row(); add(r,'Save',()=>world.saveWorld()); add(r,'Load',()=>world.loadWorld()); add(r,'Clear',()=>world.clearSavedWorld()); add(r,'Undo',()=>world.undo()); add(r,'Redo',()=>world.redo()); add(r,'Snap 1m',()=>world.setSnapToGrid(1)); add(r,'Snap 5m',()=>world.setSnapToGrid(5)) }
  group('Generation / Analysis')
  { const r=row(); add(r,'Settlement',()=>world.generateSettlement(world.worldCoordinates.x,world.worldCoordinates.z,70,10)); add(r,'Settlement V2',()=>world.generateSettlementV2(world.worldCoordinates.x,world.worldCoordinates.z,120,4)); add(r,'City Plan',()=>world.generateCityPlan(world.worldCoordinates.x,world.worldCoordinates.z,180,31)); add(r,'River Network',()=>world.generateRiverNetwork(world.worldCoordinates.x,world.worldCoordinates.z,220,41)); add(r,'Suitability',()=>world.setAnalyticalOverlay('suitability')); add(r,'Flood Map',()=>world.setAnalyticalOverlay('flood')); add(r,'Slope Map',()=>world.setAnalyticalOverlay('slope')); add(r,'Clear Map',()=>world.setAnalyticalOverlay(null)); add(r,'Smart Route',()=>world.buildSmartRoute(world.worldCoordinates.x-120,world.worldCoordinates.z-120,world.worldCoordinates.x+120,world.worldCoordinates.z+120,12)) }
  group('Display')
  { const r=row(); add(r,'Field',()=>world.setMaterialMode('field')); add(r,'PBR',()=>world.setMaterialMode('material')); add(r,'Height',()=>world.setMaterialMode('height')); add(r,'Day',()=>world.setTimeOfDay(12)); add(r,'Dusk',()=>world.setTimeOfDay(18)); add(r,'Night',()=>world.setTimeOfDay(0)); add(r,'Fog+',()=>world.setFogDensity(0.04)); add(r,'Fog-',()=>world.setFogDensity(0.005)) }
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
