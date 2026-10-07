import type { LegacyVoxelCoordinate } from './LegacyScientificFieldBridge'
import { sculptEraseToMutation, sculptErodeToMutation, sculptInjectToMutation, sculptNoiseToMutation, sculptPatternToMutation, sculptSmoothToMutation, sculptStampToMutation, sculptSmartBrushToMutation } from './LegacyScientificFieldBridge'
import type { WorldFieldMutation } from './MutableWorldFieldProvider'

export class LegacySculptRuntimeAdapter {
  constructor(private readonly applyMutation:(mutation:Omit<WorldFieldMutation,'id'>)=>WorldFieldMutation){}
  inject(cell:LegacyVoxelCoordinate,radius:number,strength:number,fields:Parameters<typeof sculptInjectToMutation>[3],metadata:Record<string,unknown>={}){return this.applyMutation(sculptInjectToMutation(cell,radius,strength,fields,metadata))}
  erode(cell:LegacyVoxelCoordinate,radius:number,strength:number,metadata:Record<string,unknown>={}){return this.applyMutation(sculptErodeToMutation(cell,radius,strength,metadata))}
  erase(cell:LegacyVoxelCoordinate,radius:number,strength:number,metadata:Record<string,unknown>={}){return this.applyMutation(sculptEraseToMutation(cell,radius,strength,metadata))}
  noise(cell:LegacyVoxelCoordinate,radius:number,strength:number,noiseScale:number,seed:number,fields:Parameters<typeof sculptNoiseToMutation>[5],metadata:Record<string,unknown>={}){return this.applyMutation(sculptNoiseToMutation(cell,radius,strength,noiseScale,seed,fields,metadata))}
  pattern(cell:LegacyVoxelCoordinate,radius:number,strength:number,noiseScale:number,fields:Partial<{ energy:number; density:number; information:number }>,metadata:Record<string,unknown>={}){return this.applyMutation(sculptPatternToMutation(cell,radius,strength,noiseScale,fields,metadata))}
  stamp(cell:LegacyVoxelCoordinate,radius:number,strength:number,period=4,metadata:Record<string,unknown>={}){return this.applyMutation(sculptStampToMutation(cell,radius,strength,period,metadata))}
  smooth(cell:LegacyVoxelCoordinate,radius:number,strength:number,metadata:Record<string,unknown>={}){return this.applyMutation(sculptSmoothToMutation(cell,radius,strength,metadata))}
  smartBrush(name:Parameters<typeof sculptSmartBrushToMutation>[0],cell:LegacyVoxelCoordinate,radius:number,selectedLegacyZ?:number,metadata:Record<string,unknown>={}){return this.applyMutation(sculptSmartBrushToMutation(name,cell,radius,selectedLegacyZ,metadata))}
}
