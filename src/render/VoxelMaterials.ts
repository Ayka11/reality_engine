/**
 * Per-cell material classification and color system.
 * Field values → MatType → PBR properties (roughness, metalness, emissive).
 */

export type MatType =
  | 'rock' | 'metal' | 'organic' | 'energy'
  | 'crystal' | 'water' | 'plasma' | 'void'
  | 'road' | 'neural'

export interface VoxelMat {
  type:        MatType
  r: number;   g: number;   b: number
  rough:       number
  metal:       number
  emissR:      number;  emissG: number;  emissB: number
  emissStr:    number
  transparent: boolean
  alpha:       number
}

const M: Record<MatType, VoxelMat> = {
  rock:    { type:'rock',    r:.35, g:.32, b:.28, rough:.92, metal:.02, emissR:0,    emissG:0,    emissB:0,    emissStr:0,   transparent:false, alpha:1   },
  metal:   { type:'metal',   r:.60, g:.62, b:.65, rough:.28, metal:.88, emissR:0,    emissG:0,    emissB:0,    emissStr:0,   transparent:false, alpha:1   },
  organic: { type:'organic', r:.18, g:.60, b:.12, rough:.82, metal:.02, emissR:.02,  emissG:.15,  emissB:.02,  emissStr:.8,  transparent:false, alpha:1   },
  energy:  { type:'energy',  r:.95, g:.45, b:.10, rough:.55, metal:.10, emissR:1.0,  emissG:.40,  emissB:.05,  emissStr:2.5, transparent:false, alpha:1   },
  crystal: { type:'crystal', r:.35, g:.80, b:.95, rough:.08, metal:.25, emissR:.15,  emissG:.40,  emissB:.60,  emissStr:1.2, transparent:true,  alpha:.82 },
  water:   { type:'water',   r:.08, g:.25, b:.65, rough:.04, metal:.02, emissR:0,    emissG:.05,  emissB:.15,  emissStr:.30, transparent:true,  alpha:.72 },
  plasma:  { type:'plasma',  r:.95, g:.70, b:.30, rough:.35, metal:.05, emissR:1.2,  emissG:.60,  emissB:.15,  emissStr:4.0, transparent:false, alpha:1   },
  void:    { type:'void',    r:0,   g:0,   b:0,   rough:1,   metal:0,   emissR:0,    emissG:0,    emissB:0,    emissStr:0,   transparent:false, alpha:0   },
  road:    { type:'road',    r:.22, g:.22, b:.24, rough:.95, metal:.03, emissR:0,    emissG:0,    emissB:0,    emissStr:0,   transparent:false, alpha:1   },
  neural:  { type:'neural',  r:.50, g:.10, b:.90, rough:.40, metal:.10, emissR:.40,  emissG:.05,  emissB:.80,  emissStr:2.0, transparent:false, alpha:1   },
}

export function classifyVoxel(E: number, D: number, I: number, S: number, T: number, B: number): MatType {
  if (E < 1 && D < .05)   return 'void'
  if (T > 800)             return 'plasma'
  if (E > 600 && S < .05) return 'crystal'
  if (B > 0.55)            return 'organic'
  if (I > 300 && D > .2)  return 'neural'
  if (E > 400 && D > .5)  return 'energy'
  if (D > .75 && E < 50)  return 'rock'
  if (D > .4 && T < 100)  return 'water'
  if (D > .7 && T > 200)  return 'metal'
  return 'rock'
}

export function getMat(type: MatType): VoxelMat { return M[type] }

export function blendEnergyGlow(mat: VoxelMat, E: number): VoxelMat {
  const glow = Math.min(E / 800, 1)
  if (glow < 0.1) return mat
  return {
    ...mat,
    emissR:   mat.emissR   + glow * .40,
    emissG:   mat.emissG   + glow * .20,
    emissB:   mat.emissB   + glow * .05,
    emissStr: mat.emissStr + glow * 1.5,
  }
}

// Per-layer color ramps — index matches layer selector (0=Energy … 5=Bio)
export const LAYER_PALS: [number, number, number][][] = [
  [[0,0,0],[0,20,100],[0,120,200],[60,200,120],[255,140,20],[255,60,10],[255,240,200]], // energy
  [[5,10,5],[20,60,15],[80,160,40],[200,255,100],[255,255,180]],                        // density
  [[10,0,35],[60,0,120],[180,20,220],[255,100,255],[255,200,255]],                      // info
  [[10,0,0],[80,0,0],[180,30,10],[255,80,20],[255,200,100]],                            // entropy
  [[0,0,180],[0,80,255],[255,140,0],[255,220,50],[255,255,200]],                        // temp
  [[0,20,5],[0,80,20],[20,200,60],[100,255,120],[200,255,200]],                         // bio
]

export function lerpPalette(pal: [number, number, number][], t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t))
  const pos = t * (pal.length - 1)
  const lo = Math.floor(pos), hi = Math.min(lo + 1, pal.length - 1), f = pos - lo
  return [
    pal[lo][0] + (pal[hi][0] - pal[lo][0]) * f,
    pal[lo][1] + (pal[hi][1] - pal[lo][1]) * f,
    pal[lo][2] + (pal[hi][2] - pal[lo][2]) * f,
  ]
}
