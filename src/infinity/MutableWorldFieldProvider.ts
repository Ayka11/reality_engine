import type { ScientificFieldProvider } from './ScientificFieldProvider'
import type { ScientificFieldSample } from './FieldSampler'
import { assertScientificFieldProfile, evaluateScientificFieldProfile } from './ScientificFieldProfile'
import type { ScientificFieldProfile } from './ScientificFieldProfile'
import { assertScientificFieldSpatialPattern, evaluateScientificFieldSpatialPattern, evaluateScientificSmartBrush } from './ScientificFieldSpatialPattern'
import type { ScientificFieldSpatialPattern, ScientificSmartBrushPattern } from './ScientificFieldSpatialPattern'

export type WorldFieldMutation = {
  id: number
  kind: 'brush' | 'preset' | 'law' | 'composer'
  x?: number
  y?: number
  z?: number
  radius?: number
  profile?: ScientificFieldProfile
  spatialPattern?: ScientificFieldSpatialPattern | ScientificSmartBrushPattern
  operations?: Partial<Record<keyof ScientificFieldSample, { mode: 'add' | 'max' | 'min'; value: number }>>
  delta?: Partial<ScientificFieldSample>
  scale?: Partial<Record<keyof ScientificFieldSample, number>>
  metadata?: Record<string, unknown>
}

const FIELDS: (keyof ScientificFieldSample)[] = ['energy','density','information','entropy','temperature','biology','material']

function clampField(name:keyof ScientificFieldSample,value:number):number {
  if(name==='density'||name==='entropy'||name==='biology') return Math.max(0,Math.min(1,value))
  if(name==='material') return Math.max(0,value)
  return Math.max(0,value)
}

export class MutableWorldFieldProvider implements ScientificFieldProvider {
  readonly id='authoritative-world-field'
  readonly version='world-field-mutation-v1'
  private nextId=1
  private versionCounter=0
  private mutations:WorldFieldMutation[]=[]
  private globalOverlays=new Map<'preset'|'law'|'composer',{scale:Partial<Record<keyof ScientificFieldSample,number>>;delta:Partial<ScientificFieldSample>;metadata?:Record<string,unknown>}>()

  constructor(private base:ScientificFieldProvider){}
  setBase(base:ScientificFieldProvider){this.base=base;this.versionCounter++}

  sample(x:number,y:number,z:number):ScientificFieldSample {
    const out={...this.base.sample(x,y,z)}
    for(const overlay of this.globalOverlays.values()) for(const field of FIELDS){
      const scale=overlay.scale[field]; if(scale!==undefined) out[field]*=scale
      const delta=overlay.delta[field]; if(delta!==undefined) out[field]+=delta
    }
    for(const mutation of this.mutations){
      if(mutation.x===undefined||mutation.y===undefined||mutation.z===undefined) continue
      const radius=Math.max(.001,mutation.radius??mutation.profile?.radius??0)
      const distance=Math.hypot(x-mutation.x,y-mutation.y,z-mutation.z)
      if(distance>radius) continue
      const radial=mutation.profile?evaluateScientificFieldProfile(mutation.profile,distance):Math.max(0,1-distance/radius)
      const pattern=mutation.spatialPattern?(mutation.spatialPattern.kind==='smart-brush'?evaluateScientificSmartBrush(mutation.spatialPattern,{x,y,z}):evaluateScientificFieldSpatialPattern(mutation.spatialPattern,{x,y,z})):1
      const weight=radial*pattern
      for(const field of FIELDS){
        const delta=mutation.delta?.[field]; if(delta!==undefined) out[field]+=delta*weight
        const scale=mutation.scale?.[field]; if(scale!==undefined) out[field]*=1+(scale-1)*weight
        const op=mutation.operations?.[field]
        if(op){ const value=op.value*weight; if(op.mode==='add') out[field]+=value; else if(op.mode==='max') out[field]=Math.max(out[field],value); else out[field]=Math.min(out[field],value) }
      }
    }
    for(const field of FIELDS) out[field]=clampField(field,out[field])
    return out
  }

  apply(mutation:Omit<WorldFieldMutation,'id'>):WorldFieldMutation {
    if(mutation.profile) assertScientificFieldProfile(mutation.profile)
    if(mutation.spatialPattern) assertScientificFieldSpatialPattern(mutation.spatialPattern)
    if(mutation.profile&&mutation.radius!==undefined&&mutation.radius!==mutation.profile.radius) throw new Error('World field mutation radius must match its profile radius')
    const committed={...mutation,id:this.nextId++}
    this.mutations.push(committed);this.versionCounter++
    if(this.mutations.length>4096)this.mutations.splice(0,this.mutations.length-4096)
    return committed
  }

  applyRadial(kind:WorldFieldMutation['kind'],x:number,y:number,z:number,radius:number,delta:Partial<ScientificFieldSample>,metadata?:Record<string,unknown>){
    return this.apply({kind,x,y,z,radius,delta,metadata})
  }
  setGlobal(kind:'preset'|'law'|'composer',scale:Partial<Record<keyof ScientificFieldSample,number>>={},delta:Partial<ScientificFieldSample>={},metadata?:Record<string,unknown>){
    this.globalOverlays.set(kind,{scale:{...scale},delta:{...delta},metadata});this.versionCounter++
    const committed={id:this.nextId++,kind,metadata:{...metadata,globalScale:scale,globalDelta:delta,replacesPrevious:true}}
    this.mutations.push(committed);if(this.mutations.length>4096)this.mutations.splice(0,this.mutations.length-4096);return committed
  }
  clearGlobal(kind:'preset'|'law'|'composer'){if(!this.globalOverlays.delete(kind))return false;this.versionCounter++;return true}
  clear(){this.mutations=[];this.globalOverlays.clear();this.versionCounter++}
  getVersion(){return this.versionCounter}
  getMutationCount(){return this.mutations.length}
  getState(){return {schemaVersion:'world-field-state-v1',providerId:this.id,providerVersion:this.version,version:this.versionCounter,mutationCount:this.mutations.length,lastMutation:this.mutations[this.mutations.length-1]??null}}
}
