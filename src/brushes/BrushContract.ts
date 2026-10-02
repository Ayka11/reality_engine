export type BrushId =
  | "volcano"
  | "forest"
  | "ocean"
  | "crystal"
  | "storm"
  | "life-cluster"
  | "radiation"
  | "civilization-seed"
  | "gravity-well"
  | "entropy-sink"
  | "quantum-core"
  | "meta-law-node"
  | "force-barrier";

export type BrushOperation = "add" | "set" | "scale";
export type BrushShape = "sphere" | "shell" | "column" | "layer";
export type BrushField =
  | "energy"
  | "density"
  | "information"
  | "entropy"
  | "temperature"
  | "biology"
  | "material";
export type BrushFalloff = "gaussian" | "linear" | "constant";
export type BrushVerticalExtent = "selected-layer" | "bounded-volume" | "full-column";

export interface BrushEffect {
  field: BrushField;
  operation: BrushOperation;
  value: number;
}

export interface BrushProfile {
  id: BrushId;
  label: string;
  description: string;
  shape: BrushShape;
  falloff: BrushFalloff;
  effects: readonly BrushEffect[];
  verticalExtent: BrushVerticalExtent;
}

export interface BrushRequest {
  brushId: BrushId;
  x: number;
  y: number;
  z: number;
  radius: number;
  strength: number;
}
