import { WorldObjectManager } from './ObjectManager'
import type { WorldObjectKind } from './WorldObject'

export type PlacementTool = 'select' | 'place' | 'erase' | 'paint' | 'measure'

export class WorldObjectTools {
  activeTool: PlacementTool = 'select'
  selectedKind: WorldObjectKind = 'custom'
  brushRadius = 1
  snap = 1

  constructor(readonly objects: WorldObjectManager) {}

  setTool(tool: PlacementTool): void { this.activeTool = tool }
  setKind(kind: WorldObjectKind): void { this.selectedKind = kind }

  place(x: number, y: number, z: number, properties: Record<string, string | number | boolean> = {}) {
    const sx = Math.round(x / this.snap) * this.snap
    const sy = Math.round(y / this.snap) * this.snap
    const sz = Math.round(z / this.snap) * this.snap
    return this.objects.add({
      kind: this.selectedKind, x: sx, y: sy, z: sz,
      rotationY: 0, scale: 1, seed: 0, properties,
    })
  }

  eraseAt(x: number, y: number, z: number, radius = this.brushRadius): WorldObjectKind[] {
    const removed: WorldObjectKind[] = []
    for (const o of this.objects.values()) {
      if (Math.hypot(o.x - x, o.y - y, o.z - z) <= radius) {
        this.objects.remove(o.id)
        removed.push(o.kind)
      }
    }
    return removed
  }
}
