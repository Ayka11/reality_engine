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
  operations?: Partial<Record<keyof ScientificFieldSample, { mode: 'add' | 'set' | 'max' | 'min' | 'smooth6'; value: number; weighting?: 'radial' | 'spatial' }>>
  delta?: Partial<ScientificFieldSample>
  scale?: Partial<Record<keyof ScientificFieldSample, number>>
  metadata?: Record<string, unknown>
}

const FIELDS: (keyof ScientificFieldSample)[] = ['energy','density','information','entropy','temperature','biology','material']
const MUTATION_KINDS = ['brush', 'preset', 'law', 'composer'] as const
const OVERLAY_KINDS = ['preset', 'law', 'composer'] as const

function assertFiniteFieldValues(values: Partial<Record<keyof ScientificFieldSample, number>> | undefined, label: string, nonNegative = false): void {
  if (values === undefined) return
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error(`Invalid ${label}`)
  for (const [field, value] of Object.entries(values)) {
    if (!FIELDS.includes(field as keyof ScientificFieldSample) || typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value for ${field}`)
    }
    if (nonNegative && value < 0) throw new Error(`Invalid ${label} value for ${field}: must be non-negative`)
  }
}

function assertMutation(mutation: Omit<WorldFieldMutation, 'id'> | WorldFieldMutation): void {
  if (!mutation || typeof mutation !== 'object' || !MUTATION_KINDS.includes(mutation.kind)) throw new Error('Invalid world field mutation kind')
  const coordinates = [mutation.x, mutation.y, mutation.z]
  if (coordinates.some(value => value !== undefined) && !coordinates.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('World field mutation coordinates must be all finite when provided')
  }
  if (mutation.radius !== undefined && (typeof mutation.radius !== 'number' || !Number.isFinite(mutation.radius) || mutation.radius < 0)) {
    throw new Error('World field mutation radius must be finite and non-negative')
  }
  assertFiniteFieldValues(mutation.delta, 'mutation delta')
  assertFiniteFieldValues(mutation.scale, 'mutation scale', true)
  if (mutation.operations !== undefined) {
    if (!mutation.operations || typeof mutation.operations !== 'object' || Array.isArray(mutation.operations)) throw new Error('Invalid mutation operations')
    for (const [field, operation] of Object.entries(mutation.operations)) {
      if (!FIELDS.includes(field as keyof ScientificFieldSample) || !operation || typeof operation !== 'object') throw new Error(`Invalid mutation operation for ${field}`)
      if (!['add', 'set', 'max', 'min', 'smooth6'].includes(operation.mode)) throw new Error(`Invalid mutation operation mode for ${field}`)
      if (typeof operation.value !== 'number' || !Number.isFinite(operation.value)) throw new Error(`Invalid mutation operation value for ${field}`)
      if (operation.weighting !== undefined && operation.weighting !== 'radial' && operation.weighting !== 'spatial') throw new Error(`Invalid mutation operation weighting for ${field}`)
    }
  }
  if (mutation.profile) assertScientificFieldProfile(mutation.profile)
  if (mutation.spatialPattern) assertScientificFieldSpatialPattern(mutation.spatialPattern)
  if (mutation.profile && mutation.radius !== undefined && mutation.radius !== mutation.profile.radius) throw new Error('World field mutation radius must match its profile radius')
}

function assertOverlay(entry: { kind: string; scale: Partial<Record<keyof ScientificFieldSample, number>>; delta: Partial<ScientificFieldSample> }): void {
  if (!entry || !OVERLAY_KINDS.includes(entry.kind as typeof OVERLAY_KINDS[number])) throw new Error('Invalid world field overlay kind')
  assertFiniteFieldValues(entry.scale, 'global overlay scale', true)
  assertFiniteFieldValues(entry.delta, 'global overlay delta')
}

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
    return this.sampleThrough(x,y,z,this.mutations.length)
  }

  private sampleThrough(x:number,y:number,z:number,endExclusive:number):ScientificFieldSample {
    const out={...this.base.sample(x,y,z)}
    for(const overlay of this.globalOverlays.values()) for(const field of FIELDS){
      const scale=overlay.scale[field]; if(scale!==undefined) out[field]*=scale
      const delta=overlay.delta[field]; if(delta!==undefined) out[field]+=delta
    }
    for(let mutationIndex=0;mutationIndex<endExclusive;mutationIndex++){
      const mutation=this.mutations[mutationIndex]
      if(mutation.x===undefined||mutation.y===undefined||mutation.z===undefined) continue
      const radius=Math.max(.001,mutation.radius??mutation.profile?.radius??0)
      const distance=Math.hypot(x-mutation.x,y-mutation.y,z-mutation.z)
      if(distance>radius) continue
      const legacyFalloff = mutation.metadata?.legacyFalloff
      const radial = legacyFalloff === 'linear' || legacyFalloff === 'smooth' || legacyFalloff === 'sphere' || legacyFalloff === 'sharp'
        ? evaluateScientificFieldProfile({ schemaVersion: 'scientific-field-profile-v1', kind: 'radial', falloff: legacyFalloff, radius }, distance)
        : mutation.profile
          ? evaluateScientificFieldProfile(mutation.profile, distance)
          : Math.max(0, 1 - distance / radius)
      const pattern=mutation.spatialPattern?(mutation.spatialPattern.kind==='smart-brush'?evaluateScientificSmartBrush(mutation.spatialPattern,{x,y,z}):evaluateScientificFieldSpatialPattern(mutation.spatialPattern,{x,y,z})):1
      const weight=radial*pattern
      for(const field of FIELDS){
        const delta=mutation.delta?.[field]; if(delta!==undefined) out[field]+=delta*weight
        const scale=mutation.scale?.[field]; if(scale!==undefined) out[field]*=1+(scale-1)*weight
        const op=mutation.operations?.[field]
        if(op){
          if(op.mode==='smooth6'){
            const neighbors=[
              this.sampleThrough(x-1,y,z,mutationIndex),
              this.sampleThrough(x+1,y,z,mutationIndex),
              this.sampleThrough(x,y-1,z,mutationIndex),
              this.sampleThrough(x,y+1,z,mutationIndex),
              this.sampleThrough(x,y,z-1,mutationIndex),
              this.sampleThrough(x,y,z+1,mutationIndex),
            ]
            const avg=neighbors.reduce((sum,n)=>sum+n[field],0)/neighbors.length
            const t=Math.min(1,op.value*(op.weighting==='radial'?radial:weight)*.65)
            out[field]=out[field]*(1-t)+avg*t
          } else {
            const operationWeight=op.weighting==='radial'?radial:weight
            const value=op.value*operationWeight
            if(op.mode==='add') out[field]+=value
            else if(op.mode==='set') out[field]=out[field]*(1-operationWeight)+op.value*operationWeight
            else if(op.mode==='max') out[field]=Math.max(out[field],value)
            else out[field]=Math.min(out[field],value)
          }
        }
      }
    }
    for(const field of FIELDS) out[field]=clampField(field,out[field])
    return out
  }

  apply(mutation:Omit<WorldFieldMutation,'id'>):WorldFieldMutation {
    // Detach all nested caller-owned payloads before retaining authoritative state.
    const detached=structuredClone(mutation)
    assertMutation(detached)
    const committed={...detached,id:this.nextId}
    this.nextId++
    this.mutations.push(committed);this.versionCounter++
    if(this.mutations.length>4096)this.mutations.splice(0,this.mutations.length-4096)
    return structuredClone(committed)
  }

  applyRadial(kind:WorldFieldMutation['kind'],x:number,y:number,z:number,radius:number,delta:Partial<ScientificFieldSample>,metadata?:Record<string,unknown>){
    return this.apply({kind,x,y,z,radius,delta,metadata})
  }
  setGlobal(kind:'preset'|'law'|'composer',scale:Partial<Record<keyof ScientificFieldSample,number>>={},delta:Partial<ScientificFieldSample>={},metadata?:Record<string,unknown>){
    const detachedScale=structuredClone(scale)
    const detachedDelta=structuredClone(delta)
    const detachedMetadata=metadata===undefined?undefined:structuredClone(metadata)
    assertOverlay({kind,scale:detachedScale,delta:detachedDelta})
    const committed=structuredClone({id:this.nextId,kind,metadata:{...detachedMetadata,globalScale:detachedScale,globalDelta:detachedDelta,replacesPrevious:true}})
    this.globalOverlays.set(kind,{scale:structuredClone(detachedScale),delta:structuredClone(detachedDelta),metadata:detachedMetadata===undefined?undefined:structuredClone(detachedMetadata)})
    this.versionCounter++
    this.nextId++
    this.mutations.push(committed);if(this.mutations.length>4096)this.mutations.splice(0,this.mutations.length-4096);return structuredClone(committed)
  }
  clearGlobal(kind:'preset'|'law'|'composer'){if(!this.globalOverlays.delete(kind))return false;this.versionCounter++;return true}
  clear(){this.mutations=[];this.globalOverlays.clear();this.versionCounter++}
  getVersion(){return this.versionCounter}
  getMutationCount(){return this.mutations.length}
  serialize(){return structuredClone({schemaVersion:'world-field-state-v2',providerId:this.id,providerVersion:this.version,version:this.versionCounter,nextId:this.nextId,mutations:this.mutations,globalOverlays:Array.from(this.globalOverlays.entries()).map(([kind,value])=>({kind,scale:value.scale,delta:value.delta,metadata:value.metadata}))})}
  restore(state:ReturnType<MutableWorldFieldProvider['serialize']>){
    // Clone before validation/commit so the caller cannot mutate restored nested state.
    const detached=structuredClone(state)
    if(!detached||detached.schemaVersion!=='world-field-state-v2'||detached.providerId!==this.id||detached.providerVersion!==this.version) throw new Error('Unsupported world field state')
    if(!Number.isInteger(detached.nextId)||detached.nextId<1||!Number.isInteger(detached.version)||detached.version<0) throw new Error('Invalid world field state counters')
    if(!Array.isArray(detached.mutations)||!Array.isArray(detached.globalOverlays)) throw new Error('Invalid world field state collections')
    let previousId = 0
    for(const mutation of detached.mutations){
      if(!Number.isInteger(mutation.id)||mutation.id<=previousId) throw new Error('Invalid world field mutation id sequence')
      previousId = mutation.id
      const { id: _id, ...withoutId } = mutation
      assertMutation(withoutId)
    }
    if(detached.mutations.length>4096 || (detached.mutations.length>0 && detached.nextId<=detached.mutations[detached.mutations.length-1].id)) throw new Error('Invalid world field mutation counter')
    const overlays = detached.globalOverlays.map(entry => {
      assertOverlay(entry)
      return {kind:entry.kind,scale:{...entry.scale},delta:{...entry.delta},metadata:entry.metadata?{...entry.metadata}:undefined}
    })
    // Commit only after every item has validated, so a corrupt snapshot cannot partially restore state.
    this.mutations=detached.mutations.map(m=>({...m,metadata:m.metadata?{...m.metadata}:undefined}))
    this.globalOverlays.clear()
    for(const entry of overlays) this.globalOverlays.set(entry.kind,{scale:entry.scale,delta:entry.delta,metadata:entry.metadata})
    this.nextId=detached.nextId
    this.versionCounter=detached.version
  }
  getState(){return structuredClone({schemaVersion:'world-field-state-v1',providerId:this.id,providerVersion:this.version,version:this.versionCounter,mutationCount:this.mutations.length,lastMutation:this.mutations[this.mutations.length-1]??null})}
}
