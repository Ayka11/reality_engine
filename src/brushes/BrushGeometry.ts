import type { BrushFalloff, BrushShape, BrushVerticalExtent } from "./BrushContract";
import { brushFalloffWeight } from "./BrushMath";

export interface BrushGeometry {
  shape: BrushShape;
  falloff: BrushFalloff;
  verticalExtent: BrushVerticalExtent;
  radius: number;
  shellThickness?: number;
  layerThickness?: number;
}

export interface BrushPoint { x: number; y: number; z: number; }
export interface BrushGeometryContext { center: BrushPoint; point: BrushPoint; geometry: BrushGeometry; selectedLayerY?: number; }

export function brushGeometryWeight(context: BrushGeometryContext): number {
  const { center, point, geometry, selectedLayerY } = context;
  const { radius, shape, falloff, verticalExtent } = geometry;
  const values = [center.x, center.y, center.z, point.x, point.y, point.z, radius];
  if (!values.every(Number.isFinite) || radius <= 0) return 0;
  const dx = point.x - center.x, dy = point.y - center.y, dz = point.z - center.z;
  const horizontalDistance = Math.hypot(dx, dz), distance3D = Math.hypot(dx, dy, dz);
  if (shape === "layer") {
    if (selectedLayerY === undefined || !Number.isFinite(selectedLayerY)) return 0;
    const thickness = Math.max(0, geometry.layerThickness ?? 0.5);
    if (Math.abs(point.y - selectedLayerY) > thickness) return 0;
    return brushFalloffWeight(horizontalDistance, radius, falloff);
  }
  if (shape === "column") {
    if (horizontalDistance > radius) return 0;
    if (verticalExtent === "selected-layer") {
      if (selectedLayerY === undefined || !Number.isFinite(selectedLayerY)) return 0;
      const thickness = Math.max(0, geometry.layerThickness ?? 0.5);
      if (Math.abs(point.y - selectedLayerY) > thickness) return 0;
    } else if (verticalExtent === "bounded-volume" && Math.abs(dy) > radius) return 0;
    return brushFalloffWeight(horizontalDistance, radius, falloff);
  }
  if (shape === "sphere") return brushFalloffWeight(distance3D, radius, falloff);
  if (shape === "shell") {
    const thickness = Math.max(0, geometry.shellThickness ?? 1);
    const shellDistance = Math.abs(distance3D - radius);
    if (shellDistance > thickness) return 0;
    const normalizedDistance = thickness === 0 ? 0 : shellDistance / thickness;
    return brushFalloffWeight(normalizedDistance, 1, falloff);
  }
  return 0;
}
