export type ScientificFieldSpatialPattern =
  | { schemaVersion: 'scientific-field-pattern-v1'; kind: 'noise3'; origin: {x:number;y:number;z:number}; scale:number; seed:number; octaves:number; coordinateFrame:'legacy-grid' }
  | { schemaVersion: 'scientific-field-pattern-v1'; kind: 'pattern3'; origin: {x:number;y:number;z:number}; scale:number; coordinateFrame:'legacy-grid' }
  | { schemaVersion: 'scientific-field-pattern-v1'; kind: 'stamp-lattice'; origin: {x:number;y:number;z:number}; period:number; low:number; high:number; coordinateFrame:'legacy-grid' }

function hash3(x:number,y:number,z:number,seed:number):number {
  let n = Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^Math.imul(seed,1274126177)
  n=(n^(n>>>13))>>>0
  n=Math.imul(n,1274126177)>>>0
  return ((n^(n>>>16))>>>0)/4294967295
}
function smoothstep(t:number):number { return t*t*(3-2*t) }
function valueNoise3(x:number,y:number,z:number,seed:number):number {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z)
  const fx=smoothstep(x-ix),fy=smoothstep(y-iy),fz=smoothstep(z-iz)
  let value=0
  for(let dz=0;dz<=1;dz++) for(let dy=0;dy<=1;dy++) for(let dx=0;dx<=1;dx++) {
    const wx=dx?fx:1-fx,wy=dy?fy:1-fy,wz=dz?fz:1-fz
    value+=hash3(ix+dx,iy+dy,iz+dz,seed)*wx*wy*wz
  }
  return value
}
function fbm3(x:number,y:number,z:number,seed:number,octaves:number):number {
  let value=0,amp=.5,freq=1,norm=0
  for(let i=0;i<octaves;i++){ value+=valueNoise3(x*freq,y*freq,z*freq,seed+i*101)*amp; norm+=amp; amp*=.5; freq*=2 }
  return norm>0?value/norm:value
}
function relative(world:{x:number;y:number;z:number},origin:{x:number;y:number;z:number}) {
  return {x:world.x-origin.x,y:world.z-origin.z,z:world.y-origin.y}
}
export function evaluateScientificFieldSpatialPattern(pattern:ScientificFieldSpatialPattern,world:{x:number;y:number;z:number}):number {
  if(pattern.schemaVersion!=='scientific-field-pattern-v1') return 0
  const p=relative(world,pattern.origin)
  if(pattern.kind==='noise3') return fbm3(p.x/Math.max(1,pattern.scale),p.y/Math.max(1,pattern.scale),p.z/Math.max(1,pattern.scale),pattern.seed,Math.max(1,Math.floor(pattern.octaves)))
  if(pattern.kind==='pattern3') {
    const scale=Math.max(1,pattern.scale)
    const stripes=Math.sin((p.x+p.z)/scale*Math.PI)
    const rings=Math.sin(Math.sqrt(p.x*p.x+p.y*p.y+p.z*p.z)/scale*Math.PI*2)
    return (stripes*.5+rings*.5+1)*.5
  }
  const period=Math.max(1,Math.floor(pattern.period))
  const rel=[Math.round(p.x),Math.round(p.y),Math.round(p.z)]
  return (Math.abs(rel[0])%period===0||Math.abs(rel[1])%period===0||Math.abs(rel[2])%period===0)?pattern.high:pattern.low
}
export function assertScientificFieldSpatialPattern(pattern:ScientificFieldSpatialPattern | ScientificSmartBrushPattern):void {
  if(pattern.kind==='smart-brush') {
    if(pattern.schemaVersion!=='scientific-smart-brush-v1') throw new Error('Unsupported smart brush schema')
    if(!Number.isFinite(pattern.radius)||pattern.radius<=0) throw new Error('Smart brush radius must be positive')
    return
  }
  if(pattern.schemaVersion!=='scientific-field-pattern-v1') throw new Error('Unsupported scientific field pattern schema')
  if(pattern.coordinateFrame!=='legacy-grid') throw new Error('Unsupported scientific field pattern coordinate frame')
  for(const value of Object.values(pattern.origin)) if(!Number.isFinite(value)) throw new Error('Scientific field pattern origin must be finite')
  if(pattern.kind==='noise3'){
    if(!Number.isFinite(pattern.scale)||pattern.scale<=0) throw new Error('Noise pattern scale must be positive')
    if(!Number.isFinite(pattern.seed)) throw new Error('Noise pattern seed must be finite')
    if(!Number.isFinite(pattern.octaves)||pattern.octaves<1) throw new Error('Noise pattern octaves must be positive')
  } else if(pattern.kind==='pattern3'){
    if(!Number.isFinite(pattern.scale)||pattern.scale<=0) throw new Error('Pattern scale must be positive')
  } else {
    if(!Number.isFinite(pattern.period)||pattern.period<1) throw new Error('Stamp period must be positive')
    if(!Number.isFinite(pattern.low)||!Number.isFinite(pattern.high)||pattern.low<0||pattern.high<0) throw new Error('Stamp lattice values must be non-negative')
  }
}

export type ScientificSmartBrushName =
  | 'Volcano' | 'Forest' | 'Ocean' | 'Crystal' | 'Storm' | 'Life Cluster' | 'Radiation' | 'Civilization Seed'

export type ScientificSmartBrushPattern = {
  schemaVersion: 'scientific-smart-brush-v1'
  kind: 'smart-brush'
  name: ScientificSmartBrushName
  origin: {x:number;y:number;z:number}
  radius: number
  selectedLegacyZ?: number
}

export function evaluateScientificSmartBrush(pattern: ScientificSmartBrushPattern, world:{x:number;y:number;z:number}):number {
  const p=relative(world,pattern.origin)
  const r=Math.max(0.001,pattern.radius)
  const legacyX=p.x, legacyY=p.y, legacyZ=p.z
  const d=Math.hypot(legacyX,legacyY)
  if(d>r)return 0
  const selected=pattern.selectedLegacyZ
  switch(pattern.name){
    case 'Volcano':
      return legacyZ>=0 && legacyZ<4 ? Math.exp(-d*d/(r*r)*2) : 0
    case 'Forest':
      return selected!==undefined && Math.round(world.y)===Math.round(selected) ? Math.exp(-d*d/(r*r)*1.5) : 0
    case 'Ocean':
      return legacyZ>=0 && legacyZ<5 ? 1-d/r : 0
    case 'Crystal':
      return selected!==undefined && Math.round(world.y)===Math.round(selected) &&
        (Math.abs(Math.round(legacyX))===Math.abs(Math.round(legacyY)) || Math.round(legacyX)===0 || Math.round(legacyY)===0) ? 1 : 0
    case 'Storm':
      return selected!==undefined && Math.round(world.y)===Math.round(selected)
        ? (Math.sin(legacyX*.7+legacyY*.5)*Math.cos(legacyX*.3+legacyY*.8)+1)/2 : 0
    case 'Life Cluster':
      return selected!==undefined && Math.round(world.y)===Math.round(selected) ? Math.exp(-d*d/(r*r)*2) : 0
    case 'Radiation':
      return legacyZ>=0 ? 1-d/r : 0
    case 'Civilization Seed':
      return selected!==undefined && Math.round(world.y)===Math.round(selected) ? Math.exp(-d*d/(r*r)*1.5) : 0
  }
}
